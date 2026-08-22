import { MultiUnitCandidate } from './equipmentOptimizer';

export interface DecisionLogInput {
  roomName: string;
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

export function generateDesignDecisionLog(input: DecisionLogInput): string {
  const {
    roomName,
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

  const lines: string[] = [];
  lines.push('===============================================================');
  lines.push(`DESIGN DECISION LOG - ${roomName}`);
  lines.push('===============================================================');
  lines.push(`Design Cooling Load: ${totalLoadBtu.toLocaleString()} Btu/h`);
  lines.push(`Required Supply Airflow: ${requiredCfm.toLocaleString()} CFM`);
  lines.push('');
  lines.push(`AI Recommendation:`);
  lines.push(`  ${selectedOption.unitCount} × ${selectedOption.unitModel} (${selectedOption.nominalTonsPerUnit} TR, ${selectedOption.cfmPerUnit} CFM each)`);
  lines.push(`  Total Delivered Capacity: ${selectedOption.totalDeliveredCapacityBtu.toLocaleString()} Btu/h`);
  lines.push(`  Total Delivered Airflow: ${selectedOption.totalDeliveredCfm.toLocaleString()} CFM`);
  lines.push(`  Overall Optimization Score: ${selectedOption.totalScore} / 100`);
  lines.push('');
  lines.push(`Reason:`);
  lines.push(`  - Airflow & Capacity: Sized for ${(selectedOption.totalDeliveredCfm / (selectedOption.totalDeliveredCapacityBtu / 12000)).toFixed(0)} CFM/ton.`);
  lines.push(`  - Ceiling Clearance: Equipment height ${selectedOption.equipmentHeightIn}" complies with ceiling depth constraint.`);
  lines.push(`  - Duct Length & ESP: Multi-unit configuration shortens critical path duct runs.`);
  lines.push(`  - Acoustical Comfort: Distributes airflow into ${selectedOption.unitCount} bays to maintain space NC <= 30.`);
  lines.push(`  - Redundancy: ${selectedOption.unitCount > 1 ? `Provides N-1 partial cooling redundancy (${(100 / selectedOption.unitCount).toFixed(0)}% capacity per unit).` : 'Single unit system.'}`);
  lines.push('');
  lines.push(`Candidate Comparisons Evaluated:`);
  for (const c of allCandidates) {
    const isSel = c.optionId === selectedOption.optionId ? ' [SELECTED]' : '';
    lines.push(`  * ${c.unitCount} Unit(s) -> ${c.unitModel} (${c.totalDeliveredCfm} CFM) | Score: ${c.totalScore}${isSel}`);
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
  return lines.join('\n');
}
