import { routeSteppedSupplyDucts } from '../ducts/steppedDuctRouter';
import { routeReturnDucts } from '../ducts/returnDuctRouter';
import { sizeDuctNetwork } from '../ducts/aerodynamicDuctSizer';
import { calculateDuctFrictionLoss } from '../ducts/ductPressureCalculator';
import { calculateFittingLosses } from '../ducts/fittingLossCalculator';
import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { getStandardsProfile } from '../standards/designStandards';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running Stepped Ducts and Sizing Tests ===');

const profile = getStandardsProfile('ashrae');

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

const mockSupplyTerminals: CoordinatedAirTerminal[] = [
  {
    id: 'SAD-FCU-01-1',
    unitId: 'sz-1',
    designControlMode: 'ai',
    type: 'supply',
    subtype: '4-way-ceiling',
    position: { x: 40, y: 5 },
    cfm: 335,
    catalogModel: 'Titus TMS',
    neckDimension: '10" dia',
    faceDimension: '24"x24"',
    throwT50Ft: 10,
    throwRatio: 1.0,
    adjacentOverlapRatio: 0.85,
    occupiedZoneVelocityFpm: 40,
    ncRating: 22,
    deltaPInWg: 0.035,
    status: 'pass'
  },
  {
    id: 'SAD-FCU-01-2',
    unitId: 'sz-1',
    designControlMode: 'ai',
    type: 'supply',
    subtype: '4-way-ceiling',
    position: { x: 30, y: 5 },
    cfm: 335,
    catalogModel: 'Titus TMS',
    neckDimension: '10" dia',
    faceDimension: '24"x24"',
    throwT50Ft: 10,
    throwRatio: 1.0,
    adjacentOverlapRatio: 0.85,
    occupiedZoneVelocityFpm: 40,
    ncRating: 22,
    deltaPInWg: 0.035,
    status: 'pass'
  },
  {
    id: 'SAD-FCU-01-3',
    unitId: 'sz-1',
    designControlMode: 'ai',
    type: 'supply',
    subtype: '4-way-ceiling',
    position: { x: 20, y: 5 },
    cfm: 335,
    catalogModel: 'Titus TMS',
    neckDimension: '10" dia',
    faceDimension: '24"x24"',
    throwT50Ft: 10,
    throwRatio: 1.0,
    adjacentOverlapRatio: 0.85,
    occupiedZoneVelocityFpm: 40,
    ncRating: 22,
    deltaPInWg: 0.035,
    status: 'pass'
  },
  {
    id: 'SAD-FCU-01-4',
    unitId: 'sz-1',
    designControlMode: 'ai',
    type: 'supply',
    subtype: '4-way-ceiling',
    position: { x: 10, y: 5 },
    cfm: 340,
    catalogModel: 'Titus TMS',
    neckDimension: '10" dia',
    faceDimension: '24"x24"',
    throwT50Ft: 10,
    throwRatio: 1.0,
    adjacentOverlapRatio: 0.85,
    occupiedZoneVelocityFpm: 40,
    ncRating: 22,
    deltaPInWg: 0.035,
    status: 'pass'
  }
];

// 1. Stepped Supply Duct Routing
const supplyDucts = routeSteppedSupplyDucts(mockZone, mockSupplyTerminals);
assert(supplyDucts.length >= 4, `Should create at least 4 duct segments, got ${supplyDucts.length}`);

// Verify CFM decrements (matching the drawing: 1345 -> 1010 -> 675 -> 340)
assert(supplyDucts[0].airflowCfm === 1345, `Main trunk should start at 1345 CFM, got ${supplyDucts[0].airflowCfm}`);
const lastSection = supplyDucts[supplyDucts.length - 1];
assert(lastSection.airflowCfm === 340 || lastSection.airflowCfm === 335, `Final runout should be ~335-340 CFM, got ${lastSection.airflowCfm}`);

// 2. Aerodynamic Duct Sizing
const sizedDucts = sizeDuctNetwork(supplyDucts, profile, 14);
for (const d of sizedDucts) {
  assert(d.widthIn > 0 && d.heightIn > 0, 'Duct dimensions must be positive');
  assert(d.heightIn <= 14, `Duct height ${d.heightIn}" must not exceed ceiling max 14"`);
  assert(d.velocityFpm <= d.allowableVelocityFpm + 50, `Duct velocity ${d.velocityFpm} FPM must be within limit ${d.allowableVelocityFpm}`);
}

// 3. Pressure loss calculation
const frictionLoss = calculateDuctFrictionLoss(sizedDucts[0]);
assert(frictionLoss > 0, 'Friction loss should be positive');

const fittingLoss = calculateFittingLosses(sizedDucts);
assert(fittingLoss >= 0, 'Fitting loss should be calculated');

// 4. Return Duct Routing
assert(routeReturnDucts(mockZone, []).length === 0, 'Missing grilles must not create fabricated connected return evidence');
const returnGrille: CoordinatedAirTerminal = { ...mockSupplyTerminals[0], id: 'RAG-1', type: 'return', position: {x:10,y:2}, cfm:mockZone.returnCfm };
const returnDucts = routeReturnDucts(mockZone, [returnGrille]);
assert(returnDucts.length >= 1, 'Should route return duct network');

console.log('✔ All Stepped Ducts and Sizing Tests Passed Successfully!');
