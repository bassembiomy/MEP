import { describe,expect,it } from 'vitest'
import { generateSystemCandidates } from '../systemDesigner'
import { calculateZoneLoadSafely } from '../loadCalc'
import type { ProjectMetadata,Zone } from '../../store/projectStore'
const p:ProjectMetadata={name:'p',location:'Cairo',units:'imperial',scale:10,outdoorDb:95,indoorDb:75}
const z:Zone={id:'z',name:'z',points:[0,0,200,0,200,150,0,150],ceilingHeight:10,occupants:2,spaceTypeId:'office',diffusers:[],ducts:[]}

describe('application engineering boundaries',()=>{
  it('returns a recoverable input error without fabricating a load',()=>{
    const result=calculateZoneLoadSafely({...z,manualCfmOverride:1},p)
    expect(result.load).toBeNull()
    expect(result.error).toMatch(/airflow/i)
  })
  it('returns a load for valid application inputs',()=>{
    expect(calculateZoneLoadSafely(z,p).load?.area).toBe(300)
  })
  it('uses equivalent metric flows, loads and areas for equipment recommendations',()=>{
    const feet=generateSystemCandidates(18000,15000,600,'office',300,true,{},['high-wall'])
    const metric=generateSystemCandidates(5275.2792631,4396.06605258,283.16846592,'office',27.870912,false,{},['high-wall'])
    expect(metric.candidates.map(c=>[c.equipment.id,c.quantity])).toEqual(feet.candidates.map(c=>[c.equipment.id,c.quantity]))
  })
  it('does not recommend equipment with insufficient installed sensible or latent capacity',()=>{
    const summary=generateSystemCandidates(36000,35000,600,'office',300,true,{},['high-wall'])
    expect(summary.candidates.filter(c=>c.isValid).every(c=>c.quantity*c.equipment.sensibleCapacityBtuPerHour>=35000)).toBe(true)
    const humid=generateSystemCandidates(36000,10000,600,'office',300,true,{},['high-wall'])
    expect(humid.candidates.filter(c=>c.isValid).every(c=>c.quantity*(c.equipment.totalCapacityBtuPerHour-c.equipment.sensibleCapacityBtuPerHour)>=26000)).toBe(true)
  })
})


import { getSupplyAirflowForDisplay } from '../airflowDisplay';
it('displays only supply flow and converts canonical CFM once for metric CAD labels',()=>{
  const terminals=[{type:'supply',cfm:600},{type:'return',cfm:600},{type:'exhaust',cfm:50}];
  expect(getSupplyAirflowForDisplay(terminals,600,'imperial')).toBe(600);
  expect(getSupplyAirflowForDisplay(terminals,600,'metric')).toBeCloseTo(283.16846592,8);
  expect(getSupplyAirflowForDisplay([],600,'metric')).toBeCloseTo(283.16846592,8);
  expect(getSupplyAirflowForDisplay([{type:'supply',cfm:NaN}],600,'imperial')).toBeNull();
});


it('rejects negative latent demand rather than absorbing it as rounding',()=>{
  const result=generateSystemCandidates(12000,12000.5,600,'office',300,true,{},['high-wall']);
  expect(result.candidates).toEqual([]);
  expect(result.diagnostics.some(d=>d.severity==='error')).toBe(true);
});
