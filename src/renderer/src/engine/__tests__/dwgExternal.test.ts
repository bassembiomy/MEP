import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ParsedDxf } from '../dxfParser'
import { parseDwgWith } from '../dwgParser'
import { getNodeLibreDwg } from './helpers/libredwgNode'

/**
 * Third-party DWG files (LibreDWG's own test data, pinned commit, sha256 verified by `npm run corpus:fetch-dwg`).
 * They live in the gitignored .cache/dwg-external/ and are never vendored (GPL test data), so this suite skips itself
 * unless they were fetched. What it can claim: every file decodes without a crash or error diagnostic and gives a finite
 * extent, and the same drawing saved as R2000 ... R2018 imports with the same entities. What it cannot claim:
 * example_2004 ... example_2018 carry an AppInfo block that says "AutoCAD ... build O.48.M.294"; example_2000 and
 * sample_2000 (R2000) carry no AppInfo, so their authoring application is unverified.
 */
const manifest = JSON.parse(readFileSync(new URL('../../../../../scripts/cad-corpus/external-dwg.json', import.meta.url), 'utf8')) as {
  files: { name: string; sha256: string }[]
}
const dir = new URL('../../../../../.cache/dwg-external/', import.meta.url)
const sha256 = (name: string): string => createHash('sha256').update(readFileSync(new URL(name, dir))).digest('hex')
const present = manifest.files.every((f) => existsSync(new URL(f.name, dir)) && sha256(f.name) === f.sha256)

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

  it('reports the frozen layer of the R2000 / R2004 saves as hidden and names no other hidden layer in any version', async () => {
    for (const name of SAME_DRAWING) {
      const hidden = (await load(name)).hiddenLayers ?? []
      expect(hidden.every((l) => l === 'ADSK_SYSTEM_LIGHTS'), name).toBe(true)
    }
    expect((await load('example_2000.dwg')).hiddenLayers).toEqual(['ADSK_SYSTEM_LIGHTS'])
    expect((await load('example_2004.dwg')).hiddenLayers).toEqual(['ADSK_SYSTEM_LIGHTS'])
  })

  it('sample_2000 imports its six entities (3 lines, polyline, circle, text) with units declared', async () => {
    const parsed = await load('sample_2000.dwg')
    expect(byType(parsed)).toEqual({ LINE: 3, LWPOLYLINE: 1, CIRCLE: 1, TEXT: 1 })
    expect(parsed.insUnits).toBe(4)
  })
})

describe('external DWG files: availability', () => {
  it(present ? 'files present and sha256 verified' : 'files not fetched: run `npm run corpus:fetch-dwg` to enable the external suite', () => {
    expect(typeof present).toBe('boolean')
  })
})
