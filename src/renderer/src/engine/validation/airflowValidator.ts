import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';

export interface ValidationPointResult {
  zoneId?: string;
  pointIndex: number;
  pointName: string;
  status: 'PASS' | 'WARNING' | 'FAIL';
  metric: string;
  criteria: string;
  message: string;
}

export function validateSupplyAirflowBalance(
  zones: EquipmentServiceZone[],
  terminals: CoordinatedAirTerminal[],
  profile: StandardsProfile = ASHRAE_PROFILE
): ValidationPointResult {
  const supplyTerminals = terminals.filter((t) => t.type === 'supply');
  const terminalSum = supplyTerminals.reduce((sum, t) => sum + t.cfm, 0);
  const equipmentSum = zones.reduce((sum, z) => sum + z.supplyCfm, 0);

  const delta = Math.abs(terminalSum - equipmentSum);
  const errorPercent = equipmentSum > 0 ? (delta / equipmentSum) * 100 : terminalSum > 0 ? Infinity : 0;
  const tolerance = profile.tolerances.airflowBalancePercent ?? 5.0;

  const passed = zones.length > 0 && [terminalSum, equipmentSum, tolerance].every(Number.isFinite) &&
    equipmentSum >= 0 && terminalSum >= 0 && tolerance >= 0 && errorPercent <= tolerance;
  const status = passed ? 'PASS' : 'FAIL';

  return {
    pointIndex: 1,
    pointName: 'Total Supply Airflow Balance',
    status,
    metric: `${terminalSum} CFM (Diffusers) vs ${equipmentSum} CFM (Equipment) [Error: ${errorPercent.toFixed(1)}%]`,
    criteria: `|Σ Diffuser CFM - Equipment CFM| / Equipment CFM <= ${tolerance}%`,
    message: passed ? 'Supply airflow balances within tolerance' : `Airflow balance error ${errorPercent.toFixed(1)}% exceeds ${tolerance}% tolerance`
  };
}

export function validateRoomAirflowVerification(
  requiredCfm: number,
  terminals: CoordinatedAirTerminal[],
  profile: StandardsProfile = ASHRAE_PROFILE
): ValidationPointResult {
  const supplyTerminals = terminals.filter((t) => t.type === 'supply');
  const deliveredCfm = supplyTerminals.reduce((sum, t) => sum + t.cfm, 0);

  const delta = Math.abs(deliveredCfm - requiredCfm);
  const tolerance = profile.tolerances.roomCfmDeltaMax ?? 50;

  const passed = [deliveredCfm, requiredCfm, tolerance].every(Number.isFinite) && requiredCfm >= 0 &&
    deliveredCfm >= 0 && tolerance >= 0 && delta <= tolerance;
  const status = passed ? 'PASS' : 'FAIL';

  return {
    pointIndex: 2,
    pointName: 'Room Airflow Verification',
    status,
    metric: `Delivered ${deliveredCfm} CFM vs Design Required ${requiredCfm} CFM [Delta: ${delta} CFM]`,
    criteria: `|Delivered Room CFM - Design CFM| <= ${tolerance} CFM`,
    message: passed ? 'Delivered room airflow satisfies calculated thermal load requirement' : `Delivered airflow deviates by ${delta} CFM from design requirement`
  };
}
