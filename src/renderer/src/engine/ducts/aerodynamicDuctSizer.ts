import { SteppedDuctSection } from './steppedDuctRouter';
import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';
import { getAcousticVelocityLimit } from '../standards/acousticRules';
import { getStandardRectangularSizes } from '../standards/ductSizingRules';
import { calculateFrictionRatePer100Ft } from './ductPressureCalculator';

export function sizeDuctNetwork(
  sections: SteppedDuctSection[],
  profile: StandardsProfile = ASHRAE_PROFILE,
  maxAvailableCeilingDepthIn: number = 14
): SteppedDuctSection[] {
  const standardSizes = getStandardRectangularSizes();
  const sized: SteppedDuctSection[] = [];

  for (const s of sections) {
    const cfm = s.airflowCfm;
    const velocityRule = getAcousticVelocityLimit(
      s.role === 'main-trunk' ? 'main-trunk' : s.role === 'branch' ? 'branch' : 'runout',
      s.ncRating || 30,
      profile
    );

    const allowableVelocity = velocityRule.maxVelocityFpm;

    // Filter candidate sizes that satisfy max ceiling depth and aspect ratio <= 3.0
    const candidateSizes = standardSizes.filter(
      (sz) => sz.heightIn <= maxAvailableCeilingDepthIn && sz.aspectRatio <= profile.ductSizing.maxAspectRatio
    );

    // Find the smallest size where actual velocity <= allowableVelocity
    let bestSize = candidateSizes[0];
    let minAreaDiff = Infinity;

    for (const sz of candidateSizes) {
      const actualV = cfm / sz.areaSqFt;
      if (actualV <= allowableVelocity + 30) {
        const areaDiff = sz.areaSqFt - cfm / allowableVelocity;
        if (areaDiff >= 0 && areaDiff < minAreaDiff) {
          minAreaDiff = areaDiff;
          bestSize = sz;
        }
      }
    }

    if (!bestSize) {
      bestSize = candidateSizes[candidateSizes.length - 1];
    }

    const actualVelocity = Math.round(cfm / bestSize.areaSqFt);
    const frictionRate = calculateFrictionRatePer100Ft(cfm, bestSize.equivalentDiameterIn);

    const dx = s.endPoint.x - s.startPoint.x;
    const dy = s.endPoint.y - s.startPoint.y;
    const lengthFt = Math.hypot(dx, dy);

    const vp = Math.pow(actualVelocity / 4005, 2);
    const c = s.role === 'main-trunk' ? 0.20 : s.role === 'runout' ? 0.35 : 0.15;
    const fittingLoss = parseFloat((c * vp).toFixed(4));
    const frictionLoss = parseFloat(((frictionRate * lengthFt) / 100).toFixed(4));
    const totalLoss = parseFloat((frictionLoss + fittingLoss).toFixed(4));

    sized.push({
      ...s,
      widthIn: bestSize.widthIn,
      heightIn: bestSize.heightIn,
      diameterIn: bestSize.equivalentDiameterIn,
      velocityFpm: actualVelocity,
      allowableVelocityFpm: allowableVelocity,
      frictionLossPer100Ft: frictionRate,
      fittingLossInWg: fittingLoss,
      totalSectionLossInWg: totalLoss
    });
  }

  return sized;
}
