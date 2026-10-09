import type { DxfEntity } from '../../store/projectStore'
import { measureSimplePolygon } from '../engineeringInputs'
import { isPointInPolygon } from '../geometry'
import { atLevel } from './elevation'
import { isLevelAnnotation, normalizeAnnotationText } from './levelAnnotations'
import { getCadEntityPath, validateCadEntity } from './nativeGeometry'
import type {
  CadRoomCandidate,
  CadRoomRecognitionOptions,
  CadRoomRecognitionResult
} from './semanticTypes'

type Point = { x: number; y: number }
type Source = { handle: string; layer: string }
type Segment = { a: Point; b: Point; sources: Source[]; cuts: number[] }
type Edge = { from: number; to: number; twin: number; sources: Source[] }
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
const at = (s: Segment, t: number): Point => ({
  x: s.a.x + t * (s.b.x - s.a.x),
  y: s.a.y + t * (s.b.y - s.a.y)
})
const sourceKey = (s: Source): string => `${s.handle}\u0000${s.layer}`
const mergeSources = (a: Source[], b: Source[]): Source[] => [
  ...new Map([...a, ...b].map((s) => [sourceKey(s), s])).values()
]
const WORK_LIMIT = 200_000
const NUMBER_ONLY = /^[\d\s.,+\-'"]+$/
/** Door / window tags such as D01, D-1, W2, W12A. */
const OPENING_TAG = /^[DW]\s?-?\d{1,3}[A-Z]?$/i
const APPROVED_OPENING_SNAP_FT = 0.75
/** Parallel-ness / span tolerance for pairing the two faces of a double-line wall at an approved opening. */
const JAMB_PAIR_TOLERANCE_FT = 0.05
/**
 * Faces whose mean width (2 x area / perimeter) is below this are wall bodies, not rooms. 1.6 ft (~490 mm) also catches
 * the 380-400 mm walls common in Egypt (a 0.4 m x 5 m face has a mean width of ~1.2 ft). Every room of at least the
 * 20 ft2 default minimum area that is not a sliver has a mean width above 2 ft, so real rooms are not affected.
 */
const WALL_BODY_MAX_WIDTH_FT = 1.6
/**
 * Elongation test for thicker walls / shafts: the equivalent rectangle (same area and perimeter) narrower than this AND
 * more than SLENDER_MIN_ASPECT times longer than wide is not a room. A 3 ft corridor is not narrow by this test;
 * a 2.5 ft x 10 ft closet (aspect exactly 4) is kept; a 600 mm x 5 m wall (1.97 ft x 16.4 ft) is dropped.
 */
const SLENDER_MAX_WIDTH_FT = 2
const SLENDER_MIN_ASPECT = 4
const APPROVED_OPENING_LAYER = '(approved opening)'
const isOpeningSource = (s: Source): boolean => s.layer === APPROVED_OPENING_LAYER
class RecognitionBudgetExceeded extends Error {}

/**
 * Uniform 2D bucket index over axis-aligned boxes (points are zero-size boxes). Queries return only the items whose
 * cells meet the query box, so stacked or large plans do not pay a scan over everything sharing an x-range.
 */
class GridIndex {
  private readonly cells = new Map<number, number[]>()
  private readonly minX: number
  private readonly minY: number
  private readonly cw: number
  private readonly ch: number
  private readonly n: number
  constructor(private readonly boxes: [number, number, number, number][], private readonly spend: (n?: number) => void) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const b of boxes) { minX = Math.min(minX, b[0]); minY = Math.min(minY, b[1]); maxX = Math.max(maxX, b[2]); maxY = Math.max(maxY, b[3]) }
    this.n = Math.max(1, Math.min(512, Math.ceil(Math.sqrt(boxes.length))))
    this.minX = minX; this.minY = minY
    this.cw = Math.max((maxX - minX) / this.n, 1e-9); this.ch = Math.max((maxY - minY) / this.n, 1e-9)
    boxes.forEach((b, i) => this.forCells(b, (key) => { spend(); const cell = this.cells.get(key); if (cell) cell.push(i); else this.cells.set(key, [i]) }))
  }
  private forCells(b: [number, number, number, number], visit: (key: number) => void): void {
    const c0 = Math.max(0, Math.min(this.n - 1, Math.floor((b[0] - this.minX) / this.cw)))
    const c1 = Math.max(0, Math.min(this.n - 1, Math.floor((b[2] - this.minX) / this.cw)))
    const r0 = Math.max(0, Math.min(this.n - 1, Math.floor((b[1] - this.minY) / this.ch)))
    const r1 = Math.max(0, Math.min(this.n - 1, Math.floor((b[3] - this.minY) / this.ch)))
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) visit(r * this.n + c)
  }
  /** Indices of boxes that overlap `b` (exact box test), each once, ascending. Work is charged per cell and per candidate item. */
  query(b: [number, number, number, number]): number[] {
    const seen = new Set<number>()
    this.forCells(b, (key) => {
      this.spend()
      for (const i of this.cells.get(key) ?? []) {
        if (seen.has(i)) continue
        this.spend()
        const o = this.boxes[i]
        if (o[0] <= b[2] && o[2] >= b[0] && o[1] <= b[3] && o[3] >= b[1]) seen.add(i)
      }
    })
    return [...seen].sort((x, y) => x - y)
  }
}

function signedArea(points: Point[]): number {
  const origin = points[0]
  let sum = 0
  for (let i = 0; i < points.length; i++)
    sum += cross(subtract(points[i], origin), subtract(points[(i + 1) % points.length], origin))
  return sum / 2
}

/** Remove collinear subdivisions so the same boundary has the same identity after graph splitting. */
function simplifyRing(points: Point[]): Point[] {
  if (
    points.length > 1 &&
    points[0].x === points[points.length - 1].x &&
    points[0].y === points[points.length - 1].y
  )
    points = points.slice(0, -1)
  return points.filter((p, i) => {
    const before = subtract(p, points[(i + points.length - 1) % points.length])
    const after = subtract(points[(i + 1) % points.length], p)
    return (
      Math.abs(cross(before, after)) >
        1e-10 * Math.max(1, Math.hypot(before.x, before.y) * Math.hypot(after.x, after.y)) ||
      before.x * after.x + before.y * after.y < 0
    )
  })
}

function canonicalRing(polygon: number[]): string {
  const pairs: string[] = []
  for (let i = 0; i < polygon.length; i += 2)
    pairs.push(`${polygon[i].toPrecision(15)},${polygon[i + 1].toPrecision(15)}`)
  const start = pairs.reduce((best, p, i) => (p < pairs[best] ? i : best), 0)
  const forward = pairs.map((_, i) => pairs[(start + i) % pairs.length]).join(';')
  const reverse = pairs.map((_, i) => pairs[(start - i + pairs.length) % pairs.length]).join(';')
  return forward < reverse ? forward : reverse
}

/** Recognize bounded geometry, never approve semantics or bridge openings. Work is explicitly bounded. */
export function recognizeCadRooms(
  entities: DxfEntity[],
  options: CadRoomRecognitionOptions
): CadRoomRecognitionResult {
  const result: CadRoomRecognitionResult = { candidates: [], diagnostics: [] }
  const diagnostic = (
    code: string,
    message: string,
    severity: 'warning' | 'error' = 'warning'
  ): number => result.diagnostics.push({ code, severity, message })
  const scale = options.drawingUnitsPerFoot
  const tolerance = options.endpointToleranceFt ?? 0.001
  const minimumArea = options.minAreaSqFt ?? 20
  const limit = Math.min(options.maxSegments ?? 5000, 5000)
  if (
    ![scale, tolerance, minimumArea, limit].every((n) => Number.isFinite(n) && n > 0) ||
    tolerance > 0.01 ||
    !Number.isInteger(limit)
  ) {
    diagnostic(
      'invalid-recognition-options',
      'Drawing units per foot, tolerance, minimum area and segment budget must be finite and positive; tolerance cannot exceed 0.01 ft.',
      'error'
    )
    return result
  }
  const selected = options.layers ? new Set(options.layers) : null
  const level = options.level ?? 0
  if (!Number.isFinite(level)) {
    diagnostic('invalid-recognition-options', 'Level must be a finite elevation in drawing units.', 'error')
    return result
  }
  // Elevated entities (constant non-zero Z kept by the parsers) are ignored unless `level` selects them.
  const eligible = (e: DxfEntity): boolean =>
    atLevel(e, level) && (!selected || selected.has(e.layer ?? '0'))
  const segments: Segment[] = []
  const direct: { points: number[]; sources: Source[]; approximate: boolean }[] = []
  let segmentCount = 0,
    work = 0
  const spend = (n = 1): void => {
    work += n
    if (work > WORK_LIMIT) throw new RecognitionBudgetExceeded()
  }
  let origin: Point | undefined
  const normalize = (points: number[]): Point[] => {
    origin ??= { x: points[0], y: points[1] }
    const normalized: Point[] = []
    for (let i = 0; i < points.length; i += 2)
      normalized.push({ x: (points[i] - origin.x) / scale, y: (points[i + 1] - origin.y) / scale })
    if (!normalized.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
      throw new RangeError('Physical coordinates are not finite')
    return normalized
  }
  const candidates = new Map<string, CadRoomCandidate>()
  const addCandidate = (
    input: Point[],
    sources: Source[],
    approximate: boolean,
    graph: boolean
  ): void => {
    const points = simplifyRing(input)
    if (points.length < 3) return
    spend(points.length * points.length)
    const normalized = points.flatMap((p) => [p.x, p.y])
    let area: number
    try {
      area = measureSimplePolygon(normalized).area
    } catch {
      diagnostic(
        'invalid-boundary',
        'A repeated, self-intersecting or degenerate boundary was suppressed.'
      )
      return
    }
    if (area < minimumArea) {
      diagnostic(
        'small-boundary',
        `Boundary area ${area.toFixed(3)} ft² is below the ${minimumArea} ft² room threshold.`
      )
      return
    }
    if (graph) {
      let perimeter = 0
      for (let i = 0; i < points.length; i++) perimeter += distance(points[i], points[(i + 1) % points.length])
      const meanWidth = (2 * area) / perimeter
      // Equivalent rectangle: sides w, l with w + l = P / 2 and w * l = A.
      const half = perimeter / 2
      const length = (half + Math.sqrt(Math.max(0, half * half - 4 * area))) / 2
      const width = area / length
      if (meanWidth < WALL_BODY_MAX_WIDTH_FT || (width < SLENDER_MAX_WIDTH_FT - 1e-9 && length / width > SLENDER_MIN_ASPECT + 1e-9)) {
        diagnostic(
          'wall-body-excluded',
          `A ${area.toFixed(1)} ft² face with a mean width of ${meanWidth.toFixed(2)} ft (${meanWidth < WALL_BODY_MAX_WIDTH_FT ? `under ${WALL_BODY_MAX_WIDTH_FT} ft` : `a ${width.toFixed(2)} x ${length.toFixed(1)} ft sliver`}) is the body of a wall between its two face lines, not a room; it was not proposed.`
        )
        return
      }
    }
    const polygon = points.flatMap((p) => [origin!.x + p.x * scale, origin!.y + p.y * scale])
    if (!polygon.every(Number.isFinite)) {
      diagnostic(
        'invalid-boundary',
        'Boundary cannot be represented in source drawing coordinates.'
      )
      return
    }
    const key = canonicalRing(polygon)
    const openingSources = sources.filter(isOpeningSource)
    sources = sources.filter((s) => !isOpeningSource(s))
    const openingNotes = [...new Set(openingSources.map((s) => s.handle.slice('opening:'.length)))].sort()
    const previous = candidates.get(key)
    if (previous) {
      previous.sourceHandles = [
        ...new Set([...previous.sourceHandles, ...sources.map((s) => s.handle)])
      ].sort()
      previous.sourceLayers = [
        ...new Set([...previous.sourceLayers, ...sources.map((s) => s.layer)])
      ].sort()
      return
    }
    const unresolvedConditions = [
      'Confirm room boundary, use, height, openings, obstructions and barrier roles. Geometry does not verify engineering or fire compliance.'
    ]
    if (graph)
      unresolvedConditions.push(
        `Endpoints and junctions are matched within ${tolerance} ft tolerance; review boundary connectivity.`
      )
    if (approximate)
      unresolvedConditions.push(
        'Native curved boundary is sampled: polygon area is approximate, not the true curved area. Review the source geometry and sampling tolerance/cap.'
      )
    if (openingNotes.length)
      unresolvedConditions.push(
        `Boundary is closed across user-approved opening(s) ${openingNotes.join(', ')}; the room is only enclosed while those openings stay approved.`
      )
    candidates.set(key, {
      // Store the canonical ring itself: collision-free and stable across source duplicates and traversal direction.
      id: `cad-room:${key}`,
      name: 'Room',
      polygon,
      areaSqFt: area,
      sourceHandles: [...new Set(sources.map((s) => s.handle))].sort(),
      sourceLayers: [...new Set(sources.map((s) => s.layer))].sort(),
      confidence: approximate ? 0.65 : graph ? 0.85 : 0.95,
      status: 'review-required',
      evidence: [
        graph
          ? 'Bounded face of selected native wall line/polyline segments.'
          : 'Closed native polyline boundary.',
        approximate
          ? 'Native bulges sampled at requested 0.01 ft sagitta, subject to segment cap.'
          : 'Simple polygon geometry validated in canonical feet.',
        ...openingNotes.map((id) => `Gap closed by approved opening ${id}.`)
      ],
      unresolvedConditions
    })
  }
  try {
    if (entities.length > 100_000) throw new RecognitionBudgetExceeded()
    for (let index = 0; index < entities.length; index++) {
      spend()
      const entity = entities[index]
      if (!eligible(entity) || !['LINE', 'LWPOLYLINE', 'POLYLINE'].includes(entity.type)) continue
      const closed = entity.type !== 'LINE' && entity.closed === true
      if (!closed && (!selected || selected.size === 0)) continue
      const rawSegments =
        entity.type === 'LINE' ? 1 : (entity.points?.length ?? 0) / 2 - (closed ? 0 : 1)
      // Check the structural budget before vertex validation or native curve sampling iterates it.
      if (segmentCount + rawSegments > limit) throw new RecognitionBudgetExceeded()
      const invalid = validateCadEntity(entity)
      if (invalid) {
        diagnostic('invalid-geometry', `${entity.handle ?? index}: ${invalid}`)
        continue
      }
      if (entity.geometryApproximation) {
        diagnostic(
          'approximated-boundary-excluded',
          `${entity.handle ?? index}: ${entity.geometryApproximation}`
        )
        continue
      }
      const curved = entity.bulges?.some((b) => b !== 0) ?? false
      if (curved && !closed) {
        diagnostic(
          'curved-open-boundary-excluded',
          'Open curved polylines require corrected/explicit room geometry.'
        )
        continue
      }
      const path = getCadEntityPath(entity, {
        maxSagitta: 0.01 * scale,
        maxSegments: Math.max(1, Math.floor((limit - segmentCount) / rawSegments))
      })
      segmentCount += path.length / 2 - 1
      if (segmentCount > limit) throw new RecognitionBudgetExceeded()
      const sources = [
        {
          handle: entity.handle ?? entity.sourceHandle ?? `entity-${index}`,
          layer: entity.layer ?? '0'
        }
      ]
      if (closed) {
        const ring = path.slice(0, -2)
        try {
          const points = normalize(ring)
          spend(points.length * points.length)
          measureSimplePolygon(points.flatMap((p) => [p.x, p.y]))
        } catch (error) {
          if (error instanceof RecognitionBudgetExceeded) throw error
          diagnostic('invalid-boundary', `${sources[0].handle}: Invalid closed boundary.`)
          continue
        }
        if (curved || !selected) {
          direct.push({ points: ring, sources, approximate: curved })
          continue
        }
      }
      const points = normalize(path)
      for (let i = 1; i < points.length; i++) {
        if (distance(points[i - 1], points[i]) <= 1e-12) continue
        segments.push({ a: points[i - 1], b: points[i], cuts: [0, 1], sources })
      }
    }
    for (const boundary of direct)
      addCandidate(normalize(boundary.points), boundary.sources, boundary.approximate, false)

    // Only user-approved openings may close a gap. Both ends must snap to existing wall endpoints.
    const approvedIds = new Map<string, string>()
    for (const opening of options.approvedOpenings ?? []) {
      const ends = [opening.a, opening.b]
      if (!origin || !ends.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
        diagnostic('approved-opening-not-in-gap', `Approved opening ${opening.id} has no wall geometry to attach to.`)
        continue
      }
      // Every wall endpoint within the snap radius of each opening end (deduplicated by tolerance).
      const targets = ends.map((p) => ({ x: (p.x - origin!.x) / scale, y: (p.y - origin!.y) / scale }))
      const near = targets.map((target) => {
        let best: Point | undefined,
          bestDistance = APPROVED_OPENING_SNAP_FT
        const all: Point[] = []
        for (const seg of segments)
          for (const end of [seg.a, seg.b]) {
            spend()
            const d = distance(end, target)
            if (d > APPROVED_OPENING_SNAP_FT) continue
            if (!all.some((q) => distance(q, end) <= tolerance)) all.push(end)
            if (d <= bestDistance) {
              best = end
              bestDistance = d
            }
          }
        return { best, all }
      })
      if (!near[0].best || !near[1].best || distance(near[0].best, near[1].best) <= tolerance) {
        diagnostic(
          'approved-opening-not-in-gap',
          `Approved opening ${opening.id} does not span a gap between two wall endpoints; the boundary stays open there.`
        )
        continue
      }
      const key = `opening:${opening.id}`
      approvedIds.set(key, opening.id)
      // A double-line wall has a gap in BOTH faces, joined by jamb caps, and the opening is drawn between them.
      // Close every endpoint pair that runs parallel to the opening (the same span on each face), not just the
      // pair nearest to the drawn ends: otherwise the room on one side swallows the jamb pocket between the faces
      // (or a diagonal across it). With no parallel pair the nearest endpoints are used, as for a single-line wall.
      const open = subtract(targets[1], targets[0]),
        openLength = Math.hypot(open.x, open.y)
      const pairs: { a: Point; b: Point; length: number; score: number }[] = []
      for (const pa of near[0].all)
        for (const pb of near[1].all) {
          const v = subtract(pb, pa),
            length = Math.hypot(v.x, v.y)
          if (length <= tolerance || Math.abs(cross(open, v)) / openLength > JAMB_PAIR_TOLERANCE_FT) continue
          pairs.push({ a: pa, b: pb, length, score: distance(pa, targets[0]) + distance(pb, targets[1]) })
        }
      let closing: [Point, Point][] = [[near[0].best, near[1].best]]
      if (pairs.length) {
        const base = pairs.reduce((m, q) => (q.score < m.score ? q : m))
        closing = pairs.filter((q) => Math.abs(q.length - base.length) <= JAMB_PAIR_TOLERANCE_FT).map((q) => [q.a, q.b])
      }
      for (const [pa, pb] of closing)
        segments.push({ a: pa, b: pb, cuts: [0, 1], sources: [{ handle: key, layer: APPROVED_OPENING_LAYER }] })
    }
    // Sweep the x bounds, with a strict pair-work cap even for pathological coincident geometry.
    segments.sort((a, b) => Math.min(a.a.x, a.b.x) - Math.min(b.a.x, b.b.x))
    const addProjection = (point: Point, s: Segment): void => {
      const v = subtract(s.b, s.a),
        length2 = v.x * v.x + v.y * v.y
      const t = ((point.x - s.a.x) * v.x + (point.y - s.a.y) * v.y) / length2
      if (t > 0 && t < 1 && distance(point, at(s, t)) <= tolerance) s.cuts.push(t)
    }
    for (let i = 0; i < segments.length; i++) {
      const a = segments[i],
        r = subtract(a.b, a.a),
        maxX = Math.max(a.a.x, a.b.x)
      for (let j = i + 1; j < segments.length; j++) {
        const b = segments[j]
        if (Math.min(b.a.x, b.b.x) > maxX + tolerance) break
        spend()
        if (
          Math.max(a.a.y, a.b.y) + tolerance < Math.min(b.a.y, b.b.y) ||
          Math.max(b.a.y, b.b.y) + tolerance < Math.min(a.a.y, a.b.y)
        )
          continue
        const s = subtract(b.b, b.a),
          q = subtract(b.a, a.a),
          denominator = cross(r, s)
        if (Math.abs(denominator) > 1e-12 * Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y)) {
          const t = cross(q, s) / denominator,
            u = cross(q, r) / denominator
          if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
            a.cuts.push(t)
            b.cuts.push(u)
          }
        }
        // Includes collinear overlaps and endpoint-to-interior T junctions.
        addProjection(a.a, b)
        addProjection(a.b, b)
        addProjection(b.a, a)
        addProjection(b.b, a)
      }
    }
    const nodes: Point[] = [],
      outgoing: number[][] = [],
      edges: Edge[] = []
    const cells = new Map<string, number[]>(),
      edgeKeys = new Map<string, number>()
    const node = (p: Point): number => {
      const gx = Math.floor(p.x / tolerance),
        gy = Math.floor(p.y / tolerance)
      let nearest = -1,
        nearestDistance = Infinity
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          for (const id of cells.get(`${gx + dx},${gy + dy}`) ?? []) {
            spend()
            const d = distance(nodes[id], p)
            if (d <= tolerance && d < nearestDistance) {
              nearest = id
              nearestDistance = d
            }
          }
        }
      if (nearest >= 0) return nearest
      const id = nodes.length
      nodes.push(p)
      outgoing.push([])
      const key = `${gx},${gy}`,
        bucket = cells.get(key) ?? []
      bucket.push(id)
      cells.set(key, bucket)
      return id
    }
    let splitCount = 0
    for (const s of segments) {
      s.cuts.sort((a, b) => a - b)
      for (let i = 1; i < s.cuts.length; i++) {
        if (s.cuts[i] - s.cuts[i - 1] <= 1e-12) continue
        if (++splitCount > limit) throw new RecognitionBudgetExceeded()
        const from = node(at(s, s.cuts[i - 1])),
          to = node(at(s, s.cuts[i]))
        if (from === to) continue
        const key = from < to ? `${from}:${to}` : `${to}:${from}`
        const duplicate = edgeKeys.get(key)
        if (duplicate !== undefined) {
          edges[duplicate].sources = mergeSources(edges[duplicate].sources, s.sources)
          edges[edges[duplicate].twin].sources = edges[duplicate].sources
          continue
        }
        const id = edges.length
        edgeKeys.set(key, id)
        edges.push(
          { from, to, twin: id + 1, sources: s.sources },
          { from: to, to: from, twin: id, sources: s.sources }
        )
        outgoing[from].push(id)
        outgoing[to].push(id + 1)
      }
    }
    const openCount = outgoing.filter((list) => list.length === 1).length
    if (openCount)
      diagnostic(
        'open-boundary',
        `${openCount} wall endpoints are open; no missing connection or door gap was bridged.`
      )
    for (let n = 0; n < nodes.length; n++)
      outgoing[n].sort(
        (a, b) =>
          Math.atan2(nodes[edges[a].to].y - nodes[n].y, nodes[edges[a].to].x - nodes[n].x) -
          Math.atan2(nodes[edges[b].to].y - nodes[n].y, nodes[edges[b].to].x - nodes[n].x)
      )
    const positions = new Map<number, number>()
    for (const list of outgoing) list.forEach((edge, index) => positions.set(edge, index))
    const visited = new Set<number>()
    for (let start = 0; start < edges.length; start++) {
      if (visited.has(start)) continue
      let current = start
      const ring: Point[] = [],
        sources: Source[] = []
      do {
        spend()
        if (visited.has(current)) break
        visited.add(current)
        const edge = edges[current]
        ring.push(nodes[edge.from])
        sources.push(...edge.sources)
        const list = outgoing[edge.to],
          position = positions.get(edge.twin)!
        current = list[(position + list.length - 1) % list.length]
      } while (current !== start)
      // The exterior is clockwise; keep counter-clockwise bounded faces only.
      if (current === start && ring.length >= 3 && signedArea(ring) > 1e-10)
        addCandidate(ring, sources, false, true)
    }
    const allCandidates = [...candidates.values()]
    const strictlyInside = (x: number, y: number, polygon: number[]): boolean => {
      if (!isPointInPolygon(x, y, polygon)) return false
      for (let i = 0; i < polygon.length; i += 2) {
        const j = (i + 2) % polygon.length
        const a = { x: polygon[i], y: polygon[i + 1] },
          b = { x: polygon[j], y: polygon[j + 1] }
        const v = subtract(b, a),
          length2 = v.x * v.x + v.y * v.y
        const t = Math.max(0, Math.min(1, ((x - a.x) * v.x + (y - a.y) * v.y) / length2))
        if (Math.hypot(x - a.x - t * v.x, y - a.y - t * v.y) <= tolerance * scale) return false
      }
      return true
    }
    // Only candidates whose bounding boxes overlap can nest or overlap (a vertex strictly inside the other polygon lies in
    // its box), so pairs are found through a grid index instead of testing every pair.
    const boxOf = (poly: number[]): [number, number, number, number] => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let k = 0; k < poly.length; k += 2) {
        minX = Math.min(minX, poly[k]); maxX = Math.max(maxX, poly[k])
        minY = Math.min(minY, poly[k + 1]); maxY = Math.max(maxY, poly[k + 1])
      }
      return [minX, minY, maxX, maxY]
    }
    const candidateBoxes = allCandidates.map((c) => boxOf(c.polygon))
    const candidateGrid = new GridIndex(candidateBoxes, spend)
    for (let i = 0; i < allCandidates.length; i++)
      for (const j of candidateGrid.query(candidateBoxes[i])) {
        if (j <= i) continue
        const a = allCandidates[i],
          b = allCandidates[j]
        spend(a.polygon.length * b.polygon.length)
        let overlap = false
        for (let k = 0; k < a.polygon.length && !overlap; k += 2)
          overlap = strictlyInside(a.polygon[k], a.polygon[k + 1], b.polygon)
        for (let k = 0; k < b.polygon.length && !overlap; k += 2)
          overlap = strictlyInside(b.polygon[k], b.polygon[k + 1], a.polygon)
        if (overlap) {
          const condition =
            'Nested or overlapping boundaries may describe an obstacle, hole or separate space; correct the room geometry before approval. Areas do not subtract holes.'
          a.unresolvedConditions.push(condition)
          b.unresolvedConditions.push(condition)
          a.confidence = Math.min(a.confidence, 0.5)
          b.confidence = Math.min(b.confidence, 0.5)
          diagnostic('nested-boundaries', condition)
        }
      }
    // Eligible room-name texts are collected once (normalised, level notes / pure numbers / door-window tags dropped)
    // and bucketed in a 2D grid, so each candidate only examines the texts in the cells its bounding box meets; work is
    // charged per cell and per text actually examined, not per entity per candidate.
    interface RoomLabel { x: number; y: number; height: number; text: string }
    const labelTexts: RoomLabel[] = []
    for (const entity of entities) {
      spend()
      if ((entity.type !== 'TEXT' && entity.type !== 'MTEXT') || !atLevel(entity, level) || validateCadEntity(entity)) continue
      const text = normalizeAnnotationText(entity.text!)
      if (!text || isLevelAnnotation(entity.text!) || NUMBER_ONLY.test(text) || OPENING_TAG.test(text)) continue
      labelTexts.push({ x: entity.x!, y: entity.y!, height: Number.isFinite(entity.textHeight) ? entity.textHeight! : 0, text })
    }
    const labelGrid = labelTexts.length
      ? new GridIndex(labelTexts.map((l) => [l.x, l.y, l.x, l.y]), spend)
      : undefined
    for (const candidate of allCandidates) {
      const poly = candidate.polygon
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, cx = 0, cy = 0
      for (let i = 0; i < poly.length; i += 2) {
        minX = Math.min(minX, poly[i]); maxX = Math.max(maxX, poly[i])
        minY = Math.min(minY, poly[i + 1]); maxY = Math.max(maxY, poly[i + 1])
        cx += poly[i]; cy += poly[i + 1]
      }
      cx /= poly.length / 2; cy /= poly.length / 2
      const found = new Map<string, { height: number; distance: number }>()
      for (const k of labelGrid?.query([minX, minY, maxX, maxY]) ?? []) {
        const label = labelTexts[k]
        spend(poly.length / 2)
        if (!isPointInPolygon(label.x, label.y, poly)) continue
        const distance = Math.hypot(label.x - cx, label.y - cy)
        const known = found.get(label.text)
        if (!known) found.set(label.text, { height: label.height, distance })
        else {
          known.height = Math.max(known.height, label.height)
          known.distance = Math.min(known.distance, distance)
        }
      }
      // Largest text first, then the most central, then alphabetical.
      const names = [...found.entries()]
        .sort((a, b) => b[1].height - a[1].height || a[1].distance - b[1].distance || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([text]) => text)
      if (names.length) {
        candidate.name = names[0]
        candidate.evidence.push(`Interior text label suggestion: ${names.join(' / ')}`)
      }
      if (names.length > 1)
        candidate.unresolvedConditions.push(
          'Multiple interior text labels; confirm which describes the room.'
        )
      result.candidates.push(candidate)
    }
    result.candidates.sort((a, b) => a.id.localeCompare(b.id))
  } catch (error) {
    result.candidates = []
    if (error instanceof RecognitionBudgetExceeded)
      diagnostic(
        'recognition-budget-exceeded',
        `Recognition stopped at the ${limit}-segment / ${WORK_LIMIT}-operation budget. Select fewer layers or simplify the source geometry.`,
        'warning'
      )
    else
      diagnostic(
        'invalid-geometry',
        error instanceof Error ? error.message : 'Invalid source geometry',
        'error'
      )
  }
  return result
}
