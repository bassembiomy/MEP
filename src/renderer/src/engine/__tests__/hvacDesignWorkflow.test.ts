import { describe, it, expect } from 'vitest';
import { executeDesignWorkflow, HVACZoneInput } from '../orchestrator/hvacDesignWorkflow';
import { DesignStateMachine } from '../orchestrator/designStateMachine';
import { ASHRAE_PROFILE } from '../standards/designStandards';
import { HVACDesignContext, HVACDesignPhase } from '../orchestrator/orchestratorTypes';

describe('hvacDesignWorkflow', () => {
  const context: HVACDesignContext = {
    projectId: 'test-proj',
    units: 'imperial',
    drawingUnitsPerLength: 20, // Canvas fixture represents a 20 × 15 ft room.
    profile: ASHRAE_PROFILE,
    spaceNcLimit: 30,
    coverageTargetPercent: 95,
    systemType: 'concealed'
  };

  const sampleZones: HVACZoneInput[] = [
    {
      id: 'z1',
      name: 'Executive Office',
      polygon: [0, 0, 400, 0, 400, 300, 0, 300],
      ceilingHeightFt: 10,
      occupancy: 3
    }
  ];

  it('should execute linear phases and populate all artifacts', async () => {
    const sm = new DesignStateMachine();
    const decisionLog: any[] = [];

    const artifacts = await executeDesignWorkflow(
      sampleZones,
      context,
      sm,
      decisionLog
    );

    expect(artifacts.zones.length).toBe(1);
    expect(artifacts.loads['z1']).toBeDefined();
    expect(artifacts.airflows['z1']).toBeDefined();
    expect(artifacts.selectedEquipment['z1']).toBeDefined();
    expect(artifacts.terminals.length).toBeGreaterThan(0);
    expect(artifacts.ductNetwork.length).toBeGreaterThan(0);
    expect(artifacts.validationReport).toBeDefined();
    expect(decisionLog.length).toBeGreaterThan(0);
  });

  it('should support restarting from a specified phase with partial artifacts', async () => {
    const sm = new DesignStateMachine();
    const decisionLog: any[] = [];

    // First run full
    const fullArtifacts = await executeDesignWorkflow(
      sampleZones,
      context,
      sm,
      decisionLog
    );

    // Restart from DUCT_SIZING
    const partialArtifacts = await executeDesignWorkflow(
      sampleZones,
      context,
      sm,
      decisionLog,
      HVACDesignPhase.DUCT_SIZING,
      fullArtifacts
    );

    expect(partialArtifacts.ductNetwork.length).toBeGreaterThan(0);
    expect(partialArtifacts.validationReport).toBeDefined();
  });
});
