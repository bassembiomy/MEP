import {it,expect} from 'vitest';
import {distributeLoadsAcrossZones} from '../zoning/loadDistribution';
import {calculateSolarLoadWeights} from '../zoning/solarLoadWeighting';
it('conserves exact demand and balances room supply with return when exhaust is absent',()=>{
 const weights=calculateSolarLoadWeights({unitCount:3});
 expect(weights.reduce((s,w)=>s+w,0)).toBeCloseTo(1,14);
 const slices=distributeLoadsAcrossZones({totalSensibleBtu:120000,totalLatentBtu:21000,totalCfm:4035,totalOutdoorAirCfm:363,weights});
 for(const s of slices){expect(s.returnCfm).toBe(s.supplyCfm);expect(s.totalBtu).toBeCloseTo(47000,8);}
 expect(slices.reduce((n,s)=>n+s.totalBtu,0)).toBe(141000);
});
