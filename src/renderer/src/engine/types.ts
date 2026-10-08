/**
 * Canonical Data Types and Interfaces for MEP HVAC System Designer
 */

export interface EquipmentCapabilities {
  supportsDuctNetwork: boolean;            // True for Concealed Ducted, Packaged RTU, AHU
  supportsExternalDiffusers: boolean;      // True if external supply diffusers can be connected
  supportsReturnDuct: boolean;             // True for ducted return air systems
  supportsMultipleZones: boolean;          // True for VRF, Multi-Split, Central AHU
  requiresIndoorUnitSelection: boolean;    // True for VRF / Split DX systems
  hasExternalStaticPressure: boolean;      // True if equipment fan can overcome external duct/fitting resistance
}

export interface EfficiencyRatings {
  eer?: number;
  seer?: number;
  seer2?: number;
  copCooling?: number;
  copHeating?: number;
  iplv?: number;
  ratingStandard: string;
  ratingConditions: string;
}

export interface FanOperatingPoint {
  cfm: number;
  espInWg: number;
  powerKw?: number;
  rpm?: number;
  soundDba?: number;
}

export interface FanPerformanceData {
  type: 'tabular' | 'multi-speed' | 'curve-coefficients' | 'constant-cfm-envelope';
  table?: FanOperatingPoint[];
  speeds?: { [speedName: string]: FanOperatingPoint[] };
  coefficients?: { a: number; b: number; c: number; maxEsp: number; minCfm: number; maxCfm: number };
  allowExtrapolation: boolean;
}

export interface EquipmentCatalogItem {
  id: string;
  manufacturer: string;
  model: string;
  systemType: 'concealed' | 'cassette' | 'high-wall' | 'packaged' | 'vrf' | 'ahu' | 'fcu';
  capabilities: EquipmentCapabilities;
  nominalTons: number;
  totalCapacityBtuPerHour: number;
  sensibleCapacityBtuPerHour: number;
  heatingCapacityBtuPerHour?: number;
  nominalCfm: number;
  minCfm: number;
  maxCfm: number;
  maxRatedEspInWg: number;
  fanPerformance: FanPerformanceData;
  electricalKw: number;
  efficiency: EfficiencyRatings;
  soundDba: number;
  dimensionsIn: { width: number; depth: number; height: number };
  connectionSizes: { supplyDuct?: string; returnDuct?: string; liquidLine?: string; gasLine?: string };
  costIndex: number; // Relative equipment cost rating (0-100)
  provenance: { source: string; version: string; isUserImported: boolean; isDemonstrationOnly?: boolean };
}

export interface DiffuserPerformancePoint {
  cfm: number;
  deltaPInWg: number;
  ncRating: number;
  throwFt: { t50: number; t100: number; t150: number };
}

export interface DiffuserCatalogItem {
  id: string;
  manufacturer: string;
  model: string;
  terminalType:
    | 'square-ceiling'
    | 'round-ceiling'
    | 'linear-slot'
    | 'swirl'
    | 'sidewall-grille'
    | 'return-grille'
    | 'exhaust-grille'
    | 'jet-nozzle'
    | 'louver'
    | 'sand-trap-louver';
  neckSizeIn: { width: number; height: number; diameter?: number };
  faceSizeIn: { width: number; height: number };
  minCfm: number;
  maxCfm: number;
  performanceTable: DiffuserPerformancePoint[];
  costIndex: number;
  provenance: { source: string; version: string; isDemonstrationOnly?: boolean };
}

export interface DuctTypeItem {
  id: string;
  name: string;
  shape: 'rectangular' | 'round' | 'oval' | 'flex';
  material: 'galvanized-steel' | 'aluminum' | 'flexible-aluminum' | 'fabric';
  roughnessFt: number; // Absolute roughness in feet (e.g. 0.0003 ft for galvanized)
  maxRecommendedVelocityFpm: number;
  maxFrictionRateInWgPer100Ft: number;
  costFactorPerFt: number;
  insulationRValue: number;
}

export interface FittingLossDefinition {
  type:
    | 'elbow-90-vaned'
    | 'elbow-90-unvaned'
    | 'elbow-45'
    | 'branch-tee'
    | 'reducer'
    | 'boot-transition'
    | 'fire-damper'
    | 'smoke-damper'
    | 'combination-fire-smoke-damper'
    | 'ceiling-radiation-damper'
    | 'balancing-damper'
    | 'volume-control-damper'
    | 'backdraft-damper'
    | 'filter-merv8'
    | 'filter-merv13'
    | 'silencer';
  name: string;
  lossCoefficientK: number; // K-factor referenced to local cross-section velocity pressure
  fixedLossInWg?: number;
}

export interface Nfpa90aStandardRule {
  id: string;
  section: string;
  category:
    | 'smoke-detection'
    | 'fire-damper'
    | 'smoke-damper'
    | 'ceiling-radiation-damper'
    | 'flexible-duct'
    | 'plenum-corridor'
    | 'egress';
  title: string;
  description: string;
  thresholdValue?: number;
  thresholdUnit?: string;
  mandatoryRequirement: string;
  actionOnTrigger: string;
  standardReference: string;
}

export interface DamperSpecification {
  id: string;
  manufacturer: string;
  model: string;
  type:
    | 'fire-damper'
    | 'smoke-damper'
    | 'combination-fire-smoke-damper'
    | 'ceiling-radiation-damper'
    | 'volume-control-damper'
    | 'backdraft-damper';
  fireRatingHours?: number;
  leakageClass?: 'Class I' | 'Class II' | 'Class III';
  temperatureRatingF?: number;
  fusibleLinkTempF?: number;
  maxVelocityFpm: number;
  maxPressureInWg: number;
  lossCoefficientK: number;
  bladeType: 'curtain' | '3V' | 'airfoil';
  dimensionsAvailable?: { minIn: number; maxIn: number };
  provenance: { source: string; version: string };
}

export interface DuctAccessoryItem {
  id: string;
  type:
    | 'fire-damper'
    | 'smoke-damper'
    | 'combination-fire-smoke-damper'
    | 'volume-control-damper'
    | 'duct-smoke-detector'
    | 'sound-attenuator'
    | 'ceiling-radiation-damper';
  tag: string;
  position: { x: number; y: number };
  widthIn: number;
  heightIn: number;
  deltaPInWg: number;
  cadSymbol: string;
  standardReference?: string;
  actionOnTrigger?: string;
}

export interface PressureLossSegment {
  id: string;
  type: 'straight-duct' | 'fitting' | 'diffuser' | 'grille' | 'accessory';
  name: string;
  cfm: number;
  velocityFpm: number;
  velocityPressureInWg: number;
  lengthFt?: number;
  lossCoefficientK?: number;
  deltaPInWg: number;
  cumulativePInWg: number;
}

export interface CriticalPathResult {
  pathId: string;
  terminalId: string;
  supplySegments: PressureLossSegment[];
  returnSegments: PressureLossSegment[];
  totalSupplyDeltaPInWg: number;
  totalReturnDeltaPInWg: number;
  diffuserDeltaPInWg: number;
  accessoriesDeltaPInWg: number;
  totalLossInWg: number;
  marginInWg: number;
  espRequiredInWg: number;
}

export interface FanOperatingPointResult {
  isValid: boolean;
  operatingCfm: number;
  operatingEspInWg: number;
  fanMarginInWg: number;
  percentageOverDesignCfm: number;
  powerKwEstimate: number;
  warningMessages: string[];
}

export interface BranchBalancingItem {
  branchId: string;
  terminalId: string;
  branchFlowCfm: number;
  branchResistanceInWg: number;
  pressureDeficitInWg: number; // Amount of static pressure needed to be throttled by balancing damper
  recommendedDamperSetting: string; // e.g. "Throttle 0.04 in.wg"
}

export interface OptimizationWeights {
  wComfort: number;   // Thermal & throw distribution uniformity
  wEnergy: number;    // Equipment SEER/COP and fan power
  wCost: number;      // Equipment and ductwork capital cost
  wNoise: number;     // Sound criteria margin below threshold
  wPressure: number;  // Aerodynamic fan margin and low resistance
  wSpace: number;     // Plenum height clearance
  wPreference: number;// User system type affinity
}

export interface Subscores {
  sComfort: number;
  sEnergy: number;
  sCost: number;
  sNoise: number;
  sPressure: number;
  sSpace: number;
  sPreference: number;
  totalScore: number;
}

export interface DiagnosticItem {
  code: string;
  severity: 'error' | 'warning' | 'info';
  componentId?: string;
  message: string;
  remediation: string;
}

export interface DiffuserDistributionOption {
  diffuserCount: number;
  cfmPerDiffuser: number;
  diffuserRecord: DiffuserCatalogItem;
  faceSizeLabel: string;
  neckSizeLabel: string;
  actualNc: number;
  throwT50Ft: number;
  deltaPInWg: number;
  estimatedCoveragePercent: number;
  label: string;
  isRecommended?: boolean;
}

export interface SystemDesignCandidate {
  id: string;
  systemType: 'concealed' | 'cassette' | 'high-wall' | 'packaged' | 'vrf' | 'ahu' | 'fcu';
  equipment: EquipmentCatalogItem;
  quantity: number;
  diffusers: {
    diffuserRecord: DiffuserCatalogItem;
    quantity: number;
    cfmPerUnit: number;
    actualNc: number;
    throwT50Ft: number;
    deltaPInWg: number;
  };
  diffuserDistributionOptions?: DiffuserDistributionOption[];
  ductwork?: {
    ductType: DuctTypeItem;
    totalDuctLengthFt: number;
    maxVelocityFpm: number;
    criticalPath: CriticalPathResult;
    balancingDampers: BranchBalancingItem[];
    acousticVerifications?: DuctAcousticVerification[];
  };
  fanOperatingPoint?: FanOperatingPointResult;
  isValid: boolean;
  diagnostics: DiagnosticItem[];
  subscores: Subscores;
  tradeOffSummary: string;
  categoryRankings?: {
    isBestOverall?: boolean;
    isBestEnergy?: boolean;
    isLowestCost?: boolean;
    isLowestNoise?: boolean;
  };
  systemArchitecture?: SystemArchitectureBreakdown;
  algorithmTrace?: SelectionAlgorithmTrace;
}

export type ComponentCategory =
  | 'primary-equipment'
  | 'air-distribution'
  | 'terminals'
  | 'hydronics-refrigerant'
  | 'controls-electrical'
  | 'accessories';

export interface SystemComponentItem {
  id: string;
  category: ComponentCategory;
  tag: string;             // e.g. 'ODU-01', 'FCU-01', 'SAD-01', 'RAG-01', 'FD-01'
  name: string;            // e.g. 'Inverter Condensing Unit'
  modelOrType: string;     // e.g. 'Carrier 42QSS024-D'
  quantity: number;        // Sized unit quantity
  specification: string;   // Engineering rating (e.g. '2.0 TR (22,355 Btu/h), 614 CFM')
  connectionSize?: string; // e.g. '3/8" Liquid / 5/8" Gas', '36"x8" Supply Trunk'
  status: 'included' | 'optional' | 'field-provided';
  details?: string;        // Specific engineering note or SMACNA/ASHRAE reference
}

export interface SystemArchitectureBreakdown {
  systemType: 'concealed' | 'cassette' | 'high-wall' | 'packaged' | 'vrf' | 'ahu' | 'fcu';
  systemName: string;
  summary: string;
  governingStandards: string[];
  components: SystemComponentItem[];
  schematicType: 'split-dx-ducted' | 'split-dx-ductless' | 'vrf-multisplit' | 'packaged-rooftop' | 'central-chilled-water-vav';
}

export interface SelectionAlgorithmStepInput {
  label: string;
  value: string | number;
  unit?: string;
}

export interface SelectionAlgorithmStep {
  stepNumber: number;
  stepName: string;
  formula: string;
  inputs: SelectionAlgorithmStepInput[];
  calculatedValue: string | number;
  unit?: string;
  criteria: string;
  passed: boolean;
  notes?: string;
}

export interface SelectionAlgorithmTrace {
  systemType: 'concealed' | 'cassette' | 'high-wall' | 'packaged' | 'vrf' | 'ahu' | 'fcu';
  model: string;
  steps: SelectionAlgorithmStep[];
  overallPassed: boolean;
  engineeringRemarks: string;
}

export type DuctLocationCategory =
  | 'in-shaft-solid-ceiling'
  | 'above-suspended-ceiling'
  | 'within-occupied-space';

export type AcousticSensitivity = 'standard' | 'enhanced' | 'critical';

export type DuctSectionCategory = 'trunk' | 'branch' | 'runout' | 'return';

export type AcousticComplianceStatus = 'PASS' | 'REQUIRES REDESIGN';

export interface DuctAcousticVerification {
  ductId: string;
  upstreamNode: string;
  downstreamNode: string;
  cfm: number;
  shape: 'rectangular' | 'round' | 'oval' | 'flex';
  dimensions: {
    widthIn?: number;
    heightIn?: number;
    diameterIn?: number;
  };
  dimensionsLabel: string;
  crossSectionalAreaSqFt: number;
  actualVelocityFpm: number;
  allowableAcousticVelocityFpm: number;
  targetNc: number;
  locationCategory: DuctLocationCategory;
  sectionCategory: DuctSectionCategory;
  pressureLossInWg: number;
  complianceStatus: AcousticComplianceStatus;
  warnings: string[];
  proposedRemediation?: string;
}

