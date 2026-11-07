/**
 * Sprinkler shop drawings (NFPA 13-2019): one A1 sheet per floor (FS-101 …) over the client's architectural plan,
 * FS-501 riser diagram & details and FS-601 hydraulic calculations. `combined` holds every sheet left → right.
 */
import type { FireDesignResult } from '../fpTypes'
import { DRY_SLOPE_BRANCH_MM_PER_M, DRY_SLOPE_MAIN_MM_PER_M } from '../sprinkler/nfpa13Sprinkler'
import type {
  FloorPlan,
  SprinklerFloorDesign,
  SprinklerFloorInput,
  SprinklerHeadType,
  SprinklerPipe
} from '../sprinkler/sprinklerTypes'
import type { Drawing } from './drawingTypes'
import { northArrow } from './symbols'
import {
  type Box,
  type Ctx,
  Placer,
  PX,
  PY,
  type Pt,
  autoCols,
  dimBoxes,
  drawNotes,
  drawTable,
  measureTable,
  notesHeight,
  sheetTitle,
  textBox,
  textWidth
} from './sheetKit'
import {
  HAZARD_LABEL,
  SYSTEM_LABEL,
  type SheetSpec,
  archLayerName,
  assembleSprinklerDrawing,
  hatchRectOn,
  headSymbol,
  headTypeText,
  pointInPolygon,
  sizeLabel
} from './sprinklerSheetKit'
import { drawArchUnderlay, loadFloorPlan } from './sheetUnderlay'
import { drawRiserSheet } from './sprinklerSheetRiser'
import { drawHydraulicSheet } from './sprinklerSheetHydraulics'

export const FLOOR_SCALES = [50, 75, 100, 150, 200, 250, 500]
/** Plan area and right-hand information panel (paper mm). */
const PA = { x0: 24, y0: 16, x1: 586, y1: 545 }
const PANEL = { x0: 592, x1: 829 }
const MARGIN_X = 22
const MARGIN_Y = 24
const WINDOW_MM = 1500

interface FloorData {
  index: number
  fi: SprinklerFloorInput
  fd: SprinklerFloorDesign
  plan: FloorPlan | null
}

interface BoxMm {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function sprinklerContentBBox(d: FloorData): BoxMm {
  const bb: BoxMm = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const add = (p: Pt): void => {
    bb.minX = Math.min(bb.minX, p[0])
    bb.maxX = Math.max(bb.maxX, p[0])
    bb.minY = Math.min(bb.minY, p[1])
    bb.maxY = Math.max(bb.maxY, p[1])
  }
  for (const r of d.fi.rooms) r.polygon.forEach(add)
  for (const h of d.fd.heads) add([h.x, h.y])
  for (const p of d.fd.pipes) p.points.forEach(add)
  add([d.fd.riser.x, d.fd.riser.y])
  add([d.fd.inspectorTest.x, d.fd.inspectorTest.y])
  if (!Number.isFinite(bb.minX)) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
  return bb
}

export function pickFloorScale(d: FloorData): number {
  const bb = sprinklerContentBBox(d)
  const w = bb.maxX - bb.minX + 2 * WINDOW_MM
  const h = bb.maxY - bb.minY + 2 * WINDOW_MM
  for (const s of FLOOR_SCALES) {
    if (w / s + 2 * MARGIN_X <= PA.x1 - PA.x0 && h / s + 2 * MARGIN_Y <= PA.y1 - PA.y0) return s
  }
  return 500
}

const f1 = (v: number, d = 1): string => v.toFixed(d)
const MATERIAL: Record<string, string> = {
  'black-steel-sch40': 'BLACK STEEL PIPE SCH 40',
  'black-steel-sch10': 'BLACK STEEL PIPE SCH 10',
  'galvanized-steel-sch40': 'GALVANIZED STEEL PIPE SCH 40',
  cpvc: 'CPVC PIPE (LISTED)',
  'copper-type-l': 'COPPER TUBE TYPE L'
}

function floorNotes(c: Ctx, d: FloorData): string[] {
  const { r } = c
  const sd = r.input.sprinklerDesign!
  const g = d.fd.governing
  const sys = d.fd.systemType
  const nipple = d.fd.pipes.find((p) => p.kind === 'riser-nipple')?.sizeIn ?? 2
  const notes: string[] = [
    'WORKING PLANS FOR APPROVAL BY THE AUTHORITY HAVING JURISDICTION (AHJ) BEFORE FABRICATION. INSTALL TO NFPA 13-2019 (INSTALLATION OF SPRINKLER SYSTEMS), NFPA 25 AND NFPA 72 AS ADOPTED BY THE AHJ.',
    g
      ? `HYDRAULICALLY CALCULATED SYSTEM: ${HAZARD_LABEL[g.hazard] ?? g.hazard.toUpperCase()} HAZARD, ${f1(g.densityGpmFt2, 2)} GPM/FT2 OVER ${f1(g.designAreaFt2, 0)} FT2 (NFPA 13-2019 SEC. 19.3.3.1, 28.2). PIPE SIZES AND LENGTHS SHOWN ARE THE CALCULATED ONES (FS-601); NO CHANGE WITHOUT A NEW CALCULATION.`
      : 'HYDRAULICALLY CALCULATED SYSTEM (NFPA 13-2019 SEC. 28.2). PIPE SIZES AND LENGTHS SHOWN ARE THE CALCULATED ONES; NO CHANGE WITHOUT A NEW CALCULATION.',
    'SPRINKLERS: NEW, LISTED, K-FACTOR AND TEMPERATURE RATING AS IN THE LEGEND. QUICK-RESPONSE SPRINKLERS IN LIGHT HAZARD OCCUPANCIES (NFPA 13-2019 SEC. 9.5.3.2).',
    'SPACING: MAXIMUM PROTECTION AREA AND SPACING PER NFPA 13-2019 SEC. 10.2.4; MINIMUM 1.83 M (6 FT) BETWEEN SPRINKLERS (SEC. 10.2.5.3); MINIMUM 102 MM (4 IN) FROM WALLS (SEC. 10.2.5.2.3).',
    'DEFLECTOR DISTANCE BELOW THE CEILING 25 MM (1 IN) MINIMUM TO 305 MM (12 IN) MAXIMUM (NFPA 13-2019 SEC. 10.2.6.1.1). SEE INSTALLATION DETAILS ON FS-501. COORDINATE SPRINKLER POSITIONS WITH THE REFLECTED CEILING PLAN.',
    'OBSTRUCTIONS (LIGHTS, DUCTS, BEAMS, CABLE TRAYS): MAINTAIN THE CLEARANCES OF NFPA 13-2019 CH. 10. MOVE A SPRINKLER ONLY ALONG ITS BRANCH LINE AND WITHIN THE SPACING LIMITS OF NOTE 4; REPORT TO THE ENGINEER.',
    `PIPE: ${MATERIAL[sd.answers.pipeMaterial] ?? 'STEEL PIPE'}; NOMINAL SIZES AS LABELLED, LENGTHS IN METRES BETWEEN SPRINKLERS / FITTINGS. THREADED OR GROOVED FITTINGS LISTED FOR FIRE SERVICE.`,
    `HANGERS (SHORT TICKS): MAXIMUM SPACING 3.7 M (12 FT) FOR 1" PIPE AND 4.6 M (15 FT) FOR 1-1/4" AND LARGER (NFPA 13-2019 TABLE 17.4.2.1(a)); SEE HANGER DETAIL ON FS-501.${sd.answers.seismic ? ' SEISMIC SWAY BRACING, FLEXIBLE COUPLINGS AND CLEARANCES PER NFPA 13-2019 CH. 18.' : ''}`,
    `FLOOR CONTROL ASSEMBLY ${sizeLabel(nipple)}: SUPERVISED CONTROL VALVE WITH TAMPER SWITCH, WATERFLOW SWITCH, PRESSURE GAUGE AND TEST & DRAIN WITH SIGHT GLASS (NFPA 13-2019 SEC. 16.9.1, 16.9.3, 16.13). SEE FS-501.`,
    'INSPECTOR\'S TEST: 1" CONNECTION WITH AN ORIFICE EQUAL TO THE SMALLEST SPRINKLER K-FACTOR AT THE HYDRAULICALLY MOST REMOTE POINT, DISCHARGING TO A SAFE VISIBLE LOCATION (NFPA 13-2019 SEC. 16.14.2). AUXILIARY DRAINS AT TRAPPED SECTIONS (SEC. 16.10.5).',
    'SPARE SPRINKLERS: CABINET WITH SPARE SPRINKLERS OF EVERY TYPE AND A SPRINKLER WRENCH IN THE VALVE ROOM, TEMPERATURE NOT ABOVE 38 C (100 F) (NFPA 13-2019 SEC. 16.2.7). SEE FS-501.'
  ]
  if (sys === 'wet') {
    notes.push(
      'WET-PIPE SYSTEM: PIPING PERMANENTLY WATER-FILLED AND KEPT ABOVE 4 C (40 F); DRY-PENDENT SPRINKLERS IN ANY AREA EXPOSED TO FREEZING; AUTOMATIC AIR VENT AT HIGH POINTS (NFPA 13-2019 SEC. 16.7).'
    )
  } else if (sys === 'dry') {
    notes.push(
      `DRY-PIPE SYSTEM - PIPING SLOPE: BRANCH LINES AT LEAST ${DRY_SLOPE_BRANCH_MM_PER_M} MM/M (1/2 IN PER 10 FT) AND CROSS MAINS AT LEAST ${DRY_SLOPE_MAIN_MM_PER_M} MM/M (1/4 IN PER 10 FT) TOWARD THE DRAINS (SLOPE ARROWS ON THE PLAN); AUXILIARY DRAINS / DRUM DRIPS AT LOW POINTS (NFPA 13-2019 SEC. 16.10.3). DESIGN AREA INCREASED BY 30 %. FLOOR PIPING VOLUME ${f1(d.fd.volumeGal, 0)} GAL.`
    )
  } else if (sys === 'deluge') {
    notes.push(
      `DELUGE SYSTEM: OPEN SPRINKLERS, PIPING DRY. DETECTION RELEASES THE DELUGE VALVE AND ALL SPRINKLERS OF THE ZONE DISCHARGE (NFPA 13-2019 SEC. 8.3.3). PIPING SLOPE: BRANCH LINES ${DRY_SLOPE_BRANCH_MM_PER_M} MM/M, CROSS MAINS ${DRY_SLOPE_MAIN_MM_PER_M} MM/M TOWARD THE DRAINS (SEE SLOPE ARROWS). THE DRY PIPING IS NOT WATER-FILLED UNTIL RELEASE.`
    )
  } else {
    notes.push(
      `PREACTION SYSTEM (${sys === 'preaction-double' ? 'DOUBLE' : 'SINGLE'} INTERLOCK): DRY-CHARGED PIPING RELEASED BY DETECTION (NFPA 13-2019 SEC. 8.3.2, NFPA 72). PIPING SLOPE: BRANCH LINES AT LEAST ${DRY_SLOPE_BRANCH_MM_PER_M} MM/M, CROSS MAINS AT LEAST ${DRY_SLOPE_MAIN_MM_PER_M} MM/M TOWARD THE DRAINS (SEE SLOPE ARROWS). DRY PIPING SUPERVISED WITH AIR.`
    )
  }
  notes.push(
    'HYDROSTATIC TEST AT 200 PSI (14 BAR) FOR 2 HOURS, OR 50 PSI (3.4 BAR) ABOVE THE MAXIMUM WORKING PRESSURE IF HIGHER (NFPA 13-2019 SEC. 25.2.2). FLUSH THE PIPING BEFORE SPRINKLERS ARE INSTALLED.',
    'GREY ARCHITECTURAL UNDERLAY (LAYERS A-*) IS THE CLIENT FLOOR PLAN, FOR REFERENCE ONLY; ITS TEXT IS NOT SHOWN. CONTRACTOR TO FIELD-VERIFY DIMENSIONS AND CEILING HEIGHTS AND COORDINATE WITH OTHER TRADES. DIMENSIONS IN MM, ELEVATIONS IN M.'
  )
  return notes
}

/** Shrink the text height until the table fits `maxW`. */
function fitTable(
  c: Ctx,
  x: number,
  yTop: number,
  rows: string[][],
  th0: number,
  maxW: number,
  title: string,
  align?: boolean[]
): { w: number; h: number } {
  let th = th0
  let cols = autoCols(rows, th)
  while (th > 1.5 && measureTable(cols, rows, { th, title }).w > maxW) {
    th -= 0.1
    cols = autoCols(rows, th)
  }
  return drawTable(c, x, yTop, cols, rows, { th, title, alignRight: align })
}

interface LegendItem {
  text: string
  draw: (x: number, y: number) => void
}

function drawLegend(c: Ctx, xP: number, yTopP: number, w: number, items: LegendItem[]): number {
  const { b, sheet } = c
  const s = sheet.scale
  const X = (v: number): number => PX(c, v)
  const Y = (v: number): number => PY(c, v)
  const rowH = 5.6
  const h = 7 + items.length * rowH + 1
  b.rect('FS-LEGEND', X(xP), Y(yTopP - h), w * s, h * s)
  b.text('FS-LEGEND', X(xP + 3), Y(yTopP - 3.5), 3.2, 'LEGEND', { vAlign: 'middle' })
  b.line('FS-LEGEND', X(xP), Y(yTopP - 7), X(xP + w), Y(yTopP - 7))
  items.forEach((it, i) => {
    const y = yTopP - 7 - rowH * (i + 0.5)
    it.draw(X(xP + 8), Y(y))
    b.text('FS-LEGEND', X(xP + 17), Y(y), 2.1, it.text, { vAlign: 'middle' })
  })
  return h
}

/** Point at fraction t along a polyline (by length) and the local direction. */
function alongPolyline(pts: Pt[], t: number): { p: Pt; u: Pt } | null {
  let total = 0
  const lens: number[] = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
    lens.push(l)
    total += l
  }
  if (total < 1e-6) return null
  let rest = t * total
  for (let i = 0; i < lens.length; i++) {
    if (rest <= lens[i] || i === lens.length - 1) {
      const k = lens[i] < 1e-9 ? 0 : Math.min(1, rest / lens[i])
      const dx = pts[i + 1][0] - pts[i][0]
      const dy = pts[i + 1][1] - pts[i][1]
      const l = lens[i] || 1
      return { p: [pts[i][0] + dx * k, pts[i][1] + dy * k], u: [dx / l, dy / l] }
    }
    rest -= lens[i]
  }
  return null
}

const pipeLayer = (p: SprinklerPipe): string =>
  p.kind === 'branch'
    ? 'FS-PIPE-BRANCH'
    : p.kind === 'riser-nipple'
      ? 'FS-PIPE-RISER'
      : 'FS-PIPE-MAIN'
const pipeGroup = (p: SprinklerPipe): string =>
  p.kind === 'branch' ? p.id.replace(/-\d+$/, '') : p.kind

export function drawFloorSheet(c: Ctx, d: FloorData): void {
  const { b, sheet, r } = c
  const S = sheet.scale
  const spr = r.sprinklers!
  const { fd, fi } = d
  const typeById = new Map<string, SprinklerHeadType>(spr.headTypes.map((t) => [t.id, t]))
  const dryLike = fd.systemType !== 'wet'
  const bb = sprinklerContentBBox(d)
  const cx = (bb.minX + bb.maxX) / 2
  const cy = (bb.minY + bb.maxY) / 2
  const ox = sheet.originX + ((PA.x0 + PA.x1) / 2) * S
  const oy = sheet.originY + ((PA.y0 + PA.y1) / 2) * S
  const M = (p: Pt): Pt => [ox + (p[0] - cx), oy + (p[1] - cy)]
  const paBox: Box = { x0: PX(c, PA.x0), y0: PY(c, PA.y0), x1: PX(c, PA.x1), y1: PY(c, PA.y1) }
  const P = new Placer(c, paBox)

  // ───────── architectural underlay (A-*), clipped to the window around the sprinkler content ─────────
  if (d.plan) {
    const lo = M([bb.minX - WINDOW_MM, bb.minY - WINDOW_MM])
    const hi = M([bb.maxX + WINDOW_MM, bb.maxY + WINDOW_MM])
    const win = {
      x0: Math.max(lo[0], paBox.x0),
      y0: Math.max(lo[1], paBox.y0),
      x1: Math.min(hi[0], paBox.x1),
      y1: Math.min(hi[1], paBox.y1)
    }
    drawArchUnderlay(b, d.plan, M, win)
  }

  // ───────── room outlines ─────────
  for (const rm of fi.rooms) b.polyline('FS-ROOM', rm.polygon.map(M), true)

  // ───────── pipes, slope arrows, hangers ─────────
  const pipeById = new Map(fd.pipes.map((p) => [p.id, p]))
  for (const p of fd.pipes) {
    if (p.points.length < 2) continue
    const pts = p.points.map(M)
    if (
      p.kind === 'riser-nipple' &&
      Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1
    )
      continue
    b.polyline(pipeLayer(p), pts, false)
    // soft collision boxes along the pipe
    const steps = Math.max(
      1,
      Math.ceil(
        Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) / (3 * S)
      )
    )
    for (let i = 0; i + 1 < pts.length; i++) {
      const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
      const n = Math.max(1, Math.ceil(l / (2.5 * S)))
      for (let k = 0; k <= n; k++) {
        const x = pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * k) / n
        const y = pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * k) / n
        P.addSoft({ x0: x - 0.55 * S, y0: y - 0.55 * S, x1: x + 0.55 * S, y1: y + 0.55 * S })
      }
    }
    void steps
  }
  const slopeArrow = (p: Pt, u: Pt): void => {
    // open arrow pointing along u (toward the drain), tail 5 mm paper
    const tail = 5 * S
    const head = 1.7 * S
    const nx = -u[1]
    const ny = u[0]
    const tip: Pt = [p[0] + u[0] * tail * 0.5, p[1] + u[1] * tail * 0.5]
    const tl: Pt = [p[0] - u[0] * tail * 0.5, p[1] - u[1] * tail * 0.5]
    b.line('FS-ANNO', tl[0], tl[1], tip[0], tip[1])
    b.solid('FS-ANNO', [
      tip,
      [tip[0] - u[0] * head + nx * head * 0.4, tip[1] - u[1] * head + ny * head * 0.4],
      [tip[0] - u[0] * head - nx * head * 0.4, tip[1] - u[1] * head - ny * head * 0.4]
    ])
    P.addHard({
      x0: Math.min(tl[0], tip[0]) - 0.6 * S,
      y0: Math.min(tl[1], tip[1]) - 0.6 * S,
      x1: Math.max(tl[0], tip[0]) + 0.6 * S,
      y1: Math.max(tl[1], tip[1]) + 0.6 * S
    })
  }
  if (dryLike) {
    // one arrow per branch line (toward the cross main) and per cross-main segment (toward the riser)
    const seenGroups = new Set<string>()
    for (const p of fd.pipes) {
      if (p.kind === 'branch') {
        const g = pipeGroup(p)
        if (seenGroups.has(g)) continue
        seenGroups.add(g)
        const a = alongPolyline(p.points.map(M), 0.22)
        if (a) slopeArrow(a.p, [-a.u[0], -a.u[1]])
      } else if (p.kind === 'cross-main') {
        const pts = p.points.map(M)
        const a = alongPolyline(pts, 0.5)
        if (!a) continue
        const rm = M([fd.riser.x, fd.riser.y])
        const toward = (rm[0] - a.p[0]) * a.u[0] + (rm[1] - a.p[1]) * a.u[1] >= 0 ? 1 : -1
        slopeArrow(a.p, [a.u[0] * toward, a.u[1] * toward])
      }
    }
  }
  const tickHalf = 1.0 * S
  for (const h of fd.hangers) {
    const pipe = pipeById.get(h.pipeId)
    let u: Pt = [1, 0]
    if (pipe && pipe.points.length >= 2) {
      let best = Infinity
      for (let i = 0; i + 1 < pipe.points.length; i++) {
        const a = pipe.points[i]
        const z = pipe.points[i + 1]
        const l = Math.hypot(z[0] - a[0], z[1] - a[1]) || 1
        const t = Math.max(
          0,
          Math.min(1, ((h.x - a[0]) * (z[0] - a[0]) + (h.y - a[1]) * (z[1] - a[1])) / (l * l))
        )
        const dd = Math.hypot(a[0] + (z[0] - a[0]) * t - h.x, a[1] + (z[1] - a[1]) * t - h.y)
        if (dd < best) {
          best = dd
          u = [(z[0] - a[0]) / l, (z[1] - a[1]) / l]
        }
      }
    }
    const m = M([h.x, h.y])
    const nx = -u[1]
    const ny = u[0]
    b.line(
      'FS-HANG',
      m[0] - nx * tickHalf,
      m[1] - ny * tickHalf,
      m[0] + nx * tickHalf,
      m[1] + ny * tickHalf
    )
    P.addSoft({
      x0: m[0] - Math.max(Math.abs(nx) * tickHalf, 0.35 * S),
      y0: m[1] - Math.max(Math.abs(ny) * tickHalf, 0.35 * S),
      x1: m[0] + Math.max(Math.abs(nx) * tickHalf, 0.35 * S),
      y1: m[1] + Math.max(Math.abs(ny) * tickHalf, 0.35 * S)
    })
  }

  // ───────── heads ─────────
  const rHead = 1.3 * S
  for (const h of fd.heads) {
    const m = M([h.x, h.y])
    headSymbol(b, m[0], m[1], rHead, typeById.get(h.headTypeId) ?? null)
    P.addHard({
      x0: m[0] - rHead - 0.3 * S,
      y0: m[1] - rHead - 0.3 * S,
      x1: m[0] + rHead + 0.3 * S,
      y1: m[1] + rHead + 0.3 * S
    })
  }

  // ───────── remote design area ─────────
  const gov = fd.governing
  let remoteBox: Box | null = null
  if (gov) {
    const flowing = fd.heads.filter((h) => gov.headsFlowing.includes(h.tag))
    if (flowing.length > 0) {
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      // S is the spacing along the branch lines, L between them
      const bp = fd.pipes.find((p) => p.kind === 'branch' && p.points.length >= 2)
      const alongX =
        !bp ||
        Math.abs(bp.points[bp.points.length - 1][0] - bp.points[0][0]) >=
          Math.abs(bp.points[bp.points.length - 1][1] - bp.points[0][1])
      for (const h of flowing) {
        const hx = (alongX ? h.spacingSmm : h.spacingLmm) / 2
        const hy = (alongX ? h.spacingLmm : h.spacingSmm) / 2
        x0 = Math.min(x0, h.x - hx)
        x1 = Math.max(x1, h.x + hx)
        y0 = Math.min(y0, h.y - hy)
        y1 = Math.max(y1, h.y + hy)
      }
      const lo = M([x0, y0])
      const hi = M([x1, y1])
      const rb: Box = { x0: lo[0], y0: lo[1], x1: hi[0], y1: hi[1] }
      b.polyline(
        'FS-REMOTE',
        [
          [rb.x0, rb.y0],
          [rb.x1, rb.y0],
          [rb.x1, rb.y1],
          [rb.x0, rb.y1]
        ],
        true
      )
      const band = 2.2 * S
      const step = 2.2 * S * Math.SQRT2
      const w = rb.x1 - rb.x0
      const hh = rb.y1 - rb.y0
      const bw = Math.min(band, w / 2, hh / 2)
      hatchRectOn(b, 'FS-REMOTE', rb.x0, rb.y0, w, bw, step)
      hatchRectOn(b, 'FS-REMOTE', rb.x0, rb.y1 - bw, w, bw, step)
      hatchRectOn(b, 'FS-REMOTE', rb.x0, rb.y0 + bw, bw, hh - 2 * bw, step)
      hatchRectOn(b, 'FS-REMOTE', rb.x1 - bw, rb.y0 + bw, bw, hh - 2 * bw, step)
      for (const h of flowing) {
        const m = M([h.x, h.y])
        b.circle('FS-REMOTE', m[0], m[1], rHead * 1.9)
      }
      remoteBox = rb
      // the ring of the area is a soft obstacle for labels (labels may sit inside, not on the hatch)
      const edge = (xa: number, ya: number, xb: number, yb: number): void => {
        const n = Math.max(1, Math.ceil(Math.hypot(xb - xa, yb - ya) / (3 * S)))
        for (let k = 0; k <= n; k++) {
          const x = xa + ((xb - xa) * k) / n
          const y = ya + ((yb - ya) * k) / n
          P.addSoft({ x0: x - 0.5 * S, y0: y - 0.5 * S, x1: x + 0.5 * S, y1: y + 0.5 * S })
        }
      }
      edge(rb.x0, rb.y0, rb.x1, rb.y0)
      edge(rb.x1, rb.y0, rb.x1, rb.y1)
      edge(rb.x1, rb.y1, rb.x0, rb.y1)
      edge(rb.x0, rb.y1, rb.x0, rb.y0)
    }
  }

  // ───────── riser / floor control assembly and inspector's test (symbols) ─────────
  const rm = M([fd.riser.x, fd.riser.y])
  b.circle('FS-PIPE-RISER', rm[0], rm[1], 2.6 * S)
  b.circle('FS-PIPE-RISER', rm[0], rm[1], 1.5 * S)
  b.solid('FS-PIPE-RISER', [
    [rm[0] - 0.7 * S, rm[1] - 0.7 * S],
    [rm[0] + 0.7 * S, rm[1] - 0.7 * S],
    [rm[0] + 0.7 * S, rm[1] + 0.7 * S],
    [rm[0] - 0.7 * S, rm[1] + 0.7 * S]
  ])
  P.addHard({ x0: rm[0] - 3 * S, y0: rm[1] - 3 * S, x1: rm[0] + 3 * S, y1: rm[1] + 3 * S })
  const it = M([fd.inspectorTest.x, fd.inspectorTest.y])
  b.circle('FS-PIPE-BRANCH', it[0], it[1], 2.2 * S)
  b.line('FS-PIPE-BRANCH', it[0] - 1.55 * S, it[1] - 1.55 * S, it[0] + 1.55 * S, it[1] + 1.55 * S)
  b.line('FS-PIPE-BRANCH', it[0] - 1.55 * S, it[1] + 1.55 * S, it[0] + 1.55 * S, it[1] - 1.55 * S)
  P.addHard({ x0: it[0] - 2.8 * S, y0: it[1] - 2.8 * S, x1: it[0] + 2.8 * S, y1: it[1] + 2.8 * S })

  // ───────── overall dimensions ─────────
  {
    let rx0 = Infinity
    let ry0 = Infinity
    let rx1 = -Infinity
    let ry1 = -Infinity
    for (const rmI of fi.rooms) {
      for (const [x, y] of rmI.polygon) {
        rx0 = Math.min(rx0, x)
        rx1 = Math.max(rx1, x)
        ry0 = Math.min(ry0, y)
        ry1 = Math.max(ry1, y)
      }
    }
    if (Number.isFinite(rx0) && rx1 - rx0 > 100 && ry1 - ry0 > 100) {
      const a = M([rx0, ry0])
      const z = M([rx1, ry0])
      const t = M([rx1, ry1])
      const offB = -(7 + 0)
      b.dimLinear(a[0], a[1], z[0], z[1], offB)
      for (const bx of dimBoxes(S, a[0], a[1], z[0], z[1], offB, String(Math.round(rx1 - rx0))))
        P.addHard(bx)
      b.dimLinear(t[0], t[1], z[0], z[1], 7)
      for (const bx of dimBoxes(S, t[0], t[1], z[0], z[1], 7, String(Math.round(ry1 - ry0))))
        P.addHard(bx)
    }
  }

  // ───────── helper: place a text at the first free candidate ─────────
  const tryText = (
    text: string,
    hP: number,
    cands: {
      x: number
      y: number
      align: 'left' | 'center' | 'right'
      vAlign: 'bottom' | 'top' | 'middle'
      rot?: number
    }[],
    layer = 'FP-ANNO',
    pad = 0.35,
    soft = true
  ): boolean => {
    const h = hP * S
    for (const q of cands) {
      const bx = textBox(q.x, q.y, h, text, q.align, q.vAlign, q.rot ?? 0)
      if (!P.free(bx, pad * S, soft)) continue
      P.text(layer, q.x, q.y, hP, text, { align: q.align, vAlign: q.vAlign, rotationDeg: q.rot })
      return true
    }
    return false
  }

  // ───────── room names with hazard ─────────
  for (const rmI of fi.rooms) {
    const res = fd.rooms.find((x) => x.roomId === rmI.id)
    const poly = rmI.polygon.map(M)
    let px0 = Infinity
    let py0 = Infinity
    let px1 = -Infinity
    let py1 = -Infinity
    for (const [x, y] of poly) {
      px0 = Math.min(px0, x)
      px1 = Math.max(px1, x)
      py0 = Math.min(py0, y)
      py1 = Math.max(py1, y)
    }
    const hz = HAZARD_LABEL[rmI.hazard] ?? rmI.hazard.toUpperCase()
    const name = rmI.name.toUpperCase()
    const l1 = name
    const l2 = rmI.omit
      ? `NOT SPRINKLERED - ${rmI.omitReason.toUpperCase()}`
      : `${hz} HAZARD - ${res ? res.headCount : 0} HEADS`
    const gx = (px0 + px1) / 2
    const gy = (py0 + py1) / 2
    const step = 2.5 * S
    const cand: Pt[] = []
    for (let x = px0 + step; x < px1; x += step)
      for (let y = py0 + step; y < py1; y += step) cand.push([x, y])
    cand.sort((a, z) => Math.hypot(a[0] - gx, a[1] - gy) - Math.hypot(z[0] - gx, z[1] - gy))
    cand.unshift([gx, gy])
    const place = (lines: [string, number][], soft: boolean): boolean => {
      const pitch = (h: number): number => h * S * 1.45
      const wBox = Math.max(...lines.map(([t, h]) => textWidth(h * S, t)))
      const hBox = lines.reduce((a, [, h]) => a + pitch(h), 0)
      for (const [x, y] of cand) {
        const bx: Box = { x0: x - wBox / 2, y0: y - hBox / 2, x1: x + wBox / 2, y1: y + hBox / 2 }
        if (
          ![
            [bx.x0, bx.y0],
            [bx.x1, bx.y0],
            [bx.x1, bx.y1],
            [bx.x0, bx.y1]
          ].every((q) => pointInPolygon(q as Pt, poly))
        )
          continue
        if (!P.free(bx, 0.5 * S, soft)) continue
        let yy = y + hBox / 2
        for (const [t, h] of lines) {
          yy -= pitch(h) / 2
          P.text('FS-ANNO', x, yy, h, t, { align: 'center', vAlign: 'middle', register: false })
          yy -= pitch(h) / 2
        }
        P.addHard(bx)
        return true
      }
      return false
    }
    if (
      place(
        [
          [l1, 3.0],
          [l2, 2.1]
        ],
        true
      )
    )
      continue
    if (place([[`${l1} - ${hz}`, 2.2]], true)) continue
    if (
      place(
        [
          [l1, 2.6],
          [l2, 2.0]
        ],
        false
      )
    )
      continue
    if (!P.callout([gx, gy], [l1, l2], 2.2))
      P.text('FS-ANNO', gx, gy, 2.2, l1, { align: 'center', vAlign: 'middle' })
  }

  // ───────── pipe size labels (priority) and head tags, then segment lengths ─────────
  type PipeLabel = { pipe: SprinklerPipe; pts: Pt[]; text: string; sizeChange: boolean }
  const labels: PipeLabel[] = []
  const lastSize = new Map<string, number>()
  for (const p of fd.pipes) {
    if (p.kind === 'riser-nipple' || p.points.length < 2) continue
    const g = pipeGroup(p)
    const prev = lastSize.get(g)
    const changed = prev === undefined || prev !== p.sizeIn
    lastSize.set(g, p.sizeIn)
    const len = `${f1(p.lengthM)} m`
    labels.push({
      pipe: p,
      pts: p.points.map(M),
      text: changed ? `${sizeLabel(p.sizeIn)} - ${len}` : len,
      sizeChange: changed
    })
  }
  const labelHP = 2.0
  const placePipeLabel = (lb: PipeLabel, mandatory: boolean): boolean => {
    const a = alongPolyline(lb.pts, 0.5)
    if (!a) return false
    const lens = lb.pts.slice(1).map((q, i) => Math.hypot(q[0] - lb.pts[i][0], q[1] - lb.pts[i][1]))
    // use the longest segment of the pipe for the label
    const iMax = lens.indexOf(Math.max(...lens))
    const sa = lb.pts[iMax]
    const sz = lb.pts[iMax + 1]
    const sl = lens[iMax] || 1
    const u: Pt = [(sz[0] - sa[0]) / sl, (sz[1] - sa[1]) / sl]
    let ang = (Math.atan2(u[1], u[0]) * 180) / Math.PI
    if (ang > 90 + 1e-9) ang -= 180
    else if (ang <= -90 + 1e-9) ang += 180
    const n: Pt = [-u[1], u[0]]
    const cands: { x: number; y: number; align: 'center'; vAlign: 'middle'; rot: number }[] = []
    const off = (labelHP * 0.5 + 0.9) * S
    const wLabel = textWidth(labelHP * S, lb.text)
    const fracs = sl > wLabel * 1.15 ? [0.5, 0.38, 0.62, 0.28, 0.72, 0.18, 0.82] : [0.5]
    for (const k of [0, 1, 2]) {
      const o = off * (1 + k * 0.9)
      for (const fr of fracs) {
        for (const side of [1, -1]) {
          cands.push({
            x: sa[0] + u[0] * sl * fr + n[0] * o * side,
            y: sa[1] + u[1] * sl * fr + n[1] * o * side,
            align: 'center',
            vAlign: 'middle',
            rot: ang
          })
        }
      }
    }
    if (tryText(lb.text, labelHP, cands)) return true
    if (!mandatory) return false
    // mandatory: callout with leader, finally unconditional
    if (P.callout(a.p, [lb.text], labelHP)) return true
    P.text('FS-ANNO', a.p[0] + n[0] * off, a.p[1] + n[1] * off, labelHP, lb.text, {
      align: 'center',
      vAlign: 'middle',
      rotationDeg: ang
    })
    return true
  }
  for (const lb of labels) if (lb.sizeChange) placePipeLabel(lb, true)

  // riser / floor control assembly callout, inspector's test, remote area, slope note (large text first)
  const nipple = fd.pipes.find((p) => p.kind === 'riser-nipple')
  P.callout(
    rm,
    [
      'FLOOR CONTROL ASSEMBLY ' + (nipple ? sizeLabel(nipple.sizeIn) : ''),
      'CONTROL VALVE + WATERFLOW SWITCH + GAUGE',
      'TEST & DRAIN - SEE FS-501'
    ],
    2.2,
    [180, 135, 225, 90, 270, 0]
  )
  P.callout(
    it,
    ['INSPECTOR\'S TEST (1" ORIFICE)', 'MOST REMOTE POINT - SEE FS-501'],
    2.2,
    [0, 45, 315, 90, 270, 180]
  )
  if (gov && remoteBox) {
    const anchor: Pt = [remoteBox.x1, (remoteBox.y0 + remoteBox.y1) / 2]
    P.callout(
      anchor,
      [
        `REMOTE DESIGN AREA - ${HAZARD_LABEL[gov.hazard] ?? gov.hazard.toUpperCase()}`,
        `${f1(gov.densityGpmFt2, 2)} GPM/FT2 OVER ${f1(gov.designAreaFt2, 0)} FT2, ${gov.headsFlowing.length} HEADS FLOWING`,
        `AT FC: ${f1(gov.flowAtFloorGpm)} GPM @ ${f1(gov.pressureAtFloorPsi)} PSI`
      ],
      2.2,
      [0, 45, 315, 90, 270, 135, 225, 180]
    )
  }
  if (dryLike) {
    const mainSeg = fd.pipes.find((p) => p.kind === 'cross-main')
    const a = mainSeg ? alongPolyline(mainSeg.points.map(M), 0.5) : null
    P.callout(
      a ? a.p : rm,
      [
        `${SYSTEM_LABEL[fd.systemType]} SYSTEM - SLOPE`,
        `BRANCH ${DRY_SLOPE_BRANCH_MM_PER_M} MM/M, MAIN ${DRY_SLOPE_MAIN_MM_PER_M} MM/M TO DRAIN`
      ],
      2.2,
      [180, 135, 225, 90, 270, 0]
    )
  }

  // head tags
  const tagCand = (
    m: Pt
  ): {
    x: number
    y: number
    align: 'left' | 'center' | 'right'
    vAlign: 'bottom' | 'top' | 'middle'
  }[] => {
    const o: [number, number, 'left' | 'center' | 'right', 'bottom' | 'top'][] = [
      [0, 1.9, 'center', 'bottom'],
      [0, -1.9, 'center', 'top'],
      [1.8, 1.4, 'left', 'bottom'],
      [-1.8, 1.4, 'right', 'bottom'],
      [1.8, -1.4, 'left', 'top'],
      [-1.8, -1.4, 'right', 'top'],
      [0, 3.6, 'center', 'bottom'],
      [0, -3.6, 'center', 'top'],
      [4.5, 2.4, 'left', 'bottom'],
      [-4.5, 2.4, 'right', 'bottom'],
      [4.5, -2.4, 'left', 'top'],
      [-4.5, -2.4, 'right', 'top'],
      [0, 5.4, 'center', 'bottom'],
      [0, -5.4, 'center', 'top']
    ]
    return o.map(([dx, dy, align, vAlign]) => ({
      x: m[0] + dx * S,
      y: m[1] + dy * S,
      align,
      vAlign
    }))
  }
  for (const h of fd.heads) {
    const m = M([h.x, h.y])
    if (!tryText(h.tag, 2.0, tagCand(m))) P.tag(m, h.tag)
  }
  for (const lb of labels) if (!lb.sizeChange) placePipeLabel(lb, false)

  // ───────── sheet title and right-hand panel ─────────
  const totalHeads = fd.heads.length
  sheetTitle(
    c,
    26,
    570,
    `SPRINKLER PLAN - ${fd.floorName.toUpperCase()}`,
    `${SYSTEM_LABEL[fd.systemType]} SYSTEM - FFL ${fi.elevationM >= 0 ? '+' : '-'}${Math.abs(fi.elevationM).toFixed(3)} M - ${totalHeads} SPRINKLERS - SCALE 1:${S}`
  )

  let y = 582
  northArrow(b, PX(c, PANEL.x0 + 14), PY(c, y - 14))
  b.text('FS-ANNO', PX(c, PANEL.x0 + 32), PY(c, y - 6), 3.2, `${fd.floorName.toUpperCase()}`, {
    vAlign: 'middle'
  })
  b.text(
    'FS-ANNO',
    PX(c, PANEL.x0 + 32),
    PY(c, y - 12),
    2.4,
    `SCALE 1:${S} (A1)   PLAN NORTH = UP`,
    { vAlign: 'middle' }
  )
  b.text('FS-ANNO', PX(c, PANEL.x0 + 32), PY(c, y - 17.5), 2.4, `SHEET ${sheet.number}`, {
    vAlign: 'middle'
  })
  y = 562

  // legend
  const counts = new Map<string, number>()
  for (const h of fd.heads) counts.set(h.headTypeId, (counts.get(h.headTypeId) ?? 0) + 1)
  const legend: LegendItem[] = []
  for (const [id, n] of counts) {
    const t = typeById.get(id)
    if (!t) continue
    legend.push({
      text: `${headTypeText(t)} - ${n} PCS`,
      draw: (x, yy) => headSymbol(b, x, yy, 1.5 * S, t)
    })
  }
  const Lw = 1.6 * S
  legend.push({
    text: 'BRANCH LINE (SIZE, LENGTH LABELLED)',
    draw: (x, yy) => b.line('FS-PIPE-BRANCH', x - 5 * S, yy, x + 5 * S, yy)
  })
  legend.push({
    text: 'CROSS MAIN / FEED MAIN',
    draw: (x, yy) => b.line('FS-PIPE-MAIN', x - 5 * S, yy, x + 5 * S, yy)
  })
  legend.push({
    text: 'RISER NIPPLE / FLOOR CONTROL ASSEMBLY',
    draw: (x, yy) => {
      b.circle('FS-PIPE-RISER', x, yy, 2.2 * S)
      b.circle('FS-PIPE-RISER', x, yy, 1.2 * S)
    }
  })
  legend.push({
    text: "INSPECTOR'S TEST CONNECTION",
    draw: (x, yy) => {
      b.circle('FS-PIPE-BRANCH', x, yy, 1.8 * S)
      b.line('FS-PIPE-BRANCH', x - 1.25 * S, yy - 1.25 * S, x + 1.25 * S, yy + 1.25 * S)
      b.line('FS-PIPE-BRANCH', x - 1.25 * S, yy + 1.25 * S, x + 1.25 * S, yy - 1.25 * S)
    }
  })
  legend.push({
    text: 'PIPE HANGER (SPACING PER NFPA 13 TABLE 17.4.2.1(a))',
    draw: (x, yy) => {
      b.line('FS-PIPE-BRANCH', x - 5 * S, yy, x + 5 * S, yy)
      b.line('FS-HANG', x, yy - 1.1 * S, x, yy + 1.1 * S)
    }
  })
  legend.push({
    text: 'REMOTE DESIGN AREA (HATCHED BOUNDARY)',
    draw: (x, yy) => {
      b.polyline(
        'FS-REMOTE',
        [
          [x - 5 * S, yy - 1.8 * S],
          [x + 5 * S, yy - 1.8 * S],
          [x + 5 * S, yy + 1.8 * S],
          [x - 5 * S, yy + 1.8 * S]
        ],
        true
      )
      hatchRectOn(b, 'FS-REMOTE', x - 5 * S, yy - 1.8 * S, 10 * S, 0.9 * S, 2.2 * S * Math.SQRT2)
    }
  })
  if (dryLike)
    legend.push({
      text: 'SLOPE DIRECTION OF PIPING (TO DRAIN)',
      draw: (x, yy) => slopeArrow([x, yy], [1, 0])
    })
  legend.push({
    text: 'ROOM BOUNDARY',
    draw: (x, yy) => b.line('FS-ROOM', x - 5 * S, yy, x + 5 * S, yy)
  })
  if (d.plan)
    legend.push({
      text: 'ARCHITECTURAL UNDERLAY (CLIENT DXF)',
      draw: (x, yy) =>
        b.line(archLayerName(d.plan!.entities[0]?.layer ?? 'A-WALL'), x - 5 * S, yy, x + 5 * S, yy)
    })
  void Lw
  const lh = drawLegend(c, PANEL.x0, y, PANEL.x1 - PANEL.x0, legend)
  y -= lh + 3

  // head schedule
  const sched: string[][] = [['ROOM', 'HAZARD', 'HEAD TYPE', 'QTY', 'S x L (M)', 'AREA M2']]
  let sumQty = 0
  for (const rr of fd.rooms) {
    sched.push([
      rr.name.toUpperCase(),
      HAZARD_LABEL[rr.hazard] ?? rr.hazard,
      rr.headTypeId,
      String(rr.headCount),
      `${f1(rr.spacingSmm / 1000, 2)} x ${f1(rr.spacingLmm / 1000, 2)}`,
      f1(rr.areaM2, 0)
    ])
    sumQty += rr.headCount
  }
  sched.push(['TOTAL', '', '', String(sumQty), '', ''])
  const schedTh = sched.length > 14 ? 1.8 : 2.1
  const sh = fitTable(
    c,
    PANEL.x0,
    y,
    sched,
    schedTh,
    PANEL.x1 - PANEL.x0,
    'HEAD SCHEDULE',
    sched[0].map((_, i) => i === 3 || i === 5)
  )
  y -= sh.h + 3

  // remote area data
  if (gov) {
    const ra: string[][] = [
      ['REMOTE AREA DATA', ''],
      ['SYSTEM TYPE', SYSTEM_LABEL[fd.systemType]],
      [
        'HAZARD / DENSITY',
        `${HAZARD_LABEL[gov.hazard] ?? gov.hazard} / ${f1(gov.densityGpmFt2, 2)} GPM/FT2`
      ],
      ['DESIGN AREA (BASE)', `${f1(gov.designAreaFt2, 0)} FT2 (${f1(gov.baseAreaFt2, 0)} FT2)`],
      [
        'HEADS FLOWING',
        `${gov.headsFlowing.length}: ${gov.headsFlowing.join(', ')}`.replace(
          /((?:[^,]*,){4})\s*/g,
          '$1\n'
        )
      ],
      ['REMOTE HEAD', `${f1(gov.minHeadFlowGpm)} GPM @ ${f1(gov.remoteHeadPressurePsi)} PSI`],
      [
        'AT FC (FLOOR CONTROL)',
        `${f1(gov.flowAtFloorGpm)} GPM @ ${f1(gov.pressureAtFloorPsi)} PSI`
      ],
      ['AT SOURCE', `${f1(gov.flowAtSourceGpm)} GPM @ ${f1(gov.pressureAtSourcePsi)} PSI`],
      ['HOSE ALLOWANCE', `${f1(gov.hoseAllowanceGpm, 0)} GPM`]
    ]
    const rh = fitTable(
      c,
      PANEL.x0,
      y,
      ra.slice(1),
      2.1,
      PANEL.x1 - PANEL.x0,
      'REMOTE AREA DATA',
      undefined
    )
    y -= rh.h + 3
  }

  // notes
  const notes = floorNotes(c, d)
  const avail = y - 74
  let nth = 2.2
  while (nth > 1.5 && notesHeight(PANEL.x0, PANEL.x1 - PANEL.x0, notes, nth) > avail) nth -= 0.1
  drawNotes(c, PANEL.x0, y, PANEL.x1 - PANEL.x0, 'NOTES', notes, nth)
}

// ─────────────────────────── public entry ───────────────────────────

function loadPlan(fi: SprinklerFloorInput): FloorPlan | null {
  return loadFloorPlan(fi.planDxf, fi.planUnits)
}

export function generateSprinklerDrawings(result: FireDesignResult): {
  floors: { floorId: string; drawing: Drawing }[]
  riserAndDetails: Drawing
  hydraulics: Drawing
  combined: Drawing
} {
  const spr = result.sprinklers
  const sd = result.input.sprinklerDesign
  if (!spr || !sd)
    throw new Error(
      'generateSprinklerDrawings: result.sprinklers is null (no sprinkler design in the input)'
    )
  const data: FloorData[] = spr.floors.map((fd, index) => {
    const fi = sd.floors.find((x) => x.id === fd.floorId)
    if (!fi)
      throw new Error(
        `generateSprinklerDrawings: floor ${fd.floorId} not found in the sprinkler design input`
      )
    return { index, fi, fd, plan: loadPlan(fi) }
  })
  const archLayers = [
    ...new Set(data.flatMap((d) => (d.plan ? d.plan.layers.map((l) => l.name) : [])))
  ]
  const proj = result.input.projectName
  const floorSpec = (d: FloorData): SheetSpec => {
    const scale = pickFloorScale(d)
    return {
      number: `FS-1${String(d.index + 1).padStart(2, '0')}`,
      title: `SPRINKLER SHOP DRAWING - ${d.fd.floorName.toUpperCase()}`,
      scale,
      scaleText: `1:${scale}`,
      draw: (c) => drawFloorSheet(c, d)
    }
  }
  const riserSpec: SheetSpec = {
    number: 'FS-501',
    title: 'SPRINKLER RISER DIAGRAM & DETAILS',
    scale: 10,
    scaleText: 'NTS / 1:10',
    draw: (c) => drawRiserSheet(c)
  }
  const hydSpec: SheetSpec = {
    number: 'FS-601',
    title: 'SPRINKLER HYDRAULICS & MATERIALS',
    scale: 10,
    scaleText: 'NTS',
    draw: (c) => drawHydraulicSheet(c)
  }
  const specs = data.map(floorSpec)
  return {
    floors: data.map((d, i) => ({
      floorId: d.fd.floorId,
      drawing: assembleSprinklerDrawing(
        result,
        `Sprinkler ${specs[i].number} - ${d.fd.floorName} - ${proj}`,
        [specs[i]],
        archLayers
      )
    })),
    riserAndDetails: assembleSprinklerDrawing(
      result,
      `Sprinkler FS-501 riser diagram & details - ${proj}`,
      [riserSpec],
      archLayers
    ),
    hydraulics: assembleSprinklerDrawing(
      result,
      `Sprinkler FS-601 hydraulic calculations - ${proj}`,
      [hydSpec],
      archLayers
    ),
    combined: assembleSprinklerDrawing(
      result,
      `Sprinkler shop drawings - ${proj}`,
      [...specs, riserSpec, hydSpec],
      archLayers
    )
  }
}
