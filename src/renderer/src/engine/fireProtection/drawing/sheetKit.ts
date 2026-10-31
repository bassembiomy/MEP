/**
 * Shared helpers for the FP-101 … FP-105 sheet generators: paper-space mapping, text/tag collision
 * avoidance (Placer), auto-sized tables, wrapped note blocks, wall segmentation and the symbol legend.
 */
import type { DrawingBuilder } from './drawingBuilder';
import type { SheetInfo, TextAlign, TextVAlign } from './drawingTypes';
import type { FireDesignResult } from '../fpTypes';
import {
  ballValve,
  butterflyValve,
  checkValve,
  concentricReducer,
  eccentricReducer,
  flexibleCoupling,
  flowMeter,
  gateValve,
  hoseValve,
  pressureGauge,
  reliefValve
} from './symbols';

export type Pt = [number, number];

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Ctx {
  b: DrawingBuilder;
  sheet: SheetInfo;
  r: FireDesignResult;
}

/** Drawing frame in paper mm (20 mm binding margin, 10 mm elsewhere) and the title block. */
export const FRAME = { x0: 20, y0: 10, x1: 831, y1: 584 };
export const TBLK = { x0: 651, y0: 10, x1: 831, y1: 70 };

/** Paper → model conversion for one sheet. */
export const PX = (c: Ctx, v: number): number => c.sheet.originX + v * c.sheet.scale;
export const PY = (c: Ctx, v: number): number => c.sheet.originY + v * c.sheet.scale;

/** Approximate text width, identical to the estimate used by the bounding-box tests. */
export const textWidth = (h: number, s: string): number => h * 0.6 * s.length;

export function textBox(x: number, y: number, h: number, s: string, align: TextAlign, vAlign: TextVAlign, rot = 0): Box {
  const w = textWidth(h, s);
  const x0 = align === 'left' ? 0 : align === 'center' ? -w / 2 : -w;
  const y0 = vAlign === 'middle' ? -h / 2 : vAlign === 'top' ? -h : 0;
  const a = (rot * Math.PI) / 180;
  const co = Math.cos(a);
  const si = Math.sin(a);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [u, v] of [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]) {
    xs.push(x + u * co - v * si);
    ys.push(y + u * si + v * co);
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const contains = (a: Box, p: Pt): boolean => p[0] >= a.x0 && p[0] <= a.x1 && p[1] >= a.y0 && p[1] <= a.y1;
const overlap = (a: Box, b: Box, pad = 0): boolean => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;

/** Collision registry: hard obstacles (equipment, text, tags) and soft ones (pipes, which leaders may cross). */
export class Placer {
  readonly hard: Box[] = [];
  readonly soft: Box[] = [];
  readonly fallbacks: string[] = [];
  constructor(
    private readonly c: Ctx,
    private bounds: Box
  ) {}

  setBounds(b: Box): void {
    this.bounds = b;
  }

  addHard(b: Box): void {
    this.hard.push(b);
  }
  addSoft(b: Box): void {
    this.soft.push(b);
  }
  addRect(x: number, y: number, w: number, h: number, soft = false): void {
    (soft ? this.soft : this.hard).push({ x0: x, y0: y, x1: x + w, y1: y + h });
  }
  free(b: Box, pad = 0, includeSoft = true): boolean {
    if (b.x0 < this.bounds.x0 || b.x1 > this.bounds.x1 || b.y0 < this.bounds.y0 || b.y1 > this.bounds.y1) return false;
    if (this.hard.some((h) => overlap(b, h, pad))) return false;
    if (includeSoft && this.soft.some((h) => overlap(b, h, pad))) return false;
    return true;
  }

  /** Draw text and register its box. */
  text(
    layer: string,
    x: number,
    y: number,
    hPaper: number,
    s: string,
    o: { rotationDeg?: number; align?: TextAlign; vAlign?: TextVAlign; register?: boolean } = {}
  ): Box {
    const { b, sheet } = this.c;
    const h = hPaper * sheet.scale;
    const align = o.align ?? 'left';
    const vAlign = o.vAlign ?? 'baseline';
    const bx = textBox(x, y, h, s, align, vAlign, o.rotationDeg ?? 0);
    b.text(layer, x, y, hPaper, s, { rotationDeg: o.rotationDeg, align, vAlign });
    if (o.register !== false) this.hard.push(bx);
    return bx;
  }

  /**
   * Tag (circle / stadium) with a leader to `anchor`, placed at the nearest free candidate position.
   * `prefer` angles (deg) are tried first at every radius.
   */
  tag(anchor: Pt, text: string, prefer: number[] = [90, 270, 0, 180, 45, 135, 225, 315, 60, 120, 240, 300, 20, 160, 200, 340]): Pt {
    const { b, sheet } = this.c;
    const s = sheet.scale;
    const hw = (text.length <= 4 ? 6 : Math.max(6, text.length * 1.25 + 3)) * s / 2;
    const hh = 3 * s;
    const radii = [6, 8, 10.5, 13, 16, 20, 25, 31, 38, 46, 56].map((k) => k * s);
    for (const rad of radii) {
      for (const ang of prefer) {
        const a = (ang * Math.PI) / 180;
        const cx = anchor[0] + Math.cos(a) * rad;
        const cy = anchor[1] + Math.sin(a) * rad;
        const box: Box = { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
        if (!this.free(box, 0.6 * s)) continue;
        // leader must not cross hard obstacles
        let ok = true;
        const steps = 14;
        for (let i = 2; i < steps; i++) {
          const t = i / steps;
          const px = anchor[0] + (cx - anchor[0]) * t;
          const py = anchor[1] + (cy - anchor[1]) * t;
          const pb: Box = { x0: px - 0.2 * s, y0: py - 0.2 * s, x1: px + 0.2 * s, y1: py + 0.2 * s };
          if (this.hard.some((h) => overlap(pb, h) && !contains(h, anchor)) && !overlap(pb, box)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        // draw
        const dx = cx - anchor[0];
        const dy = cy - anchor[1];
        const dl = Math.hypot(dx, dy);
        const ux = dx / dl;
        const uy = dy / dl;
        // end of the leader on the tag outline (approximate by the box edge along the ray)
        const tEdge = Math.min(hw / Math.max(Math.abs(ux), 1e-9), hh / Math.max(Math.abs(uy), 1e-9));
        const edge = text.length <= 4 ? hh : tEdge;
        b.line('FP-ANNO', anchor[0], anchor[1], cx - ux * edge, cy - uy * edge);
        b.circle('FP-ANNO', anchor[0], anchor[1], 0.45 * s);
        drawTag(b, cx, cy, text, s);
        this.hard.push(box);
        return [cx, cy];
      }
    }
    // fallback: tag right on the anchor (should not happen)
    this.fallbacks.push(text);
    drawTag(b, anchor[0], anchor[1] + 5 * s, text, s);
    return anchor;
  }

  /**
   * Leader + multi-line text. Tries placing the text block at several offsets around `anchor`.
   * Returns the text box.
   */
  callout(anchor: Pt, lines: string[], hPaper = 2.5, prefer: number[] = [90, 45, 135, 0, 180, 270, 315, 225]): Box | null {
    const { b, sheet } = this.c;
    const s = sheet.scale;
    const h = hPaper * s;
    const pitch = h * 1.4;
    const w = Math.max(...lines.map((l) => textWidth(h, l)));
    const bh = lines.length * pitch;
    for (const rad of [10, 14, 19, 25, 32, 40, 50, 62, 76].map((k) => k * s)) {
      for (const ang of prefer) {
        const a = (ang * Math.PI) / 180;
        const ex = anchor[0] + Math.cos(a) * rad;
        const ey = anchor[1] + Math.sin(a) * rad;
        const right = Math.cos(a) >= -0.01;
        const box: Box = right
          ? { x0: ex + 0.8 * s, y0: ey - bh / 2, x1: ex + 0.8 * s + w, y1: ey + bh / 2 }
          : { x0: ex - 0.8 * s - w, y0: ey - bh / 2, x1: ex - 0.8 * s, y1: ey + bh / 2 };
        if (!this.free(box, 0.5 * s)) continue;
        let ok = true;
        for (let i = 2; i < 14; i++) {
          const t = i / 14;
          const px = anchor[0] + (ex - anchor[0]) * t;
          const py = anchor[1] + (ey - anchor[1]) * t;
          const pb: Box = { x0: px - 0.2 * s, y0: py - 0.2 * s, x1: px + 0.2 * s, y1: py + 0.2 * s };
          if (this.hard.some((q) => overlap(pb, q) && !contains(q, anchor))) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        arrowLine(b, anchor, [ex, ey], s);
        lines.forEach((t, i) => {
          this.text('FP-ANNO', right ? ex + 1 * s : ex - 1 * s, ey + bh / 2 - pitch * (i + 0.5), hPaper, t, {
            align: right ? 'left' : 'right',
            vAlign: 'middle',
            register: false
          });
        });
        this.hard.push(box);
        return box;
      }
    }
    return null;
  }
}

/** Compact tag: 6 mm circle (or stadium for long text) with 2 mm text (paper). */
export function drawTag(b: DrawingBuilder, x: number, y: number, text: string, s: number): void {
  const layer = 'FP-ANNO';
  if (text.length <= 4) b.circle(layer, x, y, 3 * s);
  else {
    const w = Math.max(6, text.length * 1.25 + 3) * s;
    const r = 3 * s;
    const hw = w / 2 - r;
    b.line(layer, x - hw, y + r, x + hw, y + r);
    b.line(layer, x - hw, y - r, x + hw, y - r);
    b.arc(layer, x - hw, y, r, 90, 270);
    b.arc(layer, x + hw, y, r, 270, 90);
  }
  b.text(layer, x, y, 2, text, { align: 'center', vAlign: 'middle' });
}

/** Leader line with a closed arrowhead at p0 (no text). */
export function arrowLine(b: DrawingBuilder, p0: Pt, p1: Pt, s: number, layer = 'FP-ANNO'): void {
  b.line(layer, p0[0], p0[1], p1[0], p1[1]);
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const dl = Math.hypot(dx, dy);
  if (dl < 4 * s) return;
  const ux = dx / dl;
  const uy = dy / dl;
  const bx = p0[0] + ux * 3 * s;
  const by = p0[1] + uy * 3 * s;
  b.solid(layer, [[p0[0], p0[1]], [bx - uy * 0.5 * s, by + ux * 0.5 * s], [bx + uy * 0.5 * s, by - ux * 0.5 * s]]);
}

/** Remove the holes from [a,b]; returns the remaining intervals. */
export function splitInterval(a: number, b: number, holes: [number, number][]): [number, number][] {
  let segs: [number, number][] = [[a, b]];
  for (const [h0, h1] of holes) {
    const next: [number, number][] = [];
    for (const [s0, s1] of segs) {
      if (h1 <= s0 || h0 >= s1) next.push([s0, s1]);
      else {
        if (h0 > s0) next.push([s0, h0]);
        if (h1 < s1) next.push([h1, s1]);
      }
    }
    segs = next;
  }
  return segs;
}

/** Greedy wrap into lines of at most `maxChars` characters. */
export function wrapText(s: string, maxChars: number): string[] {
  const words = s.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export interface TableOpts {
  title?: string;
  th?: number;
  /** First row is a header (heavier rule below). Default true. */
  header?: boolean;
  /** Minimum column widths (paper mm). */
  minCols?: number[];
  /** Right-align numeric-looking columns. */
  alignRight?: boolean[];
}

/** Column widths (paper mm) that fit the longest line of each column. */
export function autoCols(rows: string[][], th: number, minCols: number[] = []): number[] {
  const n = Math.max(...rows.map((r) => r.length));
  const cols: number[] = [];
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const r of rows) for (const ln of (r[i] ?? '').split('\n')) m = Math.max(m, ln.length);
    cols.push(Math.max(minCols[i] ?? 0, m * 0.6 * th + 3.2));
  }
  return cols;
}

/**
 * Table at paper position (xP, yTopP) with multi-line cells. Returns the paper size.
 * Layer FP-TABL, text height `th` paper mm (≥ 2.0).
 */
export function drawTable(c: Ctx, xP: number, yTopP: number, cols: number[], rows: string[][], o: TableOpts = {}): { w: number; h: number } {
  const { b, sheet } = c;
  const s = sheet.scale;
  const th = o.th ?? 2.5;
  const layer = 'FP-TABL';
  const lineH = th * 1.3;
  const pad = 1.4;
  const rowH = rows.map((r) => Math.max(1, ...r.map((cell) => cell.split('\n').length)) * lineH + pad * 2);
  const titleH = o.title ? th * 2.6 : 0;
  const totalW = cols.reduce((a, v) => a + v, 0);
  const totalH = titleH + rowH.reduce((a, v) => a + v, 0);
  const X = (v: number): number => PX(c, v);
  const Y = (v: number): number => PY(c, v);
  b.rect(layer, X(xP), Y(yTopP - totalH), totalW * s, totalH * s);
  if (o.title) {
    b.line(layer, X(xP), Y(yTopP - titleH), X(xP + totalW), Y(yTopP - titleH));
    b.text(layer, X(xP + totalW / 2), Y(yTopP - titleH / 2), th * 1.15, o.title, { align: 'center', vAlign: 'middle' });
  }
  let y = yTopP - titleH;
  rows.forEach((r, ri) => {
    const h = rowH[ri];
    if (ri > 0) b.line(layer, X(xP), Y(y), X(xP + totalW), Y(y));
    let x = xP;
    r.forEach((cell, ci) => {
      const lines = cell.split('\n');
      const right = o.alignRight?.[ci] && !(o.header !== false && ri === 0);
      lines.forEach((ln, li) => {
        if (!ln) return;
        const ty = y - pad - li * lineH - lineH / 2;
        b.text(layer, X(right ? x + cols[ci] - 1.4 : x + 1.4), Y(ty), th, ln, {
          align: right ? 'right' : 'left',
          vAlign: 'middle'
        });
      });
      x += cols[ci];
    });
    y -= h;
  });
  // column rules
  let cx = xP;
  for (let i = 0; i < cols.length - 1; i++) {
    cx += cols[i];
    b.line(layer, X(cx), Y(yTopP - titleH), X(cx), Y(yTopP - totalH));
  }
  if (o.header !== false && rows.length > 1) {
    const yh = yTopP - titleH - rowH[0];
    b.line(layer, X(xP), Y(yh - 0.3), X(xP + totalW), Y(yh - 0.3));
  }
  return { w: totalW, h: totalH };
}

/** Numbered, wrapped notes block (paper coordinates). Returns paper height. */
export function drawNotes(c: Ctx, xP: number, yTopP: number, widthP: number, title: string, notes: string[], th = 2.5): number {
  const { b } = c;
  const maxChars = Math.floor((widthP - 8) / (0.6 * th));
  const X = (v: number): number => PX(c, v);
  const Y = (v: number): number => PY(c, v);
  b.text('FP-ANNO', X(xP), Y(yTopP - th), th * 1.35, title, { vAlign: 'middle' });
  b.line('FP-ANNO', X(xP), Y(yTopP - th * 2), X(xP + Math.min(widthP, title.length * th * 1.35 * 0.6 + 6)), Y(yTopP - th * 2));
  let y = yTopP - th * 3.2;
  const lh = th * 1.45;
  notes.forEach((n, i) => {
    const lines = wrapText(n, maxChars);
    b.text('FP-ANNO', X(xP), Y(y), th, `${i + 1}.`, { vAlign: 'middle' });
    lines.forEach((ln, li) => {
      b.text('FP-ANNO', X(xP + 7), Y(y - li * lh), th, ln, { vAlign: 'middle' });
    });
    y -= lines.length * lh + 0.6 * th;
  });
  return yTopP - y;
}

/** Predicted height of drawNotes (paper mm). */
export function notesHeight(widthP: number, notes: string[], th = 2.5): number {
  const maxChars = Math.floor((widthP - 8) / (0.6 * th));
  const lh = th * 1.45;
  let y = th * 3.2;
  for (const n of notes) y += wrapText(n, maxChars).length * lh + 0.6 * th;
  return y;
}

/** Symbol legend (valves, fittings and line types) in a framed box. Returns paper size. */
export function drawSymbolLegend(c: Ctx, xP: number, yTopP: number, colW = 92): { w: number; h: number } {
  const { b, sheet } = c;
  const s = sheet.scale;
  const X = (v: number): number => PX(c, v);
  const Y = (v: number): number => PY(c, v);
  const items: [string, (x: number, y: number, d: number) => void][] = [
    ['OS&Y GATE VALVE (SUPERVISED OPEN)', (x, y, d) => gateValve(b, x, y, 0, d)],
    ['BUTTERFLY VALVE (SUPERVISED)', (x, y, d) => butterflyValve(b, x, y, 0, d)],
    ['SWING CHECK VALVE', (x, y, d) => checkValve(b, x, y, 0, d)],
    ['PRESSURE RELIEF VALVE', (x, y, d) => reliefValve(b, x, y, 0, d)],
    ['FLOW METER (TEST LINE)', (x, y, d) => flowMeter(b, x, y, 0, d)],
    ['PRESSURE GAUGE', (x, y, d) => pressureGauge(b, x, y, 0, d)],
    ['ECCENTRIC REDUCER (FLAT TOP)', (x, y, d) => eccentricReducer(b, x, y, 0, d, d * 0.8)],
    ['CONCENTRIC INCREASER', (x, y, d) => concentricReducer(b, x, y, 0, d * 0.8, d)],
    ['2-1/2" HOSE VALVE (TEST HEADER)', (x, y, d) => hoseValve(b, x, y, 0, d)],
    ['FLEXIBLE COUPLING', (x, y, d) => flexibleCoupling(b, x, y, 0, d)],
    ['BALL VALVE (JOCKEY)', (x, y, d) => ballValve(b, x, y, 0, d)]
  ];
  const lines: [string, string, string][] = [
    ['FP-PIPE-SUCT', 'SUCTION PIPING', 'solid'],
    ['FP-PIPE-DISC', 'DISCHARGE PIPING / HEADER', 'solid'],
    ['FP-PIPE-TEST', 'TEST / FLOW-METER / RELIEF RETURN', 'solid'],
    ['FP-PIPE-JCKY', 'JOCKEY PUMP PIPING', 'solid'],
    ['FP-PIPE-DRAN', 'DRAIN / INDIRECT WASTE', 'solid'],
    ['FP-PIPE-SENS', 'PRESSURE SENSING LINE', 'solid'],
    ['FP-FUEL', 'DIESEL FUEL / EXHAUST', 'solid'],
    ['FP-HIDN', 'HIDDEN / BELOW FLOOR / WORKING SPACE', 'solid']
  ];
  const th = 2.5;
  const rowH = 9;
  const nRows = items.length + lines.length;
  const colRows = Math.ceil(nRows / 2);
  const w = colW * 2 + 4;
  const h = 9 + colRows * rowH + 2;
  b.rect('FP-TABL', X(xP), Y(yTopP - h), w * s, h * s);
  b.text('FP-ANNO', X(xP + 3), Y(yTopP - 4.5), th * 1.35, 'LEGEND', { vAlign: 'middle' });
  b.line('FP-TABL', X(xP), Y(yTopP - 9), X(xP + w), Y(yTopP - 9));
  const all: { label: string; draw: (x: number, y: number) => void }[] = [];
  for (const [label, fn] of items) all.push({ label, draw: (x, y) => fn(x, y, 4 * s) });
  for (const [layer, label] of lines) {
    all.push({
      label,
      draw: (x, y) => {
        if (layer === 'FP-HIDN' || layer === 'FP-PIPE-SENS' || layer === 'FP-FUEL' || layer === 'FP-PIPE-DRAN') b.line(layer, x - 8 * s, y, x + 8 * s, y);
        else b.pipe(layer, [[x - 8 * s, y], [x + 8 * s, y]], 1.6 * s, false);
      }
    });
  }
  all.forEach((it, i) => {
    const col = i < colRows ? 0 : 1;
    const row = i % colRows;
    const x0 = xP + 2 + col * colW;
    const y = yTopP - 9 - rowH * (row + 0.5);
    it.draw(X(x0 + 10), Y(y));
    b.text('FP-ANNO', X(x0 + 22), Y(y), th, it.label, { vAlign: 'middle' });
  });
  return { w, h };
}
