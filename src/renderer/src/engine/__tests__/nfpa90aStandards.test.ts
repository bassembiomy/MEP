import {
  NFPA_90A_STANDARDS_DATABASE,
  STANDARD_DAMPER_CATALOG,
  STANDARD_FITTING_LOSSES
} from '../hvacCatalogs';
import { evaluateNfpa90aCompliance } from '../validation/nfpa90aValidator';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running NFPA 90A & Dampers (Lecture 08) Tests ===');

// 1. Database Rule Count & Coverage
assert(NFPA_90A_STANDARDS_DATABASE.length >= 8, `NFPA 90A database must have at least 8 core rules, found: ${NFPA_90A_STANDARDS_DATABASE.length}`);

const supplySmokeRule = NFPA_90A_STANDARDS_DATABASE.find((r) => r.id === 'nfpa-90a-supply-smoke-detector');
const returnSmokeRule = NFPA_90A_STANDARDS_DATABASE.find((r) => r.id === 'nfpa-90a-return-smoke-detector-multistory');
const fireDamperRule = NFPA_90A_STANDARDS_DATABASE.find((r) => r.id === 'nfpa-90a-fire-damper-1hr-partition');
const smokeDamperRule = NFPA_90A_STANDARDS_DATABASE.find((r) => r.id === 'nfpa-90a-smoke-damper-barriers');
const flexRule = NFPA_90A_STANDARDS_DATABASE.find((r) => r.id === 'nfpa-90a-flexible-duct-length');
const corridorRule = NFPA_90A_STANDARDS_DATABASE.find((r) => r.id === 'nfpa-90a-egress-corridor-restriction');

assert(Boolean(supplySmokeRule), 'Must contain supply smoke detector rule');
assert(supplySmokeRule!.thresholdValue === 2000, 'Supply smoke detector threshold must be 2,000 CFM');
assert(Boolean(returnSmokeRule), 'Must contain return smoke detector rule');
assert(returnSmokeRule!.thresholdValue === 15000, 'Return smoke detector threshold must be 15,000 CFM');
assert(Boolean(fireDamperRule), 'Must contain fire damper rule');
assert(Boolean(smokeDamperRule), 'Must contain smoke damper rule');
assert(Boolean(flexRule), 'Must contain flexible duct rule');
assert(flexRule!.thresholdValue === 14, 'Flex duct maximum length must be 14 ft');
assert(Boolean(corridorRule), 'Must contain corridor plenum prohibition rule');

// 2. Damper Catalog Coverage
assert(STANDARD_DAMPER_CATALOG.length >= 6, `Damper catalog must have at least 6 models, found: ${STANDARD_DAMPER_CATALOG.length}`);

const fd15 = STANDARD_DAMPER_CATALOG.find((d) => d.id === 'dmp-fd-curtain-1.5hr');
const fsd = STANDARD_DAMPER_CATALOG.find((d) => d.id === 'dmp-fsd-211-class1');
const sd = STANDARD_DAMPER_CATALOG.find((d) => d.id === 'dmp-sd-smoke-class1');
const crd = STANDARD_DAMPER_CATALOG.find((d) => d.id === 'dmp-crd-ceiling-radiation');
const vcd = STANDARD_DAMPER_CATALOG.find((d) => d.id === 'dmp-vcd-opposed-manual');

assert(Boolean(fd15), 'Must contain 1.5 Hr curtain fire damper');
assert(fd15!.fireRatingHours === 1.5, 'Fire damper rating must be 1.5 hours');
assert(fd15!.fusibleLinkTempF === 165, 'Fusible link temp must be 165°F');
assert(Boolean(fsd), 'Must contain Combination Fire/Smoke Damper');
assert(fsd!.leakageClass === 'Class I', 'Combination damper must be UL 555S Class I');
assert(Boolean(sd), 'Must contain motorized smoke damper');
assert(Boolean(crd), 'Must contain ceiling radiation damper');
assert(Boolean(vcd), 'Must contain manual volume control damper');

// 3. Fitting Losses Definitions
assert(Boolean(STANDARD_FITTING_LOSSES['fire-damper']), 'Must contain fire-damper fitting loss');
assert(Boolean(STANDARD_FITTING_LOSSES['smoke-damper']), 'Must contain smoke-damper fitting loss');
assert(Boolean(STANDARD_FITTING_LOSSES['combination-fire-smoke-damper']), 'Must contain combination damper fitting loss');
assert(STANDARD_FITTING_LOSSES['fire-damper'].lossCoefficientK > 0, 'Fire damper K-factor must be > 0');

// 4. Compliance Evaluation Test Cases

// Case A: Small unit (1,200 CFM, compliant flex duct 6 ft) -> PASS, no detector required
const evalA = evaluateNfpa90aCompliance({
  supplyAirflowCfm: 1200,
  maxFlexDuctLengthFt: 6.0
});
assert(evalA.overallStatus === 'PASS', 'Small compliant system should PASS');
assert(evalA.smokeDetectorsRequiredCount === 0, 'No smoke detector required for 1,200 CFM');

// Case B: Large commercial system (4,000 CFM) -> Flags mandatory smoke detector
const evalB = evaluateNfpa90aCompliance({
  supplyAirflowCfm: 4000,
  maxFlexDuctLengthFt: 8.0,
  hasFireWallPenetrations: true,
  fireWallRatingHours: 2.0
});
assert(evalB.overallStatus === 'PASS', 'System should PASS with INFO tags');
assert(evalB.smokeDetectorsRequiredCount === 1, 'Should require 1 supply duct smoke detector');
assert(evalB.fireDampersRequired === true, 'Should require fire dampers at fire wall');

// Case C: Violation - Flex duct length 18 ft (> 14 ft limit) -> FAIL
const evalC = evaluateNfpa90aCompliance({
  supplyAirflowCfm: 800,
  maxFlexDuctLengthFt: 18.0
});
assert(evalC.overallStatus === 'FAIL', 'Excessive flex duct length must FAIL NFPA 90A');
assert(evalC.results.some((r) => r.ruleId === 'nfpa-90a-flexible-duct-length' && r.status === 'VIOLATION'), 'Must flag flex length violation');

// Case D: Violation - Corridor used as return plenum -> FAIL
const evalD = evaluateNfpa90aCompliance({
  supplyAirflowCfm: 3000,
  maxFlexDuctLengthFt: 6.0,
  corridorUsedAsPlenum: true
});
assert(evalD.overallStatus === 'FAIL', 'Corridor as plenum must FAIL NFPA 90A');
assert(evalD.results.some((r) => r.ruleId === 'nfpa-90a-egress-corridor-restriction' && r.status === 'VIOLATION'), 'Must flag corridor violation');

// Case E: Multi-story large return (20,000 CFM) -> Flags floor smoke detectors
const evalE = evaluateNfpa90aCompliance({
  supplyAirflowCfm: 22000,
  returnAirflowCfm: 20000,
  isMultiStory: true
});
assert(evalE.smokeDetectorsRequiredCount === 2, 'Should require supply + return multi-story smoke detectors');

console.log('PASS: All NFPA 90A Standards & Dampers (Lecture 08) Tests Passed successfully.');
