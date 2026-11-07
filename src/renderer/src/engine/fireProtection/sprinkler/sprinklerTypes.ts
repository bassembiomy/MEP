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
  /**
   * Pipe sizing method. 'schedule-verified' (default): sizes from the NFPA 13 pipe schedule (§28.5 tables), then
   * hydraulically verified and upsized where the supply is short. 'hydraulic': hydraulically calculated sizing
   * (NFPA 13 Ch. 28) — the smallest sizes for which every remote area keeps `minSupplyMarginPsi` below the supply.
   */
  pipeSizing?: 'schedule-verified' | 'hydraulic'
  /** Safety margin kept between the available supply and the demand in hydraulic sizing, psi (default 10). */
  minSupplyMarginPsi?: number
  /** Sprinkler deflector distance below the ceiling, mm (NFPA 13 §10.2.6.1.1: 25–305 mm; default 100). */
  deflectorBelowCeilingMm?: number
}

// ─────────────────────────── Obstructions (NFPA 13-2019 §10.2.7) ───────────────────────────

/** Continuous obstructions (beam, duct, cable tray, pipe) use the beam rule; discrete ones (column, light, other) the
 *  three-times rule; any obstruction wider than 4 ft (1219 mm) needs sprinklers below it. */
export type ObstructionKind = 'beam' | 'duct' | 'cable-tray' | 'pipe' | 'column' | 'light' | 'other'

export interface SprinklerObstruction {
  id: string // OB1
  kind: ObstructionKind
  /** Plan footprint, mm (closed polygon, normally a rectangle). */
  polygon: [number, number][]
  /** Distance from the ceiling to the bottom of the obstruction, mm. */
  bottomBelowCeilingMm: number
  source?: 'detected' | 'drawn'
}

export interface ObstructionLayerMapping {
  layer: string
  kind: ObstructionKind
  /** Default bottom of obstruction below the ceiling for this layer, mm. */
  bottomBelowCeilingMm: number
}

export interface ObstructionResult {
  id: string
  kind: ObstructionKind
  /** Smaller / larger plan dimension of the footprint, mm. */
  widthMm: number
  lengthMm: number
  bottomBelowCeilingMm: number
  /** 'beam' rule (beam-rule table), 'three-times' rule, 'wide' (> 4 ft: sprinklers below) — all NFPA 13-2019 §10.2.7 —
   *  or 'wall' (deeper than the beam table: treated as a wall dividing the area into bays). Verify clause numbers
   *  against the adopted edition. */
  rule: 'beam' | 'three-times' | 'wide' | 'wall'
  /** Minimum horizontal distance required from a ceiling sprinkler to the side of the obstruction, mm. */
  requiredClearanceMm: number
  /** Sprinklers added below the obstruction. */
  headsBelow: string[]
  /** Ceiling sprinklers moved to clear the obstruction. */
  relocatedHeads: string[]
  /** Sprinklers still obstructed after relocation (should be empty). */
  violations: string[]
}

// ─────────────────────────── Design input ───────────────────────────

export type SprinklerSystemType = 'wet' | 'dry' | 'preaction-single' | 'preaction-double' | 'deluge'
export type SprinklerOrientation = 'pendent' | 'upright' | 'dry-pendent' | 'concealed-pendent' | 'sidewall'

/**
 * Sprinkler type chosen by the designer for a protected area (standard-coverage spray sprinklers, NFPA 13 Ch. 9/10).
 * 'sidewall' = standard horizontal sidewall (heads along a wall, NFPA 13 §10.3).
 */
export interface SprinklerHeadSpec {
  kFactor: 5.6 | 8 | 11.2 | 14 | 16.8 | 25.2
  orientation: 'pendent' | 'upright' | 'dry-pendent' | 'concealed-pendent' | 'sidewall'
  response: 'quick' | 'standard'
  /** 135 / 155 (ordinary), 175 / 200 (intermediate), 286 (high) °F. */
  tempRatingF: 135 | 155 | 175 | 200 | 286
}

/** Sprinkler system zone on a floor: one zone control valve assembly (riser connection) and its own piping. */
export interface SprinklerZoneInput {
  id: string // Z1
  name: string
  /** Zone control valve / riser connection location, mm. */
  riser: { x: number; y: number }
}

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
  /** Sprinkler type chosen by the designer; undefined / null = selected automatically from hazard and ceiling. */
  headSpec?: SprinklerHeadSpec | null
  /** System zone (SprinklerFloorInput.zones) serving this area; undefined = the first zone. */
  zoneId?: string
  /** 'detected' from the plan's closed polylines or 'drawn' by the designer on the plan. */
  source?: 'detected' | 'drawn'
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
  /**
   * System zones on this floor (each with its own zone control valve and piping). undefined / empty = one zone
   * 'Z1' named after the floor, at `riser`.
   */
  zones?: SprinklerZoneInput[]
  /** Obstructions to sprinkler discharge on this floor (beams, ducts, cable trays, columns, lights …). */
  obstructions?: SprinklerObstruction[]
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
  zoneId: string
  /** Id of the obstruction this sprinkler is installed below (intermediate level), if any. */
  belowObstruction?: string
  /** Distance the sprinkler was moved from its grid position to clear an obstruction, mm (0 / undefined = not moved). */
  relocatedMm?: number
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
  zoneId: string
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
  zoneId: string
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
  zones: SprinklerZoneResult[]
  obstructions: ObstructionResult[]
  checks: DesignCheck[]
}

export interface SprinklerZoneResult {
  zoneId: string
  name: string
  riser: { x: number; y: number }
  /** Zone control valve assembly tag, e.g. ZCV-L1-Z1. */
  controlValveTag: string
  roomIds: string[]
  headCount: number
  areaFt2: number
  areaM2: number
  /** NFPA 13 §4.4 maximum area per system riser on one floor: 52,000 ft² light/ordinary, 40,000 ft² extra hazard. */
  maxAreaFt2: number
  /** Hydraulic node at the zone control valve ('FC' for the first zone, 'FC-<zoneId>' otherwise). */
  node: string
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
  /** Water supply curve at the source (city test data or fire pump curve + suction), [gpm, psi] points ascending in
   *  flow, for the N^1.85 hydraulic graph; null until known (fire pump not yet selected). */
  supplyCurve: { label: string; points: [number, number][] } | null
  checks: DesignCheck[]
}
