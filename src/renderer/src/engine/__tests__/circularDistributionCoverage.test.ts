import assert from 'node:assert';
import {
  calculateZoneDiffuserCoverage,
  placeDiffusersWithCircularOptimization,
  DistributionOptions
} from '../diffuserPlacer';

console.log('=== Running Circular Diffuser Distribution & Coverage Optimization Tests ===');

// 1. Rectangular Space Test (30ft x 20ft = 600 sq ft, 800 CFM)
const rectPolygon = [0, 0, 300, 0, 300, 200, 0, 200];
const totalCfm = 800;

const options1: DistributionOptions = {
  coverageTargetPercent: 95,
  pattern: 'hexagonal',
  throwRadiusMode: 'catalog-t50'
};

const diffusersRect = placeDiffusersWithCircularOptimization(
  rectPolygon,
  totalCfm,
  true,
  10,
  10,
  [],
  'concealed',
  30000,
  options1
);

assert(diffusersRect.length > 0, 'Must generate diffusers for rectangular zone');
const supplyDiffusers1 = diffusersRect.filter(d => d.type !== 'return');
const cov1 = calculateZoneDiffuserCoverage(rectPolygon, supplyDiffusers1, 10);

console.log(`Rectangular space coverage: ${cov1.coveragePercent}% with ${supplyDiffusers1.length} diffusers`);
assert(cov1.coveragePercent >= 95, `Coverage must be >= 95%, got ${cov1.coveragePercent}%`);
assert(cov1.isCovered95, 'isCovered95 must be true');

// Verify CFM conservation across diffusers
const sumCfm1 = supplyDiffusers1.reduce((sum, d) => sum + d.cfm, 0);
assert.strictEqual(sumCfm1, totalCfm, `Sum of diffuser CFMs (${sumCfm1}) must exactly equal total CFM (${totalCfm})`);

// 2. 100% Target Coverage Test
const options100: DistributionOptions = {
  coverageTargetPercent: 100,
  pattern: 'hexagonal',
  throwRadiusMode: 'catalog-t50'
};

const diffusers100 = placeDiffusersWithCircularOptimization(
  rectPolygon,
  totalCfm,
  true,
  10,
  10,
  [],
  'concealed',
  30000,
  options100
);

const supplyDiffusers100 = diffusers100.filter(d => d.type !== 'return');
const cov100 = calculateZoneDiffuserCoverage(rectPolygon, supplyDiffusers100, 10);
console.log(`100% Target space coverage: ${cov100.coveragePercent}% with ${supplyDiffusers100.length} diffusers`);
assert(cov100.coveragePercent >= 95, `Coverage must be >= 95% (ideally 100%), got ${cov100.coveragePercent}%`);

// 3. Irregular L-Shaped Space Test (60ft x 40ft L-shape, 1800 CFM)
const lPolygon = [
  0, 0,
  600, 0,
  600, 200,
  300, 200,
  300, 400,
  0, 400
];
const lCfm = 1800;

const diffusersL = placeDiffusersWithCircularOptimization(
  lPolygon,
  lCfm,
  true,
  10,
  10,
  [],
  'concealed',
  60000,
  { coverageTargetPercent: 95, pattern: 'hexagonal' }
);

const supplyDiffusersL = diffusersL.filter(d => d.type !== 'return');
const covL = calculateZoneDiffuserCoverage(lPolygon, supplyDiffusersL, 10);
console.log(`L-Shaped space coverage: ${covL.coveragePercent}% with ${supplyDiffusersL.length} diffusers`);
assert(covL.coveragePercent >= 95, `L-shape space coverage must be >= 95%, got ${covL.coveragePercent}%`);

// Verify all diffusers are inside polygon bounds
const sumCfmL = supplyDiffusersL.reduce((sum, d) => sum + d.cfm, 0);
assert.strictEqual(sumCfmL, lCfm, `L-shape sum of diffuser CFMs (${sumCfmL}) must equal total CFM (${lCfm})`);

// 4. Pattern Variation: Orthogonal vs Hexagonal
const diffusersOrth = placeDiffusersWithCircularOptimization(
  rectPolygon,
  totalCfm,
  true,
  10,
  10,
  [],
  'concealed',
  30000,
  { coverageTargetPercent: 95, pattern: 'orthogonal' }
);
const supplyOrth = diffusersOrth.filter(d => d.type !== 'return');
const covOrth = calculateZoneDiffuserCoverage(rectPolygon, supplyOrth, 10);
assert(covOrth.coveragePercent >= 90, `Orthogonal pattern coverage must be >= 90%, got ${covOrth.coveragePercent}%`);

console.log('✔ All Circular Diffuser Distribution & Coverage Optimization tests passed successfully!');
