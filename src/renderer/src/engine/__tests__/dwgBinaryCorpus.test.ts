import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeDxfBytes, parseDxfText, type ParsedDxf } from '../dxfParser'
import { Dwg_File_Type } from '@mlightcad/libredwg-web'
import { parseDwgWith } from '../dwgParser'
import { getNodeLibreDwg } from './helpers/libredwgNode'
import { recognizeCadRooms } from '../cad/roomRecognition'
import type { DxfEntity } from '../../store/projectStore'

/**
 * Binary DWG corpus: real DWG files written by LibreDWG 0.13.3 `dxf2dwg` from R2000 ezdxf documents (see
 * scripts/cad-corpus/generate_dwg_corpus.py), read back by the libredwg-web WASM build the app ships, and compared with
 * (a) the same drawing imported from its DXF twin and (b) ground truth derived from the ezdxf construction geometry
 * (fixtures/corpus/dwg/*manifest.json). The writer's own defects are documented in dwg-manifest.json `writerCheck.exclusions`
 * (MTEXT height, TEXT elevation) and are excluded from the comparisons, never papered over.
 *
 * KNOWN-GAP POLICY (same as cadRealisticCorpus.test.ts): an assertion that fails because of a real importer defect that
 * cannot be fixed is declared with gap(...) (= it.fails unless CORPUS_SHOW_GAPS=1).
 */
const gap = process.env.CORPUS_SHOW_GAPS ? it : it.fails

const dir = new URL('./fixtures/corpus/dwg/', import.meta.url)
interface DwgManifestFile {
  twin: string
  dwgVersion: string
  sha256: string
  layers: Record<string, { frozen: boolean; off: boolean; locked: boolean; color: number }>
  blocks: string[]
  insunits: number
  measurement: number
  ezdxfCounts: { modelSpaceByType: Record<string, number>; insertAttributes: number }
  writerCheck: { status: string; exclusions: Record<string, unknown> }
}
interface TruthRoom { name: string; polygon: number[]; areaSqFt: number }
interface TwinTruth {
  expected: { cadUnit: string; unitsConfidence: string }
  insunits: number
  measurement: number
  unitsPerFoot: number
  expectedEntityCount: number
  sourceUnsupported: Record<string, number>
  rooms: TruthRoom[]
  hiddenLayers?: string[]
  levels?: Record<string, TruthRoom[]>
  elevatedTopLevelEntities?: number
  nonPlanarLines?: number
}
const dwgManifest = JSON.parse(readFileSync(new URL('dwg-manifest.json', dir), 'utf8')) as {
  libredwg: { version: string }
  files: Record<string, DwgManifestFile>
}
const twinManifest = JSON.parse(readFileSync(new URL('twins-manifest.json', dir), 'utf8')).files as Record<string, TwinTruth>
const dwgNames = Object.keys(dwgManifest.files).filter((n) => n.endsWith('-r2000.dwg'))
const STEM = (n: string): string => n.replace(/-r2000\.dwg$/, '')
const NOISE = 'noise-dim-hatch-spline-paper-r2000.dwg'
const ELEVATED = 'elevated-levels-r2000.dwg'

const dwgCache = new Map<string, Promise<ParsedDxf>>()
function loadDwg(name: string): Promise<ParsedDxf> {
  let hit = dwgCache.get(name)
  if (!hit) {
    hit = getNodeLibreDwg().then((lw) => parseDwgWith(lw, new Uint8Array(readFileSync(new URL(name, dir)))))
    dwgCache.set(name, hit)
  }
  return hit
}
const dxfCache = new Map<string, ParsedDxf>()
function loadTwin(name: string): ParsedDxf {
  const twin = dwgManifest.files[name].twin
  let hit = dxfCache.get(twin)
  if (!hit) {
    hit = parseDxfText(decodeDxfBytes(new Uint8Array(readFileSync(new URL(twin, dir)))))
    dxfCache.set(twin, hit)
  }
  return hit
}

// ------------------------------------------------------------------------------------------------ helpers
const histogram = (items: Iterable<string>): Record<string, number> => {
  const h: Record<string, number> = {}
  for (const k of items) h[k] = (h[k] ?? 0) + 1
  return h
}
const byType = (p: ParsedDxf): Record<string, number> => histogram(p.entities.map((e) => e.type))
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
const tolerant = (a: number, b: number, rel = 1e-9): boolean => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b))

type Sig = { key: string; nums: number[] }
/** Type, layer and geometry of one entity; numbers kept apart so they can be compared with a relative tolerance. */
function signature(e: DxfEntity, opts: { text?: boolean } = {}): Sig {
  const any = e as DxfEntity & Record<string, unknown>
  const nums: number[] = []
  for (const f of ['x', 'y', 'radius', 'startAngleDeg', 'endAngleDeg', 'rotationDeg', 'startParam', 'endParam'])
    if (typeof any[f] === 'number') nums.push(any[f] as number)
  if (Array.isArray(any.points)) nums.push(...(any.points as number[]))
  if (Array.isArray(any.bulges)) nums.push(...(any.bulges as number[]))
  if (any.majorAxis) nums.push((any.majorAxis as { x: number }).x, (any.majorAxis as { y: number }).y)
  const text = opts.text !== false && typeof any.text === 'string' ? `|${any.text}` : ''
  return { key: `${e.type}|${e.layer}|${any.closed ? 'closed' : 'open'}|${nums.length}${text}`, nums }
}
/** Equal multisets of signatures (geometry within a relative 1e-9). Returns a description of the first difference. */
function diffSignatures(a: Sig[], b: Sig[]): string | null {
  const order = (s: Sig[]): Sig[] =>
    [...s].sort((p, q) => (p.key === q.key ? p.nums.map((n) => n.toPrecision(6)).join(',').localeCompare(q.nums.map((n) => n.toPrecision(6)).join(',')) : p.key.localeCompare(q.key)))
  const x = order(a)
  const y = order(b)
  if (x.length !== y.length) return `counts differ: ${x.length} vs ${y.length}`
  for (let i = 0; i < x.length; i++) {
    if (x[i].key !== y[i].key) return `entity ${i}: ${x[i].key} vs ${y[i].key}`
    for (let j = 0; j < x[i].nums.length; j++)
      if (!tolerant(x[i].nums[j], y[i].nums[j])) return `entity ${i} (${x[i].key}) value ${j}: ${x[i].nums[j]} vs ${y[i].nums[j]}`
  }
  return null
}
/** What the importer does today with record types the DWG path does not map; see the per-type tests below. */
const isSupportedInPlan = (e: DxfEntity): boolean => ['LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'TEXT', 'MTEXT'].includes(e.type)

const hasExclusion = (name: string, key: string): boolean => key in dwgManifest.files[name].writerCheck.exclusions
const isAttribTag = (e: DxfEntity): boolean => e.type === 'TEXT' && e.sourceBlock === undefined && /^D\d\d$/.test(e.text ?? '')
const isSplinePolyline = (e: DxfEntity): boolean => e.type === 'LWPOLYLINE' && /^SPLINE sampled/.test(e.geometryApproximation ?? '')
/**
 * The DXF twin's entities without what the DWG path cannot receive from this reader/writer pair, each documented:
 *  - one TEXT per visible INSERT attribute: libredwg-web 0.7.7 returns `attribs: []` for every INSERT of an R2000 file
 *    (gap test below);
 *  - the sampled SPLINE when LibreDWG 0.13.3 dxf2dwg wrote an empty spline (writer exclusion SPLINE.points).
 */
function dxfComparable(name: string): DxfEntity[] {
  return loadTwin(name).entities.filter((e) => !isAttribTag(e) && !(hasExclusion(name, 'SPLINE.points') && isSplinePolyline(e)))
}

describe('DWG binary corpus (LibreDWG-written R2000 files, libredwg-web reader)', () => {
  it('has the pinned writer recorded and every committed DWG passes its writer check', () => {
    expect(dwgManifest.libredwg.version).toBe('dxf2dwg 0.13.3')
    expect(dwgNames.length).toBeGreaterThanOrEqual(5)
    for (const [name, f] of Object.entries(dwgManifest.files)) {
      expect(f.writerCheck.status, name).toMatch(/^pass/)
      expect(f.sha256, name).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  describe.each(dwgNames)('%s', (name) => {
    const meta = dwgManifest.files[name]
    const truth = twinManifest[meta.twin]

    it('decodes with no error-severity diagnostics', async () => {
      const parsed = await loadDwg(name)
      expect((parsed.diagnostics ?? []).filter((d) => d.severity === 'error')).toEqual([])
      expect(parsed.entities.length).toBeGreaterThan(0)
    })

    it('reports the same units as its DXF twin and as the ezdxf ground truth', async () => {
      const dwg = await loadDwg(name)
      const dxf = loadTwin(name)
      expect(dwg.insUnits).toBe(dxf.insUnits)
      expect(dwg.cadUnit).toBe(dxf.cadUnit)
      expect(dwg.unitsConfidence).toBe(dxf.unitsConfidence)
      expect(dwg.cadUnit).toBe(truth.expected.cadUnit)
      expect(dwg.unitsConfidence).toBe(truth.expected.unitsConfidence)
      expect(dwg.measurement).toBe(dxf.measurement)
      expect(dwg.suggestedScaleImperial).toBeCloseTo(truth.unitsPerFoot, 9)
    })

    it('draws on the same layers as its DXF twin', async () => {
      const dwg = await loadDwg(name)
      expect([...new Set(dwg.entities.map((e) => e.layer))].sort()).toEqual([...new Set(dxfComparable(name).map((e) => e.layer))].sort())
    })

    it('hides the frozen and switched-off layers like the DXF twin and the ground truth', async () => {
      const dwg = await loadDwg(name)
      const dxf = loadTwin(name)
      expect(dwg.hiddenLayers ?? []).toEqual(dxf.hiddenLayers ?? [])
      expect(dwg.hiddenLayers ?? []).toEqual(truth.hiddenLayers ?? [])
    })

    it('imports the manifest entity count and the same per-type counts as its DXF twin', async () => {
      const dwg = await loadDwg(name)
      const splines = hasExclusion(name, 'SPLINE.points') ? 0 : (truth.sourceUnsupported.SPLINE ?? 0)
      expect(dwg.entities.filter(isSupportedInPlan)).toHaveLength(truth.expectedEntityCount + splines)
      expect(byType(dwg)).toEqual(histogram(dxfComparable(name).map((e) => e.type)))
    })

    if (truth.sourceUnsupported.ATTRIB) {
      gap('draws one TEXT per visible INSERT attribute like the DXF path (libredwg-web returns attribs: [] for R2000 INSERTs)', async () => {
        const dwg = await loadDwg(name)
        expect(dwg.entities.filter(isAttribTag)).toHaveLength(truth.sourceUnsupported.ATTRIB!)
      })
    }

    it('imports the same multiset of entities (type, layer, geometry within 1e-9 relative, text) as its DXF twin', async () => {
      const dwg = await loadDwg(name)
      expect(diffSignatures(dwg.entities.map((e) => signature(e)), dxfComparable(name).map((e) => signature(e)))).toBeNull()
    })

    it('reports the same block references as its DXF twin', async () => {
      const dwg = await loadDwg(name)
      const dxf = loadTwin(name)
      const refs = (p: ParsedDxf): Sig[] =>
        (p.blockReferences ?? []).map((b) => ({ key: `${b.name}|${b.layer}|${b.mirrored}|${b.nestingDepth}|${b.entityRange[1] - b.entityRange[0]}`, nums: [b.insertion.x, b.insertion.y, b.rotationDeg, b.scaleX, b.scaleY] }))
      expect(diffSignatures(refs(dwg), refs(dxf))).toBeNull()
      expect((dwg.blockReferences ?? []).map((b) => b.name).sort()).toEqual((dxf.blockReferences ?? []).map((b) => b.name).sort())
    })
  })

  // ---------------------------------------------------------------------------------------------------- ground truth
  describe.each(dwgNames)('%s ground truth from the ezdxf document', (name) => {
    const meta = dwgManifest.files[name]
    const truth = twinManifest[meta.twin]

    it('has exactly the text strings, layers and heights the ezdxf source had; anchors and rotations equal the DXF twin', async () => {
      const dwg = await loadDwg(name)
      const got = dwg.entities
        .filter((e) => (e.type === 'TEXT' || e.type === 'MTEXT') && !isAttribTag(e))
        .map((e) => `${e.type}|${e.layer}|${e.text}|${e.textHeight}`)
        .sort()
      const want = meta.texts.flatMap((t) => Array.from({ length: t.n }, () => `${t.type}|${t.layer}|${t.text}|${t.height}`)).sort()
      expect(got).toEqual(want)
      const anchors = (p: DxfEntity[]): Sig[] => p.filter((e) => e.type === 'TEXT' || e.type === 'MTEXT').map((e) => ({ key: `${e.type}|${e.text}`, nums: [e.x ?? 0, e.y ?? 0, e.rotationDeg ?? 0] }))
      expect(diffSignatures(anchors(dwg.entities), anchors(dxfComparable(name)))).toBeNull()
    })

    it('imports the entities on frozen and switched-off layers (hidden, not dropped)', async () => {
      if (!truth.hiddenLayers) return
      const dwg = await loadDwg(name)
      const hidden = dwg.entities.filter((e) => truth.hiddenLayers!.includes(e.layer ?? '0'))
      expect(hidden).toHaveLength(2)
      expect(new Set(hidden.map((e) => e.layer))).toEqual(new Set(truth.hiddenLayers))
    })

    it('skips paper space with one warning when the drawing has layouts', async () => {
      const dwg = await loadDwg(name)
      const skipped = (dwg.diagnostics ?? []).filter((d) => d.code === 'paper-space-skipped')
      expect(skipped).toHaveLength(truth.sourceUnsupported.DIMENSION !== undefined ? 1 : 0)
      expect(dwg.entities.some((e) => e.text === 'TITLE BLOCK')).toBe(false)
    })
  })

  describe('room recognition on the DWG import equals the ezdxf construction', () => {
    const centroid = (poly: number[]): { x: number; y: number } => {
      let x = 0
      let y = 0
      for (let i = 0; i < poly.length; i += 2) {
        x += poly[i]
        y += poly[i + 1]
      }
      return { x: x / (poly.length / 2), y: y / (poly.length / 2) }
    }
    const flipY = (poly: number[]): number[] => poly.map((v, i) => (i % 2 ? -v : v))
    function expectRooms(cands: ReturnType<typeof recognizeCadRooms>['candidates'], rooms: TruthRoom[], unitsPerFoot: number): void {
      expect(cands).toHaveLength(rooms.length)
      for (const room of rooms) {
        const c = centroid(flipY(room.polygon))
        const best = [...cands].sort((a, b) => Math.hypot(centroid(a.polygon).x - c.x, centroid(a.polygon).y - c.y) - Math.hypot(centroid(b.polygon).x - c.x, centroid(b.polygon).y - c.y))[0]
        const got = centroid(best.polygon)
        expect(Math.hypot(got.x - c.x, got.y - c.y), `${room.name} centroid`).toBeLessThanOrEqual(0.5 * unitsPerFoot)
        expect(Math.abs(best.areaSqFt - room.areaSqFt) / room.areaSqFt, `${room.name}: ${best.areaSqFt} vs ${room.areaSqFt} ft2`).toBeLessThanOrEqual(0.005)
      }
    }
    it.each(dwgNames.filter((n) => twinManifest[dwgManifest.files[n].twin].rooms.length > 0))('%s: A-AREA boundaries give the manifest rooms and areas', async (name) => {
      const truth = twinManifest[dwgManifest.files[name].twin]
      const dwg = await loadDwg(name)
      const run = recognizeCadRooms(dwg.entities, { drawingUnitsPerFoot: truth.unitsPerFoot, layers: ['A-AREA'], level: 0 })
      expectRooms(run.candidates, truth.rooms, truth.unitsPerFoot)
      const dxfRun = recognizeCadRooms(loadTwin(name).entities, { drawingUnitsPerFoot: truth.unitsPerFoot, layers: ['A-AREA'], level: 0 })
      expect(run.candidates.map((c) => c.areaSqFt.toFixed(6)).sort()).toEqual(dxfRun.candidates.map((c) => c.areaSqFt.toFixed(6)).sort())
    })
    it('elevated-levels: each level recognises its own rooms; the elevation map and dropped 3D line match the ezdxf source', async () => {
      const name = ELEVATED
      const truth = twinManifest[dwgManifest.files[name].twin]
      const dwg = await loadDwg(name)
      for (const [level, rooms] of Object.entries(truth.levels!))
        expectRooms(recognizeCadRooms(dwg.entities, { drawingUnitsPerFoot: truth.unitsPerFoot, layers: ['A-AREA'], level: Number(level) }).candidates, rooms, truth.unitsPerFoot)
      const zOf = (e: DxfEntity): number => (e as DxfEntity & { elevation?: number }).elevation ?? 0
      const mapOf = (entities: DxfEntity[]): Record<string, number> => histogram(entities.map((e) => `${e.type}@${zOf(e)}`))
      expect(mapOf(dwg.entities.filter((e) => e.type !== 'TEXT'))).toEqual(mapOf(loadTwin(name).entities.filter((e) => e.type !== 'TEXT')))
      expect(Object.keys(mapOf(dwg.entities.filter((e) => e.type !== 'TEXT'))).some((k) => k.endsWith('@3500'))).toBe(true)
      expect((dwg.diagnostics ?? []).filter((d) => d.code === 'nonplanar-entity')).toHaveLength(truth.nonPlanarLines!)
    })
    it('elevated-levels: TEXT keeps its elevation (read from the DWG object by handle; convert() drops the field)', async () => {
      const dwg = await loadDwg(ELEVATED)
      const zs = dwg.entities.filter((e) => e.type === 'TEXT').map((e) => (e as DxfEntity & { elevation?: number }).elevation ?? 0)
      expect(zs.filter((z) => z === 3500)).toHaveLength(4)
      expect(zs.filter((z) => z === 0)).toHaveLength(4)
      // the same map as the DXF twin: elevation per TEXT string
      const byText = (p: ParsedDxf): Record<string, number> =>
        Object.fromEntries(p.entities.filter((e) => e.type === 'TEXT').map((e) => [e.text!, (e as DxfEntity & { elevation?: number }).elevation ?? 0]))
      expect(byText(dwg)).toEqual(byText(loadTwin(ELEVATED)))
    })
  })

  describe('entity-units-r2000.dwg: every kind of entity against the construction values', () => {
    const name = 'entity-units-r2000.dwg'
    type Built = { type: string; layer: string; [k: string]: unknown }
    const built = (): Built[] => (twinManifest[dwgManifest.files[name].twin] as unknown as { constructed: Built[] }).constructed
    const deg = (rad: number): number => (rad * 180) / Math.PI
    it('imports ARC angles, ELLIPSE parameters, bulges, TEXT/MTEXT rotation and INSERT placement as constructed', async () => {
      const dwg = await loadDwg(name)
      const of = (type: string): DxfEntity[] => dwg.entities.filter((e) => e.type === type && e.sourceBlock === undefined)
      const arcs = built().filter((b) => b.type === 'ARC')
      expect(of('ARC').map((e) => [e.x, -e.y!, e.radius, e.startAngleDeg, e.endAngleDeg])).toHaveLength(arcs.length)
      for (const a of arcs) {
        const e = of('ARC').find((x) => Math.abs(x.radius! - (a.radius as number)) < 1e-9)!
        expect(e.x).toBeCloseTo((a.center as number[])[0], 9)
        expect(-e.y!).toBeCloseTo((a.center as number[])[1], 9)
        expect(e.startAngleDeg).toBeCloseTo(a.startDeg as number, 9)
        expect(e.endAngleDeg).toBeCloseTo(a.endDeg as number, 9)
      }
      for (const el of built().filter((b) => b.type === 'ELLIPSE')) {
        const e = of('ELLIPSE').find((x) => Math.abs(x.x! - (el.center as number[])[0]) < 1e-9)!
        expect(e.startParam).toBeCloseTo(el.startParam as number, 9)
        expect(e.endParam).toBeCloseTo(el.endParam as number, 9)
        expect(e.majorAxis!.x).toBeCloseTo((el.majorAxis as number[] | undefined ?? (el as { majorAxis?: number[] }).majorAxis ?? [0])[0], 9)
      }
      const poly = built().find((b) => b.type === 'LWPOLYLINE')!
      const lw = of('LWPOLYLINE')[0]
      expect(lw.closed).toBe(true)
      expect(lw.bulges).toEqual((poly.vertices as number[][]).map((v) => v[2]))
      expect(lw.points!.map((n) => n + 0)).toEqual((poly.vertices as number[][]).flatMap((v) => [v[0], -v[1] + 0]))
      for (const t of built().filter((b) => b.type === 'TEXT' || b.type === 'MTEXT')) {
        const e = dwg.entities.find((x) => x.text === t.text)!
        expect(e.layer).toBe(t.layer)
        expect(e.x).toBeCloseTo((t.insert as number[])[0], 9)
        expect(-e.y!).toBeCloseTo((t.insert as number[])[1], 9)
        expect(e.textHeight).toBeCloseTo(t.height as number, 9)
        // canvas Y is reflected, so the reported angle is the constructed one negated
        expect(Math.abs(e.rotationDeg!)).toBeCloseTo(t.rotationDeg as number, 9)
      }
      const refs = dwg.blockReferences ?? []
      expect(refs.map((r) => `${r.name}:${r.nestingDepth}`).sort()).toEqual(['MARK:0', 'MARK:1', 'MARK:1', 'PAIR:0'])
      const mark = refs.find((r) => r.name === 'MARK' && r.nestingDepth === 0)!
      expect(mark.insertion.x).toBeCloseTo(0, 9)
      expect(mark.insertion.y).toBeCloseTo(-7000, 9)
      expect(Math.abs(mark.rotationDeg % 360)).toBeCloseTo(90, 9)
      expect(Math.abs(mark.scaleX)).toBeCloseTo(2, 9)
      expect(Math.abs(mark.scaleY)).toBeCloseTo(1.5, 9)
      const pair = refs.find((r) => r.name === 'PAIR')!
      expect(pair.insertion.x).toBeCloseTo(4000, 9)
      expect(Math.abs(pair.rotationDeg % 360)).toBeCloseTo(30, 9)
    })

    it('records the REAL libredwg-web convert() output: keys per entity type and value units (radians, not degrees)', async () => {
      const lw = await getNodeLibreDwg()
      const bytes = new Uint8Array(readFileSync(new URL(name, dir)))
      const data = lw.dwg_read_data(new Uint8Array(bytes).buffer, Dwg_File_Type.DWG)
      expect(data).toBeTruthy()
      try {
        const db = lw.convert(data!) as {
          header: Record<string, unknown>
          entities: Record<string, unknown>[]
          tables: { LAYER: { entries: Record<string, unknown>[] }; BLOCK_RECORD: { entries: Record<string, unknown>[] } }
        }
        const first = (type: string): Record<string, unknown> => {
          const hit = db.entities.find((e) => e.type === type)
          if (!hit) throw new Error(`no ${type} in ${[...new Set(db.entities.map((e) => e.type))].join(',')}`)
          return hit
        }
        const keys = (o: Record<string, unknown>): string[] => Object.keys(o)
        // keys parseDwgDatabase reads, per type: they must all exist in the real output
        const READ: Record<string, string[]> = {
          LINE: ['type', 'handle', 'layer', 'startPoint', 'endPoint', 'extrusionDirection'],
          LWPOLYLINE: ['vertices', 'flag', 'elevation', 'thickness', 'extrusionDirection'],
          CIRCLE: ['center', 'radius'],
          ARC: ['center', 'radius', 'startAngle', 'endAngle'],
          ELLIPSE: ['center', 'majorAxisEndPoint', 'axisRatio', 'startAngle', 'endAngle'],
          TEXT: ['text', 'startPoint', 'endPoint', 'textHeight', 'rotation', 'halign', 'valign', 'xScale', 'obliqueAngle'],
          MTEXT: ['text', 'insertionPoint', 'textHeight', 'direction', 'rotation', 'attachmentPoint'],
          INSERT: ['name', 'insertionPoint', 'xScale', 'yScale', 'zScale', 'rotation', 'columnCount', 'rowCount', 'attribs', 'ownerBlockRecordSoftId']
        }
        const markBlock = db.tables.BLOCK_RECORD.entries.find((b) => b.name === 'MARK')!
        const blockLine = (markBlock.entities as Record<string, unknown>[]).find((e) => e.type === 'LINE')!
        for (const [type, wanted] of Object.entries(READ))
          for (const k of wanted) expect(keys(type === 'LINE' ? blockLine : first(type)), `${type}.${k}`).toContain(k)
        // value units, checked against the construction values written by ezdxf in DEGREES
        const arc = db.entities.filter((e) => e.type === 'ARC')
        expect(deg(arc[0].startAngle as number)).toBeCloseTo(30, 9)
        expect(deg(arc[0].endAngle as number)).toBeCloseTo(120, 9)
        expect(deg(arc[1].startAngle as number)).toBeCloseTo(270, 9)
        expect(deg(arc[1].endAngle as number)).toBeCloseTo(90, 9)
        const ell = db.entities.filter((e) => e.type === 'ELLIPSE')
        expect(ell[1].startAngle).toBeCloseTo(0.5, 12) // elliptical parameters in radians, not degrees
        expect(ell[1].endAngle).toBeCloseTo(2, 12)
        expect(ell[1].axisRatio).toBe(0.4)
        const texts = db.entities.filter((e) => e.type === 'TEXT')
        expect(deg(texts[0].rotation as number)).toBeCloseTo(90, 9)
        expect(deg(texts[2].rotation as number)).toBeCloseTo(30, 9)
        expect(deg(texts[2].obliqueAngle as number)).toBeCloseTo(15, 9)
        expect(texts[1].halign).toBe(1) // center
        expect(texts[0].halign).toBe(0)
        expect(texts[1].startPoint).toEqual({ x: 2500, y: 5000 }) // 2D: no z on TEXT
        expect(texts[0].endPoint).toEqual({ x: 0, y: 0 }) // alignment point is zero unless the DWG stores one
        const mtext = first('MTEXT')
        expect(mtext.rotation).toBe(0) // libredwg-web writes 0; the baseline is in `direction`
        expect(Math.atan2((mtext.direction as { y: number }).y, (mtext.direction as { x: number }).x)).toBeCloseTo(Math.PI / 4, 12)
        const inserts = db.entities.filter((e) => e.type === 'INSERT')
        expect(deg(inserts[0].rotation as number)).toBeCloseTo(90, 9)
        expect(deg(inserts[1].rotation as number)).toBeCloseTo(30, 9)
        expect([inserts[0].xScale, inserts[0].yScale]).toEqual([2, 1.5])
        expect(first('LWPOLYLINE').flag).toBe(528) // 512 closed + 16
        expect((first('LWPOLYLINE').vertices as { bulge: number }[]).map((v) => v.bulge)).toEqual([0.5, 0, -0.3, 0])
        expect(first('LWPOLYLINE').extrusionDirection).toEqual({ x: 0, y: 0, z: 0 }) // absent extrusion is a zero vector
        expect(db.header.INSUNITS).toBe(4)
        expect(db.header.MEASUREMENT).toBe(1)
        // table shapes the adapter relies on
        expect(Object.keys(db.tables.LAYER.entries[0])).toEqual(expect.arrayContaining(['name', 'frozen', 'off']))
        expect(Object.keys(db.tables.BLOCK_RECORD.entries[0])).toEqual(expect.arrayContaining(['name', 'handle', 'entities']))
        expect((markBlock.entities as { type: string }[]).map((e) => e.type).sort()).toEqual(['CIRCLE', 'LINE', 'LINE'])
        expect(blockLine.startPoint).toEqual({ x: 0, y: 0, z: 0 })
      } finally {
        lw.dwg_free(data!)
      }
    })
  })

  it('every R2000 DWG fixture was checked against its ezdxf source by the pinned writer (writer-check summary)', () => {
    const exclusions = Object.fromEntries(Object.entries(dwgManifest.files).map(([n, f]) => [n, Object.keys(f.writerCheck.exclusions)]))
    // the only losses LibreDWG 0.13.3 + the committed patches still have on this corpus
    expect(exclusions).toEqual({
      'arch-imperial-in-r2000.dwg': [],
      'arch-metric-mm-r2000.dwg': [],
      'elevated-levels-r2000.dwg': [],
      'entity-units-r2000.dwg': [],
      'noise-dim-hatch-spline-paper-r2000.dwg': ['SPLINE.points'],
      'unitless-insunits0-r14.dwg': [],
      'unitless-insunits0-r2000.dwg': []
    })
  })

  describe('unitless-insunits0-r14.dwg (LibreDWG-written R14, read by the libredwg-web WASM build)', () => {
    it('decodes the geometry that does not depend on block names and warns once per unresolved INSERT', async () => {
      const r14 = await loadDwg('unitless-insunits0-r14.dwg')
      const r2000 = await loadDwg('unitless-insunits0-r2000.dwg')
      expect((r14.diagnostics ?? []).filter((d) => d.severity === 'error')).toEqual([])
      expect(r14.unitsConfidence).toBe(r2000.unitsConfidence)
      expect(r14.insUnits).toBe(r2000.insUnits)
      expect(byType(r14).MTEXT).toBe(byType(r2000).MTEXT)
      expect(byType(r14).CIRCLE).toBe(byType(r2000).CIRCLE)
      expect((r14.diagnostics ?? []).filter((d) => d.code === 'missing-block')).toHaveLength(loadTwin('unitless-insunits0-r14.dwg').blockReferences!.length)
    })
    gap('resolves INSERT block names in R14 files like in the R2000 sibling (the WASM reader returns name "" for every R14 INSERT)', async () => {
      const r14 = await loadDwg('unitless-insunits0-r14.dwg')
      const r2000 = await loadDwg('unitless-insunits0-r2000.dwg')
      expect(byType(r14)).toEqual(byType(r2000))
    })
  })
})
