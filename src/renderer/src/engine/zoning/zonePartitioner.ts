import { calculateSolarLoadWeights, ExteriorWallInfo } from './solarLoadWeighting';
import { distributeLoadsAcrossZones } from './loadDistribution';
import { getPolygonScanlineSpan, getPolygonVerticalSpan } from '../geometry';

export type DesignControlMode = 'ai' | 'user-modified' | 'user-locked';

export interface EquipmentServiceZone {
  id: string;
  unitTag: string;
  designControlMode: DesignControlMode;
  
  equipmentModel: string;
  coolingSource: 'dx' | 'chilled-water' | 'heat-pump' | 'package';
  equipmentType: 'concealed-split' | 'fcu' | 'ahu' | 'rtu' | 'package';
  
  nominalTonnage: number;
  actualCapacityBtu: number;
  
  supplyCfm: number;
  returnCfm: number;
  outdoorAirCfm: number;
  outdoorAirConnectionApproved: boolean;
  
  espInWg: number;
  
  equipmentPosition: {
    x: number;
    y: number;
    rotation: number;
    wallSide: 'north' | 'south' | 'east' | 'west' | 'ceiling';
  };
  
  serviceAreaPolygon: number[];
  occupiedAreaPolygon?: number[];
  
  sensibleLoadBtu: number;
  latentLoadBtu: number;
  totalLoadBtu: number;
  
  targetNc: number;
  targetRc?: number;
  
  maxDuctLengthFt?: number;
  maxAvailableCeilingDepthIn?: number;
  
  pressureBudgetInWg: {
    supplyDuct: number;
    returnDuct: number;
    terminals: number;
    fittings: number;
    totalAvailable: number;
  };
  
  isUserOverridden: boolean;
}

export interface EquipmentServiceZoneInput {
  roomName: string;
  roomPolygon: number[]; // [x1, y1, x2, y2, ...]
  unitCount: number;
  selectedModel: string;
  nominalTonnage: number;
  totalCapacityBtu: number;
  totalSensibleBtu: number;
  totalLatentBtu: number;
  totalSupplyCfm: number;
  totalOutdoorAirCfm: number;
  availableEspInWg: number;
  coolingSource?: 'dx' | 'chilled-water' | 'heat-pump' | 'package';
  equipmentType?: 'concealed-split' | 'fcu' | 'ahu' | 'rtu' | 'package';
  mountingWallSide?: 'north' | 'south' | 'east' | 'west' | 'ceiling';
  targetNc?: number;
  maxAvailableCeilingDepthIn?: number;
  exteriorWalls?: ExteriorWallInfo[];
}

function getPolygonBoundingBox(points: number[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

export function partitionRoomIntoServiceZones(input: EquipmentServiceZoneInput): EquipmentServiceZone[] {
  const {
    roomName: _roomName,
    roomPolygon,
    unitCount,
    selectedModel,
    nominalTonnage,
    totalCapacityBtu,
    totalSensibleBtu,
    totalLatentBtu,
    totalSupplyCfm,
    totalOutdoorAirCfm,
    availableEspInWg,
    coolingSource = 'dx',
    equipmentType = 'concealed-split',
    mountingWallSide = 'east',
    targetNc = 30,
    maxAvailableCeilingDepthIn = 14,
    exteriorWalls = []
  } = input;

  const weights = calculateSolarLoadWeights({ unitCount, exteriorWalls });
  const loadSlices = distributeLoadsAcrossZones({
    totalSensibleBtu,
    totalLatentBtu,
    totalCfm: totalSupplyCfm,
    totalOutdoorAirCfm,
    weights
  });

  const bbox = getPolygonBoundingBox(roomPolygon);
  const zones: EquipmentServiceZone[] = [];

  // Determine partitioning axis: slice along Y (horizontal bays) or along X (vertical bays)
  const isVerticalSlicing = mountingWallSide === 'north' || mountingWallSide === 'south';

  let currentOffset = isVerticalSlicing ? bbox.minX : bbox.minY;
  const totalSpan = isVerticalSlicing ? bbox.width : bbox.height;

  for (let i = 0; i < unitCount; i++) {
    const slice = loadSlices[i];
    const baySpan = totalSpan * weights[i];
    const nextOffset = currentOffset + baySpan;

    // Construct bay sub-polygon adhering to actual room boundaries
    let bayPoly: number[] = [];
    let equipX = 0;
    let equipY = 0;
    let rotation = 0;

    if (isVerticalSlicing) {
      const bayMidX = currentOffset + baySpan / 2;
      const span = getPolygonVerticalSpan(bayMidX, roomPolygon) || { minY: bbox.minY, maxY: bbox.maxY };
      const leftSpan = getPolygonVerticalSpan(currentOffset + 0.5, roomPolygon) || span;
      const rightSpan = getPolygonVerticalSpan(nextOffset - 0.5, roomPolygon) || span;

      bayPoly = [
        currentOffset, leftSpan.minY,
        nextOffset, rightSpan.minY,
        nextOffset, rightSpan.maxY,
        currentOffset, leftSpan.maxY
      ];
      equipX = bayMidX;
      equipY = mountingWallSide === 'north' ? span.maxY - 2 : span.minY + 2;
      rotation = mountingWallSide === 'north' ? 180 : 0;
    } else {
      // Sliced along Y axis (bays stacked vertically, equipment on east or west wall)
      const bayMidY = currentOffset + baySpan / 2;
      const span = getPolygonScanlineSpan(bayMidY, roomPolygon) || { minX: bbox.minX, maxX: bbox.maxX };
      const topSpan = getPolygonScanlineSpan(currentOffset + 0.5, roomPolygon) || span;
      const botSpan = getPolygonScanlineSpan(nextOffset - 0.5, roomPolygon) || span;

      bayPoly = [
        topSpan.minX, currentOffset,
        topSpan.maxX, currentOffset,
        botSpan.maxX, nextOffset,
        botSpan.minX, nextOffset
      ];
      equipX = mountingWallSide === 'east' ? span.maxX - 2 : span.minX + 2;
      equipY = bayMidY;
      rotation = mountingWallSide === 'east' ? 270 : 90;
    }

    currentOffset = nextOffset;

    // Upfront static pressure budget calculation
    const terminalBudget = 0.05;
    const returnBudget = 0.06;
    const fittingBudget = parseFloat((availableEspInWg * 0.20).toFixed(3));
    const supplyDuctBudget = parseFloat((availableEspInWg - terminalBudget - returnBudget - fittingBudget).toFixed(3));

    zones.push({
      id: `sz-${i + 1}`,
      unitTag: `FCU-0${i + 1}`,
      designControlMode: 'ai',
      equipmentModel: selectedModel,
      coolingSource,
      equipmentType,
      nominalTonnage: parseFloat((nominalTonnage / unitCount).toFixed(1)),
      actualCapacityBtu: Math.round(totalCapacityBtu / unitCount),
      supplyCfm: slice.supplyCfm,
      returnCfm: slice.returnCfm,
      outdoorAirCfm: slice.outdoorAirCfm,
      outdoorAirConnectionApproved: true,
      espInWg: availableEspInWg,
      equipmentPosition: {
        x: parseFloat(equipX.toFixed(2)),
        y: parseFloat(equipY.toFixed(2)),
        rotation,
        wallSide: mountingWallSide
      },
      serviceAreaPolygon: bayPoly,
      sensibleLoadBtu: slice.sensibleBtu,
      latentLoadBtu: slice.latentBtu,
      totalLoadBtu: slice.totalBtu,
      targetNc,
      maxAvailableCeilingDepthIn,
      pressureBudgetInWg: {
        supplyDuct: Math.max(0.05, supplyDuctBudget),
        returnDuct: returnBudget,
        terminals: terminalBudget,
        fittings: fittingBudget,
        totalAvailable: availableEspInWg
      },
      isUserOverridden: false
    });
  }

  return zones;
}
