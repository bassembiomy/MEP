import { describe,expect,it } from 'vitest'
import { calculateCanonicalZoneLoad } from '../loadCalc'
import type { Zone,ProjectMetadata } from '../../store/projectStore'
const zone:Zone={id:'z',name:'office',points:[0,0,200,0,200,150,0,150],ceilingHeight:10,occupants:2,spaceTypeId:'office',diffusers:[],ducts:[]}
const project:ProjectMetadata={name:'p',location:'Cairo',units:'imperial',scale:10,outdoorDb:95,indoorDb:75}
describe('canonical load consumer boundary',()=>{
  it('uses equal unrounded load and flow for the same physical room in either display unit system',()=>{
    const imperial=calculateCanonicalZoneLoad(zone,project)
    const metric=calculateCanonicalZoneLoad({...zone,points:[0,0,6096,0,6096,4572,0,4572],ceilingHeight:3.048},
      {...project,units:'metric',scale:1000,outdoorDb:35,indoorDb:23.88888888888889})
    expect(metric.area).toBeCloseTo(300,8)
    expect(metric.totalLoad).toBeCloseTo(imperial.totalLoad,6)
    expect(metric.supplyCfm).toBeCloseTo(imperial.supplyCfm,6)
  })
})
