/** Exact dimensional conversions; canonical inputs are feet, Btu/h and CFM. */
export const METERS_PER_FOOT = 0.3048
export const LITERS_PER_SECOND_PER_CFM = 0.4719474432
export const WATTS_PER_BTU_PER_HOUR = 0.2930710701722222

export function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`)
  return value
}
export function requireNonnegative(name: string, value: number): number {
  requireFinite(name, value)
  if (value < 0) throw new RangeError(`${name} must be nonnegative`)
  return value
}
export function requirePositive(name: string, value: number): number {
  requireFinite(name, value)
  if (value <= 0) throw new RangeError(`${name} must be positive`)
  return value
}

type Point = { x: number; y: number }
const cross = (a: Point, b: Point, c: Point): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const onSegment = (a: Point, b: Point, p: Point): boolean =>
  p.x >= Math.min(a.x, b.x) &&
  p.x <= Math.max(a.x, b.x) &&
  p.y >= Math.min(a.y, b.y) &&
  p.y <= Math.max(a.y, b.y)
function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c),
    abD = cross(a, b, d)
  const cdA = cross(c, d, a),
    cdB = cross(c, d, b)
  return (
    (Math.sign(abC) !== Math.sign(abD) && Math.sign(cdA) !== Math.sign(cdB)) ||
    (abC === 0 && onSegment(a, b, c)) ||
    (abD === 0 && onSegment(a, b, d)) ||
    (cdA === 0 && onSegment(c, d, a)) ||
    (cdB === 0 && onSegment(c, d, b))
  )
}

/** Validate a simple polygon, accepting one conventional repeated closing vertex. */
export function measureSimplePolygon(polygon: number[]) {
  if (!Array.isArray(polygon) || polygon.length < 6 || polygon.length % 2 !== 0) {
    throw new RangeError('Polygon must contain at least three complete coordinate pairs')
  }
  polygon.forEach((value) => requireFinite('Polygon coordinate', value))
  const points: Point[] = []
  for (let i = 0; i < polygon.length; i += 2) points.push({ x: polygon[i], y: polygon[i + 1] })
  const first = points[0],
    last = points[points.length - 1]
  if (first.x === last.x && first.y === last.y) points.pop()
  if (points.length < 3) throw new RangeError('Polygon must have three distinct vertices')
  const seen = new Set<string>()
  for (const point of points) {
    const key = `${point.x},${point.y}`
    if (seen.has(key)) throw new RangeError('Polygon has a repeated vertex or zero-length edge')
    seen.add(key)
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length]
    const previous = points[(i + points.length - 1) % points.length]
    if (
      cross(previous, a, b) === 0 &&
      (a.x - previous.x) * (b.x - a.x) + (a.y - previous.y) * (b.y - a.y) < 0
    ) {
      throw new RangeError('Polygon has overlapping adjacent edges')
    }
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue
      if (segmentsIntersect(a, b, points[j], points[(j + 1) % points.length])) {
        throw new RangeError('Polygon is self-intersecting')
      }
    }
  }
  // Translate to the first vertex to reduce cancellation in large CAD coordinates.
  let twiceArea = 0,
    cx = 0,
    cy = 0,
    perimeter = 0
  let minX = first.x,
    maxX = first.x,
    minY = first.y,
    maxY = first.y
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length]
    const ax = a.x - first.x,
      ay = a.y - first.y
    const bx = b.x - first.x,
      by = b.y - first.y
    const factor = ax * by - bx * ay
    twiceArea += factor
    cx += (ax + bx) * factor
    cy += (ay + by) * factor
    perimeter += Math.hypot(b.x - a.x, b.y - a.y)
    minX = Math.min(minX, a.x)
    maxX = Math.max(maxX, a.x)
    minY = Math.min(minY, a.y)
    maxY = Math.max(maxY, a.y)
  }
  const area = requirePositive('Polygon area', Math.abs(twiceArea) / 2)
  requirePositive('Polygon perimeter', perimeter)
  const centroid = {
    x: requireFinite('Polygon centroid x', first.x + cx / (3 * twiceArea)),
    y: requireFinite('Polygon centroid y', first.y + cy / (3 * twiceArea))
  }
  const boundingBox = { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY }
  requireFinite('Polygon width', boundingBox.width)
  requireFinite('Polygon height', boundingBox.height)
  return { area, perimeter, centroid, boundingBox }
}
