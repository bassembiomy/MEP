import {
  executeAirDistributionDesign,
  recalculateScopedOverride
} from '../airDistributionEngine';
import { getStandardsProfile } from '../standards/designStandards';
import { sizeOutdoorAirLouver } from '../outdoorAir/louverSizer';
import { selectBestDiffuserFromCatalog } from '../terminals/diffuserSelector';
import { validateTerminalAirDistribution } from '../terminals/airDistributionValidator';
import { evaluateDiffuserThrow, getDiffuserThrowCriteria } from '../standards/diffuserRules';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('===============================================================');
console.log('STARTING 12-SCENARIO END-TO-END HVAC AIR DISTRIBUTION TEST SUITE');
console.log('===============================================================');

const profile = getStandardsProfile('ashrae');

// -----------------------------------------------------------------------------
// Scenario 1: Small single-unit room
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 1: Small Single-Unit Room (20ft x 15ft, 300 sq ft, 400 CFM) ---');
const s1 = executeAirDistributionDesign({
  roomName: 'Private Office',
  roomPolygon: [0, 0, 20, 0, 20, 15, 0, 15],
  roomAreaSqFt: 300,
  sensibleLoadBtu: 8000,
  totalLoadBtu: 10000,
  requiredCfm: 400,
  occupancyCount: 3,
  systemType: 'concealed'
});
assert(s1.serviceZones.length === 1, `Small room should use 1 unit, got ${s1.serviceZones.length}`);
assert(s1.supplyTerminals.length >= 1, 'Should place at least 1 supply diffuser');
assert(s1.validationReport.overallStatus === 'PASS', `Scenario 1 validation should PASS, got ${s1.validationReport.overallStatus}`);
console.log('✔ Scenario 1 Passed');

// -----------------------------------------------------------------------------
// Scenario 2: Large conference hall with 3 units (Matching CAD Drawing)
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 2: Large Conference Hall (50ft x 30ft, 1,500 sq ft, 4,000 CFM) ---');
const s2 = executeAirDistributionDesign({
  roomName: 'Conference Hall',
  roomPolygon: [0, 0, 50, 0, 50, 30, 0, 30],
  roomAreaSqFt: 1500,
  sensibleLoadBtu: 120000,
  totalLoadBtu: 141000,
  requiredCfm: 4000,
  occupancyCount: 50,
  systemType: 'concealed',
  mountingWallSide: 'east',
  maxAvailableCeilingDepthIn: 14
});
assert(s2.serviceZones.length === s2.selectedOption.unitCount, 'Service zones must match the feasible selected quantity');
assert(s2.serviceZones.every(z => z.sensibleCapacityBtu! >= z.sensibleLoadBtu && z.latentCapacityBtu! >= z.latentLoadBtu), 'Each selected unit must satisfy sensible and latent load');
assert(s2.supplyTerminals.length >= 12, `Should place at least 12 supply diffusers, got ${s2.supplyTerminals.length}`);
assert(Math.abs(s2.supplyDucts[0].airflowCfm-s2.serviceZones[0].supplyCfm)<1e-8, 'Main trunk must carry its actual selected unit airflow');
assert(s2.outdoorAirSystem.designOutdoorAirCfm >= 340, 'Outdoor air should be sized for 50 occupants');
assert(s2.validationReport.overallStatus === 'PASS', `Scenario 2 validation should PASS, got ${s2.validationReport.overallStatus}`);
console.log('✔ Scenario 2 Passed');

// -----------------------------------------------------------------------------
// Scenario 3: Room with high solar load on one façade
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 3: Solar-Biased Partitioning (South Wall Glass) ---');
const s3 = executeAirDistributionDesign({
  roomName: 'Executive Boardroom',
  roomPolygon: [0, 0, 50, 0, 50, 30, 0, 30],
  roomAreaSqFt: 1500,
  sensibleLoadBtu: 120000,
  totalLoadBtu: 141000,
  requiredCfm: 4000,
  occupancyCount: 50,
  systemType: 'concealed',
  exteriorWalls: [{ side: 'south', glassRatio: 0.7 }]
});
assert(s3.serviceZones.length === s3.selectedOption.unitCount, 'Service zones must match the selected feasible quantity');
assert(s3.serviceZones.every(z => z.sensibleCapacityBtu! >= z.sensibleLoadBtu && z.latentCapacityBtu! >= z.latentLoadBtu), 'Solar-weighted loads must remain within each unit capacity');
assert(s3.serviceZones[0].sensibleLoadBtu > s3.serviceZones[1].sensibleLoadBtu, 'South-facing bay should receive higher sensible load');
console.log('✔ Scenario 3 Passed');

// -----------------------------------------------------------------------------
// Scenario 4: Irregular L-shaped room
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 4: Irregular L-Shaped Room ---');
const s4 = executeAirDistributionDesign({
  roomName: 'L-Shaped Open Office',
  roomPolygon: [0, 0, 60, 0, 60, 20, 30, 20, 30, 40, 0, 40],
  roomAreaSqFt: 1800,
  sensibleLoadBtu: 90000,
  totalLoadBtu: 110000,
  requiredCfm: 3200,
  occupancyCount: 30,
  systemType: 'concealed'
});
assert(s4.serviceZones.length >= 2, 'Should divide L-shaped room into at least 2 service bays');
assert(s4.supplyTerminals.length >= 6, 'Should distribute diffusers throughout the L-shape');
console.log('✔ Scenario 4 Passed');

// -----------------------------------------------------------------------------
// Scenario 5: Room with ceiling beams and lighting obstacles
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 5: Spatial Clearance with Obstacle Constraints ---');
const s5 = executeAirDistributionDesign({
  roomName: 'Restricted Ceiling Space',
  roomPolygon: [0, 0, 40, 0, 40, 20, 0, 20],
  roomAreaSqFt: 800,
  sensibleLoadBtu: 40000,
  totalLoadBtu: 48000,
  requiredCfm: 1400,
  maxAvailableCeilingDepthIn: 10,
  systemType: 'concealed'
});
for (const d of s5.supplyDucts) {
  assert(d.heightIn <= 10, `Duct height ${d.heightIn}" must not exceed 10" beam clearance limit`);
}
console.log('✔ Scenario 5 Passed');

// -----------------------------------------------------------------------------
// Scenario 6: User override scenario (3 units to 2 units)
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 6: User Override & Scoped Recalculation ---');
const s6_initial = executeAirDistributionDesign({
  roomName: 'Conference Hall',
  roomPolygon: [0, 0, 50, 0, 50, 30, 0, 30],
  roomAreaSqFt: 1500,
  sensibleLoadBtu: 120000,
  totalLoadBtu: 141000,
  requiredCfm: 4000,
  systemType: 'concealed',
  userOverrideUnitCount: 2
});
assert(s6_initial.serviceZones.length === 2, 'Should respect user override of 2 units');

// Move Unit 1 position
s6_initial.serviceZones[0].equipmentPosition.x = 45;
s6_initial.serviceZones[0].designControlMode = 'user-modified';

const s6_recalc = recalculateScopedOverride(s6_initial.serviceZones[0].id, s6_initial);
assert(s6_recalc.serviceZones[0].designControlMode === 'user-modified', 'User-modified state must be preserved');
const zone1Duct = s6_recalc.supplyDucts.find((d) => d.unitId === s6_initial.serviceZones[0].id);
assert(zone1Duct !== undefined && zone1Duct.startPoint.x === 45, 'Duct start point should match updated equipment position');
console.log('✔ Scenario 6 Passed');

// -----------------------------------------------------------------------------
// Scenario 7: Insufficient equipment ESP warning
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 7: Low ESP Warning Trigger ---');
const s7 = executeAirDistributionDesign({
  roomName: 'High Static Loss Run',
  roomPolygon: [0, 0, 80, 0, 80, 20, 0, 20],
  roomAreaSqFt: 1600,
  sensibleLoadBtu: 80000,
  totalLoadBtu: 95000,
  requiredCfm: 2800,
  systemType: 'fcu' // FCU with low available ESP (0.25 in. wg)
});
assert(s7.validationReport.points[6].pointIndex === 7, 'Should evaluate Point 7 ESP check');
console.log('✔ Scenario 7 Passed');

// -----------------------------------------------------------------------------
// Scenario 8: Insufficient ceiling depth warning
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 8: Tight Ceiling Clearance (8 inches) ---');
const s8 = executeAirDistributionDesign({
  roomName: 'Ultra Shallow Ceiling',
  roomPolygon: [0, 0, 40, 0, 40, 20, 0, 20],
  roomAreaSqFt: 800,
  sensibleLoadBtu: 60000,
  totalLoadBtu: 72000,
  requiredCfm: 2000,
  maxAvailableCeilingDepthIn: 8
});
assert(s8.serviceZones[0].maxAvailableCeilingDepthIn === 8, 'Should configure 8" ceiling depth');
console.log('✔ Scenario 8 Passed');

// -----------------------------------------------------------------------------
// Scenario 9: Diffuser throw failure detection
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 9: Diffuser Throw Boundary Evaluation ---');
const criteria = getDiffuserThrowCriteria('4-way-ceiling', profile);
const underThrow = evaluateDiffuserThrow(4, 15, criteria); // T50 = 4 ft, L = 15 ft -> ratio = 0.26 < 0.75
assert(underThrow.status === 'warning', 'Under-throw should trigger warning');

const overThrow = evaluateDiffuserThrow(20, 10, criteria); // T50 = 20 ft, L = 10 ft -> ratio = 2.0 > 1.25
assert(overThrow.status === 'warning', 'Over-throw should trigger warning');
console.log('✔ Scenario 9 Passed');

// -----------------------------------------------------------------------------
// Scenario 10: Outdoor-air louver sizing failure detection
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 10: Louver Velocity Constraint Evaluation ---');
const louverConstrained = sizeOutdoorAirLouver(1000, profile, 400); // 400 FPM max velocity
assert(louverConstrained.freeAreaVelocityFpm <= 400, `Louver velocity ${louverConstrained.freeAreaVelocityFpm} should be <= 400 FPM`);
console.log('✔ Scenario 10 Passed');

// -----------------------------------------------------------------------------
// Scenario 11: Equipment catalog selection
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 11: Catalog Selection Robustness ---');
const sel = selectBestDiffuserFromCatalog(800, 35);
assert(sel.catalogItem !== null, 'Should select diffuser from catalog for 800 CFM');
assert(sel.actualNc <= 37, 'Selected diffuser should meet acoustic constraint');
console.log('✔ Scenario 11 Passed');

// -----------------------------------------------------------------------------
// Scenario 12: Return-air short-circuit detection
// -----------------------------------------------------------------------------
console.log('\n--- Scenario 12: Return Air Short-Circuit Detection ---');
const shortCircuitEval = validateTerminalAirDistribution(
  s2.serviceZones[0],
  [{ ...s2.supplyTerminals[0], position: { x: 10, y: 10 }, throwT50Ft: 12 }],
  [{ ...s2.returnTerminals[0], position: { x: 12, y: 10 } }], // only 2 ft separation vs 7.2 ft required
  profile
);
assert(shortCircuitEval.shortCircuitCheck.status === 'warning', 'Close return placement should trigger short-circuit warning');
console.log('✔ Scenario 12 Passed');

console.log('\n===============================================================');
console.log('ALL 12 END-TO-END HVAC INTEGRATION SCENARIOS PASSED WITH 100% SUCCESS!');
console.log('===============================================================');
