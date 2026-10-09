import { beforeEach, describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { useProjectStore } from '../../store/projectStore'
import { parseProjectDocument, serializeProject } from '../project/projectSerialization'
import { circle, dxf, header, layer, line, lwpolyline, block, insert, arc } from './fixtures/dxfBuilder'

const W = 'A-WALL'
/** 20 x 15 ft room in feet with a 3 ft door gap (8..11 ft), a door block and a column. */
function drawing(insunits = 2) {
  const walls = [
    line(W, 0, 0, 8, 0), line(W, 11, 0, 20, 0), line(W, 20, 0, 20, 15), line(W, 20, 15, 0, 15), line(W, 0, 15, 0, 0)
  ]
  const door = block('DOOR-3', line('0', 0, 0, 0, 3) + '\n' + arc('0', 0, 0, 3, 0, 90))
  return parseDxfText(dxf({
    header: header({ insunits }), layers: [W, 'A-DOOR', 'S-COLS', '0'].map(layer), blocks: [door],
    entities: [...walls, insert('A-DOOR', 'DOOR-3', 8, 0), lwpolyline('S-COLS', [[10, 5], [11.5, 5], [11.5, 6.5], [10, 6.5]], true), circle('S-COLS', 15, 10, 0.8)]
  }))
}
const load = (parsed = drawing(), columns = true) => {
  useProjectStore.getState().setDxfData(parsed.entities, parsed.bbox, parsed.suggestedScaleImperial, parsed.cadUnit,
    { sourceName: 't.dxf', unitsConfidence: parsed.unitsConfidence ?? 'unknown', diagnostics: parsed.diagnostics ?? [] }, parsed.blockReferences)
  // In this small fixture the geometry statistics call the column layer 'wall', so the name/geometry conflict
  // leaves it 'unknown' (no obstacle suggestions) until the user explicitly assigns the column role.
  if (columns) useProjectStore.getState().setCadLayerRole('S-COLS', 'column')
  useProjectStore.setState({ undoStack: [], redoStack: [] })
  return parsed
}
beforeEach(() => {
  useProjectStore.getState().clearDxfData()
  useProjectStore.setState({ project: { name: 'P', location: 'L', units: 'imperial', scale: 1, outdoorDb: 95, indoorDb: 75 }, zones: [], undoStack: [], redoStack: [] })
})

describe('CAD semantic store (W1)', () => {
  it('runs layer classification, opening and obstacle recognition when CAD data is set; everything is a suggestion', () => {
    load(drawing(), false)
    expect(useProjectStore.getState().cadObstacles).toHaveLength(0) // unresolved layer role: nothing is suggested
    useProjectStore.getState().setCadLayerRole('S-COLS', 'column')
    const s = useProjectStore.getState()
    expect(s.cadLevel).toBe(0)
    expect(s.cadLayerRoles.suggestions.length).toBeGreaterThan(0)
    expect(s.cadLayerRoles.suggestions.every(c => c.source === 'suggested')).toBe(true)
    expect(s.cadLayerRoles.overrides).toEqual({ 'S-COLS': 'column' })
    expect(s.cadOpenings.length).toBeGreaterThan(0)
    expect(s.cadObstacles.length).toBe(2)
    expect([...s.cadOpenings, ...s.cadObstacles].every(c => c.status === 'review-required')).toBe(true)
  })
  it('records explicit user decisions, validates clearance, and undoes/redoes them', () => {
    load()
    const s = () => useProjectStore.getState()
    const op = s().cadOpenings[0].id, ob = s().cadObstacles[0].id
    expect(s().approveCadObstacle(ob, -1).success).toBe(false)
    expect(s().approveCadObstacle(ob, NaN).success).toBe(false)
    expect(s().approveCadObstacle('nope', 1).success).toBe(false)
    expect(s().cadObstacles[0].status).toBe('review-required')
    expect(s().approveCadObstacle(ob, 1.5).success).toBe(true)
    expect(s().cadObstacles.find(o => o.id === ob)).toMatchObject({ status: 'approved', clearanceFt: 1.5 })
    expect(s().approveCadOpening(op).success).toBe(true)
    expect(s().rejectCadObstacle(s().cadObstacles[1].id).success).toBe(true)
    expect(s().cadObstacles[1].status).toBe('rejected')
    s().undo(); expect(s().cadObstacles[1].status).toBe('review-required')
    s().undo(); expect(s().cadOpenings.find(o => o.id === op)!.status).toBe('review-required')
    s().undo(); expect(s().cadObstacles.find(o => o.id === ob)!.status).toBe('review-required')
    s().redo(); expect(s().cadObstacles.find(o => o.id === ob)!.status).toBe('approved')
    s().redo(); s().redo()
    expect(s().cadObstacles[1].status).toBe('rejected')
    expect(s().cadOpenings.find(o => o.id === op)!.status).toBe('approved')
  })
  it('layer overrides win, are undoable, keep decisions, and unknown layers or roles are refused', () => {
    load()
    const s = () => useProjectStore.getState()
    expect(s().setCadLayerRole('NOPE', 'wall').success).toBe(false)
    expect(s().setCadLayerRole(W, 'banana' as never).success).toBe(false)
    const ob = s().cadObstacles[0].id
    s().approveCadObstacle(ob, 1)
    expect(s().setCadLayerRole('S-COLS', 'furniture').success).toBe(true)
    expect(s().cadLayerRoles.overrides).toEqual({ 'S-COLS': 'furniture' })
    expect(s().cadObstacles.find(o => o.id === ob)?.status).toBe('approved') // decided items are never silently dropped
    s().undo(); expect(s().cadLayerRoles.overrides).toEqual({ 'S-COLS': 'column' })
    s().redo(); expect(s().cadLayerRoles.overrides).toEqual({ 'S-COLS': 'furniture' })
    expect(s().setCadLayerRole('S-COLS', null).success).toBe(true)
    expect(s().cadLayerRoles.overrides).toEqual({})
  })
  it('setCadLevel validates, re-recognises for the level and is undoable', () => {
    const parsed = drawing()
    parsed.entities.forEach(e => { (e as { elevation?: number }).elevation = 3 })
    load(parsed, false)
    const s = () => useProjectStore.getState()
    s().setCadLayerRole('S-COLS', 'column')
    expect(s().cadOpenings).toHaveLength(0) // level 0 sees nothing: every entity is at elevation 3
    expect(s().setCadLevel(Infinity).success).toBe(false)
    expect(s().setCadLevel(3).success).toBe(true)
    expect(s().cadLevel).toBe(3)
    expect(s().cadObstacles.length).toBe(2)
    expect(s().cadObstacles.every(o => o.level === 3)).toBe(true)
    s().undo(); expect(s().cadLevel).toBe(0); expect(s().cadObstacles).toHaveLength(0)
    s().undo(); expect(s().cadLayerRoles.overrides).toEqual({})
  })
  it('a new drawing starts a fresh review and clearDxfData resets it', () => {
    load()
    useProjectStore.getState().approveCadObstacle(useProjectStore.getState().cadObstacles[0].id, 1)
    load()
    expect(useProjectStore.getState().cadObstacles.every(o => o.status === 'review-required')).toBe(true)
    useProjectStore.getState().clearDxfData()
    expect(useProjectStore.getState()).toMatchObject({ cadOpenings: [], cadObstacles: [], cadLevel: 0 })
  })
})

describe('CAD semantics serialization (W1)', () => {
  it('round-trips elevation, user roles, decisions and level through a version 2 document', () => {
    const parsed = drawing()
    parsed.entities[0].elevation = 0
    load(parsed, false)
    const s = () => useProjectStore.getState()
    s().setCadLayerRole('S-COLS', 'column')
    s().approveCadObstacle(s().cadObstacles[0].id, 2)
    s().approveCadOpening(s().cadOpenings[0].id)
    const text = serializeProject({ project: s().project, zones: s().zones, dxfEntities: s().dxfEntities, dxfBoundingBox: s().dxfBoundingBox, dxfLayers: s().dxfLayers,
      cadLayerOverrides: s().cadLayerRoles.overrides, cadOpenings: s().cadOpenings, cadObstacles: s().cadObstacles, cadLevel: s().cadLevel })
    expect(JSON.parse(text).version).toBe(2)
    const saved = { openings: s().cadOpenings, obstacles: s().cadObstacles }
    useProjectStore.getState().clearDxfData()
    expect(useProjectStore.getState().restoreProjectDocument(text).success).toBe(true)
    expect(s().cadObstacles).toEqual(saved.obstacles)
    expect(s().cadOpenings).toEqual(saved.openings)
    expect(s().cadLayerRoles.overrides).toEqual({ 'S-COLS': 'column' })
    expect(s().cadLayerRoles.suggestions.length).toBeGreaterThan(0)
    expect(s().dxfEntities[0].elevation).toBe(0)
  })
  it('keeps constant entity elevation through serialization and rejects a non-finite one', () => {
    const parsed = drawing()
    parsed.entities[0].elevation = 3.5
    load(parsed)
    const s = useProjectStore.getState()
    const base = { project: s.project, zones: [], dxfEntities: s.dxfEntities, dxfBoundingBox: s.dxfBoundingBox, dxfLayers: s.dxfLayers }
    expect(parseProjectDocument(serializeProject(base)).dxfEntities[0].elevation).toBe(3.5)
    const doc = JSON.parse(serializeProject(base)); doc.dxfEntities[0].elevation = 'high'
    expect(() => parseProjectDocument(JSON.stringify(doc))).toThrow(/elevation/i)
  })
  it('loads a version 1 file written before CAD review state existed, with fresh suggestions and no approvals', () => {
    load()
    const s = useProjectStore.getState()
    const doc = JSON.parse(serializeProject({ project: s.project, zones: [], dxfEntities: s.dxfEntities, dxfBoundingBox: s.dxfBoundingBox, dxfLayers: s.dxfLayers }))
    doc.version = 1
    for (const key of ['cadOpenings', 'cadObstacles', 'cadLevel']) delete doc[key]
    doc.cadLayerOverrides = { 'S-COLS': 'column' } // a role the user had chosen survives; decisions did not exist yet
    expect(parseProjectDocument(JSON.stringify(doc)).cadObstacles).toBeUndefined()
    useProjectStore.getState().clearDxfData()
    expect(useProjectStore.getState().restoreProjectDocument(JSON.stringify(doc)).success).toBe(true)
    const r = useProjectStore.getState()
    expect(r.cadObstacles.length).toBe(2)
    expect(r.cadOpenings.length).toBeGreaterThan(0)
    expect([...r.cadOpenings, ...r.cadObstacles].every(c => c.status === 'review-required')).toBe(true)
    expect(r.cadLevel).toBe(0)
  })
  it('rejects malformed CAD review state atomically', () => {
    load()
    const s = useProjectStore.getState()
    s.approveCadObstacle(s.cadObstacles[0].id, 1)
    const t = useProjectStore.getState()
    const good = JSON.parse(serializeProject({ project: t.project, zones: [], dxfEntities: t.dxfEntities, dxfBoundingBox: t.dxfBoundingBox, dxfLayers: t.dxfLayers,
      cadLayerOverrides: t.cadLayerRoles.overrides, cadOpenings: t.cadOpenings, cadObstacles: t.cadObstacles, cadLevel: 0 }))
    const bad: [string, unknown][] = [
      ['cadLayerOverrides', { A: 'banana' }], ['cadOpenings', {}], ['cadObstacles', [{ ...good.cadObstacles[0], status: 'maybe' }]],
      ['cadObstacles', [{ ...good.cadObstacles[0], clearanceFt: undefined }]], ['cadObstacles', [{ ...good.cadObstacles[0], clearanceFt: -1 }]],
      ['cadLevel', 'zero']
    ]
    for (const [key, value] of bad) {
      const source = JSON.stringify({ ...good, [key]: value })
      expect(() => parseProjectDocument(source), key).toThrow()
      const before = useProjectStore.getState()
      expect(before.restoreProjectDocument(source).success).toBe(false)
      expect(useProjectStore.getState()).toBe(before)
    }
  })
})
