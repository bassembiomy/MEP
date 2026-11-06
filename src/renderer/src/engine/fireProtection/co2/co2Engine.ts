/**
 * NFPA 12 total-flooding CO2 design engine: quantity → rate → nozzle layout → pipe network → Y/Z flow →
 * orifices → storage → devices → checks. Preliminary design; see CO2_PRELIMINARY_NOTE.
 */
import type { DesignCheck } from '../fpTypes'
import { pointInPolygon, polygonArea, polygonCentroid } from '../sprinkler/roomDetection'
import type {
  Co2Device, Co2DeviceKind, Co2DesignInput, Co2EnclosureInput, Co2EnclosureResult, Co2FlowRow, Co2FloorDesign, Co2FloorInput,
  Co2Nozzle, Co2Pipe, Co2PipeKind, Co2QuantityBreakdown, Co2Storage, Co2StorageDesign, Co2SystemDesign
} from './co2Types'
import {
  CO2_MATERIALS, CO2_PIPE_SIZES, CO2_REFERENCE_DESIGN, CO2_REFERENCE_QUANTITY, DEEP_SEATED_LABELS, FT2_PER_M2, FT3_PER_M3,
  HEAT_DETECTOR_SPACING_MM, KPA_PER_PSF, LB_PER_KG, MIN_NOZZLE_PRESSURE_PSI, MIN_TIME_DELAY_S, NOZZLE_MAX_SPACING_MM,
  SMOKE_DETECTOR_SPACING_MM, START_PRESSURE_PSI, co2PipeId, co2Schedule, deepSeatedBasis, materialConversionFactor,
  nozzleFluxAt, pressureAtY, surfaceFloodingFactor, yzAt
} from './nfpa12'
import { buildCo2Accessories, buildCo2Bom } from './co2Accessories'

type Pt = [number, number]

const TANK_TONS = [1, 2, 3, 4, 6, 8, 10, 15, 20, 30]
const f1 = (v: number): string => v.toFixed(1)
const pad2 = (n: number): string => String(n).padStart(2, '0')

// ─────────────────────────── Quantity ───────────────────────────

function computeQuantity(e: Co2EnclosureInput): {
  q: Co2QuantityBreakdown
  rate: number
  dischargeMin: number
  thirtyPctLb: number
  soakMin: number
  areaM2: number
  hazardLabel: string
} {
  const areaM2 = polygonArea(e.polygon) / 1e6
  const grossV = areaM2 * e.heightM * FT3_PER_M3
  const v = Math.max(grossV - e.deductionM3 * FT3_PER_M3, 0)
  const surface = e.fireType === 'surface'
  let c: number, f: number, minLb: number, mcf: number, openingRate: number, tDis: number, hazardLabel: string
  if (surface) {
    const mat = CO2_MATERIALS[e.material]
    c = Math.max(34, mat ? mat.mdcPct : 34)
    const sf = surfaceFloodingFactor(v)
    f = sf.ft3PerLb
    minLb = sf.minLb
    mcf = materialConversionFactor(c)
    openingRate = 1 * mcf
    tDis = 1
    hazardLabel = `Surface fire — ${mat ? mat.label : e.material}`
  } else {
    const d = deepSeatedBasis(e.deepSeated, v)
    c = d.pct
    f = d.ft3PerLb
    minLb = d.minLb
    mcf = 1
    openingRate = 2
    tDis = 7
    hazardLabel = `Deep-seated fire — ${DEEP_SEATED_LABELS[e.deepSeated]}`
  }
  const basic = Math.max(v / f, minLb)
  const openingsLb = e.openingsM2 * FT2_PER_M2 * openingRate
  const ventilationLb = ((e.ventilationM3min * FT3_PER_M3 * tDis) / f) * mcf
  const tF = 1.8 * e.temperatureC + 32
  const pct = tF > 200 ? (tF - 200) / 5 : tF < 0 ? -tF : 0
  const total = (basic * mcf + openingsLb + ventilationLb) * (1 + pct / 100)
  const thirtyPctLb = surface ? 0 : (v * Math.log(1 / 0.7)) / 9
  const rate = surface ? total / 1 : Math.max(total / 7, thirtyPctLb / 2)
  const dischargeMin = rate > 0 ? total / rate : 0
  return {
    q: {
      grossVolumeFt3: grossV,
      volumeFt3: v,
      designConcentrationPct: c,
      floodingFactorFt3PerLb: f,
      floodingFactorLbPerFt3: 1 / f,
      minimumLb: minLb,
      basicLb: basic,
      mcf,
      openingsLb,
      ventilationLb,
      temperatureCorrectionPct: pct,
      totalLb: total
    },
    rate,
    dischargeMin,
    thirtyPctLb,
    soakMin: surface ? 0 : 20,
    areaM2,
    hazardLabel
  }
}

// ─────────────────────────── Geometry helpers ───────────────────────────

function gridPoints(poly: Pt[], spacing: number): Pt[] {
  const xs = poly.map((p) => p[0])
  const ys = poly.map((p) => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const W = maxX - minX, H = maxY - minY
  const nx = Math.max(1, Math.ceil(W / spacing - 1e-9)), ny = Math.max(1, Math.ceil(H / spacing - 1e-9))
  const out: Pt[] = []
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = minX + ((i + 0.5) * W) / nx
      const y = minY + ((j + 0.5) * H) / ny
      if (pointInPolygon(x, y, poly)) out.push([x, y])
    }
  if (!out.length) out.push(polygonCentroid(poly))
  out.sort((a, b) => a[1] - b[1] || a[0] - b[0])
  return out
}

function nearestBoundaryPoint(poly: Pt[], x: number, y: number): Pt {
  let best: Pt = poly[0]
  let bd = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i]
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2))
    const px = ax + t * dx, py = ay + t * dy
    const d = (px - x) ** 2 + (py - y) ** 2
    if (d < bd - 1e-9) {
      bd = d
      best = [px, py]
    }
  }
  return best
}

const nearestOf = (vals: number[], target: number): number =>
  vals.reduce((b, v) => (Math.abs(v - target) < Math.abs(b - target) - 1e-9 ? v : b), vals[0])

function distinctSorted(vals: number[]): number[] {
  const s = [...vals].sort((a, b) => a - b)
  const out: number[] = []
  for (const v of s) if (!out.length || Math.abs(v - out[out.length - 1]) > 1e-6) out.push(v)
  return out
}

const segLenMm = (pts: Pt[]): number => {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return l
}

// ─────────────────────────── Network & Y/Z hydraulics ───────────────────────────

interface Seg {
  id: string
  kind: Co2PipeKind
  fromNode: string
  toNode: string
  points: Pt[]
  /** Fittings equivalent length in pipe diameters. */
  fitD: number
  nozzles: number
  size: number
}

interface SegResult {
  seg: Seg
  idIn: number
  lengthFt: number
  fittingsFt: number
  flow: number
  startPsi: number
  endPsi: number
  y1: number
  y2: number
  z1: number
  z2: number
}

function solveSegment(storage: Co2Storage, q: number, D: number, L: number, p1: number): { p2: number; y1: number; y2: number; z1: number; z2: number } {
  const { y: y1, z: z1 } = yzAt(storage, p1)
  const k = (q * q) / (3647 * Math.pow(D, 5.25))
  let y2 = y1
  let z2 = z1
  let p2 = p1
  for (let it = 0; it < 200; it++) {
    const yn = y1 + (L + 8.08 * Math.pow(D, 1.25) * (z2 - z1)) * k
    p2 = pressureAtY(storage, yn)
    z2 = yzAt(storage, p2).z
    const done = Math.abs(yn - y2) < 1e-9
    y2 = yn
    if (done) break
  }
  return { p2, y1, y2, z1, z2 }
}

function computeNetwork(storage: Co2Storage, segs: Seg[], q: number): { rows: SegResult[]; nodeP: Map<string, number> } {
  const p0 = START_PRESSURE_PSI[storage]
  const nodeP = new Map<string, number>([['B', p0]])
  const rows: SegResult[] = []
  for (const s of segs) {
    const idIn = co2PipeId(s.size, co2Schedule(storage, s.size))
    const lengthFt = segLenMm(s.points) / 304.8
    const fittingsFt = (s.fitD * idIn) / 12
    const flow = s.nozzles * q
    const p1 = nodeP.get(s.fromNode) ?? p0
    const r = solveSegment(storage, flow, idIn, lengthFt + fittingsFt, p1)
    nodeP.set(s.toNode, r.p2)
    rows.push({ seg: s, idIn, lengthFt, fittingsFt, flow, startPsi: p1, endPsi: r.p2, y1: r.y1, y2: r.y2, z1: r.z1, z2: r.z2 })
  }
  return { rows, nodeP }
}

interface EncNetwork {
  nozzles: Co2Nozzle[]
  pipes: Co2Pipe[]
  flowRows: Co2FlowRow[]
  minPsi: number
}

function designEnclosureNetwork(
  storage: Co2Storage, floor: Co2FloorInput, e: Co2EnclosureInput, k: number, rate: number, multi: boolean
): EncNetwork {
  const pts = gridPoints(e.polygon, NOZZLE_MAX_SPACING_MM)
  const n = pts.length
  const q = rate / n
  const nozzles: Co2Nozzle[] = pts.map((p, i) => ({
    tag: `N-${floor.id}-${e.id}-${pad2(i + 1)}`, enclosureId: e.id, x: p[0], y: p[1], node: '', flowLbMin: q, pressurePsi: 0, orificeAreaIn2: 0, orificeCode: 0
  }))
  const xb = floor.storage.x, yb = floor.storage.y
  const xs = distinctSorted(nozzles.map((z) => z.x))
  const ys = distinctSorted(nozzles.map((z) => z.y))
  const xh = nearestOf(xs, xb)
  const yr = nearestOf(ys, yb)
  const rr = ys.indexOf(yr)
  const hNode = (r: number): string => `H-${e.id}-${r}`
  for (const z of nozzles) {
    const r = ys.findIndex((y) => Math.abs(y - z.y) < 1e-6)
    z.node = Math.abs(z.x - xh) < 1e-6 ? hNode(r) : z.tag
  }
  const rowCount = (r: number): number => nozzles.filter((z) => Math.abs(z.y - ys[r]) < 1e-6).length
  const dedupe = (a: Pt[]): Pt[] => {
    const o: Pt[] = []
    for (const p of a) if (!o.length || Math.abs(o[o.length - 1][0] - p[0]) > 1e-9 || Math.abs(o[o.length - 1][1] - p[1]) > 1e-9) o.push(p)
    if (o.length < 2) o.push([...o[0]] as Pt)
    return o
  }
  const segs: Seg[] = []
  const yOff = yb + 400 * k
  const mainPts = dedupe([[xb, yOff], [xh, yOff], [xh, yr]])
  segs.push({
    id: `${floor.id}-${e.id}-M`, kind: 'main', fromNode: 'B', toNode: hNode(rr), points: mainPts,
    fitD: Math.max(0, mainPts.length - 2) * 30 + (multi ? 100 : 0), nozzles: n, size: 0
  })
  let hc = 0
  for (const dir of [1, -1]) {
    let remaining = 0
    for (let r = rr + dir; r >= 0 && r < ys.length; r += dir) remaining += rowCount(r)
    for (let r = rr; r + dir >= 0 && r + dir < ys.length; r += dir) {
      hc++
      segs.push({
        id: `${floor.id}-${e.id}-H${hc}`, kind: 'header', fromNode: hNode(r), toNode: hNode(r + dir),
        points: [[xh, ys[r]], [xh, ys[r + dir]]], fitD: 20, nozzles: remaining, size: 0
      })
      remaining -= rowCount(r + dir)
    }
  }
  let bc = 0
  for (let r = 0; r < ys.length; r++) {
    const row = nozzles.filter((z) => Math.abs(z.y - ys[r]) < 1e-6)
    for (const side of [1, -1]) {
      const chain = row.filter((z) => (z.x - xh) * side > 1e-6).sort((a, b) => (a.x - b.x) * side)
      let prevNode = hNode(r)
      let prevX = xh
      chain.forEach((z, i) => {
        bc++
        segs.push({
          id: `${floor.id}-${e.id}-B${bc}`, kind: 'branch', fromNode: prevNode, toNode: z.node,
          points: [[prevX, ys[r]], [z.x, ys[r]]], fitD: i === 0 ? 60 : 20, nozzles: chain.length - i, size: 0
        })
        prevNode = z.node
        prevX = z.x
      })
    }
  }
  // sizing
  const sch = (s: number): number => co2PipeId(s, co2Schedule(storage, s))
  for (const s of segs) {
    const flow = s.nozzles * q
    s.size = CO2_PIPE_SIZES.find((sz) => Math.sqrt((3647 * Math.pow(sch(sz), 5.25) * 2000) / 100) >= flow) ?? 4
  }
  const pMin = MIN_NOZZLE_PRESSURE_PSI[storage]
  let net = computeNetwork(storage, segs, q)
  for (let it = 0; it < 500; it++) {
    let worst = nozzles[0]
    for (const z of nozzles) if ((net.nodeP.get(z.node) ?? 0) < (net.nodeP.get(worst.node) ?? 0)) worst = z
    if ((net.nodeP.get(worst.node) ?? 0) >= pMin) break
    const path: SegResult[] = []
    let node = worst.node
    while (node !== 'B') {
      const r = net.rows.find((x) => x.seg.toNode === node)
      if (!r) break
      path.push(r)
      node = r.seg.fromNode
    }
    let pick: SegResult | null = null
    for (const r of path) {
      if (r.seg.size >= 4) continue
      if (!pick || r.startPsi - r.endPsi > pick.startPsi - pick.endPsi) pick = r
    }
    if (!pick) break
    pick.seg.size = CO2_PIPE_SIZES[CO2_PIPE_SIZES.indexOf(pick.seg.size) + 1]
    net = computeNetwork(storage, segs, q)
  }
  for (const z of nozzles) {
    z.pressurePsi = net.nodeP.get(z.node) ?? 0
    z.orificeAreaIn2 = q / nozzleFluxAt(storage, z.pressurePsi)
    let c = 1
    while ((Math.PI / 4) * (c / 32) ** 2 < z.orificeAreaIn2 && c < 200) c += 0.5
    z.orificeCode = c
  }
  const pipes: Co2Pipe[] = net.rows.map((r) => ({
    id: r.seg.id, enclosureId: e.id, kind: r.seg.kind, sizeIn: r.seg.size, schedule: co2Schedule(storage, r.seg.size),
    points: r.seg.points, lengthM: segLenMm(r.seg.points) / 1000, fittingsFt: r.fittingsFt, fromNode: r.seg.fromNode,
    toNode: r.seg.toNode, flowLbMin: r.flow, startPsi: r.startPsi, endPsi: r.endPsi
  }))
  const flowRows: Co2FlowRow[] = net.rows.map((r) => ({
    pipeId: r.seg.id, fromNode: r.seg.fromNode, toNode: r.seg.toNode, flowLbMin: r.flow, sizeIn: r.seg.size, idIn: r.idIn,
    lengthFt: r.lengthFt, fittingsFt: r.fittingsFt, startPsi: r.startPsi, endPsi: r.endPsi, y1: r.y1, y2: r.y2, z1: r.z1, z2: r.z2
  }))
  return { nozzles, pipes, flowRows, minPsi: Math.min(...nozzles.map((z) => z.pressurePsi)) }
}

// ─────────────────────────── Devices ───────────────────────────

function enclosureDevices(
  fl: Co2FloorInput, e: Co2EnclosureInput, k: number, multi: boolean, detection: 'smoke-cross-zoned' | 'heat' | 'none-manual'
): Co2Device[] {
  const out: Co2Device[] = []
  const poly = e.polygon as Pt[]
  if (detection !== 'none-manual') {
    const smoke = detection === 'smoke-cross-zoned'
    const dp = gridPoints(poly, smoke ? SMOKE_DETECTOR_SPACING_MM : HEAT_DETECTOR_SPACING_MM)
    if (smoke && dp.length === 1) {
      const [x, y] = dp[0]
      dp.push(pointInPolygon(x + 1000, y, poly) ? [x + 1000, y] : [x - 1000, y])
    }
    dp.forEach((p, i) => {
      out.push({
        tag: `${smoke ? 'SD' : 'HD'}-${fl.id}-${e.id}-${pad2(i + 1)}`, kind: smoke ? 'smoke-detector' : 'heat-detector',
        enclosureId: e.id, x: p[0], y: p[1], zone: i % 2 === 0 ? 'A' : 'B'
      })
    })
  }
  const entry = nearestBoundaryPoint(poly, fl.storage.x, fl.storage.y)
  const c = polygonCentroid(poly)
  let ux = c[0] - entry[0], uy = c[1] - entry[1]
  const ul = Math.hypot(ux, uy)
  if (ul < 1e-9) { ux = 1; uy = 0 } else { ux /= ul; uy /= ul }
  const inside = (d: number): Pt => {
    for (const dd of [d, d / 2, d / 4]) {
      const p: Pt = [entry[0] + dd * ux, entry[1] + dd * uy]
      if (pointInPolygon(p[0], p[1], poly)) return p
    }
    return c
  }
  const at = (d: number, t = 0): Pt => [entry[0] + d * ux - t * uy, entry[1] + d * uy + t * ux]
  const named = (prefix: string, kind: Co2DeviceKind, p: Pt, suffix = ''): void => {
    out.push({ tag: `${prefix}-${fl.id}-${e.id}${suffix}`, kind, enclosureId: e.id, x: p[0], y: p[1] })
  }
  named('HS', 'horn-strobe', inside(1000))
  named('SO', 'strobe-outside', at(-600, -300))
  named('MR', 'manual-release', at(-600, 0))
  named('WS', 'warning-sign', at(-600, 300), '-1')
  named('WS', 'warning-sign', inside(1600), '-2')
  let far = poly[0]
  let fd = -1
  for (const p of poly) {
    const d = Math.hypot(p[0] - entry[0], p[1] - entry[1])
    if (d > fd) { fd = d; far = p }
  }
  named('RV', 'pressure-relief-vent', far)
  if (multi) named('SV', 'selector-valve', [fl.storage.x + 600, fl.storage.y + 400 * k])
  return out
}

// ─────────────────────────── Checks ───────────────────────────

function enclosureChecks(
  fl: Co2FloorInput, e: Co2EnclosureInput, r: {
    q: Co2QuantityBreakdown; rate: number; dischargeMin: number; thirtyPctLb: number; minPsi: number; pMin: number
    nozzles: Co2Nozzle[]; pipes: Co2Pipe[]; storage: Co2Storage; timeDelayS: number
  }
): DesignCheck[] {
  const sfx = `${fl.id}/${e.id}`
  const mk = (name: string, title: string, reference: string, status: DesignCheck['status'], detail: string): DesignCheck => ({
    id: `co2-${name}:${sfx}`, title: `${e.name}: ${title}`, reference, status, detail
  })
  const surface = e.fireType === 'surface'
  const out: DesignCheck[] = []
  out.push(e.occupancy === 'normally-occupied'
    ? mk('occupancy', 'CO2 total flooding in a normally occupied enclosure', CO2_REFERENCE_DESIGN, 'fail',
        'CO2 total flooding is not permitted in normally occupied enclosures; use an NFPA 2001 clean agent or water-based protection.')
    : mk('occupancy', 'Occupancy suitable for CO2 total flooding', CO2_REFERENCE_DESIGN, 'pass',
        `Enclosure is ${e.occupancy.replace('-', ' ')}; lockout, alarms, signs and a pre-discharge delay are provided.`))
  out.push(mk('nozzle-pressure', 'Minimum nozzle pressure', CO2_REFERENCE_DESIGN, r.minPsi >= r.pMin ? 'pass' : 'fail',
    `Lowest nozzle pressure ${f1(r.minPsi)} psi (${f1(r.minPsi * 0.0689476)} bar) against the ${r.pMin} psi minimum for ${r.storage} storage; ${r.nozzles.length} nozzle(s) at ${f1(r.rate / r.nozzles.length)} lb/min each.`))
  if (surface)
    out.push(mk('discharge', 'Liquid discharge time (surface fire)', CO2_REFERENCE_QUANTITY, r.dischargeMin <= 1 + 1e-9 ? 'pass' : 'fail',
      `${f1(r.q.totalLb)} lb (${f1(r.q.totalLb / LB_PER_KG)} kg) discharged in ${r.dischargeMin.toFixed(2)} min at ${f1(r.rate)} lb/min; design time is 1 min.`))
  else {
    const ok = r.dischargeMin <= 7 + 1e-9 && r.rate >= r.thirtyPctLb / 2 - 1e-9
    out.push(mk('discharge', 'Liquid discharge time and 30 % in 2 min (deep-seated fire)', CO2_REFERENCE_QUANTITY, ok ? 'pass' : 'fail',
      `${f1(r.q.totalLb)} lb (${f1(r.q.totalLb / LB_PER_KG)} kg) in ${r.dischargeMin.toFixed(2)} min (limit 7 min) at ${f1(r.rate)} lb/min; 30 % quantity ${f1(r.thirtyPctLb)} lb needs at least ${f1(r.thirtyPctLb / 2)} lb/min within 2 min.`))
  }
  out.push(surface
    ? mk('openings', 'Uncloseable openings', CO2_REFERENCE_QUANTITY, 'pass',
        `Surface fire: openings of ${e.openingsM2.toFixed(2)} m2 are compensated with ${f1(r.q.openingsLb)} lb of additional CO2.`)
    : e.openingsM2 > 0
      ? mk('openings', 'Uncloseable openings', CO2_REFERENCE_QUANTITY, 'warn',
          `Deep-seated fire with ${e.openingsM2.toFixed(2)} m2 of openings (${f1(r.q.openingsLb)} lb added); openings should be closed to hold the concentration for the ${20}-min soak.`)
      : mk('openings', 'Uncloseable openings', CO2_REFERENCE_QUANTITY, 'pass', 'No uncloseable openings; enclosure must stay sealed for the 20-min soak.'))
  out.push(e.ventilationM3min <= 0
    ? mk('ventilation', 'Ventilation at discharge', CO2_REFERENCE_QUANTITY, 'pass', 'Ventilation is shut down or interlocked at discharge.')
    : surface
      ? mk('ventilation', 'Ventilation at discharge', CO2_REFERENCE_QUANTITY, 'warn',
          `${f1(e.ventilationM3min)} m3/min ventilation is compensated with ${f1(r.q.ventilationLb)} lb of CO2; shutting it down at discharge is preferred.`)
      : mk('ventilation', 'Ventilation at discharge', CO2_REFERENCE_QUANTITY, 'fail',
          `${f1(e.ventilationM3min)} m3/min ventilation must be shut down before discharge to hold the deep-seated concentration for the soak time.`))
  out.push(mk('time-delay', 'Pre-discharge time delay', CO2_REFERENCE_DESIGN, r.timeDelayS >= MIN_TIME_DELAY_S ? 'pass' : 'fail',
    `Delay ${r.timeDelayS} s against the ${MIN_TIME_DELAY_S} s minimum for evacuation before discharge.`))
  let rmin = Infinity, rmax = 0
  for (const z of r.nozzles) {
    // Nozzle drop is taken from the smallest pipe connected at its node (header-node nozzles sit on the line).
    const con = r.pipes.filter((p) => p.toNode === z.node || p.fromNode === z.node)
    if (con.length === 0) continue
    const id = Math.min(...con.map((p) => co2PipeId(p.sizeIn, p.schedule)))
    const ratio = z.orificeAreaIn2 / ((Math.PI / 4) * id * id)
    rmin = Math.min(rmin, ratio)
    rmax = Math.max(rmax, ratio)
  }
  const okRatio = !Number.isFinite(rmin) || (rmin >= 0.1 && rmax <= 0.7)
  out.push(mk('orifice-ratio', 'Nozzle orifice area / supply pipe area', CO2_REFERENCE_DESIGN, okRatio ? 'pass' : 'warn',
    Number.isFinite(rmin)
      ? `Orifice-to-pipe area ratio ${(rmin * 100).toFixed(1)} % to ${(rmax * 100).toFixed(1)} % against the 10–70 % range; confirm nozzle drilling with the manufacturer's listing.`
      : 'No supply pipe found for the nozzles.'))
  out.push(e.heightM > 6
    ? mk('height', 'Enclosure height', CO2_REFERENCE_DESIGN, 'warn', `Height ${e.heightM.toFixed(1)} m exceeds 6 m; add nozzle tiers per the manufacturer's listing.`)
    : mk('height', 'Enclosure height', CO2_REFERENCE_DESIGN, 'pass', `Height ${e.heightM.toFixed(1)} m is within the single-tier nozzle layout.`))
  return out
}

// ─────────────────────────── Orchestrator ───────────────────────────

export function designCo2System(input: Co2DesignInput): Co2SystemDesign {
  const a = input.answers
  const storage: Co2Storage = a.storage
  const pMin = MIN_NOZZLE_PRESSURE_PSI[storage]
  const floors: Co2FloorDesign[] = []
  const allEnc: Co2EnclosureResult[] = []
  for (const fl of input.floors) {
    const multi = fl.enclosures.length > 1
    const encResults: Co2EnclosureResult[] = []
    const pipes: Co2Pipe[] = []
    const devices: Co2Device[] = []
    fl.enclosures.forEach((e, k) => {
      const qr = computeQuantity(e)
      const net = designEnclosureNetwork(storage, fl, e, k, qr.rate, multi)
      pipes.push(...net.pipes)
      devices.push(...enclosureDevices(fl, e, k, multi, a.detection))
      const ventAreaMm2 = (239 * (qr.rate / LB_PER_KG)) / Math.sqrt(e.strengthPsf * KPA_PER_PSF)
      const checks = enclosureChecks(fl, e, {
        q: qr.q, rate: qr.rate, dischargeMin: qr.dischargeMin, thirtyPctLb: qr.thirtyPctLb, minPsi: net.minPsi, pMin,
        nozzles: net.nozzles, pipes: net.pipes, storage, timeDelayS: a.timeDelayS
      })
      encResults.push({
        enclosureId: e.id, floorId: fl.id, name: e.name, fireType: e.fireType, hazardLabel: qr.hazardLabel, areaM2: qr.areaM2,
        quantity: qr.q, rateLbMin: qr.rate, dischargeTimeMin: qr.dischargeMin, thirtyPctLb: qr.thirtyPctLb, soakMin: qr.soakMin,
        nozzles: net.nozzles, ventAreaIn2: ventAreaMm2 / 645.16, ventAreaMm2,
        cylinders: storage === 'high-pressure' ? Math.ceil(qr.q.totalLb / a.cylinderLb - 1e-9) : 0,
        flowRows: net.flowRows, minNozzlePressurePsi: net.minPsi, checks
      })
    })
    const sx = fl.storage.x, sy = fl.storage.y
    const fdev = (tag: string, kind: Co2DeviceKind, dx: number, dy: number): void => {
      devices.push({ tag: `${tag}-${fl.id}`, kind, enclosureId: null, x: sx + dx, y: sy + dy })
    }
    fdev('CP', 'control-panel', -800, 800)
    fdev('LV', 'lockout-valve', 0, 600)
    fdev('PS', 'pressure-switch', 300, 600)
    fdev('WS', 'warning-sign', -800, 0)
    floors.push({ floorId: fl.id, floorName: fl.name, storage: { ...fl.storage }, enclosures: encResults, pipes, devices, checks: [] })
    allEnc.push(...encResults)
  }
  // storage
  let gov: Co2EnclosureResult | null = null
  for (const e of allEnc) if (!gov || e.quantity.totalLb > gov.quantity.totalLb) gov = e
  const mainLb = gov ? gov.quantity.totalLb : 0
  const reserveLb = a.reserve ? mainLb : 0
  const hp = storage === 'high-pressure'
  const mainCyl = hp ? Math.max(0, ...allEnc.map((e) => e.cylinders)) : 0
  const reserveCyl = hp && a.reserve ? mainCyl : 0
  const tankTons = hp ? null : (TANK_TONS.find((t) => t >= (mainLb + reserveLb) / 2000) ?? TANK_TONS[TANK_TONS.length - 1])
  const st: Co2StorageDesign = {
    storage, governingEnclosureId: gov ? gov.enclosureId : null, mainLb, reserveLb, cylinderLb: a.cylinderLb,
    mainCylinders: mainCyl, reserveCylinders: reserveCyl, tankTons,
    installedLb: hp ? (mainCyl + reserveCyl) * a.cylinderLb : (tankTons ?? 0) * 2000
  }
  const sys: DesignCheck[] = []
  sys.push(allEnc.length > 1 && !a.reserve
    ? { id: 'co2-reserve', title: 'Reserve supply', reference: CO2_REFERENCE_DESIGN, status: 'warn',
        detail: `One supply of ${f1(mainLb)} lb serves ${allEnc.length} enclosures with no connected reserve; provide a reserve where the hazards must be re-protected after a discharge.` }
    : { id: 'co2-reserve', title: 'Reserve supply', reference: CO2_REFERENCE_DESIGN, status: 'pass',
        detail: a.reserve ? `Connected reserve of ${f1(reserveLb)} lb equal to the main supply.` : 'Single protected enclosure; no reserve required by this design.' })
  sys.push(a.odorizer
    ? { id: 'co2-odorizer', title: 'CO2 odorizer', reference: CO2_REFERENCE_DESIGN, status: 'pass', detail: 'Odorizer provided so a discharge can be detected by smell.' }
    : { id: 'co2-odorizer', title: 'CO2 odorizer', reference: CO2_REFERENCE_DESIGN, status: 'warn', detail: 'No odorizer selected; an odorizer is required where the discharge could go unnoticed in occupiable spaces.' })
  sys.push(a.detection === 'none-manual'
    ? { id: 'co2-detection', title: 'Automatic detection', reference: CO2_REFERENCE_DESIGN, status: 'warn', detail: 'Manual release only; automatic detection and release is recommended for total flooding.' }
    : { id: 'co2-detection', title: 'Automatic detection', reference: CO2_REFERENCE_DESIGN, status: 'pass',
        detail: a.detection === 'heat' ? 'Heat detection releases the system.' : 'Cross-zoned smoke detection releases the system (NFPA 72).' })
  const result: Co2SystemDesign = {
    floors, storage: st, accessories: [], bom: [], totalNozzles: allEnc.reduce((s, e) => s + e.nozzles.length, 0),
    checks: [...allEnc.flatMap((e) => e.checks), ...sys]
  }
  result.accessories = buildCo2Accessories(input, result)
  result.bom = buildCo2Bom(input, result)
  return result
}
