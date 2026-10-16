import { normalizeCadToCanvas, CadEntity } from '../dxfParser';
import { pxPerFt } from '../units';
import {
  feetPerUnitFromCalibration, feetPerDrawingUnit, rescaleProjectGeometry, formatFeetInches, formatMetres, formatLength,
  uprightAngle, segmentTagPlacement, ductSizeText, diffuserTagText, roomDimensionLines, dimTick, groupByLayerColor
} from '../../canvas/drawingGeometry';

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }
const near = (a: number, b: number, e = 1e-6): boolean => Math.abs(a - b) <= e;

console.log('=== CAD calibration / rescale / dimension tests ===');

// ── calibration math ──
const ents: CadEntity[] = [
  { type: 'LINE', x: 0, y: 0, points: [5000, 0] }, // 5000 units long, unitless drawing
  { type: 'LINE', x: 0, y: 0, points: [0, 3000] }
];
const n0 = normalizeCadToCanvas(ents, { projectScale: 10, projectUnits: 'imperial' });
assert(n0.needsCalibration, 'INSUNITS unset needs calibration');
// user picks the ends of the 5000-unit line; it is really 16.4042 ft (5 m)
const pxDist = Math.hypot(n0.entities[0].points![0] - n0.entities[0].x!, 0);
const f = feetPerUnitFromCalibration(pxDist, n0.pxPerUnit, 16.404199, 'imperial')!;
assert(near(f, 16.404199 / 5000, 1e-9), 'feetPerUnit = realFt / drawingDist');
const fm = feetPerUnitFromCalibration(pxDist, n0.pxPerUnit, 5, 'metric')!;
assert(near(fm, 5 * 3.28084 / 5000, 1e-9), 'metric real distance converted to ft');
const n1 = normalizeCadToCanvas(ents, { projectScale: 10, projectUnits: 'imperial', overrideFeetPerUnit: f });
assert(!n1.needsCalibration, 'override clears needsCalibration');
const len1 = n1.entities[0].points![0] - n1.entities[0].x!;
assert(near(len1 / pxPerFt(10, 'imperial'), 16.404199, 1e-4), 'calibrated line is 16.404 ft on canvas');
assert(feetPerUnitFromCalibration(0, 1, 5, 'imperial') === null, 'zero pixel distance rejected');
assert(feetPerUnitFromCalibration(10, 1, 0, 'imperial') === null, 'zero real distance rejected');
assert(near(feetPerDrawingUnit('mm'), 1 / 304.8) && feetPerDrawingUnit('ft') === 1 && near(feetPerDrawingUnit('in'), 1 / 12), 'drawing unit table');
assert(near(feetPerDrawingUnit('m'), 3.28084) && near(feetPerDrawingUnit('cm'), 1 / 30.48), 'drawing unit table 2');

// ── re-normalise on project scale change stays proportional ──
const nA = normalizeCadToCanvas(ents, { insunits: 4, projectScale: 10, projectUnits: 'imperial' });
const nB = normalizeCadToCanvas(ents, { insunits: 4, projectScale: 20, projectUnits: 'imperial' });
assert(near(nB.bbox.maxX / nA.bbox.maxX, 2, 1e-9), 'CAD bbox doubles with scale');

// ── rescaleProjectGeometry ──
const zone = {
  id: 'z', points: [0, 0, 100, 0, 100, 50, 0, 50],
  diffusers: [{ id: 'd', x: 50, y: 25, cfm: 100, size: '24x24' }],
  ducts: [{ id: 'k', points: [10, 10, 90, 10], widthIn: 12, heightIn: 8 }],
  unitPos: { x: 5, y: 6 }, unitPositions: [{ x: 5, y: 6 }, { x: 7, y: 8 }],
  outdoorUnitPos: { x: -10, y: 4 }, outdoorUnitPositions: [{ x: -10, y: 4 }]
};
const r = rescaleProjectGeometry([zone], 2)[0];
assert(r.points.join() === '0,0,200,0,200,100,0,100', 'polygon scaled');
assert(r.diffusers[0].x === 100 && r.diffusers[0].y === 50 && r.diffusers[0].cfm === 100, 'terminal scaled, props kept');
assert(r.ducts[0].points.join() === '20,20,180,20' && r.ducts[0].widthIn === 12, 'duct centreline scaled, inches untouched');
assert(r.unitPos!.x === 10 && r.unitPositions![1].y === 16 && r.outdoorUnitPos!.x === -20 && r.outdoorUnitPositions![0].y === 8, 'unit positions scaled');
assert(zone.points[1] === 0 && zone.points[2] === 100, 'input not mutated');
assert(rescaleProjectGeometry([zone], 1)[0] === zone, 'factor 1 is identity');
const back = rescaleProjectGeometry(rescaleProjectGeometry([zone], 3), 1 / 3)[0];
assert(near(back.points[2], 100) && near(back.diffusers[0].y, 25), 'round trip');
// metric <-> imperial registration: factor = newPxPerFt/oldPxPerFt
const factor = pxPerFt(40, 'imperial') / pxPerFt(10, 'imperial');
assert(near(factor, 4), 'factor from pxPerFt');

// ── formatting ──
assert(formatFeetInches(12.5) === "12'-6\"", `12.5 ft -> ${formatFeetInches(12.5)}`);
assert(formatFeetInches(10) === "10'-0\"", '10 ft');
assert(formatFeetInches(9.999) === "10'-0\"", 'carry 12 in');
assert(formatFeetInches(0.25) === "0'-3\"", '3 in');
assert(formatMetres(3.80 / 0.3048) === '3.80 m', 'metric 3.80 m');
assert(formatLength(12.5, 'imperial') === "12'-6\"" && formatLength(10, 'metric') === '3.05 m', 'formatLength dispatch');

// ── upright angle normalisation ──
assert(uprightAngle(0) === 0 && uprightAngle(45) === 45 && uprightAngle(90) === 90, 'upright keeps (-90,90]');
assert(uprightAngle(180) === 0, '180 -> 0');
assert(uprightAngle(135) === -45, '135 -> -45');
assert(uprightAngle(-135) === 45, '-135 -> 45');
assert(uprightAngle(-90) === 90, '-90 -> 90');
assert(uprightAngle(270) === 90 && uprightAngle(-180) === 0 && uprightAngle(360) === 0, 'wraps');
for (let a = -720; a <= 720; a += 7) {
  const u = uprightAngle(a);
  assert(u > -90 && u <= 90, `angle ${a} -> ${u} in (-90,90]`);
}

// ── tag placement ──
const east = segmentTagPlacement(0, 0, 100, 0, 6);
assert(near(east.x, 50) && near(east.y, -6) && east.angleDeg === 0, 'horizontal segment: tag above');
const west = segmentTagPlacement(100, 0, 0, 0, 6);
assert(near(west.x, 50) && near(west.y, -6) && west.angleDeg === 0, 'reversed segment: same upright tag, same side');
const south = segmentTagPlacement(0, 0, 0, 100, 6);
assert(south.angleDeg === 90 && near(south.x, 6) && near(south.y, 50), 'vertical down: rotated 90, offset to +x');
const north = segmentTagPlacement(0, 100, 0, 0, 6);
assert(north.angleDeg === 90 && near(north.x, 6), 'vertical up: same');
const diag = segmentTagPlacement(0, 0, -50, -50, 0);
assert(near(diag.angleDeg, 45), 'diagonal pointing up-left normalised to 45');

// ── tag texts ──
assert(ductSizeText({ points: [], widthIn: 14, heightIn: 10 }, 'imperial') === '14"x10"', 'duct imperial');
assert(ductSizeText({ points: [], widthIn: 14, heightIn: 10 }, 'metric') === '350x250', 'duct metric mm');
assert(ductSizeText({ points: [], widthIn: 12, heightIn: 12, shape: 'round', diameterIn: 12 }, 'imperial') === 'Ø12"', 'round duct');
assert(diffuserTagText({ size: '24x24', cfm: 250 }, 'imperial') === 'SD-24"X24"-250 CFM', 'diffuser tag');
assert(diffuserTagText({ size: '24x12', cfm: 250, type: 'return' }, 'imperial') === 'RG-24"X12"-250 CFM', 'return tag');
assert(diffuserTagText({ size: '600x600', cfm: 212 }, 'metric') === 'SD-600X600-100 L/s', 'metric tag');

// ── room dimension lines ──
const dl = roomDimensionLines({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 20, 5, 3);
assert(dl.length === 2, 'two dimension lines');
assert(dl[0].lengthPx === 100 && dl[0].y1 === 70 && dl[0].textY === 65 && dl[0].angleDeg === 0, 'width line below the room');
assert(dl[1].lengthPx === 50 && dl[1].x1 === 120 && dl[1].angleDeg === -90, 'height line right of the room');
assert(roomDimensionLines({ minX: 0, minY: 0, maxX: 0, maxY: 5 }, 1, 1).length === 0, 'degenerate bbox -> none');
const tk = dimTick(10, 10, Math.SQRT2);
assert(near(tk[0], 9) && near(tk[1], 11) && near(tk[2], 11) && near(tk[3], 9), '45 degree tick');

// ── layer colour override wins ──
const g = groupByLayerColor([{ type: 'LINE', layer: 'A', color: '#111111' }], () => '#222222', undefined, () => '#abcdef');
assert(g.get('A')!.has('#abcdef'), 'override colour wins over entity colour');

console.log('PASS: cadCalibration');
