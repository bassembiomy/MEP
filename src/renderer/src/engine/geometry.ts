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
