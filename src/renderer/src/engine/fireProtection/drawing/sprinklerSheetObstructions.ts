/**
 * Obstructions on the sprinkler floor sheets (FS-1nn): hatched footprints and clearance outlines on FS-OBST /
 * FS-OBST-CLR, tags, relocated / below-obstruction sprinkler marks, the OBSTRUCTION SCHEDULE and the code note
 * (NFPA 13-2019 §10.2.7, Table 10.2.7.1.2).
 */
import type {
  ObstructionResult,
  PlacedSprinkler,
  SprinklerFloorDesign,
  SprinklerFloorInput,
  SprinklerObstruction
} from '../sprinkler/sprinklerTypes'
import { type Box, type Ctx, type Placer, type Pt, textBox } from './sheetKit'
import { hatchRectOn } from './sprinklerSheetKit'

const f0 = (v: number): string => String(Math.round(v))

/** Rule names as shown in the schedule and the report. */
export const OBST_RULE_LABEL: Record<ObstructionResult['rule'], string> = {
  beam: 'BEAM RULE',
  'three-times': 'THREE-TIMES',
  wide: 'WIDE - SPRINKLERS BELOW',
  wall: 'WALL (BAYS)'
}

const kindText = (k: string): string => k.replace(/-/g, ' ').toUpperCase()

/** Tag text of an obstruction. */
export const obstructionTag = (o: ObstructionResult): string =>
  `${o.id} ${kindText(o.kind)} - BOTTOM ${f0(o.bottomBelowCeilingMm)} MM BELOW CLG`

/** Whether the floor has any obstruction to show. */
export const hasObstructions = (fd: SprinklerFloorDesign, fi: SprinklerFloorInput): boolean =>
  fd.obstructions.length > 0 && (fi.obstructions?.length ?? 0) > 0

/** OBSTRUCTION SCHEDULE rows. */
export function obstructionScheduleRows(fd: SprinklerFloorDesign): string[][] {
  const rows: string[][] = [
    [
      'ID',
      'KIND',
      'SIZE MM',
      'BOTTOM BELOW CLG MM',
      'RULE',
      'REQ. CLEARANCE MM',
      'HEADS MOVED',
      'HEADS BELOW',
      'STATUS'
    ]
  ]
  for (const o of fd.obstructions) {
    const status =
      o.violations.length > 0
        ? 'NOT CLEARED - ADD / RELOCATE SPRINKLER'
        : o.requiredClearanceMm <= 0
          ? 'ABOVE DEFLECTOR - NONE'
          : o.rule === 'wall'
            ? 'CLEARED (BAYS)'
            : 'CLEARED'
    rows.push([
      o.id,
      kindText(o.kind),
      `${f0(o.widthMm)} x ${f0(o.lengthMm)}`,
      f0(o.bottomBelowCeilingMm),
      OBST_RULE_LABEL[o.rule],
      f0(o.requiredClearanceMm),
      String(o.relocatedHeads.length),
      String(o.headsBelow.length),
      status
    ])
  }
  return rows
}

/** Code note of the sheets that have obstructions. */
export const OBSTRUCTION_NOTE =
  'OBSTRUCTIONS TO SPRINKLER DISCHARGE (NFPA 13-2019 SEC. 10.2.7, TABLE 10.2.7.1.2): CONTINUOUS OBSTRUCTIONS (BEAMS, DUCTS, CABLE TRAYS, PIPES) FOLLOW THE BEAM RULE, DISCRETE ONES (COLUMNS, LIGHTS) THE THREE-TIMES RULE; OBSTRUCTIONS WIDER THAN 1219 MM (4 FT) NEED SPRINKLERS BELOW THEM; A BEAM DEEPER THAN THE TABLE DIVIDES THE AREA INTO BAYS (WALL). THE BEAM TABLE IS APPLIED CONSERVATIVELY BEYOND 7.5 FT SPACING AND FOR SIDEWALL SPRINKLERS. CLEARANCE ZONES ARE DASHED (LAYER FS-OBST-CLR); RELOCATED AND BELOW-OBSTRUCTION SPRINKLERS ARE MARKED. VERIFY THE CLAUSES AGAINST THE EDITION ADOPTED BY THE AHJ.'

interface BoxMm {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const bounds = (o: SprinklerObstruction): BoxMm => {
  const bb: BoxMm = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const [x, y] of o.polygon) {
    bb.minX = Math.min(bb.minX, x)
    bb.maxX = Math.max(bb.maxX, x)
    bb.minY = Math.min(bb.minY, y)
    bb.maxY = Math.max(bb.maxY, y)
  }
  return bb
}

/** Hatched footprints and dashed clearance outlines (clipped to the content box `clip`, floor mm). */
export function drawObstructionGeometry(
  c: Ctx,
  fd: SprinklerFloorDesign,
  fi: SprinklerFloorInput,
  M: (p: Pt) => Pt,
  clip: BoxMm
): void {
  const { b, sheet } = c
  const S = sheet.scale
  for (const ob of fi.obstructions ?? []) {
    const res = fd.obstructions.find((q) => q.id === ob.id)
    const bb = bounds(ob)
    if (!Number.isFinite(bb.minX)) continue
    const lo = M([bb.minX, bb.minY])
    const hi = M([bb.maxX, bb.maxY])
    b.polyline(
      'FS-OBST',
      ob.polygon.map((p) => M(p as Pt)),
      true
    )
    hatchRectOn(b, 'FS-OBST', lo[0], lo[1], hi[0] - lo[0], hi[1] - lo[1], 1.6 * S * Math.SQRT2)
    if (!res || res.requiredClearanceMm <= 0 || res.rule === 'wall') continue
    // clearance zone: the footprint grown by the required distance, edges kept inside the plan content box
    const cl = res.requiredClearanceMm
    const x0 = bb.minX - cl
    const x1 = bb.maxX + cl
    const y0 = bb.minY - cl
    const y1 = bb.maxY + cl
    const cx0 = Math.max(x0, clip.minX)
    const cx1 = Math.min(x1, clip.maxX)
    const cy0 = Math.max(y0, clip.minY)
    const cy1 = Math.min(y1, clip.maxY)
    const seg = (a: Pt, z: Pt): void => {
      const m0 = M(a)
      const m1 = M(z)
      if (Math.hypot(m1[0] - m0[0], m1[1] - m0[1]) > 1e-6)
        b.line('FS-OBST-CLR', m0[0], m0[1], m1[0], m1[1])
    }
    if (x0 >= clip.minX) seg([x0, cy0], [x0, cy1])
    if (x1 <= clip.maxX) seg([x1, cy0], [x1, cy1])
    if (y0 >= clip.minY) seg([cx0, y0], [cx1, y0])
    if (y1 <= clip.maxY) seg([cx0, y1], [cx1, y1])
  }
}

type Cand = {
  x: number
  y: number
  align: 'left' | 'center' | 'right'
  vAlign: 'bottom' | 'top' | 'middle'
  rot?: number
}

/** Text at the first free candidate (soft obstacles first, then ignoring pipes); returns true when placed. */
function placeAt(
  c: Ctx,
  P: Placer,
  text: string,
  hP: number,
  cands: Cand[],
  layer: string
): boolean {
  const S = c.sheet.scale
  for (const soft of [true, false]) {
    for (const q of cands) {
      const bx: Box = textBox(q.x, q.y, hP * S, text, q.align, q.vAlign, q.rot ?? 0)
      if (!P.free(bx, 0.3 * S, soft)) continue
      P.text(layer, q.x, q.y, hP, text, { align: q.align, vAlign: q.vAlign, rotationDeg: q.rot })
      return true
    }
  }
  return false
}

/** Obstruction tags beside the footprints (rotated along vertical obstructions). */
export function placeObstructionTags(
  c: Ctx,
  fd: SprinklerFloorDesign,
  fi: SprinklerFloorInput,
  M: (p: Pt) => Pt,
  P: Placer
): void {
  const S = c.sheet.scale
  const hP = 2.1
  for (const ob of fi.obstructions ?? []) {
    const res = fd.obstructions.find((q) => q.id === ob.id)
    if (!res) continue
    const bb = bounds(ob)
    const lo = M([bb.minX, bb.minY])
    const hi = M([bb.maxX, bb.maxY])
    const text = obstructionTag(res)
    const vertical = hi[1] - lo[1] > hi[0] - lo[0]
    const off = 0.9 * S
    const cands: Cand[] = []
    const fr = [0.5, 0.3, 0.7, 0.15, 0.85, 0.05, 0.95]
    if (vertical) {
      for (const k of fr) {
        const y = lo[1] + (hi[1] - lo[1]) * k
        cands.push({ x: hi[0] + off, y, align: 'center', vAlign: 'top', rot: 90 })
        cands.push({ x: lo[0] - off, y, align: 'center', vAlign: 'bottom', rot: 90 })
      }
    } else {
      for (const k of fr) {
        const x = lo[0] + (hi[0] - lo[0]) * k
        cands.push({ x, y: hi[1] + off, align: 'center', vAlign: 'bottom' })
        cands.push({ x, y: lo[1] - off, align: 'center', vAlign: 'top' })
      }
    }
    if (placeAt(c, P, text, hP, cands, 'FS-OBST')) continue
    const mid: Pt = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2]
    if (!P.callout(mid, [text], hP))
      P.text('FS-OBST', mid[0], mid[1], hP, text, { align: 'center', vAlign: 'middle' })
  }
}

/** Diamond markers + "RELOCATED nnn MM" / "BELOW <id>" labels of the moved and below-obstruction sprinklers. */
export function markObstructionHeads(
  c: Ctx,
  heads: PlacedSprinkler[],
  M: (p: Pt) => Pt,
  P: Placer
): void {
  const { b, sheet } = c
  const S = sheet.scale
  const hP = 1.7
  for (const h of heads) {
    const below = h.belowObstruction
    const moved = !below && h.relocatedMm !== undefined && h.relocatedMm > 0
    if (!below && !moved) continue
    const m = M([h.x, h.y])
    const q = 2.2 * S
    b.polyline(
      'FS-OBST',
      [
        [m[0] - q, m[1]],
        [m[0], m[1] - q],
        [m[0] + q, m[1]],
        [m[0], m[1] + q]
      ],
      true
    )
    const text = below ? `BELOW ${below}` : `RELOCATED ${f0(h.relocatedMm ?? 0)} MM`
    const cands: Cand[] = []
    for (const [dx, dy, al, va] of [
      [0, -3.2, 'center', 'top'],
      [0, 3.2, 'center', 'bottom'],
      [3, -1.2, 'left', 'top'],
      [-3, -1.2, 'right', 'top'],
      [3, 1.2, 'left', 'bottom'],
      [-3, 1.2, 'right', 'bottom'],
      [0, -5.2, 'center', 'top'],
      [0, 5.2, 'center', 'bottom'],
      [0, -7.2, 'center', 'top'],
      [0, 7.2, 'center', 'bottom']
    ] as [number, number, Cand['align'], Cand['vAlign']][])
      cands.push({ x: m[0] + dx * S, y: m[1] + dy * S, align: al, vAlign: va })
    if (placeAt(c, P, text, hP, cands, 'FS-OBST')) continue
    P.callout(m, [text], hP)
  }
}
