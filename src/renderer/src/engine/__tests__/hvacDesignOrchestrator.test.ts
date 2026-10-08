import { describe, it, expect } from 'vitest';
import { autoDesignHVAC, HVACProjectInput } from '../orchestrator/hvacDesignOrchestrator';
import { ASHRAE_PROFILE } from '../standards/designStandards';

describe('hvacDesignOrchestrator', () => {
  it('should execute end-to-end auto design for a single room project', async () => {
    const projectInput: HVACProjectInput = {
      projectId: 'proj-1',
      name: 'Corporate Office',
      units: 'imperial',
      profile: ASHRAE_PROFILE,
      spaceNcLimit: 30,
      coverageTargetPercent: 95,
      systemType: 'concealed',
      zones: [
        {
          id: 'z1',
          name: 'Conference Room',
          polygon: [0, 0, 25, 0, 25, 20, 0, 20], // 25ft x 20ft = 500 sq ft
          ceilingHeightFt: 10,
          occupancy: 4
        }
      ]
    };

    const result = await autoDesignHVAC(projectInput, { maxOptimizationIterations: 3 });

    expect(result.status).toBe('PASS');
    expect(result.artifacts.zones.length).toBe(1);
    expect(result.artifacts.terminals.length).toBeGreaterThan(0);
    expect(result.artifacts.ductNetwork.length).toBeGreaterThan(0);
    expect(result.validationReport.points.length).toBeGreaterThanOrEqual(8);
    expect(result.decisionLog.length).toBeGreaterThan(0);
    expect(result.executionSummary.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('should report live progress via onStateChange callback', async () => {
    const projectInput: HVACProjectInput = {
      projectId: 'proj-2',
      name: 'Small Office',
      units: 'imperial',
      profile: ASHRAE_PROFILE,
      spaceNcLimit: 30,
      coverageTargetPercent: 95,
      systemType: 'concealed',
      zones: [
        {
          id: 'z2',
          name: 'Private Office',
          polygon: [0, 0, 20, 0, 20, 15, 0, 15], // 20ft x 15ft = 300 sq ft
          ceilingHeightFt: 9,
          occupancy: 1
        }
      ]
    };

    const stateTransitions: string[] = [];
    const result = await autoDesignHVAC(projectInput, {
      onStateChange: (state) => {
        stateTransitions.push(state.currentPhase);
      }
    });

    expect(result.status).toBe('PASS');
    expect(stateTransitions.length).toBeGreaterThan(3);
    expect(stateTransitions).toContain('INPUT_ANALYSIS');
    expect(stateTransitions).toContain('COMPLETE');
  });
});
