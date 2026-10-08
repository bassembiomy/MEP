import {
  validateAndParseAiHvacResponse,
  calculateEquivalentDiameterInches,
  calculateDuctVelocityFpm
} from '../ai/aiHvacResponseParser';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running AI HVAC Response Parser Tests ===');

// 1. Equivalent Diameter (Huebscher formula)
// For 12" x 12" square duct, equivalent diameter should be approx 13.1"
const de = calculateEquivalentDiameterInches(12, 12);
assert(de >= 12.5 && de <= 13.5, `12x12 eq diameter should be ~13.1, got ${de}`);

// 2. Velocity Calculation
// 400 CFM through 12" x 12" duct (1.0 sq ft) => 400 FPM
const vel = calculateDuctVelocityFpm(400, 'rectangular', 12, 12);
assert(vel === 400, `Velocity should be 400 FPM, got ${vel}`);

// 1000 CFM through 20" x 10" duct (1.388 sq ft) => ~720 FPM
const vel2 = calculateDuctVelocityFpm(1000, 'rectangular', 20, 10);
assert(vel2 >= 710 && vel2 <= 730, `Velocity should be ~720 FPM, got ${vel2}`);

// 3. JSON Extraction from Markdown
const markdownAiOutput = `
Here is the engineering design for your zone:

\`\`\`json
{
  "systemSummary": {
    "selectedAcuModel": "Carrier 42QSS048-D",
    "totalCfm": 1600,
    "totalBtuPerHour": 48000,
    "estimatedTotalStaticPressureInWg": 0.38
  },
  "acuPlacement": {
    "x": 20,
    "y": 5,
    "serviceClearanceOk": true
  },
  "diffuserLayout": [
    {
      "id": "diff-1",
      "x": 10,
      "y": 12,
      "modelId": "Titus TMS-08",
      "size": "24x24",
      "cfm": 400,
      "coverageRadiusFt": 9,
      "throwDistanceFt": 11,
      "ncLevel": 22
    },
    {
      "id": "diff-2",
      "x": 30,
      "y": 12,
      "modelId": "Titus TMS-08",
      "size": "24x24",
      "cfm": 400,
      "coverageRadiusFt": 9,
      "throwDistanceFt": 11,
      "ncLevel": 22
    }
  ],
  "ductNetwork": [
    {
      "id": "trunk-1",
      "type": "trunk",
      "startX": 20,
      "startY": 5,
      "endX": 20,
      "endY": 12,
      "shape": "rectangular",
      "widthIn": 22,
      "heightIn": 10,
      "cfm": 1600,
      "velocityFpm": 1047,
      "frictionRateInWgPer100Ft": 0.08
    }
  ],
  "compliance": {
    "score": 96,
    "ashrae621VentilationCompliant": true,
    "ashrae55DraftCompliant": true,
    "maxVelocityCompliant": true,
    "aspectRatioCompliant": true
  },
  "warnings": []
}
\`\`\`
`;

const parsed = validateAndParseAiHvacResponse(markdownAiOutput);
assert(parsed.success, 'Parser must succeed on valid markdown-wrapped JSON');
assert(parsed.diffusers.length === 2, 'Must parse 2 diffusers');
assert(parsed.diffusers[0].cfm === 400, 'Diffuser CFM must be 400');
assert(parsed.ducts.length === 1, 'Must parse 1 duct');
assert(parsed.catalogModel === 'Carrier 42QSS048-D', 'Must match catalog model');
assert(parsed.unitPos?.x === 20 && parsed.unitPos?.y === 5, 'Must parse unit position');
assert(parsed.complianceScore >= 90, 'Compliance score should be >= 90');

console.log('PASS: All AI HVAC Response Parser Tests Passed Successfully.');
