import { executeMasterHvacValidation, MasterValidationInput } from '../validation/hvacValidator';
import { getStandardsProfile } from '../standards/designStandards';
import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { SteppedDuctSection } from '../ducts/steppedDuctRouter';
import { OutdoorAirSystem } from '../outdoorAir/freshAirRouter';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running Master 9-Point Validation Tests ===');

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
  pressureBudgetInWg: { supplyDuct: 0.12, returnDuct: 0.06, terminals: 0.05, fittings: 0.07, totalAvailable: 0.35 },
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

const mockDucts: SteppedDuctSection[] = [
  {
    id: 'DS-FCU-01-1',
    unitId: 'sz-1',
    designControlMode: 'ai',
    systemType: 'supply',
    role: 'main-trunk',
    startPoint: { x: 48, y: 5 },
    endPoint: { x: 40, y: 5 },
    airflowCfm: 1345,
    shape: 'rectangular',
    widthIn: 18,
    heightIn: 12,
    velocityFpm: 896,
    allowableVelocityFpm: 1200,
    frictionLossPer100Ft: 0.07,
    fittingLossInWg: 0.01,
    totalSectionLossInWg: 0.015,
    ncRating: 25,
    connectedDiffuserCount: 4,
    connectedDiffusers: ['SAD-FCU-01-1', 'SAD-FCU-01-2', 'SAD-FCU-01-3', 'SAD-FCU-01-4'],
    childDuctIds: ['DS-FCU-01-2']
  }
];

const mockOa: OutdoorAirSystem = {
  id: 'OAS-01',
  designControlMode: 'ai',
  designOutdoorAirCfm: 197,
  sourceType: 'direct-intake',
  louver: {
    id: 'LVR-01',
    manufacturer: 'Ruskin',
    model: 'ELF375DX',
    grossWidthIn: 24,
    grossHeightIn: 16,
    grossAreaSqFt: 2.66,
    freeAreaPercent: 50.0,
    freeAreaSqFt: 1.33,
    designCfm: 197,
    freeAreaVelocityFpm: 148,
    maxAllowableFreeAreaVelocityFpm: 500,
    pressureDropInWg: 0.03,
    waterPenetrationRatingMph: 35
  },
  connectedUnitIds: ['sz-1'],
  ductSectionIds: ['FAD-FCU-01-1'],
  intakePosition: { x: 50, y: 0 },
  pressureLossInWg: 0.08,
  pressurizationStrategy: 'positive',
  targetPressurizationCfm: 30,
  isBalancedWithExhaust: true
};

const input: MasterValidationInput = {
  roomName: 'Conference Hall',
  roomPolygon: [0, 0, 50, 0, 50, 10, 0, 10],
  requiredRoomCfm: 1345,
  designLoadBtu: 47000,
  zones: [mockZone],
  terminals: mockSupplyTerminals,
  ducts: mockDucts,
  outdoorAirSystem: mockOa,
  profile
};

// Execute master validation
const report = executeMasterHvacValidation(input);

// Verify all 9 validation points exist and are evaluated
for(let index=1;index<=10;index++) assert(report.points.some(p=>p.zoneId===mockZone.id&&p.pointIndex===index), `Missing check ${index}`);
// This incomplete historical fixture has no return grilles, no component-capacity evidence, and an orphan duct child.
assert(report.overallStatus === 'FAIL', 'Incomplete physical evidence must fail validation');
for(const index of [3,7,8]) assert(report.points.some(p=>p.pointIndex===index&&p.status==='FAIL'), `Missing expected evidence failure ${index}`);
assert(report.issueReady===false, 'Incomplete design must never be ready for engineering issue');

console.log('✔ All Master 9-Point Validation Tests Passed Successfully!');
