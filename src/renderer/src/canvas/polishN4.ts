// Canvas polish N4 (pure, no React / Konva): callouts kept inside the visible stage, two-pass Fit All padding that reserves
// room for callouts, compact-toolbar rule and the collapsed notice line.
import { fitBounds, type FitPadding } from './drawingGeometry';
import { calloutCandidates } from './shopDrawing';
import type { FitLabel } from './polishM2';
import type { LabelCandidate } from './labelLayout';

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type Pt = { x: number; y: number };

// ───────────────────────── Toolbars / notices ─────────────────────────

/** Canvas width (px) below which the overlay toolbars switch to icon-only secondary buttons. */
export const COMPACT_TOOLBAR_WIDTH = 1200;
export const isCompactToolbar = (canvasWidth: number): boolean => canvasWidth < COMPACT_TOOLBAR_WIDTH;

/**
 * One-line summary of a notice that lists zones: `Heading: First (+n zones)`; all names when expanded.
 */
export function noticeSummary(heading: string, names: string[], expanded: boolean): string {
  if (names.length === 0) return heading;
  if (expanded || names.length === 1) return `${heading}: ${names.join(', ')}`;
  const more = names.length - 1;
  return `${heading}: ${names[0]} (+${more} zone${more === 1 ? '' : 's'})`;
}

// ───────────────────────── Keep callouts inside the stage ─────────────────────────

export { clampCentreIntoRect, clampCandidateToStage } from './labelLayout';

// ───────────────────────── Fit All with callouts ─────────────────────────

export interface CalloutSpec {
  /** World point the leader ends on (unit corner). */
  anchor: Pt;
  /** Room polygon, world px [x0,y0,x1,y1,...]. */
  poly: number[];
  /** Callout box, SCREEN px. */
  size: { w: number; h: number };
}

/**
 * Where a callout will probably sit at `scale`, as a fit label (anchor + screen offset + box). Null when it fits inside its
 * room (no extra room needed). Otherwise the outside candidate that grows the content the least (it usually lands where
 * the drawing already has empty paper). Deterministic and independent of the current view.
 */
export function calloutFitLabel(spec: CalloutSpec, content: Bounds, scale: number, gap = 10): FitLabel | null {
  const poly = spec.poly.map((v) => v * scale);
  const anchor = { x: spec.anchor.x * scale, y: spec.anchor.y * scale };
  const cands = calloutCandidates(spec.size, anchor, poly, gap);
  if (!cands.length) return null;
  // first candidates are the inside-the-room grid when the box is small enough
  const area = Math.abs(polyArea(poly));
  if (spec.size.w * spec.size.h <= 0.2 * area && cands.length > 0) {
    const first = cands[0];
    if (pointInPoly(first.x, first.y, poly)) return null;
  }
  const cr = { x0: content.minX * scale, y0: content.minY * scale, x1: content.maxX * scale, y1: content.maxY * scale };
  let best: { c: LabelCandidate; grow: number } | null = null;
  for (const c of cands) {
    if (pointInPoly(c.x, c.y, poly)) continue;
    const x0 = c.x - spec.size.w / 2, x1 = c.x + spec.size.w / 2, y0 = c.y - spec.size.h / 2, y1 = c.y + spec.size.h / 2;
    const grow = Math.max(0, cr.x0 - x0) + Math.max(0, x1 - cr.x1) + Math.max(0, cr.y0 - y0) + Math.max(0, y1 - cr.y1);
    if (!best || grow < best.grow - 1e-9) best = { c, grow };
  }
  if (!best) return null;
  return { ax: spec.anchor.x, ay: spec.anchor.y, dx: best.c.x - anchor.x, dy: best.c.y - anchor.y, w: spec.size.w, h: spec.size.h };
}

function polyArea(p: number[]): number {
  let a = 0;
  for (let i = 0, n = p.length; i + 1 < n; i += 2) {
    const j = (i + 2) % n;
    a += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return a / 2;
}
function pointInPoly(x: number, y: number, p: number[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 2; i + 1 < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** World bounds of the content grown by label boxes whose screen size is fixed at the given scale. */
export function extendBoundsByLabels(content: Bounds, labels: FitLabel[], scale: number): Bounds {
  const sc = Math.max(1e-6, scale);
  const b = { ...content };
  for (const l of labels) {
    b.minX = Math.min(b.minX, l.ax + (l.dx - l.w / 2) / sc);
    b.maxX = Math.max(b.maxX, l.ax + (l.dx + l.w / 2) / sc);
    b.minY = Math.min(b.minY, l.ay + (l.dy - l.h / 2) / sc);
    b.maxY = Math.max(b.maxY, l.ay + (l.dy + l.h / 2) / sc);
  }
  return b;
}

/**
 * Fit All that reserves room for callouts: compute the target scale of the plain content first, then grow the bounds by the
 * boxes at that scale (screen px converted by the scale), refit; at most `passes` (2) refits. `labelsAt(scale)` returns the
 * boxes for a scale, so the result depends only on content + view size, never on the previous view.
 */
export function twoPassFit(
  content: Bounds,
  labelsAt: (scale: number) => FitLabel[],
  viewW: number,
  viewH: number,
  margin: number,
  pad: FitPadding,
  passes = 2
): { scale: number; x: number; y: number; bounds: Bounds } {
  let f = fitBounds(content, viewW, viewH, margin, pad);
  let b = content;
  for (let i = 0; i < Math.min(2, passes); i++) {
    b = extendBoundsByLabels(content, labelsAt(f.scale), f.scale);
    f = fitBounds(b, viewW, viewH, margin, pad);
  }
  return { ...f, bounds: b };
}
