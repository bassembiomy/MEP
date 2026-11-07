import React, { useMemo, useState } from 'react'
import { Download, ShieldCheck, Box, Info } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { FireDesignResult } from '../engine/fireProtection/fpTypes'
import type { FireBimPlacement, BimModel } from '../engine/bim/bimTypes'
import { fireBimModel } from '../engine/bim/fireBim'
import { mergeBimModels, detectClashes } from '../engine/bim/bimModel'
import { useFireProtectionStore } from '../store/fireProtectionStore'
import { useProjectStore } from '../store/projectStore'
import { useBimStore } from '../store/bimStore'
import {
  buildHvacModel,
  hvacSheetDxf,
  hvacSheetFile,
  saveIfc,
  saveLinkDwg,
  saveLinkDxf,
  saveVerificationReport,
  type HvacSheetKey
} from './bimExports'
import { downloadText, safeFileName } from './download'
import { exportDwgFromApp, type DwgExportStatus } from './dwgExport'

const CLASH_TOLERANCE_MM = 25
const CLASH_LIST_MAX = 60

const FIELD =
  'w-full bg-neutral-950 border border-neutral-800 rounded-md px-2 py-1 text-xs text-neutral-200 font-mono focus:outline-none focus:border-red-600'
const BTN =
  'flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
const BTN_PRIMARY = `${BTN} bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-lg shadow-red-500/20`
const BTN_DARK = `${BTN} bg-neutral-800 text-neutral-200 hover:bg-neutral-700`
const BTN_LIGHT = `${BTN} bg-neutral-100 text-neutral-900 hover:bg-white`

const Card: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({
  title,
  children,
  className = ''
}) => (
  <div
    className={`bg-neutral-900 border border-neutral-850 p-5 rounded-2xl flex flex-col gap-3 shadow-xl ${className}`}
  >
    <div className="text-xs font-bold text-neutral-300 uppercase tracking-wider">{title}</div>
    {children}
  </div>
)

const Lbl: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-0.5 text-[9px] font-bold text-neutral-500 uppercase min-w-0">
    {label}
    {children}
  </label>
)

const NumField: React.FC<{ value: number | undefined; onChange: (v: number) => void }> = ({
  value,
  onChange
}) => (
  <input
    type="number"
    step={100}
    className={FIELD}
    value={value ?? 0}
    onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
  />
)

function countBy<T>(items: T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>()
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

const ModelSummary: React.FC<{ model: BimModel; title: string }> = ({ model, title }) => {
  const classes = useMemo(() => countBy(model.elements, (e) => e.ifcClass), [model])
  return (
    <Card title={title}>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs font-mono text-neutral-200">
        <span>
          <b>{model.storeys.length}</b> storeys
        </span>
        <span>
          <b>{model.systems.length}</b> systems
        </span>
        <span>
          <b>{model.elements.length}</b> elements
        </span>
        <span>
          <b>{model.warnings.length}</b> warnings
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 text-[11px] font-mono">
        {classes.map(([c, n]) => (
          <div key={c} className="flex justify-between border-b border-neutral-850 py-0.5">
            <span className="text-neutral-400">{c}</span>
            <span className="text-neutral-200">{n}</span>
          </div>
        ))}
      </div>
      {model.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-[11px] text-amber-200 bg-amber-950/30 border border-amber-800/60 rounded-lg px-3 py-2 list-disc list-inside max-h-40 overflow-y-auto">
          {model.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </Card>
  )
}

const ClashList: React.FC<{ model: BimModel; title: string }> = ({ model, title }) => {
  const clashes = useMemo(() => detectClashes(model, { toleranceMm: CLASH_TOLERANCE_MM }), [model])
  return (
    <Card title={`${title} (${clashes.length})`}>
      {clashes.length === 0 ? (
        <div className="text-[11px] text-emerald-300">
          No clashes within {CLASH_TOLERANCE_MM} mm clearance.
        </div>
      ) : (
        <div className="overflow-auto max-h-64">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="text-left text-neutral-500 text-[9px] uppercase">
                <th className="py-1 pr-3">Element A</th>
                <th className="pr-3">Element B</th>
                <th className="pr-3">Storey</th>
                <th className="text-right">Clearance mm</th>
              </tr>
            </thead>
            <tbody>
              {clashes.slice(0, CLASH_LIST_MAX).map((c, i) => (
                <tr key={i} className="border-t border-neutral-850 text-neutral-300">
                  <td className="py-0.5 pr-3">{c.a}</td>
                  <td className="pr-3">{c.b}</td>
                  <td className="pr-3">{c.storeyId}</td>
                  <td
                    className={`text-right ${c.clearanceMm < 0 ? 'text-red-400' : 'text-amber-300'}`}
                  >
                    {c.clearanceMm.toFixed(0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {clashes.length > CLASH_LIST_MAX && (
            <div className="text-[10px] text-neutral-500 pt-1">
              Showing the first {CLASH_LIST_MAX} of {clashes.length}.
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export const BimPanel: React.FC<{ result: FireDesignResult }> = ({ result }) => {
  const { input, setBimPlacement } = useFireProtectionStore(
    useShallow((s) => ({ input: s.input, setBimPlacement: s.setBimPlacement }))
  )
  const zones = useProjectStore((s) => s.zones)
  const project = useProjectStore((s) => s.project)
  const hvacStorey = useBimStore((s) => s.hvacStorey)
  const setHvacStorey = useBimStore((s) => s.setHvacStorey)
  const placement = useMemo<FireBimPlacement>(() => input.bimPlacement ?? {}, [input.bimPlacement])

  const [status, setStatus] = useState<DwgExportStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [fireStorey, setFireStorey] = useState('')
  const [reportNote, setReportNote] = useState<string | null>(null)

  const fireModel = useMemo(() => fireBimModel(result, placement), [result, placement])
  const hasHvac = zones.length > 0
  // an HVAC storey with the id of a fire storey takes that floor's level, so both disciplines share one Revit level
  const hvacStoreyEff = useMemo(() => {
    const id = hvacStorey.id.trim() || 'L1'
    const fs = fireModel.storeys.find((s) => s.id === id)
    return fs ? { ...hvacStorey, id, name: fs.name, elevationMm: fs.elevationMm } : hvacStorey
  }, [hvacStorey, fireModel])
  const hvacModel = useMemo(
    () => (hasHvac ? buildHvacModel(zones, project, hvacStoreyEff, input.projectNumber) : null),
    [hasHvac, zones, project, hvacStoreyEff, input.projectNumber]
  )
  const merged = useMemo(
    () => (hvacModel ? mergeBimModels([fireModel, hvacModel], 'MEP') : null),
    [fireModel, hvacModel]
  )

  const base = safeFileName(input.projectName)
  const storeys = fireModel.storeys
  const linkStorey = storeys.some((s) => s.id === fireStorey) ? fireStorey : (storeys[0]?.id ?? '')
  const hvacId = hvacStorey.id.trim() || 'L1'

  const room = placement.pumpRoom ?? {
    x: 0,
    y: 0,
    floorId: storeys[0]?.id ?? '',
    rotationDeg: 0
  }
  const patch = (p: Partial<FireBimPlacement>): void => setBimPlacement({ ...placement, ...p })
  const risers = result.standpipe?.risers.map((r) => r.tag) ?? []
  const zonesEx = result.extinguishers?.zones ?? []

  const dwg = async (p: Promise<DwgExportStatus>): Promise<void> => {
    setBusy(true)
    setStatus({ ok: true, message: 'Converting to DWG...' })
    setStatus(await p)
    setBusy(false)
  }
  const sheetDxf = (w: HvacSheetKey): string =>
    hvacSheetDxf(zones, project, w, input.projectNumber, input.designer)

  return (
    <div className="flex flex-col gap-5">
      <Card title="Placement in the building (mm, architectural plan coordinates)">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Lbl label="Pump room X">
            <NumField value={room.x} onChange={(x) => patch({ pumpRoom: { ...room, x } })} />
          </Lbl>
          <Lbl label="Pump room Y">
            <NumField value={room.y} onChange={(y) => patch({ pumpRoom: { ...room, y } })} />
          </Lbl>
          <Lbl label="Pump room floor">
            <select
              className={FIELD}
              value={room.floorId}
              onChange={(e) => patch({ pumpRoom: { ...room, floorId: e.target.value } })}
            >
              {storeys.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.id})
                </option>
              ))}
            </select>
          </Lbl>
          <Lbl label="Rotation">
            <select
              className={FIELD}
              value={room.rotationDeg}
              onChange={(e) =>
                patch({ pumpRoom: { ...room, rotationDeg: parseInt(e.target.value, 10) } })
              }
            >
              {[0, 90, 180, 270].map((d) => (
                <option key={d} value={d}>
                  {d}°
                </option>
              ))}
            </select>
          </Lbl>
        </div>
        {risers.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-[9px] font-bold text-neutral-500 uppercase">
              Standpipe risers (plan position)
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {risers.map((tag) => {
                const p = placement.standpipes?.[tag] ?? { x: 0, y: 0 }
                const set = (n: { x: number; y: number }): void =>
                  patch({ standpipes: { ...placement.standpipes, [tag]: n } })
                return (
                  <React.Fragment key={tag}>
                    <Lbl label={`${tag} X`}>
                      <NumField value={p.x} onChange={(x) => set({ ...p, x })} />
                    </Lbl>
                    <Lbl label={`${tag} Y`}>
                      <NumField value={p.y} onChange={(y) => set({ ...p, y })} />
                    </Lbl>
                  </React.Fragment>
                )
              })}
            </div>
          </div>
        )}
        {zonesEx.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-[9px] font-bold text-neutral-500 uppercase">
              Extinguisher zone origins (lower-left corner)
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {zonesEx.map((z) => {
                const p = placement.extinguisherZones?.[z.zoneId] ?? { x: 0, y: 0 }
                const set = (n: { x: number; y: number }): void =>
                  patch({ extinguisherZones: { ...placement.extinguisherZones, [z.zoneId]: n } })
                return (
                  <React.Fragment key={z.zoneId}>
                    <Lbl label={`${z.zoneId} ${z.zoneName} X`}>
                      <NumField value={p.x} onChange={(x) => set({ ...p, x })} />
                    </Lbl>
                    <Lbl label={`${z.zoneId} Y`}>
                      <NumField value={p.y} onChange={(y) => set({ ...p, y })} />
                    </Lbl>
                  </React.Fragment>
                )
              })}
            </div>
          </div>
        )}
        <div className="text-[10px] text-neutral-500">
          Items without a position are placed schematically and reported in the model warnings.
        </div>
      </Card>

      <ModelSummary model={fireModel} title="Fire protection BIM model" />
      <ClashList model={fireModel} title="Fire model clashes" />
      {merged && (
        <>
          <ModelSummary model={merged} title="Combined MEP model (fire + HVAC)" />
          <ClashList model={merged} title="Fire + HVAC clashes" />
        </>
      )}

      <Card title="Downloads">
        <div className="flex flex-col gap-2">
          <div className="text-[9px] font-bold text-neutral-500 uppercase">IFC models</div>
          <div className="flex flex-wrap gap-2">
            <button className={BTN_PRIMARY} onClick={() => saveIfc(fireModel, `${base}_FIRE.ifc`)}>
              <Download size={13} /> Fire IFC
            </button>
            <button
              className={BTN_DARK}
              disabled={!hvacModel}
              title={hvacModel ? '' : 'Draw HVAC zones first'}
              onClick={() => hvacModel && saveIfc(hvacModel, `${base}_HVAC.ifc`)}
            >
              <Download size={13} /> HVAC IFC
            </button>
            <button
              className={BTN_DARK}
              disabled={!merged}
              title={merged ? '' : 'Draw HVAC zones first'}
              onClick={() => merged && saveIfc(merged, `${base}_MEP.ifc`)}
            >
              <Download size={13} /> Combined MEP IFC
            </button>
          </div>

          <div className="text-[9px] font-bold text-neutral-500 uppercase pt-2">
            Link DXF / DWG (plan at architectural coordinates)
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-neutral-400">Fire storey</span>
            <select
              className={`${FIELD} !w-auto`}
              value={linkStorey}
              onChange={(e) => setFireStorey(e.target.value)}
            >
              {storeys.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.id})
                </option>
              ))}
            </select>
            <button
              className={BTN_DARK}
              onClick={() =>
                saveLinkDxf(fireModel, linkStorey, `${base}_FIRE_${linkStorey}_link.dxf`)
              }
            >
              <Download size={13} /> Fire DXF
            </button>
            <button
              className={BTN_LIGHT}
              disabled={busy}
              onClick={() =>
                dwg(saveLinkDwg(fireModel, linkStorey, `${base}_FIRE_${linkStorey}_link.dwg`))
              }
            >
              <Download size={13} /> Fire DWG
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-neutral-400">HVAC storey {hvacId}</span>
            <button
              className={BTN_DARK}
              disabled={!hvacModel}
              onClick={() =>
                hvacModel && saveLinkDxf(hvacModel, hvacId, `${base}_HVAC_${hvacId}_link.dxf`)
              }
            >
              <Download size={13} /> HVAC DXF
            </button>
            <button
              className={BTN_LIGHT}
              disabled={!hvacModel || busy}
              onClick={() =>
                hvacModel && dwg(saveLinkDwg(hvacModel, hvacId, `${base}_HVAC_${hvacId}_link.dwg`))
              }
            >
              <Download size={13} /> HVAC DWG
            </button>
          </div>

          <div className="text-[9px] font-bold text-neutral-500 uppercase pt-2">
            HVAC shop drawings
          </div>
          <div className="flex flex-wrap gap-2">
            {(['plan', 'schedules'] as const).map((w) => (
              <React.Fragment key={w}>
                <button
                  className={BTN_DARK}
                  disabled={!hasHvac}
                  onClick={() =>
                    downloadText(hvacSheetFile(project, w, 'dxf'), sheetDxf(w), 'application/dxf')
                  }
                >
                  <Download size={13} /> {w === 'plan' ? 'M-101' : 'M-601'} DXF
                </button>
                <button
                  className={BTN_LIGHT}
                  disabled={!hasHvac || busy}
                  onClick={() =>
                    dwg(exportDwgFromApp(sheetDxf(w), hvacSheetFile(project, w, 'dwg')))
                  }
                >
                  <Download size={13} /> {w === 'plan' ? 'M-101' : 'M-601'} DWG
                </button>
              </React.Fragment>
            ))}
          </div>

          <div className="text-[9px] font-bold text-neutral-500 uppercase pt-2">Verification</div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={BTN_PRIMARY}
              onClick={() => {
                const s = saveVerificationReport({
                  fire: result,
                  hvac: hasHvac ? { zones, project } : undefined,
                  bim: merged ?? fireModel,
                  fileBase: input.projectName
                })
                setReportNote(`${s.fail} fail, ${s.warn} warn of ${s.total} items`)
              }}
            >
              <ShieldCheck size={13} /> Verification report (HTML)
            </button>
            {reportNote && <span className="text-[11px] text-neutral-400">{reportNote}</span>}
          </div>
          {status && (
            <div
              className={`text-[11px] rounded-lg px-3 py-2 border ${status.ok ? 'border-emerald-800 text-emerald-300 bg-emerald-950/30' : 'border-amber-800 text-amber-200 bg-amber-950/30'}`}
            >
              {status.message}
            </div>
          )}
        </div>
      </Card>

      <Card title="HVAC storey (to merge with the fire storeys)">
        <div className="grid grid-cols-3 gap-3 max-w-xl">
          <Lbl label="Storey id">
            <input
              className={FIELD}
              value={hvacStorey.id}
              onChange={(e) => setHvacStorey({ id: e.target.value })}
            />
          </Lbl>
          <Lbl label="Name">
            <input
              className={FIELD}
              value={hvacStorey.name}
              onChange={(e) => setHvacStorey({ name: e.target.value })}
            />
          </Lbl>
          <Lbl label="FFL elevation mm">
            <NumField
              value={hvacStorey.elevationMm}
              onChange={(v) => setHvacStorey({ elevationMm: v })}
            />
          </Lbl>
        </div>
        <div className="text-[10px] text-neutral-500">
          {hasHvac
            ? `${zones.length} HVAC zone(s) drawn. When the id matches a fire storey (e.g. ${storeys[0]?.id ?? 'L1'}) the HVAC model uses that floor's name and level (${hvacStoreyEff.elevationMm} mm), so both disciplines share one Revit level.`
            : 'No HVAC zones drawn yet - the HVAC and combined downloads are disabled.'}
        </div>
      </Card>

      <Card title="How to link in Revit">
        <div className="flex items-start gap-2 text-[11px] text-neutral-300 leading-relaxed">
          <Info size={14} className="shrink-0 mt-0.5 text-sky-400" />
          <ol className="list-decimal list-inside flex flex-col gap-1">
            <li>
              <b>3D model:</b> Insert ▸ Link IFC, choose the .ifc file. Revit creates a linked{' '}
              <code className="text-neutral-100">.ifc.RVT</code> next to it.
            </li>
            <li>
              <b>Plan underlay:</b> Insert ▸ Link CAD, select the link DXF, Positioning{' '}
              <b>Auto - Origin to Origin</b>, Import units <b>Millimeter</b>, and leave{' '}
              <b>Current view only</b> off when you want it in 3D views.
            </li>
            <li>
              The link DXFs are at the architectural plan&apos;s coordinates, so they overlay it
              without moving. Set the same project origin as the architect.
            </li>
          </ol>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
          <Box size={12} /> IFC4 - units millimetre - z up from ground floor FFL (±0.000).
        </div>
      </Card>
    </div>
  )
}
