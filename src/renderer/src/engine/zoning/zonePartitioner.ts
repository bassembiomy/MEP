import { calculateSolarLoadWeights, ExteriorWallInfo } from './solarLoadWeighting';
import { distributeLoadsAcrossZones } from './loadDistribution';
import {
  getPolygonScanlineSpan,
  getPolygonVerticalSpan,
  getPolygonBounds,
  clipPolygonToRect,
  isPointInPolygon,
  isPointInsideWithClearance,
  clampPointInsidePolygon,
  getPolygonCentroid,
  UNIT_SERVICE_CLEARANCE_FT
} from '../geometry';

// COORDINATE CONVENTION: canvas/engine Y grows DOWN. north = minY (top), south = maxY (bottom),
// east = maxX, west = minX. Polygons are in feet (the engine boundary converts px -> ft).

export type DesignControlMode = 'ai' | 'user-modified' | 'user-locked';

export interface EquipmentServiceZone {
  id: string;
  unitTag: string;
  designControlMode: DesignControlMode;
  
  equipmentModel: string;
  coolingSource: 'dx' | 'chilled-water' | 'heat-pump' | 'package';
  equipmentType: 'concealed-split' | 'fcu' | 'ahu' | 'rtu' | 'package';
  
  nominalTonnage: number;
  actualCapacityBtu: number;
  
  supplyCfm: number;
  returnCfm: number;
  outdoorAirCfm: number;
  outdoorAirConnectionApproved: boolean;
  
  espInWg: number;
  
  equipmentPosition: {
    x: number;
    y: number;
    rotation: number;
    wallSide: 'north' | 'south' | 'east' | 'west' | 'ceiling';
  };
  
  serviceAreaPolygon: number[];
  /**
   * Full room outline (feet). Ducts must stay inside THIS polygon: a service bay of an L / U room can consist
   * of disconnected pieces that are only joined through a neighbouring bay.
   */
  roomPolygon?: number[];
  occupiedAreaPolygon?: number[];
  
  sensibleLoadBtu: number;
  latentLoadBtu: number;
  totalLoadBtu: number;
  
  targetNc: number;
  targetRc?: number;
  
  maxDuctLengthFt?: number;
  maxAvailableCeilingDepthIn?: number;
  
  pressureBudgetInWg: {
    supplyDuct: number;
    returnDuct: number;
    terminals: number;
    fittings: number;
    totalAvailable: number;
  };
  
  isUserOverridden: boolean;
}

export interface EquipmentServiceZoneInput {
  roomName: string;
  roomPolygon: number[]; // [x1, y1, x2, y2, ...]
  unitCount: number;
  selectedModel: string;
  nominalTonnage: number;
  totalCapacityBtu: number;
  totalSensibleBtu: number;
  totalLatentBtu: number;
  totalSupplyCfm: number;
  totalOutdoorAirCfm: number;
  availableEspInWg: number;
  coolingSource?: 'dx' | 'chilled-water' | 'heat-pump' | 'package';
  equipmentType?: 'concealed-split' | 'fcu' | 'ahu' | 'rtu' | 'package';
  mountingWallSide?: 'north' | 'south' | 'east' | 'west' | 'ceiling';
  targetNc?: number;
  maxAvailableCeilingDepthIn?: number;
  exteriorWalls?: ExteriorWallInfo[];
}

const getPolygonBoundingBox = getPolygonBounds;

// ---------------------------------------------------------------------------
// Ring surgery for non-convex rooms (L / U / T shapes)
// ---------------------------------------------------------------------------
// Clipping a concave room to a slab can yield ONE ring that joins two separate legs through degenerate edges lying
// on the slab boundary (traversed in both directions). Cancelling those opposite, overlapping edges splits the ring
// into its connected components; the same cancellation merges two polygons that share an edge into their union.

interface RingEdge { ax: number; ay: number; bx: number; by: number }
const RING_EPS_FT = 1e-6;

const ringArea = (pts: number[]): number => {
  let s = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += pts[2 * i] * pts[2 * j + 1] - pts[2 * j] * pts[2 * i + 1];
  }
  return s / 2;
};

/** Edges of a ring, oriented to a positive signed area so rings from different sources are comparable. */
function orientedEdges(pts: number[]): RingEdge[] {
  const n = pts.length / 2;
  const rev = ringArea(pts) < 0;
  const idx = Array.from({ length: n }, (_, i) => (rev ? n - 1 - i : i));
  const out: RingEdge[] = [];
  for (let k = 0; k < n; k++) {
    const a = idx[k], b = idx[(k + 1) % n];
    out.push({ ax: pts[2 * a], ay: pts[2 * a + 1], bx: pts[2 * b], by: pts[2 * b + 1] });
  }
  return out.filter((e) => Math.hypot(e.bx - e.ax, e.by - e.ay) > RING_EPS_FT);
}

/** Cancels every overlapping, opposite-direction collinear stretch. Returns true when anything was cancelled. */
function cancelOppositeOverlaps(edges: RingEdge[]): boolean {
  let any = false;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < edges.length && !changed; i++) {
      for (let j = i + 1; j < edges.length && !changed; j++) {
        const a = edges[i], b = edges[j];
        const dx = a.bx - a.ax, dy = a.by - a.ay;
        const len = Math.hypot(dx, dy);
        const ex = b.bx - b.ax, ey = b.by - b.ay;
        if (dx * ex + dy * ey >= 0) continue; // not opposite
        const off1 = Math.abs(dx * (b.ay - a.ay) - dy * (b.ax - a.ax)) / len;
        const off2 = Math.abs(dx * (b.by - a.ay) - dy * (b.bx - a.ax)) / len;
        if (off1 > RING_EPS_FT || off2 > RING_EPS_FT) continue; // not collinear
        const t1 = ((b.ax - a.ax) * dx + (b.ay - a.ay) * dy) / (len * len);
        const t2 = ((b.bx - a.ax) * dx + (b.by - a.ay) * dy) / (len * len);
        const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(1, Math.max(t1, t2));
        if ((hi - lo) * len <= RING_EPS_FT) continue;
        const P = { x: a.ax + lo * dx, y: a.ay + lo * dy };
        const Q = { x: a.ax + hi * dx, y: a.ay + hi * dy };
        const eps = RING_EPS_FT / len;
        const aPieces: RingEdge[] = [];
        if (lo > eps) aPieces.push({ ax: a.ax, ay: a.ay, bx: P.x, by: P.y });
        if (hi < 1 - eps) aPieces.push({ ax: Q.x, ay: Q.y, bx: a.bx, by: a.by });
        // b runs against a: from parameter t1 (> t2) down to t2
        const bPieces: RingEdge[] = [];
        if (t1 > hi + eps) bPieces.push({ ax: b.ax, ay: b.ay, bx: Q.x, by: Q.y });
        if (t2 < lo - eps) bPieces.push({ ax: P.x, ay: P.y, bx: b.bx, by: b.by });
        edges.splice(j, 1);
        edges.splice(i, 1, ...aPieces, ...bPieces);
        changed = true;
        any = true;
      }
    }
  }
  return any;
}

/** Traces closed rings from a balanced directed edge set; collinear vertices are dropped. */
function traceRings(edges: RingEdge[]): number[][] {
  const key = (x: number, y: number): string => `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`;
  const out = new Map<string, number[]>();
  edges.forEach((e, i) => {
    const k = key(e.ax, e.ay);
    const list = out.get(k);
    if (list) list.push(i); else out.set(k, [i]);
  });
  const used = new Array<boolean>(edges.length).fill(false);
  const rings: number[][] = [];
  for (let s = 0; s < edges.length; s++) {
    if (used[s]) continue;
    const pts: Array<{ x: number; y: number }> = [];
    const startKey = key(edges[s].ax, edges[s].ay);
    let cur = s;
    for (let guard = 0; guard <= edges.length; guard++) {
      used[cur] = true;
      const e = edges[cur];
      pts.push({ x: e.ax, y: e.ay });
      const k = key(e.bx, e.by);
      if (k === startKey) break;
      const next = (out.get(k) ?? []).find((idx) => !used[idx]);
      if (next === undefined) break;
      cur = next;
    }
    const clean = pts.filter((p, i) => {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
      return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 1e-9;
    });
    if (clean.length >= 3) rings.push(clean.flatMap((p) => [p.x, p.y]));
  }
  return rings.filter((r) => Math.abs(ringArea(r)) > 1e-4);
}

/**
 * Splits a (possibly self-touching) ring into its connected components. A simple ring is returned unchanged
 * (same vertices, same orientation).
 */
export function splitPolygonComponents(pts: number[]): number[][] {
  if (pts.length < 6) return [pts];
  const edges = orientedEdges(pts);
  if (!cancelOppositeOverlaps(edges)) return [pts];
  const rings = traceRings(edges);
  return rings.length ? rings : [pts];
}

/** Union of two polygons that share boundary: the merged single ring, or null when they only touch / are apart. */
export function mergeAdjacentPolygons(a: number[], b: number[]): number[] | null {
  const edges = [...orientedEdges(a), ...orientedEdges(b)];
  if (!cancelOppositeOverlaps(edges)) return null;
  const rings = traceRings(edges);
  return rings.length === 1 ? rings[0] : null;
}

/** Total length of boundary shared (opposite-direction collinear overlap) by two polygons. */
function sharedBoundaryFt(a: number[], b: number[]): number {
  const ea = orientedEdges(a), eb = orientedEdges(b);
  let total = 0;
  for (const x of ea) {
    const dx = x.bx - x.ax, dy = x.by - x.ay, len = Math.hypot(dx, dy);
    for (const y of eb) {
      if (dx * (y.bx - y.ax) + dy * (y.by - y.ay) >= 0) continue;
      if (Math.abs(dx * (y.ay - x.ay) - dy * (y.ax - x.ax)) / len > RING_EPS_FT) continue;
      if (Math.abs(dx * (y.by - x.ay) - dy * (y.bx - x.ax)) / len > RING_EPS_FT) continue;
      const t1 = ((y.ax - x.ax) * dx + (y.ay - x.ay) * dy) / (len * len);
      const t2 = ((y.bx - x.ax) * dx + (y.by - x.ay) * dy) / (len * len);
      const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(1, Math.max(t1, t2));
      if (hi > lo) total += (hi - lo) * len;
    }
  }
  return total;
}

const polyCentroidDist = (a: number[], b: number[]): number => {
  const ca = getPolygonCentroid(a), cb = getPolygonCentroid(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
};

export function partitionRoomIntoServiceZones(input: EquipmentServiceZoneInput): EquipmentServiceZone[] {
  const {
    roomName: _roomName,
    roomPolygon,
    unitCount,
    selectedModel,
    nominalTonnage,
    totalCapacityBtu,
    totalSensibleBtu,
    totalLatentBtu,
    totalSupplyCfm,
    totalOutdoorAirCfm,
    availableEspInWg,
    coolingSource = 'dx',
    equipmentType = 'concealed-split',
    mountingWallSide = 'east',
    targetNc = 30,
    maxAvailableCeilingDepthIn = 14,
    exteriorWalls = []
  } = input;

  const weights = calculateSolarLoadWeights({ unitCount, exteriorWalls });
  const loadSlices = distributeLoadsAcrossZones({
    totalSensibleBtu,
    totalLatentBtu,
    totalCfm: totalSupplyCfm,
    totalOutdoorAirCfm,
    weights
  });

  const bbox = getPolygonBoundingBox(roomPolygon);
  // one array shared by every zone of this room (the duct routers key per-room layout bookkeeping on it)
  const sharedRoomPolygon = roomPolygon.slice();
  const zones: EquipmentServiceZone[] = [];
  const orphans: number[][] = [];

  // Determine partitioning axis: slice along Y (horizontal bays) or along X (vertical bays)
  const isVerticalSlicing = mountingWallSide === 'north' || mountingWallSide === 'south';

  let currentOffset = isVerticalSlicing ? bbox.minX : bbox.minY;
  const totalSpan = isVerticalSlicing ? bbox.width : bbox.height;

  for (let i = 0; i < unitCount; i++) {
    const slice = loadSlices[i];
    // The last bay always closes exactly on the room boundary (weights may sum to 0.999)
    const rangeEnd = isVerticalSlicing ? bbox.maxX : bbox.maxY;
    const nextOffset = i === unitCount - 1 ? rangeEnd : currentOffset + totalSpan * weights[i];
    const baySpan = nextOffset - currentOffset;

    // Construct the bay as (room polygon) INTERSECT (slab), so bays never leave the room (L/U shapes)
    let bayPoly: number[] = [];
    let equipX = 0;
    let equipY = 0;
    let rotation = 0;
    const clr = UNIT_SERVICE_CLEARANCE_FT;

    const slab = isVerticalSlicing
      ? { minX: currentOffset, maxX: nextOffset, minY: bbox.minY - 1, maxY: bbox.maxY + 1 }
      : { minX: bbox.minX - 1, maxX: bbox.maxX + 1, minY: currentOffset, maxY: nextOffset };
    bayPoly = clipPolygonToRect(roomPolygon, slab);
    if (bayPoly.length < 6) bayPoly = roomPolygon.slice(); // slab falls in a void: degrade to whole room

    if (isVerticalSlicing) {
      const bayMidX = currentOffset + baySpan / 2;
      const span = getPolygonVerticalSpan(bayMidX, roomPolygon) || { minY: bbox.minY, maxY: bbox.maxY };
      equipX = bayMidX;
      // north = minY (top of canvas, y grows down), south = maxY
      equipY = mountingWallSide === 'north' ? span.minY + clr : span.maxY - clr;
      rotation = mountingWallSide === 'north' ? 180 : 0;
    } else {
      // Sliced along Y axis (bays stacked vertically, equipment on east or west wall)
      const bayMidY = currentOffset + baySpan / 2;
      const span = getPolygonScanlineSpan(bayMidY, roomPolygon) || { minX: bbox.minX, maxX: bbox.maxX };
      equipX = mountingWallSide === 'east' ? span.maxX - clr : span.minX + clr;
      equipY = bayMidY;
      rotation = mountingWallSide === 'east' ? 270 : 90;
    }
    // A bay of a non-convex room can be one self-touching ring joining separate legs: keep the connected
    // component that holds the unit; the others are merged into a neighbouring bay that has a unit (below).
    const comps = splitPolygonComponents(bayPoly);
    if (comps.length > 1) {
      const holder = comps.find((c) => isPointInsideWithClearance(equipX, equipY, c, Math.min(clr, 0.5)))
        ?? comps.reduce((best, c) => (Math.abs(ringArea(c)) > Math.abs(ringArea(best)) ? c : best));
      for (const c of comps) if (c !== holder) orphans.push(c);
      bayPoly = holder;
    }
    // Equipment must be inside its own bay (concave rooms): pull it in if the scanline hit a void
    if (!isPointInsideWithClearance(equipX, equipY, bayPoly, Math.min(clr, 0.5)) ) {
      const c = clampPointInsidePolygon(equipX, equipY, bayPoly, clr);
      equipX = isPointInPolygon(c.x, c.y, bayPoly) ? c.x : getPolygonCentroid(bayPoly).x;
      equipY = isPointInPolygon(c.x, c.y, bayPoly) ? c.y : getPolygonCentroid(bayPoly).y;
    }

    currentOffset = nextOffset;

    // Upfront static pressure budget calculation
    const terminalBudget = 0.05;
    const returnBudget = 0.06;
    const fittingBudget = parseFloat((availableEspInWg * 0.20).toFixed(3));
    const supplyDuctBudget = parseFloat((availableEspInWg - terminalBudget - returnBudget - fittingBudget).toFixed(3));

    zones.push({
      id: `sz-${i + 1}`,
      unitTag: `FCU-0${i + 1}`,
      designControlMode: 'ai',
      equipmentModel: selectedModel,
      coolingSource,
      equipmentType,
      nominalTonnage: parseFloat((nominalTonnage / unitCount).toFixed(1)),
      actualCapacityBtu: Math.round(totalCapacityBtu / unitCount),
      supplyCfm: slice.supplyCfm,
      returnCfm: slice.returnCfm,
      outdoorAirCfm: slice.outdoorAirCfm,
      outdoorAirConnectionApproved: true,
      espInWg: availableEspInWg,
      equipmentPosition: {
        x: parseFloat(equipX.toFixed(2)),
        y: parseFloat(equipY.toFixed(2)),
        rotation,
        wallSide: mountingWallSide
      },
      serviceAreaPolygon: bayPoly,
      roomPolygon: sharedRoomPolygon,
      sensibleLoadBtu: slice.sensibleBtu,
      latentLoadBtu: slice.latentBtu,
      totalLoadBtu: slice.totalBtu,
      targetNc,
      maxAvailableCeilingDepthIn,
      pressureBudgetInWg: {
        supplyDuct: Math.max(0.05, supplyDuctBudget),
        returnDuct: returnBudget,
        terminals: terminalBudget,
        fittings: fittingBudget,
        totalAvailable: availableEspInWg
      },
      isUserOverridden: false
    });
  }

  // Components without a unit join the neighbouring bay (which has a unit) they share the most boundary with;
  // the unit count never changes and the merged service area stays inside the room.
  let pending = orphans;
  while (pending.length) {
    const left: number[][] = [];
    for (const orphan of pending) {
      let best: { zone: EquipmentServiceZone; shared: number } | null = null;
      for (const z of zones) {
        const shared = sharedBoundaryFt(orphan, z.serviceAreaPolygon);
        if (shared > 0.5 && (!best || shared > best.shared + 1e-9)) best = { zone: z, shared };
      }
      const merged = best ? mergeAdjacentPolygons(best.zone.serviceAreaPolygon, orphan) : null;
      if (best && merged) best.zone.serviceAreaPolygon = merged;
      else left.push(orphan);
    }
    if (left.length === pending.length) {
      // only touching / detached: nearest bay by centroid distance, if it can still be merged cleanly
      for (const orphan of left) {
        const nearest = zones.reduce((b, z) => (polyCentroidDist(orphan, z.serviceAreaPolygon) < polyCentroidDist(orphan, b.serviceAreaPolygon) ? z : b), zones[0]);
        const merged = nearest ? mergeAdjacentPolygons(nearest.serviceAreaPolygon, orphan) : null;
        if (nearest && merged) nearest.serviceAreaPolygon = merged;
      }
      break;
    }
    pending = left;
  }

  return zones;
}

/** Signed-area magnitude of a flat polygon ring (ft2). */
export function polygonAreaFt2(pts: number[]): number {
  return Math.abs(ringArea(pts));
}

/**
 * Service zones for an explicit list of bays (one indoor unit per bay), e.g. the convex legs of an L / T / U room for
 * wall-mounted units. The shared per-zone data (ids, tags, pressure budgets) comes from the regular partitioner; the bay
 * outline replaces the strip and the airflow / load slices follow the bay AREA share (exact sums). The unit position
 * starts at the bay centroid (wall units are snapped onto a wall of their own bay afterwards).
 */
export function partitionRoomIntoBays(input: EquipmentServiceZoneInput, bays: number[][]): EquipmentServiceZone[] {
  const n = bays.length;
  const zones = partitionRoomIntoServiceZones({ ...input, unitCount: n });
  const areas = bays.map((b) => polygonAreaFt2(b));
  const slices = distributeLoadsAcrossZones({
    totalSensibleBtu: input.totalSensibleBtu,
    totalLatentBtu: input.totalLatentBtu,
    totalCfm: input.totalSupplyCfm,
    totalOutdoorAirCfm: input.totalOutdoorAirCfm,
    weights: areas
  });
  return zones.slice(0, n).map((z, i) => {
    const c = getPolygonCentroid(bays[i]);
    return {
      ...z,
      serviceAreaPolygon: bays[i].slice(),
      supplyCfm: slices[i].supplyCfm,
      returnCfm: slices[i].returnCfm,
      outdoorAirCfm: slices[i].outdoorAirCfm,
      sensibleLoadBtu: slices[i].sensibleBtu,
      latentLoadBtu: slices[i].latentBtu,
      totalLoadBtu: slices[i].totalBtu,
      equipmentPosition: { ...z.equipmentPosition, x: parseFloat(c.x.toFixed(2)), y: parseFloat(c.y.toFixed(2)) }
    };
  });
}
