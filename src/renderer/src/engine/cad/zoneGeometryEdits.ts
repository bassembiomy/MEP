import { validateZonePolygon, cleanPolygonPoints } from './zonePolygon'

/** Pure, validated room-outline edits. A rejected edit returns an error and never a polygon. */
export type PolygonEdit = { ok: true; points: number[] } | { ok: false; error: string }

const fail = (error: string): PolygonEdit => ({ ok: false, error })
function accept(before: number[], after: number[], expectedVertices: number): PolygonEdit {
  if (after.some(v => !Number.isFinite(v))) return fail('Edit produced a non-finite coordinate.')
  const check = validateZonePolygon(after)
  if (!check.ok) return fail(check.error)
  if (check.points.length / 2 !== expectedVertices || cleanPolygonPoints(after).length !== after.length) return fail('Edit would make two vertices coincide.')
  void before
  return { ok: true, points: check.points }
}
const count = (points: number[]) => points.length / 2
const badIndex = (points: number[], i: number) => !Number.isInteger(i) || i < 0 || i >= count(points)

export function moveVertex(points: number[], index: number, x: number, y: number): PolygonEdit {
  if (badIndex(points, index)) return fail('Vertex does not exist.')
  const next = [...points]; next[2 * index] = x; next[2 * index + 1] = y
  return accept(points, next, count(points))
}
/** Insert a vertex on the edge that starts at vertex `edgeIndex` (so it becomes vertex edgeIndex + 1). */
export function insertVertex(points: number[], edgeIndex: number, x: number, y: number): PolygonEdit {
  if (badIndex(points, edgeIndex)) return fail('Edge does not exist.')
  const next = [...points.slice(0, 2 * edgeIndex + 2), x, y, ...points.slice(2 * edgeIndex + 2)]
  return accept(points, next, count(points) + 1)
}
export function deleteVertex(points: number[], index: number): PolygonEdit {
  if (badIndex(points, index)) return fail('Vertex does not exist.')
  if (count(points) <= 3) return fail('A room needs at least three vertices.')
  const next = [...points]; next.splice(2 * index, 2)
  return accept(points, next, count(points) - 1)
}
/**
 * Translate edge (edgeIndex -> edgeIndex+1) along its normal by `distance` drawing units; positive moves it
 * outward from the polygon interior. Adjacent edges stretch with their shared vertices.
 */
export function offsetEdge(points: number[], edgeIndex: number, distance: number): PolygonEdit {
  if (badIndex(points, edgeIndex)) return fail('Edge does not exist.')
  if (!Number.isFinite(distance)) return fail('Offset must be a finite distance.')
  const n = count(points), j = (edgeIndex + 1) % n
  const ax = points[2 * edgeIndex], ay = points[2 * edgeIndex + 1], bx = points[2 * j], by = points[2 * j + 1]
  const len = Math.hypot(bx - ax, by - ay)
  if (len === 0) return fail('Edge has zero length.')
  let area2 = 0
  for (let i = 0; i < n; i++) { const k = (i + 1) % n; area2 += points[2 * i] * points[2 * k + 1] - points[2 * k] * points[2 * i + 1] }
  // For counter-clockwise (area2>0) outward normal is the right-hand normal (dy,-dx); flip for clockwise.
  const s = area2 >= 0 ? 1 : -1
  const nx = s * (by - ay) / len, ny = s * -(bx - ax) / len
  const next = [...points]
  next[2 * edgeIndex] += nx * distance; next[2 * edgeIndex + 1] += ny * distance
  next[2 * j] += nx * distance; next[2 * j + 1] += ny * distance
  return accept(points, next, n)
}
