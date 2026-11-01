/**
 * subsetDrawing — keep only the given sheets (and the entities inside their frames) of a drawing and shift them so that
 * the first kept sheet starts at x = 0 (used by the "Extinguisher DXF" export).
 */
import { entitiesBBox } from './drawingBuilder';
import type { DrawEntity, Drawing, SheetInfo } from './drawingTypes';

const frameOf = (s: SheetInfo): { x0: number; y0: number; x1: number; y1: number } => ({
  x0: s.originX,
  y0: s.originY,
  x1: s.originX + s.paperWidthMm * s.scale,
  y1: s.originY + s.paperHeightMm * s.scale
});

function shift(e: DrawEntity, dx: number, dy: number): DrawEntity {
  switch (e.kind) {
    case 'line':
      return { ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy };
    case 'polyline':
    case 'solid':
      return { ...e, points: e.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
    case 'circle':
    case 'arc':
      return { ...e, cx: e.cx + dx, cy: e.cy + dy };
    case 'text':
      return { ...e, x: e.x + dx, y: e.y + dy };
  }
}

export function subsetDrawing(drawing: Drawing, sheetNumbers: string[]): Drawing {
  const keep = drawing.sheets.filter((s) => sheetNumbers.includes(s.number));
  if (keep.length === 0) return { title: drawing.title, layers: drawing.layers.map((l) => ({ ...l })), entities: [], sheets: [] };
  const frames = keep.map(frameOf);
  const dx = -Math.min(...keep.map((s) => s.originX));
  const dy = -Math.min(...keep.map((s) => s.originY));
  const entities: DrawEntity[] = [];
  for (const e of drawing.entities) {
    const bb = entitiesBBox([e]);
    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;
    if (frames.some((f) => cx >= f.x0 - 1 && cx <= f.x1 + 1 && cy >= f.y0 - 1 && cy <= f.y1 + 1)) entities.push(shift(e, dx, dy));
  }
  return {
    title: drawing.title,
    layers: drawing.layers.map((l) => ({ ...l })),
    entities,
    sheets: keep.map((s) => ({ ...s, originX: s.originX + dx, originY: s.originY + dy }))
  };
}
