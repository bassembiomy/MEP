/** K2 — sprinkler head selection, head layout per room (NFPA 13 spacing / area / wall distance / coverage) and floor piping. */
import { selectHeadType, layoutRoomHeads, roomLayoutChecks } from '../fireProtection/sprinkler/headLayout';
import { layoutFloorPiping } from '../fireProtection/sprinkler/pipingLayout';
import { defaultSprinklerAnswers, SPACING_RULES } from '../fireProtection/sprinkler/nfpa13Sprinkler';
import { SprinklerRoomInput, PlacedSprinkler } from '../fireProtection/sprinkler/sprinklerTypes';
import { OFFICE_POLYGON } from './sprinklerSamplePlan';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`Assertion Failed: ${m}`);
}
const near = (a: number, e: number, tol: number, m: string): void => assert(Math.abs(a - e) <= tol, `${m}: expected ${e}±${tol}, got ${a}`);
const room = (p: Partial<SprinklerRoomInput>): SprinklerRoomInput => ({
  id: 'R1', name: 'Office', polygon: OFFICE_POLYGON, occupancy: 'office', hazard: 'light', ceilingHeightM: 3,
  ceilingType: 'finished-flat', freezing: false, heatSource: false, omit: false, omitReason: '', ...p
});

console.log('=== Sprinkler K2: heads & piping ===');
const answers = defaultSprinklerAnswers();
{
  const t = selectHeadType(room({}), 'wet', answers);
  assert(t.id === 'QR-PEN-K5.6-155' && t.kFactor === 5.6 && t.response === 'quick' && t.orientation === 'pendent' && t.tempClass === 'ordinary' && !t.open, `office head ${t.id}`);
  assert(selectHeadType(room({ ceilingType: 'exposed-structure' }), 'wet', answers).id === 'QR-UPR-K5.6-155', 'upright');
  assert(selectHeadType(room({ freezing: true }), 'wet', answers).orientation === 'dry-pendent', 'freezing wet → dry pendent');
  assert(selectHeadType(room({}), 'dry', answers).id === 'QR-DPEN-K5.6-155', 'dry system → dry pendent');
  assert(selectHeadType(room({ heatSource: true, hazard: 'ordinary-1' }), 'wet', answers).id === 'QR-PEN-K5.6-200', 'intermediate temp');
  const eh = selectHeadType(room({ hazard: 'extra-1' }), 'wet', answers);
  assert(eh.kFactor === 8 && eh.response === 'standard' && eh.id === 'SR-PEN-K8-155', `EH1 ${eh.id}`);
  assert(selectHeadType(room({ hazard: 'extra-2' }), 'wet', answers).kFactor === 11.2, 'EH2 K11.2');
  const d = selectHeadType(room({}), 'deluge', answers);
  assert(d.open && d.response === 'standard' && d.id.includes('OPEN'), 'deluge open heads');
  console.log('✓ head selection');
}
{
  const o = layoutRoomHeads(room({}), 'x', SPACING_RULES.light);
  assert(o.points.length === 15 && o.S === 4000 && o.L === 4000, `office 15 heads 4000×4000, got ${o.points.length} ${o.S}×${o.L}`);
  const xs = [...new Set(o.points.map((p) => p[0]))].sort((a, b) => a - b);
  const ys = [...new Set(o.points.map((p) => p[1]))].sort((a, b) => a - b);
  assert(xs.join() === '2000,6000,10000,14000,18000' && ys.join() === '2000,6000,10000', 'office grid');
  const st = layoutRoomHeads(room({ polygon: [[22000, 0], [30000, 0], [30000, 6000], [22000, 6000]], hazard: 'ordinary-2' }), 'x', SPACING_RULES.ordinary);
  assert(st.points.length === 4 && st.S === 4000 && st.L === 3000, `storage 4 heads 4000×3000, got ${st.points.length} ${st.S}×${st.L}`);
  const co = layoutRoomHeads(room({ polygon: [[0, 12500], [30000, 12500], [30000, 14500], [0, 14500]] }), 'x', SPACING_RULES.light);
  assert(co.points.length === 7 && co.L === 2000, `corridor 7 heads, got ${co.points.length}`);
  near(co.S, 30000 / 7, 0.01, 'corridor spacing');
  const oy = layoutRoomHeads(room({}), 'y', SPACING_RULES.light);
  assert(oy.points.length === 15 && oy.S === 4000 && oy.L === 4000, 'direction y');

  // L-shaped room: coverage, wall distance, spacing & minimum spacing all satisfied
  const Lp: [number, number][] = [[0, 0], [12000, 0], [12000, 5000], [5000, 5000], [5000, 12000], [0, 12000]];
  const l = layoutRoomHeads(room({ polygon: Lp }), 'x', SPACING_RULES.light);
  const inside = (x: number, y: number): boolean => {
    let c = false;
    for (let i = 0, j = Lp.length - 1; i < Lp.length; j = i++) {
      const [xi, yi] = Lp[i]; const [xj, yj] = Lp[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  for (const [x, y] of l.points) assert(inside(x, y), `L head (${x},${y}) inside`);
  for (let x = 125; x < 12000; x += 250)
    for (let y = 125; y < 12000; y += 250)
      if (inside(x, y)) assert(l.points.some(([hx, hy]) => Math.abs(hx - x) <= l.S / 2 + 1 && Math.abs(hy - y) <= l.L / 2 + 1), `L point (${x},${y}) covered`);
  for (let i = 0; i < l.points.length; i++)
    for (let j = i + 1; j < l.points.length; j++)
      assert(Math.hypot(l.points[i][0] - l.points[j][0], l.points[i][1] - l.points[j][1]) >= 1829, 'L min spacing 1829 mm');
  assert(l.S <= 4572.01 && l.L <= 4572.01 && (l.S * l.L) / 1e6 * 10.7639 <= 225.01, 'L spacing & area');
  // Wall-distance check applies to the outermost head facing each wall (regression: middle heads must not count)
  for (const [poly, rules, label] of [[OFFICE_POLYGON, SPACING_RULES.light, 'office'], [[[0, 12500], [30000, 12500], [30000, 14500], [0, 14500]], SPACING_RULES.light, 'corridor'], [Lp, SPACING_RULES.light, 'L-shape']] as const) {
    const rm = room({ polygon: poly as [number, number][] });
    const lay = layoutRoomHeads(rm, 'x', rules);
    const cs = roomLayoutChecks(rm, lay, rules, 'x');
    for (const c of cs) assert(c.status === 'pass', `${label}: ${c.id} passes (${c.detail})`);
  }
  console.log('✓ head layout (rectangles, corridor, L-shape coverage)');
}
{
  const o = layoutRoomHeads(room({}), 'x', SPACING_RULES.light);
  const heads: PlacedSprinkler[] = o.points
    .map(([x, y]) => ({ x, y }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((p, i) => ({ tag: `S-L1-${String(i + 1).padStart(3, '0')}`, floorId: 'L1', roomId: 'R1', x: p.x, y: p.y, headTypeId: 'QR-PEN-K5.6-155', spacingSmm: 4000, spacingLmm: 4000, areaFt2: 172.2224, wallDistanceMm: 2000, node: `S-L1-${String(i + 1).padStart(3, '0')}`, zoneId: 'Z1' }));
  const r = layoutFloorPiping('L1', heads, { x: -500, y: 6000 }, 'x', { hazardOf: () => 'light', schedule: 'sch40', minMainIn: 2 });
  const branch = r.pipes.filter((p) => p.kind === 'branch');
  const cm = r.pipes.filter((p) => p.kind === 'cross-main');
  const rn = r.pipes.find((p) => p.kind === 'riser-nipple')!;
  assert(branch.length === 15 && cm.length === 2, `15 branch segments, 2 cross-main segments, got ${branch.length}/${cm.length}`);
  const arm = (y: number) => branch.filter((p) => p.points.every(([, py]) => Math.abs(py - y) < 1)).sort((a, b) => a.points[0][0] + a.points[1][0] - (b.points[0][0] + b.points[1][0]));
  const a3 = arm(10000);
  assert(a3.map((p) => p.sizeIn).join() === '1.5,1.5,1.25,1,1', `arm sizes 1½,1½,1¼,1,1 got ${a3.map((p) => p.sizeIn)}`);
  assert(a3.map((p) => p.sprinklersDownstream).join() === '5,4,3,2,1', 'downstream counts');
  near(a3[0].lengthM, 2.5, 0.001, 'J → first head 2.5 m');
  assert(cm.every((p) => p.sizeIn === 2 && Math.abs(p.lengthM - 4) < 1e-6), 'cross main 2" × 4 m');
  assert(rn.sizeIn === 2.5 && rn.fromNode === 'FC' && rn.toNode === 'R' && Math.abs(rn.lengthM - 1) < 1e-6, 'riser nipple 2½"');
  assert(!r.pipes.some((p) => p.fromNode === 'J2' || p.toNode === 'J2'), 'junction at the riser point is FC');
  assert(r.pipes.every((p) => p.schedule === 'sch40'), 'schedule');
  // A long unsprinklered run feeding a remote room is sized as a main (≥ 2"), not by the branch pipe schedule
  const far: PlacedSprinkler[] = [[25000, 3000], [29000, 3000]].map(([x, y], i) => ({ ...heads[0], tag: `S-L1-1${i}`, node: `S-L1-1${i}`, x, y }));
  const fr = layoutFloorPiping('L1', far, { x: -500, y: 6000 }, 'x', { hazardOf: () => 'light', schedule: 'sch40', minMainIn: 2 });
  const feed = fr.pipes.find((p) => p.kind === 'branch' && p.lengthM > 20)!;
  assert(!!feed && feed.sizeIn >= 2, `25.5 m feed run sized ≥ 2", got ${feed?.sizeIn}`);
  assert(fr.pipes.find((p) => p.kind === 'branch' && Math.abs(p.lengthM - 4) < 1e-6)!.sizeIn === 1, 'short branch between sprinklers stays per schedule');
  console.log('✓ floor piping & pipe-schedule sizing');
}
console.log('\nAll sprinkler K2 tests passed.');
