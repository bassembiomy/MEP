/** Per-area editor (hazard, ceiling, zone, sprinkler type) and the zones panel of the sprinkler plan editor. */
import React from 'react'
import { Crosshair, Plus, Trash2 } from 'lucide-react'
import type { HazardClass } from '../engine/fireProtection/fpTypes'
import { HAZARD_DESIGN } from '../engine/fireProtection/standards/nfpa13'
import { SPRINKLER_OCCUPANCIES } from '../engine/fireProtection/sprinkler/nfpa13Sprinkler'
import type {
  SprinklerHeadSpec,
  SprinklerRoomInput,
  SprinklerZoneInput
} from '../engine/fireProtection/sprinkler/sprinklerTypes'
import { Check, Field, NumInput, SelectBox, btnGhost, inputCls } from './SprinklerPanel'
import {
  K_OPTIONS,
  ORIENTATION_OPTIONS,
  TEMP_OPTIONS,
  defaultHeadSpec,
  polygonAreaMm2,
  zoneColor,
  zoneIdOf
} from './sprinklerAreaEditing'

const HAZARD_OPTIONS = (Object.keys(HAZARD_DESIGN) as HazardClass[]).map((h) => ({
  value: h,
  label: HAZARD_DESIGN[h].label
}))
const OCCUPANCY_OPTIONS = Object.entries(SPRINKLER_OCCUPANCIES).map(([value, o]) => ({
  value,
  label: o.label
}))

const MIXED = '__mixed__'

/** Editor for one selected area (full) or several (zone + delete only). */
export const AreaEditor: React.FC<{
  areas: SprinklerRoomInput[]
  zones: SprinklerZoneInput[]
  /** Head type chosen automatically by the engine for the area (design result), if known. */
  autoTypeLabel?: string
  onPatch: (ids: string[], patch: Partial<SprinklerRoomInput>) => void
  onDelete: (ids: string[]) => void
}> = ({ areas, zones, autoTypeLabel, onPatch, onDelete }) => {
  if (areas.length === 0)
    return (
      <div className="text-[11px] text-neutral-500 border border-dashed border-neutral-800 rounded-xl p-3">
        Select an area on the plan (or draw a new one) to edit its hazard, ceiling, zone and
        sprinkler type.
      </div>
    )
  const ids = areas.map((a) => a.id)
  const zoneOptions = zones.map((z) => ({ value: z.id, label: `${z.id} - ${z.name}` }))

  if (areas.length > 1) {
    const zid = zoneIdOf(areas[0], zones)
    const same = areas.every((a) => zoneIdOf(a, zones) === zid)
    return (
      <div className="flex flex-col gap-2 border border-neutral-800 rounded-xl p-3 bg-neutral-950/50">
        <div className="text-[10px] font-bold text-orange-500 uppercase">
          {areas.length} areas selected
        </div>
        <Field label="Assign to zone">
          <SelectBox
            ariaLabel="Assign selected areas to zone"
            value={same ? zid : MIXED}
            options={[...(same ? [] : [{ value: MIXED, label: '(mixed)' }]), ...zoneOptions]}
            onChange={(v) => v !== MIXED && onPatch(ids, { zoneId: v })}
          />
        </Field>
        <button className={`${btnGhost} text-red-400 self-start`} onClick={() => onDelete(ids)}>
          <Trash2 size={13} /> Delete {areas.length} areas
        </button>
      </div>
    )
  }

  const a = areas[0]
  const spec = a.headSpec ?? null
  const patchSpec = (p: Partial<SprinklerHeadSpec>): void =>
    onPatch(ids, { headSpec: { ...(spec ?? defaultHeadSpec(a)), ...p } })
  const temp = TEMP_OPTIONS.find((t) => t.value === spec?.tempRatingF)
  const area = polygonAreaMm2(a.polygon) / 1e6

  return (
    <div
      className="flex flex-col gap-3 border border-neutral-800 rounded-xl p-3 bg-neutral-950/50"
      data-testid="area-editor"
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-2.5 h-2.5 rounded-sm"
          style={{ background: zoneColor(zones, zoneIdOf(a, zones)) }}
        />
        <div className="text-[10px] font-bold text-orange-500 uppercase flex-1">
          {a.id} | {a.source === 'drawn' ? 'drawn area' : 'detected room'} | {area.toFixed(1)} m²
        </div>
        <button className={`${btnGhost} text-red-400`} onClick={() => onDelete(ids)}>
          <Trash2 size={13} /> Delete
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name" className="col-span-2">
          <input
            aria-label="Area name"
            className={inputCls}
            value={a.name}
            onChange={(e) => onPatch(ids, { name: e.target.value })}
          />
        </Field>
        <Field label="Occupancy" className="col-span-2">
          <SelectBox
            ariaLabel="Area occupancy"
            value={a.occupancy}
            options={OCCUPANCY_OPTIONS}
            onChange={(o) =>
              onPatch(ids, {
                occupancy: o,
                hazard: SPRINKLER_OCCUPANCIES[o]?.hazard ?? a.hazard,
                heatSource: o === 'kitchen' || o === 'mechanical' ? true : a.heatSource
              })
            }
          />
        </Field>
        <Field label="Hazard" className="col-span-2">
          <SelectBox
            ariaLabel="Area hazard"
            value={a.hazard}
            options={HAZARD_OPTIONS}
            onChange={(h) => onPatch(ids, { hazard: h })}
          />
        </Field>
        <Field label="Ceiling height m">
          <NumInput
            ariaLabel="Area ceiling height"
            value={a.ceilingHeightM}
            step={0.1}
            min={1}
            onChange={(n) => onPatch(ids, { ceilingHeightM: n })}
          />
        </Field>
        <Field label="Ceiling type">
          <SelectBox
            ariaLabel="Area ceiling type"
            value={a.ceilingType}
            options={[
              { value: 'finished-flat', label: 'Finished flat' },
              { value: 'exposed-structure', label: 'Exposed' }
            ]}
            onChange={(c) => onPatch(ids, { ceilingType: c })}
          />
        </Field>
        <Field label="Zone" className="col-span-2">
          <SelectBox
            ariaLabel="Area zone"
            value={zoneIdOf(a, zones)}
            options={zoneOptions}
            onChange={(v) => onPatch(ids, { zoneId: v })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Check
          checked={a.freezing}
          onChange={(b) => onPatch(ids, { freezing: b })}
          label="Freezing"
          ariaLabel="Area freezing"
        />
        <Check
          checked={a.heatSource}
          onChange={(b) => onPatch(ids, { heatSource: b })}
          label="Heat source"
          ariaLabel="Area heat source"
        />
        <Check
          checked={!a.omit}
          onChange={(b) => onPatch(ids, { omit: !b })}
          label="Sprinklered"
          ariaLabel="Area sprinklered"
        />
      </div>
      {a.omit && (
        <input
          aria-label="Area omit reason"
          placeholder="Reason required (NFPA 13 §9.2)"
          className={`${inputCls} ${a.omitReason.trim() ? '' : 'border-red-600'}`}
          value={a.omitReason}
          onChange={(e) => onPatch(ids, { omitReason: e.target.value })}
        />
      )}
      <div className="flex flex-col gap-2 border-t border-neutral-850 pt-3">
        <Field label="Sprinkler type">
          <SelectBox
            ariaLabel="Sprinkler type mode"
            value={spec ? 'designer' : 'auto'}
            options={[
              { value: 'auto', label: 'Automatic (from hazard & ceiling)' },
              { value: 'designer', label: 'Designer-selected' }
            ]}
            onChange={(m) => onPatch(ids, { headSpec: m === 'auto' ? null : defaultHeadSpec(a) })}
          />
        </Field>
        {!spec && (
          <div className="text-[10px] text-neutral-500">
            {autoTypeLabel
              ? `Engine selection: ${autoTypeLabel}.`
              : 'The engine selects K-factor, orientation, response and temperature from the hazard, ceiling, freezing and heat-source flags.'}
          </div>
        )}
        {spec && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="K-factor (gpm/psi½)">
              <SelectBox
                ariaLabel="Sprinkler K-factor"
                value={String(spec.kFactor)}
                options={K_OPTIONS.map((k) => ({ value: String(k), label: `K ${k}` }))}
                onChange={(v) =>
                  patchSpec({ kFactor: parseFloat(v) as SprinklerHeadSpec['kFactor'] })
                }
              />
            </Field>
            <Field label="Response">
              <SelectBox
                ariaLabel="Sprinkler response"
                value={spec.response}
                options={[
                  { value: 'quick', label: 'Quick response' },
                  { value: 'standard', label: 'Standard response' }
                ]}
                onChange={(v) => patchSpec({ response: v })}
              />
            </Field>
            <Field label="Orientation" className="col-span-2">
              <SelectBox
                ariaLabel="Sprinkler orientation"
                value={spec.orientation}
                options={ORIENTATION_OPTIONS}
                onChange={(v) => patchSpec({ orientation: v })}
              />
            </Field>
            <Field label="Temperature rating" className="col-span-2">
              <SelectBox
                ariaLabel="Sprinkler temperature"
                value={String(spec.tempRatingF)}
                options={TEMP_OPTIONS.map((t) => ({ value: String(t.value), label: t.label }))}
                onChange={(v) =>
                  patchSpec({ tempRatingF: parseInt(v, 10) as SprinklerHeadSpec['tempRatingF'] })
                }
              />
            </Field>
            {temp && (
              <div className="col-span-2 text-[10px] text-neutral-500">
                Bulb / class: {temp.label.split(' - ')[1]}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Zones of a floor: add / rename / delete (if empty), choose the active zone, place its control valve. */
export const ZonesPanel: React.FC<{
  zones: SprinklerZoneInput[]
  activeZoneId: string
  onActive: (id: string) => void
  /** Number of areas per zone id. */
  counts: Record<string, number>
  selectedCount: number
  onAdd: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onPlaceValve: (id: string) => void
  onAssignSelected: (id: string) => void
}> = ({
  zones,
  activeZoneId,
  onActive,
  counts,
  selectedCount,
  onAdd,
  onRename,
  onDelete,
  onPlaceValve,
  onAssignSelected
}) => (
  <div className="flex flex-col gap-2" data-testid="zones-panel">
    <div className="flex items-center gap-2">
      <div className="text-[9px] font-bold text-neutral-500 uppercase tracking-wide flex-1">
        Zones (one control valve each)
      </div>
      <button className={btnGhost} onClick={onAdd}>
        <Plus size={13} /> Add zone
      </button>
    </div>
    <div className="flex flex-col gap-1.5">
      {zones.map((z) => {
        const active = z.id === activeZoneId
        const n = counts[z.id] ?? 0
        return (
          <div
            key={z.id}
            className={`rounded-lg border p-1.5 flex flex-col gap-1.5 ${active ? 'border-red-600 bg-red-950/20' : 'border-neutral-800 bg-neutral-950/50'}`}
          >
            <div className="flex items-center gap-1.5">
              <input
                type="radio"
                name="active-zone"
                aria-label={`Active zone ${z.id}`}
                className="accent-red-600"
                checked={active}
                onChange={() => onActive(z.id)}
              />
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: zoneColor(zones, z.id) }}
              />
              <span className="text-[10px] font-mono text-neutral-400 w-6">{z.id}</span>
              <input
                aria-label={`Zone name ${z.id}`}
                className={inputCls}
                value={z.name}
                onChange={(e) => onRename(z.id, e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
              <span className="font-mono flex-1">
                {n} area{n === 1 ? '' : 's'} | ZCV {Math.round(z.riser.x)}, {Math.round(z.riser.y)}
              </span>
              <button
                className={`${btnGhost} !px-2 !py-1`}
                title="Place the zone control valve on the plan"
                onClick={() => onPlaceValve(z.id)}
              >
                <Crosshair size={12} /> Place valve
              </button>
              {selectedCount > 0 && (
                <button
                  className={`${btnGhost} !px-2 !py-1`}
                  onClick={() => onAssignSelected(z.id)}
                >
                  Assign {selectedCount}
                </button>
              )}
              <button
                className={`${btnGhost} !px-2 !py-1 text-red-400`}
                disabled={n > 0 || zones.length <= 1}
                title={
                  n > 0
                    ? 'Move its areas to another zone first'
                    : zones.length <= 1
                      ? 'Last zone'
                      : 'Delete zone'
                }
                aria-label={`Delete zone ${z.id}`}
                onClick={() => onDelete(z.id)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  </div>
)
