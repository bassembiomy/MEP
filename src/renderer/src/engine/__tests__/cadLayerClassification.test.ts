import { describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { applyLayerOverrides, classifyLayers, parseLayerOverrides, serializeLayerOverrides } from '../cad/layerClassification'
import { arc, block, circle, dxf, header, insert, layer, line, lwpolyline, mtext, text } from './fixtures/dxfBuilder'

const draw = (layers: string[], entities: string[], blocks: string[] = []) =>
  parseDxfText(dxf({ header: header({ insunits: 4 }), layers: layers.map(layer), blocks, entities }))
const wallLines = (name: string) => [
  line(name, 0, 0, 10000, 0), line(name, 10000, 0, 10000, 8000),
  line(name, 10000, 8000, 0, 8000), line(name, 0, 8000, 0, 0)
]
const find = (r: ReturnType<typeof classifyLayers>, name: string) => r.find((x) => x.layer === name)!

describe('layer classification', () => {
  it('name + agreeing geometry gives >= 0.8 for wall, annotation, column', () => {
    const parsed = draw(['A-WALL', 'A-ANNO-TEXT', 'S-COLS'], [
      ...wallLines('A-WALL'),
      text('A-ANNO-TEXT', 100, 100, 200, 'Room'), mtext('A-ANNO-TEXT', 500, 100, 200, 'Lobby'),
      circle('S-COLS', 2000, 2000, 150), lwpolyline('S-COLS', [[3000, 3000], [3300, 3000], [3300, 3300], [3000, 3300]], true)
    ])
    const r = classifyLayers(parsed)
    for (const [name, role] of [['A-WALL', 'wall'], ['A-ANNO-TEXT', 'annotation'], ['S-COLS', 'column']] as const) {
      expect(find(r, name).role).toBe(role)
      expect(find(r, name).confidence).toBeGreaterThanOrEqual(0.8)
      expect(find(r, name).source).toBe('suggested')
    }
  })

  it.each([
    ['WALLS', 'wall'], ['MUR', 'wall'], ['A-DOOR', 'door'], ['PORTE', 'door'],
    ['A-GLAZ', 'window'], ['WIN', 'window'], ['FENETRE', 'window'], ['WINDOW', 'window'],
    ['COLUMN', 'column'], ['S-COL', 'column'], ['A-CLNG', 'ceiling'], ['A-ANNO-DIMS', 'dimension'],
    ['S-GRID', 'grid'], ['M-HVAC', 'existing-hvac'], ['A-FURN', 'furniture'], ['A-HATCH', 'hatch']
  ])('recognises layer name %s as %s (name-only evidence, not high confidence)', (name, role) => {
    // a tiny stub on the layer keeps the geometry statistics inconclusive; the anchor sets the drawing span
    const parsed = draw([name, '0'], [line('0', 0, 0, 10000, 0), line(name, 0, 0, 10, 0)])
    const c = find(classifyLayers(parsed), name)
    expect(c.role).toBe(role)
    expect(c.confidence).toBeGreaterThan(0.5)
    expect(c.evidence.length).toBeGreaterThan(0)
  })

  it('geometry alone is a suggestion capped at 0.5; unknown names with no geometry evidence stay unknown', () => {
    const parsed = draw(['XYZ1', 'QQ'], [...wallLines('XYZ1'), line('QQ', 0, 0, 1, 1)])
    const r = classifyLayers(parsed)
    expect(find(r, 'XYZ1').role).toBe('wall')
    expect(find(r, 'XYZ1').confidence).toBeLessThanOrEqual(0.5)
    expect(find(r, 'QQ').role).toBe('unknown')
    expect(find(r, 'QQ').confidence).toBe(0)
  })

  it('name that conflicts with geometry resolves to unknown with the conflict listed', () => {
    const parsed = draw(['WALL', 'A-WALL-DOOR'], [
      text('WALL', 0, 0, 100, 'a'), text('WALL', 0, 200, 100, 'b'), text('WALL', 0, 400, 100, 'c'),
      line('WALL', 0, 0, 5000, 0), line('A-WALL-DOOR', 0, 0, 900, 0)
    ])
    const r = classifyLayers(parsed)
    expect(find(r, 'WALL').role).toBe('unknown')
    expect(find(r, 'WALL').conflicts.join(' ')).toMatch(/wall.*annotation/)
    expect(find(r, 'A-WALL-DOOR').role).toBe('unknown')
    expect(find(r, 'A-WALL-DOOR').conflicts.length).toBe(1)
  })

  it('block names on a layer back the role (door blocks on a generic layer)', () => {
    const parsed = draw(['0', 'A-DOOR'], [insert('A-DOOR', 'DOOR90', 1000, 1000), wallLines('0')[0]],
      [block('DOOR90', line('0', 0, 0, 900, 0) + '\n' + arc('0', 0, 0, 900, 0, 90))])
    const c = find(classifyLayers(parsed), 'A-DOOR')
    expect(c.role).toBe('door')
    expect(c.confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('user override always wins and is retained alongside the suggestion', () => {
    const parsed = draw(['A-WALL'], wallLines('A-WALL'))
    const merged = applyLayerOverrides(classifyLayers(parsed), { 'A-WALL': 'furniture', 'NEW': 'grid' })
    const w = find(merged, 'A-WALL')
    expect(w).toMatchObject({ role: 'furniture', confidence: 1, source: 'user' })
    expect(w.overriddenSuggestion?.role).toBe('wall')
    expect(find(merged, 'NEW')).toMatchObject({ role: 'grid', source: 'user' })
  })

  it('overrides survive a JSON round trip and invalid roles are dropped', () => {
    const o = { B: 'door', A: 'wall' } as const
    expect(parseLayerOverrides(serializeLayerOverrides({ ...o }))).toEqual(o)
    expect(parseLayerOverrides('{"X":"bogus","Y":"column"}')).toEqual({ Y: 'column' })
  })
})
