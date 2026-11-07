/**
 * FS-601 — sprinkler hydraulic calculations: governing node-to-node table, remote area summary per floor,
 * supply vs demand graph and bill of materials.
 */
import type { RemoteAreaResult } from '../sprinkler/sprinklerTypes'
import { type Ctx, FRAME, PX, PY, autoCols, drawTable, measureTable, wrapText } from './sheetKit'
import { HAZARD_LABEL, SYSTEM_LABEL, sizeLabel } from './sprinklerSheetKit'

const f = (v: number, d = 1): string => v.toFixed(d)

/** Shrink the text height until the table (columns fitted to content) is not wider than maxW. */
function fit(
  rows: string[][],
  th0: number,
  maxW: number,
  title?: string,
  thMin = 1.4
): { th: number; cols: number[] } {
  let th = th0
  let cols = autoCols(rows, th)
  while (th > thMin && measureTable(cols, rows, { th, title }).w > maxW) {
    th -= 0.1
    cols = autoCols(rows, th)
  }
  return { th, cols }
}

export function drawHydraulicSheet(c: Ctx): void {
  const { b, sheet, r } = c
  const S = sheet.scale
  const spr = r.sprinklers!
  const gov = spr.governing
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

  // ───────── governing node table ─────────
  const govFloor = gov ? spr.floors.find((x) => x.floorId === gov.floorId) : undefined
  const header = [
    'FROM',
    'TO',
    'DESCRIPTION',
    'K',
    'q gpm',
    'Q gpm',
    'SIZE',
    'ID in',
    'C',
    'L ft',
    'FITTINGS',
    'Feq ft',
    'Ltot ft',
    'Pf/ft',
    'Pf psi',
    'Pe psi',
    'Pt start',
    'Pt end',
    'v fps'
  ]
  const body: string[][] = (gov?.rows ?? []).map((row) => [
    row.fromNode,
    row.toNode,
    wrapText(row.description, 38).join('\n'),
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
  ])
  const align = header.map((_, i) => i >= 3 && i !== 6 && i !== 10)
  const leftW = 540
  const yTop = 575
  T(
    24 + 2,
    572,
    3.5,
    gov
      ? `HYDRAULIC CALCULATION - GOVERNING REMOTE AREA: ${govFloor?.floorName.toUpperCase() ?? gov.floorId} (NODE TO NODE, HAZEN-WILLIAMS, NFPA 13-2019 SEC. 28.2)`
      : 'HYDRAULIC CALCULATION - NO REMOTE AREA'
  )
  const yy = 563
  const summaryRows: string[][] = [
    [
      'FLOOR',
      'SYSTEM',
      'HAZARD',
      'DENSITY GPM/FT2',
      'AREA FT2',
      'HEADS',
      'Q @ FC GPM',
      'P @ FC PSI',
      'Q @ SRC GPM',
      'P @ SRC PSI',
      'HOSE GPM',
      'AVAIL PSI',
      'MARGIN PSI'
    ]
  ]
  for (const fl of spr.floors) {
    const g: RemoteAreaResult | null = fl.governing
    if (!g) continue
    summaryRows.push([
      fl.floorName.toUpperCase(),
      SYSTEM_LABEL[fl.systemType],
      HAZARD_LABEL[g.hazard] ?? g.hazard,
      f(g.densityGpmFt2, 2),
      f(g.designAreaFt2, 0),
      String(g.headsFlowing.length),
      f(g.flowAtFloorGpm),
      f(g.pressureAtFloorPsi),
      f(g.flowAtSourceGpm),
      f(g.pressureAtSourcePsi),
      f(g.hoseAllowanceGpm, 0),
      f(g.availablePsi),
      f(g.marginPsi)
    ])
  }
  const sumFit = fit(summaryRows, 2.3, leftW + 270, 'REMOTE AREA SUMMARY PER FLOOR')
  const sumH = measureTable(sumFit.cols, summaryRows, { th: sumFit.th, title: 'x' }).h

  // node table chunks, each as tall as the space left of the summary allows
  const availH = yy - 14 - sumH - 8
  const allRows = [header, ...body]
  const rowH = (row: string[], th: number): number =>
    Math.max(1, ...row.map((cell) => cell.split('\n').length)) * th * 1.3 + 2.8
  let th = 2.2
  let chunks: string[][][] = []
  const chunkRows = (t: number): string[][][] => {
    const out: string[][][] = []
    let cur: string[][] = [header]
    let h = rowH(header, t) + t * 2.6
    for (const row of body) {
      const rh = rowH(row, t)
      if (h + rh > availH && cur.length > 1) {
        out.push(cur)
        cur = [header]
        h = rowH(header, t) + t * 2.6
      }
      cur.push(row)
      h += rh
    }
    out.push(cur)
    return out
  }
  for (;;) {
    chunks = chunkRows(th)
    const widths = chunks.map((ch) => measureTable(autoCols(ch, th), ch, { th }).w)
    const total = widths.reduce((a, v) => a + v, 0) + (chunks.length - 1) * 4
    if (total <= leftW + 270 || th <= 1.4) break
    th -= 0.1
  }
  void allRows
  let xx = 24 + 2
  let maxBottom = yy
  chunks.forEach((ch, i) => {
    const cols = autoCols(ch, th)
    const size = drawTable(c, xx, yy, cols, ch, {
      th,
      title: i === 0 ? 'NODE-TO-NODE CALCULATION' : 'NODE-TO-NODE CALCULATION (CONT.)',
      alignRight: align
    })
    xx += size.w + 4
    maxBottom = Math.min(maxBottom, yy - size.h)
  })
  const tableRight = xx - 4
  drawTable(c, 24 + 2, maxBottom - 8, sumFit.cols, summaryRows, {
    th: sumFit.th,
    title: 'REMOTE AREA SUMMARY PER FLOOR',
    alignRight: summaryRows[0].map((_, i) => i >= 3)
  })
  void yTop

  // governing remote area of every zone (zone control valve)
  const zoneRows: string[][] = [
    [
      'FLOOR',
      'ZONE',
      'ZCV TAG',
      'HEADS',
      'AREA FT2',
      'LIMIT FT2',
      'HAZARD',
      'DENSITY GPM/FT2',
      'AREA FT2 (DESIGN)',
      'Q @ ZCV GPM',
      'P @ ZCV PSI',
      'Q @ SRC GPM',
      'P @ SRC PSI',
      'MARGIN PSI'
    ]
  ]
  for (const fl of spr.floors)
    for (const z of fl.zones) {
      const g = z.governing
      zoneRows.push([
        fl.floorName.toUpperCase(),
        `${z.zoneId} ${z.name.toUpperCase()}`,
        z.controlValveTag,
        String(z.headCount),
        f(z.areaFt2, 0),
        f(z.maxAreaFt2, 0),
        g ? (HAZARD_LABEL[g.hazard] ?? g.hazard) : '-',
        g ? f(g.densityGpmFt2, 2) : '-',
        g ? f(g.designAreaFt2, 0) : '-',
        g ? f(g.flowAtFloorGpm) : '-',
        g ? f(g.pressureAtFloorPsi) : '-',
        g ? f(g.flowAtSourceGpm) : '-',
        g ? f(g.pressureAtSourcePsi) : '-',
        g ? f(g.marginPsi) : '-'
      ])
    }
  const zFit = fit(zoneRows, 2.3, leftW + 270, 'GOVERNING REMOTE AREA PER ZONE')
  const zTop = maxBottom - 8 - sumH - 8
  const zSize = drawTable(c, 24 + 2, zTop, zFit.cols, zoneRows, {
    th: zFit.th,
    title: 'GOVERNING REMOTE AREA PER ZONE',
    alignRight: zoneRows[0].map((_, i) => i >= 3)
  })

  // ───────── right column: graph + BOM ─────────
  const colX = Math.max(tableRight + 8, 596)
  const summaryBottom = zTop - zSize.h
  const gx0 = colX + 22
  const gx1 = Math.min(colX + 22 + 190, FRAME.x1 - 10)
  const gy0 = 250
  const gy1 = 520
  if (gov) {
    const sup = r.input.sprinklerDesign!.answers.supply
    const demandQ = gov.flowAtSourceGpm
    const totalQ = gov.totalDemandGpm
    const pump = r.pumps.mainPumps[0]
    const supplyPts: [number, number][] = []
    let pMax: number
    let qMax: number
    let label: string
    if (sup.kind === 'fire-pump' && pump) {
      qMax = Math.max(pump.ratedFlowGpm * 1.5, totalQ * 1.2)
      for (let i = 0; i <= 30; i++) {
        const q = (qMax * i) / 30
        const x = q / pump.ratedFlowGpm
        supplyPts.push([
          q,
          pump.ratedNetPressurePsi * (1.2 + 0.066667 * x - 0.266667 * x * x) +
            r.pumps.suctionPressureMinPsi
        ])
      }
      label = `SUPPLY CURVE - FIRE PUMP ${pump.tag} ${f(pump.ratedFlowGpm, 0)} GPM @ ${f(pump.ratedNetPressurePsi, 0)} PSI (PLUS MIN. SUCTION)`
    } else if (sup.kind === 'city') {
      qMax = Math.max(sup.residualFlowGpm * 1.4, totalQ * 1.3)
      for (let i = 0; i <= 30; i++) {
        const q = (qMax * i) / 30
        supplyPts.push([
          q,
          Math.max(
            0,
            sup.staticPsi -
              (sup.staticPsi - sup.residualPsi) * Math.pow(q / sup.residualFlowGpm, 1.85)
          )
        ])
      }
      label = `SUPPLY CURVE - CITY MAIN ${f(sup.staticPsi, 0)} PSI STATIC, ${f(sup.residualPsi, 0)} PSI @ ${f(sup.residualFlowGpm, 0)} GPM`
    } else {
      qMax = totalQ * 1.5
      supplyPts.push([0, gov.availablePsi], [qMax, gov.availablePsi])
      label = 'SUPPLY (AVAILABLE PRESSURE)'
    }
    pMax = Math.max(...supplyPts.map((p) => p[1]), gov.pressureAtSourcePsi, gov.availablePsi) * 1.12
    const niceStep = (m: number, n: number): number => {
      const raw = m / n
      const p = Math.pow(10, Math.floor(Math.log10(raw)))
      return ([1, 2, 5, 10].find((k) => k * p >= raw) ?? 10) * p
    }
    const qs = niceStep(qMax, 6)
    const ps = niceStep(pMax, 6)
    qMax = Math.ceil(qMax / qs) * qs
    pMax = Math.ceil(pMax / ps) * ps
    const GX = (q: number): number => gx0 + ((gx1 - gx0) * q) / qMax
    const GY = (p: number): number => gy0 + ((gy1 - gy0) * p) / pMax
    T(colX, gy1 + 14, 3.2, 'SUPPLY vs DEMAND (LINEAR AXES)')
    b.rect('FS-LEGEND', X(gx0), Y(gy0), (gx1 - gx0) * S, (gy1 - gy0) * S)
    for (let q = 0; q <= qMax + 1e-6; q += qs) {
      b.line('FS-LEGEND', X(GX(q)), Y(gy0), X(GX(q)), Y(gy1))
      T(GX(q), gy0 - 3, 2, f(q, 0), { align: 'center' })
    }
    for (let p = 0; p <= pMax + 1e-6; p += ps) {
      b.line('FS-LEGEND', X(gx0), Y(GY(p)), X(gx1), Y(GY(p)))
      T(gx0 - 1.5, GY(p), 2, f(p, 0), { align: 'right' })
    }
    T((gx0 + gx1) / 2, gy0 - 8, 2.4, 'FLOW (GPM)', { align: 'center' })
    T(gx0 - 12, (gy0 + gy1) / 2, 2.4, 'PRESSURE (PSI)', { align: 'center', rot: 90 })
    b.polyline(
      'FS-GRAPH',
      supplyPts.map(([q, p]) => [X(GX(q)), Y(GY(p))] as [number, number]),
      false
    )
    // demand curve P = P_d (Q / Q_d)^1.85 through the sprinkler demand point, continued to the point incl. hose
    const dem: [number, number][] = []
    for (let i = 0; i <= 24; i++) {
      const q = (totalQ * i) / 24
      dem.push([q, gov.pressureAtSourcePsi * Math.pow(q / Math.max(demandQ, 1), 1.85)])
    }
    b.polyline(
      'FS-REMOTE',
      dem.filter((p) => p[1] <= pMax).map(([q, p]) => [X(GX(q)), Y(GY(p))] as [number, number]),
      false
    )
    const marker = (q: number, p: number): void => {
      b.circle('FS-REMOTE', X(GX(q)), Y(GY(p)), 1.3 * S)
      b.line('FS-REMOTE', X(GX(q)) - 1.8 * S, Y(GY(p)), X(GX(q)) + 1.8 * S, Y(GY(p)))
      b.line('FS-REMOTE', X(GX(q)), Y(GY(p)) - 1.8 * S, X(GX(q)), Y(GY(p)) + 1.8 * S)
    }
    marker(demandQ, gov.pressureAtSourcePsi)
    b.polyline(
      'FS-HIDN',
      [
        [X(GX(demandQ)), Y(gy0)],
        [X(GX(demandQ)), Y(GY(gov.pressureAtSourcePsi))]
      ],
      false
    )
    b.polyline(
      'FS-HIDN',
      [
        [X(GX(totalQ)), Y(gy0)],
        [X(GX(totalQ)), Y(GY(gov.availablePsi))]
      ],
      false
    )
    marker(totalQ, gov.availablePsi)
    // legend under the graph
    const ly = gy0 - 14
    b.line('FS-GRAPH', X(gx0), Y(ly), X(gx0 + 8), Y(ly))
    T(gx0 + 10, ly, 2, label)
    b.line('FS-REMOTE', X(gx0), Y(ly - 4.5), X(gx0 + 8), Y(ly - 4.5))
    T(
      gx0 + 10,
      ly - 4.5,
      2,
      `DEMAND CURVE (N^1.85) - SPRINKLER DEMAND ${f(demandQ)} GPM @ ${f(gov.pressureAtSourcePsi)} PSI`
    )
    T(
      gx0 + 10,
      ly - 9,
      2,
      `DEMAND POINT INCL. HOSE ALLOWANCE ${f(gov.hoseAllowanceGpm, 0)} GPM: ${f(totalQ)} GPM, SUPPLY AVAILABLE ${f(gov.availablePsi)} PSI`
    )
    T(
      gx0 + 10,
      ly - 13.5,
      2,
      `MARGIN (SUPPLY - DEMAND) ${f(gov.marginPsi)} PSI ${gov.marginPsi >= 0 ? '(ADEQUATE)' : '(INADEQUATE)'}`
    )
  }

  // ───────── bill of materials ─────────
  const bomRows: string[][] = [['ITEM', 'SIZE', 'QTY', 'UNIT']]
  for (const l of spr.bom)
    bomRows.push([
      wrapText(l.item, 62).join('\n'),
      l.size,
      l.unit === 'm' ? f(l.qty) : String(l.qty),
      l.unit
    ])
  const bomTop = summaryBottom - 8
  const availBom = bomTop - 16
  let bth = 2.0
  let bcols = autoCols(bomRows, bth)
  const bomHeight = (t: number): number => bomRows.reduce((a, row) => a + rowH(row, t), 0) + t * 2.6
  while (
    bth > 1.3 &&
    (bomHeight(bth) > availBom || measureTable(bcols, bomRows, { th: bth }).w > colX - 30)
  ) {
    bth -= 0.1
    bcols = autoCols(bomRows, bth)
  }
  drawTable(c, 26, bomTop, bcols, bomRows, {
    th: bth,
    title: 'BILL OF MATERIALS',
    alignRight: [false, false, true, false]
  })
}
