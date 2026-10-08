import type { EquipmentServiceZone } from '../zoning/zonePartitioner';
import type { OutdoorAirSystem } from '../outdoorAir/freshAirRouter';
import type { ValidationPointResult } from './airflowValidator';

/** Return means room return, not the recirculated portion downstream of relief. */
export function validateSystemAirMassBalance(
  zones: EquipmentServiceZone[],
  outdoorAirSystem?: OutdoorAirSystem
): ValidationPointResult {
  const failures: string[] = [];
  if (!zones.length) failures.push('No equipment air-balance evidence');
  for (const z of zones) {
    const exhaust = z.exhaustCfm ?? 0;
    const values = [z.supplyCfm, z.returnCfm, z.outdoorAirCfm, exhaust];
    if (!values.every(v => Number.isFinite(v) && v >= 0)) {
      failures.push(`${z.id}: invalid airflow`);
      continue;
    }
    if (z.outdoorAirCfm > z.supplyCfm) failures.push(`${z.id}: outdoor airflow exceeds supply`);
    if (Math.abs(z.supplyCfm - z.returnCfm - exhaust) > Math.max(1, z.supplyCfm * 0.05)) {
      failures.push(`${z.id}: room supply does not balance room return plus exhaust`);
    }
  }
  const totalSupply = zones.reduce((sum, z) => sum + z.supplyCfm, 0);
  const totalReturn = zones.reduce((sum, z) => sum + z.returnCfm, 0);
  const totalOa = zones.reduce((sum, z) => sum + z.outdoorAirCfm, 0);
  if (outdoorAirSystem && (!Number.isFinite(outdoorAirSystem.designOutdoorAirCfm) ||
      outdoorAirSystem.designOutdoorAirCfm < totalOa)) failures.push('Outdoor-air source is insufficient');
  return {
    pointIndex: 3, pointName: 'System Air Mass Balance',
    status: failures.length ? 'FAIL' : 'PASS',
    metric: `Supply: ${totalSupply} CFM, Room Return: ${totalReturn} CFM, OA within supply: ${totalOa} CFM`,
    criteria: 'Room supply = room return + exhaust; 0 <= outdoor air <= supply',
    message: failures.length ? failures.join('; ') : 'Preliminary room airflow balances; relief and pressurization require separate verification'
  };
}
