// Canvas polish M2 (pure, no React / Konva): layer budget, fit bounds including labels, refrigerant bubble spots,
// section-view label staggering and unit tags.
import { pointAlong } from './polishL2';

type Pt = { x: number; y: number };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** Konva warns when a stage holds more than this many layers. */
export const MAX_KONVA_LAYERS = 5;
/** Layers the floor plan stage actually uses: underlay, zone fills, equipment, sheet, overlay (cursor + drain points). */
export const FLOOR_PLAN_LAYER_COUNT = 5;

/** Condensate drain pipe tag (the plain "CD" is the ceiling diffuser). */
export const CONDENSATE_TAG = 'CDP';
export const CONDENSATE_LEGEND = 'CDP – CONDENSATE DRAIN PIPE';

/** A label / callout box: world anchor plus its screen-pixel offset (dx, dy = centre relative to the anchor) and size. */
export interface FitLabel { ax: number; ay: number; dx: number; dy: number; w: number; h: number }

/**
 * Content bounds extended by label / callout boxes. Label boxes are constant in screen px, so the world extent depends on
 * the final scale: refit a few times (`scaleFor` returns the scale a fit of the bounds would give).
 */
export function boundsWithLabels(content: Bounds, labels: FitLabel[], scaleFor: (b: Bounds) => number, iterations = 12): Bounds {
  let b = { ...content };
  if (!labels.length) return b;
  for (let it = 0; it < iterations; it++) {
    const sc = Math.max(1e-6, scaleFor(b));
    const nb = { ...content };
    for (const l of labels) {
      nb.minX = Math.min(nb.minX, l.ax + (l.dx - l.w / 2) / sc);
      nb.maxX = Math.max(nb.maxX, l.ax + (l.dx + l.w / 2) / sc);
      nb.minY = Math.min(nb.minY, l.ay + (l.dy - l.h / 2) / sc);
      nb.maxY = Math.max(nb.maxY, l.ay + (l.dy + l.h / 2) / sc);
    }
    b = nb;
  }
  return b;
}

/**
 * Candidate spots (world px, best first) for a P / R bubble along a pipe polyline, at least `minClearFt` outside both
 * end-unit footprints (rects centred on the first / last point). `prefer` picks which end the bubble stays closest to.
 */
export function pipeBubbleSpots(
  pts: number[],
  startRect: { w: number; d: number } | null,
  endRect: { w: number; d: number } | null,
  k: number,
  prefer: 'start' | 'end',
  minClearFt = 1.5,
  radius = 0.4 * k
): Pt[] {
  let total = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) total += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  if (total < 1e-6) return [];
  const s = { x: pts[0], y: pts[1] }, e = { x: pts[pts.length - 2], y: pts[pts.length - 1] };
  const clr = minClearFt * k + radius;
  const outside = (q: Pt, c: Pt, r: { w: number; d: number } | null): boolean =>
    !r || Math.abs(q.x - c.x) >= r.w / 2 + clr || Math.abs(q.y - c.y) >= r.d / 2 + clr;
  const step = Math.max(0.25 * k, 1e-3);
  const out: Array<{ d: number; p: Pt }> = [];
  for (let d = 0; d <= total + 1e-9; d += step) {
    const q = pointAlong(pts, d);
    if (outside(q, s, startRect) && outside(q, e, endRect)) out.push({ d, p: { x: q.x, y: q.y } });
  }
  out.sort((a, b) => (prefer === 'start' ? a.d - b.d : b.d - a.d));
  return out.map((o) => o.p);
}

// ───────────────────────── Section view ─────────────────────────

export interface StaggerInput {
  id: string; x: number; y: number; w: number;
  /** Baseline just under the element: when given, lifted labels alternate between above (y) and below (yBelow). */
  yBelow?: number;
}
export interface StaggerOutput { id: string; x: number; y: number; level: number; leader: boolean; side: 'above' | 'below' }

/**
 * Collision avoidance for labels beside their element: each label keeps its x and is moved in `lineH + gap` steps until its
 * box (w x lineH, baseline at y) overlaps none already placed. Slots run: base, then alternately below (when `yBelow` is
 * given) and further above, so a crowded unit end spreads on both sides. Moved labels get a leader to the element.
 */
export function staggerLabels(items: StaggerInput[], lineH = 11, gap = 2, maxLevels = 8): StaggerOutput[] {
  const placed: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  const out = new Map<string, StaggerOutput>();
  const order = items.slice().sort((a, b) => a.x - b.x || a.y - b.y || (a.id < b.id ? -1 : 1));
  const step = lineH + gap;
  for (const it of order) {
    // slot list: [side, step index]
    const slots: Array<['above' | 'below', number]> = [['above', 0]];
    for (let n = 1; slots.length <= maxLevels; n++) {
      if (it.yBelow !== undefined) slots.push(['below', n - 1]);
      slots.push(['above', n]);
    }
    let level = 0;
    for (; level < slots.length && level <= maxLevels; level++) {
      const [side, n] = slots[level];
      const y = side === 'above' ? it.y - n * step : (it.yBelow as number) + n * step;
      const r = { x0: it.x - it.w / 2 - gap, x1: it.x + it.w / 2 + gap, y0: y - lineH, y1: y };
      if (!placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0)) {
        placed.push(r);
        out.set(it.id, { id: it.id, x: it.x, y, level, leader: level > 0, side });
        break;
      }
    }
    if (!out.has(it.id)) {
      const y = it.y - maxLevels * step;
      out.set(it.id, { id: it.id, x: it.x, y, level: maxLevels, leader: true, side: 'above' });
    }
  }
  return items.map((i) => out.get(i.id) as StaggerOutput);
}

/** Unit tag of the i-th unit (0-based): `zone.unitTags[i]` when present, else FCU-01.. */
export function unitTagFor(zone: { unitTags?: string[] }, index: number): string {
  const t = zone.unitTags?.[index];
  return t && t.trim() ? t : `FCU-${String(index + 1).padStart(2, '0')}`;
}

/** Unit index for a section's unit id: position in the zone's service zones, else the number in "unit-N". */
export function unitIndexOfId(zone: { unitServiceZones?: Array<{ id: string }> }, unitId: string | undefined): number {
  if (!unitId) return 0;
  const i = zone.unitServiceZones?.findIndex((u) => u.id === unitId) ?? -1;
  if (i >= 0) return i;
  const m = /(\d+)\s*$/.exec(unitId);
  return m ? Math.max(0, parseInt(m[1], 10) - 1) : 0;
}

/** Section tab text: section letter + kind + unit tag, never the raw zone / unit id. */
export function sectionTabLabel(
  zone: { unitTags?: string[]; unitServiceZones?: Array<{ id: string }> },
  s: { label: string; kind: string; unitId?: string }
): string {
  if (s.kind === 'transverse') return `${s.label} Transverse`;
  return `${s.label} Trunk ${unitTagFor(zone, unitIndexOfId(zone, s.unitId))}`;
}
