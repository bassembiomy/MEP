/** K4/K5 — sprinkler shop drawings per floor (over the client's DXF underlay), riser/details & hydraulic sheets, HTML report. */
import { designFireProtectionSystem } from '../fireProtection/fireProtectionEngine';
import { DEFAULT_FIRE_INPUT } from '../fireProtection/defaults';
import { importFloorPlanDxf } from '../fireProtection/sprinkler/floorPlanImport';
import { detectRooms } from '../fireProtection/sprinkler/roomDetection';
import { defaultSprinklerAnswers } from '../fireProtection/sprinkler/nfpa13Sprinkler';
import { generateSprinklerDrawings } from '../fireProtection/drawing/sprinklerSheets';
import { buildSprinklerReportHtml } from '../fireProtection/sprinkler/sprinklerReport';
import { writeDxf } from '../fireProtection/drawing/dxfWriter';
import { DrawEntity, Drawing } from '../fireProtection/drawing/drawingTypes';
import { buildSamplePlanDxf } from './sprinklerSamplePlan';
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

console.log('=== Sprinkler K4/K5: shop drawings & report ===');
const dxf = buildSamplePlanDxf({ insunits: 4 });
const plan = importFloorPlanDxf(dxf);
const rooms = detectRooms(plan, ['A-ROOM'], { buildingType: 'office', ceilingHeightM: 3, ceilingType: 'finished-flat' });
const floor = (id: string, name: string, el: number, systemType: 'wet' | 'dry') => ({
  id, name, elevationM: el, planDxf: dxf, planUnits: 'mm' as const, roomLayers: ['A-ROOM'], rooms, systemType,
  riser: { x: -500, y: 6000 }, branchDirection: 'auto' as const
});
const result = designFireProtectionSystem({
  ...DEFAULT_FIRE_INPUT,
  sprinklerDesign: { answers: defaultSprinklerAnswers(), buildingRiserIn: 6, buildingRiserSchedule: 'sch40', floors: [floor('GF', 'Ground Floor', 0, 'dry'), floor('L1', 'Level 1', 4.5, 'wet')] }
});
const s = result.sprinklers!;
const d = generateSprinklerDrawings(result);
{
  assert(d.floors.length === 2 && d.floors.map((f) => f.floorId).join() === 'GF,L1', 'one drawing per floor');
  assert(d.floors[0].drawing.sheets.length === 1 && d.floors[0].drawing.sheets[0].number === 'FS-101' && d.floors[1].drawing.sheets[0].number === 'FS-102', 'floor sheet numbers');
  for (const f of d.floors) {
    const fd = s.floors.find((x) => x.floorId === f.floorId)!;
    const dr = f.drawing;
    contained(dr);
    assert(dr.entities.some((e) => e.layer.startsWith('A-')), `${f.floorId}: architectural underlay on A-* layers`);
    assert(dr.layers.some((l) => l.name === 'A-ROOM') && dr.layers.some((l) => l.name === 'FS-HEAD'), `${f.floorId}: layers`);
    for (const h of fd.heads) assert(texts(dr).some((t) => t.text === h.tag), `${f.floorId}: head ${h.tag} tagged`);
    assert(dr.entities.filter((e) => e.layer === 'FS-HEAD').length >= fd.heads.length, `${f.floorId}: head symbols`);
    for (const p of fd.pipes.filter((x) => x.kind !== 'riser-nipple')) assert(dr.entities.some((e) => (e.layer === 'FS-PIPE-BRANCH' || e.layer === 'FS-PIPE-MAIN') && e.kind !== 'text'), `${f.floorId}: pipe ${p.id}`);
    const sizes = [...new Set(fd.pipes.map((p) => p.sizeIn))];
    assert(sizes.every((z) => texts(dr).some((t) => t.text.includes(z === 1 ? '1"' : z === 1.25 ? '1¼' : z === 1.5 ? '1½' : z === 2.5 ? '2½' : `${z}"`))), `${f.floorId}: pipe size labels`);
    assert(dr.entities.some((e) => e.layer === 'FS-REMOTE'), `${f.floorId}: remote area`);
    assert(dr.entities.filter((e) => e.layer === 'FS-HANG').length >= fd.hangers.length, `${f.floorId}: hangers`);
    for (const str of ['LEGEND', 'NFPA 13', 'FLOOR CONTROL', "INSPECTOR", 'REMOTE', 'GPM', 'PSI', fd.floorName]) assert(has(dr, str), `${f.floorId}: "${str}"`);
    for (const r of fd.rooms) assert(has(dr, r.name), `${f.floorId}: room ${r.name}`);
    assert(writeDxf(dr).includes('AC1009'), `${f.floorId}: DXF`);
  }
  assert(has(d.floors[0].drawing, 'SLOPE') && has(d.floors[0].drawing, 'DRY'), 'dry floor: slope notes');
  const rd = d.riserAndDetails;
  assert(rd.sheets[0].number === 'FS-501', 'FS-501');
  contained(rd);
  for (const str of ['RISER DIAGRAM', 'ALARM CHECK', 'DRY-PIPE VALVE', 'ACCELERATOR', 'FIRE DEPARTMENT CONNECTION', 'MAIN DRAIN', 'FLOOR CONTROL', 'DEFLECTOR', 'HANGER', 'SPARE']) assert(has(rd, str), `FS-501 "${str}"`);
  const hy = d.hydraulics;
  assert(hy.sheets[0].number === 'FS-601', 'FS-601');
  contained(hy);
  for (const r of s.governing!.rows) assert(texts(hy).some((t) => t.text === r.fromNode), `FS-601 node ${r.fromNode}`);
  for (const str of ['SUPPLY', 'DEMAND', 'BILL OF MATERIALS']) assert(has(hy, str), `FS-601 "${str}"`);
  assert(d.combined.sheets.map((x) => x.number).join() === 'FS-101,FS-102,FS-501,FS-601', 'combined sheet set');
  contained(d.combined);
  const out = process.env.SPK_OUT;
  if (out) {
    mkdirSync(out, { recursive: true });
    for (const f of d.floors) writeFileSync(`${out}/${f.drawing.sheets[0].number}.dxf`, writeDxf(f.drawing));
    writeFileSync(`${out}/FS-combined.dxf`, writeDxf(d.combined));
  }
  console.log('✓ shop drawings per floor, riser/details, hydraulics');
}
{
  const html = buildSprinklerReportHtml(result, d);
  assert(html.startsWith('<!DOCTYPE html>') && html.includes('</html>'), 'html document');
  for (const str of ['NFPA 13', 'Design questionnaire', 'Ground Floor', 'Level 1', 'Remote area', 'Accessories', 'Bill of materials', 'Spare', 'S-L1-001', 'FS-101', 'FS-601']) assert(html.includes(str), `report "${str}"`);
  assert((html.match(/<svg/g) ?? []).length >= 4, 'embedded drawings');
  assert(!/\bNaN\b|\bundefined\b/.test(html), 'report clean');
  if (process.env.SPK_OUT) writeFileSync(`${process.env.SPK_OUT}/sprinkler_report.html`, html);
  console.log('✓ HTML report');
}
console.log('\nAll sprinkler K4/K5 tests passed.');
