import {
  plantConnectionOf, hasRefrigerantPlant, systemCalloutLines, freshAirLine, LABEL_PRIORITY, labelLodFor, medianNeighbourGap,
  chwRoute, condensatePlan, nearestDrain, isOrthogonalPath, loadDrainPoints, saveDrainPoints, toggleDrainPoint, isPlenumReturnZone,
  DrainPoint, KvStorage
} from '../../canvas/polishL2';
import { layoutLabels, measureLabel, rectsOverlap, LabelRequest, Obstacle, Rect } from '../../canvas/labelLayout';
import { calloutCandidates, gridCandidatesInPolygon, accessPanelPlacement, isPlenumReturn } from '../../canvas/shopDrawing';

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion failed: ${m}`); }

console.log('=== Canvas polish L2 tests ===');

// ───────── 1. system-type callout labels ─────────
{
  assert(systemCalloutLines('vrf', 4, 'RXYQ10')[0] === '4-VRF INDOOR UNITS', 'VRF headline');
  assert(systemCalloutLines('vrf', 4, 'RXYQ10')[1] === 'ODU RXYQ10', 'VRF ODU model line');
  assert(systemCalloutLines('vrf', 2).length === 1, 'VRF without model: no invented ODU line');
  const expect: Record<string, string> = {
    concealed: 'CONCEALED SPLIT', cassette: 'CASSETTE SPLIT', 'high-wall': 'HIGH WALL SPLIT', ahu: 'CENTRAL AHU',
    fcu: 'DUCTED FCU', rtu: 'ROOFTOP UNIT (RTU)', packaged: 'PACKAGE UNIT'
  };
  for (const [t, label] of Object.entries(expect)) assert(systemCalloutLines(t, 3)[0] === `3-${label}`, `label for ${t}`);
  for (const t of ['vrf', 'ahu', 'fcu', 'rtu', 'cassette', 'high-wall', 'packaged']) {
    assert(!systemCalloutLines(t, 1)[0].includes('CONCEALED'), `${t} never falls back to CONCEALED SPLIT`);
  }
  assert(freshAirLine(undefined, (c) => `${c}`) === null, 'no outdoorAirCfm: FA line hidden');
  assert(freshAirLine(Number.NaN, (c) => `${c}`) === null, 'NaN FA hidden');
  assert(freshAirLine(1234.4, (c) => `${c} CFM`) === 'FA 1234 CFM', 'FA from zone.outdoorAirCfm');
}

// ───────── 2. plant connection (explicit + fallback) ─────────
{
  assert(plantConnectionOf({ systemType: 'ahu' }) === 'chilled-water', 'ahu -> chilled-water');
  assert(plantConnectionOf({ systemType: 'chiller' }) === 'chilled-water', 'chiller -> chilled-water');
  assert(plantConnectionOf({ systemType: 'fcu-chw' }) === 'chilled-water', 'fcu-chw -> chilled-water');
  assert(plantConnectionOf({ systemType: 'rtu' }) === 'self-contained', 'rtu -> self-contained');
  assert(plantConnectionOf({ systemType: 'package' }) === 'self-contained', 'package -> self-contained');
  assert(plantConnectionOf({ systemType: 'packaged' }) === 'self-contained', 'packaged -> self-contained');
  assert(plantConnectionOf({ systemType: 'vrf' }) === 'refrigerant' && plantConnectionOf({ systemType: 'concealed' }) === 'refrigerant', 'splits -> refrigerant');
  assert(plantConnectionOf({}) === 'refrigerant', 'absent -> refrigerant');
  assert(plantConnectionOf({ systemType: 'ahu', plantConnection: 'refrigerant' }) === 'refrigerant', 'explicit field wins');
  assert(plantConnectionOf({ systemType: 'concealed', plantConnection: 'bogus' }) === 'refrigerant', 'invalid explicit ignored');
  assert(!hasRefrigerantPlant({ systemType: 'ahu' }), 'AHU has no ODU / refrigerant');
  assert(hasRefrigerantPlant({ systemType: 'vrf' }), 'VRF keeps ODU');
  assert(isPlenumReturnZone({ returnStrategy: 'plenum' }) && isPlenumReturn({ returnStrategy: 'plenum' }), 'plenum by strategy');
  const byTerm = { diffusers: [{ type: 'return', returnPath: 'plenum' }] };
  assert(isPlenumReturnZone(byTerm) && isPlenumReturn(byTerm), 'plenum by return terminal returnPath');
  assert(!isPlenumReturnZone({ diffusers: [{ type: 'return' }] }), 'ducted return is not plenum');
}

// ───────── 3. chilled-water stubs ─────────
{
  const room = [0, 0, 480, 0, 480, 300, 0, 300];
  const fp = { w: 36, d: 24 };
  const unit = { x: 200, y: 150 };
  const withStub = chwRoute(unit, fp, 12, room, 0, { x: 440, y: 40 })!;
  assert(withStub.fromStub && isOrthogonalPath(withStub.points), 'CHW route to the stub is orthogonal');
  const n = withStub.points.length;
  assert(withStub.points[n - 2] === 440 && withStub.points[n - 1] === 40, 'CHW route ends at the stub');
  assert(withStub.valves.length >= 1, 'CHW valves present');
  const wall = chwRoute(unit, fp, 12, room, 0)!;
  assert(!wall.fromStub && isOrthogonalPath(wall.points), 'fallback: orthogonal to the nearest wall');
  const e = [wall.points[wall.points.length - 2], wall.points[wall.points.length - 1]];
  assert(Math.min(e[0], 480 - e[0], e[1], 300 - e[1]) < 1e-6, 'fallback ends on a wall');
}

// ───────── 4. label layout: zone label + callout + duct badges never overlap (40x25 and L rooms) ─────────
function layoutScenario(poly: number[], unit: { x: number; y: number }, label: string): void {
  const obstacles: Obstacle[] = [
    { x: unit.x - 20, y: unit.y - 12, w: 40, h: 24 }, // unit
    { x: unit.x - 25, y: unit.y + 14, w: 50, h: 13 }  // unit tag
  ];
  const reqs: LabelRequest[] = [];
  const zl = ['Open Office', '1,200 CFM (concealed)'];
  const zs = measureLabel(zl, 12);
  const cl = ['4-CONCEALED SPLIT', '22,186 Btu/h EACH', '800 CFM EACH', '4-S.C.D 12"x10"', '2-R.C.D 20x20'];
  const cs = measureLabel(cl, 10);
  const anchor = { x: unit.x - 20, y: unit.y - 12 };
  const zoneAnchor = { x: (poly[0] + poly[2]) / 2 + 60, y: (poly[1] + poly[5]) / 2 };
  reqs.push({
    id: 'zone', lines: zl, fontPx: 12, priority: LABEL_PRIORITY.zone, mandatory: true, anchor: zoneAnchor,
    candidates: [{ x: zoneAnchor.x, y: zoneAnchor.y }, ...gridCandidatesInPolygon(poly, zs, zoneAnchor, 40)]
  });
  reqs.push({ id: 'callout', lines: cl, fontPx: 10, priority: LABEL_PRIORITY.callout, mandatory: true, guaranteed: true, anchor, candidates: calloutCandidates(cs, anchor, poly) });
  // duct badge sits right where the callout would like to go
  reqs.push({
    id: 'badge', lines: ['12"x10"'], fontPx: 9, priority: LABEL_PRIORITY.ductBadge, anchor: { x: unit.x - 60, y: unit.y - 50 },
    candidates: [{ x: unit.x - 60, y: unit.y - 50 }, { x: unit.x + 60, y: unit.y + 50 }]
  });
  const placed = layoutLabels(reqs, obstacles);
  const rects: Array<{ id: string; r: Rect }> = [];
  placed.forEach((p, id) => { if (p.visible) rects.push({ id, r: p.rect }); });
  assert(placed.get('zone')!.visible && placed.get('callout')!.visible, `${label}: zone label and callout visible`);
  for (let i = 0; i < rects.length; i++) {
    for (const o of obstacles) assert(!rectsOverlap(rects[i].r, o), `${label}: ${rects[i].id} overlaps an obstacle`);
    for (let j = i + 1; j < rects.length; j++) assert(!rectsOverlap(rects[i].r, rects[j].r), `${label}: ${rects[i].id} overlaps ${rects[j].id}`);
  }
  // the zone label is placed before the callout: callout must not sit on it
  assert(!rectsOverlap(placed.get('callout')!.rect, placed.get('zone')!.rect), `${label}: callout clear of zone label`);
}
layoutScenario([0, 0, 480, 0, 480, 300, 0, 300], { x: 240, y: 150 }, '40x25');
layoutScenario([0, 0, 480, 0, 480, 140, 220, 140, 220, 300, 0, 300], { x: 110, y: 200 }, 'L-shape');

// bold capitals are measured wide enough ("PLENUM RETUR" truncation)
{
  const w = measureLabel(['PLENUM RETURN'], 9).w;
  assert(w >= 13 * 0.68 * 9, 'PLENUM RETURN box fits the bold text');
  assert(Math.abs(measureLabel(['abcdefghij'], 10).w - (10 * 0.6 * 10 + 6)) < 1e-9, 'lower case still 0.6 em');
}

// ───────── 5. level of detail ─────────
{
  const grid: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) grid.push({ x: i * 80, y: j * 80 });
  const gap = medianNeighbourGap(grid);
  assert(Math.abs(gap - 80) < 1e-9, 'median neighbour gap');
  assert(medianNeighbourGap([{ x: 0, y: 0 }]) === Infinity, 'single terminal: no gap');
  const base = { medianGapWorld: gap, zoneMaxDimWorld: 480 };
  assert(labelLodFor({ ...base, scale: 0.2 }) === 'overview', 'fit-all zoom: equipment tags + zone label only');
  assert(labelLodFor({ ...base, scale: 1.5 }) === 'detail', 'zoomed in: terminal tags return');
  assert(labelLodFor({ ...base, scale: 0.5, selected: true }) === 'detail', 'selected zone uses the laxer threshold');
  assert(labelLodFor({ medianGapWorld: Infinity, zoneMaxDimWorld: 20, scale: 1 }) === 'overview', 'tiny zone on screen');
  assert(labelLodFor({ medianGapWorld: Infinity, zoneMaxDimWorld: 480, scale: 1 }) === 'detail', 'zone with one terminal at normal zoom');
  // monotonic in zoom
  let seenDetail = false;
  for (let sc = 0.05; sc < 6; sc *= 1.2) {
    const l = labelLodFor({ ...base, scale: sc });
    if (l === 'detail') seenDetail = true;
    else assert(!seenDetail, 'LOD is monotonic: once detailed, stays detailed when zooming in');
  }
}

// ───────── 6. condensate to a drain point ─────────
{
  const room = [0, 0, 480, 0, 480, 300, 0, 300];
  const fp = { w: 36, d: 24 };
  const drains: DrainPoint[] = [{ id: 'a', x: 420, y: 260 }, { id: 'b', x: 30, y: 30 }];
  assert(nearestDrain({ x: 400, y: 250 }, drains)!.id === 'a', 'nearest drain is the closest one');
  assert(nearestDrain({ x: 60, y: 60 }, drains)!.id === 'b', 'nearest drain (other corner)');
  assert(nearestDrain({ x: 200, y: 140 }, []) === null, 'no drains');
  const obstacles = [{ x: 250, y: 100, w: 40, h: 120 }];
  const plan = condensatePlan({ x: 400, y: 250 }, fp, 12, room, drains, obstacles)!;
  assert(plan.toDrain && isOrthogonalPath(plan.points), 'condensate route is orthogonal');
  assert(plan.points[plan.points.length - 2] === 420 && plan.points[plan.points.length - 1] === 260, 'route ends at the drain point');
  assert(plan.points[0] === 400 && plan.points[1] === 250, 'route starts at the unit');
  const blocked = condensatePlan({ x: 150, y: 160 }, fp, 12, room, [{ id: 'c', x: 330, y: 160 }], obstacles)!;
  assert(isOrthogonalPath(blocked.points), 'detour is orthogonal');
  assert(blocked.points[blocked.points.length - 2] === 330 && blocked.points[blocked.points.length - 1] === 160, 'detour ends at the drain point');
  for (let i = 0; i + 3 < blocked.points.length; i += 2) {
    const x0 = Math.min(blocked.points[i], blocked.points[i + 2]), x1 = Math.max(blocked.points[i], blocked.points[i + 2]);
    const y0 = Math.min(blocked.points[i + 1], blocked.points[i + 3]), y1 = Math.max(blocked.points[i + 1], blocked.points[i + 3]);
    assert(!(x1 > 250 && x0 < 290 && y1 > 100 && y0 < 220), 'route goes around the obstacle');
  }
  assert(Math.hypot(plan.trap.ux, plan.trap.uy) > 0.99, 'trap carries the pipe direction');
  const wall = condensatePlan({ x: 200, y: 140 }, fp, 12, room, [])!;
  assert(!wall.toDrain && isOrthogonalPath(wall.points), 'without a drain point: orthogonal to the nearest exterior wall');
}

// ───────── 7. drain point persistence (guarded storage) ─────────
{
  const mem = new Map<string, string>();
  const kv: KvStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); } };
  const pts: DrainPoint[] = [{ id: 'x', x: 1, y: 2 }, { id: 'y', x: 3.5, y: 4 }];
  saveDrainPoints('proj-A', pts, kv);
  assert(JSON.stringify(loadDrainPoints('proj-A', kv)) === JSON.stringify(pts), 'round trip');
  assert(loadDrainPoints('proj-B', kv).length === 0, 'keyed by project');
  mem.set('mep.canvas.drainPoints.v1:bad', '{not json');
  assert(loadDrainPoints('bad', kv).length === 0, 'corrupt data ignored');
  const throwing: KvStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert(loadDrainPoints('p', throwing).length === 0, 'throwing storage on read');
  saveDrainPoints('p', pts, throwing); // must not throw
  assert(loadDrainPoints('p', null).length === 0, 'null storage');
  let t = toggleDrainPoint([], { x: 10, y: 10 }, 5, 'n1');
  assert(t.length === 1, 'click adds');
  t = toggleDrainPoint(t, { x: 12, y: 11 }, 5, 'n2');
  assert(t.length === 0, 'click on an existing point removes it');
}

// ───────── 8. access panel avoids blocked sides (tries all four sides of the unit) ─────────
{
  const unit = { x: 100, y: 100 };
  const fp = { w: 36, d: 24 };
  const k = 12;
  const first = accessPanelPlacement(unit, fp, k, {});
  const sides = new Set<string>([first.side]);
  const boxes: Rect[] = [first.rect];
  for (let i = 0; i < 3; i++) {
    const pl = accessPanelPlacement(unit, fp, k, { boxes });
    if (i < 3) {
      assert(!boxes.some((b) => rectsOverlap(b, pl.rect)), `panel ${i} avoids the blocked sides`);
      sides.add(pl.side);
      boxes.push(pl.rect);
    }
  }
  assert(sides.size === 4, 'all four sides tried in turn');
}

console.log('canvasPolishL2: all passed');
