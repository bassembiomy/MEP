import { describe, expect, it } from 'vitest'
import { calibrateDrawingScale, parseDxfText, unitsPerFootToUnitsPerMetre } from '../dxfParser'
import { parseDwgDatabase } from '../cad/dwgGeometry'
import { block, dxf, header, insert, layer, line, lwpolyline } from './fixtures/dxfBuilder'

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
    // 3048 units for 10 m: 10 m = 32.8084 ft, so 3048 / 32.8084 = 92.90304 units per foot
    expect(calibrateDrawingScale({ x: 0, y: 0 }, { x: 3048, y: 0 }, 10, 'm')).toBeCloseTo(92.90304, 9)
    expect(calibrateDrawingScale({ x: 0, y: 0 }, { x: 30, y: 40 }, 50, 'ft')).toBeCloseTo(1, 12)
    expect(calibrateDrawingScale({ x: 0, y: 0 }, { x: 120, y: 0 }, 120, 'in')).toBeCloseTo(12, 12)
    expect(calibrateDrawingScale({ x: 0, y: 0 }, { x: 1000, y: 0 }, 1000, 'mm')).toBeCloseTo(304.8, 9)
  })
  it('handles cm, dm and yd', () => {
    expect(calibrateDrawingScale({ x: 0, y: 0 }, { x: 30.48, y: 0 }, 30.48, 'cm')).toBeCloseTo(30.48, 9) // 30.48 cm = 1 ft
    expect(calibrateDrawingScale({ x: 0, y: 0 }, { x: 3.048, y: 0 }, 3.048, 'dm')).toBeCloseTo(3.048, 9) // 3.048 dm = 1 ft
    expect(calibrateDrawingScale({ x: 0, y: 0 }, { x: 1, y: 0 }, 1, 'yd')).toBeCloseTo(1 / 3, 12) // 1 yd = 3 ft
    expect(calibrateDrawingScale({ x: 0, y: 0 }, { x: 0, y: 6 }, 2, 'yd')).toBeCloseTo(1, 12)
  })
  it('returns units per FOOT; unitsPerFootToUnitsPerMetre converts for metric project.scale (units per metre)', () => {
    const perFoot = calibrateDrawingScale({ x: 0, y: 0 }, { x: 1000, y: 0 }, 1000, 'mm')
    expect(perFoot).toBeCloseTo(304.8, 9)
    expect(unitsPerFootToUnitsPerMetre(perFoot)).toBeCloseTo(1000, 9) // millimetres: 1000 units per metre
    expect(unitsPerFootToUnitsPerMetre(1)).toBeCloseTo(1 / 0.3048, 12)
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

describe('DXF/DWG unit parity and diagnostics', () => {
  const pt = (x: number, y: number) => ({ x, y, z: 0 })
  const dwg = (header: unknown, entities: unknown[] = [{ type: 'LINE', startPoint: pt(0, 0), endPoint: pt(5000, 0) }]) => parseDwgDatabase({ header, entities })
  it('an empty drawing without units is unknown in both parsers', () => {
    expect(dwg({}, []).unitsConfidence).toBe('unknown')
    expect(dwg({ INSUNITS: 0 }, []).unitsConfidence).toBe('unknown')
    expect(draw(header(), []).unitsConfidence).toBe('unknown')
    expect(draw(header({ insunits: 0 }), []).unitsConfidence).toBe('unknown')
  })
  it('DWG reports each units condition once (no legacy estimated-units duplicate)', () => {
    for (const [h, code] of [[{}, 'units-unspecified'], [{ INSUNITS: 0 }, 'units-unspecified'], [{ INSUNITS: 9 }, 'units-unmapped']] as const) {
      const c = codes(dwg(h))
      expect(c.filter((x) => x === code)).toHaveLength(1)
      expect(c).not.toContain('estimated-units')
    }
    const message = dwg({}).diagnostics!.find((d) => d.code === 'units-unspecified')!.message
    expect(message).toMatch(/must be confirmed/)
  })
  it('the measurement-conflict message does not call guessed units declared or estimated when confidence is unknown', () => {
    for (const p of [draw(header({ insunits: 0, measurement: 0 }), [room(5000)]), dwg({ INSUNITS: 0, MEASUREMENT: 0 })]) {
      expect(p.unitsConfidence).toBe('unknown')
      const m = p.diagnostics!.find((d) => d.code === 'units-measurement-conflict')!.message
      expect(m).not.toMatch(/declared|estimated units/)
      expect(m).toMatch(/guess|unconfirmed/i)
    }
    expect(draw(header({ insunits: 4, measurement: 0 }), [room(5000)]).diagnostics!.find((d) => d.code === 'units-measurement-conflict')!.message).toMatch(/declared/)
    expect(draw(header({ measurement: 0 }), [room(5000)]).diagnostics!.find((d) => d.code === 'units-measurement-conflict')!.message).toMatch(/estimated/)
  })
})

describe('sheared nested inserts', () => {
  const shearBlocks = [block('INNER', line('0', 0, 0, 2, 0)), block('OUTER', insert('0', 'INNER', 1, 0, { rotation: 30 }))]
  const parseInserts = (outer: { sx?: number; sy?: number; rotation?: number }, blocks = shearBlocks) =>
    parseDxfText(dxf({ header: header({ insunits: 2 }), layers: [layer('L')], blocks, entities: [insert('L', 'OUTER', 10, 5, outer)] }))
  it('non-uniform outer scale with a rotated inner insert emits a diagnostic (DXF)', () => {
    const p = parseInserts({ sx: 2, sy: 1 })
    const d = p.diagnostics!.filter((x) => x.code === 'INSERT_SHEARED')
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ severity: 'warning', entityType: 'INSERT' })
    expect(d[0].message).toMatch(/INNER/)
  })
  it('does not warn for uniform scale, an unrotated inner insert, or a rotated outer insert', () => {
    expect(codes(parseInserts({ sx: 2, sy: 2 }))).not.toContain('INSERT_SHEARED')
    expect(codes(parseInserts({ sx: 2, sy: 1 }, [shearBlocks[0], block('OUTER', insert('0', 'INNER', 1, 0))]))).not.toContain('INSERT_SHEARED')
    expect(codes(parseInserts({ sx: 2, sy: 1, rotation: 40 }, [shearBlocks[0], block('OUTER', insert('0', 'INNER', 1, 0))]))).not.toContain('INSERT_SHEARED')
  })
  it('reports shear for DWG too', () => {
    const pt = (x: number, y: number) => ({ x, y, z: 0 })
    const ins = (name: string, extra: object) => ({ type: 'INSERT', name, handle: name, insertionPoint: pt(0, 0), xScale: 1, yScale: 1, rotation: 0, ...extra })
    const p = parseDwgDatabase({ header: { INSUNITS: 2 },
      entities: [ins('OUTER', { xScale: 2 })],
      tables: { BLOCK_RECORD: { entries: [
        { name: 'INNER', entities: [{ type: 'LINE', startPoint: pt(0, 0), endPoint: pt(2, 0) }] },
        { name: 'OUTER', entities: [ins('INNER', { rotation: Math.PI / 6 })] }
      ] } } })
    expect(codes(p)).toContain('sheared-insert')
    expect(p.entities).toHaveLength(1)
  })
})
