import { executeAirDistributionDesign, convertDesignResultToZonePayload, AirDistributionDesignInput } from '../airDistributionEngine';
import { calculateAshrae621Ventilation } from '../outdoorAir/outdoorAirCalculator';
import { isPointInPolygon } from '../geometry';
import { polygonFtToPx, pxPerFt } from '../units';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const polyFt = [0, 0, 40, 0, 40, 25, 0, 25];
const base: AirDistributionDesignInput = {
  roomName: 'Integration Office',
  roomPolygon: polyFt,
  roomAreaSqFt: 1000,
  sensibleLoadBtu: 30000,
  totalLoadBtu: 36000,
  requiredCfm: 1200,
  systemType: 'concealed',
  mountingWallSide: 'east'
};

const designFt = executeAirDistributionDesign(base);

// (a) px at 10 px/ft matches the ft design: counts, positions x10, duct sizes
console.log('--- (a) px (10 px/ft) vs ft equivalence ---');
const designPx = executeAirDistributionDesign({
  ...base, roomPolygon: polygonFtToPx(polyFt, 10, 'imperial'), scalePxPerUnit: 10, units: 'imperial'
});
assert(designPx.supplyTerminals.length === designFt.supplyTerminals.length, 'supply terminal count must match');
assert(designPx.returnTerminals.length === designFt.returnTerminals.length, 'return terminal count must match');
assert(designPx.supplyDucts.length === designFt.supplyDucts.length, 'supply duct count must match');
designFt.supplyDucts.forEach((d, i) => {
  const e = designPx.supplyDucts[i];
  assert(d.widthIn === e.widthIn && d.heightIn === e.heightIn, `duct ${i} size must match`);
});
const payloadFt = convertDesignResultToZonePayload(designFt);
const payloadPx = convertDesignResultToZonePayload(designPx);
payloadFt.diffusers.forEach((d, i) => {
  const e = payloadPx.diffusers[i];
  assert(near(e.x, d.x * 10, 0.2) && near(e.y, d.y * 10, 0.2), `diffuser ${i} px position must be ft x 10`);
});
assert(near(payloadPx.outdoorUnitPos.x, payloadFt.outdoorUnitPos.x * 10, 0.2), 'ODU px = ft x 10');
console.log('OK');

// (b) metric project: 20 px per metre
console.log('--- (b) metric 20 px/m ---');
const k = pxPerFt(20, 'metric');
assert(near(k, 20 * 0.3048, 1e-9), 'metric px/ft factor');
const designM = executeAirDistributionDesign({
  ...base, roomPolygon: polygonFtToPx(polyFt, 20, 'metric'), scalePxPerUnit: 20, units: 'metric'
});
assert(designM.supplyTerminals.length === designFt.supplyTerminals.length, 'metric supply count must match imperial');
designFt.supplyTerminals.forEach((t, i) => {
  const m = designM.supplyTerminals[i];
  assert(near(m.position.x, t.position.x, 0.05) && near(m.position.y, t.position.y, 0.05), `metric terminal ${i} engine position in ft`);
});
const payloadM = convertDesignResultToZonePayload(designM);
payloadFt.diffusers.forEach((d, i) => {
  assert(near(payloadM.diffusers[i].x, d.x * k, 0.5), `metric payload x ${i} in px`);
});
console.log('OK');

// (c) ASHRAE 62.1 outdoor air
console.log('--- (c) ASHRAE 62.1 OA ---');
const oa = calculateAshrae621Ventilation({ areaSqFt: 1000, spaceTypeId: 'office' });
assert(oa.occupancyCount === 5, `1000 ft2 office default occupancy = 5, got ${oa.occupancyCount}`);
assert(oa.vbzCfm === 85, `Vbz = 5*5 + 0.06*1000 = 85, got ${oa.vbzCfm}`);
assert(oa.vozCfm === 85, `Voz = 85/1.0 (Ez=1.0, ASHRAE 62.1 Table 6-4 cooling, ceiling supply) = 85, got ${oa.vozCfm}`);
assert(designFt.ventilation.vozCfm === 85 && designFt.outdoorAirSystem.designOutdoorAirCfm === 85, 'engine default OA = 85 CFM for 1000 ft2 office');
console.log('OK');

// (d) mass balance
console.log('--- (d) mass balance ---');
const p3 = designFt.validationReport.points.find((p) => p.pointIndex === 3)!;
assert(p3.status === 'PASS', `Point 3 mass balance should PASS: ${p3.metric}`);
const mb = designFt.massBalance;
assert(mb.returnCfm === mb.supplyCfm - mb.exhaustCfm - mb.exfiltrationCfm, 'return = supply - exhaust - exfiltration');
assert(mb.exfiltrationCfm === Math.max(0, mb.outdoorAirCfm - mb.exhaustCfm), 'exfiltration = OA - exhaust');
assert(designFt.returnTerminals.reduce((a, t) => a + t.cfm, 0) === mb.returnCfm, 'return grille CFM must sum to the return value');
const withExhaust = executeAirDistributionDesign({ ...base, exhaustCfm: 60 });
assert(withExhaust.validationReport.points[2].status === 'PASS', 'mass balance with exhaust should PASS');
assert(withExhaust.massBalance.exfiltrationCfm === 25, 'exfiltration = 85 - 60');
console.log('OK');

// (e) terminals inside polygon (+ spatial validator actually checked them)
console.log('--- (e) terminals inside polygon ---');
for (const t of [...designFt.supplyTerminals, ...designFt.returnTerminals]) {
  assert(isPointInPolygon(t.position.x, t.position.y, polyFt), `terminal ${t.id} must be inside the polygon`);
}
const p9 = designFt.validationReport.points.find((p) => p.pointIndex === 9)!;
const checked = designFt.supplyTerminals.length + designFt.returnTerminals.length;
assert(p9.metric.includes(`Terminals checked: ${checked}`), `spatial validator must check all ${checked} terminals: ${p9.metric}`);
console.log('OK');

// (f) ODU outside
console.log('--- (f) ODU outside polygon ---');
assert(designFt.outdoorUnitPositions.length === designFt.serviceZones.length, 'one ODU per unit');
for (const o of designFt.outdoorUnitPositions) assert(!isPointInPolygon(o.x, o.y, polyFt), 'ODU must be outside the room');
for (const o of payloadPx.outdoorUnitPositions) {
  assert(!isPointInPolygon(o.x, o.y, polygonFtToPx(polyFt, 10, 'imperial')), 'ODU (px) must be outside the px polygon');
}
console.log('OK');

// (g) orthogonal ducts
console.log('--- (g) orthogonal ducts ---');
for (const d of [...designFt.supplyDucts, ...designFt.returnDucts]) {
  const dx = Math.abs(d.endPoint.x - d.startPoint.x), dy = Math.abs(d.endPoint.y - d.startPoint.y);
  assert(dx < 1e-6 || dy < 1e-6, `duct ${d.id} must be orthogonal (dx=${dx}, dy=${dy})`);
}
console.log('OK');

// Determinism
const again = executeAirDistributionDesign(base);
assert(JSON.stringify({ ...again, timestamp: '', validationReport: { ...again.validationReport, timestamp: '' } }) ===
  JSON.stringify({ ...designFt, timestamp: '', validationReport: { ...designFt.validationReport, timestamp: '' } }), 'engine must be deterministic');

console.log('ALL ENGINE INTEGRATION TESTS PASSED');
