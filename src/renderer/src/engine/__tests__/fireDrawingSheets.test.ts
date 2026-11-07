/**
 * Acceptance tests — 5-sheet fire pump room / tank drawing set (FP-101 … FP-105).
 * Verifies sheet framing, containment, layer usage, mandatory annotations and DXF export.
 */
import { designFireProtectionSystem } from '../fireProtection/fireProtectionEngine';
import { DEFAULT_FIRE_INPUT } from '../fireProtection/defaults';
import { generateFireDrawings } from '../fireProtection/drawing/sheets';
import { writeDxf } from '../fireProtection/drawing/dxfWriter';
import { renderSvg } from '../fireProtection/drawing/svgRenderer';
import { DrawEntity, SheetInfo } from '../fireProtection/drawing/drawingTypes';
import { writeFileSync, mkdirSync } from 'fs';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion Failed: ${message}`);
}

function entityPoints(e: DrawEntity): [number, number][] {
  switch (e.kind) {
    case 'line': return [[e.x1, e.y1], [e.x2, e.y2]];
    case 'polyline': case 'solid': return e.points;
    case 'circle': case 'arc': return [[e.cx - e.r, e.cy - e.r], [e.cx + e.r, e.cy + e.r]];
    case 'text': {
      const w = e.height * 0.6 * e.text.length;
      return [[e.x - w, e.y - e.height], [e.x + w, e.y + e.height]];
    }
  }
}
const frameOf = (s: SheetInfo) => ({ x0: s.originX, y0: s.originY, x1: s.originX + s.paperWidthMm * s.scale, y1: s.originY + s.paperHeightMm * s.scale });

console.log('=== Fire Drawing Sheets FP-101..FP-105 ===');

const result = designFireProtectionSystem(DEFAULT_FIRE_INPUT);
const drawing = generateFireDrawings(result);

// 1. Sheets
{
  const nums = drawing.sheets.map((s) => s.number);
  const expected = [
    'FP-101', 'FP-102', 'FP-103', 'FP-104', 'FP-105',
    ...(result.standpipe ? ['FP-106', 'FP-107'] : []),
    ...(result.extinguishers ? ['FP-108', 'FP-109'] : []),
    'FP-110',
    ...(result.standpipe ? ['FP-111'] : [])
  ];
  assert(result.extinguishers !== null, 'default design includes portable extinguishers');
  assert(result.standpipe !== null, 'default design includes the standpipe system');
  assert(JSON.stringify(nums) === JSON.stringify(expected), `sheet numbers ${nums}`);
  for (const s of drawing.sheets) {
    assert(s.paper === 'A1' && s.paperWidthMm === 841 && s.paperHeightMm === 594, `${s.number} A1`);
    assert([1, 10, 20, 25, 50, 75, 100, 150, 200, 250, 500, 1000].includes(s.scale), `${s.number} standard scale, got ${s.scale}`);
  }
  for (let i = 1; i < drawing.sheets.length; i++) {
    const a = frameOf(drawing.sheets[i - 1]);
    const b = frameOf(drawing.sheets[i]);
    assert(b.x0 >= a.x1, `sheet ${drawing.sheets[i].number} does not overlap previous`);
  }
  assert(drawing.sheets[0].scale <= 50, `plan scale ≤ 1:50 for readability, got 1:${drawing.sheets[0].scale}`);
  console.log(`✓ ${drawing.sheets.length} A1 sheets, scales ${drawing.sheets.map((s) => '1:' + s.scale).join(', ')}`);
}

// 2. Containment: every entity lies entirely inside exactly one sheet frame
{
  const frames = drawing.sheets.map(frameOf);
  const perSheet = frames.map(() => 0);
  for (const e of drawing.entities) {
    const pts = entityPoints(e);
    const k = frames.findIndex((f) => pts.every(([x, y]) => x >= f.x0 - 1 && x <= f.x1 + 1 && y >= f.y0 - 1 && y <= f.y1 + 1));
    assert(k >= 0, `entity outside all frames: ${JSON.stringify(e).slice(0, 160)}`);
    perSheet[k]++;
  }
  perSheet.forEach((n, i) => assert(n > 150, `sheet ${drawing.sheets[i].number} has content (${n} entities)`));
  for (const e of drawing.entities) {
    for (const [x, y] of entityPoints(e)) assert(Number.isFinite(x) && Number.isFinite(y), 'finite coordinates');
    if (e.kind === 'text') assert(e.text.length > 0 && !e.text.includes('undefined') && !e.text.includes('NaN'), `clean text "${e.text}"`);
  }
  console.log(`✓ containment (${drawing.entities.length} entities: ${perSheet.join(' / ')})`);
}

// 3. Layers in use
{
  const used = new Set(drawing.entities.map((e) => e.layer));
  for (const l of ['FP-WALL', 'FP-WALL-HTCH', 'FP-TANK', 'FP-WATR', 'FP-EQPM', 'FP-PADS', 'FP-PIPE-SUCT', 'FP-PIPE-DISC', 'FP-PIPE-TEST', 'FP-PIPE-JCKY', 'FP-PIPE-DRAN', 'FP-PIPE-SENS', 'FP-FUEL', 'FP-VALV', 'FP-ELEC', 'FP-TRCH', 'FP-HIDN', 'FP-CNTR', 'FP-DIMS', 'FP-ANNO', 'FP-LEVL', 'FP-TABL', 'FP-TBLK', 'FP-ARCH']) {
    assert(used.has(l), `layer ${l} used`);
  }
  console.log('✓ all 24 layers used');
}

// 4. Mandatory annotations
{
  const texts = drawing.entities.filter((e): e is Extract<DrawEntity, { kind: 'text' }> => e.kind === 'text').map((e) => e.text);
  const all = texts.join('\n').toUpperCase();
  const has = (s: string): boolean => all.includes(s.toUpperCase());
  for (const s of ['FP-1', 'FP-2', 'JP-1', 'FPC-1', 'FPC-2', 'JPC-1', 'SECTION A-A', 'SECTION B-B', 'SUMP', 'ANTI-VORTEX', 'TWL', 'LWL', 'OVERFLOW', 'TRENCH', 'FLOW METER', 'TEST HEADER', 'RELIEF', 'OS&Y', 'ECCENTRIC REDUCER', 'CHECK', 'BUTTERFLY', 'JOCKEY', 'DIESEL', 'ELECTRIC', 'FUEL', 'NFPA 20', 'NFPA 22', 'NFPA 13', 'IBC', 'IPC', 'UPC', 'GENERAL NOTES', 'LEGEND', '1%']) {
    assert(has(s), `drawing text contains "${s}"`);
  }
  for (const s of drawing.sheets) assert(texts.includes(s.number), `title block number ${s.number}`);
  assert(texts.some((t) => t === 'NTS'), 'schematic marked NTS');
  // Dimensions carry the designed numbers
  const dims = drawing.entities.filter((e) => e.kind === 'text' && e.layer === 'FP-DIMS').map((e) => (e.kind === 'text' ? e.text : ''));
  assert(dims.includes(String(result.room.lengthMm)), `room internal length ${result.room.lengthMm} dimensioned`);
  assert(dims.includes(String(result.room.widthMm)), `room internal width ${result.room.widthMm} dimensioned`);
  assert(dims.includes(String(Math.round(result.tank.internalWidthM * 1000))), 'tank internal width dimensioned');
  assert(dims.includes(String(result.tank.sump.pitDepthMm)), 'sump depth dimensioned');
  assert(dims.includes(String(result.tank.sump.vortexPlateMm)), 'vortex plate dimensioned');
  // Level marks for tank levels
  const lv = (m: number): string => (m >= 0 ? '+' : '-') + Math.abs(m).toFixed(3);
  assert(texts.some((t) => t.includes(lv(result.room.elevations.tankFloorM + result.tank.levels.topWaterM))), 'TWL level value shown');
  // Hydraulic table rows
  for (const r of result.demand.sprinkler.rows.slice(-3)) assert(texts.includes(r.toNode), `calc table node ${r.toNode}`);
  // Standpipe sheets (FP-106 riser elevation every floor, FP-107 side view / details / floor schedule)
  const sp = result.standpipe!;
  for (const s of ['STANDPIPE RISER DIAGRAM', 'TYPICAL FLOOR CONNECTION', 'SIDE VIEW', 'FLOOR SCHEDULE', 'FIRE DEPARTMENT CONNECTION', 'FLOOR CONTROL VALVE', 'AUTOMATIC AIR RELEASE', 'DRAIN RISER', 'PRV', 'TO FLOOR SPRINKLERS', 'FLOWING', 'STANDPIPE NOTES', 'NFPA 14', 'STANDPIPE HYDRAULIC CALCULATION']) {
    assert(has(s), `standpipe drawing text contains "${s}"`);
  }
  for (const f of DEFAULT_FIRE_INPUT.building!.floors) {
    assert(texts.filter((t) => t.toUpperCase().includes(f.name.toUpperCase())).length >= 2, `floor ${f.name} on riser diagram and schedule`);
    const mark = f.elevationM === 0 ? '%%p0.000' : lv(f.elevationM);
    assert(texts.some((t) => t.includes(mark)), `level mark ${mark} for ${f.name}`);
  }
  for (const r of sp.risers) assert(texts.some((t) => t.includes(r.tag)), `riser ${r.tag} labelled`);
  for (const r of sp.rows) assert(texts.includes(r.fromNode), `standpipe calc node ${r.fromNode}`);
  const prvCount = sp.risers.reduce((n, r) => n + r.outlets.filter((o) => o.prvRequired).length, 0);
  assert(texts.filter((t) => /PRV SET 175 PSI/i.test(t)).length >= prvCount, `≥ ${prvCount} PRV labels on the riser diagram`);
  assert(dims.includes(String(DEFAULT_FIRE_INPUT.standpipeDesign!.hoseValveHeightMm)), 'hose valve height dimensioned');
  // Extinguisher sheets (FP-108 schematic layouts, FP-109 details / schedule / specifications)
  const fe = result.extinguishers!;
  for (const s of ['PORTABLE FIRE EXTINGUISHER LAYOUT', 'MOUNTING DETAIL', 'SEMI-RECESSED CABINET', 'SIGN DETAIL', 'EXTINGUISHER SCHEDULE', 'QUANTITY SUMMARY', 'SELECTION MATRIX', 'INSPECTION & MAINTENANCE', 'EXTINGUISHER SPECIFICATIONS', 'NFPA 10', 'IFC', 'CLASS K', 'TRAVEL']) {
    assert(has(s), `extinguisher drawing text contains "${s}"`);
  }
  for (const z of fe.zones) {
    for (const e of z.extinguishers) assert(texts.filter((t) => t === e.tag).length >= 2, `${e.tag} on the plan and in the schedule`);
    assert(texts.some((t) => t.toUpperCase().includes(z.zoneName.toUpperCase())), `zone ${z.zoneName} labelled`);
  }
  for (const t of fe.totals) assert(texts.some((x) => x.includes(t.ratingText)), `rating ${t.ratingText} in schedule`);
  assert(dims.includes('1200') && dims.includes('1000'), 'mounting heights dimensioned');
  const coverage = drawing.entities.filter((e) => e.kind === 'circle' && e.layer === 'FP-HIDN');
  assert(coverage.length >= fe.totalCount, `coverage circles for every unit (${coverage.length} ≥ ${fe.totalCount})`);
  console.log('✓ annotations, dimensions, levels, tables');
}

// 5. DXF + SVG export
{
  const dxf = writeDxf(drawing);
  assert(dxf.includes('AC1009') && dxf.trimEnd().endsWith('EOF'), 'DXF R12');
  const outDir = process.env.FIRE_DXF_OUT;
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/FP_default.dxf`, dxf);
    drawing.sheets.forEach((s, i) => writeFileSync(`${outDir}/${s.number}.svg`, renderSvg(drawing, { sheetIndex: i, background: 'white' })));
    console.log(`  wrote ${outDir}/FP_default.dxf (${(dxf.length / 1024).toFixed(0)} kB)`);
  }
  for (let i = 0; i < drawing.sheets.length; i++) {
    const svg = renderSvg(drawing, { sheetIndex: i });
    assert(svg.length > 5000 && !svg.includes('NaN'), `SVG sheet ${i}`);
  }
  // Variant designs must also generate
  for (const v of [
    { arrangement: 'electric-only' as const, twoCompartments: false },
    { tankMaterial: 'grp-sectional' as const, hazard: 'extra-2' as const, standpipeClass: 'none' as const },
    { arrangement: 'diesel+diesel' as const, tankMaterial: 'steel-bolted' as const }
  ]) {
    const d = generateFireDrawings(designFireProtectionSystem({ ...DEFAULT_FIRE_INPUT, ...v }));
    assert(d.sheets.length >= 5 && d.entities.length > 1000, `variant ${JSON.stringify(v)} generates`);
    const frames = d.sheets.map(frameOf);
    for (const e of d.entities) {
      const pts = entityPoints(e);
      assert(frames.some((f) => pts.every(([x, y]) => x >= f.x0 - 1 && x <= f.x1 + 1 && y >= f.y0 - 1 && y <= f.y1 + 1)), `variant ${JSON.stringify(v)} containment`);
    }
  }
  console.log('✓ DXF/SVG export & variants');
}

console.log('\nAll fire drawing sheet tests passed.');
