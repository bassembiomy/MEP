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
  const hiddenFirst = square('COLS', 1000, 1000), shown = [square('COLS', 5000, 5000)]
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
