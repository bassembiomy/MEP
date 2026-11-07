/** R3 — design verification across disciplines: every fire-protection check, HVAC airflow / velocity / NC checks,
 * BIM model integrity and clashes, one report (HTML) ready for submission. */
import { verifyDesigns } from '../verification/designVerification';
import { designFireProtectionSystem } from '../fireProtection/fireProtectionEngine';
import { DEFAULT_FIRE_INPUT } from '../fireProtection/defaults';
import { BimModel } from '../bim/bimTypes';
import { Zone, ProjectMetadata } from '../../store/projectStore';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`Assertion Failed: ${m}`);
}
console.log('=== R3: design verification ===');
const fire = designFireProtectionSystem(DEFAULT_FIRE_INPUT);
const project: ProjectMetadata = { name: 'P', location: 'Cairo', scale: 10, units: 'imperial', outdoorDb: 95, indoorDb: 75 };
const zone = (cfmTrunk: number, vel = 700, nc = 25): Zone => ({
  id: 'z1', name: 'Office', points: [0, 0, 300, 0, 300, 200, 0, 200], spaceTypeId: 'office', ceilingHeight: 10, occupants: 10, maxVelocityLimitFpm: 900, maxSpaceNcLimit: 30,
  diffusers: [{ id: 'SD-1', x: 100, y: 100, cfm: 200, size: '12x12', type: 'supply', actualNc: nc }, { id: 'SD-2', x: 200, y: 100, cfm: 200, size: '12x12', type: 'supply', actualNc: nc }, { id: 'RG-1', x: 150, y: 40, cfm: 400, size: '24x12', type: 'return' }],
  ducts: [{ id: 'T1', type: 'trunk', points: [20, 100, 200, 100], widthIn: 14, heightIn: 10, cfm: cfmTrunk, sizeLabel: '14x10', velocityFpm: vel }, { id: 'R1', type: 'return', points: [20, 40, 150, 40], widthIn: 16, heightIn: 10, cfm: 400, sizeLabel: '16x10', velocityFpm: 400 }]
});
{
  const v = verifyDesigns({ fire, hvac: { zones: [zone(400)], project } });
  const fireItems = v.items.filter((i) => i.discipline === 'Fire Protection');
  assert(fireItems.length >= fire.checks.length, 'every fire check is in the verification');
  for (const c of fire.checks) assert(fireItems.some((i) => i.id === c.id && i.status === c.status), `fire check ${c.id}`);
  const hv = v.items.filter((i) => i.discipline === 'HVAC');
  const st = (id: string): string => hv.find((i) => i.id === id)?.status ?? 'missing';
  assert(st('hvac-airflow:z1') === 'pass', 'supply terminals = trunk CFM');
  assert(st('hvac-return-balance:z1') === 'pass', 'return = supply');
  assert(st('hvac-velocity:z1') === 'pass' && st('hvac-nc:z1') === 'pass', 'velocity & NC');
  assert(v.summary.total === v.items.length && v.summary.pass + v.summary.warn + v.summary.fail === v.summary.total, 'summary');
  assert(v.html.startsWith('<!DOCTYPE html>') && v.html.includes('Design Verification') && v.html.includes('HVAC') && v.html.includes('Fire Protection') && !/\bNaN\b|\bundefined\b/.test(v.html), 'HTML report');
}
{
  const v = verifyDesigns({ hvac: { zones: [zone(300, 1200, 35)], project } });
  const st = (id: string): string => v.items.find((i) => i.id === id)?.status ?? 'missing';
  assert(st('hvac-airflow:z1') === 'fail' && st('hvac-velocity:z1') === 'fail' && st('hvac-nc:z1') === 'fail', 'HVAC failures detected');
}
{
  const bad: BimModel = { projectName: 'P', projectNumber: '1', discipline: 'MEP', storeys: [{ id: 'L1', name: 'L1', elevationMm: 0 }], systems: [{ id: 'S', name: 'S', kind: 'fire-sprinkler', ifcPredefinedType: 'FIREPROTECTION', color: [1, 0, 0] }],
    elements: [
      { key: 'a', tag: 'A', name: 'a', ifcClass: 'IfcPipeSegment', predefinedType: 'RIGIDSEGMENT', storeyId: 'L9', systemId: 'S', geometry: { kind: 'segment', start: [0, 0, 3000], end: [5000, 0, 3000], profile: { shape: 'circle', diameterMm: 60 } }, properties: {} },
      { key: 'b', tag: 'B', name: 'b', ifcClass: 'IfcDuctSegment', predefinedType: 'RIGIDSEGMENT', storeyId: 'L1', systemId: 'S', geometry: { kind: 'segment', start: [2500, -2000, 3000], end: [2500, 2000, 3000], profile: { shape: 'rect', widthMm: 400, heightMm: 300 } }, properties: {} }
    ], warnings: ['pump room placed schematically'] };
  const v = verifyDesigns({ bim: bad });
  const st = (id: string): string => v.items.find((i) => i.id === id)?.status ?? 'missing';
  assert(st('bim-integrity') === 'fail', 'element on an unknown storey → fail');
  assert(st('bim-clashes') === 'fail' && v.items.find((i) => i.id === 'bim-clashes')!.detail.includes('A'), 'clash reported');
  assert(st('bim-placement') === 'warn', 'model warnings surfaced');
}
console.log('✓ verification');
console.log('\nAll design verification tests passed.');
