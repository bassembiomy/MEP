import { STANDARD_EQUIPMENT_CATALOG } from '../hvacCatalogs';
import { selectEquipmentForLoad } from '../systemArchitecture/equipmentSelector';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running Equipment Catalogues (Lecture 06) Tests ===');

// 1. Total count and variety
assert(STANDARD_EQUIPMENT_CATALOG.length >= 40, `Equipment catalog must contain at least 40 items, found: ${STANDARD_EQUIPMENT_CATALOG.length}`);

// 2. System Type Coverage
const types = new Set(STANDARD_EQUIPMENT_CATALOG.map((e) => e.systemType));
assert(types.has('concealed'), 'Must contain concealed ducted split units');
assert(types.has('ahu'), 'Must contain air handling units (AHU)');
assert(types.has('packaged'), 'Must contain packaged rooftop units');
assert(types.has('vrf'), 'Must contain VRF heat recovery systems');
assert(types.has('cassette'), 'Must contain cassette units');
assert(types.has('fcu'), 'Must contain fan coil units (FCU)');

// 3. Carrier Miraco Ducted Split Series (Lecture 06: MSP 12K - 60K)
const msp12 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-miraco-msp-12k');
const msp18 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-miraco-msp-18k');
const msp24 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-miraco-msp-24k');
const msp30 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-miraco-msp-30k');
const msp36 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-miraco-msp-36k');
const msp42 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-miraco-msp-42k');
const msp48 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-miraco-msp-48k');
const msp60 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-miraco-msp-60k');

assert(Boolean(msp12), 'Must contain Miraco ClassiCool 12K ducted');
assert(Boolean(msp18), 'Must contain Miraco ClassiCool 18K ducted');
assert(Boolean(msp24), 'Must contain Miraco ClassiCool 24K ducted');
assert(Boolean(msp30), 'Must contain Miraco ClassiCool 30K ducted');
assert(Boolean(msp36), 'Must contain Miraco ClassiCool 36K ducted');
assert(Boolean(msp42), 'Must contain Miraco ClassiCool 42K ducted');
assert(Boolean(msp48), 'Must contain Miraco ClassiCool 48K ducted');
assert(Boolean(msp60), 'Must contain Miraco ClassiCool 60K ducted');
assert(msp60!.nominalTons === 5.0, '60K nominal tons must be 5.0');
assert(msp60!.nominalCfm === 1500, '60K nominal CFM must be 1500');

// 4. Carrier Aero Express AHU Series (Lecture 06: 39M-03 to 39M-100)
const aero03 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-carrier-aero-39m-03');
const aero10 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-carrier-aero-39m-10');
const aero60 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-carrier-aero-39m-60');
const aero100 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-carrier-aero-39m-100');

assert(Boolean(aero03), 'Must contain Carrier Aero Express 39M-03 AHU');
assert(Boolean(aero10), 'Must contain Carrier Aero Express 39M-10 AHU');
assert(Boolean(aero60), 'Must contain Carrier Aero Express 39M-60 AHU');
assert(Boolean(aero100), 'Must contain Carrier Aero Express 39M-100 AHU');
assert(aero100!.nominalTons === 100.0, 'Aero 100 nominal tons must be 100.0');
assert(aero100!.nominalCfm === 40000, 'Aero 100 nominal CFM must be 40,000');

// 5. SKM Packaged Rooftop Units (Lecture 06: APMR & PACS Series)
const apmr05 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-skm-apmr-05');
const apmr15 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-skm-apmr-15');
const pacs50 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-skm-pacs-50');
const pacs100 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-skm-pacs-100');

assert(Boolean(apmr05), 'Must contain SKM APMR-5005 5 Ton Packaged RTU');
assert(Boolean(apmr15), 'Must contain SKM APMR-5150 15 Ton Packaged RTU');
assert(Boolean(pacs50), 'Must contain SKM PACS-5500 50 Ton Packaged RTU');
assert(Boolean(pacs100), 'Must contain SKM PACS-51000 100 Ton Packaged RTU');

// 6. Toshiba VRF & LG Round Cassette 360 (Lecture 06)
const toshiba8hp = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-toshiba-vrf-8hp');
const toshiba60hp = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-toshiba-vrf-60hp');
const lgCass36 = STANDARD_EQUIPMENT_CATALOG.find((e) => e.id === 'eq-lg-round-cass-36k');

assert(Boolean(toshiba8hp), 'Must contain Toshiba SMMS-e 8 HP VRF');
assert(Boolean(toshiba60hp), 'Must contain Toshiba SMMS-e 60 HP VRF');
assert(Boolean(lgCass36), 'Must contain LG 360 Round Cassette 36K');

// 7. Performance Tables and Data Integrity Verification
STANDARD_EQUIPMENT_CATALOG.forEach((item) => {
  assert(Boolean(item.id), `Item ${item.model} must have id`);
  assert(Boolean(item.manufacturer), `Item ${item.id} must have manufacturer`);
  assert(item.nominalTons > 0, `Item ${item.id} must have nominalTons > 0`);
  assert(item.totalCapacityBtuPerHour > 0, `Item ${item.id} total capacity > 0`);
  assert(item.sensibleCapacityBtuPerHour > 0, `Item ${item.id} sensible capacity > 0`);
  assert(item.nominalCfm > 0, `Item ${item.id} nominal CFM > 0`);
  assert(item.electricalKw > 0, `Item ${item.id} electrical KW > 0`);
  assert(item.soundDba > 0, `Item ${item.id} sound dBA > 0`);
  assert(item.dimensionsIn.width > 0, `Item ${item.id} width > 0`);
  assert(item.dimensionsIn.depth > 0, `Item ${item.id} depth > 0`);
  assert(item.dimensionsIn.height > 0, `Item ${item.id} height > 0`);
  assert(Boolean(item.provenance.source), `Item ${item.id} must have provenance source`);
});

// 8. Equipment Selection from Lecture 06
const ductedSel = selectEquipmentForLoad(1200, 35000, 'concealed', STANDARD_EQUIPMENT_CATALOG);
assert(ductedSel !== null, 'Must select ducted unit for 35k load');
assert(ductedSel!.catalogItem.nominalTons >= 3.0, 'Selected unit should be at least 3.0 Tons');

const ahuSel = selectEquipmentForLoad(10000, 300000, 'ahu', STANDARD_EQUIPMENT_CATALOG);
assert(ahuSel !== null, 'Must select AHU for 300k load');
assert(ahuSel!.catalogItem.nominalTons >= 20.0, 'Selected AHU should be >= 20 Tons');

console.log('PASS: All Equipment Catalogues (Lecture 06) Tests Passed successfully.');
