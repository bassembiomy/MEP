import { describe, expect, it } from 'vitest';
import { sizeDuctNetwork } from '../ducts/aerodynamicDuctSizer';
import type { SteppedDuctSection } from '../ducts/steppedDuctRouter';
import { ASHRAE_PROFILE, type StandardsProfile } from '../standards/designStandards';

function section(overrides: Partial<SteppedDuctSection> = {}): SteppedDuctSection {
  return {
    id: 'duct-1', unitId: 'unit-1', designControlMode: 'ai', systemType: 'supply',
    role: 'main-trunk', startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 0 },
    airflowCfm: 400, shape: 'rectangular', widthIn: 6, heightIn: 6,
    velocityFpm: 0, allowableVelocityFpm: 0, frictionLossPer100Ft: 0,
    fittingLossInWg: 0, totalSectionLossInWg: 0, ncRating: 30,
    connectedDiffuserCount: 0, connectedDiffusers: [], childDuctIds: [], ...overrides
  };
}

function profileWith(overrides: Partial<StandardsProfile['ductSizing']>): StandardsProfile {
  return { ...ASHRAE_PROFILE, ductSizing: { ...ASHRAE_PROFILE.ductSizing, ...overrides } };
}

describe('duct sizing integrity', () => {
  it('throws infeasible sizing instead of selecting the smallest duct for impossible airflow', () => {
    expect(() => sizeDuctNetwork([section({ airflowCfm: 100000 })])).toThrow(/infeasible.*duct-1/i);
  });

  it('reports infeasible sizing clearly when ceiling depth excludes every standard size', () => {
    expect(() => sizeDuctNetwork([section()], ASHRAE_PROFILE, 5)).toThrow(/infeasible.*duct-1/i);
  });

  it('reports infeasible sizing when a valid aspect-ratio constraint excludes every size', () => {
    expect(() => sizeDuctNetwork([section()], profileWith({ maxAspectRatio: 0.9 }))).toThrow(/infeasible.*duct-1/i);
  });

  it.each([NaN, Infinity, -Infinity, -1])('rejects invalid airflow %s', (airflowCfm) => {
    expect(() => sizeDuctNetwork([section({ airflowCfm })])).toThrow(/invalid.*airflow/i);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects invalid ceiling depth %s', (depth) => {
    expect(() => sizeDuctNetwork([section()], ASHRAE_PROFILE, depth)).toThrow(/invalid.*ceiling/i);
  });

  it.each([NaN, Infinity, -Infinity, -1])('rejects invalid NC target %s', (ncRating) => {
    expect(() => sizeDuctNetwork([section({ ncRating })])).toThrow(/invalid.*nc/i);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects invalid maximum aspect ratio %s', (maxAspectRatio) => {
    expect(() => sizeDuctNetwork([section()], profileWith({ maxAspectRatio }))).toThrow(/invalid.*aspect/i);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])('rejects invalid governing velocity %s', (mainTrunkNc30) => {
    const profile = { ...ASHRAE_PROFILE, velocityLimits: { ...ASHRAE_PROFILE.velocityLimits, mainTrunkNc30 } };
    expect(() => sizeDuctNetwork([section()], profile)).toThrow(/invalid.*velocity/i);
  });

  it.each([
    { startPoint: { x: NaN, y: 0 } }, { startPoint: { x: 0, y: Infinity } },
    { endPoint: { x: -Infinity, y: 0 } }, { endPoint: { x: 10, y: NaN } }
  ])('rejects invalid section coordinates: %j', (overrides) => {
    expect(() => sizeDuctNetwork([section(overrides)])).toThrow(/invalid.*coordinates/i);
  });

  it('compares exact dimensional aspect ratio rather than the catalog rounded ratio', () => {
    const [sized] = sizeDuctNetwork([section({ role: 'runout', airflowCfm: 230 })], profileWith({ maxAspectRatio: 1.33 }));
    // 8x6 has aspect ratio 1.333..., exceeding 1.33. The next feasible size is 8x8.
    expect([sized.widthIn, sized.heightIn]).toEqual([8, 8]);
    expect(sized.velocityFpm).toBe(517.5);
  });

  it('preserves exact velocity instead of rounding away a fractional result', () => {
    const [sized] = sizeDuctNetwork([section({ airflowCfm: 400.1 })]);
    // 6x6 gives 1600.4 FPM; 8x6 gives 1200.3 FPM; 10x6 gives 960.24 FPM.
    expect([sized.widthIn, sized.heightIn]).toEqual([10, 6]);
    expect(sized.velocityFpm).toBeCloseTo(960.24, 10);
    expect(sized.velocityFpm).toBeLessThanOrEqual(1200);
  });

  it('uses the return duct velocity limit for return sections', () => {
    const [sized] = sizeDuctNetwork([section({ systemType: 'return', airflowCfm: 400 })]);
    expect(sized.allowableVelocityFpm).toBe(900);
    expect([sized.widthIn, sized.heightIn]).toEqual([8, 8]);
    expect(sized.velocityFpm).toBe(900);
  });

  it('accepts exact velocity, ceiling and aspect ratio boundaries', () => {
    const [sized] = sizeDuctNetwork([section({ airflowCfm: 400 })], profileWith({ maxAspectRatio: 4 / 3 }), 6);
    expect([sized.widthIn, sized.heightIn]).toEqual([8, 6]);
    expect(sized.velocityFpm).toBe(1200);
    expect(sized.allowableVelocityFpm).toBe(1200);
  });

  it('accepts zero airflow and preserves an NC target of zero', () => {
    const [sized] = sizeDuctNetwork([section({ airflowCfm: 0, ncRating: 0 })]);
    expect(sized.ncRating).toBe(0);
    expect(sized.velocityFpm).toBe(0);
    expect(sized.totalSectionLossInWg).toBe(0);
  });

  it('returns an empty array for an empty network with valid constraints', () => {
    expect(sizeDuctNetwork([])).toEqual([]);
  });
});
