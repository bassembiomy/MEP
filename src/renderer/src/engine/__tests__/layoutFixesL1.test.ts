import { executeAirDistributionDesign, convertDesignResultToZonePayload, plantConnectionFor } from '../airDistributionEngine';
import { generateSystemCandidates } from '../systemDesigner';
import { isPointInPolygon } from '../geometry';
import { parseFaceIn, unitKeepOutFt } from '../ducts/clearance';
import { calculateAshrae621Ventilation } from '../outdoorAir/outdoorAirCalculator';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}
console.log('=== Layout fixes (L1) ===');

const base = (poly: number[], area: number, cfm: number, tons: number, extra: object = {}): Parameters<typeof executeAirDistributionDesign>[0] => ({
  roomName: 'T', roomPolygon: poly, roomAreaSqFt: area, sensibleLoadBtu: tons * 9000, totalLoadBtu: tons * 12000,
  requiredCfm: cfm, systemType: 'concealed', spaceTypeId: 'office', ...extra
});
const RECT = [0, 0, 40, 0, 40, 25, 0, 25];

// 1. plant connection: only refrigerant systems get outdoor units; chilled water gets CHW stubs
{
  assert(plantConnectionFor('ahu') === 'chilled-water' && plantConnectionFor('fcu') === 'chilled-water', 'ahu / fcu are chilled water');
  assert(plantConnectionFor('packaged') === 'self-contained' && plantConnectionFor('rtu') === 'self-contained', 'rtu / packaged are self-contained');
  assert(plantConnectionFor('vrf') === 'refrigerant' && plantConnectionFor('concealed') === 'refrigerant', 'split / vrf are refrigerant');

  const ahu = executeAirDistributionDesign(base(RECT, 1000, 2000, 5, { systemType: 'ahu' }));
  assert(ahu.plantConnection === 'chilled-water', 'ahu plantConnection');
  assert(ahu.outdoorUnitPositions.length === 0, 'chilled-water AHU has no outdoor units');
  assert(ahu.chwStubs!.length === 2 * ahu.serviceZones.length, 'supply + return stub per AHU');
  const pa = convertDesignResultToZonePayload(ahu);
  assert(pa.plantConnection === 'chilled-water' && pa.outdoorUnitPositions.length === 0, 'payload: no ODUs for AHU');
  assert(pa.unitServiceZones.every((u) => u.outdoorUnitIndex === -1), 'no ODU index on a chilled-water unit');
  for (const c of pa.chwStubs) {
    const u = pa.unitPositions[c.unitIndex];
    assert(!!u && Number.isFinite(c.x) && Number.isFinite(c.y) && ['north', 'south', 'east', 'west'].includes(c.side), 'stub fields');
    assert(Math.hypot(c.x - u.x, c.y - u.y) < 400, 'stub sits at its unit');
  }
  // the stubs point at the nearest wall: unit near the east wall -> east side
  assert(ahu.chwStubs!.every((c) => c.side === 'east'), 'stubs face the nearest exterior wall');
  assert(ahu.chwStubs!.some((c) => c.kind === 'supply') && ahu.chwStubs!.some((c) => c.kind === 'return'), 'supply and return stubs');

  const pk = executeAirDistributionDesign(base(RECT, 1000, 2000, 5, { systemType: 'packaged' }));
  assert(pk.plantConnection === 'self-contained' && pk.outdoorUnitPositions.length === 0 && pk.chwStubs!.length === 0, 'packaged: no ODU, no stubs');

  const sp = executeAirDistributionDesign(base(RECT, 1000, 2000, 5));
  assert(sp.plantConnection === 'refrigerant' && sp.outdoorUnitPositions.length === sp.serviceZones.length && sp.chwStubs!.length === 0, 'split: ODUs, no stubs');
  assert(convertDesignResultToZonePayload(sp).plantConnection === 'refrigerant', 'payload refrigerant');
}

// 2. VRF: indoor units from the indoor catalog, outdoor module separate, combination ratio, no blanket clearance flags
{
  const d = executeAirDistributionDesign(base(RECT, 1000, 2000, 5, { systemType: 'vrf' }));
  const opt = d.selectedOption;
  assert(!/REYQ|VRV/i.test(opt.unitModel), `VRF unit model is an indoor model, got ${opt.unitModel}`);
  assert(/REYQ/.test(d.outdoorModel ?? ''), `outdoor model separate (${d.outdoorModel})`);
  assert(opt.combinationRatio! >= 0.5 && opt.combinationRatio! <= 1.3, `combination ratio ${opt.combinationRatio}`);
  assert(opt.capacityBtuPerUnit < 40000, `indoor unit, not a 62k outdoor-sized unit (${opt.capacityBtuPerUnit})`);
  assert(d.outdoorUnitPositions.length === 1, 'one outdoor module');
  const all = [...d.supplyDucts, ...d.returnDucts];
  assert(all.filter((x) => x.clearanceIssue).length < all.length / 4, 'normal VRF branches are not flagged for clearance');
  assert(all.filter((x) => x.clearanceIssue).length === 0, 'no clearance flags in a plain rectangular room');
  const p = convertDesignResultToZonePayload(d);
  assert(p.systemType === 'vrf' && p.catalogModel === opt.unitModel && p.outdoorModel === d.outdoorModel, 'payload carries indoor catalogModel, outdoorModel, systemType');
  assert(!/REYQ/.test(p.catalogModel), 'catalogModel is not the outdoor model');
}

// 3. outdoor air (ASHRAE 62.1 Voz) is exposed
{
  const d = executeAirDistributionDesign(base(RECT, 1000, 2000, 5, { occupancyCount: 20 }));
  const voz = calculateAshrae621Ventilation({ areaSqFt: 1000, spaceTypeId: 'office', occupancyCount: 20 }).vozCfm;
  const p = convertDesignResultToZonePayload(d);
  assert(p.outdoorAirCfm === Math.min(voz, Math.round(d.massBalance.supplyCfm)) && p.outdoorAirCfm > 0, `outdoorAirCfm ${p.outdoorAirCfm} == Voz ${voz}`);
}

// 4. messages: no float noise, unit-aware
{
  const r = generateSystemCandidates(13000, 9750, 450, 'office', 300, true, {}, ['vrf']);
  const msgs = r.candidates.flatMap((c) => c.diagnostics.map((x) => x.message));
  assert(msgs.length > 0, 'a VRF diagnostic exists');
  for (const m of msgs) assert(!/\d\.\d{5,}/.test(m) && !/\d{3}\.\d{6,}/.test(m), `no raw floats: ${m}`);
  assert(msgs.some((m) => /combination ratio \d+% is outside 50%-130% \(target 100%-110%\)/.test(m)), `combination ratio message rounded: ${msgs.join(' | ')}`);
  const metric = generateSystemCandidates(3000, 2200, 40, 'office', 25, false, {}, ['concealed']);
  const mm = metric.candidates.flatMap((c) => c.diagnostics.map((x) => x.message)).join(' ');
  assert(!/Btu\/h|\bCFM\b/.test(mm), `metric messages use kW / L/s: ${mm}`);
  const dd = executeAirDistributionDesign(base(RECT, 1000, 2000, 5, { systemType: 'vrf' }));
  for (const w of [...dd.overrideWarnings, ...dd.selectedOption.violations ?? []]) assert(!/\d\.\d{6,}/.test(w), `no raw floats in ${w}`);
}

// 5 + 7. plenum return: 1-2 grilles per unit, face velocity <= 400 fpm, >= 6 ft from every supply, >= 3 ft off the unit
{
  const d = executeAirDistributionDesign(base(RECT, 1000, 2000, 5));
  assert(d.returnStrategy === 'plenum', 'plenum return');
  for (const z of d.serviceZones) {
    const mine = d.returnTerminals.filter((t) => t.unitId === z.id);
    assert(mine.length >= 1 && mine.length <= 2, `${z.unitTag}: 1-2 plenum grilles, got ${mine.length}`);
  }
  assert(d.returnTerminals.length <= 2 * d.serviceZones.length, `<= 2 grilles per unit (${d.returnTerminals.length} for ${d.serviceZones.length})`);
  for (const t of d.returnTerminals) {
    const f = parseFaceIn(t.faceDimension);
    const fpm = t.cfm / ((f.w * f.h) / 144);
    assert(fpm <= 400 + 1, `${t.id}: face velocity ${fpm.toFixed(0)} fpm <= 400`);
    const dSup = Math.min(...d.supplyTerminals.map((s) => Math.hypot(s.position.x - t.position.x, s.position.y - t.position.y)));
    assert(dSup >= 6 - 1e-6, `${t.id}: ${dSup.toFixed(2)} ft from the nearest supply diffuser >= 6 ft`);
    for (const z of d.serviceZones) {
      const k = unitKeepOutFt(z.equipmentPosition, d.unitFootprintsIn?.[z.id], 0);
      const dx = Math.max(k.minX - t.position.x, 0, t.position.x - k.maxX), dy = Math.max(k.minY - t.position.y, 0, t.position.y - k.maxY);
      assert(Math.hypot(dx, dy) >= 3 - 1e-6, `${t.id}: ${Math.hypot(dx, dy).toFixed(2)} ft off ${z.unitTag} >= 3 ft (>= 2 ft footprint clearance)`);
    }
  }
  const p = convertDesignResultToZonePayload(d);
  assert(p.returnPath === 'plenum' && p.diffusers.filter((x) => x.type === 'return').every((x) => x.returnPath === 'plenum' && x.plenumReturn === true), 'returnPath plenum in payload');
  const du = executeAirDistributionDesign(base(RECT, 1000, 2000, 5, { returnStrategy: 'ducted' }));
  assert(convertDesignResultToZonePayload(du).returnPath === 'ducted', 'ducted return keeps its path');
}

// 6. high-wall throw coverage: an L room gets a unit in each leg
{
  const L = [0, 0, 24, 0, 24, 12, 12, 12, 12, 24, 0, 24];
  const d = executeAirDistributionDesign(base(L, 432, 800, 2, { systemType: 'high-wall' }));
  assert(d.serviceZones.length === 2, `L-room high-wall -> 2 units, got ${d.serviceZones.length}`);
  const pos = d.serviceZones.map((z) => z.equipmentPosition);
  assert(pos.some((p) => p.y < 12) && pos.some((p) => p.y > 12), 'one unit in each leg');
  assert(!(d.layoutWarnings ?? []).some((w) => /throw/i.test(w)), `no throw warning: ${d.layoutWarnings?.join('; ')}`);
  // independent check: every sample point is within the 25 ft throw of a unit with line of sight in the room
  let miss = 0;
  for (let x = 1; x < 24; x += 2) for (let y = 1; y < 24; y += 2) {
    if (!isPointInPolygon(x, y, L)) continue;
    const ok = pos.some((p) => {
      const dist = Math.hypot(x - p.x, y - p.y);
      if (dist > 25) return false;
      for (let i = 1; i < 10; i++) if (!isPointInPolygon(p.x + ((x - p.x) * i) / 10, p.y + ((y - p.y) * i) / 10, L)) return false;
      return true;
    });
    if (!ok) miss++;
  }
  assert(miss === 0, `${miss} sample points outside every unit's throw`);
  // a rectangle that one unit covers stays a single unit
  const r = executeAirDistributionDesign(base([0, 0, 16, 0, 16, 12, 0, 12], 192, 400, 1, { systemType: 'high-wall' }));
  assert(r.serviceZones.length === 1, `small rectangle keeps one unit, got ${r.serviceZones.length}`);
}

console.log('✔ Layout fixes (L1) passed');
