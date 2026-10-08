import { executeAirDistributionDesign, convertDesignResultToZonePayload } from '../airDistributionEngine';
import { selectDamperForDuctSection } from '../terminals/damperSelector';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running Closed-Loop Design Optimizer & CAD Symbology Tests ===');

// 1. Damper Selector Tests
const vcd = selectDamperForDuctSection({
  functionType: 'volume-control-damper',
  widthIn: 18,
  heightIn: 12,
  cfm: 1000
});
assert(vcd !== null, 'Should select VCD');
assert(vcd!.tag === 'VCD', 'Tag must be VCD');
assert(vcd!.calculatedDeltaPInWg > 0, 'VCD deltaP must be > 0');

const fd15 = selectDamperForDuctSection({
  functionType: 'fire-damper',
  widthIn: 24,
  heightIn: 16,
  cfm: 2000,
  wallRatingHours: 1.5
});
assert(fd15 !== null, 'Should select 1.5-hr fire damper');
assert(fd15!.tag === 'FD-1.5HR', 'Tag must be FD-1.5HR');

const fd30 = selectDamperForDuctSection({
  functionType: 'fire-damper',
  widthIn: 36,
  heightIn: 24,
  cfm: 5000,
  wallRatingHours: 3.0
});
assert(fd30 !== null, 'Should select 3.0-hr fire damper');
assert(fd30!.tag === 'FD-3HR', 'Tag must be FD-3HR');

// 2. Closed-Loop Design Optimization on Large Commercial Space (4,000 CFM)
const design = executeAirDistributionDesign({
  roomName: 'Main Conference & Exhibition Hall',
  roomPolygon: [0, 0, 50, 0, 50, 30, 0, 30],
  roomAreaSqFt: 1500,
  sensibleLoadBtu: 120000,
  totalLoadBtu: 141000,
  requiredCfm: 4000,
  occupancyCount: 50,
  systemType: 'concealed'
});

// 3. Validation Report & 10 Points
console.log('Overall status:', design.validationReport.overallStatus);
design.validationReport.points.forEach(p => console.log('Point', p.pointIndex, p.pointName, 'Status:', p.status, 'Metric:', p.metric, 'Msg:', p.message));
for(const zone of design.serviceZones) for(let index=1;index<=10;index++) assert(design.validationReport.points.some(p=>p.zoneId===zone.id&&p.pointIndex===index), `Missing check ${index} for ${zone.id}`);
assert(design.validationReport.issueReady===false, 'Preliminary validation must not certify engineering issue');
assert(design.validationReport.overallStatus === 'PASS', 'Validation overall status must PASS');

const nfpaPoint = design.validationReport.points.find((p) => p.pointIndex === 10);
assert(Boolean(nfpaPoint), 'Must have NFPA 90A point 10');
assert(nfpaPoint!.status === 'PASS', 'Point 10 must PASS');

// 4. CAD Payload & Accessories Extraction
const payload = convertDesignResultToZonePayload(design);
assert(Boolean(payload.layers), 'Payload must have layers definition');
assert(payload.layers.dampers === 'M-HVAC-DAMP', 'Dampers layer must be M-HVAC-DAMP');
assert(payload.layers.smokeDetectors === 'M-HVAC-SMOKE-DET', 'Smoke detectors layer must be M-HVAC-SMOKE-DET');

assert(payload.accessories && payload.accessories.length > 0, 'Payload must contain accessories');
const hasVcd = payload.accessories.some((a) => a.type === 'volume-control-damper');
assert(hasVcd, 'Must contain volume control dampers on branches');

console.log('PASS: All Closed-Loop Design Optimizer & CAD Symbology Tests Passed successfully.');
