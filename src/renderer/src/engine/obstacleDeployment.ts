import type { DuctSegment, Zone } from '../store/projectStore'
import type { CadApprovedObstacle } from './cad/semanticTypes'
import { ductConflicts, footprintConflicts, type ObstacleConflict } from './cad/obstacleConflicts'
import { routePlanPath, type PlanObstacle } from './cad/obstacleRouting'

/**
 * Approved CAD obstacles (with clearance) constrain indoor-unit footprints and duct runs only.
 * Listed limitations: outdoor units, refrigerant piping, condensate drains and terminal (diffuser/grille) faces are
 * not checked against obstacles; the designer must review those by hand.
 */

/** Thrown by deployment validation so the transaction can report ERR_OBSTACLE_CONFLICT. */
export class ObstacleConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ObstacleConflictError'
  }
}

/** Only genuinely approved obstacles constrain a design; anything else is a suggestion and is ignored. */
export const approvedZoneObstacles = (zone: Pick<Zone, 'obstacles'>): CadApprovedObstacle[] =>
  (zone.obstacles ?? []).filter((o) => o && o.status === 'approved' && Number.isFinite(o.clearanceFt) && o.clearanceFt >= 0)

const describe = (c: ObstacleConflict): string =>
  c.kind === 'overlap'
    ? `overlaps approved obstacle ${c.obstacleId}`
    : `is ${c.distanceFt.toFixed(2)} ft from approved obstacle ${c.obstacleId}, inside its ${c.requiredFt.toFixed(2)} ft clearance`

export function footprintObstacleMessage(
  label: string,
  rect: { x: number; y: number; width: number; depth: number },
  obstacles: CadApprovedObstacle[],
  unitsPerFoot: number
): string | undefined {
  const report = footprintConflicts(rect, obstacles, { unitsPerFoot })
  return report.blocked ? `${label} ${describe(report.conflicts[0])}.` : undefined
}

/** Conflicts of a duct polyline (all of its segments) with approved obstacles, worst first. */
export function ductPathConflicts(points: number[], widthIn: number, obstacles: CadApprovedObstacle[], unitsPerFoot: number): ObstacleConflict[] {
  const found = new Map<string, ObstacleConflict>()
  for (let i = 0; i < points.length - 2; i += 2) {
    const report = ductConflicts(
      { a: { x: points[i], y: points[i + 1] }, b: { x: points[i + 2], y: points[i + 3] }, widthFt: widthIn / 12 },
      obstacles,
      { unitsPerFoot }
    )
    for (const c of report.conflicts) {
      const previous = found.get(c.obstacleId)
      if (!previous || c.distanceFt < previous.distanceFt) found.set(c.obstacleId, c)
    }
  }
  return [...found.values()].sort((a, b) => a.distanceFt - b.distanceFt)
}

export const ductObstacleMessage = (duct: Pick<DuctSegment, 'id' | 'type' | 'points' | 'widthIn'>, obstacles: CadApprovedObstacle[], unitsPerFoot: number): string | undefined => {
  const conflicts = ductPathConflicts(duct.points, duct.widthIn, obstacles, unitsPerFoot)
  return conflicts.length ? `Duct ${duct.id} (${duct.type}) ${describe(conflicts[0])}.` : undefined
}

const outline = (o: CadApprovedObstacle): number[] | undefined => {
  if (o.polygon && o.polygon.length >= 6) return o.polygon
  if (o.circle) {
    const { x, y, radius: r } = o.circle
    return [x - r, y - r, x + r, y - r, x + r, y + r, x - r, y + r]
  }
  return undefined
}

/**
 * Re-route one branch duct around approved obstacles with the bounded orthogonal router. The result is
 * verified again against the true obstacle geometry; any failure returns an error, never an unchecked route.
 */
export function detourBranchDuct(
  duct: DuctSegment,
  zonePoints: number[],
  obstacles: CadApprovedObstacle[],
  unitsPerFoot: number
): { points: number[] } | { error: string } {
  const blockers = ductPathConflicts(duct.points, duct.widthIn, obstacles, unitsPerFoot)
  if (!blockers.length) return { points: duct.points }
  const widthFt = duct.widthIn / 12
  const plan: PlanObstacle[] = []
  for (const o of obstacles) {
    const polygon = outline(o)
    if (!polygon) continue
    plan.push({
      id: o.id, polygon, kind: 'obstruction', sourceHandles: [o.id],
      clearanceDrawingUnits: (o.clearanceFt + widthFt / 2) * unitsPerFoot
    })
  }
  const start = { x: duct.points[0], y: duct.points[1] }
  const end = { x: duct.points[duct.points.length - 2], y: duct.points[duct.points.length - 1] }
  try {
    const route = routePlanPath(start, end, zonePoints, plan)
    if (route.points.length < 4) throw new RangeError('Route has no length')
    const remaining = ductPathConflicts(route.points, duct.widthIn, obstacles, unitsPerFoot)
    if (remaining.length) throw new RangeError(`rerouted path still ${describe(remaining[0])}`)
    return { points: route.points }
  } catch (error) {
    return {
      error: `Branch duct ${duct.id} ${describe(blockers[0])} and no detour was found (${error instanceof Error ? error.message : String(error)}).`
    }
  }
}
