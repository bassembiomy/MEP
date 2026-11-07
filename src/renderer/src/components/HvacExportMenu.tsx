import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, ShieldCheck } from 'lucide-react'
import { useProjectStore } from '../store/projectStore'
import { useBimStore } from '../store/bimStore'
import { useFireProtectionStore } from '../store/fireProtectionStore'
import {
  buildHvacModel,
  hvacSheetDxf,
  hvacSheetFile,
  saveIfc,
  saveLinkDwg,
  saveLinkDxf,
  saveVerificationReport,
  type HvacSheetKey
} from '../fire/bimExports'
import { downloadText, safeFileName } from '../fire/download'
import { exportDwgFromApp } from '../fire/dwgExport'

const ITEM =
  'flex items-center gap-1.5 w-full text-left px-3 py-1.5 rounded-lg text-[11px] font-bold text-neutral-200 hover:bg-neutral-800 cursor-pointer disabled:opacity-50'

const FIELD =
  'bg-neutral-950 border border-neutral-800 rounded-md px-2 py-1 text-xs text-neutral-200 font-mono focus:outline-none focus:border-blue-600'

/** HVAC "Export" menu: shop drawings, IFC for Revit, link DXF/DWG and the verification report (files built on click). */
export const HvacExportMenu: React.FC = () => {
  const zones = useProjectStore((s) => s.zones)
  const project = useProjectStore((s) => s.project)
  const storey = useBimStore((s) => s.hvacStorey)
  const setStorey = useBimStore((s) => s.setHvacStorey)
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const empty = zones.length === 0
  const base = safeFileName(project.name)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const meta = (): { n: string; d: string } => {
    const i = useFireProtectionStore.getState().input
    return { n: i.projectNumber ?? '', d: i.designer ?? '' }
  }
  const run = async (fn: () => unknown): Promise<void> => {
    try {
      const r = (await fn()) as { ok: boolean; message: string } | undefined
      setMsg(r ? { ok: r.ok, text: r.message } : { ok: true, text: 'File created.' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }
  const sheetDxf = (w: HvacSheetKey): void => {
    const { n, d } = meta()
    downloadText(
      hvacSheetFile(project, w, 'dxf'),
      hvacSheetDxf(zones, project, w, n, d),
      'application/dxf'
    )
  }
  const sheetDwg = (w: HvacSheetKey): Promise<{ ok: boolean; message: string }> => {
    const { n, d } = meta()
    return exportDwgFromApp(hvacSheetDxf(zones, project, w, n, d), hvacSheetFile(project, w, 'dwg'))
  }
  const model = (): ReturnType<typeof buildHvacModel> =>
    buildHvacModel(zones, project, storey, meta().n)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-neutral-900 text-neutral-200 border border-neutral-800 hover:bg-neutral-850 cursor-pointer"
      >
        <Download size={14} /> Export / BIM <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-30 w-80 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-3 flex flex-col gap-1">
          {empty && (
            <div className="text-[11px] text-amber-300 px-2 pb-1">
              Draw at least one zone to enable the exports.
            </div>
          )}
          <div className="text-[9px] font-bold text-neutral-500 uppercase px-2 pt-1">
            Shop drawings
          </div>
          <button disabled={empty} className={ITEM} onClick={() => run(() => sheetDxf('plan'))}>
            M-101 duct layout plan - DXF
          </button>
          <button disabled={empty} className={ITEM} onClick={() => run(() => sheetDwg('plan'))}>
            M-101 duct layout plan - DWG
          </button>
          <button
            disabled={empty}
            className={ITEM}
            onClick={() => run(() => sheetDxf('schedules'))}
          >
            M-601 schedules - DXF
          </button>
          <button
            disabled={empty}
            className={ITEM}
            onClick={() => run(() => sheetDwg('schedules'))}
          >
            M-601 schedules - DWG
          </button>
          <div className="text-[9px] font-bold text-neutral-500 uppercase px-2 pt-2">
            Revit (storey)
          </div>
          <div className="grid grid-cols-3 gap-2 px-2 pb-1">
            <label className="flex flex-col gap-0.5 text-[9px] text-neutral-500 uppercase">
              Id
              <input
                className={FIELD}
                value={storey.id}
                onChange={(e) => setStorey({ id: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[9px] text-neutral-500 uppercase">
              Name
              <input
                className={FIELD}
                value={storey.name}
                onChange={(e) => setStorey({ name: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[9px] text-neutral-500 uppercase">
              FFL mm
              <input
                type="number"
                className={FIELD}
                value={storey.elevationMm}
                onChange={(e) => setStorey({ elevationMm: parseFloat(e.target.value) || 0 })}
              />
            </label>
          </div>
          <button
            disabled={empty}
            className={ITEM}
            onClick={() => run(() => saveIfc(model(), `${base}_HVAC.ifc`))}
          >
            HVAC IFC (Link IFC in Revit)
          </button>
          <button
            disabled={empty}
            className={ITEM}
            onClick={() =>
              run(() =>
                saveLinkDxf(model(), storey.id.trim() || 'L1', `${base}_HVAC_${storey.id}_link.dxf`)
              )
            }
          >
            HVAC link DXF (Link CAD)
          </button>
          <button
            disabled={empty}
            className={ITEM}
            onClick={() =>
              run(() =>
                saveLinkDwg(model(), storey.id.trim() || 'L1', `${base}_HVAC_${storey.id}_link.dwg`)
              )
            }
          >
            HVAC link DWG
          </button>
          <div className="text-[9px] font-bold text-neutral-500 uppercase px-2 pt-2">Checks</div>
          <button
            disabled={empty}
            className={ITEM}
            onClick={() =>
              run(() => {
                const s = saveVerificationReport({
                  hvac: { zones, project },
                  bim: model(),
                  fileBase: `${project.name}_HVAC`
                })
                return {
                  ok: s.fail === 0,
                  message: `Verification report saved: ${s.fail} fail, ${s.warn} warn of ${s.total}.`
                }
              })
            }
          >
            <ShieldCheck size={12} /> Verification report (HTML)
          </button>
          {msg && (
            <div
              className={`mt-1 text-[10px] rounded-lg px-2 py-1.5 border ${msg.ok ? 'border-emerald-800 text-emerald-300 bg-emerald-950/30' : 'border-amber-800 text-amber-200 bg-amber-950/30'}`}
            >
              {msg.text}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
