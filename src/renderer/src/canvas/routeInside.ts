// Orthogonal routing that never leaves a room polygon (pure, no React / Konva).
import { pointInPolygon, polygonClearance, polylineHitsRect, simplifyOrthogonal, type RouteRect } from './drawingGeometry';

type Pt = { x: number; y: number };

/** True when every point of the polyline lies inside the polygon or on its walls (tolerance `tol` px). */
export function pathInsidePolygon(pts: number[], polygon: number[], tol = 0.05, step = 0.25): boolean {
  if (polygon.length < 6) return true;
  const ok = (x: number, y: number): boolean => pointInPolygon(polygon, x, y) || polygonClearance(polygon, x, y) >= -tol;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const dx = pts[i + 2] - pts[i], dy = pts[i + 3] - pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(step, 1e-6)));
    for (let j = 0; j <= n; j++) if (!ok(pts[i] + (dx * j) / n, pts[i + 1] + (dy * j) / n)) return false;
  }
  return true;
}

/**
 * Orthogonal route from `from` to `to` that never leaves `polygon` (walls allowed) and keeps 0.4 k clear of `obstacles`
 * (boxes holding an end point are ignored). Falls back to an obstacle-free in-room route; null when none exists.
 */
export function routeInsidePolygon(from: Pt, to: Pt, polygon: number[], obstacles: RouteRect[], k: number): number[] | null {
  const r = gridRouteInside(from, to, polygon, obstacles, 0.4 * k, k);
  if (r) return r;
  return obstacles.length ? gridRouteInside(from, to, polygon, [], 0, k) : null;
}

function gridRouteInside(from: Pt, to: Pt, polygon: number[], obstacles: RouteRect[], clr: number, k: number): number[] | null {
  if (polygon.length < 6) return null;
  const tol = 0.05 * k;
  const inside = (x: number, y: number): boolean => pointInPolygon(polygon, x, y) || polygonClearance(polygon, x, y) >= -tol;
  const strictIn = (r: RouteRect, x: number, y: number): boolean =>
    x > r.x + 1e-6 && x < r.x + r.w - 1e-6 && y > r.y + 1e-6 && y < r.y + r.h - 1e-6;
  const boxes = obstacles
    .map((r) => ({ x: r.x - clr, y: r.y - clr, w: r.w + 2 * clr, h: r.h + 2 * clr }))
    .filter((r) => !strictIn(r, from.x, from.y) && !strictIn(r, to.x, to.y));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < polygon.length; i += 2) {
    minX = Math.min(minX, polygon[i]); maxX = Math.max(maxX, polygon[i]);
    minY = Math.min(minY, polygon[i + 1]); maxY = Math.max(maxY, polygon[i + 1]);
  }
  const near = boxes.filter((r) => r.x < maxX && r.x + r.w > minX && r.y < maxY && r.y + r.h > minY);
  const uniq = (v: number[]): number[] => {
    const s = v.filter(Number.isFinite).sort((a, b) => a - b);
    const o: number[] = [];
    for (const x of s) if (!o.length || x - o[o.length - 1] > 1e-6) o.push(x);
    return o;
  };
  const xsRaw = [from.x, to.x], ysRaw = [from.y, to.y];
  for (let i = 0; i + 1 < polygon.length; i += 2) { xsRaw.push(polygon[i]); ysRaw.push(polygon[i + 1]); }
  for (const f of [0.25, 0.5, 0.75]) { xsRaw.push(minX + (maxX - minX) * f); ysRaw.push(minY + (maxY - minY) * f); }
  for (const r of near) { xsRaw.push(r.x, r.x + r.w); ysRaw.push(r.y, r.y + r.h); }
  const xs = uniq(xsRaw), ys = uniq(ysRaw);
  const nx = xs.length, ny = ys.length;
  if (nx * ny > 40000) return null;
  const idx = (i: number, j: number): number => j * nx + i;
  const nodeOk = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    nodeOk[idx(i, j)] = inside(xs[i], ys[j]) && !near.some((r) => strictIn(r, xs[i], ys[j])) ? 1 : 0;
  }
  const edgeOk = (x0: number, y0: number, x1: number, y1: number): boolean => {
    if (!inside((x0 + x1) / 2, (y0 + y1) / 2)) return false;
    const seg = [x0, y0, x1, y1];
    for (const r of near) if (polylineHitsRect(seg, r)) return false;
    return true;
  };
  const fi = xs.findIndex((x) => Math.abs(x - from.x) < 1e-6), fj = ys.findIndex((y) => Math.abs(y - from.y) < 1e-6);
  const ti = xs.findIndex((x) => Math.abs(x - to.x) < 1e-6), tj = ys.findIndex((y) => Math.abs(y - to.y) < 1e-6);
  if (fi < 0 || fj < 0 || ti < 0 || tj < 0) return null;
  nodeOk[idx(fi, fj)] = 1;
  nodeOk[idx(ti, tj)] = 1;
  const bendCost = 1.5 * k;
  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
  const N = nx * ny * 5; // state = node * 5 + dir (4 = start)
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const heap: Array<[number, number]> = [];
  const push = (c: number, st: number): void => {
    heap.push([c, st]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop() as [number, number];
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const s0 = idx(fi, fj) * 5 + 4;
  dist[s0] = 0;
  push(0, s0);
  let goal = -1;
  while (heap.length) {
    const [c, st] = pop();
    if (c > dist[st] + 1e-9) continue;
    const node = Math.floor(st / 5), dir = st % 5;
    const i = node % nx, j = (node - i) / nx;
    if (i === ti && j === tj) { goal = st; break; }
    for (let d = 0; d < 4; d++) {
      const ni = i + DX[d], nj = j + DY[d];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny || !nodeOk[idx(ni, nj)]) continue;
      if (!edgeOk(xs[i], ys[j], xs[ni], ys[nj])) continue;
      const nc = c + Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]) + (dir !== 4 && dir !== d ? bendCost : 0);
      const ns = idx(ni, nj) * 5 + d;
      if (nc < dist[ns] - 1e-9) { dist[ns] = nc; prev[ns] = st; push(nc, ns); }
    }
  }
  if (goal < 0) return null;
  const rev: number[] = [];
  for (let st = goal; st >= 0; st = prev[st]) {
    const node = Math.floor(st / 5);
    const i = node % nx, j = (node - i) / nx;
    rev.push(xs[i], ys[j]);
  }
  const pts: number[] = [];
  for (let n = rev.length - 2; n >= 0; n -= 2) pts.push(rev[n], rev[n + 1]);
  return simplifyOrthogonal(pts);
}
