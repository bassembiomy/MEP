/** C2 — CO2 shop drawings per floor (over the client's DXF underlay), system schematic & details, calculation sheet, HTML report. */
import { designFireProtectionSystem } from '../fireProtection/fireProtectionEngine';
import { DEFAULT_FIRE_INPUT } from '../fireProtection/defaults';
import { importFloorPlanDxf } from '../fireProtection/sprinkler/floorPlanImport';
import { detectRooms } from '../fireProtection/sprinkler/roomDetection';
import { defaultCo2Answers, co2EnclosureFromRoom } from '../fireProtection/co2/nfpa12';
import { generateCo2Drawings } from '../fireProtection/drawing/co2Sheets';
import { buildCo2ReportHtml } from '../fireProtection/co2/co2Report';
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

console.log('=== CO2 C2: shop drawings & report ===');
const dxf = buildSamplePlanDxf({ insunits: 4 });
const plan = importFloorPlanDxf(dxf);
const rooms = detectRooms(plan, ['A-ROOM'], { buildingType: 'office', ceilingHeightM: 3, ceilingType: 'finished-flat' });
const storageRoom = rooms.find((r) => /STORAGE/i.test(r.name))!;
const office = rooms.find((r) => /OFFICE/i.test(r.name))!;
assert(!!storageRoom && !!office, 'sample rooms');
const z1 = { ...co2EnclosureFromRoom(storageRoom, 'Z1'), fireType: 'deep-seated' as const, deepSeated: 'records' as const };
const z2 = { ...co2EnclosureFromRoom(office, 'Z2'), material: 'propane' };
assert(z1.polygon === storageRoom.polygon || JSON.stringify(z1.polygon) === JSON.stringify(storageRoom.polygon), 'polygon copied from the room');
assert(z1.roomId === storageRoom.id && z1.name === storageRoom.name && z1.heightM === storageRoom.ceilingHeightM, 'enclosure defaults from the room');
const result = designFireProtectionSystem({
  ...DEFAULT_FIRE_INPUT,
  co2Design: {
    answers: { ...defaultCo2Answers(), reserve: true },
    floors: [
      { id: 'B1', name: 'Basement', elevationM: -4, planDxf: dxf, planUnits: 'mm', storage: { x: 21000, y: -2000 }, enclosures: [z1, z2] },
      { id: 'GF', name: 'Ground Floor', elevationM: 0, planDxf: dxf, planUnits: 'mm', storage: { x: 21000, y: -2000 }, enclosures: [{ ...z1 }] }
    ]
  }
});
const co2 = result.co2!;
const d = generateCo2Drawings(result);
{
  assert(d.floors.length === 2 && d.floors.map((f) => f.floorId).join() === 'B1,GF', 'one drawing per floor');
  assert(d.floors[0].drawing.sheets.length === 1 && d.floors[0].drawing.sheets[0].number === 'CO-101' && d.floors[1].drawing.sheets[0].number === 'CO-102', 'floor sheet numbers');
  for (const f of d.floors) {
    const fd = co2.floors.find((x) => x.floorId === f.floorId)!;
    const dr = f.drawing;
    contained(dr);
    assert(dr.entities.some((e) => e.layer.startsWith('A-')), `${f.floorId}: architectural underlay on A-* layers`);
    for (const l of ['CO2-ENCL', 'CO2-NOZZLE', 'CO2-PIPE', 'CO2-DEVICE', 'CO2-STORAGE', 'CO2-ANNO']) assert(dr.layers.some((x) => x.name === l), `${f.floorId}: layer ${l}`);
    for (const e of fd.enclosures) {
      for (const n of e.nozzles) assert(texts(dr).some((t) => t.text.includes(n.tag)), `${f.floorId}: nozzle ${n.tag} tagged`);
      assert(has(dr, e.name), `${f.floorId}: enclosure ${e.name}`);
      assert(texts(dr).some((t) => t.text.includes(String(Math.round(e.quantity.totalLb)))), `${f.floorId}: ${e.enclosureId} quantity box`);
    }
    assert(dr.entities.filter((e) => e.layer === 'CO2-NOZZLE' && e.kind !== 'text').length >= fd.enclosures.reduce((s, e) => s + e.nozzles.length, 0), `${f.floorId}: nozzle symbols`);
    assert(dr.entities.filter((e) => e.layer === 'CO2-PIPE' && e.kind !== 'text').length >= fd.pipes.length, `${f.floorId}: pipes`);
    assert(dr.entities.filter((e) => e.layer === 'CO2-DEVICE').length >= fd.devices.length, `${f.floorId}: devices`);
    for (const dv of fd.devices) assert(texts(dr).some((t) => t.text.includes(dv.tag)), `${f.floorId}: device ${dv.tag}`);
    for (const str of ['LEGEND', 'NFPA 12', 'CARBON DIOXIDE', 'LB', 'KG', 'CYLINDER', fd.floorName]) assert(has(dr, str), `${f.floorId}: "${str}"`);
    assert(writeDxf(dr).includes('AC1009'), `${f.floorId}: DXF`);
  }
  const sc = d.schematic;
  assert(sc.sheets[0].number === 'CO-501', 'CO-501');
  contained(sc);
  for (const str of ['SYSTEM SCHEMATIC', 'MANIFOLD', 'CHECK VALVE', 'FLEXIBLE', 'SELECTOR', 'LOCKOUT', 'TIME DELAY', 'PRESSURE SWITCH', 'ODORIZER', 'RESERVE', 'NOZZLE', 'WARNING', 'CARBON DIOXIDE GAS', 'CONTROL PANEL', 'MANUAL RELEASE', 'RELIEF VENT']) assert(has(sc, str), `CO-501 "${str}"`);
  const ca = d.calculations;
  assert(ca.sheets[0].number === 'CO-601', 'CO-601');
  contained(ca);
  for (const e of co2.floors.flatMap((f) => f.enclosures)) for (const r of e.flowRows) assert(texts(ca).some((t) => t.text === r.toNode), `CO-601 node ${r.toNode}`);
  for (const str of ['FLOODING FACTOR', 'MCF', 'DESIGN CONCENTRATION', 'Y', 'Z', 'ORIFICE', 'BILL OF MATERIALS', 'STORAGE']) assert(has(ca, str), `CO-601 "${str}"`);
  assert(d.combined.sheets.map((x) => x.number).join() === 'CO-101,CO-102,CO-501,CO-601', 'combined sheet set');
  contained(d.combined);
  const out = process.env.CO2_OUT;
  if (out) {
    mkdirSync(out, { recursive: true });
    for (const f of d.floors) writeFileSync(`${out}/${f.drawing.sheets[0].number}.dxf`, writeDxf(f.drawing));
    writeFileSync(`${out}/CO-501.dxf`, writeDxf(d.schematic));
    writeFileSync(`${out}/CO-601.dxf`, writeDxf(d.calculations));
    writeFileSync(`${out}/CO-combined.dxf`, writeDxf(d.combined));
  }
  console.log('✓ shop drawings per floor, schematic & details, calculations');
}
{
  const html = buildCo2ReportHtml(result, d);
  assert(html.startsWith('<!DOCTYPE html>') && html.includes('</html>'), 'html document');
  for (const str of ['NFPA 12', 'Design questionnaire', 'Basement', 'Ground Floor', 'Flooding factor', 'Discharge', 'Y/Z', 'Storage', 'Accessories', 'Bill of materials', 'Safety', 'N-B1-Z1-01', 'CO-101', 'CO-601', 'manufacturer']) assert(html.includes(str), `report "${str}"`);
  assert((html.match(/<svg/g) ?? []).length >= 4, 'embedded drawings');
  assert(!/\bNaN\b|\bundefined\b|Infinity/.test(html), 'report clean');
  if (process.env.CO2_OUT) writeFileSync(`${process.env.CO2_OUT}/co2_report.html`, html);
  console.log('✓ HTML report');
}
console.log('\nAll CO2 C2 tests passed.');
