import { StandardsProfile, getStandardsProfile } from './standards/designStandards';
import { optimizeMultiUnitCandidates, evaluateUnitCountOption, MultiUnitCandidate } from './systemArchitecture/equipmentOptimizer';
import { evaluateSizing, MAX_UNIT_COUNT } from './systemArchitecture/equipmentSelector';
import { generateDesignDecisionLog } from './systemArchitecture/designDecisionLogger';
import { partitionRoomIntoServiceZones, EquipmentServiceZone } from './zoning/zonePartitioner';
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
import { calculateOutdoorUnitPlacement, calculateWallMountedUnitPos, getPolygonBounds, distanceToPolygonEdge, MIN_TERMINAL_SPACING_FT, WALL_UNIT_DEFAULT_WIDTH_FT, Pt2 } from './geometry';
import { executeMasterHvacValidation, MasterValidationReport } from './validation/hvacValidator';
import { diffuserCatalogFor } from './hvacCatalogs';
import { DEFAULT_SPACE_NC_TARGETS } from './acousticDuctEngine';

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
  const plenum = input.ceilingPlenum ?? (input.maxAvailableCeilingDepthIn ?? 14) >= MIN_PLENUM_DEPTH_IN;
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
  /** 'plenum': returns open into the ceiling void (one short return box per unit); 'ducted': return mains are routed. */
  returnStrategy?: ReturnStrategy;
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
    maxAvailableCeilingDepthIn = 14,
    mountingWallSide = 'east',
    userOverrideUnitCount,
    exteriorWalls = [],
    scalePxPerUnit,
    units,
    spaceTypeId = 'office',
    ventilationEffectivenessEz,
    exhaustCfm: exhaustInput = 0
  } = input;
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
    profile
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
        ?? evaluateUnitCountOption(n, { roomName, sensibleLoadBtu, totalLoadBtu, requiredCfm, roomAreaSqFt, maxAvailableCeilingDepthIn, systemType, profile }));
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
  const serviceZones = partitionRoomIntoServiceZones({
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
  });

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
  if (wallMounted) {
    const placedWall: Array<{ x: number; y: number }> = [];
    for (const z of serviceZones) {
      const near = { x: z.equipmentPosition.x, y: z.equipmentPosition.y };
      let w = calculateWallMountedUnitPos(roomPolygon, 1, { near, exteriorSide: mountingWallSide });
      for (let k = 1; k <= 12 && placedWall.some((q) => Math.hypot(w.x - q.x, w.y - q.y) < WALL_UNIT_DEFAULT_WIDTH_FT + 0.5); k++) {
        const len = Math.hypot(w.wall.x2 - w.wall.x1, w.wall.y2 - w.wall.y1) || 1;
        const tx = (w.wall.x2 - w.wall.x1) / len, ty = (w.wall.y2 - w.wall.y1) / len;
        const sh = Math.ceil(k / 2) * (WALL_UNIT_DEFAULT_WIDTH_FT + 0.5) * (k % 2 ? 1 : -1);
        w = calculateWallMountedUnitPos(roomPolygon, 1, { near: { x: near.x + tx * sh, y: near.y + ty * sh }, exteriorSide: mountingWallSide });
      }
      placedWall.push({ x: w.x, y: w.y });
      z.equipmentPosition = { ...z.equipmentPosition, x: w.x, y: w.y, rotation: w.rotation, wallSide: w.wallSide };
    }
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
      const sized = sizeDuctNetwork(raw, profile, maxAvailableCeilingDepthIn, units);
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
    const sup = supplyByZone.get(zone.id)!;
    // a grille never sits under a supply duct while a layout with only a reduced service clearance exists
    const attempts: Array<{ level: 'service' | 'footprint' | 'none'; ducts: boolean }> = [
      { level: 'service', ducts: true }, { level: 'footprint', ducts: true },
      { level: 'service', ducts: false }, { level: 'footprint', ducts: false }, { level: 'none', ducts: false }
    ];
    let fallback: ReturnPlacement | null = null;
    for (const at of attempts) {
      // in a normal room a separated layout at a stricter keep-out level beats a wall-clearance win at a more relaxed one (tiny rooms trade)
      if (fallback && at.level !== fallback.level && Math.min(roomBounds.width, roomBounds.height) >= 12) return fallback;
      const keepOuts = [...terminalKeepOuts(serviceZones, unitDims, at.level), ...(at.ducts ? strips : []), ...(extraKeepOut ? [extraKeepOut] : [])];
      const ret = spreadReturnCfm(placeReturnGrillesForZone(zone, sup, { keepOuts, catalog: terminalCatalog, metric: isMetric, maxCount }), zone.returnCfm);
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
    return sizeDuctNetwork(raw, profile, maxAvailableCeilingDepthIn, units);
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
    const sizedReturn = sizeDuctNetwork(rawReturnDucts, profile, maxAvailableCeilingDepthIn, units);
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
      nearestWall: true
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
    outdoorUnitPositions: outdoorUnitPositions.map(({ wall: _wall, ...rest }) => rest),
    unitFootprintsIn: unitDims,
    layoutWarnings,
    returnStrategy
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
    spreadReturnCfm(placeReturnGrillesForZone(targetZone, newSupply, { catalog: diffuserCatalogFor(currentDesign.units), metric: currentDesign.units === 'metric' }), targetZone.returnCfm),
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
  const sizedSupply = sizeDuctNetwork(rawSupply, currentDesign.standardsProfile, targetZone.maxAvailableCeilingDepthIn, currentDesign.units);

  const sizedReturn = currentDesign.returnStrategy === 'plenum'
    ? routePlenumReturnBox(targetZone, newReturn, currentDesign.standardsProfile, [...otherSupplyDucts, ...sizedSupply], currentDesign.units)
    : sizeDuctNetwork(
      routeReturnDucts(targetZone, newReturn, currentDesign.standardsProfile, [...othersNetwork, ...ductSegments(sizedSupply)]),
      currentDesign.standardsProfile, targetZone.maxAvailableCeilingDepthIn, currentDesign.units
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
      ...(design.returnStrategy === 'plenum' ? { plenumReturn: true } : {})
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
  const oduFt = design.outdoorUnitPositions?.length
    ? design.outdoorUnitPositions
    : design.serviceZones.map((sz) => ({ x: sz.equipmentPosition.x, y: sz.equipmentPosition.y }));
  const outdoorUnitPositions = oduFt.map(pt);
  const oduIndexOf = (zoneId: string, i: number): number => {
    const idx = design.outdoorUnitPositions?.findIndex((o) => o.serves?.includes(zoneId)) ?? -1;
    return idx >= 0 ? idx : Math.min(i, Math.max(0, outdoorUnitPositions.length - 1));
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
    returnStrategy: design.returnStrategy ?? 'ducted'
  };
}
