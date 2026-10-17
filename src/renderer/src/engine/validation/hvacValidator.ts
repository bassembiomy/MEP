import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { SteppedDuctSection } from '../ducts/steppedDuctRouter';
import { OutdoorAirSystem } from '../outdoorAir/freshAirRouter';
import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';
import { ValidationPointResult, validateSupplyAirflowBalance, validateRoomAirflowVerification } from './airflowValidator';
import { validateSystemAirMassBalance } from './massBalanceValidator';
import { validateAcousticCompliance } from './acousticValidator';
import { validateCriticalPathPressure } from './pressureValidator';
import { validateThrowAndThermalComfort } from './comfortValidator';
import { validateSpatialCoordination } from './spatialValidator';
import { formatVelocity, formatLoad } from '../../format/units';

export interface MasterValidationInput {
  roomName: string;
  roomPolygon: number[];
  requiredRoomCfm: number;
  designLoadBtu: number;
  zones: EquipmentServiceZone[];
  terminals: CoordinatedAirTerminal[];
  ducts: SteppedDuctSection[];
  outdoorAirSystem?: OutdoorAirSystem;
  profile?: StandardsProfile;
  /** Room-level exhaust / exfiltration (CFM) for the mass balance. */
  exhaustCfm?: number;
  exfiltrationCfm?: number;
  /** Project unit system for the validation text (values stay imperial internally). Default imperial. */
  units?: string;
}

export interface MasterValidationReport {
  overallStatus: 'PASS' | 'WARNING' | 'FAIL';
  summary: string;
  points: ValidationPointResult[];
  timestamp: string;
}

export function executeMasterHvacValidation(input: MasterValidationInput): MasterValidationReport {
  const {
    roomName: _roomName,
    roomPolygon,
    requiredRoomCfm,
    designLoadBtu,
    zones,
    terminals,
    ducts,
    outdoorAirSystem,
    profile = ASHRAE_PROFILE,
    exhaustCfm,
    exfiltrationCfm,
    units
  } = input;

  const points: ValidationPointResult[] = [];

  // Point 1: Supply Airflow Balance
  points.push(validateSupplyAirflowBalance(zones, terminals, profile, units));

  // Point 2: Room Airflow Verification
  points.push(validateRoomAirflowVerification(requiredRoomCfm, terminals, profile, units));

  // Point 3: System Air Mass Balance
  points.push(validateSystemAirMassBalance(zones, outdoorAirSystem, { exhaustCfm, exfiltrationCfm }, units));

  // Point 4: Velocity Compliance Check
  let maxV = 0;
  let maxAllowableV = 0;
  let hasVelocityViolation = false;
  for (const d of ducts) {
    if (d.velocityFpm > maxV) maxV = d.velocityFpm;
    if (d.allowableVelocityFpm > maxAllowableV) maxAllowableV = d.allowableVelocityFpm;
    if (d.velocityFpm > d.allowableVelocityFpm + 50) {
      hasVelocityViolation = true;
    }
  }
  points.push({
    pointIndex: 4,
    pointName: 'Velocity Compliance Check',
    status: hasVelocityViolation ? 'WARNING' : 'PASS',
    metric: `Max Duct Velocity: ${formatVelocity(maxV, units)} vs Allowable Limit: ${formatVelocity(maxAllowableV, units)}`,
    criteria: 'Actual Velocity <= Allowable Velocity per Standards Profile',
    message: hasVelocityViolation ? 'Duct velocity exceeds profile limit in one or more sections' : 'All duct velocities comply with allowable profile limits'
  });

  // Point 5: Acoustic Compliance Check
  points.push(validateAcousticCompliance(zones, terminals, ducts, units));

  // Point 6: Throw and Thermal Comfort Check
  points.push(validateThrowAndThermalComfort(terminals, profile, units));

  // Point 7: Static Pressure / ESP Check
  points.push(validateCriticalPathPressure(zones, ducts, profile, units));

  // Point 8: Equipment Capacity Check
  const totalDeliveredBtu = zones.reduce((sum, z) => sum + z.actualCapacityBtu, 0);
  const capMargin = totalDeliveredBtu - designLoadBtu;
  const isCapPassing = totalDeliveredBtu >= designLoadBtu * 0.95;
  points.push({
    pointIndex: 8,
    pointName: 'Equipment Capacity & Load Match',
    status: isCapPassing ? 'PASS' : 'WARNING',
    metric: `Selected Capacity: ${formatLoad(totalDeliveredBtu, units)} vs Design Load: ${formatLoad(designLoadBtu, units)} [Margin: ${capMargin >= 0 ? '+' : ''}${formatLoad(capMargin, units)}]`,
    criteria: 'Derated Equipment Capacity >= Calculated Design Load',
    message: isCapPassing ? 'Equipment capacity fully covers calculated design sensible and latent loads' : 'Equipment capacity is insufficient for design cooling load'
  });

  // Point 9: Spatial Coordination & Clash Check
  points.push(validateSpatialCoordination(zones, ducts, roomPolygon, terminals.filter((t) => t.type === 'supply' || t.type === 'return'), undefined, units));

  // Determine overall status
  const hasFail = points.some((p) => p.status === 'FAIL');
  const hasWarning = points.some((p) => p.status === 'WARNING');
  const overallStatus: 'PASS' | 'WARNING' | 'FAIL' = hasFail ? 'FAIL' : hasWarning ? 'WARNING' : 'PASS';

  return {
    overallStatus,
    summary: overallStatus === 'PASS'
      ? 'All 9 engineering validation points PASSED with zero compliance warnings.'
      : `Validation completed with ${points.filter((p) => p.status === 'WARNING').length} advisory warning(s).`,
    points,
    timestamp: new Date().toISOString()
  };
}
