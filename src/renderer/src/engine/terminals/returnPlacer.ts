import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from './terminalPlacer';
import { selectBestDiffuserFromCatalog } from './diffuserSelector';
import {
  getPolygonBounds,
  latticePointsInPolygon,
  distanceToPolygonEdge,
  isPointInsideWithClearance,
  WALL_CLEARANCE_FT,
  RETURN_SUPPLY_MIN_SEP_FT,
  MIN_TERMINAL_SPACING_FT
} from '../geometry';
import { pointInRect, type Rect } from '../ducts/clearance';
import type { DiffuserCatalogItem } from '../types';

/** Default return = 90% of supply when no exhaust / exfiltration data is available. */
export const DEFAULT_RETURN_TO_SUPPLY_RATIO = 0.9;

/**
 * Return airflow = supply - (exhaust + exfiltration) when that data exists,
 * otherwise supply * DEFAULT_RETURN_TO_SUPPLY_RATIO.
 */
export function computeReturnCfm(
  supplyCfm: number,
  data: { exhaustCfm?: number; exfiltrationCfm?: number } = {}
): number {
  if (data.exhaustCfm === undefined && data.exfiltrationCfm === undefined) {
    return Math.round(supplyCfm * DEFAULT_RETURN_TO_SUPPLY_RATIO);
  }
  return Math.max(0, Math.round(supplyCfm - (data.exhaustCfm ?? 0) - (data.exfiltrationCfm ?? 0)));
}

export interface ReturnPositionOptions {
  unitPerFt?: number;
  wallClearanceFt?: number;
  minSupplySeparationFt?: number;
  /** Preferred location (e.g. the unit's plenum return side); the first return is placed nearest to it. */
  anchor?: { x: number; y: number };
  /** Rectangles (drawing units) no return grille centre may fall into (indoor unit footprint + service clearance). */
  keepOuts?: Rect[];
}

/**
 * Chooses `count` return-grille positions inside `polygon`: >= wall clearance from every wall,
 * >= minSupplySeparation from every supply when the room allows (otherwise the best achievable
 * separation), spread apart from each other, and for the first return nearest to `anchor` when given.
 */
export function selectReturnPositions(
  polygon: number[],
  supplies: { x: number; y: number }[],
  count: number,
  opts: ReturnPositionOptions = {}
): { x: number; y: number }[] {
  const u = opts.unitPerFt && opts.unitPerFt > 0 ? opts.unitPerFt : 1;
  if (polygon.length < 6 || count < 1) return [];
  const b = getPolygonBounds(polygon);
  const sep = (opts.minSupplySeparationFt ?? RETURN_SUPPLY_MIN_SEP_FT) * u;
  const retSep = MIN_TERMINAL_SPACING_FT * u;
  const step = Math.max(0.5 * u, Math.max(b.width, b.height) / 100);

  const keepOuts = opts.keepOuts ?? [];
  let cand: { x: number; y: number }[] = [];
  for (const f of [1, 0.5, 0.25, 0.05]) {
    cand = latticePointsInPolygon(polygon, step, (opts.wallClearanceFt ?? WALL_CLEARANCE_FT) * u * f, keepOuts);
    if (cand.length) break;
  }
  if (!cand.length) return [];

  const dSup = (p: { x: number; y: number }): number =>
    supplies.length ? Math.min(...supplies.map(s => Math.hypot(p.x - s.x, p.y - s.y))) : Infinity;

  const picked: { x: number; y: number }[] = [];
  const used = new Set<number>();
  for (let k = 0; k < count && used.size < cand.length; k++) {
    let bi = -1, bScore = -Infinity;
    for (let i = 0; i < cand.length; i++) {
      if (used.has(i)) continue;
      const p = cand[i];
      const ds = dSup(p);
      const dr = picked.length ? Math.min(...picked.map(q => Math.hypot(p.x - q.x, p.y - q.y))) : Infinity;
      let score: number;
      const drOk = dr >= retSep - 1e-6;
      // tier 2: preferred separation (6 ft); tier 1: hard minimum (4 ft); tier 0: best effort
      const tier = !drOk ? 0 : ds >= sep - 1e-6 ? 2 : ds >= retSep - 1e-6 ? 1 : 0;
      const meetsSep = tier === 2;
      if (k === 0 && opts.anchor) {
        // near the unit's return side, but only among points that satisfy the separation
        const da = Math.hypot(p.x - opts.anchor.x, p.y - opts.anchor.y);
        score = tier * 1e7 + (meetsSep ? 0 : Math.min(ds, sep) * 1e3) - da;
      } else {
        // otherwise maximise the distance from supplies (capped) and spread the returns
        score = tier * 1e7 + Math.min(ds, 2 * sep) * 10 + Math.min(dr, 4 * sep) + distanceToPolygonEdge(p.x, p.y, polygon) * 0.01;
      }
      if (score > bScore) { bScore = score; bi = i; }
    }
    if (bi < 0) break;
    used.add(bi);
    // Continuous refinement: the lattice can miss the exact cell centre by a fraction of a step, which
    // matters when the room only just allows the 4 ft separation. Hill-climb the separation (capped at the
    // preferred value) while staying inside the clearance and away from the other returns.
    let p = cand[bi];
    const wallClr = (opts.wallClearanceFt ?? WALL_CLEARANCE_FT) * u;
    if (supplies.length && dSup(p) < sep - 1e-6) {
      const f = (q: { x: number; y: number }): number => Math.min(dSup(q), sep);
      const okAt = (q: { x: number; y: number }): boolean =>
        isPointInsideWithClearance(q.x, q.y, polygon, wallClr) && !keepOuts.some((k) => pointInRect(q, k)) && picked.every((o) => Math.hypot(q.x - o.x, q.y - o.y) >= retSep - 1e-6);
      for (let h = 0.5 * u; h >= 0.01 * u; h /= 2) {
        for (let it = 0; it < 80; it++) {
          let best = p, bf = f(p);
          for (let a = 0; a < 8; a++) {
            const q = { x: p.x + h * Math.cos((a * Math.PI) / 4), y: p.y + h * Math.sin((a * Math.PI) / 4) };
            if (okAt(q) && f(q) > bf + 1e-9) { best = q; bf = f(q); }
          }
          if (best === p) break;
          p = best;
        }
      }
    }
    picked.push(p);
  }
  return picked;
}

/** Maximum return-grille face velocity (fpm) for a plenum return (NC / draft limit). */
export const MAX_RETURN_FACE_VELOCITY_FPM = 400;
/** Largest single built-up plenum return grille face (ft2): beyond it a second grille is used. */
const MAX_PLENUM_FACE_SQFT = 9;
/** Plenum returns use one or two grilles per unit. */
export const MAX_PLENUM_GRILLES_PER_UNIT = 2;

/** Grille count and face for a plenum return of `cfm`: face velocity <= 400 fpm, 1 grille unless it would not fit one. */
export function sizePlenumReturn(
  cfm: number,
  targetNc: number,
  catalog?: DiffuserCatalogItem[],
  metric = false
): { count: number; cfmEach: number; faceDimension: string; neckDimension: string; faceAreaSqFt: number; model: string; ncRating: number } {
  const areaOf = (it: DiffuserCatalogItem): number => (it.faceSizeIn.width * it.faceSizeIn.height) / 144;
  const items = (catalog ?? []).filter((c) => c.terminalType === 'square-ceiling' || c.terminalType === 'return-grille');
  const biggest = items.reduce((m, c) => Math.max(m, areaOf(c)), 0);
  // one grille unless its face velocity (even on a built-up grille) or NC cannot meet the limits
  let count = 1;
  let sel = selectBestDiffuserFromCatalog(Math.max(1, cfm), targetNc, 'square-ceiling', catalog, { metric });
  if (cfm / MAX_RETURN_FACE_VELOCITY_FPM > Math.max(biggest, MAX_PLENUM_FACE_SQFT) || sel.actualNc - 5 > targetNc || !sel.withinLimits) {
    count = MAX_PLENUM_GRILLES_PER_UNIT;
    sel = selectBestDiffuserFromCatalog(Math.round(cfm / count), targetNc, 'square-ceiling', catalog, { metric });
  }
  let faceArea = areaOf(sel.catalogItem);
  const cfmEach = Math.round(cfm / count);
  let face = sel.faceDimension;
  if (cfmEach / faceArea > MAX_RETURN_FACE_VELOCITY_FPM) {
    // custom (built-up) grille sized for the velocity limit, square, rounded up to 2 in
    const sideIn = Math.ceil(Math.sqrt((cfmEach / MAX_RETURN_FACE_VELOCITY_FPM) * 144) / 2) * 2;
    face = metric ? `${Math.round(sideIn * 25.4)}x${Math.round(sideIn * 25.4)}` : `${sideIn}"x${sideIn}"`;
    faceArea = (sideIn * sideIn) / 144;
  }
  return { count, cfmEach, faceDimension: face, neckDimension: sel.neckDimension, faceAreaSqFt: faceArea, model: `${sel.catalogItem.manufacturer} Eggcrate Return ${face}`, ncRating: Math.max(15, sel.actualNc - 5) };
}

export function placeReturnGrillesForZone(
  zone: EquipmentServiceZone,
  supplyTerminals: CoordinatedAirTerminal[],
  options: { /** Ceiling-plenum return: 1-2 grilles sized for the unit return CFM (face velocity <= 400 fpm). */ plenum?: boolean; unitPerFt?: number; exhaustCfm?: number; exfiltrationCfm?: number; keepOuts?: Rect[]; catalog?: DiffuserCatalogItem[]; metric?: boolean; /** Upper bound on the number of return grilles (fewer grilles = shorter return main, fewer crossings). */ maxCount?: number } = {}
): CoordinatedAirTerminal[] {
  const unitPerFt = options.unitPerFt ?? 1;
  const returnCfm = zone.returnCfm || computeReturnCfm(zone.supplyCfm, options);
  if (options.plenum) return placePlenumReturnGrilles(zone, supplyTerminals, returnCfm, options);
  const bounds = getPolygonBounds(zone.serviceAreaPolygon);
  const wide = bounds.width > bounds.height * 1.3 && supplyTerminals.length >= 2;
  const numReturns = wide
    ? Math.max(2, Math.min(4, supplyTerminals.length))
    : Math.max(1, Math.min(2, supplyTerminals.length));
  const cap = options.maxCount && options.maxCount >= 1 ? Math.floor(options.maxCount) : Infinity;

  // Plenum-return ducted units: first return is placed on the unit's return side (nearest the unit),
  // but still >= separation from every supply.
  const anchor = zone.equipmentPosition && zone.equipmentPosition.wallSide !== 'ceiling'
    ? { x: zone.equipmentPosition.x, y: zone.equipmentPosition.y }
    : undefined;

  const supplyPts = supplyTerminals.map(t => t.position);
  let positions = selectReturnPositions(zone.serviceAreaPolygon, supplyPts, Math.min(numReturns, cap), { unitPerFt, anchor, keepOuts: options.keepOuts });
  if (positions.length === 0) return [];
  // A small bay cannot hold the preferred count: drop returns closer than the 4 ft minimum to any supply or to
  // another return, but always keep the best-separated one.
  const minSep = MIN_TERMINAL_SPACING_FT * unitPerFt;
  const dS = (p: { x: number; y: number }): number =>
    supplyPts.length ? Math.min(...supplyPts.map(s => Math.hypot(p.x - s.x, p.y - s.y))) : Infinity;
  const keptPos: { x: number; y: number }[] = [];
  for (const p of positions) {
    if (dS(p) >= minSep - 1e-6 && keptPos.every(k => Math.hypot(k.x - p.x, k.y - p.y) >= minSep - 1e-6)) keptPos.push(p);
  }
  if (!keptPos.length) keptPos.push([...positions].sort((a, b) => dS(b) - dS(a))[0]);
  positions = keptPos;

  const cfmPerReturn = Math.round(returnCfm / positions.length);
  const selected = selectBestDiffuserFromCatalog(cfmPerReturn, zone.targetNc, 'square-ceiling', options.catalog, { metric: options.metric });

  return positions.map((p, i) => ({
    id: `RAG-${zone.unitTag}-${i + 1}`,
    unitId: zone.id,
    designControlMode: 'ai' as const,
    type: 'return' as const,
    subtype: 'eggcrate' as const,
    position: { x: parseFloat(p.x.toFixed(2)), y: parseFloat(p.y.toFixed(2)) },
    cfm: cfmPerReturn,
    catalogModel: `${selected.catalogItem.manufacturer} Eggcrate Return ${selected.faceDimension}`,
    neckDimension: selected.neckDimension,
    faceDimension: selected.faceDimension,
    throwT50Ft: 0,
    throwRatio: 1.0,
    adjacentOverlapRatio: 0,
    occupiedZoneVelocityFpm: 35,
    ncRating: Math.max(15, selected.actualNc - 5),
    deltaPInWg: 0.025,
    status: 'pass' as const
  }));
}


/** Plenum return: the fewest grilles (1-2) that hold the face velocity, placed near the unit but off its footprint and away from every supply. */
function placePlenumReturnGrilles(
  zone: EquipmentServiceZone,
  supplyTerminals: CoordinatedAirTerminal[],
  returnCfm: number,
  options: { unitPerFt?: number; keepOuts?: Rect[]; catalog?: DiffuserCatalogItem[]; metric?: boolean; maxCount?: number }
): CoordinatedAirTerminal[] {
  const unitPerFt = options.unitPerFt ?? 1;
  const size = sizePlenumReturn(returnCfm, zone.targetNc, options.catalog, options.metric);
  const want = Math.min(size.count, options.maxCount && options.maxCount >= 1 ? Math.floor(options.maxCount) : size.count);
  const anchor = zone.equipmentPosition && zone.equipmentPosition.wallSide !== 'ceiling'
    ? { x: zone.equipmentPosition.x, y: zone.equipmentPosition.y }
    : undefined;
  const supplyPts = supplyTerminals.map((t) => t.position);
  const positions = selectReturnPositions(zone.serviceAreaPolygon, supplyPts, want, { unitPerFt, anchor, keepOuts: options.keepOuts });
  if (!positions.length) return [];
  const cfmEach = Math.round(returnCfm / positions.length);
  return positions.map((p, i) => ({
    id: `RAG-${zone.unitTag}-${i + 1}`,
    unitId: zone.id,
    designControlMode: 'ai' as const,
    type: 'return' as const,
    subtype: 'eggcrate' as const,
    position: { x: parseFloat(p.x.toFixed(2)), y: parseFloat(p.y.toFixed(2)) },
    cfm: cfmEach,
    catalogModel: size.model,
    neckDimension: size.neckDimension,
    faceDimension: size.faceDimension,
    throwT50Ft: 0,
    throwRatio: 1.0,
    adjacentOverlapRatio: 0,
    occupiedZoneVelocityFpm: 35,
    ncRating: size.ncRating,
    deltaPInWg: 0.025,
    status: 'pass' as const
  }));
}
