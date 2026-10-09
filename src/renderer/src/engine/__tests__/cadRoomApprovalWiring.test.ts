import { beforeEach, describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { useProjectStore, selectCeilingHeightSuggestion } from '../../store/projectStore'
import { serializeProject, parseProjectDocument } from '../project/projectSerialization'
import { dxf, header, layer, line, text } from './fixtures/dxfBuilder'

const W = 'A-WALL'
/** 20 x 15 ft room of loose wall lines (no closed polyline) with a 3 ft door gap at 8..11 ft. */
const wallLines = [
  line(W, 0, 0, 8, 0), line(W, 11, 0, 20, 0), line(W, 20, 0, 20, 15), line(W, 20, 15, 0, 15), line(W, 0, 15, 0, 0)
]
function load(extra: string[] = [], tweak?: (e: { elevation?: number }[]) => void) {
  const parsed = parseDxfText(dxf({ header: header({ insunits: 2 }), layers: [W, 'A-ANNO'].map(layer), blocks: [], entities: [...wallLines, ...extra] }))
  tweak?.(parsed.entities)
  useProjectStore.getState().setDxfData(parsed.entities, parsed.bbox, parsed.suggestedScaleImperial, parsed.cadUnit,
    { sourceName: 'p.dxf', unitsConfidence: 'declared', diagnostics: [] }, parsed.blockReferences)
  useProjectStore.setState({ undoStack: [], redoStack: [] })
}
const s = () => useProjectStore.getState()
beforeEach(() => {
  s().clearDxfData()
  useProjectStore.setState({ project: { name: 'P', location: 'L', units: 'imperial', scale: 1, outdoorDb: 95, indoorDb: 75 }, zones: [], undoStack: [], redoStack: [] })
})

describe('recognition wiring (W3)', () => {
  it('without a user-confirmed wall layer only closed polylines are used, so loose wall lines give no room', () => {
    load()
    expect(s().cadLayerRoles.suggestions.find(c => c.layer === W)?.role).toBe('wall') // a suggestion only
    const r = s().recognizeCadRoomCandidates()
    expect(r.success).toBe(true)
    expect(r.wallLayers).toEqual([])
    expect(r.result!.candidates).toHaveLength(0)
  })
  it('a user-confirmed wall layer is used, and the gap stays open until an opening is approved', () => {
    load()
    s().setCadLayerRole(W, 'wall')
    const open = s().recognizeCadRoomCandidates()
    expect(open.wallLayers).toEqual([W])
    expect(open.result!.candidates).toHaveLength(0)
    const gap = s().cadOpenings.find(o => o.kind !== 'window')!
    expect(gap).toBeTruthy()
    // A rejected or merely suggested opening does not close the gap.
    s().rejectCadOpening(gap.id)
    expect(s().recognizeCadRoomCandidates().result!.candidates).toHaveLength(0)
    s().approveCadOpening(gap.id)
    const closed = s().recognizeCadRoomCandidates()
    expect(closed.approvedOpeningIds).toEqual([gap.id])
    expect(closed.result!.candidates).toHaveLength(1)
    expect(closed.result!.candidates[0].areaSqFt).toBeCloseTo(300, 3)
    expect(closed.drawingUnitsPerFoot).toBe(1)
    expect(closed.sourceCadRevision).toBe(JSON.stringify(s().dxfEntities))
  })
  it('recognises the selected level only', () => {
    load([], es => es.forEach(e => { e.elevation = 3 }))
    s().setCadLayerRole(W, 'wall')
    const gap0 = s().cadOpenings.length
    expect(gap0).toBe(0)
    expect(s().recognizeCadRoomCandidates().result!.candidates).toHaveLength(0)
    s().setCadLevel(3)
    s().approveCadOpening(s().cadOpenings.find(o => o.kind !== 'window')!.id)
    const r = s().recognizeCadRoomCandidates()
    expect(r.level).toBe(3)
    expect(r.result!.candidates).toHaveLength(1)
  })
  it('refuses to recognise rooms while units are unconfirmed', () => {
    load()
    useProjectStore.setState({ project: { ...s().project, cadUnitsConfirmed: false } })
    const r = s().recognizeCadRoomCandidates()
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/confirm.*units/i)
  })
})

function approvedRoom(extra: string[] = []) {
  load(extra)
  s().setCadLayerRole(W, 'wall')
  s().approveCadOpening(s().cadOpenings.find(o => o.kind !== 'window')!.id)
  return s().recognizeCadRoomCandidates()
}
const inputsFor = (r: ReturnType<typeof approvedRoom>, over: Record<string, unknown> = {}) => ({
  name: 'Office', spaceTypeId: 'office', ceilingHeight: 10, occupants: 2,
  sourceCadRevision: r.sourceCadRevision!, drawingUnitsPerFoot: r.drawingUnitsPerFoot!, recognitionContext: r.recognitionContext, ...over
})

describe('ceiling height suggestion wiring (W3)', () => {
  const note = [text('A-ANNO', 10, 7, 0.5, 'CH=2.8m')]
  it('exposes the suggestion through a selector in project units without applying it', () => {
    const r = approvedRoom(note)
    const candidate = r.result!.candidates[0]
    const sug = selectCeilingHeightSuggestion(s(), candidate)
    expect(sug.suggestion?.valueFt).toBeCloseTo(2.8 / 0.3048, 6)
    expect(sug.suggestion?.value).toBeCloseTo(2.8 / 0.3048, 6)
    expect(sug.suggestion?.unit).toBe('ft')
    expect(sug.suggestion?.evidence.length).toBeGreaterThan(0)
    useProjectStore.setState({ project: { ...s().project, units: 'metric', scale: 0.3048 } })
    expect(selectCeilingHeightSuggestion(s(), candidate).suggestion).toMatchObject({ unit: 'm' })
    expect(selectCeilingHeightSuggestion(s(), candidate).suggestion!.value).toBeCloseTo(2.8, 6)
  })
  it('uses exactly the ceiling height the caller passes and records the suggestion in provenance', () => {
    const r = approvedRoom(note)
    const candidate = r.result!.candidates[0]
    expect(s().approveCadRoom(candidate, inputsFor(r, { ceilingHeight: 12 })).success).toBe(true)
    const z = s().zones[0]
    expect(z.ceilingHeight).toBe(12)
    expect(z.cadProvenance?.ceilingHeight).toMatchObject({ chosen: 12, usedSuggestion: false })
    expect(z.cadProvenance?.ceilingHeight?.suggestedFt).toBeCloseTo(2.8 / 0.3048, 6)
    expect(z.cadProvenance?.ceilingHeight?.evidence?.length).toBeGreaterThan(0)
    expect(z.cadProvenance?.level).toBe(0)
    expect(z.cadProvenance?.approvedOpeningIds).toEqual(r.approvedOpeningIds)
    // survives the project file
    const st = s()
    const back = parseProjectDocument(serializeProject({ project: st.project, zones: st.zones, dxfEntities: st.dxfEntities, dxfBoundingBox: st.dxfBoundingBox, dxfLayers: st.dxfLayers }))
    expect(back.zones[0].cadProvenance?.ceilingHeight).toEqual(z.cadProvenance?.ceilingHeight)
  })
  it('flags when the caller accepted the suggestion, and records nothing when there is none', () => {
    const r = approvedRoom(note)
    const sug = selectCeilingHeightSuggestion(s(), r.result!.candidates[0]).suggestion!
    expect(s().approveCadRoom(r.result!.candidates[0], inputsFor(r, { ceilingHeight: sug.value })).success).toBe(true)
    expect(s().zones[0].cadProvenance?.ceilingHeight?.usedSuggestion).toBe(true)
    useProjectStore.setState({ zones: [] })
    const r2 = approvedRoom()
    expect(selectCeilingHeightSuggestion(s(), r2.result!.candidates[0]).suggestion).toBeUndefined()
    expect(s().approveCadRoom(r2.result!.candidates[0], inputsFor(r2)).success).toBe(true)
    expect(s().zones.at(-1)!.cadProvenance?.ceilingHeight).toMatchObject({ chosen: 10, usedSuggestion: false })
    expect(s().zones.at(-1)!.cadProvenance?.ceilingHeight?.suggestedFt).toBeUndefined()
  })
  it('refuses approval when the review decisions the recognition used have changed', () => {
    const r = approvedRoom()
    s().rejectCadOpening(r.approvedOpeningIds![0])
    const out = s().approveCadRoom(r.result!.candidates[0], inputsFor(r))
    expect(out.success).toBe(false)
    expect(out.error).toMatch(/recognize rooms again/i)
    expect(s().zones).toEqual([])
  })
})
