import { STANDARD_DIFFUSER_CATALOG } from '../hvacCatalogs';
import { selectBestDiffuserFromCatalog } from '../terminals/diffuserSelector';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running Diffuser Catalogues Tests ===');

// 1. Total count and variety
assert(STANDARD_DIFFUSER_CATALOG.length >= 40, `Catalog must contain comprehensive items, found: ${STANDARD_DIFFUSER_CATALOG.length}`);

// 2. Terminal Type Coverage
const types = new Set(STANDARD_DIFFUSER_CATALOG.map((d) => d.terminalType));
assert(types.has('square-ceiling'), 'Must contain square ceiling diffusers');
assert(types.has('round-ceiling'), 'Must contain round ceiling diffusers');
assert(types.has('linear-slot'), 'Must contain linear slot diffusers');
assert(types.has('sidewall-grille'), 'Must contain sidewall / linear bar grilles');
assert(types.has('jet-nozzle'), 'Must contain jet nozzles');
assert(types.has('louver'), 'Must contain external louvers');
assert(types.has('sand-trap-louver'), 'Must contain sand trap louvers');

// 3. Al-Andalosia & Trox Catalog Presence
const andalosiaItems = STANDARD_DIFFUSER_CATALOG.filter((d) => d.manufacturer === 'Al-Andalosia');
const troxItems = STANDARD_DIFFUSER_CATALOG.filter((d) => d.manufacturer === 'Trox');
assert(andalosiaItems.length >= 35, `Must contain Al-Andalosia catalog items, found: ${andalosiaItems.length}`);
assert(troxItems.length >= 2, `Must contain Trox catalog items, found: ${troxItems.length}`);

// 4. Performance Table Data Integrity
STANDARD_DIFFUSER_CATALOG.forEach((item) => {
  assert(Boolean(item.id), `Item ${item.model} must have id`);
  assert(Boolean(item.manufacturer), `Item ${item.id} must have manufacturer`);
  assert(item.minCfm > 0, `Item ${item.id} must have minCfm > 0`);
  assert(item.maxCfm >= item.minCfm, `Item ${item.id} maxCfm must be >= minCfm`);
  assert(item.performanceTable && item.performanceTable.length >= 2, `Item ${item.id} must have at least 2 performance points`);

  // Verify performance points
  item.performanceTable.forEach((pt, idx) => {
    assert(pt.cfm > 0, `Item ${item.id} pt ${idx} cfm must be > 0`);
    assert(pt.deltaPInWg >= 0, `Item ${item.id} pt ${idx} deltaP must be >= 0`);
    assert(pt.ncRating >= 0, `Item ${item.id} pt ${idx} ncRating must be >= 0`);
    assert(pt.throwFt !== undefined, `Item ${item.id} pt ${idx} must have throwFt`);
    if (item.terminalType !== 'louver' && item.terminalType !== 'sand-trap-louver' && item.terminalType !== 'return-grille') {
      assert(pt.throwFt.t50 >= pt.throwFt.t100, `Item ${item.id} t50 >= t100`);
      assert(pt.throwFt.t100 >= pt.throwFt.t150, `Item ${item.id} t100 >= t150`);
    }
  });

  // Verify provenance
  assert(Boolean(item.provenance.source), `Item ${item.id} must specify provenance source`);
});

// 5. Square Diffuser Sizes Test (4-SCD from 6"x6" to 24"x24")
const scd6 = STANDARD_DIFFUSER_CATALOG.find((d) => d.id === 'dif-andalosia-4scd-6x6');
const scd24 = STANDARD_DIFFUSER_CATALOG.find((d) => d.id === 'dif-andalosia-4scd-24x24');
assert(Boolean(scd6), 'Must include 6"x6" 4-SCD diffuser');
assert(Boolean(scd24), 'Must include 24"x24" 4-SCD diffuser');
assert(scd6!.maxCfm === 225, '6"x6" max CFM should be 225');
assert(scd24!.maxCfm === 3600, '24"x24" max CFM should be 3600');

// 6. Round Ceiling Diffuser Test (CCD 6" to 20")
const ccd6 = STANDARD_DIFFUSER_CATALOG.find((d) => d.id === 'dif-andalosia-ccd-6in');
const ccd20 = STANDARD_DIFFUSER_CATALOG.find((d) => d.id === 'dif-andalosia-ccd-20in');
assert(Boolean(ccd6), 'Must include 6" round CCD');
assert(Boolean(ccd20), 'Must include 20" round CCD');
assert(ccd6!.neckSizeIn.diameter === 6, '6" CCD neck diameter must be 6');
assert(ccd20!.neckSizeIn.diameter === 20, '20" CCD neck diameter must be 20');

// 7. Linear Slot Diffuser Test (1 to 6 slots)
const lsd1 = STANDARD_DIFFUSER_CATALOG.find((d) => d.id === 'dif-andalosia-lsd-1slot-48in');
const lsd6 = STANDARD_DIFFUSER_CATALOG.find((d) => d.id === 'dif-andalosia-lsd-6slot-48in');
assert(Boolean(lsd1), 'Must include 1-slot linear diffuser');
assert(Boolean(lsd6), 'Must include 6-slot linear diffuser');

// 8. Jet Nozzle Test (150mm to 400mm)
const jn150 = STANDARD_DIFFUSER_CATALOG.find((d) => d.id === 'dif-andalosia-jn-150mm');
const jn400 = STANDARD_DIFFUSER_CATALOG.find((d) => d.id === 'dif-andalosia-jn-400mm');
assert(Boolean(jn150), 'Must include 150mm jet nozzle');
assert(Boolean(jn400), 'Must include 400mm jet nozzle');

// 9. Selector Selection Tests across types
const selectSquare = selectBestDiffuserFromCatalog(250, 30, 'square-ceiling');
assert(Boolean(selectSquare.catalogItem), 'Must select best square ceiling diffuser');
assert(selectSquare.actualNc <= 32, 'Selected diffuser NC must be within limits');

const selectRound = selectBestDiffuserFromCatalog(350, 30, 'round-ceiling');
assert(Boolean(selectRound.catalogItem), 'Must select best round ceiling diffuser');
assert(selectRound.catalogItem.terminalType === 'round-ceiling', 'Selected must be round ceiling type');

const selectLinear = selectBestDiffuserFromCatalog(200, 30, 'linear-slot');
assert(Boolean(selectLinear.catalogItem), 'Must select best linear slot diffuser');
assert(selectLinear.catalogItem.terminalType === 'linear-slot', 'Selected must be linear-slot type');

const selectJet = selectBestDiffuserFromCatalog(500, 35, 'jet-nozzle');
assert(Boolean(selectJet.catalogItem), 'Must select best jet nozzle');
assert(selectJet.catalogItem.terminalType === 'jet-nozzle', 'Selected must be jet-nozzle type');

console.log('PASS: All Diffuser Catalogues Tests Passed successfully.');
