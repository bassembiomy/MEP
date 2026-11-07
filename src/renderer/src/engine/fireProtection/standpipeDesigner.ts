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
  StandpipeSolution,
  StandpipeSystemDesign,
  StandpipeZone,
  StandpipeZoningStudy
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
export function derivedSprinklerRiser(input: FireDesignInput, pumpCLAbsM: number, maxFfl = Infinity): PipeRun {
  const floors = (input.building?.floors ?? []).filter((f) => f.sprinklered && !f.isRoof && f.elevationM <= maxFfl + 1e-9);
  if (floors.length === 0 && maxFfl !== Infinity) return input.riser;
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

/** Design basis shared by the single-zone calculation and the zone requirement calculations (standpipeZoning.ts). */
export interface RiserCalcContext {
  cls: FireDesignInput['standpipeClass'];
  outletSizeIn: number;
  riserSizeIn: number;
  minRiserSizeIn: number;
  mainSizeIn: number;
  /** Full standpipe demand flow, gpm. */
  demandGpm: number;
  topResidualPsi: number;
}

export function riserCalcContext(input: FireDesignInput): RiserCalcContext {
  const sd = input.standpipeDesign!;
  const cls = input.standpipeClass;
  const minRiser = standpipeMinRiserSizeIn(cls, sd.combinedWithSprinklers);
  const riserSize = sd.riserSizeIn ?? minRiser;
  const Q = standpipeFlowGpm(cls, sd.locations.length, input.buildingSprinklered);
  return {
    cls,
    outletSizeIn: standpipeOutletSizeIn(cls),
    riserSizeIn: riserSize,
    minRiserSizeIn: minRiser,
    mainSizeIn: Q > 500 ? Math.max(riserSize, 6) : riserSize,
    demandGpm: Q,
    topResidualPsi: standpipeResidualPsi(cls)
  };
}

/**
 * Node-to-node calculation of one riser (or one zone band of it) from the topmost outlet down to the pump discharge.
 * `down` lists the outlets top → bottom. Node names: `${prefix}-H1 … ${prefix}-SB` and `pdNode`.
 */
export function calcRiserBand(
  ctx: RiserCalcContext,
  pipe: { schedule: PipeSpec['schedule']; c: number },
  down: StandpipeOutlet[],
  prefix: string,
  pdNode: string,
  baseFfl: number,
  horizontalRunM: number,
  pumpCLAbsM: number,
  verticalSupply = false
): { rows: HydraulicNodeRow[]; ptRequired: number } {
  const spec = (nominalIn: number): PipeSpec => ({ nominalIn, schedule: pipe.schedule, c: pipe.c });
  const { cls, outletSizeIn: outletSize, riserSizeIn: riserSize, mainSizeIn: mainSize, demandGpm: Q, topResidualPsi: topResidual } = ctx;
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
  const T = prefix;
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
      toNode: pdNode,
      description: 'Supply main to pump discharge',
      flowAddedGpm: Q - sumQ,
      totalFlowGpm: Q,
      startPressurePsi: base.ptEndPsi,
      run: {
        pipe: spec(mainSize),
        lengthFt: horizontalRunM * FT_PER_M + (verticalSupply ? Math.abs(baseFfl - pumpCLAbsM) * FT_PER_M : 0),
        elevationRiseFt: (baseFfl - pumpCLAbsM) * FT_PER_M,
        fittings: { 'elbow-90': 2, 'tee-branch': 1, 'gate-valve': 1 }
      }
    });
    rows.push(main);
    ptRequired = main.ptEndPsi;
  }
  return { rows, ptRequired };
}

export function emptyOutlet(tag: string, floor: FloorLevel, elevationM: number, sizeIn: number, isRoofOutlet: boolean): StandpipeOutlet {
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
    prvSetPsi: null,
    zoneId: 'Z1'
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
  const ctx = riserCalcContext(input);
  const { outletSizeIn: outletSize, minRiserSizeIn: minRiser, riserSizeIn: riserSize, mainSizeIn: mainSize, demandGpm: Q, topResidualPsi: topResidual } = ctx;
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
    const { rows, ptRequired } = calcRiserBand(ctx, sd.pipe, down, loc.tag, 'PD', baseFfl, loc.horizontalRunToPumpM, pumpCLAbsM);
    const outlets = [...down].reverse();
    const riser: StandpipeRiserDesign = {
      tag: loc.tag,
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
    zoning: pendingZoningStudy(sd.prvStrategy ?? 'avoid', sd.serviceFloorIds),
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

/** Empty zoning study returned by designStandpipeHydraulics; the engine fills it (standpipeZoning.ts). */
export function pendingZoningStudy(strategy: StandpipeZoningStudy['strategy'], serviceFloorIds: string[] | null | undefined): StandpipeZoningStudy {
  const empty = (kind: StandpipeSolution['kind']): StandpipeSolution => ({
    kind,
    zones: [],
    prvCount: 0,
    pumpSets: 0,
    expressRisers: 0,
    serviceFloorStations: [],
    maxStaticPsi: 0,
    feasible: false,
    summary: [],
    suggestion: null
  });
  return {
    strategy,
    serviceFloorsAnswered: Array.isArray(serviceFloorIds),
    serviceFloorIds: Array.isArray(serviceFloorIds) ? [...serviceFloorIds] : [],
    withPrv: empty('with-prv'),
    withoutPrv: empty('without-prv'),
    selected: strategy === 'allow' ? 'with-prv' : 'without-prv'
  };
}

/** Pump that feeds a zone (rated point, curve shape, suction and centre-line). */
export interface ZonePumpModel {
  ratedFlowGpm: number;
  ratedNetPressurePsi: number;
  shutoffRatio: number;
  suctionMinPsi: number;
  suctionMaxPsi: number;
  pumpCLElevationM: number;
}

export function zonePumpModel(z: StandpipeZone): ZonePumpModel {
  return {
    ratedFlowGpm: z.ratedFlowGpm,
    ratedNetPressurePsi: z.ratedNetPressurePsi,
    shutoffRatio: z.shutoffRatio,
    suctionMinPsi: z.station.suctionMinPsi,
    suctionMaxPsi: z.station.suctionMaxPsi,
    pumpCLElevationM: z.station.pumpCLElevationM
  };
}

/** Net pressure of a zone pump at flow `flowGpm` (NFPA 20 curve with shutoff ratio r: 150 % point stays at 65 %+). */
export function zonePumpNetPsi(p: ZonePumpModel, flowGpm: number): number {
  const x = flowGpm / p.ratedFlowGpm;
  const r = p.shutoffRatio;
  return p.ratedNetPressurePsi * (r + 0.066667 * x - (r - 1 + 0.066667) * x * x);
}

/**
 * Static / residual pressures, flow and PRV need of the outlets of one zone band of one riser (bottom → top).
 * `rows` is the zone's reference-riser node calculation; the reference riser's top outlets flow.
 */
export function zoneOutletPressures(
  outlets: StandpipeOutlet[],
  isRef: boolean,
  rows: HydraulicNodeRow[],
  pump: ZonePumpModel,
  demandGpm: number,
  zoneId: string
): StandpipeOutlet[] {
  const churnDischarge = pump.shutoffRatio * pump.ratedNetPressurePsi + pump.suctionMaxPsi;
  const discharge = zonePumpNetPsi(pump, demandGpm) + pump.suctionMinPsi;
  const mainPf = rows.length > 0 ? rows[rows.length - 1].pfPsi : 0;
  const k = outlets.length;
  return outlets.map((o, m) => {
    const i = k - m; // 1 = topmost outlet of the zone
    const z = (o.elevationM - pump.pumpCLElevationM) * FT_PER_M;
    const staticPsi = churnDischarge - elevationPsi(z);
    let friction = mainPf;
    let flowGpm = 0;
    if (isRef && rows.length > 0) {
      friction = 0;
      for (let j = i; j < rows.length; j++) friction += rows[j].pfPsi;
      if (i === 1) friction += rows[0].pfPsi;
      if (i === 1) flowGpm = rows[0].totalFlowGpm;
      else if (i === 2) flowGpm = rows[2] ? rows[2].flowAddedGpm : 0;
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
    return { ...o, zoneId, flowGpm, flowing: flowGpm > 0, staticPsi, residualPsi, prvRequired, prvSetPsi };
  });
}

/** Fill outlet static / residual pressures, PRVs, FDC, drains and the NFPA 14 / IBC / IFC checks of the selected solution. */
export function analyzeStandpipeOutlets(design: StandpipeSystemDesign, input: FireDesignInput, pumps: PumpSetSelection): StandpipeSystemDesign {
  const building = input.building!;
  const sd = input.standpipeDesign!;
  const main = pumps.mainPumps[0];
  const mainModel: ZonePumpModel = {
    ratedFlowGpm: main.ratedFlowGpm,
    ratedNetPressurePsi: main.ratedNetPressurePsi,
    shutoffRatio: 1.2,
    suctionMinPsi: pumps.suctionPressureMinPsi,
    suctionMaxPsi: pumps.maxStaticSuctionPsi,
    pumpCLElevationM: design.pumpCLElevationM
  };
  const study = design.zoning;
  const sol = study.selected === 'with-prv' ? study.withPrv : study.withoutPrv;
  // zone views: one per zone of the selected solution (zone 1 uses the actual main pumps); single zone fallback
  interface ZoneView {
    id: string;
    lo: number;
    hi: number;
    rows: HydraulicNodeRow[];
    refTag: string;
    pump: ZonePumpModel;
  }
  const views: ZoneView[] =
    sol.zones.length > 0
      ? sol.zones.map((z, zi) => ({
          id: z.id,
          lo: z.bottomOutletElevationM - 1e-6,
          hi: z.topOutletElevationM + 1e-6,
          rows: z.rows,
          refTag: z.governingRiserTag,
          pump: zi === 0 && z.station.kind === 'pump-room' ? mainModel : zonePumpModel(z)
        }))
      : [{ id: 'Z1', lo: -Infinity, hi: Infinity, rows: design.rows, refTag: design.governingRiserTag, pump: mainModel }];

  const risers: StandpipeRiserDesign[] = design.risers.map((r) => {
    const byId = new Map<string, StandpipeOutlet[]>();
    const assigned = r.outlets.map((o) => views.find((v) => o.elevationM >= v.lo && o.elevationM <= v.hi) ?? views[0]);
    for (const v of views) {
      const band = r.outlets.filter((_, idx) => assigned[idx] === v);
      byId.set(v.id, zoneOutletPressures(band, r.tag === v.refTag, v.rows, v.pump, design.demandFlowGpm, v.id));
    }
    const cursor = new Map<string, number>();
    const outlets = r.outlets.map((_, idx) => {
      const id = assigned[idx].id;
      const c = cursor.get(id) ?? 0;
      cursor.set(id, c + 1);
      return byId.get(id)![c];
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

  const zn = d.zoning;
  const sol = zn.selected === 'with-prv' ? zn.withPrv : zn.withoutPrv;
  const main0 = pumps.mainPumps[0];
  // top outlet of every zone (reference riser of the zone); a single zone = the governing riser as before
  const zoneTops = (sol.zones.length > 1 ? sol.zones : [null]).map((z) => {
    const rr = z ? (d.risers.find((r) => r.tag === z.governingRiserTag) ?? gov) : gov;
    const list = z ? rr.outlets.filter((o) => o.zoneId === z.id) : rr.outlets;
    const o = list[list.length - 1];
    return { zoneId: z ? z.id : 'Z1', riser: rr.tag, outlet: o, residual: o ? o.residualPsi : 0 };
  });
  const topRes = Math.min(...zoneTops.map((t) => t.residual));
  checks.push({
    id: 'sp-top-residual',
    title: 'Residual pressure at the topmost outlet',
    reference: 'NFPA 14-2019 §7.8.1 (100 psi at 2½" outlet, 65 psi at 1½")',
    status: topRes >= d.topOutletResidualPsi ? 'pass' : 'fail',
    detail:
      zoneTops.length === 1
        ? `${gov.tag} top outlet (${zoneTops[0].outlet?.floorName ?? '-'}) residual ${f1(topRes)} psi at ${d.demandFlowGpm} gpm vs required ${d.topOutletResidualPsi} psi with the selected pump (${main0.ratedFlowGpm} gpm @ ${main0.ratedNetPressurePsi} psi)`
        : `Top outlet of every pressure zone at ${d.demandFlowGpm} gpm vs required ${d.topOutletResidualPsi} psi: ${zoneTops.map((t) => `${t.zoneId} ${t.riser} ${t.outlet?.floorName ?? '-'} ${f1(t.residual)} psi`).join('; ')}; zone 1 pump ${main0.ratedFlowGpm} gpm @ ${main0.ratedNetPressurePsi} psi`
  });

  const maxStatic = Math.max(...d.risers.flatMap((r) => r.outlets).map((o) => o.staticPsi));
  const zoneChurnMax = Math.max(pumps.maxSystemPressurePsi, ...sol.zones.map((z) => z.churnDischargePsi));
  checks.push({
    id: 'sp-max-pressure',
    title: 'Maximum system pressure',
    reference: 'NFPA 14-2019 §7.2.1 (max 350 psi anywhere in the system)',
    status: zoneChurnMax <= STANDPIPE_MAX_PRESSURE_PSI ? 'pass' : 'fail',
    detail:
      sol.zones.length > 1
        ? `Maximum system pressure ${f1(zoneChurnMax)} psi (highest zone pump churn + max static suction; main pumps ${f1(pumps.maxSystemPressurePsi)} psi) vs limit ${STANDPIPE_MAX_PRESSURE_PSI} psi`
        : `Maximum system pressure ${f1(pumps.maxSystemPressurePsi)} psi (churn + max static suction) vs limit ${STANDPIPE_MAX_PRESSURE_PSI} psi`
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
        ? 'No pressure-regulating devices required: no outlet exceeds 175 psi static'
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

  const zoneHeights = (sol.zones.length > 0 ? sol.zones : [null]).map((z) => {
    const lo = z ? (z.id === 'Z1' ? Math.min(z.bottomOutletElevationM, ...d.risers.map((r) => r.bottomElevationM)) : z.bottomOutletElevationM) : null;
    const ft = Math.max(
      ...d.risers.map((r) => {
        const list = z ? r.outlets.filter((o) => o.zoneId === z.id) : r.outlets;
        if (list.length === 0) return 0;
        const top = list[list.length - 1].elevationM;
        return (top - (lo ?? r.bottomElevationM)) * FT_PER_M;
      })
    );
    return { id: z ? z.id : 'Z1', ft };
  });
  const zoneFt = Math.max(...zoneHeights.map((h) => h.ft));
  checks.push({
    id: 'sp-zone-height',
    title: 'Standpipe zone height',
    reference: 'NFPA 14-2019 §7.9 (max 275 ft per zone)',
    status: zoneFt <= MAX_ZONE_HEIGHT_FT ? 'pass' : 'warn',
    detail: `Tallest zone ${f1(zoneFt)} ft vs ${MAX_ZONE_HEIGHT_FT} ft${zoneFt > MAX_ZONE_HEIGHT_FT ? ' — divide into zones' : ''}${zoneHeights.length > 1 ? ` (${zoneHeights.map((h) => `${h.id} ${f1(h.ft)} ft`).join(', ')})` : ''}`
  });

  // --- pressure zoning (avoid PRVs) ---
  const svc = zn.serviceFloorIds;
  checks.push({
    id: 'sp-service-floors',
    title: 'Service floors for zone booster stations',
    reference: 'NFPA 14-2019 §7.9 (zones); NFPA 20-2019 §4.31 (break tanks); design question to the owner',
    status: zn.serviceFloorsAnswered ? 'pass' : 'warn',
    detail: zn.serviceFloorsAnswered
      ? svc.length > 0
        ? `Service floors available for a break tank + booster pump set: ${svc.join(', ')}`
        : 'No service floors: zones above the pump-room zone are fed by express risers from the pump room'
      : 'Not answered — answer: which floors are service floors (mechanical / technical floors that can host a break tank and a booster pump set)? The design is calculated without service floors (express risers from the pump room only); service floors reduce the pump pressure and can remove the PRVs of a tall building.'
  });
  const wo = zn.withoutPrv;
  const avoidable = wo.zones.length > 0 && wo.feasible;
  let zoningStatus: DesignCheck['status'] = 'pass';
  let zoningDetail: string;
  if (zn.selected === 'without-prv') {
    zoningDetail = wo.feasible
      ? `Pressure zoning without PRVs: ${wo.zones.length} zone(s), ${wo.pumpSets} pump set(s), ${wo.expressRisers} express riser(s), ${wo.serviceFloorStations.length} service-floor station(s); every outlet ≤ ${HOSE_OUTLET_STATIC_LIMIT_PSI} psi static (alternative with PRVs: ${zn.withPrv.prvCount} PRV(s))`
      : `PRVs cannot be completely avoided: ${wo.prvCount} outlet(s) still need a PRV. ${wo.suggestion ?? ''}`.trim();
    if (!wo.feasible) zoningStatus = 'warn';
  } else {
    zoningDetail = avoidable
      ? `Single zone with ${zn.withPrv.prvCount} PRV(s) selected although the PRVs can be avoided with ${wo.zones.length} pressure zone(s) (${wo.pumpSets} pump sets, ${wo.expressRisers} express riser(s)) — set the strategy to "avoid PRVs" to use zoning`
      : `Single zone with ${zn.withPrv.prvCount} PRV(s); PRVs cannot be completely avoided by zoning${wo.suggestion ? ` — ${wo.suggestion}` : ''}`;
    if (avoidable) zoningStatus = 'warn';
  }
  checks.push({
    id: 'sp-zoning',
    title: 'Pressure zoning — avoid PRVs',
    reference: 'NFPA 14-2019 §7.2.1, §7.2.3, §7.9 (zones; each zone requiring pumps has its own pump)',
    status: zoningStatus,
    detail: zoningDetail
  });
  const z1 = sol.zones[0];
  if (zn.selected === 'without-prv' && z1 && z1.station.kind === 'pump-room' && main0.ratedNetPressurePsi > z1.ratedNetPressurePsi + 1e-9) {
    const mainChurn = 1.2 * main0.ratedNetPressurePsi + pumps.maxStaticSuctionPsi;
    const lowest = (z1.bottomOutletElevationM - z1.station.pumpCLElevationM) * FT_PER_M;
    const staticAtLowest = mainChurn - 0.433 * lowest;
    checks.push({
      id: 'sp-zone1-pump',
      title: 'Main pumps vs zone 1 standpipe requirement',
      reference: 'NFPA 14-2019 §7.2.3, §7.9; NFPA 13-2019 §19.3.3 (pump sized for the governing demand)',
      status: staticAtLowest > HOSE_OUTLET_STATIC_LIMIT_PSI ? 'warn' : 'pass',
      detail: `The main pumps (${main0.ratedNetPressurePsi} psi net) are governed by another demand (sprinklers) and exceed the zone 1 standpipe requirement (${z1.ratedNetPressurePsi} psi); with the main pumps connected directly the lowest zone 1 outlet would see ${f1(staticAtLowest)} psi static${staticAtLowest > HOSE_OUTLET_STATIC_LIMIT_PSI ? ` (> ${HOSE_OUTLET_STATIC_LIMIT_PSI} psi): feed zone 1 through a dedicated zone 1 pump set / pressure-limited connection or provide PRVs on the lowest outlets` : ''}. `
    });
  }
  const expressZones = sol.zones.filter((z) => z.station.kind === 'express');
  checks.push({
    id: 'sp-express-riser',
    title: 'Express risers to the upper zones',
    reference: 'NFPA 14-2019 §7.2.1 (350 psi maximum), §7.9; NFPA 20-2019 §4.4',
    status: expressZones.every((z) => z.churnDischargePsi <= STANDPIPE_MAX_PRESSURE_PSI) ? 'pass' : 'fail',
    detail:
      expressZones.length === 0
        ? 'No express risers'
        : expressZones
            .map((z) => `${z.id}: express riser ${f1(z.expressRiserLengthM ?? 0)} m from the pump room to ${z.floorIds[0]}, zone pump ${z.ratedNetPressurePsi} psi, churn + suction ${f1(z.churnDischargePsi)} psi (limit ${STANDPIPE_MAX_PRESSURE_PSI} psi)`)
            .join('; ')
  });
  const tankZones = sol.zones.filter((z) => z.breakTank);
  checks.push({
    id: 'sp-break-tank',
    title: 'Break tanks at service-floor booster stations',
    reference: 'NFPA 20-2019 §4.31 (break tanks); NFPA 14-2019 §7.10.1.2 (30 min supply)',
    status: 'pass',
    detail:
      tankZones.length === 0
        ? 'No service-floor stations: no break tank required'
        : tankZones
            .map((z) => `${z.id} @ ${z.station.floorId}: ${f1(z.breakTank!.volumeGal)} gal (${f1(z.breakTank!.volumeM3)} m³) for 30 min × ${d.demandFlowGpm} gpm; NFPA 20 break-tank alternative ${f1(z.breakTank!.nfpa20BreakTankGal)} gal`)
            .join('; ')
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
