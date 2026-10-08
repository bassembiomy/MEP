import { describe, it, expect } from 'vitest';
import { recalculatePartialDesign, UserModification } from '../orchestrator/partialRecalculationEngine';
import { executeDesignWorkflow } from '../orchestrator/hvacDesignWorkflow';
import { DesignStateMachine } from '../orchestrator/designStateMachine';
import { ASHRAE_PROFILE } from '../standards/designStandards';
import { HVACDesignContext } from '../orchestrator/orchestratorTypes';

describe('partialRecalculationEngine', () => {
  const context: HVACDesignContext = {
    projectId: 'test-proj',
    units: 'imperial',
    drawingUnitsPerLength: 20, // Canvas fixture represents a 20 × 15 ft room.
    profile: ASHRAE_PROFILE,
    spaceNcLimit: 30,
    coverageTargetPercent: 95,
    systemType: 'concealed'
  };

  const sampleZones = [
    {
      id: 'z1',
      name: 'Executive Office',
      polygon: [0, 0, 400, 0, 400, 300, 0, 300],
      ceilingHeightFt: 10,
      occupancy: 3
    }
  ];

  it('should recalculate only connected runouts and validation when user moves a diffuser', async () => {
    const sm = new DesignStateMachine();
    const decisionLog: any[] = [];

    const initialArtifacts = await executeDesignWorkflow(sampleZones, context, sm, decisionLog);
    const targetDiffuser = initialArtifacts.terminals[0];
    expect(targetDiffuser).toBeDefined();

    const originalX = targetDiffuser.position.x;
    const originalY = targetDiffuser.position.y;

    const modification: UserModification = {
      type: 'MOVE_DIFFUSER',
      targetId: targetDiffuser.id,
      zoneId: 'z1',
      newPosition: { x: originalX + 20, y: originalY + 20 }
    };

    const updatedResult = await recalculatePartialDesign(
      sampleZones,
      initialArtifacts,
      modification,
      context
    );

    const moved = updatedResult.artifacts.terminals.find((t) => t.id === targetDiffuser.id);
    expect(moved?.position.x).toBe(originalX + 20);
    expect(moved?.position.y).toBe(originalY + 20);
    expect(updatedResult.artifacts.validationReport).toBeDefined();
  });
});
