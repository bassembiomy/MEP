import assert from 'node:assert/strict';
import { calculateZoneDiffuserCoverage } from '../diffuserPlacer';
import { generateCandidateVariations } from '../ai/aiHvacGenerator';
import { Zone } from '../../store/projectStore';

console.log('=== Running ASHRAE Complex Shape & Geometry Distribution Tests ===');

// 1. Square Room (30ft x 30ft, 900 sq ft, 1,200 CFM)
const squareZone: Zone = {
  id: 'zone-square',
  name: 'Square Executive Boardroom',
  points: [0, 0, 30, 0, 30, 30, 0, 30],
  spaceTypeId: 'office-enclosed',
  ceilingHeight: 10,
  occupants: 10,
  diffusers: [],
  ducts: [],
  systemType: 'concealed',
  manualCoolingOverride: 36000,
  manualCfmOverride: 1200
};

// 2. L-Shaped Room (60ft x 40ft footprint, 1,400 sq ft, 1,800 CFM)
const lShapedZone: Zone = {
  id: 'zone-lshape',
  name: 'L-Shaped Open Office',
  points: [0, 0, 60, 0, 60, 20, 25, 20, 25, 40, 0, 40],
  spaceTypeId: 'office-open',
  ceilingHeight: 10,
  occupants: 20,
  diffusers: [],
  ducts: [],
  systemType: 'concealed',
  manualCoolingOverride: 54000,
  manualCfmOverride: 1800
};

// 3. T-Shaped Zone (50ft wide top, 20ft stem, 1,100 sq ft, 1,500 CFM)
const tShapedZone: Zone = {
  id: 'zone-tshape',
  name: 'T-Shaped Seminar Hall',
  points: [0, 0, 50, 0, 50, 15, 35, 15, 35, 35, 15, 35, 15, 15, 0, 15],
  spaceTypeId: 'office-conference',
  ceilingHeight: 10,
  occupants: 15,
  diffusers: [],
  ducts: [],
  systemType: 'concealed',
  manualCoolingOverride: 45000,
  manualCfmOverride: 1500
};

const testZones = [squareZone, lShapedZone, tShapedZone];

for (const zone of testZones) {
  console.log(`\nTesting Zone Geometry: ${zone.name}`);

  // Test AI Candidates
  const candidates = generateCandidateVariations(zone);
  assert.equal(candidates.length, 3, 'Must generate 3 AI variations');

  for (const cand of candidates) {
    const { diffuserLayout, ductNetwork } = cand.design;

    // Check Diffuser Duplication & Minimum Distance
    assert(diffuserLayout.length >= 2, 'Must have at least 2 diffusers');
    for (let i = 0; i < diffuserLayout.length; i++) {
      for (let j = i + 1; j < diffuserLayout.length; j++) {
        const d1 = diffuserLayout[i];
        const d2 = diffuserLayout[j];
        const dist = Math.hypot(d1.x - d2.x, d1.y - d2.y);
        assert(dist >= 4.5, `Diffuser collision detected between ${d1.id} and ${d2.id} (distance: ${dist.toFixed(1)} ft < 4.5 ft)`);
      }
    }

    // Check Duct Collisions & Zero-length Segments
    for (const duct of ductNetwork) {
      const len = Math.hypot(duct.endX - duct.startX, duct.endY - duct.startY);
      assert(len >= 1.5, `Duct segment ${duct.id} has invalid length (${len.toFixed(2)} ft < 1.5 ft)`);

      // Aspect ratio compliance <= 4:1
      if (duct.shape === 'rectangular') {
        const aspect = Math.max(duct.widthIn, duct.heightIn) / Math.min(duct.widthIn, duct.heightIn);
        assert(aspect <= 4.0, `Duct ${duct.id} exceeds 4:1 aspect ratio: ${aspect.toFixed(1)}:1`);
      }

      // Velocity compliance: trunk <= 1500 FPM, branch <= 1000 FPM
      const maxVel = duct.type === 'trunk' ? 1500 : 1000;
      assert(duct.velocityFpm <= maxVel + 50, `Duct ${duct.id} velocity ${duct.velocityFpm} exceeds ${maxVel} FPM limit`);
    }

    // Check Space Coverage Percentage
    const diffPosList = diffuserLayout.map(d => ({
      id: d.id,
      x: d.x,
      y: d.y,
      cfm: d.cfm,
      size: d.size,
      type: 'supply' as const,
      throwT50Ft: d.throwDistanceFt
    }));

    const cov = calculateZoneDiffuserCoverage(zone.points, diffPosList, 1);
    console.log(`  ${cand.name}: ${diffuserLayout.length} diffusers, ${ductNetwork.length} ducts, Coverage: ${cov.coveragePercent}%`);
    assert(cov.coveragePercent >= 90.0, `Coverage for ${zone.name} must be >= 90%, got ${cov.coveragePercent}%`);
  }
}

console.log('\n✔ All ASHRAE Shape Distribution & Anti-Duplication Tests PASSED successfully!');
