import {
  parseDxfText, normalizeCadToCanvas, dwgInsertToXf, transformEntityByInsert, splinePoints, stripMtext, CadEntity,
} from '../dxfParser';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}
function near(a: number, b: number, tol: number, msg: string) {
  assert(Math.abs(a - b) <= tol, `${msg}: expected ${b}, got ${a}`);
}

type P = [number, string | number];
const dxf = (header: P[], entities: P[], blocks: P[] = [], tables: P[] = []): string => {
  const sec = (name: string, body: P[]) => [[0, 'SECTION'], [2, name], ...body, [0, 'ENDSEC']] as P[];
  const all: P[] = [
    ...sec('HEADER', header),
    ...(tables.length ? sec('TABLES', tables) : []),
    ...(blocks.length ? sec('BLOCKS', blocks) : []),
    ...sec('ENTITIES', entities),
    [0, 'EOF'],
  ];
  return all.map(([c, v]) => `${c}\n${v}`).join('\n') + '\n';
};
const insunitsHdr = (n: number): P[] => [[9, '$INSUNITS'], [70, n]];
const line = (x1: number, y1: number, x2: number, y2: number, layer = '0'): P[] =>
  [[0, 'LINE'], [8, layer], [10, x1], [20, y1], [30, 0], [11, x2], [21, y2], [31, 0]];

console.log('=== Running CAD Import Geometry Tests ===');

// 1. Empty-value header line must not shift group pairs
{
  const t = '0\nSECTION\n2\nHEADER\n9\n$DIMPOST\n1\n\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n' +
    '0\nLINE\n8\n0\n10\n1\n20\n2\n11\n3\n21\n4\n0\nENDSEC\n0\nEOF\n';
  const r = parseDxfText(t);
  assert(r.entities.length === 1, `empty header value: expected 1 entity, got ${r.entities.length}`);
  assert(r.entities[0].x === 1 && r.entities[0].points![1] === 4, 'empty header value: LINE coords');
  const crlf = parseDxfText(t.replace(/\n/g, '\r\n'));
  assert(crlf.entities.length === 1, 'CRLF file parses');
  console.log('PASS: empty-value header + CRLF');
}

// 2. INSUNITS scaling -> exact px (10 m square room, 10 px/ft imperial)
{
  const room = (units: number, size: number) =>
    parseDxfText(dxf(insunitsHdr(units), [...line(0, 0, size, 0), ...line(size, 0, size, size)]));
  const mm = room(4, 10000);
  assert(mm.insunits === 4, 'insunits parsed');
  const n1 = normalizeCadToCanvas(mm.entities, { insunits: mm.insunits, projectScale: 10, projectUnits: 'imperial' });
  near(n1.bbox.maxX, 328.084, 1e-3, 'mm room 328.08 px');
  assert(!n1.needsCalibration, 'mm declared => no calibration');
  const n2 = normalizeCadToCanvas(mm.entities, { insunits: 4, projectScale: 20, projectUnits: 'metric' });
  near(n2.bbox.maxX, 200, 1e-9, 'mm room at 20 px/m width');
  const m = room(6, 10);
  near(normalizeCadToCanvas(m.entities, { insunits: 6, projectScale: 20, projectUnits: 'metric' }).bbox.maxX, 200, 1e-4, 'm room');
  const inch = room(1, 120);
  near(normalizeCadToCanvas(inch.entities, { insunits: 1, projectScale: 10, projectUnits: 'imperial' }).bbox.maxX, 100, 1e-9, '120 in = 10 ft = 100 px');
  const ft = room(2, 10);
  near(normalizeCadToCanvas(ft.entities, { insunits: 2, projectScale: 10, projectUnits: 'imperial' }).bbox.maxX, 100, 1e-9, 'ft room');
  // unitless: warns, defaults
  const un = room(0, 10000);
  const nu = normalizeCadToCanvas(un.entities, { insunits: 0, projectScale: 10, projectUnits: 'imperial' });
  assert(nu.needsCalibration && !!nu.warning, 'unitless large extents needs calibration + warning');
  near(nu.bbox.maxX, 328.084, 1e-3, 'unitless >5000 assumed mm');
  const nf = normalizeCadToCanvas(room(0, 40).entities, { projectScale: 10, projectUnits: 'imperial' });
  assert(nf.needsCalibration, 'unitless small needs calibration');
  near(nf.bbox.maxX, 400, 1e-9, 'unitless small assumed ft');
  const no = normalizeCadToCanvas(room(0, 40).entities, { projectScale: 10, projectUnits: 'imperial', overrideFeetPerUnit: 0.5 });
  assert(!no.needsCalibration, 'override clears calibration flag');
  near(no.bbox.maxX, 200, 1e-9, 'override feet per unit');
  console.log('PASS: INSUNITS mm/m/in/ft + unitless handling');
}

// 3. Y flip
{
  const r = parseDxfText(dxf(insunitsHdr(2), [...line(0, 0, 10, 0), ...line(5, 10, 5, 0), [0, 'TEXT'], [8, '0'], [10, 5], [20, 10], [40, 2], [50, 30], [1, 'HI']]));
  const n = normalizeCadToCanvas(r.entities, { insunits: 2, projectScale: 10, projectUnits: 'imperial' });
  const top = n.entities[1];
  near(top.y!, 0, 1e-9, 'top of DXF at canvas Y=0');
  near(top.points![1], 100, 1e-9, 'bottom of DXF at canvas Y=100');
  const txt = n.entities[2];
  near(txt.y!, 0, 1e-9, 'text y flipped');
  near(txt.height!, 20, 1e-9, 'text height scaled');
  near(txt.rotation!, -30, 1e-9, 'text rotation negated');
  near(n.bbox.maxY, 100, 1e-9, 'bbox height');
  console.log('PASS: Y flip');
}

// 4. LWPOLYLINE bulge: closed semicircle
{
  const r = parseDxfText(dxf(insunitsHdr(2), [
    [0, 'LWPOLYLINE'], [8, '0'], [90, 2], [70, 1],
    [10, 0], [20, 0], [42, 1],
    [10, 10], [20, 0],
  ]));
  assert(r.entities.length === 1, 'bulge polyline parsed');
  const pts = r.entities[0].points!;
  assert(pts.length > 10, `semicircle tessellated (${pts.length / 2} pts)`);
  // arc part: all points lie on circle centre (5,0) r 5 (apart from the straight closing chord's endpoints which are also on it)
  for (let i = 0; i < pts.length; i += 2) {
    const d = Math.hypot(pts[i] - 5, pts[i + 1]);
    near(d, 5, 1e-6, `point ${i / 2} on radius`);
  }
  // CCW bulge from (0,0) to (10,0): arc goes below the chord (y <= 0)
  assert(pts.every((v, i) => i % 2 === 0 || v <= 1e-9), 'bulge>0 sweeps CCW (below chord for left->right)');
  assert(pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1], 'closed polyline ends at start');
  // segments: >= 1 per 5 degrees over 180 deg
  assert(pts.length / 2 >= 36, 'at least 36 segments');
  // open polyline stays open
  const o = parseDxfText(dxf(insunitsHdr(2), [[0, 'LWPOLYLINE'], [8, '0'], [70, 0], [10, 0], [20, 0], [10, 10], [20, 0], [10, 10], [20, 10]]));
  assert(o.entities[0].points!.length === 6, 'open polyline unchanged');
  const c = parseDxfText(dxf(insunitsHdr(2), [[0, 'LWPOLYLINE'], [8, '0'], [70, 1], [10, 0], [20, 0], [10, 10], [20, 0], [10, 10], [20, 10]]));
  assert(c.entities[0].points!.length === 8, 'closed polyline appends closing point');
  console.log('PASS: LWPOLYLINE bulge + closed');
}

// 5. ARC angles
{
  const r = parseDxfText(dxf(insunitsHdr(2), [[0, 'ARC'], [8, '0'], [10, 5], [20, 5], [40, 2], [50, 30], [51, 120]]));
  const a = r.entities[0];
  assert(a.startAngle === 30 && a.endAngle === 120, `ARC angles degrees, got ${a.startAngle}/${a.endAngle}`);
  const n = normalizeCadToCanvas(r.entities, { insunits: 2, projectScale: 10, projectUnits: 'imperial' });
  const na = n.entities[0];
  near(na.radius!, 20, 1e-9, 'arc radius scaled');
  near(na.startAngle!, 240, 1e-9, 'arc flipped start = -end');
  near(na.endAngle!, 330, 1e-9, 'arc flipped end = -start');
  // wrap-around arc
  const w = parseDxfText(dxf([], [[0, 'ARC'], [8, '0'], [10, 0], [20, 0], [40, 1], [50, 300], [51, 60]])).entities[0];
  near(w.endAngle! - w.startAngle!, 120, 1e-9, 'wrapped arc sweep');
  console.log('PASS: ARC angles');
}

// 6. Old-style POLYLINE / VERTEX / SEQEND
{
  const r = parseDxfText(dxf(insunitsHdr(2), [
    [0, 'POLYLINE'], [8, 'WALLS'], [66, 1], [70, 1],
    [0, 'VERTEX'], [8, 'WALLS'], [10, 0], [20, 0],
    [0, 'VERTEX'], [8, 'WALLS'], [10, 4], [20, 0],
    [0, 'VERTEX'], [8, 'WALLS'], [10, 4], [20, 3],
    [0, 'SEQEND'], [8, 'WALLS'],
    ...line(0, 0, 1, 1, 'X'),
  ]));
  assert(r.entities.length === 2, `polyline + line, got ${r.entities.length}`);
  const p = r.entities[0];
  assert(p.layer === 'WALLS' && p.points!.join(',') === '0,0,4,0,4,3,0,0', `closed POLYLINE points ${p.points}`);
  const b = parseDxfText(dxf([], [
    [0, 'POLYLINE'], [8, '0'], [70, 0],
    [0, 'VERTEX'], [8, '0'], [10, 0], [20, 0], [42, 1],
    [0, 'VERTEX'], [8, '0'], [10, 10], [20, 0],
    [0, 'SEQEND'],
  ])).entities[0];
  for (let i = 0; i < b.points!.length; i += 2) near(Math.hypot(b.points![i] - 5, b.points![i + 1]), 5, 1e-6, 'POLYLINE bulge on radius');
  console.log('PASS: POLYLINE/VERTEX/SEQEND');
}

// 7. INSERT: rotation 90 + scale 2 + nested block, base point, layer 0 inheritance
{
  const blocks: P[] = [
    [0, 'BLOCK'], [8, '0'], [2, 'INNER'], [70, 0], [10, 1], [20, 1],
    ...line(1, 1, 2, 1, '0'),
    [0, 'ENDBLK'],
    [0, 'BLOCK'], [8, '0'], [2, 'OUTER'], [70, 0], [10, 0], [20, 0],
    [0, 'INSERT'], [8, '0'], [2, 'INNER'], [10, 5], [20, 0],
    [0, 'ENDBLK'],
  ];
  const r = parseDxfText(dxf(insunitsHdr(2), [
    [0, 'INSERT'], [8, 'FURN'], [2, 'OUTER'], [10, 100], [20, 200], [41, 2], [42, 2], [50, 90],
  ], blocks));
  assert(r.entities.length === 1, `nested insert expands to 1 entity, got ${r.entities.length}`);
  const e = r.entities[0];
  // INNER base (1,1): line (1,1)->(2,1) => local (0,0)->(1,0); inserted at (5,0) in OUTER => (5,0)->(6,0)
  // OUTER: scale 2 => (10,0)->(12,0); rotate 90 => (0,10)->(0,12); translate (100,200)
  near(e.x!, 100, 1e-9, 'start x'); near(e.y!, 210, 1e-9, 'start y');
  near(e.points![0], 100, 1e-9, 'end x'); near(e.points![1], 212, 1e-9, 'end y');
  assert(e.layer === 'FURN', `layer 0 inherits INSERT layer, got ${e.layer}`);

  // block depth limit / recursion doesn't hang
  const rec: P[] = [
    [0, 'BLOCK'], [8, '0'], [2, 'R'], [10, 0], [20, 0], ...line(0, 0, 1, 1), [0, 'INSERT'], [8, '0'], [2, 'R'], [10, 0], [20, 0], [0, 'ENDBLK'],
  ];
  const rr = parseDxfText(dxf([], [[0, 'INSERT'], [8, '0'], [2, 'R'], [10, 0], [20, 0]], rec));
  assert(rr.entities.length <= 9, 'recursive block bounded by depth limit');
  console.log('PASS: INSERT rotation/scale/nested');
}

// 8. MINSERT 2 cols x 3 rows
{
  const blocks: P[] = [[0, 'BLOCK'], [8, '0'], [2, 'B'], [10, 0], [20, 0], ...line(0, 0, 1, 0), [0, 'ENDBLK']];
  const r = parseDxfText(dxf([], [[0, 'INSERT'], [8, '0'], [2, 'B'], [10, 10], [20, 20], [70, 2], [71, 3], [44, 5], [45, 7]], blocks));
  assert(r.entities.length === 6, `MINSERT 2x3 => 6, got ${r.entities.length}`);
  const starts = r.entities.map((e) => `${e.x},${e.y}`).sort();
  const expect: string[] = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 2; col++) expect.push(`${10 + col * 5},${20 + row * 7}`);
  assert(starts.join('|') === expect.sort().join('|'), `MINSERT grid positions ${starts}`);
  // rotated array: spacing follows rotated axes
  const rot = parseDxfText(dxf([], [[0, 'INSERT'], [8, '0'], [2, 'B'], [10, 0], [20, 0], [70, 2], [71, 1], [44, 5], [50, 90]], blocks));
  const xs = rot.entities.map((e) => [Math.round(e.x!), Math.round(e.y!)].join(',')).sort();
  assert(xs.join('|') === ['0,0', '0,5'].join('|'), `rotated MINSERT ${xs}`);
  console.log('PASS: MINSERT');
}

// 9. DWG INSERT rotation is RADIANS (transform factored out of the wasm module)
{
  const xf = dwgInsertToXf({ insertionPoint: { x: 10, y: 20 }, xScale: 1, yScale: 1, rotation: Math.PI / 2 }, { x: 0, y: 0 });
  near(xf.rot, Math.PI / 2, 1e-12, 'rotation used as radians');
  const e = transformEntityByInsert({ type: 'LINE', layer: '0', x: 0, y: 0, points: [1, 0] }, xf);
  near(e.x!, 10, 1e-9, 'x'); near(e.points![0], 10, 1e-9, 'rotated end x'); near(e.points![1], 21, 1e-9, 'rotated end y');
  // non-uniform scale: circle -> polyline ellipse
  const ell = transformEntityByInsert({ type: 'CIRCLE', layer: '0', x: 0, y: 0, radius: 1 },
    { baseX: 0, baseY: 0, insX: 0, insY: 0, sx: 3, sy: 1, rot: 0 });
  assert(ell.type === 'LWPOLYLINE', 'non-uniform circle tessellated');
  const pts = ell.points!;
  for (let i = 0; i < pts.length; i += 2) near((pts[i] / 3) ** 2 + pts[i + 1] ** 2, 1, 1e-9, 'point on ellipse');
  // mirrored uniform arc: angles reflect, endpoints preserved
  const arc: CadEntity = { type: 'ARC', layer: '0', x: 0, y: 0, radius: 1, startAngle: 0, endAngle: 90 };
  const mir = transformEntityByInsert(arc, { baseX: 0, baseY: 0, insX: 0, insY: 0, sx: -1, sy: 1, rot: 0 });
  near(mir.startAngle!, 90, 1e-9, 'mirrored arc start'); near(mir.endAngle!, 180, 1e-9, 'mirrored arc end');
  console.log('PASS: DWG radians rotation + non-uniform/mirrored scale');
}

// 10. Spline evaluation
{
  const ctrl = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }];
  const pts = splinePoints(ctrl, 3, [0, 0, 0, 0, 1, 1, 1, 1]);
  assert(pts.length / 2 >= 9, 'at least 8 samples per span');
  near(pts[0], 0, 1e-12, 'start x'); near(pts[1], 0, 1e-12, 'start y');
  near(pts[pts.length - 2], 10, 1e-12, 'end x'); near(pts[pts.length - 1], 0, 1e-12, 'end y');
  // Bezier midpoint (u=0.5) = (P0+3P1+3P2+P3)/8 = (5, 7.5); sample index 4 of 8
  near(pts[8], 5, 1e-9, 'mid x'); near(pts[9], 7.5, 1e-9, 'mid y');
  // DXF SPLINE end-to-end (no fit points)
  const body: P[] = [[0, 'SPLINE'], [8, '0'], [70, 8], [71, 3], [72, 8], [73, 4],
    ...[0, 0, 0, 0, 1, 1, 1, 1].map((k) => [40, k] as P),
    ...ctrl.flatMap((p) => [[10, p.x], [20, p.y]] as P[])];
  const r = parseDxfText(dxf([], body));
  assert(r.entities.length === 1 && r.entities[0].points!.length / 2 >= 9, 'DXF spline via control points');
  // control-polygon bulge is NOT the curve: curve apex y = 7.5 < 10
  assert(Math.max(...r.entities[0].points!.filter((_, i) => i % 2 === 1)) < 7.6, 'spline does not follow control polygon');
  console.log('PASS: spline');
}

// 11. MTEXT stripping + attributes
{
  assert(stripMtext('{\\fArial|b0|i0;Hello}\\PWorld\\H2.5;!\\A1;') === 'Hello\nWorld!', 'stripMtext');
  assert(stripMtext('A\\\\B \\{x\\}') === 'A\\B {x}', 'escapes preserved');
  const r = parseDxfText(dxf([], [
    [0, 'MTEXT'], [8, '0'], [10, 1], [20, 2], [40, 3.5], [71, 2], [50, 45],
    [3, '{\\fArial;Part one, '], [1, 'part two}\\Pline 2'],
  ]));
  const t = r.entities[0];
  assert(t.text === 'Part one, part two\nline 2', `MTEXT continuation + strip, got ${JSON.stringify(t.text)}`);
  assert(t.height === 3.5 && t.rotation === 45 && t.align === 'center', 'MTEXT height/rotation/align');
  const tx = parseDxfText(dxf([], [[0, 'TEXT'], [8, '0'], [10, 0], [20, 0], [11, 6], [21, 7], [40, 2], [50, 90], [72, 2], [1, '12%%d']])).entities[0];
  assert(tx.x === 6 && tx.y === 7 && tx.align === 'right' && tx.rotation === 90 && tx.text === '12°', 'TEXT alignment point/right/%%d');
  console.log('PASS: MTEXT/TEXT');
}

// 12. Layer colours + BYLAYER/BYBLOCK
{
  const tables: P[] = [[0, 'TABLE'], [2, 'LAYER'], [0, 'LAYER'], [2, 'WALLS'], [70, 0], [62, 1], [6, 'CONTINUOUS'], [0, 'ENDTAB']];
  const blocks: P[] = [[0, 'BLOCK'], [8, '0'], [2, 'B'], [10, 0], [20, 0],
    [0, 'LINE'], [8, '0'], [62, 0], [10, 0], [20, 0], [11, 1], [21, 0], [0, 'ENDBLK']];
  const r = parseDxfText(dxf([], [
    ...line(0, 0, 1, 1, 'WALLS'),
    [0, 'LINE'], [8, 'WALLS'], [62, 3], [10, 0], [20, 0], [11, 1], [21, 1],
    [0, 'INSERT'], [8, 'WALLS'], [2, 'B'], [10, 0], [20, 0], [62, 5],
  ], blocks, tables));
  assert(r.layerColors.WALLS === '#ef4444', 'layer colour exposed');
  assert(r.entities[0].color === '#ef4444', 'BYLAYER resolved');
  assert(r.entities[1].color === '#22c55e', 'explicit ACI wins');
  assert(r.entities[2].color === '#3b82f6', 'BYBLOCK inherits INSERT colour');
  console.log('PASS: layer colours');
}

console.log('=== All CAD import geometry tests passed ===');
