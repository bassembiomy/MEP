/** SVG preview renderer — same Drawing model as the DXF writer (what you see = what is exported). */
import { entitiesBBox } from './drawingBuilder';
import type { Drawing, DrawEntity, LayerDef, Linetype } from './drawingTypes';

export interface SvgOptions {
  sheetIndex?: number;
  background?: 'white' | 'dark';
  widthPx?: number;
}

const DASH: Record<Linetype, number[]> = {
  CONTINUOUS: [],
  DASHED: [12.7, 6.35],
  HIDDEN: [6.35, 3.175],
  CENTER: [31.75, 6.35, 6.35, 6.35],
  PHANTOM: [31.75, 6.35, 6.35, 6.35, 6.35, 6.35]
};

const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const rgb = (r: number, g: number, b: number): string => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

function hsv(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

const lum = (r: number, g: number, b: number): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const WHITE_BG: Record<number, string> = {
  1: '#d40000',
  2: '#b8a000',
  3: '#008a00',
  4: '#008c9a',
  5: '#0000d0',
  6: '#b000b0',
  7: '#000000',
  8: '#6e6e6e',
  9: '#909090'
};
const DARK_BG: Record<number, string> = {
  1: '#ff3b3b',
  2: '#ffff00',
  3: '#00ff00',
  4: '#00ffff',
  5: '#5b7bff',
  6: '#ff4dff',
  7: '#ffffff',
  8: '#9a9a9a',
  9: '#c0c0c0'
};

/** AutoCAD Color Index → CSS colour, adjusted for legibility on the chosen background. */
function aciColor(aci: number, dark: boolean): string {
  const table = dark ? DARK_BG : WHITE_BG;
  if (table[aci]) return table[aci];
  let c: [number, number, number];
  if (aci >= 10 && aci <= 249) {
    const idx = aci - 10;
    const hue = Math.floor(idx / 10) * 15;
    const k = idx % 10;
    const sat = k % 2 === 0 ? 1 : 0.5;
    const val = [1, 0.65, 0.5, 0.3, 0.15][Math.floor(k / 2)];
    c = hsv(hue, sat, val);
  } else if (aci >= 250 && aci <= 255) {
    const g = [0x33, 0x50, 0x69, 0x82, 0xbe, 0xff][aci - 250];
    c = [g, g, g];
  } else {
    c = [128, 128, 128];
  }
  let [r, g, b] = c;
  const l = lum(r, g, b);
  if (!dark && l > 0.55) {
    const f = 0.45 / l;
    [r, g, b] = [r * f, g * f, b * f];
  } else if (dark && l < 0.3) {
    const t = (0.3 - l) / (1 - l) + 0.15;
    [r, g, b] = [r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t];
  }
  return rgb(r, g, b);
}

function n(v: number): string {
  if (!Number.isFinite(v)) return '0';
  let s = v.toFixed(3);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' || s === '' ? '0' : s;
}

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** AutoCAD control codes → Unicode; underline/overline toggles dropped. */
function decodeText(t: string): string {
  return t
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[uUoO]/g, '')
    .replace(/%%%/g, '%')
    .replace(/[\r\n]+/g, ' ');
}

function entitySvg(e: DrawEntity, color: string): string {
  switch (e.kind) {
    case 'line':
      return `<line x1="${n(e.x1)}" y1="${n(-e.y1)}" x2="${n(e.x2)}" y2="${n(-e.y2)}"/>`;
    case 'polyline': {
      const pts = e.points.map(([x, y]) => `${n(x)},${n(-y)}`).join(' ');
      return e.closed ? `<polygon points="${pts}" fill="none"/>` : `<polyline points="${pts}"/>`;
    }
    case 'circle':
      return `<circle cx="${n(e.cx)}" cy="${n(-e.cy)}" r="${n(e.r)}"/>`;
    case 'arc': {
      const span = (((e.endDeg - e.startDeg) % 360) + 360) % 360;
      if (span < 1e-6) return `<circle cx="${n(e.cx)}" cy="${n(-e.cy)}" r="${n(e.r)}"/>`;
      const a0 = (e.startDeg * Math.PI) / 180;
      const a1 = (e.endDeg * Math.PI) / 180;
      const sx = e.cx + e.r * Math.cos(a0);
      const sy = e.cy + e.r * Math.sin(a0);
      const ex = e.cx + e.r * Math.cos(a1);
      const ey = e.cy + e.r * Math.sin(a1);
      return `<path d="M${n(sx)} ${n(-sy)}A${n(e.r)} ${n(e.r)} 0 ${span > 180 ? 1 : 0} 0 ${n(ex)} ${n(-ey)}"/>`;
    }
    case 'text': {
      const anchor = e.align === 'left' ? 'start' : e.align === 'center' ? 'middle' : 'end';
      const dy = e.vAlign === 'middle' ? e.height / 2 : e.vAlign === 'top' ? e.height : 0;
      const rot = Math.abs(e.rotationDeg) > 1e-9 ? ` transform="rotate(${n(-e.rotationDeg)} ${n(e.x)} ${n(-e.y)})"` : '';
      return (
        `<text x="${n(e.x)}" y="${n(-e.y)}"${dy ? ` dy="${n(dy)}"` : ''} font-family="Arial, sans-serif" font-size="${n(e.height * 1.25)}" ` +
        `text-anchor="${anchor}" dominant-baseline="alphabetic" fill="${color}" stroke="none"${rot}>${esc(decodeText(e.text))}</text>`
      );
    }
    case 'solid': {
      const pts = e.points.map(([x, y]) => `${n(x)},${n(-y)}`).join(' ');
      return `<polygon points="${pts}" fill="${color}" stroke="none"/>`;
    }
  }
}

export function renderSvg(drawing: Drawing, opts: SvgOptions = {}): string {
  const dark = opts.background === 'dark';
  const sheet = opts.sheetIndex !== undefined ? drawing.sheets[opts.sheetIndex] : undefined;
  const scale = sheet ? sheet.scale : 50;

  let vx: number;
  let vy: number;
  let vw: number;
  let vh: number;
  if (sheet) {
    vw = sheet.paperWidthMm * sheet.scale;
    vh = sheet.paperHeightMm * sheet.scale;
    vx = sheet.originX;
    vy = -(sheet.originY + vh);
  } else {
    const bb = entitiesBBox(drawing.entities);
    const w = Math.max(bb.maxX - bb.minX, 1);
    const h = Math.max(bb.maxY - bb.minY, 1);
    const pad = 0.03 * Math.max(w, h);
    vx = bb.minX - pad;
    vy = -(bb.maxY + pad);
    vw = w + 2 * pad;
    vh = h + 2 * pad;
  }

  const bg = dark ? '#1e1e1e' : '#ffffff';
  const sizeAttr = opts.widthPx && opts.widthPx > 0 ? ` width="${n(opts.widthPx)}" height="${n((opts.widthPx * vh) / vw)}"` : '';
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vx)} ${n(vy)} ${n(vw)} ${n(vh)}"${sizeAttr} preserveAspectRatio="xMidYMid meet">`
  );
  parts.push(`<title>${esc(drawing.title)}</title>`);
  parts.push(`<rect x="${n(vx)}" y="${n(vy)}" width="${n(vw)}" height="${n(vh)}" fill="${bg}"/>`);

  const layers: LayerDef[] = drawing.layers.slice();
  const names = new Set(layers.map((l) => l.name));
  for (const e of drawing.entities) {
    if (!names.has(e.layer)) {
      names.add(e.layer);
      layers.push({ name: e.layer, color: 7, linetype: 'CONTINUOUS', lineweightMm: 0.25, description: '' });
    }
  }
  for (const l of layers) {
    const ents = drawing.entities.filter((e) => e.layer === l.name);
    if (ents.length === 0) continue;
    const color = aciColor(l.color, dark);
    const dash = DASH[l.linetype].map((d) => n(d * scale * 0.5)).join(' ');
    parts.push(
      `<g data-layer="${esc(l.name)}" stroke="${color}" stroke-width="${n(l.lineweightMm * scale)}" fill="none" stroke-linecap="butt" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}>`
    );
    for (const e of ents) parts.push(entitySvg(e, color));
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('\n');
}
