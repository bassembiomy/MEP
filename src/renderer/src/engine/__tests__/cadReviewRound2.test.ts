import { beforeEach, describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { useProjectStore, selectPersistedProject } from '../../store/projectStore'
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

describe('R3: restoring a project re-derives zone obstacles from the CAD review state', () => {
  const zonePts = [4, -3, 18, -3, 18, -13, 4, -13]
  const saved = () => {
    load()
    s().setProject({ cadUnitsConfirmed: true })
    expect(s().addZone(zonePts).success).toBe(true)
    expect(s().approveCadObstacle(s().cadObstacles[0].id, 1).success).toBe(true)
    return JSON.parse(serializeProject(selectPersistedProject(s())))
  }
  it('a version 2 file whose zone obstacles were removed gets them back', () => {
    const doc = saved()
    expect(doc.zones[0].obstacles.length).toBe(1)
    delete doc.zones[0].obstacles
    s().clearDxfData()
    expect(s().restoreProjectDocument(JSON.stringify(doc)).success).toBe(true)
    expect(s().zones[0].obstacles?.map(o => o.id)).toEqual([s().cadObstacles.find(o => o.status === 'approved')!.id])
  })
  it('a version 2 file cannot smuggle in a zone obstacle that is not an approved CAD obstacle', () => {
    const doc = saved()
    doc.zones[0].obstacles = [{ ...doc.zones[0].obstacles[0], id: 'forged', clearanceFt: 99 }]
    expect(s().restoreProjectDocument(JSON.stringify(doc)).success).toBe(true)
    expect(s().zones[0].obstacles?.map(o => o.id)).not.toContain('forged')
  })
  it('a version 1 file with zone obstacles has them dropped (no approvals existed then)', () => {
    const doc = saved()
    doc.version = 1
    for (const key of ['cadOpenings', 'cadObstacles', 'cadLevel']) delete doc[key]
    expect(doc.zones[0].obstacles.length).toBe(1)
    expect(s().restoreProjectDocument(JSON.stringify(doc)).success).toBe(true)
    expect(s().zones[0].obstacles).toBeUndefined()
  })
})

describe('R4: version 1 documents are not trusted for decisions that did not exist then', () => {
  const v2doc = () => {
    load()
    s().setProject({ cadUnitsConfirmed: true })
    s().addZone([4, -3, 18, -3, 18, -13, 4, -13])
    s().approveCadObstacle(s().cadObstacles[0].id, 1)
    s().approveCadOpening(s().cadOpenings[0].id)
    return JSON.parse(serializeProject(selectPersistedProject(s())))
  }
  it('a v1 file with an unconfirmable import never keeps an explicit cadUnitsConfirmed=true', () => {
    const doc = v2doc()
    doc.cadImport = { sourceName: 'x.dxf', unitsConfidence: 'estimated', diagnostics: [] }
    doc.project.cadUnitsConfirmed = true
    expect(parseProjectDocument(JSON.stringify(doc)).project.cadUnitsConfirmed).toBe(true) // v2: the user's recorded decision
    doc.version = 1
    expect(parseProjectDocument(JSON.stringify(doc)).project.cadUnitsConfirmed).toBe(false)
  })
  it('a v1 file with auto-confirmable units keeps its stored value', () => {
    const doc = v2doc()
    doc.cadImport = { sourceName: 'x.dxf', unitsConfidence: 'declared', diagnostics: [] }
    doc.version = 1
    expect(parseProjectDocument(JSON.stringify(doc)).project.cadUnitsConfirmed).toBe(true)
  })
  it('ignores cadOpenings, cadObstacles, cadLevel and zone obstacles in a v1 file', () => {
    const doc = v2doc()
    expect(doc.cadOpenings.some((o: { status: string }) => o.status === 'approved')).toBe(true)
    doc.version = 1
    const parsed = parseProjectDocument(JSON.stringify(doc))
    expect(parsed.cadOpenings).toBeUndefined()
    expect(parsed.cadObstacles).toBeUndefined()
    expect(parsed.cadLevel).toBeUndefined()
    expect(parsed.zones[0].obstacles).toBeUndefined()
    expect(s().restoreProjectDocument(JSON.stringify(doc)).success).toBe(true)
    expect(s().cadOpenings.every(o => o.status === 'review-required')).toBe(true)
    expect(s().cadObstacles.every(o => o.status === 'review-required')).toBe(true)
  })
})

describe('R5: approving a room requires the recognition context it was recognised under', () => {
  const room = [{ type: 'LWPOLYLINE' as const, points: [0, 0, 200, 0, 200, 150, 0, 150], closed: true, handle: 'R1', layer: 'ROOM' }]
  const setupRoom = () => {
    useProjectStore.setState({ project: { name: 'P', location: 'L', units: 'imperial', scale: 10, outdoorDb: 95, indoorDb: 75, cadUnitsConfirmed: true }, dxfEntities: structuredClone(room) })
    const r = s().recognizeCadRoomCandidates()
    expect(r.success).toBe(true)
    const inputs = { name: 'Office', spaceTypeId: 'office', ceilingHeight: 10, occupants: 2, sourceCadRevision: r.sourceCadRevision!, drawingUnitsPerFoot: r.drawingUnitsPerFoot!, recognitionContext: r.recognitionContext! }
    return { candidate: r.result!.candidates[0], inputs }
  }
  it('approves with the matching context', () => {
    const { candidate, inputs } = setupRoom()
    expect(s().approveCadRoom(candidate, inputs).success).toBe(true)
  })
  it('refuses a missing or different context and leaves zones untouched', () => {
    const { candidate, inputs } = setupRoom()
    const { recognitionContext: _omit, ...without } = inputs
    const missing = s().approveCadRoom(candidate, without as typeof inputs)
    expect(missing.success).toBe(false)
    expect(missing.error).toMatch(/recognize/i)
    expect(s().approveCadRoom(candidate, { ...inputs, recognitionContext: '{}' }).success).toBe(false)
    expect(s().zones).toEqual([])
  })
})

describe('R8: clearance bands reaching into a zone from outside', () => {
  const project10 = { name: 'T', location: 'C', scale: 10, units: 'imperial' as const, outdoorDb: 95, indoorDb: 75, cadUnitsConfirmed: true }
  const column = (id: string, x: number, clearanceFt: number) => ({
    id, shape: 'polygon' as const, polygon: [x, 140, x + 20, 140, x + 20, 160, x, 160], widthFt: 2, depthFt: 2, layer: 'S-COLS',
    sourceHandles: ['C' + id], confidence: 0.8, evidence: ['test'], status: 'approved' as const, level: 0, clearanceFt
  })
  const zoneRect = [0, 0, 400, 0, 400, 300, 0, 300]
  const drawZone = () => {
    expect(s().addZone(zoneRect).success).toBe(true)
    return s().zones[0]
  }
  beforeEach(() => {
    useProjectStore.setState({ project: project10, zones: [], dxfEntities: [], selectedZoneId: null, undoStack: [], redoStack: [], cadObstacles: [] })
  })
  it('a hand-drawn zone 0.2 ft short of an approved 3 ft column gets it, and a duct inside the band is rejected', async () => {
    const { generateSystemCandidates, DEFAULT_OPTIMIZATION_WEIGHTS } = await import('../systemDesigner')
    const { calculateCanonicalZoneLoad } = await import('../loadCalc')
    useProjectStore.setState({ cadObstacles: [column('near', 402, 3), column('far', 460, 3)] })
    const drawn = drawZone()
    expect(drawn.obstacles?.map(o => o.id)).toEqual(['near']) // 0.2 ft away, band 3 ft; 'far' is 6 ft away
    const zone = { ...drawn, manualCfmOverride: 1200, maxSpaceNcLimit: 30, maxVelocityLimitFpm: 1500 }
    const load = calculateCanonicalZoneLoad(zone, project10)
    const cand = generateSystemCandidates(load.totalLoad, load.sensibleLoad, load.supplyCfm, 'office', load.area, true, DEFAULT_OPTIMIZATION_WEIGHTS, ['concealed']).candidates.find(c => c.isValid)!
    useProjectStore.setState({ zones: [zone], selectedZoneId: zone.id })
    const before = s()
    const out = s().applyCandidateTransaction(cand)
    expect(out.success).toBe(false)
    expect(out.error).toMatch(/near/)
    expect(s().zones).toBe(before.zones)
  })
  it('an obstacle whose clearance band stops short of the zone is still ignored', () => {
    useProjectStore.setState({ cadObstacles: [column('far', 440, 2)] })
    expect(drawZone().obstacles).toBeUndefined()
  })
  it('re-syncs zones when the scale changes (setProject and calibration)', () => {
    useProjectStore.setState({ cadObstacles: [column('edge', 410, 2)] }) // 1 ft away at 10 units/ft
    expect(drawZone().obstacles?.map(o => o.id)).toEqual(['edge'])
    s().setProject({ scale: 2 }) // now 5 ft away
    expect(s().zones[0].obstacles).toBeUndefined()
    s().setProject({ scale: 10 })
    expect(s().zones[0].obstacles?.map(o => o.id)).toEqual(['edge'])
    expect(s().calibrateScaleFromPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 50, 'ft').success).toBe(true) // 2 units/ft
    expect(s().zones[0].obstacles).toBeUndefined()
  })
  it('approving a CAD room uses the same band rule', () => {
    const room = [{ type: 'LWPOLYLINE' as const, points: zoneRect, closed: true, handle: 'R1', layer: 'ROOM' }]
    useProjectStore.setState({ dxfEntities: structuredClone(room), cadObstacles: [column('edge', 410, 2)] })
    const r = s().recognizeCadRoomCandidates()
    expect(s().approveCadRoom(r.result!.candidates[0], { name: 'R', spaceTypeId: 'office', ceilingHeight: 10, occupants: 1, sourceCadRevision: r.sourceCadRevision!, drawingUnitsPerFoot: r.drawingUnitsPerFoot!, recognitionContext: r.recognitionContext! }).success).toBe(true)
    expect(s().zones[0].obstacles?.map(o => o.id)).toEqual(['edge'])
  })
})
