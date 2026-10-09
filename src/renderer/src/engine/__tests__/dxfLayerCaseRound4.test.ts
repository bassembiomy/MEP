import { describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { block, dxf, header, insert, layer, line, rawRecord } from './fixtures/dxfBuilder'

const codes = (p: ReturnType<typeof parseDxfText>) => (p.diagnostics ?? []).map(d => d.code)
const build = (layers: string[], entities: string[]) => dxf({ header: header({ insunits: 4 }), layers, blocks: [], entities })

describe('layer name case (recommended 5)', () => {
  it('two TABLE layers that differ only by case merge into the first spelling and say so', () => {
    const p = parseDxfText(build([layer('Walls'), layer('WALLS')], [line('WALLS', 0, 0, 5000, 0), line('walls', 0, 0, 0, 5000)]))
    expect(p.entities.map(e => e.layer)).toEqual(['Walls', 'Walls'])
    expect(codes(p)).toEqual(['LAYER_CASE_COLLISION'])
    expect(p.diagnostics![0].message).toMatch(/Walls/)
    expect(p.diagnostics![0].message).toMatch(/WALLS/)
  })
  it('a repeated identical spelling is not a case collision', () => {
    expect(codes(parseDxfText(build([layer('Walls'), layer('Walls')], [line('Walls', 0, 0, 5000, 0)])))).toEqual([])
  })
  it('entity-only layers differing by case (not in the table) register the first-seen spelling', () => {
    const p = parseDxfText(build([layer('0')], [line('foo', 0, 0, 5000, 0), line('FOO', 0, 0, 0, 5000), line('Foo', 0, 0, 5000, 5000)]))
    expect(p.entities.map(e => e.layer)).toEqual(['foo', 'foo', 'foo'])
  })
})

describe('effectiveName false-positive guard (recommended 6)', () => {
  const withRecords = (records: string[]) =>
    dxf({ header: header({ insunits: 4 }), layers: [layer('0')], blocks: [block('*U1', line('0', 0, 0, 900, 0)), block('*U2', line('0', 0, 0, 800, 0))], entities: [insert('0', '*U1', 0, 0)] })
      .replace('0\nENDTAB\n0\nENDSEC', `0\nENDTAB\n0\nTABLE\n2\nBLOCK_RECORD\n70\n${records.length}\n${records.join('\n')}\n0\nENDTAB\n0\nENDSEC`)
  const rec = (handle: string, name: string, tag?: string) =>
    rawRecord([0, 'BLOCK_RECORD'], [5, handle], [2, name], ...(tag ? ([[1001, 'AcDbBlockRepBTag'], [1005, tag]] as [number, string][]) : []))
  it('control: a named target is used as the effective name', () => {
    const p = parseDxfText(withRecords([rec('A1', '*U1', 'B2'), rec('B2', 'DOOR-DYN')]))
    expect(p.blockReferences?.[0].effectiveName).toBe('DOOR-DYN')
  })
  it('a target that is itself anonymous is not an effective name', () => {
    const p = parseDxfText(withRecords([rec('A1', '*U1', 'B2'), rec('B2', '*U2')]))
    expect(p.blockReferences?.[0].effectiveName).toBeUndefined()
  })
})
