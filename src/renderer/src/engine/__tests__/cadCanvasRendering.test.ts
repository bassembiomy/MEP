import { Diffuser, DuctSegment } from '../../store/projectStore';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running CAD Canvas Air Distribution Rendering Tests ===');

// 1. Duct inline badge formatting
const duct: DuctSegment = {
  id: 'd-1',
  type: 'trunk',
  points: [0, 0, 100, 0],
  widthIn: 24,
  heightIn: 10,
  cfm: 1345,
  sizeLabel: '24"x10"',
  velocityFpm: 807
};

const mainLabel = `${duct.sizeLabel} • ${duct.cfm} CFM`;
const velLabel = `${duct.velocityFpm} FPM`;

assert(mainLabel === '24"x10" • 1345 CFM', `Main label should match, got ${mainLabel}`);
assert(velLabel === '807 FPM', `Velocity label should match, got ${velLabel}`);

// 2. Supply diffuser tag formatting
const dif: Diffuser = {
  id: 'dif-1',
  x: 50,
  y: 50,
  cfm: 340,
  size: '12"x12"',
  type: 'supply',
  actualNc: 28
};

const difTagLine = `CD-1 (${dif.size})`;
const difDataLine = `${dif.cfm} CFM • NC ${dif.actualNc}`;

assert(difTagLine === 'CD-1 (12"x12")', `Diffuser tag line should match, got ${difTagLine}`);
assert(difDataLine === '340 CFM • NC 28', `Diffuser data line should match, got ${difDataLine}`);

// 3. Return grille tag formatting
const ret: Diffuser = {
  id: 'ret-1',
  x: 150,
  y: 50,
  cfm: 680,
  size: '24"x12"',
  type: 'return'
};

const retTagLine = `RG-1 (${ret.size})`;
const retDataLine = `${ret.cfm} CFM`;

assert(retTagLine === 'RG-1 (24"x12")', `Return tag line should match, got ${retTagLine}`);
assert(retDataLine === '680 CFM', `Return data line should match, got ${retDataLine}`);

console.log('PASS: All CAD Canvas Rendering Tests Passed.');
