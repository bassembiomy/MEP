/**
 * Self-contained, printable HTML report for the automatic sprinkler system design (NFPA 13-2019):
 * questionnaire, design basis, per-floor results (remote area, nodes, rooms, heads), building summary,
 * accessories, spares, BOM, checks, out-of-scope items and every shop-drawing sheet embedded as SVG.
 */
import type { FireDesignResult } from '../fpTypes'
import type { Drawing } from '../drawing/drawingTypes'
import { renderSvg } from '../drawing/svgRenderer'
import {
  type HydraulicGraphModel,
  buildHydraulicGraph,
  graphX,
  maxVelocityFps
} from '../drawing/sprinklerHydraulicGraph'
import { HAZARD_DESIGN } from '../standards/nfpa13'
import {
  DEFLECTOR_RANGE_MM,
  DRY_AREA_INCREASE,
  DRY_CAPACITY_NO_QOD_GAL,
  DRY_CAPACITY_WITH_QOD_GAL,
  DRY_DELIVERY_TIME_S,
  MIN_SPRINKLER_SPACING_MM,
  MIN_WALL_DISTANCE_MM,
  PIPE_SCHEDULE_LIMITS,
  QUESTIONNAIRE,
  SPACING_RULES,
  SPRINKLER_OCCUPANCIES
} from './nfpa13Sprinkler'
import type {
  ObstructionResult,
  RemoteAreaResult,
  SprinklerAnswers,
  SprinklerHeadType,
  SprinklerSystemType
} from './sprinklerTypes'

/** The drawing set produced by `generateSprinklerDrawings(result)`. */
export interface SprinklerDrawingSet {
  floors: { floorId: string; drawing: Drawing }[]
  riserAndDetails: Drawing
  hydraulics: Drawing
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

const SYSTEM_LABEL: Record<SprinklerSystemType, string> = {
  wet: 'Wet pipe',
  dry: 'Dry pipe',
  'preaction-single': 'Preaction (single interlock)',
  'preaction-double': 'Preaction (double interlock)',
  deluge: 'Deluge'
}

const yesNo = (b: boolean): string => (b ? 'Yes' : 'No')

function table(head: string[], rows: string[][], cls = ''): string {
  return (
    `<table class="${cls}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
    rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') +
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

function answerText(a: SprinklerAnswers, id: keyof SprinklerAnswers): string {
  const v = a[id]
  if (id === 'supply') {
    const s = a.supply
    return s.kind === 'fire-pump'
      ? 'Fire pump (sized in this design)'
      : `City main: static ${num(s.staticPsi)} psi, residual ${num(s.residualPsi)} psi @ ${num(s.residualFlowGpm, 0)} gpm`
  }
  const entry = QUESTIONNAIRE.find((q) => q.id === id)
  if (typeof v === 'boolean') return yesNo(v)
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '-'
  return entry?.options?.find((o) => o.value === v)?.label ?? String(v)
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
@page{size:A3 landscape;margin:10mm}
@media print{body{padding:0}.floor{page-break-before:always}table{page-break-inside:auto}tr{page-break-inside:avoid}h2,h3{page-break-after:avoid}}
`

const RULE_LABEL: Record<ObstructionResult['rule'], string> = {
  beam: 'Beam rule',
  'three-times': 'Three-times rule',
  wide: 'Wide obstruction - sprinklers below',
  wall: 'Deep beam - wall (bays)'
}

const NODE_HEAD = [
  'From',
  'To',
  'Description',
  'K',
  'q added gpm',
  'Q total gpm',
  'Nom. in',
  'ID in',
  'C',
  'Length ft',
  'Fittings',
  'Eq. ft',
  'Total ft',
  'Pf psi/ft',
  'Pf psi',
  'Pe psi',
  'Pt start psi',
  'Pt end psi',
  'v fps'
]

function nodeRows(g: RemoteAreaResult): string[][] {
  return g.rows.map((r) => [
    r.fromNode,
    r.toNode,
    r.description,
    r.kFactor === undefined ? '-' : num(r.kFactor, 1),
    num(r.flowAddedGpm, 1),
    num(r.totalFlowGpm, 1),
    num(r.nominalIn, 2),
    num(r.idIn, 3),
    num(r.c, 0),
    num(r.lengthFt, 1),
    r.fittingsDesc || '-',
    num(r.fittingsEqFt, 1),
    num(r.totalLengthFt, 1),
    num(r.pfPerFt, 4),
    num(r.pfPsi, 2),
    num(r.pePsi, 2),
    num(r.ptStartPsi, 2),
    num(r.ptEndPsi, 2),
    num(r.velocityFps, 1)
  ])
}

/** Inline SVG of the N^1.85 graph: x axis proportional to Q^1.85, gridlines labelled in gpm. */
function graphSvg(m: HydraulicGraphModel): string {
  const W = 640
  const H = 330
  const x0 = 56
  const x1 = W - 16
  const y0 = H - 46
  const y1 = 14
  const X = (q: number): number => x0 + (x1 - x0) * graphX(q, m.qMax)
  const Y = (p: number): number => y0 - ((y0 - y1) * p) / m.pMax
  const o: string[] = []
  o.push(
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI,Arial,sans-serif" font-size="10" style="max-width:720px;border:1px solid #c9c9c9;background:#fff">`
  )
  o.push(
    `<rect x="${x0}" y="${y1}" width="${x1 - x0}" height="${y0 - y1}" fill="none" stroke="#888"/>`
  )
  for (const t of m.xTicks) {
    const x = x0 + (x1 - x0) * t.pos
    if (t.pos > 0 && t.pos < 1)
      o.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="#ddd"/>`)
    if (t.showLabel)
      o.push(`<text x="${x}" y="${y0 + 12}" text-anchor="middle">${esc(t.label)}</text>`)
  }
  for (const t of m.yTicks) {
    const y = y0 - (y0 - y1) * t.pos
    if (t.pos > 0 && t.pos < 1)
      o.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#ddd"/>`)
    o.push(`<text x="${x0 - 5}" y="${y + 3}" text-anchor="end">${esc(t.label)}</text>`)
  }
  o.push(
    `<text x="${(x0 + x1) / 2}" y="${H - 6}" text-anchor="middle">Flow Q (gpm) - axis scaled Q^1.85</text>`
  )
  o.push(
    `<text transform="translate(12 ${(y0 + y1) / 2}) rotate(-90)" text-anchor="middle">Pressure (psi)</text>`
  )
  o.push(
    `<polyline fill="none" stroke="#0e7490" stroke-width="2" points="${m.supply.map(([q, p]) => `${X(q).toFixed(1)},${Y(p).toFixed(1)}`).join(' ')}"/>`
  )
  const [qa, pa] = m.demand
  const [qb, pb] = m.demandHose
  const [qc, pc] = m.supplyAtDemand
  o.push(
    `<line x1="${X(qa)}" y1="${Y(pa)}" x2="${X(qb)}" y2="${Y(pb)}" stroke="#b91c1c" stroke-dasharray="5 3"/>`
  )
  o.push(`<line x1="${X(qb)}" y1="${Y(pb)}" x2="${X(qc)}" y2="${Y(pc)}" stroke="#444"/>`)
  for (const [lbl, q, p, col] of [
    ['A', qa, pa, '#b91c1c'],
    ['B', qb, pb, '#b91c1c'],
    ['C', qc, pc, '#0e7490']
  ] as [string, number, number, string][]) {
    o.push(
      `<circle cx="${X(q)}" cy="${Y(p)}" r="3.5" fill="${col}"/><text x="${X(q) + 6}" y="${Y(p) - 4}" font-weight="700">${lbl}</text>`
    )
  }
  o.push(
    `<text x="${X(qc) + 10}" y="${(Y(pb) + Y(pc)) / 2}" fill="#444">${esc(num(m.marginPsi, 1))} psi</text>`
  )
  o.push('</svg>')
  return o.join('')
}

export function buildSprinklerReportHtml(
  result: FireDesignResult,
  drawings: SprinklerDrawingSet
): string {
  const s = result.sprinklers
  const inp = result.input
  const title = `Automatic Sprinkler System (NFPA 13) - ${inp.projectName}`
  const p: string[] = []
  p.push(`<h1>${esc(title)}</h1>`)
  p.push(
    `<div class="meta">` +
      [
        ['Project', inp.projectName],
        ['Project no.', inp.projectNumber],
        ['Designer', inp.designer],
        ['Date', new Date().toISOString().slice(0, 10)],
        ['Standard', 'NFPA 13-2019 - Installation of Sprinkler Systems']
      ]
        .map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`)
        .join('') +
      `</div>`
  )

  const design = inp.sprinklerDesign
  if (!s || !design) {
    p.push('<p>No sprinkler design is defined for this project.</p>')
    return wrap(title, p.join('\n'))
  }
  const headType = (id: string): SprinklerHeadType | undefined =>
    s.headTypes.find((h) => h.id === id)

  // ───────── Design questionnaire
  p.push('<h2>1. Design questionnaire</h2>')
  p.push(
    table(
      ['Question', 'Answer', 'Reference / note'],
      QUESTIONNAIRE.map((q) => [q.question, answerText(design.answers, q.id), q.help])
    )
  )

  // ───────── Design basis
  p.push('<h2>2. Design basis (NFPA 13-2019)</h2>')
  p.push('<h3>Hazard classification, density / area and hose allowance</h3>')
  p.push(
    table(
      [
        'Hazard',
        'Density gpm/ft²',
        'Design area ft²',
        'Max coverage ft²',
        'Max spacing ft',
        'Inside hose gpm',
        'Total hose gpm',
        'Duration min',
        'Reference'
      ],
      Object.values(HAZARD_DESIGN).map((h) => [
        h.label,
        num(h.densityGpmFt2, 2),
        num(h.areaFt2, 0),
        num(h.maxCoverageFt2, 0),
        num(h.maxSpacingFt, 0),
        num(h.hoseInsideGpm, 0),
        num(h.hoseTotalGpm, 0),
        `${h.durationMin[0]}-${h.durationMin[1]}`,
        h.reference
      ])
    )
  )
  p.push(
    '<h3>Sprinkler spacing (Table 10.2.4.2.1(a)-(d), standard spray, hydraulically calculated)</h3>'
  )
  p.push(
    table(
      ['Class', 'Max protection area ft²', 'Max spacing ft'],
      (Object.keys(SPACING_RULES) as (keyof typeof SPACING_RULES)[]).map((k) => [
        k,
        num(SPACING_RULES[k].maxAreaFt2, 0),
        num(SPACING_RULES[k].maxSpacingFt, 0)
      ])
    )
  )
  p.push(
    `<p class="note">Minimum spacing between sprinklers ${num(MIN_SPRINKLER_SPACING_MM / 304.8, 0)} ft (${num(MIN_SPRINKLER_SPACING_MM, 0)} mm, NFPA 13 §10.2.5.3); minimum wall distance ${num(MIN_WALL_DISTANCE_MM / 25.4, 0)} in (${num(MIN_WALL_DISTANCE_MM, 0)} mm, §10.2.5.2.3); deflector ${DEFLECTOR_RANGE_MM[0]}-${DEFLECTOR_RANGE_MM[1]} mm below the ceiling (§10.2.6.1.1).</p>`
  )
  p.push('<h3>Pipe schedule limits - maximum sprinklers per steel pipe size (NFPA 13 §28.5)</h3>')
  {
    const sizes = [
      ...new Set(Object.values(PIPE_SCHEDULE_LIMITS).flatMap((t) => Object.keys(t).map(Number)))
    ].sort((a, b) => a - b)
    const lim = (v: number | undefined): string =>
      v === undefined ? '-' : Number.isFinite(v) ? String(v) : 'unlimited'
    p.push(
      table(
        ['Size in', 'Light', 'Ordinary', 'Extra'],
        sizes.map((z) => [
          String(z),
          lim(PIPE_SCHEDULE_LIMITS.light[z]),
          lim(PIPE_SCHEDULE_LIMITS.ordinary[z]),
          lim(PIPE_SCHEDULE_LIMITS.extra[z])
        ])
      )
    )
  }
  p.push(
    `<p class="note">Dry-pipe and double-interlock preaction design areas are increased by ${num((DRY_AREA_INCREASE - 1) * 100, 0)} % (§19.3.3.2.5). Dry system capacity ${DRY_CAPACITY_NO_QOD_GAL} gal without / ${DRY_CAPACITY_WITH_QOD_GAL} gal with a quick-opening device (§8.2.3); maximum water delivery time light ${DRY_DELIVERY_TIME_S.light} s, ordinary ${DRY_DELIVERY_TIME_S.ordinary} s, extra ${DRY_DELIVERY_TIME_S.extra} s (Table 8.2.3.6.1). Hydraulic calculation by Hazen-Williams, minimum operating pressure 7 psi.</p>`
  )
  p.push('<h3>Sprinkler types used</h3>')
  p.push(
    table(
      ['Type', 'Description', 'K', 'Orientation', 'Response', 'Rating °F', 'Class', 'Bulb', 'Qty'],
      s.headTypes.map((h) => [
        h.id,
        h.description,
        num(h.kFactor, 1),
        h.orientation,
        h.response,
        num(h.tempRatingF, 0),
        h.tempClass,
        h.bulbColor,
        String(
          s.floors.reduce((n, f) => n + f.heads.filter((x) => x.headTypeId === h.id).length, 0)
        )
      ])
    )
  )

  // ───────── Per floor
  p.push('<h2>3. Floor designs</h2>')
  s.floors.forEach((f, fi) => {
    const input = design.floors.find((x) => x.id === f.floorId)
    p.push(
      `<section class="floor"><h2>3.${fi + 1} ${esc(f.floorName)} - ${esc(SYSTEM_LABEL[f.systemType])}</h2>`
    )
    p.push(
      `<p>Elevation ${num(input?.elevationM, 2)} m; ${f.heads.length} sprinklers; ${f.pipes.length} pipe segments; piping volume ${num(f.volumeGal, 0)} gal (${num(f.volumeGal * 3.78541, 0)} L); riser at (${num(f.riser.x, 0)}, ${num(f.riser.y, 0)}) mm; inspector's test at (${num(f.inspectorTest.x, 0)}, ${num(f.inspectorTest.y, 0)}) mm.</p>`
    )
    // zones: zone control valves, areas, heads, area vs the NFPA 13 §4.4 limit, governing remote area per zone
    p.push('<h3>Zones</h3>')
    p.push(
      table(
        [
          'Zone',
          'Name',
          'Zone control valve',
          'Areas',
          'Heads',
          'Area m²',
          'Area ft²',
          'Limit ft² (NFPA 13 §4.4)',
          'Area vs limit',
          'Governing at source',
          'Margin psi'
        ],
        f.zones.map((z) => [
          z.zoneId,
          z.name,
          z.controlValveTag,
          z.roomIds.map((id) => input?.rooms.find((x) => x.id === id)?.name ?? id).join(', '),
          String(z.headCount),
          num(z.areaM2, 0),
          num(z.areaFt2, 0),
          num(z.maxAreaFt2, 0),
          `${num((z.areaFt2 / Math.max(z.maxAreaFt2, 1)) * 100, 1)} % - ${z.areaFt2 <= z.maxAreaFt2 ? 'within limit' : 'EXCEEDS LIMIT'}`,
          z.governing
            ? `${num(z.governing.flowAtSourceGpm, 1)} gpm @ ${num(z.governing.pressureAtSourcePsi, 1)} psi (${HAZARD_DESIGN[z.governing.hazard]?.label ?? z.governing.hazard}, ${num(z.governing.densityGpmFt2, 2)} gpm/ft² over ${num(z.governing.designAreaFt2, 0)} ft²)`
            : '-',
          z.governing ? num(z.governing.marginPsi, 1) : '-'
        ])
      )
    )
    p.push(checksTable(f.zones.flatMap((z) => z.checks)))
    const g = f.governing
    p.push('<h3>Remote area</h3>')
    if (g) {
      p.push(
        table(
          [
            'Hazard',
            'Density gpm/ft²',
            'Base area ft²',
            'Design area ft²',
            'Heads flowing',
            'Heads / branch',
            'Min head flow gpm',
            'Remote head psi'
          ],
          [
            [
              HAZARD_DESIGN[g.hazard]?.label ?? g.hazard,
              num(g.densityGpmFt2, 3),
              num(g.baseAreaFt2, 0),
              num(g.designAreaFt2, 0),
              String(g.headsFlowing.length),
              String(g.headsPerBranch),
              num(g.minHeadFlowGpm, 1),
              num(g.remoteHeadPressurePsi, 1)
            ]
          ]
        )
      )
      p.push(
        table(
          [
            'At floor control',
            'At source',
            'Hose allowance gpm',
            'Total demand gpm',
            'Available psi',
            'Margin psi'
          ],
          [
            [
              `${num(g.flowAtFloorGpm, 1)} gpm @ ${num(g.pressureAtFloorPsi, 1)} psi`,
              `${num(g.flowAtSourceGpm, 1)} gpm @ ${num(g.pressureAtSourcePsi, 1)} psi`,
              num(g.hoseAllowanceGpm, 0),
              num(g.totalDemandGpm, 1),
              num(g.availablePsi, 1),
              num(g.marginPsi, 1)
            ]
          ]
        )
      )
      p.push(`<p class="note">Sprinklers flowing: ${esc(g.headsFlowing.join(', ') || '-')}</p>`)
      p.push(
        '<p class="note">Node-to-node worksheets of every zone follow (hydraulic calculation, NFPA 13-2019 §28.2, Hazen-Williams).</p>'
      )
      for (const z of f.zones) {
        const zg = z.governing
        p.push(
          `<h3>Hydraulic worksheet - Zone ${esc(z.zoneId)} ${esc(z.name)}${zg && zg === g ? ' (governing zone of the floor)' : ''}</h3>`
        )
        if (!zg) {
          p.push('<p>No remote area (no sprinklers in this zone).</p>')
          continue
        }
        p.push(
          `<p class="note">Remote area ${num(zg.designAreaFt2, 0)} ft² at ${num(zg.densityGpmFt2, 2)} gpm/ft², ${zg.headsFlowing.length} sprinklers flowing; at the zone control valve ${num(zg.flowAtFloorGpm, 1)} gpm @ ${num(zg.pressureAtFloorPsi, 1)} psi; at the source ${num(zg.flowAtSourceGpm, 1)} gpm @ ${num(zg.pressureAtSourcePsi, 1)} psi; hose ${num(zg.hoseAllowanceGpm, 0)} gpm; supply ${num(zg.availablePsi, 1)} psi at ${num(zg.totalDemandGpm, 1)} gpm; margin ${num(zg.marginPsi, 1)} psi; maximum velocity ${num(maxVelocityFps(zg), 1)} ft/s.</p>`
        )
        p.push(table(NODE_HEAD, nodeRows(zg), 'nodes'))
        const gm = buildHydraulicGraph(result, z)
        if (gm) {
          p.push(`<h3>N^1.85 hydraulic graph - Zone ${esc(z.zoneId)}</h3>`)
          p.push(graphSvg(gm))
          p.push(
            `<p class="note">Curve: ${esc(gm.supplyLabel)}. A = sprinkler demand ${num(gm.demand[0], 1)} gpm @ ${num(gm.demand[1], 1)} psi; B = demand incl. hose allowance ${num(gm.demandHose[0], 1)} gpm; C = supply ${num(gm.supplyAtDemand[1], 1)} psi at B; margin ${num(gm.marginPsi, 1)} psi (${gm.adequate ? 'adequate' : 'inadequate'}).</p>`
          )
        }
      }
    } else {
      p.push('<p>No remote area was calculated for this floor (no sprinklers).</p>')
    }
    p.push('<h3>Protected areas (rooms)</h3>')
    p.push(
      table(
        [
          'Area',
          'Name',
          'Source',
          'Zone',
          'Hazard',
          'Occupancy',
          'Area m²',
          'Heads',
          'Head type',
          'S x L mm',
          'Max spacing mm',
          'Max area ft²',
          'Checks'
        ],
        f.rooms.map((r) => {
          const occ = input?.rooms.find((x) => x.id === r.roomId)
          const worst = r.checks.some((c) => c.status === 'fail')
            ? 'FAIL'
            : r.checks.some((c) => c.status === 'warn')
              ? 'WARN'
              : 'PASS'
          return [
            r.roomId,
            r.name,
            occ?.source === 'drawn' ? 'Drawn by designer' : 'Detected from plan',
            occ?.zoneId ?? f.zones[0]?.zoneId ?? '-',
            HAZARD_DESIGN[r.hazard]?.label ?? r.hazard,
            occ
              ? occ.omit
                ? `omitted: ${occ.omitReason || 'no reason'}`
                : (SPRINKLER_OCCUPANCIES[occ.occupancy]?.label ?? occ.occupancy)
              : '-',
            num(r.areaM2, 1),
            String(r.headCount),
            r.headCount ? r.headTypeId : '-',
            r.headCount ? `${num(r.spacingSmm, 0)} x ${num(r.spacingLmm, 0)}` : '-',
            num(r.maxSpacingMm, 0),
            num(r.maxAreaFt2, 0),
            worst
          ]
        })
      )
    )
    p.push('<h3>Sprinklers</h3>')
    p.push(
      table(
        ['Tag', 'Room', 'Type', 'x mm', 'y mm', 'S x L mm', 'Area ft²', 'Wall dist. mm', 'Node'],
        f.heads.map((h) => [
          h.tag,
          h.roomId,
          headType(h.headTypeId)?.description ?? h.headTypeId,
          num(h.x, 0),
          num(h.y, 0),
          `${num(h.spacingSmm, 0)} x ${num(h.spacingLmm, 0)}`,
          num(h.areaFt2, 0),
          num(h.wallDistanceMm, 0),
          h.node
        ])
      )
    )
    p.push('<h3>Pipes</h3>')
    p.push(
      table(
        ['Pipe', 'Kind', 'Size in', 'Schedule', 'Length m', 'From', 'To', 'Heads downstream'],
        f.pipes.map((q) => [
          q.id,
          q.kind,
          num(q.sizeIn, 2),
          q.schedule,
          num(q.lengthM, 2),
          q.fromNode,
          q.toNode,
          String(q.sprinklersDownstream)
        ])
      )
    )
    p.push('<h3>Floor checks</h3>')
    p.push(checksTable(f.checks))
    p.push('</section>')
  })

  // ───────── Obstructions
  p.push('<h2>4. Obstructions to sprinkler discharge (NFPA 13-2019 §10.2.7)</h2>')
  const obstRows = s.floors.flatMap((f) =>
    f.obstructions.map((o) => [
      f.floorName,
      o.id,
      o.kind,
      `${num(o.widthMm, 0)} x ${num(o.lengthMm, 0)}`,
      num(o.bottomBelowCeilingMm, 0),
      RULE_LABEL[o.rule],
      num(o.requiredClearanceMm, 0),
      o.relocatedHeads.join(', ') || '-',
      o.headsBelow.join(', ') || '-',
      o.violations.length > 0 ? `NOT CLEARED: ${o.violations.join(', ')}` : 'Cleared'
    ])
  )
  if (obstRows.length === 0) p.push('<p>No obstructions were defined for this design.</p>')
  else
    p.push(
      table(
        [
          'Floor',
          'Id',
          'Kind',
          'Size mm',
          'Bottom below ceiling mm',
          'Rule',
          'Required clearance mm',
          'Sprinklers moved',
          'Sprinklers below',
          'Status'
        ],
        obstRows
      )
    )
  p.push(
    `<ul>
<li><b>Beam rule</b> (continuous obstructions: beams, ducts, cable trays, pipes): the distance from the sprinkler to the side of the obstruction must be at least the value of Table 10.2.7.1.2 for the height of the deflector above the bottom of the obstruction.</li>
<li><b>Three-times rule</b> (discrete obstructions: columns, lights): the sprinkler is at least three times the greatest dimension of the obstruction away from it.</li>
<li><b>Wide obstructions</b> (wider than 1219 mm / 4 ft, e.g. ducts): sprinklers are installed below the obstruction in addition to the ceiling sprinklers - the sprinklers below are listed above.</li>
<li><b>Deep beams</b> deeper than the beam table allows act as walls dividing the area into bays, each protected on its own.</li>
</ul>
<p class="note">The beam table is applied conservatively beyond 7.5 ft sprinkler spacing and for sidewall sprinklers. Ceiling sprinklers that violate a clearance are moved along their branch line within the spacing limits; verify the clause numbers against the edition adopted by the AHJ.</p>`
  )

  // ───────── Building summary
  p.push('<h2>5. Building summary</h2>')
  const gov = s.governing
  p.push(
    table(
      ['Item', 'Value'],
      [
        ['Floors', String(s.floors.length)],
        ['Total sprinklers', String(s.totalHeads)],
        ['Building riser', `${num(design.buildingRiserIn, 1)} in ${design.buildingRiserSchedule}`],
        [
          'Governing demand at source',
          gov ? `${num(gov.flowAtSourceGpm, 1)} gpm @ ${num(gov.pressureAtSourcePsi, 1)} psi` : '-'
        ],
        ['Hose allowance', gov ? `${num(gov.hoseAllowanceGpm, 0)} gpm` : '-'],
        [
          'Total demand incl. hose',
          gov
            ? `${num(gov.totalDemandGpm, 1)} gpm (${num(gov.totalDemandGpm * 3.78541, 0)} L/min)`
            : '-'
        ],
        ['Supply', answerText(design.answers, 'supply')],
        ['Margin at governing demand', gov ? `${num(gov.marginPsi, 1)} psi` : '-']
      ]
    )
  )
  p.push(
    table(
      [
        'Floor',
        'System',
        'Heads',
        'Hazard',
        'Flow @ source gpm',
        'Pressure @ source psi',
        'Margin psi'
      ],
      s.floors.map((f) => [
        f.floorName,
        SYSTEM_LABEL[f.systemType],
        String(f.heads.length),
        f.governing ? (HAZARD_DESIGN[f.governing.hazard]?.label ?? f.governing.hazard) : '-',
        num(f.governing?.flowAtSourceGpm, 1),
        num(f.governing?.pressureAtSourcePsi, 1),
        num(f.governing?.marginPsi, 1)
      ])
    )
  )

  p.push('<h2>6. Pipe sizing</h2>')
  p.push(
    `<p>${
      design.answers.pipeSizing === 'hydraulic'
        ? `Hydraulically calculated pipe sizes (NFPA 13-2019 Ch. 28): for every remote area the smallest sizes are chosen that keep at least ${num(design.answers.minSupplyMarginPsi ?? 10, 0)} psi margin below the water supply and velocities within 20 ft/s.`
        : 'Pipe schedule sizing (NFPA 13-2019 §28.5, maximum sprinklers per pipe size, see the limits in section 2), then hydraulically verified and upsized where the supply is short.'
    }</p>
<ul>
<li><b>Hydraulic vs pipe schedule:</b> the pipe schedule (§28.5) fixes the size from the number of sprinklers downstream and is limited to light and ordinary hazard; hydraulic calculation (Ch. 28) sizes each segment from the flow and the available supply and can give smaller pipe where the supply allows.</li>
<li><b>Velocity:</b> 20 ft/s (6.1 m/s) is the usual maximum velocity criterion - good practice to limit erosion, noise and water hammer; NFPA 13 itself sets no velocity limit.</li>
<li><b>Supply margin:</b> the margin is the supply pressure at the demand flow (sprinklers plus hose allowance) minus the pressure required at the source; it must be positive.</li>
</ul>`
  )
  p.push(
    table(
      ['Floor', 'Zone', 'Maximum velocity ft/s', 'Criterion 20 ft/s', 'Margin psi'],
      s.floors.flatMap((f) =>
        f.zones.map((z) => {
          const v = maxVelocityFps(z.governing)
          return [
            f.floorName,
            `${z.zoneId} ${z.name}`,
            num(v, 1),
            v <= 20 ? 'Met' : 'Exceeded',
            num(z.governing?.marginPsi, 1)
          ]
        })
      )
    )
  )
  p.push('<h3>Sprinkler types (designer-selected vs automatic)</h3>')
  p.push(
    table(
      [
        'Type id',
        'Description',
        'K',
        'Orientation',
        'Response',
        'Temperature / bulb',
        'Qty',
        'Selection',
        'Areas'
      ],
      s.headTypes.map((t) => {
        const areas = design.floors.flatMap((fl) =>
          fl.rooms
            .filter((r) =>
              s.floors.some((fd) =>
                fd.heads.some((h) => h.roomId === r.id && h.headTypeId === t.id)
              )
            )
            .map((r) => ({ r, designer: !!r.headSpec }))
        )
        const designer = areas.filter((a) => a.designer).length
        return [
          t.id,
          t.description,
          num(t.kFactor, 1),
          t.orientation === 'sidewall' ? 'Horizontal sidewall' : t.orientation,
          t.response,
          `${t.tempRatingF} °F (${t.tempClass}, ${t.bulbColor} bulb)`,
          String(
            s.floors.reduce((a, fd) => a + fd.heads.filter((h) => h.headTypeId === t.id).length, 0)
          ),
          designer === 0 ? 'Automatic' : designer === areas.length ? 'Designer-selected' : 'Mixed',
          areas.map((a) => `${a.r.name}${a.designer ? ' (designer)' : ' (auto)'}`).join(', ')
        ]
      })
    )
  )

  // ───────── Accessories, spares, BOM
  p.push('<h2>7. Accessories</h2>')
  p.push(
    table(
      ['Tag', 'Item', 'Qty', 'Size in', 'Location', 'System', 'Reference'],
      s.accessories.map((a) => [
        a.tag,
        a.item,
        String(a.qty),
        a.sizeIn === null ? '-' : num(a.sizeIn, 2),
        a.location,
        a.systemType,
        a.reference
      ])
    )
  )
  p.push('<h2>8. Spare sprinklers</h2>')
  p.push(
    table(
      ['Head type', 'Description', 'Spare qty'],
      s.spareHeads.map((h) => [
        h.headTypeId,
        headType(h.headTypeId)?.description ?? '-',
        String(h.qty)
      ])
    )
  )
  p.push(`<p class="note">Spare sprinkler cabinet with sprinkler wrench, NFPA 13-2019 §16.2.7.</p>`)
  p.push('<h2>9. Bill of materials</h2>')
  p.push(
    table(
      ['Item', 'Size', 'Qty', 'Unit'],
      s.bom.map((b) => [b.item, b.size, num(b.qty, b.unit === 'm' ? 1 : 0), b.unit])
    )
  )

  // ───────── Checks, out of scope
  p.push('<h2>10. Design checks</h2>')
  p.push(checksTable(s.checks))
  p.push('<h2>11. Out of scope</h2>')
  if (s.outOfScope.length === 0) p.push('<p>No out-of-scope items were declared.</p>')
  else p.push(`<ul>${s.outOfScope.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>`)

  // ───────── Sheets
  const sheet = (d: Drawing, label: string): void => {
    p.push(
      `<section class="sheet"><h2>${esc(label)}</h2>${renderSvg(d, { sheetIndex: 0, background: 'white' })}</section>`
    )
  }
  for (const f of drawings.floors) {
    const sh = f.drawing.sheets[0]
    sheet(
      f.drawing,
      `${sh?.number ?? 'FS'} - ${sh?.title ?? f.floorId} (${sh?.paper ?? 'A1'}, 1:${sh?.scale ?? '-'})`
    )
  }
  const rd = drawings.riserAndDetails.sheets[0]
  sheet(
    drawings.riserAndDetails,
    `${rd?.number ?? 'FS-501'} - ${rd?.title ?? 'Riser diagram and details'}`
  )
  drawings.hydraulics.sheets.forEach((hy, i) => {
    p.push(
      `<section class="sheet"><h2>${esc(`${hy.number} - ${hy.title}`)}</h2>${renderSvg(drawings.hydraulics, { sheetIndex: i, background: 'white' })}</section>`
    )
  })

  return wrap(title, p.join('\n'))
}

function wrap(title: string, body: string): string {
  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`
}
