import { generateSystemCandidates, getCatalogSizingForZone, DesignCandidate } from '../systemDesigner';
import { STANDARD_EQUIPMENT_CATALOG } from '../hvacCatalogs';
import { selectEquipmentForLoad, evaluateSizing, ambientDerateFactor } from '../systemArchitecture/equipmentSelector';
import { optimizeMultiUnitCandidates, requiredCeilingVoidIn } from '../systemArchitecture/equipmentOptimizer';
import { generateSystemArchitecture, tagRange, trunkWidthIn } from '../hvacArchitecture';
import { BTUH_PER_TON, BTUH_PER_W, W_PER_BTUH, LPS_PER_CFM, CFM_PER_LPS, SQFT_PER_SQM } from '../units';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running Selection & Sizing Tests (professional HVAC designer rules) ===');

const RATIO_MAX = 1.2;
const RATIO_MAX_FIXED = 1.15;
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// 1. Metric airflow / area / load are converted once at entry
// ---------------------------------------------------------------------------
{
  // 10 kW, 600 L/s (= 1271 CFM). Previously treated L/s as CFM -> 2 x 42QSS018 = 888 CFM.
  const result = generateSystemCandidates(10000, 7500, 600, 'office', 40, false, {}, ['concealed']);
  const best = result.bestOverall;
  assert(best !== null, 'metric 10 kW / 600 L/s must have a valid concealed selection');
  const requiredCfm = 600 * CFM_PER_LPS;
  assert(best!.deliveredCfm! >= requiredCfm * 0.95 - EPS, `metric: delivered ${best!.deliveredCfm} CFM must cover ${requiredCfm.toFixed(0)} CFM (>=95%)`);
  assert(best!.deliveredCfm! > 888, 'metric: must no longer pick the 888 CFM answer');
  const loadBtu = 10000 * BTUH_PER_W;
  assert(best!.installedCapacityBtu! >= loadBtu - EPS, 'metric: installed capacity must cover 10 kW in Btu/h');
  console.log(`✔ 1a Metric 10 kW / 600 L/s -> ${best!.quantity} x ${best!.equipment.model}, ${best!.deliveredCfm} CFM`);

  // Trace must show the load in W exactly once (no 3.412 double conversion)
  const step1 = best!.algorithmTrace!.steps[0];
  const totalInput = step1.inputs.find((i) => i.label.startsWith('Total Cooling Load'))!;
  assert(String(totalInput.value) === Math.round(10000).toLocaleString(), `trace load must display 10,000 W, got ${totalInput.value}`);
  assert(totalInput.unit === 'W', 'metric trace displays W');
  const step2 = best!.algorithmTrace!.steps[1];
  const cfmPerTon = Math.round(requiredCfm / (loadBtu / BTUH_PER_TON));
  assert(String(step2.calculatedValue).includes(`${cfmPerTon} CFM/ton`), `CFM/ton must use CFM and Btu/h: expected ${cfmPerTon}, got ${step2.calculatedValue}`);
  console.log('✔ 1b Trace receives Btu/h once (no double conversion), CFM/ton consistent');
}

// ---------------------------------------------------------------------------
// 2. Metric parity: the same room in imperial and metric selects the same model/qty
// ---------------------------------------------------------------------------
{
  const imp = { load: 34000, sens: 26000, cfm: 1250, area: 400 };
  for (const types of [['concealed'], ['cassette'], ['high-wall'], ['packaged'], ['ahu'], ['vrf'], undefined]) {
    const a = generateSystemCandidates(imp.load, imp.sens, imp.cfm, 'office', imp.area, true, {}, types as any);
    const b = generateSystemCandidates(
      imp.load * W_PER_BTUH,
      imp.sens * W_PER_BTUH,
      imp.cfm * LPS_PER_CFM,
      'office',
      imp.area / SQFT_PER_SQM,
      false,
      {},
      types as any
    );
    const ids = (r: typeof a) => r.candidates.map((c) => `${c.equipment.id}x${c.quantity}:${c.isValid}`).join(',');
    assert(ids(a) === ids(b), `parity ${types?.join('/') || 'all'}: imperial [${ids(a)}] vs metric [${ids(b)}]`);
    assert((a.bestOverall?.id ?? '') === (b.bestOverall?.id ?? ''), `parity best ${types?.join('/') || 'all'}`);
  }
  const g1 = getCatalogSizingForZone('concealed', imp.load, imp.cfm, undefined, true, imp.area, 'office', imp.sens);
  const g2 = getCatalogSizingForZone('concealed', imp.load * W_PER_BTUH, imp.cfm * LPS_PER_CFM, undefined, false, imp.area / SQFT_PER_SQM, 'office', imp.sens * W_PER_BTUH);
  assert(g1.model === g2.model && g1.qty === g2.qty, `getCatalogSizingForZone parity: ${g1.model}x${g1.qty} vs ${g2.model}x${g2.qty}`);
  console.log('✔ 2 Metric/imperial parity across all system types + getCatalogSizingForZone');
}

// ---------------------------------------------------------------------------
// 3. getCatalogSizingForZone uses the zone data instead of a hard-coded 400 ft2 office
// ---------------------------------------------------------------------------
{
  const small = getCatalogSizingForZone('concealed', 34000, 1250);
  const explicit = getCatalogSizingForZone('concealed', 34000, 1250, undefined, true, 400, 'office');
  assert(small.model === explicit.model && small.qty === explicit.qty, 'defaults stay backward compatible (400 ft2 office)');
  const big = generateSystemCandidates(34000, 26000, 1250, 'conference', 3000, true, {}, ['concealed']);
  const dflt = generateSystemCandidates(34000, 26000, 1250, 'office', 400, true, {}, ['concealed']);
  const bigNc = big.candidates[0].diffusers.actualNc;
  assert(big.candidates[0].subscores.sComfort !== dflt.candidates[0].subscores.sComfort || bigNc !== dflt.candidates[0].diffusers.actualNc,
    'area / space type must influence scoring');
  console.log('✔ 3 getCatalogSizingForZone accepts isImperial / area / spaceTypeId');
}

// ---------------------------------------------------------------------------
// 4. Capacity ratio bounds, sensible, airflow and VRV 9.2x rejection
// ---------------------------------------------------------------------------
{
  const r = generateSystemCandidates(13000, 9750, 600, 'office', 300, true);
  const vrv = r.candidates.filter((c) => c.equipment.id === 'eq-vrf-10t');
  assert(vrv.every((c) => !c.isValid), '13,000 Btu/h must NOT accept the 10 TR VRV (9.2x)');
  for (const c of r.candidates.filter((x) => x.isValid)) {
    assert(c.capacityRatio! >= 1 - EPS, `valid ratio >= 1.00, got ${c.capacityRatio} for ${c.id}`);
    assert(c.capacityRatio! <= RATIO_MAX + EPS, `valid ratio <= 1.20, got ${c.capacityRatio} for ${c.id}`);
  }
  console.log(`✔ 4a 13,000 Btu/h / 600 CFM: VRV 10TR invalid; ${r.candidates.filter((c) => c.isValid).length} valid candidates (all within 1.00-1.20)`);

  const r2 = generateSystemCandidates(13000, 9750, 450, 'office', 300, true);
  assert(r2.bestOverall !== null, '13,000 Btu/h / 450 CFM must have a valid best');
  const ratio = r2.bestOverall!.capacityRatio!;
  assert(ratio >= 1 && ratio <= RATIO_MAX + EPS, `best ratio ${ratio.toFixed(3)} must be 1.00-1.20`);
  console.log(`✔ 4b 13,000 Btu/h / 450 CFM: best ${r2.bestOverall!.quantity} x ${r2.bestOverall!.equipment.model} at ${ratio.toFixed(2)}x`);

  // Sweep: for a range of loads every valid candidate honours all rules
  for (const load of [9000, 14000, 20000, 30000, 36000, 48000, 60000, 90000, 120000, 200000, 400000]) {
    const cfm = (load / BTUH_PER_TON) * 400;
    const res = generateSystemCandidates(load, load * 0.74, cfm, 'office', load / 30, true);
    for (const c of res.candidates.filter((x) => x.isValid)) {
      const fixed = ['packaged', 'ahu', 'fcu'].includes(c.systemType);
      const max = fixed ? RATIO_MAX_FIXED : RATIO_MAX;
      assert(c.capacityRatio! >= 1 - EPS && c.capacityRatio! <= max + EPS, `load ${load}: ${c.id} ratio ${c.capacityRatio} not in [1, ${max}]`);
      const sensCap = c.indoorUnit
        ? c.installedCapacityBtu! * (c.equipment.sensibleCapacityBtuPerHour / c.equipment.totalCapacityBtuPerHour)
        : c.quantity * c.equipment.sensibleCapacityBtuPerHour;
      assert(sensCap >= load * 0.74 - 1e-6, `load ${load}: ${c.id} sensible ${sensCap} < ${load * 0.74}`);
      if (!c.indoorUnit) {
        const af = (c.deliveredCfm ?? c.quantity * c.equipment.nominalCfm) / cfm; // fan set to design CFM within its range
        assert(af >= 0.95 - EPS && af <= 1.25 + EPS, `load ${load}: ${c.id} airflow ratio ${af}`);
      }
    }
  }
  console.log('✔ 4c Sweep 9k-400k Btu/h: capacity 1.00-1.20 (1.15 fixed-speed), sensible and airflow windows honoured');

  // Sensible deficit rejects an otherwise perfect-capacity selection
  const heavySens = generateSystemCandidates(35000, 33000, 1250, 'office', 400, true, {}, ['concealed']);
  assert(heavySens.candidates.every((c) => !c.isValid), 'SHR 0.94 load cannot be met by catalog coils (sensible check)');
  const chk = evaluateSizing(STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-ducted-36k')!, 1, 35000, 33000, 1250);
  assert(chk.failures.includes('SENSIBLE'), 'evaluateSizing flags sensible deficit');
  console.log('✔ 4d Sensible capacity is enforced');

  // Ambient derate decides pass/fail
  assert(ambientDerateFactor(95) === 1 && ambientDerateFactor(105) < 1, 'derate is 1.0 at rating condition and <1 above');
  const e36 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-ducted-36k')!;
  assert(evaluateSizing(e36, 1, 35000, 0, 1250, 95).valid, '36k valid for 35,000 at 95F');
  assert(!evaluateSizing(e36, 1, 35000, 0, 1250, 115).valid, '36k fails for 35,000 at 115F ambient (derated)');
  console.log('✔ 4e Ambient derate applied to pass/fail');
}

// ---------------------------------------------------------------------------
// 5. equipmentSelector: hard filters, no silent undersized fallback
// ---------------------------------------------------------------------------
{
  const sel = selectEquipmentForLoad(700, 40000, 'concealed');
  assert(sel === null || sel.undersized === true, 'must not silently return the 35,590 Btu/h unit for a 40,000 Btu/h load');
  if (sel) assert(sel.totalCapacityBtu < 40000 || (sel.shortfalls || []).length > 0, 'flagged result lists shortfalls');

  const ok = selectEquipmentForLoad(1250, 35000, 'concealed', undefined, 26000)!;
  assert(!ok.undersized && ok.totalCapacityBtu >= 35000 && ok.sensibleCapacityBtu >= 26000, 'valid selection satisfies capacity and sensible');
  assert(ok.model === '42QSS036-D', `minimal oversize pick expected 42QSS036-D, got ${ok.model}`);

  const noSens = selectEquipmentForLoad(1250, 35000, 'concealed', undefined, 40000)!;
  assert(noSens.undersized === true, 'sensible shortfall is flagged');
  const old = selectEquipmentForLoad(1345, 47005, 'concealed')!;
  assert(!old.undersized && old.totalCapacityBtu >= 47005, 'existing 1345 CFM / 47,005 Btu/h case still resolves to a full-capacity unit');
  console.log('✔ 5 selectEquipmentForLoad: hard filters + undersized flag');
}

// ---------------------------------------------------------------------------
// 6. Multi-unit optimizer: no undersized recommendation, sensible used, ceiling clearance
// ---------------------------------------------------------------------------
{
  const opt = optimizeMultiUnitCandidates({
    roomName: 'Big Hall',
    sensibleLoadBtu: 300000,
    totalLoadBtu: 400000,
    requiredCfm: 12000,
    roomAreaSqFt: 6000,
    systemType: 'concealed'
  });
  for (const c of opt.candidates) {
    if (opt.hasValidOption) {
      assert(c.totalDeliveredCapacityBtu >= 400000, `${c.optionId} delivers ${c.totalDeliveredCapacityBtu} < load`);
      assert(c.totalDeliveredCfm >= 12000 * 0.95, `${c.optionId} CFM ${c.totalDeliveredCfm} < 0.95 x required`);
    }
  }
  const rec = opt.recommendedOption;
  assert(!(rec.unitCount === 3 && rec.nominalTonsPerUnit === 10), 'must not recommend 3 x 10TR (90%) for 400,000 Btu/h');
  assert(rec.isValid === true ? rec.totalDeliveredCapacityBtu >= 400000 : opt.hasValidOption === false, 'recommended is valid or explicitly flagged');
  console.log(`✔ 6a 400,000 Btu/h / 12,000 CFM concealed -> ${rec.unitCount} x ${rec.unitModel} (valid=${rec.isValid})`);

  const pk = optimizeMultiUnitCandidates({
    roomName: 'Big Hall RTU',
    sensibleLoadBtu: 300000,
    totalLoadBtu: 400000,
    requiredCfm: 12000,
    roomAreaSqFt: 6000,
    systemType: 'packaged'
  });
  assert(pk.hasValidOption === true && pk.candidates.every((c) => c.totalDeliveredCapacityBtu >= 400000 && c.isValid), 'packaged options all cover the load');

  const shallow = optimizeMultiUnitCandidates({ roomName: 'Shallow', sensibleLoadBtu: 26000, totalLoadBtu: 35000, requiredCfm: 1250, roomAreaSqFt: 400, maxAvailableCeilingDepthIn: 12, systemType: 'concealed' });
  const tall = optimizeMultiUnitCandidates({ roomName: 'Tall', sensibleLoadBtu: 26000, totalLoadBtu: 35000, requiredCfm: 1250, roomAreaSqFt: 400, maxAvailableCeilingDepthIn: 20, systemType: 'concealed' });
  const common = shallow.candidates.find((c) => tall.candidates.some((t) => t.optionId === c.optionId));
  assert(common !== undefined, 'shallow and tall runs share at least one option');
  const tallSame = tall.candidates.find((t) => t.optionId === common!.optionId)!;
  assert(common!.requiredCeilingVoidIn! >= common!.equipmentHeightIn + 2, 'required void includes 2 in. clearance');
  assert(tallSame.scoreBreakdown.ceilingDepthMatch === 10, 'fits a 20 in. void');
  const fits12 = common!.requiredCeilingVoidIn! <= 12;
  assert(common!.scoreBreakdown.ceilingDepthMatch === (fits12 ? 10 : 2), '12 in. void: score follows unit height + clearance + duct connection');
  const u36 = selectEquipmentForLoad(1233, 35000, 'concealed')!;
  assert(u36.dimensionsIn.height === 11.8 && requiredCeilingVoidIn(u36) > 12, 'an 11.8 in. unit does not fit a 12 in. void once the 2 in. clearance is added');
  console.log('✔ 6b Ceiling void check includes clearance');
}

// ---------------------------------------------------------------------------
// 7. Catalog integrity
// ---------------------------------------------------------------------------
{
  const ids = new Set<string>();
  for (const e of STANDARD_EQUIPMENT_CATALOG) {
    assert(!ids.has(e.id), `duplicate catalog id ${e.id}`);
    ids.add(e.id);
    const nominalBtu = e.nominalTons * BTUH_PER_TON;
    const dev = Math.abs(e.totalCapacityBtuPerHour - nominalBtu) / nominalBtu;
    assert(dev <= 0.10 + EPS, `${e.model}: capacity ${e.totalCapacityBtuPerHour} vs nominal ${nominalBtu} off by ${(dev * 100).toFixed(1)}%`);
    const cfmPerTon = e.nominalCfm / (e.totalCapacityBtuPerHour / BTUH_PER_TON);
    assert(cfmPerTon >= 350 - 1 && cfmPerTon <= 450 + EPS, `${e.model}: ${cfmPerTon.toFixed(0)} CFM/ton outside 350-450`);
    assert(e.sensibleCapacityBtuPerHour <= e.totalCapacityBtuPerHour, `${e.model}: sensible > total`);
    assert(e.sensibleCapacityBtuPerHour / e.totalCapacityBtuPerHour >= 0.6, `${e.model}: implausibly low SHR`);
    assert(e.minCfm <= e.nominalCfm && e.nominalCfm <= e.maxCfm, `${e.model}: min/nominal/max CFM ordering`);
    assert(e.totalCapacityBtuPerHour > 0 && e.nominalCfm > 0, `${e.model}: positive ratings`);
  }
  const m = STANDARD_EQUIPMENT_CATALOG.filter((e) => e.model.includes('42QSS048'));
  assert(m.length === 1 && m[0].nominalTons === 4, '47,005 Btu/h unit is labelled 4 TR (42QSS048-D)');
  assert(!STANDARD_EQUIPMENT_CATALOG.some((e) => e.model.includes('42QSS060')), 'no 5 TR label on a 47 kBtu/h unit');
  console.log(`✔ 7 Catalog integrity (${STANDARD_EQUIPMENT_CATALOG.length} entries): ±10% capacity, 350-450 CFM/ton, sensible <= total`);

  // FCU is selectable when chilled water is available
  const noCw = generateSystemCandidates(24000, 18000, 800, 'office', 300, true);
  const cw = generateSystemCandidates(24000, 18000, 800, 'office', 300, true, {}, undefined, null, [], [], { chilledWaterAvailable: true });
  assert(!noCw.candidates.some((c) => c.systemType === 'fcu'), 'fcu not tested without chilled water');
  assert(cw.candidates.some((c) => c.systemType === 'fcu'), 'fcu tested when chilled water is available');
  console.log('✔ 7b FCU included with chilled water');
}

// ---------------------------------------------------------------------------
// 8. VRF: outdoor by indoor sum with combination ratio 50-130%, indoor chosen separately
// ---------------------------------------------------------------------------
{
  const r = generateSystemCandidates(35000, 26000, 1250, 'office', 400, true, {}, ['vrf']);
  const vrf = r.candidates.filter((c) => c.isValid);
  assert(vrf.length > 0, 'a valid VRF selection exists for 35,000 Btu/h');
  for (const c of vrf) {
    assert(c.indoorUnit !== undefined && c.indoorUnit.systemType !== 'vrf', 'indoor units selected separately from cassette/ducted/wall catalogs');
    assert(c.combinationRatio! >= 0.5 - EPS && c.combinationRatio! <= 1.3 + EPS, `combination ratio ${c.combinationRatio} within 50-130%`);
    const expected = (c.quantity * c.indoorUnit!.totalCapacityBtuPerHour) / c.equipment.totalCapacityBtuPerHour;
    assert(Math.abs(expected - c.combinationRatio!) < 1e-6, 'combination ratio = sum(indoor) / outdoor');
    assert(Math.abs(c.deliveredCfm! - Math.min(c.quantity * c.indoorUnit!.maxCfm, Math.max(c.quantity * c.indoorUnit!.minCfm, 1250))) < 1e-6, 'airflow comes from the indoor units (fan set to design CFM within qty x [minCfm,maxCfm]), not the outdoor module');
    assert(c.equipment.totalCapacityBtuPerHour * ambientDerateFactor(95) >= 35000, 'outdoor module covers the load');
    const step7 = c.algorithmTrace!.steps[6];
    assert(step7.passed === true, 'step 7 passes for compliant combination');
    assert(step7.inputs.some((i) => i.label.includes('Combination Ratio')), 'step 7 reports combination ratio');
    const idu = c.systemArchitecture!.components.find((x) => x.tag.startsWith('VRF-IDU'))!;
    assert(idu.quantity === c.quantity, 'indoor unit quantity in BOM matches');
    const odu = c.systemArchitecture!.components.find((x) => x.tag === 'VRF-ODU-01')!;
    assert(odu.quantity === 1, 'one outdoor module');
  }
  const best = vrf[0];
  console.log(`✔ 8a VRF ${best.equipment.model} + ${best.quantity} x ${best.indoorUnit!.model} @ combination ${(best.combinationRatio! * 100).toFixed(0)}%`);

  // Outdoor oversize (13,000 Btu/h on 10 TR) violates the combination ratio
  const tiny = generateSystemCandidates(13000, 9750, 450, 'office', 300, true, {}, ['vrf']);
  assert(tiny.candidates.every((c) => !c.equipment.nominalTons || c.equipment.nominalTons <= 4 || !c.isValid), 'oversized VRF outdoor modules are invalid');
  assert(tiny.candidates.filter((c) => c.isValid).every((c) => c.combinationRatio! >= 0.5), 'valid VRF candidates respect combination ratio');

  // Piping limits fail step 7 only when inputs exist
  const long = generateSystemCandidates(35000, 26000, 1250, 'office', 400, true, {}, ['vrf'], null, [], [], { equivalentPipeLengthM: 200 });
  assert(long.candidates.every((c) => !c.isValid), 'equivalent length 200 m > 165 m invalidates VRF');
  assert(long.candidates[0].algorithmTrace!.steps[6].passed === false, 'step 7 fails when equivalent length exceeded');
  const high = generateSystemCandidates(35000, 26000, 1250, 'office', 400, true, {}, ['vrf'], null, [], [], { heightDifferenceM: 60 });
  assert(high.candidates.every((c) => !c.isValid), 'height difference 60 m > 50 m invalidates VRF');
  const okPipe = generateSystemCandidates(35000, 26000, 1250, 'office', 400, true, {}, ['vrf'], null, [], [], { equivalentPipeLengthM: 150, heightDifferenceM: 40 });
  assert(okPipe.candidates.some((c) => c.isValid), '150 m / 40 m is within limits');
  console.log('✔ 8b VRF combination ratio and piping limits (165 m / 50 m) enforced in step 7');
}

// ---------------------------------------------------------------------------
// 9. Architecture: quantities, per-unit line sizes, trunk formula, tag ranges
// ---------------------------------------------------------------------------
{
  assert(tagRange('ACU', 1) === 'ACU-01', 'single tag');
  assert(tagRange('ACU', 10) === 'ACU-01…ACU-10', `tag range, got ${tagRange('ACU', 10)}`);
  assert(tagRange('ACU', 3) === 'ACU-01…ACU-03', 'tag range 3');

  assert(trunkWidthIn(1400, 1000, 10) === 22, `trunk W = cfm/V*144/H -> 22 in., got ${trunkWidthIn(1400, 1000, 10)}`);
  assert(trunkWidthIn(700, 1000, 10) === 12, 'trunk 700 CFM -> 10.08 in. rounds up to 12 in.');

  const rtu = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-rtu-10t')!;
  const arch = generateSystemArchitecture(rtu, 3, rtu.nominalCfm * 3, 3000, rtu.totalCapacityBtuPerHour * 3, true);
  const unit = arch.components.find((c) => c.tag.startsWith('RTU'))!;
  assert(unit.quantity === 3 && unit.tag === 'RTU-01…RTU-03', `packaged quantity follows selection, got ${unit.quantity} ${unit.tag}`);
  const ahu = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-ahu-10t')!;
  const archAhu = generateSystemArchitecture(ahu, 2, ahu.nominalCfm * 2, 3000, ahu.totalCapacityBtuPerHour * 2, true);
  assert(archAhu.components.find((c) => c.tag.startsWith('AHU'))!.quantity === 2, 'AHU quantity follows selection');

  // Refrigerant lines sized per unit: 10 units of a 1 TR wall split are NOT 10 TR lines
  const hw = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-ducted-12k')!;
  const generic = { ...hw, connectionSizes: { supplyDuct: '30"x7"', returnDuct: '34"x7"' } };
  const archHw = generateSystemArchitecture(generic, 10, hw.nominalCfm * 10, 3000, hw.totalCapacityBtuPerHour * 10, true);
  const ref = archHw.components.find((c) => c.tag.startsWith('REF'))!;
  assert((ref.connectionSize || '').startsWith('1/4"'), `per-unit line sizing (1 TR -> 1/4" liquid), got ${ref.connectionSize}`);
  const acu = archHw.components.find((c) => c.tag.startsWith('ACU'))!;
  assert(acu.tag === 'ACU-01…ACU-10', `tag range ACU-01…ACU-10, got ${acu.tag}`);

  // Packaged/AHU candidates from the designer carry the selected quantity
  const big = generateSystemCandidates(300000, 225000, 10000, 'office', 8000, true, {}, ['packaged']);
  const pk = big.candidates.find((c) => c.isValid)!;
  assert(pk !== undefined, 'valid packaged candidate for 300,000 Btu/h');
  const rtuComp = pk.systemArchitecture!.components.find((c) => c.tag.startsWith('RTU'))!;
  assert(rtuComp.quantity === pk.quantity, `RTU BOM quantity ${rtuComp.quantity} = candidate quantity ${pk.quantity}`);
  console.log('✔ 9 Architecture quantity / line sizes / trunk formula / tag ranges');
}

// ---------------------------------------------------------------------------
// 10. Space score uses the real ceiling depth
// ---------------------------------------------------------------------------
{
  const noDepth = generateSystemCandidates(35000, 26000, 1250, 'office', 400, true, {}, ['concealed']);
  const shallow = generateSystemCandidates(35000, 26000, 1250, 'office', 400, true, {}, ['concealed'], null, [], [], { maxAvailableCeilingDepthIn: 14 });
  const a = noDepth.candidates.find((c) => c.equipment.id === 'eq-ducted-36k')!;
  const b = shallow.candidates.find((c) => c.equipment.id === 'eq-ducted-36k')!;
  assert(a.subscores.sSpace === 58, `default plenum keeps the planning score (58), got ${a.subscores.sSpace}`);
  assert(b.subscores.sSpace !== 58, `actual ceiling depth must change the space score, got ${b.subscores.sSpace}`);
  const tooShallow = generateSystemCandidates(35000, 26000, 1250, 'office', 400, true, {}, ['concealed'], null, [], [], { maxAvailableCeilingDepthIn: 10 });
  const c = tooShallow.candidates.find((x) => x.equipment.id === 'eq-ducted-36k')!;
  assert(c.diagnostics.some((d) => d.code === 'WARN_CEILING_VOID_INSUFFICIENT'), 'insufficient ceiling void is reported');
  console.log('✔ 10 sSpace uses maxAvailableCeilingDepthIn');
}

// ---------------------------------------------------------------------------
// 11. Auto-deploy pick rule: first VALID candidate, never an invalid one when a valid exists
// ---------------------------------------------------------------------------
{
  const r = generateSystemCandidates(35000, 26000, 1250, 'office', 400, true, {}, ['concealed', 'cassette', 'high-wall', 'vrf', 'packaged', 'ahu']);
  const pick: DesignCandidate | undefined = r.candidates.find((c) => c.isValid) ?? r.candidates[0];
  assert(pick !== undefined && pick.isValid, 'valid candidate is picked first');
  assert(r.candidates[0].isValid === true, 'valid candidates sort before invalid ones');
  const none = generateSystemCandidates(35000, 34500, 1250, 'office', 400, true, {}, ['concealed']);
  assert(none.bestOverall === null && none.candidates.length > 0 && none.candidates.every((c) => !c.isValid), 'no valid candidate: all flagged');
  console.log('✔ 11 First-valid pick rule');
}

console.log('=== All Selection & Sizing Tests Passed ===');
void BTUH_PER_W;
