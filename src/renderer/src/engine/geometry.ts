import type { Zone, BoundingBox } from '../store/projectStore';
import {
  Rect,
  pointInRect,
  DEFAULT_ODU_LENGTH_IN,
  DEFAULT_ODU_DEPTH_IN,
  ODU_MIN_SPACING_FT
} from './ducts/clearance';
// Helper geometry functions for polyline/polygon zones and diffuser/duct routing
//
// COORDINATE CONVENTION: canvas/engine Y grows DOWN. "north" = minY (top of the
// drawing), "south" = maxY, "east" = maxX, "west" = minX.
//
// UNITS: engine code works in feet (unitPerFt = 1). Canvas callers working in
// pixels pass the project scale (px per ft) as `unitPerFt`; every clearance is
// expressed in feet and multiplied by unitPerFt.

// Calculate polygon area in square units using Shoelace Formula
export function calculatePolygonArea(points: number[]): number {
  if (points.length < 6) return 0; // Needs at least 3 points (6 values)
  
  let area = 0;
  const numPoints = points.length / 2;
  
  for (let i = 0; i < numPoints; i++) {
    const x1 = points[2 * i];
    const y1 = points[2 * i + 1];
    
    // Wrap around to first point
    const nextIndex = (i + 1) % numPoints;
    const x2 = points[2 * nextIndex];
    const y2 = points[2 * nextIndex + 1];
    
    area += x1 * y2 - x2 * y1;
  }
  
  return Math.abs(area / 2);
}

// Calculate polygon perimeter in units
export function calculatePolygonPerimeter(points: number[]): number {
  if (points.length < 4) return 0;
  
  let perimeter = 0;
  const numPoints = points.length / 2;
  
  for (let i = 0; i < numPoints; i++) {
    const x1 = points[2 * i];
    const y1 = points[2 * i + 1];
    
    const nextIndex = (i + 1) % numPoints;
    const x2 = points[2 * nextIndex];
    const y2 = points[2 * nextIndex + 1];
    
    const dx = x2 - x1;
    const dy = y2 - y1;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  
  return perimeter;
}

// Check if point (x, y) is inside polygon
export function isPointInPolygon(x: number, y: number, points: number[]): boolean {
  if (points.length < 6) return false;
  
  let inside = false;
  const numPoints = points.length / 2;
  
  for (let i = 0, j = numPoints - 1; i < numPoints; j = i++) {
    const xi = points[2 * i];
    const yi = points[2 * i + 1];
    const xj = points[2 * j];
    const yj = points[2 * j + 1];
    
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    
    if (intersect) inside = !inside;
  }
  
  return inside;
}

// Calculate the horizontal interior span [minX, maxX] of a polygon at a specific Y coordinate
export function getPolygonScanlineSpan(y: number, points: number[]): { minX: number; maxX: number } | null {
  if (points.length < 6) return null;
  const numPoints = points.length / 2;
  const intersections: number[] = [];

  for (let i = 0, j = numPoints - 1; i < numPoints; j = i++) {
    const x1 = points[2 * j];
    const y1 = points[2 * j + 1];
    const x2 = points[2 * i];
    const y2 = points[2 * i + 1];

    if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
      const t = (y - y1) / (y2 - y1);
      intersections.push(x1 + t * (x2 - x1));
    }
  }

  if (intersections.length < 2) return null;
  intersections.sort((a, b) => a - b);
  return { minX: intersections[0], maxX: intersections[intersections.length - 1] };
}

// Calculate the vertical interior span [minY, maxY] of a polygon at a specific X coordinate
export function getPolygonVerticalSpan(x: number, points: number[]): { minY: number; maxY: number } | null {
  if (points.length < 6) return null;
  const numPoints = points.length / 2;
  const intersections: number[] = [];

  for (let i = 0, j = numPoints - 1; i < numPoints; j = i++) {
    const x1 = points[2 * j];
    const y1 = points[2 * j + 1];
    const x2 = points[2 * i];
    const y2 = points[2 * i + 1];

    if ((x1 <= x && x2 > x) || (x2 <= x && x1 > x)) {
      const t = (x - x1) / (x2 - x1);
      intersections.push(y1 + t * (y2 - y1));
    }
  }

  if (intersections.length < 2) return null;
  intersections.sort((a, b) => a - b);
  return { minY: intersections[0], maxY: intersections[intersections.length - 1] };
}

// Clamp any coordinate (x, y) so that it is strictly inside polygon with a safety margin
export function clampPointInsidePolygon(
  x: number,
  y: number,
  points: number[],
  margin: number = 1.5
): { x: number; y: number } {
  if (isPointInPolygon(x, y, points)) {
    const span = getPolygonScanlineSpan(y, points);
    if (span && span.maxX - span.minX > margin * 2) {
      const clampedX = Math.max(span.minX + margin, Math.min(span.maxX - margin, x));
      return { x: clampedX, y };
    }
    return { x, y };
  }

  const span = getPolygonScanlineSpan(y, points);
  if (span && span.maxX - span.minX > margin * 2) {
    const clampedX = Math.max(span.minX + margin, Math.min(span.maxX - margin, x));
    return { x: clampedX, y };
  }

  const c = getPolygonCentroid(points);
  for (let step = 0.1; step <= 1.0; step += 0.1) {
    const testX = x + (c.x - x) * step;
    const testY = y + (c.y - y) * step;
    if (isPointInPolygon(testX, testY, points)) {
      return { x: testX, y: testY };
    }
  }

  return { x: c.x, y: c.y };
}

// Get the centroid of a polygon (useful for duct/equipment routing or labelling)
export function getPolygonCentroid(points: number[]): { x: number; y: number } {
  if (points.length < 6) return { x: 0, y: 0 };
  
  let cx = 0;
  let cy = 0;
  let areaSum = 0;
  const numPoints = points.length / 2;
  
  for (let i = 0; i < numPoints; i++) {
    const x1 = points[2 * i];
    const y1 = points[2 * i + 1];
    
    const nextIndex = (i + 1) % numPoints;
    const x2 = points[2 * nextIndex];
    const y2 = points[2 * nextIndex + 1];
    
    const factor = (x1 * y2 - x2 * y1);
    cx += (x1 + x2) * factor;
    cy += (y1 + y2) * factor;
    areaSum += factor;
  }
  
  const area = areaSum / 2;
  if (Math.abs(area) < 0.0001) {
    // Fallback to bounding box center if area is 0
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < numPoints; i++) {
      const x = points[2 * i];
      const y = points[2 * i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }
  
  return {
    x: cx / (6 * area),
    y: cy / (6 * area)
  };
}

// Generate points on a grid within a polygon boundary (diffuser layout)
export function getGridPointsInPolygon(points: number[], spacing: number): { x: number; y: number }[] {
  if (points.length < 6) return [];
  
  // Find bounding box
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
  
  const gridPoints: { x: number; y: number }[] = [];
  
  // Grid alignment
  const startX = Math.ceil(minX / spacing) * spacing;
  const startY = Math.ceil(minY / spacing) * spacing;
  
  for (let gx = startX; gx < maxX; gx += spacing) {
    for (let gy = startY; gy < maxY; gy += spacing) {
      if (isPointInPolygon(gx, gy, points)) {
        gridPoints.push({ x: gx, y: gy });
      }
    }
  }
  
  return gridPoints;
}

// Snap coordinates to custom grid interval
export function snapToGrid(value: number, interval: number): number {
  return Math.round(value / interval) * interval;
}


// ---------------------------------------------------------------------------
// Placement constants (all in FEET)
// ---------------------------------------------------------------------------
export const WALL_CLEARANCE_FT = 2;            // min terminal-to-wall distance
export const MIN_TERMINAL_SPACING_FT = 4;      // min distance between any two terminals
export const RETURN_SUPPLY_MIN_SEP_FT = 6;     // return-to-supply separation target
export const CEILING_GRID_FT = 2;              // 2x2 ft ceiling tile grid
export const UNIT_SERVICE_CLEARANCE_FT = 2;    // indoor unit service clearance from wall
export const ODU_CLEARANCE_FT = 1;             // ODU clearance from the building wall
export const ODU_DEFAULT_DEPTH_FT = 3;
export const IDU_DEFAULT_DEPTH_FT = 1;
export const THROW_RATIO_MIN = 0.75;
export const THROW_RATIO_MAX = 1.25;

export type WallSide = 'north' | 'south' | 'east' | 'west';

export function getPolygonBounds(points: number[]): { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number; } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i], y = points[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/** Shortest distance from (x, y) to segment (ax, ay)-(bx, by). */
export function distanceToSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** Shortest distance from (x, y) to the polygon boundary. */
export function distanceToPolygonEdge(x: number, y: number, points: number[]): number {
  const n = points.length / 2;
  let best = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const d = distanceToSegment(x, y, points[2 * j], points[2 * j + 1], points[2 * i], points[2 * i + 1]);
    if (d < best) best = d;
  }
  return best;
}

/** True when the point is inside the polygon AND at least `clearance` from every wall. */
export function isPointInsideWithClearance(x: number, y: number, points: number[], clearance: number): boolean {
  if (!isPointInPolygon(x, y, points)) return false;
  return distanceToPolygonEdge(x, y, points) >= clearance - 1e-6;
}

/**
 * Sutherland-Hodgman clip of `subject` against an axis-aligned rectangle.
 * With a concave subject (L / U rooms) the result can contain zero-width bridge
 * edges, but its area and point-in-polygon behaviour are exact, and every vertex
 * lies inside both the subject and the rectangle.
 */
export function clipPolygonToRect(
  subject: number[],
  rect: { minX: number; minY: number; maxX: number; maxY: number }
): number[] {
  type P = { x: number; y: number };
  let pts: P[] = [];
  for (let i = 0; i + 1 < subject.length; i += 2) pts.push({ x: subject[i], y: subject[i + 1] });

  const clipEdge = (inside: (p: P) => boolean, intersect: (a: P, b: P) => P): void => {
    const out: P[] = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const prev = pts[(i + pts.length - 1) % pts.length];
      const curIn = inside(cur), prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) out.push(intersect(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(intersect(prev, cur));
      }
    }
    pts = out;
  };
  const atX = (x: number) => (a: P, b: P): P => ({ x, y: a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y) });
  const atY = (y: number) => (a: P, b: P): P => ({ x: a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x), y });

  clipEdge(p => p.x >= rect.minX, atX(rect.minX));
  if (pts.length) clipEdge(p => p.x <= rect.maxX, atX(rect.maxX));
  if (pts.length) clipEdge(p => p.y >= rect.minY, atY(rect.minY));
  if (pts.length) clipEdge(p => p.y <= rect.maxY, atY(rect.maxY));

  const cleaned: P[] = [];
  for (const p of pts) {
    const l = cleaned[cleaned.length - 1];
    if (!l || Math.abs(l.x - p.x) > 1e-9 || Math.abs(l.y - p.y) > 1e-9) cleaned.push(p);
  }
  return cleaned.flatMap(p => [p.x, p.y]);
}

// ---------------------------------------------------------------------------
// Professional terminal grid layout
// ---------------------------------------------------------------------------
export interface TerminalGridOptions {
  /** Drawing units per foot (1 = feet, px callers pass project scale). */
  unitPerFt?: number;
  /** Minimum terminal-to-wall distance in ft (default WALL_CLEARANCE_FT). */
  wallClearanceFt?: number;
  /** Ceiling grid in ft to snap to when it keeps containment/uniformity (0 disables). */
  snapGridFt?: number;
  /** Rectangles (drawing units) no terminal centre may fall into, e.g. indoor unit footprint + service clearance. */
  keepOuts?: Rect[];
}

export interface TerminalGridResult {
  points: { x: number; y: number }[];
  rows: number;
  cols: number;
  /** Cell size (centre-to-centre spacing) in drawing units. */
  spacingX: number;
  spacingY: number;
  /** Characteristic throw length L in FEET (half the governing spacing / wall distance). */
  throwLengthFt: number;
  /** Smallest centre-to-centre distance between points in FEET (Infinity for one point). */
  minSpacingFt: number;
  /** Smallest wall distance in FEET. */
  minWallDistanceFt: number;
}

type Pt = { x: number; y: number };

function minPairDistance(pts: Pt[]): number {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) m = Math.min(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  return m;
}

function pruneToCount(pts: Pt[], n: number, centre: Pt): Pt[] {
  const out = pts.slice();
  while (out.length > n) {
    // remove the point with the smallest nearest-neighbour distance; ties -> farthest from centre
    let worst = -1, worstNn = Infinity, worstC = -1;
    for (let i = 0; i < out.length; i++) {
      let nn = Infinity;
      for (let j = 0; j < out.length; j++) if (i !== j) nn = Math.min(nn, Math.hypot(out[i].x - out[j].x, out[i].y - out[j].y));
      const c = Math.hypot(out[i].x - centre.x, out[i].y - centre.y);
      if (nn < worstNn - 1e-9 || (Math.abs(nn - worstNn) <= 1e-9 && c > worstC)) {
        worst = i; worstNn = nn; worstC = c;
      }
    }
    out.splice(worst, 1);
  }
  return out;
}

/** Candidate lattice of points inside the polygon, each at least `clearance` from the walls. */
export function latticePointsInPolygon(points: number[], step: number, clearance: number, keepOuts: Rect[] = []): Pt[] {
  const b = getPolygonBounds(points);
  const out: Pt[] = [];
  if (!(step > 0)) return out;
  const nx = Math.max(1, Math.floor(b.width / step));
  const ny = Math.max(1, Math.floor(b.height / step));
  const ox = b.minX + (b.width - nx * step) / 2 + step / 2;
  const oy = b.minY + (b.height - ny * step) / 2 + step / 2;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const x = ox + i * step, y = oy + j * step;
      if (isPointInsideWithClearance(x, y, points, clearance) && !keepOuts.some((k) => pointInRect({ x, y }, k))) out.push({ x, y });
    }
  return out;
}

/**
 * Lays out `n` terminals evenly inside `points` (a possibly concave polygon).
 *
 * Rectangular bays: rows = max(1, round(sqrt(n*H/W))), cols = ceil(n/rows), cell-centred so
 * wall distance = half spacing. Concave rooms: grid candidates that fall outside the polygon
 * (or within the wall clearance) are discarded and the grid with the most even spacing that
 * still yields >= n points is used; as a last resort a maximin lattice selection is used.
 * A terminal is never emitted without a point-in-polygon check, so fewer than n points may be
 * returned when the room cannot hold n.
 */
export function layoutTerminalGrid(points: number[], n: number, options: TerminalGridOptions = {}): TerminalGridResult {
  const u = options.unitPerFt && options.unitPerFt > 0 ? options.unitPerFt : 1;
  const snapFt = options.snapGridFt === undefined ? CEILING_GRID_FT : options.snapGridFt;
  const empty: TerminalGridResult = {
    points: [], rows: 0, cols: 0, spacingX: 0, spacingY: 0,
    throwLengthFt: 0, minSpacingFt: Infinity, minWallDistanceFt: 0
  };
  n = Math.floor(n);
  if (points.length < 6 || !(n >= 1)) return empty;
  const b = getPolygonBounds(points);
  const W = Math.max(b.width, 1e-6), H = Math.max(b.height, 1e-6);
  const wallClr = (options.wallClearanceFt ?? WALL_CLEARANCE_FT) * u;
  const centroid = getPolygonCentroid(points);
  const keepOuts = options.keepOuts ?? [];
  const blocked = (x: number, y: number): boolean => keepOuts.some((k) => pointInRect({ x, y }, k));

  const cellCentres = (rows: number, cols: number, clr: number): Pt[] => {
    const cw = W / cols, ch = H / rows;
    const effClr = Math.min(clr, 0.5 * Math.min(cw, ch));
    const pts: Pt[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = b.minX + (c + 0.5) * cw, y = b.minY + (r + 0.5) * ch;
        if (isPointInsideWithClearance(x, y, points, effClr) && !blocked(x, y)) pts.push({ x, y });
      }
    return pts;
  };

  let rows = Math.max(1, Math.round(Math.sqrt((n * H) / W)));
  let cols = Math.ceil(n / rows);
  let chosen: Pt[] = cellCentres(rows, cols, wallClr);

  if (chosen.length >= n) {
    // Prefer an exact factorisation with near-square cells when the formula over-provisions cells
    if (rows * cols > n && chosen.length === rows * cols) {
      let best: { r: number; c: number; score: number } | null = null;
      for (let r = 1; r <= n; r++) {
        if (n % r) continue;
        const c = n / r;
        const asp = (W / c) / (H / r);
        if (asp < 0.67 || asp > 1.5) continue;
        const score = Math.abs(Math.log(asp));
        if (!best || score < best.score) best = { r, c, score };
      }
      if (best) {
        const alt = cellCentres(best.r, best.c, wallClr);
        if (alt.length === n) { rows = best.r; cols = best.c; chosen = alt; }
      }
    }
  } else {
    // Concave / tight polygon: search the grid with best uniformity that yields >= n valid points
    let best: { r: number; c: number; pts: Pt[]; score: number } | null = null;
    const maxCells = 6 * n + 12;
    for (let r = 1; r <= 40; r++) {
      for (let c = 1; c <= 40; c++) {
        if (r * c < n || r * c > maxCells) continue;
        const pts = cellCentres(r, c, wallClr);
        if (pts.length < n) continue;
        const asp = (W / c) / (H / r);
        const score = Math.abs(Math.log(asp)) + (0.6 * (pts.length - n)) / n;
        if (!best || score < best.score) best = { r, c, pts, score };
      }
    }
    if (best) { rows = best.r; cols = best.c; chosen = best.pts; }
    else chosen = [];
  }

  if (chosen.length > n) chosen = pruneToCount(chosen, n, centroid);

  if (chosen.length < n) {
    // Fallback: maximin selection from a fine lattice (progressively relaxing wall clearance)
    for (const clrFactor of [1, 0.5, 0.25, 0.05]) {
      const clr = wallClr * clrFactor;
      const step = Math.max(0.5 * u, Math.max(W, H) / 120);
      const cand = latticePointsInPolygon(points, step, clr, keepOuts);
      if (cand.length === 0) continue;
      const picked: Pt[] = [];
      const wallD = cand.map(p => distanceToPolygonEdge(p.x, p.y, points));
      const used = new Set<number>();
      while (picked.length < n && used.size < cand.length) {
        let bi = -1, bs = -Infinity;
        for (let i = 0; i < cand.length; i++) {
          if (used.has(i)) continue;
          let md = Infinity;
          for (const q of picked) md = Math.min(md, Math.hypot(cand[i].x - q.x, cand[i].y - q.y));
          const s = Math.min(md, 2 * wallD[i]);
          if (s > bs) { bs = s; bi = i; }
        }
        if (bi < 0) break;
        used.add(bi);
        picked.push(cand[bi]);
      }
      if (picked.length > chosen.length) chosen = picked;
      if (chosen.length >= n) break;
    }
    if (chosen.length) {
      rows = Math.max(1, Math.round(Math.sqrt((chosen.length * H) / W)));
      cols = Math.ceil(chosen.length / rows);
    }
  }
  if (chosen.length === 0) return empty;

  // Snap to the ceiling grid only if every point stays valid/unique and the tightest spacing is kept
  if (snapFt > 0 && chosen.length > 1) {
    const g = snapFt * u;
    const snapped = chosen.map(p => ({ x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g }));
    const effClr = Math.min(wallClr, 0.5 * Math.min(W / cols, H / rows));
    const ok = snapped.every(p => isPointInsideWithClearance(p.x, p.y, points, effClr) && !blocked(p.x, p.y))
      && new Set(snapped.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`)).size === snapped.length;
    if (ok && (chosen.length < 2 || minPairDistance(snapped) >= minPairDistance(chosen) * 0.95)) {
      // also reject a snap that makes the layout visibly less even
      const evenness = (pts: Pt[]): number => {
        if (pts.length < 2) return 1;
        const nn = pts.map((p, i) => Math.min(...pts.filter((_, j) => j !== i).map(q => Math.hypot(p.x - q.x, p.y - q.y))));
        return Math.max(...nn) / Math.min(...nn);
      };
      if (evenness(snapped) <= Math.max(1.05, evenness(chosen) * 1.02)) chosen = snapped;
    }
  }

  const cw = W / cols, ch = H / rows;
  const minSp = minPairDistance(chosen);
  const wallMin = Math.min(...chosen.map(p => distanceToPolygonEdge(p.x, p.y, points)));
  const governing = chosen.length > 1 ? Math.min(cw, ch) : Math.min(W, H);
  const L = governing / 2 / u;
  return {
    points: chosen.map(p => ({ x: p.x, y: p.y })),
    rows, cols, spacingX: cw, spacingY: ch,
    throwLengthFt: L,
    minSpacingFt: minSp / u,
    minWallDistanceFt: wallMin / u
  };
}

// ---------------------------------------------------------------------------
// Indoor / outdoor unit placement
// ---------------------------------------------------------------------------
interface WallEdge {
  ax: number; ay: number; bx: number; by: number;
  length: number;
  mx: number; my: number;
  /** unit outward normal */
  nx: number; ny: number;
  side: WallSide;
}

function sideFromNormal(nx: number, ny: number): WallSide {
  // Y grows down: north = -Y
  if (Math.abs(nx) >= Math.abs(ny)) return nx >= 0 ? 'east' : 'west';
  return ny >= 0 ? 'south' : 'north';
}

function polygonEdges(points: number[]): WallEdge[] {
  const n = points.length / 2;
  const edges: WallEdge[] = [];
  const b = getPolygonBounds(points);
  const eps = Math.max(1e-3, Math.max(b.width, b.height) * 1e-4);
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = points[2 * j], ay = points[2 * j + 1], bx = points[2 * i], by = points[2 * i + 1];
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 1e-9) continue;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    let nx = (by - ay) / length, ny = -(bx - ax) / length;
    // make the normal point OUTSIDE the polygon
    if (isPointInPolygon(mx + nx * eps * 5, my + ny * eps * 5, points)) { nx = -nx; ny = -ny; }
    edges.push({ ax, ay, bx, by, length, mx, my, nx, ny, side: sideFromNormal(nx, ny) });
  }
  return edges;
}

export interface OutdoorUnitPlacement {
  x: number;
  y: number;
  wallSide: WallSide;
  /** the exterior wall segment the unit sits against, in drawing units */
  wall: { x1: number; y1: number; x2: number; y2: number };
  /** footprint axis (long side, along the wall) angle in degrees, 0 = +x */
  angleDeg?: number;
  /** footprint length along the wall / depth away from it, in FEET */
  lengthFt?: number;
  depthFt?: number;
}

// ---------------------------------------------------------------------------
// Oriented-rectangle helpers (footprints of outdoor / wall-mounted units)
// ---------------------------------------------------------------------------
export type Pt2 = { x: number; y: number };

/** Corners of a rectangle centred at (cx, cy) with long axis along unit vector (tx, ty). */
export function orientedRectCorners(cx: number, cy: number, tx: number, ty: number, along: number, across: number): Pt2[] {
  const nx = -ty, ny = tx;
  const a = along / 2, c = across / 2;
  return [
    { x: cx - tx * a - nx * c, y: cy - ty * a - ny * c },
    { x: cx + tx * a - nx * c, y: cy + ty * a - ny * c },
    { x: cx + tx * a + nx * c, y: cy + ty * a + ny * c },
    { x: cx - tx * a + nx * c, y: cy - ty * a + ny * c }
  ];
}

const flat = (pts: Pt2[]): number[] => pts.flatMap((p) => [p.x, p.y]);

function segSegDistance(a: Pt2, b: Pt2, c: Pt2, d: Pt2): number {
  const o = (p: Pt2, q: Pt2, r: Pt2): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    distanceToSegment(a.x, a.y, c.x, c.y, d.x, d.y),
    distanceToSegment(b.x, b.y, c.x, c.y, d.x, d.y),
    distanceToSegment(c.x, c.y, a.x, a.y, b.x, b.y),
    distanceToSegment(d.x, d.y, a.x, a.y, b.x, b.y)
  );
}

/**
 * Gap between a convex footprint (4 corners) and a polygon: 0 when they touch or overlap (including full containment
 * either way), otherwise the shortest distance between their outlines.
 */
export function footprintPolygonGap(corners: Pt2[], poly: number[]): number {
  if (poly.length < 6) return Infinity;
  if (corners.some((c) => isPointInPolygon(c.x, c.y, poly))) return 0;
  const cf = flat(corners);
  for (let i = 0; i + 1 < poly.length; i += 2) if (isPointInPolygon(poly[i], poly[i + 1], cf)) return 0;
  let best = Infinity;
  const m = poly.length / 2;
  for (let k = 0, j = m - 1; k < m; j = k++) {
    const p = { x: poly[2 * j], y: poly[2 * j + 1] }, q = { x: poly[2 * k], y: poly[2 * k + 1] };
    for (let i = 0; i < 4; i++) best = Math.min(best, segSegDistance(corners[i], corners[(i + 1) % 4], p, q));
    if (best === 0) return 0;
  }
  return best;
}

/** True when the footprint lies entirely inside the polygon (touching the boundary allowed within `tol`). */
export function footprintInsidePolygon(corners: Pt2[], poly: number[], tol = 1e-6): boolean {
  const m = poly.length / 2;
  for (const c of corners) {
    if (!isPointInPolygon(c.x, c.y, poly) && distanceToPolygonEdge(c.x, c.y, poly) > tol) return false;
  }
  // no polygon edge may properly cross through the footprint
  for (let k = 0, j = m - 1; k < m; j = k++) {
    const p = { x: poly[2 * j], y: poly[2 * j + 1] }, q = { x: poly[2 * k], y: poly[2 * k + 1] };
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      const o = (u: Pt2, v: Pt2, w: Pt2): number => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
      const d1 = o(a, b, p), d2 = o(a, b, q), d3 = o(p, q, a), d4 = o(p, q, b);
      const eps = 1e-9;
      if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return false;
    }
  }
  // polygon vertex strictly inside the footprint (reflex corner poking into it)
  const cf = flat(corners);
  for (let i = 0; i + 1 < poly.length; i += 2) {
    if (isPointInPolygon(poly[i], poly[i + 1], cf) && distanceToPolygonEdge(poly[i], poly[i + 1], cf) > tol) return false;
  }
  return true;
}

function envelopeOf(points: number[], allZones: Zone[] | undefined, dxfBoundingBox: BoundingBox | null): { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number; } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  if (dxfBoundingBox) {
    ({ minX, maxX, minY, maxY } = dxfBoundingBox);
  } else if (allZones && allZones.length > 0) {
    for (const z of allZones) {
      const pts: number[] = z.points || [];
      for (let i = 0; i + 1 < pts.length; i += 2) {
        minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]);
        minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]);
      }
    }
  }
  if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) return getPolygonBounds(points);
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

export interface OutdoorUnitOptions {
  side?: WallSide;
  /** Footprint depth AWAY from the wall (ft). Default 13 in. */
  unitDepthFt?: number;
  /** Footprint length ALONG the wall (ft). Default 34 in. */
  unitLengthFt?: number;
  /** Clearance between the wall and the unit's near face (ft). Default 1. */
  clearanceFt?: number;
  /** Neighbouring zone outlines (drawing units); the unit never overlaps them. Defaults to `allZones` minus this zone. */
  otherZonePolygons?: number[][];
  /** Footprints (4 corners, drawing units) of outdoor units already placed; keeps >= ODU_MIN_SPACING_FT from them. */
  placedFootprints?: Pt2[][];
  /** Slide the unit along its wall towards this point (e.g. its indoor unit). */
  preferNear?: Pt2;
  /**
   * With `preferNear`: choose the exterior wall NEAREST to that point (shortest refrigerant run) instead of the
   * longest wall / `side`. Walls that cannot hold the unit (another zone, an earlier outdoor unit) are skipped in
   * order of distance.
   */
  nearestWall?: boolean;
}

/**
 * Places the outdoor unit OUTSIDE the zone, against its longest exterior wall (or the wall
 * facing `opts.side`), its near face `clearanceFt` (>= 1 ft) off the wall. The footprint (default 34 x 13 in) never
 * overlaps another zone, an already placed outdoor unit (>= 1 ft apart) or the room itself. Returns the wall side as well.
 * "Exterior" = edges lying on the building envelope; falls back to the longest edge.
 */
export function calculateOutdoorUnitPlacement(
  points: number[],
  allZones: Zone[] = [],
  dxfBoundingBox: BoundingBox | null = null,
  unitPerFt: number = 1,
  opts: OutdoorUnitOptions = {}
): OutdoorUnitPlacement {
  const u = unitPerFt > 0 ? unitPerFt : 1;
  if (points.length < 6) return { x: 0, y: 0, wallSide: 'east', wall: { x1: 0, y1: 0, x2: 0, y2: 0 } };
  const env = envelopeOf(points, allZones, dxfBoundingBox);
  const edges = polygonEdges(points);
  const centroid = getPolygonCentroid(points);
  const tol = Math.max(0.5 * u, 1e-6);

  const sameRing = (a: number[], b: number[]): boolean => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  const others: number[][] = opts.otherZonePolygons
    ?? (allZones || []).map((z) => z.points || []).filter((p) => p.length >= 6 && !sameRing(p, points));
  const placed = opts.placedFootprints ?? [];

  const onEnvelope = (e: WallEdge): boolean => {
    const vertical = Math.abs(e.ax - e.bx) <= tol, horizontal = Math.abs(e.ay - e.by) <= tol;
    if (vertical) return Math.abs(e.ax - env.minX) <= tol || Math.abs(e.ax - env.maxX) <= tol;
    if (horizontal) return Math.abs(e.ay - env.minY) <= tol || Math.abs(e.ay - env.maxY) <= tol;
    return false;
  };

  let pool = edges;
  if (opts.side && !opts.nearestWall) {
    const facing = edges.filter(e => e.side === opts.side);
    if (facing.length) pool = facing;
  }
  const exterior = pool.filter(onEnvelope);
  if (exterior.length) pool = exterior;

  const nearPt = opts.nearestWall ? opts.preferNear : undefined;
  const rank = (list: WallEdge[]): WallEdge[] => list.slice().sort((a, b) => {
    if (nearPt) {
      const da = distanceToSegment(nearPt.x, nearPt.y, a.ax, a.ay, a.bx, a.by);
      const db = distanceToSegment(nearPt.x, nearPt.y, b.ax, b.ay, b.bx, b.by);
      if (Math.abs(da - db) > tol) return da - db;
    }
    if (Math.abs(a.length - b.length) > tol) return b.length - a.length;
    // tie: wall closest to the zone centroid (shortest distribution run)
    return Math.hypot(a.mx - centroid.x, a.my - centroid.y) - Math.hypot(b.mx - centroid.x, b.my - centroid.y);
  });
  // preferred pool first, then every other wall as a fallback when the preferred ones are blocked
  const ranked = [...rank(pool), ...rank(edges.filter((e) => !pool.includes(e)))];

  const depth = (opts.unitDepthFt ?? DEFAULT_ODU_DEPTH_IN / 12) * u;
  const length = (opts.unitLengthFt ?? DEFAULT_ODU_LENGTH_IN / 12) * u;
  const clr = Math.max(opts.clearanceFt ?? ODU_CLEARANCE_FT, 0) * u;
  const spacing = ODU_MIN_SPACING_FT * u;
  const r2 = (v: number): number => Math.round(v * 100) / 100;

  const build = (e: WallEdge, t: number, off: number): { x: number; y: number; corners: Pt2[]; tx: number; ty: number } => {
    const tx = (e.bx - e.ax) / e.length, ty = (e.by - e.ay) / e.length;
    const cx = e.ax + tx * t + e.nx * off, cy = e.ay + ty * t + e.ny * off;
    return { x: r2(cx), y: r2(cy), corners: orientedRectCorners(r2(cx), r2(cy), tx, ty, length, depth), tx, ty };
  };
  const valid = (corners: Pt2[]): boolean => {
    if (footprintPolygonGap(corners, points) < clr - 1e-6) return false;
    if (others.some((o) => footprintPolygonGap(corners, o) < 0.25 * u)) return false;
    if (placed.some((p) => footprintPolygonGap(p, flat(corners)) < spacing - 1e-6)) return false;
    return true;
  };

  const near = opts.preferNear;
  for (const e of ranked) {
    const lo = Math.min(length / 2 + 0.25 * u, e.length / 2), hi = Math.max(e.length - length / 2 - 0.25 * u, e.length / 2);
    const t0raw = near ? ((near.x - e.ax) * (e.bx - e.ax) + (near.y - e.ay) * (e.by - e.ay)) / e.length : e.length / 2;
    const t0 = Math.min(hi, Math.max(lo, t0raw));
    const step = 0.5 * u;
    const ts: number[] = [t0];
    for (let k = 1; t0 - k * step >= lo - 1e-9 || t0 + k * step <= hi + 1e-9; k++) {
      if (t0 + k * step <= hi + 1e-9) ts.push(t0 + k * step);
      if (t0 - k * step >= lo - 1e-9) ts.push(t0 - k * step);
    }
    for (let extra = 0; extra <= 8; extra++) {
      const off = clr + depth / 2 + extra * u;
      for (const t of ts) {
        const c = build(e, t, off);
        if (valid(c.corners)) {
          return {
            x: c.x, y: c.y, wallSide: e.side,
            wall: { x1: e.ax, y1: e.ay, x2: e.bx, y2: e.by },
            angleDeg: (Math.atan2(c.ty, c.tx) * 180) / Math.PI, lengthFt: length / u, depthFt: depth / u
          };
        }
      }
    }
  }
  // Nothing free: best wall, pushed out until the footprint is clear of the room
  const best = ranked[0];
  let off = clr + depth / 2;
  let c = build(best, best.length / 2, off);
  for (let k = 0; k < 20 && (isPointInPolygon(c.x, c.y, points) || footprintPolygonGap(c.corners, points) < clr - 1e-6); k++) {
    off += u;
    c = build(best, best.length / 2, off);
  }
  return {
    x: c.x, y: c.y, wallSide: best.side,
    wall: { x1: best.ax, y1: best.ay, x2: best.bx, y2: best.by },
    angleDeg: (Math.atan2(c.ty, c.tx) * 180) / Math.PI, lengthFt: length / u, depthFt: depth / u
  };
}

/**
 * Outdoor unit (ODU) position: outside the zone, on its longest exterior wall.
 * Backward compatible {x, y}; use calculateOutdoorUnitPlacement for the wall side.
 * `unitPerFt` = drawing units per foot (px callers pass project scale).
 */
export function calculateOptimalOutdoorUnitPos(
  points: number[],
  allZones: Zone[],
  dxfBoundingBox: BoundingBox | null,
  unitPerFt: number = 1
): { x: number; y: number } {
  const p = calculateOutdoorUnitPlacement(points, allZones, dxfBoundingBox, unitPerFt);
  return { x: p.x, y: p.y };
}

/**
 * Indoor unit (FCU / wall IU): centred on the wall segment closest to the ODU, inside the room
 * with >= 2 ft service clearance. Without an ODU the longest wall is used. The result is
 * guaranteed inside the polygon (snapping is re-checked, then clamped).
 */
export function calculateOptimalIndoorUnitPos(
  points: number[],
  outdoorUnitPos?: { x: number; y: number },
  unitPerFt: number = 1,
  opts: { unitDepthFt?: number; clearanceFt?: number } = {}
): { x: number; y: number } {
  if (points.length < 6) return { x: 0, y: 0 };
  const u = unitPerFt > 0 ? unitPerFt : 1;
  const edges = polygonEdges(points);
  if (!edges.length) return getPolygonCentroid(points);
  const hasOdu = !!outdoorUnitPos && (outdoorUnitPos.x !== 0 || outdoorUnitPos.y !== 0);
  const tol = 0.5 * u;

  const ranked = edges.slice().sort((a, b) => {
    if (hasOdu) {
      const da = distanceToSegment(outdoorUnitPos!.x, outdoorUnitPos!.y, a.ax, a.ay, a.bx, a.by);
      const db = distanceToSegment(outdoorUnitPos!.x, outdoorUnitPos!.y, b.ax, b.ay, b.bx, b.by);
      if (Math.abs(da - db) > tol) return da - db;
    }
    return b.length - a.length;
  });

  const clr = (opts.clearanceFt ?? UNIT_SERVICE_CLEARANCE_FT) * u;
  const depth = (opts.unitDepthFt ?? IDU_DEFAULT_DEPTH_FT) * u;
  const centroid = getPolygonCentroid(points);

  for (const e of ranked) {
    const inset0 = clr + depth / 2;
    for (const inset of [inset0, inset0 * 1.5, inset0 * 2]) {
      const rx = e.mx - e.nx * inset, ry = e.my - e.ny * inset;
      const sx = Math.round(rx / u) * u, sy = Math.round(ry / u) * u;
      for (const [x, y] of [[sx, sy], [rx, ry]]) {
        if (isPointInsideWithClearance(x, y, points, clr)) return { x, y };
      }
    }
  }
  // Last resort: step from the wall midpoint toward the centroid until inside with clearance
  const e = ranked[0];
  for (let t = 0.05; t <= 1; t += 0.05) {
    const x = e.mx + (centroid.x - e.mx) * t, y = e.my + (centroid.y - e.my) * t;
    if (isPointInsideWithClearance(x, y, points, Math.min(clr, 0.25 * u))) return { x, y };
  }
  return { x: centroid.x, y: centroid.y };
}

// ---------------------------------------------------------------------------
// Wall-mounted indoor units (high-wall splits)
// ---------------------------------------------------------------------------
export const WALL_UNIT_DEFAULT_WIDTH_FT = 3;
export const WALL_UNIT_DEFAULT_DEPTH_FT = 10 / 12;

export interface WallMountedUnitPlacement {
  /** unit centre, drawing units */
  x: number;
  y: number;
  /** the side of the room the host wall is on (east wall = unit faces west) */
  wallSide: WallSide;
  /** drawing rotation in degrees, same convention as the zone partitioner (east 270, west 90, south 0, north 180) */
  rotation: number;
  wall: { x1: number; y1: number; x2: number; y2: number };
  /** unit length axis angle (along the wall), degrees */
  angleDeg: number;
  widthFt: number;
  depthFt: number;
}

/**
 * Places a wall-mounted unit ON a wall: the back of the unit is flush with the wall line (centre = depth/2 inside it)
 * and the whole footprint lies inside the room and within the wall segment. Host wall: the wall facing
 * `opts.exteriorSide` when known, otherwise the longest wall (ties: nearest the outdoor unit). The unit is centred on
 * the wall segment, or slid along it until the footprint is fully inside (L / U rooms). With `opts.near` (e.g. a
 * user-dragged position) the nearest wall is used and the unit is snapped to the projection of that point.
 */
export function calculateWallMountedUnitPos(
  points: number[],
  unitPerFt: number = 1,
  opts: { exteriorSide?: WallSide; outdoorUnitPos?: Pt2; near?: Pt2; unitWidthFt?: number; unitDepthFt?: number } = {}
): WallMountedUnitPlacement {
  const u = unitPerFt > 0 ? unitPerFt : 1;
  const width = (opts.unitWidthFt ?? WALL_UNIT_DEFAULT_WIDTH_FT) * u;
  const depth = (opts.unitDepthFt ?? WALL_UNIT_DEFAULT_DEPTH_FT) * u;
  const fallback: WallMountedUnitPlacement = {
    x: 0, y: 0, wallSide: 'east', rotation: 270, wall: { x1: 0, y1: 0, x2: 0, y2: 0 }, angleDeg: 0, widthFt: width / u, depthFt: depth / u
  };
  if (points.length < 6) return fallback;
  const edges = polygonEdges(points);
  if (!edges.length) return fallback;
  const tol = 0.5 * u;
  const odu = opts.outdoorUnitPos && (opts.outdoorUnitPos.x !== 0 || opts.outdoorUnitPos.y !== 0) ? opts.outdoorUnitPos : undefined;

  const ranked = edges.slice().sort((a, b) => {
    if (opts.near) {
      const da = distanceToSegment(opts.near.x, opts.near.y, a.ax, a.ay, a.bx, a.by);
      const db = distanceToSegment(opts.near.x, opts.near.y, b.ax, b.ay, b.bx, b.by);
      if (Math.abs(da - db) > tol) return da - db;
    } else if (opts.exteriorSide) {
      const fa = a.side === opts.exteriorSide ? 0 : 1, fb = b.side === opts.exteriorSide ? 0 : 1;
      if (fa !== fb) return fa - fb;
    }
    if (Math.abs(a.length - b.length) > tol) return b.length - a.length;
    if (odu) {
      return distanceToSegment(odu.x, odu.y, a.ax, a.ay, a.bx, a.by) - distanceToSegment(odu.x, odu.y, b.ax, b.ay, b.bx, b.by);
    }
    return 0;
  });

  const rotationOf = (side: WallSide): number => (side === 'east' ? 270 : side === 'west' ? 90 : side === 'north' ? 180 : 0);
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  const place = (e: WallEdge, t: number): { x: number; y: number; corners: Pt2[]; tx: number; ty: number } => {
    const tx = (e.bx - e.ax) / e.length, ty = (e.by - e.ay) / e.length;
    // inward normal = -outward normal; centre sits depth/2 inside the wall line (back flush)
    const cx = e.ax + tx * t - e.nx * (depth / 2), cy = e.ay + ty * t - e.ny * (depth / 2);
    return { x: cx, y: cy, corners: orientedRectCorners(cx, cy, tx, ty, width, depth), tx, ty };
  };
  const result = (e: WallEdge, c: { x: number; y: number; tx: number; ty: number }): WallMountedUnitPlacement => ({
    x: r2(c.x), y: r2(c.y), wallSide: e.side, rotation: rotationOf(e.side),
    wall: { x1: e.ax, y1: e.ay, x2: e.bx, y2: e.by },
    angleDeg: (Math.atan2(c.ty, c.tx) * 180) / Math.PI, widthFt: width / u, depthFt: depth / u
  });

  for (const e of ranked) {
    const margin = 0.5 * u;
    const lo = width / 2 + margin, hi = e.length - width / 2 - margin;
    if (hi < lo - 1e-9) continue; // wall shorter than the unit
    const tProj = opts.near ? ((opts.near.x - e.ax) * (e.bx - e.ax) + (opts.near.y - e.ay) * (e.by - e.ay)) / e.length : e.length / 2;
    const t0 = Math.min(hi, Math.max(lo, tProj));
    const step = 0.5 * u;
    const ts: number[] = [t0];
    for (let k = 1; t0 - k * step >= lo - 1e-9 || t0 + k * step <= hi + 1e-9; k++) {
      if (t0 + k * step <= hi + 1e-9) ts.push(t0 + k * step);
      if (t0 - k * step >= lo - 1e-9) ts.push(t0 - k * step);
    }
    for (const t of ts) {
      const c = place(e, t);
      if (footprintInsidePolygon(c.corners, points, 1e-4 * u)) return result(e, c);
    }
  }
  // No wall can hold the full footprint: use the longest wall's midpoint (still flush to the wall)
  const e = edges.slice().sort((a, b) => b.length - a.length)[0];
  return result(e, place(e, e.length / 2));
}
