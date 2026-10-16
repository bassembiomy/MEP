// Pure geometry helpers for the CAD canvas (no React / Konva). All sizes are canvas px.
// k = pixels per foot = pxPerFt(project.scale, project.units).
import { MM_PER_IN } from '../engine/units';

export const DEFAULT_ZOOM_MIN = 0.001;
export const DEFAULT_ZOOM_MAX = 200;
export const clampZoom = (z: number): number => Math.min(DEFAULT_ZOOM_MAX, Math.max(DEFAULT_ZOOM_MIN, z));

// ───────────────────────── Physical sizes ─────────────────────────

/** Inches -> px at k px/ft. */
export const inchesToPx = (inches: number, k: number): number => (inches / 12) * k;

/** Half width (px) of a duct of nominal width `widthIn` inches. Single source of truth for all duct drawing. */
export function ductHalfWidthPx(widthIn: number, k: number): number {
  return (Math.max(0, widthIn || 0) / 24) * k;
}

/** T50 throw radius (px) from feet. */
export const throwRadiusPx = (t50Ft: number, k: number): number => Math.max(0, t50Ft || 0) * k;

/**
 * Parse a terminal size label ("24x24", `24"X12"`, "600x600", "600 x 300 mm", "10" round) to inches.
 * Unitless numbers >= 100 are treated as millimetres, otherwise inches; explicit "mm" / `"` / "in" win.
 */
export function parseTerminalSizeIn(
  size: string | undefined | null,
  _units?: string
): { w: number; h: number } | null {
  if (!size) return null;
  const s = String(size).trim();
  let a: number;
  let b: number;
  let unit = '';
  const m = s.match(/(\d+(?:\.\d+)?)\s*(mm|in|"|”|'')?\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*(mm|in|"|”|'')?/);
  if (m) {
    a = parseFloat(m[1]);
    b = parseFloat(m[3]);
    unit = (m[4] || m[2] || '').toLowerCase();
  } else {
    const r = s.match(/(\d+(?:\.\d+)?)\s*(mm|in|"|”)?/);
    if (!r) return null;
    a = b = parseFloat(r[1]);
    unit = (r[2] || '').toLowerCase();
  }
  if (!(a > 0 && b > 0)) return null;
  const isMm = unit === 'mm' ? true : unit ? false : Math.max(a, b) >= 100;
  const f = isMm ? 1 / MM_PER_IN : 1;
  return { w: a * f, h: b * f };
}

export interface TerminalLike {
  size?: string;
  type?: string;
  faceWidthIn?: number;
  faceHeightIn?: number;
}

/** Face size in inches: explicit numeric fields, else parsed `size`, else a type default. */
export function terminalFaceIn(d: TerminalLike, units?: string): { w: number; h: number } {
  if (d.faceWidthIn && d.faceWidthIn > 0) {
    return { w: d.faceWidthIn, h: d.faceHeightIn && d.faceHeightIn > 0 ? d.faceHeightIn : d.faceWidthIn };
  }
  const p = parseTerminalSizeIn(d.size, units);
  if (p) return p;
  return d.type === 'return' ? { w: 24, h: 12 } : { w: 24, h: 24 };
}

export function terminalFacePx(d: TerminalLike, k: number, units?: string): { w: number; h: number } {
  const f = terminalFaceIn(d, units);
  return { w: inchesToPx(f.w, k), h: inchesToPx(f.h, k) };
}

/** Human size label, e.g. `24"X24"` (imperial) or `600X600` (metric). */
export function terminalSizeLabel(d: TerminalLike, units?: string): string {
  const f = terminalFaceIn(d, units);
  if (units === 'metric') return `${Math.round(f.w * MM_PER_IN)}X${Math.round(f.h * MM_PER_IN)}`;
  const r = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
  return `${r(f.w)}"X${r(f.h)}"`;
}

export type UnitKind = 'ducted' | 'cassette' | 'highwall' | 'rtu' | 'ahu' | 'odu';

/** Realistic plan footprints (inches) used when no catalog dimensions exist. */
export const DEFAULT_UNIT_FOOTPRINT_IN: Record<UnitKind, { w: number; d: number }> = {
  ducted: { w: 40, d: 24 },
  cassette: { w: 33, d: 33 },
  highwall: { w: 32, d: 9 },
  rtu: { w: 90, d: 50 },
  ahu: { w: 72, d: 36 },
  odu: { w: 34, d: 13 }
};

export function unitKindForSystem(systemType?: string): UnitKind {
  switch (systemType) {
    case 'cassette': return 'cassette';
    case 'high-wall': return 'highwall';
    case 'packaged': return 'rtu';
    case 'ahu': return 'ahu';
    default: return 'ducted';
  }
}

export function unitFootprintPx(
  kind: UnitKind,
  k: number,
  catalogDims?: { width?: number; depth?: number } | null
): { w: number; d: number } {
  const def = DEFAULT_UNIT_FOOTPRINT_IN[kind];
  const w = catalogDims?.width && catalogDims.width > 0 ? catalogDims.width : def.w;
  const d = catalogDims?.depth && catalogDims.depth > 0 ? catalogDims.depth : def.d;
  return { w: inchesToPx(w, k), d: inchesToPx(d, k) };
}

/** 45° hatch segments clipped to a w×h rectangle centred on the origin: [x1,y1,x2,y2][]. */
export function hatchSegments(w: number, h: number, spacing: number): number[][] {
  const out: number[][] = [];
  if (!(spacing > 0)) return out;
  const hw = w / 2;
  const hh = h / 2;
  for (let c = -(hw + hh) + spacing / 2; c < hw + hh; c += spacing) {
    const lo = Math.max(-hw, c - hh);
    const hi = Math.min(hw, c + hh);
    if (hi - lo > 1e-9) out.push([lo, lo - c, hi, hi - c]);
  }
  return out;
}

// ───────────────────────── Grid / snapping ─────────────────────────

/** Grid step in px: 1 ft (imperial) or 0.25 m (metric). `scale` = px per project unit (ft or m). */
export function gridStepPx(scale: number, units: string | undefined): number {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 10;
  return units === 'metric' ? 0.25 * s : s;
}
export const gridSnap = (v: number, step: number): number => (step > 0 ? Math.round(v / step) * step : v);

export interface SnapPoint { x: number; y: number; kind: 'end' | 'mid' | 'center'; layer?: string }
export interface SnapIndex { cell: number; buckets: Map<string, SnapPoint[]>; count: number }
export interface SnapEntity {
  type: string;
  points?: number[];
  x?: number;
  y?: number;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  layer?: string;
}

const cellKey = (cx: number, cy: number) => `${cx},${cy}`;

function addSnap(index: SnapIndex, p: SnapPoint) {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
  const key = cellKey(Math.floor(p.x / index.cell), Math.floor(p.y / index.cell));
  let b = index.buckets.get(key);
  if (!b) { b = []; index.buckets.set(key, b); }
  b.push(p);
  index.count++;
}

/** Build a spatial hash of snappable vertices/endpoints/midpoints/centres. Built once per DXF. */
export function buildSnapIndex(entities: SnapEntity[], cell: number, maxPoints = 500000): SnapIndex {
  const index: SnapIndex = { cell: cell > 0 ? cell : 10, buckets: new Map(), count: 0 };
  for (const e of entities) {
    if (index.count >= maxPoints) break;
    const layer = e.layer;
    if (e.type === 'LINE') {
      const x1 = e.x ?? 0, y1 = e.y ?? 0;
      const x2 = e.points?.[0] ?? 0, y2 = e.points?.[1] ?? 0;
      addSnap(index, { x: x1, y: y1, kind: 'end', layer });
      addSnap(index, { x: x2, y: y2, kind: 'end', layer });
      addSnap(index, { x: (x1 + x2) / 2, y: (y1 + y2) / 2, kind: 'mid', layer });
    } else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.points && e.points.length >= 4) {
      const p = e.points;
      for (let i = 0; i + 1 < p.length; i += 2) {
        addSnap(index, { x: p[i], y: p[i + 1], kind: 'end', layer });
        if (i + 3 < p.length) {
          addSnap(index, { x: (p[i] + p[i + 2]) / 2, y: (p[i + 1] + p[i + 3]) / 2, kind: 'mid', layer });
        }
      }
    } else if (e.type === 'CIRCLE' && typeof e.radius === 'number') {
      const cx = e.x ?? 0, cy = e.y ?? 0, r = e.radius;
      addSnap(index, { x: cx, y: cy, kind: 'center', layer });
      addSnap(index, { x: cx + r, y: cy, kind: 'end', layer });
      addSnap(index, { x: cx - r, y: cy, kind: 'end', layer });
      addSnap(index, { x: cx, y: cy + r, kind: 'end', layer });
      addSnap(index, { x: cx, y: cy - r, kind: 'end', layer });
    } else if (e.type === 'ARC' && typeof e.radius === 'number') {
      const cx = e.x ?? 0, cy = e.y ?? 0, r = e.radius;
      const s = ((e.startAngle ?? 0) * Math.PI) / 180;
      const en = ((e.endAngle ?? 360) * Math.PI) / 180;
      addSnap(index, { x: cx, y: cy, kind: 'center', layer });
      addSnap(index, { x: cx + r * Math.cos(s), y: cy + r * Math.sin(s), kind: 'end', layer });
      addSnap(index, { x: cx + r * Math.cos(en), y: cy + r * Math.sin(en), kind: 'end', layer });
      const m = (s + en) / 2;
      addSnap(index, { x: cx + r * Math.cos(m), y: cy + r * Math.sin(m), kind: 'mid', layer });
    }
  }
  return index;
}

/** Nearest indexed snap point within `radius` (world units); `accept` filters by layer. */
export function findNearestSnap(
  index: SnapIndex | null | undefined,
  x: number,
  y: number,
  radius: number,
  accept?: (layer: string | undefined) => boolean
): SnapPoint | null {
  if (!index || index.count === 0 || !(radius > 0)) return null;
  const c0x = Math.floor((x - radius) / index.cell), c1x = Math.floor((x + radius) / index.cell);
  const c0y = Math.floor((y - radius) / index.cell), c1y = Math.floor((y + radius) / index.cell);
  if ((c1x - c0x + 1) * (c1y - c0y + 1) > 2500) return null; // far zoom-out: skip rather than scan
  let best: SnapPoint | null = null;
  let bestD = radius * radius;
  for (let cx = c0x; cx <= c1x; cx++) {
    for (let cy = c0y; cy <= c1y; cy++) {
      const b = index.buckets.get(cellKey(cx, cy));
      if (!b) continue;
      for (const p of b) {
        if (accept && !accept(p.layer)) continue;
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bestD - 1e-12 || (best && Math.abs(d - bestD) <= 1e-12 && p.kind === 'end' && best.kind !== 'end')) {
          best = p;
          bestD = d;
        }
      }
    }
  }
  return best;
}

export interface SnapResult { x: number; y: number; kind: 'object' | 'grid' | 'none'; obj?: SnapPoint }

/** Object snap first (within radius), else grid snap; when disabled returns the raw point. */
export function resolveSnap(
  x: number,
  y: number,
  opts: { enabled: boolean; gridStep: number; index?: SnapIndex | null; radius: number; accept?: (layer: string | undefined) => boolean }
): SnapResult {
  if (!opts.enabled) return { x, y, kind: 'none' };
  const obj = findNearestSnap(opts.index, x, y, opts.radius, opts.accept);
  if (obj) return { x: obj.x, y: obj.y, kind: 'object', obj };
  return { x: gridSnap(x, opts.gridStep), y: gridSnap(y, opts.gridStep), kind: 'grid' };
}

// ───────────────────────── Polygon drawing ─────────────────────────

export function isNearFirstPoint(pts: number[], x: number, y: number, tolWorld: number): boolean {
  if (pts.length < 2) return false;
  return Math.hypot(pts[0] - x, pts[1] - y) <= tolWorld;
}

/** Remove trailing vertices that duplicate the previous vertex or the first vertex. */
export function dropTrailingDuplicate(pts: number[], eps = 1e-6): number[] {
  const out = pts.slice();
  while (out.length >= 4) {
    const n = out.length;
    const lx = out[n - 2], ly = out[n - 1];
    const dupPrev = Math.hypot(lx - out[n - 4], ly - out[n - 3]) <= eps;
    const dupFirst = n >= 6 && Math.hypot(lx - out[0], ly - out[1]) <= eps;
    if (dupPrev || dupFirst) out.length = n - 2;
    else break;
  }
  return out;
}

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return Math.abs(v) < 1e-9 ? 0 : v > 0 ? 1 : -1;
};
const onSeg = (ax: number, ay: number, bx: number, by: number, px: number, py: number) =>
  Math.min(ax, bx) - 1e-9 <= px && px <= Math.max(ax, bx) + 1e-9 &&
  Math.min(ay, by) - 1e-9 <= py && py <= Math.max(ay, by) + 1e-9;

/** Inclusive segment intersection (touching counts). */
export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number
): boolean {
  const o1 = orient(ax, ay, bx, by, cx, cy), o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay), o4 = orient(cx, cy, dx, dy, bx, by);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSeg(ax, ay, bx, by, cx, cy)) return true;
  if (o2 === 0 && onSeg(ax, ay, bx, by, dx, dy)) return true;
  if (o3 === 0 && onSeg(cx, cy, dx, dy, ax, ay)) return true;
  if (o4 === 0 && onSeg(cx, cy, dx, dy, bx, by)) return true;
  return false;
}

/** True if any two non-adjacent edges of the closed polygon intersect. */
export function polygonSelfIntersects(pts: number[]): boolean {
  const n = pts.length / 2;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = i, b = (i + 1) % n;
    for (let j = i + 1; j < n; j++) {
      const c = j, d = (j + 1) % n;
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // adjacent edges
      if (segmentsIntersect(
        pts[a * 2], pts[a * 2 + 1], pts[b * 2], pts[b * 2 + 1],
        pts[c * 2], pts[c * 2 + 1], pts[d * 2], pts[d * 2 + 1]
      )) return true;
    }
  }
  return false;
}

export function polygonArea(pts: number[]): number {
  let s = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  return s / 2;
}

export interface ClosePolygonResult { ok: boolean; points: number[]; message?: string }
/** Clean (drop trailing duplicate) and validate a polygon about to be closed. */
export function validateClosablePolygon(pts: number[]): ClosePolygonResult {
  const cleaned = dropTrailingDuplicate(pts);
  if (cleaned.length < 6) return { ok: false, points: cleaned, message: 'A zone needs at least 3 distinct points.' };
  if (Math.abs(polygonArea(cleaned)) < 1e-6) return { ok: false, points: cleaned, message: 'Zone has zero area.' };
  if (polygonSelfIntersects(cleaned)) {
    return { ok: false, points: cleaned, message: 'Zone outline crosses itself - adjust the last point.' };
  }
  return { ok: true, points: cleaned };
}

// ───────────────────────── View / fit ─────────────────────────

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export function unionBounds(list: Array<Bounds | null | undefined>): Bounds | null {
  let out: Bounds | null = null;
  for (const b of list) {
    if (!b || ![b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite)) continue;
    out = out
      ? {
          minX: Math.min(out.minX, b.minX), minY: Math.min(out.minY, b.minY),
          maxX: Math.max(out.maxX, b.maxX), maxY: Math.max(out.maxY, b.maxY)
        }
      : { ...b };
  }
  return out;
}
export function pointsBounds(pts: number[]): Bounds | null {
  if (pts.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}
export function fitBounds(b: Bounds, viewW: number, viewH: number, margin = 0.85): { scale: number; x: number; y: number } {
  const w = Math.max(1e-6, b.maxX - b.minX);
  const h = Math.max(1e-6, b.maxY - b.minY);
  const scale = clampZoom(Math.min(viewW / w, viewH / h) * margin);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  return { scale, x: viewW / 2 - cx * scale, y: viewH / 2 - cy * scale };
}

// ───────────────────────── DXF grouping ─────────────────────────

export interface GroupableEntity { layer?: string; color?: string; type: string }
/** Group drawable (non-text) entities by layer, then colour. */
export function groupByLayerColor<T extends GroupableEntity>(
  entities: T[],
  layerColor: (layer: string) => string | undefined,
  fallback = '#94a3b8'
): Map<string, Map<string, T[]>> {
  const out = new Map<string, Map<string, T[]>>();
  for (const e of entities) {
    if (e.type === 'TEXT' || e.type === 'MTEXT') continue;
    const layer = e.layer || '0';
    const color = e.color || layerColor(layer) || fallback;
    let byColor = out.get(layer);
    if (!byColor) { byColor = new Map(); out.set(layer, byColor); }
    let arr = byColor.get(color);
    if (!arr) { arr = []; byColor.set(color, arr); }
    arr.push(e);
  }
  return out;
}

// ───────────────────────── Duct outlines ─────────────────────────

export const REDUCER_ANGLE_DEG = 15;

/** Taper length (px) for a change between two FULL widths (px): (ΔW/2)/tan(15°). */
export function reducerTaperLength(wFullPx1: number, wFullPx2: number): number {
  return (Math.abs(wFullPx1 - wFullPx2) / 2) / Math.tan((REDUCER_ANGLE_DEG * Math.PI) / 180);
}

export interface DuctSegIn {
  id: string;
  type?: string;
  points: number[];
  widthIn: number;
  diameterIn?: number;
}
export interface DuctRunOutline {
  id: string;
  network: 'supply' | 'return';
  type: string;
  segIds: string[];
  /** Closed polygon (first point not repeated) of the whole run; use for fill. */
  outline: number[];
  /** Open wall polylines (with a gap at tee openings); use for stroke. */
  walls: number[][];
  /** End-cap / reducer joint ticks [x1,y1,x2,y2]. */
  ticks: number[][];
  /** Centreline polyline. */
  center: number[];
}

interface P2 { x: number; y: number }
interface Seg { id: string; type: string; a: number; b: number; hw: number }
interface Tok { x: number; y: number; gap?: [P2, P2] }
interface End { si: number; atA: boolean; dir: P2 } // dir points AWAY from the node

function lineIntersect(p: P2, d: P2, q: P2, e: P2): P2 | null {
  const cr = d.x * e.y - d.y * e.x;
  if (Math.abs(cr) < 1e-9) return null;
  const t = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / cr;
  return { x: p.x + d.x * t, y: p.y + d.y * t };
}
const normalOf = (d: P2): P2 => ({ x: -d.y, y: d.x });

/**
 * Build double-line duct run outlines: mitered elbows, tees (branch walls stop at the trunk wall, trunk wall
 * gets a gap), 15° tapered reducers where the width changes. Supply and return networks are independent.
 * Segment endpoints within `tol` px are the same node.
 */
export function buildDuctOutline(segments: DuctSegIn[], k: number, tol = 0.75): DuctRunOutline[] {
  const out: DuctRunOutline[] = [];
  for (const net of ['supply', 'return'] as const) {
    const list = segments.filter((s) => (s.type === 'return' ? 'return' : 'supply') === net);
    if (list.length) out.push(...buildNetwork(list, k, tol, net));
  }
  return out;
}

function buildNetwork(input: DuctSegIn[], k: number, tol: number, network: 'supply' | 'return'): DuctRunOutline[] {
  const nodes: P2[] = [];
  const nodeOf = (x: number, y: number): number => {
    for (let i = 0; i < nodes.length; i++) if (Math.hypot(nodes[i].x - x, nodes[i].y - y) <= tol) return i;
    nodes.push({ x, y });
    return nodes.length - 1;
  };
  let segs: Seg[] = [];
  for (const s of input) {
    const p = s.points;
    const hw = ductHalfWidthPx(s.widthIn || s.diameterIn || 0, k);
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) < 1e-6) continue;
      segs.push({
        id: p.length > 4 ? `${s.id}#${i / 2}` : s.id,
        type: s.type || 'branch',
        a: nodeOf(p[i], p[i + 1]),
        b: nodeOf(p[i + 2], p[i + 3]),
        hw
      });
    }
  }
  segs = segs.filter((s) => s.a !== s.b);

  // Split a segment where another segment's end lands on its interior (T-junction).
  for (let guard = 0; guard < 10000; guard++) {
    let did = false;
    outer: for (let si = 0; si < segs.length; si++) {
      const s = segs[si];
      const A = nodes[s.a], B = nodes[s.b];
      const L = Math.hypot(B.x - A.x, B.y - A.y);
      const ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
      for (let ni = 0; ni < nodes.length; ni++) {
        if (ni === s.a || ni === s.b) continue;
        const t = (nodes[ni].x - A.x) * ux + (nodes[ni].y - A.y) * uy;
        if (t <= tol || t >= L - tol) continue;
        if (Math.abs((nodes[ni].x - A.x) * uy - (nodes[ni].y - A.y) * ux) > tol) continue;
        if (!segs.some((o) => o !== s && (o.a === ni || o.b === ni))) continue;
        segs.splice(si, 1, { ...s, id: `${s.id}~a`, b: ni }, { ...s, id: `${s.id}~b`, a: ni });
        did = true;
        break outer;
      }
    }
    if (!did) break;
  }

  const segDir = (s: Seg): P2 => {
    const A = nodes[s.a], B = nodes[s.b];
    const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    return { x: (B.x - A.x) / L, y: (B.y - A.y) / L };
  };
  const segLen = (s: Seg) => Math.hypot(nodes[s.b].x - nodes[s.a].x, nodes[s.b].y - nodes[s.a].y);

  const incident: End[][] = nodes.map(() => []);
  segs.forEach((s, si) => {
    const d = segDir(s);
    incident[s.a].push({ si, atA: true, dir: d });
    incident[s.b].push({ si, atA: false, dir: { x: -d.x, y: -d.y } });
  });
  const ekey = (si: number, atA: boolean) => `${si}:${atA ? 'a' : 'b'}`;
  const partner = new Map<string, End>();
  const through = new Map<number, { dir: P2; hw: number }>();
  incident.forEach((list, ni) => {
    if (list.length === 2) {
      partner.set(ekey(list[0].si, list[0].atA), list[1]);
      partner.set(ekey(list[1].si, list[1].atA), list[0]);
    } else if (list.length >= 3) {
      let best: [End, End] | null = null;
      let bestW = -1;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const dot = list[i].dir.x * list[j].dir.x + list[i].dir.y * list[j].dir.y;
          if (dot > -0.99) continue;
          const w = segs[list[i].si].hw + segs[list[j].si].hw;
          if (w > bestW) { bestW = w; best = [list[i], list[j]]; }
        }
      }
      if (best) {
        partner.set(ekey(best[0].si, best[0].atA), best[1]);
        partner.set(ekey(best[1].si, best[1].atA), best[0]);
        through.set(ni, { dir: best[0].dir, hw: Math.min(segs[best[0].si].hw, segs[best[1].si].hw) });
      }
    }
  });

  // Walk segments into runs through paired ends.
  interface Item { si: number; fwd: boolean }
  const visited = new Set<number>();
  const runs: Item[][] = [];
  const walk = (si: number, fwd: boolean) => {
    const items: Item[] = [];
    let cur = si, f = fwd;
    for (;;) {
      visited.add(cur);
      items.push({ si: cur, fwd: f });
      const p = partner.get(ekey(cur, !f)); // far end: b-end when traversing forward
      if (!p || visited.has(p.si)) break;
      cur = p.si;
      f = p.atA; // entered at its a-end => traverse forward
    }
    runs.push(items);
  };
  segs.forEach((_, si) => {
    if (visited.has(si)) return;
    if (!partner.has(ekey(si, true))) walk(si, true);
    else if (!partner.has(ekey(si, false))) walk(si, false);
  });
  segs.forEach((_, si) => { if (!visited.has(si)) walk(si, true); });

  const tan15 = Math.tan((REDUCER_ANGLE_DEG * Math.PI) / 180);
  const result: DuctRunOutline[] = [];

  for (const items of runs) {
    const nid: number[] = [];
    const sg: Seg[] = [];
    const dirs: P2[] = [];
    items.forEach((it, i) => {
      const s = segs[it.si];
      const from = it.fwd ? s.a : s.b, to = it.fwd ? s.b : s.a;
      if (i === 0) nid.push(from);
      nid.push(to);
      sg.push(s);
      const A = nodes[from], B = nodes[to];
      const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      dirs.push({ x: (B.x - A.x) / L, y: (B.y - A.y) / L });
    });
    const n = sg.length;
    const ticks: number[][] = [];
    let startJoined = false, endJoined = false;

    // Wall point where a run END butts into a trunk (tee): branch wall line ∩ trunk wall line.
    const branchEnd = (j: number, sgn: number): P2 | null => {
      const th = through.get(nid[j]);
      if (!th) return null;
      const P = nodes[nid[j]];
      const seg = j === 0 ? 0 : n - 1;
      const d = dirs[seg];
      const hw = sg[seg].hw;
      const nb = normalOf(d);
      const nt = normalOf(th.dir);
      const away = j === 0 ? d : { x: -d.x, y: -d.y };
      const dd = away.x * nt.x + away.y * nt.y;
      if (Math.abs(dd) < 1e-6) return null;
      const sigma = dd > 0 ? 1 : -1;
      return lineIntersect(
        { x: P.x + nb.x * hw * sgn, y: P.y + nb.y * hw * sgn }, d,
        { x: P.x + nt.x * th.hw * sigma, y: P.y + nt.y * th.hw * sigma }, th.dir
      );
    };

    const side = (sgn: number): Tok[] => {
      const toks: Tok[] = [];
      for (let j = 0; j <= n; j++) {
        const P = nodes[nid[j]];
        if (j === 0 || j === n) {
          const seg = j === 0 ? 0 : n - 1;
          const nn = normalOf(dirs[seg]);
          const hw = sg[seg].hw;
          const be = branchEnd(j, sgn);
          if (be) {
            toks.push({ x: be.x, y: be.y });
            if (j === 0) startJoined = true; else endJoined = true;
          } else {
            toks.push({ x: P.x + nn.x * hw * sgn, y: P.y + nn.y * hw * sgn });
          }
          continue;
        }
        const dA = dirs[j - 1], dB = dirs[j];
        const nA = normalOf(dA), nB = normalOf(dB);
        const hA = sg[j - 1].hw, hB = sg[j].hw;
        const cr = dA.x * dB.y - dA.y * dB.x;
        const dot = dA.x * dB.x + dA.y * dB.y;
        if (Math.abs(cr) < 1e-3 && dot > 0) {
          // straight-through node: reducer and/or tee
          const pts: Tok[] = [];
          const hs = Math.min(hA, hB);
          const nodeTok: Tok = { x: P.x + nA.x * hs * sgn, y: P.y + nA.y * hs * sgn };
          if (Math.abs(hA - hB) < 1e-6) {
            pts.push(nodeTok);
          } else {
            const L = Math.abs(hA - hB) / tan15;
            if (hA > hB) {
              const Lc = Math.min(L, 0.48 * segLen(sg[j - 1]));
              pts.push({ x: P.x - dA.x * Lc + nA.x * hA * sgn, y: P.y - dA.y * Lc + nA.y * hA * sgn });
              pts.push(nodeTok);
              if (sgn === 1) ticks.push([P.x - dA.x * Lc + nA.x * hA, P.y - dA.y * Lc + nA.y * hA, P.x - dA.x * Lc - nA.x * hA, P.y - dA.y * Lc - nA.y * hA]);
            } else {
              const Lc = Math.min(L, 0.48 * segLen(sg[j]));
              pts.push(nodeTok);
              pts.push({ x: P.x + dB.x * Lc + nB.x * hB * sgn, y: P.y + dB.y * Lc + nB.y * hB * sgn });
              if (sgn === 1) ticks.push([P.x + dB.x * Lc + nB.x * hB, P.y + dB.y * Lc + nB.y * hB, P.x + dB.x * Lc - nB.x * hB, P.y + dB.y * Lc - nB.y * hB]);
            }
          }
          if (through.has(nid[j])) {
            for (const e of incident[nid[j]]) {
              if (partner.has(ekey(e.si, e.atA))) continue; // trunk pair itself
              const b = e.dir;
              if ((b.x * nA.x + b.y * nA.y) * sgn <= 1e-6) continue; // branch on other wall
              const nb = normalOf(b);
              const hb = segs[e.si].hw;
              const trunkPt = { x: P.x + nA.x * sgn * hs, y: P.y + nA.y * sgn * hs };
              const g1 = lineIntersect({ x: P.x + nb.x * hb, y: P.y + nb.y * hb }, b, trunkPt, dA);
              const g2 = lineIntersect({ x: P.x - nb.x * hb, y: P.y - nb.y * hb }, b, trunkPt, dA);
              if (g1 && g2) {
                const t1 = (g1.x - P.x) * dA.x + (g1.y - P.y) * dA.y;
                const t2 = (g2.x - P.x) * dA.x + (g2.y - P.y) * dA.y;
                nodeTok.gap = t1 <= t2 ? [g1, g2] : [g2, g1];
              }
            }
          }
          toks.push(...pts);
        } else {
          // elbow: mitered square-throat joint
          const oA = { x: P.x + nA.x * hA * sgn, y: P.y + nA.y * hA * sgn };
          const oB = { x: P.x + nB.x * hB * sgn, y: P.y + nB.y * hB * sgn };
          const M = Math.abs(cr) < 1e-6 ? null : lineIntersect(oA, dA, oB, dB);
          if (M && Math.hypot(M.x - P.x, M.y - P.y) <= 6 * Math.max(hA, hB, 1e-6)) toks.push({ x: M.x, y: M.y });
          else toks.push({ x: oA.x, y: oA.y }, { x: oB.x, y: oB.y });
        }
      }
      return toks;
    };

    const left = side(1);
    const right = side(-1);

    const outline: number[] = [];
    left.forEach((t) => outline.push(t.x, t.y));
    for (let i = right.length - 1; i >= 0; i--) outline.push(right[i].x, right[i].y);

    const walls: number[][] = [];
    for (const toks of [left, right]) {
      let cur: number[] = [];
      for (const t of toks) {
        if (t.gap) {
          cur.push(t.gap[0].x, t.gap[0].y);
          if (cur.length >= 4) walls.push(cur);
          cur = [t.gap[1].x, t.gap[1].y];
        } else cur.push(t.x, t.y);
      }
      if (cur.length >= 4) walls.push(cur);
    }

    if (!startJoined) ticks.push([left[0].x, left[0].y, right[0].x, right[0].y]);
    if (!endJoined) {
      const l = left[left.length - 1], r = right[right.length - 1];
      ticks.push([l.x, l.y, r.x, r.y]);
    }

    const center: number[] = [];
    nid.forEach((i) => center.push(nodes[i].x, nodes[i].y));
    result.push({ id: sg[0].id, network, type: sg[0].type, segIds: sg.map((s) => s.id), outline, walls, ticks, center });
  }
  return result;
}
