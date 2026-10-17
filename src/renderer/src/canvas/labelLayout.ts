// Greedy, deterministic label collision layout (pure, screen-space px, no React / Konva).
import { uprightAngle } from './drawingGeometry';

export interface Rect { x: number; y: number; w: number; h: number }
/** An obstacle may carry a tag so a label can ignore obstacles that belong to its own symbol (e.g. its duct section). */
export interface Obstacle extends Rect { tag?: string }
/** `leader`: the label sits away from its symbol and should be tied to it with a leader line. */
export interface LabelCandidate { x: number; y: number; angleDeg?: number; leader?: boolean }

export interface LabelRequest {
  id: string;
  lines: string[];
  fontPx: number;
  /** Higher is placed first. */
  priority: number;
  /** Mandatory labels are never hidden (placed at the least-overlapping candidate when nothing is free). */
  mandatory?: boolean;
  /** Screen-space anchor (symbol centre); output offsets are relative to it. */
  anchor: { x: number; y: number };
  /** Half extents of the symbol the label belongs to; used by the default compass candidates. */
  anchorHalf?: { w: number; h: number };
  gap?: number;
  /** Explicit label centres (screen px), tried in order; default = compass positions around the anchor. */
  candidates?: LabelCandidate[];
  /** Obstacles with these tags are ignored for this label. */
  ignoreTags?: string[];
  /**
   * Never dropped, never left on top of something when any room exists: after the normal candidates fail it retries with
   * smaller fonts (see `FALLBACK_FONT_SCALES`) and finally with far candidates tied to the symbol by a leader line.
   * Implies `mandatory`.
   */
  guaranteed?: boolean;
}

/** Font scales tried (in order) by a `guaranteed` label. */
export const FALLBACK_FONT_SCALES = [1, 0.85, 0.72];

export interface PlacedLabel {
  id: string;
  visible: boolean;
  /** Label centre, screen px. */
  x: number;
  y: number;
  angleDeg: number;
  w: number;
  h: number;
  /** Centre offset from the request anchor. */
  dx: number;
  dy: number;
  /** Axis-aligned bounding box of the (possibly rotated) label. */
  rect: Rect;
  /** Font actually used (smaller than requested after a fallback). */
  fontPx: number;
  /** Draw a leader line from the anchor to the label. */
  leader: boolean;
}

export const LABEL_CHAR_W = 0.6;
export const LABEL_LINE_H = 1.25;
export const LABEL_PAD = 3;

/** Em width of a glyph class: lower case / digits / punctuation 0.6, bold capitals 0.76 (M, W 0.9), so capital text never truncates. */
const charEm = (c: string): number => (c === 'M' || c === 'W' ? 0.9 : c >= 'A' && c <= 'Z' ? 0.76 : LABEL_CHAR_W);

export const textEm = (text: string): number => {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += charEm(text[i]);
  return w;
};

export const measureText = (text: string, fontPx: number): number => textEm(text) * fontPx;

export function measureLabel(lines: string[], fontPx: number): { w: number; h: number } {
  let m = 0;
  for (const l of lines) m = Math.max(m, textEm(l));
  return { w: m * fontPx + 2 * LABEL_PAD, h: Math.max(1, lines.length) * fontPx * LABEL_LINE_H + 2 };
}

export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y;
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function rotatedAabb(cx: number, cy: number, w: number, h: number, angleDeg: number): Rect {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const bw = w * c + h * s, bh = w * s + h * c;
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

/** Compass candidates (E,S,N,W,SE,NE,SW,NW) at gap and at ~2.5x gap around the anchor. */
export function compassCandidates(
  anchor: { x: number; y: number },
  half: { w: number; h: number },
  size: { w: number; h: number },
  gap = 3
): LabelCandidate[] {
  const out: LabelCandidate[] = [];
  const dirs: Array<[number, number]> = [[1, 0], [0, 1], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const g of [gap, gap * 2.5 + 4]) {
    const ex = half.w + g + size.w / 2, ey = half.h + g + size.h / 2;
    for (const [dx, dy] of dirs) out.push({ x: anchor.x + dx * ex, y: anchor.y + dy * ey, angleDeg: 0 });
  }
  return out;
}

/** Far candidates (leader-line labels): 16 directions at three growing distances around the anchor. */
export function leaderCandidates(
  anchor: { x: number; y: number },
  half: { w: number; h: number },
  size: { w: number; h: number },
  gap = 3
): LabelCandidate[] {
  const out: LabelCandidate[] = [];
  const r0 = Math.max(half.w, half.h);
  for (const g of [gap * 4 + 10, gap * 8 + 20, gap * 14 + 34]) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 2 * Math.PI;
      const c = Math.cos(a), sn = Math.sin(a);
      out.push({
        x: anchor.x + c * (r0 + g + size.w / 2 * Math.abs(c)),
        y: anchor.y + sn * (r0 + g + size.h / 2 * Math.abs(sn)),
        angleDeg: 0,
        leader: true
      });
    }
  }
  return out;
}

/** Screen-space rectangle (px, container origin) -> layout space (world px * layoutScale) for a stage view. */
export function screenRectToLayout(
  r: Rect,
  view: { x: number; y: number; scale: number },
  layoutScale: number,
  pad = 0
): Rect {
  const f = layoutScale / Math.max(1e-9, view.scale);
  return { x: (r.x - view.x) * f - pad, y: (r.y - view.y) * f - pad, w: r.w * f + 2 * pad, h: r.h * f + 2 * pad };
}

/** Overlay toolbars (HUD) as label obstacles in layout space. */
export function overlayObstacles(
  rects: Rect[],
  view: { x: number; y: number; scale: number },
  layoutScale: number,
  pad = 6
): Obstacle[] {
  return rects.map((r) => ({ ...screenRectToLayout(r, view, layoutScale, pad * layoutScale / Math.max(1e-9, view.scale)), tag: 'overlay' }));
}

/**
 * Candidate centres for a duct-section tag: along each piece [x1,y1,x2,y2] (screen px) at several fractions, on the
 * upper then the lower side, rotated with the piece but never upside-down. Pieces too short for the label are skipped.
 */
export function ductTagCandidates(
  pieces: number[][],
  halfWidthPx: number,
  size: { w: number; h: number },
  fracs: number[] = [0.5, 0.3, 0.7, 0.15, 0.85]
): LabelCandidate[] {
  const order = pieces
    .map((p, i) => ({ p, i, len: Math.hypot(p[2] - p[0], p[3] - p[1]) }))
    .sort((a, b) => b.len - a.len || a.i - b.i);
  const out: LabelCandidate[] = [];
  const off = halfWidthPx + size.h / 2 + 2;
  for (const { p, len } of order) {
    if (len < size.w + 6) continue;
    const ang = uprightAngle((Math.atan2(p[3] - p[1], p[2] - p[0]) * 180) / Math.PI);
    const a = (ang * Math.PI) / 180;
    const ux = Math.sin(a), uy = -Math.cos(a);
    for (const f of fracs) {
      const mx = p[0] + (p[2] - p[0]) * f, my = p[1] + (p[3] - p[1]) * f;
      out.push({ x: mx + ux * off, y: my + uy * off, angleDeg: ang });
      out.push({ x: mx - ux * off, y: my - uy * off, angleDeg: ang });
    }
  }
  return out;
}

/**
 * Greedy placement. Requests are processed by priority (desc), then id (asc) so the result is deterministic.
 * A label is accepted at the first candidate whose bbox hits no obstacle and no already placed label.
 * Non-mandatory labels with no free candidate are hidden (level of detail at this zoom).
 */
export function layoutLabels(
  requests: LabelRequest[],
  obstacles: Obstacle[],
  opts: { margin?: number } = {}
): Map<string, PlacedLabel> {
  const margin = opts.margin ?? 1;
  const result = new Map<string, PlacedLabel>();
  const placed: Rect[] = [];
  const sorted = requests
    .slice()
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const blocked = (r: Rect, ign?: string[]): boolean => {
    for (const o of obstacles) if (!(ign && o.tag && ign.includes(o.tag)) && rectsOverlap(r, o, margin)) return true;
    for (const p of placed) if (rectsOverlap(r, p, margin)) return true;
    return false;
  };
  const cost = (r: Rect, ign?: string[]): number => {
    let c = 0;
    for (const o of obstacles) if (!(ign && o.tag && ign.includes(o.tag))) c += overlapArea(r, o);
    for (const p of placed) c += overlapArea(r, p);
    return c;
  };
  for (const req of sorted) {
    const mandatory = !!req.mandatory || !!req.guaranteed;
    const scales = req.guaranteed ? FALLBACK_FONT_SCALES : [1];
    let chosen: { c: LabelCandidate; rect: Rect; size: { w: number; h: number }; fontPx: number } | null = null;
    let best: { c: LabelCandidate; rect: Rect; size: { w: number; h: number }; fontPx: number; cost: number } | null = null;
    for (let si = 0; si < scales.length && !chosen; si++) {
      const fontPx = req.fontPx * scales[si];
      const size = measureLabel(req.lines, fontPx);
      const half = req.anchorHalf ?? { w: 0, h: 0 };
      let cands = req.candidates ?? compassCandidates(req.anchor, half, size, req.gap ?? 3);
      // the last (smallest) size may also use far, leader-line positions
      if (req.guaranteed && si === scales.length - 1) cands = cands.concat(leaderCandidates(req.anchor, half, size, req.gap ?? 3));
      for (const c of cands) {
        const rect = rotatedAabb(c.x, c.y, size.w, size.h, c.angleDeg ?? 0);
        if (!blocked(rect, req.ignoreTags)) { chosen = { c, rect, size, fontPx }; break; }
        if (mandatory) {
          const cc = cost(rect, req.ignoreTags);
          // prefer the larger font at equal cost
          if (!best || cc < best.cost - 1e-9) best = { c, rect, size, fontPx, cost: cc };
        }
      }
    }
    if (!chosen && mandatory && best) chosen = best;
    if (!chosen && mandatory) {
      const size = measureLabel(req.lines, req.fontPx);
      const c = { x: req.anchor.x, y: req.anchor.y, angleDeg: 0 };
      chosen = { c, rect: rotatedAabb(c.x, c.y, size.w, size.h, 0), size, fontPx: req.fontPx };
    }
    if (!chosen) {
      const size = measureLabel(req.lines, req.fontPx);
      result.set(req.id, {
        id: req.id, visible: false, x: req.anchor.x, y: req.anchor.y, angleDeg: 0, w: size.w, h: size.h,
        dx: 0, dy: 0, rect: { x: req.anchor.x, y: req.anchor.y, w: 0, h: 0 }, fontPx: req.fontPx, leader: false
      });
      continue;
    }
    placed.push(chosen.rect);
    result.set(req.id, {
      id: req.id, visible: true, x: chosen.c.x, y: chosen.c.y, angleDeg: chosen.c.angleDeg ?? 0, w: chosen.size.w, h: chosen.size.h,
      dx: chosen.c.x - req.anchor.x, dy: chosen.c.y - req.anchor.y, rect: chosen.rect,
      fontPx: chosen.fontPx, leader: !!chosen.c.leader
    });
  }
  return result;
}

/** Quantise a zoom to a bucket (4 per octave) so label layouts are recomputed only when the scale changes noticeably. */
export function scaleBucket(scale: number): number {
  return Math.round(Math.log2(Math.max(1e-6, scale)) * 4);
}
export const bucketScale = (bucket: number): number => Math.pow(2, bucket / 4);
