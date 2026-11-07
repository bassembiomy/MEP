/**
 * Sprinkler layout around obstructions (NFPA 13-2019 §10.2.7) for one room: the room's uniform grid is re-spaced so
 * that no ceiling sprinkler is obstructed, wide obstructions get sprinklers below them, and per-head protection areas
 * S × L are measured (NFPA 13-2019 §10.2.4.1.1).
 *
 * Coordinates: u along the branch lines (rows), v across them (row coordinate). Relocation is a 1-D re-spacing solver
 * on a 50 mm grid: per row along u, or on the row coordinates v for obstructions parallel to the branch lines.
 */
import { MIN_SPRINKLER_SPACING_MM, MIN_WALL_DISTANCE_MM } from './nfpa13Sprinkler'
import type { ObstructionGeom } from './obstructions'
import { distanceToPolygonEdges, pointInPolygon, polygonArea } from './roomDetection'

type Pt = [number, number]

const GRID_MM = 50
const EPS = 1e-6
/** Clearance tolerance, mm (a sprinkler is obstructed when closer than required − 0.5 mm). */
const TOL_MM = 0.5
/** Extra sprinklers tried per row / bay beyond the current count. */
const MAX_EXTRA = 3
const MM_PER_FT = 304.8

export interface HeadRec {
  id: number
  u: number
  v: number
  u0: number
  v0: number
  added: boolean
}

export interface RoomObsParams {
  /** Room polygon, mm, floor coordinates. */
  polygon: Pt[]
  /** Row direction (u axis): the branch direction, or the wall direction for sidewall sprinklers. */
  axis: 'x' | 'y'
  /** Grid sprinklers of the room layout, floor coordinates. */
  points: Pt[]
  /** Maximum spacing and protection area of the room's sprinklers. */
  maxSpacingMm: number
  maxAreaMm2: number
  /** Sidewall layout: rows are fixed on the wall lines and the across dimension is the throw. */
  sidewall?: { throwMm: number }
  obstructions: ObstructionGeom[]
  nextId: () => number
}

export interface PlacedHeadPlan {
  id: number
  x: number
  y: number
  S: number
  L: number
  relocatedMm?: number
}

export interface BelowHeadPlan {
  x: number
  y: number
  S: number
  L: number
  obstructionId: string
}

export interface RoomObsResult {
  /** Any ceiling sprinkler of the room moved or was added. */
  modified: boolean
  heads: PlacedHeadPlan[]
  below: BelowHeadPlan[]
  /** Obstruction id → ids of the ceiling sprinklers it moved / number added / unsolved layout notes. */
  movedBy: Map<string, number[]>
  addedBy: Map<string, number>
  notes: Map<string, string[]>
  /** Largest S and L of the ceiling sprinklers, mm. */
  S: number
  L: number
}

interface UVObs {
  g: ObstructionGeom
  uLo: number
  uHi: number
  vLo: number
  vHi: number
  /** Distance required from a ceiling sprinkler (wall: 102 mm). */
  req: number
  /** Continuous obstruction parallel to the branch lines (row coordinates are re-spaced). */
  parallel: boolean
}

/** Intervals of a polygon along the first coordinate at second coordinate c (ray crossings, sorted). */
export function scanIntervals(poly: Pt[], c: number): [number, number][] {
  const xs: number[] = []
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > c !== yj > c) xs.push(((xj - xi) * (c - yi)) / (yj - yi) + xi)
  }
  xs.sort((a, b) => a - b)
  const out: [number, number][] = []
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]])
  return out
}

// ─────────────────────────── 1-D re-spacing solver ───────────────────────────

/**
 * Place m positions in the bay [lo, hi] on the 50 mm grid: first / last ≤ smax/2 and ≥ 102 mm from the bay ends, gaps in
 * [1829, smax], not inside a forbidden open interval; minimises the sum of squared deviations from `refs`.
 */
function dpPlace(
  cand: number[],
  m: number,
  refs: number[],
  lo: number,
  hi: number,
  smax: number
): number[] | null {
  const N = cand.length
  if (N === 0 || m < 1) return null
  const INF = Infinity
  const cost = new Float64Array(m * N).fill(INF)
  const par = new Int32Array(m * N).fill(-1)
  for (let j = 0; j < N; j++) if (cand[j] <= lo + smax / 2 + EPS) cost[j] = (cand[j] - refs[0]) ** 2
  for (let i = 1; i < m; i++) {
    let a = 0 // first j' with cand[j'] ≥ cand[j] − smax
    let b = 0 // number of j' with cand[j'] ≤ cand[j] − min spacing
    for (let j = 0; j < N; j++) {
      while (a < N && cand[a] < cand[j] - smax - EPS) a++
      while (b < N && cand[b] <= cand[j] - MIN_SPRINKLER_SPACING_MM + EPS) b++
      let best = INF
      let bp = -1
      for (let q = a; q < b; q++) {
        const c = cost[(i - 1) * N + q]
        if (c < best) {
          best = c
          bp = q
        }
      }
      if (bp >= 0) {
        cost[i * N + j] = best + (cand[j] - refs[i]) ** 2
        par[i * N + j] = bp
      }
    }
  }
  let bestJ = -1
  let bestC = INF
  for (let j = 0; j < N; j++) {
    if (cand[j] < hi - smax / 2 - EPS) continue
    const c = cost[(m - 1) * N + j]
    if (c < bestC) {
      bestC = c
      bestJ = j
    }
  }
  if (bestJ < 0) return null
  const out: number[] = new Array<number>(m)
  let j = bestJ
  for (let i = m - 1; i >= 0; i--) {
    out[i] = cand[j]
    j = par[i * N + j]
  }
  return out
}

/**
 * Re-space the sprinklers of one bay [lo, hi]; `old` are the current positions in the bay. The count starts at the
 * current count (or the minimum for the bay length) and grows by up to 3.
 */
function solveBay(
  lo: number,
  hi: number,
  old: number[],
  required: boolean,
  smax: number,
  forbids: [number, number][],
  okPoint: (u: number) => boolean
): number[] | null {
  const len = hi - lo
  if (len < 2 * MIN_WALL_DISTANCE_MM) return []
  if (old.length === 0 && !required) return []
  const cLo = lo + MIN_WALL_DISTANCE_MM - EPS
  const cHi = hi - MIN_WALL_DISTANCE_MM + EPS
  const raw: number[] = []
  for (let c = Math.ceil(cLo / GRID_MM) * GRID_MM; c <= cHi; c += GRID_MM) raw.push(c)
  for (const o of old) if (o >= cLo && o <= cHi) raw.push(o)
  raw.sort((a, b) => a - b)
  const cand: number[] = []
  for (const c of raw) {
    if (cand.length && c - cand[cand.length - 1] < EPS) continue
    if (forbids.some(([a, b]) => c > a && c < b)) continue
    if (!okPoint(c)) continue
    cand.push(c)
  }
  const sorted = [...old].sort((a, b) => a - b)
  const mMin = Math.max(sorted.length, Math.ceil(len / smax - 1e-9), 1)
  for (let m = mMin; m <= mMin + MAX_EXTRA; m++) {
    const refs =
      m === sorted.length ? sorted : Array.from({ length: m }, (_, i) => lo + ((i + 0.5) * len) / m)
    const r = dpPlace(cand, m, refs, lo, hi, smax)
    if (r) return r
  }
  return null
}

/** Order-preserving matching of the smaller list onto the larger one minimising squared distances. */
function matchOrdered(a: number[], b: number[]): [number, number][] {
  const swap = a.length > b.length
  const s = swap ? b : a // smaller (fully matched)
  const l = swap ? a : b
  const n = s.length
  const m = l.length
  if (n === 0) return []
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(Infinity)
  )
  for (let j = 0; j <= m; j++) dp[0][j] = 0
  for (let i = 1; i <= n; i++)
    for (let j = i; j <= m; j++) {
      const take = dp[i - 1][j - 1] + (s[i - 1] - l[j - 1]) ** 2
      dp[i][j] = Math.min(dp[i][j - 1], take)
    }
  const pairs: [number, number][] = []
  let i = n
  let j = m
  while (i > 0) {
    if (j > i && dp[i][j] === dp[i][j - 1]) j--
    else {
      pairs.push(swap ? [j - 1, i - 1] : [i - 1, j - 1])
      i--
      j--
    }
  }
  return pairs.reverse()
}

// ─────────────────────────── Room processing ───────────────────────────

/**
 * Obstructions whose footprint divides the area into bays: walls (deep beams) and wide obstructions, under which
 * sprinklers are installed — the ceiling sprinklers on each side are laid out as if the footprint were a wall.
 */
function isCut(o: { g: ObstructionGeom }): boolean {
  return o.g.wall || o.g.rule === 'wide'
}

/** Intervals minus the cuts; a bay that touches a cut is flagged (a compartment of its own, it needs sprinklers). */
function cutInterval(
  intervals: [number, number][],
  cutsIn: [number, number][]
): { lo: number; hi: number; cut: boolean }[] {
  const cuts = [...cutsIn].sort((a, b) => a[0] - b[0])
  const out: { lo: number; hi: number; cut: boolean }[] = []
  for (const [a, b] of intervals) {
    let cur = a
    for (const [c0, c1] of cuts) {
      if (c1 <= cur || c0 >= b) continue
      if (c0 > cur) out.push({ lo: cur, hi: c0, cut: false })
      cur = Math.max(cur, c1)
    }
    if (cur < b) out.push({ lo: cur, hi: b, cut: false })
  }
  for (const bay of out)
    bay.cut = cuts.some(([c0, c1]) => Math.abs(c1 - bay.lo) < EPS || Math.abs(c0 - bay.hi) < EPS)
  return out
}

export function layoutRoomObstructions(p: RoomObsParams): RoomObsResult {
  const swap = p.axis === 'y'
  const toUV = ([x, y]: Pt): Pt => (swap ? [y, x] : [x, y])
  const poly = p.polygon.map(toUV)
  const polyT = poly.map(([a, b]) => [b, a] as Pt) // scan along v at fixed u
  let uMin = Infinity
  let uMax = -Infinity
  let vMin = Infinity
  let vMax = -Infinity
  for (const [u, v] of poly) {
    uMin = Math.min(uMin, u)
    uMax = Math.max(uMax, u)
    vMin = Math.min(vMin, v)
    vMax = Math.max(vMax, v)
  }
  const rect =
    Math.abs(polygonArea(poly) - (uMax - uMin) * (vMax - vMin)) <=
    1e-6 * (uMax - uMin) * (vMax - vMin) + 1
  const fixedRows = !!p.sidewall

  // obstructions in (u, v), those touching the room only; row-coordinate (parallel) ones first
  const all: UVObs[] = []
  for (const g of p.obstructions) {
    if (g.inactive) continue
    const [uA, vA] = toUV([g.xLo, g.yLo])
    const [uB, vB] = toUV([g.xHi, g.yHi])
    const req = g.wall ? MIN_WALL_DISTANCE_MM : g.requiredClearanceMm
    const o: UVObs = {
      g,
      uLo: Math.min(uA, uB),
      uHi: Math.max(uA, uB),
      vLo: Math.min(vA, vB),
      vHi: Math.max(vA, vB),
      req,
      parallel: false
    }
    if (o.uLo - req >= uMax || o.uHi + req <= uMin || o.vLo - req >= vMax || o.vHi + req <= vMin)
      continue
    const continuous = g.rule === 'beam' || g.rule === 'wide' || g.rule === 'wall'
    o.parallel = continuous && !fixedRows && rect && o.uHi - o.uLo > o.vHi - o.vLo + EPS
    all.push(o)
  }
  const order = [...all.filter((o) => o.parallel), ...all.filter((o) => !o.parallel)]

  const recs: HeadRec[] = p.points.map((pt) => {
    const [u, v] = toUV(pt)
    return { id: p.nextId(), u, v, u0: u, v0: v, added: false }
  })
  const movedBy = new Map<string, number[]>()
  const addedBy = new Map<string, number>()
  const notes = new Map<string, string[]>()
  const note = (id: string, text: string): void => {
    if (!notes.has(id)) notes.set(id, [])
    if (!notes.get(id)!.includes(text)) notes.get(id)!.push(text)
  }
  const processed: UVObs[] = []

  const rowsOf = (): { v: number; heads: HeadRec[] }[] => {
    const sorted = [...recs].sort((a, b) => a.v - b.v || a.u - b.u)
    const rows: { v: number; heads: HeadRec[] }[] = []
    for (const h of sorted) {
      const last = rows[rows.length - 1]
      if (last && Math.abs(h.v - last.heads[0].v) <= 1) last.heads.push(h)
      else rows.push({ v: h.v, heads: [h] })
    }
    for (const r of rows) r.heads.sort((a, b) => a.u - b.u)
    return rows
  }

  /** Bays of the row line at v: room intervals cut by the wall obstructions crossing the row. */
  const baysAtRow = (v: number): { lo: number; hi: number; cut: boolean }[] => {
    const cuts = processed
      .filter((o) => isCut(o) && v > o.vLo + TOL_MM && v < o.vHi - TOL_MM)
      .map((o) => [o.uLo, o.uHi] as [number, number])
    return cutInterval(scanIntervals(poly, v), cuts)
  }

  /** Forbidden u intervals on the row line at v (beam / three-times clearance zones; wall faces near the row). */
  const zonesAtRow = (v: number): [number, number][] => {
    const out: [number, number][] = []
    for (const o of processed) {
      const dv = Math.max(o.vLo - v, 0, v - o.vHi)
      if (o.g.wall && dv === 0 && v > o.vLo + TOL_MM && v < o.vHi - TOL_MM) continue // cut into bays
      if (dv >= o.req - TOL_MM) continue
      const w = Math.sqrt(o.req * o.req - dv * dv)
      const a = o.uLo - w + TOL_MM
      const b = o.uHi + w - TOL_MM
      if (b > a) out.push([a, b])
    }
    return out
  }

  /** S and L of every sprinkler (NFPA 13 §10.2.4.1.1): the larger of the distances to the neighbours; 2 × wall for ends. */
  const protection = (): Map<number, { S: number; L: number }> => {
    const res = new Map<number, { S: number; L: number }>()
    const rows = rowsOf()
    const rowVs = rows.map((r) => r.v)
    for (const row of rows) {
      const bays = baysAtRow(row.v)
      for (const h of row.heads) {
        let bay = bays.find((b) => h.u >= b.lo - EPS && h.u <= b.hi + EPS)
        if (!bay) bay = bays[0] ?? { lo: uMin, hi: uMax, cut: false }
        const inBay = row.heads.filter((q) => q.u >= bay!.lo - EPS && q.u <= bay!.hi + EPS)
        const k = inBay.indexOf(h)
        const prev = k > 0 ? h.u - inBay[k - 1].u : 2 * (h.u - bay.lo)
        const next = k < inBay.length - 1 ? inBay[k + 1].u - h.u : 2 * (bay.hi - h.u)
        const S = Math.max(prev, next)
        let L: number
        if (p.sidewall) L = p.sidewall.throwMm
        else {
          // across: column bay at u, cut by the wall obstructions crossing the column
          const cuts = processed
            .filter((o) => isCut(o) && h.u > o.uLo + TOL_MM && h.u < o.uHi - TOL_MM)
            .map((o) => [o.vLo, o.vHi] as [number, number])
            .sort((a, b) => a[0] - b[0])
          let cLo = vMin
          let cHi = vMax
          const ints = scanIntervals(polyT, h.u).filter(
            (q) => h.v >= q[0] - EPS && h.v <= q[1] + EPS
          )
          if (ints.length) [cLo, cHi] = ints[0]
          for (const [c0, c1] of cuts) {
            if (c1 <= h.v) cLo = Math.max(cLo, c1)
            else if (c0 >= h.v) cHi = Math.min(cHi, c0)
          }
          const inCol = rowVs.filter((q) => q > cLo - EPS && q < cHi + EPS)
          const r = inCol.findIndex((q) => Math.abs(q - h.v) <= 1)
          const pv = r > 0 ? h.v - inCol[r - 1] : 2 * (h.v - cLo)
          const nv = r >= 0 && r < inCol.length - 1 ? inCol[r + 1] - h.v : 2 * (cHi - h.v)
          L = Math.max(pv, nv)
        }
        res.set(h.id, { S, L })
      }
    }
    return res
  }
  const maxSL = (): { S: number; L: number } => {
    let S = 0
    let L = 0
    for (const x of protection().values()) {
      S = Math.max(S, x.S)
      L = Math.max(L, x.L)
    }
    return { S, L }
  }
  const smaxFor = (L: number): number => Math.min(p.maxSpacingMm, p.maxAreaMm2 / Math.max(L, 1))

  const conflicts = (o: UVObs, hs: HeadRec[]): boolean =>
    hs.some((h) => {
      const dx = Math.max(o.uLo - h.u, 0, h.u - o.uHi)
      const dy = Math.max(o.vLo - h.v, 0, h.v - o.vHi)
      return Math.hypot(dx, dy) < o.req - TOL_MM
    })

  const snapshot = (): Map<number, Pt> => new Map(recs.map((h) => [h.id, [h.u, h.v] as Pt]))
  const attribute = (o: UVObs, before: Map<number, Pt>, addedCount: number): void => {
    const ids: number[] = movedBy.get(o.g.ob.id) ?? []
    for (const h of recs) {
      const b = before.get(h.id)
      if (b && Math.hypot(h.u - b[0], h.v - b[1]) > TOL_MM && !ids.includes(h.id)) ids.push(h.id)
    }
    movedBy.set(o.g.ob.id, ids)
    if (addedCount > 0) addedBy.set(o.g.ob.id, (addedBy.get(o.g.ob.id) ?? 0) + addedCount)
  }

  // ── row-coordinate re-spacing (obstruction parallel to the branch lines) ──
  const respaceRows = (o: UVObs): void => {
    const before = snapshot()
    const rows = rowsOf()
    if (rows.length === 0) return
    const walls = processed.filter((q) => q.parallel && isCut(q))
    const forbids: [number, number][] = processed
      .filter((q) => q.parallel && !q.g.wall)
      .map((q) => [q.vLo - q.req + TOL_MM, q.vHi + q.req - TOL_MM] as [number, number])
      .filter(([a, b]) => b > a)
    // bays across: room v-range cut by the parallel wall obstructions
    const cuts = walls.map((q) => [q.vLo, q.vHi] as [number, number])
    const bays = cutInterval([[vMin, vMax]], cuts)
    const cur_ = maxSL()
    const smax = Math.min(p.maxSpacingMm, p.maxAreaMm2 / Math.max(cur_.S, 1))
    const newVs: number[] = []
    let ok = true
    for (const bay of bays) {
      const old = rows.filter((r) => r.v >= bay.lo - EPS && r.v <= bay.hi + EPS).map((r) => r.v)
      const solved = solveBay(bay.lo, bay.hi, old, bay.cut, smax, forbids, () => true)
      if (!solved) {
        ok = false
        note(
          o.g.ob.id,
          `rows cannot be re-spaced between v = ${bay.lo.toFixed(0)} and ${bay.hi.toFixed(0)} mm`
        )
        break
      }
      newVs.push(...solved)
    }
    if (!ok) return
    newVs.sort((a, b) => a - b)
    const pairs = matchOrdered(
      rows.map((r) => r.v),
      newVs
    )
    const oldToNew = new Map<number, number>() // old row index → new v
    const usedNew = new Set<number>()
    for (const [i, j] of pairs) {
      oldToNew.set(i, newVs[j])
      usedNew.add(j)
    }
    // rows dropped (inside a wall obstruction) lose their sprinklers
    const dropped = new Set<HeadRec>()
    rows.forEach((r, i) => {
      if (!oldToNew.has(i)) for (const h of r.heads) dropped.add(h)
    })
    rows.forEach((r, i) => {
      const nv = oldToNew.get(i)
      if (nv !== undefined) for (const h of r.heads) h.v = nv
    })
    let added = 0
    newVs.forEach((nv, j) => {
      if (usedNew.has(j)) return
      // copy the sprinkler columns of the nearest surviving row
      let best = -1
      let bd = Infinity
      rows.forEach((_r, i) => {
        if (!oldToNew.has(i)) return
        const d = Math.abs(oldToNew.get(i)! - nv)
        if (d < bd) {
          bd = d
          best = i
        }
      })
      if (best < 0) return
      for (const h of rows[best].heads) {
        recs.push({ id: p.nextId(), u: h.u, v: nv, u0: h.u, v0: nv, added: true })
        added++
      }
    })
    for (const h of dropped) recs.splice(recs.indexOf(h), 1)
    attribute(o, before, added)
  }

  // ── per-row re-spacing along u ──
  const respaceRowLines = (o: UVObs): void => {
    const before = snapshot()
    let added = 0
    const rows = rowsOf()
    const rowL = p.sidewall ? p.sidewall.throwMm : maxSL().L
    const smax = smaxFor(rowL)
    for (const row of rows) {
      const crossing = isCut(o) && row.v > o.vLo + TOL_MM && row.v < o.vHi - TOL_MM
      if (!crossing && !conflicts(o, row.heads)) continue
      const bays = baysAtRow(row.v)
      const forbids = zonesAtRow(row.v)
      const newUs: number[] = []
      let ok = true
      for (const bay of bays) {
        const old = row.heads
          .filter((h) => h.u >= bay.lo - EPS && h.u <= bay.hi + EPS)
          .map((h) => h.u)
        const solved = solveBay(bay.lo, bay.hi, old, bay.cut, smax, forbids, (u) => {
          if (rect) return true
          const [x, y] = swap ? [row.v, u] : [u, row.v]
          return (
            pointInPolygon(x, y, p.polygon) &&
            distanceToPolygonEdges(x, y, p.polygon) >= MIN_WALL_DISTANCE_MM - EPS
          )
        })
        if (!solved) {
          ok = false
          note(o.g.ob.id, `row ${row.v.toFixed(0)} mm cannot be re-spaced around ${o.g.ob.id}`)
          break
        }
        newUs.push(...solved)
      }
      if (!ok) continue
      newUs.sort((a, b) => a - b)
      const pairs = matchOrdered(
        row.heads.map((h) => h.u),
        newUs
      )
      const oldNew = new Map<number, number>()
      const used = new Set<number>()
      for (const [i, j] of pairs) {
        oldNew.set(i, newUs[j])
        used.add(j)
      }
      row.heads.forEach((h, i) => {
        const nu = oldNew.get(i)
        if (nu !== undefined) h.u = nu
        else recs.splice(recs.indexOf(h), 1) // under a wall obstruction
      })
      newUs.forEach((nu, j) => {
        if (used.has(j)) return
        recs.push({ id: p.nextId(), u: nu, v: row.v, u0: nu, v0: row.v, added: true })
        added++
      })
    }
    attribute(o, before, added)
  }

  for (const o of order) {
    processed.push(o)
    const touches = !(o.uLo >= uMax || o.uHi <= uMin || o.vLo >= vMax || o.vHi <= vMin)
    if (o.parallel) {
      if (conflicts(o, recs) || (isCut(o) && touches)) respaceRows(o)
    } else if (conflicts(o, recs) || (isCut(o) && touches)) respaceRowLines(o)
  }

  // ── sprinklers below wide obstructions ──
  const below: BelowHeadPlan[] = []
  for (const o of all) {
    const g = o.g
    if (g.rule !== 'wide') continue
    const alongX = g.longAxis === 'x'
    const lo = alongX ? g.xLo : g.yLo
    const hi = alongX ? g.xHi : g.yHi
    const cLo = alongX ? g.yLo : g.xLo
    const cHi = alongX ? g.yHi : g.xHi
    const width = cHi - cLo
    const lines = Math.max(1, Math.ceil(width / p.maxSpacingMm - 1e-9))
    const fp: Pt[] = alongX ? p.polygon : p.polygon.map(([x, y]) => [y, x] as Pt)
    for (let q = 0; q < lines; q++) {
      const c = cLo + ((q + 0.5) * width) / lines
      for (const [a, b] of scanIntervals(fp, c)) {
        const a2 = Math.max(a, lo)
        const b2 = Math.min(b, hi)
        const len = b2 - a2
        if (len < 2 * MIN_WALL_DISTANCE_MM) continue
        const n = Math.max(1, Math.ceil(len / p.maxSpacingMm - 1e-9))
        const S = len / n
        const L = Math.min(width / lines, p.maxAreaMm2 / S)
        for (let i = 0; i < n; i++) {
          const t = a2 + (i + 0.5) * S
          below.push({
            x: alongX ? t : c,
            y: alongX ? c : t,
            S,
            L,
            obstructionId: g.ob.id
          })
        }
      }
    }
  }

  // ── result ──
  const final = recs.filter((h) => Math.hypot(h.u - h.u0, h.v - h.v0) > TOL_MM || h.added)
  const modified = final.length > 0
  const sl = modified ? protection() : new Map<number, { S: number; L: number }>()
  const heads: PlacedHeadPlan[] = recs.map((h) => {
    const [x, y] = swap ? [h.v, h.u] : [h.u, h.v]
    const d = Math.hypot(h.u - h.u0, h.v - h.v0)
    const s = sl.get(h.id)
    return {
      id: h.id,
      x,
      y,
      S: s?.S ?? 0,
      L: s?.L ?? 0,
      relocatedMm: !h.added && d > TOL_MM ? Math.round(d * 10) / 10 : undefined
    }
  })
  for (const [id, list] of movedBy)
    movedBy.set(
      id,
      list.filter((hid) => heads.some((h) => h.id === hid && h.relocatedMm !== undefined))
    )
  let S = 0
  let L = 0
  for (const h of heads) {
    S = Math.max(S, h.S)
    L = Math.max(L, h.L)
  }
  return { modified, heads, below, movedBy, addedBy, notes, S, L }
}

/** ft² of an S × L protection area given in mm. */
export function areaFt2Of(Smm: number, Lmm: number): number {
  return (Smm / MM_PER_FT) * (Lmm / MM_PER_FT)
}
