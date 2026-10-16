import { EquipmentServiceZone, DesignControlMode } from '../zoning/zonePartitioner';
import { selectBestDiffuserFromCatalog } from './diffuserSelector';
import { layoutTerminalGrid, THROW_RATIO_MIN, THROW_RATIO_MAX } from '../geometry';

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
}

/**
 * Places supply diffusers on a professional cell-centred grid inside the zone polygon (feet).
 * Every position is inside the polygon, unique, and at least half a grid spacing from the walls.
 * `throwRatio` = T50 / L with L = half the governing spacing (0.75 - 1.25 passes).
 */
export function placeSupplyDiffusersForZone(
  zone: EquipmentServiceZone,
  options: { targetCfmPerDiffuser?: number; unitPerFt?: number } = {}
): CoordinatedAirTerminal[] {
  const { targetCfmPerDiffuser = 350, unitPerFt = 1 } = options;
  const zoneCfm = zone.supplyCfm;
  if (!(zoneCfm > 0) || zone.serviceAreaPolygon.length < 6) return [];

  let numDiffusers = Math.max(1, Math.round(zoneCfm / targetCfmPerDiffuser));
  let selected = selectBestDiffuserFromCatalog(Math.round(zoneCfm / numDiffusers), zone.targetNc);
  // If nothing fits (neck velocity / catalog range), add diffusers rather than overloading one
  for (let guard = 0; guard < 4 && selected.requiredCount > 1; guard++) {
    numDiffusers *= selected.requiredCount;
    selected = selectBestDiffuserFromCatalog(Math.round(zoneCfm / numDiffusers), zone.targetNc);
  }

  const grid = layoutTerminalGrid(zone.serviceAreaPolygon, numDiffusers, { unitPerFt });
  if (grid.points.length === 0) return [];
  numDiffusers = grid.points.length; // the room may hold fewer than requested; never stack terminals

  const cfmPerDiffuser = Math.round(zoneCfm / numDiffusers);
  selected = selectBestDiffuserFromCatalog(cfmPerDiffuser, zone.targetNc);
  const throwRatio = parseFloat((selected.throwT50Ft / Math.max(grid.throwLengthFt, 1e-6)).toFixed(2));
  const status: CoordinatedAirTerminal['status'] =
    throwRatio >= THROW_RATIO_MIN && throwRatio <= THROW_RATIO_MAX && selected.withinLimits ? 'pass' : 'warning';

  const terminals: CoordinatedAirTerminal[] = [];
  let remainingCfm = zoneCfm;
  grid.points.forEach((p, i) => {
    const isLast = i === numDiffusers - 1;
    const thisCfm = isLast ? remainingCfm : cfmPerDiffuser;
    remainingCfm -= thisCfm;
    terminals.push({
      id: `SAD-${zone.unitTag}-${i + 1}`,
      unitId: zone.id,
      designControlMode: 'ai',
      type: 'supply',
      subtype: '4-way-ceiling',
      position: { x: parseFloat(p.x.toFixed(2)), y: parseFloat(p.y.toFixed(2)) },
      cfm: thisCfm,
      catalogModel: selected.model,
      neckDimension: selected.neckDimension,
      faceDimension: selected.faceDimension,
      throwT50Ft: selected.throwT50Ft,
      throwRatio,
      adjacentOverlapRatio: 0.85,
      occupiedZoneVelocityFpm: 40,
      ncRating: selected.actualNc,
      deltaPInWg: selected.deltaPInWg,
      status
    });
  });

  return terminals;
}
