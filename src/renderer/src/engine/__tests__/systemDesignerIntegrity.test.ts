import { describe, expect, it } from 'vitest'
import { generateSystemCandidates } from '../systemDesigner'
import { calculateCanonicalZoneLoad } from '../loadCalc'
import { buildDeploymentManifest, executeDeploymentTransaction } from '../deploymentManager'
import type { SystemDesignCandidate } from '../types'
import type { Zone, ProjectMetadata } from '../../store/projectStore'

const project: ProjectMetadata = { name: 'F', location: 'F', units: 'imperial', scale: 10, outdoorDb: 95, indoorDb: 75 }
const room = (wFt: number, hFt: number, occupants: number): Zone => ({
  id: 'z', name: 'F', points: [0, 0, wFt * 10, 0, wFt * 10, hFt * 10, 0, hFt * 10],
  spaceTypeId: 'office', ceilingHeight: 10, occupants, diffusers: [], ducts: []
})
// cfmOverride mirrors a validated design-airflow override (the 20x15 ft acceptance fixture uses 350 CFM).
const candidatesFor = (z: Zone, cfmOverride?: number) => {
  const L = calculateCanonicalZoneLoad(z, project)
  const cfm = cfmOverride ?? L.supplyCfm
  const result = generateSystemCandidates(L.totalLoad, L.sensibleLoad, cfm, 'office', L.area, true, undefined as never, ['concealed', 'fcu'])
  return { L, cfm, result }
}

describe('candidate airflow envelope', () => {
  it('rejects a ducted candidate whose per-unit airflow is below the rated fan range', () => {
    const { result } = candidatesFor(room(15, 15, 2))
    const c = result.candidates.find(x => x.equipment.model.includes('53QDMT-12N'))
    expect(c).toBeDefined()
    expect(c!.isValid).toBe(false)
    expect(c!.diagnostics.some(d => d.code === 'ERR_AIRFLOW_OUTSIDE_EQUIPMENT_RANGE' && d.severity === 'error')).toBe(true)
  })

  // The 20x15 ft row (350 CFM validated design override, as in deploymentAcceptance) has a valid ducted candidate (53QDMT-18N); the bundled catalog has no valid ducted candidate at the computed airflow of any tested room, so the per-unit range assertion really runs there.
  // With one shared pressure budget no bundled ducted unit can overcome the routed-path requirement in the 30x25 and
  // 40x30 ft rooms (deployment independently rejects the former optimistic 'valid' picks), so none may be expected.
  it.each([[20, 15, 2, true, 350], [15, 15, 2, false, undefined], [30, 25, 2, false, undefined], [40, 30, 6, false, undefined]])('valid ducted candidates stay inside the fan range (%i x %i ft, %i people)', (w, h, n, expectAny, cfmOverride) => {
    const { cfm, result } = candidatesFor(room(w, h, n), cfmOverride)
    const ducted = result.candidates.filter(x => x.isValid && x.equipment.capabilities.supportsDuctNetwork)
    if (expectAny) expect(ducted.length).toBeGreaterThan(0)
    for (const c of ducted) {
      const perUnit = cfm / c.quantity
      expect(perUnit).toBeGreaterThanOrEqual(c.equipment.minCfm)
      expect(perUnit).toBeLessThanOrEqual(c.equipment.maxCfm)
    }
  })

  // Evidence that ERR_FAN_ESP_DEFICIT rejections are real: forcing each such candidate valid and deploying with
  // the actual fan curve must still be rejected for fan pressure.
  it.each([[30, 25, 2], [40, 30, 6]])('every ERR_FAN_ESP_DEFICIT-only ducted candidate is really rejected by deployment (%i x %i ft, %i people)', (w, h, n) => {
    const z = room(w, h, n)
    const { result } = candidatesFor(z)
    const deficit = result.candidates.filter(c =>
      c.equipment.capabilities.supportsDuctNetwork &&
      c.diagnostics.filter(d => d.severity === 'error').length > 0 &&
      c.diagnostics.filter(d => d.severity === 'error').every(d => d.code === 'ERR_FAN_ESP_DEFICIT'))
    expect(deficit.length).toBeGreaterThan(0)
    const deployed: string[] = []
    for (const c of deficit) {
      const forced = { ...c, isValid: true, diagnostics: c.diagnostics.filter(d => d.severity !== 'error') } as SystemDesignCandidate
      const m = buildDeploymentManifest(forced, z, [z], project)
      const tx = m.isEligibleToApply ? executeDeploymentTransaction(m, [z], project) : { success: false }
      const fanRejected = m.diagnostics.some(d => d.severity === 'error' && /fan pressure/i.test(d.message))
      if (tx.success || !fanRejected) deployed.push(`${c.equipment.model} x${c.quantity}: ${m.diagnostics.map(d => d.message).join(' | ')}`)
    }
    expect(deployed).toEqual([])
  })
})
