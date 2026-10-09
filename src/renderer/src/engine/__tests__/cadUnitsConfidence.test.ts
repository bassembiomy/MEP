import { describe, expect, it } from 'vitest'
import { calibrateDrawingScale, parseDxfText } from '../dxfParser'
import { parseDwgDatabase } from '../cad/dwgGeometry'
import { dxf, header, layer, line, lwpolyline } from './fixtures/dxfBuilder'

const draw = (head: string, entities: string[]) => parseDxfText(dxf({ header: head, layers: [layer('L')], blocks: [], entities }))
const room = (s: number) => lwpolyline('L', [[0, 0], [s, 0], [s, s], [0, s]], true)
const codes = (p: { diagnostics?: { code: string }[] }) => (p.diagnostics ?? []).map((d) => d.code)

describe('DXF units confidence', () => {
  it('declared mapped code stays declared, with no plausibility complaint', () => {
    const p = draw(header({ insunits: 4 }), [room(5000)])
    expect(p).toMatchObject({ unitsConfidence: 'declared', cadUnit: 'mm' })
    expect(codes(p)).not.toContain('declared-implausible')
  })
  it('$INSUNITS=0 is unknown with a diagnostic; the span guess is only a suggestion', () => {
    const p = draw(header({ insunits: 0 }), [room(5000)])
    expect(p.unitsConfidence).toBe('unknown')
    expect(p.cadUnit).toBe('mm')
    expect(codes(p)).toContain('units-unspecified')
  })
  it('an unmapped code (e.g. 7 = kilometres) is unknown with a diagnostic naming the code', () => {
    const p = draw(header({ insunits: 7 }), [room(5000)])
    expect(p.unitsConfidence).toBe('unknown')
    expect(p.diagnostics!.find((d) => d.code === 'units-unmapped')!.message).toContain('7')
  })
  it('a missing $INSUNITS stays estimated (as before) and says so', () => {
    const p = draw(header(), [room(5000)])
    expect(p.unitsConfidence).toBe('estimated')
    expect(codes(p)).toContain('units-unspecified')
  })
  it('reports $MEASUREMENT and warns when it contradicts $INSUNITS', () => {
    const conflict = draw(header({ insunits: 4, measurement: 0 }), [room(5000)])
    expect(conflict.measurement).toBe(0)
    expect(codes(conflict)).toContain('units-measurement-conflict')
    const agree = draw(header({ insunits: 4, measurement: 1 }), [room(5000)])
    expect(agree.measurement).toBe(1)
    expect(codes(agree)).not.toContain('units-measurement-conflict')
  })
  it('flags declared units that make the drawing larger than 2 km', () => {
   
    const p = draw(header({ insunits: 6 }), [line('L', 0, 0, 3000, 0), room(10)])
    expect(codes(p)).toContain('declared-implausible')
    expect(p.unitsConfidence).toBe('declared')
  })
  it('flags declared units that make the largest closed polyline under 1 ft2', () => {
    const p = draw(header({ insunits: 6 }), [room(0.2)]) // 0.2 m x 0.2 m = 0.43 ft2
    expect(codes(p)).toContain('declared-implausible')
  })
})

describe('DWG units confidence', () => {
  const pt = (x: number, y: number) => ({ x, y, z: 0 })
  const db = (header: unknown) => parseDwgDatabase({ header, entities: [{ type: 'LINE', startPoint: pt(0, 0), endPoint: pt(5000, 0) }] })
  it('INSUNITS 0 and unmapped codes are unknown with diagnostics; mapped stays declared', () => {
    expect(db({ INSUNITS: 0 })).toMatchObject({ unitsConfidence: 'unknown' })
    expect(codes(db({ INSUNITS: 0 }))).toContain('units-unspecified')
    expect(codes(db({ INSUNITS: 9 }))).toContain('units-unmapped')
    expect(db({ INSUNITS: 4 }).unitsConfidence).toBe('declared')
    expect(db({}).unitsConfidence).toBe('estimated')
  })
  it('reads MEASUREMENT as secondary evidence', () => {
    const p = db({ INSUNITS: 4, MEASUREMENT: 0 })
    expect(p.measurement).toBe(0)
    expect(codes(p)).toContain('units-measurement-conflict')
  })
})

describe('calibrateDrawingScale', () => {
  it('returns drawing units per foot from two picked points and a known length', () => {
    expect(calibrateDrawingScale({ x: 0, y: 0 }, { x: 3048, y: 0 }, 10, 'm')).toBeCloseTo(3048 / (10 / 0.3048), 9)
    expect(calibrateDrawingScale({ x: 0, y: 0 }, { x: 30, y: 40 }, 50, 'ft')).toBeCloseTo(1, 12)
    expect(calibrateDrawingScale({ x: 0, y: 0 }, { x: 120, y: 0 }, 120, 'in')).toBeCloseTo(12, 12)
    expect(calibrateDrawingScale({ x: 0, y: 0 }, { x: 1000, y: 0 }, 1000, 'mm')).toBeCloseTo(304.8, 9)
  })
  it('rejects non-finite input, zero or negative lengths, coincident points and unknown units', () => {
    const a = { x: 0, y: 0 }, b = { x: 10, y: 0 }
    expect(() => calibrateDrawingScale(a, b, 0, 'ft')).toThrow(RangeError)
    expect(() => calibrateDrawingScale(a, b, -3, 'ft')).toThrow(RangeError)
    expect(() => calibrateDrawingScale(a, b, NaN, 'ft')).toThrow(RangeError)
    expect(() => calibrateDrawingScale(a, { x: Infinity, y: 0 }, 5, 'ft')).toThrow(RangeError)
    expect(() => calibrateDrawingScale(a, { x: 0, y: 0 }, 5, 'ft')).toThrow(RangeError)
    expect(() => calibrateDrawingScale(a, b, 5, 'furlong' as never)).toThrow(RangeError)
  })
})
