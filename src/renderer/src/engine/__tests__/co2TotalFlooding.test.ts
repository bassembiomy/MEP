/**
 * C1 — NFPA 12 total-flooding CO2: quantity (flooding factor, MCF, openings, ventilation, temperature), discharge rate,
 * nozzle layout, pipe network, Y/Z two-phase flow, orifices, storage, devices, checks, accessories and integration.
 * Expected values from an independent Python oracle (CoolProp HEM Y/Z tables, plan §C1).
 */
import { designCo2System } from '../fireProtection/co2/co2Engine';
import { defaultCo2Answers, yzAt, pressureAtY, nozzleFluxAt, surfaceFloodingFactor, materialConversionFactor, CO2_MATERIALS } from '../fireProtection/co2/nfpa12';
import { Co2DesignInput, Co2EnclosureInput } from '../fireProtection/co2/co2Types';
import { designFireProtectionSystem } from '../fireProtection/fireProtectionEngine';
import { DEFAULT_FIRE_INPUT } from '../fireProtection/defaults';
import { buildFireCalcReport } from '../fireProtection/report';
import { DesignCheck } from '../fireProtection/fpTypes';

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
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const enc = (p: Partial<Co2EnclosureInput>): Co2EnclosureInput => ({
  id: 'Z1', name: 'Enclosure', roomId: 'R1', polygon: rect(0, 0, 10000, 8000), fireType: 'surface', material: 'gasoline',
  deepSeated: 'dry-electrical', heightM: 4, deductionM3: 0, openingsM2: 0, ventilationM3min: 0, temperatureC: 21,
  occupancy: 'normally-unoccupied', strengthPsf: 25, ...p
});

console.log('=== CO2 C1: NFPA 12 total flooding ===');
{
  // NFPA 12 tables & thermodynamic tables
  assert(surfaceFloodingFactor(100).ft3PerLb === 14 && surfaceFloodingFactor(100).minLb === 0, 'factor ≤140 ft³');
  assert(surfaceFloodingFactor(300).ft3PerLb === 15 && surfaceFloodingFactor(300).minLb === 10, 'factor 141–500');
  assert(surfaceFloodingFactor(1000).ft3PerLb === 16 && surfaceFloodingFactor(1000).minLb === 35, 'factor 501–1600');
  assert(surfaceFloodingFactor(3000).ft3PerLb === 18 && surfaceFloodingFactor(3000).minLb === 100, 'factor 1601–4500');
  assert(surfaceFloodingFactor(11300).ft3PerLb === 20 && surfaceFloodingFactor(11300).minLb === 250, 'factor 4501–50000');
  assert(surfaceFloodingFactor(60000).ft3PerLb === 22 && surfaceFloodingFactor(60000).minLb === 2500, 'factor > 50000');
  near(materialConversionFactor(49), 1.6205, 0.01, 'MCF 49 %');
  assert(materialConversionFactor(34) === 1 && materialConversionFactor(30) === 1, 'MCF ≤ 34 % = 1');
  assert(CO2_MATERIALS.ethylene.mdcPct === 49 && CO2_MATERIALS.gasoline.mdcPct === 34 && CO2_MATERIALS.hydrogen.mdcPct === 75, 'material MDC');
  near(yzAt('high-pressure', 740).y, 500.8, 0.05, 'Y(740) HP');
  near(yzAt('high-pressure', 300).y, 11841.4, 0.05, 'Y(300) HP');
  near(yzAt('high-pressure', 300).z, 1.624, 0.2, 'Z(300) HP');
  near(yzAt('low-pressure', 150).y, 4327.0, 0.1, 'Y(150) LP');
  near(yzAt('high-pressure', 735).y, (500.8 + 985.8) / 2, 0.01, 'linear interpolation');
  near(pressureAtY('high-pressure', 11841.4), 300, 0.05, 'P(Y) inverse');
  near(nozzleFluxAt('high-pressure', 300), 875.6, 0.05, 'nozzle flux HP 300 psi');
  near(nozzleFluxAt('low-pressure', 200), 833.9, 0.05, 'nozzle flux LP 200 psi');
  console.log('✓ NFPA 12 flooding factors, MCF, materials, Y/Z & nozzle flux tables');
}

const twoZones = (over: Partial<Co2DesignInput['answers']> = {}): Co2DesignInput => ({
  answers: { ...defaultCo2Answers(), ...over },
  floors: [{
    id: 'L1', name: 'Level 1', elevationM: 0, storage: { x: 11000, y: -3000 },
    enclosures: [
      enc({ id: 'Z1', name: 'Solvent Store', material: 'ethylene', openingsM2: 0.5 }),
      enc({ id: 'Z2', name: 'Switchgear Room', roomId: 'R2', polygon: rect(12000, 0, 18000, 5000), fireType: 'deep-seated', deepSeated: 'dry-electrical', heightM: 3.5 })
    ]
  }]
});

{
  const r = designCo2System(twoZones());
  const f = r.floors[0];
  const [z1, z2] = f.enclosures;
  // ── Z1: surface fire, ethylene 49 %, 0.5 m² uncloseable opening
  const q = z1.quantity;
  near(q.volumeFt3, 11300.69, 0.01, 'Z1 volume');
  assert(q.designConcentrationPct === 49 && q.floodingFactorFt3PerLb === 20 && q.minimumLb === 250, 'Z1 basis');
  near(q.basicLb, 565.035, 0.01, 'Z1 basic');
  near(q.mcf, 1.6205, 0.01, 'Z1 MCF');
  near(q.openingsLb, 8.7215, 0.05, 'Z1 openings 1 lb/ft² × MCF');
  near(q.totalLb, 924.363, 0.02, 'Z1 total');
  near(z1.rateLbMin, 924.363, 0.02, 'Z1 rate (1 min)');
  near(z1.dischargeTimeMin, 1, 0.01, 'Z1 discharge time');
  assert(z1.cylinders === 10, `Z1 cylinders 10, got ${z1.cylinders}`);
  near(z1.ventAreaMm2, 91592, 0.1, 'Z1 vent area (239 Q/√P, kg/min & kPa)');
  near(z1.ventAreaIn2, 141.97, 0.1, 'Z1 vent area in²');
  // nozzles: 2 × 2 grid, sorted by y then x
  assert(z1.nozzles.map((n) => `${n.tag}@${n.x},${n.y}`).join() === 'N-L1-Z1-01@2500,2000,N-L1-Z1-02@7500,2000,N-L1-Z1-03@2500,6000,N-L1-Z1-04@7500,6000', `Z1 nozzles ${z1.nozzles.map((n) => `${n.tag}@${n.x},${n.y}`)}`);
  for (const n of z1.nozzles) near(n.flowLbMin, 231.091, 0.02, `${n.tag} flow`);
  // piping: main (8.5 m, 1 elbow + selector valve), header 4 m, two 5 m branches
  const pipes = f.pipes.filter((p) => p.enclosureId === 'Z1');
  const main = pipes.find((p) => p.kind === 'main')!;
  assert(!!main && main.fromNode === 'B' && main.toNode === 'H-Z1-0', `Z1 main B → H-Z1-0 (${main?.fromNode} → ${main?.toNode})`);
  assert(JSON.stringify(main.points) === JSON.stringify([[11000, -3000], [7500, -3000], [7500, 2000]]), `Z1 main route ${JSON.stringify(main.points)}`);
  near(main.lengthM, 8.5, 0.01, 'Z1 main length');
  assert(main.sizeIn === 2 && main.schedule === 'sch80', `Z1 main 2" Sch 80, got ${main.sizeIn} ${main.schedule}`);
  near(main.fittingsFt, 130 * 1.939 / 12, 0.1, 'Z1 main fittings (elbow 30 D + selector 100 D)');
  near(main.endPsi, 742.866, 0.02, 'Z1 main end pressure');
  const header = pipes.find((p) => p.kind === 'header')!;
  assert(header.sizeIn === 1.25 && header.fromNode === 'H-Z1-0' && header.toNode === 'H-Z1-1', `Z1 header 1¼" (${header.sizeIn})`);
  near(header.endPsi, 737.818, 0.02, 'Z1 header end');
  const br = pipes.filter((p) => p.kind === 'branch');
  assert(br.length === 2 && br.every((p) => p.sizeIn === 1 && Math.abs(p.lengthM - 5) < 1e-6), 'Z1 branches 1" × 5 m');
  const byTag = Object.fromEntries(z1.nozzles.map((n) => [n.tag, n]));
  near(byTag['N-L1-Z1-02'].pressurePsi, 742.866, 0.02, 'N02 at header node');
  near(byTag['N-L1-Z1-01'].pressurePsi, 734.827, 0.02, 'N01 end of branch');
  near(byTag['N-L1-Z1-03'].pressurePsi, 729.674, 0.02, 'N03 most remote');
  near(z1.minNozzlePressurePsi, 729.674, 0.02, 'Z1 min nozzle pressure');
  assert(byTag['N-L1-Z1-02'].node === 'H-Z1-0' && byTag['N-L1-Z1-01'].node === 'N-L1-Z1-01', 'nozzle nodes');
  near(byTag['N-L1-Z1-03'].orificeAreaIn2, 0.09316, 0.1, 'N03 orifice area');
  assert(byTag['N-L1-Z1-03'].orificeCode === 11.5 && byTag['N-L1-Z1-02'].orificeCode === 11, 'orifice codes');
  assert(z1.flowRows.length === 4 && z1.flowRows[0].fromNode === 'B', 'Z1 flow rows from the storage');
  for (const row of z1.flowRows) assert(row.endPsi <= row.startPsi && row.y2 >= row.y1, `row ${row.pipeId} monotone`);
  assert(chk(z1.checks, 'co2-nozzle-pressure:L1/Z1').status === 'pass' && chk(z1.checks, 'co2-discharge:L1/Z1').status === 'pass', 'Z1 checks');
  assert(chk(z1.checks, 'co2-openings:L1/Z1').status === 'pass', 'surface openings compensated');
  // ── Z2: deep-seated dry electrical > 2000 ft³: 50 %, 12 ft³/lb, min 200 lb, 30 % in 2 min governs the rate
  near(z2.quantity.volumeFt3, 3708.04, 0.01, 'Z2 volume');
  assert(z2.quantity.designConcentrationPct === 50 && z2.quantity.floodingFactorFt3PerLb === 12 && z2.quantity.minimumLb === 200 && z2.quantity.mcf === 1, 'Z2 basis');
  near(z2.quantity.totalLb, 309.0033, 0.02, 'Z2 total');
  near(z2.thirtyPctLb, 146.9517, 0.05, 'Z2 30 % quantity');
  near(z2.rateLbMin, 73.4758, 0.05, 'Z2 rate = W30 / 2');
  near(z2.dischargeTimeMin, 4.2055, 0.05, 'Z2 discharge time ≤ 7 min');
  assert(z2.soakMin === 20 && z1.soakMin === 0, 'soak time');
  assert(z2.nozzles.length === 1 && z2.nozzles[0].x === 15000 && z2.nozzles[0].y === 2500, 'Z2 one central nozzle');
  const m2 = f.pipes.find((p) => p.enclosureId === 'Z2' && p.kind === 'main')!;
  assert(JSON.stringify(m2.points) === JSON.stringify([[11000, -2600], [15000, -2600], [15000, 2500]]), `Z2 main offset 400 mm ${JSON.stringify(m2.points)}`);
  assert(m2.sizeIn === 0.5 && m2.schedule === 'sch40', 'Z2 main ½" Sch 40');
  near(z2.nozzles[0].pressurePsi, 736.746, 0.02, 'Z2 nozzle pressure');
  assert(z2.nozzles[0].orificeCode === 6.5, `Z2 orifice code, got ${z2.nozzles[0].orificeCode}`);
  assert(chk(z2.checks, 'co2-orifice-ratio:L1/Z2').status === 'warn', 'Z2 orifice/pipe area ratio < 10 % → warn');
  assert(z2.cylinders === 4, 'Z2 cylinders');
  // ── storage: one bank sized for the largest hazard
  const st = r.storage;
  assert(st.storage === 'high-pressure' && st.governingEnclosureId === 'Z1' && st.mainCylinders === 10 && st.reserveCylinders === 0 && st.cylinderLb === 100, 'storage');
  near(st.mainLb, 924.363, 0.02, 'main supply');
  assert(st.installedLb === 1000 && st.tankTons === null, 'installed');
  // ── devices
  const dv = f.devices;
  const count = (k: string, e: string | null): number => dv.filter((d) => d.kind === k && d.enclosureId === e).length;
  assert(count('smoke-detector', 'Z1') === 2 && dv.filter((d) => d.kind === 'smoke-detector' && d.enclosureId === 'Z1').map((d) => d.zone).join() === 'A,B', 'Z1 cross-zoned detectors');
  assert(count('smoke-detector', 'Z2') === 2, 'Z2 minimum 2 detectors when cross-zoned');
  for (const e of ['Z1', 'Z2']) for (const k of ['horn-strobe', 'strobe-outside', 'manual-release', 'pressure-relief-vent']) assert(count(k, e) === 1, `${e} ${k}`);
  assert(count('warning-sign', 'Z1') === 2 && count('selector-valve', 'Z1') === 1, 'Z1 signs & selector valve');
  for (const k of ['control-panel', 'lockout-valve', 'pressure-switch', 'warning-sign']) assert(count(k, null) === 1, `floor ${k}`);
  assert(new Set(dv.map((d) => d.tag)).size === dv.length, 'unique device tags');
  // ── accessories, BOM, checks
  const acc = r.accessories.map((a) => a.item.toLowerCase()).join('|');
  for (const s of ['cylinder', 'flexible discharge hose', 'check valve', 'manifold', 'selector', 'lockout', 'time delay', 'pressure switch', 'odorizer', 'nozzle', 'control panel', 'manual release', 'warning sign', 'relief vent']) assert(acc.includes(s), `accessory "${s}"`);
  assert(r.accessories.find((a) => /cylinder/i.test(a.item) && /co2|carbon dioxide/i.test(a.item))!.qty === 10, 'cylinder qty');
  assert(r.totalNozzles === 5 && r.bom.some((b) => b.unit === 'm' && b.size.includes('Sch 80')), 'BOM');
  assert(chk(r.checks, 'co2-reserve').status === 'warn', 'single supply for several hazards → reserve warning');
  assert(chk(r.checks, 'co2-time-delay:L1/Z1').status === 'pass', 'time delay ≥ 20 s');
  console.log('✓ two enclosures: quantities, rates, nozzles, network, Y/Z pressures, orifices, storage, devices');
}
{
  // Low pressure, −30 °C (+22 %), unshut ventilation 10 m³/min, reserve → tank
  const lp = (mainLen: 30 | 250): Co2DesignInput => ({
    answers: { ...defaultCo2Answers(), storage: 'low-pressure', reserve: true },
    floors: [{ id: 'L1', name: 'Level 1', elevationM: 0, storage: { x: mainLen === 30 ? 35000 : 255000, y: -1500 },
      enclosures: [enc({ id: 'Z3', name: 'Paint Mixing', polygon: rect(0, 0, 12000, 10000), heightM: 5, ventilationM3min: 10, temperatureC: -30 })] }]
  });
  const r = designCo2System(lp(30));
  const z = r.floors[0].enclosures[0];
  near(z.quantity.ventilationLb, 17.6573, 0.05, 'ventilation compensation');
  near(z.quantity.temperatureCorrectionPct, 22, 0.01, 'temperature correction 1 %/°F below 0 °F');
  near(z.quantity.totalLb, 1314.0587, 0.02, 'Z3 total');
  assert(chk(z.checks, 'co2-ventilation:L1/Z3').status === 'warn', 'surface fire ventilation compensated → warn');
  const pipes = r.floors[0].pipes;
  assert(pipes.every((p) => p.schedule === 'sch40'), 'low pressure Sch 40');
  assert(pipes.find((p) => p.kind === 'main')!.sizeIn === 2 && pipes.find((p) => p.kind === 'header')!.sizeIn === 1.5, 'LP sizes');
  near(pipes.find((p) => p.kind === 'main')!.endPsi, 279.35, 0.05, 'LP main end (start 300 psi)');
  near(z.minNozzlePressurePsi, 271.856, 0.05, 'LP min nozzle');
  assert(z.nozzles.every((n) => n.orificeCode === 18.5), 'LP orifice codes');
  assert(r.storage.tankTons === 2 && r.storage.mainCylinders === 0, `LP tank 2 t, got ${r.storage.tankTons}`);
  near(r.storage.reserveLb, 1314.0587, 0.02, 'reserve = main');
  assert(chk(r.checks, 'co2-reserve').status === 'pass', 'reserve provided');
  const far = designCo2System(lp(250));
  const fz = far.floors[0].enclosures[0];
  assert(far.floors[0].pipes.find((p) => p.kind === 'main')!.sizeIn === 2.5, 'long main upsized to 2½" to keep ≥ 150 psi');
  near(fz.minNozzlePressurePsi, 183.99, 0.1, 'LP long main min nozzle');
  assert(fz.minNozzlePressurePsi >= 150 && chk(fz.checks, 'co2-nozzle-pressure:L1/Z3').status === 'pass', 'LP nozzle ≥ 150 psi');
  console.log('✓ low pressure, temperature & ventilation corrections, upsizing, tank & reserve');
}
{
  const occ = designCo2System({ answers: { ...defaultCo2Answers(), timeDelayS: 10, odorizer: false }, floors: [{ id: 'B1', name: 'Basement', elevationM: -4, storage: { x: -2000, y: 0 }, enclosures: [enc({ id: 'Z1', occupancy: 'normally-occupied', fireType: 'deep-seated', deepSeated: 'records', ventilationM3min: 5, openingsM2: 0.2, heightM: 7 })] }] });
  const z = occ.floors[0].enclosures[0];
  assert(chk(z.checks, 'co2-occupancy:B1/Z1').status === 'fail', 'normally occupied → not permitted');
  assert(chk(z.checks, 'co2-time-delay:B1/Z1').status === 'fail', 'time delay < 20 s');
  assert(chk(z.checks, 'co2-ventilation:B1/Z1').status === 'fail', 'deep-seated: ventilation must shut down');
  assert(chk(z.checks, 'co2-openings:B1/Z1').status === 'warn', 'deep-seated openings → warn');
  assert(chk(z.checks, 'co2-height:B1/Z1').status === 'warn', 'height > 6 m → warn');
  assert(z.quantity.designConcentrationPct === 65 && z.quantity.floodingFactorFt3PerLb === 8 && z.soakMin === 20, 'records 65 %, 8 ft³/lb');
  near(z.quantity.openingsLb, 0.2 * 10.7639 * 2, 0.1, 'deep-seated openings 2 lb/ft²');
  assert(chk(occ.checks, 'co2-odorizer').status === 'warn', 'odorizer missing → warn');
  const small = designCo2System({ answers: defaultCo2Answers(), floors: [{ id: 'L1', name: 'L1', elevationM: 0, storage: { x: -2000, y: 0 }, enclosures: [enc({ polygon: rect(0, 0, 4000, 4000), heightM: 3, fireType: 'deep-seated', deepSeated: 'dry-electrical' })] }] });
  const sq = small.floors[0].enclosures[0].quantity;
  assert(sq.floodingFactorFt3PerLb === 10 && sq.minimumLb === 0, 'dry electrical ≤ 2000 ft³: 10 ft³/lb');
  near(sq.totalLb, 48 * 35.3146667 / 10, 0.02, 'small electrical room quantity');
  const fur = designCo2System({ answers: defaultCo2Answers(), floors: [{ id: 'L1', name: 'L1', elevationM: 0, storage: { x: -2000, y: 0 }, enclosures: [enc({ fireType: 'deep-seated', deepSeated: 'fur-vault', temperatureC: 100 })] }] });
  const fq = fur.floors[0].enclosures[0].quantity;
  assert(fq.designConcentrationPct === 75 && fq.floodingFactorFt3PerLb === 6, 'fur vault 75 %, 6 ft³/lb');
  near(fq.temperatureCorrectionPct, (212 - 200) / 5, 0.01, 'temperature correction 1 % per 5 °F above 200 °F');
  console.log('✓ safety, occupancy, deep-seated variants & temperature');
}
{
  const fire = designFireProtectionSystem({ ...DEFAULT_FIRE_INPUT, co2Design: twoZones() });
  assert(!!fire.co2 && fire.co2.floors[0].enclosures.length === 2, 'result.co2');
  assert(fire.checks.some((c) => c.id === 'co2-nozzle-pressure:L1/Z1'), 'CO2 checks aggregated');
  assert(designFireProtectionSystem(DEFAULT_FIRE_INPUT).co2 === null, 'no CO2 design → null');
  near(fire.demand.sprinkler.sprinklerFlowGpm, designFireProtectionSystem(DEFAULT_FIRE_INPUT).demand.sprinkler.sprinklerFlowGpm, 0.001, 'CO2 does not change the water demand');
  assert(buildFireCalcReport(fire).toUpperCase().includes('CARBON DIOXIDE'), 'report section');
  console.log('✓ integration');
}
console.log('\nAll CO2 C1 tests passed.');
