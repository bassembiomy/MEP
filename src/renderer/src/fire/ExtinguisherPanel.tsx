import React, { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import type {
  DesignCheck,
  ExtinguisherUnitType,
  FireDesignResult
} from '../engine/fireProtection/fpTypes'
import { buildExtinguisherReport } from '../engine/fireProtection/report'
import { writeDxf } from '../engine/fireProtection/drawing/dxfWriter'
import { subsetDrawing } from '../engine/fireProtection/drawing/subsetDrawing'
import { useFireProtectionStore } from '../store/fireProtectionStore'
import { StatusChip } from './FireResultsPanels'
import {
  buildExtinguisherReportHtml,
  extinguisherSheetNumbers,
  floorName,
  scheduleRows
} from './extinguisherReportHtml'
import { downloadText, safeFileName } from './download'
import { exportDwgFromApp, type DwgExportStatus } from './dwgExport'

const HAZARD_LABEL = {
  light: 'Light (Low) Hazard',
  ordinary: 'Ordinary (Moderate) Hazard',
  extra: 'Extra (High) Hazard'
} as const

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-neutral-900 border border-neutral-850 p-5 rounded-2xl flex flex-col gap-3 shadow-xl">
    <div className="text-xs font-bold text-neutral-300 uppercase tracking-wider">{title}</div>
    {children}
  </div>
)

const Tbl: React.FC<{
  head: string[]
  rows: React.ReactNode[][]
  rowCls?: (i: number) => string
}> = ({ head, rows, rowCls }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-[11px]">
      <thead>
        <tr className="border-b border-neutral-800 text-neutral-500 uppercase text-[9px] tracking-wide">
          {head.map((h) => (
            <th key={h} className="py-1.5 px-2 font-bold whitespace-nowrap">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={`border-b border-neutral-850 ${rowCls ? rowCls(i) : ''}`}>
            {r.map((c, j) => (
              <td key={j} className="py-1.5 px-2 font-mono text-neutral-300 whitespace-nowrap">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

const f1 = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '-' : n.toFixed(1)

const ChecksList: React.FC<{ checks: DesignCheck[] }> = ({ checks }) => (
  <div className="flex flex-col divide-y divide-neutral-850">
    {checks.map((c) => (
      <div key={c.id} className="py-2 flex gap-3 items-start">
        <div className="w-16 shrink-0 pt-0.5">
          <StatusChip status={c.status} />
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="text-xs font-semibold text-neutral-200">{c.title}</div>
          <div className="text-[10px] text-orange-400/80 font-mono">{c.reference}</div>
          <div className="text-[11px] text-neutral-400 leading-relaxed">{c.detail}</div>
        </div>
      </div>
    ))}
  </div>
)

const btnCls = 'flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer'

export const ExtinguisherPanel: React.FC<{ result: FireDesignResult }> = ({ result }) => {
  const drawing = useFireProtectionStore((s) => s.drawing)
  const [dwg, setDwg] = useState<DwgExportStatus | null>(null)
  const fe = result.extinguishers
  const rows = useMemo(() => (fe ? scheduleRows(fe) : []), [fe])

  if (!fe) {
    return (
      <Card title="Portable fire extinguishers (NFPA 10)">
        <div className="text-xs text-neutral-400">
          No extinguisher design yet. Open the <strong>FIRE EXTINGUISHERS (NFPA 10)</strong> section
          in the Design Inputs column and tick <em>Enable portable fire extinguishers</em>.
        </div>
      </Card>
    )
  }

  const base = safeFileName(result.input.projectName)
  const catalogOf = (id: string): ExtinguisherUnitType | undefined =>
    fe.catalog.find((u) => u.id === id)

  const exportTxt = (): void =>
    downloadText(`FP_${base}_extinguishers.txt`, buildExtinguisherReport(result))
  const exportHtml = (): void =>
    downloadText(
      `FP_${base}_extinguishers.html`,
      buildExtinguisherReportHtml(result, drawing),
      'text/html'
    )
  const exportDxf = (): void => {
    if (!drawing) return
    const nums = extinguisherSheetNumbers(drawing)
    if (nums.length === 0) return
    downloadText(
      `FP_Extinguishers_${base}.dxf`,
      writeDxf(subsetDrawing(drawing, nums)),
      'application/dxf'
    )
  }

  const exportDwg = async (): Promise<void> => {
    if (!drawing) return
    const nums = extinguisherSheetNumbers(drawing)
    if (nums.length === 0) return
    setDwg({ ok: true, message: 'Converting to DWG...' })
    setDwg(
      await exportDwgFromApp(writeDxf(subsetDrawing(drawing, nums)), `FP_Extinguishers_${base}.dwg`)
    )
  }

  const unitCard = (label: string, value: React.ReactNode, sub?: string): React.ReactElement => (
    <div
      key={label}
      className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 min-w-[150px] flex flex-col"
    >
      <span className="text-[9px] font-bold text-neutral-500 uppercase">{label}</span>
      <span className="text-lg font-bold font-mono text-neutral-100">{value}</span>
      {sub && <span className="text-[10px] text-neutral-500 font-mono">{sub}</span>}
    </div>
  )

  return (
    <div className="flex flex-col gap-5">
      <Card title="Extinguisher totals">
        <div className="flex flex-wrap gap-3">
          {unitCard('Total extinguishers', fe.totalCount, `${fe.zones.length} zones`)}
          {fe.totals.map((t) => unitCard(t.unitId, t.qty, `${t.ratingText} · ${t.label}`))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={exportTxt}
            className={`${btnCls} bg-neutral-950 border border-neutral-800 text-neutral-300 hover:text-red-400`}
          >
            <Download size={13} /> Extinguisher report (.txt)
          </button>
          <button
            onClick={exportHtml}
            className={`${btnCls} bg-neutral-950 border border-neutral-800 text-neutral-300 hover:text-red-400`}
          >
            <Download size={13} /> Extinguisher report (HTML, printable)
          </button>
          <button
            onClick={exportDxf}
            disabled={!drawing}
            className={`${btnCls} bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-lg shadow-red-500/20`}
          >
            <Download size={13} /> Extinguisher drawings (.dxf)
          </button>
          <button
            onClick={exportDwg}
            disabled={!drawing}
            className={`${btnCls} bg-neutral-100 text-neutral-900 hover:bg-white`}
          >
            <Download size={13} /> Extinguisher drawings (.dwg)
          </button>
        </div>
        {dwg && (
          <div
            className={`mt-3 text-[11px] rounded-lg px-3 py-2 border ${dwg.ok ? 'border-emerald-800 text-emerald-300 bg-emerald-950/30' : 'border-amber-800 text-amber-200 bg-amber-950/30'}`}
          >
            {dwg.message}
          </div>
        )}
      </Card>

      {fe.zones.map((z) => {
        const sel = z.selectedUnitId ? catalogOf(z.selectedUnitId) : undefined
        const ok = z.maxTravelActualFt <= z.maxTravelFt + 1e-6
        return (
          <Card
            key={z.zoneId}
            title={`${z.zoneId} · ${z.zoneName} · ${floorName(result, z.floorId)}`}
          >
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[repeat(2,minmax(0,1fr)_auto)] gap-x-6 gap-y-1.5 text-xs">
              {(
                [
                  ['Hazard', HAZARD_LABEL[z.hazard]],
                  [
                    'Area',
                    `${f1(z.areaFt2)} ft² (${f1(z.areaFt2 * 0.09290304)} m²) = ${f1(z.lengthFt)} × ${f1(z.widthFt)} ft`
                  ],
                  [
                    'Class A requirement',
                    z.minARating === null
                      ? 'not applicable'
                      : `≥ ${z.minARating}-A, ${z.areaPerAFt2} ft² per A`
                  ],
                  [
                    'Area per unit',
                    z.maxAreaPerUnitFt2 === null
                      ? '-'
                      : `${f1(z.maxAreaPerUnitFt2)} ft² (max 11 250)`
                  ],
                  ['Class B requirement', z.bRequirement ?? 'not applicable'],
                  ['Selected unit', sel ? `${sel.id} · ${sel.ratingText} · ${sel.capacity}` : '-'],
                  ['General units', `${z.count} in a ${z.grid.nx} × ${z.grid.ny} grid`],
                  [
                    'Travel actual / allowed',
                    <span key="t" className={ok ? 'text-emerald-400' : 'text-red-400'}>
                      {f1(z.maxTravelActualFt)} ft / {f1(z.maxTravelFt)} ft
                    </span>
                  ],
                  ['Class K units', String(z.kUnits)],
                  ['Class D units', String(z.dUnits)]
                ] as [string, React.ReactNode][]
              ).map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt className="text-neutral-500">{k}</dt>
                  <dd className="text-neutral-200 font-mono text-right">{v}</dd>
                </React.Fragment>
              ))}
            </dl>
            {z.candidates.length > 0 && (
              <Tbl
                head={['Candidate', 'Rating', 'Capacity', 'Count', 'Grid', 'Max travel ft']}
                rowCls={(i) =>
                  z.candidates[i].unitId === z.selectedUnitId
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : ''
                }
                rows={z.candidates.map((c) => {
                  const u = catalogOf(c.unitId)
                  return [
                    c.unitId + (c.unitId === z.selectedUnitId ? '  ✓' : ''),
                    u?.ratingText ?? '-',
                    u?.capacity ?? '-',
                    String(c.count),
                    `${c.nx} × ${c.ny}`,
                    f1(c.maxTravelFt)
                  ]
                })}
              />
            )}
            {z.notes.length > 0 && (
              <ul className="list-disc pl-5 text-[11px] text-neutral-400 flex flex-col gap-0.5">
                {z.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            {z.checks.length > 0 && <ChecksList checks={z.checks} />}
          </Card>
        )
      })}

      <Card title={`Extinguisher schedule (${rows.length})`}>
        <Tbl
          head={[
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
          ]}
          rows={rows.map((e) => [
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
          ])}
        />
      </Card>

      <Card title="System checks">
        {fe.floorsMissing.length > 0 && (
          <div className="text-[11px] text-amber-400">
            Floors without extinguishers: {fe.floorsMissing.join(', ')}
          </div>
        )}
        <ChecksList checks={fe.checks} />
      </Card>
    </div>
  )
}
