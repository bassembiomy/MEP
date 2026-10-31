/**
 * Format-neutral 2D drawing model. One model → two serializers:
 *   - dxfWriter.ts  : AutoCAD R12 (AC1009) ASCII DXF, millimetre model space
 *   - svgRenderer.ts: SVG preview used in the application (what you see = what is exported)
 *
 * Coordinates: model space millimetres, +x right, +y up (CAD convention).
 * Text strings may contain AutoCAD control codes %%c (Ø), %%d (°), %%p (±).
 */

export type Linetype = 'CONTINUOUS' | 'DASHED' | 'HIDDEN' | 'CENTER' | 'PHANTOM';

export interface LayerDef {
  name: string;
  /** AutoCAD Color Index 1..255 (1 red, 2 yellow, 3 green, 4 cyan, 5 blue, 6 magenta, 7 white/black, 8 grey). */
  color: number;
  linetype: Linetype;
  /** Plotted lineweight in mm (0.13, 0.18, 0.25, 0.35, 0.50, 0.70) — used by the SVG preview. */
  lineweightMm: number;
  description: string;
}

export type TextAlign = 'left' | 'center' | 'right';
export type TextVAlign = 'baseline' | 'bottom' | 'middle' | 'top';

export type DrawEntity =
  | { kind: 'line'; layer: string; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'polyline'; layer: string; points: [number, number][]; closed: boolean }
  | { kind: 'circle'; layer: string; cx: number; cy: number; r: number }
  /** Arc drawn counter-clockwise from startDeg to endDeg (DXF convention). */
  | { kind: 'arc'; layer: string; cx: number; cy: number; r: number; startDeg: number; endDeg: number }
  | {
      kind: 'text';
      layer: string;
      x: number;
      y: number;
      height: number;
      text: string;
      rotationDeg: number;
      align: TextAlign;
      vAlign: TextVAlign;
    }
  /** Filled triangle / quadrilateral (arrowheads, filled symbols). 3 or 4 points, in drawing order. */
  | { kind: 'solid'; layer: string; points: [number, number][] };

export interface SheetInfo {
  number: string; // FP-101
  title: string;
  /** Drawing scale denominator (50 → 1:50). Paper sizes below are in paper mm. */
  scale: number;
  paper: 'A1' | 'A2' | 'A3';
  paperWidthMm: number;
  paperHeightMm: number;
  /** Lower-left corner of the sheet frame in model space (mm). */
  originX: number;
  originY: number;
}

export interface Drawing {
  title: string;
  layers: LayerDef[];
  entities: DrawEntity[];
  sheets: SheetInfo[];
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
