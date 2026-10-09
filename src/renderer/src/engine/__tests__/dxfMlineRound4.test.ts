import { describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { dxf, header, layer, rawRecord } from './fixtures/dxfBuilder'

type V = { x: number; y: number; z?: number; dir?: [number, number, number?]; miter?: [number, number, number?] }
interface MlineOpts {
  verts: V[]; offsets?: number[]; style?: string; scale?: number; flags?: number; startZ?: number; closed?: boolean
}
/** A hand-made MLINE record following the DXF reference (10 start, 11 vertex, 12 direction, 13 miter, 74/41 element parameters). */
function mline(o: MlineOpts): string {
  const offsets = o.offsets ?? [-1, 1]
  const pairs: [number, string | number][] = [[0, 'MLINE'], [8, 'WALL'], [100, 'AcDbMline'], [2, o.style ?? 'STANDARD'], [40, o.scale ?? 1], [70, 0],
    [71, (o.flags ?? 0) | (o.closed ? 2 : 0) | 1], [72, o.verts.length], [73, offsets.length],
    [10, o.verts[0].x], [20, o.verts[0].y], [30, o.startZ ?? o.verts[0].z ?? 0], [210, 0], [220, 0], [230, 1]]
  for (const v of o.verts) {
    const d = v.dir ?? [1, 0, 0], m = v.miter ?? [0, 1, 0]
    pairs.push([11, v.x], [21, v.y], [31, v.z ?? 0], [12, d[0]], [22, d[1]], [32, d[2] ?? 0], [13, m[0]], [23, m[1]], [33, m[2] ?? 0])
    for (const off of offsets) pairs.push([74, 1], [41, off], [75, 0])
  }
  return rawRecord(...pairs)
}
const style = (name: string, flags: number, offsets: number[]) =>
  rawRecord([0, 'MLINESTYLE'], [2, name], [70, flags], [71, offsets.length], ...offsets.flatMap((off): [number, number][] => [[49, off], [62, 0]]))
function file(entities: string[], objects: string[] = []): string {
  const base = dxf({ header: header({ insunits: 4 }), layers: [layer('WALL')], blocks: [], entities })
  if (!objects.length) return base
  return base.replace('0\nSECTION\n2\nENTITIES', `0\nSECTION\n2\nOBJECTS\n${objects.join('\n')}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES`)
}
const codes = (p: ReturnType<typeof parseDxfText>) => p.diagnostics?.map(d => d.code) ?? []

describe('R2: MLINE elevation', () => {
  const straight = (z: number, extra: Partial<MlineOpts> = {}) =>
    mline({ verts: [{ x: 0, y: 0, z }, { x: 5000, y: 0, z }], ...extra })
  it('keeps a constant-elevation MLINE (30 = 31 = z) at that elevation with one diagnostic', () => {
    const p = parseDxfText(file([straight(3000)]))
    expect(p.entities).toHaveLength(2)
    expect(p.entities.every(e => (e as { elevation?: number }).elevation === 3000)).toBe(true)
    expect(codes(p)).toEqual(['ELEVATED_GEOMETRY_PROJECTED'])
  })
  it('an MLINE at z = 0 raises no elevation diagnostic', () => {
    expect(codes(parseDxfText(file([straight(0)])))).toEqual([])
  })
  it('drops an MLINE whose vertex Z varies', () => {
    const p = parseDxfText(file([mline({ verts: [{ x: 0, y: 0, z: 0 }, { x: 5000, y: 0, z: 100 }] })]))
    expect(p.entities).toHaveLength(0)
    expect(codes(p)).toContain('UNSUPPORTED_ELEVATION')
  })
  it('drops an MLINE whose start point Z differs from its vertex Z', () => {
    const p = parseDxfText(file([straight(3000, { startZ: 0 })]))
    expect(p.entities).toHaveLength(0)
    expect(codes(p)).toContain('UNSUPPORTED_ELEVATION')
  })
  it('direction and miter Z components must be 0 (they are vectors, not elevations)', () => {
    const bad = (key: 'dir' | 'miter') => parseDxfText(file([mline({ verts: [
      { x: 0, y: 0, z: 3000, [key]: [key === 'dir' ? 1 : 0, key === 'dir' ? 0 : 1, 3000] }, { x: 5000, y: 0, z: 3000 }] })]))
    for (const key of ['dir', 'miter'] as const) {
      const p = bad(key)
      expect(p.entities).toHaveLength(0)
      expect(codes(p)).toContain('UNSUPPORTED_ELEVATION')
    }
  })
  it('the elevation diagnostic is raised once per MLINE, not once per exploded part (caps and joints included)', () => {
    const p = parseDxfText(file([mline({ verts: [{ x: 0, y: 0, z: 3000 }, { x: 5000, y: 0, z: 3000 }, { x: 5000, y: 4000, z: 3000, dir: [0, 1], miter: [-1, 0] }], style: 'W' })],
      [style('W', 2 | 16 | 256, [-1, 1])]))
    expect(p.entities.length).toBeGreaterThan(4)
    expect(codes(p).filter(c => c === 'ELEVATED_GEOMETRY_PROJECTED')).toHaveLength(1)
  })
})

describe('MLINE caps, miters and odd records', () => {
  const W = style('W', 16 | 256, [-1, 1]) // square start + end caps, no joint lines
  const two = (flags: number) => file([mline({ verts: [{ x: 0, y: 0 }, { x: 5000, y: 0 }], style: 'W', flags })], [W])
  const count = (flags: number) => parseDxfText(two(flags)).entities.length

  it('baseline: two elements plus a start and an end cap (two lines each)', () => {
    expect(count(0)).toBe(6)
  })
  it('entity flag bit 4 suppresses the start cap and bit 8 the end cap (AutoCAD; ezdxf ignores these bits)', () => {
    expect(count(4)).toBe(4)
    expect(count(8)).toBe(4)
    expect(count(4 | 8)).toBe(2)
  })

  it('an extremely acute joint raises MLINE_LONG_MITER once; a moderate corner does not', () => {
    const corner = (mx: number, my: number) => parseDxfText(file([mline({
      verts: [{ x: 0, y: 0 }, { x: 5000, y: 0, miter: [mx, my] }, { x: 0, y: 100, dir: [-1, 0], miter: [0, 1] }], offsets: [-100, 100] })]))
    expect(codes(corner(0, 1.5))).toEqual([])
    const p = corner(0, 60) // |miter| 60 x offset 100 = 6000 > 10 x the largest offset (1000)
    expect(codes(p).filter(c => c === 'MLINE_LONG_MITER')).toHaveLength(1)
    expect(p.entities.length).toBeGreaterThan(0) // still imported: the geometry is the file's, only flagged
  })
  it('acute angles import their element lines (a 20 degree turn, miter 1/sin(10 deg))', () => {
    const a = (20 * Math.PI) / 180, m = 1 / Math.sin(a / 2)
    const p = parseDxfText(file([mline({ verts: [{ x: 0, y: 0 }, { x: 5000, y: 0, miter: [0, m] }, { x: 5000 - 5000 * Math.cos(a), y: 5000 * Math.sin(a), dir: [-Math.cos(a), Math.sin(a)], miter: [0, 1] }] })]))
    expect(p.entities).toHaveLength(4)
    expect(codes(p)).toEqual([])
  })
  it('a zero-length segment (repeated vertex) never crashes and keeps the other segments', () => {
    const p = parseDxfText(file([mline({ verts: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5000, y: 0 }] })]))
    expect(p.entities.length).toBeGreaterThanOrEqual(2)
    expect(p.entities.every(e => [e.x, e.y, ...(e.points ?? [])].every(Number.isFinite))).toBe(true)
  })
  it('a negative scale factor (group 40) does not change the geometry: the vertex data already carries the final offsets', () => {
    const geom = (scale: number) => parseDxfText(file([mline({ verts: [{ x: 0, y: 0 }, { x: 5000, y: 0 }], scale })])).entities
    expect(geom(-2)).toEqual(geom(2))
  })
  it('a style whose element count differs from the entity warns MLINE_STYLE_MISMATCH instead of silently dropping the caps', () => {
    const p = parseDxfText(file([mline({ verts: [{ x: 0, y: 0 }, { x: 5000, y: 0 }], style: 'W3' })], [style('W3', 16 | 256, [-1, 0, 1])]))
    expect(p.entities).toHaveLength(2)
    expect(codes(p)).toEqual(['MLINE_STYLE_MISMATCH'])
  })
  it('a style without caps or miters and a different element count raises nothing', () => {
    const p = parseDxfText(file([mline({ verts: [{ x: 0, y: 0 }, { x: 5000, y: 0 }], style: 'W3' })], [style('W3', 0, [-1, 0, 1])]))
    expect(codes(p)).toEqual([])
  })
})
