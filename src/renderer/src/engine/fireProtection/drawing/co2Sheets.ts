/**
 * CO2 total-flooding shop drawings (NFPA 12-2022): one A1 sheet per floor (CO-101 …) over the client's architectural
 * plan, CO-501 system schematic & details and CO-601 calculations. `combined` holds every sheet left → right.
 */
import { CO2_PRELIMINARY_NOTE, FT3_PER_M3 } from '../co2/nfpa12'
import { CO2_DETECTION_TEXT } from '../co2/co2Signs'
import type {
  Co2DeviceKind,
  Co2EnclosureInput,
  Co2EnclosureResult,
  Co2FloorDesign,
  Co2FloorInput,
  Co2Pipe,
  Co2StorageDesign
} from '../co2/co2Types'
import type { FireDesignResult } from '../fpTypes'
import type { FloorPlan } from '../sprinkler/sprinklerTypes'
import type { Drawing } from './drawingTypes'
import {
  type LegendItem,
  type SheetSpec,
  type TextCand,
  addSoftAlong,
  assembleCo2Drawing,
  deviceSymbol,
  drawLegend,
  f0,
  fitTable,
  fx,
  hatchPolygon,
  kgOf,
  lbKg,
  nozzleSymbol,
  polyCentroid,
  ringCands,
  tryText,
  DEVICE_LABEL
} from './co2SheetKit'
import { drawCo2CalcSheet } from './co2SheetCalc'
import { drawCo2SchematicSheet } from './co2SheetSchematic'
import {
  type Box,
  type Ctx,
  Placer,
  PX,
  PY,
  type Pt,
  drawNotes,
  notesHeight,
  sheetTitle,
  textBox,
  textWidth
} from './sheetKit'
import { drawArchUnderlay, loadFloorPlan } from './sheetUnderlay'
import { archLayerName, pointInPolygon, sizeLabel } from './sprinklerSheetKit'
import { northArrow } from './symbols'

export const CO2_FLOOR_SCALES = [50, 75, 100, 150, 200, 250, 500]
/** Plan area and right-hand information panel (paper mm). */
const PA = { x0: 24, y0: 16, x1: 586, y1: 545 }
const PANEL = { x0: 592, x1: 829 }
const MARGIN_X = 22
const MARGIN_Y = 24
const WINDOW_MM = 1500

export interface Co2FloorData {
  index: number
  fi: Co2FloorInput
  fd: Co2FloorDesign
  plan: FloorPlan | null
}

// ─────────────────────────── storage bank / tank symbol ───────────────────────────

interface BankLayout {
  wP: number
  hP: number
  /** Draw with the top-centre of the box at model (x, yTop). */
  draw: (c: Ctx, x: number, yTop: number) => void
}

const BANK_TH = 1.9

function bankLayout(st: Co2StorageDesign): BankLayout {
  const hp = st.storage === 'high-pressure'
  const lines: string[] = hp
    ? [
        'CO2 STORAGE - HIGH-PRESSURE CYLINDER BANK',
        `MAIN ${st.mainCylinders} CYLINDERS x ${f0(st.cylinderLb)} LB = ${lbKg(st.mainCylinders * st.cylinderLb)}`
      ]
    : [
        'CO2 STORAGE - LOW-PRESSURE REFRIGERATED TANK',
        `TANK ${st.tankTons ?? 0} TON = ${lbKg(st.installedLb)} (MAIN + RESERVE)`
      ]
  if (hp && st.reserveCylinders > 0)
    lines.push(
      `RESERVE ${st.reserveCylinders} CYLINDERS x ${f0(st.cylinderLb)} LB = ${lbKg(st.reserveCylinders * st.cylinderLb)}`
    )
  if (!hp) lines.push(`MAIN ${lbKg(st.mainLb)} + RESERVE ${lbKg(st.reserveLb)}`)
  const pitch = 3.8
  const perRow = Math.max(1, Math.min(16, Math.max(st.mainCylinders, st.reserveCylinders)))
  const rowsOf = (n: number): number => (n > 0 ? Math.ceil(n / perRow) : 0)
  const cylRows = hp ? rowsOf(st.mainCylinders) + rowsOf(st.reserveCylinders) : 0
  const textW = Math.max(...lines.map((l) => textWidth(BANK_TH, l))) + 4
  const gfxW = hp ? 12 + perRow * pitch + 2 : 50
  const wP = Math.max(textW, gfxW)
  const lineH = BANK_TH * 1.5
  const gfxH = hp ? cylRows * pitch + 1 : 14
  const hP = 2 + lines.length * lineH + gfxH + 1.5
  return {
    wP,
    hP,
    draw: (c, x, yTop) => {
      const { b, sheet } = c
      const S = sheet.scale
      const x0 = x - (wP * S) / 2
      b.rect('CO2-STORAGE', x0, yTop - hP * S, wP * S, hP * S)
      lines.forEach((t, i) =>
        b.text('CO2-ANNO', x0 + 2 * S, yTop - (1.5 + lineH * (i + 0.5)) * S, BANK_TH, t, {
          vAlign: 'middle'
        })
      )
      const yG = yTop - (2 + lines.length * lineH) * S
      b.line('CO2-STORAGE', x0, yG, x0 + wP * S, yG)
      if (hp) {
        let row = 0
        const draw = (n: number, label: string): void => {
          if (n <= 0) return
          b.text('CO2-ANNO', x0 + 2 * S, yG - (row * pitch + pitch / 2 + 0.5) * S, 1.6, label, {
            vAlign: 'middle'
          })
          for (let k = 0; k < n; k++) {
            const rr = Math.floor(k / perRow)
            const col = k % perRow
            const cx = x0 + (12 + col * pitch + pitch / 2) * S
            const cy = yG - ((row + rr) * pitch + pitch / 2 + 0.5) * S
            b.circle('CO2-STORAGE', cx, cy, 1.35 * S)
            b.circle('CO2-STORAGE', cx, cy, 0.5 * S)
          }
          row += rowsOf(n)
        }
        draw(st.mainCylinders, 'MAIN')
        draw(st.reserveCylinders, 'RESERVE')
      } else {
        // horizontal pressure vessel with dished heads, refrigeration unit and pressure relief
        const cx = x0 + (wP * S) / 2
        const cy = yG - 6.5 * S
        const hw = 18 * S
        const r = 4.2 * S
        b.line('CO2-STORAGE', cx - hw, cy + r, cx + hw, cy + r)
        b.line('CO2-STORAGE', cx - hw, cy - r, cx + hw, cy - r)
        b.arc('CO2-STORAGE', cx - hw, cy, r, 90, 270)
        b.arc('CO2-STORAGE', cx + hw, cy, r, 270, 90)
        b.circle('CO2-STORAGE', cx + hw + 9 * S, cy, 2.5 * S)
        b.line('CO2-STORAGE', cx + hw + r, cy, cx + hw + 6.5 * S, cy)
        b.text('CO2-STORAGE', cx + hw + 9 * S, cy, 1.5, 'REF', {
          align: 'center',
          vAlign: 'middle'
        })
        b.line('CO2-STORAGE', cx - 8 * S, cy - r, cx - 8 * S, cy - r - 1.5 * S)
        b.line('CO2-STORAGE', cx + 8 * S, cy - r, cx + 8 * S, cy - r - 1.5 * S)
      }
    }
  }
}

// ─────────────────────────── content bounding box / scale ───────────────────────────

interface BoxMm {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function contentBBox(d: Co2FloorData): BoxMm {
  const bb: BoxMm = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const add = (p: Pt): void => {
    bb.minX = Math.min(bb.minX, p[0])
    bb.maxX = Math.max(bb.maxX, p[0])
    bb.minY = Math.min(bb.minY, p[1])
    bb.maxY = Math.max(bb.maxY, p[1])
  }
  for (const e of d.fi.enclosures) e.polygon.forEach(add)
  for (const e of d.fd.enclosures) for (const n of e.nozzles) add([n.x, n.y])
  for (const p of d.fd.pipes) p.points.forEach(add)
  for (const v of d.fd.devices) add([v.x, v.y])
  add([d.fd.storage.x, d.fd.storage.y])
  if (!Number.isFinite(bb.minX)) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
  return bb
}

const BANK_GAP = 4

/** Content box extended by the storage bank drawn below the storage point at scale S. */
function layoutBBox(d: Co2FloorData, bank: BankLayout, S: number): BoxMm {
  const bb = contentBBox(d)
  const sx = d.fd.storage.x
  const sy = d.fd.storage.y
  bb.minX = Math.min(bb.minX, sx - (bank.wP * S) / 2)
  bb.maxX = Math.max(bb.maxX, sx + (bank.wP * S) / 2)
  bb.minY = Math.min(bb.minY, sy - (BANK_GAP + bank.hP) * S)
  return bb
}

export function pickCo2FloorScale(d: Co2FloorData, st: Co2StorageDesign): number {
  const bank = bankLayout(st)
  for (const s of CO2_FLOOR_SCALES) {
    const bb = layoutBBox(d, bank, s)
    const w = bb.maxX - bb.minX + 2 * WINDOW_MM
    const h = bb.maxY - bb.minY + 2 * WINDOW_MM
    if (w / s + 2 * MARGIN_X <= PA.x1 - PA.x0 && h / s + 2 * MARGIN_Y <= PA.y1 - PA.y0) return s
  }
  return 500
}

// ─────────────────────────── notes ───────────────────────────

function floorNotes(c: Ctx, d: Co2FloorData): string[] {
  const a = c.r.input.co2Design!.answers
  const hp = c.r.co2!.storage.storage === 'high-pressure'
  const anyVent = d.fi.enclosures.some((e) => e.ventilationM3min > 0)
  return [
    'WORKING PLANS FOR APPROVAL BY THE AUTHORITY HAVING JURISDICTION (AHJ) BEFORE FABRICATION. INSTALL TO NFPA 12-2022 (CARBON DIOXIDE EXTINGUISHING SYSTEMS), NFPA 72 AND NFPA 70 AS ADOPTED BY THE AHJ.',
    CO2_PRELIMINARY_NOTE.toUpperCase().replace('—', '-'),
    `TOTAL FLOODING OF EACH ENCLOSURE: QUANTITY, DISCHARGE RATE AND TIME AS IN THE ENCLOSURE BOXES AND CO-601 (NFPA 12-2022 CH. 5). ${hp ? `CYLINDERS ARE ${f0(c.r.co2!.storage.cylinderLb)} LB NET, ONE STORAGE SERVES ALL ENCLOSURES (SIZED FOR THE LARGEST).` : 'ONE LOW-PRESSURE TANK SERVES ALL ENCLOSURES (SIZED FOR THE LARGEST).'}`,
    "NOZZLES: LISTED, TAGGED WITH THE ORIFICE CODE (DIAMETER IN 1/32 IN) SHOWN. INSTALL AT THE LOCATIONS AND HEIGHT GIVEN BY THE MANUFACTURER'S LISTING; NOZZLE FLOW AND PRESSURE ARE THE CALCULATED ONES (CO-601).",
    `PRE-DISCHARGE ALARM: HORN/STROBE INSIDE EACH ENCLOSURE AND STROBE OUTSIDE EACH ENTRANCE; PRESSURE-OPERATED TIME DELAY ${a.timeDelayS} S (NOT LESS THAN 20 S WHERE PERSONNEL MAY BE PRESENT). SUPERVISED LOCKOUT VALVE ON THE MAIN DISCHARGE PIPE.`,
    `DETECTION AND RELEASE: ${CO2_DETECTION_TEXT[a.detection]}. MANUAL RELEASE OUTSIDE EACH ENTRANCE AND MECHANICAL MANUAL RELEASE AT THE STORAGE.`,
    'WARNING SIGNS INSIDE, AT EVERY ENTRANCE AND AT THE STORAGE - WORDING ON CO-501. ' +
      (a.odorizer ? 'ODORIZER ON THE MAIN DISCHARGE PIPE.' : 'NO ODORIZER.'),
    `VENTILATION: ${anyVent ? 'VENTILATION THAT CANNOT BE SHUT DOWN IS COMPENSATED IN THE QUANTITY (CO-601); OTHERWISE' : ''} VENTILATION AND DAMPERS ARE SHUT DOWN AUTOMATICALLY BEFORE DISCHARGE. PRESSURE RELIEF VENTS AS IN THE SCHEDULE; VENT TO A SAFE LOCATION. VENTILATE AND TEST THE ATMOSPHERE BEFORE RE-ENTRY.`,
    'PIPING: SEAMLESS STEEL, SCHEDULE AS LABELLED (HIGH-PRESSURE SCH 80 FROM 1-1/4" UP, SCH 40 BELOW; NFPA 12-2022 SEC. 4.8). SIZES AND LENGTHS ARE THE CALCULATED ONES; NO CHANGE WITHOUT A NEW CALCULATION.',
    'GREY ARCHITECTURAL UNDERLAY (LAYERS A-*) IS THE CLIENT FLOOR PLAN, FOR REFERENCE ONLY; ITS TEXT IS NOT SHOWN. CONTRACTOR TO FIELD-VERIFY DIMENSIONS, CEILING HEIGHTS, OPENINGS AND COORDINATE WITH OTHER TRADES. DIMENSIONS IN MM.'
  ]
}

// ─────────────────────────── floor sheet ───────────────────────────

const pipeLabelText = (p: Co2Pipe): string =>
  `${sizeLabel(p.sizeIn)} SCH ${p.schedule === 'sch80' ? '80' : '40'} - ${fx(p.lengthM)} M`

interface QtyLine {
  t: string
  h: number
}

function qtyLines(
  e: Co2EnclosureResult,
  en: Co2EnclosureInput | undefined,
  st: Co2StorageDesign
): QtyLine[] {
  const q = e.quantity
  const hz = e.hazardLabel.toUpperCase().replace('—', '-')
  const hzLines: string[] = []
  let cur = ''
  for (const w of hz.split(/\s+/)) {
    if (cur && (cur + ' ' + w).length > 34) {
      hzLines.push(cur)
      cur = w
    } else cur = cur ? cur + ' ' + w : w
  }
  if (cur) hzLines.push(cur)
  const out: QtyLine[] = [{ t: `${e.enclosureId}  ${e.name.toUpperCase()}`, h: 2.5 }]
  for (const l of hzLines) out.push({ t: l, h: 1.9 })
  out.push({ t: 'CARBON DIOXIDE TOTAL FLOODING', h: 1.9 })
  out.push({ t: `V = ${fx(q.volumeFt3 / FT3_PER_M3)} M3 (${f0(q.volumeFt3)} FT3)`, h: 1.9 })
  if (en) out.push({ t: `H = ${fx(en.heightM, 1)} M   AREA ${fx(e.areaM2, 0)} M2`, h: 1.9 })
  out.push({
    t: `C = ${f0(q.designConcentrationPct)} %   FLOODING FACTOR ${fx(q.floodingFactorFt3PerLb, 1)} FT3/LB`,
    h: 1.9
  })
  out.push({ t: `TOTAL ${lbKg(q.totalLb)}`, h: 2.2 })
  out.push({ t: `RATE ${f0(e.rateLbMin)} LB/MIN (${f0(kgOf(e.rateLbMin))} KG/MIN)`, h: 1.9 })
  out.push({
    t: `T = ${fx(e.dischargeTimeMin, 1)} MIN${e.soakMin > 0 ? `   SOAK ${f0(e.soakMin)} MIN` : ''}`,
    h: 1.9
  })
  out.push({
    t:
      st.storage === 'high-pressure'
        ? `${e.cylinders} CYLINDERS x ${f0(st.cylinderLb)} LB / ${e.nozzles.length} NOZZLES`
        : `LOW-PRESSURE TANK / ${e.nozzles.length} NOZZLES`,
    h: 1.9
  })
  return out
}

function nearestPointInBox(bx: Box, p: Pt): Pt {
  return [Math.min(Math.max(p[0], bx.x0), bx.x1), Math.min(Math.max(p[1], bx.y0), bx.y1)]
}

export function drawCo2FloorSheet(c: Ctx, d: Co2FloorData): void {
  const { b, sheet, r } = c
  const S = sheet.scale
  const co2 = r.co2!
  const st = co2.storage
  const { fd, fi } = d
  const bank = bankLayout(st)
  const bb = layoutBBox(d, bank, S)
  const cx = (bb.minX + bb.maxX) / 2
  const cy = (bb.minY + bb.maxY) / 2
  const ox = sheet.originX + ((PA.x0 + PA.x1) / 2) * S
  const oy = sheet.originY + ((PA.y0 + PA.y1) / 2) * S
  const M = (p: Pt): Pt => [ox + (p[0] - cx), oy + (p[1] - cy)]
  const paBox: Box = { x0: PX(c, PA.x0), y0: PY(c, PA.y0), x1: PX(c, PA.x1), y1: PY(c, PA.y1) }
  const P = new Placer(c, paBox)

  // ───────── architectural underlay (A-*) clipped to the window around the content ─────────
  if (d.plan) {
    const cb = contentBBox(d)
    const lo = M([cb.minX - WINDOW_MM, cb.minY - WINDOW_MM])
    const hi = M([cb.maxX + WINDOW_MM, cb.maxY + WINDOW_MM])
    drawArchUnderlay(b, d.plan, M, {
      x0: Math.max(lo[0], paBox.x0),
      y0: Math.max(lo[1], paBox.y0),
      x1: Math.min(hi[0], paBox.x1),
      y1: Math.min(hi[1], paBox.y1)
    })
  }

  // ───────── enclosures: outline + hatch ─────────
  const encPoly = new Map<string, Pt[]>()
  for (const en of fi.enclosures) {
    const poly = en.polygon.map(M)
    encPoly.set(en.id, poly)
    b.polyline('CO2-ENCL', poly, true)
    hatchPolygon(b, 'CO2-HTCH', poly, 4.5 * S * Math.SQRT2)
    addSoftAlong(P, poly, true, 0.5 * S, 2.5 * S)
  }

  // ───────── pipes ─────────
  const pipeLines: { p: Co2Pipe; pts: Pt[] }[] = []
  for (const p of fd.pipes) {
    if (p.points.length < 2) continue
    const pts = p.points.map(M)
    b.polyline('CO2-PIPE', pts, false)
    addSoftAlong(P, pts, false, 0.6 * S, 2.2 * S)
    pipeLines.push({ p, pts })
  }

  // ───────── storage bank below the storage point ─────────
  const sp = M([fd.storage.x, fd.storage.y])
  {
    const yTop = sp[1] - BANK_GAP * S
    b.circle('CO2-STORAGE', sp[0], sp[1], 1.1 * S)
    b.line('CO2-STORAGE', sp[0] - 1.8 * S, sp[1], sp[0] + 1.8 * S, sp[1])
    b.line('CO2-STORAGE', sp[0], sp[1] - 1.1 * S, sp[0], yTop)
    bank.draw(c, sp[0], yTop)
    P.addHard({
      x0: sp[0] - (bank.wP * S) / 2,
      y0: yTop - bank.hP * S,
      x1: sp[0] + (bank.wP * S) / 2,
      y1: yTop
    })
    P.addHard({ x0: sp[0] - 2 * S, y0: sp[1] - 1.5 * S, x1: sp[0] + 2 * S, y1: sp[1] + 1.5 * S })
  }

  // ───────── nozzles ─────────
  const rNoz = 1.2 * S
  for (const e of fd.enclosures) {
    for (const n of e.nozzles) {
      const m = M([n.x, n.y])
      nozzleSymbol(b, m[0], m[1], rNoz)
      P.addHard({
        x0: m[0] - 1.9 * rNoz,
        y0: m[1] - 1.9 * rNoz,
        x1: m[0] + 1.9 * rNoz,
        y1: m[1] + 1.9 * rNoz
      })
    }
  }

  // ───────── devices (symbols; crowded ones are moved to the nearest free spot and tied back with a leader) ─────────
  const rDev = 1.7 * S
  const devPos = new Map<string, Pt>()
  const order: Co2DeviceKind[] = [
    'control-panel',
    'lockout-valve',
    'pressure-switch',
    'selector-valve',
    'manual-release',
    'strobe-outside',
    'horn-strobe',
    'warning-sign',
    'pressure-relief-vent',
    'smoke-detector',
    'heat-detector'
  ]
  const devs = [...fd.devices].sort((a, z) => order.indexOf(a.kind) - order.indexOf(z.kind))
  for (const dv of devs) {
    const m = M([dv.x, dv.y])
    const half = 1.55 * rDev
    const fits = (q: Pt): boolean =>
      P.free({ x0: q[0] - half, y0: q[1] - half, x1: q[0] + half, y1: q[1] + half }, 0.3 * S, false)
    let pos: Pt = m
    if (!fits(m)) {
      let found = false
      for (const k of [1, 1.45, 1.9, 2.4, 3, 3.7, 4.5, 5.5, 6.8]) {
        for (let a = 0; a < 360 && !found; a += 30) {
          const q: Pt = [
            m[0] + Math.cos((a * Math.PI) / 180) * k * 2.6 * rDev,
            m[1] + Math.sin((a * Math.PI) / 180) * k * 2.6 * rDev
          ]
          if (fits(q)) {
            pos = q
            found = true
          }
        }
        if (found) break
      }
    }
    if (pos !== m) {
      b.circle('CO2-ANNO', m[0], m[1], 0.35 * S)
      b.line('CO2-ANNO', m[0], m[1], pos[0], pos[1])
    }
    deviceSymbol(b, dv.kind, pos[0], pos[1], rDev)
    P.addHard({
      x0: pos[0] - 1.45 * rDev,
      y0: pos[1] - 1.45 * rDev,
      x1: pos[0] + 1.45 * rDev,
      y1: pos[1] + 1.45 * rDev
    })
    devPos.set(dv.tag, pos)
  }

  // ───────── overall dimension of the largest enclosure ─────────

  // ───────── enclosure quantity boxes ─────────
  const grid: Pt[] = []
  for (let x = PA.x0 + 2; x < PA.x1 - 2; x += 3)
    for (let y = PA.y0 + 2; y < PA.y1 - 2; y += 3) grid.push([PX(c, x), PY(c, y)])
  for (const e of fd.enclosures) {
    const en = fi.enclosures.find((x) => x.id === e.enclosureId)
    const poly = encPoly.get(e.enclosureId)
    if (!poly) continue
    const lines = qtyLines(e, en, st)
    const pitchOf = (h: number): number => h * S * 1.45
    const wBox = Math.max(...lines.map((l) => textWidth(l.h * S, l.t))) + 3 * S
    const hBox = lines.reduce((s, l) => s + pitchOf(l.h), 0) + 2 * S
    const ctr = polyCentroid(poly)
    const anchor: Pt = pointInPolygon(ctr, poly) ? ctr : poly[0]
    const cands = [...grid]
      .map((q) => ({
        q,
        d: Math.hypot(q[0] - anchor[0], q[1] - anchor[1]),
        inside: pointInPolygon(q, poly)
      }))
      .sort((p1, p2) => (p1.inside === p2.inside ? p1.d - p2.d : p1.inside ? -1 : 1))
    const evaluate = (soft: boolean): boolean => {
      for (const { q, inside } of cands) {
        const bx: Box = {
          x0: q[0] - wBox / 2,
          y0: q[1] - hBox / 2,
          x1: q[0] + wBox / 2,
          y1: q[1] + hBox / 2
        }
        if (inside) {
          // keep the box wholly inside the enclosure when it claims to be "inside"
          const corners: Pt[] = [
            [bx.x0, bx.y0],
            [bx.x1, bx.y0],
            [bx.x1, bx.y1],
            [bx.x0, bx.y1]
          ]
          if (!corners.every((k) => pointInPolygon(k, poly))) continue
        }
        if (!P.free(bx, 0.6 * S, soft)) continue
        // draw
        b.rect('CO2-ANNO', bx.x0, bx.y0, bx.x1 - bx.x0, bx.y1 - bx.y0)
        let yy = bx.y1 - S
        lines.forEach((l, i) => {
          const pit = pitchOf(l.h)
          yy -= pit / 2
          b.text('CO2-ANNO', bx.x0 + 1.5 * S, yy, l.h, l.t, { vAlign: 'middle' })
          yy -= pit / 2
          if (i === 0) b.line('CO2-ANNO', bx.x0, yy + 0.2 * S, bx.x1, yy + 0.2 * S)
        })
        const cornersInside = [
          [bx.x0, bx.y0],
          [bx.x1, bx.y0],
          [bx.x1, bx.y1],
          [bx.x0, bx.y1]
        ].every((k) => pointInPolygon(k as Pt, poly))
        if (!cornersInside) {
          const e1 = nearestPointInBox(bx, anchor)
          b.line('CO2-ANNO', e1[0], e1[1], anchor[0], anchor[1])
          b.circle('CO2-ANNO', anchor[0], anchor[1], 0.5 * S)
        }
        P.addHard(bx)
        return true
      }
      return false
    }
    if (!evaluate(true) && !evaluate(false)) {
      // last resort: stack the box in the plan area corner (never expected)
      P.fallbacks.push(e.enclosureId)
    }
  }

  // ───────── nozzle tags: tag + orifice code ─────────
  const tagH = 2.0
  for (const e of fd.enclosures) {
    for (const n of e.nozzles) {
      const m = M([n.x, n.y])
      const code = `ORIFICE ${n.orificeCode}`
      const w1 = textWidth(tagH * S, n.tag)
      const w2 = textWidth(tagH * S * 0.9, code)
      const w = Math.max(w1, w2)
      const hh = tagH * S * 2.9
      const off = 2.4 * rNoz
      const cand: Pt[] = [
        [m[0], m[1] + off + hh / 2],
        [m[0], m[1] - off - hh / 2],
        [m[0] + off + w / 2, m[1] + hh * 0.2],
        [m[0] - off - w / 2, m[1] + hh * 0.2],
        [m[0] + off + w / 2, m[1] - hh * 0.6],
        [m[0] - off - w / 2, m[1] - hh * 0.6],
        [m[0], m[1] + off * 2 + hh / 2],
        [m[0], m[1] - off * 2 - hh / 2],
        [m[0] + off * 2 + w / 2, m[1] + hh * 0.5],
        [m[0] - off * 2 - w / 2, m[1] + hh * 0.5]
      ]
      let done = false
      for (const soft of [true, false]) {
        for (const q of cand) {
          const bx: Box = {
            x0: q[0] - w / 2,
            y0: q[1] - hh / 2,
            x1: q[0] + w / 2,
            y1: q[1] + hh / 2
          }
          if (!P.free(bx, 0.35 * S, soft)) continue
          P.text('CO2-ANNO', q[0], q[1] + hh * 0.22, tagH, n.tag, {
            align: 'center',
            vAlign: 'middle',
            register: false
          })
          P.text('CO2-ANNO', q[0], q[1] - hh * 0.22, tagH * 0.9, code, {
            align: 'center',
            vAlign: 'middle',
            register: false
          })
          P.addHard(bx)
          done = true
          break
        }
        if (done) break
      }
      if (!done) P.tag(m, `${n.tag} ${n.orificeCode}`)
    }
  }

  // ───────── device tags ─────────
  for (const dv of fd.devices) {
    const pos = devPos.get(dv.tag) ?? M([dv.x, dv.y])
    const cands = ringCands(pos, S, 2.7 * rDev * 0.62 + 0.6 * S).map((q): TextCand => q)
    if (
      !tryText(P, S, dv.tag, 1.9, cands, 'FP-ANNO', true) &&
      !tryText(P, S, dv.tag, 1.9, cands, 'FP-ANNO', false)
    )
      P.tag(pos, dv.tag)
  }

  // ───────── pipe size labels ─────────
  const labelHP = 2.0
  for (const { p, pts } of pipeLines) {
    const text = pipeLabelText(p)
    const lens = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]))
    const iMax = lens.indexOf(Math.max(...lens))
    const sa = pts[iMax]
    const sz = pts[iMax + 1]
    const sl = lens[iMax] || 1
    const u: Pt = [(sz[0] - sa[0]) / sl, (sz[1] - sa[1]) / sl]
    let ang = (Math.atan2(u[1], u[0]) * 180) / Math.PI
    if (ang > 90 + 1e-9) ang -= 180
    else if (ang <= -90 + 1e-9) ang += 180
    const nrm: Pt = [-u[1], u[0]]
    const off = (labelHP * 0.5 + 0.9) * S
    const wLabel = textWidth(labelHP * S, text)
    const fracs = sl > wLabel * 1.15 ? [0.5, 0.38, 0.62, 0.28, 0.72, 0.18, 0.82] : [0.5]
    const cands: TextCand[] = []
    for (const k of [0, 1, 2]) {
      const o = off * (1 + k * 0.9)
      for (const fr of fracs)
        for (const side of [1, -1])
          cands.push({
            x: sa[0] + u[0] * sl * fr + nrm[0] * o * side,
            y: sa[1] + u[1] * sl * fr + nrm[1] * o * side,
            align: 'center',
            vAlign: 'middle',
            rot: ang
          })
    }
    if (tryText(P, S, text, labelHP, cands, 'FP-ANNO', true)) continue
    if (tryText(P, S, text, labelHP, cands, 'FP-ANNO', false)) continue
    const mid: Pt = [(sa[0] + sz[0]) / 2, (sa[1] + sz[1]) / 2]
    if (!P.callout(mid, [text], labelHP))
      P.text('FP-ANNO', mid[0] + nrm[0] * off, mid[1] + nrm[1] * off, labelHP, text, {
        align: 'center',
        vAlign: 'middle',
        rotationDeg: ang
      })
  }

  // ───────── sheet title and right-hand panel ─────────
  const nNoz = fd.enclosures.reduce((s, e) => s + e.nozzles.length, 0)
  sheetTitle(
    c,
    26,
    570,
    `CARBON DIOXIDE TOTAL FLOODING PLAN - ${fd.floorName.toUpperCase()}`,
    `NFPA 12-2022 - FFL ${fi.elevationM >= 0 ? '+' : '-'}${Math.abs(fi.elevationM).toFixed(3)} M - ${fd.enclosures.length} ENCLOSURE(S) - ${nNoz} NOZZLES - SCALE 1:${S}`
  )
  let y = 582
  northArrow(b, PX(c, PANEL.x0 + 14), PY(c, y - 14))
  b.text('FP-ANNO', PX(c, PANEL.x0 + 32), PY(c, y - 6), 3.2, fd.floorName.toUpperCase(), {
    vAlign: 'middle'
  })
  b.text(
    'FP-ANNO',
    PX(c, PANEL.x0 + 32),
    PY(c, y - 12),
    2.4,
    `SCALE 1:${S} (A1)   PLAN NORTH = UP`,
    { vAlign: 'middle' }
  )
  b.text('FP-ANNO', PX(c, PANEL.x0 + 32), PY(c, y - 17.5), 2.4, `SHEET ${sheet.number}`, {
    vAlign: 'middle'
  })
  y = 562

  // legend
  const kinds = new Set(fd.devices.map((v) => v.kind))
  const legend: LegendItem[] = []
  legend.push({
    text: 'PROTECTED ENCLOSURE (HATCHED)',
    draw: (x, yy) => {
      b.rect('CO2-ENCL', x - 4 * S, yy - 1.8 * S, 8 * S, 3.6 * S)
      b.line('CO2-HTCH', x - 3 * S, yy - 1.8 * S, x + 1.2 * S, yy + 1.8 * S)
    }
  })
  legend.push({
    text: 'DISCHARGE NOZZLE (TAG + ORIFICE CODE)',
    draw: (x, yy) => nozzleSymbol(b, x, yy, 1.2 * S)
  })
  legend.push({
    text: 'CO2 PIPE (SIZE, SCH, LENGTH)',
    draw: (x, yy) => b.line('CO2-PIPE', x - 5 * S, yy, x + 5 * S, yy)
  })
  legend.push({
    text: 'CO2 CYLINDER BANK / TANK',
    draw: (x, yy) => {
      b.circle('CO2-STORAGE', x - 1.8 * S, yy, 1.35 * S)
      b.circle('CO2-STORAGE', x + 1.8 * S, yy, 1.35 * S)
    }
  })
  for (const k of order)
    if (kinds.has(k))
      legend.push({ text: DEVICE_LABEL[k], draw: (x, yy) => deviceSymbol(b, k, x, yy, 1.7 * S) })
  legend.push({
    text: 'MOVED SYMBOL - DOT = TRUE POSITION',
    draw: (x, yy) => {
      b.circle('CO2-ANNO', x - 3 * S, yy, 0.35 * S)
      b.line('CO2-ANNO', x - 3 * S, yy, x + 3 * S, yy)
    }
  })
  if (d.plan)
    legend.push({
      text: 'ARCHITECTURAL UNDERLAY (CLIENT DXF)',
      draw: (x, yy) =>
        b.line(archLayerName(d.plan!.entities[0]?.layer ?? 'A-WALL'), x - 5 * S, yy, x + 5 * S, yy)
    })
  const lh = drawLegend(c, PANEL.x0, y, PANEL.x1 - PANEL.x0, legend)
  y -= lh + 3

  // enclosure schedule
  const sched: string[][] = [
    [
      'ENCL',
      'NAME',
      'FIRE',
      'V M3',
      'V FT3',
      'C %',
      'TOTAL LB',
      'TOTAL KG',
      'LB/MIN',
      'T MIN',
      'CYL',
      'NOZ',
      'VENT IN2'
    ]
  ]
  for (const e of fd.enclosures) {
    const q = e.quantity
    sched.push([
      e.enclosureId,
      e.name.toUpperCase(),
      e.fireType === 'surface' ? 'SURFACE' : 'DEEP-SEATED',
      fx(q.volumeFt3 / FT3_PER_M3),
      f0(q.volumeFt3),
      f0(q.designConcentrationPct),
      f0(q.totalLb),
      f0(kgOf(q.totalLb)),
      f0(e.rateLbMin),
      fx(e.dischargeTimeMin, 1),
      st.storage === 'high-pressure' ? String(e.cylinders) : '-',
      String(e.nozzles.length),
      fx(e.ventAreaIn2, 1)
    ])
  }
  const sh = fitTable(
    c,
    PANEL.x0,
    y,
    sched,
    2.1,
    PANEL.x1 - PANEL.x0,
    'ENCLOSURE SCHEDULE - CARBON DIOXIDE TOTAL FLOODING',
    sched[0].map((_, i) => i >= 3)
  )
  y -= sh.h + 3

  // storage summary
  const hp = st.storage === 'high-pressure'
  const sum: string[][] = [
    ['CO2 STORAGE (SYSTEM)', hp ? 'HIGH-PRESSURE CYLINDERS' : 'LOW-PRESSURE TANK'],
    ['GOVERNING ENCLOSURE', st.governingEnclosureId ?? '-'],
    ['MAIN SUPPLY', lbKg(st.mainLb)],
    ['RESERVE SUPPLY', st.reserveLb > 0 ? lbKg(st.reserveLb) : 'NONE'],
    [
      hp ? 'CYLINDERS MAIN + RESERVE' : 'TANK',
      hp
        ? `${st.mainCylinders} + ${st.reserveCylinders} x ${f0(st.cylinderLb)} LB`
        : `${st.tankTons ?? 0} TON`
    ],
    ['INSTALLED CO2', lbKg(st.installedLb)]
  ]
  const ss = fitTable(c, PANEL.x0, y, sum, 2.1, PANEL.x1 - PANEL.x0, 'STORAGE SUMMARY', undefined)
  y -= ss.h + 3

  // notes
  const notes = floorNotes(c, d)
  const avail = y - 74
  let nth = 2.2
  while (nth > 1.5 && notesHeight(PANEL.x0, PANEL.x1 - PANEL.x0, notes, nth) > avail) nth -= 0.1
  drawNotes(c, PANEL.x0, y, PANEL.x1 - PANEL.x0, 'NOTES', notes, nth)
  void textBox
}

// ─────────────────────────── public entry ───────────────────────────

export function generateCo2Drawings(result: FireDesignResult): {
  floors: { floorId: string; drawing: Drawing }[]
  schematic: Drawing
  calculations: Drawing
  combined: Drawing
} {
  const co2 = result.co2
  const cd = result.input.co2Design
  if (!co2 || !cd)
    throw new Error('generateCo2Drawings: result.co2 is null (no CO2 design in the input)')
  const data: Co2FloorData[] = co2.floors.map((fd, index) => {
    const fi = cd.floors.find((x) => x.id === fd.floorId)
    if (!fi)
      throw new Error(`generateCo2Drawings: floor ${fd.floorId} not found in the CO2 design input`)
    return { index, fi, fd, plan: loadFloorPlan(fi.planDxf, fi.planUnits) }
  })
  const archLayers = [
    ...new Set(data.flatMap((d) => (d.plan ? d.plan.layers.map((l) => l.name) : [])))
  ]
  const proj = result.input.projectName
  const floorSpec = (d: Co2FloorData): SheetSpec => {
    const scale = pickCo2FloorScale(d, co2.storage)
    return {
      number: `CO-1${String(d.index + 1).padStart(2, '0')}`,
      title: `CO2 SHOP DRAWING - ${d.fd.floorName.toUpperCase()}`,
      scale,
      scaleText: `1:${scale}`,
      draw: (c) => drawCo2FloorSheet(c, d)
    }
  }
  const schematicSpec: SheetSpec = {
    number: 'CO-501',
    title: 'CO2 SYSTEM SCHEMATIC & DETAILS',
    scale: 10,
    scaleText: 'NTS',
    draw: (c) => drawCo2SchematicSheet(c)
  }
  const calcSpec: SheetSpec = {
    number: 'CO-601',
    title: 'CO2 CALCULATIONS & MATERIALS',
    scale: 10,
    scaleText: 'NTS',
    draw: (c) => drawCo2CalcSheet(c)
  }
  const specs = data.map(floorSpec)
  return {
    floors: data.map((d, i) => ({
      floorId: d.fd.floorId,
      drawing: assembleCo2Drawing(
        result,
        `CO2 ${specs[i].number} - ${d.fd.floorName} - ${proj}`,
        [specs[i]],
        archLayers
      )
    })),
    schematic: assembleCo2Drawing(
      result,
      `CO2 CO-501 system schematic & details - ${proj}`,
      [schematicSpec],
      archLayers
    ),
    calculations: assembleCo2Drawing(
      result,
      `CO2 CO-601 calculations - ${proj}`,
      [calcSpec],
      archLayers
    ),
    combined: assembleCo2Drawing(
      result,
      `CO2 shop drawings - ${proj}`,
      [...specs, schematicSpec, calcSpec],
      archLayers
    )
  }
}
