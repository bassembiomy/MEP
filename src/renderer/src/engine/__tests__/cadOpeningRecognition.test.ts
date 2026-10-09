import { describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { parseDwgDatabase } from '../cad/dwgGeometry'
import { recognizeOpenings } from '../cad/openingRecognition'
import { recognizeCadRooms } from '../cad/roomRecognition'
import { arc, block, dxf, header, insert, layer, line, lwpolyline } from './fixtures/dxfBuilder'

/** Builds the same 20 x 15 ft room in any unit: k = drawing units per foot. */
function plan(k: number, insunits: number, opts: { door?: 'block' | 'arc' | 'none'; rotation?: number; sx?: number; extra?: string[]; insertX?: number; noWalls?: boolean } = {}) {
  const f = (n: number) => n * k
  const W = 'A-WALL'
  const walls = [
    line(W, f(0), f(0), f(8), f(0)), line(W, f(11), f(0), f(20), f(0)), // door gap 8..11 ft (3 ft)
    line(W, f(20), f(0), f(20), f(15)), line(W, f(20), f(15), f(0), f(15)), line(W, f(0), f(15), f(0), f(0))
  ]
  const doorSymbol = block('DOOR-3', line('0', 0, 0, 0, f(3)) + '\n' + arc('0', 0, 0, f(3), 0, 90))
  const entities = [...(opts.noWalls ? [] : walls), ...(opts.extra ?? [])]
  const blocks: string[] = []
  if (opts.door === 'block') {
    blocks.push(doorSymbol)
    entities.push(insert('A-DOOR', 'DOOR-3', f(opts.insertX ?? 8), f(0), { rotation: opts.rotation, sx: opts.sx }))
  }
  if (opts.door === 'arc') entities.push(arc('0', f(8), f(0), f(3), 0, 90))
  return parseDxfText(dxf({ header: header({ insunits }), layers: [W, 'A-DOOR', '0'].map(layer), blocks, entities }))
}
const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('parser keeps INSERT blocks as semantic objects', () => {
  it('reports name, layer, insertion, rotation, scale and exploded bounds without changing entities', () => {
    const withRef = plan(1, 2, { door: 'block', rotation: 90 })
    const refs = withRef.blockReferences!
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ name: 'DOOR-3', layer: 'A-DOOR' })
    near(refs[0].insertion.x, 8); near(refs[0].insertion.y, 0)
    near(refs[0].rotationDeg, 90); near(refs[0].scaleX, 1); near(refs[0].scaleY, 1)
    // 90 deg rotation of a quarter-circle door: bounds are 3 ft in each direction
    near(refs[0].bounds.maxX - refs[0].bounds.minX, 3, 1e-6)
    near(refs[0].bounds.maxY - refs[0].bounds.minY, 3, 1e-6)
    const without = plan(1, 2, { door: 'none' })
    expect(withRef.entities.slice(0, without.entities.length)).toEqual(without.entities)
    expect(without.blockReferences).toEqual([])
  })
  it('records nested inserts with composed placement and parent-covering bounds', () => {
    const parsed = parseDxfText(dxf({
      header: header({ insunits: 2 }), layers: [layer('L')],
      blocks: [block('INNER', line('0', 0, 0, 2, 0)), block('OUTER', insert('0', 'INNER', 1, 0))],
      entities: [insert('L', 'OUTER', 10, 5, { sx: 2, sy: 2 })]
    }))
    const refs = parsed.blockReferences!
    expect(refs.map((r) => r.name).sort()).toEqual(['INNER', 'OUTER'])
    const inner = refs.find((r) => r.name === 'INNER')!
    near(inner.insertion.x, 12); near(inner.scaleX, 2)
    const outer = refs.find((r) => r.name === 'OUTER')!
    expect(outer.bounds.maxX).toBeGreaterThanOrEqual(inner.bounds.maxX)
  })
})

describe('opening recognition', () => {
  for (const [label, rotation, sx, axis, insertX, noWalls] of [['0 deg', 0, 1, 'x+', 8, false], ['90 deg (free-standing, no wall gap)', 90, 1, 'y', 8, true], ['mirrored X scale', 0, -1, 'x-', 11, false]] as const) {
    it(`door block at ${label}: width 3 ft and span at the insertion`, () => {
      const parsed = plan(1, 2, { door: 'block', rotation, sx, insertX, noWalls })
      const { candidates } = recognizeOpenings(parsed, { unitsPerFoot: 1 })
      expect(candidates).toHaveLength(1)
      const c = candidates[0]
      expect(c).toMatchObject({ kind: 'door', status: 'review-required', origin: 'block' })
      near(c.widthFt, 3)
      expect(c.confidence).toBeGreaterThan(0.6)
      expect(c.evidence.length).toBeGreaterThan(0)
      const dx = c.span.b.x - c.span.a.x, dy = c.span.b.y - c.span.a.y
      near(Math.hypot(dx, dy), 3)
      near(c.span.a.x, insertX); near(c.span.a.y, 0) // hinge is the insertion point
      if (axis === 'x+') { near(dx, 3); near(dy, 0) }
      if (axis === 'x-') { near(dx, -3); near(dy, 0) }
      if (axis === 'y') { near(dx, 0); near(Math.abs(dy), 3) }
    })
  }
  it('finds the host wall and a gap-backed block scores higher than a floating one', () => {
    const inGap = recognizeOpenings(plan(1, 2, { door: 'block' }), { unitsPerFoot: 1 }).candidates[0]
    expect(inGap.hostWall).toBeDefined()
    expect(inGap.evidence.join(' ')).toMatch(/gap/i)
    const floating = parseDxfText(dxf({
      header: header({ insunits: 2 }), layers: [layer('A-DOOR'), layer('0')],
      blocks: [block('DOOR-3', line('0', 0, 0, 0, 3) + '\n' + arc('0', 0, 0, 3, 0, 90))],
      entities: [insert('A-DOOR', 'DOOR-3', 50, 50)]
    }))
    const f = recognizeOpenings(floating, { unitsPerFoot: 1 }).candidates[0]
    expect(f.hostWall).toBeUndefined()
    expect(f.confidence).toBeLessThan(inGap.confidence)
  })
  it('a door arc without a block in a wall gap is a lower-confidence candidate', () => {
    const block = recognizeOpenings(plan(1, 2, { door: 'block' }), { unitsPerFoot: 1 }).candidates[0]
    const { candidates } = recognizeOpenings(plan(1, 2, { door: 'arc' }), { unitsPerFoot: 1 })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ kind: 'door', origin: 'arc-in-gap', status: 'review-required' })
    near(candidates[0].widthFt, 3)
    expect(candidates[0].confidence).toBeLessThan(block.confidence)
  })
  it('a bare gap between collinear wall endpoints is only a weak generic opening', () => {
    const { candidates } = recognizeOpenings(plan(1, 2, { door: 'none' }), { unitsPerFoot: 1 })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ kind: 'opening', origin: 'wall-gap' })
    near(candidates[0].widthFt, 3)
    expect(candidates[0].confidence).toBeLessThanOrEqual(0.4)
  })
  it('does not treat a furniture block as an opening', () => {
    const parsed = parseDxfText(dxf({
      header: header({ insunits: 2 }), layers: [layer('A-FURN'), layer('0')],
      blocks: [block('DESK', lwpolyline('0', [[0, 0], [5, 0], [5, 2.5], [0, 2.5]], true))],
      entities: [insert('A-FURN', 'DESK', 3, 3)]
    }))
    expect(recognizeOpenings(parsed, { unitsPerFoot: 1 }).candidates).toEqual([])
  })
  it('window block with parallel lines at wall thickness', () => {
    const parsed = parseDxfText(dxf({
      header: header({ insunits: 2 }), layers: [layer('A-GLAZ'), layer('0')],
      blocks: [block('WIN-4', [0, 0.25, 0.5].map((y) => line('0', 0, y, 4, y)).join('\n'))],
      entities: [insert('A-GLAZ', 'WIN-4', 5, 0)]
    }))
    const { candidates } = recognizeOpenings(parsed, { unitsPerFoot: 1 })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ kind: 'window', origin: 'block' })
    near(candidates[0].widthFt, 4)
  })
  it('is equivalent between a millimetre and a foot drawing', () => {
    const ft = recognizeOpenings(plan(1, 2, { door: 'block' }), { unitsPerFoot: 1 }).candidates[0]
    const mm = recognizeOpenings(plan(304.8, 4, { door: 'block' }), { unitsPerFoot: 304.8 }).candidates[0]
    near(mm.widthFt, ft.widthFt, 1e-6)
    near(mm.confidence, ft.confidence)
    expect(mm.kind).toBe(ft.kind)
    near(mm.center.x * 1, ft.center.x * 304.8, 1e-4)
  })
  it('reports adjacent room candidate ids when rooms are supplied', () => {
    const parsed = plan(1, 2, { door: 'block' })
    const closed = parseDxfText(dxf({
      header: header({ insunits: 2 }), layers: [layer('R')], blocks: [],
      entities: [lwpolyline('R', [[0, 0], [20, 0], [20, 15], [0, 15]], true)]
    }))
    const rooms = recognizeCadRooms(closed.entities, { drawingUnitsPerFoot: 1 }).candidates
    expect(rooms).toHaveLength(1)
    const c = recognizeOpenings(parsed, { unitsPerFoot: 1, rooms }).candidates[0]
    expect(c.adjacentRoomIds).toEqual([rooms[0].id])
  })
})

describe('room recognition with approved openings', () => {
  const gapPlan = plan(1, 2, { door: 'block' })
  const opts = { drawingUnitsPerFoot: 1, layers: ['A-WALL'] }
  it('keeps the boundary open with no approved opening, even when openings are suggested', () => {
    expect(recognizeCadRooms(gapPlan.entities, opts).candidates).toHaveLength(0)
    const suggested = recognizeOpenings(gapPlan, { unitsPerFoot: 1 }).candidates
    expect(suggested).toHaveLength(1)
    expect(recognizeCadRooms(gapPlan.entities, { ...opts, approvedOpenings: [] }).candidates).toHaveLength(0)
  })
  it('closes the gap only where an approved opening spans it', () => {
    const o = recognizeOpenings(gapPlan, { unitsPerFoot: 1 }).candidates[0]
    const result = recognizeCadRooms(gapPlan.entities, { ...opts, approvedOpenings: [{ id: o.id, a: o.span.a, b: o.span.b }] })
    expect(result.candidates).toHaveLength(1)
    near(result.candidates[0].areaSqFt, 300, 1e-4)
    expect(result.candidates[0].evidence.join(' ')).toContain(o.id)
    expect(result.candidates[0].sourceHandles.some((h) => h.startsWith('opening:'))).toBe(false)
  })
  it('ignores an approved opening that does not span a wall gap', () => {
    const result = recognizeCadRooms(gapPlan.entities, { ...opts, approvedOpenings: [{ id: 'x', a: { x: 2, y: 5 }, b: { x: 4, y: 5 } }] })
    expect(result.candidates).toHaveLength(0)
    expect(result.diagnostics.some((d) => d.code === 'approved-opening-not-in-gap')).toBe(true)
  })
})

describe('DWG path keeps block references too', () => {
  it('reports the insert placement and exploded bounds', () => {
    const pt = (x: number, y: number) => ({ x, y, z: 0 })
    const parsed = parseDwgDatabase({
      tables: { BLOCK_RECORD: { entries: [{ name: 'DOOR-3', basePoint: pt(0, 0), entities: [{ type: 'LINE', startPoint: pt(0, 0), endPoint: pt(3, 0), layer: '0' }] }] } },
      entities: [{ type: 'INSERT', name: 'DOOR-3', handle: 'H1', layer: 'A-DOOR', insertionPoint: pt(8, 2), rotation: Math.PI / 2 }]
    })
    const ref = parsed.blockReferences![0]
    expect(ref).toMatchObject({ name: 'DOOR-3', layer: 'A-DOOR', handle: 'H1', entityRange: [0, 1] })
    near(ref.insertion.x, 8); near(ref.insertion.y, -2); near(ref.rotationDeg, 90)
    near(ref.bounds.maxY - ref.bounds.minY, 3)
  })
})
