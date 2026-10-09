import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeDxfBytes, parseDxfText, type ParsedDxf } from '../dxfParser'

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
