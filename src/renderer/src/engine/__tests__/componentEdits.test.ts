import {describe,it,expect} from 'vitest';
import {moveTerminal,moveIndoorUnit,translateDuct,verifyEditedZone,type EditContext} from '../cad/componentEdits';
import {validateNetwork} from '../deploymentValidation';
import {buildDeploymentManifest,executeDeploymentTransaction} from '../deploymentManager';
import {generateSystemCandidates,DEFAULT_OPTIMIZATION_WEIGHTS} from '../systemDesigner';
import {calculateCanonicalZoneLoad} from '../loadCalc';
import type {Zone,ProjectMetadata} from '../../store/projectStore';
const ctx:EditContext={drawingUnitsPerFoot:10,projectScale:10};
const duct=(id:string,type:'trunk'|'branch'|'return',points:number[],cfm:number)=>({id,type,points,widthIn:10,heightIn:8,cfm,sizeLabel:'10x8'});
const zone=():Zone=>({id:'z',name:'R',points:[0,0,400,0,400,300,0,300],spaceTypeId:'office',ceilingHeight:10,occupants:2,systemType:'concealed',
 unitPos:{x:20,y:150},unitPositions:[{x:20,y:150}],
 diffusers:[{id:'S1',type:'supply',x:100,y:50,cfm:150,size:'12x12',deltaPInWg:0.05},{id:'S2',type:'supply',x:250,y:250,cfm:150,size:'12x12',deltaPInWg:0.05},{id:'R1',type:'return',x:200,y:280,cfm:300,size:'12x12',deltaPInWg:0.05}],
 ducts:[duct('T',  'trunk',[20,150,300,150],300),duct('B1','branch',[100,150,100,50],150),duct('B2','branch',[250,150,250,250],150),duct('RET','return',[20,150,200,280],300)]});
const sum=(z:{diffusers:{cfm:number}[];ducts:{cfm:number}[]})=>[z.diffusers.reduce((s,t)=>s+t.cfm,0),z.ducts.reduce((s,d)=>s+d.cfm,0)];
const connected=(z:Zone)=>{const u=z.unitPositions!;validateNetwork(z.ducts.filter(d=>d.type!=='return'),z.diffusers.filter(t=>t.type!=='return'),u,10);validateNetwork(z.ducts.filter(d=>d.type==='return'),z.diffusers.filter(t=>t.type==='return'),u,10);};
describe('component edits',()=>{
 it('fixture is a valid network',()=>{expect(()=>connected(zone())).not.toThrow();});
 it('a moved terminal stays connected; branch start slides along the trunk',()=>{
  const z=zone(),r=moveTerminal(z,'S1',140,60,ctx);expect(r.ok).toBe(true);if(!r.ok)return;
  expect(r.patch.engineeringStatus).toBe('stale');
  const next={...z,...r.patch} as Zone;expect(()=>connected(next)).not.toThrow();
  expect(next.ducts.find(d=>d.id==='B1')!.points).toEqual([140,150,140,60]);
  expect(next.diffusers.find(t=>t.id==='S1')).toMatchObject({x:140,y:60});
  expect(sum(next)).toEqual(sum(z)); // airflow balance untouched
  expect(z.ducts[1].points).toEqual([100,150,100,50]); // input not mutated
 });
 it('stretches the trunk when a branch slides past its free end',()=>{
  const z=zone(),r=moveTerminal(z,'S2',350,250,ctx);expect(r.ok).toBe(true);if(!r.ok)return;
  const next={...z,...r.patch} as Zone;expect(()=>connected(next)).not.toThrow();
  expect(next.ducts.find(d=>d.id==='T')!.points).toEqual([20,150,350,150]);
 });
 it('moves return terminals with their duct end',()=>{
  const z=zone(),r=moveTerminal(z,'R1',220,270,ctx);expect(r.ok).toBe(true);if(!r.ok)return;
  expect((({...z,...r.patch}) as Zone).ducts.find(d=>d.id==='RET')!.points).toEqual([20,150,220,270]);
 });
 it('rejects moves outside the room, missing terminals and non-finite positions',()=>{
  expect(moveTerminal(zone(),'S1',500,50,ctx)).toMatchObject({ok:false,error:expect.stringMatching(/outside/)});
  expect(moveTerminal(zone(),'nope',5,5,ctx).ok).toBe(false);expect(moveTerminal(zone(),'S1',NaN,5,ctx).ok).toBe(false);
 });
 it('rejects an edit that would disconnect a valid network',()=>{
  const r=moveIndoorUnit(zone(),0,40,160,ctx);expect(r).toMatchObject({ok:false,error:expect.stringMatching(/disconnect|unbalance/)});
  const ok=moveIndoorUnit(zone(),0,60,150,ctx);expect(ok.ok).toBe(true);
  if(ok.ok){const next={...zone(),...ok.patch} as Zone;expect(()=>connected(next)).not.toThrow();expect(next.unitPositions).toEqual([{x:60,y:150}]);expect(next.unitPos).toEqual({x:60,y:150});}
  expect(moveIndoorUnit(zone(),0,-10,150,ctx).ok).toBe(false);
 });
 it('translating a duct keeps it inside the room',()=>{
  expect(translateDuct(zone(),'B1',0,-500,ctx).ok).toBe(false);
  expect(translateDuct(zone(),'B2',0,0,ctx)).toMatchObject({ok:true,patch:{}});
 });
});
describe('explicit verification against deployment evidence',()=>{
 const project:ProjectMetadata={name:'T',location:'Cairo',scale:10,units:'imperial',outdoorDb:95,indoorDb:75};
 const base:Zone={id:'zone-1',name:'Office',points:[60,60,260,60,260,210,60,210],spaceTypeId:'office',ceilingHeight:10,occupants:2,manualCfmOverride:350,diffusers:[],ducts:[],maxSpaceNcLimit:30};
 const load=calculateCanonicalZoneLoad(base,project);
 const cands=generateSystemCandidates(load.totalLoad,load.sensibleLoad,load.supplyCfm,base.spaceTypeId,load.area,true,DEFAULT_OPTIMIZATION_WEIGHTS,['concealed']);
 const manifest=buildDeploymentManifest(cands.candidates.find(c=>c.systemType==='concealed')||cands.candidates[0],base,[base],project);
 const tx=executeDeploymentTransaction(manifest,[base],project);
 it('accepts the freshly deployed zone, then reports (not hides) an invalid edit',()=>{
  expect(tx.success).toBe(true);const deployed=tx.updatedZones[0];
  expect(verifyEditedZone(deployed,manifest,project)).toMatchObject({ok:true});
  const broken={...deployed,diffusers:deployed.diffusers.map((t,i)=>i===0?{...t,cfm:t.cfm+50}:t)};
  const v=verifyEditedZone(broken,manifest,project);expect(v.ok).toBe(false);if(!v.ok)expect(v.error).toMatch(/engineering validation/);
  const far={...deployed,diffusers:deployed.diffusers.map((t,i)=>i===0?{...t,x:900}:t)};
  expect(verifyEditedZone(far,manifest,project).ok).toBe(false);
 });
 it('never claims validity without evidence',()=>{
  expect(verifyEditedZone(tx.updatedZones[0],null,project)).toMatchObject({ok:false,error:expect.stringMatching(/No deployment evidence/)});
  expect(verifyEditedZone({...tx.updatedZones[0],id:'other'},manifest,project).ok).toBe(false);
 });
 it('a terminal moved with moveTerminal on the real deployment is re-checked by the explicit step',()=>{
  const deployed=tx.updatedZones[0];
  for(const t of deployed.diffusers){
   const r=moveTerminal(deployed,t.id,t.x+10,t.y+10,{drawingUnitsPerFoot:10,projectScale:10});
   expect(r.ok).toBe(true);if(!r.ok)return;
   expect(r.patch.engineeringStatus).toBe('stale');
   expect(verifyEditedZone({...deployed,...r.patch} as Zone,manifest,project)).toMatchObject({ok:true});
  }
});
});
import {useProjectStore,selectPersistedProject} from '../../store/projectStore';
import {serializeProject} from '../project/projectSerialization';
describe('store.verifyZoneEdits',()=>{
 it('reports the validation error instead of claiming validity when evidence is missing or the layout is invalid',()=>{
  const z=zone();
  useProjectStore.setState({project:{name:'T',location:'Cairo',scale:10,units:'imperial',outdoorDb:95,indoorDb:75},zones:[z],deploymentEvidence:{}});
  const r=useProjectStore.getState().verifyZoneEdits('z');
  expect(r.success).toBe(false);expect(r.error).toMatch(/No deployment evidence/);
  const stored=useProjectStore.getState().zones[0];
  expect(stored.engineeringStatus).toBe('blocked');expect(stored.engineeringError).toMatch(/No deployment evidence/);
  expect(useProjectStore.getState().verifyZoneEdits('missing').success).toBe(false);
 });
});
describe('store.verifyZoneEdits against the inputs the deployment was designed for',()=>{
 const project:ProjectMetadata={name:'T',location:'Cairo',scale:10,units:'imperial',outdoorDb:95,indoorDb:75};
 const base:Zone={id:'zone-1',name:'Office',points:[60,60,260,60,260,210,60,210],spaceTypeId:'office',ceilingHeight:10,occupants:2,manualCfmOverride:350,diffusers:[],ducts:[],maxSpaceNcLimit:30};
 const s=()=>useProjectStore.getState();
 const z=()=>s().zones[0];
 function deploy(){
  const load=calculateCanonicalZoneLoad(base,project);
  const c=generateSystemCandidates(load.totalLoad,load.sensibleLoad,load.supplyCfm,base.spaceTypeId,load.area,true,DEFAULT_OPTIMIZATION_WEIGHTS,['concealed']).candidates.find(x=>x.systemType==='concealed'&&x.isValid)!;
  useProjectStore.setState({project:{...project},zones:[structuredClone(base)],selectedZoneId:'zone-1',deploymentEvidence:{},undoStack:[],redoStack:[],cadObstacles:[]});
  expect(s().applyCandidateTransaction(c)).toEqual({success:true});
 }
 it('verifies an untouched deployment and a pure terminal move',()=>{
  deploy();
  expect(s().verifyZoneEdits('zone-1').success).toBe(true);
  const t=z().diffusers[0];
  const r=moveTerminal(z(),t.id,t.x+10,t.y+10,{drawingUnitsPerFoot:10,projectScale:10});
  expect(r.ok).toBe(true);if(!r.ok)return;
  s().updateZone('zone-1',r.patch);
  expect(z().engineeringStatus).toBe('stale');
  expect(s().verifyZoneEdits('zone-1')).toMatchObject({success:true});
  expect(z().engineeringStatus).toBe('preliminary');
  expect(z().catalogEsp).toMatch(/in\.wg$/);
 });
 it('refuses after an occupant change',()=>{
  deploy();s().updateZone('zone-1',{occupants:30});
  const r=s().verifyZoneEdits('zone-1');
  expect(r.success).toBe(false);expect(r.error).toMatch(/inputs changed; re-run automatic design/);
  expect(z().engineeringStatus).toBe('blocked');
 });
 it('refuses after an outline edit',()=>{
  deploy();expect(s().moveZoneVertex('zone-1',2,300,230).success).toBe(true);
  const r=s().verifyZoneEdits('zone-1');expect(r.success).toBe(false);expect(r.error).toMatch(/inputs changed; re-run automatic design/);
 });
 it('refuses after the drawing scale is calibrated',()=>{
  deploy();expect(s().calibrateScaleFromPoints({x:0,y:0},{x:200,y:0},10,'ft').success).toBe(true);
  const r=s().verifyZoneEdits('zone-1');expect(r.success).toBe(false);expect(r.error).toMatch(/inputs changed; re-run automatic design/);
 });
 it('refuses when the equipment no longer matches or the unit positions disagree',()=>{
  deploy();const orig=z();
  useProjectStore.setState({zones:[{...orig,catalogModel:'Something Else'}]});
  expect(s().verifyZoneEdits('zone-1').success).toBe(false);
  useProjectStore.setState({zones:[{...orig,unitPos:{x:orig.unitPos!.x+5,y:orig.unitPos!.y},unitPositions:orig.unitPositions}]});
  const r=s().verifyZoneEdits('zone-1');expect(r.success).toBe(false);
 });
 it('drops the evidence with the room, on restore and on delete',()=>{
  deploy();expect(Object.keys(s().deploymentEvidence)).toEqual(['zone-1']);
  s().deleteZone('zone-1');expect(s().deploymentEvidence).toEqual({});expect(s().deploymentInputs).toEqual({});
  deploy();
  const saved=serializeProject(selectPersistedProject(s()));
  expect(s().restoreProjectDocument(saved)).toEqual({success:true});
  expect(s().deploymentEvidence).toEqual({});expect(s().deploymentInputs).toEqual({});
  expect(s().verifyZoneEdits('zone-1').success).toBe(false); // restored rooms have no deployment evidence
 });
});
