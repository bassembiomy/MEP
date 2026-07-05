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

export async function parseDwgBuffer(uint8Array: Uint8Array): Promise<ParsedDxf> {
  const libredwg = await getLibreDwgInstance();
  
  const dwgData = libredwg.dwg_read_data(uint8Array, Dwg_File_Type.DWG);
  if (!dwgData) {
    throw new Error('Failed to parse DWG binary data.');
  }
  
  try {
    const db = libredwg.convert(dwgData);
    const entities: DxfEntity[] = [];
    
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

    if (db.entities && Array.isArray(db.entities)) {
      for (const ent of db.entities) {
        if (ent.type === 'LINE' && ent.startPoint && ent.endPoint) {
          const x1 = ent.startPoint.x;
          const y1 = ent.startPoint.y;
          const x2 = ent.endPoint.x;
          const y2 = ent.endPoint.y;
          
          updateBbox(x1, y1);
          updateBbox(x2, y2);
          
          entities.push({
            type: 'LINE',
            x: x1,
            y: y1,
            points: [x2, y2],
            layer: ent.layer || '0'
          });
        } 
        else if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && ent.vertices && Array.isArray(ent.vertices)) {
          if (ent.vertices.length < 2) continue;
          
          const points: number[] = [];
          for (const v of ent.vertices) {
            if (v && typeof v.x === 'number' && typeof v.y === 'number') {
              points.push(v.x, v.y);
              updateBbox(v.x, v.y);
            }
          }
          
          if (points.length >= 4) {
            entities.push({
              type: 'LWPOLYLINE',
              points,
              layer: ent.layer || '0'
            });
          }
        }
        else if (ent.type === 'CIRCLE' && ent.center && typeof ent.radius === 'number') {
          const cx = ent.center.x;
          const cy = ent.center.y;
          const r = ent.radius;
          
          updateBbox(cx - r, cy - r);
          updateBbox(cx + r, cy + r);
          
          entities.push({
            type: 'CIRCLE',
            x: cx,
            y: cy,
            radius: r,
            layer: ent.layer || '0'
          });
        }
        else if (ent.type === 'ARC' && ent.center && typeof ent.radius === 'number') {
          const cx = ent.center.x;
          const cy = ent.center.y;
          const r = ent.radius;
          
          updateBbox(cx - r, cy - r);
          updateBbox(cx + r, cy + r);
          
          entities.push({
            type: 'ARC',
            x: cx,
            y: cy,
            radius: r,
            layer: ent.layer || '0'
          });
        }
        else if ((ent.type === 'TEXT' || ent.type === 'MTEXT') && ent.text) {
          const pt = ent.insertionPoint || ent.center || { x: 0, y: 0 };
          updateBbox(pt.x, pt.y);
          
          entities.push({
            type: 'TEXT',
            x: pt.x,
            y: pt.y,
            text: ent.text,
            layer: ent.layer || '0'
          });
        }
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
