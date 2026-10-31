/**
 * AutoCAD R12 (AC1009) ASCII DXF writer. Millimetre model space, '\n' line endings,
 * group codes right-aligned to 3 characters.
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

/** Up to 4 decimals, no exponent, "-0" → "0". */
function num(v: number): string {
  if (!Number.isFinite(v)) return '0';
  let s = v.toFixed(4);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' || s === '' ? '0' : s;
}

function cleanName(n: string): string {
  const c = n.replace(/[<>/\\":;?*|=`,\s]/g, '_');
  return c.length > 0 ? c.slice(0, 31) : '_';
}

/** Strip control characters, keep %%c style codes, escape non-ASCII as \U+XXXX. */
function cleanText(t: string): string {
  let out = '';
  for (const ch of t) {
    const cp = ch.codePointAt(0) ?? 0x20;
    if (cp < 0x20) out += ' ';
    else if (cp > 0x7e) out += `\\U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
    else out += ch;
  }
  return out;
}

function normDeg(a: number): number {
  const r = ((a % 360) + 360) % 360;
  return r;
}

export function writeDxf(drawing: Drawing): string {
  const out: string[] = [];
  const g = (code: number, value: string | number): void => {
    out.push(String(code).padStart(3, ' '));
    out.push(typeof value === 'number' ? num(value) : value);
  };
  const gi = (code: number, value: number): void => {
    out.push(String(code).padStart(3, ' '));
    out.push(String(Math.trunc(value)));
  };
  const pt = (c: number, x: number, y: number, z = 0): void => {
    g(c, x);
    g(c + 10, y);
    g(c + 20, z);
  };

  // extents over entities and sheet frames
  const bb: BBox = entitiesBBox(drawing.entities);
  let { minX, minY, maxX, maxY } = bb;
  if (drawing.entities.length === 0) {
    minX = minY = Infinity;
    maxX = maxY = -Infinity;
  }
  for (const s of drawing.sheets) {
    const sx = s.paperWidthMm * s.scale;
    const sy = s.paperHeightMm * s.scale;
    minX = Math.min(minX, s.originX);
    minY = Math.min(minY, s.originY);
    maxX = Math.max(maxX, s.originX + sx);
    maxY = Math.max(maxY, s.originY + sy);
  }
  if (!Number.isFinite(minX)) minX = minY = maxX = maxY = 0;
  const ltScale = drawing.sheets.length > 0 && drawing.sheets[0].scale > 0 ? drawing.sheets[0].scale : 50;

  // layers: declared + any referenced but undeclared
  const layers: LayerDef[] = drawing.layers.slice();
  const known = new Set(layers.map((l) => cleanName(l.name)));
  for (const e of drawing.entities) {
    const n = cleanName(e.layer);
    if (!known.has(n)) {
      known.add(n);
      layers.push({ name: e.layer, color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.25, description: '' });
    }
  }

  // ── HEADER
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSBASE');
  pt(10, 0, 0, 0);
  g(9, '$EXTMIN');
  pt(10, minX, minY, 0);
  g(9, '$EXTMAX');
  pt(10, maxX, maxY, 0);
  g(9, '$LIMMIN');
  g(10, minX);
  g(20, minY);
  g(9, '$LIMMAX');
  g(10, maxX);
  g(20, maxY);
  g(9, '$LTSCALE');
  g(40, ltScale);
  g(0, 'ENDSEC');

  // ── TABLES
  g(0, 'SECTION');
  g(2, 'TABLES');

  g(0, 'TABLE');
  g(2, 'LTYPE');
  gi(70, LTYPES.length);
  for (const lt of LTYPES) {
    g(0, 'LTYPE');
    g(2, lt.name);
    gi(70, 0);
    g(3, lt.description);
    gi(72, 65);
    gi(73, lt.pattern.length);
    g(40, lt.pattern.reduce((a, v) => a + Math.abs(v), 0));
    for (const v of lt.pattern) g(49, v);
  }
  g(0, 'ENDTAB');

  g(0, 'TABLE');
  g(2, 'LAYER');
  gi(70, layers.length + 1);
  g(0, 'LAYER');
  g(2, '0');
  gi(70, 0);
  gi(62, 7);
  g(6, 'CONTINUOUS');
  for (const l of layers) {
    g(0, 'LAYER');
    g(2, cleanName(l.name));
    gi(70, 0);
    gi(62, Math.min(255, Math.max(1, Math.round(l.color))));
    g(6, l.linetype);
  }
  g(0, 'ENDTAB');

  g(0, 'TABLE');
  g(2, 'STYLE');
  gi(70, 1);
  g(0, 'STYLE');
  g(2, 'STANDARD');
  gi(70, 0);
  g(40, 0);
  g(41, 1);
  g(50, 0);
  gi(71, 0);
  g(42, 2.5);
  g(3, 'txt');
  g(4, '');
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  // ── BLOCKS
  g(0, 'SECTION');
  g(2, 'BLOCKS');
  g(0, 'ENDSEC');

  // ── ENTITIES
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  const writeEntity = (e: DrawEntity): void => {
    const layer = cleanName(e.layer);
    switch (e.kind) {
      case 'line':
        g(0, 'LINE');
        g(8, layer);
        pt(10, e.x1, e.y1);
        pt(11, e.x2, e.y2);
        break;
      case 'circle':
        g(0, 'CIRCLE');
        g(8, layer);
        pt(10, e.cx, e.cy);
        g(40, e.r);
        break;
      case 'arc':
        g(0, 'ARC');
        g(8, layer);
        pt(10, e.cx, e.cy);
        g(40, e.r);
        g(50, normDeg(e.startDeg));
        g(51, normDeg(e.endDeg));
        break;
      case 'text': {
        const h = e.align === 'left' ? 0 : e.align === 'center' ? 1 : 2;
        const v = e.vAlign === 'baseline' ? 0 : e.vAlign === 'bottom' ? 1 : e.vAlign === 'middle' ? 2 : 3;
        g(0, 'TEXT');
        g(8, layer);
        pt(10, e.x, e.y);
        g(40, e.height);
        g(1, cleanText(e.text));
        g(50, e.rotationDeg);
        g(7, 'STANDARD');
        gi(72, h);
        gi(73, v);
        if (h !== 0 || v !== 0) pt(11, e.x, e.y);
        break;
      }
      case 'polyline':
        g(0, 'POLYLINE');
        g(8, layer);
        gi(66, 1);
        pt(10, 0, 0, 0);
        gi(70, e.closed ? 1 : 0);
        for (const [x, y] of e.points) {
          g(0, 'VERTEX');
          g(8, layer);
          pt(10, x, y);
        }
        g(0, 'SEQEND');
        g(8, layer);
        break;
      case 'solid': {
        const p = e.points;
        const q = p.length === 3 ? [p[0], p[1], p[2], p[2]] : [p[0], p[1], p[3], p[2]];
        g(0, 'SOLID');
        g(8, layer);
        pt(10, q[0][0], q[0][1]);
        pt(11, q[1][0], q[1][1]);
        pt(12, q[2][0], q[2][1]);
        pt(13, q[3][0], q[3][1]);
        break;
      }
    }
  };
  for (const e of drawing.entities) writeEntity(e);
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\n') + '\n';
}
