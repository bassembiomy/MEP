import {
  SystemDesignCandidate,
  DiffuserDistributionOption,
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
import { estimateRoutedPathPressure, availableFanPressureAtFlow } from './pressureBudget';
import { DuctSegment } from '../store/projectStore';
import { DiffuserPos } from './diffuserPlacer';
import { verifyDuctSectionAcoustics } from './acousticDuctEngine';
import {
  generateSystemArchitecture,
  generateSelectionAlgorithmTrace
} from './hvacArchitecture';
import { LITERS_PER_SECOND_PER_CFM, WATTS_PER_BTU_PER_HOUR, METERS_PER_FOOT } from './engineeringInputs';

// Design Optimization Priority:
// Required Room CFM -> Thermal Comfort -> Acoustic Noise Criterion -> Maximum Air Velocity & Pressure Loss -> Fan Static Pressure -> Duct Space & Cost
export const DEFAULT_OPTIMIZATION_WEIGHTS: OptimizationWeights = {
  wComfort: 0.25,
  wNoise: 0.20,
  wPressure: 0.15,
  wEnergy: 0.15,
  wCost: 0.10,
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
  type: 'high-wall' | 'cassette' | 'concealed' | 'packaged' | 'vrf' | 'ahu' | 'fcu';
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
 * Generates all valid air distribution & diffuser count configurations for a given total CFM and room area
 */
export function generateDiffuserDistributionOptions(
  totalCfm: number,
  areaSqFt: number,
  spaceNcLimit: number = 30,
  isDucted: boolean = true
): DiffuserDistributionOption[] {
  if (!isDucted || totalCfm <= 0) return [];

  // Generate viable count candidates
  const countCandidates = [1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24].filter(cnt => {
    const flow = totalCfm / cnt;
    return flow >= 120 && flow <= 650;
  });

  const options: DiffuserDistributionOption[] = [];
  const seenCounts = new Set<number>();

  for (const count of countCandidates) {
    if (seenCounts.has(count)) continue;
    seenCounts.add(count);

    const cfmPerDiffuser = Math.round(totalCfm / count);
    const targetThrow = Math.max(6, Math.min(30, 0.95 * Math.sqrt(Math.max(20, areaSqFt / count))));
    const selection = selectBestDiffuserFromCatalog(cfmPerDiffuser, spaceNcLimit, undefined, targetThrow);

    const faceSize = selection.diffuser.faceSizeIn
      ? `${selection.diffuser.faceSizeIn.width}"x${selection.diffuser.faceSizeIn.height}"`
      : '24"x24"';
    const neckSize = selection.diffuser.neckSizeIn
      ? (selection.diffuser.neckSizeIn.diameter ? `Ø${selection.diffuser.neckSizeIn.diameter}"` : `${selection.diffuser.neckSizeIn.width}"x${selection.diffuser.neckSizeIn.height}"`)
      : '10"x10"';

    let label = 'Standard Commercial';
    let isRecommended = false;

    if (cfmPerDiffuser >= 280 && cfmPerDiffuser <= 380) {
      label = `Standard Commercial (${count} @ ${cfmPerDiffuser} CFM)`;
      isRecommended = true;
    } else if (cfmPerDiffuser > 380) {
      label = `High-Capacity Minimal Units (${count} @ ${cfmPerDiffuser} CFM)`;
    } else if (cfmPerDiffuser >= 200 && cfmPerDiffuser < 280) {
      label = `Ultra-Quiet Comfort (${count} @ ${cfmPerDiffuser} CFM)`;
    } else {
      label = `Dense Low-Velocity (${count} @ ${cfmPerDiffuser} CFM)`;
    }

    const covEst = Math.min(100, Math.max(90, Math.round(95 + (count >= 4 ? 4 : 0) - (selection.actualNc > spaceNcLimit ? 5 : 0))));

    options.push({
      diffuserCount: count,
      cfmPerDiffuser,
      diffuserRecord: selection.diffuser,
      faceSizeLabel: faceSize,
      neckSizeLabel: neckSize,
      actualNc: selection.actualNc,
      throwT50Ft: selection.throwT50Ft,
      deltaPInWg: selection.deltaPInWg,
      estimatedCoveragePercent: covEst,
      label,
      isRecommended
    });
  }

  // Ensure at least one is recommended
  if (options.length > 0 && !options.some(o => o.isRecommended)) {
    let bestIdx = 0;
    let minD = Infinity;
    options.forEach((o, i) => {
      const d = Math.abs(o.cfmPerDiffuser - 320);
      if (d < minD) {
        minD = d;
        bestIdx = i;
      }
    });
    options[bestIdx].isRecommended = true;
    options[bestIdx].label = `Recommended Standard (${options[bestIdx].diffuserCount} @ ${options[bestIdx].cfmPerDiffuser} CFM)`;
  }

  return options;
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
  diffusers: DiffuserPos[] = [],
  roomExtentFt?: { widthFt: number; heightFt: number }
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

  const loadBtu = totalLoadBtuPerHour / (isImperial ? 1 : WATTS_PER_BTU_PER_HOUR);
  const sensibleBtu = _sensibleLoadBtuPerHour / (isImperial ? 1 : WATTS_PER_BTU_PER_HOUR);
  const latentBtu = loadBtu - sensibleBtu;
  const cfm = supplyCfm / (isImperial ? 1 : LITERS_PER_SECOND_PER_CFM);
  areaSqFt = areaSqFt / (isImperial ? 1 : METERS_PER_FOOT * METERS_PER_FOOT);
  if (![loadBtu, sensibleBtu, latentBtu, cfm, areaSqFt].every(Number.isFinite) ||
      loadBtu < 0 || sensibleBtu < 0 || latentBtu < 0 || cfm < 0 || areaSqFt <= 0) {
    return { candidates: [], bestOverall: null, bestEnergy: null, lowestCost: null, lowestNoise: null,
      rejectedCount: 0, diagnostics: [{ code: 'ERR_INVALID_ENGINEERING_INPUT', severity: 'error',
        message: 'Finite nonnegative loads and airflow, and positive area are required.',
        remediation: 'Correct the zone inputs before evaluating equipment.' }] };
  }

  let spaceNcLimit = 35;
  if (spaceTypeId === 'conference' || spaceTypeId === 'classroom') spaceNcLimit = 28;
  if (spaceTypeId === 'office') spaceNcLimit = 32;
  if (spaceTypeId === 'lobby' || spaceTypeId === 'retail') spaceNcLimit = 40;

  const catalog = STANDARD_EQUIPMENT_CATALOG;
  const typesToTest = selectedSystemTypes && selectedSystemTypes.length > 0
    ? selectedSystemTypes
    : ['fcu', 'packaged', 'ahu', 'concealed', 'vrf', 'cassette', 'high-wall'];

  const candidates: SystemDesignCandidate[] = [];
  let rejectedCount = 0;
  const allDiagnostics: DiagnosticItem[] = [];

  for (const sysType of typesToTest) {
    const matchingEquip = catalog.filter(e => e.systemType === sysType);

    for (const equip of matchingEquip) {
      const diagnostics: DiagnosticItem[] = [];
      const latentCapacity = equip.totalCapacityBtuPerHour - equip.sensibleCapacityBtuPerHour;
      if (![equip.totalCapacityBtuPerHour, equip.sensibleCapacityBtuPerHour, equip.nominalCfm].every(v => Number.isFinite(v) && v > 0) ||
          !Number.isFinite(latentCapacity) || latentCapacity < 0 || (latentCapacity === 0 && latentBtu > 0)) continue;

      const qtyByTotalCap = Math.ceil(loadBtu / equip.totalCapacityBtuPerHour);
      const qtyByCfm = Math.ceil(cfm / equip.nominalCfm);
      const qtyBySensible = Math.ceil(sensibleBtu / equip.sensibleCapacityBtuPerHour);
      const qtyByLatent = latentBtu > 0 ? Math.ceil(latentBtu / latentCapacity) : 0;
      const qty = Math.max(1, qtyByTotalCap, qtyByCfm, qtyBySensible, qtyByLatent);
      const installedCap = qty * equip.totalCapacityBtuPerHour;

      const oversizingRatio = installedCap / (loadBtu || 1);
      if (oversizingRatio < 1) {
        diagnostics.push({
          code: 'ERR_CAPACITY_DEFICIT',
          severity: 'error',
          componentId: equip.id,
          message: `Installed capacity (${installedCap.toLocaleString()} Btu/h) is less than design load (${Math.round(loadBtu).toLocaleString()} Btu/h).`,
          remediation: `Increase unit quantity to ${qty + 1} or select a larger tonnage unit.`
        });
      }

      const perUnitCfm = cfm / qty;
      if (equip.capabilities.supportsDuctNetwork && (perUnitCfm < equip.minCfm || perUnitCfm > equip.maxCfm)) {
        diagnostics.push({
          code: 'ERR_AIRFLOW_OUTSIDE_EQUIPMENT_RANGE',
          severity: 'error',
          componentId: equip.id,
          message: `Per-unit airflow (${Math.round(perUnitCfm)} CFM) lies outside the rated fan range ${equip.minCfm}–${equip.maxCfm} CFM.`,
          remediation: 'Select equipment whose rated airflow range covers the design airflow per unit, or revise the zone airflow.'
        });
      }

      const distributionOptions = generateDiffuserDistributionOptions(
        cfm,
        areaSqFt,
        spaceNcLimit,
        equip.capabilities.supportsExternalDiffusers
      );

      const recommendedOption = distributionOptions.find(o => o.isRecommended) || distributionOptions[0];

      let terminalCount = recommendedOption
        ? recommendedOption.diffuserCount
        : (equip.capabilities.supportsExternalDiffusers ? Math.max(1, Math.ceil(cfm / 335)) : qty);
      let flowPerTerminal = recommendedOption ? recommendedOption.cfmPerDiffuser : Math.round(cfm / terminalCount);
      let targetThrowDb = Math.max(
        6,
        Math.min(30, 0.9 * Math.sqrt(Math.max(20, areaSqFt / terminalCount)))
      );
      let diffuserSelection = recommendedOption ? {
        diffuser: recommendedOption.diffuserRecord,
        actualNc: recommendedOption.actualNc,
        throwT50Ft: recommendedOption.throwT50Ft,
        deltaPInWg: recommendedOption.deltaPInWg
      } : selectBestDiffuserFromCatalog(flowPerTerminal, spaceNcLimit, undefined, targetThrowDb);

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
          // Without a real room extent assume a 4:1 plan (not 2:1, which under-estimates the run of an elongated
          // room); pass roomExtentFt whenever the zone geometry is known.
          const extent = roomExtentFt ?? { widthFt: 1.06 * 2 * Math.sqrt(areaSqFt), heightFt: 1.06 * 0.5 * Math.sqrt(areaSqFt) };
          const est = estimateRoutedPathPressure({
            terminalsPerUnit: terminalCount / qty,
            perUnitCfm: cfm / qty,
            diffuserDeltaPInWg: diffuserSelection.deltaPInWg || 0.035,
            widthFt: extent.widthFt,
            heightFt: extent.heightFt
          });
          const r3 = (v: number) => Math.round(v * 1000) / 1000;
          criticalPath = {
            pathId: `est-${equip.id}`,
            terminalId: `term-1`,
            supplySegments: [],
            returnSegments: [],
            totalSupplyDeltaPInWg: r3(est.supplyDuctInWg + est.supplyFittingsInWg),
            totalReturnDeltaPInWg: r3(est.returnPathInWg),
            diffuserDeltaPInWg: r3(est.diffuserInWg),
            accessoriesDeltaPInWg: est.filterInWg,
            totalLossInWg: r3(est.totalLossInWg),
            marginInWg: r3(est.requiredEspInWg - est.totalLossInWg),
            // Round up, never down, so rounding cannot add to the empirical shortfall against deployment (see pressureBudget.ts).
            espRequiredInWg: Math.ceil(est.requiredEspInWg * 1000) / 1000
          };
        }

        const perUnitCfm = cfm / qty;
        let availableEsp: number | undefined;
        let curveError: string | undefined;
        try {
          availableEsp = availableFanPressureAtFlow(equip, perUnitCfm);
        } catch (err) {
          curveError = err instanceof Error ? err.message : String(err);
        }
        // Power and warnings come from the legacy evaluator; the verdict and margin come from the deployment curve.
        const legacy = evaluateFanOperatingPoint(equip, perUnitCfm, criticalPath.espRequiredInWg);
        const fanMargin = availableEsp === undefined ? -criticalPath.espRequiredInWg : availableEsp - criticalPath.espRequiredInWg;
        fanResult = {
          ...legacy,
          isValid: availableEsp !== undefined && fanMargin >= -1e-8,
          operatingCfm: perUnitCfm,
          operatingEspInWg: Math.round(criticalPath.espRequiredInWg * 1000) / 1000,
          fanMarginInWg: Math.round(fanMargin * 1000) / 1000
        };

        if (availableEsp === undefined) {
          // The per-unit flow range is already reported separately above; do not double count it.
          if (!diagnostics.some((d) => d.code === 'ERR_AIRFLOW_OUTSIDE_EQUIPMENT_RANGE')) {
            diagnostics.push({
              code: 'ERR_FAN_CURVE_UNAVAILABLE',
              severity: 'error',
              componentId: equip.id,
              message: `No published fan pressure at ${Math.round(perUnitCfm)} CFM per unit: ${curveError}.`,
              remediation: 'Select equipment whose fan curve covers the per-unit design airflow.'
            });
          }
        } else if (fanMargin < -1e-8) {
          diagnostics.push({
            code: 'ERR_FAN_ESP_DEFICIT',
            severity: 'error',
            componentId: equip.id,
            message: `Fan available external static pressure (${availableEsp.toFixed(2)} in.wg at ${Math.round(perUnitCfm)} CFM) is below required system ESP (${criticalPath.espRequiredInWg.toFixed(2)} in.wg).`,
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

      // Capture closure variables for lazy generation
      const _lazyEquip = equip;
      const _lazyQty = qty;
      const _lazyCfm = cfm;
      const _lazyAreaSqFt = areaSqFt;
      const _lazyLoadBtu = loadBtu;
      const _lazyIsImperial = true; // Lazy engine inputs above are already canonical.
      const _lazyTerminalCount = terminalCount;
      const _lazyDiffuserSelection = diffuserSelection;
      const _lazySensible = sensibleBtu;
      const _lazySpaceNcLimit = spaceNcLimit;
      const _lazyCriticalPath = criticalPath;
      const _lazyFanResult = fanResult;

      const candidateObj: SystemDesignCandidate = {
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
        diffuserDistributionOptions: distributionOptions,
        ductwork: equip.capabilities.supportsDuctNetwork
          ? {
              ductType: defaultDuctType,
              totalDuctLengthFt: Math.round(areaSqFt * 0.08),
              maxVelocityFpm: 1100,
              criticalPath,
              balancingDampers,
              acousticVerifications: ductSegments.map((d) =>
                d.acousticVerification ||
                verifyDuctSectionAcoustics(d, {
                  zoneName: 'Candidate Zone',
                  targetNc: spaceNcLimit
                })
              )
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
        tradeOffSummary,
        // Lazy-initialize architecture and trace only when accessed (avoids O(N) heavy computation for all candidates)
        get systemArchitecture() {
          const value = generateSystemArchitecture(
            _lazyEquip, _lazyQty, _lazyCfm, _lazyAreaSqFt, _lazyLoadBtu, _lazyIsImperial,
            { quantity: _lazyTerminalCount, diffuserRecord: _lazyDiffuserSelection.diffuser, actualNc: _lazyDiffuserSelection.actualNc }
          );
          Object.defineProperty(this, 'systemArchitecture', { value, writable: true, configurable: true });
          return value;
        },
        get algorithmTrace() {
          const value = generateSelectionAlgorithmTrace(
            _lazyEquip, _lazyQty, _lazyCfm, _lazyAreaSqFt, _lazyLoadBtu, _lazySensible,
            _lazySpaceNcLimit, _lazyCriticalPath, _lazyFanResult, _lazyIsImperial
          );
          Object.defineProperty(this, 'algorithmTrace', { value, writable: true, configurable: true });
          return value;
        }
      };

      candidates.push(candidateObj);
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
  loadedCatalogs?: any,
  roomExtentFt?: { widthFt: number; heightFt: number }
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
    loadedCatalogs,
    [],
    [],
    roomExtentFt
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
  loadedCatalogs?: any,
  roomExtentFt?: { widthFt: number; heightFt: number }
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
    loadedCatalogs,
    [],
    [],
    roomExtentFt
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
