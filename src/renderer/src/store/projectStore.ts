import { create } from 'zustand';
import { calculateZoneLoad } from '../engine/loadCalc';
import { generateSystemCandidates, DEFAULT_OPTIMIZATION_WEIGHTS } from '../engine/systemDesigner';
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
import { normalizeCadToCanvas } from '../engine/dxfParser';
import { pxPerFt } from '../engine/units';
import { rescaleProjectGeometry } from '../canvas/drawingGeometry';
import {
  buildDeploymentManifest,
  executeDeploymentTransaction
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
  /** Physical face size in inches (derived from `size` when absent). */
  faceWidthIn?: number;
  faceHeightIn?: number;
  /** Indoor unit (service zone) this terminal is assigned to; a unit's supply terminals sum to that unit's CFM. */
  unitId?: string;
  serviceZoneId?: string;
  unitTag?: string;
  /** Return grille that opens into the ceiling plenum (no return duct is routed to it). */
  plenumReturn?: boolean;
  /** 'plenum' on a plenum-return grille: no association line is drawn. */
  returnPath?: 'plenum';
  /** Set after a unit-system change when the remapped size's neck velocity exceeds the limit. */
  sizeWarning?: string;
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
  /** Unavoidable supply/return plan crossing: needs a vertical offset. */
  crossover?: boolean;
  crossoverWith?: string[];
  /** Clearance problem text from the router. */
  clearanceIssue?: string;
  designWarnings?: string[];
  /** Short return box at the unit of a ceiling-plenum return. */
  plenumBox?: boolean;
  /** Indoor unit (service zone) whose duct network this segment belongs to. */
  unitId?: string;
  serviceZoneId?: string;
}

export interface DxfEntity {
  type: 'LINE' | 'LWPOLYLINE' | 'POLYLINE' | 'CIRCLE' | 'ARC' | 'TEXT' | 'MTEXT';
  points?: number[];
  x?: number;
  y?: number;
  radius?: number;
  text?: string;
  color?: string;
  layer?: string;
  /** ARC: degrees, canvas orientation (clockwise, Y down) - draw directly with arc(). */
  startAngle?: number;
  endAngle?: number;
  /** TEXT/MTEXT: text height (canvas px), rotation (degrees, canvas), horizontal anchor of (x, y). */
  height?: number;
  rotation?: number;
  align?: 'left' | 'center' | 'right';
}

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface Zone {
  id: string;
  name: string;
  points: number[];
  spaceTypeId: string;
  ceilingHeight: number;
  occupants: number;
  lightingOverride?: number;
  equipmentOverride?: number;
  manualCfmOverride?: number;
  manualCoolingOverride?: number;
  systemType?: 'high-wall' | 'cassette' | 'concealed' | 'packaged' | 'vrf' | 'ahu' | 'fcu';
  /** Return path: 'plenum' (grilles open into the ceiling void, short return box at the unit) or 'ducted' (return mains). */
  returnStrategy?: 'plenum' | 'ducted';
  /** Indoor unit tags in unitPositions order (e.g. FCU-01, FCU-02). */
  unitTags?: string[];
  /** Engine design warnings (coverage, manufacturer mix, clearance) surfaced to the user. */
  designWarnings?: string[];
  /** 'plenum': returns open into the ceiling void (no association lines); 'ducted': return mains. */
  returnPath?: 'plenum' | 'ducted';
  /** How the indoor units are served: refrigerant (outdoor units), chilled-water (stubs) or self-contained. */
  plantConnection?: 'refrigerant' | 'chilled-water' | 'self-contained';
  /** Chilled-water supply / return stub endpoints (canvas px). */
  chwStubs?: { unitIndex: number; x: number; y: number; side: 'north' | 'south' | 'east' | 'west'; kind: 'supply' | 'return' }[];
  /** VRF outdoor module model (catalogModel is then the indoor unit). */
  outdoorModel?: string;
  /** ASHRAE 62.1 zone outdoor air Voz (CFM) for the fresh-air callout. */
  outdoorAirCfm?: number;
  ductTypeId?: string;
  diffuserTypeId?: string;
  maxVelocityLimitFpm?: number;
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
  /** Per indoor unit: CFM, service polygon (px), terminal ids, serving outdoor unit. Written by the air-distribution engine. */
  unitServiceZones?: {
    id: string;
    engineId?: string;
    unitTag: string;
    supplyCfm: number;
    returnCfm: number;
    capacityBtu: number;
    polygon: number[];
    unitPos: { x: number; y: number };
    outdoorUnitIndex: number;
    footprintIn?: { lengthIn: number; widthIn: number };
    supplyTerminalIds: string[];
    returnTerminalIds: string[];
  }[];
  serviceZonePolygons?: number[][];
  outdoorUnitDetails?: { x: number; y: number; angleDeg: number; lengthPx: number; depthPx: number; wallSide: string; serves: string[] }[];
}

export interface DxfLayerInfo {
  name: string;
  /** Effective display colour: colorOverride ?? tableColor ?? first entity colour ?? auto palette. */
  color?: string;
  /** Colour from the DXF LAYER table (if any). */
  tableColor?: string;
  /** User override (wins over everything, incl. per-entity colours). */
  colorOverride?: string;
  visible: boolean;
  count: number;
}

/** Raw parsed CAD (drawing units, pre-normalisation) kept so it can be re-normalised on scale/unit changes. */
export interface RawCad {
  entities: DxfEntity[];
  bbox: BoundingBox;
  insunits?: number;
  layerColors: Record<string, string>;
  warnings: string[];
}

export interface CadCalibrationState {
  /** True when INSUNITS was unknown AND the user has not calibrated yet. */
  needsCalibration: boolean;
  feetPerUnit: number;
  pxPerUnit: number;
  /** User calibration (feet per drawing unit); wins over INSUNITS. */
  overrideFeetPerUnit?: number;
  warning?: string;
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
  /** Shop-drawing dimension layer: duct size tags, diffuser tags, room dimension lines. */
  dimensions: boolean;
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
  dimensions: false,
};

export interface ProjectMetadata {
  name: string;
  location: string;
  scale: number;
  equipmentScale?: number; // Visual equipment symbol scale multiplier (0.5x to 5.0x)
  units: 'imperial' | 'metric';
  outdoorDb: number;
  indoorDb: number;
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
  cadRaw: RawCad | null;
  cadCalibration: CadCalibrationState | null;
  annotationVisibility: AnnotationVisibility;
  loadedCatalogs: {
    decorative: CatalogDecorativeSet | null;
    ducted: CatalogDuctedUnit[] | null;
    errors?: string[];
  } | null;
  selectedSystemTypes: string[];
  optimizationWeights: OptimizationWeights;
  activeTab: 'comparison' | 'optimizer' | 'static-pressure' | 'schedule' | 'air-distribution';
  activePreview: DeploymentPreview | null;
  undoStack: WorkspaceSnapshot[];
  redoStack: WorkspaceSnapshot[];
  
  // Actions
  setProject: (meta: Partial<ProjectMetadata>) => void;
  setDrawMode: (mode: 'select' | 'polyline' | 'pan') => void;
  addZone: (points: number[]) => void;
  updateZone: (id: string, updates: Partial<Zone>) => void;
  deleteZone: (id: string) => void;
  selectZone: (id: string | null) => void;
  addTempPoint: (x: number, y: number) => void;
  clearTempPoints: () => void;
  setDxfData: (entities: DxfEntity[], bbox: BoundingBox) => void;
  clearDxfData: () => void;
  /** Import parsed CAD: stores the raw data and the normalised canvas entities. */
  setCadData: (raw: RawCad) => void;
  /** Calibrate: feet per drawing unit (undefined = back to INSUNITS/heuristic). Design geometry follows the drawing. */
  calibrateCad: (feetPerUnit: number | undefined) => void;
  setDxfLayerColor: (layerName: string, color: string | undefined) => void;
  setDxfLayerVisibility: (layerName: string, visible: boolean) => void;
  toggleAllDxfLayers: (visible: boolean) => void;
  setAnnotationVisibility: (key: keyof AnnotationVisibility, visible: boolean) => void;
  toggleAllAnnotations: (visible: boolean) => void;
  loadDemoSystems: () => void;
  setLoadedCatalogs: (catalogs: { decorative: CatalogDecorativeSet | null; ducted: CatalogDuctedUnit[] | null; errors?: string[] } | null) => void;
  setSelectedSystemTypes: (types: string[]) => void;
  setOptimizationWeights: (weights: Partial<OptimizationWeights>) => void;
  setActiveTab: (tab: 'comparison' | 'optimizer' | 'static-pressure' | 'schedule' | 'air-distribution') => void;
  setPreview: (preview: DeploymentPreview | null) => void;
  applyCandidateTransaction: (candidate: SystemDesignCandidate) => { success: boolean; error?: string };
  undo: () => void;
  redo: () => void;
}

const AUTO_LAYER_COLORS = ['#94a3b8', '#38bdf8', '#34d399', '#fbbf24', '#f87171', '#c084fc', '#f472b6', '#a78bfa', '#4ade80'];

/** Normalise raw CAD at the project's scale/units; preserves layer visibility + colour overrides. */
function normalizeRaw(
  raw: RawCad,
  project: ProjectMetadata,
  overrideFeetPerUnit: number | undefined,
  prevLayers: Record<string, DxfLayerInfo>
): Pick<ProjectState, 'dxfEntities' | 'dxfBoundingBox' | 'dxfLayers' | 'cadRaw' | 'cadCalibration'> {
  const norm = normalizeCadToCanvas(raw.entities, {
    insunits: raw.insunits,
    projectScale: project.scale,
    projectUnits: project.units,
    overrideFeetPerUnit
  });
  const layers: Record<string, DxfLayerInfo> = {};
  let colorIdx = 0;
  for (const ent of norm.entities) {
    const name = ent.layer || '0';
    let l = layers[name];
    if (!l) {
      const prev = prevLayers[name];
      const tableColor = raw.layerColors[name];
      l = layers[name] = {
        name,
        tableColor,
        colorOverride: prev?.colorOverride,
        color: prev?.colorOverride ?? tableColor ?? ent.color ?? AUTO_LAYER_COLORS[colorIdx % AUTO_LAYER_COLORS.length],
        visible: prev ? prev.visible : true,
        count: 0
      };
      colorIdx++;
    }
    l.count++;
  }
  return {
    dxfEntities: norm.entities,
    dxfBoundingBox: norm.bbox,
    dxfLayers: layers,
    cadRaw: raw,
    cadCalibration: {
      needsCalibration: norm.needsCalibration,
      feetPerUnit: norm.feetPerUnit,
      pxPerUnit: norm.pxPerUnit,
      overrideFeetPerUnit,
      warning: norm.warning
    }
  };
}

/** After undo/redo restores a project with a different scale, re-normalise the CAD so it stays registered. */
function restoredCad(state: ProjectState, project: ProjectMetadata): Partial<ProjectState> {
  if (!state.cadRaw) return {};
  const a = pxPerFt(state.project.scale, state.project.units);
  const b = pxPerFt(project.scale, project.units);
  if (Math.abs(a / b - 1) < 1e-6) return {};
  return normalizeRaw(state.cadRaw, project, state.cadCalibration?.overrideFeetPerUnit, state.dxfLayers);
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
  cadRaw: null,
  cadCalibration: null,
  annotationVisibility: DEFAULT_ANNOTATION_VISIBILITY,
  loadedCatalogs: null,
  selectedSystemTypes: ['concealed', 'cassette', 'high-wall', 'vrf', 'packaged', 'ahu'],
  optimizationWeights: DEFAULT_OPTIMIZATION_WEIGHTS,
  activeTab: 'optimizer',
  activePreview: null,
  undoStack: [],
  redoStack: [],

  setProject: (meta) => set((state) => {
    const project = { ...state.project, ...meta };
    if (meta.scale === undefined && meta.units === undefined) return { project };
    const oldK = pxPerFt(state.project.scale, state.project.units);
    const newK = pxPerFt(project.scale, project.units);
    const factor = newK / oldK;
    if (!Number.isFinite(factor) || Math.abs(factor - 1) < 1e-6) return { project };
    // Keep drawing and design registered: scale the design px and re-normalise the CAD from raw.
    const patch: Partial<ProjectState> = {
      project,
      zones: rescaleProjectGeometry(state.zones, factor),
      tempPoints: state.tempPoints.map((v) => v * factor),
      activePreview: null
    };
    if (state.cadRaw) Object.assign(patch, normalizeRaw(state.cadRaw, project, state.cadCalibration?.overrideFeetPerUnit, state.dxfLayers));
    return patch;
  }),
  
  setDrawMode: (mode) => set({ drawMode: mode, tempPoints: [] }),
  
  addZone: (points) => set((state) => {
    const id = `zone-${Date.now()}`;

    const draftZone: Zone = {
      id,
      name: `Zone ${state.zones.length + 1}`,
      points,
      spaceTypeId: 'office',
      ceilingHeight: 10,
      occupants: 0, // 0 = not user-specified: loadCalc derives it from ASHRAE 62.1 density x area
      systemType: 'concealed',
      diffusers: [],
      ducts: [],
      maxVelocityLimitFpm: 1200,
      maxSpaceNcLimit: 32
    };

    const load = calculateZoneLoad(draftZone, state.project);
    const recommendations = generateSystemCandidates(
      load.totalLoad,
      load.sensibleLoad,
      load.supplyCfm,
      draftZone.spaceTypeId,
      load.area,
      state.project.units === 'imperial',
      state.optimizationWeights,
      state.selectedSystemTypes,
      state.loadedCatalogs
    );

    // Deploy the first candidate that passes every sizing rule; if none does, keep the
    // closest one (its isValid=false flag and diagnostics travel with it).
    const bestCandidate =
      recommendations.candidates.find((c) => c.isValid) ?? recommendations.candidates[0];
    let newZone = draftZone;

    if (bestCandidate) {
      const manifest = buildDeploymentManifest(
        bestCandidate,
        draftZone,
        state.zones,
        state.project,
        state.dxfEntities,
        state.dxfBoundingBox
      );
      const txResult = executeDeploymentTransaction(manifest, [draftZone]);
      newZone = txResult.updatedZones[0];
    }

    return {
      zones: [...state.zones, newZone],
      selectedZoneId: id
    };
  }),
  
  updateZone: (id, updates) => set((state) => ({
    zones: state.zones.map((z) => (z.id === id ? { ...z, ...updates } : z))
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
  
  clearTempPoints: () => set({ tempPoints: [] }),
  
  setDxfData: (entities, bbox) => {
    const layers: Record<string, DxfLayerInfo> = {};
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

    set({ dxfEntities: entities, dxfBoundingBox: bbox, dxfLayers: layers, cadRaw: null, cadCalibration: null });
  },

  clearDxfData: () => set({ dxfEntities: [], dxfBoundingBox: null, dxfLayers: {}, cadRaw: null, cadCalibration: null }),

  setCadData: (raw) => set((state) => normalizeRaw(raw, state.project, undefined, {})),

  calibrateCad: (feetPerUnit) => set((state) => {
    if (!state.cadRaw) return {};
    const override = feetPerUnit && feetPerUnit > 0 && Number.isFinite(feetPerUnit) ? feetPerUnit : undefined;
    const patch = normalizeRaw(state.cadRaw, state.project, override, state.dxfLayers);
    const oldPx = state.cadCalibration?.pxPerUnit;
    const newPx = patch.cadCalibration?.pxPerUnit;
    const out: Partial<ProjectState> = { ...patch, activePreview: null };
    if (oldPx && newPx && Math.abs(newPx / oldPx - 1) > 1e-9) {
      const factor = newPx / oldPx;
      out.zones = rescaleProjectGeometry(state.zones, factor);
      out.tempPoints = state.tempPoints.map((v) => v * factor);
    }
    return out;
  }),

  setDxfLayerColor: (layerName, color) => set((state) => {
    const l = state.dxfLayers[layerName];
    if (!l) return {};
    return {
      dxfLayers: {
        ...state.dxfLayers,
        [layerName]: { ...l, colorOverride: color, color: color ?? l.tableColor ?? l.color }
      }
    };
  }),

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
    const { updatedZones, success, errorDiagnostic } = executeDeploymentTransaction(manifest, state.zones);

    if (!success) {
      return {
        success: false,
        error: errorDiagnostic?.message || 'Transaction execution failed and was rolled back.'
      };
    }

    set({
      zones: updatedZones,
      undoStack: [...state.undoStack, snapshot],
      redoStack: [],
      activePreview: null
    });

    return { success: true };
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
      description: 'Current State'
    };

    set({
      ...restoredCad(state, previousSnapshot.project),
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
      description: 'Current State'
    };

    set({
      ...restoredCad(state, nextSnapshot.project),
      zones: nextSnapshot.zones,
      selectedZoneId: nextSnapshot.selectedZoneId,
      project: nextSnapshot.project,
      undoStack: [...state.undoStack, currentSnapshot],
      redoStack: newRedoStack,
      activePreview: null
    });
  }
}));
