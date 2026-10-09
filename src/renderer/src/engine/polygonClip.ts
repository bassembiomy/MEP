import { calculatePolygonArea } from './geometry';
import { isPointInOrOnPolygon } from './validation/spatialValidator';

export interface ClipRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

type P = { x: number; y: number };

/** One Sutherland-Hodgman pass against a single axis-aligned half-plane. */
function clipHalfPlane(poly: P[], inside: (p: P) => boolean, intersect: (a: P, b: P) => P): P[] {
  const out: P[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersect(prev, cur));
    }
  }
  return out;
}

const toPoints = (flat: number[]): P[] => {
  const pts: P[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push({ x: flat[i], y: flat[i + 1] });
  return pts;
};
const toFlat = (pts: P[]): number[] => pts.flatMap((p) => [p.x, p.y]);

function clipRing(points: number[], r: ClipRect): P[] {
  let poly = toPoints(points);
  const atX = (x: number) => (a: P, b: P): P => ({ x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) });
  const atY = (y: number) => (a: P, b: P): P => ({ x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y), y });
  const passes: [(p: P) => boolean, (a: P, b: P) => P][] = [
    [(p) => p.x >= r.minX, atX(r.minX)],
    [(p) => p.x <= r.maxX, atX(r.maxX)],
    [(p) => p.y >= r.minY, atY(r.minY)],
    [(p) => p.y <= r.maxY, atY(r.maxY)]
  ];
  for (const [inside, intersect] of passes) {
    if (!poly.length) break;
    poly = clipHalfPlane(poly, inside, intersect);
  }
  return poly;
}

/**
 * Sutherland-Hodgman clip of a polygon (flat [x1,y1,...]) against an axis-aligned rectangle. The area of the
 * result is exact even for concave subjects; when the true intersection is several pieces the ring contains
 * zero-area bridges along the window edge, which {@link clipComesOutInPieces} detects.
 */
export function clipPolygonToRect(points: number[], rect: ClipRect): number[] {
  const ring = clipRing(points, rect);
  return ring.length >= 3 ? toFlat(ring) : [];
}

/**
 * True when polygon ∩ rect is more than one disconnected piece. Sutherland-Hodgman joins such pieces with
 * bridging edges on the window boundary that are traversed twice in opposite directions, so overlapping,
 * oppositely directed collinear edges on a window side reveal the split.
 */
export function clipComesOutInPieces(points: number[], rect: ClipRect): boolean {
  const ring = clipRing(points, rect);
  if (ring.length < 4) return false;
  const scale = Math.max(1, rect.maxX - rect.minX, rect.maxY - rect.minY);
  const eps = 1e-9 * scale;
  const sides: { fixed: 'x' | 'y'; value: number }[] = [
    { fixed: 'x', value: rect.minX },
    { fixed: 'x', value: rect.maxX },
    { fixed: 'y', value: rect.minY },
    { fixed: 'y', value: rect.maxY }
  ];
  for (const side of sides) {
    const along = side.fixed === 'x' ? 'y' : 'x';
    const edges: { lo: number; hi: number; dir: number }[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (Math.abs(a[side.fixed] - side.value) > eps || Math.abs(b[side.fixed] - side.value) > eps) continue;
      const d = b[along] - a[along];
      if (Math.abs(d) <= eps) continue;
      edges.push({ lo: Math.min(a[along], b[along]), hi: Math.max(a[along], b[along]), dir: Math.sign(d) });
    }
    for (let i = 0; i < edges.length; i++)
      for (let j = i + 1; j < edges.length; j++) {
        if (edges[i].dir === edges[j].dir) continue;
        const lo = Math.max(edges[i].lo, edges[j].lo);
        const hi = Math.min(edges[i].hi, edges[j].hi);
        if (hi - lo <= eps) continue;
        // A polygon edge lying exactly on the window side also yields a doubled edge, but that is only a
        // zero-width sliver. A real split bridges empty space, so the overlap midpoint is outside the polygon.
        const mid = (lo + hi) / 2;
        const onPolygon = side.fixed === 'x' ? isPointInOrOnPolygon(side.value, mid, points) : isPointInOrOnPolygon(mid, side.value, points);
        if (!onPolygon) return true;
      }
  }
  return false;
}

export type PartitionResult =
  | { ok: true; axis: 'x' | 'y'; parts: number[][] }
  | { ok: false; reason: string };

function cleanRing(flat: number[], eps: number): number[] {
  const pts = toPoints(flat);
  const out: P[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > eps) out.push(p);
  }
  while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= eps) out.pop();
  return toFlat(out);
}

/**
 * Splits a polygon into `qty` pieces of equal area by cutting perpendicular to one axis. Each cut is found by
 * bisection on the clipped area, so concave outlines are honoured. The preferred axis is tried first; if any
 * slab comes out in several pieces (or empty) the other axis is tried.
 */
export function partitionPolygonByArea(
  points: number[],
  qty: number,
  preferredAxis: 'x' | 'y' = 'y'
): PartitionResult {
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, reason: 'Unit quantity must be a positive integer.' };
  if (points.length < 6 || points.length % 2 !== 0 || !points.every(Number.isFinite))
    return { ok: false, reason: 'Zone polygon is not a valid outline.' };
  const area = calculatePolygonArea(points);
  if (!(area > 0)) return { ok: false, reason: 'Zone polygon has no area.' };
  if (qty === 1) return { ok: true, axis: preferredAxis, parts: [points] };

  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  const box: ClipRect = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const eps = 1e-9 * Math.max(box.maxX - box.minX, box.maxY - box.minY, 1);
  const axes: ('x' | 'y')[] = preferredAxis === 'y' ? ['y', 'x'] : ['x', 'y'];
  const failures: string[] = [];

  for (const axis of axes) {
    const lo = axis === 'x' ? box.minX : box.minY;
    const hi = axis === 'x' ? box.maxX : box.maxY;
    const window = (a: number, b: number): ClipRect =>
      axis === 'x' ? { ...box, minX: a, maxX: b } : { ...box, minY: a, maxY: b };
    const areaBelow = (c: number) => calculatePolygonArea(clipPolygonToRect(points, window(lo, c)));
    const cuts: number[] = [lo];
    for (let k = 1; k < qty; k++) {
      const target = (area * k) / qty;
      let a = cuts[cuts.length - 1];
      let b = hi;
      for (let it = 0; it < 80; it++) {
        const mid = (a + b) / 2;
        if (areaBelow(mid) < target) a = mid;
        else b = mid;
      }
      cuts.push((a + b) / 2);
    }
    cuts.push(hi);

    const parts: number[][] = [];
    let ok = true;
    for (let k = 0; k < qty && ok; k++) {
      const rect = window(cuts[k], cuts[k + 1]);
      if (clipComesOutInPieces(points, rect)) {
        failures.push(`${axis}-axis slab ${k + 1} splits into disconnected pieces`);
        ok = false;
        break;
      }
      const part = cleanRing(clipPolygonToRect(points, rect), eps);
      const partArea = part.length >= 6 ? calculatePolygonArea(part) : 0;
      if (!(partArea > 0) || Math.abs(partArea - area / qty) / (area / qty) > 0.01) {
        failures.push(`${axis}-axis slab ${k + 1} has area ${partArea.toFixed(3)} instead of ${(area / qty).toFixed(3)}`);
        ok = false;
        break;
      }
      parts.push(part);
    }
    if (ok) return { ok: true, axis, parts };
  }
  return { ok: false, reason: failures.join('; ') };
}
