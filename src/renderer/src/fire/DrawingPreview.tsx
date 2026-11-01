import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileImage, Maximize } from 'lucide-react'
import { useFireProtectionStore } from '../store/fireProtectionStore'
import { useShallow } from 'zustand/react/shallow'
import { renderSvg } from '../engine/fireProtection/drawing/svgRenderer'
import { writeDxf } from '../engine/fireProtection/drawing/dxfWriter'
import { downloadText, safeFileName } from './download'
import { exportDwgFromApp, type DwgExportStatus } from './dwgExport'

const BASE_WIDTH = 1200

export const DrawingPreview: React.FC = () => {
  const { drawing, activeSheet, setActiveSheet, projectName } = useFireProtectionStore(
    useShallow((s) => ({
      drawing: s.drawing,
      activeSheet: s.activeSheet,
      setActiveSheet: s.setActiveSheet,
      projectName: s.input.projectName
    }))
  )
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
  const layerRef = useRef<HTMLDivElement>(null)
  // View transform lives in a ref and is applied directly to the DOM (no React re-render per mouse move).
  const view = useRef({ x: 0, y: 0, k: 1 })
  // Width (px) at which the sheet image is rasterised; re-rasterised sharply after zooming settles.
  const [rasterW, setRasterW] = useState(BASE_WIDTH)
  const rasterRef = useRef(BASE_WIDTH)
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const [dwg, setDwg] = useState<DwgExportStatus | null>(null)
  const [dwgBusy, setDwgBusy] = useState(false)
  const frame = useRef(0)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The SVG is shown as an <img> (rasterised once, GPU-composited) instead of thousands of live DOM nodes.
  // A data: URL is used because the app's Content-Security-Policy (img-src 'self' data:) blocks blob:
  // images when the renderer is loaded from file:// in the packaged Electron app.
  const imgUrl = useMemo(
    () => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : ''),
    [svg]
  )

  const apply = useCallback(() => {
    frame.current = 0
    const el = layerRef.current
    if (!el) return
    const v = view.current
    const s = (v.k * BASE_WIDTH) / rasterRef.current
    el.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${s})`
  }, [])
  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(apply)
  }, [apply])

  const commitRaster = useCallback(() => {
    // Sharp re-render at the current zoom, capped at 6000 px wide to bound memory.
    const w = Math.round(Math.min(6000, Math.max(BASE_WIDTH * 0.5, BASE_WIDTH * view.current.k)))
    if (Math.abs(w - rasterRef.current) / rasterRef.current > 0.15) {
      rasterRef.current = w
      setRasterW(w)
    }
    schedule()
  }, [schedule])

  const fit = useCallback(() => {
    const el = boxRef.current
    if (!el) return
    const k = Math.min(el.clientWidth / BASE_WIDTH, el.clientHeight / pageH) * 0.97
    view.current = {
      k,
      x: (el.clientWidth - BASE_WIDTH * k) / 2,
      y: (el.clientHeight - pageH * k) / 2
    }
    commitRaster()
  }, [pageH, commitRaster])

  useEffect(() => {
    fit()
  }, [fit, sheetIndex, imgUrl])

  useEffect(() => {
    schedule()
  }, [rasterW, schedule])

  // Wheel zoom about the cursor (non-passive native listener to prevent page scroll).
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      const v = view.current
      const k = Math.min(20, Math.max(0.05, v.k * Math.exp(-e.deltaY * 0.0015)))
      const r2 = k / v.k
      view.current = { k, x: px - (px - v.x) * r2, y: py - (py - v.y) * r2 }
      schedule()
      if (settle.current) clearTimeout(settle.current)
      settle.current = setTimeout(commitRaster, 180)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (settle.current) clearTimeout(settle.current)
      if (frame.current) cancelAnimationFrame(frame.current)
    }
  }, [schedule, commitRaster])

  if (!drawing) {
    return <div className="text-xs text-neutral-500 p-6">No drawing available.</div>
  }

  const sheet = drawing.sheets[sheetIndex]
  const base = safeFileName(projectName)

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
        <button
          disabled={dwgBusy}
          onClick={async () => {
            setDwgBusy(true)
            setDwg({ ok: true, message: 'Converting to DWG...' })
            setDwg(await exportDwgFromApp(writeDxf(drawing), `FP_${base}.dwg`))
            setDwgBusy(false)
          }}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-neutral-100 text-neutral-900 hover:bg-white cursor-pointer disabled:opacity-50"
        >
          <Download size={13} /> Export DWG
        </button>
      </div>
      {dwg && (
        <div
          className={`text-[11px] rounded-lg px-3 py-2 border ${dwg.ok ? 'border-emerald-800 text-emerald-300 bg-emerald-950/30' : 'border-amber-800 text-amber-200 bg-amber-950/30'}`}
        >
          {dwg.message}
        </div>
      )}
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
          drag.current = { sx: e.clientX, sy: e.clientY, ox: view.current.x, oy: view.current.y }
        }}
        onMouseMove={(e) => {
          const d = drag.current
          if (!d) return
          view.current = { ...view.current, x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy }
          schedule()
        }}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
      >
        <div
          ref={layerRef}
          className="absolute top-0 left-0 bg-white shadow-2xl"
          style={{
            width: rasterW,
            height: rasterW * aspect,
            transformOrigin: '0 0',
            willChange: 'transform'
          }}
        >
          {imgUrl && (
            <img
              src={imgUrl}
              alt={sheet?.title ?? 'drawing sheet'}
              draggable={false}
              decoding="async"
              style={{
                width: rasterW,
                height: rasterW * aspect,
                display: 'block',
                pointerEvents: 'none'
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
