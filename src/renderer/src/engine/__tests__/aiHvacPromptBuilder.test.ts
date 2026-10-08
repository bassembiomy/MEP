import { buildAiHvacPrompt, sliceEquipmentCatalogForZone, sliceDiffuserCatalogForZone, calculatePolygonArea } from '../ai/aiHvacPromptBuilder';
import { Zone } from '../../store/projectStore';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running AI HVAC Prompt Builder Tests ===');

// 1. Polygon Area
const rectPoints = [0, 0, 40, 0, 40, 25, 0, 25];
const area = calculatePolygonArea(rectPoints);
assert(area === 1000, `Area of 40x25 should be 1000, got ${area}`);

// 2. Catalog Slicing
const acuSlice = sliceEquipmentCatalogForZone(1600, 48000, 'concealed');
assert(acuSlice.length > 0, 'Must return ACU units');
assert(acuSlice[0].totalCapacityBtu > 0, 'ACU must have valid capacity');

const diffuserSlice = sliceDiffuserCatalogForZone(1600);
assert(diffuserSlice.length > 0, 'Must return diffuser models');
assert(diffuserSlice[0].performance.length > 0, 'Diffuser must have performance points');

// 3. Complete Prompt Building
const testZone: Zone = {
  id: 'zone-101',
  name: 'Executive Boardroom',
  points: rectPoints,
  spaceTypeId: 'office-conference',
  ceilingHeight: 10,
  occupants: 20,
  diffusers: [],
  ducts: [],
  manualCoolingOverride: 48000,
  manualCfmOverride: 1600
};

const payload = buildAiHvacPrompt({
  zone: testZone,
  plenumHeightIn: 18,
  designFrictionRateInWgPer100Ft: 0.08
});

assert(payload.systemPrompt.includes('Expert HVAC Design AI'), 'System prompt must contain role');
assert(payload.systemPrompt.includes('Equal Friction Method'), 'System prompt must mandate Equal Friction');
assert(payload.systemPrompt.includes('Phase 1: Spatial Distribution'), 'System prompt must contain Phase 1');
assert(payload.userPrompt.includes('Executive Boardroom'), 'User prompt must name the zone');
assert(payload.userPrompt.includes('1,600 CFM'), 'User prompt must include CFM');
assert(payload.zoneMetrics.areaSqFt === 1000, 'Zone metrics area must be 1000');

console.log('PASS: All AI HVAC Prompt Builder Tests Passed Successfully.');
