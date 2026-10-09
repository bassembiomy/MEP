import { describe, expect, it } from 'vitest'
import { generateSystemCandidates } from '../systemDesigner'
import { calculateCanonicalZoneLoad } from '../loadCalc'
import { buildDeploymentManifest, executeDeploymentTransaction } from '../deploymentManager'
import { validateAppliedDeployment } from '../deploymentValidation'
import { calculateFittingLoss } from '../staticPressureCalc'
import {
  FILTER_ALLOWANCE_IN_WG,
  PRESSURE_SAFETY_FACTOR,
  requiredExternalStaticPressure,
  availableFanPressureAtFlow
} from '../pressureBudget'
import type { Zone, ProjectMetadata } from '../../store/projectStore'
import type { SystemDesignCandidate } from '../types'

const imperial: ProjectMetadata = { name: 'F', location: 'F', units: 'imperial', scale: 10, outdoorDb: 95, indoorDb: 75 }
const metric: ProjectMetadata = { name: 'F', location: 'F', units: 'metric', scale: 1, outdoorDb: 35, indoorDb: 23.8888889 }

// Mirrors the zone the store creates for an auto-deployed drawn room.
const draft = (points: number[], occupants: number, units: 'imperial' | 'metric' = 'imperial'): Zone => ({
  id: 'z',
  name: 'F',
  points,
  spaceTypeId: 'office',
  ceilingHeight: units === 'metric' ? 3.048 : 10,
  occupants,
  systemType: 'concealed',
  distributionPattern: 'hexagonal',
  coverageTargetPercent: 100,
  diffusers: [],
  ducts: [],
  maxVelocityLimitFpm: 1200,
  maxSpaceNcLimit: 32
})
const rect = (wFt: number, hFt: number, k = 10) => [0, 0, wFt * k, 0, wFt * k, hFt * k, 0, hFt * k]
const bboxFt = (z: Zone, p: ProjectMetadata) => {
  const xs = z.points.filter((_, i) => i % 2 === 0), ys = z.points.filter((_, i) => i % 2 === 1)
  const upf = p.scale * (p.units === 'metric' ? 0.3048 : 1)
  return { widthFt: (Math.max(...xs) - Math.min(...xs)) / upf, heightFt: (Math.max(...ys) - Math.min(...ys)) / upf }
}

const fixtures: [string, Zone, ProjectMetadata][] = [
  ['30x25 ft, 2 people', draft(rect(30, 25), 2), imperial],
  ['20x15 ft, 2 people', draft(rect(20, 15), 2), imperial],
  ['40x30 ft, 6 people', draft(rect(40, 30), 6), imperial],
  ['L-shape fixture', draft([100, 100, 400, 100, 400, 250, 250, 250, 250, 400, 100, 400], 1), imperial],
  ['30x25 ft metric copy', draft(rect(30, 25, 0.3048), 2, 'metric'), metric]
]

const generate = (z: Zone, p: ProjectMetadata, withExtent = true) => {
  const L = calculateCanonicalZoneLoad(z, p)
  const result = generateSystemCandidates(
    L.totalLoad, L.sensibleLoad, L.supplyCfm, 'office', L.area, true, undefined as never,
    ['concealed', 'fcu'], null, [], [], withExtent ? bboxFt(z, p) : undefined
  )
  return { L, result }
}
const ducted = (cs: SystemDesignCandidate[]) => cs.filter((c) => c.equipment.capabilities.supportsDuctNetwork)

describe('shared pressure budget primitives', () => {
  it('derives the filter allowance from the fitting catalogue and applies the 15% safety factor', () => {
    expect(FILTER_ALLOWANCE_IN_WG).toBe(calculateFittingLoss('filter-merv8', 800).deltaPInWg)
    expect(PRESSURE_SAFETY_FACTOR).toBe(1.15)
    expect(requiredExternalStaticPressure({ supplyPathInWg: 0.2, returnPathInWg: 0.1 })).toBeCloseTo((0.3 + FILTER_ALLOWANCE_IN_WG) * 1.15, 12)
  })
})

describe('generator and deployment share one pressure budget', () => {
  it.each(fixtures)('%s: every candidate the generator marks valid deploys without a fan-pressure rejection', (_n, z, p) => {
    const { result } = generate(z, p)
    for (const c of ducted(result.candidates).filter((x) => x.isValid)) {
      const m = buildDeploymentManifest(c, z, [z], p)
      const fan = m.diagnostics.filter((d) => /fan pressure/i.test(d.message)).map((d) => `${c.equipment.model} x${c.quantity}: ${d.message}`)
      expect(fan).toEqual([])
    }
  })

  it.each(fixtures)('%s: the generator estimate is never below the pressure deployment computes', (_n, z, p) => {
    const { result } = generate(z, p)
    for (const c of ducted(result.candidates).filter((x) => x.isValid)) {
      const m = buildDeploymentManifest(c, z, [z], p)
      if (!m.isEligibleToApply) continue
      const tx = executeDeploymentTransaction(m, [z], p)
      if (!tx.success) continue
      const deployed = parseFloat(tx.updatedZones[0].catalogEsp ?? '0')
      expect(c.ductwork!.criticalPath.espRequiredInWg + 0.005, `${c.equipment.model} x${c.quantity}`).toBeGreaterThanOrEqual(deployed)
    }
  })

  it('without explicit room extents the estimate is still conservative for the bundled 30x25 ft room', () => {
    const [, z, p] = fixtures[0]
    const { result } = generate(z, p, false)
    for (const c of ducted(result.candidates).filter((x) => x.isValid)) {
      const m = buildDeploymentManifest(c, z, [z], p)
      expect(m.diagnostics.filter((d) => /fan pressure/i.test(d.message)).map((d) => d.message)).toEqual([])
    }
  })

  it('53QDMT-18N for the 30x25 ft office is either rejected with ERR_FAN_ESP_DEFICIT or actually deploys', () => {
    const [, z, p] = fixtures[0]
    const { result } = generate(z, p)
    const c = result.candidates.find((x) => x.equipment.model.includes('53QDMT-18N'))
    expect(c).toBeDefined()
    if (c!.isValid) {
      const m = buildDeploymentManifest(c!, z, [z], p)
      expect(m.diagnostics.filter((d) => /fan pressure/i.test(d.message))).toEqual([])
    } else {
      expect(c!.diagnostics.some((d) => d.code === 'ERR_FAN_ESP_DEFICIT')).toBe(true)
    }
  })

  it.each(fixtures)('%s: critical path includes accessories in total loss and carries the safety factor', (_n, z, p) => {
    const { result } = generate(z, p)
    for (const c of ducted(result.candidates)) {
      const cp = c.ductwork!.criticalPath
      const parts = cp.totalSupplyDeltaPInWg + cp.totalReturnDeltaPInWg + cp.diffuserDeltaPInWg + cp.accessoriesDeltaPInWg
      expect(cp.accessoriesDeltaPInWg).toBeGreaterThanOrEqual(FILTER_ALLOWANCE_IN_WG - 1e-9)
      expect(cp.totalLossInWg).toBeGreaterThanOrEqual(parts - 0.003)
      expect(cp.espRequiredInWg).toBeGreaterThanOrEqual(parts * PRESSURE_SAFETY_FACTOR - 0.004)
    }
  })

  it.each(fixtures)('%s: fan verdict uses the deployment curve at the unrounded per-unit flow', (_n, z, p) => {
    const { L, result } = generate(z, p)
    for (const c of ducted(result.candidates)) {
      const perUnit = L.supplyCfm / c.quantity
      expect(c.fanOperatingPoint!.operatingCfm).toBeCloseTo(perUnit, 9)
      if (perUnit < c.equipment.minCfm || perUnit > c.equipment.maxCfm) continue
      let available: number | undefined
      try { available = availableFanPressureAtFlow(c.equipment, perUnit) } catch { available = undefined }
      const required = c.ductwork!.criticalPath.espRequiredInWg
      const pressureOk = available !== undefined && required <= available + 1e-8
      expect(c.diagnostics.some((d) => d.code === 'ERR_FAN_ESP_DEFICIT' || d.code === 'ERR_FAN_CURVE_UNAVAILABLE')).toBe(!pressureOk)
    }
  })
})

describe('estimate dominates the pressure deployment computes (fan-curve independent calibration)', () => {
  const rooms: [string, Zone, ProjectMetadata][] = [
    ...fixtures,
    ['50x20 ft, 4 people', draft(rect(50, 20), 4), imperial],
    ['60x40 ft, 12 people', draft(rect(60, 40), 12), imperial]
  ]
  it.each(rooms)('%s', (_n, z, p) => {
    const { L, result } = generate(z, p)
    let compared = 0
    for (const c of ducted(result.candidates)) {
      const perUnit = L.supplyCfm / c.quantity
      if (perUnit < c.equipment.minCfm || perUnit > c.equipment.maxCfm) continue
      // A fan that can always deliver, so deployment reports the pure path requirement.
      const lenient = {
        ...c.equipment,
        maxRatedEspInWg: 9,
        fanPerformance: { type: 'tabular' as const, table: [{ cfm: 1, espInWg: 9 }, { cfm: 99999, espInWg: 9 }], allowExtrapolation: false }
      }
      const cand = { ...c, equipment: lenient, isValid: true, diagnostics: [] } as SystemDesignCandidate
      const m = buildDeploymentManifest(cand, z, [z], p)
      if (!m.isEligibleToApply) continue
      const tx = executeDeploymentTransaction(m, [z], p)
      if (!tx.success) continue
      const units = m.equipment.cassetteUnits?.length ? m.equipment.cassetteUnits : [m.equipment.indoorUnit!]
      const deployed = validateAppliedDeployment(m, tx.updatedZones[0], units, p)
      expect(c.ductwork!.criticalPath.espRequiredInWg, `${c.equipment.model} x${c.quantity}`).toBeGreaterThanOrEqual(deployed)
      compared++
    }
    if (_n.startsWith('30x25 ft, 2') || _n.startsWith('40x30') || _n.startsWith('60x40')) expect(compared).toBeGreaterThan(0)
  })
})
