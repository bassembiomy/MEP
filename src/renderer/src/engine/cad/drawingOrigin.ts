import type { BoundingBox, DxfEntity, Zone } from '../../store/projectStore';
import type { CadBlockReference } from './semanticTypes';

/**
 * Drawing origin for far-from-origin drawings (survey / UTM / state-plane coordinates).
 *
 *  I1  every engine coordinate is LOCAL: raw = local + drawingOrigin. The origin lives in the internal Y-down frame, so
 *      DXF X = x + ox and DXF Y = -(y + oy). Z is never localised.
 *  I3  per axis: 0 when the raw bbox already fits within ORIGIN_THRESHOLD drawing units of 0, otherwise the bbox centre
 *      rounded to a power-of-ten step of its span (so components are exact integers and local = raw - origin is exact).
 *      The threshold is absolute (drawing units), not relative to the span.
 *  I4  parsers return RAW coordinates; only the store's setDxfData localises them.
 */
export const ORIGIN_THRESHOLD = 1e5;

export interface DrawingOrigin { x: number; y: number }

const fits = (min: number, max: number, origin: number): boolean =>
  Math.abs(min - origin) <= ORIGIN_THRESHOLD && Math.abs(max - origin) <= ORIGIN_THRESHOLD;

function pickAxis(min: number, max: number): number {
  if (fits(min, max, 0)) return 0;
  const span = max - min, step = 10 ** Math.floor(Math.log10(Math.max(span, 1)));
  return Math.round((min + max) / 2 / step) * step + 0; // + 0 turns -0 into 0
}

export function pickDrawingOrigin(bbox: BoundingBox): DrawingOrigin {
  return { x: pickAxis(bbox.minX, bbox.maxX), y: pickAxis(bbox.minY, bbox.maxY) };
}

/** Origin for a new import: the current one while the raw bbox localised with it stays within the threshold (per axis), else a fresh pick. */
export function resolveImportOrigin(rawBbox: BoundingBox, current: DrawingOrigin): DrawingOrigin {
  const picked = pickDrawingOrigin(rawBbox);
  return {
    x: fits(rawBbox.minX, rawBbox.maxX, current.x) ? current.x : picked.x,
    y: fits(rawBbox.minY, rawBbox.maxY, current.y) ? current.y : picked.y
  };
}

/** Moves the point coordinates only (x, y, points). Vectors (ELLIPSE axes), angles, radii and elevation are untouched. */
export function translateEntity(ent: DxfEntity, dx: number, dy: number): DxfEntity {
  const result: DxfEntity = { ...ent };
  if (ent.x !== undefined) result.x = ent.x + dx;
  if (ent.y !== undefined) result.y = ent.y + dy;
  if (ent.points) result.points = ent.points.map((v, i) => v + (i % 2 ? dy : dx));
  return result;
}

const moveBox = (b: BoundingBox, dx: number, dy: number): BoundingBox => ({ minX: b.minX + dx, maxX: b.maxX + dx, minY: b.minY + dy, maxY: b.maxY + dy });

/** Translates a parsed drawing. entityRange is an index range and is unchanged. A zero shift returns the inputs untouched. */
export function translateDrawing(
  drawing: { entities: DxfEntity[]; bbox: BoundingBox; blockReferences: CadBlockReference[] },
  dx: number, dy: number
): { entities: DxfEntity[]; bbox: BoundingBox; blockReferences: CadBlockReference[] } {
  if (dx === 0 && dy === 0) return drawing;
  return {
    entities: drawing.entities.map((e) => translateEntity(e, dx, dy)),
    bbox: moveBox(drawing.bbox, dx, dy),
    blockReferences: drawing.blockReferences.map((r) => ({
      ...r, insertion: { x: r.insertion.x + dx, y: r.insertion.y + dy }, bounds: moveBox(r.bounds, dx, dy)
    }))
  };
}

/**
 * Translates every coordinate a room owns. `obstacles` is dropped: it is derived from the approved CAD obstacles and
 * the store re-syncs it after the rebase.
 */
export function translateZone(zone: Zone, dx: number, dy: number): Zone {
  const p = <T extends { x: number; y: number }>(q: T): T => ({ ...q, x: q.x + dx, y: q.y + dy });
  const flat = (v: number[]): number[] => v.map((c, i) => c + (i % 2 ? dy : dx));
  const { obstacles: _derived, ...rest } = zone;
  void _derived;
  return {
    ...rest,
    points: flat(zone.points),
    diffusers: zone.diffusers.map(p),
    ducts: zone.ducts.map((d) => ({ ...d, points: flat(d.points) })),
    ...(zone.unitPos ? { unitPos: p(zone.unitPos) } : {}),
    ...(zone.unitPositions ? { unitPositions: zone.unitPositions.map(p) } : {}),
    ...(zone.outdoorUnitPos ? { outdoorUnitPos: p(zone.outdoorUnitPos) } : {}),
    ...(zone.outdoorUnitPositions ? { outdoorUnitPositions: zone.outdoorUnitPositions.map(p) } : {})
  };
}
