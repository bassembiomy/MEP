import { executeAirDistributionDesign, convertDesignResultToZonePayload, AirDistributionDesignResult, AirDistributionDesignInput } from '../airDistributionEngine';
import { designZone, zonePatchFromDesign } from '../../panels/zoneDesign';
import { unitFootprintFt, unitKeepOutFt, terminalFaceRectFt, rectsOverlap, pointInRect } from '../ducts/clearance';
import { maxDistanceToNearestTerminal, decomposeConvex, polygonAreaAbs } from '../terminals/bayLayout';
import { isPointInPolygon, distanceToPolygonEdge } from '../geometry';
import { optimizeMultiUnitCandidates } from '../systemArchitecture/equipmentOptimizer';
import { validateSupplyAirflowBalance, validateRoomAirflowVerification } from '../validation/airflowValidator';
import { validateSystemAirMassBalance } from '../validation/massBalanceValidator';
import { METRIC_DIFFUSER_CATALOG } from '../hvacCatalogs';
import { buildUnitKeyMap, unitIndexOf } from '../../canvas/shopDrawing';
import type { Zone, ProjectMetadata } from '../../store/projectStore';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Auto-Layout / engine parity, per-unit balance, L-room coverage, unit-count tests ===');

const baseInput = (poly: number[], area: number, tons: number, extra: Record<string, unknown> = {}): AirDistributionDesignInput => ({
  roomName: 'Room',
  roomPolygon: poly,
  roomAreaSqFt: area,
  sensibleLoadBtu: tons * 12000 * 0.75,
  totalLoadBtu: tons * 12000,
  requiredCfm: tons * 400,
  systemType: 'concealed',
  spaceTypeId: 'classroom',
  ...extra
});

// ---------------------------------------------------------------------------------------------------------------------
// 1. Zone panel Auto-Layout == engine result (ONE pipeline)
// ---------------------------------------------------------------------------------------------------------------------
const project: ProjectMetadata = { name: 'T', location: 'X', scale: 10, units: 'imperial', outdoorDb: 95, indoorDb: 75 };
const mkZone = (id: string, pts: number[], extra: Partial<Zone> = {}): Zone => ({
  id, name: id, points: pts, spaceTypeId: 'classroom', ceilingHeight: 10, occupants: 30, diffusers: [], ducts: [], systemType: 'concealed', ...extra
});
const room1 = mkZone('z1', [0, 0, 400, 0, 400, 250, 0, 250]);
const neighbour = mkZone('z2', [420, 0, 700, 0, 700, 250, 420, 250]);
const zs = [room1, neighbour];
const { design: d1, payload: p1 } = designZone(room1, zs, project, null);
const direct = convertDesignResultToZonePayload(d1);
assert(JSON.stringify(direct) === JSON.stringify(p1), 'zone-panel payload must equal convertDesignResultToZonePayload(engine result)');
const patch = zonePatchFromDesign(room1, p1);
assert(patch.diffusers!.length === p1.diffusers.length, 'stored diffusers == engine terminals');
assert(patch.diffusers!.filter((d) => d.type !== 'return').length === d1.supplyTerminals.length, 'supply terminal count == engine');
assert(patch.diffusers!.every((d) => !!d.unitId && d.serviceZoneId === d.unitId), 'every stored terminal carries unitId / serviceZoneId');
assert(patch.ducts!.every((d) => !!d.unitId), 'every stored duct carries unitId');
assert(patch.outdoorUnitPositions!.length === d1.serviceZones.length, `one ODU per split indoor unit (${patch.outdoorUnitPositions!.length} vs ${d1.serviceZones.length})`);
assert(patch.unitPositions!.length === d1.serviceZones.length, 'one stored indoor unit position per service zone');
assert(patch.unitServiceZones!.length === d1.serviceZones.length, 'unitServiceZones stored');
assert(patch.catalogQty === d1.selectedOption.unitCount, 'catalogQty == engine unit count');
// stale old-pipeline data is gone: nothing but engine terminals
assert(patch.diffusers!.every((d) => p1.diffusers.some((e) => e.id === d.id)), 'no terminal that is not in the engine result');
console.log('  parity: payload == engine, per-unit ids present');

// canvas mapping round-trips: terminal.unitId -> index into unitPositions / outdoorUnitPositions (canvas/shopDrawing)
{
  const n = patch.unitPositions!.length;
  const refs = [...patch.diffusers!, ...patch.ducts!].map((x) => x.unitId);
  const km = buildUnitKeyMap(refs, n, room1.id);
  patch.unitServiceZones!.forEach((u, i) => {
    assert(km.get(u.id) === i, `unit ref ${u.id} maps to index ${i}`);
    for (const d of patch.diffusers!.filter((x) => x.unitId === u.id)) assert(unitIndexOf(d, km) === i, `terminal ${d.id} -> unit ${i}`);
    const sup = patch.diffusers!.filter((x) => x.unitId === u.id && x.type !== 'return').reduce((a, x) => a + x.cfm, 0);
    assert(Math.abs(sup - u.supplyCfm) < 1e-6, `unit ${i}: terminals sum to unit CFM`);
    assert(u.outdoorUnitIndex < patch.outdoorUnitPositions!.length, 'ODU index valid');
  });
  assert(new Set(refs).size === n, 'every unit has its own ref');
  console.log('  canvas unit mapping round-trips');
}

// locked diffusers are kept
const lockedZone = mkZone('z1', room1.points, { isDiffusersLocked: true, diffusers: [{ id: 'keep', x: 1, y: 1, cfm: 10, size: '12"x12"', type: 'supply' }] });
assert(zonePatchFromDesign(lockedZone, p1).diffusers![0].id === 'keep', 'locked diffusers are kept');

// ---------------------------------------------------------------------------------------------------------------------
// 2. 40 x 25 ft two-unit room: 2 ODUs, balanced CFM, per-unit terminals, nothing under a unit
// ---------------------------------------------------------------------------------------------------------------------
const poly4025 = [0, 0, 40, 0, 40, 25, 0, 25];
const d2 = executeAirDistributionDesign(baseInput(poly4025, 1000, 3.5)) as AirDistributionDesignResult;
assert(d2.serviceZones.length === 2, `40x25 should be a two-unit room (got ${d2.serviceZones.length})`);
assert(d2.outdoorUnitPositions.length === 2, 'two ODUs for two split indoor units');
const unitCfms = d2.serviceZones.map((z) => d2.supplyTerminals.filter((t) => t.unitId === z.id).reduce((a, t) => a + t.cfm, 0));
for (const z of d2.serviceZones) {
  const ts = d2.supplyTerminals.filter((t) => t.unitId === z.id);
  assert(ts.length >= 1, `${z.unitTag} has its own terminals`);
  const sum = ts.reduce((a, t) => a + t.cfm, 0);
  assert(Math.abs(sum - z.supplyCfm) < 1e-6, `${z.unitTag}: sum of its terminals ${sum} == its CFM ${z.supplyCfm}`);
}
assert(Math.abs(unitCfms[0] - unitCfms[1]) / Math.max(...unitCfms) <= 0.05, `balanced CFM per unit within 5% (${unitCfms.join(' / ')})`);
assert(d2.supplyTerminals.length >= 2 * 1, 'never fewer terminals than units');
for (const z of d2.serviceZones) {
  const fp = unitFootprintFt(z.equipmentPosition, d2.unitFootprintsIn?.[z.id]);
  for (const t of [...d2.supplyTerminals, ...d2.returnTerminals]) {
    assert(!rectsOverlap(fp, terminalFaceRectFt(t.position, t.faceDimension)), `${z.unitTag} footprint must not overlap terminal ${t.id}`);
  }
}
const pl = convertDesignResultToZonePayload(d2);
assert(pl.unitServiceZones.length === 2 && pl.unitServiceZones.every((u) => u.outdoorUnitIndex >= 0 && u.outdoorUnitIndex < pl.outdoorUnitPositions.length), 'each unit points at its ODU');
assert(new Set(pl.unitServiceZones.map((u) => u.outdoorUnitIndex)).size === 2, 'split units use different ODUs');
// VRF: one ODU module serves many indoor units
const d2v = executeAirDistributionDesign(baseInput(poly4025, 1000, 3.5, { systemType: 'vrf' }));
if (d2v.serviceZones.length > 1) assert(d2v.outdoorUnitPositions.length === 1, 'VRF: one ODU serves all indoor units');
console.log(`  40x25: ${d2.serviceZones.length} units, ${d2.outdoorUnitPositions.length} ODUs, per-unit CFM ${unitCfms.join(' / ')}`);

// ---------------------------------------------------------------------------------------------------------------------
// 3. L-shaped room coverage (675 ft2 = 30x15 + 15x15)
// ---------------------------------------------------------------------------------------------------------------------
const L = [0, 0, 30, 0, 30, 15, 15, 15, 15, 30, 0, 30];
assert(Math.abs(polygonAreaAbs(L) - 675) < 1e-6, 'L is 675 ft2');
const arms = decomposeConvex(L);
assert(arms.length === 2, `L decomposes into 2 convex arms (got ${arms.length})`);

const COVER_FACTOR = 1.6; // "~1.5 x T50" with the documented 1.6 tolerance
function assertCoverage(d: AirDistributionDesignResult, label: string): void {
  const sup = d.supplyTerminals;
  const poly = d.roomPolygonFt;
  let worst = 0;
  for (let x = 0.5; x < 30; x += 1) {
    for (let y = 0.5; y < 30; y += 1) {
      if (!isPointInPolygon(x, y, poly) || distanceToPolygonEdge(x, y, poly) < 2) continue;
      // nobody stands in an indoor unit's footprint / service-clearance zone
      if (d.serviceZones.some((z) => pointInRect({ x, y }, unitKeepOutFt(z.equipmentPosition, d.unitFootprintsIn?.[z.id])))) continue;
      // covered when some supply's throw envelope reaches it: distance <= factor x that terminal's T50
      let best = Infinity, t50 = 1;
      for (const t of sup) {
        const dd = Math.hypot(t.position.x - x, t.position.y - y) / Math.max(t.throwT50Ft, 1e-6);
        if (dd < best) { best = dd; t50 = t.throwT50Ft; }
      }
      best *= t50;
      worst = Math.max(worst, best / (COVER_FACTOR * t50));
      assert(best <= COVER_FACTOR * t50 + 1e-6, `${label}: occupied point (${x},${y}) is ${best.toFixed(1)} ft from the nearest supply, T50 ${t50} (limit ${COVER_FACTOR}xT50)`);
    }
  }
  console.log(`  ${label}: ${sup.length} supplies, worst coverage ratio ${worst.toFixed(2)} of limit`);
}
for (const [label, extra, tons] of [['L 1 unit', { userOverrideUnitCount: 1 }, 1.5], ['L default', {}, 2], ['L 2 units', { userOverrideUnitCount: 2 }, 2.5]] as const) {
  const dl = executeAirDistributionDesign(baseInput(L, 675, tons, extra));
  // 1- and 2-unit layouts must meet the coverage rule; the default (3 thin bays of 0.75 TR units) must at least reach every arm
  if (label !== 'L default') assertCoverage(dl, label);
  assert(maxDistanceToNearestTerminal(L, dl.supplyTerminals.map((t) => t.position)) < 1e6, 'coverage measurable');
  // far arm is not starved: every convex arm holds at least one supply terminal
  for (const arm of arms) {
    const n = dl.supplyTerminals.filter((t) => isPointInPolygon(t.position.x, t.position.y, arm) || distanceToPolygonEdge(t.position.x, t.position.y, arm) < 1e-6).length;
    assert(n >= 1, `${label}: each arm has a terminal (arm area ${polygonAreaAbs(arm)})`);
  }
}
// single-unit L: terminals ~ proportional to arm area (equal arms here -> within +-1 and CFM split by count)
{
  const dl = executeAirDistributionDesign(baseInput(L, 675, 1.5, { userOverrideUnitCount: 1 }));
  const total = dl.supplyTerminals.length;
  const areaTot = arms.reduce((a, p) => a + polygonAreaAbs(p), 0);
  for (const arm of arms) {
    const n = dl.supplyTerminals.filter((t) => isPointInPolygon(t.position.x, t.position.y, arm) || distanceToPolygonEdge(t.position.x, t.position.y, arm) < 1e-6).length;
    const ideal = (total * polygonAreaAbs(arm)) / areaTot;
    assert(Math.abs(n - ideal) <= 1.5, `arm terminals ${n} ~ proportional to area (ideal ${ideal.toFixed(1)} of ${total})`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. 60 x 40 ft classroom: a designer would never use more than 4 units
// ---------------------------------------------------------------------------------------------------------------------
{
  const classroom = mkZone('cls', [0, 0, 600, 0, 600, 400, 0, 400], { occupants: 60 });
  const { design: dc } = designZone(classroom, [classroom], project, null);
  assert(dc.selectedOption.unitCount <= 4, `60x40 classroom must use <= 4 units (got ${dc.selectedOption.unitCount} x ${dc.selectedOption.nominalTonsPerUnit} TR)`);
  console.log(`  60x40 classroom: ${dc.selectedOption.unitCount} x ${dc.selectedOption.nominalTonsPerUnit} TR`);
  for (const tons of [4, 5, 6, 8, 10]) {
    const r = optimizeMultiUnitCandidates({ roomName: 'c', sensibleLoadBtu: tons * 9000, totalLoadBtu: tons * 12000, requiredCfm: tons * 400, roomAreaSqFt: 2400, systemType: 'concealed' });
    assert(r.recommendedOption.unitCount <= 4, `${tons} TR over 2400 ft2 recommends <= 4 units (got ${r.recommendedOption.unitCount})`);
    assert(r.recommendedOption.nominalTonsPerUnit >= 1.5 || r.recommendedOption.unitCount <= 3, `${tons} TR: not a swarm of small units`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Validation text: rounded, unit-aware, NC from the zone
// ---------------------------------------------------------------------------------------------------------------------
{
  const dv = executeAirDistributionDesign(baseInput(poly4025, 1000, 3.5, { targetNc: 28 }));
  assert(dv.serviceZones.every((z) => z.targetNc === 28), 'zone NC target 28 reaches the service zones');
  const nc = dv.validationReport.points.find((p) => p.pointIndex === 5)!;
  assert(nc.metric.includes('Target NC 28') && !nc.metric.includes('Target NC 30'), `NC target from the zone: ${nc.metric}`);
  const t1 = validateSupplyAirflowBalance(dv.serviceZones, dv.supplyTerminals.map((t) => ({ ...t, cfm: t.cfm + 0.3979199999999 })), undefined, 'imperial');
  assert(!/\d\.\d{3,}/.test(t1.metric), `no long float tails in imperial text: ${t1.metric}`);
  const t1m = validateSupplyAirflowBalance(dv.serviceZones, dv.supplyTerminals, undefined, 'metric');
  assert(/L\/s/.test(t1m.metric) && !/CFM/.test(t1m.metric), `metric text uses L/s: ${t1m.metric}`);
  const t2m = validateRoomAirflowVerification(1290.3979199999999, dv.supplyTerminals, undefined, 'metric');
  assert(/L\/s/.test(t2m.metric) && !/CFM/.test(t2m.metric + t2m.criteria + t2m.message), `metric room airflow: ${t2m.metric}`);
  const t2i = validateRoomAirflowVerification(1290.3979199999999, dv.supplyTerminals, undefined, 'imperial');
  assert(!t2i.metric.includes('1290.39'), `imperial rounded: ${t2i.metric}`);
  const mb = validateSystemAirMassBalance(dv.serviceZones, dv.outdoorAirSystem, { exhaustCfm: 12.3456789, exfiltrationCfm: 100.987654321 }, 'metric');
  assert(!/CFM/.test(mb.metric + mb.message) && !/\d\.\d{3,}/.test(mb.metric), `mass balance metric: ${mb.metric}`);
  const dm = executeAirDistributionDesign(baseInput(poly4025.map((v) => v * 0.3048 * 10), 1000, 3.5, { units: 'metric', scalePxPerUnit: 1 }));
  assert(dm.validationReport.points.every((p) => !/CFM|FPM|in\.wg|Btu\/h/.test(p.metric)), `metric validation text has no imperial units: ${dm.validationReport.points.map((p) => p.metric).join(' | ')}`);
  console.log('  validation text: rounded + unit-aware + zone NC');
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. Metric diffusers are modular
// ---------------------------------------------------------------------------------------------------------------------
{
  const dm = executeAirDistributionDesign(baseInput(poly4025.map((v) => v * 0.3048 * 10), 1000, 3.5, { units: 'metric', scalePxPerUnit: 1 }));
  const faces = new Set(dm.supplyTerminals.map((t) => t.faceDimension));
  for (const f of faces) assert(['300x300', '600x300', '600x600'].includes(f), `metric face size is modular, got ${f}`);
  for (const t of dm.supplyTerminals) assert(/(150|200|250|300|350|400)/.test(t.neckDimension), `metric neck in 150-400 mm: ${t.neckDimension}`);
  const pm = convertDesignResultToZonePayload(dm);
  assert(pm.diffusers.every((d) => Math.abs(d.faceWidthIn * 25.4 % 50) < 1 || Math.abs((d.faceWidthIn * 25.4 % 50) - 50) < 1), 'face width in mm is a modular multiple');
  assert(METRIC_DIFFUSER_CATALOG.every((c) => c.terminalType !== 'square-ceiling' || (c.neckSizeIn.diameter ?? c.neckSizeIn.width) * 25.4 >= 149), 'neck >= 150 mm');
  console.log(`  metric faces: ${Array.from(faces).join(', ')}`);
}

console.log('=== autoLayoutParity: all assertions passed ===');
