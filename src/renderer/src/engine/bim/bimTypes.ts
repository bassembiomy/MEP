/**
 * Discipline-neutral BIM model used to hand the MEP designs to Revit.
 *
 * Deliverables built from it:
 *  - IFC4 (ISO 16739-1:2018, IFC4 ADD2 TC1 schema 'IFC4') — 3D model linked into Revit with Insert ▸ Link IFC;
 *  - model-space DXF / DWG per storey at true coordinates (mm, no sheet frame) — linked with Insert ▸ Link CAD,
 *    positioning "Auto - Origin to Origin" so it overlays the architectural model / the client's DWG.
 *
 * Coordinates: millimetres, project coordinates = the coordinates of the client's architectural plan after unit
 * conversion (x east, y north), z up from the project ±0.000 (ground floor FFL).
 */

export type Vec3 = [number, number, number]

export type BimSystemKind =
  | 'fire-sprinkler'
  | 'fire-standpipe'
  | 'fire-pump'
  | 'fire-co2'
  | 'fire-extinguisher'
  | 'fire-alarm'
  | 'hvac-supply'
  | 'hvac-return'
  | 'hvac-outdoor-air'
  | 'hvac-equipment'

export interface BimSystem {
  id: string // SYS-SPK-L1-Z1
  name: string
  kind: BimSystemKind
  /** IfcDistributionSystemEnum: FIREPROTECTION, VENTILATION, AIRCONDITIONING, … */
  ifcPredefinedType: string
  /** Display colour 0–1 RGB (written as IfcSurfaceStyle). */
  color: [number, number, number]
}

export interface BimStorey {
  id: string // L1
  name: string
  elevationMm: number
}

export type BimProfile = { shape: 'circle'; diameterMm: number } | { shape: 'rect'; widthMm: number; heightMm: number }

export type BimGeometry =
  /** Straight run (pipe / duct / riser) from start to end, swept profile (outside size). */
  | { kind: 'segment'; start: Vec3; end: Vec3; profile: BimProfile }
  /** Box standing on `origin` (centre of the base), rotated about z. */
  | { kind: 'box'; origin: Vec3; sizeMm: [number, number, number]; rotationDeg: number }
  /** Vertical cylinder standing on `base`. */
  | { kind: 'cylinder'; base: Vec3; diameterMm: number; heightMm: number }

export type BimIfcClass =
  | 'IfcPipeSegment'
  | 'IfcPipeFitting'
  | 'IfcDuctSegment'
  | 'IfcDuctFitting'
  | 'IfcFireSuppressionTerminal'
  | 'IfcAirTerminal'
  | 'IfcValve'
  | 'IfcPump'
  | 'IfcTank'
  | 'IfcUnitaryEquipment'
  | 'IfcAlarm'
  | 'IfcSensor'
  | 'IfcFlowMeter'
  | 'IfcBuildingElementProxy'

export interface BimElement {
  /** Stable key (tag-based) used to derive a deterministic IFC GlobalId. */
  key: string
  tag: string
  name: string
  ifcClass: BimIfcClass
  /** IFC4 predefined type of the class, e.g. SPRINKLER, RIGIDSEGMENT, DIFFUSER, GATE, ENDSUCTION, USERDEFINED. */
  predefinedType: string
  /** ObjectType when predefinedType is USERDEFINED (e.g. 'FIREEXTINGUISHER', 'CO2NOZZLE'). */
  objectType?: string
  storeyId: string
  systemId: string
  geometry: BimGeometry
  /** Written to the property set 'MEP_Design' (tag, size, flow, pressure, K-factor, reference …). */
  properties: Record<string, string | number | boolean>
}

export interface BimModel {
  projectName: string
  projectNumber: string
  /** 'Fire Protection', 'HVAC', or 'MEP' for a combined model. */
  discipline: string
  storeys: BimStorey[]
  systems: BimSystem[]
  elements: BimElement[]
  /** Placement / data gaps the user must know (e.g. schematic placement of the pump room). */
  warnings: string[]
}

/** Where items without plan coordinates in the design are placed in the building (mm, project coordinates). */
export interface FireBimPlacement {
  /** Pump room inner corner (room origin) and rotation about z, degrees. */
  pumpRoom?: { x: number; y: number; floorId: string; rotationDeg: number }
  /** Standpipe riser plan positions by tag (ST-1 …). */
  standpipes?: Record<string, { x: number; y: number }>
  /** Extinguisher zone origins (lower-left corner of the zone rectangle) by zone id. */
  extinguisherZones?: Record<string, { x: number; y: number }>
}

export interface HvacBimOptions {
  storeyId: string
  storeyName: string
  /** Finished floor level of the HVAC plan, mm. */
  elevationMm: number
  /** Drawing units per foot (imperial) or per metre (metric) — ProjectMetadata.scale / units. */
  scale: number
  units: 'imperial' | 'metric'
}

export interface ClashResult {
  a: string // element tag
  b: string
  storeyId: string
  /** Clearance between the two envelopes, mm (negative = interference). */
  clearanceMm: number
  point: Vec3
}
