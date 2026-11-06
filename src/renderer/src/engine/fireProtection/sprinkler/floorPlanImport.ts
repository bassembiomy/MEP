/**
 * Architectural floor-plan import from ASCII DXF (also used for DWG after conversion).
 *
 * Robust group-code pairing: the text is split on CR/LF, code / value lines are read strictly in pairs (empty values
 * are kept, only the code line is trimmed). One linear pass over the file; only the ENTITIES section is interpreted,
 * HEADER supplies $INSUNITS. Supported entities: LINE, LWPOLYLINE, POLYLINE/VERTEX/SEQEND, CIRCLE, ARC, TEXT, MTEXT;
 * INSERT block references are counted and reported (not exploded).
 */
import type { DrawingUnits, FloorPlan, FloorPlanEntity } from './sprinklerTypes'

const INSUNITS_MAP: Record<number, DrawingUnits> = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' }
const SCALE_TO_MM: Record<DrawingUnits, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }
const CLOSE_TOL_MM = 1

interface RawEntity {
  type: string
  layer: string
  pts: [number, number][]
  flag: number
  r: number
  a0: number
  a1: number
  h: number
  text: string
  chunks: string[]
}

function newRaw(type: string): RawEntity {
  return { type, layer: '0', pts: [], flag: 0, r: 0, a0: 0, a1: 0, h: 0, text: '', chunks: [] }
}

const num = (s: string): number => {
  const v = parseFloat(s)
  return Number.isFinite(v) ? v : 0
}

/** Strip MTEXT formatting: `\P` → space, `\~` → space, `{\fArial|b0;` style codes and braces. */
function cleanMText(s: string): string {
  return s
    .replace(/\\P/gi, ' ')
    .replace(/\\~/g, ' ')
    .replace(/\\[A-Za-z][^;\\]*;/g, '')
    .replace(/\\([\\{}])/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function ptsClose(a: [number, number], b: [number, number], tolMm: number, scale: number): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) * scale <= tolMm
}

export function importFloorPlanDxf(dxfText: string, unitsOverride?: DrawingUnits): FloorPlan {
  const warnings: string[] = []
  const text = dxfText.charCodeAt(0) === 0xfeff ? dxfText.slice(1) : dxfText
  const lines = text.split(/\r?\n/)

  let insunits: number | null = null
  let section = ''
  let expectSectionName = false
  let expectInsunitsValue = false
  const raws: RawEntity[] = []
  let cur: RawEntity | null = null
  let polyline: RawEntity | null = null // old-style POLYLINE collecting VERTEX entities
  let insertCount = 0

  const finish = (): void => {
    if (!cur) return
    const e = cur
    cur = null
    if (e.type === 'VERTEX') {
      if (polyline && e.pts.length > 0) polyline.pts.push(e.pts[0])
      return
    }
    if (e.type === 'SEQEND') {
      if (polyline) raws.push(polyline)
      polyline = null
      return
    }
    if (e.type === 'POLYLINE') {
      if (polyline) raws.push(polyline) // previous one never terminated
      polyline = e
      return
    }
    if (polyline) {
      raws.push(polyline)
      polyline = null
    }
    if (e.type === 'INSERT') insertCount++
    else raws.push(e)
  }

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10)
    const value = lines[i + 1]
    if (!Number.isFinite(code)) {
      // lost pairing (garbage line): resynchronise by one line
      i -= 1
      continue
    }
    if (code === 0) {
      const v = value.trim().toUpperCase()
      if (section === 'ENTITIES') finish()
      else cur = null
      expectInsunitsValue = false
      if (v === 'SECTION') expectSectionName = true
      else if (v === 'ENDSEC') {
        if (section === 'ENTITIES') finish()
        section = ''
      } else if (v === 'EOF') break
      else if (section === 'ENTITIES') cur = newRaw(v)
      continue
    }
    if (expectSectionName && code === 2) {
      section = value.trim().toUpperCase()
      expectSectionName = false
      continue
    }
    if (section === 'HEADER') {
      if (code === 9) expectInsunitsValue = value.trim().toUpperCase() === '$INSUNITS'
      else if (expectInsunitsValue && code === 70) {
        insunits = parseInt(value.trim(), 10)
        expectInsunitsValue = false
      }
      continue
    }
    if (section !== 'ENTITIES' || !cur) continue
    const e: RawEntity = cur
    switch (code) {
      case 8:
        e.layer = value.trim() || '0'
        break
      case 10:
        e.pts.push([num(value), 0])
        break
      case 20:
        if (e.pts.length) e.pts[e.pts.length - 1][1] = num(value)
        break
      case 11:
        if (e.type === 'LINE') e.pts.push([num(value), 0])
        break
      case 21:
        if (e.type === 'LINE' && e.pts.length) e.pts[e.pts.length - 1][1] = num(value)
        break
      case 40:
        if (e.type === 'CIRCLE' || e.type === 'ARC') e.r = num(value)
        else e.h = num(value)
        break
      case 50:
        e.a0 = num(value)
        break
      case 51:
        e.a1 = num(value)
        break
      case 70:
        e.flag = parseInt(value.trim(), 10) || 0
        break
      case 1:
        e.text = value
        break
      case 3:
        if (e.type === 'MTEXT') e.chunks.push(value)
        break
      default:
        break
    }
  }
  if (section === 'ENTITIES') finish()
  if (polyline) raws.push(polyline)

  // Units
  const declared: DrawingUnits | 'unknown' =
    insunits !== null && INSUNITS_MAP[insunits] ? INSUNITS_MAP[insunits] : 'unknown'
  let units: DrawingUnits
  if (unitsOverride) units = unitsOverride
  else if (declared !== 'unknown') units = declared
  else {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const r of raws) {
      for (const [x, y] of r.pts) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    const ext = Number.isFinite(minX) ? Math.max(maxX - minX, maxY - minY) : 0
    units = ext < 1000 ? 'm' : 'mm'
    warnings.push(
      `Drawing units are not declared ($INSUNITS); assumed ${units} from the drawing extent (${ext.toFixed(1)} units) — verify or override the units.`
    )
  }
  const scale = SCALE_TO_MM[units]

  // Entities
  const entities: FloorPlanEntity[] = []
  for (const r of raws) {
    const pts: [number, number][] = r.pts.map(([x, y]) => [x * scale, y * scale])
    switch (r.type) {
      case 'LINE':
        if (pts.length >= 2)
          entities.push({ kind: 'line', layer: r.layer, points: [pts[0], pts[1]], closed: false })
        break
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        if (r.type === 'POLYLINE' && (r.flag & (16 | 64)) !== 0) break // 3D mesh / polyface: not a plan outline
        if (pts.length < 2) break
        let closed = (r.flag & 1) === 1
        if (pts.length >= 3 && ptsClose(pts[0], pts[pts.length - 1], CLOSE_TOL_MM, 1)) {
          closed = true
          pts.pop()
        }
        entities.push({ kind: 'polyline', layer: r.layer, points: pts, closed })
        break
      }
      case 'CIRCLE':
        if (pts.length >= 1)
          entities.push({
            kind: 'circle',
            layer: r.layer,
            points: [pts[0]],
            closed: false,
            radius: r.r * scale
          })
        break
      case 'ARC':
        if (pts.length >= 1)
          entities.push({
            kind: 'arc',
            layer: r.layer,
            points: [pts[0]],
            closed: false,
            radius: r.r * scale,
            startDeg: r.a0,
            endDeg: r.a1
          })
        break
      case 'TEXT':
      case 'MTEXT': {
        if (pts.length < 1) break
        const raw = r.type === 'MTEXT' ? r.chunks.join('') + r.text : r.text
        const t = r.type === 'MTEXT' ? cleanMText(raw) : raw.trim()
        entities.push({
          kind: 'text',
          layer: r.layer,
          points: [pts[0]],
          closed: false,
          text: t,
          height: r.h * scale
        })
        break
      }
      default:
        break
    }
  }
  if (insertCount > 0) warnings.push(`${insertCount} block references (INSERT) not exploded`)

  // Layers & bbox
  const layerMap = new Map<string, { name: string; count: number; closedPolylines: number }>()
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const e of entities) {
    let l = layerMap.get(e.layer)
    if (!l) {
      l = { name: e.layer, count: 0, closedPolylines: 0 }
      layerMap.set(e.layer, l)
    }
    l.count++
    if (e.kind === 'polyline' && e.closed) l.closedPolylines++
    for (const [x, y] of e.points) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const layers = [...layerMap.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  )
  const bbox = Number.isFinite(minX)
    ? { minX, minY, maxX, maxY }
    : { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  if (entities.length === 0) warnings.push('No supported entities found in the ENTITIES section.')

  return { declaredUnits: declared, units, scaleToMm: scale, entities, layers, bbox, warnings }
}
