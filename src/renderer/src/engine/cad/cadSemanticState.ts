import type { BoundingBox, DxfEntity } from '../../store/projectStore'
import { applyLayerOverrides, classifyLayers, layerRoleMap } from './layerClassification'
import { recognizeOpenings } from './openingRecognition'
import { recognizeObstacles } from './obstacleRecognition'
import type {
  CadApprovedObstacle,
  CadApprovedOpening,
  CadBlockReference,
  CadLayerClassification,
  CadLayerOverrides,
  CadLayerRole,
  CadObstacleCandidate,
  CadOpeningCandidate
} from './semanticTypes'

/**
 * Pure state model for CAD semantic suggestions and the user's decisions about them.
 * Machine output is only ever 'review-required'; 'approved'/'rejected' exist solely because a store
 * action recorded an explicit user decision.
 */
export type CadReviewStatus = 'review-required' | 'approved' | 'rejected'

export type StoredCadOpening = Omit<CadOpeningCandidate, 'status'> & {
  status: CadReviewStatus
  /** Elevation (drawing units) of the level the candidate was recognised on. */
  level: number
  approvedAt?: string
}

export type StoredCadObstacle = Omit<CadObstacleCandidate, 'status'> & {
  status: CadReviewStatus
  level: number
  /** Required once approved; feet of clear space kept around the obstacle. */
  clearanceFt?: number
  approvedAt?: string
}

export interface CadLayerRoleState {
  /** Cached machine suggestions (source 'suggested'). */
  suggestions: CadLayerClassification[]
  /** User decisions: layer -> role. These always win over a suggestion. */
  overrides: CadLayerOverrides
}

export const EMPTY_LAYER_ROLES: CadLayerRoleState = { suggestions: [], overrides: {} }

/** Everything that undo/redo restores for CAD review decisions. */
export interface CadSemanticSnapshot {
  layerRoles: CadLayerRoleState
  openings: StoredCadOpening[]
  obstacles: StoredCadObstacle[]
  level: number
}

export const isDecided = (s: CadReviewStatus): boolean => s !== 'review-required'

export const effectiveLayerClassifications = (state: CadLayerRoleState): CadLayerClassification[] =>
  applyLayerOverrides(state.suggestions, state.overrides)

export const effectiveLayerRoleMap = (state: CadLayerRoleState): Record<string, CadLayerRole> =>
  layerRoleMap(effectiveLayerClassifications(state))

/** Layers the user explicitly confirmed as walls. Suggested wall layers are deliberately excluded. */
export const userConfirmedWallLayers = (state: CadLayerRoleState): string[] =>
  Object.entries(state.overrides)
    .filter(([, role]) => role === 'wall')
    .map(([layer]) => layer)
    .sort()

export const levelKey = (id: string, level: number): string => (level === 0 ? id : `${id}@${level}`)

export function approvedOpenings(openings: StoredCadOpening[], level = 0): CadApprovedOpening[] {
  return openings
    .filter((o) => o.status === 'approved' && o.level === level)
    .map((o) => ({ id: o.id, a: { ...o.span.a }, b: { ...o.span.b } }))
}

export function approvedObstacles(obstacles: StoredCadObstacle[]): CadApprovedObstacle[] {
  const out: CadApprovedObstacle[] = []
  for (const o of obstacles) {
    if (o.status !== 'approved' || o.clearanceFt === undefined) continue
    out.push({
      id: o.id,
      status: 'approved',
      clearanceFt: o.clearanceFt,
      polygon: [...o.polygon],
      ...(o.circle ? { circle: { ...o.circle } } : {})
    })
  }
  return out
}

/** Fresh suggestions replace undecided ones; every decided item is kept exactly as the user saw it. */
export function mergeCandidates<T extends { id: string; status: CadReviewStatus }>(fresh: T[], prior: T[]): T[] {
  const decided = new Map(prior.filter((p) => isDecided(p.status)).map((p) => [p.id, p]))
  const result: T[] = []
  const used = new Set<string>()
  for (const f of fresh) {
    const keep = decided.get(f.id)
    if (keep) used.add(f.id)
    result.push(keep ?? f)
  }
  for (const [id, item] of decided) if (!used.has(id)) result.push(item)
  return result
}

export interface SemanticRecognitionInput {
  entities: DxfEntity[]
  bbox: BoundingBox | null
  blockReferences?: CadBlockReference[]
  unitsPerFoot: number
  level: number
  overrides: CadLayerOverrides
  prior?: { openings: StoredCadOpening[]; obstacles: StoredCadObstacle[] }
  /** Reuse these machine suggestions instead of classifying again. */
  suggestions?: CadLayerClassification[]
}

export interface SemanticRecognitionResult {
  layerRoles: CadLayerRoleState
  openings: StoredCadOpening[]
  obstacles: StoredCadObstacle[]
}

/** Classify layers, then recognise opening and obstacle suggestions for one level. Never throws. */
export function recognizeCadSemantics(input: SemanticRecognitionInput): SemanticRecognitionResult {
  const { entities, level } = input
  const bbox = input.bbox ?? { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  let suggestions = input.suggestions ?? []
  if (!input.suggestions) {
    try {
      suggestions = classifyLayers({ entities, bbox })
    } catch {
      suggestions = []
    }
  }
  const layerRoles: CadLayerRoleState = { suggestions, overrides: { ...input.overrides } }
  const roles = effectiveLayerRoleMap(layerRoles)
  let openings: StoredCadOpening[] = []
  let obstacles: StoredCadObstacle[] = []
  if (Number.isFinite(input.unitsPerFoot) && input.unitsPerFoot > 0 && entities.length) {
    try {
      openings = recognizeOpenings(
        { entities, blockReferences: input.blockReferences },
        { unitsPerFoot: input.unitsPerFoot, layerRoles: roles, level }
      ).candidates.map((c) => ({ ...c, id: levelKey(c.id, level), status: 'review-required' as CadReviewStatus, level }))
    } catch {
      openings = []
    }
    try {
      obstacles = recognizeObstacles(entities, { unitsPerFoot: input.unitsPerFoot, layerRoles: roles, level }).candidates.map(
        (c) => ({ ...c, id: levelKey(c.id, level), status: 'review-required' as CadReviewStatus, level })
      )
    } catch {
      obstacles = []
    }
  }
  if (input.prior) {
    openings = mergeCandidates(openings, input.prior.openings)
    obstacles = mergeCandidates(obstacles, input.prior.obstacles)
  }
  return { layerRoles, openings, obstacles }
}

const onSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean => {
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax)
  if (Math.abs(cross) > 1e-9 * Math.max(1, Math.hypot(bx - ax, by - ay))) return false
  return px >= Math.min(ax, bx) - 1e-9 && px <= Math.max(ax, bx) + 1e-9 && py >= Math.min(ay, by) - 1e-9 && py <= Math.max(ay, by) + 1e-9
}
function pointInRing(x: number, y: number, ring: number[]): boolean {
  let inside = false
  const n = ring.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i], yi = ring[2 * i + 1], xj = ring[2 * j], yj = ring[2 * j + 1]
    if (onSegment(x, y, xi, yi, xj, yj)) return true
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function segmentsCross(a: number[], b: number[], c: number[], d: number[]): boolean {
  const o = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

const pointSegDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy))
}
const segSegDist = (a: number[], b: number[], c: number[], d: number[]): number => {
  if (segmentsCross(a, b, c, d)) return 0
  return Math.min(
    pointSegDist(a[0], a[1], c[0], c[1], d[0], d[1]), pointSegDist(b[0], b[1], c[0], c[1], d[0], d[1]),
    pointSegDist(c[0], c[1], a[0], a[1], b[0], b[1]), pointSegDist(d[0], d[1], a[0], a[1], b[0], b[1])
  )
}
/** Smallest distance (drawing units) between the zone outline and the obstacle outline. */
function outlineGap(zonePoints: number[], o: CadApprovedObstacle): number {
  const m = zonePoints.length / 2
  const zoneEdge = (j: number) => [zonePoints[2 * j], zonePoints[2 * j + 1], zonePoints[2 * ((j + 1) % m)], zonePoints[2 * ((j + 1) % m) + 1]]
  if (o.circle) {
    let best = Infinity
    for (let j = 0; j < m; j++) {
      const e = zoneEdge(j)
      best = Math.min(best, pointSegDist(o.circle.x, o.circle.y, e[0], e[1], e[2], e[3]))
    }
    return Math.max(0, best - o.circle.radius)
  }
  const ring = o.polygon ?? []
  const n = ring.length / 2
  let best = Infinity
  for (let i = 0; i < n; i++) {
    const a = [ring[2 * i], ring[2 * i + 1]], b = [ring[2 * ((i + 1) % n)], ring[2 * ((i + 1) % n) + 1]]
    for (let j = 0; j < m; j++) {
      const e = zoneEdge(j)
      best = Math.min(best, segSegDist(a, b, [e[0], e[1]], [e[2], e[3]]))
    }
  }
  return best
}

/**
 * Approved obstacles that belong to a zone: any obstacle vertex inside it, any zone vertex inside the
 * obstacle, or crossing outlines. With `unitsPerFoot`, an obstacle wholly outside the zone also belongs to it
 * when its outline is closer to the zone outline than its clearance (its clearance band reaches into the zone).
 */
export function obstaclesInZone(zonePoints: number[], obstacles: CadApprovedObstacle[], unitsPerFoot?: number): CadApprovedObstacle[] {
  if (zonePoints.length < 6) return []
  const useBand = unitsPerFoot !== undefined && Number.isFinite(unitsPerFoot) && unitsPerFoot > 0
  const bandReaches = (o: CadApprovedObstacle): boolean =>
    useBand && o.clearanceFt > 0 && ((o.polygon && o.polygon.length >= 6) || !!o.circle) && outlineGap(zonePoints, o) < o.clearanceFt * unitsPerFoot!
  return obstacles.filter((o) => {
    const ring = o.polygon && o.polygon.length >= 6 ? o.polygon : undefined
    if (!ring) {
      return o.circle ? pointInRing(o.circle.x, o.circle.y, zonePoints) || bandReaches(o) : false
    }
    for (let i = 0; i < ring.length; i += 2) if (pointInRing(ring[i], ring[i + 1], zonePoints)) return true
    for (let i = 0; i < zonePoints.length; i += 2) if (pointInRing(zonePoints[i], zonePoints[i + 1], ring)) return true
    const n = ring.length / 2, m = zonePoints.length / 2
    for (let i = 0; i < n; i++) {
      const a = [ring[2 * i], ring[2 * i + 1]], b = [ring[2 * ((i + 1) % n)], ring[2 * ((i + 1) % n) + 1]]
      for (let j = 0; j < m; j++) {
        const c = [zonePoints[2 * j], zonePoints[2 * j + 1]], d = [zonePoints[2 * ((j + 1) % m)], zonePoints[2 * ((j + 1) % m) + 1]]
        if (segmentsCross(a, b, c, d)) return true
      }
    }
    return bandReaches(o)
  })
}

/**
 * Approved obstacles that constrain a zone. A CAD-derived zone takes obstacles of the level it was recognised on;
 * a hand-drawn zone takes those of the level it was drawn on, or of every level when it has none recorded (the
 * conservative choice). `unitsPerFoot` enables the clearance-band rule of obstaclesInZone.
 */
export function zoneObstaclesFor(
  zone: { points: number[]; cadProvenance?: { level?: number }; drawnOnLevel?: number },
  obstacles: StoredCadObstacle[],
  unitsPerFoot?: number
): CadApprovedObstacle[] {
  const level = zone.cadProvenance ? (zone.cadProvenance.level ?? 0) : zone.drawnOnLevel
  const eligible = level === undefined ? obstacles : obstacles.filter((o) => o.level === level)
  return obstaclesInZone(zone.points, approvedObstacles(eligible), unitsPerFoot)
}

/** Distinct entity elevations (drawing units) present in the drawing, ascending; always includes 0. */
export function listCadLevels(entities: DxfEntity[]): number[] {
  const levels = new Set<number>([0])
  for (const e of entities) {
    const z = e.elevation
    if (typeof z === 'number' && Number.isFinite(z)) levels.add(z)
  }
  return [...levels].sort((a, b) => a - b)
}
