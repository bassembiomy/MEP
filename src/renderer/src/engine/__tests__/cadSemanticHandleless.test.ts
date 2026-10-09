import { describe, expect, it } from 'vitest'
import { recognizeCadSemantics, sameObstacleObject } from '../cad/cadSemanticState'
import type { StoredCadObstacle } from '../cad/cadSemanticState'
import type { DxfEntity } from '../../store/projectStore'

/** Handle-less (R12-style) closed squares: recognition falls back to sourceHandles ['entity-<index>']. */
const square = (layer: string, cx: number, cy: number, half = 100): DxfEntity => ({
  type: 'LWPOLYLINE', layer, closed: true,
  points: [cx - half, cy - half, cx + half, cy - half, cx + half, cy + half, cx - half, cy + half]
}) as DxfEntity
const base = { bbox: { minX: 0, maxX: 10000, minY: 0, maxY: 10000 }, unitsPerFoot: 304.8, level: 0, overrides: {} }
const suggestions = [{ layer: 'COLS', role: 'column' as const, confidence: 1, reasons: [], source: 'suggested' as const }]

describe('handle-less entities and decided obstacles', () => {
  const hiddenFirst = square('COLS', 1000, 1000)
  it('showing a source-hidden layer whose entities come first does not drop a different, new obstacle', () => {
    const first = recognizeCadSemantics({ ...base, entities: shown, suggestions })
    expect(first.obstacles).toHaveLength(1)
    const decided = { ...first.obstacles[0], status: 'approved' as const, clearanceFt: 1 }
    // The hidden layer's entity now precedes the other one, so the decided obstacle's entity-0 handle is reused by the new one.
    const second = recognizeCadSemantics({ ...base, entities: [hiddenFirst, ...shown], suggestions, prior: { openings: [], obstacles: [decided] } })
    expect(second.obstacles).toHaveLength(2)
    expect(second.obstacles.find((o) => o.id === decided.id)?.status).toBe('approved')
    expect(second.obstacles.filter((o) => o.status === 'review-required')).toHaveLength(1)
  })
  it('sameObstacleObject ignores synthetic entity-N handles', () => {
    const mk = (cx: number): StoredCadObstacle => ({
      id: 'x' + cx, shape: 'polygon', polygon: [cx, 0, cx + 10, 0, cx + 10, 10], widthFt: 1, depthFt: 1, layer: 'COLS',
      sourceHandles: ['entity-0'], confidence: 1, evidence: [], status: 'review-required', level: 0
    }) as StoredCadObstacle
    expect(sameObstacleObject(mk(0), mk(500))).toBe(false)
    expect(sameObstacleObject(mk(0), mk(0))).toBe(true)
    expect(sameObstacleObject({ ...mk(0), sourceHandles: ['A1'] }, { ...mk(500), sourceHandles: ['A1'] })).toBe(true)
  })
})

const shown = [square('COLS', 5000, 5000)]
describe('rescaling decided items', async () => {
  const { parseDxfText } = await import('../dxfParser')
  const { arc, dxf, header, layer, line } = await import('./fixtures/dxfBuilder')
  // 20 ft wall with a 3 ft gap at 8..11 ft and a free-standing door arc hinged at the gap: a door at 1 unit/ft, a bare opening when
  // the same drawing is read at 0.5 unit/ft (the arc is then a 6 ft leaf, over the door limit).
  const parsed = parseDxfText(dxf({ header: header({ insunits: 2 }), layers: ['A-WALL', '0'].map(layer), blocks: [],
    entities: [line('A-WALL', 0, 0, 8, 0), line('A-WALL', 11, 0, 20, 0), arc('0', 8, 0, 3, 0, 90)] }))
  const common = { entities: parsed.entities, bbox: parsed.bbox, blockReferences: parsed.blockReferences, level: 0, overrides: {} }

  it('a decided door and the new suggestion for the same gap at another scale do not coexist', () => {
    const first = recognizeCadSemantics({ ...common, unitsPerFoot: 1 })
    expect(first.openings.map((o) => o.kind)).toEqual(['door'])
    const decided = { ...first.openings[0], status: 'approved' as const }
    const second = recognizeCadSemantics({ ...common, unitsPerFoot: 0.5, priorUnitsPerFoot: 1, prior: { openings: [decided], obstacles: [] } })
    expect(second.openings).toHaveLength(1)
    expect(second.openings[0]).toMatchObject({ id: decided.id, status: 'approved' })
  })
  it('at the same scale a decided opening is kept and no duplicate is suggested (stable ids)', () => {
    const first = recognizeCadSemantics({ ...common, unitsPerFoot: 1 })
    const decided = { ...first.openings[0], status: 'approved' as const }
    const second = recognizeCadSemantics({ ...common, unitsPerFoot: 1, prior: { openings: [decided], obstacles: [] } })
    expect(second.openings).toHaveLength(1)
  })
  it('a decided item keeps its evidence but marks the stale sizes as from the previous scale', () => {
    const first = recognizeCadSemantics({ ...base, entities: shown, suggestions })
    const decided = { ...first.obstacles[0], status: 'approved' as const, clearanceFt: 1 }
    expect(decided.evidence.join(' ')).toMatch(/\d\.\d\d x \d\.\d\d ft\)/)
    const second = recognizeCadSemantics({ ...base, entities: shown, suggestions, unitsPerFoot: 100, priorUnitsPerFoot: 304.8, prior: { openings: [], obstacles: [decided] } })
    const kept = second.obstacles.find((o) => o.status === 'approved')!
    expect(kept.widthFt).toBeCloseTo(decided.widthFt * 3.048, 6)
    const sized = kept.evidence.filter((e) => /\d ft\)/.test(e))
    expect(sized.length).toBeGreaterThan(0)
    expect(sized.every((e) => e.endsWith('(at the previous scale)'))).toBe(true)
    // rescaling again does not stack the note
    const third = recognizeCadSemantics({ ...base, entities: shown, suggestions, unitsPerFoot: 50, priorUnitsPerFoot: 100, prior: { openings: [], obstacles: [kept] } })
    expect(third.obstacles.find((o) => o.status === 'approved')!.evidence).toEqual(kept.evidence)
    // returning to the scale the figures were derived at drops the note again (A -> B -> A)
    const back = recognizeCadSemantics({ ...base, entities: shown, suggestions, unitsPerFoot: 304.8, priorUnitsPerFoot: 50, prior: { openings: [], obstacles: [third.obstacles.find((o) => o.status === 'approved')!] } })
    const restored = back.obstacles.find((o) => o.status === 'approved')!
    expect(restored.evidence).toEqual(decided.evidence)
    expect(restored.widthFt).toBeCloseTo(decided.widthFt, 6)
  })
})
