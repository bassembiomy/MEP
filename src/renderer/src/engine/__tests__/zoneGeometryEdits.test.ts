import {describe,it,expect,beforeEach,vi,afterEach} from 'vitest';
import {moveTerminal,moveIndoorUnit} from '../cad/componentEdits';
import {moveVertex,insertVertex,deleteVertex,offsetEdge} from '../cad/zoneGeometryEdits';
import {useProjectStore,type Zone} from '../../store/projectStore';
const L=[0,0,100,0,100,40,40,40,40,100,0,100]; // concave L
describe('pure zone edits',()=>{
 it('moves a vertex of a concave outline when it stays simple',()=>{
  const r=moveVertex(L,3,60,60);expect(r).toMatchObject({ok:true});if(r.ok)expect(r.points.slice(6,8)).toEqual([60,60]);
 });
 it('rejects a move that self-intersects',()=>{
  expect(moveVertex(L,3,-50,-50)).toMatchObject({ok:false});
  expect(moveVertex([0,0,10,0,10,10,0,10],2,-5,5)).toMatchObject({ok:false});
 });
 it('rejects coincident vertices and bad indexes',()=>{
  expect(moveVertex(L,1,0,0)).toMatchObject({ok:false});expect(moveVertex(L,9,0,0)).toMatchObject({ok:false});
  expect(moveVertex(L,0,NaN,0)).toMatchObject({ok:false});
 });
 it('inserts on an edge and keeps it simple',()=>{
  const r=insertVertex([0,0,10,0,10,10,0,10],0,5,-3);expect(r).toMatchObject({ok:true});if(r.ok)expect(r.points).toEqual([0,0,5,-3,10,0,10,10,0,10]);
  expect(insertVertex([0,0,10,0,10,10,0,10],0,5,20)).toMatchObject({ok:false});
 });
 it('delete below 3 vertices is rejected, concave delete works',()=>{
  expect(deleteVertex([0,0,10,0,5,8],0)).toMatchObject({ok:false});
  const r=deleteVertex(L,3);expect(r).toMatchObject({ok:true});if(r.ok)expect(r.points).toHaveLength(10);
  expect(deleteVertex([0,0,10,0,10,10,0,10],9)).toMatchObject({ok:false});
 });
 it('offsets an edge outward for both windings; collapsing offsets are rejected',()=>{
  const ccw=[0,0,10,0,10,10,0,10],cw=[0,0,0,10,10,10,10,0];
  const a=offsetEdge(ccw,1,5);expect(a).toMatchObject({ok:true});if(a.ok)expect(a.points.slice(2,6)).toEqual([15,0,15,10]);
  const b=offsetEdge(cw,2,5);expect(b).toMatchObject({ok:true});
  if(b.ok)expect(b.points).toEqual([0,0,0,10,15,10,15,0]); // edge 2 (x=10) moved outward to x=15, the rest untouched
  expect(offsetEdge(ccw,1,-10)).toMatchObject({ok:false}); // collapses onto the opposite edge
 });
});
describe('store zone edits',()=>{
 const zone=(extra:Partial<Zone>={}):Zone=>({id:'z',name:'R',points:[0,0,100,0,100,100,0,100],spaceTypeId:'office',ceilingHeight:10,occupants:2,diffusers:[],ducts:[],engineeringStatus:'preliminary',...extra});
 beforeEach(()=>{vi.useFakeTimers();useProjectStore.setState({project:{name:'P',location:'Cairo',units:'imperial',scale:10,outdoorDb:95,indoorDb:75},zones:[zone()],selectedZoneId:'z',undoStack:[],redoStack:[]})});
 afterEach(()=>{vi.clearAllTimers();vi.useRealTimers()});
 const z=()=>useProjectStore.getState().zones[0];
 it('invalid edits are rejected: zone, status and undo stack unchanged',()=>{
  const before=structuredClone(z());const s=useProjectStore.getState();
  for(const r of [s.moveZoneVertex('z',2,-50,50),s.deleteZoneVertex('z',9),s.insertZoneVertex('z',0,50,500),s.offsetZoneEdge('z',0,-100),s.moveZoneVertex('nope',0,1,1)]){expect(r.success).toBe(false);expect(r.error).toBeTruthy();}
  expect(z()).toEqual(before);expect(useProjectStore.getState().undoStack).toHaveLength(0);
 });
 it('valid edits mark the zone stale and undo/redo restore exact points',()=>{
  const orig=[...z().points];const s=useProjectStore.getState();
  expect(s.moveZoneVertex('z',2,123.456789,98.7654321)).toEqual({success:true});
  expect(z().engineeringStatus).toBe('stale');expect(z().points.slice(4,6)).toEqual([123.456789,98.7654321]);
  expect(useProjectStore.getState().undoStack).toHaveLength(1);
  const edited=[...z().points];
  useProjectStore.getState().undo();expect(z().points).toEqual(orig);expect(z().engineeringStatus).toBe('preliminary');
  useProjectStore.getState().redo();expect(z().points).toEqual(edited);
  expect(useProjectStore.getState().insertZoneVertex('z',0,50,-10).success).toBe(true);expect(z().points).toHaveLength(10);
  expect(useProjectStore.getState().deleteZoneVertex('z',1).success).toBe(true);
  expect(useProjectStore.getState().offsetZoneEdge('z',0,5).success).toBe(true);
  expect(useProjectStore.getState().undoStack).toHaveLength(4);
 });
 it('CAD-approved rooms record userModified; hand-drawn rooms do not',()=>{
  useProjectStore.getState().moveZoneVertex('z',2,110,110);expect(z().cadProvenance).toBeUndefined();
  useProjectStore.setState({zones:[zone({cadProvenance:{candidateId:'c1',sourceHandles:[],sourceLayers:[],evidence:[],unresolvedConditions:[],drawingUnitsPerFoot:10,approvedAt:'2026-01-01T00:00:00Z'}})],undoStack:[]});
  useProjectStore.getState().moveZoneVertex('z',2,110,110);
  expect(z().cadProvenance?.userModified?.edits).toHaveLength(1);expect(z().cadProvenance?.candidateId).toBe('c1');
  useProjectStore.getState().undo();expect(z().cadProvenance?.userModified).toBeUndefined();
 });
});

describe('component drags are undoable steps',()=>{
 const zone=():Zone=>({id:'z',name:'R',points:[0,0,400,0,400,300,0,300],spaceTypeId:'office',ceilingHeight:10,occupants:2,systemType:'concealed',unitPos:{x:20,y:150},unitPositions:[{x:20,y:150}],
  diffusers:[{id:'S1',type:'supply',x:100,y:50,cfm:150,size:'12x12',deltaPInWg:0.05}],
  ducts:[{id:'T',type:'trunk',points:[20,150,300,150],widthIn:10,heightIn:8,cfm:150,sizeLabel:'10x8'},{id:'B1',type:'branch',points:[100,150,100,50],widthIn:10,heightIn:8,cfm:150,sizeLabel:'10x8'}],engineeringStatus:'preliminary'});
 beforeEach(()=>{useProjectStore.setState({project:{name:'P',location:'Cairo',units:'imperial',scale:10,outdoorDb:95,indoorDb:75},zones:[zone()],selectedZoneId:'z',undoStack:[],redoStack:[],cadObstacles:[]})});
 const z=()=>useProjectStore.getState().zones[0];
 const s=()=>useProjectStore.getState();
 it('each accepted drag pushes one snapshot; undo reverts only that drag, not the earlier outline edit',()=>{
  expect(s().moveZoneVertex('z',2,420,300).success).toBe(true);
  const afterOutline=structuredClone(z());
  const t=moveTerminal(z(),'S1',140,60,{drawingUnitsPerFoot:10});expect(t.ok).toBe(true);if(!t.ok)return;
  expect(s().applyComponentEdit('z',t)).toMatchObject({success:true});
  expect(s().undoStack).toHaveLength(2);expect(z().diffusers[0]).toMatchObject({x:140,y:60});expect(z().engineeringStatus).toBe('stale');
  const u=moveIndoorUnit(z(),0,40,160,{drawingUnitsPerFoot:10});expect(u.ok).toBe(true);if(!u.ok)return;
  expect(s().applyComponentEdit('z',u).success).toBe(true);expect(s().undoStack).toHaveLength(3);
  s().undo();expect(z().unitPos).toEqual({x:20,y:150});expect(z().diffusers[0]).toMatchObject({x:140,y:60});
  s().undo();expect(z().diffusers[0]).toMatchObject({x:100,y:50});expect(z().points).toEqual(afterOutline.points);
  s().redo();expect(z().diffusers[0]).toMatchObject({x:140,y:60});
  s().undo();s().undo();expect(z().points).toEqual(zone().points);
 });
 it('a refused edit changes nothing and pushes no snapshot',()=>{
  const bad=moveTerminal(z(),'S1',900,50,{drawingUnitsPerFoot:10});expect(bad.ok).toBe(false);
  const before=structuredClone(z());
  expect(s().applyComponentEdit('z',bad)).toMatchObject({success:false,error:expect.stringMatching(/outside/)});
  expect(z()).toEqual(before);expect(s().undoStack).toHaveLength(0);
  expect(s().applyComponentEdit('nope',{ok:true,patch:{},warnings:[]}).success).toBe(false);
 });
});
