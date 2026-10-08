import type { EquipmentServiceZone } from '../zoning/zonePartitioner';
import type { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import type { SteppedDuctSection } from './steppedDuctRouter';

/** Preliminary direct grille-to-fan paths; spatial validation must approve every centerline. */
export function routeReturnDucts(zone: EquipmentServiceZone, terminals: CoordinatedAirTerminal[] = []): SteppedDuctSection[] {
  if (zone.isDucted === false || zone.returnCfm === 0) return [];
  return terminals.filter(t => t.unitId === zone.id && t.type === 'return').map((terminal, index) => ({
    id: `RDS-${zone.unitTag}-${index + 1}`, unitId: zone.id, designControlMode: 'ai',
    systemType: 'return', role: 'branch',
    startPoint: { ...terminal.position }, endPoint: { x: zone.equipmentPosition.x, y: zone.equipmentPosition.y },
    airflowCfm: terminal.cfm, shape: 'rectangular', widthIn: 12, heightIn: 12,
    velocityFpm: terminal.cfm, allowableVelocityFpm: 850,
    // Sizing computes pressure from these actual coordinates and flow before validation.
    frictionLossPer100Ft: 0, fittingLossInWg: 0, totalSectionLossInWg: 0,
    ncRating: zone.targetNc, connectedDiffuserCount: 1, connectedDiffusers: [terminal.id], childDuctIds: []
  }));
}
