import type {EquipmentServiceZone} from '../zoning/zonePartitioner';
import type {CoordinatedAirTerminal} from './terminalPlacer';
import {selectBestDiffuserFromCatalog} from './diffuserSelector';
import {isPointInPolygon} from '../geometry';
import {requireNonnegative,measureSimplePolygon} from '../engineeringInputs';
import {ASHRAE_PROFILE} from '../standards/designStandards';

export function placeReturnGrillesForZone(zone:EquipmentServiceZone,supplyTerminals:CoordinatedAirTerminal[]):CoordinatedAirTerminal[] {
 const returnCfm=requireNonnegative('Room return airflow',zone.returnCfm);
 if(returnCfm===0)return [];
 measureSimplePolygon(zone.serviceAreaPolygon);
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 for(let i=0;i<zone.serviceAreaPolygon.length;i+=2){minX=Math.min(minX,zone.serviceAreaPolygon[i]);maxX=Math.max(maxX,zone.serviceAreaPolygon[i]);minY=Math.min(minY,zone.serviceAreaPolygon[i+1]);maxY=Math.max(maxY,zone.serviceAreaPolygon[i+1]);}
 const width=maxX-minX,height=maxY-minY;
 const count=width>height*1.3&&supplyTerminals.length>=2?Math.max(2,Math.min(4,supplyTerminals.length)):Math.max(1,Math.min(2,supplyTerminals.length));
 const inset=Math.min(1,width*0.05,height*0.05);
 const candidates:{x:number;y:number}[]=[];
 // Bounded plan search checks every return against every supply; no corner-only guess.
 for(let ix=0;ix<=40;ix++)for(let iy=0;iy<=12;iy++){
  const x=minX+inset+(width-2*inset)*ix/40,y=minY+inset+(height-2*inset)*iy/12;
  if(isPointInPolygon(x,y,zone.serviceAreaPolygon))candidates.push({x,y});
 }
 if(!candidates.length)throw new Error('No contained return grille position was found.');
 const ratio=ASHRAE_PROFILE.diffuserThrow.minReturnSupplyOffsetRatio;
 const returns:CoordinatedAirTerminal[]=[];
 for(let i=0;i<count;i++) {
  let best:{x:number;y:number}|undefined,bestScore=-Infinity,bestMargin=-Infinity;
  for(const candidate of candidates) {
   if(returns.some(r=>Math.hypot(r.position.x-candidate.x,r.position.y-candidate.y)<Math.max(inset,0.5)))continue;
   const margin=supplyTerminals.length?Math.min(...supplyTerminals.map(s=>Math.hypot(s.position.x-candidate.x,s.position.y-candidate.y)-s.throwT50Ft*ratio)):Infinity;
   const spacing=returns.length?Math.min(...returns.map(r=>Math.hypot(r.position.x-candidate.x,r.position.y-candidate.y))):0;
   const score=(margin>=0?1_000_000:0)+(Number.isFinite(margin)?margin:0)+Math.min(spacing,Math.max(width,height))*0.1;
   if(score>bestScore){best=candidate;bestScore=score;bestMargin=margin;}
  }
  if(!best)throw new Error('Insufficient separated return grille positions.');
  const cfm=i===count-1?returnCfm-returns.reduce((sum,r)=>sum+r.cfm,0):returnCfm/count;
  const selected=selectBestDiffuserFromCatalog(cfm,zone.targetNc);
  returns.push({id:`RAG-${zone.unitTag}-${i+1}`,unitId:zone.id,designControlMode:'ai',type:'return',subtype:'eggcrate',position:best,cfm,
   catalogModel:`${selected.catalogItem.manufacturer} Eggcrate Return ${selected.faceDimension}`,neckDimension:selected.neckDimension,faceDimension:selected.faceDimension,
   throwT50Ft:0,throwRatio:1,adjacentOverlapRatio:0,occupiedZoneVelocityFpm:35,ncRating:Math.max(15,selected.actualNc-5),deltaPInWg:0.025,status:bestMargin>=0?'pass':'warning'});
 }
 return returns;
}
