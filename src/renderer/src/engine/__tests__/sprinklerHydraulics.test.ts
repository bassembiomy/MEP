/**
 * K3 — remote design area, node-to-node hydraulics (wet / dry / deluge), checks, accessories, spares, BOM and the
 * integration with the fire pump design. Expected values from an independent Python oracle (plan §K3).
 */
import { designSprinklerSystem } from '../fireProtection/sprinkler/sprinklerEngine';
import { defaultSprinklerAnswers } from '../fireProtection/sprinkler/nfpa13Sprinkler';
import { designFireProtectionSystem } from '../fireProtection/fireProtectionEngine';
import { DEFAULT_FIRE_INPUT } from '../fireProtection/defaults';
import { buildFireCalcReport } from '../fireProtection/report';
import { SprinklerDesignInput, SprinklerSystemType } from '../fireProtection/sprinkler/sprinklerTypes';
import { DesignCheck } from '../fireProtection/fpTypes';
import { OFFICE_POLYGON } from './sprinklerSamplePlan';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`Assertion Failed: ${m}`);
}
const near = (a: number, e: number, tolPct: number, m: string): void =>
  assert(Math.abs(a - e) / Math.max(Math.abs(e), 1e-9) <= tolPct / 100, `${m}: expected ${e} ±${tolPct}%, got ${a}`);
const chk = (cs: DesignCheck[], id: string): DesignCheck => {
  const c = cs.find((k) => k.id === id);
  assert(!!c, `check ${id} present (${cs.map((k) => k.id).join(', ')})`);
  return c!;
};
const input = (systemType: SprinklerSystemType, over: Partial<SprinklerDesignInput> = {}): SprinklerDesignInput => ({
  answers: defaultSprinklerAnswers(),
  buildingRiserIn: 6,
  buildingRiserSchedule: 'sch40',
  floors: [{
    id: 'L1', name: 'Level 1', elevationM: 0, roomLayers: [], systemType, riser: { x: -500, y: 6000 }, branchDirection: 'x',
    rooms: [{ id: 'R1', name: 'Open Office', polygon: OFFICE_POLYGON, occupancy: 'office', hazard: 'light', ceilingHeightM: 3, ceilingType: 'finished-flat', freezing: false, heatSource: false, omit: false, omitReason: '' }]
  }],
  ...over
});

console.log('=== Sprinkler K3: hydraulics & system ===');
{
  const r = designSprinklerSystem(input('wet'));
  const f = r.floors[0];
  assert(r.totalHeads === 15 && f.heads.length === 15, '15 heads');
  assert(f.heads[0].tag === 'S-L1-001' && f.heads[14].tag === 'S-L1-015' && f.heads[14].x === 18000 && f.heads[14].y === 10000, 'tags along rows');
  const g = f.governing!;
  assert(!!g && g.hazard === 'light' && g.densityGpmFt2 === 0.1 && g.designAreaFt2 === 1500 && g.baseAreaFt2 === 1500, 'design basis');
  assert(g.headsPerBranch === 4, `nb 4, got ${g.headsPerBranch}`);
  assert([...g.headsFlowing].sort().join() === 'S-L1-005,S-L1-007,S-L1-008,S-L1-009,S-L1-010,S-L1-012,S-L1-013,S-L1-014,S-L1-015', `flowing ${g.headsFlowing}`);
  near(g.minHeadFlowGpm, 17.222, 0.05, 'q min');
  near(g.remoteHeadPressurePsi, 9.4581, 0.05, 'remote head pressure');
  near(g.flowAtFloorGpm, 190.306, 0.3, 'flow at FC');
  near(g.flowAtSourceGpm, 190.306, 0.3, 'flow at R (standalone)');
  near(g.pressureAtSourcePsi, 29.1281, 0.3, 'pressure at R');
  assert(g.rows[0].fromNode === 'S-L1-015' && g.rows[g.rows.length - 1].toNode === 'R', 'rows from remote head to R');
  for (let i = 0; i < g.rows.length; i++) assert(Math.abs(g.rows[i].ptEndPsi - (g.rows[i].ptStartPsi + g.rows[i].pfPsi + g.rows[i].pePsi)) < 1e-6, 'row balance');
  assert(g.hoseAllowanceGpm === 100 && Math.abs(g.totalDemandGpm - (g.flowAtSourceGpm + 100)) < 1e-6, 'hose allowance');
  near(f.volumeGal, 18.75, 0.5, 'floor volume');
  assert(f.hangers.length > 15, 'hangers placed');
  assert(chk(f.checks, 'spr-pressure-min:L1').status === 'pass' && chk(f.checks, 'spr-quick-response:L1').status === 'pass', 'floor checks');
  assert(r.spareHeads.length === 1 && r.spareHeads[0].qty === 6, 'spares 6');
  const acc = r.accessories.map((a) => a.item.toLowerCase()).join('|');
  for (const s of ['alarm check', 'floor control', "inspector", 'main drain', 'fire department connection', 'air vent', 'water-motor']) assert(acc.includes(s), `wet accessory "${s}"`);
  assert(r.bom.some((b) => /QR-PEN-K5.6-155/.test(b.item) && b.qty === 15) && r.bom.some((b) => b.unit === 'm' && b.size.includes('1½')), 'BOM');
  assert(r.outOfScope.length === 0, 'nothing out of scope');
  console.log('✓ wet: remote area & node-to-node calc match the oracle');
}
{
  const r = designSprinklerSystem(input('dry'));
  const f = r.floors[0];
  const g = f.governing!;
  assert(f.heads.every((h) => h.headTypeId === 'QR-DPEN-K5.6-155'), 'dry pendents');
  assert(g.designAreaFt2 === 1950 && g.headsFlowing.length === 12 && g.headsPerBranch === 5, `dry +30 %: ${g.designAreaFt2} / ${g.headsFlowing.length}`);
  near(g.flowAtFloorGpm, 283.7197, 0.3, 'dry flow (fittings × 0.713 at C = 100, NFPA 13 §28.2.3.1.2)');
  near(g.pressureAtSourcePsi, 44.6019, 0.3, 'dry pressure');
  assert(chk(f.checks, 'spr-dry-capacity:L1').status === 'pass' && chk(f.checks, 'spr-slope:L1').status === 'pass', 'dry checks');
  const acc = r.accessories.map((a) => a.item.toLowerCase()).join('|');
  for (const s of ['dry-pipe valve', 'air', 'low-air']) assert(acc.includes(s), `dry accessory "${s}"`);
  assert(!acc.includes('alarm check'), 'no alarm check valve on a dry system');
  console.log('✓ dry: +30 % area, C = 100, dry-pipe trim');
}
{
  const r = designSprinklerSystem(input('deluge'));
  const g = r.floors[0].governing!;
  assert(g.headsFlowing.length === 15, 'deluge: all heads flow');
  near(g.flowAtFloorGpm, 327.601, 0.3, 'deluge flow');
  near(g.pressureAtSourcePsi, 37.1006, 0.3, 'deluge pressure');
  const acc = r.accessories.map((a) => a.item.toLowerCase()).join('|');
  assert(acc.includes('deluge valve') && acc.includes('solenoid') && acc.includes('detection') && !acc.includes('inspector'), 'deluge trim');
  const pre = designSprinklerSystem(input('preaction-single'));
  assert(pre.accessories.some((a) => /preaction valve/i.test(a.item)) && chk(pre.floors[0].checks, 'spr-preaction-size:L1').status === 'pass', 'preaction');
  assert(designSprinklerSystem(input('preaction-double')).floors[0].governing!.designAreaFt2 === 1950, 'double interlock +30 %');
  console.log('✓ deluge / preaction');
}
{
  const hp = designSprinklerSystem(input('wet', { answers: { ...defaultSprinklerAnswers(), highPiledStorage: true } }));
  assert(hp.outOfScope.length === 1 && chk(hp.checks, 'spr-out-of-scope').status === 'warn', 'high-piled storage flagged');
  const cpvc = designSprinklerSystem(input('dry', { answers: { ...defaultSprinklerAnswers(), pipeMaterial: 'cpvc' } }));
  assert(chk(cpvc.floors[0].checks, 'spr-cpvc:L1').status === 'fail', 'CPVC not on dry systems');
  const city = designSprinklerSystem(input('wet', { answers: { ...defaultSprinklerAnswers(), supply: { kind: 'city', staticPsi: 60, residualPsi: 40, residualFlowGpm: 500 } } }));
  const cg = city.floors[0].governing!;
  near(cg.availablePsi, 60 - 20 * Math.pow((cg.flowAtSourceGpm + 100) / 500, 1.85), 0.1, 'city supply curve');
  assert(cg.marginPsi > 0 && chk(city.floors[0].checks, 'spr-supply:L1').status === 'pass', 'city supply adequate');
  const weak = designSprinklerSystem(input('wet', { answers: { ...defaultSprinklerAnswers(), supply: { kind: 'city', staticPsi: 30, residualPsi: 20, residualFlowGpm: 300 } } }));
  const wg = weak.floors[0];
  assert(wg.pipes.some((p) => p.kind === 'cross-main' && p.sizeIn > 2) || chk(wg.checks, 'spr-supply:L1').status === 'fail', 'weak supply → upsizing or failure');
  console.log('✓ scope, CPVC, city supply & upsizing');
}
{
  const fire = designFireProtectionSystem({ ...DEFAULT_FIRE_INPUT, sprinklerDesign: { ...input('wet'), floors: [{ ...input('wet').floors[0], id: 'L8', name: 'Level 8', elevationM: 29.7 }] } });
  const s = fire.sprinklers!;
  assert(!!s && s.floors[0].floorId === 'L8', 'result.sprinklers');
  const g = s.governing!;
  assert(g.pressureAtSourcePsi > g.pressureAtFloorPsi + 0.433 * 29 * 3.28084, 'building riser elevation added to the source pressure');
  assert(g.rows.some((r) => r.toNode === 'BR') && g.rows[g.rows.length - 1].toNode === 'SRC', 'riser & feed main rows');
  near(fire.demand.sprinkler.sprinklerFlowGpm, g.flowAtSourceGpm, 0.01, 'demand.sprinkler overridden (flow)');
  near(fire.demand.sprinkler.pressureAtPumpDischargePsi, g.pressureAtSourcePsi, 0.01, 'demand.sprinkler overridden (pressure)');
  assert(g.availablePsi > 0 && chk(s.floors[0].checks, 'spr-supply:L8').status === 'pass', 'fire pump supply check');
  assert(fire.checks.some((c) => c.id === 'spr-supply:L8'), 'checks aggregated');
  assert(designFireProtectionSystem(DEFAULT_FIRE_INPUT).sprinklers === null, 'no sprinkler design → null');
  assert(buildFireCalcReport(fire).toUpperCase().includes('AUTOMATIC SPRINKLER SYSTEM'), 'report section');
  console.log('✓ integration with the fire pump design');
}
console.log('\nAll sprinkler K3 tests passed.');
