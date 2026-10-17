// Greedy, deterministic label collision layout (pure, screen-space px, no React / Konva).
import { uprightAngle } from './drawingGeometry';

export interface Rect { x: number; y: number; w: number; h: number }
/** An obstacle may carry a tag so a label can ignore obstacles that belong to its own symbol (e.g. its duct section). */
export interface Obstacle extends Rect { tag?: string }
export interface LabelCandidate { x: number; y: number; angleDeg?: number }

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
}

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
}

export const LABEL_CHAR_W = 0.6;
export const LABEL_LINE_H = 1.25;
export const LABEL_PAD = 3;

export const measureText = (text: string, fontPx: number): number => text.length * LABEL_CHAR_W * fontPx;

export function measureLabel(lines: string[], fontPx: number): { w: number; h: number } {
  let m = 0;
  for (const l of lines) m = Math.max(m, l.length);
  return { w: m * LABEL_CHAR_W * fontPx + 2 * LABEL_PAD, h: Math.max(1, lines.length) * fontPx * LABEL_LINE_H + 2 };
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
    const size = measureLabel(req.lines, req.fontPx);
    const cands = req.candidates ?? compassCandidates(req.anchor, req.anchorHalf ?? { w: 0, h: 0 }, size, req.gap ?? 3);
    let chosen: { c: LabelCandidate; rect: Rect } | null = null;
    let best: { c: LabelCandidate; rect: Rect; cost: number } | null = null;
    for (const c of cands) {
      const rect = rotatedAabb(c.x, c.y, size.w, size.h, c.angleDeg ?? 0);
      if (!blocked(rect, req.ignoreTags)) { chosen = { c, rect }; break; }
      if (req.mandatory) {
        const cc = cost(rect, req.ignoreTags);
        if (!best || cc < best.cost - 1e-9) best = { c, rect, cost: cc };
      }
    }
    if (!chosen && req.mandatory && best) chosen = best;
    if (!chosen && req.mandatory) {
      const c = { x: req.anchor.x, y: req.anchor.y, angleDeg: 0 };
      chosen = { c, rect: rotatedAabb(c.x, c.y, size.w, size.h, 0) };
    }
    if (!chosen) {
      result.set(req.id, {
        id: req.id, visible: false, x: req.anchor.x, y: req.anchor.y, angleDeg: 0, w: size.w, h: size.h,
        dx: 0, dy: 0, rect: { x: req.anchor.x, y: req.anchor.y, w: 0, h: 0 }
      });
      continue;
    }
    placed.push(chosen.rect);
    result.set(req.id, {
      id: req.id, visible: true, x: chosen.c.x, y: chosen.c.y, angleDeg: chosen.c.angleDeg ?? 0, w: size.w, h: size.h,
      dx: chosen.c.x - req.anchor.x, dy: chosen.c.y - req.anchor.y, rect: chosen.rect
    });
  }
  return result;
}

/** Quantise a zoom to a bucket (4 per octave) so label layouts are recomputed only when the scale changes noticeably. */
export function scaleBucket(scale: number): number {
  return Math.round(Math.log2(Math.max(1e-6, scale)) * 4);
}
export const bucketScale = (bucket: number): number => Math.pow(2, bucket / 4);
