/**
 * HVAC shop-drawing model: converts the project's zones (drawing units, y down) into a normalised, millimetre,
 * model in the drawing (DXF) coordinates — the HVAC canvas stores zones in the client DXF coordinate system, so no axis flip (keeps Revit origin-to-origin alignment) with unit formatting, equipment tags and refrigerant line sets.
 */
import type { DuctSegment, ProjectMetadata, Zone } from '../../store/projectStore'
import { routeOrthogonalRefrigerantPiping } from '../spatialPlanner'

export type Pt = [number, number]

export interface Units {
  metric: boolean
  /** Millimetres per drawing unit. */
  mmPerUnit: number
  flowUnit: string
  velUnit: string
  areaUnit: string
  lenUnit: string
  flow: (cfm: number) => string
  vel: (fpm: number) => string
  area: (ft2: number) => string
  len: (mm: number) => string
  /** Floor area from drawing units squared → display value. */
  floorArea: (du2: number) => number
  /** Length in mm → "60'-0\"" or "18288". */
  dim: (mm: number) => string
}

export function makeUnits(project: ProjectMetadata): Units {
  const metric = project.units === 'metric'
  const sc = project.scale > 0 ? project.scale : 1
  const mmPerUnit = (metric ? 1000 : 304.8) / sc
  const FT2_M2 = 0.092903
  return {
    metric,
    mmPerUnit,
    flowUnit: metric ? 'L/S' : 'CFM',
    velUnit: metric ? 'M/S' : 'FPM',
    areaUnit: metric ? 'M2' : 'FT2',
    lenUnit: metric ? 'M' : 'FT',
    flow: (cfm) => String(Math.round(metric ? cfm * 0.47195 : cfm)),
    vel: (fpm) => (metric ? (fpm * 0.00508).toFixed(1) : String(Math.round(fpm))),
    area: (ft2) => (metric ? (ft2 * FT2_M2).toFixed(3) : ft2.toFixed(2)),
    len: (mm) => (metric ? (mm / 1000).toFixed(1) : (mm / 304.8).toFixed(1)),
    floorArea: (du2) => {
      const sqMm = du2 * mmPerUnit * mmPerUnit
      return metric ? sqMm / 1e6 : sqMm / (304.8 * 304.8)
    },
    dim: (mm) => {
      if (metric) return String(Math.round(mm))
      const totalIn = Math.round(mm / 25.4)
      return `${Math.floor(totalIn / 12)}'-${totalIn % 12}"`
    }
  }
}

export type TerminalKind = 'supply' | 'return' | 'exhaust' | 'cassette' | 'high-wall'
export type SystemKind = 'concealed' | 'cassette' | 'high-wall' | 'packaged' | 'ahu' | 'fcu' | 'vrf'

export interface MTerminal {
  id: string
  zoneName: string
  kind: TerminalKind
  x: number
  y: number
  w: number
  h: number
  cfm: number
  /** Neck size as displayed (inches as entered, or mm for metric projects). */
  sizeLabel: string
  nc?: number
  throwFt?: number
  dpInWg?: number
}

export interface MDuct {
  id: string
  zoneName: string
  type: DuctSegment['type']
  supply: boolean
  pts: Pt[]
  widthMm: number
  heightMm: number
  round: boolean
  shape: string
  cfm: number
  sizeLabel: string
  areaFt2: number
  velFpm: number
  lengthMm: number
}

export interface MUnit {
  tag: string
  zoneName: string
  indoor: boolean
  sys: SystemKind
  x: number
  y: number
  w: number
  h: number
  model: string
  esp: string
  cfm: number
}

export interface MRefr {
  pts: Pt[]
  iso: Pt
}

export interface MZone {
  id: string
  name: string
  poly: Pt[]
  areaDu2: number
  zone: Zone
  supplyCfm: number
  returnCfm: number
  exhaustCfm: number
  nTerm: number
  sysLabel: string
  qty: number
  indoorTags: string[]
  outdoorTags: string[]
}

export interface HvacModel {
  u: Units
  zones: MZone[]
  terminals: MTerminal[]
  ducts: MDuct[]
  units: MUnit[]
  refr: MRefr[]
}

export const SYS_LABEL: Record<SystemKind, string> = {
  concealed: 'CONCEALED DUCTED SPLIT',
  cassette: 'CEILING CASSETTE SPLIT',
  'high-wall': 'HIGH WALL SPLIT',
  packaged: 'PACKAGED UNIT',
  ahu: 'AIR HANDLING UNIT',
  fcu: 'DUCTED FAN COIL UNIT',
  vrf: 'VRF INDOOR UNIT'
}

/** Plan footprint (mm) of the indoor unit by system type. */
export function indoorFootprint(sys: SystemKind): [number, number] {
  switch (sys) {
    case 'cassette':
      return [840, 840]
    case 'high-wall':
      return [1000, 250]
    case 'packaged':
    case 'ahu':
      return [2200, 1100]
    default:
      return [1200, 600]
  }
}
export const OUTDOOR_FOOTPRINT: [number, number] = [1000, 450]

const IN = 25.4
const roundTo = (v: number, step: number): number => Math.round(v / step) * step

/** Parse "12x12" / "24 X 12" / "10" (inches) into [w, h]. */
export function parseSizeIn(
  label: string,
  fallback: [number, number] = [12, 12]
): [number, number] {
  const m = /(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/.exec(label)
  if (m) return [parseFloat(m[1]), parseFloat(m[2])]
  const r = /(\d+(?:\.\d+)?)/.exec(label)
  if (r) return [parseFloat(r[1]), parseFloat(r[1])]
  return fallback
}

function pointsOf(flat: number[]): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]])
  return out
}

function polyArea(p: Pt[]): number {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]
    a += p[i][0] * q[1] - q[0] * p[i][1]
  }
  return Math.abs(a) / 2
}

const tkind = (t: string | undefined): TerminalKind =>
  t === 'return' || t === 'exhaust' || t === 'cassette' || t === 'high-wall' ? t : 'supply'

export function buildModel(zones: Zone[], project: ProjectMetadata): HvacModel {
  const u = makeUnits(project)
  const k = u.mmPerUnit
  const P = (x: number, y: number): Pt => [x * k, y * k]
  const m: HvacModel = { u, zones: [], terminals: [], ducts: [], units: [], refr: [] }
  let acN = 0
  let cuN = 0
  const unitXY: Pt[] = []

  for (const z of zones) {
    const poly = pointsOf(z.points).map((p) => P(p[0], p[1]))
    const indoorPos =
      z.unitPositions && z.unitPositions.length > 0 ? z.unitPositions : z.unitPos ? [z.unitPos] : []
    const outdoorPos =
      z.outdoorUnitPositions && z.outdoorUnitPositions.length > 0
        ? z.outdoorUnitPositions
        : z.outdoorUnitPos
          ? [z.outdoorUnitPos]
          : []
    const sys: SystemKind = z.systemType ?? 'concealed'
    let supply = 0
    let ret = 0
    let exh = 0
    for (const d of z.diffusers) {
      const kind = tkind(d.type)
      const [wi, hi] = parseSizeIn(d.size)
      const roundNeck = !/[xX×]/.test(d.size)
      const sizeLabel = u.metric
        ? roundNeck
          ? `%%c${roundTo(wi * IN, 25)}`
          : `${roundTo(wi * IN, 25)}x${roundTo(hi * IN, 25)}`
        : d.size
      const p = P(d.x, d.y)
      m.terminals.push({
        id: d.id,
        zoneName: z.name,
        kind,
        x: p[0],
        y: p[1],
        w: wi * IN,
        h: hi * IN,
        cfm: d.cfm,
        sizeLabel,
        nc: d.actualNc,
        throwFt: d.throwT50Ft,
        dpInWg: d.deltaPInWg
      })
      if (kind === 'return') ret += d.cfm
      else if (kind === 'exhaust') exh += d.cfm
      else supply += d.cfm
    }
    const qty = z.catalogQty ?? indoorPos.length
    const cfmEach = qty > 0 ? Math.round(supply / qty) : Math.round(supply)
    const indoorTags: string[] = []
    const outdoorTags: string[] = []
    indoorPos.forEach((ip) => {
      acN++
      const [w, h] = indoorFootprint(sys)
      const p = P(ip.x, ip.y)
      const tag = `AC-${acN}`
      indoorTags.push(tag)
      unitXY.push(p)
      m.units.push({
        tag,
        zoneName: z.name,
        indoor: true,
        sys,
        x: p[0],
        y: p[1],
        w,
        h,
        model: z.catalogModel ?? SYS_LABEL[sys],
        esp: z.catalogEsp ?? '',
        cfm: cfmEach
      })
    })
    outdoorPos.forEach((op) => {
      cuN++
      const p = P(op.x, op.y)
      const tag = `CU-${cuN}`
      outdoorTags.push(tag)
      m.units.push({
        tag,
        zoneName: z.name,
        indoor: false,
        sys,
        x: p[0],
        y: p[1],
        w: OUTDOOR_FOOTPRINT[0],
        h: OUTDOOR_FOOTPRINT[1],
        model: 'OUTDOOR UNIT',
        esp: '',
        cfm: 0
      })
    })
    // refrigerant line set per indoor unit → its outdoor unit
    if (outdoorPos.length > 0) {
      indoorPos.forEach((ip, i) => {
        const op = outdoorPos[i] ?? outdoorPos[0]
        const r = routeOrthogonalRefrigerantPiping(op, [ip])
        const pts: Pt[] = []
        for (const seg of r.segments) {
          if (seg.length < 4) continue
          const a = P(seg[0], seg[1])
          const b = P(seg[2], seg[3])
          if (pts.length === 0) pts.push(a)
          pts.push(b)
        }
        if (pts.length >= 2) m.refr.push({ pts, iso: P(r.isolatorPos.x, r.isolatorPos.y) })
      })
    }
    for (const d of z.ducts) {
      const pts = pointsOf(d.points).map((p) => P(p[0], p[1]))
      const clean: Pt[] = []
      for (const p of pts) {
        const l = clean[clean.length - 1]
        if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 1e-6) clean.push(p)
      }
      if (clean.length < 2) continue
      const round =
        d.shape === 'round' ||
        d.shape === 'flex' ||
        (d.diameterIn !== undefined &&
          d.diameterIn > 0 &&
          d.shape !== 'rectangular' &&
          d.shape !== 'oval')
      const dia = d.diameterIn ?? d.widthIn
      const wMm = (round ? dia : d.widthIn) * IN
      const hMm = (round ? dia : d.heightIn) * IN
      const areaFt2 =
        d.areaSqFt ?? (round ? (Math.PI * (dia / 12) ** 2) / 4 : (d.widthIn * d.heightIn) / 144)
      const vel = d.velocityFpm ?? (areaFt2 > 0 ? d.cfm / areaFt2 : 0)
      let len = 0
      for (let i = 1; i < clean.length; i++)
        len += Math.hypot(clean[i][0] - clean[i - 1][0], clean[i][1] - clean[i - 1][1])
      const sizeLabel = u.metric
        ? round
          ? `%%c${roundTo(wMm, 50)}`
          : `${roundTo(wMm, 50)}x${roundTo(hMm, 50)}`
        : d.sizeLabel
      m.ducts.push({
        id: d.id,
        zoneName: z.name,
        type: d.type,
        supply: d.type !== 'return',
        pts: clean,
        widthMm: wMm,
        heightMm: hMm,
        round,
        shape: d.shape ?? 'rectangular',
        cfm: d.cfm,
        sizeLabel,
        areaFt2,
        velFpm: vel,
        lengthMm: len
      })
    }
    m.zones.push({
      id: z.id,
      name: z.name,
      poly,
      areaDu2: polyArea(pointsOf(z.points)),
      zone: z,
      supplyCfm: supply,
      returnCfm: ret,
      exhaustCfm: exh,
      nTerm: z.diffusers.length,
      sysLabel: SYS_LABEL[sys],
      qty,
      indoorTags,
      outdoorTags
    })
  }
  return m
}

export interface BoxMm {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Bounding box of everything that is drawn (true sizes, no annotations). */
export function modelBBox(m: HvacModel, zonesOnly = false): BoxMm {
  const bb: BoxMm = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const add = (x: number, y: number, rx = 0, ry = rx): void => {
    bb.minX = Math.min(bb.minX, x - rx)
    bb.maxX = Math.max(bb.maxX, x + rx)
    bb.minY = Math.min(bb.minY, y - ry)
    bb.maxY = Math.max(bb.maxY, y + ry)
  }
  for (const z of m.zones) for (const p of z.poly) add(p[0], p[1])
  if (!zonesOnly) {
    for (const d of m.ducts)
      for (const p of d.pts) add(p[0], p[1], Math.max(d.widthMm, d.heightMm) / 2)
    for (const t of m.terminals) add(t.x, t.y, t.w / 2, t.h / 2)
    for (const q of m.units) add(q.x, q.y, q.w / 2, q.h / 2)
    for (const r of m.refr) for (const p of r.pts) add(p[0], p[1])
  }
  if (!Number.isFinite(bb.minX)) return { minX: 0, minY: 0, maxX: 5000, maxY: 5000 }
  return bb
}

export function translateModel(m: HvacModel, dx: number, dy: number): void {
  const mv = (p: Pt): void => {
    p[0] += dx
    p[1] += dy
  }
  for (const z of m.zones) z.poly.forEach(mv)
  for (const d of m.ducts) d.pts.forEach(mv)
  for (const t of m.terminals) {
    t.x += dx
    t.y += dy
  }
  for (const q of m.units) {
    q.x += dx
    q.y += dy
  }
  for (const r of m.refr) {
    r.pts.forEach(mv)
    mv(r.iso)
  }
}

export const fmtTerminalKind = (k: TerminalKind): string =>
  k === 'supply'
    ? 'SUPPLY DIFFUSER'
    : k === 'return'
      ? 'RETURN GRILLE'
      : k === 'exhaust'
        ? 'EXHAUST GRILLE'
        : k === 'cassette'
          ? 'CASSETTE DIFFUSER'
          : 'HIGH-WALL SUPPLY GRILLE'
