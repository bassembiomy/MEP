import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from './terminalPlacer';
import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';

export interface AirDistributionValidationResult {
  status: 'pass' | 'warning' | 'fail';
  throwCheck: { status: 'pass' | 'warning' | 'fail'; minRatio: number; maxRatio: number; message: string };
  shortCircuitCheck: { status: 'pass' | 'warning' | 'fail'; minSeparationFt: number; message: string };
  acousticCheck: { status: 'pass' | 'warning' | 'fail'; maxTerminalNc: number; message: string };
  issues: string[];
}

export function validateTerminalAirDistribution(
  zone: EquipmentServiceZone,
  supplyTerminals: CoordinatedAirTerminal[],
  returnTerminals: CoordinatedAirTerminal[],
  profile: StandardsProfile = ASHRAE_PROFILE
): AirDistributionValidationResult {
  const issues: string[] = [];
  let overallStatus: 'pass' | 'warning' | 'fail' = 'pass';

  // 1. Throw Check
  let minRatio = Infinity;
  let maxRatio = -Infinity;
  let throwStatus: 'pass' | 'warning' | 'fail' = 'pass';

  for (const t of supplyTerminals) {
    if (t.throwRatio < minRatio) minRatio = t.throwRatio;
    if (t.throwRatio > maxRatio) maxRatio = t.throwRatio;

    if (t.throwRatio < profile.diffuserThrow.minThrowRatio) {
      throwStatus = 'warning';
      issues.push(`Terminal ${t.id} throw ratio ${t.throwRatio} is below minimum ${profile.diffuserThrow.minThrowRatio}`);
    } else if (t.throwRatio > profile.diffuserThrow.maxThrowRatio) {
      throwStatus = 'warning';
      issues.push(`Terminal ${t.id} throw ratio ${t.throwRatio} exceeds maximum ${profile.diffuserThrow.maxThrowRatio}`);
    }
  }

  // 2. Anti-Short Circuit Check
  let shortCircuitStatus: 'pass' | 'warning' | 'fail' = 'pass';
  let minSep = Infinity;

  for (const sup of supplyTerminals) {
    for (const ret of returnTerminals) {
      const dx = sup.position.x - ret.position.x;
      const dy = sup.position.y - ret.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minSep) minSep = dist;

      const minReq = sup.throwT50Ft * profile.diffuserThrow.minReturnSupplyOffsetRatio;
      if (dist < minReq) {
        shortCircuitStatus = 'warning';
        issues.push(`Short-circuit risk: Return ${ret.id} is ${dist.toFixed(1)} ft from Supply ${sup.id} (minimum ${minReq.toFixed(1)} ft required)`);
      }
    }
  }

  // 3. Acoustic Check
  let acousticStatus: 'pass' | 'warning' | 'fail' = 'pass';
  let maxNc = 0;
  for (const t of [...supplyTerminals, ...returnTerminals]) {
    if (t.ncRating > maxNc) maxNc = t.ncRating;
    if (t.ncRating > zone.targetNc) {
      acousticStatus = 'warning';
      issues.push(`Terminal ${t.id} NC ${t.ncRating} exceeds space target NC ${zone.targetNc}`);
    }
  }

  if (throwStatus === 'warning' || shortCircuitStatus === 'warning' || acousticStatus === 'warning') {
    overallStatus = 'warning';
  }

  return {
    status: overallStatus,
    throwCheck: {
      status: throwStatus,
      minRatio: minRatio === Infinity ? 1.0 : minRatio,
      maxRatio: maxRatio === -Infinity ? 1.0 : maxRatio,
      message: throwStatus === 'pass' ? 'All diffusers comply with throw criteria' : 'Throw warnings detected'
    },
    shortCircuitCheck: {
      status: shortCircuitStatus,
      minSeparationFt: minSep === Infinity ? 0 : parseFloat(minSep.toFixed(1)),
      message: shortCircuitStatus === 'pass' ? 'Supply to return separation avoids short-circuiting' : 'Short-circuit warnings detected'
    },
    acousticCheck: {
      status: acousticStatus,
      maxTerminalNc: maxNc,
      message: acousticStatus === 'pass' ? `All terminals comply with NC ${zone.targetNc}` : 'Terminal acoustic warnings detected'
    },
    issues
  };
}
