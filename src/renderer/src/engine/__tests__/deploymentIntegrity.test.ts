import { describe, expect, it } from 'vitest'
import * as manager from '../deploymentManager'
import { planCassetteDistribution, isRectContainedInPolygon } from '../spatialPlanner'
import { STANDARD_EQUIPMENT_CATALOG } from '../hvacCatalogs'
import * as validation from '../deploymentValidation'
import { STANDARD_DIFFUSER_CATALOG } from '../hvacCatalogs'
import type { DeploymentManifest, MechanicalComponent } from '../deploymentTypes'
import type { EquipmentCatalogItem, SystemDesignCandidate } from '../types'
import type { Zone, ProjectMetadata } from '../../store/projectStore'

it('invalidates deployment evidence when CAD unit confirmation changes', () => {
  expect(manager.getProjectDeploymentRevision({...project,cadUnitsConfirmed:false}))
    .not.toBe(manager.getProjectDeploymentRevision({...project,cadUnitsConfirmed:true}))
})

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
const candidate = (overrides: Partial<SystemDesignCandidate> = {}): SystemDesignCandidate =>
  ({
    id: 'candidate',
    systemType: 'fcu',
    equipment: equipment(),
    quantity: 1,
    diffusers: {
      diffuserRecord: STANDARD_DIFFUSER_CATALOG[0],
      quantity: 2,
      cfmPerUnit: 300,
      actualNc: 25,
      throwT50Ft: 10,
      deltaPInWg: 0.04
    },
    isValid: true,
    diagnostics: [],
    subscores: {},
    tradeOffSummary: 'fixture',
    ...overrides
  }) as SystemDesignCandidate

describe('atomic engineering deployment', () => {
  it('rejects duct dimensions above configured ceiling depth', () => {
    const result = rejected(manifest(), zone({ maxAvailableCeilingDepthIn: 8 } as Partial<Zone>))
    expect(result.errorDiagnostic?.message).toMatch(/depth/i)
  })
  it('recomputes velocity despite falsely low stored velocity metadata', () => {
    const m = manifest()
    m.ducts.forEach((d) => (d.velocityFpm = 1))
    const result = rejected(m, zone({ maxVelocityLimitFpm: 400 }))
    expect(result.errorDiagnostic?.message).toMatch(/velocity/i)
  })
  it('rejects an excessive default rectangular aspect ratio even when pressure is sufficient', () => {
    const m = manifest()
    m.ducts[0].widthIn = 48
    const result = rejected(m)
    expect(result.errorDiagnostic?.message).toMatch(/aspect/i)
  })
  it('checks configured aspect ratio', () => {
    const m = manifest()
    m.ducts[0].widthIn = 30
    rejected(m, zone({ maxDuctAspectRatio: 2 } as Partial<Zone>))
  })
  it('rejects oversized square duct height even without declared ceiling depth', () => {
    const m = manifest()
    m.ducts[0].widthIn = 120
    m.ducts[0].heightIn = 120
    rejected(m)
  })
  it('allows exact aspect, depth and actual velocity boundaries', () => {
    const m = manifest()
    m.ducts[0].widthIn = 36
    expect(
      execute(m, [
        zone({
          maxAvailableCeilingDepthIn: 12,
          maxDuctAspectRatio: 3,
          maxVelocityLimitFpm: 600
        } as Partial<Zone>)
      ]).success
    ).toBe(true)
  })
  it('rejects a duct taller than the actual room even if a larger plenum was declared', () => {
    const m = manifest()
    m.ducts[0].widthIn = 144
    m.ducts[0].heightIn = 144
    rejected(m, zone({ maxAvailableCeilingDepthIn: 200 } as Partial<Zone>))
  })
  it('rejects fabricated indoor footprint dimensions', () => {
    const m = manifest()
    m.equipment.indoorUnit!.footprint.widthWorld = 1
    const result = rejected(m)
    expect(result.errorDiagnostic?.message).toMatch(/catalog|footprint/i)
  })
  it('blocks missing physical catalog dimensions', () => {
    const m = manifest()
    delete (m.engineeringEvidence!.equipmentRecord as any).dimensionsIn
    rejected(m)
  })
  it('validates rotated catalog footprint dimensions', () => {
    const m = manifest(),
      u = m.equipment.indoorUnit!
    m.engineeringEvidence!.equipmentRecord.dimensionsIn.depth = 12
    u.rotationDeg = 90
    u.footprint = { minX: 15, maxX: 25, minY: 10, maxY: 30, widthWorld: 10, heightWorld: 20 }
    expect(execute(m, [zone()]).success).toBe(true)
    u.footprint.widthWorld = 20
    u.footprint.heightWorld = 10
    rejected(m)
  })
  it('marks generic pressure trace and undeclared actual ceiling depth as provisional', () => {
    const z = zone(),
      m = manager.buildDeploymentManifest(candidate(), z, [z], project)
    expect(
      m.diagnostics.some(
        (d) =>
          d.severity === 'warning' && /pressure.*provisional|provisional.*pressure/i.test(d.message)
      )
    ).toBe(true)
    expect(
      m.diagnostics.some(
        (d) =>
          d.severity === 'warning' && /ceiling.*unverified|unverified.*ceiling/i.test(d.message)
      )
    ).toBe(true)
  })
  it('generates physically equivalent catalog footprints at imperial scale 1, scale 10 and metric scale 1', () => {
    const imperial1 = zone({ points: [0, 0, 20, 0, 20, 20, 0, 20] }),
      imperial10 = zone()
    const metric = zone({
      points: [0, 0, 6.096, 0, 6.096, 6.096, 0, 6.096],
      ceilingHeight: 3.048,
      manualCfmOverride: 283.16846592
    })
    const metricProject = {
      ...project,
      units: 'metric' as const,
      scale: 1,
      outdoorDb: 35,
      indoorDb: (75 - 32) / 1.8
    }
    const manifests = [
      manager.buildDeploymentManifest(candidate(), imperial1, [imperial1], {
        ...project,
        scale: 1
      }),
      manager.buildDeploymentManifest(candidate(), imperial10, [imperial10], project),
      manager.buildDeploymentManifest(candidate(), metric, [metric], metricProject)
    ]
    // Placement is axis-aligned, so this 2 ft square keeps a 2 ft bounding box
    // in each physically equivalent drawing (2 ft, 20 drawing units, 0.6096 m).
    for (const [i, expected] of [
      2, 20, 0.6096
    ].entries()) {
      expect(manifests[i].isEligibleToApply, JSON.stringify(manifests[i].diagnostics)).toBe(true)
      expect(manifests[i].equipment.indoorUnit?.footprint.widthWorld).toBeCloseTo(expected, 8)
      expect(manifests[i].equipment.indoorUnit?.footprint.heightWorld).toBeCloseTo(expected, 8)
    }
    expect(manifests[0].equipment.indoorUnit!.position.x).toBeCloseTo(
      manifests[1].equipment.indoorUnit!.position.x / 10,
      8
    )
    expect(manifests[0].equipment.indoorUnit!.position.x).toBeCloseTo(
      manifests[2].equipment.indoorUnit!.position.x / 0.3048,
      8
    )
  })
  it('blocks partially missing legacy engineering evidence', () => {
    const m = manifest()
    delete (m.engineeringEvidence as any).requiredTotalBtuPerHour
    rejected(m)
  })
  it('recomputes friction for undersized locked ducts rather than trusting a design friction target', () => {
    const m = manifest()
    rejected(
      m,
      zone({ isDuctLocked: true, ducts: m.ducts.map((d) => ({ ...d, widthIn: 1, heightIn: 1 })) })
    )
  })
  it('uses the longest connected supply path rather than summing parallel branches', () => {
    const m = manifest()
    m.engineeringEvidence!.drawingUnitsPerFoot = 1
    m.equipment.indoorUnit!.footprint = {
      minX: 19,
      maxX: 21,
      minY: 19,
      maxY: 21,
      widthWorld: 2,
      heightWorld: 2
    }
    m.engineeringEvidence!.equipmentRecord.maxRatedEspInWg = 0.52
    m.terminals = [
      { ...m.terminals[0], id: 'a', x: 60, y: 100, cfm: 300 },
      { ...m.terminals[0], id: 'b', x: 180, y: 20, cfm: 300 },
      m.terminals[1]
    ]
    m.ducts = [
      m.ducts[0],
      { ...m.ducts[1], id: 'a-duct', points: [60, 20, 60, 100], cfm: 300 },
      { ...m.ducts[1], id: 'b-duct', points: [60, 20, 180, 20], cfm: 300 },
      m.ducts[2]
    ]
    const result = execute(m, [zone()])
    expect(result.success, result.errorDiagnostic?.message).toBe(true)
    expect(result.updatedZones[0].catalogEsp).toBe('0.48 in.wg')
  })
  it('applies a hand checked connected FCU with no outdoor unit and recomputes its pressure', () => {
    const original = zone(),
      zones = [original],
      m = manifest()
    const result = execute(m, zones)
    expect(result.success).toBe(true)
    expect(result.updatedZones[0].diffusers).toEqual(m.terminals)
    expect(result.updatedZones[0].catalogEsp).not.toBeUndefined()
    expect(original.diffusers).toEqual([])
  })
  it('rejects ineligible manifests', () => {
    rejected({ ...manifest(), isEligibleToApply: false })
  })
  it('rejects error diagnostics even with tampered eligibility', () => {
    rejected({
      ...manifest(),
      diagnostics: [{ code: 'ERR_NO_VALID_DUCT_ROUTE', severity: 'error', message: 'blocked' }]
    })
  })
  it('blocks legacy manifests without explicit engineering evidence', () => {
    const m = manifest()
    delete (m as any).engineeringEvidence
    rejected(m)
  })
  it('checks an existing source zone revision before applying', () => {
    rejected({ ...manifest(), sourceZoneRevision: 'stale' } as DeploymentManifest)
  })
  it('requires project evidence for generated project revisions', () => {
    rejected({ ...manifest(), sourceProjectRevision: 'generated' } as DeploymentManifest)
  })
  it('rejects edited zone and project snapshots', () => {
    const z = zone(),
      m = manager.buildDeploymentManifest(candidate(), z, [z], project)
    rejected(
      { ...m, isEligibleToApply: true, diagnostics: [] },
      zone({ manualCfmOverride: 700 }),
      project
    )
    rejected({ ...m, isEligibleToApply: true, diagnostics: [] }, z, { ...project, scale: 20 })
  })
  it('preserves compatible locks after engineering validation', () => {
    const m = manifest()
    expect(
      execute(m, [
        zone({
          diffusers: m.terminals,
          ducts: m.ducts,
          unitPos: { x: 20, y: 20 },
          unitPositions: [{ x: 20, y: 20 }],
          catalogModel: 'Fixture FCU',
          catalogQty: 1,
          systemType: 'fcu',
          isEquipmentLocked: true,
          isDiffusersLocked: true,
          isDuctLocked: true
        })
      ]).success
    ).toBe(true)
  })
  it('rejects locked diffusers that change delivered airflow', () => {
    rejected(
      manifest(),
      zone({
        isDiffusersLocked: true,
        diffusers: manifest().terminals.map((t) => ({ ...t, cfm: t.cfm / 2 }))
      })
    )
  })
  it('rejects locked equipment from a different catalog model', () => {
    rejected(
      manifest(),
      zone({
        isEquipmentLocked: true,
        catalogModel: 'Different',
        catalogQty: 1,
        unitPos: { x: 20, y: 20 }
      })
    )
  })
  it('rejects locked equipment moved away from duct roots', () => {
    rejected(
      manifest(),
      zone({
        isEquipmentLocked: true,
        catalogModel: 'Fixture FCU',
        catalogQty: 1,
        systemType: 'fcu',
        unitPos: { x: 30, y: 30 },
        unitPositions: [{ x: 30, y: 30 }]
      })
    )
  })
  it('rejects locked duct geometry outside the room', () => {
    rejected(
      manifest(),
      zone({
        isDuctLocked: true,
        ducts: manifest().ducts.map((d) =>
          d.id === 'branch' ? { ...d, points: [60, 20, 300, 60] } : d
        )
      })
    )
  })
  it('rejects disconnected terminals despite plausible pressure metadata', () => {
    const m = manifest()
    m.terminals[0].x = 70
    rejected(m)
  })
  it('rejects missing return routes', () => {
    const m = manifest()
    m.ducts = m.ducts.filter((d) => d.type !== 'return')
    rejected(m)
  })
  it('rejects disconnected ducts', () => {
    const m = manifest()
    m.ducts[1].points = [80, 20, 60, 60]
    rejected(m)
  })
  it('rejects duct junction airflow inconsistency', () => {
    const m = manifest()
    m.ducts[0].cfm = 500
    rejected(m)
  })
  it('checks full containment across a concave recess', () => {
    const m = manifest()
    m.ducts[0].points = [20, 20, 180, 180]
    rejected(
      m,
      zone({ points: [0, 0, 200, 0, 200, 200, 150, 200, 150, 50, 50, 50, 50, 200, 0, 200] })
    )
  })
  it.each(['totalCapacityBtuPerHour', 'sensibleCapacityBtuPerHour'] as const)(
    'rejects deficient %s',
    (key) => {
      const m = manifest()
      ;(m as any).engineeringEvidence.equipmentRecord[key] = 10000
      rejected(m)
    }
  )
  it('rejects deficient latent capacity', () => {
    const m = manifest()
    ;(m as any).engineeringEvidence.equipmentRecord.sensibleCapacityBtuPerHour = 29000
    rejected(m)
  })
  it('rechecks fan pressure using actual routes, not claimed critical path', () => {
    const m = manifest()
    ;(m as any).engineeringEvidence.equipmentRecord.maxRatedEspInWg = 0.1
    rejected(m)
  })
  it('rejects fan table extrapolation when prohibited', () => {
    const m = manifest()
    ;(m as any).engineeringEvidence.equipmentRecord.fanPerformance.table = [
      { cfm: 700, espInWg: 0.8 },
      { cfm: 1000, espInWg: 0.8 }
    ]
    rejected(m)
  })
  it('rejects NaN terminal flow', () => {
    const m = manifest()
    m.terminals[0].cfm = NaN
    rejected(m)
  })
  it('blocks invalid candidates and candidate error diagnostics during generation', () => {
    for (const c of [
      candidate({ isValid: false }),
      candidate({
        diagnostics: [
          { code: 'capacity', severity: 'error', message: 'insufficient', remediation: 'resize' }
        ]
      })
    ])
      expect(manager.buildDeploymentManifest(c, zone(), [zone()], project).isEligibleToApply).toBe(
        false
      )
  })
  it('generates canonical metric airflow and drawing scale evidence', () => {
    const metricProject = {
      ...project,
      units: 'metric' as const,
      scale: 32.80839895,
      outdoorDb: 35,
      indoorDb: 23.88888889
    }
    const z = zone({ ceilingHeight: 3.048, manualCfmOverride: 283.16846592 })
    const m = manager.buildDeploymentManifest(candidate(), z, [z], metricProject) as any
    expect(m.engineeringEvidence.requiredSupplyCfm).toBeCloseTo(600, 0)
    expect(m.engineeringEvidence.drawingUnitsPerFoot).toBeCloseTo(10, 6)
    expect(m.sourceZoneRevision).toEqual(expect.any(String))
    expect(m.sourceProjectRevision).toEqual(expect.any(String))
  })
  it('applies a valid generated ducted FCU at the calculated return demand', () => {
    const z = zone(),
      m = manager.buildDeploymentManifest(candidate(), z, [z], project)
    const result = execute(m, [z], project)
    expect(result.success, JSON.stringify(m.diagnostics)).toBe(true)
    expect(m.isEligibleToApply).toBe(true)
    expect(m.equipment.outdoorUnit).toBeUndefined()
  })
  it('applies valid high-wall equipment with intrinsic delivery and no external terminals', () => {
    const z = zone(),
      c = candidate({
        systemType: 'high-wall',
        equipment: equipment({
          systemType: 'high-wall',
          capabilities: {
            supportsDuctNetwork: false,
            supportsExternalDiffusers: false,
            supportsReturnDuct: false,
            supportsMultipleZones: false,
            requiresIndoorUnitSelection: true,
            hasExternalStaticPressure: false
          }
        })
      })
    const m = manager.buildDeploymentManifest(c, z, [z], project),
      result = execute(m, [z], project)
    expect(result.success, result.errorDiagnostic?.message).toBe(true)
    expect(result.updatedZones[0].diffusers).toEqual([])
  })
  it('rejects generated manifests whose claimed load evidence was lowered', () => {
    const z = zone(),
      m = manager.buildDeploymentManifest(candidate(), z, [z], project)
    m.engineeringEvidence!.requiredTotalBtuPerHour = 0
    rejected(m, z, project)
  })
  it('commits copies so later preview edits cannot mutate deployed components', () => {
    const m = manifest(),
      result = execute(m, [zone()])
    expect(result.success).toBe(true)
    m.terminals[0].cfm = 1
    m.ducts[0].points[0] = 1000
    expect(result.updatedZones[0].diffusers[0].cfm).toBe(600)
    expect(result.updatedZones[0].ducts[0].points[0]).toBe(20)
  })
})

describe('engineering flow and footprint integrity for realistic rooms', () => {
  const flatFan = (minCfm: number) => ({
    minCfm,
    fanPerformance: {
      type: 'tabular' as const,
      table: [{ cfm: minCfm, espInWg: 0.8 }, { cfm: 1000, espInWg: 0.8 }],
      allowExtrapolation: false
    }
  })
  const big = (overrides: Partial<Zone> = {}) =>
    zone({ points: [0, 0, 300, 0, 300, 250, 0, 250], manualCfmOverride: undefined, ...overrides })

  it('delivers exactly the calculated supply airflow through a branched 30x25 ft layout for 2 people', () => {
    const z = big()
    const m = manager.buildDeploymentManifest(candidate({ equipment: equipment(flatFan(300)) }), z, [z], project)
    expect(m.diagnostics.map((d) => d.message).join('|')).not.toMatch(/supply or return airflow/)
    const supply = m.terminals.filter((t) => t.type !== 'return').reduce((s, t) => s + t.cfm, 0)
    expect(Math.abs(supply - m.engineeringEvidence!.requiredSupplyCfm)).toBeLessThan(1e-6)
    expect(m.isEligibleToApply).toBe(true)
    expect(execute(m, [z], project).success).toBe(true)
  })

  it('splits cassette airflow without rounding drift', () => {
    const res = planCassetteDistribution([0, 0, 300, 0, 300, 250, 0, 250], 3, 442.767, 's', 'z', 'Cassette')
    expect(res.diffusers.length).toBe(3)
    for (const d of res.diffusers) expect(d.cfm).toBeCloseTo(442.767 / 3, 9)
  })

  it.each([
    ['53QDMT-24N', { width: 43.3, depth: 27.6, height: 10 }],
    ['53QDMT-36N', { width: 51.2, depth: 31.5, height: 10 }],
    ['42CE-16', { width: 62, depth: 28, height: 10 }],
    ['42QSS120-D', { width: 74, depth: 38, height: 10 }]
  ])('places %s fully inside a 30x25 ft room', (_name, dimensionsIn) => {
    const z = big({ manualCfmOverride: 600 })
    const m = manager.buildDeploymentManifest(candidate({ equipment: equipment({ ...flatFan(300), dimensionsIn }) }), z, [z], project)
    expect(m.diagnostics.map((d) => d.message).join('|')).not.toMatch(/footprint is outside zone/i)
    expect(m.isEligibleToApply).toBe(true)
    expect(execute(m, [z], project).success).toBe(true)
  })

  it('reports an oversized unit as a planning diagnostic rather than placing it outside the zone', () => {
    const z = zone({ points: [0, 0, 50, 0, 50, 30, 0, 30], manualCfmOverride: 600 })
    const m = manager.buildDeploymentManifest(
      candidate({ equipment: equipment({ ...flatFan(300), dimensionsIn: { width: 74, depth: 38, height: 10 } }) }), z, [z], project)
    expect(m.isEligibleToApply).toBe(false)
    expect(m.diagnostics.some((d) => d.severity === 'error' && d.code === 'ERR_COMPONENT_OUTSIDE_ZONE')).toBe(true)
  })

  it('keeps a tightly fitting unit connected to its ducts', () => {
    const z = zone({ points: [0, 0, 300, 0, 300, 30, 0, 30], manualCfmOverride: 600 })
    const m = manager.buildDeploymentManifest(
      candidate({ equipment: equipment({ ...flatFan(300), dimensionsIn: { width: 62, depth: 28, height: 10 } }) }), z, [z], project)
    expect(m.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([])
    expect(m.isEligibleToApply).toBe(true)
  })

  it('fits a unit into a corridor only slightly wider than its footprint', () => {
    const z = zone({ points: [0, 0, 300, 0, 300, 35, 0, 35], manualCfmOverride: 600 })
    const m = manager.buildDeploymentManifest(
      candidate({ equipment: equipment({ ...flatFan(300), dimensionsIn: { width: 74, depth: 38, height: 10 } }) }), z, [z], project)
    expect(m.diagnostics.map((d) => d.message).join('|')).not.toMatch(/cannot fit|footprint is outside zone/i)
  })

  it('computes the rotated bounding box of a catalog footprint', () => {
    const fp = validation.getEquipmentFootprintWorld(equipment({ dimensionsIn: { width: 24, depth: 24, height: 10 } }), 10, 45)
    expect(fp.widthWorld).toBeCloseTo(20 * Math.SQRT2 / 1, 6)
  })
})

describe('cassette count enforcement and footprint containment', () => {
  const cass = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-lg-round-cass-24k')!
  const fp = { width: (cass.dimensionsIn!.width / 12) * 10, depth: (cass.dimensionsIn!.depth / 12) * 10 }
  const rect = [0, 0, 300, 0, 300, 250, 0, 250]
  const lShape = [0, 0, 300, 0, 300, 150, 150, 150, 150, 300, 0, 300]
  const plan = (pts: number[], qty: number, cfm = 600, footprint: { width: number; depth: number } | undefined = fp) =>
    (planCassetteDistribution as any)(pts, qty, cfm, 's', 'z', 'Cassette', 32, footprint)
  const overlap = (a: any, b: any) =>
    a.footprint.minX < b.footprint.maxX - 1e-9 && b.footprint.minX < a.footprint.maxX - 1e-9 &&
    a.footprint.minY < b.footprint.maxY - 1e-9 && b.footprint.minY < a.footprint.maxY - 1e-9

  it.each([[rect, 3], [rect, 4], [lShape, 3], [lShape, 4]])('contains every catalog footprint without overlap (qty %#)', (pts, qty) => {
    const res = plan(pts, qty, 442.767)
    expect(res.diagnostics.filter((d: any) => d.severity === 'error')).toEqual([])
    expect(res.components.length).toBe(qty)
    expect(res.diffusers.length).toBe(qty)
    for (const c of res.components) {
      expect(c.footprint.widthWorld).toBeCloseTo(fp.width, 9)
      expect(isRectContainedInPolygon(c.position.x, c.position.y, fp.width, fp.depth, pts)).toBe(true)
    }
    for (let i = 0; i < qty; i++) for (let j = i + 1; j < qty; j++) expect(overlap(res.components[i], res.components[j])).toBe(false)
    expect(Math.abs(res.diffusers.reduce((s: number, d: any) => s + d.cfm, 0) - 442.767)).toBeLessThan(1e-6)
  })

  it('never silently returns fewer cassettes than requested for an L-shaped room', () => {
    const res = plan(lShape, 4)
    const errors = res.diagnostics.filter((d: any) => d.severity === 'error' && /^ERR_/.test(d.code))
    expect(res.components.length === 4 || errors.length > 0).toBe(true)
  })

  it('reports an error diagnostic when 4 cassettes cannot physically fit in an 8x8 ft room', () => {
    const big = { width: (60 / 12) * 10, depth: (60 / 12) * 10 }
    const res = plan([0, 0, 80, 0, 80, 80, 0, 80], 4, 600, big)
    expect(res.diagnostics.some((d: any) => d.severity === 'error' && d.code === 'ERR_COMPONENT_OUTSIDE_ZONE')).toBe(true)
  })

  it('deploys a full 3-cassette manifest for the 30x25 ft room', () => {
    const z = zone({ points: rect, manualCfmOverride: undefined })
    const c = candidate({
      systemType: 'cassette',
      quantity: 3,
      diffusers: undefined,
      equipment: cass
    } as any)
    const m = manager.buildDeploymentManifest(c, z, [z], project)
    expect(m.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([])
    expect(m.isEligibleToApply).toBe(true)
    expect(m.equipment.cassetteUnits?.length).toBe(3)
    expect(m.terminals.length).toBe(3)
    expect(execute(m, [z], project).success).toBe(true)
  })
})
