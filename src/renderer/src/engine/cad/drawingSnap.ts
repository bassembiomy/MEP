import type { DxfEntity, ProjectMetadata, Zone } from '../../store/projectStore'
import { atLevel } from './elevation'

/** Pure object/grid snapping for the drawing canvas. Coordinates are drawing units (canvas frame). */
export type SnapKind = 'endpoint' | 'midpoint' | 'intersection' | 'perpendicular' | 'grid' | 'none'
export interface SnapPoint { x: number; y: number }
export interface SnapResult { point: SnapPoint; kind: SnapKind; sourceHandle?: string }
export interface SnapOptions {
  entities?: DxfEntity[]
  zones?: Zone[]
  /** Drawing units; use physicalGridSpacing(project). 0/undefined disables grid snapping. */
  gridSpacing?: number
  /** Pick radius in screen pixels. */
  tolerancePx?: number
  /** Konva stage scale (pixels per drawing unit). */
  stageScale: number
  ortho?: boolean
  lastPoint?: SnapPoint
  /** Only entities at this elevation snap (default 0). */
  level?: number
}

/** project.scale is drawing units per foot (imperial) or per metre (metric). Grid is 0.5 ft or 100 mm, in drawing units. */
export function physicalGridSpacing(project: Pick<ProjectMetadata, 'units' | 'scale'>): number {
  const scale = project.scale
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Project scale must be positive to derive a grid spacing.')
  return project.units === 'metric' ? 0.1 * scale : 0.5 * scale
}
interface Seg { ax: number; ay: number; bx: number; by: number; bulge: number; handle?: string }
interface Source { segs: Seg[]; vertices: SnapPoint[]; handle?: string; minX: number; minY: number; maxX: number; maxY: number }

const cache = new WeakMap<object, Source | null>()
function sourceOfPath(points: number[], bulges: number[] | undefined, closed: boolean, handle?: string): Source | null {
  const n = Math.floor(points.length / 2)
  if (n < 2 || points.some(v => !Number.isFinite(v))) return null
  const segs: Seg[] = [], vertices: SnapPoint[] = []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const x = points[2 * i], y = points[2 * i + 1]
    vertices.push({ x, y })
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const count = closed ? n : n - 1
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n, b = bulges?.[i] ?? 0
    segs.push({ ax: points[2 * i], ay: points[2 * i + 1], bx: points[2 * j], by: points[2 * j + 1], bulge: Number.isFinite(b) ? b : 0, handle })
    if (b) { // arc bulge can leave the vertex box by at most |b|*chord/2
      const r = Math.abs(b) * Math.hypot(points[2 * j] - points[2 * i], points[2 * j + 1] - points[2 * i + 1]) / 2
      minX -= r; minY -= r; maxX += r; maxY += r
    }
  }
  return { segs, vertices, handle, minX, minY, maxX, maxY }
}
function sourceOfEntity(e: DxfEntity): Source | null {
  if (cache.has(e)) return cache.get(e)!
  const handle = e.sourceHandle ?? e.handle
  let s: Source | null = null
  if (e.type === 'LINE' && e.points && e.points.length >= 2 && [e.x, e.y].every(v => Number.isFinite(v))) s = sourceOfPath([e.x!, e.y!, e.points[0], e.points[1]], undefined, false, handle)
  else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.points) s = sourceOfPath(e.points, e.bulges, !!e.closed, handle)
  else if (e.type === 'ARC' && [e.x, e.y, e.radius, e.startAngleDeg, e.endAngleDeg].every(v => Number.isFinite(v))) {
    // Endpoints only (CAD frame already y-flipped by the parser: angles measured in canvas orientation).
    const r = e.radius!, a0 = e.startAngleDeg! * Math.PI / 180, a1 = e.endAngleDeg! * Math.PI / 180
    const p0 = { x: e.x! + r * Math.cos(a0), y: e.y! - r * Math.sin(a0) }, p1 = { x: e.x! + r * Math.cos(a1), y: e.y! - r * Math.sin(a1) }
    s = { segs: [], vertices: [p0, p1], handle, minX: e.x! - r, maxX: e.x! + r, minY: e.y! - r, maxY: e.y! + r }
  }
  cache.set(e, s)
  return s
}
const zoneCache = new WeakMap<Zone, { points: number[]; source: Source | null }>()
function sourceOfZone(z: Zone): Source | null {
  const c = zoneCache.get(z)
  if (c && c.points === z.points) return c.source
  const source = sourceOfPath(z.points, undefined, true, z.id)
  zoneCache.set(z, { points: z.points, source })
  return source
}

function arcMid(s: Seg): SnapPoint {
  const dx = s.bx - s.ax, dy = s.by - s.ay, len = Math.hypot(dx, dy)
  const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2
  if (!s.bulge || len === 0) return { x: mx, y: my }
  const sag = s.bulge * len / 2
  return { x: mx - dy / len * sag, y: my + dx / len * sag }
}
function intersect(a: Seg, b: Seg): SnapPoint | null {
  const rx = a.bx - a.ax, ry = a.by - a.ay, sx = b.bx - b.ax, sy = b.by - b.ay
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-12 * Math.max(1, Math.hypot(rx, ry) * Math.hypot(sx, sy))) return null
  const t = ((b.ax - a.ax) * sy - (b.ay - a.ay) * sx) / den, u = ((b.ax - a.ax) * ry - (b.ay - a.ay) * rx) / den
  const eps = 1e-9
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null
  return { x: a.ax + t * rx, y: a.ay + t * ry }
}
function foot(p: SnapPoint, s: Seg): SnapPoint | null {
  const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy
  if (l2 === 0) return null
  const t = ((p.x - s.ax) * dx + (p.y - s.ay) * dy) / l2
  if (t <= 1e-9 || t >= 1 - 1e-9) return null
  return { x: s.ax + t * dx, y: s.ay + t * dy }
}
function distToSeg(px: number, py: number, s: Seg): number {
  const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / l2))
  return Math.hypot(px - (s.ax + t * dx), py - (s.ay + t * dy))
}

const MAX_NEAR_SEGMENTS = 48

export function snapPoint(cursor: SnapPoint, o: SnapOptions): SnapResult {
  if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return { point: cursor, kind: 'none' }
  const tol = (o.tolerancePx ?? 10) / Math.max(o.stageScale, 1e-9)
  let cx = cursor.x, cy = cursor.y
  const last = o.lastPoint
  let axis: 'x' | 'y' | null = null
  if (o.ortho && last) { // lock to the dominant axis from lastPoint
    if (Math.abs(cx - last.x) >= Math.abs(cy - last.y)) { axis = 'x'; cy = last.y } else { axis = 'y'; cx = last.x }
  }
  // Under ortho, object snaps must lie on the locked line (within tolerance) and are projected onto it.
  const accept = (p: SnapPoint): SnapPoint | null => {
    if (axis === 'x') return Math.abs(p.y - last!.y) <= tol ? { x: p.x, y: last!.y } : null
    if (axis === 'y') return Math.abs(p.x - last!.x) <= tol ? { x: last!.x, y: p.y } : null
    return p
  }
  const sources: Source[] = []
  const level = o.level ?? 0
  const x0 = cx - tol, x1 = cx + tol, y0 = cy - tol, y1 = cy + tol
  const consider = (s: Source | null) => {
    if (s && s.maxX >= x0 && s.minX <= x1 && s.maxY >= y0 && s.minY <= y1) sources.push(s)
  }
  for (const e of o.entities ?? []) { if (atLevel(e, level)) consider(sourceOfEntity(e)) }
  for (const z of o.zones ?? []) consider(sourceOfZone(z))

  let best: { d: number; p: SnapPoint; kind: SnapKind; h?: string } | null = null
  const rank: Record<SnapKind, number> = { endpoint: 0, intersection: 1, midpoint: 2, perpendicular: 3, grid: 4, none: 5 }
  const offer = (p0: SnapPoint, kind: SnapKind, h?: string) => {
    const p = accept(p0); if (!p) return
    const d = Math.hypot(p.x - cx, p.y - cy)
    if (d > tol) return
    if (!best || rank[kind] < rank[best.kind] || (rank[kind] === rank[best.kind] && d < best.d)) best = { d, p, kind, h }
  }
  const near: Seg[] = []
  for (const s of sources) {
    for (const v of s.vertices) offer(v, 'endpoint', s.handle)
    for (const g of s.segs) {
      if (g.bulge) { offer(arcMid(g), 'midpoint', g.handle); continue }
      offer({ x: (g.ax + g.bx) / 2, y: (g.ay + g.by) / 2 }, 'midpoint', g.handle)
      if (distToSeg(cx, cy, g) <= tol) {
        if (near.length < MAX_NEAR_SEGMENTS) near.push(g)
        if (last) { const f = foot(last, g); if (f) offer(f, 'perpendicular', g.handle) }
      }
    }
  }
  for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
    const p = intersect(near[i], near[j]); if (p) offer(p, 'intersection', near[i].handle ?? near[j].handle)
  }
  if (best) { const b = best as { p: SnapPoint; kind: SnapKind; h?: string }; return { point: b.p, kind: b.kind, sourceHandle: b.h } }
  const g = o.gridSpacing
  if (g && g > 0 && Number.isFinite(g)) {
    const point = axis === 'x' ? { x: Math.round(cx / g) * g, y: cy } : axis === 'y' ? { x: cx, y: Math.round(cy / g) * g } : { x: Math.round(cx / g) * g, y: Math.round(cy / g) * g }
    return { point, kind: 'grid' }
  }
  return { point: { x: cx, y: cy }, kind: 'none' }
}
