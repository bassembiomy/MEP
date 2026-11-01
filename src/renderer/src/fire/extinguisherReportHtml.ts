/** Self-contained, printable HTML for the NFPA 10 portable fire extinguisher design (report + FP-108/FP-109 sheets). */
import type {
  ExtinguisherSystemDesign,
  ExtinguisherUnitType,
  FireDesignResult,
  PlacedExtinguisher
} from '../engine/fireProtection/fpTypes'
import type { Drawing } from '../engine/fireProtection/drawing/drawingTypes'
import { renderSvg } from '../engine/fireProtection/drawing/svgRenderer'
import { buildExtinguisherReport } from '../engine/fireProtection/report'

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const f1 = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '-' : n.toFixed(1)

/** Sheets that belong to the extinguisher package: FP-108* layout pages and FP-109. */
export function extinguisherSheetNumbers(drawing: Drawing): string[] {
  return drawing.sheets.map((s) => s.number).filter((n) => n.startsWith('FP-108') || n === 'FP-109')
}

interface ReportSection {
  title: string
  lines: string[]
}

const isRule = (l: string): boolean => /^\s*[=\-─━_*]{5,}\s*$/.test(l)

/** Split the plain-text report into titled sections (title lines are framed or underlined by rules). */
export function splitReportSections(text: string): ReportSection[] {
  const lines = text.replace(/\r/g, '').split('\n')
  const sections: ReportSection[] = []
  let cur: ReportSection = { title: '', lines: [] }
  const push = (): void => {
    if (cur.title || cur.lines.some((l) => l.trim())) sections.push(cur)
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    // framed title: rule / title / rule
    if (
      isRule(l) &&
      i + 2 < lines.length &&
      lines[i + 1].trim() &&
      !isRule(lines[i + 1]) &&
      isRule(lines[i + 2])
    ) {
      push()
      cur = { title: lines[i + 1].trim(), lines: [] }
      i += 2
      continue
    }
    // underlined title: title / rule
    if (
      !isRule(l) &&
      l.trim() &&
      i + 1 < lines.length &&
      isRule(lines[i + 1]) &&
      l.trim().length < 90
    ) {
      push()
      cur = { title: l.trim(), lines: [] }
      i += 1
      continue
    }
    cur.lines.push(l)
  }
  push()
  return sections
}

function unitOf(catalog: ExtinguisherUnitType[], id: string): ExtinguisherUnitType | undefined {
  return catalog.find((u) => u.id === id)
}

function table(head: string[], rows: string[][], cls = ''): string {
  return (
    `<table class="${cls}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
    rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') +
    `</tbody></table>`
  )
}

export function floorName(result: FireDesignResult, floorId: string): string {
  return result.input.building?.floors.find((fl) => fl.id === floorId)?.name ?? floorId
}

export function scheduleRows(
  fe: ExtinguisherSystemDesign
): (PlacedExtinguisher & { zoneName: string; unit?: ExtinguisherUnitType })[] {
  return fe.zones.flatMap((z) =>
    z.extinguishers.map((e) => ({ ...e, zoneName: z.zoneName, unit: unitOf(fe.catalog, e.unitId) }))
  )
}

const CSS = `
:root{--fg:#1a1a1a;--mut:#555;--line:#c9c9c9;--acc:#b91c1c}
*{box-sizing:border-box}
body{font-family:Segoe UI,Helvetica,Arial,sans-serif;color:var(--fg);margin:0;padding:24px;background:#fff;line-height:1.4;font-size:12px}
h1{font-size:22px;margin:0 0 4px;color:var(--acc)}
h2{font-size:15px;margin:22px 0 6px;border-bottom:2px solid var(--acc);padding-bottom:3px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:4px 24px;border:1px solid var(--line);padding:10px 12px;margin:10px 0 4px}
.meta b{display:block;font-size:9px;text-transform:uppercase;color:var(--mut)}
table{border-collapse:collapse;width:100%;margin:6px 0;font-size:11px}
th,td{border:1px solid var(--line);padding:3px 6px;text-align:left;vertical-align:top}
th{background:#f1f1f1;font-size:10px;text-transform:uppercase}
pre{background:#fafafa;border:1px solid var(--line);padding:8px 10px;overflow-x:auto;font-size:10.5px;line-height:1.3;white-space:pre-wrap;word-break:break-word}
.sheet{margin-top:24px;page-break-before:always;break-before:page}
.sheet h2{margin-top:0}
.sheet svg{width:100%;height:auto;border:1px solid var(--line);display:block}
.pass{color:#047857;font-weight:700}.warn{color:#b45309;font-weight:700}.fail{color:#b91c1c;font-weight:700}
@page{size:A3 landscape;margin:10mm}
@media print{body{padding:0}.sheet{page-break-after:always}pre{font-size:9px}h2{page-break-after:avoid}table{page-break-inside:auto}tr{page-break-inside:avoid}}
`

export function buildExtinguisherReportHtml(
  result: FireDesignResult,
  drawing: Drawing | null
): string {
  const fe = result.extinguishers
  const inp = result.input
  const title = `Portable Fire Extinguishers (NFPA 10) - ${inp.projectName}`
  const parts: string[] = []
  parts.push(`<h1>${esc(title)}</h1>`)
  parts.push(
    `<div class="meta">` +
      [
        ['Project', inp.projectName],
        ['Project no.', inp.projectNumber],
        ['Designer', inp.designer],
        ['Date', new Date().toISOString().slice(0, 10)],
        ['Standard', 'NFPA 10 - Portable Fire Extinguishers']
      ]
        .map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`)
        .join('') +
      `</div>`
  )

  if (!fe) {
    parts.push('<p>No extinguisher design is defined for this project.</p>')
  } else {
    parts.push('<h2>Totals</h2>')
    parts.push(
      table(
        ['Unit', 'Description', 'Rating', 'Qty'],
        [
          ...fe.totals.map((t) => [t.unitId, t.label, t.ratingText, String(t.qty)]),
          ['', 'TOTAL', '', String(fe.totalCount)]
        ]
      )
    )
    parts.push('<h2>Zone summary</h2>')
    parts.push(
      table(
        [
          'Zone',
          'Floor',
          'Hazard',
          'Area ft²',
          'Selected',
          'Qty',
          'Grid',
          'Travel ft (actual / allowed)',
          'K',
          'D'
        ],
        fe.zones.map((z) => [
          z.zoneName,
          floorName(result, z.floorId),
          z.hazard,
          f1(z.areaFt2),
          z.selectedUnitId ?? '-',
          String(z.count),
          `${z.grid.nx} x ${z.grid.ny}`,
          `${f1(z.maxTravelActualFt)} / ${f1(z.maxTravelFt)}`,
          String(z.kUnits),
          String(z.dUnits)
        ])
      )
    )
    parts.push('<h2>Extinguisher schedule</h2>')
    parts.push(
      table(
        [
          'Tag',
          'Floor',
          'Zone',
          'Unit',
          'Rating',
          'Agent',
          'Purpose',
          'Mounting',
          'Top mm',
          'Bottom mm'
        ],
        scheduleRows(fe).map((e) => [
          e.tag,
          floorName(result, e.floorId),
          e.zoneName,
          e.unitId,
          e.unit?.ratingText ?? '-',
          e.unit?.agent ?? '-',
          e.purpose,
          e.mounting,
          String(e.mountingTopMm),
          String(e.bottomClearanceMm)
        ])
      )
    )
    parts.push('<h2>System checks</h2>')
    const allChecks = [...fe.checks, ...fe.zones.flatMap((z) => z.checks)]
    parts.push(
      `<table><thead><tr><th>Status</th><th>Check</th><th>Reference</th><th>Detail</th></tr></thead><tbody>` +
        allChecks
          .map(
            (c) =>
              `<tr><td class="${esc(c.status)}">${esc(c.status.toUpperCase())}</td><td>${esc(c.title)}</td><td>${esc(c.reference)}</td><td>${esc(c.detail)}</td></tr>`
          )
          .join('') +
        `</tbody></table>`
    )

    // Narrative report sections (calculation, specifications, maintenance ...) as readable blocks.
    let text = ''
    try {
      text = buildExtinguisherReport(result)
    } catch {
      text = ''
    }
    for (const s of splitReportSections(text)) {
      if (!s.lines.some((l) => l.trim()) && !s.title) continue
      parts.push(`<h2>${esc(s.title || 'Report')}</h2>`)
      parts.push(`<pre>${esc(s.lines.join('\n').replace(/^\n+|\n+$/g, ''))}</pre>`)
    }

    if (drawing) {
      drawing.sheets.forEach((s, idx) => {
        if (!(s.number.startsWith('FP-108') || s.number === 'FP-109')) return
        parts.push(
          `<section class="sheet"><h2>${esc(s.number)} - ${esc(s.title)} (${esc(s.paper)}, 1:${esc(s.scale)})</h2>${renderSvg(drawing, { sheetIndex: idx, background: 'white' })}</section>`
        )
      })
    }
  }

  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>${parts.join('\n')}</body></html>`
}
