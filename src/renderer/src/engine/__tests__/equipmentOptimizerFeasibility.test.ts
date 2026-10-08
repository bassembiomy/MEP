import { describe, it, expect } from 'vitest';
import { optimizeMultiUnitCandidates } from '../systemArchitecture/equipmentOptimizer';

describe('optimizeMultiUnitCandidates feasibility (rating correctness)', () => {
  it('never recommends a system that is undersized for the load', () => {
    // Matches the 0.95 engineering sizing tolerance used throughout the codebase.
    const TOL = 0.95;
    const failures: string[] = [];
    for (let area = 200; area <= 2000; area += 200) {
      for (let cfm = 400; cfm <= 6000; cfm += 400) {
        const total = cfm * 35;
        const res = optimizeMultiUnitCandidates({
          roomName: 'r',
          sensibleLoadBtu: cfm * 30,
          totalLoadBtu: total,
          requiredCfm: cfm,
          roomAreaSqFt: area,
          maxAvailableCeilingDepthIn: 14,
          systemType: 'concealed'
        });
        const rec = res.recommendedOption;
        if (rec.totalDeliveredCapacityBtu < total * TOL || rec.totalDeliveredCfm < cfm * TOL) {
          failures.push(
            `area=${area} cfm=${cfm} load=${total} recN=${rec.unitCount} ` +
              `cap=${rec.totalDeliveredCapacityBtu} cfm=${rec.totalDeliveredCfm}`
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps recommending the properly sized multi-unit option for the conference hall', () => {
    const res = optimizeMultiUnitCandidates({
      roomName: 'Conference Hall',
      sensibleLoadBtu: 120000,
      totalLoadBtu: 141000,
      requiredCfm: 4000,
      roomAreaSqFt: 1500,
      maxAvailableCeilingDepthIn: 14,
      systemType: 'concealed'
    });
    const rec = res.recommendedOption;
    expect(rec.totalDeliveredCapacityBtu).toBeGreaterThanOrEqual(141000);
    expect(rec.totalDeliveredCfm).toBeGreaterThanOrEqual(4000);
    // Three formerly selected units supplied only 115,500 Btu/h sensible
    // against 120,000 required. Component capacity is a hard requirement.
    expect(rec.equipmentDetails.sensibleCapacityBtu * rec.unitCount).toBeGreaterThanOrEqual(120000);
    expect((rec.equipmentDetails.totalCapacityBtu-rec.equipmentDetails.sensibleCapacityBtu)*rec.unitCount).toBeGreaterThanOrEqual(21000);
    expect(rec.unitCount).toBe(4);
  });
});
