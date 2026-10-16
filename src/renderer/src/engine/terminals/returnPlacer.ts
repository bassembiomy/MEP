import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from './terminalPlacer';
import { selectBestDiffuserFromCatalog } from './diffuserSelector';
import {
  getPolygonBounds,
  latticePointsInPolygon,
  distanceToPolygonEdge,
  WALL_CLEARANCE_FT,
  RETURN_SUPPLY_MIN_SEP_FT,
  MIN_TERMINAL_SPACING_FT
} from '../geometry';

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

  let cand: { x: number; y: number }[] = [];
  for (const f of [1, 0.5, 0.25, 0.05]) {
    cand = latticePointsInPolygon(polygon, step, (opts.wallClearanceFt ?? WALL_CLEARANCE_FT) * u * f);
    if (cand.length) break;
  }
  if (!cand.length) return [];

  const dSup = (p: { x: number; y: number }) =>
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
      const meetsSep = ds >= sep - 1e-6 && dr >= retSep - 1e-6;
      if (k === 0 && opts.anchor) {
        // near the unit's return side, but only among points that satisfy the separation
        const da = Math.hypot(p.x - opts.anchor.x, p.y - opts.anchor.y);
        score = (meetsSep ? 1e6 : Math.min(ds, sep) * 1e3) - da;
      } else {
        // otherwise maximise the distance from supplies (capped) and spread the returns
        score = (meetsSep ? 1e6 : 0) + Math.min(ds, 2 * sep) * 10 + Math.min(dr, 4 * sep) + distanceToPolygonEdge(p.x, p.y, polygon) * 0.01;
      }
      if (score > bScore) { bScore = score; bi = i; }
    }
    if (bi < 0) break;
    used.add(bi);
    picked.push(cand[bi]);
  }
  return picked;
}

export function placeReturnGrillesForZone(
  zone: EquipmentServiceZone,
  supplyTerminals: CoordinatedAirTerminal[],
  options: { unitPerFt?: number; exhaustCfm?: number; exfiltrationCfm?: number } = {}
): CoordinatedAirTerminal[] {
  const unitPerFt = options.unitPerFt ?? 1;
  const returnCfm = zone.returnCfm || computeReturnCfm(zone.supplyCfm, options);
  const bounds = getPolygonBounds(zone.serviceAreaPolygon);
  const wide = bounds.width > bounds.height * 1.3 && supplyTerminals.length >= 2;
  const numReturns = wide
    ? Math.max(2, Math.min(4, supplyTerminals.length))
    : Math.max(1, Math.min(2, supplyTerminals.length));

  // Plenum-return ducted units: first return is placed on the unit's return side (nearest the unit),
  // but still >= separation from every supply.
  const anchor = zone.equipmentPosition && zone.equipmentPosition.wallSide !== 'ceiling'
    ? { x: zone.equipmentPosition.x, y: zone.equipmentPosition.y }
    : undefined;

  const positions = selectReturnPositions(
    zone.serviceAreaPolygon,
    supplyTerminals.map(t => t.position),
    numReturns,
    { unitPerFt, anchor }
  );
  if (positions.length === 0) return [];

  const cfmPerReturn = Math.round(returnCfm / positions.length);
  const selected = selectBestDiffuserFromCatalog(cfmPerReturn, zone.targetNc);

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
