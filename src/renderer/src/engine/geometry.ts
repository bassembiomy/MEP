// Helper geometry functions for polyline/polygon zones and diffuser/duct routing

// Calculate polygon area in square units using Shoelace Formula
export function calculatePolygonArea(points: number[]): number {
  if (points.length < 6) return 0; // Needs at least 3 points (6 values)
  
  let area = 0;
  const numPoints = points.length / 2;
  
  for (let i = 0; i < numPoints; i++) {
    const x1 = points[2 * i];
    const y1 = points[2 * i + 1];
    
    // Wrap around to first point
    const nextIndex = (i + 1) % numPoints;
    const x2 = points[2 * nextIndex];
    const y2 = points[2 * nextIndex + 1];
    
    area += x1 * y2 - x2 * y1;
  }
  
  return Math.abs(area / 2);
}

// Calculate polygon perimeter in units
export function calculatePolygonPerimeter(points: number[]): number {
  if (points.length < 4) return 0;
  
  let perimeter = 0;
  const numPoints = points.length / 2;
  
  for (let i = 0; i < numPoints; i++) {
    const x1 = points[2 * i];
    const y1 = points[2 * i + 1];
    
    const nextIndex = (i + 1) % numPoints;
    const x2 = points[2 * nextIndex];
    const y2 = points[2 * nextIndex + 1];
    
    const dx = x2 - x1;
    const dy = y2 - y1;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  
  return perimeter;
}

// Check if point (x, y) is inside polygon
export function isPointInPolygon(x: number, y: number, points: number[]): boolean {
  if (points.length < 6) return false;
  
  let inside = false;
  const numPoints = points.length / 2;
  
  for (let i = 0, j = numPoints - 1; i < numPoints; j = i++) {
    const xi = points[2 * i];
    const yi = points[2 * i + 1];
    const xj = points[2 * j];
    const yj = points[2 * j + 1];
    
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    
    if (intersect) inside = !inside;
  }
  
  return inside;
}

// Calculate the horizontal interior span [minX, maxX] of a polygon at a specific Y coordinate
export function getPolygonScanlineSpan(y: number, points: number[]): { minX: number; maxX: number } | null {
  if (points.length < 6) return null;
  const numPoints = points.length / 2;
  const intersections: number[] = [];

  for (let i = 0, j = numPoints - 1; i < numPoints; j = i++) {
    const x1 = points[2 * j];
    const y1 = points[2 * j + 1];
    const x2 = points[2 * i];
    const y2 = points[2 * i + 1];

    if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
      const t = (y - y1) / (y2 - y1);
      intersections.push(x1 + t * (x2 - x1));
    }
  }

  if (intersections.length < 2) return null;
  intersections.sort((a, b) => a - b);
  return { minX: intersections[0], maxX: intersections[intersections.length - 1] };
}

// Calculate the vertical interior span [minY, maxY] of a polygon at a specific X coordinate
export function getPolygonVerticalSpan(x: number, points: number[]): { minY: number; maxY: number } | null {
  if (points.length < 6) return null;
  const numPoints = points.length / 2;
  const intersections: number[] = [];

  for (let i = 0, j = numPoints - 1; i < numPoints; j = i++) {
    const x1 = points[2 * j];
    const y1 = points[2 * j + 1];
    const x2 = points[2 * i];
    const y2 = points[2 * i + 1];

    if ((x1 <= x && x2 > x) || (x2 <= x && x1 > x)) {
      const t = (x - x1) / (x2 - x1);
      intersections.push(y1 + t * (y2 - y1));
    }
  }

  if (intersections.length < 2) return null;
  intersections.sort((a, b) => a - b);
  return { minY: intersections[0], maxY: intersections[intersections.length - 1] };
}

// Clamp any coordinate (x, y) so that it is strictly inside polygon with a safety margin
export function clampPointInsidePolygon(
  x: number,
  y: number,
  points: number[],
  margin: number = 1.5
): { x: number; y: number } {
  if (isPointInPolygon(x, y, points)) {
    const span = getPolygonScanlineSpan(y, points);
    if (span && span.maxX - span.minX > margin * 2) {
      const clampedX = Math.max(span.minX + margin, Math.min(span.maxX - margin, x));
      return { x: clampedX, y };
    }
    return { x, y };
  }

  const span = getPolygonScanlineSpan(y, points);
  if (span && span.maxX - span.minX > margin * 2) {
    const clampedX = Math.max(span.minX + margin, Math.min(span.maxX - margin, x));
    return { x: clampedX, y };
  }

  const c = getPolygonCentroid(points);
  for (let step = 0.1; step <= 1.0; step += 0.1) {
    const testX = x + (c.x - x) * step;
    const testY = y + (c.y - y) * step;
    if (isPointInPolygon(testX, testY, points)) {
      return { x: testX, y: testY };
    }
  }

  return { x: c.x, y: c.y };
}

// Get the centroid of a polygon (useful for duct/equipment routing or labelling)
export function getPolygonCentroid(points: number[]): { x: number; y: number } {
  if (points.length < 6) return { x: 0, y: 0 };
  
  let cx = 0;
  let cy = 0;
  let areaSum = 0;
  const numPoints = points.length / 2;
  
  for (let i = 0; i < numPoints; i++) {
    const x1 = points[2 * i];
    const y1 = points[2 * i + 1];
    
    const nextIndex = (i + 1) % numPoints;
    const x2 = points[2 * nextIndex];
    const y2 = points[2 * nextIndex + 1];
    
    const factor = (x1 * y2 - x2 * y1);
    cx += (x1 + x2) * factor;
    cy += (y1 + y2) * factor;
    areaSum += factor;
  }
  
  const area = areaSum / 2;
  if (Math.abs(area) < 0.0001) {
    // Fallback to bounding box center if area is 0
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < numPoints; i++) {
      const x = points[2 * i];
      const y = points[2 * i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }
  
  return {
    x: cx / (6 * area),
    y: cy / (6 * area)
  };
}

// Generate points on a grid within a polygon boundary (diffuser layout)
export function getGridPointsInPolygon(points: number[], spacing: number): { x: number; y: number }[] {
  if (points.length < 6) return [];
  
  // Find bounding box
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
  
  const gridPoints: { x: number; y: number }[] = [];
  
  // Grid alignment
  const startX = Math.ceil(minX / spacing) * spacing;
  const startY = Math.ceil(minY / spacing) * spacing;
  
  for (let gx = startX; gx < maxX; gx += spacing) {
    for (let gy = startY; gy < maxY; gy += spacing) {
      if (isPointInPolygon(gx, gy, points)) {
        gridPoints.push({ x: gx, y: gy });
      }
    }
  }
  
  return gridPoints;
}

// Snap coordinates to custom grid interval
export function snapToGrid(value: number, interval: number): number {
  return Math.round(value / interval) * interval;
}

/**
 * Calculates the optimal placement for the outdoor unit (ODU) on the closest exterior wall.
 */
export function calculateOptimalOutdoorUnitPos(
  points: number[],
  allZones: any[],
  dxfBoundingBox: any
): { x: number; y: number } {
  if (points.length < 6) return { x: 0, y: 0 };

  // 1. Determine the building bounding envelope
  let envMinX = Infinity;
  let envMaxX = -Infinity;
  let envMinY = Infinity;
  let envMaxY = -Infinity;

  if (dxfBoundingBox) {
    envMinX = dxfBoundingBox.minX;
    envMaxX = dxfBoundingBox.maxX;
    envMinY = dxfBoundingBox.minY;
    envMaxY = dxfBoundingBox.maxY;
  } else if (allZones && allZones.length > 0) {
    // If no CAD underlay, use all zones combined
    allZones.forEach((z) => {
      const numPts = z.points.length / 2;
      for (let i = 0; i < numPts; i++) {
        const px = z.points[i * 2];
        const py = z.points[i * 2 + 1];
        if (px < envMinX) envMinX = px;
        if (px > envMaxX) envMaxX = px;
        if (py < envMinY) envMinY = py;
        if (py > envMaxY) envMaxY = py;
      }
    });
  } else {
    // Single zone fallback
    const numPts = points.length / 2;
    for (let i = 0; i < numPts; i++) {
      const px = points[i * 2];
      const py = points[i * 2 + 1];
      if (px < envMinX) envMinX = px;
      if (px > envMaxX) envMaxX = px;
      if (py < envMinY) envMinY = py;
      if (py > envMaxY) envMaxY = py;
    }
  }

  // Fallback if coordinates are invalid
  if (envMinX === Infinity) {
    envMinX = 0; envMaxX = 600; envMinY = 0; envMaxY = 400;
  }

  // 2. Calculate centroid of this zone
  const centroid = getPolygonCentroid(points);

  // 3. Find which side of the building envelope is closest to the centroid
  const distToLeft = Math.abs(centroid.x - envMinX);
  const distToRight = Math.abs(envMaxX - centroid.x);
  const distToTop = Math.abs(centroid.y - envMinY);
  const distToBottom = Math.abs(envMaxY - centroid.y);

  const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);

  // 4. Place ODU outside the corresponding boundary vertex of this zone
  let optimalPos = { x: 0, y: 0 };
  const offset = 40; // 4 feet outside
  const numPoints = points.length / 2;

  if (minDist === distToLeft) {
    // Left exterior wall: Find left-most vertex of this zone
    let minX = Infinity;
    let targetY = centroid.y;
    for (let i = 0; i < numPoints; i++) {
      const px = points[i * 2];
      if (px < minX) {
        minX = px;
        targetY = points[i * 2 + 1];
      }
    }
    optimalPos = { x: minX - offset, y: targetY };
  } else if (minDist === distToRight) {
    // Right exterior wall: Find right-most vertex of this zone
    let maxX = -Infinity;
    let targetY = centroid.y;
    for (let i = 0; i < numPoints; i++) {
      const px = points[i * 2];
      if (px > maxX) {
        maxX = px;
        targetY = points[i * 2 + 1];
      }
    }
    optimalPos = { x: maxX + offset, y: targetY };
  } else if (minDist === distToTop) {
    // Top exterior wall: Find top-most vertex of this zone
    let minY = Infinity;
    let targetX = centroid.x;
    for (let i = 0; i < numPoints; i++) {
      const py = points[i * 2 + 1];
      if (py < minY) {
        minY = py;
        targetX = points[i * 2];
      }
    }
    optimalPos = { x: targetX, y: minY - offset };
  } else {
    // Bottom exterior wall: Find bottom-most vertex of this zone
    let maxY = -Infinity;
    let targetX = centroid.x;
    for (let i = 0; i < numPoints; i++) {
      const py = points[i * 2 + 1];
      if (py > maxY) {
        maxY = py;
        targetX = points[i * 2];
      }
    }
    optimalPos = { x: targetX, y: maxY + offset };
  }

  // Snap to 10px grid
  return {
    x: Math.round(optimalPos.x / 10) * 10,
    y: Math.round(optimalPos.y / 10) * 10
  };
}

/**
 * Calculates the optimal placement for the indoor unit (FCU/Wall IU)
 * on an interior wall or furthest from the exterior walls (near corridor/entrance).
 */
export function calculateOptimalIndoorUnitPos(
  points: number[],
  outdoorUnitPos?: { x: number; y: number }
): { x: number; y: number } {
  if (points.length < 6) return { x: 0, y: 0 };

  const centroid = getPolygonCentroid(points);
  const numPoints = points.length / 2;

  let targetX = points[0];
  let targetY = points[1];

  if (outdoorUnitPos && (outdoorUnitPos.x !== 0 || outdoorUnitPos.y !== 0)) {
    // Find the vertex furthest from the outdoor unit (interior / corridor wall)
    let maxDist = -1;
    for (let i = 0; i < numPoints; i++) {
      const px = points[i * 2];
      const py = points[i * 2 + 1];
      const dist = Math.pow(px - outdoorUnitPos.x, 2) + Math.pow(py - outdoorUnitPos.y, 2);
      if (dist > maxDist) {
        maxDist = dist;
        targetX = px;
        targetY = py;
      }
    }
  } else {
    // Fallback: pick the top-leftmost vertex
    let minScore = Infinity;
    for (let i = 0; i < numPoints; i++) {
      const px = points[i * 2];
      const py = points[i * 2 + 1];
      const score = px + py;
      if (score < minScore) {
        minScore = score;
        targetX = px;
        targetY = py;
      }
    }
  }

  // Shift inside the zone towards the centroid so FCU is neatly inside the ceiling
  const vx = centroid.x - targetX;
  const vy = centroid.y - targetY;
  const len = Math.sqrt(vx * vx + vy * vy) || 1;

  const offset = Math.min(30, len * 0.35);
  let optimalX = targetX + (vx / len) * offset;
  let optimalY = targetY + (vy / len) * offset;

  // Make sure it is inside the polygon (especially for L-shaped and concave polygons)
  if (!isPointInPolygon(optimalX, optimalY, points)) {
    let minBboxX = Infinity, maxBboxX = -Infinity, minBboxY = Infinity, maxBboxY = -Infinity;
    for (let i = 0; i < numPoints; i++) {
      const px = points[i * 2];
      const py = points[i * 2 + 1];
      if (px < minBboxX) minBboxX = px;
      if (px > maxBboxX) maxBboxX = px;
      if (py < minBboxY) minBboxY = py;
      if (py > maxBboxY) maxBboxY = py;
    }
    const spanW = maxBboxX - minBboxX;
    const spanH = maxBboxY - minBboxY;
    const stepX = (spanW || 100) / 20;
    const stepY = (spanH || 100) / 20;

    for (let ix = 1; ix < 20; ix++) {
      const px = minBboxX + ix * stepX;
      for (let iy = 1; iy < 20; iy++) {
        const py = minBboxY + iy * stepY;
        if (isPointInPolygon(px, py, points)) {
          optimalX = px;
          optimalY = py;
          break;
        }
      }
      if (isPointInPolygon(optimalX, optimalY, points)) break;
    }
  }

  return {
    x: Math.round(optimalX / 10) * 10,
    y: Math.round(optimalY / 10) * 10
  };
}
