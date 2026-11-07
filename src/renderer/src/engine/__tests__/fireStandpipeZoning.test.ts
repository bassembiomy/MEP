/**
 * Z1 — NFPA 14 standpipe pressure zoning: avoid PRVs (default), service-floor question, both solutions (with / without
 * PRVs) always calculated. Expected values from an independent Python oracle (plan 2026-11-07-standpipe-prv-zoning §Z1).
 */
import { designFireProtectionSystem } from '../fireProtection/fireProtectionEngine';
import { DEFAULT_FIRE_INPUT } from '../fireProtection/defaults';
import { buildFireCalcReport } from '../fireProtection/report';
import { DesignCheck, FireDesignInput, FloorLevel, StandpipeZone } from '../fireProtection/fpTypes';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`Assertion Failed: ${m}`);
}
const near = (a: number, e: number, tolPct: number, m: string): void =>
  assert(Math.abs(a - e) <= Math.max(Math.abs(e) * tolPct / 100, 1e-6), `${m}: expected ${e} ±${tolPct}%, got ${a}`);
const chk = (cs: DesignCheck[], id: string): DesignCheck => {
  const c = cs.find((k) => k.id === id);
  assert(!!c, `check ${id} present (${cs.map((k) => k.id).join(', ')})`);
  return c!;
};
const withSd = (over: Partial<NonNullable<FireDesignInput['standpipeDesign']>>, base: FireDesignInput = DEFAULT_FIRE_INPUT): FireDesignInput => ({
  ...base,
  standpipeDesign: { ...base.standpipeDesign!, ...over }
});
const zs = (zones: StandpipeZone[]): string =>
  zones.map((z) => `${z.id}:${z.station.kind}${z.station.floorId ? '@' + z.station.floorId : ''}:${z.floorIds[0]}-${z.floorIds[z.floorIds.length - 1]}`).join(' | ');

console.log('=== Standpipe zoning: avoid PRVs ===');
{
  // Default: strategy undefined → avoid; service-floor question not answered → warn and design without service floors
  assert(DEFAULT_FIRE_INPUT.standpipeDesign!.prvStrategy === undefined || DEFAULT_FIRE_INPUT.standpipeDesign!.prvStrategy === 'avoid', 'default strategy avoid');
  assert(DEFAULT_FIRE_INPUT.standpipeDesign!.serviceFloorIds == null, 'default leaves the service-floor question unanswered');
  const r = designFireProtectionSystem(DEFAULT_FIRE_INPUT);
  const sp = r.standpipe!;
  const zn = sp.zoning;
  assert(zn.strategy === 'avoid' && zn.selected === 'without-prv' && !zn.serviceFloorsAnswered, 'study flags');
  assert(chk(sp.checks, 'sp-service-floors').status === 'warn', 'service floors question → warn');
  assert(/service floor/i.test(chk(sp.checks, 'sp-service-floors').detail), 'service floor check text');
  // with-PRV solution = the classic single zone
  const w = zn.withPrv;
  assert(w.kind === 'with-prv' && w.zones.length === 1 && w.prvCount === 14 && w.pumpSets === 1 && w.expressRisers === 0, `with-PRV ${zs(w.zones)} prv ${w.prvCount}`);
  near(w.zones[0].requiredPressurePsi, 168.2403, 0.02, 'single-zone requirement');
  assert(w.zones[0].ratedNetPressurePsi === 170 && w.zones[0].station.kind === 'pump-room', 'single zone pump');
  near(w.maxStaticPsi, 207.6986, 0.02, 'with-PRV max static');
  // without-PRV solution: 3 zones (main pumps + 2 express risers)
  const n = zn.withoutPrv;
  assert(zs(n.zones) === 'Z1:pump-room:B1-GF | Z2:express:L1-L5 | Z3:express:L6-RF', `zones ${zs(n.zones)}`);
  assert(n.feasible && n.prvCount === 0 && n.pumpSets === 3 && n.expressRisers === 2 && n.suggestion === null, 'without-PRV summary');
  const [z1, z2, z3] = n.zones;
  near(z1.requiredPressurePsi, 120.8756, 0.02, 'Z1 req');
  near(z2.requiredPressurePsi, 148.0672, 0.02, 'Z2 req');
  near(z3.requiredPressurePsi, 167.3919, 0.02, 'Z3 req');
  assert(z1.ratedNetPressurePsi === 125 && z2.ratedNetPressurePsi === 150 && z3.ratedNetPressurePsi === 170, 'zone pump ratings');
  near(z2.maxStaticPsi, 171.6235, 0.02, 'Z2 max static');
  near(z3.maxStaticPsi, 170.0526, 0.02, 'Z3 max static');
  near(z3.churnDischargePsi, 209.2613, 0.02, 'Z3 churn discharge');
  near(z2.topResidualPsi, 101.0253, 0.05, 'Z2 top residual');
  assert(z2.expressRiserLengthM !== null && Math.abs(z2.expressRiserLengthM - 9.0) < 1e-6 && Math.abs(z3.expressRiserLengthM! - 27.0) < 1e-6, 'express riser lengths');
  assert(z1.expressRiserLengthM === null && z1.breakTank === null && z2.breakTank === null, 'no break tanks without service floors');
  assert(z3.rows.length > 0 && z3.rows[0].fromNode === 'ST-1-Z3-H1' && z3.rows[z3.rows.length - 1].toNode === 'PD-Z3', `Z3 rows ${z3.rows[0]?.fromNode} … ${z3.rows[z3.rows.length - 1]?.toNode}`);
  assert(z1.rows[0].fromNode === 'ST-1-H1' && z1.rows[z1.rows.length - 1].toNode === 'PD', 'Z1 rows keep the PD node');
  // the design follows the selected (no-PRV) solution
  assert(sp.risers.every((rr) => rr.outlets.every((o) => !o.prvRequired && o.prvSetPsi === null && o.staticPsi <= 175 + 1e-6)), 'no PRVs, all outlets ≤ 175 psi static');
  assert(sp.risers[0].outlets.map((o) => o.zoneId).join() === 'Z1,Z1,Z2,Z2,Z2,Z2,Z2,Z3,Z3,Z3,Z3', `ST-1 zone ids ${sp.risers[0].outlets.map((o) => o.zoneId)}`);
  for (const z of n.zones) {
    const top = sp.risers.flatMap((rr) => rr.outlets).filter((o) => o.zoneId === z.id).sort((a, b) => b.elevationM - a.elevationM)[0];
    assert(top.residualPsi >= 100 - 1e-6, `${z.id} top outlet residual ${top.residualPsi} ≥ 100 psi`);
    assert(sp.risers[0].outlets.some((o) => o.zoneId === z.id && o.flowing), `${z.id} has flowing outlets`);
  }
  near(sp.pressureAtPumpDischargePsi, 120.8756, 0.02, 'main pumps sized for zone 1');
  near(r.demand.standpipe.pressureAtPumpDischargePsi, 120.8756, 0.02, 'demand uses zone 1');
  assert(r.pumps.mainPumps[0].ratedNetPressurePsi === 125, `main pump 125 psi, got ${r.pumps.mainPumps[0].ratedNetPressurePsi}`);
  assert(sp.drainRiserIn === null && chk(sp.checks, 'sp-prv').status === 'pass' && /no pressure-regulating/i.test(chk(sp.checks, 'sp-prv').detail), 'no PRVs → no drain riser');
  assert(chk(sp.checks, 'sp-zoning').status === 'pass', 'zoning check');
  assert(chk(sp.checks, 'sp-express-riser').status === 'pass', 'express risers ≤ 350 psi');
  const rep = buildFireCalcReport(r).toUpperCase();
  for (const s of ['PRESSURE ZON', 'WITH PRV', 'WITHOUT PRV', 'EXPRESS', 'SERVICE FLOOR']) assert(rep.includes(s), `report "${s}"`);
  console.log('✓ default: no-PRV zoning selected, with-PRV alternative reported, service-floor question flagged');
}
{
  // Service floor answered: L4 → a booster station with a break tank, no express risers
  const r = designFireProtectionSystem(withSd({ serviceFloorIds: ['L4'] }));
  const zn = r.standpipe!.zoning;
  assert(zn.serviceFloorsAnswered && zn.serviceFloorIds.join() === 'L4', 'answered');
  assert(chk(r.standpipe!.checks, 'sp-service-floors').status === 'pass', 'service floors answered → pass');
  const n = zn.withoutPrv;
  assert(zs(n.zones) === 'Z1:pump-room:B1-L3 | Z2:service-floor@L4:L4-RF', `zones ${zs(n.zones)}`);
  assert(n.pumpSets === 2 && n.expressRisers === 0 && n.serviceFloorStations.join() === 'L4' && n.prvCount === 0, 'summary');
  const [z1, z2] = n.zones;
  near(z1.requiredPressurePsi, 137.8805, 0.02, 'Z1 req');
  near(z2.requiredPressurePsi, 138.4777, 0.02, 'Z2 req (service floor station, 10 m connection)');
  assert(z1.ratedNetPressurePsi === 140 && z2.ratedNetPressurePsi === 140, 'ratings');
  near(z2.maxStaticPsi, 169.9888, 0.02, 'Z2 max static');
  near(z2.station.pumpCLElevationM, 15.3, 0.01, 'booster CL = L4 FFL + 0.6 m');
  near(z2.station.suctionMaxPsi, 0.433 * 2.0 * 3.28084, 0.01, 'break tank max suction');
  assert(z2.station.suctionMinPsi === 0, 'break tank min suction 0');
  near(z2.breakTank!.volumeGal, 22500, 0.01, 'break tank 30 min × 750 gpm');
  near(z2.breakTank!.volumeM3, 22500 * 0.003785411784, 0.01, 'break tank m³');
  near(z2.breakTank!.nfpa20BreakTankGal, 16875, 0.01, 'NFPA 20 break tank 15 min × 150 %');
  assert(r.pumps.mainPumps[0].ratedNetPressurePsi === 140, 'main pump 140 psi');
  assert(r.standpipe!.risers.every((rr) => rr.outlets.every((o) => !o.prvRequired)), 'no PRVs');
  // two service floors: the lower one is used (lowest total pump pressure)
  const r2 = designFireProtectionSystem(withSd({ serviceFloorIds: ['L5', 'L2'] }));
  assert(zs(r2.standpipe!.zoning.withoutPrv.zones) === 'Z1:pump-room:B1-L3 | Z2:service-floor@L2:L4-RF', `zones ${zs(r2.standpipe!.zoning.withoutPrv.zones)}`);
  near(r2.standpipe!.zoning.withoutPrv.zones[1].requiredPressurePsi, 148.7061, 0.02, 'L2 station requirement');
  // explicit "no service floors"
  const r3 = designFireProtectionSystem(withSd({ serviceFloorIds: [] }));
  assert(r3.standpipe!.zoning.serviceFloorsAnswered && chk(r3.standpipe!.checks, 'sp-service-floors').status === 'pass', '[] = answered, none');
  console.log('✓ service floors: break-tank booster stations');
}
{
  // Allow PRVs: classic single zone selected; the no-PRV alternative is still calculated
  const r = designFireProtectionSystem(withSd({ prvStrategy: 'allow' }));
  const sp = r.standpipe!;
  assert(sp.zoning.selected === 'with-prv' && sp.zoning.withoutPrv.zones.length === 3, 'allow → with-PRV selected, alternative kept');
  assert(r.pumps.mainPumps[0].ratedNetPressurePsi === 170, 'single zone pump 170 psi');
  const prvFloors = sp.risers[0].outlets.filter((o) => o.prvRequired).map((o) => o.floorId);
  assert(prvFloors.join() === 'B1,GF,L1,L2,L3,L4,L5', `PRV floors ${prvFloors}`);
  assert(sp.risers[0].outlets.every((o) => o.zoneId === 'Z1') && sp.drainRiserIn === 3, 'single zone, drain riser');
  assert(chk(sp.checks, 'sp-zoning').status === 'warn', 'PRVs used although they can be avoided → warn');
  console.log('✓ allow PRVs');
}
{
  // Tall building (30 levels): without service floors PRVs cannot all be avoided → suggestion; with L10 & L20 they can
  const floors: FloorLevel[] = [
    { id: 'B1', name: 'Basement 1', elevationM: -4, floorToFloorM: 4, usage: 'Parking', areaM2: 1200, sprinklered: true, hoseConnection: true, isRoof: false },
    { id: 'GF', name: 'Ground Floor', elevationM: 0, floorToFloorM: 4.5, usage: 'Lobby', areaM2: 1200, sprinklered: true, hoseConnection: true, isRoof: false },
    ...Array.from({ length: 30 }, (_, i) => ({ id: `L${i + 1}`, name: `Level ${i + 1}`, elevationM: Math.round((4.5 + 3.6 * i) * 1000) / 1000, floorToFloorM: 3.6, usage: 'Office', areaM2: 1200, sprinklered: true, hoseConnection: true, isRoof: false })),
    { id: 'RF', name: 'Roof', elevationM: 112.5, floorToFloorM: 0, usage: 'Roof', areaM2: 1200, sprinklered: false, hoseConnection: false, isRoof: true }
  ];
  const tall: FireDesignInput = { ...DEFAULT_FIRE_INPUT, building: { ...DEFAULT_FIRE_INPUT.building!, floors } };
  const none = designFireProtectionSystem(withSd({ serviceFloorIds: [] }, tall)).standpipe!.zoning;
  near(none.withPrv.zones[0].requiredPressurePsi, 283.2876, 0.05, 'tall single zone');
  const nz = none.withoutPrv;
  assert(!nz.feasible && nz.prvCount === 23 && nz.zones.length === 7, `tall none: feasible ${nz.feasible} prv ${nz.prvCount} zones ${nz.zones.length}`);
  assert(nz.zones[6].floorIds[0] === 'L20' && !nz.zones[6].feasible && nz.zones[6].prvOutlets === 23, `last zone ${zs(nz.zones)}`);
  assert(!!nz.suggestion && nz.suggestion.includes('L20'), `suggestion ${nz.suggestion}`);
  const two = designFireProtectionSystem(withSd({ serviceFloorIds: ['L10', 'L20'] }, tall));
  const tz = two.standpipe!.zoning.withoutPrv;
  assert(zs(tz.zones) === 'Z1:pump-room:B1-GF | Z2:express:L1-L5 | Z3:express:L6-L9 | Z4:service-floor@L10:L10-L14 | Z5:service-floor@L10:L15-L20 | Z6:service-floor@L20:L21-L26 | Z7:service-floor@L20:L27-RF', `tall zones ${zs(tz.zones)}`);
  assert(tz.feasible && tz.prvCount === 0 && tz.expressRisers === 2 && tz.serviceFloorStations.join() === 'L10,L20', 'tall with service floors');
  near(tz.zones[4].requiredPressurePsi, 164.0486, 0.02, 'Z5 req');
  near(tz.zones[6].maxStaticPsi, 170.1896, 0.02, 'Z7 max static');
  assert(two.standpipe!.risers.every((rr) => rr.outlets.every((o) => !o.prvRequired)), 'tall: no PRVs');
  // flat-curve zone pumps (shutoff 110 %) give taller zones
  const flat = designFireProtectionSystem(withSd({ serviceFloorIds: ['L10', 'L20'], zonePumpShutoffRatio: 1.1 }, tall)).standpipe!.zoning.withoutPrv;
  assert(flat.feasible && flat.zones.length < tz.zones.length, `flat-curve pumps: ${flat.zones.length} zones`);
  console.log('✓ tall building, suggestion, flat-curve zone pumps');
}
console.log('\nAll standpipe zoning tests passed.');
