/** Obstruction panels of the sprinkler wizard (NFPA 13-2019 §10.2.7): layer mapping, list / editor, result table. */
import React from 'react'
import { ScanSearch, Trash2 } from 'lucide-react'
import type {
  ObstructionKind,
  ObstructionLayerMapping,
  ObstructionResult,
  SprinklerObstruction
} from '../engine/fireProtection/sprinkler/sprinklerTypes'
import type { DesignCheck } from '../engine/fireProtection/fpTypes'
import { Check, Field, NumInput, SelectBox, btnGhost, btnPrimary } from './SprinklerPanel'
import { StatusChip } from './FireResultsPanels'
import {
  OBSTRUCTION_KIND_LABEL,
  OBSTRUCTION_KIND_OPTIONS,
  OBSTRUCTION_RULE_LABEL,
  defaultObstructionDepthMm,
  obstructionSizeMm
} from './sprinklerAreaEditing'

export interface LayerMappingRow extends ObstructionLayerMapping {
  on: boolean
}

/** DXF layer -> obstruction kind / depth mapping, with the "Detect obstructions" action. */
export const ObstructionLayersPanel: React.FC<{
  rows: { layer: string; label: string }[]
  mapping: Record<string, LayerMappingRow>
  ceilingHeightM: number
  disabled: boolean
  onChange: (layer: string, patch: Partial<LayerMappingRow>) => void
  onDetect: () => void
}> = ({ rows, mapping, ceilingHeightM, disabled, onChange, onDetect }) => (
  <div className="flex flex-col gap-1.5" data-testid="obstruction-layers">
    <div className="text-[9px] font-bold text-neutral-500 uppercase tracking-wide">
      Obstruction layers (beams, ducts, trays ...)
    </div>
    {rows.length === 0 && (
      <div className="text-[11px] text-neutral-600">Upload a plan to list its layers.</div>
    )}
    <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">
      {rows.map(({ layer, label }) => {
        const m = mapping[layer]
        if (!m) return null
        return (
          <div
            key={layer}
            className="flex flex-col gap-1 rounded-lg border border-neutral-850 bg-neutral-950/50 p-1.5"
          >
            <Check
              checked={m.on}
              onChange={(on) => onChange(layer, { on })}
              label={label}
              ariaLabel={`Obstruction layer ${layer}`}
            />
            {m.on && (
              <div className="grid grid-cols-[1fr_84px] gap-1.5">
                <SelectBox
                  ariaLabel={`Kind of ${layer}`}
                  value={m.kind}
                  options={OBSTRUCTION_KIND_OPTIONS}
                  onChange={(kind: ObstructionKind) =>
                    onChange(layer, {
                      kind,
                      bottomBelowCeilingMm: defaultObstructionDepthMm(kind, ceilingHeightM)
                    })
                  }
                />
                <NumInput
                  ariaLabel={`Bottom below ceiling mm of ${layer}`}
                  value={m.bottomBelowCeilingMm}
                  step={50}
                  min={0}
                  onChange={(n) => onChange(layer, { bottomBelowCeilingMm: n })}
                />
                <div className="col-span-2 text-[9px] text-neutral-600">
                  bottom below ceiling, mm
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
    <button disabled={disabled} onClick={onDetect} className={btnPrimary}>
      <ScanSearch size={13} /> Detect obstructions
    </button>
  </div>
)

/** List of the floor's obstructions with the editor of the selected one. */
export const ObstructionPanel: React.FC<{
  obstructions: SprinklerObstruction[]
  selectedId: string | null
  drawKind: ObstructionKind
  drawDepthMm: number
  ceilingHeightM: number
  onSelect: (id: string | null) => void
  onPatch: (id: string, patch: Partial<SprinklerObstruction>) => void
  onDelete: (id: string) => void
  onDrawKind: (k: ObstructionKind) => void
  onDrawDepth: (mm: number) => void
}> = ({
  obstructions,
  selectedId,
  drawKind,
  drawDepthMm,
  ceilingHeightM,
  onSelect,
  onPatch,
  onDelete,
  onDrawKind,
  onDrawDepth
}) => {
  const sel = obstructions.find((o) => o.id === selectedId)
  const th = 'py-1 pr-2 font-bold'
  return (
    <div
      className="flex flex-col gap-2 border border-neutral-800 rounded-xl p-3 bg-neutral-950/50"
      data-testid="obstruction-panel"
    >
      <div className="text-[10px] font-bold text-orange-500 uppercase">
        Obstructions ({obstructions.length})
      </div>
      <div className="grid grid-cols-[1fr_90px] gap-2">
        <Field label="Draw tool - kind">
          <SelectBox
            ariaLabel="New obstruction kind"
            value={drawKind}
            options={OBSTRUCTION_KIND_OPTIONS}
            onChange={(k) => {
              onDrawKind(k)
              onDrawDepth(defaultObstructionDepthMm(k, ceilingHeightM))
            }}
          />
        </Field>
        <Field label="Depth mm">
          <NumInput
            ariaLabel="New obstruction depth mm"
            value={drawDepthMm}
            step={50}
            min={0}
            onChange={onDrawDepth}
          />
        </Field>
      </div>
      {sel && (
        <div className="grid grid-cols-[1fr_90px_auto] gap-2 items-end border-t border-neutral-850 pt-2">
          <Field label={`${sel.id} kind`}>
            <SelectBox
              ariaLabel="Obstruction kind"
              value={sel.kind}
              options={OBSTRUCTION_KIND_OPTIONS}
              onChange={(kind) => onPatch(sel.id, { kind })}
            />
          </Field>
          <Field label="Depth mm">
            <NumInput
              ariaLabel="Obstruction depth mm"
              value={sel.bottomBelowCeilingMm}
              step={50}
              min={0}
              onChange={(n) => onPatch(sel.id, { bottomBelowCeilingMm: n })}
            />
          </Field>
          <button
            className={`${btnGhost} text-red-400`}
            aria-label="Delete obstruction"
            onClick={() => onDelete(sel.id)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
      {obstructions.length === 0 ? (
        <div className="text-[11px] text-neutral-500">
          None. Map DXF layers and press Detect, or use the Draw obstruction tool (drag a
          rectangle).
        </div>
      ) : (
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="text-neutral-500 uppercase text-[9px] tracking-wide">
                <th className={th}>Id</th>
                <th className={th}>Kind</th>
                <th className={th}>Size mm</th>
                <th className={th}>Depth</th>
                <th className={th}>Source</th>
              </tr>
            </thead>
            <tbody>
              {obstructions.map((o) => {
                const [w, l] = obstructionSizeMm(o)
                return (
                  <tr
                    key={o.id}
                    onClick={() => onSelect(o.id === selectedId ? null : o.id)}
                    className={`cursor-pointer border-t border-neutral-850 ${o.id === selectedId ? 'bg-neutral-800/60' : 'hover:bg-neutral-900'}`}
                  >
                    <td className="py-1 pr-2 font-mono text-orange-400">{o.id}</td>
                    <td className="py-1 pr-2 text-neutral-300">{OBSTRUCTION_KIND_LABEL[o.kind]}</td>
                    <td className="py-1 pr-2 font-mono text-neutral-300">
                      {Math.round(w)} x {Math.round(l)}
                    </td>
                    <td className="py-1 pr-2 font-mono text-neutral-300">
                      {Math.round(o.bottomBelowCeilingMm)}
                    </td>
                    <td className="py-1 pr-2 text-neutral-500">{o.source ?? 'drawn'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Obstruction schedule of a floor result plus the §10.2.7 check status. */
export const ObstructionResultsTable: React.FC<{
  results: ObstructionResult[]
  check?: DesignCheck
}> = ({ results, check }) => {
  const th = 'py-1.5 pr-3 font-bold'
  const td = 'py-1.5 pr-3 align-top'
  return (
    <div className="flex flex-col gap-2" data-testid="obstruction-results">
      {check && (
        <div className="flex items-start gap-3">
          <div className="w-16 shrink-0 pt-0.5">
            <StatusChip status={check.status} />
          </div>
          <div className="text-[11px] text-neutral-400 leading-relaxed min-w-0">
            <span className="font-semibold text-neutral-200">{check.title}</span>{' '}
            <span className="text-orange-400/80 font-mono">{check.reference}</span>
            <div>{check.detail}</div>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-500 uppercase text-[9px] tracking-wide">
              {[
                'Id',
                'Kind',
                'Size mm',
                'Depth mm',
                'Rule',
                'Required clearance mm',
                'Heads moved',
                'Heads below',
                'Violations'
              ].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((o) => (
              <tr key={o.id} className="border-b border-neutral-850">
                <td className={`${td} font-mono text-orange-400`}>{o.id}</td>
                <td className={`${td} text-neutral-300`}>{OBSTRUCTION_KIND_LABEL[o.kind]}</td>
                <td className={`${td} font-mono`}>
                  {Math.round(o.widthMm)} x {Math.round(o.lengthMm)}
                </td>
                <td className={`${td} font-mono`}>{Math.round(o.bottomBelowCeilingMm)}</td>
                <td className={`${td} text-neutral-300`}>{OBSTRUCTION_RULE_LABEL[o.rule]}</td>
                <td className={`${td} font-mono`}>
                  {Number.isFinite(o.requiredClearanceMm) ? Math.round(o.requiredClearanceMm) : '-'}
                </td>
                <td className={`${td} font-mono`} title={o.relocatedHeads.join(', ')}>
                  {o.relocatedHeads.length}
                </td>
                <td className={`${td} font-mono`} title={o.headsBelow.join(', ')}>
                  {o.headsBelow.length}
                </td>
                <td
                  className={`${td} font-mono ${o.violations.length > 0 ? 'text-red-400 font-bold' : 'text-emerald-400'}`}
                  title={o.violations.join(', ')}
                >
                  {o.violations.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
