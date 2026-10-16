import { calculateZoneLoad } from '../loadCalc';
import { ASHRAE_SPACE_TYPES, SPACE_TYPE_BY_ID } from '../knowledgeBase';
import { ASHRAE_62_1_VENTILATION_RATES, getVentilationRates, calculateBreathingZoneVentilation } from '../standards/ventilationRules';
import { distributeLoadsAcrossZones } from '../zoning/loadDistribution';
import { calculateSolarLoadWeights } from '../zoning/solarLoadWeighting';
import { Zone, ProjectMetadata } from '../../store/projectStore';

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion Failed: ${m}`); }
function near(a: number, b: number, tol: number, m: string): void {
  assert(Math.abs(a - b) <= tol, `${m}: got ${a}, expected ${b} +/- ${tol}`);
}

const imp: ProjectMetadata = { name: 't', location: 'x', scale: 10, units: 'imperial', outdoorDb: 95, indoorDb: 75 } as ProjectMetadata;
const rect = (wFt: number, hFt: number, scale: number): number[] => [0, 0, wFt * scale, 0, wFt * scale, hFt * scale, 0, hFt * scale];
const mk = (over: Record<string, unknown>, pts: number[]): Zone => ({
  id: 'z', name: 'z', points: pts, spaceTypeId: 'office', ceilingHeight: 10, occupants: 0, diffusers: [], ducts: [], ...over
} as unknown as Zone);

console.log('=== Loads & Ventilation validation ===');

// 1. density applies when occupants unset/0; explicit value honoured
{
  const z = mk({ spaceTypeId: 'conference' }, rect(25, 40, 10)); // 1000 ft2
  const r = calculateZoneLoad(z, imp);
  near(r.area, 1000, 1, 'area'); assert(r.occupants === 50, `conference 1000ft2 => 50 people, got ${r.occupants}`);
  near(r.vbzCfm, 5 * 50 + 0.06 * 1000, 1, 'conference Vbz');
  const z2 = mk({ spaceTypeId: 'conference', occupants: 12 }, rect(25, 40, 10));
  assert(calculateZoneLoad(z2, imp).occupants === 12, 'explicit occupants honoured');
  const z3 = mk({ spaceTypeId: 'conference', occupants: undefined }, rect(25, 40, 10));
  assert(calculateZoneLoad(z3, imp).occupants === 50, 'undefined occupants => density');
  console.log('1 ok');
}

// 2. OA excluded from supply CFM, included in coil load
{
  const z = mk({ spaceTypeId: 'office' }, rect(30, 30, 10));
  const r = calculateZoneLoad(z, imp);
  near(r.thermalCfm, r.roomSensibleBtuh! / (1.08 * 20), 1, 'thermal CFM = Qs_room/(1.08*20)');
  near(r.supplyCfm, Math.max(r.thermalCfm, r.vozCfm, 100), 1, 'supply');
  near(r.oaSensibleBtuh!, 1.08 * r.vozCfm * 20, 5, 'OA sensible');
  near(r.oaLatentBtuh!, 4840 * r.vozCfm * 0.005, 5, 'OA latent');
  near(r.coilTotalBtuh!, r.roomSensibleBtuh! + r.roomLatentBtuh! + r.oaSensibleBtuh! + r.oaLatentBtuh!, 3, 'coil total');
  assert(r.totalLoad === r.coilTotalBtuh, 'totalLoad == coilTotal');
  const withOaCfm = (r.roomSensibleBtuh! + r.oaSensibleBtuh!) / (1.08 * 20);
  assert(r.thermalCfm < withOaCfm, 'supply no longer inflated by OA');
  console.log('2 ok');
}

// 3. metric ventilation
{
  const met: ProjectMetadata = { ...imp, units: 'metric', scale: 10, outdoorDb: 35, indoorDb: 24 };
  const z = mk({ spaceTypeId: 'office', occupants: 5 }, rect(8.63, 10, 10)); // 86.3 m2 at 10 px/m
  const r = calculateZoneLoad(z, met);
  near(r.area, 86.3, 0.2, 'metric area m2');
  near(r.vbzCfm, 38.1, 0.2, 'metric Vbz L/s');
  console.log('3 ok');
}

// 4. canonical table
{
  near(SPACE_TYPE_BY_ID['retail'].ra, 0.12, 1e-9, 'retail Ra');
  near(ASHRAE_62_1_VENTILATION_RATES['retail'].areaRateCfmPerSqFt, 0.12, 1e-9, 'retail Ra (rules)');
  assert(ASHRAE_62_1_VENTILATION_RATES['classroom'].defaultOccupantDensityPer1000SqFt === 35, 'classroom density 35');
  assert(SPACE_TYPE_BY_ID['classroom'].density === 35, 'classroom kb density 35');
  const lob = getVentilationRates('lobby'); assert(lob.peopleRateCfmPerPerson === 5 && lob.defaultOccupantDensityPer1000SqFt === 10, 'lobby 5 / 10');
  const cor = getVentilationRates('Corridor'); assert(cor.peopleRateCfmPerPerson === 0 && cor.areaRateCfmPerSqFt === 0.06, 'corridor Rp0 Ra0.06');
  const rr = getVentilationRates('Restroom'); assert(rr.exhaustOnly === true && rr.peopleRateCfmPerPerson === 0, 'restroom is exhaust-only, not dining');
  const dn = getVentilationRates('Restaurant dining'); near(dn.areaRateCfmPerSqFt, 0.18, 1e-9, 'dining Ra');
  for (const [k, v] of Object.entries(ASHRAE_62_1_VENTILATION_RATES)) {
    assert(ASHRAE_SPACE_TYPES.some(t => t.rp === v.peopleRateCfmPerPerson && t.ra === v.areaRateCfmPerSqFt && t.density === v.defaultOccupantDensityPer1000SqFt), `rules[${k}] mirrors knowledgeBase`);
  }
  assert(calculateBreathingZoneVentilation(50, 1000, 'conference-meeting') === 310, 'Vbz conf 310');
  console.log('4 ok');
}

// 5. toilets exhaust + unknown-type warning
{
  const pub = calculateZoneLoad(mk({ spaceTypeId: 'toilet-public' }, rect(10, 10, 10)), imp);
  near(pub.exhaustCfm, 200, 1, 'public toilet 2 cfm/ft2 x 100 ft2');
  const prv = calculateZoneLoad(mk({ spaceTypeId: 'toilet-private' }, rect(5, 5, 10)), imp);
  near(prv.exhaustCfm, 25, 1, 'private toilet min 25');
  const unk = calculateZoneLoad(mk({ spaceTypeId: 'nope' }, rect(10, 10, 10)), imp);
  assert((unk.warnings ?? []).some(w => w.includes('nope')), 'unknown space type flagged');
  assert(!calculateZoneLoad(mk({}, rect(10, 10, 10)), imp).warnings, 'no warnings for valid input');
  console.log('5 ok');
}

// 6. computer lab equipment
near(SPACE_TYPE_BY_ID['computer-lab'].equipmentDensity, 4, 1e-9, 'computer lab W/ft2');

// 7. glazing + roof flag
{
  const base = calculateZoneLoad(mk({}, rect(30, 30, 10)), imp);
  const g = calculateZoneLoad(mk({ glassAreaSqFt: 100 }, rect(30, 30, 10)), imp);
  const dWall = -0.34 * 100 * 20; // wall area displaced by glass
  const expected = dWall + 0.55 * 100 * 20 + 0.4 * 100 * 60;
  near(g.roomSensibleBtuh! - base.roomSensibleBtuh!, expected, 5, 'glass delta');
  const noRoof = calculateZoneLoad(mk({ hasRoof: false }, rect(30, 30, 10)), imp);
  near(base.roomSensibleBtuh! - noRoof.roomSensibleBtuh!, 0.10 * 900 * 20, 5, 'roof delta');
  console.log('7 ok');
}

// 8. scale 0 / NaN
{
  for (const sc of [0, NaN, -5]) {
    const r = calculateZoneLoad(mk({}, rect(20, 20, 10)), { ...imp, scale: sc });
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number') assert(Number.isFinite(v), `${k} finite at scale ${sc}`);
    assert((r.warnings ?? []).length > 0, 'scale warning');
  }
  console.log('8 ok');
}

// 9. load distribution
{
  const s = distributeLoadsAcrossZones({ totalSensibleBtu: 90000, totalLatentBtu: 30000, totalCfm: 3000, totalOutdoorAirCfm: 600, weights: [0.5, 0.3, 0.3], totalExhaustCfm: 300 });
  near(s.reduce((a, x) => a + x.supplyCfm, 0), 3000, 0, 'cfm conserved');
  near(s.reduce((a, x) => a + x.returnCfm, 0), 2700, 3, 'return = supply - exhaust');
  const bad = distributeLoadsAcrossZones({ totalSensibleBtu: 1000, totalLatentBtu: 0, totalCfm: 100, totalOutdoorAirCfm: 10, weights: [-1, 0, 0] });
  near(bad.reduce((a, x) => a + x.supplyCfm, 0), 100, 0, 'degenerate weights uniform');
  assert(bad.every(x => x.returnCfm >= 0 && x.supplyCfm >= 0 && x.sensibleBtu >= 0), 'never negative');
  const noEx = distributeLoadsAcrossZones({ totalSensibleBtu: 100, totalLatentBtu: 0, totalCfm: 100, totalOutdoorAirCfm: 0, weights: [1] });
  assert(noEx[0].returnCfm === 100, 'no magic 0.88');
  console.log('9 ok');
}

// 10. solar weights
{
  for (const n of [2, 3, 4, 7]) {
    const w = calculateSolarLoadWeights({ unitCount: n, exteriorWalls: [{ side: 'south', glassRatio: 0.5 }, { side: 'west', glassRatio: 0.4 }, { side: 'north', glassRatio: 0.3 }] });
    near(w.reduce((a, b) => a + b, 0), 1, 1e-9, `weights sum n=${n}`);
    assert(w.every(x => x >= 0), 'non-negative');
  }
  const flat = calculateSolarLoadWeights({ unitCount: 3, exteriorWalls: [] });
  const north = calculateSolarLoadWeights({ unitCount: 3, exteriorWalls: [{ side: 'north', glassRatio: 0.5 }] });
  assert(north[1] > flat[1] && north[1] < 0.4, 'north has small non-zero effect');
  console.log('10 ok');
}

console.log('=== Loads & Ventilation tests passed ===');
