import { readFileSync } from 'fs';
import { join } from 'path';
import {
  chwRoute, condensatePlan, footprintExitDistance, CHW_STUB_MIN_FT
} from '../../canvas/polishL2';
import { pathInsidePolygon } from '../../canvas/routeInside';
import {
  FLOOR_PLAN_LAYER_COUNT, MAX_KONVA_LAYERS, CONDENSATE_TAG, boundsWithLabels, pipeBubbleSpots, staggerLabels,
  sectionTabLabel, unitTagFor
} from '../../canvas/polishM2';
import { legendItems } from '../../canvas/shopDrawing';
import { isOrthogonalPath } from '../../canvas/polishL2';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(m);
}

console.log('=== Running Canvas Polish M2 Test ===');
const k = 10; // px per ft

// 1. CHW stubs extend >= 2 ft beyond the unit footprint
const room = [0, 0, 400, 0, 400, 300, 0, 300];
const fp = { w: 6 * k, d: 3 * k };
const unit = { x: 200, y: 150 };
for (const stub of [undefined, { x: 200, y: 150 }, { x: 215, y: 150 }, { x: 200, y: 145 }, { x: 330, y: 150 }]) {
  const r = chwRoute(unit, fp, k, room, 0, stub);
  assert(!!r, 'chw route exists');
  const rt = r!;
  const total = rt.points.reduce((a, _, i, p) => (i % 2 === 0 && i + 3 < p.length ? a + Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) : a), 0);
  const vis = total - footprintExitDistance(rt.points, fp, k);
  assert(vis >= CHW_STUB_MIN_FT * k - 1e-6, `stub shows >= 2 ft beyond unit (got ${(vis / k).toFixed(2)} ft) for ${JSON.stringify(stub)}`);
  assert(isOrthogonalPath(rt.points), 'stub orthogonal');
  for (const v of rt.valves) {
    assert(Math.abs(v.x - unit.x) > fp.w / 2 - 1e-6 || Math.abs(v.y - unit.y) > fp.d / 2 - 1e-6, 'valve outside footprint');
  }
}

// 2. condensate tag
assert(CONDENSATE_TAG === 'CDP', 'condensate tag CDP');
assert(legendItems().some((l) => l.label === 'CDP – CONDENSATE DRAIN PIPE'), 'legend entry CDP');
assert(!legendItems().some((l) => /^CD - /.test(l.label)), 'no legacy CD condensate legend');

// 3. condensate route stays inside its own zone (two rooms with an outdoor gap between)
const zoneA = [0, 0, 200, 0, 200, 200, 0, 200];
const zoneB = [260, 0, 460, 0, 460, 200, 260, 200];
const lShape = [0, 0, 300, 0, 300, 100, 100, 100, 100, 300, 0, 300];
const ufp = { w: 4 * k, d: 2 * k };
const cases: Array<{ name: string; unitP: { x: number; y: number }; poly: number[]; drains: Array<{ id: string; x: number; y: number }> }> = [
  { name: 'wall route A', unitP: { x: 150, y: 100 }, poly: zoneA, drains: [] },
  { name: 'wall route B', unitP: { x: 330, y: 60 }, poly: zoneB, drains: [] },
  { name: 'drain in A used by A', unitP: { x: 150, y: 100 }, poly: zoneA, drains: [{ id: 'd1', x: 20, y: 20 }] },
  // the only drain point lies in zone A: zone B must not route to it across the outdoor gap
  { name: 'foreign drain ignored', unitP: { x: 330, y: 60 }, poly: zoneB, drains: [{ id: 'd1', x: 20, y: 20 }] },
  { name: 'L shaped room', unitP: { x: 50, y: 250 }, poly: lShape, drains: [{ id: 'd2', x: 280, y: 20 }] }
];
for (const c of cases) {
  const obstacles = [{ x: c.unitP.x - ufp.w / 2, y: c.unitP.y - ufp.d / 2, w: ufp.w, h: ufp.d }, { x: c.unitP.x - 40, y: c.unitP.y - 60, w: 20, h: 120 }];
  const cd = condensatePlan(c.unitP, ufp, k, c.poly, c.drains, obstacles);
  assert(!!cd, `${c.name}: plan exists`);
  assert(pathInsidePolygon(cd!.points, c.poly, 0.6), `${c.name}: condensate route stays inside the zone polygon`);
  assert(isOrthogonalPath(cd!.points), `${c.name}: orthogonal`);
}
const foreign = condensatePlan({ x: 330, y: 60 }, ufp, k, zoneB, [{ id: 'd1', x: 20, y: 20 }], []);
assert(!!foreign && !foreign.toDrain, 'a drain point of another zone is not used');
assert(foreign!.points.every((v, i) => (i % 2 === 0 ? v >= 260 - 0.6 && v <= 460 + 0.6 : true)), 'never enters the gap between buildings');
const own = condensatePlan({ x: 150, y: 100 }, ufp, k, zoneA, [{ id: 'd1', x: 20, y: 20 }], []);
assert(!!own && own.toDrain, 'own drain point is used');

// 4. P / R bubbles keep >= 1.5 ft off the unit edges
const pipe = [20, 150, 20, 60, 180, 60, 180, 100];
const iduR = { w: 4 * k, d: 2 * k }, oduR = { w: 3 * k, d: 3 * k };
const spots = pipeBubbleSpots([30, 30, 30, 100, 200, 100], oduR, iduR, k, 'end');
assert(spots.length > 0, 'bubble spots exist');
for (const sp of spots) {
  const dIdu = Math.max(Math.abs(sp.x - 200) - iduR.w / 2, Math.abs(sp.y - 100) - iduR.d / 2);
  const dOdu = Math.max(Math.abs(sp.x - 30) - oduR.w / 2, Math.abs(sp.y - 30) - oduR.d / 2);
  assert(dIdu >= 1.5 * k - 1e-6 && dOdu >= 1.5 * k - 1e-6, 'bubble >= 1.5 ft from unit edges');
}
assert(pipeBubbleSpots(pipe, null, null, k, 'start').length > 0, 'spots without unit rects');

// 5. layer budget
assert(FLOOR_PLAN_LAYER_COUNT <= MAX_KONVA_LAYERS, 'layer count constant within Konva budget');
const src = readFileSync(join(__dirname, '..', '..', 'canvas', 'FloorPlanCanvas.tsx'), 'utf8');
const layers = (src.match(/<Layer[\s>]/g) || []).length;
assert(layers <= MAX_KONVA_LAYERS && layers === FLOOR_PLAN_LAYER_COUNT, `FloorPlanCanvas renders ${layers} layers`);

// 6. fit bounds include labels
const content = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
const fitScale = (b: { minX: number; minY: number; maxX: number; maxY: number }): number => Math.min(1000 / (b.maxX - b.minX), 700 / (b.maxY - b.minY)) * 0.92;
const lab = [{ ax: 400, ay: 150, dx: 120, dy: 0, w: 100, h: 30 }, { ax: 0, ay: 0, dx: -40, dy: -50, w: 80, h: 20 }];
const fb = boundsWithLabels(content, lab, fitScale);
assert(fb.maxX > 400 && fb.minX < 0 && fb.minY < 0, 'bounds grow to hold the labels');
const sc = fitScale(fb);
assert(fb.maxX >= 400 + ((120 + 50) / sc) * 0.98, 'right label fully inside the final fit');
assert(fb.minY <= ((-50 - 10) / sc) * 0.98, 'top label fully inside the final fit');
const same = boundsWithLabels(content, [], fitScale);
assert(same.maxX === 400 && same.minY === 0, 'no labels: unchanged');

// 7. section label staggering + tab labels
const st = staggerLabels([
  { id: 'a', x: 100, y: 50, w: 40 },
  { id: 'b', x: 110, y: 50, w: 40 },
  { id: 'c', x: 120, y: 50, w: 40 },
  { id: 'd', x: 400, y: 50, w: 40 }
]);
const byId = new Map(st.map((l) => [l.id, l]));
for (const a of st) for (const b of st) {
  if (a.id >= b.id) continue;
  const wa = 40, wb = 40;
  const ox = Math.abs(a.x - b.x) < (wa + wb) / 2, oy = Math.abs(a.y - b.y) < 11;
  assert(!(ox && oy), `labels ${a.id}/${b.id} do not overlap`);
}
assert(byId.get('a')!.level === 0 && !byId.get('a')!.leader, 'first label stays put');
assert(byId.get('b')!.level > 0 && byId.get('b')!.leader, 'colliding label is lifted with a leader');
assert(byId.get('d')!.level === 0, 'distant label unchanged');
assert(unitTagFor({}, 0) === 'FCU-01' && unitTagFor({ unitTags: ['AHU-7', 'FCU-9'] }, 1) === 'FCU-9', 'unit tag fallback / zone tag');
const zn = { unitTags: ['FCU-A1', 'FCU-A2'], unitServiceZones: [{ id: 'sz-9f3' }, { id: 'sz-b21' }] };
const tabL = sectionTabLabel(zn, { label: 'B-B', kind: 'longitudinal', unitId: 'sz-b21' });
assert(tabL === 'B-B Trunk FCU-A2' && !tabL.includes('sz-'), `tab shows the unit tag, got ${tabL}`);
assert(sectionTabLabel({}, { label: 'A-A', kind: 'longitudinal', unitId: 'unit-2' }) === 'A-A Trunk FCU-02', 'tab fallback FCU-0n');
assert(sectionTabLabel({}, { label: 'C-C', kind: 'transverse' }) === 'C-C Transverse', 'transverse tab');

console.log('Canvas Polish M2 OK');
