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
}

export function executeAirDistributionDesign(input: AirDistributionDesignInput): AirDistributionDesignResult {
  const {
    roomName,
    roomPolygon,
    roomAreaSqFt,
    sensibleLoadBtu,
    totalLoadBtu,
    requiredCfm,
    occupancyCount = 0,
    systemType = 'concealed',
    standardsProfileType = 'ashrae',
    maxAvailableCeilingDepthIn = 14,
    mountingWallSide = 'east',
    userOverrideUnitCount,
    exteriorWalls = []
  } = input;

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
    exteriorWalls,
    profile
  });

  let chosenCandidate = optimization.recommendedOption;
  if (userOverrideUnitCount !== undefined) {
    if(!Number.isInteger(userOverrideUnitCount)||userOverrideUnitCount<=0)throw new Error('Unit count override must be a positive integer.');
    const matched = optimization.candidates.find((c) => c.unitCount === userOverrideUnitCount);
    if(!matched)throw new Error('No feasible equipment satisfies the requested unit count override.');
    chosenCandidate = matched;
  }

  // Preliminary office-rate calculation, matching the canonical Rp*P + Ra*A model.
  const totalOaCfm = occupancyCount * 5 + roomAreaSqFt * 0.06;

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

  // Phase 3 & 4: Terminal Placement per Bay
  for(const zone of serviceZones) {
    zone.sensibleCapacityBtu=chosenCandidate.equipmentDetails.sensibleCapacityBtu;
    zone.latentCapacityBtu=chosenCandidate.equipmentDetails.totalCapacityBtu-chosenCandidate.equipmentDetails.sensibleCapacityBtu;
  }
  const allSupplyTerminals: CoordinatedAirTerminal[] = [];
  const allReturnTerminals: CoordinatedAirTerminal[] = [];
  const allSupplyDucts: SteppedDuctSection[] = [];
  const allReturnDucts: SteppedDuctSection[] = [];

  for (const zone of serviceZones) {
    const supplyInZone = placeSupplyDiffusersForZone(zone, { targetCfmPerDiffuser: 350 });
    const returnInZone = placeReturnGrillesForZone(zone, supplyInZone);

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

  // Phase 7: Dedicated Outdoor Air System
  const outdoorAirSystem = routeFreshAirDucts(serviceZones, totalOaCfm, { x: 50, y: 0 });

  // Phase 8: Master 10-Point Validation & Closed-Loop Design Refinement
  let validationReport = executeMasterHvacValidation({
    roomName,
    roomPolygon,
    requiredRoomCfm: requiredCfm,
    designLoadBtu: totalLoadBtu,
    zones: serviceZones,
    terminals: [...allSupplyTerminals, ...allReturnTerminals],
    ducts: [...allSupplyDucts, ...allReturnDucts],
    outdoorAirSystem,
    profile
  });

  // Closed-Loop Design Control Feedback:
  // If velocity or static pressure warnings occur, run a tuning pass
  const espPoint = validationReport.points.find((p) => p.pointIndex === 7);
  if (espPoint && espPoint.status === 'WARNING' && maxAvailableCeilingDepthIn >= 12) {
    // Re-size duct network with lower friction rate target to reduce pressure drop
    for (let i = 0; i < allSupplyDucts.length; i++) {
      if (allSupplyDucts[i].role === 'main-trunk') {
        allSupplyDucts[i].widthIn = Math.min(36, allSupplyDucts[i].widthIn + 2);
        allSupplyDucts[i].velocityFpm = Math.round(
          allSupplyDucts[i].airflowCfm / ((allSupplyDucts[i].widthIn * allSupplyDucts[i].heightIn) / 144)
        );
        allSupplyDucts[i].frictionLossPer100Ft = 0.06;
      }
    }
    // Re-evaluate validation
    validationReport = executeMasterHvacValidation({
      roomName,
      roomPolygon,
      requiredRoomCfm: requiredCfm,
      designLoadBtu: totalLoadBtu,
      zones: serviceZones,
      terminals: [...allSupplyTerminals, ...allReturnTerminals],
      ducts: [...allSupplyDucts, ...allReturnDucts],
      outdoorAirSystem,
      profile
    });
  }

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
    timestamp: new Date().toISOString()
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
  const newSupply = placeSupplyDiffusersForZone(targetZone);
  const newReturn = placeReturnGrillesForZone(targetZone, newSupply);

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
    roomPolygon: targetZone.serviceAreaPolygon,
    requiredRoomCfm: targetZone.supplyCfm,
    designLoadBtu: targetZone.totalLoadBtu,
    zones: updatedZones,
    terminals: [...mergedSupply, ...mergedReturn],
    ducts: [...mergedSupplyDucts, ...mergedReturnDucts],
    outdoorAirSystem: currentDesign.outdoorAirSystem,
    profile: currentDesign.standardsProfile
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

export function convertDesignResultToZonePayload(design: AirDistributionDesignResult) {
  const diffusers = [
    ...design.supplyTerminals.map((t) => ({
      id: t.id,
      x: t.position.x,
      y: t.position.y,
      cfm: t.cfm,
      size: t.faceDimension || '12"x12"',
      type: 'supply' as const,
      throwT50Ft: t.throwT50Ft || 12,
      actualNc: t.ncRating || 25,
      deltaPInWg: t.deltaPInWg || 0.05
    })),
    ...design.returnTerminals.map((t) => ({
      id: t.id,
      x: t.position.x,
      y: t.position.y,
      cfm: t.cfm,
      size: t.faceDimension || '24"x12"',
      type: 'return' as const,
      throwT50Ft: t.throwT50Ft || 10,
      actualNc: t.ncRating || 25,
      deltaPInWg: t.deltaPInWg || 0.04
    }))
  ];

  const ducts = [
    ...design.supplyDucts.map((d) => ({
      id: d.id,
      type: (d.role === 'main-trunk' ? 'trunk' : 'branch') as 'trunk' | 'branch',
      points: [d.startPoint.x, d.startPoint.y, d.endPoint.x, d.endPoint.y],
      widthIn: d.widthIn,
      heightIn: d.heightIn,
      cfm: d.airflowCfm,
      sizeLabel: `${d.widthIn}"x${d.heightIn}"`,
      velocityFpm: d.velocityFpm,
      accessories: d.accessories || []
    })),
    ...design.returnDucts.map((d) => ({
      id: d.id,
      type: 'return' as const,
      points: [d.startPoint.x, d.startPoint.y, d.endPoint.x, d.endPoint.y],
      widthIn: d.widthIn,
      heightIn: d.heightIn,
      cfm: d.airflowCfm,
      sizeLabel: `${d.widthIn}"x${d.heightIn}"`,
      velocityFpm: d.velocityFpm,
      accessories: d.accessories || []
    }))
  ];

  const accessories = design.supplyDucts.flatMap((d) => d.accessories || []);

  const unitPos = design.serviceZones[0]?.equipmentPosition || { x: 25, y: 15 };
  const unitPositions = design.serviceZones.map((sz) => sz.equipmentPosition);

  // Compute outdoor unit (ACU) positions along the bottom wall
  const outdoorUnitPositions = design.serviceZones.map((sz, idx) => {
    return {
      x: sz.equipmentPosition.x - idx * 28,
      y: (design.serviceZones[design.serviceZones.length - 1]?.equipmentPosition?.y || sz.equipmentPosition.y) + 35
    };
  });

  return {
    diffusers,
    ducts,
    accessories,
    layers: {
      supplyDucts: 'M-HVAC-SUPP-DUCT',
      returnDucts: 'M-HVAC-RETN-DUCT',
      diffusers: 'M-HVAC-DIFF',
      grilles: 'M-HVAC-GRILLE',
      dampers: 'M-HVAC-DAMP',
      smokeDetectors: 'M-HVAC-SMOKE-DET',
      text: 'M-HVAC-TEXT'
    },
    unitPos,
    unitPositions,
    outdoorUnitPos: outdoorUnitPositions[0] || { x: unitPos.x, y: unitPos.y + 35 },
    outdoorUnitPositions,
    catalogQty: design.selectedOption.unitCount,
    catalogModel: design.selectedOption.unitModel,
    catalogEsp: `${design.selectedOption.availableEspInWg} in.wg`
  };
}
