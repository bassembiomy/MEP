import { EquipmentServiceZone, DesignControlMode } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { DuctAccessoryItem } from '../types';
import { calculateFrictionRatePer100Ft } from './ductPressureCalculator';

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
  accessories?: DuctAccessoryItem[];
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
  let previousTrunkId: string | undefined;

  for (let i = 0; i < sortedCols.length; i++) {
    const colX = sortedCols[i];
    const terminalsInCol = colMap.get(colX) || [];
    const isFirstCol = i === 0;
    const isLastCol = i === sortedCols.length - 1;

    const trunkAccessories: DuctAccessoryItem[] = [];
    const widthIn = remainingCfm >= 1000 ? 24 : remainingCfm >= 600 ? 18 : 14;
    const heightIn = 10;

    // NFPA 90A §6.4.2.1: Supply smoke detector on main discharge if > 2,000 CFM
    if (isFirstCol && totalSupplyCfm > 2000) {
      trunkAccessories.push({
        id: `DSD-${zone.unitTag}`,
        type: 'duct-smoke-detector',
        tag: `DSD-${zone.unitTag}`,
        position: {
          x: parseFloat(((currentTrunkPoint.x + colX) / 2).toFixed(2)),
          y: parseFloat(eqPos.y.toFixed(2))
        },
        widthIn,
        heightIn,
        deltaPInWg: 0.02,
        cadSymbol: 'DSD',
        standardReference: 'NFPA 90A §6.4.2.1',
        actionOnTrigger: 'Interlock fan shutdown upon smoke alarm'
      });
    }

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
      widthIn,
      heightIn,
      velocityFpm: 950,
      allowableVelocityFpm: isFirstCol ? 1200 : 900,
      frictionLossPer100Ft: 0.08,
      fittingLossInWg: 0.015,
      totalSectionLossInWg: 0.025,
      ncRating: 25,
      connectedDiffuserCount: terminalsInCol.length,
      connectedDiffusers: terminalsInCol.map((t) => t.id),
      parentDuctId: previousTrunkId,
      childDuctIds: [],
      accessories: trunkAccessories.length > 0 ? trunkAccessories : undefined
    });

    // 2. Orthogonal vertical takeoff branches running from trunk centerline to each terminal in this column
    for (const term of terminalsInCol) {
      if (Math.abs(term.position.y - eqPos.y) > 1e-8) {
        const branchId = `DS-${zone.unitTag}-${sectionIndex++}`;
        const branchMidY = (eqPos.y + term.position.y) / 2;

        // VCD for branch air balancing
        const branchAccessories: DuctAccessoryItem[] = [
          {
            id: `VCD-${branchId}`,
            type: 'volume-control-damper',
            tag: 'VCD',
            position: { x: parseFloat(colX.toFixed(2)), y: parseFloat(branchMidY.toFixed(2)) },
            widthIn: 10,
            heightIn: 8,
            deltaPInWg: 0.015,
            cadSymbol: 'VCD',
            standardReference: 'SMACNA HVAC Duct Systems / NFPA 90A',
            actionOnTrigger: 'Manual air balancing'
          }
        ];

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
          childDuctIds: [],
          accessories: branchAccessories
        });
      }
    }

    // Decrement remaining CFM after branching off this column
    const colCfm = terminalsInCol.reduce((s, t) => s + t.cfm, 0);
    remainingCfm = Math.max(0, remainingCfm - colCfm);
    currentTrunkPoint = { x: colX, y: eqPos.y };
    previousTrunkId = trunkId;
  }

  const byId = new Map(ducts.map(d => [d.id, d]));
  for (const d of ducts) {
    if (d.parentDuctId) byId.get(d.parentDuctId)?.childDuctIds.push(d.id);
    const areaSqFt = d.widthIn * d.heightIn / 144;
    d.velocityFpm = Math.round(d.airflowCfm / areaSqFt);
    const equivalentDiameter = 1.30 * Math.pow(d.widthIn * d.heightIn, 0.625) / Math.pow(d.widthIn + d.heightIn, 0.25);
    d.frictionLossPer100Ft = calculateFrictionRatePer100Ft(d.airflowCfm, equivalentDiameter);
    const coefficient = d.role === 'main-trunk' ? 0.20 : d.role === 'runout' ? 0.35 : 0.15;
    d.fittingLossInWg = coefficient * Math.pow(d.velocityFpm / 4005, 2);
    d.totalSectionLossInWg = d.frictionLossPer100Ft * Math.hypot(d.endPoint.x - d.startPoint.x, d.endPoint.y - d.startPoint.y) / 100 + d.fittingLossInWg;
  }
  return ducts;
}
