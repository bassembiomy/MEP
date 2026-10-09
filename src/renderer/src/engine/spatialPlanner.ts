import { isPointInPolygon, getPolygonCentroid, calculateOptimalIndoorUnitPos, calculatePolygonArea } from './geometry';
import { sizeDuct } from './ductSizer';
import { selectBestDiffuserFromCatalog, placeDiffusersWithCircularOptimization } from './diffuserPlacer';
import { STANDARD_DIFFUSER_CATALOG } from './hvacCatalogs';
import {
  ConnectionPort,
  MechanicalComponent,
  SpatialFootprint,
  DeploymentDiagnostic
} from './deploymentTypes';
import { Diffuser, DuctSegment } from '../store/projectStore';
import { isPointInOrOnPolygon, isSegmentInPolygon } from './validation/spatialValidator';

/**
 * Validates that an entire rectangular component footprint is strictly inside a polygon
 */
export function validateFootprintInPolygon(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  points: number[]
): boolean {
  if (points.length < 6) return false;

  const hw = width / 2;
  const hh = height / 2;

  // Test 4 corners and center
  const corners = [
    { x: centerX, y: centerY },
    { x: centerX - hw, y: centerY - hh },
    { x: centerX + hw, y: centerY - hh },
    { x: centerX + hw, y: centerY + hh },
    { x: centerX - hw, y: centerY + hh }
  ];

  return corners.every((c) => isPointInPolygon(c.x, c.y, points));
}

/**
 * Calculates the bounding box of a polygon
 */
export function getPolygonBoundingBox(points: number[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const numPts = points.length / 2;
  for (let i = 0; i < numPts; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Scores and selects optimal outdoor unit (ODU) position on closest exterior envelope wall
 */
export function planOutdoorUnitPlacement(
  points: number[],
  allZones: any[],
  dxfBoundingBox: any,
  systemId: string,
  model: string,
  totalTons: number
): { component: MechanicalComponent; diagnostics: DeploymentDiagnostic[] } {
  const diagnostics: DeploymentDiagnostic[] = [];
  const centroid = getPolygonCentroid(points);

  let envMinX = Infinity, envMaxX = -Infinity, envMinY = Infinity, envMaxY = -Infinity;

  if (dxfBoundingBox) {
    envMinX = dxfBoundingBox.minX;
    envMaxX = dxfBoundingBox.maxX;
    envMinY = dxfBoundingBox.minY;
    envMaxY = dxfBoundingBox.maxY;
  } else if (allZones && allZones.length > 0) {
    allZones.forEach((z) => {
      const numPts = z.points.length / 2;
      for (let i = 0; i < numPts; i++) {
        const px = z.points[i * 2];
        const py = z.points[i * 2 + 1];
        if (px < envMinX) envMinX = px;
        if (px > envMaxX) envMaxX = px;
        if (py < envMinY) envMinY = py;
        if (py > envMaxY) envMaxY = py;
      }
    });
  } else {
    const bbox = getPolygonBoundingBox(points);
    envMinX = bbox.minX; envMaxX = bbox.maxX; envMinY = bbox.minY; envMaxY = bbox.maxY;
  }

  if (envMinX === Infinity) {
    envMinX = 0; envMaxX = 600; envMinY = 0; envMaxY = 400;
  }

  const distToLeft = Math.abs(centroid.x - envMinX);
  const distToRight = Math.abs(envMaxX - centroid.x);
  const distToTop = Math.abs(centroid.y - envMinY);
  const distToBottom = Math.abs(envMaxY - centroid.y);

  const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);
  const offset = 40; // 4 ft outside envelope
  const numPoints = points.length / 2;
  let posX = 0;
  let posY = 0;
  let dirX = 0;
  let dirY = 0;

  if (minDist === distToLeft) {
    let minX = Infinity;
    let targetY = centroid.y;
    for (let i = 0; i < numPoints; i++) {
      if (points[i * 2] < minX) {
        minX = points[i * 2];
        targetY = points[i * 2 + 1];
      }
    }
    posX = minX - offset;
    posY = targetY;
    dirX = 1; dirY = 0;
  } else if (minDist === distToRight) {
    let maxX = -Infinity;
    let targetY = centroid.y;
    for (let i = 0; i < numPoints; i++) {
      if (points[i * 2] > maxX) {
        maxX = points[i * 2];
        targetY = points[i * 2 + 1];
      }
    }
    posX = maxX + offset;
    posY = targetY;
    dirX = -1; dirY = 0;
  } else if (minDist === distToTop) {
    let minY = Infinity;
    let targetX = centroid.x;
    for (let i = 0; i < numPoints; i++) {
      if (points[i * 2 + 1] < minY) {
        minY = points[i * 2 + 1];
        targetX = points[i * 2];
      }
    }
    posX = targetX;
    posY = minY - offset;
    dirX = 0; dirY = 1;
  } else {
    let maxY = -Infinity;
    let targetX = centroid.x;
    for (let i = 0; i < numPoints; i++) {
      if (points[i * 2 + 1] > maxY) {
        maxY = points[i * 2 + 1];
        targetX = points[i * 2];
      }
    }
    posX = targetX;
    posY = maxY + offset;
    dirX = 0; dirY = -1;
  }

  const snappedX = Math.round(posX / 10) * 10;
  const snappedY = Math.round(posY / 10) * 10;

  const componentId = `comp-odu-${systemId}`;
  const ports: ConnectionPort[] = [
    {
      id: `port-${componentId}-ref-gas`,
      componentId,
      role: 'refrigerant-suction',
      position: { x: snappedX, y: snappedY },
      direction: { x: dirX, y: dirY },
      size: 0.625, // 5/8" suction line
      systemType: 'dx-refrigerant',
      isConnected: false
    },
    {
      id: `port-${componentId}-ref-liq`,
      componentId,
      role: 'refrigerant-liquid',
      position: { x: snappedX, y: snappedY },
      direction: { x: dirX, y: dirY },
      size: 0.375, // 3/8" liquid line
      systemType: 'dx-refrigerant',
      isConnected: false
    }
  ];

  const footprint: SpatialFootprint = {
    minX: snappedX - 16,
    maxX: snappedX + 16,
    minY: snappedY - 11,
    maxY: snappedY + 11,
    widthWorld: 32,
    heightWorld: 22
  };

  const component: MechanicalComponent = {
    id: componentId,
    systemId,
    floorId: 'floor-1',
    zoneId: '',
    role: 'outdoor-unit',
    model,
    systemType: 'outdoor-condenser',
    position: { x: snappedX, y: snappedY, z: 0 },
    rotationDeg: 0,
    elevationFt: 0,
    footprint,
    ports,
    isLocked: false,
    metadata: { totalTons }
  };

  return { component, diagnostics };
}

/**
 * Scores and places indoor unit (FCU / AHU) inside ceiling corridor zone
 */
/**
 * True when an axis-aligned w x h rectangle centred on (cx, cy) lies fully inside the polygon.
 * Uses the same predicates as deployment acceptance so placement and validation cannot disagree.
 */
export function isRectContainedInPolygon(cx: number, cy: number, w: number, h: number, points: number[]): boolean {
  const corners = [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 }
  ];
  return isPointInOrOnPolygon(cx, cy, points) &&
    corners.every((a, k) => isSegmentInPolygon(a, corners[(k + 1) % 4], points));
}

function placePhysicalFootprint(
  points: number[],
  target: { x: number; y: number },
  centroid: { x: number; y: number },
  fp: { width: number; depth: number }
): { x: number; y: number; rotationDeg: number; w: number; h: number } | null {
  const bbox = getPolygonBoundingBox(points);
  const preferLong = bbox.width >= bbox.height;
  const orientations = [
    { rotationDeg: 0, w: fp.width, h: fp.depth },
    { rotationDeg: 90, w: fp.depth, h: fp.width }
  ].sort((a, b) => Number(preferLong ? b.w >= b.h : b.h >= b.w) - Number(preferLong ? a.w >= a.h : a.h >= a.w));
  const margin = 5;
  let best: { x: number; y: number; rotationDeg: number; w: number; h: number } | null = null;
  let bestScore = Infinity;
  for (const o of orientations) {
    // Preferred centre: step inward from the far vertex by half the footprint plus a placement margin.
    const px = target.x + Math.sign(centroid.x - target.x) * (o.w / 2 + margin);
    const py = target.y + Math.sign(centroid.y - target.y) * (o.h / 2 + margin);
    const gx = (v: number) => (centroid.x > v ? Math.ceil(v / 10) * 10 : Math.floor(v / 10) * 10);
    const gy = (v: number) => (centroid.y > v ? Math.ceil(v / 10) * 10 : Math.floor(v / 10) * 10);
    const candidates = [{ x: gx(px), y: gy(py) }, { x: px, y: py }];
    for (let x = Math.ceil(bbox.minX / 10) * 10; x <= bbox.maxX; x += 10)
      for (let y = Math.ceil(bbox.minY / 10) * 10; y <= bbox.maxY; y += 10) candidates.push({ x, y });
    // Positions flush to the bounding box walls (with the footprint half-extent) catch tight fits.
    for (const x of [bbox.minX + o.w / 2, bbox.maxX - o.w / 2, (bbox.minX + bbox.maxX) / 2])
      for (const y of [bbox.minY + o.h / 2, bbox.maxY - o.h / 2, (bbox.minY + bbox.maxY) / 2]) candidates.push({ x, y });
    for (const c of candidates) {
      if (!isRectContainedInPolygon(c.x, c.y, o.w, o.h, points)) continue;
      const score = Math.hypot(c.x - px, c.y - py);
      if (score < bestScore - 1e-9) {
        bestScore = score;
        best = { ...c, rotationDeg: o.rotationDeg, w: o.w, h: o.h };
      }
      if (c === candidates[0] || c === candidates[1]) break;
    }
    if (best && bestScore === 0) break;
  }
  return best;
}

export function planIndoorUnitPlacement(
  points: number[],
  optOduPos: { x: number; y: number },
  systemId: string,
  zoneId: string,
  systemType: string,
  model: string,
  supplyCfm: number,
  physicalFootprint?: { width: number; depth: number }
): { component: MechanicalComponent | null; diagnostics: DeploymentDiagnostic[] } {
  const diagnostics: DeploymentDiagnostic[] = [];

  if (points.length < 6) {
    diagnostics.push({
      code: 'ERR_NO_VALID_EQUIPMENT_LOCATION',
      severity: 'error',
      message: 'Zone polygon does not have sufficient vertices to place indoor equipment.'
    });
    return { component: null, diagnostics };
  }

  const centroid = getPolygonCentroid(points);
  const numPoints = points.length / 2;

  // Find interior vertex furthest from outdoor unit
  let maxDist = -1;
  let targetX = points[0];
  let targetY = points[1];

  for (let i = 0; i < numPoints; i++) {
    const px = points[i * 2];
    const py = points[i * 2 + 1];
    const dist = Math.pow(px - optOduPos.x, 2) + Math.pow(py - optOduPos.y, 2);
    if (dist > maxDist) {
      maxDist = dist;
      targetX = px;
      targetY = py;
    }
  }

  let unitWidth = 44;
  let unitHeight = 22;
  let rotationOverride: number | undefined;
  let snappedX = 0;
  let snappedY = 0;

  if (physicalFootprint) {
    const placed = placePhysicalFootprint(points, { x: targetX, y: targetY }, centroid, physicalFootprint);
    if (!placed) {
      diagnostics.push({
        code: 'ERR_COMPONENT_OUTSIDE_ZONE',
        severity: 'error',
        message: `Indoor unit (${model}) footprint cannot fit inside zone boundaries.`,
        remediation: 'Expand room boundaries or select a smaller unit.'
      });
      return { component: null, diagnostics };
    }
    snappedX = placed.x;
    snappedY = placed.y;
    unitWidth = placed.w;
    unitHeight = placed.h;
    rotationOverride = placed.rotationDeg;
  } else {
  // Shift inside towards centroid
  const vx = centroid.x - targetX;
  const vy = centroid.y - targetY;
  const len = Math.sqrt(vx * vx + vy * vy) || 1;
  const offset = Math.min(30, len * 0.35);

  let optimalX = targetX + (vx / len) * offset;
  let optimalY = targetY + (vy / len) * offset;

  if (!validateFootprintInPolygon(optimalX, optimalY, unitWidth, unitHeight, points)) {
    optimalX = (targetX + centroid.x * 2) / 3;
    optimalY = (targetY + centroid.y * 2) / 3;

    if (!validateFootprintInPolygon(optimalX, optimalY, unitWidth * 0.8, unitHeight * 0.8, points)) {
      optimalX = centroid.x;
      optimalY = centroid.y;
    }
  }

  let isContained = isPointInPolygon(optimalX, optimalY, points);
  if (!isContained) {
    // Scan interior points inside bounding box to guarantee an interior position for L-shapes/concave polygons
    const bbox = getPolygonBoundingBox(points);
    const stepX = (bbox.width || 100) / 20;
    const stepY = (bbox.height || 100) / 20;
    for (let ix = 1; ix < 20; ix++) {
      const px = bbox.minX + ix * stepX;
      for (let iy = 1; iy < 20; iy++) {
        const py = bbox.minY + iy * stepY;
        if (isPointInPolygon(px, py, points)) {
          optimalX = px;
          optimalY = py;
          isContained = true;
          break;
        }
      }
      if (isContained) break;
    }
  }

  if (!isContained) {
    diagnostics.push({
      code: 'ERR_COMPONENT_OUTSIDE_ZONE',
      severity: 'error',
      message: `Indoor unit (${model}) could not be placed fully inside zone boundaries.`,
      remediation: 'Expand room boundaries or adjust locked unit location.'
    });
    return { component: null, diagnostics };
  }


  snappedX = Math.round(optimalX / 10) * 10;
  snappedY = Math.round(optimalY / 10) * 10;
  }
  const componentId = `comp-iu-${zoneId}`;

  // Outlet points towards centroid for direct trunk take-off
  const dirX = (centroid.x - snappedX) / (Math.hypot(centroid.x - snappedX, centroid.y - snappedY) || 1);
  const dirY = (centroid.y - snappedY) / (Math.hypot(centroid.x - snappedX, centroid.y - snappedY) || 1);

  const ports: ConnectionPort[] = [
    {
      id: `port-${componentId}-sup-out`,
      componentId,
      role: 'supply-air-outlet',
      position: { x: snappedX + dirX * 22, y: snappedY + dirY * 22 },
      direction: { x: dirX, y: dirY },
      size: { width: 16, height: 10 },
      systemType: 'air-supply',
      isConnected: false
    },
    {
      id: `port-${componentId}-ret-in`,
      componentId,
      role: 'return-air-inlet',
      position: { x: snappedX - dirX * 22, y: snappedY - dirY * 22 },
      direction: { x: -dirX, y: -dirY },
      size: { width: 18, height: 10 },
      systemType: 'air-return',
      isConnected: false
    },
    {
      id: `port-${componentId}-ref-in`,
      componentId,
      role: 'refrigerant-suction',
      position: { x: snappedX, y: snappedY },
      direction: { x: -dirX, y: -dirY },
      size: 0.625,
      systemType: 'dx-refrigerant',
      isConnected: false
    },
    {
      id: `port-${componentId}-drain`,
      componentId,
      role: 'condensate-drain-out',
      position: { x: snappedX, y: snappedY + 11 },
      direction: { x: 0, y: 1 },
      size: 0.75, // 3/4" PVC drain
      systemType: 'condensate-drain',
      isConnected: false
    }
  ];

  const footprint: SpatialFootprint = {
    minX: snappedX - unitWidth / 2,
    maxX: snappedX + unitWidth / 2,
    minY: snappedY - unitHeight / 2,
    maxY: snappedY + unitHeight / 2,
    widthWorld: unitWidth,
    heightWorld: unitHeight
  };

  const component: MechanicalComponent = {
    id: componentId,
    systemId,
    floorId: 'floor-1',
    zoneId,
    role: systemType === 'high-wall' ? 'wall-indoor-unit' : 'indoor-unit',
    model,
    systemType,
    position: { x: snappedX, y: snappedY, z: 9 },
    rotationDeg: rotationOverride ?? Math.round(Math.atan2(dirY, dirX) * (180 / Math.PI)),
    elevationFt: 9,
    footprint,
    ports,
    isLocked: false,
    metadata: { supplyCfm }
  };

  return { component, diagnostics };
}

type Rect = { minX: number; maxX: number; minY: number; maxY: number };
const rectsOverlap = (a: Rect, b: Rect) =>
  a.minX < b.maxX - 1e-9 && b.minX < a.maxX - 1e-9 && a.minY < b.maxY - 1e-9 && b.minY < a.maxY - 1e-9;
const rectAt = (x: number, y: number, w: number, h: number): Rect => ({ minX: x - w / 2, maxX: x + w / 2, minY: y - h / 2, maxY: y + h / 2 });

/** Same predicate as deployment acceptance (see isRectContainedInPolygon). */
const containedWithTolerance = isRectContainedInPolygon;

/**
 * Deterministic cassette layout: the polygon is cut into `quantity` equal-area cells along its long
 * axis, and in each cell the contained, non-overlapping footprint position nearest the cell centroid
 * is chosen. Returns null when the footprints cannot all be placed.
 */
export function placeContainedFootprints(
  points: number[],
  quantity: number,
  w: number,
  h: number
): { x: number; y: number }[] | null {
  const bbox = getPolygonBoundingBox(points);
  const step = Math.max(2.5, Math.max(bbox.width, bbox.height) / 80);
  const samples: { x: number; y: number }[] = [];
  for (let x = bbox.minX + step / 2; x < bbox.maxX; x += step)
    for (let y = bbox.minY + step / 2; y < bbox.maxY; y += step)
      if (isPointInPolygon(x, y, points)) samples.push({ x, y });
  if (samples.length < quantity) return null;
  const alongX = bbox.width >= bbox.height;
  samples.sort((p, q) => (alongX ? p.x - q.x || p.y - q.y : p.y - q.y || p.x - q.x));

  // Valid footprint centres (candidates), on a grid plus positions flush to the bounding box walls.
  const candidates: { x: number; y: number }[] = [];
  const cs = Math.max(2.5, Math.max(bbox.width, bbox.height) / 120);
  for (let x = bbox.minX + w / 2; x <= bbox.maxX - w / 2 + 1e-9; x += cs)
    for (let y = bbox.minY + h / 2; y <= bbox.maxY - h / 2 + 1e-9; y += cs)
      if (containedWithTolerance(x, y, w, h, points)) candidates.push({ x, y });
  if (candidates.length < quantity) return null;

  const chosen: { x: number; y: number }[] = [];
  for (let k = 0; k < quantity; k++) {
    const cell = samples.slice(Math.floor((k * samples.length) / quantity), Math.floor(((k + 1) * samples.length) / quantity));
    const cx = cell.reduce((s, p) => s + p.x, 0) / cell.length;
    const cy = cell.reduce((s, p) => s + p.y, 0) / cell.length;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const c of candidates) {
      const r = rectAt(c.x, c.y, w, h);
      if (chosen.some((o) => rectsOverlap(r, rectAt(o.x, o.y, w, h)))) continue;
      const d = Math.hypot(c.x - cx, c.y - cy);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best) {
      // Equal-area cells can leave no room for a later footprint; fall back to greedy farthest-point packing.
      return greedyPack(candidates, quantity, w, h);
    }
    chosen.push(best);
  }
  return chosen;
}

function greedyPack(candidates: { x: number; y: number }[], quantity: number, w: number, h: number) {
  const chosen: { x: number; y: number }[] = [candidates[Math.floor(candidates.length / 2)]];
  while (chosen.length < quantity) {
    let best: { x: number; y: number } | null = null;
    let bestScore = -1;
    for (const c of candidates) {
      const r = rectAt(c.x, c.y, w, h);
      if (chosen.some((o) => rectsOverlap(r, rectAt(o.x, o.y, w, h)))) continue;
      const score = Math.min(...chosen.map((o) => Math.hypot(c.x - o.x, c.y - o.y)));
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) return null;
    chosen.push(best);
  }
  return chosen;
}

/**
 * Distributes exactly `quantity` cassette units across the room ceiling. The requested count is
 * authoritative: if the optimiser cannot supply that many contained, non-overlapping footprints a
 * deterministic placement is used, and if that fails too an ERR_COMPONENT_OUTSIDE_ZONE error is
 * reported instead of silently returning fewer units.
 */
export function planCassetteDistribution(
  points: number[],
  quantity: number,
  totalCfm: number,
  systemId: string,
  zoneId: string,
  model: string,
  spaceNcLimit: number = 32,
  physicalFootprint?: { width: number; depth: number }
): { components: MechanicalComponent[]; diffusers: Diffuser[]; diagnostics: DeploymentDiagnostic[] } {
  const diagnostics: DeploymentDiagnostic[] = [];
  const flowPerUnit = totalCfm / Math.max(1, quantity);
  const components: MechanicalComponent[] = [];
  const diffusers: Diffuser[] = [];
  const fw = physicalFootprint?.width ?? 30;
  const fh = physicalFootprint?.depth ?? 30;

  const areaPx = calculatePolygonArea(points);
  const areaSqFt = Math.max(50, areaPx / 100);

  const optimized = placeDiffusersWithCircularOptimization(
    points,
    totalCfm,
    true,
    10,
    10,
    [],
    'cassette',
    areaSqFt,
    {
      coverageTargetPercent: 95,
      pattern: 'hexagonal',
      diffuserCountOverride: quantity,
      spaceNcLimit
    }
  ).filter((d) => d.type !== 'return');

  // Grid-snap only where snapping keeps the whole footprint inside the zone.
  let positions = optimized.map((p) => {
    const snapped = { x: Math.round(p.x / 10) * 10, y: Math.round(p.y / 10) * 10 };
    if (containedWithTolerance(snapped.x, snapped.y, fw, fh, points)) return snapped;
    return { x: Math.round(p.x), y: Math.round(p.y) };
  });
  const layoutOk = (ps: { x: number; y: number }[]) =>
    ps.length === quantity &&
    ps.every((p) => containedWithTolerance(p.x, p.y, fw, fh, points)) &&
    ps.every((p, i) => ps.every((q, j) => j <= i || !rectsOverlap(rectAt(p.x, p.y, fw, fh), rectAt(q.x, q.y, fw, fh))));
  let sources: { actualNc?: number; throwT50Ft?: number; deltaPInWg?: number }[] = optimized;
  if (!layoutOk(positions)) {
    const fallback = placeContainedFootprints(points, quantity, fw, fh);
    if (!fallback || !layoutOk(fallback)) {
      diagnostics.push({
        code: 'ERR_COMPONENT_OUTSIDE_ZONE',
        severity: 'error',
        message: `Cannot place ${quantity} cassette footprint(s) of ${(fw / 10).toFixed(2)} x ${(fh / 10).toFixed(2)} ft fully inside the zone without overlap.`,
        remediation: 'Reduce the cassette quantity, choose a smaller cassette, or enlarge the room.'
      });
      return { components, diffusers, diagnostics };
    }
    positions = fallback;
    sources = [];
  }

  positions.forEach((pos, idx) => {
    const p = sources[idx] ?? {};
    const componentId = `comp-cassette-${zoneId}-${idx}`;
    const ports: ConnectionPort[] = [
      {
        id: `port-${componentId}-ref-gas`,
        componentId,
        role: 'refrigerant-suction',
        position: { x: pos.x, y: pos.y },
        direction: { x: 0, y: -1 },
        size: 0.625,
        systemType: 'dx-refrigerant',
        isConnected: false
      },
      {
        id: `port-${componentId}-drain`,
        componentId,
        role: 'condensate-drain-out',
        position: { x: pos.x, y: pos.y + Math.min(15, fh / 2) },
        direction: { x: 0, y: 1 },
        size: 0.75,
        systemType: 'condensate-drain',
        isConnected: false
      }
    ];

    components.push({
      id: componentId,
      systemId,
      floorId: 'floor-1',
      zoneId,
      role: 'cassette-terminal',
      model,
      systemType: 'cassette',
      position: { x: pos.x, y: pos.y, z: 10 },
      rotationDeg: 0,
      elevationFt: 10,
      footprint: { minX: pos.x - fw / 2, maxX: pos.x + fw / 2, minY: pos.y - fh / 2, maxY: pos.y + fh / 2, widthWorld: fw, heightWorld: fh },
      ports,
      isLocked: false,
      metadata: { cfm: flowPerUnit, nc: spaceNcLimit }
    });

    diffusers.push({
      id: `dif-${componentId}`,
      x: pos.x,
      y: pos.y,
      cfm: flowPerUnit,
      size: model,
      type: 'cassette',
      actualNc: p.actualNc || spaceNcLimit,
      throwT50Ft: p.throwT50Ft || 14,
      deltaPInWg: p.deltaPInWg || 0.04
    });
  });

  return { components, diffusers, diagnostics };
}

/**
 * Plans diffusers and routes ducted supply & return networks with port-to-port connections
 */
export function planDuctedAirDistribution(
  points: number[],
  indoorUnitComp: MechanicalComponent | null | undefined,
  totalCfm: number,
  _systemId: string,
  zoneId: string,
  systemType: string,
  spaceNcLimit: number = 32,
  units: 'imperial' | 'metric' = 'imperial',
  _scale: number = 10,
  candidateDiffusers?: {
    quantity: number;
    flowPerDiffuser?: number;
    diffuserRecord: any;
    actualNc: number;
    throwT50Ft: number;
    deltaPInWg: number;
  }
): { diffusers: Diffuser[]; ducts: DuctSegment[]; diagnostics: DeploymentDiagnostic[] } {
  const diagnostics: DeploymentDiagnostic[] = [];
  const numDiffusers = candidateDiffusers?.quantity || Math.max(1, Math.ceil(totalCfm / 335));
  const flowPerDiffuser = candidateDiffusers?.flowPerDiffuser || totalCfm / numDiffusers;

  // Distribute diffusers symmetrically on an orthogonal grid aligned with room bounds
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
  const roomW = maxX - minX;
  const roomH = maxY - minY;

  const diffuserSelection = candidateDiffusers
    ? {
        diffuser: candidateDiffusers.diffuserRecord,
        actualNc: candidateDiffusers.actualNc,
        throwT50Ft: candidateDiffusers.throwT50Ft,
        deltaPInWg: candidateDiffusers.deltaPInWg
      }
    : selectBestDiffuserFromCatalog(
        flowPerDiffuser,
        spaceNcLimit,
        STANDARD_DIFFUSER_CATALOG,
        Math.max(6, Math.min(30, 0.9 * Math.sqrt(Math.max(20, (roomW * roomH) / numDiffusers / ((_scale || 10) * (_scale || 10))))))
      );

  // Determine grid topology: 2 rows for balanced symmetric top/bottom branch takeoffs
  const isHorizontal = roomW >= roomH;
  let rows = 2;
  let cols = Math.max(1, Math.ceil(numDiffusers / 2));
  if (numDiffusers === 1) {
    rows = 1;
    cols = 1;
  }

  const colW = roomW / cols;
  const rowH = roomH / rows;
  const unitPos = indoorUnitComp ? indoorUnitComp.position : calculateOptimalIndoorUnitPos(points);
  const trunkY = Math.round(minY + roomH / 2);
  const trunkX = Math.round(minX + roomW / 2);

  const diffusers: Diffuser[] = [];
  let pCount = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (pCount >= numDiffusers) break;

      const gx = Math.round(minX + (c + 0.5) * colW);
      const gy = Math.round(minY + (r + 0.5) * rowH);

      diffusers.push({
        id: `dif-${zoneId}-${pCount}`,
        x: gx,
        y: gy,
        cfm: flowPerDiffuser,
        size: `${diffuserSelection.diffuser.faceSizeIn.width}"x${diffuserSelection.diffuser.faceSizeIn.height}"`,
        type: 'supply',
        actualNc: diffuserSelection.actualNc,
        throwT50Ft: diffuserSelection.throwT50Ft,
        deltaPInWg: diffuserSelection.deltaPInWg
      });
      pCount++;
    }
  }

  const supplyDiffusers = diffusers.filter((d) => d.type === 'supply');
  const ducts: DuctSegment[] = [];
  const fixedHeight = units === 'imperial' ? 10 : 8;

  // 1. Orthogonal Main Trunk Line
  if (isHorizontal) {
    // If unit is offset from central trunk Y-axis, add direct vertical takeoff duct from indoor unit
    if (Math.abs(unitPos.y - trunkY) > 1e-6) {
      const feederSize = sizeDuct(totalCfm, 0.10, fixedHeight);
      const feederVel = Math.round(totalCfm / Math.max(0.1, (feederSize.widthIn * feederSize.heightIn) / 144));
      ducts.push({
        id: `duct-feeder-${zoneId}`,
        type: 'trunk',
        points: [unitPos.x, unitPos.y, unitPos.x, trunkY],
        widthIn: feederSize.widthIn,
        heightIn: feederSize.heightIn,
        cfm: totalCfm,
        velocityFpm: feederVel,
        sizeLabel: `${feederSize.widthIn}"x${feederSize.heightIn}"`
      });
    }

    // Unique column X-coordinates sorted from unit outwards
    const colXList = Array.from(new Set(supplyDiffusers.map((d) => d.x)));
    // If unit is on right, sort descending; if on left, sort ascending
    if (unitPos.x > minX + roomW / 2) {
      colXList.sort((a, b) => b - a);
    } else {
      colXList.sort((a, b) => a - b);
    }

    let currentTrunkStart = { x: unitPos.x, y: trunkY };

    colXList.forEach((colX, idx) => {
      const segmentEnd = { x: colX, y: trunkY };
      // Calculate downstream flow
      const remainingCols = colXList.slice(idx);
      const downstreamDiffusers = supplyDiffusers.filter((d) => remainingCols.includes(d.x));
      const downstreamFlow = downstreamDiffusers.reduce((sum, d) => sum + d.cfm, 0);

      const size = sizeDuct(downstreamFlow, 0.10, fixedHeight);
      const velocityFpm = Math.round(downstreamFlow / Math.max(0.1, (size.widthIn * size.heightIn) / 144));

      ducts.push({
        id: `duct-trunk-${zoneId}-${idx}`,
        type: 'trunk',
        points: [currentTrunkStart.x, currentTrunkStart.y, segmentEnd.x, segmentEnd.y],
        widthIn: size.widthIn,
        heightIn: size.heightIn,
        cfm: downstreamFlow,
        velocityFpm,
        sizeLabel: `${size.widthIn}"x${size.heightIn}"`
      });

      currentTrunkStart = segmentEnd;
    });

    // 2. Perpendicular Branch Runouts
    supplyDiffusers.forEach((dif, idx) => {
      const branchStart = { x: dif.x, y: trunkY };
      const branchEnd = { x: dif.x, y: dif.y };
      const branchDist = Math.abs(branchEnd.y - branchStart.y);

      if (branchDist > 5) {
        const size = sizeDuct(dif.cfm, 0.10, fixedHeight);
        const velocityFpm = Math.round(dif.cfm / Math.max(0.1, (size.widthIn * size.heightIn) / 144));

        ducts.push({
          id: `duct-branch-${zoneId}-${idx}`,
          type: 'branch',
          points: [branchStart.x, branchStart.y, branchEnd.x, branchEnd.y],
          widthIn: size.widthIn,
          heightIn: size.heightIn,
          cfm: dif.cfm,
          velocityFpm,
          sizeLabel: `${size.widthIn}"x${size.heightIn}"`
        });
      }
    });
  } else {
    // If unit is offset from central trunk X-axis, add direct horizontal takeoff duct from indoor unit
    if (Math.abs(unitPos.x - trunkX) > 1e-6) {
      const feederSize = sizeDuct(totalCfm, 0.10, fixedHeight);
      const feederVel = Math.round(totalCfm / Math.max(0.1, (feederSize.widthIn * feederSize.heightIn) / 144));
      ducts.push({
        id: `duct-feeder-${zoneId}`,
        type: 'trunk',
        points: [unitPos.x, unitPos.y, trunkX, unitPos.y],
        widthIn: feederSize.widthIn,
        heightIn: feederSize.heightIn,
        cfm: totalCfm,
        velocityFpm: feederVel,
        sizeLabel: `${feederSize.widthIn}"x${feederSize.heightIn}"`
      });
    }

    // Vertical Trunk
    const rowYList = Array.from(new Set(supplyDiffusers.map((d) => d.y)));
    if (unitPos.y > minY + roomH / 2) {
      rowYList.sort((a, b) => b - a);
    } else {
      rowYList.sort((a, b) => a - b);
    }

    let currentTrunkStart = { x: trunkX, y: unitPos.y };

    rowYList.forEach((rowY, idx) => {
      const segmentEnd = { x: trunkX, y: rowY };
      const remainingRows = rowYList.slice(idx);
      const downstreamDiffusers = supplyDiffusers.filter((d) => remainingRows.includes(d.y));
      const downstreamFlow = downstreamDiffusers.reduce((sum, d) => sum + d.cfm, 0);

      const size = sizeDuct(downstreamFlow, 0.10, fixedHeight);
      const velocityFpm = Math.round(downstreamFlow / Math.max(0.1, (size.widthIn * size.heightIn) / 144));

      ducts.push({
        id: `duct-trunk-${zoneId}-${idx}`,
        type: 'trunk',
        points: [currentTrunkStart.x, currentTrunkStart.y, segmentEnd.x, segmentEnd.y],
        widthIn: size.widthIn,
        heightIn: size.heightIn,
        cfm: downstreamFlow,
        velocityFpm,
        sizeLabel: `${size.widthIn}"x${size.heightIn}"`
      });

      currentTrunkStart = segmentEnd;
    });

    supplyDiffusers.forEach((dif, idx) => {
      const branchStart = { x: trunkX, y: dif.y };
      const branchEnd = { x: dif.x, y: dif.y };
      const branchDist = Math.abs(branchEnd.x - branchStart.x);

      if (branchDist > 5) {
        const size = sizeDuct(dif.cfm, 0.10, fixedHeight);
        const velocityFpm = Math.round(dif.cfm / Math.max(0.1, (size.widthIn * size.heightIn) / 144));

        ducts.push({
          id: `duct-branch-${zoneId}-${idx}`,
          type: 'branch',
          points: [branchStart.x, branchStart.y, branchEnd.x, branchEnd.y],
          widthIn: size.widthIn,
          heightIn: size.heightIn,
          cfm: dif.cfm,
          velocityFpm,
          sizeLabel: `${size.widthIn}"x${size.heightIn}"`
        });
      }
    });
  }

  // 3. Dedicated Return Duct & Return Grille for all ducted systems
  const isDuctedSystem = systemType === 'concealed' || systemType === 'packaged' || systemType === 'ahu' || systemType === 'vrf' || systemType === 'fcu';
  if (isDuctedSystem) {
    const returnFlow = Math.round(totalCfm * 0.9);
    const returnSize = sizeDuct(returnFlow, 0.08, fixedHeight);
    const retOffset = Math.min(roomW * 0.15, _scale > 50 ? _scale * 2 : 50);

    const retStartX = unitPos.x;
    const retStartY = unitPos.y;

    const primaryEnd = {
      x: isHorizontal
        ? (unitPos.x > minX + roomW / 2 ? unitPos.x - retOffset : unitPos.x + retOffset)
        : unitPos.x,
      y: isHorizontal
        ? unitPos.y + (unitPos.y > minY + roomH / 2 ? -retOffset * 0.5 : retOffset * 0.5)
        : (unitPos.y > minY + roomH / 2 ? unitPos.y - retOffset : unitPos.y + retOffset)
    };
    // The bounding-box heuristic ignores concave outlines, so verify the grille and its run stay
    // inside the zone and otherwise fall back to alternative directions, then toward the centroid.
    const zoneCentroid = getPolygonCentroid(points);
    const cdx = zoneCentroid.x - unitPos.x;
    const cdy = zoneCentroid.y - unitPos.y;
    const clen = Math.hypot(cdx, cdy) || 1;
    const returnEndCandidates = [
      primaryEnd,
      { x: primaryEnd.x, y: 2 * unitPos.y - primaryEnd.y },
      { x: 2 * unitPos.x - primaryEnd.x, y: primaryEnd.y },
      { x: 2 * unitPos.x - primaryEnd.x, y: 2 * unitPos.y - primaryEnd.y },
      ...[1, 0.75, 0.5, 0.25].map((f) => ({
        x: unitPos.x + (cdx / clen) * Math.min(retOffset, clen) * f,
        y: unitPos.y + (cdy / clen) * Math.min(retOffset, clen) * f
      }))
    ];
    const foundReturnEnd = returnEndCandidates.find(
      (c) => isPointInOrOnPolygon(c.x, c.y, points) && isSegmentInPolygon({ x: unitPos.x, y: unitPos.y }, c, points)
    );
    if (!foundReturnEnd) {
      diagnostics.push({
        code: 'ERR_COMPONENT_OUTSIDE_ZONE',
        severity: 'error',
        message: 'No return grille location inside the zone could be connected to the indoor unit.',
        remediation: 'Adjust the room boundary or indoor unit location.'
      });
    }
    const retEnd = foundReturnEnd ?? primaryEnd;
    const retEndX = retEnd.x;
    const retEndY = retEnd.y;

    // Return Grille Terminal
    diffusers.push({
      id: `rg-${zoneId}-0`,
      x: Math.round(retEndX),
      y: Math.round(retEndY),
      cfm: returnFlow,
      size: `${returnSize.widthIn}"x${returnSize.heightIn}"`,
      type: 'return',
      actualNc: spaceNcLimit,
      throwT50Ft: 0,
      deltaPInWg: 0.04
    });

    // Return Duct
    ducts.push({
      id: `duct-return-${zoneId}`,
      type: 'return',
      points: [retStartX, retStartY, Math.round(retEndX), Math.round(retEndY)],
      widthIn: returnSize.widthIn,
      heightIn: returnSize.heightIn,
      cfm: returnFlow,
      velocityFpm: Math.round(returnFlow / Math.max(0.1, (returnSize.widthIn * returnSize.heightIn) / 144)),
      sizeLabel: `${returnSize.widthIn}"x${returnSize.heightIn}" (R)`
    });
  }

  return { diffusers, ducts, diagnostics };
}

/**
 * Routes clean orthogonal (Manhattan / 90° bends) solid copper refrigerant piping
 * from Outdoor Unit (ODU) on building exterior into the room and branches to each indoor unit / cassette.
 */
export function routeOrthogonalRefrigerantPiping(
  oduPos: { x: number; y: number },
  indoorTargets: { x: number; y: number }[]
): { segments: number[][]; isolatorPos: { x: number; y: number } } {
  if (!indoorTargets || indoorTargets.length === 0) {
    return { segments: [], isolatorPos: oduPos };
  }

  const segments: number[][] = [];

  // If single indoor target: 2-segment orthogonal L-route
  if (indoorTargets.length === 1) {
    const target = indoorTargets[0];
    // Route vertically first then horizontally into the room
    const midX = oduPos.x;
    const midY = target.y;

    if (Math.hypot(oduPos.x - midX, oduPos.y - midY) > 2) {
      segments.push([oduPos.x, oduPos.y, midX, midY]);
    }
    if (Math.hypot(midX - target.x, midY - target.y) > 2) {
      segments.push([midX, midY, target.x, target.y]);
    }

    const isolatorPos = { x: (oduPos.x + midX) / 2, y: (oduPos.y + midY) / 2 };
    return { segments, isolatorPos };
  }

  // Multiple indoor targets (e.g. multi-cassette or multi-split)
  const sorted = [...indoorTargets].sort((a, b) => {
    const da = Math.hypot(a.x - oduPos.x, a.y - oduPos.y);
    const db = Math.hypot(b.x - oduPos.x, b.y - oduPos.y);
    return da - db;
  });

  const firstTarget = sorted[0];
  const lastTarget = sorted[sorted.length - 1];

  const penX = oduPos.x;
  const penY = firstTarget.y;

  // Main route from ODU to room entry
  segments.push([oduPos.x, oduPos.y, penX, penY]);

  // Main distribution header connecting the target span
  const headerY = penY;
  segments.push([penX, headerY, lastTarget.x, headerY]);

  // Perpendicular branch runouts to each individual cassette / indoor unit
  sorted.forEach((t) => {
    if (Math.abs(t.y - headerY) > 4) {
      segments.push([t.x, headerY, t.x, t.y]);
    }
  });

  const isolatorPos = { x: (oduPos.x + penX) / 2, y: (oduPos.y + penY) / 2 };
  return { segments, isolatorPos };
}
