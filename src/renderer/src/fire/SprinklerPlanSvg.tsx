import React, { useMemo, useRef } from 'react'
import type {
  FloorPlan,
  SprinklerFloorDesign,
  SprinklerRoomInput,
  SprinklerZoneInput
} from '../engine/fireProtection/sprinkler/sprinklerTypes'
import { polyD, underlayPath } from './planGeometry'
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
  flowingTags?: string[]
  onPick?: (x: number, y: number) => void
  className?: string
}> = ({ plan, rooms, riser, zones, design, flowingTags, onPick, className }) => {
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
