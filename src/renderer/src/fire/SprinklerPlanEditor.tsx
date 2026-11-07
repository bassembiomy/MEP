/**
 * Interactive SVG plan editor for the sprinkler wizard: architectural underlay, detected / drawn areas coloured by
 * zone, and three tools — select areas, draw an area (click vertices) and place a zone control valve.
 * Wheel = zoom, drag = pan. Geometry in mm (+y up); the SVG flips y for display.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Hand, Maximize, MousePointer2, PenLine, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import type {
  FloorPlan,
  SprinklerRoomInput,
  SprinklerZoneInput
} from '../engine/fireProtection/sprinkler/sprinklerTypes'
import { polyD, underlayPath } from './planGeometry'
import {
  HAZARD_SHORT,
  buildVertexIndex,
  pointInPolygon,
  polygonAreaMm2,
  polygonCentroid,
  snapPoint,
  zoneColor,
  zoneIdOf
} from './sprinklerAreaEditing'

type Pt = [number, number]
type View = { x: number; y: number; w: number; h: number }
export type PlanTool = 'select' | 'draw' | 'zcv'

const Underlay = React.memo(function Underlay({ d }: { d: string }) {
  if (!d) return null
  return (
    <path d={d} fill="none" stroke="#525252" strokeWidth={1} vectorEffect="non-scaling-stroke" />
  )
})

const AreaShape = React.memo(function AreaShape({
  room,
  color,
  selected
}: {
  room: SprinklerRoomInput
  color: string
  selected: boolean
}) {
  return (
    <path
      d={polyD(room.polygon, true)}
      fill={color}
      fillOpacity={room.omit ? 0.08 : selected ? 0.4 : 0.22}
      stroke={selected ? '#ffffff' : color}
      strokeWidth={selected ? 2.5 : 1.5}
      strokeDasharray={room.omit ? '6 4' : undefined}
      vectorEffect="non-scaling-stroke"
    />
  )
})

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  return !!el && (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable)
}

export const SprinklerPlanEditor: React.FC<{
  plan: FloorPlan | null
  rooms: SprinklerRoomInput[]
  zones: SprinklerZoneInput[]
  activeZoneId: string
  tool: PlanTool
  onToolChange: (t: PlanTool) => void
  selected: string[]
  onSelect: (ids: string[]) => void
  onCreateArea: (polygon: Pt[]) => void
  onPlaceZcv: (x: number, y: number) => void
  onDeleteSelected: () => void
  className?: string
}> = ({
  plan,
  rooms,
  zones,
  activeZoneId,
  tool,
  onToolChange,
  selected,
  onSelect,
  onCreateArea,
  onPlaceZcv,
  onDeleteSelected,
  className
}) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const under = useMemo(() => underlayPath(plan), [plan])
  const vIndex = useMemo(() => buildVertexIndex(plan, rooms), [plan, rooms])
  const selSet = useMemo(() => new Set(selected), [selected])

  const fit = useMemo<View>(() => {
    const xs: number[] = []
    const ys: number[] = []
    for (const z of zones) {
      xs.push(z.riser.x)
      ys.push(z.riser.y)
    }
    if (plan && plan.entities.length > 0) {
      xs.push(plan.bbox.minX, plan.bbox.maxX)
      ys.push(plan.bbox.minY, plan.bbox.maxY)
    }
    for (const r of rooms)
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
    return { x: minX - pad, y: -(maxY + pad), w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad }
  }, [plan, rooms, zones])

  const [view, setView] = useState<View | null>(null)
  const vb = view ?? fit
  const vbRef = useRef(vb)
  useEffect(() => {
    vbRef.current = vb
  }, [vb])

  // draft polygon is tied to the tool it was started with (switching tool discards it)
  const [draftState, setDraftState] = useState<{ tool: PlanTool; pts: Pt[] }>({
    tool,
    pts: []
  })
  const draft = useMemo<Pt[]>(
    () => (draftState.tool === tool ? draftState.pts : []),
    [draftState, tool]
  )
  const setDraft = useCallback((pts: Pt[]) => setDraftState({ tool, pts }), [tool])
  const [cursor, setCursor] = useState<{ p: Pt; kind: 'vertex' | 'grid' } | null>(null)
  const [panning, setPanning] = useState(false)
  const drag = useRef<{
    id: number
    sx: number
    sy: number
    vb: View
    moved: boolean
  } | null>(null)

  const toWorld = useCallback((cx: number, cy: number): Pt | null => {
    const svg = svgRef.current
    const m = svg?.getScreenCTM()
    if (!svg || !m) return null
    const pt = svg.createSVGPoint()
    pt.x = cx
    pt.y = cy
    const p = pt.matrixTransform(m.inverse())
    return [p.x, -p.y]
  }, [])

  // wheel zoom around the cursor (native listener so the page does not scroll)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const m = svg.getScreenCTM()
      if (!m) return
      const pt = svg.createSVGPoint()
      pt.x = e.clientX
      pt.y = e.clientY
      const p = pt.matrixTransform(m.inverse())
      const s = Math.exp(e.deltaY * 0.0015)
      const cur = vbRef.current
      const w = Math.min(Math.max(cur.w * s, 200), 1e8)
      const k = w / cur.w
      setView({ x: p.x - (p.x - cur.x) * k, y: p.y - (p.y - cur.y) * k, w, h: cur.h * k })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const zoomBy = (k: number): void => {
    const cur = vbRef.current
    const cxp = cur.x + cur.w / 2
    const cyp = cur.y + cur.h / 2
    setView({ x: cxp - (cur.w * k) / 2, y: cyp - (cur.h * k) / 2, w: cur.w * k, h: cur.h * k })
  }

  const pxToMm = (px: number): number => {
    const m = svgRef.current?.getScreenCTM()
    return m && m.a > 0 ? px / m.a : px * (vb.w / 800)
  }

  const closeDraft = useCallback(
    (pts: Pt[]): void => {
      if (pts.length >= 3) onCreateArea(pts)
      setDraft([])
    },
    [onCreateArea, setDraft]
  )

  // Esc cancels / Backspace removes the last vertex / Delete removes the selected areas
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target)) return
      if (e.key === 'Escape') {
        if (draft.length > 0) setDraft([])
        else if (tool !== 'select') onToolChange('select')
        else if (selected.length > 0) onSelect([])
      } else if (e.key === 'Backspace' && draft.length > 0) {
        e.preventDefault()
        setDraft(draft.slice(0, -1))
      } else if (e.key === 'Delete' && draft.length === 0 && selected.length > 0) {
        onDeleteSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft, tool, selected, setDraft, onToolChange, onSelect, onDeleteSelected])

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0 && e.button !== 1) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      vb: vbRef.current,
      moved: false
    }
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const d = drag.current
    if (d && d.id === e.pointerId) {
      const dx = e.clientX - d.sx
      const dy = e.clientY - d.sy
      if (!d.moved && Math.hypot(dx, dy) > 4) {
        d.moved = true
        setPanning(true)
      }
      if (d.moved) {
        const m = svgRef.current?.getScreenCTM()
        if (m && m.a > 0) setView({ ...d.vb, x: d.vb.x - dx / m.a, y: d.vb.y - dy / m.d })
        return
      }
    }
    if (tool === 'select') {
      if (cursor) setCursor(null)
      return
    }
    const w = toWorld(e.clientX, e.clientY)
    if (!w) return
    const prev = draft.length > 0 ? draft[draft.length - 1] : null
    setCursor(snapPoint(vIndex, w[0], w[1], prev, e.shiftKey && tool === 'draw'))
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>): void => {
    const d = drag.current
    drag.current = null
    setPanning(false)
    if (!d || d.moved || e.button !== 0) return
    const w = toWorld(e.clientX, e.clientY)
    if (!w) return
    if (tool === 'select') {
      // innermost (smallest) area under the cursor
      let hit: SprinklerRoomInput | null = null
      let best = Infinity
      for (const r of rooms) {
        if (!pointInPolygon(w[0], w[1], r.polygon)) continue
        const a = polygonAreaMm2(r.polygon)
        if (a < best) {
          best = a
          hit = r
        }
      }
      if (!hit) onSelect([])
      else if (e.shiftKey || e.ctrlKey || e.metaKey)
        onSelect(selSet.has(hit.id) ? selected.filter((i) => i !== hit.id) : [...selected, hit.id])
      else onSelect([hit.id])
      return
    }
    const prev = draft.length > 0 ? draft[draft.length - 1] : null
    const s = snapPoint(vIndex, w[0], w[1], prev, e.shiftKey && tool === 'draw')
    if (tool === 'zcv') {
      onPlaceZcv(s.p[0], s.p[1])
      return
    }
    // draw
    if (draft.length >= 3) {
      const f = draft[0]
      if (Math.hypot(s.p[0] - f[0], s.p[1] - f[1]) <= Math.max(150, pxToMm(10))) {
        closeDraft(draft)
        return
      }
    }
    if (prev && prev[0] === s.p[0] && prev[1] === s.p[1]) return
    setDraft([...draft, s.p])
  }

  const onDoubleClick = (): void => {
    if (tool === 'draw') closeDraft(draft)
  }

  const unit = Math.max(vb.w, vb.h) / 100
  const areaLabels = rooms.map((r) => {
    const [cx, cy] = polygonCentroid(r.polygon)
    const a = polygonAreaMm2(r.polygon)
    const fs = Math.min(unit * 1.5, Math.sqrt(a) / 9)
    return { r, cx, cy, fs, show: fs >= unit * 0.45 }
  })

  const tools: { id: PlanTool; label: string; icon: React.ReactNode }[] = [
    { id: 'select', label: 'Select', icon: <MousePointer2 size={13} /> },
    { id: 'draw', label: 'Draw area', icon: <PenLine size={13} /> },
    { id: 'zcv', label: 'Place zone control valve', icon: <Hand size={13} /> }
  ]
  const tbtn = (active: boolean): string =>
    `flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border ${active ? 'bg-red-600 text-white border-red-600' : 'bg-neutral-900 text-neutral-300 border-neutral-800 hover:bg-neutral-850'}`
  const hint =
    tool === 'draw'
      ? draft.length === 0
        ? 'Click to start an area. Snaps to plan vertices (300 mm) or a 100 mm grid; hold Shift for orthogonal.'
        : `${draft.length} point${draft.length > 1 ? 's' : ''} - click the first point or double-click to close, Backspace = undo point, Esc = cancel.`
      : tool === 'zcv'
        ? `Click the plan to place the zone control valve of ${activeZoneId}.`
        : 'Click an area to select it (Shift = add to selection, Delete = remove). Wheel = zoom, drag = pan.'
  const cursorCls = panning
    ? 'cursor-grabbing'
    : tool === 'select'
      ? 'cursor-default'
      : 'cursor-crosshair'

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        {tools.map((t) => (
          <button
            key={t.id}
            data-testid={`tool-${t.id}`}
            aria-pressed={tool === t.id}
            className={tbtn(tool === t.id)}
            onClick={() => onToolChange(t.id)}
          >
            {t.icon} {t.label}
          </button>
        ))}
        <button
          className={`${tbtn(false)} disabled:opacity-40`}
          disabled={selected.length === 0}
          onClick={onDeleteSelected}
        >
          <Trash2 size={13} /> Delete
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button className={tbtn(false)} aria-label="Zoom in" onClick={() => zoomBy(0.7)}>
            <ZoomIn size={13} />
          </button>
          <button className={tbtn(false)} aria-label="Zoom out" onClick={() => zoomBy(1 / 0.7)}>
            <ZoomOut size={13} />
          </button>
          <button className={tbtn(false)} aria-label="Fit plan" onClick={() => setView(null)}>
            <Maximize size={13} /> Fit
          </button>
        </div>
      </div>
      <svg
        ref={svgRef}
        data-testid="sprinkler-plan-editor"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ touchAction: 'none' }}
        className={`bg-neutral-950 rounded-xl border border-neutral-800 w-full select-none ${cursorCls} ${className ?? ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={onDoubleClick}
      >
        <g transform="scale(1,-1)">
          <Underlay d={under} />
          {rooms.map((r) => (
            <AreaShape
              key={r.id}
              room={r}
              color={zoneColor(zones, zoneIdOf(r, zones))}
              selected={selSet.has(r.id)}
            />
          ))}
          {rooms
            .filter((r) => selSet.has(r.id))
            .flatMap((r) =>
              r.polygon.map(([x, y], i) => (
                <rect
                  key={`${r.id}-${i}`}
                  x={x - unit * 0.35}
                  y={y - unit * 0.35}
                  width={unit * 0.7}
                  height={unit * 0.7}
                  fill="#ffffff"
                  stroke="#171717"
                  strokeWidth={0.5}
                  vectorEffect="non-scaling-stroke"
                />
              ))
            )}
          {zones.map((z) => (
            <rect
              key={z.id}
              x={z.riser.x - unit * 1.1}
              y={z.riser.y - unit * 1.1}
              width={unit * 2.2}
              height={unit * 2.2}
              fill={zoneColor(zones, z.id)}
              stroke={z.id === activeZoneId ? '#ffffff' : '#052e16'}
              strokeWidth={z.id === activeZoneId ? 2 : 1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {tool === 'draw' && draft.length > 0 && (
            <>
              <path
                d={polyD(cursor ? [...draft, cursor.p] : draft)}
                fill="none"
                stroke="#fafafa"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                vectorEffect="non-scaling-stroke"
              />
              {draft.map(([x, y], i) => (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={unit * (i === 0 ? 0.9 : 0.5)}
                  fill={i === 0 ? '#22c55e' : '#fafafa'}
                  stroke="#171717"
                  strokeWidth={0.5}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </>
          )}
          {cursor && tool !== 'select' && (
            <circle
              cx={cursor.p[0]}
              cy={cursor.p[1]}
              r={unit * 0.7}
              fill="none"
              stroke={cursor.kind === 'vertex' ? '#22c55e' : '#fbbf24'}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
        {/* labels outside the flipped group so the text is upright */}
        {areaLabels
          .filter((l) => l.show)
          .map(({ r, cx, cy, fs }) => (
            <g key={r.id} style={{ pointerEvents: 'none' }}>
              <text
                x={cx}
                y={-cy - fs * 0.15}
                fontSize={fs}
                textAnchor="middle"
                fontWeight={600}
                fill="#f5f5f5"
                stroke="#0a0a0a"
                strokeWidth={fs * 0.18}
                paintOrder="stroke"
              >
                {r.name}
              </text>
              <text
                x={cx}
                y={-cy + fs * 1.05}
                fontSize={fs * 0.8}
                textAnchor="middle"
                fill={zoneColor(zones, zoneIdOf(r, zones))}
                stroke="#0a0a0a"
                strokeWidth={fs * 0.16}
                paintOrder="stroke"
              >
                {r.omit ? 'NO SPRINKLERS' : HAZARD_SHORT[r.hazard]} | {zoneIdOf(r, zones)}
                {r.headSpec ? ` | K${r.headSpec.kFactor}` : ''}
              </text>
            </g>
          ))}
        {zones.map((z) => (
          <text
            key={z.id}
            x={z.riser.x}
            y={-z.riser.y - unit * 1.6}
            fontSize={unit * 1.6}
            textAnchor="middle"
            fontWeight={700}
            fill="#fafafa"
            stroke="#0a0a0a"
            strokeWidth={unit * 0.3}
            paintOrder="stroke"
            style={{ pointerEvents: 'none' }}
          >
            ZCV {z.id}
          </text>
        ))}
      </svg>
      <div className="text-[10px] text-neutral-500 flex flex-wrap gap-x-3">
        <span>{hint}</span>
        {cursor && tool !== 'select' && (
          <span className="font-mono text-neutral-400">
            {cursor.kind === 'vertex' ? 'vertex' : 'grid'} {cursor.p[0]}, {cursor.p[1]} mm
          </span>
        )}
      </div>
    </div>
  )
}
