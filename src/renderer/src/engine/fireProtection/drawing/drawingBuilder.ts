/**
 * DrawingBuilder — fluent, format-neutral 2D drawing kernel (model space millimetres).
 * Annotation sizes are passed in PAPER millimetres and multiplied by `scale`.
 */
import type { BBox, DrawEntity, Drawing, LayerDef, Linetype, SheetInfo, TextAlign, TextVAlign } from './drawingTypes';

const L = (name: string, color: number, linetype: Linetype, lineweightMm: number, description: string): LayerDef => ({
  name,
  color,
  linetype,
  lineweightMm,
  description
});

export const FP_LAYERS: LayerDef[] = [
  L('FP-WALL', 7, 'CONTINUOUS', 0.5, 'Walls, slabs (cut)'),
  L('FP-WALL-HTCH', 8, 'CONTINUOUS', 0.13, 'Wall / concrete hatch'),
  L('FP-TANK', 4, 'CONTINUOUS', 0.5, 'Fire water tank structure'),
  L('FP-WATR', 5, 'DASHED', 0.18, 'Water levels'),
  L('FP-EQPM', 3, 'CONTINUOUS', 0.35, 'Pumps, drivers, tanks'),
  L('FP-PADS', 8, 'CONTINUOUS', 0.25, 'Concrete housekeeping pads'),
  L('FP-PIPE-SUCT', 1, 'CONTINUOUS', 0.5, 'Suction piping'),
  L('FP-PIPE-DISC', 1, 'CONTINUOUS', 0.5, 'Discharge piping & header'),
  L('FP-PIPE-TEST', 6, 'CONTINUOUS', 0.35, 'Test / flow-meter / relief return'),
  L('FP-PIPE-JCKY', 30, 'CONTINUOUS', 0.35, 'Jockey pump piping'),
  L('FP-PIPE-DRAN', 140, 'DASHED', 0.25, 'Drains, indirect waste'),
  L('FP-PIPE-SENS', 2, 'HIDDEN', 0.18, 'Pressure sensing lines'),
  L('FP-FUEL', 40, 'PHANTOM', 0.25, 'Diesel fuel & exhaust'),
  L('FP-VALV', 2, 'CONTINUOUS', 0.25, 'Valves & fittings'),
  L('FP-ELEC', 210, 'CONTINUOUS', 0.35, 'Controllers, ATS, power'),
  L('FP-TRCH', 94, 'CONTINUOUS', 0.25, 'Drainage trench & pit'),
  L('FP-HIDN', 8, 'HIDDEN', 0.18, 'Hidden / below-floor'),
  L('FP-CNTR', 8, 'CENTER', 0.13, 'Centre-lines'),
  L('FP-DIMS', 7, 'CONTINUOUS', 0.18, 'Dimensions'),
  L('FP-ANNO', 7, 'CONTINUOUS', 0.25, 'Text, tags, leaders'),
  L('FP-LEVL', 5, 'CONTINUOUS', 0.18, 'Level markers'),
  L('FP-TABL', 7, 'CONTINUOUS', 0.18, 'Schedules & tables'),
  L('FP-TBLK', 7, 'CONTINUOUS', 0.5, 'Sheet frame & title block'),
  L('FP-ARCH', 8, 'CONTINUOUS', 0.25, 'Doors, louvers, openings')
];

/** Bounding box of a set of entities (text approximated as height × 0.6 × chars, rotation honoured). */
export function entitiesBBox(entities: readonly DrawEntity[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const e of entities) {
    switch (e.kind) {
      case 'line':
        add(e.x1, e.y1);
        add(e.x2, e.y2);
        break;
      case 'polyline':
      case 'solid':
        for (const [x, y] of e.points) add(x, y);
        break;
      case 'circle':
      case 'arc':
        add(e.cx - e.r, e.cy - e.r);
        add(e.cx + e.r, e.cy + e.r);
        break;
      case 'text': {
        const w = e.height * 0.6 * e.text.length;
        const x0 = e.align === 'left' ? 0 : e.align === 'center' ? -w / 2 : -w;
        const y0 = e.vAlign === 'middle' ? -e.height / 2 : e.vAlign === 'top' ? -e.height : 0;
        const a = (e.rotationDeg * Math.PI) / 180;
        const c = Math.cos(a);
        const s = Math.sin(a);
        for (const [px, py] of [[x0, y0], [x0 + w, y0], [x0 + w, y0 + e.height], [x0, y0 + e.height]]) {
          add(e.x + px * c - py * s, e.y + px * s + py * c);
        }
        break;
      }
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

type Pt = [number, number];

export class DrawingBuilder {
  readonly entities: DrawEntity[] = [];
  /** Current paper scale denominator — annotation sizes passed in PAPER mm are multiplied by it. */
  scale = 50;
  private readonly layers: LayerDef[];
  private readonly layerNames: Set<string>;

  constructor(
    readonly title: string,
    layers: LayerDef[] = FP_LAYERS
  ) {
    this.layers = layers.map((l) => ({ ...l }));
    this.layerNames = new Set(this.layers.map((l) => l.name));
  }

  private add(e: DrawEntity): void {
    if (!this.layerNames.has(e.layer)) throw new Error(`DrawingBuilder: undefined layer "${e.layer}"`);
    for (const v of Object.values(e) as unknown[]) {
      if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`DrawingBuilder: non-finite number in ${e.kind} on ${e.layer}`);
      if (Array.isArray(v)) {
        for (const p of v as Pt[]) {
          if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) throw new Error(`DrawingBuilder: non-finite point in ${e.kind} on ${e.layer}`);
        }
      }
    }
    this.entities.push(e);
  }

  line(layer: string, x1: number, y1: number, x2: number, y2: number): void {
    this.add({ kind: 'line', layer, x1, y1, x2, y2 });
  }

  polyline(layer: string, points: Pt[], closed = false): void {
    this.add({ kind: 'polyline', layer, points: points.map((p) => [p[0], p[1]] as Pt), closed });
  }

  rect(layer: string, x: number, y: number, w: number, h: number): void {
    this.polyline(layer, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
  }

  circle(layer: string, cx: number, cy: number, r: number): void {
    this.add({ kind: 'circle', layer, cx, cy, r });
  }

  arc(layer: string, cx: number, cy: number, r: number, startDeg: number, endDeg: number): void {
    this.add({ kind: 'arc', layer, cx, cy, r, startDeg, endDeg });
  }

  solid(layer: string, points: Pt[]): void {
    if (points.length !== 3 && points.length !== 4) throw new Error('DrawingBuilder.solid needs 3 or 4 points');
    this.add({ kind: 'solid', layer, points: points.map((p) => [p[0], p[1]] as Pt) });
  }

  text(
    layer: string,
    x: number,
    y: number,
    paperHeightMm: number,
    text: string,
    opts: { rotationDeg?: number; align?: TextAlign; vAlign?: TextVAlign } = {}
  ): void {
    this.add({
      kind: 'text',
      layer,
      x,
      y,
      height: paperHeightMm * this.scale,
      text,
      rotationDeg: opts.rotationDeg ?? 0,
      align: opts.align ?? 'left',
      vAlign: opts.vAlign ?? 'baseline'
    });
  }

  /** Linear dimension with architectural ticks (layer FP-DIMS). Positive offset = left of p1→p2. */
  dimLinear(x1: number, y1: number, x2: number, y2: number, offsetPaperMm: number, override?: string): void {
    const s = this.scale;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const off = offsetPaperMm * s;
    const sg = off < 0 ? -1 : 1;
    const layer = 'FP-DIMS';
    // extension lines: 1 mm gap from the object, 2 mm overshoot past the dimension line
    for (const [px, py] of [[x1, y1], [x2, y2]]) {
      this.line(layer, px + nx * sg * 1 * s, py + ny * sg * 1 * s, px + nx * (off + sg * 2 * s), py + ny * (off + sg * 2 * s));
    }
    const ax = x1 + nx * off;
    const ay = y1 + ny * off;
    const bx = x2 + nx * off;
    const by = y2 + ny * off;
    const ext = 1 * s;
    this.line(layer, ax - ux * ext, ay - uy * ext, bx + ux * ext, by + uy * ext);
    // 45° architectural ticks, 3 mm paper long
    const k = Math.SQRT1_2;
    const tx = (ux + nx) * k;
    const ty = (uy + ny) * k;
    const th = 1.5 * s;
    for (const [px, py] of [[ax, ay], [bx, by]]) {
      this.line(layer, px - tx * th, py - ty * th, px + tx * th, py + ty * th);
    }
    // text: rotated with the line, kept readable, centred above the dim line
    let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    let flipped = false;
    if (ang > 90 + 1e-9) {
      ang -= 180;
      flipped = true;
    } else if (ang <= -90 + 1e-9) {
      ang += 180;
      flipped = true;
    }
    const f = flipped ? -1 : 1;
    const mx = (ax + bx) / 2 + nx * f * 0.75 * s;
    const my = (ay + by) / 2 + ny * f * 0.75 * s;
    this.text(layer, mx, my, 2.5, override ?? String(Math.round(len)), { rotationDeg: ang, align: 'center', vAlign: 'bottom' });
  }

  /** Leader with a closed arrowhead at the first point and text at the last point. */
  leader(points: Pt[], text: string | string[], layer = 'FP-ANNO'): void {
    if (points.length < 2) return;
    const s = this.scale;
    this.polyline(layer, points, false);
    const [p0, p1] = points;
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dl = Math.hypot(dx, dy);
    if (dl > 1e-9) {
      const ux = dx / dl;
      const uy = dy / dl;
      const bx = p0[0] + ux * 3 * s;
      const by = p0[1] + uy * 3 * s;
      this.solid(layer, [[p0[0], p0[1]], [bx - uy * 0.5 * s, by + ux * 0.5 * s], [bx + uy * 0.5 * s, by - ux * 0.5 * s]]);
    }
    const pe = points[points.length - 1];
    const pp = points[points.length - 2];
    const right = pe[0] - pp[0] >= 0;
    const lines = Array.isArray(text) ? text : [text];
    const pitch = 3.5 * s;
    lines.forEach((t, i) => {
      this.text(layer, pe[0] + (right ? 1 : -1) * 1 * s, pe[1] + ((lines.length - 1) / 2 - i) * pitch, 2.5, t, {
        align: right ? 'left' : 'right',
        vAlign: 'middle'
      });
    });
  }

  /** Level marker: open down-pointing triangle on a level line, "+1.250" text (metres) and optional label. */
  levelMark(x: number, y: number, levelM: number, label?: string): void {
    const s = this.scale;
    const layer = 'FP-LEVL';
    const v = Math.abs(levelM) < 0.0005 ? '±0.000' : `${levelM > 0 ? '+' : '-'}${Math.abs(levelM).toFixed(3)}`;
    const txt = v.replace('±', '%%p');
    this.polyline(layer, [[x, y], [x - 1.5 * s, y + 2.6 * s], [x + 1.5 * s, y + 2.6 * s]], true);
    this.line(layer, x - 5 * s, y, x + 3 * s + Math.max(txt.length, 6) * 1.6 * s, y);
    this.text(layer, x + 2.5 * s, y + 0.8 * s, 2.5, txt, { align: 'left', vAlign: 'bottom' });
    if (label) this.text(layer, x - 2.5 * s, y + 0.8 * s, 2.5, label, { align: 'right', vAlign: 'bottom' });
  }

  /** Equipment / valve tag: 8 mm circle, or a stadium when the text is longer than 4 characters. */
  tag(x: number, y: number, text: string): void {
    const s = this.scale;
    const layer = 'FP-ANNO';
    if (text.length <= 4) {
      this.circle(layer, x, y, 4 * s);
    } else {
      const w = Math.max(8, text.length * 1.9 + 4) * s;
      const r = 3 * s;
      const hw = w / 2 - r;
      this.line(layer, x - hw, y + r, x + hw, y + r);
      this.line(layer, x - hw, y - r, x + hw, y - r);
      this.arc(layer, x - hw, y, r, 90, 270);
      this.arc(layer, x + hw, y, r, 270, 90);
    }
    this.text(layer, x, y, 2.5, text, { align: 'center', vAlign: 'middle' });
  }

  /** Double-line pipe (true outside diameter, mitred bends) with optional centre-line on FP-CNTR. */
  pipe(layer: string, pts: Pt[], odMm: number, centreLine = true): void {
    const p: Pt[] = [];
    for (const q of pts) {
      const last = p[p.length - 1];
      if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 1e-9) p.push([q[0], q[1]]);
    }
    if (p.length < 2) return;
    const half = odMm / 2;
    const nSeg = p.length - 1;
    const dir: Pt[] = [];
    for (let i = 0; i < nSeg; i++) {
      const dx = p[i + 1][0] - p[i][0];
      const dy = p[i + 1][1] - p[i][1];
      const l = Math.hypot(dx, dy);
      dir.push([dx / l, dy / l]);
    }
    const nrm = dir.map(([ux, uy]): Pt => [-uy, ux]);
    for (const side of [1, -1]) {
      const v: Pt[] = [];
      for (let i = 0; i < p.length; i++) {
        if (i === 0) {
          v.push([p[0][0] + nrm[0][0] * half * side, p[0][1] + nrm[0][1] * half * side]);
        } else if (i === p.length - 1) {
          const n = nrm[nSeg - 1];
          v.push([p[i][0] + n[0] * half * side, p[i][1] + n[1] * half * side]);
        } else {
          const na = nrm[i - 1];
          const nb = nrm[i];
          const dot = na[0] * nb[0] + na[1] * nb[1];
          if (1 + dot >= 2 / 9) {
            const k = (half * side) / (1 + dot);
            v.push([p[i][0] + (na[0] + nb[0]) * k, p[i][1] + (na[1] + nb[1]) * k]);
          } else {
            v.push([p[i][0] + na[0] * half * side, p[i][1] + na[1] * half * side]);
          }
        }
      }
      for (let i = 0; i < nSeg; i++) this.line(layer, v[i][0], v[i][1], v[i + 1][0], v[i + 1][1]);
    }
    if (centreLine) {
      for (let i = 0; i < nSeg; i++) this.line('FP-CNTR', p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]);
    }
  }

  /** Section cut: heavy stubs + centre line, view arrows pointing left of x1,y1→x2,y2, letter at both ends. */
  sectionMark(x1: number, y1: number, x2: number, y2: number, letter: string): void {
    const s = this.scale;
    const layer = 'FP-ANNO';
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    this.line('FP-CNTR', x1, y1, x2, y2);
    const stub = Math.min(12 * s, len / 3);
    const ends: [number, number, number][] = [[x1, y1, 1], [x2, y2, -1]];
    for (const [ex, ey, inward] of ends) {
      const ix = ux * inward;
      const iy = uy * inward;
      const w = 0.4 * s;
      this.solid(layer, [
        [ex - nx * w, ey - ny * w],
        [ex + nx * w, ey + ny * w],
        [ex + ix * stub + nx * w, ey + iy * stub + ny * w],
        [ex + ix * stub - nx * w, ey + iy * stub - ny * w]
      ]);
      const tipX = ex + nx * 10 * s;
      const tipY = ey + ny * 10 * s;
      this.line(layer, ex, ey, tipX, tipY);
      const bx = tipX - nx * 3 * s;
      const by = tipY - ny * 3 * s;
      this.solid(layer, [[tipX, tipY], [bx - ny * 0.5 * s, by + nx * 0.5 * s], [bx + ny * 0.5 * s, by - nx * 0.5 * s]]);
      this.text(layer, tipX + nx * 3 * s, tipY + ny * 3 * s, 3.5, letter, { align: 'center', vAlign: 'middle' });
    }
  }

  /** 45° hatch clipped analytically to the rectangle; lines lie on a global grid so adjacent hatches align. */
  hatchRect(x: number, y: number, w: number, h: number, spacingPaperMm = 2): void {
    const step = spacingPaperMm * this.scale * Math.SQRT2; // spacing along the y-intercept for 45° lines
    if (!(step > 0) || !(w > 0) || !(h > 0)) return;
    // lines y = x + c ; c ranges over (y - (x+w), (y+h) - x)
    const k0 = Math.ceil((y - (x + w)) / step);
    const k1 = Math.floor((y + h - x) / step);
    for (let k = k0; k <= k1; k++) {
      const c = k * step;
      const xa = Math.max(x, y - c);
      const xb = Math.min(x + w, y + h - c);
      if (xb - xa > 1e-6) this.line('FP-WALL-HTCH', xa, xa + c, xb, xb + c);
    }
  }

  /** Table at top-left (x, yTop). Widths/heights in paper mm. Returns total height in model mm. */
  table(
    x: number,
    yTop: number,
    colWidthsPaperMm: number[],
    rows: string[][],
    opts: { rowHeightPaperMm?: number; textHeightPaperMm?: number; title?: string } = {}
  ): number {
    const s = this.scale;
    const layer = 'FP-TABL';
    const rh = (opts.rowHeightPaperMm ?? 6) * s;
    const th = opts.textHeightPaperMm ?? 2.5;
    const cw = colWidthsPaperMm.map((w) => w * s);
    const totalW = cw.reduce((a, b) => a + b, 0);
    const titleH = opts.title ? rh : 0;
    const totalH = titleH + rows.length * rh;
    this.rect(layer, x, yTop - totalH, totalW, totalH);
    if (opts.title) {
      this.line(layer, x, yTop - titleH, x + totalW, yTop - titleH);
      this.text(layer, x + totalW / 2, yTop - titleH / 2, th * 1.2, opts.title, { align: 'center', vAlign: 'middle' });
    }
    const yRows = yTop - titleH;
    for (let r = 1; r < rows.length; r++) {
      this.line(layer, x, yRows - r * rh, x + totalW, yRows - r * rh);
    }
    if (rows.length > 1) {
      // heavier rule under the header row
      this.line(layer, x, yRows - rh - 0.35 * s, x + totalW, yRows - rh - 0.35 * s);
    }
    let cx = x;
    for (let c = 0; c < cw.length - 1; c++) {
      cx += cw[c];
      this.line(layer, cx, yRows, cx, yTop - totalH);
    }
    rows.forEach((row, r) => {
      let colX = x;
      row.forEach((cell, c) => {
        if (c >= cw.length) return;
        if (cell) {
          const fit = (colWidthsPaperMm[c] - 3) / (0.6 * cell.length);
          const hh = Math.max(1.2, Math.min(th, fit));
          this.text(layer, colX + 1.5 * s, yRows - r * rh - rh / 2, hh, cell, { align: 'left', vAlign: 'middle' });
        }
        colX += cw[c];
      });
    });
    return totalH;
  }

  bbox(): BBox {
    return entitiesBBox(this.entities);
  }

  build(sheets: SheetInfo[]): Drawing {
    return {
      title: this.title,
      layers: this.layers.map((l) => ({ ...l })),
      entities: this.entities.slice(),
      sheets: sheets.map((s) => ({ ...s }))
    };
  }
}
