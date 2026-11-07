/**
 * K6 — designer-selected areas & sprinkler types, standard horizontal sidewall layout, system zones per floor
 * (zone control valve, own piping & hydraulics, NFPA 13 §4.4 area limit) and hydraulic pipe sizing.
 */
import { designSprinklerSystem } from '../fireProtection/sprinkler/sprinklerEngine';
import { defaultSprinklerAnswers } from '../fireProtection/sprinkler/nfpa13Sprinkler';
import { SprinklerAnswers, SprinklerDesignInput, SprinklerFloorInput, SprinklerHeadSpec, SprinklerRoomInput, SprinklerSystemType } from '../fireProtection/sprinkler/sprinklerTypes';
import { DesignCheck } from '../fireProtection/fpTypes';
import { OFFICE_POLYGON } from './sprinklerSamplePlan';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`Assertion Failed: ${m}`);
}
const near = (a: number, e: number, tol: number, m: string): void => assert(Math.abs(a - e) <= tol, `${m}: expected ${e}±${tol}, got ${a}`);
const chk = (cs: DesignCheck[], id: string): DesignCheck => {
  const c = cs.find((k) => k.id === id);
  assert(!!c, `check ${id} present (${cs.map((k) => k.id).join(', ')})`);
  return c!;
};
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (p: Partial<SprinklerRoomInput>): SprinklerRoomInput => ({
  id: 'R1', name: 'Office', polygon: OFFICE_POLYGON, occupancy: 'office', hazard: 'light', ceilingHeightM: 3,
  ceilingType: 'finished-flat', freezing: false, heatSource: false, omit: false, omitReason: '', ...p
});
const floor = (rooms: SprinklerRoomInput[], p: Partial<SprinklerFloorInput> = {}, systemType: SprinklerSystemType = 'wet'): SprinklerFloorInput => ({
  id: 'L1', name: 'Level 1', elevationM: 0, roomLayers: [], rooms, systemType, riser: { x: -500, y: 6000 }, branchDirection: 'x', ...p
});
const design = (floors: SprinklerFloorInput[], a: Partial<SprinklerAnswers> = {}): ReturnType<typeof designSprinklerSystem> =>
  designSprinklerSystem({ answers: { ...defaultSprinklerAnswers(), ...a }, buildingRiserIn: 6, buildingRiserSchedule: 'sch40', floors } as SprinklerDesignInput);
const spec = (p: Partial<SprinklerHeadSpec>): SprinklerHeadSpec => ({ kFactor: 5.6, orientation: 'pendent', response: 'quick', tempRatingF: 155, ...p });

console.log('=== Sprinkler K6: designer areas, sprinkler types, zones, hydraulic sizing ===');
{
  // designer-chosen sprinkler type
  const k8 = design([floor([room({ headSpec: spec({ kFactor: 8 }) })])]);
  const t = k8.headTypes[0];
  assert(t.id === 'QR-PEN-K8-155' && t.kFactor === 8 && t.response === 'quick', `K8 spec → ${t.id}`);
  const g = k8.floors[0].governing!;
  near(g.minHeadFlowGpm, 17.222, 0.01, 'q = 0.1 × 172.2 ft²');
  near(g.remoteHeadPressurePsi, 7, 0.001, 'K8: (17.22/8)² = 4.6 → 7 psi minimum');
  assert(chk(k8.floors[0].rooms[0].checks, 'spr-head-spec:R1').status === 'pass', 'K8 QR pendent in light hazard ok');
  const cc = design([floor([room({ headSpec: spec({ orientation: 'concealed-pendent', tempRatingF: 200 }) })])]).headTypes[0];
  assert(cc.id === 'QR-CPEN-K5.6-200' && cc.tempClass === 'intermediate' && cc.orientation === 'concealed-pendent', `concealed ${cc.id}`);
  const sr = design([floor([room({ headSpec: spec({ response: 'standard' }) })])]);
  assert(chk(sr.floors[0].checks, 'spr-quick-response:L1').status === 'fail', 'standard response in light hazard → fail');
  const up = design([floor([room({ headSpec: spec({ orientation: 'upright' }) })])]);
  assert(chk(up.floors[0].rooms[0].checks, 'spr-head-spec:R1').status === 'warn', 'upright under a finished ceiling → warn');
  const dry = design([floor([room({ headSpec: spec({ orientation: 'pendent' }) })], {}, 'dry')]);
  assert(chk(dry.floors[0].rooms[0].checks, 'spr-head-spec:R1').status === 'fail', 'wet pendent on a dry system → fail');
  const eh = design([floor([room({ hazard: 'extra-1', headSpec: spec({ response: 'standard' }) })])]);
  assert(chk(eh.floors[0].rooms[0].checks, 'spr-head-spec:R1').status === 'warn', 'K5.6 in extra hazard → warn');
  const auto = design([floor([room({ headSpec: null })])]);
  assert(auto.headTypes[0].id === 'QR-PEN-K5.6-155', 'null spec = automatic');
  console.log('✓ designer sprinkler types & compatibility checks');
}
{
  // standard horizontal sidewall (NFPA 13 §10.3): heads along the wall nearest the riser, 150 mm from the wall
  const sw = spec({ orientation: 'sidewall' });
  const one = design([floor([room({ polygon: rect(0, 0, 10000, 4000), headSpec: sw })])]);
  const h = one.floors[0].heads;
  assert(one.headTypes[0].id === 'QR-HSW-K5.6-155' && one.headTypes[0].orientation === 'sidewall', `sidewall id ${one.headTypes[0].id}`);
  assert(h.length === 3, `3 sidewalls, got ${h.length}`);
  const xs = h.map((p) => p.x).sort((a, b) => a - b);
  near(xs[0], 10000 / 6, 0.5, 'first at S/2'); near(xs[1], 5000, 0.5, 'middle'); near(xs[2], 10000 * 5 / 6, 0.5, 'last');
  assert(h.every((p) => Math.abs(p.y - 3850) < 0.5), 'on the wall nearest the riser (y = 4000 − 150)');
  const r1 = one.floors[0].rooms[0];
  near(r1.spacingSmm, 10000 / 3, 0.5, 'S along the wall'); near(r1.spacingLmm, 4000, 0.5, 'throw = room width');
  assert(r1.maxSpacingMm === 14 * 304.8 && r1.maxAreaFt2 === 196, 'light sidewall limits 14 ft / 196 ft²');
  assert(chk(r1.checks, 'spr-sidewall:R1').status === 'pass', 'sidewall throw ok');
  near(one.floors[0].governing!.minHeadFlowGpm, 0.1 * (10000 / 3 / 304.8) * (4000 / 304.8), 0.01, 'sidewall protection area S × throw');
  const two = design([floor([room({ polygon: rect(0, 0, 10000, 7000), headSpec: sw })])]).floors[0];
  assert(two.heads.length === 6 && two.heads.filter((p) => Math.abs(p.y - 150) < 0.5).length === 3 && two.heads.filter((p) => Math.abs(p.y - 6850) < 0.5).length === 3, 'wide room → both opposite walls');
  near(two.rooms[0].spacingLmm, 3500, 0.5, 'throw = half the width');
  const wide = design([floor([room({ polygon: rect(0, 0, 10000, 9000), headSpec: sw })])]).floors[0];
  assert(chk(wide.rooms[0].checks, 'spr-sidewall:R1').status === 'fail', 'room wider than 2 × 14 ft → fail');
  const oh = design([floor([room({ polygon: rect(0, 0, 10000, 3000), hazard: 'ordinary-1', headSpec: sw })])]).floors[0];
  assert(oh.heads.length === 4 && Math.abs(oh.rooms[0].spacingSmm - 2500) < 0.5 && oh.rooms[0].maxAreaFt2 === 100, 'OH sidewall 10 ft / 100 ft²');
  assert(chk(oh.rooms[0].checks, 'spr-sidewall:R1').status === 'warn', 'OH sidewall only where listed → warn');
  const ehs = design([floor([room({ polygon: rect(0, 0, 10000, 3000), hazard: 'extra-1', headSpec: sw })])]).floors[0];
  assert(chk(ehs.rooms[0].checks, 'spr-sidewall:R1').status === 'fail', 'sidewall in extra hazard → fail');
  console.log('✓ horizontal sidewall layout');
}
{
  // two system zones on one floor, each with its own zone control valve, piping and hydraulics
  const storage = room({ id: 'R2', name: 'Storage', polygon: rect(22000, 0, 30000, 6000), occupancy: 'storage', hazard: 'ordinary-2', zoneId: 'Z2' });
  const r = design([floor([room({ zoneId: 'Z1' }), storage], { zones: [{ id: 'Z1', name: 'Offices', riser: { x: -500, y: 6000 } }, { id: 'Z2', name: 'Storage', riser: { x: 31000, y: 3000 } }] })]);
  const f = r.floors[0];
  assert(f.zones.length === 2 && f.zones[0].roomIds.join() === 'R1' && f.zones[1].roomIds.join() === 'R2', 'zones & rooms');
  assert(f.zones[0].controlValveTag === 'ZCV-L1-Z1' && f.zones[1].controlValveTag === 'ZCV-L1-Z2', 'zone control valve tags');
  assert(f.zones[0].node === 'FC' && f.zones[1].node === 'FC-Z2', 'zone nodes');
  assert(f.heads.filter((x) => x.zoneId === 'Z1').length === 15 && f.heads.filter((x) => x.zoneId === 'Z2').length === 4, 'heads per zone');
  assert(f.pipes.every((p) => p.zoneId === 'Z1' || p.zoneId === 'Z2'), 'pipes tagged');
  const rn2 = f.pipes.find((p) => p.kind === 'riser-nipple' && p.zoneId === 'Z2')!;
  assert(!!rn2 && rn2.fromNode === 'FC-Z2' && rn2.toNode === 'R-Z2', 'zone 2 riser nipple');
  assert(f.pipes.filter((p) => p.zoneId === 'Z2').every((p) => p.points.every(([x]) => x >= 21000)), 'zone 2 piping stays in its area');
  assert(f.pipes.filter((p) => p.zoneId === 'Z1').every((p) => p.points.every(([x]) => x <= 20500)), 'zone 1 piping stays in its area');
  const g1 = f.zones[0].governing!;
  const g2 = f.zones[1].governing!;
  assert(g1.zoneId === 'Z1' && g1.hazard === 'light' && g2.zoneId === 'Z2' && g2.hazard === 'ordinary-2', 'zone governing areas');
  near(g1.flowAtFloorGpm, 190.306, 0.6, 'zone 1 = the office calculation of K3');
  assert(f.governing === (g1.pressureAtSourcePsi >= g2.pressureAtSourcePsi ? g1 : g2), 'floor governing = worst zone');
  assert(f.remoteAreas.every((a) => a.zoneId === 'Z1' || a.zoneId === 'Z2'), 'remote areas tagged');
  near(f.zones[0].areaM2, 240, 0.01, 'zone 1 area'); near(f.zones[1].areaFt2, 48 * 10.7639104, 0.1, 'zone 2 area ft²');
  assert(f.zones.every((z) => z.maxAreaFt2 === 52000) && chk(f.zones[0].checks, 'spr-zone-area:L1/Z1').status === 'pass', '§4.4 area limit');
  const zcv = r.accessories.filter((a) => /zone control|floor control/i.test(a.item)).reduce((s, a) => s + a.qty, 0);
  assert(zcv === 2, `two zone control valve assemblies, got ${zcv}`);
  // a zone above 52,000 ft² fails
  const big = design([floor([room({ polygon: rect(0, 0, 100000, 50000) })])]);
  assert(chk(big.floors[0].zones[0].checks, 'spr-zone-area:L1/Z1').status === 'fail', '53,820 ft² > 52,000 ft²');
  // no zones given → one zone named after the floor
  const one = design([floor([room({})])]).floors[0];
  assert(one.zones.length === 1 && one.zones[0].zoneId === 'Z1' && one.zones[0].name === 'Level 1' && one.heads.every((x) => x.zoneId === 'Z1'), 'default zone');
  console.log('✓ system zones');
}
{
  // hydraulic pipe sizing vs pipe-schedule sizing (same supply)
  const city = { supply: { kind: 'city' as const, staticPsi: 80, residualPsi: 70, residualFlowGpm: 1000 } };
  const rooms = [room({}), room({ id: 'R2', name: 'Storage', polygon: rect(22000, 0, 30000, 6000), hazard: 'ordinary-2' })];
  const sch = design([floor(rooms)], city).floors[0];
  const hyd = design([floor(rooms)], { ...city, pipeSizing: 'hydraulic' }).floors[0];
  const volume = (ps: typeof sch.pipes): number => ps.reduce((s, p) => s + p.sizeIn * p.sizeIn * p.lengthM, 0);
  assert(volume(hyd.pipes) < volume(sch.pipes), `hydraulic sizing uses less pipe (${volume(hyd.pipes).toFixed(1)} vs ${volume(sch.pipes).toFixed(1)})`);
  assert(hyd.pipes.every((p) => p.sizeIn >= 1), 'minimum 1" steel');
  for (const ra of hyd.remoteAreas) {
    assert(ra.marginPsi >= 10 - 1e-6, `${ra.hazard} margin ${ra.marginPsi} ≥ 10 psi`);
    for (const row of ra.rows) assert(row.velocityFps <= 20 + 1e-6 || row.toNode === 'SRC' || row.toNode === 'BR', `velocity ${row.velocityFps.toFixed(1)} ft/s ≤ 20 on ${row.fromNode}→${row.toNode}`);
  }
  // sizes never increase in the flow direction (toward the sprinklers)
  const into = new Map(hyd.pipes.map((p) => [p.toNode, p]));
  for (const p of hyd.pipes) {
    const up = into.get(p.fromNode);
    if (up) assert(up.sizeIn >= p.sizeIn, `${up.id} (${up.sizeIn}") feeds ${p.id} (${p.sizeIn}")`);
  }
  assert(chk(hyd.checks, 'spr-pipe-sizing:L1').status === 'pass' && /hydraulic/i.test(chk(hyd.checks, 'spr-pipe-sizing:L1').detail), 'sizing check');
  console.log('✓ hydraulic pipe sizing');
}
console.log('\nAll sprinkler K6 tests passed.');
