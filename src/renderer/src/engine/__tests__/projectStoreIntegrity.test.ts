import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { useProjectStore } from '../../store/projectStore'
import { STANDARD_EQUIPMENT_CATALOG } from '../hvacCatalogs'
import { generateSystemCandidates } from '../systemDesigner'
import { calculateCanonicalZoneLoad } from '../loadCalc'

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

describe('auto-deploy falls through the ranked candidates',()=>{
  const original=[...STANDARD_EQUIPMENT_CATALOG]
  beforeEach(()=>{vi.useFakeTimers();useProjectStore.setState({project,zones:[],selectedZoneId:null,activePreview:null})})
  afterEach(()=>{STANDARD_EQUIPMENT_CATALOG.splice(0,STANDARD_EQUIPMENT_CATALOG.length,...original);vi.clearAllTimers();vi.useRealTimers()})
  const base=original.find(e=>e.model.includes('53QDMT-18N'))!
  // A high-static concealed unit whose airflow range covers the ~220 CFM this small room needs.
  const stub=(overrides:object)=>({...structuredClone(base),nominalCfm:250,minCfm:150,maxCfm:400,maxRatedEspInWg:1,
    fanPerformance:{type:'tabular' as const,table:[{cfm:150,espInWg:1},{cfm:400,espInWg:1}],allowExtrapolation:false},...overrides}) as typeof base
  const room=[0,0,200,0,200,150,0,150]

  it('deploys the second ranked candidate when the best one fails deployment, and records why',()=>{
    // Cheapest and therefore best-ranked, but its physical envelope cannot fit in a 20x15 ft room.
    const tooBig=stub({id:'stub-too-big',model:'Stub Oversized FCU',costIndex:1,dimensionsIn:{width:400,depth:400,height:10}})
    const fits=stub({id:'stub-fits',model:'Stub Compact FCU',costIndex:90})
    STANDARD_EQUIPMENT_CATALOG.splice(0,STANDARD_EQUIPMENT_CATALOG.length,tooBig,fits)
    useProjectStore.getState().addZone(room)
    vi.runAllTimers()
    const zone=useProjectStore.getState().zones[0]
    expect(zone.catalogModel).toBe('Stub Compact FCU')
    expect(zone.engineeringStatus).toBe('preliminary')
    expect(zone.engineeringNotice).toMatch(/Stub Oversized FCU/)
    expect(zone.ducts.length).toBeGreaterThan(0)
  })

  it('blocks with every skipped reason when no candidate deploys',()=>{
    const a=stub({id:'stub-a',model:'Stub Oversized A',costIndex:1,dimensionsIn:{width:400,depth:400,height:10}})
    const b=stub({id:'stub-b',model:'Stub Oversized B',costIndex:2,dimensionsIn:{width:420,depth:420,height:10}})
    STANDARD_EQUIPMENT_CATALOG.splice(0,STANDARD_EQUIPMENT_CATALOG.length,a,b)
    useProjectStore.getState().addZone(room)
    vi.runAllTimers()
    const zone=useProjectStore.getState().zones[0]
    expect(zone.engineeringStatus).toBe('blocked')
    expect(zone.engineeringError).toMatch(/Stub Oversized A/)
    expect(zone.engineeringError).toMatch(/Stub Oversized B/)
    expect(zone.diffusers).toEqual([])
  })

  const deployWithNotice=()=>{
    const tooBig=stub({id:'stub-too-big',model:'Stub Oversized FCU',costIndex:1,dimensionsIn:{width:400,depth:400,height:10}})
    const fits=stub({id:'stub-fits',model:'Stub Compact FCU',costIndex:90})
    STANDARD_EQUIPMENT_CATALOG.splice(0,STANDARD_EQUIPMENT_CATALOG.length,tooBig,fits)
    useProjectStore.getState().addZone(room)
    vi.runAllTimers()
    expect(useProjectStore.getState().zones[0].engineeringNotice).toMatch(/Stub Oversized FCU/)
    return useProjectStore.getState().zones[0].id
  }

  it('clears the fall-through notice when the zone is edited',()=>{
    const id=deployWithNotice()
    useProjectStore.getState().updateZone(id,{lightingOverride:2})
    const zone=useProjectStore.getState().zones[0]
    expect(zone.engineeringStatus).toBe('stale')
    expect(zone.engineeringNotice).toBeUndefined()
  })

  it('clears the fall-through notice when another candidate is applied',()=>{
    const id=deployWithNotice()
    const zone=useProjectStore.getState().zones[0]
    const L=calculateCanonicalZoneLoad(zone,project)
    const cand=generateSystemCandidates(L.totalLoad,L.sensibleLoad,L.supplyCfm,'office',L.area,true,undefined as never,['concealed']).candidates.find(c=>c.isValid&&c.equipment.model==='Stub Compact FCU')!
    expect(cand).toBeDefined()
    const r=useProjectStore.getState().applyCandidateTransaction(cand)
    expect(r.success).toBe(true)
    const after=useProjectStore.getState().zones.find(z=>z.id===id)!
    expect(after.engineeringStatus).toBe('preliminary')
    expect(after.engineeringNotice).toBeUndefined()
  })
})
