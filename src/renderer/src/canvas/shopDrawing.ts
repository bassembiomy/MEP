// Shop-drawing helpers (pure, no React / Konva): per-unit association, branch dampers, flexible connections, condensate
// drains, access panels, refrigerant sizing/routing, legend, title block and label-candidate generators.
// World units are canvas px (k px per foot) unless a name says "Screen".
import {
  assignTerminalsToUnits,
  AssignTerminal,
  AssignUnit,
  UnitAssignment,
  Bounds,
  ductHalfWidthPx,
  pointInPolygon,
  polygonArea,
  routeManhattan,
  ManhattanRoute,
  RouteRect
} from './drawingGeometry';
import { LabelCandidate, Rect, rotatedAabb } from './labelLayout';

const ID_TOKEN = /[A-Za-z]+[-_][A-Za-z0-9-_]*\d[A-Za-z0-9-_]*/g;

// ───────────────────────── Terminal / duct -> unit association ─────────────────────────

export type UnitRef = string | number;
export interface UnitAssociated { unitId?: UnitRef; serviceZoneId?: UnitRef }

/** Association written by auto-layout: `unitId` wins, else `serviceZoneId`. */
export function associationOf(item: object): UnitRef | undefined {
  const a = item as UnitAssociated;
  if (a.unitId !== undefined && a.unitId !== null && a.unitId !== '') return a.unitId;
  if (a.serviceZoneId !== undefined && a.serviceZoneId !== null && a.serviceZoneId !== '') return a.serviceZoneId;
  return undefined;
}

const natCmp = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

/**
 * Maps association refs to unit indices (0..nUnits-1). Numbers are indices; `zoneId` -> 0 and `${zoneId}-u<n>` -> n (the
 * ids the canvas router uses); a ref that is just digits is an index; any other distinct ids fill the free indices in
 * natural order. Unmappable refs are left out.
 */
export function buildUnitKeyMap(refs: Array<UnitRef | undefined>, nUnits: number, zoneId?: string): Map<UnitRef, number> {
  const map = new Map<UnitRef, number>();
  const others: string[] = [];
  for (const r of refs) {
    if (r === undefined || map.has(r)) continue;
    if (typeof r === 'number') {
      if (Number.isInteger(r) && r >= 0 && r < nUnits) map.set(r, r);
      continue;
    }
    if (zoneId !== undefined && r === zoneId) { map.set(r, 0); continue; }
    const m = zoneId !== undefined && r.startsWith(`${zoneId}-u`) ? /^\d+$/.exec(r.slice(zoneId.length + 2)) : null;
    if (m) {
      const n = parseInt(m[0], 10);
      if (n < nUnits) map.set(r, n);
      continue;
    }
    if (/^\d+$/.test(r)) {
      const n = parseInt(r, 10);
      if (n < nUnits) map.set(r, n);
      continue;
    }
    if (!others.includes(r)) others.push(r);
  }
  const used = new Set(map.values());
  const free: number[] = [];
  for (let i = 0; i < nUnits; i++) if (!used.has(i)) free.push(i);
  others.sort(natCmp);
  if (others.length <= free.length) others.forEach((o, i) => map.set(o, free[i]));
  return map;
}

export function unitIndexOf(item: object, keyMap: Map<UnitRef, number>): number | undefined {
  const a = associationOf(item);
  return a === undefined ? undefined : keyMap.get(a);
}

/**
 * Terminal -> unit assignment shared by duct routing and the over-capacity badge. Terminals carrying an association
 * (`unitId` / `serviceZoneId`) keep it; the rest go to the nearest unit with spare airflow capacity (greedy,
 * `assignTerminalsToUnits` semantics). With no association at all this IS `assignTerminalsToUnits`.
 */
export function assignTerminalsByAssociation(
  terminals: Array<AssignTerminal & Partial<UnitAssociated>>,
  units: AssignUnit[],
  opts: { zoneId?: string; capacity?: number; tol?: number } = {}
): UnitAssignment {
  const tol = opts.tol ?? 0.05;
  const keyMap = buildUnitKeyMap(terminals.map(associationOf), units.length, opts.zoneId);
  const fixed = terminals.map((t) => unitIndexOf(t, keyMap));
  if (!fixed.some((f) => f !== undefined)) return assignTerminalsToUnits(terminals, units, opts.capacity, tol);
  const n = units.length;
  const total = terminals.reduce((s, t) => s + (t.cfm || 0), 0);
  const cap = opts.capacity !== undefined && opts.capacity > 0 ? opts.capacity : n > 0 ? total / n : 0;
  const groups: number[][] = units.map(() => []);
  const loads: number[] = units.map(() => 0);
  terminals.forEach((t, ti) => {
    const u = fixed[ti];
    if (u !== undefined) { groups[u].push(ti); loads[u] += t.cfm || 0; }
  });
  const free = terminals.map((_, i) => i).filter((i) => fixed[i] === undefined)
    .sort((a, b) => (terminals[b].cfm || 0) - (terminals[a].cfm || 0) || a - b);
  for (const ti of free) {
    const t = terminals[ti];
    const ranked = units.map((u, ui) => ({ ui, d: Math.hypot(t.x - u.x, t.y - u.y) })).sort((a, b) => a.d - b.d || a.ui - b.ui);
    let pick = -1;
    for (const r of ranked) if (loads[r.ui] + (t.cfm || 0) <= cap * (1 + tol) + 1e-9) { pick = r.ui; break; }
    if (pick < 0) {
      let bl = Infinity;
      for (const r of ranked) {
        const l = loads[r.ui] + (t.cfm || 0);
        if (l < bl - 1e-9) { bl = l; pick = r.ui; }
      }
    }
    if (pick >= 0) { groups[pick].push(ti); loads[pick] += t.cfm || 0; }
  }
  groups.forEach((g) => g.sort((a, b) => a - b));
  const overloaded = loads.map((l) => l > cap * (1 + tol) + 1e-9);
  return { groups, loads, capacity: cap, overloaded, anyOverloaded: overloaded.some(Boolean) };
}

// ───────────────────────── Geometry primitives ─────────────────────────

export interface Pt { x: number; y: number }

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Point of segment a-b nearest to p. */
function nearestOnSeg(p: Pt, ax: number, ay: number, bx: number, by: number): Pt {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2)) : 0;
  return { x: ax + t * dx, y: ay + t * dy };
}

/** Where the ray from a rect centre toward (tx,ty) leaves the half-extent box (leader line attachment). */
export function rectEdgePoint(cx: number, cy: number, hw: number, hh: number, tx: number, ty: number): Pt {
  const dx = tx - cx, dy = ty - cy;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return { x: cx, y: cy };
  const sx = Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity;
  const sy = Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy, 1);
  return { x: cx + dx * s, y: cy + dy * s };
}

// ───────────────────────── Branch takeoffs + volume dampers ─────────────────────────

export interface ShopDuct {
  id: string;
  type: 'trunk' | 'branch' | 'return';
  points: number[];
  widthIn: number;
  diameterIn?: number;
}

export interface Takeoff {
  id: string;
  ductId: string;
  /** Damper centre (px). */
  x: number;
  y: number;
  /** Takeoff point on the trunk (px). */
  tx: number;
  ty: number;
  /** Unit vector along the branch, away from the trunk. */
  ux: number;
  uy: number;
  halfWidthPx: number;
}

/**
 * One takeoff per supply branch: the branch end that touches (nearest to) the trunk / return it taps. The volume damper sits
 * just downstream of the trunk edge. Pure.
 */
export function findBranchTakeoffs(ducts: ShopDuct[], k: number): Takeoff[] {
  const out: Takeoff[] = [];
  for (const d of ducts) {
    if (d.type !== 'branch' || d.points.length < 4) continue;
    const ax = d.points[0], ay = d.points[1], bx = d.points[2], by = d.points[3];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-9) continue;
    let bestA = Infinity, bestB = Infinity;
    let parentA: ShopDuct | null = null, parentB: ShopDuct | null = null;
    for (const o of ducts) {
      if (o.id === d.id || o.points.length < 4) continue;
      const weight = o.type === 'branch' ? 1e6 : 0; // a branch only taps another branch when nothing else is near
      const da = distToSeg(ax, ay, o.points[0], o.points[1], o.points[2], o.points[3]) + weight;
      const db = distToSeg(bx, by, o.points[0], o.points[1], o.points[2], o.points[3]) + weight;
      if (da < bestA) { bestA = da; parentA = o; }
      if (db < bestB) { bestB = db; parentB = o; }
    }
    const atA = bestA <= bestB;
    const parent = atA ? parentA : parentB;
    const sx = atA ? ax : bx, sy = atA ? ay : by;
    const ux = ((atA ? bx : ax) - sx) / len, uy = ((atA ? by : ay) - sy) / len;
    const trunkHw = parent ? ductHalfWidthPx(parent.widthIn || parent.diameterIn || 0, k) : 0;
    const off = Math.min(len * 0.4, trunkHw + 0.75 * k);
    out.push({
      id: `vd:${d.id}`, ductId: d.id,
      x: sx + ux * off, y: sy + uy * off, tx: sx, ty: sy, ux, uy,
      halfWidthPx: ductHalfWidthPx(d.widthIn || d.diameterIn || 0, k)
    });
  }
  return out;
}

/** Damper symbol: [line across the duct, tilted blade]. */
export function damperSymbol(t: Takeoff): { across: number[]; blade: number[] } {
  const nx = -t.uy, ny = t.ux;
  const hw = Math.max(t.halfWidthPx, 0.2) * 1.25;
  return {
    across: [t.x - nx * hw, t.y - ny * hw, t.x + nx * hw, t.y + ny * hw],
    blade: [t.x - nx * hw * 0.8 - t.ux * hw * 0.45, t.y - ny * hw * 0.8 - t.uy * hw * 0.45,
            t.x + nx * hw * 0.8 + t.ux * hw * 0.45, t.y + ny * hw * 0.8 + t.uy * hw * 0.45]
  };
}

// ───────────────────────── Flexible connections / access panels ─────────────────────────

export interface FlexConnection {
  unitIndex: number;
  ductId: string;
  network: 'supply' | 'return';
  x: number;
  y: number;
  /** Two ticks across the duct and a zig-zag along its axis. */
  ticks: number[][];
  zigzag: number[];
}

export function flexSymbolPoints(p: Pt, ax: number, ay: number, lenPx: number, hwPx: number): { ticks: number[][]; zigzag: number[] } {
  const nx = -ay, ny = ax;
  const a = { x: p.x - ax * lenPx / 2, y: p.y - ay * lenPx / 2 };
  const b = { x: p.x + ax * lenPx / 2, y: p.y + ay * lenPx / 2 };
  const ticks = [
    [a.x - nx * hwPx, a.y - ny * hwPx, a.x + nx * hwPx, a.y + ny * hwPx],
    [b.x - nx * hwPx, b.y - ny * hwPx, b.x + nx * hwPx, b.y + ny * hwPx]
  ];
  const zig: number[] = [a.x, a.y];
  const teeth = 4;
  for (let i = 0; i < teeth; i++) {
    const t = (i + 0.5) / teeth;
    const s = i % 2 === 0 ? 1 : -1;
    zig.push(a.x + (b.x - a.x) * t + nx * hwPx * 0.6 * s, a.y + (b.y - a.y) * t + ny * hwPx * 0.6 * s);
  }
  zig.push(b.x, b.y);
  return { ticks, zigzag: zig };
}

/**
 * Flexible duct connection at each ducted unit: on the supply and the return duct, at the end nearest the unit (within
 * reach of its footprint). Ducts carrying a unit association are matched to their unit; others by proximity.
 */
export function findFlexConnections(
  units: Pt[],
  footprint: { w: number; d: number },
  ducts: Array<ShopDuct & Partial<UnitAssociated>>,
  k: number,
  zoneId?: string
): FlexConnection[] {
  const out: FlexConnection[] = [];
  const keyMap = buildUnitKeyMap(ducts.map(associationOf), units.length, zoneId);
  const reach = Math.max(footprint.w, footprint.d) / 2 + 6 * k;
  units.forEach((u, ui) => {
    for (const network of ['supply', 'return'] as const) {
      let best: { d: ShopDuct; end: Pt; other: Pt; dist: number } | null = null;
      for (const d of ducts) {
        if ((d.type === 'return') !== (network === 'return') || d.points.length < 4) continue;
        const owner = unitIndexOf(d, keyMap);
        if (owner !== undefined && owner !== ui) continue;
        for (const e of [0, 1]) {
          const end = { x: d.points[e * 2], y: d.points[e * 2 + 1] };
          const other = { x: d.points[(1 - e) * 2], y: d.points[(1 - e) * 2 + 1] };
          const dist = Math.hypot(end.x - u.x, end.y - u.y);
          if (dist <= reach && (!best || dist < best.dist - 1e-9)) best = { d, end, other, dist };
        }
      }
      if (!best) continue;
      const l = Math.hypot(best.end.x - best.other.x, best.end.y - best.other.y) || 1;
      const ax = (best.end.x - best.other.x) / l, ay = (best.end.y - best.other.y) / l;
      const hw = ductHalfWidthPx(best.d.widthIn || best.d.diameterIn || 0, k);
      const len = Math.min(l * 0.5, 0.9 * k);
      // centre the flex half a flex-length inside the duct end so it sits between the duct and the unit collar
      const c = { x: best.end.x - ax * len / 2, y: best.end.y - ay * len / 2 };
      const sym = flexSymbolPoints(c, ax, ay, len, Math.max(hw, 0.2 * k));
      out.push({ unitIndex: ui, ductId: best.d.id, network, x: c.x, y: c.y, ...sym });
    }
  });
  return out;
}

/** 2 ft x 2 ft access panel on the service side (right) of an indoor unit, centred on the unit's axis. */
export function accessPanelRect(unit: Pt, footprint: { w: number; d: number }, k: number): Rect {
  const s = 2 * k;
  return { x: unit.x + footprint.w / 2 + 0.75 * k, y: unit.y - s / 2, w: s, h: s };
}

// ───────────────────────── Condensate drain ─────────────────────────

export interface CondensateRoute { points: number[]; wallPoint: Pt; length: number }

/** Dashed drain from an indoor unit to the nearest exterior wall (room edge), orthogonal, arriving perpendicular. */
export function condensateRoute(unit: Pt, polygon: number[]): CondensateRoute | null {
  const n = polygon.length / 2;
  if (n < 3) return null;
  let best: { q: Pt; d: number; vertical: boolean } | null = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = polygon[i * 2], ay = polygon[i * 2 + 1], bx = polygon[j * 2], by = polygon[j * 2 + 1];
    const q = nearestOnSeg(unit, ax, ay, bx, by);
    const d = Math.hypot(unit.x - q.x, unit.y - q.y);
    if (!best || d < best.d - 1e-9) best = { q, d, vertical: Math.abs(bx - ax) < Math.abs(by - ay) };
  }
  if (!best) return null;
  const { q, vertical } = best;
  const aligned = Math.abs(q.x - unit.x) < 0.5 || Math.abs(q.y - unit.y) < 0.5;
  let pts: number[];
  if (aligned) pts = [unit.x, unit.y, q.x, q.y];
  else if (vertical) pts = [unit.x, unit.y, unit.x, q.y, q.x, q.y]; // last leg horizontal into a vertical wall
  else pts = [unit.x, unit.y, q.x, unit.y, q.x, q.y];
  let length = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) length += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  return { points: pts, wallPoint: q, length };
}

// ───────────────────────── Refrigerant piping ─────────────────────────

const MM_PER_IN = 25.4;
const LINE_SIZES: Array<{ maxBtuh: number; liquid: string; suction: string }> = [
  { maxBtuh: 12000, liquid: '1/4', suction: '3/8' },
  { maxBtuh: 18000, liquid: '1/4', suction: '1/2' },
  { maxBtuh: 24000, liquid: '3/8', suction: '5/8' },
  { maxBtuh: 36000, liquid: '3/8', suction: '3/4' },
  { maxBtuh: 60000, liquid: '3/8', suction: '7/8' },
  { maxBtuh: Infinity, liquid: '1/2', suction: '1-1/8' }
];

/** Typical copper refrigerant line sizes (liquid / suction) for a unit capacity in Btu/h, as text. */
export function refrigerantLineSizes(btuh: number, units: string | undefined): { liquid: string; suction: string; text: string } {
  const row = LINE_SIZES.find((r) => btuh <= r.maxBtuh) ?? LINE_SIZES[LINE_SIZES.length - 1];
  const frac = (f: string): number => { const [a, b] = f.split('/'); return b ? parseInt(a, 10) / parseInt(b, 10) : parseInt(a, 10); };
  const toIn = (v: string): number => (v.includes('-') ? parseInt(v, 10) + frac(v.split('-')[1]) : frac(v));
  const fmt = (s: string): string => (units === 'metric' ? `Ø${(toIn(s) * MM_PER_IN).toFixed(1)}` : `${s}"`);
  const liquid = fmt(row.liquid), suction = fmt(row.suction);
  return { liquid, suction, text: `LL ${liquid} / SL ${suction}` };
}

/** Refrigerant route: Manhattan, <= 3 bends where possible, 0.5 ft clear of every obstacle bbox. */
export function routeRefrigerant(from: Pt, to: Pt, obstacles: RouteRect[], k: number): ManhattanRoute {
  return routeManhattan(from, to, obstacles, { clearance: 0.5 * k, maxBends: 3 });
}

// ───────────────────────── Legend + title block ─────────────────────────

export type LegendKey =
  | 'supply-diffuser' | 'return-grille' | 'vd' | 'duct' | 'refrigerant' | 'condensate' | 'odu' | 'idu' | 'flex' | 'access';
export interface LegendItem { key: LegendKey; label: string }

export function legendItems(): LegendItem[] {
  return [
    { key: 'supply-diffuser', label: 'SUPPLY DIFFUSER (CD)' },
    { key: 'return-grille', label: 'RETURN GRILLE (RG)' },
    { key: 'duct', label: 'DUCT (SUPPLY / RETURN)' },
    { key: 'vd', label: 'VD - VOLUME DAMPER' },
    { key: 'flex', label: 'FLEXIBLE CONNECTION' },
    { key: 'access', label: 'AP - ACCESS PANEL' },
    { key: 'refrigerant', label: 'REFRIGERANT LINES (LL / SL)' },
    { key: 'condensate', label: 'CD - CONDENSATE DRAIN' },
    { key: 'idu', label: 'IDU - INDOOR UNIT' },
    { key: 'odu', label: 'ODU - OUTDOOR UNIT' }
  ];
}

/** Paper scale denominator when 1 canvas px prints as 1/dpi inch: 1 ft = pxPerFt px = pxPerFt/dpi in -> 12*dpi/pxPerFt. */
export function printScaleDenominator(pxPerFt: number, dpi = 96): number {
  return Math.max(1, Math.round((12 * dpi) / Math.max(1e-6, pxPerFt)));
}
export const printScaleText = (pxPerFt: number, dpi = 96): string => `1:${printScaleDenominator(pxPerFt, dpi)}`;

export function formatSheetDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface TitleBlock {
  projectName: string;
  location: string;
  scaleText: string;
  unitsText: string;
  dateText: string;
  sheetText: string;
  rows: Array<{ label: string; value: string }>;
}

export function buildTitleBlock(input: {
  projectName?: string;
  location?: string;
  pxPerFt: number;
  units?: string;
  date?: Date;
  sheetNo?: string;
  sheetTitle?: string;
  dpi?: number;
}): TitleBlock {
  const projectName = (input.projectName || 'UNTITLED PROJECT').toUpperCase();
  const location = (input.location || '-').toUpperCase();
  const scaleText = printScaleText(input.pxPerFt, input.dpi ?? 96);
  const unitsText = input.units === 'metric' ? 'METRIC (m, mm)' : 'IMPERIAL (ft-in)';
  const dateText = formatSheetDate(input.date ?? new Date());
  const sheetText = `${input.sheetNo ?? 'M-101'} ${input.sheetTitle ?? 'HVAC LAYOUT'}`;
  return {
    projectName, location, scaleText, unitsText, dateText, sheetText,
    rows: [
      { label: 'PROJECT', value: projectName },
      { label: 'LOCATION', value: location },
      { label: 'SCALE', value: scaleText },
      { label: 'UNITS', value: unitsText },
      { label: 'DATE', value: dateText },
      { label: 'SHEET', value: sheetText }
    ]
  };
}

export interface SheetLayout {
  /** Sheet drawing unit (px per sheet unit): grows with the drawing so the block stays proportionate. */
  u: number;
  title: Rect;
  legend: Rect;
  /** Union of both blocks. */
  bounds: Rect;
}

/** Title block at the bottom-right of the drawing extents, legend immediately to its left. */
export function layoutSheet(extents: Bounds, legendCount = legendItems().length): SheetLayout {
  const span = Math.max(extents.maxX - extents.minX, extents.maxY - extents.minY, 1);
  const u = Math.min(4, Math.max(0.3, span / 1100));
  const gap = 12 * u;
  const tw = 300 * u, th = 112 * u;
  const lw = 340 * u, lh = (30 + Math.ceil(legendCount / 2) * 18) * u;
  const title: Rect = { x: extents.maxX - tw, y: extents.maxY + gap, w: tw, h: th };
  const legend: Rect = { x: title.x - gap - lw, y: title.y + th - lh, w: lw, h: lh };
  const x0 = Math.min(title.x, legend.x), y0 = Math.min(title.y, legend.y);
  const bounds: Rect = { x: x0, y: y0, w: title.x + tw - x0, h: Math.max(title.y + th, legend.y + lh) - y0 };
  return { u, title, legend, bounds };
}

// ───────────────────────── Label-layout helpers (screen px) ─────────────────────────

export interface DxfTextLike { x?: number; y?: number; text?: string; height?: number; rotation?: number; align?: 'left' | 'center' | 'right' }

/** Screen bbox of a DXF text entity (null when too small to be drawn). `s` = screen px per world px. */
export function dxfTextRect(ent: DxfTextLike, s: number): Rect | null {
  const h = ent.height && ent.height > 0 ? ent.height : Math.max(7, 9 / s);
  if (h * s < 2.5) return null;
  const lines = String(ent.text ?? '').split(/\\P|\r?\n/);
  const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const w = maxLen * 0.6 * h, hh = Math.max(1, lines.length) * 1.25 * h;
  const align = ent.align || 'left';
  const x0 = align === 'center' ? -w / 2 : align === 'right' ? -w : 0;
  // baseline at the origin: the box spans from one cap height above to the last line's descent below
  const y0 = -h;
  const cx = x0 + w / 2, cy = y0 + hh / 2;
  const a = ((ent.rotation || 0) * Math.PI) / 180;
  const rx = cx * Math.cos(a) - cy * Math.sin(a), ry = cx * Math.sin(a) + cy * Math.cos(a);
  const box = rotatedAabb((ent.x || 0) + rx, (ent.y || 0) + ry, w, hh, ent.rotation || 0);
  return { x: box.x * s, y: box.y * s, w: box.w * s, h: box.h * s };
}

/** Clearance text for display: ids removed ("duct passes through terminal duct-ab12" -> "duct passes through terminal"). */
export function shortClearanceReason(issue: string | undefined): string {
  if (!issue) return '';
  return issue.replace(ID_TOKEN, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').trim();
}

/** Candidate label centres on a grid, kept when the whole label rect lies inside the polygon (screen px). */
export function gridCandidatesInPolygon(
  polyScreen: number[],
  size: { w: number; h: number },
  anchor: Pt,
  maxCount = 60
): LabelCandidate[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < polyScreen.length; i += 2) {
    minX = Math.min(minX, polyScreen[i]); maxX = Math.max(maxX, polyScreen[i]);
    minY = Math.min(minY, polyScreen[i + 1]); maxY = Math.max(maxY, polyScreen[i + 1]);
  }
  if (!(maxX > minX && maxY > minY)) return [];
  const stepX = Math.max(4, Math.min(size.w / 2, (maxX - minX) / 10)), stepY = Math.max(4, Math.min(size.h / 2, (maxY - minY) / 10));
  const pts: Array<{ x: number; y: number; d: number }> = [];
  for (let y = minY + size.h / 2; y <= maxY - size.h / 2 + 1e-6; y += stepY) {
    for (let x = minX + size.w / 2; x <= maxX - size.w / 2 + 1e-6; x += stepX) {
      const hw = size.w / 2, hh = size.h / 2;
      if (
        pointInPolygon(polyScreen, x - hw, y - hh) && pointInPolygon(polyScreen, x + hw, y - hh) &&
        pointInPolygon(polyScreen, x - hw, y + hh) && pointInPolygon(polyScreen, x + hw, y + hh) &&
        pointInPolygon(polyScreen, x, y)
      ) pts.push({ x, y, d: Math.hypot(x - anchor.x, y - anchor.y) });
    }
  }
  pts.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  return pts.slice(0, maxCount).map((p) => ({ x: p.x, y: p.y, angleDeg: 0 }));
}

/**
 * Candidate centres for the schedule callout: inside the room (nearest the unit first) while it takes <= 20% of the room,
 * then outside the room (above, right, left, below), at two distances. Screen px.
 */
export function calloutCandidates(
  size: { w: number; h: number },
  anchor: Pt,
  polyScreen: number[],
  gap = 10
): LabelCandidate[] {
  const out: LabelCandidate[] = [];
  const areaPx = Math.abs(polygonArea(polyScreen));
  if (size.w * size.h <= 0.2 * areaPx) out.push(...gridCandidatesInPolygon(polyScreen, size, anchor, 24));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < polyScreen.length; i += 2) {
    minX = Math.min(minX, polyScreen[i]); maxX = Math.max(maxX, polyScreen[i]);
    minY = Math.min(minY, polyScreen[i + 1]); maxY = Math.max(maxY, polyScreen[i + 1]);
  }
  if (!Number.isFinite(minX)) return out;
  const clampX = (x: number): number => Math.min(maxX - size.w / 2, Math.max(minX + size.w / 2, x));
  const clampY = (y: number): number => Math.min(maxY - size.h / 2, Math.max(minY + size.h / 2, y));
  for (const g of [gap, gap * 4]) {
    const fx = [anchor.x, (minX + maxX) / 2, minX + size.w / 2, maxX - size.w / 2];
    const fy = [anchor.y, (minY + maxY) / 2, minY + size.h / 2, maxY - size.h / 2];
    for (const x of fx) out.push({ x: clampX(x), y: minY - g - size.h / 2, angleDeg: 0 });
    for (const y of fy) out.push({ x: maxX + g + size.w / 2, y: clampY(y), angleDeg: 0 });
    for (const y of fy) out.push({ x: minX - g - size.w / 2, y: clampY(y), angleDeg: 0 });
    for (const x of fx) out.push({ x: clampX(x), y: maxY + g + size.h / 2, angleDeg: 0 });
  }
  return out;
}
