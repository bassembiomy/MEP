import { describe, expect, it } from 'vitest';
import { selectEquipmentForLoad } from '../systemArchitecture/equipmentSelector';
import type { EquipmentCatalogItem } from '../types';

function equipment(overrides: Partial<EquipmentCatalogItem> = {}): EquipmentCatalogItem {
  return {
    id: 'fixture-concealed', manufacturer: 'Fixture', model: 'Fixture 30K',
    systemType: 'concealed',
    capabilities: {
      supportsDuctNetwork: true, supportsExternalDiffusers: true, supportsReturnDuct: true,
      supportsMultipleZones: false, requiresIndoorUnitSelection: true, hasExternalStaticPressure: true
    },
    nominalTons: 2.5, totalCapacityBtuPerHour: 30000, sensibleCapacityBtuPerHour: 24000,
    nominalCfm: 1000, minCfm: 600, maxCfm: 1000, maxRatedEspInWg: 0.5,
    fanPerformance: { type: 'tabular', table: [{ cfm: 1000, espInWg: 0.5 }], allowExtrapolation: false },
    electricalKw: 3, efficiency: { ratingStandard: 'Fixture', ratingConditions: 'Fixture' },
    soundDba: 40, dimensionsIn: { width: 40, depth: 30, height: 12 },
    connectionSizes: { supplyDuct: '20x10', returnDuct: '24x10' }, costIndex: 20,
    provenance: { source: 'Independent literal test fixture', version: '1', isUserImported: false },
    ...overrides
  };
}

describe('equipment selection integrity', () => {
  it('returns null when the standard catalog cannot satisfy an impossible demand', () => {
    expect(selectEquipmentForLoad(1000000, 100000000)).toBeNull();
  });

  it.each(['packaged', 'unknown', 'fcu'])('never substitutes concealed equipment for %s', (type) => {
    expect(selectEquipmentForLoad(1000, 30000, type, [equipment()])).toBeNull();
  });

  it.each(['chilled-water', 'cwu'])('does not assume %s means an AHU', (type) => {
    expect(selectEquipmentForLoad(1000, 30000, type, [equipment({ systemType: 'ahu' })])).toBeNull();
  });

  it.each([
    { totalCapacityBtuPerHour: 28500 },
    { nominalCfm: 950 }
  ])('rejects equipment providing only 95 percent of a hard demand: %j', (overrides) => {
    expect(selectEquipmentForLoad(1000, 30000, 'concealed', [equipment(overrides)])).toBeNull();
  });

  it('rejects sensible capacity deficiency despite sufficient total capacity', () => {
    expect(selectEquipmentForLoad(1000, 30000, 'concealed', [equipment()], {
      requiredSensibleBtu: 25000
    })).toBeNull();
  });

  it('rejects latent capacity deficiency using total minus sensible capacity', () => {
    expect(selectEquipmentForLoad(1000, 30000, 'concealed', [equipment()], {
      requiredLatentBtu: 7000
    })).toBeNull();
  });

  it('rejects fan ESP deficiency despite sufficient airflow and cooling', () => {
    expect(selectEquipmentForLoad(1000, 30000, 'concealed', [equipment()], {
      requiredEspInWg: 0.6
    })).toBeNull();
  });

  it.each([
    [NaN, 30000], [Infinity, 30000], [-Infinity, 30000], [-1, 30000],
    [1000, NaN], [1000, Infinity], [1000, -Infinity], [1000, -1]
  ])('returns null for invalid demand CFM=%s, Btu/h=%s', (cfm, btu) => {
    expect(selectEquipmentForLoad(cfm, btu, 'concealed', [equipment()])).toBeNull();
  });

  it.each(['requiredSensibleBtu', 'requiredLatentBtu', 'requiredEspInWg'] as const)(
    'rejects invalid optional demand %s', (key) => {
      for (const value of [NaN, Infinity, -Infinity, -1]) {
        expect(selectEquipmentForLoad(1000, 30000, 'concealed', [equipment()], {
          [key]: value
        })).toBeNull();
      }
    }
  );

  it.each([
    { totalCapacityBtuPerHour: NaN }, { totalCapacityBtuPerHour: Infinity },
    { totalCapacityBtuPerHour: -1 }, { sensibleCapacityBtuPerHour: NaN },
    { sensibleCapacityBtuPerHour: Infinity }, { sensibleCapacityBtuPerHour: -1 },
    { sensibleCapacityBtuPerHour: 30001 }, { nominalCfm: NaN },
    { nominalCfm: Infinity }, { nominalCfm: -1 }, { maxRatedEspInWg: NaN },
    { maxRatedEspInWg: Infinity }, { maxRatedEspInWg: -1 }
  ])('rejects invalid catalog performance data: %j', (overrides) => {
    expect(selectEquipmentForLoad(0, 0, 'concealed', [equipment(overrides)])).toBeNull();
  });

  it('accepts exact capacity, sensible, latent, airflow and ESP boundaries', () => {
    const result = selectEquipmentForLoad(1000, 30000, 'concealed', [equipment()], {
      requiredSensibleBtu: 24000, requiredLatentBtu: 6000, requiredEspInWg: 0.5
    });
    expect(result?.model).toBe('Fixture 30K');
    expect(result?.totalCapacityBtu).toBe(30000);
    expect(result?.sensibleCapacityBtu).toBe(24000);
    expect(result?.supplyCfm).toBe(1000);
    expect(result?.availableEspInWg).toBe(0.5);
  });

  it('ranks feasible candidates after removing a closer undersized candidate', () => {
    const result = selectEquipmentForLoad(1000, 30000, 'concealed', [
      equipment({ model: 'Undersized', totalCapacityBtuPerHour: 29999 }),
      equipment({ model: 'Large feasible', totalCapacityBtuPerHour: 40000, nominalCfm: 1400 }),
      equipment({ model: 'Nearest feasible', totalCapacityBtuPerHour: 32000, nominalCfm: 1100 })
    ]);
    expect(result?.model).toBe('Nearest feasible');
  });

  it('ranks only candidates that satisfy optional sensible, latent and ESP demands', () => {
    const result = selectEquipmentForLoad(1000, 30000, 'concealed', [
      equipment({ model: 'Insufficient sensible' }),
      equipment({ model: 'Insufficient latent', sensibleCapacityBtuPerHour: 25000 }),
      equipment({ model: 'Insufficient ESP', totalCapacityBtuPerHour: 32000, sensibleCapacityBtuPerHour: 25000 }),
      equipment({ model: 'Feasible', totalCapacityBtuPerHour: 32000, sensibleCapacityBtuPerHour: 25000, maxRatedEspInWg: 0.6 })
    ], { requiredSensibleBtu: 25000, requiredLatentBtu: 6000, requiredEspInWg: 0.6 });
    expect(result?.model).toBe('Feasible');
  });

  it.each(['split', 'concealed-split', 'CONCEALED'])('retains the physical concealed alias %s', (type) => {
    expect(selectEquipmentForLoad(1000, 30000, type, [equipment()])?.model).toBe('Fixture 30K');
  });

  it.each(['rtu', 'rooftop', 'PACKAGED'])('retains the physical packaged alias %s', (type) => {
    expect(selectEquipmentForLoad(1000, 30000, type, [equipment({ systemType: 'packaged' })])?.model).toBe('Fixture 30K');
  });

  it('returns null for an empty catalog', () => {
    expect(selectEquipmentForLoad(1000, 30000, 'concealed', [])).toBeNull();
  });

  it('accepts finite zero demands and a zero-rated candidate', () => {
    expect(selectEquipmentForLoad(0, 0, 'concealed', [equipment({
      totalCapacityBtuPerHour: 0, sensibleCapacityBtuPerHour: 0,
      nominalCfm: 0, maxRatedEspInWg: 0
    })], { requiredSensibleBtu: 0, requiredLatentBtu: 0, requiredEspInWg: 0 })?.model).toBe('Fixture 30K');
  });
});
