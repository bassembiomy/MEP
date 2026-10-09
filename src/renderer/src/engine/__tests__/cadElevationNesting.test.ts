import { describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { parseDwgDatabase } from '../cad/dwgGeometry'
import { dxf, header, layer } from './fixtures/dxfBuilder'
import type { DxfEntity } from '../../store/projectStore'

type Pair = [number, string | number]
const rec = (...pairs: Pair[]) => pairs.map(([c, v]) => `${c}\n${v}`).join('\n')
const elevationOf = (e: DxfEntity) => (e as DxfEntity & { elevation?: number }).elevation
const lineAt = (z: number | undefined, extra: Pair[] = []) =>
  rec([0, 'LINE'], [8, 'A-WALL'], [10, 0], [20, 0], ...(z === undefined ? [] : [[30, z] as Pair]), [11, 5], [21, 0], ...(z === undefined ? [] : [[31, z] as Pair]), ...extra)
const circleAt = (z: number, nz = 1) => rec([0, 'CIRCLE'], [8, 'A-WALL'], [10, 0], [20, 0], [30, z], [40, 3], ...(nz === 1 ? [] : [[210, 0], [220, 0], [230, nz] as Pair]))
const blockOf = (name: string, body: string[], baseZ = 0) =>
  [rec([0, 'BLOCK'], [8, '0'], [2, name], [70, 0], [10, 0], [20, 0], [30, baseZ]), ...body, rec([0, 'ENDBLK'], [8, '0'])].join('\n')
const insertOf = (name: string, o: { z?: number; zs?: number; nz?: number; rotation?: number; sx?: number; sy?: number } = {}) =>
  rec([0, 'INSERT'], [8, 'A-WALL'], [2, name], [10, 0], [20, 0], [30, o.z ?? 0], [41, o.sx ?? 1], [42, o.sy ?? 1], [43, o.zs ?? 1], [50, o.rotation ?? 0],
    ...(o.nz === undefined ? [] : [[210, 0], [220, 0], [230, o.nz] as Pair]))
const parse = (blocks: string[], entities: string[]) =>
  parseDxfText(dxf({ header: header({ insunits: 4 }), layers: [layer('A-WALL')], blocks, entities }))
const elevations = (p: ReturnType<typeof parse>) => p.entities.map(elevationOf)

describe('DXF INSERT elevation composition', () => {
  it('adds the child Z to the INSERT Z', () => {
    expect(elevations(parse([blockOf('B', [lineAt(3)])], [insertOf('B', { z: 2 })]))).toEqual([5])
  })
  it('a -Z extrusion INSERT negates the whole OCS elevation (insert Z plus child Z)', () => {
    expect(elevations(parse([blockOf('B', [lineAt(3)])], [insertOf('B', { z: 2, nz: -1 })]))).toEqual([-5])
  })
  it('a child with its own -Z extrusion contributes its negated Z inside the block', () => {
    expect(elevations(parse([blockOf('B', [circleAt(3, -1)])], [insertOf('B', { z: 2 })]))).toEqual([-1])
    expect(elevations(parse([blockOf('B', [circleAt(3, -1)])], [insertOf('B', { z: 2, nz: -1 })]))).toEqual([1])
  })
  it('scales the child Z by the INSERT Z scale (group 43)', () => {
    expect(elevations(parse([blockOf('B', [lineAt(3)])], [insertOf('B', { z: 1, zs: 2 })]))).toEqual([7])
    expect(elevations(parse([blockOf('B', [lineAt(3)])], [insertOf('B', { zs: -1 })]))).toEqual([-3])
  })
  it('a flat block with a Z scale stays flat', () => {
    const p = parse([blockOf('B', [lineAt(undefined)])], [insertOf('B', { zs: 0.001, sx: 0.001, sy: 0.001 })])
    expect(p.entities).toHaveLength(1)
    expect(elevations(p)).toEqual([undefined])
  })
  it('subtracts the block base Z (BLOCK group 30)', () => {
    expect(elevations(parse([blockOf('B', [lineAt(3)], 1)], [insertOf('B', { z: 5 })]))).toEqual([7])
    expect(elevations(parse([blockOf('B', [lineAt(1)], 1)], [insertOf('B', { z: 5 })]))).toEqual([5])
    expect(elevations(parse([blockOf('B', [lineAt(1)], 1)], [insertOf('B', { z: 5, zs: 3 })]))).toEqual([5])
  })
  it('a base Z on a flat block shifts its geometry down', () => {
    expect(elevations(parse([blockOf('B', [lineAt(undefined)], 2)], [insertOf('B')]))).toEqual([-2])
  })
  it('composes nested INSERTs with rotation, scale and base Z', () => {
    const blocks = [
      blockOf('INNER', [lineAt(3)], 1),
      blockOf('OUTER', [insertOf('INNER', { z: 2, zs: 2, rotation: 30, sx: 2 })], 0)
    ]
    // inner: 2 + 2 * (3 - 1) = 6 in OUTER; outer: 10 + 6 = 16
    expect(elevations(parse(blocks, [insertOf('OUTER', { z: 10, rotation: 90 })]))).toEqual([16])
    // outer Z scale 0.5 and base Z 1: 10 + 0.5 * (6 - 1) = 12.5
    const based = [blocks[0], blockOf('OUTER', [insertOf('INNER', { z: 2, zs: 2 })], 1)]
    expect(elevations(parse(based, [insertOf('OUTER', { z: 10, zs: 0.5 })]))).toEqual([12.5])
    // -Z extrusion on the outer INSERT negates the nested result
    expect(elevations(parse(blocks, [insertOf('OUTER', { z: 10, nz: -1 })]))).toEqual([-16])
  })
  it('reports ELEVATED_GEOMETRY_PROJECTED on the INSERT itself', () => {
    const p = parse([blockOf('B', [lineAt(undefined)])], [insertOf('B', { z: 4 })])
    const d = p.diagnostics!.filter((x) => x.code === 'ELEVATED_GEOMETRY_PROJECTED')
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ entityType: 'INSERT', severity: 'warning' })
    expect(d[0].message).toContain('INSERT B')
    expect(d[0].message).toContain('4')
    const flat = parse([blockOf('B', [lineAt(undefined)])], [insertOf('B')])
    expect(flat.diagnostics!.some((x) => x.code === 'ELEVATED_GEOMETRY_PROJECTED')).toBe(false)
  })
  it('reports the world elevation for a -Z extrusion INSERT', () => {
    const p = parse([blockOf('B', [lineAt(undefined)])], [insertOf('B', { z: 4, nz: -1 })])
    expect(p.diagnostics!.find((x) => x.entityType === 'INSERT' && x.code === 'ELEVATED_GEOMETRY_PROJECTED')!.message).toContain('-4')
  })
})

describe('DXF varying Z detection (P2)', () => {
  const vertex = (x: number, y: number, z?: number) => rec([0, 'VERTEX'], [8, 'A-WALL'], [10, x], [20, y], ...(z === undefined ? [] : [[30, z] as Pair]))
  const polyline = (zs: (number | undefined)[]) =>
    [rec([0, 'POLYLINE'], [8, 'A-WALL'], [66, 1], [70, 0]), ...zs.map((z, i) => vertex(i * 10, i % 2 ? 5 : 0, z)), rec([0, 'SEQEND'], [8, 'A-WALL'])].join('\n')
  it('drops a 2D POLYLINE that mixes Z=0 and Z=5', () => {
    const p = parse([], [polyline([0, 5, 5])])
    expect(p.entities).toHaveLength(0)
    expect(p.diagnostics!.map((d) => d.code)).toContain('UNSUPPORTED_ELEVATION')
    expect(parse([], [polyline([5, 5, 0])]).entities).toHaveLength(0)
  })
  it('keeps a POLYLINE whose vertices share one Z and records the elevation', () => {
    const p = parse([], [polyline([5, 5, 5])])
    expect(p.entities).toHaveLength(1)
    expect(elevationOf(p.entities[0])).toBe(5)
  })
  it('keeps a flat POLYLINE', () => {
    const p = parse([], [polyline([0, 0, 0])])
    expect(p.entities).toHaveLength(1)
    expect(elevationOf(p.entities[0])).toBeUndefined()
  })
  const alignedText = (z30: number | undefined, z31: number) =>
    rec([0, 'TEXT'], [8, 'A-WALL'], [10, 1], [20, 1], ...(z30 === undefined ? [] : [[30, z30] as Pair]), [40, 2], [1, 'CH 2.70'], [72, 1], [11, 2], [21, 1], [31, z31])
  it('keeps elevated aligned TEXT (group 31 feeds the Z set)', () => {
    const p = parse([], [alignedText(4, 4)])
    expect(p.entities).toHaveLength(1)
    expect(elevationOf(p.entities[0])).toBe(4)
  })
  it('drops aligned TEXT whose two alignment points differ in Z, or whose first Z is missing', () => {
    expect(parse([], [alignedText(4, 0)]).entities).toHaveLength(0)
    expect(parse([], [alignedText(undefined, 4)]).entities).toHaveLength(0)
  })
  it('still keeps flat aligned TEXT', () => {
    expect(parse([], [alignedText(undefined, 0)]).entities).toHaveLength(1)
  })
})

describe('DWG INSERT elevation composition', () => {
  const pt = (x: number, y: number, z = 0) => ({ x, y, z })
  const ln = (z?: number) => ({ type: 'LINE', handle: 'L', startPoint: pt(0, 0, z), endPoint: pt(5, 0, z) })
  const ins = (name: string, o: { z?: number; zScale?: number; rotation?: number; xScale?: number; yScale?: number } = {}) =>
    ({ type: 'INSERT', handle: `I-${name}`, name, insertionPoint: pt(0, 0, o.z ?? 0), xScale: o.xScale ?? 1, yScale: o.yScale ?? 1, zScale: o.zScale, rotation: o.rotation ?? 0 })
  const db = (entities: unknown[], blocks: unknown[]) => ({ header: { INSUNITS: 4 }, entities, tables: { BLOCK_RECORD: { entries: blocks } } })
  const els = (r: ReturnType<typeof parseDwgDatabase>) => r.entities.map(elevationOf)
  it('adds the child Z to the INSERT Z (inherited elevation)', () => {
    const r = parseDwgDatabase(db([ins('B', { z: 2 })], [{ name: 'B', entities: [ln(3)] }]))
    expect(els(r)).toEqual([5])
  })
  it('a flat child inherits the INSERT elevation', () => {
    expect(els(parseDwgDatabase(db([ins('B', { z: 2 })], [{ name: 'B', entities: [ln()] }])))).toEqual([2])
  })
  it('applies Z scale and block base Z like DXF', () => {
    expect(els(parseDwgDatabase(db([ins('B', { z: 1, zScale: 2 })], [{ name: 'B', entities: [ln(3)] }])))).toEqual([7])
    expect(els(parseDwgDatabase(db([ins('B', { z: 5 })], [{ name: 'B', basePoint: pt(0, 0, 1), entities: [ln(3)] }])))).toEqual([7])
    expect(els(parseDwgDatabase(db([ins('B', { z: 5 })], [{ name: 'B', basePoint: pt(0, 0, 1), entities: [ln()] }])))).toEqual([4])
  })
  it('composes nested INSERTs with rotation and base Z', () => {
    const blocks = [
      { name: 'INNER', basePoint: pt(0, 0, 1), entities: [ln(3)] },
      { name: 'OUTER', entities: [ins('INNER', { z: 2, zScale: 2, rotation: Math.PI / 6, xScale: 2 })] }
    ]
    expect(els(parseDwgDatabase(db([ins('OUTER', { z: 10, rotation: Math.PI / 2 })], blocks)))).toEqual([16])
  })
  it('reports the INSERT elevated-geometry-projected diagnostic with the INSERT elevation and a stored elevation including the inherited offset', () => {
    const r = parseDwgDatabase(db([ins('B', { z: 2 })], [{ name: 'B', entities: [ln(3)] }]))
    const diagnostics = r.diagnostics!.filter((d) => d.code === 'elevated-geometry-projected')
    expect(diagnostics.some((d) => d.entityType === 'INSERT' && d.message.includes('INSERT B') && d.message.includes('2'))).toBe(true)
    const lineDiag = diagnostics.find((d) => d.entityType === 'LINE')!
    expect(lineDiag.message).toContain('elevation 5')
  })
})
