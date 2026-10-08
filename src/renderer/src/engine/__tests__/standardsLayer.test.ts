import {
  getStandardsProfile
} from '../standards/designStandards';
import { getAcousticVelocityLimit, getRoomNcTarget } from '../standards/acousticRules';
import { getVentilationRates, calculateBreathingZoneVentilation } from '../standards/ventilationRules';
import { getDiffuserThrowCriteria } from '../standards/diffuserRules';
import { getComfortVelocityEnvelope, evaluateOccupiedZoneVelocity } from '../standards/comfortRules';
import { getDuctSizingConstraints, getStandardRectangularSizes } from '../standards/ductSizingRules';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running Standards Layer Tests ===');

// 1. Profile retrieval
const ashrae = getStandardsProfile('ashrae');
assert(ashrae.name === 'ASHRAE Standard Profile', 'ASHRAE profile must load');
const smacna = getStandardsProfile('smacna');
assert(smacna.name === 'SMACNA Standard Profile', 'SMACNA profile must load');

// 2. Acoustic & Velocity rules
const mainTrunkLimit = getAcousticVelocityLimit('main-trunk', 30, ashrae);
assert(mainTrunkLimit.maxVelocityFpm === 1200, `Main trunk limit for NC 30 should be 1200 FPM, got ${mainTrunkLimit.maxVelocityFpm}`);

const branchLimit = getAcousticVelocityLimit('branch', 30, ashrae);
assert(branchLimit.maxVelocityFpm === 900, `Branch limit for NC 30 should be 900 FPM, got ${branchLimit.maxVelocityFpm}`);

const runoutLimit = getAcousticVelocityLimit('runout', 30, ashrae);
assert(runoutLimit.maxVelocityFpm === 700, `Runout limit for NC 30 should be 700 FPM, got ${runoutLimit.maxVelocityFpm}`);

const conferenceNc = getRoomNcTarget('conference-hall', ashrae);
assert(conferenceNc === 30, 'Conference hall NC target should be 30');

// 3. Ventilation rules (ASHRAE 62.1)
const ventRates = getVentilationRates('conference-meeting', ashrae);
assert(ventRates.peopleRateCfmPerPerson === 5, 'People rate should be 5 CFM/person');
assert(ventRates.areaRateCfmPerSqFt === 0.06, 'Area rate should be 0.06 CFM/sqft');

const calculatedFa = calculateBreathingZoneVentilation(50, 1000, 'conference-meeting', ashrae);
// 50 * 5 + 1000 * 0.06 = 250 + 60 = 310 CFM
assert(calculatedFa === 310, `Calculated FA CFM should be 310, got ${calculatedFa}`);

// 4. Diffuser Throw rules
const throwCriteria = getDiffuserThrowCriteria('4-way-ceiling', ashrae);
assert(throwCriteria.minThrowRatio === ashrae.diffuserThrow.minThrowRatio, 'Throw rules must use the selected project preset');
assert(throwCriteria.maxThrowRatio === ashrae.diffuserThrow.maxThrowRatio, 'Throw rules must use the selected project preset');
// These are project criteria, not a verified ASHRAE normative table.
const explicitProjectCriteria=getDiffuserThrowCriteria('4-way-ceiling', {...ashrae,diffuserThrow:{...ashrae.diffuserThrow,minThrowRatio:0.75,maxThrowRatio:1.25}});
assert(explicitProjectCriteria.minThrowRatio===0.75&&explicitProjectCriteria.maxThrowRatio===1.25, 'Explicit project throw limits must be honored');
assert(!ashrae.description.toLowerCase().includes('compliant'), 'Preset name must not certify standards compliance');

// 5. Comfort rules
const comfortEnvelope = getComfortVelocityEnvelope('sedentary', false, 'cooling', ashrae);
assert(comfortEnvelope.maxVelocityFpm === 50, 'Max cooling velocity for sedentary should be 50 FPM');

const comfortEval = evaluateOccupiedZoneVelocity(42, comfortEnvelope);
assert(comfortEval.status === 'pass', '42 FPM should pass comfort evaluation');

// 6. Duct Sizing constraints
const ductConstraints = getDuctSizingConstraints('main-trunk', ashrae);
assert(ductConstraints.maxAspectRatio === 3.0, 'Max aspect ratio should be 3.0');
assert(ductConstraints.maxFrictionLossPer100Ft === 0.10, 'Max friction loss should be 0.10 in. wg/100ft');

const sizes = getStandardRectangularSizes();
assert(sizes.length > 20, 'Should have rich standard SMACNA sizes database');

console.log('✔ All Standards Layer Tests Passed Successfully!');
