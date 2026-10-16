import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { ASHRAE_PROFILE, StandardsProfile } from '../standards/designStandards';
import {
  SteppedDuctSection,
  RETURN_COLLAR_OFFSET_FT,
  STEPPED_ROUTER_TOLERANCES,
  serviceAreaBounds,
  topologyToSections
} from './steppedDuctRouter';
import { buildOrthogonalTree, pickAxis, TopoTerminal } from './orthogonalTopology';
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

  // Return collar sits on the room-centre side of the supply trunk line so the two trunks never overlap
  const centreV = horizontal ? (box.minY + box.maxY) / 2 : (box.minX + box.maxX) / 2;
  const unitV = horizontal ? eqPos.y : eqPos.x;
  const sign = centreV - unitV >= 0 ? 1 : -1;
  const collar = horizontal
    ? { x: eqPos.x, y: eqPos.y + sign * RETURN_COLLAR_OFFSET_FT }
    : { x: eqPos.x + sign * RETURN_COLLAR_OFFSET_FT, y: eqPos.y };

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
    const terminals: TopoTerminal[] = grilles.map((t) => ({ id: t.id, x: t.position.x, y: t.position.y, cfm: t.cfm }));
    const segs = buildOrthogonalTree(collar, terminals, {
      axis,
      snapTol: STEPPED_ROUTER_TOLERANCES.STATION_SNAP_FT,
      onLineTol: STEPPED_ROUTER_TOLERANCES.ON_LINE_TOL_FT,
      minLen: STEPPED_ROUTER_TOLERANCES.MIN_PIECE_FT
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
    const dir = centreU - unitU >= 0 ? 1 : -1;
    const len = Math.max(3, Math.min(PLENUM_INTAKE_LENGTH_FT, Math.abs(centreU - unitU) || PLENUM_INTAKE_LENGTH_FT));
    const end = horizontal
      ? { x: collar.x + dir * len, y: collar.y }
      : { x: collar.x, y: collar.y + dir * len };
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

  return sizeDuctNetwork(sections, profile, zone.maxAvailableCeilingDepthIn ?? 14);
}
