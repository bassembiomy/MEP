import { describe, it, expect } from 'vitest';
import { autoDesignHVAC, HVACProjectInput } from '../orchestrator/hvacDesignOrchestrator';
import { recalculatePartialDesign, UserModification } from '../orchestrator/partialRecalculationEngine';
import { ASHRAE_PROFILE } from '../standards/designStandards';

describe('AI HVAC Design Orchestrator — End-to-End Acceptance Scenarios (SC-01 to SC-10)', () => {
  // SC-01: Single Rectangular Room -> Auto design -> PASS
  it('SC-01: should automatically design single rectangular office with full pass', async () => {
    const project: HVACProjectInput = {
      projectId: 'sc-01',
      name: 'Standard Office',
      units: 'imperial',
      profile: ASHRAE_PROFILE,
      spaceNcLimit: 30,
      coverageTargetPercent: 95,
      systemType: 'concealed',
      zones: [
        {
          id: 'z-sc01',
          name: 'Office Room',
          polygon: [0, 0, 20, 0, 20, 15, 0, 15], // 300 sq ft
          ceilingHeightFt: 10,
          occupancy: 2
        }
      ]
    };

    const result = await autoDesignHVAC(project);
    expect(result.status).toBe('PASS');
    expect(result.artifacts.zones.length).toBe(1);
    expect(result.artifacts.terminals.length).toBeGreaterThan(0);
    expect(result.artifacts.ductNetwork.length).toBeGreaterThan(0);
  });

  // SC-02: Multi-Zone Building -> Shared/Ducted Equipment & Balanced Airflow
  it('SC-02: should automatically design multi-zone building and balance airflows', async () => {
    const project: HVACProjectInput = {
      projectId: 'sc-02',
      name: 'Multi-Room Suite',
      units: 'imperial',
      profile: ASHRAE_PROFILE,
      spaceNcLimit: 30,
      coverageTargetPercent: 95,
      zones: [
        {
          id: 'z-1',
          name: 'Zone A',
          polygon: [0, 0, 20, 0, 20, 15, 0, 15], // 300 sq ft
          occupancy: 2
        },
        {
          id: 'z-2',
          name: 'Zone B',
          polygon: [20, 0, 40, 0, 40, 15, 20, 15], // 300 sq ft
          occupancy: 3
        }
      ]
    };

    const result = await autoDesignHVAC(project);
    expect(result.status).toBe('PASS');
    expect(result.artifacts.zones.length).toBe(2);
    expect(result.artifacts.terminals.length).toBeGreaterThanOrEqual(2);
  });

  // SC-03: Complex L-Shaped Room Geometry -> Coverage Optimization
  it('SC-03: should optimize diffuser placement on complex L-shaped room geometry', async () => {
    const project: HVACProjectInput = {
      projectId: 'sc-03',
      name: 'L-Shaped Suite',
      units: 'imperial',
      profile: ASHRAE_PROFILE,
      spaceNcLimit: 30,
      coverageTargetPercent: 95,
      zones: [
        {
          id: 'z-lshape',
          name: 'L-Shaped Hall',
          polygon: [0, 0, 30, 0, 30, 15, 15, 15, 15, 30, 0, 30], // 675 sq ft L-shape
          occupancy: 4
        }
      ]
    };

    const result = await autoDesignHVAC(project);
    expect(result.status).toBe('PASS');
    expect(result.artifacts.terminals.length).toBeGreaterThanOrEqual(2);
  });

  // SC-04: High Diffuser Noise -> Optimization Triggered
  it('SC-04: should trigger optimization and satisfy tight noise criteria', async () => {
    const project: HVACProjectInput = {
      projectId: 'sc-04',
      name: 'Sound Studio',
      units: 'imperial',
      profile: ASHRAE_PROFILE,
      spaceNcLimit: 25, // Strict NC 25
      coverageTargetPercent: 95,
      zones: [
        {
          id: 'z-studio',
          name: 'Recording Room',
          polygon: [0, 0, 25, 0, 25, 20, 0, 20],
          manualCfm: 600 // High airflow in quiet room
        }
      ]
    };

    const result = await autoDesignHVAC(project, { maxOptimizationIterations: 3 });
    expect(result.status).toBe('PASS');
    expect(result.artifacts.terminals.length).toBeGreaterThanOrEqual(2);
  });

  // SC-05: High Static Pressure Loss -> Duct Optimization
  it('SC-05: should validate critical path pressure loss against fan rating', async () => {
    const project: HVACProjectInput = {
      projectId: 'sc-05',
      name: 'Long Hallway Office',
      units: 'imperial',
      profile: ASHRAE_PROFILE,
      spaceNcLimit: 30,
      zones: [
        {
          id: 'z-long',
          name: 'Long Gallery',
          polygon: [0, 0, 40, 0, 40, 10, 0, 10], // 400 sq ft gallery
          occupancy: 2
        }
      ]
    };

    const result = await autoDesignHVAC(project);
    expect(result.status).toBe('PASS');
    expect(result.validationReport.points.some(p => p.pointName.includes('Static Pressure'))).toBe(true);
  });

  // SC-06: Equipment Capacity Sizing Match
  it('SC-06: should match equipment capacity to elevated cooling load', async () => {
    const project: HVACProjectInput = {
      projectId: 'sc-06',
      name: 'Server Lab',
      units: 'imperial',
      profile: ASHRAE_PROFILE,
      zones: [
        {
          id: 'z-server',
          name: 'Server Room',
          polygon: [0, 0, 25, 0, 25, 20, 0, 20],
          manualLoadBtu: 36000 // 3 Tons load
        }
      ]
    };

    const result = await autoDesignHVAC(project);
    expect(result.status).toBe('PASS');
    expect(result.artifacts.zones[0].actualCapacityBtu).toBeGreaterThanOrEqual(30000);
  });

  // SC-07: User Moves Diffuser -> Partial Recalculation Only
  it('SC-07: should partially recalculate when a user repositions a diffuser', async () => {
    const project: HVACProjectInput = {
      projectId: 'sc-07',
      name: 'Dynamic Layout',
      units: 'imperial',
      profile: ASHRAE_PROFILE,
      zones: [
        {
          id: 'z-dyn',
          name: 'Open Space',
          polygon: [0, 0, 25, 0, 25, 20, 0, 20],
          occupancy: 2
        }
      ]
    };

    const initial = await autoDesignHVAC(project);
    const target = initial.artifacts.terminals[0];
    const origX = target.position.x;
    const mod: UserModification = {
      type: 'MOVE_DIFFUSER',
      targetId: target.id,
      zoneId: 'z-dyn',
      newPosition: { x: origX + 2, y: target.position.y + 1 }
    };

    const updated = await recalculatePartialDesign(project.zones, initial.artifacts, mod, {
      projectId: project.projectId,
      units: 'imperial',
      profile: ASHRAE_PROFILE,
      spaceNcLimit: 30,
      coverageTargetPercent: 95
    });

    expect(['PASS', 'WARNING']).toContain(updated.status);
    const moved = updated.artifacts.terminals.find(t => t.id === target.id);
    expect(moved?.position.x).toBe(origX + 2);
  });

  // SC-08: User Modifies Zone Boundary -> Local Zone Invalidation
  it('SC-08: should re-run zone workflow when zone boundary is expanded', async () => {
    const project: HVACProjectInput = {
      projectId: 'sc-08',
      name: 'Expanded Space',
      units: 'imperial',
      profile: ASHRAE_PROFILE,
      zones: [
        {
          id: 'z-expand',
          name: 'Expandable Room',
          polygon: [0, 0, 20, 0, 20, 15, 0, 15],
          occupancy: 2
        }
      ]
    };

    const initial = await autoDesignHVAC(project);
    const newPoly = [0, 0, 30, 0, 30, 20, 0, 20];
    const mod: UserModification = {
      type: 'MODIFY_ZONE_BOUNDARY',
      targetId: 'z-expand',
      zoneId: 'z-expand',
      newPolygon: newPoly
    };

    const updated = await recalculatePartialDesign(project.zones, initial.artifacts, mod, {
      projectId: project.projectId,
      units: 'imperial',
      profile: ASHRAE_PROFILE,
      spaceNcLimit: 30,
      coverageTargetPercent: 95
    });

    expect(updated.artifacts.loads['z-expand'].areaSqFt).toBeGreaterThan(initial.artifacts.loads['z-expand'].areaSqFt);
  });

  // SC-09: Invalid Geometry -> Pipeline Safely Rejects with Error
  it('SC-09: should reject invalid polygon geometry without crashing', async () => {
    const project: HVACProjectInput = {
      projectId: 'sc-09',
      name: 'Corrupt Room',
      units: 'imperial',
      zones: [
        {
          id: 'z-bad',
          name: 'Collapsed Point',
          polygon: [0, 0, 10, 10] // Invalid 2 points
        }
      ]
    };

    await expect(autoDesignHVAC(project)).rejects.toThrow(/invalid/i);
  });

  // SC-10: Decision Traceability & History
  it('SC-10: should log complete engineering decision trail and execution summary', async () => {
    const project: HVACProjectInput = {
      projectId: 'sc-10',
      name: 'Audit Project',
      units: 'imperial',
      zones: [
        {
          id: 'z-audit',
          name: 'Audited Room',
          polygon: [0, 0, 25, 0, 25, 20, 0, 20],
          occupancy: 2
        }
      ]
    };

    const result = await autoDesignHVAC(project);
    expect(result.decisionLog.length).toBeGreaterThan(3);
    expect(result.decisionLog.some(d => d.decisionType === 'EQUIPMENT_SELECTION')).toBe(true);
    expect(result.decisionLog.some(d => d.decisionType === 'DIFFUSER_PLACEMENT')).toBe(true);
    expect(result.decisionLog.some(d => d.decisionType === 'DUCT_SIZE')).toBe(true);
    expect(result.executionSummary.totalDurationMs).toBeGreaterThan(0);
  });
});
