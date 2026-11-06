/**
 * Automatic sprinkler system design (NFPA 13-2019) — type contract.
 *
 * Flow: architectural floor plans (DXF, or DWG converted to DXF) → floor plan import (units, layers, closed
 * polylines, texts) → room detection → design questionnaire answers + per-room occupancy → sprinkler head
 * layout per room → piping layout (branch lines, cross main, riser connection) → pipe schedule sizing →
 * hydraulic calculation of the most remote design area per floor and system type → accessories / BOM / checks
 * → per-floor shop drawings (DXF / DWG) and an HTML design report.
 *
 * Geometry: millimetres, floor-plan coordinates (+x right, +y up) after unit conversion.
 * Hydraulics: US units (gpm, psi, ft) with SI shown in reports.
 */
import type { DesignCheck, HazardClass, HydraulicNodeRow, PipeSchedule } from '../fpTypes'

// ─────────────────────────── Floor plan import ───────────────────────────

export type DrawingUnits = 'mm' | 'cm' | 'm' | 'in' | 'ft'

export interface FloorPlanEntity {
  kind: 'line' | 'polyline' | 'circle' | 'arc' | 'text'
  layer: string
  /** line: 2 points; polyline: vertices (mm); circle/arc: centre in points[0]. */
  points: [number, number][]
  closed: boolean
  radius?: number
  startDeg?: number
  endDeg?: number
  text?: string
  height?: number
}

export interface FloorPlan {
  /** Units declared by $INSUNITS (or 'unknown') and the units actually used (override or detected). */
  declaredUnits: DrawingUnits | 'unknown'
  units: DrawingUnits
  /** Factor applied to drawing coordinates to obtain millimetres. */
  scaleToMm: number
  entities: FloorPlanEntity[]
  layers: { name: string; count: number; closedPolylines: number }[]
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
  warnings: string[]
}

// ─────────────────────────── Questionnaire ───────────────────────────

export type BuildingType =
  | 'office'
  | 'residential'
  | 'hotel'
  | 'healthcare'
  | 'education'
  | 'mercantile'
  | 'assembly'
  | 'parking'
  | 'storage-low-piled'
  | 'industrial'
  | 'data-center'
  | 'restaurant'
  | 'mixed'

/** Design questionnaire — the answers drive defaults for every floor and room (all editable afterwards). */
export interface SprinklerAnswers {
  buildingType: BuildingType
  /** Areas exposed to temperatures below 4 °C (40 °F) — NFPA 13 §8.2 dry pipe or dry pendent sprinklers. */
  freezingAreas: boolean
  /** Water-damage-sensitive areas (IT, archives, museums) — NFPA 13 §8.3 preaction. */
  waterSensitiveAreas: boolean
  /** Special high hazard needing simultaneous discharge — NFPA 13 §8.3 deluge (open sprinklers). */
  delugeHazard: boolean
  /** Storage higher than 12 ft (3.7 m) — NFPA 13 Ch. 20–25 high-piled storage (outside this tool). */
  highPiledStorage: boolean
  /** Default ceiling: suspended finished ceiling (pendent sprinklers) or exposed structure (upright). */
  ceilingType: 'finished-flat' | 'exposed-structure'
  defaultCeilingHeightM: number
  pipeMaterial:
    'black-steel-sch40' | 'black-steel-sch10' | 'galvanized-steel-sch40' | 'cpvc' | 'copper-type-l'
  /** Seismic design category C–F → bracing per NFPA 13 Ch. 18. */
  seismic: boolean
  /** Water supply for the sprinkler system. */
  supply:
    | { kind: 'fire-pump' }
    | { kind: 'city'; staticPsi: number; residualPsi: number; residualFlowGpm: number }
}

// ─────────────────────────── Design input ───────────────────────────

export type SprinklerSystemType = 'wet' | 'dry' | 'preaction-single' | 'preaction-double' | 'deluge'
export type SprinklerOrientation = 'pendent' | 'upright' | 'dry-pendent' | 'concealed-pendent'

export interface SprinklerRoomInput {
  id: string // R1
  name: string
  /** Closed polygon, mm, floor coordinates (counter-clockwise or clockwise). */
  polygon: [number, number][]
  /** Occupancy key from SPRINKLER_OCCUPANCIES (e.g. 'office', 'parking', 'kitchen'). */
  occupancy: string
  /** Hazard used for design (defaults from the occupancy; may be overridden). */
  hazard: HazardClass
  ceilingHeightM: number
  ceilingType: 'finished-flat' | 'exposed-structure'
  /** Ambient below 4 °C → dry-pendent heads on wet systems or a dry system. */
  freezing: boolean
  /** Near heat sources (kitchens, boiler/plant rooms, skylights) → intermediate-temperature heads (NFPA 13 §9.4.2). */
  heatSource: boolean
  /** Omit sprinklers (only where NFPA 13 §9.2 permits, e.g. noncombustible shafts) — a reason is required. */
  omit: boolean
  omitReason: string
}

export interface SprinklerFloorInput {
  id: string // matches BuildingInput floor ids when a building is defined
  name: string
  /** Finished floor level, m (relative to ground FFL ±0.000). */
  elevationM: number
  /** Original plan source for the drawings (DXF text after DWG conversion); optional. */
  planDxf?: string
  planUnits?: DrawingUnits
  /** Layers whose closed polylines define rooms (used by room detection). */
  roomLayers: string[]
  rooms: SprinklerRoomInput[]
  systemType: SprinklerSystemType
  /** Riser / floor control assembly location on this floor, mm. */
  riser: { x: number; y: number }
  /** Branch lines run along x or y; 'auto' picks the direction giving fewer branch lines. */
  branchDirection: 'x' | 'y' | 'auto'
}

export interface SprinklerDesignInput {
  answers: SprinklerAnswers
  floors: SprinklerFloorInput[]
  /** Pipe size of the building riser feeding the floors and its schedule (default 6", Sch 40). */
  buildingRiserIn: number
  buildingRiserSchedule: PipeSchedule
}

// ─────────────────────────── Results ───────────────────────────

export interface SprinklerHeadType {
  id: string // QR-PEN-K5.6-155
  description: string
  kFactor: number
  orientation: SprinklerOrientation
  response: 'quick' | 'standard'
  tempRatingF: number
  tempClass: 'ordinary' | 'intermediate' | 'high'
  bulbColor: string
  /** Head is open (deluge). */
  open: boolean
}

export interface PlacedSprinkler {
  tag: string // S-L1-001
  floorId: string
  roomId: string
  x: number
  y: number
  headTypeId: string
  /** Protection area dimensions S (along branch) × L (between branches), mm, and area ft². */
  spacingSmm: number
  spacingLmm: number
  areaFt2: number
  /** Shortest distance to the room boundary, mm. */
  wallDistanceMm: number
  /** Hydraulic node id of this sprinkler. */
  node: string
}

export type SprinklerPipeKind = 'branch' | 'cross-main' | 'riser-nipple' | 'feed'

export interface SprinklerPipe {
  id: string
  kind: SprinklerPipeKind
  sizeIn: number
  schedule: PipeSchedule
  /** Single-line route, mm. */
  points: [number, number][]
  lengthM: number
  fromNode: string
  toNode: string
  /** Number of sprinklers supplied through this segment (pipe schedule sizing). */
  sprinklersDownstream: number
}

export interface SprinklerRoomResult {
  roomId: string
  name: string
  hazard: HazardClass
  areaM2: number
  headCount: number
  headTypeId: string
  spacingSmm: number
  spacingLmm: number
  maxSpacingMm: number
  maxAreaFt2: number
  checks: DesignCheck[]
}

export interface RemoteAreaResult {
  floorId: string
  hazard: HazardClass
  densityGpmFt2: number
  /** Design area after adjustments (dry / double-interlock +30 %), ft². */
  designAreaFt2: number
  baseAreaFt2: number
  headsFlowing: string[] // sprinkler tags
  headsPerBranch: number
  minHeadFlowGpm: number
  remoteHeadPressurePsi: number
  rows: HydraulicNodeRow[]
  /** At the floor control assembly (node FC). */
  flowAtFloorGpm: number
  pressureAtFloorPsi: number
  /** At the source (fire pump discharge / city connection, node SRC) incl. building riser and feed main. */
  flowAtSourceGpm: number
  pressureAtSourcePsi: number
  hoseAllowanceGpm: number
  totalDemandGpm: number
  /** Available pressure at the total demand flow from the supply, psi, and margin. */
  availablePsi: number
  marginPsi: number
}

export interface SprinklerFloorDesign {
  floorId: string
  floorName: string
  systemType: SprinklerSystemType
  heads: PlacedSprinkler[]
  pipes: SprinklerPipe[]
  rooms: SprinklerRoomResult[]
  riser: { x: number; y: number }
  /** Inspector's test / auxiliary test connection at the hydraulically most remote point. */
  inspectorTest: { x: number; y: number }
  hangers: { x: number; y: number; pipeId: string }[]
  /** Water capacity of the floor piping, US gal. */
  volumeGal: number
  remoteAreas: RemoteAreaResult[]
  governing: RemoteAreaResult | null
  checks: DesignCheck[]
}

export interface SprinklerAccessory {
  tag: string
  item: string
  qty: number
  sizeIn: number | null
  location: string
  systemType: SprinklerSystemType | 'all'
  reference: string
}

export interface SprinklerBomLine {
  item: string
  size: string
  qty: number
  unit: 'ea' | 'm'
}

export interface SprinklerSystemDesign {
  headTypes: SprinklerHeadType[]
  floors: SprinklerFloorDesign[]
  /** Governing floor / remote area of the whole building (highest pressure at the source). */
  governing: RemoteAreaResult | null
  accessories: SprinklerAccessory[]
  spareHeads: { headTypeId: string; qty: number }[]
  bom: SprinklerBomLine[]
  totalHeads: number
  /** Items outside this tool's scope (e.g. high-piled storage) that need separate design. */
  outOfScope: string[]
  checks: DesignCheck[]
}
