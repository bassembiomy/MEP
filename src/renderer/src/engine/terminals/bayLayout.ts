import {
  layoutTerminalGrid,
  isPointInPolygon,
  distanceToPolygonEdge,
  getPolygonBounds,
  MIN_TERMINAL_SPACING_FT,
  type TerminalGridOptions,
  type TerminalGridResult
} from '../geometry';

type P = { x: number; y: number };

const toPts = (a: number[]): P[] => {
  const out: P[] = [];
  for (let i = 0; i + 1 < a.length; i += 2) out.push({ x: a[i], y: a[i + 1] });
  return out;
};
const flat = (p: P[]): number[] => p.flatMap((q) => [q.x, q.y]);

const signedArea = (p: P[]): number => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    s += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  return s / 2;
};

/** Polygon area (any winding), same units as the points squared. */
export function polygonAreaAbs(points: number[]): number {
  return Math.abs(signedArea(toPts(points)));
}

function cleanRing(p: P[]): P[] {
  const out: P[] = [];
  for (const q of p) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - q.x, last.y - q.y) > 1e-7) out.push(q);
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-7) out.pop();
  // drop collinear vertices
  const res: P[] = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) > 1e-9) res.push(b);
  }
  return res.length >= 3 ? res : out;
}

/** Index of the first reflex vertex of a ring oriented CCW (positive area), or -1 when the ring is convex. */
function firstReflex(p: P[]): number {
  const sign = signedArea(p) >= 0 ? 1 : -1;
  for (let i = 0; i < p.length; i++) {
    const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cr * sign < -1e-9) return i;
  }
  return -1;
}

export function isConvexPolygon(points: number[]): boolean {
  return firstReflex(cleanRing(toPts(points))) < 0;
}

/** Nearest hit of the ray o + t*d (t > eps) with the ring's edges (skipping the two edges at vertex `skipVertex`). */
function rayHit(p: P[], o: P, d: P, skipVertex: number): { t: number; edge: number; pt: P } | null {
  let best: { t: number; edge: number; pt: P } | null = null;
  const n = p.length;
  for (let j = 0; j < n; j++) {
    if (j === skipVertex || (j + 1) % n === skipVertex) continue;
    const a = p[j], b = p[(j + 1) % n];
    const ex = b.x - a.x, ey = b.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
    const u = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
    if (t > 1e-7 && u >= -1e-9 && u <= 1 + 1e-9 && (!best || t < best.t)) {
      best = { t, edge: j, pt: { x: o.x + t * d.x, y: o.y + t * d.y } };
    }
  }
  return best;
}

function splitAtReflex(p: P[], i: number): [P[], P[]] | null {
  const n = p.length;
  const v = p[i];
  const prev = p[(i + n - 1) % n], next = p[(i + 1) % n];
  const dirs: P[] = [
    { x: v.x - prev.x, y: v.y - prev.y },
    { x: v.x - next.x, y: v.y - next.y }
  ];
  for (const raw of dirs) {
    const len = Math.hypot(raw.x, raw.y);
    if (len < 1e-9) continue;
    const d = { x: raw.x / len, y: raw.y / len };
    const hit = rayHit(p, v, d, i);
    if (!hit) continue;
    const j = hit.edge;
    // A: v -> ... -> p[j] -> hit ; B: hit -> p[j+1] -> ... -> v
    const A: P[] = [];
    for (let k = i; ; k = (k + 1) % n) {
      A.push(p[k]);
      if (k === j) break;
    }
    A.push(hit.pt);
    const B: P[] = [hit.pt];
    for (let k = (j + 1) % n; ; k = (k + 1) % n) {
      B.push(p[k]);
      if (k === i) break;
    }
    const a = cleanRing(A), b = cleanRing(B);
    if (a.length >= 3 && b.length >= 3 && Math.abs(signedArea(a)) > 1e-6 && Math.abs(signedArea(b)) > 1e-6) return [a, b];
  }
  return null;
}

/**
 * Convex decomposition of a simple polygon (flat [x,y,...]) into bays: every reflex vertex is resolved by extending one
 * of its edges across the room until the pieces are convex (an L becomes its two arms, a T three legs ...).
 * A convex polygon is returned unchanged; a pathological one falls back to a single piece.
 */
export function decomposeConvex(points: number[]): number[][] {
  const start = cleanRing(toPts(points));
  if (start.length < 3) return [points.slice()];
  const out: number[][] = [];
  const queue: P[][] = [start];
  let guard = 0;
  while (queue.length && guard++ < 200) {
    const ring = queue.pop() as P[];
    const r = firstReflex(ring);
    if (r < 0) { out.push(flat(ring)); continue; }
    const parts = splitAtReflex(ring, r);
    if (!parts) { out.push(flat(ring)); continue; }
    queue.push(parts[0], parts[1]);
  }
  for (const q of queue) out.push(flat(q));
  return out.length ? out : [points.slice()];
}

/** Largest-remainder allocation of `n` terminals over bay areas, at least one per bay. */
export function allocateByArea(areas: number[], n: number): number[] {
  const total = areas.reduce((a, b) => a + b, 0) || 1;
  const k = areas.length;
  const target = Math.max(n, k);
  const base = areas.map(() => 1);
  let left = target - k;
  const ideal = areas.map((a) => (a / total) * target);
  // distribute the rest proportionally to the area deficit
  while (left > 0) {
    let bi = 0, bd = -Infinity;
    for (let i = 0; i < k; i++) {
      const deficit = ideal[i] - base[i];
      if (deficit > bd) { bd = deficit; bi = i; }
    }
    base[bi]++;
    left--;
  }
  return base;
}

const minPair = (pts: P[]): number => {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.min(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  return m;
};

/**
 * Terminal grid for a service bay of ANY shape. Convex bays use layoutTerminalGrid directly. A non-convex bay (L / T / U)
 * is split into convex arms and each arm receives a terminal count proportional to its area (at least one), laid out on
 * its own grid, so a far arm is never starved by a single terminal at the junction.
 */
export function layoutBayTerminalGrid(points: number[], n: number, options: TerminalGridOptions = {}): TerminalGridResult {
  const bays = decomposeConvex(points);
  if (bays.length <= 1) return layoutTerminalGrid(points, n, options);
  const counts = allocateByArea(bays.map(polygonAreaAbs), n);
  const pts: P[] = [];
  let rows = 0, cols = 0, spacingX = 0, spacingY = 0, throwSum = 0, areaSum = 0, wallMin = Infinity;
  bays.forEach((b, i) => {
    const g = layoutTerminalGrid(b, counts[i], options);
    if (g.points.length === 0) return;
    pts.push(...g.points);
    const a = polygonAreaAbs(b);
    throwSum += g.throwLengthFt * a;
    areaSum += a;
    if (g.points.length >= rows * cols) { rows = g.rows; cols = g.cols; spacingX = g.spacingX; spacingY = g.spacingY; }
    wallMin = Math.min(wallMin, g.minWallDistanceFt);
  });
  // arms share a cut line: drop a terminal that crowds an earlier one closer than the minimum spacing
  const u = options.unitPerFt && options.unitPerFt > 0 ? options.unitPerFt : 1;
  const kept: P[] = [];
  for (const p of pts) if (kept.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= MIN_TERMINAL_SPACING_FT * u - 1e-6)) kept.push(p);
  const final = kept.length ? kept : pts;
  return {
    points: final,
    rows, cols, spacingX, spacingY,
    throwLengthFt: areaSum > 0 ? throwSum / areaSum : 0,
    minSpacingFt: final.length > 1 ? minPair(final) : Infinity,
    minWallDistanceFt: wallMin === Infinity ? 0 : wallMin
  };
}

/**
 * Supply coverage: the largest distance from an occupied point (inside the polygon, >= `wallOffsetFt` from the walls -
 * the ASHRAE 55 / ADPI occupied zone) to the nearest supply terminal. Used for the "<= ~1.5 x T50" rule.
 */
export function maxDistanceToNearestTerminal(
  polygon: number[],
  terminals: { x: number; y: number }[],
  opts: { stepFt?: number; wallOffsetFt?: number; unitPerFt?: number } = {}
): number {
  if (terminals.length === 0 || polygon.length < 6) return Infinity;
  const u = opts.unitPerFt && opts.unitPerFt > 0 ? opts.unitPerFt : 1;
  const b = getPolygonBounds(polygon);
  const step = (opts.stepFt ?? Math.max(1, Math.max(b.width, b.height) / (60 * u))) * (opts.stepFt ? u : 1);
  const off = (opts.wallOffsetFt ?? 2) * u;
  const samples: P[] = [];
  for (let x = b.minX + step / 2; x < b.maxX; x += step)
    for (let y = b.minY + step / 2; y < b.maxY; y += step)
      if (isPointInPolygon(x, y, polygon) && distanceToPolygonEdge(x, y, polygon) >= off) samples.push({ x, y });
  if (samples.length === 0) {
    for (let x = b.minX + step / 2; x < b.maxX; x += step)
      for (let y = b.minY + step / 2; y < b.maxY; y += step)
        if (isPointInPolygon(x, y, polygon)) samples.push({ x, y });
  }
  let worst = 0;
  for (const s of samples) {
    let m = Infinity;
    for (const t of terminals) m = Math.min(m, Math.hypot(s.x - t.x, s.y - t.y));
    if (m > worst) worst = m;
  }
  return worst / u;
}
