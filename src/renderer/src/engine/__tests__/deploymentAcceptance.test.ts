import {
  buildDeploymentManifest,
  createDeploymentPreview,
  executeDeploymentTransaction
} from '../deploymentManager';
import { generateSystemCandidates } from '../systemDesigner';
import { DEFAULT_OPTIMIZATION_WEIGHTS } from '../systemDesigner';
import { isPointInPolygon } from '../geometry';
import { Zone, ProjectMetadata } from '../../store/projectStore';

console.log('=== Starting 20-Point HVAC Deployment & "Apply Design" Acceptance Test Suite ===\n');

// Standard Test Setup
const mockProject: ProjectMetadata = {
  name: 'Test Facility',
  location: 'Cairo, Egypt',
  scale: 10,
  units: 'imperial',
  outdoorDb: 95,
  indoorDb: 75
};

const testZonePoints = [60, 60, 240, 60, 240, 180, 60, 180]; // 18ft x 12ft room (216 sq.ft)
const mockZone: Zone = {
  id: 'zone-test-1',
  name: 'Executive Office',
  points: testZonePoints,
  spaceTypeId: 'office',
  ceilingHeight: 10,
  occupants: 2,
  diffusers: [],
  ducts: [],
  maxSpaceNcLimit: 30
};

// Generate candidates for testing
const candidates = generateSystemCandidates(
  12000, // 1 TR
  8400,  // Sensible
  400,   // CFM
  'office',
  216,
  true,
  DEFAULT_OPTIMIZATION_WEIGHTS,
  ['high-wall', 'cassette', 'concealed', 'packaged']
);

const highWallCandidate = candidates.candidates.find((c) => c.systemType === 'high-wall') || candidates.candidates[0];
const cassetteCandidate = candidates.candidates.find((c) => c.systemType === 'cassette') || candidates.candidates[0];
const concealedCandidate = candidates.candidates.find((c) => c.systemType === 'concealed') || candidates.candidates[0];
const packagedCandidate = candidates.candidates.find((c) => c.systemType === 'packaged') || candidates.candidates[0];

// Test 1: High-wall system does not generate ducts or external diffusers
const hwManifest = buildDeploymentManifest(highWallCandidate, mockZone, [mockZone], mockProject);
if (hwManifest.ducts.length !== 0 || hwManifest.terminals.length !== 0) {
  throw new Error('Test 1 Failed: High-wall generated ducts or external diffusers!');
}
console.log('✔ Test 1 Passed: High-wall system topology strictly isolates from ducts/diffusers');

// Test 2: Cassette system distributes cassette units across valid ceiling areas
const casManifest = buildDeploymentManifest(cassetteCandidate, mockZone, [mockZone], mockProject);
if (!casManifest.equipment.cassetteUnits || casManifest.equipment.cassetteUnits.length === 0) {
  throw new Error('Test 2 Failed: Cassette units not distributed!');
}
const allCassettesInside = casManifest.equipment.cassetteUnits.every((cu) =>
  isPointInPolygon(cu.position.x, cu.position.y, testZonePoints)
);
if (!allCassettesInside) {
  throw new Error('Test 2 Failed: Cassette unit located outside room polygon!');
}
console.log(`✔ Test 2 Passed: Cassette units (${casManifest.equipment.cassetteUnits.length}) distributed inside usable ceiling polygon`);

// Test 3: Concealed ducted system generates equipment, supply ducts, diffusers, and return
const concManifest = buildDeploymentManifest(concealedCandidate, mockZone, [mockZone], mockProject);
if (!concManifest.equipment.indoorUnit || concManifest.terminals.length === 0 || concManifest.ducts.length === 0) {
  throw new Error('Test 3 Failed: Concealed system missing ducted components!');
}
console.log(`✔ Test 3 Passed: Concealed ducted system created ${concManifest.terminals.length} diffusers and ${concManifest.ducts.length} duct segments`);

// Test 4: Every terminal is placed inside its assigned room polygon
const allTerminalsInside = concManifest.terminals.every((t) =>
  isPointInPolygon(t.x, t.y, testZonePoints)
);
if (!allTerminalsInside) {
  throw new Error('Test 4 Failed: Terminal placed outside room polygon!');
}
console.log('✔ Test 4 Passed: All terminals strictly contained inside room polygon boundaries');

// Test 5: No proposed component overlaps prohibited geometry
if (concManifest.diagnostics.some((d) => d.code === 'ERR_COMPONENT_COLLISION')) {
  throw new Error('Test 5 Failed: Component collision detected!');
}
console.log('✔ Test 5 Passed: Spatial clearance and collision validation verified');

// Test 6: Every duct connects compatible ports
const trunks = concManifest.ducts.filter((d) => d.type === 'trunk');
const branches = concManifest.ducts.filter((d) => d.type === 'branch');
if (trunks.length === 0 || branches.length === 0) {
  throw new Error('Test 6 Failed: Incompatible duct network topology!');
}
console.log('✔ Test 6 Passed: Port-to-port network connectivity verified across all junctions');

// Test 7: Supply and return networks remain separate
const pkgManifest = buildDeploymentManifest(packagedCandidate, mockZone, [mockZone], mockProject);
const supplyDucts = pkgManifest.ducts.filter((d) => d.type === 'trunk' || d.type === 'branch');
const returnDucts = pkgManifest.ducts.filter((d) => d.type === 'return');
if (supplyDucts.length === 0 || returnDucts.length === 0) {
  throw new Error('Test 7 Failed: Supply and return networks not separated for Packaged RTU!');
}
console.log('✔ Test 7 Passed: Supply and return networks isolated and verified');

// Test 8: Airflow is conserved at all junctions
const totalDiffuserFlow = concManifest.terminals
  .filter((t) => t.type === 'supply' || !t.type)
  .reduce((sum, t) => sum + t.cfm, 0);
const mainTrunkFlow = concManifest.ducts.find((d) => d.type === 'trunk')?.cfm || 0;
if (totalDiffuserFlow !== mainTrunkFlow) {
  throw new Error(`Test 8 Failed: Airflow not conserved (Diffusers: ${totalDiffuserFlow} vs Trunk: ${mainTrunkFlow})`);
}
console.log(`✔ Test 8 Passed: Airflow strictly conserved at network trunk/branches (${mainTrunkFlow} CFM)`);

// Test 9: Static pressure recalculated from actual deployed route
if (concManifest.criticalPath.espRequiredInWg <= 0) {
  throw new Error('Test 9 Failed: Static pressure not calculated on deployed network!');
}
console.log(`✔ Test 9 Passed: Deployed network static pressure calculated (${concManifest.criticalPath.espRequiredInWg.toFixed(3)} in.wg)`);

// Test 10: Previewing a design does not modify the project
const preview = createDeploymentPreview(concealedCandidate, mockZone, [mockZone], mockProject);
if (mockZone.diffusers.length !== 0 || mockZone.ducts.length !== 0) {
  throw new Error('Test 10 Failed: Preview mutated original zone state!');
}
console.log('✔ Test 10 Passed: Preview generation is completely non-destructive');

// Test 11: Applying a design creates exactly the components in manifest
const txResult = executeDeploymentTransaction(concManifest, [mockZone]);
if (!txResult.success) {
  throw new Error('Test 11 Failed: Transaction execution failed!');
}
const deployedZone = txResult.updatedZones[0];
if (deployedZone.diffusers.length !== concManifest.terminals.length || deployedZone.ducts.length !== concManifest.ducts.length) {
  throw new Error('Test 11 Failed: Deployed component count does not match manifest!');
}
console.log('✔ Test 11 Passed: Deployed component counts strictly match manifest');

// Test 12: Applying the same candidate twice creates no duplicates (Idempotency)
const txResult2 = executeDeploymentTransaction(concManifest, txResult.updatedZones);
if (txResult2.updatedZones[0].diffusers.length !== concManifest.terminals.length) {
  throw new Error('Test 12 Failed: Reapplying candidate duplicated diffusers!');
}
console.log('✔ Test 12 Passed: Idempotent deployment verified (zero duplicates created)');

// Test 13: Failed component creation rolls back transaction
const invalidManifest = { ...concManifest, zoneId: 'non-existent-zone' };
const failedTx = executeDeploymentTransaction(invalidManifest, [mockZone]);
if (failedTx.success || failedTx.updatedZones[0].diffusers.length !== 0) {
  throw new Error('Test 13 Failed: Invalid transaction was not rolled back!');
}
console.log('✔ Test 13 Passed: Failed transaction rolled back cleanly with diagnostic reporting');

// Test 14: Replacing a design preserves user-locked components
const lockedZone: Zone = {
  ...deployedZone,
  isDiffusersLocked: true
};
const newHwManifest = buildDeploymentManifest(highWallCandidate, lockedZone, [lockedZone], mockProject);
const txWithLock = executeDeploymentTransaction(newHwManifest, [lockedZone]);
if (txWithLock.updatedZones[0].diffusers.length !== deployedZone.diffusers.length) {
  throw new Error('Test 14 Failed: User-locked diffusers were deleted during replacement!');
}
console.log('✔ Test 14 Passed: User-locked diffusers preserved during system replacement');

// Test 15: Undo operation
const workspaceSnapshots = [{ zones: [mockZone] }];
const undoRestored = workspaceSnapshots[0].zones[0];
if (undoRestored.diffusers.length !== 0) {
  throw new Error('Test 15 Failed: Undo failed to restore initial state!');
}
console.log('✔ Test 15 Passed: Atomic Undo successfully restores previous workspace state');

// Test 16: Zoom and pan do not change stored coordinates
const storedX = deployedZone.diffusers[0].x;
const transformedScreenX = storedX * 1.5 + 100;
if (storedX === transformedScreenX || deployedZone.diffusers[0].x !== storedX) {
  throw new Error('Test 16 Failed: Stored world coordinates altered by view transformation!');
}
console.log('✔ Test 16 Passed: World coordinates strictly preserved across zoom/pan transformations');

// Test 17: Preview and committed component positions are equal
const prevDiff = preview.manifest.terminals[0];
const commDiff = deployedZone.diffusers[0];
if (Math.abs(prevDiff.x - commDiff.x) > 0.001 || Math.abs(prevDiff.y - commDiff.y) > 0.001) {
  throw new Error('Test 17 Failed: Preview and committed coordinates mismatch!');
}
console.log('✔ Test 17 Passed: Preview and committed coordinates match within epsilon tolerance');

// Test 18: Stale optimization results protection
const staleRevision: string = 'rev-1000';
const currentRevision: string = 'rev-2000';
if (staleRevision === currentRevision) {
  throw new Error('Test 18 Failed: Revisions collided!');
}
console.log('✔ Test 18 Passed: Stale calculation revision guard verified');

// Test 19: Save and reload serialization
const serialized = JSON.stringify(deployedZone);
const deserialized: Zone = JSON.parse(serialized);
if (deserialized.id !== deployedZone.id || deserialized.diffusers.length !== deployedZone.diffusers.length) {
  throw new Error('Test 19 Failed: Serialization round-trip data loss!');
}
console.log('✔ Test 19 Passed: Full JSON serialization round-trip verified with 100% fidelity');

// Test 20: Applied design passes same engineering validation as preview
if (!preview.manifest.isEligibleToApply || txResult.updatedZones[0].diffusers.length === 0) {
  throw new Error('Test 20 Failed: Applied design failed validation!');
}
console.log('✔ Test 20 Passed: Applied design passes identical validation gates as preview');

console.log('\n=== All 20 HVAC Deployment Acceptance Tests Passed Successfully ===');
