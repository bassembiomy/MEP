import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { ASHRAE_PROFILE, StandardsProfile } from '../standards/designStandards';
import {
  SteppedDuctSection,
  RETURN_COLLAR_OFFSET_FT,
  STEPPED_ROUTER_TOLERANCES,
  serviceAreaBounds,
  avoidLayoutsFor,
  rememberZoneLayout,
  zoneRoutingPolygons,
  topologyToSections
} from './steppedDuctRouter';
import {
  buildOrthogonalTree,
  chooseReturnCollar,
  pickAxis,
  segmentInsidePolygon,
  splitRootTerminals,
  TopoTerminal
} from './orthogonalTopology';
import { sizeDuctNetwork } from './aerodynamicDuctSizer';

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
  profile: StandardsProfile = ASHRAE_PROFILE
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

  const r2 = (n: number) => parseFloat(n.toFixed(2));
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
      avoid: [{ start: { x: eqPos.x, y: eqPos.y }, end: collar }, ...avoidLayoutsFor(zone, true)]
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
    const endFor = (d: number, l: number) =>
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

  rememberZoneLayout(zone, 'ret', sections.map((d) => ({ start: d.startPoint, end: d.endPoint })));
  return sizeDuctNetwork(sections, profile, zone.maxAvailableCeilingDepthIn ?? 14);
}
