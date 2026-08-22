import { executeAirDistributionDesign, convertDesignResultToZonePayload } from '../airDistributionEngine';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running CAD Air Distribution Sync Tests ===');

const roomPolygon = [0, 0, 50, 0, 50, 30, 0, 30];
const design = executeAirDistributionDesign({
  roomName: 'Main Conference Room',
  roomPolygon,
  roomAreaSqFt: 1500,
  sensibleLoadBtu: 120000,
  totalLoadBtu: 141000,
  requiredCfm: 4000,
  occupancyCount: 50,
  systemType: 'concealed'
});

const payload = convertDesignResultToZonePayload(design);

// 1. Diffusers & Return Grilles check
assert(payload.diffusers && payload.diffusers.length > 0, 'Payload must contain diffusers');
const supplyDiffusers = payload.diffusers.filter((d) => d.type === 'supply');
const returnGrilles = payload.diffusers.filter((d) => d.type === 'return');
assert(supplyDiffusers.length > 0, 'Must contain supply diffusers');
assert(returnGrilles.length > 0, 'Must contain return grilles');
assert(supplyDiffusers[0].cfm > 0, 'Supply diffuser must have CFM > 0');
assert(Boolean(supplyDiffusers[0].size), 'Supply diffuser must have size');

// 2. Ducts check
assert(payload.ducts && payload.ducts.length > 0, 'Payload must contain ducts');
assert(payload.ducts[0].widthIn > 0, 'Duct width must be > 0');
assert(payload.ducts[0].heightIn > 0, 'Duct height must be > 0');
assert(payload.ducts[0].cfm > 0, 'Duct CFM must be > 0');
assert(payload.ducts[0].sizeLabel.includes('x'), 'Duct size label must contain dimensions');

// 3. Equipment position & tags check
assert(Boolean(payload.unitPos), 'Payload must have unitPos');
assert(payload.catalogModel === design.selectedOption.unitModel, 'Payload must match catalogModel');
assert(payload.catalogQty === design.selectedOption.unitCount, 'Payload must match catalogQty');
assert(Boolean(payload.catalogEsp), 'Payload must match catalogEsp');

console.log('PASS: All CAD Air Distribution Sync Tests Passed.');
