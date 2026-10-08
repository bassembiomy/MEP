import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { ValidationPointResult } from './airflowValidator';
import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';
import { calculateZoneDiffuserCoverage } from '../diffuserPlacer';

export function validateThrowAndThermalComfort(
  terminals: CoordinatedAirTerminal[],
  profile: StandardsProfile = ASHRAE_PROFILE,
  roomPolygon?: number[],
  coverageTargetPercent: number = 95
): ValidationPointResult {
  const supplyTerminals = terminals.filter((t) => t.type === 'supply');
  let minRatio = Infinity;
  let maxRatio = -Infinity;
  let hasThrowViolation = supplyTerminals.length === 0;

  for (const t of supplyTerminals) {
    if (t.throwRatio < minRatio) minRatio = t.throwRatio;
    if (t.throwRatio > maxRatio) maxRatio = t.throwRatio;
    if (!Number.isFinite(t.throwRatio) || t.throwRatio < profile.diffuserThrow.minThrowRatio || t.throwRatio > profile.diffuserThrow.maxThrowRatio) {
      hasThrowViolation = true;
    }
  }

  let coverageText = '';
  let isCoverageFailing = false;
  if (roomPolygon && roomPolygon.length >= 6 && supplyTerminals.length > 0) {
    const diffPositions = supplyTerminals.map((t) => ({
      id: t.id,
      x: t.position.x,
      y: t.position.y,
      cfm: t.cfm,
      size: t.faceDimension || '12"x12"',
      throwT50Ft: t.throwT50Ft,
      type: 'supply' as const
    }));
    const cov = calculateZoneDiffuserCoverage(roomPolygon, diffPositions, 1.0, true);
    coverageText = ` | Estimated Circular Throw Coverage: ${cov.coveragePercent}% (Target >= ${coverageTargetPercent}%)`;
    if (!Number.isFinite(cov.coveragePercent) || cov.coveragePercent < coverageTargetPercent) {
      isCoverageFailing = true;
    }
  }

  const passed = !hasThrowViolation && !isCoverageFailing;

  return {
    pointIndex: 6,
    pointName: 'Throw & Thermal Comfort Check',
    status: passed ? 'PASS' : 'WARNING',
    metric: `Throw Ratios (T50/L): ${minRatio === Infinity ? 'N/A' : minRatio.toFixed(2)} min to ${maxRatio === -Infinity ? 'N/A' : maxRatio.toFixed(2)} max [Target Envelope: ${profile.diffuserThrow.minThrowRatio} - ${profile.diffuserThrow.maxThrowRatio}]${coverageText}`,
    criteria: `${profile.diffuserThrow.minThrowRatio} <= T50 / L <= ${profile.diffuserThrow.maxThrowRatio}, Circular Coverage >= ${coverageTargetPercent}%; occupied-zone velocity unverified`,
    message: passed
      ? 'Estimated throw and plan coverage satisfy configured targets; occupied-zone comfort and draft risk require verification'
      : 'Diffuser throw warnings detected (potential air stagnation, insufficient circular coverage, or excessive occupied-zone velocity)'
  };
}
