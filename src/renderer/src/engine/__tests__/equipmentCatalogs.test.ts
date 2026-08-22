import { STANDARD_EQUIPMENT_CATALOG } from '../hvacCatalogs';
import { selectEquipmentForLoad } from '../systemArchitecture/equipmentSelector';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running Equipment Catalogs & Selector Tests ===');

// 1. Rich equipment catalog models
const ahus = STANDARD_EQUIPMENT_CATALOG.filter((eq) => eq.systemType === 'ahu');
const rtus = STANDARD_EQUIPMENT_CATALOG.filter((eq) => eq.systemType === 'packaged');
const concealed = STANDARD_EQUIPMENT_CATALOG.filter((eq) => eq.systemType === 'concealed');
const fcus = STANDARD_EQUIPMENT_CATALOG.filter((eq) => eq.systemType === 'fcu');
const vrf = STANDARD_EQUIPMENT_CATALOG.filter((eq) => eq.systemType === 'vrf');

assert(ahus.length >= 6, `AHUs should have >= 6 models, got ${ahus.length}`);
assert(rtus.length >= 4, `RTUs should have >= 4 models, got ${rtus.length}`);
assert(concealed.length >= 6, `Concealed split should have >= 6 models, got ${concealed.length}`);
assert(fcus.length >= 3, `FCUs should have >= 3 models, got ${fcus.length}`);
assert(vrf.length >= 1, `VRF should have >= 1 models, got ${vrf.length}`);

// 2. Select central AHU models for large loads
const heavyAhu = selectEquipmentForLoad(18000, 550000, 'ahu');
assert(heavyAhu !== null, 'Should select a heavy AHU');
assert(heavyAhu?.catalogItem.systemType === 'ahu', 'Heavy AHU must have systemType ahu');
assert((heavyAhu?.supplyCfm || 0) >= 18000, 'Heavy AHU supply CFM must meet or exceed 18000 CFM');
assert((heavyAhu?.availableEspInWg || 0) >= 1.5, 'Heavy AHU ESP must be >= 1.5 in.wg');

// 3. Select RTU for medium commercial
const rtu = selectEquipmentForLoad(3500, 110000, 'packaged');
assert(rtu !== null, 'Should select an RTU');
assert(rtu?.catalogItem.systemType === 'packaged', 'RTU must have systemType packaged');
assert((rtu?.supplyCfm || 0) >= 3500, 'RTU supply CFM must meet or exceed 3500 CFM');
assert((rtu?.availableEspInWg || 0) >= 0.8, 'RTU ESP must be >= 0.8 in.wg');

// 4. Select Concealed Split
const dxSplit = selectEquipmentForLoad(2700, 85000, 'concealed');
assert(dxSplit !== null, 'Should select a DX split');
assert(dxSplit?.catalogItem.systemType === 'concealed', 'DX Split must have systemType concealed');
assert((dxSplit?.supplyCfm || 0) >= 2500, 'DX Split supply CFM must meet or exceed 2500 CFM');

// 5. Select FCU
const fcu = selectEquipmentForLoad(800, 24000, 'fcu');
assert(fcu !== null, 'Should select an FCU');
assert((fcu?.supplyCfm || 0) >= 700, 'FCU supply CFM must meet or exceed 700 CFM');

console.log('PASS: All Equipment Catalog & Selector Tests Passed.');
