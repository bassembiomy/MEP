import { describe, it, expect } from 'vitest';
import { generateSystemCandidates } from '../systemDesigner';

describe('Equipment Lowest Cost Optimization & Selection', () => {
  it('selects the lowest total cost equipment satisfying capacity and CFM', () => {
    const totalLoadBtu = 30000;
    const sensibleLoadBtu = 24000;
    const supplyCfm = 1000;
    const spaceTypeId = 'office';
    const areaSqFt = 600;

    const weights = {
      wCost: 0.90,
      wComfort: 0.02,
      wEnergy: 0.02,
      wNoise: 0.02,
      wPressure: 0.02,
      wSpace: 0.01,
      wPreference: 0.01
    };

    const selectedTypes = ['concealed', 'fcu', 'packaged', 'ahu'];

    const result = generateSystemCandidates(
      totalLoadBtu,
      sensibleLoadBtu,
      supplyCfm,
      spaceTypeId,
      areaSqFt,
      true,
      weights,
      selectedTypes
    );

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.lowestCost).not.toBeNull();

    const lowestCostCand = result.lowestCost!;
    expect(lowestCostCand.isValid).toBe(true);
    const lowestCostTotal = lowestCostCand.equipment.costIndex * lowestCostCand.quantity;

    for (const cand of result.candidates) {
      if (cand.isValid) {
        const candTotal = cand.equipment.costIndex * cand.quantity;
        expect(candTotal).toBeGreaterThanOrEqual(lowestCostTotal);
      }
    }
  });

  it('respects system type filter toggles strictly', () => {
    const totalLoadBtu = 24000;
    const sensibleLoadBtu = 18000;
    const supplyCfm = 800;

    const resultPackaged = generateSystemCandidates(
      totalLoadBtu,
      sensibleLoadBtu,
      supplyCfm,
      'office',
      500,
      true,
      {},
      ['packaged']
    );

    for (const cand of resultPackaged.candidates) {
      expect(cand.systemType).toBe('packaged');
    }

    const resultConcealed = generateSystemCandidates(
      totalLoadBtu,
      sensibleLoadBtu,
      supplyCfm,
      'office',
      500,
      true,
      {},
      ['concealed']
    );

    for (const cand of resultConcealed.candidates) {
      expect(cand.systemType).toBe('concealed');
    }
  });
});
