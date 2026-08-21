import {
  ComponentCategory,
  SystemComponentItem,
  SystemArchitectureBreakdown,
  SelectionAlgorithmStep,
  SelectionAlgorithmTrace,
  SystemDesignCandidate
} from '../types';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running Types Integrity Test ===');

const mockComp: SystemComponentItem = {
  id: 'comp-1',
  category: 'primary-equipment',
  tag: 'ODU-01',
  name: 'Outdoor Condensing Unit',
  modelOrType: 'Carrier 42QSS024-D',
  quantity: 1,
  specification: '2.0 TR (22,355 Btu/h), 614 CFM',
  connectionSize: '3/8" Liq / 5/8" Gas',
  status: 'included',
  details: 'R-410A Variable Speed Inverter Scroll'
};

assert(mockComp.tag === 'ODU-01', 'Tag must match');
assert(mockComp.category === 'primary-equipment', 'Category must match');

const mockStep: SelectionAlgorithmStep = {
  stepNumber: 1,
  stepName: 'Thermal Load & Sensible Heat Ratio (SHR)',
  formula: 'SHR = Q_sensible / Q_total',
  inputs: [
    { label: 'Sensible Load', value: 17100, unit: 'Btu/h' },
    { label: 'Total Load', value: 22355, unit: 'Btu/h' }
  ],
  calculatedValue: '0.76',
  criteria: '0.65 <= SHR <= 0.95',
  passed: true,
  notes: 'Optimal comfort cooling sensible heat ratio'
};

const mockTrace: SelectionAlgorithmTrace = {
  systemType: 'concealed',
  model: 'Carrier 42QSS024-D',
  steps: [mockStep],
  overallPassed: true,
  engineeringRemarks: 'Candidate satisfies all ASHRAE & SMACNA selection criteria.'
};

const mockArch: SystemArchitectureBreakdown = {
  systemType: 'concealed',
  systemName: 'Concealed Ducted DX Split System',
  summary: 'Split DX unit with indoor ducted fan coil, low-profile plenum, and ceiling diffusers.',
  governingStandards: ['ASHRAE 90.1-2019', 'ASHRAE 62.1-2019', 'SMACNA HVAC Duct Construction Standards'],
  components: [mockComp],
  schematicType: 'split-dx-ducted'
};

assert(mockTrace.steps.length === 1, 'Trace must have steps');
assert(mockArch.governingStandards.length === 3, 'Arch must have standards');

console.log('✔ Types integrity test passed successfully');
