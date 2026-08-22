import { resolveSystemCategory } from '../systemArchitecture/hvacSystemResolver';
import { selectEquipmentForLoad } from '../systemArchitecture/equipmentSelector';
import { optimizeMultiUnitCandidates } from '../systemArchitecture/equipmentOptimizer';
import { generateDesignDecisionLog } from '../systemArchitecture/designDecisionLogger';
import { getStandardsProfile } from '../standards/designStandards';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running Multi-Unit Optimizer & Architecture Tests ===');

// 1. Resolver tests
const concealedResolve = resolveSystemCategory('dx', 'concealed-split');
assert(concealedResolve.coolingSource === 'dx', 'Cooling source should be dx');
assert(concealedResolve.equipmentType === 'concealed-split', 'Equipment type should be concealed-split');
assert(concealedResolve.isDucted === true, 'Concealed split should be ducted');

const fcuResolve = resolveSystemCategory('chilled-water', 'fcu');
assert(fcuResolve.coolingSource === 'chilled-water', 'Cooling source should be chilled water');
assert(fcuResolve.isDucted === true, 'FCU can be ducted');

// 2. Equipment selection test
const singleUnitSelection = selectEquipmentForLoad(1345, 47005, 'concealed');
assert(singleUnitSelection !== null, 'Should find matching equipment for ~1345 CFM / 47K BTU');
assert(singleUnitSelection!.supplyCfm >= 1200, 'Selected equipment supply CFM should be valid');

// 3. Multi-Unit Optimizer test for 4,000 CFM Conference Hall
const profile = getStandardsProfile('ashrae');
const optimization = optimizeMultiUnitCandidates({
  roomName: 'Conference Hall',
  sensibleLoadBtu: 120000,
  totalLoadBtu: 141000,
  requiredCfm: 4000,
  roomAreaSqFt: 1500,
  maxAvailableCeilingDepthIn: 14,
  systemType: 'concealed',
  profile
});

assert(optimization.candidates.length >= 3, 'Should generate at least 3 candidates (e.g. 1-unit, 2-unit, 3-unit, 4-unit)');
assert(optimization.recommendedOption !== undefined, 'Must have a recommended option');
assert(optimization.recommendedOption.unitCount >= 2, 'For 4000 CFM with 14" ceiling limit, multi-unit (2 or 3) should score higher than 1 large unit');

// 4. Decision logger test
const log = generateDesignDecisionLog({
  roomName: 'Conference Hall',
  requiredCfm: 4000,
  totalLoadBtu: 141000,
  selectedOption: optimization.recommendedOption,
  allCandidates: optimization.candidates
});

assert(log.includes('Conference Hall'), 'Log should mention room name');
assert(log.includes('AI Recommendation:'), 'Log should have AI Recommendation section');
assert(log.includes('Reason:'), 'Log should have engineering reasons');

console.log('✔ All Multi-Unit Optimizer & Architecture Tests Passed Successfully!');
