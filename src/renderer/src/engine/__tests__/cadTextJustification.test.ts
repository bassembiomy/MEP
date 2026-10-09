import { describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { parseDwgDatabase } from '../cad/dwgGeometry'
import { recognizeCadRooms } from '../cad/roomRecognition'
import { exportProjectDxf } from '../export/exportDxf'
import { parseProjectDocument, serializeProject } from '../project/projectSerialization'
import { validateCadEntity } from '../cad/nativeGeometry'
import {
  canvasTextStyle, dxfTextCodes, dxfTextJustification, mtextAttachment, mtextAttachmentCode, resolvedJustification
} from '../cad/textJustification'
import type { DxfEntity, ProjectMetadata } from '../../store/projectStore'
import { block, dxf, header, insert, layer, lwpolyline, rawRecord } from './fixtures/dxfBuilder'

type Pair = [number, string | number]
const L = 'A-TEXT'
const parse = (entities: string[], blocks: string[] = []) =>
  parseDxfText(dxf({ header: header({ insunits: 2 }), layers: [L, 'A-AREA', '0'].map((n) => layer(n)), blocks, entities }))
const textRec = (h: number | undefined, v: number | undefined, p10: [number, number], p11?: [number, number], extra: Pair[] = [], type = 'TEXT', vCode = 73): string =>
  rawRecord([0, type], [8, L], [10, p10[0]], [20, p10[1]], [40, 2], [1, 'LABEL'], ...(h === undefined ? [] : [[72, h] as Pair]),
    ...(v === undefined ? [] : [[vCode, v] as Pair]), ...(p11 ? [[11, p11[0]], [21, p11[1]]] as Pair[] : []), ...extra)
const only = (entities: string[], blocks: string[] = []) => {
  const parsed = parse(entities, blocks)
  expect(parsed.entities).toHaveLength(1)
  return { ent: parsed.entities[0], parsed }
}
const codes = (p: { diagnostics?: { code: string }[] }) => (p.diagnostics ?? []).map((d) => d.code)

describe('F1 DXF TEXT justification matrix (T1)', () => {
  const H = ['left', 'center', 'right'] as const
  const V = ['baseline', 'bottom', 'middle', 'top'] as const
  for (let h = 0; h <= 2; h++) for (let v = 0; v <= 3; v++) {
    it(`72=${h} 73=${v} with 10 != 11 anchors at ${h === 0 && v === 0 ? '10' : '11'}`, () => {
      const { ent } = only([textRec(h, v, [100, 50], [30, 20])])
      const justified = h !== 0 || v !== 0
      expect(ent.x).toBe(justified ? 30 : 100)
      expect(ent.y).toBe(justified ? -20 : -50)
      expect(ent.textHAlign).toBe(H[h] === 'left' ? undefined : H[h])
      expect(ent.textVAlign).toBe(V[v] === 'baseline' ? undefined : V[v])
    })
  }
  it('72=4 (Middle) is centre/middle about point 11', () => {
    const { ent } = only([textRec(4, 0, [100, 50], [30, 20])])
    expect([ent.x, ent.y, ent.textHAlign, ent.textVAlign]).toEqual([30, -20, 'center', 'middle'])
  })
  it.each([3, 5])('72=%i (aligned/fit) anchors at the midpoint of 10 and 11 and keeps group 50', (h) => {
    const { ent } = only([textRec(h, 0, [10, 10], [30, 20], [[50, 17]])])
    expect([ent.x, ent.y, ent.textHAlign, ent.textVAlign, ent.rotationDeg]).toEqual([20, -15, 'center', undefined, 17])
  })
  it('72=0 73=0 with a junk group 11 keeps the group 10 anchor', () => {
    const { ent } = only([textRec(0, 0, [100, 50], [30, 20])])
    expect([ent.x, ent.y]).toEqual([100, -50])
    expect(ent).not.toHaveProperty('textHAlign')
    expect(ent).not.toHaveProperty('textVAlign')
  })
  it('a justified TEXT without group 11 falls back to 10 left/baseline with TEXT_ALIGNMENT_POINT_MISSING', () => {
    const { ent, parsed } = only([textRec(1, 2, [100, 50])])
    expect([ent.x, ent.y]).toEqual([100, -50])
    expect(ent).not.toHaveProperty('textHAlign')
    expect(ent).not.toHaveProperty('textVAlign')
    expect(codes(parsed)).toContain('TEXT_ALIGNMENT_POINT_MISSING')
  })
  it('non-finite group 11 is treated as missing', () => {
    const { ent, parsed } = only([rawRecord([0, 'TEXT'], [8, L], [10, 5], [20, 6], [40, 2], [1, 'X'], [72, 1], [11, 'abc'], [21, 1])])
    expect([ent.x, ent.y]).toEqual([5, -6])
    expect(codes(parsed)).toContain('TEXT_ALIGNMENT_POINT_MISSING')
  })
  it('an out-of-range justification is reported and left/baseline at group 10 is used', () => {
    const { ent, parsed } = only([textRec(9, 0, [5, 6], [1, 2])])
    expect([ent.x, ent.y]).toEqual([5, -6])
    expect(ent).not.toHaveProperty('textHAlign')
    expect(codes(parsed)).toContain('TEXT_JUSTIFICATION_UNSUPPORTED')
  })
  it('a valid default TEXT produces neither diagnostics nor justification fields', () => {
    const { ent, parsed } = only([textRec(undefined, undefined, [5, 6])])
    expect(codes(parsed)).not.toContain('TEXT_ALIGNMENT_POINT_MISSING')
    expect(codes(parsed)).not.toContain('TEXT_JUSTIFICATION_UNSUPPORTED')
    expect(ent).not.toHaveProperty('textHAlign')
  })
})

describe('F1 ATTRIB / ATTDEF use group 74 for the vertical justification', () => {
  const attrib = (pairs: Pair[]) => rawRecord([0, 'ATTRIB'], [8, L], [10, 100], [20, 50], [40, 2], [1, 'V'], [2, 'TAG'], [70, 0], ...pairs)
  it('group 73 on an ATTRIB is the field length and is ignored', () => {
    const { ent } = only([attrib([[73, 5], [11, 30], [21, 20]])])
    expect([ent.x, ent.y]).toEqual([100, -50])
    expect(ent).not.toHaveProperty('textVAlign')
  })
  it('74=2 is vertically middle about point 11', () => {
    const { ent } = only([attrib([[73, 5], [74, 2], [11, 30], [21, 20]])])
    expect([ent.x, ent.y, ent.textHAlign, ent.textVAlign]).toEqual([30, -20, undefined, 'middle'])
  })
  it('72=1 on an ATTRIB centres it about 11', () => {
    const { ent } = only([attrib([[72, 1], [11, 30], [21, 20]])])
    expect([ent.x, ent.y, ent.textHAlign]).toEqual([30, -20, 'center'])
  })
  it('a constant ATTDEF honours 74 as well', () => {
    const { ent } = only([rawRecord([0, 'ATTDEF'], [8, L], [10, 100], [20, 50], [40, 2], [1, 'V'], [2, 'TAG'], [70, 2], [74, 3], [11, 30], [21, 20])])
    expect([ent.x, ent.y, ent.textVAlign]).toEqual([30, -20, 'top'])
  })
})

describe('F1 anchor goes through the same matrix as group 10 did (T3)', () => {
  const body = (p11: [number, number] = [3, 2]) => block('LBL', textRec(1, 0, [1, 1], p11))
  it('centred TEXT inside a rotated, scaled, translated INSERT is at M * p11', () => {
    // rotation 90 deg, scale 2, insert (100, 50): DXF world point = (100, 50) + 2 * R90 * (3, 2) = (96, 56)
    const { ent } = only([insert(L, 'LBL', 100, 50, { rotation: 90, sx: 2, sy: 2 })], [body()])
    expect(ent.x).toBeCloseTo(96, 9)
    expect(ent.y).toBeCloseTo(-56, 9)
    expect(ent.textHAlign).toBe('center')
  })
  it('a mirrored INSERT maps the anchor too and does not swap left/right', () => {
    const { ent } = only([insert(L, 'LBL', 100, 50, { sx: -1 })], [block('LBL', textRec(2, 0, [1, 1], [3, 2]))])
    expect(ent.x).toBeCloseTo(97, 9)
    expect(ent.y).toBeCloseTo(-52, 9)
    expect(ent.textHAlign).toBe('right')
  })
})

describe('F1 MTEXT attachment (group 71)', () => {
  const mt = (pairs: Pair[]) => rawRecord([0, 'MTEXT'], [8, L], [10, 100], [20, 50], [40, 2], [1, 'M'], ...pairs)
  it('71=5 is centre/middle about group 10', () => {
    const { ent } = only([mt([[71, 5]])])
    expect([ent.x, ent.y, ent.textHAlign, ent.textVAlign]).toEqual([100, -50, 'center', 'middle'])
  })
  it('absent 71 is top-left with no stored fields; 11/21 (direction), 72 and 73 are not justification', () => {
    const { ent } = only([mt([[72, 5], [73, 2], [11, 0], [21, 1]])])
    expect([ent.x, ent.y]).toEqual([100, -50])
    expect(ent).not.toHaveProperty('textHAlign')
    expect(ent).not.toHaveProperty('textVAlign')
    expect(ent.rotationDeg).toBeCloseTo(90, 9)
  })
  it.each([[1, undefined, undefined], [3, 'right', undefined], [7, undefined, 'bottom'], [9, 'right', 'bottom']] as const)('71=%i', (code, h, v) => {
    const { ent } = only([mt([[71, code]])])
    expect(ent.textHAlign).toBe(h)
    expect(ent.textVAlign).toBe(v)
  })
  it('an out-of-range 71 is reported and top-left is used', () => {
    const { ent, parsed } = only([mt([[71, 12]])])
    expect(ent).not.toHaveProperty('textHAlign')
    expect(codes(parsed)).toContain('TEXT_JUSTIFICATION_UNSUPPORTED')
  })
})

describe('F1 DWG text justification', () => {
  const pt = (x: number, y: number) => ({ x, y, z: 0 })
  const db = (entities: unknown[]) => ({ entities, tables: { BLOCK_RECORD: { entries: [] } }, header: { INSUNITS: 2 } })
  const text = (extra: Record<string, unknown>) => ({ type: 'TEXT', handle: 'T', layer: L, text: 'LBL', textHeight: 2, rotation: 0, startPoint: pt(100, 50), ...extra })
  it('halign 2 anchors at endPoint (right/baseline)', async () => {
    const r = await parseDwgDatabase(db([text({ halign: 2, valign: 0, endPoint: pt(30, 20) })]))
    expect(r.entities[0]).toMatchObject({ x: 30, y: -20, textHAlign: 'right' })
    expect(r.entities[0]).not.toHaveProperty('textVAlign')
  })
  it('halign 0 valign 0 with endPoint {0,0} uses startPoint', async () => {
    const r = await parseDwgDatabase(db([text({ halign: 0, valign: 0, endPoint: { x: 0, y: 0 } })]))
    expect(r.entities[0]).toMatchObject({ x: 100, y: -50 })
    expect(r.entities[0]).not.toHaveProperty('textHAlign')
  })
  it('halign 0 valign 2 uses endPoint (left/middle)', async () => {
    const r = await parseDwgDatabase(db([text({ halign: 0, valign: 2, endPoint: pt(30, 20) })]))
    expect(r.entities[0]).toMatchObject({ x: 30, y: -20, textVAlign: 'middle' })
  })
  it('halign 3 (aligned) anchors at the midpoint', async () => {
    const r = await parseDwgDatabase(db([text({ halign: 3, valign: 0, endPoint: pt(30, 20) })]))
    expect(r.entities[0]).toMatchObject({ x: 65, y: -35, textHAlign: 'center' })
  })
  it('a justified TEXT without a finite endPoint falls back to startPoint and warns', async () => {
    const r = await parseDwgDatabase(db([text({ halign: 1, valign: 0 })]))
    expect(r.entities[0]).toMatchObject({ x: 100, y: -50 })
    expect(r.entities[0]).not.toHaveProperty('textHAlign')
    expect(r.diagnostics.map((d) => d.code)).toContain('text-alignment-point-missing')
  })
  it('a justified TEXT whose endPoint is exactly {0,0} (alignment point not stored) is not thrown to the origin', async () => {
    const r = await parseDwgDatabase(db([text({ halign: 1, valign: 0, endPoint: { x: 0, y: 0 } })]))
    expect(r.entities[0]).toMatchObject({ x: 100, y: -50 })
    expect(r.entities[0]).not.toHaveProperty('textHAlign')
    expect(r.diagnostics.map((d) => d.code)).toContain('text-alignment-point-missing')
  })
  it('MTEXT attachmentPoint 9 is right/bottom about insertionPoint', async () => {
    const r = await parseDwgDatabase(db([{ type: 'MTEXT', handle: 'M', layer: L, text: 'M', textHeight: 2, insertionPoint: pt(100, 50), attachmentPoint: 9 }]))
    expect(r.entities[0]).toMatchObject({ x: 100, y: -50, textHAlign: 'right', textVAlign: 'bottom' })
  })
  it('MTEXT without an attachmentPoint is top-left', async () => {
    const r = await parseDwgDatabase(db([{ type: 'MTEXT', handle: 'M', layer: L, text: 'M', textHeight: 2, insertionPoint: pt(100, 50) }]))
    expect(r.entities[0]).not.toHaveProperty('textHAlign')
    expect(r.entities[0]).not.toHaveProperty('textVAlign')
  })
  it('INSERT attribs pass halign/valign/endPoint through', async () => {
    const attribute = { type: 'ATTRIB', handle: 'A', layer: L, isVisible: true, flags: 0, text: { text: 'V', textHeight: 2, rotation: 0, startPoint: pt(100, 50), endPoint: pt(30, 20), halign: 1, valign: 0 } }
    const blk = { name: 'B', entities: [] }
    const r = await parseDwgDatabase({ entities: [{ type: 'INSERT', name: 'B', insertionPoint: pt(0, 0), xScale: 1, yScale: 1, rotation: 0, attribs: [attribute] }],
      tables: { BLOCK_RECORD: { entries: [blk] } }, header: { INSUNITS: 2 } })
    expect(r.entities.find((e) => e.type === 'TEXT')).toMatchObject({ x: 30, y: -20, textHAlign: 'center' })
  })
})

describe('F1 recognition uses the justified anchor', () => {
  it('a room label whose point 10 is outside the room but point 11 inside is recognised', () => {
    const parsed = parse([
      lwpolyline('A-AREA', [[0, 0], [20, 0], [20, 15], [0, 15]], true),
      textRec(1, 0, [60, 7], [10, 7])
    ])
    const out = recognizeCadRooms(parsed.entities, { drawingUnitsPerFoot: 1, layers: ['A-AREA'] })
    expect(out.candidates.map((c) => c.name)).toEqual(['LABEL'])
  })
})

describe('F1 export -> parse round trip', () => {
  const project: ProjectMetadata = { name: 'P', location: 'L', units: 'imperial', scale: 12, cadUnit: 'ft', cadUnitsConfirmed: true, outdoorDb: 95, indoorDb: 75 }
  const t = (extra: Partial<DxfEntity>): DxfEntity => ({ type: 'TEXT', x: 30, y: -20, text: 'LABEL', textHeight: 2, rotationDeg: 0, layer: L, ...extra })
  const roundTrip = (e: DxfEntity) => {
    const out = parseDxfText(exportProjectDxf({ project, zones: [], dxfEntities: [e] }).text)
    return out.entities.find((x) => x.layer === L)!
  }
  it.each([
    [{}, undefined, undefined],
    [{ textHAlign: 'center' }, 'center', undefined],
    [{ textHAlign: 'right', textVAlign: 'top' }, 'right', 'top'],
    [{ textVAlign: 'middle' }, undefined, 'middle'],
    [{ textHAlign: 'center', textVAlign: 'middle' }, 'center', 'middle'],
    [{ textVAlign: 'bottom', textHAlign: 'left' }, undefined, 'bottom']
  ] as const)('TEXT %j', (fields, h, v) => {
    const back = roundTrip(t(fields as Partial<DxfEntity>))
    expect([back.x, back.y, back.textHAlign, back.textVAlign]).toEqual([30, -20, h, v])
  })
  it.each([[{}, undefined, undefined], [{ textHAlign: 'center', textVAlign: 'middle' }, 'center', 'middle'], [{ textHAlign: 'right', textVAlign: 'bottom' }, 'right', 'bottom'], [{ textHAlign: 'center' }, 'center', undefined]] as const)('MTEXT %j', (fields, h, v) => {
    const back = roundTrip(t({ type: 'MTEXT', ...(fields as Partial<DxfEntity>) }))
    expect([back.type, back.x, back.y, back.textHAlign, back.textVAlign]).toEqual(['MTEXT', 30, -20, h, v])
  })
})

describe('F1 pure functions', () => {
  it('dxfTextJustification', () => {
    expect(dxfTextJustification(0, 0)).toEqual({ hAlign: 'left', vAlign: 'baseline', anchor: 'p10', invalid: false })
    expect(dxfTextJustification(2, 3)).toEqual({ hAlign: 'right', vAlign: 'top', anchor: 'p11', invalid: false })
    expect(dxfTextJustification(5, 0).anchor).toBe('mid')
    expect(dxfTextJustification(6, 0).invalid).toBe(true)
    expect(dxfTextJustification(0, 1.5).invalid).toBe(true)
    expect(dxfTextJustification(NaN, 0).invalid).toBe(true)
  })
  it('mtextAttachment and its inverse cover 1..9', () => {
    for (let code = 1; code <= 9; code++) {
      const a = mtextAttachment(code)!
      expect(mtextAttachmentCode(a.hAlign, a.vAlign)).toBe(code)
    }
    expect(mtextAttachment(0)).toBeNull()
    expect(mtextAttachment(10)).toBeNull()
    expect(mtextAttachment(5)).toEqual({ hAlign: 'center', vAlign: 'middle' })
    expect(mtextAttachmentCode('left', 'baseline')).toBe(7)
  })
  it('dxfTextCodes', () => {
    expect(dxfTextCodes('left', 'baseline')).toEqual({ 72: 0, 73: 0 })
    expect(dxfTextCodes('center', 'middle')).toEqual({ 72: 1, 73: 2 })
    expect(dxfTextCodes('right', 'top')).toEqual({ 72: 2, 73: 3 })
  })
  it('resolvedJustification applies the per-type defaults', () => {
    expect(resolvedJustification({ type: 'TEXT' })).toEqual({ hAlign: 'left', vAlign: 'baseline' })
    expect(resolvedJustification({ type: 'MTEXT' })).toEqual({ hAlign: 'left', vAlign: 'top' })
    expect(resolvedJustification({ type: 'MTEXT', textVAlign: 'middle' })).toEqual({ hAlign: 'left', vAlign: 'middle' })
  })
  it('canvasTextStyle table', () => {
    expect(canvasTextStyle({ type: 'TEXT' })).toEqual({ textAlign: 'left', textBaseline: 'alphabetic' })
    expect(canvasTextStyle({ type: 'MTEXT' })).toEqual({ textAlign: 'left', textBaseline: 'top' })
    expect(canvasTextStyle({ type: 'TEXT', textHAlign: 'center', textVAlign: 'middle' })).toEqual({ textAlign: 'center', textBaseline: 'middle' })
    expect(canvasTextStyle({ type: 'TEXT', textHAlign: 'right', textVAlign: 'bottom' })).toEqual({ textAlign: 'right', textBaseline: 'bottom' })
    expect(canvasTextStyle({ type: 'TEXT', textVAlign: 'top' })).toEqual({ textAlign: 'left', textBaseline: 'top' })
  })
})

describe('F1 serialization', () => {
  const project: ProjectMetadata = { name: 'P', location: 'L', units: 'imperial', scale: 12, cadUnit: 'ft', cadUnitsConfirmed: true, outdoorDb: 95, indoorDb: 75 }
  const base = (e: DxfEntity) => ({ project, zones: [], dxfEntities: [e], dxfBoundingBox: null, dxfLayers: {} })
  const legacy: DxfEntity = { type: 'TEXT', x: 1, y: 2, text: 'A', textHeight: 1, layer: L }
  it('accepts legacy entities and valid justification, round-tripping both', () => {
    expect(parseProjectDocument(serializeProject(base(legacy))).dxfEntities[0]).toEqual(legacy)
    const just = { ...legacy, textHAlign: 'center', textVAlign: 'middle' } as DxfEntity
    expect(parseProjectDocument(serializeProject(base(just))).dxfEntities[0]).toEqual(just)
  })
  it('rejects unknown enum values on TEXT and MTEXT', () => {
    for (const type of ['TEXT', 'MTEXT'] as const) {
      expect(validateCadEntity({ ...legacy, type, textHAlign: 'justify' as never })).toMatch(/textHAlign/)
      expect(validateCadEntity({ ...legacy, type, textVAlign: 'centre' as never })).toMatch(/textVAlign/)
      const doc = JSON.parse(serializeProject(base({ ...legacy, type })))
      doc.dxfEntities[0].textHAlign = 'justify'
      expect(() => parseProjectDocument(JSON.stringify(doc))).toThrow(/textHAlign/)
    }
  })
})
