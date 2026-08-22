import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { SteppedDuctSection } from '../ducts/steppedDuctRouter';
import { ValidationPointResult } from './airflowValidator';
import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';

export function validateCriticalPathPressure(
  zones: EquipmentServiceZone[],
  ducts: SteppedDuctSection[],
  profile: StandardsProfile = ASHRAE_PROFILE
): ValidationPointResult {
  // Sum critical path: supply duct friction + fittings + terminal drop + return duct + safety margin
  let totalDuctFriction = 0;
  let totalFittingLoss = 0;

  for (const d of ducts) {
    totalDuctFriction += (d.frictionLossPer100Ft * Math.hypot(d.endPoint.x - d.startPoint.x, d.endPoint.y - d.startPoint.y)) / 100;
    totalFittingLoss += d.fittingLossInWg;
  }

  const terminalDrop = 0.04;
  const returnDrop = 0.05;
  const marginPercent = profile.tolerances.staticPressureSafetyMarginPercent || 15.0;

  const rawTotalLoss = totalDuctFriction + totalFittingLoss + terminalDrop + returnDrop;
  const totalWithSafetyMargin = parseFloat((rawTotalLoss * (1 + marginPercent / 100)).toFixed(3));

  const availableEsp = zones[0]?.espInWg || 0.35;
  const passed = totalWithSafetyMargin <= availableEsp;

  return {
    pointIndex: 7,
    pointName: 'Static Pressure & ESP Margin',
    status: passed ? 'PASS' : 'WARNING',
    metric: `Critical Path Total: ${totalWithSafetyMargin.toFixed(3)} in. wg (incl ${marginPercent}% margin) vs Available Fan ESP: ${availableEsp.toFixed(2)} in. wg`,
    criteria: 'Total Critical Path Loss + Safety Margin <= Equipment Rated ESP',
    message: passed
      ? `Equipment fan ESP (${availableEsp} in. wg) provides ${(availableEsp - totalWithSafetyMargin).toFixed(3)} in. wg excess static pressure margin`
      : `Critical path pressure loss ${totalWithSafetyMargin} in. wg exceeds fan ESP ${availableEsp} in. wg (upsize ducts or select high-static unit)`
  };
}
