import { SteppedDuctSection } from './steppedDuctRouter';

/**
 * Calculates duct friction loss in in. w.g. / 100 ft using the standard ASHRAE duct friction equation
 * frictionLossPer100Ft = 0.109136 * (CFM^1.9) / (De^5.02)
 */
export function calculateFrictionRatePer100Ft(cfm: number, equivalentDiameterIn: number): number {
  if (cfm <= 0 || equivalentDiameterIn <= 0) return 0;
  const loss = (0.109136 * Math.pow(cfm, 1.9)) / Math.pow(equivalentDiameterIn, 5.02);
  return parseFloat(loss.toFixed(3));
}

/**
 * Calculates total section friction loss given length in feet
 */
export function calculateDuctFrictionLoss(section: SteppedDuctSection): number {
  const dx = section.endPoint.x - section.startPoint.x;
  const dy = section.endPoint.y - section.startPoint.y;
  const lengthFt = Math.hypot(dx, dy);

  return parseFloat(((section.frictionLossPer100Ft * lengthFt) / 100).toFixed(4));
}
