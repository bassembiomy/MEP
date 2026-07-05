import { create } from 'zustand';

export interface Diffuser {
  id: string;
  x: number;
  y: number;
  cfm: number;
  size: string; // e.g. '9"x9"', '12"x12"', '15"x15"', '18"x18"'
}

export interface DuctSegment {
  id: string;
  type: 'trunk' | 'branch' | 'return';
  points: number[]; // [x1, y1, x2, y2]
  widthIn: number;
  heightIn: number;
  cfm: number;
  sizeLabel: string; // e.g. '16"x12"' or '400x300'
}

export interface DxfEntity {
  type: 'LINE' | 'LWPOLYLINE' | 'POLYLINE' | 'CIRCLE' | 'ARC' | 'TEXT' | 'MTEXT';
  points?: number[]; // [x1, y1, x2, y2, ...]
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
  points: number[]; // Polygon vertices [x1, y1, x2, y2, ...]
  spaceTypeId: string;
  ceilingHeight: number; // in feet (imperial) or meters (metric)
  occupants: number;
  lightingOverride?: number; // W/ft² or W/m²
  equipmentOverride?: number; // W/ft² or W/m²
  manualCfmOverride?: number;
  manualCoolingOverride?: number; // Btu/h or Watts
  systemType?: string; // e.g. 'cassette', 'high-wall', 'ducted', 'vrf', etc.
  diffusers: Diffuser[];
  ducts: DuctSegment[];
}

export interface ProjectMetadata {
  name: string;
  location: string;
  scale: number; // pixels per foot (default 10 pixels = 1 foot)
  units: 'imperial' | 'metric';
  outdoorDb: number; // Outdoor design temperature (°F or °C)
  indoorDb: number; // Indoor design temperature (°F or °C)
}

interface ProjectState {
  project: ProjectMetadata;
  zones: Zone[];
  selectedZoneId: string | null;
  drawMode: 'select' | 'polyline' | 'pan';
  tempPoints: number[]; // Points for the polyline currently being drawn
  dxfEntities: DxfEntity[];
  dxfBoundingBox: BoundingBox | null;
  
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
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: {
    name: 'Cairo Commercial Office',
    location: 'Cairo, Egypt',
    scale: 10, // 10 pixels = 1 foot
    units: 'imperial',
    outdoorDb: 95, // 95°F
    indoorDb: 75, // 75°F
  },
  zones: [],
  selectedZoneId: null,
  drawMode: 'select',
  tempPoints: [],
  dxfEntities: [],
  dxfBoundingBox: null,

  setProject: (meta) => set((state) => ({ project: { ...state.project, ...meta } })),
  
  setDrawMode: (mode) => set({ drawMode: mode, tempPoints: [] }),
  
  addZone: (points) => set((state) => {
    const id = `zone-${Date.now()}`;
    const newZone: Zone = {
      id,
      name: `Zone ${state.zones.length + 1}`,
      points,
      spaceTypeId: 'office',
      ceilingHeight: 10, // 10 feet default
      occupants: 1,
      diffusers: [],
      ducts: [],
    };
    return {
      zones: [...state.zones, newZone],
      selectedZoneId: id,
      drawMode: 'select',
    };
  }),
  
  updateZone: (id, updates) => set((state) => ({
    zones: state.zones.map((z) => (z.id === id ? { ...z, ...updates } : z))
  })),
  
  deleteZone: (id) => set((state) => ({
    zones: state.zones.filter((z) => z.id !== id),
    selectedZoneId: state.selectedZoneId === id ? null : state.selectedZoneId
  })),
  
  selectZone: (id) => set({ selectedZoneId: id }),
  
  addTempPoint: (x, y) => set((state) => {
    // Avoid duplicate adjacent clicks
    const len = state.tempPoints.length;
    if (len >= 2 && state.tempPoints[len - 2] === x && state.tempPoints[len - 1] === y) {
      return {};
    }
    return { tempPoints: [...state.tempPoints, x, y] };
  }),
  
  clearTempPoints: () => set({ tempPoints: [] }),
  
  setDxfData: (entities, bbox) => set({ dxfEntities: entities, dxfBoundingBox: bbox }),
  clearDxfData: () => set({ dxfEntities: [], dxfBoundingBox: null })
}));
