import { describe, expect, it } from 'vitest';
import { parseProjectDocument, serializeProject } from '../project/projectSerialization';
import type { ProjectMetadata, Zone, DxfEntity } from '../../store/projectStore';
import { DEFAULT_ANNOTATION_VISIBILITY, useProjectStore } from '../../store/projectStore';
import { calculateCanonicalZoneLoad } from '../loadCalc';
import { DEFAULT_OPTIMIZATION_WEIGHTS } from '../systemDesigner';

const project: ProjectMetadata = {name:'Cairo office',location:'Egypt',units:'imperial',scale:10,outdoorDb:95,indoorDb:75};
const zone: Zone = {id:'z1',name:'Office',points:[0,0,200,0,200,150,0,150],ceilingHeight:10,occupants:2,spaceTypeId:'office',systemType:'fcu',diffusers:[],ducts:[],isDuctLocked:true};
const native: DxfEntity[] = [{type:'LWPOLYLINE',points:[0,0,200,0,200,-150,0,-150],closed:true,bulges:[0,0,0,0],layer:'ROOM',handle:'A1'},
  {type:'ARC',x:100,y:-100,radius:10,startAngleDeg:0,endAngleDeg:90,handle:'A2',layer:'DOOR'}];
const state = () => ({project,zones:[zone],dxfEntities:native,dxfBoundingBox:{minX:0,maxX:200,minY:-150,maxY:0},dxfLayers:{ROOM:{name:'ROOM',color:'#123456',visible:false,count:1}}});

// These are the records produced by the default/custom Excel catalog IPC parsers.
const decorativeUnit = {spaceName:'Office',hapLoad:18000,hapCfm:0,unitType:'High wall',capacity:18000,cfm:0,model:'18K',rowNumber:3,source:'Decorative unit Selection.xlsx'};
const ductedUnit = {spaceName:'Office',hapTotal:24000,hapSensible:0,hapCfm:0,enteringDbWb:'',capacity:24000,sensibleCapacity:0,cfm:0,model:'DX-24',esp:'0.16 In',qty:1,rowNumber:3,source:'Ducted unit Selection.xlsx'};
const catalogs = {decorative:{highWall:[decorativeUnit],cassette:[{...decorativeUnit,unitType:'Cassette',model:'24K',capacity:24000,cfm:700}]},ducted:[ductedUnit],errors:['Optional catalog unavailable']};
const importMetadata = {sourceName:'plan.dxf',unitsConfidence:'estimated' as const,diagnostics:[{code:'UNSUPPORTED_ENTITY',severity:'warning' as const,message:'Entity skipped',entityType:'HATCH',handle:'A3'}]};
const optionalState = () => ({...state(),cadImport:importMetadata,annotationVisibility:DEFAULT_ANNOTATION_VISIBILITY,optimizationWeights:DEFAULT_OPTIMIZATION_WEIGHTS,loadedCatalogs:catalogs});

describe('persisted optional state validation',()=>{
  it('round trips complete visibility, weights, CAD diagnostics, Excel catalogs and unit positions',()=>{
    const saved={...optionalState(),zones:[{...zone,unitPos:{x:1,y:2},unitPositions:[{x:1,y:2},{x:3,y:4}],outdoorUnitPos:{x:-1,y:2},outdoorUnitPositions:[{x:-1,y:2}]}]};
    const restored=parseProjectDocument(serializeProject(saved));
    expect(restored.annotationVisibility).toEqual(DEFAULT_ANNOTATION_VISIBILITY);
    expect(restored.optimizationWeights).toEqual(DEFAULT_OPTIMIZATION_WEIGHTS);
    expect(restored.cadImport).toEqual(importMetadata);
    expect(restored.loadedCatalogs).toEqual(catalogs);
    expect(restored.zones[0].unitPositions).toEqual([{x:1,y:2},{x:3,y:4}]);
    expect(restored.zones[0].outdoorUnitPositions).toEqual([{x:-1,y:2}]);
  });
  it('accepts null CAD metadata and null or independently unloaded catalogs',()=>{
    for(const loadedCatalogs of [null,{decorative:null,ducted:null},{decorative:catalogs.decorative,ducted:null},{decorative:null,ducted:catalogs.ducted}]) {
      const restored=parseProjectDocument(serializeProject({...state(),cadImport:null,loadedCatalogs}));
      expect(restored.cadImport).toBeNull();
      expect(restored.loadedCatalogs).toEqual(loadedCatalogs);
    }
  });
  it.each([
    ['annotationVisibility',null],['annotationVisibility',[]],['annotationVisibility',{}],
    ['annotationVisibility',{...DEFAULT_ANNOTATION_VISIBILITY,grid:'false'}],
    ['optimizationWeights',{}],['optimizationWeights',{...DEFAULT_OPTIMIZATION_WEIGHTS,wEnergy:'0.5'}],
    ['cadImport',[]],['cadImport',{}],['cadImport',{...importMetadata,sourceName:17}],
    ['cadImport',{...importMetadata,unitsConfidence:'certain'}],['cadImport',{...importMetadata,diagnostics:{}}],
    ['cadImport',{...importMetadata,diagnostics:[null]}],
    ['cadImport',{...importMetadata,diagnostics:[{code:7,severity:'warning',message:'Skipped'}]}],
    ['cadImport',{...importMetadata,diagnostics:[{code:'BAD',severity:'info',message:'Skipped'}]}],
    ['cadImport',{...importMetadata,diagnostics:[{code:'BAD',severity:'error',message:{}}]}],
    ['cadImport',{...importMetadata,diagnostics:[{code:'BAD',severity:'error',message:'Skipped',handle:17}]}],
    ['loadedCatalogs',[]],['loadedCatalogs',{}],['loadedCatalogs',{decorative:[],ducted:null}],
    ['loadedCatalogs',{decorative:{highWall:[],cassette:{}},ducted:null}],
    ['loadedCatalogs',{decorative:null,ducted:{}}],['loadedCatalogs',{decorative:null,ducted:[null]}],
    ['loadedCatalogs',{...catalogs,errors:[null]}],
    ['loadedCatalogs',{...catalogs,decorative:{highWall:[{...decorativeUnit,capacity:'18000'}],cassette:[]}}],
    ['loadedCatalogs',{...catalogs,decorative:{highWall:[{...decorativeUnit,cfm:null}],cassette:[]}}],
    ['loadedCatalogs',{...catalogs,ducted:[{...ductedUnit,capacity:null}]}],
    ['loadedCatalogs',{...catalogs,ducted:[{...ductedUnit,sensibleCapacity:'12000'}]}],
    ['loadedCatalogs',{...catalogs,ducted:[{...ductedUnit,cfm:'700'}]}],
    ['loadedCatalogs',{...catalogs,ducted:[{...ductedUnit,cfm:-1}]}],
    ['loadedCatalogs',{...catalogs,ducted:[{...ductedUnit,model:{}}]}],
  ])('rejects malformed %s atomically (%j)',(key,value)=>{
    const doc=JSON.parse(serializeProject(state()));
    const source=JSON.stringify({...doc,[key]:value});
    expect(()=>parseProjectDocument(source)).toThrow(/annotation|weight|cad|catalog/i);
    const before=useProjectStore.getState();
    expect(before.restoreProjectDocument(source).success).toBe(false);
    expect(useProjectStore.getState()).toBe(before);
  });
  it.each(['unitPositions','outdoorUnitPositions'])('rejects malformed %s before atomic restore',key=>{
    const doc=JSON.parse(serializeProject(state()));
    for(const positions of [{x:0,y:0},[null],[{x:'1',y:2}],[{x:1}]]) {
      const source=JSON.stringify({...doc,zones:[{...zone,[key]:positions}]});
      expect(()=>parseProjectDocument(source)).toThrow(/unitPositions|outdoorUnitPositions/i);
      const before=useProjectStore.getState();
      expect(before.restoreProjectDocument(source).success).toBe(false);
      expect(useProjectStore.getState()).toBe(before);
    }
  });
  it('rejects malformed optional live state before writing a document',()=>{
    const malformed={...optionalState(),optimizationWeights:{...DEFAULT_OPTIMIZATION_WEIGHTS,wCost:'1'}};
    expect(()=>serializeProject(malformed as unknown as Parameters<typeof serializeProject>[0])).toThrow(/weight/i);
  });
});

describe('versioned engineering project documents',()=>{
  it('round trips native curves, units, layer visibility, locks and thermal inputs',()=>{
    const restored=parseProjectDocument(serializeProject(state()));
    expect(restored.project).toEqual(project);
    expect(restored.zones[0].isDuctLocked).toBe(true);
    expect(restored.dxfEntities).toEqual(native);
    expect(restored.dxfLayers.ROOM.visible).toBe(false);
  });
  it('does not trust persisted eligibility or engineering status',()=>{
    const s=state();s.zones=[{...zone,engineeringStatus:'preliminary',engineeringError:'old'}];
    const restored=parseProjectDocument(serializeProject(s));
    expect(restored.zones[0].engineeringStatus).toBe('stale');
    expect(restored.zones[0].engineeringError).toBeUndefined();
  });
  it('retains editable invalid overrides as blocked rather than inventing valid loads',()=>{
    const s=state();s.zones=[{...zone,manualCfmOverride:1}];
    const restored=parseProjectDocument(serializeProject(s));
    expect(restored.zones[0].manualCfmOverride).toBe(1);
    expect(restored.zones[0].engineeringStatus).toBe('blocked');
    expect(restored.zones[0].engineeringError).toMatch(/airflow/i);
  });
  it('rejects nonfinite state before JSON can silently replace it with null',()=>{
    expect(()=>serializeProject({...state(),project:{...project,scale:NaN}})).toThrow(/finite/i);
  });
  it('rejects unknown versions, duplicate IDs, corrupt geometry and unsupported units',()=>{
    const doc=JSON.parse(serializeProject(state()));
    expect(()=>parseProjectDocument(JSON.stringify({...doc,version:999}))).toThrow(/version/i);
    expect(()=>parseProjectDocument(JSON.stringify({...doc,zones:[zone,zone]}))).toThrow(/duplicate/i);
    expect(()=>parseProjectDocument(JSON.stringify({...doc,zones:[{...zone,points:[0,0,1]}]}))).toThrow(/polygon|coordinate/i);
    expect(()=>parseProjectDocument(JSON.stringify({...doc,project:{...project,units:'pixels'}}))).toThrow(/unit/i);
  });
  it('fails malformed and prototype-key documents without producing project state',()=>{
    expect(()=>parseProjectDocument('{')).toThrow(/JSON/i);
    expect(()=>parseProjectDocument('{"format":"mep-hvac-project","version":1,"__proto__":{"polluted":true}}')).toThrow(/unsafe|key/i);
    expect(({} as Record<string,unknown>).polluted).toBeUndefined();
  });
  it('is deterministic and independent of later changes to the input or restored document',()=>{
    const s=structuredClone(state());const text=serializeProject(s);const loaded=parseProjectDocument(text);
    expect(serializeProject(loaded)).toBe(text);
    loaded.dxfEntities[0].points![0]=999;
    expect(s.dxfEntities[0].points![0]).toBe(0);
  });
});

it('switches project display units without changing physical rooms or manual design demand',()=>{
  useProjectStore.setState({...state(),zones:[{...zone,manualCoolingOverride:18000,manualCfmOverride:700}]});
  const before=calculateCanonicalZoneLoad(useProjectStore.getState().zones[0],useProjectStore.getState().project);
  useProjectStore.getState().setProject({units:'metric'});
  const metric=useProjectStore.getState();
  const after=calculateCanonicalZoneLoad(metric.zones[0],metric.project);
  expect(metric.project.scale).toBeCloseTo(10/0.3048,10);
  expect(metric.zones[0].ceilingHeight).toBeCloseTo(3.048,10);
  expect(after.area).toBeCloseTo(before.area,10);
  expect(after.totalLoad).toBeCloseTo(before.totalLoad,8);
  expect(after.supplyCfm).toBeCloseTo(before.supplyCfm,8);
  useProjectStore.getState().setProject({units:'imperial'});
  const back=useProjectStore.getState();
  expect(back.project.scale).toBeCloseTo(10,10);
  expect(back.zones[0].manualCoolingOverride).toBeCloseTo(18000,8);
});

it('restores an entire validated project atomically and leaves state unchanged on corrupt data',()=>{
  useProjectStore.setState({...state(),selectedZoneId:'z1'});
  const text=serializeProject({...state(),project:{...project,name:'Opened project'}});
  const restored=useProjectStore.getState().restoreProjectDocument(text);
  expect(restored.success).toBe(true);
  expect(useProjectStore.getState().project.name).toBe('Opened project');
  expect(useProjectStore.getState().zones[0].engineeringStatus).toBe('stale');
  expect(useProjectStore.getState().activePreview).toBeNull();
  const before=useProjectStore.getState();
  expect(useProjectStore.getState().restoreProjectDocument('{').success).toBe(false);
  expect(useProjectStore.getState()).toBe(before);
});

it('requires estimated CAD units to be confirmed before engineering calculations',()=>{
  useProjectStore.setState({...state(),zones:[zone]});
  useProjectStore.getState().setDxfData(native,state().dxfBoundingBox,10,'ft',{
    sourceName:'units-missing.dxf',unitsConfidence:'estimated',diagnostics:[]});
  expect(()=>calculateCanonicalZoneLoad(useProjectStore.getState().zones[0],useProjectStore.getState().project)).toThrow(/confirm.*unit|unit.*confirm/i);
  useProjectStore.getState().setProject({cadUnitsConfirmed:true});
  expect(calculateCanonicalZoneLoad(useProjectStore.getState().zones[0],useProjectStore.getState().project).area).toBe(300);
  expect(useProjectStore.getState().cadImport?.sourceName).toBe('units-missing.dxf');
});
it('builds prototype-safe derived CAD layer maps',()=>{
 const doc=JSON.parse(serializeProject(state()));doc.dxfLayers={};doc.dxfEntities[0].layer='__proto__';
 try {const restored=parseProjectDocument(JSON.stringify(doc));expect(Object.hasOwn(restored.dxfLayers,'__proto__')).toBe(true);expect((Object.prototype as {count?:unknown}).count).toBeUndefined();}
 finally {delete (Object.prototype as {count?:unknown}).count;}
});
it('blocks estimated CAD units when old confirmation metadata was omitted',()=>{
 const doc=JSON.parse(serializeProject(state()));doc.cadImport={unitsConfidence:'estimated',diagnostics:[]};delete doc.project.cadUnitsConfirmed;
 const restored=parseProjectDocument(JSON.stringify(doc));expect(restored.project.cadUnitsConfirmed).toBe(false);expect(restored.zones[0].engineeringStatus).toBe('blocked');
});
it('rejects malformed lock flags and source approval provenance',()=>{
 const doc=JSON.parse(serializeProject(state()));doc.zones[0].isDuctLocked='false';expect(()=>parseProjectDocument(JSON.stringify(doc))).toThrow(/lock|boolean/i);
 doc.zones[0].isDuctLocked=false;doc.zones[0].cadProvenance={candidateId:'fake',sourceHandles:17,drawingUnitsPerFoot:-1};expect(()=>parseProjectDocument(JSON.stringify(doc))).toThrow(/provenance|source|array/i);
});
it('rejects overflowed CAD extents before JSON turns Infinity into null',()=>{
 expect(()=>serializeProject({...state(),zones:[],dxfEntities:[{type:'CIRCLE',x:1e308,y:0,radius:1e308}]})).toThrow(/finite|bounds|extent/i);
});
