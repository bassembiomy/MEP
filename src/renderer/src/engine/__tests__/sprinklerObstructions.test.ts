/**
 * K8 — obstructions to sprinkler discharge (NFPA 13-2019 §10.2.7): beam rule, three-times rule, wide obstructions
 * (sprinklers below), deep beams as walls; sprinkler relocation along branch lines / rows; obstruction layers from the
 * DXF; per-head protection areas; hydraulic graph supply curve.
 */
import { designSprinklerSystem } from '../fireProtection/sprinkler/sprinklerEngine';
import { defaultSprinklerAnswers, beamRuleMaxBIn, beamRuleMinAFt, threeTimesClearanceMm, MIN_SPRINKLER_SPACING_MM, SPACING_RULES } from '../fireProtection/sprinkler/nfpa13Sprinkler';
import { detectObstructions } from '../fireProtection/sprinkler/obstructions';
import { importFloorPlanDxf } from '../fireProtection/sprinkler/floorPlanImport';
import { SprinklerAnswers, SprinklerDesignInput, SprinklerFloorInput, SprinklerObstruction, SprinklerRoomInput, PlacedSprinkler } from '../fireProtection/sprinkler/sprinklerTypes';
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
const room = (p: Partial<SprinklerRoomInput> = {}): SprinklerRoomInput => ({
  id: 'R1', name: 'Office', polygon: OFFICE_POLYGON, occupancy: 'office', hazard: 'light', ceilingHeightM: 3,
  ceilingType: 'finished-flat', freezing: false, heatSource: false, omit: false, omitReason: '', ...p
});
const ob = (id: string, kind: SprinklerObstruction['kind'], poly: [number, number][], depth: number): SprinklerObstruction => ({ id, kind, polygon: poly, bottomBelowCeilingMm: depth });
const design = (obstructions: SprinklerObstruction[], a: Partial<SprinklerAnswers> = {}, rooms: SprinklerRoomInput[] = [room()]): ReturnType<typeof designSprinklerSystem> => {
  const f: SprinklerFloorInput = { id: 'L1', name: 'Level 1', elevationM: 0, roomLayers: [], rooms, systemType: 'wet', riser: { x: -500, y: 6000 }, branchDirection: 'x', obstructions };
  return designSprinklerSystem({ answers: { ...defaultSprinklerAnswers(), ...a }, buildingRiserIn: 6, buildingRiserSchedule: 'sch40', floors: [f] } as SprinklerDesignInput);
};
// distance from a point to the footprint (0 inside)
const distToRect = (x: number, y: number, p: [number, number][]): number => {
  const xs = p.map((q) => q[0]); const ys = p.map((q) => q[1]);
  const dx = Math.max(Math.min(...xs) - x, 0, x - Math.max(...xs));
  const dy = Math.max(Math.min(...ys) - y, 0, y - Math.max(...ys));
  return Math.hypot(dx, dy);
};
const LIGHT_MAX = SPACING_RULES.light.maxSpacingFt * 304.8;
function rowsOk(heads: PlacedSprinkler[], label: string): void {
  // along each row: spacing ≤ max and ≥ 6 ft; walls ≤ S/2 max and ≥ 102 mm (office 0..20000 × 0..12000)
  const ceiling = heads.filter((h) => !h.belowObstruction);
  const rows = [...new Set(ceiling.map((h) => Math.round(h.y)))].sort((a, b) => a - b);
  for (const y of rows) {
    const xs = ceiling.filter((h) => Math.round(h.y) === y).map((h) => h.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) assert(xs[i] - xs[i - 1] <= LIGHT_MAX + 1 && xs[i] - xs[i - 1] >= MIN_SPRINKLER_SPACING_MM - 1, `${label}: row ${y} spacing ${xs[i] - xs[i - 1]}`);
    assert(xs[0] <= LIGHT_MAX / 2 + 1 && xs[0] >= 101 && 20000 - xs[xs.length - 1] <= LIGHT_MAX / 2 + 1, `${label}: row ${y} wall distances ${xs[0]} / ${20000 - xs[xs.length - 1]}`);
  }
  for (let i = 1; i < rows.length; i++) assert(rows[i] - rows[i - 1] <= LIGHT_MAX + 1, `${label}: row spacing ${rows[i] - rows[i - 1]}`);
  assert(rows[0] <= LIGHT_MAX / 2 + 1 && 12000 - rows[rows.length - 1] <= LIGHT_MAX / 2 + 1, `${label}: first/last row to wall`);
}

console.log('=== Sprinkler K8: obstructions ===');
{
  // beam rule table (standard pendent / upright): max deflector height above the bottom of the obstruction, in
  assert(beamRuleMaxBIn(0.9) === 0 && beamRuleMaxBIn(1.2) === 2.5 && beamRuleMaxBIn(1.7) === 3.5 && beamRuleMaxBIn(2.2) === 5.5, 'beam table 1');
  assert(beamRuleMaxBIn(2.7) === 7.5 && beamRuleMaxBIn(3.2) === 9.5 && beamRuleMaxBIn(3.6) === 12 && beamRuleMaxBIn(4.2) === 14, 'beam table 2');
  assert(beamRuleMaxBIn(4.7) === 16.5 && beamRuleMaxBIn(5.2) === 18 && beamRuleMaxBIn(5.7) === 20 && beamRuleMaxBIn(6.2) === 24 && beamRuleMaxBIn(6.7) === 30 && beamRuleMaxBIn(7.2) === 35, 'beam table 3');
  assert(beamRuleMinAFt(0) === 0 && beamRuleMinAFt(11.8) === 3.5 && beamRuleMinAFt(15.7) === 4.5 && beamRuleMinAFt(2.5) === 1, 'minimum A for a given B');
  assert(beamRuleMinAFt(36) === Infinity, 'B beyond the table cannot be cleared by distance');
  assert(threeTimesClearanceMm(400) === 610 && threeTimesClearanceMm(150) === 450, 'three-times rule, max 24 in');
  console.log('✓ NFPA 13 obstruction tables');
}
{
  // no obstructions: identical to before, empty obstruction results, check passes
  const r = design([]);
  assert(r.floors[0].heads.length === 15 && r.floors[0].obstructions.length === 0 && chk(r.floors[0].checks, 'spr-obstruction:L1').status === 'pass', 'no obstructions');
  assert(r.floors[0].heads.every((h) => !h.relocatedMm), 'nothing moved');
}
{
  // beam across the branch lines (x 6300–6500, full depth of the room), 400 mm deep, deflector 100 mm → B = 300 mm
  // (11.8 in) → A ≥ 3.5 ft (1067 mm): no ceiling sprinkler between x = 5233 and 7567
  const beam = ob('B1', 'beam', rect(6300, 0, 6500, 12000), 400);
  const r = design([beam]);
  const f = r.floors[0];
  const o = f.obstructions[0];
  assert(o.rule === 'beam' && o.widthMm === 200 && o.lengthMm === 12000, `beam result ${o.rule}`);
  near(o.requiredClearanceMm, 3.5 * 304.8, 0.5, 'required clearance 3.5 ft');
  assert(o.violations.length === 0 && o.relocatedHeads.length > 0 && o.headsBelow.length === 0, `relocated ${o.relocatedHeads.length}, violations ${o.violations}`);
  for (const h of f.heads) assert(distToRect(h.x, h.y, beam.polygon) >= 3.5 * 304.8 - 0.5, `head ${h.tag} at ${h.x} clears the beam`);
  assert(f.heads.filter((h) => h.relocatedMm && h.relocatedMm > 0).length === o.relocatedHeads.length, 'relocated heads flagged');
  rowsOk(f.heads, 'beam');
  assert(chk(f.checks, 'spr-obstruction:L1').status === 'pass', 'obstruction check');
  assert(f.governing!.minHeadFlowGpm >= 0.1 * Math.max(...f.heads.filter((h) => f.governing!.headsFlowing.includes(h.tag)).map((h) => h.areaFt2)) - 1e-6, 'remote-area flow covers the largest per-head area');
  // per-head protection area S × L (NFPA 13 §10.2.4.1.1): S = larger of the distances to the neighbours / 2 × wall distance
  for (const h of f.heads) assert(h.areaFt2 <= 225 + 1e-6, `${h.tag} area ${h.areaFt2} ≤ 225 ft²`);
  // beam parallel to the branch lines (y 6300–6500): the rows move instead
  const par = design([ob('B2', 'beam', rect(0, 6300, 20000, 6500), 400)]).floors[0];
  assert(par.heads.every((h) => h.y <= 6300 - 1067 + 0.5 || h.y >= 6500 + 1067 - 0.5), 'rows clear a parallel beam');
  rowsOk(par.heads, 'parallel beam');
  console.log('✓ beam rule with relocation');
}
{
  // wide duct (1500 mm > 4 ft): sprinklers below it along its centre line, ceiling sprinklers clear it by the beam rule
  const duct = ob('D1', 'duct', rect(9000, 0, 10500, 12000), 500);
  const f = design([duct]).floors[0];
  const o = f.obstructions[0];
  assert(o.rule === 'wide' && o.widthMm === 1500, 'wide duct');
  const below = f.heads.filter((h) => h.belowObstruction === 'D1');
  assert(below.length === 3 && below.every((h) => Math.abs(h.x - 9750) < 0.5), `3 sprinklers below the duct at its centre line, got ${below.map((h) => `${h.x},${h.y}`)}`);
  assert(below.map((h) => Math.round(h.y)).sort((a, b) => a - b).join() === '2000,6000,10000', 'below-duct spacing');
  assert(o.headsBelow.length === 3 && o.violations.length === 0, 'duct result');
  near(o.requiredClearanceMm, 4.5 * 304.8, 0.5, 'B = 400 mm (15.7 in) → A ≥ 4.5 ft');
  for (const h of f.heads.filter((x) => !x.belowObstruction)) assert(distToRect(h.x, h.y, duct.polygon) >= 4.5 * 304.8 - 0.5, `ceiling head ${h.tag} clears the duct`);
  assert(f.pipes.some((p) => p.toNode === below[0].node || p.fromNode === below[0].node), 'below-duct sprinklers are piped');
  assert(f.heads.length === 15 - 0 + 3 || f.heads.length >= 18, `heads incl. below-duct (${f.heads.length})`);
  console.log('✓ wide obstruction: sprinklers below');
}
{
  // column 400 × 400 at (13800–14200, 9800–10200) on the row y = 10000: three-times rule (610 mm), only that row changes
  const col = ob('C1', 'column', rect(13800, 9800, 14200, 10200), 3000);
  const f = design([col]).floors[0];
  const o = f.obstructions[0];
  assert(o.rule === 'three-times' && o.requiredClearanceMm === 610 && o.violations.length === 0, `column ${o.rule} ${o.requiredClearanceMm}`);
  for (const h of f.heads) assert(distToRect(h.x, h.y, col.polygon) >= 610 - 0.5, `${h.tag} clears the column`);
  const xs = (y: number): string => f.heads.filter((h) => Math.round(h.y) === y).map((h) => Math.round(h.x)).sort((a, b) => a - b).join();
  assert(xs(2000) === '2000,6000,10000,14000,18000' && xs(6000) === '2000,6000,10000,14000,18000', 'other rows unchanged');
  rowsOk(f.heads, 'column');
  console.log('✓ three-times rule');
}
{
  // deep beam (1500 mm, B = 55 in > table) → acts as a wall: each bay laid out on its own
  const deep = ob('W1', 'beam', rect(9900, 0, 10100, 12000), 1500);
  const f = design([deep]).floors[0];
  const o = f.obstructions[0];
  assert(o.rule === 'wall' && o.violations.length === 0, `deep beam ${o.rule}`);
  const left = f.heads.filter((h) => h.x < 9900); const right = f.heads.filter((h) => h.x > 10100);
  assert(left.length + right.length === f.heads.length, 'no head under the deep beam');
  assert(Math.max(...left.map((h) => h.x)) >= 9900 - LIGHT_MAX / 2 - 0.5 && Math.min(...right.map((h) => h.x)) <= 10100 + LIGHT_MAX / 2 + 0.5, 'each bay reaches the beam face within S/2');
  assert(Math.max(...left.map((h) => h.x)) <= 9900 - 102 + 0.5, 'wall distance ≥ 102 mm from the beam face');
  console.log('✓ deep beam as wall');
}
{
  // obstruction layers from the DXF
  const L = (layer: string, pts: [number, number][]): string => ['0', 'LWPOLYLINE', '8', layer, '90', String(pts.length), '70', '1', ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)])].join('\n');
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', L('M-DUCT', rect(9000, 0, 10500, 12000)), L('S-COLS', rect(13800, 9800, 14200, 10200)), L('A-ROOM', OFFICE_POLYGON), '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const plan = importFloorPlanDxf(dxf, 'mm');
  const obs = detectObstructions(plan, [{ layer: 'M-DUCT', kind: 'duct', bottomBelowCeilingMm: 500 }, { layer: 'S-COLS', kind: 'column', bottomBelowCeilingMm: 3000 }]);
  assert(obs.length === 2 && obs[0].kind === 'duct' && obs[1].kind === 'column' && obs.every((o) => o.source === 'detected'), `detected ${obs.map((o) => o.kind)}`);
  assert(obs[0].id === 'OB1' && obs[1].id === 'OB2' && obs[0].bottomBelowCeilingMm === 500, 'ids & depth');
  console.log('✓ obstruction layers from the DXF');
}
{
  // hydraulic graph: supply curve
  const city = design([], { supply: { kind: 'city', staticPsi: 60, residualPsi: 40, residualFlowGpm: 500 } });
  const sc = city.supplyCurve!;
  assert(!!sc && sc.points[0][0] === 0 && sc.points[0][1] === 60, 'city curve starts at the static pressure');
  const at500 = sc.points.find((p) => p[0] === 500)!;
  assert(!!at500 && Math.abs(at500[1] - 40) < 1e-6, 'passes through the residual test point');
  assert(sc.points.length >= 5 && sc.points.every((p, i) => i === 0 || p[0] > sc.points[i - 1][0]), 'ascending flows');
  assert(design([]).supplyCurve === null, 'fire pump curve unknown standalone');
  console.log('✓ supply curve');
}
console.log('\nAll sprinkler K8 tests passed.');
