/** HVAC drawing layers (AIA / NCS style M-*) and plan symbols drawn with the shared DrawingBuilder. */
import { DrawingBuilder, FP_LAYERS } from '../fireProtection/drawing/drawingBuilder'
import type { Drawing, LayerDef, Linetype, SheetInfo } from '../fireProtection/drawing/drawingTypes'
import type { SystemKind, TerminalKind } from './hvacModel'

const L = (
  name: string,
  color: number,
  linetype: Linetype,
  lineweightMm: number,
  description: string
): LayerDef => ({ name, color, linetype, lineweightMm, description })

export const HVAC_LAYERS: LayerDef[] = [
  L('M-DUCT-SUPP', 4, 'CONTINUOUS', 0.35, 'Supply air ductwork (double line)'),
  L('M-DUCT-RETN', 5, 'CONTINUOUS', 0.35, 'Return air ductwork (double line)'),
  L('M-DUCT-CNTR', 8, 'CENTER', 0.13, 'Duct centre-lines'),
  L('M-HVAC-DIFF', 1, 'CONTINUOUS', 0.25, 'Diffusers, grilles, registers'),
  L('M-HVAC-EQPM', 3, 'CONTINUOUS', 0.35, 'Indoor / outdoor units, air handlers'),
  L('M-HVAC-REFR', 30, 'CONTINUOUS', 0.35, 'Refrigerant line sets'),
  L('M-ZONE', 8, 'CONTINUOUS', 0.25, 'Zone outlines'),
  L('M-ANNO', 7, 'CONTINUOUS', 0.25, 'Text, tags, leaders'),
  L('M-DIMS', 7, 'CONTINUOUS', 0.18, 'Dimensions'),
  L('M-LEGEND', 7, 'CONTINUOUS', 0.18, 'Legend'),
  L('M-TABL', 7, 'CONTINUOUS', 0.18, 'Schedules & tables'),
  L('M-TBLK', 7, 'CONTINUOUS', 0.5, 'Sheet frame & title block'),
  L('M-CNTR', 8, 'CENTER', 0.13, 'Centre-lines'),
  L('M-LEVL', 5, 'CONTINUOUS', 0.18, 'Level markers'),
  L('M-WALL', 7, 'CONTINUOUS', 0.5, 'Walls'),
  L('M-WALL-HTCH', 8, 'CONTINUOUS', 0.13, 'Hatch'),
  L('M-HIDN', 8, 'HIDDEN', 0.18, 'Hidden'),
  L('M-EQPM', 3, 'CONTINUOUS', 0.35, 'Equipment'),
  L('M-VALV', 2, 'CONTINUOUS', 0.25, 'Valves'),
  L('M-ARCH', 8, 'CONTINUOUS', 0.25, 'Architectural')
]

/** Builder with the FP-* layers (used by the shared sheet helpers) and the M-* layers. */
export function newHvacBuilder(title: string): DrawingBuilder {
  return new DrawingBuilder(title, [...FP_LAYERS, ...HVAC_LAYERS])
}

/** Map FP-* entities onto M-* twins and drop unused FP-* layer definitions. */
export function finishHvacDrawing(b: DrawingBuilder, sheets: SheetInfo[]): Drawing {
  const d = b.build(sheets)
  const names = new Set(HVAC_LAYERS.map((l) => l.name))
  for (const e of d.entities) {
    if (!e.layer.startsWith('FP-')) continue
    const t = `M-${e.layer.slice(3)}`
    if (!names.has(t)) throw new Error(`hvacSheets: no M layer for ${e.layer}`)
    e.layer = t
  }
  const used = new Set(d.entities.map((e) => e.layer))
  return { ...d, layers: d.layers.filter((l) => !l.name.startsWith('FP-') && used.has(l.name)) }
}

const DIFF = 'M-HVAC-DIFF'
const EQ = 'M-HVAC-EQPM'

/** Terminal symbol (centred at cx, cy; w × h model mm). */
export function terminalSymbol(
  b: DrawingBuilder,
  kind: TerminalKind,
  cx: number,
  cy: number,
  w: number,
  h: number
): void {
  const x0 = cx - w / 2
  const x1 = cx + w / 2
  const y0 = cy - h / 2
  const y1 = cy + h / 2
  b.rect(DIFF, x0, y0, w, h)
  switch (kind) {
    case 'supply':
    case 'cassette': {
      const k = 0.22
      b.rect(DIFF, x0 + w * k, y0 + h * k, w * (1 - 2 * k), h * (1 - 2 * k))
      b.line(DIFF, x0, y0, x0 + w * k, y0 + h * k)
      b.line(DIFF, x1, y0, x1 - w * k, y0 + h * k)
      b.line(DIFF, x0, y1, x0 + w * k, y1 - h * k)
      b.line(DIFF, x1, y1, x1 - w * k, y1 - h * k)
      if (kind === 'cassette') b.circle(DIFF, cx, cy, Math.min(w, h) * 0.12)
      break
    }
    case 'return': {
      // louvres (return grille)
      const n = 4
      for (let i = 1; i <= n; i++) {
        const y = y0 + (h * i) / (n + 1)
        b.line(DIFF, x0, y, x1, y)
      }
      break
    }
    case 'exhaust':
      b.line(DIFF, x0, y0, x1, y1)
      b.line(DIFF, x0, y1, x1, y0)
      b.circle(DIFF, cx, cy, Math.min(w, h) * 0.22)
      break
    case 'high-wall':
      b.line(DIFF, x0, cy, x1, cy)
      b.line(DIFF, cx - w * 0.2, cy, cx - w * 0.2, y0)
      b.line(DIFF, cx + w * 0.2, cy, cx + w * 0.2, y0)
      break
  }
}

/** Indoor unit outline by system type. */
export function indoorUnitSymbol(
  b: DrawingBuilder,
  sys: SystemKind,
  cx: number,
  cy: number,
  w: number,
  h: number
): void {
  const x0 = cx - w / 2
  const x1 = cx + w / 2
  const y0 = cy - h / 2
  const y1 = cy + h / 2
  b.rect(EQ, x0, y0, w, h)
  switch (sys) {
    case 'cassette':
      b.rect(EQ, x0 + w * 0.18, y0 + h * 0.18, w * 0.64, h * 0.64)
      b.line(EQ, x0, y0, x1, y1)
      b.line(EQ, x0, y1, x1, y0)
      break
    case 'high-wall':
      b.line(EQ, x0 + w * 0.06, y0 + h * 0.3, x1 - w * 0.06, y0 + h * 0.3)
      b.line(EQ, x0 + w * 0.06, y0 + h * 0.62, x1 - w * 0.06, y0 + h * 0.62)
      break
    case 'packaged':
    case 'ahu':
      b.line(EQ, x0, y0, x1, y1)
      b.line(EQ, x0, y1, x1, y0)
      b.circle(EQ, cx, cy, Math.min(w, h) * 0.28)
      break
    default: {
      // ducted: fan section + discharge collar
      b.line(EQ, x0 + w * 0.3, y0, x0 + w * 0.3, y1)
      b.circle(EQ, x0 + w * 0.15, cy, Math.min(w * 0.12, h * 0.3))
      b.line(EQ, x1, y0 + h * 0.2, x1 + w * 0.06, y0 + h * 0.2)
      b.line(EQ, x1, y1 - h * 0.2, x1 + w * 0.06, y1 - h * 0.2)
      b.line(EQ, x0 + w * 0.3, y0, x1, y1)
      b.line(EQ, x0 + w * 0.3, y1, x1, y0)
    }
  }
}

export function outdoorUnitSymbol(
  b: DrawingBuilder,
  cx: number,
  cy: number,
  w: number,
  h: number
): void {
  b.rect(EQ, cx - w / 2, cy - h / 2, w, h)
  const r = Math.min(w / 4, h / 2) * 0.82
  b.circle(EQ, cx - w / 4, cy, r)
  b.circle(EQ, cx + w / 4, cy, r)
  b.line(EQ, cx - w / 4 - r, cy, cx - w / 4 + r, cy)
  b.line(EQ, cx + w / 4 - r, cy, cx + w / 4 + r, cy)
}

/** Flow arrow (filled triangle) with its tip at (x + u·len/2, …). */
export function flowArrow(
  b: DrawingBuilder,
  layer: string,
  x: number,
  y: number,
  ux: number,
  uy: number,
  len: number,
  wid: number
): void {
  const tipX = x + ux * len * 0.5
  const tipY = y + uy * len * 0.5
  const baseX = x - ux * len * 0.5
  const baseY = y - uy * len * 0.5
  b.solid(layer, [
    [tipX, tipY],
    [baseX - uy * wid * 0.5, baseY + ux * wid * 0.5],
    [baseX + uy * wid * 0.5, baseY - ux * wid * 0.5]
  ])
}

export function isolatorSymbol(
  b: DrawingBuilder,
  x: number,
  y: number,
  r: number,
  hPaper: number
): void {
  b.circle('M-HVAC-REFR', x, y, r)
  b.text('M-HVAC-REFR', x, y, hPaper, 'R', { align: 'center', vAlign: 'middle' })
}
