/**
 * Acceptance tests — NFPA 14 standpipe system: floor data, node-to-node hydraulics per floor,
 * governing riser, outlet static/residual pressures, PRVs, FDC, checks, engine integration.
 * Expected values from an independent Python oracle following
 * docs/superpowers/plans/2026-10-31-standpipe-system-design.md exactly.
 */
import { designFireProtectionSystem } from '../fireProtection/fireProtectionEngine';
import { DEFAULT_FIRE_INPUT, SIMPLE_FIRE_INPUT } from '../fireProtection/defaults';
import {
  standpipeApplicable,
  pumpCenterlineAbsM,
  derivedSprinklerRiser,
  designStandpipeHydraulics
} from '../fireProtection/standpipeDesigner';
import { equivalentLengthFt } from '../fireProtection/standards/nfpa13';
import { standpipeMinRiserSizeIn, standpipeOutletSizeIn } from '../fireProtection/standards/nfpa14';
import { pumpCenterlineHeightM } from '../fireProtection/pumpRoomDesigner';
import { buildFireCalcReport } from '../fireProtection/report';
import { DesignCheck, FireDesignInput } from '../fireProtection/fpTypes';

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

console.log('=== Fire Standpipe System (NFPA 14) ===');

// 1. Data & standards helpers
{
  const b = DEFAULT_FIRE_INPUT.building!;
  const sd = DEFAULT_FIRE_INPUT.standpipeDesign!;
  assert(b.floors.length === 11, `11 levels (B1, GF, L1–L8, RF), got ${b.floors.length}`);
  assert(b.floors[0].id === 'B1' && b.floors[10].id === 'RF' && b.floors[10].isRoof, 'floor order');
  near(b.floors[9].elevationM, 29.7, 0.01, 'L8 FFL');
  assert(b.pumpRoomFloorElevationM === -4.5 && sd.locations.length === 2, 'building / locations');
  assert(DEFAULT_FIRE_INPUT.systemComponentRatingPsi === 300, 'high-rise default uses 300 psi components');
  assert(SIMPLE_FIRE_INPUT.building === undefined && SIMPLE_FIRE_INPUT.systemComponentRatingPsi === 175, 'simple input preserved');
  near(equivalentLengthFt('angle-hose-valve', 2.5, 120, 'sch40'), 30.8625, 0.01, 'angle hose valve L/D 150');
  assert(standpipeMinRiserSizeIn('I', true) === 6 && standpipeMinRiserSizeIn('I', false) === 4 && standpipeMinRiserSizeIn('II', false) === 2, 'min riser');
  assert(standpipeOutletSizeIn('I') === 2.5 && standpipeOutletSizeIn('II') === 1.5, 'outlet size');
  assert(pumpCenterlineHeightM(750) === 0.6 && pumpCenterlineHeightM(2000) === 0.75, 'pump CL height');
  assert(standpipeApplicable(DEFAULT_FIRE_INPUT) && !standpipeApplicable(SIMPLE_FIRE_INPUT), 'applicability');
  near(pumpCenterlineAbsM(DEFAULT_FIRE_INPUT, 750), -3.9, 0.01, 'pump CL absolute');
  const r = derivedSprinklerRiser(DEFAULT_FIRE_INPUT, -3.9);
  near(r.elevationRiseFt, 36.9 * 3.28084, 0.01, 'derived sprinkler riser rise');
  assert(r.lengthFt === r.elevationRiseFt && r.pipe.nominalIn === 6, 'derived riser length = rise, pipe kept');
  console.log('✓ floor data & helpers');
}

// 2. Hydraulics (oracle)
{
  const sp = designStandpipeHydraulics(DEFAULT_FIRE_INPUT, -3.9);
  assert(sp.applicable && sp.standpipeClass === 'I' && sp.combined, 'design basis');
  assert(sp.riserSizeIn === 6 && sp.minRiserSizeIn === 6 && sp.supplyMainSizeIn === 6, 'riser / main 6"');
  assert(sp.demandFlowGpm === 750, `Q = 500 + 250 = 750, got ${sp.demandFlowGpm}`);
  const st1 = sp.risers.find((r) => r.tag === 'ST-1')!;
  const st2 = sp.risers.find((r) => r.tag === 'ST-2')!;
  assert(st1.hasRoofOutlet && !st2.hasRoofOutlet, 'roof outlet on the stair with roof access');
  assert(st1.outlets.length === 11 && st2.outlets.length === 10, `outlets ST-1 11 / ST-2 10, got ${st1.outlets.length}/${st2.outlets.length}`);
  assert(st1.outlets[0].floorId === 'B1' && st1.outlets[10].isRoofOutlet, 'outlets ordered bottom → top');
  near(st1.outlets[10].elevationM, 34.5, 0.01, 'roof outlet elevation');
  near(st1.requiredPressureAtPumpPsi, 168.2403, 0.1, 'ST-1 required pressure at pump');
  near(st2.requiredPressureAtPumpPsi, 164.0276, 0.1, 'ST-2 required pressure at pump');
  assert(sp.governingRiserTag === 'ST-1', 'governing riser ST-1 (roof outlet)');
  near(sp.pressureAtPumpDischargePsi, 168.2403, 0.1, 'standpipe pressure at pump');
  assert(sp.rows.length === 13, `13 rows (H1, 10 riser, base, main), got ${sp.rows.length}`);
  const [h1] = sp.rows;
  assert(h1.fromNode === 'ST-1-H1' && h1.toNode === 'ST-1-S1' && h1.ptStartPsi === 100, 'H1 row at 100 psi');
  near(h1.ptEndPsi, 109.4484, 0.05, 'hose valve + tee loss');
  near(sp.rows[1].ptEndPsi, 114.5945, 0.05, 'S1 → S2');
  assert(sp.rows[1].totalFlowGpm === 250 && sp.rows[2].totalFlowGpm === 500 && sp.rows[2].flowAddedGpm === 250, 'second outlet flow added at S2');
  const base = sp.rows[11];
  assert(base.toNode === 'ST-1-SB', `base row, got ${base.toNode}`);
  near(base.ptEndPsi, 165.4275, 0.05, 'riser base pressure');
  const main = sp.rows[12];
  assert(main.fromNode === 'ST-1-SB' && main.toNode === 'PD' && main.totalFlowGpm === 750 && main.flowAddedGpm === 250, 'supply main adds ST-2 flow');
  for (let i = 1; i < sp.rows.length; i++) assert(Math.abs(sp.rows[i].ptStartPsi - sp.rows[i - 1].ptEndPsi) < 1e-6, `continuity ${sp.rows[i].fromNode}`);
  assert(st1.floorControlValveFloors.length === 10 && st2.floorControlValveFloors.length === 0, 'floor control valves on ST-1 sprinklered floors');
  console.log('✓ node-to-node standpipe hydraulics');
}

// 3. Engine integration (standpipe governs the pumps)
const result = designFireProtectionSystem(DEFAULT_FIRE_INPUT);
{
  const sp = result.standpipe!;
  assert(!!sp, 'result.standpipe present');
  assert(result.input.standpipeCount === 2, 'standpipe count from locations');
  assert(result.demand.governingCase === 'standpipe' && result.demand.pumpDemandFlowGpm === 750, 'standpipe governs');
  near(result.demand.pumpDemandPressurePsi, 168.2403, 0.1, 'pump demand pressure');
  assert(result.demand.sprinkler.pressureAtPumpDischargePsi < result.demand.pumpDemandPressurePsi, 'sprinkler below standpipe');
  near(result.demand.sprinkler.rows.find((r) => r.fromNode === 'RT')!.elevationFt, 121.063, 0.05, 'sprinkler riser from building');
  const fp1 = result.pumps.mainPumps[0];
  assert(fp1.ratedFlowGpm === 750 && fp1.ratedNetPressurePsi === 170, `750 gpm @ 170 psi, got ${fp1.ratedFlowGpm} @ ${fp1.ratedNetPressurePsi}`);
  near(fp1.maxBhp, 133.49, 0.2, 'max BHP');
  assert(fp1.driverHp === 150 && result.pumps.mainPumps[1].driverHp === 140, 'motor 150 HP / diesel 140 HP');
  near(result.pumps.maxSystemPressurePsi, 209.2613, 0.05, 'max system pressure');
  assert(!result.pumps.mainReliefValve.required, '1.21 × 204 + 5.3 < 300 → no relief valve');
  assert(result.room.fireRatingHours === 2, 'high-rise → 2-h pump room');
  assert(sp.highRise && Math.abs(sp.buildingHeightFt - 29.7 * 3.28084) < 0.01, 'high-rise 97.4 ft');
  console.log('✓ engine integration');
}

// 4. Outlet pressures, PRVs, FDC, checks
{
  const sp = result.standpipe!;
  const st1 = sp.risers.find((r) => r.tag === 'ST-1')!;
  const st2 = sp.risers.find((r) => r.tag === 'ST-2')!;
  const b1 = st1.outlets[0];
  near(b1.staticPsi, 207.70, 0.05, 'B1 outlet static');
  near(st1.outlets[6].staticPsi, 175.17, 0.05, 'L5 outlet static');
  near(st1.outlets[10].staticPsi, 154.71, 0.05, 'roof outlet static');
  const prvFloors = (r: typeof st1): string[] => r.outlets.filter((o) => o.prvRequired).map((o) => o.floorId);
  assert(JSON.stringify(prvFloors(st1)) === JSON.stringify(['B1', 'GF', 'L1', 'L2', 'L3', 'L4', 'L5']), `ST-1 PRV floors ${prvFloors(st1)}`);
  assert(JSON.stringify(prvFloors(st2)) === JSON.stringify(['B1', 'GF', 'L1', 'L2', 'L3', 'L4', 'L5']), `ST-2 PRV floors ${prvFloors(st2)}`);
  assert(st1.outlets.filter((o) => o.prvRequired).every((o) => o.prvSetPsi === 175), 'PRV set 175 psi');
  assert(st1.outlets.filter((o) => !o.prvRequired).every((o) => o.prvSetPsi === null), 'no set pressure without PRV');
  const flowing = sp.risers.flatMap((r) => r.outlets).filter((o) => o.flowing);
  assert(flowing.length === 2 && flowing.every((o) => o.standpipeTag === 'ST-1' && o.flowGpm === 250), 'two flowing outlets on ST-1');
  assert(flowing.some((o) => o.isRoofOutlet) && flowing.some((o) => o.floorId === 'L8'), 'roof + L8 flowing');
  for (const r of sp.risers)
    for (const o of r.outlets) {
      assert(o.residualPsi < o.staticPsi, `residual < static at ${r.tag} ${o.floorId}`);
      assert(o.sizeIn === 2.5, 'Class I 2½" outlets');
    }
  const roof = st1.outlets[10];
  assert(roof.residualPsi >= 100, `top outlet residual ≥ 100 psi with the selected pump, got ${roof.residualPsi}`);
  assert(sp.fdc.inlets === 3 && sp.fdc.inletSizeIn === 2.5 && sp.fdc.pipeSizeIn === 6 && sp.fdc.heightAboveGradeMm === 900, 'FDC');
  assert(sp.drainRiserIn === 3 && sp.mainDrainIn === 2, 'drain riser with PRVs');
  for (const id of ['sp-riser-size', 'sp-hose-connections', 'sp-roof-outlet', 'sp-top-residual', 'sp-max-pressure', 'sp-components', 'sp-prv', 'sp-drain-riser', 'sp-zone-height', 'sp-fdc', 'sp-hose-valve-height', 'sp-high-rise']) {
    assert(check(sp.checks, id).status === 'pass', `standpipe check ${id} passes: ${check(sp.checks, id).detail}`);
  }
  assert(result.checks.some((c) => c.id === 'sp-prv'), 'standpipe checks aggregated');
  assert(!result.checks.some((c) => c.status === 'fail'), `no failing checks: ${result.checks.filter((c) => c.status === 'fail').map((c) => c.id)}`);
  console.log('✓ outlet pressures, PRVs, FDC, checks');
}

// 5. Negative / variant checks
{
  const lowRating = designFireProtectionSystem({ ...DEFAULT_FIRE_INPUT, systemComponentRatingPsi: 175 });
  assert(check(lowRating.standpipe!.checks, 'sp-components').status === 'fail', '175 psi components fail in this high-rise');
  const badHeight: FireDesignInput = { ...DEFAULT_FIRE_INPUT, standpipeDesign: { ...DEFAULT_FIRE_INPUT.standpipeDesign!, hoseValveHeightMm: 1700 } };
  assert(check(designFireProtectionSystem(badHeight).standpipe!.checks, 'sp-hose-valve-height').status === 'fail', 'hose valve above 1500 mm fails');
  const small: FireDesignInput = { ...DEFAULT_FIRE_INPUT, standpipeDesign: { ...DEFAULT_FIRE_INPUT.standpipeDesign!, riserSizeIn: 4 } };
  assert(check(designFireProtectionSystem(small).standpipe!.checks, 'sp-riser-size').status === 'fail', '4" combined riser fails');
  const none = designFireProtectionSystem({ ...DEFAULT_FIRE_INPUT, standpipeClass: 'none' });
  assert(none.standpipe === null, 'no standpipe when class none');
  const simple = designFireProtectionSystem(SIMPLE_FIRE_INPUT);
  assert(simple.standpipe === null && simple.pumps.mainPumps[0].ratedNetPressurePsi === 130, 'simple path unchanged (130 psi)');
  const one: FireDesignInput = { ...DEFAULT_FIRE_INPUT, standpipeDesign: { ...DEFAULT_FIRE_INPUT.standpipeDesign!, locations: [DEFAULT_FIRE_INPUT.standpipeDesign!.locations[0]] } };
  const r1 = designFireProtectionSystem(one);
  assert(r1.standpipe!.demandFlowGpm === 500 && r1.standpipe!.rows[12].flowAddedGpm === 0, 'single standpipe 500 gpm');
  console.log('✓ variants');
}

// 6. Report
{
  const rep = buildFireCalcReport(result).toUpperCase();
  for (const s of ['STANDPIPE SYSTEM', 'ST-1-H1', 'ST-1-SB', 'PRV', 'FIRE DEPARTMENT CONNECTION', 'LEVEL 8', 'ROOF']) assert(rep.includes(s), `report contains ${s}`);
  assert(!rep.includes('NAN') && !rep.includes('UNDEFINED'), 'report clean');
  console.log('✓ report');
}

console.log('\nAll fire standpipe tests passed.');
