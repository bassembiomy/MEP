import { describe,expect,it } from 'vitest'
import { autoDesignHVAC } from '../orchestrator/hvacDesignOrchestrator'
import { recalculatePartialDesign } from '../orchestrator/partialRecalculationEngine'
import { ASHRAE_PROFILE } from '../standards/designStandards'

const zones=[{id:'z1',name:'Office',polygon:[0,0,20,0,20,15,0,15],occupancy:2}]
const context={projectId:'p',units:'imperial' as const,profile:ASHRAE_PROFILE,spaceNcLimit:30,coverageTargetPercent:95,systemType:'concealed' as const}
const design=()=>autoDesignHVAC({projectId:'p',name:'Office',units:'imperial',zones},{maxOptimizationIterations:0})

describe('partial recalculation integrity',()=>{
  it('moving a diffuser does not mutate the original design',async()=>{
    const original=await design()
    const before=structuredClone(original.artifacts)
    const terminal=original.artifacts.terminals[0]
    await recalculatePartialDesign(zones,original.artifacts,{type:'MOVE_DIFFUSER',zoneId:'z1',targetId:terminal.id,newPosition:{x:terminal.position.x+1,y:terminal.position.y+1}},context)
    expect(original.artifacts).toEqual(before)
  })
  it('unknown replacement equipment cannot retain the old rated capacity as a verified selection',async()=>{
    const original=await design()
    const updated=await recalculatePartialDesign(zones,original.artifacts,{type:'REPLACE_EQUIPMENT',zoneId:'z1',targetId:'z1',newModel:'not-in-catalog'},context)
    expect(updated.status).toBe('FAIL')
    expect(updated.artifacts.selectedEquipment.z1).toBeUndefined()
    expect(original.artifacts.zones[0].equipmentModel).not.toBe('not-in-catalog')
  })
  it('airflow overrides trigger dependent recalculation rather than being ignored',async()=>{
    const original=await design()
    const updated=await recalculatePartialDesign(zones,original.artifacts,{type:'OVERRIDE_CFM',zoneId:'z1',targetId:'z1',newCfm:900},context)
    expect(updated.artifacts.airflows.z1.supplyCfm).toBe(900)
    expect(zones[0]).not.toHaveProperty('manualCfm')
  })
  it('rejects an override below calculated thermal demand',async()=>{
    const original=await design()
    await expect(recalculatePartialDesign(zones,original.artifacts,{type:'OVERRIDE_CFM',zoneId:'z1',targetId:'z1',newCfm:1},context)).rejects.toThrow(/airflow/i)
  })
  it('rejects modifications without an existing target',async()=>{
    const original=await design()
    await expect(recalculatePartialDesign(zones,original.artifacts,{type:'MOVE_DIFFUSER',zoneId:'z1',targetId:'missing',newPosition:{x:1,y:1}},context)).rejects.toThrow(/target/i)
  })
})


it('rebuilding one zone retains another zone user-modified terminals',async()=>{
  const inputs=[...zones,{...zones[0],id:'z2',name:'Second office',polygon:[30,0,50,0,50,15,30,15]}];
  const original=await autoDesignHVAC({projectId:'p',name:'Offices',units:'imperial',zones:inputs},{maxOptimizationIterations:0});
  const terminal=original.artifacts.terminals.find(t=>t.unitId==='z2')!;
  const moved=await recalculatePartialDesign(inputs,original.artifacts,{type:'MOVE_DIFFUSER',zoneId:'z2',targetId:terminal.id,newPosition:{x:terminal.position.x+0.5,y:terminal.position.y}},context);
  const updated=await recalculatePartialDesign(inputs,moved.artifacts,{type:'OVERRIDE_CFM',zoneId:'z1',targetId:'z1',newCfm:900},context);
  expect(updated.artifacts.terminals.filter(t=>t.unitId==='z2')).toEqual(moved.artifacts.terminals.filter(t=>t.unitId==='z2'));
  expect(updated.artifacts.selectedEquipment.z2).toEqual(moved.artifacts.selectedEquipment.z2);
})
