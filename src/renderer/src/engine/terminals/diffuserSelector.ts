import { DiffuserCatalogItem } from '../types';
import { STANDARD_DIFFUSER_CATALOG } from '../hvacCatalogs';

/** Max diffuser neck velocity (fpm) for office / general occupancy. */
export const MAX_NECK_VELOCITY_FPM = 700;
/** Cassette nominal capacity used for unit counting AND labels (3 ton = 36K Btu/h). */
export const CASSETTE_NOMINAL_BTU = 36000;
export const HIGH_WALL_NOMINAL_BTU = 24000;

export interface SelectedDiffuserResult {
  catalogItem: DiffuserCatalogItem;
  model: string;
  faceDimension: string;
  neckDimension: string;
  nominalCfm: number;
  actualNc: number;
  throwT50Ft: number;
  deltaPInWg: number;
  /** Neck velocity at the requested CFM (fpm). */
  neckVelocityFpm: number;
  /** false when nothing satisfied the velocity/CFM limits and the largest size was returned. */
  withinLimits: boolean;
  /** Number of terminals needed so each one stays within the selected item's limits (>= 1). */
  requiredCount: number;
}

export interface DiffuserSelectionOptions {
  maxNeckVelocityFpm?: number;
  /** Emit face / neck labels in millimetres (`600x600`, `\u00D8250 mm`) instead of inches. */
  metric?: boolean;
}

const MM_PER_INCH = 25.4;
const trimIn = (v: number): string => String(parseFloat(v.toFixed(2)));

/** Face and neck labels of a catalog item: inches `18"x18"` / `12" dia`, or millimetres `600x600` / `\u00D8300 mm`. */
export function terminalSizeLabels(item: DiffuserCatalogItem, metric = false): { face: string; neck: string } {
  const f = item.faceSizeIn;
  const n = item.neckSizeIn;
  if (metric) {
    const mm = (v: number): number => Math.round(v * MM_PER_INCH);
    return {
      face: f ? `${mm(f.width)}x${mm(f.height)}` : '600x600',
      neck: n ? (n.diameter ? `\u00D8${mm(n.diameter)} mm` : `${mm(n.width)}x${mm(n.height)} mm`) : '\u00D8250 mm'
    };
  }
  return {
    face: f ? `${trimIn(f.width)}"x${trimIn(f.height)}"` : '24"x24"',
    neck: n ? (n.diameter ? `${trimIn(n.diameter)}" dia` : `${trimIn(n.width)}"x${trimIn(n.height)}"`) : '10"x10"'
  };
}

/** Neck free area in ft2 (round neck when `diameter` is given, otherwise rectangular). */
export function neckAreaSqFt(item: DiffuserCatalogItem): number {
  const n = item.neckSizeIn;
  if (!n) return 0;
  if (n.diameter) return (Math.PI / 4) * Math.pow(n.diameter / 12, 2);
  return (n.width * n.height) / 144;
}

function interpolate(item: DiffuserCatalogItem, cfm: number): { nc: number; t50: number; dp: number; } {
  const t = [...item.performanceTable].sort((a, b) => a.cfm - b.cfm);
  if (t.length === 0) return { nc: 25, t50: 10, dp: 0.035 };
  if (t.length === 1 || cfm <= t[0].cfm) return { nc: t[0].ncRating, t50: t[0].throwFt.t50, dp: t[0].deltaPInWg };
  const last = t[t.length - 1];
  if (cfm >= last.cfm) return { nc: last.ncRating, t50: last.throwFt.t50, dp: last.deltaPInWg };
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

/** Largest CFM one item can carry within velocity, catalog range and NC limits. */
export function maxCfmPerItem(item: DiffuserCatalogItem, spaceNcLimit: number = 30, maxVelocityFpm: number = MAX_NECK_VELOCITY_FPM): number {
  let cap = item.maxCfm;
  const area = neckAreaSqFt(item);
  if (area > 0) cap = Math.min(cap, maxVelocityFpm * area);
  // reduce further so NC stays within the limit (+2 tolerance)
  const table = [...item.performanceTable].sort((a, b) => a.cfm - b.cfm);
  if (table.length) {
    let ncCap = table[0].cfm; // never below the lowest tested point
    for (let c = table[0].cfm; c <= cap; c += 5) {
      if (interpolate(item, c).nc <= spaceNcLimit + 2) ncCap = c; else break;
    }
    cap = Math.min(cap, ncCap);
  }
  return Math.max(1, cap);
}

/** Supply candidate items sorted smallest-to-largest by neck area. */
function supplyCandidates(catalog: DiffuserCatalogItem[], terminalType: string): DiffuserCatalogItem[] {
  const c = catalog.filter(
    (d) => d.terminalType === terminalType || d.terminalType === 'square-ceiling' || d.terminalType === 'round-ceiling'
  );
  return (c.length ? c : catalog).slice().sort((a, b) => neckAreaSqFt(a) - neckAreaSqFt(b));
}

/** Largest CFM per terminal any catalog supply diffuser can deliver within the limits. */
export function maxCfmPerDiffuser(
  spaceNcLimit: number = 30,
  terminalType: string = 'square-ceiling',
  catalog: DiffuserCatalogItem[] = STANDARD_DIFFUSER_CATALOG,
  options: DiffuserSelectionOptions = {}
): number {
  const v = options.maxNeckVelocityFpm ?? MAX_NECK_VELOCITY_FPM;
  return Math.max(...supplyCandidates(catalog, terminalType).map(i => maxCfmPerItem(i, spaceNcLimit, v)), 1);
}

/**
 * Picks the SMALLEST catalog size whose neck velocity is <= limit and whose CFM sits within the
 * catalog range (and NC within the space limit). If none fits, the largest size is returned
 * with `withinLimits = false` and `requiredCount` > 1 (use more diffusers).
 */
export function selectBestDiffuserFromCatalog(
  cfmPerTerminal: number,
  spaceNcLimit: number = 30,
  terminalType: string = 'square-ceiling',
  catalog: DiffuserCatalogItem[] = STANDARD_DIFFUSER_CATALOG,
  options: DiffuserSelectionOptions = {}
): SelectedDiffuserResult {
  const vLimit = options.maxNeckVelocityFpm ?? MAX_NECK_VELOCITY_FPM;
  const candidates = supplyCandidates(catalog, terminalType);

  let chosen: DiffuserCatalogItem | undefined;
  let withinLimits = false;

  const fits = (item: DiffuserCatalogItem, ncTol: number): boolean => {
    const area = neckAreaSqFt(item);
    const vel = area > 0 ? cfmPerTerminal / area : 0;
    if (vel > vLimit) return false;
    if (cfmPerTerminal > item.maxCfm) return false;
    if (cfmPerTerminal < item.minCfm * 0.75) return false;
    return interpolate(item, cfmPerTerminal).nc <= spaceNcLimit + ncTol;
  };

  chosen = candidates.find(i => fits(i, 2));
  withinLimits = !!chosen;
  if (!chosen) {
    // Ignore the NC criterion before giving up on the "fits" outcome
    const relaxed = candidates.find(i => {
      const area = neckAreaSqFt(i);
      return (area <= 0 || cfmPerTerminal / area <= vLimit) && cfmPerTerminal <= i.maxCfm && cfmPerTerminal >= i.minCfm * 0.75;
    });
    if (relaxed) chosen = relaxed;
  }
  if (!chosen) {
    // Nothing fits: choose the largest size (highest capacity) and request more terminals
    chosen = candidates[candidates.length - 1] || catalog[0];
  }

  const perf = interpolate(chosen, cfmPerTerminal);
  const area = neckAreaSqFt(chosen);
  const velocity = area > 0 ? cfmPerTerminal / area : 0;
  const cap = maxCfmPerItem(chosen, spaceNcLimit, vLimit);
  const requiredCount = withinLimits || (velocity <= vLimit && cfmPerTerminal <= chosen.maxCfm)
    ? 1
    : Math.max(1, Math.ceil(cfmPerTerminal / cap));

  const labels = terminalSizeLabels(chosen, options.metric === true);
  const faceDim = labels.face;
  const neckDim = labels.neck;

  return {
    catalogItem: chosen,
    model: `${chosen.manufacturer} ${chosen.model}`,
    faceDimension: faceDim,
    neckDimension: neckDim,
    nominalCfm: cfmPerTerminal,
    actualNc: Math.round(perf.nc),
    throwT50Ft: parseFloat(perf.t50.toFixed(1)),
    deltaPInWg: parseFloat(perf.dp.toFixed(3)),
    neckVelocityFpm: Math.round(velocity),
    withinLimits,
    requiredCount
  };
}
