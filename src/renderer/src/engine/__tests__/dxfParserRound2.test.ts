import { describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { dxf, header, layer, line } from './fixtures/dxfBuilder'

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
