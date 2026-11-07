import React, { useMemo, useRef, useState } from 'react'
import { Download, Eye, EyeOff, FileUp, Plus, Trash2, Wand2, Wind } from 'lucide-react'
import type { FireDesignResult } from '../engine/fireProtection/fpTypes'
import { useFireProtectionStore } from '../store/fireProtectionStore'
import { importFloorPlanDxf } from '../engine/fireProtection/sprinkler/floorPlanImport'
import { detectRooms } from '../engine/fireProtection/sprinkler/roomDetection'
import { buildSampleFloorDxf } from '../engine/fireProtection/sprinkler/sampleFloor'
import type {
  DrawingUnits,
  FloorPlan,
  SprinklerRoomInput
} from '../engine/fireProtection/sprinkler/sprinklerTypes'
import type {
  Co2Answers,
  Co2DesignInput,
  Co2EnclosureInput,
  Co2EnclosureResult,
  Co2FloorInput
} from '../engine/fireProtection/co2/co2Types'
import {
  CO2_MATERIALS,
  CO2_PRELIMINARY_NOTE,
  DEEP_SEATED_LABELS,
  LB_PER_KG,
  MIN_TIME_DELAY_S,
  FT3_PER_M3,
  co2EnclosureFromRoom,
  defaultCo2Answers
} from '../engine/fireProtection/co2/nfpa12'
import { generateCo2Drawings } from '../engine/fireProtection/drawing/co2Sheets'
import { buildCo2ReportHtml } from '../engine/fireProtection/co2/co2Report'
import { writeDxf } from '../engine/fireProtection/drawing/dxfWriter'
import type { Drawing } from '../engine/fireProtection/drawing/drawingTypes'
import {
  Card,
  Check,
  ChecksList,
  Field,
  NumInput,
  SelectBox,
  Stat,
  btnCls,
  btnGhost,
  btnPrimary,
  inputCls
} from './SprinklerPanel'
import { Co2PlanSvg } from './Co2PlanSvg'
import { DrawingPreview } from './DrawingPreview'
import { readPlanFileAsDxf } from './sprinklerPlanFile'
import { downloadText, safeFileName } from './download'
import { exportDwgFromApp, type DwgExportStatus } from './dwgExport'

// ─────────────────────────── helpers ───────────────────────────

const UNIT_OPTIONS: { value: DrawingUnits | 'auto'; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'mm', label: 'mm' },
  { value: 'cm', label: 'cm' },
  { value: 'm', label: 'm' },
  { value: 'in', label: 'inches' },
  { value: 'ft', label: 'feet' }
]
const MATERIAL_OPTIONS = Object.entries(CO2_MATERIALS)
  .map(([value, m]) => ({ value, label: `${m.label} (MDC ${m.mdcPct} %)`, sort: m.label }))
  .sort((a, b) => a.sort.localeCompare(b.sort))
  .map(({ value, label }) => ({ value, label }))
const DEEP_OPTIONS = (Object.keys(DEEP_SEATED_LABELS) as (keyof typeof DEEP_SEATED_LABELS)[]).map(
  (value) => ({ value, label: DEEP_SEATED_LABELS[value] })
)
const STRENGTH_OPTIONS = [
  { value: '25', label: 'Light - 25 lb/ft²' },
  { value: '50', label: 'Normal - 50 lb/ft²' },
  { value: '100', label: 'Vault - 100 lb/ft²' }
]

function newDesign(): Co2DesignInput {
  return { answers: defaultCo2Answers(), floors: [] }
}
function nextFloorId(floors: Co2FloorInput[]): string {
  let max = 0
  for (const f of floors) {
    const m = /^F(\d+)$/.exec(f.id)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `F${max + 1}`
}
function nextEnclosureId(d: Co2DesignInput): string {
  let max = 0
  for (const f of d.floors)
    for (const e of f.enclosures) {
      const m = /^Z(\d+)$/.exec(e.id)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
  return `Z${max + 1}`
}
function blankFloor(floors: Co2FloorInput[]): Co2FloorInput {
  const last = floors[floors.length - 1]
  return {
    id: nextFloorId(floors),
    name: floors.length === 0 ? 'Ground Floor' : `Level ${floors.length}`,
    elevationM: last ? last.elevationM + 4 : 0,
    enclosures: [],
    storage: { x: 0, y: 0 }
  }
}
function defaultStorage(plan: FloorPlan): { x: number; y: number } {
  const b = plan.bbox
  return { x: Math.round(b.minX - 200), y: Math.round((b.minY + b.maxY) / 2) }
}
function defaultRoomLayers(plan: FloorPlan): string[] {
  const withRooms = plan.layers.filter((l) => l.closedPolylines > 0)
  const named = withRooms.filter((l) => /room|rm|space|area|zone/i.test(l.name))
  if (named.length > 0) return named.map((l) => l.name)
  if (withRooms.length === 0) return []
  return [withRooms.slice().sort((a, b) => b.closedPolylines - a.closedPolylines)[0].name]
}
function detect(plan: FloorPlan, layers: string[]): SprinklerRoomInput[] {
  return detectRooms(plan, layers, {
    buildingType: 'office',
    ceilingHeightM: 3,
    ceilingType: 'finished-flat'
  })
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
const currentDesign = (): Co2DesignInput | undefined =>
  useFireProtectionStore.getState().input.co2Design
const commit = (d: Co2DesignInput | undefined): void =>
  useFireProtectionStore.getState().setInput({ co2Design: d })

/** Update one floor against the latest store design (safe in async handlers). */
function patchFloorById(id: string, patch: Partial<Co2FloorInput>): void {
  const d = currentDesign()
  if (!d) return
  commit({ ...d, floors: d.floors.map((f) => (f.id === id ? { ...f, ...patch } : f)) })
}
function patchEnclosure(floorId: string, encId: string, patch: Partial<Co2EnclosureInput>): void {
  const d = currentDesign()
  if (!d) return
  commit({
    ...d,
    floors: d.floors.map((f) =>
      f.id === floorId
        ? { ...f, enclosures: f.enclosures.map((e) => (e.id === encId ? { ...e, ...patch } : e)) }
        : f
    )
  })
}

const f1 = (n: number | null | undefined, d = 1): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '-' : n.toFixed(d)
const lbKg = (lb: number): string => `${lb.toFixed(0)} lb (${(lb / LB_PER_KG).toFixed(0)} kg)`

const Msg: React.FC<{ ok: boolean; children: React.ReactNode }> = ({ ok, children }) => (
  <div
    className={`text-[11px] rounded-lg px-3 py-2 border ${ok ? 'border-emerald-800 text-emerald-300 bg-emerald-950/30' : 'border-amber-800 text-amber-200 bg-amber-950/30'}`}
  >
    {children}
  </div>
)

const Th: React.FC<{ children?: React.ReactNode; right?: boolean }> = ({ children, right }) => (
  <th
    className={`px-2 py-1.5 text-[9px] font-bold text-neutral-500 uppercase whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
  >
    {children}
  </th>
)
const Td: React.FC<{ children?: React.ReactNode; right?: boolean; strong?: boolean }> = ({
  children,
  right,
  strong
}) => (
  <td
    className={`px-2 py-1.5 text-[11px] font-mono whitespace-nowrap ${right ? 'text-right' : 'text-left'} ${strong ? 'text-neutral-100 font-bold' : 'text-neutral-300'}`}
  >
    {children}
  </td>
)
const Table: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="overflow-x-auto">
    <table className="w-full border-collapse">{children}</table>
  </div>
)

// ─────────────────────────── questionnaire ───────────────────────────

const Questionnaire: React.FC<{ design: Co2DesignInput }> = ({ design }) => {
  const a = design.answers
  const set = (p: Partial<Co2Answers>): void => {
    const d = currentDesign() ?? design
    commit({ ...d, answers: { ...d.answers, ...p } })
  }
  return (
    <Card title="1. System questionnaire (NFPA 12)">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Storage">
          <SelectBox
            ariaLabel="Storage"
            value={a.storage}
            options={[
              { value: 'high-pressure', label: 'High pressure cylinders' },
              { value: 'low-pressure', label: 'Low pressure tank' }
            ]}
            onChange={(v) => set({ storage: v })}
          />
        </Field>
        <Field label="Cylinder size (lb)">
          <SelectBox
            ariaLabel="Cylinder size"
            value={String(a.cylinderLb) as '50' | '75' | '100'}
            options={[
              { value: '50', label: '50 lb (22.7 kg)' },
              { value: '75', label: '75 lb (34 kg)' },
              { value: '100', label: '100 lb (45.4 kg)' }
            ]}
            onChange={(v) => set({ cylinderLb: parseInt(v, 10) as 50 | 75 | 100 })}
          />
        </Field>
        <Field label="Detection">
          <SelectBox
            ariaLabel="Detection"
            value={a.detection}
            options={[
              { value: 'smoke-cross-zoned', label: 'Smoke, cross-zoned' },
              { value: 'heat', label: 'Heat' },
              { value: 'none-manual', label: 'None - manual release' }
            ]}
            onChange={(v) => set({ detection: v })}
          />
        </Field>
        <Field
          label="Pre-discharge delay s"
          hint={`min ${MIN_TIME_DELAY_S} s where people may be present`}
        >
          <NumInput
            ariaLabel="Time delay"
            value={a.timeDelayS}
            min={0}
            onChange={(n) => set({ timeDelayS: n })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Check
          checked={a.reserve}
          onChange={(v) => set({ reserve: v })}
          label="Connected reserve supply"
        />
        <Check checked={a.odorizer} onChange={(v) => set({ odorizer: v })} label="Odorizer" />
      </div>
      <div className="text-[10px] text-neutral-600">{CO2_PRELIMINARY_NOTE}</div>
    </Card>
  )
}

// ─────────────────────────── enclosure editor ───────────────────────────

const EnclosureEditor: React.FC<{ floorId: string; e: Co2EnclosureInput }> = ({ floorId, e }) => {
  const p = (patch: Partial<Co2EnclosureInput>): void => patchEnclosure(floorId, e.id, patch)
  return (
    <div className="bg-neutral-950 border border-neutral-850 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-cyan-300 font-mono">{e.id}</span>
        <input
          aria-label={`Enclosure name ${e.id}`}
          className={`${inputCls} flex-1 min-w-[140px]`}
          value={e.name}
          onChange={(ev) => p({ name: ev.target.value })}
        />
        <button
          className={`${btnGhost} text-red-400`}
          onClick={() => {
            const d = currentDesign()
            if (!d) return
            commit({
              ...d,
              floors: d.floors.map((f) =>
                f.id === floorId
                  ? { ...f, enclosures: f.enclosures.filter((x) => x.id !== e.id) }
                  : f
              )
            })
          }}
        >
          <Trash2 size={13} /> Remove
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Fire type">
          <SelectBox
            ariaLabel={`Fire type ${e.id}`}
            value={e.fireType}
            options={[
              { value: 'surface', label: 'Surface (flammable liquid / gas)' },
              { value: 'deep-seated', label: 'Deep-seated' }
            ]}
            onChange={(v) => p({ fireType: v })}
          />
        </Field>
        {e.fireType === 'surface' ? (
          <Field label="Material (MDC %)" className="col-span-2">
            <SelectBox
              ariaLabel={`Material ${e.id}`}
              value={e.material}
              options={MATERIAL_OPTIONS}
              onChange={(v) => p({ material: v })}
            />
          </Field>
        ) : (
          <Field label="Deep-seated hazard" className="col-span-2">
            <SelectBox
              ariaLabel={`Deep-seated hazard ${e.id}`}
              value={e.deepSeated}
              options={DEEP_OPTIONS}
              onChange={(v) => p({ deepSeated: v })}
            />
          </Field>
        )}
        <Field label="Height m">
          <NumInput
            ariaLabel={`Height ${e.id}`}
            value={e.heightM}
            step={0.1}
            min={0.5}
            onChange={(n) => p({ heightM: n })}
          />
        </Field>
        <Field label="Deductions m³">
          <NumInput
            ariaLabel={`Deductions ${e.id}`}
            value={e.deductionM3}
            min={0}
            onChange={(n) => p({ deductionM3: n })}
          />
        </Field>
        <Field label="Openings m²">
          <NumInput
            ariaLabel={`Openings ${e.id}`}
            value={e.openingsM2}
            step={0.1}
            min={0}
            onChange={(n) => p({ openingsM2: n })}
          />
        </Field>
        <Field label="Ventilation m³/min" hint="0 = shut down">
          <NumInput
            ariaLabel={`Ventilation ${e.id}`}
            value={e.ventilationM3min}
            min={0}
            onChange={(n) => p({ ventilationM3min: n })}
          />
        </Field>
        <Field label="Temperature °C">
          <NumInput
            ariaLabel={`Temperature ${e.id}`}
            value={e.temperatureC}
            onChange={(n) => p({ temperatureC: n })}
          />
        </Field>
        <Field label="Occupancy">
          <SelectBox
            ariaLabel={`Occupancy ${e.id}`}
            value={e.occupancy}
            options={[
              { value: 'normally-unoccupied', label: 'Normally unoccupied' },
              { value: 'occupiable', label: 'Occupiable' },
              { value: 'normally-occupied', label: 'Normally occupied' }
            ]}
            onChange={(v) => p({ occupancy: v })}
          />
        </Field>
        <Field label="Enclosure strength">
          <SelectBox
            ariaLabel={`Strength ${e.id}`}
            value={String(e.strengthPsf)}
            options={
              STRENGTH_OPTIONS.some((o) => o.value === String(e.strengthPsf))
                ? STRENGTH_OPTIONS
                : [
                    ...STRENGTH_OPTIONS,
                    { value: String(e.strengthPsf), label: `${e.strengthPsf} lb/ft²` }
                  ]
            }
            onChange={(v) => p({ strengthPsf: parseFloat(v) })}
          />
        </Field>
      </div>
    </div>
  )
}

// ─────────────────────────── floors ───────────────────────────

const FloorsSection: React.FC<{
  design: Co2DesignInput
  sel: number
  setSel: (i: number) => void
  result: FireDesignResult
}> = ({ design, sel, setSel, result }) => {
  const index = Math.min(sel, design.floors.length - 1)
  const floor: Co2FloorInput | undefined = design.floors[index]
  const dxf = floor?.planDxf
  const units = floor?.planUnits
  const parsed = useMemo(() => parsePlan(dxf, units), [dxf, units])
  const plan = parsed.plan
  const [layerSel, setLayerSel] = useState<Record<string, string[]>>({})
  const layers = useMemo(
    () => (floor && plan ? (layerSel[floor.id] ?? defaultRoomLayers(plan)) : []),
    [floor, plan, layerSel]
  )
  const rooms = useMemo(() => (plan ? detect(plan, layers) : []), [plan, layers])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const addFloor = (): void => {
    const d = currentDesign() ?? design
    commit({ ...d, floors: [...d.floors, blankFloor(d.floors)] })
    setSel(d.floors.length)
  }
  const removeFloor = (): void => {
    if (!floor) return
    const d = currentDesign() ?? design
    commit({ ...d, floors: d.floors.filter((f) => f.id !== floor.id) })
    setSel(Math.max(0, index - 1))
  }

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file || !floor) return
    setBusy(true)
    setMsg({
      ok: true,
      text: /\.dwg$/i.test(file.name) ? 'Converting DWG to DXF...' : 'Reading DXF...'
    })
    try {
      const text = await readPlanFileAsDxf(file)
      const p = importFloorPlanDxf(text, floor.planUnits)
      const ls = defaultRoomLayers(p)
      setLayerSel((s) => ({ ...s, [floor.id]: ls }))
      // Existing enclosures belong to the previous plan.
      patchFloorById(floor.id, { planDxf: text, enclosures: [], storage: defaultStorage(p) })
      setMsg({
        ok: true,
        text: `${file.name}: ${p.entities.length} entities, ${ls.length > 0 ? detect(p, ls).length : 0} rooms detected.`
      })
    } catch (err) {
      setMsg({
        ok: false,
        text: `Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`
      })
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const setUnits = (u: DrawingUnits | 'auto'): void => {
    if (!floor) return
    const nu = u === 'auto' ? undefined : u
    const r = parsePlan(floor.planDxf, nu)
    patchFloorById(floor.id, {
      planUnits: nu,
      ...(r.plan ? { enclosures: [], storage: defaultStorage(r.plan) } : {})
    })
    if (r.plan) setMsg({ ok: true, text: 'Units changed - re-select the rooms to protect.' })
  }

  const toggleRoom = (room: SprinklerRoomInput, on: boolean): void => {
    if (!floor) return
    const d = currentDesign()
    if (!d) return
    commit({
      ...d,
      floors: d.floors.map((f) => {
        if (f.id !== floor.id) return f
        if (!on) return { ...f, enclosures: f.enclosures.filter((e) => e.roomId !== room.id) }
        if (f.enclosures.some((e) => e.roomId === room.id)) return f
        return {
          ...f,
          enclosures: [...f.enclosures, co2EnclosureFromRoom(room, nextEnclosureId(d))]
        }
      })
    })
  }

  const floorResult = result.co2?.floors.find((f) => f.floorId === floor?.id) ?? null

  return (
    <Card
      title="2. Floors, rooms and enclosures"
      right={
        <button className={btnGhost} onClick={addFloor}>
          <Plus size={13} /> Add floor
        </button>
      }
    >
      {design.floors.length === 0 && (
        <div className="text-xs text-neutral-400">
          Add a floor, upload its DXF / DWG plan and tick the rooms to protect with CO2.
        </div>
      )}
      {design.floors.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {design.floors.map((f, i) => (
            <button
              key={f.id}
              onClick={() => setSel(i)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${i === index ? 'bg-red-600 text-white' : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 border border-neutral-800'}`}
            >
              {f.id} - {f.name} ({f.enclosures.length})
            </button>
          ))}
        </div>
      )}
      {floor && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Floor name">
              <input
                aria-label="Floor name"
                className={inputCls}
                value={floor.name}
                onChange={(e) => patchFloorById(floor.id, { name: e.target.value })}
              />
            </Field>
            <Field label="FFL elevation m">
              <NumInput
                ariaLabel="FFL elevation m"
                value={floor.elevationM}
                step={0.1}
                onChange={(n) => patchFloorById(floor.id, { elevationM: n })}
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
            <div className="grid grid-cols-2 gap-2">
              <Field label="Storage X mm">
                <NumInput
                  ariaLabel="Storage X"
                  value={floor.storage.x}
                  onChange={(n) =>
                    patchFloorById(floor.id, { storage: { ...floor.storage, x: n } })
                  }
                />
              </Field>
              <Field label="Storage Y mm">
                <NumInput
                  ariaLabel="Storage Y"
                  value={floor.storage.y}
                  onChange={(n) =>
                    patchFloorById(floor.id, { storage: { ...floor.storage, y: n } })
                  }
                />
              </Field>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".dxf,.dwg"
              className="hidden"
              data-testid="co2-plan-file"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <button disabled={busy} onClick={() => fileRef.current?.click()} className={btnGhost}>
              <FileUp size={13} /> Upload DXF / DWG plan
            </button>
            <button onClick={removeFloor} className={`${btnGhost} text-red-400 ml-auto`}>
              <Trash2 size={13} /> Remove floor
            </button>
          </div>
          {msg && <Msg ok={msg.ok}>{msg.text}</Msg>}
          {parsed.error && <Msg ok={false}>Plan import failed: {parsed.error}</Msg>}
          {plan && plan.warnings.length > 0 && (
            <div className="text-[10px] text-amber-400/90">{plan.warnings.join(' | ')}</div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-4">
            <div className="flex flex-col gap-4 min-w-0">
              <div className="flex flex-col gap-1.5">
                <div className="text-[9px] font-bold text-neutral-500 uppercase tracking-wide">
                  Room layers
                </div>
                {!plan && (
                  <div className="text-[11px] text-neutral-600">
                    Upload a plan to list its layers.
                  </div>
                )}
                <div className="flex flex-col gap-1 max-h-40 overflow-y-auto pr-1">
                  {plan?.layers.map((l) => (
                    <Check
                      key={l.name}
                      checked={layers.includes(l.name)}
                      onChange={(on) =>
                        setLayerSel((s) => ({
                          ...s,
                          [floor.id]: on ? [...layers, l.name] : layers.filter((x) => x !== l.name)
                        }))
                      }
                      label={`${l.name} (${l.closedPolylines} closed / ${l.count})`}
                      ariaLabel={`Layer ${l.name}`}
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="text-[9px] font-bold text-neutral-500 uppercase tracking-wide">
                  Detected rooms - protect with CO2
                </div>
                {rooms.length === 0 && (
                  <div className="text-[11px] text-neutral-600">
                    No rooms detected on the selected layers.
                  </div>
                )}
                <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
                  {rooms.map((r) => (
                    <Check
                      key={r.id}
                      checked={floor.enclosures.some((e) => e.roomId === r.id)}
                      onChange={(on) => toggleRoom(r, on)}
                      label={`${r.id} ${r.name} (${polyArea(r.polygon).toFixed(1)} m²)`}
                      ariaLabel={`Protect ${r.id} with CO2`}
                    />
                  ))}
                </div>
              </div>
              <div className="text-[10px] text-neutral-600">
                Click the plan to place the CO2 storage (green dot). Cyan = protected, red =
                nozzles.
              </div>
            </div>
            <Co2PlanSvg
              plan={plan}
              rooms={rooms}
              enclosures={floor.enclosures}
              storage={floor.storage}
              design={floorResult}
              onPick={(x, y) => patchFloorById(floor.id, { storage: { x, y } })}
              className="max-h-[520px]"
            />
          </div>

          {floor.enclosures.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="text-[9px] font-bold text-neutral-500 uppercase tracking-wide">
                Protected enclosures
              </div>
              {floor.enclosures.map((e) => (
                <EnclosureEditor key={e.id} floorId={floor.id} e={e} />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function polyArea(poly: [number, number][]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[(i + 1) % poly.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2 / 1e6
}

// ─────────────────────────── results ───────────────────────────

const EnclosureRow: React.FC<{ e: Co2EnclosureResult }> = ({ e }) => {
  const q = e.quantity
  return (
    <tr className="border-t border-neutral-850">
      <Td strong>
        {e.enclosureId} {e.name}
      </Td>
      <Td right>
        {q.volumeFt3.toFixed(0)} ft³ ({(q.volumeFt3 / FT3_PER_M3).toFixed(1)} m³)
      </Td>
      <Td right>{q.designConcentrationPct.toFixed(0)}</Td>
      <Td right>{q.floodingFactorFt3PerLb.toFixed(1)}</Td>
      <Td right>{q.mcf.toFixed(2)}</Td>
      <Td right strong>
        {lbKg(q.totalLb)}
      </Td>
      <Td right>{e.rateLbMin.toFixed(0)}</Td>
      <Td right>{e.dischargeTimeMin.toFixed(1)}</Td>
      <Td right>{e.cylinders || '-'}</Td>
      <Td right>{e.minNozzlePressurePsi.toFixed(0)}</Td>
      <Td right>{e.ventAreaIn2.toFixed(1)}</Td>
    </tr>
  )
}

const ResultsSection: React.FC<{ result: FireDesignResult }> = ({ result }) => {
  const co2 = result.co2
  if (!co2) return null
  const st = co2.storage
  const encs = co2.floors.flatMap((f) => f.enclosures)
  return (
    <div className="flex flex-col gap-4">
      <Card title="3. Quantity and discharge per enclosure">
        {encs.length === 0 ? (
          <div className="text-xs text-neutral-400">Tick at least one room to protect.</div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Enclosure</Th>
                <Th right>Net volume V</Th>
                <Th right>C %</Th>
                <Th right>Factor ft³/lb</Th>
                <Th right>MCF</Th>
                <Th right>Total CO2</Th>
                <Th right>Rate lb/min</Th>
                <Th right>Time min</Th>
                <Th right>Cyl.</Th>
                <Th right>Min nozzle psi</Th>
                <Th right>Vent in²</Th>
              </tr>
            </thead>
            <tbody>
              {encs.map((e) => (
                <EnclosureRow key={e.enclosureId} e={e} />
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Storage summary">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            label="Type"
            value={st.storage === 'high-pressure' ? 'High pressure' : 'Low pressure'}
            sub={st.governingEnclosureId ? `governed by ${st.governingEnclosureId}` : undefined}
          />
          <Stat label="Main supply" value={lbKg(st.mainLb)} />
          <Stat label="Reserve" value={st.reserveLb > 0 ? lbKg(st.reserveLb) : 'none'} />
          <Stat label="Installed" value={lbKg(st.installedLb)} />
          {st.storage === 'high-pressure' ? (
            <Stat
              label="Cylinders"
              value={`${st.mainCylinders} + ${st.reserveCylinders}`}
              sub={`${st.cylinderLb} lb each (main + reserve)`}
            />
          ) : (
            <Stat label="Tank" value={`${st.tankTons ?? '-'} ton`} />
          )}
          <Stat label="Nozzles" value={co2.totalNozzles} />
        </div>
      </Card>

      <Card title="Design checks">
        <ChecksList checks={co2.checks} />
      </Card>

      <Card title="Accessories">
        <Table>
          <thead>
            <tr>
              <Th>Tag</Th>
              <Th>Item</Th>
              <Th right>Qty</Th>
              <Th right>Size in</Th>
              <Th>Location</Th>
              <Th>Reference</Th>
            </tr>
          </thead>
          <tbody>
            {co2.accessories.map((a) => (
              <tr key={a.tag} className="border-t border-neutral-850">
                <Td strong>{a.tag}</Td>
                <Td>{a.item}</Td>
                <Td right>{a.qty}</Td>
                <Td right>{a.sizeIn ?? '-'}</Td>
                <Td>{a.location}</Td>
                <Td>{a.reference}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="Bill of materials">
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th>Size</Th>
              <Th right>Qty</Th>
              <Th>Unit</Th>
            </tr>
          </thead>
          <tbody>
            {co2.bom.map((b, i) => (
              <tr key={i} className="border-t border-neutral-850">
                <Td>{b.item}</Td>
                <Td>{b.size}</Td>
                <Td right strong>
                  {b.unit === 'm' ? b.qty.toFixed(1) : b.qty}
                </Td>
                <Td>{b.unit}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="Pipe flow - NFPA 12 Annex Y / Z method">
        {encs.map((e) => (
          <div key={e.enclosureId} className="flex flex-col gap-1">
            <div className="text-[10px] font-bold text-cyan-300 font-mono">
              {e.enclosureId} {e.name} - {e.flowRows.length} segments
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>Pipe</Th>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th right>lb/min</Th>
                  <Th right>Size in</Th>
                  <Th right>ID in</Th>
                  <Th right>L ft</Th>
                  <Th right>Fit. ft</Th>
                  <Th right>P start</Th>
                  <Th right>P end</Th>
                  <Th right>Y1</Th>
                  <Th right>Y2</Th>
                  <Th right>Z1</Th>
                  <Th right>Z2</Th>
                </tr>
              </thead>
              <tbody>
                {e.flowRows.map((r) => (
                  <tr key={r.pipeId} className="border-t border-neutral-850">
                    <Td strong>{r.pipeId}</Td>
                    <Td>{r.fromNode}</Td>
                    <Td>{r.toNode}</Td>
                    <Td right>{f1(r.flowLbMin, 0)}</Td>
                    <Td right>{r.sizeIn}</Td>
                    <Td right>{f1(r.idIn, 3)}</Td>
                    <Td right>{f1(r.lengthFt)}</Td>
                    <Td right>{f1(r.fittingsFt)}</Td>
                    <Td right>{f1(r.startPsi, 0)}</Td>
                    <Td right>{f1(r.endPsi, 0)}</Td>
                    <Td right>{f1(r.y1, 0)}</Td>
                    <Td right>{f1(r.y2, 0)}</Td>
                    <Td right>{f1(r.z1, 3)}</Td>
                    <Td right>{f1(r.z2, 3)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ))}
      </Card>
    </div>
  )
}

// ─────────────────────────── drawings & downloads ───────────────────────────

type Co2Drawings = ReturnType<typeof generateCo2Drawings>

const DrawingsSection: React.FC<{ result: FireDesignResult }> = ({ result }) => {
  const built = useMemo((): { d: Co2Drawings | null; error: string | null } => {
    if (!result.co2 || result.co2.floors.length === 0) return { d: null, error: null }
    try {
      return { d: generateCo2Drawings(result), error: null }
    } catch (e) {
      return { d: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [result])
  const d = built.d
  const base = safeFileName(result.input.projectName)
  const [pick, setPick] = useState<string>('schematic')
  const [show, setShow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dwg, setDwg] = useState<DwgExportStatus | null>(null)
  const [reportErr, setReportErr] = useState<string | null>(null)

  if (!result.co2 || result.co2.floors.length === 0)
    return (
      <Card title="4. Drawings and downloads">
        <div className="text-xs text-neutral-400">
          Add a floor with a protected enclosure to enable drawings.
        </div>
      </Card>
    )
  if (!d)
    return (
      <Card title="4. Drawings and downloads">
        <div className="text-xs text-red-300">Drawings could not be generated: {built.error}</div>
      </Card>
    )

  const items: { key: string; label: string; file: string; drawing: Drawing }[] = [
    ...d.floors.map((f) => {
      const name = result.co2?.floors.find((x) => x.floorId === f.floorId)?.floorName ?? f.floorId
      return {
        key: `floor:${f.floorId}`,
        label: `Plan - ${name}`,
        file: `${base}_co2_${safeFileName(name)}`,
        drawing: f.drawing
      }
    }),
    { key: 'schematic', label: 'Schematic', file: `${base}_co2_schematic`, drawing: d.schematic },
    {
      key: 'calculations',
      label: 'Calculations',
      file: `${base}_co2_calculations`,
      drawing: d.calculations
    },
    { key: 'combined', label: 'Combined', file: `${base}_co2_combined`, drawing: d.combined }
  ]
  const active = items.find((i) => i.key === pick) ?? items[items.length - 2]
  const dwgExport = async (dxf: string, name: string): Promise<void> => {
    setBusy(true)
    setDwg({ ok: true, message: 'Converting to DWG...' })
    setDwg(await exportDwgFromApp(dxf, name))
    setBusy(false)
  }
  const report = (): void => {
    try {
      downloadText(`${base}_co2.html`, buildCo2ReportHtml(result, d), 'text/html')
      setReportErr(null)
    } catch (e) {
      setReportErr(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Card
      title="4. Drawings and downloads"
      right={
        <button className={btnGhost} onClick={() => setShow(!show)}>
          {show ? <EyeOff size={13} /> : <Eye size={13} />} {show ? 'Hide preview' : 'Show preview'}
        </button>
      }
    >
      <div className="flex flex-col divide-y divide-neutral-850">
        {items.map((it) => (
          <div key={it.key} className="py-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setPick(it.key)
                setShow(true)
              }}
              className={`text-xs flex-1 min-w-[180px] text-left cursor-pointer ${it.key === active.key ? 'text-orange-300 font-bold' : 'text-neutral-200 hover:text-white'}`}
            >
              {it.label}
            </button>
            <button
              className={btnPrimary}
              onClick={() =>
                downloadText(`${it.file}.dxf`, writeDxf(it.drawing), 'application/dxf')
              }
            >
              <Download size={13} /> DXF
            </button>
            <button
              disabled={busy}
              className={`${btnCls} bg-neutral-100 text-neutral-900 hover:bg-white`}
              onClick={() => void dwgExport(writeDxf(it.drawing), `${it.file}.dwg`)}
            >
              <Download size={13} /> DWG
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btnGhost} onClick={report}>
          <Download size={13} /> HTML report
        </button>
        <span className="text-[10px] text-neutral-600">
          The HTML report is printable (questionnaire, calculation, Y/Z tables and drawings).
        </span>
      </div>
      {reportErr && <Msg ok={false}>Report could not be generated: {reportErr}</Msg>}
      {dwg && <Msg ok={dwg.ok}>{dwg.message}</Msg>}
      {show && (
        <>
          <div className="text-[10px] text-neutral-500">Preview: {active.label}</div>
          <DrawingPreview drawing={active.drawing} fileBase={active.file} />
        </>
      )}
    </Card>
  )
}

// ─────────────────────────── example ───────────────────────────

function loadExample(): void {
  const dxf = buildSampleFloorDxf()
  const plan = importFloorPlanDxf(dxf)
  const layers = ['A-ROOM']
  const rooms = detect(plan, layers)
  const storageRoom = rooms.find((r) => /storage/i.test(r.name)) ?? rooms[1] ?? rooms[0]
  const surfaceRoom =
    rooms.find((r) => r !== storageRoom && /corridor/i.test(r.name)) ??
    rooms.find((r) => r !== storageRoom)
  const answers: Co2Answers = { ...defaultCo2Answers(), reserve: true }
  const base: Co2DesignInput = { answers, floors: [] }
  const encs: Co2EnclosureInput[] = []
  if (storageRoom)
    encs.push({
      ...co2EnclosureFromRoom(storageRoom, 'Z1'),
      name: 'Records storage',
      fireType: 'deep-seated',
      deepSeated: 'records',
      heightM: 3.5
    })
  if (surfaceRoom)
    encs.push({
      ...co2EnclosureFromRoom(surfaceRoom, 'Z2'),
      name: 'Flammable liquids store',
      fireType: 'surface',
      material: 'gasoline'
    })
  const floor: Co2FloorInput = {
    ...blankFloor([]),
    planDxf: dxf,
    enclosures: encs,
    storage: { x: 21500, y: 3000 }
  }
  commit({ ...base, floors: [floor] })
}

// ─────────────────────────── panel ───────────────────────────

export const Co2Panel: React.FC<{ result: FireDesignResult }> = ({ result }) => {
  const design = useFireProtectionStore((s) => s.input.co2Design) ?? null
  const [sel, setSel] = useState(0)

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <Wind size={16} className="text-red-500" />
      <div className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex-1 min-w-[200px]">
        CO2 total flooding system (NFPA 12)
      </div>
      <button
        className={btnGhost}
        onClick={() => {
          loadExample()
          setSel(0)
        }}
      >
        <Wand2 size={13} /> Load example
      </button>
      {design && (
        <button
          className={`${btnGhost} text-red-400`}
          onClick={() => {
            commit(undefined)
            setSel(0)
          }}
        >
          <Trash2 size={13} /> Remove CO2 design
        </button>
      )}
    </div>
  )

  if (!design)
    return (
      <div className="flex flex-col gap-4 w-full">
        {header}
        <Card title="CO2 design">
          <div className="text-xs text-neutral-400 leading-relaxed">
            Design a total-flooding carbon dioxide system from DXF / DWG floor plans: answer the
            questionnaire, import each floor, tick the rooms to protect, then review the CO2
            quantity, discharge rate, cylinders, nozzles, Annex Y/Z pipe flow, and export shop
            drawings and an HTML report.
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={btnPrimary} onClick={() => commit(newDesign())}>
              Start CO2 design
            </button>
            <button className={btnGhost} onClick={loadExample}>
              Load example
            </button>
          </div>
        </Card>
      </div>
    )

  return (
    <div className="flex flex-col gap-4 w-full min-w-0">
      {header}
      <Questionnaire design={design} />
      <FloorsSection design={design} sel={sel} setSel={setSel} result={result} />
      <ResultsSection result={result} />
      <DrawingsSection result={result} />
    </div>
  )
}
