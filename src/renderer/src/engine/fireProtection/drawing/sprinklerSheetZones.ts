/**
 * Zone / dimension / reducer helpers of the sprinkler floor sheets (FS-1nn): zone boundaries and labels, zone control
 * valve assembly symbols, head-to-wall and spacing dimensions per protected area, reducer marks at pipe size changes,
 * and the zone and sprinkler-type schedules.
 */
import type {
  SprinklerFloorDesign,
  SprinklerFloorInput,
  SprinklerHeadType,
  SprinklerPipe,
  SprinklerRoomInput,
  SprinklerZoneResult
} from '../sprinkler/sprinklerTypes'
import { type Ctx, type Placer, type Pt, dimBoxes, wrapText } from './sheetKit'
import { HAZARD_LABEL, tempC, zoneBandLayer } from './sprinklerSheetKit'

const f1 = (v: number, d = 1): string => v.toFixed(d)
/** 52000 -> "52,000". */
export const thousands = (v: number): string =>
  Math.round(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// ─────────────────────────── geometry ───────────────────────────

/** Distance from p along the unit direction `dir` to the first polygon edge (null when none). */
export function rayHit(poly: Pt[], p: Pt, dir: Pt): number | null {
  let best: number | null = null
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const z = poly[(i + 1) % poly.length]
    const ex = z[0] - a[0]
    const ey = z[1] - a[1]
    const den = dir[0] * ey - dir[1] * ex
    if (Math.abs(den) < 1e-9) continue
    const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den
    const u = ((a[0] - p[0]) * dir[1] - (a[1] - p[1]) * dir[0]) / den
    if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9 && (best === null || t < best)) best = t
  }
  return best
}

function pointIn(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

/** Unit vector from the nearest polygon edge of p into the polygon (the throw direction of a sidewall head). */
export function inwardNormal(poly: Pt[], p: Pt): Pt {
  let best = Infinity
  let n: Pt = [0, 1]
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const z = poly[(i + 1) % poly.length]
    const ex = z[0] - a[0]
    const ey = z[1] - a[1]
    const l2 = ex * ex + ey * ey
    if (l2 < 1e-9) continue
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2))
    const d = Math.hypot(a[0] + ex * t - p[0], a[1] + ey * t - p[1])
    if (d < best) {
      best = d
      const l = Math.sqrt(l2)
      n = [-ey / l, ex / l]
    }
  }
  const probe: Pt = [p[0] + n[0] * 300, p[1] + n[1] * 300]
  return pointIn(probe, poly) ? n : [-n[0], -n[1]]
}

// ─────────────────────────── zones ───────────────────────────

export interface ZoneFloor {
  fi: SprinklerFloorInput
  fd: SprinklerFloorDesign
}

const roomsOfZone = (d: ZoneFloor, z: SprinklerZoneResult): SprinklerRoomInput[] =>
  d.fi.rooms.filter((r) => z.roomIds.includes(r.id))

/** Zone outlines: a coloured band per zone (FS-ZONE-n) with the dash-dot boundary (FS-ZONE) on top. */
export function drawZoneBoundaries(c: Ctx, d: ZoneFloor, M: (p: Pt) => Pt): void {
  d.fd.zones.forEach((z, zi) => {
    for (const r of roomsOfZone(d, z)) {
      const pts = r.polygon.map(M)
      c.b.polyline(zoneBandLayer(zi), pts, true)
      c.b.polyline('FS-ZONE', pts, true)
    }
  })
}

/** Label of a zone: name, hazards and area. */
export function zoneLabelLines(d: ZoneFloor, z: SprinklerZoneResult): string[] {
  const hz = [
    ...new Set(
      roomsOfZone(d, z)
        .filter((r) => !r.omit)
        .map((r) => HAZARD_LABEL[r.hazard] ?? r.hazard.toUpperCase())
    )
  ]
  return [
    `ZONE ${z.zoneId} - ${z.name.toUpperCase()}`,
    `${hz.length ? hz.join(' / ') : 'NO SPRINKLERS'} HAZARD - ${z.headCount} HEADS`,
    `${f1(z.areaM2, 0)} M2 / ${thousands(z.areaFt2)} FT2`
  ]
}

/** Place the label of every zone outside (preferred) or inside its outline. */
export function placeZoneLabels(c: Ctx, d: ZoneFloor, M: (p: Pt) => Pt, P: Placer): void {
  const S = c.sheet.scale
  const hP = 2.4
  for (const z of d.fd.zones) {
    const rs = roomsOfZone(d, z)
    if (rs.length === 0) continue
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const r of rs)
      for (const q of r.polygon) {
        const m = M(q)
        x0 = Math.min(x0, m[0])
        x1 = Math.max(x1, m[0])
        y0 = Math.min(y0, m[1])
        y1 = Math.max(y1, m[1])
      }
    const lines = zoneLabelLines(d, z)
    const bh = lines.length * hP * S * 1.45
    const w = x1 - x0
    const tw = Math.max(...lines.map((l) => l.length)) * hP * S * 0.78
    const centres: Pt[] = []
    for (const gap of [1.5, 5, 9]) {
      for (const fr of [0.5, 0.2, 0.8, 0.35, 0.65, 0.05, 0.95]) {
        const cx = Math.max(x0 + tw / 2, Math.min(x1 - tw / 2, x0 + w * fr))
        centres.push([cx, y1 + gap * S + bh / 2])
        centres.push([cx, y0 - gap * S - bh / 2])
      }
    }
    if (!P.block(lines, hP, centres)) P.callout([x0, y1], lines, hP, [90, 135, 45, 180, 0, 270])
  }
}

/** Zone control valve assembly symbol: double circle with a bow-tie valve inside a zone-coloured ring. */
export function drawZcvSymbol(c: Ctx, p: Pt, P: Placer, zi: number): void {
  const { b, sheet } = c
  const S = sheet.scale
  b.circle('FS-PIPE-RISER', p[0], p[1], 2.6 * S)
  b.circle('FS-PIPE-RISER', p[0], p[1], 1.5 * S)
  const w = 1.0 * S
  const h = 0.8 * S
  b.solid('FS-VALV', [
    [p[0] - w, p[1] - h],
    [p[0] - w, p[1] + h],
    [p[0], p[1]]
  ])
  b.solid('FS-VALV', [
    [p[0] + w, p[1] - h],
    [p[0] + w, p[1] + h],
    [p[0], p[1]]
  ])
  b.circle(zoneBandLayer(zi), p[0], p[1], 3.2 * S)
  P.addHard({ x0: p[0] - 3.6 * S, y0: p[1] - 3.6 * S, x1: p[0] + 3.6 * S, y1: p[1] + 3.6 * S })
}

// ─────────────────────────── dimensions ───────────────────────────

interface DimReq {
  a: Pt
  z: Pt
  text?: string
}

const dimText = (q: DimReq): string =>
  q.text ?? String(Math.round(Math.hypot(q.z[0] - q.a[0], q.z[1] - q.a[1])))

/** Draw a chain of collinear dimensions on the first side (preferred, else the other) that is free of obstacles. */
function placeChain(c: Ctx, P: Placer, reqs: DimReq[], prefer: 1 | -1): void {
  const S = c.sheet.scale
  const ks = [7, 11.5, 16, 21]
  const boxes = (q: DimReq, off: number): ReturnType<typeof dimBoxes> =>
    dimBoxes(S, q.a[0], q.a[1], q.z[0], q.z[1], off, dimText(q))
  const fits = (off: number, soft: boolean): boolean =>
    reqs.every((q) => boxes(q, off).every((bx) => P.free(bx, 0.2 * S, soft)))
  // preferred side (free of pipes, then crossing pipes), then the other side
  const tries: [number, boolean][] = [
    ...ks.map((k): [number, boolean] => [prefer * k, true]),
    ...ks.map((k): [number, boolean] => [prefer * k, false]),
    ...ks.map((k): [number, boolean] => [-prefer * k, true]),
    ...ks.map((k): [number, boolean] => [-prefer * k, false])
  ]
  const off = tries.find(([o, soft]) => fits(o, soft))?.[0] ?? prefer * ks[0]
  for (const q of reqs) {
    c.b.dimLinear(q.a[0], q.a[1], q.z[0], q.z[1], off, q.text)
    for (const bx of boxes(q, off)) P.addHard(bx)
  }
}

/** Spacing string of sorted head coordinates: one "n @ s = total" dimension when equal, else one per bay. */
function spacingChain(pts: Pt[], axis: 0 | 1, perBay = false): DimReq[] {
  if (pts.length < 2) return []
  const gaps = pts.slice(1).map((q, i) => q[axis] - pts[i][axis])
  const total = pts[pts.length - 1][axis] - pts[0][axis]
  if (!perBay && gaps.length > 1 && gaps.every((g) => Math.abs(g - gaps[0]) < 2))
    return [
      {
        a: pts[0],
        z: pts[pts.length - 1],
        text: `${gaps.length} @ ${Math.round(gaps[0])} = ${Math.round(total)}`
      }
    ]
  return gaps.map((_, i) => ({ a: pts[i], z: pts[i + 1] }))
}

/**
 * Dimensions of every protected area (layer FS-DIMS): head-to-wall in both axes for the first row / first column and
 * the head spacing strings along them (sidewall areas: wall offset and spacing along the wall).
 */
export function drawAreaDimensions(c: Ctx, d: ZoneFloor, M: (p: Pt) => Pt, P: Placer): void {
  for (const room of d.fi.rooms) {
    if (room.omit) continue
    const hs = d.fd.heads.filter((h) => h.roomId === room.id)
    if (hs.length === 0) continue
    const minY = Math.min(...hs.map((h) => h.y))
    const minX = Math.min(...hs.map((h) => h.x))
    const row = hs
      .filter((h) => Math.abs(h.y - minY) < 60)
      .sort((p, q) => p.x - q.x)
      .map((h) => [h.x, h.y] as Pt)
    const col = hs
      .filter((h) => Math.abs(h.x - minX) < 60)
      .sort((p, q) => p.y - q.y)
      .map((h) => [h.x, h.y] as Pt)
    const poly = room.polygon as Pt[]
    const toM = (q: DimReq): DimReq => ({ a: M(q.a), z: M(q.z), text: q.text })
    // sidewall areas: strings on the room side of the wall line
    const sw = d.fd.heads.find((h) => h.roomId === room.id)
    const nIn =
      sw && room.headSpec?.orientation === 'sidewall' ? inwardNormal(poly, [sw.x, sw.y]) : null
    const rowSide: 1 | -1 = nIn && nIn[1] > 0.5 ? 1 : -1
    const colSide: 1 | -1 = nIn && nIn[0] > 0.5 ? -1 : nIn && nIn[0] < -0.5 ? 1 : -1
    const rowDims = spacingChain(row, 0).map(toM)
    if (rowDims.length) placeChain(c, P, rowDims, rowSide)
    const colDims = spacingChain(col, 1, true).map(toM)
    if (colDims.length) placeChain(c, P, colDims, colSide)
    const hx = row[0]
    const wx = rayHit(poly, hx, [-1, 0])
    if (wx !== null && wx > 20) placeChain(c, P, [toM({ a: [hx[0] - wx, hx[1]], z: hx })], 1)
    const hy = col[0]
    const wy = rayHit(poly, hy, [0, -1])
    if (wy !== null && wy > 20) placeChain(c, P, [toM({ a: [hy[0], hy[1] - wy], z: hy })], 1)
  }
}

// ─────────────────────────── reducers ───────────────────────────

const groupKey = (p: SprinklerPipe): string =>
  p.kind === 'branch' ? p.id.replace(/-\d+$/, '') : `${p.kind}:${p.zoneId}`

interface ReducerJoint {
  at: Pt
  from: SprinklerPipe
  to: SprinklerPipe
  towardLarge: Pt
}

/** Reducer positions: joints of consecutive segments of one line whose pipe size changes. */
export function reducerJoints(fd: SprinklerFloorDesign): ReducerJoint[] {
  const out: ReducerJoint[] = []
  const last = new Map<string, SprinklerPipe>()
  for (const p of fd.pipes) {
    if (p.kind === 'riser-nipple' || p.points.length < 2) continue
    const g = groupKey(p)
    const prev = last.get(g)
    last.set(g, p)
    if (!prev || prev.sizeIn === p.sizeIn) continue
    let best = Infinity
    let at: Pt = p.points[0]
    let pa: Pt = prev.points[0]
    let pb: Pt = p.points[0]
    for (const e of [0, prev.points.length - 1])
      for (const k of [0, p.points.length - 1]) {
        const a = prev.points[e]
        const z = p.points[k]
        const dd = Math.hypot(a[0] - z[0], a[1] - z[1])
        if (dd < best) {
          best = dd
          at = [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2]
          pa = prev.points[e === 0 ? 1 : prev.points.length - 2]
          pb = p.points[k === 0 ? 1 : p.points.length - 2]
        }
      }
    if (best > 100) continue
    const far = prev.sizeIn > p.sizeIn ? pa : pb
    const l = Math.hypot(far[0] - at[0], far[1] - at[1]) || 1
    out.push({ at, from: prev, to: p, towardLarge: [(far[0] - at[0]) / l, (far[1] - at[1]) / l] })
  }
  return out
}

/** Draw the reducer marks (small tapered fittings, big end toward the larger pipe); returns their count. */
export function drawReducers(
  c: Ctx,
  fd: SprinklerFloorDesign,
  M: (p: Pt) => Pt,
  P: Placer
): number {
  const S = c.sheet.scale
  const js = reducerJoints(fd)
  for (const j of js) {
    const m = M(j.at)
    const [ux, uy] = j.towardLarge
    const nx = -uy
    const ny = ux
    const L = 1.1 * S
    const big = 1.0 * S
    const small = 0.45 * S
    c.b.solid('FS-PIPE-MAIN', [
      [m[0] + ux * L + nx * big, m[1] + uy * L + ny * big],
      [m[0] + ux * L - nx * big, m[1] + uy * L - ny * big],
      [m[0] - ux * L - nx * small, m[1] - uy * L - ny * small],
      [m[0] - ux * L + nx * small, m[1] - uy * L + ny * small]
    ])
    P.addSoft({ x0: m[0] - 1.4 * S, y0: m[1] - 1.4 * S, x1: m[0] + 1.4 * S, y1: m[1] + 1.4 * S })
  }
  return js.length
}

// ─────────────────────────── schedules ───────────────────────────

/** ZONE SCHEDULE rows. */
export function zoneScheduleRows(d: ZoneFloor): string[][] {
  const rows: string[][] = [
    [
      'ZONE',
      'NAME',
      'ZCV TAG',
      'AREAS',
      'HEADS',
      'AREA FT2',
      'AREA M2',
      'LIMIT',
      'GOVERNING @ SOURCE',
      'MARGIN'
    ]
  ]
  for (const z of d.fd.zones) {
    const g = z.governing
    rows.push([
      z.zoneId,
      z.name.toUpperCase(),
      z.controlValveTag,
      wrapText(
        roomsOfZone(d, z)
          .map((r) => r.name.toUpperCase())
          .join(', '),
        30
      ).join('\n'),
      String(z.headCount),
      thousands(z.areaFt2),
      f1(z.areaM2, 0),
      `${thousands(z.maxAreaFt2)} FT2`,
      g ? `${f1(g.flowAtSourceGpm)} GPM @ ${f1(g.pressureAtSourcePsi)} PSI` : '-',
      g ? `${f1(g.marginPsi)} PSI` : '-'
    ])
  }
  return rows
}

/** Description of a head type for schedules (no degree sign, upper case). */
export const headDescription = (t: SprinklerHeadType): string =>
  t.description.replace(/°/g, '').toUpperCase()

/** SPRINKLER SCHEDULE rows: type id, description, K, response, temperature / bulb, quantity per zone. */
export function sprinklerScheduleRows(d: ZoneFloor, types: SprinklerHeadType[]): string[][] {
  const zones = d.fd.zones
  const rows: string[][] = [
    [
      'TYPE ID',
      'DESCRIPTION',
      'K',
      'RESPONSE',
      'TEMP / BULB',
      ...zones.map((z) => `QTY ${z.zoneId}`),
      'TOTAL'
    ]
  ]
  for (const t of types) {
    const inFloor = d.fd.heads.filter((h) => h.headTypeId === t.id)
    if (inFloor.length === 0) continue
    rows.push([
      t.id,
      wrapText(headDescription(t), 34).join('\n'),
      f1(t.kFactor, 1),
      t.response.toUpperCase(),
      `${t.tempRatingF}F (${tempC(t.tempRatingF)}C) ${t.bulbColor.toUpperCase()}`,
      ...zones.map((z) => String(inFloor.filter((h) => h.zoneId === z.zoneId).length)),
      String(inFloor.length)
    ])
  }
  return rows
}

/** The sizing-method note of the sheet. */
export function sizingNote(hydraulic: boolean): string {
  return hydraulic
    ? 'PIPE SIZING: HYDRAULICALLY CALCULATED (NFPA 13 CH. 28)'
    : 'PIPE SCHEDULE (NFPA 13 SEC. 28.5), HYDRAULICALLY VERIFIED'
}
