import { readFileSync, readdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { beforeEach, describe, expect, it } from 'vitest'
import { decodeDxfBytes, parseDxfText, type ParsedDxf } from '../dxfParser'
import { selectPersistedProject, useProjectStore, type BoundingBox, type DxfEntity, type Zone } from '../../store/projectStore'
import { exportProjectDxf } from '../export/exportDxf'
import { parseProjectDocument, serializeProject } from '../project/projectSerialization'
import type { CadRoomCandidate } from '../cad/semanticTypes'
import { isPointInPolygon } from '../geometry'
import { canonicalRing } from '../cad/roomRecognition'
import {
  ORIGIN_THRESHOLD, pickDrawingOrigin, resolveImportOrigin, translateDrawing, translateEntity, translateZone
} from '../cad/drawingOrigin'

/**
 * Far-from-origin drawings (survey / UTM / state-plane coordinates). Parsers return RAW coordinates; the store holds
 * LOCAL coordinates (raw = local + drawingOrigin, origin in the internal Y-down frame). The shift used here is applied
 * to the parsed data by an implementation private to this file, not by the module under test.
 */
const corpus = new URL('./fixtures/corpus/', import.meta.url)
const FILES = readdirSync(corpus).filter((n) => n.endsWith('.dxf') || n.endsWith('.dxf.gz'))
const METRIC = 'arch-metric-mm-r2018.dxf'
const DX = 612_345_000, DY = 3_312_345_000 // DXF X, Y offsets; internal y shifts by -DY
const load = (name: string): ParsedDxf => {
  const bytes = readFileSync(new URL(name, corpus))
  return parseDxfText(decodeDxfBytes(new Uint8Array(name.endsWith('.gz') ? gunzipSync(bytes) : bytes)))
}
/** Independent raw shift in the internal frame (dy is the internal-y delta). */
function shifted(p: ParsedDxf, dx: number, dy: number): ParsedDxf {
  const entities = p.entities.map((e) => {
    const c: DxfEntity = { ...e }
    if (c.x !== undefined) c.x = e.x! + dx
    if (c.y !== undefined) c.y = e.y! + dy
    if (e.points) c.points = e.points.map((v, i) => v + (i % 2 ? dy : dx))
    return c
  })
  const b = p.bbox
  return { ...p, entities, bbox: { minX: b.minX + dx, maxX: b.maxX + dx, minY: b.minY + dy, maxY: b.maxY + dy },
    blockReferences: (p.blockReferences ?? []).map((r) => ({ ...r, insertion: { x: r.insertion.x + dx, y: r.insertion.y + dy },
      bounds: { minX: r.bounds.minX + dx, maxX: r.bounds.maxX + dx, minY: r.bounds.minY + dy, maxY: r.bounds.maxY + dy } })) }
}
const s = () => useProjectStore.getState()
const reset = () => {
  s().clearDxfData()
  useProjectStore.setState({ project: { name: 'P', location: 'L', units: 'imperial', scale: 1, outdoorDb: 95, indoorDb: 75 }, zones: [], undoStack: [], redoStack: [],
    drawingOrigin: { x: 0, y: 0 }, deploymentEvidence: {}, deploymentInputs: {}, tempPoints: [] })
}
const importDrawing = (p: ParsedDxf, name = 't.dxf') => {
  s().setDxfData(p.entities, p.bbox, p.suggestedScaleImperial, p.cadUnit,
    { sourceName: name, unitsConfidence: p.unitsConfidence ?? 'unknown', diagnostics: p.diagnostics ?? [] }, p.blockReferences, p.hiddenLayers)
  if (s().project.cadUnitsConfirmed !== true) useProjectStore.setState({ project: { ...s().project, cadUnitsConfirmed: true } })
}
const approveFirstRoom = (pick: (cs: CadRoomCandidate[]) => CadRoomCandidate = (cs) => cs[0]) => {
  s().setCadLayerRole('A-AREA', 'wall')
  const run = s().recognizeCadRoomCandidates()
  expect(run.success).toBe(true)
  const out = s().approveCadRoom(pick(run.result!.candidates), { name: 'R', spaceTypeId: 'office', ceilingHeight: 9, occupants: 2,
    sourceCadRevision: run.sourceCadRevision!, drawingUnitsPerFoot: run.drawingUnitsPerFoot!, recognitionContext: run.recognitionContext! })
  expect(out.error).toBeUndefined()
  return run
}
const rawOf = (v: number, o: number) => v + o
beforeEach(reset)

describe('pickDrawingOrigin (I3)', () => {
  it('every corpus bbox keeps origin {0,0}', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(7)
    for (const name of FILES) expect(pickDrawingOrigin(load(name).bbox), name).toEqual({ x: 0, y: 0 })
  })
  it('uses an absolute threshold in drawing units, not a span-relative one', () => {
    expect(ORIGIN_THRESHOLD).toBe(1e5)
    expect(pickDrawingOrigin({ minX: -1e5, maxX: 1e5, minY: -1e5, maxY: 1e5 })).toEqual({ x: 0, y: 0 })
    expect(pickDrawingOrigin({ minX: 99_999, maxX: 100_001, minY: 0, maxY: 1 })).toEqual({ x: 100_000, y: 0 })
    expect(pickDrawingOrigin({ minX: 0, maxX: 1e-6, minY: 5e9, maxY: 5e9 + 1e-6 })).toEqual({ x: 0, y: 5e9 })
  })
  it('chooses per axis and returns integers that centre the drawing', () => {
    const o = pickDrawingOrigin({ minX: 0, maxX: 14_400, minY: 3_312_345_000, maxY: 3_312_352_300 })
    expect(o.x).toBe(0)
    expect(Number.isInteger(o.y)).toBe(true)
    expect(Math.abs(3_312_345_000 - o.y)).toBeLessThanOrEqual(ORIGIN_THRESHOLD)
    expect(Math.abs(3_312_352_300 - o.y)).toBeLessThanOrEqual(ORIGIN_THRESHOLD)
    const both = pickDrawingOrigin({ minX: 612_345_000, maxX: 612_359_400, minY: -3_312_352_300, maxY: -3_312_345_000 })
    expect(both).toEqual({ x: 612_350_000, y: -3_312_349_000 })
    expect(Object.is(pickDrawingOrigin({ minX: -1, maxX: 1, minY: 0, maxY: 0 }).x, 0)).toBe(true)
  })
})

describe('resolveImportOrigin sticky rule', () => {
  const far = { minX: 612_345_000, maxX: 612_359_400, minY: -3_312_352_300, maxY: -3_312_345_000 }
  it('keeps the current origin while the new raw bbox localised with it stays within T', () => {
    const cur = pickDrawingOrigin(far)
    expect(resolveImportOrigin({ ...far, minX: far.minX - 3000, maxX: far.maxX + 4000 }, cur)).toEqual(cur)
    expect(resolveImportOrigin(far, { x: 0, y: 0 })).toEqual(cur)
  })
  it('re-picks when the frame changed, and returns to {0,0} for a near drawing', () => {
    const cur = pickDrawingOrigin(far)
    const other = { minX: 700_000_000, maxX: 700_010_000, minY: -3_312_352_300, maxY: -3_312_345_000 }
    expect(resolveImportOrigin(other, cur)).toEqual({ x: pickDrawingOrigin(other).x, y: cur.y })
    expect(resolveImportOrigin({ minX: 0, maxX: 14_400, minY: -7300, maxY: 0 }, cur)).toEqual({ x: 0, y: 0 })
  })
})

describe('resolveImportOrigin for spans no origin can fit', () => {
  it('keeps the current origin when its largest local extent is no worse than a fresh pick', () => {
    const wide = { minX: 600_000_000, maxX: 600_400_000, minY: 0, maxY: 10 }
    const cur = { x: 600_200_100, y: 0 }
    // A slightly different wide drawing: the fresh pick (power-of-ten step 1e5) is not better than cur, so cur is kept.
    const next = { ...wide, minX: wide.minX + 100, maxX: wide.maxX + 100 }
    expect(pickDrawingOrigin(next).x).not.toBe(cur.x)
    expect(resolveImportOrigin(next, cur)).toEqual(cur)
  })
  it('re-picks when the current origin is clearly worse', () => {
    const wide = { minX: 600_000_000, maxX: 600_400_000, minY: 0, maxY: 10 }
    const picked = pickDrawingOrigin(wide)
    expect(resolveImportOrigin(wide, { x: 600_000_000, y: 0 })).toEqual({ x: picked.x, y: 0 })
  })
})

describe('pure translation', () => {
  it('translateEntity touches only x, y and points', () => {
    const e: DxfEntity = { type: 'ELLIPSE', x: 10, y: 20, majorAxis: { x: 5, y: 1 }, minorAxis: { x: -1, y: 5 }, startParam: 0.5, endParam: 2, rotationDeg: 33, textHeight: 2, elevation: 3, radius: 4, layer: 'L', handle: 'h' }
    expect(translateEntity(e, 100, -200)).toEqual({ ...e, x: 110, y: -180 })
    const line: DxfEntity = { type: 'LINE', x: 1, y: 2, points: [3, 4] }
    expect(translateEntity(line, 10, 20)).toEqual({ type: 'LINE', x: 11, y: 22, points: [13, 24] })
    const poly: DxfEntity = { type: 'LWPOLYLINE', points: [0, 0, 1, 0, 1, 1], bulges: [0.5, 0, 0], closed: true }
    expect(translateEntity(poly, 1, 2)).toEqual({ ...poly, points: [1, 2, 2, 2, 2, 3] })
    expect(line.x).toBe(1) // input untouched
  })
  it('translateDrawing moves entities, bbox, insertion and bounds but not entityRange; zero shift returns the same objects', () => {
    const d = { entities: [{ type: 'CIRCLE', x: 1, y: 2, radius: 3 } as DxfEntity], bbox: { minX: 0, maxX: 2, minY: 1, maxY: 3 } as BoundingBox,
      blockReferences: [{ handle: 'B', name: 'N', layer: '0', insertion: { x: 1, y: 2 }, rotationDeg: 0, scaleX: 1, scaleY: 1, mirrored: false,
        bounds: { minX: 0, maxX: 2, minY: 1, maxY: 3 }, entityRange: [0, 1] as [number, number], nestingDepth: 0 }] }
    const t = translateDrawing(d, 10, -5)
    expect(t.entities[0]).toMatchObject({ x: 11, y: -3, radius: 3 })
    expect(t.bbox).toEqual({ minX: 10, maxX: 12, minY: -4, maxY: -2 })
    expect(t.blockReferences[0]).toMatchObject({ insertion: { x: 11, y: -3 }, bounds: { minX: 10, maxX: 12, minY: -4, maxY: -2 }, entityRange: [0, 1], rotationDeg: 0 })
    expect(translateDrawing(d, 0, 0).entities).toBe(d.entities)
  })
  it('translateZone moves points, terminals, ducts and unit positions and drops the derived obstacles', () => {
    const z = { id: 'z', name: 'Z', points: [0, 0, 1, 0, 1, 1], spaceTypeId: 'office', ceilingHeight: 9, occupants: 1,
      diffusers: [{ id: 'd', x: 1, y: 2, cfm: 1, size: 's' }], ducts: [{ id: 'k', type: 'trunk', points: [0, 0, 5, 5], widthIn: 1, heightIn: 1, cfm: 1, sizeLabel: '' }],
      unitPos: { x: 1, y: 1 }, unitPositions: [{ x: 2, y: 2 }], outdoorUnitPos: { x: 3, y: 3 }, outdoorUnitPositions: [{ x: 4, y: 4 }],
      obstacles: [{ id: 'o' }] } as unknown as Zone
    const t = translateZone(z, 10, 20)
    expect(t.points).toEqual([10, 20, 11, 20, 11, 21])
    expect(t.diffusers[0]).toMatchObject({ x: 11, y: 22, cfm: 1 })
    expect(t.ducts[0].points).toEqual([10, 20, 15, 25])
    expect(t.unitPos).toEqual({ x: 11, y: 21 })
    expect(t.unitPositions).toEqual([{ x: 12, y: 22 }])
    expect(t.outdoorUnitPos).toEqual({ x: 13, y: 23 })
    expect(t.outdoorUnitPositions).toEqual([{ x: 14, y: 24 }])
    expect(t.obstacles).toBeUndefined()
    expect(z.points[0]).toBe(0)
  })
})

describe('regression: near drawings are untouched (I4)', () => {
  it.each(FILES)('%s imports with origin {0,0} and entities deep-equal to the parser output', (name) => {
    const p = load(name)
    importDrawing(p, name)
    expect(s().drawingOrigin).toEqual({ x: 0, y: 0 })
    expect(s().dxfEntities).toEqual(p.entities)
    expect(s().dxfBoundingBox).toEqual(p.bbox)
    expect(s().cadBlockReferences).toEqual(p.blockReferences ?? [])
  })
})

describe('translation invariance', () => {
  const summary = () => ({
    rooms: (() => { s().setCadLayerRole('A-AREA', 'wall'); return s().recognizeCadRoomCandidates().result!.candidates.map((c) => ({ name: c.name, area: c.areaSqFt })).sort((a, b) => String(a.name).localeCompare(String(b.name))) })(),
    openings: s().cadOpenings.map((o) => ({ kind: o.kind, w: o.widthFt, origin: o.origin })).sort((a, b) => a.kind.localeCompare(b.kind) || a.w - b.w),
    obstacles: s().cadObstacles.map((o) => ({ shape: o.shape, w: o.widthFt, d: o.depthFt, layer: o.layer })).sort((a, b) => a.shape.localeCompare(b.shape) || a.w - b.w)
  })
  it('a drawing translated by (612_345_000, 3_312_345_000) recognises the same rooms, openings and obstacles', () => {
    const near = load(METRIC)
    importDrawing(near)
    const a = summary()
    reset()
    const far = shifted(near, DX, -DY)
    importDrawing(far)
    expect(s().drawingOrigin.x).not.toBe(0)
    expect(s().drawingOrigin.y).not.toBe(0)
    const b = summary()
    expect(a.rooms.length).toBeGreaterThan(0)
    expect(a.openings.length).toBeGreaterThan(0)
    expect(a.obstacles.length).toBeGreaterThan(0)
    expect(b.rooms.map((r) => r.name)).toEqual(a.rooms.map((r) => r.name))
    b.rooms.forEach((r, i) => expect(r.area).toBeCloseTo(a.rooms[i].area, 6))
    expect(b.openings).toEqual(a.openings)
    b.obstacles.forEach((o, i) => { expect(o.shape).toBe(a.obstacles[i].shape); expect(o.w).toBeCloseTo(a.obstacles[i].w, 6) })
  })
  it('stored data is local (|coordinate| <= T) and local + origin equals the shifted raw data exactly', () => {
    const far = shifted(load(METRIC), DX, -DY)
    importDrawing(far)
    const o = s().drawingOrigin
    const local = s().dxfEntities
    expect(local).toHaveLength(far.entities.length)
    const b = s().dxfBoundingBox!
    for (const v of [b.minX, b.maxX, b.minY, b.maxY]) expect(Math.abs(v)).toBeLessThanOrEqual(ORIGIN_THRESHOLD)
    local.forEach((e, i) => {
      const r = far.entities[i]
      if (e.x !== undefined) { expect(Math.abs(e.x)).toBeLessThanOrEqual(ORIGIN_THRESHOLD); expect(rawOf(e.x, o.x)).toBe(r.x); expect(rawOf(e.y!, o.y)).toBe(r.y) }
      e.points?.forEach((v, k) => expect(rawOf(v, k % 2 ? o.y : o.x)).toBe(r.points![k]))
      expect(e.rotationDeg).toBe(r.rotationDeg)
    })
    expect(rawOf(b.minX, o.x)).toBe(far.bbox.minX)
    expect(rawOf(b.maxY, o.y)).toBe(far.bbox.maxY)
    s().cadBlockReferences.forEach((ref, i) => expect(rawOf(ref.insertion.x, o.x)).toBe(far.blockReferences![i].insertion.x))
  })
  it('keeps float precision: Math.fround(local) - local < 0.01 for every stored coordinate, which raw coordinates cannot do', () => {
    const far = shifted(load(METRIC), DX, -DY)
    importDrawing(far)
    const values = (es: DxfEntity[]) => es.flatMap((e) => [...(e.x !== undefined ? [e.x, e.y!] : []), ...(e.points ?? [])])
    for (const v of values(s().dxfEntities)) expect(Math.abs(Math.fround(v) - v)).toBeLessThan(0.01)
    expect(values(far.entities).some((v) => Math.abs(Math.fround(v) - v) >= 0.01)).toBe(true)
  })
  it('arbitrary (non-integer) values survive within 2 ulp', () => {
    const e: DxfEntity = { type: 'LINE', x: 612_345_678.123456, y: -3_312_345_000.7654321, points: [612_345_999.9999, -3_312_345_111.1111] }
    const p: ParsedDxf = { entities: [e], bbox: { minX: e.x!, maxX: e.points![0], minY: e.y!, maxY: e.points![1] }, diagnostics: [] } as unknown as ParsedDxf
    importDrawing(p)
    const o = s().drawingOrigin
    const ulp = (v: number) => Math.abs(v) * 2 ** -52
    const back = s().dxfEntities[0]
    expect(Math.abs(back.x! + o.x - e.x!)).toBeLessThanOrEqual(2 * ulp(e.x!))
    expect(Math.abs(back.points![1] + o.y - e.points![1])).toBeLessThanOrEqual(2 * ulp(e.points![1]))
  })
})

describe('export (I5)', () => {
  const signature = (e: DxfEntity) => [e.type, e.layer, e.x, e.y, ...(e.points ?? [])].join('|')
  it('far import, approve a room, export, re-parse: every source entity and HVAC-ROOMS vertex is at raw coordinates', () => {
    const near = load(METRIC)
    importDrawing(near)
    approveFirstRoom()
    const nearZone = s().zones[0].points
    reset()
    const far = shifted(near, DX, -DY)
    importDrawing(far)
    approveFirstRoom()
    const o = s().drawingOrigin
    const exported = exportProjectDxf(s())
    const back = parseDxfText(exported.text)
    expect(back.diagnostics?.filter((d) => d.severity === 'error')).toEqual([])
    const kinds = ['LINE', 'LWPOLYLINE', 'CIRCLE', 'ARC']
    const want = far.entities.filter((e) => kinds.includes(e.type)).map(signature).sort()
    const got = back.entities.filter((e) => kinds.includes(e.type) && !e.layer!.startsWith('HVAC-')).map(signature).sort()
    expect(got).toEqual(want)
    const room = back.entities.find((e) => e.layer === 'HVAC-ROOMS')!
    const expected = nearZone.map((v, i) => v + (i % 2 ? -DY : DX))
    expect(room.points).toEqual(expected)
    expect(o.x).not.toBe(0)
  })
  it('never adds the origin to vectors (ELLIPSE 11/21) or Z codes (30, 31, 38)', () => {
    const project = { name: 'P', location: 'L', units: 'imperial' as const, scale: 12, cadUnit: 'ft' as const, cadUnitsConfirmed: true, outdoorDb: 95, indoorDb: 75 }
    const ellipse: DxfEntity = { type: 'ELLIPSE', x: 10, y: 20, majorAxis: { x: 6, y: 0 }, minorAxis: { x: 0, y: 3 }, startParam: 0, endParam: 2 * Math.PI, layer: 'E' }
    const line: DxfEntity = { type: 'LINE', x: 1, y: 2, points: [3, 4], layer: 'L', elevation: 7 }
    const poly: DxfEntity = { type: 'LWPOLYLINE', points: [0, 0, 5, 0, 5, 5], closed: true, layer: 'P', elevation: 7 }
    const origin = { x: 1_000_000_000, y: -2_000_000_000 }
    const plain = parseDxfText(exportProjectDxf({ project, zones: [], dxfEntities: [ellipse, line, poly] }).text).entities
    const moved = parseDxfText(exportProjectDxf({ project, zones: [], dxfEntities: [ellipse, line, poly], drawingOrigin: origin }).text).entities
    const by = (es: DxfEntity[], layer: string) => es.find((e) => e.layer === layer)!
    expect(by(moved, 'E').majorAxis).toEqual(by(plain, 'E').majorAxis)
    expect([by(moved, 'E').x, by(moved, 'E').y]).toEqual([10 + origin.x, 20 + origin.y])
    expect(by(moved, 'L')).toMatchObject({ x: 1 + origin.x, y: 2 + origin.y, points: [3 + origin.x, 4 + origin.y], elevation: 7 })
    expect(by(moved, 'P')).toMatchObject({ elevation: 7 })
  })
  const project = { name: 'P', location: 'L', units: 'imperial' as const, scale: 12, cadUnit: 'ft' as const, cadUnitsConfirmed: true, outdoorDb: 95, indoorDb: 75 }
  it('with origin {0,0} the export bytes are a fixed golden string', () => {
    const line: DxfEntity = { type: 'LINE', x: 1, y: 2, points: [3, 4], layer: 'L' }
    const text = exportProjectDxf({ project, zones: [], dxfEntities: [line], drawingOrigin: { x: 0, y: 0 } }).text
    const golden = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1027', '9', '$INSUNITS', '70', '2', '0', 'ENDSEC', '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '2',
      '0', 'LAYER', '2', 'L', '70', '0', '62', '7', '6', 'CONTINUOUS', '0', 'LAYER', '2', 'HVAC-STATUS', '70', '0', '62', '7', '6', 'CONTINUOUS', '0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '8', 'L', '10', '1', '20', '-2', '11', '3', '21', '-4',
      '0', 'TEXT', '8', 'HVAC-STATUS', '10', '1', '20', '10', '40', '4.800000000000001', '1', 'P | EGYPT | PRELIMINARY - NOT FOR CONSTRUCTION', '0', 'ENDSEC', '0', 'EOF', ''].join('\n')
    expect(text).toBe(golden)
    expect(exportProjectDxf({ project, zones: [], dxfEntities: [line] }).text).toBe(golden)
  })
  it('a justified TEXT exports 11/21 at raw coordinates and keeps its alignment (F1 x F2)', () => {
    const origin = { x: 612_350_000, y: -3_312_349_000 }
    const centred: DxfEntity = { type: 'TEXT', x: 100, y: -200, text: 'CTR', textHeight: 2, layer: 'T', textHAlign: 'center', textVAlign: 'middle' }
    const back = parseDxfText(exportProjectDxf({ project, zones: [], dxfEntities: [centred], drawingOrigin: origin }).text).entities.find((e) => e.layer === 'T')!
    expect(back.x).toBe(100 + origin.x)
    expect(back.y).toBe(-200 + origin.y)
    expect(back.textHAlign).toBe('center')
    expect(back.textVAlign).toBe('middle')
    const raw = exportProjectDxf({ project, zones: [], dxfEntities: [centred], drawingOrigin: origin }).text.split('\n')
    const i = raw.indexOf('TEXT')
    const codes = new Map<string, string>(); for (let k = i + 1; k < raw.length && raw[k] !== '0'; k += 2) codes.set(raw[k], raw[k + 1])
    expect(codes.get('10')).toBe(String(100 + origin.x)); expect(codes.get('20')).toBe(String(-(-200 + origin.y)))
    expect(codes.get('11')).toBe(codes.get('10')); expect(codes.get('21')).toBe(codes.get('20'))
  })
  it('an approved opening LINE exports 10/20 and 11/21 at raw coordinates (F2)', () => {
    const origin = { x: 612_350_000, y: -3_312_349_000 }
    const opening = { id: 'cad-opening:door:5.000,0.000', kind: 'door', status: 'approved', level: 0, widthFt: 3, center: { x: 5, y: 0 }, span: { a: { x: 3, y: 0 }, b: { x: 7, y: 0 } } }
    const out = exportProjectDxf({ project, zones: [], dxfEntities: [], cadOpenings: [opening] as never, drawingOrigin: origin }).text
    const back = parseDxfText(out).entities.find((e) => e.layer === 'HVAC-CAD-OPENINGS')!
    expect([back.x, back.y]).toEqual([3 + origin.x, 0 + origin.y])
    expect(back.points).toEqual([7 + origin.x, 0 + origin.y])
    const raw = out.split('\n'); const i = raw.indexOf('HVAC-CAD-OPENINGS', raw.indexOf('ENTITIES'))
    const c = new Map<string, string>(); for (let k = i + 1; raw[k] !== '0'; k += 2) c.set(raw[k], raw[k + 1])
    expect(c.get('11')).toBe(String(7 + origin.x)); expect(c.get('21')).toBe(String(-(0 + origin.y)))
  })
  it('clearDxfData keeps the origin, and a zone added afterwards is exported with it added back', () => {
    importDrawing(shifted(load(METRIC), DX, -DY))
    const o = s().drawingOrigin
    s().clearDxfData()
    expect(s().drawingOrigin).toEqual(o)
    useProjectStore.setState({ project: { ...s().project, cadUnit: 'mm', cadUnitsConfirmed: true, scale: 304.8 } })
    expect(s().addZone([0, 0, 4000, 0, 4000, 3000, 0, 3000]).success).toBe(true)
    const room = parseDxfText(exportProjectDxf(s()).text).entities.find((e) => e.layer === 'HVAC-ROOMS')!
    expect(room.points!.slice(0, 4)).toEqual([0 + o.x, 0 + o.y, 4000 + o.x, 0 + o.y])
  })
})

describe('second import with zones (I2)', () => {
  const rawZone = () => s().zones[0].points.map((v, i) => v + (i % 2 ? s().drawingOrigin.y : s().drawingOrigin.x))
  const farImport = (dx: number, dy: number) => { const p = shifted(load(METRIC), dx, dy); importDrawing(p) }
  /** The same raw room as farImport(DX, -DY) plus a far-away line, so the bbox leaves the old origin's window and a new origin is picked. */
  const sameRoomNewFrame = (): ParsedDxf => {
    const again = shifted(load(METRIC), DX, -DY)
    again.entities.push({ type: 'LINE', layer: 'FAR', x: again.bbox.minX + 4e5, y: again.bbox.minY, points: [again.bbox.minX + 4e5 + 10, again.bbox.minY] } as DxfEntity)
    again.bbox = { ...again.bbox, maxX: again.bbox.minX + 4e5 + 10 }
    return again
  }
  const seed = () => {
    approveFirstRoom()
    useProjectStore.setState({ tempPoints: [1, 2], deploymentEvidence: { [s().zones[0].id]: {} as never }, deploymentInputs: { [s().zones[0].id]: 'f' },
      undoStack: [{} as never], redoStack: [] })
  }
  it('same frame revision keeps the origin, zones and evidence', () => {
    farImport(DX, -DY)
    const o = s().drawingOrigin
    seed()
    const before = s().zones[0].points
    importDrawing(shifted(load(METRIC), DX + 2000, -DY - 1500))
    expect(s().drawingOrigin).toEqual(o)
    expect(s().zones[0].points).toEqual(before)
    expect(Object.keys(s().deploymentEvidence)).toHaveLength(1)
    expect(s().tempPoints).toEqual([1, 2])
  })
  it('a different far frame preserves raw zone positions and clears evidence, inputs, temp points and undo', () => {
    farImport(DX, -DY)
    seed()
    const raw = rawZone()
    const oldOrigin = s().drawingOrigin
    importDrawing(shifted(load(METRIC), 700_000_000, -3_000_000_000))
    expect(s().drawingOrigin).not.toEqual(oldOrigin)
    rawZone().forEach((v, i) => expect(v).toBeCloseTo(raw[i], 5))
    expect(s().deploymentEvidence).toEqual({})
    expect(s().deploymentInputs).toEqual({})
    expect(s().tempPoints).toEqual([])
    expect(s().undoStack).toEqual([])
  })
  it('far to near sets origin {0,0} and preserves raw zone positions', () => {
    farImport(DX, -DY)
    seed()
    const raw = rawZone()
    importDrawing(load(METRIC))
    expect(s().drawingOrigin).toEqual({ x: 0, y: 0 })
    s().zones[0].points.forEach((v, i) => expect(v).toBeCloseTo(raw[i], 5))
  })
  it('the same raw room approved in frame A cannot be approved again after a rebase to frame B (R1)', () => {
    farImport(DX, -DY)
    approveFirstRoom()
    const idA = s().zones[0].cadProvenance!.candidateId
    const originA = s().drawingOrigin
    importDrawing(sameRoomNewFrame())
    expect(s().drawingOrigin).not.toEqual(originA)
    const idB = s().zones[0].cadProvenance!.candidateId
    expect(idB).not.toBe(idA)
    s().setCadLayerRole('A-AREA', 'wall')
    const run = s().recognizeCadRoomCandidates()
    expect(run.success).toBe(true)
    expect(run.result!.candidates.map((c) => c.id)).toContain(idB)
    const candidate = run.result!.candidates.find((c) => c.id === idB)!
    const out = s().approveCadRoom(candidate, { name: 'R2', spaceTypeId: 'office', ceilingHeight: 9, occupants: 2,
      sourceCadRevision: run.sourceCadRevision!, drawingUnitsPerFoot: run.drawingUnitsPerFoot!, recognitionContext: run.recognitionContext! })
    expect(out.error).toMatch(/already approved/i)
    expect(s().zones).toHaveLength(1)
  })
  it('translateZone re-keys coordinate-embedded candidate and opening ids', () => {
    const z = { id: 'z', name: 'Z', points: [0, 0, 4, 0, 4, 3, 0, 3], spaceTypeId: 'office', ceilingHeight: 9, occupants: 1, diffusers: [], ducts: [],
      cadProvenance: { candidateId: 'cad-room:' + canonicalRing([0, 0, 4, 0, 4, 3, 0, 3]), approvedOpeningIds: ['cad-opening:door:2.000,0.000', 'other'] } } as unknown as Zone
    const t = translateZone(z, 10, -5)
    expect(t.cadProvenance!.candidateId).toBe('cad-room:' + canonicalRing([10, -5, 14, -5, 14, -2, 10, -2]))
    expect(t.cadProvenance!.approvedOpeningIds).toEqual(['cad-opening:door:12.000,-5.000', 'other'])
  })
  it('zone obstacles are dropped on rebase and re-derived when the same obstacle is approved in the new frame (R3a)', () => {
    farImport(DX, -DY)
    const holdsObstacle = (cs: CadRoomCandidate[]) => cs.find((c) => s().cadObstacles.some((o) => { const [x, y] = o.id.split(':')[1].split(',').map(Number); return isPointInPolygon(x, y, c.polygon) }))!
    approveFirstRoom(holdsObstacle)
    for (const o of s().cadObstacles) s().approveCadObstacle(o.id, 0.5)
    const inA = (s().zones[0].obstacles ?? []).map((o) => o.id)
    expect(inA.length, 'fixture has an obstacle inside the approved room').toBeGreaterThan(0)
    const originA = s().drawingOrigin
    const rawCentre = (id: string, o: { x: number; y: number }) => { const [x, y] = id.split(':')[1].split(',').map(Number); return [x + o.x, y + o.y] }
    const rawA = inA.map((id) => rawCentre(id, originA))
    importDrawing(sameRoomNewFrame())
    const originB = s().drawingOrigin
    expect(originB).not.toEqual(originA)
    expect((s().zones[0].obstacles ?? []).map((o) => o.id)).toEqual([]) // nothing approved in frame B yet
    for (const id of inA) expect(s().cadObstacles.find((o) => o.id === id)?.status ?? 'review-required').not.toBe('approved')
    const sameRaw = s().cadObstacles.filter((o) => rawA.some((r) => rawCentre(o.id, originB).join() === r.join()))
    expect(sameRaw).toHaveLength(inA.length)
    for (const o of sameRaw) expect(s().approveCadObstacle(o.id, 0.5).success).toBe(true)
    const inB = (s().zones[0].obstacles ?? []).map((o) => o.id)
    expect(inB.length).toBe(inA.length)
    const rawB = inB.map((id) => rawCentre(id, originB))
    expect(rawB.sort()).toEqual(rawA.sort())
    expect(inB.sort()).not.toEqual(inA.sort()) // ids are frame-local
  })
})

describe('persistence (I7)', () => {
  const doc = () => JSON.parse(serializeProject(selectPersistedProject(s())))
  it('restoring a document bumps documentLoadCount so the canvas re-fits', () => {
    const before = s().documentLoadCount
    expect(s().restoreProjectDocument(serializeProject(selectPersistedProject(s()))).success).toBe(true)
    expect(s().documentLoadCount).toBe(before + 1)
    expect('documentLoadCount' in JSON.parse(serializeProject(selectPersistedProject(s())))).toBe(false)
  })
  it('a non-zero origin writes version 3 and reloads into the store', () => {
    importDrawing(shifted(load(METRIC), DX, -DY))
    approveFirstRoom()
    const o = s().drawingOrigin
    const d = doc()
    expect(d.version).toBe(3)
    expect(d.drawingOrigin).toEqual(o)
    const zones = s().zones, entities = JSON.parse(JSON.stringify(s().dxfEntities))
    reset()
    expect(s().restoreProjectDocument(JSON.stringify(d))).toEqual({ success: true })
    expect(s().drawingOrigin).toEqual(o)
    expect(s().dxfEntities).toEqual(entities)
    expect(s().zones[0].points).toEqual(zones[0].points)
  })
  it('a zero origin writes version 2 without drawingOrigin, and v1/v2 documents load with origin {0,0}', () => {
    importDrawing(load(METRIC))
    const d = doc()
    expect(d.version).toBe(2)
    expect(d).not.toHaveProperty('drawingOrigin')
    useProjectStore.setState({ drawingOrigin: { x: 5, y: 6 } })
    expect(s().restoreProjectDocument(JSON.stringify(d)).success).toBe(true)
    expect(s().drawingOrigin).toEqual({ x: 0, y: 0 })
    expect(parseProjectDocument(JSON.stringify({ ...d, version: 1 })).drawingOrigin).toBeUndefined()
  })
  it('rejects drawingOrigin in a v1/v2 document and non-finite or malformed origins', () => {
    importDrawing(shifted(load(METRIC), DX, -DY))
    const d = doc()
    for (const v of [1, 2]) expect(() => parseProjectDocument(JSON.stringify({ ...d, version: v }))).toThrow(/drawingOrigin|origin/i)
    for (const bad of [{ x: null, y: 1 }, { x: 'a', y: 1 }, { x: 1 }, 5, null, [1, 2]])
      expect(() => parseProjectDocument(JSON.stringify({ ...d, drawingOrigin: bad })), JSON.stringify(bad)).toThrow()
    expect(() => parseProjectDocument(JSON.stringify({ ...d, drawingOrigin: { x: 1, y: 2 } }).replace('"y":2', '"y":1e999'))).toThrow()
    expect(() => parseProjectDocument(JSON.stringify({ ...d, version: 4 }))).toThrow(/version/i)
  })
})
