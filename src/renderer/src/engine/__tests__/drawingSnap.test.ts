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
 it('midpoint',()=>{
  const near=snapPoint({x:51,y:-48},{...base,entities:[line(0,0,100,0),line(50,-50,50,-20,'B')]});expect(near).toMatchObject({kind:'endpoint',point:{x:50,y:-50}}); // an endpoint within reach wins
  const side=snapPoint({x:51,y:-34},{...base,entities:[line(50,-50,50,-20,'B')]});expect(side).toMatchObject({kind:'midpoint',point:{x:50,y:-35},sourceHandle:'B'});
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
 it('10k entities: 100 snaps each resolve to the intended endpoint within a generous budget',()=>{
  const ents:DxfEntity[]=[];for(let i=0;i<10000;i++){const x=(i%100)*50,y=Math.floor(i/100)*50;ents.push(line(x,y,x+40,y+10,'h'+i));}
  const t=performance.now();
  for(let k=0;k<100;k++){
   const i=k*97,x=(i%100)*50+40,y=Math.floor(i/100)*50+10; // end vertex of entity i
   const r=snapPoint({x:x+1,y:y+1},{...base,entities:ents,gridSpacing:10});
   expect(r).toMatchObject({kind:'endpoint',point:{x,y},sourceHandle:'h'+i});
  }
  expect(performance.now()-t).toBeLessThan(5000); // generous: catches accidental O(n^2) work, not machine speed
 });
});
import {snappableCadEntities,groupCadEntitiesForRendering} from '../cad/renderGroups';
describe('snapping matches what is drawn (F5)',()=>{
 const layer=(name:string,visible:boolean)=>({name,visible,count:1});
 const on={...line(0,0,100,0,'ON'),layer:'On'},off={...line(0,50,100,50,'OFF'),layer:'Off'},none=line(0,80,100,80,'NOLAYER');
 const layers={On:layer('On',true),Off:layer('Off',false),'0':layer('0',true)};
 it('uses the render visibility rule: hidden layers are dropped, unknown/default layers stay',()=>{
  expect(snappableCadEntities([on,off,none],layers)).toEqual([on,none]);
  const drawn=groupCadEntitiesForRendering([on,off,none],layers).flatMap(g=>g.entities);
  expect(snappableCadEntities([on,off,none],layers).filter(e=>e.type!=='TEXT')).toEqual(drawn);
  expect(snappableCadEntities([on],Object.create(null))).toEqual([on]);
  expect(snappableCadEntities([{...on,layer:'constructor'}],{} as never)).toHaveLength(1); // prototype keys are not layers
 });
 it('a hidden layer no longer attracts snaps',()=>{
  const pt={x:99,y:51};
  expect(snapPoint(pt,{...base,entities:[off]}).kind).toBe('endpoint'); // raw entities would snap
  expect(snapPoint(pt,{...base,entities:snappableCadEntities([off],layers)}).kind).toBe('none');
 });
 it('elevated entities that are drawn snap once their level is passed',()=>{
  const up={...line(0,0,100,0,'UP'),elevation:3000,layer:'On'};
  const ents=snappableCadEntities([up],layers);
  expect(snapPoint({x:99,y:1},{...base,entities:ents}).kind).toBe('none');
  expect(snapPoint({x:99,y:1},{...base,entities:ents,level:3000})).toMatchObject({kind:'endpoint',sourceHandle:'UP'});
 });
});

describe('snap priority and caching',()=>{
 it('an endpoint within reach beats a closer intersection',()=>{
  const ents=[line(0,0,100,0,'A'),line(50,-50,50,50,'B'),line(53,2,53,30,'C')];
  expect(snapPoint({x:50.2,y:0.1},{...base,entities:ents})).toMatchObject({kind:'endpoint',point:{x:53,y:2},sourceHandle:'C'});
  expect(snapPoint({x:50.2,y:0.1},{...base,entities:ents.slice(0,2)})).toMatchObject({kind:'intersection',point:{x:50,y:0}}); // without C the intersection is chosen
 });
 it('an endpoint within reach beats a closer perpendicular foot',()=>{
  const ents=[line(0,0,100,0,'A'),line(33,2,33,40,'D')];
  const o={...base,lastPoint:{x:30,y:40}};
  expect(snapPoint({x:30.1,y:0.1},{...o,entities:ents})).toMatchObject({kind:'endpoint',point:{x:33,y:2}});
  expect(snapPoint({x:30.1,y:0.1},{...o,entities:ents.slice(0,1)})).toMatchObject({kind:'perpendicular',point:{x:30,y:0}});
 });
 it('zone vertices follow a replaced points array on the same zone object',()=>{
  const zone={id:'z1',points:[0,0,10,0,10,10]} as unknown as Zone;
  expect(snapPoint({x:10,y:9},{...base,zones:[zone]})).toMatchObject({kind:'endpoint',point:{x:10,y:10}});
  zone.points=[0,0,10,0,10,40];
  expect(snapPoint({x:10,y:39},{...base,zones:[zone]})).toMatchObject({kind:'endpoint',point:{x:10,y:40}});
  expect(snapPoint({x:10,y:9},{...base,zones:[zone]}).kind).not.toBe('endpoint');
 });
});
