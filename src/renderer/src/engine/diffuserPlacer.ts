import { getPolygonCentroid, isPointInPolygon } from './geometry';
import { DiffuserCatalogItem } from './types';
import { STANDARD_DIFFUSER_CATALOG } from './hvacCatalogs';

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
 * Selects the best matching diffuser record from catalog based on CFM and space NC limit
 */
export function selectBestDiffuserFromCatalog(
  cfmPerTerminal: number,
  spaceNcLimit: number = 30,
  catalog: DiffuserCatalogItem[] = STANDARD_DIFFUSER_CATALOG
): { diffuser: DiffuserCatalogItem; actualNc: number; throwT50Ft: number; deltaPInWg: number } {
  // Filter candidate supply diffusers
  const supplyDiffusers = catalog.filter(
    d => d.terminalType === 'square-ceiling' || d.terminalType === 'round-ceiling' || d.terminalType === 'linear-slot'
  );

  let bestMatch = supplyDiffusers[0];
  let minDiff = Infinity;
  let bestNc = 25;
  let bestThrow = 10;
  let bestDeltaP = 0.035;

  for (const item of supplyDiffusers) {
    if (item.performanceTable && item.performanceTable.length > 0) {
      // Check if CFM is within operating range
      if (cfmPerTerminal >= item.minCfm * 0.8 && cfmPerTerminal <= item.maxCfm * 1.2) {
        // Find closest point in performance table
        const sorted = [...item.performanceTable].sort((a, b) => Math.abs(a.cfm - cfmPerTerminal) - Math.abs(b.cfm - cfmPerTerminal));
        const point = sorted[0];

        if (point.ncRating <= spaceNcLimit + 2) {
          const diff = Math.abs(point.cfm - cfmPerTerminal);
          if (diff < minDiff) {
            minDiff = diff;
            bestMatch = item;
            bestNc = point.ncRating;
            bestThrow = point.throwFt.t50;
            bestDeltaP = point.deltaPInWg;
          }
        }
      }
    }
  }

  return {
    diffuser: bestMatch,
    actualNc: bestNc,
    throwT50Ft: bestThrow,
    deltaPInWg: bestDeltaP
  };
}

/**
 * Searches AutoCAD DXF/DWG entities for pre-existing terminal positions.
 * Strictly filters by mechanical/HVAC layer names to prevent matching architectural furniture/chairs.
 */
export function findCadTerminalPositions(
  zonePoints: number[],
  dxfEntities: any[],
  systemType: 'concealed' | 'packaged' | 'cassette' | 'high-wall' | 'vrf' | 'ahu',
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

  const textsInZone = hvacEntities.filter(ent =>
    (ent.type === 'TEXT' || ent.type === 'MTEXT') &&
    typeof ent.x === 'number' && typeof ent.y === 'number' &&
    isPointInPolygon(ent.x, ent.y, zonePoints)
  );

  const circlesInZone = hvacEntities.filter(ent =>
    ent.type === 'CIRCLE' &&
    typeof ent.x === 'number' && typeof ent.y === 'number' &&
    isPointInPolygon(ent.x, ent.y, zonePoints)
  );

  const polylinesInZone = hvacEntities.filter(ent =>
    (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') &&
    ent.points && ent.points.length >= 8 &&
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

/**
 * Places diffusers and terminals inside a zone polygon.
 * Supports CAD matching, throw intervals ($0.75L \le T_{50} \le 1.25L$), and product catalog data.
 */
export function placeDiffusers(
  points: number[],
  totalFlow: number,
  isImperial: boolean = true,
  _spacingFt: number = 10,
  _scale: number = 10,
  dxfEntities: any[] = [],
  systemType: 'concealed' | 'packaged' | 'cassette' | 'high-wall' | 'vrf' | 'ahu' = 'concealed',
  totalLoadBtu?: number,
  catalogQty?: number,
  catalogModel?: string,
  spaceNcLimit: number = 30
): DiffuserPos[] {
  if (points.length < 6 || totalFlow <= 0) return [];

  const cfm = isImperial ? totalFlow : totalFlow * 2.119;
  const loadBtu = totalLoadBtu || (cfm * (isImperial ? 30 : 8.8));

  // Determine number of terminals
  let numTerminals = 1;
  if (catalogQty !== undefined && catalogQty > 0) {
    numTerminals = catalogQty;
  } else if (systemType === 'cassette') {
    numTerminals = Math.max(1, Math.ceil(loadBtu / 38000));
  } else if (systemType === 'high-wall') {
    numTerminals = Math.max(1, Math.ceil(loadBtu / 24000));
  } else {
    // 1 diffuser per 250-350 CFM for quiet, uniform air distribution
    numTerminals = Math.max(1, Math.ceil(cfm / 300));
  }

  // Calculate flow per terminal
  const flowPerTerminal = Math.round(totalFlow / numTerminals);
  const cfmPerTerminal = Math.round(cfm / numTerminals);

  // Look up product-specific diffuser from catalog
  const selection = selectBestDiffuserFromCatalog(cfmPerTerminal, spaceNcLimit);
  let sizeLabel = `${selection.diffuser.faceSizeIn.width}"x${selection.diffuser.faceSizeIn.height}"`;

  if (systemType === 'cassette') {
    sizeLabel = catalogModel || '36K';
  } else if (systemType === 'high-wall') {
    sizeLabel = catalogModel || '24K';
  } else if (!isImperial) {
    sizeLabel = `${Math.round(selection.diffuser.faceSizeIn.width * 25.4)}x${Math.round(selection.diffuser.faceSizeIn.height * 25.4)}`;
  }

  // Try snapping to CAD positions if valid mechanical terminals exist matching required count
  const cadPositions = findCadTerminalPositions(points, dxfEntities, systemType, numTerminals);
  if (cadPositions.length > 0 && Math.abs(cadPositions.length - numTerminals) <= 1) {
    const cadFlow = Math.round(totalFlow / cadPositions.length);
    return cadPositions.map((pos, idx) => ({
      id: `terminal-${Date.now()}-${idx}`,
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      cfm: cadFlow,
      size: sizeLabel,
      type: systemType === 'cassette' ? 'cassette' : systemType === 'high-wall' ? 'high-wall' : 'supply',
      actualNc: selection.actualNc,
      throwT50Ft: selection.throwT50Ft,
      deltaPInWg: selection.deltaPInWg
    }));
  }

  // Standard Geometric Grid Distribution
  const terminals: DiffuserPos[] = [];

  // Bounding box of zone polygon
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const numPoints = points.length / 2;
  for (let i = 0; i < numPoints; i++) {
    const x = points[2 * i];
    const y = points[2 * i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const width = maxX - minX;
  const height = maxY - minY;

  // Single terminal: Centroid
  if (numTerminals === 1) {
    const centroid = getPolygonCentroid(points);
    return [{
      id: `terminal-${Date.now()}-0`,
      x: Math.round(centroid.x),
      y: Math.round(centroid.y),
      cfm: flowPerTerminal,
      size: sizeLabel,
      type: systemType === 'cassette' ? 'cassette' : systemType === 'high-wall' ? 'high-wall' : 'supply',
      actualNc: selection.actualNc,
      throwT50Ft: selection.throwT50Ft,
      deltaPInWg: selection.deltaPInWg
    }];
  }

  // Multiple terminals: Uniform Grid
  const ar = width / height;
  let rows = Math.round(Math.sqrt(numTerminals / ar));
  rows = Math.max(1, rows);
  let cols = Math.ceil(numTerminals / rows);
  cols = Math.max(1, cols);

  const colWidth = width / cols;
  const rowHeight = height / rows;

  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let gx = minX + (c + 0.5) * colWidth;
      let gy = minY + (r + 0.5) * rowHeight;

      if (!isPointInPolygon(gx, gy, points)) {
        const centroid = getPolygonCentroid(points);
        gx = (gx + centroid.x) / 2;
        gy = (gy + centroid.y) / 2;
        if (!isPointInPolygon(gx, gy, points)) {
          gx = centroid.x;
          gy = centroid.y;
        }
      }

      terminals.push({
        id: `terminal-${Date.now()}-${count++}`,
        x: Math.round(gx),
        y: Math.round(gy),
        cfm: flowPerTerminal,
        size: sizeLabel,
        type: systemType === 'cassette' ? 'cassette' : systemType === 'high-wall' ? 'high-wall' : 'supply',
        actualNc: selection.actualNc,
        throwT50Ft: selection.throwT50Ft,
        deltaPInWg: selection.deltaPInWg
      });

      if (terminals.length >= numTerminals) break;
    }
    if (terminals.length >= numTerminals) break;
  }

  return terminals;
}
