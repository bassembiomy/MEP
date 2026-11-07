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
  SprinklerAnswers,
  SprinklerFloorInput,
  SprinklerHeadSpec,
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
