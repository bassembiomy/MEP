import { StandardsProfile, getStandardsProfile } from './standards/designStandards';
import { optimizeMultiUnitCandidates, MultiUnitCandidate } from './systemArchitecture/equipmentOptimizer';
import { generateDesignDecisionLog } from './systemArchitecture/designDecisionLogger';
import { partitionRoomIntoServiceZones, EquipmentServiceZone } from './zoning/zonePartitioner';
import { placeSupplyDiffusersForZone, CoordinatedAirTerminal } from './terminals/terminalPlacer';
import { placeReturnGrillesForZone } from './terminals/returnPlacer';
import { routeSteppedSupplyDucts, SteppedDuctSection } from './ducts/steppedDuctRouter';
import { routeReturnDucts } from './ducts/returnDuctRouter';
import { sizeDuctNetwork } from './ducts/aerodynamicDuctSizer';
import { routeFreshAirDucts, OutdoorAirSystem } from './outdoorAir/freshAirRouter';
import { calculateAshrae621Ventilation, Ashrae621Result } from './outdoorAir/outdoorAirCalculator';
import { polygonPxToFt, pxPerFt, UnitSystem } from './units';
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
  /** Zone air distribution effectiveness Ez. Default 0.8. */
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

/**
 * Keeps only returns that honour the minimum terminal spacing to every supply and to each other
 * (a small room cannot hold the placer's preferred count), then re-spreads the return CFM evenly.
 * At least one return is always kept (the best-separated one).
 */
function pruneReturnsForSpacing(
  returns: CoordinatedAirTerminal[],
  supplies: CoordinatedAirTerminal[],
  totalCfm: number
): CoordinatedAirTerminal[] {
  const sepToSupply = (r: CoordinatedAirTerminal) =>
    supplies.length ? Math.min(...supplies.map((t) => Math.hypot(t.position.x - r.position.x, t.position.y - r.position.y))) : Infinity;
  const kept: CoordinatedAirTerminal[] = [];
  for (const r of returns) {
    const ok = sepToSupply(r) >= MIN_TERMINAL_SPACING_FT - 1e-6
      && kept.every((k) => Math.hypot(k.position.x - r.position.x, k.position.y - r.position.y) >= MIN_TERMINAL_SPACING_FT - 1e-6);
    if (ok) kept.push(r);
  }
  if (!kept.length && returns.length) kept.push([...returns].sort((a, b) => sepToSupply(b) - sepToSupply(a))[0]);
  const each = kept.length ? Math.round(totalCfm / kept.length) : 0;
  kept.forEach((t) => { t.cfm = each; });
  fixCfmSum(kept, totalCfm);
  return kept;
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
  if (userOverrideUnitCount) {
    const matched = optimization.candidates.find((c) => c.unitCount === userOverrideUnitCount);
    if (matched) chosenCandidate = matched;
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

  for (const zone of serviceZones) {
    const supplyInZone = placeSupplyDiffusersForZone(zone, { targetCfmPerDiffuser: 350, optimizeThrow: true });
    const returnInZone = pruneReturnsForSpacing(placeReturnGrillesForZone(zone, supplyInZone), supplyInZone, zone.returnCfm);

    allSupplyTerminals.push(...supplyInZone);
    allReturnTerminals.push(...returnInZone);

    // Phase 5 & 6: Stepped Duct Network Routing & Sizing
    const rawSupplyDucts = routeSteppedSupplyDucts(zone, supplyInZone);
    const sizedSupply = sizeDuctNetwork(rawSupplyDucts, profile, maxAvailableCeilingDepthIn);
    allSupplyDucts.push(...sizedSupply);

    const rawReturnDucts = routeReturnDucts(zone, returnInZone);
    const sizedReturn = sizeDuctNetwork(rawReturnDucts, profile, maxAvailableCeilingDepthIn);
    allReturnDucts.push(...sizedReturn);
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
    allCandidates: optimization.candidates,
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
    allOptimizationCandidates: optimization.candidates,
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
    ventilation,
    massBalance,
    outdoorUnitPositions
  };
}

/**
 * Executes Scoped Dependency Recalculation after a user modifies an equipment position or terminal
 */
export function recalculateScopedOverride(
  modifiedZoneId: string,
  currentDesign: AirDistributionDesignResult
): AirDistributionDesignResult {
  const updatedZones = [...currentDesign.serviceZones];
  const targetZone = updatedZones.find((z) => z.id === modifiedZoneId);
  if (!targetZone) return currentDesign;

  // Re-run terminal placement for this modified zone while preserving user-locked terminals
  const newSupply = placeSupplyDiffusersForZone(targetZone, { optimizeThrow: true });
  const newReturn = pruneReturnsForSpacing(placeReturnGrillesForZone(targetZone, newSupply), newSupply, targetZone.returnCfm);

  // Filter out old terminals for this zone and insert newly recalculated ones
  const filteredSupply = currentDesign.supplyTerminals.filter((t) => t.unitId !== modifiedZoneId);
  const filteredReturn = currentDesign.returnTerminals.filter((t) => t.unitId !== modifiedZoneId);

  const mergedSupply = [...filteredSupply, ...newSupply];
  const mergedReturn = [...filteredReturn, ...newReturn];

  // Re-route and resize supply and return ducts for this zone
  const rawSupply = routeSteppedSupplyDucts(targetZone, newSupply);
  const sizedSupply = sizeDuctNetwork(rawSupply, currentDesign.standardsProfile, targetZone.maxAvailableCeilingDepthIn);

  const rawReturn = routeReturnDucts(targetZone, newReturn);
  const sizedReturn = sizeDuctNetwork(rawReturn, currentDesign.standardsProfile, targetZone.maxAvailableCeilingDepthIn);

  const filteredSupplyDucts = currentDesign.supplyDucts.filter((d) => d.unitId !== modifiedZoneId);
  const filteredReturnDucts = currentDesign.returnDucts.filter((d) => d.unitId !== modifiedZoneId);

  const mergedSupplyDucts = [...filteredSupplyDucts, ...sizedSupply];
  const mergedReturnDucts = [...filteredReturnDucts, ...sizedReturn];

  // Re-run validation
  const validationReport = executeMasterHvacValidation({
    roomName: currentDesign.roomName,
    roomPolygon: currentDesign.roomPolygonFt?.length ? currentDesign.roomPolygonFt : targetZone.serviceAreaPolygon,
    requiredRoomCfm: updatedZones.reduce((a, z) => a + z.supplyCfm, 0),
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

/**
 * Converts the (feet) design result to the store payload in canvas px (design.pxPerFt px per ft).
 */
export function convertDesignResultToZonePayload(design: AirDistributionDesignResult) {
  const k = design.pxPerFt && design.pxPerFt > 0 ? design.pxPerFt : 1;
  const px = (v: number) => parseFloat((v * k).toFixed(2));
  const pt = (p: { x: number; y: number }) => ({ x: px(p.x), y: px(p.y) });

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

  const ductPts = (d: { startPoint: { x: number; y: number }; endPoint: { x: number; y: number } }) =>
    [px(d.startPoint.x), px(d.startPoint.y), px(d.endPoint.x), px(d.endPoint.y)];
  const ducts = [
    ...design.supplyDucts.map((d) => ({
      id: d.id,
      type: (d.role === 'main-trunk' ? 'trunk' : 'branch') as 'trunk' | 'branch',
      points: ductPts(d),
      widthIn: d.widthIn,
      heightIn: d.heightIn,
      cfm: d.airflowCfm,
      sizeLabel: `${d.widthIn}"x${d.heightIn}"`,
      velocityFpm: d.velocityFpm
    })),
    ...design.returnDucts.map((d) => ({
      id: d.id,
      type: 'return' as const,
      points: ductPts(d),
      widthIn: d.widthIn,
      heightIn: d.heightIn,
      cfm: d.airflowCfm,
      sizeLabel: `${d.widthIn}"x${d.heightIn}"`,
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
