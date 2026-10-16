/**
 * Plan-view clearance geometry shared by the terminal placers, the duct routers and the validators.
 * Everything here is unit-agnostic where a `scale` (coordinate units per foot) is accepted, and in FEET otherwise.
 *
 * Rules (professional drafting practice):
 *  - a duct EDGE (centreline +- width/2) stays >= WALL_DUCT_CLEARANCE_FT inside the wall;
 *  - a duct body never overlaps a terminal face, except the final run-out that ends at that terminal's centre;
 *  - terminals stay out of every indoor unit footprint plus its service clearance;
 *  - supply and return networks do not cross in plan; an unavoidable crossing is FLAGGED as a "crossover".
 */

import type { Seg2 } from './orthogonalTopology';

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Minimum distance between a duct edge and the wall (ft). */
export const WALL_DUCT_CLEARANCE_FT = 0.5;
/** Minimum gap between a duct edge and a terminal face it is not connected to (ft). */
export const DUCT_TERMINAL_CLEARANCE_FT = 0.5;
/** Service clearance around an indoor unit footprint (ft). */
export const IDU_SERVICE_CLEARANCE_FT = 2;
/** Default ducted indoor unit footprint (in): length x width. */
export const DEFAULT_IDU_LENGTH_IN = 40;
export const DEFAULT_IDU_WIDTH_IN = 24;
/** Default outdoor unit footprint (in): length along the wall x depth away from it. */
export const DEFAULT_ODU_LENGTH_IN = 34;
export const DEFAULT_ODU_DEPTH_IN = 13;
/** Minimum gap between neighbouring outdoor units (ft). */
export const ODU_MIN_SPACING_FT = 1;

export interface UnitFootprintIn {
  lengthIn: number;
  widthIn: number;
}

export const rectAround = (c: { x: number; y: number }, w: number, h: number): Rect => ({
  minX: c.x - w / 2,
  maxX: c.x + w / 2,
  minY: c.y - h / 2,
  maxY: c.y + h / 2
});

export const inflateRect = (r: Rect, d: number): Rect => ({ minX: r.minX - d, maxX: r.maxX + d, minY: r.minY - d, maxY: r.maxY + d });

export const scaleRect = (r: Rect, k: number): Rect => ({ minX: r.minX * k, maxX: r.maxX * k, minY: r.minY * k, maxY: r.maxY * k });

export const pointInRect = (p: { x: number; y: number }, r: Rect, eps = 0): boolean =>
  p.x > r.minX + eps && p.x < r.maxX - eps && p.y > r.minY + eps && p.y < r.maxY - eps;

/** True when the interiors of the two rectangles overlap by more than `eps`. */
export const rectsOverlap = (a: Rect, b: Rect, eps = 1e-6): boolean =>
  a.minX < b.maxX - eps && a.maxX > b.minX + eps && a.minY < b.maxY - eps && a.maxY > b.minY + eps;

/**
 * Face size (in) from a catalog string: `18"x18"`, `24" dia`, `Ø12"`; a string without an inch mark is millimetres when
 * `metric` is set (`457x457`). Defaults to 24 x 24.
 */
export function parseFaceIn(face: string | undefined, metric = false): { w: number; h: number } {
  if (face) {
    const k = metric && !face.includes('"') ? 1 / 25.4 : 1;
    const wh = face.match(/(\d+(?:\.\d+)?)\s*"?\s*[xX×]\s*(\d+(?:\.\d+)?)/);
    if (wh) return { w: parseFloat(wh[1]) * k, h: parseFloat(wh[2]) * k };
    const d = face.match(/(\d+(?:\.\d+)?)/);
    if (d) return { w: parseFloat(d[1]) * k, h: parseFloat(d[1]) * k };
  }
  return { w: 24, h: 24 };
}

/** Plan rectangle (ft) of a terminal face centred at `p`. */
export function terminalFaceRectFt(p: { x: number; y: number }, face: string | undefined, metric = false): Rect {
  const f = parseFaceIn(face, metric);
  return rectAround(p, f.w / 12, f.h / 12);
}

/**
 * Plan footprint (ft) of an indoor unit mounted against `wallSide` (long axis perpendicular to the wall, so its
 * discharge points into the room). Ceiling-mounted units use the long axis along x.
 */
export function unitFootprintFt(
  pos: { x: number; y: number; wallSide?: string },
  dims: Partial<UnitFootprintIn> = {}
): Rect {
  const L = (dims.lengthIn ?? DEFAULT_IDU_LENGTH_IN) / 12;
  const W = (dims.widthIn ?? DEFAULT_IDU_WIDTH_IN) / 12;
  const alongY = pos.wallSide === 'north' || pos.wallSide === 'south';
  return alongY ? rectAround(pos, W, L) : rectAround(pos, L, W);
}

/** Footprint plus service clearance: terminals are excluded from this zone. */
export function unitKeepOutFt(
  pos: { x: number; y: number; wallSide?: string },
  dims: Partial<UnitFootprintIn> = {},
  serviceFt: number = IDU_SERVICE_CLEARANCE_FT
): Rect {
  return inflateRect(unitFootprintFt(pos, dims), serviceFt);
}

const bboxOfSeg = (s: Seg2): Rect => ({
  minX: Math.min(s.start.x, s.end.x),
  maxX: Math.max(s.start.x, s.end.x),
  minY: Math.min(s.start.y, s.end.y),
  maxY: Math.max(s.start.y, s.end.y)
});

/** The plan rectangle swept by a duct (segment +- half width on both sides). */
export const ductBodyRect = (s: Seg2, halfWidth: number): Rect => inflateRect(bboxOfSeg(s), halfWidth);

/** True when the duct body overlaps the rectangle's interior by more than `eps`. */
export const ductOverlapsRect = (s: Seg2, halfWidth: number, r: Rect, eps = 1e-6): boolean =>
  rectsOverlap(ductBodyRect(s, halfWidth), r, eps);

/** Intersection point of two axis-aligned segments (closed ranges, `tol` slack); null when they do not meet or are parallel. */
export function orthogonalCrossing(a: Seg2, b: Seg2, tol = 1e-6): { x: number; y: number } | null {
  const ah = Math.abs(a.start.y - a.end.y) <= tol, av = Math.abs(a.start.x - a.end.x) <= tol;
  const bh = Math.abs(b.start.y - b.end.y) <= tol, bv = Math.abs(b.start.x - b.end.x) <= tol;
  const within = (v: number, p: number, q: number): boolean => v >= Math.min(p, q) - tol && v <= Math.max(p, q) + tol;
  if (ah && !av && bv && !bh) {
    return within(b.start.x, a.start.x, a.end.x) && within(a.start.y, b.start.y, b.end.y) ? { x: b.start.x, y: a.start.y } : null;
  }
  if (av && !ah && bh && !bv) {
    return within(a.start.x, b.start.x, b.end.x) && within(b.start.y, a.start.y, a.end.y) ? { x: a.start.x, y: b.start.y } : null;
  }
  return null;
}

/**
 * Number of crossings between the segments of `mine` and the foreign network `others`.
 * Crossings within `exemptRadius` of any `exempt` point (the shared unit root) are ignored.
 */
export function countCrossings(
  mine: Seg2[],
  others: Seg2[],
  exempt: Array<{ x: number; y: number }>,
  exemptRadius: number,
  tol = 1e-6
): number {
  let n = 0;
  for (const s of mine) {
    for (const o of others) {
      const p = orthogonalCrossing(s, o, tol);
      if (!p) continue;
      if (exempt.some((e) => Math.hypot(e.x - p.x, e.y - p.y) <= exemptRadius)) continue;
      n++;
    }
  }
  return n;
}
