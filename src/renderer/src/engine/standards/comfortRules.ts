import { StandardsProfile, ASHRAE_PROFILE } from './designStandards';

export interface ComfortVelocityEnvelope {
  activityLevel: 'sedentary' | 'light-work' | 'heavy-work';
  mode: 'cooling' | 'heating';
  draftSensitive: boolean;
  minVelocityFpm: number;
  maxVelocityFpm: number;
  targetVelocityFpm: number;
}

export function getComfortVelocityEnvelope(
  activityLevel: 'sedentary' | 'light-work' | 'heavy-work' = 'sedentary',
  draftSensitive: boolean = false,
  mode: 'cooling' | 'heating' = 'cooling',
  _profile: StandardsProfile = ASHRAE_PROFILE
): ComfortVelocityEnvelope {
  let minV = 20;
  let maxV = 50;
  let targetV = 40;

  if (mode === 'heating') {
    maxV = 40;
    targetV = 30;
  }

  if (draftSensitive) {
    maxV = Math.min(maxV, 35);
    targetV = 25;
  }

  if (activityLevel === 'light-work') {
    maxV += 15;
    targetV += 10;
  } else if (activityLevel === 'heavy-work') {
    maxV += 30;
    targetV += 20;
  }

  return {
    activityLevel,
    mode,
    draftSensitive,
    minVelocityFpm: minV,
    maxVelocityFpm: maxV,
    targetVelocityFpm: targetV
  };
}

export function evaluateOccupiedZoneVelocity(
  actualVelocityFpm: number,
  envelope: ComfortVelocityEnvelope
): { status: 'pass' | 'warning' | 'fail'; message: string } {
  if (actualVelocityFpm < envelope.minVelocityFpm) {
    return {
      status: 'warning',
      message: `Occupied zone velocity ${actualVelocityFpm} FPM below minimum ${envelope.minVelocityFpm} FPM (air stagnation risk)`
    };
  }
  if (actualVelocityFpm > envelope.maxVelocityFpm) {
    return {
      status: 'warning',
      message: `Occupied zone velocity ${actualVelocityFpm} FPM exceeds maximum ${envelope.maxVelocityFpm} FPM (occupant draft risk)`
    };
  }
  return {
    status: 'pass',
    message: `Occupied zone velocity ${actualVelocityFpm} FPM is within acceptable comfort range (${envelope.minVelocityFpm} - ${envelope.maxVelocityFpm} FPM)`
  };
}
