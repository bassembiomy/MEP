import { StandardsProfile, ASHRAE_PROFILE } from './designStandards';

export interface AcousticVelocityLimit {
  role: 'main-trunk' | 'branch' | 'runout' | 'return' | 'plenum';
  targetNc: number;
  maxVelocityFpm: number;
}

export function getRoomNcTarget(
  spaceType: string,
  _profile: StandardsProfile = ASHRAE_PROFILE
): number {
  const norm = spaceType.toLowerCase();
  if (norm.includes('conference') || norm.includes('boardroom')) return 30;
  if (norm.includes('executive') || norm.includes('private office')) return 30;
  if (norm.includes('open office') || norm.includes('open plan')) return 35;
  if (norm.includes('classroom') || norm.includes('lecture')) return 30;
  if (norm.includes('hospital') || norm.includes('patient')) return 30;
  if (norm.includes('auditorium') || norm.includes('theater')) return 25;
  if (norm.includes('lobby') || norm.includes('corridor')) return 40;
  if (norm.includes('retail') || norm.includes('supermarket')) return 40;
  if (norm.includes('kitchen') || norm.includes('cafeteria')) return 45;
  if (norm.includes('mechanical') || norm.includes('plant')) return 50;
  return 35; // default
}

export function getAcousticVelocityLimit(
  role: 'main-trunk' | 'branch' | 'runout' | 'return' | 'plenum',
  targetNc: number = 30,
  profile: StandardsProfile = ASHRAE_PROFILE
): AcousticVelocityLimit {
  const v = profile.velocityLimits;

  if (role === 'return') {
    return { role, targetNc, maxVelocityFpm: v.returnDuct };
  }
  if (role === 'plenum') {
    return { role, targetNc, maxVelocityFpm: v.returnPlenum };
  }

  if (targetNc <= 30) {
    if (role === 'main-trunk') return { role, targetNc, maxVelocityFpm: v.mainTrunkNc30 };
    if (role === 'branch') return { role, targetNc, maxVelocityFpm: v.branchNc30 };
    return { role, targetNc, maxVelocityFpm: v.runoutNc30 };
  } else if (targetNc <= 35) {
    if (role === 'main-trunk') return { role, targetNc, maxVelocityFpm: v.mainTrunkNc35 };
    if (role === 'branch') return { role, targetNc, maxVelocityFpm: v.branchNc35 };
    return { role, targetNc, maxVelocityFpm: v.runoutNc35 };
  } else {
    if (role === 'main-trunk') return { role, targetNc, maxVelocityFpm: v.mainTrunkNc40 };
    if (role === 'branch') return { role, targetNc, maxVelocityFpm: v.branchNc40 };
    return { role, targetNc, maxVelocityFpm: v.runoutNc40 };
  }
}
