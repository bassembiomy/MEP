/**
 * FP-108 — Portable fire extinguisher layout: schematic floor plans (one framed mini-plan per floor, zones as rectangles,
 * extinguisher symbols with tag / unit id, dashed coverage circles). Paginated FP-108, FP-108.2 … when the floors do not fit.
 * FP-109 — Mounting / cabinet / sign details (1:20), extinguisher schedule, quantity summary, selection matrix,
 * inspection & maintenance table and specification notes (NFPA 10-2022, IFC §906).
 * Model space is real-world millimetres; the sheet scale only converts paper-mm annotation sizes.
 */
import type {
  ExtinguisherAgent,
  ExtinguisherSystemDesign,
  ExtinguisherUnitType,
  ExtinguisherZoneDesign,
  ExtinguisherZoneInput,
  FireDesignResult,
  PlacedExtinguisher
} from '../fpTypes';
import type { DrawingBuilder } from './drawingBuilder';
import { northArrow } from './symbols';
import {
  type Box,
  type Ctx,
  FRAME,
  Placer,
  type Pt,
  PX,
  PY,
  arrowLine,
  autoCols,
  drawNotes,
  drawTable,
  drawTag,
  measureTable,
  notesHeight,
  sheetTitle,
  tableMinX,
  textWidth,
  wrapText
} from './sheetKit';

const FT = 0.3048;
const SCALES = [100, 150, 200, 250, 500, 1000];

// Plan area (paper mm) of FP-108: panels left of the right-hand column (legend / notes) and above the frame bottom.
const PLAN = { x0: 24, y0: 14, x1: 646, y1: 545 };
const RIGHT_X = 654;
const PAD = 8; // panel inner padding (paper mm) around the content bounding box
const TITLE_H = 9; // panel title row (paper mm)
const GAP = 4; // gap between panels (paper mm)

const lvlText = (m: number): string => (Math.abs(m) < 0.0005 ? '%%p0.000' : `${m > 0 ? '+' : '-'}${Math.abs(m).toFixed(3)}`);

const HAZARD_SHORT: Record<string, string> = { light: 'LIGHT HAZARD', ordinary: 'ORDINARY HAZARD', extra: 'EXTRA HAZARD' };

const AGENT_SHORT: Record<ExtinguisherAgent, string> = {
  'dry-chemical-abc': 'DRY CHEM ABC',
  co2: 'CO2',
  water: 'WATER',
  afff: 'AFFF FOAM',
  'clean-agent': 'CLEAN AGENT',
  'wet-chemical': 'WET CHEM K',
  'dry-powder-d': 'DRY POWDER D'
};

const fit = (str: string, maxWidthPaper: number, hMax: number): number => Math.max(1.4, Math.min(hMax, maxWidthPaper / (0.78 * Math.max(1, str.length))));

// ───────────────────────────────────────── data model ─────────────────────────────────────────

interface ZoneModel {
  d: ExtinguisherZoneDesign;
  /** Lower-left corner and size in real mm, floor-local coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
}

interface FloorModel {
  id: string;
  name: string;
  levelM: number | null;
  zones: ExtinguisherZoneDesign[];
  count: number;
}

interface Panel {
  fl: FloorModel;
  zones: ZoneModel[];
  /** Content bounding box (real mm, floor-local). */
  bb: { x0: number; y0: number; x1: number; y1: number };
  pw: number;
  ph: number;
  ox: number;
  oy: number;
}

export interface ExtinguisherLayout {
  scale: number;
  pages: Panel[][];
}

function classesOf(d: ExtinguisherZoneDesign, inp: ExtinguisherZoneInput | undefined, catalog: ExtinguisherUnitType[]): string {
  const cls: string[] = [];
  if (inp) {
    if (inp.classA) cls.push('A');
    if (inp.classB !== 'none') cls.push('B');
    if (inp.classC) cls.push('C');
    if (inp.classD) cls.push('D');
    if (inp.fryers > 0) cls.push('K');
  } else {
    if (d.minARating != null) cls.push('A');
    if (d.bRequirement) cls.push('B');
    if (d.extinguishers.some((e) => catalog.find((u) => u.id === e.unitId)?.cRated)) cls.push('C');
    if (d.dUnits > 0) cls.push('D');
    if (d.kUnits > 0) cls.push('K');
  }
  return cls.length ? `CLASS ${cls.join(':')}` : 'CLASS -';
}

function buildFloors(r: FireDesignResult): FloorModel[] {
  const fe = r.extinguishers!;
  const bFloors = r.input.building?.floors ?? [];
  const order: string[] = [];
  for (const f of bFloors) if (fe.zones.some((z) => z.floorId === f.id)) order.push(f.id);
  for (const z of fe.zones) if (!order.includes(z.floorId)) order.push(z.floorId);
  return order.map((id) => {
    const bf = bFloors.find((f) => f.id === id);
    const zones = fe.zones.filter((z) => z.floorId === id);
    return {
      id,
      name: bf ? bf.name : id,
      levelM: bf ? bf.elevationM : null,
      zones,
      count: zones.reduce((n, z) => n + z.extinguishers.length, 0)
    };
  });
}

const radiusMm = (e: PlacedExtinguisher): number => e.coverageRadiusFt * FT * 1000;

/** Pack the zones of a floor left → right (2 m gaps), wrapping into rows when a row would exceed the limit. */
function layoutPanel(r: FireDesignResult, fl: FloorModel, S: number): Panel {
  const fe = r.extinguishers!;
  const maxR = Math.max(0, ...fl.zones.flatMap((z) => z.extinguishers.map(radiusMm)));
  const availMm = (PLAN.x1 - PLAN.x0 - 2 * PAD) * S;
  const widest = Math.max(...fl.zones.map((z) => z.lengthFt * FT * 1000));
  const limit = Math.max(availMm - 2 * maxR, widest);
  const gap = 2000;
  const zones: ZoneModel[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const z of fl.zones) {
    const w = z.lengthFt * FT * 1000;
    const h = z.widthFt * FT * 1000;
    if (x > 0 && x + w > limit + 1e-6) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }
    const inp = r.input.extinguishers?.zones.find((q) => q.id === z.zoneId);
    const size = `${(z.lengthFt * FT).toFixed(1)} X ${(z.widthFt * FT).toFixed(1)} M`;
    zones.push({
      d: z,
      x,
      y,
      w,
      h,
      lines: [z.zoneName.toUpperCase(), `${HAZARD_SHORT[z.hazard] ?? z.hazard.toUpperCase()}  ${size}`, classesOf(z, inp, fe.catalog)]
    });
    x += w + gap;
    rowH = Math.max(rowH, h);
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const zm of zones) {
    x0 = Math.min(x0, zm.x);
    y0 = Math.min(y0, zm.y);
    x1 = Math.max(x1, zm.x + zm.w);
    y1 = Math.max(y1, zm.y + zm.h);
    for (const e of zm.d.extinguishers) {
      const px = zm.x + e.xM * 1000;
      const py = zm.y + e.yM * 1000;
      const rr = radiusMm(e);
      x0 = Math.min(x0, px - rr);
      y0 = Math.min(y0, py - rr);
      x1 = Math.max(x1, px + rr);
      y1 = Math.max(y1, py + rr);
    }
  }
  const titleW = `${fl.name} - FFL ${fl.levelM == null ? '' : lvlText(fl.levelM)}`.length * 3 * 0.78 + 8;
  const pw = Math.max((x1 - x0) / S + 2 * PAD, titleW);
  const ph = (y1 - y0) / S + 2 * PAD + TITLE_H;
  return { fl, zones, bb: { x0, y0, x1, y1 }, pw, ph, ox: 0, oy: 0 };
}

/** Pick the smallest standard scale that puts every floor on one sheet; otherwise paginate. */
export function planExtinguisherLayout(r: FireDesignResult): ExtinguisherLayout {
  const floors = buildFloors(r);
  const availW = PLAN.x1 - PLAN.x0;
  const availH = PLAN.y1 - PLAN.y0;
  const attempt = (S: number): { pages: Panel[][]; allFit: boolean } => {
    const panels = floors.map((fl) => layoutPanel(r, fl, S));
    const allFit = panels.every((p) => p.pw <= availW && p.ph <= availH);
    const pages: Panel[][] = [];
    let cur: Panel[] = [];
    let sx = 0;
    let sy = 0; // distance from the top of the plan area
    let shelfH = 0;
    const flush = (): void => {
      if (cur.length) pages.push(cur);
      cur = [];
      sx = 0;
      sy = 0;
      shelfH = 0;
    };
    for (const p of panels) {
      if (sx > 0 && sx + p.pw > availW + 1e-6) {
        sx = 0;
        sy += shelfH + GAP;
        shelfH = 0;
      }
      if (sy + p.ph > availH + 1e-6 && cur.length) {
        flush();
      }
      p.ox = PLAN.x0 + sx;
      p.oy = PLAN.y1 - sy - p.ph;
      cur.push(p);
      sx += p.pw + GAP;
      shelfH = Math.max(shelfH, p.ph);
    }
    flush();
    return { pages, allFit };
  };
  let chosen: { S: number; pages: Panel[][] } | null = null;
  for (const S of SCALES) {
    const a = attempt(S);
    if (a.allFit && a.pages.length === 1) {
      chosen = { S, pages: a.pages };
      break;
    }
  }
  if (!chosen) {
    for (const S of SCALES) {
      const a = attempt(S);
      if (a.allFit && a.pages.length <= 3) {
        chosen = { S, pages: a.pages };
        break;
      }
    }
  }
  if (!chosen) {
    const S = SCALES[SCALES.length - 1];
    chosen = { S, pages: attempt(S).pages };
  }
  return { scale: chosen.S, pages: chosen.pages.length ? chosen.pages : [[]] };
}

export const extinguisherSheetNumber = (i: number): string => (i === 0 ? 'FP-108' : `FP-108.${i + 1}`);

// ───────────────────────────────────────── symbols ─────────────────────────────────────────

/** Extinguisher plan symbols: general = filled triangle in circle, Class K = square with K, Class D = diamond with D. */
function extSymbol(b: DrawingBuilder, x: number, y: number, s: number, purpose: PlacedExtinguisher['purpose'], wheeled: boolean): void {
  const L = 'FP-EQPM';
  if (purpose === 'class-k') {
    b.rect(L, x - 2.4 * s, y - 2.4 * s, 4.8 * s, 4.8 * s);
    b.rect(L, x - 2.0 * s, y - 2.0 * s, 4.0 * s, 4.0 * s);
    b.text('FP-ANNO', x, y, 2.8, 'K', { align: 'center', vAlign: 'middle' });
  } else if (purpose === 'class-d') {
    b.polyline(L, [[x, y + 3.2 * s], [x + 3.2 * s, y], [x, y - 3.2 * s], [x - 3.2 * s, y]], true);
    b.polyline(L, [[x, y + 2.7 * s], [x + 2.7 * s, y], [x, y - 2.7 * s], [x - 2.7 * s, y]], true);
    b.text('FP-ANNO', x, y, 2.6, 'D', { align: 'center', vAlign: 'middle' });
  } else {
    b.circle(L, x, y, 2.4 * s);
    b.solid(L, [[x, y + 1.7 * s], [x - 1.5 * s, y - 1.0 * s], [x + 1.5 * s, y - 1.0 * s]]);
  }
  if (wheeled) {
    b.circle(L, x - 1.4 * s, y - 3.0 * s, 0.6 * s);
    b.circle(L, x + 1.4 * s, y - 3.0 * s, 0.6 * s);
  }
}

// ───────────────────────────────────────── FP-108 ─────────────────────────────────────────

const edgeBoxes = (x: number, y: number, w: number, h: number, t: number): Box[] => [
  { x0: x - t, y0: y - t, x1: x + w + t, y1: y + t },
  { x0: x - t, y0: y + h - t, x1: x + w + t, y1: y + h + t },
  { x0: x - t, y0: y - t, x1: x + t, y1: y + h + t },
  { x0: x + w - t, y0: y - t, x1: x + w + t, y1: y + h + t }
];

function drawPanel(c: Ctx, p: Panel, S: number): void {
  const { b } = c;
  const s = S;
  const fe = c.r.extinguishers!;
  // paper → model of the panel: local (real mm) → model
  const mx0 = PX(c, p.ox + PAD);
  const my0 = PY(c, p.oy + PAD);
  const L = (lx: number, ly: number): Pt => [mx0 + (lx - p.bb.x0), my0 + (ly - p.bb.y0)];
  b.rect('FP-TABL', PX(c, p.ox), PY(c, p.oy), p.pw * s, p.ph * s);
  b.line('FP-TABL', PX(c, p.ox), PY(c, p.oy + p.ph - TITLE_H), PX(c, p.ox + p.pw), PY(c, p.oy + p.ph - TITLE_H));
  const pl = new Placer(c, { x0: PX(c, p.ox + 1), y0: PY(c, p.oy + 1), x1: PX(c, p.ox + p.pw - 1), y1: PY(c, p.oy + p.ph - TITLE_H - 1) });
  const ttl = `${p.fl.name.toUpperCase()} - FFL ${p.fl.levelM == null ? 'N/A' : lvlText(p.fl.levelM)}`;
  const th = fit(ttl, p.pw - 6, 3.2);
  b.text('FP-ANNO', PX(c, p.ox + p.pw / 2), PY(c, p.oy + p.ph - TITLE_H / 2), th, ttl, { align: 'center', vAlign: 'middle' });
  const cnt = `${p.fl.count} UNIT${p.fl.count === 1 ? '' : 'S'}`;
  pl.text('FP-ANNO', PX(c, p.ox + p.pw - 2), PY(c, p.oy + 2.6), 2, cnt, { align: 'right', vAlign: 'middle' });

  // zones
  for (const z of p.zones) {
    const [zx, zy] = L(z.x, z.y);
    b.rect('FP-WALL', zx, zy, z.w, z.h);
    for (const e of edgeBoxes(zx, zy, z.w, z.h, 0.35 * s)) pl.addHard(e);
  }
  // coverage circles (true radius) and symbols
  interface Sym {
    e: PlacedExtinguisher;
    at: Pt;
    sym: Pt;
  }
  const syms: Sym[] = [];
  for (const z of p.zones) {
    const groups = new Map<string, PlacedExtinguisher[]>();
    for (const e of z.d.extinguishers) {
      const key = `${Math.round(e.xM * 10)}:${Math.round(e.yM * 10)}`;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    for (const g of groups.values()) {
      g.forEach((e, i) => {
        const at = L(z.x + e.xM * 1000, z.y + e.yM * 1000);
        b.circle('FP-HIDN', at[0], at[1], radiusMm(e));
        const off = (i - (g.length - 1) / 2) * 6.6 * s;
        syms.push({ e, at, sym: [at[0] + off, at[1]] });
      });
    }
  }
  for (const q of syms) {
    extSymbol(b, q.sym[0], q.sym[1], s, q.e.purpose, q.e.mounting === 'wheeled');
    b.circle('FP-CNTR', q.at[0], q.at[1], 0.35 * s); // coverage point
    const hb = 3.4 * s;
    pl.addHard({ x0: q.sym[0] - hb, y0: q.sym[1] - hb - (q.e.mounting === 'wheeled' ? 1 * s : 0), x1: q.sym[0] + hb, y1: q.sym[1] + hb });
  }
  // zone labels (after symbols so they dodge them)
  const zs = [...p.zones].sort((a, z) => a.w * a.h - z.w * z.h);
  for (const z of zs) {
    const [zx, zy] = L(z.x, z.y);
    const hP = 2;
    const bh = z.lines.length * hP * 1.45 * s;
    const bw = Math.max(...z.lines.map((q) => textWidth(hP * s, q)));
    const cx = zx + z.w / 2;
    const g = 1.8 * s;
    let placed = false;
    const tryC = (centres: Pt[], align: 'center' | 'left' | 'right' = 'center'): void => {
      if (placed) return;
      for (const cc of centres) {
        if (pl.block(z.lines, hP, [cc], align)) {
          placed = true;
          return;
        }
      }
    };
    const inside = bw + 2 * g <= z.w && bh + 2 * g <= z.h;
    if (inside) {
      tryC([[cx, zy + z.h - bh / 2 - g], [cx, zy + bh / 2 + g], [cx, zy + z.h / 2]]);
      for (const f of [0.25, 0.75]) tryC([[zx + z.w * f, zy + z.h - bh / 2 - g], [zx + z.w * f, zy + bh / 2 + g]]);
    }
    for (const dx of [0, -0.25, 0.25, -0.5, 0.5]) {
      tryC([[cx + dx * z.w, zy + z.h + bh / 2 + g], [cx + dx * z.w, zy - bh / 2 - g]]);
    }
    tryC([[zx + z.w + g, zy + z.h / 2], [zx + z.w + g, zy + z.h - bh / 2]], 'left');
    tryC([[zx - g, zy + z.h / 2], [zx - g, zy + z.h - bh / 2]], 'right');
    for (const k of [6, 9, 13, 18]) tryC([[cx, zy + z.h + bh / 2 + k * s], [cx, zy - bh / 2 - k * s]]);
    if (!placed) pl.callout([cx, zy + z.h / 2], z.lines, hP);
  }
  // tags: tag + unit id, next to the symbol
  const prefer = [0, 180, 90, 270, 45, 135, 225, 315, 20, 160, 200, 340, 70, 110, 250, 290];
  for (const q of syms) {
    const lines = [q.e.tag, q.e.unitId];
    const hP = 2;
    const bw = Math.max(...lines.map((t) => textWidth(hP * s, t)));
    const bh = lines.length * hP * 1.45 * s;
    let done = false;
    for (const rad of [5.2, 6.5, 8.5, 11, 14, 18, 24]) {
      for (const ang of prefer) {
        const a = (ang * Math.PI) / 180;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        // centre so that the box edge sits `rad` paper-mm from the symbol centre along the ray
        const reach = Math.abs(ca) * (bw / 2) + Math.abs(sa) * (bh / 2);
        const cc: Pt = [q.sym[0] + ca * (rad * s + reach * 0.5), q.sym[1] + sa * (rad * s + reach * 0.5)];
        if (pl.block(lines, hP, [cc])) {
          if (rad > 8.5) {
            const dl = Math.hypot(cc[0] - q.sym[0], cc[1] - q.sym[1]);
            const u: Pt = [(cc[0] - q.sym[0]) / dl, (cc[1] - q.sym[1]) / dl];
            const tEdge = Math.min(Math.abs(u[0]) > 1e-9 ? bw / 2 / Math.abs(u[0]) : 1e12, Math.abs(u[1]) > 1e-9 ? bh / 2 / Math.abs(u[1]) : 1e12);
            const r0 = 3.2 * s;
            if (dl - tEdge > r0 + 0.5 * s) b.line('FP-ANNO', q.sym[0] + u[0] * r0, q.sym[1] + u[1] * r0, cc[0] - u[0] * tEdge, cc[1] - u[1] * tEdge);
          }
          done = true;
          break;
        }
      }
      if (done) break;
    }
    if (!done) {
      const ex = pl.callout(q.sym, lines, 2);
      if (!ex) b.text('FP-ANNO', q.sym[0], q.sym[1] - 5 * s, 2, q.e.tag, { align: 'center', vAlign: 'middle' });
    }
  }
  void fe;
}

function drawLegendAndNotes(c: Ctx, lay: ExtinguisherLayout, pageIdx: number): void {
  const { b, sheet, r } = c;
  const s = sheet.scale;
  const fe = r.extinguishers!;
  const X = (v: number): number => PX(c, v);
  const Y = (v: number): number => PY(c, v);
  northArrow(b, X(RIGHT_X + 16), Y(528));
  b.text('FP-ANNO', X(RIGHT_X + 34), Y(526), 2.2, 'NORTH (SCHEMATIC - ORIENT TO', { vAlign: 'middle' });
  b.text('FP-ANNO', X(RIGHT_X + 34), Y(522), 2.2, 'ARCHITECTURAL PLAN)', { vAlign: 'middle' });
  // legend
  const th = 2.2;
  const rows: { label: string; draw: (x: number, y: number) => void }[] = [
    { label: 'GENERAL-PURPOSE EXTINGUISHER', draw: (x, y) => extSymbol(b, x, y, s, 'general', false) },
    { label: 'CLASS K (WET CHEMICAL) EXTINGUISHER', draw: (x, y) => extSymbol(b, x, y, s, 'class-k', false) },
    { label: 'CLASS D (DRY POWDER) EXTINGUISHER', draw: (x, y) => extSymbol(b, x, y, s, 'class-d', false) },
    { label: 'WHEELED EXTINGUISHER (STANDS ON FLOOR)', draw: (x, y) => extSymbol(b, x, y + 0.8 * s, s, 'general', true) },
    {
      label: 'COVERAGE (TRAVEL) RADIUS',
      draw: (x, y) => b.line('FP-HIDN', x - 6 * s, y, x + 6 * s, y)
    },
    { label: 'PROTECTED ZONE BOUNDARY', draw: (x, y) => b.rect('FP-WALL', x - 6 * s, y - 2 * s, 12 * s, 4 * s) },
    { label: 'FE-XX-NN / UNIT = TAG / UNIT TYPE', draw: (x, y) => b.circle('FP-CNTR', x, y, 0.35 * s) }
  ];
  const rowH = 8;
  const top = 506;
  const w = 172;
  const h = 9 + rows.length * rowH + 2;
  b.rect('FP-TABL', X(RIGHT_X), Y(top - h), w * s, h * s);
  b.text('FP-ANNO', X(RIGHT_X + w / 2), Y(top - 4.5), th * 1.35, 'LEGEND', { align: 'center', vAlign: 'middle' });
  b.line('FP-TABL', X(RIGHT_X), Y(top - 9), X(RIGHT_X + w), Y(top - 9));
  rows.forEach((row, i) => {
    const y = top - 9 - rowH * (i + 0.5);
    row.draw(X(RIGHT_X + 11), Y(y));
    b.text('FP-ANNO', X(RIGHT_X + 22), Y(y), th, row.label, { vAlign: 'middle' });
  });
  // notes
  const floorsNote = fe.floorsMissing.length
    ? `WARNING - OCCUPIED FLOOR(S) WITHOUT AN EXTINGUISHER: ${fe.floorsMissing.join(', ')} (IFC SEC. 906.1 / NFPA 10 SEC. 6.1).`
    : `EVERY OCCUPIED FLOOR HAS AT LEAST ONE EXTINGUISHER (${fe.floorsCovered.join(', ')}) - IFC SEC. 906.1 / NFPA 10 SEC. 6.1.`;
  const notes = [
    'POSITIONS ARE COVERAGE POINTS OF A UNIFORM GRID - MOUNT EACH UNIT ON THE NEAREST WALL OR COLUMN ALONG THE NORMAL PATH OF TRAVEL, NEAR EXITS, CONSPICUOUS AND UNOBSTRUCTED (NFPA 10 SEC. 6.1.3). SIGN WHERE NOT VISIBLE (SEC. 6.1.3.3).',
    'TRAVEL DISTANCE IS THE DIRECT DISTANCE FROM ANY POINT OF THE ZONE TO THE NEAREST UNIT (HALF CELL DIAGONAL). VERIFY THE ACTUAL WALKING TRAVEL DISTANCE ON THE ARCHITECTURAL PLAN: 75 FT CLASS A / D, 30-50 FT CLASS B, 30 FT CLASS K (NFPA 10 SEC. 6.2.1, 6.3, 6.5, 6.6).',
    'DASHED CIRCLE = MAXIMUM TRAVEL DISTANCE FOR THAT UNIT, DRAWN TO THE SHEET SCALE. ZONE RECTANGLES ARE TO SCALE BUT SCHEMATIC - NOT ARCHITECTURAL WALLS.',
    'MOUNTING: TOP OF UNIT 1200 MM (UNITS 40 LB OR LESS, MAX. 1530 MM) OR 1000 MM (OVER 40 LB, MAX. 1070 MM) ABOVE FLOOR; BOTTOM NOT LESS THAN 102 MM. SEE FP-109 FOR DETAILS, SCHEDULE AND SPECIFICATIONS.',
    floorsNote
  ];
  const nTop = top - h - 8;
  drawNotes(c, RIGHT_X + 2, nTop, w - 2, 'GENERAL NOTES', notes, 2.0);
  void lay;
  void pageIdx;
}

export function drawExtinguisherLayoutSheet(c: Ctx, lay: ExtinguisherLayout, pageIdx: number): void {
  const page = lay.pages[pageIdx] ?? [];
  const pc = lay.pages.length;
  for (const p of page) drawPanel(c, p, lay.scale);
  drawLegendAndNotes(c, lay, pageIdx);
  sheetTitle(c, 30, 568, 'PORTABLE FIRE EXTINGUISHER LAYOUT - SCHEMATIC FLOOR PLANS', `NFPA 10-2022 / IFC SEC. 906${pc > 1 ? ` - PAGE ${pageIdx + 1} OF ${pc}` : ''} - SCALE 1:${lay.scale}`);
}

// ───────────────────────────────────────── FP-109 ─────────────────────────────────────────

/** Drawing context for 1:20 details: local coordinates in real mm with the origin at a paper position. */
class Local {
  readonly ox: number;
  readonly oy: number;
  constructor(
    private readonly c: Ctx,
    xP: number,
    yP: number
  ) {
    this.ox = PX(c, xP);
    this.oy = PY(c, yP);
  }
  p(x: number, y: number): Pt {
    return [this.ox + x, this.oy + y];
  }
  line(layer: string, x1: number, y1: number, x2: number, y2: number): void {
    const a = this.p(x1, y1);
    const z = this.p(x2, y2);
    this.c.b.line(layer, a[0], a[1], z[0], z[1]);
  }
  poly(layer: string, pts: Pt[], closed = false): void {
    this.c.b.polyline(layer, pts.map((q) => this.p(q[0], q[1])), closed);
  }
  rect(layer: string, x0: number, y0: number, x1: number, y1: number): void {
    const a = this.p(x0, y0);
    this.c.b.rect(layer, a[0], a[1], x1 - x0, y1 - y0);
  }
  hatch(x0: number, y0: number, x1: number, y1: number): void {
    const a = this.p(x0, y0);
    this.c.b.rect('FP-WALL', a[0], a[1], x1 - x0, y1 - y0);
    this.c.b.hatchRect(a[0], a[1], x1 - x0, y1 - y0, 1.8);
  }
  circle(layer: string, x: number, y: number, rr: number): void {
    const a = this.p(x, y);
    this.c.b.circle(layer, a[0], a[1], rr);
  }
  arc(layer: string, x: number, y: number, rr: number, a0: number, a1: number): void {
    const a = this.p(x, y);
    this.c.b.arc(layer, a[0], a[1], rr, a0, a1);
  }
  text(layer: string, x: number, y: number, h: number, t: string, o: { rotationDeg?: number; align?: 'left' | 'center' | 'right'; vAlign?: 'baseline' | 'bottom' | 'middle' | 'top' } = {}): void {
    const a = this.p(x, y);
    this.c.b.text(layer, a[0], a[1], h, t, o);
  }
  dim(x1: number, y1: number, x2: number, y2: number, offPaper: number, override?: string): void {
    const a = this.p(x1, y1);
    const z = this.p(x2, y2);
    this.c.b.dimLinear(a[0], a[1], z[0], z[1], offPaper, override);
  }
  balloon(n: string, bx: number, by: number, tx: number, ty: number): void {
    const s = this.c.sheet.scale;
    const q = this.p(bx, by);
    const t = this.p(tx, ty);
    const dl = Math.hypot(q[0] - t[0], q[1] - t[1]);
    const u: Pt = [(q[0] - t[0]) / dl, (q[1] - t[1]) / dl];
    arrowLine(this.c.b, t, [q[0] - u[0] * 3 * s, q[1] - u[1] * 3 * s], s);
    drawTag(this.c.b, q[0], q[1], n, s);
  }
}

/** Side elevation of an extinguisher (valve at top, hose, body, dome). Top of the valve at yTop. */
function extSide(L: Local, xc: number, yb: number, H: number, rr: number): { bodyTopY: number } {
  const hc = H - rr - 55;
  const layer = 'FP-EQPM';
  L.poly(layer, [[xc - rr, yb + hc], [xc - rr, yb], [xc + rr, yb], [xc + rr, yb + hc]]);
  L.arc(layer, xc, yb + hc, rr, 0, 180);
  L.rect(layer, xc - 18, yb + hc + rr, xc + 18, yb + hc + rr + 25);
  L.rect(layer, xc - 40, yb + H - 30, xc + 40, yb + H);
  L.poly(layer, [[xc + 40, yb + H - 10], [xc + 78, yb + H - 18], [xc + 78, yb + H - 32]]);
  L.poly(layer, [[xc + 40, yb + H - 20], [xc + rr + 14, yb + H - 20], [xc + rr + 14, yb + hc * 0.45]]);
  L.line(layer, xc - rr, yb + 55, xc + rr, yb + 55); // base ring
  return { bodyTopY: yb + hc };
}

interface DetailUnit {
  id: string;
  heightMm: number;
  grossLb: number;
}

function pickDetailUnit(fe: ExtinguisherSystemDesign, heavy: boolean): DetailUnit {
  const cnt = new Map<string, number>();
  for (const z of fe.zones) for (const e of z.extinguishers) cnt.set(e.unitId, (cnt.get(e.unitId) ?? 0) + 1);
  const used = new Set(cnt.keys());
  const ok = (u: ExtinguisherUnitType): boolean => !u.wheeled && (heavy ? u.grossWeightLb > 40 : u.grossWeightLb <= 40);
  const pool = fe.catalog.filter(ok);
  const u = [...pool.filter((q) => used.has(q.id)), ...pool].sort((a, z) => (cnt.get(z.id) ?? 0) - (cnt.get(a.id) ?? 0) || z.heightMm - a.heightMm)[0];
  if (u) return { id: u.id, heightMm: u.heightMm, grossLb: u.grossWeightLb };
  return heavy ? { id: 'TYPICAL', heightMm: 650, grossLb: 45 } : { id: 'TYPICAL', heightMm: 500, grossLb: 17 };
}

function titleOf(c: Ctx, xCentre: number, y: number, title: string, lines: string[], maxW: number): void {
  const { b } = c;
  b.text('FP-ANNO', PX(c, xCentre), PY(c, y), fit(title, maxW, 3.2), title, { align: 'center', vAlign: 'middle' });
  b.line('FP-ANNO', PX(c, xCentre - Math.min(maxW, title.length * 0.78 * 3.2) / 2), PY(c, y - 2.6), PX(c, xCentre + Math.min(maxW, title.length * 0.78 * 3.2) / 2), PY(c, y - 2.6));
  lines.forEach((t, i) => b.text('FP-ANNO', PX(c, xCentre), PY(c, y - 6 - i * 3.6), fit(t, maxW, 2), t, { align: 'center', vAlign: 'middle' }));
}

function mountingDetail(
  c: Ctx,
  wallXP: number,
  floorYP: number,
  o: { title: string; caption: string[]; topMm: number; maxMm: number; unit: DetailUnit; centreP: number; maxW: number }
): void {
  const { b, sheet } = c;
  const s = sheet.scale;
  const L = new Local(c, wallXP, floorYP);
  const H = o.unit.heightMm;
  const yb = o.topMm - H;
  const rr = Math.max(45, Math.min(110, H * 0.14));
  const xc = 25 + rr;
  const ys = yb + 0.6 * H;
  const xd = xc + rr + 170; // dimension baseline
  L.hatch(-200, -150, xd + 30, 0); // floor slab
  L.hatch(-150, 0, 0, 1750); // wall
  L.line('FP-WALL', 0, 0, xd + 30, 0);
  // bracket: wall plate + strap around the body
  L.rect('FP-VALV', 0, ys - 45, 10, ys + 45);
  L.rect('FP-VALV', 10, ys - 10, xc + rr + 12, ys + 10);
  L.line('FP-VALV', 10, ys - 45 + 5, 10, ys + 45 - 5);
  extSide(L, xc, yb, H, rr);
  // 102 mm minimum clearance marker
  L.line('FP-HIDN', 0, 102, xd, 102);
  L.line('FP-DIMS', 100, 0, 100, 102);
  for (const yy of [0, 102]) L.line('FP-DIMS', 100 - 25, yy - 25, 100 + 25, yy + 25);
  L.text('FP-DIMS', 125, 51, 1.8, '102 MIN', { vAlign: 'middle' });
  // witness lines to the dimension baseline
  L.line('FP-DIMS', xc + 40, o.topMm, xd, o.topMm);
  L.line('FP-DIMS', xc + rr, yb, xd, yb);
  L.line('FP-HIDN', 0, o.maxMm, xd, o.maxMm);
  L.dim(xd, 0, xd, yb, -8);
  L.dim(xd, 0, xd, o.topMm, -16);
  L.dim(xd, 0, xd, o.maxMm, -24);
  // balloons: 1 wall, 2 bracket, 3 unit, 4 floor slab
  L.balloon('1', -430, 1300, -150, 1300);
  L.balloon('4', -430, -80, -200, -80);
  L.balloon('2', xc + rr + 90, ys + 90, xc + rr + 12, ys);
  L.balloon('3', xc + rr + 90, ys - 170, xc + rr, ys - 170);
  const keyY = floorYP - 12;
  const cx = o.centreP;
  const key = [`1 WALL   2 BRACKET (UL LISTED)   3 EXTINGUISHER ${o.unit.id}`, `4 FLOOR SLAB - UNIT HEIGHT ${H} MM, GROSS ${o.unit.grossLb} LB`];
  key.forEach((t, i) => b.text('FP-ANNO', PX(c, cx), PY(c, keyY - i * 3.6), fit(t, o.maxW, 2), t, { align: 'center', vAlign: 'middle' }));
  titleOf(c, cx, 538, o.title, o.caption, o.maxW);
  void s;
}

function cabinetDetail(c: Ctx, frontXP: number, sectionXP: number, floorYP: number, centreP: number, maxW: number): void {
  const { b } = c;
  const s = c.sheet.scale;
  // ── front elevation ──
  const F = new Local(c, frontXP, floorYP);
  const cb = 650;
  const ct = 1350;
  F.line('FP-WALL', -320, 0, 320, 0);
  F.rect('FP-ARCH', -165, cb - 25, 165, ct + 25); // trim
  F.rect('FP-ARCH', -140, cb, 140, ct); // door
  F.rect('FP-ARCH', -95, cb + 150, 95, ct - 90); // glass
  F.rect('FP-ARCH', 100, 980, 118, 1060); // handle
  F.rect('FP-HIDN', -65, 700, 65, 1200); // extinguisher behind the glass
  F.text('FP-ANNO', -118, 1000, 1.6, 'FIRE EXTINGUISHER', { rotationDeg: 90, align: 'center', vAlign: 'middle' });
  F.dim(-165, ct + 25, 165, ct + 25, 8);
  F.dim(-190, cb - 25, -190, ct + 25, 8);
  F.dim(190, 0, 190, 1200, -8);
  F.line('FP-DIMS', 65, 1200, 190, 1200);
  F.balloon('1', 245, 900, 165, 900);
  b.text('FP-ANNO', PX(c, frontXP), PY(c, floorYP - 5), 2, 'FRONT', { align: 'center', vAlign: 'middle' });
  // ── section ──
  const S = new Local(c, sectionXP, floorYP);
  const wallT = 200;
  S.hatch(-wallT - 100, -150, 360, 0);
  S.hatch(-wallT, 0, 0, cb - 25);
  S.hatch(-wallT, ct + 25, 0, 1750);
  S.hatch(-wallT, cb - 25, -100, ct + 25); // wall behind the recess
  S.line('FP-WALL', 0, 0, 360, 0);
  // cabinet shell (back at x=-100, front at x=+60)
  S.poly('FP-ARCH', [[0, cb - 25], [-100, cb - 25], [-100, ct + 25], [0, ct + 25]]);
  S.poly('FP-ARCH', [[-85, cb], [-85, ct], [45, ct], [45, cb], [-85, cb]]);
  S.rect('FP-ARCH', 45, cb, 60, ct); // door
  S.rect('FP-ARCH', 0, cb - 25, 60, cb); // trim flange (bottom)
  S.rect('FP-ARCH', 0, ct, 60, ct + 25); // trim flange (top)
  S.rect('FP-ARCH', 40, 990, 62, 1070); // handle
  // extinguisher inside
  extSide(S, -20, 700, 500, 55);
  S.dim(-100, ct + 25, 60, ct + 25, 8);
  S.dim(300, 0, 300, 1200, -8);
  S.line('FP-DIMS', 40, 1200, 300, 1200);
  S.line('FP-DIMS', 60, cb - 25, 300, cb - 25);
  S.dim(300, 0, 300, cb - 25, -16);
  S.balloon('2', 200, 1500, 20, ct + 25);
  S.balloon('3', -430, 1000, -200, 1000);
  S.balloon('4', 200, 780, -20, 780);
  b.text('FP-ANNO', PX(c, sectionXP), PY(c, floorYP - 11), 2, 'SECTION', { align: 'center', vAlign: 'middle' });
  const keyY = floorYP - 19;
  const key = ['1 TRIM  2 SEMI-RECESSED CABINET (NOT LOCKED)', '3 WALL / STUD RECESS 100 MM   4 EXTINGUISHER', 'DOOR: BREAK-GLASS OR CLEAR PANEL, LABELLED'];
  key.forEach((t, i) => b.text('FP-ANNO', PX(c, centreP), PY(c, keyY - i * 3.6), fit(t, maxW, 2), t, { align: 'center', vAlign: 'middle' }));
  titleOf(c, centreP, 538, 'SEMI-RECESSED CABINET DETAIL', ['FRONT ELEVATION AND SECTION - TOP OF UNIT 1200 MM', 'CABINET 330 X 750 X 160 (100 MM RECESSED, 60 MM PROJECTION)'], maxW);
  void s;
}

function signDetail(c: Ctx, xP: number, yP: number, centreP: number, maxW: number): void {
  const { b } = c;
  const S = new Local(c, xP, yP);
  S.rect('FP-ANNO', -300, -150, 300, 150);
  S.rect('FP-ANNO', -280, -130, 280, 130);
  // pictogram: extinguisher silhouette
  S.rect('FP-ANNO', -230, -90, -150, 70);
  S.arc('FP-ANNO', -190, 70, 40, 0, 180);
  S.rect('FP-ANNO', -205, 110, -175, 130);
  S.poly('FP-ANNO', [[-175, 120], [-120, 120], [-120, 80]]);
  S.circle('FP-ANNO', -250, -110, 8);
  S.circle('FP-ANNO', 250, -110, 8);
  S.circle('FP-ANNO', -250, 110, 8);
  S.circle('FP-ANNO', 250, 110, 8);
  S.text('FP-ANNO', 30, 35, 2.6, 'FIRE', { align: 'center', vAlign: 'middle' });
  S.text('FP-ANNO', 30, -30, 1.9, 'EXTINGUISHER', { align: 'center', vAlign: 'middle' });
  S.dim(-300, -150, 300, -150, -8);
  S.dim(300, -150, 300, 150, -8);
  const key = ['RED / WHITE PHOTOLUMINESCENT SIGN, 600 X 300', 'MOUNTED ABOVE THE UNIT, VISIBLE ALONG', 'EVERY APPROACH (NFPA 10 SEC. 6.1.3.3)', '4 X FIXING HOLES'];
  key.forEach((t, i) => b.text('FP-ANNO', PX(c, centreP), PY(c, yP - 24 - i * 3.6), fit(t, maxW, 2), t, { align: 'center', vAlign: 'middle' }));
  titleOf(c, centreP, 538, 'SIGN DETAIL', ['FIRE EXTINGUISHER LOCATION SIGN', 'FRONT ELEVATION'], maxW);
}

// ── tables ──

function scheduleRows(fe: ExtinguisherSystemDesign, floorName: (id: string) => string): string[][] {
  const rows: string[][] = [];
  for (const z of fe.zones) {
    for (const e of z.extinguishers) {
      const u = fe.catalog.find((q) => q.id === e.unitId);
      const wheeled = e.mounting === 'wheeled';
      rows.push([
        e.tag,
        floorName(z.floorId).toUpperCase(),
        z.zoneName.toUpperCase(),
        e.unitId,
        u?.ratingText ?? '-',
        u ? AGENT_SHORT[u.agent] : '-',
        e.mounting.toUpperCase(),
        wheeled ? 'FLOOR' : String(Math.round(e.mountingTopMm)),
        wheeled ? '-' : String(Math.round(e.bottomClearanceMm))
      ]);
    }
  }
  return rows;
}

const SCHED_HEAD = ['TAG', 'FLOOR', 'ZONE', 'UNIT', 'RATING', 'AGENT', 'MOUNTING', 'TOP MM', 'BOT. MM'];

const MATRIX: Record<ExtinguisherAgent, [string, string, string, string, string]> = {
  'dry-chemical-abc': ['YES', 'YES', 'YES', 'NO', 'NO'],
  co2: ['NO', 'YES', 'YES', 'NO', 'NO'],
  water: ['YES', 'NO', 'NO', 'NO', 'NO'],
  afff: ['YES', 'YES', 'NO', 'NO', 'NO'],
  'clean-agent': ['LTD', 'YES', 'YES', 'NO', 'NO'],
  'wet-chemical': ['YES', 'NO', 'NO', 'NO', 'YES'],
  'dry-powder-d': ['NO', 'NO', 'NO', 'YES', 'NO']
};
const MATRIX_NAME: Record<ExtinguisherAgent, string> = {
  'dry-chemical-abc': 'DRY CHEMICAL ABC',
  co2: 'CARBON DIOXIDE',
  water: 'WATER',
  afff: 'AFFF FOAM',
  'clean-agent': 'CLEAN AGENT',
  'wet-chemical': 'WET CHEMICAL',
  'dry-powder-d': 'DRY POWDER (D)'
};

export function extinguisherSpecNotes(r: FireDesignResult): string[] {
  const fe = r.extinguishers!;
  const kZones = fe.zones.filter((z) => z.kUnits > 0).length;
  const dZones = fe.zones.filter((z) => z.dUnits > 0).length;
  return [
    `SCOPE: ${fe.totalCount} PORTABLE FIRE EXTINGUISHERS IN ${fe.zones.length} ZONES, SELECTED, LOCATED, INSTALLED AND MAINTAINED PER NFPA 10-2022 AND IFC SEC. 906 (906.1 WHERE REQUIRED, 906.2 GENERAL REQUIREMENTS, 906.3 SIZE AND DISTRIBUTION). ALL UNITS LISTED AND LABELLED (UL 711); RATINGS SHOWN ARE TYPICAL - VERIFY WITH THE SELECTED MANUFACTURER.`,
    'OCCUPANCY HAZARD (NFPA 10 SEC. 5.4): LIGHT (LOW), ORDINARY (MODERATE) OR EXTRA (HIGH) AS SHOWN FOR EACH ZONE ON FP-108.',
    'CLASS A (TABLE 6.2.1.1): MINIMUM SINGLE-UNIT RATING 2-A LIGHT / ORDINARY AND 4-A EXTRA; MAXIMUM FLOOR AREA PER UNIT OF A-RATING 3000 / 1500 / 1000 FT2 (LIGHT / ORDINARY / EXTRA) AND NEVER MORE THAN 11,250 FT2 PER EXTINGUISHER; MAXIMUM TRAVEL DISTANCE 75 FT.',
    'CLASS B FLAMMABLE LIQUIDS, SPILL FUEL (TABLE 6.3.1.1): LIGHT 5-B AT 30 FT OR 10-B AT 50 FT; ORDINARY 10-B AT 30 FT OR 20-B AT 50 FT; EXTRA 40-B AT 30 FT OR 80-B AT 50 FT.',
    'CLASS B LIQUID OF APPRECIABLE DEPTH (SEC. 6.3.2): AT LEAST 20-B PER FT2 OF THE LARGEST LIQUID SURFACE, TRAVEL DISTANCE 50 FT OR LESS. PORTABLE EXTINGUISHERS ARE NOT THE SOLE PROTECTION WHERE THE SURFACE EXCEEDS 10 FT2 - A FIXED SYSTEM IS REQUIRED.',
    'CLASS C (SEC. 6.4): ENERGIZED ELECTRICAL EQUIPMENT - C-RATED, NON-CONDUCTIVE AGENT SIZED ON THE A / B HAZARD OF THE AREA. DRY CHEMICAL IS NOT USED ON DELICATE ELECTRONICS (SEC. 5.5.4 AND ANNEX) - CARBON DIOXIDE OR CLEAN AGENT IS PROVIDED.',
    `CLASS D (SEC. 6.5): COMBUSTIBLE METALS - EXTINGUISHING AGENT LISTED FOR THE SPECIFIC METAL, TRAVEL DISTANCE 75 FT OR LESS FROM THE HAZARD, SIZE PER MANUFACTURER${dZones ? ` (${dZones} ZONE${dZones > 1 ? 'S' : ''})` : ''}.`,
    `CLASS K (SEC. 6.6): COOKING APPLIANCES WITH COMBUSTIBLE COOKING MEDIA - WET CHEMICAL UNIT WITHIN 30 FT TRAVEL OF THE HAZARD; ONE 1.5 GAL (6 L) UNIT PER UP TO 4 FRYERS OF NOT MORE THAN 80 LB OF COOKING MEDIUM EACH, ONE MORE PER ADDITIONAL GROUP OF 4${kZones ? ` (${kZones} ZONE${kZones > 1 ? 'S' : ''})` : ''}.`,
    'MOUNTING (SEC. 6.1.3.8): UNITS WITH A GROSS WEIGHT OF 40 LB OR LESS - TOP OF THE UNIT 1200 MM ABOVE THE FLOOR, NEVER MORE THAN 5 FT (1530 MM); UNITS OVER 40 LB - TOP NOT MORE THAN 3.5 FT (1070 MM), DESIGNED 1000 MM; CLEARANCE BETWEEN THE UNIT BOTTOM AND THE FLOOR NOT LESS THAN 4 IN (102 MM). WHEELED UNITS STAND ON THE FLOOR.',
    'LOCATION (SEC. 6.1.3): CONSPICUOUS, READILY ACCESSIBLE AND UNOBSTRUCTED, ALONG NORMAL PATHS OF TRAVEL INCLUDING EXITS; SIGN OR ARROW SIGN WHERE THE UNIT IS NOT VISIBLE (SEC. 6.1.3.3). CABINETS ARE NOT LOCKED. DO NOT PLACE UNITS WHERE THEY ARE SUBJECT TO PHYSICAL DAMAGE OR TEMPERATURES OUTSIDE THE LISTED RANGE.',
    'EACH OCCUPIED FLOOR HAS AT LEAST ONE EXTINGUISHER (IFC SEC. 906.1 / NFPA 10 SEC. 6.1). WHERE A UNIT SITS IN A SEMI-RECESSED CABINET THE CABINET DOES NOT REDUCE THE EXIT-ACCESS WIDTH OR PROJECT MORE THAN THE PERMITTED PROTRUSION (IBC SEC. 1003.3.3).',
    'TRAVEL MODEL: DIRECT DISTANCE FROM ANY POINT OF A ZONE TO THE NEAREST UNIT (HALF THE CELL DIAGONAL OF A UNIFORM GRID). VERIFY THE ACTUAL WALKING TRAVEL DISTANCE ON THE ARCHITECTURAL PLAN AND ADD UNITS WHERE WALLS, SHELVING OR EQUIPMENT LENGTHEN THE ROUTE.',
    'INSPECTION AND MAINTENANCE (NFPA 10 CH. 7): MONTHLY INSPECTION (SEC. 7.2), ANNUAL MAINTENANCE (SEC. 7.3), 6-YEAR INTERNAL EXAMINATION OF STORED-PRESSURE DRY CHEMICAL UNITS (SEC. 7.3.3), RECHARGE AFTER USE; HYDROSTATIC TESTING (CH. 8, TABLE 8.3.1): WATER / AFFF / WET CHEMICAL / CO2 EVERY 5 YEARS, DRY CHEMICAL / CLEAN AGENT / DRY POWDER EVERY 12 YEARS. RECORDS KEPT PER SEC. 7.2 AND 7.3.',
    'MANUFACTURER, MODEL, FINISH AND CABINET TYPE TO BE SUBMITTED FOR APPROVAL. THE FIRE CODE OFFICIAL MAY REQUIRE ADDITIONAL OR DIFFERENT UNITS BASED ON THE ACTUAL OCCUPANCY AND ARCHITECTURAL LAYOUT.'
  ];
}

interface Block {
  w: number;
  h: number;
  minX: number;
  draw: (x: number, yTop: number) => void;
}

function tableBlock(c: Ctx, cols: number[], rows: string[][], o: { title: string; th: number; alignRight?: boolean[] }): Block {
  const m = measureTable(cols, rows, { title: o.title, th: o.th });
  return {
    w: m.w,
    h: m.h,
    minX: tableMinX(cols, rows, o.th),
    draw: (x, y) => void drawTable(c, x, y, cols, rows, { title: o.title, th: o.th, alignRight: o.alignRight })
  };
}

function buildBlocks(c: Ctx, th: number, maxH: number): Block[] {
  const { r } = c;
  const fe = r.extinguishers!;
  const bFloors = r.input.building?.floors ?? [];
  const floorName = (id: string): string => bFloors.find((f) => f.id === id)?.name ?? id;
  const blocks: Block[] = [];
  // schedule (split into chunks that fit the available height)
  const rows = scheduleRows(fe, floorName);
  const align = [false, false, false, false, false, false, false, true, true];
  const lineH = th * 1.3 + 2.8;
  const maxRows = Math.max(4, Math.floor((maxH - th * 2.6 - lineH) / lineH));
  const chunks: string[][][] = [];
  for (let i = 0; i < rows.length; i += maxRows) chunks.push(rows.slice(i, i + maxRows));
  chunks.forEach((ch, i) => {
    const data = [SCHED_HEAD, ...ch];
    blocks.push(tableBlock(c, autoCols(data, th), data, { title: i === 0 ? 'EXTINGUISHER SCHEDULE' : 'EXTINGUISHER SCHEDULE (CONT.)', th, alignRight: align }));
  });
  // quantity summary
  const q: string[][] = [['UNIT', 'DESCRIPTION', 'RATING', 'QTY']];
  for (const t of fe.totals) q.push([t.unitId, wrapText(t.label.toUpperCase(), 30).join('\n'), t.ratingText, String(t.qty)]);
  q.push(['', 'TOTAL', '', String(fe.totalCount)]);
  blocks.push(tableBlock(c, autoCols(q, th), q, { title: 'QUANTITY SUMMARY', th, alignRight: [false, false, false, true] }));
  // selection matrix
  const qtyOf = (a: ExtinguisherAgent): number => fe.totals.filter((t) => fe.catalog.find((u) => u.id === t.unitId)?.agent === a).reduce((n, t) => n + t.qty, 0);
  const mx: string[][] = [['AGENT', 'A', 'B', 'C', 'D', 'K', 'USED']];
  (Object.keys(MATRIX) as ExtinguisherAgent[]).forEach((a) => mx.push([MATRIX_NAME[a], ...MATRIX[a], String(qtyOf(a))]));
  mx.push(['YES = SUITABLE', 'NO = NOT USED', '', '', '', '', '']);
  mx.push(['LTD = ONLY WHERE THE', 'LISTED RATING', 'INCLUDES THE CLASS', '', '', '', '']);
  const mxM = mx.slice(0, 8);
  blocks.push(tableBlock(c, autoCols(mxM, th), mxM, { title: 'SELECTION MATRIX (CLASS A / B / C / D / K)', th, alignRight: [false, false, false, false, false, false, true] }));
  // inspection & maintenance
  const ins: string[][] = [
    ['ACTIVITY', 'INTERVAL', 'NFPA 10'],
    ['MONTHLY INSPECTION\n(LOCATION, ACCESS, SEAL, GAUGE,\nDAMAGE, SERVICE TAG)', 'EVERY 30 DAYS', 'SEC. 7.2'],
    ['ANNUAL MAINTENANCE\n(EXTERNAL EXAMINATION,\nMECHANICAL PARTS, AGENT)', 'ANNUALLY', 'SEC. 7.3'],
    ['INTERNAL EXAMINATION\nSTORED-PRESSURE DRY CHEMICAL', 'EVERY 6 YEARS', 'SEC. 7.3.3'],
    ['RECHARGE AFTER ANY USE\nOR WHEN PRESSURE IS LOW', 'AS REQUIRED', 'CH. 7']
  ];
  for (const t of fe.totals) {
    const u = fe.catalog.find((x) => x.id === t.unitId);
    if (!u) continue;
    ins.push([`HYDROSTATIC TEST\n${u.id} (${AGENT_SHORT[u.agent]})`, `EVERY ${u.hydroTestYears} YEARS`, 'TABLE 8.3.1']);
    if (u.internalExamYears) ins.push([`INTERNAL EXAMINATION\n${u.id} (${AGENT_SHORT[u.agent]})`, `EVERY ${u.internalExamYears} YEARS`, 'SEC. 7.3.3']);
  }
  blocks.push(tableBlock(c, autoCols(ins, th), ins, { title: 'INSPECTION & MAINTENANCE (NFPA 10 CH. 7 / CH. 8)', th }));
  // compliance summary — zone checks grouped by rule (id before ':'), then system checks
  const groups = new Map<string, { title: string; ref: string; pass: number; warn: number; fail: number }>();
  for (const z of fe.zones) {
    for (const k of z.checks) {
      const base = k.id.split(':')[0];
      const g = groups.get(base) ?? { title: k.title.split(' — ')[0], ref: k.reference, pass: 0, warn: 0, fail: 0 };
      g[k.status] += 1;
      groups.set(base, g);
    }
  }
  const cs: string[][] = [['CHECK', 'NFPA 10-2022 / IFC', 'PASS', 'WARN', 'FAIL']];
  for (const g of groups.values()) {
    cs.push([wrapText(g.title.toUpperCase(), 34).join('\n'), wrapText(g.ref.toUpperCase(), 30).join('\n'), String(g.pass), String(g.warn), String(g.fail)]);
  }
  for (const k of fe.checks) {
    const n = (s: string): string => (k.status === s ? '1' : '0');
    cs.push([wrapText(k.title.toUpperCase(), 34).join('\n'), wrapText(k.reference.toUpperCase(), 30).join('\n'), n('pass'), n('warn'), n('fail')]);
  }
  blocks.push(tableBlock(c, autoCols(cs, th), cs, { title: 'EXTINGUISHER COMPLIANCE SUMMARY', th, alignRight: [false, false, true, true, true] }));
  return blocks;
}

function flow(blocks: Block[], x0: number, xMax: number, yTop: number, yBottom: number, gap: number): { pos: { x: number; y: number }[]; ok: boolean } {
  const pos: { x: number; y: number }[] = [];
  let colX = x0;
  let colMinX = x0;
  let colW = 0;
  let y = yTop;
  let colStart = true;
  for (const blk of blocks) {
    const needNew = !colStart && (y - blk.h < yBottom || blk.minX > colX + 1e-6);
    if (needNew) {
      colX += colW + gap;
      colW = 0;
      y = yTop;
      colStart = true;
    }
    if (colStart) {
      colX = Math.max(colX, blk.minX);
      colMinX = colX;
      colStart = false;
    }
    pos.push({ x: colX, y });
    y -= blk.h + gap;
    colW = Math.max(colW, blk.w);
  }
  void colMinX;
  const last = pos.length ? pos[pos.length - 1].x : x0;
  const ok = blocks.every((b, i) => pos[i].x + b.w <= xMax && pos[i].y - b.h >= yBottom - 1e-6) && last <= xMax;
  return { pos, ok };
}

export function drawExtinguisherDetailSheet(c: Ctx): void {
  const { b, r } = c;
  const fe = r.extinguishers!;
  const floorY = 425;
  const lightU = pickDetailUnit(fe, false);
  const heavyU = pickDetailUnit(fe, true);

  // ── details band ──
  mountingDetail(c, 62, floorY, {
    title: 'MOUNTING DETAIL - UNITS UP TO 40 LB',
    caption: ['TOP OF UNIT 1200 MM AFF (MAX. 1530 MM = 5 FT)', 'BOTTOM MIN. 102 MM (4 IN) ABOVE FLOOR - SEC. 6.1.3.8'],
    topMm: 1200,
    maxMm: 1530,
    unit: lightU,
    centreP: 84,
    maxW: 108
  });
  mountingDetail(c, 190, floorY, {
    title: 'MOUNTING DETAIL - UNITS OVER 40 LB',
    caption: ['TOP OF UNIT 1000 MM AFF (MAX. 1070 MM = 3.5 FT)', 'BOTTOM MIN. 102 MM; WHEELED UNITS STAND ON FLOOR'],
    topMm: 1000,
    maxMm: 1070,
    unit: heavyU,
    centreP: 212,
    maxW: 108
  });
  cabinetDetail(c, 322, 400, floorY, 372, 130);
  signDetail(c, 535, 460, 535, 90);

  // ── tables (lower left region) ──
  const xMax = 648;
  const yTop = 380;
  const yBottom = 16;
  let placed = false;
  for (const th of [2.2, 2.0]) {
    const blocks = buildBlocks(c, th, yTop - yBottom);
    const f = flow(blocks, 26, xMax, yTop, yBottom, 6);
    if (f.ok || th === 2.0) {
      blocks.forEach((blk, i) => blk.draw(f.pos[i].x, f.pos[i].y));
      placed = true;
      break;
    }
  }
  void placed;

  // ── notes (right column) ──
  const notes = extinguisherSpecNotes(r);
  const w = 174;
  let th = 2.2;
  if (notesHeight(RIGHT_X + 2, w, notes, th) > 548 - 80) th = 2.0;
  drawNotes(c, RIGHT_X + 2, 552, w, 'EXTINGUISHER SPECIFICATIONS & NOTES', notes, th);

  sheetTitle(c, 30, 568, 'FIRE EXTINGUISHER DETAILS, SCHEDULE & SPECIFICATIONS', 'MOUNTING, CABINET AND SIGN DETAILS (1:20), SCHEDULE, SELECTION MATRIX, INSPECTION & MAINTENANCE - NFPA 10-2022 / IFC SEC. 906');
  void b;
  void FRAME;
}
