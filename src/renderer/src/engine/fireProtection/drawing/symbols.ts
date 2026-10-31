/**
 * Fire-protection CAD symbols (valves, fittings, plan equipment, sheet furniture).
 * Valve/fitting symbols are drawn at (x, y), flow along +u rotated by angleDeg, sized from the pipe OD.
 */
import type { DrawingBuilder } from './drawingBuilder';
import type { SheetInfo } from './drawingTypes';

type Pt = [number, number];

export interface PlanRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Local coordinate frame: u along the flow, v to the left of the flow, origin (x, y), rotated by angleDeg. */
class Frame {
  private readonly c: number;
  private readonly s: number;
  constructor(
    private readonly b: DrawingBuilder,
    private readonly x: number,
    private readonly y: number,
    private readonly angleDeg: number,
    private readonly layer = 'FP-VALV'
  ) {
    const a = (angleDeg * Math.PI) / 180;
    this.c = Math.cos(a);
    this.s = Math.sin(a);
  }
  pt(u: number, v: number): Pt {
    return [this.x + u * this.c - v * this.s, this.y + u * this.s + v * this.c];
  }
  line(u1: number, v1: number, u2: number, v2: number): void {
    const a = this.pt(u1, v1);
    const p = this.pt(u2, v2);
    this.b.line(this.layer, a[0], a[1], p[0], p[1]);
  }
  poly(pts: Pt[], closed: boolean): void {
    this.b.polyline(this.layer, pts.map(([u, v]) => this.pt(u, v)), closed);
  }
  solid(pts: Pt[]): void {
    this.b.solid(this.layer, pts.map(([u, v]) => this.pt(u, v)));
  }
  circle(u: number, v: number, r: number): void {
    const p = this.pt(u, v);
    this.b.circle(this.layer, p[0], p[1], r);
  }
  arc(u: number, v: number, r: number, a0: number, a1: number): void {
    const p = this.pt(u, v);
    this.b.arc(this.layer, p[0], p[1], r, a0 + this.angleDeg, a1 + this.angleDeg);
  }
  /** Upright (unrotated) text, height in model mm. */
  text(u: number, v: number, hModel: number, t: string): void {
    const p = this.pt(u, v);
    this.b.text(this.layer, p[0], p[1], hModel / this.b.scale, t, { align: 'center', vAlign: 'middle' });
  }
  /** Filled disc approximated by two overlapping solid squares (octagon). */
  disc(u: number, v: number, r: number): void {
    this.solid([[u - r, v - r], [u + r, v - r], [u + r, v + r], [u - r, v + r]]);
    const q = r * Math.SQRT2;
    this.solid([[u, v - q], [u + q, v], [u, v + q], [u - q, v]]);
  }
}

const size = (od: number): number => Math.max(od, 20);

/** Bow-tie body: two triangles tip-to-tip, length d, height 0.6 d. Returns half height. */
function bowTie(f: Frame, d: number, fillLeft = false): number {
  const hh = 0.3 * d;
  const left: Pt[] = [[-d / 2, -hh], [-d / 2, hh], [0, 0]];
  const right: Pt[] = [[d / 2, -hh], [d / 2, hh], [0, 0]];
  if (fillLeft) f.solid(left);
  else f.poly(left, true);
  f.poly(right, true);
  return hh;
}

/** OS&Y gate valve: bow-tie, bonnet yoke, rising stem and handwheel. */
export function gateValve(b: DrawingBuilder, x: number, y: number, angleDeg: number, odMm: number): void {
  const d = size(odMm);
  const f = new Frame(b, x, y, angleDeg);
  bowTie(f, d);
  f.line(-0.1 * d, 0.06 * d, -0.1 * d, 0.8 * d); // yoke
  f.line(0.1 * d, 0.06 * d, 0.1 * d, 0.8 * d);
  f.line(0, 0, 0, 1.12 * d); // rising stem
  f.poly([[-0.3 * d, 0.92 * d], [0.3 * d, 0.92 * d], [0.3 * d, 1.0 * d], [-0.3 * d, 1.0 * d]], true); // handwheel
}

/** Butterfly valve: bow-tie, disc bar, shaft circle, stem and lever handle. */
export function butterflyValve(b: DrawingBuilder, x: number, y: number, angleDeg: number, odMm: number): void {
  const d = size(odMm);
  const f = new Frame(b, x, y, angleDeg);
  bowTie(f, d);
  f.line(0, -0.38 * d, 0, 0.38 * d); // disc
  f.circle(0, 0, 0.07 * d); // shaft
  f.line(0, 0.38 * d, 0, 0.7 * d); // stem / gear neck
  f.line(-0.22 * d, 0.7 * d, 0.22 * d, 0.7 * d); // handle
}

/** Swing check valve: bow-tie with the inlet triangle filled and an open flow arrow. */
export function checkValve(b: DrawingBuilder, x: number, y: number, angleDeg: number, odMm: number): void {
  const d = size(odMm);
  const f = new Frame(b, x, y, angleDeg);
  bowTie(f, d, true);
  f.line(-0.25 * d, 0.5 * d, 0.25 * d, 0.5 * d);
  f.poly([[0.1 * d, 0.58 * d], [0.25 * d, 0.5 * d], [0.1 * d, 0.42 * d]], false);
}

/** Pressure relief valve: angle body (inlet along the pipe, outlet to the side) with spring and adjusting screw. */
export function reliefValve(b: DrawingBuilder, x: number, y: number, angleDeg: number, odMm: number): void {
  const d = size(odMm);
  const f = new Frame(b, x, y, angleDeg);
  f.poly([[-0.5 * d, -0.3 * d], [-0.5 * d, 0.3 * d], [0, 0]], true); // inlet triangle on the line
  f.poly([[-0.3 * d, -0.5 * d], [0.3 * d, -0.5 * d], [0, 0]], true); // outlet triangle to the side
  f.line(0, -0.5 * d, 0, -0.85 * d); // outlet stub
  f.line(-0.5 * d, 0, -0.75 * d, 0); // inlet stub
  // spring zig-zag
  const pts: Pt[] = [[0, 0.1 * d]];
  const n = 6;
  const y0 = 0.2 * d;
  const y1 = 0.85 * d;
  for (let i = 0; i < n; i++) pts.push([(i % 2 === 0 ? 1 : -1) * 0.14 * d, y0 + ((i + 0.5) / n) * (y1 - y0)]);
  pts.push([0, 0.95 * d]);
  f.poly(pts, false);
  f.line(-0.2 * d, 0.95 * d, 0.2 * d, 0.95 * d); // adjusting screw plate
  f.line(0, 0.95 * d, 0, 1.1 * d);
}

/** In-line flow meter: circle with FM. */
export function flowMeter(b: DrawingBuilder, x: number, y: number, angleDeg: number, odMm: number): void {
  const d = size(odMm);
  const f = new Frame(b, x, y, angleDeg);
  f.circle(0, 0, 0.5 * d);
  f.line(-0.5 * d, -0.5 * d, -0.5 * d, 0.5 * d);
  f.line(0.5 * d, -0.5 * d, 0.5 * d, 0.5 * d);
  f.text(0, 0, 0.36 * d, 'FM');
}

/** Pressure gauge: small circle on a stem (off the pipe on the +v side) with PG. */
export function pressureGauge(b: DrawingBuilder, x: number, y: number, angleDeg: number, odMm: number): void {
  const d = size(odMm);
  const f = new Frame(b, x, y, angleDeg);
  f.line(0, 0, 0, 0.6 * d);
  f.circle(0, 0.9 * d, 0.3 * d);
  f.text(0, 0.9 * d, 0.24 * d, 'PG');
}

/** Eccentric reducer, flat top: large end (odLarge) at -u, small end at +u, centred on (x, y) = large-end axis. */
export function eccentricReducer(b: DrawingBuilder, x: number, y: number, angleDeg: number, odLargeMm: number, odSmallMm: number): void {
  const f = new Frame(b, x, y, angleDeg);
  const L = Math.max(odLargeMm, odSmallMm, 20);
  const R = odLargeMm / 2;
  f.poly([[-L / 2, -R], [-L / 2, R], [L / 2, R], [L / 2, R - odSmallMm]], true);
}

/** Concentric reducer / increaser: flow enters at -u with odInMm and leaves at +u with odOutMm. */
export function concentricReducer(b: DrawingBuilder, x: number, y: number, angleDeg: number, odInMm: number, odOutMm: number): void {
  const f = new Frame(b, x, y, angleDeg);
  const L = Math.max(odInMm, odOutMm, 20);
  f.poly([[-L / 2, -odInMm / 2], [-L / 2, odInMm / 2], [L / 2, odOutMm / 2], [L / 2, -odOutMm / 2]], true);
}

/** Angle hose valve with handwheel and capped outlet. */
export function hoseValve(b: DrawingBuilder, x: number, y: number, angleDeg: number, odMm: number): void {
  const d = size(odMm);
  const f = new Frame(b, x, y, angleDeg);
  f.poly([[-0.5 * d, -0.3 * d], [-0.5 * d, 0.3 * d], [0, 0]], true);
  f.poly([[-0.3 * d, 0.5 * d], [0.3 * d, 0.5 * d], [0, 0]], true);
  f.line(0, 0.5 * d, 0, 0.8 * d); // outlet
  f.poly([[-0.2 * d, 0.8 * d], [0.2 * d, 0.8 * d], [0.2 * d, 0.95 * d], [-0.2 * d, 0.95 * d]], true); // cap
  f.line(0, 0, 0, -0.6 * d); // stem
  f.line(-0.25 * d, -0.6 * d, 0.25 * d, -0.6 * d); // handwheel
}

/** Flexible (grooved / bellows) coupling: two short parallel bars joined by sleeve lines. */
export function flexibleCoupling(b: DrawingBuilder, x: number, y: number, angleDeg: number, odMm: number): void {
  const d = size(odMm);
  const f = new Frame(b, x, y, angleDeg);
  f.line(-0.15 * d, -0.6 * d, -0.15 * d, 0.6 * d);
  f.line(0.15 * d, -0.6 * d, 0.15 * d, 0.6 * d);
  f.line(-0.15 * d, 0.5 * d, 0.15 * d, 0.5 * d);
  f.line(-0.15 * d, -0.5 * d, 0.15 * d, -0.5 * d);
}

/** Ball valve: bow-tie with a solid ball and lever handle. */
export function ballValve(b: DrawingBuilder, x: number, y: number, angleDeg: number, odMm: number): void {
  const d = size(odMm);
  const f = new Frame(b, x, y, angleDeg);
  bowTie(f, d);
  f.disc(0, 0, 0.1 * d);
  f.line(0, 0.1 * d, 0, 0.55 * d);
  f.line(-0.1 * d, 0.55 * d, 0.35 * d, 0.55 * d);
}

// ─────────────────────────────── Plan equipment ───────────────────────────────

/**
 * Pump set in plan. `rect` is the SKID / base plate (w across x, h along the shaft y, hydraulic end at the
 * south, driver at the north); the housekeeping pad is drawn 150 mm outside it. Suction nozzle on the west
 * edge and discharge nozzle on the east edge at y = rect.y + 0.25·h.
 */
export function pumpPlan(
  b: DrawingBuilder,
  rect: PlanRect,
  kind: 'hsc' | 'end-suction' | 'jockey',
  driver: 'electric' | 'diesel',
  tag: string
): void {
  const { x, y, w, h } = rect;
  const E = 'FP-EQPM';
  const pad = 150;
  b.rect('FP-PADS', x - pad, y - pad, w + 2 * pad, h + 2 * pad);
  b.rect(E, x, y, w, h);
  const cx = x + w / 2;
  const yn = y + 0.25 * h;
  const nh = Math.min(0.14 * w, 0.07 * h);
  let casingTop: number;
  let casingW: number;
  if (kind === 'hsc') {
    const hx0 = x + 0.15 * w;
    const hx1 = x + 0.85 * w;
    const cy0 = yn - 0.15 * h;
    const cy1 = yn + 0.15 * h;
    casingW = hx1 - hx0;
    b.rect(E, hx0, cy0, casingW, cy1 - cy0);
    b.line(E, cx, cy0, cx, cy1); // horizontal split joint
    b.rect(E, cx - 0.1 * w, cy0 - 0.05 * h, 0.2 * w, 0.05 * h); // outboard bearing housing
    b.rect(E, cx - 0.1 * w, cy1, 0.2 * w, 0.04 * h); // inboard bearing housing
    casingTop = cy1 + 0.04 * h;
    for (const [xa, xb] of [[x, hx0], [hx1, x + w]]) {
      b.rect(E, xa, yn - nh, xb - xa, 2 * nh);
    }
  } else {
    const r = Math.min(0.3 * w, 0.22 * h);
    casingW = 2 * r;
    b.circle(E, cx, yn, r);
    b.circle(E, cx, yn, 0.35 * r); // eye / shaft
    b.line(E, x, yn - nh, cx - r, yn - nh);
    b.line(E, x, yn + nh, cx - r, yn + nh);
    b.line(E, cx + r, yn - nh, x + w, yn - nh);
    b.line(E, cx + r, yn + nh, x + w, yn + nh);
    b.rect(E, cx - 0.15 * w, yn + r, 0.3 * w, 0.06 * h); // bearing frame
    casingTop = yn + r + 0.06 * h;
  }
  // flange faces at the skid edge
  b.line(E, x, yn - 1.4 * nh, x, yn + 1.4 * nh);
  b.line(E, x + w, yn - 1.4 * nh, x + w, yn + 1.4 * nh);
  // coupling guard
  const gap = 0.1 * h;
  b.rect(E, cx - Math.min(0.14 * w, casingW / 3), casingTop, 2 * Math.min(0.14 * w, casingW / 3), gap);
  b.line('FP-CNTR', cx, y + 0.02 * h, cx, y + 0.98 * h);
  const d0 = casingTop + gap;
  const d1 = y + 0.97 * h;
  const dl = d1 - d0;
  if (driver === 'electric') {
    const mw = 0.38 * w;
    b.rect(E, cx - mw, d0, 2 * mw, dl);
    const fin = Math.max(0.03 * h, 30);
    for (let yy = d0 + 0.08 * dl; yy < d1 - 0.18 * dl; yy += fin) b.line(E, cx - mw, yy, cx + mw, yy);
    b.rect(E, cx - 0.28 * w, d1 - 0.12 * dl, 0.56 * w, 0.12 * dl); // fan cowl
    b.rect(E, cx + mw, d0 + 0.45 * dl, 0.07 * w, 0.12 * dl); // terminal box
  } else {
    const ew = 0.4 * w;
    b.rect(E, cx - 0.3 * w, d0, 0.6 * w, 0.07 * dl); // flywheel housing
    const e0 = d0 + 0.07 * dl;
    const e1 = d0 + 0.62 * dl;
    b.rect(E, cx - ew, e0, 2 * ew, e1 - e0); // engine block
    b.rect(E, cx - 0.7 * ew, e0 + 0.1 * (e1 - e0), 1.4 * ew, 0.8 * (e1 - e0)); // rocker cover
    b.circle(E, cx + 0.55 * ew, e1 + 0.1 * dl, 0.08 * w); // exhaust / silencer riser
    b.line(E, cx + 0.55 * ew, e1, cx + 0.55 * ew, e1 + 0.1 * dl - 0.08 * w);
    const r0 = d0 + 0.8 * dl;
    b.rect(E, cx - ew, r0, 2 * ew, d1 - r0); // radiator
    for (let i = 1; i < 6; i++) b.line(E, cx - ew, r0 + (i / 6) * (d1 - r0), cx + ew, r0 + (i / 6) * (d1 - r0));
  }
  b.text('FP-ANNO', cx, d0 + 0.5 * dl, 3, tag, { rotationDeg: 90, align: 'center', vAlign: 'middle' });
}

/** Fire pump / jockey controller in plan: outline, diagonal, tag/label and a double door swinging toward -x. */
export function controlPanelPlan(b: DrawingBuilder, rect: PlanRect, tag: string, label: string): void {
  const { x, y, w, h } = rect;
  const layer = 'FP-ELEC';
  b.rect(layer, x, y, w, h);
  b.line(layer, x, y, x + w, y + h);
  const lf = h / 2;
  b.line(layer, x, y, x - lf, y);
  b.arc(layer, x, y, lf, 90, 180);
  b.line(layer, x, y + h, x - lf, y + h);
  b.arc(layer, x, y + h, lf, 180, 270);
  b.text('FP-ANNO', x + w / 2, y + 0.25 * h, 2.5, tag, { rotationDeg: 90, align: 'center', vAlign: 'middle' });
  b.text('FP-ANNO', x + w / 2, y + 0.72 * h, 1.8, label, { rotationDeg: 90, align: 'center', vAlign: 'middle' });
}

export interface WallRef {
  orientation: 'horizontal' | 'vertical';
  thicknessMm: number;
  /** +1: leaves swing toward +y (horizontal wall) / +x (vertical wall); -1 the opposite side. Default -1. */
  swing?: 1 | -1;
}

function wallFrame(wall: WallRef): { a: Pt; n: Pt } {
  return wall.orientation === 'horizontal' ? { a: [1, 0], n: [0, 1] } : { a: [0, 1], n: [1, 0] };
}

function quarterArc(b: DrawingBuilder, layer: string, cx: number, cy: number, r: number, a0: number, a1: number): void {
  const norm = (v: number): number => ((v % 360) + 360) % 360;
  if (Math.abs(norm(a1 - a0) - 90) < 1e-6) b.arc(layer, cx, cy, r, norm(a0), norm(a1));
  else b.arc(layer, cx, cy, r, norm(a1), norm(a0));
}

/** Door in a wall; (x, y) = lower-left corner of the opening. ≥1500 mm wide ⇒ double leaf. */
export function doorPlan(b: DrawingBuilder, x: number, y: number, width: number, wall: WallRef): void {
  const layer = 'FP-ARCH';
  const { a, n } = wallFrame(wall);
  const t = wall.thicknessMm;
  const P = (s: number, k: number): Pt => [x + a[0] * s + n[0] * k, y + a[1] * s + n[1] * k];
  const sw = wall.swing ?? -1;
  const k0 = sw > 0 ? t : 0;
  const deg = (v: Pt): number => (Math.atan2(v[1], v[0]) * 180) / Math.PI;
  const nOpen: Pt = [n[0] * sw, n[1] * sw];
  const j0a = P(0, 0);
  const j0b = P(0, t);
  const j1a = P(width, 0);
  const j1b = P(width, t);
  b.line(layer, j0a[0], j0a[1], j0b[0], j0b[1]);
  b.line(layer, j1a[0], j1a[1], j1b[0], j1b[1]);
  const leaves: [number, number, number][] = width >= 1500 ? [[0, 1, width / 2], [width, -1, width / 2]] : [[0, 1, width]];
  for (const [s0, dirA, len] of leaves) {
    const h = P(s0, k0);
    const closedEnd: Pt = [h[0] + a[0] * dirA * len, h[1] + a[1] * dirA * len];
    const openEnd: Pt = [h[0] + nOpen[0] * len, h[1] + nOpen[1] * len];
    b.line(layer, h[0], h[1], openEnd[0], openEnd[1]);
    b.line(layer, h[0], h[1], closedEnd[0], closedEnd[1]);
    quarterArc(b, layer, h[0], h[1], len, deg([a[0] * dirA, a[1] * dirA]), deg(nOpen));
  }
}

/** Louvre in a wall; (x, y) = lower-left corner of the opening. */
export function louverPlan(b: DrawingBuilder, x: number, y: number, width: number, wall: WallRef): void {
  const layer = 'FP-ARCH';
  const { a, n } = wallFrame(wall);
  const t = wall.thicknessMm;
  const P = (s: number, k: number): Pt => [x + a[0] * s + n[0] * k, y + a[1] * s + n[1] * k];
  const seg = (s0: number, k0: number, s1: number, k1: number): void => {
    const p = P(s0, k0);
    const q = P(s1, k1);
    b.line(layer, p[0], p[1], q[0], q[1]);
  };
  seg(0, 0, 0, t);
  seg(width, 0, width, t);
  seg(0, 0.25 * t, width, 0.25 * t);
  seg(0, 0.75 * t, width, 0.75 * t);
  const pitch = 100;
  const pts: Pt[] = [];
  let up = false;
  for (let s = 0; s <= width + 1e-6; s += pitch) {
    pts.push(P(Math.min(s, width), (up ? 0.75 : 0.25) * t));
    up = !up;
  }
  if (pts.length > 1) b.polyline(layer, pts, false);
}

/** North arrow: circle, half-filled arrow and "N". */
export function northArrow(b: DrawingBuilder, x: number, y: number): void {
  const s = b.scale;
  const layer = 'FP-ANNO';
  b.circle(layer, x, y, 6 * s);
  b.polyline(layer, [[x, y + 7 * s], [x - 2.5 * s, y - 5 * s], [x, y - 3 * s], [x + 2.5 * s, y - 5 * s]], true);
  b.solid(layer, [[x, y + 7 * s], [x, y - 3 * s], [x + 2.5 * s, y - 5 * s]]);
  b.text(layer, x, y + 8.5 * s, 3.5, 'N', { align: 'center', vAlign: 'bottom' });
}

export interface TitleBlockFields {
  project: string;
  projectNumber: string;
  drawingTitle: string;
  sheetNumber: string;
  scaleText: string;
  date: string;
  drawnBy: string;
  checkedBy: string;
  standards: string;
}

/**
 * Sheet frame + title block. Sets b.scale = sheet.scale. Frame = paper size × scale at the sheet origin;
 * 20 mm left / 10 mm other margins; 180 × 60 mm block bottom-right with a 3-row revision table.
 */
export function titleBlock(b: DrawingBuilder, sheet: SheetInfo, fields: TitleBlockFields): void {
  b.scale = sheet.scale;
  const s = sheet.scale;
  const layer = 'FP-TBLK';
  const W = sheet.paperWidthMm;
  const H = sheet.paperHeightMm;
  const X = (px: number): number => sheet.originX + px * s;
  const Y = (py: number): number => sheet.originY + py * s;
  const rectP = (px: number, py: number, pw: number, ph: number): void => b.rect(layer, X(px), Y(py), pw * s, ph * s);
  const lineP = (x1: number, y1: number, x2: number, y2: number): void => b.line(layer, X(x1), Y(y1), X(x2), Y(y2));
  const fit = (str: string, hP: number, widthP: number): number => Math.max(1.2, Math.min(hP, (widthP - 2) / (0.6 * Math.max(1, str.length))));

  rectP(0, 0, W, H); // trim edge
  rectP(20, 10, W - 30, H - 20); // drawing frame
  const bx = W - 10 - 180;
  const by = 10;
  rectP(bx, by, 180, 60);

  // revision table (top 20 mm): header + 3 rows of 5 mm
  const revCols = [12, 28, 110, 15, 15];
  const revHead = ['REV', 'DATE', 'DESCRIPTION', 'BY', 'CHK'];
  const revRows: string[][] = [['0', fields.date, 'ISSUED FOR REVIEW', fields.drawnBy, fields.checkedBy], ['', '', '', '', ''], ['', '', '', '', '']];
  const yRevTop = by + 60;
  for (let r = 1; r <= 4; r++) lineP(bx, yRevTop - r * 5, bx + 180, yRevTop - r * 5);
  let cxp = bx;
  for (let c = 0; c < revCols.length; c++) {
    if (c > 0) lineP(cxp, yRevTop, cxp, yRevTop - 20);
    const cells = [revHead[c], ...revRows.map((row) => row[c])];
    cells.forEach((txt, r) => {
      if (txt) b.text(layer, X(cxp + 1.2), Y(yRevTop - r * 5 - 2.5), fit(txt, r === 0 ? 2 : 2.2, revCols[c]), txt, { vAlign: 'middle' });
    });
    cxp += revCols[c];
  }

  // information rows (bottom 40 mm): A 31..40, B 19..31, C 9..19, D 0..9 (block-local)
  const cell = (px: number, py: number, pw: number, ph: number, label: string, value: string, vh: number): void => {
    rectP(px, py, pw, ph);
    b.text(layer, X(px + 1), Y(py + ph - 1), 1.6, label, { vAlign: 'top' });
    b.text(layer, X(px + 1.2), Y(py + 1.5), fit(value, vh, pw), value, { vAlign: 'baseline' });
  };
  cell(bx, by + 31, 130, 9, 'PROJECT', fields.project, 3.5);
  cell(bx + 130, by + 31, 50, 9, 'PROJECT NO.', fields.projectNumber, 3.5);
  cell(bx, by + 19, 180, 12, 'DRAWING TITLE', fields.drawingTitle, 5);
  cell(bx, by + 9, 40, 10, 'SHEET NO.', fields.sheetNumber, 4.5);
  cell(bx + 40, by + 9, 30, 10, 'SCALE', fields.scaleText, 3.5);
  cell(bx + 70, by + 9, 40, 10, 'DATE', fields.date, 3.5);
  cell(bx + 110, by + 9, 35, 10, 'DRAWN BY', fields.drawnBy, 3.5);
  cell(bx + 145, by + 9, 35, 10, 'CHECKED BY', fields.checkedBy, 3.5);
  cell(bx, by, 180, 9, 'STANDARDS', fields.standards, 3);
}
