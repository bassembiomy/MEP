import { validateZonePolygon, DUPLICATE_POINT_TOLERANCE } from './zonePolygon'

/** Pure state machine for the room-outline tool. No React/Konva. */
export interface PolylineProjectUnits { units: 'imperial' | 'metric'; scale: number }
export interface PolylineState {
  /** Flat x,y vertex list drawn so far. */
  points: number[]
  cursor: { x: number; y: number } | null
  /** Last refusal / hint; cleared by the next accepted event. */
  message: string | null
  /** Set when a valid polygon was committed; the caller creates the zone and resets. */
  committed: number[] | null
  /** Click within this distance (drawing units) of the first vertex closes the polygon. */
  closeTolerance: number
  project: PolylineProjectUnits
}
export type PolylineEvent =
  | { type: 'click'; x: number; y: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'backspace' }
  | { type: 'escape' }
  | { type: 'enter' }
  | { type: 'closeOnFirstPoint' }
  /** Length in project units (ft imperial / m metric) along the direction from the last vertex to the cursor. */
  | { type: 'typedLength'; length: number }

export const initialPolylineState = (project: PolylineProjectUnits, closeTolerance = 0): PolylineState =>
  ({ points: [], cursor: null, message: null, committed: null, closeTolerance, project })

const lastPoint = (s: PolylineState) => s.points.length >= 2 ? { x: s.points[s.points.length - 2], y: s.points[s.points.length - 1] } : null

function commit(s: PolylineState): PolylineState {
  const check = validateZonePolygon(s.points)
  if (!check.ok) return { ...s, message: `Room not created: ${check.error} Drawing kept; backspace to fix or escape to cancel.`, committed: null }
  return { ...s, points: [], cursor: null, message: null, committed: check.points }
}

export function polylineReducer(state: PolylineState, event: PolylineEvent): PolylineState {
  const s = state.committed ? { ...state, committed: null } : state
  switch (event.type) {
    case 'move':
      return { ...s, cursor: { x: event.x, y: event.y } }
    case 'click': {
      if (![event.x, event.y].every(Number.isFinite)) return { ...s, message: 'Ignored a non-finite point.' }
      if (s.points.length >= 6 && Math.hypot(event.x - s.points[0], event.y - s.points[1]) <= Math.max(s.closeTolerance, DUPLICATE_POINT_TOLERANCE)) return commit(s)
      const last = lastPoint(s)
      if (last && Math.hypot(event.x - last.x, event.y - last.y) <= DUPLICATE_POINT_TOLERANCE) return { ...s, message: null } // double click
      return { ...s, points: [...s.points, event.x, event.y], message: null }
    }
    case 'backspace':
      return s.points.length ? { ...s, points: s.points.slice(0, -2), message: null } : s
    case 'escape':
      return { ...s, points: [], cursor: null, message: null }
    case 'enter':
    case 'closeOnFirstPoint':
      return commit(s)
    case 'typedLength': {
      const last = lastPoint(s)
      if (!last) return { ...s, message: 'Click a start point before typing a length.' }
      if (!Number.isFinite(event.length) || event.length <= 0) return { ...s, message: 'Typed length must be a positive number.' }
      if (!s.cursor) return { ...s, message: 'Move the cursor to set a direction first.' }
      const dx = s.cursor.x - last.x, dy = s.cursor.y - last.y, d = Math.hypot(dx, dy)
      if (d < 1e-9) return { ...s, message: 'Move the cursor away from the last vertex to set a direction.' }
      const len = event.length * s.project.scale // ft (imperial) / m (metric) -> drawing units
      return { ...s, points: [...s.points, last.x + dx / d * len, last.y + dy / d * len], message: null }
    }
  }
}
