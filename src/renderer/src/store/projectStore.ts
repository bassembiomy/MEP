import { create } from 'zustand';
import { calculateCanonicalZoneLoad, calculateZoneLoadSafely } from '../engine/loadCalc';
import { generateSystemCandidates, DEFAULT_OPTIMIZATION_WEIGHTS } from '../engine/systemDesigner';
import { zoneExtentFt } from '../engine/pressureBudget';
import { convertProjectDisplayUnits } from '../engine/project/unitConversion';
import { parseProjectDocument } from '../engine/project/projectSerialization';
import type { CadImportDiagnostic } from '../engine/dxfParser';
import type { CadRoomCandidate, CadLayerRole, CadBlockReference, CadRoomRecognitionResult, CadApprovedObstacle } from '../engine/cad/semanticTypes';
import { recognizeCadRooms } from '../engine/cad/roomRecognition';
import { buildRoomRecognitionBasis, ceilingHeightSuggestionFor, drawingUnitsPerFoot, type CeilingHeightSuggestionView } from '../engine/cad/roomApprovalInputs';
import { unitsAutoConfirmed } from '../engine/cad/unitsDecision';
import { calibrateDrawingScale, type CadKnownUnit } from '../engine/dxfParser';
import { CAD_LAYER_ROLES } from '../engine/cad/layerClassification';
import {
  EMPTY_LAYER_ROLES,
  zoneObstaclesFor,
  recognizeCadSemantics,
  type CadLayerRoleState,
  type CadSemanticSnapshot,
  type StoredCadObstacle,
  type StoredCadOpening
} from '../engine/cad/cadSemanticState';
import { validateZonePolygon } from '../engine/cad/zonePolygon';
import type { DeploymentManifest } from '../engine/deploymentTypes';
import { verifyEditedZone } from '../engine/cad/componentEdits';
import { moveVertex, insertVertex, deleteVertex, offsetEdge, type PolygonEdit } from '../engine/cad/zoneGeometryEdits';
import { measureSimplePolygon, requirePositive, requireNonnegative, METERS_PER_FOOT } from '../engine/engineeringInputs';
import { ASHRAE_SPACE_TYPES } from '../engine/knowledgeBase';
import type { StandardsSelection } from '../engine/standards/profileRegistry';
import {
  OptimizationWeights,
  SystemDesignCandidate,
  DuctLocationCategory,
  AcousticSensitivity,
  DuctSectionCategory,
  DuctAcousticVerification
} from '../engine/types';
import {
  DeploymentPreview,
  WorkspaceSnapshot
} from '../engine/deploymentTypes';
import {
  buildDeploymentManifest,
  executeDeploymentTransaction,
  getZoneDeploymentRevision,
  getProjectDeploymentRevision
} from '../engine/deploymentManager';

export interface Diffuser {
  id: string;
  x: number;
  y: number;
  cfm: number;
  size: string;
  type?: 'supply' | 'return' | 'exhaust' | 'cassette' | 'high-wall';
  actualNc?: number;
  throwT50Ft?: number;
  deltaPInWg?: number;
}

export interface DuctSegment {
  id: string;
  type: 'trunk' | 'branch' | 'return';
  points: number[];
  widthIn: number;
  heightIn: number;
  cfm: number;
  sizeLabel: string;
  velocityFpm?: number;
  shape?: 'rectangular' | 'round' | 'oval' | 'flex';
  diameterIn?: number;
  areaSqFt?: number;
  sectionCategory?: DuctSectionCategory;
  acousticVerification?: DuctAcousticVerification;
}

export interface DxfEntity {
  type: 'LINE' | 'LWPOLYLINE' | 'POLYLINE' | 'CIRCLE' | 'ARC' | 'ELLIPSE' | 'TEXT' | 'MTEXT';
  handle?: string;
  sourceHandle?: string;
  sourceBlock?: string;
  closed?: boolean;
  bulges?: number[];
  startAngleDeg?: number;
  endAngleDeg?: number;
  majorAxis?: { x: number; y: number };
  minorAxis?: { x: number; y: number };
  startParam?: number;
  endParam?: number;
  textHeight?: number;
  rotationDeg?: number;
  geometryApproximation?: string;
  points?: number[];
  x?: number;
  y?: number;
  radius?: number;
  text?: string;
  color?: string;
  layer?: string;
  /** Constant Z (drawing units) kept by the CAD parsers for planar geometry; absent means level 0. */
  elevation?: number;
}

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface Zone {
  cadProvenance?: {sourceCadRevision?:string;candidateId:string;sourceHandles:string[];sourceLayers:string[];evidence:string[];unresolvedConditions:string[];drawingUnitsPerFoot:number;approvedAt:string;
    /** Level (elevation, drawing units) and approved openings the room was recognised with. */
    level?:number;approvedOpeningIds?:string[];boundaryLayers?:string[];
    /** Set once the user edits the approved outline; the geometry no longer equals the recognised CAD candidate. */
    userModified?:{at:string;edits:string[]};
    /** The ceiling height the user chose, next to the annotation-derived suggestion that was shown (never applied automatically). */
    ceilingHeight?:{chosen:number;usedSuggestion:boolean;suggestedFt?:number;confidence?:number;evidence?:string[]}};
  id: string;
  engineeringStatus?: 'stale' | 'blocked' | 'preliminary';
  engineeringError?: string;
  /** Non-blocking note, e.g. which higher-ranked candidates auto-deploy skipped. */
  engineeringNotice?: string;
  name: string;
  points: number[];
  spaceTypeId: string;
  ceilingHeight: number;
  occupants: number;
  /** Approved CAD obstacles (with clearance) inside this zone; derived by the store, checked when deploying. */
  obstacles?: CadApprovedObstacle[];
  lightingOverride?: number;
  equipmentOverride?: number;
  manualCfmOverride?: number;
  manualCoolingOverride?: number;
  systemType?: 'high-wall' | 'cassette' | 'concealed' | 'packaged' | 'vrf' | 'ahu' | 'fcu';
  ductTypeId?: string;
  diffuserTypeId?: string;
  maxVelocityLimitFpm?: number;
  maxAvailableCeilingDepthIn?: number;
  maxDuctAspectRatio?: number;
  maxSpaceNcLimit?: number;
  ductLocationCategory?: DuctLocationCategory;
  targetNc?: number;
  acousticSensitivity?: AcousticSensitivity;
  enhancedAcousticPerformance?: boolean;
  isEquipmentLocked?: boolean;
  isDuctLocked?: boolean;
  isDiffusersLocked?: boolean;
  diffusers: Diffuser[];
  ducts: DuctSegment[];
  unitPos?: { x: number; y: number };
  unitPositions?: { x: number; y: number }[];
  outdoorUnitPos?: { x: number; y: number };
  outdoorUnitPositions?: { x: number; y: number }[];
  catalogQty?: number;
  catalogModel?: string;
  catalogEsp?: string;
  distributionPattern?: 'hexagonal' | 'orthogonal' | 'adaptive';
  coverageTargetPercent?: number;
  throwRadiusMode?: 'catalog-t50' | 'cfm-area' | 'custom';
  customThrowFt?: number;
}

export interface DxfLayerInfo {
  name: string;
  color?: string;
  visible: boolean;
  count: number;
}

export interface AnnotationVisibility {
  grid: boolean;
  diffusers: boolean;
  diffuserCfm: boolean;
  diffuserTags: boolean;
  throwRings: boolean;
  ducts: boolean;
  ductCfm: boolean;
  ductSizeBadges: boolean;
  ductCenterlines: boolean;
  indoorUnits: boolean;
  outdoorUnits: boolean;
  refrigerantPiping: boolean;
  leaderCallout: boolean;
  zoneLabels: boolean;
  dxfText: boolean;
}

export const DEFAULT_ANNOTATION_VISIBILITY: AnnotationVisibility = {
  grid: true,
  diffusers: true,
  diffuserCfm: true,
  diffuserTags: true,
  throwRings: true,
  ducts: true,
  ductCfm: true,
  ductSizeBadges: true,
  ductCenterlines: true,
  indoorUnits: true,
  outdoorUnits: true,
  refrigerantPiping: true,
  leaderCallout: true,
  zoneLabels: true,
  dxfText: true,
};

export interface ProjectMetadata {
  standardsSelection?: StandardsSelection;
  name: string;
  location: string;
  scale: number; // Drawing units per foot (imperial) or per meter (metric)
  cadUnit?: 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'custom';
  cadUnitsConfirmed?: boolean;
  /** Set when the scale came from picked points and a known length rather than from the file header. */
  cadScaleProvenance?: 'user-calibrated';
  equipmentScale?: number; // Visual equipment symbol scale multiplier (0.5x to 5.0x)
  units: 'imperial' | 'metric';
  outdoorDb: number;
  indoorDb: number;
  humidityRatioDelta?: number;
  supplyDeltaTF?: number;
  exposedWallFraction?: number;
  roofExposureFraction?: number;
}

export interface CadImportMetadata {
  sourceName?: string;
  unitsConfidence: 'declared' | 'estimated' | 'unknown';
  diagnostics: CadImportDiagnostic[];
}

interface ProjectState {
  project: ProjectMetadata;
  zones: Zone[];
  selectedZoneId: string | null;
  drawMode: 'select' | 'polyline' | 'pan';
  tempPoints: number[];
  dxfEntities: DxfEntity[];
  dxfBoundingBox: BoundingBox | null;
  dxfLayers: Record<string, DxfLayerInfo>;
  cadImport: CadImportMetadata | null;
  /** Layer-role suggestions plus the user's overrides. Suggestions never act as confirmed walls. */
  cadLayerRoles: CadLayerRoleState;
  /** Opening candidates with the user's decision. Only 'approved' ones may close wall gaps. */
  cadOpenings: StoredCadOpening[];
  /** Obstacle candidates with the user's decision; only 'approved' ones (with clearance) constrain designs. */
  cadObstacles: StoredCadObstacle[];
  /** Selected level elevation in drawing units (default 0). */
  cadLevel: number;
  /** INSERT block references of the current import; in memory only, used to re-run opening recognition. */
  cadBlockReferences: CadBlockReference[];
  annotationVisibility: AnnotationVisibility;
  loadedCatalogs: {
    decorative: { highWall: any[]; cassette: any[] } | null;
    ducted: any[] | null;
    errors?: string[];
  } | null;
  selectedSystemTypes: string[];
  optimizationWeights: OptimizationWeights;
  activeTab: 'comparison' | 'optimizer' | 'static-pressure' | 'schedule' | 'air-distribution';
  activePreview: DeploymentPreview | null;
  /** Manifest each room was last successfully deployed with (session only); the evidence verifyZoneEdits re-checks edits against. */
  deploymentEvidence: Record<string, DeploymentManifest>;
  highlightedDuctId: string | null;
  highlightedEntityTag: string | null;
  undoStack: WorkspaceSnapshot[];
  redoStack: WorkspaceSnapshot[];
  
  // Actions
  setProject: (meta: Partial<ProjectMetadata>) => void;
  restoreProjectDocument: (source: string) => {success: boolean; error?: string};
  setDrawMode: (mode: 'select' | 'polyline' | 'pan') => void;
  /** Validates the outline (simple polygon, >=3 distinct vertices); a refused outline leaves zones and tempPoints unchanged. */
  addZone: (points: number[]) => {success:boolean;error?:string};
  setTempPoints: (points: number[]) => void;
  /** Validated outline edits: a rejected edit leaves the zone and undo stack untouched; accepted ones push an undo snapshot and mark the zone stale. */
  /** Explicit apply step for dragged components: re-runs validateAppliedDeployment against the deployment evidence. Failure marks the room blocked with the error; success marks it preliminary. */
  verifyZoneEdits: (id: string) => {success:boolean;error?:string;pressureInWg?:number};
  moveZoneVertex: (id: string, index: number, x: number, y: number) => {success:boolean;error?:string};
  insertZoneVertex: (id: string, edgeIndex: number, x: number, y: number) => {success:boolean;error?:string};
  deleteZoneVertex: (id: string, index: number) => {success:boolean;error?:string};
  offsetZoneEdge: (id: string, edgeIndex: number, distance: number) => {success:boolean;error?:string};
  /** Recognise room candidates from the CAD review state (approved openings, user-confirmed wall layers, selected level). */
  recognizeCadRoomCandidates: () => CadRoomRecognitionRun;
  /** `ceilingHeight` is the value the caller chose (a suggestion is available via selectCeilingHeightSuggestion). */
  approveCadRoom: (candidate:CadRoomCandidate, inputs:{name:string;spaceTypeId:string;ceilingHeight:number;occupants:number;sourceCadRevision:string;drawingUnitsPerFoot:number;recognitionContext?:string}) => {success:boolean;error?:string};
  updateZone: (id: string, updates: Partial<Zone>) => void;
  deleteZone: (id: string) => void;
  selectZone: (id: string | null) => void;
  setHighlightedDuctId: (id: string | null) => void;
  setHighlightedEntityTag: (tag: string | null) => void;
  addTempPoint: (x: number, y: number) => void;
  clearTempPoints: () => void;
  setDxfData: (entities: DxfEntity[], bbox: BoundingBox, suggestedScale?: number, cadUnit?: 'mm' | 'cm' | 'm' | 'in' | 'ft', metadata?:CadImportMetadata, blockReferences?: CadBlockReference[]) => void;
  /** Set (or with null clear) the user's role for a layer, then refresh opening/obstacle suggestions. */
  setCadLayerRole: (layer: string, role: CadLayerRole | null) => CadActionResult;
  approveCadOpening: (id: string) => CadActionResult;
  rejectCadOpening: (id: string) => CadActionResult;
  approveCadObstacle: (id: string, clearanceFt: number) => CadActionResult;
  rejectCadObstacle: (id: string) => CadActionResult;
  setCadLevel: (level: number) => CadActionResult;
  /** Derive the drawing scale from two picked points and a known real length; confirms units. */
  calibrateScaleFromPoints: (p1: { x: number; y: number }, p2: { x: number; y: number }, knownLength: number, knownUnit: CadKnownUnit) => CadActionResult;
  clearDxfData: () => void;
  setDxfLayerVisibility: (layerName: string, visible: boolean) => void;
  toggleAllDxfLayers: (visible: boolean) => void;
  setAnnotationVisibility: (key: keyof AnnotationVisibility, visible: boolean) => void;
  toggleAllAnnotations: (visible: boolean) => void;
  loadDemoSystems: () => void;
  setLoadedCatalogs: (catalogs: { decorative: { highWall: any[]; cassette: any[] } | null; ducted: any[] | null; errors?: string[] } | null) => void;
  setSelectedSystemTypes: (types: string[]) => void;
  setOptimizationWeights: (weights: Partial<OptimizationWeights>) => void;
  setActiveTab: (tab: 'comparison' | 'optimizer' | 'static-pressure' | 'schedule' | 'air-distribution') => void;
  setPreview: (preview: DeploymentPreview | null) => void;
  applyCandidateTransaction: (candidate: SystemDesignCandidate) => { success: boolean; error?: string };
  undo: () => void;
  redo: () => void;
}

export interface CadActionResult { success: boolean; error?: string }

export interface CadRoomRecognitionRun {
  success: boolean
  error?: string
  result?: CadRoomRecognitionResult
  /** Pass these back to approveCadRoom so a change to CAD, scale or review decisions is detected. */
  sourceCadRevision?: string
  drawingUnitsPerFoot?: number
  recognitionContext?: string
  level?: number
  wallLayers?: string[]
  approvedOpeningIds?: string[]
}

/** Annotation-derived ceiling height for a room candidate, in project units. A suggestion, never applied by itself. */
export function selectCeilingHeightSuggestion(
  state: Pick<ProjectState, 'dxfEntities' | 'project' | 'cadLevel'>,
  candidate: Pick<CadRoomCandidate, 'polygon'>
): { suggestion?: CeilingHeightSuggestionView; unresolved: boolean; reasons: string[] } {
  return ceilingHeightSuggestionFor(state.dxfEntities, candidate.polygon, state.project, state.cadLevel);
}

const MAX_AUTO_DEPLOY_ATTEMPTS = 5;

const unitsPerFootOf = (project: ProjectMetadata): number =>
  project.units === 'metric' ? project.scale * METERS_PER_FOOT : project.scale;

const captureCad = (s: ProjectState): CadSemanticSnapshot => ({
  layerRoles: s.cadLayerRoles, openings: s.cadOpenings, obstacles: s.cadObstacles, level: s.cadLevel
});

/** Snapshot for undo/redo. CAD review state is included only for actions that change it. */
function makeSnapshot(s: ProjectState, description: string, withCad: boolean): WorkspaceSnapshot {
  return { snapshotId: `snap-${crypto.randomUUID()}`, timestamp: Date.now(), zones: structuredClone(s.zones),
    selectedZoneId: s.selectedZoneId, project: { ...s.project }, description, ...(withCad ? { cad: captureCad(s) } : {}) };
}

/** Shared path for validated outline edits (see zoneGeometryEdits). */
function applyZoneOutlineEdit(set: (partial: Partial<ProjectState>) => void, get: () => ProjectState, id: string, description: string,
  edit: (zone: Zone) => PolygonEdit): { success: boolean; error?: string } {
  const state = get();
  const zone = state.zones.find(z => z.id === id);
  if (!zone) return { success: false, error: 'Room not found.' };
  const result = edit(zone);
  if (!result.ok) return { success: false, error: result.error };
  const snapshot = makeSnapshot(state, `${description} of ${zone.name}`, false);
  set({ undoStack: [...state.undoStack, snapshot], redoStack: [] });
  const updates: Partial<Zone> = { points: result.points };
  if (zone.cadProvenance) updates.cadProvenance = { ...zone.cadProvenance, userModified: { at: new Date().toISOString(), edits: [...(zone.cadProvenance.userModified?.edits ?? []), description] } };
  get().updateZone(id, updates); // re-derives obstacles and marks the room stale
  return { success: true };
}

/** Refresh each zone's approved obstacles from the CAD review state; zones whose set changed become stale. */
function syncZoneObstacles(zones: Zone[], cadObstacles: StoredCadObstacle[]): Zone[] {
  return zones.map(zone => {
    const derived=zoneObstaclesFor(zone,cadObstacles);
    const current=zone.obstacles??[];
    if(JSON.stringify(derived)===JSON.stringify(current)) return zone;
    const {obstacles:_old,...rest}=zone;
    return {...rest,...(derived.length?{obstacles:derived}:{}),
      engineeringStatus:zone.engineeringStatus==='blocked'?zone.engineeringStatus:'stale' as const,engineeringNotice:undefined};
  });
}

const restoreCad = (cad: CadSemanticSnapshot | undefined) => cad ? {
  cadLayerRoles: cad.layerRoles, cadOpenings: cad.openings, cadObstacles: cad.obstacles, cadLevel: cad.level } : {};

/** Explains why no candidate was feasible, quoting the blocking diagnostics of the best-ranked rejects. */
function describeNoFeasibleCandidate(candidates: SystemDesignCandidate[]): string {
  const reasons = candidates
    .filter(c => !c.isValid)
    .slice(0, 3)
    .map(c => {
      const err = c.diagnostics.find(d => d.severity === 'error');
      return err ? `${c.equipment.model} x${c.quantity}: ${err.message}` : undefined;
    })
    .filter((m): m is string => !!m);
  return reasons.length
    ? `No feasible equipment candidate satisfies the current engineering inputs. ${reasons.join(' | ')}`
    : 'No feasible equipment candidate satisfies the current engineering inputs.';
}

type StoreGet = () => ProjectState;
type StoreSet = (partial: Partial<ProjectState>) => void;
function decideOpening(get: StoreGet, set: StoreSet, id: string, status: 'approved' | 'rejected'): CadActionResult {
  const state=get();
  if(!state.cadOpenings.some(o=>o.id===id)) return {success:false,error:'Unknown opening candidate.'};
  if(status==='approved' && state.project.cadUnitsConfirmed===false) return {success:false,error:'Confirm CAD units before approving openings.'};
  const cadOpenings=state.cadOpenings.map(o=>{
    if(o.id!==id) return o;
    const {approvedAt:_a,...rest}=o;
    return status==='approved'?{...rest,status,approvedAt:new Date().toISOString()}:{...rest,status};
  });
  set({cadOpenings,undoStack:[...state.undoStack,makeSnapshot(state,`${status==='approved'?'Approved':'Rejected'} CAD opening ${id}`,true)],redoStack:[]});
  return {success:true};
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: {
    name: 'Cairo Commercial Office',
    location: 'Cairo, Egypt',
    scale: 10,
    equipmentScale: 1.5,
    units: 'imperial',
    outdoorDb: 95,
    indoorDb: 75,
  },
  zones: [],
  selectedZoneId: null,
  drawMode: 'select',
  tempPoints: [],
  dxfEntities: [],
  dxfBoundingBox: null,
  dxfLayers: {},
  cadImport: null,
  cadLayerRoles: EMPTY_LAYER_ROLES,
  cadOpenings: [],
  cadObstacles: [],
  cadLevel: 0,
  cadBlockReferences: [],
  annotationVisibility: DEFAULT_ANNOTATION_VISIBILITY,
  loadedCatalogs: null,
  selectedSystemTypes: ['fcu', 'packaged', 'ahu', 'concealed', 'vrf', 'cassette', 'high-wall'],
  optimizationWeights: DEFAULT_OPTIMIZATION_WEIGHTS,
  activeTab: 'optimizer',
  activePreview: null,
  deploymentEvidence: {},
  highlightedDuctId: null,
  highlightedEntityTag: null,
  undoStack: [],
  redoStack: [],

  setProject: (meta) => set((state) => {
    const converted=convertProjectDisplayUnits(state.project,state.zones,meta.units??state.project.units);
    // A hand-edited scale or unit no longer is the calibrated one.
    const dropProvenance=(meta.scale!==undefined||meta.cadUnit!==undefined)&&meta.cadScaleProvenance===undefined;
    const project = { ...converted.project, ...meta, ...(dropProvenance?{cadScaleProvenance:undefined}:{}) };
    return { project, activePreview: null, zones: converted.zones.map(zone => {
      const evaluation = calculateZoneLoadSafely(zone, project);
      return { ...zone, engineeringStatus: evaluation.error ? 'blocked' as const : 'stale' as const,
        engineeringError: evaluation.error, engineeringNotice: undefined };
    }) };
  }),

  restoreProjectDocument: (source) => {
    try {
      const {cadLayerOverrides,cadOpenings,cadObstacles,cadLevel,...restored}=parseProjectDocument(source);
      const state=get();
      const level=cadLevel??0;
      // Suggestions are recomputed from the entities. Documents saved before CAD review decisions existed
      // (version 1) get fresh review-required suggestions and no approvals.
      const semantics=recognizeCadSemantics({entities:restored.dxfEntities,bbox:restored.dxfBoundingBox,
        unitsPerFoot:unitsPerFootOf(restored.project),level,overrides:cadLayerOverrides??{}});
      set({...restored,
        cadImport:restored.cadImport??null,
        cadLayerRoles:semantics.layerRoles,
        cadOpenings:cadOpenings??semantics.openings,
        cadObstacles:cadObstacles??semantics.obstacles,
        cadLevel:level,cadBlockReferences:[],
        annotationVisibility:restored.annotationVisibility??DEFAULT_ANNOTATION_VISIBILITY,
        selectedSystemTypes:restored.selectedSystemTypes??state.selectedSystemTypes,
        optimizationWeights:restored.optimizationWeights??DEFAULT_OPTIMIZATION_WEIGHTS,
        loadedCatalogs:restored.loadedCatalogs as ProjectState['loadedCatalogs'] ?? null,
        selectedZoneId:restored.zones[0]?.id??null,activePreview:null,
        highlightedDuctId:null,highlightedEntityTag:null,drawMode:'select',tempPoints:[],undoStack:[],redoStack:[]});
      return {success:true};
    } catch(error) {return {success:false,error:error instanceof Error?error.message:String(error)};}
  },
  
  setDrawMode: (mode) => set({ drawMode: mode, tempPoints: [] }),
  recognizeCadRoomCandidates: () => {
    try {
      const state=get();
      if(state.project.cadUnitsConfirmed===false) throw new Error('Confirm CAD units before recognizing rooms.');
      const basis=buildRoomRecognitionBasis(state);
      return {success:true,result:recognizeCadRooms(state.dxfEntities,basis.options),sourceCadRevision:JSON.stringify(state.dxfEntities),
        drawingUnitsPerFoot:basis.options.drawingUnitsPerFoot,recognitionContext:basis.context,level:state.cadLevel,
        wallLayers:basis.wallLayers,approvedOpeningIds:basis.approvedOpeningIds};
    } catch(error) {return {success:false,error:error instanceof Error?error.message:'Room recognition failed.'};}
  },
  approveCadRoom: (candidate,inputs) => {
    try {
      const state=get();
      if(state.project.cadUnitsConfirmed===false) throw new Error('Confirm CAD units before approving rooms.');
      if(JSON.stringify(state.dxfEntities)!==inputs.sourceCadRevision) throw new Error('CAD changed; recognize rooms again.');
      const unitsPerFoot=drawingUnitsPerFoot(state.project);
      const basis=buildRoomRecognitionBasis(state);
      if(inputs.recognitionContext!==undefined && inputs.recognitionContext!==basis.context) throw new Error('CAD review decisions changed; recognize rooms again.');
      if(unitsPerFoot!==inputs.drawingUnitsPerFoot) throw new Error('Drawing scale changed; recognize rooms again.');
      requirePositive('Drawing scale',unitsPerFoot);
      measureSimplePolygon(candidate.polygon);
      requirePositive('Ceiling height',inputs.ceilingHeight);requireNonnegative('Occupants',inputs.occupants);
      if(!inputs.name.trim()) throw new Error('Enter a room name.');
      if(!ASHRAE_SPACE_TYPES.some(t=>t.id===inputs.spaceTypeId)) throw new Error('Select a supported room use.');
      if(state.zones.some(z=>z.cadProvenance?.candidateId===candidate.id)) throw new Error('This CAD room is already approved.');
      const suggestion=selectCeilingHeightSuggestion(state,candidate).suggestion;
      const id=`cad-zone-${crypto.randomUUID()}`;
      const zone:Zone={id,name:inputs.name.trim(),points:[...candidate.polygon],spaceTypeId:inputs.spaceTypeId,
        ceilingHeight:inputs.ceilingHeight,occupants:inputs.occupants,systemType:'concealed',diffusers:[],ducts:[],engineeringStatus:'stale',
        cadProvenance:{sourceCadRevision:inputs.sourceCadRevision,candidateId:candidate.id,sourceHandles:[...candidate.sourceHandles],sourceLayers:[...candidate.sourceLayers],
          evidence:[...candidate.evidence],unresolvedConditions:[...candidate.unresolvedConditions],drawingUnitsPerFoot:unitsPerFoot,approvedAt:new Date().toISOString(),
          level:state.cadLevel,approvedOpeningIds:basis.approvedOpeningIds,boundaryLayers:basis.wallLayers,
          ceilingHeight:{chosen:inputs.ceilingHeight,usedSuggestion:!!suggestion&&Math.abs(suggestion.value-inputs.ceilingHeight)<=1e-6,
            ...(suggestion?{suggestedFt:suggestion.valueFt,confidence:suggestion.confidence,evidence:[...suggestion.evidence]}:{})}}};
      const roomObstacles=zoneObstaclesFor(zone,state.cadObstacles);
      if(roomObstacles.length) zone.obstacles=roomObstacles;
      const evaluation=calculateZoneLoadSafely(zone,state.project);
      if(evaluation.error) throw new Error(evaluation.error);
      const previous:WorkspaceSnapshot={snapshotId:`snap-${crypto.randomUUID()}`,timestamp:Date.now(),zones:structuredClone(state.zones),
        selectedZoneId:state.selectedZoneId,project:{...state.project},description:`Approved CAD room ${zone.name}`};
      set({zones:[...state.zones,zone],selectedZoneId:id,activePreview:null,undoStack:[...state.undoStack,previous],redoStack:[]});
      return {success:true};
    } catch(error) {return {success:false,error:error instanceof Error?error.message:'Room approval failed.'};}
  },
  setHighlightedDuctId: (id) => set({ highlightedDuctId: id }),
  setHighlightedEntityTag: (tag) => set({ highlightedEntityTag: tag }),
  
  addZone: (points) => {
    const check = validateZonePolygon(points);
    if (!check.ok) return { success: false, error: check.error };
    const cleanPoints = check.points;

    const id = `zone-${Date.now()}`;
    const state = get();

    const draftZone: Zone = {
      id,
      name: `Zone ${state.zones.length + 1}`,
      points: cleanPoints,
      spaceTypeId: 'office',
      ceilingHeight: state.project.units === 'metric' ? 3.048 : 10,
      occupants: 1,
      systemType: 'concealed',
      distributionPattern: 'hexagonal',
      coverageTargetPercent: 100,
      diffusers: [],
      ducts: [],
      maxVelocityLimitFpm: 1200,
      maxSpaceNcLimit: 32
    };
    const drawnObstacles = zoneObstaclesFor(draftZone, state.cadObstacles);
    if (drawnObstacles.length) draftZone.obstacles = drawnObstacles;
    const sourceZoneRevision = getZoneDeploymentRevision(draftZone);
    const sourceProjectRevision = getProjectDeploymentRevision(state.project);

    // Phase 1: Immediately add the lightweight draft zone so the UI stays responsive
    set({
      zones: [...state.zones, draftZone],
      selectedZoneId: id,
      drawMode: 'select',
      tempPoints: []
    });

    // Phase 2: Defer the expensive engineering computations off the current call stack
    // so the canvas can repaint the polygon before the heavy work begins
    setTimeout(() => {
      try {
        const currentState = get();
        const liveZone = currentState.zones.find(z => z.id === id);
        if (!liveZone || getZoneDeploymentRevision(liveZone) !== sourceZoneRevision ||
            getProjectDeploymentRevision(currentState.project) !== sourceProjectRevision) return;
        const load = calculateCanonicalZoneLoad(draftZone, currentState.project);
        // Only evaluate the default system type for fast auto-deployment
        // (full multi-system comparison runs when user opens the optimizer panel)
        const recommendations = generateSystemCandidates(
          load.totalLoad,
          load.sensibleLoad,
          load.supplyCfm,
          draftZone.spaceTypeId,
          load.area,
          true,
          currentState.optimizationWeights,
          draftZone.systemType ? [draftZone.systemType] : ['concealed'],
          currentState.loadedCatalogs,
          [],
          [],
          zoneExtentFt(draftZone.points, currentState.project)
        );

        // Try the valid candidates in rank order: the best-ranked pick can still fail deployment for
        // reasons the generator cannot see (footprint, routing), so fall through to the next ones.
        const ranked = recommendations.candidates.filter(c => c.isValid).slice(0, MAX_AUTO_DEPLOY_ATTEMPTS);
        const skipped: string[] = [];
        let deployed = false;
        for (const candidate of ranked) {
          const manifest = buildDeploymentManifest(
            candidate,
            draftZone,
            currentState.zones,
            currentState.project,
            currentState.dxfEntities,
            currentState.dxfBoundingBox
          );
          const txResult = executeDeploymentTransaction(manifest, currentState.zones, currentState.project);
          if (txResult.success) {
            const deployedZone = txResult.updatedZones.find(z => z.id === id)!;
            const notice = skipped.length ? `Skipped higher-ranked candidates: ${skipped.join(' | ')}` : undefined;
            // Apply the computed deployment to the existing zone
            set((s) => ({
              deploymentEvidence: { ...s.deploymentEvidence, [id]: manifest },
              zones: s.zones.map((z) => (z.id === id ? { ...z, ...deployedZone, id,
                engineeringStatus: 'preliminary', engineeringError: undefined, engineeringNotice: notice } : z))
            }));
            deployed = true;
            break;
          }
          const reason = manifest.diagnostics.find(d => d.severity === 'error')?.message ?? txResult.errorDiagnostic?.message ?? 'Design cannot be deployed.';
          skipped.push(`${candidate.equipment.model} x${candidate.quantity}: ${reason}`);
        }
        if (!deployed) {
          const message = skipped.length
            ? `No ranked candidate could be deployed. ${skipped.join(' | ')}`
            : describeNoFeasibleCandidate(recommendations.candidates);
          set(s => ({ zones: s.zones.map(z => z.id === id ? { ...z, engineeringStatus: 'blocked', engineeringNotice: undefined,
            engineeringError: message } : z) }));
        }
      } catch (err) {
        set(s => ({ zones: s.zones.map(z => z.id === id ? { ...z, engineeringStatus: 'blocked', engineeringNotice: undefined,
          engineeringError: err instanceof Error ? err.message : 'Automatic design failed.' } : z) }));
      }
    }, 0);
    return { success: true };
  },
  
  updateZone: (id, updates) => set((state) => ({
    activePreview: null,
    zones: state.zones.map(z => {
      if (z.id !== id) return z;
      let updated = { ...z, ...updates };
      if (updates.points && updates.obstacles === undefined) {
        // The outline changed, so which approved obstacles lie inside it changed too.
        const { obstacles: _old, ...rest } = updated;
        const derived = zoneObstaclesFor(updated, state.cadObstacles);
        updated = { ...rest, ...(derived.length ? { obstacles: derived } : {}) };
      }
      const evaluation = calculateZoneLoadSafely(updated, state.project);
      return { ...updated, engineeringStatus: evaluation.error ? 'blocked' as const : 'stale' as const,
        engineeringError: evaluation.error, engineeringNotice: undefined };
    })
  })),
  
  deleteZone: (id) => set((state) => ({
    zones: state.zones.filter((z) => z.id !== id),
    selectedZoneId: state.selectedZoneId === id ? null : state.selectedZoneId,
    activePreview: null
  })),
  
  selectZone: (id) => set({ selectedZoneId: id, activePreview: null }),
  
  addTempPoint: (x, y) => set((state) => {
    const len = state.tempPoints.length;
    if (len >= 2 && state.tempPoints[len - 2] === x && state.tempPoints[len - 1] === y) {
      return {};
    }
    return { tempPoints: [...state.tempPoints, x, y] };
  }),
  
  setTempPoints: (points) => set({ tempPoints: [...points] }),
  verifyZoneEdits: (id) => {
    const state = get();
    const zone = state.zones.find(z => z.id === id);
    if (!zone) return { success: false, error: 'Room not found.' };
    const result = verifyEditedZone(zone, state.deploymentEvidence[id], state.project);
    set({ zones: state.zones.map(z => z.id !== id ? z : result.ok
      ? { ...z, engineeringStatus: 'preliminary' as const, engineeringError: undefined, engineeringNotice: undefined }
      : { ...z, engineeringStatus: 'blocked' as const, engineeringError: result.error }) });
    return result.ok ? { success: true, pressureInWg: result.pressureInWg } : { success: false, error: result.error };
  },
  moveZoneVertex: (id, index, x, y) => applyZoneOutlineEdit(set, get, id, `Moved vertex ${index}`, z => moveVertex(z.points, index, x, y)),
  insertZoneVertex: (id, edgeIndex, x, y) => applyZoneOutlineEdit(set, get, id, `Inserted vertex on edge ${edgeIndex}`, z => insertVertex(z.points, edgeIndex, x, y)),
  deleteZoneVertex: (id, index) => applyZoneOutlineEdit(set, get, id, `Deleted vertex ${index}`, z => deleteVertex(z.points, index)),
  offsetZoneEdge: (id, edgeIndex, distance) => applyZoneOutlineEdit(set, get, id, `Offset edge ${edgeIndex}`, z => offsetEdge(z.points, edgeIndex, distance)),
  clearTempPoints: () => set({ tempPoints: [] }),
  
  setDxfData: (entities, bbox, suggestedScale, cadUnit, metadata, blockReferences) => {
    const layers: Record<string, DxfLayerInfo> = Object.create(null);
    const autoColors = ['#94a3b8', '#38bdf8', '#34d399', '#fbbf24', '#f87171', '#c084fc', '#f472b6', '#a78bfa', '#4ade80'];
    let colorIdx = 0;

    for (const ent of entities) {
      const layerName = ent.layer || '0';
      if (!layers[layerName]) {
        layers[layerName] = {
          name: layerName,
          color: ent.color || autoColors[colorIdx % autoColors.length],
          visible: true,
          count: 0
        };
        colorIdx++;
      }
      layers[layerName].count++;
    }

    set((state) => {
      const project={...state.project,
        ...(suggestedScale!==undefined?{scale:suggestedScale}:{}),
        ...(cadUnit?{cadUnit}:{}),
        ...(metadata?{cadUnitsConfirmed:unitsAutoConfirmed(metadata)}:{}),
        ...(suggestedScale!==undefined||cadUnit||metadata?{cadScaleProvenance:undefined}:{})};
      // A new drawing starts a fresh review: no inherited overrides, decisions or level.
      const semantics=recognizeCadSemantics({entities,bbox,blockReferences,unitsPerFoot:unitsPerFootOf(project),level:0,overrides:{}});
      return {
      dxfEntities: entities,
      dxfBoundingBox: bbox,
      dxfLayers: layers,
      cadImport:metadata??null,
      cadLayerRoles:semantics.layerRoles,cadOpenings:semantics.openings,cadObstacles:semantics.obstacles,
      cadLevel:0,cadBlockReferences:blockReferences??[],
      activePreview:null,
      project,
      zones:state.zones.map(zone=>{
        const evaluation=calculateZoneLoadSafely(zone,project);
        return {...zone,engineeringStatus:evaluation.error?'blocked' as const:'stale' as const,engineeringError:evaluation.error,engineeringNotice:undefined};
      })};
    });
  },

  clearDxfData: () => set({ dxfEntities: [], dxfBoundingBox: null, dxfLayers: {},cadImport:null,activePreview:null,
    cadLayerRoles:EMPTY_LAYER_ROLES,cadOpenings:[],cadObstacles:[],cadLevel:0,cadBlockReferences:[] }),

  setCadLayerRole: (layer, role) => {
    const state=get();
    if(!state.dxfLayers[layer]) return {success:false,error:`Unknown CAD layer ${layer}.`};
    if(role!==null && !(CAD_LAYER_ROLES as readonly string[]).includes(role)) return {success:false,error:'Unsupported layer role.'};
    const overrides={...state.cadLayerRoles.overrides};
    if(role===null) delete overrides[layer]; else overrides[layer]=role;
    const semantics=recognizeCadSemantics({entities:state.dxfEntities,bbox:state.dxfBoundingBox,blockReferences:state.cadBlockReferences,
      unitsPerFoot:unitsPerFootOf(state.project),level:state.cadLevel,overrides,suggestions:state.cadLayerRoles.suggestions,
      prior:{openings:state.cadOpenings,obstacles:state.cadObstacles}});
    set({cadLayerRoles:semantics.layerRoles,cadOpenings:semantics.openings,cadObstacles:semantics.obstacles,
      undoStack:[...state.undoStack,makeSnapshot(state,`Set CAD layer role ${layer}`,true)],redoStack:[]});
    return {success:true};
  },

  approveCadOpening: (id) => decideOpening(get,set,id,'approved'),
  rejectCadOpening: (id) => decideOpening(get,set,id,'rejected'),

  approveCadObstacle: (id, clearanceFt) => {
    const state=get();
    const found=state.cadObstacles.find(o=>o.id===id);
    if(!found) return {success:false,error:'Unknown obstacle candidate.'};
    if(state.project.cadUnitsConfirmed===false) return {success:false,error:'Confirm CAD units before approving obstacles.'};
    if(typeof clearanceFt!=='number' || !Number.isFinite(clearanceFt) || clearanceFt<0) return {success:false,error:'Clearance must be a finite, non-negative length in feet.'};
    const cadObstacles=state.cadObstacles.map(o=>o.id===id?{...o,status:'approved' as const,clearanceFt,approvedAt:new Date().toISOString()}:o);
    set({cadObstacles,zones:syncZoneObstacles(state.zones,cadObstacles),activePreview:null,undoStack:[...state.undoStack,makeSnapshot(state,`Approved CAD obstacle ${id}`,true)],redoStack:[]});
    return {success:true};
  },
  rejectCadObstacle: (id) => {
    const state=get();
    if(!state.cadObstacles.some(o=>o.id===id)) return {success:false,error:'Unknown obstacle candidate.'};
    const cadObstacles=state.cadObstacles.map(o=>{
      if(o.id!==id) return o;
      const {clearanceFt:_c,approvedAt:_a,...rest}=o;
      return {...rest,status:'rejected' as const};
    });
    set({cadObstacles,zones:syncZoneObstacles(state.zones,cadObstacles),activePreview:null,undoStack:[...state.undoStack,makeSnapshot(state,`Rejected CAD obstacle ${id}`,true)],redoStack:[]});
    return {success:true};
  },

  calibrateScaleFromPoints: (p1, p2, knownLength, knownUnit) => {
    try {
      const state=get();
      const unitsPerFoot=calibrateDrawingScale(p1,p2,knownLength,knownUnit);
      const scale=state.project.units==='metric'?unitsPerFoot/METERS_PER_FOOT:unitsPerFoot;
      requirePositive('Drawing scale',scale);
      const project:ProjectMetadata={...state.project,scale,cadUnit:'custom',cadUnitsConfirmed:true,cadScaleProvenance:'user-calibrated'};
      set({project,activePreview:null,
        zones:state.zones.map(zone=>{
          const evaluation=calculateZoneLoadSafely(zone,project);
          return {...zone,engineeringStatus:evaluation.error?'blocked' as const:'stale' as const,engineeringError:evaluation.error,engineeringNotice:undefined};
        }),
        undoStack:[...state.undoStack,makeSnapshot(state,`Calibrated drawing scale to ${unitsPerFoot.toPrecision(6)} units/ft`,false)],redoStack:[]});
      return {success:true};
    } catch(error) {return {success:false,error:error instanceof Error?error.message:'Scale calibration failed.'};}
  },

  setCadLevel: (level) => {
    const state=get();
    if(typeof level!=='number' || !Number.isFinite(level)) return {success:false,error:'Level must be a finite elevation.'};
    if(level===state.cadLevel) return {success:true};
    const semantics=recognizeCadSemantics({entities:state.dxfEntities,bbox:state.dxfBoundingBox,blockReferences:state.cadBlockReferences,
      unitsPerFoot:unitsPerFootOf(state.project),level,overrides:state.cadLayerRoles.overrides,suggestions:state.cadLayerRoles.suggestions,
      prior:{openings:state.cadOpenings,obstacles:state.cadObstacles}});
    set({cadLevel:level,cadOpenings:semantics.openings,cadObstacles:semantics.obstacles,activePreview:null,
      undoStack:[...state.undoStack,makeSnapshot(state,`Selected CAD level ${level}`,true)],redoStack:[]});
    return {success:true};
  },

  setDxfLayerVisibility: (layerName, visible) => set((state) => ({
    dxfLayers: {
      ...state.dxfLayers,
      [layerName]: {
        ...state.dxfLayers[layerName],
        visible
      }
    }
  })),

  toggleAllDxfLayers: (visible) => set((state) => {
    const updated: Record<string, DxfLayerInfo> = {};
    for (const [name, info] of Object.entries(state.dxfLayers)) {
      updated[name] = { ...info, visible };
    }
    return { dxfLayers: updated };
  }),

  setAnnotationVisibility: (key, visible) => set((state) => ({
    annotationVisibility: {
      ...state.annotationVisibility,
      [key]: visible
    }
  })),

  toggleAllAnnotations: (visible) => set((state) => {
    const updated = { ...state.annotationVisibility };
    for (const key of Object.keys(updated) as (keyof AnnotationVisibility)[]) {
      updated[key] = visible;
    }
    return { annotationVisibility: updated };
  }),

  loadDemoSystems: () => set(() => {
    const zone1Points = [60, 60, 240, 60, 240, 180, 60, 180];
    const zone2Points = [360, 60, 540, 60, 540, 180, 360, 180];
    const zone3Points = [60, 270, 240, 270, 240, 390, 60, 390];
    const zone4Points = [360, 270, 540, 270, 540, 390, 360, 390];

    const z1Id = `zone-demo-concealed`;
    const z2Id = `zone-demo-highwall`;
    const z3Id = `zone-demo-packaged`;
    const z4Id = `zone-demo-cassette`;

    const diffusers1 = [
      { id: 'dif-z1-1', x: 130, y: 120, cfm: 200, size: '9"x9"', actualNc: 22, throwT50Ft: 9, deltaPInWg: 0.032 },
      { id: 'dif-z1-2', x: 190, y: 120, cfm: 200, size: '9"x9"', actualNc: 22, throwT50Ft: 9, deltaPInWg: 0.032 }
    ];
    const ducts1 = [
      { id: 'duct-z1-t1', type: 'trunk' as const, points: [95, 120, 130, 120], widthIn: 10, heightIn: 8, cfm: 400, sizeLabel: '10"x8"', velocityFpm: 720 },
      { id: 'duct-z1-b1', type: 'branch' as const, points: [130, 120, 190, 120], widthIn: 8, heightIn: 6, cfm: 200, sizeLabel: '8"x6"', velocityFpm: 600 }
    ];

    const diffusers3 = [
      { id: 'dif-z3-1', x: 130, y: 330, cfm: 250, size: '9"x9"', actualNc: 24, throwT50Ft: 10, deltaPInWg: 0.038 },
      { id: 'dif-z3-2', x: 190, y: 330, cfm: 250, size: '9"x9"', actualNc: 24, throwT50Ft: 10, deltaPInWg: 0.038 }
    ];
    const ducts3 = [
      { id: 'duct-z3-s1', type: 'trunk' as const, points: [20, 310, 130, 310], widthIn: 12, heightIn: 8, cfm: 500, sizeLabel: '12"x8"', velocityFpm: 750 },
      { id: 'duct-z3-s2', type: 'branch' as const, points: [130, 310, 190, 310], widthIn: 8, heightIn: 8, cfm: 250, sizeLabel: '8"x8"', velocityFpm: 562 },
      { id: 'duct-z3-r1', type: 'return' as const, points: [20, 350, 110, 350], widthIn: 12, heightIn: 8, cfm: 500, sizeLabel: '12"x8" (R)', velocityFpm: 750 }
    ];

    const demoZones: Zone[] = [
      {
        id: z1Id,
        name: "Concealed Ducted Split",
        points: zone1Points,
        spaceTypeId: 'office',
        ceilingHeight: 9,
        occupants: 3,
        systemType: 'concealed',
        unitPos: { x: 95, y: 120 },
        outdoorUnitPos: { x: 20, y: 120 },
        diffusers: diffusers1,
        ducts: ducts1,
        catalogQty: 1,
        catalogModel: '42QSS024-D',
        catalogEsp: '0.45 in.wg'
      },
      {
        id: z2Id,
        name: "High Wall DX Split",
        points: zone2Points,
        spaceTypeId: 'office',
        ceilingHeight: 9,
        occupants: 2,
        systemType: 'high-wall',
        unitPos: { x: 505, y: 120 },
        outdoorUnitPos: { x: 580, y: 120 },
        diffusers: [],
        ducts: [],
        catalogQty: 1,
        catalogModel: 'Optimax 24K'
      },
      {
        id: z3Id,
        name: "Packaged Rooftop Unit",
        points: zone3Points,
        spaceTypeId: 'conference',
        ceilingHeight: 10,
        occupants: 8,
        systemType: 'packaged',
        unitPos: { x: 95, y: 330 },
        outdoorUnitPos: { x: 20, y: 330 },
        diffusers: diffusers3,
        ducts: ducts3,
        catalogQty: 1,
        catalogModel: 'WeatherMaster 48HC-08',
        catalogEsp: '1.20 in.wg'
      },
      {
        id: z4Id,
        name: "Cassette Split System",
        points: zone4Points,
        spaceTypeId: 'lobby',
        ceilingHeight: 10,
        occupants: 4,
        systemType: 'cassette',
        unitPos: undefined,
        outdoorUnitPos: { x: 580, y: 330 },
        diffusers: [
          { id: 'dif-z4-1', x: 450, y: 330, cfm: 600, size: '36K', actualNc: 28, throwT50Ft: 14, deltaPInWg: 0.04 }
        ],
        ducts: [],
        catalogQty: 1,
        catalogModel: '40KMC036'
      }
    ];

    return {
      zones: demoZones,
      selectedZoneId: z1Id,
      drawMode: 'select',
      activePreview: null
    };
  }),

  setLoadedCatalogs: (catalogs) => set({ loadedCatalogs: catalogs }),
  setSelectedSystemTypes: (types) => set({ selectedSystemTypes: types }),
  setOptimizationWeights: (weights) => set((state) => ({
    optimizationWeights: { ...state.optimizationWeights, ...weights }
  })),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setPreview: (preview) => set({ activePreview: preview }),

  applyCandidateTransaction: (candidate) => {
    try {
    const state = get();
    const targetZone = state.zones.find((z) => z.id === state.selectedZoneId) || state.zones[0];

    if (!targetZone) {
      return { success: false, error: 'No active zone selected for deployment.' };
    }

    // 1. Build deployment manifest
    const manifest = buildDeploymentManifest(
      candidate,
      targetZone,
      state.zones,
      state.project,
      state.dxfEntities,
      state.dxfBoundingBox
    );

    if (!manifest.isEligibleToApply) {
      const blocking = manifest.diagnostics.find((d) => d.severity === 'error');
      return {
        success: false,
        error: blocking?.message || 'Deployment validation failed hard constraints.'
      };
    }

    // 2. Save snapshot for Undo
    const snapshot: WorkspaceSnapshot = {
      snapshotId: `snap-${Date.now()}`,
      timestamp: Date.now(),
      zones: JSON.parse(JSON.stringify(state.zones)),
      selectedZoneId: state.selectedZoneId,
      project: { ...state.project },
      description: `Applied ${candidate.equipment.model} to ${targetZone.name}`
    };

    // 3. Execute atomic transaction
    const { updatedZones, success, errorDiagnostic } = executeDeploymentTransaction(manifest, state.zones, state.project);

    if (!success) {
      return {
        success: false,
        error: errorDiagnostic?.message || 'Transaction execution failed and was rolled back.'
      };
    }

    set({
      deploymentEvidence: { ...state.deploymentEvidence, [targetZone.id]: manifest },
      zones: updatedZones.map(z => z.id === targetZone.id ? { ...z,
        engineeringStatus: 'preliminary' as const, engineeringError: undefined, engineeringNotice: undefined } : z),
      undoStack: [...state.undoStack, snapshot],
      redoStack: [],
      activePreview: null
    });

    return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Invalid engineering input.' };
    }
  },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;

    const previousSnapshot = state.undoStack[state.undoStack.length - 1];
    const newUndoStack = state.undoStack.slice(0, -1);

    const currentSnapshot: WorkspaceSnapshot = {
      snapshotId: `snap-redo-${Date.now()}`,
      timestamp: Date.now(),
      zones: JSON.parse(JSON.stringify(state.zones)),
      selectedZoneId: state.selectedZoneId,
      project: { ...state.project },
      description: 'Current State',
      ...(previousSnapshot.cad ? { cad: captureCad(state) } : {})
    };

    set({
      ...restoreCad(previousSnapshot.cad),
      zones: previousSnapshot.zones,
      selectedZoneId: previousSnapshot.selectedZoneId,
      project: previousSnapshot.project,
      undoStack: newUndoStack,
      redoStack: [...state.redoStack, currentSnapshot],
      activePreview: null
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;

    const nextSnapshot = state.redoStack[state.redoStack.length - 1];
    const newRedoStack = state.redoStack.slice(0, -1);

    const currentSnapshot: WorkspaceSnapshot = {
      snapshotId: `snap-undo-${Date.now()}`,
      timestamp: Date.now(),
      zones: JSON.parse(JSON.stringify(state.zones)),
      selectedZoneId: state.selectedZoneId,
      project: { ...state.project },
      description: 'Current State',
      ...(nextSnapshot.cad ? { cad: captureCad(state) } : {})
    };

    set({
      ...restoreCad(nextSnapshot.cad),
      zones: nextSnapshot.zones,
      selectedZoneId: nextSnapshot.selectedZoneId,
      project: nextSnapshot.project,
      undoStack: [...state.undoStack, currentSnapshot],
      redoStack: newRedoStack,
      activePreview: null
    });
  }
}));
