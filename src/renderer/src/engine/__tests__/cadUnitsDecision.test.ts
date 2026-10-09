import { beforeEach, describe, expect, it } from 'vitest'
import { useProjectStore, type CadImportMetadata, type DxfEntity } from '../../store/projectStore'
import { parseProjectDocument, serializeProject } from '../project/projectSerialization'
import { unitsAutoConfirmed } from '../cad/unitsDecision'
import { calculateCanonicalZoneLoad } from '../loadCalc'
import type { CadRoomCandidate } from '../cad/semanticTypes'

const entities: DxfEntity[] = [{ type: 'LWPOLYLINE', points: [0, 0, 200, 0, 200, 150, 0, 150], closed: true, handle: 'R1', layer: 'ROOM' }]
const bbox = { minX: 0, maxX: 200, minY: 0, maxY: 150 }
const candidate: CadRoomCandidate = { id: 'room-R1', name: 'Office', polygon: [0, 0, 200, 0, 200, 150, 0, 150], areaSqFt: 300, sourceHandles: ['R1'], sourceLayers: ['ROOM'], confidence: 1, status: 'review-required', evidence: [], unresolvedConditions: [] }
const meta = (unitsConfidence: CadImportMetadata['unitsConfidence'], codes: string[] = []): CadImportMetadata => ({
  sourceName: 'p.dxf', unitsConfidence, diagnostics: codes.map(code => ({ code, severity: 'warning' as const, message: code }))
})
const importWith = (m?: CadImportMetadata) => useProjectStore.getState().setDxfData(structuredClone(entities), bbox, 10, 'ft', m)
const approve = () => useProjectStore.getState().approveCadRoom(candidate, {
  name: 'Office', spaceTypeId: 'office', ceilingHeight: 10, occupants: 2, sourceCadRevision: JSON.stringify(useProjectStore.getState().dxfEntities), drawingUnitsPerFoot: useProjectStore.getState().project.scale
})
beforeEach(() => {
  useProjectStore.getState().clearDxfData()
  useProjectStore.setState({ project: { name: 'P', location: 'L', units: 'imperial', scale: 10, outdoorDb: 95, indoorDb: 75 }, zones: [], undoStack: [], redoStack: [] })
})

describe('unit confirmation decision (W2)', () => {
  it('auto-confirms only declared units with neither implausibility nor measurement-conflict diagnostics', () => {
    expect(unitsAutoConfirmed(meta('declared'))).toBe(true)
    expect(unitsAutoConfirmed(meta('declared', ['units-unmapped']))).toBe(true)
    expect(unitsAutoConfirmed(meta('declared', ['declared-implausible']))).toBe(false)
    expect(unitsAutoConfirmed(meta('declared', ['units-measurement-conflict']))).toBe(false)
    expect(unitsAutoConfirmed(meta('estimated'))).toBe(false)
    expect(unitsAutoConfirmed(meta('unknown'))).toBe(false)
  })
  it.each([
    ['declared', [], true],
    ['declared', ['declared-implausible'], false],
    ['declared', ['units-measurement-conflict'], false],
    ['estimated', [], false],
    ['unknown', [], false]
  ] as const)('setDxfData with %s units and diagnostics %j sets cadUnitsConfirmed=%s', (confidence, codes, expected) => {
    importWith(meta(confidence, [...codes]))
    expect(useProjectStore.getState().project.cadUnitsConfirmed).toBe(expected)
  })
  it('refuses to approve a CAD room while units are unconfirmed, leaving state unchanged, and allows it after explicit confirmation', () => {
    importWith(meta('declared', ['declared-implausible']))
    const before = useProjectStore.getState()
    const refused = approve()
    expect(refused.success).toBe(false)
    expect(refused.error).toMatch(/confirm.*units/i)
    expect(useProjectStore.getState().zones).toBe(before.zones)
    expect(useProjectStore.getState().undoStack).toBe(before.undoStack)
    useProjectStore.getState().setProject({ cadUnitsConfirmed: true })
    expect(approve().success).toBe(true)
  })
  it('persisted declared-but-doubtful units still need confirmation after reload', () => {
    importWith(meta('declared', ['units-measurement-conflict']))
    const s = useProjectStore.getState()
    const doc = JSON.parse(serializeProject({ project: s.project, zones: [], dxfEntities: s.dxfEntities, dxfBoundingBox: s.dxfBoundingBox, dxfLayers: s.dxfLayers, cadImport: s.cadImport }))
    delete doc.project.cadUnitsConfirmed
    expect(parseProjectDocument(JSON.stringify(doc)).project.cadUnitsConfirmed).toBe(false)
    doc.project.cadUnitsConfirmed = true
    expect(parseProjectDocument(JSON.stringify(doc)).project.cadUnitsConfirmed).toBe(true)
  })
})

describe('calibrateScaleFromPoints (W2)', () => {
  it('derives the scale from two picked points, marks it user-calibrated and confirms units', () => {
    importWith(meta('unknown'))
    expect(useProjectStore.getState().project.cadUnitsConfirmed).toBe(false)
    const r = useProjectStore.getState().calibrateScaleFromPoints({ x: 0, y: 0 }, { x: 3048, y: 0 }, 10, 'm')
    expect(r.success).toBe(true)
    const p = useProjectStore.getState().project
    expect(p.scale).toBeCloseTo(3048 / (10 / 0.3048), 9)
    expect(p.cadUnitsConfirmed).toBe(true)
    expect(p.cadScaleProvenance).toBe('user-calibrated')
    expect(p.cadUnit).toBe('custom')
  })
  it('stores the metric scale per metre', () => {
    useProjectStore.setState({ project: { ...useProjectStore.getState().project, units: 'metric', scale: 1 } })
    expect(useProjectStore.getState().calibrateScaleFromPoints({ x: 0, y: 0 }, { x: 5000, y: 0 }, 5, 'm').success).toBe(true)
    expect(useProjectStore.getState().project.scale).toBeCloseTo(1000, 9) // 1000 drawing units per metre
  })
  it('rejects bad picks without changing project, zones or history', () => {
    importWith(meta('estimated'))
    const before = useProjectStore.getState()
    for (const args of [[{ x: 0, y: 0 }, { x: 0, y: 0 }, 5, 'm'], [{ x: 0, y: 0 }, { x: 5, y: 0 }, 0, 'm'], [{ x: 0, y: 0 }, { x: NaN, y: 0 }, 5, 'ft'], [{ x: 0, y: 0 }, { x: 5, y: 0 }, 5, 'parsec']] as const) {
      const r = before.calibrateScaleFromPoints(args[0], args[1], args[2], args[3] as never)
      expect(r.success).toBe(false)
      expect(r.error).toBeTruthy()
    }
    expect(useProjectStore.getState().project).toBe(before.project)
    expect(useProjectStore.getState().undoStack).toBe(before.undoStack)
  })
  it('is undoable, and a manual scale edit drops the user-calibrated provenance', () => {
    importWith(meta('estimated'))
    useProjectStore.getState().calibrateScaleFromPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 'ft')
    expect(useProjectStore.getState().project.scale).toBeCloseTo(10, 12)
    useProjectStore.getState().undo()
    expect(useProjectStore.getState().project.cadScaleProvenance).toBeUndefined()
    expect(useProjectStore.getState().project.cadUnitsConfirmed).toBe(false)
    useProjectStore.getState().redo()
    expect(useProjectStore.getState().project.cadScaleProvenance).toBe('user-calibrated')
    useProjectStore.getState().setProject({ scale: 12 })
    expect(useProjectStore.getState().project.cadScaleProvenance).toBeUndefined()
  })
  it('marks existing zones stale so engineering is recomputed at the calibrated scale', () => {
    importWith(meta('estimated'))
    useProjectStore.getState().setProject({ cadUnitsConfirmed: true })
    expect(approve().success).toBe(true)
    useProjectStore.getState().calibrateScaleFromPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 'ft')
    const s = useProjectStore.getState()
    expect(s.zones[0].engineeringStatus).toBe('stale')
    expect(calculateCanonicalZoneLoad(s.zones[0], s.project).area).toBeCloseTo(300, 6) // 20 x 15 ft at 10 units/ft
  })
  it('persists the provenance', () => {
    importWith(meta('estimated'))
    useProjectStore.getState().calibrateScaleFromPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 'ft')
    const s = useProjectStore.getState()
    const text = serializeProject({ project: s.project, zones: [], dxfEntities: s.dxfEntities, dxfBoundingBox: s.dxfBoundingBox, dxfLayers: s.dxfLayers })
    expect(parseProjectDocument(text).project.cadScaleProvenance).toBe('user-calibrated')
    const doc = JSON.parse(text); doc.project.cadScaleProvenance = 'guess'
    expect(() => parseProjectDocument(JSON.stringify(doc))).toThrow(/provenance/i)
  })
})
