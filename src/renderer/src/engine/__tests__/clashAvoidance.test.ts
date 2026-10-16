/**
 * Plan-clash regression for the live E2E repro: a 40 x 25 ft room, two concealed units on the east wall, ~2278 CFM.
 * Asserts: duct edges >= 0.5 ft inside the wall, no duct through a terminal face, no unflagged supply/return crossing,
 * no terminal in a unit keep-out, ODUs outside the room (>= 1 ft) and >= 1 ft apart, wall-mounted unit flush to a wall,
 * and that routeDucts honours the drawing scale (px per ft) when it places the indoor unit.
 *
 * Run: npx -y tsx src/renderer/src/engine/__tests__/clashAvoidance.test.ts
 */
import { executeAirDistributionDesign, convertDesignResultToZonePayload } from '../airDistributionEngine';
import { routeDucts } from '../ductRouter';
import { isPointInPolygon, distanceToPolygonEdge, calculateWallMountedUnitPos, calculateOutdoorUnitPlacement } from '../geometry';
import { parseFaceIn, unitKeepOutFt } from '../ducts/clearance';

let failures = 0;
function assert(ok: boolean, msg: string): void {
  if (!ok) { failures++; console.log(`FAIL: ${msg}`); }
}

const ROOM = [10, 10, 50, 10, 50, 35, 10, 35]; // 40 x 25 ft
const design = executeAirDistributionDesign({
  roomName: 'E2E',
  roomPolygon: ROOM,
  roomAreaSqFt: 1000,
  sensibleLoadBtu: 62000,
  totalLoadBtu: 78000,
  requiredCfm: 2278,
  systemType: 'concealed',
  mountingWallSide: 'east',
  userOverrideUnitCount: 2,
  spaceTypeId: 'office',
  occupancyCount: 30,
  maxAvailableCeilingDepthIn: 14
});

const terms = [...design.supplyTerminals, ...design.returnTerminals];
const sections = [...design.supplyDucts, ...design.returnDucts];
assert(design.serviceZones.length === 2, `2 units expected, got ${design.serviceZones.length}`);
assert(design.supplyTerminals.length >= 8, `at least 8 supply diffusers, got ${design.supplyTerminals.length}`);

function wallDist(x: number, y: number): number {
  return distanceToPolygonEdge(x, y, ROOM);
}
const bodyOverlap = (a: { x: number; y: number }, b: { x: number; y: number }, hw: number, c: { x: number; y: number }, fw: number, fh: number): number => {
  const ox = Math.min(Math.max(a.x, b.x) + hw, c.x + fw / 24) - Math.max(Math.min(a.x, b.x) - hw, c.x - fw / 24);
  const oy = Math.min(Math.max(a.y, b.y) + hw, c.y + fh / 24) - Math.max(Math.min(a.y, b.y) - hw, c.y - fh / 24);
  return Math.min(ox, oy);
};

// 1. trunk (and every duct) edge >= 0.5 ft inside the wall - the sized width is used
for (const s of sections) {
  if (s.clearanceIssue) { assert(false, `${s.id} flagged: ${s.clearanceIssue}`); continue; }
  const n = Math.max(1, Math.ceil(Math.hypot(s.endPoint.x - s.startPoint.x, s.endPoint.y - s.startPoint.y) / 0.25));
  for (let i = 0; i <= n; i++) {
    const x = s.startPoint.x + ((s.endPoint.x - s.startPoint.x) * i) / n, y = s.startPoint.y + ((s.endPoint.y - s.startPoint.y) * i) / n;
    assert(isPointInPolygon(x, y, ROOM) && wallDist(x, y) >= s.widthIn / 24 + 0.5 - 0.02,
      `${s.id} (${s.widthIn}" wide) edge only ${(wallDist(x, y) - s.widthIn / 24).toFixed(2)} ft from the wall at (${x.toFixed(1)},${y.toFixed(1)})`);
  }
}

// 2. no duct through a terminal face (only the final run-out ending at its centre may enter)
for (const s of sections) {
  for (const t of terms) {
    const f = parseFaceIn(t.faceDimension);
    const ov = bodyOverlap(s.startPoint, s.endPoint, s.widthIn / 24, t.position, f.w, f.h);
    const ends = Math.hypot(s.endPoint.x - t.position.x, s.endPoint.y - t.position.y) <= 0.15;
    assert(!(ov > 0.01 && !ends), `${s.id} runs through ${t.id}`);
  }
}

// 3. supply and return networks do not cross (unavoidable crossings must be flagged)
let crossings = 0;
for (const s of design.supplyDucts) {
  for (const r of design.returnDucts) {
    const sh = Math.abs(s.startPoint.y - s.endPoint.y) < 1e-6, rh = Math.abs(r.startPoint.y - r.endPoint.y) < 1e-6;
    if (sh === rh) continue;
    const [h, v] = sh ? [s, r] : [r, s];
    const px = v.startPoint.x, py = h.startPoint.y;
    const inH = px >= Math.min(h.startPoint.x, h.endPoint.x) - 0.02 && px <= Math.max(h.startPoint.x, h.endPoint.x) + 0.02;
    const inV = py >= Math.min(v.startPoint.y, v.endPoint.y) - 0.02 && py <= Math.max(v.startPoint.y, v.endPoint.y) + 0.02;
    const atUnit = design.serviceZones.some((z) => Math.hypot(z.equipmentPosition.x - px, z.equipmentPosition.y - py) <= 0.1);
    if (inH && inV && !atUnit) {
      crossings++;
      assert(!!(s.crossover && r.crossover), `${s.id} crosses ${r.id} at (${px.toFixed(1)},${py.toFixed(1)}) without a crossover flag`);
    }
  }
}

// 4. terminals outside every unit footprint + 2 ft service clearance
for (const z of design.serviceZones) {
  const ko = unitKeepOutFt(z.equipmentPosition, design.unitFootprintsIn?.[z.id], 2);
  for (const t of terms) {
    const f = parseFaceIn(t.faceDimension);
    const ox = Math.min(t.position.x + f.w / 24, ko.maxX) - Math.max(t.position.x - f.w / 24, ko.minX);
    const oy = Math.min(t.position.y + f.h / 24, ko.maxY) - Math.max(t.position.y - f.h / 24, ko.minY);
    assert(!(ox > 0.01 && oy > 0.01), `${t.id} inside the ${z.unitTag} keep-out zone`);
  }
}
assert((design.layoutWarnings || []).every((w) => !w.includes('relaxed')), `keep-out relaxed: ${(design.layoutWarnings || []).join('; ')}`);

// 5. outdoor units: outside the room by >= 1 ft, not over each other (>= 1 ft apart)
const oduRect = (o: (typeof design.outdoorUnitPositions)[number]): Array<{ x: number; y: number }> => {
  const a = ((o.angleDeg ?? 0) * Math.PI) / 180, tx = Math.cos(a), ty = Math.sin(a);
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 6; j++) {
    const u = (i / 20 - 0.5) * (o.lengthFt ?? 34 / 12), v = (j / 6 - 0.5) * (o.depthFt ?? 13 / 12);
    out.push({ x: o.x + tx * u - ty * v, y: o.y + ty * u + tx * v });
  }
  return out;
};
design.outdoorUnitPositions.forEach((o, i) => {
  for (const p of oduRect(o)) assert(!isPointInPolygon(p.x, p.y, ROOM) && wallDist(p.x, p.y) >= 1 - 0.03, `ODU ${i} within 1 ft of / inside the room`);
});
for (let i = 0; i < design.outdoorUnitPositions.length; i++) for (let j = i + 1; j < design.outdoorUnitPositions.length; j++) {
  let m = Infinity;
  for (const a of oduRect(design.outdoorUnitPositions[i])) for (const b of oduRect(design.outdoorUnitPositions[j])) m = Math.min(m, Math.hypot(a.x - b.x, a.y - b.y));
  assert(m >= 1 - 0.1, `ODU ${i} and ${j} are ${m.toFixed(2)} ft apart`);
}
// neighbouring zone to the east: the ODU moves to another wall
{
  const east = [50, 10, 90, 10, 90, 35, 50, 35];
  const withNeighbour = executeAirDistributionDesign({
    roomName: 'E2E-n', roomPolygon: ROOM, roomAreaSqFt: 1000, sensibleLoadBtu: 62000, totalLoadBtu: 78000, requiredCfm: 2278,
    systemType: 'concealed', mountingWallSide: 'east', userOverrideUnitCount: 2, spaceTypeId: 'office', otherZonePolygons: [east]
  });
  for (const o of withNeighbour.outdoorUnitPositions) assert(!isPointInPolygon(o.x, o.y, east), `ODU at (${o.x},${o.y}) is inside the neighbouring zone`);
  const px = calculateOutdoorUnitPlacement(ROOM.map((v) => v * 10), [], null, 10, { otherZonePolygons: [east.map((v) => v * 10)] });
  assert(!isPointInPolygon(px.x, px.y, east.map((v) => v * 10)), 'px ODU inside the neighbouring zone');
}

// 6. wall-mounted unit is ON a wall (also for an L-shaped zone)
for (const poly of [ROOM, [0, 0, 40, 0, 40, 20, 20, 20, 20, 40, 0, 40]]) {
  const w = calculateWallMountedUnitPos(poly, 1, { exteriorSide: 'east' });
  let best = Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    const j = (i + 2) % poly.length;
    const dx = poly[j] - poly[i], dy = poly[j + 1] - poly[i + 1];
    const t = Math.max(0, Math.min(1, ((w.x - poly[i]) * dx + (w.y - poly[i + 1]) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(w.x - (poly[i] + t * dx), w.y - (poly[i + 1] + t * dy)));
  }
  assert(Math.abs(best - w.depthFt / 2) < 0.03 && isPointInPolygon(w.x, w.y, poly), `wall unit ${best.toFixed(2)} ft from the wall (expected ${(w.depthFt / 2).toFixed(2)})`);
}

// 7. routeDucts: the drawing scale (10 px/ft) reaches the indoor-unit placement (was defaulting to 1 px/ft)
{
  const k = 10;
  const payload = convertDesignResultToZonePayload(design);
  const poly = ROOM.map((v) => v * k);
  const one = payload.diffusers.filter((d) => d.id.includes('FCU-01'));
  const r = routeDucts(poly, one.map((d) => ({ ...d })), 'imperial', 'z', undefined, 'concealed', payload.outdoorUnitPos, { targetNc: 32 }, k);
  const wd = distanceToPolygonEdge(r.unitPos.x, r.unitPos.y, poly) / k;
  assert(wd >= 2 - 1e-6, `routeDucts placed the indoor unit ${wd.toFixed(2)} ft from the wall (needs >= 2 ft service clearance at 10 px/ft)`);
  for (const d of r.ducts) {
    const dd = d as typeof d & { clearanceIssue?: string };
    if (dd.clearanceIssue) continue;
    const hw = (d.widthIn / 12) * k / 2;
    for (let i = 0; i < d.points.length; i += 2) {
      assert(distanceToPolygonEdge(d.points[i], d.points[i + 1], poly) >= hw + 0.5 * k - 0.2, `routeDucts ${d.id} edge < 0.5 ft from the wall`);
    }
  }
}

console.log(`clashAvoidance: ${crossings} flagged supply/return crossover(s) in the E2E repro`);
console.log(failures ? `\n${failures} clash assertion(s) FAILED` : '\nALL CLASH-AVOIDANCE CHECKS PASSED');
process.exit(failures ? 1 : 0);
