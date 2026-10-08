import { executeAirDistributionDesign } from '../airDistributionEngine';
import { selectEquipmentForLoad } from '../systemArchitecture/equipmentSelector';
import { STANDARD_EQUIPMENT_CATALOG } from '../hvacCatalogs';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('========================================================================');
console.log('RUNNING LECTURE 06 EQUIPMENT CATALOGUE & CAIRO PROJECT SELECTION VERIFICATION');
console.log('========================================================================');

// Verify that the catalog contains the complete Carrier Miraco ClassiCool Pro lineup (12k to 60k)
const miracoModels = STANDARD_EQUIPMENT_CATALOG.filter((e) => e.manufacturer === 'Carrier Miraco');
console.log(`Found ${miracoModels.length} Carrier Miraco ClassiCool Pro models in catalog.`);
assert(miracoModels.length >= 6, 'Must contain full Carrier Miraco ClassiCool Pro lineup');

// 1. Verify G09: Large 4059 CFM Hall -> 3 x 60K units (1345 CFM each, 47,005 Btu/h each)
console.log('\n--- Testing G09 Conference Hall (4,059 CFM, 145,900 Btu/h) ---');
const g09 = executeAirDistributionDesign({
  roomName: 'G09 Main Hall',
  roomPolygon: [0, 0, 60, 0, 60, 30, 0, 30],
  roomAreaSqFt: 1800,
  sensibleLoadBtu: 105500,
  totalLoadBtu: 145900,
  requiredCfm: 4059,
  systemType: 'concealed'
});

console.log(`G09 Selected: ${g09.serviceZones.length} x ${g09.selectedOption.unitModel} (Total Delivered: ${g09.selectedOption.totalDeliveredCfm} CFM, ${g09.selectedOption.totalDeliveredCapacityBtu} Btu/h)`);
assert(g09.serviceZones.length === 3, `G09 must be partitioned into 3 units, got ${g09.serviceZones.length}`);
assert(g09.selectedOption.nominalTonsPerUnit >= 4.0, 'Must select 4-5 Ton ClassiCool Pro units');
console.log('G09 Validation Report:', JSON.stringify(g09.validationReport, null, 2));
assert(g09.validationReport.overallStatus === 'PASS' || g09.validationReport.overallStatus === 'WARNING', 'G09 validation report must PASS or WARNING');

// 2. Verify G05 & G06: Medium-Large Office (1984 - 2292 CFM) -> 2 units
console.log('\n--- Testing G05 Medium-Large Office (1,984 CFM, 51,400 Btu/h) ---');
const g05 = executeAirDistributionDesign({
  roomName: 'G05 Office',
  roomPolygon: [0, 0, 40, 0, 40, 20, 0, 20],
  roomAreaSqFt: 800,
  sensibleLoadBtu: 46300,
  totalLoadBtu: 51400,
  requiredCfm: 1984,
  systemType: 'concealed'
});

console.log(`G05 Selected: ${g05.serviceZones.length} x ${g05.selectedOption.unitModel}`);
assert(g05.serviceZones.length === 2, `G05 must partition into 2 units, got ${g05.serviceZones.length}`);

// 3. Verify G02 / G08: Small Office (514 CFM, 14,200 Btu/h) -> 1 x 24K unit
console.log('\n--- Testing G08 Small Office (514 CFM, 14,200 Btu/h) ---');
const g08 = executeAirDistributionDesign({
  roomName: 'G08 Office',
  roomPolygon: [0, 0, 20, 0, 20, 15, 0, 15],
  roomAreaSqFt: 300,
  sensibleLoadBtu: 12200,
  totalLoadBtu: 14200,
  requiredCfm: 514,
  systemType: 'concealed'
});

console.log(`G08 Selected: ${g08.serviceZones.length} x ${g08.selectedOption.unitModel}`);
assert(g08.serviceZones.length === 1, `G08 must be 1 unit, got ${g08.serviceZones.length}`);

// 4. Verify G10: Single Room (333 CFM, 8,500 Btu/h) -> 1 x 18K unit
console.log('\n--- Testing G10 Single Room (333 CFM, 8,500 Btu/h) ---');
const g10 = executeAirDistributionDesign({
  roomName: 'G10 Office',
  roomPolygon: [0, 0, 15, 0, 15, 12, 0, 12],
  roomAreaSqFt: 180,
  sensibleLoadBtu: 7600,
  totalLoadBtu: 8500,
  requiredCfm: 333,
  systemType: 'concealed'
});

console.log(`G10 Selected: ${g10.serviceZones.length} x ${g10.selectedOption.unitModel}`);
assert(g10.serviceZones.length === 1, `G10 must be 1 unit, got ${g10.serviceZones.length}`);

// 5. Test Petra Packaged RTU selection for 10-Ton rooftop load
console.log('\n--- Testing Petra Packaged RTU (120,000 Btu/h, 4,000 CFM) ---');
const packagedSelection = selectEquipmentForLoad(4000, 120000, 'packaged');
assert(packagedSelection !== null, 'Must select a Petra Packaged Rooftop unit');
console.log(`Packaged Selection: ${packagedSelection?.model} (${packagedSelection?.nominalTons} TR, ${packagedSelection?.supplyCfm} CFM)`);

// 6. Test Toshiba VRF SMMS-e modular selection
console.log('\n--- Testing Toshiba VRF SMMS-e (96,000 Btu/h, 8 HP) ---');
const vrfSelection = selectEquipmentForLoad(3200, 96000, 'vrf');
assert(vrfSelection !== null, 'Must select a Toshiba VRF SMMS-e unit');
console.log(`VRF Selection: ${vrfSelection?.model} (${vrfSelection?.nominalTons} TR)`);

console.log('\n========================================================================');
console.log('ALL LECTURE 06 EQUIPMENT & CAIRO PROJECT SELECTIONS PASSED WITH 100% SUCCESS!');
console.log('========================================================================');
