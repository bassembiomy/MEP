import { describe, it, expect } from 'vitest';
import {
  analyzeFailuresAndDetermineActions,
  findEarliestRestartPhase
} from '../orchestrator/optimizationLoop';
import { MasterValidationReport } from '../validation/hvacValidator';
import { HVACDesignPhase, HVACDesignArtifacts, createEmptyDesignArtifacts } from '../orchestrator/orchestratorTypes';

describe('optimizationLoop', () => {
  it('should map acoustic NC failure to TERMINAL_SELECTION restart phase', () => {
    const report: MasterValidationReport = {
      overallStatus: 'WARNING',
      summary: 'Acoustic limits exceeded',
      points: [
        {
          pointIndex: 5,
          pointName: 'Acoustic Compliance Check',
          status: 'WARNING',
          metric: 'Predicted NC: 36 vs Target NC: 30',
          criteria: 'NC <= Target NC',
          message: 'Diffuser NC exceeds space limit in 1 zone'
        }
      ],
      timestamp: new Date().toISOString()
    };

    const artifacts: HVACDesignArtifacts = createEmptyDesignArtifacts();
    const actions = analyzeFailuresAndDetermineActions(report, artifacts, 1);

    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].failureCategory).toBe('NOISE');
    expect(actions[0].restartPhase).toBe(HVACDesignPhase.TERMINAL_SELECTION);
  });

  it('should map ESP static pressure failure to DUCT_SIZING restart phase', () => {
    const report: MasterValidationReport = {
      overallStatus: 'WARNING',
      summary: 'ESP exceeded',
      points: [
        {
          pointIndex: 7,
          pointName: 'Static Pressure / ESP Check',
          status: 'WARNING',
          metric: 'Critical ESP: 0.52 in.wg vs Available ESP: 0.40 in.wg',
          criteria: 'Required ESP <= Available ESP',
          message: 'Duct network pressure loss exceeds equipment fan ESP'
        }
      ],
      timestamp: new Date().toISOString()
    };

    const artifacts: HVACDesignArtifacts = createEmptyDesignArtifacts();
    const actions = analyzeFailuresAndDetermineActions(report, artifacts, 1);

    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].failureCategory).toBe('PRESSURE');
    expect(actions[0].restartPhase).toBe(HVACDesignPhase.DUCT_SIZING);
  });

  it('should determine the earliest restart phase when multiple failures occur', () => {
    const actions = [
      {
        id: 'a1',
        iteration: 1,
        failureCategory: 'PRESSURE' as const,
        affectedZones: ['z1'],
        affectedComponents: ['duct-1'],
        restartPhase: HVACDesignPhase.DUCT_SIZING,
        actionType: 'REDUCE_FRICTION_RATE',
        beforeValues: {},
        afterValues: {},
        expectedImprovement: 'Lower pressure loss'
      },
      {
        id: 'a2',
        iteration: 1,
        failureCategory: 'CAPACITY' as const,
        affectedZones: ['z1'],
        affectedComponents: ['acu-1'],
        restartPhase: HVACDesignPhase.EQUIPMENT_SELECTION,
        actionType: 'UPSIZE_EQUIPMENT_MODEL',
        beforeValues: {},
        afterValues: {},
        expectedImprovement: 'Increase total capacity'
      }
    ];

    const earliest = findEarliestRestartPhase(actions);
    expect(earliest).toBe(HVACDesignPhase.EQUIPMENT_SELECTION);
  });
});
