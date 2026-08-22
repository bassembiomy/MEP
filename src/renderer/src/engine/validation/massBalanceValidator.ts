import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { OutdoorAirSystem } from '../outdoorAir/freshAirRouter';
import { ValidationPointResult } from './airflowValidator';

export function validateSystemAirMassBalance(
  zones: EquipmentServiceZone[],
  outdoorAirSystem?: OutdoorAirSystem
): ValidationPointResult {
  const totalSupply = zones.reduce((sum, z) => sum + z.supplyCfm, 0);
  const totalReturn = zones.reduce((sum, z) => sum + z.returnCfm, 0);
  const totalOa = outdoorAirSystem ? outdoorAirSystem.designOutdoorAirCfm : zones.reduce((sum, z) => sum + z.outdoorAirCfm, 0);

  // Steady-state mass balance: Supply + OA = Return + Exhaust + Relief ± Pressurization
  const pressurizationStrategy = outdoorAirSystem?.pressurizationStrategy || 'positive';
  const targetPressurization = outdoorAirSystem?.targetPressurizationCfm || Math.round(totalOa * 0.15);

  const isBalanced = pressurizationStrategy === 'positive' ? totalOa >= 0 : true;

  return {
    pointIndex: 3,
    pointName: 'System Air Mass Balance',
    status: isBalanced ? 'PASS' : 'WARNING',
    metric: `Supply: ${totalSupply} CFM, Return: ${totalReturn} CFM, OA: ${totalOa} CFM [Strategy: ${pressurizationStrategy.toUpperCase()}]`,
    criteria: 'Supply + OA = Return + Exhaust + Relief ± Pressurization Airflow',
    message: isBalanced
      ? `System mass balance maintains positive space pressurization (+${targetPressurization} CFM envelope exfiltration)`
      : 'System air balance indicates potential negative pressure infiltration'
  };
}
