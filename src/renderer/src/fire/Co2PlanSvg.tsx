import React, { useMemo, useRef } from 'react'
import type {
  FloorPlan,
  SprinklerRoomInput
} from '../engine/fireProtection/sprinkler/sprinklerTypes'
import type { Co2EnclosureInput, Co2FloorDesign } from '../engine/fireProtection/co2/co2Types'
import { polyD, underlayPath } from './planGeometry'

const PIPE_COLORS: Record<string, string> = {
  main: '#f43f5e',
  header: '#f97316',
  branch: '#38bdf8'
}
const DEVICE_COLORS: Record<string, string> = {
  'smoke-detector': '#a3e635',
  'heat-detector': '#facc15',
  'horn-strobe': '#e879f9',
  'strobe-outside': '#e879f9',
  'manual-release': '#ef4444',
  'warning-sign': '#fbbf24',
  'lockout-valve': '#22d3ee',
  'selector-valve': '#22d3ee',
  'pressure-switch': '#22d3ee',
  'pressure-relief-vent': '#94a3b8',
  'control-panel': '#f5f5f5'
}

/** Floor plan preview: underlay, detected rooms, CO2 enclosures, nozzles, pipes, devices and the storage point. */
export const Co2PlanSvg: React.FC<{
  plan: FloorPlan | null
  rooms: SprinklerRoomInput[]
  enclosures: Co2EnclosureInput[]
  storage: { x: number; y: number }
  design?: Co2FloorDesign | null
  onPick?: (x: number, y: number) => void
  className?: string
}> = ({ plan, rooms, enclosures, storage, design, onPick, className }) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const under = useMemo(() => underlayPath(plan), [plan])
  const box = useMemo(() => {
    const xs: number[] = [storage.x]
    const ys: number[] = [storage.y]
    if (plan && plan.entities.length > 0) {
      xs.push(plan.bbox.minX, plan.bbox.maxX)
      ys.push(plan.bbox.minY, plan.bbox.maxY)
    }
    for (const r of [...rooms, ...enclosures])
      for (const [x, y] of r.polygon) {
        xs.push(x)
        ys.push(y)
      }
    const cx = xs.filter(Number.isFinite)
    const cy = ys.filter(Number.isFinite)
    const minX = Math.min(...cx, 0)
    const maxX = Math.max(...cx, 1000)
    const minY = Math.min(...cy, 0)
    const maxY = Math.max(...cy, 1000)
    const pad = Math.max(maxX - minX, maxY - minY) * 0.04
    return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad }
  }, [plan, rooms, enclosures, storage.x, storage.y])
  const unit = Math.max(box.w, box.h) / 100
  const enclosureRooms = useMemo(() => new Set(enclosures.map((e) => e.roomId)), [enclosures])

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

  const label = (
    poly: [number, number][],
    text: string,
    fill: string,
    key: string
  ): React.ReactNode => {
    const n = poly.length || 1
    return (
      <text
        key={key}
        x={poly.reduce((s, p) => s + p[0], 0) / n}
        y={-poly.reduce((s, p) => s + p[1], 0) / n}
        fontSize={unit * 1.6}
        textAnchor="middle"
        fill={fill}
        style={{ pointerEvents: 'none' }}
      >
        {text}
      </text>
    )
  }

  return (
    <svg
      ref={svgRef}
      data-testid="co2-plan"
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
        {rooms
          .filter((r) => !enclosureRooms.has(r.id))
          .map((r) => (
            <path
              key={r.id}
              d={polyD(r.polygon, true)}
              fill="rgba(115,115,115,0.12)"
              stroke="#737373"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        {enclosures.map((e) => (
          <path
            key={e.id}
            d={polyD(e.polygon, true)}
            fill="rgba(34,211,238,0.12)"
            stroke="#22d3ee"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {design?.pipes.map((p) => (
          <path
            key={p.id}
            d={polyD(p.points)}
            fill="none"
            stroke={PIPE_COLORS[p.kind] ?? '#38bdf8'}
            strokeWidth={p.kind === 'branch' ? 1.2 : 2.4}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {design?.devices.map((d) => (
          <rect
            key={d.tag}
            x={d.x - unit * 0.4}
            y={d.y - unit * 0.4}
            width={unit * 0.8}
            height={unit * 0.8}
            fill={DEVICE_COLORS[d.kind] ?? '#a3a3a3'}
            stroke="#171717"
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          >
            <title>{`${d.tag} (${d.kind})`}</title>
          </rect>
        ))}
        {design?.enclosures.flatMap((e) =>
          e.nozzles.map((n) => (
            <circle
              key={n.tag}
              cx={n.x}
              cy={n.y}
              r={unit * 0.55}
              fill="#ef4444"
              stroke="#171717"
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${n.tag}: ${n.flowLbMin.toFixed(0)} lb/min @ ${n.pressurePsi.toFixed(0)} psi`}</title>
            </circle>
          ))
        )}
        <circle
          cx={storage.x}
          cy={storage.y}
          r={unit * 1.2}
          fill="#22c55e"
          stroke="#052e16"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </g>
      {rooms
        .filter((r) => !enclosureRooms.has(r.id))
        .map((r) => label(r.polygon, r.id, '#a3a3a3', `r${r.id}`))}
      {enclosures.map((e) => label(e.polygon, `${e.id} ${e.name}`, '#67e8f9', `e${e.id}`))}
    </svg>
  )
}
