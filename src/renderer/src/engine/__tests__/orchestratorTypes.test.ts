import { describe, it, expect } from 'vitest';
import {
  HVACDesignPhase,
  createEmptyDesignArtifacts,
  DesignDecisionLog,
  OptimizationAction
} from '../orchestrator/orchestratorTypes';

describe('Orchestrator Core Types & Contracts', () => {
  it('should define all 19 phases of the HVAC design pipeline', () => {
    expect(HVACDesignPhase.INPUT_ANALYSIS).toBe('INPUT_ANALYSIS');
    expect(HVACDesignPhase.ZONE_VALIDATION).toBe('ZONE_VALIDATION');
    expect(HVACDesignPhase.LOAD_ANALYSIS).toBe('LOAD_ANALYSIS');
    expect(HVACDesignPhase.AIRFLOW_CALCULATION).toBe('AIRFLOW_CALCULATION');
    expect(HVACDesignPhase.SYSTEM_SELECTION).toBe('SYSTEM_SELECTION');
    expect(HVACDesignPhase.EQUIPMENT_SELECTION).toBe('EQUIPMENT_SELECTION');
    expect(HVACDesignPhase.AIR_DISTRIBUTION).toBe('AIR_DISTRIBUTION');
    expect(HVACDesignPhase.TERMINAL_SELECTION).toBe('TERMINAL_SELECTION');
    expect(HVACDesignPhase.TERMINAL_PLACEMENT).toBe('TERMINAL_PLACEMENT');
    expect(HVACDesignPhase.DUCT_TOPOLOGY).toBe('DUCT_TOPOLOGY');
    expect(HVACDesignPhase.DUCT_ROUTING).toBe('DUCT_ROUTING');
    expect(HVACDesignPhase.DUCT_SIZING).toBe('DUCT_SIZING');
    expect(HVACDesignPhase.PRESSURE_ANALYSIS).toBe('PRESSURE_ANALYSIS');
    expect(HVACDesignPhase.ACOUSTIC_VALIDATION).toBe('ACOUSTIC_VALIDATION');
    expect(HVACDesignPhase.COMFORT_VALIDATION).toBe('COMFORT_VALIDATION');
    expect(HVACDesignPhase.FINAL_VALIDATION).toBe('FINAL_VALIDATION');
    expect(HVACDesignPhase.OPTIMIZATION).toBe('OPTIMIZATION');
    expect(HVACDesignPhase.COMPLETE).toBe('COMPLETE');
    expect(HVACDesignPhase.FAILED).toBe('FAILED');
  });

  it('should create default empty artifacts container', () => {
    const artifacts = createEmptyDesignArtifacts();
    expect(artifacts.zones).toEqual([]);
    expect(artifacts.terminals).toEqual([]);
    expect(artifacts.returnGrilles).toEqual([]);
    expect(artifacts.ductNetwork).toEqual([]);
    expect(artifacts.loads).toEqual({});
    expect(artifacts.airflows).toEqual({});
    expect(artifacts.selectedEquipment).toEqual({});
  });

  it('should format DesignDecisionLog correctly', () => {
    const log: DesignDecisionLog = {
      id: 'dec-1',
      phase: HVACDesignPhase.EQUIPMENT_SELECTION,
      decisionType: 'EQUIPMENT_SELECTION',
      inputs: { totalLoadBtu: 18000, reqCfm: 600 },
      constraintsApplied: ['Capacity >= 18000', 'ESP >= 0.35 in.wg'],
      engineeringRulesApplied: ['ASHRAE 90.1 Sizing Margin +10%'],
      candidatesEvaluated: [
        { id: 'c1', name: 'Model A', score: 92, details: {} },
        { id: 'c2', name: 'Model B', score: 81, details: {} }
      ],
      selectedCandidate: 'Model A',
      rejectionReasons: ['Model B has insufficient ESP (0.20 in.wg)'],
      deterministicEngine: 'equipmentSelector.ts',
      reasonForSelection: 'Highest score and lowest lifecycle cost index',
      validationResult: 'PASS',
      timestamp: Date.now()
    };
    expect(log.phase).toBe(HVACDesignPhase.EQUIPMENT_SELECTION);
    expect(log.selectedCandidate).toBe('Model A');
  });

  it('should format OptimizationAction correctly', () => {
    const action: OptimizationAction = {
      id: 'opt-1',
      iteration: 1,
      failureCategory: 'NOISE',
      affectedZones: ['zone-1'],
      affectedComponents: ['diffuser-1'],
      restartPhase: HVACDesignPhase.TERMINAL_SELECTION,
      actionType: 'INCREASE_DIFFUSER_COUNT',
      beforeValues: { count: 1, nc: 35 },
      afterValues: { count: 2, nc: 27 },
      expectedImprovement: 'Reduce flow per terminal from 500 to 250 CFM to satisfy NC <= 30',
      actualValidationResult: 'PASS'
    };
    expect(action.failureCategory).toBe('NOISE');
    expect(action.restartPhase).toBe(HVACDesignPhase.TERMINAL_SELECTION);
  });
});
