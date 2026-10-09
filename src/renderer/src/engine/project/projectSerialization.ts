import type { ProjectMetadata, Zone, DxfEntity, BoundingBox, DxfLayerInfo, AnnotationVisibility, CadImportMetadata } from '../../store/projectStore';
import type { OptimizationWeights } from '../types';
import { measureSimplePolygon, requireNonnegative, requirePositive } from '../engineeringInputs';
import { calculateZoneLoadSafely } from '../loadCalc';
import { validateCadEntity, getCadEntityBounds } from '../cad/nativeGeometry';
import {resolveStandardsSelection} from '../standards/profileRegistry';
import {unitsAutoConfirmed} from '../cad/unitsDecision';
import {CAD_LAYER_ROLES} from '../cad/layerClassification';
import type {CadLayerOverrides,CadLayerRole} from '../cad/semanticTypes';
import type {StoredCadOpening,StoredCadObstacle} from '../cad/cadSemanticState';

export interface PersistedProjectState {
  project: ProjectMetadata;
  zones: Zone[];
  dxfEntities: DxfEntity[];
  dxfBoundingBox: BoundingBox | null;
  dxfLayers: Record<string, DxfLayerInfo>;
  /** Origin of the local coordinates (raw = local + drawingOrigin, internal Y-down frame). Absent means {0,0}; stored only when non-zero (version 3). */
  drawingOrigin?: {x:number;y:number};
  cadImport?:CadImportMetadata|null;
  /** User layer-role decisions (machine suggestions are recomputed from the entities). */
  cadLayerOverrides?:CadLayerOverrides;
  cadOpenings?:StoredCadOpening[];
  cadObstacles?:StoredCadObstacle[];
  cadLevel?:number;
  annotationVisibility?: AnnotationVisibility;
  selectedSystemTypes?: string[];
  optimizationWeights?: OptimizationWeights;
  loadedCatalogs?: {
    decorative: {highWall: unknown[];cassette: unknown[]} | null;
    ducted: unknown[] | null;
    errors?: string[];
  } | null;
}

const FORMAT='mep-hvac-project';
// Version 2 adds CAD review decisions (layer roles, openings, obstacles, level). Version 1 documents
// load unchanged with those fields absent; the store then re-derives suggestions from the entities.
// Version 3 adds the top-level drawingOrigin (far-from-origin drawings, see engine/cad/drawingOrigin.ts). It is written only
// when non-zero: a document with origin {0,0} stays version 2, so every file saved for a near drawing is unchanged.
// Versions 1 and 2 are read as origin {0,0} and may not carry drawingOrigin. A v1/v2 project that was saved with
// far-from-origin raw coordinates is NOT localised at load (entity ids embed coordinates); re-importing the drawing rebases it.
const VERSION=2;
const ORIGIN_VERSION=3;
const SUPPORTED_VERSIONS=[1,2,3];
const MAX_DOCUMENT_LENGTH=50_000_000;

function assertDataTree(value: unknown, path='document', depth=0, seen=new Set<object>(), budget={nodes:0}): void {
  if (++budget.nodes>2_000_000 || depth>64) throw new RangeError('Project document exceeds structural limits');
  if (value===undefined) return;
  if (typeof value==='number' && !Number.isFinite(value)) throw new RangeError(`${path} must be finite`);
  if (value===null || ['string','number','boolean'].includes(typeof value)) return;
  if (typeof value!=='object') throw new TypeError(`${path} must contain only project data`);
  if (seen.has(value)) throw new TypeError('Project data contains a cycle');
  if (!Array.isArray(value) && Object.getPrototypeOf(value)!==Object.prototype && Object.getPrototypeOf(value)!==null)
    throw new TypeError(`${path} is not a plain data object`);
  seen.add(value);
  for (const [key,child] of Object.entries(value)) {
    if (path!=='document.dxfLayers' && path!=='document.cadLayerOverrides' && ['__proto__','constructor','prototype'].includes(key)) throw new TypeError(`Unsafe project key: ${key}`);
    assertDataTree(child,`${path}.${key}`,depth+1,seen,budget);
  }
  seen.delete(value);
}

function object(value:unknown,name:string):Record<string,unknown> {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value as Record<string,unknown>;
}
function array(value:unknown,name:string):unknown[] {
  if(!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}
function text(value:unknown,name:string):string {
  if(typeof value!=='string') throw new TypeError(`${name} must be text`);
  return value;
}
function finite(value:unknown,name:string):number {
  if(typeof value!=='number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}
function coordinates(value:unknown,name:string, minimum=2):number[] {
  const values=array(value,name);
  if(values.length<minimum || values.length%2!==0) throw new TypeError(`${name} must contain complete coordinate pairs`);
  return values.map((v,i)=>finite(v,`${name}[${i}]`));
}

function position(value:unknown,name:string):void {
  const point=object(value,name);
  finite(point.x,`${name} X`);finite(point.y,`${name} Y`);
}

function validateAnnotationVisibility(value:unknown):AnnotationVisibility {
  const visibility=object(value,'Annotation visibility');
  const keys: (keyof AnnotationVisibility)[] = ['grid','diffusers','diffuserCfm','diffuserTags','throwRings','ducts','ductCfm','ductSizeBadges','ductCenterlines','indoorUnits','outdoorUnits','refrigerantPiping','leaderCallout','zoneLabels','dxfText'];
  for(const key of keys) if(typeof visibility[key]!=='boolean') throw new TypeError(`Annotation visibility ${key} must be boolean`);
  return visibility as unknown as AnnotationVisibility;
}

function validateOptimizationWeights(value:unknown):OptimizationWeights {
  const weights=object(value,'Optimization weights');
  const keys: (keyof OptimizationWeights)[] = ['wComfort','wEnergy','wCost','wNoise','wPressure','wSpace','wPreference'];
  for(const key of keys) finite(weights[key],`Optimization weight ${key}`);
  return weights as unknown as OptimizationWeights;
}

function validateCadImport(value:unknown):CadImportMetadata|null {
  if(value===null) return null;
  const metadata=object(value,'CAD import metadata');
  if(metadata.sourceName!==undefined) text(metadata.sourceName,'CAD source name');
  if(!['declared','estimated','unknown'].includes(text(metadata.unitsConfidence,'CAD units confidence')))
    throw new TypeError('Unsupported CAD units confidence');
  for(const value of array(metadata.diagnostics,'CAD diagnostics')) {
    const diagnostic=object(value,'CAD diagnostic');
    text(diagnostic.code,'CAD diagnostic code');text(diagnostic.message,'CAD diagnostic message');
    if(diagnostic.severity!=='warning' && diagnostic.severity!=='error') throw new TypeError('Unsupported CAD diagnostic severity');
    for(const key of ['entityType','handle']) if(diagnostic[key]!==undefined) text(diagnostic[key],`CAD diagnostic ${key}`);
  }
  return metadata as unknown as CadImportMetadata;
}

const REVIEW_STATUSES=['review-required','approved','rejected'];
function point2(value:unknown,name:string):void {
  const p=object(value,name);finite(p.x,`${name} x`);finite(p.y,`${name} y`);
}
function stringList(value:unknown,name:string):void {array(value,name).forEach(v=>text(v,name));}
function validateReviewCommon(o:Record<string,unknown>,name:string):void {
  text(o.id,`${name} ID`);
  if(!REVIEW_STATUSES.includes(o.status as string)) throw new TypeError(`${name} status is unsupported`);
  finite(o.level,`${name} level`);finite(o.confidence,`${name} confidence`);
  stringList(o.evidence,`${name} evidence`);stringList(o.sourceHandles,`${name} source handles`);
  if(o.approvedAt!==undefined) text(o.approvedAt,`${name} approval date`);
}
function validateCadOpenings(value:unknown):StoredCadOpening[] {
  return array(value,'CAD openings').map((v,i)=>{
    const o=object(v,`CAD opening ${i}`);validateReviewCommon(o,'CAD opening');
    if(!['door','window','opening'].includes(o.kind as string)) throw new TypeError('CAD opening kind is unsupported');
    if(!['block','arc-in-gap','wall-gap','parallel-lines'].includes(o.origin as string)) throw new TypeError('CAD opening origin is unsupported');
    point2(o.center,'CAD opening center');const span=object(o.span,'CAD opening span');point2(span.a,'CAD opening span a');point2(span.b,'CAD opening span b');
    requireNonnegative('CAD opening width',finite(o.widthFt,'CAD opening width'));
    stringList(o.adjacentRoomIds,'CAD opening rooms');
    return o as unknown as StoredCadOpening;
  });
}
function validateCadObstacles(value:unknown):StoredCadObstacle[] {
  return array(value,'CAD obstacles').map((v,i)=>{
    const o=object(v,`CAD obstacle ${i}`);validateReviewCommon(o,'CAD obstacle');
    if(o.shape!=='polygon' && o.shape!=='circle') throw new TypeError('CAD obstacle shape is unsupported');
    coordinates(o.polygon,'CAD obstacle polygon',6);text(o.layer,'CAD obstacle layer');
    finite(o.widthFt,'CAD obstacle width');finite(o.depthFt,'CAD obstacle depth');
    if(o.circle!==undefined){const c=object(o.circle,'CAD obstacle circle');point2(c,'CAD obstacle circle');requirePositive('CAD obstacle radius',finite(c.radius,'CAD obstacle radius'));}
    if(o.clearanceFt!==undefined) requireNonnegative('CAD obstacle clearance',finite(o.clearanceFt,'CAD obstacle clearance'));
    if(o.status==='approved' && o.clearanceFt===undefined) throw new TypeError('An approved CAD obstacle needs a clearance');
    return o as unknown as StoredCadObstacle;
  });
}
function validateLayerOverrides(value:unknown):CadLayerOverrides {
  const raw=object(value,'CAD layer roles');
  const result:CadLayerOverrides=Object.create(null);
  for(const [layer,role] of Object.entries(raw)) {
    if(typeof role!=='string' || !(CAD_LAYER_ROLES as readonly string[]).includes(role)) throw new TypeError(`Unsupported CAD layer role for ${layer}`);
    result[layer]=role as CadLayerRole;
  }
  return result;
}

function validateLoadedCatalogs(value:unknown):PersistedProjectState['loadedCatalogs'] {
  if(value===null) return null;
  const catalogs=object(value,'Loaded catalogs');
  // loadedCatalogs holds the DecorativeUnit/DuctedUnit Excel IPC records from
  // main/index.ts, rather than the canonical engine EquipmentCatalogItem schema.
  function validateUnits(values:unknown,ducted:boolean,name:string):void {
    for(const value of array(values,name)) {
      const unit=object(value,`${name} unit`);
      for(const key of ['spaceName','model','source',...(ducted?['enteringDbWb','esp']:['unitType'])])
        text(unit[key],`${name} ${key}`);
      requirePositive(`${name} capacity`,finite(unit.capacity,`${name} capacity`));
      // Excel imports legitimately supply zero for missing flow/HAP/sensible data.
      for(const key of ['cfm','hapCfm',...(ducted?['sensibleCapacity','hapTotal','hapSensible']:['hapLoad'])])
        requireNonnegative(`${name} ${key}`,finite(unit[key],`${name} ${key}`));
      finite(unit.rowNumber,`${name} row number`);
      if(ducted) finite(unit.qty,`${name} quantity`);
    }
  }
  if(catalogs.decorative!==null) {
    const decorative=object(catalogs.decorative,'Decorative catalog');
    validateUnits(decorative.highWall,false,'High wall catalog');
    validateUnits(decorative.cassette,false,'Cassette catalog');
  }
  if(catalogs.ducted!==null) validateUnits(catalogs.ducted,true,'Ducted catalog');
  if(catalogs.errors!==undefined) for(const error of array(catalogs.errors,'Catalog errors')) text(error,'Catalog error');
  return catalogs as unknown as PersistedProjectState['loadedCatalogs'];
}

function validateDrawingOrigin(value:unknown,version:number):{x:number;y:number}|undefined {
  if(value===undefined) return undefined;
  if(version<ORIGIN_VERSION) throw new TypeError('drawingOrigin requires project version 3');
  const o=object(value,'Drawing origin');
  return {x:finite(o.x,'Drawing origin X'),y:finite(o.y,'Drawing origin Y')};
}

function validateState(value:unknown,version:number=VERSION):PersistedProjectState {
  // Version 1 predates CAD review decisions: nothing in such a file (unit confirmation of an unconfirmable import,
  // approved openings/obstacles, level, zone obstacles) can have been a recorded user decision, so none is trusted.
  const legacy=version<2;
  const data=object(value,'Project');
  const project={...object(data.project,'Project metadata')} as unknown as ProjectMetadata;
  const cadImport=data.cadImport===undefined?undefined:validateCadImport(data.cadImport);
  if(cadImport && !unitsAutoConfirmed(cadImport) && (legacy || project.cadUnitsConfirmed!==true))project.cadUnitsConfirmed=false;
  text(project.name,'Project name');text(project.location,'Project location');
  if(project.standardsSelection!==undefined)resolveStandardsSelection(project.standardsSelection);
  if(project.units!=='imperial' && project.units!=='metric') throw new TypeError('Unsupported project unit system');
  requirePositive('Drawing scale',finite(project.scale,'Drawing scale'));
  finite(project.outdoorDb,'Outdoor temperature');finite(project.indoorDb,'Indoor temperature');
  if(project.cadUnit!==undefined && !['mm','cm','m','in','ft','custom'].includes(project.cadUnit)) throw new TypeError('Unsupported CAD units');
  if(project.cadScaleProvenance!==undefined && project.cadScaleProvenance!=='user-calibrated') throw new TypeError('Unsupported CAD scale provenance');
  if(project.cadUnitsConfirmed!==undefined && typeof project.cadUnitsConfirmed!=='boolean') throw new TypeError('CAD unit confirmation must be boolean');
  const ids=new Set<string>();
  const zones=array(data.zones,'Zones').map((value,index)=>{
    const z=object(value,`Zone ${index}`) as unknown as Zone;
    if(!text(z.id,'Zone ID').trim() || ids.has(z.id)) throw new TypeError('Missing or duplicate zone ID');
    ids.add(z.id);text(z.name,'Zone name');text(z.spaceTypeId,'Space type');
    for(const flag of ['isEquipmentLocked','isDuctLocked','isDiffusersLocked','enhancedAcousticPerformance'] as const)
      if(z[flag]!==undefined && typeof z[flag]!=='boolean')throw new TypeError(`${flag} must be boolean`);
    if(z.cadProvenance!==undefined) {
      const p=object(z.cadProvenance,'CAD provenance');text(p.candidateId,'CAD candidate ID');
      if(p.sourceCadRevision!==undefined)text(p.sourceCadRevision,'CAD source revision');
      for(const key of ['sourceHandles','sourceLayers','evidence','unresolvedConditions'])array(p[key],`CAD provenance ${key}`).forEach(v=>text(v,`CAD provenance ${key}`));
      requirePositive('CAD provenance drawing scale',finite(p.drawingUnitsPerFoot,'CAD provenance drawing scale'));
      text(p.approvedAt,'CAD approval date');
      if(p.level!==undefined)finite(p.level,'CAD provenance level');
      for(const key of ['approvedOpeningIds','boundaryLayers'])if(p[key]!==undefined)array(p[key],`CAD provenance ${key}`).forEach(v=>text(v,`CAD provenance ${key}`));
      if(p.userModified!==undefined){const m=object(p.userModified,'CAD provenance userModified');text(m.at,'CAD userModified date');array(m.edits,'CAD userModified edits').forEach(v=>text(v,'CAD userModified edit'));}
      if(p.ceilingHeight!==undefined){
        const c=object(p.ceilingHeight,'CAD provenance ceiling height');
        finite(c.chosen,'CAD provenance chosen ceiling height');
        if(typeof c.usedSuggestion!=='boolean')throw new TypeError('CAD provenance usedSuggestion must be boolean');
        for(const key of ['suggestedFt','confidence'])if(c[key]!==undefined)finite(c[key],`CAD provenance ${key}`);
        if(c.evidence!==undefined)array(c.evidence,'CAD provenance ceiling evidence').forEach(v=>text(v,'CAD provenance ceiling evidence'));
      }
    }
    measureSimplePolygon(coordinates(z.points,'Zone polygon',6));
    if(z.drawnOnLevel!==undefined)finite(z.drawnOnLevel,'Drawn-on level');
    finite(z.ceilingHeight,'Ceiling height');finite(z.occupants,'Occupants');
    for(const key of ['manualCfmOverride','manualCoolingOverride','lightingOverride','equipmentOverride'] as const)
      if(z[key]!==undefined) finite(z[key],key);
    const componentIds=new Set<string>();
    for(const terminal of array(z.diffusers,'Terminals')) {
      const t=object(terminal,'Terminal');const id=text(t.id,'Terminal ID');
      if(componentIds.has(id)) throw new TypeError('Duplicate component ID');componentIds.add(id);
      finite(t.x,'Terminal X');finite(t.y,'Terminal Y');finite(t.cfm,'Terminal flow');text(t.size,'Terminal size');
    }
    for(const segment of array(z.ducts,'Ducts')) {
      const d=object(segment,'Duct');const id=text(d.id,'Duct ID');
      if(componentIds.has(id)) throw new TypeError('Duplicate component ID');componentIds.add(id);
      coordinates(d.points,'Duct coordinates',4);finite(d.widthIn,'Duct width');finite(d.heightIn,'Duct height');finite(d.cfm,'Duct flow');
    }
    if(legacy) delete (z as Partial<Zone>).obstacles;
    else if(z.obstacles!==undefined)
      for(const o of array(z.obstacles,'Zone obstacles')) {
        const ob=object(o,'Zone obstacle');text(ob.id,'Zone obstacle ID');
        if(ob.status!=='approved') throw new TypeError('Zone obstacles must be approved obstacles');
        requireNonnegative('Zone obstacle clearance',finite(ob.clearanceFt,'Zone obstacle clearance'));
        if(ob.polygon!==undefined)coordinates(ob.polygon,'Zone obstacle polygon',6);
        if(ob.circle!==undefined){const c=object(ob.circle,'Zone obstacle circle');point2(c,'Zone obstacle circle');requirePositive('Zone obstacle radius',finite(c.radius,'Zone obstacle radius'));}
        if(ob.polygon===undefined && ob.circle===undefined) throw new TypeError('Zone obstacle has no geometry');
      }
    for(const key of ['unitPos','outdoorUnitPos'] as const) if(z[key]!==undefined) position(z[key],key);
    for(const key of ['unitPositions','outdoorUnitPositions'] as const) if(z[key]!==undefined)
      for(const point of array(z[key],key)) position(point,key);
    const evaluation=calculateZoneLoadSafely(z,project);
    return {...z,engineeringStatus:evaluation.error?'blocked' as const:'stale' as const,engineeringError:evaluation.error};
  });
  const dxfEntities=array(data.dxfEntities,'CAD entities').map((value,index)=>{
    const entity=object(value,`CAD entity ${index}`) as unknown as DxfEntity;
    const error=validateCadEntity(entity);
    if(error) throw new TypeError(`CAD entity ${index}: ${error}`);
    if(entity.elevation!==undefined) finite(entity.elevation,`CAD entity ${index} elevation`);
    return entity;
  });
  const rawLayers=object(data.dxfLayers??{},'CAD layers');
  const dxfLayers:Record<string,DxfLayerInfo>=Object.create(null);
  for(const [name,value] of Object.entries(rawLayers)) {
    const layer=object(value,'CAD layer');
    if(typeof layer.visible!=='boolean') throw new TypeError('CAD layer visibility must be boolean');
    dxfLayers[name]={name,visible:layer.visible,count:0,color:layer.color===undefined?undefined:text(layer.color,'CAD layer color'),...(layer.sourceHidden===true?{sourceHidden:true}:{})};
  }
  // Counts and extents come from actual entities, not claims stored in a document.
  let bbox:BoundingBox|null=null;
  for(const entity of dxfEntities) {
    const name=entity.layer??'0';
    if(!dxfLayers[name]) dxfLayers[name]={name,visible:true,count:0,color:entity.color};
    dxfLayers[name].count++;
    const b=getCadEntityBounds(entity);
    for(const [key,value] of Object.entries(b))finite(value,`CAD bounds ${key}`);
    bbox=bbox?{minX:Math.min(bbox.minX,b.minX),maxX:Math.max(bbox.maxX,b.maxX),minY:Math.min(bbox.minY,b.minY),maxY:Math.max(bbox.maxY,b.maxY)}:b;
  }
  const drawingOrigin=validateDrawingOrigin(data.drawingOrigin,version);
  return {project,zones,dxfEntities,dxfBoundingBox:bbox,dxfLayers,
    ...(drawingOrigin!==undefined&&(drawingOrigin.x!==0||drawingOrigin.y!==0)?{drawingOrigin}:{}),
    ...(cadImport!==undefined?{cadImport}:{}),
    ...(data.cadLayerOverrides!==undefined?{cadLayerOverrides:validateLayerOverrides(data.cadLayerOverrides)}:{}),
    ...(!legacy&&data.cadOpenings!==undefined?{cadOpenings:validateCadOpenings(data.cadOpenings)}:{}),
    ...(!legacy&&data.cadObstacles!==undefined?{cadObstacles:validateCadObstacles(data.cadObstacles)}:{}),
    ...(!legacy&&data.cadLevel!==undefined?{cadLevel:finite(data.cadLevel,'CAD level')}:{}),
    ...(data.annotationVisibility!==undefined?{annotationVisibility:validateAnnotationVisibility(data.annotationVisibility)}:{}),
    ...(data.selectedSystemTypes!==undefined?{selectedSystemTypes:array(data.selectedSystemTypes,'System types').map(v=>text(v,'System type'))}:{}),
    ...(data.optimizationWeights!==undefined?{optimizationWeights:validateOptimizationWeights(data.optimizationWeights)}:{}),
    ...(data.loadedCatalogs!==undefined?{loadedCatalogs:validateLoadedCatalogs(data.loadedCatalogs)}: {})};
}

export function serializeProject(state:PersistedProjectState):string {
  // Pick declarative fields before inspecting; live Zustand actions are not document data.
  const farOrigin=!!state.drawingOrigin&&(state.drawingOrigin.x!==0||state.drawingOrigin.y!==0);
  const data={project:state.project,zones:state.zones,dxfEntities:state.dxfEntities,dxfBoundingBox:state.dxfBoundingBox,dxfLayers:state.dxfLayers,
    ...(farOrigin?{drawingOrigin:state.drawingOrigin}:{}),
    ...(state.cadImport!==undefined?{cadImport:state.cadImport}:{}),
    ...(state.cadLayerOverrides!==undefined?{cadLayerOverrides:state.cadLayerOverrides}:{}),
    ...(state.cadOpenings!==undefined?{cadOpenings:state.cadOpenings}:{}),
    ...(state.cadObstacles!==undefined?{cadObstacles:state.cadObstacles}:{}),
    ...(state.cadLevel!==undefined?{cadLevel:state.cadLevel}:{}),
    ...(state.annotationVisibility!==undefined?{annotationVisibility:state.annotationVisibility}:{}),
    ...(state.selectedSystemTypes!==undefined?{selectedSystemTypes:state.selectedSystemTypes}:{}),
    ...(state.optimizationWeights!==undefined?{optimizationWeights:state.optimizationWeights}:{}),
    ...(state.loadedCatalogs!==undefined?{loadedCatalogs:state.loadedCatalogs}: {})};
  assertDataTree(data);
  const version=farOrigin?ORIGIN_VERSION:VERSION;
  const valid=validateState(data,version);
  const result=JSON.stringify({format:FORMAT,version,...valid},null,2);
  if(result.length>MAX_DOCUMENT_LENGTH) throw new RangeError('Project document exceeds size limit');
  return result;
}

export function parseProjectDocument(source:string):PersistedProjectState {
  if(source.length>MAX_DOCUMENT_LENGTH) throw new RangeError('Project document exceeds size limit');
  let value:unknown;
  try {value=JSON.parse(source);} catch {throw new SyntaxError('Invalid project JSON');}
  assertDataTree(value);
  const document=object(value,'Document');
  if(document.format!==FORMAT) throw new TypeError('Unrecognized project document format');
  if(!SUPPORTED_VERSIONS.includes(document.version as number)) throw new TypeError(`Unsupported project version ${String(document.version)}`);
  return validateState(document,document.version as number);
}
