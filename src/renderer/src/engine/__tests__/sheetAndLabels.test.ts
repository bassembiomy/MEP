import {
  layoutLabels, rectsOverlap, overlayObstacles, screenRectToLayout, measureLabel, ductTagCandidates,
  LabelRequest, Obstacle, Rect
} from '../../canvas/labelLayout';
import {
  crossoverBreak, crossoverElevations, findCrossoverPairs, crossoverSymbolPos, riseDropSymbol, formatElevation,
  pickStandardScale, buildScaleBar, planSheet, METRIC_SCALES, IMPERIAL_SCALES, exportPixelSize, pngSetDpi,
  loadStoredBool, saveStoredBool, polylineMidpoint, accessPanelPlacement, findBranchTakeoffs, isPlenumReturn, plenumBox,
  buildTitleBlock, ductBodIn, ceilingInches
} from '../../canvas/shopDrawing';
import { ductBodyRects, ductHalfWidthPx } from '../../canvas/drawingGeometry';

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }
const near = (a: number, b: number, e = 1e-6): boolean => Math.abs(a - b) <= e;

console.log('=== Sheet scale / crossover / label layout tests ===');

// ───────── overlay toolbars are obstacles ─────────
{
  const view = { x: 100, y: 50, scale: 2 };
  const r = screenRectToLayout({ x: 140, y: 70, w: 40, h: 20 }, view, 2);
  // world = (140-100)/2 = 20 ; layout = world * 2 = 40
  assert(near(r.x, 40) && near(r.y, 20) && near(r.w, 40) && near(r.h, 20), `screen->layout conversion ${JSON.stringify(r)}`);
  const ob = overlayObstacles([{ x: 140, y: 70, w: 40, h: 20 }], view, 1, 6);
  // layout scale 1: world = (140-100)/2 = 20, pad 6 screen px = 3 layout px
  assert(near(ob[0].x, 17) && near(ob[0].w, 26) && ob[0].tag === 'overlay', `overlay obstacle ${JSON.stringify(ob[0])}`);

  // a mandatory callout whose first candidate sits under the toolbar moves out from under it
  const toolbar: Obstacle[] = [{ x: 0, y: 0, w: 300, h: 40, tag: 'overlay' }];
  const lines = ['2-CASSETTE', '12,000 Btu/h EACH'];
  const size = measureLabel(lines, 10);
  const req: LabelRequest = {
    id: 'c', lines, fontPx: 10, priority: 90, mandatory: true, guaranteed: true, anchor: { x: 100, y: 100 },
    candidates: [{ x: 100, y: 20 }, { x: 100, y: 25 }, { x: 160, y: 20 }, { x: 100, y: 120 }]
  };
  const out = layoutLabels([req], toolbar).get('c')!;
  assert(out.visible && !rectsOverlap(out.rect, toolbar[0]), 'callout is clear of the overlay toolbar');
  assert(near(out.y, 120) && size.w > 0, 'first free candidate under no toolbar is used');

  // even when every listed candidate is covered, a guaranteed label finds free space (leader or smaller font)
  const blockAll: Obstacle[] = [{ x: 0, y: 0, w: 400, h: 140, tag: 'overlay' }];
  const out2 = layoutLabels([{ ...req, candidates: [{ x: 100, y: 20 }, { x: 100, y: 60 }] }], blockAll).get('c')!;
  assert(out2.visible && !rectsOverlap(out2.rect, blockAll[0]), 'guaranteed label escapes a fully covered candidate list');
  assert(out2.leader, 'moved-away label carries a leader line');
}

// ───────── terminal tags are never dropped at default zoom (40 x 25 scenario) ─────────
{
  const k = 10; // px per foot -> 400 x 250 px room at zoom 1
  const s = 1;
  const obstacles: Obstacle[] = [];
  const reqs: LabelRequest[] = [];
  const terms: Array<{ id: string; x: number; y: number }> = [];
  let n = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) terms.push({ id: `t${n++}`, x: (3 + c * 6.4) * k, y: (3 + r * 6) * k });
  }
  // trunk down the middle + branch to each terminal row
  const duct = [0, 12 * k, 40 * k, 12 * k];
  for (const rr of ductBodyRects([duct], [ductHalfWidthPx(14, k) * s])) obstacles.push({ x: rr.x, y: rr.y, w: rr.w, h: rr.h, tag: 'duct:trunk' });
  for (const t of terms) {
    const face = 2 * k;
    obstacles.push({ x: (t.x - face / 2) * s, y: (t.y - face / 2) * s, w: face * s, h: face * s });
    reqs.push({
      id: `t:${t.id}`, lines: [`CD-${t.id}`, '18x18 · 162 CFM'], fontPx: 10, priority: 30, guaranteed: true,
      anchor: { x: t.x * s, y: t.y * s }, anchorHalf: { w: face / 2, h: face / 2 }
    });
  }
  // overlay toolbar across the top-left
  obstacles.push({ x: 0, y: 0, w: 260, h: 34, tag: 'overlay' });
  const placed = layoutLabels(reqs, obstacles);
  let hidden = 0;
  placed.forEach((p) => { if (!p.visible) hidden++; });
  assert(hidden === 0, `no terminal tag dropped in the 40x25 scenario (hidden ${hidden})`);
  assert(placed.size === terms.length, 'one label per terminal');
  // determinism
  const again = layoutLabels(reqs, obstacles);
  placed.forEach((p, id) => assert(near(again.get(id)!.x, p.x) && near(again.get(id)!.y, p.y), 'layout is deterministic'));

  // dragging a terminal: re-running the layout with the NEW position still yields its tag next to the new position
  const moved = reqs.map((q) => (q.id === 't:t7' ? { ...q, anchor: { x: 30 * k, y: 4 * k } } : q));
  const after = layoutLabels(moved, obstacles).get('t:t7')!;
  assert(after.visible, 'dragged terminal tag survives the re-layout');
  assert(Math.hypot(after.x - 30 * k, after.y - 4 * k) < 25 * k, 'dragged tag stays near its new position');

  // a totally walled-in terminal still gets a tag (smaller font / far with leader), never dropped
  const wall: Obstacle[] = [{ x: 0, y: 0, w: 1000, h: 1000, tag: 'fill' }];
  const forced = layoutLabels([reqs[0]], wall).get(reqs[0].id)!;
  assert(forced.visible, 'guaranteed tag is placed even with no free space');
  const tight: Obstacle[] = [{ x: 40, y: 20, w: 120, h: 70 }];
  const small = layoutLabels([{
    id: 'a', lines: ['CD-1', '18x18 · 162 CFM'], fontPx: 10, priority: 1, guaranteed: true, anchor: { x: 100, y: 55 },
    candidates: [{ x: 100, y: 55 }]
  }], tight).get('a')!;
  assert(small.visible && !rectsOverlap(small.rect, tight[0], 0), 'fallback finds a clear spot');
}

// ───────── crossover break geometry ─────────
{
  const k = 10;
  const lower = { id: 'r1', type: 'return' as const, points: [0, 100, 200, 100], widthIn: 12, heightIn: 8, crossover: true, crossoverWith: ['s1'] };
  const upper = { id: 's1', type: 'trunk' as const, points: [100, 0, 100, 200], widthIn: 12, heightIn: 10, crossover: true, crossoverWith: ['r1'] };
  const pairs = findCrossoverPairs([lower, upper]);
  assert(pairs.length === 1, 'one pair from the two flagged ducts');
  assert(pairs[0].lowerId === 'r1' && pairs[0].upperId === 's1', 'return duct is the lower one');
  assert(pairs[0].intersects && near(pairs[0].point.x, 100) && near(pairs[0].point.y, 100), 'crossing point is the centre line intersection');
  const b = crossoverBreak(lower, upper, pairs[0].point, k);
  const hwU = ductHalfWidthPx(12, k);
  assert(b.gapHalf > hwU && b.gapHalf < hwU + 6, `gap clears the upper duct: ${b.gapHalf}`);
  assert(near(b.a.x, 100 - b.gapHalf) && near(b.b.x, 100 + b.gapHalf) && near(b.a.y, 100), 'gap lies along the lower duct');
  assert(b.eraser.length === 8 && b.breakLines.length === 2, 'eraser quad + two break lines');
  // break lines are across the lower duct (they span more than its width)
  const bl = b.breakLines[0];
  assert(Math.abs(bl[1] - bl[3]) > 2 * ductHalfWidthPx(12, k), 'break line crosses the whole lower duct width');
  assert(b.patch.halfLen >= b.gapHalf * 0 + ductHalfWidthPx(12, k), 'upper duct patch covers the gap');
  // skewed crossing needs a longer gap
  const skew = crossoverBreak(lower, { points: [60, 0, 140, 200], widthIn: 12 }, { x: 100, y: 100 }, k);
  assert(skew.gapHalf > b.gapHalf, 'skewed crossing opens a longer gap');
  // symbols sit on their own duct, off the crossing
  const sp = crossoverSymbolPos(upper, pairs[0].point, 25);
  assert(near(sp.x, 100) && near(Math.abs(sp.y - 100), 25), 'rise symbol is 25 px along the upper duct');
  const rd = riseDropSymbol({ x: 0, y: 0 }, 6, 'rise');
  assert(rd.triangle.length === 6 && rd.triangle[5] < 0, 'rise triangle points up (screen y negative)');
  assert(riseDropSymbol({ x: 0, y: 0 }, 6, 'drop').triangle[5] > 0, 'drop triangle points down');
  // unflagged ducts produce no pair
  assert(findCrossoverPairs([{ ...lower, crossover: false }, { ...upper, crossover: false }]).length === 0, 'no pair without flags');

  // elevations: upper BOD = lower top + 2"
  const e = crossoverElevations(12, 10, 10, 'imperial'); // 10 ft ceiling
  assert(e.absolute && near(e.upperBodIn, 120 - 6 - 12) && near(e.lowerBodIn, e.upperBodIn - 2 - 10), 'absolute BODs');
  assert(near(e.upperBodIn, e.lowerBodIn + 10 + 2), 'upper BOD = lower top + 2 in');
  assert(e.upperText === 'BOD +8\'-6"' && e.lowerText === 'BOD +7\'-6"', `imperial texts ${e.upperText} / ${e.lowerText}`);
  const em = crossoverElevations(11.811, 9.843, 3, 'metric');
  assert(/^BOD \d\.\d\d m$/.test(em.upperText), `metric text ${em.upperText}`);
  const er = crossoverElevations(12, 10, undefined, 'imperial');
  assert(!er.absolute && er.upperText === '↑ +12"', `relative text ${er.upperText}`);
  assert(formatElevation(34, 'imperial') === '+2\'-10"', 'elevation format +2\'-10"');
  assert(formatElevation(112.2, 'metric') === '2.85 m', `metric elevation ${formatElevation(112.2, 'metric')}`);
  assert(ceilingInches(0, 'imperial') === undefined && ceilingInches(undefined, 'metric') === undefined, 'no ceiling data -> relative');
  assert(near(ductBodIn(14, 108), 88), 'trunk BOD under a 9 ft ceiling');
}

// ───────── standard scale picker ─────────
{
  const ids = (l: typeof METRIC_SCALES): string[] => l.map((x) => x.id);
  assert(ids(METRIC_SCALES).join(',') === '1:20,1:25,1:50,1:75,1:100,1:125,1:150,1:200', 'metric standard scales');
  assert(IMPERIAL_SCALES.map((x) => x.label).join(' | ') === '1/4" = 1\'-0" | 3/16" = 1\'-0" | 1/8" = 1\'-0" | 3/32" = 1\'-0" | 1/16" = 1\'-0"', 'imperial standard scales');
  const ft = (m: number): number => m / 0.3048;
  // 10 m x 6 m on A1 -> still 1:20? usable 797 x ~497 mm -> 10 m at 1:20 = 500 mm fits
  let p = pickStandardScale({ w: ft(10), h: ft(6) }, 'metric');
  assert(p.scale.id === '1:20' && p.fits && p.sheet.id === 'A1', `small metric drawing -> ${p.scale.id}`);
  p = pickStandardScale({ w: ft(12.19), h: ft(7.62) }, 'metric'); // 40 x 25 ft
  assert(p.scale.id === '1:20', `40x25 ft room -> ${p.scale.id}`);
  p = pickStandardScale({ w: ft(30), h: ft(10) }, 'metric');
  assert(p.scale.id === '1:50', `30 m wide -> ${p.scale.id}`); // 1:25 = 1200 mm (no), 1:50 = 600 mm
  p = pickStandardScale({ w: ft(60), h: ft(35) }, 'metric');
  assert(p.scale.id === '1:100' && p.fits, `60 x 35 m -> ${p.scale.id}`);
  p = pickStandardScale({ w: ft(500), h: ft(300) }, 'metric');
  assert(p.scale.id === '1:200' && !p.fits, 'too big for the smallest scale -> 1:200, fits=false');
  // never a non-standard denominator
  for (let w = 5; w <= 150; w += 7) {
    const q = pickStandardScale({ w: ft(w), h: ft(w * 0.6) }, 'metric');
    assert(METRIC_SCALES.some((x) => x.id === q.scale.id), `standard scale for ${w} m`);
  }
  // imperial on ARCH D
  let q = pickStandardScale({ w: 40, h: 25 }, 'imperial');
  assert(q.scale.label === '1/4" = 1\'-0"' && q.sheet.id === 'ARCH D', `40x25 ft imperial -> ${q.scale.label}`);
  q = pickStandardScale({ w: 100, h: 60 }, 'imperial');
  assert(q.scale.label === '1/4" = 1\'-0"', `100x60 ft -> ${q.scale.label}`);
  q = pickStandardScale({ w: 150, h: 80 }, 'imperial');
  assert(q.scale.label === '3/16" = 1\'-0"', `150x80 ft -> ${q.scale.label}`); // 1/4": 952 mm > 865 ; 3/16": 714
  q = pickStandardScale({ w: 200, h: 120 }, 'imperial');
  assert(q.scale.label === '1/8" = 1\'-0"', `200x120 ft -> ${q.scale.label}`);
  q = pickStandardScale({ w: 300, h: 100 }, 'imperial');
  assert(q.scale.label === '3/32" = 1\'-0"', `300x100 ft -> ${q.scale.label}`);
  q = pickStandardScale({ w: 380, h: 150 }, 'imperial');
  assert(q.scale.label === '1/16" = 1\'-0"', `380x150 ft -> ${q.scale.label}`);
  q = pickStandardScale({ w: 900, h: 400 }, 'imperial');
  assert(q.scale.label === '1/16" = 1\'-0"' && !q.fits, 'imperial overflow -> 1/16, fits=false');

  // sheet plan: frame is the sheet at scale, extents inside the border, title block not over the drawing
  const k = 10; // px per ft
  const ext = { minX: 100, minY: 50, maxX: 100 + 40 * k, maxY: 50 + 25 * k };
  const plan = planSheet(ext, k, 'imperial');
  assert(plan.scale.label === '1/4" = 1\'-0"', 'plan scale');
  assert(near(plan.frame.w / plan.frame.h, 914.4 / 609.6, 1e-9), 'frame has ARCH D proportions');
  // 24 in sheet at 1/4" = 1' -> 96 ft wide, 36 in -> 144 ft ; frame width = 144 ft * 10 px
  assert(near(plan.frame.w, (36 * 4) * k, 1e-6), `frame width ${plan.frame.w}`);
  assert(plan.border.x > plan.frame.x && plan.border.x + plan.border.w < plan.frame.x + plan.frame.w, 'border inside frame');
  assert(ext.minX >= plan.border.x && ext.maxX <= plan.border.x + plan.border.w && ext.minY >= plan.border.y, 'extents inside the border');
  assert(ext.maxY <= plan.title.y && ext.maxY <= plan.legend.y, 'title block and legend are below the drawing');
  assert(!rectsOverlap(plan.title, plan.legend) && !rectsOverlap(plan.scaleBarBox, plan.legend), 'sheet blocks do not overlap');
  assert(plan.title.x + plan.title.w <= plan.border.x + plan.border.w && plan.title.y + plan.title.h <= plan.border.y + plan.border.h, 'title inside border');
  assert(buildTitleBlock({ pxPerFt: k, units: 'imperial', scaleText: plan.scale.label }).scaleText === '1/4" = 1\'-0"', 'title block shows the standard scale');
  assert(!/^1:\d+$/.test(plan.scale.label) || METRIC_SCALES.some((x) => x.label === plan.scale.label), 'no free-form 1:115');
  const mplan = planSheet({ minX: 0, minY: 0, maxX: 20 * 3.2808 * 20, maxY: 8 * 3.2808 * 20 }, 20 * 0.3048 * 3.2808, 'metric');
  assert(mplan.sheet.id === 'A1' && /^1:\d+$/.test(mplan.scale.label), `metric plan ${mplan.scale.label}`);

  // export size @ dpi
  const ex = exportPixelSize(plan.sheet, 150);
  assert(ex.w === Math.round((914.4 / 25.4) * 150) && ex.h === Math.round((609.6 / 25.4) * 150) && ex.dpi === 150, `150 dpi export ${ex.w}x${ex.h}`);
  const exa1 = exportPixelSize(mplan.sheet, 150);
  assert(exa1.w === 4967 && exa1.h === 3508, `A1 @150 dpi = ${exa1.w}x${exa1.h}`);
  assert(exportPixelSize(mplan.sheet, 2400).dpi < 2400, 'absurd dpi is reduced');
}

// ───────── scale bar ─────────
{
  const bar = (id: string): ReturnType<typeof buildScaleBar> => buildScaleBar(METRIC_SCALES.find((x) => x.id === id)!);
  let b = bar('1:100');
  assert(b.length === 5 && b.unit === 'm' && near(b.paperMm, 50), `1:100 bar ${b.length} m / ${b.paperMm} mm`);
  b = bar('1:50');
  assert(b.length === 2 && near(b.paperMm, 40) && b.labels[0] === '0' && b.labels[b.labels.length - 1] === '2 m', `1:50 bar ${b.length} / ${b.labels.join(',')}`);
  b = bar('1:200');
  assert(b.length === 10 && near(b.paperMm, 50), '1:200 bar = 10 m');
  b = bar('1:20');
  assert(b.length === 1 && near(b.paperMm, 50), '1:20 bar = 1 m');
  for (const sc of METRIC_SCALES) {
    const x = buildScaleBar(sc);
    assert(x.paperMm <= 70 + 1e-9 && x.segments >= 2 && x.labels.length === x.segments + 1, `bar fits for ${sc.id}`);
  }
  const imp = (i: number): ReturnType<typeof buildScaleBar> => buildScaleBar(IMPERIAL_SCALES[i]);
  b = imp(0);
  assert(b.length === 10 && b.unit === 'ft' && near(b.paperMm, 63.5), `1/4" bar ${b.length} ft / ${b.paperMm}`);
  b = imp(2);
  assert(b.length === 20 && near(b.paperMm, 63.5), `1/8" bar ${b.length}`);
  b = imp(4);
  assert(b.length === 25 && b.paperMm < 70, `1/16" bar ${b.length}`);
  assert(b.labels[b.labels.length - 1].endsWith(' ft'), 'bar end label carries the unit');
}

// ───────── accessories: VD sliding, service side, R bubble, plenum ─────────
{
  const k = 10;
  const trunk = { id: 't', type: 'trunk' as const, points: [0, 0, 200, 0], widthIn: 14 };
  const branch = { id: 'b', type: 'branch' as const, points: [100, 0, 100, 120], widthIn: 8 };
  const free = findBranchTakeoffs([trunk, branch], k)[0];
  const blocked = findBranchTakeoffs([trunk, branch], k, [{ x: 80, y: free.y - 5, w: 40, h: 10 }])[0];
  assert(Math.hypot(blocked.x - free.x, blocked.y - free.y) > 3, 'VD slides along the branch away from a colliding tag');
  assert(near(blocked.x, free.x), 'VD stays on the branch axis');
  const mid = polylineMidpoint([0, 0, 100, 0, 100, 100]);
  assert(near(mid.x, 100) && near(mid.y, 0), 'polyline midpoint by length');
  const fp = { w: 40, d: 20 };
  const unit = { x: 100, y: 100 };
  assert(accessPanelPlacement(unit, fp, k).side === 'right', 'service side defaults to right');
  const moved = accessPanelPlacement(unit, fp, k, { pts: [{ x: 135, y: 100 }] });
  assert(moved.side !== 'right', 'panel avoids the side where the refrigerant line arrives');
  const withBox = accessPanelPlacement(unit, fp, k, { boxes: [{ x: 120, y: 90, w: 40, h: 20 }] });
  assert(withBox.side !== 'right', 'panel avoids occupied boxes');
  assert(isPlenumReturn({ returnStrategy: 'plenum' }) && !isPlenumReturn({ returnStrategy: 'ducted' }) && !isPlenumReturn({}), 'plenum flag handles absent / ducted');
  const pb = plenumBox(unit, fp, k);
  assert(pb.x + pb.w <= unit.x - fp.w / 2 + 1e-9 && near(pb.h, fp.d), 'plenum box on the return side of the unit');
}

// ───────── persisted toggles ─────────
{
  const mem = new Map<string, string>();
  const store = { getItem: (key: string): string | null => mem.get(key) ?? null, setItem: (key: string, v: string): void => { mem.set(key, v); } };
  assert(loadStoredBool('sheet', true, store) === true, 'default when nothing stored');
  saveStoredBool('sheet', false, store);
  assert(loadStoredBool('sheet', true, store) === false, 'stored false is restored');
  saveStoredBool('detailed', true, store);
  assert(loadStoredBool('detailed', false, store) === true, 'stored true is restored');
  const bad = { getItem: (): string | null => { throw new Error('blocked'); }, setItem: (): void => { throw new Error('blocked'); } };
  assert(loadStoredBool('x', true, bad) === true, 'throwing storage falls back');
  saveStoredBool('x', false, bad); // must not throw
  assert(loadStoredBool('x', false, null) === false, 'no storage falls back');
}

// ───────── PNG dpi metadata ─────────
{
  // minimal valid PNG: signature + IHDR(1x1) + IDAT + IEND (CRC values irrelevant for this test)
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const ihdr = [0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 1, 2, 3, 4];
  const idat = [0, 0, 0, 0, 73, 68, 65, 84, 0, 0, 0, 0];
  const png = new Uint8Array([...sig, ...ihdr, ...idat]);
  const out = pngSetDpi(png, 150);
  assert(out.length === png.length + 21, 'pHYs chunk inserted');
  const name = String.fromCharCode(out[37], out[38], out[39], out[40]);
  assert(name === 'pHYs', `chunk name ${name}`);
  const ppm = (out[41] << 24) | (out[42] << 16) | (out[43] << 8) | out[44];
  assert(ppm === 5906, `150 dpi = 5906 px/m, got ${ppm}`);
  assert(pngSetDpi(new Uint8Array([1, 2, 3]), 150).length === 3, 'non-PNG data is left alone');
}

// ductTagCandidates still unaffected
assert(ductTagCandidates([[0, 0, 100, 0]], 5, { w: 30, h: 10 }).length > 0, 'duct tag candidates unchanged');
const _r: Rect = { x: 0, y: 0, w: 1, h: 1 };
assert(_r.w === 1, 'types');

console.log('Sheet scale / crossover / label layout tests passed');
