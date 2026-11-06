/**
 * Room detection from an imported floor plan: closed polylines on the chosen layers become sprinkler rooms.
 * Rooms are named from the largest TEXT inside the polygon; occupancy and hazard follow NFPA 13-2019 Annex A.4.3.
 * Also exports the polygon helpers shared by head layout and piping (mm units).
 */
import type { BuildingType, FloorPlan, SprinklerRoomInput } from './sprinklerTypes';
import { SPRINKLER_OCCUPANCIES, occupancyFromName } from './nfpa13Sprinkler';

type Poly = [number, number][];

/** Absolute polygon area (shoelace), mm². */
export function polygonArea(p: Poly): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return Math.abs(a) / 2;
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(x: number, y: number, p: Poly): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Area centroid; falls back to the vertex mean for degenerate polygons. */
export function polygonCentroid(p: Poly): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j][0] * p[i][1] - p[i][0] * p[j][1];
    a += f;
    cx += (p[j][0] + p[i][0]) * f;
    cy += (p[j][1] + p[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = Math.max(1, p.length);
    return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Shortest distance from a point to the polygon boundary. */
export function distanceToPolygonEdges(x: number, y: number, p: Poly): number {
  let best = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [x1, y1] = p[j];
    const [x2, y2] = p[i];
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - x1) * dx + (y - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
    if (d < best) best = d;
  }
  return best;
}

export interface RoomDetectionDefaults {
  buildingType: BuildingType;
  ceilingHeightM: number;
  ceilingType: 'finished-flat' | 'exposed-structure';
  minAreaM2?: number;
}

interface Candidate {
  polygon: Poly;
  area: number;
  centroid: [number, number];
}

export function detectRooms(plan: FloorPlan, layers: string[], defaults: RoomDetectionDefaults): SprinklerRoomInput[] {
  const minArea = (defaults.minAreaM2 ?? 2) * 1e6;
  const layerSet = layers.length ? new Set(layers) : null;

  let cands: Candidate[] = [];
  for (const e of plan.entities) {
    if (e.kind !== 'polyline' || !e.closed || e.points.length < 3) continue;
    if (layerSet && !layerSet.has(e.layer)) continue;
    const area = polygonArea(e.points);
    if (area < minArea) continue;
    cands.push({ polygon: e.points, area, centroid: polygonCentroid(e.points) });
  }

  // duplicates: area within 1 % and centroids within 100 mm — keep the first
  const unique: Candidate[] = [];
  for (const c of cands) {
    const dup = unique.some((u) => Math.abs(u.area - c.area) <= 0.01 * Math.max(u.area, c.area) && Math.hypot(u.centroid[0] - c.centroid[0], u.centroid[1] - c.centroid[1]) <= 100);
    if (!dup) unique.push(c);
  }
  // outer outlines: contain the centroid of another candidate with area < 2/3 of their own
  cands = unique.filter((c) => !unique.some((o) => o !== c && o.area < (2 / 3) * c.area && pointInPolygon(o.centroid[0], o.centroid[1], c.polygon)));

  // order: centroid y descending, then x ascending
  cands.sort((a, b) => b.centroid[1] - a.centroid[1] || a.centroid[0] - b.centroid[0]);

  const texts = plan.entities.filter((e) => e.kind === 'text' && (e.text ?? '').trim() !== '');
  return cands.map((c, i) => {
    let name = '';
    let bestH = -Infinity;
    for (const t of texts) {
      const [tx, ty] = t.points[0];
      if (!pointInPolygon(tx, ty, c.polygon)) continue;
      if (cands.some((o) => o !== c && o.area < c.area && pointInPolygon(tx, ty, o.polygon))) continue;
      const h = t.height ?? 0;
      if (h > bestH) {
        bestH = h;
        name = (t.text ?? '').trim();
      }
    }
    if (!name) name = `Room ${i + 1}`;
    const occupancy = occupancyFromName(name, defaults.buildingType);
    return {
      id: `R${i + 1}`,
      name,
      polygon: c.polygon.map(([x, y]) => [x, y] as [number, number]),
      occupancy,
      hazard: SPRINKLER_OCCUPANCIES[occupancy].hazard,
      ceilingHeightM: defaults.ceilingHeightM,
      ceilingType: defaults.ceilingType,
      freezing: false,
      heatSource: occupancy === 'kitchen' || occupancy === 'mechanical',
      omit: false,
      omitReason: ''
    };
  });
}
