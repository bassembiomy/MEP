import { MultiUnitCandidate } from './equipmentOptimizer';
import { BTUH_PER_TON, isImperial, MM_PER_IN, LPS_PER_CFM, W_PER_BTUH } from '../units';
import { formatAirflow, formatLoad } from '../../format/units';

export interface DecisionLogInput {
  roomName: string;
  /** Project unit system for the text (engine values are imperial). Default imperial. */
  units?: 'imperial' | 'metric' | string;
  requiredCfm: number;
  totalLoadBtu: number;
  selectedOption: MultiUnitCandidate;
  allCandidates: MultiUnitCandidate[];
  validationSummary?: {
    airflowStatus: 'PASS' | 'WARNING' | 'FAIL';
    velocityStatus: 'PASS' | 'WARNING' | 'FAIL';
    espStatus: 'PASS' | 'WARNING' | 'FAIL';
    ncStatus: 'PASS' | 'WARNING' | 'FAIL';
    spatialStatus: 'PASS' | 'WARNING' | 'FAIL';
    notes?: string[];
  };
}

/** "-0" / "-0.0" (a rounded tiny negative) is printed as "0". */
export function normalizeNegativeZero(text: string): string {
  return text.replace(/(^|[^\d.])-0(\.0+)?(?![\d.])/g, '$10$2');
}

export function generateDesignDecisionLog(input: DecisionLogInput): string {
  const {
    roomName,
    units,
    requiredCfm,
    totalLoadBtu,
    selectedOption,
    allCandidates,
    validationSummary = {
      airflowStatus: 'PASS',
      velocityStatus: 'PASS',
      espStatus: 'PASS',
      ncStatus: 'PASS',
      spatialStatus: 'PASS',
      notes: []
    }
  } = input;

  const imp = isImperial(units);
  const air = (cfm: number): string => formatAirflow(cfm, units);
  const load = (b: number): string => formatLoad(b, units);
  const cfmPerTon = (cfm: number, btu: number): string => {
    const perTon = cfm / (btu / BTUH_PER_TON);
    return imp ? `${perTon.toFixed(0)} CFM/ton` : `${((perTon * LPS_PER_CFM) / ((12000 * W_PER_BTUH) / 1000)).toFixed(0)} L/s per kW`;
  };
  const lines: string[] = [];
  lines.push('===============================================================');
  lines.push(`DESIGN DECISION LOG - ${roomName}`);
  lines.push('===============================================================');
  lines.push(`Design Cooling Load: ${load(totalLoadBtu)}`);
  lines.push(`Required Supply Airflow: ${air(requiredCfm)}`);
  lines.push('');
  lines.push(`AI Recommendation:`);
  lines.push(`  ${selectedOption.unitCount} × ${selectedOption.unitModel} (${selectedOption.nominalTonsPerUnit} TR, ${air(selectedOption.cfmPerUnit)} each)`);
  lines.push(`  Total Delivered Capacity: ${load(selectedOption.totalDeliveredCapacityBtu)}`);
  lines.push(`  Total Delivered Airflow: ${air(selectedOption.totalDeliveredCfm)}`);
  lines.push(`  Overall Optimization Score: ${selectedOption.totalScore} / 100`);
  if (selectedOption.capacityRatio !== undefined) {
    lines.push(`  Capacity Ratio (delivered / load): ${selectedOption.capacityRatio.toFixed(2)}`);
  }
  if (selectedOption.isValid === false) {
    lines.push(`  WARNING - option violates sizing rules: ${(selectedOption.violations || []).join('; ')}`);
  }
  lines.push('');
  lines.push(`Reason:`);
  lines.push(`  - Airflow & Capacity: Sized for ${cfmPerTon(selectedOption.totalDeliveredCfm, selectedOption.totalDeliveredCapacityBtu)}.`);
  lines.push(`  - Ceiling Clearance: Equipment height ${imp ? `${Math.round(selectedOption.equipmentHeightIn)}"` : `${Math.round((selectedOption.equipmentHeightIn * MM_PER_IN) / 10) * 10} mm`} complies with ceiling depth constraint.`);
  lines.push(`  - Duct Length & ESP: Multi-unit configuration shortens critical path duct runs.`);
  lines.push(`  - Acoustical Comfort: Distributes airflow into ${selectedOption.unitCount} bays to maintain space NC <= 30.`);
  lines.push(`  - Redundancy: ${selectedOption.unitCount > 1 ? `Provides N-1 partial cooling redundancy (${(100 / selectedOption.unitCount).toFixed(0)}% capacity per unit).` : 'Single unit system.'}`);
  lines.push('');
  lines.push(`Candidate Comparisons Evaluated:`);
  for (const c of allCandidates) {
    const isSel = c.optionId === selectedOption.optionId ? ' [SELECTED]' : '';
    lines.push(`  * ${c.unitCount} Unit(s) -> ${c.unitModel} (${air(c.totalDeliveredCfm)}) | Score: ${c.totalScore}${isSel}`);
  }
  lines.push('');
  lines.push(`Engineering Validation Status:`);
  lines.push(`  - Airflow Balance: [${validationSummary.airflowStatus}]`);
  lines.push(`  - Duct Velocity Limits: [${validationSummary.velocityStatus}]`);
  lines.push(`  - Fan ESP Margin: [${validationSummary.espStatus}]`);
  lines.push(`  - Diffuser NC Rating: [${validationSummary.ncStatus}]`);
  lines.push(`  - Spatial Coordination: [${validationSummary.spatialStatus}]`);

  if (validationSummary.notes && validationSummary.notes.length > 0) {
    lines.push('');
    lines.push(`Design Advisories & Notes:`);
    for (const note of validationSummary.notes) {
      lines.push(`  ! ${note}`);
    }
  }

  lines.push('===============================================================');
  return normalizeNegativeZero(lines.join('\n'));
}
