import { describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { recognizeObstacles } from '../cad/obstacleRecognition'
import { ductConflicts, footprintConflicts, type CadApprovedObstacle } from '../cad/obstacleConflicts'
import { recognizeCadRooms } from '../cad/roomRecognition'
import { circle, dxf, header, layer, line, lwpolyline } from './fixtures/dxfBuilder'

const draw = (entities: string[], layers = ['A-WALL', 'S-COLS', 'MISC']) =>
  parseDxfText(dxf({ header: header({ insunits: 2 }), layers: layers.map(layer), blocks: [], entities }))
const room = [lwpolyline('A-WALL', [[0, 0], [30, 0], [30, 20], [0, 20]], true)]
const square = (l: string, x: number, y: number, s: number) =>
  lwpolyline(l, [[x, y], [x + s, y], [x + s, y + s], [x, y + s]], true)

describe('obstacle recognition', () => {
  it('suggests closed shapes and circles on a column layer, review-required with evidence', () => {
    const parsed = draw([...room, square('S-COLS', 10, 5, 1.5), circle('S-COLS', 20, 10, 0.8)])
    const { candidates } = recognizeObstacles(parsed.entities, { unitsPerFoot: 1 })
    expect(candidates).toHaveLength(2)
    for (const c of candidates) {
      expect(c.status).toBe('review-required')
      expect(c.confidence).toBeGreaterThanOrEqual(0.7)
      expect(c.evidence.length).toBeGreaterThan(0)
    }
    expect(candidates.map((c) => c.shape).sort()).toEqual(['circle', 'polygon'])
    expect(candidates.find((c) => c.shape === 'circle')!.widthFt).toBeCloseTo(1.6, 6)
  })
  it('small closed shapes inside a room candidate are weaker suggestions; outside any room they are ignored', () => {
    const parsed = draw([...room, square('MISC', 5, 5, 2), square('MISC', 100, 100, 2)])
    const rooms = recognizeCadRooms(parsed.entities, { drawingUnitsPerFoot: 1, layers: ['A-WALL'] }).candidates
    expect(rooms).toHaveLength(1)
    const { candidates } = recognizeObstacles(parsed.entities, { unitsPerFoot: 1, rooms })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].confidence).toBeLessThanOrEqual(0.5)
    expect(candidates[0].roomId).toBe(rooms[0].id)
  })
  it('does not turn the room outline itself, or oversized shapes, into obstacles', () => {
    const parsed = draw(room)
    const rooms = recognizeCadRooms(parsed.entities, { drawingUnitsPerFoot: 1 }).candidates
    expect(recognizeObstacles(parsed.entities, { unitsPerFoot: 1, rooms }).candidates).toEqual([])
  })
  it('is unit independent (mm drawing)', () => {
    const k = 304.8
    const parsed = parseDxfText(dxf({
      header: header({ insunits: 4 }), layers: [layer('S-COLS')], blocks: [],
      entities: [circle('S-COLS', 20 * k, 10 * k, 0.8 * k)]
    }))
    const c = recognizeObstacles(parsed.entities, { unitsPerFoot: k }).candidates[0]
    expect(c.widthFt).toBeCloseTo(1.6, 6)
  })
})

describe('approved obstacle conflicts', () => {
  const column: CadApprovedObstacle = {
    id: 'c1', status: 'approved', clearanceFt: 1,
    polygon: [10, 10, 12, 10, 12, 12, 10, 12]
  }
  const rect = (x: number, y: number, w: number, d: number) => ({ x, y, width: w, depth: d })
  it('flags a footprint overlapping the obstacle and one inside the clearance band, not one beyond it', () => {
    const o = { unitsPerFoot: 1 }
    const overlap = footprintConflicts(rect(11, 11, 3, 3), [column], o)
    expect(overlap.blocked).toBe(true)
    expect(overlap.conflicts[0]).toMatchObject({ obstacleId: 'c1', kind: 'overlap' })
    const near = footprintConflicts(rect(12.5, 10, 2, 2), [column], o)
    expect(near.conflicts[0]).toMatchObject({ kind: 'clearance' })
    expect(near.conflicts[0].distanceFt).toBeCloseTo(0.5, 9)
    expect(footprintConflicts(rect(13.5, 10, 2, 2), [column], o).blocked).toBe(false)
  })
  it('ignores obstacles that are not approved', () => {
    const suggested = { ...column, status: 'review-required' } as unknown as CadApprovedObstacle
    expect(footprintConflicts(rect(11, 11, 1, 1), [suggested], { unitsPerFoot: 1 }).blocked).toBe(false)
  })
  it('duct segment crossing, grazing the clearance band, and passing clear (width counts)', () => {
    const o = { unitsPerFoot: 1 }
    expect(ductConflicts({ a: { x: 0, y: 11 }, b: { x: 20, y: 11 }, widthFt: 1 }, [column], o).conflicts[0].kind).toBe('overlap')
    // centreline 1.8 ft above the column top; half width 0.5 + clearance 1 = 1.5 < 1.8 => clear
    expect(ductConflicts({ a: { x: 0, y: 13.8 }, b: { x: 20, y: 13.8 }, widthFt: 1 }, [column], o).blocked).toBe(false)
    // centreline 1.2 ft above: edge gap 0.7 < 1 clearance => conflict
    const c = ductConflicts({ a: { x: 0, y: 13.2 }, b: { x: 20, y: 13.2 }, widthFt: 1 }, [column], o)
    expect(c.conflicts[0].kind).toBe('clearance')
    expect(c.conflicts[0].distanceFt).toBeCloseTo(0.7, 9)
  })
  it('circular obstacles and drawing units', () => {
    const k = 304.8
    const col: CadApprovedObstacle = { id: 'r', status: 'approved', clearanceFt: 0.5, circle: { x: 20 * k, y: 10 * k, radius: 0.8 * k } }
    // footprint left edge at 21 ft: gap to circle edge = 21-20.8 = 0.2 ft < 0.5
    const r = footprintConflicts({ x: 21 * k, y: 9 * k, width: 2 * k, depth: 2 * k }, [col], { unitsPerFoot: k })
    expect(r.conflicts[0].kind).toBe('clearance')
    expect(r.conflicts[0].distanceFt).toBeCloseTo(0.2, 9)
  })
  it('rotated footprint is supported (rotation about the footprint centre; x,y is the unrotated minimum corner)', () => {
    const o = { unitsPerFoot: 1 }
    expect(footprintConflicts({ x: 10, y: 14.5, width: 4, depth: 0.5 }, [column], o).blocked).toBe(false)
    const r = footprintConflicts({ x: 10, y: 14.5, width: 4, depth: 0.5, rotationDeg: 90 }, [column], o)
    expect(r.conflicts[0].kind).toBe('clearance')
    expect(r.conflicts[0].distanceFt).toBeCloseTo(0.75, 9)
  })
})
