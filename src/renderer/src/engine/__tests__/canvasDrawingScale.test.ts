import { pxPerFt } from '../units';
import {
  parseTerminalSizeIn, terminalFacePx, ductHalfWidthPx, throwRadiusPx, reducerTaperLength,
  buildDuctOutline, validateClosablePolygon, dropTrailingDuplicate, isNearFirstPoint, polygonSelfIntersects,
  buildSnapIndex, resolveSnap, findNearestSnap, gridStepPx, unitFootprintPx, hatchSegments, groupByLayerColor,
  fitBounds, unionBounds, terminalSizeLabel
} from '../../canvas/drawingGeometry';

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }
const near = (a: number, b: number, e = 1e-6): boolean => Math.abs(a - b) <= e;

console.log('=== Canvas drawing scale tests ===');

// Physical sizes
const k10 = pxPerFt(10, 'imperial');
assert(near(terminalFacePx({ size: '24x24' }, k10, 'imperial').w, 20), '24" diffuser at 10 px/ft = 20 px');
const kM = pxPerFt(20, 'metric'); // 20 px per metre
assert(near(terminalFacePx({ size: '600x600' }, kM, 'metric').w, 12, 1e-6), '600 mm at 20 px/m = 12 px');
assert(near(ductHalfWidthPx(12, k10), 5), '12" duct half width = 5 px');
assert(near(throwRadiusPx(10, k10), 100), 'T50 10 ft = 100 px');
assert(near(terminalFacePx({ size: '24x12', type: 'return' }, k10).h, 10), 'return rectangular');
assert(near(terminalFacePx({ size: '1x1', faceWidthIn: 24, faceHeightIn: 12 }, k10).w, 20), 'explicit face fields win');

// parseTerminalSizeIn
const p1 = parseTerminalSizeIn('24x24', 'imperial')!;
assert(p1.w === 24 && p1.h === 24, 'parse 24x24');
const p2 = parseTerminalSizeIn('24"X12"', 'imperial')!;
assert(p2.w === 24 && p2.h === 12, 'parse 24"X12"');
const p3 = parseTerminalSizeIn('600x600', 'metric')!;
assert(near(p3.w, 23.622, 0.01), 'parse 600x600 mm');
const p4 = parseTerminalSizeIn('600 x 300 mm', 'metric')!;
assert(near(p4.h, 11.811, 0.01), 'parse 600 x 300 mm');
assert(parseTerminalSizeIn('', 'imperial') === null && parseTerminalSizeIn('abc', 'imperial') === null, 'parse junk -> null');
assert(terminalSizeLabel({ size: '24x12' }, 'imperial') === '24"X12"', 'label imperial');
assert(terminalSizeLabel({ size: '600x600' }, 'metric') === '600X600', 'label metric');

// Unit footprints
const fcu = unitFootprintPx('ducted', k10);
assert(near(fcu.w, (40 / 12) * 10) && near(fcu.d, (24 / 12) * 10), 'default ducted FCU 40x24 in');
const cat = unitFootprintPx('ducted', k10, { width: 43.3, depth: 27.6 });
assert(near(cat.w, (43.3 / 12) * 10), 'catalog dims used');
assert(near(unitFootprintPx('cassette', k10).w, (33 / 12) * 10), 'cassette 33 in');

// Duct outline: L-shaped run, w = 12" at 10 px/ft -> hw 5
const L = buildDuctOutline([
  { id: 'a', type: 'trunk', points: [0, 0, 100, 0], widthIn: 12 },
  { id: 'b', type: 'trunk', points: [100, 0, 100, 100], widthIn: 12 }
], k10);
assert(L.length === 1, 'L is a single run');
const o = L[0].outline;
assert(o.length === 12, `L outline has 6 vertices (no notch), got ${o.length / 2}`);
const hasPt = (arr: number[], x: number, y: number): boolean => {
  for (let i = 0; i < arr.length; i += 2) if (near(arr[i], x, 1e-6) && near(arr[i + 1], y, 1e-6)) return true;
  return false;
};
assert(hasPt(o, 105, -5), 'outer corner at (105,-5)');
assert(hasPt(o, 95, 5), 'inner corner at (95,5)');
assert(hasPt(o, 0, 5) && hasPt(o, 0, -5) && hasPt(o, 95, 100) && hasPt(o, 105, 100), 'end vertices');
assert(L[0].ticks.length === 2, 'flange ticks only at the two free ends (not at the elbow)');
assert(L[0].walls.length === 2, 'two continuous walls');

// Reducer
const Rr = buildDuctOutline([
  { id: 'a', type: 'trunk', points: [0, 0, 100, 0], widthIn: 24 },
  { id: 'b', type: 'trunk', points: [100, 0, 200, 0], widthIn: 12 }
], k10);
assert(Rr.length === 1, 'reducer single run');
const taper = reducerTaperLength(20, 10);
assert(near(taper, 5 / Math.tan(15 * Math.PI / 180), 1e-9) && near(taper, 18.66, 0.01), 'taper length (dW/2)/tan15');
// big segment is first: taper begins at x = 100 - taper with half width 10 and ends at x=100 with half width 5
const ro = Rr[0].outline;
assert(hasPt(ro, 100 - taper, 10) && hasPt(ro, 100, 5) && hasPt(ro, 100 - taper, -10) && hasPt(ro, 100, -5), 'tapered reducer points');
assert(Rr[0].ticks.length === 3, 'reducer: 2 end caps + 1 transition tick');

// Tee: trunk with a perpendicular branch ending at the trunk wall
const T = buildDuctOutline([
  { id: 't', type: 'trunk', points: [0, 0, 100, 0], widthIn: 12 },
  { id: 'br', type: 'branch', points: [50, 0, 50, 60], widthIn: 6 }
], k10);
assert(T.length === 2, 'tee yields trunk run + branch run');
const trunk = T.find((r) => r.segIds.some((s) => s.startsWith('t')))!;
const branch = T.find((r) => r.segIds.includes('br'))!;
assert(trunk.walls.length === 3, `trunk has a gap on the branch side (3 wall pieces), got ${trunk.walls.length}`);
assert(hasPt(branch.outline, 47.5, 5) && hasPt(branch.outline, 52.5, 5), 'branch stops at trunk wall (y=5)');
assert(!hasPt(branch.outline, 47.5, 0), 'branch does not run to trunk centreline');

// Polygon closing
assert(isNearFirstPoint([0, 0, 50, 0], 0.05, 0.05, 0.8), 'close tolerance inside');
assert(!isNearFirstPoint([0, 0, 50, 0], 5, 5, 0.8), 'close tolerance outside');
assert(dropTrailingDuplicate([0, 0, 10, 0, 10, 10, 10, 10]).length === 6, 'drop trailing duplicate');
assert(dropTrailingDuplicate([0, 0, 10, 0, 10, 10, 0, 0]).length === 6, 'drop trailing == first');
assert(validateClosablePolygon([0, 0, 10, 0, 10, 10, 0, 10, 0, 10]).ok, 'square closes');
const bow = [0, 0, 10, 10, 10, 0, 0, 10];
assert(polygonSelfIntersects(bow), 'bow-tie intersects');
const vr = validateClosablePolygon(bow);
assert(!vr.ok && !!vr.message, 'self-intersecting polygon rejected with message');
assert(!validateClosablePolygon([0, 0, 10, 0]).ok, 'too few points rejected');

// Snapping
const ents = [
  { type: 'LINE', x: 0, y: 0, points: [100, 0], layer: 'A' },
  { type: 'LWPOLYLINE', points: [100, 0, 100, 100, 0, 100], layer: 'B' },
  { type: 'CIRCLE', x: 200, y: 200, radius: 10, layer: 'A' }
];
const idx = buildSnapIndex(ents, 20);
const s1 = findNearestSnap(idx, 97, 3, 10)!;
assert(s1 && s1.x === 100 && s1.y === 0, 'nearest vertex picked');
const s2 = findNearestSnap(idx, 52, 2, 5)!;
assert(s2 && s2.kind === 'mid' && s2.x === 50, 'midpoint snap');
assert(findNearestSnap(idx, 500, 500, 10) === null, 'nothing in range');
assert(findNearestSnap(idx, 97, 3, 10, (l) => l !== 'A' && l !== 'B') === null, 'layer filter respected');
const r1 = resolveSnap(97, 3, { enabled: true, gridStep: 10, index: idx, radius: 10 });
assert(r1.kind === 'object' && r1.x === 100, 'object snap beats grid');
const r2 = resolveSnap(33, 47, { enabled: true, gridStep: 10, index: idx, radius: 2 });
assert(r2.kind === 'grid' && r2.x === 30 && r2.y === 50, 'grid fallback');
assert(resolveSnap(33, 47, { enabled: false, gridStep: 10, index: idx, radius: 2 }).x === 33, 'snap off = raw');
assert(gridStepPx(10, 'imperial') === 10 && gridStepPx(20, 'metric') === 5, 'grid step 1 ft / 0.25 m');

// Misc
const hs = hatchSegments(20, 10, 4);
assert(hs.length > 3 && hs.every((s) => Math.abs(s[0]) <= 10 + 1e-9 && Math.abs(s[2]) <= 10 + 1e-9 && Math.abs(s[1]) <= 5 + 1e-9 && Math.abs(s[3]) <= 5 + 1e-9), 'hatch clipped to rectangle');
const g = groupByLayerColor(
  [{ type: 'LINE', layer: 'A', color: '#f00' }, { type: 'LINE', layer: 'A', color: '#0f0' }, { type: 'LINE', layer: 'A' }, { type: 'TEXT', layer: 'A' }],
  () => '#00f'
);
assert(g.get('A')!.size === 3 && g.get('A')!.get('#00f')!.length === 1, 'grouped by layer+colour, text excluded');
const ub = unionBounds([{ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { minX: -5, minY: 2, maxX: 3, maxY: 40 }, null])!;
assert(ub.minX === -5 && ub.maxY === 40, 'union bounds');
const fb = fitBounds({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, 1000, 500, 1);
assert(near(fb.scale, 1), 'fit scale');

console.log('canvasDrawingScale: all tests passed');
