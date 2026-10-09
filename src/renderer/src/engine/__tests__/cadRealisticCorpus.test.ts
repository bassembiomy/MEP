import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { beforeEach, describe, expect, it } from 'vitest'
import { parseDxfText, type ParsedDxf } from '../dxfParser'
import { useProjectStore, selectCeilingHeightSuggestion } from '../../store/projectStore'
import { recognizeCadRooms } from '../cad/roomRecognition'
import { listCadLevels } from '../cad/cadSemanticState'
import type { CadRoomCandidate } from '../cad/semanticTypes'

/**
 * Realistic CAD corpus written by an INDEPENDENT writer (ezdxf, see scripts/cad-corpus/generate_corpus.py).
 * Ground truth lives in fixtures/corpus/manifest.json and is computed from the generator's construction
 * geometry, never from this importer's output. Coordinates there are DXF Y-up drawing units; parseDxfText flips
 * Y, so every manifest point is negated in Y before comparing. Areas are unaffected.
 *
 * KNOWN-GAP POLICY: an assertion that fails because of a real importer/recogniser defect is declared with
 * gap(...) (= it.fails). The suite is green today and turns RED when someone fixes the defect, which forces them
 * to turn the test into a plain it() and update fixtures/corpus/README.md. Run with CORPUS_SHOW_GAPS=1 to see the
 * real assertion failure of every gap. Tolerances are never loosened to hide a defect.
 */
const gap = process.env.CORPUS_SHOW_GAPS ? it : it.fails

// ------------------------------------------------------------------------------------------ fixtures
interface TruthRoom { name: string; polygon: number[]; areaSqFt: number; ceilingAnnotation: string; ceilingHeightFt: number; door?: { x: number; y: number; widthFt: number } }
interface TruthOpening { kind: 'door' | 'window'; id: string; centre: { x: number; y: number }; widthFt: number; rotationDeg: number; mirrored: boolean }
interface TruthColumn { shape: 'square' | 'circle'; centre: { x: number; y: number }; sizeMm: number; sizeFt: number }
interface TruthFile {
  insunits: number; measurement: number; drawingUnit: string; unitsPerFoot: number
  expected: { cadUnit: string; unitsConfidence: string }
  rooms: TruthRoom[]; openings: TruthOpening[]; columns: TruthColumn[]
  modelBBox: { minX: number; maxX: number; minY: number; maxY: number }
  expectedEntityCount: number
  sourceUnsupported: Record<string, number>
  levels?: Record<string, TruthRoom[]>
  nonPlanarLines?: number; elevatedTopLevelEntities?: number
  hiddenLayers?: string[]; hiddenLayerEntityCount?: number
  paperSpace?: { layout1Entities: number; layout1Texts: string[] }
  splineCount?: number; ellipseCount?: number
  bays?: number; rawBytes?: number
  wallSegments?: Record<string, number | string>
}
const corpus = new URL('./fixtures/corpus/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', corpus), 'utf8')).files as Record<string, TruthFile>
const METRIC = 'arch-metric-mm-r2018.dxf'
const IMPERIAL = 'arch-imperial-in-r2010.dxf'
const UNITLESS = 'unitless-insunits0.dxf'
const NOISE = 'noise-dim-hatch-spline-paper.dxf'
const ELEVATED = 'elevated-levels.dxf'
const LARGE = 'large-office-20k.dxf.gz'
const LEGACY = 'legacy-r2000-cp1252.dxf'

/** The importer UI reads files with File.text() (UTF-8), so the corpus is decoded exactly that way. */
function readText(name: string): string {
  const bytes = readFileSync(new URL(name, corpus))
  return (name.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')
}
const cache = new Map<string, { parsed: ParsedDxf; parseMs: number }>()
function load(name: string) {
  let hit = cache.get(name)
  if (!hit) {
    const text = readText(name)
    const t0 = performance.now()
    const parsed = parseDxfText(text)
    hit = { parsed, parseMs: performance.now() - t0 }
    cache.set(name, hit)
  }
  return hit
}

// -------------------------------------------------------------------------------------------- helpers
const s = () => useProjectStore.getState()
const upf = (name: string) => manifest[name].unitsPerFoot
function resetStore() {
  s().clearDxfData()
  useProjectStore.setState({
    project: { name: 'P', location: 'L', units: 'imperial', scale: 10, outdoorDb: 95, indoorDb: 75 },
    zones: [], undoStack: [], redoStack: []
  })
}
/** Same call as Toolbar.handleFileChange. `confirm` plays the user pressing "confirm units" when the import did not. */
function loadStore(name: string, confirm = true): number {
  const { parsed } = load(name)
  resetStore()
  const t0 = performance.now()
  s().setDxfData(parsed.entities, parsed.bbox, parsed.suggestedScaleImperial, parsed.cadUnit,
    { sourceName: name, unitsConfidence: parsed.unitsConfidence ?? 'unknown', diagnostics: parsed.diagnostics ?? [] }, parsed.blockReferences)
  const ms = performance.now() - t0
  if (confirm && s().project.cadUnitsConfirmed !== true) useProjectStore.setState({ project: { ...s().project, cadUnitsConfirmed: true } })
  return ms
}
const histogram = (parsed: ParsedDxf, filter: (d: { code: string; entityType?: string }) => boolean = () => true) => {
  const h: Record<string, number> = {}
  for (const d of parsed.diagnostics ?? []) if (filter(d)) h[d.code + (d.entityType && d.code === 'UNSUPPORTED_ENTITY' ? `:${d.entityType}` : '')] = (h[d.code + (d.entityType && d.code === 'UNSUPPORTED_ENTITY' ? `:${d.entityType}` : '')] ?? 0) + 1
  return h
}
const GAP_UNSUPPORTED = ['ATTRIB', 'ATTDEF', 'SEQEND', 'SPLINE']
const isUnitsDiag = (d: { code: string }) => d.code.startsWith('units-')
const centroid = (poly: number[]) => {
  let x = 0, y = 0
  for (let i = 0; i < poly.length; i += 2) { x += poly[i]; y += poly[i + 1] }
  return { x: x / (poly.length / 2), y: y / (poly.length / 2) }
}
const flipY = (poly: number[]) => poly.map((v, i) => (i % 2 ? -v : v))
const shoelaceSqFt = (poly: number[], unitsPerFoot: number) => {
  let a = 0
  for (let i = 0; i < poly.length; i += 2) {
    const j = (i + 2) % poly.length
    a += poly[i] * poly[j + 1] - poly[j] * poly[i + 1]
  }
  return Math.abs(a / 2) / unitsPerFoot ** 2
}
const near = (a: number, b: number, rel: number) => Math.abs(a - b) <= rel * Math.abs(b)
/** The candidate whose centroid is closest to the manifest room's (parser coordinates). */
function matchRoom(cands: CadRoomCandidate[], room: TruthRoom): CadRoomCandidate | undefined {
  const c = centroid(flipY(room.polygon))
  return [...cands].sort((a, b) => Math.hypot(centroid(a.polygon).x - c.x, centroid(a.polygon).y - c.y) - Math.hypot(centroid(b.polygon).x - c.x, centroid(b.polygon).y - c.y))[0]
}
function expectRoomMatch(cands: CadRoomCandidate[], room: TruthRoom, unitsPerFoot: number) {
  const c = matchRoom(cands, room)
  expect(c, room.name).toBeDefined()
  const centre = centroid(flipY(room.polygon)), got = centroid(c!.polygon)
  expect(Math.hypot(got.x - centre.x, got.y - centre.y), `${room.name} centroid`).toBeLessThanOrEqual(0.5 * unitsPerFoot)
  expect(near(c!.areaSqFt, room.areaSqFt, 0.005), `${room.name}: ${c!.areaSqFt.toFixed(3)} ft2 vs ground truth ${room.areaSqFt.toFixed(3)} ft2`).toBe(true)
}
function expectRoomsMatch(cands: CadRoomCandidate[], rooms: TruthRoom[], unitsPerFoot: number) {
  expect(cands).toHaveLength(rooms.length)
  for (const room of rooms) expectRoomMatch(cands, room, unitsPerFoot)
}
const pathA = (name: string, level = 0) =>
  recognizeCadRooms(load(name).parsed.entities, { drawingUnitsPerFoot: upf(name), layers: ['A-AREA'], level })

/** Confirm A-WALL as the wall layer and approve every door/window candidate, as a reviewing user would. */
function pathBStore(name: string) {
  loadStore(name)
  expect(s().setCadLayerRole('A-WALL', 'wall').success).toBe(true)
  for (const o of s().cadOpenings.filter(c => c.kind !== 'opening')) s().approveCadOpening(o.id)
  return s().recognizeCadRoomCandidates()
}

/** Generic checks shared by the plan files. */
function describeUnitsAndImport(name: string, opts: { unitsGap: boolean; paperLeak?: boolean }) {
  const t = manifest[name]
  const unitsTest = opts.unitsGap ? gap : it
  unitsTest(`declares ${t.drawingUnit} units from $INSUNITS ${t.insunits} / $MEASUREMENT ${t.measurement} (confidence ${t.expected.unitsConfidence})`, () => {
    const { parsed } = load(name)
    expect(parsed.insUnits).toBe(t.insunits)
    expect(parsed.measurement).toBe(t.measurement)
    expect(parsed.unitsConfidence).toBe(t.expected.unitsConfidence)
    expect(parsed.cadUnit).toBe(t.expected.cadUnit)
    expect(histogram(parsed, isUnitsDiag)).toEqual(t.expected.unitsConfidence === 'declared' ? {} : { 'units-unspecified': 1 })
  })
  it('control: the same file read with its group-code-2 header variables removed declares the manifest units (root cause of the gap above)', () => {
    // $DIMSTYLE, $UCSNAME, $PUCSNAME, $CMLSTYLE ... carry group code 2, which the parser takes for a section name and
    // so stops treating the rest of the HEADER as HEADER; $INSUNITS / $MEASUREMENT come after them.
    const lines = readText(name).split('\n')
    const end = lines.indexOf('ENDSEC')
    const kept: string[] = []
    for (let i = 0; i + 1 < lines.length; i += 2) if (!(i > 4 && i < end && lines[i].trim() === '2')) kept.push(lines[i], lines[i + 1])
    const parsed = parseDxfText(kept.join('\n') + '\n')
    expect(parsed.insUnits).toBe(t.insunits)
    expect(parsed.measurement).toBe(t.measurement)
    expect(parsed.unitsConfidence).toBe(t.expected.unitsConfidence)
    expect(parsed.cadUnit).toBe(t.expected.cadUnit)
    expect(histogram(parsed, isUnitsDiag)).toEqual(t.expected.unitsConfidence === 'declared' ? {} : { 'units-unspecified': 1 })
  })
  it('suggests the manifest drawing unit and scale', () => {
    const { parsed } = load(name)
    expect(parsed.cadUnit).toBe(t.expected.cadUnit)
    expect(parsed.suggestedScaleImperial).toBeCloseTo(t.unitsPerFoot, 9)
  })
  it('has no diagnostics other than the documented ones (exact counts by code)', () => {
    const { parsed } = load(name)
    const expected: Record<string, number> = {}
    for (const [type, n] of Object.entries(t.sourceUnsupported)) if (!GAP_UNSUPPORTED.includes(type)) expected[`UNSUPPORTED_ENTITY:${type}`] = n
    if (t.elevatedTopLevelEntities) expected.ELEVATED_GEOMETRY_PROJECTED = t.elevatedTopLevelEntities
    if (t.nonPlanarLines) expected.UNSUPPORTED_ELEVATION = t.nonPlanarLines
    const actual = histogram(parsed, d => !isUnitsDiag(d) && !(d.code === 'UNSUPPORTED_ENTITY' && GAP_UNSUPPORTED.includes(d.entityType ?? '')))
    expect(actual).toEqual(expected)
  })
  if (t.sourceUnsupported.ATTRIB) {
    gap('KNOWN GAP: INSERT attributes (ATTRIB, ATTDEF, SEQEND) are reported as UNSUPPORTED_ENTITY — the parser has no case for them', () => {
      const { parsed } = load(name)
      const noisy = (parsed.diagnostics ?? []).filter(d => d.code === 'UNSUPPORTED_ENTITY' && ['ATTRIB', 'ATTDEF', 'SEQEND'].includes(d.entityType ?? ''))
      expect(noisy).toHaveLength(0)
    })
  }
  const countTest = opts.paperLeak ? gap : it
  countTest(`${opts.paperLeak ? 'KNOWN GAP (paper-space leak, see below): ' : ''}imports the manifest entity count (${t.expectedEntityCount}) after block expansion`, () => {
    expect(load(name).parsed.entities).toHaveLength(t.expectedEntityCount)
  })
  it('keeps the drawing bbox within the manifest model extents (+-1 unit, Y negated)', () => {
    const { parsed } = load(name)
    const b = t.modelBBox
    expect(parsed.bbox.minX).toBeGreaterThanOrEqual(b.minX - 1)
    expect(parsed.bbox.maxX).toBeLessThanOrEqual(b.maxX + 1)
    expect(parsed.bbox.minY).toBeGreaterThanOrEqual(-b.maxY - 1)
    expect(parsed.bbox.maxY).toBeLessThanOrEqual(-b.minY + 1)
    // and the extents are actually reached (nothing silently dropped at the edges)
    expect(parsed.bbox.minX).toBeLessThanOrEqual(b.minX + 1)
    expect(parsed.bbox.maxX).toBeGreaterThanOrEqual(b.maxX - 1)
    expect(parsed.bbox.minY).toBeLessThanOrEqual(-b.maxY + 1)
    expect(parsed.bbox.maxY).toBeGreaterThanOrEqual(-b.minY - 1)
  })
  if (!opts.paperLeak)
    it('leaks no paper-space text', () => {
      expect(load(name).parsed.entities.some(e => /TITLE BLOCK/.test(e.text ?? ''))).toBe(false)
    })
}

function describeOpenings(name: string, expectStrayOpenings = false) {
  const t = manifest[name]
  describe('door and window recognition (same calls the store makes in setDxfData)', () => {
    beforeEach(() => { loadStore(name) })
    it('finds exactly the manifest doors and windows', () => {
      for (const kind of ['door', 'window'] as const)
        expect(s().cadOpenings.filter(o => o.kind === kind), kind).toHaveLength(t.openings.filter(o => o.kind === kind).length)
    })
    it('places every opening within 0.5 ft of the manifest centre and within 5% of its width (rotated and mirrored blocks included)', () => {
      for (const o of t.openings) {
        const c = s().cadOpenings.filter(x => x.kind === o.kind).find(x => Math.hypot(x.center.x - o.centre.x, x.center.y + o.centre.y) <= 0.5 * upf(name))
        expect(c, `${o.id} (${o.kind}, rot ${o.rotationDeg}${o.mirrored ? ' mirrored' : ''}) at ${o.centre.x},${o.centre.y}`).toBeDefined()
        expect(near(c!.widthFt, o.widthFt, 0.05), `${o.id} width ${c!.widthFt} vs ${o.widthFt}`).toBe(true)
      }
    })
    if (!expectStrayOpenings)
      it('reports no unexplained wall-gap openings besides the manifest doors and windows', () => {
        expect(s().cadOpenings.filter(o => o.kind === 'opening').map(o => o.center)).toEqual([])
      })
  })
}

function describeCeilings(name: string, rooms: TruthRoom[], level = 0) {
  it('suggests each room ceiling height from its CH annotation', () => {
    loadStore(name)
    if (level) s().setCadLevel(level)
    const cands = pathA(name, level).candidates
    for (const room of rooms) {
      const c = matchRoom(cands, room)!
      const out = selectCeilingHeightSuggestion(s(), c)
      expect(out.suggestion, `${room.name} "${room.ceilingAnnotation}"`).toBeDefined()
      expect(out.suggestion!.valueFt, room.name).toBeCloseTo(room.ceilingHeightFt, 2)
    }
  })
}

// -------------------------------------------------------------------------------------- 1. metric plan
describe('corpus: arch-metric-mm-r2018 (double-line walls, rotated/mirrored door blocks, attributes)', () => {
  const name = METRIC
  const t = manifest[name]
  describeUnitsAndImport(name, { unitsGap: true })
  describeOpenings(name)

  describe('columns', () => {
    beforeEach(() => { loadStore(name) })
    it('recognises the three S-COLS columns (2 x 400 mm square, 1 x 450 mm circle) with their sizes', () => {
      const cols = s().cadObstacles.filter(o => o.layer === 'S-COLS')
      expect(cols).toHaveLength(3)
      for (const c of t.columns) {
        const hit = cols.find(o => Math.hypot((o.circle?.x ?? o.polygon.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / (o.polygon.length / 2)) - c.centre.x,
          (o.circle?.y ?? o.polygon.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0) / (o.polygon.length / 2)) + c.centre.y) <= 0.5 * upf(name))
        expect(hit, `${c.shape} at ${c.centre.x},${c.centre.y}`).toBeDefined()
        expect(hit!.shape).toBe(c.shape === 'circle' ? 'circle' : 'polygon')
        expect(near(hit!.widthFt, c.sizeFt, 0.02) && near(hit!.depthFt, c.sizeFt, 0.02), `${c.shape} ${hit!.widthFt}x${hit!.depthFt} vs ${c.sizeFt}`).toBe(true)
      }
    })
    it('proposes no obstacle other than the columns', () => {
      expect(s().cadObstacles.filter(o => o.layer !== 'S-COLS')).toHaveLength(0)
    })
  })

  describe('rooms, path A (closed A-AREA boundaries)', () => {
    it('finds the 4 rooms with areas within 0.5% of the construction geometry', () => {
      loadStore(name)
      const r = pathA(name)
      expect(r.diagnostics.filter(d => d.severity === 'error')).toEqual([])
      expectRoomsMatch(r.candidates, t.rooms, upf(name))
    })
    gap('KNOWN GAP: room names come from the raw alphabetically-first interior text (MTEXT formatting codes and CH annotations leak into the name)', () => {
      const r = pathA(name)
      for (const room of t.rooms) expect(matchRoom(r.candidates, room)!.name, room.name).toBe(room.name)
    })
  })

  describe('rooms, path B (A-WALL confirmed by the user, openings approved)', () => {
    it('finds Office 1, Office 2 and the Meeting Room with areas within 0.5%', () => {
      const run = pathBStore(name)
      expect(run.success).toBe(true)
      for (const room of t.rooms.filter(r => r.name !== 'CORRIDOR')) expectRoomMatch(run.result!.candidates, room, upf(name))
    })
    gap('KNOWN GAP: an approved opening closes the gap on whichever wall face its end snaps to, so the Corridor polygon swallows the exterior door jamb pockets (309.6 ft2 vs 305.7 ft2, +1.3%)', () => {
      expectRoomMatch(pathBStore(name).result!.candidates, t.rooms.find(r => r.name === 'CORRIDOR')!, upf(name))
    })
    gap('KNOWN GAP: the 200 mm double-line exterior wall body between its two face lines is returned as a room candidate (33.8 ft2 "Room")', () => {
      const run = pathBStore(name)
      const known = t.rooms.map(r => r.areaSqFt)
      const strays = run.result!.candidates.filter(c => !known.some(a => near(c.areaSqFt, a, 0.02)))
      expect(strays.map(c => `${c.areaSqFt.toFixed(1)} ft2`)).toEqual([])
      expect(run.result!.candidates).toHaveLength(t.rooms.length)
    })
  })

  describe('ceiling heights', () => {
    describeCeilings(name, t.rooms)
    it('reads 2.70 m as 8.858 ft from both "CH 2700" and "C.H. = 2.70 m"', () => {
      loadStore(name)
      const cands = pathA(name).candidates
      for (const room of t.rooms.filter(r => r.ceilingHeightFt > 8.8 && r.ceilingHeightFt < 8.9)) {
        expect(selectCeilingHeightSuggestion(s(), matchRoom(cands, room)!).suggestion!.valueFt).toBeCloseTo(2.7 / 0.3048, 3)
      }
    })
  })

  it('store flow: confirming A-AREA, recognising and approving Office 1 creates a zone of the manifest area', () => {
    loadStore(name)
    s().setCadLayerRole('A-AREA', 'wall')
    const run = s().recognizeCadRoomCandidates()
    expect(run.success).toBe(true)
    const office = t.rooms.find(r => r.name === 'OFFICE 1')!
    const c = matchRoom(run.result!.candidates, office)!
    const out = s().approveCadRoom(c, { name: 'Office 1', spaceTypeId: 'office', ceilingHeight: 9, occupants: 4,
      sourceCadRevision: run.sourceCadRevision!, drawingUnitsPerFoot: run.drawingUnitsPerFoot!, recognitionContext: run.recognitionContext! })
    expect(out.error).toBeUndefined()
    expect(s().zones).toHaveLength(1)
    const zoneArea = shoelaceSqFt(s().zones[0].points, run.drawingUnitsPerFoot!)
    expect(near(zoneArea, office.areaSqFt, 0.005), `${zoneArea} ft2 vs ${office.areaSqFt} ft2`).toBe(true)
    expect(office.areaSqFt).toBeCloseTo(215.278, 2)
  })

  it('performance: parse, store import and room recognition stay within 3x the local measurement', () => {
    const { parseMs } = load(name)
    const importMs = loadStore(name)
    const t0 = performance.now()
    pathA(name)
    const roomMs = performance.now() - t0
    console.log(`[corpus-perf] ${name}: parse ${parseMs.toFixed(1)} ms, store import ${importMs.toFixed(1)} ms, rooms ${roomMs.toFixed(1)} ms`)
    expect(parseMs).toBeLessThan(PERF.small.parse)
    expect(importMs).toBeLessThan(PERF.small.store)
    expect(roomMs).toBeLessThan(PERF.small.rooms)
  })
})

// Measured locally (3 runs): small plans parse 2-13 ms, import 0.3-1.2 ms, rooms 0.5 ms; the 19.9k-entity plan parses in
// ~260 ms, imports in ~50-60 ms and (because recognition aborts, see the gap below) returns in ~8 ms. Bounds are ~3x those,
// with a floor on the tiny numbers so a loaded CI box does not flake.
const PERF = {
  small: { parse: 150, store: 100, rooms: 100 },
  large: { parse: 800, store: 300, rooms: 5000 }
}

// ------------------------------------------------------------------------------- 2. imperial plan
describe('corpus: arch-imperial-in-r2010 (inches, single-line centreline walls)', () => {
  const name = IMPERIAL
  const t = manifest[name]
  describeUnitsAndImport(name, { unitsGap: true })
  describeOpenings(name)
  it('is 12 ft x 14 ft = 168 ft2 for Office A in the ground truth', () => {
    expect(t.rooms[0].areaSqFt).toBeCloseTo(168, 9)
  })
  it('rooms path A: 4 rooms with areas within 0.5%', () => {
    expectRoomsMatch(pathA(name).candidates, t.rooms, upf(name))
  })
  gap('KNOWN GAP: room names come from the raw alphabetically-first interior text (CLG HT / CH annotations beat the room name)', () => {
    const r = pathA(name)
    for (const room of t.rooms) expect(matchRoom(r.candidates, room)!.name, room.name).toBe(room.name)
  })
  it('rooms path B: single-line walls plus approved doors close exactly the 4 rooms', () => {
    const run = pathBStore(name)
    expect(run.success).toBe(true)
    expectRoomsMatch(run.result!.candidates, t.rooms, upf(name))
  })
  describe('ceiling heights', () => {
    describeCeilings(name, t.rooms)
    it('reads CLG HT 9\'-0" as 9.0 ft and CH 8\'-6" as 8.5 ft', () => {
      loadStore(name)
      const cands = pathA(name).candidates
      const heights = t.rooms.map(r => selectCeilingHeightSuggestion(s(), matchRoom(cands, r)!).suggestion?.valueFt)
      expect(heights).toEqual([9, 9, 8.5, 8.5])
    })
  })
  it('store flow: approving Conference creates a 224 ft2 zone', () => {
    loadStore(name)
    s().setCadLayerRole('A-AREA', 'wall')
    const run = s().recognizeCadRoomCandidates()
    const room = t.rooms.find(r => r.name === 'CONFERENCE')!
    const out = s().approveCadRoom(matchRoom(run.result!.candidates, room)!, { name: 'Conference', spaceTypeId: 'office', ceilingHeight: 8.5, occupants: 10,
      sourceCadRevision: run.sourceCadRevision!, drawingUnitsPerFoot: run.drawingUnitsPerFoot!, recognitionContext: run.recognitionContext! })
    expect(out.error).toBeUndefined()
    expect(shoelaceSqFt(s().zones[0].points, 12)).toBeCloseTo(224, 6)
    expect(room.areaSqFt).toBeCloseTo(224, 9)
  })
  it('performance', () => {
    const { parseMs } = load(name)
    const importMs = loadStore(name)
    console.log(`[corpus-perf] ${name}: parse ${parseMs.toFixed(1)} ms, store import ${importMs.toFixed(1)} ms`)
    expect(parseMs).toBeLessThan(PERF.small.parse)
    expect(importMs).toBeLessThan(PERF.small.store)
  })
})

// ---------------------------------------------------------------------------------- 3. unitless file
describe('corpus: unitless-insunits0 ($INSUNITS 0)', () => {
  const name = UNITLESS
  const t = manifest[name]
  describeUnitsAndImport(name, { unitsGap: true })
  it('requires explicit unit confirmation before any room can be recognised', () => {
    loadStore(name, false)
    expect(s().project.cadUnitsConfirmed).toBe(false)
    const run = s().recognizeCadRoomCandidates()
    expect(run.success).toBe(false)
    expect(run.error).toMatch(/confirm.*units/i)
  })
  it('after the user confirms, the same plan gives the 4 rooms (geometry itself is fine)', () => {
    loadStore(name)
    expectRoomsMatch(pathA(name).candidates, t.rooms, upf(name))
  })
})

// ------------------------------------------------------------------------------------ 4. noise file
describe('corpus: noise-dim-hatch-spline-paper (dimensions, hatches, spline, XDATA, hidden layers, paper space)', () => {
  const name = NOISE
  const t = manifest[name]
  describeUnitsAndImport(name, { unitsGap: true, paperLeak: true })
  it('reports dimensions, hatches and Defpoints points as unsupported, exactly once each', () => {
    const h = histogram(load(name).parsed, d => d.code === 'UNSUPPORTED_ENTITY')
    expect(h['UNSUPPORTED_ENTITY:DIMENSION']).toBe(t.sourceUnsupported.DIMENSION)
    expect(h['UNSUPPORTED_ENTITY:HATCH']).toBe(t.sourceUnsupported.HATCH)
    expect(h['UNSUPPORTED_ENTITY:POINT']).toBe(t.sourceUnsupported.POINT)
  })
  it('imports the supported ellipse', () => {
    expect(load(name).parsed.entities.filter(e => e.type === 'ELLIPSE')).toHaveLength(t.ellipseCount!)
  })
  gap('KNOWN GAP: SPLINE feature wall is dropped as UNSUPPORTED_ENTITY (no geometry for curved walls)', () => {
    const { parsed } = load(name)
    expect((parsed.diagnostics ?? []).filter(d => d.entityType === 'SPLINE')).toHaveLength(0)
    expect(parsed.entities.filter(e => e.layer === 'A-WALL-CURVE').length).toBeGreaterThan(0)
  })
  it('the model-space entity count matches the manifest once the Layout1 title-block entities are subtracted', () => {
    expect(load(name).parsed.entities.length - t.paperSpace!.layout1Entities).toBe(t.expectedEntityCount)
  })
  gap('KNOWN GAP: paper-space (group 67) entities of Layout1 are imported into the model — the parser never checks group 67', () => {
    const { parsed } = load(name)
    expect(parsed.entities.filter(e => (e.text ?? '') === 'TITLE BLOCK')).toHaveLength(0)
  })
  gap('KNOWN GAP: geometry on frozen / off layers is imported as if visible — layer flags (group 70 bit 1, negative colour) are ignored', () => {
    const { parsed } = load(name)
    expect(parsed.entities.filter(e => t.hiddenLayers!.includes(e.layer ?? ''))).toHaveLength(0)
  })
  it('XDATA, the second layout and its viewport do not disturb the import (no malformed/limit diagnostics)', () => {
    const codes = (load(name).parsed.diagnostics ?? []).map(d => d.code)
    expect(codes.filter(c => /MALFORMED|INCOMPLETE|LIMIT|VIEWPORT/.test(c))).toEqual([])
  })
  describe('semantic recognition survives the noise', () => {
    it('rooms path A: still exactly the 4 manifest rooms', () => {
      loadStore(name)
      expectRoomsMatch(pathA(name).candidates, t.rooms, upf(name))
    })
    it('finds the manifest doors and windows', () => {
      loadStore(name)
      for (const kind of ['door', 'window'] as const)
        expect(s().cadOpenings.filter(o => o.kind === kind)).toHaveLength(t.openings.filter(o => o.kind === kind).length)
    })
  })
})

// --------------------------------------------------------------------------------- 5. elevated levels
describe('corpus: elevated-levels (ground floor z=0, second floor z=3500 mm, one non-planar 3D line)', () => {
  const name = ELEVATED
  const t = manifest[name]
  const ground = t.levels!['0'], upper = t.levels!['3500']
  describeUnitsAndImport(name, { unitsGap: true })
  it('drops the non-planar 3D LINE with UNSUPPORTED_ELEVATION and keeps all planar geometry', () => {
    const { parsed } = load(name)
    expect((parsed.diagnostics ?? []).filter(d => d.code === 'UNSUPPORTED_ELEVATION')).toHaveLength(t.nonPlanarLines!)
    expect(parsed.entities.some(e => e.type === 'LINE' && Math.abs(e.x! - 100) < 1e-6 && Math.abs(e.y! + 100) < 1e-6)).toBe(false)
  })
  it('projects elevated geometry with ELEVATED_GEOMETRY_PROJECTED and records elevation 3500', () => {
    const { parsed } = load(name)
    expect((parsed.diagnostics ?? []).filter(d => d.code === 'ELEVATED_GEOMETRY_PROJECTED').length).toBeGreaterThan(0)
    expect(listCadLevels(parsed.entities)).toEqual([0, 3500])
  })
  it('level 0 recognises the ground rooms only; level 3500 the upper rooms only', () => {
    expectRoomsMatch(pathA(name, 0).candidates, ground, upf(name))
    expectRoomsMatch(pathA(name, 3500).candidates, upper, upf(name))
  })
  it('the store switches level and recognises the same rooms (A-AREA confirmed as boundary layer)', () => {
    loadStore(name)
    s().setCadLayerRole('A-AREA', 'wall')
    expectRoomsMatch(s().recognizeCadRoomCandidates().result!.candidates, ground, upf(name))
    expect(s().setCadLevel(3500).success).toBe(true)
    const run = s().recognizeCadRoomCandidates()
    expect(run.level).toBe(3500)
    expectRoomsMatch(run.result!.candidates, upper, upf(name))
  })
  it('recognises the door blocks INSERTed at z=0 and z=3500, each on its own level only', () => {
    loadStore(name)
    for (const [level, rooms] of [[0, ground], [3500, upper]] as const) {
      if (level) expect(s().setCadLevel(level).success).toBe(true)
      const doors = s().cadOpenings.filter(o => o.kind === 'door' && o.level === level)
      expect(doors, `level ${level}`).toHaveLength(rooms.length)
      for (const room of rooms) {
        const d = doors.find(o => Math.hypot(o.center.x - room.door!.x, o.center.y + room.door!.y) <= 0.5 * upf(name))
        expect(d, `${room.name} door`).toBeDefined()
        expect(near(d!.widthFt, room.door!.widthFt, 0.05)).toBe(true)
      }
    }
  })
  describe('ceiling heights per level', () => {
    describeCeilings(name, ground, 0)
    describeCeilings(name, upper, 3500)
  })
})

// ----------------------------------------------------------------------------- 6. large office (20k)
describe('corpus: large-office-20k.dxf.gz (48 bays, ~20k entities after block expansion)', () => {
  const name = LARGE
  const t = manifest[name]
  it('is ~20k entities and the wall segment budget (5000) is deliberately not the limiting factor', () => {
    expect(t.expectedEntityCount).toBeGreaterThan(19000)
    expect(Number(t.wallSegments!['A-WALL'])).toBeLessThan(5000)
    expect(Number(t.wallSegments!['A-AREA'])).toBeLessThan(5000)
    const { parsed } = load(name)
    expect(parsed.entities.filter(e => e.layer === 'A-WALL' && e.type === 'LINE')).toHaveLength(Number(t.wallSegments!['A-WALL']))
    expect(parsed.entities.filter(e => e.layer === 'A-AREA' && e.closed).reduce((n, e) => n + e.points!.length / 2, 0)).toBe(Number(t.wallSegments!['A-AREA']))
  })
  describeUnitsAndImport(name, { unitsGap: true })
  it('finds the 48 door blocks', () => {
    loadStore(name)
    expect(s().cadOpenings.filter(o => o.kind === 'door')).toHaveLength(t.bays!)
  })
  it('evidence: the A-AREA boundaries alone (no other entities) recognise all 48 rooms with correct areas', () => {
    const only = load(name).parsed.entities.filter(e => e.layer === 'A-AREA')
    const r = recognizeCadRooms(only, { drawingUnitsPerFoot: upf(name), layers: ['A-AREA'] })
    expectRoomsMatch(r.candidates, t.rooms, upf(name))
  })
  gap('KNOWN GAP: room recognition on a ~20k-entity plan exhausts the 200k work budget in the room-label loop (rooms x all entities) and returns 0 candidates', () => {
    const r = pathA(name)
    expect(r.diagnostics.map(d => d.code)).not.toContain('recognition-budget-exceeded')
    expectRoomsMatch(r.candidates, t.rooms, upf(name))
  })
  it('performance: parse, store import and room recognition are logged and bounded', () => {
    const { parseMs } = load(name)
    const importMs = loadStore(name)
    const t0 = performance.now()
    const r = pathA(name)
    const roomMs = performance.now() - t0
    console.log(`[corpus-perf] ${name}: ${load(name).parsed.entities.length} entities, parse ${parseMs.toFixed(0)} ms, store import ${importMs.toFixed(0)} ms, rooms ${roomMs.toFixed(0)} ms (${r.candidates.length} rooms)`)
    expect(parseMs).toBeLessThan(PERF.large.parse)
    expect(importMs).toBeLessThan(PERF.large.store)
    expect(roomMs).toBeLessThan(PERF.large.rooms)
  })
})

// ------------------------------------------------------------------------------------ 7. legacy cp1252
describe('corpus: legacy-r2000-cp1252 (cp1252 bytes, \\U+ escapes)', () => {
  const name = LEGACY
  const t = manifest[name]
  const texts = () => load(name).parsed.entities.filter(e => e.type === 'MTEXT' || e.type === 'TEXT').map(e => e.text)
  describeUnitsAndImport(name, { unitsGap: true })
  it('rooms path A: both rooms with the right areas', () => {
    expectRoomsMatch(pathA(name).candidates, t.rooms, upf(name))
  })
  gap('KNOWN GAP: cp1252 bytes (0xFC in "Büro", 0xE9 in "Café") are decoded as UTF-8 and become U+FFFD', () => {
    expect(texts()).toContain('Büro')
    expect(texts()).toContain('Café')
  })
  gap('KNOWN GAP: \\U+XXXX escapes are not decoded, so Arabic text stays as literal \\U+0627… and the CH annotation is unreadable', () => {
    expect(texts()).toContain('ارتفاع السقف 2.80')
  })
  gap('KNOWN GAP: the Arabic ceiling-height annotation (2.80 m) is not recognised because its text was never decoded', () => {
    loadStore(name)
    const room = t.rooms.find(r => r.name === 'Büro')!
    const out = selectCeilingHeightSuggestion(s(), matchRoom(pathA(name).candidates, room)!)
    expect(out.suggestion?.valueFt).toBeCloseTo(2.8 / 0.3048, 2)
  })
  it('the plain CH 2700 in the second room is still read (2.70 m)', () => {
    loadStore(name)
    const room = t.rooms.find(r => r.name === 'Café')!
    expect(selectCeilingHeightSuggestion(s(), matchRoom(pathA(name).candidates, room)!).suggestion?.valueFt).toBeCloseTo(2.7 / 0.3048, 2)
  })
})
