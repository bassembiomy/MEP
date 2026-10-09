import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { aciToHexColor, decodeDxfBytes, parseDxfText, type ParsedDxf } from '../dxfParser'
import { recognizeCadRooms } from '../cad/roomRecognition'
import { parseDwgDatabase } from '../cad/dwgGeometry'

/**
 * Phase C adversarial corpus. Files are written (or byte-transformed) by scripts/cad-corpus/generate_adversarial.py
 * with ezdxf 1.4.4; adversarial-manifest.json is GROUND TRUTH from construction geometry / ezdxf, never from this
 * importer. Y is negated by parseDxfText. KNOWN-GAP POLICY as in cadRealisticCorpus.test.ts: an unfixable defect is
 * declared with gap(...) (it.fails unless CORPUS_SHOW_GAPS=1) and listed in fixtures/corpus/README.md.
 */
const gap = process.env.CORPUS_SHOW_GAPS ? it : it.fails
void gap

const corpus = new URL('./fixtures/corpus/adversarial/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('../adversarial-manifest.json', corpus), 'utf8')).files as Record<string, any>
const bytesOf = (name: string) => new Uint8Array(readFileSync(new URL(name, corpus)))
/** Same decoding as Toolbar.handleFileChange. */
const parseFile = (name: string): ParsedDxf => parseDxfText(decodeDxfBytes(bytesOf(name)))
const codes = (p: ParsedDxf) => (p.diagnostics ?? []).map(d => d.code + (d.entityType && d.code === 'UNSUPPORTED_ENTITY' ? `:${d.entityType}` : ''))

// ------------------------------------------------------------------------------------------------- C7
describe('C7 line endings and binary DXF', () => {
  const t = manifest['line-endings-base-lf.dxf']
  const base = parseFile('line-endings-base-lf.dxf')
  it('the LF base file imports the manifest entity count and declared mm units', () => {
    expect(base.entities).toHaveLength(t.expectedEntityCount)
    expect(base.cadUnit).toBe('mm')
    expect(base.unitsConfidence).toBe('declared')
    expect(base.diagnostics ?? []).toEqual([])
  })
  for (const name of t.textVariants as string[]) {
    it(`${name} parses identically to the LF base (entities, bbox, units, diagnostics)`, () => {
      const p = parseFile(name)
      expect(p.entities).toEqual(base.entities)
      expect(p.bbox).toEqual(base.bbox)
      expect(p.insUnits).toBe(base.insUnits)
      expect(p.measurement).toBe(base.measurement)
      expect(p.cadUnit).toBe(base.cadUnit)
      expect(p.unitsConfidence).toBe(base.unitsConfidence)
      expect(p.diagnostics).toEqual(base.diagnostics)
    })
  }
  it('binary DXF is refused with a clear "Binary DXF is not supported" error (sentinel detected, not parsed as text garbage)', () => {
    const bytes = bytesOf(t.binaryVariant)
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 18))).toBe(t.binarySentinel)
    expect(() => decodeDxfBytes(bytes)).toThrow(/Binary DXF is not supported/)
  })
  it('the text variants are not mistaken for binary', () => {
    for (const name of t.textVariants as string[]) expect(() => decodeDxfBytes(bytesOf(name))).not.toThrow()
  })
})

// ------------------------------------------------------------------------------------------------- C5
describe('C5 noise-2: unsupported objects, XREF, header traps, layer case', () => {
  const t = manifest['noise-2.dxf']
  const p = parseFile('noise-2.dxf')
  const flipY = (poly: number[]) => poly.map((v: number, i: number) => (i % 2 ? -v : v) || 0)
  it('imports exactly the supported model-space entities (ezdxf count) and declares mm', () => {
    expect(p.entities).toHaveLength(t.expectedEntityCount)
    expect(p.cadUnit).toBe('mm')
    expect(p.unitsConfidence).toBe('declared')
  })
  it('reports one UNSUPPORTED_ENTITY per unsupported entity type, one XREF_NOT_LOADED and one PAPER_SPACE_SKIPPED, nothing else', () => {
    const expected: Record<string, number> = { XREF_NOT_LOADED: t.xref.insertions, PAPER_SPACE_SKIPPED: 1 }
    for (const [type, n] of Object.entries(t.sourceUnsupported as Record<string, number>)) expected[`UNSUPPORTED_ENTITY:${type}`] = n
    const actual: Record<string, number> = {}
    for (const c of codes(p)) actual[c] = (actual[c] ?? 0) + 1
    expect(actual).toEqual(expected)
    expect(Object.keys(t.sourceUnsupported).sort()).toEqual(['ACAD_PROXY_ENTITY', 'ACAD_TABLE', 'IMAGE', 'OLE2FRAME', 'WIPEOUT'])
  })
  it('XREF INSERT: warning XREF_NOT_LOADED naming the xref block and its path, no geometry, no block reference', () => {
    const d = (p.diagnostics ?? []).filter(x => x.code === 'XREF_NOT_LOADED')
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('warning')
    expect(d[0].message).toContain(t.xref.path)
    expect(d[0].message).toContain(t.xref.block)
    expect((p.blockReferences ?? []).filter(b => b.name === t.xref.block)).toHaveLength(0)
  })
  it('DWG path: an INSERT of an external-reference block gives xref-not-loaded with the path (hand-made libredwg-shaped database)', () => {
    const db = {
      entities: [{ type: 'INSERT', name: 'SITE-PLAN', handle: 'A6', insertionPoint: { x: 0, y: 0, z: 0 }, xScale: 1, yScale: 1, rotation: 0 }],
      tables: { BLOCK_RECORD: { entries: [{ name: 'SITE-PLAN', handle: '8B', entities: [], isXref: true, xrefPath: t.xref.path }] } },
      header: { INSUNITS: 4 }
    }
    const r = parseDwgDatabase(db)
    expect(r.entities).toHaveLength(0)
    const d = (r.diagnostics ?? []).filter(x => x.code === 'xref-not-loaded')
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('warning')
    expect(d[0].message).toContain(t.xref.path)
  })
  it('an ACAD_TABLE (room schedule) never becomes a text entity or a room label, though its text is larger than the real label', () => {
    const texts = p.entities.filter(e => e.type === 'TEXT' || e.type === 'MTEXT').map(e => e.text)
    expect(texts).toEqual([t.room.name])
    for (const tt of t.tableTexts as string[]) expect(texts).not.toContain(tt)
    const rooms = recognizeCadRooms(p.entities, { drawingUnitsPerFoot: t.unitsPerFoot, layers: ['A-AREA'] }).candidates
    expect(rooms).toHaveLength(1)
    expect(rooms[0].name).toBe(t.room.name)
    expect(Math.abs(rooms[0].areaSqFt - t.room.areaSqFt)).toBeLessThanOrEqual(0.005 * t.room.areaSqFt)
    for (const tt of t.tableTexts as string[]) expect(JSON.stringify(rooms[0])).not.toContain(tt)
  })
  it('rotated UCS, $INSBASE, $ANGDIR and $ANGBASE move nothing: the room outline is exactly the construction polygon', () => {
    const poly = p.entities.find(e => e.type === 'LWPOLYLINE')!
    expect(poly.points).toEqual(flipY(t.room.polygon))
  })
  it('ARC angles are always CCW from +X (OCS) whatever $ANGDIR / $ANGBASE say: endpoints equal ezdxf Arc.start_point / end_point', () => {
    const arcs = p.entities.filter(e => e.type === 'ARC')
    expect(arcs).toHaveLength(t.arcs.length)
    t.arcs.forEach((a: any, i: number) => {
      const e = arcs[i]
      expect(e.x).toBeCloseTo(a.centre[0], 9)
      expect(e.y).toBeCloseTo(-a.centre[1], 9)
      expect(e.radius).toBeCloseTo(a.radius, 9)
      const pt = (deg: number) => [e.x! + e.radius! * Math.cos((deg * Math.PI) / 180), e.y! - e.radius! * Math.sin((deg * Math.PI) / 180)]
      const [sx, sy] = pt(e.startAngleDeg!), [ex, ey] = pt(e.endAngleDeg!)
      expect(sx).toBeCloseTo(a.start[0], 6); expect(sy).toBeCloseTo(-a.start[1], 6)
      expect(ex).toBeCloseTo(a.end[0], 6); expect(ey).toBeCloseTo(-a.end[1], 6)
    })
  })
  it('entity layer "walls" resolves case-insensitively to the table layer WALLS (name and BYLAYER colour)', () => {
    const walls = p.entities.filter(e => e.type === 'LINE' && e.layer === t.layers.tableCase)
    expect(walls).toHaveLength(4)
    for (const w of walls) expect(w.color).toBe(aciToHexColor(t.layers.wallAci))
    expect(p.entities.some(e => e.layer === t.layers.entityCase)).toBe(false)
  })
  it('entity layer "a-frz" is hidden because the table layer A-FRZ is frozen; ACAD_LAYERSTATES does not change visibility', () => {
    expect(p.hiddenLayers).toEqual(t.hiddenLayers)
    const frz = p.entities.filter(e => e.layer === t.layers.frozenTable)
    expect(frz).toHaveLength(1)
    expect(p.entities.filter(e => e.layer === t.layers.layerStateTurnsOff)).toHaveLength(t.arcs.length)
    expect(p.hiddenLayers).not.toContain(t.layers.layerStateTurnsOff)
  })
})
