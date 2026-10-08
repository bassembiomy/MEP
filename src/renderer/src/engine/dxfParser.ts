import type { DxfEntity, BoundingBox } from '../store/projectStore';
import { getCadEntityBounds, transformCadEntity, validateCadEntity } from './cad/nativeGeometry';
import type { CadAffineMatrix } from './cad/nativeGeometry';

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

interface DxfPair { code: number; value: string }
interface DxfRecord { type: string; pairs: DxfPair[] }
interface DxfBlock { baseX: number; baseY: number; records: DxfRecord[] }
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

/** Parses DXF records before resolving INSERTs. Empty values never shift code/value pairs. */
export function parseDxfText(dxfText: string): ParsedDxf {
  const diagnostics: CadImportDiagnostic[] = [], entities: DxfEntity[] = [];
  const diagnose = (code: string, message: string, r?: DxfRecord, severity: 'warning' | 'error' = 'warning') => {
    if (diagnostics.length < 1000) diagnostics.push({ code, message, severity, entityType: r?.type, handle: r && first(r, 5) });
    else if (diagnostics.length === 1000) diagnostics.push({ code: 'DIAGNOSTIC_LIMIT', severity: 'error', message: 'Additional import diagnostics suppressed; drawing is incomplete.' });
  };
  const lines = dxfText.replace(/^\uFEFF/, '').replace(/^(?:[^\S\r\n]*\r?\n)+/, '').split(/\r?\n/);
  // Some producers prefix the file with whitespace outside the DXF pair stream.
  if (lines.length % 2 === 1 && lines.at(-1)?.trim()) diagnose('INCOMPLETE_PAIR', 'Final DXF group code has no value.', undefined, 'error');
  const sections = new Map<string, DxfRecord[]>();
  let record: DxfRecord | undefined, section = '', insUnits: number | undefined, headerVar = '', sectionOpen=false, sawEof=false;
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
      if (record?.type === 'SECTION' && code === 2) {
        section = value.trim().toUpperCase();
        if (!sections.has(section)) sections.set(section, []);
      }
      record?.pairs.push({ code, value });
      if (section === 'HEADER') {
        if (code === 9) headerVar = value.trim();
        if (code === 70 && headerVar === '$INSUNITS' && Number.isInteger(Number(value))) insUnits = Number(value);
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
  for (const r of sections.get('TABLES') ?? []) if (r.type === 'LAYER') layers.set(first(r, 2)?.trim() ?? '0', color(r));
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
      block = { baseX: number(r, 10, 0), baseY: -number(r, 20, 0), records: [] };
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
  let visited = 0, expansionStopped = false;
  function expand(records: DxfRecord[], matrix: CadAffineMatrix, stack: string[], inheritedLayer = '0', inheritedColor?: string, insertHandle?: string) {
    for (let index = 0; index < records.length; index++) {
      const r = records[index];
      if (++visited > 100_000) {
        if (!expansionStopped) diagnose('ENTITY_LIMIT', 'Entity expansion exceeded 100000 records; drawing is incomplete.', r, 'error');
        expansionStopped = true; return;
      }
      const rawLayer = first(r, 8)?.trim() || '0', layer = rawLayer === '0' ? inheritedLayer : rawLayer;
      const aci = number(r, 62), ownColor = color(r) ?? (aci === 0 ? inheritedColor : layers.get(layer));
      if (number(r, 39, 0) !== 0) { diagnose('UNSUPPORTED_THICKNESS', 'Volumetric entity thickness cannot be represented in the 2D drawing; entity omitted.', r); continue; }
      const nx = number(r, 210, 0), ny = number(r, 220, 0), nz = number(r, 230, 1);
      if (![nx, ny, nz].every(Number.isFinite) || Math.abs(nx) > 1e-10 || Math.abs(ny) > 1e-10 || Math.abs(Math.abs(nz) - 1) > 1e-10) {
        diagnose('UNSUPPORTED_EXTRUSION', 'Only planar +Z/-Z extrusion is supported; entity omitted.', r); continue;
      }
      if (r.pairs.some(p => [30, 31, 38].includes(p.code) && (!Number.isFinite(Number(p.value)) || Number(p.value) !== 0))) {
        diagnose('UNSUPPORTED_ELEVATION', 'Elevated or nonplanar geometry cannot be represented in the 2D drawing; entity omitted.', r); continue;
      }
      const reflected = nz < 0 && !['LINE', 'ELLIPSE'].includes(r.type);
      const ocs: CadAffineMatrix = reflected ? { a: -1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } : identity;
      if (r.type === 'INSERT') {
        if (number(r, 70, 1) !== 1 || number(r, 71, 1) !== 1) { diagnose('UNSUPPORTED_INSERT_ARRAY', 'INSERT arrays are unsupported; entity omitted.', r); continue; }
        const name = first(r, 2)?.trim() ?? '', child = blocks.get(name);
        if (!child) { diagnose('MISSING_BLOCK', `INSERT references missing block ${name}.`, r, 'error'); continue; }
        if (stack.includes(name)) { diagnose('CYCLIC_BLOCK', `Cyclic block reference ${[...stack, name].join(' -> ')}.`, r, 'error'); continue; }
        if (stack.length >= 32) { diagnose('BLOCK_DEPTH_LIMIT', 'Nested block depth exceeded 32; remaining geometry omitted.', r, 'error'); continue; }
        const x = number(r, 10, 0), y = -number(r, 20, 0), sx = number(r, 41, 1), sy = number(r, 42, 1), theta = number(r, 50, 0) * Math.PI / 180;
        if (![x, y, sx, sy, theta, child.baseX, child.baseY].every(Number.isFinite) || sx === 0 || sy === 0) { diagnose('MALFORMED_INSERT', 'INSERT has invalid base, scale, rotation or insertion coordinates.', r, 'error'); continue; }
        const cs = Math.cos(theta), sn = Math.sin(theta);
        const local = { a: cs * sx, b: -sn * sx, c: sn * sy, d: cs * sy, tx: x, ty: y };
        local.tx -= local.a * child.baseX + local.c * child.baseY;
        local.ty -= local.b * child.baseX + local.d * child.baseY;
        expand(child.records, compose(matrix, compose(ocs, local)), [...stack, name], layer, ownColor ?? inheritedColor, first(r, 5)?.trim() ?? insertHandle);
        if (expansionStopped) return;
        continue;
      }
      let ent: DxfEntity = { type: r.type as DxfEntity['type'], layer, color: ownColor, handle: first(r, 5)?.trim(), sourceHandle: first(r, 5)?.trim(), sourceBlock: stack.at(-1) };
      if (stack.length && insertHandle) ent.handle = `${insertHandle}/${ent.sourceHandle ?? `${r.type}:${index}`}`;
      switch (r.type) {
        case 'LINE':
          ent.x = number(r, 10); ent.y = -number(r, 20); ent.points = [number(r, 11), -number(r, 21)]; break;
        case 'POLYLINE':
        case 'LWPOLYLINE': {
          const flags = number(r, 70, 0);
          if (!Number.isInteger(flags) || (r.type === 'POLYLINE' && (flags & (2 | 4 | 8 | 16 | 64)))) { diagnose('UNSUPPORTED_POLYLINE', 'Fitted, spline, 3D/polyface or malformed polyline omitted.', r); continue; }
          ent.closed = (flags & 1) !== 0; ent.points = []; ent.bulges = [];
          if (r.type === 'POLYLINE') {
            let ended = false;
            while (index + 1 < records.length) {
              const vertex = records[index + 1];
              if (vertex.type === 'SEQEND') { index++; ended = true; break; }
              if (vertex.type !== 'VERTEX') break;
              index++;
              ent.points.push(number(vertex, 10), -number(vertex, 20)); ent.bulges.push(number(vertex, 42, 0));
              if (number(vertex, 30, 0) !== 0 || (number(vertex, 70, 0) & (1 | 8 | 16 | 32 | 64 | 128))) ent.points.push(NaN, NaN);
            }
            if (!ended) { diagnose('INCOMPLETE_POLYLINE', 'Legacy POLYLINE is missing SEQEND; entity omitted.', r, 'error'); continue; }
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
        case 'TEXT':
        case 'MTEXT':
          ent.x = number(r, 10); ent.y = -number(r, 20);
          ent.text = r.pairs.filter(p => p.code === 3 || p.code === 1).map(p => p.value).join('');
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
      const invalid = validateCadEntity(ent);
      if (invalid) { diagnose('MALFORMED_ENTITY', invalid, r, 'error'); continue; }
      ent = transformCadEntity(ent, compose(matrix, ocs));
      const transformedInvalid = validateCadEntity(ent);
      if (transformedInvalid) { diagnose('INVALID_TRANSFORM', transformedInvalid, r, 'error'); continue; }
      if (!Object.values(getCadEntityBounds(ent)).every(Number.isFinite)) { diagnose('GEOMETRY_OVERFLOW', 'Native geometry exceeds finite drawing bounds; entity omitted.', r, 'error'); continue; }
      if (ent.geometryApproximation) diagnose('APPROXIMATED_GEOMETRY', ent.geometryApproximation, r);
      entities.push(ent);
    }
  }
  expand(sections.get('ENTITIES') ?? [], identity, []);
  const bbox: BoundingBox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const ent of entities) {
    const b = getCadEntityBounds(ent);
    bbox.minX = Math.min(bbox.minX, b.minX); bbox.maxX = Math.max(bbox.maxX, b.maxX);
    bbox.minY = Math.min(bbox.minY, b.minY); bbox.maxY = Math.max(bbox.maxY, b.maxY);
  }
  if (!entities.length) Object.assign(bbox, { minX: 0, maxX: 500, minY: 0, maxY: 500 });
  const declared = cadUnitsFromInsUnits(insUnits);
  const suggestion = declared ?? suggestCadUnitsFromSpan(Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY));
  return { entities, bbox, insUnits, ...suggestion, diagnostics, unitsConfidence: declared ? 'declared' : entities.length ? 'estimated' : 'unknown' };
}
