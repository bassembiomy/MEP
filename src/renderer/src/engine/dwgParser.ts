import { LibreDwg, Dwg_File_Type, createModule } from '@mlightcad/libredwg-web';
import { DxfEntity, BoundingBox } from '../store/projectStore';
import { ParsedDxf } from './dxfParser';
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

interface Transform {
  basePoint: { x: number; y: number };
  insertionPoint: { x: number; y: number };
  xScale: number;
  yScale: number;
  rotation: number;
}

function transformPoint(x: number, y: number, t: Transform): { x: number; y: number } {
  // 1. Shift by basePoint
  const dx = x - t.basePoint.x;
  const dy = y - t.basePoint.y;
  
  // 2. Scale
  const sx = dx * t.xScale;
  const sy = dy * t.yScale;
  
  // 3. Rotate (rotation in degrees, counter-clockwise)
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = sx * cos - sy * sin;
  const ry = sx * sin + sy * cos;
  
  // 4. Translate by insertionPoint
  return {
    x: rx + t.insertionPoint.x,
    y: ry + t.insertionPoint.y
  };
}

function transformEntity(ent: DxfEntity, t: Transform): DxfEntity {
  if (ent.type === 'LINE') {
    const p1 = transformPoint(ent.x || 0, ent.y || 0, t);
    const p2 = transformPoint(ent.points?.[0] || 0, ent.points?.[1] || 0, t);
    return {
      ...ent,
      x: p1.x,
      y: p1.y,
      points: [p2.x, p2.y]
    };
  } 
  else if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
    const transformedPoints: number[] = [];
    if (ent.points) {
      for (let i = 0; i < ent.points.length; i += 2) {
        const pt = transformPoint(ent.points[i], ent.points[i + 1], t);
        transformedPoints.push(pt.x, pt.y);
      }
    }
    return {
      ...ent,
      points: transformedPoints
    };
  }
  else if (ent.type === 'CIRCLE' || ent.type === 'ARC') {
    const center = transformPoint(ent.x || 0, ent.y || 0, t);
    const scale = (Math.abs(t.xScale) + Math.abs(t.yScale)) / 2;
    return {
      ...ent,
      x: center.x,
      y: center.y,
      radius: (ent.radius || 0) * scale
    };
  }
  else if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
    const pt = transformPoint(ent.x || 0, ent.y || 0, t);
    return {
      ...ent,
      x: pt.x,
      y: pt.y
    };
  }
  return ent;
}

function parseRawEntity(ent: any): DxfEntity | null {
  if (ent.type === 'LINE' && ent.startPoint && ent.endPoint) {
    return {
      type: 'LINE',
      x: ent.startPoint.x,
      y: ent.startPoint.y,
      points: [ent.endPoint.x, ent.endPoint.y],
      layer: ent.layer || '0'
    };
  } 
  else if (
    (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE' || ent.type === 'POLYLINE2D' || ent.type === 'POLYLINE3D') && 
    ent.vertices && 
    Array.isArray(ent.vertices)
  ) {
    if (ent.vertices.length < 2) return null;
    const points: number[] = [];
    for (const v of ent.vertices) {
      if (v && typeof v.x === 'number' && typeof v.y === 'number') {
        points.push(v.x, v.y);
      }
    }
    if (points.length >= 4) {
      return {
        type: 'LWPOLYLINE',
        points,
        layer: ent.layer || '0'
      };
    }
  }
  else if ((ent.type === 'CIRCLE' || ent.type === 'ARC') && ent.center && typeof ent.radius === 'number') {
    return {
      type: ent.type,
      x: ent.center.x,
      y: ent.center.y,
      radius: ent.radius,
      layer: ent.layer || '0'
    };
  }
  else if (ent.type === 'ELLIPSE' && ent.center && ent.majorAxisEndPoint) {
    const cx = ent.center.x;
    const cy = ent.center.y;
    const mx = ent.majorAxisEndPoint.x;
    const my = ent.majorAxisEndPoint.y;
    const majorLength = Math.sqrt(mx * mx + my * my);
    const ratio = typeof ent.axisRatio === 'number' ? ent.axisRatio : 1;
    const r = majorLength * (1 + ratio) / 2;
    return {
      type: 'CIRCLE',
      x: cx,
      y: cy,
      radius: r,
      layer: ent.layer || '0'
    };
  }
  else if (ent.type === 'SPLINE') {
    const pts = (ent.fitPoints && ent.fitPoints.length > 0) ? ent.fitPoints : ent.controlPoints;
    if (pts && pts.length >= 2) {
      const points: number[] = [];
      for (const pt of pts) {
        if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
          points.push(pt.x, pt.y);
        }
      }
      if (points.length >= 4) {
        return {
          type: 'LWPOLYLINE',
          points,
          layer: ent.layer || '0'
        };
      }
    }
  }
  else if ((ent.type === 'SOLID' || ent.type === '3DFACE') && ent.corner1 && ent.corner2 && ent.corner3) {
    const points: number[] = [
      ent.corner1.x, ent.corner1.y,
      ent.corner2.x, ent.corner2.y,
      ent.corner3.x, ent.corner3.y
    ];
    if (ent.corner4) {
      points.push(ent.corner4.x, ent.corner4.y);
    }
    points.push(ent.corner1.x, ent.corner1.y);
    return {
      type: 'LWPOLYLINE',
      points,
      layer: ent.layer || '0'
    };
  }
  else if ((ent.type === 'TEXT' || ent.type === 'MTEXT') && ent.text) {
    const pt = ent.insertionPoint || ent.center || { x: 0, y: 0 };
    return {
      type: 'TEXT',
      x: pt.x,
      y: pt.y,
      text: ent.text,
      layer: ent.layer || '0'
    };
  }
  return null;
}

function extractEntities(
  db: any,
  rawEntities: any[],
  currentTransform: Transform | null,
  visitedBlocks: Set<string> = new Set()
): DxfEntity[] {
  const result: DxfEntity[] = [];

  for (const ent of rawEntities) {
    if (!ent) continue;

    if (ent.type === 'INSERT') {
      const blockName = ent.name;
      if (!blockName) continue;
      
      if (visitedBlocks.has(blockName)) {
        console.warn(`Circular block reference detected for block: ${blockName}`);
        continue;
      }

      const blockRecord = db.tables?.BLOCK_RECORD?.entries?.find(
        (entry: any) => entry.name === blockName
      );

      if (blockRecord && blockRecord.entities && Array.isArray(blockRecord.entities)) {
        const nextVisited = new Set(visitedBlocks);
        nextVisited.add(blockName);

        const insertXScale = typeof ent.xScale === 'number' ? ent.xScale : 1;
        const insertYScale = typeof ent.yScale === 'number' ? ent.yScale : 1;
        const insertRotation = typeof ent.rotation === 'number' ? ent.rotation : 0;
        const insertPoint = ent.insertionPoint || { x: 0, y: 0 };
        const basePoint = blockRecord.basePoint || { x: 0, y: 0 };

        const localTransform: Transform = {
          basePoint: { x: basePoint.x, y: basePoint.y },
          insertionPoint: { x: insertPoint.x, y: insertPoint.y },
          xScale: insertXScale,
          yScale: insertYScale,
          rotation: insertRotation
        };

        const blockEntities = extractEntities(db, blockRecord.entities, localTransform, nextVisited);
        if (currentTransform) {
          for (const nestedEnt of blockEntities) {
            result.push(transformEntity(nestedEnt, currentTransform));
          }
        } else {
          result.push(...blockEntities);
        }
      }
    } else {
      const parsed = parseRawEntity(ent);
      if (parsed) {
        if (currentTransform) {
          result.push(transformEntity(parsed, currentTransform));
        } else {
          result.push(parsed);
        }
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
    const entities = extractEntities(db, rawEntities, null);
    
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    function updateBbox(x: number, y: number) {
      if (isNaN(x) || isNaN(y)) return;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    for (const ent of entities) {
      if (ent.type === 'LINE') {
        updateBbox(ent.x || 0, ent.y || 0);
        updateBbox(ent.points?.[0] || 0, ent.points?.[1] || 0);
      } 
      else if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && ent.points) {
        for (let i = 0; i < ent.points.length; i += 2) {
          updateBbox(ent.points[i], ent.points[i + 1]);
        }
      }
      else if ((ent.type === 'CIRCLE' || ent.type === 'ARC') && typeof ent.radius === 'number') {
        const cx = ent.x || 0;
        const cy = ent.y || 0;
        const r = ent.radius;
        updateBbox(cx - r, cy - r);
        updateBbox(cx + r, cy + r);
      }
      else if ((ent.type === 'TEXT' || ent.type === 'MTEXT') && typeof ent.x === 'number' && typeof ent.y === 'number') {
        updateBbox(ent.x, ent.y);
      }
    }

    const finalBbox: BoundingBox = {
      minX: isFinite(minX) ? minX : 0,
      maxX: isFinite(maxX) ? maxX : 500,
      minY: isFinite(minY) ? minY : 0,
      maxY: isFinite(maxY) ? maxY : 500
    };

    return {
      entities,
      bbox: finalBbox
    };
  } finally {
    libredwg.dwg_free(dwgData);
  }
}
