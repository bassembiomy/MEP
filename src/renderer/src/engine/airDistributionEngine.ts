import { StandardsProfile, getStandardsProfile } from './standards/designStandards';
import { optimizeMultiUnitCandidates, evaluateUnitCountOption, eligibleItemsFor, MultiUnitCandidate } from './systemArchitecture/equipmentOptimizer';
import { evaluateSizing, MAX_UNIT_COUNT } from './systemArchitecture/equipmentSelector';
import { generateDesignDecisionLog } from './systemArchitecture/designDecisionLogger';
import { partitionRoomIntoServiceZones, partitionRoomIntoBays, polygonAreaFt2, EquipmentServiceZone } from './zoning/zonePartitioner';
import { decomposeConvex } from './terminals/bayLayout';
import { placeSupplyDiffusersForZone, CoordinatedAirTerminal } from './terminals/terminalPlacer';
import { placeReturnGrillesForZone } from './terminals/returnPlacer';
import { routeSteppedSupplyDucts, ductSegments, flagCrossovers, SteppedDuctSection } from './ducts/steppedDuctRouter';
import type { Seg2, TopoObstacle } from './ducts/orthogonalTopology';
import { Rect, parseFaceIn, inflateRect, ductBodyRect, terminalFaceRectFt, unitFootprintFt, unitKeepOutFt, DEFAULT_IDU_LENGTH_IN, DEFAULT_IDU_WIDTH_IN, DUCT_TERMINAL_CLEARANCE_FT } from './ducts/clearance';
import { routeReturnDucts, routePlenumReturnBox } from './ducts/returnDuctRouter';
import { countCrossings } from './ducts/clearance';
import { sizeDuctNetwork } from './ducts/aerodynamicDuctSizer';
import { routeFreshAirDucts, OutdoorAirSystem } from './outdoorAir/freshAirRouter';
import { calculateAshrae621Ventilation, Ashrae621Result } from './outdoorAir/outdoorAirCalculator';
import { polygonPxToFt, pxPerFt, UnitSystem, MM_PER_IN } from './units';
import { calculateOutdoorUnitPlacement, calculateWallMountedUnitPos, clipPolygonToRect, getPolygonBounds, isPointInPolygon, distanceToPolygonEdge, MIN_TERMINAL_SPACING_FT, WALL_UNIT_DEFAULT_WIDTH_FT, Pt2 } from './geometry';
import { executeMasterHvacValidation, MasterValidationReport } from './validation/hvacValidator';
import { diffuserCatalogFor } from './hvacCatalogs';
import { DEFAULT_SPACE_NC_TARGETS } from './acousticDuctEngine';
import { DEFAULT_VOID_IN, maxDuctDepthForVoid } from './ceilingVoid';

export interface AirDistributionDesignInput {
  roomName: string;
  roomPolygon: number[];
  roomAreaSqFt: number;
  sensibleLoadBtu: number;
  totalLoadBtu: number;
  requiredCfm: number;
  occupancyCount?: number;
  systemType?: string;
  standardsProfileType?: 'ashrae' | 'smacna' | 'project-custom';
  maxAvailableCeilingDepthIn?: number;
  mountingWallSide?: 'north' | 'south' | 'east' | 'west';
  userOverrideUnitCount?: number;
  exteriorWalls?: Array<{ side: 'north' | 'south' | 'east' | 'west'; glassRatio?: number }>;
  /**
   * Canvas px per project length unit (ft for imperial, m for metric). When given, `roomPolygon`
   * is treated as canvas px and converted to ft at entry; results are converted back in
   * convertDesignResultToZonePayload. When omitted, `roomPolygon` is assumed to be in feet.
   * All load/airflow inputs are always imperial (Btu/h, CFM, ft2) - use toBtuh/toCfm/toSqFt.
   */
  scalePxPerUnit?: number;
  units?: 'imperial' | 'metric';
  /** ASHRAE 62.1 space type id (knowledgeBase ASHRAE_SPACE_TYPES). Default 'office'. */
  spaceTypeId?: string;
  /** Zone air distribution effectiveness Ez. Default 1.0 (cooling, ceiling supply). */
  ventilationEffectivenessEz?: number;
  /** Local exhaust from the room (CFM). Default 0. */
  exhaustCfm?: number;
  /**
   * Outlines of the OTHER zones of the project, in the same units as `roomPolygon` (canvas px when `scalePxPerUnit` is
   * given, else ft). Outdoor units are never placed inside / overlapping them.
   */
  otherZonePolygons?: number[][];
  /** Space NC target (zone `targetNc`). Default: the space type's NC from DEFAULT_SPACE_NC_TARGETS, else 30. */
  targetNc?: number;
  /**
   * How the return air gets back to the unit. 'plenum': the return grilles open into the ceiling void and the unit draws
   * through one short return box (no return main, so nothing runs along / over the supply trunk). 'ducted': a return
   * duct network is routed to every grille. Default: 'plenum' for concealed / ducted-FCU units when a ceiling plenum is
   * available, otherwise 'ducted'.
   */
  returnStrategy?: ReturnStrategy;
  /** A ceiling plenum is available above the room. Default: the available ceiling depth is >= 12 in. */
  ceilingPlenum?: boolean;
}

export type ReturnStrategy = 'plenum' | 'ducted';

/** How the indoor unit is served: DX refrigerant (split / VRF), chilled water (AHU / FCU) or self-contained (RTU / packaged). */
export type PlantConnection = 'refrigerant' | 'chilled-water' | 'self-contained';

export function plantConnectionFor(systemType: string | undefined): PlantConnection {
  const t = (systemType ?? 'concealed').toLowerCase();
  if (t === 'ahu' || t === 'fcu' || t === 'chilled-water' || t === 'cwu') return 'chilled-water';
  if (t === 'packaged' || t === 'rtu' || t === 'rooftop' || t === 'package') return 'self-contained';
  return 'refrigerant';
}

/** Chilled-water supply / return connection stub of an indoor unit, on the side facing the nearest exterior wall / shaft (feet). */
export interface ChwStub {
  unitIndex: number;
  x: number;
  y: number;
  side: 'north' | 'south' | 'east' | 'west';
  kind: 'supply' | 'return';
}

/** System types whose return can be drawn through the ceiling plenum. */
const PLENUM_RETURN_SYSTEMS = new Set(['concealed', 'fcu']);
/** Minimum available ceiling depth (in) for a plenum return. */
const MIN_PLENUM_DEPTH_IN = 12;
/** Wall-mounted indoor unit plan footprint (in): depth away from the wall x width along it. */
const WALL_UNIT_FOOTPRINT_IN = { lengthIn: 10, widthIn: 36 };
/** Unavoidable supply / return crossings tolerated per unit when the return is ducted (each one is flagged). */
export const MAX_DUCTED_RETURN_CROSSINGS_PER_UNIT = 1;

export function resolveReturnStrategy(
  input: { systemType?: string; returnStrategy?: ReturnStrategy; ceilingPlenum?: boolean; maxAvailableCeilingDepthIn?: number }
): ReturnStrategy {
  if (input.returnStrategy === 'plenum' || input.returnStrategy === 'ducted') return input.returnStrategy;
  const plenum = input.ceilingPlenum ?? (input.maxAvailableCeilingDepthIn ?? DEFAULT_VOID_IN) >= MIN_PLENUM_DEPTH_IN;
  return PLENUM_RETURN_SYSTEMS.has(input.systemType ?? 'concealed') && plenum ? 'plenum' : 'ducted';
}

export interface DesignMassBalance {
  supplyCfm: number;
  returnCfm: number;
  exhaustCfm: number;
  exfiltrationCfm: number;
  outdoorAirCfm: number;
}

export interface AirDistributionDesignResult {
  roomName: string;
  standardsProfile: StandardsProfile;
  selectedOption: MultiUnitCandidate;
  /** True when the user's `userOverrideUnitCount` was honoured (evaluated and used), even if it fails sizing rules. */
  overrideApplied: boolean;
  /** Sizing problems of the user-chosen unit count (e.g. "capacity ratio 0.87 -> DEFICIT"), or why it was impossible. */
  overrideWarnings: string[];
  /** Room-required airflow (CFM) the design was sized for; recalculation validates against this, not delivered CFM. */
  requiredCfm?: number;
  allOptimizationCandidates: MultiUnitCandidate[];
  serviceZones: EquipmentServiceZone[];
  supplyTerminals: CoordinatedAirTerminal[];
  returnTerminals: CoordinatedAirTerminal[];
  supplyDucts: SteppedDuctSection[];
  returnDucts: SteppedDuctSection[];
  outdoorAirSystem: OutdoorAirSystem;
  validationReport: MasterValidationReport;
  designDecisionLog: string;
  timestamp: string;
  /** Room polygon in FEET (engine units). */
  roomPolygonFt: number[];
  /** Canvas px per foot used at the boundary (1 when the input polygon was already in ft). */
  pxPerFt: number;
  /** Project unit system the design was made in (drives duct size grid and labels). */
  units?: 'imperial' | 'metric';
  ventilation: Ashrae621Result;
  massBalance: DesignMassBalance;
  /**
   * Outdoor unit per service zone, in FEET, outside the room on an exterior wall. `angleDeg` is the footprint's long
   * axis (along the wall), `lengthFt` x `depthFt` the footprint (default 34 x 13 in).
   */
  outdoorUnitPositions: Array<{ x: number; y: number; wallSide: string; angleDeg?: number; lengthFt?: number; depthFt?: number; /** Service-zone (indoor unit) ids this outdoor unit serves. */ serves?: string[] }>;
  /** Indoor unit footprint (in) used for the keep-out zones, per service zone id. */
  unitFootprintsIn?: Record<string, { lengthIn: number; widthIn: number }>;
  /** Layout compromises (e.g. keep-out zone relaxed because the room is too small to honour it). */
  layoutWarnings?: string[];
  /** Design-level compromises: wall-unit coverage vs. oversize limit, VRF indoor / outdoor of different manufacturers ... */
  designWarnings?: string[];
  /** 'plenum': returns open into the ceiling void (one short return box per unit); 'ducted': return mains are routed. */
  returnStrategy?: ReturnStrategy;
  /** System type the design was made for ('vrf', 'ahu' ...). */
  systemType?: string;
  /** refrigerant: outdoor units; chilled-water: CHW stubs and no outdoor units; self-contained: neither. */
  plantConnection?: PlantConnection;
  /** Chilled-water supply / return stubs (feet), two per indoor unit; empty unless `plantConnection` is 'chilled-water'. */
  chwStubs?: ChwStub[];
  /** VRF: outdoor module model (the indoor model is `selectedOption.unitModel`). */
  outdoorModel?: string;
  /** ASHRAE 62.1 zone outdoor air Voz (CFM), limited to the supply airflow. */
  outdoorAirCfm?: number;
}

/** Terminal faces of the whole room as routing obstacles (ft). */
function terminalObstacles(terms: CoordinatedAirTerminal[], metric = false): TopoObstacle[] {
  return terms.map((t) => ({ id: t.id, rect: terminalFaceRectFt(t.position, t.faceDimension, metric) }));
}

/** Terminal-centre exclusion zones (ft): unit footprint + service clearance + half the largest face. */
function terminalKeepOuts(
  zones: EquipmentServiceZone[],
  dims: Record<string, { lengthIn: number; widthIn: number }>,
  level: 'service' | 'footprint' | 'none'
): Rect[] {
  if (level === 'none') return [];
  return zones.map((z) => {
    const d = dims[z.id];
    const base = level === 'service' ? unitKeepOutFt(z.equipmentPosition, d) : unitFootprintFt(z.equipmentPosition, d);
    return inflateRect(base, 1.0);
  });
}

/** Makes the last terminal absorb rounding so the group's CFM sums exactly to `total`. */
function fixCfmSum(terms: CoordinatedAirTerminal[], total: number): void {
  if (!terms.length) return;
  const sum = terms.reduce((a, t) => a + t.cfm, 0);
  terms[terms.length - 1].cfm += total - sum;
}

/** Spreads the zone return CFM evenly over its return grilles (sum exact). Position choice lives in returnPlacer. */
function spreadReturnCfm(returns: CoordinatedAirTerminal[], totalCfm: number): CoordinatedAirTerminal[] {
  const each = returns.length ? Math.round(totalCfm / returns.length) : 0;
  returns.forEach((t) => { t.cfm = each; });
  fixCfmSum(returns, totalCfm);
  return returns;
}

/** Default throw (ft, to 50 fpm terminal velocity) of a wall-mounted indoor unit when the catalog gives none. */
export const HIGH_WALL_DEFAULT_THROW_FT = 25;
/** Half-angle of the discharge cone of a wall-mounted unit (deg). */
export const HIGH_WALL_CONE_HALF_ANGLE_DEG = 45;

/** Installed wall-unit capacity never exceeds this multiple of the room load (more units only while they stay inside it). */
export const WALL_UNITS_MAX_CAPACITY_RATIO = 1.3;

/** Smallest distance (ft) from a wall of the convex `leg` to its farthest vertex: the throw a unit mounted on the best wall needs. */
function legMountDepthFt(leg: number[]): number {
  const n = Math.floor(leg.length / 2);
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const ax = leg[2 * i], ay = leg[2 * i + 1], bx = leg[2 * ((i + 1) % n)], by = leg[2 * ((i + 1) % n) + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    let far = 0;
    for (let j = 0; j < n; j++) far = Math.max(far, Math.abs((bx - ax) * (ay - leg[2 * j + 1]) - (ax - leg[2 * j]) * (by - ay)) / len);
    best = Math.min(best, far);
  }
  return Number.isFinite(best) ? best : 0;
}

/** Cuts a convex leg into `k` equal strips across its longer side. */
function splitConvexIntoStrips(leg: number[], k: number): number[][] {
  if (k <= 1) return [leg.slice()];
  const b = getPolygonBounds(leg);
  const alongX = b.width >= b.height;
  const out: number[][] = [];
  for (let i = 0; i < k; i++) {
    const rect = alongX
      ? { minX: b.minX + (b.width * i) / k, maxX: b.minX + (b.width * (i + 1)) / k, minY: b.minY - 1, maxY: b.maxY + 1 }
      : { minX: b.minX - 1, maxX: b.maxX + 1, minY: b.minY + (b.height * i) / k, maxY: b.minY + (b.height * (i + 1)) / k };
    const piece = clipPolygonToRect(leg, rect);
    if (piece.length >= 6) out.push(piece);
  }
  return out.length ? out : [leg.slice()];
}

/** Discharge direction of each placed wall unit. */
const blowDirOfZone = new WeakMap<EquipmentServiceZone, { x: number; y: number }>();

function throwFtOf(cand: MultiUnitCandidate): number {
  const t = (cand.equipmentDetails?.catalogItem as unknown as { throwT50Ft?: number } | undefined)?.throwT50Ft;
  return typeof t === 'number' && t > 0 ? t : HIGH_WALL_DEFAULT_THROW_FT;
}

/** Unit vector pointing from a wall-mounted unit into the room (from the wall line towards the unit). */
function blowDirectionOf(z: EquipmentServiceZone, wall: { x1: number; y1: number; x2: number; y2: number } | undefined): { x: number; y: number } {
  const side = z.equipmentPosition.wallSide;
  const byName: Record<string, { x: number; y: number }> = { east: { x: -1, y: 0 }, west: { x: 1, y: 0 }, north: { x: 0, y: 1 }, south: { x: 0, y: -1 } };
  if (wall) {
    const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1, len = Math.hypot(dx, dy);
    if (len > 1e-6) {
      const px = z.equipmentPosition.x - wall.x1, py = z.equipmentPosition.y - wall.y1;
      const t = (px * dx + py * dy) / (len * len);
      const nx = px - t * dx, ny = py - t * dy, nl = Math.hypot(nx, ny);
      if (nl > 1e-6) return { x: nx / nl, y: ny / nl };
    }
  }
  return byName[side ?? 'east'] ?? byName.east;
}

/** Points this close to a wall unit are reached by its entrainment / near-field spread whatever the cone angle (ft). */
const HIGH_WALL_NEAR_FIELD_FT = 10;

/** True when the wall unit at `p` blowing along `d` reaches (x, y): within the throw, inside the +-45 deg cone (or the near field), line of sight inside the room. */
function wallUnitReaches(p: { x: number; y: number }, d: { x: number; y: number }, x: number, y: number, poly: number[], throwFt: number): boolean {
  const cosMin = Math.cos((HIGH_WALL_CONE_HALF_ANGLE_DEG * Math.PI) / 180);
  const dx = x - p.x, dy = y - p.y, dist = Math.hypot(dx, dy);
  if (dist > throwFt) return false;
  if (dist > HIGH_WALL_NEAR_FIELD_FT && (dx * d.x + dy * d.y) / dist < cosMin - 1e-9) return false;
  if (dist > 1e-6 && (dx * d.x + dy * d.y) / dist < -1e-9) return false; // never behind the wall
  const n = Math.max(2, Math.ceil(dist / 1));
  for (let i = 1; i < n; i++) {
    if (!isPointInPolygon(p.x + (dx * i) / n, p.y + (dy * i) / n, poly)) return false;
  }
  return true;
}

/** 2 ft sample grid of the points of `region` (kept >= 0.5 ft off the walls of `room`). */
function samplePoints(region: number[], room: number[]): Array<{ x: number; y: number }> {
  const b = getPolygonBounds(region);
  const out: Array<{ x: number; y: number }> = [];
  for (let x = b.minX + 1; x < b.maxX; x += 2) {
    for (let y = b.minY + 1; y < b.maxY; y += 2) {
      if (isPointInPolygon(x, y, region) && distanceToPolygonEdge(x, y, room) >= 0.5) out.push({ x, y });
    }
  }
  return out;
}

/** Number of sample points of the room NOT reached by any wall unit's throw cone. */
function highWallUncoveredCount(poly: number[], zones: EquipmentServiceZone[], throwFt: number): number {
  const units = zones.map((z) => ({ p: z.equipmentPosition, d: blowDirOfZone.get(z) ?? blowDirectionOf(z, undefined) }));
  return samplePoints(poly, poly).filter((q) => !units.some((u) => wallUnitReaches(u.p, u.d, q.x, q.y, poly, throwFt))).length;
}

/**
 * Places each zone's wall-mounted indoor unit on a wall (back flush, footprint inside the room, units never overlapping on a
 * wall). Of the walls around the bay the one whose unit throws over most of the bay is taken (ties: the wall nearest the bay).
 */
function placeWallUnits(roomPolygon: number[], serviceZones: EquipmentServiceZone[], mountingWallSide: 'north' | 'south' | 'east' | 'west', throwFt = HIGH_WALL_DEFAULT_THROW_FT, confineToBay = false): void {
  const placedWall: Array<{ x: number; y: number }> = [];
  const nEdges = Math.floor(roomPolygon.length / 2);
  const settle = (near: { x: number; y: number }): ReturnType<typeof calculateWallMountedUnitPos> => {
    let w = calculateWallMountedUnitPos(roomPolygon, 1, { near, exteriorSide: mountingWallSide });
    for (let k = 1; k <= 12 && placedWall.some((q) => Math.hypot(w.x - q.x, w.y - q.y) < WALL_UNIT_DEFAULT_WIDTH_FT + 0.5); k++) {
      const len = Math.hypot(w.wall.x2 - w.wall.x1, w.wall.y2 - w.wall.y1) || 1;
      const tx = (w.wall.x2 - w.wall.x1) / len, ty = (w.wall.y2 - w.wall.y1) / len;
      const sh = Math.ceil(k / 2) * (WALL_UNIT_DEFAULT_WIDTH_FT + 0.5) * (k % 2 ? 1 : -1);
      w = calculateWallMountedUnitPos(roomPolygon, 1, { near: { x: near.x + tx * sh, y: near.y + ty * sh }, exteriorSide: mountingWallSide });
    }
    return w;
  };
  for (const z of serviceZones) {
    const base = { x: z.equipmentPosition.x, y: z.equipmentPosition.y };
    const samples = samplePoints(z.serviceAreaPolygon, roomPolygon);
    const candidates = [base];
    for (let i = 0; i < nEdges; i++) {
      const ax = roomPolygon[2 * i], ay = roomPolygon[2 * i + 1];
      const bx = roomPolygon[2 * ((i + 1) % nEdges)], by = roomPolygon[2 * ((i + 1) % nEdges) + 1];
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
      if (len2 < 1e-9) continue;
      const t = Math.max(0, Math.min(1, ((base.x - ax) * (bx - ax) + (base.y - ay) * (by - ay)) / len2));
      candidates.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
    }
    // Leg layouts: the unit sits behind its OWN leg (a wall touching the bay), preferably on an exterior wall.
    const roomB = getPolygonBounds(roomPolygon);
    const isExteriorWall = (wl: { x1: number; y1: number; x2: number; y2: number }): boolean =>
      (Math.abs(wl.x1 - wl.x2) < 0.05 && (Math.abs(wl.x1 - roomB.minX) < 0.05 || Math.abs(wl.x1 - roomB.maxX) < 0.05)) ||
      (Math.abs(wl.y1 - wl.y2) < 0.05 && (Math.abs(wl.y1 - roomB.minY) < 0.05 || Math.abs(wl.y1 - roomB.maxY) < 0.05));
    const inBay = (q: { x: number; y: number }): boolean =>
      isPointInPolygon(q.x, q.y, z.serviceAreaPolygon) || distanceToPolygonEdge(q.x, q.y, z.serviceAreaPolygon) <= 0.75;
    const scored: Array<{ w: ReturnType<typeof calculateWallMountedUnitPos>; score: number; ext: boolean }> = [];
    for (const c of candidates) {
      if (confineToBay && c !== base && !inBay(c)) continue;
      const w = settle(c);
      if (confineToBay && !inBay(w)) continue;
      const stub = { ...z, equipmentPosition: { ...z.equipmentPosition, x: w.x, y: w.y, wallSide: w.wallSide } } as EquipmentServiceZone;
      const d = blowDirectionOf(stub, w.wall);
      const score = samples.filter((q) => wallUnitReaches({ x: w.x, y: w.y }, d, q.x, q.y, roomPolygon, throwFt)).length;
      scored.push({ w, score, ext: isExteriorWall(w.wall) });
    }
    if (!scored.length) scored.push({ w: settle(base), score: 0, ext: false });
    const maxScore = Math.max(...scored.map((c) => c.score));
    let best: ReturnType<typeof calculateWallMountedUnitPos> | null = null;
    let bestScore = -1;
    for (const c of scored) {
      // an exterior wall (short refrigerant run behind the unit) wins over an interior one within 10% of the best coverage
      const eff = confineToBay && c.ext && c.score >= 0.9 * maxScore ? maxScore + 0.5 + c.score * 1e-6 : c.score;
      if (eff > bestScore) { bestScore = eff; best = c.w; }
    }
    const w = best!;
    placedWall.push({ x: w.x, y: w.y });
    z.equipmentPosition = { ...z.equipmentPosition, x: w.x, y: w.y, rotation: w.rotation, wallSide: w.wallSide };
    blowDirOfZone.set(z, blowDirectionOf(z, w.wall));
  }
}

export function executeAirDistributionDesign(input: AirDistributionDesignInput): AirDistributionDesignResult {
  const {
    roomName,
    roomPolygon: inputPolygon,
    roomAreaSqFt,
    sensibleLoadBtu,
    totalLoadBtu,
    requiredCfm,
    occupancyCount,
    systemType = 'concealed',
    standardsProfileType = 'ashrae',
    maxAvailableCeilingDepthIn = DEFAULT_VOID_IN,
    mountingWallSide: mountingWallSideIn = 'east',
    userOverrideUnitCount,
    exteriorWalls = [],
    scalePxPerUnit,
    units,
    spaceTypeId = 'office',
    ventilationEffectivenessEz,
    exhaustCfm: exhaustInput = 0
  } = input;
  let mountingWallSide = mountingWallSideIn;
  const isMetric = units === 'metric';
  const targetNc = input.targetNc ?? DEFAULT_SPACE_NC_TARGETS[spaceTypeId]?.nc ?? 30;
  const terminalCatalog = diffuserCatalogFor(units);

  // Boundary: canvas px -> ft. Engine internals are feet from here on.
  const hasScale = typeof scalePxPerUnit === 'number' && scalePxPerUnit > 0;
  const pxFt = hasScale ? pxPerFt(scalePxPerUnit as number, units as UnitSystem | undefined) : 1;
  const roomPolygon = hasScale ? polygonPxToFt(inputPolygon, scalePxPerUnit as number, units) : inputPolygon.slice();

  const profile = getStandardsProfile(standardsProfileType);

  // Phase 1 & 2: Multi-Unit Optimization
  const optimization = optimizeMultiUnitCandidates({
    roomName,
    sensibleLoadBtu,
    totalLoadBtu,
    requiredCfm,
    roomAreaSqFt,
    maxAvailableCeilingDepthIn,
    systemType,
    profile,
    units: isMetric ? 'metric' : 'imperial'
  });

  let chosenCandidate = optimization.recommendedOption;
  const allCandidates = optimization.candidates.slice();
  let overrideApplied = false;
  const overrideWarnings: string[] = [];
  if (userOverrideUnitCount !== undefined && userOverrideUnitCount !== null) {
    const n = userOverrideUnitCount;
    const impossible = !Number.isInteger(n) || n < 1 || n > MAX_UNIT_COUNT;
    const evaluated = impossible
      ? null
      : (optimization.candidates.find((c) => c.unitCount === n)
        ?? evaluateUnitCountOption(n, { roomName, sensibleLoadBtu, totalLoadBtu, requiredCfm, roomAreaSqFt, maxAvailableCeilingDepthIn, systemType, profile, units: isMetric ? 'metric' : 'imperial' }));
    if (!evaluated) {
      overrideWarnings.push(`Requested unit count ${n} is impossible (must be a whole number from 1 to ${MAX_UNIT_COUNT}); using the optimizer's choice of ${chosenCandidate.unitCount} unit(s).`);
    } else {
      chosenCandidate = evaluated;
      overrideApplied = true;
      if (!allCandidates.some((c) => c.unitCount === n)) allCandidates.push(evaluated);
      if (!evaluated.isValid) {
        const chk = evaluateSizing(evaluated.equipmentDetails.catalogItem, n, totalLoadBtu, sensibleLoadBtu, requiredCfm);
        const ratio = (evaluated.capacityRatio ?? chk.capacityRatio).toFixed(2);
        const tags = chk.failures.length ? chk.failures.join(', ') : 'SIZING';
        overrideWarnings.push(`User-selected ${n} unit(s) fails sizing rules: capacity ratio ${ratio} -> ${tags}`);
        for (const v of evaluated.violations ?? []) overrideWarnings.push(v);
      }
      for (const w of evaluated.warnings ?? []) overrideWarnings.push(w);
    }
  }

  // High-wall units throw a limited cone. L / T / U rooms get ONE unit per convex leg (more only when a leg's load exceeds the
  // largest unit or the wall-to-far-side depth exceeds the throw); each unit sits behind its own leg. Installed capacity stays
  // <= WALL_UNITS_MAX_CAPACITY_RATIO x the load: otherwise fewer units are used and the coverage gap is a design warning.
  let highWallUncovered = 0;
  const designWarnings: string[] = [];
  let wallBays: number[][] | null = null;
  const wallLegs = systemType === 'high-wall' && !overrideApplied ? decomposeConvex(roomPolygon) : [];
  if (wallLegs.length > 1) {
    const cands = (n: number): MultiUnitCandidate | null => optimization.candidates.find((c) => c.unitCount === n)
      ?? evaluateUnitCountOption(n, { roomName, sensibleLoadBtu, totalLoadBtu, requiredCfm, roomAreaSqFt, maxAvailableCeilingDepthIn, systemType, profile, units: isMetric ? 'metric' : 'imperial' });
    const throwFt = throwFtOf(chosenCandidate);
    const legAreas = wallLegs.map((l) => polygonAreaFt2(l));
    const areaSum = legAreas.reduce((a, b) => a + b, 0) || 1;
    const maxUnitBtu = Math.max(...eligibleItemsFor('high-wall').map((e) => e.totalCapacityBtuPerHour), 1);
    const need = wallLegs.map((leg, i) => Math.min(3, Math.max(
      1,
      Math.ceil(legMountDepthFt(leg) / throwFt - 1e-9),
      Math.ceil((totalLoadBtu * legAreas[i] / areaSum) / maxUnitBtu - 1e-9)
    )));
    const needed = Math.min(MAX_UNIT_COUNT, need.reduce((a, b) => a + b, 0));
    const base = chosenCandidate.unitCount;
    let n = Math.max(needed, Math.min(base, MAX_UNIT_COUNT));
    // fewer units until the whole set is a valid selection within the oversize limit
    for (; n > base; n--) {
      const c = cands(n);
      if (c && c.isValid && (c.capacityRatio ?? 1) <= WALL_UNITS_MAX_CAPACITY_RATIO + 1e-9) {
        chosenCandidate = c;
        if (!allCandidates.some((x) => x.unitCount === n)) allCandidates.push(c);
        break;
      }
    }
    const nUnits = chosenCandidate.unitCount;
    if (nUnits < needed) {
      designWarnings.push(`High-wall coverage: ${needed} wall unit(s) would be needed for ${wallLegs.length} legs / throw, but would exceed ${WALL_UNITS_MAX_CAPACITY_RATIO}x the ${Math.round(totalLoadBtu).toLocaleString('en-US')} Btu/h load - ${nUnits} unit(s) are used and part of the room is outside the unit throw`);
    }
    if (nUnits >= wallLegs.length) {
      const counts = need.map(() => 1);
      let left = nUnits - wallLegs.length;
      while (left > 0) {
        // extra units go to the legs that still need them, then to the leg with the largest area per unit
        let bi = 0, bs = -Infinity;
        counts.forEach((c, i) => {
          const sc = (c < need[i] ? 1e6 : 0) + legAreas[i] / c;
          if (sc > bs) { bs = sc; bi = i; }
        });
        counts[bi]++;
        left--;
      }
      wallBays = wallLegs.flatMap((leg, i) => splitConvexIntoStrips(leg, counts[i]));
    }
  } else if (systemType === 'high-wall' && !overrideApplied) {
    const alt: Record<string, 'north' | 'south' | 'east' | 'west'> = { east: 'north', west: 'north', north: 'east', south: 'east' };
    const probe = (cand: MultiUnitCandidate): { uncovered: number; side: 'north' | 'south' | 'east' | 'west' } => {
      let best: { uncovered: number; side: 'north' | 'south' | 'east' | 'west' } | null = null;
      // bays may be cut along either axis: take the cut whose units throw over more of the room
      for (const side of [mountingWallSideIn, alt[mountingWallSideIn]]) {
        const zs = partitionRoomIntoServiceZones({
          roomName, roomPolygon, unitCount: cand.unitCount, selectedModel: cand.unitModel,
          nominalTonnage: cand.nominalTonsPerUnit * cand.unitCount, totalCapacityBtu: cand.totalDeliveredCapacityBtu,
          totalSensibleBtu: sensibleLoadBtu, totalLatentBtu: totalLoadBtu - sensibleLoadBtu, totalSupplyCfm: cand.totalDeliveredCfm,
          totalOutdoorAirCfm: 0, availableEspInWg: cand.availableEspInWg, mountingWallSide: side, targetNc, maxAvailableCeilingDepthIn, exteriorWalls
        });
        placeWallUnits(roomPolygon, zs, side, throwFtOf(cand));
        const uncovered = highWallUncoveredCount(roomPolygon, zs, throwFtOf(cand));
        if (!best || uncovered < best.uncovered) best = { uncovered, side };
      }
      return best!;
    };
    const cur = probe(chosenCandidate);
    highWallUncovered = cur.uncovered;
    mountingWallSide = cur.side;
    const startN = chosenCandidate.unitCount;
    for (let n = startN + 1; n <= Math.min(MAX_UNIT_COUNT, startN + 6) && highWallUncovered > 0; n++) {
      const cand = optimization.candidates.find((c) => c.unitCount === n)
        ?? evaluateUnitCountOption(n, { roomName, sensibleLoadBtu, totalLoadBtu, requiredCfm, roomAreaSqFt, maxAvailableCeilingDepthIn, systemType, profile, units: isMetric ? 'metric' : 'imperial' });
      if (!cand) continue;
      const next = probe(cand);
      if (next.uncovered < highWallUncovered) {
        if ((cand.capacityRatio ?? 1) > WALL_UNITS_MAX_CAPACITY_RATIO + 1e-9) {
          designWarnings.push(`High-wall coverage: ${n} wall units would cover more of the room but exceed ${WALL_UNITS_MAX_CAPACITY_RATIO}x the load (capacity ratio ${Math.round((cand.capacityRatio ?? 1) * 100)}%) - ${chosenCandidate.unitCount} unit(s) are used`);
          break;
        }
        chosenCandidate = cand;
        if (!allCandidates.some((c) => c.unitCount === n)) allCandidates.push(cand);
        highWallUncovered = next.uncovered;
        mountingWallSide = next.side;
        if (!cand.isValid) overrideWarnings.push(`${n} wall units are needed for throw coverage; sizing: ${(cand.violations ?? []).join('; ')}`);
      }
    }
  }

  // Outdoor air: ASHRAE 62.1 VRP, Vbz = Rp*Pz + Ra*Az, Voz = Vbz/Ez (no arbitrary floor)
  const ventilation = calculateAshrae621Ventilation({
    areaSqFt: roomAreaSqFt,
    spaceTypeId,
    occupancyCount,
    ventilationEffectivenessEz
  });
  const totalSupplyCfm = chosenCandidate.totalDeliveredCfm;
  const totalOaCfm = Math.min(ventilation.vozCfm, Math.round(totalSupplyCfm));

  // Room mass balance: supply = return + exhaust + exfiltration; a positively pressurised space
  // exfiltrates whatever outdoor air the exhaust does not remove.
  const exhaustCfm = Math.max(0, Math.min(exhaustInput, totalSupplyCfm));
  const exfiltrationCfm = Math.max(0, Math.round(totalOaCfm - exhaustCfm));
  const totalReturnCfm = Math.max(0, Math.round(totalSupplyCfm - exhaustCfm - exfiltrationCfm));
  const massBalance: DesignMassBalance = {
    supplyCfm: Math.round(totalSupplyCfm),
    returnCfm: totalReturnCfm,
    exhaustCfm,
    exfiltrationCfm,
    outdoorAirCfm: totalOaCfm
  };

  // Service Zone Partitioning
  const serviceZoneInput = {
    roomName,
    roomPolygon,
    unitCount: chosenCandidate.unitCount,
    selectedModel: chosenCandidate.unitModel,
    nominalTonnage: chosenCandidate.nominalTonsPerUnit * chosenCandidate.unitCount,
    totalCapacityBtu: chosenCandidate.totalDeliveredCapacityBtu,
    totalSensibleBtu: sensibleLoadBtu,
    totalLatentBtu: totalLoadBtu - sensibleLoadBtu,
    totalSupplyCfm: chosenCandidate.totalDeliveredCfm,
    totalOutdoorAirCfm: totalOaCfm,
    availableEspInWg: chosenCandidate.availableEspInWg,
    mountingWallSide,
    targetNc,
    maxAvailableCeilingDepthIn,
    exteriorWalls
  };
  const serviceZones = wallBays && wallBays.length === chosenCandidate.unitCount
    ? partitionRoomIntoBays(serviceZoneInput, wallBays)
    : partitionRoomIntoServiceZones(serviceZoneInput);

  // Distribute the room return across bays in proportion to bay supply (sum is exact)
  {
    const sumSupply = serviceZones.reduce((a, z) => a + z.supplyCfm, 0) || 1;
    let left = totalReturnCfm;
    serviceZones.forEach((z, i) => {
      const r = i === serviceZones.length - 1 ? left : Math.round((totalReturnCfm * z.supplyCfm) / sumSupply);
      z.returnCfm = r;
      left -= r;
    });
  }

  // Phase 3 & 4: Terminal Placement per Bay
  const allSupplyTerminals: CoordinatedAirTerminal[] = [];
  const allReturnTerminals: CoordinatedAirTerminal[] = [];
  const allSupplyDucts: SteppedDuctSection[] = [];
  const allReturnDucts: SteppedDuctSection[] = [];

  // Wall-mounted indoor units (high-wall) sit ON a wall: back flush with the wall line, footprint inside the room and
  // inside the wall segment. Each bay's unit takes the wall nearest to the bay's centre; units never overlap on a wall.
  const wallMounted = systemType === 'high-wall';
  const legLayout = wallMounted && wallBays !== null && wallBays.length === serviceZones.length;
  if (wallMounted) {
    placeWallUnits(roomPolygon, serviceZones, mountingWallSide, throwFtOf(chosenCandidate), legLayout);
    if (legLayout) highWallUncovered = highWallUncoveredCount(roomPolygon, serviceZones, throwFtOf(chosenCandidate));
  }

  // Indoor unit footprints come from the selected catalog item (default ducted unit 40 x 24 in)
  const catDims = chosenCandidate.equipmentDetails?.catalogItem?.dimensionsIn;
  const unitDims: Record<string, { lengthIn: number; widthIn: number }> = {};
  for (const z of serviceZones) {
    unitDims[z.id] = wallMounted ? { ...WALL_UNIT_FOOTPRINT_IN } : catDims && catDims.width > 0 && catDims.depth > 0
      ? { lengthIn: Math.max(catDims.width, catDims.depth), widthIn: Math.min(catDims.width, catDims.depth) }
      : { lengthIn: DEFAULT_IDU_LENGTH_IN, widthIn: DEFAULT_IDU_WIDTH_IN };
  }
  const layoutWarnings: string[] = [];
  if (systemType === 'high-wall' && highWallUncovered > 0) {
    layoutWarnings.push(`High-wall throw: ${highWallUncovered} room sample point(s) lie outside the unit throw cone - add or relocate units`);
  }

  // Order: supply terminals (outside every unit's footprint + 2 ft service clearance) -> supply networks -> return grilles
  // (outside the units' keep-outs AND clear of the routed supply ducts) -> return networks. Each network avoids the
  // segments already routed; explicit data flow only.
  const supplyByZone = new Map<string, CoordinatedAirTerminal[]>();
  const returnByZone = new Map<string, CoordinatedAirTerminal[]>();
  for (const zone of serviceZones) {
    let supplyInZone: CoordinatedAirTerminal[] = [];
    for (const level of ['service', 'footprint', 'none'] as const) {
      supplyInZone = placeSupplyDiffusersForZone(zone, { targetCfmPerDiffuser: 350, optimizeThrow: true, keepOuts: terminalKeepOuts(serviceZones, unitDims, level), catalog: terminalCatalog, metric: isMetric });
      if (supplyInZone.length > 0) {
        if (level !== 'service') layoutWarnings.push(`${zone.unitTag}: ${level === 'footprint' ? 'unit service clearance' : 'unit keep-out'} relaxed - bay too small for the full keep-out zone`);
        break;
      }
    }
    supplyByZone.set(zone.id, supplyInZone);
    allSupplyTerminals.push(...supplyInZone);
  }

  const routeSupply = (obstacles: TopoObstacle[]): void => {
    allSupplyDucts.length = 0;
    const network: Seg2[] = [];
    for (const zone of serviceZones) {
      // Phase 5 & 6: Stepped Duct Network Routing & Sizing
      const raw = routeSteppedSupplyDucts(zone, supplyByZone.get(zone.id)!, profile, network, { obstacles, units });
      const sized = sizeDuctNetwork(raw, profile, maxDuctDepthForVoid(maxAvailableCeilingDepthIn), units);
      allSupplyDucts.push(...sized);
      network.push(...ductSegments(sized));
    }
  };
  routeSupply(terminalObstacles(allSupplyTerminals, isMetric));

  // Return grilles keep off the supply ducts: body + 0.5 ft edge clearance + the largest half face
  const supplyStrips = (): Rect[] => allSupplyDucts.map((d) =>
    inflateRect(ductBodyRect({ start: d.startPoint, end: d.endPoint }, Math.ceil((d.widthIn / 24 - 1e-6) * 4) / 4), DUCT_TERMINAL_CLEARANCE_FT + 1.0)); // half width on a 0.25 ft grid: 6" and 150 mm lay out alike
  const returnStrategy = resolveReturnStrategy({ systemType, returnStrategy: input.returnStrategy, ceilingPlenum: input.ceilingPlenum, maxAvailableCeilingDepthIn });
  const plenumReturn = returnStrategy === 'plenum';
  const roomBounds = getPolygonBounds(roomPolygon);
  const unitRoots = serviceZones.map((z) => ({ x: z.equipmentPosition.x, y: z.equipmentPosition.y }));
  /** Half plane beyond the unit in the direction its supply trunk leaves: return grilles belong on the OTHER side. */
  const supplySideRect = (zone: EquipmentServiceZone): Rect | null => {
    const eq = zone.equipmentPosition;
    const own = allSupplyDucts.find((d) => d.unitId === zone.id && Math.hypot(d.startPoint.x - eq.x, d.startPoint.y - eq.y) < 0.3);
    if (!own) return null;
    const dx = own.endPoint.x - own.startPoint.x, dy = own.endPoint.y - own.startPoint.y;
    const big = 1000;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { minX: eq.x, maxX: roomBounds.maxX + big, minY: -big, maxY: big + roomBounds.maxY } : { minX: roomBounds.minX - big, maxX: eq.x, minY: -big, maxY: big + roomBounds.maxY };
    return dy >= 0 ? { minX: -big, maxX: big + roomBounds.maxX, minY: eq.y, maxY: roomBounds.maxY + big } : { minX: -big, maxX: big + roomBounds.maxX, minY: roomBounds.minY - big, maxY: eq.y };
  };
  interface ReturnPlacement { ret: CoordinatedAirTerminal[]; level: 'service' | 'footprint' | 'none'; ducts: boolean }
  const placeReturnsFor = (zone: EquipmentServiceZone, extraKeepOut: Rect | null, maxCount?: number): ReturnPlacement | null => {
    const strips = supplyStrips();
    // plenum grilles keep >= 6 ft from EVERY supply diffuser of the room (short-circuit), ducted ones from their own bay's
    const sup = plenumReturn ? allSupplyTerminals : supplyByZone.get(zone.id)!;
    // a grille never sits under a supply duct while a layout with only a reduced service clearance exists
    // Plenum returns open into the (open) ceiling void, so before the keep-out around ANY indoor unit is relaxed (grille
    // >= 3 ft from the unit FOOTPRINT EDGE: 2 ft service + 1 ft) the grille may move out of its own, too small, bay.
    const attempts: Array<{ level: 'service' | 'footprint' | 'none'; ducts: boolean; room?: boolean }> = plenumReturn
      ? [
        { level: 'service', ducts: true }, { level: 'service', ducts: true, room: true },
        { level: 'service', ducts: false }, { level: 'service', ducts: false, room: true },
        { level: 'footprint', ducts: true }, { level: 'footprint', ducts: false }, { level: 'none', ducts: false }
      ]
      : [
        { level: 'service', ducts: true }, { level: 'footprint', ducts: true },
        { level: 'service', ducts: false }, { level: 'footprint', ducts: false }, { level: 'none', ducts: false }
      ];
    let fallback: ReturnPlacement | null = null;
    for (const at of attempts) {
      // in a normal room a separated layout at a stricter keep-out level beats a wall-clearance win at a more relaxed one (tiny rooms trade)
      if (fallback && at.level !== fallback.level && Math.min(roomBounds.width, roomBounds.height) >= 12) return fallback;
      const keepOuts = [...terminalKeepOuts(serviceZones, unitDims, at.level), ...(at.ducts ? strips : []), ...(extraKeepOut ? [extraKeepOut] : [])];
      const ret = spreadReturnCfm(placeReturnGrillesForZone(zone, sup, { keepOuts, catalog: terminalCatalog, metric: isMetric, maxCount, plenum: plenumReturn, wholeRoom: at.room }), zone.returnCfm);
      const separated = ret.every((r) => sup.every((q) => Math.hypot(r.position.x - q.position.x, r.position.y - q.position.y) >= MIN_TERMINAL_SPACING_FT - 1e-6));
      const wallOk = ret.every((r) => distanceToPolygonEdge(r.position.x, r.position.y, roomPolygon) >= 1 - 1e-6);
      const last = at === attempts[attempts.length - 1];
      // a layout that squeezes a grille closer than 4 ft to a supply is only accepted when nothing better exists
      if (ret.length > 0 && ((separated && wallOk) || (last && !fallback))) return { ret, level: at.level, ducts: at.ducts };
      if (ret.length > 0 && separated && !fallback) fallback = { ret, level: at.level, ducts: at.ducts };
    }
    if (fallback) return fallback;
    return null;
  };
  const routeReturnFor = (zone: EquipmentServiceZone, ret: CoordinatedAirTerminal[], avoid: Seg2[], extraTerms: CoordinatedAirTerminal[]): SteppedDuctSection[] => {
    const obstacles = terminalObstacles([...allSupplyTerminals, ...extraTerms, ...ret], isMetric);
    const raw = routeReturnDucts(zone, ret, profile, avoid, { obstacles, units });
    return sizeDuctNetwork(raw, profile, maxDuctDepthForVoid(maxAvailableCeilingDepthIn), units);
  };
  const crossingsOf = (sections: SteppedDuctSection[]): number =>
    countCrossings(ductSegments(sections), ductSegments(allSupplyDucts), unitRoots, 0.1, 0.02);

  let ductStripsRelaxed = false;
  const probedReturnSegs: Seg2[] = [];
  for (const zone of serviceZones) {
    let chosen = placeReturnsFor(zone, null);
    if (!plenumReturn && chosen) {
      // Ducted return: return grilles go on the side of the unit opposite the supply trunk, and the return main is only
      // accepted when it crosses the supply network at most once (otherwise try that side, then a single grille).
      const placedSoFar = [...allReturnTerminals];
      let bestSecs = routeReturnFor(zone, chosen.ret, [...ductSegments(allSupplyDucts), ...probedReturnSegs], placedSoFar);
      let bestX = crossingsOf(bestSecs);
      if (bestX > MAX_DUCTED_RETURN_CROSSINGS_PER_UNIT) {
        const side = supplySideRect(zone);
        const variants: Array<{ rect: Rect | null; max?: number }> = [
          ...(side ? [{ rect: side }, { rect: side, max: 1 }] : []), { rect: null, max: 1 }
        ];
        for (const v of variants) {
          const cand = placeReturnsFor(zone, v.rect, v.max);
          if (!cand) continue;
          const secs = routeReturnFor(zone, cand.ret, [...ductSegments(allSupplyDucts), ...probedReturnSegs], placedSoFar);
          const x = crossingsOf(secs);
          if (x < bestX) { bestX = x; chosen = cand; bestSecs = secs; }
          if (bestX <= MAX_DUCTED_RETURN_CROSSINGS_PER_UNIT) break;
        }
      }
      probedReturnSegs.push(...ductSegments(bestSecs));
    }
    if (!chosen) chosen = { ret: [], level: 'none', ducts: false };
    if (chosen.ret.length > 0) {
      if (!chosen.ducts) ductStripsRelaxed = true;
      if (chosen.level !== 'service' && !layoutWarnings.some((w) => w.startsWith(`${zone.unitTag}: unit`))) {
        layoutWarnings.push(`${zone.unitTag}: ${chosen.level === 'footprint' ? 'unit service clearance' : 'unit keep-out'} relaxed - bay too small for the full keep-out zone`);
      }
    }
    returnByZone.set(zone.id, chosen.ret);
    allReturnTerminals.push(...chosen.ret);
  }
  const routing = { obstacles: terminalObstacles([...allSupplyTerminals, ...allReturnTerminals], isMetric), units };
  // a return grille that could not keep off the supply ducts: re-route the supply networks around it
  if (ductStripsRelaxed) routeSupply(routing.obstacles);
  const supplyNetwork: Seg2[] = ductSegments(allSupplyDucts);

  const returnNetwork: Seg2[] = [];
  for (const zone of serviceZones) {
    if (plenumReturn) {
      // ceiling-plenum return: grilles open into the ceiling void, ONE short return box at the unit - no return main
      allReturnDucts.push(...routePlenumReturnBox(zone, returnByZone.get(zone.id)!, profile, allSupplyDucts, units));
      continue;
    }
    const rawReturnDucts = routeReturnDucts(zone, returnByZone.get(zone.id)!, profile, [...supplyNetwork, ...returnNetwork], routing);
    const sizedReturn = sizeDuctNetwork(rawReturnDucts, profile, maxDuctDepthForVoid(maxAvailableCeilingDepthIn), units);
    allReturnDucts.push(...sizedReturn);
    returnNetwork.push(...ductSegments(sizedReturn));
  }
  const crossovers = flagCrossovers(allSupplyDucts, allReturnDucts, serviceZones.map((z) => z.equipmentPosition));
  if (crossovers > 0) layoutWarnings.push(`${crossovers} supply / return crossover(s) could not be routed around - vertical offset required`);

  // Outdoor units: outside the room on an exterior wall (feet), >= 1 ft off the wall, never over another zone,
  // spaced >= 1 ft apart along that wall (34 x 13 in footprint)
  const others = (input.otherZonePolygons ?? []).map((p) => (hasScale ? polygonPxToFt(p, scalePxPerUnit as number, units) : p.slice()));
  const placedOdu: Pt2[][] = [];
  // Split systems: one outdoor unit per indoor unit. VRF: ONE outdoor module serves every indoor unit of the room.
  const isVrf = systemType === 'vrf';
  const oduGroups: EquipmentServiceZone[][] = isVrf && serviceZones.length > 0 ? [serviceZones] : serviceZones.map((z) => [z]);
  const outdoorUnitPositions = oduGroups.map((group) => {
    const near = {
      x: group.reduce((a, z) => a + z.equipmentPosition.x, 0) / group.length,
      y: group.reduce((a, z) => a + z.equipmentPosition.y, 0) / group.length
    };
    const p = calculateOutdoorUnitPlacement(roomPolygon, [], null, 1, {
      side: mountingWallSide,
      otherZonePolygons: others,
      placedFootprints: placedOdu,
      preferNear: near,
      // shortest refrigerant run: the exterior wall nearest to this unit's own indoor unit (still outside every zone)
      nearestWall: true,
      // leg layouts: the wall behind the unit's OWN leg
      ...(wallMounted && group.length === 1 ? { region: group[0].serviceAreaPolygon } : {})
    });
    const rad = ((p.angleDeg ?? 0) * Math.PI) / 180;
    const tx = Math.cos(rad), ty = Math.sin(rad);
    const L = p.lengthFt ?? 0, D = p.depthFt ?? 0;
    placedOdu.push([
      { x: p.x - tx * L / 2 + ty * D / 2, y: p.y - ty * L / 2 - tx * D / 2 },
      { x: p.x + tx * L / 2 + ty * D / 2, y: p.y + ty * L / 2 - tx * D / 2 },
      { x: p.x + tx * L / 2 - ty * D / 2, y: p.y + ty * L / 2 + tx * D / 2 },
      { x: p.x - tx * L / 2 - ty * D / 2, y: p.y - ty * L / 2 + tx * D / 2 }
    ]);
    return { x: p.x, y: p.y, wallSide: p.wallSide as string, angleDeg: p.angleDeg, lengthFt: p.lengthFt, depthFt: p.depthFt, wall: p.wall, serves: group.map((z) => z.id) };
  });
  const oduBase = outdoorUnitPositions[0]
    ? outdoorUnitPositions[0].wall
    : { x1: 0, y1: 0, x2: 0, y2: 0 };

  // Plant connection: only refrigerant systems have outdoor units. Chilled-water units get supply / return stubs on the
  // side facing the nearest exterior wall (shaft); self-contained units (RTU / packaged) have neither.
  const plantConnection = plantConnectionFor(systemType);
  const chwStubs: ChwStub[] = [];
  if (plantConnection === 'chilled-water') {
    serviceZones.forEach((z, i) => {
      const eq = z.equipmentPosition;
      const ref = outdoorUnitPositions[Math.min(i, outdoorUnitPositions.length - 1)] ?? outdoorUnitPositions[0];
      const dx = ref ? ref.x - eq.x : 1, dy = ref ? ref.y - eq.y : 0;
      const side: ChwStub['side'] = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'east' : 'west') : (dy >= 0 ? 'south' : 'north');
      const fp = unitFootprintFt(eq, unitDims[z.id]);
      const hx = (fp.maxX - fp.minX) / 2, hy = (fp.maxY - fp.minY) / 2;
      const ox = side === 'east' ? hx : side === 'west' ? -hx : 0;
      const oy = side === 'south' ? hy : side === 'north' ? -hy : 0;
      // supply and return stubs sit 0.5 ft either side of the unit axis, perpendicular to the exit direction
      const px = side === 'north' || side === 'south' ? 0.5 : 0, py = side === 'east' || side === 'west' ? 0.5 : 0;
      chwStubs.push({ unitIndex: i, x: parseFloat((eq.x + ox - px).toFixed(2)), y: parseFloat((eq.y + oy - py).toFixed(2)), side, kind: 'supply' });
      chwStubs.push({ unitIndex: i, x: parseFloat((eq.x + ox + px).toFixed(2)), y: parseFloat((eq.y + oy + py).toFixed(2)), side, kind: 'return' });
    });
  }

  // Phase 7: Dedicated Outdoor Air System (intake louver on the same exterior wall)
  const outdoorAirSystem = routeFreshAirDucts(serviceZones, totalOaCfm, {
    x: (oduBase.x1 + oduBase.x2) / 2,
    y: (oduBase.y1 + oduBase.y2) / 2
  });

  // Phase 8: Master 9-Point Validation
  const validationReport = executeMasterHvacValidation({
    roomName,
    roomPolygon,
    requiredRoomCfm: requiredCfm,
    designLoadBtu: totalLoadBtu,
    zones: serviceZones,
    terminals: [...allSupplyTerminals, ...allReturnTerminals],
    ducts: [...allSupplyDucts, ...allReturnDucts],
    outdoorAirSystem,
    profile,
    exhaustCfm,
    exfiltrationCfm,
    units
  });

  // Design Decision Log
  const decisionLog = generateDesignDecisionLog({
    roomName,
    units,
    requiredCfm,
    totalLoadBtu,
    selectedOption: chosenCandidate,
    allCandidates,
    validationSummary: {
      airflowStatus: validationReport.points[0].status,
      velocityStatus: validationReport.points[3].status,
      espStatus: validationReport.points[6].status,
      ncStatus: validationReport.points[4].status,
      spatialStatus: validationReport.points[8].status,
      notes: validationReport.points.filter((p) => p.status === 'WARNING').map((p) => p.message)
    }
  });

  return {
    roomName,
    standardsProfile: profile,
    selectedOption: chosenCandidate,
    overrideApplied,
    overrideWarnings,
    requiredCfm,
    allOptimizationCandidates: allCandidates,
    serviceZones,
    supplyTerminals: allSupplyTerminals,
    returnTerminals: allReturnTerminals,
    supplyDucts: allSupplyDucts,
    returnDucts: allReturnDucts,
    outdoorAirSystem,
    validationReport,
    designDecisionLog: decisionLog,
    timestamp: new Date().toISOString(),
    roomPolygonFt: roomPolygon,
    pxPerFt: pxFt,
    units: units === 'metric' ? 'metric' : 'imperial',
    ventilation,
    massBalance,
    outdoorUnitPositions: plantConnection === 'refrigerant' ? outdoorUnitPositions.map(({ wall: _wall, ...rest }) => rest) : [],
    unitFootprintsIn: unitDims,
    layoutWarnings,
    designWarnings: [...designWarnings, ...(chosenCandidate.designWarnings ?? [])],
    returnStrategy,
    systemType,
    plantConnection,
    chwStubs,
    outdoorModel: chosenCandidate.outdoorModel,
    outdoorAirCfm: totalOaCfm
  };
}

const isLockedTerminal = (t: CoordinatedAirTerminal): boolean => t.locked === true || t.designControlMode === 'user-locked';

/**
 * Lays a zone's terminals out around the user-locked ones: every locked terminal keeps its position and CFM, the
 * freshly placed positions nearest to each locked terminal (or closer than the minimum terminal spacing) are
 * dropped, and the remaining zone airflow is spread over the other terminals (sum exact).
 */
function layoutAroundLocked(
  fresh: CoordinatedAirTerminal[],
  locked: CoordinatedAirTerminal[],
  zoneCfm: number
): CoordinatedAirTerminal[] {
  if (locked.length === 0) return fresh;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
  let pool = fresh.slice();
  for (const l of locked) {
    if (pool.length === 0) break;
    let bi = 0;
    for (let i = 1; i < pool.length; i++) if (dist(pool[i].position, l.position) < dist(pool[bi].position, l.position)) bi = i;
    pool.splice(bi, 1);
  }
  pool = pool.filter((t) => locked.every((l) => dist(t.position, l.position) >= MIN_TERMINAL_SPACING_FT));
  if (pool.length > 0) {
    const remaining = Math.max(0, zoneCfm - locked.reduce((a, t) => a + t.cfm, 0));
    const each = Math.round(remaining / pool.length);
    pool.forEach((t) => { t.cfm = each; });
    fixCfmSum(pool, remaining);
  }
  return [...locked, ...pool];
}

/**
 * Executes Scoped Dependency Recalculation after a user modifies an equipment position or terminal.
 * Terminals with `locked: true` keep their position and airflow; the zone's other terminals are re-laid out around
 * them. Ducts of the zone are re-routed (avoiding the untouched zones' networks) and the result is validated against
 * the ROOM-REQUIRED airflow, not the airflow the units happen to deliver.
 */
export function recalculateScopedOverride(
  modifiedZoneId: string,
  currentDesign: AirDistributionDesignResult
): AirDistributionDesignResult {
  const updatedZones = [...currentDesign.serviceZones];
  const targetZone = updatedZones.find((z) => z.id === modifiedZoneId);
  if (!targetZone) return currentDesign;

  const lockedSupply = currentDesign.supplyTerminals.filter((t) => t.unitId === modifiedZoneId && isLockedTerminal(t));
  const lockedReturn = currentDesign.returnTerminals.filter((t) => t.unitId === modifiedZoneId && isLockedTerminal(t));

  // Re-run terminal placement for this modified zone around the user-locked terminals
  const newSupply = layoutAroundLocked(
    placeSupplyDiffusersForZone(targetZone, { optimizeThrow: true, catalog: diffuserCatalogFor(currentDesign.units), metric: currentDesign.units === 'metric' }),
    lockedSupply,
    targetZone.supplyCfm
  );
  const newReturn = layoutAroundLocked(
    spreadReturnCfm(placeReturnGrillesForZone(targetZone, newSupply, { catalog: diffuserCatalogFor(currentDesign.units), metric: currentDesign.units === 'metric', plenum: currentDesign.returnStrategy === 'plenum' }), targetZone.returnCfm),
    lockedReturn,
    targetZone.returnCfm
  );

  // Filter out old terminals for this zone and insert newly recalculated ones
  const filteredSupply = currentDesign.supplyTerminals.filter((t) => t.unitId !== modifiedZoneId);
  const filteredReturn = currentDesign.returnTerminals.filter((t) => t.unitId !== modifiedZoneId);

  const mergedSupply = [...filteredSupply, ...newSupply];
  const mergedReturn = [...filteredReturn, ...newReturn];

  const otherSupplyDucts = currentDesign.supplyDucts.filter((d) => d.unitId !== modifiedZoneId);
  const otherReturnDucts = currentDesign.returnDucts.filter((d) => d.unitId !== modifiedZoneId);
  const othersNetwork = [...ductSegments(otherSupplyDucts), ...ductSegments(otherReturnDucts)];

  // Re-route and resize supply and return ducts for this zone
  const rawSupply = routeSteppedSupplyDucts(targetZone, newSupply, currentDesign.standardsProfile, othersNetwork);
  const sizedSupply = sizeDuctNetwork(rawSupply, currentDesign.standardsProfile, maxDuctDepthForVoid(targetZone.maxAvailableCeilingDepthIn ?? DEFAULT_VOID_IN), currentDesign.units);

  const sizedReturn = currentDesign.returnStrategy === 'plenum'
    ? routePlenumReturnBox(targetZone, newReturn, currentDesign.standardsProfile, [...otherSupplyDucts, ...sizedSupply], currentDesign.units)
    : sizeDuctNetwork(
      routeReturnDucts(targetZone, newReturn, currentDesign.standardsProfile, [...othersNetwork, ...ductSegments(sizedSupply)]),
      currentDesign.standardsProfile, maxDuctDepthForVoid(targetZone.maxAvailableCeilingDepthIn ?? DEFAULT_VOID_IN), currentDesign.units
    );

  const mergedSupplyDucts = [...otherSupplyDucts, ...sizedSupply];
  const mergedReturnDucts = [...otherReturnDucts, ...sizedReturn];

  // Re-run validation against the room-required airflow
  const requiredRoomCfm = currentDesign.requiredCfm ?? updatedZones.reduce((a, z) => a + z.supplyCfm, 0);
  const validationReport = executeMasterHvacValidation({
    roomName: currentDesign.roomName,
    roomPolygon: currentDesign.roomPolygonFt?.length ? currentDesign.roomPolygonFt : targetZone.serviceAreaPolygon,
    requiredRoomCfm,
    designLoadBtu: updatedZones.reduce((a, z) => a + z.totalLoadBtu, 0),
    zones: updatedZones,
    terminals: [...mergedSupply, ...mergedReturn],
    ducts: [...mergedSupplyDucts, ...mergedReturnDucts],
    outdoorAirSystem: currentDesign.outdoorAirSystem,
    profile: currentDesign.standardsProfile,
    exhaustCfm: currentDesign.massBalance?.exhaustCfm,
    exfiltrationCfm: currentDesign.massBalance?.exfiltrationCfm,
    units: currentDesign.units
  });

  return {
    ...currentDesign,
    serviceZones: updatedZones,
    supplyTerminals: mergedSupply,
    returnTerminals: mergedReturn,
    supplyDucts: mergedSupplyDucts,
    returnDucts: mergedReturnDucts,
    validationReport,
    timestamp: new Date().toISOString()
  };
}

export interface ZonePayloadDiffuser {
  id: string;
  x: number;
  y: number;
  cfm: number;
  size: string;
  type: 'supply' | 'return';
  throwT50Ft: number;
  actualNc: number;
  deltaPInWg: number;
  /** Indoor unit (service zone) this terminal belongs to - Sum of a unit's supply terminals == its CFM. */
  unitId: string;
  serviceZoneId: string;
  unitTag: string;
  /** Face size in inches (exact) for drawing, whatever the label unit. */
  faceWidthIn: number;
  faceHeightIn: number;
  /** Return grille that opens into the ceiling plenum (no duct is routed to it). */
  plenumReturn?: boolean;
  /** 'plenum' on a plenum-return grille: no association line to the unit is drawn. */
  returnPath?: 'plenum';
}

export interface ZonePayloadServiceZone {
  id: string;
  /** Engine service-zone id (sz-N) when `id` has been re-keyed to the canvas unit ref. */
  engineId?: string;
  unitTag: string;
  /** Supply / return CFM of this indoor unit (== sum of its terminals). */
  supplyCfm: number;
  returnCfm: number;
  capacityBtu: number;
  /** Service area outline (canvas px). */
  polygon: number[];
  /** Indoor unit centre (canvas px). */
  unitPos: { x: number; y: number };
  /** Index into `outdoorUnitPositions` of the outdoor unit serving this indoor unit. */
  outdoorUnitIndex: number;
  /** Indoor unit plan footprint in inches (long x short side). */
  footprintIn?: { lengthIn: number; widthIn: number };
  supplyTerminalIds: string[];
  returnTerminalIds: string[];
}

export interface ZonePayloadDuct {
  id: string;
  type: 'trunk' | 'branch' | 'return';
  points: number[];
  widthIn: number;
  heightIn: number;
  cfm: number;
  sizeLabel: string;
  velocityFpm: number;
  /** Indoor unit (service zone) whose network this duct belongs to. */
  unitId?: string;
  serviceZoneId?: string;
  /** Unavoidable supply / return plan crossing: needs a vertical offset against `crossoverWith`. */
  crossover?: boolean;
  crossoverWith?: string[];
  /** The clearance rule this duct still breaks when no clean layout exists in the room. */
  clearanceIssue?: string;
  designWarnings?: string[];
  /** Short return box at the unit of a ceiling-plenum return (no return main). */
  plenumBox?: boolean;
}

export interface ZonePayload {
  diffusers: ZonePayloadDiffuser[];
  ducts: ZonePayloadDuct[];
  unitPos: { x: number; y: number };
  unitPositions: { x: number; y: number }[];
  outdoorUnitPos: { x: number; y: number };
  outdoorUnitPositions: { x: number; y: number }[];
  serviceZonePolygons: number[][];
  /** One entry per indoor unit: its CFM, polygon, terminal ids and serving outdoor unit. */
  unitServiceZones: ZonePayloadServiceZone[];
  /** Outdoor unit footprints (canvas px length/depth, rotation) parallel to `outdoorUnitPositions`. */
  outdoorUnitDetails: Array<{ x: number; y: number; angleDeg: number; lengthPx: number; depthPx: number; wallSide: string; serves: string[] }>;
  catalogQty: number;
  catalogModel: string;
  catalogEsp: string;
  /** 'plenum': return grilles open into the ceiling void, one short return box per unit; 'ducted': return mains routed. */
  returnStrategy: ReturnStrategy;
  /** 'plenum' when the returns open into the ceiling void (draw no per-grille association lines); 'ducted' otherwise. */
  returnPath: 'plenum' | 'ducted';
  /** System type label of the design ('vrf', 'ahu', ...). */
  systemType: string;
  /** 'refrigerant': outdoor units; 'chilled-water': `chwStubs` and no outdoor units; 'self-contained': neither. */
  plantConnection: PlantConnection;
  /** Chilled-water supply / return stub endpoints (canvas px) at the indoor units; empty unless chilled-water. */
  chwStubs: ChwStub[];
  /** VRF: the outdoor module model; `catalogModel` is then the indoor unit model. */
  outdoorModel?: string;
  /** ASHRAE 62.1 zone outdoor air Voz (CFM) for the fresh-air callout. */
  outdoorAirCfm: number;
  /** Tags of the indoor units in unitPositions order (['FCU-01', 'FCU-02']) - sections / inspector show these instead of raw zone ids. */
  unitTags: string[];
  /** Design-level compromises (see AirDistributionDesignResult.designWarnings). */
  designWarnings: string[];
}

/**
 * Converts the (feet) design result to the store payload in canvas px (design.pxPerFt px per ft).
 */
export function convertDesignResultToZonePayload(design: AirDistributionDesignResult): ZonePayload {
  const k = design.pxPerFt && design.pxPerFt > 0 ? design.pxPerFt : 1;
  const px = (v: number): number => v * k; // exact: px === ft x k (no geometry rounding)
  const ductLabel = (w: number, h: number): string => {
    if (design.units !== 'metric') return `${w}"x${h}"`;
    const mm = (v: number): number => Math.round((v * MM_PER_IN) / 50) * 50;
    return `${mm(w)}x${mm(h)}`;
  };
  const pt = (p: { x: number; y: number }): { x: number; y: number; } => ({ x: px(p.x), y: px(p.y) });
  const metric = design.units === 'metric';
  const tagOf = new Map(design.serviceZones.map((z) => [z.id, z.unitTag]));
  const faceIn = (face: string | undefined): { faceWidthIn: number; faceHeightIn: number } => {
    const f = parseFaceIn(face, metric);
    return { faceWidthIn: f.w, faceHeightIn: f.h };
  };

  const diffusers = [
    ...design.supplyTerminals.map((t) => ({
      id: t.id,
      ...pt(t.position),
      cfm: t.cfm,
      size: t.faceDimension || '12"x12"',
      type: 'supply' as const,
      throwT50Ft: t.throwT50Ft || 12,
      actualNc: t.ncRating || 25,
      deltaPInWg: t.deltaPInWg || 0.05,
      unitId: t.unitId,
      serviceZoneId: t.unitId,
      unitTag: tagOf.get(t.unitId) ?? t.unitId,
      ...faceIn(t.faceDimension)
    })),
    ...design.returnTerminals.map((t) => ({
      id: t.id,
      ...pt(t.position),
      cfm: t.cfm,
      size: t.faceDimension || '24"x12"',
      type: 'return' as const,
      throwT50Ft: t.throwT50Ft || 10,
      actualNc: t.ncRating || 25,
      deltaPInWg: t.deltaPInWg || 0.04,
      unitId: t.unitId,
      serviceZoneId: t.unitId,
      unitTag: tagOf.get(t.unitId) ?? t.unitId,
      ...faceIn(t.faceDimension),
      ...(design.returnStrategy === 'plenum' ? { plenumReturn: true, returnPath: 'plenum' as const } : {})
    }))
  ];

  /** Crossover / clearance / warning flags travel with the duct to the store (only set fields are copied). */
  const flagFields = (d: SteppedDuctSection): Pick<ZonePayloadDuct, 'crossover' | 'crossoverWith' | 'clearanceIssue' | 'designWarnings' | 'plenumBox'> => ({
    ...(d.crossover ? { crossover: true } : {}),
    ...(d.crossoverWith?.length ? { crossoverWith: [...d.crossoverWith] } : {}),
    ...(d.clearanceIssue ? { clearanceIssue: d.clearanceIssue } : {}),
    ...(d.designWarnings?.length ? { designWarnings: [...d.designWarnings] } : {}),
    ...(d.plenumBox ? { plenumBox: true } : {})
  });
  const ductPts = (d: { startPoint: { x: number; y: number }; endPoint: { x: number; y: number } }): number[] =>
    [px(d.startPoint.x), px(d.startPoint.y), px(d.endPoint.x), px(d.endPoint.y)];
  const ducts = [
    ...design.supplyDucts.map((d) => ({
      id: d.id,
      type: (d.role === 'main-trunk' ? 'trunk' : 'branch') as 'trunk' | 'branch',
      points: ductPts(d),
      widthIn: d.widthIn,
      heightIn: d.heightIn,
      cfm: d.airflowCfm,
      sizeLabel: ductLabel(d.widthIn, d.heightIn),
      velocityFpm: d.velocityFpm,
      unitId: d.unitId,
      serviceZoneId: d.unitId,
      ...flagFields(d)
    })),
    ...design.returnDucts.map((d) => ({
      id: d.id,
      type: 'return' as const,
      points: ductPts(d),
      widthIn: d.widthIn,
      heightIn: d.heightIn,
      cfm: d.airflowCfm,
      sizeLabel: ductLabel(d.widthIn, d.heightIn),
      velocityFpm: d.velocityFpm,
      unitId: d.unitId,
      serviceZoneId: d.unitId,
      ...flagFields(d)
    }))
  ];

  const unitPos = pt(design.serviceZones[0]?.equipmentPosition || { x: 25, y: 15 });
  const unitPositions = design.serviceZones.map((sz) => pt(sz.equipmentPosition));
  const oduFt = design.outdoorUnitPositions?.length || (design.plantConnection && design.plantConnection !== 'refrigerant')
    ? (design.outdoorUnitPositions ?? [])
    : design.serviceZones.map((sz) => ({ x: sz.equipmentPosition.x, y: sz.equipmentPosition.y }));
  const outdoorUnitPositions = oduFt.map(pt);
  const oduIndexOf = (zoneId: string, i: number): number => {
    const idx = design.outdoorUnitPositions?.findIndex((o) => o.serves?.includes(zoneId)) ?? -1;
    return idx >= 0 ? idx : outdoorUnitPositions.length === 0 ? -1 : Math.min(i, outdoorUnitPositions.length - 1);
  };
  const unitServiceZones: ZonePayloadServiceZone[] = design.serviceZones.map((sz, i) => ({
    id: sz.id,
    unitTag: sz.unitTag,
    supplyCfm: design.supplyTerminals.filter((t) => t.unitId === sz.id).reduce((a, t) => a + t.cfm, 0),
    returnCfm: design.returnTerminals.filter((t) => t.unitId === sz.id).reduce((a, t) => a + t.cfm, 0),
    capacityBtu: sz.actualCapacityBtu,
    polygon: sz.serviceAreaPolygon.map(px),
    unitPos: pt(sz.equipmentPosition),
    outdoorUnitIndex: oduIndexOf(sz.id, i),
    footprintIn: design.unitFootprintsIn?.[sz.id],
    supplyTerminalIds: design.supplyTerminals.filter((t) => t.unitId === sz.id).map((t) => t.id),
    returnTerminalIds: design.returnTerminals.filter((t) => t.unitId === sz.id).map((t) => t.id)
  }));
  const outdoorUnitDetails = (design.outdoorUnitPositions ?? []).map((o, i) => ({
    ...(outdoorUnitPositions[i] ?? pt(o)),
    angleDeg: o.angleDeg ?? 0,
    lengthPx: px(o.lengthFt ?? 0),
    depthPx: px(o.depthFt ?? 0),
    wallSide: o.wallSide,
    serves: o.serves ?? []
  }));

  return {
    diffusers,
    ducts,
    unitPos,
    unitPositions,
    outdoorUnitPos: outdoorUnitPositions[0] || { x: unitPos.x, y: unitPos.y },
    outdoorUnitPositions,
    serviceZonePolygons: design.serviceZones.map((sz) => sz.serviceAreaPolygon.map(px)),
    unitServiceZones,
    outdoorUnitDetails,
    catalogQty: design.selectedOption.unitCount,
    catalogModel: design.selectedOption.unitModel,
    catalogEsp: `${design.selectedOption.availableEspInWg} in.wg`,
    returnStrategy: design.returnStrategy ?? 'ducted',
    returnPath: design.returnStrategy === 'plenum' ? 'plenum' : 'ducted',
    systemType: design.systemType ?? 'concealed',
    plantConnection: design.plantConnection ?? 'refrigerant',
    chwStubs: (design.chwStubs ?? []).map((c) => ({ ...c, ...pt(c) })),
    ...(design.outdoorModel ? { outdoorModel: design.outdoorModel } : {}),
    outdoorAirCfm: design.outdoorAirCfm ?? design.massBalance?.outdoorAirCfm ?? 0,
    unitTags: design.serviceZones.map((z) => z.unitTag),
    designWarnings: [...(design.designWarnings ?? [])]
  };
}
