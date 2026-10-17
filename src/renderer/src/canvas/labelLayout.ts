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
  /** Minimum empty gap (px) kept between this label and every other placed label (small bubbles use it so they never touch). */
  spacing?: number;
  /** Callouts: every candidate is shifted into the stage rect (see `layoutLabels` opts.stage); a shifted one gets a leader. */
  keepInside?: boolean;
}

/** Font scales tried (in order) by a `guaranteed` label. */
/**
 * Shift a rect (w x h centred on cx, cy) into `stage` with `margin` px to spare. A rect larger than the stage is aligned to
 * the top-left. `moved` is true when it had to be shifted by more than 0.5 px (the caller then draws a leader).
 */
export function clampCentreIntoRect(
  cx: number, cy: number, w: number, h: number, stage: Rect, margin = 4
): { x: number; y: number; moved: boolean } {
  const lo = (v: number, size: number, start: number, len: number): number => {
    const min = start + margin + size / 2, max = start + len - margin - size / 2;
    return max < min ? start + margin + size / 2 : Math.min(max, Math.max(min, v));
  };
  const x = lo(cx, w, stage.x, stage.w), y = lo(cy, h, stage.y, stage.h);
  return { x, y, moved: Math.abs(x - cx) > 0.5 || Math.abs(y - cy) > 0.5 };
}

/** Candidate (unrotated label) shifted into the stage; moved candidates are tied to the symbol by a leader line. */
export function clampCandidateToStage(c: LabelCandidate, size: { w: number; h: number }, stage: Rect, margin = 4): LabelCandidate {
  const r = clampCentreIntoRect(c.x, c.y, size.w, size.h, stage, margin);
  return r.moved ? { ...c, x: r.x, y: r.y, leader: true } : c;
}

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
  opts: { margin?: number; stage?: Rect; stageMargin?: number } = {}
): Map<string, PlacedLabel> {
  const margin = opts.margin ?? 1;
  const result = new Map<string, PlacedLabel>();
  const placed: Array<{ rect: Rect; sp: number }> = [];
  const sorted = requests
    .slice()
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const blocked = (r: Rect, ign?: string[], sp = 0): boolean => {
    for (const o of obstacles) if (!(ign && o.tag && ign.includes(o.tag)) && rectsOverlap(r, o, margin)) return true;
    for (const p of placed) if (rectsOverlap(r, p.rect, Math.max(margin, sp, p.sp))) return true;
    return false;
  };
  const cost = (r: Rect, ign?: string[], sp = 0): number => {
    let c = 0;
    for (const o of obstacles) if (!(ign && o.tag && ign.includes(o.tag))) c += overlapArea(r, o);
    for (const p of placed) {
      const m = Math.max(sp, p.sp);
      c += overlapArea(r, m > 0 ? { x: p.rect.x - m, y: p.rect.y - m, w: p.rect.w + 2 * m, h: p.rect.h + 2 * m } : p.rect);
    }
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
      for (const c0 of cands) {
        const c = req.keepInside && opts.stage ? clampCandidateToStage(c0, size, opts.stage, opts.stageMargin ?? 4) : c0;
        const rect = rotatedAabb(c.x, c.y, size.w, size.h, c.angleDeg ?? 0);
        if (!blocked(rect, req.ignoreTags, req.spacing ?? 0)) { chosen = { c, rect, size, fontPx }; break; }
        if (mandatory) {
          const cc = cost(rect, req.ignoreTags, req.spacing ?? 0);
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
    placed.push({ rect: chosen.rect, sp: req.spacing ?? 0 });
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

// ───────────────────────── Leader routing ─────────────────────────

/** Segment (x1,y1)-(x2,y2) against an axis-aligned rect (Liang-Barsky); touching an edge does not count when `inset` > 0. */
export function segmentHitsRect(x1: number, y1: number, x2: number, y2: number, r: Rect, inset = 0): boolean {
  const rx0 = r.x + inset, rx1 = r.x + r.w - inset, ry0 = r.y + inset, ry1 = r.y + r.h - inset;
  if (rx1 <= rx0 || ry1 <= ry0) return false;
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy], q = [x1 - rx0, rx1 - x1, y1 - ry0, ry1 - y1];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) { if (q[i] < 0) return false; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}

export function polylineHitsRect(pts: number[], r: Rect, inset = 0): boolean {
  for (let i = 0; i + 3 < pts.length; i += 2) if (segmentHitsRect(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], r, inset)) return true;
  return false;
}

/** Drop the part of a polyline that lies inside `r` at its start (so the leader starts on the label's edge). */
function trimStartInside(pts: number[], r: Rect): number[] {
  const inside = (x: number, y: number): boolean => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
  let out = pts.slice();
  while (out.length >= 4 && inside(out[0], out[1])) {
    if (inside(out[2], out[3]) && out.length > 4) { out = out.slice(2); continue; }
    // exit point of the first segment
    const [x1, y1, x2, y2] = out;
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (inside(x1 + (x2 - x1) * m, y1 + (y2 - y1) * m)) lo = m; else hi = m;
    }
    out = [x1 + (x2 - x1) * hi, y1 + (y2 - y1) * hi, ...out.slice(2)];
    break;
  }
  return out;
}

export interface LeaderRoute { points: number[]; symbolHits: number; labelHits: number }

/**
 * Leader from a label box to its target point: the straight line or one of the two one-elbow orthogonal polylines
 * (horizontal-then-vertical, vertical-then-horizontal), whichever intersects no symbol box and the fewest other labels.
 * Ties prefer straight, then the shorter path. `symbols` boxes are shrunk by `inset` so reaching the target on a symbol's own
 * boundary is not a crossing. Pure; any consistent coordinate space.
 */
export function routeLeader(label: Rect, target: { x: number; y: number }, symbols: Rect[], labels: Rect[] = [], inset = 0.75): LeaderRoute {
  const cx = label.x + label.w / 2, cy = label.y + label.h / 2;
  const straight = [cx, cy, target.x, target.y];
  const cands: Array<{ pts: number[]; elbow: boolean }> = [
    { pts: straight, elbow: false },
    { pts: [cx, cy, target.x, cy, target.x, target.y], elbow: true },
    { pts: [cx, cy, cx, target.y, target.x, target.y], elbow: true }
  ];
  let best: (LeaderRoute & { score: number }) | null = null;
  for (const c of cands) {
    const pts = trimStartInside(c.pts, label);
    if (pts.length < 4) continue;
    let symbolHits = 0, labelHits = 0, len = 0;
    for (const r of symbols) if (polylineHitsRect(pts, r, inset)) symbolHits++;
    for (const r of labels) if (polylineHitsRect(pts, r, 0)) labelHits++;
    for (let i = 0; i + 3 < pts.length; i += 2) len += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
    const score = symbolHits * 1e6 + labelHits * 1e3 + (c.elbow ? 1 : 0) + len * 1e-3;
    if (!best || score < best.score - 1e-9) best = { points: pts, symbolHits, labelHits, score };
  }
  return best ? { points: best.points, symbolHits: best.symbolHits, labelHits: best.labelHits } : { points: straight, symbolHits: 0, labelHits: 0 };
}
