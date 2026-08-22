import { DxfEntity, BoundingBox } from '../store/projectStore';

export interface ParsedDxf {
  entities: DxfEntity[];
  bbox: BoundingBox;
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

export function parseDxfText(dxfText: string): ParsedDxf {
  const lines = dxfText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
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

  let inEntitiesSection = false;
  let currentEntity: Partial<DxfEntity> | null = null;

  let i = 0;
  while (i < lines.length - 1) {
    const codeStr = lines[i];
    const valStr = lines[i + 1];
    i += 2;

    const code = parseInt(codeStr);
    if (isNaN(code)) continue;

    // Check for section starts/ends
    if (code === 0 && valStr === 'SECTION') {
      continue;
    }
    if (code === 2 && valStr === 'ENTITIES') {
      inEntitiesSection = true;
      continue;
    }
    if (code === 0 && valStr === 'ENDSEC') {
      if (inEntitiesSection) {
        // Close last entity if any
        if (currentEntity && currentEntity.type) {
          entities.push(currentEntity as DxfEntity);
          currentEntity = null;
        }
        inEntitiesSection = false;
      }
      continue;
    }

    if (!inEntitiesSection) continue;

    // New entity indicator
    if (code === 0) {
      if (currentEntity && currentEntity.type) {
        entities.push(currentEntity as DxfEntity);
      }
      currentEntity = null;

      if (['LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'TEXT', 'MTEXT', 'ARC'].includes(valStr)) {
        currentEntity = {
          type: valStr as any,
          points: [],
          layer: '0'
        };
      }
      continue;
    }

    if (!currentEntity) continue;

    // Common entity group codes
    if (code === 8) {
      currentEntity.layer = valStr;
    } else if (code === 62) {
      const aci = parseInt(valStr);
      if (!isNaN(aci)) currentEntity.color = aciToHexColor(Math.abs(aci));
    } else if (code === 420) {
      const rgbInt = parseInt(valStr);
      if (!isNaN(rgbInt)) {
        const hex = rgbInt.toString(16).padStart(6, '0');
        currentEntity.color = `#${hex}`;
      }
    }

    // Parse entity specific group codes
    switch (currentEntity.type) {
      case 'LINE':
        if (code === 10) currentEntity.x = parseFloat(valStr); // start X
        if (code === 20) currentEntity.y = parseFloat(valStr); // start Y
        if (code === 11) {
          // end X
          const endX = parseFloat(valStr);
          if (currentEntity.points) currentEntity.points[0] = endX;
        }
        if (code === 21) {
          // end Y
          const endY = parseFloat(valStr);
          if (currentEntity.points) currentEntity.points[1] = endY;
        }
        break;

      case 'LWPOLYLINE':
      case 'POLYLINE':
        if (code === 10) {
          if (currentEntity.points) currentEntity.points.push(parseFloat(valStr));
        }
        if (code === 20) {
          if (currentEntity.points && currentEntity.points.length > 0) {
            // Match corresponding Y coordinate
            currentEntity.points.push(parseFloat(valStr));
          }
        }
        break;

      case 'CIRCLE':
        if (code === 10) currentEntity.x = parseFloat(valStr); // centerX
        if (code === 20) currentEntity.y = parseFloat(valStr); // centerY
        if (code === 40) currentEntity.radius = parseFloat(valStr); // radius
        break;

      case 'ARC':
        if (code === 10) currentEntity.x = parseFloat(valStr); // centerX
        if (code === 20) currentEntity.y = parseFloat(valStr); // centerY
        if (code === 40) currentEntity.radius = parseFloat(valStr); // radius
        break;

      case 'TEXT':
      case 'MTEXT':
        if (code === 10) currentEntity.x = parseFloat(valStr);
        if (code === 20) currentEntity.y = parseFloat(valStr);
        if (code === 1) currentEntity.text = valStr;
        break;
    }
  }

  // Push final entity if any
  if (currentEntity && currentEntity.type) {
    entities.push(currentEntity as DxfEntity);
  }

  // Post-process geometries and update bounding box
  const validEntities = entities.filter((ent) => {
    if (ent.type === 'LINE') {
      const x1 = ent.x || 0;
      const y1 = ent.y || 0;
      const x2 = ent.points?.[0] || 0;
      const y2 = ent.points?.[1] || 0;
      updateBbox(x1, y1);
      updateBbox(x2, y2);
      return !isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2);
    }
    
    if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
      if (!ent.points || ent.points.length < 4) return false;
      for (let j = 0; j < ent.points.length; j += 2) {
        updateBbox(ent.points[j], ent.points[j + 1]);
      }
      return true;
    }
    
    if (ent.type === 'CIRCLE' || ent.type === 'ARC') {
      const cx = ent.x || 0;
      const cy = ent.y || 0;
      const r = ent.radius || 0;
      updateBbox(cx - r, cy - r);
      updateBbox(cx + r, cy + r);
      return !isNaN(cx) && !isNaN(cy) && r > 0;
    }

    if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
      const tx = ent.x || 0;
      const ty = ent.y || 0;
      updateBbox(tx, ty);
      return !isNaN(tx) && !isNaN(ty) && !!ent.text;
    }
    
    return false;
  });

  // Default bounding box if empty
  const finalBbox: BoundingBox = {
    minX: isFinite(minX) ? minX : 0,
    maxX: isFinite(maxX) ? maxX : 500,
    minY: isFinite(minY) ? minY : 0,
    maxY: isFinite(maxY) ? maxY : 500
  };

  return {
    entities: validEntities,
    bbox: finalBbox
  };
}
