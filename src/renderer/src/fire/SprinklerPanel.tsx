import React, { useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileUp,
  Plus,
  ShowerHead,
  Trash2,
  Wand2
} from 'lucide-react'
import type { DesignCheck, FireDesignResult, HazardClass } from '../engine/fireProtection/fpTypes'
import { useFireProtectionStore } from '../store/fireProtectionStore'
import { HAZARD_DESIGN } from '../engine/fireProtection/standards/nfpa13'
import {
  QUESTIONNAIRE,
  SPRINKLER_OCCUPANCIES,
  defaultSprinklerAnswers,
  recommendedSystemType
} from '../engine/fireProtection/sprinkler/nfpa13Sprinkler'
import { importFloorPlanDxf } from '../engine/fireProtection/sprinkler/floorPlanImport'
import { detectRooms } from '../engine/fireProtection/sprinkler/roomDetection'
import { buildSampleFloorDxf } from '../engine/fireProtection/sprinkler/sampleFloor'
import { buildSprinklerReportHtml } from '../engine/fireProtection/sprinkler/sprinklerReport'
import { generateSprinklerDrawings } from '../engine/fireProtection/drawing/sprinklerSheets'
import { writeDxf } from '../engine/fireProtection/drawing/dxfWriter'
import type {
  DrawingUnits,
  FloorPlan,
  SprinklerAnswers,
  SprinklerDesignInput,
  SprinklerFloorInput,
  SprinklerRoomInput,
  SprinklerSystemType,
  SprinklerZoneInput
} from '../engine/fireProtection/sprinkler/sprinklerTypes'
import { StatusChip } from './FireResultsPanels'
import { SprinklerPlanSvg } from './SprinklerPlanSvg'
import { SprinklerPlanEditor, type PlanTool } from './SprinklerPlanEditor'
import { AreaEditor, ZonesPanel } from './SprinklerAreaPanels'
import {
  ZONE_AREA_LIMIT_FT2,
  effectiveZones,
  headSpecLabel,
  makeDrawnArea,
  nextZoneId,
  setRoomsPatch,
  zoneColor,
  zoneIdOf
} from './sprinklerAreaEditing'
import { readPlanFileAsDxf } from './sprinklerPlanFile'
import { downloadText, safeFileName } from './download'
import { exportDwgFromApp, type DwgExportStatus } from './dwgExport'

// ─────────────────────────── small UI kit ───────────────────────────

export const inputCls =
  'w-full bg-neutral-950 border border-neutral-800 rounded-lg px-2 py-1 text-xs text-neutral-200 font-mono focus:outline-none focus:border-red-600'
export const btnCls =
  'flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-default'
export const btnGhost = `${btnCls} bg-neutral-900 text-neutral-300 hover:bg-neutral-850 border border-neutral-800`
export const btnPrimary = `${btnCls} bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-lg shadow-red-500/20`

export const Card: React.FC<{
  title: string
  children: React.ReactNode
  right?: React.ReactNode
}> = ({ title, children, right }) => (
  <div className="bg-neutral-900 border border-neutral-850 p-5 rounded-2xl flex flex-col gap-3 shadow-xl">
    <div className="flex items-center gap-2">
      <div className="text-xs font-bold text-neutral-300 uppercase tracking-wider flex-1">
        {title}
      </div>
      {right}
    </div>
    {children}
  </div>
)

export const Field: React.FC<{
  label: string
  children: React.ReactNode
  hint?: string
  className?: string
}> = ({ label, children, hint, className }) => (
  <label className={`flex flex-col gap-1 min-w-0 ${className ?? ''}`}>
    <span className="text-[9px] font-bold text-neutral-500 uppercase tracking-wide">{label}</span>
    {children}
    {hint && <span className="text-[9px] text-neutral-600">{hint}</span>}
  </label>
)

/** Number input that tolerates blank / partial text (commits only finite values). */
export const NumInput: React.FC<{
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  className?: string
  ariaLabel?: string
}> = ({ value, onChange, step, min, className, ariaLabel }) => {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : '')
  const [prev, setPrev] = useState(value)
  if (value !== prev) {
    setPrev(value)
    if (parseFloat(text) !== value) setText(Number.isFinite(value) ? String(value) : '')
  }
  return (
    <input
      type="number"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={text}
      step={step}
      min={min}
      className={className ?? inputCls}
      onChange={(e) => {
        setText(e.target.value)
        const n = parseFloat(e.target.value)
        if (Number.isFinite(n)) onChange(n)
      }}
      onBlur={() => {
        if (!Number.isFinite(parseFloat(text))) setText(Number.isFinite(value) ? String(value) : '')
      }}
    />
  )
}

export function SelectBox<T extends string>({
  value,
  options,
  onChange,
  className,
  ariaLabel
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  className?: string
  ariaLabel?: string
}): React.JSX.Element {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      className={className ?? inputCls}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export const Check: React.FC<{
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  ariaLabel?: string
}> = ({ checked, onChange, label, ariaLabel }) => (
  <label className="flex items-center gap-2 text-[11px] text-neutral-300 cursor-pointer">
    <input
      type="checkbox"
      aria-label={ariaLabel ?? label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="accent-red-600"
    />
    {label}
  </label>
)

export const Stat: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode }> = ({
  label,
  value,
  sub
}) => (
  <div className="flex flex-col min-w-0 bg-neutral-950 border border-neutral-850 rounded-xl p-3">
    <span className="text-[9px] font-bold text-neutral-500 uppercase">{label}</span>
    <span className="text-sm font-bold text-neutral-100 font-mono">{value}</span>
    {sub && <span className="text-[10px] text-neutral-500 font-mono">{sub}</span>}
  </div>
)

export const ChecksList: React.FC<{ checks: DesignCheck[] }> = ({ checks }) => (
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

const f1 = (n: number | null | undefined, d = 1): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '-' : n.toFixed(d)

// ─────────────────────────── domain helpers ───────────────────────────

const SYSTEM_OPTIONS: { value: SprinklerSystemType; label: string }[] = [
  { value: 'wet', label: 'Wet pipe' },
  { value: 'dry', label: 'Dry pipe' },
  { value: 'preaction-single', label: 'Preaction - single interlock' },
  { value: 'preaction-double', label: 'Preaction - double interlock' },
  { value: 'deluge', label: 'Deluge' }
]
const SYSTEM_RANK: SprinklerSystemType[] = [
  'wet',
  'dry',
  'preaction-single',
  'preaction-double',
  'deluge'
]
const systemLabel = (t: SprinklerSystemType): string =>
  SYSTEM_OPTIONS.find((o) => o.value === t)?.label ?? t

const HAZARD_OPTIONS = (Object.keys(HAZARD_DESIGN) as HazardClass[]).map((h) => ({
  value: h,
  label: HAZARD_DESIGN[h].label
}))
const OCCUPANCY_OPTIONS = Object.entries(SPRINKLER_OCCUPANCIES).map(([value, o]) => ({
  value,
  label: o.label
}))
const UNIT_OPTIONS: { value: DrawingUnits | 'auto'; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'mm', label: 'mm' },
  { value: 'cm', label: 'cm' },
  { value: 'm', label: 'm' },
  { value: 'in', label: 'inches' },
  { value: 'ft', label: 'feet' }
]

/** The most demanding system type recommended across the (non-omitted) rooms of a floor. */
function recommendFloorSystem(
  answers: SprinklerAnswers,
  rooms: SprinklerRoomInput[]
): SprinklerSystemType {
  let best: SprinklerSystemType = 'wet'
  for (const r of rooms) {
    if (r.omit) continue
    const t = recommendedSystemType(answers, r)
    if (SYSTEM_RANK.indexOf(t) > SYSTEM_RANK.indexOf(best)) best = t
  }
  return best
}

function defaultRoomLayers(plan: FloorPlan): string[] {
  const withRooms = plan.layers.filter((l) => l.closedPolylines > 0)
  const named = withRooms.filter((l) => /room|rm|space|area|zone/i.test(l.name))
  if (named.length > 0) return named.map((l) => l.name)
  if (withRooms.length === 0) return []
  return [withRooms.slice().sort((a, b) => b.closedPolylines - a.closedPolylines)[0].name]
}

function runDetect(plan: FloorPlan, layers: string[], a: SprinklerAnswers): SprinklerRoomInput[] {
  return detectRooms(plan, layers, {
    buildingType: a.buildingType,
    ceilingHeightM: a.defaultCeilingHeightM,
    ceilingType: a.ceilingType
  }).map((r) => ({ ...r, source: 'detected' as const }))
}

function parsePlan(
  dxf: string | undefined,
  units: DrawingUnits | undefined
): { plan: FloorPlan | null; error: string | null } {
  if (!dxf) return { plan: null, error: null }
  try {
    return { plan: importFloorPlanDxf(dxf, units), error: null }
  } catch (e) {
    return { plan: null, error: e instanceof Error ? e.message : String(e) }
  }
}

function usePlan(floor: SprinklerFloorInput | undefined): {
  plan: FloorPlan | null
  error: string | null
} {
  const dxf = floor?.planDxf
  const units = floor?.planUnits
  return useMemo(() => parsePlan(dxf, units), [dxf, units])
}

function newDesign(): SprinklerDesignInput {
  return {
    answers: defaultSprinklerAnswers(),
    floors: [],
    buildingRiserIn: 6,
    buildingRiserSchedule: 'sch40'
  }
}

function nextFloorId(floors: SprinklerFloorInput[]): string {
  let max = 0
  for (const f of floors) {
    const m = /^F(\d+)$/.exec(f.id)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `F${max + 1}`
}

function blankFloor(floors: SprinklerFloorInput[]): SprinklerFloorInput {
  const last = floors[floors.length - 1]
  return {
    id: nextFloorId(floors),
    name: floors.length === 0 ? 'Ground Floor' : `Level ${floors.length}`,
    elevationM: last ? last.elevationM + 4 : 0,
    roomLayers: [],
    rooms: [],
    systemType: 'wet',
    riser: { x: 0, y: 0 },
    branchDirection: 'auto'
  }
}

function defaultRiser(plan: FloorPlan): { x: number; y: number } {
  const b = plan.bbox
  return { x: Math.round(b.minX - 200), y: Math.round((b.minY + b.maxY) / 2) }
}

/** Latest design in the store (avoids stale closures in async handlers). */
function currentDesign(): SprinklerDesignInput | undefined {
  return useFireProtectionStore.getState().input.sprinklerDesign
}
function commit(d: SprinklerDesignInput | undefined): void {
  useFireProtectionStore.getState().setInput({ sprinklerDesign: d })
}

// ─────────────────────────── step 1: questions ───────────────────────────

const QuestionsStep: React.FC<{ design: SprinklerDesignInput }> = ({ design }) => {
  const a = design.answers
  const set = (patch: Partial<SprinklerAnswers>): void =>
    commit({ ...design, answers: { ...a, ...patch } })
  return (
    <Card title="1. Design questionnaire (NFPA 13-2019)">
      <div className="flex flex-col divide-y divide-neutral-850">
        {QUESTIONNAIRE.filter(
          (q) => (q.id as string) !== 'pipeSizing' && (q.id as string) !== 'minSupplyMarginPsi'
        ).map((q) => {
          const v = a[q.id]
          let control: React.ReactNode
          if (q.id === 'supply') {
            control = (
              <div className="flex flex-col gap-2">
                <SelectBox
                  ariaLabel={q.question}
                  value={a.supply.kind}
                  options={q.options!.map((o) => ({
                    value: o.value as 'fire-pump' | 'city',
                    label: o.label
                  }))}
                  onChange={(k) =>
                    set({
                      supply:
                        k === 'fire-pump'
                          ? { kind: 'fire-pump' }
                          : { kind: 'city', staticPsi: 80, residualPsi: 60, residualFlowGpm: 1000 }
                    })
                  }
                />
                {a.supply.kind === 'city' && (
                  <div className="grid grid-cols-3 gap-2">
                    {(['staticPsi', 'residualPsi', 'residualFlowGpm'] as const).map((k) => {
                      const s = a.supply as Extract<SprinklerAnswers['supply'], { kind: 'city' }>
                      return (
                        <Field
                          key={k}
                          label={
                            k === 'staticPsi'
                              ? 'Static psi'
                              : k === 'residualPsi'
                                ? 'Residual psi'
                                : 'Residual flow gpm'
                          }
                        >
                          <NumInput
                            value={s[k]}
                            min={0}
                            onChange={(n) => set({ supply: { ...s, [k]: n } })}
                          />
                        </Field>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          } else if (typeof v === 'boolean') {
            control = (
              <Check
                checked={v}
                onChange={(b) => set({ [q.id]: b } as Partial<SprinklerAnswers>)}
                label={v ? 'Yes' : 'No'}
                ariaLabel={q.question}
              />
            )
          } else if (typeof v === 'number') {
            control = (
              <NumInput
                ariaLabel={q.question}
                value={v}
                step={0.1}
                min={1}
                onChange={(n) => set({ [q.id]: n } as Partial<SprinklerAnswers>)}
              />
            )
          } else {
            control = (
              <SelectBox
                ariaLabel={q.question}
                value={String(v)}
                options={q.options ?? []}
                onChange={(s) => set({ [q.id]: s } as unknown as Partial<SprinklerAnswers>)}
              />
            )
          }
          return (
            <div
              key={q.id}
              className="py-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_280px] gap-3 items-start"
            >
              <div className="flex flex-col gap-1">
                <div className="text-xs font-semibold text-neutral-200">{q.question}</div>
                <div className="text-[11px] text-neutral-500 leading-relaxed">{q.help}</div>
              </div>
              <div>{control}</div>
            </div>
          )
        })}
        <div className="py-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_280px] gap-3 items-start">
          <div className="flex flex-col gap-1">
            <div className="text-xs font-semibold text-neutral-200">Pipe sizing</div>
            <div className="text-[11px] text-neutral-500 leading-relaxed">
              Hydraulic calculation sizes every segment for the smallest pipe that keeps the supply
              margin below. The pipe schedule starts from NFPA 13 §28.5 and is then verified
              hydraulically (upsized where the supply is short).
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <SelectBox
              ariaLabel="Pipe sizing"
              value={a.pipeSizing ?? 'schedule-verified'}
              options={[
                {
                  value: 'hydraulic',
                  label: 'Hydraulic calculation (NFPA 13 Ch. 28) - recommended'
                },
                {
                  value: 'schedule-verified',
                  label: 'Pipe schedule (§28.5), hydraulically verified'
                }
              ]}
              onChange={(v) => set({ pipeSizing: v })}
            />
            <Field
              label="Minimum supply margin psi"
              hint="Kept between the available supply and the demand (default 10 psi)."
            >
              <NumInput
                ariaLabel="Minimum supply margin psi"
                value={a.minSupplyMarginPsi ?? 10}
                step={1}
                min={0}
                onChange={(n) => set({ minSupplyMarginPsi: n })}
              />
            </Field>
          </div>
        </div>
        <div className="py-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_280px] gap-3 items-start">
          <div className="flex flex-col gap-1">
            <div className="text-xs font-semibold text-neutral-200">Building riser</div>
            <div className="text-[11px] text-neutral-500">
              Size and schedule of the riser feeding the floor control assemblies (default 6 in Sch
              40).
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Size in">
              <NumInput
                value={design.buildingRiserIn}
                step={0.5}
                min={1}
                onChange={(n) => commit({ ...design, buildingRiserIn: n })}
              />
            </Field>
            <Field label="Schedule">
              <SelectBox
                value={design.buildingRiserSchedule}
                options={[
                  { value: 'sch40', label: 'Sch 40' },
                  { value: 'sch10', label: 'Sch 10' }
                ]}
                onChange={(s) => commit({ ...design, buildingRiserSchedule: s })}
              />
            </Field>
          </div>
        </div>
      </div>
    </Card>
  )
}

// ─────────────────────────── step 2: floors ───────────────────────────

const FloorEditor: React.FC<{
  design: SprinklerDesignInput
  index: number
  onRemove: () => void
}> = ({ design, index, onRemove }) => {
  const floor = design.floors[index]
  const { plan, error: planError } = usePlan(floor)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [tool, setTool] = useState<PlanTool>('select')
  const [activeZone, setActiveZone] = useState('Z1')
  const [selectedRaw, setSelected] = useState<string[]>([])
  const sprinklerResult = useFireProtectionStore((st) => st.result?.sprinklers)
  if (!floor) return null

  const zones = effectiveZones(floor)
  const activeZoneId = zones.some((z) => z.id === activeZone) ? activeZone : zones[0].id
  const selected = selectedRaw.filter((id) => floor.rooms.some((r) => r.id === id))
  const selectedAreas = floor.rooms.filter((r) => selected.includes(r.id))
  const zoneCounts: Record<string, number> = {}
  for (const r of floor.rooms) {
    const z = zoneIdOf(r, zones)
    zoneCounts[z] = (zoneCounts[z] ?? 0) + 1
  }

  const latestRooms = (): SprinklerRoomInput[] => (currentDesign()?.floors[index] ?? floor).rooms
  /** Replace the zones; the first zone's valve is the floor riser. */
  const setZones = (next: SprinklerZoneInput[]): void =>
    patchFloor({ zones: next, riser: { ...next[0].riser } })
  const patchAreas = (ids: string[], patch: Partial<SprinklerRoomInput>): void =>
    patchFloor({ rooms: setRoomsPatch(latestRooms(), new Set(ids), patch) })
  const deleteAreas = (ids: string[]): void => {
    const gone = new Set(ids)
    patchFloor({ rooms: latestRooms().filter((r) => !gone.has(r.id)) })
    setSelected([])
  }
  const createArea = (polygon: [number, number][]): void => {
    const rooms = latestRooms()
    const area = makeDrawnArea(polygon, rooms, answers, activeZoneId)
    patchFloor({ rooms: [...rooms, area] })
    setSelected([area.id])
  }
  const placeZcv = (x: number, y: number): void => {
    setZones(zones.map((z) => (z.id === activeZoneId ? { ...z, riser: { x, y } } : z)))
    setTool('select')
  }
  const addZone = (): void => {
    const id = nextZoneId(zones)
    const base = zones.find((z) => z.id === activeZoneId) ?? zones[0]
    setZones([
      ...zones,
      { id, name: `Zone ${id.slice(1)}`, riser: { x: base.riser.x, y: base.riser.y + 2000 } }
    ])
    setActiveZone(id)
  }
  const autoTypeLabel = ((): string | undefined => {
    if (selectedAreas.length !== 1) return undefined
    const rr = sprinklerResult?.floors
      .find((f) => f.floorId === floor.id)
      ?.rooms.find((r) => r.roomId === selectedAreas[0].id)
    const ht = sprinklerResult?.headTypes.find((h) => h.id === rr?.headTypeId)
    return ht ? `${ht.description} (${ht.id})` : undefined
  })()

  const patchFloor = (patch: Partial<SprinklerFloorInput>): void => {
    const d = currentDesign() ?? design
    commit({ ...d, floors: d.floors.map((f, i) => (i === index ? { ...f, ...patch } : f)) })
  }
  const answers = design.answers
  const recommended = recommendFloorSystem(answers, floor.rooms)

  const detect = (): void => {
    if (!plan) {
      setMsg({ ok: false, text: 'Upload a floor plan first.' })
      return
    }
    if (floor.roomLayers.length === 0) {
      setMsg({ ok: false, text: 'Select at least one room layer.' })
      return
    }
    const detected = runDetect(plan, floor.roomLayers, answers)
    const rooms = [...detected, ...floor.rooms.filter((r) => r.source === 'drawn')]
    patchFloor({ rooms, systemType: recommendFloorSystem(answers, rooms) })
    setSelected([])
    setMsg(
      detected.length > 0
        ? {
            ok: true,
            text: `${detected.length} rooms detected - drawn areas were kept; review them in step 3.`
          }
        : { ok: false, text: 'No closed polylines of at least 2 m² found on the selected layers.' }
    )
  }

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setBusy(true)
    setMsg({
      ok: true,
      text: /\.dwg$/i.test(file.name) ? 'Converting DWG to DXF...' : 'Reading DXF...'
    })
    try {
      const dxf = await readPlanFileAsDxf(file)
      const units = floor.planUnits
      const p = importFloorPlanDxf(dxf, units)
      const layers = defaultRoomLayers(p)
      const rooms = layers.length > 0 ? runDetect(p, layers, answers) : []
      patchFloor({
        planDxf: dxf,
        roomLayers: layers,
        rooms,
        riser: defaultRiser(p),
        zones: undefined,
        systemType: recommendFloorSystem(answers, rooms)
      })
      setSelected([])
      setMsg({
        ok: true,
        text: `${file.name}: ${p.entities.length} entities, ${rooms.length} rooms detected.`
      })
    } catch (e) {
      setMsg({
        ok: false,
        text: `Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`
      })
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const setUnits = (u: DrawingUnits | 'auto'): void => {
    const units = u === 'auto' ? undefined : u
    if (!floor.planDxf) {
      patchFloor({ planUnits: units })
      return
    }
    const r = parsePlan(floor.planDxf, units)
    if (!r.plan) {
      patchFloor({ planUnits: units })
      return
    }
    const rooms =
      floor.roomLayers.length > 0 ? runDetect(r.plan, floor.roomLayers, answers) : floor.rooms
    patchFloor({
      planUnits: units,
      rooms,
      riser: defaultRiser(r.plan),
      zones: undefined,
      systemType: recommendFloorSystem(answers, rooms)
    })
    setSelected([])
    setMsg({ ok: true, text: `Units changed - rooms re-detected (${rooms.length}).` })
  }

  const moveRiser = (riser: { x: number; y: number }): void => {
    if (floor.zones && floor.zones.length > 0)
      patchFloor({ riser, zones: floor.zones.map((z, i) => (i === 0 ? { ...z, riser } : z)) })
    else patchFloor({ riser })
  }

  const toggleLayer = (name: string, on: boolean): void => {
    patchFloor({
      roomLayers: on ? [...floor.roomLayers, name] : floor.roomLayers.filter((l) => l !== name)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Floor name">
          <input
            aria-label="Floor name"
            className={inputCls}
            value={floor.name}
            onChange={(e) => patchFloor({ name: e.target.value })}
          />
        </Field>
        <Field label="FFL elevation m">
          <NumInput
            ariaLabel="FFL elevation m"
            value={floor.elevationM}
            step={0.1}
            onChange={(n) => patchFloor({ elevationM: n })}
          />
        </Field>
        <Field label="Branch direction">
          <SelectBox
            value={floor.branchDirection}
            options={[
              { value: 'auto', label: 'Auto (fewest branch lines)' },
              { value: 'x', label: 'Along X' },
              { value: 'y', label: 'Along Y' }
            ]}
            onChange={(v) => patchFloor({ branchDirection: v })}
          />
        </Field>
        <Field label="Drawing units">
          <SelectBox
            ariaLabel="Drawing units"
            value={floor.planUnits ?? 'auto'}
            options={UNIT_OPTIONS}
            onChange={setUnits}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".dxf,.dwg"
          className="hidden"
          data-testid="plan-file"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <button disabled={busy} onClick={() => fileRef.current?.click()} className={btnGhost}>
          <FileUp size={13} /> Upload DXF / DWG plan
        </button>
        <button disabled={busy || !plan} onClick={detect} className={btnPrimary}>
          <Wand2 size={13} /> Detect rooms
        </button>
        <button onClick={onRemove} className={`${btnGhost} text-red-400 ml-auto`}>
          <Trash2 size={13} /> Remove floor
        </button>
      </div>
      {msg && (
        <div
          className={`text-[11px] rounded-lg px-3 py-2 border ${msg.ok ? 'border-emerald-800 text-emerald-300 bg-emerald-950/30' : 'border-amber-800 text-amber-200 bg-amber-950/30'}`}
        >
          {msg.text}
        </div>
      )}
      {planError && (
        <div className="text-[11px] rounded-lg px-3 py-2 border border-red-800 text-red-300 bg-red-950/30">
          Plan import failed: {planError}
        </div>
      )}

      {plan && (
        <div className="text-[10px] text-neutral-500 font-mono">
          Declared units: {plan.declaredUnits} | used: {plan.units} (x{plan.scaleToMm} to mm) |{' '}
          {plan.entities.length} entities
          {plan.warnings.map((w, i) => (
            <div key={i} className="text-amber-400/90">
              {w}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="text-[9px] font-bold text-neutral-500 uppercase tracking-wide">
              Room layers (closed polylines)
            </div>
            {!plan && (
              <div className="text-[11px] text-neutral-600">Upload a plan to list its layers.</div>
            )}
            <div className="flex flex-col gap-1 max-h-56 overflow-y-auto pr-1">
              {plan?.layers.map((l) => (
                <Check
                  key={l.name}
                  checked={floor.roomLayers.includes(l.name)}
                  onChange={(on) => toggleLayer(l.name, on)}
                  label={`${l.name} (${l.closedPolylines} closed / ${l.count})`}
                  ariaLabel={`Layer ${l.name}`}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-[9px] font-bold text-neutral-500 uppercase tracking-wide">
              Riser / floor control assembly (mm)
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="X">
                <NumInput
                  ariaLabel="Riser X"
                  value={floor.riser.x}
                  onChange={(n) => moveRiser({ ...floor.riser, x: n })}
                />
              </Field>
              <Field label="Y">
                <NumInput
                  ariaLabel="Riser Y"
                  value={floor.riser.y}
                  onChange={(n) => moveRiser({ ...floor.riser, y: n })}
                />
              </Field>
            </div>
            <div className="text-[10px] text-neutral-600">
              Floor riser = zone control valve of the first zone. Use the plan tool{' '}
              <em>Place zone control valve</em> to set it on the plan.
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Field label="System type">
              <SelectBox
                ariaLabel="System type"
                value={floor.systemType}
                options={SYSTEM_OPTIONS}
                onChange={(v) => patchFloor({ systemType: v })}
              />
            </Field>
            <div className="text-[10px] text-neutral-400">
              Recommended: <strong className="text-orange-400">{systemLabel(recommended)}</strong>
              {recommended !== floor.systemType && (
                <button
                  onClick={() => patchFloor({ systemType: recommended })}
                  className="ml-2 underline text-red-400 cursor-pointer"
                >
                  use
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="min-w-0 flex flex-col gap-3">
          <SprinklerPlanEditor
            plan={plan}
            rooms={floor.rooms}
            zones={zones}
            activeZoneId={activeZoneId}
            tool={tool}
            onToolChange={setTool}
            selected={selected}
            onSelect={setSelected}
            onCreateArea={createArea}
            onPlaceZcv={placeZcv}
            onDeleteSelected={() => deleteAreas(selected)}
            className="h-[460px]"
          />
          <div className="text-[10px] text-neutral-600">
            {floor.rooms.length} areas ({floor.rooms.filter((r) => r.source === 'drawn').length}{' '}
            drawn) | filled by zone colour with hazard label | squares = zone control valves | grey
            = architectural underlay
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
            <ZonesPanel
              zones={zones}
              activeZoneId={activeZoneId}
              onActive={setActiveZone}
              counts={zoneCounts}
              selectedCount={selected.length}
              onAdd={addZone}
              onRename={(id, name) =>
                setZones(zones.map((z) => (z.id === id ? { ...z, name } : z)))
              }
              onDelete={(id) => {
                if ((zoneCounts[id] ?? 0) > 0 || zones.length <= 1) return
                const next = zones.filter((z) => z.id !== id)
                setZones(next)
                if (activeZoneId === id) setActiveZone(next[0].id)
              }}
              onPlaceValve={(id) => {
                setActiveZone(id)
                setTool('zcv')
              }}
              onAssignSelected={(id) => patchAreas(selected, { zoneId: id })}
            />
            <AreaEditor
              areas={selectedAreas}
              zones={zones}
              autoTypeLabel={autoTypeLabel}
              onPatch={patchAreas}
              onDelete={deleteAreas}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

const FloorsStep: React.FC<{
  design: SprinklerDesignInput
  sel: number
  setSel: (i: number) => void
}> = ({ design, sel, setSel }) => {
  const index = Math.min(sel, design.floors.length - 1)
  return (
    <Card
      title="2. Floors"
      right={
        <button
          className={btnGhost}
          onClick={() => {
            const d = currentDesign() ?? design
            commit({ ...d, floors: [...d.floors, blankFloor(d.floors)] })
            setSel(d.floors.length)
          }}
        >
          <Plus size={13} /> Add floor
        </button>
      }
    >
      {design.floors.length === 0 ? (
        <div className="text-xs text-neutral-400">
          No floors yet. Add a floor and upload its architectural plan, or use{' '}
          <strong>Load sample floor</strong> to try the workflow.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {design.floors.map((f, i) => (
              <button
                key={f.id}
                onClick={() => setSel(i)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${i === index ? 'bg-red-600 text-white' : 'bg-neutral-950 text-neutral-400 hover:text-neutral-200 border border-neutral-800'}`}
              >
                {f.name || f.id}
              </button>
            ))}
          </div>
          <FloorEditor
            key={design.floors[index].id}
            design={design}
            index={index}
            onRemove={() => {
              const d = currentDesign() ?? design
              commit({ ...d, floors: d.floors.filter((_, i) => i !== index) })
              setSel(Math.max(0, index - 1))
            }}
          />
        </>
      )}
    </Card>
  )
}

// ─────────────────────────── step 3: rooms ───────────────────────────

const RoomsStep: React.FC<{
  design: SprinklerDesignInput
  sel: number
  setSel: (i: number) => void
}> = ({ design, sel, setSel }) => {
  const index = Math.min(sel, design.floors.length - 1)
  const floor = design.floors[index]
  if (!floor)
    return (
      <Card title="3. Rooms">
        <div className="text-xs text-neutral-400">Add a floor in step 2 first.</div>
      </Card>
    )
  const patchRoom = (ri: number, patch: Partial<SprinklerRoomInput>): void => {
    const d = currentDesign() ?? design
    commit({
      ...d,
      floors: d.floors.map((f, i) =>
        i === index
          ? { ...f, rooms: f.rooms.map((r, j) => (j === ri ? { ...r, ...patch } : r)) }
          : f
      )
    })
  }
  const anyFreezing = floor.rooms.some((r) => r.freezing)
  const zones = effectiveZones(floor)
  const cell = 'px-1 py-1 align-middle'
  return (
    <Card title="3. Rooms - occupancy, hazard and ceiling">
      <div className="flex flex-wrap gap-2">
        {design.floors.map((f, i) => (
          <button
            key={f.id}
            onClick={() => setSel(i)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${i === index ? 'bg-red-600 text-white' : 'bg-neutral-950 text-neutral-400 border border-neutral-800'}`}
          >
            {f.name || f.id} ({f.rooms.length})
          </button>
        ))}
      </div>
      {design.answers.freezingAreas && !anyFreezing && (
        <div className="text-[11px] rounded-lg px-3 py-2 border border-amber-800 text-amber-200 bg-amber-950/30">
          You answered that some areas are exposed to freezing temperatures - tick{' '}
          <strong>Freezing</strong> for those rooms so dry-pendent heads or a dry system are
          selected.
        </div>
      )}
      {floor.rooms.length === 0 ? (
        <div className="text-xs text-neutral-400">
          This floor has no rooms. Detect them in step 2.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-500 uppercase text-[9px] tracking-wide">
                {[
                  'Sprinklered',
                  'Omit reason',
                  'ID',
                  'Name',
                  'Occupancy',
                  'Hazard',
                  'Ceiling m',
                  'Ceiling',
                  'Freezing',
                  'Heat source',
                  'Zone',
                  'Sprinkler type',
                  'Area m²'
                ].map((h) => (
                  <th key={h} className="py-1.5 px-1 font-bold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {floor.rooms.map((r, ri) => {
                const area = Math.abs(polygonArea(r.polygon)) / 1e6
                return (
                  <tr
                    key={r.id}
                    className={`border-b border-neutral-850 ${r.omit ? 'opacity-70' : ''}`}
                  >
                    <td className={`${cell} text-center`}>
                      <input
                        type="checkbox"
                        aria-label={`Sprinklered ${r.name}`}
                        className="accent-red-600"
                        checked={!r.omit}
                        onChange={(e) => patchRoom(ri, { omit: !e.target.checked })}
                      />
                    </td>
                    <td className={cell}>
                      <input
                        aria-label={`Omit reason ${r.name}`}
                        disabled={!r.omit}
                        placeholder={r.omit ? 'Reason required (NFPA 13 §9.2)' : ''}
                        className={`${inputCls} min-w-[150px] ${r.omit && !r.omitReason.trim() ? 'border-red-600' : ''}`}
                        value={r.omitReason}
                        onChange={(e) => patchRoom(ri, { omitReason: e.target.value })}
                      />
                    </td>
                    <td className={`${cell} font-mono text-neutral-400`}>{r.id}</td>
                    <td className={cell}>
                      <input
                        aria-label={`Name ${r.id}`}
                        className={`${inputCls} min-w-[130px]`}
                        value={r.name}
                        onChange={(e) => patchRoom(ri, { name: e.target.value })}
                      />
                    </td>
                    <td className={cell}>
                      <SelectBox
                        ariaLabel={`Occupancy ${r.id}`}
                        value={r.occupancy}
                        options={OCCUPANCY_OPTIONS}
                        onChange={(o) =>
                          patchRoom(ri, {
                            occupancy: o,
                            hazard: SPRINKLER_OCCUPANCIES[o]?.hazard ?? r.hazard,
                            heatSource: o === 'kitchen' || o === 'mechanical' ? true : r.heatSource
                          })
                        }
                      />
                    </td>
                    <td className={cell}>
                      <SelectBox
                        ariaLabel={`Hazard ${r.id}`}
                        value={r.hazard}
                        options={HAZARD_OPTIONS}
                        onChange={(h) => patchRoom(ri, { hazard: h })}
                      />
                    </td>
                    <td className={`${cell} w-20`}>
                      <NumInput
                        ariaLabel={`Ceiling height ${r.id}`}
                        value={r.ceilingHeightM}
                        step={0.1}
                        min={1}
                        onChange={(n) => patchRoom(ri, { ceilingHeightM: n })}
                      />
                    </td>
                    <td className={cell}>
                      <SelectBox
                        ariaLabel={`Ceiling type ${r.id}`}
                        value={r.ceilingType}
                        options={[
                          { value: 'finished-flat', label: 'Finished flat' },
                          { value: 'exposed-structure', label: 'Exposed' }
                        ]}
                        onChange={(c) => patchRoom(ri, { ceilingType: c })}
                      />
                    </td>
                    <td className={`${cell} text-center`}>
                      <input
                        type="checkbox"
                        aria-label={`Freezing ${r.id}`}
                        className="accent-red-600"
                        checked={r.freezing}
                        onChange={(e) => patchRoom(ri, { freezing: e.target.checked })}
                      />
                    </td>
                    <td className={`${cell} text-center`}>
                      <input
                        type="checkbox"
                        aria-label={`Heat source ${r.id}`}
                        className="accent-red-600"
                        checked={r.heatSource}
                        onChange={(e) => patchRoom(ri, { heatSource: e.target.checked })}
                      />
                    </td>
                    <td className={cell}>
                      <SelectBox
                        ariaLabel={`Zone ${r.id}`}
                        value={zoneIdOf(r, zones)}
                        options={zones.map((z) => ({ value: z.id, label: z.id }))}
                        onChange={(z) => patchRoom(ri, { zoneId: z })}
                      />
                    </td>
                    <td className={`${cell} text-[10px] text-neutral-400 whitespace-nowrap`}>
                      {r.headSpec ? headSpecLabel(r.headSpec) : 'Automatic'}
                    </td>
                    <td className={`${cell} font-mono text-neutral-400 text-right`}>
                      {f1(area, 1)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[10px] text-neutral-600">
        Hazard defaults from the occupancy (NFPA 13 Annex A.4.3). Select the sprinkler type of an
        area on the plan editor in step 2. Omitting sprinklers is only permitted where NFPA 13 §9.2
        allows it and needs a reason.
      </div>
    </Card>
  )
}

function polygonArea(p: [number, number][]): number {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i]
    const [x2, y2] = p[(i + 1) % p.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

// ─────────────────────────── step 4: design ───────────────────────────

const ZoneAndAreaTables: React.FC<{
  floorIn: SprinklerFloorInput
  floorOut: NonNullable<FireDesignResult['sprinklers']>['floors'][number]
  headTypes: NonNullable<FireDesignResult['sprinklers']>['headTypes']
}> = ({ floorIn, floorOut, headTypes }) => {
  const zonesIn = effectiveZones(floorIn)
  const zonesOut = floorOut.zones ?? []
  const th = 'py-1.5 px-2 font-bold whitespace-nowrap'
  const td = 'py-1.5 px-2 align-top'
  const nameOf = (id: string): string => floorIn.rooms.find((r) => r.id === id)?.name ?? id
  return (
    <>
      <Card title="Zones - control valves, area and governing demand">
        {zonesOut.length === 0 ? (
          <div className="text-xs text-neutral-500">No zone results yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]" data-testid="zone-results">
              <thead>
                <tr className="border-b border-neutral-800 text-neutral-500 uppercase text-[9px] tracking-wide">
                  {[
                    'Zone',
                    'ZCV tag',
                    'Areas',
                    'Heads',
                    'Area ft² / m²',
                    'vs limit',
                    'Flow @ source',
                    'Pressure @ source',
                    'Margin'
                  ].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {zonesOut.map((z) => {
                  const lim = z.maxAreaFt2 || ZONE_AREA_LIMIT_FT2
                  const pct = (z.areaFt2 / lim) * 100
                  const g = z.governing
                  return (
                    <tr key={z.zoneId} className="border-b border-neutral-850">
                      <td className={td}>
                        <span
                          className="inline-block w-2 h-2 rounded-sm mr-1.5"
                          style={{ background: zoneColor(zonesIn, z.zoneId) }}
                        />
                        <span className="font-mono text-neutral-300">{z.zoneId}</span>{' '}
                        <span className="text-neutral-400">{z.name}</span>
                      </td>
                      <td className={`${td} font-mono text-orange-400`}>{z.controlValveTag}</td>
                      <td
                        className={`${td} text-neutral-400`}
                        title={z.roomIds.map(nameOf).join(', ')}
                      >
                        {z.roomIds.length}
                      </td>
                      <td className={`${td} font-mono`}>{z.headCount}</td>
                      <td className={`${td} font-mono`}>
                        {f1(z.areaFt2, 0)} / {f1(z.areaM2, 0)}
                      </td>
                      <td
                        className={`${td} font-mono ${pct > 100 ? 'text-red-400' : 'text-emerald-400'}`}
                      >
                        {f1(pct, 1)} % of {lim.toLocaleString('en-US')} ft²
                      </td>
                      <td className={`${td} font-mono`}>
                        {g ? `${f1(g.flowAtSourceGpm, 0)} gpm` : '-'}
                      </td>
                      <td className={`${td} font-mono`}>
                        {g ? `${f1(g.pressureAtSourcePsi, 1)} psi` : '-'}
                      </td>
                      <td
                        className={`${td} font-mono ${g && g.marginPsi < 0 ? 'text-red-400' : ''}`}
                      >
                        {g ? `${f1(g.marginPsi, 1)} psi` : '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Areas - hazard and sprinkler type">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]" data-testid="area-results">
            <thead>
              <tr className="border-b border-neutral-800 text-neutral-500 uppercase text-[9px] tracking-wide">
                {[
                  'Area',
                  'Zone',
                  'Hazard',
                  'Heads',
                  'm²',
                  'Spacing S x L mm',
                  'Sprinkler type',
                  'Selection'
                ].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {floorIn.rooms.map((r) => {
                const rr = floorOut.rooms.find((x) => x.roomId === r.id)
                const ht = headTypes.find((h) => h.id === rr?.headTypeId)
                return (
                  <tr key={r.id} className="border-b border-neutral-850">
                    <td className={td}>
                      <span className="font-mono text-neutral-400">{r.id}</span> {r.name}
                    </td>
                    <td className={`${td} font-mono`}>{zoneIdOf(r, zonesIn)}</td>
                    <td className={td}>{HAZARD_DESIGN[r.hazard]?.label ?? r.hazard}</td>
                    <td className={`${td} font-mono`}>{r.omit ? '-' : (rr?.headCount ?? '-')}</td>
                    <td className={`${td} font-mono`}>{rr ? f1(rr.areaM2, 1) : '-'}</td>
                    <td className={`${td} font-mono`}>
                      {rr && rr.headCount > 0
                        ? `${f1(rr.spacingSmm, 0)} x ${f1(rr.spacingLmm, 0)}`
                        : '-'}
                    </td>
                    <td className={`${td} text-neutral-300`}>
                      {r.omit
                        ? 'Not sprinklered'
                        : (ht?.description ??
                          rr?.headTypeId ??
                          (r.headSpec ? headSpecLabel(r.headSpec) : '-'))}
                    </td>
                    <td className={td}>
                      {r.omit ? (
                        '-'
                      ) : r.headSpec ? (
                        <span className="text-orange-400 font-bold">Designer</span>
                      ) : (
                        <span className="text-neutral-500">Automatic</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

const DesignStep: React.FC<{
  design: SprinklerDesignInput
  result: FireDesignResult
  sel: number
  setSel: (i: number) => void
}> = ({ design, result, sel, setSel }) => {
  const pending = useFireProtectionStore((s) => s.pending)
  const error = useFireProtectionStore((s) => s.error)
  const s = result.sprinklers
  const index = Math.min(sel, design.floors.length - 1)
  const floorIn = design.floors[index]
  const floorOut = s?.floors.find((f) => f.floorId === floorIn?.id)
  const { plan } = usePlan(floorIn)
  const gov = s?.governing

  if (design.floors.length === 0)
    return (
      <Card title="4. Design">
        <div className="text-xs text-neutral-400">Add a floor in step 2 first.</div>
      </Card>
    )
  if (!s) {
    return (
      <Card title="4. Design">
        <div className="text-xs text-neutral-400">
          {pending ? 'Calculating the sprinkler design...' : 'No sprinkler result yet.'}
        </div>
        {error && <div className="text-[11px] text-red-300">{error}</div>}
      </Card>
    )
  }
  const counts = { pass: 0, warn: 0, fail: 0 }
  for (const c of s.checks) counts[c.status as 'pass' | 'warn' | 'fail']++
  const g = floorOut?.governing
  const floorChecks = floorOut
    ? [...floorOut.rooms.flatMap((r) => r.checks), ...floorOut.checks]
    : []

  return (
    <div className="flex flex-col gap-4">
      <Card title="4. Design summary">
        {(pending || error) && (
          <div className={`text-[11px] ${error ? 'text-red-300' : 'text-orange-400'}`}>
            {error ? `Design error: ${error} - showing the last valid design.` : 'Recalculating...'}
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
          <Stat label="Sprinklers" value={s.totalHeads} sub={`${s.floors.length} floors`} />
          <Stat
            label="Governing flow"
            value={gov ? `${f1(gov.flowAtSourceGpm, 0)} gpm` : '-'}
            sub={gov ? `+ ${f1(gov.hoseAllowanceGpm, 0)} gpm hose` : undefined}
          />
          <Stat
            label="Pressure at source"
            value={gov ? `${f1(gov.pressureAtSourcePsi, 1)} psi` : '-'}
            sub={gov ? `${f1(gov.pressureAtSourcePsi * 0.0689476, 2)} bar` : undefined}
          />
          <Stat
            label="Supply margin"
            value={gov ? `${f1(gov.marginPsi, 1)} psi` : '-'}
            sub={gov ? `available ${f1(gov.availablePsi, 1)} psi` : undefined}
          />
          <Stat
            label="Head types"
            value={s.headTypes.length}
            sub={s.headTypes.map((h) => h.id).join(', ')}
          />
          <Stat
            label="Checks"
            value={`${counts.fail} fail / ${counts.warn} warn`}
            sub={`of ${s.checks.length}`}
          />
        </div>
      </Card>
      <Card title="Floor design">
        <div className="flex flex-wrap gap-2">
          {design.floors.map((f, i) => (
            <button
              key={f.id}
              onClick={() => setSel(i)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${i === index ? 'bg-red-600 text-white' : 'bg-neutral-950 text-neutral-400 border border-neutral-800'}`}
            >
              {f.name || f.id}
            </button>
          ))}
        </div>
        {!floorOut ? (
          <div className="text-xs text-neutral-400">Recalculating...</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4">
            <div className="min-w-0">
              <SprinklerPlanSvg
                plan={plan}
                rooms={floorIn.rooms}
                riser={floorOut.riser}
                zones={effectiveZones(floorIn)}
                design={floorOut}
                flowingTags={g?.headsFlowing}
                className="h-[420px]"
              />
              <div className="text-[10px] text-neutral-500 mt-1">
                White = sprinkler, red = remote design area, blue = branch lines, orange = cross
                main, green = riser
              </div>
            </div>
            <div className="flex flex-col gap-2 text-[11px]">
              <div className="text-[10px] font-bold text-orange-500 uppercase">
                {systemLabel(floorOut.systemType)} - {floorOut.heads.length} sprinklers
              </div>
              {g ? (
                <table className="w-full font-mono">
                  <tbody>
                    {[
                      ['Hazard', HAZARD_DESIGN[g.hazard]?.label ?? g.hazard],
                      ['Density', `${f1(g.densityGpmFt2, 3)} gpm/ft²`],
                      [
                        'Design area',
                        `${f1(g.designAreaFt2, 0)} ft² (base ${f1(g.baseAreaFt2, 0)})`
                      ],
                      ['Heads flowing', String(g.headsFlowing.length)],
                      ['Remote head', `${f1(g.remoteHeadPressurePsi, 1)} psi`],
                      [
                        'At floor control',
                        `${f1(g.flowAtFloorGpm, 1)} gpm @ ${f1(g.pressureAtFloorPsi, 1)} psi`
                      ],
                      [
                        'At source',
                        `${f1(g.flowAtSourceGpm, 1)} gpm @ ${f1(g.pressureAtSourcePsi, 1)} psi`
                      ],
                      ['Total demand', `${f1(g.totalDemandGpm, 1)} gpm (incl. hose)`],
                      ['Margin', `${f1(g.marginPsi, 1)} psi`],
                      ['Node rows', String(g.rows.length)]
                    ].map(([k, v]) => (
                      <tr key={k} className="border-b border-neutral-850">
                        <td className="py-1 text-neutral-500">{k}</td>
                        <td className="py-1 text-neutral-200 text-right">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-neutral-500">
                  No remote area (no sprinklers on this floor).
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
      {floorOut && (
        <ZoneAndAreaTables floorIn={floorIn} floorOut={floorOut} headTypes={s.headTypes} />
      )}
      {floorOut && (
        <Card title="Floor checks">
          {floorChecks.length > 0 ? (
            <ChecksList checks={floorChecks} />
          ) : (
            <div className="text-xs text-neutral-500">No checks for this floor.</div>
          )}
        </Card>
      )}
      <Card title="Building checks">
        <ChecksList checks={s.checks.filter((c) => !floorChecks.some((x) => x.id === c.id))} />
      </Card>
    </div>
  )
}

// ─────────────────────────── step 5: exports ───────────────────────────

const ExportsStep: React.FC<{ result: FireDesignResult }> = ({ result }) => {
  const [dwg, setDwg] = useState<DwgExportStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const built = useMemo(() => {
    if (!result.sprinklers) return { drawings: null, error: null as string | null }
    try {
      return { drawings: generateSprinklerDrawings(result), error: null as string | null }
    } catch (e) {
      return { drawings: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [result])
  const d = built.drawings
  const base = safeFileName(result.input.projectName)

  if (!result.sprinklers)
    return (
      <Card title="5. Exports">
        <div className="text-xs text-neutral-400">
          Add at least one floor with rooms to enable exports.
        </div>
      </Card>
    )
  if (!d)
    return (
      <Card title="5. Exports">
        <div className="text-xs text-red-300">Drawings could not be generated: {built.error}</div>
      </Card>
    )

  const dwgExport = async (dxf: string, name: string): Promise<void> => {
    setBusy(true)
    setDwg({ ok: true, message: 'Converting to DWG...' })
    setDwg(await exportDwgFromApp(dxf, name))
    setBusy(false)
  }
  const dxfBtn = (
    label: string,
    name: string,
    draw: Parameters<typeof writeDxf>[0]
  ): React.ReactNode => (
    <button
      key={name}
      className={btnPrimary}
      onClick={() => downloadText(name, writeDxf(draw), 'application/dxf')}
    >
      <Download size={13} /> {label}
    </button>
  )

  return (
    <div className="flex flex-col gap-4">
      <Card title="5. Exports - floor shop drawings">
        <div className="flex flex-col divide-y divide-neutral-850">
          {d.floors.map((f) => {
            const name =
              result.sprinklers?.floors.find((x) => x.floorId === f.floorId)?.floorName ?? f.floorId
            const num = f.drawing.sheets[0]?.number ?? 'FS'
            const file = `${base}_${num}_${safeFileName(name)}`
            return (
              <div key={f.floorId} className="py-2 flex flex-wrap items-center gap-2">
                <div className="text-xs text-neutral-200 flex-1 min-w-[160px]">
                  {num} - {name}
                </div>
                {dxfBtn('DXF', `${file}.dxf`, f.drawing)}
                <button
                  disabled={busy}
                  className={`${btnCls} bg-neutral-100 text-neutral-900 hover:bg-white`}
                  onClick={() => void dwgExport(writeDxf(f.drawing), `${file}.dwg`)}
                >
                  <Download size={13} /> DWG
                </button>
              </div>
            )
          })}
        </div>
      </Card>
      <Card title="Riser, hydraulics and package">
        <div className="flex flex-wrap items-center gap-2">
          {dxfBtn('FS-501 riser & details DXF', `${base}_FS-501.dxf`, d.riserAndDetails)}
          {dxfBtn('FS-601 hydraulics DXF', `${base}_FS-601.dxf`, d.hydraulics)}
          {dxfBtn('Combined DXF (all sheets)', `${base}_sprinklers_combined.dxf`, d.combined)}
          <button
            disabled={busy}
            className={`${btnCls} bg-neutral-100 text-neutral-900 hover:bg-white`}
            onClick={() => void dwgExport(writeDxf(d.combined), `${base}_sprinklers_combined.dwg`)}
          >
            <Download size={13} /> Combined DWG
          </button>
          <button
            className={btnGhost}
            onClick={() =>
              downloadText(
                `${base}_sprinklers.html`,
                buildSprinklerReportHtml(result, d),
                'text/html'
              )
            }
          >
            <Download size={13} /> HTML report
          </button>
        </div>
        {dwg && (
          <div
            className={`text-[11px] rounded-lg px-3 py-2 border ${dwg.ok ? 'border-emerald-800 text-emerald-300 bg-emerald-950/30' : 'border-amber-800 text-amber-200 bg-amber-950/30'}`}
          >
            {dwg.message}
          </div>
        )}
        <div className="text-[10px] text-neutral-600">
          Sheets:{' '}
          {[
            ...d.floors.map((f) => f.drawing.sheets[0]?.number),
            d.riserAndDetails.sheets[0]?.number,
            d.hydraulics.sheets[0]?.number
          ].join(', ')}
          . The HTML report is printable (A3 landscape per sheet).
        </div>
      </Card>
    </div>
  )
}

// ─────────────────────────── wizard ───────────────────────────

const STEPS = ['Questions', 'Floors', 'Rooms', 'Design', 'Exports']

export const SprinklerPanel: React.FC<{ result: FireDesignResult }> = ({ result }) => {
  const stored = useFireProtectionStore((s) => s.input.sprinklerDesign)
  const [step, setStep] = useState(0)
  const [sel, setSel] = useState(0)
  const design = stored ?? null

  const loadSample = (): void => {
    const d = currentDesign() ?? newDesign()
    const dxf = buildSampleFloorDxf()
    const plan = importFloorPlanDxf(dxf)
    const layers = ['A-ROOM']
    const rooms = runDetect(plan, layers, d.answers)
    const base = blankFloor(d.floors)
    const floor: SprinklerFloorInput = {
      ...base,
      planDxf: dxf,
      planUnits: undefined,
      roomLayers: layers,
      rooms,
      riser: defaultRiser(plan),
      systemType: recommendFloorSystem(d.answers, rooms)
    }
    commit({ ...d, floors: [...d.floors, floor] })
    setSel(d.floors.length)
  }

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <ShowerHead size={16} className="text-red-500" />
      <div className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex-1">
        Automatic sprinkler system from floor plans (NFPA 13)
      </div>
      <button className={btnGhost} onClick={loadSample}>
        <Wand2 size={13} /> Load sample floor
      </button>
      {design && (
        <button
          className={`${btnGhost} text-red-400`}
          onClick={() => {
            commit(undefined)
            setStep(0)
            setSel(0)
          }}
        >
          <Trash2 size={13} /> Remove sprinkler design
        </button>
      )}
    </div>
  )

  if (!design) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Card title="Sprinkler design">
          <div className="text-xs text-neutral-400 leading-relaxed">
            Design an automatic sprinkler system (wet, dry, preaction, deluge) from architectural
            DXF / DWG floor plans: answer the questionnaire, import each floor, review the detected
            rooms, then export shop drawings and an HTML report. The demand is added to the pump and
            tank design.
          </div>
          <div className="flex gap-2">
            <button className={btnPrimary} onClick={() => commit(newDesign())}>
              Start sprinkler design
            </button>
            <button className={btnGhost} onClick={loadSample}>
              Load sample floor
            </button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {header}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-850 pb-2">
        {STEPS.map((t, i) => (
          <button
            key={t}
            onClick={() => setStep(i)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${i === step ? 'bg-red-600 text-white' : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 border border-neutral-800'}`}
          >
            {i + 1}. {t}
          </button>
        ))}
      </div>
      {step === 0 && <QuestionsStep design={design} />}
      {step === 1 && <FloorsStep design={design} sel={sel} setSel={setSel} />}
      {step === 2 && <RoomsStep design={design} sel={sel} setSel={setSel} />}
      {step === 3 && <DesignStep design={design} result={result} sel={sel} setSel={setSel} />}
      {step === 4 && <ExportsStep result={result} />}
      <div className="flex justify-between">
        <button disabled={step === 0} className={btnGhost} onClick={() => setStep(step - 1)}>
          <ChevronLeft size={13} /> Back
        </button>
        <button
          disabled={step === STEPS.length - 1}
          className={btnPrimary}
          onClick={() => setStep(step + 1)}
        >
          Next <ChevronRight size={13} />
        </button>
      </div>
    </div>
  )
}
