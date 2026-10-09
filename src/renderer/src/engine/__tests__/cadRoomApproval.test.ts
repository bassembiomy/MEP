import {beforeEach,describe,it,expect} from 'vitest';
import {useProjectStore,type DxfEntity} from '../../store/projectStore';
import type {CadRoomCandidate} from '../cad/semanticTypes';
const entities:DxfEntity[]=[{type:'LWPOLYLINE',points:[0,0,200,0,200,150,0,150],closed:true,handle:'R1',layer:'ROOM'}];
const candidate:CadRoomCandidate={id:'room-R1',name:'Office',polygon:[0,0,200,0,200,150,0,150],areaSqFt:300,sourceHandles:['R1'],sourceLayers:['ROOM'],confidence:1,status:'review-required',evidence:['Closed native polygon'],unresolvedConditions:['Use requires approval']};
let inputs={name:'Cairo office',spaceTypeId:'office',ceilingHeight:10,occupants:2,sourceCadRevision:JSON.stringify(entities),drawingUnitsPerFoot:10,recognitionContext:''};
beforeEach(()=>{
 useProjectStore.setState({project:{name:'Egypt',location:'Cairo',units:'imperial',scale:10,outdoorDb:95,indoorDb:75,cadUnitsConfirmed:true},zones:[],dxfEntities:structuredClone(entities),selectedZoneId:null,undoStack:[],redoStack:[]});
 // Approval requires the recognition context of an actual recognition run.
 inputs={...inputs,recognitionContext:useProjectStore.getState().recognizeCadRoomCandidates().recognitionContext!};
});
describe('explicit CAD boundary approval',()=>{
 it('creates an editable stale room with preserved source evidence, no automatic equipment',()=>{
  const result=useProjectStore.getState().approveCadRoom(candidate,inputs);
  expect(result.success).toBe(true);
  const z=useProjectStore.getState().zones[0];
  expect(z.name).toBe('Cairo office');expect(z.points).toEqual(candidate.polygon);
  expect(z.engineeringStatus).toBe('stale');expect(z.ducts).toEqual([]);
  expect(z.cadProvenance?.sourceHandles).toEqual(['R1']);
  expect(z.cadProvenance?.drawingUnitsPerFoot).toBe(10);
 });
 it('rejects stale CAD, unconfirmed units and nonfinite inputs without changing zones',()=>{
  expect(useProjectStore.getState().approveCadRoom(candidate,{...inputs,sourceCadRevision:'old'}).success).toBe(false);
  expect(useProjectStore.getState().approveCadRoom(candidate,{...inputs,ceilingHeight:NaN}).success).toBe(false);
  useProjectStore.setState({project:{...useProjectStore.getState().project,cadUnitsConfirmed:false}});
  expect(useProjectStore.getState().approveCadRoom(candidate,inputs).success).toBe(false);
  expect(useProjectStore.getState().zones).toEqual([]);
 });
 it('rejects duplicate approvals and allows undo/redo of approved room creation',()=>{
  expect(useProjectStore.getState().approveCadRoom(candidate,inputs).success).toBe(true);
  expect(useProjectStore.getState().approveCadRoom(candidate,inputs).success).toBe(false);
  useProjectStore.getState().undo();expect(useProjectStore.getState().zones).toHaveLength(0);
  useProjectStore.getState().redo();expect(useProjectStore.getState().zones).toHaveLength(1);
 });
});
it('preserves the exact source CAD revision with an approved room',()=>{
 const r=useProjectStore.getState().approveCadRoom(candidate,inputs);expect(r.success).toBe(true);
 expect(useProjectStore.getState().zones[0].cadProvenance?.sourceCadRevision).toBe(inputs.sourceCadRevision);
});
