import { routeSteppedSupplyDucts, SteppedDuctSection } from '../ducts/steppedDuctRouter';
import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';

export function adaptRouteAndSizeDucts(
  zone: EquipmentServiceZone,
  supplyTerminals: CoordinatedAirTerminal[]
): SteppedDuctSection[] {
  return routeSteppedSupplyDucts(zone, supplyTerminals);
}
