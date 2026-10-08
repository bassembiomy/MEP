import { describe, it, expect } from 'vitest';
import {
  placeDiffusersWithCircularOptimization,
  calculateZoneDiffuserCoverage
} from '../diffuserPlacer';

describe('Minimal Diffuser 98% Coverage & Acoustic Optimization', () => {
  it('ensures diffusers achieve >= 98% geometric coverage while respecting NC limits', () => {
    const roomPoints = [0, 0, 200, 0, 200, 300, 0, 300];
    const scale = 10;
    const cfm = 900;
    const spaceNcLimit = 30;

    const diffusers = placeDiffusersWithCircularOptimization(
      roomPoints,
      cfm,
      true,
      scale,
      scale,
      [],
      'concealed',
      600,
      {
        coverageTargetPercent: 98,
        spaceNcLimit
      }
    );

    const supplyDiffusers = diffusers.filter(d => d.type === 'supply');
    expect(supplyDiffusers.length).toBeGreaterThanOrEqual(1);

    for (const d of supplyDiffusers) {
      if (d.actualNc !== undefined) {
        expect(d.actualNc).toBeLessThanOrEqual(spaceNcLimit);
      }
    }

    const cov = calculateZoneDiffuserCoverage(roomPoints, supplyDiffusers, scale, true);
    expect(cov.coveragePercent).toBeGreaterThanOrEqual(98);
  });

  it('tries larger catalog throw sizes first before adding extra diffusers', () => {
    const scale = 10;
    const smallRoom = [0, 0, 120, 0, 120, 140, 0, 140];
    const diffusers = placeDiffusersWithCircularOptimization(
      smallRoom,
      300,
      true,
      scale,
      scale,
      [],
      'concealed',
      168,
      {
        coverageTargetPercent: 98,
        spaceNcLimit: 30
      }
    );

    const supplyDiffusers = diffusers.filter(d => d.type === 'supply');
    expect(supplyDiffusers.length).toBe(1);

    const cov = calculateZoneDiffuserCoverage(smallRoom, supplyDiffusers, scale, true);
    expect(cov.coveragePercent).toBeGreaterThanOrEqual(98);
  });
});
