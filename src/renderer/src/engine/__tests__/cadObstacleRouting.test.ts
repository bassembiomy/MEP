import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { routePlanPath, type PlanObstacle } from '../cad/obstacleRouting'

const room = [0, 0, 20, 0, 20, 10, 0, 10]
const central = (): PlanObstacle => ({
  id: 'column',
  polygon: [8, 3, 12, 3, 12, 7, 8, 7],
  clearanceDrawingUnits: 1,
  kind: 'obstruction',
  sourceHandles: ['C1']
})
const length = (points: number[]): number => {
  let total = 0
  for (let i = 2; i < points.length; i += 2)
    total += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1])
  return total
}
// Independent fixture check: no segment may touch the inflated literal rectangle.
const missesRectangle = (
  points: number[],
  left: number,
  bottom: number,
  right: number,
  top: number
): void => {
  for (let i = 2; i < points.length; i += 2) {
    const ax = points[i - 2],
      ay = points[i - 1],
      bx = points[i],
      by = points[i + 1]
    assert.ok(ax === bx || ay === by, 'route segments must be orthogonal')
    assert.ok(
      ax === bx
        ? ax < left || ax > right || Math.max(ay, by) < bottom || Math.min(ay, by) > top
        : ay < bottom || ay > top || Math.max(ax, bx) < left || Math.min(ax, bx) > right,
      `segment ${ax},${ay} to ${bx},${by} touches blocked bounds`
    )
  }
}

describe('approved obstacle-aware native plan routing', () => {
  it('returns a literal straight route through an unobstructed rectangle', () => {
    assert.deepEqual(routePlanPath({ x: 2, y: 5 }, { x: 18, y: 5 }, room, []).points, [2, 5, 18, 5])
  })
  it('detours around a central obstruction with the entire declared clearance', () => {
    const result = routePlanPath({ x: 2, y: 5 }, { x: 18, y: 5 }, room, [central()])
    assert.deepEqual(result.points.slice(0, 2), [2, 5])
    assert.deepEqual(result.points.slice(-2), [18, 5])
    missesRectangle(result.points, 7, 2, 13, 8)
    assert.ok(Math.abs(length(result.points) - 22) < 1e-7)
    assert.ok(result.points.every((v, i) => v >= 0 && v <= (i % 2 ? 10 : 20)))
    assert.deepEqual(result, routePlanPath({ x: 2, y: 5 }, { x: 18, y: 5 }, room, [central()]))
  })
  it('stays in a concave L rather than cutting through its missing corner', () => {
    const result = routePlanPath(
      { x: 10, y: 2 },
      { x: 2, y: 10 },
      [0, 0, 12, 0, 12, 4, 4, 4, 4, 12, 0, 12],
      []
    )
    assert.equal(length(result.points), 16)
    for (let i = 2; i < result.points.length; i += 2) {
      const ax = result.points[i - 2],
        ay = result.points[i - 1],
        bx = result.points[i],
        by = result.points[i + 1]
      assert.ok(ax === bx || ay === by)
      assert.ok(Math.max(ax, bx) <= 4 || Math.max(ay, by) <= 4)
    }
  })
  it('rejects an unreachable rated barrier spanning the room even with a declared rating', () => {
    const barrier: PlanObstacle = {
      ...central(),
      id: 'fire-wall',
      polygon: [9, 0, 11, 0, 11, 10, 9, 10],
      clearanceDrawingUnits: 0,
      kind: 'rated-barrier',
      ratingHours: 2
    }
    assert.throws(
      () => routePlanPath({ x: 2, y: 5 }, { x: 18, y: 5 }, room, [barrier]),
      /no feasible/i
    )
  })
  it('rejects a passage whose width cannot provide the declared obstacle clearance', () => {
    const obstruction = { ...central(), polygon: [8, 1, 12, 1, 12, 9, 8, 9] }
    assert.throws(
      () => routePlanPath({ x: 2, y: 5 }, { x: 18, y: 5 }, room, [obstruction]),
      /no feasible/i
    )
  })
  it('never treats a sub-microunit concave recess as containment tolerance', () => {
    const notched = [0, 0, 20, 0, 20, 10, 10.0000001, 10, 10.0000001, 4, 10, 4, 10, 10, 0, 10]
    const result = routePlanPath({ x: 2, y: 5 }, { x: 18, y: 5 }, notched, [])
    assert.ok(length(result.points) >= 18)
  })
  it('rejects nonfinite endpoints, malformed polygons and invalid clearances', () => {
    assert.throws(() => routePlanPath({ x: NaN, y: 5 }, { x: 18, y: 5 }, room, []), /finite/i)
    assert.throws(
      () => routePlanPath({ x: 2, y: 5 }, { x: 18, y: 5 }, [0, 0, NaN, 0, 20, 10, 0, 10], []),
      /finite/i
    )
    assert.throws(
      () => routePlanPath({ x: 2, y: 5 }, { x: 18, y: 5 }, [0, 0, 20, 10, 20, 0, 0, 10], []),
      /intersect/i
    )
    assert.throws(
      () =>
        routePlanPath({ x: 2, y: 5 }, { x: 18, y: 5 }, room, [
          { ...central(), clearanceDrawingUnits: -1 }
        ]),
      /clearance/i
    )
    assert.throws(
      () =>
        routePlanPath({ x: 2, y: 5 }, { x: 18, y: 5 }, room, [
          { ...central(), polygon: [8, 3, 12, 7, 12, 3, 8, 7] }
        ]),
      /intersect/i
    )
  })
  it('rejects endpoints outside the room or inside the inflated obstruction', () => {
    assert.throws(() => routePlanPath({ x: -1, y: 5 }, { x: 18, y: 5 }, room, []), /endpoint/i)
    assert.throws(
      () => routePlanPath({ x: 7.5, y: 5 }, { x: 18, y: 5 }, room, [central()]),
      /endpoint/i
    )
  })
  it('retains the physical detour after translation to large native coordinates', () => {
    const shifted = room.map((v, i) => v + (i % 2 ? -2e9 : 1e9))
    const obstacle = {
      ...central(),
      polygon: central().polygon.map((v, i) => v + (i % 2 ? -2e9 : 1e9))
    }
    const result = routePlanPath(
      { x: 1e9 + 2, y: -2e9 + 5 },
      { x: 1e9 + 18, y: -2e9 + 5 },
      shifted,
      [obstacle]
    )
    missesRectangle(result.points, 1e9 + 7, -2e9 + 2, 1e9 + 13, -2e9 + 8)
    assert.ok(Math.abs(length(result.points) - 22) < 0.0001)
  })
  it('produces physically equivalent feet and millimetre routes without implicit unit conversion', () => {
    const feet = routePlanPath({ x: 2, y: 5 }, { x: 18, y: 5 }, room, [central()])
    const metric = routePlanPath(
      { x: 609.6, y: 1524 },
      { x: 5486.4, y: 1524 },
      room.map((v) => v * 304.8),
      [
        {
          ...central(),
          polygon: central().polygon.map((v) => v * 304.8),
          clearanceDrawingUnits: 304.8
        }
      ]
    )
    assert.equal(feet.points.length, metric.points.length)
    metric.points.forEach((v, i) => assert.ok(Math.abs(v / 304.8 - feet.points[i]) < 1e-8))
  })
  it('reports conservative bounds for rotated and nonrectangular approved obstacles', () => {
    const obstacle = { ...central(), polygon: [10, 3, 12, 5, 10, 7, 8, 5] }
    const result = routePlanPath({ x: 2, y: 5 }, { x: 18, y: 5 }, room, [obstacle])
    missesRectangle(result.points, 7, 2, 13, 8)
    assert.ok(result.diagnostics.some((d) => /column.*axis-aligned.*approxim/i.test(d)))
  })
  it('reports blocked rated barriers without inferring an absent rating', () => {
    const result = routePlanPath({ x: 2, y: 5 }, { x: 18, y: 5 }, room, [
      { ...central(), kind: 'rated-barrier' }
    ])
    missesRectangle(result.points, 7, 2, 13, 8)
    assert.ok(result.diagnostics.some((d) => /rated.*blocked/i.test(d)))
    assert.ok(result.diagnostics.some((d) => /rating.*unknown/i.test(d)))
  })
  it('does not mutate frozen source endpoints, polygons, obstacle arrays or handles', () => {
    const obstacle = central()
    Object.freeze(obstacle.polygon)
    Object.freeze(obstacle.sourceHandles)
    Object.freeze(obstacle)
    const obstacles = [obstacle]
    Object.freeze(obstacles)
    const polygon = [...room]
    Object.freeze(polygon)
    const start = Object.freeze({ x: 2, y: 5 }),
      end = Object.freeze({ x: 18, y: 5 })
    const before = JSON.stringify({ start, end, polygon, obstacles })
    routePlanPath(start, end, polygon, obstacles)
    assert.equal(JSON.stringify({ start, end, polygon, obstacles }), before)
  })
  it('stops a graph exceeding the routing budget without returning an unchecked fallback', () => {
    const obstacles = Array.from({ length: 50 }, (_, i) => ({
      ...central(),
      id: `c-${i}`,
      polygon: [
        1 + i / 10,
        1 + i / 20,
        1.01 + i / 10,
        1 + i / 20,
        1.01 + i / 10,
        1.01 + i / 20,
        1 + i / 10,
        1.01 + i / 20
      ],
      clearanceDrawingUnits: 0
    }))
    assert.throws(
      () => routePlanPath({ x: 0, y: 0 }, { x: 20, y: 10 }, room, obstacles),
      /budget|limit/i
    )
  })
})
