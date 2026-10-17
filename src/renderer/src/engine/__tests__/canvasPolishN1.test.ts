import { readFileSync } from 'fs';
import { join } from 'path';
import { layoutLabels, routeLeader, polylineHitsRect, rectsOverlap, type Rect, type LabelRequest } from '../../canvas/labelLayout';
import { needsAccessPanel, zonesMissingDrainPoint, exportContentBounds, NO_DRAIN_TEXT } from '../../canvas/polishN1';
import { staggerLabels } from '../../canvas/polishM2';
import {
  pdfPagePlan, paperMmForFeet, printedMmPerFoot, planSheet, exportPixelSize, SHEET_A1, SHEET_ARCH_D, IMPERIAL_SCALES
} from '../../canvas/shopDrawing';
import { unitKindForSystem } from '../../canvas/drawingGeometry';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(m);
}
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

console.log('=== Running Canvas Polish N1 Test ===');

// 1. Leader routing avoids unit / terminal symbols (AHU callout: label up-left of a unit, target = unit corner)
{
  const unit: Rect = { x: 100, y: 100, w: 60, h: 40 };
  const target = { x: unit.x, y: unit.y }; // callout targets the unit's top-left corner
  // label to the right of the unit, vertically beside it: the straight line to the corner crosses the unit
  const label: Rect = { x: 220, y: 105, w: 80, h: 30 };
  const straightHits = polylineHitsRect([label.x + 40, label.y + 15, target.x, target.y], unit, 0.75);
  assert(straightHits, 'precondition: the straight leader would cross the unit');
  const r = routeLeader(label, target, [unit], []);
  assert(r.symbolHits === 0, `routed leader crosses no symbol, hits=${r.symbolHits}`);
  assert(!polylineHitsRect(r.points, unit, 0.75), 'polyline does not enter the unit box');
  assert(r.points.length >= 6, 'it used an orthogonal elbow');
  for (let i = 0; i + 3 < r.points.length; i += 2) {
    assert(near(r.points[i], r.points[i + 2]) || near(r.points[i + 1], r.points[i + 3]), 'every leg is horizontal or vertical');
  }
  assert(near(r.points[r.points.length - 2], target.x) && near(r.points[r.points.length - 1], target.y), 'ends on the target');
  // free case: straight line is kept
  const free = routeLeader({ x: 20, y: 20, w: 40, h: 20 }, target, [unit], []);
  assert(free.points.length === 4 && free.symbolHits === 0, 'unobstructed leader stays straight');
  // a terminal in the way as well: still no symbol hit, fewest labels
  const term: Rect = { x: 235, y: 100, w: 14, h: 14 };
  const tag: Rect = { x: 150, y: 138, w: 70, h: 12 };
  const r2 = routeLeader({ x: 260, y: 150, w: 80, h: 30 }, target, [unit, term], [tag]);
  assert(r2.symbolHits === 0, 'avoids unit and terminal');
  const hitsTag = polylineHitsRect(r2.points, tag, 0);
  const alt = [routeLeader({ x: 260, y: 150, w: 80, h: 30 }, target, [unit, term], [])].every((x) => x.symbolHits === 0);
  assert(alt && (!hitsTag || r2.labelHits <= 1), 'label crossings are minimised');
}

// 2. Small P / R bubbles keep a minimum gap
{
  const cand = [{ x: 100, y: 100, angleDeg: 0 }, { x: 114, y: 100, angleDeg: 0 }, { x: 125, y: 100, angleDeg: 0 }];
  const mk = (id: string, spacing?: number): LabelRequest => ({
    id, lines: ['R'], fontPx: 8, priority: 50, anchor: { x: 100, y: 100 }, candidates: cand, mandatory: true, spacing
  });
  const plain = layoutLabels([mk('a'), mk('b')], []);
  const gapOf = (m: Map<string, { rect: Rect }>): number => {
    const a = m.get('a')!.rect, b = m.get('b')!.rect;
    return Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
  };
  const spaced = layoutLabels([mk('a', 5), mk('b', 5)], []);
  assert(gapOf(spaced) >= 5 - 1e-9, `spaced bubbles have >= 5px gap, got ${gapOf(spaced)}`);
  assert(gapOf(plain) < 5, 'without spacing the same candidates sit closer (control)');
  assert(!rectsOverlap(spaced.get('a')!.rect, spaced.get('b')!.rect, 4.9), 'no touching');
}

// 3. Access panels only for ceiling-concealed equipment
{
  assert(!needsAccessPanel(unitKindForSystem('high-wall')), 'high-wall: no AP');
  assert(!needsAccessPanel(unitKindForSystem('cassette')), 'cassette: no AP');
  assert(!needsAccessPanel(unitKindForSystem('packaged')), 'packaged roof unit: no AP');
  assert(needsAccessPanel(unitKindForSystem('ducted')), 'ducted/concealed: AP');
  assert(needsAccessPanel(unitKindForSystem('fcu')), 'FCU (default ducted kind): AP');
  assert(needsAccessPanel(unitKindForSystem('ahu')), 'AHU: AP');
}

// 4. Missing drain point warning
{
  const z = zonesMissingDrainPoint([
    { id: 'a', name: 'Office', drains: [{ toDrain: false }, { toDrain: false }] },
    { id: 'b', name: 'Lab', drains: [{ toDrain: true }, { toDrain: false }] },
    { id: 'c', name: 'Store', drains: [] },
    { id: 'd', drains: [{ toDrain: false }] }
  ]);
  assert(z.length === 2 && z[0].name === 'Office' && z[1].id === 'd' && z[1].name === 'd', 'only zones with condensate lines and no drain-point line');
  assert(NO_DRAIN_TEXT === 'No drain point – condensate routed to exterior wall', 'notice text');
}

// 5. Export bounds include label boxes
{
  const content = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  const scaleFor = (b: { minX: number; minY: number; maxX: number; maxY: number }): number =>
    Math.min(1000 / (b.maxX - b.minX), 700 / (b.maxY - b.minY)) * 0.94;
  const labels = [{ ax: 400, ay: 150, dx: 140, dy: 0, w: 120, h: 30 }, { ax: 0, ay: 300, dx: -30, dy: 60, w: 80, h: 24 }];
  const b = exportContentBounds(content, labels, scaleFor);
  const sc = scaleFor(b);
  assert(b.maxX >= 400 + (140 + 60) / sc * 0.98, 'right label inside the export');
  assert(b.minX <= (-30 - 40) / sc * 0.98 && b.maxY >= 300 + (60 + 12) / sc * 0.98, 'bottom-left label inside the export');
  const same = exportContentBounds(content, [], scaleFor);
  assert(same.maxX === 400 && same.minY === 0, 'no labels: content bounds');
}

// 6. PDF page / scale math
{
  const imp = pdfPagePlan(SHEET_ARCH_D, 150);
  assert(near(imp.pageIn[0], 36) && near(imp.pageIn[1], 24), 'ARCH D page is 36 x 24 in');
  assert(imp.orientation === 'landscape', 'landscape');
  assert(near(imp.image.w, 914.4) && near(imp.image.h, 609.6) && imp.image.x === 0 && imp.image.y === 0, 'raster fills the page');
  const met = pdfPagePlan(SHEET_A1, 150);
  assert(met.pageMm[0] === 841 && met.pageMm[1] === 594, 'A1 page is 841 x 594 mm');
  assert(met.imagePx.w === exportPixelSize(SHEET_A1, 150).w, 'pixels match the PNG export');
  // pixel aspect equals the page aspect (no distortion)
  assert(near(imp.imagePx.w / imp.imagePx.h, imp.pageMm[0] / imp.pageMm[1], 2e-3), 'no aspect distortion');
  // 1 ft at 1/8" = 1'-0" is 0.125 in on paper
  const eighth = IMPERIAL_SCALES.find((s) => s.id.startsWith('1/8'))!;
  assert(near(paperMmForFeet(1, eighth) / 25.4, 0.125), '1 ft at 1/8" scale = 0.125 in');
  // printed foot on a real sheet plan equals the scale (any picked scale)
  const k = 10;
  const sp = planSheet({ minX: 0, minY: 0, maxX: 60 * k, maxY: 40 * k }, k, 'imperial');
  const plan = pdfPagePlan(sp.sheet, 150);
  const printedIn = printedMmPerFoot(plan, sp.frame.w, k) / 25.4;
  assert(near(printedIn, sp.scale.ratio * 12, 1e-6), `printed 1 ft = ${printedIn} in, scale ${sp.scale.id}`);
  // the raster at its dpi occupies the same inches: 1 px = 1/dpi in
  const pxPerFtInImage = (k * plan.imagePx.w) / sp.frame.w;
  assert(near(pxPerFtInImage / plan.imagePx.dpi, printedIn, 5e-3), 'raster px / dpi agrees with the placed size');
}

// 7. Section stagger: more spacing, and labels alternate above / below
{
  const items = [0, 1, 2, 3].map((i) => ({ id: String(i), x: 100 + i * 8, y: 50, w: 40, yBelow: 90 }));
  const out = staggerLabels(items, 13, 4);
  const sides = new Set(out.map((o) => o.side));
  assert(sides.has('above') && sides.has('below'), 'leaders alternate above and below');
  for (const a of out) for (const b of out) {
    if (a.id >= b.id) continue;
    assert(!(Math.abs(a.x - b.x) < 40 + 4 && Math.abs(a.y - b.y) < 13), `labels ${a.id}/${b.id} keep line spacing`);
  }
  assert(out.every((o) => o.level === 0 || o.leader), 'moved labels carry a leader');
}

// 8. Wiring (source checks)
{
  const root = join(__dirname, '..', '..');
  const canvas = readFileSync(join(root, 'canvas', 'FloorPlanCanvas.tsx'), 'utf8');
  assert(canvas.includes('routeLeader(') && canvas.includes('Export PDF') && canvas.includes("import('jspdf')"), 'canvas wires leader routing + PDF export');
  assert(/id, lines, fontPx, priority: LABEL_PRIORITY\.condensate[\s\S]{0,200}guaranteed: true/.test(canvas), 'CDP labels are guaranteed');
  assert(canvas.includes('spacing: 5'), 'P / R bubbles carry spacing');
  assert(canvas.includes('needsAccessPanel('), 'AP rule used');
}

console.log('Canvas Polish N1 OK');
