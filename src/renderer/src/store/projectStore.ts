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
  type: 'LINE' | 'LWPOLYLINE' | 'POLYLINE' | 'CIRCLE' | 'ARC' | 'TEXT' | 'MTEXT';
  points?: number[];
  x?: number;
  y?: number;
  radius?: number;
  text?: string;
  color?: string;
  layer?: string;
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
  systemType?: 'high-wall' | 'cassette' | 'concealed' | 'packaged' | 'vrf' | 'ahu';
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
  outdoorUnitPos?: { x: number; y: number };
  catalogQty?: number;
  catalogModel?: string;
  catalogEsp?: string;
}

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
  loadedCatalogs: {
    decorative: { highWall: any[]; cassette: any[] } | null;
    ducted: any[] | null;
    errors?: string[];
  } | null;
  selectedSystemTypes: string[];
  optimizationWeights: OptimizationWeights;
  activeTab: 'comparison' | 'optimizer' | 'static-pressure' | 'schedule';
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
  loadDemoSystems: () => void;
  setLoadedCatalogs: (catalogs: { decorative: { highWall: any[]; cassette: any[] } | null; ducted: any[] | null; errors?: string[] } | null) => void;
  setSelectedSystemTypes: (types: string[]) => void;
  setOptimizationWeights: (weights: Partial<OptimizationWeights>) => void;
  setActiveTab: (tab: 'comparison' | 'optimizer' | 'static-pressure' | 'schedule') => void;
  setPreview: (preview: DeploymentPreview | null) => void;
  applyCandidateTransaction: (candidate: SystemDesignCandidate) => { success: boolean; error?: string };
  undo: () => void;
  redo: () => void;
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
  loadedCatalogs: null,
  selectedSystemTypes: ['concealed', 'cassette', 'high-wall', 'vrf', 'packaged', 'ahu'],
  optimizationWeights: DEFAULT_OPTIMIZATION_WEIGHTS,
  activeTab: 'optimizer',
  activePreview: null,
  undoStack: [],
  redoStack: [],

  setProject: (meta) => set((state) => ({ project: { ...state.project, ...meta } })),
  
  setDrawMode: (mode) => set({ drawMode: mode, tempPoints: [] }),
  
  addZone: (points) => set((state) => {
    const id = `zone-${Date.now()}`;

    const draftZone: Zone = {
      id,
      name: `Zone ${state.zones.length + 1}`,
      points,
      spaceTypeId: 'office',
      ceilingHeight: 10,
      occupants: 1,
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

    const bestCandidate = recommendations.candidates[0];
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
      selectedZoneId: id,
      drawMode: 'select',
      activePreview: null
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
  
  setDxfData: (entities, bbox) => set({ dxfEntities: entities, dxfBoundingBox: bbox }),
  clearDxfData: () => set({ dxfEntities: [], dxfBoundingBox: null }),

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
      zones: nextSnapshot.zones,
      selectedZoneId: nextSnapshot.selectedZoneId,
      project: nextSnapshot.project,
      undoStack: [...state.undoStack, currentSnapshot],
      redoStack: newRedoStack,
      activePreview: null
    });
  }
}));
