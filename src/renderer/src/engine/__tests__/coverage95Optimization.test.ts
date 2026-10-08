import { executeAirDistributionDesign } from '../airDistributionEngine';
import { calculateZoneDiffuserCoverage } from '../diffuserPlacer';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running 95% Circular Diffuser Coverage Optimizer Tests ===');

// 1. Small Single-Unit Room (20ft x 15ft, 300 sq ft)
const s1 = executeAirDistributionDesign({
  roomName: 'Small Office',
  roomPolygon: [0, 0, 20, 0, 20, 15, 0, 15],
  roomAreaSqFt: 300,
  sensibleLoadBtu: 12000,
  totalLoadBtu: 15000,
  requiredCfm: 400,
  occupancyCount: 3,
  systemType: 'concealed'
});

const cov1 = calculateZoneDiffuserCoverage(
  [0, 0, 20, 0, 20, 15, 0, 15],
  s1.supplyTerminals.map((t) => ({ id: t.id, x: t.position.x, y: t.position.y, cfm: t.cfm, size: t.faceDimension, throwT50Ft: t.throwT50Ft, type: 'supply' as const })),
  1.0,
  true
);

console.log(`Small Room Coverage: ${cov1.coveragePercent}% with ${s1.supplyTerminals.length} diffusers (NC: ${s1.supplyTerminals[0].ncRating})`);
assert(cov1.coveragePercent >= 95.0, `Small room circular coverage must be >= 95%, got ${cov1.coveragePercent}%`);
assert(s1.supplyTerminals.every((t) => t.ncRating <= 30), 'All diffusers in small room must satisfy NC <= 30');

// 2. Large Conference Hall (50ft x 30ft, 1,500 sq ft, 4,000 CFM)
const s2 = executeAirDistributionDesign({
  roomName: 'Large Conference Hall',
  roomPolygon: [0, 0, 50, 0, 50, 30, 0, 30],
  roomAreaSqFt: 1500,
  sensibleLoadBtu: 120000,
  totalLoadBtu: 141000,
  requiredCfm: 4000,
  occupancyCount: 50,
  systemType: 'concealed'
});

const cov2 = calculateZoneDiffuserCoverage(
  [0, 0, 50, 0, 50, 30, 0, 30],
  s2.supplyTerminals.map((t) => ({ id: t.id, x: t.position.x, y: t.position.y, cfm: t.cfm, size: t.faceDimension, throwT50Ft: t.throwT50Ft, type: 'supply' as const })),
  1.0,
  true
);

console.log(`Conference Hall Coverage: ${cov2.coveragePercent}% with ${s2.supplyTerminals.length} diffusers (Max NC: ${Math.max(...s2.supplyTerminals.map(t => t.ncRating))})`);
assert(cov2.coveragePercent >= 95.0, `Conference Hall circular coverage must be >= 95%, got ${cov2.coveragePercent}%`);
assert(s2.supplyTerminals.every((t) => t.ncRating <= 30), 'All diffusers in conference hall must satisfy NC <= 30');

// 3. Elongated Gallery (60ft x 20ft, 1,200 sq ft, 1,600 CFM)
const s3 = executeAirDistributionDesign({
  roomName: 'Elongated Gallery',
  roomPolygon: [0, 0, 60, 0, 60, 20, 0, 20],
  roomAreaSqFt: 1200,
  sensibleLoadBtu: 45000,
  totalLoadBtu: 55000,
  requiredCfm: 1600,
  occupancyCount: 20,
  systemType: 'concealed'
});

const cov3 = calculateZoneDiffuserCoverage(
  [0, 0, 60, 0, 60, 20, 0, 20],
  s3.supplyTerminals.map((t) => ({ id: t.id, x: t.position.x, y: t.position.y, cfm: t.cfm, size: t.faceDimension, throwT50Ft: t.throwT50Ft, type: 'supply' as const })),
  1.0,
  true
);

console.log(`Elongated Space Coverage: ${cov3.coveragePercent}% with ${s3.supplyTerminals.length} diffusers`);
assert(cov3.coveragePercent >= 95.0, `Elongated space coverage must be >= 95%, got ${cov3.coveragePercent}%`);
assert(s3.supplyTerminals.every((t) => t.ncRating <= 30), 'All diffusers in elongated space must satisfy NC <= 30');

// 4. L-Shaped Space
const lShapePolygon = [0, 0, 40, 0, 40, 20, 20, 20, 20, 40, 0, 40];
const s4 = executeAirDistributionDesign({
  roomName: 'L-Shaped Department',
  roomPolygon: lShapePolygon,
  roomAreaSqFt: 1200,
  sensibleLoadBtu: 48000,
  totalLoadBtu: 58000,
  requiredCfm: 1800,
  occupancyCount: 25,
  systemType: 'concealed'
});

const cov4 = calculateZoneDiffuserCoverage(
  lShapePolygon,
  s4.supplyTerminals.map((t) => ({ id: t.id, x: t.position.x, y: t.position.y, cfm: t.cfm, size: t.faceDimension, throwT50Ft: t.throwT50Ft, type: 'supply' as const })),
  1.0,
  true
);

console.log(`L-Shaped Space Coverage: ${cov4.coveragePercent}% with ${s4.supplyTerminals.length} diffusers`);
assert(cov4.coveragePercent >= 95.0, `L-Shaped space coverage must be >= 95%, got ${cov4.coveragePercent}%`);
assert(s4.supplyTerminals.every((t) => t.ncRating <= 30), 'All diffusers in L-shaped space must satisfy NC <= 30');

// 5. Duct Sizing & Velocity Check
assert(s2.supplyDucts.length > 0, 'Must have supply ducts');
assert(s2.supplyDucts.every((d) => d.velocityFpm <= d.allowableVelocityFpm + 50), 'All duct velocities must be compliant');

console.log('PASS: All 95% Circular Diffuser Coverage Optimizer Tests Passed successfully.');
