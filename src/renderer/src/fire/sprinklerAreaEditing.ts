/**
 * Pure helpers for the sprinkler plan editor: zones, drawn areas, snapping and sprinkler-type options.
 * Geometry in millimetres, floor-plan coordinates (+y up).
 */
import type { HazardClass } from '../engine/fireProtection/fpTypes'
import {
  SPRINKLER_OCCUPANCIES,
  occupancyFromName
} from '../engine/fireProtection/sprinkler/nfpa13Sprinkler'
import type {
  FloorPlan,
  ObstructionLayerMapping,
  ObstructionKind,
  ObstructionResult,
  SprinklerAnswers,
  SprinklerFloorInput,
  SprinklerHeadSpec,
  SprinklerObstruction,
  SprinklerRoomInput,
  SprinklerZoneInput
} from '../engine/fireProtection/sprinkler/sprinklerTypes'

type Pt = [number, number]

export const SNAP_VERTEX_MM = 300
export const SNAP_GRID_MM = 100
/** NFPA 13 §4.4 maximum protected area per system riser on one floor (light / ordinary hazard). */
export const ZONE_AREA_LIMIT_FT2 = 52000

export const ZONE_COLORS = [
  '#f97316',
  '#38bdf8',
  '#a3e635',
  '#e879f9',
  '#facc15',
  '#2dd4bf',
  '#fb7185',
  '#a78bfa'
]

export const HAZARD_SHORT: Record<HazardClass, string> = {
  light: 'LH',
  'ordinary-1': 'OH1',
  'ordinary-2': 'OH2',
  'extra-1': 'EH1',
  'extra-2': 'EH2'
}

// ─────────────────────────── zones ───────────────────────────

/** Zones of a floor; an undefined / empty list means the single default zone Z1 at the floor riser. */
export function effectiveZones(floor: SprinklerFloorInput): SprinklerZoneInput[] {
  if (floor.zones && floor.zones.length > 0) return floor.zones
  return [{ id: 'Z1', name: floor.name || 'Zone 1', riser: floor.riser }]
}

/** Zone an area belongs to (an unknown / undefined zoneId = the first zone). */
export function zoneIdOf(room: SprinklerRoomInput, zones: SprinklerZoneInput[]): string {
  return zones.some((z) => z.id === room.zoneId) ? (room.zoneId as string) : zones[0].id
}

export function zoneColor(zones: SprinklerZoneInput[], zoneId: string): string {
  const i = Math.max(
    0,
    zones.findIndex((z) => z.id === zoneId)
  )
  return ZONE_COLORS[i % ZONE_COLORS.length]
}

export function nextZoneId(zones: SprinklerZoneInput[]): string {
  let max = 0
  for (const z of zones) {
    const m = /^Z(\d+)$/.exec(z.id)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `Z${Math.max(max, zones.length) + 1}`
}

// ─────────────────────────── drawn areas ───────────────────────────

export function nextAreaIdentity(rooms: SprinklerRoomInput[]): { id: string; name: string } {
  const ids = new Set(rooms.map((r) => r.id))
  const names = new Set(rooms.map((r) => r.name))
  let n = 1
  while (ids.has(`A${n}`) || names.has(`Area ${n}`)) n++
  return { id: `A${n}`, name: `Area ${n}` }
}

/** New designer-drawn area with the questionnaire defaults (occupancy, hazard, ceiling). */
export function makeDrawnArea(
  polygon: Pt[],
  rooms: SprinklerRoomInput[],
  answers: SprinklerAnswers,
  zoneId: string
): SprinklerRoomInput {
  const { id, name } = nextAreaIdentity(rooms)
  const occupancy = occupancyFromName('', answers.buildingType)
  return {
    id,
    name,
    polygon: polygon.map(([x, y]) => [x, y] as Pt),
    occupancy,
    hazard: SPRINKLER_OCCUPANCIES[occupancy]?.hazard ?? 'light',
    ceilingHeightM: answers.defaultCeilingHeightM,
    ceilingType: answers.ceilingType,
    freezing: false,
    heatSource: occupancy === 'kitchen' || occupancy === 'mechanical',
    omit: false,
    omitReason: '',
    headSpec: null,
    zoneId,
    source: 'drawn'
  }
}

export function polygonAreaMm2(p: Pt[]): number {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i]
    const [x2, y2] = p[(i + 1) % p.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

export function polygonCentroid(p: Pt[]): Pt {
  const n = p.length || 1
  return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n]
}

export function pointInPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// ─────────────────────────── snapping ───────────────────────────

export interface VertexIndex {
  cell: number
  map: Map<string, Pt[]>
}

/** Spatial hash of every plan vertex (and existing area vertices) for fast nearest-vertex snapping. */
export function buildVertexIndex(plan: FloorPlan | null, rooms: SprinklerRoomInput[]): VertexIndex {
  const cell = SNAP_VERTEX_MM
  const map = new Map<string, Pt[]>()
  const add = (p: Pt): void => {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return
    const k = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`
    const a = map.get(k)
    if (a) a.push(p)
    else map.set(k, [p])
  }
  if (plan)
    for (const e of plan.entities) {
      if (e.kind === 'line' || e.kind === 'polyline') for (const p of e.points) add(p)
    }
  for (const r of rooms) for (const p of r.polygon) add(p)
  return { cell, map }
}

export function nearestVertex(
  idx: VertexIndex,
  x: number,
  y: number,
  maxDist = SNAP_VERTEX_MM
): Pt | null {
  const cx = Math.floor(x / idx.cell)
  const cy = Math.floor(y / idx.cell)
  let best: Pt | null = null
  let bd = maxDist * maxDist
  for (let i = cx - 1; i <= cx + 1; i++)
    for (let j = cy - 1; j <= cy + 1; j++) {
      const a = idx.map.get(`${i},${j}`)
      if (!a) continue
      for (const p of a) {
        const d = (p[0] - x) ** 2 + (p[1] - y) ** 2
        if (d <= bd) {
          bd = d
          best = p
        }
      }
    }
  return best
}

/**
 * Snap a cursor position: shift = orthogonal to the previous point (then grid); otherwise plan vertex within 300 mm,
 * else the 100 mm grid.
 */
export function snapPoint(
  idx: VertexIndex,
  x: number,
  y: number,
  prev: Pt | null,
  ortho: boolean
): { p: Pt; kind: 'vertex' | 'grid' } {
  const g = (v: number): number => Math.round(v / SNAP_GRID_MM) * SNAP_GRID_MM
  if (ortho && prev) {
    const dx = Math.abs(x - prev[0])
    const dy = Math.abs(y - prev[1])
    return dx >= dy ? { p: [g(x), prev[1]], kind: 'grid' } : { p: [prev[0], g(y)], kind: 'grid' }
  }
  const v = nearestVertex(idx, x, y)
  if (v) return { p: [v[0], v[1]], kind: 'vertex' }
  return { p: [g(x), g(y)], kind: 'grid' }
}

// ─────────────────────────── sprinkler types ───────────────────────────

export const K_OPTIONS: SprinklerHeadSpec['kFactor'][] = [5.6, 8, 11.2, 14, 16.8, 25.2]

export const ORIENTATION_OPTIONS: { value: SprinklerHeadSpec['orientation']; label: string }[] = [
  { value: 'pendent', label: 'Pendent' },
  { value: 'upright', label: 'Upright' },
  { value: 'concealed-pendent', label: 'Concealed pendent' },
  { value: 'dry-pendent', label: 'Dry pendent' },
  { value: 'sidewall', label: 'Horizontal sidewall' }
]

export const TEMP_OPTIONS: { value: SprinklerHeadSpec['tempRatingF']; label: string }[] = [
  { value: 135, label: '135 °F (57 °C) - ordinary, orange' },
  { value: 155, label: '155 °F (68 °C) - ordinary, red' },
  { value: 175, label: '175 °F (79 °C) - intermediate, yellow' },
  { value: 200, label: '200 °F (93 °C) - intermediate, green' },
  { value: 286, label: '286 °F (141 °C) - high, blue' }
]

export function defaultHeadSpec(room: SprinklerRoomInput): SprinklerHeadSpec {
  return {
    kFactor: 5.6,
    orientation: room.ceilingType === 'exposed-structure' ? 'upright' : 'pendent',
    response: 'quick',
    tempRatingF: room.heatSource ? 200 : 155
  }
}

export function headSpecLabel(h: SprinklerHeadSpec): string {
  const o = ORIENTATION_OPTIONS.find((x) => x.value === h.orientation)?.label ?? h.orientation
  return `K${h.kFactor} ${o} ${h.response === 'quick' ? 'QR' : 'SR'} ${h.tempRatingF}°F`
}

export function setRoomsPatch(
  rooms: SprinklerRoomInput[],
  ids: Set<string>,
  patch: Partial<SprinklerRoomInput>
): SprinklerRoomInput[] {
  return rooms.map((r) => (ids.has(r.id) ? { ...r, ...patch } : r))
}

// ─────────────────────────── obstructions (NFPA 13 §10.2.7) ───────────────────────────

export const OBSTRUCTION_KIND_OPTIONS: { value: ObstructionKind; label: string }[] = [
  { value: 'beam', label: 'Beam' },
  { value: 'duct', label: 'Duct' },
  { value: 'cable-tray', label: 'Cable tray' },
  { value: 'pipe', label: 'Pipe' },
  { value: 'column', label: 'Column' },
  { value: 'light', label: 'Light fixture' },
  { value: 'other', label: 'Other' }
]

export const OBSTRUCTION_KIND_LABEL: Record<ObstructionKind, string> = Object.fromEntries(
  OBSTRUCTION_KIND_OPTIONS.map((o) => [o.value, o.label])
) as Record<ObstructionKind, string>

export const OBSTRUCTION_RULE_LABEL: Record<ObstructionResult['rule'], string> = {
  beam: 'Beam rule',
  'three-times': 'Three-times rule',
  wide: 'Wide - sprinklers below',
  wall: 'Wall (bays)'
}

/** Default bottom of an obstruction below the ceiling, mm (a column reaches the floor below the ceiling). */
export function defaultObstructionDepthMm(kind: ObstructionKind, ceilingHeightM: number): number {
  switch (kind) {
    case 'beam':
      return 400
    case 'duct':
      return 500
    case 'cable-tray':
      return 300
    case 'pipe':
      return 200
    case 'column':
      return Math.round(Math.max(ceilingHeightM, 0.1) * 1000)
    case 'light':
      return 150
    default:
      return 300
  }
}

export function defaultLayerMapping(
  layer: string,
  ceilingHeightM: number
): ObstructionLayerMapping {
  const n = layer.toLowerCase()
  const kind: ObstructionKind = /beam|joist|girder/.test(n)
    ? 'beam'
    : /duct|hvac/.test(n)
      ? 'duct'
      : /tray|cable/.test(n)
        ? 'cable-tray'
        : /pipe/.test(n)
          ? 'pipe'
          : /col/.test(n)
            ? 'column'
            : /light|lamp|lum/.test(n)
              ? 'light'
              : 'beam'
  return { layer, kind, bottomBelowCeilingMm: defaultObstructionDepthMm(kind, ceilingHeightM) }
}

export function nextObstructionId(obstructions: SprinklerObstruction[]): string {
  const ids = new Set(obstructions.map((o) => o.id))
  let n = 1
  while (ids.has(`OB${n}`)) n++
  return `OB${n}`
}

export function rectPolygon(a: Pt, b: Pt): Pt[] {
  const x1 = Math.min(a[0], b[0])
  const x2 = Math.max(a[0], b[0])
  const y1 = Math.min(a[1], b[1])
  const y2 = Math.max(a[1], b[1])
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2]
  ]
}

export function polygonBounds(p: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = p.map((q) => q[0])
  const ys = p.map((q) => q[1])
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  }
}

/** Smaller x larger plan dimension of the footprint, mm. */
export function obstructionSizeMm(o: SprinklerObstruction): [number, number] {
  const b = polygonBounds(o.polygon)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  return [Math.min(w, h), Math.max(w, h)]
}

export function makeDrawnObstruction(
  polygon: Pt[],
  existing: SprinklerObstruction[],
  kind: ObstructionKind,
  bottomBelowCeilingMm: number
): SprinklerObstruction {
  return {
    id: nextObstructionId(existing),
    kind,
    polygon: polygon.map(([x, y]) => [x, y] as Pt),
    bottomBelowCeilingMm,
    source: 'drawn'
  }
}
