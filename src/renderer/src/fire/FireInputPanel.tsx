import React, { useState } from 'react'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { useFireProtectionStore } from '../store/fireProtectionStore'
import type {
  FireDesignInput,
  HazardClass,
  PipeRun,
  PipeSchedule,
  PipeSpec,
  PumpArrangement,
  FirePumpType,
  StandpipeClass,
  TankMaterial,
  TankPlacement
} from '../engine/fireProtection/fpTypes'
import { NOMINAL_SIZES_IN, formatPipeSize } from '../engine/fireProtection/standards/pipeData'

const inputCls =
  'w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1 text-xs text-neutral-200 font-mono focus:outline-none focus:border-red-600'

const Label: React.FC<{ text: string; children: React.ReactNode; hint?: string }> = ({
  text,
  children,
  hint
}) => (
  <label className="flex flex-col gap-1 min-w-0">
    <span className="text-[9px] font-bold text-neutral-500 uppercase tracking-wide">{text}</span>
    {children}
    {hint && <span className="text-[9px] text-neutral-600">{hint}</span>}
  </label>
)

const TextField: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({
  label,
  value,
  onChange
}) => (
  <Label text={label}>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls}
    />
  </Label>
)

interface NumProps {
  label: string
  value: number | undefined
  onChange: (v: number | undefined) => void
  optional?: boolean
  placeholder?: string
  step?: number
  min?: number
  hint?: string
}

/** Numeric input that tolerates blank / partial text. Blank = undefined (optional) or keeps the previous value. */
const NumField: React.FC<NumProps> = ({
  label,
  value,
  onChange,
  optional,
  placeholder,
  step,
  min,
  hint
}) => {
  const [text, setText] = useState<string>(value === undefined ? '' : String(value))
  // Resync the text when the stored value changes from outside (e.g. Reset), without fighting in-progress typing.
  const [prev, setPrev] = useState(value)
  if (value !== prev) {
    setPrev(value)
    const blank = text.trim() === ''
    const parsed = blank ? undefined : parseFloat(text)
    if (parsed !== value && !(blank && !optional)) setText(value === undefined ? '' : String(value))
  }
  return (
    <Label text={label} hint={hint}>
      <input
        type="number"
        inputMode="decimal"
        value={text}
        step={step}
        min={min}
        placeholder={placeholder}
        onChange={(e) => {
          const t = e.target.value
          setText(t)
          if (t.trim() === '') {
            if (optional) onChange(undefined)
            return
          }
          const n = parseFloat(t)
          if (Number.isFinite(n)) onChange(n)
        }}
        onBlur={() => {
          if (text.trim() === '' && !optional) setText(value === undefined ? '' : String(value))
        }}
        className={inputCls}
      />
    </Label>
  )
}

function Select<T extends string | number>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <Label text={label}>
      <select
        value={String(value)}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value)
          if (opt) onChange(opt.value)
        }}
        className={inputCls}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </Label>
  )
}

const Check: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void }> = ({
  label,
  value,
  onChange
}) => (
  <label className="flex items-center gap-2 text-[11px] text-neutral-300 cursor-pointer col-span-2">
    <input
      type="checkbox"
      checked={value}
      onChange={(e) => onChange(e.target.checked)}
      className="accent-red-600"
    />
    {label}
  </label>
)

const Section: React.FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode }> = ({
  title,
  defaultOpen,
  children
}) => {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div className="bg-neutral-900 border border-neutral-850 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-4 py-3 text-xs font-bold text-neutral-300 uppercase tracking-wider cursor-pointer hover:bg-neutral-850"
      >
        {open ? (
          <ChevronDown size={14} className="text-red-500" />
        ) : (
          <ChevronRight size={14} className="text-neutral-500" />
        )}
        {title}
      </button>
      {open && <div className="px-4 pb-4 grid grid-cols-2 gap-3">{children}</div>}
    </div>
  )
}

const HAZARDS: { value: HazardClass; label: string }[] = [
  { value: 'light', label: 'Light Hazard' },
  { value: 'ordinary-1', label: 'Ordinary Hazard Group 1' },
  { value: 'ordinary-2', label: 'Ordinary Hazard Group 2' },
  { value: 'extra-1', label: 'Extra Hazard Group 1' },
  { value: 'extra-2', label: 'Extra Hazard Group 2' }
]
const K_OPTIONS = [5.6, 8.0, 11.2, 14.0, 16.8, 25.2].map((k) => ({
  value: k,
  label: `K = ${k.toFixed(1)}`
}))
const SIZE_OPTIONS = NOMINAL_SIZES_IN.filter((s) => s >= 1).map((s) => ({
  value: s as number,
  label: formatPipeSize(s)
}))
const SCHED_OPTIONS: { value: PipeSchedule; label: string }[] = [
  { value: 'sch40', label: 'Schedule 40' },
  { value: 'sch10', label: 'Schedule 10' }
]
const STANDPIPE: { value: StandpipeClass; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'I', label: 'Class I (65 mm hose valves)' },
  { value: 'II', label: 'Class II (40 mm hose station)' },
  { value: 'III', label: 'Class III (combined)' }
]
const ARRANGEMENTS: { value: PumpArrangement; label: string }[] = [
  { value: 'electric+diesel', label: 'Electric duty + Diesel standby' },
  { value: 'electric+electric', label: 'Electric duty + Electric standby' },
  { value: 'diesel+diesel', label: 'Diesel + Diesel' },
  { value: 'electric-only', label: 'Electric only' },
  { value: 'diesel-only', label: 'Diesel only' }
]
const PUMP_TYPES: { value: FirePumpType | 'auto'; label: string }[] = [
  { value: 'auto', label: 'Auto-select' },
  { value: 'horizontal-split-case', label: 'Horizontal split-case' },
  { value: 'end-suction', label: 'End suction' },
  { value: 'vertical-inline', label: 'Vertical in-line' },
  { value: 'vertical-turbine', label: 'Vertical turbine' }
]
const TANK_MATERIALS: { value: TankMaterial; label: string }[] = [
  { value: 'reinforced-concrete', label: 'Reinforced concrete' },
  { value: 'grp-sectional', label: 'GRP sectional' },
  { value: 'steel-bolted', label: 'Bolted steel' }
]
const TANK_PLACEMENTS: { value: TankPlacement; label: string }[] = [
  { value: 'underground', label: 'Underground' },
  { value: 'ground', label: 'Ground level' },
  { value: 'elevated-roof', label: 'Elevated / roof' }
]

const PipeFields: React.FC<{ title: string; pipe: PipeSpec; onChange: (p: PipeSpec) => void }> = ({
  title,
  pipe,
  onChange
}) => (
  <>
    <div className="col-span-2 text-[10px] font-bold text-orange-500 uppercase">{title}</div>
    <Select
      label="Size"
      value={pipe.nominalIn}
      options={SIZE_OPTIONS}
      onChange={(v) => onChange({ ...pipe, nominalIn: v })}
    />
    <Select
      label="Schedule"
      value={pipe.schedule}
      options={SCHED_OPTIONS}
      onChange={(v) => onChange({ ...pipe, schedule: v })}
    />
    <NumField
      label="Hazen-Williams C"
      value={pipe.c}
      onChange={(v) => v !== undefined && onChange({ ...pipe, c: v })}
    />
  </>
)

const RunFields: React.FC<{
  title: string
  run: PipeRun
  showRise: boolean
  onChange: (r: PipeRun) => void
}> = ({ title, run, showRise, onChange }) => (
  <>
    <div className="col-span-2 text-[10px] font-bold text-orange-500 uppercase">{title}</div>
    <NumField
      label="Length (ft)"
      value={run.lengthFt}
      min={0}
      onChange={(v) => v !== undefined && onChange({ ...run, lengthFt: v })}
    />
    {showRise && (
      <NumField
        label="Rise (ft)"
        value={run.elevationRiseFt}
        onChange={(v) => v !== undefined && onChange({ ...run, elevationRiseFt: v })}
      />
    )}
  </>
)

export const FireInputPanel: React.FC = () => {
  const { input, setInput, reset } = useFireProtectionStore()
  const set = (p: Partial<FireDesignInput>): void => setInput(p)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-neutral-300 uppercase tracking-wider">
          Design Inputs
        </span>
        <button
          onClick={reset}
          className="flex items-center gap-1 text-[10px] font-bold text-neutral-400 hover:text-red-400 cursor-pointer"
        >
          <RotateCcw size={12} /> Reset
        </button>
      </div>

      <Section title="Project" defaultOpen>
        <div className="col-span-2">
          <TextField
            label="Project name"
            value={input.projectName}
            onChange={(v) => set({ projectName: v })}
          />
        </div>
        <TextField
          label="Project no."
          value={input.projectNumber}
          onChange={(v) => set({ projectNumber: v })}
        />
        <TextField label="Designer" value={input.designer} onChange={(v) => set({ designer: v })} />
      </Section>

      <Section title="Sprinkler (NFPA 13)" defaultOpen>
        <div className="col-span-2">
          <Select
            label="Hazard classification"
            value={input.hazard}
            options={HAZARDS}
            onChange={(v) => set({ hazard: v })}
          />
        </div>
        <Select
          label="K-factor"
          value={input.sprinklerK}
          options={K_OPTIONS}
          onChange={(v) => set({ sprinklerK: v })}
        />
        <NumField
          label="Coverage (ft²)"
          optional
          placeholder="NFPA max"
          value={input.sprinklerCoverageFt2}
          onChange={(v) => set({ sprinklerCoverageFt2: v })}
        />
        <NumField
          label="Density (gpm/ft²)"
          optional
          step={0.01}
          placeholder="NFPA default"
          value={input.densityGpmFt2}
          onChange={(v) => set({ densityGpmFt2: v })}
        />
        <NumField
          label="Design area (ft²)"
          optional
          placeholder="NFPA default"
          value={input.designAreaFt2}
          onChange={(v) => set({ designAreaFt2: v })}
        />
        <PipeFields
          title="Branch lines"
          pipe={input.branchLinePipe}
          onChange={(p) => set({ branchLinePipe: p })}
        />
        <PipeFields
          title="Cross main"
          pipe={input.crossMainPipe}
          onChange={(p) => set({ crossMainPipe: p })}
        />
      </Section>

      <Section title="Riser & Feed Main">
        <RunFields title="Riser" run={input.riser} showRise onChange={(r) => set({ riser: r })} />
        <PipeFields
          title="Riser pipe"
          pipe={input.riser.pipe}
          onChange={(p) => set({ riser: { ...input.riser, pipe: p } })}
        />
        <RunFields
          title="Feed main"
          run={input.feedMain}
          showRise={false}
          onChange={(r) => set({ feedMain: r })}
        />
        <PipeFields
          title="Feed main pipe"
          pipe={input.feedMain.pipe}
          onChange={(p) => set({ feedMain: { ...input.feedMain, pipe: p } })}
        />
      </Section>

      <Section title="Hose Allowance & Duration">
        <NumField
          label="Inside hose (gpm)"
          value={input.insideHoseGpm}
          min={0}
          onChange={(v) => v !== undefined && set({ insideHoseGpm: v })}
        />
        <NumField
          label="Hose total (gpm)"
          optional
          placeholder="NFPA table"
          value={input.totalHoseAllowanceGpm}
          onChange={(v) => set({ totalHoseAllowanceGpm: v })}
        />
        <NumField
          label="Duration (min)"
          optional
          placeholder="NFPA upper"
          value={input.durationMin}
          onChange={(v) => set({ durationMin: v })}
        />
      </Section>

      <Section title="Standpipe (NFPA 14)">
        <div className="col-span-2">
          <Select
            label="Class"
            value={input.standpipeClass}
            options={STANDPIPE}
            onChange={(v) => set({ standpipeClass: v })}
          />
        </div>
        <NumField
          label="Standpipes (no.)"
          value={input.standpipeCount}
          min={1}
          step={1}
          onChange={(v) => v !== undefined && set({ standpipeCount: Math.round(v) })}
        />
        <NumField
          label="Top outlet height (ft)"
          value={input.standpipeTopOutletHeightFt}
          onChange={(v) => v !== undefined && set({ standpipeTopOutletHeightFt: v })}
        />
        <NumField
          label="Friction loss (psi)"
          value={input.standpipeFrictionPsi}
          onChange={(v) => v !== undefined && set({ standpipeFrictionPsi: v })}
        />
        <Check
          label="Building fully sprinklered"
          value={input.buildingSprinklered}
          onChange={(v) => set({ buildingSprinklered: v })}
        />
      </Section>

      <Section title="Pump Set (NFPA 20)">
        <div className="col-span-2">
          <Select
            label="Arrangement"
            value={input.arrangement}
            options={ARRANGEMENTS}
            onChange={(v) => set({ arrangement: v })}
          />
        </div>
        <div className="col-span-2">
          <Select
            label="Pump type"
            value={input.pumpTypePreference}
            options={PUMP_TYPES}
            onChange={(v) => set({ pumpTypePreference: v })}
          />
        </div>
        <Select
          label="Component rating"
          value={input.systemComponentRatingPsi}
          options={[
            { value: 175, label: '175 psi (12 bar)' },
            { value: 300, label: '300 psi (20 bar)' }
          ]}
          onChange={(v) => set({ systemComponentRatingPsi: v })}
        />
        <NumField
          label="Site elevation (ft)"
          value={input.siteElevationFt}
          onChange={(v) => v !== undefined && set({ siteElevationFt: v })}
        />
        <NumField
          label="Ambient (°F)"
          value={input.ambientTempF}
          onChange={(v) => v !== undefined && set({ ambientTempF: v })}
        />
      </Section>

      <Section title="Water Tank (NFPA 22)">
        <Select
          label="Material"
          value={input.tankMaterial}
          options={TANK_MATERIALS}
          onChange={(v) => set({ tankMaterial: v })}
        />
        <Select
          label="Placement"
          value={input.tankPlacement}
          options={TANK_PLACEMENTS}
          onChange={(v) => set({ tankPlacement: v })}
        />
        <NumField
          label="Effective depth (m)"
          step={0.1}
          value={input.tankEffectiveDepthM}
          onChange={(v) => v !== undefined && set({ tankEffectiveDepthM: v })}
        />
        <NumField
          label="Tank floor to pump CL (m)"
          step={0.1}
          value={input.tankFloorToPumpCLm}
          onChange={(v) => v !== undefined && set({ tankFloorToPumpCLm: v })}
        />
        <NumField
          label="Refill flow (gpm)"
          value={input.refillFlowGpm}
          min={0}
          onChange={(v) => v !== undefined && set({ refillFlowGpm: v })}
        />
        <Check
          label="Two compartments (independent suction)"
          value={input.twoCompartments}
          onChange={(v) => set({ twoCompartments: v })}
        />
      </Section>
    </div>
  )
}
