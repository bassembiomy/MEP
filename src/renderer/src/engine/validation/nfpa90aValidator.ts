import { NFPA_90A_STANDARDS_DATABASE } from '../hvacCatalogs';

export interface Nfpa90aCheckResult {
  ruleId: string;
  section: string;
  category: string;
  title: string;
  status: 'COMPLIANT' | 'WARNING' | 'VIOLATION' | 'INFO';
  metric: string;
  requirement: string;
  message: string;
  actionRequired?: string;
}

export interface Nfpa90aSystemEvaluation {
  supplyAirflowCfm: number;
  returnAirflowCfm?: number;
  isMultiStory?: boolean;
  maxFlexDuctLengthFt?: number;
  hasFireWallPenetrations?: boolean;
  fireWallRatingHours?: number;
  hasPlenumReturn?: boolean;
  corridorUsedAsPlenum?: boolean;
}

/**
 * Validates an HVAC design against NFPA 90A engineering standards (Lecture 08)
 */
export function evaluateNfpa90aCompliance(system: Nfpa90aSystemEvaluation): {
  overallStatus: 'PASS' | 'WARNING' | 'FAIL';
  results: Nfpa90aCheckResult[];
  smokeDetectorsRequiredCount: number;
  fireDampersRequired: boolean;
} {
  const results: Nfpa90aCheckResult[] = [];
  let detectorsCount = 0;
  let fireDampersReq = false;

  // 1. Supply Duct Smoke Detector Check (NFPA 90A §6.4.2.1)
  const supplyRule = NFPA_90A_STANDARDS_DATABASE.find((r) => r.id === 'nfpa-90a-supply-smoke-detector')!;
  if (system.supplyAirflowCfm > (supplyRule.thresholdValue || 2000)) {
    detectorsCount++;
    results.push({
      ruleId: supplyRule.id,
      section: supplyRule.section,
      category: supplyRule.category,
      title: supplyRule.title,
      status: 'INFO',
      metric: `Supply Airflow: ${system.supplyAirflowCfm} CFM > 2,000 CFM`,
      requirement: supplyRule.mandatoryRequirement,
      message: `Mandatory NFPA 90A duct smoke detector required at AHU/unit supply discharge.`,
      actionRequired: supplyRule.actionOnTrigger
    });
  } else {
    results.push({
      ruleId: supplyRule.id,
      section: supplyRule.section,
      category: supplyRule.category,
      title: supplyRule.title,
      status: 'COMPLIANT',
      metric: `Supply Airflow: ${system.supplyAirflowCfm} CFM <= 2,000 CFM`,
      requirement: supplyRule.mandatoryRequirement,
      message: 'Supply airflow is within unit limit; unit duct smoke detector not required by NFPA 90A.'
    });
  }

  // 2. Return Air Smoke Detector Multi-Story (NFPA 90A §6.4.2.2)
  const returnRule = NFPA_90A_STANDARDS_DATABASE.find((r) => r.id === 'nfpa-90a-return-smoke-detector-multistory')!;
  const returnCfm = system.returnAirflowCfm || system.supplyAirflowCfm;
  if (system.isMultiStory && returnCfm > (returnRule.thresholdValue || 15000)) {
    detectorsCount++;
    results.push({
      ruleId: returnRule.id,
      section: returnRule.section,
      category: returnRule.category,
      title: returnRule.title,
      status: 'INFO',
      metric: `Multi-Story Return Airflow: ${returnCfm} CFM > 15,000 CFM`,
      requirement: returnRule.mandatoryRequirement,
      message: 'Duct smoke detectors required at each floor inlet to return riser.',
      actionRequired: returnRule.actionOnTrigger
    });
  }

  // 3. Flexible Duct Length Limit (NFPA 90A §4.3.2.1)
  const flexRule = NFPA_90A_STANDARDS_DATABASE.find((r) => r.id === 'nfpa-90a-flexible-duct-length')!;
  const maxFlex = system.maxFlexDuctLengthFt || 5.0;
  if (maxFlex > (flexRule.thresholdValue || 14.0)) {
    results.push({
      ruleId: flexRule.id,
      section: flexRule.section,
      category: flexRule.category,
      title: flexRule.title,
      status: 'VIOLATION',
      metric: `Max Flex Duct Length: ${maxFlex} ft > 14 ft limit`,
      requirement: flexRule.mandatoryRequirement,
      message: `Flexible duct length of ${maxFlex} ft violates NFPA 90A §4.3.2.1 maximum allowable limit (14 ft).`,
      actionRequired: 'Reroute rigid duct branch closer to diffuser to reduce flexible runout.'
    });
  } else {
    results.push({
      ruleId: flexRule.id,
      section: flexRule.section,
      category: flexRule.category,
      title: flexRule.title,
      status: 'COMPLIANT',
      metric: `Max Flex Duct Length: ${maxFlex} ft <= 14 ft`,
      requirement: flexRule.mandatoryRequirement,
      message: 'Flexible duct runout complies with NFPA 90A length limit.'
    });
  }

  // 4. Fire Wall Penetration and Fire Damper (NFPA 90A §5.3.1)
  if (system.hasFireWallPenetrations) {
    fireDampersReq = true;
    const wallRating = system.fireWallRatingHours || 2.0;
    const damperRule =
      wallRating >= 3.0
        ? NFPA_90A_STANDARDS_DATABASE.find((r) => r.id === 'nfpa-90a-fire-damper-3hr-partition')!
        : NFPA_90A_STANDARDS_DATABASE.find((r) => r.id === 'nfpa-90a-fire-damper-1hr-partition')!;

    results.push({
      ruleId: damperRule.id,
      section: damperRule.section,
      category: damperRule.category,
      title: damperRule.title,
      status: 'INFO',
      metric: `Fire Wall Penetration (${wallRating} Hr Wall)`,
      requirement: damperRule.mandatoryRequirement,
      message: `Listed ${wallRating >= 3.0 ? '3.0-Hr' : '1.5-Hr'} dynamic fire damper required at wall boundary.`,
      actionRequired: damperRule.actionOnTrigger
    });
  }

  // 5. Corridor as Plenum Check (NFPA 90A §4.3.11.1)
  if (system.corridorUsedAsPlenum) {
    const corridorRule = NFPA_90A_STANDARDS_DATABASE.find((r) => r.id === 'nfpa-90a-egress-corridor-restriction')!;
    results.push({
      ruleId: corridorRule.id,
      section: corridorRule.section,
      category: corridorRule.category,
      title: corridorRule.title,
      status: 'VIOLATION',
      metric: 'Egress Corridor configured as return air plenum',
      requirement: corridorRule.mandatoryRequirement,
      message: 'NFPA 90A §4.3.11.1 strictly prohibits exit access corridors from being used as return air plenums.',
      actionRequired: 'Provide fully ducted return system with return grilles inside rooms.'
    });
  }

  const hasViolation = results.some((r) => r.status === 'VIOLATION');
  const hasWarning = results.some((r) => r.status === 'WARNING');

  return {
    overallStatus: hasViolation ? 'FAIL' : hasWarning ? 'WARNING' : 'PASS',
    results,
    smokeDetectorsRequiredCount: detectorsCount,
    fireDampersRequired: fireDampersReq
  };
}
