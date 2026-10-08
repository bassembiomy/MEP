import {
  HVACDesignContext,
  HVACDesignResult,
  HVACDesignPhase,
  DesignDecisionLog,
  OptimizationAction
} from './orchestratorTypes';
import { DesignStateMachine, StateChangeListener } from './designStateMachine';
import { HVACZoneInput, executeDesignWorkflow } from './hvacDesignWorkflow';
import { analyzeFailuresAndDetermineActions, findEarliestRestartPhase } from './optimizationLoop';
import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';
import type { LoadAndAirflowSettings } from '../adapters/loadAirflowAdapter';
import type { EquipmentCatalogItem } from '../types';

export interface HVACProjectInput {
  projectId: string;
  name: string;
  units: 'imperial' | 'metric';
  drawingUnitsPerLength?: number;
  loadSettings?: LoadAndAirflowSettings;
  equipmentCatalog?: EquipmentCatalogItem[];
  profile?: StandardsProfile;
  spaceNcLimit?: number;
  coverageTargetPercent?: number;
  systemType?: 'high-wall' | 'cassette' | 'concealed' | 'packaged' | 'vrf' | 'ahu' | 'fcu';
  zones: HVACZoneInput[];
}

export interface HVACDesignOptions {
  maxOptimizationIterations?: number;
  onStateChange?: StateChangeListener;
}

export async function autoDesignHVAC(
  project: HVACProjectInput,
  options: HVACDesignOptions = {}
): Promise<HVACDesignResult> {
  const startTime = Date.now();
  const maxIterations = options.maxOptimizationIterations ?? 5;
  if (!Number.isInteger(maxIterations) || maxIterations < 0 || maxIterations > 20) {
    throw new RangeError('Optimization iteration limit must be an integer from 0 to 20');
  }
  if (project.units !== 'imperial' && project.units !== 'metric') throw new RangeError('Unsupported project units');
  const ncLimit = project.spaceNcLimit ?? 30;
  const coverageTarget = project.coverageTargetPercent ?? 95;
  if (!Number.isFinite(ncLimit) || ncLimit <= 0) throw new RangeError('Noise criterion must be positive and finite');
  if (!Number.isFinite(coverageTarget) || coverageTarget <= 0 || coverageTarget > 100) throw new RangeError('Coverage target must be greater than zero and at most 100');

  const context: HVACDesignContext = {
    projectId: project.projectId,
    units: project.units,
    drawingUnitsPerLength: project.drawingUnitsPerLength,
    loadSettings: project.loadSettings,
    equipmentCatalog: project.equipmentCatalog,
    profile: project.profile || ASHRAE_PROFILE,
    spaceNcLimit: ncLimit,
    coverageTargetPercent: coverageTarget,
    systemType: project.systemType || 'concealed'
  };

  const stateMachine = new DesignStateMachine();
  const phasesExecuted: HVACDesignPhase[] = [];
  stateMachine.subscribe(state => {
    if (state.currentPhase !== HVACDesignPhase.COMPLETE && state.currentPhase !== HVACDesignPhase.FAILED &&
        phasesExecuted[phasesExecuted.length - 1] !== state.currentPhase) phasesExecuted.push(state.currentPhase);
    options.onStateChange?.(state);
  });

  stateMachine.start();

  const decisionLog: DesignDecisionLog[] = [];
  const optimizationHistory: OptimizationAction[] = [];
  const execute = async (startPhase?: HVACDesignPhase, previous?: Parameters<typeof executeDesignWorkflow>[5]) => {
    try {
      return await executeDesignWorkflow(project.zones, context, stateMachine, decisionLog, startPhase, previous);
    } catch (error) {
      stateMachine.fail((error as Error).message);
      throw error;
    }
  };
  let artifacts = await execute();
  if (!artifacts.validationReport) {
    stateMachine.fail('Required engineering validation was not executed');
    throw new Error('Required engineering validation was not executed');
  }

  const initialPassStatus = artifacts.validationReport.overallStatus;
  let iteration = 0;

  // Optimization Loop
  while (
    artifacts.validationReport &&
    artifacts.validationReport.overallStatus !== 'PASS' &&
    iteration < maxIterations
  ) {
    iteration++;
    stateMachine.startOptimization(iteration);

    const actions = analyzeFailuresAndDetermineActions(
      artifacts.validationReport,
      artifacts,
      iteration
    );

    if (actions.length === 0) break;
    optimizationHistory.push(...actions);

    const restartPhase = findEarliestRestartPhase(actions);
    phasesExecuted.push(HVACDesignPhase.OPTIMIZATION);
    // Keep the user's engineering criteria fixed; stop if corrective routing makes no progress.
    const before = JSON.stringify({ zones: artifacts.zones, terminals: artifacts.terminals,
      ducts: artifacts.ductNetwork, points: artifacts.validationReport.points });

    // Re-execute workflow starting from earliest affected phase
    artifacts = await execute(restartPhase, artifacts);
    if (!artifacts.validationReport) throw new Error('Optimization did not produce required validation');

    // Record action validation outcome
    for (const act of actions) {
      act.actualValidationResult = artifacts.validationReport?.overallStatus;
    }
    const after = JSON.stringify({ zones: artifacts.zones, terminals: artifacts.terminals,
      ducts: artifacts.ductNetwork, points: artifacts.validationReport.points });
    if (before === after) break;
  }

  const finalStatus = artifacts.validationReport!.overallStatus;

  if (finalStatus === 'FAIL') {
    stateMachine.fail('Validation failed to reach acceptable engineering thresholds');
  } else {
    stateMachine.complete();
  }

  return {
    status: finalStatus,
    artifacts,
    validationReport: artifacts.validationReport!,
    optimizationHistory,
    decisionLog,
    executionSummary: {
      totalDurationMs: Date.now() - startTime,
      iterationsRun: iteration,
      phasesExecuted,
      initialPassStatus,
      finalPassStatus: finalStatus
    }
  };
}
