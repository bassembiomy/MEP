import { calculateZoneLoad } from '../loadCalc';
import { generateSystemCandidates } from '../systemDesigner';
import { buildDeploymentManifest, executeDeploymentTransaction } from '../deploymentManager';
import { ProjectMetadata } from '../../store/projectStore';

const project: ProjectMetadata = {
  name: 'Test Project',
  location: 'Cairo, Egypt',
  scale: 10,
  equipmentScale: 1.5,
  units: 'imperial',
  outdoorDb: 95,
  indoorDb: 75
};

const testPolygons = [
  { name: 'Standard 4-point Box', points: [100, 100, 400, 100, 400, 300, 100, 300] },
  { name: 'Double-click duplicated vertex', points: [100, 100, 400, 100, 400, 300, 100, 300, 100, 300] },
  { name: 'Canvas screen coords', points: [250, 150, 650, 150, 650, 450, 250, 450] },
  { name: 'Triangle', points: [100, 100, 400, 100, 250, 350] },
  { name: 'Small polygon', points: [10, 10, 30, 10, 30, 30, 10, 30] },
  { name: 'Huge millimeter CAD polygon', points: [1000, 1000, 15000, 1000, 15000, 10000, 1000, 10000] }
];

for (const tp of testPolygons) {
  console.log(`Testing ${tp.name}...`);
  try {
    const draftZone = {
      id: 'test-zone',
      name: 'Test Zone',
      points: tp.points,
      spaceTypeId: 'office',
      ceilingHeight: 10,
      occupants: 1,
      systemType: 'concealed' as const,
      distributionPattern: 'hexagonal' as const,
      coverageTargetPercent: 100,
      diffusers: [],
      ducts: [],
      maxVelocityLimitFpm: 1200,
      maxSpaceNcLimit: 32
    };

    const load = calculateZoneLoad(draftZone, project);
    console.log(`  Area: ${load.area}, Total Load: ${load.totalLoad}, CFM: ${load.supplyCfm}`);

    const recommendations = generateSystemCandidates(
      load.totalLoad,
      load.sensibleLoad,
      load.supplyCfm,
      draftZone.spaceTypeId,
      load.area,
      project.units === 'imperial',
      undefined,
      undefined,
      null
    );
    console.log(`  Found ${recommendations.candidates.length} candidates. Best: ${recommendations.candidates[0]?.equipment.model}`);

    const bestCandidate = recommendations.candidates[0];
    if (bestCandidate) {
      const manifest = buildDeploymentManifest(
        bestCandidate,
        draftZone,
        [],
        project,
        [],
        null
      );
      console.log(`  Manifest: ${manifest.terminals.length} terminals, ${manifest.ducts.length} ducts, ${manifest.componentsToAdd.length} components`);
      const txResult = executeDeploymentTransaction(manifest, [draftZone]);
      const newZone = txResult.updatedZones[0];
      console.log('  Deployed: %d diffusers, %d ducts, unitPos:', newZone.diffusers.length, newZone.ducts.length, newZone.unitPos);
    }
  } catch (err: any) {
    console.error('  ERROR on %s:', tp.name, err);
  }
}
console.log('Test completed.');
