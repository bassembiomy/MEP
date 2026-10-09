import { describe, expect, it, beforeEach } from 'vitest'
import * as manager from '../deploymentManager'
import { generateSystemCandidates, DEFAULT_OPTIMIZATION_WEIGHTS } from '../systemDesigner'
import { calculateCanonicalZoneLoad } from '../loadCalc'
import { footprintConflicts, ductConflicts, type CadApprovedObstacle } from '../cad/obstacleConflicts'
import type { DeploymentManifest, MechanicalComponent } from '../deploymentTypes'
import type { EquipmentCatalogItem, SystemDesignCandidate } from '../types'
import { useProjectStore, type Zone, type ProjectMetadata } from '../../store/projectStore'
import { obstaclesInZone } from '../cad/cadSemanticState'

const project: ProjectMetadata = {
  name: 'Fixture',
  location: 'Fixture',
  units: 'imperial',
  scale: 10,
  outdoorDb: 95,
  indoorDb: 75
}
const zone = (overrides: Partial<Zone> = {}): Zone => ({
  id: 'z',
  name: 'Fixture',
  points: [0, 0, 200, 0, 200, 200, 0, 200],
  spaceTypeId: 'office',
  ceilingHeight: 10,
  occupants: 2,
  manualCfmOverride: 600,
  diffusers: [],
  ducts: [],
  ...overrides
})
const equipment = (overrides: Partial<EquipmentCatalogItem> = {}): EquipmentCatalogItem => ({
  id: 'fixture',
  model: 'Fixture FCU',
  manufacturer: 'Fixture',
  systemType: 'fcu',
  nominalTons: 2.5,
  totalCapacityBtuPerHour: 30000,
  sensibleCapacityBtuPerHour: 24000,
  nominalCfm: 600,
  minCfm: 500,
  maxCfm: 1000,
  maxRatedEspInWg: 0.8,
  fanPerformance: {
    type: 'tabular',
    table: [
      { cfm: 500, espInWg: 0.8 },
      { cfm: 1000, espInWg: 0.8 }
    ],
    allowExtrapolation: false
  },
  capabilities: {
    supportsDuctNetwork: true,
    supportsExternalDiffusers: true,
    supportsReturnDuct: true,
    supportsMultipleZones: false,
    requiresIndoorUnitSelection: false,
    hasExternalStaticPressure: true
  },
  electricalKw: 1,
  efficiency: { ratingStandard: 'Fixture', ratingConditions: 'Fixture' },
  soundDba: 30,
  dimensionsIn: { width: 24, depth: 24, height: 10 },
  connectionSizes: { supplyDuct: '12x12', returnDuct: '12x12' },
  costIndex: 1,
  provenance: { source: 'Hand checked fixture', version: '1', isUserImported: false },
  ...overrides
})
const component: MechanicalComponent = {
  id: 'u',
  systemId: 's',
  floorId: 'f',
  zoneId: 'z',
  role: 'indoor-unit',
  model: 'Fixture FCU',
  systemType: 'fcu',
  position: { x: 20, y: 20 },
  rotationDeg: 0,
  elevationFt: 8,
  footprint: { minX: 10, maxX: 30, minY: 10, maxY: 30, widthWorld: 20, heightWorld: 20 },
  ports: [],
  isLocked: false
}
const manifest = (): DeploymentManifest =>
  ({
    manifestId: 'm',
    candidateId: 'c',
    systemId: 's',
    zoneId: 'z',
    systemType: 'fcu',
    designRevision: 'r',
    createdAt: 1,
    equipment: { indoorUnit: structuredClone(component) },
    terminals: [
      { id: 'supply', x: 60, y: 60, cfm: 600, size: '12x12', type: 'supply', deltaPInWg: 0.04 },
      { id: 'return', x: 40, y: 40, cfm: 540, size: '12x12', type: 'return', deltaPInWg: 0.04 }
    ],
    ducts: [
      {
        id: 'trunk',
        type: 'trunk',
        points: [20, 20, 60, 20],
        cfm: 600,
        widthIn: 12,
        heightIn: 12,
        sizeLabel: '12x12'
      },
      {
        id: 'branch',
        type: 'branch',
        points: [60, 20, 60, 60],
        cfm: 600,
        widthIn: 12,
        heightIn: 12,
        sizeLabel: '12x12'
      },
      {
        id: 'return-duct',
        type: 'return',
        points: [20, 20, 40, 40],
        cfm: 540,
        widthIn: 12,
        heightIn: 12,
        sizeLabel: '12x12'
      }
    ],
    piping: { refrigerantLines: [], condensateDrains: [] },
    componentsToAdd: [structuredClone(component)],
    componentsToUpdate: [],
    componentsToRemove: [],
    componentsToRetain: [],
    criticalPath: {
      pathId: 'fixture',
      terminalId: 'supply',
      supplySegments: [],
      returnSegments: [],
      totalSupplyDeltaPInWg: 0,
      totalReturnDeltaPInWg: 0,
      diffuserDeltaPInWg: 0,
      accessoriesDeltaPInWg: 0,
      totalLossInWg: 0,
      marginInWg: 0,
      espRequiredInWg: 0
    },
    diagnostics: [],
    isEligibleToApply: true,
    engineeringEvidence: {
      equipmentRecord: equipment(),
      quantity: 1,
      requiredSupplyCfm: 600,
      requiredReturnCfm: 540,
      requiredTotalBtuPerHour: 20000,
      requiredSensibleBtuPerHour: 16000,
      requiredLatentBtuPerHour: 4000,
      drawingUnitsPerFoot: 10,
      requiresOutdoorUnit: false
    }
  }) as DeploymentManifest
const execute = (m: DeploymentManifest, zones: Zone[], p?: ProjectMetadata) =>
  (manager.executeDeploymentTransaction as any)(m, zones, p)
const rejected = (m: DeploymentManifest, z = zone(), p?: ProjectMetadata) => {
  const zones = [z],
    before = structuredClone(zones)
  const result = execute(m, zones, p)
  expect(result.success).toBe(false)
  expect(result.updatedZones).toBe(zones)
  expect(zones).toEqual(before)
  expect(result.errorDiagnostic?.severity).toBe('error')
  return result
}
const box = (id: string, x0: number, y0: number, x1: number, y1: number, clearanceFt = 0): CadApprovedObstacle => ({
  id, status: 'approved', clearanceFt, polygon: [x0, y0, x1, y0, x1, y1, x0, y1]
})

describe('approved obstacles gate the applied deployment (W4)', () => {
  it('still applies when no obstacles are approved or the obstacles are far away', () => {
    expect(execute(manifest(), [zone()]).success).toBe(true)
    expect(execute(manifest(), [zone({ obstacles: [box('far', 150, 150, 170, 170, 1)] })]).success).toBe(true)
  })
  it('rejects an equipment footprint overlapping an approved obstacle, naming the obstacle, workspace unchanged', () => {
    const result = rejected(manifest(), zone({ obstacles: [box('col-1', 25, 25, 35, 35)] }))
    expect(result.errorDiagnostic.code).toBe('ERR_OBSTACLE_CONFLICT')
    expect(result.errorDiagnostic.message).toMatch(/equipment.*col-1|col-1.*equipment/i)
  })
  it('rejects a footprint that intrudes on the obstacle clearance band but allows it just outside', () => {
    // footprint spans x 10..30; the obstacle ends at x=0 (1.0 ft away at 10 units/ft)
    expect(rejected(manifest(), zone({ obstacles: [box('col', -10, 12, 0, 28, 1.5)] })).errorDiagnostic.code).toBe('ERR_OBSTACLE_CONFLICT')
    expect(execute(manifest(), [zone({ obstacles: [box('col', -10, 12, 0, 28, 1.0)] })]).success).toBe(true)
  })
  it('rejects a duct run crossing an obstacle and a duct inside the clearance band', () => {
    const crossing = rejected(manifest(), zone({ obstacles: [box('beam', 55, 35, 65, 45)] }))
    expect(crossing.errorDiagnostic.code).toBe('ERR_OBSTACLE_CONFLICT')
    expect(crossing.errorDiagnostic.message).toMatch(/duct.*branch.*beam|beam.*duct/i)
    // branch at x=60 is 12 in wide (0.5 ft half width); obstacle edge at x=75 -> clear gap 1.0 ft
    expect(execute(manifest(), [zone({ obstacles: [box('o', 75, 35, 85, 45, 1.0)] })]).success).toBe(true)
    expect(rejected(manifest(), zone({ obstacles: [box('o', 75, 35, 85, 45, 1.2)] })).errorDiagnostic.code).toBe('ERR_OBSTACLE_CONFLICT')
  })
  it('ignores anything that is not an approved obstacle', () => {
    const suggestion = { ...box('maybe', 25, 25, 35, 35), status: 'review-required' } as unknown as CadApprovedObstacle
    expect(execute(manifest(), [zone({ obstacles: [suggestion] })]).success).toBe(true)
  })
  it('agrees with the pure conflict checks it is built on', () => {
    const o = box('col-1', 25, 25, 35, 35, 0)
    expect(footprintConflicts({ x: 10, y: 10, width: 20, depth: 20 }, [o], { unitsPerFoot: 10 }).blocked).toBe(true)
    expect(ductConflicts({ a: { x: 60, y: 20 }, b: { x: 60, y: 60 }, widthFt: 1 }, [o], { unitsPerFoot: 10 }).blocked).toBe(false)
  })
  it('changes the zone deployment revision when approved obstacles change', () => {
    expect(manager.getZoneDeploymentRevision(zone())).not.toBe(manager.getZoneDeploymentRevision(zone({ obstacles: [box('a', 1, 1, 2, 2)] })))
    expect(manager.getZoneDeploymentRevision(zone())).toBe(manager.getZoneDeploymentRevision(zone({ obstacles: undefined })))
  })
})

describe('deployment manager branch detours (W4)', () => {
  const project2: ProjectMetadata = { name: 'T', location: 'C', scale: 10, units: 'imperial', outdoorDb: 95, indoorDb: 75 }
  const base = (obstacles?: CadApprovedObstacle[]): Zone => ({
    id: 'z1', name: 'Z', points: [0, 0, 400, 0, 400, 300, 0, 300], spaceTypeId: 'office', ceilingHeight: 10, occupants: 2,
    manualCfmOverride: 1200, diffusers: [], ducts: [], maxSpaceNcLimit: 30, maxVelocityLimitFpm: 1500, ...(obstacles ? { obstacles } : {})
  })
  const pick = (z: Zone) => {
    const load = calculateCanonicalZoneLoad(z, project2)
    return generateSystemCandidates(load.totalLoad, load.sensibleLoad, load.supplyCfm, 'office', load.area, true, DEFAULT_OPTIMIZATION_WEIGHTS, ['concealed']).candidates.find(c => c.isValid)!
  }
  const build = (z: Zone) => manager.buildDeploymentManifest(pick(z), z, [z], project2)
  const unobstructed = build(base())

  it('has an eligible baseline with straight branches (fixture sanity)', () => {
    expect(unobstructed.isEligibleToApply).toBe(true)
    expect(unobstructed.ducts.filter(d => d.type === 'branch').map(d => d.points.length)).toEqual([4, 4, 4, 4])
  })
  it('routes a branch around an approved obstacle and stays valid and conflict-free', () => {
    const o = box('beam', 85, 100, 115, 115, 0.5)
    const m = build(base([o]))
    expect(m.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    expect(m.isEligibleToApply).toBe(true)
    const detoured = m.ducts.find(d => d.id === 'duct-branch-z1-1-0')!
    expect(detoured.points.length).toBeGreaterThan(4)
    const straight = unobstructed.ducts.find(d => d.id === 'duct-branch-z1-1-0')!
    expect(detoured.points.slice(0, 2)).toEqual(straight.points.slice(0, 2))
    expect(detoured.points.slice(-2)).toEqual(straight.points.slice(-2))
    for (const d of m.ducts)
      for (let i = 0; i < d.points.length - 2; i += 2)
        expect(ductConflicts({ a: { x: d.points[i], y: d.points[i + 1] }, b: { x: d.points[i + 2], y: d.points[i + 3] }, widthFt: d.widthIn / 12 }, [o], { unitsPerFoot: 10 }).blocked).toBe(false)
    expect(m.diagnostics.some(d => d.code === 'WARN_OBSTACLE_DETOUR')).toBe(true)
    // untouched branches keep their geometry
    expect(m.ducts.find(d => d.id === 'duct-branch-z1-1-1')!.points).toEqual(unobstructed.ducts.find(d => d.id === 'duct-branch-z1-1-1')!.points)
    // and the detoured design really applies
    const z = base([o])
    expect(manager.executeDeploymentTransaction(m, [z], project2).success).toBe(true)
  })
  it('emits ERR_OBSTACLE_CONFLICT when no detour exists (terminal buried in an obstacle)', () => {
    const m = build(base([box('pit', 90, 65, 110, 85, 0.5)]))
    expect(m.isEligibleToApply).toBe(false)
    const err = m.diagnostics.find(d => d.code === 'ERR_OBSTACLE_CONFLICT')
    expect(err?.severity).toBe('error')
    expect(err?.message).toMatch(/duct-branch-z1-1-0/)
    expect(err?.message).toMatch(/pit/)
  })
  it('does not reroute trunks: a trunk crossing an obstacle blocks the design', () => {
    const m = build(base([box('post', 190, 140, 210, 160)]))
    expect(m.isEligibleToApply).toBe(false)
    expect(m.diagnostics.some(d => d.code === 'ERR_OBSTACLE_CONFLICT')).toBe(true)
    expect(m.ducts.find(d => d.id === 'duct-trunk-z1-1-1')!.points).toEqual(unobstructed.ducts.find(d => d.id === 'duct-trunk-z1-1-1')!.points)
  })
  it('blocks an equipment footprint on an obstacle (no relocation attempted)', () => {
    const m = build(base([box('bulk', 340, 260, 400, 300)]))
    expect(m.isEligibleToApply).toBe(false)
    expect(m.diagnostics.some(d => d.code === 'ERR_OBSTACLE_CONFLICT')).toBe(true)
  })
})

describe('zone obstacles derived from approved CAD obstacles (W4)', () => {
  const square = (x: number, y: number, s: number) => [x, y, x + s, y, x + s, y + s, x, y + s]
  const cand = (id: string, x: number, y: number, s: number, level = 0) => ({
    id, shape: 'polygon' as const, polygon: square(x, y, s), widthFt: s, depthFt: s, layer: 'S-COLS', sourceHandles: ['H' + id],
    confidence: 0.8, evidence: ['test'], status: 'review-required' as const, level
  })
  const z = (id: string, x: number): Zone => ({ id, name: id, points: [x, 0, x + 100, 0, x + 100, 100, x, 100], spaceTypeId: 'office', ceilingHeight: 10, occupants: 1, diffusers: [], ducts: [] })
  beforeEach(() => {
    useProjectStore.getState().clearDxfData()
    useProjectStore.setState({
      project: { name: 'P', location: 'L', units: 'imperial', scale: 10, outdoorDb: 95, indoorDb: 75 },
      zones: [z('a', 0), z('b', 300)], cadObstacles: [cand('in-a', 40, 40, 10), cand('in-b', 340, 40, 10), cand('straddle', 90, 40, 30), cand('elsewhere', 1000, 1000, 10)],
      undoStack: [], redoStack: []
    })
  })
  const zoneObs = (id: string) => useProjectStore.getState().zones.find(x => x.id === id)!.obstacles
  it('only approved obstacles inside (or overlapping) a zone appear on it, with their clearance', () => {
    expect(zoneObs('a')).toBeUndefined()
    useProjectStore.getState().approveCadObstacle('in-a', 1.5)
    expect(zoneObs('a')).toEqual([expect.objectContaining({ id: 'in-a', status: 'approved', clearanceFt: 1.5 })])
    expect(zoneObs('b')).toBeUndefined()
    useProjectStore.getState().approveCadObstacle('straddle', 0)
    expect(zoneObs('a')!.map(o => o.id).sort()).toEqual(['in-a', 'straddle'])
    useProjectStore.getState().approveCadObstacle('elsewhere', 1)
    expect(zoneObs('a')!.length + (zoneObs('b')?.length ?? 0)).toBe(2)
  })
  it('rejecting removes it, marks the zone stale, and undo restores the previous zone state', () => {
    useProjectStore.getState().approveCadObstacle('in-a', 1)
    useProjectStore.setState({ zones: useProjectStore.getState().zones.map(x => ({ ...x, engineeringStatus: 'preliminary' as const })) })
    useProjectStore.getState().rejectCadObstacle('in-a')
    expect(zoneObs('a')).toBeUndefined()
    expect(useProjectStore.getState().zones.find(x => x.id === 'a')!.engineeringStatus).toBe('stale')
    expect(useProjectStore.getState().zones.find(x => x.id === 'b')!.engineeringStatus).toBe('preliminary')
    useProjectStore.getState().undo()
    expect(zoneObs('a')).toHaveLength(1)
    useProjectStore.getState().undo()
    expect(zoneObs('a')).toBeUndefined()
  })
  it('re-derives when a zone outline is edited', () => {
    useProjectStore.getState().approveCadObstacle('in-b', 1)
    useProjectStore.getState().updateZone('a', { points: [300, 0, 400, 0, 400, 100, 300, 100] })
    expect(zoneObs('a')!.map(o => o.id)).toEqual(['in-b'])
  })
  it('obstaclesInZone handles circles and polygons that merely cross the outline', () => {
    const zp = [0, 0, 100, 0, 100, 100, 0, 100]
    expect(obstaclesInZone(zp, [{ id: 'c', status: 'approved', clearanceFt: 0, circle: { x: 50, y: 50, radius: 5 } }])).toHaveLength(1)
    expect(obstaclesInZone(zp, [{ id: 'x', status: 'approved', clearanceFt: 0, polygon: square(95, 40, 20) }])).toHaveLength(1)
    expect(obstaclesInZone(zp, [{ id: 'y', status: 'approved', clearanceFt: 0, polygon: square(200, 40, 20) }])).toHaveLength(0)
    expect(obstaclesInZone(zp, [{ id: 'w', status: 'approved', clearanceFt: 0, polygon: square(-50, -50, 300) }])).toHaveLength(1) // zone inside obstacle
  })
})

describe('obstacle wiring through the store and project file (W4)', () => {
  const project2: ProjectMetadata = { name: 'T', location: 'C', scale: 10, units: 'imperial', outdoorDb: 95, indoorDb: 75, cadUnitsConfirmed: true }
  const roomEntities = [{ type: 'LWPOLYLINE' as const, points: [0, 0, 400, 0, 400, 300, 0, 300], closed: true, handle: 'R1', layer: 'ROOM' }]
  const approvedColumn = (id: string, x: number, y: number, s: number) => ({
    id, shape: 'polygon' as const, polygon: [x, y, x + s, y, x + s, y + s, x, y + s], widthFt: s / 10, depthFt: s / 10, layer: 'S-COLS',
    sourceHandles: ['C' + id], confidence: 0.8, evidence: ['test'], status: 'approved' as const, level: 0, clearanceFt: 1
  })
  beforeEach(() => {
    useProjectStore.getState().clearDxfData()
    useProjectStore.setState({ project: project2, zones: [], dxfEntities: structuredClone(roomEntities), selectedZoneId: null, undoStack: [], redoStack: [],
      cadObstacles: [approvedColumn('in-room', 150, 100, 20), approvedColumn('outside', 900, 900, 20)] })
  })
  it('an approved CAD room carries the approved obstacles inside it and they survive save and load', async () => {
    const candidate = { id: 'room-R1', name: 'Office', polygon: [0, 0, 400, 0, 400, 300, 0, 300], areaSqFt: 1200, sourceHandles: ['R1'], sourceLayers: ['ROOM'], confidence: 1, status: 'review-required' as const, evidence: [], unresolvedConditions: [] }
    const run = useProjectStore.getState().recognizeCadRoomCandidates()
    expect(run.success).toBe(true)
    const r = useProjectStore.getState().approveCadRoom(candidate, { name: 'Office', spaceTypeId: 'office', ceilingHeight: 10, occupants: 2, sourceCadRevision: JSON.stringify(roomEntities), drawingUnitsPerFoot: 10, recognitionContext: run.recognitionContext! })
    expect(r.success).toBe(true)
    const z = useProjectStore.getState().zones[0]
    expect(z.obstacles?.map(o => o.id)).toEqual(['in-room'])
    expect(z.obstacles![0]).toMatchObject({ status: 'approved', clearanceFt: 1 })
    const { serializeProject, parseProjectDocument } = await import('../project/projectSerialization')
    const st = useProjectStore.getState()
    const text = serializeProject({ project: st.project, zones: st.zones, dxfEntities: st.dxfEntities, dxfBoundingBox: st.dxfBoundingBox, dxfLayers: st.dxfLayers })
    expect(parseProjectDocument(text).zones[0].obstacles).toEqual(z.obstacles)
    const doc = JSON.parse(text); doc.zones[0].obstacles[0].status = 'review-required'
    expect(() => parseProjectDocument(JSON.stringify(doc))).toThrow(/approved/i)
  })
  it('applyCandidateTransaction refuses a layout that violates an approved obstacle and leaves the workspace untouched', () => {
    const zone2: Zone = { id: 'z1', name: 'Z', points: [0, 0, 400, 0, 400, 300, 0, 300], spaceTypeId: 'office', ceilingHeight: 10, occupants: 2,
      manualCfmOverride: 1200, diffusers: [], ducts: [], maxSpaceNcLimit: 30, maxVelocityLimitFpm: 1500 }
    const load = calculateCanonicalZoneLoad(zone2, project2)
    const cand = generateSystemCandidates(load.totalLoad, load.sensibleLoad, load.supplyCfm, 'office', load.area, true, DEFAULT_OPTIMIZATION_WEIGHTS, ['concealed']).candidates.find(c => c.isValid)!
    // a column on the trunk at y=150 (cannot be rerouted)
    useProjectStore.setState({ zones: [{ ...zone2, obstacles: [{ id: 'post', status: 'approved', clearanceFt: 0.5, polygon: [190, 140, 210, 140, 210, 160, 190, 160] }] }], selectedZoneId: 'z1' })
    const before = useProjectStore.getState()
    const out = before.applyCandidateTransaction(cand)
    expect(out.success).toBe(false)
    expect(out.error).toMatch(/post/)
    expect(useProjectStore.getState().zones).toBe(before.zones)
    expect(useProjectStore.getState().undoStack).toBe(before.undoStack)
    // without the obstacle the same candidate applies
    useProjectStore.setState({ zones: [zone2] })
    expect(useProjectStore.getState().applyCandidateTransaction(cand).success).toBe(true)
  })
})
