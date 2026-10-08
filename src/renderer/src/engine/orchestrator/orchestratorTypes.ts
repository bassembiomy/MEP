import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { SteppedDuctSection } from '../ducts/steppedDuctRouter';
import { MasterValidationReport } from '../validation/hvacValidator';
import { SelectedEquipmentResult } from '../systemArchitecture/equipmentSelector';
import { StandardsProfile } from '../standards/designStandards';
import type { LoadAndAirflowSettings } from '../adapters/loadAirflowAdapter';
import type { EquipmentCatalogItem } from '../types';

export enum HVACDesignPhase {
  INPUT_ANALYSIS = 'INPUT_ANALYSIS',
  ZONE_VALIDATION = 'ZONE_VALIDATION',
  LOAD_ANALYSIS = 'LOAD_ANALYSIS',
  AIRFLOW_CALCULATION = 'AIRFLOW_CALCULATION',
  SYSTEM_SELECTION = 'SYSTEM_SELECTION',
  EQUIPMENT_SELECTION = 'EQUIPMENT_SELECTION',
  AIR_DISTRIBUTION = 'AIR_DISTRIBUTION',
  TERMINAL_SELECTION = 'TERMINAL_SELECTION',
  TERMINAL_PLACEMENT = 'TERMINAL_PLACEMENT',
  DUCT_TOPOLOGY = 'DUCT_TOPOLOGY',
  DUCT_ROUTING = 'DUCT_ROUTING',
  DUCT_SIZING = 'DUCT_SIZING',
  PRESSURE_ANALYSIS = 'PRESSURE_ANALYSIS',
  ACOUSTIC_VALIDATION = 'ACOUSTIC_VALIDATION',
  COMFORT_VALIDATION = 'COMFORT_VALIDATION',
  FINAL_VALIDATION = 'FINAL_VALIDATION',
  OPTIMIZATION = 'OPTIMIZATION',
  COMPLETE = 'COMPLETE',
  FAILED = 'FAILED'
}

export interface PhaseValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export interface HVACDesignContext {
  projectId: string;
  units: 'imperial' | 'metric';
  drawingUnitsPerLength?: number;
  loadSettings?: LoadAndAirflowSettings;
  equipmentCatalog?: EquipmentCatalogItem[];
  profile: StandardsProfile;
  spaceNcLimit: number;
  coverageTargetPercent: number;
  maxDuctVelocityFpm?: number;
  systemType?: 'high-wall' | 'cassette' | 'concealed' | 'packaged' | 'vrf' | 'ahu' | 'fcu';
  optimizationWeights?: Record<string, number>;
}

export interface EngineeringWarning {
  code: string;
  phase: HVACDesignPhase;
  message: string;
  location?: string;
  remediation?: string;
}

export interface EngineeringError {
  code: string;
  phase: HVACDesignPhase;
  message: string;
  fatal: boolean;
}

export interface HVACDesignState {
  currentPhase: HVACDesignPhase;
  progressPercent: number;
  status: 'IDLE' | 'RUNNING' | 'OPTIMIZING' | 'COMPLETE' | 'FAILED';
  currentIteration: number;
  warnings: EngineeringWarning[];
  errors: EngineeringError[];
}

export interface DesignDecisionLog {
  id: string;
  phase: HVACDesignPhase;
  decisionType:
    | 'SYSTEM_SELECTION'
    | 'EQUIPMENT_SELECTION'
    | 'DIFFUSER_SELECTION'
    | 'DIFFUSER_PLACEMENT'
    | 'DUCT_ROUTE'
    | 'DUCT_SIZE'
    | 'OPTIMIZATION';
  inputs: Record<string, unknown>;
  constraintsApplied: string[];
  engineeringRulesApplied: string[];
  candidatesEvaluated?: Array<{ id: string; name: string; score: number; details: Record<string, unknown> }>;
  selectedCandidate: string;
  rejectionReasons?: string[];
  deterministicEngine: string;
  reasonForSelection: string;
  validationResult?: 'PASS' | 'WARNING' | 'FAIL';
  timestamp: number;
}

export interface OptimizationAction {
  id: string;
  iteration: number;
  failureCategory:
    | 'CAPACITY'
    | 'AIRFLOW'
    | 'COVERAGE'
    | 'THROW'
    | 'NOISE'
    | 'VELOCITY'
    | 'PRESSURE'
    | 'COMFORT'
    | 'GEOMETRY';
  affectedZones: string[];
  affectedComponents: string[];
  restartPhase: HVACDesignPhase;
  actionType: string;
  beforeValues: Record<string, unknown>;
  afterValues: Record<string, unknown>;
  expectedImprovement: string;
  actualValidationResult?: 'PASS' | 'WARNING' | 'FAIL';
}

export interface ZoneLoadResult {
  sensibleBtu: number;
  latentBtu: number;
  totalBtu: number;
  areaSqFt: number;
}

export interface ZoneAirflowResult {
  supplyCfm: number;
  returnCfm: number;
  outdoorAirCfm: number;
  exhaustCfm?: number;
}

export interface HVACDesignArtifacts {
  zones: EquipmentServiceZone[];
  loads: Record<string, ZoneLoadResult>;
  airflows: Record<string, ZoneAirflowResult>;
  selectedEquipment: Record<string, SelectedEquipmentResult>;
  terminals: CoordinatedAirTerminal[];
  returnGrilles: CoordinatedAirTerminal[];
  ductNetwork: SteppedDuctSection[];
  returnDuctNetwork?: SteppedDuctSection[];
  validationReport?: MasterValidationReport;
}

export function createEmptyDesignArtifacts(): HVACDesignArtifacts {
  return {
    zones: [],
    loads: {},
    airflows: {},
    selectedEquipment: {},
    terminals: [],
    returnGrilles: [],
    ductNetwork: []
  };
}

export interface HVACDesignExecution {
  state: HVACDesignState;
  currentArtifacts: Partial<HVACDesignArtifacts>;
  logs: string[];
}

export interface HVACDesignResult {
  status: 'PASS' | 'WARNING' | 'FAIL';
  artifacts: HVACDesignArtifacts;
  validationReport: MasterValidationReport;
  optimizationHistory: OptimizationAction[];
  decisionLog: DesignDecisionLog[];
  executionSummary: {
    totalDurationMs: number;
    iterationsRun: number;
    phasesExecuted: HVACDesignPhase[];
    initialPassStatus: 'PASS' | 'WARNING' | 'FAIL';
    finalPassStatus: 'PASS' | 'WARNING' | 'FAIL';
  };
}

export interface HVACDesignPhaseContract<TInput, TOutput> {
  phase: HVACDesignPhase;
  execute(input: TInput, context: HVACDesignContext): Promise<TOutput>;
  validateOutput(output: TOutput): PhaseValidationResult;
}
