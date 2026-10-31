import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileImage, Maximize } from 'lucide-react'
import { useFireProtectionStore } from '../store/fireProtectionStore'
import { renderSvg } from '../engine/fireProtection/drawing/svgRenderer'
import { writeDxf } from '../engine/fireProtection/drawing/dxfWriter'
import { downloadText, safeFileName } from './download'

const BASE_WIDTH = 1200

export const DrawingPreview: React.FC = () => {
  const { drawing, activeSheet, setActiveSheet, input } = useFireProtectionStore()
  const sheetIndex = drawing ? Math.min(activeSheet, Math.max(0, drawing.sheets.length - 1)) : 0

  const svg = useMemo(
    () =>
      drawing ? renderSvg(drawing, { sheetIndex, background: 'white', widthPx: BASE_WIDTH }) : '',
    [drawing, sheetIndex]
  )
  const aspect = useMemo(() => {
    const m = /viewBox="([-\d.eE+]+) ([-\d.eE+]+) ([-\d.eE+]+) ([-\d.eE+]+)"/.exec(svg)
    return m ? parseFloat(m[4]) / parseFloat(m[3]) : 0.7
  }, [svg])
  const pageH = BASE_WIDTH * aspect

  const boxRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  const fit = useCallback(() => {
    const el = boxRef.current
    if (!el) return
    const k = Math.min(el.clientWidth / BASE_WIDTH, el.clientHeight / pageH) * 0.97
    setView({ k, x: (el.clientWidth - BASE_WIDTH * k) / 2, y: (el.clientHeight - pageH * k) / 2 })
  }, [pageH])

  useEffect(() => {
    fit()
  }, [fit, sheetIndex])

  // Wheel zoom about the cursor (needs a non-passive native listener to prevent page scroll).
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      const f = Math.exp(-e.deltaY * 0.0015)
      setView((v) => {
        const k = Math.min(20, Math.max(0.05, v.k * f))
        const r2 = k / v.k
        return { k, x: px - (px - v.x) * r2, y: py - (py - v.y) * r2 }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  if (!drawing) {
    return <div className="text-xs text-neutral-500 p-6">No drawing available.</div>
  }

  const sheet = drawing.sheets[sheetIndex]
  const base = safeFileName(input.projectName)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {drawing.sheets.map((s, i) => (
          <button
            key={s.number}
            onClick={() => setActiveSheet(i)}
            title={s.title}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${
              i === sheetIndex
                ? 'bg-red-600 text-white'
                : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-850'
            }`}
          >
            {s.number}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={fit}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-neutral-900 text-neutral-300 hover:bg-neutral-850 cursor-pointer"
        >
          <Maximize size={13} /> Fit
        </button>
        <button
          onClick={() =>
            downloadText(
              `${base}_${sheet?.number ?? 'sheet'}.svg`,
              renderSvg(drawing, { sheetIndex, background: 'white' }),
              'image/svg+xml'
            )
          }
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-neutral-900 text-neutral-300 hover:bg-neutral-850 cursor-pointer"
        >
          <FileImage size={13} /> Export SVG
        </button>
        <button
          onClick={() => downloadText(`FP_${base}.dxf`, writeDxf(drawing), 'application/dxf')}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-lg shadow-red-500/20 cursor-pointer"
        >
          <Download size={13} /> Export DXF
        </button>
      </div>
      {sheet && (
        <div className="text-[10px] text-neutral-500">
          {sheet.number} - {sheet.title} | {sheet.paper} | 1:{sheet.scale} | scroll to zoom, drag to
          pan
        </div>
      )}
      <div
        ref={boxRef}
        className="relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-800 h-[70vh] min-h-[420px] cursor-grab active:cursor-grabbing select-none"
        onMouseDown={(e) => {
          drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }
        }}
        onMouseMove={(e) => {
          const d = drag.current
          if (d) setView((v) => ({ ...v, x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy }))
        }}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
      >
        <div
          className="absolute top-0 left-0 bg-white shadow-2xl"
          style={{
            width: BASE_WIDTH,
            height: pageH,
            transformOrigin: '0 0',
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  )
}
