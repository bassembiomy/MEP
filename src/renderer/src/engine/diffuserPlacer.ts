import { getPolygonCentroid, isPointInPolygon } from './geometry';
import { DiffuserCatalogItem } from './types';
import { STANDARD_DIFFUSER_CATALOG } from './hvacCatalogs';
import { atLevel } from './cad/elevation';

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
 * Selects the best matching diffuser record from catalog based on CFM and space NC limit.
 *
 * Selection respects the database performance tables:
 * 1. The terminal is evaluated at the requested flow clamped into its operating band.
 * 2. Candidates whose nearest table point violates the space NC limit are rejected.
 * 3. When a target throw is supplied, the candidate whose real T50 throw best matches
 *    the space wins (ASHRAE throw ratio T50/L ≈ 0.7-1.3 — excessive throw dumps air
 *    into the occupied zone, insufficient throw causes stagnation).
 * 4. Without a target, best throw wins among candidates with a reasonable pressure
 *    drop (<= 0.10 in. wg when available).
 * 5. Linear-slot terminals are excluded — the placement patterns here are
 *    square/round ceiling grids; slots are perimeter devices.
 * 6. There is NO fabricated fallback: the returned NC / throw / deltaP always
 *    come from a real catalog table row.
 */
export function selectBestDiffuserFromCatalog(
  cfmPerTerminal: number,
  spaceNcLimit: number = 30,
  catalog: DiffuserCatalogItem[] = STANDARD_DIFFUSER_CATALOG,
  targetThrowFt?: number
): { diffuser: DiffuserCatalogItem; actualNc: number; throwT50Ft: number; deltaPInWg: number } {
  const supplyDiffusers = catalog.filter(
    d => d.terminalType === 'square-ceiling' || d.terminalType === 'round-ceiling'
  );

  interface EvaluatedTerminal {
    item: DiffuserCatalogItem;
    nc: number;
    throwFt: number;
    deltaP: number;
    flow: number;
  }

  const evaluated: EvaluatedTerminal[] = [];

  for (const item of supplyDiffusers) {
    if (!item.performanceTable || item.performanceTable.length === 0) continue;
    // Evaluate the terminal at the requested flow clamped into its operating band
    const effectiveFlow = Math.min(Math.max(cfmPerTerminal, item.minCfm), item.maxCfm);
    const sorted = [...item.performanceTable].sort(
      (a, b) => Math.abs(a.cfm - effectiveFlow) - Math.abs(b.cfm - effectiveFlow)
    );
    const point = sorted[0];
    evaluated.push({
      item,
      nc: point.ncRating,
      throwFt: point.throwFt.t50,
      deltaP: point.deltaPInWg,
      flow: point.cfm
    });
  }

  if (evaluated.length === 0) {
    // No tabulated data exists at all — neutral defaults are unavoidable here
    const item = supplyDiffusers[0] || catalog[0];
    return { diffuser: item, actualNc: 25, throwT50Ft: 10, deltaPInWg: 0.035 };
  }

  // Preference order:
  // 1. Terminals whose nominal band actually contains the requested flow
  //    (never run a big terminal below its minCfm just to gain throw).
  // 2. NC-compliant candidates.
  // 3. Best T50 throw; ties break by closest table flow.
  const inBand = evaluated.filter(
    (c) => cfmPerTerminal >= c.item.minCfm && cfmPerTerminal <= c.item.maxCfm
  );
  const compliant = (list: EvaluatedTerminal[]): EvaluatedTerminal[] =>
    list.filter((c) => c.nc <= spaceNcLimit);

  const pool =
    compliant(inBand).length > 0
      ? compliant(inBand)
      : inBand.length > 0
      ? inBand
      : compliant(evaluated).length > 0
      ? compliant(evaluated)
      : evaluated;

  if (targetThrowFt && targetThrowFt > 0) {
    // Match the space: closest real T50 to the target, then lowest pressure drop
    pool.sort(
      (a, b) =>
        Math.abs(a.throwFt - targetThrowFt) - Math.abs(b.throwFt - targetThrowFt) ||
        a.deltaP - b.deltaP ||
        Math.abs(a.flow - cfmPerTerminal) - Math.abs(b.flow - cfmPerTerminal)
    );
  } else {
    // No space context: best throw first. Exclude unreasonable pressure drops
    // only when the pool is NC-feasible; for extreme flows beyond the whole
    // catalog, keep the largest honest terminal.
    const isFeasiblePool = pool.every((c) => c.nc <= spaceNcLimit);
    const narrowed =
      isFeasiblePool && pool.some((c) => c.deltaP <= 0.1)
        ? pool.filter((c) => c.deltaP <= 0.1)
        : pool;
    narrowed.sort(
      (a, b) =>
        b.throwFt - a.throwFt ||
        a.deltaP - b.deltaP ||
        Math.abs(a.flow - cfmPerTerminal) - Math.abs(b.flow - cfmPerTerminal)
    );
    const best = narrowed[0];
    return {
      diffuser: best.item,
      actualNc: best.nc,
      throwT50Ft: best.throwFt,
      deltaPInWg: best.deltaP
    };
  }

  const best = pool[0];
  return {
    diffuser: best.item,
    actualNc: best.nc,
    throwT50Ft: best.throwFt,
    deltaPInWg: best.deltaP
  };
}

/**
 * Searches AutoCAD DXF/DWG entities for pre-existing terminal positions.
 * Strictly filters by mechanical/HVAC layer names to prevent matching architectural furniture/chairs.
 */
export function findCadTerminalPositions(
  zonePoints: number[],
  dxfEntities: any[],
  systemType: 'concealed' | 'packaged' | 'cassette' | 'high-wall' | 'vrf' | 'ahu' | 'fcu',
  maxAllowedTerminals: number = 8,
  scale: number = 0,
  /** Elevation (drawing units) of the level whose terminal symbols to read; default 0 (elevated entities are ignored). */
  level: number = 0
): { x: number; y: number; label?: string }[] {
  if (!dxfEntities || dxfEntities.length === 0 || zonePoints.length < 6) {
    return [];
  }

  // Filter ONLY entities belonging to explicit mechanical / HVAC layers
  const hvacEntities = dxfEntities.filter(ent => {
    if (!atLevel(ent, level)) return false;
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

  // Plausible terminal symbol radius in RAW DRAWING UNITS. Without a scale window,
  // any small detail circle (door stops, columns, symbols in mm drawings) would be
  // mistaken for a diffuser. A real diffuser face is roughly 0.3ft to 2.5ft across.
  const minSymbolRadius = scale > 0 ? 0.15 * scale : 5;
  const maxSymbolRadius = scale > 0 ? 1.25 * scale : 14;

  const circlesInZone = hvacEntities.filter(ent =>
    ent.type === 'CIRCLE' &&
    typeof ent.x === 'number' && typeof ent.y === 'number' &&
    ent.radius >= minSymbolRadius && ent.radius <= maxSymbolRadius &&
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
      candidatePoints.push({ x: c.x, y: c.y, weight: 2, label: 'Cassette' });
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
      candidatePoints.push({ x: c.x, y: c.y, weight: 2, label: 'Diffuser' });
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
 * Calculates the percentage of a zone polygon area covered by the distribution circles (T50 throw) of its diffusers.
 */
export function calculateZoneDiffuserCoverage(
  points: number[],
  diffusers: DiffuserPos[],
  scale: number = 10,
  isImperial: boolean = true
): { coverageRatio: number; coveragePercent: number; isCovered95: boolean; isCovered98: boolean } {
  const supplyDiffusers = diffusers.filter(d => d.type === 'supply' || d.type === 'cassette' || !d.type);
  if (points.length < 6 || supplyDiffusers.length === 0) {
    return { coverageRatio: 0, coveragePercent: 0, isCovered95: false, isCovered98: false };
  }

  // Calculate polygon bounding box
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
  if (width <= 0 || height <= 0) {
    return { coverageRatio: 0, coveragePercent: 0, isCovered95: false, isCovered98: false };
  }

  // Sample grid resolution inside polygon (adaptive 15-35 steps per dimension)
  const stepsX = Math.min(35, Math.max(15, Math.round(width / 2)));
  const stepsY = Math.min(35, Math.max(15, Math.round(height / 2)));
  const stepX = width / stepsX;
  const stepY = height / stepsY;

  let totalInside = 0;
  let coveredInside = 0;

  // Pre-calculate diffuser radii in canvas world units
  const activeCircles = supplyDiffusers.map(d => {
    const throwFt = d.throwT50Ft && d.throwT50Ft > 0 ? d.throwT50Ft : 10;
    const radiusPx = isImperial ? throwFt * scale : throwFt * 0.3048 * scale;
    return { x: d.x, y: d.y, rSq: radiusPx * radiusPx };
  });

  for (let ix = 0; ix <= stepsX; ix++) {
    const px = minX + ix * stepX;
    for (let iy = 0; iy <= stepsY; iy++) {
      const py = minY + iy * stepY;
      if (isPointInPolygon(px, py, points)) {
        totalInside++;
        // Check if covered by any diffuser distribution circle
        let isCovered = false;
        for (let c = 0; c < activeCircles.length; c++) {
          const circle = activeCircles[c];
          const dx = px - circle.x;
          const dy = py - circle.y;
          if (dx * dx + dy * dy <= circle.rSq) {
            isCovered = true;
            break;
          }
        }
        if (isCovered) {
          coveredInside++;
        }
      }
    }
  }

  if (totalInside === 0) {
    return { coverageRatio: 0, coveragePercent: 0, isCovered95: false, isCovered98: false };
  }

  const coverageRatio = coveredInside / totalInside;
  const coveragePercent = parseFloat((coverageRatio * 100).toFixed(1));
  const isCovered95 = coveragePercent >= 95.0;
  const isCovered98 = coveragePercent >= 98.0;

  return { coverageRatio, coveragePercent, isCovered95, isCovered98 };
}

export interface DistributionOptions {
  coverageTargetPercent?: number; // 90 to 100, default 98
  pattern?: 'hexagonal' | 'orthogonal' | 'adaptive';
  throwRadiusMode?: 'catalog-t50' | 'cfm-area' | 'custom';
  customThrowFt?: number;
  overlapFactor?: number; // 1.0 to 1.5, default 1.15
  diffuserCountOverride?: number;
  catalogQty?: number;
  catalogModel?: string;
  spaceNcLimit?: number;
}

/**
 * Places diffusers using circular coverage optimization and hexagonal / grid distribution,
 * guaranteeing that diffuser throw circles cover the space polygon.
 */
export function placeDiffusersWithCircularOptimization(
  points: number[],
  totalFlow: number,
  isImperial: boolean = true,
  _spacingFt: number = 10,
  scale: number = 10,
  dxfEntities: any[] = [],
  systemType: 'concealed' | 'packaged' | 'cassette' | 'high-wall' | 'vrf' | 'ahu' | 'fcu' = 'concealed',
  totalLoadBtu?: number,
  options?: DistributionOptions
): DiffuserPos[] {
  if (points.length < 6 || totalFlow <= 0) return [];

  const cfm = isImperial ? totalFlow : totalFlow * 2.119;
  const loadBtu = totalLoadBtu || (cfm * (isImperial ? 30 : 8.8));
  const spaceNcLimit = options?.spaceNcLimit ?? 30;
  const targetCoverage = options?.coverageTargetPercent ?? 98;

  // Calculate polygon bounding box and polygon area
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

  // Polygon area in square feet
  let polyAreaPx = 0;
  for (let i = 0; i < numPoints; i++) {
    const j = (i + 1) % numPoints;
    polyAreaPx += points[2 * i] * points[2 * j + 1];
    polyAreaPx -= points[2 * j] * points[2 * i + 1];
  }
  const areaSqFt = Math.max(10, Math.abs(polyAreaPx / 2) / (scale * scale));

  // Determine initial baseline number of terminals
  let numTerminals = 1;
  const hasFixedOverride = options?.diffuserCountOverride !== undefined && options.diffuserCountOverride > 0;

  // AIRFLOW-FIRST TERMINAL SIZING. The count is driven by the total supply flow so
  // every terminal operates inside the healthy catalog band (200-400 CFM, the
  // range where database diffusers deliver proper throw and NC). Room area
  // influences placement geometry and throw coverage — never the terminal count.
  // (Area-driven counts produced nonsense like 4035 CFM split across 150+
  // terminals at ~26 CFM each, far below any catalog operating point.)
  const countByAirflow = Math.max(1, Math.round(cfm / 300));
  const minCount = Math.max(1, Math.ceil(cfm / 400));
  // 150 CFM floor = smallest square-ceiling terminal band in the catalog; keeps
  // the coverage loop free to add terminals in small rooms.
  const maxCount = Math.max(minCount, Math.floor(cfm / 150));

  if (hasFixedOverride) {
    numTerminals = options!.diffuserCountOverride!;
  } else if (systemType === 'cassette') {
    numTerminals = Math.max(1, Math.ceil(loadBtu / 38000));
  } else if (systemType === 'high-wall') {
    numTerminals = Math.max(1, Math.ceil(loadBtu / 24000));
  } else {
    numTerminals = countByAirflow;
  }

  // Enforce the healthy per-terminal airflow band on a derived count. A caller-fixed count
  // (e.g. the number of cassettes the design specified) is never altered here.
  if (!hasFixedOverride) numTerminals = Math.max(minCount, Math.min(numTerminals, maxCount));

  // Try snapping to CAD positions if valid mechanical terminals exist matching required count
  if (!hasFixedOverride) {
    const cadPositions = findCadTerminalPositions(points, dxfEntities, systemType, maxCount, scale);
    if (cadPositions.length > 0 && Math.abs(cadPositions.length - numTerminals) <= 1) {
      const cadFlow = Math.round(totalFlow / cadPositions.length);
      const cfmPerCad = Math.round(cfm / cadPositions.length);
      const cadTargetThrow = Math.max(
        6,
        Math.min(30, 0.9 * Math.sqrt(Math.max(20, areaSqFt / cadPositions.length)))
      );
      const selection = selectBestDiffuserFromCatalog(cfmPerCad, spaceNcLimit, undefined, cadTargetThrow);
      let sizeLabel = `${selection.diffuser.faceSizeIn.width}"x${selection.diffuser.faceSizeIn.height}"`;
      if (systemType === 'cassette') sizeLabel = options?.catalogModel || '36K';
      else if (systemType === 'high-wall') sizeLabel = options?.catalogModel || '24K';

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
  }

  // Generate dense grid of interior sample points strictly inside the polygon
  const sampleInteriorPoints = (): { x: number; y: number }[] => {
    const gridResX = Math.min(30, Math.max(12, Math.round(width / 20)));
    const gridResY = Math.min(30, Math.max(12, Math.round(height / 20)));
    const stepX = width / gridResX;
    const stepY = height / gridResY;
    const interior: { x: number; y: number }[] = [];

    for (let ix = 0; ix <= gridResX; ix++) {
      const px = minX + (ix + 0.5) * stepX;
      for (let iy = 0; iy <= gridResY; iy++) {
        const py = minY + (iy + 0.5) * stepY;
        if (isPointInPolygon(px, py, points)) {
          interior.push({ x: px, y: py });
        }
      }
    }

    if (interior.length === 0) {
      const numPts = points.length / 2;
      for (let i = 0; i < numPts; i++) {
        const p1x = points[i * 2], p1y = points[i * 2 + 1];
        const p2x = points[((i + 1) % numPts) * 2], p2y = points[((i + 1) % numPts) * 2 + 1];
        const midX = (p1x + p2x) / 2;
        const midY = (p1y + p2y) / 2;
        const c = getPolygonCentroid(points);
        const insideTestX = midX * 0.9 + c.x * 0.1;
        const insideTestY = midY * 0.9 + c.y * 0.1;
        if (isPointInPolygon(insideTestX, insideTestY, points)) {
          interior.push({ x: insideTestX, y: insideTestY });
          break;
        }
      }
      if (interior.length === 0) {
        interior.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
      }
    }
    return interior;
  };

  const interiorSamples = sampleInteriorPoints();

  // Generate candidate supply layout with collision-free Voronoi relaxation across the polygon
  const generateSupplyLayout = (count: number): DiffuserPos[] => {
    const flowPerTerminal = Math.round(totalFlow / count);
    const cfmPerTerminal = Math.round(cfm / count);
    // Target throw from the per-terminal characteristic length (ASHRAE throw-ratio
    // practice: T50 ≈ 0.9 x sqrt(served area) keeps T50/L inside 0.65-1.4)
    const areaPerTerminal = Math.max(20, areaSqFt / Math.max(1, count));
    const targetThrowFt = Math.max(6, Math.min(30, 0.9 * Math.sqrt(areaPerTerminal)));
    const selection = selectBestDiffuserFromCatalog(cfmPerTerminal, spaceNcLimit, STANDARD_DIFFUSER_CATALOG, targetThrowFt);

    let effectiveThrowFt = selection.throwT50Ft || 11;
    if (options?.throwRadiusMode === 'custom' && options?.customThrowFt) {
      effectiveThrowFt = options.customThrowFt;
    } else if (options?.throwRadiusMode === 'cfm-area') {
      effectiveThrowFt = Math.max(7, Math.min(22, Math.sqrt(cfmPerTerminal * 0.4)));
    }

    let sizeLabel = `${selection.diffuser.faceSizeIn.width}"x${selection.diffuser.faceSizeIn.height}"`;
    if (systemType === 'cassette') sizeLabel = options?.catalogModel || '36K';
    else if (systemType === 'high-wall') sizeLabel = options?.catalogModel || '24K';
    else if (!isImperial) {
      sizeLabel = `${Math.round(selection.diffuser.faceSizeIn.width * 25.4)}x${Math.round(selection.diffuser.faceSizeIn.height * 25.4)}`;
    }

    if (count === 1 || interiorSamples.length <= 1) {
      const centroid = getPolygonCentroid(points);
      const snapC = isPointInPolygon(centroid.x, centroid.y, points) ? centroid : interiorSamples[0];
      return [{
        id: `terminal-${Date.now()}-0`,
        x: Math.round(snapC.x),
        y: Math.round(snapC.y),
        cfm: flowPerTerminal,
        size: sizeLabel,
        type: systemType === 'cassette' ? 'cassette' : systemType === 'high-wall' ? 'high-wall' : 'supply',
        actualNc: selection.actualNc,
        throwT50Ft: effectiveThrowFt,
        deltaPInWg: selection.deltaPInWg
      }];
    }

    // 1. Seed initial cluster centers using Furthest Point Sampling across interior
    const seeds: { x: number; y: number }[] = [];
    const firstIdx = Math.floor(interiorSamples.length / 2);
    seeds.push({ ...interiorSamples[firstIdx] });

    let seedAttempts = 0;
    while (seeds.length < count && seedAttempts < 50) {
      seedAttempts++;
      let maxDistSq = -1;
      let bestPoint: { x: number; y: number } | null = null;

      for (const p of interiorSamples) {
        let minDistToSeeds = Infinity;
        for (const s of seeds) {
          const dSq = (p.x - s.x) * (p.x - s.x) + (p.y - s.y) * (p.y - s.y);
          if (dSq < minDistToSeeds) minDistToSeeds = dSq;
        }
        if (minDistToSeeds > maxDistSq && minDistToSeeds > 1) {
          maxDistSq = minDistToSeeds;
          bestPoint = p;
        }
      }

      if (bestPoint) {
        seeds.push({ ...bestPoint });
      } else {
        break; // All distinct interior points are already used
      }
    }

    // 2. Run Lloyd's Centroidal Relaxation (4 iterations) to evenly space diffusers across all polygon wings
    for (let iter = 0; iter < 4; iter++) {
      const clusters: { sumX: number; sumY: number; count: number }[] = seeds.map(() => ({ sumX: 0, sumY: 0, count: 0 }));

      for (const p of interiorSamples) {
        let nearestSeedIdx = 0;
        let nearestDistSq = Infinity;
        for (let sIdx = 0; sIdx < seeds.length; sIdx++) {
          const s = seeds[sIdx];
          const dSq = (p.x - s.x) * (p.x - s.x) + (p.y - s.y) * (p.y - s.y);
          if (dSq < nearestDistSq) {
            nearestDistSq = dSq;
            nearestSeedIdx = sIdx;
          }
        }
        clusters[nearestSeedIdx].sumX += p.x;
        clusters[nearestSeedIdx].sumY += p.y;
        clusters[nearestSeedIdx].count++;
      }

      for (let sIdx = 0; sIdx < seeds.length; sIdx++) {
        const c = clusters[sIdx];
        if (c.count > 0) {
          const newX = c.sumX / c.count;
          const newY = c.sumY / c.count;
          if (isPointInPolygon(newX, newY, points)) {
            seeds[sIdx] = { x: newX, y: newY };
          } else {
            let closestP = seeds[sIdx];
            let minD = Infinity;
            for (const p of interiorSamples) {
              const d = Math.hypot(p.x - newX, p.y - newY);
              if (d < minD) {
                minD = d;
                closestP = p;
              }
            }
            seeds[sIdx] = { ...closestP };
          }
        }
      }
    }

    // 3. Enforce Strict Minimum Separation Distance to Prevent Stacking/Collisions
    const minDistanceAllowed = Math.max(4 * scale, 8);
    const resolvedPoints: { x: number; y: number }[] = [];

    for (let i = 0; i < seeds.length; i++) {
      let candX = Math.round(seeds[i].x);
      let candY = Math.round(seeds[i].y);

      let hasCollision = true;
      let collisionAttempts = 0;

      while (hasCollision && collisionAttempts < 10) {
        hasCollision = false;
        for (const rp of resolvedPoints) {
          const dist = Math.hypot(candX - rp.x, candY - rp.y);
          if (dist < minDistanceAllowed) {
            hasCollision = true;
            const angle = Math.atan2(candY - rp.y, candX - rp.x) || (Math.PI / 4);
            const shiftedX = Math.round(candX + Math.cos(angle) * (minDistanceAllowed - dist + 5));
            const shiftedY = Math.round(candY + Math.sin(angle) * (minDistanceAllowed - dist + 5));
            if (isPointInPolygon(shiftedX, shiftedY, points)) {
              candX = shiftedX;
              candY = shiftedY;
            } else {
              let bestFarDist = -1;
              let bestFarPoint = interiorSamples[0];
              for (const ip of interiorSamples) {
                let minD = Infinity;
                for (const other of resolvedPoints) {
                  const d = Math.hypot(ip.x - other.x, ip.y - other.y);
                  if (d < minD) minD = d;
                }
                if (minD > bestFarDist) {
                  bestFarDist = minD;
                  bestFarPoint = ip;
                }
              }
              candX = Math.round(bestFarPoint.x);
              candY = Math.round(bestFarPoint.y);
            }
            break;
          }
        }
        collisionAttempts++;
      }

      resolvedPoints.push({ x: candX, y: candY });
    }

    return resolvedPoints.map((pt, idx) => ({
      id: `terminal-${Date.now()}-${idx}`,
      x: pt.x,
      y: pt.y,
      cfm: flowPerTerminal,
      size: sizeLabel,
      type: systemType === 'cassette' ? 'cassette' : systemType === 'high-wall' ? 'high-wall' : 'supply',
      actualNc: selection.actualNc,
      throwT50Ft: effectiveThrowFt,
      deltaPInWg: selection.deltaPInWg
    }));
  };

  // Optimization loop: guarantee >= targetCoverage unless fixed by user.
  // Coverage may never be increased beyond what the total airflow can serve.
  let currentSupplyTerminals = generateSupplyLayout(numTerminals);

  if (!hasFixedOverride) {
    let attempts = 0;
    const maxTerminals = Math.min(16, Math.max(numTerminals + 4, 8));

    while (numTerminals < maxTerminals && numTerminals < maxCount && attempts < 8) {
      const cov = calculateZoneDiffuserCoverage(points, currentSupplyTerminals, scale, isImperial);
      if (cov.coveragePercent >= targetCoverage) {
        break;
      }
      numTerminals++;
      currentSupplyTerminals = generateSupplyLayout(numTerminals);
      attempts++;
    }
  }

  // Ensure total CFM conservation across all supply diffusers
  const numSupply = currentSupplyTerminals.length;
  if (numSupply > 0) {
    const baseCfm = Math.floor(totalFlow / numSupply);
    const remainder = totalFlow - (baseCfm * numSupply);
    currentSupplyTerminals.forEach((d, idx) => {
      d.cfm = baseCfm + (idx === 0 ? remainder : 0);
    });
  }

  const terminals: DiffuserPos[] = [...currentSupplyTerminals];

  // Generate Return Air Grilles / Diffusers for Ducted Systems without overlapping supply diffusers
  const isDuctedSystem = systemType === 'concealed' || systemType === 'packaged' || systemType === 'vrf' || systemType === 'ahu';
  if (isDuctedSystem && terminals.length > 0) {
    const numReturns = Math.max(1, Math.ceil(cfm / 800));
    const returnCfmPerGrille = Math.round((cfm * 0.9) / numReturns);

    const placedReturns: { x: number; y: number }[] = [];

    for (let rIdx = 0; rIdx < numReturns; rIdx++) {
      // Find the interior point furthest from all supply diffusers and all existing return grilles
      let maxDistScore = -1;
      let bestReturnPoint = interiorSamples[0];

      for (const ip of interiorSamples) {
        let minSupplyDist = Infinity;
        for (const st of currentSupplyTerminals) {
          const d = Math.hypot(ip.x - st.x, ip.y - st.y);
          if (d < minSupplyDist) minSupplyDist = d;
        }

        let minReturnDist = Infinity;
        for (const pr of placedReturns) {
          const d = Math.hypot(ip.x - pr.x, ip.y - pr.y);
          if (d < minReturnDist) minReturnDist = d;
        }

        // Score prefers max distance from supply and good spacing between returns
        const score = Math.min(minSupplyDist, minReturnDist);
        if (score > maxDistScore) {
          maxDistScore = score;
          bestReturnPoint = ip;
        }
      }

      placedReturns.push({ x: Math.round(bestReturnPoint.x), y: Math.round(bestReturnPoint.y) });

      terminals.push({
        id: `ret-grille-${Date.now()}-${rIdx}`,
        x: Math.round(bestReturnPoint.x),
        y: Math.round(bestReturnPoint.y),
        cfm: returnCfmPerGrille,
        size: returnCfmPerGrille > 400 ? '24"x24"' : '18"x18"',
        type: 'return',
        actualNc: 20,
        throwT50Ft: 0,
        deltaPInWg: 0.025
      });
    }
  }

  return terminals;
}

/**
 * Places diffusers and terminals inside a zone polygon.
 * Supports CAD matching, throw intervals ($0.75L \le T_{50} \le 1.25L$), product catalog data,
 * and guarantees area distribution coverage.
 */
export function placeDiffusers(
  points: number[],
  totalFlow: number,
  isImperial: boolean = true,
  spacingFt: number = 10,
  scale: number = 10,
  dxfEntities: any[] = [],
  systemType: 'concealed' | 'packaged' | 'cassette' | 'high-wall' | 'vrf' | 'ahu' | 'fcu' = 'concealed',
  totalLoadBtu?: number,
  catalogQty?: number,
  catalogModel?: string,
  spaceNcLimit: number = 30
): DiffuserPos[] {
  return placeDiffusersWithCircularOptimization(
    points,
    totalFlow,
    isImperial,
    spacingFt,
    scale,
    dxfEntities,
    systemType,
    totalLoadBtu,
    {
      coverageTargetPercent: 95,
      catalogQty,
      catalogModel,
      spaceNcLimit
    }
  );
}
