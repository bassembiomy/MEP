import { describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { block, dxf, header, insert, layer, line, rawRecord } from './fixtures/dxfBuilder'

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
