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

assert(design.serviceZones.length === design.selectedOption.unitCount, 'Schedule service zones must match the selected feasible unit quantity');
assert(design.supplyTerminals.length === design.serviceZones.length*4, 'Fixture must place four supply terminals per selected unit');
assert(design.returnTerminals.length >= 6, `Should place return terminals, got ${design.returnTerminals.length}`);

// Generate schedules
const schedules = generateMasterSchedules(design);
assert(schedules.airDistributionSchedule.length === 1, 'Air distribution schedule should have 1 room row');
assert(schedules.airDistributionSchedule[0].diffuserCount === design.supplyTerminals.length, 'Schedule must count actual deployed supply diffusers');
assert(schedules.ductSchedule.length > 10, 'Duct schedule should list all supply and return sections');
assert(schedules.diffuserSchedule.length === design.supplyTerminals.length + design.returnTerminals.length, 'Diffuser schedule should list all terminals');
assert(schedules.equipmentSchedule.length === design.serviceZones.length, 'Equipment schedule must list actual selected units');
assert(schedules.outdoorAirSchedule.length === design.serviceZones.length, 'Outdoor air schedule must match actual service units');

// Generate report
const reportText = exportFullEngineeringDesignReport(design);
assert(reportText.includes('AIR DISTRIBUTION SCHEDULE'), 'Report should include Air Distribution Schedule');
assert(reportText.includes('EQUIPMENT SCHEDULE'), 'Report should include Equipment Schedule');
assert(reportText.includes('DIFFUSER SCHEDULE'), 'Report should include Diffuser Schedule');
assert(reportText.includes('DUCT SCHEDULE'), 'Report should include Duct Schedule');
assert(reportText.includes('OUTDOOR AIR & VENTILATION SCHEDULE'), 'Report should include Outdoor Air Schedule');
assert(reportText.includes('MASTER 10-POINT PRELIMINARY ENGINEERING VALIDATION MATRIX'), 'Report must identify all ten checks and preliminary scope');
assert(reportText.includes('NOT FOR CONSTRUCTION'), 'Report must retain issue-readiness limitation');
assert(reportText.includes('Manufacturer capacities'), 'Report must include unresolved manufacturer evidence');

console.log('✔ All Schedules and Decision Log Tests Passed Successfully!');
