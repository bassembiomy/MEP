import { executeAirDistributionDesign } from '../airDistributionEngine';
import { generateMasterSchedules } from '../export/exportSchedules';
import { exportFullEngineeringDesignReport } from '../export/exportDesignReport';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running Schedules and Decision Log Tests ===');

// Run master pipeline on Conference Hall
const design = executeAirDistributionDesign({
  roomName: 'Conference Hall',
  roomPolygon: [0, 0, 50, 0, 50, 30, 0, 30],
  roomAreaSqFt: 1500,
  sensibleLoadBtu: 120000,
  totalLoadBtu: 141000,
  requiredCfm: 4000,
  occupancyCount: 50,
  systemType: 'concealed',
  mountingWallSide: 'east',
  maxAvailableCeilingDepthIn: 14
});

assert(design.serviceZones.length === 3, 'Should partition into 3 units');
assert(design.supplyTerminals.length === 12, `Should place 12 supply diffusers (4 per unit), got ${design.supplyTerminals.length}`);
assert(design.returnTerminals.length >= 6, `Should place return terminals, got ${design.returnTerminals.length}`);

// Generate schedules
const schedules = generateMasterSchedules(design);
assert(schedules.airDistributionSchedule.length === 1, 'Air distribution schedule should have 1 room row');
assert(schedules.airDistributionSchedule[0].diffuserCount === 12, 'Diffuser count should be 12');
assert(schedules.ductSchedule.length > 10, 'Duct schedule should list all supply and return sections');
assert(schedules.diffuserSchedule.length === design.supplyTerminals.length + design.returnTerminals.length, 'Diffuser schedule should list all terminals');
assert(schedules.equipmentSchedule.length === 3, 'Equipment schedule should list 3 units');
assert(schedules.outdoorAirSchedule.length === 3, 'Outdoor air schedule should list 3 units');

// Generate report
const reportText = exportFullEngineeringDesignReport(design);
assert(reportText.includes('AIR DISTRIBUTION SCHEDULE'), 'Report should include Air Distribution Schedule');
assert(reportText.includes('EQUIPMENT SCHEDULE'), 'Report should include Equipment Schedule');
assert(reportText.includes('DIFFUSER SCHEDULE'), 'Report should include Diffuser Schedule');
assert(reportText.includes('DUCT SCHEDULE'), 'Report should include Duct Schedule');
assert(reportText.includes('OUTDOOR AIR & VENTILATION SCHEDULE'), 'Report should include Outdoor Air Schedule');
assert(reportText.includes('MASTER 9-POINT ENGINEERING VALIDATION MATRIX'), 'Report should include 9-Point Validation Matrix');

console.log('✔ All Schedules and Decision Log Tests Passed Successfully!');
