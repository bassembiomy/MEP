import type { DxfEntity, BoundingBox } from '../store/projectStore';
import { getCadEntityBounds, transformCadEntity, validateCadEntity } from './cad/nativeGeometry';
import type { CadAffineMatrix } from './cad/nativeGeometry';
import type { CadBlockReference } from './cad/semanticTypes';
import { dxfTextJustification, mtextAttachment, storedJustification } from './cad/textJustification';
import type { TextHAlign, TextVAlign } from './cad/textJustification';
import { describeInsertTransform, insertTransformHasShear } from './cad/blockReferences';

export interface CadImportDiagnostic {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  entityType?: string;
  handle?: string;
}

export interface ParsedDxf {
  entities: DxfEntity[];
  bbox: BoundingBox;
  insUnits?: number;
  cadUnit?: 'mm' | 'cm' | 'm' | 'in' | 'ft';
  suggestedScaleImperial?: number;
  suggestedScaleMetric?: number;
  diagnostics?: CadImportDiagnostic[];
  unitsConfidence?: 'declared' | 'estimated' | 'unknown';
  /** $MEASUREMENT header value (0 imperial, 1 metric): secondary evidence only, never selects units. */
  measurement?: 0 | 1;
  /** Layers frozen (group 70 bit 1) or switched off (negative colour) in the source: imported, but hidden by default. */
  hiddenLayers?: string[];
  /** INSERTs kept as semantic objects (their exploded children still appear in `entities`). */
  blockReferences?: CadBlockReference[];
}

// Standard AutoCAD Color Index (ACI 1-9 & common palette) to HEX colors
export function aciToHexColor(aci: number): string {
  const aciMap: Record<number, string> = {
    1: '#ef4444', // Red
    2: '#eab308', // Yellow
    3: '#22c55e', // Green
    4: '#06b6d4', // Cyan
    5: '#3b82f6', // Blue
    6: '#d946ef', // Magenta
    7: '#f8fafc', // White / Light
    8: '#64748b', // Dark Gray
    9: '#cbd5e1', // Light Gray
  };

  if (aciMap[aci]) return aciMap[aci];
  if (aci >= 10 && aci <= 249) {
    // Generate harmonious RGB for other standard AutoCAD color indexes
    const hue = Math.round(((aci - 10) / 240) * 360);
    return `hsl(${hue}, 70%, 60%)`;
  }
  return '#94a3b8';
}

// Standard AutoCAD $INSUNITS codes mapped to drawing units and canvas scale
// (units per foot / units per meter). Shared by DXF and DWG import paths.
export function cadUnitsFromInsUnits(
  insUnits?: number
): { cadUnit: 'mm' | 'cm' | 'm' | 'in' | 'ft'; suggestedScaleImperial: number; suggestedScaleMetric: number } | null {
  switch (insUnits) {
    case 4:
      return { cadUnit: 'mm', suggestedScaleImperial: 304.8, suggestedScaleMetric: 1000 };
    case 1:
      return { cadUnit: 'in', suggestedScaleImperial: 12, suggestedScaleMetric: 1 / 0.0254 };
    case 6:
      return { cadUnit: 'm', suggestedScaleImperial: 0.3048, suggestedScaleMetric: 1 };
    case 5:
      return { cadUnit: 'cm', suggestedScaleImperial: 30.48, suggestedScaleMetric: 100 };
    case 2:
      return { cadUnit: 'ft', suggestedScaleImperial: 1, suggestedScaleMetric: 1 / 0.3048 };
    default:
      return null;
  }
}

/**
 * Heuristic drawing-unit detection from the largest bounding-box span when the
 * file does not declare $INSUNITS. Architectural floor plans are overwhelmingly
 * millimeter-based, so spans of 1000+ drawing units are treated as millimeters
 * (a 250-1999 span is far more likely a single-room mm plan than an inch detail).
 */
export function suggestCadUnitsFromSpan(maxSpan: number): {
  cadUnit: 'mm' | 'cm' | 'm' | 'in' | 'ft';
  suggestedScaleImperial: number;
  suggestedScaleMetric: number;
} {
  if (maxSpan >= 1000) {
    // Millimeters: typical building plans span 1000 to 100000 mm
    return { cadUnit: 'mm', suggestedScaleImperial: 304.8, suggestedScaleMetric: 1000 };
  } else if (maxSpan >= 250) {
    // Inches: typical small imperial details span 300 to 1000 inches
    return { cadUnit: 'in', suggestedScaleImperial: 12, suggestedScaleMetric: 1 / 0.0254 };
  } else if (maxSpan >= 10) {
    // Feet or screen pixels
    return { cadUnit: 'ft', suggestedScaleImperial: 1, suggestedScaleMetric: 1 / 0.3048 };
  }
  // Default screen scale
  return { cadUnit: 'ft', suggestedScaleImperial: 10, suggestedScaleMetric: 32.8 };
}

export type CadKnownUnit = 'mm' | 'cm' | 'dm' | 'm' | 'in' | 'ft' | 'yd';
const FEET_PER_UNIT: Record<CadKnownUnit, number> = {
  mm: 0.001 / 0.3048, cm: 0.01 / 0.3048, dm: 0.1 / 0.3048, m: 1 / 0.3048, in: 1 / 12, ft: 1, yd: 3
};

/** Drawing units per metre from drawing units per foot (project.scale is units per METRE in metric projects). */
export function unitsPerFootToUnitsPerMetre(unitsPerFoot: number): number {
  return unitsPerFoot / 0.3048;
}

/**
 * Drawing units per FOOT from two picked points and the real-world length between them.
 * NOTE: this is per foot, whereas project.scale means units per METRE in metric projects. Callers that
 * store the result for a metric project must convert it with unitsPerFootToUnitsPerMetre().
 * (cadUnitsFromInsUnits' suggestedScaleImperial is per foot and suggestedScaleMetric is per metre.)
 * Throws RangeError for non-finite input, coincident points, or a non-positive/unknown length or unit,
 * so a bad pick can never produce a silent scale.
 */
export function calibrateDrawingScale(
  p1: { x: number; y: number }, p2: { x: number; y: number }, knownLength: number, knownUnit: CadKnownUnit
): number {
  if (![p1?.x, p1?.y, p2?.x, p2?.y, knownLength].every(Number.isFinite)) throw new RangeError('Calibration points and length must be finite numbers.');
  if (!(knownLength > 0)) throw new RangeError('Known length must be greater than zero.');
  const feetPerUnit = FEET_PER_UNIT[knownUnit];
  if (!feetPerUnit) throw new RangeError(`Unsupported calibration unit ${String(knownUnit)}.`);
  const drawn = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (!(drawn > 0)) throw new RangeError('Calibration points must not coincide.');
  const result = drawn / (knownLength * feetPerUnit);
  if (!Number.isFinite(result) || result <= 0) throw new RangeError('Calibration produced a non-finite scale.');
  return result;
}

/**
 * Shared DXF/DWG unit resolution. $INSUNITS 0 (unspecified) or an unmapped code is 'unknown': the
 * span-based cadUnit/scale are returned only as a suggestion and a diagnostic says so. A missing
 * $INSUNITS stays 'estimated'. 10 (yards) and 14 (decimetres) are deliberately unmapped because
 * the cadUnit union (store type) has no yd/dm member; they surface as 'units-unmapped'.
 * $MEASUREMENT is secondary evidence: it only produces a warning when it contradicts the units.
 * Declared units that give extents over 2 km or a largest closed polyline under 1 ft2 get a
 * 'declared-implausible' warning (confidence stays 'declared').
 * Callers MUST NOT auto-confirm units while a 'declared-implausible' or 'units-measurement-conflict'
 * diagnostic exists, even when unitsConfidence is 'declared': the user has to confirm them explicitly.
 */
export function resolveCadUnits(input: {
  insUnits?: number; measurement?: number; entities: DxfEntity[]; bbox: BoundingBox
}): {
  suggestion: { cadUnit: 'mm' | 'cm' | 'm' | 'in' | 'ft'; suggestedScaleImperial: number; suggestedScaleMetric: number };
  unitsConfidence: 'declared' | 'estimated' | 'unknown';
  diagnostics: CadImportDiagnostic[];
} {
  const { insUnits, measurement, entities, bbox } = input;
  const diagnostics: CadImportDiagnostic[] = [];
  const declared = cadUnitsFromInsUnits(insUnits);
  const suggestion = declared ?? suggestCadUnitsFromSpan(Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY));
  let unitsConfidence: 'declared' | 'estimated' | 'unknown';
  if (declared) unitsConfidence = 'declared';
  else if (insUnits === undefined) unitsConfidence = entities.length ? 'estimated' : 'unknown';
  else unitsConfidence = 'unknown';
  if (!declared && entities.length) {
    if (insUnits === undefined || insUnits === 0)
      diagnostics.push({ code: 'units-unspecified', severity: 'warning', message: `${insUnits === 0 ? '$INSUNITS is 0 (unspecified)' : 'No $INSUNITS is declared'}; units (${suggestion.cadUnit}) are a guess from the drawing extents and must be confirmed.` });
    else diagnostics.push({ code: 'units-unmapped', severity: 'warning', message: `$INSUNITS code ${insUnits} is not a supported drawing unit; units (${suggestion.cadUnit}) are a guess from the drawing extents and must be confirmed.` });
  }
  if (measurement === 0 || measurement === 1) {
    const metric = ['mm', 'cm', 'm'].includes(suggestion.cadUnit);
    const basis = unitsConfidence === 'declared' ? 'declared' : unitsConfidence === 'estimated' ? 'estimated' : 'unconfirmed (guessed from the drawing extents)';
    if ((measurement === 1) !== metric)
      diagnostics.push({ code: 'units-measurement-conflict', severity: 'warning', message: `$MEASUREMENT says ${measurement === 1 ? 'metric' : 'imperial'} but the ${basis} units are ${suggestion.cadUnit}. Confirm the drawing units.` });
  }
  if (declared && entities.length) {
    const spanM = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) / suggestion.suggestedScaleMetric;
    let largestFt2 = -1;
    for (const e of entities) {
      if ((e.type !== 'LWPOLYLINE' && e.type !== 'POLYLINE') || !e.closed || !e.points || e.points.length < 6) continue;
      let sum = 0;
      for (let i = 0; i < e.points.length; i += 2) {
        const j = (i + 2) % e.points.length;
        sum += e.points[i] * e.points[j + 1] - e.points[j] * e.points[i + 1];
      }
      largestFt2 = Math.max(largestFt2, Math.abs(sum / 2) / (suggestion.suggestedScaleImperial ** 2));
    }
    if (spanM > 2000) diagnostics.push({ code: 'declared-implausible', severity: 'warning', message: `Declared ${suggestion.cadUnit} units make the drawing ${(spanM / 1000).toFixed(1)} km across; check the units.` });
    else if (largestFt2 >= 0 && largestFt2 < 1) diagnostics.push({ code: 'declared-implausible', severity: 'warning', message: `Declared ${suggestion.cadUnit} units make the largest closed outline only ${largestFt2.toFixed(2)} ft2; check the units.` });
  }
  return { suggestion, unitsConfidence, diagnostics };
}

interface DxfPair { code: number; value: string }
interface DxfRecord { type: string; pairs: DxfPair[] }
interface DxfBlock { baseX: number; baseY: number; baseZ: number; records: DxfRecord[]; /** Path of an external reference (BLOCK flag 4); its geometry lives in another file. */ xrefPath?: string }
const first = (r: DxfRecord, code: number) => r.pairs.find(p => p.code === code)?.value;
const number = (r: DxfRecord, code: number, fallback = NaN) => {
  const value = first(r, code);
  return value === undefined ? fallback : value.trim() === '' ? NaN : Number(value);
};
const identity: CadAffineMatrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
function compose(p: CadAffineMatrix, q: CadAffineMatrix): CadAffineMatrix {
  return { a: p.a * q.a + p.c * q.b, b: p.b * q.a + p.d * q.b,
    c: p.a * q.c + p.c * q.d, d: p.b * q.c + p.d * q.d,
    tx: p.a * q.tx + p.c * q.ty + p.tx, ty: p.b * q.tx + p.d * q.ty + p.ty };
}

const BINARY_DXF_SENTINEL = 'AutoCAD Binary DXF';
/**
 * DXF line terminator as written by any platform: LF, CRLF (also the doubly converted CR CR LF, whose extra CR is
 * trailing whitespace), or - only in a file with no LF at all - a bare CR (classic Mac).
 */
const eolSource = (text: string): string => (text.includes('\n') ? '\\r*\\n' : '\\r');
const splitLines = (text: string): string[] => text.split(text.includes('\n') ? /\r*\n/ : /\r/);
const CODEPAGE_LABELS: Record<string, string> = {
  ANSI_874: 'windows-874', ANSI_932: 'shift_jis', ANSI_936: 'gbk', ANSI_949: 'euc-kr', ANSI_950: 'big5',
  ANSI_1250: 'windows-1250', ANSI_1251: 'windows-1251', ANSI_1252: 'windows-1252', ANSI_1253: 'windows-1253',
  ANSI_1254: 'windows-1254', ANSI_1255: 'windows-1255', ANSI_1256: 'windows-1256', ANSI_1257: 'windows-1257',
  ANSI_1258: 'windows-1258'
};

/**
 * Decodes the bytes of a DXF file. DXF R2007+ (AC1021 and later) is UTF-8 unless the bytes are not valid UTF-8 (then the code page applies); older files use the ANSI code page
 * named by $DWGCODEPAGE (windows-1252 when absent or unknown). A file without $ACADVER is read as UTF-8 and, only if
 * those bytes are not valid UTF-8, as windows-1252. A UTF-8 BOM always means UTF-8. Never throws on bad text bytes; throws only for a Binary DXF (sentinel "AutoCAD Binary DXF"), which has no reader.
 */
export function decodeDxfBytes(bytes: Uint8Array): string {
  // Binary DXF starts with the 22-byte sentinel "AutoCAD Binary DXF\r\n\x1a\0"; read as text it would be garbage with no diagnostic.
  if (bytes.length >= 18 && String.fromCharCode(...bytes.subarray(0, 18)) === BINARY_DXF_SENTINEL)
    throw new Error('Binary DXF is not supported. Save the drawing as an ASCII DXF (or as DWG) and import it again.');
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes);
  // The header is ASCII in every encoding handled here, so a byte-preserving latin1 view of its start is safe to scan.
  const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const EOL = eolSource(head);
  const headerValue = (variable: string, code: number): string | undefined =>
    new RegExp(`${EOL}\\s*9${EOL}${variable.replace('$', '\\$')}${EOL}\\s*${code}${EOL}([^\\r\\n]*)`, 'i').exec(head)?.[1].trim();
  const version = /^AC(\d{4})$/i.exec(headerValue('$ACADVER', 1) ?? '')?.[1];
  if (version === undefined) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
  }
  // AC1021+ is UTF-8; but a file that is not valid UTF-8 (a code-page file with a newer version stamp) uses the code page.
  if (Number(version) >= 1021) { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* fall through to the code page */ } }
  const label = CODEPAGE_LABELS[(headerValue('$DWGCODEPAGE', 3) ?? '').toUpperCase()] ?? 'windows-1252';
  try { return new TextDecoder(label).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
}

/** Decodes the `\U+XXXX` unicode escapes used by DXF R2004 and earlier for characters outside the code page. */
const decodeUnicodeEscapes = (text: string): string =>
  // One pass; a double backslash is consumed as an escaped backslash so an escape right after it (e.g. `\\U+0041` in the DXF text) stays literal.
  text.replace(/\\\\|\\U\+([0-9A-Fa-f]{4})|\\M\+([1-4])([0-9A-Fa-f]{4})/g, (whole, u: string | undefined, page: string | undefined, hex: string | undefined) => {
    if (u) return String.fromCharCode(parseInt(u, 16));
    if (!page || !hex) return whole;
    try { return new TextDecoder(MULTIBYTE_PAGES[page], { fatal: true }).decode(Uint8Array.from([parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2), 16)])); } catch { return whole; }
  });

/**
 * MTEXT `\M+nXXXX` (n = 1..4) is a double-byte character of a legacy code page: 1 Shift-JIS, 2 Big5, 3 EUC-KR (cp949), 4 GBK.
 * n = 5 (Johab) has no WHATWG decoder and, like a malformed escape, is left as written.
 */
const MULTIBYTE_PAGES: Record<string, string> = { 1: 'shift_jis', 2: 'big5', 3: 'euc-kr', 4: 'gbk' };

const SPLINE_SAMPLES_PER_SPAN = 16, SPLINE_MAX_POINTS = 1024;

/**
 * Samples a SPLINE record as a polyline (DXF coordinates, Y up). B-splines (control points + knots, optional
 * weights) are evaluated exactly with de Boor's algorithm; a spline stored only with fit points is approximated by a
 * uniform Catmull-Rom curve through them. Returns undefined when the record has neither usable form.
 */
function sampleSpline(r: DxfRecord): { points: number[]; closed: boolean; how: string } | undefined {
  const flags = number(r, 70, 0), closed = Number.isInteger(flags) && (flags & 1) !== 0;
  const collect = (xCode: number, yCode: number): [number, number][] => {
    const out: [number, number][] = [];
    for (const p of r.pairs) {
      if (p.code === xCode) out.push([Number(p.value), NaN]);
      else if (p.code === yCode && out.length) out[out.length - 1][1] = Number(p.value);
    }
    return out;
  };
  return sampleSplineData({
    closed, degree: number(r, 71, 3), control: collect(10, 20), fit: collect(11, 21),
    knots: r.pairs.filter(p => p.code === 40).map(p => Number(p.value)),
    weights: r.pairs.filter(p => p.code === 41).map(p => Number(p.value))
  });
}

/** Sampling shared by the DXF and DWG importers (DXF coordinates, Y up). */
export function sampleSplineData(spline: { closed: boolean; degree: number; control: [number, number][]; fit: [number, number][]; knots: number[]; weights: number[] }): { points: number[]; closed: boolean; how: string } | undefined {
  const { closed, degree, control, fit, knots, weights } = spline;
  const finite = (pts: [number, number][]) => pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = control.length;
  if (n >= 2 && Number.isInteger(degree) && degree >= 1 && degree < n && finite(control) && knots.length === n + degree + 1
    && knots.every((k, i) => Number.isFinite(k) && (i === 0 || k >= knots[i - 1])) && knots[n] > knots[degree]
    && (weights.length === 0 || (weights.length === n && weights.every(w => Number.isFinite(w) && w > 0)))) {
    const w = weights.length ? weights : control.map(() => 1);
    const spans = n - degree, count = Math.min(SPLINE_MAX_POINTS, spans * SPLINE_SAMPLES_PER_SPAN + 1);
    const lo = knots[degree], hi = knots[n], points: number[] = [];
    for (let i = 0; i < count; i++) {
      const t = i === count - 1 ? hi : lo + (hi - lo) * i / (count - 1);
      let k = degree;
      while (k < n - 1 && t >= knots[k + 1]) k++;
      const d: number[][] = []; // homogeneous control points of the active span
      for (let j = 0; j <= degree; j++) { const c = k - degree + j; d.push([control[c][0] * w[c], control[c][1] * w[c], w[c]]); }
      for (let rr = 1; rr <= degree; rr++)
        for (let j = degree; j >= rr; j--) {
          const den = knots[j + 1 + k - rr] - knots[j + k - degree];
          const a = den === 0 ? 0 : (t - knots[j + k - degree]) / den;
          for (let c = 0; c < 3; c++) d[j][c] = (1 - a) * d[j - 1][c] + a * d[j][c];
        }
      points.push(d[degree][0] / d[degree][2], d[degree][1] / d[degree][2]);
    }
    return { points, closed, how: 'control points and knots' };
  }
  if (fit.length >= 2 && finite(fit)) {
    const pts = fit, m = pts.length, points: number[] = [];
    const at = (i: number) => closed ? pts[((i % m) + m) % m] : pts[Math.max(0, Math.min(m - 1, i))];
    const segs = closed ? m : m - 1, per = Math.max(2, Math.min(SPLINE_SAMPLES_PER_SPAN / 2, Math.floor(SPLINE_MAX_POINTS / segs)));
    for (let i = 0; i < segs; i++)
      for (let j = 0; j < per; j++) {
        const t = j / per, t2 = t * t, t3 = t2 * t, p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        points.push(0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3));
      }
    if (!closed) points.push(pts[m - 1][0], pts[m - 1][1]);
    return { points, closed, how: 'fit points (Catmull-Rom through them)' };
  }
  return undefined;
}

/**
 * Sets the justified anchor (x, y: internal Y-down frame, before the INSERT matrix) and textHAlign / textVAlign on a
 * TEXT / ATTRIB / ATTDEF / MTEXT entity whose group 10 has already been stored in x, y. See cad/textJustification.ts.
 * Vertical justification is group 73 on TEXT but 74 on ATTRIB / ATTDEF (73 there is the field length); MTEXT uses group
 * 71 about group 10 (its 11/21 is a direction vector and 72/73 are flow / spacing, not justification).
 */
function applyTextJustification(ent: DxfEntity, r: DxfRecord, diagnose: (code: string, message: string, r?: DxfRecord, severity?: 'warning' | 'error') => void): void {
  let hAlign: TextHAlign = 'left', vAlign: TextVAlign = ent.type === 'MTEXT' ? 'top' : 'baseline';
  if (r.type === 'MTEXT') {
    if (first(r, 71) !== undefined) {
      const a = mtextAttachment(number(r, 71));
      if (a) ({ hAlign, vAlign } = a);
      else diagnose('TEXT_JUSTIFICATION_UNSUPPORTED', `MTEXT attachment point ${first(r, 71)?.trim()} is not 1..9; top-left used.`, r);
    }
  } else {
    const attribute = r.type === 'ATTRIB' || r.type === 'ATTDEF';
    const j = dxfTextJustification(number(r, 72, 0), number(r, attribute ? 74 : 73, 0));
    if (j.invalid) diagnose('TEXT_JUSTIFICATION_UNSUPPORTED', `${r.type} justification (72=${first(r, 72)?.trim() ?? 0}, ${attribute ? 74 : 73}=${first(r, attribute ? 74 : 73)?.trim() ?? 0}) is not supported; left/baseline at the insertion point used.`, r);
    else if (j.anchor !== 'p10') {
      const x11 = first(r, 11) === undefined ? NaN : number(r, 11), y11 = first(r, 21) === undefined ? NaN : -number(r, 21);
      if (Number.isFinite(x11) && Number.isFinite(y11)) {
        ({ hAlign, vAlign } = j);
        // Aligned / fit: the midpoint of the two baseline points (lossy: the fitted width and 10 -> 11 direction are not kept).
        if (j.anchor === 'p11') { ent.x = x11; ent.y = y11; } else { ent.x = (ent.x! + x11) / 2; ent.y = (ent.y! + y11) / 2; }
      } else diagnose('TEXT_ALIGNMENT_POINT_MISSING', `${r.type} is justified but has no usable alignment point (group 11/21); left/baseline at the insertion point used.`, r);
    }
  }
  Object.assign(ent, storedJustification(ent.type, hAlign, vAlign));
}

const MLINE_MITER = 2, MLINE_START_SQUARE = 16, MLINE_START_ARCS = 32 | 64, MLINE_END_SQUARE = 256, MLINE_END_ARCS = 512 | 1024;

/**
 * Explodes an MLINE into LINEs (raw DXF Y-up coordinates flipped to the canvas frame like every other entity). The vertices carry
 * the FINAL geometry (scale, justification and miter stretch are already in the element offsets): element k of segment i runs from
 * `vertex_i + miter_i * offset_k` to the same point of the next vertex (and from the last back to the first when closed).
 * The MLINESTYLE (when found) adds the square start/end cap lines and, with the "display miters" flag, a line across every joint,
 * exactly as ezdxf's MLine.virtual_entities() does. Round / inner-arc caps and the fill are not drawn (arc caps raise a warning).
 */
function explodeMline(
  r: DxfRecord, base: DxfEntity, style: { flags: number; offsets: number[] } | undefined,
  diagnose: (code: string, message: string, r?: DxfRecord, severity?: 'warning' | 'error') => void
): DxfEntity[] | undefined {
  const vertices: { x: number; y: number; mx: number; my: number; offsets: number[] }[] = [];
  const elementCount = number(r, 73, NaN), declared = number(r, 72, NaN), closed = (number(r, 71, 0) & 2) !== 0;
  let vertex: (typeof vertices)[number] | undefined, remaining = 0, firstParam = false;
  for (const p of r.pairs) {
    const v = p.value.trim() === '' ? NaN : Number(p.value);
    if (p.code === 11) { vertex = { x: v, y: NaN, mx: NaN, my: NaN, offsets: [] }; vertices.push(vertex); remaining = 0; }
    else if (!vertex) continue;
    else if (p.code === 21) vertex.y = v;
    else if (p.code === 13) vertex.mx = v;
    else if (p.code === 23) vertex.my = v;
    else if (p.code === 74) { remaining = v; firstParam = true; if (!(v > 0)) vertex.offsets.push(0); }
    else if (p.code === 41 && remaining > 0) { if (firstParam) vertex.offsets.push(v); firstParam = false; remaining--; }
  }
  const finite = (n: number) => Number.isFinite(n);
  if (!Number.isInteger(elementCount) || elementCount < 1 || vertices.length !== declared || vertices.length < 2 ||
    vertices.some(v => ![v.x, v.y, v.mx, v.my].every(finite) || v.offsets.length !== elementCount || !v.offsets.every(finite))) {
    diagnose('MALFORMED_MLINE', 'MLINE vertices, miter directions or element offsets are missing or inconsistent; entity omitted.', r, 'error');
    return undefined;
  }
  const miterPoints = vertices.map(v => v.offsets.map(o => ({ x: v.x + v.mx * o, y: -(v.y + v.my * o) })));
  if (closed) miterPoints.push(miterPoints[0]);
  const parts: DxfEntity[] = [];
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const k = parts.length;
    parts.push({ ...base, type: 'LINE', x: a.x, y: a.y, points: [b.x, b.y], ...(base.handle ? { handle: `${base.handle}:${k}` } : {}) });
  };
  for (let i = 1; i < miterPoints.length; i++) for (let e = 0; e < elementCount; e++) line(miterPoints[i - 1][e], miterPoints[i][e]);
  const flags = style && style.offsets.length === elementCount ? style.flags : 0;
  if (flags) {
    const bottom = style!.offsets.indexOf(Math.min(...style!.offsets)), top = style!.offsets.indexOf(Math.max(...style!.offsets));
    // A cap / joint line runs from the outermost element to the middle of the two outermost elements and on to the other one.
    const across = (m: { x: number; y: number }[]) => {
      const mid = { x: (m[top].x + m[bottom].x) / 2, y: (m[top].y + m[bottom].y) / 2 };
      line(m[top], mid); line(m[bottom], mid);
    };
    if (!closed && (flags & MLINE_START_SQUARE)) across(miterPoints[0]);
    if (flags & MLINE_MITER) for (let i = closed ? 0 : 1; i < miterPoints.length - 1; i++) across(miterPoints[i]);
    if (!closed && (flags & MLINE_END_SQUARE)) across(miterPoints[miterPoints.length - 1]);
    if (!closed && (flags & (MLINE_START_ARCS | MLINE_END_ARCS)))
      diagnose('MLINE_CAP_OMITTED', 'MLINE round / inner-arc end caps are not drawn; the element lines are imported.', r);
  }
  return parts;
}

/** Parses DXF records before resolving INSERTs. Empty values never shift code/value pairs. */
export function parseDxfText(dxfText: string): ParsedDxf {
  const diagnostics: CadImportDiagnostic[] = [], entities: DxfEntity[] = [], blockReferences: CadBlockReference[] = [];
  const diagnose = (code: string, message: string, r?: DxfRecord, severity: 'warning' | 'error' = 'warning') => {
    if (diagnostics.length < 1000) diagnostics.push({ code, message, severity, entityType: r?.type, handle: r && first(r, 5) });
    else if (diagnostics.length === 1000) diagnostics.push({ code: 'DIAGNOSTIC_LIMIT', severity: 'error', message: 'Additional import diagnostics suppressed; drawing is incomplete.' });
  };
  const lines = splitLines(dxfText.replace(/^\uFEFF/, '').replace(/^(?:[^\S\r\n]*(?:\r*\n|\r))+/, ''));
  // Some producers prefix the file with whitespace outside the DXF pair stream.
  if (lines.length % 2 === 1 && lines.at(-1)?.trim()) diagnose('INCOMPLETE_PAIR', 'Final DXF group code has no value.', undefined, 'error');
  const sections = new Map<string, DxfRecord[]>();
  let record: DxfRecord | undefined, section = '', insUnits: number | undefined, measurement: 0 | 1 | undefined, headerVar = '', sectionOpen=false, sawEof=false;
  const maxPairs = 2_000_000;
  if (lines.length > maxPairs * 2) diagnose('PAIR_LIMIT', 'DXF exceeds the supported pair count; remaining data omitted.', undefined, 'error');
  for (let i = 0; i + 1 < Math.min(lines.length, maxPairs * 2); i += 2) {
    const rawCode = lines[i].trim(), value = lines[i + 1];
    if (!/^\d+$/.test(rawCode)) { diagnose('MALFORMED_PAIR', `Invalid DXF group code at line ${i + 1}.`, undefined, 'error'); continue; }
    const code = Number(rawCode);
    if (code === 0) {
      const type = value.trim().toUpperCase();
      if(type==='SECTION') {
        if(sectionOpen) diagnose('INCOMPLETE_SECTION','Previous DXF section was not terminated.',undefined,'error');
        sectionOpen=true;
      }
      if(type==='ENDSEC') sectionOpen=false;
      if(type==='EOF') {sawEof=true;if(sectionOpen) diagnose('INCOMPLETE_SECTION','DXF section was not terminated before EOF.',undefined,'error');}
      record = { type, pairs: [] };
      if (type === 'ENDSEC' || type === 'EOF') section = '';
      else if (type !== 'SECTION' && section) sections.get(section)!.push(record);
    } else {
      if (record?.type === 'SECTION' && code === 2 && record.pairs.every(q => q.code === 999)) { // 999 comments may precede the name
        section = value.trim().toUpperCase();
        if (!sections.has(section)) sections.set(section, []);
      }
      record?.pairs.push({ code, value });
      if (section === 'HEADER') {
        if (code === 9) headerVar = value.trim();
        if (code === 70 && headerVar === '$INSUNITS' && Number.isInteger(Number(value))) insUnits = Number(value);
        if (code === 70 && headerVar === '$MEASUREMENT' && (Number(value) === 0 || Number(value) === 1)) measurement = Number(value) as 0 | 1;
      }
    }
  }
  if(sectionOpen || !sawEof) diagnose('INCOMPLETE_DRAWING','Incomplete DXF stream: missing section termination or EOF.',undefined,'error');
  const color = (r: DxfRecord) => {
    const rgb = number(r, 420);
    if (Number.isInteger(rgb) && rgb >= 0 && rgb <= 0xffffff) return `#${rgb.toString(16).padStart(6, '0')}`;
    const aci = Math.abs(number(r, 62));
    return Number.isInteger(aci) && aci > 0 && aci < 256 ? aciToHexColor(aci) : undefined;
  };
  const layers = new Map<string, string | undefined>();
  // Layer names are case-insensitive in AutoCAD: an entity on 'walls' is on the table layer 'WALLS' (colour, frozen/off state, role).
  const layerCase = new Map<string, string>();
  const canonicalLayer = (name: string) => layerCase.get(name.toLowerCase()) ?? name;
  const hiddenLayers = new Set<string>(), frozenLayers = new Set<string>();
  for (const r of sections.get('TABLES') ?? []) if (r.type === 'LAYER') {
    const name = first(r, 2)?.trim() ?? '0';
    if (!layerCase.has(name.toLowerCase())) layerCase.set(name.toLowerCase(), name);
    layers.set(name, color(r));
    const frozen = (number(r, 70, 0) & 1) !== 0;
    if (frozen) frozenLayers.add(name);
    if (frozen || number(r, 62, 0) < 0) hiddenLayers.add(name);
  }
  // Anonymous dynamic-block references: the BLOCK_RECORD of '*U##' carries XDATA AcDbBlockRepBTag whose 1005 is the handle of the
  // real (named) dynamic block's record. Resolve it so INSERTs of '*U12' are known by the name of the block they stand for.
  const recordNames = new Map<string, string>();
  for (const r of sections.get('TABLES') ?? []) if (r.type === 'BLOCK_RECORD') {
    const h = first(r, 5)?.trim().toUpperCase(), n = first(r, 2)?.trim();
    if (h && n) recordNames.set(h, n);
  }
  const effectiveBlockNames = new Map<string, string>();
  for (const r of sections.get('TABLES') ?? []) if (r.type === 'BLOCK_RECORD') {
    const n = first(r, 2)?.trim();
    if (!n || !/^\*U\d*$/i.test(n)) continue;
    const at = r.pairs.findIndex(p => p.code === 1001 && p.value.trim() === 'AcDbBlockRepBTag');
    if (at < 0) continue;
    const target = r.pairs.slice(at + 1).find(p => p.code === 1005 || p.code === 1001);
    const real = target?.code === 1005 ? recordNames.get(target.value.trim().toUpperCase()) : undefined;
    if (real && real !== n) effectiveBlockNames.set(n, real);
  }
  const mlineStyles = new Map<string, { flags: number; offsets: number[] }>();
  for (const r of sections.get('OBJECTS') ?? []) if (r.type === 'MLINESTYLE')
    mlineStyles.set((first(r, 2) ?? '').trim().toUpperCase(), { flags: number(r, 70, 0), offsets: r.pairs.filter(p => p.code === 49).map(p => Number(p.value)) });
  const blocks = new Map<string, DxfBlock>();
  const duplicateBlocks = new Set<string>();
  let block: DxfBlock | undefined;
  let blockName: string | undefined;
  let blockRecord: DxfRecord | undefined;
  const incompleteBlock = () => {
    if (block) diagnose('INCOMPLETE_BLOCK', `Block ${blockName ?? '(unnamed)'} is missing ENDBLK; geometry omitted.`, blockRecord, 'error');
  };
  for (const r of sections.get('BLOCKS') ?? []) {
    if (r.type === 'BLOCK') {
      incompleteBlock();
      block = { baseX: number(r, 10, 0), baseY: -number(r, 20, 0), baseZ: number(r, 30, 0), records: [], ...((number(r, 70, 0) & 4) !== 0 ? { xrefPath: (first(r, 1) ?? '').trim() } : {}) };
      blockName = first(r, 2)?.trim(); blockRecord = r;
      if (!blockName) diagnose('MALFORMED_BLOCK', 'Block has no name.', r);
    } else if (r.type === 'ENDBLK') {
      if (block && blockName) {
        if (blocks.has(blockName) || duplicateBlocks.has(blockName)) {
          diagnose('DUPLICATE_BLOCK', `Duplicate block name ${blockName}; ambiguous geometry omitted.`, blockRecord, 'error');
          blocks.delete(blockName); duplicateBlocks.add(blockName);
        } else blocks.set(blockName, block);
      }
      block = undefined;
    }
    else if (block) block.records.push(r);
  }
  incompleteBlock();
  let visited = 0, expansionStopped = false, paperSpaceSkipped = 0;
  function expand(records: DxfRecord[], matrix: CadAffineMatrix, stack: string[], inheritedLayer = '0', inheritedColor?: string, insertHandle?: string, zScale = 1, zOffset = 0, frozenBy?: string) {
    // `frozenBy`: layer of the INNERMOST FROZEN ancestor INSERT. Freezing hides the whole reference, so children on a visible
    // layer are moved onto that layer (originalLayer keeps their own); children already on a hidden (frozen/off) layer keep it,
    // so showing the INSERT's layer never reveals content its own hidden layer should keep hidden. OFF only hides layer-0 children
    // (they inherit the INSERT's layer), which `inheritedLayer` already covers.
    // Elevation of a child at block-space Z `cz` is zScale * cz + zOffset (affine, composed per nested INSERT).
    for (let index = 0; index < records.length; index++) {
      const r = records[index];
      if (++visited > 100_000) {
        if (!expansionStopped) diagnose('ENTITY_LIMIT', 'Entity expansion exceeded 100000 records; drawing is incomplete.', r, 'error');
        expansionStopped = true; return;
      }
      // Top-level paper-space records (group 67 = 1) are layout content, not model geometry. Blocks are not filtered:
      // 67 is meaningless inside a block definition.
      if (stack.length === 0 && number(r, 67, 0) === 1) {
        paperSpaceSkipped++;
        // An INSERT with attributes (66 = 1) owns the ATTRIBs up to SEQEND that follow it, whether or not they repeat 67.
        if (r.type === 'INSERT' && number(r, 66, 0) === 1) while (index + 1 < records.length && (records[index + 1].type === 'ATTRIB' || records[index + 1].type === 'SEQEND')) { const t = records[++index].type; if (t === 'SEQEND') break; }
        if (r.type === 'POLYLINE') while (index + 1 < records.length && (records[index + 1].type === 'VERTEX' || records[index + 1].type === 'SEQEND')) { const t = records[++index].type; if (t === 'SEQEND') break; }
        continue;
      }
      const rawLayer = canonicalLayer(first(r, 8)?.trim() || '0'), ownLayer = rawLayer === '0' ? inheritedLayer : rawLayer, layer = frozenBy && !hiddenLayers.has(ownLayer) ? frozenBy : ownLayer;
      const aci = number(r, 62), ownColor = color(r) ?? (aci === 0 ? inheritedColor : layers.get(ownLayer));
      if (number(r, 39, 0) !== 0) { diagnose('UNSUPPORTED_THICKNESS', 'Volumetric entity thickness cannot be represented in the 2D drawing; entity omitted.', r); continue; }
      const nx = number(r, 210, 0), ny = number(r, 220, 0), nz = number(r, 230, 1);
      if (![nx, ny, nz].every(Number.isFinite) || Math.abs(nx) > 1e-10 || Math.abs(ny) > 1e-10 || Math.abs(Math.abs(nz) - 1) > 1e-10) {
        diagnose('UNSUPPORTED_EXTRUSION', 'Only planar +Z/-Z extrusion is supported; entity omitted.', r); continue;
      }
      // Planner decision: planar geometry at one constant non-zero Z is kept (projected onto the plan, `elevation`
      // recorded, ELEVATED_GEOMETRY_PROJECTED warning). Varying Z or tilted/3D data is still dropped.
      // Group 31 is a point Z (second point / alignment point) for LINE, TEXT and ATTRIB/ATTDEF and the vertex Z for MLINE
      // (start 10/20/30, vertex 11/21/31); for every other entity it is a direction vector component that must be 0.
      // MLINE direction (12/22/32) and miter (13/23/33) are vectors: their Z must be 0 and never feed the elevation.
      const zValues: number[] = []; let badZ = false;
      const secondPointZ = r.type === 'LINE' || r.type === 'TEXT' || r.type === 'ATTRIB' || r.type === 'ATTDEF' || r.type === 'MLINE';
      // Aligned text with a second point but no first Z has an implicit first Z of 0, which may differ.
      if (secondPointZ && r.type !== 'LINE' && first(r, 31) !== undefined && first(r, 30) === undefined) zValues.push(0);
      for (const p of r.pairs) {
        if (p.code === 30 || p.code === 38 || (p.code === 31 && secondPointZ)) {
          const z = p.value.trim() === '' ? NaN : Number(p.value);
          if (Number.isFinite(z)) zValues.push(z); else badZ = true;
        } else if ((p.code === 31 || (r.type === 'MLINE' && (p.code === 32 || p.code === 33))) && (!Number.isFinite(Number(p.value)) || Number(p.value) !== 0)) badZ = true;
      }
      const sameZ = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
      if (badZ || !zValues.every(z => sameZ(z, zValues[0]))) {
        diagnose('UNSUPPORTED_ELEVATION', 'Nonplanar geometry (varying Z) cannot be represented in the 2D drawing; entity omitted.', r); continue;
      }
      let ownZ = zValues[0] ?? 0;
      const reflected = nz < 0 && !['LINE', 'ELLIPSE', 'SPLINE', 'MLINE'].includes(r.type);
      const ocs: CadAffineMatrix = reflected ? { a: -1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } : identity;
      if (r.type === 'INSERT') {
        if (number(r, 70, 1) !== 1 || number(r, 71, 1) !== 1) { diagnose('UNSUPPORTED_INSERT_ARRAY', 'INSERT arrays are unsupported; entity omitted.', r); continue; }
        const name = first(r, 2)?.trim() ?? '', child = blocks.get(name);
        if (!child) { diagnose('MISSING_BLOCK', `INSERT references missing block ${name}.`, r, 'error'); continue; }
        // An external reference's geometry is in another file: its block definition is empty, so say so instead of importing nothing silently.
        if (child.xrefPath !== undefined) { diagnose('XREF_NOT_LOADED', `External reference ${name}${child.xrefPath ? ` (${child.xrefPath})` : ''} is not loaded; its geometry is not part of this drawing.`, r); continue; }
        if (stack.includes(name)) { diagnose('CYCLIC_BLOCK', `Cyclic block reference ${[...stack, name].join(' -> ')}.`, r, 'error'); continue; }
        if (stack.length >= 32) { diagnose('BLOCK_DEPTH_LIMIT', 'Nested block depth exceeded 32; remaining geometry omitted.', r, 'error'); continue; }
        const x = number(r, 10, 0), y = -number(r, 20, 0), sx = number(r, 41, 1), sy = number(r, 42, 1), sz = number(r, 43, 1), theta = number(r, 50, 0) * Math.PI / 180;
        if (![x, y, sx, sy, sz, theta, child.baseX, child.baseY, child.baseZ, ownZ].every(Number.isFinite) || sx === 0 || sy === 0 || sz === 0) { diagnose('MALFORMED_INSERT', 'INSERT has invalid base, scale, rotation or insertion coordinates.', r, 'error'); continue; }
        const cs = Math.cos(theta), sn = Math.sin(theta);
        const local = { a: cs * sx, b: -sn * sx, c: sn * sy, d: cs * sy, tx: x, ty: y };
        local.tx -= local.a * child.baseX + local.c * child.baseY;
        local.ty -= local.b * child.baseX + local.d * child.baseY;
        const composed = compose(matrix, compose(ocs, local)), childStart = entities.length;
        if (insertTransformHasShear(composed)) diagnose('INSERT_SHEARED', `INSERT ${name} is sheared (non-uniform scale combined with a rotated nested insert); its geometry is transformed exactly but the block reference reports rotation and scale only.`, r);
        // Child Z in the INSERT's OCS is ownZ + sz * (childZ - baseZ); a -Z extrusion maps OCS Z to world -Z.
        const nzSign = reflected ? -1 : 1;
        const insertWorldZ = zScale * nzSign * ownZ + zOffset;
        if (insertWorldZ !== 0 || child.baseZ !== 0) diagnose('ELEVATED_GEOMETRY_PROJECTED', `INSERT ${name} at elevation ${insertWorldZ}${child.baseZ !== 0 ? ` (block base Z ${child.baseZ})` : ''}; its geometry is projected onto the plan and keeps its elevation.`, r);
        expand(child.records, composed, [...stack, name], layer, ownColor ?? inheritedColor, first(r, 5)?.trim() ?? insertHandle,
          zScale * nzSign * sz, zScale * nzSign * (ownZ - sz * child.baseZ) + zOffset, frozenLayers.has(layer) ? layer : frozenBy);
        const placement = describeInsertTransform(composed, { x: child.baseX, y: child.baseY });
        const childBounds: BoundingBox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
        for (let k = childStart; k < entities.length; k++) {
          const b = getCadEntityBounds(entities[k]);
          childBounds.minX = Math.min(childBounds.minX, b.minX); childBounds.maxX = Math.max(childBounds.maxX, b.maxX);
          childBounds.minY = Math.min(childBounds.minY, b.minY); childBounds.maxY = Math.max(childBounds.maxY, b.maxY);
        }
        if (entities.length === childStart) Object.assign(childBounds, { minX: placement.insertion.x, maxX: placement.insertion.x, minY: placement.insertion.y, maxY: placement.insertion.y });
        blockReferences.push({ handle: first(r, 5)?.trim() ?? `INSERT:${[...stack, name].join('>')}:${index}`, name, ...(effectiveBlockNames.has(name) ? { effectiveName: effectiveBlockNames.get(name) } : {}), layer, ...placement, bounds: childBounds, entityRange: [childStart, entities.length], nestingDepth: stack.length });
        if (expansionStopped) return;
        continue;
      }
      let parts: DxfEntity[] | undefined;
      let ent: DxfEntity = { type: r.type as DxfEntity['type'], layer, color: ownColor, handle: first(r, 5)?.trim(), sourceHandle: first(r, 5)?.trim(), sourceBlock: stack.length ? (effectiveBlockNames.get(stack.at(-1)!) ?? stack.at(-1)) : undefined };
      if (stack.length && insertHandle) ent.handle = `${insertHandle}/${ent.sourceHandle ?? `${r.type}:${index}`}`;
      if (layer !== ownLayer) ent.originalLayer = ownLayer;
      switch (r.type) {
        case 'LINE':
          ent.x = number(r, 10); ent.y = -number(r, 20); ent.points = [number(r, 11), -number(r, 21)]; break;
        case 'POLYLINE':
        case 'LWPOLYLINE': {
          const flags = number(r, 70, 0);
          if (!Number.isInteger(flags) || (r.type === 'POLYLINE' && (flags & (2 | 4 | 8 | 16 | 64)))) { diagnose('UNSUPPORTED_POLYLINE', 'Fitted, spline, 3D/polyface or malformed polyline omitted.', r); continue; }
          ent.closed = (flags & 1) !== 0; ent.points = []; ent.bulges = [];
          if (r.type === 'POLYLINE') {
            let ended = false; const vertexZ: number[] = [];
            while (index + 1 < records.length) {
              const vertex = records[index + 1];
              if (vertex.type === 'SEQEND') { index++; ended = true; break; }
              if (vertex.type !== 'VERTEX') break;
              index++;
              ent.points.push(number(vertex, 10), -number(vertex, 20)); ent.bulges.push(number(vertex, 42, 0));
              if (first(vertex, 30) !== undefined) {
                const vz = number(vertex, 30, 0);
                if (!Number.isFinite(vz) || (number(vertex, 70, 0) & (1 | 8 | 16 | 32 | 64 | 128))) ent.points.push(NaN, NaN);
                else vertexZ.push(vz);
              } else if (number(vertex, 70, 0) & (1 | 8 | 16 | 32 | 64 | 128)) ent.points.push(NaN, NaN);
            }
            if (!ended) { diagnose('INCOMPLETE_POLYLINE', 'Legacy POLYLINE is missing SEQEND; entity omitted.', r, 'error'); continue; }
            // Vertex Z values (including 0) and the header elevation must all agree; a mix of 0 and 5 is varying Z.
            const polyZ = first(r, 30) !== undefined ? [ownZ, ...vertexZ] : vertexZ;
            if (!polyZ.every(z => sameZ(z, polyZ[0]))) { diagnose('UNSUPPORTED_ELEVATION', 'Nonplanar geometry (varying Z) cannot be represented in the 2D drawing; entity omitted.', r); continue; }
            if (polyZ.length) ownZ = polyZ[0];
          } else {
            let vx: number | undefined, vy: number | undefined, bulge = 0;
            const flush = () => { if (vx !== undefined) { ent.points!.push(vx, -(vy ?? NaN)); ent.bulges!.push(bulge); } };
            for (const p of r.pairs) {
              if (p.code === 10) { flush(); vx = p.value.trim() ? Number(p.value) : NaN; vy = undefined; bulge = 0; }
              if (p.code === 20) vy = p.value.trim() ? Number(p.value) : NaN;
              if (p.code === 42) bulge = p.value.trim() ? Number(p.value) : NaN;
            }
            flush();
            const count = number(r, 90, ent.points.length / 2);
            if (count !== ent.points.length / 2) { diagnose('INCOMPLETE_POLYLINE', 'Declared LWPOLYLINE vertex count differs from records; entity omitted.', r, 'error'); continue; }
          }
          break;
        }
        case 'CIRCLE':
        case 'ARC':
          ent.x = number(r, 10); ent.y = -number(r, 20); ent.radius = number(r, 40);
          if (r.type === 'ARC') { ent.startAngleDeg = number(r, 50); ent.endAngleDeg = number(r, 51); }
          break;
        case 'ELLIPSE': {
          const mx = number(r, 11), my = number(r, 21), ratio = number(r, 40);
          ent.x = number(r, 10); ent.y = -number(r, 20);
          ent.majorAxis = { x: mx, y: -my }; ent.minorAxis = { x: -my * ratio * nz, y: -mx * ratio * nz };
          ent.startParam = number(r, 41, 0); ent.endParam = number(r, 42, 2 * Math.PI);
          if (!(ratio > 0 && ratio <= 1) || number(r, 31, 0) !== 0) { diagnose('MALFORMED_ELLIPSE', 'Ellipse ratio or major axis is invalid.', r, 'error'); continue; }
          break;
        }
        case 'SPLINE': {
          const sampled = sampleSpline(r);
          if (!sampled) { diagnose('MALFORMED_SPLINE', 'SPLINE has no usable control points with knots, or fit points; source geometry omitted.', r, 'error'); continue; }
          ent.type = 'LWPOLYLINE'; ent.closed = sampled.closed; ent.points = []; ent.bulges = [];
          for (let k = 0; k < sampled.points.length; k += 2) { ent.points.push(sampled.points[k], -sampled.points[k + 1]); ent.bulges.push(0); }
          ent.geometryApproximation = `SPLINE sampled as a polyline from its ${sampled.how}; the curve is approximate`;
          break;
        }
        case 'MLINE': {
          // The vertices carry the FINAL geometry (scale, justification and miter stretch are already in the element offsets), so
          // each element is the polyline vertex + miter * offset; the style only adds cap and joint lines.
          const exploded = explodeMline(r, ent, mlineStyles.get((first(r, 2) ?? '').trim().toUpperCase()), diagnose);
          if (!exploded) continue;
          parts = exploded;
          break;
        }
        case 'SEQEND': continue; // terminator of an INSERT's attribute list; carries no geometry
        case 'ATTDEF':
        case 'ATTRIB': {
          // ATTDEF in a block is a template: its value is replaced by each INSERT's ATTRIB, so only constant
          // attributes (70 bit 2) carry real text. Invisible attributes (70 bit 1) are not drawn.
          const attFlags = number(r, 70, 0);
          if ((Number.isInteger(attFlags) && (attFlags & 1)) || (r.type === 'ATTDEF' && !(attFlags & 2))) continue;
          if (!(first(r, 1) ?? '').trim()) continue;
          ent.type = 'TEXT';
        }
        // falls through: an attribute is drawn exactly like single-line TEXT (position 10/20, height 40, rotation 50, value 1)
        case 'TEXT':
        case 'MTEXT':
          ent.x = number(r, 10); ent.y = -number(r, 20);
          applyTextJustification(ent, r, diagnose);
          // TEXT has only group 1; MTEXT splits long text into 3 chunks followed by 1. On ATTRIB/ATTDEF group 3 is the PROMPT
          // string (not content), so attributes use group 1 only.
          const attribute = r.type === 'ATTRIB' || r.type === 'ATTDEF';
          ent.text = decodeUnicodeEscapes(r.pairs.filter(p => p.code === 1 || (p.code === 3 && !attribute)).map(p => p.value).join(''));
          if (first(r, 40) !== undefined) ent.textHeight = number(r, 40);
          ent.rotationDeg = number(r, 50, 0);
          if(r.type==='MTEXT') {
            ent.rotationDeg=0;
            for(let i=0;i<r.pairs.length;i++) {
              const p=r.pairs[i];
              if(p.code===50) ent.rotationDeg=Number(p.value)*180/Math.PI;
              if(p.code===11) {
                const y=r.pairs.slice(i+1).find(q=>q.code===21)?.value??'0';
                ent.rotationDeg=Math.atan2(Number(y),Number(p.value))*180/Math.PI;
              }
            }
          }
          break;
        default:
          diagnose('UNSUPPORTED_ENTITY', `${r.type} is unsupported; source geometry omitted.`, r); continue;
      }
      let elevationDiagnosed = false; // once per source record, not once per exploded part (MLINE)
      for (const part of parts ?? [ent]) {
        ent = part;
        const invalid = validateCadEntity(ent);
        if (invalid) { diagnose('MALFORMED_ENTITY', invalid, r, 'error'); continue; }
        ent = transformCadEntity(ent, compose(matrix, ocs));
        const entityZ = zScale * (reflected ? -ownZ : ownZ) + zOffset;
        if (ownZ !== 0 && !elevationDiagnosed) diagnose('ELEVATED_GEOMETRY_PROJECTED', `${r.type} at elevation ${entityZ} is projected onto the plan; its elevation is retained.`, r);
        elevationDiagnosed = true;
        if (entityZ !== 0) (ent as DxfEntity & { elevation?: number }).elevation = entityZ;
        const transformedInvalid = validateCadEntity(ent);
        if (transformedInvalid) { diagnose('INVALID_TRANSFORM', transformedInvalid, r, 'error'); continue; }
        if (!Object.values(getCadEntityBounds(ent)).every(Number.isFinite)) { diagnose('GEOMETRY_OVERFLOW', 'Native geometry exceeds finite drawing bounds; entity omitted.', r, 'error'); continue; }
        if (ent.geometryApproximation) diagnose('APPROXIMATED_GEOMETRY', ent.geometryApproximation, r);
        entities.push(ent);
      }
    }
  }
  expand(sections.get('ENTITIES') ?? [], identity, []);
  if (paperSpaceSkipped) diagnose('PAPER_SPACE_SKIPPED', `${paperSpaceSkipped} paper-space (layout) entit${paperSpaceSkipped === 1 ? 'y was' : 'ies were'} skipped; only model space is imported.`);
  const bbox: BoundingBox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const ent of entities) {
    const b = getCadEntityBounds(ent);
    bbox.minX = Math.min(bbox.minX, b.minX); bbox.maxX = Math.max(bbox.maxX, b.maxX);
    bbox.minY = Math.min(bbox.minY, b.minY); bbox.maxY = Math.max(bbox.maxY, b.maxY);
  }
  if (!entities.length) Object.assign(bbox, { minX: 0, maxX: 500, minY: 0, maxY: 500 });
  const units = resolveCadUnits({ insUnits, measurement, entities, bbox });
  for (const d of units.diagnostics) diagnose(d.code, d.message);
  return { entities, bbox, insUnits, measurement, ...units.suggestion, diagnostics, blockReferences, unitsConfidence: units.unitsConfidence, ...(hiddenLayers.size ? { hiddenLayers: [...hiddenLayers].sort() } : {}) };
}
