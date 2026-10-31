/**
 * Acceptance tests — Fire protection standards data & hydraulics.
 * Expected values computed independently (hand calc / Python oracle) from
 * NFPA 13-2019 Hazen-Williams, sprinkler K-factor and density/area rules.
 */
import {
  hazenWilliamsPsiPerFt,
  sprinklerFlow,
  sprinklerPressure,
  elevationPsi,
  velocityFps,
  calculateBranchLine,
  calculateSprinklerDemand,
  calculateStandpipeDemand,
  calculateSystemDemand,
  fittingsEquivalentFt
} from '../fireProtection/hydraulics';
import { HAZARD_DESIGN, equivalentLengthFt } from '../fireProtection/standards/nfpa13';
import { standpipeFlowGpm, standpipeResidualPsi } from '../fireProtection/standards/nfpa14';
import {
  RATED_CAPACITIES_GPM,
  PUMP_DATA_TABLE,
  pumpDataFor,
  selectRatedCapacity,
  circulationReliefSizeIn
} from '../fireProtection/standards/nfpa20';
import { internalDiameterIn, outsideDiameterMm, formatPipeSize, nextLargerSize } from '../fireProtection/standards/pipeData';
import { STANDARDS_REFERENCES } from '../fireProtection/standards/codeReferences';
import { SIMPLE_FIRE_INPUT as DEFAULT_FIRE_INPUT } from '../fireProtection/defaults';
import { FireDesignInput } from '../fireProtection/fpTypes';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion Failed: ${message}`);
}
function near(actual: number, expected: number, tolPct: number, label: string): void {
  const err = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-9);
  assert(err <= tolPct / 100, `${label}: expected ${expected} ±${tolPct}%, got ${actual}`);
}

console.log('=== Fire Protection — Standards & Hydraulics ===');

// 1. Pipe data
{
  near(internalDiameterIn(2, 'sch40'), 2.067, 0.01, 'ID 2" Sch40');
  near(internalDiameterIn(6, 'sch10'), 6.357, 0.01, 'ID 6" Sch10');
  near(outsideDiameterMm(6), 168.275, 0.01, 'OD 6" mm');
  assert(formatPipeSize(6) === 'DN150 (6")', `formatPipeSize(6) got ${formatPipeSize(6)}`);
  assert(formatPipeSize(2.5) === 'DN65 (2½")', `formatPipeSize(2.5) got ${formatPipeSize(2.5)}`);
  assert(nextLargerSize(5) === 6 && nextLargerSize(3) === 3.5, 'nextLargerSize');
  console.log('✓ pipe data');
}

// 2. NFPA 13 tables
{
  const oh2 = HAZARD_DESIGN['ordinary-2'];
  assert(oh2.densityGpmFt2 === 0.2 && oh2.areaFt2 === 1500 && oh2.maxCoverageFt2 === 130, 'OH2 design point');
  assert(oh2.hoseTotalGpm === 250 && oh2.durationMin[1] === 90, 'OH2 hose/duration');
  assert(HAZARD_DESIGN['light'].hoseTotalGpm === 100 && HAZARD_DESIGN['light'].durationMin[1] === 30, 'LH hose/duration');
  assert(HAZARD_DESIGN['extra-2'].densityGpmFt2 === 0.4 && HAZARD_DESIGN['extra-2'].areaFt2 === 2500, 'EH2 design point');
  assert(HAZARD_DESIGN['extra-1'].hoseTotalGpm === 500 && HAZARD_DESIGN['extra-1'].durationMin[1] === 120, 'EH hose/duration');
  assert(equivalentLengthFt('elbow-90', 4, 120, 'sch40') === 10, '4" elbow = 10 ft');
  assert(equivalentLengthFt('tee-branch', 6, 120, 'sch40') === 30, '6" tee = 30 ft');
  assert(equivalentLengthFt('gate-valve', 6, 120, 'sch40') === 3, '6" gate = 3 ft');
  near(equivalentLengthFt('elbow-90', 4, 100, 'sch40'), 7.13, 0.1, '4" elbow at C=100');
  near(equivalentLengthFt('elbow-90', 4, 120, 'sch10'), 13.167, 0.5, '4" elbow Sch10 ID adjustment');
  near(equivalentLengthFt('butterfly-valve', 1.5, 120, 'sch40'), 6, 0.01, 'butterfly <2" falls back to 2"');
  const f = fittingsEquivalentFt({ 'elbow-90': 2, 'tee-branch': 1 }, { nominalIn: 4, schedule: 'sch40', c: 120 });
  assert(f.eqFt === 40, `fittings 2E+1T 4" = 40 ft, got ${f.eqFt}`);
  console.log('✓ NFPA 13 tables');
}

// 3. NFPA 14 & 20 tables
{
  assert(standpipeFlowGpm('I', 1, true) === 500, 'Class I 1 standpipe 500');
  assert(standpipeFlowGpm('I', 3, true) === 1000, 'Class I 3 standpipes 1000');
  assert(standpipeFlowGpm('III', 5, true) === 1000, 'sprinklered cap 1000');
  assert(standpipeFlowGpm('I', 5, false) === 1250, 'unsprinklered cap 1250');
  assert(standpipeFlowGpm('II', 2, true) === 100, 'Class II 100');
  assert(standpipeFlowGpm('none', 2, true) === 0, 'none 0');
  assert(standpipeResidualPsi('I') === 100 && standpipeResidualPsi('II') === 65, 'residual pressures');

  assert(RATED_CAPACITIES_GPM.length === 21 && RATED_CAPACITIES_GPM[9] === 500, 'rated capacities');
  assert(PUMP_DATA_TABLE.length === 21, 'pump data table rows');
  const r1000 = pumpDataFor(1000);
  assert(r1000.suctionIn === 8 && r1000.dischargeIn === 6 && r1000.reliefValveIn === 4 && r1000.hoseValves === 4, '1000 gpm row');
  const r500 = pumpDataFor(500);
  assert(r500.suctionIn === 5 && r500.meterDeviceIn === 5 && r500.hoseHeaderSupplyIn === 4, '500 gpm row');
  assert(selectRatedCapacity(480) === 500 && selectRatedCapacity(500) === 500 && selectRatedCapacity(501) === 750, 'selectRatedCapacity');
  assert(circulationReliefSizeIn(2500) === 0.75 && circulationReliefSizeIn(3000) === 1, 'circulation relief size');
  let threw = false;
  try { selectRatedCapacity(6000); } catch { threw = true; }
  assert(threw, 'selectRatedCapacity > 5000 throws');
  assert(STANDARDS_REFERENCES.length >= 10, 'standards references list');
  for (const code of ['NFPA 13', 'NFPA 14', 'NFPA 20', 'NFPA 22', 'IBC', 'IPC', 'UPC']) {
    assert(STANDARDS_REFERENCES.some((r) => r.code === code), `reference ${code} present`);
  }
  console.log('✓ NFPA 14 / 20 tables & references');
}

// 4. Basic hydraulics
{
  near(hazenWilliamsPsiPerFt(100, 2.067, 120), 0.09396, 0.2, 'H-W 100 gpm 2" C120');
  near(sprinklerFlow(5.6, 7), 14.8162, 0.05, 'K5.6 @ 7 psi');
  near(sprinklerPressure(5.6, 26), 21.556, 0.05, 'P for 26 gpm K5.6');
  near(elevationPsi(10), 4.33, 0.01, 'elevation 10 ft');
  near(velocityFps(500, 5.047), 8.019, 0.1, 'velocity 500 gpm 5"');
  console.log('✓ basic hydraulics');
}

// 5. Two-head branch line (hand calc)
{
  const bl = calculateBranchLine({
    k: 5.6,
    headCount: 2,
    spacingFt: 10,
    pipe: { nominalIn: 1, schedule: 'sch40', c: 120 },
    startPressurePsi: 7,
    prefix: 'T-'
  });
  near(bl.headFlowsGpm[0], 14.8162, 0.05, 'head 1 flow');
  near(bl.headPressuresPsi[1], 7.7470, 0.1, 'head 2 pressure');
  near(bl.headFlowsGpm[1], 15.5868, 0.1, 'head 2 flow');
  near(bl.totalFlowGpm, 30.403, 0.1, 'branch total');
  // final half-spacing segment 5 ft + 1" tee (5 ft) = 10 ft at 30.40 gpm
  near(bl.inletPressurePsi, 10.571, 0.2, 'branch inlet pressure');
  near(bl.equivalentK, 30.403 / Math.sqrt(10.571), 0.3, 'branch equivalent K');
  assert(bl.rows.length === 2, `branch rows = segments (2), got ${bl.rows.length}`);
  const r0 = bl.rows[0];
  near(r0.ptEndPsi, r0.ptStartPsi + r0.pfPsi + r0.pePsi, 0.001, 'row Pt balance');
  assert(r0.fromNode === 'T-1' && bl.rows[1].toNode === 'T-0', 'node naming');
  console.log('✓ branch line');
}

// 6. Remote area (OH2, 1¼" branch / 3" cross-main) — oracle values
{
  const input: FireDesignInput = {
    ...DEFAULT_FIRE_INPUT,
    hazard: 'ordinary-2',
    densityGpmFt2: undefined,
    designAreaFt2: undefined,
    sprinklerCoverageFt2: undefined,
    sprinklerK: 5.6,
    branchLinePipe: { nominalIn: 1.25, schedule: 'sch40', c: 120 },
    crossMainPipe: { nominalIn: 3, schedule: 'sch40', c: 120 },
    riser: { pipe: { nominalIn: 6, schedule: 'sch40', c: 120 }, lengthFt: 40, elevationRiseFt: 40, fittings: { 'tee-branch': 1, 'alarm-check': 1, 'gate-valve': 1 } },
    feedMain: { pipe: { nominalIn: 6, schedule: 'sch40', c: 120 }, lengthFt: 150, elevationRiseFt: 0, fittings: { 'elbow-90': 4, 'tee-branch': 1, 'gate-valve': 1 } }
  };
  const s = calculateSprinklerDemand(input);
  near(s.spacingFt, 11.4018, 0.05, 'spacing √130');
  assert(s.sprinklersInArea === 12, `sprinklers in area 12, got ${s.sprinklersInArea}`);
  assert(s.headsPerBranch === 5, `heads per branch 5, got ${s.headsPerBranch}`);
  assert(s.branchLines === 3, `branch lines 3, got ${s.branchLines}`);
  near(s.minHeadFlowGpm, 26, 0.01, 'min head flow');
  near(s.remoteHeadPressurePsi, 21.556, 0.05, 'remote head pressure');
  near(s.sprinklerFlowGpm, 438.69, 0.3, 'sprinkler demand flow');
  near(s.pressureAtPumpDischargePsi, 81.54, 0.5, 'pressure at pump discharge');
  assert(s.sprinklerFlowGpm >= s.densityGpmFt2 * s.designAreaFt2, 'flow ≥ density × area');
  const last = s.rows[s.rows.length - 1];
  assert(last.toNode === 'PD', `last node PD, got ${last.toNode}`);
  assert(s.rows.some((r) => r.toNode === 'RB') && s.rows.some((r) => r.toNode === 'RT'), 'riser nodes RT/RB');
  const riserRow = s.rows.find((r) => r.fromNode === 'RT')!;
  near(riserRow.pePsi, 0.433 * 40, 0.01, 'riser elevation pressure');
  for (const r of s.rows) {
    assert(Math.abs(r.ptEndPsi - (r.ptStartPsi + r.pfPsi + r.pePsi)) < 1e-6, `row ${r.fromNode}->${r.toNode} balance`);
  }
  for (let i = 1; i < s.rows.length; i++) {
    assert(Math.abs(s.rows[i].ptStartPsi - s.rows[i - 1].ptEndPsi) < 1e-6, `pressure continuity at ${s.rows[i].fromNode}`);
  }
  console.log('✓ remote area node-to-node calc');
}

// 7. Standpipe & system demand on defaults (2" branch, 4" cross-main)
{
  const sp = calculateStandpipeDemand(DEFAULT_FIRE_INPUT);
  assert(sp.applicable && sp.flowGpm === 750, `standpipe 750 gpm, got ${sp.flowGpm}`);
  near(sp.pressureAtPumpDischargePsi, 100 + 0.433 * 45 + 10, 0.01, 'standpipe pressure');
  assert(sp.durationMin === 30, 'standpipe duration');

  const d = calculateSystemDemand(DEFAULT_FIRE_INPUT);
  near(d.sprinkler.sprinklerFlowGpm, 397.82, 0.3, 'default sprinkler flow');
  near(d.sprinkler.pressureAtPumpDischargePsi, 47.61, 0.5, 'default sprinkler pressure');
  assert(d.governingCase === 'standpipe', 'standpipe governs default');
  assert(d.pumpDemandFlowGpm === 750, `pump demand flow 750, got ${d.pumpDemandFlowGpm}`);
  near(d.pumpDemandPressurePsi, 129.485, 0.05, 'pump demand pressure');
  assert(d.durationMin === 90 && d.hoseAllowanceTotalGpm === 250, 'duration & hose');
  near(d.requiredStorageGal, (397.82 + 250) * 90, 0.3, 'required storage');

  const noStand = calculateSystemDemand({ ...DEFAULT_FIRE_INPUT, standpipeClass: 'none' });
  assert(noStand.governingCase === 'sprinkler', 'sprinkler governs without standpipe');
  near(noStand.pumpDemandFlowGpm, 397.82 + 100, 0.3, 'pump flow = sprinkler + inside hose');
  console.log('✓ standpipe & system demand');
}

console.log('\nAll fire standards & hydraulics tests passed.');
