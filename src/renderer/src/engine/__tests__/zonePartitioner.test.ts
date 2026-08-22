import { partitionRoomIntoServiceZones, EquipmentServiceZoneInput } from '../zoning/zonePartitioner';
import { calculateSolarLoadWeights } from '../zoning/solarLoadWeighting';
import { distributeLoadsAcrossZones } from '../zoning/loadDistribution';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running Zone Partitioner & Zoning Tests ===');

// 1. Solar Load Weighting
// A 50ft x 30ft conference room with south external wall with heavy glass
const solarWeights = calculateSolarLoadWeights({
  unitCount: 3,
  exteriorWalls: [{ side: 'south', glassRatio: 0.6, solarGainFactor: 1.4 }]
});
assert(solarWeights.length === 3, 'Should have 3 weights');
assert(solarWeights[0] > 0.30, 'South-facing zone should have higher load weight');

// 2. Load distribution
const distributed = distributeLoadsAcrossZones({
  totalSensibleBtu: 120000,
  totalLatentBtu: 21000,
  totalCfm: 4000,
  totalOutdoorAirCfm: 592,
  weights: [0.36, 0.32, 0.32]
});
assert(distributed.length === 3, 'Should distribute loads across 3 zones');
assert(
  Math.abs(distributed[0].sensibleBtu + distributed[1].sensibleBtu + distributed[2].sensibleBtu - 120000) < 5,
  'Sum of sensible BTU should equal total'
);
assert(
  Math.abs(distributed[0].supplyCfm + distributed[1].supplyCfm + distributed[2].supplyCfm - 4000) < 5,
  'Sum of CFM should equal total'
);

// 3. Geometric Room Partitioning into 3 Bays
// Rectangular room 1500 sq ft (50ft x 30ft: [0,0, 50,0, 50,30, 0,30])
const roomPolygon = [0, 0, 50, 0, 50, 30, 0, 30];
const partitionInput: EquipmentServiceZoneInput = {
  roomName: 'Conference Hall',
  roomPolygon,
  unitCount: 3,
  selectedModel: 'Carrier 40QMK048',
  nominalTonnage: 4.0,
  totalCapacityBtu: 141000,
  totalSensibleBtu: 120000,
  totalLatentBtu: 21000,
  totalSupplyCfm: 4000,
  totalOutdoorAirCfm: 592,
  availableEspInWg: 0.35,
  mountingWallSide: 'east',
  targetNc: 30
};

const serviceZones = partitionRoomIntoServiceZones(partitionInput);
assert(serviceZones.length === 3, 'Should create 3 service zones');

// Verify service zones have valid polygons and non-zero area
for (let i = 0; i < serviceZones.length; i++) {
  const z = serviceZones[i];
  assert(z.unitTag === `FCU-0${i + 1}`, `Unit tag should be FCU-0${i + 1}`);
  assert(z.serviceAreaPolygon.length >= 6, 'Service area polygon should be valid');
  assert(z.supplyCfm > 1000, 'Each unit should deliver > 1000 CFM');
  assert(z.pressureBudgetInWg.totalAvailable === 0.35, 'Pressure budget total should match unit ESP');
  assert(z.designControlMode === 'ai', 'Default control mode should be ai');
}

console.log('✔ All Zone Partitioner & Zoning Tests Passed Successfully!');
