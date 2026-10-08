import {it,expect} from 'vitest';
import {optimizeMultiUnitCandidates} from '../systemArchitecture/equipmentOptimizer';
import {executeAirDistributionDesign} from '../airDistributionEngine';
it('requires sensible and latent components for every multi-unit candidate',()=>{
 const result=optimizeMultiUnitCandidates({roomName:'High sensible',sensibleLoadBtu:49900,totalLoadBtu:50000,requiredCfm:1000,roomAreaSqFt:500});
 for(const c of result.candidates){expect(c.equipmentDetails.sensibleCapacityBtu*c.unitCount).toBeGreaterThanOrEqual(49900);expect((c.equipmentDetails.totalCapacityBtu-c.equipmentDetails.sensibleCapacityBtu)*c.unitCount).toBeGreaterThanOrEqual(100);}
});
it('transfers actual selected component capacity evidence into room validation',()=>{
 const r=executeAirDistributionDesign({roomName:'Office',roomPolygon:[0,0,20,0,20,15,0,15],roomAreaSqFt:300,sensibleLoadBtu:8000,totalLoadBtu:10000,requiredCfm:400,occupancyCount:3});
 const selected=r.selectedOption.equipmentDetails;
 for(const z of r.serviceZones){expect(z.sensibleCapacityBtu).toBe(selected.sensibleCapacityBtu);expect(z.latentCapacityBtu).toBe(selected.totalCapacityBtu-selected.sensibleCapacityBtu);}
});
it('uses room occupancy and area for outdoor air without an invented minimum',()=>{
 const r=executeAirDistributionDesign({roomName:'Office',roomPolygon:[0,0,20,0,20,15,0,15],roomAreaSqFt:300,sensibleLoadBtu:8000,totalLoadBtu:10000,requiredCfm:400,occupancyCount:3});
 expect(r.serviceZones.reduce((s,z)=>s+z.outdoorAirCfm,0)).toBe(33);
});
import {calculateSolarLoadWeights} from '../zoning/solarLoadWeighting';
it('selects per-unit capacities for the largest declared solar-weighted service load',()=>{
 const result=executeAirDistributionDesign({roomName:'Solar room',roomPolygon:[0,0,50,0,50,30,0,30],roomAreaSqFt:1500,sensibleLoadBtu:120000,totalLoadBtu:141000,requiredCfm:4000,occupancyCount:50,exteriorWalls:[{side:'south',glassRatio:0.7}]});
 const weights=calculateSolarLoadWeights({unitCount:result.serviceZones.length,exteriorWalls:[{side:'south',glassRatio:0.7}]});
 result.serviceZones.forEach((z,i)=>{expect(z.sensibleCapacityBtu).toBeGreaterThanOrEqual(120000*weights[i]);expect(z.latentCapacityBtu).toBeGreaterThanOrEqual(21000*weights[i]);});
});
it('rejects infeasible user unit-count overrides instead of silently using another count',()=>{
 expect(()=>executeAirDistributionDesign({roomName:'Office',roomPolygon:[0,0,20,0,20,15,0,15],roomAreaSqFt:300,sensibleLoadBtu:8000,totalLoadBtu:10000,requiredCfm:400,userOverrideUnitCount:99})).toThrow(/override|count|feasible/i);
});
