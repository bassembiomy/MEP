import type { Zone } from '../../store/projectStore';
import { buildSections, sectionCutLines, levelLabel, sectionLevels } from '../sections/sectionBuilder';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(m);
}
const near = (a: number, b: number, e = 1e-3): boolean => Math.abs(a - b) < e;

const mkZone = (): Zone =>
  ({
    id: 'z1', name: 'Room', points: [0, 0, 400, 0, 400, 250, 0, 250], spaceTypeId: 'office', ceilingHeight: 9, occupants: 5,
    unitPos: { x: 50, y: 125 },
    diffusers: [{ id: 'd1', x: 200, y: 125, cfm: 200, size: '12x12', type: 'supply' }],
    ducts: [
      { id: 't1', type: 'trunk', points: [60, 125, 350, 125], widthIn: 12, heightIn: 8, cfm: 800, sizeLabel: '12x8' },
      { id: 'x1', type: 'return', points: [200, 20, 200, 230], widthIn: 10, heightIn: 6, cfm: 400, sizeLabel: '10x6', crossover: true, crossoverWith: ['t1'] }
    ]
  }) as unknown as Zone;

console.log('=== Running Section Builder Test ===');
const opts = { scale: 10, units: 'imperial' };
let secs = buildSections(mkZone(), opts);
const lg = secs.find((s) => s.kind === 'longitudinal')!;
assert(!!lg && secs.some((s) => s.kind === 'transverse'), 'longitudinal + transverse');
assert(near(lg.levels.ceiling, 9) && near(lg.levels.slabUnderside, 9 + 14 / 12) && near(lg.levels.slabTop, 9 + 20 / 12), 'levels');
const trunk = lg.elements.find((e) => e.id === 't1')!;
assert(near(trunk.z1, lg.levels.slabUnderside - 2 / 12) && near(trunk.z1 - trunk.z0, 8 / 12), 'trunk top/height');
assert(trunk.z0 >= lg.levels.ceiling && trunk.z1 <= lg.levels.slabUnderside, 'trunk within void');
const cross = lg.elements.find((e) => e.id === 'x1')!;
assert(!!cross && cross.cut === true && cross.z1 < trunk.z0, 'crossing duct cut below trunk');
assert(lg.elements.some((e) => e.type === 'neck' && e.id === 'd1'), 'neck to ceiling');
assert(lg.elements.some((e) => e.type === 'unit'), 'unit body');
assert(!lg.issues.some((i) => i.severity === 'error' && i.ductId === 't1'), 'no error on 14in void for trunk');

secs = buildSections(mkZone(), { ...opts, voidDepthIn: 8 });
const lg8 = secs.find((s) => s.kind === 'longitudinal')!;
assert(lg8.issues.some((i) => i.severity === 'error' && i.kind === 'ceiling' && i.ductId === 't1'), 'void 8 clash');
const z2 = mkZone();
(z2.ducts[0] as unknown as { bodIn: number }).bodIn = 9 * 12 + 4; // forced high
const s2 = buildSections(z2, { ...opts, voidDepthIn: 10 }).find((s) => s.kind === 'longitudinal')!;
assert(s2.issues.some((i) => i.kind === 'slab'), 'slab clash');

assert(levelLabel('FFL', 0, 'metric') === 'FFL ±0.00', 'ffl metric');
assert(levelLabel('CEILING', 9, 'metric') === 'CEILING +2.74', 'ceiling metric');
assert(levelLabel('CEILING', 9, 'imperial') === "CEILING +9'-0\"", 'ceiling imperial');
assert(sectionLevels(3, 300 / 25.4).ceiling === 3, 'levels fn');
const mz = mkZone();
mz.ceilingHeight = 3;
const m = buildSections(mz, { scale: 3, units: 'metric' })[0];
assert(near(m.levels.ceiling, 3 * 3.28084, 1e-3), 'metric ceiling to ft');

const cuts = sectionCutLines(mkZone());
assert(cuts.length === 2 && cuts[0].label === 'A-A' && cuts[1].label === 'B-B', 'labels');
assert(near(cuts[0].a.x, 60) && near(cuts[0].b.x, 350) && near(cuts[0].a.y, 125), 'longitudinal endpoints along trunk');
assert(near(cuts[1].a.x, 50) && near(cuts[1].b.x, 50) && near(cuts[1].a.y, 0) && near(cuts[1].b.y, 250), 'transverse endpoints');
console.log('Section builder: PASS');
