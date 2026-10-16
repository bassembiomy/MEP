import type { DxfEntity } from '../store/projectStore';
import { isPointInPolygon, layoutTerminalGrid } from './geometry';
import { DiffuserCatalogItem } from './types';
import { STANDARD_DIFFUSER_CATALOG } from './hvacCatalogs';
import {
  selectBestDiffuserFromCatalog as selectSupplyDiffuser,
  maxCfmPerDiffuser,
  CASSETTE_NOMINAL_BTU,
  HIGH_WALL_NOMINAL_BTU
} from './terminals/diffuserSelector';
import { selectReturnPositions, computeReturnCfm } from './terminals/returnPlacer';

export interface DiffuserPos {
  id: string;
  x: number;
  y: number;
  cfm: number;
  size: string; // E.g. '9"x9"', '12"x12"', '15"x15"', or '36K' for cassettes
  type?: 'supply' | 'return' | 'exhaust' | 'cassette' | 'high-wall';
  actualNc?: number;
  throwT50Ft?: number;
  deltaPInWg?: number;
}

/**
 * Selects the smallest catalog diffuser whose neck velocity (<= ~700 fpm) and CFM range fit.
 * When nothing fits the largest size is returned with `requiredCount` > 1 and `withinLimits` false.
 */
export function selectBestDiffuserFromCatalog(
  cfmPerTerminal: number,
  spaceNcLimit: number = 30,
  catalog: DiffuserCatalogItem[] = STANDARD_DIFFUSER_CATALOG
): {
  diffuser: DiffuserCatalogItem;
  actualNc: number;
  throwT50Ft: number;
  deltaPInWg: number;
  neckVelocityFpm: number;
  withinLimits: boolean;
  requiredCount: number;
} {
  const supply = catalog.filter(
    d => d.terminalType === 'square-ceiling' || d.terminalType === 'round-ceiling' || d.terminalType === 'linear-slot'
  );
  const r = selectSupplyDiffuser(cfmPerTerminal, spaceNcLimit, 'square-ceiling', supply.length ? supply : catalog);
  return {
    diffuser: r.catalogItem,
    actualNc: r.actualNc,
    throwT50Ft: r.throwT50Ft,
    deltaPInWg: r.deltaPInWg,
    neckVelocityFpm: r.neckVelocityFpm,
    withinLimits: r.withinLimits,
    requiredCount: r.requiredCount
  };
}

/**
 * Searches AutoCAD DXF/DWG entities for pre-existing terminal positions.
 * Strictly filters by mechanical/HVAC layer names to prevent matching architectural furniture/chairs.
 */
export function findCadTerminalPositions(
  zonePoints: number[],
  dxfEntities: DxfEntity[],
  systemType: 'concealed' | 'packaged' | 'cassette' | 'high-wall' | 'vrf' | 'ahu' | 'fcu',
  maxAllowedTerminals: number = 8
): { x: number; y: number; label?: string }[] {
  if (!dxfEntities || dxfEntities.length === 0 || zonePoints.length < 6) {
    return [];
  }

  // Filter ONLY entities belonging to explicit mechanical / HVAC layers
  const hvacEntities = dxfEntities.filter(ent => {
    const layer = (ent.layer || '').toLowerCase();
    return (
      layer.includes('hvac') ||
      layer.includes('mech') ||
      layer.includes('m-') ||
      layer.includes('diff') ||
      layer.includes('grille') ||
      layer.includes('cass') ||
      layer.includes('equip')
    );
  });

  if (hvacEntities.length === 0) {
    return [];
  }

  type PositionedEntity = DxfEntity & { x: number; y: number };
  type PolylineEntity = DxfEntity & { points: number[] };

  const textsInZone = hvacEntities.filter((ent): ent is PositionedEntity =>
    (ent.type === 'TEXT' || ent.type === 'MTEXT') &&
    typeof ent.x === 'number' && typeof ent.y === 'number' &&
    isPointInPolygon(ent.x, ent.y, zonePoints)
  );

  const circlesInZone = hvacEntities.filter((ent): ent is PositionedEntity =>
    ent.type === 'CIRCLE' &&
    typeof ent.x === 'number' && typeof ent.y === 'number' &&
    isPointInPolygon(ent.x, ent.y, zonePoints)
  );

  const polylinesInZone = hvacEntities.filter((ent): ent is PolylineEntity =>
    (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') &&
    !!ent.points && ent.points.length >= 8 &&
    isPointInPolygon(ent.points[0], ent.points[1], zonePoints)
  );

  const candidatePoints: { x: number; y: number; weight: number; label?: string }[] = [];

  if (systemType === 'cassette') {
    const cassetteKeywords = ['cassette', 'cs-', 'fcu-', 'indoor unit', 'ac-'];

    for (const t of textsInZone) {
      const txt = (t.text || '').toLowerCase();
      if (cassetteKeywords.some(kw => txt.includes(kw))) {
        const isSpecification = txt.includes('each') || txt.includes('btu') || txt.includes('cfm') || txt.includes('l/s') || txt.length > 25;
        if (!isSpecification) {
          candidatePoints.push({ x: t.x, y: t.y, weight: 3, label: t.text });
        }
      }
    }

    for (const c of circlesInZone) {
      if (c.radius && c.radius >= 8 && c.radius <= 25) {
        candidatePoints.push({ x: c.x, y: c.y, weight: 2, label: 'Cassette' });
      }
    }

    for (const poly of polylinesInZone) {
      const pts = poly.points;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        if (pts[i] < minX) minX = pts[i];
        if (pts[i] > maxX) maxX = pts[i];
        if (pts[i + 1] < minY) minY = pts[i + 1];
        if (pts[i + 1] > maxY) maxY = pts[i + 1];
      }
      const w = maxX - minX;
      const h = maxY - minY;
      const aspect = w / (h || 1);
      if (w >= 18 && w <= 40 && h >= 18 && h <= 40 && aspect >= 0.85 && aspect <= 1.18) {
        candidatePoints.push({ x: minX + w / 2, y: minY + h / 2, weight: 4, label: 'Cassette' });
      }
    }
  } else {
    const diffuserKeywords = ['diffuser', 'scd', 'sad', 'rad', 'grille'];

    for (const t of textsInZone) {
      const txt = (t.text || '').toLowerCase();
      if (diffuserKeywords.some(kw => txt.includes(kw))) {
        const isSpecification = txt.includes('each') || txt.includes('btu') || txt.includes('cfm') || txt.includes('l/s') || txt.length > 25;
        if (!isSpecification) {
          candidatePoints.push({ x: t.x, y: t.y, weight: 3, label: t.text });
        }
      }
    }

    for (const c of circlesInZone) {
      if (c.radius && c.radius >= 5 && c.radius <= 14) {
        candidatePoints.push({ x: c.x, y: c.y, weight: 2, label: 'Diffuser' });
      }
    }
  }

  // Deduplicate points within 60 pixels (6 ft) distance to prevent clustering
  const mergedPoints: { x: number; y: number; label?: string }[] = [];
  const distanceThreshold = 60;

  candidatePoints.sort((a, b) => b.weight - a.weight);

  for (const cp of candidatePoints) {
    let exists = false;
    for (const mp of mergedPoints) {
      const dx = cp.x - mp.x;
      const dy = cp.y - mp.y;
      if (Math.hypot(dx, dy) < distanceThreshold) {
        exists = true;
        if (cp.label && cp.label !== 'Cassette' && cp.label !== 'Diffuser') {
          mp.label = cp.label;
        }
        break;
      }
    }
    if (!exists) {
      mergedPoints.push({ x: cp.x, y: cp.y, label: cp.label });
    }
    if (mergedPoints.length >= maxAllowedTerminals) break;
  }

  return mergedPoints;
}

/** Extra, optional inputs for placeDiffusers (all backward compatible). */
export interface PlaceDiffusersOptions {
  /** Prefix for deterministic ids, e.g. the zone id: `${prefix}-SD-01`, `${prefix}-RG-01`. */
  idPrefix?: string;
  /** Exhaust airflow (CFM) leaving the room; return = supply - (exhaust + exfiltration). */
  exhaustCfm?: number;
  /** Exfiltration airflow (CFM); default return = supply * 0.9 when neither is given. */
  exfiltrationCfm?: number;
  /** Indoor-unit position (plenum-return side): first return grille is placed nearest to it. */
  unitPos?: { x: number; y: number };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Places diffusers and terminals inside a zone polygon.
 * `_scale` is drawing units per foot (px callers pass project scale; feet callers pass 1).
 * Supports CAD matching, throw intervals ($0.75L \le T_{50} \le 1.25L$), and product catalog data.
 *
 * Counts: cassette / high-wall = number of indoor units (catalogQty or load/nominal);
 * ducted = ceil(cfm / max CFM per diffuser) with neck velocity <= 700 fpm and NC respected.
 * All terminals are inside the polygon (point-in-polygon verified), unique, and cell-centred.
 */
export function placeDiffusers(
  points: number[],
  totalFlow: number,
  isImperial: boolean = true,
  _spacingFt: number = 10,
  _scale: number = 10,
  dxfEntities: DxfEntity[] = [],
  systemType: 'concealed' | 'packaged' | 'cassette' | 'high-wall' | 'vrf' | 'ahu' | 'fcu' = 'concealed',
  totalLoadBtu?: number,
  catalogQty?: number,
  catalogModel?: string,
  spaceNcLimit: number = 30,
  options: PlaceDiffusersOptions = {}
): DiffuserPos[] {
  if (points.length < 6 || !(totalFlow > 0)) return [];
  const u = _scale > 0 ? _scale : 1;
  const prefix = options.idPrefix ?? 'terminal';

  const cfm = isImperial ? totalFlow : totalFlow * 2.119;
  const loadBtu = totalLoadBtu || (cfm * (isImperial ? 30 : 8.8));
  const isIndoorUnitTerminal = systemType === 'cassette' || systemType === 'high-wall';
  const termType: DiffuserPos['type'] = systemType === 'cassette' ? 'cassette' : systemType === 'high-wall' ? 'high-wall' : 'supply';

  // Determine number of terminals
  let numTerminals = 1;
  if (isIndoorUnitTerminal) {
    if (catalogQty !== undefined && catalogQty > 0) numTerminals = Math.floor(catalogQty);
    else numTerminals = Math.max(1, Math.ceil(loadBtu / (systemType === 'cassette' ? CASSETTE_NOMINAL_BTU : HIGH_WALL_NOMINAL_BTU)));
  } else {
    // Ducted: catalogQty is the number of INDOOR UNITS, not diffusers. Size by neck velocity / NC.
    const maxPer = maxCfmPerDiffuser(spaceNcLimit);
    numTerminals = Math.max(1, Math.ceil(cfm / maxPer));
  }
  numTerminals = Math.max(1, numTerminals);

  // Re-select once the count is known; add diffusers if even the largest size is overloaded
  let selection = selectBestDiffuserFromCatalog(Math.round(cfm / numTerminals), spaceNcLimit);
  if (!isIndoorUnitTerminal) {
    for (let g = 0; g < 4 && selection.requiredCount > 1; g++) {
      numTerminals *= selection.requiredCount;
      selection = selectBestDiffuserFromCatalog(Math.round(cfm / numTerminals), spaceNcLimit);
    }
  }

  const ceilFt = (v: number): number => (u >= 5 ? Math.round(v) : parseFloat(v.toFixed(2)));
  // Round for the canvas, but never leave the polygon because of rounding
  const settle = (x: number, y: number): { x: number; y: number; } => {
    const rx = ceilFt(x), ry = ceilFt(y);
    return isPointInPolygon(rx, ry, points) ? { x: rx, y: ry } : { x: parseFloat(x.toFixed(3)), y: parseFloat(y.toFixed(3)) };
  };

  const sizeLabelFor = (): string => {
    if (systemType === 'cassette') return catalogModel || '36K';
    if (systemType === 'high-wall') return catalogModel || '24K';
    const f = selection.diffuser.faceSizeIn;
    return isImperial ? `${f.width}"x${f.height}"` : `${Math.round(f.width * 25.4)}x${Math.round(f.height * 25.4)}`;
  };

  // Try snapping to CAD positions if valid mechanical terminals exist matching required count
  const cadPositions = findCadTerminalPositions(points, dxfEntities, systemType, numTerminals)
    .filter(p => isPointInPolygon(p.x, p.y, points));
  if (cadPositions.length > 0 && Math.abs(cadPositions.length - numTerminals) <= 1) {
    const cadFlow = Math.round(totalFlow / cadPositions.length);
    return cadPositions.map((pos, idx) => ({
      id: `${prefix}-SD-${pad2(idx + 1)}`,
      ...settle(pos.x, pos.y),
      cfm: cadFlow,
      size: sizeLabelFor(),
      type: termType,
      actualNc: selection.actualNc,
      throwT50Ft: selection.throwT50Ft,
      deltaPInWg: selection.deltaPInWg
    }));
  }

  const grid = layoutTerminalGrid(points, numTerminals, { unitPerFt: u });
  const count = grid.points.length;
  if (count === 0) return [];
  const flowPerTerminal = Math.round(totalFlow / count);
  const sizeLabel = sizeLabelFor();

  const terminals: DiffuserPos[] = grid.points.map((p, i) => ({
    id: `${prefix}-SD-${pad2(i + 1)}`,
    ...settle(p.x, p.y),
    cfm: flowPerTerminal,
    size: sizeLabel,
    type: termType,
    actualNc: selection.actualNc,
    throwT50Ft: selection.throwT50Ft,
    deltaPInWg: selection.deltaPInWg
  }));

  // Generate Return Air Grilles for ducted systems
  const isDuctedSystem = systemType === 'concealed' || systemType === 'packaged' || systemType === 'vrf' || systemType === 'ahu';
  if (isDuctedSystem && terminals.length > 0) {
    const numReturns = Math.max(1, Math.ceil(cfm / 800));
    const returnCfm = computeReturnCfm(cfm, options);
    const returnCfmPerGrille = Math.round(returnCfm / numReturns);
    const retPos = selectReturnPositions(points, terminals, numReturns, { unitPerFt: u, anchor: options.unitPos });



    retPos.forEach((rp, rIdx) => {
      terminals.push({
        id: `${prefix}-RG-${pad2(rIdx + 1)}`,
        ...settle(rp.x, rp.y),
        cfm: returnCfmPerGrille,
        size: returnCfmPerGrille > 400 ? '24"x24"' : '18"x18"',
        type: 'return',
        actualNc: Math.max(18, selection.actualNc - 4),
        throwT50Ft: 0,
        deltaPInWg: 0.025
      });
    });
  }

  return terminals;
}
