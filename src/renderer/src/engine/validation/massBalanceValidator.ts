import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { OutdoorAirSystem } from '../outdoorAir/freshAirRouter';
import { ValidationPointResult } from './airflowValidator';
import { DEFAULT_RETURN_TO_SUPPLY_RATIO } from '../terminals/returnPlacer';

/** Allowed imbalance as a fraction of supply airflow. */
export const MASS_BALANCE_TOLERANCE = 0.05;

export function validateSystemAirMassBalance(
  zones: EquipmentServiceZone[],
  outdoorAirSystem?: OutdoorAirSystem,
  extra: { exhaustCfm?: number; exfiltrationCfm?: number } = {}
): ValidationPointResult {
  const totalSupply = zones.reduce((sum, z) => sum + z.supplyCfm, 0);
  const totalReturn = zones.reduce((sum, z) => sum + z.returnCfm, 0);
  const totalOa = outdoorAirSystem ? outdoorAirSystem.designOutdoorAirCfm : zones.reduce((sum, z) => sum + z.outdoorAirCfm, 0);

  // Room-level steady-state balance: Supply = Return + Exhaust + Exfiltration.
  // With no measured exhaust/exfiltration data the building is assumed to leak the complement of the
  // default return ratio (supply * (1 - DEFAULT_RETURN_TO_SUPPLY_RATIO)); exhaust defaults to 0.
  const pressurizationStrategy = outdoorAirSystem?.pressurizationStrategy || 'positive';
  const exhaust = extra.exhaustCfm ?? 0;
  const exfil = extra.exfiltrationCfm ?? Math.round(totalSupply * (1 - DEFAULT_RETURN_TO_SUPPLY_RATIO));

  const residual = totalSupply - totalReturn - exhaust - exfil;
  const allowed = MASS_BALANCE_TOLERANCE * totalSupply;
  const isBalanced = totalSupply > 0 && Math.abs(residual) <= allowed;
  const pct = totalSupply > 0 ? (Math.abs(residual) / totalSupply) * 100 : 0;
  const limitPct = (MASS_BALANCE_TOLERANCE * 100).toFixed(0);

  return {
    pointIndex: 3,
    pointName: 'System Air Mass Balance',
    status: isBalanced ? 'PASS' : 'WARNING',
    metric: `Supply: ${totalSupply} CFM, Return: ${totalReturn} CFM, Exhaust: ${exhaust} CFM, Exfiltration: ${exfil} CFM, OA: ${totalOa} CFM [Strategy: ${pressurizationStrategy.toUpperCase()}], Residual: ${Math.round(residual)} CFM (${pct.toFixed(1)}%)`,
    criteria: `|Supply - Return - Exhaust - Exfiltration| <= ${limitPct}% of Supply`,
    message: isBalanced
      ? `System air mass balance closes within ${pct.toFixed(1)}% of supply (limit ${limitPct}%)`
      : `System air mass balance is off by ${Math.round(Math.abs(residual))} CFM (${pct.toFixed(1)}% of supply, limit ${limitPct}%); ${residual > 0 ? 'supply exceeds return + exhaust + exfiltration' : 'return + exhaust + exfiltration exceed supply (negative pressure risk)'}`
  };
}
