/**
 * Acceptance tests — portable fire extinguishers (NFPA 10-2022): hazard tables, catalog, coverage grid,
 * unit selection for classes A/B/C/D/K, placement, mounting, tags, totals, checks, engine & reports.
 * Expected values from an independent Python oracle following
 * docs/superpowers/plans/2026-11-01-portable-fire-extinguishers.md.
 */
import {
  coverageGrid,
  designExtinguisherZone,
  designExtinguishers,
  generateExtinguisherZonesFromFloors
} from '../fireProtection/extinguisherDesigner';
import { FE_HAZARD, FE_CATALOG, FE_MAX_AREA_PER_UNIT_FT2 } from '../fireProtection/standards/nfpa10';
import { designFireProtectionSystem } from '../fireProtection/fireProtectionEngine';
import { DEFAULT_FIRE_INPUT, SIMPLE_FIRE_INPUT } from '../fireProtection/defaults';
import { LEARNING_EXAMPLE_INPUT } from '../fireProtection/learningExample';
import { buildExtinguisherReport, buildFireCalcReport } from '../fireProtection/report';
import { DesignCheck, ExtinguisherZoneInput } from '../fireProtection/fpTypes';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion Failed: ${message}`);
}
function near(actual: number, expected: number, tolPct: number, label: string): void {
  const err = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-9);
  assert(err <= tolPct / 100, `${label}: expected ${expected} ±${tolPct}%, got ${actual}`);
}
const chk = (checks: DesignCheck[], id: string): DesignCheck => {
  const c = checks.find((k) => k.id === id);
  assert(!!c, `check "${id}" present (have ${checks.map((k) => k.id).join(', ')})`);
  return c!;
};
const zone = (p: Partial<ExtinguisherZoneInput>): ExtinguisherZoneInput => ({
  id: 'ZT', name: 'Test', floorId: 'GF', hazard: 'light', lengthM: 40, widthM: 30,
  classA: true, classB: 'none', deepLayerSurfaceM2: 0, classC: false, sensitiveElectronics: false,
  classD: false, dMetal: '', fryers: 0, maxFryerOilLb: 0, mounting: 'bracket', ...p
});

console.log('=== Portable Fire Extinguishers (NFPA 10) ===');

// 1. Standards tables & catalog
{
  assert(FE_HAZARD.light.minA === 2 && FE_HAZARD.light.areaPerAFt2 === 3000, 'light Class A');
  assert(FE_HAZARD.ordinary.areaPerAFt2 === 1500 && FE_HAZARD.extra.minA === 4 && FE_HAZARD.extra.areaPerAFt2 === 1000, 'ordinary / extra Class A');
  assert(FE_HAZARD.ordinary.bShort === 10 && FE_HAZARD.ordinary.bLong === 20 && FE_HAZARD.extra.bLong === 80 && FE_HAZARD.light.bShort === 5, 'Class B table');
  assert(FE_MAX_AREA_PER_UNIT_FT2 === 11250, '11 250 ft² max per extinguisher');
  assert(FE_CATALOG.length === 15, `15 catalog units, got ${FE_CATALOG.length}`);
  const abc10 = FE_CATALOG.find((u) => u.id === 'ABC-10')!;
  assert(abc10.aRating === 4 && abc10.bRating === 60 && abc10.cRated && abc10.ratingText === '4-A:60-B:C', 'ABC-10 rating');
  assert(abc10.hydroTestYears === 12 && abc10.internalExamYears === 6, 'dry chemical maintenance intervals');
  assert(FE_CATALOG.find((u) => u.id === 'CO2-10')!.hydroTestYears === 5, 'CO2 hydro 5 yr');
  assert(FE_CATALOG.find((u) => u.id === 'WETCHEM-6L')!.kRated && FE_CATALOG.find((u) => u.id === 'CLASSD-30')!.dRated, 'K / D units');
  console.log('✓ NFPA 10 tables & catalog');
}

// 2. Coverage grid
{
  const g = coverageGrid(40 * 3.28084, 30 * 3.28084, 75, 6000);
  assert(g.nx === 3 && g.ny === 1, `light 2-A office 40×30 m → 3×1, got ${g.nx}×${g.ny}`);
  const g2 = coverageGrid(40 * 3.28084, 30 * 3.28084, 50, 6000);
  assert(g2.nx === 2 && g2.ny === 2, `50 ft travel → 2×2, got ${g2.nx}×${g2.ny}`);
  near(g2.maxTravelActualFt, 41.0105, 0.01, 'half cell diagonal');
  const g3 = coverageGrid(32.8, 32.8, 30, Infinity, 2);
  assert(g3.nx * g3.ny === 2, 'minCount respected');
  console.log('✓ coverage grid');
}

// 3. Zone designs (oracle)
{
  const office = designExtinguisherZone(zone({ hazard: 'light' }));
  assert(office.selectedUnitId === 'ABC-10' && office.count === 2 && office.grid.nx === 2 && office.grid.ny === 1, `office 2 × ABC-10, got ${office.count} × ${office.selectedUnitId}`);
  near(office.maxTravelActualFt, 59.146, 0.01, 'office actual travel');
  assert(office.minARating === 2 && office.maxAreaPerUnitFt2 === 11250 && office.maxTravelFt === 75, 'office A requirement (4-A × 3000 capped at 11 250)');
  assert(office.candidates[0].unitId === 'ABC-10' && office.candidates.some((c) => c.unitId === 'ABC-5' && c.count === 3), 'candidates listed');
  const [e1, e2] = office.extinguishers;
  near(e1.xM, 10, 0.01, 'first unit x'); near(e1.yM, 15, 0.01, 'first unit y'); near(e2.xM, 30, 0.01, 'second unit x');
  assert(e1.mountingTopMm === 1200 && e1.bottomClearanceMm === 700 && e1.mounting === 'bracket' && e1.coverageRadiusFt === 75, 'mounting ≤ 40 lb');

  const parking = designExtinguisherZone(zone({ hazard: 'ordinary', classB: 'spill' }));
  assert(parking.selectedUnitId === 'ABC-10' && parking.count === 4 && parking.maxTravelFt === 50, `parking 4 × ABC-10 @ 50 ft, got ${parking.count} × ${parking.selectedUnitId}`);
  assert(parking.minBRating === 10 && (parking.bRequirement ?? '').includes('20-B @ 50 ft'), 'parking B requirement');
  const ys = parking.extinguishers.map((e) => e.yM);
  assert(ys[0] === ys[1] && ys[2] === ys[3] && ys[0] < ys[2], 'row-major placement');

  const elec = designExtinguisherZone(zone({ hazard: 'ordinary', lengthM: 6, widthM: 5, classC: true, sensitiveElectronics: true }));
  assert(elec.selectedUnitId === 'CLEAN-15.5' && elec.count === 1, `electrical room clean agent, got ${elec.selectedUnitId}`);
  assert(elec.candidates.every((c) => !c.unitId.startsWith('ABC')), 'no dry chemical on sensitive electronics');

  const pump = designExtinguisherZone(zone({ hazard: 'ordinary', lengthM: 13.8, widthM: 6.5, classB: 'spill', classC: true }));
  assert(pump.selectedUnitId === 'ABC-5' && pump.count === 1 && pump.maxTravelFt === 30, `pump room 1 × ABC-5 @ 30 ft, got ${pump.selectedUnitId} @ ${pump.maxTravelFt}`);

  const kitchen = designExtinguisherZone(zone({ hazard: 'ordinary', lengthM: 10, widthM: 10, fryers: 3, maxFryerOilLb: 50 }));
  assert(kitchen.selectedUnitId === 'ABC-5' && kitchen.count === 1 && kitchen.kUnits === 1, 'kitchen ABC-5 + 1 Class K');
  const k = kitchen.extinguishers.filter((e) => e.purpose === 'class-k');
  assert(k.length === 1 && k[0].unitId === 'WETCHEM-6L' && k[0].coverageRadiusFt === 30, 'Class K unit within 30 ft');
  assert(designExtinguisherZone(zone({ hazard: 'ordinary', lengthM: 10, widthM: 10, fryers: 5, maxFryerOilLb: 50 })).kUnits === 2, '5 fryers → 2 Class K');
  assert(chk(designExtinguisherZone(zone({ hazard: 'ordinary', lengthM: 10, widthM: 10, fryers: 1, maxFryerOilLb: 120 })).checks, 'fe-k:ZT').status === 'warn', 'fryer > 80 lb warns');

  const dip = designExtinguisherZone(zone({ hazard: 'ordinary', lengthM: 8, widthM: 6, classB: 'deep', deepLayerSurfaceM2: 0.25 }));
  assert(dip.selectedUnitId === 'ABC-10' && dip.minBRating === 54, `dip tank 54-B → ABC-10, got ${dip.minBRating} / ${dip.selectedUnitId}`);
  const bigDip = designExtinguisherZone(zone({ hazard: 'ordinary', lengthM: 8, widthM: 6, classB: 'deep', deepLayerSurfaceM2: 2 }));
  assert(bigDip.selectedUnitId === null && chk(bigDip.checks, 'fe-deep-b:ZT').status === 'fail', 'surface > 10 ft² → fixed system required');

  const wh = designExtinguisherZone(zone({ hazard: 'extra', lengthM: 60, widthM: 40, classB: 'spill' }));
  assert(wh.selectedUnitId === 'ABC-20' && wh.count === 6 && wh.grid.nx === 3 && wh.grid.ny === 2, `extra warehouse 6 × ABC-20, got ${wh.count} × ${wh.selectedUnitId}`);

  const lab = designExtinguisherZone(zone({ hazard: 'ordinary', lengthM: 12, widthM: 8, classD: true, dMetal: 'Magnesium' }));
  const d = lab.extinguishers.filter((e) => e.purpose === 'class-d');
  assert(lab.dUnits === 1 && d.length === 1 && d[0].unitId === 'CLASSD-30' && d[0].mountingTopMm === 1000 && d[0].bottomClearanceMm === 350, 'Class D 30 lb (> 40 lb → top 1000)');
  assert(chk(lab.checks, 'fe-d:ZT').detail.includes('Magnesium'), 'Class D check names the metal');
  console.log('✓ zone designs A / B spill / B deep / C / D / K');
}

// 4. Building design (default input) & engine
const result = designFireProtectionSystem(DEFAULT_FIRE_INPUT);
{
  const fe = result.extinguishers!;
  assert(!!fe && fe.zones.length === 13, `13 zones, got ${fe?.zones.length}`);
  const qty = (id: string): number => fe.totals.find((t) => t.unitId === id)?.qty ?? 0;
  assert(qty('ABC-10') === 20 && qty('ABC-5') === 4 && qty('CLEAN-15.5') === 1 && qty('WETCHEM-6L') === 1, `totals ${JSON.stringify(fe.totals.map((t) => [t.unitId, t.qty]))}`);
  assert(fe.totalCount === 26, `26 extinguishers, got ${fe.totalCount}`);
  assert(fe.totals.map((t) => t.unitId).join() === 'ABC-5,ABC-10,CLEAN-15.5,WETCHEM-6L', 'totals in catalog order');
  const tags = fe.zones.flatMap((z) => z.extinguishers.map((e) => e.tag));
  assert(new Set(tags).size === tags.length, 'tags unique');
  assert(fe.zones[0].extinguishers.map((e) => e.tag).join() === 'FE-B1-01,FE-B1-02,FE-B1-03,FE-B1-04', 'B1 parking tags');
  assert(fe.zones[2].extinguishers[0].tag === 'FE-B1-06', 'pump room tag continues on B1');
  assert(fe.zones[4].extinguishers.map((e) => e.tag).join() === 'FE-GF-03,FE-GF-04' && fe.zones[4].extinguishers[1].purpose === 'class-k', 'kitchen tags');
  assert(fe.floorsMissing.length === 0 && fe.floorsCovered.length === 10, 'every occupied floor covered');
  assert(fe.zones[1].extinguishers[0].mounting === 'cabinet', 'cabinet mounting kept');
  assert(chk(fe.checks, 'fe-every-floor').status === 'pass' && chk(fe.checks, 'fe-inspection').status === 'pass', 'system checks');
  assert(result.checks.some((c) => c.id === 'fe-travel:Z1') && result.checks.some((c) => c.id === 'fe-every-floor'), 'checks aggregated');
  assert(!result.checks.some((c) => c.status === 'fail'), `no failing checks: ${result.checks.filter((c) => c.status === 'fail').map((c) => c.id)}`);

  // Missing floor detection
  const zones = DEFAULT_FIRE_INPUT.extinguishers!.zones.filter((z) => z.floorId !== 'L3');
  const missing = designExtinguishers({ ...DEFAULT_FIRE_INPUT, extinguishers: { zones } })!;
  assert(missing.floorsMissing.join() === 'L3' && chk(missing.checks, 'fe-every-floor').status === 'fail', 'floor without extinguisher fails');

  assert(designFireProtectionSystem(SIMPLE_FIRE_INPUT).extinguishers === null, 'no extinguishers in simple input');
  console.log('✓ building design & engine');
}

// 5. Generator & learning example
{
  const z = generateExtinguisherZonesFromFloors(LEARNING_EXAMPLE_INPUT.building!);
  assert(z.length === 7 && z[0].id === 'Z-B1' && z[0].hazard === 'ordinary' && z[0].classB === 'spill', 'B1 parking zone');
  assert(z[1].hazard === 'light' && z[1].classB === 'none', 'lobby light');
  near(z[0].widthM, 26.0, 0.01, 'generated width'); near(z[0].lengthM, 34.6, 0.01, 'generated length');
  const lr = designFireProtectionSystem(LEARNING_EXAMPLE_INPUT);
  assert(!!lr.extinguishers && lr.extinguishers.floorsMissing.length === 0, 'learning example has extinguishers on every floor');
  console.log('✓ zone generator & learning example');
}

// 6. Reports
{
  const rep = buildExtinguisherReport(result).toUpperCase();
  for (const s of ['NFPA 10', 'FE-B1-01', 'ABC-10', '4-A:60-B:C', 'CLEAN-15.5', 'WETCHEM-6L', 'HYDROSTATIC', 'MONTHLY', 'TRAVEL', 'SCHEDULE', 'SPECIFICATION', '11250', 'KITCHEN']) {
    assert(rep.includes(s), `extinguisher report contains ${s}`);
  }
  assert(!rep.includes('NAN') && !rep.includes('UNDEFINED'), 'report clean');
  assert(buildFireCalcReport(result).toUpperCase().includes('PORTABLE FIRE EXTINGUISHERS'), 'main report section');
  console.log('✓ reports');
}

console.log('\nAll fire extinguisher tests passed.');
