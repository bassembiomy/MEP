/**
 * Acceptance tests — format-neutral drawing kernel, R12 DXF writer and SVG renderer.
 * The DXF is parsed back group-by-group to prove structural validity (R12 / AC1009).
 */
import { DrawingBuilder, FP_LAYERS } from '../fireProtection/drawing/drawingBuilder';
import { writeDxf } from '../fireProtection/drawing/dxfWriter';
import { renderSvg } from '../fireProtection/drawing/svgRenderer';
import * as sym from '../fireProtection/drawing/symbols';
import { SheetInfo } from '../fireProtection/drawing/drawingTypes';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion Failed: ${message}`);
}

/** Parse DXF into [code, value] pairs; throws on malformed structure. */
function parseGroups(dxf: string): [number, string][] {
  assert(dxf.endsWith('\r\n') && !/[^\r]\n/.test(dxf), 'AutoCAD-style CRLF line endings throughout');
  const lines = dxf.split('\r\n');
  if (lines[lines.length - 1] === '') lines.pop();
  assert(lines.length % 2 === 0, `DXF must have an even number of lines, got ${lines.length}`);
  const out: [number, string][] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    assert(Number.isInteger(code), `line ${i + 1}: group code must be integer, got "${lines[i]}"`);
    assert(!lines[i + 1].includes('\r') && !lines[i + 1].includes('\n'), 'no stray CR/LF inside values');
    assert([...lines[i + 1]].every((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) <= 0x7e), `7-bit ASCII value "${lines[i + 1]}"`);
    assert(lines[i + 1].length <= 255, 'value ≤ 255 chars');
    out.push([code, lines[i + 1]]);
  }
  return out;
}

console.log('=== Fire Drawing Kernel — Builder / DXF R12 / SVG ===');

const sheet: SheetInfo = {
  number: 'FP-T01',
  title: 'Kernel Test Sheet',
  scale: 50,
  paper: 'A1',
  paperWidthMm: 841,
  paperHeightMm: 594,
  originX: 0,
  originY: 0
};

const b = new DrawingBuilder('Kernel Test');
b.scale = 50;
b.line('FP-WALL', 0, 0, 10000, 0);
b.rect('FP-WALL', 1000, 1000, 5000, 3000);
b.circle('FP-EQPM', 3000, 2500, 400);
b.arc('FP-ARCH', 6000, 1000, 900, 0, 90);
b.text('FP-ANNO', 2000, 5000, 2.5, 'PUMP %%c150 @ 20%%dC', { align: 'center', vAlign: 'middle' });
b.dimLinear(1000, 1000, 6000, 1000, -10);
b.leader([[3000, 2500], [4000, 3500], [5000, 3500]], ['FP-1', 'ELECTRIC FIRE PUMP']);
b.levelMark(8000, 2000, 1.25, 'TWL');
b.tag(7000, 4000, 'V-01');
b.pipe('FP-PIPE-SUCT', [[0, 6000], [4000, 6000], [4000, 9000]], 168.3);
b.sectionMark(500, 500, 500, 9000, 'A');
b.hatchRect(0, -300, 10000, 300, 2);
sym.gateValve(b, 1500, 6000, 0, 168.3);
sym.butterflyValve(b, 2200, 6000, 0, 168.3);
sym.checkValve(b, 2900, 6000, 0, 168.3);
sym.reliefValve(b, 4000, 7000, 90, 88.9);
sym.flowMeter(b, 4000, 8000, 90, 88.9);
sym.pressureGauge(b, 3500, 6000, 90, 168.3);
sym.eccentricReducer(b, 3700, 6000, 0, 168.3, 141.3);
sym.concentricReducer(b, 3800, 6000, 0, 141.3, 168.3);
const tableH = b.table(12000, 9000, [20, 40, 30], [['TAG', 'DESCRIPTION', 'SIZE'], ['V-01', 'OS&Y GATE', 'DN150']], { title: 'VALVE SCHEDULE' });
assert(tableH > 0, 'table returns positive height');
sym.titleBlock(b, sheet, {
  project: 'Test Project',
  projectNumber: 'FP-0',
  drawingTitle: 'Kernel Test Sheet',
  sheetNumber: 'FP-T01',
  scaleText: '1:50',
  date: '2026-10-31',
  drawnBy: 'MEP',
  checkedBy: 'QA',
  standards: 'NFPA 13 / 14 / 20 / 22'
});

const drawing = b.build([sheet]);

// ── Builder semantics
{
  assert(FP_LAYERS.length >= 24, `FP_LAYERS has ≥24 layers, got ${FP_LAYERS.length}`);
  const layerNames = new Set(drawing.layers.map((l) => l.name));
  for (const e of drawing.entities) assert(layerNames.has(e.layer), `entity layer ${e.layer} defined`);
  const txt = drawing.entities.find((e) => e.kind === 'text' && e.text.includes('PUMP'));
  assert(!!txt && txt.kind === 'text' && Math.abs(txt.height - 125) < 1e-6, 'text paper height × scale (2.5 × 50 = 125)');
  const dimTexts = drawing.entities.filter((e) => e.kind === 'text' && e.layer === 'FP-DIMS');
  assert(dimTexts.some((e) => e.kind === 'text' && e.text === '5000'), 'dimLinear writes measured value 5000');
  assert(drawing.entities.some((e) => e.kind === 'solid' && e.layer === 'FP-ANNO'), 'leader arrowhead is a SOLID');
  assert(drawing.entities.some((e) => e.kind === 'text' && e.text.includes('+1.250')), 'level mark text +1.250');
  assert(drawing.entities.some((e) => e.kind === 'text' && e.text === 'V-01'), 'tag text');
  assert(drawing.entities.filter((e) => e.layer === 'FP-CNTR').length >= 2, 'pipe centre-line segments');
  const pipeLines = drawing.entities.filter((e) => e.layer === 'FP-PIPE-SUCT');
  assert(pipeLines.length >= 4, 'double-line pipe draws 2 lines per segment');
  const hatch = drawing.entities.filter((e) => e.layer === 'FP-WALL-HTCH');
  assert(hatch.length > 10, 'hatch lines generated');
  for (const h of hatch) {
    if (h.kind !== 'line') continue;
    for (const [x, y] of [[h.x1, h.y1], [h.x2, h.y2]]) {
      assert(x >= -0.01 && x <= 10000.01 && y >= -300.01 && y <= 0.01, `hatch clipped to rect (${x},${y})`);
    }
  }
  assert(drawing.entities.filter((e) => e.layer === 'FP-VALV').length >= 10, 'valve symbols drawn on FP-VALV');
  assert(drawing.entities.filter((e) => e.layer === 'FP-TBLK').length >= 10, 'title block drawn');
  assert(drawing.entities.some((e) => e.kind === 'text' && e.text === 'FP-T01'), 'title block sheet number');
  const bb = b.bbox();
  assert(bb.minX <= 0 && bb.maxX >= 10000, 'bbox spans geometry');
  console.log('✓ builder & symbols');
}

// ── DXF R12 structure
{
  const dxf = writeDxf(drawing);
  const g = parseGroups(dxf);
  const idx = (code: number, val: string, from = 0): number => g.findIndex((p, i) => i >= from && p[0] === code && p[1].trim() === val);

  assert(g[g.length - 1][0] === 0 && g[g.length - 1][1] === 'EOF', 'ends with 0/EOF');
  const ver = idx(9, '$ACADVER');
  assert(ver >= 0 && g[ver + 1][1].trim() === 'AC1009', 'AC1009 version');
  const order = ['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES'].map((n) => idx(2, n));
  // AutoCAD R12 structure: all 8 tables in order, handles everywhere, $HANDSEED above every handle
  const tableNames = g.filter((p, i) => i > 0 && g[i - 1][0] === 0 && g[i - 1][1] === 'TABLE' && p[0] === 2).map((p) => p[1]);
  assert(JSON.stringify(tableNames) === JSON.stringify(['VPORT', 'LTYPE', 'LAYER', 'STYLE', 'VIEW', 'UCS', 'APPID', 'DIMSTYLE']), `tables ${tableNames}`);
  const handles = g.filter((p) => (p[0] === 5 || p[0] === 105) && p[1].trim() !== '').map((p) => parseInt(p[1], 16));
  const hsIdx = idx(9, '$HANDSEED');
  assert(hsIdx > 0 && handles.length > 0, '$HANDSEED and handles present');
  const seed = parseInt(g[hsIdx + 1][1], 16);
  assert(new Set(handles.slice(1)).size === handles.length - 1, 'unique handles');
  assert(handles.slice(1).every((h) => h < seed), `handles below $HANDSEED (seed ${seed}, max ${Math.max(...handles.slice(1))}, first ${handles[0]})`);
  assert(idx(2, '$MODEL_SPACE') > 0 && idx(2, '$PAPER_SPACE') > 0, 'model/paper space blocks');
  assert(idx(9, '$DWGCODEPAGE') > 0, '$DWGCODEPAGE');
  assert(order.every((v) => v > 0) && order.every((v, i) => i === 0 || v > order[i - 1]), `section order ${order}`);
  const sections = g.filter((p) => p[0] === 0 && p[1] === 'SECTION').length;
  const endsec = g.filter((p) => p[0] === 0 && p[1] === 'ENDSEC').length;
  assert(sections === 4 && endsec === 4, `4 sections / 4 ENDSEC, got ${sections}/${endsec}`);

  // LTYPE table contains all linetypes used by layers
  for (const lt of ['CONTINUOUS', 'DASHED', 'HIDDEN', 'CENTER', 'PHANTOM']) {
    assert(idx(2, lt) > 0, `LTYPE ${lt} defined`);
  }
  // LAYER table: every layer once with colour
  const tablesStart = order[1];
  const entStart = order[3];
  const layerRecords = g.filter((p, i) => i > tablesStart && i < entStart && p[0] === 0 && p[1] === 'LAYER').length;
  assert(layerRecords === drawing.layers.length + 1, `LAYER table header + ${drawing.layers.length} records, got ${layerRecords}`);

  // Entities
  const ents = g.slice(entStart);
  const count = (t: string): number => ents.filter((p) => p[0] === 0 && p[1] === t).length;
  const model = drawing.entities;
  assert(count('LINE') === model.filter((e) => e.kind === 'line').length, 'LINE count matches model');
  assert(count('CIRCLE') === model.filter((e) => e.kind === 'circle').length, 'CIRCLE count');
  assert(count('ARC') === model.filter((e) => e.kind === 'arc').length, 'ARC count');
  assert(count('TEXT') === model.filter((e) => e.kind === 'text').length, 'TEXT count');
  assert(count('SOLID') === model.filter((e) => e.kind === 'solid').length, 'SOLID count');
  assert(count('POLYLINE') === model.filter((e) => e.kind === 'polyline').length, 'POLYLINE count');
  assert(count('SEQEND') === count('POLYLINE'), 'every POLYLINE has SEQEND');
  const vertexCount = model.filter((e) => e.kind === 'polyline').reduce((s, e) => s + (e.kind === 'polyline' ? e.points.length : 0), 0);
  assert(count('VERTEX') === vertexCount, 'VERTEX count');
  assert(!/e[+-]\d/i.test(ents.filter((p) => [10, 20, 30, 11, 21, 40].includes(p[0])).map((p) => p[1]).join(' ')), 'no exponent notation');
  assert(dxf.includes('%%c150'), 'AutoCAD %%c control code preserved');
  // every entity has a layer group (8) immediately after its type
  for (let i = 0; i < ents.length; i++) {
    const [c, v] = ents[i];
    if (c === 0 && ['LINE', 'CIRCLE', 'ARC', 'TEXT', 'SOLID', 'POLYLINE', 'VERTEX', 'SEQEND'].includes(v)) {
      assert(ents[i + 1][0] === 5 && ents[i + 2][0] === 8, `${v} followed by handle 5 then layer 8`);
    }
  }
  // centred text carries alignment point 11
  const tIdx = ents.findIndex((p) => p[0] === 1 && p[1].includes('PUMP'));
  let j = tIdx;
  while (j > 0 && !(ents[j][0] === 0)) j--;
  const tGroups = ents.slice(j, ents.findIndex((p, i) => i > j && p[0] === 0));
  assert(tGroups.some((p) => p[0] === 72 && p[1].trim() === '1'), 'centre text 72=1');
  assert(tGroups.some((p) => p[0] === 11), 'aligned text has 11 alignment point');
  const i72 = tGroups.findIndex((p) => p[0] === 72), i11 = tGroups.findIndex((p) => p[0] === 11), i73 = tGroups.findIndex((p) => p[0] === 73);
  assert(i72 < i11 && (i73 < 0 || i11 < i73), 'AutoCAD TEXT group order 72, 11, 73');
  console.log(`✓ DXF R12 structure (${g.length} groups)`);
}

// ── SVG
{
  const svg = renderSvg(drawing, { sheetIndex: 0, background: 'white' });
  assert(svg.startsWith('<svg') && svg.trim().endsWith('</svg>'), 'svg root');
  assert(svg.includes('viewBox="0 -29700 42050 29700"'), `viewBox = sheet frame paper×scale, y flipped; got ${svg.slice(0, 200)}`);
  assert(svg.includes('Ø150'), '%%c rendered as Ø');
  assert(svg.includes('°C'), '%%d rendered as °');
  assert(svg.includes('data-layer="FP-WALL"'), 'layer groups');
  assert(svg.includes('<polygon'), 'solids rendered');
  assert(!svg.includes('NaN') && !svg.includes('undefined'), 'no NaN / undefined');
  assert(svg.includes('&amp;') || !svg.includes('OS&Y'), 'XML escaping of &');
  const dark = renderSvg(drawing, { background: 'dark' });
  assert(dark.includes('#ffffff') || dark.includes('#fff'), 'dark background maps ACI 7 to white');
  console.log('✓ SVG renderer');
}

console.log('\nAll fire drawing kernel tests passed.');
