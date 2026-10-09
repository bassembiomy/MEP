import {describe,it,expect} from 'vitest';
import {moveOutdoorUnit,moveTerminal,moveIndoorUnit,translateDuct,verifyEditedZone,zoneInputsFingerprint,type EditContext} from '../cad/componentEdits';
import {solveDirectedNetworkStaticPressure} from '../staticPressureCalc';
import {STANDARD_DIFFUSER_CATALOG,STANDARD_DUCT_TYPES} from '../hvacCatalogs';
import {validateNetwork} from '../deploymentValidation';
import {buildDeploymentManifest,executeDeploymentTransaction} from '../deploymentManager';
import {generateSystemCandidates,DEFAULT_OPTIMIZATION_WEIGHTS} from '../systemDesigner';
import {calculateCanonicalZoneLoad} from '../loadCalc';
import type {Zone,ProjectMetadata} from '../../store/projectStore';
const ctx:EditContext={drawingUnitsPerFoot:10};
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
 it('a return duct lying along the trunk is not mistaken for the branch parent',()=>{
  const z0=zone(),z:Zone={...z0,ducts:[duct('RET','return',[20,150,300,150,300,280],300),...z0.ducts.filter(d=>d.id!=='RET')]};
  const r=moveTerminal(z,'S2',350,250,ctx);expect(r.ok).toBe(true);if(!r.ok)return;
  const next={...z,...r.patch} as Zone;
  expect(next.ducts.find(d=>d.id==='T')!.points).toEqual([20,150,350,150]);
  expect(next.ducts.find(d=>d.id==='RET')!.points).toEqual([20,150,300,150,300,280]);
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
  // Sliding the unit past the first branch leaves that branch off the trunk.
  const r=moveIndoorUnit(zone(),0,120,150,ctx);expect(r).toMatchObject({ok:false,error:expect.stringMatching(/disconnect|unbalance/)});
  const ok=moveIndoorUnit(zone(),0,60,150,ctx);expect(ok.ok).toBe(true);
  if(ok.ok){const next={...zone(),...ok.patch} as Zone;expect(()=>connected(next)).not.toThrow();expect(next.unitPositions).toEqual([{x:60,y:150}]);expect(next.unitPos).toEqual({x:60,y:150});}
  expect(moveIndoorUnit(zone(),0,-10,150,ctx).ok).toBe(false);
 });
 it('moves the unit laterally as one coherent edit: trunk and return start follow, branch starts slide, terminals stay',()=>{
  const z=zone(),r=moveIndoorUnit(z,0,40,160,ctx);expect(r.ok).toBe(true);if(!r.ok)return;
  const next={...z,...r.patch} as Zone;expect(()=>connected(next)).not.toThrow();
  const pts=(id:string)=>next.ducts.find(d=>d.id===id)!.points;
  expect(pts('T')).toEqual([40,160,320,160]);
  expect(pts('RET')).toEqual([40,160,200,280]);
  expect(pts('B1')).toEqual([100,160,100,50]);expect(pts('B2')).toEqual([250,160,250,250]);
  expect(next.unitPos).toEqual({x:40,y:160});expect(next.unitPositions).toEqual([{x:40,y:160}]);
  expect(next.diffusers).toEqual(z.diffusers);expect(sum(next)).toEqual(sum(z));
  expect(r.patch.engineeringStatus).toBe('stale');
  expect(z.ducts[0].points).toEqual([20,150,300,150]); // input not mutated
 });
 it('refuses a unit move that would invert or collapse a branch',()=>{
  expect(moveIndoorUnit(zone(),0,20,250,ctx)).toMatchObject({ok:false,error:expect.stringMatching(/invert|zero length/)}); // trunk reaches B2's terminal row
  expect(moveIndoorUnit(zone(),0,20,260,ctx)).toMatchObject({ok:false,error:expect.stringMatching(/invert|zero length/)}); // trunk passes it
 });
});
describe('moveOutdoorUnit',()=>{
 it('moves the addressed unit and rejects an index with no unit, leaving status alone',()=>{
  const z={...zone(),outdoorUnitPos:{x:5,y:5},outdoorUnitPositions:[{x:5,y:5},{x:50,y:5}]};
  const r=moveOutdoorUnit(z,1,60,10);expect(r).toMatchObject({ok:true,patch:{outdoorUnitPositions:[{x:5,y:5},{x:60,y:10}],engineeringStatus:'stale'}});
  if(r.ok)expect(r.patch.outdoorUnitPos).toEqual({x:5,y:5});
  const first=moveOutdoorUnit(z,0,7,8);if(first.ok)expect(first.patch).toMatchObject({outdoorUnitPos:{x:7,y:8}});
  for(const bad of [2,-1,0.5])expect(moveOutdoorUnit(z,bad,1,1)).toMatchObject({ok:false,error:expect.stringMatching(/not found/)});
  expect(moveOutdoorUnit(zone(),0,1,1).ok).toBe(false); // no outdoor unit at all
  expect(moveOutdoorUnit({...zone(),outdoorUnitPos:{x:1,y:1}},0,3,4)).toMatchObject({ok:true,patch:{outdoorUnitPos:{x:3,y:4}}});
  expect(moveOutdoorUnit(z,0,NaN,1).ok).toBe(false);
 });
});
describe('translateDuct',()=>{
 it('dragging a trunk moves the unit, the whole trunk row and the return start',()=>{
  const z=zone(),r=translateDuct(z,'T',0,20,ctx);expect(r.ok).toBe(true);if(!r.ok)return;
  const next={...z,...r.patch} as Zone;expect(()=>connected(next)).not.toThrow();
  expect(next.ducts.find(d=>d.id==='T')!.points).toEqual([20,170,300,170]);
  expect(next.ducts.find(d=>d.id==='B1')!.points).toEqual([100,170,100,50]);
  expect(next.ducts.find(d=>d.id==='RET')!.points).toEqual([20,170,200,280]);
  expect(next.unitPos).toEqual({x:20,y:170});expect(r.patch.engineeringStatus).toBe('stale');
 });
 it('shifts every point of a multi-point trunk and follows chained trunk segments',()=>{
  const z:Zone={...zone(),
   ducts:[duct('T1','trunk',[20,150,160,150],300),duct('T2','trunk',[160,150,300,150,300,200],150),duct('B1','branch',[100,150,100,50],150),duct('RET','return',[20,150,200,280],300)],
   diffusers:[{id:'S1',type:'supply',x:100,y:50,cfm:150,size:'12x12',deltaPInWg:0.05},{id:'S2',type:'supply',x:300,y:200,cfm:150,size:'12x12',deltaPInWg:0.05},{id:'R1',type:'return',x:200,y:280,cfm:300,size:'12x12',deltaPInWg:0.05}]};
  expect(()=>connected(z)).not.toThrow();
  const r=translateDuct(z,'T2',0,10,ctx);expect(r).toMatchObject({ok:true});if(!r.ok)return;
  const next={...z,...r.patch} as Zone;expect(()=>connected(next)).not.toThrow();
  expect(next.ducts.find(d=>d.id==='T1')!.points).toEqual([20,160,160,160]);
  expect(next.ducts.find(d=>d.id==='T2')!.points).toEqual([160,160,300,160,300,210]);
  expect(next.diffusers.find(t=>t.id==='S2')).toMatchObject({x:300,y:210}); // terminal on the trunk end travels with it
  expect(next.diffusers.find(t=>t.id==='S1')).toMatchObject({x:100,y:50});
 });
 it('does not depend on raw drawing units: the same drag works in a project drawn 100x larger',()=>{
  const big=(z:Zone):Zone=>({...z,points:z.points.map(v=>v*100),unitPos:{x:z.unitPos!.x*100,y:z.unitPos!.y*100},unitPositions:z.unitPositions!.map(u=>({x:u.x*100,y:u.y*100})),
   diffusers:z.diffusers.map(t=>({...t,x:t.x*100,y:t.y*100})),ducts:z.ducts.map(d=>({...d,points:d.points.map(v=>v*100)}))});
  const z=big(zone()),c:EditContext={drawingUnitsPerFoot:1000};
  const r=translateDuct(z,'T',0,2000,c);expect(r.ok).toBe(true);if(!r.ok)return;
  const next={...z,...r.patch} as Zone;
  expect(next.ducts.find(d=>d.id==='B1')!.points).toEqual([10000,17000,10000,5000]);
  expect(()=>{validateNetwork(next.ducts.filter(d=>d.type!=='return'),next.diffusers.filter(t=>t.type!=='return'),next.unitPositions!,1000)}).not.toThrow();
 });
 it('reports a duct that no unit feeds',()=>{
  expect(translateDuct(zone(),'nope',1,1,ctx).ok).toBe(false);
  expect(translateDuct({...zone(),unitPos:undefined,unitPositions:undefined},'T',0,10,ctx).ok).toBe(false);
 });
 it('translating a duct keeps it inside the room',()=>{
  expect(translateDuct(zone(),'B1',0,-500,ctx).ok).toBe(false);
  expect(translateDuct(zone(),'B2',0,0,ctx)).toMatchObject({ok:true,patch:{}});
 });
});
describe('static pressure refresh uses drawing units per foot',()=>{
 it('a metric project (scale per metre) gets the same estimate as the deployment calculation',()=>{
  // 30.48 drawing units per foot is a 100 units/metre project; project.scale itself must not be used as units/ft.
  const upf=30.48,z=zone();
  const r=moveTerminal(z,'S1',140,60,{drawingUnitsPerFoot:upf});expect(r.ok).toBe(true);if(!r.ok)return;
  const expected=solveDirectedNetworkStaticPressure(r.patch.ducts!,r.patch.diffusers!,STANDARD_DIFFUSER_CATALOG,STANDARD_DUCT_TYPES[0],upf).espRequiredInWg;
  expect(expected).toBeGreaterThan(0);
  const wrong=solveDirectedNetworkStaticPressure(r.patch.ducts!,r.patch.diffusers!,STANDARD_DIFFUSER_CATALOG,STANDARD_DUCT_TYPES[0],upf*3.28084).espRequiredInWg;
  expect(wrong.toFixed(2)).not.toBe(expected.toFixed(2)); // the fixture can tell the two scales apart
  expect(r.patch.catalogEsp).toBe(`${expected.toFixed(2)} in.wg`);
 });
});
describe('explicit verification against deployment evidence',()=>{
 const project:ProjectMetadata={name:'T',location:'Cairo',scale:10,units:'imperial',outdoorDb:95,indoorDb:75};
 const base:Zone={id:'zone-1',name:'Office',points:[60,60,260,60,260,210,60,210],spaceTypeId:'office',ceilingHeight:10,occupants:2,manualCfmOverride:350,diffusers:[],ducts:[],maxSpaceNcLimit:30};
 const load=calculateCanonicalZoneLoad(base,project);
 const cands=generateSystemCandidates(load.totalLoad,load.sensibleLoad,load.supplyCfm,base.spaceTypeId,load.area,true,DEFAULT_OPTIMIZATION_WEIGHTS,['concealed']);
 const manifest=buildDeploymentManifest(cands.candidates.find(c=>c.systemType==='concealed')||cands.candidates[0],base,[base],project);
 const tx=executeDeploymentTransaction(manifest,[base],project);
 const fp=zoneInputsFingerprint(tx.updatedZones[0]);
 it('accepts the freshly deployed zone, then reports (not hides) an invalid edit',()=>{
  expect(tx.success).toBe(true);const deployed=tx.updatedZones[0];
  expect(verifyEditedZone(deployed,manifest,project,fp)).toMatchObject({ok:true});
  const broken={...deployed,diffusers:deployed.diffusers.map((t,i)=>i===0?{...t,cfm:t.cfm+50}:t)};
  const v=verifyEditedZone(broken,manifest,project,fp);expect(v.ok).toBe(false);if(!v.ok)expect(v.error).toMatch(/engineering validation/);
  const far={...deployed,diffusers:deployed.diffusers.map((t,i)=>i===0?{...t,x:900}:t)};
  expect(verifyEditedZone(far,manifest,project,fp).ok).toBe(false);
 });
 it('refuses when no input fingerprint is supplied, or when the current load no longer matches the evidence',()=>{
  const deployed=tx.updatedZones[0];
  expect(verifyEditedZone(deployed,manifest,project,undefined)).toMatchObject({ok:false,error:expect.stringMatching(/No deployment evidence/)});
  const ev=manifest.engineeringEvidence!;
  for(const key of ['requiredSupplyCfm','requiredTotalBtuPerHour','drawingUnitsPerFoot'] as const){
   const tampered={...manifest,engineeringEvidence:{...ev,[key]:ev[key]+1}};
   expect(verifyEditedZone(deployed,tampered,project,fp),key).toMatchObject({ok:false,error:expect.stringMatching(/load or drawing scale evidence/)});
  }
 });
 it('never claims validity without evidence',()=>{
  expect(verifyEditedZone(tx.updatedZones[0],null,project,fp)).toMatchObject({ok:false,error:expect.stringMatching(/No deployment evidence/)});
  expect(verifyEditedZone({...tx.updatedZones[0],id:'other'},manifest,project,fp).ok).toBe(false);
 });
 it('a unit dragged sideways on the real deployment stays network-valid and is re-checked by the explicit step',()=>{
  const deployed=tx.updatedZones[0],u=deployed.unitPos!;
  for(const [dx,dy] of [[-10,0],[0,-10],[-8,-6]]){
   const r=moveIndoorUnit(deployed,0,u.x+dx,u.y+dy,{drawingUnitsPerFoot:10});
   expect(r.ok,JSON.stringify([dx,dy,r])).toBe(true);if(!r.ok)return;
   const next={...deployed,...r.patch} as Zone;
   validateNetwork(next.ducts.filter(d=>d.type!=='return'),next.diffusers.filter(t=>t.type!=='return'),next.unitPositions!,10);
   validateNetwork(next.ducts.filter(d=>d.type==='return'),next.diffusers.filter(t=>t.type==='return'),next.unitPositions!,10);
   expect(next.unitPos).toEqual(next.unitPositions![0]);
   expect(verifyEditedZone(next,manifest,project,fp)).toMatchObject({ok:true});
  }
 });
 it('a terminal moved with moveTerminal on the real deployment is re-checked by the explicit step',()=>{
  const deployed=tx.updatedZones[0];
  for(const t of deployed.diffusers){
   const r=moveTerminal(deployed,t.id,t.x+10,t.y+10,{drawingUnitsPerFoot:10});
   expect(r.ok).toBe(true);if(!r.ok)return;
   expect(r.patch.engineeringStatus).toBe('stale');
   expect(verifyEditedZone({...deployed,...r.patch} as Zone,manifest,project,fp)).toMatchObject({ok:true});
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
  const r=moveTerminal(z(),t.id,t.x+10,t.y+10,{drawingUnitsPerFoot:10});
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
describe('cassette rooms keep each terminal at its unit',()=>{
 const project:ProjectMetadata={name:'T',location:'Cairo',scale:10,units:'imperial',outdoorDb:95,indoorDb:75};
 const base:Zone={id:'zone-c',name:'Hall',points:[0,0,400,0,400,300,0,300],spaceTypeId:'office',ceilingHeight:10,occupants:2,diffusers:[],ducts:[],maxSpaceNcLimit:30};
 const load=calculateCanonicalZoneLoad(base,project);
 const cand=generateSystemCandidates(load.totalLoad,load.sensibleLoad,load.supplyCfm,base.spaceTypeId,load.area,true,DEFAULT_OPTIMIZATION_WEIGHTS,['cassette']).candidates.find(c=>c.systemType==='cassette'&&c.isValid)!;
 const manifest=buildDeploymentManifest(cand,base,[base],project);
 const tx=executeDeploymentTransaction(manifest,[base],project);
 const deployed=tx.updatedZones[0];
 const fp=()=>zoneInputsFingerprint(deployed);
 it('fixture is a deployed cassette room with terminals at the unit positions',()=>{
  expect(tx.success).toBe(true);expect(deployed.diffusers.length).toBeGreaterThan(0);
  expect(deployed.diffusers.every(t=>t.type==='cassette')).toBe(true);
  deployed.unitPositions!.forEach((u,i)=>expect(deployed.diffusers[i]).toMatchObject({x:u.x,y:u.y}));
  expect(verifyEditedZone(deployed,manifest,project,fp())).toMatchObject({ok:true});
 });
 it('moving a cassette unit carries its terminal, and the explicit step still verifies',()=>{
  const u=deployed.unitPositions![0],r=moveIndoorUnit(deployed,0,u.x+5,u.y+5,{drawingUnitsPerFoot:10});
  expect(r.ok).toBe(true);if(!r.ok)return;
  const next={...deployed,...r.patch} as Zone;
  expect(next.diffusers[0]).toMatchObject({x:u.x+5,y:u.y+5});
  next.unitPositions!.forEach((p,i)=>expect(next.diffusers[i]).toMatchObject({x:p.x,y:p.y}));
  expect(verifyEditedZone(next,manifest,project,fp())).toMatchObject({ok:true});
 });
 it('refuses to move a cassette terminal on its own',()=>{
  const t=deployed.diffusers[0];
  expect(moveTerminal(deployed,t.id,t.x+5,t.y,{drawingUnitsPerFoot:10})).toEqual({ok:false,error:'Move the cassette unit instead'});
 });
 it('verification refuses a hand-separated cassette terminal',()=>{
  const t=deployed.diffusers[0];
  const split={...deployed,diffusers:deployed.diffusers.map(d=>d.id===t.id?{...d,x:t.x+3}:d)};
  const v=verifyEditedZone(split,manifest,project,fp());expect(v.ok).toBe(false);
  if(!v.ok)expect(v.error).toMatch(/cassette terminal/i);
 });
});
