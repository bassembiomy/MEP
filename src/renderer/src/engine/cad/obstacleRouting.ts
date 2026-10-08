import {
  measureSimplePolygon,
  requireFinite,
  requireNonnegative,
  requirePositive
} from '../engineeringInputs'
import { isSegmentInPolygon } from '../validation/spatialValidator'

export interface PlanObstacle {
  id: string
  polygon: number[]
  clearanceDrawingUnits: number
  kind: 'obstruction' | 'rated-barrier'
  sourceHandles: string[]
  ratingHours?: number
}

type Point = { x: number; y: number }
type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
const MAX_VERTICES = 256
const MAX_OBSTACLES = 128
const MAX_GRID_NODES = 4096
const MAX_EDGES = 16384
const ROUND_OFF = 64 * Number.EPSILON

function checkPolygonBudget(polygon: number[]): void {
  if (!Array.isArray(polygon) || polygon.length > MAX_VERTICES * 2)
    throw new RangeError('Polygon vertex limit exceeded or invalid polygon data')
}

/** Machine-roundoff boundary check; unlike the shared helper, never use a drawing-unit tolerance. */
function containsPoint(point: Point, polygon: number[]): boolean {
  let inside = false
  for (let i = 0; i < polygon.length; i += 2) {
    const j = (i + 2) % polygon.length
    const ax = polygon[i],
      ay = polygon[i + 1],
      bx = polygon[j],
      by = polygon[j + 1]
    const productA = (bx - ax) * (point.y - ay)
    const productB = (by - ay) * (point.x - ax)
    const error = 8 * Number.EPSILON * (Math.abs(productA) + Math.abs(productB))
    if (
      Math.abs(productA - productB) <= error &&
      point.x >= Math.min(ax, bx) &&
      point.x <= Math.max(ax, bx) &&
      point.y >= Math.min(ay, by) &&
      point.y <= Math.max(ay, by)
    )
      return true
    if (ay > point.y !== by > point.y && point.x < ax + ((point.y - ay) * (bx - ax)) / (by - ay))
      inside = !inside
  }
  return inside
}

function containsSegment(start: Point, end: Point, polygon: number[]): boolean {
  if (!containsPoint(start, polygon) || !containsPoint(end, polygon)) return false
  const dx = end.x - start.x,
    dy = end.y - start.y
  const fractions = [0, 1]
  for (let i = 0; i < polygon.length; i += 2) {
    const j = (i + 2) % polygon.length
    const ex = polygon[j] - polygon[i],
      ey = polygon[j + 1] - polygon[i + 1]
    const qx = polygon[i] - start.x,
      qy = polygon[i + 1] - start.y
    const denominator = dx * ey - dy * ex
    if (denominator !== 0) {
      const t = (qx * ey - qy * ex) / denominator
      const u = (qx * dy - qy * dx) / denominator
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) fractions.push(t)
    } else if (dx * qy - dy * qx === 0) {
      // Collinear edges also split intervals at their endpoints.
      const t = dx !== 0 ? qx / dx : dy !== 0 ? qy / dy : 0
      const u = dx !== 0 ? (qx + ex) / dx : dy !== 0 ? (qy + ey) / dy : 0
      if (t > 0 && t < 1) fractions.push(t)
      if (u > 0 && u < 1) fractions.push(u)
    }
  }
  fractions.sort((a, b) => a - b)
  for (let i = 1; i < fractions.length; i++) {
    const middle = (fractions[i - 1] + fractions[i]) / 2
    if (!containsPoint({ x: start.x + middle * dx, y: start.y + middle * dy }, polygon))
      return false
  }
  return isSegmentInPolygon(start, end, polygon)
}

function touchesBounds(start: Point, end: Point, bounds: Bounds): boolean {
  if (start.x === end.x)
    return (
      start.x >= bounds.minX &&
      start.x <= bounds.maxX &&
      Math.max(start.y, end.y) >= bounds.minY &&
      Math.min(start.y, end.y) <= bounds.maxY
    )
  if (start.y === end.y)
    return (
      start.y >= bounds.minY &&
      start.y <= bounds.maxY &&
      Math.max(start.x, end.x) >= bounds.minX &&
      Math.min(start.x, end.x) <= bounds.maxX
    )
  throw new RangeError('Only orthogonal plan segments may be verified')
}

function gridCoordinates(values: number[], lower: number, upper: number): number[] {
  const sorted = [...new Set(values.filter((value) => value >= lower && value <= upper))].sort(
    (a, b) => a - b
  )
  const withMidpoints = [...sorted]
  for (let i = 1; i < sorted.length; i++) withMidpoints.push((sorted[i - 1] + sorted[i]) / 2)
  return [...new Set(withMidpoints)].sort((a, b) => a - b)
}

/**
 * Route a centerline through explicitly approved plan obstacles, in native drawing units.
 * Clearance must already include the required physical envelope. Rated barriers remain blocked.
 * The bounded rectilinear graph is conservative: failure is never replaced by an unchecked route.
 */
export function routePlanPath(
  start: Point,
  end: Point,
  roomPolygon: number[],
  obstacles: PlanObstacle[]
): { points: number[]; diagnostics: string[] } {
  requireFinite('Start x', start.x)
  requireFinite('Start y', start.y)
  requireFinite('End x', end.x)
  requireFinite('End y', end.y)
  checkPolygonBudget(roomPolygon)
  const roomGeometry = measureSimplePolygon(roomPolygon)
  if (!Array.isArray(obstacles) || obstacles.length > MAX_OBSTACLES)
    throw new RangeError('Obstacle limit exceeded or invalid obstacles data')
  let vertexCount = roomPolygon.length / 2
  for (const obstacle of obstacles) {
    checkPolygonBudget(obstacle.polygon)
    vertexCount += obstacle.polygon.length / 2
  }
  if (vertexCount > MAX_VERTICES) throw new RangeError('Total polygon vertex budget exceeded')

  const origin = { x: roomGeometry.boundingBox.minX, y: roomGeometry.boundingBox.minY }
  const scale = requirePositive(
    'Room coordinate span',
    Math.max(roomGeometry.boundingBox.width, roomGeometry.boundingBox.height)
  )
  const normalize = (point: Point): Point => ({
    x: (point.x - origin.x) / scale,
    y: (point.y - origin.y) / scale
  })
  const normalizePolygon = (polygon: number[]): number[] => {
    const copy = polygon.map((value, i) => (value - (i % 2 ? origin.y : origin.x)) / scale)
    if (copy.length > 6 && copy[0] === copy[copy.length - 2] && copy[1] === copy[copy.length - 1])
      copy.splice(-2)
    measureSimplePolygon(copy)
    return copy
  }
  const room = normalizePolygon(roomPolygon)
  const from = normalize(start),
    to = normalize(end)
  const diagnostics: string[] = []
  const ids = new Set<string>()
  const blocked = obstacles.map((obstacle): Bounds => {
    if (!obstacle.id || typeof obstacle.id !== 'string' || ids.has(obstacle.id))
      throw new RangeError('Obstacle must have a unique nonempty id')
    ids.add(obstacle.id)
    if (obstacle.kind !== 'obstruction' && obstacle.kind !== 'rated-barrier')
      throw new RangeError(`${obstacle.id}: invalid obstacle kind`)
    if (
      !Array.isArray(obstacle.sourceHandles) ||
      obstacle.sourceHandles.some((handle) => typeof handle !== 'string' || !handle)
    )
      throw new RangeError(`${obstacle.id}: invalid source handles`)
    const clearance =
      requireNonnegative(`${obstacle.id} clearance`, obstacle.clearanceDrawingUnits) / scale
    if (obstacle.ratingHours !== undefined)
      requirePositive(`${obstacle.id} rating`, obstacle.ratingHours)
    const polygon = normalizePolygon(obstacle.polygon)
    const geometry = measureSimplePolygon(polygon)
    const bounds = geometry.boundingBox
    const axisRectangle =
      polygon.every((value, i) =>
        i % 2
          ? value === bounds.minY || value === bounds.maxY
          : value === bounds.minX || value === bounds.maxX
      ) &&
      polygon.every(
        (_, i) =>
          i % 2 ||
          polygon[i] === polygon[(i + 2) % polygon.length] ||
          polygon[i + 1] === polygon[(i + 3) % polygon.length]
      )
    if (!axisRectangle)
      diagnostics.push(
        `${obstacle.id}: conservative axis-aligned bounding approximation for rotated/nonrectangular polygon`
      )
    if (obstacle.kind === 'rated-barrier')
      diagnostics.push(
        `${obstacle.id}: rated barrier blocked; ${obstacle.ratingHours === undefined ? 'rating unknown' : `declared rating ${obstacle.ratingHours} hours`}; no crossing approval modeled`
      )
    return {
      minX: requireFinite('Inflated obstacle min x', bounds.minX - clearance),
      maxX: requireFinite('Inflated obstacle max x', bounds.maxX + clearance),
      minY: requireFinite('Inflated obstacle min y', bounds.minY - clearance),
      maxY: requireFinite('Inflated obstacle max y', bounds.maxY + clearance)
    }
  })
  const freePoint = (point: Point): boolean =>
    containsPoint(point, room) && !blocked.some((bounds) => touchesBounds(point, point, bounds))
  const freeSegment = (a: Point, b: Point): boolean =>
    !blocked.some((bounds) => touchesBounds(a, b, bounds)) && containsSegment(a, b, room)
  if (!freePoint(from) || !freePoint(to))
    throw new RangeError('Route endpoint outside room or inside inflated obstacle bounds')
  if (start.x === end.x && start.y === end.y) return { points: [start.x, start.y], diagnostics }

  // Enough outward separation to survive adding the local coordinates back to a large CAD origin.
  const nativeMagnitude = Math.max(
    ...roomPolygon.map(Math.abs),
    Math.abs(start.x),
    Math.abs(start.y),
    Math.abs(end.x),
    Math.abs(end.y)
  )
  const margin = Math.max(ROUND_OFF * 8, (8 * Number.EPSILON * nativeMagnitude) / scale)
  const xs = [from.x, to.x],
    ys = [from.y, to.y]
  for (let i = 0; i < room.length; i += 2) {
    xs.push(room[i])
    ys.push(room[i + 1])
  }
  for (const bounds of blocked) {
    xs.push(bounds.minX - margin, bounds.maxX + margin)
    ys.push(bounds.minY - margin, bounds.maxY + margin)
  }
  const xCoordinates = gridCoordinates(xs, 0, roomGeometry.boundingBox.width / scale)
  const yCoordinates = gridCoordinates(ys, 0, roomGeometry.boundingBox.height / scale)
  if (xCoordinates.length * yCoordinates.length > MAX_GRID_NODES)
    throw new RangeError('Routing grid node budget exceeded')
  const nodes: Point[] = []
  const grid = yCoordinates.map((y) =>
    xCoordinates.map((x) => {
      if (!freePoint({ x, y })) return -1
      nodes.push({ x, y })
      return nodes.length - 1
    })
  )
  const adjacency: { node: number; distance: number }[][] = nodes.map(() => [])
  let edgeCount = 0
  const connect = (a: number, b: number): void => {
    if (a < 0 || b < 0 || !freeSegment(nodes[a], nodes[b])) return
    if (++edgeCount > MAX_EDGES) throw new RangeError('Routing graph edge budget exceeded')
    const distance = Math.abs(nodes[a].x - nodes[b].x) + Math.abs(nodes[a].y - nodes[b].y)
    adjacency[a].push({ node: b, distance })
    adjacency[b].push({ node: a, distance })
  }
  for (const row of grid) {
    let previous = -1
    for (const node of row)
      if (node >= 0) {
        connect(previous, node)
        previous = node
      }
  }
  for (let x = 0; x < xCoordinates.length; x++) {
    let previous = -1
    for (const row of grid)
      if (row[x] >= 0) {
        connect(previous, row[x])
        previous = row[x]
      }
  }
  const source = nodes.findIndex((node) => node.x === from.x && node.y === from.y)
  const target = nodes.findIndex((node) => node.x === to.x && node.y === to.y)
  if (source < 0 || target < 0)
    throw new RangeError('Route endpoint cannot be represented by the bounded grid')
  const distances = nodes.map(() => Infinity),
    previous = nodes.map(() => -1),
    visited = nodes.map(() => false)
  distances[source] = 0
  for (let iteration = 0; iteration < nodes.length; iteration++) {
    let current = -1
    for (let i = 0; i < nodes.length; i++)
      if (
        !visited[i] &&
        Number.isFinite(distances[i]) &&
        (current < 0 || distances[i] < distances[current] - ROUND_OFF)
      )
        current = i
    if (current < 0 || current === target) break
    visited[current] = true
    for (const edge of adjacency[current]) {
      const candidate = distances[current] + edge.distance
      if (!visited[edge.node] && candidate < distances[edge.node] - ROUND_OFF) {
        distances[edge.node] = candidate
        previous[edge.node] = current
      }
    }
  }
  if (!Number.isFinite(distances[target]))
    throw new RangeError('No feasible route in bounded orthogonal graph')
  const path: Point[] = []
  for (let node = target; node >= 0; node = previous[node]) path.push(nodes[node])
  path.reverse()
  const compressed: Point[] = []
  for (const point of path) {
    const a = compressed[compressed.length - 2],
      b = compressed[compressed.length - 1]
    if (a && ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y)))
      compressed.pop()
    compressed.push(point)
  }
  const native = compressed.map((point) => ({
    x: origin.x + point.x * scale,
    y: origin.y + point.y * scale
  }))
  native[0] = { ...start }
  native[native.length - 1] = { ...end }
  // Verify again after reconstruction: large native origins must not round a safe detour onto an obstacle.
  for (let i = 1; i < native.length; i++) {
    if (!freeSegment(normalize(native[i - 1]), normalize(native[i])))
      throw new RangeError('No feasible route at native coordinate precision')
  }
  return { points: native.flatMap((point) => [point.x, point.y]), diagnostics }
}
