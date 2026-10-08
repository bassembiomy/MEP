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
  if (!Number.isFinite(maxAvailableCeilingDepthIn) || maxAvailableCeilingDepthIn <= 0) {
    throw new Error('Invalid ceiling depth: expected a positive finite value');
  }
  if (!Number.isFinite(profile.ductSizing.maxAspectRatio) || profile.ductSizing.maxAspectRatio <= 0) {
    throw new Error('Invalid maximum duct aspect ratio: expected a positive finite value');
  }
  const standardSizes = getStandardRectangularSizes();
  const sized: SteppedDuctSection[] = [];

  for (const s of sections) {
    const cfm = s.airflowCfm;
    const targetNc = s.ncRating ?? 30;
    if (!Number.isFinite(cfm) || cfm < 0) {
      throw new Error(`Invalid airflow for section ${s.id}: expected a nonnegative finite value`);
    }
    if (!Number.isFinite(targetNc) || targetNc < 0) {
      throw new Error(`Invalid NC target for section ${s.id}: expected a nonnegative finite value`);
    }
    if (![s.startPoint.x, s.startPoint.y, s.endPoint.x, s.endPoint.y].every(Number.isFinite)) {
      throw new Error(`Invalid coordinates for section ${s.id}: expected finite values`);
    }
    const velocityRule = getAcousticVelocityLimit(
      s.systemType === 'return' ? 'return' : s.role,
      targetNc,
      profile
    );

    const allowableVelocity = velocityRule.maxVelocityFpm;
    if (!Number.isFinite(allowableVelocity) || allowableVelocity <= 0) {
      throw new Error(`Invalid allowable velocity for section ${s.id}: expected a positive finite value`);
    }

    // Use the exact dimensional aspect ratio rather than its rounded catalog value.
    const candidateSizes = standardSizes.filter(
      (sz) => sz.heightIn <= maxAvailableCeilingDepthIn &&
        sz.widthIn / sz.heightIn <= profile.ductSizing.maxAspectRatio
    );

    // Standard sizes are sorted by area; select the first actually feasible size.
    const bestSize = candidateSizes.find((sz) => cfm / sz.areaSqFt <= allowableVelocity);
    if (!bestSize) {
      throw new Error(`Infeasible duct sizing for section ${s.id}: no standard size satisfies airflow, velocity, ceiling depth and aspect ratio constraints`);
    }

    const actualVelocity = cfm / bestSize.areaSqFt;
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
