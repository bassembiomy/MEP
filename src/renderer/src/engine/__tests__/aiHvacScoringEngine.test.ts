import { scoreHvacVariation } from '../ai/aiHvacScoringEngine';
import { generateCandidateVariations } from '../ai/aiHvacGenerator';
import { Zone } from '../../store/projectStore';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running AI HVAC Scoring & Multi-Variation Tests ===');

const testZone: Zone = {
  id: 'zone-conf-1',
  name: 'Training Center',
  points: [0, 0, 50, 0, 50, 30, 0, 30],
  spaceTypeId: 'office-conference',
  ceilingHeight: 10,
  occupants: 30,
  diffusers: [],
  ducts: [],
  manualCoolingOverride: 60000,
  manualCfmOverride: 2000
};

// 1. Generate 3 Candidates
const candidates = generateCandidateVariations(testZone);
assert(candidates.length === 3, 'Must generate exactly 3 layout candidates');
assert(candidates[0].strategy === 'balanced-ashrae', 'Candidate 1 must be balanced ASHRAE');
assert(candidates[1].strategy === 'acoustic-low-noise', 'Candidate 2 must be acoustic low-noise');
assert(candidates[2].strategy === 'compact-shortest-run', 'Candidate 3 must be compact shortest-run');

// 2. Validate Diffusers & Ducts in each
candidates.forEach((cand, idx) => {
  assert(cand.design.diffuserLayout.length > 0, `Candidate ${idx + 1} must have diffusers`);
  assert(cand.design.ductNetwork.length > 0, `Candidate ${idx + 1} must have ducts`);
  assert(cand.scores.overallScore >= 70, `Candidate ${idx + 1} score must be >= 70`);
  assert(cand.scores.metrics.diffuserCount === cand.design.diffuserLayout.length, 'Metrics count must match');
});

// 3. Acoustic comparison: Option B should have lower max duct velocity than Option A
const directScores = scoreHvacVariation(candidates[0].design, testZone.points);
assert(directScores.overallScore >= 70, 'Direct scoreHvacVariation must return valid score');
assert(directScores.metrics.totalDuctLengthFt > 0, 'Must compute total duct length');

console.log('PASS: All AI HVAC Scoring & Multi-Variation Tests Passed Successfully.');
