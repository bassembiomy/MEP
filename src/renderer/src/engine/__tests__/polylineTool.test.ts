import {describe,it,expect,beforeEach,vi,afterEach} from 'vitest';
import {polylineReducer as r,initialPolylineState,type PolylineEvent} from '../cad/polylineTool';
import {useProjectStore} from '../../store/projectStore';
const run=(events:PolylineEvent[],project={units:'imperial' as const,scale:1},tol=0)=>events.reduce(r,initialPolylineState(project,tol));
const sq=(n=10):PolylineEvent[]=>[{type:'click',x:0,y:0},{type:'click',x:n,y:0},{type:'click',x:n,y:n},{type:'click',x:0,y:n}];
describe('polyline tool',()=>{
 it('commits on enter',()=>{const s=run([...sq(),{type:'enter'}]);expect(s.committed).toEqual([0,0,10,0,10,10,0,10]);expect(s.points).toEqual([]);});
 it('closes by clicking the first point (with tolerance) or the explicit event',()=>{
  expect(run([...sq(),{type:'click',x:0.4,y:0.2}],undefined,0.5).committed).toEqual([0,0,10,0,10,10,0,10]);
  expect(run([...sq(),{type:'closeOnFirstPoint'}]).committed).not.toBeNull();
  expect(run([{type:'click',x:0,y:0},{type:'click',x:5,y:0},{type:'click',x:0,y:0}]).committed).toBeNull(); // fewer than 3 vertices never closes
 });
 it('backspace removes the last vertex; escape cancels',()=>{
  expect(run([...sq(),{type:'backspace'}]).points).toEqual([0,0,10,0,10,10]);
  expect(run([{type:'backspace'}]).points).toEqual([]);
  const e=run([...sq(),{type:'escape'}]);expect(e.points).toEqual([]);expect(e.committed).toBeNull();
 });
 it('removes duplicate points from double clicks',()=>{
  const s=run([{type:'click',x:0,y:0},{type:'click',x:10,y:0},{type:'click',x:10,y:0},{type:'click',x:10,y:10},{type:'click',x:10,y:10},{type:'enter'}]);
  expect(s.committed).toEqual([0,0,10,0,10,10]);
 });
 it('typed lengths: imperial feet and metric metres scaled to drawing units',()=>{
  const imp=run([{type:'click',x:0,y:0},{type:'move',x:50,y:0},{type:'typedLength',length:12}],{units:'imperial',scale:12});
  expect(imp.points.slice(2)).toEqual([144,0]);
  const met=run([{type:'click',x:0,y:0},{type:'move',x:0,y:-3},{type:'typedLength',length:4}],{units:'metric',scale:1000});
  expect(met.points[2]).toBeCloseTo(0);expect(met.points[3]).toBeCloseTo(-4000);
  expect(run([{type:'typedLength',length:3}]).message).toMatch(/start point/);
  expect(run([{type:'click',x:0,y:0},{type:'typedLength',length:3}]).message).toMatch(/cursor/);
  expect(run([{type:'click',x:0,y:0},{type:'move',x:1,y:0},{type:'typedLength',length:-3}]).message).toMatch(/positive/);
 });
 it('refuses self-intersecting and degenerate polygons, keeping the drawing',()=>{
  const bow=run([{type:'click',x:0,y:0},{type:'click',x:10,y:10},{type:'click',x:10,y:0},{type:'click',x:0,y:10},{type:'enter'}]);
  expect(bow.committed).toBeNull();expect(bow.message).toMatch(/self-intersect/i);expect(bow.points).toHaveLength(8);
  const line=run([{type:'click',x:0,y:0},{type:'click',x:5,y:0},{type:'click',x:10,y:0},{type:'enter'}]);
  expect(line.committed).toBeNull();expect(line.message).toBeTruthy();expect(line.points).toHaveLength(6);
  const fixed=r(r(bow,{type:'backspace'}),{type:'enter'});expect(fixed.committed).not.toBeNull();
 });
});
describe('store.addZone validation',()=>{
 beforeEach(()=>{vi.useFakeTimers();useProjectStore.setState({project:{name:'P',location:'Cairo',units:'imperial',scale:10,outdoorDb:95,indoorDb:75},zones:[],selectedZoneId:null,undoStack:[],redoStack:[],tempPoints:[1,2]})});
 afterEach(()=>{vi.clearAllTimers();vi.useRealTimers()});
 it('rejects self-intersecting and degenerate outlines, leaving zones unchanged',()=>{
  const a=useProjectStore.getState().addZone([0,0,10,10,10,0,0,10]);
  expect(a).toMatchObject({success:false});expect(a.error).toMatch(/self-intersect/i);
  expect(useProjectStore.getState().zones).toEqual([]);
  expect(useProjectStore.getState().addZone([0,0,5,0,10,0]).success).toBe(false);
  expect(useProjectStore.getState().zones).toEqual([]);
  expect(useProjectStore.getState().tempPoints).toEqual([1,2]); // drawing state kept on refusal
 });
 it('accepts a valid outline and strips duplicate points',()=>{
  const ok=useProjectStore.getState().addZone([0,0,100,0,100,0,100,80,0,80]);
  expect(ok.success).toBe(true);expect(useProjectStore.getState().zones[0].points).toEqual([0,0,100,0,100,80,0,80]);
  expect(useProjectStore.getState().tempPoints).toEqual([]);
 });
});
