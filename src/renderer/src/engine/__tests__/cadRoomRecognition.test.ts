import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { DxfEntity } from '../../store/projectStore'
import { recognizeCadRooms } from '../cad/roomRecognition'

const rectangle = [0, 0, 20, 0, 20, 15, 0, 15]
const poly = (points = rectangle, extra: Partial<DxfEntity> = {}): DxfEntity => ({
  type: 'LWPOLYLINE',
  points,
  closed: true,
  layer: 'WALL',
  handle: 'P1',
  ...extra
})
const line = (x: number, y: number, ex: number, ey: number, handle: string): DxfEntity => ({
  type: 'LINE',
  x,
  y,
  points: [ex, ey],
  layer: 'WALL',
  handle
})
const walls = [
  line(0, 0, 40, 0, 'B'),
  line(40, 0, 40, 15, 'R'),
  line(40, 15, 0, 15, 'T'),
  line(0, 15, 0, 0, 'L')
]
const options = { drawingUnitsPerFoot: 1, layers: ['WALL'] }
const areaClose = (actual: number, expected: number): void =>
  assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`)

describe('reviewable CAD room recognition', () => {
  it('measures a literal 300 ft² closed room with source evidence and no approval', () => {
    const result = recognizeCadRooms([poly()], options)
    assert.equal(result.candidates.length, 1)
    areaClose(result.candidates[0].areaSqFt, 300)
    assert.deepEqual(result.candidates[0].sourceHandles, ['P1'])
    assert.deepEqual(result.candidates[0].sourceLayers, ['WALL'])
    assert.equal(result.candidates[0].status, 'review-required')
    assert.ok(result.candidates[0].evidence.length)
    assert.ok(result.candidates[0].unresolvedConditions.length)
  })
  it('measures a concave L boundary as 675 ft²', () => {
    const result = recognizeCadRooms([poly([0, 0, 30, 0, 30, 15, 15, 15, 15, 30, 0, 30])], options)
    areaClose(result.candidates[0].areaSqFt, 675)
  })
  it('splits T junctions into two adjacent 300 ft² bounded faces', () => {
    const result = recognizeCadRooms([...walls, line(20, 0, 20, 15, 'DIVIDER')], options)
    assert.equal(result.candidates.length, 2)
    result.candidates.forEach((c) => {
      areaClose(c.areaSqFt, 300)
      assert.ok(c.sourceHandles.includes('DIVIDER'))
    })
  })
  it('splits crossing dividers into four 150 ft² faces', () => {
    const result = recognizeCadRooms(
      [...walls, line(20, 0, 20, 15, 'V'), line(0, 7.5, 40, 7.5, 'H')],
      options
    )
    assert.equal(result.candidates.length, 4)
    result.candidates.forEach((c) => areaClose(c.areaSqFt, 150))
  })
  it('never bridges a three-foot door gap and reports open boundaries', () => {
    const result = recognizeCadRooms(
      [line(0, 0, 18, 0, 'B1'), line(21, 0, 40, 0, 'B2'), ...walls.slice(1)],
      options
    )
    assert.equal(result.candidates.length, 0)
    assert.ok(result.diagnostics.some((d) => d.code === 'open-boundary'))
  })
  it('merges tiny endpoint errors in canonical feet without making door gaps safe', () => {
    const result = recognizeCadRooms(
      [line(0, 0, 40, 0, 'B'), line(40.0005, 0, 40, 15, 'R'), ...walls.slice(2)],
      options
    )
    assert.equal(result.candidates.length, 1)
    assert.equal(result.candidates[0].status, 'review-required')
    assert.ok(result.candidates[0].unresolvedConditions.some((s) => /tolerance/i.test(s)))
  })
  it('deduplicates reversed and rotated closed boundaries and keeps source handles', () => {
    const result = recognizeCadRooms(
      [poly(), poly([20, 15, 20, 0, 0, 0, 0, 15], { handle: 'P2' })],
      options
    )
    assert.equal(result.candidates.length, 1)
    assert.deepEqual(result.candidates[0].sourceHandles, ['P1', 'P2'])
    assert.equal(result.candidates[0].id, recognizeCadRooms([poly()], options).candidates[0].id)
  })
  it('retains the first corner when a native polyline repeats its closing vertex', () => {
    const result = recognizeCadRooms([poly([...rectangle, 0, 0])], { drawingUnitsPerFoot: 1 })
    assert.equal(result.candidates.length, 1)
    areaClose(result.candidates[0].areaSqFt, 300)
  })
  it('reports nested/disconnected boundaries as ambiguous room or obstacle geometry', () => {
    const result = recognizeCadRooms(
      [poly(), poly([5, 5, 15, 5, 15, 10, 5, 10], { handle: 'INNER' })],
      options
    )
    assert.ok(result.diagnostics.some((d) => d.code === 'nested-boundaries'))
    assert.ok(
      result.candidates.every((c) => c.unresolvedConditions.some((s) => /nested|overlap/i.test(s)))
    )
  })
  it('duplicate reversed wall segments and collinear overlaps create no phantom room', () => {
    const result = recognizeCadRooms(
      [...walls, line(40, 0, 0, 0, 'DUP'), line(10, 0, 30, 0, 'OVERLAP')],
      options
    )
    assert.equal(result.candidates.length, 1)
    areaClose(result.candidates[0].areaSqFt, 600)
  })
  it('filters boundaries by selected layers', () => {
    assert.equal(recognizeCadRooms([poly()], { ...options, layers: ['DOOR'] }).candidates.length, 0)
    assert.equal(recognizeCadRooms(walls, { drawingUnitsPerFoot: 1 }).candidates.length, 0)
  })
  it('uses only interior TEXT/MTEXT anchors as suggested names and retains Arabic', () => {
    const result = recognizeCadRooms(
      [
        poly(),
        { type: 'MTEXT', x: 5, y: 5, text: 'غرفة اجتماعات', layer: 'LABEL' },
        { type: 'TEXT', x: 21, y: 5, text: 'outside', layer: 'LABEL' }
      ],
      options
    )
    assert.equal(result.candidates[0].name, 'غرفة اجتماعات')
    assert.equal(result.candidates[0].status, 'review-required')
  })
  it('retains physical area for translated large coordinates', () => {
    const points = rectangle.map((v, i) => v + (i % 2 ? -2e9 : 1e9))
    areaClose(recognizeCadRooms([poly(points)], options).candidates[0].areaSqFt, 300)
  })
  it('normalizes metric native drawing units exactly once', () => {
    const metric = recognizeCadRooms([poly(rectangle.map((v) => v * 304.8))], {
      ...options,
      drawingUnitsPerFoot: 304.8
    })
    areaClose(metric.candidates[0].areaSqFt, 300)
    assert.equal(metric.candidates[0].polygon[2], 6096)
  })
  it('rejects nonfinite coordinates and nonpositive or nonfinite scale', () => {
    for (const scale of [0, -1, NaN, Infinity]) {
      const result = recognizeCadRooms([poly()], { ...options, drawingUnitsPerFoot: scale })
      assert.equal(result.candidates.length, 0)
      assert.ok(result.diagnostics.some((d) => d.severity === 'error'))
    }
    const malformed = recognizeCadRooms([poly([0, 0, NaN, 0, 20, 15, 0, 15])], options)
    assert.equal(malformed.candidates.length, 0)
    assert.ok(malformed.diagnostics.some((d) => d.code === 'invalid-geometry'))
  })
  it('rejects self-intersecting closed polylines', () => {
    const result = recognizeCadRooms([poly([0, 0, 20, 15, 20, 0, 0, 15])], options)
    assert.equal(result.candidates.length, 0)
    assert.ok(result.diagnostics.some((d) => d.code === 'invalid-boundary'))
  })
  it('excludes previously approximated geometry from boundary recognition', () => {
    const result = recognizeCadRooms(
      [
        poly(rectangle, { geometryApproximation: 'sampled spline' }),
        ...walls.map((w) => ({ ...w, geometryApproximation: 'sampled curve' }))
      ],
      options
    )
    assert.equal(result.candidates.length, 0)
    assert.ok(result.diagnostics.some((d) => d.code === 'approximated-boundary-excluded'))
  })
  it('samples native closed bulges only as explicit approximate review candidates', () => {
    // A negative native bulge bows outward from this reflected canvas rectangle.
    const result = recognizeCadRooms([poly(rectangle, { bulges: [-0.2, 0, 0, 0] })], options)
    assert.equal(result.candidates.length, 1)
    assert.ok(result.candidates[0].areaSqFt > 300)
    assert.ok(result.candidates[0].unresolvedConditions.some((s) => /approximat|sampled/i.test(s)))
  })
  it('suppresses wall-sized slivers and reports the minimum area filter', () => {
    const result = recognizeCadRooms([poly([0, 0, 10, 0, 10, 1, 0, 1])], options)
    assert.equal(result.candidates.length, 0)
    assert.ok(result.diagnostics.some((d) => d.code === 'small-boundary'))
  })
  it('stops excessive segment work before recognition', () => {
    const result = recognizeCadRooms(walls, { ...options, maxSegments: 3 })
    assert.equal(result.candidates.length, 0)
    assert.ok(result.diagnostics.some((d) => d.code === 'recognition-budget-exceeded'))
  })
})
