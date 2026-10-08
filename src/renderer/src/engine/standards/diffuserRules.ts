import { StandardsProfile, ASHRAE_PROFILE } from './designStandards';

export interface DiffuserThrowCriteria {
  diffuserType: string;
  minThrowRatio: number; // T50 / Characteristic Length L
  maxThrowRatio: number;
  minReturnSupplyOffsetRatio: number;
  maxNeckVelocityFpm: number;
}

/**
 * Lecture 07 Table 4: Maximum Permissible CFM per Diffuser based on Ceiling Height
 */
export const CEILING_HEIGHT_MAX_CFM_TABLE: { ceilingHeightFt: number; maxCfm: number; maxTempDiffF: number }[] = [
  { ceilingHeightFt: 8, maxCfm: 800, maxTempDiffF: 20 },
  { ceilingHeightFt: 10, maxCfm: 2000, maxTempDiffF: 26 },
  { ceilingHeightFt: 12, maxCfm: 3000, maxTempDiffF: 30 },
  { ceilingHeightFt: 14, maxCfm: 5000, maxTempDiffF: 30 },
  { ceilingHeightFt: 16, maxCfm: 6400, maxTempDiffF: 30 }
];

export function getMaxCfmForCeilingHeight(ceilingHeightFt: number = 9): number {
  if (ceilingHeightFt <= 8) return 800;
  if (ceilingHeightFt <= 10) return 2000;
  if (ceilingHeightFt <= 12) return 3000;
  if (ceilingHeightFt <= 14) return 5000;
  return 6400;
}

/**
 * Lecture 07 Table 1: Sound Level (NC) vs Maximum Allowable Neck Velocity (FPM)
 */
export function getMaxNeckVelocityForNc(ncLimit: number): number {
  if (ncLimit <= 20) return 500;
  if (ncLimit <= 30) return 700;
  if (ncLimit <= 35) return 900;
  if (ncLimit <= 40) return 1100;
  return 1400;
}

export function getDiffuserThrowCriteria(
  diffuserType: string = '4-way-ceiling',
  profile: StandardsProfile = ASHRAE_PROFILE,
  spaceNcLimit: number = 30
): DiffuserThrowCriteria {
  const norm = diffuserType.toLowerCase();
  let maxNeck = getMaxNeckVelocityForNc(spaceNcLimit);
  if (norm.includes('slot')) maxNeck = Math.min(maxNeck, 800);
  if (norm.includes('swirl')) maxNeck = Math.min(maxNeck, 750);
  if (norm.includes('jet')) maxNeck = Math.min(maxNeck, 1400);

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
