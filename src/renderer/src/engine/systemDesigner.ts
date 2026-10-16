import {
  SystemDesignCandidate,
  OptimizationWeights,
  DiagnosticItem,
  CriticalPathResult,
  EquipmentCatalogItem
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
import { verifyDuctSectionAcoustics } from './acousticDuctEngine';
import {
  generateSystemArchitecture,
  generateSelectionAlgorithmTrace
} from './hvacArchitecture';
import { BTUH_PER_TON, SQFT_PER_SQM, toBtuh, toCfm, toSqFt } from './units';
import {
  sizeUnitQuantity,
  deliveredCfmFor,
  ambientDerateFactor,
  SizingCheck,
  RATING_AMBIENT_F,
  VRF_COMBINATION_MIN,
  VRF_COMBINATION_MAX,
  VRF_COMBINATION_TARGET_MIN,
  VRF_COMBINATION_TARGET_MAX,
  AIRFLOW_RATIO_MIN,
  AIRFLOW_RATIO_MAX
} from './systemArchitecture/equipmentSelector';
import { MIN_CEILING_CLEARANCE_IN } from './systemArchitecture/equipmentOptimizer';

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

/** Planning airflow when the caller supplies none (CFM per ton of cooling). */
const DEFAULT_CFM_PER_TON = 400;
/** Fallback sensible fraction of the total load when no sensible load is supplied. */
const DEFAULT_SENSIBLE_FRACTION = 0.75;
/** Assumed ceiling plenum depth (in) when the caller does not supply one. */
const DEFAULT_PLENUM_DEPTH_IN = 24;
/** Planning duct depth (in) used by the space score when the ceiling depth is unknown. */
const DEFAULT_DUCT_DEPTH_IN = 10;
/** Nominal zone area (ft²) assumed when a caller supplies none. */
const DEFAULT_ZONE_AREA_SQFT = 400;

/** Design candidate = catalog candidate + sizing evidence (additive, backward compatible). */
export interface DesignCandidate extends SystemDesignCandidate {
  /** Installed capacity delivered to the room (Btu/h). For VRF this is the indoor-unit sum. */
  installedCapacityBtu?: number;
  /** Installed capacity / coil load (nominal rating). */
  capacityRatio?: number;
  /** Delivered airflow (CFM). For VRF this is the indoor-unit airflow, never the outdoor unit's. */
  deliveredCfm?: number;
  /** VRF only: the separately selected indoor unit model. */
  indoorUnit?: EquipmentCatalogItem;
  /** VRF only: number of indoor units (== quantity). */
  indoorQuantity?: number;
  /** VRF only: sum of indoor rated capacity / outdoor capacity. */
  combinationRatio?: number;
}

export interface RecommendationSummary {
  candidates: DesignCandidate[];
  bestOverall: DesignCandidate | null;
  bestEnergy: DesignCandidate | null;
  lowestCost: DesignCandidate | null;
  lowestNoise: DesignCandidate | null;
  rejectedCount: number;
  diagnostics: DiagnosticItem[];
}

export interface SystemDesignOptions {
  /** Deepest ceiling void available (in) for ceiling-mounted equipment. */
  maxAvailableCeilingDepthIn?: number;
  /** Include fan-coil units in the default system-type list (chilled water is available on site). */
  chilledWaterAvailable?: boolean;
  /** Design outdoor dry-bulb (F); capacity is derated above the 95F rating condition. */
  designAmbientF?: number;
  /** VRF/split refrigerant piping inputs; limits are enforced only when provided. */
  equivalentPipeLengthM?: number;
  heightDifferenceM?: number;
  /** Equipment catalog override (defaults to STANDARD_EQUIPMENT_CATALOG). */
  catalog?: EquipmentCatalogItem[];
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

function sizingDiagnostics(equip: EquipmentCatalogItem, s: SizingCheck, loadBtu: number, cfm: number, label: string = ''): DiagnosticItem[] {
  const out: DiagnosticItem[] = [];
  const pct = (r: number): string => `${(r * 100).toFixed(0)}%`;
  const prefix = label ? `${label}: ` : '';
  if (s.failures.includes('DEFICIT')) {
    out.push({
      code: 'ERR_CAPACITY_DEFICIT',
      severity: 'error',
      componentId: equip.id,
      message: `${prefix}Derated installed capacity (${Math.round(s.installedCapacityBtu * s.derate).toLocaleString()} Btu/h) is less than design load (${Math.round(loadBtu).toLocaleString()} Btu/h).`,
      remediation: `Increase unit quantity to ${s.qty + 1} or select a larger tonnage unit.`
    });
  }
  if (s.failures.includes('OVERSIZE')) {
    out.push({
      code: 'ERR_CAPACITY_OVERSIZE',
      severity: 'error',
      componentId: equip.id,
      message: `${prefix}Installed capacity is ${pct(s.capacityRatio)} of design load; the limit is ${pct(s.maxCapacityRatio)}.`,
      remediation: 'Select a smaller unit or split the load across smaller units to avoid short-cycling and poor humidity control.'
    });
  }
  if (s.failures.includes('SENSIBLE')) {
    out.push({
      code: 'ERR_SENSIBLE_DEFICIT',
      severity: 'error',
      componentId: equip.id,
      message: `${prefix}Sensible capacity is only ${pct(s.sensibleRatio)} of the room sensible load.`,
      remediation: 'Select a unit with a higher sensible heat ratio or a larger coil.'
    });
  }
  if (s.failures.includes('AIRFLOW_LOW') || s.failures.includes('AIRFLOW_HIGH')) {
    out.push({
      code: 'ERR_AIRFLOW_MISMATCH',
      severity: 'error',
      componentId: equip.id,
      message: `${prefix}Delivered airflow is ${pct(s.airflowRatio)} of the required ${Math.round(cfm).toLocaleString()} CFM (allowed ${pct(AIRFLOW_RATIO_MIN)}-${pct(AIRFLOW_RATIO_MAX)}).`,
      remediation: 'Select a unit whose nominal airflow matches the room supply airflow.'
    });
  }
  for (const w of s.warnings) {
    out.push({
      code: w,
      severity: 'warning',
      componentId: equip.id,
      message:
        w === 'NEXT_NOMINAL_SIZE'
          ? `${prefix}No catalog size fits the ${pct(s.maxCapacityRatio)} oversize window; the next nominal size up is accepted at ${pct(s.capacityRatio)} of design load (ACCA Manual S).`
          : `${prefix}Design load is below the smallest available unit; the smallest size is accepted at ${pct(s.capacityRatio)} of design load.`,
      remediation: 'Verify part-load operation (inverter turndown / staging) and humidity control.'
    });
  }
  return out;
}

/**
 * Generates and evaluates bounded HVAC system candidates.
 *
 * Units contract: with `isImperial = true` the inputs are Btu/h, CFM and ft²; with `false` they are W, L/s and m².
 * Everything is converted ONCE here (engine/units.ts) and the rest of the pipeline runs on Btu/h, CFM, ft².
 */
export function generateSystemCandidates(
  totalLoadBtuPerHour: number,
  sensibleLoadBtuPerHour: number,
  supplyCfm: number,
  spaceTypeId: string,
  areaSqFtInput: number,
  isImperial: boolean = true,
  userWeights: Partial<OptimizationWeights> = {},
  selectedSystemTypes?: string[],
  _loadedCatalogs?: {
    decorative: { highWall: any[]; cassette: any[] } | null;
    ducted: any[] | null;
  } | null,
  ductSegments: DuctSegment[] = [],
  diffusers: DiffuserPos[] = [],
  options: SystemDesignOptions = {}
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

  // ---- Single conversion point: project units -> Btu/h, CFM, ft² -------------------------------
  const unitSystem = isImperial ? 'imperial' : 'metric';
  const loadBtu = toBtuh(totalLoadBtuPerHour, unitSystem);
  const sensBtu = sensibleLoadBtuPerHour > 0 ? toBtuh(sensibleLoadBtuPerHour, unitSystem) : loadBtu * DEFAULT_SENSIBLE_FRACTION;
  const cfm = supplyCfm > 0 ? toCfm(supplyCfm, unitSystem) : (loadBtu / BTUH_PER_TON) * DEFAULT_CFM_PER_TON;
  const areaSqFt = areaSqFtInput > 0 ? toSqFt(areaSqFtInput, unitSystem) : DEFAULT_ZONE_AREA_SQFT;
  const designAmbientF = options.designAmbientF ?? RATING_AMBIENT_F;
  const derate = ambientDerateFactor(designAmbientF);
  const ceilingDepthIn = options.maxAvailableCeilingDepthIn;

  let spaceNcLimit = 35;
  if (spaceTypeId === 'conference' || spaceTypeId === 'classroom') spaceNcLimit = 28;
  if (spaceTypeId === 'office') spaceNcLimit = 32;
  if (spaceTypeId === 'lobby' || spaceTypeId === 'retail') spaceNcLimit = 40;

  const catalog = options.catalog || STANDARD_EQUIPMENT_CATALOG;
  const defaultTypes = ['concealed', 'cassette', 'high-wall', 'vrf', 'packaged', 'ahu'];
  if (options.chilledWaterAvailable) defaultTypes.push('fcu');
  const typesToTest = selectedSystemTypes || defaultTypes;

  const candidates: DesignCandidate[] = [];
  let rejectedCount = 0;
  const allDiagnostics: DiagnosticItem[] = [];

  /**
   * Builds, scores and records one candidate.
   * `equip` is the selected primary equipment (VRF: the outdoor module); `qty` the installed quantity
   * (VRF: number of indoor units); `indoorUnit` the separately selected VRF indoor model.
   */
  const buildCandidate = (
    equip: EquipmentCatalogItem,
    qty: number,
    seedDiagnostics: DiagnosticItem[],
    ctx: {
      sizing?: SizingCheck;
      indoorUnit?: EquipmentCatalogItem;
      indoorTotalCapacityBtu?: number;
      combinationRatio?: number;
      idSuffix?: string;
    } = {}
  ): void => {
    const sysType = equip.systemType;
    const diagnostics: DiagnosticItem[] = [...seedDiagnostics];
    // The unit that actually moves air into the room.
    const airEquip = ctx.indoorUnit || equip;

    const terminalCount = airEquip.capabilities.supportsExternalDiffusers
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
      powerKwEstimate: airEquip.electricalKw * 0.15,
      warningMessages: [] as string[]
    };

    const defaultDuctType = STANDARD_DUCT_TYPES[0];

    if (airEquip.capabilities.supportsDuctNetwork) {
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
          pathId: `synth-${airEquip.id}`,
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

      fanResult = evaluateFanOperatingPoint(airEquip, Math.round(cfm / qty), criticalPath.espRequiredInWg);

      if (!fanResult.isValid) {
        diagnostics.push({
          code: 'ERR_FAN_ESP_DEFICIT',
          severity: 'error',
          componentId: airEquip.id,
          message: `Fan available external static pressure (${airEquip.maxRatedEspInWg} in.wg) is below required system ESP (${criticalPath.espRequiredInWg.toFixed(2)} in.wg).`,
          remediation: 'Select high-static duct indoor model or upsize duct cross-sections to reduce aerodynamic friction.'
        });
      }
    }

    // Ceiling-mounted equipment must fit the real void: unit height + minimum clearance.
    const ceilingMounted = airEquip.systemType === 'concealed' || airEquip.systemType === 'cassette' || airEquip.systemType === 'fcu';
    const requiredVoidIn = airEquip.dimensionsIn.height + MIN_CEILING_CLEARANCE_IN;
    if (ceilingDepthIn !== undefined && ceilingMounted && requiredVoidIn > ceilingDepthIn) {
      diagnostics.push({
        code: 'WARN_CEILING_VOID_INSUFFICIENT',
        severity: 'warning',
        componentId: airEquip.id,
        message: `Unit needs ${requiredVoidIn.toFixed(1)} in. of ceiling void (height ${airEquip.dimensionsIn.height} in. + ${MIN_CEILING_CLEARANCE_IN} in. clearance) but only ${ceilingDepthIn} in. is available.`,
        remediation: 'Select a lower-profile unit, a cassette/wall unit, or increase the ceiling void.'
      });
    }

    const isValid = !diagnostics.some(d => d.severity === 'error');
    if (!isValid) rejectedCount++;

    const targetThrow = Math.max(8, Math.sqrt(areaSqFt / terminalCount) * 0.5);
    const throwDiff = Math.abs(diffuserSelection.throwT50Ft - targetThrow);
    const sComfort = clamp(100 - (throwDiff / targetThrow) * 80);

    const seerVal = equip.efficiency.seer || (equip.efficiency.copCooling ? equip.efficiency.copCooling * 3.412 : 15);
    const sEnergy = clamp(50 + ((seerVal - 14) / 8) * 50);

    const baseCost = (ctx.indoorUnit ? ctx.indoorUnit.costIndex * qty + equip.costIndex : equip.costIndex * qty);
    const sCost = clamp(100 - ((baseCost - 20) / 160) * 100);

    const noiseMargin = spaceNcLimit - diffuserSelection.actualNc;
    const sNoise = clamp(50 + noiseMargin * 8);

    let sPressure = 90;
    if (airEquip.capabilities.supportsDuctNetwork) {
      const marginRatio = fanResult.fanMarginInWg / (airEquip.maxRatedEspInWg || 0.4);
      sPressure = clamp(100 - Math.abs(marginRatio - 0.20) * 200);
    }

    // Space score: real ceiling depth when known, otherwise the planning plenum.
    const plenumHeight = ceilingDepthIn ?? DEFAULT_PLENUM_DEPTH_IN;
    const ductHeight = ceilingDepthIn !== undefined && ceilingMounted ? requiredVoidIn : DEFAULT_DUCT_DEPTH_IN;
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

    const unitLabel = ctx.indoorUnit
      ? `${equip.model} outdoor + ${qty} × ${ctx.indoorUnit.model} indoor`
      : `${qty} × ${equip.model} unit(s)`;
    let tradeOffSummary = `Solid ${equip.systemType.toUpperCase()} solution with ${unitLabel}.`;
    if (sEnergy >= 85) tradeOffSummary += ' High energy efficiency reduces seasonal operating costs.';
    if (sCost >= 80) tradeOffSummary += ' Low initial capital investment with standard installation.';
    if (sNoise >= 85) tradeOffSummary += ' Ultra-quiet acoustics ideal for noise-sensitive occupants.';

    const installedCapacityBtu = ctx.indoorTotalCapacityBtu ?? qty * equip.totalCapacityBtuPerHour;
    const deliveredCfm = deliveredCfmFor(airEquip, qty, cfm);

    const systemArchitecture = generateSystemArchitecture(
      equip,
      qty,
      cfm,
      areaSqFt,
      loadBtu,
      isImperial,
      {
        quantity: terminalCount,
        diffuserRecord: diffuserSelection.diffuser,
        actualNc: diffuserSelection.actualNc
      },
      undefined,
      ctx.indoorUnit ? { indoorUnit: ctx.indoorUnit } : undefined
    );

    const algorithmTrace = generateSelectionAlgorithmTrace(
      equip,
      qty,
      cfm,
      areaSqFt,
      loadBtu,
      sensBtu,
      spaceNcLimit,
      criticalPath,
      fanResult,
      isImperial,
      {
        designAmbientF,
        indoorTotalCapacityBtu: ctx.indoorTotalCapacityBtu,
        equivalentPipeLengthM: options.equivalentPipeLengthM,
        heightDifferenceM: options.heightDifferenceM
      }
    );
    // The 7-step trace is the single record of engineering compliance: a failed step invalidates the candidate.
    const traceFailures = algorithmTrace.steps.filter((s) => !s.passed && s.stepNumber === 7);
    const finalValid = isValid && traceFailures.length === 0;
    if (isValid && !finalValid) {
      rejectedCount++;
      for (const f of traceFailures) {
        diagnostics.push({
          code: 'ERR_PIPING_LIMIT',
          severity: 'error',
          componentId: equip.id,
          message: String(f.calculatedValue),
          remediation: 'Relocate the outdoor unit, shorten the refrigerant run or select a different combination.'
        });
      }
    }

    allDiagnostics.push(...diagnostics);

    candidates.push({
      id: `cand-${equip.id}-${qty}${ctx.idSuffix ? '-' + ctx.idSuffix : ''}`,
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
      ductwork: airEquip.capabilities.supportsDuctNetwork
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
      isValid: finalValid,
      diagnostics,
      subscores: {
        sComfort: Math.round(sComfort),
        sEnergy: Math.round(sEnergy),
        sCost: Math.round(sCost),
        sNoise: Math.round(sNoise),
        sPressure: Math.round(sPressure),
        sSpace: Math.round(sSpace),
        sPreference: Math.round(sPreference),
        totalScore: finalValid ? totalScore : Math.min(25, totalScore)
      },
      tradeOffSummary,
      systemArchitecture,
      algorithmTrace,
      installedCapacityBtu,
      capacityRatio: loadBtu > 0 ? installedCapacityBtu / loadBtu : undefined,
      deliveredCfm,
      indoorUnit: ctx.indoorUnit,
      indoorQuantity: ctx.indoorUnit ? qty : undefined,
      combinationRatio: ctx.combinationRatio
    });
  };

  for (const sysType of typesToTest) {
    const matchingEquip = catalog.filter(e => e.systemType === sysType);

    if (sysType === 'vrf') {
      // ---- VRF: outdoor module chosen by connected indoor capacity; indoor units chosen separately ----
      const indoorOptions: Array<{ unit: EquipmentCatalogItem; sizing: SizingCheck }> = [];
      for (const indoorType of ['cassette', 'concealed', 'high-wall']) {
        let best: { unit: EquipmentCatalogItem; sizing: SizingCheck } | null = null;
        for (const unit of catalog.filter(e => e.systemType === indoorType)) {
          const s = sizeUnitQuantity(unit, loadBtu, sensBtu, cfm, designAmbientF);
          if (!s.valid) continue;
          if (!best || s.qty < best.sizing.qty || (s.qty === best.sizing.qty && s.capacityRatio < best.sizing.capacityRatio)) {
            best = { unit, sizing: s };
          }
        }
        if (best) indoorOptions.push(best);
      }
      // No indoor class can satisfy the sizing rules: keep the closest concealed set so the failure is visible.
      if (indoorOptions.length === 0) {
        const fallback = catalog
          .filter(e => e.systemType === 'concealed')
          .map((unit) => ({ unit, sizing: sizeUnitQuantity(unit, loadBtu, sensBtu, cfm, designAmbientF) }))
          .sort((a, b) => a.sizing.qty - b.sizing.qty || a.sizing.capacityRatio - b.sizing.capacityRatio)[0];
        if (fallback) indoorOptions.push(fallback);
      }

      let validVrfCount = 0;
      let bestInvalid: { outdoor: EquipmentCatalogItem; io: (typeof indoorOptions)[number]; combo: number; diags: DiagnosticItem[] } | null = null;
      for (const outdoor of matchingEquip) {
        for (const io of indoorOptions) {
          const indoorTotal = io.sizing.installedCapacityBtu;
          const combo = indoorTotal / outdoor.totalCapacityBtuPerHour;
          const diags: DiagnosticItem[] = sizingDiagnostics(io.unit, io.sizing, loadBtu, cfm, 'Indoor units');
          if (combo < VRF_COMBINATION_MIN - 1e-9 || combo > VRF_COMBINATION_MAX + 1e-9) {
            diags.push({
              code: 'ERR_VRF_COMBINATION_RATIO',
              severity: 'error',
              componentId: outdoor.id,
              message: `Indoor/outdoor combination ratio ${(combo * 100).toFixed(0)}% is outside ${VRF_COMBINATION_MIN * 100}-${VRF_COMBINATION_MAX * 100}% (target ${VRF_COMBINATION_TARGET_MIN * 100}-${VRF_COMBINATION_TARGET_MAX * 100}%).`,
              remediation: 'Select an outdoor module whose capacity is close to the connected indoor capacity.'
            });
          }
          if (outdoor.totalCapacityBtuPerHour * derate < loadBtu - 1e-6) {
            diags.push({
              code: 'ERR_CAPACITY_DEFICIT',
              severity: 'error',
              componentId: outdoor.id,
              message: `Derated outdoor capacity (${Math.round(outdoor.totalCapacityBtuPerHour * derate).toLocaleString()} Btu/h) is below the design load (${Math.round(loadBtu).toLocaleString()} Btu/h).`,
              remediation: 'Select a larger outdoor module.'
            });
          }
          if (diags.some(d => d.severity === 'error')) {
            const dist = Math.abs(combo - (VRF_COMBINATION_TARGET_MIN + VRF_COMBINATION_TARGET_MAX) / 2);
            const bestDist = bestInvalid ? Math.abs(bestInvalid.combo - (VRF_COMBINATION_TARGET_MIN + VRF_COMBINATION_TARGET_MAX) / 2) : Infinity;
            // Remember the closest failing combination in case nothing valid exists (diagnostics only).
            if (outdoor.totalCapacityBtuPerHour * derate >= loadBtu - 1e-6 && dist < bestDist) {
              bestInvalid = { outdoor, io, combo, diags };
            } else if (!bestInvalid) {
              bestInvalid = { outdoor, io, combo, diags };
            }
            continue;
          }
          validVrfCount++;
          buildCandidate(outdoor, io.sizing.qty, diags, {
            sizing: io.sizing,
            indoorUnit: io.unit,
            indoorTotalCapacityBtu: indoorTotal,
            combinationRatio: combo,
            idSuffix: io.unit.id
          });
        }
      }
      if (validVrfCount === 0 && bestInvalid) {
        const b = bestInvalid as { outdoor: EquipmentCatalogItem; io: (typeof indoorOptions)[number]; combo: number; diags: DiagnosticItem[] };
        buildCandidate(b.outdoor, b.io.sizing.qty, b.diags, {
          sizing: b.io.sizing,
          indoorUnit: b.io.unit,
          indoorTotalCapacityBtu: b.io.sizing.installedCapacityBtu,
          combinationRatio: b.combo,
          idSuffix: b.io.unit.id
        });
      }
      continue;
    }

    for (const equip of matchingEquip) {
      const sizing = sizeUnitQuantity(equip, loadBtu, sensBtu, cfm, designAmbientF);
      buildCandidate(equip, sizing.qty, sizingDiagnostics(equip, sizing, loadBtu, cfm), { sizing });
    }
  }

  candidates.sort((a, b) => {
    if (a.isValid !== b.isValid) return a.isValid ? -1 : 1;
    // A strictly in-window selection always outranks a Manual S relaxation (NEXT_NOMINAL_SIZE / MIN_AVAILABLE_SIZE).
    const relax = (c: SystemDesignCandidate): 0 | 1 =>
      c.diagnostics.some((d) => d.code === 'NEXT_NOMINAL_SIZE' || d.code === 'MIN_AVAILABLE_SIZE') ? 1 : 0;
    if (relax(a) !== relax(b)) return relax(a) - relax(b);
    if (b.subscores.totalScore !== a.subscores.totalScore) return b.subscores.totalScore - a.subscores.totalScore;
    // Equal score: fewest units, then lowest oversize ratio.
    if (a.quantity !== b.quantity) return a.quantity - b.quantity;
    return (a.capacityRatio ?? Infinity) - (b.capacityRatio ?? Infinity);
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
 * Backward-compatible helper for legacy recommendation panel.
 * Values are in project units (see generateSystemCandidates).
 */
export function recommendSystemsForZone(
  areaSqFt: number,
  totalLoadBtu: number,
  spaceTypeId: string,
  isImperial: boolean,
  supplyCfm?: number,
  loadedCatalogs?: any,
  sensibleLoad?: number
): LegacySystemRecommendation[] {
  const result = generateSystemCandidates(
    totalLoadBtu,
    sensibleLoad ?? totalLoadBtu * DEFAULT_SENSIBLE_FRACTION,
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

    const installed = cand.installedCapacityBtu ?? cand.quantity * cand.equipment.totalCapacityBtuPerHour;
    const airUnit = cand.indoorUnit || cand.equipment;

    return {
      type: cand.systemType,
      name: `${cand.equipment.manufacturer} ${cand.equipment.model} (${cand.systemType.toUpperCase()})`,
      score: cand.subscores.totalScore,
      reason: cand.tradeOffSummary,
      pros: [
        `Installed Capacity: ${installed.toLocaleString()} Btu/h`,
        airUnit.capabilities.hasExternalStaticPressure
          ? `Rated ESP: ${airUnit.maxRatedEspInWg.toFixed(2)} in.wg`
          : 'Direct quiet air distribution without duct resistance'
      ],
      cons: cand.isValid ? [] : ['Fails engineering validation constraints'],
      estUnits: cand.quantity,
      unitCapacity: cand.indoorUnit ? cand.indoorUnit.totalCapacityBtuPerHour : cand.equipment.totalCapacityBtuPerHour,
      estCost,
      estEfficiency,
      reference: cand.equipment.provenance.source,
      modelLabel: cand.indoorUnit ? `${cand.equipment.model} + ${cand.indoorUnit.model}` : cand.equipment.model,
      cfm: cand.deliveredCfm ?? deliveredCfmFor(airUnit, cand.quantity, toCfm(supplyCfm || 0, isImperial ? "imperial" : "metric")),
      esp: airUnit.capabilities.hasExternalStaticPressure ? `${airUnit.maxRatedEspInWg.toFixed(2)} in.wg` : undefined,
      sourceFile: cand.equipment.provenance.source
    };
  });
}

/**
 * Backward-compatible helper for legacy zone property queries.
 *
 * `loadBtu`, `supplyCfm` and `area` are in PROJECT units (W, L/s, m² when `isImperial` is false).
 * `area` defaults to a 400 ft² zone and `spaceTypeId` to 'office' when the caller has no zone data.
 * `isValid` is false when no candidate satisfies the sizing rules (the returned model is then only the closest one).
 */
export function getCatalogSizingForZone(
  systemType: string | undefined,
  loadBtu: number,
  supplyCfm: number,
  loadedCatalogs?: any,
  isImperial: boolean = true,
  area?: number,
  spaceTypeId: string = 'office',
  sensibleLoad?: number
): { qty: number; model: string; esp?: string; isValid?: boolean } {
  const areaProjectUnits = area !== undefined && area > 0
    ? area
    : (isImperial ? DEFAULT_ZONE_AREA_SQFT : DEFAULT_ZONE_AREA_SQFT / SQFT_PER_SQM);

  const result = generateSystemCandidates(
    loadBtu,
    sensibleLoad ?? loadBtu * DEFAULT_SENSIBLE_FRACTION,
    supplyCfm,
    spaceTypeId,
    areaProjectUnits,
    isImperial,
    {},
    systemType ? [systemType] : undefined,
    loadedCatalogs
  );

  const best = result.bestOverall || result.candidates[0];
  if (best) {
    const airUnit = best.indoorUnit || best.equipment;
    return {
      qty: best.quantity,
      model: best.equipment.model,
      esp: airUnit.capabilities.hasExternalStaticPressure
        ? `${airUnit.maxRatedEspInWg.toFixed(2)} in.wg`
        : undefined,
      isValid: best.isValid
    };
  }

  return { qty: 1, model: '', isValid: false };
}
