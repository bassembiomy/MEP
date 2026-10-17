import { executeAirDistributionDesign, convertDesignResultToZonePayload } from '../airDistributionEngine';
import { isPointInPolygon, distanceToPolygonEdge } from '../geometry';
import { remapTerminalSize } from '../terminals/terminalSizeMap';
import { generateDesignDecisionLog, normalizeNegativeZero } from '../systemArchitecture/designDecisionLogger';
import { unitKeepOutFt } from '../ducts/clearance';
import { parseFaceIn } from '../ducts/clearance';
import { designZone } from '../../panels/zoneDesign';
import type { Zone, ProjectMetadata } from '../../store/projectStore';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}
console.log('=== Layout fixes (K1) ===');

const base = (poly: number[], area: number, cfm: number, tons: number, extra: object = {}): Parameters<typeof executeAirDistributionDesign>[0] => ({
  roomName: 'T', roomPolygon: poly, roomAreaSqFt: area, sensibleLoadBtu: tons * 9000, totalLoadBtu: tons * 12000,
  requiredCfm: cfm, systemType: 'concealed', spaceTypeId: 'office', ...extra
});

// 1. high-wall unit in an L room sits ON a wall, inside, with a wall directly behind it
{
  const L = [0, 0, 40, 0, 40, 15, 20, 15, 20, 30, 0, 30];
  const d = executeAirDistributionDesign(base(L, 1050, 1500, 4, { systemType: 'high-wall' }));
  for (const z of d.serviceZones) {
    const p = z.equipmentPosition;
    assert(isPointInPolygon(p.x, p.y, L), 'high-wall unit inside the room');
    const wd = distanceToPolygonEdge(p.x, p.y, L);
    assert(Math.abs(wd - (10 / 12) / 2) < 0.05, `unit back flush with the wall (distance ${wd.toFixed(2)})`);
  }
  const payload = convertDesignResultToZonePayload(d);
  assert(payload.unitPositions.length === d.serviceZones.length, 'payload units');
}

// 2. crossover / clearance flags survive the payload conversion
{
  const d = executeAirDistributionDesign(base([0, 0, 42, 0, 42, 11.5, 0, 11.5], 480, 1500, 4, { returnStrategy: 'ducted' }));
  d.returnDucts[0].crossover = true;
  d.returnDucts[0].crossoverWith = ['DS-X'];
  d.returnDucts[0].clearanceIssue = 'test';
  d.returnDucts[0].designWarnings = ['w'];
  const pd = convertDesignResultToZonePayload(d).ducts.find((x) => x.id === d.returnDucts[0].id)!;
  assert(pd.crossover === true && pd.crossoverWith?.[0] === 'DS-X' && pd.clearanceIssue === 'test' && pd.designWarnings?.[0] === 'w', 'flags copied');
}

// 3. return strategy: plenum = no return mains; ducted = a network
{
  const poly = [0, 0, 40, 0, 40, 25, 0, 25];
  const pl = executeAirDistributionDesign(base(poly, 1000, 1294, 3.5));
  assert(pl.returnStrategy === 'plenum', 'concealed defaults to plenum');
  assert(pl.returnDucts.length === pl.serviceZones.length && pl.returnDucts.every((x) => x.plenumBox), 'one return box per unit, no mains');
  const du = executeAirDistributionDesign(base(poly, 1000, 1294, 3.5, { returnStrategy: 'ducted' }));
  assert(du.returnDucts.length > du.serviceZones.length, 'ducted return network routed');
  const noPlenum = executeAirDistributionDesign(base(poly, 1000, 1294, 3.5, { ceilingPlenum: false }));
  assert(noPlenum.returnStrategy === 'ducted', 'no plenum -> ducted');
  // 5. each ODU is on the exterior wall nearest its own indoor unit
  const pls = pl.outdoorUnitPositions;
  assert(pls.length === pl.serviceZones.length, 'one ODU per unit');
  // 4. over-diffusion: 6 - 10 supply diffusers for 1000 ft2 office
  const n = pl.supplyTerminals.length;
  assert(n >= 6 && n <= 10, `1000 ft2 office -> 6-10 diffusers (got ${n})`);
  assert(pl.supplyTerminals.every((t) => t.cfm >= 90), 'each diffuser carries a meaningful airflow');
  // 6. terminals keep out of the unit footprint + 2 ft service clearance
  for (const t of [...pl.supplyTerminals, ...pl.returnTerminals]) {
    const f = parseFaceIn(t.faceDimension);
    for (const z of pl.serviceZones) {
      const k = unitKeepOutFt(z.equipmentPosition, pl.unitFootprintsIn?.[z.id], 2);
      const ox = Math.min(t.position.x + f.w / 24, k.maxX) - Math.max(t.position.x - f.w / 24, k.minX);
      const oy = Math.min(t.position.y + f.h / 24, k.maxY) - Math.max(t.position.y - f.h / 24, k.minY);
      assert(!(ox > 0.01 && oy > 0.01), `${t.id} clear of ${z.unitTag}`);
    }
  }
}

// 5. ODU on the wall nearest its own unit: tall room, units stacked along y -> the ODUs split between both long walls
{
  const poly = [0, 0, 30, 0, 30, 60, 0, 60];
  const d = executeAirDistributionDesign(base(poly, 1800, 3000, 8, { mountingWallSide: 'east' }));
  d.outdoorUnitPositions.forEach((o, i) => {
    const z = d.serviceZones.find((q) => o.serves?.includes(q.id))!;
    const dOwn = Math.hypot(o.x - z.equipmentPosition.x, o.y - z.equipmentPosition.y);
    assert(dOwn < 40, `ODU ${i} near its unit (${dOwn.toFixed(1)} ft)`);
    assert(!isPointInPolygon(o.x, o.y, poly), 'ODU outside the room');
  });
}

// 7. unit-aware decision log: metric has no imperial raw units, no negative zero
{
  const d = executeAirDistributionDesign(base([0, 0, 12, 0, 12, 9, 0, 9], 108, 500, 1.5, { units: 'metric', scalePxPerUnit: 20, roomPolygon: [0, 0, 12, 0, 12, 9, 0, 9].map((v) => v * 20 * 0.3048) }));
  assert(!/CFM|Btu\/h|in\.wg/.test(d.designDecisionLog), `metric log free of imperial units:\n${d.designDecisionLog}`);
  assert(/L\/s/.test(d.designDecisionLog) && /kW/.test(d.designDecisionLog), 'metric log uses L/s and kW');
  const raw = d.designDecisionLog.match(/\d+\.\d{3,}/g);
  assert(!raw, `no raw floats in the log: ${raw}`);
  assert(normalizeNegativeZero('flow -0 L/s, -0.0 kW, -0.5 m, -10') === 'flow 0 L/s, 0.0 kW, -0.5 m, -10', 'negative zero normalised');
  assert(typeof generateDesignDecisionLog === 'function', 'logger exported');
  const comfort = d.validationReport.points.find((p) => p.pointIndex === 6);
  assert(!!comfort && !/FPM/.test(comfort.criteria), 'comfort criteria in m/s for metric');
}

// 8. unit toggle remaps sizes to the nearest modular size, keeping CFM, and rechecks neck velocity
{
  const m = remapTerminalSize(18, 18, 300, 'metric'); // 457 mm face
  assert(m.size === '600x600', `457 -> 600x600 (${m.size})`);
  const m2 = remapTerminalSize(15, 15, 100, 'metric'); // 381 mm face
  assert(m2.size === '300x300', `381 -> 300x300 (${m2.size})`);
  const i = remapTerminalSize(600 / 25.4, 600 / 25.4, 400, 'imperial');
  assert(i.size === '24"x24"', `600 -> 24x24 (${i.size})`);
  const w = remapTerminalSize(12, 12, 2000, 'imperial');
  assert(!!w.warning, 'neck velocity exceeded is warned');
}

// panel pipeline: high-wall zone through designZone
{
  const project: ProjectMetadata = { name: 'T', location: 'T', scale: 10, units: 'imperial', outdoorDb: 95, indoorDb: 75 };
  const poly = [0, 0, 400, 0, 400, 150, 200, 150, 200, 300, 0, 300];
  const zone: Zone = { id: 'z1', name: 'L', points: poly, spaceTypeId: 'office', ceilingHeight: 10, occupants: 0, systemType: 'high-wall', diffusers: [], ducts: [] };
  const { design } = designZone(zone, [zone], project);
  const L = poly.map((v) => v / 10);
  for (const z of design.serviceZones) assert(isPointInPolygon(z.equipmentPosition.x, z.equipmentPosition.y, L), 'designZone high-wall unit inside');
}

console.log('✔ Layout fixes (K1) passed');
