import { DEFAULT_VOID_IN, maxDuctDepthForVoid } from '../ceilingVoid';
import { EquipmentServiceZone, DesignControlMode } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { ASHRAE_PROFILE, StandardsProfile } from '../standards/designStandards';
import { buildOrthogonalTree, pickAxis, returnStubCandidates, Seg2, TopoObstacle, TopoSegment, TopoTerminal } from './orthogonalTopology';
import { sizeDuctNetwork } from './aerodynamicDuctSizer';
import { DUCT_TERMINAL_CLEARANCE_FT, WALL_DUCT_CLEARANCE_FT, orthogonalCrossing } from './clearance';
import { findClearanceIssue } from './clearanceCheck';
import type { UnitSystem } from '../units';

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
  /**
   * Supply / return plan crossing that could not be routed around: this section crosses the listed foreign-network
   * sections and needs a vertical offset (one duct passes above the other).
   */
  crossover?: boolean;
  crossoverWith?: string[];
  /** Set when no clean layout exists in this room: the rule this section still breaks (wall / terminal clearance). */
  clearanceIssue?: string;
  /** Short return plenum box at the unit (ceiling-plenum return): carries the return air, no grille is ducted to it. */
  plenumBox?: boolean;
}

/** Verifies the sized sections against the plan clearance rules and flags every section that still breaks one. */
export function flagClearanceIssues(
  sections: SteppedDuctSection[],
  roomPolygon: number[] | undefined,
  obstacles: ReadonlyArray<TopoObstacle>
): SteppedDuctSection[] {
  for (const s of sections) {
    const issue = findClearanceIssue(
      { seg: { start: s.startPoint, end: s.endPoint }, width: s.widthIn / 12, endsAt: s.directDiffusers ?? [] },
      roomPolygon,
      obstacles
    );
    if (issue) {
      s.clearanceIssue = issue;
      s.designWarnings = [...(s.designWarnings ?? []), `Clearance: ${issue}`];
    }
  }
  return sections;
}

/** Terminal faces and sizing units shared by the routers; giving `obstacles` switches them to clearance mode. */
export interface RoutingContext {
  /** Faces (ft) of every terminal of the room. */
  obstacles?: TopoObstacle[];
  units?: UnitSystem | string;
}

/**
 * Marks every supply / return section pair that crosses in plan (outside the shared unit roots) as a "crossover":
 * the crossing was unavoidable and needs a vertical offset. Returns the number of crossings.
 */
export function flagCrossovers(
  supply: SteppedDuctSection[],
  returns: SteppedDuctSection[],
  roots: ReadonlyArray<{ x: number; y: number }>
): number {
  let n = 0;
  for (const s of supply) {
    for (const r of returns) {
      const p = orthogonalCrossing({ start: s.startPoint, end: s.endPoint }, { start: r.startPoint, end: r.endPoint }, 0.02);
      if (!p || roots.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 0.1)) continue;
      n++;
      for (const [a, b] of [[s, r], [r, s]] as Array<[SteppedDuctSection, SteppedDuctSection]>) {
        a.crossover = true;
        a.crossoverWith = [...(a.crossoverWith ?? []), b.id];
        a.designWarnings = [...(a.designWarnings ?? []), `Crossover with ${b.id}: vertical offset required`];
      }
    }
  }
  return n;
}

/** Half widths (ft) of the sized sections: trunk-role and branch / run-out role. */
export function requiredHalfWidthsFt(sections: ReadonlyArray<SteppedDuctSection>): { trunk: number; branch: number } {
  let trunk = 0, branch = 0;
  for (const s of sections) {
    const hw = Math.max(s.widthIn, s.shape === 'round' ? s.diameterIn ?? s.widthIn : 0) / 24;
    if (s.role === 'main-trunk') trunk = Math.max(trunk, hw);
    else branch = Math.max(branch, hw);
  }
  return { trunk, branch };
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

/** Straight segments (start/end only) of routed duct sections, for use as `avoidSegments` of later routing calls. */
export function ductSegments(sections: ReadonlyArray<{ startPoint: { x: number; y: number }; endPoint: { x: number; y: number } }>): Seg2[] {
  return sections.map((d) => ({ start: { x: d.startPoint.x, y: d.startPoint.y }, end: { x: d.endPoint.x, y: d.endPoint.y } }));
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
  profile: StandardsProfile = ASHRAE_PROFILE,
  /** Segments already routed by neighbouring zones (explicit data flow; no hidden shared state). */
  avoidSegments: Seg2[] = [],
  ctx: RoutingContext = {}
): SteppedDuctSection[] {
  if (supplyTerminals.length === 0) return [];

  const eqPos = zone.equipmentPosition;
  const poly = zone.serviceAreaPolygon && zone.serviceAreaPolygon.length >= 6
    ? zone.serviceAreaPolygon
    : supplyTerminals.flatMap((t) => [t.position.x, t.position.y]).concat([eqPos.x, eqPos.y]);
  const axis = pickAxis(bboxOf(poly));
  const { bayPoly, roomPoly } = zoneRoutingPolygons(zone);

  const terminals: TopoTerminal[] = supplyTerminals.map((t) => ({ id: t.id, x: t.position.x, y: t.position.y, cfm: t.cfm }));
  const clearance = ctx.obstacles !== undefined;
  const depth = maxDuctDepthForVoid(zone.maxAvailableCeilingDepthIn ?? DEFAULT_VOID_IN);

  // Clearance mode: route -> size -> verify; the duct EDGE (not the centreline) must clear walls and diffusers, so the
  // sized half widths feed back into the routing until they agree.
  let hwT = 0.6, hwB = 0.4;
  let sized: SteppedDuctSection[] = [];
  for (let iter = 0; iter < (clearance ? 4 : 1); iter++) {
    const segs = buildOrthogonalTree({ x: eqPos.x, y: eqPos.y }, terminals, {
      axis,
      snapTol: STATION_SNAP_FT,
      onLineTol: ON_LINE_TOL_FT,
      minLen: MIN_PIECE_FT,
      polygon: bayPoly ?? roomPoly,
      fallbackPolygon: roomPoly,
      // never run along the unit's return collar stub (either side); clearance mode places the return stub afterwards
      avoid: clearance ? avoidSegments : [...returnStubCandidates({ x: eqPos.x, y: eqPos.y }, axis, RETURN_COLLAR_OFFSET_FT), ...avoidSegments],
      ...(clearance
        ? { obstacles: ctx.obstacles, hwTrunk: hwT, hwBranch: hwB, wallClear: WALL_DUCT_CLEARANCE_FT, termClear: DUCT_TERMINAL_CLEARANCE_FT }
        : {})
    });
    const sections = topologyToSections(zone, segs, {
      systemType: 'supply',
      idPrefix: 'DS',
      root: { x: eqPos.x, y: eqPos.y },
      axis
    });
    sized = sizeDuctNetwork(sections, profile, depth, ctx.units);
    if (!clearance) break;
    const need = requiredHalfWidthsFt(sized);
    if (need.trunk <= hwT + 1e-6 && need.branch <= hwB + 1e-6) break;
    hwT = Math.max(hwT, need.trunk);
    hwB = Math.max(hwB, need.branch);
  }
  return clearance ? flagClearanceIssues(sized, roomPoly, ctx.obstacles!) : sized;
}

export const STEPPED_ROUTER_TOLERANCES = { ON_LINE_TOL_FT, STATION_SNAP_FT, MIN_PIECE_FT };
export { bboxOf as serviceAreaBounds };
