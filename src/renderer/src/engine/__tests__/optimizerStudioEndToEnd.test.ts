import { describe, it, expect } from 'vitest';
import { generateSystemCandidates } from '../systemDesigner';
import { createDeploymentPreview } from '../deploymentManager';
import { Zone, ProjectMetadata } from '../../store/projectStore';
import { calculateZoneLoad } from '../loadCalc';

describe('Optimizer Studio End-to-End AC Design Pipeline', () => {
  const mockProject: ProjectMetadata = {
    name: 'Test Project',
    location: 'Cairo, Egypt',
    units: 'imperial',
    scale: 10,
    outdoorDb: 104,
    indoorDb: 75
  };

  const mockZone: Zone = {
    id: 'zone-opt-1',
    name: 'Executive Conference Room',
    // 30ft x 40ft room = 1200 sq ft (300px x 400px at scale 10)
    points: [0, 0, 300, 0, 300, 400, 0, 400],
    spaceTypeId: 'conference',
    ceilingHeight: 10,
    occupants: 12,
    ducts: [],
    diffusers: [],
    maxSpaceNcLimit: 28
  };

  it('runs complete 4-step optimization from zone geometry to deployment preview', () => {
    // 1. Calculate Load
    const loadResult = calculateZoneLoad(mockZone, mockProject);
    expect(loadResult.totalLoad).toBeGreaterThan(0);
    expect(loadResult.supplyCfm).toBeGreaterThan(0);

    // 2. Generate Candidate Designs with FCU / ACU / AHU filter
    const recommendations = generateSystemCandidates(
      loadResult.totalLoad,
      loadResult.sensibleLoad,
      loadResult.supplyCfm,
      mockZone.spaceTypeId,
      loadResult.area,
      true,
      { wCost: 0.6, wComfort: 0.2, wNoise: 0.2 },
      ['concealed', 'packaged', 'ahu', 'fcu']
    );

    expect(recommendations.candidates.length).toBeGreaterThan(0);
    const bestCand = recommendations.bestOverall || recommendations.candidates[0];
    expect(bestCand.isValid).toBe(true);

    // 3. Create Deployment Preview
    const preview = createDeploymentPreview(
      bestCand,
      mockZone,
      [mockZone],
      mockProject,
      [],
      null
    );

    expect(preview.manifest.terminals.length).toBeGreaterThan(0);
    const supplyDiffusers = preview.manifest.terminals.filter(t => t.type === 'supply');
    expect(supplyDiffusers.length).toBeGreaterThanOrEqual(1);

    // 4. Verify Telescopic Duct Network
    if (bestCand.equipment.capabilities.supportsDuctNetwork) {
      expect(preview.manifest.ducts.length).toBeGreaterThan(0);
      const trunkDucts = preview.manifest.ducts.filter(d => d.type === 'trunk');
      if (trunkDucts.length > 1) {
        expect(trunkDucts[0].cfm).toBeGreaterThanOrEqual(trunkDucts[trunkDucts.length - 1].cfm);
      }
    }
  });
});
