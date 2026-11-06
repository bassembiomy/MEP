/**
 * Total-flooding carbon dioxide extinguishing system design (NFPA 12-2022, Ch. 4 & 5) — type contract.
 *
 * Flow: architectural floor plans (DXF, or DWG converted to DXF — same import & room detection as the sprinkler module)
 * → select the protected enclosures and answer the per-enclosure questions (hazard / fire type, height, openings,
 * ventilation, temperature, occupancy) → CO2 quantity per enclosure (flooding factor, MCF, openings, ventilation,
 * temperature) → discharge rate (surface: 1 min; deep-seated: 7 min with 30 % in 2 min) → storage (high-pressure
 * cylinder bank or low-pressure tank, main + reserve) → nozzle layout → pipe network → two-phase pipe flow by the
 * NFPA 12 Annex Y/Z method → nozzle equivalent orifice → venting, safety & accessories → per-floor shop drawings
 * (DXF / DWG) and an HTML design report.
 *
 * Geometry: millimetres (floor-plan coordinates after unit conversion). Calculation: US units (lb, ft³, lb/min,
 * psi, ft, in) with SI shown in reports.
 *
 * The final flow calculation, nozzle drilling and cylinder count of an installed system must be produced with the
 * manufacturer's listed calculation method (NFPA 12 Ch. 4 piping & flow calculation). This tool gives a complete NFPA 12 preliminary design.
 */
import type { DesignCheck } from '../fpTypes'

// ─────────────────────────── Questionnaire ───────────────────────────

export type Co2Storage = 'high-pressure' | 'low-pressure'

export interface Co2Answers {
  /** High-pressure cylinders (≈850 psi at 70 °F) or a refrigerated low-pressure tank (300 psi at 0 °F). */
  storage: Co2Storage
  /** High-pressure cylinder net CO2 capacity, lb (common sizes 50, 75, 100). */
  cylinderLb: 50 | 75 | 100
  /** Connected reserve supply equal to the main supply (NFPA 12 Ch. 4 — required where the AHJ or the protected
   *  occupancy needs the hazard protected again without delay, or where one supply serves several hazards). */
  reserve: boolean
  /** Odorizer in the CO2 (NFPA 12 Ch. 4 safety — required for systems protecting normally unoccupied but occupiable spaces). */
  odorizer: boolean
  /** Detection for automatic operation (NFPA 72): smoke (cross-zoned) or heat. */
  detection: 'smoke-cross-zoned' | 'heat' | 'none-manual'
  /** Pre-discharge time delay, s (minimum 20 s where people may be present). */
  timeDelayS: number
}

// ─────────────────────────── Design input ───────────────────────────

export type Co2FireType = 'surface' | 'deep-seated'

/**
 * Hazard of a protected enclosure.
 * - Surface fires (flammable liquids & gases): minimum design concentration from the material (NFPA 12 Table 5.3.2.2,
 *   never less than 34 %) — key from CO2_MATERIALS.
 * - Deep-seated fires (NFPA 12 Table 5.4.2.1): 'dry-electrical', 'records' (bulk paper, ducts, covered trenches),
 *   'fur-vault' (fur storage vaults, dust collectors).
 */
export type Co2DeepSeatedHazard = 'dry-electrical' | 'records' | 'fur-vault'

export interface Co2EnclosureInput {
  id: string // Z1
  name: string
  /** Room id from room detection (floor plan); the polygon is copied here. */
  roomId: string
  /** Closed polygon, mm, floor coordinates. */
  polygon: [number, number][]
  fireType: Co2FireType
  /** Surface fire: key of CO2_MATERIALS (e.g. 'gasoline', 'methane'); ignored for deep-seated fires. */
  material: string
  /** Deep-seated fire hazard; ignored for surface fires. */
  deepSeated: Co2DeepSeatedHazard
  /** Height from floor to ceiling (or to the underside of the slab where there is no ceiling), m. */
  heightM: number
  /** Volume of solid, impermeable, permanent structures deducted (NFPA 12 Ch. 5), m³. */
  deductionM3: number
  /** Uncloseable openings total area, m² (surface fires: compensated, NFPA 12 Ch. 5). */
  openingsM2: number
  /** Forced ventilation that cannot be shut down at discharge, m³/min (0 = shut down / interlocked). */
  ventilationM3min: number
  /** Normal enclosure temperature, °C (corrections above 93 °C / below −18 °C, NFPA 12 Ch. 5). */
  temperatureC: number
  /** Occupancy: CO2 total flooding is not permitted in normally occupied enclosures (NFPA 12 Ch. 4 safety requirements). */
  occupancy: 'normally-unoccupied' | 'occupiable' | 'normally-occupied'
  /** Allowable enclosure pressure for vent sizing, lb/ft² (light 25, normal 50, vault 100 — NFPA 12 Annex A). */
  strengthPsf: number
}

export interface Co2FloorInput {
  id: string
  name: string
  elevationM: number
  /** Original plan source for the drawings (DXF text after DWG conversion); optional. */
  planDxf?: string
  planUnits?: import('../sprinkler/sprinklerTypes').DrawingUnits
  enclosures: Co2EnclosureInput[]
  /** CO2 storage location (cylinder bank / tank) serving this floor, mm. */
  storage: { x: number; y: number }
}

export interface Co2DesignInput {
  answers: Co2Answers
  floors: Co2FloorInput[]
}

// ─────────────────────────── Results ───────────────────────────

export interface Co2QuantityBreakdown {
  grossVolumeFt3: number
  /** Net volume used for the flooding factor, ft³ (gross − deductions). */
  volumeFt3: number
  designConcentrationPct: number
  /** ft³ of volume per lb of CO2 and its inverse, lb/ft³. */
  floodingFactorFt3PerLb: number
  floodingFactorLbPerFt3: number
  /** Table minimum quantity applied, lb (0 when none). */
  minimumLb: number
  /** Basic quantity = max(V / factor, minimum), lb. */
  basicLb: number
  /** Material conversion factor (surface fires with C > 34 %), 1 otherwise. */
  mcf: number
  openingsLb: number
  ventilationLb: number
  /** Temperature correction, % added. */
  temperatureCorrectionPct: number
  /** Total design quantity for the enclosure, lb. */
  totalLb: number
}

export interface Co2Nozzle {
  tag: string // N-L1-Z1-01
  enclosureId: string
  x: number
  y: number
  node: string
  /** Design flow, lb/min. */
  flowLbMin: number
  /** Terminal (nozzle) pressure from the Y/Z calculation, psi. */
  pressurePsi: number
  /** Required equivalent single-orifice area, in², and the selected NFPA orifice code (diameter in 1/32 in). */
  orificeAreaIn2: number
  orificeCode: number
}

export type Co2PipeKind = 'main' | 'header' | 'branch'

export interface Co2Pipe {
  id: string
  enclosureId: string
  kind: Co2PipeKind
  sizeIn: number
  schedule: 'sch40' | 'sch80'
  points: [number, number][]
  lengthM: number
  /** Equivalent length of fittings / valves, ft. */
  fittingsFt: number
  fromNode: string
  toNode: string
  flowLbMin: number
  /** Pressures at the segment ends, psi. */
  startPsi: number
  endPsi: number
}

export interface Co2FlowRow {
  pipeId: string
  fromNode: string
  toNode: string
  flowLbMin: number
  sizeIn: number
  idIn: number
  lengthFt: number
  fittingsFt: number
  startPsi: number
  endPsi: number
  y1: number
  y2: number
  z1: number
  z2: number
}

export interface Co2EnclosureResult {
  enclosureId: string
  floorId: string
  name: string
  fireType: Co2FireType
  hazardLabel: string
  areaM2: number
  quantity: Co2QuantityBreakdown
  /** Design discharge rate, lb/min, and liquid discharge time, min. */
  rateLbMin: number
  dischargeTimeMin: number
  /** Deep-seated: quantity for 30 % in 2 minutes (lb) — the rate is not less than this / 2. */
  thirtyPctLb: number
  /** Deep-seated: concentration holding (soak) time, min. */
  soakMin: number
  nozzles: Co2Nozzle[]
  /** Pressure relief vent free area, in² and mm² (NFPA 12 Annex A — informative). */
  ventAreaIn2: number
  ventAreaMm2: number
  /** High-pressure: cylinders needed for this enclosure. */
  cylinders: number
  /** Hydraulic flow table from the storage to the most remote nozzle (all segments of the enclosure network). */
  flowRows: Co2FlowRow[]
  minNozzlePressurePsi: number
  checks: DesignCheck[]
}

export interface Co2FloorDesign {
  floorId: string
  floorName: string
  storage: { x: number; y: number }
  enclosures: Co2EnclosureResult[]
  pipes: Co2Pipe[]
  /** Life-safety and control devices placed on the plan. */
  devices: Co2Device[]
  checks: DesignCheck[]
}

export type Co2DeviceKind =
  | 'smoke-detector'
  | 'heat-detector'
  | 'horn-strobe'
  | 'strobe-outside'
  | 'manual-release'
  | 'warning-sign'
  | 'lockout-valve'
  | 'selector-valve'
  | 'pressure-switch'
  | 'pressure-relief-vent'
  | 'control-panel'

export interface Co2Device {
  tag: string
  kind: Co2DeviceKind
  enclosureId: string | null
  x: number
  y: number
  /** Detection zone (cross-zoning A / B) for detectors. */
  zone?: 'A' | 'B'
}

export interface Co2StorageDesign {
  storage: Co2Storage
  /** Largest single-hazard quantity, lb (one supply serving several hazards: sized for the largest, NFPA 12 Ch. 4). */
  governingEnclosureId: string | null
  mainLb: number
  reserveLb: number
  /** High-pressure: cylinder size and main / reserve cylinder counts. */
  cylinderLb: number
  mainCylinders: number
  reserveCylinders: number
  /** Low-pressure: selected standard tank size, US tons (2000 lb). */
  tankTons: number | null
  /** Total installed CO2 mass, lb. */
  installedLb: number
}

export interface Co2Accessory {
  tag: string
  item: string
  qty: number
  sizeIn: number | null
  location: string
  reference: string
}

export interface Co2BomLine {
  item: string
  size: string
  qty: number
  unit: 'ea' | 'm'
}

export interface Co2SystemDesign {
  floors: Co2FloorDesign[]
  storage: Co2StorageDesign
  accessories: Co2Accessory[]
  bom: Co2BomLine[]
  totalNozzles: number
  checks: DesignCheck[]
}
