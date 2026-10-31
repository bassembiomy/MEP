import React from 'react'
import {
  AlertTriangle,
  BarChart3,
  ClipboardCheck,
  Cylinder,
  DraftingCompass,
  FileText,
  Flame,
  Droplets,
  Warehouse
} from 'lucide-react'
import { useFireProtectionStore, type FireView } from '../store/fireProtectionStore'
import { FireInputPanel } from './FireInputPanel'
import { DrawingPreview } from './DrawingPreview'
import {
  ChecksPanel,
  HydraulicCalcPanel,
  PumpRoomPanel,
  PumpsPanel,
  ReportPanel,
  StatusChip,
  TankPanel
} from './FireResultsPanels'
import { gpmToLpm, psiToBar } from '../engine/fireProtection/hydraulics'

const TABS: { id: FireView; label: string; icon: React.ReactNode }[] = [
  { id: 'drawings', label: 'Drawings', icon: <DraftingCompass size={14} /> },
  { id: 'calc', label: 'Hydraulic Calc', icon: <Droplets size={14} /> },
  { id: 'pumps', label: 'Pumps', icon: <Cylinder size={14} /> },
  { id: 'tank', label: 'Tank & Sump', icon: <Warehouse size={14} /> },
  { id: 'room', label: 'Pump Room', icon: <BarChart3 size={14} /> },
  { id: 'checks', label: 'Checks', icon: <ClipboardCheck size={14} /> },
  { id: 'report', label: 'Report', icon: <FileText size={14} /> }
]

const Stat: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode }> = ({
  label,
  value,
  sub
}) => (
  <div className="flex flex-col min-w-0">
    <span className="text-[9px] font-bold text-neutral-500 uppercase">{label}</span>
    <span className="text-sm font-bold text-neutral-100 font-mono">{value}</span>
    {sub && <span className="text-[10px] text-neutral-500 font-mono">{sub}</span>}
  </div>
)

export const FireWorkspace: React.FC = () => {
  const { result, error, activeView, setActiveView } = useFireProtectionStore()

  const header =
    result &&
    (() => {
      const main = result.pumps.mainPumps[0]
      const failing = result.checks.filter((c) => c.status === 'fail').length
      const warns = result.checks.filter((c) => c.status === 'warn').length
      const overall = failing > 0 ? 'fail' : warns > 0 ? 'warn' : 'pass'
      const t = result.tank
      return (
        <div className="bg-neutral-900 border border-neutral-850 rounded-2xl p-5 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4 shadow-xl">
          <Stat
            label="Pump rated"
            value={`${main.ratedFlowGpm.toFixed(0)} gpm @ ${main.ratedNetPressurePsi.toFixed(0)} psi`}
            sub={`${gpmToLpm(main.ratedFlowGpm).toFixed(0)} L/min @ ${psiToBar(main.ratedNetPressurePsi).toFixed(1)} bar`}
          />
          <Stat
            label="Driver HP"
            value={result.pumps.mainPumps.map((p) => `${p.driverHp.toFixed(0)} HP`).join(' + ')}
            sub={result.pumps.mainPumps.map((p) => p.driver).join(' + ')}
          />
          <Stat
            label="Jockey"
            value={`${result.pumps.jockey.motorHp.toFixed(1)} HP`}
            sub={`${result.pumps.jockey.ratedFlowGpm.toFixed(0)} gpm`}
          />
          <Stat
            label="Tank"
            value={`${t.providedEffectiveM3.toFixed(0)} m³`}
            sub={`${t.internalLengthM.toFixed(1)} x ${t.internalWidthM.toFixed(1)} x ${t.totalInternalHeightM.toFixed(1)} m`}
          />
          <Stat
            label="Pump room"
            value={`${(result.room.lengthMm / 1000).toFixed(1)} x ${(result.room.widthMm / 1000).toFixed(1)} m`}
            sub={`H ${(result.room.clearHeightMm / 1000).toFixed(1)} m`}
          />
          <Stat label="Overall" value={<StatusChip status={overall} />} />
          <Stat
            label="Failing / warnings"
            value={`${failing} / ${warns}`}
            sub={`of ${result.checks.length} checks`}
          />
        </div>
      )
    })()

  return (
    <main className="relative z-10 flex-1 grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6 p-6">
      <aside className="flex flex-col gap-3">
        <FireInputPanel />
      </aside>
      <div className="flex flex-col gap-5 min-w-0">
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <Flame size={16} className="text-red-500" />
          <span className="font-bold uppercase tracking-wider text-neutral-300">
            Fire Pump Room & Water Tank Design
          </span>
        </div>
        {error && (
          <div className="flex items-start gap-2 bg-red-950/40 border border-red-800/60 text-red-300 text-xs rounded-2xl px-4 py-3">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>
              <strong>Design error:</strong> {error}
              {result && ' - showing the last valid design.'}
            </span>
          </div>
        )}
        {header}
        {result && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-neutral-850 pb-2">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveView(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    activeView === t.id
                      ? 'bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-lg shadow-red-500/20'
                      : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-850'
                  }`}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
            {activeView === 'drawings' && <DrawingPreview />}
            {activeView === 'calc' && <HydraulicCalcPanel result={result} />}
            {activeView === 'pumps' && <PumpsPanel result={result} />}
            {activeView === 'tank' && <TankPanel result={result} />}
            {activeView === 'room' && <PumpRoomPanel result={result} />}
            {activeView === 'checks' && <ChecksPanel result={result} />}
            {activeView === 'report' && <ReportPanel result={result} />}
          </>
        )}
        {!result && !error && <div className="text-xs text-neutral-500">Computing...</div>}
      </div>
    </main>
  )
}
