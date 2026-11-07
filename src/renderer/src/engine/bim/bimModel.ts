/**
 * BimModel utilities: merging discipline models into one MEP model and geometric clash detection.
 */
import type { BimElement, BimModel, BimSystem, ClashResult, Vec3 } from './bimTypes'

// ───────────────────────────── merge ─────────────────────────────

/**
 * Union of models: storeys by id (the same id must have the same elevation), systems and elements concatenated.
 * Colliding system ids / element keys are prefixed with the originating model's discipline.
 */
export function mergeBimModels(models: BimModel[], discipline: string): BimModel {
  if (models.length === 0) throw new Error('mergeBimModels: no models')
  const storeys = new Map<string, BimModel['storeys'][number]>()
  const systems: BimSystem[] = []
  const elements: BimElement[] = []
  const warnings: string[] = []
  const sysIds = new Set<string>()
  const keys = new Set<string>()
  const slug = (s: string): string => s.replace(/\s+/g, '')

  for (const m of models) {
    for (const st of m.storeys) {
      const have = storeys.get(st.id)
      if (have && Math.abs(have.elevationMm - st.elevationMm) > 0.5) {
        throw new Error(
          `mergeBimModels: storey ${st.id} has elevation ${have.elevationMm} mm and ${st.elevationMm} mm (${m.discipline})`
        )
      }
      if (!have) storeys.set(st.id, { ...st })
    }
    const sysMap = new Map<string, string>()
    for (const sys of m.systems) {
      let id = sys.id
      if (sysIds.has(id)) id = `${slug(m.discipline)}-${sys.id}`
      let n = 1
      while (sysIds.has(id)) id = `${slug(m.discipline)}-${sys.id}-${n++}`
      sysIds.add(id)
      sysMap.set(sys.id, id)
      systems.push({ ...sys, id })
    }
    for (const el of m.elements) {
      let key = el.key
      if (keys.has(key)) key = `${slug(m.discipline)}:${el.key}`
      let n = 1
      while (keys.has(key)) key = `${slug(m.discipline)}:${el.key}:${n++}`
      keys.add(key)
      elements.push({ ...el, key, systemId: sysMap.get(el.systemId) ?? el.systemId })
    }
    for (const w of m.warnings) warnings.push(models.length > 1 ? `[${m.discipline}] ${w}` : w)
  }
  return {
    projectName: models[0].projectName,
    projectNumber: models[0].projectNumber,
    discipline,
    storeys: [...storeys.values()].sort((a, b) => a.elevationMm - b.elevationMm),
    systems,
    elements,
    warnings
  }
}

// ───────────────────────────── clash detection ─────────────────────────────

interface Capsule {
  type: 'capsule'
  a: Vec3
  b: Vec3
  r: number
}
interface Obb {
  type: 'obb'
  c: Vec3
  /** half extents along the box axes (x', y', z) */
  h: Vec3
  cos: number
  sin: number
}
type Envelope = Capsule | Obb

interface Item {
  el: BimElement
  env: Envelope
  min: Vec3
  max: Vec3
}

function envelopeOf(el: BimElement): Envelope {
  const g = el.geometry
  if (g.kind === 'segment') {
    const r =
      g.profile.shape === 'circle'
        ? g.profile.diameterMm / 2
        : Math.hypot(g.profile.widthMm, g.profile.heightMm) / 2
    return { type: 'capsule', a: g.start, b: g.end, r }
  }
  if (g.kind === 'box') {
    const a = (g.rotationDeg * Math.PI) / 180
    return {
      type: 'obb',
      c: [g.origin[0], g.origin[1], g.origin[2] + g.sizeMm[2] / 2],
      h: [g.sizeMm[0] / 2, g.sizeMm[1] / 2, g.sizeMm[2] / 2],
      cos: Math.cos(a),
      sin: Math.sin(a)
    }
  }
  // vertical cylinder → axis-aligned box
  const r = g.diameterMm / 2
  return {
    type: 'obb',
    c: [g.base[0], g.base[1], g.base[2] + g.heightMm / 2],
    h: [r, r, g.heightMm / 2],
    cos: 1,
    sin: 0
  }
}

function aabbOf(e: Envelope): { min: Vec3; max: Vec3 } {
  if (e.type === 'capsule') {
    return {
      min: [
        Math.min(e.a[0], e.b[0]) - e.r,
        Math.min(e.a[1], e.b[1]) - e.r,
        Math.min(e.a[2], e.b[2]) - e.r
      ],
      max: [
        Math.max(e.a[0], e.b[0]) + e.r,
        Math.max(e.a[1], e.b[1]) + e.r,
        Math.max(e.a[2], e.b[2]) + e.r
      ]
    }
  }
  const ex = Math.abs(e.cos) * e.h[0] + Math.abs(e.sin) * e.h[1]
  const ey = Math.abs(e.sin) * e.h[0] + Math.abs(e.cos) * e.h[1]
  return {
    min: [e.c[0] - ex, e.c[1] - ey, e.c[2] - e.h[2]],
    max: [e.c[0] + ex, e.c[1] + ey, e.c[2] + e.h[2]]
  }
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sb = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const ad = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sc = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]

/** Closest points between two segments (Ericson, Real-Time Collision Detection 5.1.9). */
function segSeg(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): { c1: Vec3; c2: Vec3; dist: number } {
  const d1 = sb(q1, p1)
  const d2 = sb(q2, p2)
  const r = sb(p1, p2)
  const a = dot(d1, d1)
  const e = dot(d2, d2)
  const f = dot(d2, r)
  const EPS = 1e-12
  let s: number
  let t: number
  const clamp = (v: number): number => Math.max(0, Math.min(1, v))
  if (a <= EPS && e <= EPS) {
    s = t = 0
  } else if (a <= EPS) {
    s = 0
    t = clamp(f / e)
  } else {
    const c = dot(d1, r)
    if (e <= EPS) {
      t = 0
      s = clamp(-c / a)
    } else {
      const b = dot(d1, d2)
      const denom = a * e - b * b
      s = denom > EPS ? clamp((b * f - c * e) / denom) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = clamp(-c / a)
      } else if (t > 1) {
        t = 1
        s = clamp((b - c) / a)
      }
    }
  }
  const c1 = ad(p1, sc(d1, s))
  const c2 = ad(p2, sc(d2, t))
  const d = sb(c1, c2)
  return { c1, c2, dist: Math.hypot(d[0], d[1], d[2]) }
}

/** Distance from a point to an OBB (0 inside) and the closest point on the box. */
function pointBox(p: Vec3, o: Obb): { dist: number; q: Vec3 } {
  const dx = p[0] - o.c[0]
  const dy = p[1] - o.c[1]
  const lx = dx * o.cos + dy * o.sin
  const ly = -dx * o.sin + dy * o.cos
  const lz = p[2] - o.c[2]
  const cx = Math.max(-o.h[0], Math.min(o.h[0], lx))
  const cy = Math.max(-o.h[1], Math.min(o.h[1], ly))
  const cz = Math.max(-o.h[2], Math.min(o.h[2], lz))
  const dist = Math.hypot(lx - cx, ly - cy, lz - cz)
  const q: Vec3 = [o.c[0] + cx * o.cos - cy * o.sin, o.c[1] + cx * o.sin + cy * o.cos, o.c[2] + cz]
  return { dist, q }
}

/** Capsule vs OBB: the distance from the centre-line to the box is convex along the segment → ternary search. */
function capsuleBox(cap: Capsule, o: Obb): { clearance: number; point: Vec3 } {
  const at = (t: number): Vec3 => ad(cap.a, sc(sb(cap.b, cap.a), t))
  let lo = 0
  let hi = 1
  for (let i = 0; i < 60; i++) {
    const m1 = lo + (hi - lo) / 3
    const m2 = hi - (hi - lo) / 3
    if (pointBox(at(m1), o).dist < pointBox(at(m2), o).dist) hi = m2
    else lo = m1
  }
  const p = at((lo + hi) / 2)
  const { dist, q } = pointBox(p, o)
  if (dist > 0)
    return {
      clearance: dist - cap.r,
      point: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]
    }
  // centre-line inside the box: interference at least the radius plus the depth to the nearest face
  const dx = p[0] - o.c[0]
  const dy = p[1] - o.c[1]
  const lx = dx * o.cos + dy * o.sin
  const ly = -dx * o.sin + dy * o.cos
  const depth = Math.min(
    o.h[0] - Math.abs(lx),
    o.h[1] - Math.abs(ly),
    o.h[2] - Math.abs(p[2] - o.c[2])
  )
  return { clearance: -(cap.r + depth), point: p }
}

/** OBB vs OBB (both rotated about z): signed gap = max over the 5 separating axes (negative = penetration depth). */
function boxBox(a: Obb, b: Obb): { clearance: number; point: Vec3 } {
  const d = sb(b.c, a.c)
  const axes: [number, number][] = [
    [a.cos, a.sin],
    [-a.sin, a.cos],
    [b.cos, b.sin],
    [-b.sin, b.cos]
  ]
  const radius = (o: Obb, ax: [number, number]): number =>
    o.h[0] * Math.abs(ax[0] * o.cos + ax[1] * o.sin) +
    o.h[1] * Math.abs(-ax[0] * o.sin + ax[1] * o.cos)
  let gap = Math.abs(d[2]) - (a.h[2] + b.h[2])
  for (const ax of axes) {
    const g = Math.abs(d[0] * ax[0] + d[1] * ax[1]) - (radius(a, ax) + radius(b, ax))
    if (g > gap) gap = g
  }
  return {
    clearance: gap,
    point: [(a.c[0] + b.c[0]) / 2, (a.c[1] + b.c[1]) / 2, (a.c[2] + b.c[2]) / 2]
  }
}

function clearanceOf(a: Envelope, b: Envelope): { clearance: number; point: Vec3 } {
  if (a.type === 'capsule' && b.type === 'capsule') {
    const r = segSeg(a.a, a.b, b.a, b.b)
    return {
      clearance: r.dist - a.r - b.r,
      point: [(r.c1[0] + r.c2[0]) / 2, (r.c1[1] + r.c2[1]) / 2, (r.c1[2] + r.c2[2]) / 2]
    }
  }
  if (a.type === 'capsule' && b.type === 'obb') return capsuleBox(a, b)
  if (a.type === 'obb' && b.type === 'capsule') return capsuleBox(b, a)
  return boxBox(a as Obb, b as Obb)
}

const near3 = (a: Vec3, b: Vec3): boolean =>
  Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) < 1 && Math.abs(a[2] - b[2]) < 1

/** Two linear elements that meet end to end are connected (a fitting), not a clash. */
function connected(a: BimElement, b: BimElement): boolean {
  if (a.geometry.kind !== 'segment' || b.geometry.kind !== 'segment') return false
  const ea = [a.geometry.start, a.geometry.end]
  const eb = [b.geometry.start, b.geometry.end]
  return ea.some((p) => eb.some((q) => near3(p, q)))
}

const isDuct = (e: BimElement): boolean =>
  e.ifcClass === 'IfcDuctSegment' || e.ifcClass === 'IfcDuctFitting'
const isPipe = (e: BimElement): boolean =>
  e.ifcClass === 'IfcPipeSegment' || e.ifcClass === 'IfcPipeFitting'

/**
 * Clearance between the envelopes of elements of different systems (and ducts vs pipes), geometry in absolute
 * coordinates. Envelopes: segment → capsule (radius = half diagonal for rectangles), box / cylinder → box.
 * Reports every pair with clearance < toleranceMm (negative = interference), closest first.
 */
export function detectClashes(model: BimModel, opts: { toleranceMm: number }): ClashResult[] {
  const tol = opts.toleranceMm
  const items: Item[] = model.elements.map((el) => {
    const env = envelopeOf(el)
    return { el, env, ...aabbOf(env) }
  })
  items.sort((p, q) => p.min[0] - q.min[0])
  const out: ClashResult[] = []
  for (let i = 0; i < items.length; i++) {
    const A = items[i]
    for (let j = i + 1; j < items.length; j++) {
      const B = items[j]
      if (B.min[0] > A.max[0] + tol) break
      if (A.min[1] > B.max[1] + tol || B.min[1] > A.max[1] + tol) continue
      if (A.min[2] > B.max[2] + tol || B.min[2] > A.max[2] + tol) continue
      const sameSystem = A.el.systemId === B.el.systemId
      if (sameSystem && !((isDuct(A.el) && isPipe(B.el)) || (isPipe(A.el) && isDuct(B.el))))
        continue
      if (connected(A.el, B.el)) continue
      const { clearance, point } = clearanceOf(A.env, B.env)
      if (clearance < tol) {
        out.push({
          a: A.el.tag,
          b: B.el.tag,
          storeyId: A.el.storeyId,
          clearanceMm: clearance,
          point
        })
      }
    }
  }
  return out.sort((p, q) => p.clearanceMm - q.clearanceMm)
}
