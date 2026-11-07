/**
 * Shared kit of the CO2 shop-drawing sheets (CO-1nn, CO-501, CO-601): layer set, device / nozzle symbols, layer
 * re-mapping of the shared helpers (FP-* → CO2-*), drawing assembly, polygon helpers and small formatting helpers.
 */
import { LB_PER_KG } from '../co2/nfpa12'
import type { Co2DeviceKind } from '../co2/co2Types'
import type { FireDesignResult } from '../fpTypes'
import { DrawingBuilder, FP_LAYERS } from './drawingBuilder'
import type { Drawing, LayerDef, Linetype, SheetInfo } from './drawingTypes'
import {
  type Box,
  type Ctx,
  type Placer,
  type Pt,
  PX,
  PY,
  autoCols,
  drawTable,
  measureTable,
  textBox
} from './sheetKit'
import { archLayerName } from './sprinklerSheetKit'
import { titleBlock } from './symbols'

const L = (
  name: string,
  color: number,
  linetype: Linetype,
  lineweightMm: number,
  description: string
): LayerDef => ({
  name,
  color,
  linetype,
  lineweightMm,
  description
})

/** CO2 drawing layers. The shared helpers draw on FP-* layers which are mapped 1:1 onto the CO2-* twins below. */
export const CO2_LAYERS: LayerDef[] = [
  L('CO2-ENCL', 6, 'CONTINUOUS', 0.5, 'Protected enclosures (outline)'),
  L('CO2-HTCH', 253, 'CONTINUOUS', 0.13, 'Protected enclosure hatch'),
  L('CO2-NOZZLE', 1, 'CONTINUOUS', 0.35, 'Discharge nozzles'),
  L('CO2-PIPE', 5, 'CONTINUOUS', 0.5, 'CO2 discharge piping'),
  L('CO2-DEVICE', 3, 'CONTINUOUS', 0.35, 'Detection, alarm, release and control devices'),
  L('CO2-STORAGE', 30, 'CONTINUOUS', 0.5, 'CO2 cylinder bank / storage tank'),
  L('CO2-ANNO', 7, 'CONTINUOUS', 0.25, 'Text, tags, leaders'),
  L('CO2-CTRL', 6, 'DASHED', 0.25, 'Control, pilot and signal lines'),
  L('CO2-DIMS', 7, 'CONTINUOUS', 0.18, 'Dimensions'),
  L('CO2-TBLK', 7, 'CONTINUOUS', 0.5, 'Sheet frame & title block'),
  L('CO2-LEGEND', 7, 'CONTINUOUS', 0.18, 'Legend'),
  L('CO2-TABL', 7, 'CONTINUOUS', 0.18, 'Schedules & tables'),
  L('CO2-VALV', 30, 'CONTINUOUS', 0.25, 'Valves & fittings'),
  L('CO2-EQPM', 3, 'CONTINUOUS', 0.35, 'Equipment'),
  L('CO2-CNTR', 8, 'CENTER', 0.13, 'Centre-lines'),
  L('CO2-LEVL', 5, 'CONTINUOUS', 0.18, 'Level markers'),
  L('CO2-WALL', 7, 'CONTINUOUS', 0.5, 'Structure (cut)'),
  L('CO2-WALL-HTCH', 8, 'CONTINUOUS', 0.13, 'Structure hatch'),
  L('CO2-HIDN', 8, 'HIDDEN', 0.18, 'Hidden / limits')
]

const archLayerDef = (name: string): LayerDef =>
  L(name, 8, 'CONTINUOUS', 0.13, 'Architectural underlay (client plan)')

export function newCo2Builder(title: string, archLayers: string[]): DrawingBuilder {
  const arch = [...new Set(archLayers.map(archLayerName))].map(archLayerDef)
  return new DrawingBuilder(title, [...FP_LAYERS, ...CO2_LAYERS, ...arch])
}

/** Map FP-* entities onto the CO2-* layers and drop unused layer definitions. */
export function finishCo2Drawing(b: DrawingBuilder, sheets: SheetInfo[]): Drawing {
  const d = b.build(sheets)
  const names = new Set(CO2_LAYERS.map((l) => l.name))
  const remap = (n: string): string => {
    if (!n.startsWith('FP-')) return n
    const t = `CO2-${n.slice(3)}`
    if (!names.has(t)) throw new Error(`co2Sheets: no CO2 layer for ${n}`)
    return t
  }
  for (const e of d.entities) e.layer = remap(e.layer)
  const used = new Set(d.entities.map((e) => e.layer))
  return { ...d, layers: d.layers.filter((l) => !l.name.startsWith('FP-') && used.has(l.name)) }
}

export const CO2_DATE = '2026-11-06'
export const CO2_STANDARDS = 'NFPA 12-2022 / NFPA 72 / NFPA 70'

export interface SheetSpec {
  number: string
  title: string
  scale: number
  scaleText: string
  draw: (c: Ctx) => void
}

/** Lay the sheets out left → right in one builder and return the finished drawing. */
export function assembleCo2Drawing(
  result: FireDesignResult,
  title: string,
  specs: SheetSpec[],
  archLayers: string[]
): Drawing {
  const b = newCo2Builder(title, archLayers)
  const sheets: SheetInfo[] = []
  let ox = 0
  for (const sp of specs) {
    const sh: SheetInfo = {
      number: sp.number,
      title: sp.title,
      scale: sp.scale,
      paper: 'A1',
      paperWidthMm: 841,
      paperHeightMm: 594,
      originX: ox,
      originY: 0
    }
    ox += 841 * sp.scale + 5000
    sheets.push(sh)
    titleBlock(b, sh, {
      project: result.input.projectName,
      projectNumber: result.input.projectNumber,
      drawingTitle: sp.title,
      sheetNumber: sp.number,
      scaleText: sp.scaleText,
      date: CO2_DATE,
      drawnBy: result.input.designer,
      checkedBy: 'CHECKER',
      standards: CO2_STANDARDS
    })
    sp.draw({ b, sheet: sh, r: result })
  }
  return finishCo2Drawing(b, sheets)
}

// ─────────────────────────── formatting ───────────────────────────

export const f0 = (v: number): string => String(Math.round(Number.isFinite(v) ? v : 0))
export const fx = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d) : '-')
export const kgOf = (lb: number): number => lb / LB_PER_KG
/** "1365 LB (619 KG)" */
export const lbKg = (lb: number): string => `${f0(lb)} LB (${f0(kgOf(lb))} KG)`

export const DEVICE_LABEL: Record<Co2DeviceKind, string> = {
  'smoke-detector': 'SMOKE DETECTOR (ZONE A / B)',
  'heat-detector': 'HEAT DETECTOR',
  'horn-strobe': 'HORN / STROBE INSIDE (PRE-DISCHARGE)',
  'strobe-outside': 'STROBE OUTSIDE - DISCHARGE IN PROGRESS',
  'manual-release': 'MANUAL RELEASE STATION',
  'warning-sign': 'WARNING SIGN (NFPA 12)',
  'lockout-valve': 'LOCKOUT VALVE (SUPERVISED)',
  'selector-valve': 'SELECTOR (DIRECTIONAL) VALVE',
  'pressure-switch': 'PRESSURE SWITCH',
  'pressure-relief-vent': 'PRESSURE RELIEF VENT',
  'control-panel': 'CO2 RELEASING CONTROL PANEL'
}

// ─────────────────────────── symbols ───────────────────────────

const DEVICE_LAYER = 'CO2-DEVICE'

/** Device symbol at (x, y) with base radius r (model mm). Every kind has its own geometry. */
export function deviceSymbol(
  b: DrawingBuilder,
  kind: Co2DeviceKind,
  x: number,
  y: number,
  r: number,
  vertical = false
): void {
  const T = (t: string, h: number, dy = 0): void =>
    b.text(DEVICE_LAYER, x, y + dy, h / b.scale, t, { align: 'center', vAlign: 'middle' })
  // local (u along the pipe, v across it) → model; vertical valves lie along y
  const pt = (u: number, v: number): Pt => (vertical ? [x - v, y + u] : [x + u, y + v])
  const bow = (hw: number, hh: number): void => {
    b.polyline(DEVICE_LAYER, [pt(-hw, -hh), pt(-hw, hh), pt(0, 0)], true)
    b.polyline(DEVICE_LAYER, [pt(hw, -hh), pt(hw, hh), pt(0, 0)], true)
  }
  switch (kind) {
    case 'smoke-detector':
      b.circle(DEVICE_LAYER, x, y, r)
      T('S', 1.2 * r)
      break
    case 'heat-detector':
      b.circle(DEVICE_LAYER, x, y, r)
      T('H', 1.2 * r)
      break
    case 'horn-strobe':
      b.rect(DEVICE_LAYER, x - r, y - r, 2 * r, 2 * r)
      T('HS', 0.95 * r)
      break
    case 'strobe-outside': {
      const q = 1.3 * r
      b.polyline(
        DEVICE_LAYER,
        [
          [x, y - q],
          [x + q, y],
          [x, y + q],
          [x - q, y]
        ],
        true
      )
      T('ST', 0.85 * r)
      break
    }
    case 'manual-release': {
      const q = 1.15 * r
      const pts: Pt[] = []
      for (let k = 0; k < 6; k++)
        pts.push([x + q * Math.cos((k * Math.PI) / 3), y + q * Math.sin((k * Math.PI) / 3)])
      b.polyline(DEVICE_LAYER, pts, true)
      T('MR', 0.9 * r)
      break
    }
    case 'warning-sign':
      b.polyline(
        DEVICE_LAYER,
        [
          [x - 1.25 * r, y - 0.85 * r],
          [x + 1.25 * r, y - 0.85 * r],
          [x, y + 1.25 * r]
        ],
        true
      )
      T('!', 1.15 * r, -0.2 * r)
      break
    case 'lockout-valve': {
      bow(1.1 * r, 0.65 * r)
      const s0 = pt(0, 0)
      const s1 = pt(0, 0.9 * r)
      b.line(DEVICE_LAYER, s0[0], s0[1], s1[0], s1[1])
      b.solid(DEVICE_LAYER, [
        pt(-0.45 * r, 0.9 * r),
        pt(0.45 * r, 0.9 * r),
        pt(0.45 * r, 1.5 * r),
        pt(-0.45 * r, 1.5 * r)
      ])
      break
    }
    case 'selector-valve': {
      bow(1.1 * r, 0.65 * r)
      const s0 = pt(0, 0)
      const s1 = pt(0, 0.7 * r)
      b.line(DEVICE_LAYER, s0[0], s0[1], s1[0], s1[1])
      const c0 = pt(0, 1.15 * r)
      b.circle(DEVICE_LAYER, c0[0], c0[1], 0.45 * r)
      break
    }
    case 'pressure-switch':
      b.circle(DEVICE_LAYER, x, y + 0.25 * r, 0.95 * r)
      b.line(DEVICE_LAYER, x, y - 0.7 * r, x, y - 1.3 * r)
      b.text(DEVICE_LAYER, x, y + 0.25 * r, (0.8 * r) / b.scale, 'PS', {
        align: 'center',
        vAlign: 'middle'
      })
      break
    case 'pressure-relief-vent':
      b.rect(DEVICE_LAYER, x - 1.15 * r, y - 0.8 * r, 2.3 * r, 1.6 * r)
      for (const k of [-0.4, 0, 0.4])
        b.line(DEVICE_LAYER, x - 0.9 * r, y + k * r * 1.1, x + 0.9 * r, y + k * r * 1.1)
      break
    case 'control-panel':
      b.rect(DEVICE_LAYER, x - 1.35 * r, y - 0.95 * r, 2.7 * r, 1.9 * r)
      b.rect(DEVICE_LAYER, x - 1.15 * r, y - 0.75 * r, 2.3 * r, 1.5 * r)
      T('CP', 0.95 * r)
      break
  }
}

/** Discharge nozzle in plan: ring, centre and four radial discharge ticks. */
export function nozzleSymbol(b: DrawingBuilder, x: number, y: number, r: number): void {
  const layer = 'CO2-NOZZLE'
  b.circle(layer, x, y, r)
  b.circle(layer, x, y, 0.4 * r)
  const k = Math.SQRT1_2
  for (const [ux, uy] of [
    [k, k],
    [-k, k],
    [-k, -k],
    [k, -k]
  ])
    b.line(layer, x + ux * r, y + uy * r, x + ux * 1.7 * r, y + uy * 1.7 * r)
}

// ─────────────────────────── geometry ───────────────────────────

export interface BoxMm {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function polyBBox(poly: Pt[]): BoxMm {
  const bb: BoxMm = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const [x, y] of poly) {
    bb.minX = Math.min(bb.minX, x)
    bb.maxX = Math.max(bb.maxX, x)
    bb.minY = Math.min(bb.minY, y)
    bb.maxY = Math.max(bb.maxY, y)
  }
  return bb
}

/** Area-weighted centroid (falls back to the bounding-box centre for degenerate polygons). */
export function polyCentroid(poly: Pt[]): Pt {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]
    const [x1, y1] = poly[(i + 1) % poly.length]
    const w = x0 * y1 - x1 * y0
    a += w
    cx += (x0 + x1) * w
    cy += (y0 + y1) * w
  }
  if (Math.abs(a) < 1e-6) {
    const bb = polyBBox(poly)
    return [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2]
  }
  return [cx / (3 * a), cy / (3 * a)]
}

/** 45° hatch lines clipped to an arbitrary (simple) polygon, on a global grid so neighbours align. */
export function hatchPolygon(b: DrawingBuilder, layer: string, poly: Pt[], step: number): void {
  if (!(step > 0) || poly.length < 3) return
  const bb = polyBBox(poly)
  const k0 = Math.ceil((bb.minY - bb.maxX) / step)
  const k1 = Math.floor((bb.maxY - bb.minX) / step)
  for (let k = k0; k <= k1; k++) {
    const c = k * step // line y = x + c
    const xs: number[] = []
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      const fp = p[1] - p[0] - c
      const fq = q[1] - q[0] - c
      if (fp >= 0 !== fq >= 0) {
        const t = fp / (fp - fq)
        xs.push(p[0] + (q[0] - p[0]) * t)
      }
    }
    xs.sort((m, n) => m - n)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] > 1e-6) b.line(layer, xs[i], xs[i] + c, xs[i + 1], xs[i + 1] + c)
    }
  }
}

/** Soft collision boxes along a polyline (labels avoid lying on pipes / walls). */
export function addSoftAlong(
  P: Placer,
  pts: Pt[],
  closed: boolean,
  half: number,
  pitch: number
): void {
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const z = pts[(i + 1) % pts.length]
    const l = Math.hypot(z[0] - a[0], z[1] - a[1])
    const m = Math.max(1, Math.ceil(l / pitch))
    for (let k = 0; k <= m; k++) {
      const x = a[0] + ((z[0] - a[0]) * k) / m
      const y = a[1] + ((z[1] - a[1]) * k) / m
      P.addSoft({ x0: x - half, y0: y - half, x1: x + half, y1: y + half })
    }
  }
}

export interface TextCand {
  x: number
  y: number
  align: 'left' | 'center' | 'right'
  vAlign: 'bottom' | 'top' | 'middle'
  rot?: number
}

/** Place a text at the first free candidate (registered as a hard obstacle); false when none is free. */
export function tryText(
  P: Placer,
  S: number,
  text: string,
  hP: number,
  cands: TextCand[],
  layer = 'FP-ANNO',
  soft = true,
  pad = 0.35
): boolean {
  const h = hP * S
  for (const q of cands) {
    const bx: Box = textBox(q.x, q.y, h, text, q.align, q.vAlign, q.rot ?? 0)
    if (!P.free(bx, pad * S, soft)) continue
    P.text(layer, q.x, q.y, hP, text, { align: q.align, vAlign: q.vAlign, rotationDeg: q.rot })
    return true
  }
  return false
}

/** Text candidates around an anchor (model mm): above, below, right, left and farther rings. */
export function ringCands(m: Pt, S: number, r: number): TextCand[] {
  const o: [number, number, TextCand['align'], TextCand['vAlign']][] = [
    [0, r, 'center', 'bottom'],
    [0, -r, 'center', 'top'],
    [r * 0.8, r * 0.6, 'left', 'bottom'],
    [-r * 0.8, r * 0.6, 'right', 'bottom'],
    [r * 0.8, -r * 0.6, 'left', 'top'],
    [-r * 0.8, -r * 0.6, 'right', 'top'],
    [r * 1.1, 0, 'left', 'middle'],
    [-r * 1.1, 0, 'right', 'middle'],
    [0, r * 2, 'center', 'bottom'],
    [0, -r * 2, 'center', 'top'],
    [r * 2, r * 1.2, 'left', 'bottom'],
    [-r * 2, r * 1.2, 'right', 'bottom'],
    [r * 2, -r * 1.2, 'left', 'top'],
    [-r * 2, -r * 1.2, 'right', 'top']
  ]
  void S
  return o.map(([dx, dy, align, vAlign]) => ({ x: m[0] + dx, y: m[1] + dy, align, vAlign }))
}

// ─────────────────────────── tables & legend ───────────────────────────

/** Shrink the text height until the table (columns fitted to content) is not wider than maxW. */
export function fitTable(
  c: Ctx,
  x: number,
  yTop: number,
  rows: string[][],
  th0: number,
  maxW: number,
  title: string,
  align?: boolean[],
  thMin = 1.5
): { w: number; h: number; th: number } {
  let th = th0
  let cols = autoCols(rows, th)
  while (th > thMin && measureTable(cols, rows, { th, title }).w > maxW) {
    th -= 0.1
    cols = autoCols(rows, th)
  }
  const sz = drawTable(c, x, yTop, cols, rows, { th, title, alignRight: align })
  return { ...sz, th }
}

export interface LegendItem {
  text: string
  /** Draw the symbol centred at model (x, y). */
  draw: (x: number, y: number) => void
}

/** Two-column legend box (layer CO2-LEGEND). Returns the paper height. */
export function drawLegend(
  c: Ctx,
  xP: number,
  yTopP: number,
  w: number,
  items: LegendItem[],
  title = 'LEGEND'
): number {
  const { b, sheet } = c
  const s = sheet.scale
  const rowH = 6
  const rows = Math.ceil(items.length / 2)
  const h = 7 + rows * rowH + 1
  b.rect('CO2-LEGEND', PX(c, xP), PY(c, yTopP - h), w * s, h * s)
  b.text('CO2-LEGEND', PX(c, xP + 3), PY(c, yTopP - 3.5), 3.2, title, { vAlign: 'middle' })
  b.line('CO2-LEGEND', PX(c, xP), PY(c, yTopP - 7), PX(c, xP + w), PY(c, yTopP - 7))
  const colW = w / 2
  items.forEach((it, i) => {
    const col = i < rows ? 0 : 1
    const row = i % rows
    const x0 = xP + col * colW
    const y = yTopP - 7 - rowH * (row + 0.5)
    it.draw(PX(c, x0 + 7), PY(c, y))
    b.text('CO2-LEGEND', PX(c, x0 + 14.5), PY(c, y), 2.1, it.text, { vAlign: 'middle' })
  })
  return h
}
