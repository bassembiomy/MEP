import { describe, expect, it } from 'vitest'
import { decodeDxfBytes, parseDxfText } from '../dxfParser'
import { normalizeAnnotationText } from '../cad/levelAnnotations'
import { block, dxf, header, insert, layer, line, rawRecord, text } from './fixtures/dxfBuilder'

describe('normalizeAnnotationText strips semicolon-less MTEXT codes', () => {
  it('drops \\L \\l \\O \\o \\K \\k toggles without eating following text', () => {
    expect(normalizeAnnotationText('\\LOFFICE\\l 1')).toBe('OFFICE 1')
    expect(normalizeAnnotationText('\\OHALL\\o; CH=2.8m')).toBe('HALL; CH=2.8m')
    expect(normalizeAnnotationText('\\KLAB\\k')).toBe('LAB')
  })
  it('turns \\~ into a space, \\\\ into a backslash and keeps escaped braces', () => {
    expect(normalizeAnnotationText('CH\\~2.8m')).toBe('CH 2.8m')
    expect(normalizeAnnotationText('A\\\\B')).toBe('A\\B')
    expect(normalizeAnnotationText('\\{x\\}')).toBe('{x}')
  })
  it('still strips parameterised codes, braces and paragraph breaks', () => {
    expect(normalizeAnnotationText('{\\fArial|b1;OFFICE 1}\\PCH=2.7m')).toBe('OFFICE 1 CH=2.7m')
    expect(normalizeAnnotationText('\\H2.5x;\\C1;TEXT')).toBe('TEXT')
  })
})

describe('group 999 comments', () => {
  it('a comment between SECTION and its name does not hide the section', () => {
    const src = dxf({ header: header({ insunits: 4 }), layers: [layer('0')], blocks: [], entities: [line('0', 0, 0, 5000, 0)] })
      .replace('0\nSECTION\n2\nENTITIES', '0\nSECTION\n999\nwritten by a tool\n2\nENTITIES')
    expect(src).toContain('999\nwritten by a tool')
    expect(parseDxfText(src).entities).toHaveLength(1)
  })
})

describe('paper-space INSERT with attributes', () => {
  it('skips the INSERT, its ATTRIBs (even without group 67) and the SEQEND', () => {
    const parsed = parseDxfText(dxf({
      header: header({ insunits: 4 }), layers: [layer('0')], blocks: [block('TAG', line('0', 0, 0, 10, 0))],
      entities: [line('0', 0, 0, 5000, 0),
        rawRecord([0, 'INSERT'], [67, 1], [8, '0'], [2, 'TAG'], [66, 1], [10, 0], [20, 0]),
        rawRecord([0, 'ATTRIB'], [8, '0'], [10, 5], [20, 5], [40, 2], [1, 'SHEET-1'], [2, 'T'], [70, 0]),
        rawRecord([0, 'SEQEND'], [8, '0']),
        text('0', 100, 100, 50, 'MODEL')]
    }))
    expect(parsed.entities.map(e => e.text).filter(Boolean)).toEqual(['MODEL'])
  })
})

describe('MTEXT \\M+ multibyte escapes', () => {
  const one = (value: string) => parseDxfText(dxf({ header: header({ insunits: 4 }), layers: [layer('0')], blocks: [], entities: [text('0', 0, 0, 100, value)] })).entities[0].text
  it('decodes \\M+1 (Shift-JIS) and \\M+4 (GBK) double-byte codes', () => {
    expect(one('\\M+18A4F')).toBe('\u5916') // Shift-JIS 8A4F
    expect(one('x\\M+4B0A1y')).toBe('x\u554Ay') // GBK B0A1
  })
  it('leaves an unsupported or malformed escape untouched', () => {
    expect(one('\\M+9ZZZZ')).toBe('\\M+9ZZZZ')
  })
  it('leaves a well-formed but undecodable double-byte sequence as written (no U+FFFD)', () => {
    expect(one('\\M+1FFFF')).toBe('\\M+1FFFF')
  })
  it('does not decode an escape that follows an escaped backslash', () => {
    expect(one('\\\\U+0041')).toBe('\\\\U+0041')
    expect(one('\\\\M+18A4F')).toBe('\\\\M+18A4F')
    expect(one('\\\\\\U+0041')).toBe('\\\\A')
  })
})

describe('AC1021+ text encoding', () => {
  const file = (acadver: string, value: string) =>
    dxf({ header: header({ acadver, codepage: 'ANSI_1252', insunits: 4 }), layers: [layer('0')], blocks: [], entities: [text('0', 0, 0, 100, value)] })
  const cp1252 = (s: string) => Uint8Array.from(Array.from(s, c => c.charCodeAt(0) & 0xff))
  it('keeps decoding valid UTF-8 as UTF-8', () => {
    expect(parseDxfText(decodeDxfBytes(new TextEncoder().encode(file('AC1027', 'Büro ارتفاع')))).entities[0].text).toBe('Büro ارتفاع')
  })
  it('falls back to the code page when an AC1021+ file is not valid UTF-8 (a code-page file with a wrong version stamp)', () => {
    expect(parseDxfText(decodeDxfBytes(cp1252(file('AC1027', 'Büro Café')))).entities[0].text).toBe('Büro Café')
  })
})
