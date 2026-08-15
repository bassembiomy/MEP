import {
  PressureLossSegment,
  CriticalPathResult,
  FanOperatingPointResult,
  BranchBalancingItem,
  EquipmentCatalogItem,
  DiffuserCatalogItem,
  DuctTypeItem
} from './types';
import { STANDARD_FITTING_LOSSES } from './hvacCatalogs';
import { DuctSegment } from '../store/projectStore';
import { DiffuserPos } from './diffuserPlacer';

/**
 * Air density in lb/ft³ at standard sea level conditions (70°F, 29.92 in.Hg) = 0.075 lb/ft³
 */
export const STANDARD_AIR_DENSITY = 0.075;

/**
 * Calculates velocity pressure (in. wg) from air velocity (FPM) and relative density
 */
export function calculateVelocityPressure(velocityFpm: number, airDensityRatio: number = 1.0): number {
  if (velocityFpm <= 0) return 0;
  return Math.pow(velocityFpm / 4005, 2) * airDensityRatio;
}

/**
 * Calculates straight duct friction loss (in. wg)
 */
export function calculateStraightDuctLoss(
  cfm: number,
  widthIn: number,
  heightIn: number,
  lengthFt: number,
  frictionRatePer100Ft: number = 0.10
): { deltaPInWg: number; velocityFpm: number; velocityPressureInWg: number } {
  if (cfm <= 0 || widthIn <= 0 || heightIn <= 0 || lengthFt <= 0) {
    return { deltaPInWg: 0, velocityFpm: 0, velocityPressureInWg: 0 };
  }

  const areaSqFt = (widthIn * heightIn) / 144;
  const velocityFpm = cfm / areaSqFt;
  const velocityPressureInWg = calculateVelocityPressure(velocityFpm);
  const deltaPInWg = (frictionRatePer100Ft * lengthFt) / 100;

  return {
    deltaPInWg: Math.round(deltaPInWg * 1000) / 1000,
    velocityFpm: Math.round(velocityFpm),
    velocityPressureInWg: Math.round(velocityPressureInWg * 1000) / 1000
  };
}

/**
 * Calculates fitting dynamic loss (in. wg) using K-factor
 */
export function calculateFittingLoss(
  fittingKey: string,
  velocityFpm: number,
  airDensityRatio: number = 1.0
): { deltaPInWg: number; velocityPressureInWg: number; lossCoefficientK: number } {
  const fittingDef = STANDARD_FITTING_LOSSES[fittingKey];
  const velocityPressure = calculateVelocityPressure(velocityFpm, airDensityRatio);

  if (!fittingDef) {
    return { deltaPInWg: 0, velocityPressureInWg: velocityPressure, lossCoefficientK: 0 };
  }

  let deltaP = 0;
  if (fittingDef.fixedLossInWg !== undefined && fittingDef.fixedLossInWg > 0) {
    deltaP = fittingDef.fixedLossInWg;
  } else {
    deltaP = fittingDef.lossCoefficientK * velocityPressure;
  }

  return {
    deltaPInWg: Math.round(deltaP * 1000) / 1000,
    velocityPressureInWg: Math.round(velocityPressure * 1000) / 1000,
    lossCoefficientK: fittingDef.lossCoefficientK
  };
}

/**
 * Computes pressure loss across a connected supply path and return path to determine the Critical Path
 */
export function solveDirectedNetworkStaticPressure(
  ducts: DuctSegment[],
  diffusers: DiffuserPos[],
  diffuserCatalog: DiffuserCatalogItem[],
  ductType: DuctTypeItem,
  scale: number = 10,
  safetyMarginPct: number = 0.15
): CriticalPathResult {
  if (ducts.length === 0 || diffusers.length === 0) {
    return {
      pathId: 'empty-path',
      terminalId: '',
      supplySegments: [],
      returnSegments: [],
      totalSupplyDeltaPInWg: 0,
      totalReturnDeltaPInWg: 0,
      diffuserDeltaPInWg: 0,
      accessoriesDeltaPInWg: 0,
      totalLossInWg: 0,
      marginInWg: 0,
      espRequiredInWg: 0
    };
  }

  // Separate supply ducts (trunk/branch) and return ducts
  const supplyDucts = ducts.filter(d => d.type === 'trunk' || d.type === 'branch');
  const returnDucts = ducts.filter(d => d.type === 'return');

  // Evaluate complete paths to each diffuser terminal
  const pathResults: {
    terminalId: string;
    supplySegments: PressureLossSegment[];
    totalSupplyLoss: number;
    diffuserLoss: number;
    terminalCfm: number;
  }[] = [];

  diffusers.forEach((dif, idx) => {
    const supplySegments: PressureLossSegment[] = [];
    let cumulativeP = 0;

    // 1. Initial Equipment Discharge Transition & Filter loss
    const filterLoss = calculateFittingLoss('filter-merv8', 800);
    cumulativeP += filterLoss.deltaPInWg;
    supplySegments.push({
      id: `seg-filter-${idx}`,
      type: 'accessory',
      name: 'MERV 8 Pleated Air Filter',
      cfm: dif.cfm,
      velocityFpm: 800,
      velocityPressureInWg: filterLoss.velocityPressureInWg,
      deltaPInWg: filterLoss.deltaPInWg,
      cumulativePInWg: Math.round(cumulativeP * 1000) / 1000
    });

    // 2. Supply Trunks and Branches leading to this diffuser
    // Find ducts associated with this path
    const relevantDucts = supplyDucts.filter(d => d.points && d.points.length >= 4);

    relevantDucts.forEach((duct, dIdx) => {
      const p = duct.points;
      const dx = (p[2] - p[0]) / scale;
      const dy = (p[3] - p[1]) / scale;
      const lenFt = Math.max(2, Math.sqrt(dx * dx + dy * dy));

      const ductLoss = calculateStraightDuctLoss(
        duct.cfm,
        duct.widthIn,
        duct.heightIn,
        lenFt,
        ductType.maxFrictionRateInWgPer100Ft
      );

      cumulativeP += ductLoss.deltaPInWg;
      supplySegments.push({
        id: `seg-duct-${duct.id}`,
        type: 'straight-duct',
        name: `${duct.type.toUpperCase()} Duct ${duct.widthIn}"x${duct.heightIn}" (${Math.round(lenFt)} ft)`,
        cfm: duct.cfm,
        velocityFpm: ductLoss.velocityFpm,
        velocityPressureInWg: ductLoss.velocityPressureInWg,
        lengthFt: Math.round(lenFt * 10) / 10,
        deltaPInWg: ductLoss.deltaPInWg,
        cumulativePInWg: Math.round(cumulativeP * 1000) / 1000
      });

      // Add fitting loss: 90° elbow or branch take-off
      if (dIdx > 0) {
        const fittingLoss = calculateFittingLoss('branch-tee', ductLoss.velocityFpm);
        cumulativeP += fittingLoss.deltaPInWg;
        supplySegments.push({
          id: `seg-fit-${duct.id}`,
          type: 'fitting',
          name: 'Branch Take-off Fitting',
          cfm: duct.cfm,
          velocityFpm: ductLoss.velocityFpm,
          velocityPressureInWg: fittingLoss.velocityPressureInWg,
          lossCoefficientK: fittingLoss.lossCoefficientK,
          deltaPInWg: fittingLoss.deltaPInWg,
          cumulativePInWg: Math.round(cumulativeP * 1000) / 1000
        });
      }
    });

    // 3. Diffuser Terminal Pressure Drop
    // Look up in diffuser catalog or estimate from standard TMS performance
    const matchedDiffuser = diffuserCatalog.find(dc => dc.maxCfm >= dif.cfm) || diffuserCatalog[0];
    let diffuserDeltaP = 0.035; // Default ~0.035 in. wg
    if (matchedDiffuser && matchedDiffuser.performanceTable.length > 0) {
      const table = matchedDiffuser.performanceTable;
      const sorted = [...table].sort((a, b) => a.cfm - b.cfm);
      if (dif.cfm <= sorted[0].cfm) {
        diffuserDeltaP = sorted[0].deltaPInWg;
      } else if (dif.cfm >= sorted[sorted.length - 1].cfm) {
        diffuserDeltaP = sorted[sorted.length - 1].deltaPInWg;
      } else {
        // Linear interpolation
        for (let i = 0; i < sorted.length - 1; i++) {
          if (dif.cfm >= sorted[i].cfm && dif.cfm <= sorted[i + 1].cfm) {
            const frac = (dif.cfm - sorted[i].cfm) / (sorted[i + 1].cfm - sorted[i].cfm);
            diffuserDeltaP = sorted[i].deltaPInWg + frac * (sorted[i + 1].deltaPInWg - sorted[i].deltaPInWg);
            break;
          }
        }
      }
    }

    cumulativeP += diffuserDeltaP;
    supplySegments.push({
      id: `seg-terminal-${dif.id}`,
      type: 'diffuser',
      name: `Supply Diffuser Terminal (${dif.size || '9"x9"'})`,
      cfm: dif.cfm,
      velocityFpm: 650,
      velocityPressureInWg: calculateVelocityPressure(650),
      deltaPInWg: Math.round(diffuserDeltaP * 1000) / 1000,
      cumulativePInWg: Math.round(cumulativeP * 1000) / 1000
    });

    pathResults.push({
      terminalId: dif.id,
      supplySegments,
      totalSupplyLoss: Math.round(cumulativeP * 1000) / 1000,
      diffuserLoss: Math.round(diffuserDeltaP * 1000) / 1000,
      terminalCfm: dif.cfm
    });
  });

  // Find the critical supply path (highest pressure loss)
  pathResults.sort((a, b) => b.totalSupplyLoss - a.totalSupplyLoss);
  const criticalSupply = pathResults[0] || {
    terminalId: diffusers[0]?.id || '',
    supplySegments: [],
    totalSupplyLoss: 0.10,
    diffuserLoss: 0.035,
    terminalCfm: 200
  };

  // 4. Return Air Path Calculation
  const returnSegments: PressureLossSegment[] = [];
  let returnCumulativeP = 0;

  // Return grille loss (~0.025 in. wg)
  const returnGrilleLoss = 0.025;
  returnCumulativeP += returnGrilleLoss;
  returnSegments.push({
    id: 'seg-ret-grille',
    type: 'grille',
    name: 'Return Air Eggcrate Grille (500 FPM)',
    cfm: criticalSupply.terminalCfm,
    velocityFpm: 500,
    velocityPressureInWg: calculateVelocityPressure(500),
    deltaPInWg: returnGrilleLoss,
    cumulativePInWg: returnCumulativeP
  });

  if (returnDucts.length > 0) {
    returnDucts.forEach(rd => {
      const p = rd.points;
      const dx = (p[2] - p[0]) / scale;
      const dy = (p[3] - p[1]) / scale;
      const lenFt = Math.max(2, Math.sqrt(dx * dx + dy * dy));

      const rLoss = calculateStraightDuctLoss(
        rd.cfm,
        rd.widthIn,
        rd.heightIn,
        lenFt,
        ductType.maxFrictionRateInWgPer100Ft
      );

      returnCumulativeP += rLoss.deltaPInWg;
      returnSegments.push({
        id: `seg-ret-duct-${rd.id}`,
        type: 'straight-duct',
        name: `Return Duct ${rd.widthIn}"x${rd.heightIn}" (${Math.round(lenFt)} ft)`,
        cfm: rd.cfm,
        velocityFpm: rLoss.velocityFpm,
        velocityPressureInWg: rLoss.velocityPressureInWg,
        lengthFt: Math.round(lenFt * 10) / 10,
        deltaPInWg: rLoss.deltaPInWg,
        cumulativePInWg: Math.round(returnCumulativeP * 1000) / 1000
      });
    });
  } else {
    // Plenum return allowance (~0.03 in. wg for plenum wall openings / transfers)
    const plenumLoss = 0.030;
    returnCumulativeP += plenumLoss;
    returnSegments.push({
      id: 'seg-ret-plenum',
      type: 'straight-duct',
      name: 'Ceiling Plenum Return Resistance',
      cfm: criticalSupply.terminalCfm,
      velocityFpm: 200,
      velocityPressureInWg: calculateVelocityPressure(200),
      lengthFt: 15,
      deltaPInWg: plenumLoss,
      cumulativePInWg: returnCumulativeP
    });
  }

  const totalRawLoss = criticalSupply.totalSupplyLoss + returnCumulativeP;
  const marginInWg = Math.round(totalRawLoss * safetyMarginPct * 1000) / 1000;
  const espRequiredInWg = Math.round((totalRawLoss + marginInWg) * 1000) / 1000;

  return {
    pathId: `critical-path-${criticalSupply.terminalId}`,
    terminalId: criticalSupply.terminalId,
    supplySegments: criticalSupply.supplySegments,
    returnSegments,
    totalSupplyDeltaPInWg: criticalSupply.totalSupplyLoss,
    totalReturnDeltaPInWg: Math.round(returnCumulativeP * 1000) / 1000,
    diffuserDeltaPInWg: criticalSupply.diffuserLoss,
    accessoriesDeltaPInWg: 0.15, // Filter + dampers
    totalLossInWg: Math.round(totalRawLoss * 1000) / 1000,
    marginInWg,
    espRequiredInWg
  };
}

/**
 * Evaluates the equipment fan operating point against required ESP and design CFM
 */
export function evaluateFanOperatingPoint(
  equipment: EquipmentCatalogItem,
  designCfm: number,
  espRequiredInWg: number
): FanOperatingPointResult {
  const warnings: string[] = [];

  // Non-ducted systems (High Wall, standard Cassette) have zero external duct resistance requirement
  if (!equipment.capabilities.supportsDuctNetwork || !equipment.capabilities.hasExternalStaticPressure) {
    return {
      isValid: true,
      operatingCfm: designCfm,
      operatingEspInWg: 0,
      fanMarginInWg: 0,
      percentageOverDesignCfm: 0,
      powerKwEstimate: equipment.electricalKw * 0.15,
      warningMessages: []
    };
  }

  const maxRatedEsp = equipment.maxRatedEspInWg || 0.40;

  // 1. Direct check: Is required ESP within maximum rated ESP?
  if (espRequiredInWg > maxRatedEsp) {
    warnings.push(
      `Required ESP (${espRequiredInWg.toFixed(2)} in.wg) exceeds unit maximum rated static pressure (${maxRatedEsp.toFixed(2)} in.wg).`
    );
  }

  // 2. Tabular fan curve evaluation
  let fanMaxEspAtDesignCfm = maxRatedEsp;
  let powerKw = equipment.electricalKw * 0.20;

  if (equipment.fanPerformance.table && equipment.fanPerformance.table.length > 0) {
    const table = equipment.fanPerformance.table;
    const sorted = [...table].sort((a, b) => a.cfm - b.cfm);

    if (designCfm <= sorted[0].cfm) {
      fanMaxEspAtDesignCfm = sorted[0].espInWg;
      powerKw = sorted[0].powerKw || powerKw;
    } else if (designCfm >= sorted[sorted.length - 1].cfm) {
      fanMaxEspAtDesignCfm = sorted[sorted.length - 1].espInWg;
      powerKw = sorted[sorted.length - 1].powerKw || powerKw;
      if (designCfm > equipment.maxCfm) {
        warnings.push(`Design CFM (${designCfm}) exceeds fan maximum CFM limit (${equipment.maxCfm}).`);
      }
    } else {
      // Linear interpolation between tabular points
      for (let i = 0; i < sorted.length - 1; i++) {
        if (designCfm >= sorted[i].cfm && designCfm <= sorted[i + 1].cfm) {
          const t = (designCfm - sorted[i].cfm) / (sorted[i + 1].cfm - sorted[i].cfm);
          fanMaxEspAtDesignCfm = sorted[i].espInWg + t * (sorted[i + 1].espInWg - sorted[i].espInWg);
          if (sorted[i].powerKw && sorted[i + 1].powerKw) {
            powerKw = sorted[i].powerKw! + t * (sorted[i + 1].powerKw! - sorted[i].powerKw!);
          }
          break;
        }
      }
    }
  }

  const fanMargin = fanMaxEspAtDesignCfm - espRequiredInWg;
  const isValid = fanMargin >= -0.02; // Small tolerance for boundary conditions

  if (fanMargin < 0 && !warnings.some(w => w.includes('exceeds'))) {
    warnings.push(
      `Fan static pressure at ${designCfm} CFM (${fanMaxEspAtDesignCfm.toFixed(2)} in.wg) is insufficient for calculated ESP (${espRequiredInWg.toFixed(2)} in.wg).`
    );
  }

  return {
    isValid,
    operatingCfm: designCfm,
    operatingEspInWg: Math.round(espRequiredInWg * 1000) / 1000,
    fanMarginInWg: Math.round(fanMargin * 1000) / 1000,
    percentageOverDesignCfm: 0,
    powerKwEstimate: Math.round(powerKw * 100) / 100,
    warningMessages: warnings
  };
}

/**
 * Calculates preliminary balancing damper schedule for parallel branches
 */
export function calculateBranchBalancingSchedule(
  criticalPath: CriticalPathResult,
  diffusers: DiffuserPos[]
): BranchBalancingItem[] {
  if (diffusers.length <= 1) return [];

  const maxLoss = criticalPath.totalSupplyDeltaPInWg;

  return diffusers.map((dif, idx) => {
    // Estimate path resistance to this diffuser based on position
    const pathLoss = dif.id === criticalPath.terminalId ? maxLoss : maxLoss * (0.65 + 0.30 * (idx / diffusers.length));
    const deficit = Math.max(0, maxLoss - pathLoss);

    return {
      branchId: `branch-damper-${dif.id}`,
      terminalId: dif.id,
      branchFlowCfm: dif.cfm,
      branchResistanceInWg: Math.round(pathLoss * 1000) / 1000,
      pressureDeficitInWg: Math.round(deficit * 1000) / 1000,
      recommendedDamperSetting: deficit > 0.01 ? `Throttle +${deficit.toFixed(2)} in.wg` : 'Full Open (Critical)'
    };
  });
}
