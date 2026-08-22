import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { SteppedDuctSection } from './steppedDuctRouter';

export function routeReturnDucts(
  zone: EquipmentServiceZone,
  returnTerminals: CoordinatedAirTerminal[] = []
): SteppedDuctSection[] {
  const ducts: SteppedDuctSection[] = [];
  const eqPos = zone.equipmentPosition;
  const returnCfm = zone.returnCfm || Math.round(zone.supplyCfm * 0.88);

  // In ceiling plenum / ducted return systems, route orthogonal return connection stub
  ducts.push({
    id: `RDS-${zone.unitTag}-1`,
    unitId: zone.id,
    designControlMode: 'ai',
    systemType: 'return',
    role: 'main-trunk',
    startPoint: { x: parseFloat((eqPos.x - 3).toFixed(2)), y: parseFloat(eqPos.y.toFixed(2)) },
    endPoint: { x: parseFloat(eqPos.x.toFixed(2)), y: parseFloat(eqPos.y.toFixed(2)) },
    airflowCfm: returnCfm,
    shape: 'rectangular',
    widthIn: 24,
    heightIn: 12,
    velocityFpm: 750,
    allowableVelocityFpm: 850,
    frictionLossPer100Ft: 0.05,
    fittingLossInWg: 0.015,
    totalSectionLossInWg: 0.02,
    ncRating: 22,
    connectedDiffuserCount: returnTerminals.length,
    connectedDiffusers: returnTerminals.map((t) => t.id),
    childDuctIds: []
  });

  return ducts;
}
