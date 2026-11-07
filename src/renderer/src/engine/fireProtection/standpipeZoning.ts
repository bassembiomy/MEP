/**
 * NFPA 14 standpipe pressure zoning: avoid PRVs by splitting the risers into pressure zones, each fed by its own pump
 * (main pumps, express riser from the pump room, or a break tank + booster pump set on a service floor), and always
 * calculate the classic single-zone solution with PRVs for comparison.
 * Follows docs/superpowers/plans/2026-11-07-standpipe-prv-zoning.md §Z1 (oracle: ...-oracle.py).
 */
import {
  FireDesignInput,
  FloorLevel,
  HydraulicNodeRow,
  PumpSetSelection,
  StandpipeOutlet,
  StandpipeSolution,
  StandpipeSystemDesign,
  StandpipeZone,
  StandpipeZoneStation,
  StandpipeZoningStudy
} from './fpTypes';
import { elevationPsi } from './hydraulics';
import { calcRiserBand, riserCalcContext, zoneOutletPressures, zonePumpModel } from './standpipeDesigner';
import { pumpCenterlineHeightM } from './pumpRoomDesigner';
import { HOSE_OUTLET_STATIC_LIMIT_PSI, STANDPIPE_DURATION_MIN, STANDPIPE_MAX_PRESSURE_PSI } from './standards/nfpa14';
import { selectRatedCapacity } from './standards/nfpa20';

const FT_PER_M = 3.28084;
const M3_PER_GAL = 0.003785411784;
const SERVICE_HORIZONTAL_RUN_M = 10;
const BREAK_TANK_STATIC_HEAD_M = 2.0;
const EPS = 1e-9;
const ceil5 = (v: number): number => Math.ceil(v / 5 - 1e-9) * 5;
const f1 = (v: number): string => v.toFixed(1);

/** One distinct hose-outlet level (all risers share the same zone elevation bands). */
interface Level {
  floorId: string;
  floorName: string;
  /** Floor finished-floor level, m. */
  ffl: number;
  /** Hose valve elevation, m. */
  elev: number;
}

interface Station {
  kind: StandpipeZoneStation['kind'];
  floorId: string | null;
  clM: number;
  suctionMinPsi: number;
  suctionMaxPsi: number;
  horizontalRunM: number | null; // null = riser's own run to the pump room
}

interface ZoneEval {
  req: number;
  refTag: string;
  rows: HydraulicNodeRow[];
  rated: number;
  ratio: number;
  churnD: number;
  maxStatic: number;
  topRes: number;
  ok: boolean;
}

/** Strategy value actually in force (undefined = 'avoid'). */
export function effectivePrvStrategy(input: FireDesignInput): 'avoid' | 'allow' {
  return input.standpipeDesign?.prvStrategy ?? 'avoid';
}

/**
 * Build the zoning study: the without-PRV partition (dynamic programming, minimum PRVs → zones → express risers →
 * total pump pressure) and the with-PRV single zone. `pumps` is the first pump selection (suction pressures);
 * `design` is the single-zone standpipe hydraulics (outlets, pump-room centre-line, governing riser).
 */
export function buildStandpipeZoning(design: StandpipeSystemDesign, input: FireDesignInput, pumps: PumpSetSelection): StandpipeZoningStudy {
  const sd = input.standpipeDesign!;
  const building = input.building!;
  const ctx = riserCalcContext(input);
  const Q = design.demandFlowGpm;
  const ratedFlow = selectRatedCapacity(Q);
  const strategy = effectivePrvStrategy(input);
  const answered = Array.isArray(sd.serviceFloorIds);
  const serviceIds = answered ? sd.serviceFloorIds! : [];
  const floors = building.floors;
  const floorById = new Map<string, FloorLevel>(floors.map((f) => [f.id, f]));
  const baseFloorFfl = floors[0].elevationM;
  const shutoffRatio = sd.zonePumpShutoffRatio ?? 1.2;
  const zoneCl = (fl: FloorLevel): number => fl.elevationM + pumpCenterlineHeightM(ratedFlow);
  const serviceSmax = 0.433 * BREAK_TANK_STATIC_HEAD_M * FT_PER_M;

  // outlet levels bottom → top (union over the risers)
  const levels: Level[] = [];
  for (const r of design.risers) {
    for (const o of r.outlets) {
      if (!levels.some((l) => Math.abs(l.elev - o.elevationM) < 1e-6)) {
        levels.push({ floorId: o.floorId, floorName: o.floorName, ffl: floorById.get(o.floorId)?.elevationM ?? o.elevationM, elev: o.elevationM });
      }
    }
  }
  levels.sort((a, b) => a.elev - b.elev);
  const n = levels.length;

  const study = (withPrv: StandpipeSolution, withoutPrv: StandpipeSolution): StandpipeZoningStudy => ({
    strategy,
    serviceFloorsAnswered: answered,
    serviceFloorIds: [...serviceIds],
    withPrv,
    withoutPrv,
    selected: strategy === 'allow' || n === 0 ? 'with-prv' : 'without-prv'
  });
  if (n === 0) {
    const empty = (kind: StandpipeSolution['kind']): StandpipeSolution => ({
      kind, zones: [], prvCount: 0, pumpSets: 0, expressRisers: 0, serviceFloorStations: [], maxStaticPsi: 0, feasible: true, summary: [], suggestion: null
    });
    return study(empty('with-prv'), empty('without-prv'));
  }

  const roomStation = (i: number): Station => ({
    kind: i === 0 ? 'pump-room' : 'express',
    floorId: null,
    clM: design.pumpCLElevationM,
    suctionMinPsi: pumps.suctionPressureMinPsi,
    suctionMaxPsi: pumps.maxStaticSuctionPsi,
    horizontalRunM: null
  });
  const stationsFor = (i: number): Station[] => {
    const list: Station[] = [roomStation(i)];
    for (const f of floors) {
      if (f.isRoof || !serviceIds.includes(f.id) || f.elevationM > levels[i].ffl + EPS) continue;
      list.push({ kind: 'service-floor', floorId: f.id, clM: zoneCl(f), suctionMinPsi: 0, suctionMaxPsi: serviceSmax, horizontalRunM: SERVICE_HORIZONTAL_RUN_M });
    }
    return list;
  };

  const inBand = (elev: number, i: number, t: number): boolean => elev >= levels[i].elev - EPS && elev <= levels[t].elev + EPS;
  const cache = new Map<string, ZoneEval>();

  /** Requirement and pump of zone [i..t] fed from `st`; zoneNo only names the hydraulic nodes (0 = unnamed for the search). */
  function evalZone(i: number, t: number, st: Station, zoneNo: number): ZoneEval {
    const key = `${i}:${t}:${st.kind}:${st.clM}:${zoneNo}`;
    const hit = cache.get(key);
    if (hit) return hit;
    let req = -Infinity;
    let best: { tag: string; rows: HydraulicNodeRow[]; req: number } | null = null;
    for (const r of design.risers) {
      const band = r.outlets.filter((o) => inBand(o.elevationM, i, t));
      if (band.length === 0) continue;
      const loc = sd.locations.find((l) => l.tag === r.tag);
      const run = st.horizontalRunM ?? loc?.horizontalRunToPumpM ?? r.horizontalRunToPumpM;
      const prefix = zoneNo <= 1 ? r.tag : `${r.tag}-Z${zoneNo}`;
      const pd = zoneNo <= 1 ? 'PD' : `PD-Z${zoneNo}`;
      const baseFfl = i === 0 ? baseFloorFfl : (floorById.get(band[0].floorId)?.elevationM ?? band[0].elevationM);
      const c = calcRiserBand(ctx, sd.pipe, [...band].reverse(), prefix, pd, baseFfl, run, st.clM, st.kind !== 'pump-room');
      const entry = { tag: r.tag, rows: c.rows, req: c.ptRequired };
      if (c.ptRequired > req) {
        req = c.ptRequired;
        best = entry;
      }
    }
    // the zone's governing riser (maximum requirement) provides the rows and the flowing outlets
    const ref = best!;
    const rated = ceil5(req - st.suctionMinPsi);
    const ratio = st.kind === 'pump-room' ? 1.2 : shutoffRatio;
    const x = Q / ratedFlow;
    const pNet = rated * (ratio + 0.066667 * x - (ratio - 1 + 0.066667) * x * x);
    const churnD = ratio * rated + st.suctionMaxPsi;
    const maxStatic = churnD - elevationPsi((levels[i].elev - st.clM) * FT_PER_M);
    const topRes = ctx.topResidualPsi + (pNet + st.suctionMinPsi - req);
    const ev: ZoneEval = {
      req,
      refTag: ref.tag,
      rows: ref.rows,
      rated,
      ratio,
      churnD,
      maxStatic,
      topRes,
      ok: maxStatic <= HOSE_OUTLET_STATIC_LIMIT_PSI + EPS && churnD <= STANDPIPE_MAX_PRESSURE_PSI + EPS
    };
    cache.set(key, ev);
    return ev;
  }

  /** Outlets of all risers in the band whose static pressure with this zone pump exceeds 175 psi. */
  function staticPrvCount(i: number, t: number, st: Station, ev: ZoneEval): number {
    let c = 0;
    for (const r of design.risers) {
      for (const o of r.outlets) {
        if (inBand(o.elevationM, i, t) && ev.churnD - elevationPsi((o.elevationM - st.clM) * FT_PER_M) > HOSE_OUTLET_STATIC_LIMIT_PSI + EPS) c++;
      }
    }
    return c;
  }

  // ---- without PRVs: dynamic programming over the start level ----
  type Cost = [number, number, number, number];
  interface Pick { i: number; t: number; st: Station }
  const memo = new Map<number, { cost: Cost; picks: Pick[] }>();
  function best(i: number): { cost: Cost; picks: Pick[] } {
    if (i === n) return { cost: [0, 0, 0, 0], picks: [] };
    const m = memo.get(i);
    if (m) return m;
    let bestOpt: { cost: Cost; t: number; picks: Pick[] } | null = null;
    const better = (a: { cost: Cost; t: number }, b: { cost: Cost; t: number }): boolean => {
      for (let k = 0; k < 4; k++) if (a.cost[k] !== b.cost[k]) return a.cost[k] < b.cost[k];
      return a.t > b.t;
    };
    for (const st of stationsFor(i)) {
      for (let t = i; t < n; t++) {
        const ev = evalZone(i, t, st, 0);
        if (!ev.ok && t < n - 1) continue;
        let pc = ev.ok ? 0 : staticPrvCount(i, t, st, ev);
        if (!ev.ok && ev.churnD > STANDPIPE_MAX_PRESSURE_PSI + EPS) pc += 1000;
        const sub = best(t + 1);
        const opt = {
          cost: [pc + sub.cost[0], 1 + sub.cost[1], (st.kind === 'express' ? 1 : 0) + sub.cost[2], ev.rated + sub.cost[3]] as Cost,
          t,
          picks: [{ i, t, st }, ...sub.picks]
        };
        if (!bestOpt || better(opt, bestOpt)) bestOpt = opt;
      }
    }
    const res = { cost: bestOpt!.cost, picks: bestOpt!.picks };
    memo.set(i, res);
    return res;
  }

  const baseOutlets = (i: number, t: number): StandpipeOutlet[][] =>
    design.risers.map((r) => r.outlets.filter((o) => inBand(o.elevationM, i, t)));

  function buildZone(zoneNo: number, i: number, t: number, st: Station): StandpipeZone {
    const ev = evalZone(i, t, st, zoneNo);
    const station: StandpipeZoneStation = {
      kind: st.kind,
      floorId: st.floorId,
      pumpCLElevationM: st.clM,
      suctionMinPsi: st.suctionMinPsi,
      suctionMaxPsi: st.suctionMaxPsi
    };
    const id = `Z${zoneNo}`;
    const zone: StandpipeZone = {
      id,
      station,
      floorIds: levels.slice(i, t + 1).map((l) => l.floorId),
      bottomOutletElevationM: levels[i].elev,
      topOutletElevationM: levels[t].elev,
      requiredPressurePsi: ev.req,
      governingRiserTag: ev.refTag,
      ratedFlowGpm: ratedFlow,
      ratedNetPressurePsi: ev.rated,
      shutoffRatio: ev.ratio,
      churnDischargePsi: ev.churnD,
      maxStaticPsi: ev.maxStatic,
      topResidualPsi: ev.topRes,
      feasible: ev.ok,
      prvOutlets: 0,
      expressRiserLengthM: st.kind === 'express' ? (i === 0 ? baseFloorFfl : levels[i].ffl) - (building.pumpRoomFloorElevationM ?? 0) : null,
      breakTank:
        st.kind === 'service-floor'
          ? (() => {
              const gal = Q * STANDPIPE_DURATION_MIN;
              const nfpa = 1.5 * ratedFlow * 15;
              return { volumeGal: gal, volumeM3: gal * M3_PER_GAL, nfpa20BreakTankGal: nfpa, nfpa20BreakTankM3: nfpa * M3_PER_GAL };
            })()
          : null,
      rows: ev.rows
    };
    // PRVs still needed by the outlets of this zone (same rule as the outlet analysis)
    const model = zonePumpModel(zone);
    let prvs = 0;
    design.risers.forEach((r, ri) => {
      const band = baseOutlets(i, t)[ri];
      if (band.length > 0) prvs += zoneOutletPressures(band, r.tag === ev.refTag, ev.rows, model, Q, id).filter((o) => o.prvRequired).length;
    });
    zone.prvOutlets = prvs;
    return zone;
  }

  const finishSolution = (kind: StandpipeSolution['kind'], zones: StandpipeZone[]): StandpipeSolution => {
    const stationFloors = floors.filter((f) => zones.some((z) => z.station.kind === 'service-floor' && z.station.floorId === f.id)).map((f) => f.id);
    const prvCount = zones.reduce((a, z) => a + z.prvOutlets, 0);
    const express = zones.filter((z) => z.station.kind === 'express').length;
    const feasible = kind === 'with-prv' ? zones.every((z) => z.churnDischargePsi <= STANDPIPE_MAX_PRESSURE_PSI + EPS) : zones.every((z) => z.feasible);
    const bad = zones.find((z) => !z.feasible);
    const sol: StandpipeSolution = {
      kind,
      zones,
      prvCount,
      pumpSets: zones.length,
      expressRisers: express,
      serviceFloorStations: stationFloors,
      maxStaticPsi: Math.max(...zones.map((z) => z.maxStaticPsi)),
      feasible,
      summary: [],
      suggestion: null
    };
    if (kind === 'without-prv' && !feasible && bad) {
      sol.suggestion = `Provide a service floor at or below ${bad.floorIds[0]} (the lowest outlet of zone ${bad.id}) to host a break tank and booster pump set, so that the ${bad.prvOutlets} remaining PRV outlet(s) can be avoided; otherwise accept PRVs on zone ${bad.id}.`;
    }
    sol.summary = summaryFor(sol);
    return sol;
  };

  function summaryFor(sol: StandpipeSolution): string[] {
    const z = sol.zones;
    const maxChurn = Math.max(...z.map((q) => q.churnDischargePsi));
    if (sol.kind === 'with-prv') {
      return [
        `Equipment: one fire pump set (${z[0].ratedNetPressurePsi} psi net), one riser zone, ${sol.prvCount} pressure-regulating valve(s) on the hose outlets above 175 psi static`,
        'PRV maintenance: NFPA 25 requires a 5-year full-flow test of every pressure-regulating device plus annual inspection and a 3" drain riser for the PRV flow tests',
        'Failure risk: a stuck or mis-set PRV leaves a hose outlet over-pressurised (above 175 psi) or under-supplied for the fire department; every PRV is a single point of failure',
        `Pressure: maximum pump discharge ${f1(maxChurn)} psi (limit 350 psi); ${sol.feasible ? 'within the limit' : 'EXCEEDS the 350 psi limit'}`,
        'Cost / space: lowest first cost (one pump set, no break tanks or express risers); PRV stations and drain riser take shaft space and add maintenance cost'
      ];
    }
    const sf = sol.serviceFloorStations;
    return [
      `Equipment: ${sol.pumpSets} fire pump set(s) (main + zone pumps${sf.length > 0 ? ' / service-floor booster sets' : ''}), ${sol.expressRisers} express riser(s), ${sf.length} service-floor station(s)`,
      `PRV maintenance: ${sol.prvCount === 0 ? 'none — no pressure-regulating devices, so no NFPA 25 5-year PRV full-flow tests and no 3" drain riser' : `${sol.prvCount} PRV(s) remain on the top zone (NFPA 25 5-year full-flow test, drain riser)`}`,
      `Failure risk: ${sol.prvCount === 0 ? 'no PRV failure mode; each zone depends on its own pump set (redundant pumps are provided per NFPA 20)' : 'residual PRV failure risk limited to the remaining PRV outlets; each zone depends on its own pump set'}`,
      sol.expressRisers > 0
        ? `Express risers: ${sol.expressRisers} express riser(s) without outlets run from the pump room up to the zone base, discharge pressure up to ${f1(maxChurn)} psi (limit 350 psi)`
        : `Express risers: none; maximum zone pump discharge ${f1(maxChurn)} psi (limit 350 psi)`,
      sf.length > 0
        ? `Break tanks / booster sets: ${sf.length} service-floor station(s) (${sf.join(', ')}), each with a 30-minute break tank and a booster pump set`
        : 'Break tanks / booster sets: none (no service floors)',
      'Cost / space: more pumps, controllers and riser pipe than the PRV solution, plus pump-room space for the zone pumps and service-floor space for tanks; no PRV stations'
    ];
  }

  const picks = best(0).picks;
  const zonesNo = picks.map((p, k) => buildZone(k + 1, p.i, p.t, p.st));
  const withoutPrv = finishSolution('without-prv', zonesNo);
  const withPrv = finishSolution('with-prv', [buildZone(1, 0, n - 1, roomStation(0))]);
  return study(withPrv, withoutPrv);
}

/** Pump-room (zone 1) requirement used to size the main pumps in the without-PRV solution. */
export function selectedZoneOne(study: StandpipeZoningStudy): StandpipeZone | null {
  const sol = study.selected === 'with-prv' ? study.withPrv : study.withoutPrv;
  return sol.zones[0] ?? null;
}
