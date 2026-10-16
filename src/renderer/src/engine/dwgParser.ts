import { LibreDwg, Dwg_File_Type, createModule } from '@mlightcad/libredwg-web';
import {
  CadEntity, ParsedDxf, aciToHexColor, buildBulgePolyline, dwgInsertToXf, ellipsePoints,
  entitiesBbox, makeArcAngles, splinePoints, stripMtext, transformEntityByInsert, InsertXf, SplineCtrl,
} from './dxfParser';
import wasmUrl from '../../../../node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm?url';

let libredwgInstance: any = null;

async function getLibreDwgInstance() {
  if (!libredwgInstance) {
    // Let Vite manage the WASM binary URL dynamically in both dev and production
    const wasmInstance = await createModule({
      locateFile: () => wasmUrl
    });
    libredwgInstance = LibreDwg.createByWasmInstance(wasmInstance);
  }
  return libredwgInstance;
}

const RAD2DEG = 180 / Math.PI;
const MAX_BLOCK_DEPTH = 8;

const isNum = (n: any): n is number => typeof n === 'number' && isFinite(n);

function parseRawEntity(ent: any): CadEntity | null {
  const layer = ent.layer || '0';
  if (ent.type === 'LINE' && ent.startPoint && ent.endPoint) {
    return {
      type: 'LINE',
      x: ent.startPoint.x,
      y: ent.startPoint.y,
      points: [ent.endPoint.x, ent.endPoint.y],
      layer
    };
  }
  if (ent.type === 'LWPOLYLINE' && Array.isArray(ent.vertices)) {
    const verts = ent.vertices.filter((v: any) => v && isNum(v.x) && isNum(v.y));
    if (verts.length < 2) return null;
    const closed = ((ent.flag ?? 0) & 1) === 1;
    return { type: 'LWPOLYLINE', points: buildBulgePolyline(verts, closed), layer };
  }
  if ((ent.type === 'POLYLINE2D' || ent.type === 'POLYLINE3D' || ent.type === 'POLYLINE') && Array.isArray(ent.vertices)) {
    const verts = ent.vertices.filter((v: any) => v && isNum(v.x) && isNum(v.y));
    if (verts.length < 2) return null;
    const closed = ((ent.flag ?? 0) & 1) === 1;
    return { type: 'LWPOLYLINE', points: buildBulgePolyline(verts, closed), layer };
  }
  if (ent.type === 'CIRCLE' && ent.center && isNum(ent.radius)) {
    return { type: 'CIRCLE', x: ent.center.x, y: ent.center.y, radius: ent.radius, layer };
  }
  if (ent.type === 'ARC' && ent.center && isNum(ent.radius)) {
    // libredwg angles are RADIANS; stored on the entity in DEGREES
    const a = makeArcAngles((ent.startAngle ?? 0) * RAD2DEG, (ent.endAngle ?? Math.PI * 2) * RAD2DEG);
    return { type: 'ARC', x: ent.center.x, y: ent.center.y, radius: ent.radius, layer, ...a };
  }
  if (ent.type === 'ELLIPSE' && ent.center && ent.majorAxisEndPoint) {
    const ratio = isNum(ent.axisRatio) ? ent.axisRatio : 1;
    const points = ellipsePoints(
      ent.center.x, ent.center.y, ent.majorAxisEndPoint.x, ent.majorAxisEndPoint.y, ratio,
      isNum(ent.startAngle) ? ent.startAngle : 0, isNum(ent.endAngle) ? ent.endAngle : Math.PI * 2
    );
    return { type: 'LWPOLYLINE', points, layer };
  }
  if (ent.type === 'SPLINE') {
    const fit: any[] = Array.isArray(ent.fitPoints) ? ent.fitPoints : [];
    const ctrlRaw: any[] = Array.isArray(ent.controlPoints) ? ent.controlPoints : [];
    let points: number[] = [];
    if (fit.length >= 2) {
      for (const p of fit) if (p && isNum(p.x) && isNum(p.y)) points.push(p.x, p.y);
    } else if (ctrlRaw.length >= 2) {
      const weights: number[] | undefined = Array.isArray(ent.weights) && ent.weights.length === ctrlRaw.length ? ent.weights : undefined;
      const ctrl: SplineCtrl[] = ctrlRaw
        .map((p, i) => ({ x: p?.x, y: p?.y, w: weights?.[i] ?? (isNum(p?.weight) ? p.weight : undefined) }))
        .filter((p) => isNum(p.x) && isNum(p.y));
      points = splinePoints(ctrl, isNum(ent.degree) ? ent.degree : 3, Array.isArray(ent.knots) ? ent.knots : undefined);
    }
    if (points.length >= 4) return { type: 'LWPOLYLINE', points, layer };
    return null;
  }
  if ((ent.type === 'SOLID' || ent.type === '3DFACE') && ent.corner1 && ent.corner2 && ent.corner3) {
    const points: number[] = [
      ent.corner1.x, ent.corner1.y,
      ent.corner2.x, ent.corner2.y,
      ent.corner3.x, ent.corner3.y
    ];
    if (ent.corner4) points.push(ent.corner4.x, ent.corner4.y);
    points.push(ent.corner1.x, ent.corner1.y);
    return { type: 'LWPOLYLINE', points, layer };
  }
  if ((ent.type === 'TEXT' || ent.type === 'MTEXT') && ent.text) {
    const isM = ent.type === 'MTEXT';
    const halign = isM ? 0 : (ent.halign ?? 0);
    // TEXT: startPoint is the insertion point; endPoint is the alignment point when halign != 0
    let pt = isM
      ? (ent.insertionPoint || ent.center)
      : (halign !== 0 && ent.endPoint ? ent.endPoint : (ent.startPoint || ent.insertionPoint || ent.center));
    pt = pt || { x: 0, y: 0 };
    const out: CadEntity = {
      type: 'TEXT',
      x: pt.x,
      y: pt.y,
      text: isM ? stripMtext(String(ent.text)) : String(ent.text),
      layer
    };
    const h = isM ? ent.textHeight : ent.textHeight ?? ent.height;
    if (isNum(h) && h > 0) out.height = h;
    let rotRad: number | undefined = isNum(ent.rotation) ? ent.rotation : undefined;
    if (isM && ent.direction && isNum(ent.direction.x) && isNum(ent.direction.y) && (ent.direction.x !== 0 || ent.direction.y !== 0)) {
      rotRad = Math.atan2(ent.direction.y, ent.direction.x);
    }
    if (rotRad) out.rotation = rotRad * RAD2DEG; // DWG: radians -> degrees
    if (isM) {
      const col = (((ent.attachmentPoint ?? 1) as number) - 1) % 3;
      out.align = col === 1 ? 'center' : col === 2 ? 'right' : 'left';
    } else {
      out.align = halign === 1 || halign === 4 ? 'center' : halign === 2 ? 'right' : 'left';
    }
    return out;
  }
  return null;
}

interface Ctx { layer: string; color?: string }

function colorOf(ent: any, effLayer: string, ctx: Ctx | null, layerColors: Record<string, string>): string | undefined {
  const ci = ent.colorIndex;
  if (isNum(ci) && ci !== 256 && ci !== 0) return aciToHexColor(Math.abs(ci));
  if (ci === 0 && ctx?.color) return ctx.color; // BYBLOCK
  return layerColors[effLayer]; // BYLAYER
}

function extractEntities(
  db: any,
  rawEntities: any[],
  ctx: Ctx | null,
  layerColors: Record<string, string>,
  depth: number,
  visitedBlocks: Set<string>,
  warnings: string[]
): CadEntity[] {
  const result: CadEntity[] = [];

  for (const ent of rawEntities) {
    if (!ent) continue;
    const effLayer = ctx && (ent.layer || '0') === '0' ? ctx.layer : (ent.layer || '0');
    const color = colorOf(ent, effLayer, ctx, layerColors);

    if (ent.type === 'INSERT') {
      const blockName = ent.name;
      if (!blockName) continue;
      if (visitedBlocks.has(blockName)) {
        warnings.push(`Circular block reference detected for block: ${blockName}`);
        continue;
      }
      if (depth >= MAX_BLOCK_DEPTH) {
        warnings.push(`Block nesting deeper than ${MAX_BLOCK_DEPTH} levels skipped at "${blockName}".`);
        continue;
      }
      const blockRecord = db.tables?.BLOCK_RECORD?.entries?.find((entry: any) => entry.name === blockName);
      if (!blockRecord || !Array.isArray(blockRecord.entities)) continue;

      const nextVisited = new Set(visitedBlocks);
      nextVisited.add(blockName);
      const local = extractEntities(
        db, blockRecord.entities, { layer: effLayer, color }, layerColors, depth + 1, nextVisited, warnings
      );
      const base = dwgInsertToXf(ent, blockRecord.basePoint);
      const cols = Math.max(1, Math.round(ent.columnCount || 1));
      const rows = Math.max(1, Math.round(ent.rowCount || 1));
      const dx = ent.columnSpacing || 0;
      const dy = ent.rowSpacing || 0;
      const cr = Math.cos(base.rot);
      const sr = Math.sin(base.rot);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const ox = c * dx;
          const oy = r * dy;
          const xf: InsertXf = { ...base, insX: base.insX + ox * cr - oy * sr, insY: base.insY + ox * sr + oy * cr };
          for (const e of local) result.push(transformEntityByInsert(e, xf));
        }
      }
    } else {
      const parsed = parseRawEntity(ent);
      if (parsed) {
        parsed.layer = effLayer;
        if (color) parsed.color = color;
        result.push(parsed);
      }
    }
  }

  return result;
}

export async function parseDwgBuffer(uint8Array: Uint8Array): Promise<ParsedDxf> {
  const libredwg = await getLibreDwgInstance();

  const dwgData = libredwg.dwg_read_data(uint8Array, Dwg_File_Type.DWG);
  if (!dwgData) {
    throw new Error('Failed to parse DWG binary data.');
  }

  try {
    const db = libredwg.convert(dwgData);
    const rawEntities = db.entities && Array.isArray(db.entities) ? db.entities : [];

    const layerColors: Record<string, string> = {};
    const layerEntries: any[] = db.tables?.LAYER?.entries ?? [];
    for (const l of layerEntries) {
      if (l && l.name && isNum(l.colorIndex)) layerColors[l.name] = aciToHexColor(Math.abs(l.colorIndex));
    }

    const warnings: string[] = [];
    const entities = extractEntities(db, rawEntities, null, layerColors, 0, new Set(), warnings).filter((e) => {
      if (e.type === 'LWPOLYLINE') return !!e.points && e.points.length >= 4 && e.points.every(isFinite);
      return true;
    });
    const insunitsRaw = db.header?.INSUNITS;

    return {
      entities,
      bbox: entitiesBbox(entities),
      layerColors,
      insunits: isNum(insunitsRaw) ? insunitsRaw : undefined,
      warnings
    };
  } finally {
    libredwg.dwg_free(dwgData);
  }
}
