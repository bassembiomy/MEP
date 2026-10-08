import { optimizeUnifiedAirDistributionSystem } from '../neuralControlLoopEngine';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Testing Unified Neural Control Loop Engine ===');

// Test 1: Standard 400 CFM Office (NC target 30)
const res1 = optimizeUnifiedAirDistributionSystem({
  roomPolygon: [0, 0, 20, 0, 20, 15, 0, 15],
  roomAreaSqFt: 300,
  requiredCfm: 400,
  totalLoadBtu: 15000,
  spaceNcLimit: 30,
  systemType: 'concealed'
});

console.log(`Test 1 -> Diffusers: ${res1.supplyDiffusers.length}, Coverage: ${res1.coveragePercent}%, Max NC: ${res1.maxDiffuserNc}, ESP: ${res1.estimatedEspInWg} in.wg, Iterations: ${res1.iterations}`);
assert(res1.converged, 'Optimization must converge');
assert(res1.coveragePercent >= 95.0, `Coverage must be >= 95%, got ${res1.coveragePercent}%`);
assert(res1.maxDiffuserNc <= 30, `Diffuser NC must be <= 30, got ${res1.maxDiffuserNc}`);
assert(res1.supplyDiffusers.reduce((sum, d) => sum + d.cfm, 0) === 400, 'CFM sum must be 400');

// Test 2: Noise-Sensitive Auditorium (NC target 25, 1200 CFM)
const res2 = optimizeUnifiedAirDistributionSystem({
  roomPolygon: [0, 0, 40, 0, 40, 30, 0, 30],
  roomAreaSqFt: 1200,
  requiredCfm: 1200,
  totalLoadBtu: 48000,
  spaceNcLimit: 25,
  systemType: 'concealed'
});

console.log(`Test 2 -> Diffusers: ${res2.supplyDiffusers.length}, Coverage: ${res2.coveragePercent}%, Max NC: ${res2.maxDiffuserNc}`);
assert(res2.converged, 'Auditorium optimization must converge');
assert(res2.coveragePercent >= 95.0, `Auditorium coverage must be >= 95%, got ${res2.coveragePercent}%`);
assert(res2.maxDiffuserNc <= 25, `Auditorium NC must be <= 25, got ${res2.maxDiffuserNc}`);
assert(res2.supplyDiffusers.reduce((sum, d) => sum + d.cfm, 0) === 1200, 'CFM sum must match 1200');

// Test 3: Large Multi-Wing / High-CFM Space (4000 CFM, 2000 sq ft)
const res3 = optimizeUnifiedAirDistributionSystem({
  roomPolygon: [0, 0, 50, 0, 50, 40, 0, 40],
  roomAreaSqFt: 2000,
  requiredCfm: 4000,
  totalLoadBtu: 160000,
  spaceNcLimit: 32,
  systemType: 'concealed'
});

console.log(`Test 3 -> Equipment Count: ${res3.equipmentCount}, Diffusers: ${res3.supplyDiffusers.length}, Coverage: ${res3.coveragePercent}%`);
assert(res3.converged, 'Large space optimization must converge');
assert(res3.coveragePercent >= 95.0, `Large space coverage must be >= 95%, got ${res3.coveragePercent}%`);
assert(res3.equipmentCount >= 2, 'Large 4000 CFM space should partition into at least 2 coordinated ACU/FCU units');
assert(res3.supplyDiffusers.reduce((sum, d) => sum + d.cfm, 0) === 4000, 'CFM sum must match 4000');

console.log('All Unified Neural Control Loop Tests Passed Successfully!');
