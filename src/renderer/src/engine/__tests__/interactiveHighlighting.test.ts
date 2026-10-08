import assert from 'node:assert';
import { generateMasterSchedules } from '../export/exportSchedules';
import { executeAirDistributionDesign } from '../airDistributionEngine';
import { generateSystemCandidates, DEFAULT_OPTIMIZATION_WEIGHTS } from '../systemDesigner';

console.log('=== Running Interactive CAD Highlighting Test Suite ===');

// 1. Air Distribution Schedule Duct & Terminal ID Alignment Test
const design = executeAirDistributionDesign({
  roomName: 'Executive Boardroom',
  roomPolygon: [0, 0, 400, 0, 400, 300, 0, 300],
  roomAreaSqFt: 1200,
  sensibleLoadBtu: 80000,
  totalLoadBtu: 95000,
  requiredCfm: 2800,
  occupancyCount: 30,
  systemType: 'concealed',
  mountingWallSide: 'east',
  maxAvailableCeilingDepthIn: 14
});

const schedules = generateMasterSchedules(design);
assert(schedules.ductSchedule.length > 0, 'Duct schedule must have rows');
assert(schedules.diffuserSchedule.length > 0, 'Diffuser schedule must have rows');

// Verify every duct row in schedule has a non-empty ductId that corresponds to design ducts
for (const ductRow of schedules.ductSchedule) {
  assert(ductRow.ductId && ductRow.ductId.length > 0, 'Every duct schedule row must have a valid ductId');
  const foundInDesign = design.supplyDucts.some(d => d.id === ductRow.ductId) ||
                        design.returnDucts.some(d => d.id === ductRow.ductId);
  assert(foundInDesign, `Duct ID ${ductRow.ductId} must match a duct segment in the design`);
}

// Verify every diffuser row in schedule has a non-empty terminalId
for (const termRow of schedules.diffuserSchedule) {
  assert(termRow.terminalId && termRow.terminalId.length > 0, 'Every diffuser schedule row must have a valid terminalId');
  const foundInTerminals = design.supplyTerminals.some(t => t.id === termRow.terminalId) ||
                           design.returnTerminals.some(t => t.id === termRow.terminalId);
  assert(foundInTerminals, `Terminal ID ${termRow.terminalId} must match a terminal in the design`);
}

// 2. Optimizer Studio Candidate Components ID Alignment Test
const candidates = generateSystemCandidates(
  36000,
  24000,
  1200,
  'office',
  600,
  true,
  DEFAULT_OPTIMIZATION_WEIGHTS,
  ['concealed', 'cassette', 'high-wall', 'packaged']
);

assert(candidates.candidates.length > 0, 'Must generate candidates');
for (const cand of candidates.candidates) {
  if (cand.systemArchitecture) {
    assert(cand.systemArchitecture.components.length > 0, 'System architecture must have components');
    for (const comp of cand.systemArchitecture.components) {
      assert(comp.id && comp.id.length > 0, 'Component must have a valid id');
      assert(comp.tag && comp.tag.length > 0, 'Component must have a valid tag (e.g. AHU-1, SAD-1, TRK-1)');
    }
  }
}

console.log('✔ All Interactive Highlighting ID Alignment tests passed successfully!');
