import assert from 'node:assert';
import { calculateZoneDiffuserCoverage, placeDiffusers, DiffuserPos } from '../diffuserPlacer';

console.log('=== Running Diffuser Distribution & 95% Coverage Tests ===');

// Test 1: Coverage Calculator
const rectPoints = [0, 0, 200, 0, 200, 200, 0, 200]; // 20ft x 20ft room @ 10px/ft = 400 sq ft
const scale = 10; // 10 px per ft

const noDiffusers: DiffuserPos[] = [];
const cov0 = calculateZoneDiffuserCoverage(rectPoints, noDiffusers, scale);
assert.strictEqual(cov0.coveragePercent, 0, 'No diffusers must yield 0% coverage');
assert.strictEqual(cov0.isCovered95, false, '0% coverage must not meet 95% threshold');

// Centered diffuser with throw 15 ft (radius 150 px): covers entire 200x200 room except minor corners (r=15ft > sqrt(10^2+10^2)=14.14ft -> 100% covered)
const centerDiffuser: DiffuserPos = {
  id: 'd1',
  x: 100,
  y: 100,
  cfm: 300,
  size: '12"x12"',
  throwT50Ft: 15,
  type: 'supply'
};
const covCenter = calculateZoneDiffuserCoverage(rectPoints, [centerDiffuser], scale);
assert(covCenter.coveragePercent >= 95, `Coverage should be >= 95%, got ${covCenter.coveragePercent}%`);
assert.strictEqual(covCenter.isCovered95, true, 'Should meet 95% coverage requirement');

// Elongated room 60ft x 20ft (600px x 200px)
const elongatedPoints = [0, 0, 600, 0, 600, 200, 0, 200];
const singleDiffuserElongated: DiffuserPos = {
  id: 'd1',
  x: 100,
  y: 100,
  cfm: 200,
  size: '9"x9"',
  throwT50Ft: 9,
  type: 'supply'
};
const covElongatedSingle = calculateZoneDiffuserCoverage(elongatedPoints, [singleDiffuserElongated], scale);
assert(covElongatedSingle.coveragePercent < 60, `Single small diffuser should not cover 60ft room, got ${covElongatedSingle.coveragePercent}%`);
assert.strictEqual(covElongatedSingle.isCovered95, false);

// Test 2: placeDiffusers guarantees >= 95% coverage for drawn spaces
// Case A: 20x20 ft room with 400 CFM
const diffsA = placeDiffusers(rectPoints, 400, true, 10, scale);
assert(diffsA.length >= 1, 'Should place at least 1 diffuser');
const covA = calculateZoneDiffuserCoverage(rectPoints, diffsA, scale);
assert(covA.coveragePercent >= 95, `20x20 room coverage must be >= 95%, got ${covA.coveragePercent}%`);
const supplyDiffsA = diffsA.filter(d => d.type !== 'return');
assert(supplyDiffsA.every(d => (d.throwT50Ft ?? 0) > 0), 'Every supply diffuser must have a valid throwT50Ft');

// Case B: Elongated 60x20 ft room (1200 sq ft) with 800 CFM
const diffsB = placeDiffusers(elongatedPoints, 800, true, 10, scale);
assert(diffsB.length >= 3, `Elongated room should place enough diffusers, got ${diffsB.length}`);
const covB = calculateZoneDiffuserCoverage(elongatedPoints, diffsB, scale);
assert(covB.coveragePercent >= 95, `Elongated room coverage must be >= 95%, got ${covB.coveragePercent}%`);

// Case C: L-shaped space
const lShapedPoints = [
  0, 0,
  400, 0,
  400, 200,
  200, 200,
  200, 400,
  0, 400
];
const diffsL = placeDiffusers(lShapedPoints, 1000, true, 10, scale);
const covL = calculateZoneDiffuserCoverage(lShapedPoints, diffsL, scale);
assert(covL.coveragePercent >= 95, `L-shaped space coverage must be >= 95%, got ${covL.coveragePercent}%`);

console.log(`✔ All Diffuser 95% Coverage tests passed! Room A: ${covA.coveragePercent}%, Room B: ${covB.coveragePercent}%, Room L: ${covL.coveragePercent}%`);
