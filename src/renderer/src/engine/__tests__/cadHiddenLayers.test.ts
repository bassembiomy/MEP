import { beforeEach, describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { selectCeilingHeightSuggestion, selectPersistedProject, useProjectStore } from '../../store/projectStore'
import { parseProjectDocument, serializeProject } from '../project/projectSerialization'
import { dxf, header, layer, lwpolyline, text } from './fixtures/dxfBuilder'

const square = (name: string, cx: number) => lwpolyline(name, [[cx - 200, -200], [cx + 200, -200], [cx + 200, 200], [cx - 200, 200]], true)
const source = (opts: { frozen?: boolean; off?: boolean }) => parseDxfText(dxf({
  header: header({ insunits: 4 }),
  layers: [layer('0'), layer('S-COLS', opts), layer('A-WALL')],
  blocks: [], entities: [square('S-COLS', 0), square('S-COLS', 3000), square('A-WALL', 9000)]
}))
const s = () => useProjectStore.getState()
const load = (parsed: ReturnType<typeof source>) => {
  s().clearDxfData()
  s().setDxfData(parsed.entities, parsed.bbox, parsed.suggestedScaleImperial, parsed.cadUnit,
    { unitsConfidence: parsed.unitsConfidence ?? 'unknown', diagnostics: parsed.diagnostics ?? [] }, parsed.blockReferences, parsed.hiddenLayers)
  // The user confirms S-COLS as the column layer (the tiny synthetic plan gives the classifier too little geometry).
  expect(s().setCadLayerRole('S-COLS', 'column').success).toBe(true)
}

describe('frozen / off layers', () => {
  it('parses layer flags: frozen (70 bit 1) and off (negative colour) are reported, normal layers are not', () => {
    expect(source({ frozen: true }).hiddenLayers).toEqual(['S-COLS'])
    expect(source({ off: true }).hiddenLayers).toEqual(['S-COLS'])
    expect(source({}).hiddenLayers).toBeUndefined()
  })
  it('keeps the entities (imported) with the source-hidden layer invisible by default', () => {
    const parsed = source({ frozen: true })
    expect(parsed.entities.filter(e => e.layer === 'S-COLS')).toHaveLength(2)
  })
  describe('store', () => {
    beforeEach(() => { s().clearDxfData() })
    it('starts hidden, keeps its columns out of obstacle recognition, and brings them back when the user shows the layer', () => {
      load(source({ frozen: true }))
      expect(s().dxfLayers['S-COLS']).toMatchObject({ visible: false, sourceHidden: true })
      expect(s().dxfLayers['A-WALL'].visible).toBe(true)
      expect(s().cadObstacles.filter(o => o.layer === 'S-COLS')).toHaveLength(0)
      s().setDxfLayerVisibility('S-COLS', true)
      expect(s().cadObstacles.filter(o => o.layer === 'S-COLS')).toHaveLength(2)
      s().setDxfLayerVisibility('S-COLS', false)
      expect(s().cadObstacles.filter(o => o.layer === 'S-COLS')).toHaveLength(0)
    })
    it('a normal layer hidden by the user still takes part in recognition (visibility is not a recognition switch)', () => {
      load(source({}))
      const before = s().cadObstacles.filter(o => o.layer === 'S-COLS').length
      expect(before).toBe(2)
      s().setDxfLayerVisibility('S-COLS', false)
      expect(s().cadObstacles.filter(o => o.layer === 'S-COLS')).toHaveLength(before)
    })
    it('sourceHidden survives saving and reopening the project document, and recognition stays consistent', () => {
      load(source({ frozen: true }))
      const reopened = parseProjectDocument(serializeProject(selectPersistedProject(s())))
      expect(reopened.dxfLayers['S-COLS']).toMatchObject({ visible: false, sourceHidden: true })
      expect(reopened.dxfLayers['A-WALL'].sourceHidden).toBeUndefined()
    })
    it('toggleAllDxfLayers re-runs recognition for source-hidden layers', () => {
      load(source({ off: true }))
      expect(s().cadObstacles.filter(o => o.layer === 'S-COLS')).toHaveLength(0)
      s().toggleAllDxfLayers(true)
      expect(s().cadObstacles.filter(o => o.layer === 'S-COLS')).toHaveLength(2)
    })
  })
})

describe('room approval notices layer visibility changes', () => {
  const rect = (name: string, x0: number, w: number) => lwpolyline(name, [[x0, 0], [x0 + w, 0], [x0 + w, 4000], [x0, 4000]], true)
  const parsed = () => parseDxfText(dxf({
    header: header({ insunits: 4 }), layers: [layer('0'), layer('A-ROOM'), layer('A-FROZEN', { frozen: true })],
    blocks: [], entities: [rect('A-ROOM', 0, 5000), rect('A-FROZEN', 9000, 5000)]
  }))
  beforeEach(() => {
    s().clearDxfData()
    const p = parsed()
    s().setDxfData(p.entities, p.bbox, p.suggestedScaleImperial, p.cadUnit,
      { unitsConfidence: 'declared', diagnostics: [] }, p.blockReferences, p.hiddenLayers)
    useProjectStore.setState({ zones: [], undoStack: [], redoStack: [] })
  })
  const inputs = (r: ReturnType<typeof s>['recognizeCadRoomCandidates'] extends () => infer R ? R : never) => ({
    name: 'Office', spaceTypeId: 'office', ceilingHeight: 10, occupants: 2,
    sourceCadRevision: r.sourceCadRevision!, drawingUnitsPerFoot: r.drawingUnitsPerFoot!, recognitionContext: r.recognitionContext!
  })
  it('recognition ignores the frozen layer, and showing it makes the earlier candidate stale', () => {
    const r = s().recognizeCadRoomCandidates()
    expect(r.result!.candidates).toHaveLength(1)
    s().setDxfLayerVisibility('A-FROZEN', true)
    const out = s().approveCadRoom(r.result!.candidates[0], inputs(r))
    expect(out.success).toBe(false)
    expect(out.error).toMatch(/recognize rooms again/)
    expect(s().zones).toHaveLength(0)
  })
  it('hiding it again returns to the original basis, and a fresh recognition after showing is approvable', () => {
    const r = s().recognizeCadRoomCandidates()
    s().setDxfLayerVisibility('A-FROZEN', true)
    s().setDxfLayerVisibility('A-FROZEN', false)
    expect(s().approveCadRoom(r.result!.candidates[0], inputs(r)).success).toBe(true)
    s().setDxfLayerVisibility('A-FROZEN', true)
    const again = s().recognizeCadRoomCandidates()
    expect(again.result!.candidates.length).toBe(2)
    expect(again.recognitionContext).not.toBe(r.recognitionContext)
  })
})

describe('ceiling height suggestions ignore hidden-layer annotations', () => {
  it('a CH note on a frozen layer is not used until the layer is shown', () => {
    s().clearDxfData()
    const p = parseDxfText(dxf({
      header: header({ insunits: 4 }), layers: [layer('0'), layer('A-ROOM'), layer('A-NOTE', { frozen: true })], blocks: [],
      entities: [lwpolyline('A-ROOM', [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], true), text('A-NOTE', 2500, 2000, 200, 'CH=2.8m')]
    }))
    s().setDxfData(p.entities, p.bbox, p.suggestedScaleImperial, p.cadUnit,
      { unitsConfidence: 'declared', diagnostics: [] }, p.blockReferences, p.hiddenLayers)
    const cand = s().recognizeCadRoomCandidates().result!.candidates[0]
    expect(cand).toBeTruthy()
    expect(selectCeilingHeightSuggestion(s(), cand).suggestion).toBeUndefined()
    s().setDxfLayerVisibility('A-NOTE', true)
    expect(selectCeilingHeightSuggestion(s(), cand).suggestion?.valueFt).toBeCloseTo(2.8 / 0.3048, 3)
  })
})
