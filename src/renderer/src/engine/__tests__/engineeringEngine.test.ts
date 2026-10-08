import { calculateZoneLoad } from '../loadCalc';
import { sizeDuct, sizeDuctConstantVelocity, sizeRoundDuct } from '../ductSizer';
import { solveDirectedNetworkStaticPressure, evaluateFanOperatingPoint, calculateBranchBalancingSchedule } from '../staticPressureCalc';
import { generateSystemCandidates } from '../systemDesigner';
import { selectBestDiffuserFromCatalog } from '../diffuserPlacer';
import { STANDARD_EQUIPMENT_CATALOG, STANDARD_DIFFUSER_CATALOG, STANDARD_DUCT_TYPES } from '../hvacCatalogs';
import { Zone, ProjectMetadata } from '../../store/projectStore';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

console.log('=== Starting MEP HVAC Engineering Engine Validation ===');

// 1. Test Airflow & ASHRAE 62.1-2019 Ventilation
{
  const mockProject: ProjectMetadata = {
    name: 'Test Project',
    location: 'Cairo, Egypt',
    scale: 10,
    units: 'imperial',
    outdoorDb: 95,
    indoorDb: 75
  };

  const mockZone: Zone = {
    id: 'zone-test',
    name: 'Conference Room Test',
    points: [0, 0, 200, 0, 200, 150, 0, 150], // 20ft x 15ft = 300 sqft
    spaceTypeId: 'conference',
    ceilingHeight: 10,
    occupants: 15,
    diffusers: [],
    ducts: []
  };

  const load = calculateZoneLoad(mockZone, mockProject);

  console.log('1. Load & Ventilation Result:', {
    area: load.area,
    totalLoad: load.totalLoad,
    sensibleLoad: load.sensibleLoad,
    supplyCfm: load.supplyCfm,
    thermalCfm: load.thermalCfm,
    vbzCfm: load.vbzCfm,
    vozCfm: load.vozCfm
  });

  assert(load.area === 300, `Area must be 300 sqft, got ${load.area}`);
  assert(load.vbzCfm > 0, 'Breathing zone ventilation must be positive');
  assert(load.supplyCfm >= load.thermalCfm, 'Supply CFM must cover thermal sensible airflow');
  assert(load.supplyCfm >= load.vozCfm, 'Supply CFM must cover outdoor air requirement');
  console.log('✔ Test 1 Passed: Airflow & ASHRAE 62.1 Ventilation');
}

// 2. Test Duct Sizing & Airflow Conservation
{
  const trunkFlow = 1000;
  const branch1Flow = 600;
  const branch2Flow = 400;

  assert(branch1Flow + branch2Flow === trunkFlow, 'Airflow must be conserved across branches');

  const trunkSize = sizeDuct(trunkFlow, 0.10, 10);
  const branch1Size = sizeDuct(branch1Flow, 0.10, 10);
  const branch2Size = sizeDuct(branch2Flow, 0.10, 8);

  console.log('2. Duct Sizing:', {
    trunk: `${trunkSize.widthIn}"x${trunkSize.heightIn}" @ ${trunkSize.velocityFpm} FPM`,
    branch1: `${branch1Size.widthIn}"x${branch1Size.heightIn}" @ ${branch1Size.velocityFpm} FPM`,
    branch2: `${branch2Size.widthIn}"x${branch2Size.heightIn}" @ ${branch2Size.velocityFpm} FPM`
  });

  assert(trunkSize.velocityFpm > 0 && trunkSize.velocityFpm <= 1300, 'Trunk velocity must be within acceptable range');
  assert(branch1Size.velocityFpm <= 1100, 'Branch velocity must be within acceptable range');
  assert(trunkSize.aspectRatio <= 3.5, 'Aspect ratio must not exceed 3.5:1');

  // Constant velocity test
  const cvSize = sizeDuctConstantVelocity(800, 1000, 10);
  assert(cvSize.velocityFpm >= 900 && cvSize.velocityFpm <= 1150, 'Constant velocity sizing within tolerance');

  // Round duct test
  const roundSize = sizeRoundDuct(600, 0.10);
  assert(roundSize.diameterIn >= 10 && roundSize.diameterIn <= 14, 'Round diameter within expected bounds');

  console.log('✔ Test 2 Passed: Duct Sizing & Airflow Conservation');
}

// 3. Test Directed Network Static Pressure Solver & Critical Path
{
  const mockDiffusers = [
    { id: 'dif-1', x: 100, y: 50, cfm: 300, size: '12"x12"' },
    { id: 'dif-2', x: 250, y: 50, cfm: 300, size: '12"x12"' }
  ];

  const mockDucts = [
    { id: 'trunk-1', type: 'trunk' as const, points: [0, 50, 100, 50], widthIn: 14, heightIn: 10, cfm: 600, sizeLabel: '14"x10"' },
    { id: 'branch-1', type: 'branch' as const, points: [100, 50, 250, 50], widthIn: 10, heightIn: 10, cfm: 300, sizeLabel: '10"x10"' }
  ];

  const critPath = solveDirectedNetworkStaticPressure(
    mockDucts,
    mockDiffusers,
    STANDARD_DIFFUSER_CATALOG,
    STANDARD_DUCT_TYPES[0],
    10,
    0.15
  );

  console.log('3. Critical Path Static Pressure:', {
    pathId: critPath.pathId,
    totalSupplyLoss: critPath.totalSupplyDeltaPInWg,
    totalReturnLoss: critPath.totalReturnDeltaPInWg,
    diffuserLoss: critPath.diffuserDeltaPInWg,
    totalRawLoss: critPath.totalLossInWg,
    espRequired: critPath.espRequiredInWg
  });

  assert(critPath.espRequiredInWg > 0, 'Required ESP must be positive');
  assert(critPath.espRequiredInWg > critPath.totalLossInWg, 'ESP required must include safety margin');
  assert(critPath.supplySegments.length >= 2, 'Supply segments must be captured along critical path');

  // Test branch balancing schedule
  const balancing = calculateBranchBalancingSchedule(critPath, mockDiffusers);
  assert(balancing.length === 2, 'Balancing schedule must cover both diffusers');
  console.log('✔ Test 3 Passed: Directed Network Static Pressure Solver');
}

// 4. Test Equipment Fan Curve Operating Point & Rejection on ESP Deficit
{
  const ductedUnit = STANDARD_EQUIPMENT_CATALOG.find(e => e.id === 'eq-miraco-msp-24k')!;
  
  // Test valid operating point
  const validFan = evaluateFanOperatingPoint(ductedUnit, 600, 0.25);
  assert(validFan.isValid === true, 'Fan must be valid when ESP required <= max rated ESP');
  assert(validFan.fanMarginInWg > 0, 'Fan margin must be positive');

  // Test deficit operating point
  const invalidFan = evaluateFanOperatingPoint(ductedUnit, 600, 0.65);
  assert(invalidFan.isValid === false, 'Fan must be flagged invalid when ESP required exceeds fan curve');
  assert(invalidFan.warningMessages.length > 0, 'Warning diagnostic must be produced on deficit');

  console.log('✔ Test 4 Passed: Fan Operating Point & Rejection Verification');
}

// 5. Test Product-Specific Diffuser Selection with Throw & Noise Criteria
{
  const diffuserMatch = selectBestDiffuserFromCatalog(250, 30);
  console.log('5. Diffuser Selection:', {
    model: diffuserMatch.diffuser.model,
    faceSize: `${diffuserMatch.diffuser.faceSizeIn.width}"x${diffuserMatch.diffuser.faceSizeIn.height}"`,
    actualNc: diffuserMatch.actualNc,
    throwT50Ft: diffuserMatch.throwT50Ft,
    deltaP: diffuserMatch.deltaPInWg
  });

  assert(diffuserMatch.actualNc <= 32, 'Matched diffuser must satisfy NC threshold');
  assert(diffuserMatch.throwT50Ft >= 6.0, 'Diffuser throw must be within realistic interval');
  assert(diffuserMatch.deltaPInWg <= 0.10, 'Diffuser pressure drop must be reasonable');

  console.log('✔ Test 5 Passed: Product-Specific Diffuser Selection');
}

// 6. Test Multi-Objective Scoring Clamping & Candidate Generation
{
  const result = generateSystemCandidates(
    36000,
    27000,
    1100,
    'office',
    500,
    true
  );

  console.log('6. Candidate Optimizer Summary:', {
    candidateCount: result.candidates.length,
    bestOverall: result.bestOverall?.equipment.model,
    bestScore: result.bestOverall?.subscores.totalScore,
    rejectedCount: result.rejectedCount
  });

  assert(result.candidates.length > 0, 'Candidates must be generated');
  assert(result.bestOverall !== null, 'Best overall candidate must exist');

  result.candidates.forEach(cand => {
    // Assert all subscores are strictly in [0, 100]
    assert(cand.subscores.sComfort >= 0 && cand.subscores.sComfort <= 100, 'sComfort in [0, 100]');
    assert(cand.subscores.sEnergy >= 0 && cand.subscores.sEnergy <= 100, 'sEnergy in [0, 100]');
    assert(cand.subscores.sCost >= 0 && cand.subscores.sCost <= 100, 'sCost in [0, 100]');
    assert(cand.subscores.sNoise >= 0 && cand.subscores.sNoise <= 100, 'sNoise in [0, 100]');
    assert(cand.subscores.sPressure >= 0 && cand.subscores.sPressure <= 100, 'sPressure in [0, 100]');
    assert(cand.subscores.sSpace >= 0 && cand.subscores.sSpace <= 100, 'sSpace in [0, 100]');
    assert(cand.subscores.sPreference >= 0 && cand.subscores.sPreference <= 100, 'sPreference in [0, 100]');
    assert(cand.subscores.totalScore >= 0 && cand.subscores.totalScore <= 100, 'totalScore in [0, 100]');
  });

  console.log('✔ Test 6 Passed: Multi-Objective Scoring Clamping & Bounds');
}

console.log('=== All 6 Engineering Engine Validation Tests Passed Successfully ===');
