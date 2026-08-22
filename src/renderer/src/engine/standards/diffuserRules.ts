import { StandardsProfile, ASHRAE_PROFILE } from './designStandards';

export interface DiffuserThrowCriteria {
  diffuserType: string;
  minThrowRatio: number; // T50 / Characteristic Length L
  maxThrowRatio: number;
  minReturnSupplyOffsetRatio: number;
  maxNeckVelocityFpm: number;
}

export function getDiffuserThrowCriteria(
  diffuserType: string = '4-way-ceiling',
  profile: StandardsProfile = ASHRAE_PROFILE
): DiffuserThrowCriteria {
  const norm = diffuserType.toLowerCase();
  let maxNeck = 600; // quiet design (NC <= 25)
  if (norm.includes('slot')) maxNeck = 700;
  if (norm.includes('swirl')) maxNeck = 650;
  if (norm.includes('jet')) maxNeck = 1000;

  return {
    diffuserType,
    minThrowRatio: profile.diffuserThrow.minThrowRatio,
    maxThrowRatio: profile.diffuserThrow.maxThrowRatio,
    minReturnSupplyOffsetRatio: profile.diffuserThrow.minReturnSupplyOffsetRatio,
    maxNeckVelocityFpm: maxNeck
  };
}

export function evaluateDiffuserThrow(
  t50ThrowFt: number,
  characteristicLengthFt: number,
  criteria: DiffuserThrowCriteria
): { throwRatio: number; status: 'pass' | 'warning' | 'fail'; message: string } {
  if (characteristicLengthFt <= 0) {
    return { throwRatio: 1.0, status: 'pass', message: 'Indeterminate characteristic length' };
  }

  const throwRatio = t50ThrowFt / characteristicLengthFt;

  if (throwRatio >= criteria.minThrowRatio && throwRatio <= criteria.maxThrowRatio) {
    return {
      throwRatio,
      status: 'pass',
      message: `Throw ratio ${throwRatio.toFixed(2)} is within optimal comfort envelope (${criteria.minThrowRatio} - ${criteria.maxThrowRatio})`
    };
  } else if (throwRatio < criteria.minThrowRatio) {
    return {
      throwRatio,
      status: 'warning',
      message: `Throw ratio ${throwRatio.toFixed(2)} is below minimum ${criteria.minThrowRatio} (potential stagnation / under-throw)`
    };
  } else {
    return {
      throwRatio,
      status: 'warning',
      message: `Throw ratio ${throwRatio.toFixed(2)} exceeds maximum ${criteria.maxThrowRatio} (potential draft in occupied zone / wall splashing)`
    };
  }
}
