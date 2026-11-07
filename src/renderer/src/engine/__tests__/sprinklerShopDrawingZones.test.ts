/** K7 — per-floor sprinkler shop drawings with designer zones / sprinkler types: zone boundaries, zone control valves,
 * dimensions, sidewall symbols, reducers, hanger tags, zone & head schedules (DXF per floor). */
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

console.log('=== Sprinkler K7: zoned shop drawings ===');
const dxf = buildSamplePlanDxf({ insunits: 4 });
const rooms = detectRooms(importFloorPlanDxf(dxf), ['A-ROOM'], { buildingType: 'office', ceilingHeightM: 3, ceilingType: 'finished-flat' });
const office = rooms.find((r) => /OFFICE/i.test(r.name))!;
const storage = rooms.find((r) => /STORAGE/i.test(r.name))!;
const corridor = rooms.find((r) => r !== office && r !== storage)!;
const drawn = { ...corridor, id: 'D1', name: 'Drawn Lobby', polygon: [[0, 12500], [10000, 12500], [10000, 14500], [0, 14500]] as [number, number][], source: 'drawn' as const, zoneId: 'Z1', headSpec: { kFactor: 5.6 as const, orientation: 'sidewall' as const, response: 'quick' as const, tempRatingF: 155 as const } };
const result = designFireProtectionSystem({
  ...DEFAULT_FIRE_INPUT,
  sprinklerDesign: {
    answers: { ...defaultSprinklerAnswers(), pipeSizing: 'hydraulic', supply: { kind: 'city', staticPsi: 80, residualPsi: 70, residualFlowGpm: 1000 } },
    buildingRiserIn: 6,
    buildingRiserSchedule: 'sch40',
    floors: [{
      id: 'L1', name: 'Level 1', elevationM: 4.5, planDxf: dxf, planUnits: 'mm', roomLayers: ['A-ROOM'], systemType: 'wet', riser: { x: -500, y: 6000 }, branchDirection: 'x',
      zones: [{ id: 'Z1', name: 'Offices', riser: { x: -500, y: 6000 } }, { id: 'Z2', name: 'Storage', riser: { x: 31000, y: 3000 } }],
      rooms: [
        { ...office, zoneId: 'Z1', headSpec: { kFactor: 8, orientation: 'concealed-pendent', response: 'quick', tempRatingF: 155 } },
        { ...storage, zoneId: 'Z2', hazard: 'ordinary-2' },
        drawn
      ]
    }]
  }
});
const s = result.sprinklers!;
const f = s.floors[0];
const d = generateSprinklerDrawings(result);
const dr = d.floors[0].drawing;
{
  assert(dr.sheets[0].number === 'FS-101', 'FS-101');
  for (const z of f.zones) {
    assert(has(dr, z.controlValveTag), `zone control valve ${z.controlValveTag} tagged`);
    assert(has(dr, `ZONE ${z.zoneId}`) && has(dr, z.name), `zone ${z.zoneId} labelled`);
  }
  assert(dr.layers.some((l) => l.name === 'FS-ZONE') && dr.entities.some((e) => e.layer === 'FS-ZONE' && e.kind !== 'text'), 'zone boundaries on FS-ZONE');
  assert(dr.layers.some((l) => l.name === 'FS-DIMS') && dr.entities.filter((e) => e.layer === 'FS-DIMS').length >= 3 * f.rooms.length, 'head-to-wall & spacing dimensions per area on FS-DIMS');
  for (const r of f.rooms) assert(has(dr, r.name), `area ${r.name} labelled`);
  for (const t of s.headTypes) assert(has(dr, t.id), `head type ${t.id} in the head schedule / legend`);
  assert(has(dr, 'SIDEWALL') && has(dr, 'CONCEALED'), 'sidewall & concealed sprinkler types named');
  assert(has(dr, 'ZONE SCHEDULE') && has(dr, '52,000') , 'zone schedule with the NFPA 13 §4.4 limit');
  assert(has(dr, 'HYDRAULIC') && has(dr, 'REDUCER'), 'sizing method & reducers noted');
  const hangers = f.hangers.length;
  assert(dr.entities.filter((e) => e.layer === 'FS-HANG').length >= hangers, 'hangers');
  for (const h of f.heads) assert(texts(dr).some((t) => t.text === h.tag), `head ${h.tag}`);
  assert(writeDxf(dr).includes('AC1009'), 'DXF');
  const out = process.env.SPK_OUT;
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}/FS-101-zones.dxf`, writeDxf(dr));
  }
  console.log('✓ zoned floor shop drawing');
}
{
  const html = buildSprinklerReportHtml(result, d);
  for (const str of ['Zone', 'ZCV-L1-Z1', 'ZCV-L1-Z2', 'sidewall', 'Hydraulic', 'Drawn Lobby']) assert(html.toLowerCase().includes(str.toLowerCase()), `report "${str}"`);
  assert(!/\bNaN\b|\bundefined\b/.test(html), 'report clean');
  console.log('✓ report');
}
console.log('\nAll sprinkler K7 tests passed.');
