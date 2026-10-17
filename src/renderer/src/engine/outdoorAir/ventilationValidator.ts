import { formatAirflow, formatVelocity } from '../../format/units';
import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { OutdoorAirSystem } from './freshAirRouter';

export interface VentilationValidationResult {
  status: 'pass' | 'warning' | 'fail';
  pressurizationStrategy: 'positive' | 'neutral' | 'negative';
  totalDeliveredOaCfm: number;
  totalRequiredOaCfm: number;
  louverVelocityStatus: 'pass' | 'warning' | 'fail';
  equipmentCompatibilityStatus: 'pass' | 'warning' | 'fail';
  issues: string[];
}

export function validateOutdoorAirVentilation(
  oaSystem: OutdoorAirSystem,
  zones: EquipmentServiceZone[]
): VentilationValidationResult {
  const issues: string[] = [];
  let overallStatus: 'pass' | 'warning' | 'fail' = 'pass';

  // 1. Louver face velocity check
  let louverStatus: 'pass' | 'warning' | 'fail' = 'pass';
  if (oaSystem.louver.freeAreaVelocityFpm > oaSystem.louver.maxAllowableFreeAreaVelocityFpm) {
    louverStatus = 'warning';
    issues.push(`Louver free-area velocity ${formatVelocity(oaSystem.louver.freeAreaVelocityFpm, 'imperial')} exceeds maximum ${formatVelocity(oaSystem.louver.maxAllowableFreeAreaVelocityFpm, 'imperial')} (rain penetration risk)`);
  }

  // 2. Equipment compatibility check
  let compatStatus: 'pass' | 'warning' | 'fail' = 'pass';
  for (const z of zones) {
    if (!z.outdoorAirConnectionApproved) {
      compatStatus = 'warning';
      issues.push(`Unit ${z.unitTag} (${z.equipmentModel}) is not rated for direct outdoor-air intake connection`);
    }
  }

  // 3. Air balance sum
  const totalZoneOa = zones.reduce((sum, z) => sum + z.outdoorAirCfm, 0);
  if (Math.abs(totalZoneOa - oaSystem.designOutdoorAirCfm) > 10) {
    issues.push(`Outdoor air distribution mismatch: Louver design ${formatAirflow(oaSystem.designOutdoorAirCfm, 'imperial')} vs Zone sum ${formatAirflow(totalZoneOa, 'imperial')}`);
  }

  if (louverStatus === 'warning' || compatStatus === 'warning') {
    overallStatus = 'warning';
  }

  return {
    status: overallStatus,
    pressurizationStrategy: oaSystem.pressurizationStrategy,
    totalDeliveredOaCfm: totalZoneOa,
    totalRequiredOaCfm: oaSystem.designOutdoorAirCfm,
    louverVelocityStatus: louverStatus,
    equipmentCompatibilityStatus: compatStatus,
    issues
  };
}
