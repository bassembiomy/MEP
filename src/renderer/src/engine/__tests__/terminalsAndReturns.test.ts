import { selectBestDiffuserFromCatalog } from '../terminals/diffuserSelector';
import { placeSupplyDiffusersForZone } from '../terminals/terminalPlacer';
import { placeReturnGrillesForZone } from '../terminals/returnPlacer';
import { validateTerminalAirDistribution } from '../terminals/airDistributionValidator';
import { EquipmentServiceZone } from '../zoning/zonePartitioner';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running Terminals and Returns Tests ===');

// Mock service zone for bay 1 of conference room: 1345 CFM, 50ft x 10ft bay [0,0, 50,0, 50,10, 0,10]
const mockZone: EquipmentServiceZone = {
  id: 'sz-1',
  unitTag: 'FCU-01',
  designControlMode: 'ai',
  equipmentModel: 'Carrier 40QMK048',
  coolingSource: 'dx',
  equipmentType: 'concealed-split',
  nominalTonnage: 4.0,
  actualCapacityBtu: 47005,
  supplyCfm: 1345,
  returnCfm: 1148,
  outdoorAirCfm: 197,
  outdoorAirConnectionApproved: true,
  espInWg: 0.35,
  equipmentPosition: { x: 48, y: 5, rotation: 270, wallSide: 'east' },
  serviceAreaPolygon: [0, 0, 50, 0, 50, 10, 0, 10],
  sensibleLoadBtu: 40000,
  latentLoadBtu: 7000,
  totalLoadBtu: 47000,
  targetNc: 30,
  pressureBudgetInWg: {
    supplyDuct: 0.12,
    returnDuct: 0.06,
    terminals: 0.05,
    fittings: 0.07,
    totalAvailable: 0.35
  },
  isUserOverridden: false
};

// 1. Diffuser Selector test for ~335 CFM terminal target
const selected = selectBestDiffuserFromCatalog(335, 30);
assert(selected !== null, 'Should select a compliant diffuser');
assert(selected.actualNc <= 30, `Diffuser NC should be <= 30, got ${selected.actualNc}`);
assert(selected.throwT50Ft >= 6, `Throw should be >= 6 ft, got ${selected.throwT50Ft}`);

// 2. Supply Diffuser Placement in Service Bay (1345 CFM -> 4 diffusers @ ~336 CFM each)
const supplyTerminals = placeSupplyDiffusersForZone(mockZone, { targetCfmPerDiffuser: 350 });
assert(supplyTerminals.length === 4, `Should place 4 diffusers in the bay, got ${supplyTerminals.length}`);
const sumCfm = supplyTerminals.reduce((sum, t) => sum + t.cfm, 0);
assert(Math.abs(sumCfm - 1345) < 5, `Sum of diffuser CFMs (${sumCfm}) should equal zone CFM (1345)`);

// 3. Return Grille Placement with anti-short-circuit offset
const returnTerminals = placeReturnGrillesForZone(mockZone, supplyTerminals);
assert(returnTerminals.length >= 2, `Should place return grilles, got ${returnTerminals.length}`);
assert(returnTerminals[0].type === 'return', 'Terminal type should be return');

// 4. Air Distribution Validation
const validation = validateTerminalAirDistribution(mockZone, supplyTerminals, returnTerminals);
assert(validation.status === 'pass', `Air distribution validation should pass, got ${validation.status}: ${validation.issues.join(', ')}`);
assert(validation.throwCheck.status === 'pass', 'Throw check should pass');
assert(validation.shortCircuitCheck.status === 'pass', 'Short-circuit check should pass');

console.log('✔ All Terminals and Returns Tests Passed Successfully!');
