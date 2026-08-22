import { EquipmentServiceZone, DesignControlMode } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';

export interface SteppedDuctSection {
  id: string;
  unitId: string;
  designControlMode: DesignControlMode;
  systemType: 'supply' | 'return' | 'outdoor-air';
  role: 'main-trunk' | 'branch' | 'runout';
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  airflowCfm: number;
  shape: 'rectangular' | 'round';
  widthIn: number;
  heightIn: number;
  diameterIn?: number;
  velocityFpm: number;
  allowableVelocityFpm: number;
  frictionLossPer100Ft: number;
  fittingLossInWg: number;
  totalSectionLossInWg: number;
  ncRating: number;
  connectedDiffuserCount: number;
  connectedDiffusers: string[];
  parentDuctId?: string;
  childDuctIds: string[];
}

export function routeSteppedSupplyDucts(
  zone: EquipmentServiceZone,
  supplyTerminals: CoordinatedAirTerminal[]
): SteppedDuctSection[] {
  if (supplyTerminals.length === 0) return [];

  const eqPos = zone.equipmentPosition;
  const ducts: SteppedDuctSection[] = [];

  // Group terminals by X column coordinate
  // Collect unique column X values and sort them by proximity to equipment discharge collar
  const colMap = new Map<number, CoordinatedAirTerminal[]>();
  for (const term of supplyTerminals) {
    const colX = Math.round(term.position.x * 10) / 10;
    const list = colMap.get(colX) || [];
    list.push(term);
    colMap.set(colX, list);
  }

  // Sort columns from closest to equipment to furthest
  const sortedCols = Array.from(colMap.keys()).sort((a, b) => {
    return Math.abs(a - eqPos.x) - Math.abs(b - eqPos.x);
  });

  // Calculate total flow
  const totalSupplyCfm = supplyTerminals.reduce((sum, t) => sum + t.cfm, 0);
  let remainingCfm = totalSupplyCfm;
  let currentTrunkPoint = { x: eqPos.x, y: eqPos.y };
  let sectionIndex = 1;

  for (let i = 0; i < sortedCols.length; i++) {
    const colX = sortedCols[i];
    const terminalsInCol = colMap.get(colX) || [];
    const isFirstCol = i === 0;
    const isLastCol = i === sortedCols.length - 1;

    // 1. Centerline horizontal main trunk segment from current point to this column takeoff
    const trunkId = `DS-${zone.unitTag}-${sectionIndex++}`;
    ducts.push({
      id: trunkId,
      unitId: zone.id,
      designControlMode: 'ai',
      systemType: 'supply',
      role: isFirstCol ? 'main-trunk' : isLastCol ? 'runout' : 'branch',
      startPoint: { x: parseFloat(currentTrunkPoint.x.toFixed(2)), y: parseFloat(currentTrunkPoint.y.toFixed(2)) },
      endPoint: { x: parseFloat(colX.toFixed(2)), y: parseFloat(eqPos.y.toFixed(2)) },
      airflowCfm: remainingCfm,
      shape: 'rectangular',
      widthIn: remainingCfm >= 1000 ? 24 : remainingCfm >= 600 ? 18 : 14,
      heightIn: 10,
      velocityFpm: 950,
      allowableVelocityFpm: isFirstCol ? 1200 : 900,
      frictionLossPer100Ft: 0.08,
      fittingLossInWg: 0.015,
      totalSectionLossInWg: 0.025,
      ncRating: 25,
      connectedDiffuserCount: terminalsInCol.length,
      connectedDiffusers: terminalsInCol.map((t) => t.id),
      childDuctIds: []
    });

    // 2. Orthogonal vertical takeoff branches running from trunk centerline to each terminal in this column
    for (const term of terminalsInCol) {
      if (Math.abs(term.position.y - eqPos.y) > 0.5) {
        const branchId = `DS-${zone.unitTag}-${sectionIndex++}`;
        ducts.push({
          id: branchId,
          unitId: zone.id,
          designControlMode: 'ai',
          systemType: 'supply',
          role: 'runout',
          startPoint: { x: parseFloat(colX.toFixed(2)), y: parseFloat(eqPos.y.toFixed(2)) },
          endPoint: { x: parseFloat(colX.toFixed(2)), y: parseFloat(term.position.y.toFixed(2)) },
          airflowCfm: term.cfm,
          shape: 'rectangular',
          widthIn: 10,
          heightIn: 8,
          velocityFpm: 750,
          allowableVelocityFpm: 800,
          frictionLossPer100Ft: 0.07,
          fittingLossInWg: 0.01,
          totalSectionLossInWg: 0.015,
          ncRating: 22,
          connectedDiffuserCount: 1,
          connectedDiffusers: [term.id],
          parentDuctId: trunkId,
          childDuctIds: []
        });
      }
    }

    // Decrement remaining CFM after branching off this column
    const colCfm = terminalsInCol.reduce((s, t) => s + t.cfm, 0);
    remainingCfm = Math.max(0, remainingCfm - colCfm);
    currentTrunkPoint = { x: colX, y: eqPos.y };
  }

  return ducts;
}
