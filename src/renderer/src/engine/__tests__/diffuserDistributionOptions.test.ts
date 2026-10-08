import { generateDiffuserDistributionOptions, generateSystemCandidates } from '../systemDesigner';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('========================================================================');
console.log('TESTING AIR DISTRIBUTION OPTIONS SPECTRUM & USER SELECTION ENGINE');
console.log('========================================================================');

// 1. Test 4,000 CFM Zone (e.g. Large Hall / Multi-Unit Zone)
console.log('\n--- 1. Testing Distribution Options for 4,000 CFM (1,500 sq ft) ---');
const options4k = generateDiffuserDistributionOptions(4000, 1500, 30, true);
console.log(`Generated ${options4k.length} valid distribution options:`);
options4k.forEach(opt => {
  console.log(`  • ${opt.diffuserCount} diffusers @ ${opt.cfmPerDiffuser} CFM ea | Face: ${opt.faceSizeLabel} | NC: ${opt.actualNc} | Throw: ${opt.throwT50Ft} ft | Cov: ${opt.estimatedCoveragePercent}% ${opt.isRecommended ? '[RECOMMENDED]' : ''}`);
});

assert(options4k.length >= 4, `Should generate at least 4 valid options, found ${options4k.length}`);
const opt12 = options4k.find(o => o.diffuserCount === 12);
assert(opt12 !== undefined, 'Must contain 12 diffusers option');
assert(opt12!.cfmPerDiffuser === 333 || opt12!.cfmPerDiffuser === 335, `12 diffusers should receive ~333 CFM, got ${opt12!.cfmPerDiffuser}`);
assert(opt12!.actualNc <= 30, `12 diffusers NC must be <= 30, got ${opt12!.actualNc}`);

const opt24 = options4k.find(o => o.diffuserCount === 24);
assert(opt24 !== undefined, 'Must also contain 24 diffusers option for low-velocity dense layout');
assert(opt24!.cfmPerDiffuser <= 170, `24 diffusers should receive ~167 CFM, got ${opt24!.cfmPerDiffuser}`);

// 2. Test 1,200 CFM Zone
console.log('\n--- 2. Testing Distribution Options for 1,200 CFM (600 sq ft) ---');
const options1200 = generateDiffuserDistributionOptions(1200, 600, 28, true);
console.log(`Generated ${options1200.length} valid distribution options:`);
options1200.forEach(opt => {
  console.log(`  • ${opt.diffuserCount} diffusers @ ${opt.cfmPerDiffuser} CFM ea | Face: ${opt.faceSizeLabel} | NC: ${opt.actualNc} ${opt.isRecommended ? '[RECOMMENDED]' : ''}`);
});
assert(options1200.some(o => o.diffuserCount === 4 && Math.abs(o.cfmPerDiffuser - 300) <= 10), 'Must include 4 diffusers @ 300 CFM');

// 3. Test Full System Candidate Integration
console.log('\n--- 3. Testing Candidate Generator with Attached Options ---');
const rec = generateSystemCandidates(
  145000,
  105000,
  4000,
  'office',
  1500,
  true,
  {},
  ['concealed']
);

assert(rec.candidates.length > 0, 'Must generate candidates');
const best = rec.candidates[0];
assert(best.diffuserDistributionOptions !== undefined && best.diffuserDistributionOptions.length >= 4, 'Candidate must contain distribution options');
assert(best.diffusers.quantity === 12 || (best.diffusers.quantity >= 8 && best.diffusers.quantity <= 14), `Default candidate diffusers should be balanced (~12), got ${best.diffusers.quantity}`);

console.log('\n========================================================================');
console.log('ALL DIFFUSER DISTRIBUTION OPTIONS & SELECTION TESTS PASSED SUCCESSFULLY!');
console.log('========================================================================');
