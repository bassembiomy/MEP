import { describe, expect, it } from 'vitest'
import { recognizeObstacles } from '../cad/obstacleRecognition'
import type { DxfEntity } from '../../store/projectStore'

/**
 * DOCUMENTED GAP (corpus README, C8): an obstacle id is `cad-obstacle:<cx>,<cy>:<size ft>` with the centre printed with
 * toFixed(3) in DRAWING units. On tiny-unitless.dxf (0.0025 units per metre) that is a 0.4 m grid, so nearby obstacles of
 * the same size can share an id. Any finer quantisation must derive from the bounding box, never from the scale
 * (the scale is user-editable and saved decisions are keyed by id).
 */
const UNITS_PER_METRE = 0.0025, UNITS_PER_FOOT = UNITS_PER_METRE * 0.3048
const square = (handle: string, cx: number, cy: number, half: number): DxfEntity => ({
  type: 'LWPOLYLINE', layer: 'S-COLS', handle, closed: true,
  points: [cx - half, cy - half, cx + half, cy - half, cx + half, cy + half, cx - half, cy + half]
}) as DxfEntity
const ids = (entities: DxfEntity[]) =>
  recognizeObstacles(entities, { unitsPerFoot: UNITS_PER_FOOT, layerRoles: { 'S-COLS': 'column' } }).candidates

describe('obstacle id resolution on tiny drawings (documented gap)', () => {
  const half = 0.00025 // a 0.2 m column

  it('two distinct 0.2 m columns 0.2 m apart are two candidates but share one id (the gap)', () => {
    const c = ids([square('A', 0.004, 0.004, half), square('B', 0.0045, 0.004, half)])
    expect(c).toHaveLength(2)
    expect(c[0].id).toBe(c[1].id)
    expect(c.map(x => x.sourceHandles[0]).sort()).toEqual(['A', 'B'])
  })
  it('bound: columns whose centres are at least one 0.001-unit step (0.4 m) apart in x or y get distinct ids', () => {
    for (const [dx, dy] of [[0.001, 0], [0, 0.001], [0.0011, 0.0011]]) {
      const c = ids([square('A', 0.0041, 0.0041, half), square('B', 0.0041 + dx, 0.0041 + dy, half)])
      expect(new Set(c.map(x => x.id)).size, `offset ${dx},${dy}`).toBe(2)
    }
  })
  it('at ordinary scale (mm drawing, 304.8 units per ft) the same layout has distinct ids', () => {
    const big = (cx: number, cy: number) => square('h' + cx, cx, cy, 100)
    const c = recognizeObstacles([big(4000, 4000), big(4500, 4000)], { unitsPerFoot: 304.8, layerRoles: { 'S-COLS': 'column' } }).candidates
    expect(new Set(c.map(x => x.id)).size).toBe(2)
  })
})
