/**
 * FS-601 … FS-60n — sprinkler hydraulic calculation sheets, one per floor zone: node-to-node worksheet of the zone's
 * governing remote area, summary block, N^1.85 supply / demand graph and (on the first sheet) the bill of materials.
 */
import type {
  RemoteAreaResult,
  SprinklerFloorDesign,
  SprinklerZoneResult
} from '../sprinkler/sprinklerTypes'
import {
  type Ctx,
  CW,
  FRAME,
  PX,
  PY,
  autoCols,
  drawTable,
  measureTable,
  wrapText
} from './sheetKit'
import { HAZARD_LABEL, SYSTEM_LABEL, sizeLabel } from './sprinklerSheetKit'
import { buildHydraulicGraph, graphX, maxVelocityFps } from './sprinklerHydraulicGraph'

const f = (v: number, d = 1): string => v.toFixed(d)

/** Which zone sheet to draw. */
export interface ZoneSheetRef {
  floorIndex: number
  zoneIndex: number
  /** The bill of materials stays on the first sheet. */
  withBom: boolean
}

/** Zone sheets in floor order, then zone order. */
export function hydraulicSheetRefs(floors: SprinklerFloorDesign[]): ZoneSheetRef[] {
  const out: ZoneSheetRef[] = []
  floors.forEach((fl, floorIndex) =>
    fl.zones.forEach((_, zoneIndex) =>
      out.push({ floorIndex, zoneIndex, withBom: out.length === 0 })
    )
  )
  return out
}

/** Columns of the node-to-node worksheet: every header line is its own text entity. */
export const HYDRAULIC_HEADER = [
  'FROM',
  'TO',
  'DESCRIPTION',
  'K',
  'q\nADD GPM',
  'Q\nTOT GPM',
  'SIZE',
  'ID\nIN',
  'C',
  'L\nFT',
  'FITTINGS',
  'EQ\nFT',
  'LTOT\nFT',
  'PF/FT\nPSI',
  'PF\nPSI',
  'PE\nPSI',
  'PT\nSTART',
  'PT\nEND',
  'V\nFPS'
]

function worksheetRow(row: RemoteAreaResult['rows'][number]): string[] {
  return [
    row.fromNode,
    row.toNode,
    wrapText(row.description, 30).join('\n'),
    row.kFactor ? f(row.kFactor) : '-',
    f(row.flowAddedGpm),
    f(row.totalFlowGpm),
    sizeLabel(row.nominalIn),
    f(row.idIn, 3),
    String(row.c),
    f(row.lengthFt),
    row.fittingsDesc || '-',
    f(row.fittingsEqFt, 0),
    f(row.totalLengthFt),
    f(row.pfPerFt, 4),
    f(row.pfPsi, 2),
    f(row.pePsi, 2),
    f(row.ptStartPsi, 2),
    f(row.ptEndPsi, 2),
    f(row.velocityFps)
  ]
}

const rowHeight = (row: string[], th: number): number =>
  Math.max(1, ...row.map((cell) => cell.split('\n').length)) * th * 1.3 + 2.8

/** Rows split into chunks no taller than availH (each chunk repeats the header). */
function chunkRows(header: string[], body: string[][], th: number, availH: number): string[][][] {
  const out: string[][][] = []
  let cur: string[][] = [header]
  let h = rowHeight(header, th) + th * 2.6
  for (const row of body) {
    const rh = rowHeight(row, th)
    if (h + rh > availH && cur.length > 1) {
      out.push(cur)
      cur = [header]
      h = rowHeight(header, th) + th * 2.6
    }
    cur.push(row)
    h += rh
  }
  out.push(cur)
  return out
}

/** Largest text height (≤ th0) for which the chunks fit side by side in maxW; returns the chunks. */
function fitChunks(
  header: string[],
  body: string[][],
  th0: number,
  thMin: number,
  availH: number,
  maxW: number
): { th: number; chunks: string[][][] } {
  let th = th0
  for (;;) {
    const chunks = chunkRows(header, body, th, availH)
    const total =
      chunks.reduce((a, ch) => a + measureTable(autoCols(ch, th), ch, { th }).w, 0) +
      (chunks.length - 1) * 4
    if (total <= maxW || th <= thMin) return { th, chunks }
    th -= 0.1
  }
}

export function drawHydraulicSheet(c: Ctx, ref: ZoneSheetRef): void {
  const { b, sheet, r } = c
  const S = sheet.scale
  const spr = r.sprinklers!
  const fl = spr.floors[ref.floorIndex]
  const zone: SprinklerZoneResult = fl.zones[ref.zoneIndex]
  const g = zone.governing
  const X = (v: number): number => PX(c, v)
  const Y = (v: number): number => PY(c, v)
  const T = (
    x: number,
    y: number,
    h: number,
    s: string,
    o: {
      align?: 'left' | 'center' | 'right'
      vAlign?: 'baseline' | 'bottom' | 'top' | 'middle'
      rot?: number
    } = {},
    layer = 'FS-ANNO'
  ): void =>
    b.text(layer, X(x), Y(y), h, s, {
      align: o.align ?? 'left',
      vAlign: o.vAlign ?? 'middle',
      rotationDeg: o.rot
    })

  const floorGoverning = !!g && fl.governing === g
  const buildingGoverning = !!g && spr.governing === g

  // ───────── title and marker ─────────
  const title = `HYDRAULIC CALCULATION - ${fl.floorName.toUpperCase()} ZONE ${zone.zoneId} - ${zone.name.toUpperCase()}`
  T(
    Math.max(26 + (CW * 4.4 * title.length) / 2, FRAME.x0 + 2 + 0.6 * 4.4 * title.length),
    573,
    4.4,
    title,
    {
      align: 'center'
    }
  )
  T(
    26,
    565.5,
    2.6,
    g
      ? `NODE-TO-NODE WORKSHEET OF THE REMOTE AREA OF THIS ZONE - HAZEN-WILLIAMS, NFPA 13-2019 SEC. 28.2 - ${SYSTEM_LABEL[fl.systemType]} SYSTEM - ${zone.controlValveTag}`
      : 'NO REMOTE AREA CALCULATED FOR THIS ZONE (NO SPRINKLERS)'
  )
  if (floorGoverning) {
    const bx = 604
    const by = 560
    b.rect('FS-ANNO', X(bx), Y(by), 120 * S, 20 * S)
    T(bx + 60, by + 14, 3.6, 'GOVERNING ZONE', { align: 'center' })
    T(
      bx + 60,
      by + 6.5,
      2.1,
      buildingGoverning
        ? `OF ${fl.floorName.toUpperCase()} AND OF THE BUILDING`
        : `OF ${fl.floorName.toUpperCase()}`,
      { align: 'center' }
    )
  }

  // ───────── bill of materials (first sheet), bottom left ─────────
  const leftW = 566
  const yTop = 552
  const yBottom = 16
  let bomH = 0
  const bomRows: string[][] = [['ITEM', 'SIZE', 'QTY', 'UNIT']]
  if (ref.withBom) {
    for (const l of spr.bom)
      bomRows.push([
        wrapText(l.item, 46).join('\n'),
        l.size,
        l.unit === 'm' ? f(l.qty) : String(l.qty),
        l.unit
      ])
    const half = Math.ceil((bomRows.length - 1) / 2)
    const parts = [bomRows.slice(1, 1 + half), bomRows.slice(1 + half)].filter((p) => p.length > 0)
    let bth = 2.0
    const tallest = (t: number): number =>
      Math.max(
        ...parts.map(
          (p) =>
            measureTable(autoCols([bomRows[0], ...p], t), [bomRows[0], ...p], { th: t, title: 'x' })
              .h
        )
      )
    const widest = (t: number): number =>
      parts.reduce(
        (a, p) =>
          a + measureTable(autoCols([bomRows[0], ...p], t), [bomRows[0], ...p], { th: t }).w,
        0
      ) +
      (parts.length - 1) * 4
    while (bth > 1.3 && (tallest(bth) > 120 || widest(bth) > leftW)) bth -= 0.1
    bomH = tallest(bth)
    let bx = 26
    parts.forEach((p, i) => {
      const rows = [bomRows[0], ...p]
      const size = drawTable(c, bx, yBottom + bomH, autoCols(rows, bth), rows, {
        th: bth,
        title: i === 0 ? 'BILL OF MATERIALS' : 'BILL OF MATERIALS (CONT.)',
        alignRight: [false, false, true, false]
      })
      bx += size.w + 4
    })
  }

  // ───────── node-to-node worksheet ─────────
  const body = (g?.rows ?? []).map(worksheetRow)
  if (g) {
    const availH = yTop - yBottom - (bomH > 0 ? bomH + 8 : 0)
    const { th, chunks } = fitChunks(HYDRAULIC_HEADER, body, 2.8, 1.4, availH, leftW)
    const align = HYDRAULIC_HEADER.map((_, i) => i >= 3 && i !== 6 && i !== 10)
    let xx = 26
    chunks.forEach((ch, i) => {
      const size = drawTable(c, xx, yTop, autoCols(ch, th), ch, {
        th,
        title: i === 0 ? 'NODE-TO-NODE CALCULATION' : 'NODE-TO-NODE CALCULATION (CONT.)',
        alignRight: align
      })
      xx += size.w + 4
    })
  }

  // ───────── right column: summary ─────────
  const colX = 604
  const colW = FRAME.x1 - 4 - colX
  const yy = yTop
  let sumH = 0
  if (g) {
    const vmax = maxVelocityFps(g)
    const kv: string[][] = [
      ['ZONE', `${zone.zoneId} ${zone.name.toUpperCase()}`],
      ['HAZARD', `${HAZARD_LABEL[g.hazard] ?? g.hazard}`],
      [
        'DENSITY / AREA',
        `${f(g.densityGpmFt2, 2)} GPM/FT2 OVER ${f(g.designAreaFt2, 0)} FT2 (BASE ${f(g.baseAreaFt2, 0)})`
      ],
      ['HEADS FLOWING', String(g.headsFlowing.length)],
      ['REMOTE HEAD', `${f(g.minHeadFlowGpm)} GPM @ ${f(g.remoteHeadPressurePsi)} PSI`],
      ['AT ZCV', `${f(g.flowAtFloorGpm)} GPM @ ${f(g.pressureAtFloorPsi)} PSI`],
      ['AT SOURCE', `${f(g.flowAtSourceGpm)} GPM @ ${f(g.pressureAtSourcePsi)} PSI`],
      ['HOSE ALLOWANCE', `${f(g.hoseAllowanceGpm, 0)} GPM`],
      ['TOTAL DEMAND', `${f(g.totalDemandGpm)} GPM`],
      ['SUPPLY AVAILABLE', `${f(g.availablePsi)} PSI @ ${f(g.totalDemandGpm)} GPM`],
      ['MARGIN', `${f(g.marginPsi)} PSI ${g.marginPsi >= 0 ? '(ADEQUATE)' : '(INADEQUATE)'}`],
      ['MAX VELOCITY', `${f(vmax)} FT/S (CRITERION 20 FT/S)`]
    ]
    let th = 2.2
    let cols = autoCols(kv, th)
    while (th > 1.5 && measureTable(cols, kv, { th, title: 'x' }).w > colW) {
      th -= 0.1
      cols = autoCols(kv, th)
    }
    sumH = drawTable(c, colX, yy, cols, kv, {
      th,
      title: 'SUMMARY OF THE REMOTE AREA',
      header: false
    }).h
  }

  // ───────── N^1.85 graph ─────────
  const model = g ? buildHydraulicGraph(r, zone) : null
  if (g && model) {
    const gx0 = colX + 20
    const gx1 = FRAME.x1 - 8
    const gy1 = yy - sumH - 14
    const gy0 = gy1 - 240
    const GX = (q: number): number => gx0 + (gx1 - gx0) * graphX(q, model.qMax)
    const GY = (p: number): number => gy0 + ((gy1 - gy0) * p) / model.pMax
    T(colX, gy1 + 7, 3, 'SUPPLY vs DEMAND - N^1.85 HYDRAULIC GRAPH')
    b.rect('FS-LEGEND', X(gx0), Y(gy0), (gx1 - gx0) * S, (gy1 - gy0) * S)
    for (const t of model.xTicks) {
      const x = gx0 + (gx1 - gx0) * t.pos
      if (t.pos > 0 && t.pos < 1) b.line('FS-LEGEND', X(x), Y(gy0), X(x), Y(gy1))
      if (t.showLabel) T(x, gy0 - 2.6, 2, t.label, { align: 'center' })
    }
    for (const t of model.yTicks) {
      const y = gy0 + (gy1 - gy0) * t.pos
      if (t.pos > 0 && t.pos < 1) b.line('FS-LEGEND', X(gx0), Y(y), X(gx1), Y(y))
      T(gx0 - 1.5, y, 2, t.label, { align: 'right' })
    }
    T((gx0 + gx1) / 2, gy0 - 7.5, 2.3, 'FLOW Q (GPM) - SCALE Q^1.85', { align: 'center' })
    T(gx0 - 11, (gy0 + gy1) / 2, 2.3, 'PRESSURE (PSI)', { align: 'center', rot: 90 })
    // supply curve, in the transformed space (one segment per point pair)
    b.polyline(
      'FS-GRAPH',
      model.supply.map(([q, p]) => [X(GX(q)), Y(GY(p))] as [number, number]),
      false
    )
    const mark = (q: number, p: number, kind: 'demand' | 'supply'): void => {
      const mx = X(GX(q))
      const my = Y(GY(p))
      if (kind === 'demand') {
        b.circle('FS-REMOTE', mx, my, 1.3 * S)
        b.line('FS-REMOTE', mx - 1.9 * S, my, mx + 1.9 * S, my)
        b.line('FS-REMOTE', mx, my - 1.9 * S, mx, my + 1.9 * S)
      } else {
        b.polyline(
          'FS-GRAPH',
          [
            [mx - 1.3 * S, my - 1.3 * S],
            [mx + 1.3 * S, my - 1.3 * S],
            [mx + 1.3 * S, my + 1.3 * S],
            [mx - 1.3 * S, my + 1.3 * S]
          ],
          true
        )
      }
    }
    const [qa, pa] = model.demand
    const [qb, pb] = model.demandHose
    const [qc, pc] = model.supplyAtDemand
    // projection lines to the flow axis, connector A-B and the margin B-C
    b.polyline(
      'FS-HIDN',
      [
        [X(GX(qa)), Y(gy0)],
        [X(GX(qa)), Y(GY(pa))]
      ],
      false
    )
    b.polyline(
      'FS-HIDN',
      [
        [X(GX(qb)), Y(gy0)],
        [X(GX(qb)), Y(GY(Math.max(pc, pb)))]
      ],
      false
    )
    if (qb > qa + 1e-6)
      b.polyline(
        'FS-REMOTE',
        [
          [X(GX(qa)), Y(GY(pa))],
          [X(GX(qb)), Y(GY(pb))]
        ],
        false
      )
    if (Math.abs(pc - pb) > 1e-6) {
      b.polyline(
        'FS-ANNO',
        [
          [X(GX(qb)) + 2.2 * S, Y(GY(pb))],
          [X(GX(qb)) + 2.2 * S, Y(GY(pc))]
        ],
        false
      )
      b.line('FS-ANNO', X(GX(qb)) + 0.9 * S, Y(GY(pb)), X(GX(qb)) + 3.5 * S, Y(GY(pb)))
      b.line('FS-ANNO', X(GX(qb)) + 0.9 * S, Y(GY(pc)), X(GX(qb)) + 3.5 * S, Y(GY(pc)))
      T(GX(qb) + 4.6, (GY(pb) + GY(pc)) / 2, 2, `${f(model.marginPsi)} PSI`, { align: 'left' })
    }
    mark(qa, pa, 'demand')
    mark(qb, pb, 'demand')
    mark(qc, pc, 'supply')
    T(GX(qa) - 1.6, GY(pa) - 3.2, 2.2, 'A', { align: 'right' })
    T(GX(qb) + 0.8, GY(pb) - 3.2, 2.2, 'B', { align: 'left' })
    T(GX(qc) - 2, GY(pc) + 3, 2.2, 'C', { align: 'right' })

    // legend under the graph
    let ly = gy0 - 14
    const line = (txt: string, draw?: () => void): void => {
      draw?.()
      T(gx0 + 10, ly, 2, txt)
      ly -= 4.4
    }
    line(`SUPPLY CURVE - ${model.supplyLabel.toUpperCase()}`, () =>
      b.line('FS-GRAPH', X(gx0), Y(ly), X(gx0 + 8), Y(ly))
    )
    line(`A  SPRINKLER DEMAND (WITHOUT HOSE) ${f(qa)} GPM @ ${f(pa)} PSI AT THE SOURCE`, () => {
      b.circle('FS-REMOTE', X(gx0 + 4), Y(ly), 1.2 * S)
      b.line('FS-REMOTE', X(gx0 + 1.8), Y(ly), X(gx0 + 6.2), Y(ly))
    })
    line(
      `B  DEMAND INCL. HOSE ALLOWANCE ${f(g.hoseAllowanceGpm, 0)} GPM: ${f(qb)} GPM @ ${f(pb)} PSI`
    )
    line(`C  SUPPLY AT B: ${f(pc)} PSI`)
    line(
      `MARGIN C - B = ${f(model.marginPsi)} PSI ${model.adequate ? '(ADEQUATE)' : '(INADEQUATE)'}; X AXIS = Q^1.85, GRIDLINES IN GPM`
    )
  }
}
