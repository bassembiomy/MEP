import { beforeEach, describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { useProjectStore, selectPersistedProject } from '../../store/projectStore'
import { serializeProject } from '../project/projectSerialization'
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
const s = () => useProjectStore.getState()
const load = (parsed = drawing()) => {
  s().setDxfData(parsed.entities, parsed.bbox, parsed.suggestedScaleImperial, parsed.cadUnit,
    { sourceName: 't.dxf', unitsConfidence: parsed.unitsConfidence ?? 'unknown', diagnostics: parsed.diagnostics ?? [] }, parsed.blockReferences)
  s().setCadLayerRole('S-COLS', 'column')
  useProjectStore.setState({ undoStack: [], redoStack: [] })
  return parsed
}
beforeEach(() => {
  s().clearDxfData()
  useProjectStore.setState({ project: { name: 'P', location: 'L', units: 'imperial', scale: 1, outdoorDb: 95, indoorDb: 75 }, zones: [], undoStack: [], redoStack: [] })
})

describe('R1: user-confirmed layer roles survive save/load through the store selector', () => {
  it('serializes useProjectStore.getState() via selectPersistedProject and restores the wall-layer decision', () => {
    load()
    expect(s().setCadLayerRole(W, 'wall').success).toBe(true)
    expect(s().cadLayerRoles.overrides).toMatchObject({ [W]: 'wall', 'S-COLS': 'column' })
    const text = serializeProject(selectPersistedProject(s()))
    expect(JSON.parse(text).cadLayerOverrides).toMatchObject({ [W]: 'wall', 'S-COLS': 'column' })
    s().clearDxfData()
    expect(s().restoreProjectDocument(text).success).toBe(true)
    expect(s().cadLayerRoles.overrides).toMatchObject({ [W]: 'wall', 'S-COLS': 'column' })
  })
  it('serializes a project with no drawing loaded', () => {
    expect(s().cadImport).toBeNull()
    expect(() => serializeProject(selectPersistedProject(s()))).not.toThrow()
  })
})

describe('R2: replacing or clearing the drawing resets undo history and zone obstacles', () => {
  const zoneAroundColumns = [4, -3, 18, -3, 18, -13, 4, -13] // the parser flips Y
  const setup = () => {
    load()
    s().setProject({ cadUnitsConfirmed: true })
    expect(s().addZone(zoneAroundColumns).success).toBe(true)
    expect(s().approveCadObstacle(s().cadObstacles[0].id, 1).success).toBe(true)
    expect(s().zones[0].obstacles?.length).toBeGreaterThan(0)
    expect(s().undoStack.length).toBeGreaterThan(0)
  }
  const other = () => {
    const p = parseDxfText(dxf({ header: header({ insunits: 2 }), layers: [W, '0'].map(layer), blocks: [], entities: [line(W, 0, 0, 30, 0), line(W, 30, 0, 30, 30)] }))
    s().setDxfData(p.entities, p.bbox, p.suggestedScaleImperial, p.cadUnit, { sourceName: 'b.dxf', unitsConfidence: 'declared', diagnostics: [] }, p.blockReferences)
  }
  it('setDxfData clears undo/redo so undo cannot restore the previous drawing\'s review state, and drops stale zone obstacles', () => {
    setup()
    s().undo(); s().redo()
    other()
    expect(s().undoStack).toEqual([])
    expect(s().redoStack).toEqual([])
    expect(s().zones[0].obstacles).toBeUndefined()
    s().undo()
    expect(s().cadObstacles).toEqual([])
  })
  it('clearDxfData clears undo/redo and zone obstacles', () => {
    setup()
    s().clearDxfData()
    expect(s().undoStack).toEqual([])
    expect(s().redoStack).toEqual([])
    expect(s().zones[0].obstacles).toBeUndefined()
  })
})
