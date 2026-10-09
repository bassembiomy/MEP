import type { DxfEntity } from '../../store/projectStore'
import { isPointInPolygon } from '../geometry'
import { rolesFromName } from './layerClassification'
import { getCadEntityPath } from './nativeGeometry'
import type {
  CadBlockReference,
  CadLayerRole,
  CadOpeningCandidate,
  CadOpeningKind,
  CadRoomCandidate,
  CadSemanticDiagnostic
} from './semanticTypes'

/**
 * Door / window suggestions. Everything returned is status 'review-required': an opening never
 * closes a room boundary until the user approves it (see CadRoomRecognitionOptions.approvedOpenings).
 * All geometric thresholds are in feet, so a mm drawing and a ft drawing give the same result.
 *
 * Confidence summary (door block):  0.70 name + verified ~90 degree swing arc (0.5 - 1.5 m leaf)
 *                                   0.50 name only, no swing arc
 *                                  +0.20 when the span matches a gap between collinear wall endpoints
 *                                  +0.10 when only a nearby parallel wall is found
 *                                  +0.05 when the layer role also says door/window
 *   door arc without block, in a wall gap: 0.55.   bare wall gap (2 - 8 ft): 0.35, kind 'opening'.
 */

type P = { x: number; y: number }
type Seg = { a: P; b: P; handle: string; layer: string }
interface Gap { p: P; q: P; widthFt: number; segP: Seg; segQ: Seg }

export interface OpeningRecognitionOptions {
  unitsPerFoot: number
  /** Layer name -> role, typically from classifyLayers/applyLayerOverrides. Falls back to name patterns. */
  layerRoles?: Record<string, CadLayerRole>
  /** Room candidates used only to report which rooms touch each opening. */
  rooms?: CadRoomCandidate[]
}

const MIN_LEAF_FT = 0.5 / 0.3048
const MAX_LEAF_FT = 1.5 / 0.3048
const MIN_GAP_FT = 2
const MAX_GAP_FT = 8
const SEGMENT_LIMIT = 3000

const dist = (a: P, b: P): number => Math.hypot(a.x - b.x, a.y - b.y)
const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const unit = (a: P, b: P): P => {
  const d = dist(a, b) || 1
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d }
}
const cross = (u: P, v: P): number => u.x * v.y - u.y * v.x
const dot = (u: P, v: P): number => u.x * v.x + u.y * v.y

/** Door name test: DOOR, PORTE, DR tokens, or a "D-" prefix. Window: WIN, WINDOW, GLAZ, FENETRE or a "W-" prefix. */
export function openingKindFromName(name: string): 'door' | 'window' | undefined {
  const upper = name.toUpperCase()
  const tokens = upper.split(/[^A-Z0-9]+/).filter(Boolean)
  const hasSeparator = /[^A-Z0-9]/.test(upper)
  const roles = rolesFromName(name).roles
  if (roles.includes('door') || tokens.some((t) => /^(DOOR|PORTE|DR)\d*$/.test(t)) || (hasSeparator && tokens[0] === 'D'))
    return 'door'
  if (roles.includes('window') || tokens.some((t) => /^(WIN|WINDOW|FENETRE|GLAZ)\d*$/.test(t)) || (hasSeparator && tokens[0] === 'W'))
    return 'window'
  return undefined
}

function segmentsOf(entities: DxfEntity[], accept: (e: DxfEntity) => boolean): Seg[] {
  const out: Seg[] = []
  entities.forEach((e, i) => {
    if (!accept(e)) return
    const handle = e.handle ?? e.sourceHandle ?? `entity-${i}`
    const layer = e.layer ?? '0'
    if (e.type === 'LINE' && e.points?.length === 2) {
      out.push({ a: { x: e.x!, y: e.y! }, b: { x: e.points[0], y: e.points[1] }, handle, layer })
    } else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.points) {
      const n = e.points.length / 2
      for (let k = 0; k < n - (e.closed ? 0 : 1); k++) {
        if (e.bulges?.[k]) continue
        const j = (k + 1) % n
        out.push({
          a: { x: e.points[2 * k], y: e.points[2 * k + 1] },
          b: { x: e.points[2 * j], y: e.points[2 * j + 1] },
          handle,
          layer
        })
      }
    }
  })
  return out.filter((s) => dist(s.a, s.b) > 0)
}

function detectGaps(walls: Seg[], k: number): Gap[] {
  const touch = 0.05 * k
  const free: { p: P; far: P; seg: Seg; index: number }[] = []
  walls.forEach((s, index) => {
    for (const [p, far] of [[s.a, s.b], [s.b, s.a]] as [P, P][]) {
      const covered = walls.some((o, j) => {
        if (j === index) return false
        if (dist(o.a, p) <= touch || dist(o.b, p) <= touch) return true
        const v = { x: o.b.x - o.a.x, y: o.b.y - o.a.y }
        const t = dot({ x: p.x - o.a.x, y: p.y - o.a.y }, v) / dot(v, v)
        return t > 0 && t < 1 && dist(p, { x: o.a.x + t * v.x, y: o.a.y + t * v.y }) <= touch
      })
      if (!covered) free.push({ p, far, seg: s, index })
    }
  })
  const gaps: Gap[] = []
  for (let i = 0; i < free.length; i++)
    for (let j = i + 1; j < free.length; j++) {
      const f = free[i], g = free[j]
      if (f.index === g.index) continue
      const d = dist(f.p, g.p) / k
      if (d < MIN_GAP_FT || d > MAX_GAP_FT) continue
      const u = unit(f.p, g.p)
      if (dot(unit(f.far, f.p), u) < 0.95 || dot(unit(g.far, g.p), { x: -u.x, y: -u.y }) < 0.95) continue
      if (Math.abs(cross(unit(f.far, f.p), u)) > 0.05 || Math.abs(cross(unit(g.far, g.p), u)) > 0.05) continue
      gaps.push({ p: f.p, q: g.p, widthFt: d, segP: f.seg, segQ: g.seg })
    }
  // Double-line walls give two parallel gaps one wall thickness apart: keep one.
  const kept: Gap[] = []
  for (const gap of gaps) {
    const m = mid(gap.p, gap.q), u = unit(gap.p, gap.q)
    if (!kept.some((o) => dist(mid(o.p, o.q), m) <= 1.5 * k && Math.abs(cross(unit(o.p, o.q), u)) < 0.1)) kept.push(gap)
  }
  return kept
}

function arcSweep(e: DxfEntity): number {
  return (((e.endAngleDeg! - e.startAngleDeg!) % 360) + 360) % 360
}
const isDoorArc = (e: DxfEntity, k: number): boolean =>
  e.type === 'ARC' &&
  Math.abs(arcSweep(e) - 90) <= 10 &&
  e.radius! / k >= MIN_LEAF_FT &&
  e.radius! / k <= MAX_LEAF_FT

function arcEnds(e: DxfEntity): [P, P] {
  const path = getCadEntityPath(e, { maxSegments: 1 })
  return [{ x: path[0], y: path[1] }, { x: path[path.length - 2], y: path[path.length - 1] }]
}

/** Sets of 2-4 near-equal parallel lines whose outer spacing is a plausible wall thickness. */
function parallelSets(lines: Seg[], k: number): { lines: Seg[]; spanA: P; spanB: P }[] {
  const used = new Set<number>()
  const sets: { lines: Seg[]; spanA: P; spanB: P }[] = []
  const order = lines.map((_, i) => i).sort((i, j) => dist(lines[j].a, lines[j].b) - dist(lines[i].a, lines[i].b))
  for (const i of order) {
    if (used.has(i)) continue
    const base = lines[i], len = dist(base.a, base.b), u = unit(base.a, base.b)
    const n: P = { x: -u.y, y: u.x }
    const group = [i]
    for (const j of order) {
      if (j === i || used.has(j)) continue
      const o = lines[j], ol = dist(o.a, o.b)
      if (Math.abs(cross(u, unit(o.a, o.b))) > 0.03 || ol < 0.8 * len) continue
      const lateral = Math.abs(dot({ x: o.a.x - base.a.x, y: o.a.y - base.a.y }, n)) / k
      const along = dot({ x: o.a.x - base.a.x, y: o.a.y - base.a.y }, u)
      if (lateral < 0.05 || lateral > 1.5 || Math.abs(along) > 0.2 * len) continue
      group.push(j)
    }
    const offsets = group.map((g) => dot({ x: lines[g].a.x - base.a.x, y: lines[g].a.y - base.a.y }, n) / k)
    if (group.length >= 2 && group.length <= 4 && Math.max(...offsets) - Math.min(...offsets) >= 0.2) {
      group.forEach((g) => used.add(g))
      const lateralMid = (Math.max(...offsets) + Math.min(...offsets)) / 2 * k
      sets.push({
        lines: group.map((g) => lines[g]),
        spanA: { x: base.a.x + n.x * lateralMid, y: base.a.y + n.y * lateralMid },
        spanB: { x: base.b.x + n.x * lateralMid, y: base.b.y + n.y * lateralMid }
      })
    }
  }
  return sets
}

export function recognizeOpenings(
  parsed: { entities: DxfEntity[]; blockReferences?: CadBlockReference[] },
  options: OpeningRecognitionOptions
): { candidates: CadOpeningCandidate[]; diagnostics: CadSemanticDiagnostic[] } {
  const diagnostics: CadSemanticDiagnostic[] = []
  const k = options.unitsPerFoot
  if (!Number.isFinite(k) || k <= 0) {
    diagnostics.push({ code: 'invalid-recognition-options', severity: 'error', message: 'unitsPerFoot must be finite and positive.' })
    return { candidates: [], diagnostics }
  }
  const roleOf = (layer: string): CadLayerRole => {
    const given = options.layerRoles?.[layer]
    if (given) return given
    const roles = rolesFromName(layer).roles
    return roles.length === 1 ? roles[0] : 'unknown'
  }
  const entities = parsed.entities
  const walls = segmentsOf(entities, (e) => !e.sourceBlock && roleOf(e.layer ?? '0') === 'wall')
  let gaps: Gap[] = []
  if (walls.length > SEGMENT_LIMIT)
    diagnostics.push({ code: 'opening-budget-exceeded', severity: 'warning', message: `More than ${SEGMENT_LIMIT} wall segments; wall-gap analysis skipped.` })
  else gaps = detectGaps(walls, k)
  const explained = new Set<Gap>()

  const gapMatching = (a: P, b: P): Gap | undefined => {
    const m = mid(a, b), u = unit(a, b), w = dist(a, b) / k
    return gaps.find(
      (g) =>
        dist(mid(g.p, g.q), m) <= 0.75 * k &&
        Math.abs(g.widthFt - w) <= 0.25 * g.widthFt &&
        Math.abs(cross(unit(g.p, g.q), u)) <= 0.1
    )
  }
  const nearbyWall = (a: P, b: P): Seg | undefined => {
    const m = mid(a, b), u = unit(a, b)
    return walls.find((s) => {
      if (Math.abs(cross(unit(s.a, s.b), u)) > 0.1) return false
      const v = { x: s.b.x - s.a.x, y: s.b.y - s.a.y }
      const t = Math.max(0, Math.min(1, dot({ x: m.x - s.a.x, y: m.y - s.a.y }, v) / dot(v, v)))
      return dist(m, { x: s.a.x + t * v.x, y: s.a.y + t * v.y }) <= 1.0 * k
    })
  }
  const hostOf = (s?: Seg) => (s ? { handle: s.handle, layer: s.layer, a: s.a, b: s.b } : undefined)

  const out: CadOpeningCandidate[] = []
  const emit = (c: Omit<CadOpeningCandidate, 'id' | 'status' | 'adjacentRoomIds' | 'center' | 'widthFt'> & { widthFt?: number }): void => {
    const center = mid(c.span.a, c.span.b)
    out.push({
      ...c,
      id: `cad-opening:${c.kind}:${center.x.toFixed(3)},${center.y.toFixed(3)}`,
      center,
      widthFt: c.widthFt ?? dist(c.span.a, c.span.b) / k,
      confidence: Math.round(Math.min(0.95, Math.max(0, c.confidence)) * 1000) / 1000,
      adjacentRoomIds: [],
      status: 'review-required'
    })
  }

  for (const ref of parsed.blockReferences ?? []) {
    const nameKind = openingKindFromName(ref.name)
    const layerRole = roleOf(ref.layer)
    const layerKind: CadOpeningKind | undefined = layerRole === 'door' || layerRole === 'window' ? layerRole : undefined
    const kind = nameKind ?? layerKind
    if (!kind) continue
    const children = entities.slice(ref.entityRange[0], ref.entityRange[1])
    const evidence: string[] = [nameKind ? `Block name ${ref.name} suggests a ${nameKind}.` : `Block ${ref.name} sits on a ${layerKind} layer.`]
    let confidence = 0
    let span: { a: P; b: P } | undefined
    let widthFt: number | undefined
    if (layerKind && nameKind && layerKind !== nameKind) {
      evidence.push(`Layer role ${layerKind} disagrees with block name (${nameKind}).`)
      confidence -= 0.15
    } else if (layerKind) confidence += 0.05
    if (layerRole === 'furniture' && nameKind) {
      evidence.push('Layer is classified as furniture.')
      confidence -= 0.15
    }

    if (kind === 'door') {
      const arc = children.filter((e) => isDoorArc(e, k)).sort((a, b) => b.radius! - a.radius!)[0]
      if (arc) {
        const center: P = { x: arc.x!, y: arc.y! }
        const [e1, e2] = arcEnds(arc)
        const leaf = children.find(
          (e) => e.type === 'LINE' && e.points?.length === 2 &&
            (dist({ x: e.x!, y: e.y! }, center) <= 0.05 * k || dist({ x: e.points[0], y: e.points[1] }, center) <= 0.05 * k)
        )
        let closed = e1
        if (leaf) {
          const far = dist({ x: leaf.x!, y: leaf.y! }, center) <= 0.05 * k ? { x: leaf.points![0], y: leaf.points![1] } : { x: leaf.x!, y: leaf.y! }
          closed = dist(e1, far) <= dist(e2, far) ? e2 : e1
          evidence.push('Door leaf line found at the open position.')
        } else {
          const better = [e1, e2].find((e) => nearbyWall(center, e) || gapMatching(center, e))
          closed = better ?? e1
        }
        span = { a: center, b: closed }
        widthFt = arc.radius! / k
        confidence += 0.7
        evidence.push(`~90 degree swing arc with ${(widthFt * 0.3048).toFixed(2)} m leaf (${widthFt.toFixed(2)} ft).`)
      } else {
        const w = Math.max(ref.bounds.maxX - ref.bounds.minX, ref.bounds.maxY - ref.bounds.minY) / k
        const th = (ref.rotationDeg * Math.PI) / 180
        span = { a: ref.insertion, b: { x: ref.insertion.x + Math.cos(th) * w * k, y: ref.insertion.y - Math.sin(th) * w * k } }
        widthFt = w
        confidence += 0.5
        evidence.push('No ~90 degree swing arc with a 0.5-1.5 m leaf found in the block; width taken from block bounds.')
      }
    } else {
      const lines = segmentsOf(children, () => true)
      const set = parallelSets(lines, k)[0]
      if (set) {
        span = { a: set.spanA, b: set.spanB }
        confidence += 0.7
        evidence.push(`${set.lines.length} parallel lines spaced at wall thickness.`)
      } else {
        const w = Math.max(ref.bounds.maxX - ref.bounds.minX, ref.bounds.maxY - ref.bounds.minY)
        const th = (ref.rotationDeg * Math.PI) / 180
        span = { a: ref.insertion, b: { x: ref.insertion.x + Math.cos(th) * w, y: ref.insertion.y - Math.sin(th) * w } }
        confidence += 0.5
        evidence.push('No 2-3 parallel lines at wall thickness found in the block; width taken from block bounds.')
      }
    }
    const gap = gapMatching(span.a, span.b)
    const host = nearbyWall(span.a, span.b)
    if (gap) {
      explained.add(gap)
      confidence += 0.2
      evidence.push(`Spans a ${gap.widthFt.toFixed(2)} ft gap between collinear wall endpoints.`)
    } else if (host) {
      confidence += 0.1
      evidence.push('Lies along a nearby parallel wall segment; no wall gap found.')
    } else evidence.push('No host wall found near the block.')
    const hostSeg = gap?.segP ?? host
    emit({ kind, origin: 'block', span, widthFt, hostWall: hostOf(hostSeg), sourceHandles: [ref.handle], blockName: ref.name, confidence, evidence })
  }

  // Free-standing door arcs (not inside a block) hinged at a wall-gap endpoint.
  entities.forEach((e, i) => {
    if (e.sourceBlock || !isDoorArc(e, k)) return
    const center: P = { x: e.x!, y: e.y! }
    const gap = gaps.find((g) => {
      const hinge = dist(center, g.p) <= 0.5 * k ? g.p : dist(center, g.q) <= 0.5 * k ? g.q : undefined
      return !!hinge && Math.abs(e.radius! / k - g.widthFt) <= 0.15 * g.widthFt
    })
    if (!gap) return
    explained.add(gap)
    const hingeIsP = dist(center, gap.p) <= dist(center, gap.q)
    const span = hingeIsP ? { a: gap.p, b: gap.q } : { a: gap.q, b: gap.p }
    emit({
      kind: 'door', origin: 'arc-in-gap', span, widthFt: gap.widthFt,
      hostWall: hostOf(gap.segP), sourceHandles: [e.handle ?? e.sourceHandle ?? `entity-${i}`],
      confidence: 0.55 + (roleOf(e.layer ?? '0') === 'door' ? 0.05 : 0),
      evidence: [
        `~90 degree arc, radius ${(e.radius! / k).toFixed(2)} ft, hinged at the end of a ${gap.widthFt.toFixed(2)} ft wall gap.`,
        'No door block: symbol is loose geometry, so the match is weaker.'
      ]
    })
  })

  // Window drawn as loose parallel lines on a window-role layer.
  const windowLines = segmentsOf(entities, (e) => !e.sourceBlock && roleOf(e.layer ?? '0') === 'window' && e.type === 'LINE')
  for (const set of parallelSets(windowLines, k)) {
    const span = { a: set.spanA, b: set.spanB }
    const gap = gapMatching(span.a, span.b)
    if (gap) explained.add(gap)
    emit({
      kind: 'window', origin: 'parallel-lines', span, hostWall: hostOf(gap?.segP ?? nearbyWall(span.a, span.b)),
      sourceHandles: set.lines.map((l) => l.handle),
      confidence: 0.6 + (gap ? 0.15 : 0),
      evidence: [`${set.lines.length} parallel lines at wall thickness on a window layer.`, ...(gap ? ['Spans a wall gap.'] : [])]
    })
  }

  for (const gap of gaps) {
    if (explained.has(gap)) continue
    emit({
      kind: 'opening', origin: 'wall-gap', span: { a: gap.p, b: gap.q }, widthFt: gap.widthFt, hostWall: hostOf(gap.segP),
      sourceHandles: [gap.segP.handle, gap.segQ.handle], confidence: 0.35,
      evidence: [`${gap.widthFt.toFixed(2)} ft gap between collinear wall endpoints; no door or window symbol found. May be a door, window or open passage.`]
    })
  }

  // Merge duplicates (e.g. nested blocks) of the same kind at the same place, keeping the strongest.
  const merged: CadOpeningCandidate[] = []
  for (const c of out.sort((a, b) => b.confidence - a.confidence)) {
    const dup = merged.find((m) => m.kind === c.kind && dist(m.center, c.center) <= 0.5 * k)
    if (dup) dup.sourceHandles = [...new Set([...dup.sourceHandles, ...c.sourceHandles])]
    else merged.push(c)
  }

  for (const c of merged) {
    if (!options.rooms?.length) break
    const u = unit(c.span.a, c.span.b), n: P = { x: -u.y, y: u.x }, ids = new Set<string>()
    for (const sign of [-1, 1])
      for (const d of [1, 2.5]) {
        const x = c.center.x + sign * n.x * d * k, y = c.center.y + sign * n.y * d * k
        for (const room of options.rooms) if (isPointInPolygon(x, y, room.polygon)) ids.add(room.id)
      }
    c.adjacentRoomIds = [...ids].sort()
    if (c.adjacentRoomIds.length) c.evidence.push(`Adjacent room candidate(s): ${c.adjacentRoomIds.length}.`)
  }
  return { candidates: merged.sort((a, b) => a.id.localeCompare(b.id)), diagnostics }
}
