import {
  calculateAllowableAcousticVelocity,
  sizeDuctAcoustically,
  verifyDuctSectionAcoustics
} from '../acousticDuctEngine';
import { routeDucts } from '../ductRouter';
import { DiffuserPos } from '../diffuserPlacer';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

console.log('=== Starting HVAC Acoustic Noise & Duct Sizing Engine Validation ===');

// 1. Validate ASHRAE Acoustic Velocity Limits Matrix & Interpolation
{
  console.log('\n--- 1. Testing ASHRAE Acoustic Velocity Limits ---');

  // In shaft / above solid ceiling (Main Trunk)
  const shaftNc45Rect = calculateAllowableAcousticVelocity('in-shaft-solid-ceiling', 45, 'rectangular', 'trunk');
  const shaftNc45Round = calculateAllowableAcousticVelocity('in-shaft-solid-ceiling', 45, 'round', 'trunk');
  const shaftNc35Rect = calculateAllowableAcousticVelocity('in-shaft-solid-ceiling', 35, 'rectangular', 'trunk');
  const shaftNc25Rect = calculateAllowableAcousticVelocity('in-shaft-solid-ceiling', 25, 'rectangular', 'trunk');

  assert(shaftNc45Rect === 3500, `Expected 3500 fpm for Shaft NC45 Rect, got ${shaftNc45Rect}`);
  assert(shaftNc45Round === 5000, `Expected 5000 fpm for Shaft NC45 Round, got ${shaftNc45Round}`);
  assert(shaftNc35Rect === 2500, `Expected 2500 fpm for Shaft NC35 Rect, got ${shaftNc35Rect}`);
  assert(shaftNc25Rect === 1600, `Expected 1600 fpm for Shaft NC25 Rect, got ${shaftNc25Rect}`);

  // Above suspended acoustic ceiling
  const suspNc45Rect = calculateAllowableAcousticVelocity('above-suspended-ceiling', 45, 'rectangular', 'trunk');
  const suspNc35Rect = calculateAllowableAcousticVelocity('above-suspended-ceiling', 35, 'rectangular', 'trunk');
  const suspNc25Rect = calculateAllowableAcousticVelocity('above-suspended-ceiling', 25, 'rectangular', 'trunk');
  const suspNc35Round = calculateAllowableAcousticVelocity('above-suspended-ceiling', 35, 'round', 'trunk');

  assert(suspNc45Rect === 2500, `Expected 2500 fpm for Susp NC45 Rect, got ${suspNc45Rect}`);
  assert(suspNc35Rect === 1750, `Expected 1750 fpm for Susp NC35 Rect, got ${suspNc35Rect}`);
  assert(suspNc25Rect === 1100, `Expected 1100 fpm for Susp NC25 Rect, got ${suspNc25Rect}`);
  assert(suspNc35Round === 3000, `Expected 3000 fpm for Susp NC35 Round, got ${suspNc35Round}`);

  // Duct within occupied space
  const occNc45Rect = calculateAllowableAcousticVelocity('within-occupied-space', 45, 'rectangular', 'trunk');
  const occNc35Rect = calculateAllowableAcousticVelocity('within-occupied-space', 35, 'rectangular', 'trunk');
  const occNc25Rect = calculateAllowableAcousticVelocity('within-occupied-space', 25, 'rectangular', 'trunk');

  assert(occNc45Rect === 2000, `Expected 2000 fpm for Occupied NC45 Rect, got ${occNc45Rect}`);
  assert(occNc35Rect === 1450, `Expected 1450 fpm for Occupied NC35 Rect, got ${occNc35Rect}`);
  assert(occNc25Rect === 950, `Expected 950 fpm for Occupied NC25 Rect, got ${occNc25Rect}`);

  // Section type multipliers: Branch = 80%, Runout = 50%
  const suspNc35Branch = calculateAllowableAcousticVelocity('above-suspended-ceiling', 35, 'rectangular', 'branch');
  const suspNc35Runout = calculateAllowableAcousticVelocity('above-suspended-ceiling', 35, 'rectangular', 'runout');

  assert(suspNc35Branch === Math.round(1750 * 0.8), `Branch velocity must be 80% (1400 fpm), got ${suspNc35Branch}`);
  assert(suspNc35Runout === Math.round(1750 * 0.5), `Runout velocity must be 50% (875 fpm), got ${suspNc35Runout}`);

  console.log('✔ Test 1 Passed: ASHRAE Acoustic Velocity Limits & Section Multipliers verified.');
}

// 2. Validate Acoustic Duct Sizing & Aspect Ratio Control
{
  console.log('\n--- 2. Testing Acoustic Duct Sizing ---');

  // Size 1200 CFM trunk above suspended ceiling @ NC 32
  const trunkSizing = sizeDuctAcoustically(1200, {
    locationCategory: 'above-suspended-ceiling',
    targetNc: 32,
    sectionCategory: 'trunk',
    shape: 'rectangular',
    fixedHeightIn: 10
  });

  console.log('1200 CFM Trunk Sizing:', {
    dims: `${trunkSizing.widthIn}"x${trunkSizing.heightIn}"`,
    actualVel: `${trunkSizing.actualVelocityFpm} FPM`,
    allowableVel: `${trunkSizing.allowableAcousticVelocityFpm} FPM`,
    aspectRatio: trunkSizing.aspectRatio,
    isCompliant: trunkSizing.isCompliant
  });

  assert(trunkSizing.isCompliant, 'Trunk sizing must be acoustically compliant');
  assert(trunkSizing.actualVelocityFpm <= trunkSizing.allowableAcousticVelocityFpm, 'Actual velocity must not exceed allowable');
  assert(trunkSizing.aspectRatio <= 3.5, 'Aspect ratio must not exceed 3.5');

  // Size 300 CFM runout to diffuser @ NC 28 (Conference)
  const runoutSizing = sizeDuctAcoustically(300, {
    locationCategory: 'above-suspended-ceiling',
    targetNc: 28,
    sectionCategory: 'runout',
    shape: 'rectangular',
    fixedHeightIn: 8
  });

  console.log('300 CFM Runout Sizing:', {
    dims: `${runoutSizing.widthIn}"x${runoutSizing.heightIn}"`,
    actualVel: `${runoutSizing.actualVelocityFpm} FPM`,
    allowableVel: `${runoutSizing.allowableAcousticVelocityFpm} FPM`,
    isCompliant: runoutSizing.isCompliant
  });

  assert(runoutSizing.isCompliant, 'Runout sizing must be acoustically compliant');
  assert(runoutSizing.actualVelocityFpm <= runoutSizing.allowableAcousticVelocityFpm, 'Runout velocity must be <= runout limit');

  // Round duct sizing
  const roundTrunk = sizeDuctAcoustically(800, {
    locationCategory: 'within-occupied-space',
    targetNc: 35,
    sectionCategory: 'trunk',
    shape: 'round'
  });

  assert(roundTrunk.shape === 'round', 'Must be round shape');
  assert(roundTrunk.diameterIn % 2 === 0, 'Round duct diameter must be in 2-inch increments');
  assert(roundTrunk.actualVelocityFpm <= roundTrunk.allowableAcousticVelocityFpm, 'Round actual velocity must satisfy limit');

  console.log('✔ Test 2 Passed: Acoustic Duct Sizing & Dimensions verified.');
}

// 3. Validate 10-Step Verification Routine & Auto-Remediation Proposal
{
  console.log('\n--- 3. Testing 10-Step Acoustic Verification & Remediation ---');

  // Simulate an undersized duct section with excessive velocity
  const undersizedDuct = {
    id: 'duct-test-overspeed',
    type: 'branch',
    widthIn: 8,
    heightIn: 6, // Area = 48 sqin = 0.333 sqft
    cfm: 600, // Velocity = 1800 FPM (Exceeds NC 30 branch limit ~1136 FPM)
    sectionCategory: 'branch' as const
  };

  const verification = verifyDuctSectionAcoustics(undersizedDuct, {
    zoneName: 'Executive Boardroom',
    targetNc: 28,
    locationCategory: 'above-suspended-ceiling'
  });

  console.log('Undersized Duct Verification Result:', {
    status: verification.complianceStatus,
    actualVel: verification.actualVelocityFpm,
    allowableVel: verification.allowableAcousticVelocityFpm,
    warnings: verification.warnings,
    remediation: verification.proposedRemediation
  });

  assert(verification.complianceStatus === 'REQUIRES REDESIGN', 'Must flag non-compliant duct as REQUIRES REDESIGN');
  assert(verification.warnings.length > 0, 'Must provide warning message for acoustic violation');
  assert(typeof verification.proposedRemediation === 'string', 'Must provide auto-remediation proposal');

  // Simulate compliant duct
  const compliantDuct = {
    id: 'duct-test-ok',
    type: 'trunk',
    widthIn: 16,
    heightIn: 10,
    cfm: 800,
    sectionCategory: 'trunk' as const
  };

  const okVerification = verifyDuctSectionAcoustics(compliantDuct, {
    zoneName: 'Executive Boardroom',
    targetNc: 28,
    locationCategory: 'above-suspended-ceiling'
  });

  assert(okVerification.complianceStatus === 'PASS', 'Must flag compliant duct as PASS');

  console.log('✔ Test 3 Passed: 10-Step Acoustic Verification & Remediation verified.');
}

// 4. Validate Duct Routing with Embedded Acoustic Verification
{
  console.log('\n--- 4. Testing End-to-End Acoustic Duct Routing ---');

  const zonePoints = [0, 0, 300, 0, 300, 200, 0, 200];
  const diffusers: DiffuserPos[] = [
    { id: 'dif-1', x: 60, y: 100, cfm: 250, size: '12"x12"' },
    { id: 'dif-2', x: 150, y: 100, cfm: 250, size: '12"x12"' },
    { id: 'dif-3', x: 240, y: 100, cfm: 250, size: '12"x12"' }
  ];

  const routeResult = routeDucts(
    zonePoints,
    diffusers,
    'imperial',
    'zone-test',
    { x: 20, y: 100 },
    'concealed',
    { x: -50, y: 100 },
    {
      targetNc: 28,
      locationCategory: 'above-suspended-ceiling',
      enhancedPerformance: true,
      zoneName: 'Acoustic Suite'
    }
  );

  assert(routeResult.ducts.length > 0, 'Must generate duct segments');

  let allSegmentsPass = true;
  for (const d of routeResult.ducts) {
    assert(d.acousticVerification !== undefined, 'Every duct segment must have embedded acoustic verification');
    console.log(`Duct [${d.id}] ${d.sizeLabel} @ ${d.velocityFpm} FPM (Limit: ${d.acousticVerification?.allowableAcousticVelocityFpm} FPM) -> ${d.acousticVerification?.complianceStatus}`);
    if (d.acousticVerification?.complianceStatus !== 'PASS') {
      allSegmentsPass = false;
    }
  }

  assert(allSegmentsPass, 'All routed ducts must pass acoustic velocity verification');
  console.log('✔ Test 4 Passed: End-to-End Acoustic Duct Routing verified.');
}

console.log('\n=== ALL HVAC DUCT SIZING & ACOUSTIC NOISE TESTS PASSED SUCCESSFULLY! ===\n');
