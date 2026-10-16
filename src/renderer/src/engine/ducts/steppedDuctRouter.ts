import { EquipmentServiceZone, DesignControlMode } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { ASHRAE_PROFILE, StandardsProfile } from '../standards/designStandards';
import { buildOrthogonalTree, pickAxis, returnStubCandidates, Seg2, TopoSegment, TopoTerminal } from './orthogonalTopology';
import { sizeDuctNetwork } from './aerodynamicDuctSizer';

export interface SteppedDuctSection {
  id: string;
  unitId: string;
  designControlMode: DesignControlMode;
  systemType: 'supply' | 'return' | 'outdoor-air';
  role: 'main-trunk' | 'branch' | 'runout';
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  airflowCfm: number;
  shape: 'rectangular' | 'round';
  widthIn: number;
  heightIn: number;
  diameterIn?: number;
  velocityFpm: number;
  allowableVelocityFpm: number;
  frictionLossPer100Ft: number;
  fittingLossInWg: number;
  totalSectionLossInWg: number;
  ncRating: number;
  /** Number of terminals served downstream of (and including) this section */
  connectedDiffuserCount: number;
  /** Ids of all terminals served downstream of (and including) this section */
  connectedDiffusers: string[];
  parentDuctId?: string;
  childDuctIds: string[];
  /** Terminals connected at this section's END node (flow = direct terminals + sum of child sections) */
  directDiffusers?: string[];
  /** Junction fitting at this section's START (derived from routed geometry) */
  junctionKind?: 'none' | 'tee-branch' | 'elbow' | 'transition';
  /** true when friction / velocity / aspect / depth criteria were all met by the selected size */
  meetsDesignCriteria?: boolean;
  designWarnings?: string[];
}

/** Lateral offset (ft) between the supply trunk line and the return trunk line / unit return collar. */
export const RETURN_COLLAR_OFFSET_FT = 3;
/** Terminals within this distance (ft) of the trunk centreline connect on the trunk itself. */
const ON_LINE_TOL_FT = 0.5;
/** Takeoff stations closer than this (ft) are merged. */
const STATION_SNAP_FT = 0.1;
/** Minimum trunk piece length (ft) when a terminal sits exactly over the unit. */
const MIN_PIECE_FT = 1.0;

function bboxOf(points: number[]): { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

const r2 = (n: number): number => parseFloat(n.toFixed(2));

/** The unit's own service bay is the preferred routing area; the full room outline is the fallback. */
export function zoneRoutingPolygons(zone: EquipmentServiceZone): { bayPoly?: number[]; roomPoly?: number[] } {
  const bay = zone.serviceAreaPolygon && zone.serviceAreaPolygon.length >= 6 ? zone.serviceAreaPolygon : undefined;
  const room = zone.roomPolygon && zone.roomPolygon.length >= 6 ? zone.roomPolygon : bay;
  return { bayPoly: bay, roomPoly: room };
}

/**
 * Layouts most recently routed per zone. Zones of one room share the same `roomPolygon` array, so routing a zone can
 * keep clear of the supply / return segments of its neighbours, and the return router can keep clear of the supply
 * network routed just before it (the engine routes supply then return per zone object).
 */
interface ZoneLayout { supply: Seg2[]; ret: Seg2[] }
const roomLayouts = new WeakMap<object, Map<string, ZoneLayout>>();
function layoutOf(zone: EquipmentServiceZone): ZoneLayout | undefined {
  const key = zone.roomPolygon;
  if (!key) return undefined;
  let m = roomLayouts.get(key);
  if (!m) roomLayouts.set(key, (m = new Map()));
  let l = m.get(zone.id);
  if (!l) m.set(zone.id, (l = { supply: [], ret: [] }));
  return l;
}
export function rememberZoneLayout(zone: EquipmentServiceZone, kind: 'supply' | 'ret', segs: Seg2[]): void {
  const l = layoutOf(zone);
  if (l) l[kind] = segs.map((g) => ({ start: { ...g.start }, end: { ...g.end } }));
}
/** Segments already routed for this zone's supply network and for the neighbouring zones of the same room. */
export function avoidLayoutsFor(zone: EquipmentServiceZone, includeOwnSupply: boolean): Seg2[] {
  const key = zone.roomPolygon;
  const m = key ? roomLayouts.get(key) : undefined;
  if (!m) return [];
  const out: Seg2[] = [];
  for (const [id, l] of m) {
    if (id === zone.id) {
      if (includeOwnSupply) out.push(...l.supply);
    } else out.push(...l.supply, ...l.ret);
  }
  return out;
}

export interface RouteTreeOptions {
  systemType: 'supply' | 'return';
  idPrefix: string;
  /** Trunk start (the unit discharge / return collar) */
  root: { x: number; y: number };
  axis: 'h' | 'v';
  /** Optional upstream section (e.g. return collar stub) that all roots hang from */
  rootParentId?: string;
  /** Section index to start numbering from */
  startIndex?: number;
}

/**
 * Converts the orthogonal topology into stepped duct sections with provisional (unsized) data.
 */
export function topologyToSections(
  zone: EquipmentServiceZone,
  segs: TopoSegment[],
  opts: RouteTreeOptions
): SteppedDuctSection[] {
  const base = opts.startIndex ?? 1;
  const idOf = (i: number): string => `${opts.idPrefix}-${zone.unitTag}-${base + i}`;
  const sections: SteppedDuctSection[] = segs.map((g, i) => ({
    id: idOf(i),
    unitId: zone.id,
    designControlMode: 'ai',
    systemType: opts.systemType,
    role: g.kind === 'trunk' ? 'main-trunk' : g.kind,
    startPoint: { x: r2(g.start.x), y: r2(g.start.y) },
    endPoint: { x: r2(g.end.x), y: r2(g.end.y) },
    airflowCfm: g.flow,
    shape: 'rectangular',
    widthIn: 0,
    heightIn: 0,
    velocityFpm: 0,
    allowableVelocityFpm: 0,
    frictionLossPer100Ft: 0,
    fittingLossInWg: 0,
    totalSectionLossInWg: 0,
    ncRating: zone.targetNc || 30,
    connectedDiffuserCount: g.downstream.length,
    connectedDiffusers: g.downstream,
    directDiffusers: g.direct,
    parentDuctId: g.parent >= 0 ? idOf(g.parent) : opts.rootParentId,
    childDuctIds: []
  }));
  for (const s of sections) {
    if (s.parentDuctId) {
      const p = sections.find((x) => x.id === s.parentDuctId);
      if (p) p.childDuctIds.push(s.id);
    }
  }
  return sections;
}

/**
 * Orthogonal stepped supply network:
 *  - trunk runs along the dominant axis of the service area through the unit, one trunk per side of the unit,
 *    each ordered by distance from the unit (no zig-zag), ending at the last takeoff;
 *  - each terminal is reached by a straight perpendicular branch off the trunk;
 *  - the flow in each section equals the sum of everything downstream (conservation at every node);
 *  - sizes come from the friction + acoustic-velocity sizer.
 */
export function routeSteppedSupplyDucts(
  zone: EquipmentServiceZone,
  supplyTerminals: CoordinatedAirTerminal[],
  profile: StandardsProfile = ASHRAE_PROFILE
): SteppedDuctSection[] {
  if (supplyTerminals.length === 0) return [];

  const eqPos = zone.equipmentPosition;
  const poly = zone.serviceAreaPolygon && zone.serviceAreaPolygon.length >= 6
    ? zone.serviceAreaPolygon
    : supplyTerminals.flatMap((t) => [t.position.x, t.position.y]).concat([eqPos.x, eqPos.y]);
  const axis = pickAxis(bboxOf(poly));
  const { bayPoly, roomPoly } = zoneRoutingPolygons(zone);

  const terminals: TopoTerminal[] = supplyTerminals.map((t) => ({ id: t.id, x: t.position.x, y: t.position.y, cfm: t.cfm }));
  const segs = buildOrthogonalTree({ x: eqPos.x, y: eqPos.y }, terminals, {
    axis,
    snapTol: STATION_SNAP_FT,
    onLineTol: ON_LINE_TOL_FT,
    minLen: MIN_PIECE_FT,
    polygon: bayPoly ?? roomPoly,
    fallbackPolygon: roomPoly,
    // never run along the unit's return collar stub (either side)
    avoid: [...returnStubCandidates({ x: eqPos.x, y: eqPos.y }, axis, RETURN_COLLAR_OFFSET_FT), ...avoidLayoutsFor(zone, false)]
  });

  rememberZoneLayout(zone, 'supply', segs);
  const sections = topologyToSections(zone, segs, {
    systemType: 'supply',
    idPrefix: 'DS',
    root: { x: eqPos.x, y: eqPos.y },
    axis
  });

  return sizeDuctNetwork(sections, profile, zone.maxAvailableCeilingDepthIn ?? 14);
}

export const STEPPED_ROUTER_TOLERANCES = { ON_LINE_TOL_FT, STATION_SNAP_FT, MIN_PIECE_FT };
export { bboxOf as serviceAreaBounds };
