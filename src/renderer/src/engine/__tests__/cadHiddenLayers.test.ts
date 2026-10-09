import { beforeEach, describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { selectPersistedProject, useProjectStore } from '../../store/projectStore'
import { parseProjectDocument, serializeProject } from '../project/projectSerialization'
import { dxf, header, layer, lwpolyline } from './fixtures/dxfBuilder'

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
