import { describe, it, expect } from 'vitest';
import { adaptZoneGeometry } from '../adapters/zoningAdapter';
import { adaptCalculateLoadAndAirflow } from '../adapters/loadAirflowAdapter';
import { adaptSelectEquipment } from '../adapters/equipmentAdapter';
import { adaptPlaceTerminals } from '../adapters/terminalAdapter';
import { adaptRouteAndSizeDucts } from '../adapters/ductAdapter';
import { adaptValidateHvacDesign } from '../adapters/validationAdapter';

describe('Orchestrator Adapters', () => {
  const samplePoints = [0, 0, 400, 0, 400, 300, 0, 300]; // 400px x 300px polygon

  it('should validate and partition zone geometry', () => {
    const res = adaptZoneGeometry('Room 1', samplePoints, 10);
    expect(res.valid).toBe(true);
    expect(res.areaSqFt).toBeGreaterThan(0);
    expect(res.centroid).toBeDefined();
  });

  it('should reject invalid or collapsed polygon geometry', () => {
    const res = adaptZoneGeometry('Bad Room', [0, 0, 10, 10], 10);
    expect(res.valid).toBe(false);
    expect(res.error).toBeDefined();
  });

  it('should calculate load and airflow using standard heat transfer rates', () => {
    const load = adaptCalculateLoadAndAirflow(400, 10, 2);
    expect(load.sensibleBtu).toBeGreaterThan(5000);
    expect(load.totalBtu).toBeGreaterThan(load.sensibleBtu);
    expect(load.supplyCfm).toBeGreaterThan(200);
  });

  it('should select equipment from catalog meeting load', () => {
    const eq = adaptSelectEquipment(500, 15000, 'concealed');
    expect(eq).not.toBeNull();
    expect(eq?.supplyCfm).toBeGreaterThanOrEqual(450);
    expect(eq?.totalCapacityBtu).toBeGreaterThanOrEqual(14000);
  });

  it('should place terminals, route ducts, and run master validation', () => {
    const terminals = adaptPlaceTerminals(samplePoints, 500, 30, 95);
    expect(terminals.length).toBeGreaterThan(0);

    const zone = {
      id: 'z1',
      unitTag: 'ACU-1',
      designControlMode: 'ai' as const,
      equipmentModel: 'Carrier 42QSS018-D',
      coolingSource: 'dx' as const,
      equipmentType: 'concealed-split' as const,
      nominalTonnage: 1.5,
      actualCapacityBtu: 18000,
      supplyCfm: 500,
      returnCfm: 500,
      outdoorAirCfm: 50,
      outdoorAirConnectionApproved: true,
      espInWg: 0.4,
      equipmentPosition: { x: 50, y: 50, rotation: 0, wallSide: 'ceiling' as const },
      serviceAreaPolygon: samplePoints,
      sensibleLoadBtu: 14000,
      latentLoadBtu: 2000,
      totalLoadBtu: 16000,
      targetNc: 30,
      pressureBudgetInWg: {
        supplyDuct: 0.1,
        returnDuct: 0.05,
        terminals: 0.05,
        fittings: 0.05,
        totalAvailable: 0.4
      },
      isUserOverridden: false
    };

    const ducts = adaptRouteAndSizeDucts(zone, terminals);
    expect(ducts.length).toBeGreaterThan(0);

    const report = adaptValidateHvacDesign({
      roomName: 'Room 1',
      roomPolygon: samplePoints,
      requiredRoomCfm: 500,
      designLoadBtu: 16000,
      zones: [zone],
      terminals,
      ducts
    });
    expect(report.points.length).toBeGreaterThanOrEqual(8);
  });
});
