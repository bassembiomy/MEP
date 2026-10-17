import { EquipmentServiceZone, DesignControlMode } from '../zoning/zonePartitioner';
import { selectBestDiffuserFromCatalog, neckAreaSqFt, terminalSizeLabels, MAX_NECK_VELOCITY_FPM } from './diffuserSelector';
import { layoutBayTerminalGrid, decomposeConvex, maxDistanceToNearestTerminal } from './bayLayout';
import { STANDARD_DIFFUSER_CATALOG } from '../hvacCatalogs';
import { DiffuserCatalogItem } from '../types';
import type { Rect } from '../ducts/clearance';
import { layoutTerminalGrid, THROW_RATIO_MIN, THROW_RATIO_MAX, MIN_TERMINAL_SPACING_FT } from '../geometry';

export interface CoordinatedAirTerminal {
  id: string;
  unitId: string;
  designControlMode: DesignControlMode;
  type: 'supply' | 'return' | 'exhaust' | 'outdoor-intake';
  subtype: '4-way-ceiling' | '2-way' | 'linear-slot' | 'swirl' | 'eggcrate' | 'perforated' | 'sidewall';
  position: { x: number; y: number };
  cfm: number;
  catalogModel: string;
  neckDimension: string;
  faceDimension: string;
  throwT50Ft: number;
  throwRatio: number;
  adjacentOverlapRatio: number;
  occupiedZoneVelocityFpm: number;
  ncRating: number;
  deltaPInWg: number;
  status: 'pass' | 'warning' | 'fail';
  /** User-locked terminal: scoped recalculation keeps its position (and CFM) and lays the others out around it. */
  locked?: boolean;
}

/** Lowest turndown of a diffuser relative to its catalog minimum CFM (design airflow at ~40% of tested minimum). */
const MIN_TURNDOWN = 0.4;

interface PerfPoint { nc: number; t50: number; dp: number }

/**
 * Catalog performance at an arbitrary CFM. Inside the tested range the table is interpolated;
 * outside it throw and pressure scale from the nearest tested point (T50 ~ Q for a fixed neck,
 * i.e. T50 ~ K*Q/sqrt(Ak); dP ~ Q^2); NC moves ~15 dB per decade of flow.
 */
export function diffuserPerformanceAt(item: DiffuserCatalogItem, cfm: number): PerfPoint {
  const t = [...item.performanceTable].sort((a, b) => a.cfm - b.cfm);
  if (t.length === 0) return { nc: 25, t50: 10, dp: 0.035 };
  const first = t[0], last = t[t.length - 1];
  if (cfm <= first.cfm) {
    const f = cfm / first.cfm;
    return { nc: Math.max(10, first.ncRating + 15 * Math.log10(Math.max(f, 1e-3))), t50: first.throwFt.t50 * f, dp: first.deltaPInWg * f * f };
  }
  if (cfm >= last.cfm) {
    const f = cfm / last.cfm;
    return { nc: last.ncRating + 15 * Math.log10(f), t50: last.throwFt.t50 * f, dp: last.deltaPInWg * f * f };
  }
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i], b = t[i + 1];
    if (cfm >= a.cfm && cfm <= b.cfm) {
      const f = (cfm - a.cfm) / (b.cfm - a.cfm || 1);
      return {
        nc: a.ncRating + f * (b.ncRating - a.ncRating),
        t50: a.throwFt.t50 + f * (b.throwFt.t50 - a.throwFt.t50),
        dp: a.deltaPInWg + f * (b.deltaPInWg - a.deltaPInWg)
      };
    }
  }
  return { nc: last.ncRating, t50: last.throwFt.t50, dp: last.deltaPInWg };
}

export interface ThrowSelection {
  count: number;
  item: DiffuserCatalogItem;
  cfmEach: number;
  t50: number;
  throwLengthFt: number;
  ratio: number;
  nc: number;
  dp: number;
  grid: ReturnType<typeof layoutTerminalGrid>;
  /** Largest distance (ft) from an occupied point to the nearest supply terminal. */
  maxCoverageDistFt?: number;
}

/** Supply coverage rule: any occupied point lies within this many T50 throws of a supply terminal. */
export const COVERAGE_T50_FACTOR = 1.5;
/** Overshoot (x the 1.5 T50 limit) tolerated before the coverage cost starts - the rule is approximate (~1.5). */
const COVERAGE_TOLERANCE = 1.05;
/** Score cost per unit of coverage overshoot (a terminal out of the throw band costs 0.15). */
const COVERAGE_PENALTY = 1.0;

/**
 * Professional selection: for every candidate count n (grid layout) and catalog size, compute
 * L (half the governing spacing / wall distance) and T50 at the actual per-diffuser CFM, then
 * pick the combination minimising |T50/L - 1| subject to neck velocity <= limit, CFM within the
 * item's range and NC <= target (+2). Deterministic; ties go to fewer, cheaper terminals.
 */
export function selectDiffuserCountAndSize(
  polygonFt: number[],
  zoneCfm: number,
  targetNc: number,
  options: { catalog?: DiffuserCatalogItem[]; maxNeckVelocityFpm?: number; maxCount?: number; unitPerFt?: number; keepOuts?: Rect[] } = {}
): ThrowSelection | null {
  const unitPerFt = options.unitPerFt ?? 1;
  // Non-convex bays (L / T / U) are split into convex arms and each arm gets terminals in proportion to its area
  const nMin = Math.min(decomposeConvex(polygonFt).length, 6);
  const catalog = options.catalog ?? STANDARD_DIFFUSER_CATALOG;
  const vLimit = options.maxNeckVelocityFpm ?? MAX_NECK_VELOCITY_FPM;
  const items = catalog.filter((d) => d.terminalType === 'square-ceiling' || d.terminalType === 'round-ceiling');
  if (!items.length || !(zoneCfm > 0)) return null;
  const minFlow = Math.min(...items.map((i) => i.minCfm * MIN_TURNDOWN));
  const nMax = Math.max(1, Math.min(options.maxCount ?? 48, Math.floor(zoneCfm / Math.max(minFlow, 1))));

  const gridCache = new Map<number, { grid: ReturnType<typeof layoutTerminalGrid>; cover: number }>();
  const gridFor = (n: number): { grid: ReturnType<typeof layoutTerminalGrid>; cover: number } => {
    let g = gridCache.get(n);
    if (!g) {
      const grid = layoutBayTerminalGrid(polygonFt, n, { unitPerFt, keepOuts: options.keepOuts });
      g = { grid, cover: maxDistanceToNearestTerminal(polygonFt, grid.points, { unitPerFt }) };
      gridCache.set(n, g);
    }
    return g;
  };

  const tryPass = (ncTol: number, minSpacing: number): ThrowSelection | null => {
    let best: ThrowSelection | null = null;
    let bestScore = Infinity;
    const seenCounts = new Set<number>();
    for (let n = nMin; n <= Math.max(nMax, nMin); n++) {
      const { grid, cover } = gridFor(n);
      const actual = grid.points.length;
      if (actual < 1 || seenCounts.has(actual)) continue;
      seenCounts.add(actual);
      if (actual > 1 && grid.minSpacingFt < minSpacing - 1e-6) continue;
      const q = zoneCfm / actual;
      const L = Math.max(grid.throwLengthFt, 1e-6);
      for (const item of items) {
        const area = neckAreaSqFt(item);
        if (area > 0 && q / area > vLimit) continue;
        if (q > item.maxCfm || q < item.minCfm * MIN_TURNDOWN) continue;
        const perf = diffuserPerformanceAt(item, q);
        if (perf.nc > targetNc + ncTol) continue;
        const ratio = perf.t50 / L;
        const inBand = ratio >= THROW_RATIO_MIN && ratio <= THROW_RATIO_MAX;
        // Coverage rule (any occupied point within ~1.5 x T50 of a supply): a shortfall is a soft cost that grows with the
        // overshoot, so an L / T arm with no terminal near it is decisive but a marginal miss never buys a swarm of tiny ones.
        const overshoot = Math.max(0, cover / (COVERAGE_T50_FACTOR * Math.max(perf.t50, 1e-6)) - COVERAGE_TOLERANCE);
        const coverPenalty = Math.min(overshoot, 2) * COVERAGE_PENALTY;
        // Unreachable band: do not chase it with ever more terminals (strong count penalty)
        const score = Math.abs(ratio - 1) + (inBand ? 0.02 : 0.15) * actual + coverPenalty + 0.00001 * (item.costIndex ?? 0);
        if (score < bestScore - 1e-12) {
          bestScore = score;
          best = { count: actual, item, cfmEach: q, t50: perf.t50, throwLengthFt: L, ratio, nc: perf.nc, dp: perf.dp, grid, maxCoverageDistFt: cover };
        }
      }
    }
    return best;
  };
  // Preferred spacing leaves room for a return grille >= MIN_TERMINAL_SPACING_FT from every supply
  // (cell-corner return is s/sqrt(2) from four supplies); otherwise fall back to the bare minimum.
  return tryPass(2, MIN_TERMINAL_SPACING_FT * Math.SQRT2) ?? tryPass(2, MIN_TERMINAL_SPACING_FT) ?? tryPass(2, 0) ?? tryPass(8, 0);
}

type TerminalDescriptor = {
  model: string; neck: string; face: string; t50: number; ratio: number; nc: number; dp: number;
  status: CoordinatedAirTerminal['status'];
};

function emitTerminals(
  zone: EquipmentServiceZone,
  pts: { x: number; y: number }[],
  zoneCfm: number,
  d: TerminalDescriptor
): CoordinatedAirTerminal[] {
  const n = pts.length;
  const each = Math.round(zoneCfm / n);
  const terminals: CoordinatedAirTerminal[] = [];
  let remainingCfm = zoneCfm;
  pts.forEach((p, i) => {
    const thisCfm = i === n - 1 ? remainingCfm : each;
    remainingCfm -= thisCfm;
    terminals.push({
      id: `SAD-${zone.unitTag}-${i + 1}`,
      unitId: zone.id,
      designControlMode: 'ai',
      type: 'supply',
      subtype: '4-way-ceiling',
      position: { x: parseFloat(p.x.toFixed(2)), y: parseFloat(p.y.toFixed(2)) },
      cfm: thisCfm,
      catalogModel: d.model,
      neckDimension: d.neck,
      faceDimension: d.face,
      throwT50Ft: d.t50,
      throwRatio: d.ratio,
      adjacentOverlapRatio: 0.85,
      occupiedZoneVelocityFpm: 40,
      ncRating: d.nc,
      deltaPInWg: d.dp,
      status: d.status
    });
  });
  return terminals;
}

/**
 * Places supply diffusers on a professional cell-centred grid inside the zone polygon (feet).
 * Count and catalog size are chosen by `selectDiffuserCountAndSize` so T50/L lands in 0.75 - 1.25
 * where the catalog allows. Every position is inside the polygon, unique, and at least half a grid
 * spacing from the walls. `throwRatio` = T50 / L with L = half the governing spacing.
 * Default (optimizeThrow: false) uses the legacy `targetCfmPerDiffuser` count; the air-distribution engine passes `optimizeThrow: true`.
 */
export function placeSupplyDiffusersForZone(
  zone: EquipmentServiceZone,
  options: { targetCfmPerDiffuser?: number; unitPerFt?: number; optimizeThrow?: boolean; keepOuts?: Rect[]; catalog?: DiffuserCatalogItem[]; metric?: boolean } = {}
): CoordinatedAirTerminal[] {
  const { targetCfmPerDiffuser = 350, unitPerFt = 1, optimizeThrow = false, keepOuts, catalog, metric = false } = options;
  const zoneCfm = zone.supplyCfm;
  if (!(zoneCfm > 0) || zone.serviceAreaPolygon.length < 6) return [];

  if (optimizeThrow) {
    const sel = selectDiffuserCountAndSize(zone.serviceAreaPolygon, zoneCfm, zone.targetNc, { unitPerFt, keepOuts, catalog });
    if (sel) {
      const item = sel.item;
      const { face, neck } = terminalSizeLabels(item, metric);
      const ratio = parseFloat(sel.ratio.toFixed(2));
      const status: CoordinatedAirTerminal['status'] = ratio >= THROW_RATIO_MIN && ratio <= THROW_RATIO_MAX ? 'pass' : 'warning';
      return emitTerminals(zone, sel.grid.points, zoneCfm, {
        model: `${item.manufacturer} ${item.model}`, neck, face,
        t50: parseFloat(sel.t50.toFixed(1)), ratio, nc: Math.round(sel.nc), dp: parseFloat(sel.dp.toFixed(3)), status
      });
    }
  }

  let numDiffusers = Math.max(1, Math.round(zoneCfm / targetCfmPerDiffuser));
  let selected = selectBestDiffuserFromCatalog(Math.round(zoneCfm / numDiffusers), zone.targetNc, 'square-ceiling', catalog, { metric });
  // If nothing fits (neck velocity / catalog range), add diffusers rather than overloading one
  for (let guard = 0; guard < 4 && selected.requiredCount > 1; guard++) {
    numDiffusers *= selected.requiredCount;
    selected = selectBestDiffuserFromCatalog(Math.round(zoneCfm / numDiffusers), zone.targetNc, 'square-ceiling', catalog, { metric });
  }

  const grid = layoutBayTerminalGrid(zone.serviceAreaPolygon, numDiffusers, { unitPerFt, keepOuts });
  if (grid.points.length === 0) return [];
  numDiffusers = grid.points.length; // the room may hold fewer than requested; never stack terminals

  const cfmPerDiffuser = Math.round(zoneCfm / numDiffusers);
  selected = selectBestDiffuserFromCatalog(cfmPerDiffuser, zone.targetNc, 'square-ceiling', catalog, { metric });
  const throwRatio = parseFloat((selected.throwT50Ft / Math.max(grid.throwLengthFt, 1e-6)).toFixed(2));
  const status: CoordinatedAirTerminal['status'] =
    throwRatio >= THROW_RATIO_MIN && throwRatio <= THROW_RATIO_MAX && selected.withinLimits ? 'pass' : 'warning';
  return emitTerminals(zone, grid.points, zoneCfm, {
    model: selected.model, neck: selected.neckDimension, face: selected.faceDimension,
    t50: selected.throwT50Ft, ratio: throwRatio, nc: selected.actualNc, dp: selected.deltaPInWg, status
  });
}
