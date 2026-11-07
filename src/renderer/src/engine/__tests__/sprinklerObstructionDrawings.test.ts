/** K9 — obstructions on the floor shop drawing, hydraulic calculation sheets per zone with the N^1.85 graph. */
import { designFireProtectionSystem } from '../fireProtection/fireProtectionEngine';
import { DEFAULT_FIRE_INPUT } from '../fireProtection/defaults';
import { defaultSprinklerAnswers } from '../fireProtection/sprinkler/nfpa13Sprinkler';
import { generateSprinklerDrawings } from '../fireProtection/drawing/sprinklerSheets';
import { buildSprinklerReportHtml } from '../fireProtection/sprinkler/sprinklerReport';
import { writeDxf } from '../fireProtection/drawing/dxfWriter';
import { DrawEntity, Drawing, SheetInfo } from '../fireProtection/drawing/drawingTypes';
import { OFFICE_POLYGON } from './sprinklerSamplePlan';
import { mkdirSync, writeFileSync } from 'fs';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`Assertion Failed: ${m}`);
}
type T = Extract<DrawEntity, { kind: 'text' }>;
const frameOf = (s: SheetInfo) => ({ x0: s.originX, y0: s.originY, x1: s.originX + s.paperWidthMm * s.scale, y1: s.originY + s.paperHeightMm * s.scale });
const sheetTexts = (d: Drawing, num: string): T[] => {
  const f = frameOf(d.sheets.find((s) => s.number === num)!);
  return d.entities.filter((e): e is T => e.kind === 'text' && e.x >= f.x0 && e.x <= f.x1 && e.y >= f.y0 && e.y <= f.y1);
};
const has = (ts: T[], s: string): boolean => ts.some((t) => t.text.toUpperCase().includes(s.toUpperCase()));
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

console.log('=== Sprinkler K9: obstruction drawings & hydraulic sheets ===');
const base = { occupancy: 'office', ceilingHeightM: 3, ceilingType: 'finished-flat' as const, freezing: false, heatSource: false, omit: false, omitReason: '' };
const result = designFireProtectionSystem({
  ...DEFAULT_FIRE_INPUT,
  sprinklerDesign: {
    answers: { ...defaultSprinklerAnswers(), pipeSizing: 'hydraulic', supply: { kind: 'city', staticPsi: 80, residualPsi: 70, residualFlowGpm: 1000 } },
    buildingRiserIn: 6,
    buildingRiserSchedule: 'sch40',
    floors: [{
      id: 'L1', name: 'Level 1', elevationM: 4.5, roomLayers: [], systemType: 'wet', riser: { x: -500, y: 6000 }, branchDirection: 'x',
      zones: [{ id: 'Z1', name: 'Offices', riser: { x: -500, y: 6000 } }, { id: 'Z2', name: 'Store', riser: { x: 31000, y: 3000 } }],
      rooms: [
        { ...base, id: 'R1', name: 'Open Office', polygon: OFFICE_POLYGON, hazard: 'light', zoneId: 'Z1' },
        { ...base, id: 'R2', name: 'Store', polygon: rect(22000, 0, 30000, 6000), hazard: 'ordinary-2', zoneId: 'Z2' }
      ],
      obstructions: [
        { id: 'B1', kind: 'beam', polygon: rect(6300, 0, 6500, 12000), bottomBelowCeilingMm: 400 },
        { id: 'D1', kind: 'duct', polygon: rect(9000, 0, 10500, 12000), bottomBelowCeilingMm: 500 },
        { id: 'C1', kind: 'column', polygon: rect(13800, 9800, 14200, 10200), bottomBelowCeilingMm: 3000 }
      ]
    }]
  }
});
const s = result.sprinklers!;
const f = s.floors[0];
const d = generateSprinklerDrawings(result);
{
  const dr = d.floors[0].drawing;
  assert(dr.layers.some((l) => l.name === 'FS-OBST') && dr.entities.filter((e) => e.layer === 'FS-OBST' && e.kind !== 'text').length >= 3, 'obstructions drawn on FS-OBST');
  const t = sheetTexts(dr, 'FS-101');
  for (const o of f.obstructions) assert(has(t, o.id), `obstruction ${o.id} tagged`);
  for (const s2 of ['BEAM', 'DUCT', 'COLUMN', 'OBSTRUCTION SCHEDULE', 'BEAM RULE', 'THREE-TIMES', 'BELOW', 'RELOCATED', '10.2.7']) assert(has(t, s2), `FS-101 "${s2}"`);
  for (const h of f.heads.filter((x) => x.belowObstruction)) assert(t.some((x) => x.text === h.tag), `below-duct head ${h.tag}`);
  assert(writeDxf(dr).includes('AC1009'), 'DXF');
}
{
  // one hydraulic calculation sheet per floor zone (FS-601 …), each with the node table and the N^1.85 graph
  const hy = d.hydraulics;
  const nums = hy.sheets.map((x) => x.number);
  assert(nums.join() === 'FS-601,FS-602', `hydraulic sheets ${nums}`);
  for (const [i, z] of f.zones.entries()) {
    const t = sheetTexts(hy, nums[i]);
    assert(has(t, `ZONE ${z.zoneId}`) && has(t, 'N^1.85') && has(t, 'SUPPLY') && has(t, 'DEMAND'), `${nums[i]} zone ${z.zoneId} graph`);
    for (const r of z.governing!.rows) assert(t.some((x) => x.text === r.fromNode), `${nums[i]} node ${r.fromNode}`);
    for (const col of ['K', 'Q', 'PF', 'PE', 'PT', 'C', 'EQ', 'V']) assert(t.some((x) => x.text.toUpperCase() === col || x.text.toUpperCase().startsWith(col + ' ')), `${nums[i]} column ${col}`);
  }
  const gov = sheetTexts(hy, nums[f.zones.findIndex((z) => z.governing === f.governing)]);
  assert(has(gov, 'GOVERNING'), 'governing zone marked');
  const out = process.env.SPK_OUT;
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}/FS-101-obst.dxf`, writeDxf(d.floors[0].drawing));
    writeFileSync(`${out}/FS-60x.dxf`, writeDxf(hy));
  }
}
{
  const html = buildSprinklerReportHtml(result, d);
  for (const str of ['Obstruction', 'beam rule', 'three-times', 'below', 'N^1.85', 'Zone Z2', 'Pipe sizing']) assert(html.toLowerCase().includes(str.toLowerCase()), `report "${str}"`);
  assert(!/\bNaN\b|\bundefined\b/.test(html), 'report clean');
}
console.log('✓ obstruction drawings, per-zone hydraulic sheets, report');
console.log('\nAll sprinkler K9 tests passed.');
