import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { useProjectStore } from '../../store/projectStore'

const project={name:'Office',location:'Cairo',units:'imperial' as const,scale:10,outdoorDb:95,indoorDb:75}
describe('project edits and deferred design integrity',()=>{
  beforeEach(()=>{vi.useFakeTimers();useProjectStore.setState({project,zones:[],selectedZoneId:null,activePreview:null})})
  afterEach(()=>{vi.clearAllTimers();vi.useRealTimers()})
  it('does not overwrite edits made before the deferred deployment executes',()=>{
    useProjectStore.getState().addZone([0,0,200,0,200,150,0,150])
    const draft=useProjectStore.getState().zones[0]
    useProjectStore.getState().updateZone(draft.id,{lightingOverride:3})
    vi.runAllTimers()
    const zone=useProjectStore.getState().zones[0]
    expect(zone.lightingOverride).toBe(3)
    expect(zone.diffusers).toEqual([])
    expect(zone).toHaveProperty('engineeringStatus','stale')
  })
  it('reports invalid load inputs in zone state and keeps the zone editable',()=>{
    useProjectStore.getState().addZone([0,0,200,0,200,150,0,150])
    const id=useProjectStore.getState().zones[0].id
    useProjectStore.getState().updateZone(id,{manualCfmOverride:1})
    const zone=useProjectStore.getState().zones[0]
    expect(zone).toHaveProperty('engineeringStatus','blocked')
    expect((zone as {engineeringError?:string}).engineeringError).toMatch(/airflow/i)
    expect(zone.manualCfmOverride).toBe(1)
  })
  it('uses a ten-foot equivalent ceiling height for new metric zones',()=>{
    useProjectStore.setState({project:{...project,units:'metric',scale:100,outdoorDb:35,indoorDb:24}})
    useProjectStore.getState().addZone([0,0,600,0,600,450,0,450])
    expect(useProjectStore.getState().zones[0].ceilingHeight).toBeCloseTo(3.048,6)
  })
})
