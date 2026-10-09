import { measureSimplePolygon } from '../engineeringInputs'

/** Shared zone-outline validation for drawing, store.addZone and vertex edits. */
export const DUPLICATE_POINT_TOLERANCE = 1e-3

/** Remove consecutive duplicates (double clicks) and a closing point equal to the first. */
export function cleanPolygonPoints(points: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i], y = points[i + 1]
    const lx = out[out.length - 2], ly = out[out.length - 1]
    if (lx === undefined || !(Math.hypot(x - lx, y - ly) <= DUPLICATE_POINT_TOLERANCE)) out.push(x, y)
  }
  if (out.length >= 4 && Math.hypot(out[0] - out[out.length - 2], out[1] - out[out.length - 1]) <= DUPLICATE_POINT_TOLERANCE) out.length -= 2
  return out
}

export type PolygonCheck = { ok: true; points: number[] } | { ok: false; error: string }
/** Clean then validate: >=3 distinct vertices, finite, simple (no self-intersection, no zero area). */
export function validateZonePolygon(points: number[]): PolygonCheck {
  const cleaned = cleanPolygonPoints(points)
  if (cleaned.length < 6) return { ok: false, error: 'A room needs at least three distinct vertices.' }
  try {
    const m = measureSimplePolygon(cleaned) as { area?: number }
    if (m && typeof m.area === 'number' && !(Math.abs(m.area) > 0)) return { ok: false, error: 'Room outline has zero area.' }
    return { ok: true, points: cleaned }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid room outline.' }
  }
}
