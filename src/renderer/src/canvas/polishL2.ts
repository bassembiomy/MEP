// Canvas polish L2 (pure, no React / Konva): plant connection, system-type callout labels, label priorities, level of
// detail, chilled-water stubs, condensate routing to drain points and canvas-local drain point persistence.
import { polygonClearance, routeManhattan, RouteRect, simplifyOrthogonal } from './drawingGeometry';
import { routeInsidePolygon } from './routeInside';
import { condensateRoute } from './shopDrawing';

export type Pt = { x: number; y: number };

// ───────────────────────── Plant connection ─────────────────────────

export type PlantConnection = 'refrigerant' | 'chilled-water' | 'self-contained';

/** Optional fields another module may add to a zone / terminal; every one of them may be absent. */
export interface ZonePolishFields {
  systemType?: string;
  plantConnection?: string;
  chwStubs?: Array<{ unitIndex: number; x: number; y: number; side?: string }>;
  outdoorAirCfm?: number;
  outdoorModel?: string;
  returnStrategy?: string;
  diffusers?: Array<{ type?: string; returnPath?: string }>;
}

const CHW_SYSTEMS = new Set(['ahu', 'chiller', 'fcu-chw']);
const SELF_CONTAINED_SYSTEMS = new Set(['rtu', 'package', 'packaged']);
const PLANT_VALUES: PlantConnection[] = ['refrigerant', 'chilled-water', 'self-contained'];

/** Explicit zone.plantConnection wins; otherwise derived from the system type (AHU / chiller / CHW FCU -> chilled water). */
export function plantConnectionOf(zone: { systemType?: string; plantConnection?: string }): PlantConnection {
  const explicit = zone.plantConnection as PlantConnection | undefined;
  if (explicit && PLANT_VALUES.includes(explicit)) return explicit;
  const t = zone.systemType ?? '';
  if (CHW_SYSTEMS.has(t)) return 'chilled-water';
  if (SELF_CONTAINED_SYSTEMS.has(t)) return 'self-contained';
  return 'refrigerant';
}

/** Condensing units + refrigerant lines are drawn only for refrigerant plants. */
export const hasRefrigerantPlant = (zone: { systemType?: string; plantConnection?: string }): boolean =>
  plantConnectionOf(zone) === 'refrigerant';

/** Plenum return: explicit strategy, or any return terminal tagged returnPath 'plenum'. */
export function isPlenumReturnZone(zone: object): boolean {
  const z = zone as ZonePolishFields;
  if (z.returnStrategy === 'plenum') return true;
  return !!z.diffusers?.some((d) => d.type === 'return' && d.returnPath === 'plenum');
}

// ───────────────────────── Callout text ─────────────────────────

const SYSTEM_LABELS: Record<string, string> = {
  concealed: 'CONCEALED SPLIT',
  cassette: 'CASSETTE SPLIT',
  'high-wall': 'HIGH WALL SPLIT',
  packaged: 'PACKAGE UNIT',
  package: 'PACKAGE UNIT',
  rtu: 'ROOFTOP UNIT (RTU)',
  ahu: 'CENTRAL AHU',
  fcu: 'DUCTED FCU',
  'fcu-chw': 'CHW FAN COIL UNIT',
  chiller: 'CHILLER PLANT',
  vrf: 'VRF INDOOR UNITS'
};

/** Callout headline for a system type: "2-CASSETTE SPLIT"; VRF adds the ODU model line when known. */
export function systemCalloutLines(systemType: string | undefined, qty: number, outdoorModel?: string): string[] {
  const t = systemType ?? 'concealed';
  const label = SYSTEM_LABELS[t] ?? t.replace(/[-_]/g, ' ').toUpperCase();
  const head = `${qty}-${label}`;
  if (t === 'vrf') {
    const m = (outdoorModel ?? '').trim();
    return m ? [head, `ODU ${m}`] : [head];
  }
  return [head];
}

/** Fresh-air callout line from the design outdoor airflow; null (line hidden) when the zone carries no value. */
export function freshAirLine(outdoorAirCfm: number | undefined, format: (cfm: number) => string): string | null {
  if (outdoorAirCfm === undefined || !Number.isFinite(outdoorAirCfm) || outdoorAirCfm <= 0) return null;
  return `FA ${format(Math.round(outdoorAirCfm))}`;
}

// ───────────────────────── Label priorities + level of detail ─────────────────────────

/** Placement order (higher first): zone label and duct badges are placed before the callout so it avoids them. */
export const LABEL_PRIORITY = {
  zone: 95,
  ductBadge: 92,
  callout: 90,
  warning: 80,
  plenumNote: 70,
  terminal: 30,
  pipe: 22,
  condensate: 21,
  chw: 23,
  duct: 20,
  damper: 15,
  panel: 14
} as const;

export type LabelLod = 'overview' | 'detail';

/** Median distance from each terminal to its nearest neighbour (world px); Infinity for < 2 terminals. */
export function medianNeighbourGap(pts: Pt[]): number {
  if (pts.length < 2) return Infinity;
  const gaps = pts.map((p, i) => {
    let m = Infinity;
    pts.forEach((q, j) => { if (i !== j) m = Math.min(m, Math.hypot(p.x - q.x, p.y - q.y)); });
    return m;
  }).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

export const OVERVIEW_GAP_PX = 56;
export const OVERVIEW_GAP_SELECTED_PX = 28;
export const OVERVIEW_ZONE_PX = 90;

/**
 * Level of detail of a zone's annotations. 'overview' (equipment tags + zone label only) when the typical spacing of its
 * terminals on screen is below what a tag needs, or the whole zone is tiny on screen; terminal tags reappear on zoom-in.
 * The selected zone gets a laxer threshold.
 */
export function labelLodFor(opts: { scale: number; medianGapWorld: number; zoneMaxDimWorld: number; selected?: boolean }): LabelLod {
  const thr = opts.selected ? OVERVIEW_GAP_SELECTED_PX : OVERVIEW_GAP_PX;
  if (opts.zoneMaxDimWorld * opts.scale < OVERVIEW_ZONE_PX && !opts.selected) return 'overview';
  return opts.medianGapWorld * opts.scale < thr ? 'overview' : 'detail';
}

// ───────────────────────── Geometry helpers ─────────────────────────

function nearestOnPolygon(p: Pt, polygon: number[]): { q: Pt; d: number } | null {
  const n = polygon.length / 2;
  let best: { q: Pt; d: number } | null = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = polygon[i * 2], ay = polygon[i * 2 + 1], bx = polygon[j * 2], by = polygon[j * 2 + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2));
    const q = { x: ax + dx * t, y: ay + dy * t };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || d < best.d - 1e-9) best = { q, d };
  }
  return best;
}

/** Point `dist` along a polyline from its start, with the unit direction of the segment it falls on. */
export function pointAlong(pts: number[], dist: number): { x: number; y: number; ux: number; uy: number } {
  let rem = Math.max(0, dist);
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const dx = pts[i + 2] - pts[i], dy = pts[i + 3] - pts[i + 1];
    const l = Math.hypot(dx, dy);
    if (l < 1e-12) continue;
    if (rem <= l) return { x: pts[i] + (dx / l) * rem, y: pts[i + 1] + (dy / l) * rem, ux: dx / l, uy: dy / l };
    rem -= l;
  }
  const n = pts.length;
  if (n >= 4) {
    const dx = pts[n - 2] - pts[n - 4], dy = pts[n - 1] - pts[n - 3];
    const l = Math.hypot(dx, dy) || 1;
    return { x: pts[n - 2], y: pts[n - 1], ux: dx / l, uy: dy / l };
  }
  return { x: pts[0] ?? 0, y: pts[1] ?? 0, ux: 1, uy: 0 };
}

const pathLength = (pts: number[]): number => {
  let l = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) l += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  return l;
};

/** True when every segment of the polyline is horizontal or vertical. */
export function isOrthogonalPath(pts: number[], eps = 1e-6): boolean {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    if (Math.abs(pts[i + 2] - pts[i]) > eps && Math.abs(pts[i + 3] - pts[i + 1]) > eps) return false;
  }
  return true;
}

// ───────────────────────── Chilled-water stubs ─────────────────────────

export interface ChwRoute {
  uIdx: number;
  /** Centreline [x0,y0,...] from the unit centre to the stub (or nearest wall); supply / return are drawn offset ± from it. */
  points: number[];
  fromStub: boolean;
  /** Valve positions on the centreline (drawn for both pipes) with the travel direction. */
  valves: Array<{ x: number; y: number; ux: number; uy: number }>;
  /** Midpoint of the longest leg, used as the label anchor. */
  labelAt: Pt;
}

/** Minimum length (ft) of a chilled-water stub visible beyond the unit footprint. */
export const CHW_STUB_MIN_FT = 2;

/** Distance along the polyline (from the unit centre) at which it leaves the unit footprint rectangle. */
export function footprintExitDistance(pts: number[], fp: { w: number; d: number }, k: number): number {
  const total = pathLength(pts);
  const step = Math.max(0.02 * k, 1e-3);
  const hw = fp.w / 2 + 1e-6, hd = fp.d / 2 + 1e-6;
  const cx = pts[0], cy = pts[1];
  for (let d = 0; d <= total; d += step) {
    const q = pointAlong(pts, d);
    if (Math.abs(q.x - cx) > hw || Math.abs(q.y - cy) > hd) return d;
  }
  return total;
}

/**
 * Pushes the free end of a stub outward (along its last leg) until at least `minFt` of pipe shows beyond the unit
 * footprint, so the stub is never hidden under the unit symbol.
 */
export function extendStubBeyondUnit(pts: number[], fp: { w: number; d: number }, k: number, minFt = CHW_STUB_MIN_FT): number[] {
  const need = minFt * k;
  let out = pts.slice();
  for (let pass = 0; pass < 8; pass++) {
    const vis = pathLength(out) - footprintExitDistance(out, fp, k);
    if (vis >= need - 1e-9) break;
    const n = out.length;
    let dx = out[n - 2] - out[n - 4], dy = out[n - 1] - out[n - 3];
    let l = Math.hypot(dx, dy);
    if (l < 1e-9) { dx = 1; dy = 0; l = 1; }
    const add = need - Math.max(0, vis);
    out[n - 2] += (dx / l) * add;
    out[n - 1] += (dy / l) * add;
    out = simplifyOrthogonal(out);
  }
  return out;
}

export const CHW_SUPPLY_TEXT = 'CHWS';
export const CHW_RETURN_TEXT = 'CHWR';

/**
 * Chilled-water supply / return stub for an indoor unit: an orthogonal line from the unit to its `chwStubs` entry, or to
 * the nearest wall when the zone carries none. Two valves sit just outside the unit.
 */
export function chwRoute(
  unit: Pt,
  fp: { w: number; d: number },
  k: number,
  polygon: number[],
  uIdx: number,
  stub?: { x: number; y: number }
): ChwRoute | null {
  let target: Pt | null = stub && Number.isFinite(stub.x) && Number.isFinite(stub.y) ? { x: stub.x, y: stub.y } : null;
  const fromStub = !!target;
  if (!target) {
    const n = nearestOnPolygon(unit, polygon);
    target = n ? n.q : { x: unit.x + fp.w / 2 + 3 * k, y: unit.y };
  }
  const r = routeManhattan(unit, target, [], { maxBends: 3 });
  let points = simplifyOrthogonal(r.points);
  if (points.length < 4) {
    // degenerate (stub sits on the unit centre): head for the nearest wall, else straight out to the right
    const n = nearestOnPolygon(unit, polygon);
    const t = n && Math.hypot(n.q.x - unit.x, n.q.y - unit.y) > 1e-6 ? n.q : { x: unit.x + fp.w / 2 + 3 * k, y: unit.y };
    points = simplifyOrthogonal(routeManhattan(unit, t, [], { maxBends: 3 }).points);
  }
  if (points.length < 4) return null;
  points = extendStubBeyondUnit(points, fp, k);
  const total = pathLength(points);
  const exit = footprintExitDistance(points, fp, k);
  const vis = Math.max(0, total - exit);
  const v0 = exit + Math.min(1.0 * k, vis * 0.35), v1 = exit + Math.min(2.2 * k, vis * 0.75);
  const valves = v1 - v0 > 0.5 * k ? [pointAlong(points, v0), pointAlong(points, v1)] : [pointAlong(points, exit + vis * 0.5)];
  let best = { x: points[0], y: points[1] }, bl = -1;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const l = Math.hypot(points[i + 2] - points[i], points[i + 3] - points[i + 1]);
    if (l > bl) { bl = l; best = { x: (points[i] + points[i + 2]) / 2, y: (points[i + 1] + points[i + 3]) / 2 }; }
  }
  return { uIdx, points, fromStub, valves, labelAt: best };
}

/** Bow-tie valve symbol (two triangles) centred at (x,y) on a pipe running along (ux,uy); `half` = half length. */
export function valveSymbol(x: number, y: number, ux: number, uy: number, half: number): number[] {
  const nx = -uy, ny = ux, h = half * 0.6;
  return [
    x - ux * half + nx * h, y - uy * half + ny * h,
    x + ux * half - nx * h, y + uy * half - ny * h,
    x + ux * half + nx * h, y + uy * half + ny * h,
    x - ux * half - nx * h, y - uy * half - ny * h
  ];
}

// ───────────────────────── Condensate drain points ─────────────────────────

export interface DrainPoint { id: string; x: number; y: number }

export const CONDENSATE_SIZE_TEXT = 'Ø 25 mm / 1"';
export const CONDENSATE_SLOPE_TEXT = '1% MIN SLOPE';

export interface CondensatePlan {
  points: number[];
  target: Pt;
  toDrain: boolean;
  /** P-trap at the unit: position and direction of the pipe leaving the unit. */
  trap: { x: number; y: number; ux: number; uy: number };
  length: number;
}

/** Nearest drain point (Euclidean) to a unit; null when none. */
export function nearestDrain(unit: Pt, drains: DrainPoint[]): DrainPoint | null {
  let best: DrainPoint | null = null, bd = Infinity;
  for (const d of drains) {
    const dd = Math.hypot(d.x - unit.x, d.y - unit.y);
    if (dd < bd - 1e-9) { bd = dd; best = d; }
  }
  return best;
}

/**
 * Condensate line of one indoor unit: orthogonal route (around `obstacles`) to the nearest drain point; with no drain
 * point, to the nearest exterior wall. Carries a trap just outside the unit.
 */
export function condensatePlan(
  unit: Pt,
  fp: { w: number; d: number },
  k: number,
  polygon: number[],
  drains: DrainPoint[],
  obstacles: RouteRect[] = []
): CondensatePlan | null {
  let points: number[] | null = null;
  let target: Pt = unit;
  let toDrain = false;
  // only drain points inside this zone are reachable: the line never leaves its own room
  const own = drains
    .filter((d) => polygon.length >= 6 && polygonClearance(polygon, d.x, d.y) >= -0.05 * k)
    .sort((a, b) => Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y));
  for (const dp of own) {
    const r = routeInsidePolygon(unit, dp, polygon, obstacles, k);
    if (r) { points = r; target = { x: dp.x, y: dp.y }; toDrain = true; break; }
  }
  if (!points) {
    const w = polygon.length >= 6 ? condensateRoute(unit, polygon) : null;
    if (!w) return null;
    target = w.wallPoint;
    points = routeInsidePolygon(unit, w.wallPoint, polygon, obstacles, k) ?? w.points;
  }
  if (points.length < 4) return null;
  // the route must start/end exactly on the unit and the drain (simplification keeps the end points)
  const total = pathLength(points);
  if (total < 1e-6) return null;
  const first = pointAlong(points, 0.001);
  const half = Math.abs(first.ux) > Math.abs(first.uy) ? fp.w / 2 : fp.d / 2;
  const trap = pointAlong(points, Math.min(total * 0.5, half + 0.9 * k));
  return { points, target, toDrain, trap: { x: trap.x, y: trap.y, ux: first.ux, uy: first.uy }, length: total };
}

/** P-trap symbol: a U hanging to one side of the pipe, drawn in a frame where the pipe runs along (ux,uy). */
export function trapSymbol(x: number, y: number, ux: number, uy: number, size: number): number[] {
  const nx = -uy, ny = ux;
  const a = size * 0.5, b = size;
  return [
    x - ux * a, y - uy * a,
    x - ux * a + nx * b, y - uy * a + ny * b,
    x + ux * a + nx * b, y + uy * a + ny * b,
    x + ux * a, y + uy * a
  ];
}

// ───────────────────────── Drain point persistence (canvas-local) ─────────────────────────

export interface KvStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }
const DRAIN_PREFIX = 'mep.canvas.drainPoints.v1:';

const defaultKv = (): KvStorage | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

export function loadDrainPoints(projectKey: string, storage: KvStorage | null = defaultKv()): DrainPoint[] {
  try {
    const raw = storage?.getItem(DRAIN_PREFIX + projectKey);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((d): d is DrainPoint => !!d && typeof d.x === 'number' && typeof d.y === 'number' && Number.isFinite(d.x) && Number.isFinite(d.y))
      .map((d, i) => ({ id: typeof d.id === 'string' ? d.id : `dp-${i}`, x: d.x, y: d.y }));
  } catch {
    return [];
  }
}

export function saveDrainPoints(projectKey: string, pts: DrainPoint[], storage: KvStorage | null = defaultKv()): void {
  try {
    storage?.setItem(DRAIN_PREFIX + projectKey, JSON.stringify(pts));
  } catch {
    /* storage unavailable: drain points live for this session only */
  }
}

/** Click with the drain tool: removes an existing point within `tol`, otherwise adds one. */
export function toggleDrainPoint(pts: DrainPoint[], p: Pt, tol: number, nextId: string): DrainPoint[] {
  const hit = pts.findIndex((d) => Math.hypot(d.x - p.x, d.y - p.y) <= tol);
  if (hit >= 0) return pts.filter((_, i) => i !== hit);
  return [...pts, { id: nextId, x: p.x, y: p.y }];
}
