import type { BoundingBox, DxfEntity, Zone } from '../../store/projectStore';
import type { CadBlockReference } from './semanticTypes';
import { canonicalRing } from './roomRecognition';

/**
 * Drawing origin for far-from-origin drawings (survey / UTM / state-plane coordinates).
 *
 *  I1  every engine coordinate is LOCAL: raw = local + drawingOrigin. The origin lives in the internal Y-down frame, so
 *      DXF X = x + ox and DXF Y = -(y + oy). Z is never localised.
 *  I3  per axis: 0 when the raw bbox already fits within ORIGIN_THRESHOLD drawing units of 0, otherwise the bbox centre
 *      rounded to a power-of-ten step of its span (so components are integers). local = raw - origin is exact when |origin| >= 2x the
 *      local extent (Sterbenz); otherwise it is correctly rounded.
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

/** Largest |local coordinate| the drawing would have with this origin on one axis. */
const extent = (min: number, max: number, origin: number): number => Math.max(Math.abs(min - origin), Math.abs(max - origin));

function resolveAxis(min: number, max: number, current: number): number {
  if (fits(min, max, current)) return current;
  const picked = pickAxis(min, max);
  // A span above ~2 * ORIGIN_THRESHOLD fits no origin; keep the current one when it is no worse than the new pick, so the
  // drawing is not rebased (and evidence cleared) for nothing.
  return extent(min, max, current) <= extent(min, max, picked) ? current : picked;
}

/** Origin for a new import: the current one while the raw bbox localised with it stays within the threshold (per axis) or is no worse than a fresh pick, else a fresh pick. */
export function resolveImportOrigin(rawBbox: BoundingBox, current: DrawingOrigin): DrawingOrigin {
  return { x: resolveAxis(rawBbox.minX, rawBbox.maxX, current.x), y: resolveAxis(rawBbox.minY, rawBbox.maxY, current.y) };
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

const ROOM_ID_PREFIX = 'cad-room:';
const OPENING_ID = /^(cad-opening:[^:]+:)(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;

/**
 * CAD candidate ids embed coordinates (room ring, opening centre). They are re-keyed with the shift so an approved room
 * is still recognised as the same room after a rebase. Ids that do not parse are returned unchanged.
 */
export function translateCandidateId(id: string, dx: number, dy: number): string {
  if (id.startsWith(ROOM_ID_PREFIX)) {
    const pairs = id.slice(ROOM_ID_PREFIX.length).split(';').map((pair) => pair.split(',').map(Number));
    if (pairs.length === 0 || pairs.some((v) => v.length !== 2 || !v.every(Number.isFinite))) return id;
    return ROOM_ID_PREFIX + canonicalRing(pairs.flatMap(([x, y]) => [x + dx, y + dy]));
  }
  const m = OPENING_ID.exec(id);
  if (m) return `${m[1]}${(Number(m[2]) + dx).toFixed(3)},${(Number(m[3]) + dy).toFixed(3)}`;
  return id;
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
  const cp = zone.cadProvenance;
  return {
    ...rest,
    ...(cp ? { cadProvenance: { ...cp, candidateId: translateCandidateId(cp.candidateId, dx, dy),
      ...(cp.approvedOpeningIds ? { approvedOpeningIds: cp.approvedOpeningIds.map((id) => translateCandidateId(id, dx, dy)) } : {}) } } : {}),
    points: flat(zone.points),
    diffusers: zone.diffusers.map(p),
    ducts: zone.ducts.map((d) => ({ ...d, points: flat(d.points) })),
    ...(zone.unitPos ? { unitPos: p(zone.unitPos) } : {}),
    ...(zone.unitPositions ? { unitPositions: zone.unitPositions.map(p) } : {}),
    ...(zone.outdoorUnitPos ? { outdoorUnitPos: p(zone.outdoorUnitPos) } : {}),
    ...(zone.outdoorUnitPositions ? { outdoorUnitPositions: zone.outdoorUnitPositions.map(p) } : {})
  };
}
