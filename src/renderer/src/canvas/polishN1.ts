// Canvas polish N1 (pure, no React / Konva): access-panel rule, missing-drain warning, export bounds with labels.
import { boundsWithLabels, type FitLabel } from './polishM2';
import type { UnitKind } from './drawingGeometry';

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * Access panels (AP) exist only for equipment hidden above a ceiling that needs a service hatch: concealed / ducted /
 * fan-coil and air-handling units. Wall-mounted high-wall units, ceiling cassettes (serviced through the grille) and roof
 * packaged units get none.
 */
export function needsAccessPanel(kind: UnitKind): boolean {
  return kind === 'ducted' || kind === 'ahu';
}

export const NO_DRAIN_TEXT = 'No drain point – condensate routed to exterior wall';

/**
 * Zones that have condensate-producing units (one drain line per indoor unit) but no unit drains to a drain point:
 * every line falls back to the exterior wall. A zone with at least one drain-point line is fine.
 */
export function zonesMissingDrainPoint(
  zones: Array<{ id: string; name?: string; drains: Array<{ toDrain: boolean }> }>
): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  for (const z of zones) {
    if (z.drains.length > 0 && !z.drains.some((d) => d.toDrain)) out.push({ id: z.id, name: z.name || z.id });
  }
  return out;
}

/** Bounds for "Export PNG" without the sheet: drawing content grown to hold every label / callout box at the export scale. */
export function exportContentBounds(content: Bounds, labels: FitLabel[], scaleFor: (b: Bounds) => number): Bounds {
  return boundsWithLabels(content, labels, scaleFor);
}
