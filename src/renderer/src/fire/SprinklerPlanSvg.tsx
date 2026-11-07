import React, { useMemo, useRef } from 'react'
import type {
  FloorPlan,
  SprinklerFloorDesign,
  SprinklerObstruction,
  SprinklerRoomInput,
  SprinklerZoneInput
} from '../engine/fireProtection/sprinkler/sprinklerTypes'
import { polyD, underlayPath } from './planGeometry'
import { polygonBounds } from './sprinklerAreaEditing'
import { zoneColor, zoneIdOf } from './sprinklerAreaEditing'

const PIPE_COLORS: Record<string, string> = {
  branch: '#38bdf8',
  'cross-main': '#f97316',
  'riser-nipple': '#f43f5e',
  feed: '#f43f5e'
}

export const SprinklerPlanSvg: React.FC<{
  plan: FloorPlan | null
  rooms: SprinklerRoomInput[]
  riser: { x: number; y: number }
  zones?: SprinklerZoneInput[]
  design?: SprinklerFloorDesign | null
  obstructions?: SprinklerObstruction[]
  flowingTags?: string[]
  onPick?: (x: number, y: number) => void
  className?: string
}> = ({ plan, rooms, riser, zones, design, obstructions, flowingTags, onPick, className }) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const under = useMemo(() => underlayPath(plan), [plan])
  const box = useMemo(() => {
    const xs: number[] = [riser.x]
    const ys: number[] = [riser.y]
    if (plan && plan.entities.length > 0) {
      xs.push(plan.bbox.minX, plan.bbox.maxX)
      ys.push(plan.bbox.minY, plan.bbox.maxY)
    }
    for (const r of rooms)
      for (const [x, y] of r.polygon) {
        xs.push(x)
        ys.push(y)
      }
    const clean = (a: number[]): number[] => a.filter((v) => Number.isFinite(v))
    const cx = clean(xs)
    const cy = clean(ys)
    const minX = Math.min(...cx, 0)
    const maxX = Math.max(...cx, 1000)
    const minY = Math.min(...cy, 0)
    const maxY = Math.max(...cy, 1000)
    const pad = Math.max(maxX - minX, maxY - minY) * 0.04
    return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad }
  }, [plan, rooms, riser.x, riser.y])
  const unit = Math.max(box.w, box.h) / 100 // ~1 % of the view
  const clearances = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of design?.obstructions ?? [])
      if (Number.isFinite(r.requiredClearanceMm) && r.rule !== 'wide')
        m.set(r.id, r.requiredClearanceMm)
    return m
  }, [design])
  const flowing = useMemo(() => new Set(flowingTags ?? []), [flowingTags])

  const handleClick = (e: React.MouseEvent<SVGSVGElement>): void => {
    const svg = svgRef.current
    if (!onPick || !svg) return
    const m = svg.getScreenCTM()
    if (!m) return
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(m.inverse())
    onPick(Math.round(p.x), Math.round(-p.y))
  }

  return (
    <svg
      ref={svgRef}
      data-testid="sprinkler-plan"
      viewBox={`${box.x} ${-(box.y + box.h)} ${box.w} ${box.h}`}
      className={`bg-neutral-950 rounded-xl border border-neutral-800 w-full ${onPick ? 'cursor-crosshair' : ''} ${className ?? ''}`}
      preserveAspectRatio="xMidYMid meet"
      onClick={handleClick}
    >
      <defs>
        <pattern
          id="obs-hatch-res"
          width={unit * 1.1}
          height={unit * 1.1}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width={unit * 1.1} height={unit * 1.1} fill="#404040" fillOpacity={0.55} />
          <line x1={0} y1={0} x2={0} y2={unit * 1.1} stroke="#b4b4b4" strokeWidth={unit * 0.25} />
        </pattern>
      </defs>
      <g transform="scale(1,-1)">
        {under && (
          <path
            d={under}
            fill="none"
            stroke="#525252"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {rooms.map((r) => (
          <path
            key={r.id}
            d={polyD(r.polygon, true)}
            fill={r.omit ? '#737373' : zones ? zoneColor(zones, zoneIdOf(r, zones)) : '#ea580c'}
            fillOpacity={r.omit ? 0.25 : 0.14}
            stroke={r.omit ? '#737373' : zones ? zoneColor(zones, zoneIdOf(r, zones)) : '#ea580c'}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {(obstructions ?? []).map((o) => {
          const b = polygonBounds(o.polygon)
          const c = clearances.get(o.id) ?? 0
          return (
            <g key={o.id}>
              {c > 0 && (
                <rect
                  x={b.minX - c}
                  y={b.minY - c}
                  width={b.maxX - b.minX + 2 * c}
                  height={b.maxY - b.minY + 2 * c}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={1.2}
                  strokeDasharray="6 4"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <path
                d={polyD(o.polygon, true)}
                fill="url(#obs-hatch-res)"
                stroke="#a3a3a3"
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )
        })}
        {design?.pipes.map((p) => (
          <path
            key={p.id}
            d={polyD(p.points)}
            fill="none"
            stroke={PIPE_COLORS[p.kind] ?? '#38bdf8'}
            strokeWidth={p.kind === 'branch' ? 1.2 : 2.2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {design?.heads.map((h) => (
          <circle
            key={h.tag}
            cx={h.x}
            cy={h.y}
            r={unit * (flowing.has(h.tag) ? 0.7 : 0.45)}
            fill={flowing.has(h.tag) ? '#ef4444' : '#e5e5e5'}
            stroke="#171717"
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {design?.heads
          .filter((h) => (h.relocatedMm ?? 0) > 0)
          .map((h) => (
            <circle
              key={`rel-${h.tag}`}
              cx={h.x}
              cy={h.y}
              r={unit * 1.15}
              fill="none"
              stroke="#facc15"
              strokeWidth={1.6}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        {design?.heads
          .filter((h) => h.belowObstruction)
          .map((h) => (
            <rect
              key={`blw-${h.tag}`}
              x={h.x - unit * 1.1}
              y={h.y - unit * 1.1}
              width={unit * 2.2}
              height={unit * 2.2}
              fill="none"
              stroke="#e879f9"
              strokeWidth={1.6}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        {(zones && zones.length > 0 ? zones : [{ id: 'Z1', name: '', riser }]).map((z) => (
          <rect
            key={z.id}
            x={z.riser.x - unit * 1.1}
            y={z.riser.y - unit * 1.1}
            width={unit * 2.2}
            height={unit * 2.2}
            fill={zones ? zoneColor(zones, z.id) : '#22c55e'}
            stroke="#052e16"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      {/* obstruction ids, relocated / below-obstruction head notes */}
      {(obstructions ?? []).map((o) => {
        const b = polygonBounds(o.polygon)
        return (
          <text
            key={o.id}
            x={(b.minX + b.maxX) / 2}
            y={-(b.minY + b.maxY) / 2}
            fontSize={unit * 1.2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontWeight={700}
            fill="#fafafa"
            stroke="#0a0a0a"
            strokeWidth={unit * 0.26}
            paintOrder="stroke"
            style={{ pointerEvents: 'none' }}
          >
            {o.id}
          </text>
        )
      })}
      {design?.heads
        .filter((h) => (h.relocatedMm ?? 0) > 0 || h.belowObstruction)
        .map((h) => (
          <text
            key={`note-${h.tag}`}
            x={h.x + unit * 1.5}
            y={-h.y - unit * 1.4}
            fontSize={unit * 1.05}
            fontWeight={700}
            fill={h.belowObstruction ? '#f0abfc' : '#fde047'}
            stroke="#0a0a0a"
            strokeWidth={unit * 0.22}
            paintOrder="stroke"
            style={{ pointerEvents: 'none' }}
          >
            {h.belowObstruction
              ? `BELOW ${h.belowObstruction}`
              : `MOVED \u2192 ${Math.round(h.relocatedMm ?? 0)} mm`}
          </text>
        ))}
      {/* room names (outside the flipped group so text is upright) */}
      {rooms.map((r) => {
        const n = r.polygon.length || 1
        const cx = r.polygon.reduce((s, p) => s + p[0], 0) / n
        const cy = r.polygon.reduce((s, p) => s + p[1], 0) / n
        return (
          <text
            key={r.id}
            x={cx}
            y={-cy}
            fontSize={unit * 1.6}
            textAnchor="middle"
            fill="#fdba74"
            style={{ pointerEvents: 'none' }}
          >
            {zones ? r.name : r.id}
          </text>
        )
      })}
    </svg>
  )
}
