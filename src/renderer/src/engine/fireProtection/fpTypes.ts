/**
 * Fire Protection (Fire Fighting) — Pump Room & Fire Water Tank Design
 * ---------------------------------------------------------------------
 * Shared type contract for the fire-protection engine, drawing kernel and UI.
 *
 * Unit conventions
 *   - Hydraulics are computed in US customary units (gpm, psi, ft, in) because
 *     NFPA 13/14/20/22 tables are published in those units. Every result that is
 *     shown to the user also carries the SI equivalent (L/min, bar, m, mm).
 *   - All drawing geometry is in millimetres (model space, 1 unit = 1 mm).
 */

// ─────────────────────────────── Enumerations ───────────────────────────────

/** NFPA 13 occupancy hazard classification (NFPA 13-2022 §4.3). */
export type HazardClass = 'light' | 'ordinary-1' | 'ordinary-2' | 'extra-1' | 'extra-2';

/** NFPA 14 standpipe class (NFPA 14-2019 §5.3). */
export type StandpipeClass = 'none' | 'I' | 'II' | 'III';

export type PumpDriver = 'electric' | 'diesel';

/** Fire pump configurations offered by the designer. */
export type PumpArrangement =
  | 'electric+diesel' // duty electric + standby diesel (recommended, no single power dependency)
  | 'electric+electric' // duty + standby electric (requires reliable 2nd source / generator)
  | 'diesel+diesel'
  | 'electric-only'
  | 'diesel-only';

/** NFPA 20 pump types. Vertical turbine is the only type permitted with suction lift (NFPA 20 §7.1). */
export type FirePumpType = 'horizontal-split-case' | 'end-suction' | 'vertical-inline' | 'vertical-turbine';

export type TankMaterial = 'reinforced-concrete' | 'grp-sectional' | 'steel-bolted';

export type TankPlacement = 'underground' | 'ground' | 'elevated-roof';

export type PipeSchedule = 'sch40' | 'sch10';

export type FittingType =
  | 'elbow-90'
  | 'elbow-45'
  | 'long-turn-elbow-90'
  | 'tee-branch' // tee or cross, flow turned 90°
  | 'butterfly-valve'
  | 'gate-valve'
  | 'swing-check'
  | 'alarm-check'
  /** 2½" angle hose valve — equivalent length L/D = 150 (Crane TP-410), not in NFPA 13 table. */
  | 'angle-hose-valve';

/** NFPA 14-2019 §3.3.20 / §5.4 standpipe system types. */
export type StandpipeSystemType = 'automatic-wet' | 'automatic-dry' | 'semiautomatic-dry' | 'manual-wet' | 'manual-dry';

export type CheckStatus = 'pass' | 'warn' | 'fail';

// ─────────────────────────────── Inputs ───────────────────────────────

/** One building level. Elevations in metres relative to ground-floor FFL (±0.000). */
export interface FloorLevel {
  id: string;
  name: string; // "B1", "Ground Floor", "Level 1", "Roof"
  elevationM: number; // finished floor level
  floorToFloorM: number; // height to the next level (roof: parapet / 0)
  usage: string; // occupancy description (for the floor schedule)
  areaM2: number;
  sprinklered: boolean;
  /** Hose connection at this level's main stair landing (NFPA 14 §7.3.2.1). */
  hoseConnection: boolean;
  isRoof: boolean;
}

export interface StandpipeLocation {
  tag: string; // ST-1
  location: string; // "Stair 1 (north core)"
  /** Horizontal run from the riser base to the pump room discharge header, m. */
  horizontalRunToPumpM: number;
  /** The stair served by this standpipe gives access to the roof (roof outlet placed here, NFPA 14 §7.3.2.2). */
  servesRoof: boolean;
}

export interface BuildingInput {
  /** Ordered bottom → top; exactly one `isRoof` level, last. */
  floors: FloorLevel[];
  /** Pump-room FFL relative to ground-floor FFL, m (basement pump room → negative). */
  pumpRoomFloorElevationM: number;
  /** Roof slope < 4 in 12 → roof hose connection required (NFPA 14 §7.3.2.2). */
  roofSlopeLessThan4in12: boolean;
  /** Lowest level of fire-department vehicle access, m (IBC §202 high-rise definition, 75 ft). */
  fireDeptAccessElevationM: number;
}

// ── Portable fire extinguishers (NFPA 10-2022) ──

/** NFPA 10 §5.4 occupancy hazard (light = low, ordinary = moderate, extra = high). */
export type ExtinguisherHazard = 'light' | 'ordinary' | 'extra';

export type ExtinguisherAgent =
  | 'dry-chemical-abc'
  | 'co2'
  | 'water'
  | 'afff'
  | 'clean-agent'
  | 'wet-chemical'
  | 'dry-powder-d';

/** One protected area (room / zone) on a floor. Geometry is a rectangle used for coverage & the schematic plan. */
export interface ExtinguisherZoneInput {
  id: string; // Z1
  name: string; // "Parking", "Electrical Room"
  /** Building floor id (BuildingInput.floors[].id) or a free level label when no building is defined. */
  floorId: string;
  hazard: ExtinguisherHazard;
  lengthM: number;
  widthM: number;
  /** Ordinary combustibles (Class A). */
  classA: boolean;
  /** Flammable liquids: none, spill / shallow (≤ ¼ in) or appreciable depth (> ¼ in, NFPA 10 §6.3.2). */
  classB: 'none' | 'spill' | 'deep';
  /** Largest liquid surface for 'deep', m². */
  deepLayerSurfaceM2: number;
  /** Energized electrical equipment (Class C, §6.4). */
  classC: boolean;
  /** Delicate electronics — dry chemical not used (§5.5 / Annex); CO2 or clean agent only. */
  sensitiveElectronics: boolean;
  /** Combustible metals (Class D, §6.5). */
  classD: boolean;
  dMetal: string;
  /** Class K cooking: number of deep-fat fryers and the largest fry-pot capacity (lb of cooking medium), §6.6. */
  fryers: number;
  maxFryerOilLb: number;
  mounting: 'bracket' | 'cabinet';
}

export interface ExtinguisherDesignInput {
  zones: ExtinguisherZoneInput[];
}

export interface StandpipeDesignInput {
  systemType: StandpipeSystemType;
  /** Standpipes also supply the floor sprinkler systems (combined system, NFPA 14 §3.3.20.1). */
  combinedWithSprinklers: boolean;
  locations: StandpipeLocation[];
  /** Override riser size (in); undefined = NFPA 14 §7.6 minimum. */
  riserSizeIn?: number;
  pipe: { schedule: PipeSchedule; c: number };
  /** Hose valve centre above landing, mm — NFPA 14 §7.3.1.1 requires 900–1500 mm (3–5 ft). */
  hoseValveHeightMm: number;
  /** Distance from the fire department connection to the nearest hydrant, m (NFPA 14 §6.4.5 / IFC §912: ≤ 30.5 m). */
  fdcDistanceToHydrantM: number;
  /** Override number of 2½" FDC inlets; undefined = ⌈demand / 250 gpm⌉, min 2. */
  fdcInlets?: number;
}

export interface PipeSpec {
  /** Nominal pipe size, inches (1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 14, 16). */
  nominalIn: number;
  schedule: PipeSchedule;
  /** Hazen-Williams C. NFPA 13 Table 28.2.4.8.1: black steel wet = 120, dry = 100, CPVC/copper/SS = 150. */
  c: number;
}

export interface PipeRun {
  pipe: PipeSpec;
  lengthFt: number;
  /** Positive = flow travels upward from the downstream (remote) end toward the source. */
  elevationRiseFt: number;
  fittings: Partial<Record<FittingType, number>>;
}

export interface FireDesignInput {
  projectName: string;
  projectNumber: string;
  designer: string;

  // ── Sprinkler system (NFPA 13 density/area method) ──
  hazard: HazardClass;
  /** Optional overrides; when undefined the NFPA 13 Fig. 19.3.3.1.1 curve design point is used. */
  densityGpmFt2?: number;
  designAreaFt2?: number;
  sprinklerK: number; // K-factor gpm/psi^0.5 (5.6, 8.0, 11.2, 14.0, 16.8, 25.2)
  /** Max coverage per sprinkler; undefined = NFPA 13 maximum for the hazard. */
  sprinklerCoverageFt2?: number;
  branchLinePipe: PipeSpec;
  crossMainPipe: PipeSpec;
  /** Riser from the floor cross-main down to the pump room floor (vertical). */
  riser: PipeRun;
  /** Horizontal feed / bulk main from the riser base to the pump discharge header. */
  feedMain: PipeRun;
  /** Inside hose stream allowance added to the pump flow (NFPA 13 Table 19.3.3.1.2). */
  insideHoseGpm: number;
  /** Total hose allowance (inside + outside) used for water storage; undefined = table value. */
  totalHoseAllowanceGpm?: number;
  /** Water supply duration, minutes; undefined = upper value of the NFPA 13 range. */
  durationMin?: number;

  // ── Standpipe system (NFPA 14) ──
  standpipeClass: StandpipeClass;
  standpipeCount: number;
  buildingSprinklered: boolean;
  /** Height from pump centre-line to the hydraulically most remote hose outlet, ft. */
  standpipeTopOutletHeightFt: number;
  /** Friction loss pump → most remote hose outlet at standpipe demand flow, psi. */
  standpipeFrictionPsi: number;

  // ── Pump set ──
  arrangement: PumpArrangement;
  pumpTypePreference: FirePumpType | 'auto';
  /** Rated pressure of system components (175 psi standard, 300 psi high-pressure). */
  systemComponentRatingPsi: number;
  siteElevationFt: number; // for diesel derate
  ambientTempF: number; // for diesel derate
  electricalSupply: { voltage: number; phases: 3; hz: 50 | 60 };

  // ── Water storage tank (NFPA 22) ──
  tankMaterial: TankMaterial;
  tankPlacement: TankPlacement;
  /** Effective water depth above the tank floor (anti-vortex plate level), m. */
  tankEffectiveDepthM: number;
  /** Split the storage into two equal compartments with independent suction (maintenance). */
  twoCompartments: boolean;
  /** Elevation of the tank floor relative to the pump centre-line, m (negative = below pump). */
  tankFloorToPumpCLm: number;
  /** Available refill flow (city/well), gpm — NFPA 22 §14.1.1 requires refill within 8 h. */
  refillFlowGpm: number;

  // ── Building & detailed standpipe design (optional; when both are present the standpipe is
  //    calculated node-to-node per floor and replaces standpipeTopOutletHeightFt / standpipeFrictionPsi,
  //    and the sprinkler riser rise/length is derived from the top sprinklered floor) ──
  building?: BuildingInput;
  standpipeDesign?: StandpipeDesignInput;

  /**
   * Explicit pump set (replaces `arrangement` when present): number of electric-motor centrifugal fire pumps,
   * diesel-engine centrifugal fire pumps (main pumps 1–4 in total; the first is duty, the rest standby — electric
   * pumps first) and jockey (pressure-maintenance) pumps 1–2.
   */
  pumpCounts?: { electric: number; diesel: number; jockey: number };
  /** Fire water tank personnel access: roof manholes with internal ladders ('top', default) or bolted side manways ('side'). */
  tankAccess?: 'top' | 'side';

  /**
   * Automatic sprinkler system designed from the architectural floor plans (NFPA 13). When present its governing
   * remote-area demand replaces the simple density/area sprinkler calculation for the pump sizing.
   */
  sprinklerDesign?: import('./sprinkler/sprinklerTypes').SprinklerDesignInput;

  /** Portable fire extinguisher design (NFPA 10). Optional; when absent result.extinguishers is null. */
  extinguishers?: ExtinguisherDesignInput;
}

// ─────────────────────────────── Hydraulic results ───────────────────────────────

/** One row of an Elite/HASS style node-to-node hydraulic calculation report. */
export interface HydraulicNodeRow {
  fromNode: string;
  toNode: string;
  description: string;
  kFactor?: number;
  /** Flow discharged at the fromNode (sprinkler or branch line). */
  flowAddedGpm: number;
  /** Flow in the pipe segment fromNode → toNode. */
  totalFlowGpm: number;
  nominalIn: number;
  idIn: number;
  c: number;
  lengthFt: number;
  fittingsDesc: string;
  fittingsEqFt: number;
  totalLengthFt: number;
  pfPerFt: number;
  pfPsi: number;
  elevationFt: number;
  pePsi: number;
  /** Total pressure at the fromNode (start of the segment). */
  ptStartPsi: number;
  /** Total pressure at the toNode (end of the segment) = start + Pf + Pe. */
  ptEndPsi: number;
  /** Velocity in the segment, ft/s. */
  velocityFps: number;
}

export interface BranchLineResult {
  headCount: number;
  headFlowsGpm: number[];
  headPressuresPsi: number[];
  totalFlowGpm: number;
  /** Pressure at the branch line inlet (junction with cross-main). */
  inletPressurePsi: number;
  /** Equivalent K of the whole line = Q / √P at inlet. */
  equivalentK: number;
  rows: HydraulicNodeRow[];
}

export interface SprinklerDemandResult {
  densityGpmFt2: number;
  designAreaFt2: number;
  coverageFt2: number;
  spacingFt: number; // S (along branch) = L (between branches)
  sprinklersInArea: number;
  headsPerBranch: number;
  branchLines: number;
  minHeadFlowGpm: number;
  remoteHeadPressurePsi: number;
  sprinklerFlowGpm: number;
  /** Pressure required at the pump discharge flange for the sprinkler demand. */
  pressureAtPumpDischargePsi: number;
  rows: HydraulicNodeRow[];
}

export interface StandpipeDemandResult {
  applicable: boolean;
  flowGpm: number;
  residualPressurePsi: number; // 100 psi Class I/III, 65 psi Class II
  pressureAtPumpDischargePsi: number;
  durationMin: number; // 30
}

export interface StandpipeOutlet {
  standpipeTag: string;
  floorId: string;
  floorName: string;
  /** Hose valve centre elevation (m, relative to ground FFL). */
  elevationM: number;
  sizeIn: number; // 2.5 or 1.5
  isRoofOutlet: boolean;
  /** Flowing in the hydraulic design (two topmost outlets of the governing standpipe). */
  flowing: boolean;
  flowGpm: number;
  /** Static pressure with pumps at churn + max static suction, psi. */
  staticPsi: number;
  /** Residual pressure available at the outlet with the system at demand flow, psi. */
  residualPsi: number;
  prvRequired: boolean;
  /** Outlet pressure setting of the pressure-regulating device, psi (175 for 2½", 100 for 1½"). */
  prvSetPsi: number | null;
}

export interface StandpipeRiserDesign {
  tag: string;
  location: string;
  sizeIn: number;
  bottomElevationM: number; // riser base (lowest floor FFL)
  topElevationM: number; // highest outlet elevation
  horizontalRunToPumpM: number;
  hasRoofOutlet: boolean;
  outlets: StandpipeOutlet[]; // ordered bottom → top
  /** Floor ids with a floor control valve assembly (combined systems, sprinklered floors). */
  floorControlValveFloors: string[];
  /** Pressure required at the pump discharge if this riser were the remote one, psi. */
  requiredPressureAtPumpPsi: number;
}

export interface StandpipeSystemDesign {
  applicable: boolean;
  systemType: StandpipeSystemType;
  standpipeClass: StandpipeClass;
  combined: boolean;
  riserSizeIn: number;
  minRiserSizeIn: number;
  supplyMainSizeIn: number;
  risers: StandpipeRiserDesign[];
  governingRiserTag: string;
  demandFlowGpm: number;
  topOutletResidualPsi: number; // 100 (I/III) or 65 (II)
  pressureAtPumpDischargePsi: number;
  /** Governing riser node-to-node calculation (H → S… → SB → PD). */
  rows: HydraulicNodeRow[];
  pumpCLElevationM: number; // absolute (relative to ground FFL)
  buildingHeightFt: number; // highest occupied floor above FD access
  highRise: boolean; // > 75 ft (IBC §202)
  fdc: { inlets: number; inletSizeIn: number; pipeSizeIn: number; heightAboveGradeMm: number; distanceToHydrantM: number };
  drainRiserIn: number | null; // 3" when PRVs are installed
  mainDrainIn: number; // 2"
  hoseValveHeightMm: number;
  checks: DesignCheck[];
}

export interface ExtinguisherUnitType {
  id: string; // ABC-10
  label: string; // "Multipurpose dry chemical ABC, 10 lb (4.5 kg)"
  agent: ExtinguisherAgent;
  aRating: number; // 0 when not A-rated
  bRating: number; // 0 when not B-rated
  cRated: boolean;
  kRated: boolean;
  dRated: boolean;
  ratingText: string; // "4-A:60-B:C"
  capacity: string; // "10 lb (4.5 kg)"
  grossWeightLb: number;
  heightMm: number;
  wheeled: boolean;
  /** NFPA 10 Table 8.3.1 hydrostatic test interval, years. */
  hydroTestYears: number;
  /** NFPA 10 §7.3.3 internal examination interval (stored-pressure dry chemical: 6 yr), null if n/a. */
  internalExamYears: number | null;
}

export interface PlacedExtinguisher {
  tag: string; // FE-B1-01
  zoneId: string;
  floorId: string;
  unitId: string;
  purpose: 'general' | 'class-k' | 'class-d';
  /** Coverage point relative to the zone origin (lower-left), m. */
  xM: number;
  yM: number;
  /** Max travel distance this unit is placed for, ft (radius drawn on the plan). */
  coverageRadiusFt: number;
  mounting: 'bracket' | 'cabinet' | 'wheeled';
  /** Height of the extinguisher top above floor, mm (NFPA 10 §6.1.3.8). */
  mountingTopMm: number;
  bottomClearanceMm: number;
}

export interface ExtinguisherCandidate {
  unitId: string;
  count: number;
  nx: number;
  ny: number;
  maxTravelFt: number;
}

export interface ExtinguisherZoneDesign {
  zoneId: string;
  zoneName: string;
  floorId: string;
  hazard: ExtinguisherHazard;
  lengthFt: number;
  widthFt: number;
  areaFt2: number;
  /** Class A requirement (null when classA false). */
  minARating: number | null;
  areaPerAFt2: number | null;
  /** Floor area covered by one selected unit = min(rating × areaPerA, 11 250 ft²). */
  maxAreaPerUnitFt2: number | null;
  /** Class B requirement text, e.g. "20-B @ 50 ft or 10-B @ 30 ft (spill)". */
  bRequirement: string | null;
  minBRating: number | null;
  /** Governing max travel distance for the general units, ft. */
  maxTravelFt: number;
  selectedUnitId: string | null;
  count: number;
  grid: { nx: number; ny: number };
  /** Worst direct distance from any point of the zone to the nearest unit, ft (= half cell diagonal). */
  maxTravelActualFt: number;
  kUnits: number;
  dUnits: number;
  candidates: ExtinguisherCandidate[];
  extinguishers: PlacedExtinguisher[];
  notes: string[];
  checks: DesignCheck[];
}

export interface ExtinguisherSystemDesign {
  catalog: ExtinguisherUnitType[];
  zones: ExtinguisherZoneDesign[];
  /** Quantity per unit type (only types used), ordered by catalog order. */
  totals: { unitId: string; label: string; ratingText: string; qty: number }[];
  totalCount: number;
  floorsCovered: string[];
  /** Occupied (non-roof) building floors without any extinguisher. */
  floorsMissing: string[];
  checks: DesignCheck[];
}

export interface SystemDemand {
  sprinkler: SprinklerDemandResult;
  standpipe: StandpipeDemandResult;
  hoseAllowanceInsideGpm: number;
  hoseAllowanceTotalGpm: number;
  durationMin: number;
  /** Governing demand at the pump discharge flange. */
  pumpDemandFlowGpm: number;
  pumpDemandPressurePsi: number;
  governingCase: 'sprinkler' | 'standpipe';
  /** Required effective storage, US gal. */
  requiredStorageGal: number;
}

// ─────────────────────────────── Pump selection ───────────────────────────────

export interface PumpCurvePoint {
  percentFlow: number;
  flowGpm: number;
  netPressurePsi: number;
  bhp: number;
  efficiency: number;
}

export interface PumpSizeTableRow {
  ratedGpm: number;
  suctionIn: number;
  dischargeIn: number;
  reliefValveIn: number;
  reliefDischargeIn: number;
  meterDeviceIn: number;
  hoseValves: number; // number of 2½" hose valves on test header
  hoseHeaderSupplyIn: number;
}

export interface FirePumpSelection {
  tag: string; // FP-1, FP-2
  driver: PumpDriver;
  role: 'duty' | 'standby';
  pumpType: FirePumpType;
  ratedFlowGpm: number;
  ratedNetPressurePsi: number;
  ratedHeadFt: number;
  speedRpm: number;
  churnPressurePsi: number;
  pressureAt150Psi: number;
  curve: PumpCurvePoint[];
  maxBhp: number;
  /** Electric: NEMA motor nameplate HP. Diesel: listed engine HP after derate. */
  driverHp: number;
  driverKw: number;
  dieselDeratePercent?: number;
  fuelTankGal?: number;
  fuelTankLiters?: number;
  sizes: PumpSizeTableRow;
  circulationReliefIn: number | null; // null when not required
  controller: ControlPanelSpec;
}

export interface JockeyPumpSelection {
  tag: string; // JP-1
  ratedFlowGpm: number;
  ratedNetPressurePsi: number;
  motorHp: number;
  pipeSizeIn: number;
  controller: ControlPanelSpec;
}

export interface PressureSetpoints {
  jockeyStopPsi: number;
  jockeyStartPsi: number;
  dutyStartPsi: number;
  standbyStartPsi: number;
  minRunTimerElectricMin: number; // 10
  minRunTimerDieselMin: number; // 30
}

export interface ControlPanelSpec {
  tag: string; // FPC-1, FPC-2, JPC-1, ATS-1
  kind: 'electric-fire-pump-controller' | 'diesel-fire-pump-controller' | 'jockey-pump-controller' | 'transfer-switch';
  description: string;
  startingMethod?: string;
  listing: string; // e.g. "UL 218 / FM 1321"
  widthMm: number;
  depthMm: number;
  heightMm: number;
  mounting: 'floor' | 'wall';
}

export interface ReliefValveSpec {
  required: boolean;
  sizeIn: number;
  dischargeIn: number;
  setPressurePsi: number;
  reason: string;
}

export interface PumpSetSelection {
  mainPumps: FirePumpSelection[];
  /** First jockey pump (kept for compatibility) — same object as jockeys[0]. */
  jockey: JockeyPumpSelection;
  /** All jockey pumps (1–2): JP-1 duty, JP-2 standby. */
  jockeys: JockeyPumpSelection[];
  setpoints: PressureSetpoints;
  mainReliefValve: ReliefValveSpec;
  suctionPressureMinPsi: number; // at 150 % flow, at low water level
  maxStaticSuctionPsi: number;
  suctionVelocityAt150Fps: number;
  maxSystemPressurePsi: number; // churn + max static suction
  testHeaderIn: number;
  testHeaderHoseValves: number;
  flowMeterIn: number;
  checks: DesignCheck[];
}

// ─────────────────────────────── Tank ───────────────────────────────

export interface SumpPitDesign {
  suctionPipeIn: number;
  suctionPipeOdMm: number;
  vortexPlateMm: number; // square plate side (≥ 2D)
  inletAboveSumpFloorMm: number; // D/2, min 150 mm
  pitLengthMm: number;
  pitWidthMm: number;
  pitDepthMm: number; // below tank floor
  /** Drop of the turned-down suction elbow: pipe CL → open end (≈ 1.0 × OD). */
  elbowDropMm: number;
  /** Horizontal distance from the inner face of the tank wall to the plate / inlet centre. */
  plateCentreFromWallMm: number;
  /** Suction pipe centre-line below the tank floor (= tankFloorToPumpCLm × 1000). */
  suctionCLBelowTankFloorMm: number;
}

export interface TankDesign {
  material: TankMaterial;
  placement: TankPlacement;
  requiredEffectiveGal: number;
  requiredEffectiveM3: number;
  providedEffectiveM3: number;
  compartments: number;
  /** Internal clear dimensions. */
  internalLengthM: number;
  internalWidthM: number;
  effectiveDepthM: number;
  freeboardM: number; // overflow invert → underside of roof
  overflowAboveEffectiveM: number; // TWL margin between effective level and overflow
  totalInternalHeightM: number;
  wallThicknessMm: number;
  floorThicknessMm: number;
  roofThicknessMm: number;
  /** Levels relative to tank internal floor (m). */
  levels: { lowWaterM: number; effectiveTopM: number; overflowM: number; topWaterM: number; roofSoffitM: number };
  sump: SumpPitDesign;
  connections: { name: string; sizeIn: number; note: string }[];
  materialSpec: string[];
  refillHours: number;
  access: TankAccessDesign;
  checks: DesignCheck[];
}

// ─────────────────────────────── Pump room layout ───────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedEquipment {
  tag: string;
  kind: 'fire-pump' | 'jockey-pump' | 'controller' | 'fuel-tank' | 'transfer-switch' | 'drain-pit';
  /** Plan footprint in room coordinates (mm, origin = inner corner at tank-side wall, south). */
  rect: Rect;
  /** Concrete housekeeping pad (fire pumps only). */
  pad?: Rect;
  suctionNozzle?: { x: number; y: number; sizeIn: number };
  dischargeNozzle?: { x: number; y: number; sizeIn: number };
  label: string;
}

export interface PipeSegment2D {
  id: string;
  service: 'suction' | 'discharge' | 'test' | 'relief' | 'jockey' | 'drain' | 'sensing' | 'fuel' | 'exhaust';
  sizeIn: number;
  points: [number, number][];
}

export type ValveKind =
  | 'os&y-gate'
  | 'butterfly'
  | 'check'
  | 'relief'
  | 'circulation-relief'
  | 'flow-meter'
  | 'pressure-gauge'
  | 'eccentric-reducer'
  | 'concentric-increaser'
  | 'hose-valve'
  | 'ball-valve'
  | 'flexible-coupling'
  | 'tamper-switch'
  /** NFPA 20 sensing-line check valve with 3/32" orifice in the clapper. */
  | 'sensing-check';

export interface PlacedValve {
  tag: string;
  kind: ValveKind;
  sizeIn: number;
  x: number;
  y: number;
  /** Direction of the pipe run through the valve, degrees (0 = +x). */
  angleDeg: number;
  service: PipeSegment2D['service'];
}

export interface TrenchDesign {
  widthMm: number;
  depthStartMm: number;
  depthEndMm: number;
  slopePercent: number;
  lengthMm: number;
  path: [number, number][];
  capacityGpm: number;
  designInflowGpm: number;
  grating: string;
  outlet: { x: number; y: number; pitMm: number; drainIn: number };
}

/** A pipe passing through a wall: puddle flange in the water-retaining tank wall, sleeve + seal elsewhere. */
export interface WallPenetration {
  tag: string; // PF-01 (puddle flange) / WS-01 (wall sleeve)
  service: PipeSegment2D['service'];
  sizeIn: number;
  /** 'west' = common wall with the fire water tank. */
  wall: 'west' | 'north' | 'south' | 'east';
  /** Centre of the penetration on the wall centre-line (room coordinates, mm). */
  x: number;
  y: number;
  /** Pipe centre-line elevation above pump-room FFL, m. */
  elevationM: number;
  kind: 'puddle-flange' | 'sleeve-seal';
  /** Puddle flange outside diameter = pipe OD + 200 mm (rounded up to 10 mm); 0 for sleeves. */
  puddleFlangeOdMm: number;
  /** Sleeve inside diameter = pipe OD + 50 mm (rounded up to 10 mm); 0 for puddle flanges. */
  sleeveIdMm: number;
  note: string;
}

/** NFPA 20 pressure sensing line: one per controller, ½" brass / copper / SS, two check valves with 3/32" orifice ≥ 1.5 m apart. */
export interface SensingLine {
  pumpTag: string; // FP-1 / JP-1
  controllerTag: string; // FPC-1 / JPC-1
  sizeIn: number; // 0.5
  material: string;
  /** From the tap (between the pump discharge check valve and the discharge isolation valve) to the controller. */
  points: [number, number][];
  checkValves: { x: number; y: number }[]; // exactly 2
  checkValveSpacingMm: number; // along the line, ≥ 1500
  lengthMm: number;
}

/** Pump-room drainage sump pit with duplex submersible sump pumps (IPC §712). */
export interface DrainageSumpDesign {
  required: boolean; // pump-room floor below grade → pumped; at grade → gravity drain
  tag: string; // DS-1
  rect: Rect; // pit plan (room coordinates)
  pitDepthMm: number;
  inflowGpm: number;
  pumps: { tag: string; flowGpm: number; headFt: number; motorHp: number; type: string }[]; // SP-1 duty, SP-2 standby
  dischargeSizeIn: number;
  /** Levels above pit floor, mm: pumps off, lead on, lag on, high-level alarm. */
  levels: { offMm: number; leadOnMm: number; lagOnMm: number; alarmMm: number };
  workingVolumeGal: number;
  cycleMinutes: number;
  dischargeTo: string;
  controls: string[];
  checks: DesignCheck[];
}

export interface TankAccessDesign {
  kind: 'top' | 'side';
  /** One per compartment; tank-internal coordinates (mm) from the internal corner at the pump-room wall / south. */
  openings: { compartment: number; x: number; y: number; sizeMm: number; label: string }[];
  ladder: 'internal' | 'none';
  note: string;
}

export interface PumpRoomLayout {
  /** Internal clear room size. */
  lengthMm: number; // along x (away from tank wall)
  widthMm: number; // along y
  clearHeightMm: number;
  wallThicknessMm: number;
  fireRatingHours: 1 | 2;
  equipment: PlacedEquipment[];
  pipes: PipeSegment2D[];
  valves: PlacedValve[];
  trench: TrenchDesign;
  doors: { x: number; y: number; widthMm: number; wall: 'east' | 'north' | 'south' }[];
  louvers: { x: number; y: number; widthMm: number; wall: 'east' | 'north' | 'south'; purpose: string }[];
  /** Elevations in metres relative to pump-room finished floor level (FFL ±0.00). */
  elevations: { roomFloorM: number; padTopM: number; pumpCLM: number; tankFloorM: number; highLevelPipeM: number; roofSoffitM: number };
  /** Y coordinate (room mm) of the suction centre-line of each main pump, in mainPumps order. */
  suctionLineY: number[];
  /** X coordinate (room mm) of the discharge header centre-line. */
  headerX: number;
  /** Point where the system discharge main leaves the room. */
  systemOutlet: { x: number; y: number; sizeIn: number };
  penetrations: WallPenetration[];
  sensingLines: SensingLine[];
  drainageSump: DrainageSumpDesign;
  checks: DesignCheck[];
}

// ─────────────────────────────── Checks & aggregate ───────────────────────────────

export interface DesignCheck {
  id: string;
  title: string;
  reference: string; // e.g. "NFPA 20-2022 §4.14.3.1"
  status: CheckStatus;
  detail: string;
}

export interface FireDesignResult {
  input: FireDesignInput;
  demand: SystemDemand;
  pumps: PumpSetSelection;
  tank: TankDesign;
  room: PumpRoomLayout;
  /** Present when input.building and input.standpipeDesign are given and standpipeClass !== 'none'. */
  standpipe: StandpipeSystemDesign | null;
  /** Present when input.extinguishers is given. */
  extinguishers: ExtinguisherSystemDesign | null;
  /** Present when input.sprinklerDesign is given. */
  sprinklers: import('./sprinkler/sprinklerTypes').SprinklerSystemDesign | null;
  checks: DesignCheck[]; // all checks concatenated
  standardsReferences: { code: string; edition: string; scope: string }[];
}
