import {describe,it,expect} from 'vitest';
import {exportProjectDxf} from '../export/exportDxf';
import {parseDxfText} from '../dxfParser';
import type {Zone,ProjectMetadata,DxfEntity} from '../../store/projectStore';
const project:ProjectMetadata={name:'Cairo',location:'Egypt',units:'imperial',scale:12,cadUnit:'in',cadUnitsConfirmed:true,outdoorDb:95,indoorDb:75};
const zone:Zone={id:'z',name:'Office',spaceTypeId:'office',ceilingHeight:10,occupants:2,points:[0,0,240,0,240,-180,0,-180],diffusers:[{id:'S1',type:'supply',x:60,y:-60,cfm:150,size:'12×12'},{id:'R1',type:'return',x:120,y:-60,cfm:150,size:'12×12'}],ducts:[{id:'D1',type:'trunk',points:[0,-60,60,-60],widthIn:10,heightIn:8,cfm:150,sizeLabel:'10×8'}],unitPos:{x:0,y:-60},catalogModel:'Model A',engineeringStatus:'preliminary'};
const native:DxfEntity[]=[{type:'LINE',x:10,y:-20,points:[40,-50],layer:'WALL',handle:'A'},{type:'ARC',x:0,y:0,radius:5,startAngleDeg:0,endAngleDeg:90,layer:'DOOR'},{type:'LWPOLYLINE',points:[0,0,10,0,10,-10],bulges:[1,0,0],closed:true,layer:'CURVE'},{type:'ELLIPSE',x:10,y:-20,majorAxis:{x:4,y:0},minorAxis:{x:0,y:-2},startParam:0,endParam:Math.PI/2,layer:'ELLIPSE'}];
describe('editable native CAD engineering deliverables',()=>{
 it('reopens original coordinates, native curves and CAD units',()=>{
  const exported=exportProjectDxf({project,zones:[zone],dxfEntities:native});const reopened=parseDxfText(exported.text);
  expect(reopened.cadUnit).toBe('in');expect(reopened.diagnostics?.filter(d=>d.severity==='error')).toEqual([]);
  expect(reopened.entities.find(e=>e.layer==='WALL')).toMatchObject({x:10,y:-20,points:[40,-50]});
  expect(reopened.entities.find(e=>e.layer==='DOOR')).toMatchObject({startAngleDeg:0,endAngleDeg:90});
  expect(reopened.entities.find(e=>e.layer==='CURVE')).toMatchObject({closed:true,bulges:[1,0,0]});
  expect(reopened.entities.find(e=>e.layer==='ELLIPSE')?.endParam).toBeCloseTo(Math.PI/2);
 });
 it('separates supply, return, equipment and dimensions with explicit preliminary status',()=>{
  const out=exportProjectDxf({project,zones:[zone],dxfEntities:[]});const entities=parseDxfText(out.text).entities;
  expect(entities.filter(e=>e.layer==='HVAC-SUPPLY-TERMINALS'&&e.type==='LWPOLYLINE')).toHaveLength(1);
  expect(entities.filter(e=>e.layer==='HVAC-RETURN-TERMINALS'&&e.type==='LWPOLYLINE')).toHaveLength(1);
  expect(entities.some(e=>e.type==='TEXT'&&e.text?.includes('150 CFM'))).toBe(true);
  expect(entities.some(e=>e.type==='TEXT'&&e.text?.includes('10 x 8 in'))).toBe(true);
  expect(out.report.status).toBe('preliminary');expect(out.report.issueReady).toBe(false);
  expect(out.text).toContain('PRELIMINARY');
 });
 it('equivalent metric display settings preserve engineering geometry and native coordinates',()=>{
  const a=parseDxfText(exportProjectDxf({project,zones:[zone],dxfEntities:native}).text).entities;
  const b=parseDxfText(exportProjectDxf({project:{...project,units:'metric',scale:12/0.3048},zones:[zone],dxfEntities:native}).text).entities;
  const geometry=(list:DxfEntity[])=>JSON.parse(JSON.stringify(list.filter(e=>e.type!=='TEXT'),(_key,v)=>typeof v==='number'?Math.round(v*1e9)/1e9:v));
  expect(geometry(b)).toEqual(geometry(a));
 });
 it('blocks an engineering export with unconfirmed units or nonfinite CAD',()=>{
  expect(()=>exportProjectDxf({project:{...project,cadUnitsConfirmed:false},zones:[zone],dxfEntities:native})).toThrow(/confirm/i);
  expect(()=>exportProjectDxf({project,zones:[zone],dxfEntities:[{type:'CIRCLE',x:NaN,y:0,radius:1}]})).toThrow(/finite|coordinate/i);
 });
});
it('rejects corrupt engineering flows instead of exporting NaN tags',()=>{
 expect(()=>exportProjectDxf({project,zones:[{...zone,diffusers:[{...zone.diffusers[0],cfm:NaN}]}],dxfEntities:[]})).toThrow(/finite|flow/i);
});
describe('elevation round trip',()=>{
 it('writes group 38/30 so elevated entities stay on their level after re-import',()=>{
  const elevated:DxfEntity[]=[
   {type:'LWPOLYLINE',points:[0,0,10,0,10,-10],closed:true,layer:'UP',elevation:120},
   {type:'LINE',x:1,y:-2,points:[5,-6],layer:'UPLINE',elevation:120},
   {type:'CIRCLE',x:3,y:-3,radius:2,layer:'UPCIRCLE',elevation:-30},
   {type:'ARC',x:3,y:-3,radius:2,startAngleDeg:0,endAngleDeg:90,layer:'UPARC',elevation:120},
   {type:'TEXT',x:3,y:-3,text:'T',layer:'UPTEXT',elevation:120},
   {type:'LINE',x:0,y:0,points:[1,1],layer:'FLAT'}];
  const out=parseDxfText(exportProjectDxf({project,zones:[],dxfEntities:elevated}).text).entities;
  expect(out.filter(e=>e.diagnostics).length).toBe(0);
  const el=(layer:string)=>(out.find(e=>e.layer===layer) as DxfEntity|undefined)?.elevation;
  expect(el('UP')).toBe(120);expect(el('UPLINE')).toBe(120);expect(el('UPCIRCLE')).toBe(-30);expect(el('UPARC')).toBe(120);expect(el('UPTEXT')).toBe(120);
  expect(el('FLAT')).toBeUndefined();
 });
});
