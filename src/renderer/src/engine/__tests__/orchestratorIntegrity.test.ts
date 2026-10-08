import { describe, expect, it } from 'vitest'
import { autoDesignHVAC, type HVACProjectInput } from '../orchestrator/hvacDesignOrchestrator'

const project = (overrides: Partial<HVACProjectInput> = {}): HVACProjectInput => ({
  projectId:'integrity', name:'Office', units:'imperial', systemType:'concealed',
  zones:[{id:'z1',name:'Office',polygon:[0,0,20,0,20,15,0,15],occupancy:2}], ...overrides
})

describe('orchestrator input and output integrity', () => {
  it('rejects an empty project', async () => {
    await expect(autoDesignHVAC(project({zones:[]}))).rejects.toThrow(/zone/i)
  })
  it('rejects duplicate zone IDs before calculating', async () => {
    const p = project()
    p.zones.push({...p.zones[0],name:'Other room'})
    await expect(autoDesignHVAC(p)).rejects.toThrow(/duplicate/i)
  })
  it('rejects unsupported units instead of treating them as feet', async () => {
    await expect(autoDesignHVAC(project({units:'unknown' as 'metric'}))).rejects.toThrow(/unit/i)
  })
  it('produces the same load and layout geometry for equivalent feet and meters', async () => {
    const feet = await autoDesignHVAC(project(), {maxOptimizationIterations:0})
    const p = project({units:'metric'})
    p.zones[0].polygon = [0,0,6.096,0,6.096,4.572,0,4.572]
    const meters = await autoDesignHVAC(p,{maxOptimizationIterations:0})
    expect(meters.artifacts.loads.z1.totalBtu).toBe(feet.artifacts.loads.z1.totalBtu)
    expect(meters.artifacts.airflows.z1.supplyCfm).toBe(feet.artifacts.airflows.z1.supplyCfm)
    expect(meters.artifacts.zones[0]?.serviceAreaPolygon[2]).toBeCloseTo(20,8)
    expect(meters.artifacts.zones[0]?.equipmentPosition.x).toBeLessThanOrEqual(20)
  })
  it('retains explicit zero occupancy and gain densities', async () => {
    const p=project()
    p.zones[0].occupancy=0
    p.zones[0].lightingWattsPerSqFt=0
    p.zones[0].equipmentWattsPerSqFt=0
    const result=await autoDesignHVAC(p,{maxOptimizationIterations:0})
    // 300 ft² office with no people: 0.06 * 300 = 18 CFM outdoor air.
    expect(result.artifacts.airflows.z1.outdoorAirCfm).toBe(18)
  })
  it('blocks impossible equipment demand and creates no generic service zone', async () => {
    const p=project()
    p.zones[0].manualLoadBtu=200000
    p.zones[0].manualCfm=7500
    const result=await autoDesignHVAC(p,{maxOptimizationIterations:0})
    expect(result.status).toBe('FAIL')
    expect(result.artifacts.selectedEquipment.z1).toBeUndefined()
    expect(result.artifacts.zones).toHaveLength(0)
    expect(result.decisionLog.find(log=>log.phase==='EQUIPMENT_SELECTION')?.validationResult).toBe('FAIL')
  })
  it('records the initial phases even when no optimization occurs', async () => {
    const result=await autoDesignHVAC(project(),{maxOptimizationIterations:0})
    expect(result.executionSummary.iterationsRun).toBe(0)
    expect(result.executionSummary.phasesExecuted).toContain('LOAD_ANALYSIS')
    expect(result.executionSummary.phasesExecuted).toContain('FINAL_VALIDATION')
  })
})



it('retains fractional engineering demand instead of selecting against rounded display', async () => {
  const p=project();p.zones[0].manualLoadBtu=12000.4;
  const result=await autoDesignHVAC(p,{maxOptimizationIterations:0});
  expect(result.artifacts.loads.z1.totalBtu).toBe(12000.4);
})
