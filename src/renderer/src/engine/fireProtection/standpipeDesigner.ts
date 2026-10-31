/**
 * NFPA 14 standpipe system design: floor-by-floor outlets, node-to-node hydraulics of every
 * riser, governing riser, outlet static / residual pressures, PRVs, FDC, drains and checks.
 * Follows docs/superpowers/plans/2026-10-31-standpipe-system-design.md §S1.3.
 */
import {
  DesignCheck,
  FireDesignInput,
  FloorLevel,
  HydraulicNodeRow,
  PipeRun,
  PipeSpec,
  PumpSetSelection,
  StandpipeOutlet,
  StandpipeRiserDesign,
  StandpipeSystemDesign
} from './fpTypes';
import { calculatePipeSegment, elevationPsi } from './hydraulics';
import { pumpCenterlineHeightM } from './pumpRoomDesigner';
import {
  HIGH_RISE_FT,
  HOSE_1_5_LIMIT_PSI,
  HOSE_OUTLET_STATIC_LIMIT_PSI,
  HOSE_VALVE_HEIGHT_RANGE_MM,
  MAX_ZONE_HEIGHT_FT,
  STANDPIPE_MAX_PRESSURE_PSI,
  standpipeFlowGpm,
  standpipeMinRiserSizeIn,
  standpipeOutletSizeIn,
  standpipeResidualPsi
} from './standards/nfpa14';
import { formatPipeSize } from './standards/pipeData';

const FT_PER_M = 3.28084;
const f1 = (v: number): string => v.toFixed(1);
const f2 = (v: number): string => v.toFixed(2);

/** True when the detailed floor-by-floor standpipe design applies. */
export function standpipeApplicable(input: FireDesignInput): boolean {
  return !!input.building && !!input.standpipeDesign && input.standpipeClass !== 'none' && input.standpipeDesign.locations.length > 0;
}

/** Absolute pump centre-line elevation (m, relative to ground-floor FFL). */
export function pumpCenterlineAbsM(input: FireDesignInput, ratedGpm: number): number {
  return (input.building?.pumpRoomFloorElevationM ?? 0) + pumpCenterlineHeightM(ratedGpm);
}

/** Sprinkler riser rise / length derived from the top sprinklered floor (ceiling = FFL + floor-to-floor − 0.30 m). */
export function derivedSprinklerRiser(input: FireDesignInput, pumpCLAbsM: number): PipeRun {
  const floors = (input.building?.floors ?? []).filter((f) => f.sprinklered && !f.isRoof);
  if (floors.length === 0) return input.riser;
  const top = floors.reduce((a, b) => (b.elevationM > a.elevationM ? b : a));
  const ceiling = top.elevationM + top.floorToFloorM - 0.3;
  const rise = (ceiling - pumpCLAbsM) * FT_PER_M;
  return { pipe: input.riser.pipe, lengthFt: rise, elevationRiseFt: rise, fittings: input.riser.fittings };
}

function highestOccupiedFfl(floors: FloorLevel[]): number {
  const occ = floors.filter((f) => !f.isRoof);
  return Math.max(...occ.map((f) => f.elevationM));
}

interface RiserCalc {
  riser: StandpipeRiserDesign;
  rows: HydraulicNodeRow[];
}

function emptyOutlet(tag: string, floor: FloorLevel, elevationM: number, sizeIn: number, isRoofOutlet: boolean): StandpipeOutlet {
  return {
    standpipeTag: tag,
    floorId: floor.id,
    floorName: floor.name,
    elevationM,
    sizeIn,
    isRoofOutlet,
    flowing: false,
    flowGpm: 0,
    staticPsi: 0,
    residualPsi: 0,
    prvRequired: false,
    prvSetPsi: null
  };
}

/** Standpipe system hydraulics (outlet pressure fields are filled by analyzeStandpipeOutlets). */
export function designStandpipeHydraulics(input: FireDesignInput, pumpCLAbsM: number): StandpipeSystemDesign {
  const building = input.building!;
  const sd = input.standpipeDesign!;
  const cls = input.standpipeClass;
  const floors = building.floors;
  const roof = floors.find((f) => f.isRoof);
  const hvhM = sd.hoseValveHeightMm / 1000;
  const outletSize = standpipeOutletSizeIn(cls);
  const minRiser = standpipeMinRiserSizeIn(cls, sd.combinedWithSprinklers);
  const riserSize = sd.riserSizeIn ?? minRiser;
  const Q = standpipeFlowGpm(cls, sd.locations.length, input.buildingSprinklered);
  const mainSize = Q > 500 ? Math.max(riserSize, 6) : riserSize;
  const topResidual = standpipeResidualPsi(cls);
  const spec = (nominalIn: number): PipeSpec => ({ nominalIn, schedule: sd.pipe.schedule, c: sd.pipe.c });
  const anyServesRoof = sd.locations.some((l) => l.servesRoof);
  const baseFfl = floors[0].elevationM;

  const calcs: RiserCalc[] = sd.locations.map((loc, li) => {
    // outlets top → down
    const down: StandpipeOutlet[] = [];
    const hasRoofOutlet = !!roof && building.roofSlopeLessThan4in12 && (loc.servesRoof || (!anyServesRoof && li === 0));
    if (hasRoofOutlet && roof) down.push(emptyOutlet(loc.tag, roof, roof.elevationM + hvhM, outletSize, true));
    for (let i = floors.length - 1; i >= 0; i--) {
      const f = floors[i];
      if (f.isRoof || !f.hoseConnection) continue;
      down.push(emptyOutlet(loc.tag, f, f.elevationM + hvhM, outletSize, false));
    }
    const k = down.length;
    const q: number[] = down.map(() => 0);
    if (k > 0) {
      if (cls === 'II') q[0] = 100;
      else if (k === 1) q[0] = 500;
      else {
        q[0] = 250;
        q[1] = 250;
      }
    }
    const sumQ = q.reduce((a, b) => a + b, 0);
    const T = loc.tag;
    const rows: HydraulicNodeRow[] = [];
    let ptRequired = topResidual;
    if (k > 0) {
      const h1 = calculatePipeSegment({
        fromNode: `${T}-H1`,
        toNode: `${T}-S1`,
        description: `Hose valve ${down[0].floorName} to riser`,
        flowAddedGpm: q[0],
        totalFlowGpm: q[0],
        startPressurePsi: topResidual,
        run: { pipe: spec(outletSize), lengthFt: 1, elevationRiseFt: 0, fittings: { 'tee-branch': 1, 'angle-hose-valve': 1 } }
      });
      rows.push(h1);
      let cum = q[0];
      let p = h1.ptEndPsi;
      for (let i = 1; i <= k - 1; i++) {
        const dz = (down[i - 1].elevationM - down[i].elevationM) * FT_PER_M;
        const row = calculatePipeSegment({
          fromNode: `${T}-S${i}`,
          toNode: `${T}-S${i + 1}`,
          description: `Riser ${down[i - 1].floorName} to ${down[i].floorName}`,
          flowAddedGpm: i >= 2 ? q[i - 1] : 0,
          totalFlowGpm: cum,
          startPressurePsi: p,
          run: { pipe: spec(riserSize), lengthFt: dz, elevationRiseFt: dz, fittings: {} }
        });
        rows.push(row);
        p = row.ptEndPsi;
        cum += q[i];
      }
      const zk = (down[k - 1].elevationM - baseFfl) * FT_PER_M;
      const base = calculatePipeSegment({
        fromNode: `${T}-S${k}`,
        toNode: `${T}-SB`,
        description: 'Riser base',
        flowAddedGpm: k >= 2 ? q[k - 1] : 0,
        totalFlowGpm: sumQ,
        startPressurePsi: p,
        run: { pipe: spec(riserSize), lengthFt: zk, elevationRiseFt: zk, fittings: { 'elbow-90': 1 } }
      });
      rows.push(base);
      const main = calculatePipeSegment({
        fromNode: `${T}-SB`,
        toNode: 'PD',
        description: 'Supply main to pump discharge',
        flowAddedGpm: Q - sumQ,
        totalFlowGpm: Q,
        startPressurePsi: base.ptEndPsi,
        run: {
          pipe: spec(mainSize),
          lengthFt: loc.horizontalRunToPumpM * FT_PER_M,
          elevationRiseFt: (baseFfl - pumpCLAbsM) * FT_PER_M,
          fittings: { 'elbow-90': 2, 'tee-branch': 1, 'gate-valve': 1 }
        }
      });
      rows.push(main);
      ptRequired = main.ptEndPsi;
    }
    const outlets = [...down].reverse();
    const riser: StandpipeRiserDesign = {
      tag: T,
      location: loc.location,
      sizeIn: riserSize,
      bottomElevationM: baseFfl,
      topElevationM: k > 0 ? down[0].elevationM : baseFfl,
      horizontalRunToPumpM: loc.horizontalRunToPumpM,
      hasRoofOutlet,
      outlets,
      floorControlValveFloors:
        sd.combinedWithSprinklers && li === 0 ? floors.filter((f) => f.sprinklered && !f.isRoof).map((f) => f.id) : [],
      requiredPressureAtPumpPsi: ptRequired
    };
    return { riser, rows };
  });

  let gov = 0;
  calcs.forEach((c, i) => {
    if (c.riser.requiredPressureAtPumpPsi > calcs[gov].riser.requiredPressureAtPumpPsi) gov = i;
  });
  const govCalc = calcs[gov];
  const heightFt = (highestOccupiedFfl(floors) - building.fireDeptAccessElevationM) * FT_PER_M;

  const design: StandpipeSystemDesign = {
    applicable: true,
    systemType: sd.systemType,
    standpipeClass: cls,
    combined: sd.combinedWithSprinklers,
    riserSizeIn: riserSize,
    minRiserSizeIn: minRiser,
    supplyMainSizeIn: mainSize,
    risers: calcs.map((c) => c.riser),
    governingRiserTag: govCalc.riser.tag,
    demandFlowGpm: Q,
    topOutletResidualPsi: topResidual,
    pressureAtPumpDischargePsi: govCalc.riser.requiredPressureAtPumpPsi,
    rows: govCalc.rows,
    pumpCLElevationM: pumpCLAbsM,
    buildingHeightFt: heightFt,
    highRise: heightFt > HIGH_RISE_FT,
    fdc: fdcFor(Q, riserSize, sd.fdcInlets, sd.fdcDistanceToHydrantM),
    drainRiserIn: null,
    mainDrainIn: 2,
    hoseValveHeightMm: sd.hoseValveHeightMm,
    checks: []
  };
  return design;
}

function fdcFor(Q: number, riserSize: number, override: number | undefined, distM: number): StandpipeSystemDesign['fdc'] {
  return {
    inlets: override ?? Math.max(2, Math.ceil(Q / 250 - 1e-9)),
    inletSizeIn: 2.5,
    pipeSizeIn: Math.max(4, riserSize),
    heightAboveGradeMm: 900,
    distanceToHydrantM: distM
  };
}

/** Fill outlet static / residual pressures, PRVs, FDC, drains and the NFPA 14 / IBC / IFC checks. */
export function analyzeStandpipeOutlets(design: StandpipeSystemDesign, input: FireDesignInput, pumps: PumpSetSelection): StandpipeSystemDesign {
  const building = input.building!;
  const sd = input.standpipeDesign!;
  const main = pumps.mainPumps[0];
  const x = design.demandFlowGpm / main.ratedFlowGpm;
  const pNet = main.ratedNetPressurePsi * (1.2 + 0.066667 * x - 0.266667 * x * x);
  const discharge = pNet + pumps.suctionPressureMinPsi;
  const govRows = design.rows;
  const govMainPf = govRows.length > 0 ? govRows[govRows.length - 1].pfPsi : 0;

  const risers: StandpipeRiserDesign[] = design.risers.map((r) => {
    const isGov = r.tag === design.governingRiserTag;
    const k = r.outlets.length;
    const outlets = r.outlets.map((o, m) => {
      const i = k - m; // 1 = topmost outlet
      const z = (o.elevationM - design.pumpCLElevationM) * FT_PER_M;
      const staticPsi = pumps.maxSystemPressurePsi - elevationPsi(z);
      let friction = govMainPf;
      let flowGpm = 0;
      if (isGov) {
        friction = 0;
        for (let j = i; j < govRows.length; j++) friction += govRows[j].pfPsi;
        if (i === 1) friction += govRows[0].pfPsi;
        const hr = govRows[0];
        if (i === 1) flowGpm = hr.totalFlowGpm;
        else if (i === 2) flowGpm = govRows[2] ? govRows[2].flowAddedGpm : 0;
      }
      const residualPsi = discharge - elevationPsi(z) - friction;
      let prvRequired = false;
      let prvSetPsi: number | null = null;
      if (o.sizeIn >= 2.5) {
        if (staticPsi > HOSE_OUTLET_STATIC_LIMIT_PSI) {
          prvRequired = true;
          prvSetPsi = HOSE_OUTLET_STATIC_LIMIT_PSI;
        }
      } else if (residualPsi > HOSE_1_5_LIMIT_PSI || staticPsi > HOSE_OUTLET_STATIC_LIMIT_PSI) {
        prvRequired = true;
        prvSetPsi = HOSE_1_5_LIMIT_PSI;
      }
      return { ...o, flowGpm, flowing: flowGpm > 0, staticPsi, residualPsi, prvRequired, prvSetPsi };
    });
    return { ...r, outlets };
  });

  const Q = design.demandFlowGpm;
  const fdc = fdcFor(Q, design.riserSizeIn, sd.fdcInlets, sd.fdcDistanceToHydrantM);
  const prvOutlets = risers.flatMap((r) => r.outlets).filter((o) => o.prvRequired);
  const out: StandpipeSystemDesign = {
    ...design,
    risers,
    fdc,
    drainRiserIn: prvOutlets.length > 0 ? 3 : null,
    mainDrainIn: 2
  };
  out.checks = standpipeChecks(out, input, pumps, building.floors, prvOutlets);
  return out;
}

function standpipeChecks(
  d: StandpipeSystemDesign,
  input: FireDesignInput,
  pumps: PumpSetSelection,
  floors: FloorLevel[],
  prvOutlets: StandpipeOutlet[]
): DesignCheck[] {
  const sd = input.standpipeDesign!;
  const building = input.building!;
  const checks: DesignCheck[] = [];
  const gov = d.risers.find((r) => r.tag === d.governingRiserTag) ?? d.risers[0];

  checks.push({
    id: 'sp-riser-size',
    title: 'Standpipe riser size',
    reference: 'NFPA 14-2019 §7.6.1 (min 4"; 6" when combined with sprinklers; Class II 2")',
    status: d.riserSizeIn >= d.minRiserSizeIn ? 'pass' : 'fail',
    detail: `Riser ${formatPipeSize(d.riserSizeIn)} vs minimum ${formatPipeSize(d.minRiserSizeIn)} (Class ${d.standpipeClass}, ${d.combined ? 'combined with sprinklers' : 'standpipe only'}); supply main ${formatPipeSize(d.supplyMainSizeIn)}`
  });

  const missing = floors.filter((f) => !f.isRoof && !f.hoseConnection).map((f) => f.name);
  checks.push({
    id: 'sp-hose-connections',
    title: 'Hose connection at every floor level',
    reference: 'NFPA 14-2019 §7.3.2.1; IBC 2021 §905.4 (each floor landing of every required exit stair)',
    status: missing.length === 0 ? 'pass' : 'fail',
    detail: missing.length === 0 ? `${floors.filter((f) => !f.isRoof).length} floor levels each have a hose connection on every standpipe` : `No hose connection at: ${missing.join(', ')}`
  });

  const roofOutlets = d.risers.flatMap((r) => r.outlets).filter((o) => o.isRoofOutlet);
  const roofReq = building.roofSlopeLessThan4in12;
  checks.push({
    id: 'sp-roof-outlet',
    title: 'Roof hose connection',
    reference: 'NFPA 14-2019 §7.3.2.2; IBC 2021 §905.4 item 5 (roof slope < 4 in 12)',
    status: !roofReq || roofOutlets.length > 0 ? 'pass' : 'fail',
    detail: roofReq
      ? roofOutlets.length > 0
        ? `Roof slope < 4 in 12: roof outlet provided on ${roofOutlets.map((o) => o.standpipeTag).join(', ')} at +${f2(roofOutlets[0].elevationM)} m`
        : 'Roof slope < 4 in 12 but no roof outlet could be placed (no roof level defined)'
      : 'Roof slope ≥ 4 in 12: roof hose connection not required'
  });

  const topOutlet = gov.outlets[gov.outlets.length - 1];
  const topRes = topOutlet ? topOutlet.residualPsi : 0;
  checks.push({
    id: 'sp-top-residual',
    title: 'Residual pressure at the topmost outlet',
    reference: 'NFPA 14-2019 §7.8.1 (100 psi at 2½" outlet, 65 psi at 1½")',
    status: topRes >= d.topOutletResidualPsi ? 'pass' : 'fail',
    detail: `${gov.tag} top outlet (${topOutlet?.floorName ?? '-'}) residual ${f1(topRes)} psi at ${d.demandFlowGpm} gpm vs required ${d.topOutletResidualPsi} psi with the selected pump (${pumps.mainPumps[0].ratedFlowGpm} gpm @ ${pumps.mainPumps[0].ratedNetPressurePsi} psi)`
  });

  const maxStatic = Math.max(...d.risers.flatMap((r) => r.outlets).map((o) => o.staticPsi));
  checks.push({
    id: 'sp-max-pressure',
    title: 'Maximum system pressure',
    reference: 'NFPA 14-2019 §7.2.1 (max 350 psi anywhere in the system)',
    status: pumps.maxSystemPressurePsi <= STANDPIPE_MAX_PRESSURE_PSI ? 'pass' : 'fail',
    detail: `Maximum system pressure ${f1(pumps.maxSystemPressurePsi)} psi (churn + max static suction) vs limit ${STANDPIPE_MAX_PRESSURE_PSI} psi`
  });

  checks.push({
    id: 'sp-components',
    title: 'Component pressure rating at the lowest outlet',
    reference: 'NFPA 14-2019 §7.2.1, §6.3 (components rated for maximum working pressure)',
    status: maxStatic <= input.systemComponentRatingPsi ? 'pass' : 'fail',
    detail: `Maximum static pressure at the lowest outlet ${f1(maxStatic)} psi vs component rating ${input.systemComponentRatingPsi} psi`
  });

  checks.push({
    id: 'sp-prv',
    title: 'Pressure-regulating devices on hose outlets',
    reference: 'NFPA 14-2019 §7.2.3 (2½" outlet static > 175 psi; 1½" residual > 100 psi)',
    status: 'pass',
    detail:
      prvOutlets.length === 0
        ? 'No outlet exceeds 175 psi static; no pressure-regulating device required'
        : d.risers
            .filter((r) => r.outlets.some((o) => o.prvRequired))
            .map((r) => {
              const o = r.outlets.filter((q) => q.prvRequired);
              return `${r.tag}: ${o.map((q) => q.floorId).join(', ')} (set ${o[0].prvSetPsi} psi)`;
            })
            .join('; ')
  });

  checks.push({
    id: 'sp-drain-riser',
    title: 'Drain riser and main drain',
    reference: 'NFPA 14-2019 §7.11 (3" drain riser with PRVs; 2" main drain at base)',
    status: 'pass',
    detail: d.drainRiserIn
      ? `${d.drainRiserIn}" drain riser adjacent to each standpipe with PRVs (${prvOutlets.length} PRVs), ${d.mainDrainIn}" main drain at the base of each riser`
      : `No PRVs: ${d.mainDrainIn}" main drain at the base of each riser, no drain riser needed`
  });

  const zoneFt = Math.max(...d.risers.map((r) => (r.topElevationM - r.bottomElevationM) * FT_PER_M));
  checks.push({
    id: 'sp-zone-height',
    title: 'Standpipe zone height',
    reference: 'NFPA 14-2019 §7.9 (max 275 ft per zone)',
    status: zoneFt <= MAX_ZONE_HEIGHT_FT ? 'pass' : 'warn',
    detail: `Tallest zone ${f1(zoneFt)} ft vs ${MAX_ZONE_HEIGHT_FT} ft${zoneFt > MAX_ZONE_HEIGHT_FT ? ' — divide into zones' : ''}`
  });

  const needInlets = Math.ceil(d.demandFlowGpm / 250 - 1e-9);
  const fdcOk = d.fdc.inlets >= needInlets && d.fdc.pipeSizeIn >= 4 && d.fdc.distanceToHydrantM <= 30.5;
  checks.push({
    id: 'sp-fdc',
    title: 'Fire department connection',
    reference: 'NFPA 14-2019 §6.4, §7.12; IFC 2021 §912 (one 2½" inlet per 250 gpm, ≤ 30.5 m to hydrant)',
    status: fdcOk ? 'pass' : 'warn',
    detail: `${d.fdc.inlets} × ${d.fdc.inletSizeIn}" inlets (need ${needInlets} for ${d.demandFlowGpm} gpm), ${d.fdc.pipeSizeIn}" pipe, ${d.fdc.heightAboveGradeMm} mm above grade (18–48 in), check valve + automatic drip, hydrant ${f1(d.fdc.distanceToHydrantM)} m (max 30.5 m)`
  });

  const [hMin, hMax] = HOSE_VALVE_HEIGHT_RANGE_MM;
  checks.push({
    id: 'sp-hose-valve-height',
    title: 'Hose valve height above floor',
    reference: 'NFPA 14-2019 §7.3.1.1 (3 ft – 5 ft, 900–1500 mm)',
    status: sd.hoseValveHeightMm >= hMin && sd.hoseValveHeightMm <= hMax ? 'pass' : 'fail',
    detail: `Hose valve centre ${sd.hoseValveHeightMm} mm above the landing; allowed ${hMin}–${hMax} mm`
  });

  checks.push({
    id: 'sp-high-rise',
    title: 'High-rise classification',
    reference: 'IBC 2021 §202 / §403 (> 75 ft above fire department access); §913.2.1 (2-h pump room)',
    status: 'pass',
    detail: `Highest occupied floor ${f1(d.buildingHeightFt)} ft above fire department access: ${d.highRise ? 'high-rise (> 75 ft), 2-h fire-rated pump room' : 'not high-rise, 1-h fire-rated pump room'}`
  });

  return checks;
}
