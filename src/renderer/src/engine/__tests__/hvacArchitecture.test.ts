import {
  generateSystemArchitecture,
  generateSelectionAlgorithmTrace
} from '../hvacArchitecture';
import { STANDARD_EQUIPMENT_CATALOG } from '../hvacCatalogs';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running HVAC Architecture & Selection Algorithm Engine Tests ===');

// 1. Test Concealed Ducted Split
{
  const equip = STANDARD_EQUIPMENT_CATALOG.find(e => e.id === 'eq-miraco-msp-24k')!; // 2.0 Ton (22,355 Btu/h)
  const arch = generateSystemArchitecture(equip, 1, 614, 400, 21000, true);
  
  assert(arch.systemType === 'concealed', 'System type must be concealed');
  assert(arch.components.length >= 6, 'Must contain at least 6 components');
  assert(arch.components.some(c => c.category === 'primary-equipment'), 'Must have primary equipment');
  assert(arch.components.some(c => c.category === 'air-distribution'), 'Must have air distribution');
  assert(arch.components.some(c => c.category === 'terminals'), 'Must have terminals');
  assert(arch.components.some(c => c.category === 'hydronics-refrigerant'), 'Must have refrigerant piping');
  assert(arch.components.some(c => c.category === 'controls-electrical'), 'Must have controls');

  const trace = generateSelectionAlgorithmTrace(
    equip,
    1,
    614,
    400,
    21000,
    16500,
    32,
    { espRequiredInWg: 0.32, totalLossInWg: 0.28 } as any,
    { isValid: true, operatingEspInWg: 0.32, fanMarginInWg: 0.13, powerKwEstimate: 0.22 } as any,
    true
  );

  assert(trace.steps.length === 7, `Expected 7 steps, got ${trace.steps.length}`);
  assert(trace.steps[0].stepNumber === 1, 'Step 1 must be present');
  assert(trace.steps[1].stepNumber === 2, 'Step 2 must be present');
  assert(trace.steps[2].stepNumber === 3, 'Step 3 must be present');
  assert(trace.steps[3].stepNumber === 4, 'Step 4 must be present');
  assert(trace.steps[4].stepNumber === 5, 'Step 5 must be present');
  assert(trace.steps[5].stepNumber === 6, 'Step 6 must be present');
  assert(trace.steps[6].stepNumber === 7, 'Step 7 must be present');
  assert(trace.overallPassed === true, `Trace overall should pass, failed steps: ${trace.steps.filter(s => !s.passed).map(s => s.stepName).join(', ')}`);
  console.log('✔ Test 1: Concealed Ducted architecture & trace passed');
}

// 2. Test All 6 System Types
{
  const systemTypes = ['concealed', 'cassette', 'high-wall', 'vrf', 'packaged', 'ahu'] as const;
  for (const sys of systemTypes) {
    const equip = STANDARD_EQUIPMENT_CATALOG.find(e => e.systemType === sys)!;
    const arch = generateSystemArchitecture(equip, 2, equip.nominalCfm * 2, 800, equip.totalCapacityBtuPerHour * 2 * 0.9, true);
    assert(arch.components.length > 0, `Architecture for ${sys} must have components`);
    assert(arch.governingStandards.length > 0, `Architecture for ${sys} must have standards`);

    const trace = generateSelectionAlgorithmTrace(
      equip,
      2,
      equip.nominalCfm * 2,
      800,
      equip.totalCapacityBtuPerHour * 2 * 0.9,
      equip.totalCapacityBtuPerHour * 2 * 0.7,
      35,
      { espRequiredInWg: 0.35, totalLossInWg: 0.30 } as any,
      { isValid: true, operatingEspInWg: 0.35, fanMarginInWg: 0.15, powerKwEstimate: 0.5 } as any,
      true
    );
    assert(trace.steps.length === 7, `Trace for ${sys} must have 7 steps`);
  }
  console.log('✔ Test 2: All 6 system types architecture & trace passed');
}

console.log('=== All HVAC Architecture & Algorithm Engine Tests Passed ===');
