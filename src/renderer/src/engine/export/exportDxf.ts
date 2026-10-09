import type {ProjectMetadata,Zone,DxfEntity} from '../../store/projectStore';
import {validateCadEntity,getCadEntityBounds} from '../cad/nativeGeometry';
import {requirePositive,requireNonnegative,measureSimplePolygon} from '../engineeringInputs';
import {calculateZoneLoadSafely} from '../loadCalc';
import {getProjectDeploymentRevision,getZoneDeploymentRevision} from '../deploymentValidation';
import type {StoredCadObstacle,StoredCadOpening} from '../cad/cadSemanticState';
import {resolveStandardsSelection} from '../standards/profileRegistry';

/** `cadOpenings`/`cadObstacles` are the review lists; only items with status 'approved' are exported. */
interface ExportState {project:ProjectMetadata;zones:Zone[];dxfEntities:DxfEntity[];cadOpenings?:StoredCadOpening[];cadObstacles?:StoredCadObstacle[]}
export interface CadExportReport {
 status:'preliminary';issueReady:false;projectName:string;jurisdiction:'Egypt';sourceProjectRevision:string;
 standards:ReturnType<typeof resolveStandardsSelection>;
 limitations:string[];rooms:{id:string;name:string;sourceRevision:string;status:string;load:ReturnType<typeof calculateZoneLoadSafely>;terminalCount:number;ductCount:number;equipmentCount:number}[];
}
/** Editable 2D DXF, preserving the native drawing frame and separate engineering layers. */
export function exportProjectDxf(state:ExportState):{text:string;report:CadExportReport} {
 const {project,zones}=state;
 if(project.cadUnitsConfirmed===false)throw new Error('Confirm CAD drawing units before engineering export.');
 const scale=project.units==='metric'?project.scale*0.3048:project.scale;requirePositive('Drawing scale',scale);
 const body:string[]=[];const layerNames=new Set<string>();
 const pair=(code:number,value:string|number)=>{if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Export coordinates must be finite.');body.push(String(code),String(value).replace(/[\r\n]/g,' '));};
 const start=(type:string,layer:string,color?:string)=>{layerNames.add(layer);pair(0,type);pair(8,layer);if(color&&/^#[a-f\d]{6}$/i.test(color))pair(420,parseInt(color.slice(1),16));};
 const xy=(x:number,y:number)=>{pair(10,x);pair(20,-y);};
 const poly=(points:number[],layer:string,closed=false,bulges?:number[],color?:string)=>{
  if(points.length<4||points.length%2)throw new Error('Invalid export polyline.');
  start('LWPOLYLINE',layer,color);pair(90,points.length/2);pair(70,closed?1:0);
  for(let i=0;i<points.length;i+=2){xy(points[i],points[i+1]);if(bulges?.[i/2])pair(42,bulges[i/2]);}
 };
 const text=(value:string,x:number,y:number,layer='HVAC-TAGS',height=scale*0.2)=>{start('TEXT',layer);xy(x,y);pair(40,height);pair(1,value);};
 const limitations=['PRELIMINARY — not for construction.','Egyptian code adoption, detailed thermal inputs, operating-condition manufacturer evidence, barriers, 3D coordination and service clearances require review.','Equipment and terminal symbols are schematic; they are not verified catalog footprints.'];
 for(const entity of state.dxfEntities) {
  const invalid=validateCadEntity(entity);if(invalid)throw new Error(invalid);
  const layer=entity.layer??'0';
  if(entity.geometryApproximation)limitations.push(`CAD ${entity.handle??layer}: ${entity.geometryApproximation}`);
  switch(entity.type) {
   case 'LINE':start('LINE',layer,entity.color);xy(entity.x!,entity.y!);pair(11,entity.points![0]);pair(21,-entity.points![1]);break;
   case 'LWPOLYLINE':case 'POLYLINE':poly(entity.points!,layer,entity.closed,entity.bulges,entity.color);break;
   case 'CIRCLE':case 'ARC':start(entity.type,layer,entity.color);xy(entity.x!,entity.y!);pair(40,entity.radius!);if(entity.type==='ARC'){pair(50,entity.startAngleDeg!);pair(51,entity.endAngleDeg!);}break;
   case 'ELLIPSE': {
    const u={x:entity.majorAxis!.x,y:-entity.majorAxis!.y},v={x:entity.minorAxis!.x,y:-entity.minorAxis!.y};
    const xx=u.x*u.x+v.x*v.x,yy=u.y*u.y+v.y*v.y,off=u.x*u.y+v.x*v.y;
    const theta=0.5*Math.atan2(2*off,xx-yy),e={x:Math.cos(theta),y:Math.sin(theta)};
    const trace=xx+yy,delta=Math.hypot(xx-yy,2*off),a=Math.sqrt((trace+delta)/2);
    const determinant=u.x*v.y-u.y*v.x,b=Math.abs(determinant)/a,n=determinant>=0?1:-1;
    requirePositive('Ellipse major radius',a);requirePositive('Ellipse minor radius',b);
    const minor={x:-e.y*n,y:e.x*n};
    const parameter=(p:number)=>{
     const x=u.x*Math.cos(p)+v.x*Math.sin(p),y=u.y*Math.cos(p)+v.y*Math.sin(p);
     return Math.atan2((x*minor.x+y*minor.y)/b,(x*e.x+y*e.y)/a);
    };
    const p0=entity.startParam??0,p1=entity.endParam??2*Math.PI;
    let begin=parameter(p0);begin=(begin+2*Math.PI)%(2*Math.PI);
    let span=p1-p0;while(span<0)span+=2*Math.PI;if(Math.abs(span)<1e-12)span=2*Math.PI;
    start('ELLIPSE',layer,entity.color);xy(entity.x!,entity.y!);pair(11,e.x*a);pair(21,e.y*a);pair(31,0);pair(40,b/a);pair(41,begin);pair(42,begin+Math.min(span,2*Math.PI));pair(210,0);pair(220,0);pair(230,n);break;
   }
   case 'TEXT':case 'MTEXT':start(entity.type,layer,entity.color);xy(entity.x!,entity.y!);pair(40,entity.textHeight??scale*0.2);pair(50,(entity.rotationDeg??0)*(entity.type==='MTEXT'?Math.PI/180:1));pair(1,entity.text??'');break;
  }
 }
 for(const z of zones) {
  measureSimplePolygon(z.points);poly(z.points,'HVAC-ROOMS',true);
  const cx=z.points[0],cy=z.points[1];text(`${z.name} | ${z.engineeringStatus??'stale'} | PRELIMINARY`,cx,cy,'HVAC-ROOM-TAGS');
  for(const d of z.ducts) {
   requireNonnegative('Duct flow',d.cfm);
   const layer=d.type==='return'?'HVAC-RETURN-DUCTS':'HVAC-SUPPLY-DUCTS';poly(d.points,layer);
   requirePositive('Duct width',d.widthIn);requirePositive('Duct height',d.heightIn);
   const label=project.units==='metric'?`${(d.widthIn*25.4).toFixed(0)} x ${(d.heightIn*25.4).toFixed(0)} mm`:`${d.widthIn} x ${d.heightIn} in`;
   text(`${d.id}: ${label}; ${d.cfm} CFM`,d.points[0],d.points[1],'HVAC-DUCT-SIZES');
  }
  for(const t of z.diffusers) {
   requireNonnegative('Terminal flow',t.cfm);
   const prefix=t.type==='return'?'RETURN':t.type==='exhaust'?'EXHAUST':'SUPPLY';const r=scale*0.25;
   poly([t.x-r,t.y-r,t.x+r,t.y-r,t.x+r,t.y+r,t.x-r,t.y+r],`HVAC-${prefix}-TERMINALS`,true);
   text(`${t.id}: ${t.cfm} CFM (${t.size})`,t.x+r,t.y,'HVAC-TERMINAL-TAGS');
  }
  const units=z.unitPositions?.length?z.unitPositions:z.unitPos?[z.unitPos]:[];
  for(const [i,p] of units.entries()){start('CIRCLE','HVAC-EQUIPMENT');xy(p.x,p.y);pair(40,scale*0.25);text(`${z.catalogModel??'Unselected equipment'} #${i+1} — schematic symbol`,p.x,p.y+scale*0.5,'HVAC-EQUIPMENT-TAGS');}
 }
 for(const o of state.cadOpenings??[]) {
  if(o.status!=='approved')continue;
  start('LINE','HVAC-CAD-OPENINGS');xy(o.span.a.x,o.span.a.y);pair(11,o.span.b.x);pair(21,-o.span.b.y);
  text(`${o.id}: approved ${o.kind}, ${o.widthFt.toFixed(1)} ft`,o.center.x,o.center.y,'HVAC-CAD-OPENING-TAGS');
 }
 for(const o of state.cadObstacles??[]) {
  if(o.status!=='approved'||o.clearanceFt===undefined)continue;
  requireNonnegative('Obstacle clearance',o.clearanceFt);
  let tagX:number,tagY:number;
  if(o.shape==='circle'&&o.circle){start('CIRCLE','HVAC-CAD-OBSTACLES');xy(o.circle.x,o.circle.y);pair(40,o.circle.radius);tagX=o.circle.x;tagY=o.circle.y;}
  else {poly(o.polygon,'HVAC-CAD-OBSTACLES',true);tagX=o.polygon[0];tagY=o.polygon[1];}
  text(`${o.id}: approved obstacle, clearance ${o.clearanceFt.toFixed(1)} ft`,tagX,tagY,'HVAC-CAD-OBSTACLE-TAGS');
 }
 const bounds=state.dxfEntities.map(getCadEntityBounds);const titleX=bounds.length?bounds.reduce((min,b)=>Math.min(min,b.minX),Infinity):0,titleY=bounds.length?bounds.reduce((min,b)=>Math.min(min,b.minY),Infinity)-scale: -scale;
 text(`${project.name} | EGYPT | PRELIMINARY - NOT FOR CONSTRUCTION`,titleX,titleY,'HVAC-STATUS',scale*0.4);
 const insUnits={in:1,ft:2,mm:4,cm:5,m:6,custom:0}[project.cadUnit??'custom'];
 const headers=['0','SECTION','2','HEADER','9','$ACADVER','1','AC1027','9','$INSUNITS','70',String(insUnits),'0','ENDSEC','0','SECTION','2','TABLES','0','TABLE','2','LAYER','70',String(layerNames.size)];
 for(const layer of layerNames)headers.push('0','LAYER','2',layer,'70','0','62','7','6','CONTINUOUS');
 headers.push('0','ENDTAB','0','ENDSEC','0','SECTION','2','ENTITIES');
 const report:CadExportReport={status:'preliminary',issueReady:false,projectName:project.name,jurisdiction:'Egypt',standards:resolveStandardsSelection(project.standardsSelection),sourceProjectRevision:getProjectDeploymentRevision(project),limitations:[...new Set(limitations)],rooms:zones.map(z=>({id:z.id,name:z.name,sourceRevision:getZoneDeploymentRevision(z),status:z.engineeringStatus??'stale',load:calculateZoneLoadSafely(z,project),terminalCount:z.diffusers.length,ductCount:z.ducts.length,equipmentCount:z.unitPositions?.length??(z.unitPos?1:0)}))};
 return {text:[...headers,...body,'0','ENDSEC','0','EOF',''].join('\n'),report};
}
