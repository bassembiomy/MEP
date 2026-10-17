import {
  polylineHitsRect, countBends, offsetPolyline, assignTerminalsToUnits, RouteRect
} from '../../canvas/drawingGeometry';
import { layoutLabels, measureLabel, rectsOverlap, LabelRequest, Obstacle, Rect, compassCandidates } from '../../canvas/labelLayout';
import {
  findBranchTakeoffs, damperSymbol, buildTitleBlock, printScaleText, printScaleDenominator, layoutSheet, legendItems,
  assignTerminalsByAssociation, buildUnitKeyMap, condensateRoute, calloutCandidates, shortClearanceReason,
  refrigerantLineSizes, routeRefrigerant, findFlexConnections, accessPanelRect, dxfTextRect, ShopDuct
} from '../../canvas/shopDrawing';

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }

console.log('=== Shop drawing tests ===');

// ───────── 1. label layout with obstacles (incl. callout, badge, X-OVER, CLR) never overlaps ─────────
{
  const room = [100, 100, 700, 100, 700, 420, 100, 420]; // screen px
  const obstacles: Obstacle[] = [
    { x: 380, y: 240, w: 60, h: 40 },            // unit
    { x: 120, y: 150, w: 460, h: 14 },           // duct
    { x: 560, y: 150, w: 14, h: 200 },           // duct
    { x: 200, y: 300, w: 40, h: 40 },            // terminal
    { x: 300, y: 330, w: 50, h: 12 }             // DXF text
  ];
  const reqs: LabelRequest[] = [];
  const calloutLines = ['2-CONCEALED SPLIT', '22,186 Btu/h EACH', '800 CFM EACH', '4-S.C.D 12x12', '2-R.C.D 20x20', 'FA 120 CFM'];
  const csize = measureLabel(calloutLines, 10);
  reqs.push({
    id: 'callout', lines: calloutLines, fontPx: 10, priority: 90, mandatory: true, anchor: { x: 380, y: 240 },
    candidates: calloutCandidates(csize, { x: 380, y: 240 }, room)
  });
  reqs.push({ id: 'badge', lines: ['! 1,200 CFM > 1,000 CFM'], fontPx: 9, priority: 80, mandatory: true, anchor: { x: 410, y: 260 }, anchorHalf: { w: 30, h: 20 } });
  reqs.push({ id: 'xover', lines: ['X-OVER'], fontPx: 9, priority: 80, mandatory: true, anchor: { x: 500, y: 157 }, anchorHalf: { w: 7, h: 7 } });
  reqs.push({ id: 'clr', lines: ['CLR'], fontPx: 9, priority: 80, mandatory: true, anchor: { x: 566, y: 250 }, anchorHalf: { w: 7, h: 7 } });
  ['t1', 't2', 't3'].forEach((id, i) => reqs.push({
    id, lines: ['CD-1', '12x12 . 120 CFM'], fontPx: 10, priority: 30,
    anchor: { x: 220 + i * 120, y: 320 - i * 40 }, anchorHalf: { w: 20, h: 20 }
  }));
  reqs.push({ id: 'zone', lines: ['LIVING', '800 CFM'], fontPx: 12, priority: 10, mandatory: true, anchor: { x: 250, y: 250 }, candidates: compassCandidates({ x: 250, y: 250 }, { w: 0, h: 0 }, measureLabel(['LIVING', '800 CFM'], 12), 8) });
  const placed = layoutLabels(reqs, obstacles);
  const rects: Array<{ id: string; r: Rect }> = [];
  placed.forEach((p, id) => { if (p.visible) rects.push({ id, r: p.rect }); });
  assert(placed.get('callout')!.visible, 'callout visible');
  assert(placed.get('badge')!.visible && placed.get('xover')!.visible && placed.get('clr')!.visible, 'warnings visible');
  for (const { id, r } of rects) {
    for (const o of obstacles) assert(!rectsOverlap(r, o), `${id} overlaps an obstacle`);
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) assert(!rectsOverlap(rects[i].r, rects[j].r), `${rects[i].id} overlaps ${rects[j].id}`);
  }
  // crowded room: callout goes outside the room
  const crowded: Obstacle[] = [];
  for (let x = 110; x < 690; x += 70) for (let y = 110; y < 410; y += 50) crowded.push({ x, y, w: 50, h: 30 });
  const cp = layoutLabels([reqs[0]], crowded).get('callout')!;
  const inside = cp.rect.x >= 100 && cp.rect.y >= 100 && cp.rect.x + cp.rect.w <= 700 && cp.rect.y + cp.rect.h <= 420;
  assert(cp.visible && !inside, 'callout moves outside the crowded room');
  for (const o of crowded) assert(!rectsOverlap(cp.rect, o), 'outside callout overlaps nothing');
  // tagged obstacles can be ignored by their own label only
  const tagged: Obstacle[] = [{ x: 90, y: 90, w: 40, h: 40, tag: 'mine' }];
  const own = layoutLabels([{ id: 'a', lines: ['x'], fontPx: 10, priority: 1, anchor: { x: 110, y: 110 }, candidates: [{ x: 110, y: 110 }], ignoreTags: ['mine'] }], tagged).get('a')!;
  const other = layoutLabels([{ id: 'a', lines: ['x'], fontPx: 10, priority: 1, anchor: { x: 110, y: 110 }, candidates: [{ x: 110, y: 110 }] }], tagged).get('a')!;
  assert(own.visible && !other.visible, 'ignoreTags honoured');
  // DXF text bbox
  const tr = dxfTextRect({ x: 10, y: 20, text: 'ABCD', height: 5 }, 2)!;
  assert(tr.w === 4 * 0.6 * 5 * 2 && tr.x === 20, 'dxf text rect');
  assert(dxfTextRect({ x: 0, y: 0, text: 'A', height: 1 }, 1) === null, 'tiny dxf text skipped');
}

// ───────── 2. refrigerant router: orthogonal, avoids obstacles (+0.5 ft), <= 3 bends ─────────
{
  const k = 10; // px per ft
  const obstacles: RouteRect[] = [
    { x: 40, y: -30, w: 20, h: 80 },   // wall of equipment between ODU and IDU
    { x: 100, y: 20, w: 30, h: 30 },
    { x: 0, y: 70, w: 200, h: 8 }
  ];
  const from = { x: 0, y: 0 }, to = { x: 200, y: 40 };
  const r = routeRefrigerant(from, to, obstacles, k);
  assert(r.ok, 'route found');
  assert(r.bends <= 3, `<= 3 bends (got ${r.bends})`);
  assert(r.points[0] === from.x && r.points[1] === from.y, 'starts at ODU');
  assert(r.points[r.points.length - 2] === to.x && r.points[r.points.length - 1] === to.y, 'ends at IDU');
  for (let i = 0; i + 3 < r.points.length; i += 2) {
    assert(r.points[i] === r.points[i + 2] || r.points[i + 1] === r.points[i + 3], 'segment orthogonal');
  }
  for (const o of obstacles) {
    const infl = { x: o.x - 0.5 * k, y: o.y - 0.5 * k, w: o.w + k, h: o.h + k };
    assert(!polylineHitsRect(r.points, infl), 'route stays 0.5 ft off obstacle');
  }
  assert(countBends(r.points) === r.bends, 'bend count');
  // straight when free
  const free = routeRefrigerant({ x: 0, y: 0 }, { x: 100, y: 0 }, [], k);
  assert(free.points.length === 4 && free.bends === 0, 'straight route when unobstructed');
  // deterministic
  const r2 = routeRefrigerant(from, to, obstacles, k);
  assert(JSON.stringify(r.points) === JSON.stringify(r2.points), 'deterministic');
  // obstacle containing an end point (own unit) is ignored
  const own = routeRefrigerant({ x: 0, y: 0 }, { x: 100, y: 0 }, [{ x: -10, y: -10, w: 20, h: 20 }, { x: 90, y: -10, w: 20, h: 20 }], k);
  assert(own.ok, 'routes out of / into own unit boxes');
  // parallel pair keeps equal spacing
  const a = offsetPolyline(r.points, 2), b = offsetPolyline(r.points, -2);
  assert(a.length === b.length && a.length === r.points.length, 'offset keeps vertex count');
  assert(Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1]) - 4) < 1e-9, 'offset pair separation');
  const sz = refrigerantLineSizes(24000, 'imperial');
  assert(sz.text === 'LL 3/8" / SL 5/8"', `line sizes: ${sz.text}`);
  assert(refrigerantLineSizes(24000, 'metric').text.startsWith('LL Ø9.5'), 'metric line sizes');
}

// ───────── 3. volume damper at every branch takeoff ─────────
{
  const k = 10;
  const ducts: ShopDuct[] = [
    { id: 'trunk1', type: 'trunk', points: [0, 0, 300, 0], widthIn: 14 },
    { id: 'b1', type: 'branch', points: [60, 0, 60, 80], widthIn: 8 },
    { id: 'b2', type: 'branch', points: [150, 90, 150, 0], widthIn: 8 },   // drawn toward the trunk
    { id: 'b3', type: 'branch', points: [240, 0, 300, 70], widthIn: 6 },
    { id: 'r1', type: 'return', points: [0, 200, 200, 200], widthIn: 12 }
  ];
  const tk = findBranchTakeoffs(ducts, k);
  assert(tk.length === 3, `one damper per branch takeoff (got ${tk.length})`);
  for (const t of tk) {
    const d = ducts.find((q) => q.id === t.ductId)!;
    assert(Math.abs(t.ty) < 1e-9, `${t.ductId} takeoff on trunk`);
    // damper lies on its branch, downstream of the trunk
    const l = Math.hypot(d.points[2] - d.points[0], d.points[3] - d.points[1]);
    const cross = Math.abs((t.x - d.points[0]) * (d.points[3] - d.points[1]) - (t.y - d.points[1]) * (d.points[2] - d.points[0])) / l;
    assert(cross < 1e-6, `${t.ductId} damper on branch`);
    assert(Math.hypot(t.x - t.tx, t.y - t.ty) > 0 && Math.hypot(t.x - t.tx, t.y - t.ty) < l, `${t.ductId} damper between takeoff and end`);
    const sym = damperSymbol(t);
    assert(sym.across.length === 4 && sym.blade.length === 4, 'damper symbol');
    // line across the duct: perpendicular to the branch axis
    const dot = (sym.across[2] - sym.across[0]) * t.ux + (sym.across[3] - sym.across[1]) * t.uy;
    assert(Math.abs(dot) < 1e-9, 'damper line is across the duct');
  }
  const b2 = tk.find((t) => t.ductId === 'b2')!;
  assert(b2.uy > 0 && b2.y > 0 && b2.y < 20 && Math.abs(b2.ty) < 1e-9, 'reversed branch: damper near the trunk end');
  assert(findBranchTakeoffs([], k).length === 0, 'no ducts, no dampers');

  // flexible connection at the unit; access panel; condensate drain to nearest wall
  const fp = { w: 40, d: 20 };
  const fx = findFlexConnections([{ x: -20, y: 0 }], fp, ducts, k);
  assert(fx.some((f) => f.network === 'supply' && f.ductId === 'trunk1'), 'flex on supply at the unit');
  const ap = accessPanelRect({ x: 0, y: 0 }, fp, k);
  assert(ap.x >= fp.w / 2 && ap.w === 2 * k, 'access panel beside unit');
  const room = [0, 0, 200, 0, 200, 120, 0, 120];
  const cd = condensateRoute({ x: 170, y: 60 }, room)!;
  assert(cd.wallPoint.x === 200 && cd.wallPoint.y === 60, 'drain to nearest wall');
  for (let i = 0; i + 3 < cd.points.length; i += 2) assert(cd.points[i] === cd.points[i + 2] || cd.points[i + 1] === cd.points[i + 3], 'drain orthogonal');
  const cd2 = condensateRoute({ x: 120, y: 30 }, room)!;
  assert(cd2.wallPoint.y === 0 && cd2.points.length >= 4, 'drain to top wall');
}

// ───────── 4. title block, scale text, legend, sheet placement ─────────
{
  assert(printScaleText(12) === '1:96', `scale at 12 px/ft: ${printScaleText(12)}`);
  assert(printScaleText(24) === '1:48', 'scale at 24 px/ft');
  assert(printScaleDenominator(10) === 115, 'scale at 10 px/ft rounds');
  assert(printScaleText(12, 150) === '1:150', 'scale with 150 dpi');
  const tb = buildTitleBlock({ projectName: 'Clinic A', location: 'Dubai', pxPerFt: 12, units: 'imperial', date: new Date(2026, 0, 5) });
  assert(tb.scaleText === '1:96', 'title block scale');
  assert(tb.rows.find((r) => r.label === 'SCALE')?.value === '1:96', 'scale row');
  assert(tb.dateText === '2026-01-05', 'date');
  assert(tb.sheetText === 'M-101 HVAC LAYOUT', 'sheet text');
  assert(tb.projectName === 'CLINIC A' && tb.location === 'DUBAI', 'project / location');
  assert(buildTitleBlock({ pxPerFt: 12, units: 'metric' }).unitsText.startsWith('METRIC'), 'metric units');
  const keys = legendItems().map((i) => i.key);
  for (const need of ['supply-diffuser', 'return-grille', 'vd', 'duct', 'refrigerant', 'condensate', 'odu', 'idu']) assert(keys.includes(need as never), `legend has ${need}`);
  const ext = { minX: 0, minY: 0, maxX: 1000, maxY: 600 };
  const sh = layoutSheet(ext);
  assert(Math.abs(sh.title.x + sh.title.w - ext.maxX) < 1e-9, 'title block right-aligned to extents');
  assert(sh.title.y >= ext.maxY, 'title block below the drawing');
  assert(!rectsOverlap(sh.title, sh.legend), 'legend and title block do not overlap');
}

// ───────── 5. unit association / capacity agree ─────────
{
  const units = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const terms = [
    { x: 90, y: 0, cfm: 300, unitId: 'z1' },       // physically near unit 2 but served by unit 1
    { x: 10, y: 0, cfm: 300, unitId: 'z1-u1' },
    { x: 20, y: 0, cfm: 100 }                      // free: nearest unit with spare capacity
  ];
  const a = assignTerminalsByAssociation(terms, units, { zoneId: 'z1', capacity: 700 });
  assert(a.groups[0].includes(0) && a.groups[1].includes(1), 'association wins over proximity');
  assert(a.loads[0] + a.loads[1] === 700, 'all airflow assigned');
  const km = buildUnitKeyMap(['svc-b', 'svc-a'], 2);
  assert(km.get('svc-a') === 0 && km.get('svc-b') === 1, 'foreign ids map in natural order');
  const none = assignTerminalsByAssociation([{ x: 1, y: 0, cfm: 100 }, { x: 99, y: 0, cfm: 100 }], units);
  const ref = assignTerminalsToUnits([{ x: 1, y: 0, cfm: 100 }, { x: 99, y: 0, cfm: 100 }], units);
  assert(JSON.stringify(none.groups) === JSON.stringify(ref.groups), 'falls back to capacity-aware assignment');
  const sv = assignTerminalsByAssociation([{ x: 1, y: 0, cfm: 900, serviceZoneId: 'a' }, { x: 99, y: 0, cfm: 100, serviceZoneId: 'b' }], units, { capacity: 500 });
  assert(sv.overloaded[0] && !sv.overloaded[1] && sv.anyOverloaded, 'over-capacity follows serviceZoneId association');
}

// ───────── 6. clearance text ─────────
{
  const t = shortClearanceReason('duct passes through terminal duct-supply-ab12');
  assert(!/ab12|duct-/.test(t) && t.startsWith('duct passes through terminal'), `ids stripped: ${t}`);
  assert(shortClearanceReason('duct edge closer than 0.5 ft to the wall') === 'duct edge closer than 0.5 ft to the wall', 'plain reason kept');
}

console.log('Shop drawing tests passed');
