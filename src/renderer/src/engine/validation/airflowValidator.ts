import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';

export interface ValidationPointResult {
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
  const errorPercent = equipmentSum > 0 ? (delta / equipmentSum) * 100 : 0;
  const tolerance = profile.tolerances.airflowBalancePercent || 5.0;

  const passed = errorPercent <= tolerance;
  const status: 'PASS' | 'WARNING' | 'FAIL' = passed ? 'PASS' : (errorPercent <= tolerance * 2 ? 'WARNING' : 'FAIL');

  return {
    pointIndex: 1,
    pointName: 'Total Supply Airflow Balance',
    status,
    metric: `${terminalSum} CFM (Diffusers) vs ${equipmentSum} CFM (Equipment) [Error: ${errorPercent.toFixed(1)}%]`,
    criteria: `|Σ Diffuser CFM - Equipment CFM| / Equipment CFM <= ${tolerance}%`,
    message: passed ? 'Supply airflow perfectly balances equipment fan delivery' : `Airflow balance error ${errorPercent.toFixed(1)}% exceeds ${tolerance}% tolerance`
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
  const tolerance = profile.tolerances.roomCfmDeltaMax || 50;

  const passed = delta <= tolerance;
  const status: 'PASS' | 'WARNING' | 'FAIL' = passed ? 'PASS' : 'WARNING';

  return {
    pointIndex: 2,
    pointName: 'Room Airflow Verification',
    status,
    metric: `Delivered ${deliveredCfm} CFM vs Design Required ${requiredCfm} CFM [Delta: ${delta} CFM]`,
    criteria: `|Delivered Room CFM - Design CFM| <= ${tolerance} CFM`,
    message: passed ? 'Delivered room airflow satisfies calculated thermal load requirement' : `Delivered airflow deviates by ${delta} CFM from design requirement`
  };
}
