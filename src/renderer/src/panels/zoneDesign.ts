import type { Zone, ProjectMetadata, Diffuser, DuctSegment } from '../store/projectStore';
import { calculateZoneLoad } from '../engine/loadCalc';
import { toBtuh, toCfm, toSqFt, polygonFtToPx } from '../engine/units';
import { DEFAULT_SPACE_NC_TARGETS } from '../engine/acousticDuctEngine';
import {
  executeAirDistributionDesign,
  convertDesignResultToZonePayload,
  type AirDistributionDesignResult,
  type ZonePayload
} from '../engine/airDistributionEngine';
import { getPolygonBounds } from '../engine/geometry';

export type MountingSide = 'north' | 'south' | 'east' | 'west';

/**
 * Exterior wall the outdoor units mount on: the side of the zone nearest the drawing's outer edge that is not
 * crowded by a neighbouring zone. Falls back to 'east' without a drawing extent.
 */
export function chooseMountingSide(
  points: number[],
  otherZonePolygons: number[][],
  extent?: { minX: number; maxX: number; minY: number; maxY: number } | null
): MountingSide {
  if (points.length < 6) return 'east';
  const b = getPolygonBounds(points);
  const ext = extent ?? {
    minX: Math.min(b.minX, ...otherZonePolygons.map((p) => getPolygonBounds(p).minX)),
    maxX: Math.max(b.maxX, ...otherZonePolygons.map((p) => getPolygonBounds(p).maxX)),
    minY: Math.min(b.minY, ...otherZonePolygons.map((p) => getPolygonBounds(p).minY)),
    maxY: Math.max(b.maxY, ...otherZonePolygons.map((p) => getPolygonBounds(p).maxY))
  };
  const reach = Math.max(b.width, b.height) * 0.25;
  const cost: Record<MountingSide, number> = {
    north: b.minY - ext.minY,
    south: ext.maxY - b.maxY,
    west: b.minX - ext.minX,
    east: ext.maxX - b.maxX
  };
  for (const op of otherZonePolygons) {
    if (op.length < 6) continue;
    const o = getPolygonBounds(op);
    const overlapX = o.minX < b.maxX && o.maxX > b.minX;
    const overlapY = o.minY < b.maxY && o.maxY > b.minY;
    if (overlapX && o.maxY <= b.minY + reach && o.maxY > b.minY - reach * 4) cost.north += 1e6;
    if (overlapX && o.minY >= b.maxY - reach && o.minY < b.maxY + reach * 4) cost.south += 1e6;
    if (overlapY && o.maxX <= b.minX + reach && o.maxX > b.minX - reach * 4) cost.west += 1e6;
    if (overlapY && o.minX >= b.maxX - reach && o.minX < b.maxX + reach * 4) cost.east += 1e6;
  }
  const order: MountingSide[] = ['east', 'south', 'west', 'north'];
  return order.reduce((best, s) => (cost[s] < cost[best] - 1e-9 ? s : best), order[0]);
}

export interface ZoneDesign {
  design: AirDistributionDesignResult;
  payload: ZonePayload;
}

/**
 * THE one air-distribution pipeline of the app. Auto-Layout, Schedule "Apply", and the Static-Pressure / Optimizer /
 * Inspector panels all take their terminals, units and ducts from executeAirDistributionDesign through this function
 * (and store it with convertDesignResultToZonePayload), so every panel shows the same counts and sizes as the canvas.
 */
export function designZone(
  zone: Zone,
  zones: Zone[],
  project: ProjectMetadata,
  extent?: { minX: number; maxX: number; minY: number; maxY: number } | null,
  overrides: { userOverrideUnitCount?: number } = {}
): ZoneDesign {
  const units = project.units;
  const loads = calculateZoneLoad(zone, project);
  const hasPolygon = !!zone.points && zone.points.length >= 6;
  const roomPolygon = hasPolygon ? zone.points : polygonFtToPx([0, 0, 50, 0, 50, 30, 0, 30], project.scale, units);
  const others = zones.filter((z) => z.id !== zone.id && z.points && z.points.length >= 6).map((z) => z.points);
  const targetNc = zone.targetNc ?? DEFAULT_SPACE_NC_TARGETS[zone.spaceTypeId]?.nc;

  const design = executeAirDistributionDesign({
    roomName: zone.name || 'Conditioned Space',
    roomPolygon,
    otherZonePolygons: others,
    scalePxPerUnit: project.scale,
    units,
    roomAreaSqFt: toSqFt(loads.area, units) || 1500,
    sensibleLoadBtu: toBtuh(loads.sensibleLoad, units) || 120000,
    totalLoadBtu: toBtuh(loads.totalLoad, units) || 141000,
    requiredCfm: toCfm(loads.supplyCfm, units) || 4000,
    occupancyCount: loads.occupants || undefined,
    spaceTypeId: zone.spaceTypeId || 'office',
    exhaustCfm: toCfm(loads.exhaustCfm || 0, units),
    systemType: zone.systemType || 'concealed',
    mountingWallSide: chooseMountingSide(roomPolygon, others, extent),
    maxAvailableCeilingDepthIn: 14,
    targetNc,
    userOverrideUnitCount: overrides.userOverrideUnitCount
  });
  return { design, payload: convertDesignResultToZonePayload(design) };
}

/**
 * Zone patch for a design: the payload verbatim (diffusers incl. unitId / serviceZoneId, ducts, unitPositions, ONE
 * outdoor unit per split indoor unit in outdoorUnitPositions, unitServiceZones ...). Non-ducted system types drop
 * what they do not have; user locks keep the existing parts.
 */
/**
 * Canvas association id of indoor unit `index` (0-based) of a zone: the zone id for unit 0 and `${zoneId}-u${index}` for
 * the others - the ids canvas/shopDrawing.buildUnitKeyMap maps back to unitPositions[index] / outdoorUnitPositions[index].
 */
export function unitRefOf(zoneId: string, index: number): string {
  return index <= 0 ? zoneId : `${zoneId}-u${index}`;
}

export function zonePatchFromDesign(zone: Zone, payload0: ZonePayload): Partial<Zone> {
  // re-key engine service-zone ids (sz-N) to the canvas unit refs; terminal / duct / unitServiceZones ids follow unitPositions order
  const refOf = new Map(payload0.unitServiceZones.map((u, i) => [u.id, unitRefOf(zone.id, i)]));
  const re = <T extends { unitId?: string; serviceZoneId?: string }>(x: T): T => {
    const r = x.unitId !== undefined ? refOf.get(x.unitId) : undefined;
    return r === undefined ? x : { ...x, unitId: r, serviceZoneId: r };
  };
  const payload: ZonePayload = {
    ...payload0,
    diffusers: payload0.diffusers.map(re),
    ducts: payload0.ducts.map(re),
    unitServiceZones: payload0.unitServiceZones.map((u) => ({ ...u, engineId: u.id, id: refOf.get(u.id) ?? u.id })),
    outdoorUnitDetails: payload0.outdoorUnitDetails.map((o) => ({ ...o, serves: o.serves.map((id) => refOf.get(id) ?? id) }))
  };
  const sys = zone.systemType;
  const ducted = sys === undefined || sys === 'concealed' || sys === 'packaged' || sys === 'ahu' || sys === 'vrf' || sys === 'fcu';
  let diffusers: Diffuser[] = payload.diffusers as Diffuser[];
  let ducts: DuctSegment[] = payload.ducts as DuctSegment[];
  if (sys === 'high-wall') { diffusers = []; ducts = []; }
  else if (sys === 'cassette') { diffusers = diffusers.filter((d) => d.type !== 'return'); ducts = []; }
  else if (!ducted) ducts = [];

  const patch: Partial<Zone> = {
    diffusers: zone.isDiffusersLocked ? zone.diffusers : diffusers,
    ducts: zone.isDuctLocked ? zone.ducts : ducts,
    catalogQty: payload.catalogQty,
    catalogModel: payload.catalogModel,
    catalogEsp: payload.catalogEsp,
    serviceZonePolygons: payload.serviceZonePolygons,
    unitServiceZones: payload.unitServiceZones
  };
  if (!zone.isEquipmentLocked) {
    patch.unitPos = payload.unitPos;
    patch.unitPositions = payload.unitPositions;
    patch.outdoorUnitPos = payload.outdoorUnitPos;
    patch.outdoorUnitPositions = payload.outdoorUnitPositions;
    patch.outdoorUnitDetails = payload.outdoorUnitDetails;
  }
  return patch;
}
