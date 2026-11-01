/**
 * AutoCAD R12 (AC1009) ASCII DXF writer — millimetre model space.
 *
 * The file mirrors the structure AutoCAD itself writes for "Save As → AutoCAD R12/LT2 DXF", so it opens
 * with AutoCAD's strict DXFIN as well as with BricsCAD, LibreCAD, DraftSight, QCAD, etc.:
 *   - HEADER with $ACADVER, $DWGCODEPAGE, extents/limits, current layer/style/linetype/colour,
 *     units, $HANDLING = 1 and $HANDSEED above every handle used;
 *   - all eight symbol tables in AutoCAD order (VPORT, LTYPE, LAYER, STYLE, VIEW, UCS, APPID, DIMSTYLE),
 *     each record with a unique handle (group 5; DIMSTYLE uses group 105);
 *   - BLOCKS with the $MODEL_SPACE / $PAPER_SPACE block definitions;
 *   - every entity with a handle, AutoCAD group order (TEXT: 72, 11/21/31, 73) and real numbers written
 *     with a decimal point;
 *   - plain 7-bit ASCII text (AutoCAD control codes %%c %%d %%p kept, other symbols transliterated),
 *     CRLF line endings, no string longer than 255 characters.
 */
import { entitiesBBox } from './drawingBuilder';
import type { BBox, Drawing, DrawEntity, LayerDef, Linetype } from './drawingTypes';

const LTYPES: { name: Linetype; description: string; pattern: number[] }[] = [
  { name: 'CONTINUOUS', description: 'Solid line', pattern: [] },
  { name: 'DASHED', description: 'Dashed __ __ __ __', pattern: [12.7, -6.35] },
  { name: 'HIDDEN', description: 'Hidden _ _ _ _', pattern: [6.35, -3.175] },
  { name: 'CENTER', description: 'Center ____ _ ____ _', pattern: [31.75, -6.35, 6.35, -6.35] },
  { name: 'PHANTOM', description: 'Phantom _____ __ __ _____', pattern: [31.75, -6.35, 6.35, -6.35, 6.35, -6.35] }
];

/** Real number: up to 6 decimals, always with a decimal point, no exponent, "-0.0" → "0.0". */
function num(v: number): string {
  if (!Number.isFinite(v)) return '0.0';
  let s = v.toFixed(6);
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s += '0';
  return s === '-0.0' ? '0.0' : s;
}

/** Layer / table names: AutoCAD R12 allows A–Z 0–9 $ - _ only, max 31 chars, stored upper case. */
function cleanName(n: string): string {
  const c = n.toUpperCase().replace(/[^A-Z0-9$_-]/g, '_');
  return c.length > 0 ? c.slice(0, 31) : '_';
}

/** Transliteration of the non-ASCII symbols used by the drawing generators. */
const TRANSLIT: Record<string, string> = {
  'Ø': '%%c', 'ø': '%%c', '⌀': '%%c', '°': '%%d', '±': '%%p',
  '½': '1/2', '¼': '1/4', '¾': '3/4', '⅛': '1/8', '²': '2', '³': '3',
  '×': 'x', '·': '.', '•': '*', '—': '-', '–': '-', '−': '-', '‐': '-',
  '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '§': 'SEC.', '≥': '>=', '≤': '<=', '≈': '~',
  '→': '->', '←': '<-', '↑': '^', '↓': 'v', 'µ': 'u', 'Δ': 'D', 'é': 'e', 'è': 'e', 'ü': 'u', 'ö': 'o', 'ä': 'a'
};

/** 7-bit ASCII text for TEXT group 1 (≤ 250 chars). AutoCAD %%-codes are kept. */
function cleanText(t: string): string {
  let out = '';
  for (const ch of t) {
    const cp = ch.codePointAt(0) ?? 0x20;
    if (cp < 0x20) out += ' ';
    else if (cp <= 0x7e) out += ch;
    else out += TRANSLIT[ch] ?? '?';
  }
  out = out.replace(/\s+$/, '');
  if (out.length === 0) out = ' ';
  return out.length > 250 ? out.slice(0, 250) : out;
}

function normDeg(a: number): number {
  return ((a % 360) + 360) % 360;
}

export function writeDxf(drawing: Drawing): string {
  const out: string[] = [];
  let handle = 0x20; // AutoCAD starts user handles above the reserved range
  const nextHandle = (): string => (handle++).toString(16).toUpperCase();

  const g = (code: number, value: string): void => {
    out.push(String(code).padStart(3, ' '));
    out.push(value);
  };
  const gr = (code: number, value: number): void => g(code, num(value));
  const gi = (code: number, value: number): void => {
    out.push(String(code).padStart(3, ' '));
    out.push(String(Math.trunc(value)).padStart(6, ' '));
  };
  const pt = (c: number, x: number, y: number, z = 0): void => {
    gr(c, x);
    gr(c + 10, y);
    gr(c + 20, z);
  };
  const h5 = (): void => g(5, nextHandle());

  // ── extents over entities and sheet frames
  const bb: BBox = entitiesBBox(drawing.entities);
  let { minX, minY, maxX, maxY } = bb;
  if (drawing.entities.length === 0) {
    minX = minY = Infinity;
    maxX = maxY = -Infinity;
  }
  for (const s of drawing.sheets) {
    minX = Math.min(minX, s.originX);
    minY = Math.min(minY, s.originY);
    maxX = Math.max(maxX, s.originX + s.paperWidthMm * s.scale);
    maxY = Math.max(maxY, s.originY + s.paperHeightMm * s.scale);
  }
  if (!Number.isFinite(minX)) {
    minX = minY = 0;
    maxX = 420;
    maxY = 297;
  }
  const ltScale = drawing.sheets.length > 0 && drawing.sheets[0].scale > 0 ? drawing.sheets[0].scale : 50;
  const viewW = Math.max(1, maxX - minX);
  const viewH = Math.max(1, maxY - minY);

  // ── layers: "0" + declared + referenced-but-undeclared, unique by cleaned name
  const layers: LayerDef[] = [];
  const seen = new Set<string>(['0']);
  const addLayer = (l: LayerDef): void => {
    const n = cleanName(l.name);
    if (seen.has(n)) return;
    seen.add(n);
    layers.push({ ...l, name: n });
  };
  drawing.layers.forEach(addLayer);
  for (const e of drawing.entities) addLayer({ name: e.layer, color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.25, description: '' });

  // ── ENTITIES are generated first (into a separate buffer) so $HANDSEED is known for the header
  const head = out.splice(0); // empty
  void head;

  const writeEntity = (e: DrawEntity): void => {
    const layer = cleanName(e.layer);
    switch (e.kind) {
      case 'line':
        g(0, 'LINE');
        h5();
        g(8, layer);
        pt(10, e.x1, e.y1);
        pt(11, e.x2, e.y2);
        break;
      case 'circle':
        if (!(e.r > 0)) return;
        g(0, 'CIRCLE');
        h5();
        g(8, layer);
        pt(10, e.cx, e.cy);
        gr(40, e.r);
        break;
      case 'arc':
        if (!(e.r > 0)) return;
        g(0, 'ARC');
        h5();
        g(8, layer);
        pt(10, e.cx, e.cy);
        gr(40, e.r);
        gr(50, normDeg(e.startDeg));
        gr(51, normDeg(e.endDeg));
        break;
      case 'text': {
        if (!(e.height > 0)) return;
        const hj = e.align === 'left' ? 0 : e.align === 'center' ? 1 : 2;
        const vj = e.vAlign === 'baseline' ? 0 : e.vAlign === 'bottom' ? 1 : e.vAlign === 'middle' ? 2 : 3;
        g(0, 'TEXT');
        h5();
        g(8, layer);
        pt(10, e.x, e.y);
        gr(40, e.height);
        g(1, cleanText(e.text));
        if (e.rotationDeg) gr(50, normDeg(e.rotationDeg));
        if (hj !== 0) gi(72, hj);
        if (hj !== 0 || vj !== 0) pt(11, e.x, e.y);
        if (vj !== 0) gi(73, vj);
        break;
      }
      case 'polyline': {
        if (e.points.length < 2) return;
        g(0, 'POLYLINE');
        h5();
        g(8, layer);
        gi(66, 1);
        pt(10, 0, 0, 0);
        gi(70, e.closed ? 1 : 0);
        for (const [x, y] of e.points) {
          g(0, 'VERTEX');
          h5();
          g(8, layer);
          pt(10, x, y);
          gi(70, 0);
        }
        g(0, 'SEQEND');
        h5();
        g(8, layer);
        break;
      }
      case 'solid': {
        const p = e.points;
        if (p.length < 3) return;
        const q = p.length === 3 ? [p[0], p[1], p[2], p[2]] : [p[0], p[1], p[3], p[2]];
        g(0, 'SOLID');
        h5();
        g(8, layer);
        pt(10, q[0][0], q[0][1]);
        pt(11, q[1][0], q[1][1]);
        pt(12, q[2][0], q[2][1]);
        pt(13, q[3][0], q[3][1]);
        break;
      }
    }
  };

  // Symbol tables and blocks also take handles; write them into their own buffers in file order.
  const section = (fn: () => void): string[] => {
    fn();
    return out.splice(0);
  };

  const tables = section(() => {
    g(0, 'SECTION');
    g(2, 'TABLES');

    // VPORT — *ACTIVE zoomed to the drawing extents
    g(0, 'TABLE');
    g(2, 'VPORT');
    gi(70, 1);
    g(0, 'VPORT');
    h5();
    g(2, '*ACTIVE');
    gi(70, 0);
    g(10, '0.0');
    g(20, '0.0');
    g(11, '1.0');
    g(21, '1.0');
    gr(12, (minX + maxX) / 2);
    gr(22, (minY + maxY) / 2);
    g(13, '0.0');
    g(23, '0.0');
    gr(14, 10 * ltScale);
    gr(24, 10 * ltScale);
    gr(15, 10 * ltScale);
    gr(25, 10 * ltScale);
    g(16, '0.0');
    g(26, '0.0');
    g(36, '1.0');
    g(17, '0.0');
    g(27, '0.0');
    g(37, '0.0');
    gr(40, viewH * 1.05);
    gr(41, Math.min(10, Math.max(0.2, viewW / viewH)));
    g(42, '50.0');
    g(43, '0.0');
    g(44, '0.0');
    g(50, '0.0');
    g(51, '0.0');
    gi(71, 0);
    gi(72, 1000);
    gi(73, 1);
    gi(74, 3);
    gi(75, 0);
    gi(76, 0);
    gi(77, 0);
    gi(78, 0);
    g(0, 'ENDTAB');

    // LTYPE
    g(0, 'TABLE');
    g(2, 'LTYPE');
    gi(70, LTYPES.length);
    for (const lt of LTYPES) {
      g(0, 'LTYPE');
      h5();
      g(2, lt.name);
      gi(70, 0);
      g(3, lt.description);
      gi(72, 65);
      gi(73, lt.pattern.length);
      gr(40, lt.pattern.reduce((a, v) => a + Math.abs(v), 0));
      for (const v of lt.pattern) gr(49, v);
    }
    g(0, 'ENDTAB');

    // LAYER
    g(0, 'TABLE');
    g(2, 'LAYER');
    gi(70, layers.length + 1);
    g(0, 'LAYER');
    h5();
    g(2, '0');
    gi(70, 0);
    gi(62, 7);
    g(6, 'CONTINUOUS');
    for (const l of layers) {
      g(0, 'LAYER');
      h5();
      g(2, l.name);
      gi(70, 0);
      gi(62, Math.min(255, Math.max(1, Math.round(l.color))));
      g(6, LTYPES.some((t) => t.name === l.linetype) ? l.linetype : 'CONTINUOUS');
    }
    g(0, 'ENDTAB');

    // STYLE
    g(0, 'TABLE');
    g(2, 'STYLE');
    gi(70, 1);
    g(0, 'STYLE');
    h5();
    g(2, 'STANDARD');
    gi(70, 0);
    g(40, '0.0');
    g(41, '1.0');
    g(50, '0.0');
    gi(71, 0);
    g(42, '2.5');
    g(3, 'txt');
    g(4, '');
    g(0, 'ENDTAB');

    // VIEW, UCS (empty)
    for (const t of ['VIEW', 'UCS']) {
      g(0, 'TABLE');
      g(2, t);
      gi(70, 0);
      g(0, 'ENDTAB');
    }

    // APPID
    g(0, 'TABLE');
    g(2, 'APPID');
    gi(70, 1);
    g(0, 'APPID');
    h5();
    g(2, 'ACAD');
    gi(70, 0);
    g(0, 'ENDTAB');

    // DIMSTYLE (STANDARD, metric)
    g(0, 'TABLE');
    g(2, 'DIMSTYLE');
    gi(70, 1);
    g(0, 'DIMSTYLE');
    g(105, nextHandle());
    g(2, 'STANDARD');
    gi(70, 0);
    for (const c of [3, 4, 5, 6, 7]) g(c, '');
    const dimReals: [number, number][] = [
      [40, ltScale], [41, 2.5], [42, 0.625], [43, 3.75], [44, 1.25], [45, 0], [46, 0], [47, 0], [48, 0],
      [140, 2.5], [141, 2.5], [142, 0], [143, 0.03937007874], [144, 1], [145, 0], [146, 1], [147, 0.625]
    ];
    for (const [c, v] of dimReals) gr(c, v);
    const dimInts: [number, number][] = [
      [71, 0], [72, 0], [73, 0], [74, 0], [75, 0], [76, 0], [77, 1], [78, 8],
      [170, 0], [171, 3], [172, 1], [173, 0], [174, 0], [175, 0], [176, 0], [177, 0], [178, 0]
    ];
    for (const [c, v] of dimInts) gi(c, v);
    g(0, 'ENDTAB');

    g(0, 'ENDSEC');
  });

  const blocks = section(() => {
    g(0, 'SECTION');
    g(2, 'BLOCKS');
    for (const name of ['$MODEL_SPACE', '$PAPER_SPACE']) {
      g(0, 'BLOCK');
      h5();
      g(8, '0');
      g(2, name);
      gi(70, 0);
      pt(10, 0, 0, 0);
      g(3, name);
      g(1, '');
      g(0, 'ENDBLK');
      h5();
      g(8, '0');
    }
    g(0, 'ENDSEC');
  });

  const entities = section(() => {
    g(0, 'SECTION');
    g(2, 'ENTITIES');
    for (const e of drawing.entities) writeEntity(e);
    g(0, 'ENDSEC');
  });

  const header = section(() => {
    g(0, 'SECTION');
    g(2, 'HEADER');
    g(9, '$ACADVER');
    g(1, 'AC1009');
    g(9, '$DWGCODEPAGE');
    g(3, 'ANSI_1252');
    g(9, '$INSBASE');
    pt(10, 0, 0, 0);
    g(9, '$EXTMIN');
    pt(10, minX, minY, 0);
    g(9, '$EXTMAX');
    pt(10, maxX, maxY, 0);
    g(9, '$LIMMIN');
    gr(10, minX);
    gr(20, minY);
    g(9, '$LIMMAX');
    gr(10, maxX);
    gr(20, maxY);
    g(9, '$ORTHOMODE');
    gi(70, 0);
    g(9, '$REGENMODE');
    gi(70, 1);
    g(9, '$FILLMODE');
    gi(70, 1);
    g(9, '$QTEXTMODE');
    gi(70, 0);
    g(9, '$MIRRTEXT');
    gi(70, 0);
    g(9, '$LTSCALE');
    gr(40, ltScale);
    g(9, '$ATTMODE');
    gi(70, 1);
    g(9, '$TEXTSIZE');
    gr(40, 2.5 * ltScale);
    g(9, '$TEXTSTYLE');
    g(7, 'STANDARD');
    g(9, '$CLAYER');
    g(8, '0');
    g(9, '$CELTYPE');
    g(6, 'BYLAYER');
    g(9, '$CECOLOR');
    gi(62, 256);
    g(9, '$DIMSCALE');
    gr(40, ltScale);
    g(9, '$DIMSTYLE');
    g(2, 'STANDARD');
    g(9, '$LUNITS');
    gi(70, 2);
    g(9, '$LUPREC');
    gi(70, 0);
    g(9, '$AUNITS');
    gi(70, 0);
    g(9, '$AUPREC');
    gi(70, 0);
    g(9, '$PDMODE');
    gi(70, 0);
    g(9, '$PDSIZE');
    g(40, '0.0');
    g(9, '$TILEMODE');
    gi(70, 1);
    g(9, '$HANDLING');
    gi(70, 1);
    g(9, '$HANDSEED');
    g(5, (handle + 1).toString(16).toUpperCase());
    g(0, 'ENDSEC');
  });

  const all = [...header, ...tables, ...blocks, ...entities];
  all.push('  0', 'EOF');
  return all.join('\r\n') + '\r\n';
}
