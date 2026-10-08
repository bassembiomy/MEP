import { describe, it, expect } from 'vitest';
import { planDuctedAirDistribution } from '../spatialPlanner';
import { sizeDuct } from '../ductSizer';

describe('Telescopic Stepped Duct Sizing & Acoustic Constraints', () => {
  it('enforces velocity limits strictly in sizeDuct', () => {
    const branchSizing = sizeDuct(600, 0.10, 10, 800);
    expect(branchSizing.velocityFpm).toBeLessThanOrEqual(800);
    expect(branchSizing.isVelocityAcceptable).toBe(true);

    const trunkSizing = sizeDuct(1600, 0.10, 12, 1100);
    expect(trunkSizing.velocityFpm).toBeLessThanOrEqual(1100);
    expect(trunkSizing.isVelocityAcceptable).toBe(true);
  });

  it('generates telescopically reduced trunk segments along the airflow path', () => {
    const roomPoints = [0, 0, 400, 0, 400, 200, 0, 200];
    const totalCfm = 1200;

    const distribution = planDuctedAirDistribution(
      roomPoints,
      null,
      totalCfm,
      'sys-test-1',
      'zone-1',
      'concealed',
      30,
      'imperial',
      10
    );

    const trunkSegments = distribution.ducts.filter(d => d.type === 'trunk');
    expect(trunkSegments.length).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < trunkSegments.length - 1; i++) {
      expect(trunkSegments[i].cfm).toBeGreaterThanOrEqual(trunkSegments[i + 1].cfm);
      expect(trunkSegments[i].widthIn * trunkSegments[i].heightIn).toBeGreaterThanOrEqual(
        trunkSegments[i + 1].widthIn * trunkSegments[i + 1].heightIn
      );
    }

    for (const duct of distribution.ducts) {
      if (duct.type === 'trunk') {
        expect(duct.velocityFpm || 0).toBeLessThanOrEqual(1300);
      } else if (duct.type === 'branch') {
        expect(duct.velocityFpm || 0).toBeLessThanOrEqual(950);
      }
    }
  });
});
