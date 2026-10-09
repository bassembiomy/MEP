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
    useProjectStore.setState({ project: { ...s().project, units: 'metric', scale: 3.2808 } }) // a feet drawing is 3.2808 units per metre
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
  it('records usedSuggestion for the 3-decimal value the panel pre-fills (2.8 m is 9.186352 ft, shown as 9.186)', () => {
    const r = approvedRoom(note)
    const candidate = r.result!.candidates[0]
    const sug = selectCeilingHeightSuggestion(s(), candidate).suggestion!
    const shown = Number(sug.value.toFixed(3))
    expect(shown).toBe(9.186)
    expect(shown).not.toBe(sug.value)
    expect(s().approveCadRoom(candidate, inputsFor(r, { ceilingHeight: shown })).success).toBe(true)
    expect(s().zones[0].cadProvenance?.ceilingHeight).toMatchObject({ chosen: 9.186, usedSuggestion: true })
  })
  it('does not flag a value that differs from the suggestion by more than display rounding', () => {
    const r = approvedRoom(note)
    const candidate = r.result!.candidates[0]
    expect(s().approveCadRoom(candidate, inputsFor(r, { ceilingHeight: 9.187 })).success).toBe(true)
    expect(s().zones[0].cadProvenance?.ceilingHeight?.usedSuggestion).toBe(false)
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

describe('ceiling height unit system comes from the confirmed drawing unit, never from the display preference (R9)', () => {
  const ch = (txt: string, w: number, h: number) => ({
    type: 'TEXT' as const, x: w / 2, y: -h / 2, text: txt, textHeight: 1, layer: 'A-ANNO'
  })
  const suggest = (project: Record<string, unknown>, w: number, h: number, txt: string) => {
    useProjectStore.setState({
      project: { name: 'P', location: 'L', outdoorDb: 95, indoorDb: 75, ...project } as ReturnType<typeof s>['project'],
      dxfEntities: [ch(txt, w, h)], cadLevel: 0
    })
    return selectCeilingHeightSuggestion(s(), { polygon: [0, 0, w, 0, w, -h, 0, -h] })
  }
  it("'CH 9.5' in an inch drawing with metric display is 9.5 ft", () => {
    const r = suggest({ units: 'metric', scale: 12 / 0.3048, cadUnit: 'in', cadUnitsConfirmed: true }, 240, 180, 'CH 9.5')
    expect(r.suggestion?.valueFt).toBeCloseTo(9.5, 9)
    expect(r.suggestion?.unit).toBe('m')
    expect(r.suggestion?.value).toBeCloseTo(9.5 * 0.3048, 9)
  })
  it("'CH 2.70' in an mm drawing with imperial display is 2.70 m", () => {
    const r = suggest({ units: 'imperial', scale: 304.8, cadUnit: 'mm', cadUnitsConfirmed: true }, 6000, 4000, 'CH 2.70')
    expect(r.suggestion?.valueFt).toBeCloseTo(2.7 / 0.3048, 9)
    expect(r.suggestion?.unit).toBe('ft')
  })
  it('uses the confirmed unit even when the scale was edited to a value that does not look metric', () => {
    const r = suggest({ units: 'imperial', scale: 100, cadUnit: 'mm', cadUnitsConfirmed: true }, 6000, 4000, 'CH 2.70')
    expect(r.suggestion?.valueFt).toBeCloseTo(2.7 / 0.3048, 9)
  })
  it('unconfirmed units give no suggestion and an unresolved reason', () => {
    for (const confirmed of [false, undefined]) {
      const r = suggest({ units: 'metric', scale: 304.8 * 0.3048, cadUnit: 'mm', cadUnitsConfirmed: confirmed }, 6000, 4000, 'CH 2.70')
      expect(r.suggestion).toBeUndefined()
      expect(r.unresolved).toBe(true)
    }
  })
  it('a custom (calibrated) unit is not guessed from the unit name', () => {
    const r = suggest({ units: 'imperial', scale: 50, cadUnit: 'custom', cadUnitsConfirmed: true }, 6000, 4000, 'CH 2.70')
    expect(r.suggestion).toBeUndefined()
  })
})
