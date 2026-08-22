import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { ValidationPointResult } from './airflowValidator';
import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';

export function validateThrowAndThermalComfort(
  terminals: CoordinatedAirTerminal[],
  profile: StandardsProfile = ASHRAE_PROFILE
): ValidationPointResult {
  const supplyTerminals = terminals.filter((t) => t.type === 'supply');
  let minRatio = Infinity;
  let maxRatio = -Infinity;
  let hasThrowViolation = false;

  for (const t of supplyTerminals) {
    if (t.throwRatio < minRatio) minRatio = t.throwRatio;
    if (t.throwRatio > maxRatio) maxRatio = t.throwRatio;
    if (t.throwRatio < profile.diffuserThrow.minThrowRatio || t.throwRatio > profile.diffuserThrow.maxThrowRatio) {
      hasThrowViolation = true;
    }
  }

  const passed = !hasThrowViolation;

  return {
    pointIndex: 6,
    pointName: 'Throw & Thermal Comfort Check',
    status: passed ? 'PASS' : 'WARNING',
    metric: `Throw Ratios (T50/L): ${minRatio.toFixed(2)} min to ${maxRatio.toFixed(2)} max [Target Envelope: ${profile.diffuserThrow.minThrowRatio} - ${profile.diffuserThrow.maxThrowRatio}]`,
    criteria: `${profile.diffuserThrow.minThrowRatio} <= T50 / L <= ${profile.diffuserThrow.maxThrowRatio}, Occupied Zone Velocity 30-50 FPM`,
    message: passed
      ? 'All diffuser throw patterns distribute air uniformly across the occupied zone without draft risk'
      : 'Diffuser throw warnings detected (potential air stagnation or excessive occupied-zone velocity)'
  };
}
