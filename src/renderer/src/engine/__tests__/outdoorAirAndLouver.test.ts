import { calculateRoomOutdoorAir } from '../outdoorAir/outdoorAirCalculator';
import { sizeOutdoorAirLouver } from '../outdoorAir/louverSizer';
import { routeFreshAirDucts } from '../outdoorAir/freshAirRouter';
import { validateOutdoorAirVentilation } from '../outdoorAir/ventilationValidator';
import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { getStandardsProfile } from '../standards/designStandards';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running Outdoor Air and Louver Tests ===');

const profile = getStandardsProfile('ashrae');

// 1. Calculate Outdoor Air CFM for Conference Room (50 occupants, 1500 sq ft)
// 50 * 5 + 1500 * 0.06 = 250 + 90 = 340 CFM (or 592 CFM with safety/ventilation effectiveness)
const oaResult = calculateRoomOutdoorAir({
  roomName: 'Conference Hall',
  occupancyCount: 50,
  areaSqFt: 1500,
  spaceCategory: 'conference-meeting',
  profile
});
assert(oaResult.requiredOaCfm >= 340, `Required OA CFM should be >= 340, got ${oaResult.requiredOaCfm}`);

// 2. Size Outdoor Air Intake Louver (592 CFM target)
// Free area velocity <= 500 FPM, free area ratio ~ 50%
const louver = sizeOutdoorAirLouver(592, profile);
assert(louver.freeAreaSqFt >= 592 / 500, `Free area should be >= ${(592 / 500).toFixed(2)} sqft, got ${louver.freeAreaSqFt}`);
assert(louver.grossAreaSqFt > louver.freeAreaSqFt, 'Gross area must be greater than free area (Gross != Free)');
assert(louver.freeAreaVelocityFpm <= 500, `Free area velocity should be <= 500 FPM, got ${louver.freeAreaVelocityFpm}`);
assert(louver.pressureDropInWg > 0, 'Louver pressure drop should be positive');

// 3. Route Fresh Air Ducts to 3 Concealed Units
const mockZones: EquipmentServiceZone[] = [
  {
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
    pressureBudgetInWg: { supplyDuct: 0.12, returnDuct: 0.06, terminals: 0.05, fittings: 0.07, totalAvailable: 0.35 },
    isUserOverridden: false
  },
  {
    id: 'sz-2',
    unitTag: 'FCU-02',
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
    equipmentPosition: { x: 48, y: 15, rotation: 270, wallSide: 'east' },
    serviceAreaPolygon: [0, 10, 50, 10, 50, 20, 0, 20],
    sensibleLoadBtu: 40000,
    latentLoadBtu: 7000,
    totalLoadBtu: 47000,
    targetNc: 30,
    pressureBudgetInWg: { supplyDuct: 0.12, returnDuct: 0.06, terminals: 0.05, fittings: 0.07, totalAvailable: 0.35 },
    isUserOverridden: false
  },
  {
    id: 'sz-3',
    unitTag: 'FCU-03',
    designControlMode: 'ai',
    equipmentModel: 'Carrier 40QMK048',
    coolingSource: 'dx',
    equipmentType: 'concealed-split',
    nominalTonnage: 4.0,
    actualCapacityBtu: 47005,
    supplyCfm: 1345,
    returnCfm: 1148,
    outdoorAirCfm: 198,
    outdoorAirConnectionApproved: true,
    espInWg: 0.35,
    equipmentPosition: { x: 48, y: 25, rotation: 270, wallSide: 'east' },
    serviceAreaPolygon: [0, 20, 50, 20, 50, 30, 0, 30],
    sensibleLoadBtu: 40000,
    latentLoadBtu: 7000,
    totalLoadBtu: 47000,
    targetNc: 30,
    pressureBudgetInWg: { supplyDuct: 0.12, returnDuct: 0.06, terminals: 0.05, fittings: 0.07, totalAvailable: 0.35 },
    isUserOverridden: false
  }
];

const oaSystem = routeFreshAirDucts(mockZones, 592, { x: 50, y: 0 });
assert(oaSystem.designOutdoorAirCfm === 592, 'Total OA CFM should be 592');
assert(oaSystem.connectedUnitIds.length === 3, 'Should connect to 3 units');
assert(oaSystem.ductSectionIds.length >= 3, 'Should route fresh air ducts');

// 4. Validate Ventilation and Pressurization
const ventValidation = validateOutdoorAirVentilation(oaSystem, mockZones);
assert(ventValidation.status === 'pass', 'Outdoor air validation should pass');
assert(ventValidation.pressurizationStrategy === 'positive', 'Default strategy should be positive');

console.log('✔ All Outdoor Air and Louver Tests Passed Successfully!');
