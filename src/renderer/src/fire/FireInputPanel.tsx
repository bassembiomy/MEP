import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useFireProtectionStore } from '../store/fireProtectionStore'
import { useShallow } from 'zustand/react/shallow'
import type {
  BuildingInput,
  FireDesignInput,
  ExtinguisherHazard,
  ExtinguisherZoneInput,
  FloorLevel,
  StandpipeDesignInput,
  StandpipeLocation,
  StandpipeSystemType,
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
import { DEFAULT_FIRE_INPUT } from '../engine/fireProtection/defaults'
import { generateExtinguisherZonesFromFloors } from '../engine/fireProtection/extinguisherDesigner'
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
const TANK_ACCESS: { value: 'top' | 'side'; label: string }[] = [
  { value: 'top', label: 'Top manholes' },
  { value: 'side', label: 'Side manways' }
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

// ───────────────────────── Building & standpipe design ─────────────────────────

const cellCls =
  'w-full bg-neutral-950 border border-neutral-800 rounded px-1.5 py-0.5 text-[10px] text-neutral-200 font-mono focus:outline-none focus:border-red-600'

/** Compact numeric table cell; tolerates blank / partial text (blank keeps the previous value). */
const NumCell: React.FC<{
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  width?: string
}> = ({ value, onChange, step, min, width }) => {
  const [text, setText] = useState(String(value))
  const [prev, setPrev] = useState(value)
  if (value !== prev) {
    setPrev(value)
    if (parseFloat(text) !== value && text.trim() !== '') setText(String(value))
  }
  return (
    <input
      type="number"
      inputMode="decimal"
      value={text}
      step={step}
      min={min}
      style={{ width }}
      onChange={(e) => {
        const t = e.target.value
        setText(t)
        const n = parseFloat(t)
        if (t.trim() !== '' && Number.isFinite(n)) onChange(n)
      }}
      onBlur={() => {
        if (text.trim() === '' || !Number.isFinite(parseFloat(text))) setText(String(value))
      }}
      className={cellCls}
    />
  )
}

const TextCell: React.FC<{ value: string; onChange: (v: string) => void; width?: string }> = ({
  value,
  onChange,
  width
}) => (
  <input
    type="text"
    value={value}
    style={{ width }}
    onChange={(e) => onChange(e.target.value)}
    className={cellCls}
  />
)

const MiniTable: React.FC<{ head: string[]; children: React.ReactNode }> = ({ head, children }) => (
  <div className="col-span-2 overflow-x-auto">
    <table className="w-full text-left">
      <thead>
        <tr className="text-[8px] font-bold text-neutral-500 uppercase tracking-wide">
          {head.map((h, i) => (
            <th key={i} className="px-1 py-1 whitespace-nowrap">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
)

const IconBtn: React.FC<{
  title: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}> = ({ title, onClick, disabled, children }) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    disabled={disabled}
    onClick={onClick}
    className="p-0.5 rounded text-neutral-500 hover:text-red-400 disabled:opacity-30 disabled:hover:text-neutral-500 cursor-pointer disabled:cursor-default"
  >
    {children}
  </button>
)

const round3 = (v: number): number => Math.round(v * 1000) / 1000

/** Rebuild the level elevations from floor-to-floor heights, anchored at the ground floor (the level nearest 0.000). */
function recalcLevels(floors: FloorLevel[]): FloorLevel[] {
  if (floors.length === 0) return floors
  let a = 0
  floors.forEach((fl, i) => {
    if (Math.abs(fl.elevationM) < Math.abs(floors[a].elevationM)) a = i
  })
  const el = floors.map((fl) => fl.elevationM)
  for (let i = a + 1; i < floors.length; i++)
    el[i] = round3(el[i - 1] + floors[i - 1].floorToFloorM)
  for (let i = a - 1; i >= 0; i--) el[i] = round3(el[i + 1] - floors[i].floorToFloorM)
  return floors.map((fl, i) => ({ ...fl, elevationM: el[i] }))
}

interface GenParams {
  basements: number
  basementH: number
  groundH: number
  upper: number
  typicalH: number
}

function generateFloors(g: GenParams, prev: FloorLevel[]): FloorLevel[] {
  const area = prev.find((x) => x.isRoof)?.areaM2 ?? prev[0]?.areaM2 ?? 1000
  const make = (
    id: string,
    name: string,
    elevationM: number,
    floorToFloorM: number,
    usage: string,
    isRoof = false
  ): FloorLevel => ({
    id,
    name,
    elevationM: round3(elevationM),
    floorToFloorM,
    usage,
    areaM2: area,
    sprinklered: !isRoof,
    hoseConnection: !isRoof,
    isRoof
  })
  const out: FloorLevel[] = []
  for (let k = g.basements; k >= 1; k--)
    out.push(make(`B${k}`, `Basement ${k}`, -k * g.basementH, g.basementH, 'Parking / Plant'))
  out.push(make('GF', 'Ground Floor', 0, g.groundH, 'Lobby / Retail'))
  for (let n = 1; n <= g.upper; n++)
    out.push(make(`L${n}`, `Level ${n}`, g.groundH + (n - 1) * g.typicalH, g.typicalH, 'Office'))
  out.push(make('RF', 'Roof', g.groundH + g.upper * g.typicalH, 0, 'Roof', true))
  return out
}

function genFromFloors(floors: FloorLevel[]): GenParams {
  const nonRoof = floors.filter((x) => !x.isRoof)
  const base = nonRoof.filter((x) => x.elevationM < -1e-6)
  const above = nonRoof.filter((x) => x.elevationM > 1e-6)
  const gf = nonRoof.find((x) => Math.abs(x.elevationM) < 1e-6)
  return {
    basements: base.length,
    basementH: base.length ? base[base.length - 1].floorToFloorM : 4,
    groundH: gf?.floorToFloorM ?? 4.5,
    upper: above.length,
    typicalH: above.length ? above[above.length - 1].floorToFloorM : 3.6
  }
}

const FloorGenerator: React.FC<{
  floors: FloorLevel[]
  onGenerate: (f: FloorLevel[]) => void
}> = ({ floors, onGenerate }) => {
  const [g, setG] = useState<GenParams>(() => genFromFloors(floors))
  const upd = (p: Partial<GenParams>): void => setG({ ...g, ...p })
  return (
    <>
      <div className="col-span-2 text-[10px] font-bold text-orange-500 uppercase">
        Floor generator
      </div>
      <NumField
        label="Basements (no.)"
        value={g.basements}
        min={0}
        step={1}
        onChange={(v) => v !== undefined && upd({ basements: Math.max(0, Math.round(v)) })}
      />
      <NumField
        label="Basement height (m)"
        value={g.basementH}
        min={0.5}
        step={0.1}
        onChange={(v) => v !== undefined && v > 0 && upd({ basementH: v })}
      />
      <NumField
        label="Ground floor height (m)"
        value={g.groundH}
        min={0.5}
        step={0.1}
        onChange={(v) => v !== undefined && v > 0 && upd({ groundH: v })}
      />
      <NumField
        label="Upper floors (no.)"
        value={g.upper}
        min={0}
        step={1}
        onChange={(v) =>
          v !== undefined && upd({ upper: Math.max(0, Math.min(200, Math.round(v))) })
        }
      />
      <NumField
        label="Typical floor height (m)"
        value={g.typicalH}
        min={0.5}
        step={0.1}
        onChange={(v) => v !== undefined && v > 0 && upd({ typicalH: v })}
      />
      <div className="flex items-end">
        <button
          type="button"
          onClick={() => onGenerate(generateFloors(g, floors))}
          className="w-full px-2 py-1 rounded-lg bg-red-600/90 hover:bg-red-600 text-white text-[10px] font-bold cursor-pointer"
        >
          Regenerate floors
        </button>
      </div>
    </>
  )
}

const BuildingSection: React.FC<{
  building: BuildingInput
  onChange: (b: BuildingInput) => void
}> = ({ building, onChange }) => {
  const floors = building.floors
  const setFloors = (f: FloorLevel[]): void => onChange({ ...building, floors: f })
  const patch = (i: number, p: Partial<FloorLevel>): void =>
    setFloors(floors.map((fl, k) => (k === i ? { ...fl, ...p } : fl)))
  const uniqueId = (): string => {
    let n = floors.length + 1
    while (floors.some((x) => x.id === `F${n}`)) n++
    return `F${n}`
  }
  const newFloor = (elevationM: number): FloorLevel => ({
    id: uniqueId(),
    name: 'New floor',
    elevationM,
    floorToFloorM: 3.6,
    usage: 'Office',
    areaM2: floors.find((x) => !x.isRoof)?.areaM2 ?? 1000,
    sprinklered: true,
    hoseConnection: true,
    isRoof: false
  })
  const addAbove = (i: number): void => {
    const f = floors[i]
    const next = [...floors]
    next.splice(i + 1, 0, newFloor(round3(f.elevationM + f.floorToFloorM)))
    setFloors(recalcLevels(next))
  }
  const addBelow = (i: number): void => {
    const next = [...floors]
    next.splice(i, 0, newFloor(round3(floors[i].elevationM - 3.6)))
    setFloors(recalcLevels(next))
  }
  const remove = (i: number): void => setFloors(floors.filter((_, k) => k !== i))

  return (
    <>
      <NumField
        label="Pump room FFL (m)"
        step={0.1}
        value={building.pumpRoomFloorElevationM}
        onChange={(v) => v !== undefined && onChange({ ...building, pumpRoomFloorElevationM: v })}
      />
      <NumField
        label="FD access level (m)"
        step={0.1}
        value={building.fireDeptAccessElevationM}
        onChange={(v) => v !== undefined && onChange({ ...building, fireDeptAccessElevationM: v })}
      />
      <Check
        label="Roof slope < 4:12 (roof hose connection required)"
        value={building.roofSlopeLessThan4in12}
        onChange={(v) => onChange({ ...building, roofSlopeLessThan4in12: v })}
      />
      <FloorGenerator floors={floors} onGenerate={setFloors} />
      <div className="col-span-2 flex items-center justify-between">
        <span className="text-[10px] font-bold text-orange-500 uppercase">
          Floors ({floors.length}, bottom to top)
        </span>
        <button
          type="button"
          onClick={() => setFloors(recalcLevels(floors))}
          className="px-2 py-0.5 rounded-lg bg-neutral-950 border border-neutral-800 text-[10px] font-bold text-neutral-300 hover:text-red-400 cursor-pointer"
        >
          Recalculate levels from heights
        </button>
      </div>
      <MiniTable head={['Name', 'FFL m', 'F-F m', 'Usage', 'Area m²', 'Spr', 'Hose', '']}>
        {floors.map((fl, i) => (
          <tr
            key={fl.id}
            className={`border-t border-neutral-850 ${fl.isRoof ? 'bg-neutral-950/60' : ''}`}
          >
            <td className="px-0.5 py-0.5">
              <TextCell value={fl.name} width="72px" onChange={(v) => patch(i, { name: v })} />
            </td>
            <td className="px-0.5 py-0.5">
              <NumCell
                value={fl.elevationM}
                step={0.1}
                width="56px"
                onChange={(v) => patch(i, { elevationM: v })}
              />
            </td>
            <td className="px-0.5 py-0.5">
              {fl.isRoof ? (
                <span className="text-[10px] text-neutral-600 px-1">-</span>
              ) : (
                <NumCell
                  value={fl.floorToFloorM}
                  step={0.1}
                  min={0}
                  width="50px"
                  onChange={(v) => patch(i, { floorToFloorM: v })}
                />
              )}
            </td>
            <td className="px-0.5 py-0.5">
              <TextCell value={fl.usage} width="68px" onChange={(v) => patch(i, { usage: v })} />
            </td>
            <td className="px-0.5 py-0.5">
              <NumCell
                value={fl.areaM2}
                min={0}
                width="56px"
                onChange={(v) => patch(i, { areaM2: v })}
              />
            </td>
            <td className="px-1 py-0.5 text-center">
              <input
                type="checkbox"
                aria-label={`${fl.name} sprinklered`}
                checked={fl.sprinklered}
                onChange={(e) => patch(i, { sprinklered: e.target.checked })}
                className="accent-red-600"
              />
            </td>
            <td className="px-1 py-0.5 text-center">
              <input
                type="checkbox"
                aria-label={`${fl.name} hose connection`}
                checked={fl.hoseConnection}
                onChange={(e) => patch(i, { hoseConnection: e.target.checked })}
                className="accent-red-600"
              />
            </td>
            <td className="px-0.5 py-0.5 whitespace-nowrap">
              {!fl.isRoof && (
                <IconBtn title={`Add floor above ${fl.name}`} onClick={() => addAbove(i)}>
                  <Plus size={11} className="rotate-0" />
                </IconBtn>
              )}
              <IconBtn title={`Add floor below ${fl.name}`} onClick={() => addBelow(i)}>
                <ChevronDown size={11} />
              </IconBtn>
              <IconBtn
                title={`Delete ${fl.name}`}
                disabled={fl.isRoof || floors.length <= 2}
                onClick={() => remove(i)}
              >
                <Trash2 size={11} />
              </IconBtn>
            </td>
          </tr>
        ))}
      </MiniTable>
      <div className="col-span-2 text-[9px] text-neutral-600">
        + adds a floor above the row, chevron adds one below (levels are recalculated); the roof row
        is fixed last. Elevations are relative to the ground floor FFL.
      </div>
    </>
  )
}

const SYSTEM_TYPES: { value: StandpipeSystemType; label: string }[] = [
  { value: 'automatic-wet', label: 'Automatic wet' },
  { value: 'automatic-dry', label: 'Automatic dry' },
  { value: 'semiautomatic-dry', label: 'Semiautomatic dry' },
  { value: 'manual-wet', label: 'Manual wet' },
  { value: 'manual-dry', label: 'Manual dry' }
]
const RISER_OPTIONS = [
  { value: 'auto', label: 'Auto (NFPA 14 §7.6)' },
  { value: '4', label: '4 in' },
  { value: '6', label: '6 in' },
  { value: '8', label: '8 in' }
]

const StandpipeDesignSection: React.FC<{
  design: StandpipeDesignInput
  onChange: (d: StandpipeDesignInput) => void
}> = ({ design, onChange }) => {
  const locs = design.locations
  const setLocs = (l: StandpipeLocation[]): void => onChange({ ...design, locations: l })
  const patch = (i: number, p: Partial<StandpipeLocation>): void =>
    setLocs(locs.map((l, k) => (k === i ? { ...l, ...p } : l)))
  const addLoc = (): void => {
    let n = locs.length + 1
    while (locs.some((l) => l.tag === `ST-${n}`)) n++
    setLocs([
      ...locs,
      { tag: `ST-${n}`, location: `Stair ${n}`, horizontalRunToPumpM: 30, servesRoof: false }
    ])
  }
  const hv = design.hoseValveHeightMm
  const hvBad = hv < 900 || hv > 1500
  return (
    <>
      <div className="col-span-2">
        <Select
          label="System type"
          value={design.systemType}
          options={SYSTEM_TYPES}
          onChange={(v) => onChange({ ...design, systemType: v })}
        />
      </div>
      <Check
        label="Combined with sprinklers"
        value={design.combinedWithSprinklers}
        onChange={(v) => onChange({ ...design, combinedWithSprinklers: v })}
      />
      <div className="col-span-2 text-[10px] font-bold text-orange-500 uppercase">
        Standpipe locations ({locs.length})
      </div>
      <MiniTable head={['Tag', 'Location', 'Run m', 'Roof', '']}>
        {locs.map((l, i) => (
          <tr key={i} className="border-t border-neutral-850">
            <td className="px-0.5 py-0.5">
              <TextCell value={l.tag} width="52px" onChange={(v) => patch(i, { tag: v })} />
            </td>
            <td className="px-0.5 py-0.5">
              <TextCell
                value={l.location}
                width="92px"
                onChange={(v) => patch(i, { location: v })}
              />
            </td>
            <td className="px-0.5 py-0.5">
              <NumCell
                value={l.horizontalRunToPumpM}
                min={0}
                width="52px"
                onChange={(v) => patch(i, { horizontalRunToPumpM: v })}
              />
            </td>
            <td className="px-1 py-0.5 text-center">
              <input
                type="checkbox"
                aria-label={`${l.tag} serves roof`}
                checked={l.servesRoof}
                onChange={(e) => patch(i, { servesRoof: e.target.checked })}
                className="accent-red-600"
              />
            </td>
            <td className="px-0.5 py-0.5">
              <IconBtn
                title={`Remove ${l.tag}`}
                disabled={locs.length <= 1}
                onClick={() => setLocs(locs.filter((_, k) => k !== i))}
              >
                <Trash2 size={11} />
              </IconBtn>
            </td>
          </tr>
        ))}
      </MiniTable>
      <div className="col-span-2">
        <button
          type="button"
          onClick={addLoc}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-neutral-950 border border-neutral-800 text-[10px] font-bold text-neutral-300 hover:text-red-400 cursor-pointer"
        >
          <Plus size={11} /> Add standpipe
        </button>
      </div>
      <Select
        label="Riser size"
        value={design.riserSizeIn === undefined ? 'auto' : String(design.riserSizeIn)}
        options={RISER_OPTIONS}
        onChange={(v) => onChange({ ...design, riserSizeIn: v === 'auto' ? undefined : Number(v) })}
      />
      <Select
        label="Schedule"
        value={design.pipe.schedule}
        options={SCHED_OPTIONS}
        onChange={(v) => onChange({ ...design, pipe: { ...design.pipe, schedule: v } })}
      />
      <NumField
        label="Hazen-Williams C"
        value={design.pipe.c}
        onChange={(v) =>
          v !== undefined && v > 0 && onChange({ ...design, pipe: { ...design.pipe, c: v } })
        }
      />
      <NumField
        label="Hose valve height (mm)"
        value={design.hoseValveHeightMm}
        onChange={(v) => v !== undefined && onChange({ ...design, hoseValveHeightMm: v })}
      />
      {hvBad && (
        <div className="col-span-2 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-1">
          Hose valve height should be 900-1500 mm (3-5 ft) above the floor, NFPA 14 §7.3.1.1.
        </div>
      )}
      <NumField
        label="FDC to hydrant (m)"
        min={0}
        value={design.fdcDistanceToHydrantM}
        onChange={(v) => v !== undefined && onChange({ ...design, fdcDistanceToHydrantM: v })}
      />
      <NumField
        label="FDC inlets (override)"
        optional
        min={1}
        step={1}
        placeholder="Auto"
        value={design.fdcInlets}
        onChange={(v) =>
          onChange({
            ...design,
            fdcInlets: v === undefined ? undefined : Math.max(1, Math.round(v))
          })
        }
      />
    </>
  )
}

// ───────────────────────── Portable fire extinguishers (NFPA 10) ─────────────────────────

const FE_HAZARD_OPTIONS: { value: ExtinguisherHazard; label: string }[] = [
  { value: 'light', label: 'Light (Low) Hazard' },
  { value: 'ordinary', label: 'Ordinary (Moderate) Hazard' },
  { value: 'extra', label: 'Extra (High) Hazard' }
]
const FE_B_OPTIONS: { value: ExtinguisherZoneInput['classB']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'spill', label: 'Spill / shallow (≤ ¼ in)' },
  { value: 'deep', label: 'Deep (> ¼ in)' }
]
const FE_MOUNT_OPTIONS: { value: ExtinguisherZoneInput['mounting']; label: string }[] = [
  { value: 'bracket', label: 'Wall bracket' },
  { value: 'cabinet', label: 'Cabinet' }
]

const FE_NEW_ZONE: Omit<ExtinguisherZoneInput, 'id' | 'floorId' | 'name'> = {
  hazard: 'ordinary',
  lengthM: 10,
  widthM: 8,
  classA: true,
  classB: 'none',
  deepLayerSurfaceM2: 0,
  classC: false,
  sensitiveElectronics: false,
  classD: false,
  dMetal: '',
  fryers: 0,
  maxFryerOilLb: 0,
  mounting: 'bracket'
}

const FireExtinguisherSection: React.FC<{
  zones: ExtinguisherZoneInput[]
  building: BuildingInput | undefined
  onChange: (zones: ExtinguisherZoneInput[]) => void
}> = ({ zones, building, onChange }) => {
  const floors = building?.floors.filter((f) => !f.isRoof) ?? []
  const patch = (i: number, p: Partial<ExtinguisherZoneInput>): void =>
    onChange(zones.map((z, k) => (k === i ? { ...z, ...p } : z)))
  const nextId = (): string => {
    let n = zones.length + 1
    while (zones.some((z) => z.id === `Z${n}`)) n++
    return `Z${n}`
  }
  const add = (): void =>
    onChange([
      ...zones,
      { ...FE_NEW_ZONE, id: nextId(), name: 'New zone', floorId: floors[0]?.id ?? 'GF' }
    ])
  const dup = (i: number): void => {
    const z = zones[i]
    const copy = { ...z, id: nextId(), name: `${z.name} copy` }
    onChange([...zones.slice(0, i + 1), copy, ...zones.slice(i + 1)])
  }
  const generate = (): void => {
    if (building) onChange(generateExtinguisherZonesFromFloors(building))
  }
  return (
    <>
      <div className="col-span-2 text-[10px] text-neutral-500 leading-relaxed bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1.5">
        NFPA 10 rules: Class A travel ≤ 75 ft (23 m); Class B 30 ft (9 m) for spills / 50 ft (15 m)
        for deep liquid; Class K ≤ 30 ft (9 m) from cooking; Class D ≤ 75 ft. Mount units ≤ 5 ft
        (1.5 m) to the top when ≤ 40 lb, ≤ 3.5 ft (1.1 m) when heavier; bottom ≥ 4 in (100 mm) above
        the floor.
      </div>
      <div className="col-span-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={generate}
          disabled={!building}
          title={building ? undefined : 'Enable the detailed building first'}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-neutral-950 border border-neutral-800 text-[10px] font-bold text-neutral-300 hover:text-red-400 cursor-pointer disabled:opacity-40 disabled:cursor-default"
        >
          <RotateCcw size={11} /> Generate zones from building floors
        </button>
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-neutral-950 border border-neutral-800 text-[10px] font-bold text-neutral-300 hover:text-red-400 cursor-pointer"
        >
          <Plus size={11} /> Add zone
        </button>
      </div>
      <div className="col-span-2 text-[10px] font-bold text-orange-500 uppercase">
        Zones ({zones.length})
      </div>
      {zones.map((z, i) => {
        const floorKnown = floors.some((f) => f.id === z.floorId)
        return (
          <div
            key={z.id}
            className="col-span-2 grid grid-cols-2 gap-2 border border-neutral-800 rounded-xl p-2.5 bg-neutral-950/40"
          >
            <div className="col-span-2 flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-red-400 font-mono">{z.id}</span>
              <div className="flex-1 min-w-0">
                <TextCell value={z.name} onChange={(v) => patch(i, { name: v })} />
              </div>
              <IconBtn title={`Duplicate ${z.id}`} onClick={() => dup(i)}>
                <Copy size={11} />
              </IconBtn>
              <IconBtn
                title={`Delete ${z.id}`}
                disabled={zones.length <= 1}
                onClick={() => onChange(zones.filter((_, k) => k !== i))}
              >
                <Trash2 size={11} />
              </IconBtn>
            </div>
            {floors.length > 0 ? (
              <Select
                label="Floor"
                value={z.floorId}
                options={[
                  ...floors.map((f) => ({ value: f.id, label: `${f.id} - ${f.name}` })),
                  ...(floorKnown ? [] : [{ value: z.floorId, label: `${z.floorId} (custom)` }])
                ]}
                onChange={(v) => patch(i, { floorId: v })}
              />
            ) : (
              <TextField
                label="Floor / level"
                value={z.floorId}
                onChange={(v) => patch(i, { floorId: v })}
              />
            )}
            <Select
              label="Hazard"
              value={z.hazard}
              options={FE_HAZARD_OPTIONS}
              onChange={(v) => patch(i, { hazard: v })}
            />
            <NumField
              label="Length (m)"
              value={z.lengthM}
              min={0.1}
              step={0.5}
              onChange={(v) => v !== undefined && v > 0 && patch(i, { lengthM: v })}
            />
            <NumField
              label="Width (m)"
              value={z.widthM}
              min={0.1}
              step={0.5}
              onChange={(v) => v !== undefined && v > 0 && patch(i, { widthM: v })}
            />
            <div className="col-span-2 grid grid-cols-2 gap-x-3 gap-y-1">
              <Check
                label="Class A (ordinary combustibles)"
                value={z.classA}
                onChange={(v) => patch(i, { classA: v })}
              />
              <Check
                label="Class C (energized electrical)"
                value={z.classC}
                onChange={(v) => patch(i, { classC: v })}
              />
              <Check
                label="Sensitive electronics (no dry chemical)"
                value={z.sensitiveElectronics}
                onChange={(v) => patch(i, { sensitiveElectronics: v })}
              />
              <Check
                label="Class D (combustible metals)"
                value={z.classD}
                onChange={(v) => patch(i, { classD: v })}
              />
            </div>
            <Select
              label="Class B (flammable liquids)"
              value={z.classB}
              options={FE_B_OPTIONS}
              onChange={(v) => patch(i, { classB: v })}
            />
            {z.classB === 'deep' && (
              <NumField
                label="Deep surface (m²)"
                value={z.deepLayerSurfaceM2}
                min={0}
                step={0.1}
                onChange={(v) => v !== undefined && v >= 0 && patch(i, { deepLayerSurfaceM2: v })}
              />
            )}
            {z.classD && (
              <TextField label="Metal" value={z.dMetal} onChange={(v) => patch(i, { dMetal: v })} />
            )}
            <NumField
              label="Fryers (Class K)"
              value={z.fryers}
              min={0}
              step={1}
              onChange={(v) => v !== undefined && v >= 0 && patch(i, { fryers: Math.round(v) })}
            />
            <NumField
              label="Max oil (lb)"
              value={z.maxFryerOilLb}
              min={0}
              onChange={(v) => v !== undefined && v >= 0 && patch(i, { maxFryerOilLb: v })}
            />
            <Select
              label="Mounting"
              value={z.mounting}
              options={FE_MOUNT_OPTIONS}
              onChange={(v) => patch(i, { mounting: v })}
            />
          </div>
        )
      })}
    </>
  )
}

export const FireInputPanel: React.FC = () => {
  const { input, setInput, reset } = useFireProtectionStore(
    useShallow((s) => ({ input: s.input, setInput: s.setInput, reset: s.reset }))
  )
  const set = (p: Partial<FireDesignInput>): void => setInput(p)
  const detailed = !!(input.building && input.standpipeDesign)
  const toggleDetailed = (on: boolean): void => {
    if (!on) {
      set({ building: undefined, standpipeDesign: undefined })
      return
    }
    const b = DEFAULT_FIRE_INPUT.building
    const d = DEFAULT_FIRE_INPUT.standpipeDesign
    if (!b || !d) return
    set({
      building: structuredClone(b),
      standpipeDesign: structuredClone(d),
      standpipeCount: d.locations.length
    })
  }

  const toggleExtinguishers = (on: boolean): void => {
    if (!on) {
      set({ extinguishers: undefined })
      return
    }
    const def = DEFAULT_FIRE_INPUT.extinguishers
    const usingDefaultBuilding =
      JSON.stringify(input.building) === JSON.stringify(DEFAULT_FIRE_INPUT.building)
    if (def && (usingDefaultBuilding || !input.building)) {
      set({ extinguishers: structuredClone(def) })
    } else if (input.building) {
      set({ extinguishers: { zones: generateExtinguisherZonesFromFloors(input.building) } })
    }
  }

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
        {detailed ? (
          <Label text="Standpipes (no.)" hint="From the locations table">
            <input
              type="text"
              readOnly
              value={String(input.standpipeDesign?.locations.length ?? 0)}
              className={`${inputCls} opacity-60`}
            />
          </Label>
        ) : (
          <NumField
            label="Standpipes (no.)"
            value={input.standpipeCount}
            min={1}
            step={1}
            onChange={(v) => v !== undefined && set({ standpipeCount: Math.round(v) })}
          />
        )}
        {!detailed && (
          <>
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
          </>
        )}
        <Check
          label="Building fully sprinklered"
          value={input.buildingSprinklered}
          onChange={(v) => set({ buildingSprinklered: v })}
        />
      </Section>

      <Section title="Building & Floors">
        <Check
          label="Detailed floor-by-floor standpipe design"
          value={detailed}
          onChange={toggleDetailed}
        />
        {input.building && (
          <BuildingSection building={input.building} onChange={(b) => set({ building: b })} />
        )}
        {!input.building && (
          <div className="col-span-2 text-[10px] text-neutral-500">
            Enable the detailed design to enter floors, levels and standpipe locations. The simple
            top-outlet height / friction inputs are used otherwise.
          </div>
        )}
      </Section>

      {input.standpipeDesign && (
        <Section title="Standpipe Design">
          <StandpipeDesignSection
            design={input.standpipeDesign}
            onChange={(d) => set({ standpipeDesign: d, standpipeCount: d.locations.length })}
          />
        </Section>
      )}

      <Section title="FIRE EXTINGUISHERS (NFPA 10)">
        <Check
          label="Enable portable fire extinguishers"
          value={!!input.extinguishers}
          onChange={toggleExtinguishers}
        />
        {input.extinguishers && (
          <FireExtinguisherSection
            zones={input.extinguishers.zones}
            building={input.building}
            onChange={(zones) => set({ extinguishers: { zones } })}
          />
        )}
      </Section>

      <Section title="Pump Set (NFPA 20)">
        <Check
          label="Custom pump set"
          value={input.pumpCounts !== undefined}
          onChange={(v) =>
            set({ pumpCounts: v ? { electric: 1, diesel: 1, jockey: 1 } : undefined })
          }
        />
        {input.pumpCounts ? (
          <>
            <NumField
              label="Electric pumps (0-3)"
              min={0}
              step={1}
              value={input.pumpCounts.electric}
              onChange={(v) =>
                v !== undefined &&
                input.pumpCounts &&
                set({
                  pumpCounts: {
                    ...input.pumpCounts,
                    electric: Math.min(3, Math.max(0, Math.round(v)))
                  }
                })
              }
            />
            <NumField
              label="Diesel pumps (0-3)"
              min={0}
              step={1}
              value={input.pumpCounts.diesel}
              onChange={(v) =>
                v !== undefined &&
                input.pumpCounts &&
                set({
                  pumpCounts: {
                    ...input.pumpCounts,
                    diesel: Math.min(3, Math.max(0, Math.round(v)))
                  }
                })
              }
            />
            <NumField
              label="Jockey pumps (1-2)"
              min={1}
              step={1}
              value={input.pumpCounts.jockey}
              onChange={(v) =>
                v !== undefined &&
                input.pumpCounts &&
                set({
                  pumpCounts: {
                    ...input.pumpCounts,
                    jockey: Math.min(2, Math.max(1, Math.round(v)))
                  }
                })
              }
            />
          </>
        ) : (
          <div className="col-span-2">
            <Select
              label="Arrangement"
              value={input.arrangement}
              options={ARRANGEMENTS}
              onChange={(v) => set({ arrangement: v })}
            />
          </div>
        )}
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
        <Select
          label="Access"
          value={input.tankAccess ?? 'top'}
          options={TANK_ACCESS}
          onChange={(v) => set({ tankAccess: v })}
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
