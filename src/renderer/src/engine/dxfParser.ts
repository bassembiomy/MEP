import { DxfEntity, BoundingBox } from '../store/projectStore';
import { insunitsToFeet, pxPerFt } from './units';

/**
 * CAD entity as produced by the DXF/DWG parsers. Extends the store's DxfEntity with OPTIONAL fields
 * (the store type should get the same optional fields).
 *
 *  - startAngle / endAngle (ARC): DEGREES. Always endAngle >= startAngle with sweep = endAngle - startAngle in (0, 360];
 *    startAngle is normalised to [0, 360). Increasing angle is CCW in raw DXF space; after normalizeCadToCanvas the
 *    coordinates are canvas (Y down) and increasing angle is clockwise on screen (Konva / canvas-2D convention),
 *    so the values can be drawn directly.
 *  - height (TEXT/MTEXT): text height in the entity's current coordinate space (drawing units, or canvas px after normalize).
 *  - rotation (TEXT/MTEXT): DEGREES, baseline direction (CCW in DXF space; negated after normalize for canvas).
 *  - align (TEXT/MTEXT): horizontal anchor of (x, y).
 */
export interface CadEntity extends DxfEntity {
  startAngle?: number;
  endAngle?: number;
  height?: number;
  rotation?: number;
  align?: 'left' | 'center' | 'right';
}

export interface ParsedDxf {
  entities: CadEntity[];
  /** Bounding box in RAW drawing units (pre-normalisation). */
  bbox: BoundingBox;
  /** Layer name -> hex colour (from the LAYER table / ACI). */
  layerColors: Record<string, string>;
  /** $INSUNITS header value (0/undefined = unitless). */
  insunits?: number;
  warnings: string[];
}

// Standard AutoCAD Color Index (ACI 1-9 & common palette) to HEX colors
export function aciToHexColor(aci: number): string {
  const aciMap: Record<number, string> = {
    1: '#ef4444', // Red
    2: '#eab308', // Yellow
    3: '#22c55e', // Green
    4: '#06b6d4', // Cyan
    5: '#3b82f6', // Blue
    6: '#d946ef', // Magenta
    7: '#f8fafc', // White / Light
    8: '#64748b', // Dark Gray
    9: '#cbd5e1', // Light Gray
  };

  if (aciMap[aci]) return aciMap[aci];
  if (aci >= 10 && aci <= 249) {
    // Generate harmonious RGB for other standard AutoCAD color indexes
    const hue = Math.round(((aci - 10) / 240) * 360);
    return `hsl(${hue}, 70%, 60%)`;
  }
  return '#94a3b8';
}

// ---------------------------------------------------------------------------
// Geometry helpers (shared with dwgParser)
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;
/** Maximum angular step (degrees) when tessellating curves (>= 1 segment per 5 degrees). */
export const CURVE_STEP_DEG = 5;

const norm360 = (a: number): number => {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
};

/** CCW sweep in degrees from s to e, in (0, 360]. */
export function arcSweep(startDeg: number, endDeg: number): number {
  const d = norm360(endDeg - startDeg);
  return d < 1e-9 ? 360 : d;
}

/** Normalised arc: startAngle in [0,360), endAngle = startAngle + sweep. */
export function makeArcAngles(startDeg: number, endDeg: number): { startAngle: number; endAngle: number } {
  const s = norm360(startDeg);
  return { startAngle: s, endAngle: s + arcSweep(startDeg, endDeg) };
}

/** Intermediate points (flat, EXCLUDING both endpoints) of a bulge arc from p0 to p1. */
export function bulgeArcPoints(x0: number, y0: number, x1: number, y1: number, bulge: number): number[] {
  const out: number[] = [];
  if (!bulge || !isFinite(bulge)) return out;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-12) return out;
  const theta = 4 * Math.atan(bulge); // signed included angle
  const half = theta / 2;
  const r = chord / (2 * Math.sin(Math.abs(half)));
  // centre lies to the left of the chord for CCW arcs (bulge > 0)
  const off = chord / (2 * Math.tan(half));
  const cx = (x0 + x1) / 2 + (-dy / chord) * off;
  const cy = (y0 + y1) / 2 + (dx / chord) * off;
  const a0 = Math.atan2(y0 - cy, x0 - cx);
  const n = Math.max(1, Math.ceil(Math.abs(theta) / (CURVE_STEP_DEG * DEG)));
  for (let i = 1; i < n; i++) {
    const a = a0 + (theta * i) / n;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return out;
}

export interface BulgeVertex { x: number; y: number; bulge?: number }

/** Flat polyline points with bulge arcs tessellated; closed polylines get an explicit closing segment. */
export function buildBulgePolyline(verts: BulgeVertex[], closed: boolean): number[] {
  const pts: number[] = [];
  if (verts.length === 0) return pts;
  const n = verts.length;
  const segCount = closed ? n : n - 1;
  pts.push(verts[0].x, verts[0].y);
  for (let i = 0; i < segCount; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const mid = bulgeArcPoints(a.x, a.y, b.x, b.y, a.bulge || 0);
    for (const m of mid) pts.push(m);
    const isDupClose = closed && i === n - 1 && !a.bulge && Math.hypot(a.x - b.x, a.y - b.y) < 1e-12;
    if (!isDupClose) pts.push(b.x, b.y);
  }
  return pts;
}

/** Flat points of a circular arc (angles in degrees, CCW). Endpoints included. */
export function arcPoints(cx: number, cy: number, r: number, startDeg: number, endDeg: number): number[] {
  const sweep = arcSweep(startDeg, endDeg);
  const n = Math.max(1, Math.ceil(sweep / CURVE_STEP_DEG));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (startDeg + (sweep * i) / n) * DEG;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return out;
}

/** Flat points of an elliptical arc. Params are radians (DXF/DWG ELLIPSE parameters); major axis is relative to centre. */
export function ellipsePoints(
  cx: number, cy: number, mx: number, my: number, ratio: number, startParam = 0, endParam = Math.PI * 2
): number[] {
  let sweep = endParam - startParam;
  if (sweep <= 1e-12) sweep += Math.PI * 2;
  if (sweep > Math.PI * 2) sweep = Math.PI * 2;
  const n = Math.max(8, Math.ceil(sweep / (CURVE_STEP_DEG * DEG)));
  const px = -my * ratio;
  const py = mx * ratio;
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = startParam + (sweep * i) / n;
    const c = Math.cos(t);
    const s = Math.sin(t);
    out.push(cx + c * mx + s * px, cy + c * my + s * py);
  }
  return out;
}

export interface SplineCtrl { x: number; y: number; w?: number }

function validKnots(U: number[] | undefined, n: number, p: number): number[] {
  if (U && U.length === n + p + 1 && U.every((v, i) => isFinite(v) && (i === 0 || v >= U[i - 1]))) return U;
  const out: number[] = [];
  for (let i = 0; i <= p; i++) out.push(0);
  for (let i = 1; i <= n - p - 1; i++) out.push(i);
  for (let i = 0; i <= p; i++) out.push(n - p);
  return out;
}

/** Evaluate a (rational) B-spline at parameter u with de Boor's algorithm. */
export function evalBSpline(ctrl: SplineCtrl[], degree: number, knots: number[], u: number): { x: number; y: number } {
  const n = ctrl.length;
  const p = degree;
  let k = n - 1;
  if (u < knots[n]) {
    k = p;
    for (let i = p; i < n; i++) {
      if (u >= knots[i] && u < knots[i + 1]) { k = i; break; }
    }
  }
  const d: { x: number; y: number; w: number }[] = [];
  for (let j = 0; j <= p; j++) {
    const c = ctrl[j + k - p];
    const w = c.w ?? 1;
    d.push({ x: c.x * w, y: c.y * w, w });
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const den = knots[j + 1 + k - r] - knots[j + k - p];
      const alpha = den === 0 ? 0 : (u - knots[j + k - p]) / den;
      d[j] = {
        x: (1 - alpha) * d[j - 1].x + alpha * d[j].x,
        y: (1 - alpha) * d[j - 1].y + alpha * d[j].y,
        w: (1 - alpha) * d[j - 1].w + alpha * d[j].w,
      };
    }
  }
  const h = d[p];
  const w = h.w || 1;
  return { x: h.x / w, y: h.y / w };
}

/** Sample a B-spline into a flat polyline, >= 8 samples per knot span; first/last points equal curve endpoints. */
export function splinePoints(ctrl: SplineCtrl[], degree: number, knots?: number[]): number[] {
  const n = ctrl.length;
  if (n < 2) return [];
  const p = Math.max(1, Math.min(Math.round(degree) || 3, n - 1));
  const U = validKnots(knots, n, p);
  const uniq: number[] = [];
  for (let i = p; i <= n; i++) {
    if (uniq.length === 0 || U[i] > uniq[uniq.length - 1] + 1e-12) uniq.push(U[i]);
  }
  const out: number[] = [];
  const SAMPLES = 8;
  for (let s = 0; s + 1 < uniq.length; s++) {
    for (let j = 0; j < SAMPLES; j++) {
      const pt = evalBSpline(ctrl, p, U, uniq[s] + ((uniq[s + 1] - uniq[s]) * j) / SAMPLES);
      out.push(pt.x, pt.y);
    }
  }
  const last = evalBSpline(ctrl, p, U, uniq[uniq.length - 1]);
  out.push(last.x, last.y);
  return out;
}

/** Strip MTEXT inline formatting codes, returning plain text with '\n' for paragraph breaks. */
export function stripMtext(input: string): string {
  let s = input;
  s = s.replace(/\\\\/g, '\u0001').replace(/\\\{/g, '\u0002').replace(/\\\}/g, '\u0003');
  s = s.replace(/\\P/g, '\n').replace(/\\~/g, ' ').replace(/\\X/g, '\n');
  s = s.replace(/\\S([^;]*);/g, (_m, g1: string) => g1.replace(/[\^#]/g, '/'));
  s = s.replace(/\\[fFcCHhQqWwTtAa][^;]*;/g, '');
  s = s.replace(/\\[LlOoKk]/g, '');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/\u0001/g, '\\').replace(/\u0002/g, '{').replace(/\u0003/g, '}');
  return s;
}

function decodeTextCodes(s: string): string {
  return s.replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[cC]/g, '⌀');
}

// ---------------------------------------------------------------------------
// INSERT transform (shared by DXF and DWG)
// ---------------------------------------------------------------------------

/** translate(-base) -> scale(sx, sy) -> rotate(rot, RADIANS, CCW) -> translate(ins). */
export interface InsertXf {
  baseX: number;
  baseY: number;
  insX: number;
  insY: number;
  sx: number;
  sy: number;
  rot: number;
}

/**
 * Build the transform from a DWG (libredwg) INSERT. libredwg reports `rotation` in RADIANS, so it is
 * used directly (NOT multiplied by pi/180).
 */
export function dwgInsertToXf(
  ins: { insertionPoint?: { x: number; y: number }; xScale?: number; yScale?: number; rotation?: number },
  basePoint?: { x: number; y: number }
): InsertXf {
  return {
    baseX: basePoint?.x ?? 0,
    baseY: basePoint?.y ?? 0,
    insX: ins.insertionPoint?.x ?? 0,
    insY: ins.insertionPoint?.y ?? 0,
    sx: typeof ins.xScale === 'number' && ins.xScale !== 0 ? ins.xScale : 1,
    sy: typeof ins.yScale === 'number' && ins.yScale !== 0 ? ins.yScale : 1,
    rot: typeof ins.rotation === 'number' ? ins.rotation : 0,
  };
}

export function xfPoint(x: number, y: number, t: InsertXf): { x: number; y: number } {
  const dx = (x - t.baseX) * t.sx;
  const dy = (y - t.baseY) * t.sy;
  const c = Math.cos(t.rot);
  const s = Math.sin(t.rot);
  return { x: dx * c - dy * s + t.insX, y: dx * s + dy * c + t.insY };
}

/** Image (degrees) of a direction at angle `aDeg` under the linear part of the transform. */
function xfAngleDeg(aDeg: number, t: InsertXf): number {
  const a = aDeg * DEG;
  return (Math.atan2(t.sy * Math.sin(a), t.sx * Math.cos(a)) + t.rot) / DEG;
}

function mapPoints(pts: number[], t: InsertXf): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const p = xfPoint(pts[i], pts[i + 1], t);
    out.push(p.x, p.y);
  }
  return out;
}

/** Apply an INSERT transform to one entity (exact for non-uniform and mirrored scales). */
export function transformEntityByInsert(ent: CadEntity, t: InsertXf): CadEntity {
  if (ent.type === 'LINE') {
    const p1 = xfPoint(ent.x || 0, ent.y || 0, t);
    const p2 = xfPoint(ent.points?.[0] || 0, ent.points?.[1] || 0, t);
    return { ...ent, x: p1.x, y: p1.y, points: [p2.x, p2.y] };
  }
  if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
    return { ...ent, points: mapPoints(ent.points || [], t) };
  }
  if (ent.type === 'CIRCLE' || ent.type === 'ARC') {
    const cx = ent.x || 0;
    const cy = ent.y || 0;
    const r = ent.radius || 0;
    const ax = Math.abs(t.sx);
    const ay = Math.abs(t.sy);
    if (Math.abs(ax - ay) <= 1e-9 * Math.max(ax, ay, 1e-12)) {
      const c = xfPoint(cx, cy, t);
      const out: CadEntity = { ...ent, x: c.x, y: c.y, radius: r * ax };
      if (ent.type === 'ARC') {
        const s = ent.startAngle ?? 0;
        const sweep = arcSweep(s, ent.endAngle ?? 360);
        let ns = xfAngleDeg(s, t);
        let ne = xfAngleDeg(s + sweep, t);
        if (t.sx * t.sy < 0) [ns, ne] = [ne, ns]; // reflection reverses orientation
        Object.assign(out, makeArcAngles(ns, ne));
      }
      return out;
    }
    // non-uniform scale: circle/arc becomes an ellipse -> tessellate, then transform points
    const raw = ent.type === 'ARC'
      ? arcPoints(cx, cy, r, ent.startAngle ?? 0, ent.endAngle ?? 360)
      : arcPoints(cx, cy, r, 0, 360);
    const { x: _x, y: _y, radius: _r, startAngle: _s, endAngle: _e, ...rest } = ent;
    return { ...rest, type: 'LWPOLYLINE', points: mapPoints(raw, t) };
  }
  if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
    const p = xfPoint(ent.x || 0, ent.y || 0, t);
    const out: CadEntity = { ...ent, x: p.x, y: p.y };
    if (typeof ent.height === 'number') out.height = ent.height * Math.abs(t.sy);
    const baseRot = ent.rotation || 0;
    const nr = xfAngleDeg(baseRot, t);
    if (baseRot !== 0 || Math.abs(nr) > 1e-12) out.rotation = nr;
    return out;
  }
  return ent;
}

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

/** Exact extents of a list of entities (arcs use true extents incl. quadrant points). */
export function entitiesBbox(entities: CadEntity[]): BoundingBox {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => {
    if (!isFinite(x) || !isFinite(y)) return;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const ent of entities) {
    if (ent.type === 'LINE') {
      add(ent.x || 0, ent.y || 0);
      add(ent.points?.[0] || 0, ent.points?.[1] || 0);
    } else if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
      const p = ent.points || [];
      for (let i = 0; i + 1 < p.length; i += 2) add(p[i], p[i + 1]);
    } else if (ent.type === 'CIRCLE') {
      const r = ent.radius || 0;
      add((ent.x || 0) - r, (ent.y || 0) - r);
      add((ent.x || 0) + r, (ent.y || 0) + r);
    } else if (ent.type === 'ARC') {
      const cx = ent.x || 0, cy = ent.y || 0, r = ent.radius || 0;
      const s = ent.startAngle ?? 0;
      const sweep = arcSweep(s, ent.endAngle ?? 360);
      for (const a of [s, s + sweep]) add(cx + r * Math.cos(a * DEG), cy + r * Math.sin(a * DEG));
      for (let q = Math.ceil(s / 90) * 90; q < s + sweep; q += 90) add(cx + r * Math.cos(q * DEG), cy + r * Math.sin(q * DEG));
    } else if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
      add(ent.x || 0, ent.y || 0);
    }
  }
  return {
    minX: isFinite(minX) ? minX : 0,
    maxX: isFinite(maxX) ? maxX : 500,
    minY: isFinite(minY) ? minY : 0,
    maxY: isFinite(maxY) ? maxY : 500,
  };
}

// ---------------------------------------------------------------------------
// Normalisation: drawing units -> canvas pixels (single transform for DXF + DWG)
// ---------------------------------------------------------------------------

export interface NormalizeOptions {
  /** $INSUNITS code (0/undefined = unitless). */
  insunits?: number;
  /** Project px-per-project-unit (ft for imperial, m for metric). */
  projectScale: number;
  projectUnits: 'imperial' | 'metric' | string;
  /** User calibration: feet per drawing unit. Overrides INSUNITS and the heuristic. */
  overrideFeetPerUnit?: number;
}

export interface NormalizedCad {
  entities: CadEntity[];
  /** Bounding box AFTER transform (canvas px); minX/minY are 0. */
  bbox: BoundingBox;
  feetPerUnit: number;
  pxPerUnit: number;
  /** True when units were unknown and a default was assumed; the UI should offer calibration. */
  needsCalibration: boolean;
  warning?: string;
}

/**
 * Map raw CAD geometry to canvas pixels:
 *   X = (x - minX) * k * pxPerFt,   Y = (maxY - y) * k * pxPerFt     (Y flip: DXF Y up, canvas Y down)
 * k = feet per drawing unit. Radii, text heights scale by k*pxPerFt; arc angles mirror (a -> -a, start/end swap);
 * rotations are negated.
 */
export function normalizeCadToCanvas(entities: CadEntity[], opts: NormalizeOptions): NormalizedCad {
  const src = entitiesBbox(entities);
  let k: number;
  let needsCalibration = false;
  let warning: string | undefined;
  const override = opts.overrideFeetPerUnit;
  if (typeof override === 'number' && isFinite(override) && override > 0) {
    k = override;
  } else {
    const known = insunitsToFeet(opts.insunits);
    if (known !== null) {
      k = known;
    } else {
      const extent = Math.max(src.maxX - src.minX, src.maxY - src.minY);
      needsCalibration = true;
      // Unitless drawing: guess from the extent. Bands: > 2000 units => millimetres (a 2 m+ room), 200-2000 => inches
      // (a typical 17-170 ft plan drawn in inches), < 200 => feet. Always flagged for calibration.
      const shown = Math.round(extent * 100) / 100;
      if (extent > 2000) {
        k = 1 / 304.8;
        warning = `Drawing has no unit information (INSUNITS unset) and its extents are ${shown} units; assumed millimetres. Please verify the scale.`;
      } else if (extent >= 200) {
        k = 1 / 12;
        warning = `Drawing has no unit information (INSUNITS unset) and its extents are ${shown} units; assumed inches. Please verify the scale.`;
      } else {
        k = 1;
        warning = `Drawing has no unit information (INSUNITS unset); assumed feet (extents ${shown} units). Please verify the scale.`;
      }
    }
  }
  const s = k * pxPerFt(opts.projectScale, opts.projectUnits);
  const X = (x: number) => (x - src.minX) * s;
  const Y = (y: number) => (src.maxY - y) * s;

  const pts = (p: number[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i + 1 < p.length; i += 2) out.push(X(p[i]), Y(p[i + 1]));
    return out;
  };

  const out: CadEntity[] = entities.map((ent) => {
    if (ent.type === 'LINE') {
      return { ...ent, x: X(ent.x || 0), y: Y(ent.y || 0), points: [X(ent.points?.[0] || 0), Y(ent.points?.[1] || 0)] };
    }
    if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
      return { ...ent, points: pts(ent.points || []) };
    }
    if (ent.type === 'CIRCLE') {
      return { ...ent, x: X(ent.x || 0), y: Y(ent.y || 0), radius: (ent.radius || 0) * s };
    }
    if (ent.type === 'ARC') {
      const st = ent.startAngle ?? 0;
      const sweep = arcSweep(st, ent.endAngle ?? 360);
      // Y flip: a -> -a, so the CCW arc [st, st+sweep] becomes [-(st+sweep), -st]
      const a = makeArcAngles(-(st + sweep), -st);
      return { ...ent, x: X(ent.x || 0), y: Y(ent.y || 0), radius: (ent.radius || 0) * s, ...a };
    }
    if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
      const o: CadEntity = { ...ent, x: X(ent.x || 0), y: Y(ent.y || 0) };
      if (typeof ent.height === 'number') o.height = ent.height * s;
      if (typeof ent.rotation === 'number') o.rotation = 0 - ent.rotation;
      return o;
    }
    return ent;
  });

  const width = (src.maxX - src.minX) * s;
  const height = (src.maxY - src.minY) * s;
  return {
    entities: out,
    bbox: { minX: 0, minY: 0, maxX: width, maxY: height },
    feetPerUnit: k,
    pxPerUnit: s,
    needsCalibration,
    warning,
  };
}

// ---------------------------------------------------------------------------
// DXF text parsing
// ---------------------------------------------------------------------------

interface Pair { c: number; v: string }
interface Rec { type: string; pairs: Pair[] }

interface RawItemBase { layer: string; aci?: number; trueColor?: number }
interface GeoItem extends RawItemBase { kind: 'geo'; ent: CadEntity }
interface InsertItem extends RawItemBase {
  kind: 'insert';
  name: string;
  x: number; y: number;
  sx: number; sy: number;
  rotDeg: number;
  cols: number; rows: number;
  dx: number; dy: number;
}
type RawItem = GeoItem | InsertItem;

interface BlockDef { name: string; baseX: number; baseY: number; items: RawItem[] }

function tokenize(text: string): Pair[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/); // keep ALL lines (empty values are legal)
  const pairs: Pair[] = [];
  // Strict pairing; a non-numeric line in a code slot (stray blank/garbage, e.g. leading blank lines) re-syncs by one line.
  let i = 0;
  while (i + 1 < lines.length) {
    const t = lines[i].trim();
    const c = /^[+-]?\d+$/.test(t) ? parseInt(t, 10) : NaN;
    if (isNaN(c)) { i += 1; continue; }
    pairs.push({ c, v: lines[i + 1].replace(/\r$/, '') });
    i += 2;
  }
  return pairs;
}

function splitRecords(pairs: Pair[]): Rec[] {
  const recs: Rec[] = [];
  let cur: Rec | null = null;
  for (const p of pairs) {
    if (p.c === 0) {
      cur = { type: p.v.trim(), pairs: [] };
      recs.push(cur);
    } else if (cur) {
      cur.pairs.push(p);
    }
  }
  return recs;
}

const num = (s: string): number => parseFloat(s);

function parseLwPolyline(rec: Rec): CadEntity {
  const verts: BulgeVertex[] = [];
  let flag = 0;
  for (const { c, v } of rec.pairs) {
    if (c === 10) verts.push({ x: num(v), y: 0, bulge: 0 });
    else if (c === 20 && verts.length) verts[verts.length - 1].y = num(v);
    else if (c === 42 && verts.length) verts[verts.length - 1].bulge = num(v);
    else if (c === 70) flag = parseInt(v, 10) || 0;
  }
  const good = verts.filter((p) => isFinite(p.x) && isFinite(p.y));
  return { type: 'LWPOLYLINE', points: buildBulgePolyline(good, (flag & 1) === 1), layer: '0' };
}

function parseGeo(rec: Rec, vertexRecs: Rec[]): CadEntity | null {
  const ent: CadEntity = { type: 'LINE', layer: '0' };
  const pr = rec.pairs;
  switch (rec.type) {
    case 'LINE': {
      ent.type = 'LINE';
      ent.x = 0; ent.y = 0;
      const end = [0, 0];
      ent.points = end;
      for (const { c, v } of pr) {
        if (c === 10) ent.x = num(v);
        else if (c === 20) ent.y = num(v);
        else if (c === 11) end[0] = num(v);
        else if (c === 21) end[1] = num(v);
      }
      return ent;
    }
    case 'LWPOLYLINE':
      return parseLwPolyline(rec);
    case 'POLYLINE': {
      const flag = parseInt(pr.find((p) => p.c === 70)?.v ?? '0', 10) || 0;
      if (flag & (16 | 64)) return null; // 3D mesh / polyface mesh: not drawable as an outline
      const verts: BulgeVertex[] = [];
      for (const vr of vertexRecs) {
        let x = NaN, y = NaN, b = 0;
        for (const { c, v } of vr.pairs) {
          if (c === 10) x = num(v);
          else if (c === 20) y = num(v);
          else if (c === 42) b = num(v);
        }
        if (isFinite(x) && isFinite(y)) verts.push({ x, y, bulge: b });
      }
      return { type: 'LWPOLYLINE', points: buildBulgePolyline(verts, (flag & 1) === 1), layer: '0' };
    }
    case 'CIRCLE':
    case 'ARC': {
      ent.type = rec.type as 'CIRCLE' | 'ARC';
      ent.x = 0; ent.y = 0; ent.radius = 0;
      let sa = 0, ea = 360;
      for (const { c, v } of pr) {
        if (c === 10) ent.x = num(v);
        else if (c === 20) ent.y = num(v);
        else if (c === 40) ent.radius = num(v);
        else if (c === 50) sa = num(v);
        else if (c === 51) ea = num(v);
      }
      if (rec.type === 'ARC') Object.assign(ent, makeArcAngles(sa, ea));
      return ent;
    }
    case 'ELLIPSE': {
      let cx = 0, cy = 0, mx = 1, my = 0, ratio = 1, sp = 0, ep = Math.PI * 2;
      for (const { c, v } of pr) {
        if (c === 10) cx = num(v);
        else if (c === 20) cy = num(v);
        else if (c === 11) mx = num(v);
        else if (c === 21) my = num(v);
        else if (c === 40) ratio = num(v);
        else if (c === 41) sp = num(v);
        else if (c === 42) ep = num(v);
      }
      return { type: 'LWPOLYLINE', points: ellipsePoints(cx, cy, mx, my, ratio, sp, ep), layer: '0' };
    }
    case 'SPLINE': {
      let degree = 3;
      const knots: number[] = [];
      const weights: number[] = [];
      const ctrl: SplineCtrl[] = [];
      const fit: SplineCtrl[] = [];
      for (const { c, v } of pr) {
        if (c === 71) degree = parseInt(v, 10) || 3;
        else if (c === 40) knots.push(num(v));
        else if (c === 41) weights.push(num(v));
        else if (c === 10) ctrl.push({ x: num(v), y: 0 });
        else if (c === 20 && ctrl.length) ctrl[ctrl.length - 1].y = num(v);
        else if (c === 11) fit.push({ x: num(v), y: 0 });
        else if (c === 21 && fit.length) fit[fit.length - 1].y = num(v);
      }
      let points: number[];
      if (fit.length >= 2) {
        points = fit.flatMap((p) => [p.x, p.y]);
      } else {
        if (weights.length === ctrl.length) ctrl.forEach((p, i) => { p.w = weights[i]; });
        points = splinePoints(ctrl, degree, knots);
      }
      return { type: 'LWPOLYLINE', points, layer: '0' };
    }
    case 'TEXT':
    case 'MTEXT': {
      ent.type = rec.type as 'TEXT' | 'MTEXT';
      ent.x = 0; ent.y = 0;
      let ax: number | undefined, ay: number | undefined;
      let h1 = 0, attach = 1;
      let rot: number | undefined;
      let last = '';
      const chunks: string[] = [];
      for (const { c, v } of pr) {
        if (c === 10) ent.x = num(v);
        else if (c === 20) ent.y = num(v);
        else if (c === 11) ax = num(v);
        else if (c === 21) ay = num(v);
        else if (c === 40) ent.height = num(v);
        else if (c === 50) rot = num(v);
        else if (c === 72 && rec.type === 'TEXT') h1 = parseInt(v, 10) || 0;
        else if (c === 71 && rec.type === 'MTEXT') attach = parseInt(v, 10) || 1;
        else if (c === 3) chunks.push(v);
        else if (c === 1) last = v;
      }
      if (rec.type === 'TEXT') {
        if (h1 !== 0 && ax !== undefined && ay !== undefined) { ent.x = ax; ent.y = ay; }
        ent.align = h1 === 1 || h1 === 4 ? 'center' : h1 === 2 ? 'right' : 'left';
        ent.text = decodeTextCodes(last);
      } else {
        const col = (attach - 1) % 3;
        ent.align = col === 1 ? 'center' : col === 2 ? 'right' : 'left';
        ent.text = stripMtext(chunks.join('') + last);
        if (rot === undefined && ax !== undefined && ay !== undefined) rot = Math.atan2(ay, ax) / DEG;
      }
      if (rot !== undefined && rot !== 0) ent.rotation = rot;
      return ent;
    }
  }
  return null;
}

function parseEntityRecords(recs: Rec[]): RawItem[] {
  const items: RawItem[] = [];
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    let layer = '0';
    let aci: number | undefined;
    let trueColor: number | undefined;
    for (const { c, v } of rec.pairs) {
      if (c === 8) layer = v.trim();
      else if (c === 62) { const a = parseInt(v, 10); if (!isNaN(a)) aci = Math.abs(a); }
      else if (c === 420) { const t = parseInt(v, 10); if (!isNaN(t)) trueColor = t; }
    }
    if (rec.type === 'INSERT') {
      const it: InsertItem = {
        kind: 'insert', name: '', x: 0, y: 0, sx: 1, sy: 1, rotDeg: 0, cols: 1, rows: 1, dx: 0, dy: 0,
        layer, aci, trueColor,
      };
      for (const { c, v } of rec.pairs) {
        if (c === 2) it.name = v.trim();
        else if (c === 10) it.x = num(v);
        else if (c === 20) it.y = num(v);
        else if (c === 41) it.sx = num(v) || 1;
        else if (c === 42) it.sy = num(v) || 1;
        else if (c === 50) it.rotDeg = num(v);
        else if (c === 70) it.cols = Math.max(1, parseInt(v, 10) || 1);
        else if (c === 71) it.rows = Math.max(1, parseInt(v, 10) || 1);
        else if (c === 44) it.dx = num(v);
        else if (c === 45) it.dy = num(v);
      }
      items.push(it);
      // skip attributes up to SEQEND when the INSERT carries ATTRIBs (code 66)
      if (rec.pairs.some((p) => p.c === 66 && parseInt(p.v, 10) === 1)) {
        while (i + 1 < recs.length && recs[i + 1].type !== 'SEQEND') i++;
        i++;
      }
      continue;
    }
    const vertexRecs: Rec[] = [];
    if (rec.type === 'POLYLINE') {
      while (i + 1 < recs.length && recs[i + 1].type === 'VERTEX') { vertexRecs.push(recs[i + 1]); i++; }
      if (i + 1 < recs.length && recs[i + 1].type === 'SEQEND') i++;
    }
    const ent = parseGeo(rec, vertexRecs);
    if (ent) {
      ent.layer = layer;
      items.push({ kind: 'geo', ent, layer, aci, trueColor });
    }
  }
  return items;
}

const MAX_BLOCK_DEPTH = 8;

interface ExpandCtx { layer: string; color?: string }

function resolveColor(it: RawItemBase, effLayer: string, ctx: ExpandCtx | null, layerColors: Record<string, string>): string | undefined {
  if (it.trueColor !== undefined) return `#${(it.trueColor & 0xffffff).toString(16).padStart(6, '0')}`;
  if (it.aci !== undefined && it.aci !== 256 && it.aci !== 0) return aciToHexColor(it.aci);
  if (it.aci === 0 && ctx?.color) return ctx.color; // BYBLOCK: inherit the INSERT's colour
  return layerColors[effLayer]; // BYLAYER (256 / unset)
}

function expandItems(
  items: RawItem[], blocks: Map<string, BlockDef>, layerColors: Record<string, string>,
  ctx: ExpandCtx | null, depth: number, warnings: string[], out: CadEntity[]
): void {
  for (const it of items) {
    const effLayer = ctx && it.layer === '0' ? ctx.layer : it.layer;
    const color = resolveColor(it, effLayer, ctx, layerColors);
    if (it.kind === 'geo') {
      const e: CadEntity = { ...it.ent, layer: effLayer };
      if (color) e.color = color;
      out.push(e);
      continue;
    }
    const block = blocks.get(it.name);
    if (!block) { warnings.push(`INSERT references missing block "${it.name}".`); continue; }
    if (depth >= MAX_BLOCK_DEPTH) { warnings.push(`Block nesting deeper than ${MAX_BLOCK_DEPTH} levels skipped at "${it.name}".`); continue; }
    const local: CadEntity[] = [];
    expandItems(block.items, blocks, layerColors, { layer: effLayer, color }, depth + 1, warnings, local);
    const rot = it.rotDeg * DEG;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let r = 0; r < it.rows; r++) {
      for (let c = 0; c < it.cols; c++) {
        const ox = c * it.dx, oy = r * it.dy; // spacing is along the rotated axes
        const xf: InsertXf = {
          baseX: block.baseX, baseY: block.baseY,
          insX: it.x + ox * cr - oy * sr, insY: it.y + ox * sr + oy * cr,
          sx: it.sx, sy: it.sy, rot,
        };
        for (const e of local) out.push(transformEntityByInsert(e, xf));
      }
    }
  }
}

export function parseDxfText(dxfText: string): ParsedDxf {
  const pairs = tokenize(dxfText);
  const warnings: string[] = [];
  const layerColors: Record<string, string> = {};
  const blocks = new Map<string, BlockDef>();
  let insunits: number | undefined;
  let entityItems: RawItem[] = [];

  let i = 0;
  while (i < pairs.length) {
    if (pairs[i].c === 0 && pairs[i].v.trim() === 'SECTION' && pairs[i + 1]?.c === 2) {
      const name = pairs[i + 1].v.trim();
      let j = i + 2;
      while (j < pairs.length && !(pairs[j].c === 0 && pairs[j].v.trim() === 'ENDSEC')) j++;
      const body = pairs.slice(i + 2, j);
      if (name === 'HEADER') {
        let cur = '';
        for (const p of body) {
          if (p.c === 9) cur = p.v.trim();
          else if (cur === '$INSUNITS' && p.c === 70) insunits = parseInt(p.v, 10);
        }
      } else if (name === 'TABLES') {
        for (const rec of splitRecords(body)) {
          if (rec.type !== 'LAYER') continue;
          let lname = '';
          let aci = 7;
          let tc: number | undefined;
          for (const { c, v } of rec.pairs) {
            if (c === 2) lname = v.trim();
            else if (c === 62) aci = Math.abs(parseInt(v, 10) || 7);
            else if (c === 420) tc = parseInt(v, 10);
          }
          if (lname) {
            layerColors[lname] = tc !== undefined && !isNaN(tc)
              ? `#${(tc & 0xffffff).toString(16).padStart(6, '0')}`
              : aciToHexColor(aci);
          }
        }
      } else if (name === 'BLOCKS') {
        let cur: BlockDef | null = null;
        let acc: Rec[] = [];
        const flush = () => {
          if (cur) { cur.items = parseEntityRecords(acc); blocks.set(cur.name, cur); }
          cur = null;
          acc = [];
        };
        for (const rec of splitRecords(body)) {
          if (rec.type === 'BLOCK') {
            flush();
            const b: BlockDef = { name: '', baseX: 0, baseY: 0, items: [] };
            for (const { c, v } of rec.pairs) {
              if (c === 2 && !b.name) b.name = v.trim();
              else if (c === 10) b.baseX = num(v);
              else if (c === 20) b.baseY = num(v);
            }
            cur = b;
          } else if (rec.type === 'ENDBLK') {
            flush();
          } else if (cur) {
            acc.push(rec);
          }
        }
        flush();
      } else if (name === 'ENTITIES') {
        entityItems = parseEntityRecords(splitRecords(body));
      }
      i = j + 1;
    } else {
      i++;
    }
  }

  const expanded: CadEntity[] = [];
  expandItems(entityItems, blocks, layerColors, null, 0, warnings, expanded);

  const entities = expanded.filter((ent) => {
    if (ent.type === 'LINE') {
      return isFinite(ent.x ?? NaN) && isFinite(ent.y ?? NaN) && isFinite(ent.points?.[0] ?? NaN) && isFinite(ent.points?.[1] ?? NaN);
    }
    if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
      return !!ent.points && ent.points.length >= 4 && ent.points.every((p) => isFinite(p));
    }
    if (ent.type === 'CIRCLE' || ent.type === 'ARC') {
      return isFinite(ent.x ?? NaN) && isFinite(ent.y ?? NaN) && (ent.radius ?? 0) > 0;
    }
    if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
      return isFinite(ent.x ?? NaN) && isFinite(ent.y ?? NaN) && !!ent.text;
    }
    return false;
  });

  return { entities, bbox: entitiesBbox(entities), layerColors, insunits, warnings };
}
