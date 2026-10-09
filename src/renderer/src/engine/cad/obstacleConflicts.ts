import type { CadApprovedObstacle } from './semanticTypes'

export type { CadApprovedObstacle }

/**
 * Pure conflict checks between approved obstacles (with clearance) and proposed equipment or ducts.
 * All geometry is in one shared coordinate system; `unitsPerFoot` converts to feet for clearance.
 * Obstacles whose status is not 'approved' are ignored: a suggestion can never block a design.
 *
 * Wiring: deployment validation (deploymentValidation) checks each indoor-unit footprint and duct run, and
 * deploymentManager detours branch ducts, using the zone's approved obstacles via footprintConflicts()/ductConflicts().
 * Limitations: outdoor units, refrigerant piping, condensate drains and terminal faces are NOT checked against obstacles.
 */

type P = { x: number; y: number }

export interface FootprintRect {
  /** Minimum corner of the unrotated rectangle. */
  x: number
  y: number
  width: number
  depth: number
  /** Degrees counter-clockwise (in the shared coordinate system) about the rectangle centre. */
  rotationDeg?: number
}
export interface DuctSegment { a: P; b: P; widthFt: number }

export interface ObstacleConflict {
  obstacleId: string
  kind: 'overlap' | 'clearance'
  /** Gap between the proposed element's edge and the obstacle edge; 0 for an overlap. */
  distanceFt: number
  requiredFt: number
}
export interface ObstacleConflictReport { blocked: boolean; conflicts: ObstacleConflict[] }

const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y })
const cross = (a: P, b: P): number => a.x * b.y - a.y * b.x
const dot = (a: P, b: P): number => a.x * b.x + a.y * b.y

function pointSegmentDistance(p: P, a: P, b: P): number {
  const v = sub(b, a), len2 = dot(v, v)
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), v) / len2))
  return Math.hypot(p.x - a.x - t * v.x, p.y - a.y - t * v.y)
}
function segmentsIntersect(a: P, b: P, c: P, d: P): boolean {
  const d1 = cross(sub(b, a), sub(c, a)), d2 = cross(sub(b, a), sub(d, a))
  const d3 = cross(sub(d, c), sub(a, c)), d4 = cross(sub(d, c), sub(b, c))
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  const on = (p: P, q: P, r: P) => cross(sub(q, p), sub(r, p)) === 0 && dot(sub(r, p), sub(r, q)) <= 0
  return on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)
}
function segmentDistance(a: P, b: P, c: P, d: P): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}
const ring = (poly: number[]): P[] => Array.from({ length: poly.length / 2 }, (_, i) => ({ x: poly[2 * i], y: poly[2 * i + 1] }))
function inside(p: P, poly: P[]): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    if ((poly[i].y > p.y) !== (poly[j].y > p.y) && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c
  return c
}
/** Edge-to-edge distance between two polygons (closed rings); 0 on overlap or containment. */
function polygonDistance(a: P[], b: P[]): number {
  if (inside(a[0], b) || inside(b[0], a)) return 0
  let best = Infinity
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      best = Math.min(best, segmentDistance(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]))
  return best
}
function polylineToPointDistance(shape: P[], closed: boolean, p: P): number {
  if (closed && inside(p, shape)) return 0
  let best = Infinity
  const n = closed ? shape.length : shape.length - 1
  for (let i = 0; i < n; i++) best = Math.min(best, pointSegmentDistance(p, shape[i], shape[(i + 1) % shape.length]))
  return best
}

export function footprintPolygon(r: FootprintRect): P[] {
  const cx = r.x + r.width / 2, cy = r.y + r.depth / 2
  const th = ((r.rotationDeg ?? 0) * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th)
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const dx = (sx * r.width) / 2, dy = (sy * r.depth) / 2
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c }
  })
}

function report(
  shape: P[], closed: boolean, halfWidthFt: number, obstacles: CadApprovedObstacle[], unitsPerFoot: number
): ObstacleConflictReport {
  const conflicts: ObstacleConflict[] = []
  if (!Number.isFinite(unitsPerFoot) || unitsPerFoot <= 0) throw new RangeError('unitsPerFoot must be finite and positive')
  for (const o of obstacles) {
    if (o.status !== 'approved' || !Number.isFinite(o.clearanceFt) || o.clearanceFt < 0) continue
    let gapUnits: number
    if (o.circle) {
      gapUnits = polylineToPointDistance(shape, closed, o.circle) - o.circle.radius
    } else if (o.polygon && o.polygon.length >= 6) {
      const poly = ring(o.polygon)
      if (closed) gapUnits = polygonDistance(shape, poly)
      else {
        gapUnits = Infinity
        if (inside(shape[0], poly) || inside(shape[1], poly)) gapUnits = 0
        for (let i = 0; i < poly.length && gapUnits > 0; i++)
          gapUnits = Math.min(gapUnits, segmentDistance(shape[0], shape[1], poly[i], poly[(i + 1) % poly.length]))
      }
    } else continue
    const gapFt = Math.max(0, gapUnits / unitsPerFoot - halfWidthFt)
    if (gapFt <= 0) conflicts.push({ obstacleId: o.id, kind: 'overlap', distanceFt: 0, requiredFt: o.clearanceFt })
    else if (gapFt < o.clearanceFt) conflicts.push({ obstacleId: o.id, kind: 'clearance', distanceFt: gapFt, requiredFt: o.clearanceFt })
  }
  return { blocked: conflicts.length > 0, conflicts }
}

/** Does an equipment footprint overlap an approved obstacle or intrude on its clearance band? */
export function footprintConflicts(
  footprint: FootprintRect | P[],
  obstacles: CadApprovedObstacle[],
  options: { unitsPerFoot: number }
): ObstacleConflictReport {
  const shape = Array.isArray(footprint) ? footprint : footprintPolygon(footprint)
  return report(shape, true, 0, obstacles, options.unitsPerFoot)
}

/** Does a duct run (centreline plus width) cross an approved obstacle or its clearance band? */
export function ductConflicts(
  segment: DuctSegment,
  obstacles: CadApprovedObstacle[],
  options: { unitsPerFoot: number }
): ObstacleConflictReport {
  return report([segment.a, segment.b], false, segment.widthFt / 2, obstacles, options.unitsPerFoot)
}
