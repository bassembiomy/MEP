import {it,expect} from 'vitest';
import {placeReturnGrillesForZone} from '../terminals/returnPlacer';
import type {EquipmentServiceZone} from '../zoning/zonePartitioner';
import type {CoordinatedAirTerminal} from '../terminals/terminalPlacer';
const zone={id:'z',unitTag:'FCU-1',serviceAreaPolygon:[0,0,50,0,50,10,0,10],supplyCfm:1345,returnCfm:1345,targetNc:30} as EquipmentServiceZone;
const supplies=[8,20,32,44].map((x,i)=>({id:`s${i}`,type:'supply',position:{x,y:5},throwT50Ft:10} as CoordinatedAirTerminal));
it('places return grilles with the required separation from every supply when feasible',()=>{
 const returns=placeReturnGrillesForZone(zone,supplies);
 for(const r of returns)for(const s of supplies)expect(Math.hypot(r.position.x-s.position.x,r.position.y-s.position.y)).toBeGreaterThanOrEqual(6);
 expect(returns.reduce((sum,r)=>sum+r.cfm,0)).toBe(1345);
});
it('does not invent return airflow when an explicit zero is supplied',()=>{
 expect(placeReturnGrillesForZone({...zone,returnCfm:0},supplies)).toEqual([]);
});
