/**
 * Fire protection hydraulics (NFPA 13 density/area method, NFPA 14 standpipe demand).
 * Pure functions, US customary units (gpm, psi, ft, in).
 */
import {
  BranchLineResult,
  FireDesignInput,
  FittingType,
  HydraulicNodeRow,
  PipeRun,
  PipeSpec,
  SprinklerDemandResult,
  StandpipeDemandResult,
  SystemDemand
} from './fpTypes';
import { HAZARD_DESIGN, MIN_END_HEAD_PRESSURE_PSI, equivalentLengthFt } from './standards/nfpa13';
import { STANDPIPE_DURATION_MIN, standpipeFlowGpm, standpipeResidualPsi } from './standards/nfpa14';
import { internalDiameterIn } from './standards/pipeData';

/** Hazen-Williams friction loss, psi/ft (NFPA 13-2019 §28.2.2.1). */
export function hazenWilliamsPsiPerFt(qGpm: number, idIn: number, c: number): number {
  return (4.52 * Math.pow(qGpm, 1.85)) / (Math.pow(c, 1.85) * Math.pow(idIn, 4.87));
}

/** Sprinkler discharge q = K sqrt(P), gpm (NFPA 13-2019 §28.2.4.8). */
export function sprinklerFlow(k: number, pPsi: number): number {
  return k * Math.sqrt(pPsi);
}

/** Pressure required for a given sprinkler flow P = (q/K)^2, psi (NFPA 13-2019 §28.2.4.8). */
export function sprinklerPressure(k: number, qGpm: number): number {
  return Math.pow(qGpm / k, 2);
}

/** Elevation (static) pressure, psi = 0.433 x ft (NFPA 13-2019 §28.2.5). */
export function elevationPsi(ft: number): number {
  return 0.433 * ft;
}

/** Water velocity in a pipe, ft/s = 0.4085 Q / d^2 (NFPA 13-2019 §28.2.4.2 velocity pressure note). */
export function velocityFps(qGpm: number, idIn: number): number {
  return (0.4085 * qGpm) / (idIn * idIn);
}

/** psi to bar. */
export function psiToBar(p: number): number {
  return p * 0.0689476;
}
/** gpm to L/min. */
export function gpmToLpm(q: number): number {
  return q * 3.785411784;
}
/** ft to m. */
export function ftToM(f: number): number {
  return f * 0.3048;
}
/** US gallons to m3. */
export function galToM3(g: number): number {
  return g * 0.003785411784;
}

const FITTING_ABBR: [FittingType, string][] = [
  ['elbow-90', 'E'],
  ['elbow-45', '45'],
  ['long-turn-elbow-90', 'LE'],
  ['tee-branch', 'T'],
  ['butterfly-valve', 'BV'],
  ['gate-valve', 'GV'],
  ['swing-check', 'CV'],
  ['alarm-check', 'AC'],
  ['angle-hose-valve', 'HV']
];

/**
 * Total equivalent length of a fitting set, ft, plus a short description such as "2E 1T 1GV"
 * (NFPA 13-2019 Table 28.2.3.1.1).
 */
export function fittingsEquivalentFt(
  fittings: Partial<Record<FittingType, number>>,
  pipe: PipeSpec
): { eqFt: number; desc: string } {
  let eqFt = 0;
  const parts: string[] = [];
  for (const [type, abbr] of FITTING_ABBR) {
    const n = fittings[type] ?? 0;
    if (n <= 0) continue;
    eqFt += n * equivalentLengthFt(type, pipe.nominalIn, pipe.c, pipe.schedule);
    parts.push(`${n}${abbr}`);
  }
  return { eqFt, desc: parts.join(' ') };
}

/**
 * One node-to-node Hazen-Williams segment: Pf = pf/ft x (L + Leq), Pe = 0.433 x rise,
 * Pt(end) = Pt(start) + Pf + Pe (NFPA 13-2019 §28.2).
 */
export function calculatePipeSegment(args: {
  fromNode: string;
  toNode: string;
  description: string;
  flowAddedGpm: number;
  kFactor?: number;
  totalFlowGpm: number;
  startPressurePsi: number;
  run: PipeRun;
}): HydraulicNodeRow {
  const { run } = args;
  const idIn = internalDiameterIn(run.pipe.nominalIn, run.pipe.schedule);
  const { eqFt, desc } = fittingsEquivalentFt(run.fittings, run.pipe);
  const totalLengthFt = run.lengthFt + eqFt;
  const pfPerFt = hazenWilliamsPsiPerFt(args.totalFlowGpm, idIn, run.pipe.c);
  const pfPsi = pfPerFt * totalLengthFt;
  const pePsi = elevationPsi(run.elevationRiseFt);
  return {
    fromNode: args.fromNode,
    toNode: args.toNode,
    description: args.description,
    kFactor: args.kFactor,
    flowAddedGpm: args.flowAddedGpm,
    totalFlowGpm: args.totalFlowGpm,
    nominalIn: run.pipe.nominalIn,
    idIn,
    c: run.pipe.c,
    lengthFt: run.lengthFt,
    fittingsDesc: desc,
    fittingsEqFt: eqFt,
    totalLengthFt,
    pfPerFt,
    pfPsi,
    elevationFt: run.elevationRiseFt,
    pePsi,
    ptStartPsi: args.startPressurePsi,
    ptEndPsi: args.startPressurePsi + pfPsi + pePsi,
    velocityFps: velocityFps(args.totalFlowGpm, idIn)
  };
}

/**
 * Branch line calculated from the remote head toward the cross-main (NFPA 13-2019 §28.2.4.8).
 * Heads are numbered from the remote end; nodes `${prefix}1..n`, inlet `${prefix}0`.
 * The final segment (head n to inlet) is S/2 long with one tee-branch fitting.
 */
export function calculateBranchLine(args: {
  k: number;
  headCount: number;
  spacingFt: number;
  pipe: PipeSpec;
  startPressurePsi: number;
  prefix: string;
}): BranchLineResult {
  const { k, headCount, spacingFt, pipe, prefix } = args;
  const headFlowsGpm: number[] = [];
  const headPressuresPsi: number[] = [];
  const rows: HydraulicNodeRow[] = [];
  let p = args.startPressurePsi;
  let qCum = 0;
  for (let i = 1; i <= headCount; i++) {
    const q = sprinklerFlow(k, p);
    headFlowsGpm.push(q);
    headPressuresPsi.push(p);
    qCum += q;
    const last = i === headCount;
    const row = calculatePipeSegment({
      fromNode: `${prefix}${i}`,
      toNode: last ? `${prefix}0` : `${prefix}${i + 1}`,
      description: last ? 'Branch line to cross-main' : `Branch line, head ${i} to ${i + 1}`,
      flowAddedGpm: q,
      kFactor: k,
      totalFlowGpm: qCum,
      startPressurePsi: p,
      run: {
        pipe,
        lengthFt: last ? spacingFt / 2 : spacingFt,
        elevationRiseFt: 0,
        fittings: last ? { 'tee-branch': 1 } : {}
      }
    });
    rows.push(row);
    p = row.ptEndPsi;
  }
  return {
    headCount,
    headFlowsGpm,
    headPressuresPsi,
    totalFlowGpm: qCum,
    inletPressurePsi: p,
    equivalentK: qCum / Math.sqrt(p),
    rows
  };
}

/**
 * Density/area remote-area calculation from the remote head to the pump discharge
 * (NFPA 13-2019 §19.3.3, §28.2). Branch line 1 is calculated in full; the other branch
 * lines are assumed identical (same equivalent K) and flow according to cross-main pressure.
 */
export function calculateSprinklerDemand(input: FireDesignInput): SprinklerDemandResult {
  const hz = HAZARD_DESIGN[input.hazard];
  const density = input.densityGpmFt2 ?? hz.densityGpmFt2;
  const area = input.designAreaFt2 ?? hz.areaFt2;
  const coverage = input.sprinklerCoverageFt2 ?? hz.maxCoverageFt2;
  const spacing = Math.min(Math.sqrt(coverage), hz.maxSpacingFt);
  const eps = 1e-9;
  const nArea = Math.ceil(area / coverage - eps);
  const headsPerBranch = Math.ceil((1.2 * Math.sqrt(area)) / spacing - eps);
  const branchLines = Math.ceil(nArea / headsPerBranch - eps);
  const minHeadFlow = density * coverage;
  const remoteHeadPressure = Math.max(MIN_END_HEAD_PRESSURE_PSI, sprinklerPressure(input.sprinklerK, minHeadFlow));

  const bl = calculateBranchLine({
    k: input.sprinklerK,
    headCount: headsPerBranch,
    spacingFt: spacing,
    pipe: input.branchLinePipe,
    startPressurePsi: remoteHeadPressure,
    prefix: 'BL1-'
  });
  const rows: HydraulicNodeRow[] = [...bl.rows];

  // Cross-main: nodes CM1..CMm. Flow of branch line j is added at CMj.
  let pressure = bl.inletPressurePsi;
  let qSum = bl.totalFlowGpm;
  let lastAdded = bl.totalFlowGpm;
  for (let j = 1; j <= branchLines; j++) {
    const lastSeg = j === branchLines;
    const row = calculatePipeSegment({
      fromNode: `CM${j}`,
      toNode: lastSeg ? 'RT' : `CM${j + 1}`,
      description: `Branch line ${j}`,
      flowAddedGpm: lastAdded,
      totalFlowGpm: qSum,
      startPressurePsi: pressure,
      run: {
        pipe: input.crossMainPipe,
        lengthFt: spacing,
        elevationRiseFt: 0,
        fittings: lastSeg ? { 'tee-branch': 1 } : {}
      }
    });
    rows.push(row);
    pressure = row.ptEndPsi;
    if (!lastSeg) {
      lastAdded = bl.equivalentK * Math.sqrt(pressure);
      qSum += lastAdded;
    }
  }

  const riserRow = calculatePipeSegment({
    fromNode: 'RT',
    toNode: 'RB',
    description: 'Riser',
    flowAddedGpm: 0,
    totalFlowGpm: qSum,
    startPressurePsi: pressure,
    run: input.riser
  });
  rows.push(riserRow);
  const feedRow = calculatePipeSegment({
    fromNode: 'RB',
    toNode: 'PD',
    description: 'Feed main to pump discharge',
    flowAddedGpm: 0,
    totalFlowGpm: qSum,
    startPressurePsi: riserRow.ptEndPsi,
    run: input.feedMain
  });
  rows.push(feedRow);

  return {
    densityGpmFt2: density,
    designAreaFt2: area,
    coverageFt2: coverage,
    spacingFt: spacing,
    sprinklersInArea: nArea,
    headsPerBranch,
    branchLines,
    minHeadFlowGpm: minHeadFlow,
    remoteHeadPressurePsi: remoteHeadPressure,
    sprinklerFlowGpm: qSum,
    pressureAtPumpDischargePsi: feedRow.ptEndPsi,
    rows
  };
}

/**
 * Standpipe demand at the pump discharge (NFPA 14-2019 §7.10 flow, §7.8 residual):
 * P = residual + 0.433 x top outlet height + friction.
 */
export function calculateStandpipeDemand(input: FireDesignInput): StandpipeDemandResult {
  const applicable = input.standpipeClass !== 'none';
  const flowGpm = standpipeFlowGpm(input.standpipeClass, input.standpipeCount, input.buildingSprinklered);
  const residual = standpipeResidualPsi(input.standpipeClass);
  return {
    applicable,
    flowGpm,
    residualPressurePsi: residual,
    pressureAtPumpDischargePsi: applicable ? residual + elevationPsi(input.standpipeTopOutletHeightFt) + input.standpipeFrictionPsi : 0,
    durationMin: STANDPIPE_DURATION_MIN
  };
}

/**
 * Governing system demand at the pump flange and required storage
 * (NFPA 13-2019 §19.3.3.1.2 hose allowance & duration; NFPA 14-2019 §7.10; NFPA 22-2018 capacity).
 */
export function calculateSystemDemand(input: FireDesignInput, overrides?: { standpipe?: StandpipeDemandResult; sprinkler?: SprinklerDemandResult }): SystemDemand {
  const hz = HAZARD_DESIGN[input.hazard];
  const sprinkler = overrides?.sprinkler ?? calculateSprinklerDemand(input);
  const standpipe = overrides?.standpipe ?? calculateStandpipeDemand(input);
  const hoseInside = input.insideHoseGpm;
  const hoseTotal = input.totalHoseAllowanceGpm ?? hz.hoseTotalGpm;
  const duration = input.durationMin ?? hz.durationMin[1];

  const qSprCase = sprinkler.sprinklerFlowGpm + hoseInside;
  const pSprCase = sprinkler.pressureAtPumpDischargePsi;
  let pumpFlow = qSprCase;
  let pumpPressure = pSprCase;
  let governing: 'sprinkler' | 'standpipe' = 'sprinkler';
  if (standpipe.applicable) {
    pumpFlow = Math.max(qSprCase, standpipe.flowGpm);
    pumpPressure = Math.max(pSprCase, standpipe.pressureAtPumpDischargePsi);
    governing = standpipe.flowGpm > qSprCase ? 'standpipe' : 'sprinkler';
  }
  const requiredStorageGal = Math.ceil(
    Math.max((sprinkler.sprinklerFlowGpm + hoseTotal) * duration, standpipe.applicable ? standpipe.flowGpm * STANDPIPE_DURATION_MIN : 0)
  );
  return {
    sprinkler,
    standpipe,
    hoseAllowanceInsideGpm: hoseInside,
    hoseAllowanceTotalGpm: hoseTotal,
    durationMin: duration,
    pumpDemandFlowGpm: pumpFlow,
    pumpDemandPressurePsi: pumpPressure,
    governingCase: governing,
    requiredStorageGal
  };
}
