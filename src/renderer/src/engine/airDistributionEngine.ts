import { StandardsProfile, getStandardsProfile } from './standards/designStandards';
import { optimizeMultiUnitCandidates, evaluateUnitCountOption, MultiUnitCandidate } from './systemArchitecture/equipmentOptimizer';
import { evaluateSizing, MAX_UNIT_COUNT } from './systemArchitecture/equipmentSelector';
import { generateDesignDecisionLog } from './systemArchitecture/designDecisionLogger';
import { partitionRoomIntoServiceZones, EquipmentServiceZone } from './zoning/zonePartitioner';
import { placeSupplyDiffusersForZone, CoordinatedAirTerminal } from './terminals/terminalPlacer';
import { placeReturnGrillesForZone } from './terminals/returnPlacer';
import { routeSteppedSupplyDucts, ductSegments, SteppedDuctSection } from './ducts/steppedDuctRouter';
import type { Seg2 } from './ducts/orthogonalTopology';
import { routeReturnDucts } from './ducts/returnDuctRouter';
import { sizeDuctNetwork } from './ducts/aerodynamicDuctSizer';
import { routeFreshAirDucts, OutdoorAirSystem } from './outdoorAir/freshAirRouter';
import { calculateAshrae621Ventilation, Ashrae621Result } from './outdoorAir/outdoorAirCalculator';
import { polygonPxToFt, pxPerFt, UnitSystem, MM_PER_IN } from './units';
import { calculateOutdoorUnitPlacement, isPointInPolygon, MIN_TERMINAL_SPACING_FT } from './geometry';
import { executeMasterHvacValidation, MasterValidationReport } from './validation/hvacValidator';

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
  /** Outdoor unit centre per service zone, in FEET, outside the room on an exterior wall. */
  outdoorUnitPositions: Array<{ x: number; y: number; wallSide: string }>;
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
    targetNc: 30,
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

  // Terminals first, then ALL supply networks (each avoiding the segments already routed), then the return
  // networks (each avoiding every supply segment plus the returns routed before it). Explicit data flow only.
  const supplyByZone = new Map<string, CoordinatedAirTerminal[]>();
  const returnByZone = new Map<string, CoordinatedAirTerminal[]>();
  for (const zone of serviceZones) {
    const supplyInZone = placeSupplyDiffusersForZone(zone, { targetCfmPerDiffuser: 350, optimizeThrow: true });
    const returnInZone = spreadReturnCfm(placeReturnGrillesForZone(zone, supplyInZone), zone.returnCfm);
    supplyByZone.set(zone.id, supplyInZone);
    returnByZone.set(zone.id, returnInZone);
    allSupplyTerminals.push(...supplyInZone);
    allReturnTerminals.push(...returnInZone);
  }

  const supplyNetwork: Seg2[] = [];
  for (const zone of serviceZones) {
    // Phase 5 & 6: Stepped Duct Network Routing & Sizing
    const rawSupplyDucts = routeSteppedSupplyDucts(zone, supplyByZone.get(zone.id)!, profile, supplyNetwork);
    const sizedSupply = sizeDuctNetwork(rawSupplyDucts, profile, maxAvailableCeilingDepthIn, units);
    allSupplyDucts.push(...sizedSupply);
    supplyNetwork.push(...ductSegments(sizedSupply));
  }

  const returnNetwork: Seg2[] = [];
  for (const zone of serviceZones) {
    const rawReturnDucts = routeReturnDucts(zone, returnByZone.get(zone.id)!, profile, [...supplyNetwork, ...returnNetwork]);
    const sizedReturn = sizeDuctNetwork(rawReturnDucts, profile, maxAvailableCeilingDepthIn, units);
    allReturnDucts.push(...sizedReturn);
    returnNetwork.push(...ductSegments(sizedReturn));
  }

  // Outdoor units: outside the room on an exterior wall (feet), spaced along that wall
  const oduBase = calculateOutdoorUnitPlacement(roomPolygon, [], null, 1, { side: mountingWallSide });
  const alongX = oduBase.wallSide === 'north' || oduBase.wallSide === 'south';
  const outdoorUnitPositions = serviceZones.map((_, idx) => {
    const off = (idx - (serviceZones.length - 1) / 2) * 4;
    const p = { x: oduBase.x + (alongX ? off : 0), y: oduBase.y + (alongX ? 0 : off) };
    const ok = !isPointInPolygon(p.x, p.y, roomPolygon);
    return { x: ok ? p.x : oduBase.x, y: ok ? p.y : oduBase.y, wallSide: oduBase.wallSide };
  });

  // Phase 7: Dedicated Outdoor Air System (intake louver on the same exterior wall)
  const outdoorAirSystem = routeFreshAirDucts(serviceZones, totalOaCfm, {
    x: (oduBase.wall.x1 + oduBase.wall.x2) / 2,
    y: (oduBase.wall.y1 + oduBase.wall.y2) / 2
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
    exfiltrationCfm
  });

  // Design Decision Log
  const decisionLog = generateDesignDecisionLog({
    roomName,
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
    outdoorUnitPositions
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
    placeSupplyDiffusersForZone(targetZone, { optimizeThrow: true }),
    lockedSupply,
    targetZone.supplyCfm
  );
  const newReturn = layoutAroundLocked(
    spreadReturnCfm(placeReturnGrillesForZone(targetZone, newSupply), targetZone.returnCfm),
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

  const rawReturn = routeReturnDucts(targetZone, newReturn, currentDesign.standardsProfile, [...othersNetwork, ...ductSegments(sizedSupply)]);
  const sizedReturn = sizeDuctNetwork(rawReturn, currentDesign.standardsProfile, targetZone.maxAvailableCeilingDepthIn, currentDesign.units);

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
    exfiltrationCfm: currentDesign.massBalance?.exfiltrationCfm
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
}

export interface ZonePayload {
  diffusers: ZonePayloadDiffuser[];
  ducts: ZonePayloadDuct[];
  unitPos: { x: number; y: number };
  unitPositions: { x: number; y: number }[];
  outdoorUnitPos: { x: number; y: number };
  outdoorUnitPositions: { x: number; y: number }[];
  serviceZonePolygons: number[][];
  catalogQty: number;
  catalogModel: string;
  catalogEsp: string;
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

  const diffusers = [
    ...design.supplyTerminals.map((t) => ({
      id: t.id,
      ...pt(t.position),
      cfm: t.cfm,
      size: t.faceDimension || '12"x12"',
      type: 'supply' as const,
      throwT50Ft: t.throwT50Ft || 12,
      actualNc: t.ncRating || 25,
      deltaPInWg: t.deltaPInWg || 0.05
    })),
    ...design.returnTerminals.map((t) => ({
      id: t.id,
      ...pt(t.position),
      cfm: t.cfm,
      size: t.faceDimension || '24"x12"',
      type: 'return' as const,
      throwT50Ft: t.throwT50Ft || 10,
      actualNc: t.ncRating || 25,
      deltaPInWg: t.deltaPInWg || 0.04
    }))
  ];

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
      velocityFpm: d.velocityFpm
    })),
    ...design.returnDucts.map((d) => ({
      id: d.id,
      type: 'return' as const,
      points: ductPts(d),
      widthIn: d.widthIn,
      heightIn: d.heightIn,
      cfm: d.airflowCfm,
      sizeLabel: ductLabel(d.widthIn, d.heightIn),
      velocityFpm: d.velocityFpm
    }))
  ];

  const unitPos = pt(design.serviceZones[0]?.equipmentPosition || { x: 25, y: 15 });
  const unitPositions = design.serviceZones.map((sz) => pt(sz.equipmentPosition));
  const oduFt = design.outdoorUnitPositions?.length
    ? design.outdoorUnitPositions
    : design.serviceZones.map((sz) => ({ x: sz.equipmentPosition.x, y: sz.equipmentPosition.y }));
  const outdoorUnitPositions = oduFt.map(pt);

  return {
    diffusers,
    ducts,
    unitPos,
    unitPositions,
    outdoorUnitPos: outdoorUnitPositions[0] || { x: unitPos.x, y: unitPos.y },
    outdoorUnitPositions,
    serviceZonePolygons: design.serviceZones.map((sz) => sz.serviceAreaPolygon.map(px)),
    catalogQty: design.selectedOption.unitCount,
    catalogModel: design.selectedOption.unitModel,
    catalogEsp: `${design.selectedOption.availableEspInWg} in.wg`
  };
}
