import React, { useMemo, useRef } from 'react'
import type {
  FloorPlan,
  SprinklerFloorDesign,
  SprinklerRoomInput
} from '../engine/fireProtection/sprinkler/sprinklerTypes'

type Pt = [number, number]

function underlayPath(plan: FloorPlan | null): string {
  if (!plan) return ''
  const f = (v: number): string => (Number.isFinite(v) ? v.toFixed(0) : '0')
  const d: string[] = []
  for (const e of plan.entities) {
    if (e.kind === 'line' && e.points.length >= 2) {
      d.push(`M${f(e.points[0][0])} ${f(e.points[0][1])}L${f(e.points[1][0])} ${f(e.points[1][1])}`)
    } else if (e.kind === 'polyline' && e.points.length >= 2) {
      d.push('M' + e.points.map((p) => `${f(p[0])} ${f(p[1])}`).join('L') + (e.closed ? 'Z' : ''))
    } else if (e.kind === 'circle' && e.radius && e.points[0]) {
      const [cx, cy] = e.points[0]
      const r = e.radius
      d.push(
        `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`
      )
    } else if (e.kind === 'arc' && e.radius && e.points[0]) {
      const [cx, cy] = e.points[0]
      const a0 = ((e.startDeg ?? 0) * Math.PI) / 180
      let a1 = ((e.endDeg ?? 360) * Math.PI) / 180
      if (a1 <= a0) a1 += 2 * Math.PI
      const n = Math.max(4, Math.ceil((a1 - a0) / (Math.PI / 12)))
      const pts: string[] = []
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n
        pts.push(`${f(cx + e.radius * Math.cos(a))} ${f(cy + e.radius * Math.sin(a))}`)
      }
      d.push('M' + pts.join('L'))
    }
  }
  return d.join('')
}

const polyD = (pts: Pt[], close = false): string =>
  pts.length < 2
    ? ''
    : 'M' + pts.map((p) => `${p[0].toFixed(0)} ${p[1].toFixed(0)}`).join('L') + (close ? 'Z' : '')

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
  design?: SprinklerFloorDesign | null
  flowingTags?: string[]
  onPick?: (x: number, y: number) => void
  className?: string
}> = ({ plan, rooms, riser, design, flowingTags, onPick, className }) => {
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
            fill={r.omit ? 'rgba(115,115,115,0.25)' : 'rgba(234,88,12,0.10)'}
            stroke={r.omit ? '#737373' : '#ea580c'}
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
        <circle
          cx={riser.x}
          cy={riser.y}
          r={unit * 1.1}
          fill="#22c55e"
          stroke="#052e16"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
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
            {r.id}
          </text>
        )
      })}
    </svg>
  )
}
