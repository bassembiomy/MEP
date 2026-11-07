/** R2 — HVAC shop drawings (DXF / DWG): duct layout plan (double-line ducts with sizes & CFM, diffusers / grilles
 * tagged, equipment), schedules sheet; same AutoCAD R12 kernel as the fire drawings. */
import { generateHvacDrawings } from '../hvacDrawing/hvacSheets';
import { writeDxf } from '../fireProtection/drawing/dxfWriter';
import { DrawEntity, Drawing } from '../fireProtection/drawing/drawingTypes';
import { Zone, ProjectMetadata } from '../../store/projectStore';
import { mkdirSync, writeFileSync } from 'fs';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`Assertion Failed: ${m}`);
}
type T = Extract<DrawEntity, { kind: 'text' }>;
const texts = (d: Drawing): T[] => d.entities.filter((e): e is T => e.kind === 'text');
const has = (d: Drawing, s: string): boolean => texts(d).some((t) => t.text.toUpperCase().includes(s.toUpperCase()));
function contained(d: Drawing): void {
  const fr = d.sheets.map((s) => ({ x0: s.originX, y0: s.originY, x1: s.originX + s.paperWidthMm * s.scale, y1: s.originY + s.paperHeightMm * s.scale }));
  for (const e of d.entities) {
    const pts: [number, number][] = e.kind === 'line' ? [[e.x1, e.y1], [e.x2, e.y2]] : e.kind === 'circle' || e.kind === 'arc' ? [[e.cx - e.r, e.cy - e.r], [e.cx + e.r, e.cy + e.r]] : e.kind === 'text' ? [[e.x, e.y]] : e.points;
    assert(fr.some((f) => pts.every(([x, y]) => x >= f.x0 - 1 && x <= f.x1 + 1 && y >= f.y0 - 1 && y <= f.y1 + 1)), `entity inside a frame: ${JSON.stringify(e).slice(0, 120)}`);
  }
}

console.log('=== R2: HVAC shop drawings ===');
const project: ProjectMetadata = { name: 'Office Fit-out', location: 'Cairo, Egypt', scale: 10, units: 'imperial', outdoorDb: 95, indoorDb: 75 };
const zones: Zone[] = [
  { id: 'z1', name: 'Open Office', points: [0, 0, 400, 0, 400, 250, 0, 250], spaceTypeId: 'office', ceilingHeight: 10, occupants: 20, systemType: 'concealed', catalogModel: 'FCU-1200', catalogQty: 1, catalogEsp: '0.5 in.wg',
    diffusers: [{ id: 'SD-1', x: 100, y: 125, cfm: 300, size: '12x12', type: 'supply', actualNc: 25 }, { id: 'SD-2', x: 200, y: 125, cfm: 300, size: '12x12', type: 'supply', actualNc: 25 }, { id: 'SD-3', x: 300, y: 125, cfm: 300, size: '12x12', type: 'supply', actualNc: 25 }, { id: 'RG-1', x: 200, y: 40, cfm: 900, size: '24x12', type: 'return' }],
    ducts: [
      { id: 'T1', type: 'trunk', points: [30, 125, 100, 125], widthIn: 20, heightIn: 10, cfm: 900, sizeLabel: '20x10' },
      { id: 'T2', type: 'trunk', points: [100, 125, 200, 125], widthIn: 16, heightIn: 10, cfm: 600, sizeLabel: '16x10' },
      { id: 'T3', type: 'trunk', points: [200, 125, 300, 125], widthIn: 10, heightIn: 10, cfm: 300, sizeLabel: '10x10' },
      { id: 'R1', type: 'return', points: [30, 40, 200, 40], widthIn: 22, heightIn: 12, cfm: 900, sizeLabel: '22x12' }
    ],
    unitPositions: [{ x: 30, y: 125 }], outdoorUnitPositions: [{ x: -60, y: 0 }] },
  { id: 'z2', name: 'Meeting', points: [400, 0, 600, 0, 600, 250, 400, 250], spaceTypeId: 'conference', ceilingHeight: 10, occupants: 12, systemType: 'high-wall', catalogModel: 'HW-24', catalogQty: 2, diffusers: [], ducts: [], unitPositions: [{ x: 500, y: 240 }, { x: 560, y: 240 }] }
];
const d = generateHvacDrawings({ zones, project, projectNumber: 'P-01', designer: 'MEP Designer' });
{
  const plan = d.plan;
  assert(plan.sheets[0].number === 'M-101', 'M-101 plan');
  contained(plan);
  for (const l of ['M-DUCT-SUPP', 'M-DUCT-RETN', 'M-HVAC-DIFF', 'M-HVAC-EQPM', 'M-ANNO']) assert(plan.layers.some((x) => x.name === l), `layer ${l}`);
  assert(plan.entities.filter((e) => e.layer === 'M-DUCT-SUPP' && e.kind !== 'text').length >= 2 * 3, 'double-line supply ducts');
  for (const z of zones) {
    assert(has(plan, z.name), `zone ${z.name}`);
    for (const t of z.diffusers) assert(has(plan, t.id) && texts(plan).some((x) => x.text.includes(String(t.cfm))), `terminal ${t.id} tag & CFM`);
    for (const s of z.ducts) assert(has(plan, s.sizeLabel), `duct size ${s.sizeLabel}`);
  }
  for (const s of ['LEGEND', 'ASHRAE', 'SMACNA', 'CFM', 'FCU-1200', 'HW-24', 'SCALE', project.name]) assert(has(plan, s), `M-101 "${s}"`);
  assert(writeDxf(plan).includes('AC1009'), 'DXF');
}
{
  const sch = d.schedules;
  assert(sch.sheets[0].number === 'M-601', 'M-601');
  contained(sch);
  for (const s of ['DIFFUSER', 'GRILLE', 'DUCT SCHEDULE', 'EQUIPMENT SCHEDULE', 'ZONE', 'VELOCITY', 'FPM', 'NC']) assert(has(sch, s), `M-601 "${s}"`);
  for (const z of zones) for (const t of z.diffusers) assert(texts(sch).some((x) => x.text === t.id), `schedule row ${t.id}`);
  assert(d.combined.sheets.map((s) => s.number).join() === 'M-101,M-601', 'combined');
  if (process.env.HVAC_OUT) {
    mkdirSync(process.env.HVAC_OUT, { recursive: true });
    writeFileSync(`${process.env.HVAC_OUT}/M-101.dxf`, writeDxf(d.plan));
    writeFileSync(`${process.env.HVAC_OUT}/M-601.dxf`, writeDxf(d.schedules));
  }
}
console.log('✓ HVAC plan & schedules');
console.log('\nAll HVAC shop drawing tests passed.');
