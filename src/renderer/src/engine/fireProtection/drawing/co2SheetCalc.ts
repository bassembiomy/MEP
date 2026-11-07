/**
 * CO-601 — CO2 calculations: quantity table per enclosure (flooding factor, MCF, design concentration, openings,
 * ventilation, temperature, total, rate), Y/Z flow table per enclosure (node names as their own cells), nozzle
 * orifices, storage summary and bill of materials. Tables are packed in columns, text shrinks until everything fits.
 */
import { CO2_PRELIMINARY_NOTE, FT3_PER_M3 } from '../co2/nfpa12'
import { f0, fx, kgOf, lbKg } from './co2SheetKit'
import { type Ctx, FRAME, PX, PY, autoCols, drawTable, measureTable, sheetTitle } from './sheetKit'

interface Block {
  title: string
  rows: string[][]
  align: boolean[]
}

export function drawCo2CalcSheet(c: Ctx): void {
  const { b, r } = c
  const co2 = r.co2!
  const st = co2.storage
  const hp = st.storage === 'high-pressure'
  sheetTitle(
    c,
    26,
    574,
    'CO2 CALCULATIONS & MATERIALS',
    'NFPA 12-2022 - QUANTITY, DISCHARGE RATE, Y/Z FLOW CALCULATION, STORAGE AND BILL OF MATERIALS'
  )
  const blocks: Block[] = []
  const encs = co2.floors.flatMap((f) => f.enclosures.map((e) => ({ f, e })))

  const qh = [
    'FLOOR',
    'ENCL',
    'NAME',
    'FIRE',
    'V GROSS FT3',
    'V NET FT3',
    'FLOODING FACTOR FT3/LB',
    'MIN LB',
    'BASIC LB',
    'MCF',
    'DESIGN CONCENTRATION %',
    'OPENINGS LB',
    'VENTILATION LB',
    'TEMP %',
    'TOTAL LB',
    'TOTAL KG',
    'RATE LB/MIN',
    'T MIN',
    'SOAK MIN'
  ]
  blocks.push({
    title: 'QUANTITY OF CARBON DIOXIDE PER ENCLOSURE (NFPA 12-2022 CH. 5)',
    rows: [
      qh,
      ...encs.map(({ f, e }) => {
        const q = e.quantity
        return [
          f.floorId,
          e.enclosureId,
          e.name.toUpperCase(),
          e.fireType === 'surface' ? 'SURFACE' : 'DEEP-SEATED',
          f0(q.grossVolumeFt3),
          f0(q.volumeFt3),
          fx(q.floodingFactorFt3PerLb, 1),
          f0(q.minimumLb),
          f0(q.basicLb),
          fx(q.mcf, 3),
          f0(q.designConcentrationPct),
          f0(q.openingsLb),
          f0(q.ventilationLb),
          fx(q.temperatureCorrectionPct, 1),
          f0(q.totalLb),
          f0(kgOf(q.totalLb)),
          f0(e.rateLbMin),
          fx(e.dischargeTimeMin, 1),
          f0(e.soakMin)
        ]
      })
    ],
    align: qh.map((_, i) => i >= 4)
  })

  const yh = [
    'FROM',
    'TO',
    'Q LB/MIN',
    'SIZE IN',
    'ID IN',
    'L FT',
    'FITTINGS FT',
    'P START PSI',
    'P END PSI',
    'Y1',
    'Y2',
    'Z1',
    'Z2'
  ]
  for (const { f, e } of encs) {
    blocks.push({
      title: `Y/Z FLOW - ${f.floorId} / ${e.enclosureId} ${e.name.toUpperCase()} - ${f0(e.rateLbMin)} LB/MIN, ${e.nozzles.length} NOZZLES`,
      rows: [
        yh,
        ...e.flowRows.map((w) => [
          w.fromNode,
          w.toNode,
          fx(w.flowLbMin, 1),
          String(w.sizeIn),
          fx(w.idIn, 3),
          fx(w.lengthFt, 1),
          fx(w.fittingsFt, 1),
          fx(w.startPsi, 1),
          fx(w.endPsi, 1),
          f0(w.y1),
          f0(w.y2),
          fx(w.z1, 4),
          fx(w.z2, 4)
        ])
      ],
      align: yh.map((_, i) => i >= 2)
    })
  }

  const nh = ['NOZZLE TAG', 'NODE', 'Q LB/MIN', 'P PSI', 'AREA IN2', 'ORIFICE CODE']
  blocks.push({
    title: 'NOZZLE ORIFICE SCHEDULE',
    rows: [
      nh,
      ...encs.flatMap(({ e }) =>
        e.nozzles.map((n) => [
          n.tag,
          n.node,
          fx(n.flowLbMin, 1),
          f0(n.pressurePsi),
          fx(n.orificeAreaIn2, 4),
          String(n.orificeCode)
        ])
      )
    ],
    align: nh.map((_, i) => i >= 2)
  })
  blocks.push({
    title: 'STORAGE SUMMARY',
    rows: [
      ['ITEM', 'VALUE'],
      ['STORAGE TYPE', hp ? 'HIGH-PRESSURE CYLINDERS' : 'LOW-PRESSURE TANK'],
      ['GOVERNING ENCLOSURE', st.governingEnclosureId ?? '-'],
      ['MAIN SUPPLY', lbKg(st.mainLb)],
      ['RESERVE SUPPLY', st.reserveLb > 0 ? lbKg(st.reserveLb) : 'NONE'],
      hp
        ? [
            'CYLINDERS MAIN + RESERVE',
            `${st.mainCylinders} + ${st.reserveCylinders} x ${f0(st.cylinderLb)} LB`
          ]
        : ['TANK SIZE', `${st.tankTons ?? 0} TON`],
      ['INSTALLED CO2', lbKg(st.installedLb)],
      ['TOTAL NOZZLES', String(co2.totalNozzles)]
    ],
    align: [false, false]
  })
  blocks.push({
    title: 'BILL OF MATERIALS',
    rows: [
      ['ITEM', 'SIZE', 'QTY', 'UNIT'],
      ...co2.bom.map((m) => [
        m.item.toUpperCase(),
        m.size.toUpperCase(),
        m.unit === 'm' ? fx(m.qty, 1) : f0(m.qty),
        m.unit.toUpperCase()
      ])
    ],
    align: [false, false, true, false]
  })

  // pack the blocks into columns; shrink the text until everything fits the sheet
  const xL = FRAME.x0 + 4
  const xR = FRAME.x1 - 4
  const yTop = 560
  const yBot = 76
  const gap = 4
  let th = 3.4
  for (;;) {
    const meas = blocks.map((bl) => {
      const cols = autoCols(bl.rows, th)
      return { cols, ...measureTable(cols, bl.rows, { th, title: bl.title }) }
    })
    const place: { i: number; x: number; y: number }[] = []
    let x = xL
    let y = yTop
    let colW = 0
    meas.forEach((m, i) => {
      if (y - m.h < yBot && y !== yTop) {
        x += colW + gap
        y = yTop
        colW = 0
      }
      place.push({ i, x, y })
      y -= m.h + gap
      colW = Math.max(colW, m.w)
    })
    const fits = x + colW <= xR && place.every((p) => p.y - meas[p.i].h >= yBot - 0.01)
    if (fits || th <= 1.45) {
      for (const p of place)
        drawTable(c, p.x, p.y, meas[p.i].cols, blocks[p.i].rows, {
          th,
          title: blocks[p.i].title,
          alignRight: blocks[p.i].align
        })
      break
    }
    th -= 0.1
  }
  b.text(
    'FP-ANNO',
    PX(c, 26),
    PY(c, 52),
    2.2,
    CO2_PRELIMINARY_NOTE.toUpperCase().replace('—', '-'),
    { vAlign: 'middle' }
  )
  b.text(
    'FP-ANNO',
    PX(c, 26),
    PY(c, 46),
    2.2,
    `V NET = GROSS - DEDUCTIONS (1 M3 = ${fx(FT3_PER_M3, 2)} FT3). TOTAL = BASIC x MCF + OPENINGS + VENTILATION, CORRECTED FOR TEMPERATURE. Y/Z = NFPA 12 ANNEX TWO-PHASE FLOW FUNCTIONS.`,
    { vAlign: 'middle' }
  )
}
