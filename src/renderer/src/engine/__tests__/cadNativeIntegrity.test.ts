import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cadUnitsFromInsUnits, parseDxfText } from '../dxfParser';
import { getCadEntityBounds, getCadEntityPath, transformCadEntity, validateCadEntity } from '../cad/nativeGeometry';

const drawing = (body: string, blocks = '') => `0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${body}0\nENDSEC\n0\nEOF\n`;
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

describe('native CAD integrity', () => {
  it('retains pair alignment after an empty layer value', () => {
    const result = parseDxfText(drawing('0\nLINE\n8\n\n5\nA1\n10\n2\n20\n3\n11\n8\n21\n9\n'));
    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].handle, 'A1');
    assert.equal(result.entities[0].x, 2);
    assert.equal(result.entities[0].y, -3);
    assert.deepEqual(result.entities[0].points, [8, -9]);
  });
  it('omits malformed and nonfinite coordinates with source diagnostics', () => {
    const result = parseDxfText(drawing('0\nLINE\n5\nBAD\n10\nNaN\n20\n3\n11\n8\n21\n9\n0\nLINE\n10\n1\n20\n2\n11\nInfinity\n21\n4\n'));
    assert.equal(result.entities.length, 0);
    assert.equal(result.diagnostics?.length, 2);
    assert.equal(result.diagnostics?.[0].handle, 'BAD');
  });
  it('assembles legacy VERTEX records and preserves closure and bulges', () => {
    const result = parseDxfText(drawing('0\nPOLYLINE\n70\n1\n0\nVERTEX\n10\n0\n20\n0\n42\n1\n0\nVERTEX\n10\n10\n20\n0\n0\nVERTEX\n10\n10\n20\n5\n0\nSEQEND\n'));
    assert.equal(result.entities.length, 1);
    assert.deepEqual(result.entities[0].points, [0, 0, 10, 0, 10, -5]);
    assert.equal(result.entities[0].closed, true);
    assert.deepEqual(result.entities[0].bulges, [1, 0, 0]);
  });
  it('retains ARC angles and uses the quarter-circle bounds', () => {
    const result = parseDxfText(drawing('0\nARC\n10\n10\n20\n20\n40\n5\n50\n0\n51\n90\n'));
    assert.equal(result.entities[0].startAngleDeg, 0);
    assert.equal(result.entities[0].endAngleDeg, 90);
    close(result.bbox.minX, 10); close(result.bbox.maxX, 15);
    close(result.bbox.minY, -25); close(result.bbox.maxY, -20);
  });
  it('preserves lightweight polyline bulges and explicit open state', () => {
    const result = parseDxfText(drawing('0\nLWPOLYLINE\n70\n0\n90\n2\n10\n0\n20\n0\n42\n1\n10\n10\n20\n0\n'));
    assert.equal(result.entities[0].closed, false);
    assert.deepEqual(result.entities[0].bulges, [1, 0]);
    close(result.bbox.maxY, 5);
  });
  it('transforms nested block bases, scales and rotations with one Y inversion', () => {
    const blocks = '0\nBLOCK\n2\nINNER\n10\n1\n20\n2\n0\nLINE\n5\nL1\n8\n0\n10\n2\n20\n2\n11\n2\n21\n3\n0\nENDBLK\n0\nBLOCK\n2\nOUTER\n10\n0\n20\n0\n0\nINSERT\n2\nINNER\n10\n10\n20\n20\n41\n2\n42\n3\n50\n90\n0\nENDBLK\n';
    const result = parseDxfText(drawing('0\nINSERT\n5\nI1\n8\nWALLS\n2\nOUTER\n10\n100\n20\n200\n41\n2\n42\n2\n', blocks));
    assert.equal(result.entities.length, 1);
    close(result.entities[0].x!, 120); close(result.entities[0].y!, -244);
    close(result.entities[0].points![0], 114); close(result.entities[0].points![1], -244);
    assert.equal(result.entities[0].layer, 'WALLS');
    assert.equal(result.entities[0].sourceHandle, 'L1');
  });
  it('retains an inserted nonuniform circle as an exact ellipse', () => {
    const blocks = '0\nBLOCK\n2\nB\n0\nCIRCLE\n10\n0\n20\n0\n40\n2\n0\nENDBLK\n';
    const result = parseDxfText(drawing('0\nINSERT\n2\nB\n10\n10\n20\n20\n41\n3\n42\n2\n', blocks));
    assert.equal(result.entities[0].type, 'ELLIPSE');
    assert.deepEqual(result.bbox, { minX: 4, maxX: 16, minY: -24, maxY: -16 });
  });
  it('diagnoses missing/cyclic blocks, unsupported arrays and nonplanar extrusion', () => {
    const blocks = '0\nBLOCK\n2\nLOOP\n0\nINSERT\n2\nLOOP\n0\nENDBLK\n';
    const result = parseDxfText(drawing('0\nINSERT\n2\nMISSING\n0\nINSERT\n2\nLOOP\n0\nINSERT\n2\nLOOP\n70\n2\n0\nCIRCLE\n10\n0\n20\n0\n40\n5\n210\n1\n220\n0\n230\n0\n', blocks));
    assert.equal(result.entities.length, 0);
    assert.equal(result.diagnostics?.length, 4);
  });
  it('reports unsupported entities and estimates undeclared units', () => {
    const result = parseDxfText(drawing('0\nSPLINE\n5\nS1\n'));
    assert.equal(result.diagnostics?.[0].entityType, 'SPLINE');
    assert.equal(result.unitsConfidence, 'unknown');
    const line = parseDxfText(drawing('0\nLINE\n10\n0\n20\n0\n11\n1500\n21\n0\n'));
    assert.equal(line.cadUnit, 'mm'); assert.equal(line.unitsConfidence, 'estimated');
  });
  it('retains all MTEXT chunks and true color takes precedence over ACI', () => {
    const result = parseDxfText(drawing('0\nMTEXT\n10\n1\n20\n2\n40\n3\n50\n0.7853981633974483\n3\nfirst \n3\nsecond \n1\nlast\n420\n255\n62\n1\n'));
    assert.equal(result.entities[0].text, 'first second last');
    assert.equal(result.entities[0].color, '#0000ff');
    assert.equal(result.entities[0].textHeight, 3); assert.equal(result.entities[0].rotationDeg, 45);
  });
  it('samples true arc sweeps and open/closed bulged paths', () => {
    const arc = getCadEntityPath({ type: 'ARC', x: 0, y: 0, radius: 10, startAngleDeg: 0, endAngleDeg: 90 });
    assert.deepEqual(arc.slice(0, 2), [10, 0]); close(arc.at(-2)!, 0); close(arc.at(-1)!, -10);
    assert.ok(arc.every((p, i) => i % 2 === 0 ? p >= -1e-8 : p <= 1e-8));
    const open = getCadEntityPath({ type: 'LWPOLYLINE', points: [0, 0, 10, 0], bulges: [1, 0], closed: false });
    close(open.at(-2)!, 10); close(open.at(-1)!, 0); assert.ok(open.some((p, i) => i % 2 === 1 && p > 4.9));
    const closed = getCadEntityPath({ type: 'POLYLINE', points: [0, 0, 10, 0, 10, -10], closed: true });
    assert.deepEqual(closed, [0, 0, 10, 0, 10, -10, 0, 0]);
  });
  it('preserves exact partial ellipses under affine shear and reflection', () => {
    const transformed = transformCadEntity({ type: 'ARC', x: 0, y: 0, radius: 2, startAngleDeg: 0, endAngleDeg: 90 }, { a: 2, b: 0, c: 1, d: -3, tx: 10, ty: 20 });
    assert.equal(transformed.type, 'ELLIPSE');
    assert.deepEqual(transformed.majorAxis, { x: 4, y: 0 });
    assert.deepEqual(transformed.minorAxis, { x: -2, y: 6 });
    const path = getCadEntityPath(transformed);
    close(path[0], 14); close(path[1], 20); close(path.at(-2)!, 8); close(path.at(-1)!, 26);
    const bbox = getCadEntityBounds(transformed);
    close(bbox.minX, 8); close(bbox.maxX, 14); close(bbox.minY, 20); close(bbox.maxY, 26);
  });
  it('bounds wraparound arcs and uniform reflected arcs without full circles', () => {
    const source = { type: 'ARC' as const, x: 0, y: 0, radius: 2, startAngleDeg: 270, endAngleDeg: 90 };
    const sourceBounds = getCadEntityBounds(source);
    close(sourceBounds.minX, 0); close(sourceBounds.maxX, 2); close(sourceBounds.minY, -2); close(sourceBounds.maxY, 2);
    const reflected = transformCadEntity(source, { a: -1, b: 0, c: 0, d: 1, tx: 10, ty: 20 });
    const bbox = getCadEntityBounds(reflected);
    close(bbox.minX, 8); close(bbox.maxX, 10); close(bbox.minY, 18); close(bbox.maxY, 22);
  });
  it('validates malformed native fields rather than returning broken paths', () => {
    assert.ok(validateCadEntity({ type: 'ARC', x: 0, y: 0, radius: 1 }));
    assert.ok(validateCadEntity({ type: 'POLYLINE', points: [0, 0, 1, NaN] }));
    assert.ok(validateCadEntity({ type: 'ELLIPSE', x: 0, y: 0, majorAxis: { x: 1, y: 0 }, minorAxis: { x: 2, y: 0 } }));
  });
  it('omits overflowed geometry whose finite native values yield infinite bounds', () => {
    const result = parseDxfText(drawing('0\nCIRCLE\n10\n1e308\n20\n0\n40\n1e308\n'));
    assert.equal(result.entities.length, 0);
    assert.ok(result.diagnostics?.some(d => d.severity === 'error'));
  });
  it('rejects unterminated BLOCK definitions instead of expanding incomplete geometry', () => {
    const result = parseDxfText(drawing('0\nINSERT\n2\nB\n', '0\nBLOCK\n2\nB\n0\nLINE\n10\n0\n20\n0\n11\n10\n21\n0\n'));
    assert.equal(result.entities.length, 0);
    assert.ok(result.diagnostics?.some(d => d.code === 'INCOMPLETE_BLOCK'));
  });
  it('reports malformed orphaned DXF codes and an incomplete legacy polyline', () => {
    const result = parseDxfText(drawing('0\nPOLYLINE\n0\nVERTEX\n10\n0\n20\n0\n0\nVERTEX\n10\n10\n20\n0\n'));
    assert.equal(result.entities.length, 0);
    assert.ok(result.diagnostics?.some(d => d.code === 'INCOMPLETE_POLYLINE'));
    const orphan = parseDxfText('0\nSECTION\n2\nENTITIES\n999');
    assert.ok(orphan.diagnostics?.some(d => d.code === 'INCOMPLETE_PAIR'));
  });
  it('diagnoses nesting limits and exponential block expansion', () => {
    let chain = '';
    for (let i = 0; i < 34; i++) chain += `0\nBLOCK\n2\nB${i}\n0\nINSERT\n2\nB${i + 1}\n0\nENDBLK\n`;
    chain += '0\nBLOCK\n2\nB34\n0\nLINE\n10\n0\n20\n0\n11\n1\n21\n1\n0\nENDBLK\n';
    assert.ok(parseDxfText(drawing('0\nINSERT\n2\nB0\n', chain)).diagnostics?.some(d => d.code === 'BLOCK_DEPTH_LIMIT'));
    let branching = '0\nBLOCK\n2\nB0\n0\nLINE\n10\n0\n20\n0\n11\n1\n21\n1\n0\nENDBLK\n';
    for (let i = 1; i <= 17; i++) branching += `0\nBLOCK\n2\nB${i}\n0\nINSERT\n2\nB${i - 1}\n0\nINSERT\n2\nB${i - 1}\n0\nENDBLK\n`;
    assert.ok(parseDxfText(drawing('0\nINSERT\n2\nB17\n', branching)).diagnostics?.some(d => d.code === 'ENTITY_LIMIT'));
  });
  it('supports planar negative Z OCS without reflecting WCS line coordinates', () => {
    const result = parseDxfText(drawing('0\nARC\n10\n2\n20\n3\n40\n1\n50\n0\n51\n90\n230\n-1\n0\nLINE\n10\n2\n20\n3\n11\n4\n21\n5\n230\n-1\n'));
    const bbox = getCadEntityBounds(result.entities[0]);
    close(bbox.minX, -3); close(bbox.maxX, -2); close(bbox.minY, -4); close(bbox.maxY, -3);
    assert.equal(result.entities[1].x, 2); assert.equal(result.entities[1].y, -3);
  });
  it('parses native partial ellipses and inherited layer true colors', () => {
    const text = '0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\nELLIPSES\n420\n65280\n0\nENDTAB\n0\nENDSEC\n' + drawing('0\nELLIPSE\n8\nELLIPSES\n10\n5\n20\n10\n11\n4\n21\n0\n40\n0.5\n41\n0\n42\n1.5707963267948966\n');
    const result = parseDxfText(text);
    assert.equal(result.entities[0].color, '#00ff00');
    close(result.bbox.minX, 5); close(result.bbox.maxX, 9); close(result.bbox.minY, -12); close(result.bbox.maxY, -10);
  });
  it('accepts small exact ellipse axes after nonuniform scale', () => {
    const ellipse = transformCadEntity({ type: 'CIRCLE', x: 0, y: 0, radius: 1 }, { a: 1e-8, b: 0, c: 0, d: 2e-8, tx: 0, ty: 0 });
    assert.equal(validateCadEntity(ellipse), null);
    assert.ok(getCadEntityPath(ellipse).length >= 4);
  });
  it('honors high bounded segment requests without overflowing JS argument limits', () => {
    const path = getCadEntityPath({ type: 'POLYLINE', points: [0, 0, 10, 0], bulges: [1, 0], closed: false }, { maxSagitta: 1e-12, maxSegments: 65536 });
    assert.equal(path.length, 131074);
    close(path.at(-2)!, 10); close(path.at(-1)!, 0);
  });
  it('omits volumetric thickness instead of silently flattening it', () => {
    const result = parseDxfText(drawing('0\nCIRCLE\n10\n0\n20\n0\n40\n5\n39\n3\n'));
    assert.equal(result.entities.length, 0);
    assert.ok(result.diagnostics?.some(d => d.code === 'UNSUPPORTED_THICKNESS'));
  });
  it('reports duplicate block names instead of choosing arbitrary geometry', () => {
    const blocks = '0\nBLOCK\n2\nB\n0\nCIRCLE\n10\n0\n20\n0\n40\n2\n0\nENDBLK\n0\nBLOCK\n2\nB\n0\nCIRCLE\n10\n0\n20\n0\n40\n3\n0\nENDBLK\n';
    const result = parseDxfText(drawing('0\nINSERT\n2\nB\n', blocks));
    assert.equal(result.entities.length, 0);
    assert.ok(result.diagnostics?.some(d => d.code === 'DUPLICATE_BLOCK'));
  });
  it('converts declared feet and inches to physical meters without rounded scale constants', () => {
    const inches = cadUnitsFromInsUnits(1)!;
    const feet = cadUnitsFromInsUnits(2)!;
    assert.ok(Math.abs(12 / inches.suggestedScaleMetric - 0.3048) < 1e-14);
    assert.ok(Math.abs(1 / feet.suggestedScaleMetric - 0.3048) < 1e-14);
  });
});

it('does not treat fitted legacy control polygons as exact room boundaries',()=>{
 const body='0\nPOLYLINE\n70\n5\n'+[0,0,10,0,10,10,0,10].reduce((s,v,i,a)=>i%2?s:s+`0\nVERTEX\n70\n16\n10\n${v}\n20\n${a[i+1]}\n`,'')+'0\nSEQEND\n';
 const result=parseDxfText(drawing(body));assert.equal(result.entities.length,0);assert.ok(result.diagnostics?.some(d=>/fit|spline|polyline/i.test(d.message)));
});
it('interprets MTEXT radians and last rotation representation wins',()=>{
 const base='0\nMTEXT\n10\n0\n20\n0\n40\n2\n1\nRoom\n';
 close(parseDxfText(drawing(base+`50\n${Math.PI/2}\n`)).entities[0].rotationDeg!,90);
 close(parseDxfText(drawing(base+`11\n1\n21\n0\n50\n${Math.PI/2}\n`)).entities[0].rotationDeg!,90);
 close(parseDxfText(drawing(base+`50\n${Math.PI/2}\n11\n1\n21\n0\n`)).entities[0].rotationDeg!,0);
});
it('diagnoses drawing truncated at a complete pair boundary',()=>{
 const result=parseDxfText('0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n10\n21\n10\n');
 assert.ok(result.diagnostics?.some(d=>/incomplete|truncat|terminat/i.test(d.message)));
});
