import { generateSystemCandidates } from '../systemDesigner';
import { STANDARD_EQUIPMENT_CATALOG } from '../hvacCatalogs';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Acceptance Assertion Failed: ${msg}`);
}

console.log('=== Starting HVAC Architecture & Selection Algorithm Acceptance Suite ===');

// 1. Test All 6 System Types Architecture Completeness
{
  const systemTypes = ['concealed', 'cassette', 'high-wall', 'vrf', 'packaged', 'ahu'];
  const summary = generateSystemCandidates(
    36000,
    27000,
    1200,
    'office',
    600,
    true,
    {},
    systemTypes
  );

  console.log(`Generated ${summary.candidates.length} candidates across 6 system types.`);
  assert(summary.candidates.length > 0, 'Must generate candidates');

  for (const cand of summary.candidates) {
    // Check System Architecture
    assert(cand.systemArchitecture !== undefined, `Candidate ${cand.id} missing systemArchitecture`);
    const arch = cand.systemArchitecture!;
    assert(arch.systemType === cand.systemType, `Arch systemType mismatch for ${cand.id}`);
    assert(arch.components.length >= 3, `Candidate ${cand.id} must have >= 3 components, got ${arch.components.length}`);
    assert(arch.governingStandards.length > 0, `Candidate ${cand.id} must have governing standards`);

    // Check component tagging & specifications
    for (const comp of arch.components) {
      assert(Boolean(comp.tag), `Component in ${cand.id} missing tag`);
      assert(Boolean(comp.name), `Component in ${cand.id} missing name`);
      assert(comp.quantity > 0, `Component ${comp.tag} in ${cand.id} must have quantity > 0`);
      assert(Boolean(comp.specification), `Component ${comp.tag} in ${cand.id} missing specification`);
    }

    // Check 7-Step Selection Algorithm Trace
    assert(cand.algorithmTrace !== undefined, `Candidate ${cand.id} missing algorithmTrace`);
    const trace = cand.algorithmTrace!;
    assert(trace.steps.length === 7, `Candidate ${cand.id} trace must have exactly 7 steps, got ${trace.steps.length}`);
    
    // Verify each step structure
    const stepNames = [
      'Thermal Load',
      'Airflow',
      'Equipment Tonnage',
      'Air Distribution',
      'Aerodynamic Duct',
      'Fan Operating',
      'Piping'
    ];

    for (let i = 0; i < 7; i++) {
      const step = trace.steps[i];
      assert(step.stepNumber === i + 1, `Step ${i + 1} has wrong stepNumber`);
      assert(step.stepName.toLowerCase().includes(stepNames[i].toLowerCase()), `Step ${i + 1} name mismatch`);
      assert(step.formula.length > 0, `Step ${i + 1} in ${cand.id} missing formula`);
      assert(step.inputs.length > 0, `Step ${i + 1} in ${cand.id} missing inputs`);
      assert(step.calculatedValue !== undefined && step.calculatedValue !== '', `Step ${i + 1} in ${cand.id} missing calculatedValue`);
      assert(Boolean(step.criteria), `Step ${i + 1} in ${cand.id} missing criteria`);
    }
  }

  console.log('✔ Acceptance Test 1 Passed: Complete Architecture & 7-Step Trace for all candidates');
}

// 2. Test Multi-Unit Large Space Scaling
{
  // 120,000 Btu/h (10 TR) space with 1,800 sq.ft
  const summary = generateSystemCandidates(
    120000,
    90000,
    4000,
    'open-office',
    1800,
    true,
    {},
    ['concealed', 'cassette']
  );

  const multiUnitCand = summary.candidates.find(c => c.quantity > 1);
  assert(multiUnitCand !== undefined, 'Must generate multi-unit candidate for 10 TR load');
  assert(multiUnitCand!.systemArchitecture !== undefined, 'Multi-unit candidate must have architecture');
  
  const arch = multiUnitCand!.systemArchitecture!;
  const odu = arch.components.find(c => c.category === 'primary-equipment');
  assert(odu !== undefined, 'Must have primary equipment');
  assert(odu!.quantity === multiUnitCand!.quantity, `ODU quantity (${odu!.quantity}) must match candidate quantity (${multiUnitCand!.quantity})`);

  console.log(`✔ Acceptance Test 2 Passed: Multi-Unit scaling verified (${multiUnitCand!.quantity} × ${multiUnitCand!.equipment.model})`);
}

// 3. Test Trace Diagnostics & Pass/Fail Integrity
{
  // Small load with very high acoustic sensitivity
  const summary = generateSystemCandidates(
    12000,
    9000,
    300,
    'conference', // NC 28 limit
    200,
    true
  );

  for (const cand of summary.candidates) {
    const trace = cand.algorithmTrace!;
    if (cand.isValid) {
      assert(trace.overallPassed === true, `Valid candidate ${cand.id} should have overallPassed: true`);
    }
  }
  console.log('✔ Acceptance Test 3 Passed: Selection trace pass/fail integrity verified');
}

console.log('=== All HVAC Architecture Acceptance Tests Passed Successfully ===');
