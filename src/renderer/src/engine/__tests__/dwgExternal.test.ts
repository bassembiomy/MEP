import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ParsedDxf } from '../dxfParser'
import { parseDwgWith } from '../dwgParser'
import { getNodeLibreDwg } from './helpers/libredwgNode'

/**
 * Third-party DWG files (LibreDWG's own test data, pinned commit, sha256 verified by `npm run corpus:fetch-dwg`).
 * They live in the gitignored .cache/dwg-external/ and are never vendored (GPL test data), so this suite skips itself
 * unless they were fetched (REQUIRE_EXTERNAL_DWG=1 turns that skip into a failure). What it can claim: every file decodes without a crash or error diagnostic and gives a finite
 * extent, and the same drawing saved as R2000 ... R2018 imports with the same entities. What it cannot claim:
 * example_2004 ... example_2018 carry an AppInfo block that says "AutoCAD ... build O.48.M.294"; example_2000 and
 * sample_2000 (R2000) carry no AppInfo, so their authoring application is unverified.
 */
const manifest = JSON.parse(readFileSync(new URL('../../../../../scripts/cad-corpus/external-dwg.json', import.meta.url), 'utf8')) as {
  files: { name: string; sha256: string }[]
}
const dir = new URL('../../../../../.cache/dwg-external/', import.meta.url)
const sha256 = (name: string): string => createHash('sha256').update(readFileSync(new URL(name, dir))).digest('hex')
const missing = manifest.files.filter((f) => !existsSync(new URL(f.name, dir)) || sha256(f.name) !== f.sha256).map((f) => f.name)
const present = missing.length === 0
/** CI / release gate: REQUIRE_EXTERNAL_DWG=1 turns "files not fetched" from a silent skip into a failure. */
const REQUIRE_EXTERNAL = process.env.REQUIRE_EXTERNAL_DWG === '1'

const SAME_DRAWING = ['example_2000.dwg', 'example_2004.dwg', 'example_2007.dwg', 'example_2010.dwg', 'example_2013.dwg', 'example_2018.dwg']
const cache = new Map<string, Promise<ParsedDxf>>()
function load(name: string): Promise<ParsedDxf> {
  let hit = cache.get(name)
  if (!hit) {
    hit = getNodeLibreDwg().then((lw) => parseDwgWith(lw, new Uint8Array(readFileSync(new URL(name, dir)))))
    cache.set(name, hit)
  }
  return hit
}
const byType = (p: ParsedDxf): Record<string, number> => {
  const h: Record<string, number> = {}
  for (const e of p.entities) h[e.type] = (h[e.type] ?? 0) + 1
  return h
}

describe.skipIf(!present)('external DWG files (LibreDWG test data, fetched on demand)', () => {
  it.each(manifest.files.map((f) => f.name))('%s decodes without a crash, error diagnostics or a non-finite extent', async (name) => {
    const parsed = await load(name)
    expect(parsed.entities.length).toBeGreaterThan(0)
    expect((parsed.diagnostics ?? []).filter((d) => d.severity === 'error')).toEqual([])
    expect(Object.values(parsed.bbox).every(Number.isFinite)).toBe(true)
    expect(parsed.bbox.maxX).toBeGreaterThan(parsed.bbox.minX)
    expect(parsed.bbox.maxY).toBeGreaterThan(parsed.bbox.minY)
    for (const e of parsed.entities) expect(Number.isFinite(e.x ?? 0) && Number.isFinite(e.y ?? 0), `${e.type} ${e.handle}`).toBe(true)
  })

  it('the same example drawing saved as R2000, R2004, R2007, R2010, R2013 and R2018 imports with the same entities', async () => {
    const parsed = await Promise.all(SAME_DRAWING.map(load))
    const reference = parsed[0]
    expect(byType(reference)).toEqual({ LINE: 16, LWPOLYLINE: 16, ARC: 2, ELLIPSE: 1, MTEXT: 1, TEXT: 4, CIRCLE: 8 })
    for (const [i, p] of parsed.entries()) {
      expect(byType(p), SAME_DRAWING[i]).toEqual(byType(reference))
      expect(p.entities.map((e) => `${e.type}|${e.layer}`).sort(), SAME_DRAWING[i]).toEqual(reference.entities.map((e) => `${e.type}|${e.layer}`).sort())
      expect(p.blockReferences?.map((b) => b.name).sort(), SAME_DRAWING[i]).toEqual(reference.blockReferences?.map((b) => b.name).sort())
      expect(p.insUnits, SAME_DRAWING[i]).toBe(reference.insUnits)
      for (const k of ['minX', 'maxX', 'minY', 'maxY'] as const) expect(p.bbox[k], `${SAME_DRAWING[i]} bbox.${k}`).toBeCloseTo(reference.bbox[k], 3)
      expect(p.entities.map((e) => e.text).filter(Boolean).sort(), SAME_DRAWING[i]).toEqual(reference.entities.map((e) => e.text).filter(Boolean).sort())
    }
  })

  // The R2000 / R2004 saves carry the layer *ADSK_SYSTEM_LIGHTS frozen (native flag0 1017 in example_2004, bit 1). From R2007
  // on the same layer is stored unfrozen (native dwgread flag0 1008), so no layer of those saves is hidden. Exact lists, not
  // a subset test, so an empty or an over-eager result fails.
  it.each([
    ['example_2000.dwg', ['ADSK_SYSTEM_LIGHTS']],
    ['example_2004.dwg', ['ADSK_SYSTEM_LIGHTS']],
    ['example_2007.dwg', []],
    ['example_2010.dwg', []],
    ['example_2013.dwg', []],
    ['example_2018.dwg', []]
  ])('%s hides exactly %j', async (name, expected) => {
    expect((await load(name)).hiddenLayers ?? []).toEqual(expected)
  })

  // libredwg-web reports DWG splineflags in `flag` (9 = fit-point method in R2000-R2013); bit 0 is NOT "closed". These two
  // splines are open in the drawing and must stay open in every version.
  it.each(SAME_DRAWING)('%s imports its two open fit-point splines (handles 16E and 894) as open polylines', async (name) => {
    const parsed = await load(name)
    const splines = parsed.entities.filter((e) => /^SPLINE sampled/.test(e.geometryApproximation ?? ''))
    expect(splines.map((e) => e.handle).sort()).toEqual(['16E', '894'])
    for (const spline of splines) expect(spline.closed, `${name} ${spline.handle}`).toBe(false)
  })

  // libredwg-web pushes every top-level INSERT's attributes into db.entities as well as INSERT.attribs. They must be drawn
  // once (via the INSERT) and must not be reported as unsupported entities (the DXF path never sees them as records).
  it.each(SAME_DRAWING)('%s draws the INSERT attributes (handles 192 and 757) as TEXT and warns about no ATTRIB', async (name) => {
    const parsed = await load(name)
    const texts = parsed.entities.filter((e) => e.type === 'TEXT' && (e.handle === '192' || e.handle === '757'))
    expect(texts.map((e) => e.handle).sort()).toEqual(['192', '757'])
    for (const t of texts) expect((t.text ?? '').trim().length, `${name} ${t.handle}`).toBeGreaterThan(0)
    expect((parsed.diagnostics ?? []).filter((d) => d.entityType === 'ATTRIB')).toEqual([])
  })

  it('sample_2000 imports its six entities (3 lines, polyline, circle, text) with units declared', async () => {
    const parsed = await load('sample_2000.dwg')
    expect(byType(parsed)).toEqual({ LINE: 3, LWPOLYLINE: 1, CIRCLE: 1, TEXT: 1 })
    expect(parsed.insUnits).toBe(4)
  })
})

describe('external DWG files: availability', () => {
  it.runIf(REQUIRE_EXTERNAL)('every external file is fetched and sha256 verified (REQUIRE_EXTERNAL_DWG=1)', () => {
    expect(missing, 'run `npm run corpus:fetch-dwg`').toEqual([])
  })
})
