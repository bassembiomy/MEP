import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';
import {
  catalogCandidatesForType,
  toSelectedEquipmentResult,
  deliveredCfmFor,
  MAX_UNIT_COUNT,
  SelectedEquipmentResult,
  evaluateSizing,
  SizingCheck,
  AIRFLOW_RATIO_MIN,
  AIRFLOW_RATIO_MAX
} from './equipmentSelector';

export interface MultiUnitCandidate {
  optionId: string;
  unitCount: number;
  unitModel: string;
  nominalTonsPerUnit: number;
  cfmPerUnit: number;
  capacityBtuPerUnit: number;
  totalDeliveredCfm: number;
  totalDeliveredCapacityBtu: number;
  availableEspInWg: number;
  equipmentHeightIn: number;
  totalScore: number;
  scoreBreakdown: {
    capacityMatch: number;
    distributionQuality: number;
    acousticPerformance: number;
    espMargin: number;
    ductEfficiency: number;
    ceilingDepthMatch: number;
    redundancy: number;
    unitPenalty: number;
  };
  selectionRationale: string;
  equipmentDetails: SelectedEquipmentResult;
  /** True only when the option passes every professional sizing rule (capacity, sensible, airflow, oversize). */
  isValid?: boolean;
  /** Human-readable reasons the option is invalid (empty when valid). */
  violations?: string[];
  /** Non-blocking Manual S notes (NEXT_NOMINAL_SIZE / MIN_AVAILABLE_SIZE) on a valid option. */
  warnings?: string[];
  /** delivered capacity / total load */
  capacityRatio?: number;
  /** Ceiling void needed: unit height + minimum clearance + duct connection protrusion. */
  requiredCeilingVoidIn?: number;
}

export interface OptimizationInput {
  roomName: string;
  sensibleLoadBtu: number;
  totalLoadBtu: number;
  requiredCfm: number;
  roomAreaSqFt: number;
  maxAvailableCeilingDepthIn?: number;
  systemType?: string;
  profile?: StandardsProfile;
}

export interface OptimizationResult {
  roomName: string;
  requiredCfm: number;
  totalLoadBtu: number;
  /** Valid options, best first. If no option is valid, the closest flagged (isValid=false) options. */
  candidates: MultiUnitCandidate[];
  recommendedOption: MultiUnitCandidate;
  /** False when every option violated a sizing rule (recommendedOption is then flagged invalid). */
  hasValidOption?: boolean;
  /** Options that were dropped for violating a sizing rule (empty when none were rejected). */
  rejectedOptions?: MultiUnitCandidate[];
}

/** Minimum clearance (in) between unit casing and the ceiling slab / tile. */
export const MIN_CEILING_CLEARANCE_IN = 2;

function parseDuctHeightIn(size: string | undefined): number {
  if (!size) return 0;
  const m = size.match(/(\d+(?:\.\d+)?)\s*"?\s*x\s*(\d+(?:\.\d+)?)/i);
  return m ? parseFloat(m[2]) : 0;
}

/** Ceiling void required to install a unit: height + clearance + duct collar protruding above the casing. */
export function requiredCeilingVoidIn(eq: SelectedEquipmentResult): number {
  const unitH = eq.dimensionsIn.height || 10;
  const ducted = eq.catalogItem.capabilities?.supportsDuctNetwork;
  const ductH = ducted ? parseDuctHeightIn(eq.catalogItem.connectionSizes.supplyDuct) : 0;
  return unitH + MIN_CEILING_CLEARANCE_IN + Math.max(0, ductH - unitH);
}

/** Higher = worse. Capacity deficit / sensible shortfalls rank far below oversize or airflow-window failures. */
function failureSeverity(c: SizingCheck): number {
  let sev = 0;
  if (c.failures.includes('DEFICIT')) sev += 100;
  if (c.failures.includes('SENSIBLE')) sev += 100;
  if (c.failures.includes('OVERSIZE')) sev += 10;
  if (c.failures.includes('AIRFLOW_LOW') || c.failures.includes('AIRFLOW_HIGH')) sev += 10;
  return sev;
}

export function optimizeMultiUnitCandidates(input: OptimizationInput): OptimizationResult {
  const {
    roomName,
    sensibleLoadBtu,
    totalLoadBtu,
    requiredCfm,
    roomAreaSqFt,
    maxAvailableCeilingDepthIn = 14,
    systemType = 'concealed',
    profile: _profile = ASHRAE_PROFILE
  } = input;

  const validCandidates: MultiUnitCandidate[] = [];
  const invalidCandidates: MultiUnitCandidate[] = [];
  const testUnitCounts = Array.from({ length: MAX_UNIT_COUNT }, (_, i) => i + 1);
  const eligible = catalogCandidatesForType(systemType);

  for (const n of testUnitCounts) {
    // Evaluate every single model at n units. Prefer a fully valid model (lowest capacity ratio);
    // otherwise the least-bad one, ranking capacity-deficit / sensible failures last (slight oversize beats deficit).
    let selection: SelectedEquipmentResult | null = null;
    let bestKey = Infinity;
    for (const item of eligible) {
      const chk = evaluateSizing(item, n, totalLoadBtu, sensibleLoadBtu, requiredCfm);
      const key = failureSeverity(chk) * 1000 + (chk.valid ? chk.capacityRatio : Math.abs(chk.capacityRatio - 1.1));
      if (key < bestKey) {
        bestKey = key;
        selection = toSelectedEquipmentResult(item, chk.valid ? {} : { undersized: true, shortfalls: [] });
      }
    }
    if (!selection) continue;

    const deliveredCfm = deliveredCfmFor(selection.catalogItem, n, requiredCfm);
    const deliveredBtu = selection.totalCapacityBtu * n;

    // Hard professional rules: capacity 1.00-1.20x (1.15x fixed speed), sensible, airflow 0.95-1.25x.
    const sizing: SizingCheck = evaluateSizing(selection.catalogItem, n, totalLoadBtu, sensibleLoadBtu, requiredCfm);
    const violations: string[] = [];
    if (sizing.failures.includes('DEFICIT')) {
      violations.push(`delivered ${Math.round(deliveredBtu)} Btu/h < load ${Math.round(totalLoadBtu)} Btu/h`);
    }
    if (sizing.failures.includes('OVERSIZE')) {
      violations.push(`capacity ratio ${sizing.capacityRatio.toFixed(2)} > ${sizing.maxCapacityRatio.toFixed(2)}`);
    }
    if (sizing.failures.includes('SENSIBLE')) {
      violations.push(`sensible capacity below ${Math.round(sensibleLoadBtu)} Btu/h`);
    }
    if (sizing.failures.includes('AIRFLOW_LOW')) {
      violations.push(`delivered ${deliveredCfm} CFM < ${AIRFLOW_RATIO_MIN} x ${Math.round(requiredCfm)} CFM`);
    }
    if (sizing.failures.includes('AIRFLOW_HIGH')) {
      violations.push(`delivered ${deliveredCfm} CFM > ${AIRFLOW_RATIO_MAX} x ${Math.round(requiredCfm)} CFM`);
    }
    const isValid = violations.length === 0;

    // 1. Capacity match score (0-20 pts)
    const capRatio = totalLoadBtu > 0 ? deliveredBtu / totalLoadBtu : 1;
    let capScore = 20 - Math.abs(capRatio - 1.05) * 40;
    capScore = Math.max(0, Math.min(20, capScore));

    // 2. Air distribution quality (0-20 pts) - larger areas benefit from multiple injection points
    let distScore = 10;
    if (roomAreaSqFt > 1000) {
      distScore = n >= 2 ? (n === 3 ? 20 : 17) : 8;
    } else if (roomAreaSqFt > 500) {
      distScore = n === 2 ? 20 : (n === 1 ? 14 : 16);
    } else {
      distScore = n === 1 ? 20 : 12;
    }

    // 3. Acoustic performance (0-15 pts) - smaller units generate less localized noise
    let acousticScore = 15;
    if (selection.supplyCfm > 2500) acousticScore = 8;
    else if (selection.supplyCfm > 1500) acousticScore = 11;
    else acousticScore = 15;

    // 4. ESP margin (0-15 pts)
    const espScore = selection.availableEspInWg >= 0.35 ? 15 : (selection.availableEspInWg >= 0.25 ? 12 : 8);

    // 5. Duct efficiency (0-15 pts) - shorter duct runs with multi-unit layout
    let ductScore = 12;
    if (n >= 3) ductScore = 15;
    else if (n === 2) ductScore = 13;
    else ductScore = 9;

    // 6. Ceiling depth compatibility (0-10 pts): void must hold unit + clearance + duct connection
    const eqHeight = selection.dimensionsIn.height || 10;
    const voidNeeded = requiredCeilingVoidIn(selection);
    const ceilingScore = voidNeeded <= maxAvailableCeilingDepthIn ? 10 : 2;

    // 7. Redundancy (0-10 pts)
    const redundancyScore = n >= 3 ? 10 : (n === 2 ? 8 : 2);

    // 8. Unit count penalty (0 to -15 pts for complexity/cost)
    const unitPenalty = (n - 1) * 3.5;

    const totalScore = parseFloat(
      (capScore + distScore + acousticScore + espScore + ductScore + ceilingScore + redundancyScore - unitPenalty).toFixed(1)
    );

    const rationale = `${n} × ${selection.model} (${selection.nominalTons} TR, ${selection.supplyCfm} CFM each) -> Total ${deliveredCfm} CFM, Score: ${totalScore}${isValid ? '' : ' [INVALID: ' + violations.join('; ') + ']'}`;

    const option: MultiUnitCandidate = {
      optionId: `option-${n}-unit`,
      unitCount: n,
      unitModel: selection.model,
      nominalTonsPerUnit: selection.nominalTons,
      cfmPerUnit: selection.supplyCfm,
      capacityBtuPerUnit: selection.totalCapacityBtu,
      totalDeliveredCfm: deliveredCfm,
      totalDeliveredCapacityBtu: deliveredBtu,
      availableEspInWg: selection.availableEspInWg,
      equipmentHeightIn: eqHeight,
      totalScore,
      scoreBreakdown: {
        capacityMatch: parseFloat(capScore.toFixed(1)),
        distributionQuality: parseFloat(distScore.toFixed(1)),
        acousticPerformance: parseFloat(acousticScore.toFixed(1)),
        espMargin: parseFloat(espScore.toFixed(1)),
        ductEfficiency: parseFloat(ductScore.toFixed(1)),
        ceilingDepthMatch: parseFloat(ceilingScore.toFixed(1)),
        redundancy: parseFloat(redundancyScore.toFixed(1)),
        unitPenalty: parseFloat(unitPenalty.toFixed(1))
      },
      selectionRationale: rationale,
      equipmentDetails: selection,
      isValid,
      violations,
      warnings: [...sizing.warnings],
      capacityRatio: parseFloat(capRatio.toFixed(3)),
      requiredCeilingVoidIn: parseFloat(voidNeeded.toFixed(1))
    };
    (isValid ? validCandidates : invalidCandidates).push(option);
  }

  // Valid options only; if none exist, surface the closest flagged options so callers can
  // still proceed (they must treat recommendedOption.isValid === false as a warning).
  const hasValidOption = validCandidates.length > 0;
  const pool = hasValidOption ? validCandidates : invalidCandidates;
  const sev = (o: MultiUnitCandidate): number => {
    const chk = evaluateSizing(o.equipmentDetails.catalogItem, o.unitCount, totalLoadBtu, sensibleLoadBtu, requiredCfm);
    return failureSeverity(chk);
  };
  pool.sort((a, b) => (hasValidOption ? 0 : sev(a) - sev(b)) || b.totalScore - a.totalScore);

  return {
    roomName,
    requiredCfm,
    totalLoadBtu,
    candidates: pool,
    recommendedOption: pool[0],
    hasValidOption,
    rejectedOptions: hasValidOption ? invalidCandidates : []
  };
}
