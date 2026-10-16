/**
 * Post-routing verification of the plan clearance rules on SIZED ducts. Routers call this after the last sizing pass and
 * flag every section that still breaks a rule (tiny or over-full rooms where no clean layout exists), so the result is
 * never silently wrong.
 */

import { distanceToPolygonEdge, isPointInPolygon } from '../geometry';
import { DUCT_TERMINAL_CLEARANCE_FT, WALL_DUCT_CLEARANCE_FT, ductOverlapsRect, inflateRect, Rect } from './clearance';
import type { Seg2 } from './orthogonalTopology';

export interface ClearanceObstacle {
  id: string;
  /** Terminal face (same units as the segments). */
  rect: Rect;
}

export interface ClearanceInput {
  seg: Seg2;
  /** Duct width (plan view) in the same units as the segment coordinates. */
  width: number;
  /** Terminal ids that end this section (its own final run-out). */
  endsAt: string[];
}

/**
 * Returns a human readable description of the first rule the duct breaks, or null when it is clean.
 * `scale` = coordinate units per foot (1 for feet); clearances are applied in feet x scale.
 */
export function findClearanceIssue(
  d: ClearanceInput,
  roomPolygon: number[] | undefined,
  obstacles: ReadonlyArray<ClearanceObstacle>,
  scale = 1
): string | null {
  const hw = d.width / 2;
  if (roomPolygon && roomPolygon.length >= 6) {
    const L = Math.hypot(d.seg.end.x - d.seg.start.x, d.seg.end.y - d.seg.start.y);
    const n = Math.max(1, Math.ceil(L / (0.25 * scale)));
    const need = hw + (WALL_DUCT_CLEARANCE_FT - 0.02) * scale;
    for (let i = 0; i <= n; i++) {
      const x = d.seg.start.x + ((d.seg.end.x - d.seg.start.x) * i) / n;
      const y = d.seg.start.y + ((d.seg.end.y - d.seg.start.y) * i) / n;
      if (!isPointInPolygon(x, y, roomPolygon) || distanceToPolygonEdge(x, y, roomPolygon) < need) {
        return `duct edge closer than ${WALL_DUCT_CLEARANCE_FT} ft to the wall`;
      }
    }
  }
  for (const o of obstacles) {
    if (!ductOverlapsRect(d.seg, hw, o.rect, 0.01 * scale)) continue;
    const cx = (o.rect.minX + o.rect.maxX) / 2, cy = (o.rect.minY + o.rect.maxY) / 2;
    const ends = d.endsAt.includes(o.id) && Math.hypot(d.seg.end.x - cx, d.seg.end.y - cy) <= 0.15 * scale;
    if (!ends) return `duct passes through terminal ${o.id}`;
  }
  return null;
}

/** Same rule set with the 0.5 ft terminal gap applied (used by the routers' own search, exported for tests). */
export const termClearRect = (r: Rect, scale = 1): Rect => inflateRect(r, DUCT_TERMINAL_CLEARANCE_FT * scale);
