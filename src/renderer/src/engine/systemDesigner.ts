import {
  SystemDesignCandidate,
  OptimizationWeights,
  DiagnosticItem,
  CriticalPathResult
} from './types';
import {
  STANDARD_EQUIPMENT_CATALOG,
  STANDARD_DIFFUSER_CATALOG,
  STANDARD_DUCT_TYPES
} from './hvacCatalogs';
import {
  solveDirectedNetworkStaticPressure,
  evaluateFanOperatingPoint,
  calculateBranchBalancingSchedule
} from './staticPressureCalc';
import { selectBestDiffuserFromCatalog } from './diffuserPlacer';
import { DuctSegment } from '../store/projectStore';
import { DiffuserPos } from './diffuserPlacer';

export const DEFAULT_OPTIMIZATION_WEIGHTS: OptimizationWeights = {
  wComfort: 0.20,
  wEnergy: 0.20,
  wCost: 0.20,
  wNoise: 0.15,
  wPressure: 0.10,
  wSpace: 0.05,
  wPreference: 0.10
};

export interface RecommendationSummary {
  candidates: SystemDesignCandidate[];
  bestOverall: SystemDesignCandidate | null;
  bestEnergy: SystemDesignCandidate | null;
  lowestCost: SystemDesignCandidate | null;
  lowestNoise: SystemDesignCandidate | null;
  rejectedCount: number;
  diagnostics: DiagnosticItem[];
}

export interface LegacySystemRecommendation {
  type: 'high-wall' | 'cassette' | 'concealed' | 'packaged' | 'vrf' | 'ahu';
  name: string;
  score: number;
  reason: string;
  pros: string[];
  cons: string[];
  estUnits: number;
  unitCapacity: number;
  estCost: 'Low' | 'Medium' | 'Medium-High' | 'High' | 'Very High';
  estEfficiency: 'Standard' | 'High' | 'Very High';
  reference?: string;
  modelLabel?: string;
  esp?: string;
  cfm?: number;
  sourceFile?: string;
}

function clamp(val: number, min: number = 0, max: number = 100): number {
  return Math.min(max, Math.max(min, val));
}

/**
 * Generates and evaluates bounded HVAC system candidates
 */
export function generateSystemCandidates(
  totalLoadBtuPerHour: number,
  _sensibleLoadBtuPerHour: number,
  supplyCfm: number,
  spaceTypeId: string,
  areaSqFt: number,
  isImperial: boolean = true,
  userWeights: Partial<OptimizationWeights> = {},
  selectedSystemTypes?: string[],
  _loadedCatalogs?: {
    decorative: { highWall: any[]; cassette: any[] } | null;
    ducted: any[] | null;
  } | null,
  ductSegments: DuctSegment[] = [],
  diffusers: DiffuserPos[] = []
): RecommendationSummary {
  const weights: OptimizationWeights = { ...DEFAULT_OPTIMIZATION_WEIGHTS, ...userWeights };
  const weightSum = weights.wComfort + weights.wEnergy + weights.wCost + weights.wNoise + weights.wPressure + weights.wSpace + weights.wPreference || 1.0;
  const nw = {
    wComfort: weights.wComfort / weightSum,
    wEnergy: weights.wEnergy / weightSum,
    wCost: weights.wCost / weightSum,
    wNoise: weights.wNoise / weightSum,
    wPressure: weights.wPressure / weightSum,
    wSpace: weights.wSpace / weightSum,
    wPreference: weights.wPreference / weightSum
  };

  const loadBtu = isImperial ? totalLoadBtuPerHour : totalLoadBtuPerHour * 3.412;
  const cfm = supplyCfm > 0 ? supplyCfm : (loadBtu / 12000) * 400;

  let spaceNcLimit = 35;
  if (spaceTypeId === 'conference' || spaceTypeId === 'classroom') spaceNcLimit = 28;
  if (spaceTypeId === 'office') spaceNcLimit = 32;
  if (spaceTypeId === 'lobby' || spaceTypeId === 'retail') spaceNcLimit = 40;

  const catalog = STANDARD_EQUIPMENT_CATALOG;
  const typesToTest = selectedSystemTypes || ['concealed', 'cassette', 'high-wall', 'vrf', 'packaged', 'ahu'];

  const candidates: SystemDesignCandidate[] = [];
  let rejectedCount = 0;
  const allDiagnostics: DiagnosticItem[] = [];

  for (const sysType of typesToTest) {
    const matchingEquip = catalog.filter(e => e.systemType === sysType);

    for (const equip of matchingEquip) {
      const diagnostics: DiagnosticItem[] = [];

      const qtyByTotalCap = Math.ceil(loadBtu / equip.totalCapacityBtuPerHour);
      const qtyByCfm = Math.ceil(cfm / equip.nominalCfm);
      const qty = Math.max(1, qtyByTotalCap, qtyByCfm);
      const installedCap = qty * equip.totalCapacityBtuPerHour;

      const oversizingRatio = installedCap / (loadBtu || 1);
      if (oversizingRatio < 0.98) {
        diagnostics.push({
          code: 'ERR_CAPACITY_DEFICIT',
          severity: 'error',
          componentId: equip.id,
          message: `Installed capacity (${installedCap.toLocaleString()} Btu/h) is less than design load (${Math.round(loadBtu).toLocaleString()} Btu/h).`,
          remediation: `Increase unit quantity to ${qty + 1} or select a larger tonnage unit.`
        });
      }

      const terminalCount = equip.capabilities.supportsExternalDiffusers
        ? Math.max(1, Math.ceil(cfm / 300))
        : qty;
      const flowPerTerminal = Math.round(cfm / terminalCount);
      const diffuserSelection = selectBestDiffuserFromCatalog(flowPerTerminal, spaceNcLimit);

      if (diffuserSelection.actualNc > spaceNcLimit) {
        diagnostics.push({
          code: 'WARN_NOISE_CRITERIA_EXCEEDED',
          severity: 'warning',
          componentId: diffuserSelection.diffuser.id,
          message: `Diffuser noise level (NC ${diffuserSelection.actualNc}) exceeds space limit (NC ${spaceNcLimit}).`,
          remediation: 'Use larger face size diffusers or increase diffuser quantity to lower neck velocity.'
        });
      }

      let criticalPath: CriticalPathResult = {
        pathId: 'none',
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
      let balancingDampers: any[] = [];
      let fanResult = {
        isValid: true,
        operatingCfm: cfm,
        operatingEspInWg: 0,
        fanMarginInWg: 0,
        percentageOverDesignCfm: 0,
        powerKwEstimate: equip.electricalKw * 0.15,
        warningMessages: [] as string[]
      };

      const defaultDuctType = STANDARD_DUCT_TYPES[0];

      if (equip.capabilities.supportsDuctNetwork) {
        if (ductSegments.length > 0 && diffusers.length > 0) {
          criticalPath = solveDirectedNetworkStaticPressure(
            ductSegments,
            diffusers,
            STANDARD_DIFFUSER_CATALOG,
            defaultDuctType
          );
          balancingDampers = calculateBranchBalancingSchedule(criticalPath, diffusers);
        } else {
          const synthDuctLoss = 0.08 + (areaSqFt / 1000) * 0.04;
          const synthDiffuserLoss = diffuserSelection.deltaPInWg || 0.035;
          const synthReturnLoss = 0.04;
          const synthRawLoss = synthDuctLoss + synthDiffuserLoss + synthReturnLoss;
          const synthMargin = synthRawLoss * 0.15;
          criticalPath = {
            pathId: `synth-${equip.id}`,
            terminalId: `term-1`,
            supplySegments: [],
            returnSegments: [],
            totalSupplyDeltaPInWg: Math.round(synthDuctLoss * 1000) / 1000,
            totalReturnDeltaPInWg: Math.round(synthReturnLoss * 1000) / 1000,
            diffuserDeltaPInWg: Math.round(synthDiffuserLoss * 1000) / 1000,
            accessoriesDeltaPInWg: 0.15,
            totalLossInWg: Math.round(synthRawLoss * 1000) / 1000,
            marginInWg: Math.round(synthMargin * 1000) / 1000,
            espRequiredInWg: Math.round((synthRawLoss + synthMargin) * 1000) / 1000
          };
        }

        fanResult = evaluateFanOperatingPoint(equip, Math.round(cfm / qty), criticalPath.espRequiredInWg);

        if (!fanResult.isValid) {
          diagnostics.push({
            code: 'ERR_FAN_ESP_DEFICIT',
            severity: 'error',
            componentId: equip.id,
            message: `Fan available external static pressure (${equip.maxRatedEspInWg} in.wg) is below required system ESP (${criticalPath.espRequiredInWg.toFixed(2)} in.wg).`,
            remediation: 'Select high-static duct indoor model or upsize duct cross-sections to reduce aerodynamic friction.'
          });
        }
      }

      const isValid = !diagnostics.some(d => d.severity === 'error');
      if (!isValid) rejectedCount++;

      const targetThrow = Math.max(8, Math.sqrt(areaSqFt / terminalCount) * 0.5);
      const throwDiff = Math.abs(diffuserSelection.throwT50Ft - targetThrow);
      const sComfort = clamp(100 - (throwDiff / targetThrow) * 80);

      const seerVal = equip.efficiency.seer || (equip.efficiency.copCooling ? equip.efficiency.copCooling * 3.412 : 15);
      const sEnergy = clamp(50 + ((seerVal - 14) / 8) * 50);

      const baseCost = equip.costIndex * qty;
      const sCost = clamp(100 - ((baseCost - 20) / 160) * 100);

      const noiseMargin = spaceNcLimit - diffuserSelection.actualNc;
      const sNoise = clamp(50 + noiseMargin * 8);

      let sPressure = 90;
      if (equip.capabilities.supportsDuctNetwork) {
        const marginRatio = fanResult.fanMarginInWg / (equip.maxRatedEspInWg || 0.4);
        sPressure = clamp(100 - Math.abs(marginRatio - 0.20) * 200);
      }

      const plenumHeight = 24;
      const ductHeight = 10;
      const sSpace = clamp((1 - ductHeight / plenumHeight) * 100);

      let sPreference = 70;
      if (sysType === 'concealed') sPreference = 95;
      if (sysType === 'vrf') sPreference = 85;
      if (sysType === 'cassette' && areaSqFt >= 300) sPreference = 90;

      const rawTotal =
        nw.wComfort * sComfort +
        nw.wEnergy * sEnergy +
        nw.wCost * sCost +
        nw.wNoise * sNoise +
        nw.wPressure * sPressure +
        nw.wSpace * sSpace +
        nw.wPreference * sPreference;

      const totalScore = isValid ? Math.round(clamp(rawTotal)) : Math.min(25, Math.round(rawTotal * 0.3));

      let tradeOffSummary = `Solid ${equip.systemType.toUpperCase()} solution with ${qty} × ${equip.model} unit(s).`;
      if (sEnergy >= 85) tradeOffSummary += ' High energy efficiency reduces seasonal operating costs.';
      if (sCost >= 80) tradeOffSummary += ' Low initial capital investment with standard installation.';
      if (sNoise >= 85) tradeOffSummary += ' Ultra-quiet acoustics ideal for noise-sensitive occupants.';

      allDiagnostics.push(...diagnostics);

      candidates.push({
        id: `cand-${equip.id}-${qty}`,
        systemType: equip.systemType,
        equipment: equip,
        quantity: qty,
        diffusers: {
          diffuserRecord: diffuserSelection.diffuser,
          quantity: terminalCount,
          cfmPerUnit: flowPerTerminal,
          actualNc: diffuserSelection.actualNc,
          throwT50Ft: diffuserSelection.throwT50Ft,
          deltaPInWg: diffuserSelection.deltaPInWg
        },
        ductwork: equip.capabilities.supportsDuctNetwork
          ? {
              ductType: defaultDuctType,
              totalDuctLengthFt: Math.round(areaSqFt * 0.08),
              maxVelocityFpm: 1100,
              criticalPath,
              balancingDampers
            }
          : undefined,
        fanOperatingPoint: fanResult,
        isValid,
        diagnostics,
        subscores: {
          sComfort: Math.round(sComfort),
          sEnergy: Math.round(sEnergy),
          sCost: Math.round(sCost),
          sNoise: Math.round(sNoise),
          sPressure: Math.round(sPressure),
          sSpace: Math.round(sSpace),
          sPreference: Math.round(sPreference),
          totalScore
        },
        tradeOffSummary
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.isValid !== b.isValid) return a.isValid ? -1 : 1;
    return b.subscores.totalScore - a.subscores.totalScore;
  });

  const validCandidates = candidates.filter(c => c.isValid);

  const bestOverall = validCandidates[0] || null;
  const bestEnergy = [...validCandidates].sort((a, b) => b.subscores.sEnergy - a.subscores.sEnergy)[0] || null;
  const lowestCost = [...validCandidates].sort((a, b) => b.subscores.sCost - a.subscores.sCost)[0] || null;
  const lowestNoise = [...validCandidates].sort((a, b) => b.subscores.sNoise - a.subscores.sNoise)[0] || null;

  if (bestOverall) bestOverall.categoryRankings = { ...bestOverall.categoryRankings, isBestOverall: true };
  if (bestEnergy) bestEnergy.categoryRankings = { ...bestEnergy.categoryRankings, isBestEnergy: true };
  if (lowestCost) lowestCost.categoryRankings = { ...lowestCost.categoryRankings, isLowestCost: true };
  if (lowestNoise) lowestNoise.categoryRankings = { ...lowestNoise.categoryRankings, isLowestNoise: true };

  return {
    candidates: candidates.slice(0, 16),
    bestOverall,
    bestEnergy,
    lowestCost,
    lowestNoise,
    rejectedCount,
    diagnostics: allDiagnostics
  };
}

/**
 * Backward-compatible helper for legacy recommendation panel
 */
export function recommendSystemsForZone(
  areaSqFt: number,
  totalLoadBtu: number,
  spaceTypeId: string,
  isImperial: boolean,
  supplyCfm?: number,
  loadedCatalogs?: any
): LegacySystemRecommendation[] {
  const result = generateSystemCandidates(
    totalLoadBtu,
    totalLoadBtu * 0.75,
    supplyCfm || 0,
    spaceTypeId,
    areaSqFt,
    isImperial,
    {},
    undefined,
    loadedCatalogs
  );

  return result.candidates.map(cand => {
    const estCost: 'Low' | 'Medium' | 'Medium-High' | 'High' | 'Very High' =
      cand.equipment.costIndex <= 35 ? 'Low' : cand.equipment.costIndex <= 60 ? 'Medium' : cand.equipment.costIndex <= 75 ? 'Medium-High' : cand.equipment.costIndex <= 90 ? 'High' : 'Very High';

    const estEfficiency: 'Standard' | 'High' | 'Very High' =
      cand.subscores.sEnergy >= 85 ? 'Very High' : cand.subscores.sEnergy >= 65 ? 'High' : 'Standard';

    return {
      type: cand.systemType,
      name: `${cand.equipment.manufacturer} ${cand.equipment.model} (${cand.systemType.toUpperCase()})`,
      score: cand.subscores.totalScore,
      reason: cand.tradeOffSummary,
      pros: [
        `Installed Capacity: ${(cand.quantity * cand.equipment.totalCapacityBtuPerHour).toLocaleString()} Btu/h`,
        cand.equipment.capabilities.hasExternalStaticPressure
          ? `Rated ESP: ${cand.equipment.maxRatedEspInWg.toFixed(2)} in.wg`
          : 'Direct quiet air distribution without duct resistance'
      ],
      cons: cand.isValid ? [] : ['Fails engineering validation constraints'],
      estUnits: cand.quantity,
      unitCapacity: cand.equipment.totalCapacityBtuPerHour,
      estCost,
      estEfficiency,
      reference: cand.equipment.provenance.source,
      modelLabel: cand.equipment.model,
      cfm: cand.quantity * cand.equipment.nominalCfm,
      esp: cand.equipment.capabilities.hasExternalStaticPressure ? `${cand.equipment.maxRatedEspInWg.toFixed(2)} in.wg` : undefined,
      sourceFile: cand.equipment.provenance.source
    };
  });
}

/**
 * Backward-compatible helper for legacy zone property queries
 */
export function getCatalogSizingForZone(
  systemType: string | undefined,
  loadBtu: number,
  supplyCfm: number,
  loadedCatalogs?: any
): { qty: number; model: string; esp?: string } {
  const result = generateSystemCandidates(
    loadBtu,
    loadBtu * 0.75,
    supplyCfm,
    'office',
    400,
    true,
    {},
    systemType ? [systemType] : undefined,
    loadedCatalogs
  );

  const best = result.bestOverall || result.candidates[0];
  if (best) {
    return {
      qty: best.quantity,
      model: best.equipment.model,
      esp: best.equipment.capabilities.hasExternalStaticPressure
        ? `${best.equipment.maxRatedEspInWg.toFixed(2)} in.wg`
        : undefined
    };
  }

  return { qty: 1, model: '' };
}
