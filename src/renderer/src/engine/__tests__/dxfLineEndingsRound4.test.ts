import { describe, expect, it } from 'vitest'
import { decodeDxfBytes, parseDxfText } from '../dxfParser'
import { dxf, header, layer, line, text } from './fixtures/dxfBuilder'

const lf = dxf({ header: header({ insunits: 4, acadver: 'AC1015', codepage: 'ANSI_1251' }), layers: [layer('0')], blocks: [], entities: [line('0', 0, 0, 5000, 0), text('0', 10, 10, 50, 'Ïð')] })
const bytesWith = (eol: string): Uint8Array => Uint8Array.from(lf.replace(/\n/g, eol), c => c.charCodeAt(0))

describe('line terminators (recommended 1): \\r\\r\\n', () => {
  const base = parseDxfText(decodeDxfBytes(bytesWith('\n')))
  for (const [name, eol] of [['CRLF', '\r\n'], ['CR-only', '\r'], ['double-converted \\r\\r\\n', '\r\r\n']] as const) {
    it(`${name} parses identically to LF, including the code page read from the header`, () => {
      const decoded = decodeDxfBytes(bytesWith(eol))
      const p = parseDxfText(decoded)
      expect(p.entities).toEqual(base.entities)
      expect(p.diagnostics ?? []).toEqual(base.diagnostics ?? [])
      expect(p.entities.find(e => e.type === 'TEXT')?.text).toBe('Пр') // windows-1251 'Pr', so the header scan worked
      expect(p.cadUnit).toBe(base.cadUnit)
    })
  }
  it('a \\r\\r\\n file leaves no stray CR in values (no INCOMPLETE_PAIR or malformed layer name)', () => {
    const p = parseDxfText(lf.replace(/\n/g, '\r\r\n'))
    expect((p.diagnostics ?? []).map(d => d.code)).toEqual([])
    expect(p.entities.every(e => e.layer === '0')).toBe(true)
  })
})
