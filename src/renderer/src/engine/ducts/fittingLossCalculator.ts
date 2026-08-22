import { SteppedDuctSection } from './steppedDuctRouter';

export interface FittingLossDetail {
  fittingType: 'elbow' | 'transition' | 'takeoff-branch' | 'terminal-boot' | 'collar';
  lossCoefficientC: number;
  velocityPressureInWg: number;
  lossInWg: number;
}

export function calculateFittingLosses(sections: SteppedDuctSection[]): number {
  let totalLoss = 0;

  for (const s of sections) {
    const vp = Math.pow(s.velocityFpm / 4005, 2);

    let c = 0.15; // default takeoff or transition
    if (s.role === 'main-trunk') c = 0.20;
    else if (s.role === 'runout') c = 0.35; // includes diffuser boot

    const fittingLoss = parseFloat((c * vp).toFixed(4));
    totalLoss += fittingLoss;
  }

  return parseFloat(totalLoss.toFixed(4));
}
