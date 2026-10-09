import {describe,it,expect} from 'vitest';
import {snapPoint,physicalGridSpacing} from '../cad/drawingSnap';
import type {DxfEntity,Zone} from '../../store/projectStore';
const line=(x:number,y:number,x2:number,y2:number,h?:string):DxfEntity=>({type:'LINE',x,y,points:[x2,y2],handle:h});
const base={stageScale:1,tolerancePx:5};
describe('physicalGridSpacing',()=>{
 it('is 0.5 ft imperial and 100 mm metric in drawing units',()=>{
  expect(physicalGridSpacing({units:'imperial',scale:12})).toBeCloseTo(6);      // inches drawing
  expect(physicalGridSpacing({units:'imperial',scale:1})).toBeCloseTo(0.5);     // feet drawing
  expect(physicalGridSpacing({units:'metric',scale:1000})).toBeCloseTo(100);    // mm drawing
  expect(physicalGridSpacing({units:'metric',scale:1})).toBeCloseTo(0.1);       // metres drawing
  expect(()=>physicalGridSpacing({units:'metric',scale:0})).toThrow();
 });
 it('snaps to the same physical point in mm and ft projects',()=>{
  const mm=snapPoint({x:1234,y:-560},{...base,stageScale:0.001,tolerancePx:0,gridSpacing:physicalGridSpacing({units:'metric',scale:1000})});
  const m=snapPoint({x:1.234,y:-0.56},{...base,stageScale:1,tolerancePx:0,gridSpacing:physicalGridSpacing({units:'metric',scale:1})});
  expect(mm.point.x/1000).toBeCloseTo(m.point.x);expect(mm.point.y/1000).toBeCloseTo(m.point.y);
  const ft=snapPoint({x:3.7,y:2.1},{...base,tolerancePx:0,gridSpacing:physicalGridSpacing({units:'imperial',scale:1})});
  const inch=snapPoint({x:44.4,y:25.2},{...base,tolerancePx:0,gridSpacing:physicalGridSpacing({units:'imperial',scale:12})});
  expect(inch.point.x/12).toBeCloseTo(ft.point.x);expect(inch.point.y/12).toBeCloseTo(ft.point.y);
 });
});
describe('snapPoint kinds',()=>{
 const entities=[line(0,0,100,0,'A'),line(50,-50,50,50,'B')];
 it('endpoint',()=>{const r=snapPoint({x:101,y:2},{...base,entities});expect(r).toMatchObject({kind:'endpoint',point:{x:100,y:0},sourceHandle:'A'});});
 it('intersection beats midpoint',()=>{const r=snapPoint({x:51,y:1},{...base,entities});expect(r).toMatchObject({kind:'intersection',point:{x:50,y:0}});});
 it('midpoint',()=>{const r=snapPoint({x:51,y:-48},{...base,entities:[line(0,0,100,0),line(50,-50,50,-20,'B')]});expect(r.kind).toBe('endpoint');
  const m=snapPoint({x:49,y:1},{...base,entities:[line(0,0,100,0,'A')]});expect(m).toMatchObject({kind:'midpoint',point:{x:50,y:0}});});
 it('perpendicular from last point',()=>{const r=snapPoint({x:31,y:2},{...base,entities:[line(0,0,100,0,'A')],lastPoint:{x:30,y:40}});expect(r).toMatchObject({kind:'perpendicular',point:{x:30,y:0}});});
 it('grid and none',()=>{
  expect(snapPoint({x:12,y:19},{...base,entities:[],gridSpacing:10})).toMatchObject({kind:'grid',point:{x:10,y:20}});
  expect(snapPoint({x:12,y:19},{...base,entities:[]})).toMatchObject({kind:'none',point:{x:12,y:19}});
 });
 it('tolerance scales with zoom',()=>{
  expect(snapPoint({x:104,y:0},{...base,stageScale:1,entities}).kind).toBe('endpoint');
  expect(snapPoint({x:104,y:0},{...base,stageScale:10,entities,gridSpacing:10}).kind).toBe('grid');
 });
 it('snaps to zone vertices and ignores other levels',()=>{
  const zone={id:'z1',points:[0,0,10,0,10,10]} as unknown as Zone;
  expect(snapPoint({x:10,y:9},{...base,zones:[zone]})).toMatchObject({kind:'endpoint',sourceHandle:'z1'});
  const up={...line(0,0,100,0),elevation:120};
  expect(snapPoint({x:100,y:0},{...base,entities:[up]}).kind).toBe('none');
  expect(snapPoint({x:100,y:0},{...base,entities:[up],level:120}).kind).toBe('endpoint');
 });
 it('bulged polyline: vertices are endpoints, arc midpoint is the midpoint',()=>{
  const p:DxfEntity={type:'LWPOLYLINE',points:[0,0,10,0],bulges:[1,0],handle:'P'};
  expect(snapPoint({x:10,y:0.5},{...base,entities:[p]})).toMatchObject({kind:'endpoint',point:{x:10,y:0}});
  const m=snapPoint({x:5,y:4.5},{...base,entities:[p]});expect(m.kind).toBe('midpoint');expect(m.point.y).toBeCloseTo(5);
 });
 it('ortho locks to the dominant axis and keeps off-axis snaps honest',()=>{
  const r=snapPoint({x:80,y:6},{...base,lastPoint:{x:0,y:0},ortho:true,gridSpacing:10});expect(r).toMatchObject({kind:'grid',point:{x:80,y:0}});
  const v=snapPoint({x:3,y:80},{...base,lastPoint:{x:0,y:0},ortho:true,gridSpacing:10});expect(v.point).toEqual({x:0,y:80});
  const e=snapPoint({x:99,y:2},{...base,lastPoint:{x:0,y:0},ortho:true,entities:[line(0,0,100,0,'A')]});expect(e).toMatchObject({kind:'endpoint',point:{x:100,y:0}});
  const off=snapPoint({x:99,y:2},{...base,lastPoint:{x:0,y:30},ortho:true,entities:[line(0,0,100,0,'A')]});expect(off.point.y).toBe(30);expect(off.kind).not.toBe('endpoint');
 });
});
describe('performance',()=>{
 it('10k entities: 100 snaps stay fast',()=>{
  const ents:DxfEntity[]=[];for(let i=0;i<10000;i++){const x=(i%100)*50,y=Math.floor(i/100)*50;ents.push(line(x,y,x+40,y+10,'h'+i));}
  const t=performance.now();let hits=0;
  for(let i=0;i<100;i++){const r=snapPoint({x:(i%100)*50+41,y:Math.floor(i/2)*50+9},{...base,entities:ents,gridSpacing:10});if(r.kind==='endpoint')hits++;}
  expect(performance.now()-t).toBeLessThan(200);expect(hits).toBeGreaterThan(0);
 });
});
