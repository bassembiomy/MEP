import { DEFAULT_VOID_IN, maxDuctDepthForVoid } from '../ceilingVoid';
import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { ASHRAE_PROFILE, StandardsProfile } from '../standards/designStandards';
import {
  SteppedDuctSection,
  RoutingContext,
  requiredHalfWidthsFt,
  flagClearanceIssues,
  RETURN_COLLAR_OFFSET_FT,
  STEPPED_ROUTER_TOLERANCES,
  serviceAreaBounds,
  zoneRoutingPolygons,
  topologyToSections
} from './steppedDuctRouter';
import {
  buildOrthogonalTree,
  chooseReturnCollar,
  pickAxis,
  segmentInsidePolygon,
  Seg2,
  splitRootTerminals,
  TopoTerminal
} from './orthogonalTopology';
import { sizeDuctNetwork } from './aerodynamicDuctSizer';
import { DUCT_TERMINAL_CLEARANCE_FT, WALL_DUCT_CLEARANCE_FT } from './clearance';

/** Plenum-return intake run length (ft) when no return grilles are supplied. */
const PLENUM_INTAKE_LENGTH_FT = 6;

/**
 * Routes the return network with the same orthogonal rules as supply:
 *  unit return collar -> short perpendicular stub -> return trunk along the dominant room axis ->
 *  straight perpendicular runs to each return grille. Sized with the return velocity limit and the
 *  friction target (no hard-coded stub). Airflow in each section = sum of grilles downstream.
 */
export function routeReturnDucts(
  zone: EquipmentServiceZone,
  returnTerminals: CoordinatedAirTerminal[] = [],
  profile: StandardsProfile = ASHRAE_PROFILE,
  /** Segments already routed (this zone's supply + all other zones' supply / earlier returns) to keep clear of. */
  avoidSegments: Seg2[] = [],
  ctx: RoutingContext = {}
): SteppedDuctSection[] {
  const eqPos = zone.equipmentPosition;
  const poly = zone.serviceAreaPolygon && zone.serviceAreaPolygon.length >= 6
    ? zone.serviceAreaPolygon
    : returnTerminals.flatMap((t) => [t.position.x, t.position.y]).concat([eqPos.x, eqPos.y]);
  const box = serviceAreaBounds(poly);
  const axis = pickAxis(box);
  const horizontal = axis === 'h';

  // Inside constraint: the full room outline (service bays of L / U rooms can be disconnected pieces)
  const { bayPoly, roomPoly } = zoneRoutingPolygons(zone);
  const grillePts = returnTerminals.filter((t) => t.cfm > 0).map((t) => ({ x: t.position.x, y: t.position.y }));

  // Return collar sits RETURN_COLLAR_OFFSET_FT off the supply trunk line, on the side that is inside the room with
  // >= 1 ft wall clearance (the side holding more grilles wins, then the room-centre side).
  const collar = chooseReturnCollar(
    { x: eqPos.x, y: eqPos.y },
    axis,
    RETURN_COLLAR_OFFSET_FT,
    roomPoly,
    grillePts,
    { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
    1,
    bayPoly
  );

  const grilles = returnTerminals.filter((t) => t.cfm > 0);
  const totalReturnCfm = grilles.length > 0
    ? grilles.reduce((s, t) => s + t.cfm, 0)
    : zone.returnCfm || Math.round(zone.supplyCfm * 0.88);

  const r2 = (n: number): number => parseFloat(n.toFixed(2));

  // Clearance mode: the return trunk leaves the unit on its own line (>= collar offset from the supply trunk, on the
  // side the supply stub does not use), stays off every diffuser face and keeps its edge off the walls. The router
  // sizes the result and feeds the sized half widths back until routing and sizing agree.
  if (ctx.obstacles !== undefined && grilles.length > 0) {
    const terminals: TopoTerminal[] = grilles.map((t) => ({ id: t.id, x: t.position.x, y: t.position.y, cfm: t.cfm }));
    const depth = maxDuctDepthForVoid(zone.maxAvailableCeilingDepthIn ?? DEFAULT_VOID_IN);
    let hwT = 0.7, hwB = 0.4;
    let sized: SteppedDuctSection[] = [];
    for (let iter = 0; iter < 4; iter++) {
      const segs = buildOrthogonalTree({ x: eqPos.x, y: eqPos.y }, terminals, {
        axis,
        snapTol: STEPPED_ROUTER_TOLERANCES.STATION_SNAP_FT,
        onLineTol: STEPPED_ROUTER_TOLERANCES.ON_LINE_TOL_FT,
        minLen: STEPPED_ROUTER_TOLERANCES.MIN_PIECE_FT,
        polygon: bayPoly ?? roomPoly,
        fallbackPolygon: roomPoly,
        avoid: avoidSegments,
        obstacles: ctx.obstacles,
        hwTrunk: hwT,
        hwBranch: hwB,
        wallClear: WALL_DUCT_CLEARANCE_FT,
        termClear: DUCT_TERMINAL_CLEARANCE_FT,
        minRootOffset: RETURN_COLLAR_OFFSET_FT
      });
      const sections = topologyToSections(zone, segs, { systemType: 'return', idPrefix: 'RDS', root: { x: eqPos.x, y: eqPos.y }, axis });
      sized = sizeDuctNetwork(sections, profile, depth, ctx.units);
      const need = requiredHalfWidthsFt(sized);
      if (need.trunk <= hwT + 1e-6 && need.branch <= hwB + 1e-6) break;
      hwT = Math.max(hwT, need.trunk);
      hwB = Math.max(hwB, need.branch);
    }
    return flagClearanceIssues(sized, roomPoly, ctx.obstacles);
  }

  const stubId = `RDS-${zone.unitTag}-1`;
  const stub: SteppedDuctSection = {
    id: stubId,
    unitId: zone.id,
    designControlMode: 'ai',
    systemType: 'return',
    role: 'main-trunk',
    startPoint: { x: r2(eqPos.x), y: r2(eqPos.y) },
    endPoint: { x: r2(collar.x), y: r2(collar.y) },
    airflowCfm: totalReturnCfm,
    shape: 'rectangular',
    widthIn: 0,
    heightIn: 0,
    velocityFpm: 0,
    allowableVelocityFpm: 0,
    frictionLossPer100Ft: 0,
    fittingLossInWg: 0,
    totalSectionLossInWg: 0,
    ncRating: zone.targetNc || 30,
    connectedDiffuserCount: grilles.length,
    connectedDiffusers: grilles.map((t) => t.id),
    directDiffusers: [],
    childDuctIds: []
  };

  let sections: SteppedDuctSection[];

  if (grilles.length > 0) {
    const all: TopoTerminal[] = grilles.map((t) => ({ id: t.id, x: t.position.x, y: t.position.y, cfm: t.cfm }));
    const treeBase = {
      axis,
      snapTol: STEPPED_ROUTER_TOLERANCES.STATION_SNAP_FT,
      onLineTol: STEPPED_ROUTER_TOLERANCES.ON_LINE_TOL_FT,
      minLen: STEPPED_ROUTER_TOLERANCES.MIN_PIECE_FT
    };
    // Grilles sitting on the collar itself are served by the stub (it ends there); the tree carries the rest
    const { rest, atRoot } = splitRootTerminals(collar, all, treeBase);
    stub.directDiffusers = atRoot.map((t) => t.id);
    const segs = buildOrthogonalTree(collar, rest, {
      ...treeBase,
      polygon: bayPoly ?? roomPoly,
      fallbackPolygon: roomPoly,
      // the unit connection (supply root -> collar) and the supply network must not be re-used by the return tree
      avoid: [{ start: { x: eqPos.x, y: eqPos.y }, end: collar }, ...avoidSegments]
    });
    const tree = topologyToSections(zone, segs, {
      systemType: 'return',
      idPrefix: 'RDS',
      root: collar,
      axis,
      rootParentId: stubId,
      startIndex: 2
    });
    stub.childDuctIds = tree.filter((s) => s.parentDuctId === stubId).map((s) => s.id);
    sections = [stub, ...tree];
  } else {
    // Plenum / open return: single intake run from the collar toward the room centre
    const centreU = horizontal ? (box.minX + box.maxX) / 2 : (box.minY + box.maxY) / 2;
    const unitU = horizontal ? eqPos.x : eqPos.y;
    const pref = centreU - unitU >= 0 ? 1 : -1;
    const baseLen = Math.max(3, Math.min(PLENUM_INTAKE_LENGTH_FT, Math.abs(centreU - unitU) || PLENUM_INTAKE_LENGTH_FT));
    const endFor = (d: number, l: number): { x: number; y: number; } =>
      horizontal ? { x: collar.x + d * l, y: collar.y } : { x: collar.x, y: collar.y + d * l };
    // longest intake run (preferring the centre side) that stays inside the room
    let end = endFor(pref, baseLen);
    if (roomPoly) {
      outer: for (const l of [baseLen, baseLen * 0.67, baseLen * 0.33]) {
        for (const d of [pref, -pref]) {
          const cand = endFor(d, l);
          if (segmentInsidePolygon(collar, cand, roomPoly, 0.2, 0.5, [collar])) { end = cand; break outer; }
        }
      }
    }
    const runId = `RDS-${zone.unitTag}-2`;
    const run: SteppedDuctSection = {
      ...stub,
      id: runId,
      startPoint: { x: r2(collar.x), y: r2(collar.y) },
      endPoint: { x: r2(end.x), y: r2(end.y) },
      parentDuctId: stubId,
      connectedDiffuserCount: 0,
      connectedDiffusers: [],
      childDuctIds: []
    };
    stub.childDuctIds = [runId];
    sections = [stub, run];
  }

  return sizeDuctNetwork(sections, profile, maxDuctDepthForVoid(zone.maxAvailableCeilingDepthIn ?? DEFAULT_VOID_IN));
}

/** Length (ft) of the return plenum box that joins the unit's return opening to the ceiling plenum. */
export const PLENUM_BOX_LENGTH_FT = 2;

const distPointSeg = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/**
 * Ceiling-plenum return: the return grilles open into the ceiling void and the unit draws from it through ONE short
 * return box at the unit's return opening. No return main is routed, so the return can never run alongside or over the
 * supply trunk. The box leaves the unit on the side opposite the supply trunk (otherwise the first side that keeps clear
 * of every supply duct and inside the room).
 */
export function routePlenumReturnBox(
  zone: EquipmentServiceZone,
  returnTerminals: CoordinatedAirTerminal[],
  profile: StandardsProfile = ASHRAE_PROFILE,
  /** Supply sections already routed (this unit's trunk decides the side; all of them are kept clear). */
  supplySections: ReadonlyArray<{ unitId: string; startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; widthIn: number }> = [],
  units?: string
): SteppedDuctSection[] {
  const eq = zone.equipmentPosition;
  const grilles = returnTerminals.filter((t) => t.cfm > 0);
  const total = grilles.length > 0 ? grilles.reduce((s, t) => s + t.cfm, 0) : zone.returnCfm || Math.round(zone.supplyCfm * 0.88);
  const { roomPoly } = zoneRoutingPolygons(zone);
  const own = supplySections.find((s) => s.unitId === zone.id && Math.hypot(s.startPoint.x - eq.x, s.startPoint.y - eq.y) < 0.3);
  let sd = { x: 1, y: 0 };
  if (own) {
    const dx = own.endPoint.x - own.startPoint.x, dy = own.endPoint.y - own.startPoint.y;
    const L = Math.hypot(dx, dy);
    if (L > 1e-6) sd = { x: Math.round(dx / L), y: Math.round(dy / L) };
  }
  const dirs = [{ x: -sd.x, y: -sd.y }, { x: -sd.y, y: sd.x }, { x: sd.y, y: -sd.x }, { x: sd.x, y: sd.y }];
  const r2 = (n: number): number => parseFloat(n.toFixed(2));
  let best: { end: { x: number; y: number }; score: number } | null = null;
  for (const d of dirs) {
    const end = { x: eq.x + d.x * PLENUM_BOX_LENGTH_FT, y: eq.y + d.y * PLENUM_BOX_LENGTH_FT };
    const root = { x: eq.x, y: eq.y };
    // the box edge keeps >= 0.5 ft off the walls: prefer an end point with 1 ft to the wall (centre line), then 0.2 ft
    const inside = !roomPoly || segmentInsidePolygon(root, end, roomPoly, 1.0, 0.5, [root]) ? 2 : segmentInsidePolygon(root, end, roomPoly, 0.2, 0.5, [root]) ? 1 : 0;
    // clearance of the box end to every supply duct (their centre line, less half width)
    const clear = Math.min(Infinity, ...supplySections.map((s) => distPointSeg(end, s.startPoint, s.endPoint) - s.widthIn / 24));
    const score = inside * 1000 + Math.min(clear, 3);
    if (!best || score > best.score + 1e-9) best = { end, score };
  }
  const end = best ? best.end : { x: eq.x + dirs[0].x * PLENUM_BOX_LENGTH_FT, y: eq.y + dirs[0].y * PLENUM_BOX_LENGTH_FT };
  const box: SteppedDuctSection = {
    id: `RDS-${zone.unitTag}-1`,
    unitId: zone.id,
    designControlMode: 'ai',
    systemType: 'return',
    role: 'main-trunk',
    startPoint: { x: r2(eq.x), y: r2(eq.y) },
    endPoint: { x: r2(end.x), y: r2(end.y) },
    airflowCfm: total,
    shape: 'rectangular',
    widthIn: 0,
    heightIn: 0,
    velocityFpm: 0,
    allowableVelocityFpm: 0,
    frictionLossPer100Ft: 0,
    fittingLossInWg: 0,
    totalSectionLossInWg: 0,
    ncRating: zone.targetNc || 30,
    connectedDiffuserCount: grilles.length,
    connectedDiffusers: grilles.map((t) => t.id),
    directDiffusers: [],
    childDuctIds: [],
    plenumBox: true
  };
  return sizeDuctNetwork([box], profile, maxDuctDepthForVoid(zone.maxAvailableCeilingDepthIn ?? DEFAULT_VOID_IN), units);
}
