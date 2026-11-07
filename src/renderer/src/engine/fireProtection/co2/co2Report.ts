/**
 * Self-contained, printable HTML report for the NFPA 12 CO2 total-flooding design: questionnaire, design basis,
 * per-enclosure quantity / discharge / Y-Z flow tables, storage, safety, accessories, bill of materials, checks and
 * every shop-drawing sheet embedded as SVG.
 */
import type { Drawing } from '../drawing/drawingTypes'
import { renderSvg } from '../drawing/svgRenderer'
import type { FireDesignResult } from '../fpTypes'
import { CO2_DETECTION_TEXT, CO2_SIGNS, co2SafetyPoints } from './co2Signs'
import type { Co2Answers } from './co2Types'
import {
  CO2_MATERIALS,
  CO2_PRELIMINARY_NOTE,
  CO2_REFERENCE_DESIGN,
  CO2_REFERENCE_QUANTITY,
  FT3_PER_M3,
  LB_PER_KG,
  MIN_TIME_DELAY_S
} from './nfpa12'

/** The drawing set produced by `generateCo2Drawings(result)`. */
export interface Co2DrawingSet {
  floors: { floorId: string; drawing: Drawing }[]
  schematic: Drawing
  calculations: Drawing
  combined?: Drawing
}

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** Fixed-decimals number, '-' for missing / non-finite values (keeps NaN out of the report). */
const num = (v: number | null | undefined, d = 1): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(d)
const lbKg = (lb: number): string => `${num(lb, 0)} lb (${num(lb / LB_PER_KG, 0)} kg)`
const yesNo = (b: boolean): string => (b ? 'Yes' : 'No')

function table(head: string[], rows: string[][], numCols: number[] = []): string {
  return (
    `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
    rows
      .map(
        (r) =>
          `<tr>${r.map((c, i) => `<td${numCols.includes(i) ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`
      )
      .join('') +
    `</tbody></table>`
  )
}

function checksTable(
  checks: { status: string; title: string; reference: string; detail: string }[]
): string {
  if (checks.length === 0) return '<p>No checks.</p>'
  return (
    `<table><thead><tr><th>Status</th><th>Check</th><th>Reference</th><th>Detail</th></tr></thead><tbody>` +
    checks
      .map(
        (c) =>
          `<tr><td class="${esc(c.status)}">${esc(c.status.toUpperCase())}</td><td>${esc(c.title)}</td><td>${esc(c.reference)}</td><td>${esc(c.detail)}</td></tr>`
      )
      .join('') +
    `</tbody></table>`
  )
}

const DETECTION_LABEL: Record<Co2Answers['detection'], string> = {
  'smoke-cross-zoned': 'Smoke detection, cross-zoned (zones A and B)',
  heat: 'Heat detection',
  'none-manual': 'No automatic detection - manual release only'
}

const CSS = `
:root{--fg:#1a1a1a;--mut:#555;--line:#c9c9c9;--acc:#b91c1c}
*{box-sizing:border-box}
body{font-family:Segoe UI,Helvetica,Arial,sans-serif;color:var(--fg);margin:0;padding:24px;background:#fff;line-height:1.4;font-size:12px}
h1{font-size:22px;margin:0 0 4px;color:var(--acc)}
h2{font-size:15px;margin:22px 0 6px;border-bottom:2px solid var(--acc);padding-bottom:3px}
h3{font-size:12.5px;margin:14px 0 4px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:4px 24px;border:1px solid var(--line);padding:10px 12px;margin:10px 0 4px}
.meta b{display:block;font-size:9px;text-transform:uppercase;color:var(--mut)}
table{border-collapse:collapse;width:100%;margin:6px 0;font-size:11px}
th,td{border:1px solid var(--line);padding:3px 6px;text-align:left;vertical-align:top}
th{background:#f1f1f1;font-size:10px;text-transform:uppercase}
td.n{text-align:right;font-variant-numeric:tabular-nums}
.floor{margin-top:18px}
.sheet{margin-top:24px;page-break-before:always;break-before:page}
.sheet h2{margin-top:0}
.sheet svg{width:100%;height:auto;border:1px solid var(--line);display:block}
.pass{color:#047857;font-weight:700}.warn{color:#b45309;font-weight:700}.fail{color:#b91c1c;font-weight:700}
.note{color:var(--mut);font-size:10.5px}
.manuf{border:2px solid var(--acc);padding:8px 12px;margin:10px 0;font-weight:600}
.sign{border:2px solid #000;padding:6px 10px;margin:6px 0;max-width:520px;text-align:center;font-weight:700}
@page{size:A3 landscape;margin:10mm}
@media print{body{padding:0}.floor{page-break-before:always}table{page-break-inside:auto}tr{page-break-inside:avoid}h2,h3{page-break-after:avoid}}
`

function answerRows(a: Co2Answers): string[][] {
  const hp = a.storage === 'high-pressure'
  return [
    [
      'Storage type',
      hp
        ? 'High-pressure cylinders (about 850 psi at 70 °F)'
        : 'Low-pressure refrigerated tank (300 psi at 0 °F)',
      'NFPA 12-2022 Ch. 4'
    ],
    [
      'Cylinder size (net CO2)',
      hp ? `${a.cylinderLb} lb` : 'Not applicable (tank)',
      'Common sizes 50, 75, 100 lb'
    ],
    [
      'Reserve supply',
      yesNo(a.reserve),
      'Connected reserve equal to the main supply (NFPA 12 Ch. 4)'
    ],
    [
      'Odorizer',
      yesNo(a.odorizer),
      'Required for normally unoccupied but occupiable spaces (NFPA 12 Ch. 4)'
    ],
    ['Detection', DETECTION_LABEL[a.detection], 'NFPA 72'],
    [
      'Pre-discharge time delay',
      `${a.timeDelayS} s`,
      `Minimum ${MIN_TIME_DELAY_S} s where people may be present`
    ]
  ]
}

export function buildCo2ReportHtml(result: FireDesignResult, drawings: Co2DrawingSet): string {
  const co2 = result.co2
  const inp = result.input
  const design = inp.co2Design
  const title = `Carbon Dioxide Total Flooding System (NFPA 12) - ${inp.projectName}`
  const p: string[] = []
  p.push(`<h1>${esc(title)}</h1>`)
  p.push(
    `<div class="meta">` +
      [
        ['Project', inp.projectName],
        ['Project no.', inp.projectNumber],
        ['Designer', inp.designer],
        ['Date', new Date().toISOString().slice(0, 10)],
        ['Standard', 'NFPA 12-2022 - Carbon Dioxide Extinguishing Systems']
      ]
        .map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`)
        .join('') +
      `</div>`
  )
  p.push(`<p class="manuf">${esc(CO2_PRELIMINARY_NOTE)}</p>`)
  if (!co2 || !design) {
    p.push('<p>No CO2 design is defined for this project.</p>')
    return wrap(title, p.join('\n'))
  }
  const a = design.answers
  const st = co2.storage
  const hp = st.storage === 'high-pressure'

  p.push('<h2>1. Design questionnaire</h2>')
  p.push(table(['Question', 'Answer', 'Reference / note'], answerRows(a)))
  p.push('<h3>Protected enclosures (per-enclosure answers)</h3>')
  const encRows: string[][] = []
  for (const fl of design.floors)
    for (const e of fl.enclosures)
      encRows.push([
        fl.name,
        `${e.id} ${e.name}`,
        e.fireType === 'surface'
          ? `Surface - ${CO2_MATERIALS[e.material]?.label ?? e.material}`
          : `Deep-seated - ${e.deepSeated}`,
        num(e.heightM, 2),
        num(e.deductionM3, 1),
        num(e.openingsM2, 2),
        num(e.ventilationM3min, 0),
        num(e.temperatureC, 0),
        e.occupancy,
        num(e.strengthPsf, 0)
      ])
  p.push(
    table(
      [
        'Floor',
        'Enclosure',
        'Hazard',
        'Height m',
        'Deduction m³',
        'Openings m²',
        'Ventilation m³/min',
        'Temp °C',
        'Occupancy',
        'Strength lb/ft²'
      ],
      encRows,
      [3, 4, 5, 6, 7, 9]
    )
  )

  p.push('<h2>2. Design basis (NFPA 12-2022)</h2>')
  p.push(
    `<p>Quantity: net volume ÷ flooding factor (surface fires: ${esc(CO2_REFERENCE_QUANTITY)} Table 5.3.3(a), at 34 %; deep-seated fires: Table 5.4.2.1), never less than the table minimum, multiplied by the material conversion factor (MCF = ln(1 − C/100) ÷ ln(0.66) for C above 34 %), plus the quantity compensating openings and non-stoppable ventilation, corrected for temperature outside −18 to 93 °C.</p>` +
      `<p>Discharge: surface fires - liquid discharge time not more than 1 minute; deep-seated fires - not more than 7 minutes with at least 30 % of the quantity in 2 minutes. Pipe flow by the NFPA 12 Annex Y/Z two-phase method from ${hp ? '750 psi (52 bar)' : '300 psi (20.7 bar)'}; minimum nozzle pressure ${hp ? '300' : '150'} psi. Design reference: ${esc(CO2_REFERENCE_DESIGN)}.</p>`
  )

  p.push('<h2>3. Floor designs</h2>')
  co2.floors.forEach((f, fi) => {
    const input = design.floors.find((x) => x.id === f.floorId)
    p.push(`<section class="floor"><h2>3.${fi + 1} ${esc(f.floorName)}</h2>`)
    p.push(
      `<p>Elevation ${num(input?.elevationM, 2)} m; ${f.enclosures.length} enclosure(s); ${f.pipes.length} pipe segments; ${f.devices.length} devices; storage point at (${num(f.storage.x, 0)}, ${num(f.storage.y, 0)}) mm.</p>`
    )
    for (const e of f.enclosures) {
      const q = e.quantity
      p.push(`<h3>${esc(e.enclosureId)} - ${esc(e.name)} (${esc(e.hazardLabel)})</h3>`)
      p.push('<h3>Quantity of carbon dioxide</h3>')
      p.push(
        table(
          [
            'Area m²',
            'Gross volume ft³ (m³)',
            'Net volume ft³ (m³)',
            'Design concentration %',
            'Flooding factor ft³/lb',
            'Table minimum lb',
            'Basic quantity lb',
            'MCF',
            'Openings lb',
            'Ventilation lb',
            'Temperature correction %',
            'Total lb (kg)'
          ],
          [
            [
              num(e.areaM2, 1),
              `${num(q.grossVolumeFt3, 0)} (${num(q.grossVolumeFt3 / FT3_PER_M3, 1)})`,
              `${num(q.volumeFt3, 0)} (${num(q.volumeFt3 / FT3_PER_M3, 1)})`,
              num(q.designConcentrationPct, 0),
              num(q.floodingFactorFt3PerLb, 1),
              num(q.minimumLb, 0),
              num(q.basicLb, 0),
              num(q.mcf, 3),
              num(q.openingsLb, 0),
              num(q.ventilationLb, 0),
              num(q.temperatureCorrectionPct, 1),
              lbKg(q.totalLb)
            ]
          ],
          [0, 3, 4, 5, 6, 7, 8, 9, 10]
        )
      )
      p.push('<h3>Discharge</h3>')
      p.push(
        table(
          [
            'Rate lb/min (kg/min)',
            'Liquid discharge time min',
            '30 % quantity lb',
            'Soak time min',
            'Nozzles',
            'Cylinders',
            'Lowest nozzle pressure psi',
            'Vent free area in² (mm²)'
          ],
          [
            [
              `${num(e.rateLbMin, 1)} (${num(e.rateLbMin / LB_PER_KG, 1)})`,
              num(e.dischargeTimeMin, 2),
              num(e.thirtyPctLb, 0),
              num(e.soakMin, 0),
              String(e.nozzles.length),
              hp ? String(e.cylinders) : '-',
              num(e.minNozzlePressurePsi, 1),
              `${num(e.ventAreaIn2, 1)} (${num(e.ventAreaMm2, 0)})`
            ]
          ],
          [1, 2, 3, 4, 5, 6]
        )
      )
      p.push('<h3>Y/Z flow table (storage to nozzles)</h3>')
      p.push(
        table(
          [
            'From',
            'To',
            'Q lb/min',
            'Size in',
            'ID in',
            'Length ft',
            'Fittings ft',
            'P start psi',
            'P end psi',
            'Y1',
            'Y2',
            'Z1',
            'Z2'
          ],
          e.flowRows.map((w) => [
            w.fromNode,
            w.toNode,
            num(w.flowLbMin, 1),
            num(w.sizeIn, 2),
            num(w.idIn, 3),
            num(w.lengthFt, 1),
            num(w.fittingsFt, 1),
            num(w.startPsi, 1),
            num(w.endPsi, 1),
            num(w.y1, 0),
            num(w.y2, 0),
            num(w.z1, 4),
            num(w.z2, 4)
          ]),
          [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
        )
      )
      p.push('<h3>Nozzles and orifices</h3>')
      p.push(
        table(
          [
            'Tag',
            'Node',
            'Position mm',
            'Flow lb/min',
            'Pressure psi',
            'Required orifice area in²',
            'Orifice code (1/32 in)'
          ],
          e.nozzles.map((n) => [
            n.tag,
            n.node,
            `${num(n.x, 0)}, ${num(n.y, 0)}`,
            num(n.flowLbMin, 1),
            num(n.pressurePsi, 1),
            num(n.orificeAreaIn2, 4),
            num(n.orificeCode, 1)
          ]),
          [3, 4, 5, 6]
        )
      )
      p.push(checksTable(e.checks))
    }
    p.push('<h3>Devices</h3>')
    p.push(
      table(
        ['Tag', 'Kind', 'Enclosure', 'Zone', 'Position mm'],
        f.devices.map((d) => [
          d.tag,
          d.kind,
          d.enclosureId ?? '-',
          d.zone ?? '-',
          `${num(d.x, 0)}, ${num(d.y, 0)}`
        ])
      )
    )
    p.push('</section>')
  })

  p.push('<h2>4. Storage</h2>')
  p.push(
    table(
      ['Item', 'Value'],
      [
        ['Storage type', hp ? 'High-pressure cylinders' : 'Low-pressure tank'],
        ['Governing enclosure (largest quantity)', st.governingEnclosureId ?? '-'],
        ['Main supply', lbKg(st.mainLb)],
        ['Reserve supply', st.reserveLb > 0 ? lbKg(st.reserveLb) : 'None'],
        hp
          ? [
              'Cylinders (main + reserve)',
              `${st.mainCylinders} + ${st.reserveCylinders} x ${num(st.cylinderLb, 0)} lb`
            ]
          : ['Tank size', `${st.tankTons ?? '-'} US tons`],
        ['Installed CO2', lbKg(st.installedLb)],
        ['Total discharge nozzles', String(co2.totalNozzles)]
      ]
    )
  )

  p.push('<h2>5. Safety (NFPA 12-2022 Ch. 4)</h2>')
  p.push(
    `<ul>${co2SafetyPoints(a)
      .map((s) => `<li><b>${esc(s.title)}.</b> ${esc(s.text)}</li>`)
      .join('')}</ul>`
  )
  p.push(`<p class="note">Detection and release: ${esc(CO2_DETECTION_TEXT[a.detection])}.</p>`)
  p.push('<h3>Warning signs</h3>')
  for (const sg of CO2_SIGNS)
    p.push(
      `<div class="sign"><div class="note">${esc(sg.title)} - ${esc(sg.location)}</div>${sg.lines.map(esc).join('<br>')}</div>`
    )

  p.push('<h2>6. Accessories</h2>')
  p.push(
    table(
      ['Tag', 'Item', 'Qty', 'Size in', 'Location', 'Reference'],
      co2.accessories.map((x) => [
        x.tag,
        x.item,
        String(x.qty),
        x.sizeIn === null ? '-' : num(x.sizeIn, 2),
        x.location,
        x.reference
      ]),
      [2]
    )
  )
  p.push('<h2>7. Bill of materials</h2>')
  p.push(
    table(
      ['Item', 'Size', 'Qty', 'Unit'],
      co2.bom.map((x) => [x.item, x.size, num(x.qty, x.unit === 'm' ? 1 : 0), x.unit]),
      [2]
    )
  )

  p.push('<h2>8. Design checks</h2>')
  p.push(checksTable(co2.checks))
  p.push(`<p class="manuf">${esc(CO2_PRELIMINARY_NOTE)}</p>`)

  const sheet = (d: Drawing, label: string): void => {
    p.push(
      `<section class="sheet"><h2>${esc(label)}</h2>${renderSvg(d, { sheetIndex: 0, background: 'white' })}</section>`
    )
  }
  for (const f of drawings.floors) {
    const sh = f.drawing.sheets[0]
    sheet(
      f.drawing,
      `${sh?.number ?? 'CO'} - ${sh?.title ?? f.floorId} (${sh?.paper ?? 'A1'}, 1:${sh?.scale ?? '-'})`
    )
  }
  const sc = drawings.schematic.sheets[0]
  sheet(
    drawings.schematic,
    `${sc?.number ?? 'CO-501'} - ${sc?.title ?? 'System schematic and details'}`
  )
  const ca = drawings.calculations.sheets[0]
  sheet(drawings.calculations, `${ca?.number ?? 'CO-601'} - ${ca?.title ?? 'Calculations'}`)
  return wrap(title, p.join('\n'))
}

function wrap(title: string, body: string): string {
  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`
}
