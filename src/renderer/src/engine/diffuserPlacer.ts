import { getPolygonCentroid, isPointInPolygon } from './geometry';

export interface DiffuserPos {
  id: string;
  x: number;
  y: number;
  cfm: number;
  size: string; // Neck size, e.g., '9"x9"', '12"x12"', '15"x15"', '18"x18"'
}

export function getDiffuserSize(cfm: number, isImperial: boolean = true): string {
  if (isImperial) {
    if (cfm <= 300) return '9"x9"';
    if (cfm <= 450) return '12"x12"';
    if (cfm <= 650) return '15"x15"';
    return '18"x18"';
  } else {
    if (cfm <= 300) return '225x225';
    if (cfm <= 450) return '300x300';
    if (cfm <= 650) return '375x375';
    return '450x450';
  }
}

// Places diffusers inside a polygon zone based on total flow (CFM or L/s)
export function placeDiffusers(
  points: number[],
  totalFlow: number,
  isImperial: boolean = true,
  _spacingFt: number = 10,
  _scale: number = 10
): DiffuserPos[] {
  if (points.length < 6 || totalFlow <= 0) return [];

  // Convert metric flow (L/s) to CFM for sizing limits
  const cfm = isImperial ? totalFlow : totalFlow * 2.119;

  // 1. Determine number of diffusers needed (approx 350 CFM per diffuser)
  const numDiffusers = Math.max(1, Math.ceil(cfm / 350));
  const diffusers: DiffuserPos[] = [];
  
  const flowPerDiffuser = Math.round(totalFlow / numDiffusers);
  const cfmPerDiffuser = Math.round(cfm / numDiffusers);
  const sizeStr = getDiffuserSize(cfmPerDiffuser, isImperial);

  // 2. Find bounding box of the polygon
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const numPoints = points.length / 2;
  for (let i = 0; i < numPoints; i++) {
    const x = points[2 * i];
    const y = points[2 * i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const width = maxX - minX;
  const height = maxY - minY;

  // 3. Fallback to centroid if only 1 diffuser is needed
  if (numDiffusers === 1) {
    const centroid = getPolygonCentroid(points);
    return [{
      id: `diffuser-${Date.now()}-0`,
      x: Math.round(centroid.x),
      y: Math.round(centroid.y),
      cfm: flowPerDiffuser,
      size: sizeStr
    }];
  }

  // 4. Grid placement: Find layout of columns and rows
  const ar = width / height;
  let rows = Math.round(Math.sqrt(numDiffusers / ar));
  rows = Math.max(1, rows);
  let cols = Math.ceil(numDiffusers / rows);
  cols = Math.max(1, cols);

  const colWidth = width / cols;
  const rowHeight = height / rows;

  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let gx = minX + (c + 0.5) * colWidth;
      let gy = minY + (r + 0.5) * rowHeight;

      if (!isPointInPolygon(gx, gy, points)) {
        let found = false;
        const searchSteps = [5, 10, 15, 20, 25];
        const angles = [0, 45, 90, 135, 180, 225, 270, 315];
        
        for (const step of searchSteps) {
          for (const angle of angles) {
            const rad = (angle * Math.PI) / 180;
            const sx = gx + Math.cos(rad) * step;
            const sy = gy + Math.sin(rad) * step;
            if (isPointInPolygon(sx, sy, points)) {
              gx = sx;
              gy = sy;
              found = true;
              break;
            }
          }
          if (found) break;
        }

        if (!found) {
          const centroid = getPolygonCentroid(points);
          gx = centroid.x;
          gy = centroid.y;
        }
      }

      diffusers.push({
        id: `diffuser-${Date.now()}-${count++}`,
        x: Math.round(gx),
        y: Math.round(gy),
        cfm: flowPerDiffuser,
        size: sizeStr
      });

      if (diffusers.length >= numDiffusers) {
        break;
      }
    }
    if (diffusers.length >= numDiffusers) {
      break;
    }
  }

  return diffusers;
}
