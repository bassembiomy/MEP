import { AirDistributionDesignResult } from '../airDistributionEngine';
import { generateMasterSchedules } from './exportSchedules';

export function exportFullEngineeringDesignReport(design: AirDistributionDesignResult): string {
  const schedules = generateMasterSchedules(design);
  const lines: string[] = [];

  lines.push('================================================================================');
  lines.push(`DETERMINISTIC AI HVAC AIR DISTRIBUTION DESIGN & CALCULATION REPORT`);
  lines.push(`Room: ${design.roomName} | Generated: ${design.timestamp}`);
  lines.push(`Standard Profile: ${design.standardsProfile.name}`);
  lines.push('PRELIMINARY — NOT FOR CONSTRUCTION. Standards adoption and engineering issue readiness remain unverified.');
  for(const limitation of design.validationReport.limitations??[])lines.push(`Unresolved: ${limitation}`);
  lines.push('================================================================================\n');

  lines.push(design.designDecisionLog);
  lines.push('\n');

  lines.push('--------------------------------------------------------------------------------');
  lines.push('1. AIR DISTRIBUTION SCHEDULE');
  lines.push('--------------------------------------------------------------------------------');
  lines.push('| Room | Design Load | Required CFM | Delivered CFM | Diffusers | CFM/Diffuser | Return CFM | Status |');
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const row of schedules.airDistributionSchedule) {
    lines.push(`| ${row.roomName} | ${row.designLoadBtu.toLocaleString()} Btu/h | ${row.requiredCfm} CFM | ${row.deliveredCfm} CFM | ${row.diffuserCount} | ${row.cfmPerDiffuser} | ${row.returnCfm} CFM | ${row.status} |`);
  }
  lines.push('\n');

  lines.push('--------------------------------------------------------------------------------');
  lines.push('2. EQUIPMENT SCHEDULE');
  lines.push('--------------------------------------------------------------------------------');
  lines.push('| Tag | Model | System Type | Capacity | Supply CFM | Return CFM | ESP | Status |');
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const row of schedules.equipmentSchedule) {
    lines.push(`| ${row.unitTag} | ${row.model} | ${row.systemType} | ${row.capacityBtu.toLocaleString()} Btu/h | ${row.supplyCfm} CFM | ${row.returnCfm} CFM | ${row.espInWg} in. wg | ${row.status} |`);
  }
  lines.push('\n');

  lines.push('--------------------------------------------------------------------------------');
  lines.push('3. DIFFUSER SCHEDULE');
  lines.push('--------------------------------------------------------------------------------');
  lines.push('| Terminal ID | Type | Model | Neck Size | Face Size | CFM | Throw (T50) | NC | Status |');
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const row of schedules.diffuserSchedule) {
    lines.push(`| ${row.terminalId} | ${row.type} | ${row.model} | ${row.neckSize} | ${row.faceSize} | ${row.cfm} | ${row.throwT50Ft} ft | NC ${row.ncRating} | ${row.status} |`);
  }
  lines.push('\n');

  lines.push('--------------------------------------------------------------------------------');
  lines.push('4. DUCT SCHEDULE');
  lines.push('--------------------------------------------------------------------------------');
  lines.push('| Duct ID | System | Airflow | Size | Velocity | Pressure Loss | NC | Status |');
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const row of schedules.ductSchedule) {
    lines.push(`| ${row.ductId} | ${row.systemType} | ${row.airflowCfm} CFM | ${row.sizeDimension} | ${row.velocityFpm} FPM | ${row.pressureLossInWg} in. wg | NC ${row.ncRating} | ${row.status} |`);
  }
  lines.push('\n');

  lines.push('--------------------------------------------------------------------------------');
  lines.push('5. OUTDOOR AIR & VENTILATION SCHEDULE');
  lines.push('--------------------------------------------------------------------------------');
  lines.push('| System ID | Unit Tag | Required OA | Delivered OA | Louver Model | Free Area | Face Velocity | Status |');
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const row of schedules.outdoorAirSchedule) {
    lines.push(`| ${row.oaSystemId} | ${row.unitTag} | ${row.requiredOaCfm} CFM | ${row.deliveredOaCfm} CFM | ${row.louverModel} | ${row.freeAreaSqFt} sq.ft | ${row.faceVelocityFpm} FPM | ${row.status} |`);
  }
  lines.push('\n');

  lines.push('--------------------------------------------------------------------------------');
  lines.push('6. MASTER 10-POINT PRELIMINARY ENGINEERING VALIDATION MATRIX');
  lines.push('--------------------------------------------------------------------------------');
  for (const p of design.validationReport.points) {
    lines.push(`[${p.zoneId??'project'} / ${p.pointIndex}] ${p.pointName}: [${p.status}]`);
    lines.push(`    Metric: ${p.metric}`);
    lines.push(`    Criteria: ${p.criteria}`);
    lines.push(`    Remarks: ${p.message}`);
    lines.push('');
  }

  lines.push('================================================================================');
  lines.push('END OF CALCULATION REPORT');
  lines.push('================================================================================');

  return lines.join('\n');
}
