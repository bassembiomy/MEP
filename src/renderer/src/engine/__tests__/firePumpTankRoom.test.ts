/**
 * Acceptance tests — fire pump set (NFPA 20), fire water tank & sump (NFPA 22),
 * pump room layout and the end-to-end engine. Expected values from an independent oracle.
 */
import { selectPumpSet } from '../fireProtection/pumpSelector';
import { designTank } from '../fireProtection/tankDesigner';
import { designPumpRoom } from '../fireProtection/pumpRoomDesigner';
import { designFireProtectionSystem } from '../fireProtection/fireProtectionEngine';
import { buildFireCalcReport } from '../fireProtection/report';
import { calculateSystemDemand } from '../fireProtection/hydraulics';
import { SIMPLE_FIRE_INPUT as DEFAULT_FIRE_INPUT } from '../fireProtection/defaults';
import { FireDesignInput, Rect, DesignCheck } from '../fireProtection/fpTypes';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion Failed: ${message}`);
}
function near(actual: number, expected: number, tolPct: number, label: string): void {
  const err = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-9);
  assert(err <= tolPct / 100, `${label}: expected ${expected} ±${tolPct}%, got ${actual}`);
}
const check = (checks: DesignCheck[], id: string): DesignCheck => {
  const c = checks.find((k) => k.id === id);
  assert(!!c, `check "${id}" present`);
  return c!;
};
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Rect, w: number, h: number): boolean => a.x >= -1e-6 && a.y >= -1e-6 && a.x + a.w <= w + 1e-6 && a.y + a.h <= h + 1e-6;

console.log('=== Fire Pump Set / Tank / Pump Room ===');

// 1. Pump set for a 480 gpm @ 110 psi demand (hand-calculated oracle)
{
  const input: FireDesignInput = { ...DEFAULT_FIRE_INPUT, arrangement: 'electric+diesel', pumpTypePreference: 'auto' };
  const base = calculateSystemDemand(input);
  const demand = { ...base, pumpDemandFlowGpm: 480, pumpDemandPressurePsi: 110 };
  const ps = selectPumpSet(input, demand);
  assert(ps.mainPumps.length === 2, 'two main pumps');
  const [fp1, fp2] = ps.mainPumps;
  assert(fp1.tag === 'FP-1' && fp1.driver === 'electric' && fp1.role === 'duty', 'FP-1 electric duty');
  assert(fp2.tag === 'FP-2' && fp2.driver === 'diesel' && fp2.role === 'standby', 'FP-2 diesel standby');
  assert(fp1.ratedFlowGpm === 500, `rated 500 gpm, got ${fp1.ratedFlowGpm}`);
  assert(fp1.pumpType === 'horizontal-split-case', `auto type HSC for 500 gpm flooded suction, got ${fp1.pumpType}`);
  assert(fp1.sizes.suctionIn === 5 && fp1.sizes.dischargeIn === 5, 'NFPA 20 table sizes for 500 gpm');
  near(ps.suctionVelocityAt150Fps, 12.028, 0.2, 'suction velocity @150%');
  near(ps.suctionPressureMinPsi, -1.0078, 1, 'suction pressure @150% LWL');
  assert(fp1.ratedNetPressurePsi === 115, `rated net 115 psi, got ${fp1.ratedNetPressurePsi}`);
  near(fp1.ratedHeadFt, 265.65, 0.1, 'rated head ft');
  near(fp1.churnPressurePsi, 138, 0.05, 'churn = 120 %');
  near(fp1.pressureAt150Psi, 80.5, 0.05, '150 % point = 70 %');
  assert(fp1.curve.length === 7 && fp1.curve[4].percentFlow === 100, 'curve 0..150 % in 25 % steps');
  near(fp1.maxBhp, 67.083, 0.2, 'max BHP');
  assert(fp1.driverHp === 75, `electric motor 75 HP, got ${fp1.driverHp}`);
  assert(fp2.driverHp === 75, `diesel engine 75 HP, got ${fp2.driverHp}`);
  assert(fp2.fuelTankGal === 83, `fuel tank 83 gal (75 × 1.10), got ${fp2.fuelTankGal}`);
  assert(fp1.circulationReliefIn === 0.75 && fp2.circulationReliefIn === null, 'circulation relief electric only');
  assert(fp1.controller.tag === 'FPC-1' && fp1.controller.kind === 'electric-fire-pump-controller', 'FPC-1');
  assert(fp2.controller.tag === 'FPC-2' && fp2.controller.kind === 'diesel-fire-pump-controller', 'FPC-2');
  assert(/wye-delta/i.test(fp1.controller.startingMethod ?? ''), '75 HP reduced-voltage starting');
  near(ps.maxStaticSuctionPsi, 5.2613, 0.1, 'max static suction');
  assert(!ps.mainReliefValve.required, '1.21×138 + 5.26 = 172.2 < 175 → no relief valve');
  assert(ps.jockey.ratedFlowGpm === 5, `jockey 5 gpm, got ${ps.jockey.ratedFlowGpm}`);
  assert(ps.jockey.ratedNetPressurePsi === 150, `jockey net 150 psi, got ${ps.jockey.ratedNetPressurePsi}`);
  assert(ps.jockey.motorHp === 1.5, `jockey motor 1.5 HP, got ${ps.jockey.motorHp}`);
  const sp = ps.setpoints;
  assert(sp.jockeyStopPsi === 139 && sp.jockeyStartPsi === 129 && sp.dutyStartPsi === 124 && sp.standbyStartPsi === 114,
    `setpoints 139/129/124/114, got ${sp.jockeyStopPsi}/${sp.jockeyStartPsi}/${sp.dutyStartPsi}/${sp.standbyStartPsi}`);
  assert(sp.minRunTimerElectricMin === 10 && sp.minRunTimerDieselMin === 30, 'min run timers');
  assert(ps.testHeaderIn === 4 && ps.testHeaderHoseValves === 2 && ps.flowMeterIn === 5, 'test header / meter');
  for (const id of ['suction-velocity', 'suction-pressure', 'flooded-suction', 'shutoff-ratio', 'ratio-150', 'rated-vs-demand', 'jockey-vs-sprinkler', 'components-rating']) {
    assert(check(ps.checks, id).status === 'pass', `check ${id} passes`);
  }

  // Relief valve trigger with 150 psi components
  const ps150 = selectPumpSet({ ...input, systemComponentRatingPsi: 150 }, demand);
  assert(ps150.mainReliefValve.required, 'relief valve required when 121 % churn exceeds 150 psi rating');
  assert(ps150.mainReliefValve.sizeIn === 3 && ps150.mainReliefValve.dischargeIn === 5, 'relief sizes from table');

  // Diesel derate: 2300 ft, 97 °F → 6 % + 2 % = 8 %
  const psAlt = selectPumpSet({ ...input, siteElevationFt: 2300, ambientTempF: 97 }, demand);
  near(psAlt.mainPumps[1].dieselDeratePercent ?? 0, 8, 0.01, 'diesel derate %');
  assert(psAlt.mainPumps[1].driverHp === 75, `67.08/0.92 = 72.9 → 75 HP, got ${psAlt.mainPumps[1].driverHp}`);

  // Suction lift → horizontal pump fails flooded-suction, auto picks vertical turbine
  const lift = { ...input, tankFloorToPumpCLm: -1.5 };
  assert(selectPumpSet(lift, demand).mainPumps[0].pumpType === 'vertical-turbine', 'auto VT under suction lift');
  assert(check(selectPumpSet({ ...lift, pumpTypePreference: 'horizontal-split-case' }, demand).checks, 'flooded-suction').status === 'fail', 'HSC with lift fails');

  // Arrangements
  assert(selectPumpSet({ ...input, arrangement: 'electric-only' }, demand).mainPumps.length === 1, 'electric-only');
  const dd = selectPumpSet({ ...input, arrangement: 'diesel+diesel' }, demand);
  assert(dd.mainPumps.every((p) => p.driver === 'diesel'), 'diesel+diesel');
  console.log('✓ pump selection, drivers, jockey, setpoints, relief, checks');
}

// 2. End-to-end default design
const result = designFireProtectionSystem(DEFAULT_FIRE_INPUT);
{
  const { demand, pumps, tank } = result;
  assert(demand.pumpDemandFlowGpm === 750, 'default demand 750 gpm (standpipe)');
  const fp1 = pumps.mainPumps[0];
  assert(fp1.ratedFlowGpm === 750 && fp1.ratedNetPressurePsi === 130, `750 gpm @ 130 psi, got ${fp1.ratedFlowGpm} @ ${fp1.ratedNetPressurePsi}`);
  near(fp1.maxBhp, 102.083, 0.2, 'default max BHP');
  assert(fp1.driverHp === 125 && pumps.mainPumps[1].driverHp === 115, 'motor 125 HP, diesel 115 HP');
  assert(pumps.mainPumps[1].fuelTankGal === 127, 'fuel 127 gal');
  assert(pumps.mainReliefValve.required, 'default: 1.21 × 156 + 5.26 > 175 → relief valve required');
  assert(pumps.mainReliefValve.setPressurePsi === 170, 'relief set 170 psi');
  assert(pumps.jockey.ratedFlowGpm === 10 && pumps.jockey.motorHp === 3, 'jockey 10 gpm, 3 HP');
  assert(pumps.setpoints.jockeyStopPsi === 157 && pumps.setpoints.standbyStartPsi === 132, 'default setpoints');

  // Tank
  assert(tank.requiredEffectiveGal === Math.ceil(demand.requiredStorageGal), 'tank required gal');
  near(tank.requiredEffectiveM3, 220.70, 0.2, 'required m³');
  assert(tank.compartments === 2, 'two compartments');
  assert(tank.internalWidthM === 6.1, `width 6.1 m, got ${tank.internalWidthM}`);
  assert(Math.abs(tank.internalLengthM - 12.5) < 1e-6, `length 2×6.1 + 0.30 divider = 12.5 m, got ${tank.internalLengthM}`);
  near(tank.providedEffectiveM3, 223.26, 0.05, 'provided m³');
  assert(tank.providedEffectiveM3 >= tank.requiredEffectiveM3, 'provided ≥ required');
  assert(tank.levels.overflowM === 3.1 && tank.levels.topWaterM === 3.2 && tank.levels.roofSoffitM === 3.5, 'levels');
  assert(Math.abs(tank.freeboardM - 0.3) < 1e-6, 'freeboard 0.30 m');
  assert(tank.wallThicknessMm === 300 && tank.floorThicknessMm === 350 && tank.roofThicknessMm === 250, 'RC thicknesses');
  const s = tank.sump;
  assert(s.suctionPipeIn === 6, 'sump suction 6"');
  assert(s.vortexPlateMm === 500 && s.vortexPlateMm >= 2 * s.suctionPipeOdMm, 'vortex plate 500 ≥ 2D');
  assert(s.inletAboveSumpFloorMm === 100, 'inlet above sump floor');
  assert(s.pitLengthMm === 900 && s.pitWidthMm === 900, `pit 900×900, got ${s.pitLengthMm}×${s.pitWidthMm}`);
  assert(s.plateCentreFromWallMm === 450, 'plate centre 450 from wall');
  assert(s.suctionCLBelowTankFloorMm === 500 && s.elbowDropMm === 168, 'suction CL / elbow drop');
  assert(s.pitDepthMm === 800, `pit depth 800, got ${s.pitDepthMm}`);
  const conn = (n: string): number => tank.connections.find((c) => c.name.toLowerCase().includes(n))!.sizeIn;
  assert(conn('fill') === 4 && conn('overflow') === 5 && conn('vent') === 5 && conn('drain') === 4, 'tank connections fill 4 / overflow 5 / vent 5 / drain 4');
  near(tank.refillHours, 58304 / 250 / 60, 0.1, 'refill hours');
  for (const id of ['tank-capacity', 'tank-refill', 'vortex-plate', 'tank-air-gap', 'overflow-size']) {
    assert(check(tank.checks, id).status === 'pass', `tank check ${id} passes`);
  }
  assert(tank.materialSpec.length >= 3, 'material spec lines');

  // GRP modules
  const grp = designTank({ ...DEFAULT_FIRE_INPUT, tankMaterial: 'grp-sectional' }, demand, pumps);
  assert(Number.isInteger(grp.internalWidthM) && grp.levels.roofSoffitM % 0.5 === 0, 'GRP 1 m modules / 0.5 m height');
  assert(grp.providedEffectiveM3 >= grp.requiredEffectiveM3, 'GRP capacity');
  console.log('✓ end-to-end pumps & tank');
}

// 3. Pump room layout invariants
{
  const room = result.room;
  const W = room.widthMm;
  const L = room.lengthMm;
  assert(L % 100 === 0 && W % 100 === 0, 'room dims rounded to 100 mm');
  assert(L >= 6000 && L <= 14000 && W >= 7000 && W <= 16000, `plausible room ${L}×${W}`);
  const eq = room.equipment;
  for (const tag of ['FP-1', 'FP-2', 'JP-1', 'FPC-1', 'FPC-2', 'JPC-1']) assert(eq.some((e) => e.tag === tag), `equipment ${tag}`);
  assert(eq.some((e) => e.kind === 'fuel-tank'), 'fuel tank placed (diesel)');
  assert(eq.some((e) => e.kind === 'drain-pit'), 'drain pit placed');
  for (const e of eq) assert(inside(e.pad ?? e.rect, L, W), `${e.tag} inside room`);
  const solids = eq.map((e) => ({ tag: e.tag, r: e.pad ?? e.rect }));
  for (let i = 0; i < solids.length; i++)
    for (let j = i + 1; j < solids.length; j++)
      assert(!overlaps(solids[i].r, solids[j].r), `no overlap ${solids[i].tag} / ${solids[j].tag}`);
  const fp1 = eq.find((e) => e.tag === 'FP-1')!;
  const fp2 = eq.find((e) => e.tag === 'FP-2')!;
  assert(fp2.pad!.y - (fp1.pad!.y + fp1.pad!.h) >= 900, 'clearance between pump pads ≥ 900 mm');
  assert(room.suctionLineY.length === 2 && Math.abs(room.suctionLineY[0] - fp1.suctionNozzle!.y) < 1e-6, 'suction line Y at nozzle');
  // Controllers on the east wall with working space
  for (const tag of ['FPC-1', 'FPC-2']) {
    const c = eq.find((e) => e.tag === tag)!;
    assert(Math.abs(c.rect.x + c.rect.w - L) < 1e-6, `${tag} against east wall`);
    assert(c.rect.x - room.headerX >= 1000, `${tag} ≥1000 mm working space from header`);
  }
  // Suction straight run ≥ 10 D
  const suct = room.pipes.filter((p) => p.service === 'suction');
  assert(suct.length >= 2, 'suction pipes per pump');
  assert(fp1.suctionNozzle!.x >= 10 * 6 * 25.4, 'suction length ≥ 10 D');
  assert(room.valves.some((v) => v.kind === 'os&y-gate' && v.service === 'suction'), 'OS&Y gate on suction');
  assert(!room.valves.some((v) => v.kind === 'butterfly' && v.service === 'suction'), 'no butterfly valve on suction (NFPA 20)');
  assert(room.valves.filter((v) => v.kind === 'eccentric-reducer').length === 2, 'eccentric reducer each pump');
  assert(room.valves.filter((v) => v.kind === 'check').length >= 3, 'check valves (2 main + jockey)');
  assert(room.valves.some((v) => v.kind === 'flow-meter'), 'flow meter');
  assert(room.valves.filter((v) => v.kind === 'hose-valve').length === result.pumps.testHeaderHoseValves, 'hose valves on test header');
  assert(room.valves.some((v) => v.kind === 'relief'), 'main relief valve placed (required in default)');
  assert(room.valves.filter((v) => v.kind === 'circulation-relief').length === 1, 'circulation relief on electric pump only');
  for (const svc of ['discharge', 'test', 'jockey', 'sensing', 'fuel', 'exhaust', 'relief'] as const) {
    assert(room.pipes.some((p) => p.service === svc), `pipe service ${svc}`);
  }
  // Trench
  const t = room.trench;
  assert(t.widthMm === 300 && t.slopePercent === 1, 'trench 300 mm @ 1 %');
  near(t.depthEndMm, t.depthStartMm + t.lengthMm * 0.01, 0.5, 'trench depth follows slope');
  assert(t.capacityGpm > t.designInflowGpm, 'trench capacity > inflow');
  for (const [x, y] of t.path) assert(x > 0 && x < L && y > 0 && y < W, 'trench inside room');
  assert(room.doors.length >= 1 && room.doors[0].widthMm >= 1800, 'double door');
  assert(room.louvers.length >= 2, 'louvers for diesel');
  assert(room.fireRatingHours === 1, 'non high-rise → 1 h');
  assert(room.elevations.pumpCLM === 0.6 && Math.abs(room.elevations.tankFloorM - 1.1) < 1e-9, 'elevations');
  for (const id of ['room-working-space', 'suction-straight-run', 'no-butterfly-on-suction', 'room-rating', 'room-heating', 'room-drainage', 'equipment-clearance']) {
    assert(check(room.checks, id).status === 'pass', `room check ${id} passes`);
  }
  // Layout recomputes directly
  const again = designPumpRoom(DEFAULT_FIRE_INPUT, result.pumps, result.tank);
  assert(again.lengthMm === L && again.widthMm === W, 'deterministic layout');
  console.log(`✓ pump room layout ${L} × ${W} mm`);
}

// 4. Aggregate + report
{
  assert(result.checks.length >= 20, 'aggregated checks');
  assert(!result.checks.some((c) => c.status === 'fail'), `no failing checks: ${result.checks.filter((c) => c.status === 'fail').map((c) => c.id)}`);
  assert(result.standardsReferences.length >= 10, 'standards references');
  const rep = buildFireCalcReport(result);
  for (const s of ['HYDRAULIC', 'FP-1', 'FP-2', 'JP-1', 'TANK', 'SUMP', 'PUMP ROOM', 'NFPA 20', 'PD']) assert(rep.toUpperCase().includes(s.toUpperCase()), `report contains ${s}`);
  assert(!rep.includes('NaN') && !rep.includes('undefined'), 'report clean');
  console.log('✓ aggregate & report');
}

console.log('\nAll fire pump / tank / room tests passed.');
