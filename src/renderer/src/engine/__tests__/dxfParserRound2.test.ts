import { describe, expect, it } from 'vitest'
import { decodeDxfBytes, parseDxfText } from '../dxfParser'
import { block, dxf, header, insert, layer, line, rawRecord, text } from './fixtures/dxfBuilder'

describe('HEADER variables with group code 2 are not section names', () => {
  const build = (extra: Parameters<typeof header>[0]) =>
    dxf({ header: header(extra), layers: [layer('0')], blocks: [], entities: [line('0', 0, 0, 6000, 0)] })

  it('reads $INSUNITS and $MEASUREMENT that follow $DIMSTYLE/$UCSNAME/$CMLSTYLE', () => {
    const parsed = parseDxfText(build({
      extra: [[9, '$DIMSTYLE'], [2, 'Standard'], [9, '$UCSNAME'], [2, ''], [9, '$PUCSNAME'], [2, ''], [9, '$CMLSTYLE'], [2, 'Standard']],
      insunits: 4, measurement: 1
    }))
    expect(parsed.insUnits).toBe(4)
    expect(parsed.measurement).toBe(1)
    expect(parsed.unitsConfidence).toBe('declared')
    expect(parsed.diagnostics?.some(d => d.code === 'units-unspecified')).toBe(false)
  })

  it('a unitless file ($INSUNITS 0) behind code-2 variables is unknown, not estimated', () => {
    const parsed = parseDxfText(build({ extra: [[9, '$DIMSTYLE'], [2, 'Standard']], insunits: 0 }))
    expect(parsed.insUnits).toBe(0)
    expect(parsed.unitsConfidence).toBe('unknown')
    expect(parsed.diagnostics?.filter(d => d.code === 'units-unspecified')).toHaveLength(1)
  })

  it('a code-2 header value named like a section does not open that section', () => {
    const parsed = parseDxfText(build({ extra: [[9, '$DIMSTYLE'], [2, 'ENTITIES']], insunits: 4 }))
    expect(parsed.insUnits).toBe(4)
    expect(parsed.entities).toHaveLength(1)
  })
})

describe('paper space (group 67 = 1)', () => {
  it('skips top-level paper-space records with one aggregated diagnostic, keeps model space', () => {
    const parsed = parseDxfText(dxf({
      header: header({ insunits: 4 }), layers: [layer('0')], blocks: [],
      entities: [line('0', 0, 0, 5000, 0), rawRecord([0, 'LINE'], [67, 1], [8, '0'], [10, 0], [20, 0], [11, 1], [21, 1]),
        rawRecord([0, 'TEXT'], [67, 1], [8, '0'], [10, 0], [20, 0], [40, 2], [1, 'SHEET']),
        rawRecord([0, 'POLYLINE'], [67, 1], [8, '0'], [70, 0]), rawRecord([0, 'VERTEX'], [8, '0'], [10, 0], [20, 0]), rawRecord([0, 'SEQEND'], [8, '0'])]
    }))
    expect(parsed.entities).toHaveLength(1)
    const d = parsed.diagnostics!.filter(x => x.code === 'PAPER_SPACE_SKIPPED')
    expect(d).toHaveLength(1)
    expect(d[0].message).toMatch(/^3 paper-space/)
    expect(parsed.diagnostics!.some(x => x.code === 'UNSUPPORTED_ENTITY')).toBe(false)
  })
  it('does not filter inside block definitions and emits nothing without paper space', () => {
    const inBlock = rawRecord([0, 'LINE'], [67, 1], [8, '0'], [10, 0], [20, 0], [11, 100], [21, 0])
    const parsed = parseDxfText(dxf({ header: header({ insunits: 4 }), layers: [layer('0')], blocks: [block('B', inBlock)], entities: [insert('0', 'B', 0, 0)] }))
    expect(parsed.entities).toHaveLength(1)
    expect(parsed.diagnostics!.some(x => x.code === 'PAPER_SPACE_SKIPPED')).toBe(false)
  })
})

describe('ATTRIB / ATTDEF / SEQEND', () => {
  const attdef = (flags: number, value: string) => rawRecord([0, 'ATTDEF'], [8, '0'], [10, 0], [20, 0], [40, 100], [1, value], [2, 'TAG'], [70, flags])
  const build = (flags: number, tail = '') => parseDxfText(dxf({
    header: header({ insunits: 4 }), layers: [layer('0')],
    blocks: [block('DOOR', line('0', 0, 0, 900, 0) + '\n' + attdef(0, 'D00') + '\n' + attdef(2, 'FIXED'))],
    entities: [rawRecord([0, 'INSERT'], [8, '0'], [2, 'DOOR'], [66, 1], [10, 1000], [20, 0]),
      rawRecord([0, 'ATTRIB'], [8, '0'], [10, 1450], [20, 100], [40, 100], [1, 'D01'], [2, 'TAG'], [70, flags], [50, 90]),
      rawRecord([0, 'SEQEND'], [8, '0']), tail].filter(Boolean)
  }))
  it('turns a visible ATTRIB into a TEXT with its value, rotation and height', () => {
    const t = build(0).entities.find(e => e.text === 'D01')!
    expect(t.type).toBe('TEXT')
    expect(t.textHeight).toBe(100)
    // identical to what the same placement gives as plain TEXT
    const plain = parseDxfText(dxf({ header: header({ insunits: 4 }), layers: [layer('0')], blocks: [],
      entities: [rawRecord([0, 'TEXT'], [8, '0'], [10, 1450], [20, 100], [40, 100], [1, 'D01'], [50, 90])] })).entities[0]
    expect(t.rotationDeg).toBeCloseTo(plain.rotationDeg!, 9)
    expect(t.x).toBe(plain.x)
    expect(t.y).toBe(plain.y)
  })
  it('drops invisible ATTRIB, template ATTDEF and SEQEND silently but keeps a constant ATTDEF', () => {
    const p = build(1)
    expect(p.entities.some(e => e.text === 'D01')).toBe(false)
    expect(p.entities.some(e => e.text === 'D00')).toBe(false)
    expect(p.entities.filter(e => e.text === 'FIXED')).toHaveLength(1)
    expect(p.diagnostics!.filter(d => d.code === 'UNSUPPORTED_ENTITY')).toEqual([])
  })
})

describe('text encoding', () => {
  const file = (acadver: string, codepage: string | undefined, value: string) =>
    dxf({ header: header({ acadver, codepage, insunits: 4 }), layers: [layer('0')], blocks: [], entities: [text('0', 0, 0, 100, value)] })
  const cp1252 = (s: string) => Uint8Array.from(Array.from(s, c => c.charCodeAt(0) & 0xff)) // latin1 range == cp1252 for these chars

  it('decodes pre-AC1021 files as windows-1252 (0xFC -> u-umlaut, 0xE9 -> e-acute)', () => {
    const out = parseDxfText(decodeDxfBytes(cp1252(file('AC1015', 'ANSI_1252', 'Büro Café'))))
    expect(out.entities[0].text).toBe('Büro Café')
  })
  it('honours another known $DWGCODEPAGE (ANSI_1251 Cyrillic)', () => {
    const src = file('AC1015', 'ANSI_1251', 'XX')
    const bytes = new TextEncoder().encode(src)
    const at = src.indexOf('XX')
    bytes[at] = 0xcf; bytes[at + 1] = 0xf0 // "Пр" in windows-1251
    expect(parseDxfText(decodeDxfBytes(bytes)).entities[0].text).toBe('Пр')
  })
  it('decodes AC1021+ as UTF-8', () => {
    const bytes = new TextEncoder().encode(file('AC1027', undefined, 'Büro ارتفاع'))
    expect(parseDxfText(decodeDxfBytes(bytes)).entities[0].text).toBe('Büro ارتفاع')
  })
  it('without $ACADVER reads valid UTF-8 as UTF-8 and falls back to windows-1252 otherwise', () => {
    const plain = dxf({ layers: [layer('0')], blocks: [], entities: [text('0', 0, 0, 100, 'Büro')] })
    expect(decodeDxfBytes(new TextEncoder().encode(plain))).toContain('Büro')
    expect(decodeDxfBytes(cp1252(plain))).toContain('Büro')
  })
  it('strips a UTF-8 BOM and never throws on garbage bytes', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('0\nEOF\n')])
    expect(() => decodeDxfBytes(bom)).not.toThrow()
    expect(() => decodeDxfBytes(new Uint8Array([0xff, 0xfe, 0x00, 0x80]))).not.toThrow()
  })
  it('decodes \\U+XXXX escapes in TEXT and MTEXT values', () => {
    const parsed = parseDxfText(dxf({
      header: header({ insunits: 4 }), layers: [layer('0')], blocks: [],
      entities: [text('0', 0, 0, 100, '\\U+0627\\U+0631 2.80'), rawRecord([0, 'MTEXT'], [8, '0'], [10, 0], [20, 0], [40, 100], [1, 'caf\\U+00e9'])]
    }))
    expect(parsed.entities.map(e => e.text)).toEqual(['\u0627\u0631 2.80', 'café'])
  })
})
