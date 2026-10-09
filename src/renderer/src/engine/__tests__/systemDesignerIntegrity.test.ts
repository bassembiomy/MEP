import { describe, expect, it } from 'vitest'
import { generateSystemCandidates } from '../systemDesigner'
import { calculateCanonicalZoneLoad } from '../loadCalc'
import type { Zone, ProjectMetadata } from '../../store/projectStore'

const project: ProjectMetadata = { name: 'F', location: 'F', units: 'imperial', scale: 10, outdoorDb: 95, indoorDb: 75 }
const room = (wFt: number, hFt: number, occupants: number): Zone => ({
  id: 'z', name: 'F', points: [0, 0, wFt * 10, 0, wFt * 10, hFt * 10, 0, hFt * 10],
  spaceTypeId: 'office', ceilingHeight: 10, occupants, diffusers: [], ducts: []
})
const candidatesFor = (z: Zone) => {
  const L = calculateCanonicalZoneLoad(z, project)
  const result = generateSystemCandidates(L.totalLoad, L.sensibleLoad, L.supplyCfm, 'office', L.area, true, undefined as never, ['concealed', 'fcu'])
  return { L, result }
}

describe('candidate airflow envelope', () => {
  it('rejects a ducted candidate whose per-unit airflow is below the rated fan range', () => {
    const { result } = candidatesFor(room(15, 15, 2))
    const c = result.candidates.find(x => x.equipment.model.includes('53QDMT-12N'))
    expect(c).toBeDefined()
    expect(c!.isValid).toBe(false)
    expect(c!.diagnostics.some(d => d.code === 'ERR_AIRFLOW_OUTSIDE_EQUIPMENT_RANGE' && d.severity === 'error')).toBe(true)
  })

  it.each([[15, 15, 2, false], [30, 25, 2, true], [40, 30, 6, true]])('valid ducted candidates stay inside the fan range (%i x %i ft, %i people)', (w, h, n, expectAny) => {
    const { L, result } = candidatesFor(room(w, h, n))
    const ducted = result.candidates.filter(x => x.isValid && x.equipment.capabilities.supportsDuctNetwork)
    if (expectAny) expect(ducted.length).toBeGreaterThan(0)
    for (const c of ducted) {
      const perUnit = L.supplyCfm / c.quantity
      expect(perUnit).toBeGreaterThanOrEqual(c.equipment.minCfm)
      expect(perUnit).toBeLessThanOrEqual(c.equipment.maxCfm)
    }
  })
})
