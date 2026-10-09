import { describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { parseDwgDatabase } from '../cad/dwgGeometry'
import { suggestCeilingHeight } from '../cad/levelAnnotations'
import { recognizeCadRooms } from '../cad/roomRecognition'
import { recognizeObstacles } from '../cad/obstacleRecognition'
import { dxf, header, layer, line, lwpolyline, mtext, text } from './fixtures/dxfBuilder'
import type { DxfEntity } from '../../store/projectStore'

const MM = 304.8
const near = (a: number | undefined, b: number, eps = 1e-3) => expect(Math.abs((a ?? NaN) - b)).toBeLessThan(eps)
const roomMm = lwpolyline('A-WALL', [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], true)
const parse = (entities: string[], insunits = 4) =>
  parseDxfText(dxf({ header: header({ insunits }), layers: [layer('A-WALL'), layer('A-ANNO')], blocks: [], entities }))
const suggest = (texts: string[], opts: { unitsConfirmed?: boolean; extra?: string[] } = {}) => {
  const parsed = parse([roomMm, ...texts.map((t, i) => text('A-ANNO', 1000 + i * 300, 1000, 100, t)), ...(opts.extra ?? [])])
  const room = recognizeCadRooms(parsed.entities, { drawingUnitsPerFoot: MM }).candidates[0]
  return suggestCeilingHeight(parsed.entities, room, { unitsPerFoot: MM, unitsConfirmed: opts.unitsConfirmed ?? true })
}

describe('ceiling height suggestions from level annotations', () => {
  it('"CH 2.70" in a mm drawing gives 8.858 ft with evidence and confidence', () => {
    const r = suggest(['CH 2.70'])
    near(r.ceilingHeightSuggestion?.valueFt, 8.858)
    expect(r.ceilingHeightSuggestion!.confidence).toBeGreaterThanOrEqual(0.7)
    expect(r.ceilingHeightSuggestion!.evidence.join(' ')).toContain('CH 2.70')
    expect(r.unresolved).toBe(false)
  })
  it.each(['C.H.=2700', 'C.H. = 2700', 'CLG HT 2700', 'CEILING HEIGHT: 2700mm', 'CH 2.7m', 'CH=2.70'])(
    'parses %s',
    (t) => near(suggest([t]).ceilingHeightSuggestion?.valueFt, 8.858)
  )
  it('unitless integers need confirmed drawing units; otherwise unresolved with no suggestion', () => {
    const r = suggest(['C.H.=2700'], { unitsConfirmed: false })
    expect(r.ceilingHeightSuggestion).toBeUndefined()
    expect(r.unresolved).toBe(true)
    expect(r.unresolvedReasons.join(' ')).toMatch(/units/i)
  })
  it('decimal numbers under 10 are metres even when units are unconfirmed', () => {
    near(suggest(['CH 2.70'], { unitsConfirmed: false }).ceilingHeightSuggestion?.valueFt, 8.858)
  })
  it('feet-inch notation', () => {
    near(suggest([`CH 9'-0"`]).ceilingHeightSuggestion?.valueFt, 9)
    near(suggest([`CLG HT 8'-6"`]).ceilingHeightSuggestion?.valueFt, 8.5)
  })
  it('FCL minus FFL', () => {
    const r = suggest(['FFL +0.00', 'FCL +2.70'])
    near(r.ceilingHeightSuggestion?.valueFt, 8.858)
    expect(r.ceilingHeightSuggestion!.evidence.join(' ')).toMatch(/FCL.*FFL/)
    const shifted = suggest(['FFL +0.15', 'FCL +2.85'])
    near(shifted.ceilingHeightSuggestion?.valueFt, 8.858)
  })
  it('a soffit alone is only a weak upper bound', () => {
    const r = suggest(['FFL +0.00', 'SOFFIT +2.85'])
    near(r.ceilingHeightSuggestion?.valueFt, 9.350, 5e-3)
    expect(r.ceilingHeightSuggestion!.confidence).toBeLessThanOrEqual(0.4)
    expect(r.ceilingHeightSuggestion!.evidence.join(' ')).toMatch(/soffit/i)
  })
  it('a bare FCL marker carries no number: no suggestion, nothing unresolved', () => {
    const r = suggest(['FCL'])
    expect(r.ceilingHeightSuggestion).toBeUndefined()
    expect(r.unresolved).toBe(false)
    expect(r.annotations.some((a) => a.kind === 'fcl' && a.valueFt === undefined)).toBe(true)
  })
  it('two conflicting annotations give no suggestion and an unresolved flag', () => {
    const r = suggest(['CH 2.70', 'CH 3.00'])
    expect(r.ceilingHeightSuggestion).toBeUndefined()
    expect(r.unresolved).toBe(true)
    expect(r.unresolvedReasons.join(' ')).toMatch(/conflict/i)
    expect(suggest(['CH 2.70', 'CH 2700']).ceilingHeightSuggestion).toBeDefined() // same value, agreeing
  })
  it('retains Arabic text and Arabic-Indic digits', () => {
    const r = suggest(['ارتفاع السقف ٢٫٧٠'])
    near(r.ceilingHeightSuggestion?.valueFt, 8.858)
    expect(r.ceilingHeightSuggestion!.evidence.join(' ')).toContain('ارتفاع السقف ٢٫٧٠')
    expect(r.annotations[0].text).toBe('ارتفاع السقف ٢٫٧٠')
  })
  it('strips MTEXT formatting and ignores text outside the room', () => {
    const parsed = parse([roomMm, mtext('A-ANNO', 1000, 1000, 100, '{\\fArial|b0;CH\\P2.70}'), text('A-ANNO', 9000, 9000, 100, 'CH 5.00')])
    const room = recognizeCadRooms(parsed.entities, { drawingUnitsPerFoot: MM }).candidates[0]
    const r = suggestCeilingHeight(parsed.entities, room, { unitsPerFoot: MM, unitsConfirmed: true })
    near(r.ceilingHeightSuggestion?.valueFt, 8.858)
    expect(r.annotations).toHaveLength(1)
  })
  it('implausible heights are not suggested', () => {
    const r = suggest(['CH 0.50'])
    expect(r.ceilingHeightSuggestion).toBeUndefined()
    expect(r.unresolved).toBe(true)
  })
})

describe('constant-elevation geometry (DXF)', () => {
  const lineZ = (z1: number, z2: number) => `0\nLINE\n8\nA-WALL\n10\n0\n20\n0\n30\n${z1}\n11\n10\n21\n0\n31\n${z2}`
  const circleZ = (z: number) => `0\nCIRCLE\n8\nA-WALL\n10\n0\n20\n0\n30\n${z}\n40\n5`
  it('keeps equal non-zero Z with an elevation field and a warning', () => {
    const p = parse([lineZ(3, 3), circleZ(2.5)])
    expect(p.entities).toHaveLength(2)
    expect(p.entities.map((e) => (e as DxfEntity & { elevation?: number }).elevation)).toEqual([3, 2.5])
    expect(p.diagnostics!.filter((d) => d.code === 'ELEVATED_GEOMETRY_PROJECTED')).toHaveLength(2)
    expect(p.diagnostics!.some((d) => d.code === 'UNSUPPORTED_ELEVATION')).toBe(false)
  })
  it('still drops non-planar entities and leaves flat geometry without an elevation field', () => {
    const p = parse([lineZ(0, 4), line('A-WALL', 0, 0, 1, 1)])
    expect(p.entities).toHaveLength(1)
    expect('elevation' in p.entities[0]).toBe(false)
    expect(p.diagnostics!.map((d) => d.code)).toContain('UNSUPPORTED_ELEVATION')
  })
  it('children of an elevated INSERT inherit its elevation', () => {
    const p = parseDxfText(dxf({
      header: header({ insunits: 4 }), layers: [layer('A-WALL')],
      blocks: [`0\nBLOCK\n8\n0\n2\nB\n70\n0\n10\n0\n20\n0\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n5\n21\n0\n0\nENDBLK\n8\n0`],
      entities: ['0\nINSERT\n8\nA-WALL\n2\nB\n10\n0\n20\n0\n30\n2']
    }))
    expect(p.entities).toHaveLength(1)
    expect((p.entities[0] as DxfEntity & { elevation?: number }).elevation).toBe(2)
  })
  it('room and obstacle recognition ignore elevated entities unless a level selects them', () => {
    const upper = parse([`0\nLWPOLYLINE\n8\nA-WALL\n90\n4\n70\n1\n38\n3000\n10\n0\n20\n0\n10\n5000\n20\n0\n10\n5000\n20\n4000\n10\n0\n20\n4000`])
    expect(upper.entities).toHaveLength(1)
    expect(recognizeCadRooms(upper.entities, { drawingUnitsPerFoot: MM }).candidates).toHaveLength(0)
    expect(recognizeCadRooms(upper.entities, { drawingUnitsPerFoot: MM, level: 3000 }).candidates).toHaveLength(1)
    const flat = parse([roomMm])
    expect(recognizeCadRooms(flat.entities, { drawingUnitsPerFoot: MM, level: 3000 }).candidates).toHaveLength(0)
    const col = parse([`0\nCIRCLE\n8\nS-COLS\n10\n0\n20\n0\n30\n3000\n40\n200`])
    expect(recognizeObstacles(col.entities, { unitsPerFoot: MM }).candidates).toHaveLength(0)
    expect(recognizeObstacles(col.entities, { unitsPerFoot: MM, level: 3000 }).candidates).toHaveLength(1)
  })
})

describe('constant-elevation geometry (DWG)', () => {
  const pt = (x: number, y: number, z = 0) => ({ x, y, z })
  it('keeps a circle at constant Z but drops one with varying Z', () => {
    const p = parseDwgDatabase({ header: { INSUNITS: 4 }, entities: [
      { type: 'CIRCLE', center: pt(0, 0, 2), radius: 1 },
      { type: 'LINE', startPoint: pt(0, 0, 0), endPoint: pt(1, 1, 2) }
    ] })
    expect(p.entities).toHaveLength(1)
    expect((p.entities[0] as DxfEntity & { elevation?: number }).elevation).toBe(2)
  })
})
