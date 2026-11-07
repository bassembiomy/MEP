/**
 * M-101 — HVAC duct layout plan: zone outlines, double-line supply / return ducts with size + airflow tags,
 * diffuser / grille symbols with tag / airflow / neck size, indoor & outdoor units with model, refrigerant line sets,
 * overall dimensions, legend, notes, north arrow and graphic scale. Every tag is placed collision-free.
 */
import type { DrawingBuilder } from '../fireProtection/drawing/drawingBuilder'
import { northArrow } from '../fireProtection/drawing/symbols'
import {
  type Box,
  type Ctx,
  Placer,
  PX,
  PY,
  dimBoxes,
  drawNotes,
  notesHeight,
  sheetTitle,
  textWidth
} from '../fireProtection/drawing/sheetKit'
import {
  type HvacModel,
  type MDuct,
  type MUnit,
  type Pt,
  type TerminalKind,
  buildModel,
  fmtTerminalKind,
  modelBBox,
  translateModel
} from './hvacModel'
import {
  flowArrow,
  indoorUnitSymbol,
  isolatorSymbol,
  outdoorUnitSymbol,
  terminalSymbol
} from './hvacSymbols'
import type { HvacInput } from './hvacTypes'

/** Plan area (paper mm) and right-hand information panel. */
export const PA = { x0: 24, y0: 16, x1: 586, y1: 545 }
export const PANEL = { x0: 592, x1: 829 }
export const PLAN_SCALES = [
  20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000
]
const MARGIN_X = 24
const MARGIN_Y = 28

/** Smallest scale denominator at which the whole layout (plus tag margin) fits the plan area. */
export function pickPlanScale(m: HvacModel): number {
  const bb = modelBBox(m)
  const w = bb.maxX - bb.minX
  const h = bb.maxY - bb.minY
  for (const s of PLAN_SCALES) {
    if (w / s + 2 * MARGIN_X <= PA.x1 - PA.x0 && h / s + 2 * MARGIN_Y <= PA.y1 - PA.y0) return s
  }
  return PLAN_SCALES[PLAN_SCALES.length - 1]
}

interface BlockLine {
  t: string
  th: number
}
interface Anchor {
  cx: number
  cy: number
  box: Box
  /** Point the leader ends at (default: edge of `box`). */
  tip?: Pt
  /** Place the block centred on (cx, cy) instead of searching around the anchor. */
  exact?: boolean
}

const inside = (poly: Pt[], x: number, y: number): boolean => {
  let r = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r
  }
  return r
}

const edgePt = (cx: number, cy: number, hw: number, hh: number, dx: number, dy: number): Pt => {
  const tx = Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity
  const ty = Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity
  const t = Math.min(tx, ty, 1)
  return [cx + dx * t, cy + dy * t]
}

const overlaps = (a: Box, b: Box): boolean =>
  a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0

class PlanDraw {
  readonly p: Placer
  readonly s: number
  readonly b: DrawingBuilder
  fallbacks = 0
  constructor(
    readonly c: Ctx,
    bounds: Box
  ) {
    this.p = new Placer(c, bounds)
    this.s = c.sheet.scale
    this.b = c.b
  }

  hard(b: Box): void {
    this.p.addHard(b)
  }
  soft(b: Box): void {
    this.p.addSoft(b)
  }
  /** Register a thick polyline as thin soft boxes. */
  softPath(pts: Pt[], half: number, hard = false): void {
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]
      const [bx, by] = pts[i]
      const len = Math.hypot(bx - ax, by - ay)
      const step = Math.max(this.s * 4, half)
      const n = Math.max(1, Math.ceil(len / step))
      const axisAligned = Math.abs(ax - bx) < 1e-6 || Math.abs(ay - by) < 1e-6
      if (axisAligned) {
        const bx0 = Math.min(ax, bx) - half
        const bx1 = Math.max(ax, bx) + half
        const by0 = Math.min(ay, by) - half
        const by1 = Math.max(ay, by) + half
        ;(hard ? this.p.hard : this.p.soft).push({ x0: bx0, y0: by0, x1: bx1, y1: by1 })
      } else {
        for (let k = 0; k <= n; k++) {
          const x = ax + ((bx - ax) * k) / n
          const y = ay + ((by - ay) * k) / n
          const r = half + step / 2
          ;(hard ? this.p.hard : this.p.soft).push({ x0: x - r, y0: y - r, x1: x + r, y1: y + r })
        }
      }
    }
  }

  private leaderClear(a: Pt, z: Pt, skip: Box[]): boolean {
    const n = 16
    for (let i = 1; i < n; i++) {
      const x = a[0] + ((z[0] - a[0]) * i) / n
      const y = a[1] + ((z[1] - a[1]) * i) / n
      const q: Box = {
        x0: x - 0.2 * this.s,
        y0: y - 0.2 * this.s,
        x1: x + 0.2 * this.s,
        y1: y + 0.2 * this.s
      }
      for (const h of this.p.hard) if (!skip.includes(h) && overlaps(q, h)) return false
    }
    return true
  }

  /**
   * Place a centred text block next to one of the anchors (closest free position, expanding gap), with a leader
   * when it is not adjacent. Returns the placed box (always draws something).
   */
  block(
    anchors: Anchor[],
    lines: BlockLine[],
    tagLayer = 'M-ANNO',
    gaps = [1, 2.2, 4, 6.5, 10, 15, 22, 32, 45, 60]
  ): Box {
    const s = this.s
    const widths = lines.map((l) => textWidth(l.th * s, l.t))
    const bw = Math.max(...widths)
    const pitches = lines.map((l) => l.th * s * 1.35)
    const bh = pitches.reduce((a, v) => a + v, 0)
    const pad = 0.4 * s
    const drawAt = (cx: number, cy: number, an: Anchor, gap: number): Box => {
      const box: Box = { x0: cx - bw / 2, y0: cy - bh / 2, x1: cx + bw / 2, y1: cy + bh / 2 }
      let y = cy + bh / 2
      lines.forEach((l, i) => {
        this.b.text(tagLayer, cx, y - pitches[i] / 2, l.th, l.t, {
          align: 'center',
          vAlign: 'middle'
        })
        y -= pitches[i]
      })
      if (gap > 1.6 * s) {
        const ahw = (an.box.x1 - an.box.x0) / 2
        const ahh = (an.box.y1 - an.box.y0) / 2
        const acx = (an.box.x0 + an.box.x1) / 2
        const acy = (an.box.y0 + an.box.y1) / 2
        const dx = cx - acx
        const dy = cy - acy
        const a0 = an.tip ?? edgePt(acx, acy, ahw, ahh, dx, dy)
        const z0 = edgePt(cx, cy, bw / 2 + 0.3 * s, bh / 2 + 0.3 * s, acx - cx, acy - cy)
        this.b.line(tagLayer, a0[0], a0[1], z0[0], z0[1])
        this.b.circle(tagLayer, a0[0], a0[1], 0.35 * s)
      }
      this.hard(box)
      return box
    }
    for (let level = 0; level < 3; level++) {
      for (const g0 of gaps) {
        const gap = g0 * s
        for (const an of anchors) {
          const { box } = an
          const acx = (box.x0 + box.x1) / 2
          const acy = (box.y0 + box.y1) / 2
          const cands: Pt[] = []
          if (an.exact) cands.push([acx, acy])
          else {
            for (const f of [0, -0.6, 0.6, -1.2, 1.2])
              cands.push([acx + f * bw, box.y0 - gap - bh / 2])
            for (const f of [0, -0.6, 0.6, -1.2, 1.2])
              cands.push([acx + f * bw, box.y1 + gap + bh / 2])
            for (const f of [0, -0.7, 0.7, -1.4, 1.4])
              cands.push([box.x1 + gap + bw / 2, acy + f * bh])
            for (const f of [0, -0.7, 0.7, -1.4, 1.4])
              cands.push([box.x0 - gap - bw / 2, acy + f * bh])
          }
          for (const [cx, cy] of cands) {
            const t: Box = { x0: cx - bw / 2, y0: cy - bh / 2, x1: cx + bw / 2, y1: cy + bh / 2 }
            if (level < 2) {
              if (!this.p.free(t, pad, level === 0)) continue
            } else if (
              t.x0 < PA_BOUNDS(this.c).x0 ||
              t.x1 > PA_BOUNDS(this.c).x1 ||
              t.y0 < PA_BOUNDS(this.c).y0 ||
              t.y1 > PA_BOUNDS(this.c).y1
            )
              continue
            if (
              gap > 1.6 * s &&
              level < 2 &&
              !this.leaderClear(
                [acx, acy],
                [cx, cy],
                [an.box, ...this.p.hard.filter((h) => overlaps(h, an.box))]
              )
            )
              continue
            if (level > 0) this.fallbacks++
            return drawAt(cx, cy, an, gap)
          }
        }
      }
    }
    // last resort: right of the first anchor
    this.fallbacks++
    const an = anchors[0]
    return drawAt(an.box.x1 + bw / 2 + s, (an.box.y0 + an.box.y1) / 2, an, 0)
  }
}

const PA_BOUNDS = (c: Ctx): Box => ({
  x0: PX(c, PA.x0 + 1),
  y0: PY(c, PA.y0 + 1),
  x1: PX(c, PA.x1 - 1),
  y1: PY(c, PA.y1 - 1)
})

const clampVisible = (v: number, minPaper: number, s: number): number => Math.max(v, minPaper * s)

/** Notes of M-101 (and the legend of used symbols). */
export function planNotes(metric: boolean): string[] {
  return [
    'All work to comply with ASHRAE 62.1 (ventilation for acceptable indoor air quality), ASHRAE 55 (thermal environmental conditions for human occupancy) and the codes adopted by the Authority Having Jurisdiction (AHJ).',
    'Ductwork to be fabricated, sealed, reinforced and supported in accordance with SMACNA HVAC Duct Construction Standards - Metal and Flexible: seal class A on all transverse joints, longitudinal seams and wall penetrations; construction class 2 in. wg positive / 1 in. wg negative unless noted otherwise.',
    metric
      ? 'Duct sizes are clear inside dimensions in mm, width x height (round: diameter). Airflow in L/s. Terminal tags read TAG / airflow / neck size. Do not change a duct size without the Engineer approval; maintain the free area when re-routing.'
      : 'Duct sizes are clear inside dimensions in inches, width x height. Airflow in CFM. Terminal tags read TAG / CFM / neck size. Do not change a duct size without the Engineer approval; maintain the free area when re-routing.',
    'Supply and return ductwork in unconditioned spaces or above ceilings shall be insulated with foil-faced fibreglass duct wrap (R-6 minimum, or as required by the energy code), vapour barrier continuous and sealed. Flexible duct connections maximum 1.5 m (5 ft) long, fully extended, no kinks.',
    'Provide a lockable volume damper at every branch take-off and at each terminal neck; fire and smoke dampers with access doors where ductwork penetrates rated assemblies (NFPA 90A / IMC 607). Provide access doors for all dampers, coils and controls.',
    'Testing, adjusting and balancing (TAB) by an independent AABC / NEBB certified agency in accordance with ASHRAE 111 and SMACNA HVAC Systems Testing, Adjusting and Balancing. Terminal airflows to be within +/- 10 % of the design values shown; submit the balancing report for approval.',
    'Outdoor air to each zone to comply with the ASHRAE 62.1 ventilation rate procedure (Rp x Pz + Ra x Az). Sound levels of terminals not to exceed the NC value of the schedule on M-601.',
    'Refrigerant line sets: ACR copper, insulated with closed-cell elastomeric insulation, brazed under nitrogen purge, pressure tested and evacuated per the manufacturer. Condensate drains pitched 1:100 to an approved point of discharge.',
    'Indoor and outdoor units, capacities and external static pressures (ESP) as per the Equipment Schedule on M-601. Provide manufacturer service clearances, vibration isolation and condensate traps.',
    'Coordinate ductwork, terminals, units and access panels with the ceiling layout, lighting, sprinklers, structure and the services of all other trades before fabrication. These drawings are diagrammatic: verify all dimensions on site.'
  ]
}

/** Draws the M-101 sheet content into `c.b` on the sheet `c.sheet`. */
export function drawPlanSheet(c: Ctx, input: HvacInput): void {
  const { b, sheet } = c
  const s = sheet.scale
  const m = buildModel(input.zones, input.project)
  const u = m.u

  // centre the layout in the plan area
  const bb0 = modelBBox(m)
  translateModel(
    m,
    PX(c, (PA.x0 + PA.x1) / 2) - (bb0.minX + bb0.maxX) / 2,
    PY(c, (PA.y0 + PA.y1) / 2) - (bb0.minY + bb0.maxY) / 2
  )
  const BB = modelBBox(m)
  const ZB = modelBBox(m, true)

  const d = new PlanDraw(c, PA_BOUNDS(c))
  const used = {
    supp: false,
    retn: false,
    arrow: false,
    refr: false,
    kinds: new Set<TerminalKind>(),
    sys: new Set<string>(),
    odu: false
  }

  // ───────── zone outlines ─────────
  for (const z of m.zones) {
    if (z.poly.length < 3) continue
    b.polyline('M-ZONE', z.poly, true)
    d.softPath([...z.poly, z.poly[0]], 0.35 * s)
  }

  // ───────── ducts (double line) ─────────
  const unitPts: Pt[] = m.units.filter((q) => q.indoor).map((q) => [q.x, q.y])
  const halfOf = (du: MDuct): number => Math.max(du.widthMm, 1.8 * s) / 2
  for (const du of m.ducts) {
    const layer = du.supply ? 'M-DUCT-SUPP' : 'M-DUCT-RETN'
    if (du.supply) used.supp = true
    else used.retn = true
    const half = halfOf(du)
    b.pipe(layer, du.pts, half * 2, false)
    // end caps / transitions
    for (const [i0, i1] of [
      [0, 1],
      [du.pts.length - 1, du.pts.length - 2]
    ]) {
      const [px, py] = du.pts[i0]
      const dx = du.pts[i1][0] - px
      const dy = du.pts[i1][1] - py
      const l = Math.hypot(dx, dy)
      const nx = -dy / l
      const ny = dx / l
      b.line(layer, px + nx * half, py + ny * half, px - nx * half, py - ny * half)
    }
    b.polyline('M-DUCT-CNTR', du.pts, false)
    d.softPath(du.pts, half)
  }

  // ───────── refrigerant line sets ─────────
  for (const r of m.refr) {
    used.refr = true
    b.polyline('M-HVAC-REFR', r.pts, false)
    d.softPath(r.pts, 0.5 * s)
    isolatorSymbol(b, r.iso[0], r.iso[1], 2.2 * s, 2)
    d.hard({
      x0: r.iso[0] - 2.6 * s,
      y0: r.iso[1] - 2.6 * s,
      x1: r.iso[0] + 2.6 * s,
      y1: r.iso[1] + 2.6 * s
    })
  }

  // ───────── terminals & units (symbols) ─────────
  const tBox = new Map<string, Box>()
  for (const t of m.terminals) {
    const w = clampVisible(t.w, 3.6, s)
    const h = clampVisible(t.h, 3.6, s)
    terminalSymbol(b, t.kind, t.x, t.y, w, h)
    used.kinds.add(t.kind)
    const box: Box = { x0: t.x - w / 2, y0: t.y - h / 2, x1: t.x + w / 2, y1: t.y + h / 2 }
    d.hard(box)
    tBox.set(`${t.zoneName}|${t.id}|${t.x}|${t.y}`, box)
  }
  const uBox = new Map<MUnit, Box>()
  for (const q of m.units) {
    const w = clampVisible(q.w, 4, s)
    const h = clampVisible(q.h, 3.2, s)
    if (q.indoor) {
      indoorUnitSymbol(b, q.sys, q.x, q.y, w, h)
      used.sys.add(q.sys)
    } else {
      outdoorUnitSymbol(b, q.x, q.y, w, h)
      used.odu = true
    }
    const box: Box = { x0: q.x - w / 2, y0: q.y - h / 2, x1: q.x + w / 2, y1: q.y + h / 2 }
    d.hard(box)
    uBox.set(q, box)
  }

  // ───────── flow arrows ─────────
  for (const du of m.ducts) {
    let best = 0
    let bi = 0
    for (let i = 1; i < du.pts.length; i++) {
      const l = Math.hypot(du.pts[i][0] - du.pts[i - 1][0], du.pts[i][1] - du.pts[i - 1][1])
      if (l > best) {
        best = l
        bi = i
      }
    }
    if (best < 16 * s) continue
    const [ax, ay] = du.pts[bi - 1]
    const [zx, zy] = du.pts[bi]
    let ux = (zx - ax) / best
    let uy = (zy - ay) / best
    // supply flows away from the unit, return flows towards it
    const near = (p: Pt): number =>
      unitPts.length ? Math.min(...unitPts.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1]))) : 0
    const startNear = near(du.pts[0]) <= near(du.pts[du.pts.length - 1])
    const forward = du.supply ? startNear : !startNear
    if (!forward) {
      ux = -ux
      uy = -uy
    }
    const alen = 3.6 * s
    for (const f of [0.28, 0.72, 0.5, 0.15, 0.85]) {
      const x = ax + (zx - ax) * f
      const y = ay + (zy - ay) * f
      const r = alen * 0.7
      const box: Box = { x0: x - r, y0: y - r, x1: x + r, y1: y + r }
      if (!d.p.free(box, 0.2 * s, false)) continue
      flowArrow(b, du.supply ? 'M-DUCT-SUPP' : 'M-DUCT-RETN', x, y, ux, uy, alen, 2 * s)
      d.hard(box)
      used.arrow = true
      break
    }
  }

  // ───────── overall dimensions ─────────
  if (m.zones.length > 0 && ZB.maxX > ZB.minX && ZB.maxY > ZB.minY) {
    const offB = -((ZB.minY - BB.minY) / s + 9)
    b.dimLinear(ZB.minX, ZB.minY, ZB.maxX, ZB.minY, offB, u.dim(ZB.maxX - ZB.minX))
    dimBoxes(s, ZB.minX, ZB.minY, ZB.maxX, ZB.minY, offB, u.dim(ZB.maxX - ZB.minX)).forEach((x) =>
      d.hard(x)
    )
    const offR = -((BB.maxX - ZB.maxX) / s + 9)
    b.dimLinear(ZB.maxX, ZB.minY, ZB.maxX, ZB.maxY, offR, u.dim(ZB.maxY - ZB.minY))
    dimBoxes(s, ZB.maxX, ZB.minY, ZB.maxX, ZB.maxY, offR, u.dim(ZB.maxY - ZB.minY)).forEach((x) =>
      d.hard(x)
    )
  }

  // ───────── duct tags: size + airflow ─────────
  const longest = (du: MDuct): { a: Pt; z: Pt; len: number } => {
    let best = { a: du.pts[0], z: du.pts[1], len: 0 }
    for (let i = 1; i < du.pts.length; i++) {
      const l = Math.hypot(du.pts[i][0] - du.pts[i - 1][0], du.pts[i][1] - du.pts[i - 1][1])
      if (l > best.len) best = { a: du.pts[i - 1], z: du.pts[i], len: l }
    }
    return best
  }
  // longest ducts first (they have the most freedom); labels of short ducts then take what is left
  const order = m.ducts.slice().sort((a, z) => longest(z).len - longest(a).len)
  for (const du of order) {
    const sg = longest(du)
    const half = halfOf(du)
    const lines: BlockLine[] = [
      { t: du.sizeLabel, th: 2.2 },
      { t: `${u.flow(du.cfm)} ${u.flowUnit}`, th: 2 }
    ]
    const bw = Math.max(textWidth(2.2 * s, du.sizeLabel), textWidth(2 * s, lines[1].t))
    const anchors: Anchor[] = []
    // along the segment, margin so the label stays on the duct
    const fr = [0.5, 0.35, 0.65, 0.22, 0.78, 0.12, 0.88]
    const horizontal = Math.abs(sg.z[0] - sg.a[0]) >= Math.abs(sg.z[1] - sg.a[1])
    for (const f of fr) {
      if (sg.len * Math.min(f, 1 - f) < (horizontal ? bw * 0.5 : 0)) continue
      const x = sg.a[0] + (sg.z[0] - sg.a[0]) * f
      const y = sg.a[1] + (sg.z[1] - sg.a[1]) * f
      const hx = horizontal ? 0.8 * s : half
      const hy = horizontal ? half : 0.8 * s
      anchors.push({
        cx: x,
        cy: y,
        box: { x0: x - hx, y0: y - hy, x1: x + hx, y1: y + hy },
        tip: [x, y]
      })
    }
    if (anchors.length === 0) {
      const x = (sg.a[0] + sg.z[0]) / 2
      const y = (sg.a[1] + sg.z[1]) / 2
      anchors.push({
        cx: x,
        cy: y,
        box: { x0: x - half, y0: y - half, x1: x + half, y1: y + half },
        tip: [x, y]
      })
    }
    d.block(anchors, lines, 'M-ANNO', [0.6, 1.4, 2.5, 4, 6.5, 10, 15, 22, 32])
  }

  // ───────── terminal tags: TAG / airflow / neck size ─────────
  for (const t of m.terminals) {
    const box = tBox.get(`${t.zoneName}|${t.id}|${t.x}|${t.y}`) as Box
    d.block(
      [{ cx: t.x, cy: t.y, box }],
      [
        { t: t.id, th: 2.4 },
        { t: `${u.flow(t.cfm)} ${u.flowUnit}`, th: 2 },
        { t: t.sizeLabel, th: 2 }
      ]
    )
  }

  // ───────── unit tags: TAG / model / ESP / airflow ─────────
  for (const q of m.units) {
    const box = uBox.get(q) as Box
    const lines: BlockLine[] = [
      { t: q.tag, th: 2.4 },
      { t: q.model, th: 2.2 }
    ]
    if (q.indoor) {
      if (q.esp) lines.push({ t: `ESP ${q.esp}`, th: 2 })
      if (q.cfm > 0) lines.push({ t: `${u.flow(q.cfm)} ${u.flowUnit}`, th: 2 })
    } else {
      lines[1] = { t: 'OUTDOOR UNIT', th: 2.2 }
      const z = m.zones.find((zz) => zz.outdoorTags.includes(q.tag))
      if (z) lines.push({ t: `FOR ${z.name}`.slice(0, 30), th: 2 })
    }
    d.block([{ cx: q.x, cy: q.y, box }], lines)
  }

  // ───────── zone names / airflow / area (largest free spot, top-left first) ─────────
  for (const z of m.zones) {
    if (z.poly.length < 3) continue
    const full: BlockLine[] = [
      { t: z.name, th: 3.2 },
      {
        t: `SA ${u.flow(z.supplyCfm)} / RA ${u.flow(z.returnCfm)} ${u.flowUnit}${z.exhaustCfm > 0 ? ` / EA ${u.flow(z.exhaustCfm)}` : ''}`,
        th: 2.2
      },
      { t: `${u.floorArea(z.areaDu2).toFixed(0)} ${u.areaUnit} - ${z.sysLabel}`, th: 2.2 }
    ]
    const variants: BlockLine[][] = [full, [full[0], full[1]], [full[0]]]
    const xs = z.poly.map((p) => p[0])
    const ys = z.poly.map((p) => p[1])
    const x0 = Math.min(...xs)
    const x1 = Math.max(...xs)
    const y0 = Math.min(...ys)
    const y1 = Math.max(...ys)
    let placed = false
    for (const lines of variants) {
      const bw = Math.max(...lines.map((l) => textWidth(l.th * s, l.t)))
      const bh = lines.reduce((a, l) => a + l.th * s * 1.35, 0)
      const step = 2.5 * s
      for (let y = y1 - 3 * s - bh / 2; y >= y0 + bh / 2 && !placed; y -= step) {
        for (let x = x0 + 3 * s + bw / 2; x <= x1 - bw / 2 && !placed; x += step) {
          const box: Box = { x0: x - bw / 2, y0: y - bh / 2, x1: x + bw / 2, y1: y + bh / 2 }
          const corners: Pt[] = [
            [box.x0, box.y0],
            [box.x1, box.y0],
            [box.x0, box.y1],
            [box.x1, box.y1]
          ]
          if (!corners.every((p) => inside(z.poly, p[0], p[1]))) continue
          if (!d.p.free(box, 0.6 * s, true)) continue
          d.block(
            [{ cx: x, cy: y, box: { x0: x, y0: y, x1: x, y1: y }, exact: true }],
            lines,
            'M-ANNO',
            [0]
          )
          placed = true
        }
      }
      if (placed) break
    }
    if (!placed) {
      const cx = (x0 + x1) / 2
      d.block([{ cx, cy: y1, box: { x0: cx - 1, y0: y1, x1: cx + 1, y1: y1 + 1 } }], variants[2])
    }
  }

  // ───────── sheet title ─────────
  sheetTitle(
    c,
    PA.x0 + 2,
    566,
    'HVAC DUCT LAYOUT PLAN',
    `SCALE 1:${s} - SUPPLY / RETURN DUCTWORK, TERMINALS AND EQUIPMENT`
  )

  // ───────── right-hand panel: north arrow, graphic scale, legend, notes ─────────
  let yTop = 545
  northArrow(b, PX(c, PANEL.x0 + 14), PY(c, yTop - 18))
  drawScaleBar(c, PANEL.x0 + 36, yTop - 14, input.project.units === 'metric', s)
  yTop -= 40
  yTop -= drawLegend(c, PANEL.x0, yTop, PANEL.x1 - PANEL.x0, used, m) + 5
  const notes = planNotes(u.metric)
  let th = 2.3
  const avail = yTop - 78
  while (th > 1.8 && notesHeight(PANEL.x0, PANEL.x1 - PANEL.x0, notes, th) > avail) th -= 0.1
  drawNotes(c, PANEL.x0, yTop, PANEL.x1 - PANEL.x0, 'GENERAL NOTES', notes, th)
}

function drawScaleBar(c: Ctx, xP: number, yP: number, metric: boolean, s: number): void {
  const { b } = c
  const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000]
  const mmPer = metric ? 1000 : 304.8
  let total = nice[0]
  for (const n of nice) if ((n * mmPer) / s <= 120) total = n
  const lenP = (total * mmPer) / s
  const X = (v: number): number => PX(c, v)
  const Y = (v: number): number => PY(c, v)
  b.text('M-ANNO', X(xP), Y(yP + 8), 2.6, `GRAPHIC SCALE  1:${s}`, { vAlign: 'middle' })
  const n = 4
  for (let i = 0; i < n; i++) {
    const x0 = xP + (lenP * i) / n
    const x1 = xP + (lenP * (i + 1)) / n
    b.rect('M-ANNO', X(x0), Y(yP), (x1 - x0) * s, 2 * s)
    if (i % 2 === 0)
      b.solid('M-ANNO', [
        [X(x0), Y(yP)],
        [X(x1), Y(yP)],
        [X(x1), Y(yP + 2)],
        [X(x0), Y(yP + 2)]
      ])
  }
  const fmt = (v: number): string =>
    Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : v.toFixed(2).replace(/0+$/, '')
  for (let i = 0; i <= n; i++) {
    b.text(
      'M-ANNO',
      X(xP + (lenP * i) / n),
      Y(yP - 1.2),
      2,
      fmt((total * i) / n) + (i === n ? (metric ? ' m' : ' ft') : ''),
      { align: 'center', vAlign: 'top' }
    )
  }
}

function drawLegend(
  c: Ctx,
  xP: number,
  yTopP: number,
  w: number,
  used: {
    supp: boolean
    retn: boolean
    arrow: boolean
    refr: boolean
    kinds: Set<TerminalKind>
    sys: Set<string>
    odu: boolean
  },
  m: HvacModel
): number {
  const { b, sheet } = c
  const s = sheet.scale
  const X = (v: number): number => PX(c, v)
  const Y = (v: number): number => PY(c, v)
  const items: { label: string; draw: (x: number, y: number) => void }[] = []
  const sw = 14 * s
  if (used.supp)
    items.push({
      label: 'SUPPLY AIR DUCT (SIZE / AIRFLOW TAG)',
      draw: (x, y) => {
        b.pipe(
          'M-DUCT-SUPP',
          [
            [x - sw / 2, y],
            [x + sw / 2, y]
          ],
          4.2 * s,
          false
        )
        b.line('M-DUCT-CNTR', x - sw / 2, y, x + sw / 2, y)
      }
    })
  if (used.retn)
    items.push({
      label: 'RETURN AIR DUCT (SIZE / AIRFLOW TAG)',
      draw: (x, y) => {
        b.pipe(
          'M-DUCT-RETN',
          [
            [x - sw / 2, y],
            [x + sw / 2, y]
          ],
          4.2 * s,
          false
        )
        b.line('M-DUCT-CNTR', x - sw / 2, y, x + sw / 2, y)
      }
    })
  if (used.arrow)
    items.push({
      label: 'DIRECTION OF AIR FLOW',
      draw: (x, y) => flowArrow(b, 'M-DUCT-SUPP', x, y, 1, 0, 6 * s, 3 * s)
    })
  ;(['supply', 'cassette', 'return', 'exhaust', 'high-wall'] as TerminalKind[]).forEach((k) => {
    if (used.kinds.has(k))
      items.push({
        label: `${fmtTerminalKind(k)} (TAG / AIRFLOW / NECK)`,
        draw: (x, y) => terminalSymbol(b, k, x, y, 6 * s, k === 'return' ? 4 * s : 6 * s)
      })
  })
  const sysLabels: Record<string, string> = {
    concealed: 'DUCTED SPLIT / FAN COIL UNIT',
    fcu: 'DUCTED SPLIT / FAN COIL UNIT',
    vrf: 'DUCTED SPLIT / FAN COIL UNIT',
    cassette: 'CEILING CASSETTE UNIT',
    'high-wall': 'HIGH WALL SPLIT UNIT',
    packaged: 'PACKAGED / AIR HANDLING UNIT',
    ahu: 'PACKAGED / AIR HANDLING UNIT'
  }
  const seen = new Set<string>()
  for (const k of used.sys) {
    const label = sysLabels[k] ?? 'INDOOR UNIT'
    if (seen.has(label)) continue
    seen.add(label)
    items.push({
      label: `${label} (TAG / MODEL)`,
      draw: (x, y) =>
        indoorUnitSymbol(
          b,
          k as never,
          x,
          y,
          k === 'high-wall' ? 9 * s : 9 * s,
          k === 'high-wall' ? 3 * s : k === 'cassette' ? 9 * s : 5 * s
        )
    })
  }
  if (used.odu)
    items.push({
      label: 'OUTDOOR (CONDENSING) UNIT',
      draw: (x, y) => outdoorUnitSymbol(b, x, y, 10 * s, 5 * s)
    })
  if (used.refr)
    items.push({
      label: 'REFRIGERANT LINE SET WITH ISOLATOR (R)',
      draw: (x, y) => {
        b.line('M-HVAC-REFR', x - sw / 2, y, x - 2.5 * s, y)
        isolatorSymbol(b, x, y, 2.2 * s, 2)
        b.line('M-HVAC-REFR', x + 2.5 * s, y, x + sw / 2, y)
      }
    })
  items.push({
    label: 'ZONE BOUNDARY',
    draw: (x, y) => b.rect('M-ZONE', x - 6 * s, y - 2.5 * s, 12 * s, 5 * s)
  })
  void m

  const colW = w / 2
  const rowH = 8.2
  const rows = Math.ceil(items.length / 2)
  const h = 9 + rows * rowH + 1.5
  b.rect('M-LEGEND', X(xP), Y(yTopP - h), w * s, h * s)
  b.text('M-ANNO', X(xP + 3), Y(yTopP - 4.5), 3.4, 'LEGEND', { vAlign: 'middle' })
  b.line('M-LEGEND', X(xP), Y(yTopP - 9), X(xP + w), Y(yTopP - 9))
  const th = 2
  items.forEach((it, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x0 = xP + col * colW
    const y = yTopP - 9 - rowH * (row + 0.5)
    it.draw(X(x0 + 11), Y(y))
    // wrap long labels in two lines
    const maxChars = Math.floor((colW - 22) / (0.78 * th))
    const words = it.label.split(' ')
    const lines: string[] = []
    let cur = ''
    for (const wd of words) {
      if (cur && (cur + ' ' + wd).length > maxChars) {
        lines.push(cur)
        cur = wd
      } else cur = cur ? cur + ' ' + wd : wd
    }
    lines.push(cur)
    lines.forEach((ln, li) =>
      b.text('M-ANNO', X(x0 + 21), Y(y + ((lines.length - 1) / 2 - li) * th * 1.35), th, ln, {
        vAlign: 'middle'
      })
    )
  })
  return h
}
