import {
  doubleClickFinish, dropNearDuplicates, assignTerminalsToUnits, labelSpotInPolygon, supplyCfmOf,
  isSelfContainedSystem, fitBounds, FIT_PADDING, pointInPolygon
} from '../../canvas/drawingGeometry';
import { formatAirflow, formatLoad, formatDuctSize, formatVelocity, formatTerminalSize } from '../../canvas/displayFormat';
import {
  layoutLabels, measureLabel, rectsOverlap, ductTagCandidates, scaleBucket, bucketScale, LabelRequest, Rect
} from '../../canvas/labelLayout';

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }

console.log('=== Canvas label / interaction tests ===');

// displayFormat
assert(formatAirflow(123, 'imperial') === '123 CFM', 'airflow imperial');
assert(formatAirflow(123, 'metric') === '58 L/s', `airflow metric: ${formatAirflow(123, 'metric')}`);
assert(formatAirflow(1267, 'imperial') === '1,267 CFM', 'airflow grouping');
assert(formatLoad(22186, 'imperial') === '22,186 Btu/h', 'load imperial');
assert(formatLoad(22186, 'metric') === '6.50 kW', `load metric: ${formatLoad(22186, 'metric')}`);
assert(formatDuctSize(14, 10, 'imperial') === '14"x10"', 'duct imperial');
assert(formatDuctSize(14, 10, 'metric') === '350x250', `duct metric: ${formatDuctSize(14, 10, 'metric')}`);
assert(formatDuctSize(12, 12, 'imperial', true) === 'Ø12"', 'round duct imperial');
assert(formatVelocity(800, 'imperial') === '800 FPM', 'velocity imperial');
assert(formatVelocity(800, 'metric') === '4.1 m/s', `velocity metric: ${formatVelocity(800, 'metric')}`);
assert(formatTerminalSize(18, 18, 'imperial') === '18x18', 'terminal size imperial');
assert(formatTerminalSize(23.622, 23.622, 'metric') === '600x600', 'terminal size metric');
assert(formatAirflow(NaN, 'imperial') === '0 CFM', 'airflow NaN safe');

// supply-only airflow / self-contained systems
assert(supplyCfmOf([{ type: 'supply', cfm: 100 }, { type: 'return', cfm: 90 }, { cfm: 50 }, { type: 'exhaust', cfm: 30 }]) === 150, 'supply-only CFM');
assert(isSelfContainedSystem('packaged') && isSelfContainedSystem('rtu') && !isSelfContainedSystem('concealed'), 'RTU self-contained');

// label collision layout
const mkReqs = (): LabelRequest[] => {
  const reqs: LabelRequest[] = [];
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 5; j++) {
      reqs.push({
        id: `t${i}-${j}`, lines: ['CD-1', '18x18 · 162 CFM'], fontPx: 10, priority: 30,
        anchor: { x: 40 + i * 55, y: 30 + j * 40 }, anchorHalf: { w: 8, h: 8 }
      });
    }
  }
  reqs.push({ id: 'zone', lines: ['Open Office', '1,267 CFM (concealed)'], fontPx: 12, priority: 50, mandatory: true, anchor: { x: 150, y: 100 } });
  return reqs;
};
const obstacles: Rect[] = [];
for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) obstacles.push({ x: 32 + i * 55, y: 22 + j * 40, w: 16, h: 16 });
const L1 = layoutLabels(mkReqs(), obstacles);
const L2 = layoutLabels(mkReqs().reverse(), obstacles);
assert(L1.size === 31, 'every request yields a result');
const vis = [...L1.values()].filter((p) => p.visible);
assert(vis.length > 10, `most labels placed (${vis.length})`);
for (let a = 0; a < vis.length; a++) {
  for (let b = a + 1; b < vis.length; b++) {
    if (vis[a].id === 'zone' || vis[b].id === 'zone') continue; // mandatory may overlap
    assert(!rectsOverlap(vis[a].rect, vis[b].rect), `labels ${vis[a].id}/${vis[b].id} overlap`);
  }
  if (vis[a].id !== 'zone') {
    for (const o of obstacles) assert(!rectsOverlap(vis[a].rect, o), `label ${vis[a].id} overlaps a symbol`);
  }
}
assert(L1.get('zone')!.visible, 'mandatory label is never hidden');
for (const [id, p] of L1) {
  const q = L2.get(id)!;
  assert(p.visible === q.visible && Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9, `deterministic regardless of input order (${id})`);
}
// crowded: hidden at this zoom instead of overlapping
const crowded: LabelRequest[] = [0, 1, 2, 3].map((i) => ({
  id: `c${i}`, lines: ['CD-1', '18x18 · 162 CFM'], fontPx: 10, priority: 30, anchor: { x: 100, y: 100 }, anchorHalf: { w: 4, h: 4 },
  candidates: [{ x: 100, y: 100 }]
}));
const C = layoutLabels(crowded, []);
assert([...C.values()].filter((p) => p.visible).length === 1, 'only one label fits one spot; others hidden');
const sz = measureLabel(['abcdefghij'], 10);
assert(Math.abs(sz.w - (10 * 0.6 * 10 + 6)) < 1e-9, 'measure ~0.6 em per char');

// duct tag candidates stay upright and skip short pieces
const dc = ductTagCandidates([[0, 0, 200, 0], [0, 0, 10, 0], [200, 0, 200, -100]], 5, { w: 40, h: 12 });
assert(dc.length > 0 && dc.every((c) => (c.angleDeg ?? 0) > -90 && (c.angleDeg ?? 0) <= 90), 'duct tags upright');
assert(dc.every((c) => c.x > -1), 'short piece skipped');
assert(scaleBucket(1) === 0 && Math.abs(bucketScale(scaleBucket(2)) - 2) < 1e-9, 'scale bucket round-trips');

// double-click finish rule
const sq = [0, 0, 100, 0, 100, 100, 0, 100];
assert(doubleClickFinish(sq, 1, 2).finish, 'dblclick on one spot finishes');
assert(!doubleClickFinish(sq, 25, 2).finish, 'two fast clicks on different vertices must NOT close');
assert(!doubleClickFinish([0, 0, 100, 0, 100.5, 0.5], 1, 2).finish, 'only 2 distinct points -> no finish');
const dup = doubleClickFinish([0, 0, 100, 0, 100, 100, 0, 100, 0.5, 100.5], 1, 2);
assert(dup.finish && dup.points.length === 8, 'duplicate vertex of the second click is dropped');
assert(dropNearDuplicates([0, 0, 0.1, 0.1, 5, 5], 1).length === 4, 'near duplicates collapsed');

// capacity-constrained assignment
const terms = [
  { x: 10, y: 0, cfm: 230 }, { x: 20, y: 0, cfm: 230 }, { x: 30, y: 0, cfm: 230 }, { x: 40, y: 0, cfm: 230 }
];
const units = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
const asg = assignTerminalsToUnits(terms, units); // nearest-only would give 920 vs 0
assert(asg.loads[0] === 460 && asg.loads[1] === 460, `balanced by capacity (${asg.loads.join('/')})`);
assert(!asg.anyOverloaded, 'no overload when it can be balanced');
assert(asg.groups.flat().length === 4, 'every terminal assigned once');
const one = assignTerminalsToUnits([{ x: 0, y: 0, cfm: 690 }, { x: 5, y: 0, cfm: 230 }], [{ x: 0, y: 0 }, { x: 50, y: 0 }], 460);
assert(one.anyOverloaded && one.overloaded[0], 'indivisible 690 CFM terminal on a 460 CFM unit is flagged (>5%)');
const within = assignTerminalsToUnits([{ x: 0, y: 0, cfm: 470 }], [{ x: 0, y: 0 }], 460);
assert(!within.anyOverloaded, '470 vs 460 (<5%) is not flagged');
const again = assignTerminalsToUnits(terms, units);
assert(JSON.stringify(again.groups) === JSON.stringify(asg.groups), 'assignment deterministic');

// zone label spot: away from terminals, inside the polygon
const room = [0, 0, 400, 0, 400, 200, 0, 200];
const spot = labelSpotInPolygon(room, [{ x: 200, y: 100, r: 40 }])!;
assert(pointInPolygon(room, spot.x, spot.y), 'label spot inside polygon');
assert(Math.hypot(spot.x - 200, spot.y - 100) > 40, 'label spot clear of the terminal');
const pole = labelSpotInPolygon(room)!;
assert(Math.abs(pole.y - 100) < 6 && pole.clearance > 90, 'pole of inaccessibility of a rectangle is on its mid line');

// fit with overlay padding keeps corners clear of the bottom toolbar
const fit = fitBounds({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, 1000, 500, 1, FIT_PADDING);
const bottom = fit.y + 500 * fit.scale;
assert(bottom <= 500 - FIT_PADDING.bottom + 1e-6, `content bottom ${bottom} stays above the toolbar band`);
assert(fit.x >= FIT_PADDING.left - 1e-6 && fit.x + 1000 * fit.scale <= 1000 - FIT_PADDING.right + 1e-6, 'horizontal padding');

console.log('canvasLabels: all tests passed');
