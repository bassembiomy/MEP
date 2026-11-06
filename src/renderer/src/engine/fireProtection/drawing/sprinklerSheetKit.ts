/**
 * Shared kit of the sprinkler shop-drawing sheets (FS-1nn, FS-501, FS-601): layer set, head symbols,
 * layer re-mapping of the shared helpers (FP-* → FS-*), drawing assembly and small formatting helpers.
 */
import type { SprinklerHeadType, SprinklerSystemType } from '../sprinkler/sprinklerTypes'
import { DrawingBuilder, FP_LAYERS } from './drawingBuilder'
import type { Drawing, LayerDef, Linetype, SheetInfo } from './drawingTypes'
import { titleBlock } from './symbols'
import type { Ctx } from './sheetKit'
import type { FireDesignResult } from '../fpTypes'

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

/** Sprinkler drawing layers. The shared helpers draw on FP-* layers which are mapped 1:1 onto the FS-* twins below. */
export const FS_LAYERS: LayerDef[] = [
  L('FS-HEAD', 1, 'CONTINUOUS', 0.35, 'Sprinkler heads'),
  L('FS-PIPE-BRANCH', 5, 'CONTINUOUS', 0.35, 'Branch lines'),
  L('FS-PIPE-MAIN', 1, 'CONTINUOUS', 0.5, 'Cross mains, feed mains, risers (riser diagram)'),
  L('FS-PIPE-RISER', 1, 'CONTINUOUS', 0.7, 'Riser nipple / floor control assembly piping'),
  L('FS-HANG', 30, 'CONTINUOUS', 0.25, 'Hangers and sway braces'),
  L('FS-REMOTE', 6, 'DASHED', 0.35, 'Hydraulically most remote design area'),
  L('FS-ROOM', 3, 'CONTINUOUS', 0.18, 'Room outlines'),
  L('FS-ANNO', 7, 'CONTINUOUS', 0.25, 'Text, tags, leaders'),
  L('FS-DIMS', 7, 'CONTINUOUS', 0.18, 'Dimensions'),
  L('FS-TBLK', 7, 'CONTINUOUS', 0.5, 'Sheet frame & title block'),
  L('FS-LEGEND', 7, 'CONTINUOUS', 0.18, 'Legend'),
  L('FS-TABL', 7, 'CONTINUOUS', 0.18, 'Schedules & tables'),
  L('FS-VALV', 30, 'CONTINUOUS', 0.25, 'Valves & trim'),
  L('FS-EQPM', 3, 'CONTINUOUS', 0.35, 'Equipment, cabinets'),
  L('FS-CNTR', 8, 'CENTER', 0.13, 'Centre-lines'),
  L('FS-LEVL', 5, 'CONTINUOUS', 0.18, 'Level markers'),
  L('FS-WALL', 7, 'CONTINUOUS', 0.5, 'Structure (cut)'),
  L('FS-WALL-HTCH', 8, 'CONTINUOUS', 0.13, 'Structure hatch'),
  L('FS-HIDN', 8, 'HIDDEN', 0.18, 'Hidden / limits'),
  L('FS-GRAPH', 4, 'CONTINUOUS', 0.35, 'Graph curves')
]

/** Architectural layer name on the sprinkler drawings: `A-` + original name (already `A-…` names are kept). */
export function archLayerName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9_$-]/g, '_').toUpperCase()
  return clean.startsWith('A-') ? clean : `A-${clean}`
}

const archLayerDef = (name: string): LayerDef =>
  L(name, 8, 'CONTINUOUS', 0.13, 'Architectural underlay (client plan)')

/** Builder with every layer that any sprinkler sheet may use (FP-* for the shared helpers, FS-*, A-*). */
export function newSprinklerBuilder(title: string, archLayers: string[]): DrawingBuilder {
  const arch = [...new Set(archLayers.map(archLayerName))].map(archLayerDef)
  return new DrawingBuilder(title, [...FP_LAYERS, ...FS_LAYERS, ...arch])
}

/** Map FP-* entities onto the FS-* layers and drop unused layer definitions. */
export function finishSprinklerDrawing(b: DrawingBuilder, sheets: SheetInfo[]): Drawing {
  const d = b.build(sheets)
  const fsNames = new Set(FS_LAYERS.map((l) => l.name))
  const remap = (n: string): string => {
    if (!n.startsWith('FP-')) return n
    const t = `FS-${n.slice(3)}`
    if (!fsNames.has(t)) throw new Error(`sprinklerSheets: no FS layer for ${n}`)
    return t
  }
  for (const e of d.entities) e.layer = remap(e.layer)
  const used = new Set(d.entities.map((e) => e.layer))
  const layers = d.layers.filter((l) => !l.name.startsWith('FP-') && used.has(l.name))
  return { ...d, layers }
}

export const SPK_DATE = '2026-11-06'
export const SPK_STANDARDS = 'NFPA 13-2019 / NFPA 25 / NFPA 24 / NFPA 72 / IBC 903'

export interface SheetSpec {
  number: string
  title: string
  scale: number
  scaleText: string
  draw: (c: Ctx) => void
}

/** Lay the sheets out left → right in one builder and return the finished drawing. */
export function assembleSprinklerDrawing(
  result: FireDesignResult,
  title: string,
  specs: SheetSpec[],
  archLayers: string[]
): Drawing {
  const b = newSprinklerBuilder(title, archLayers)
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
      date: SPK_DATE,
      drawnBy: result.input.designer,
      checkedBy: 'CHECKER',
      standards: SPK_STANDARDS
    })
    sp.draw({ b, sheet: sh, r: result })
  }
  return finishSprinklerDrawing(b, sheets)
}

// ─────────────────────────── labels & formatting ───────────────────────────

const FRAC: Record<number, string> = {
  0.5: '½',
  0.75: '¾',
  1.25: '1¼',
  1.5: '1½',
  2.5: '2½',
  3.5: '3½'
}
/** Pipe size label as drawn on plans: 1", 1¼", 1½", 2", 2½" … */
export const sizeLabel = (n: number): string => `${FRAC[n] ?? String(n)}"`

export const SYSTEM_LABEL: Record<SprinklerSystemType, string> = {
  wet: 'WET-PIPE',
  dry: 'DRY-PIPE',
  'preaction-single': 'PREACTION (SINGLE INTERLOCK)',
  'preaction-double': 'PREACTION (DOUBLE INTERLOCK)',
  deluge: 'DELUGE'
}

export const ORIENT_LABEL: Record<SprinklerHeadType['orientation'], string> = {
  pendent: 'PENDENT',
  upright: 'UPRIGHT',
  'dry-pendent': 'DRY-PENDENT',
  'concealed-pendent': 'CONCEALED PENDENT'
}

export const HAZARD_LABEL: Record<string, string> = {
  light: 'LIGHT',
  'ordinary-1': 'ORDINARY GRP 1',
  'ordinary-2': 'ORDINARY GRP 2',
  'extra-1': 'EXTRA GRP 1',
  'extra-2': 'EXTRA GRP 2'
}

export const tempC = (f: number): number => Math.round(((f - 32) * 5) / 9)

/** Legend text of a head type: orientation, K, temperature, response. */
export function headTypeText(t: SprinklerHeadType): string {
  const kind = t.open ? 'OPEN (DELUGE)' : ORIENT_LABEL[t.orientation]
  return `${kind} K${t.kFactor}, ${t.tempRatingF}F (${tempC(t.tempRatingF)}C) ${t.tempClass.toUpperCase()}, ${t.response.toUpperCase()}-RESPONSE`
}

// ─────────────────────────── head symbols ───────────────────────────

type Pt = [number, number]

function disc(b: DrawingBuilder, layer: string, x: number, y: number, r: number): void {
  b.solid(layer, [
    [x - r, y - r],
    [x + r, y - r],
    [x + r, y + r],
    [x - r, y + r]
  ])
  const q = r * Math.SQRT2
  b.solid(layer, [
    [x, y - q],
    [x + q, y],
    [x, y + q],
    [x - q, y]
  ])
}

/**
 * Sprinkler symbol at (x, y), radius r (model mm):
 * pendent = circle with cross, upright = circle with filled core, dry-pendent = circle with the right half filled,
 * concealed pendent = circle with a square, open = double circle.
 */
export function headSymbol(
  b: DrawingBuilder,
  x: number,
  y: number,
  r: number,
  type: SprinklerHeadType | null,
  layer = 'FS-HEAD'
): void {
  const kind = type?.open ? 'open' : (type?.orientation ?? 'pendent')
  b.circle(layer, x, y, r)
  switch (kind) {
    case 'pendent':
      b.line(layer, x - r, y, x + r, y)
      b.line(layer, x, y - r, x, y + r)
      break
    case 'upright':
      disc(b, layer, x, y, r * 0.55)
      break
    case 'dry-pendent': {
      const k = Math.SQRT1_2 * r
      b.solid(layer, [
        [x, y],
        [x, y + r],
        [x + k, y + k],
        [x + r, y]
      ])
      b.solid(layer, [
        [x, y],
        [x + r, y],
        [x + k, y - k],
        [x, y - r]
      ])
      b.line(layer, x, y - r, x, y + r)
      break
    }
    case 'concealed-pendent': {
      const q = r * 0.6
      b.polyline(
        layer,
        [
          [x - q, y - q],
          [x + q, y - q],
          [x + q, y + q],
          [x - q, y + q]
        ],
        true
      )
      break
    }
    case 'open':
      b.circle(layer, x, y, r * 0.5)
      break
  }
}

/** Squared distance helpers shared by the sheets. */
export const dist = (a: Pt, c: Pt): number => Math.hypot(a[0] - c[0], a[1] - c[1])

/** True when point p lies inside the polygon (even-odd). */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

/** Liang–Barsky clip of a segment to a rectangle; null when entirely outside. */
export function clipSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  w: { x0: number; y0: number; x1: number; y1: number }
): [number, number, number, number] | null {
  let t0 = 0
  let t1 = 1
  const dx = x2 - x1
  const dy = y2 - y1
  for (const [p, q] of [
    [-dx, x1 - w.x0],
    [dx, w.x1 - x1],
    [-dy, y1 - w.y0],
    [dy, w.y1 - y1]
  ] as [number, number][]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null
    } else {
      const r = q / p
      if (p < 0) {
        if (r > t1) return null
        if (r > t0) t0 = r
      } else {
        if (r < t0) return null
        if (r < t1) t1 = r
      }
    }
  }
  return [x1 + dx * t0, y1 + dy * t0, x1 + dx * t1, y1 + dy * t1]
}

/** 45° hatch lines clipped to a rectangle on an arbitrary layer (global grid, so neighbouring strips align). */
export function hatchRectOn(
  b: DrawingBuilder,
  layer: string,
  x: number,
  y: number,
  w: number,
  h: number,
  step: number
): void {
  if (!(step > 0) || !(w > 0) || !(h > 0)) return
  const k0 = Math.ceil((y - (x + w)) / step)
  const k1 = Math.floor((y + h - x) / step)
  for (let k = k0; k <= k1; k++) {
    const c = k * step
    const xa = Math.max(x, y - c)
    const xb = Math.min(x + w, y + h - c)
    if (xb - xa > 1e-6) b.line(layer, xa, xa + c, xb, xb + c)
  }
}
