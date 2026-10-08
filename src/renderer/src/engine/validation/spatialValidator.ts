import type { SteppedDuctSection } from '../ducts/steppedDuctRouter';
import type { EquipmentServiceZone } from '../zoning/zonePartitioner';
import type { ValidationPointResult } from './airflowValidator';
import { isPointInPolygon } from '../geometry';

export function isPointInOrOnPolygon(x: number, y: number, polygon: number[]): boolean {
  if (![x, y, ...polygon].every(Number.isFinite) || polygon.length < 6 || polygon.length % 2 !== 0) return false;
  if (isPointInPolygon(x, y, polygon)) return true;
  for (let i = 0; i < polygon.length; i += 2) {
    const j = (i + 2) % polygon.length;
    const dx = polygon[j] - polygon[i], dy = polygon[j + 1] - polygon[i + 1];
    const length2 = dx * dx + dy * dy;
    const fraction = length2 ? ((x - polygon[i]) * dx + (y - polygon[i + 1]) * dy) / length2 : 0;
    if (fraction >= 0 && fraction <= 1 && Math.hypot(x - polygon[i] - fraction * dx, y - polygon[i + 1] - fraction * dy) < 1e-6) return true;
  }
  return false;
}

/** Test each interval split by polygon-edge intersections, including concave recesses. */
export function isSegmentInPolygon(start: { x: number; y: number }, end: { x: number; y: number }, polygon: number[]): boolean {
  if (!isPointInOrOnPolygon(start.x, start.y, polygon) || !isPointInOrOnPolygon(end.x, end.y, polygon)) return false;
  const dx = end.x - start.x, dy = end.y - start.y;
  const fractions = [0, 1];
  for (let i = 0; i < polygon.length; i += 2) {
    const j = (i + 2) % polygon.length;
    const ex = polygon[j] - polygon[i], ey = polygon[j + 1] - polygon[i + 1];
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) < 1e-10) continue;
    const qx = polygon[i] - start.x, qy = polygon[i + 1] - start.y;
    const t = (qx * ey - qy * ex) / denominator;
    const u = (qx * dy - qy * dx) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) fractions.push(t);
  }
  fractions.sort((a, b) => a - b);
  return fractions.slice(1).every((t, i) => {
    const middle = (t + fractions[i]) / 2;
    return isPointInOrOnPolygon(start.x + middle * dx, start.y + middle * dy, polygon);
  });
}

export function validateSpatialCoordination(
  zones: EquipmentServiceZone[], ducts: SteppedDuctSection[], roomPolygon: number[], maxAspectRatio = 3
): ValidationPointResult {
  const failures: string[] = [];
  if (!zones.length) failures.push('No equipment geometry');
  for (const z of zones) {
    const polygon = z.serviceAreaPolygon.length >= 6 ? z.serviceAreaPolygon : roomPolygon;
    if (!isPointInOrOnPolygon(z.equipmentPosition.x, z.equipmentPosition.y, polygon)) failures.push(`${z.id}: equipment outside service area`);
  }
  for (const d of ducts) {
    const zone = zones.find(z => z.id === d.unitId);
    if (!zone) { failures.push(`${d.id}: no owning service zone`); continue; }
    const depth = zone.maxAvailableCeilingDepthIn ?? 14;
    if (![d.heightIn, d.widthIn, depth, maxAspectRatio].every(v => Number.isFinite(v) && v > 0)) failures.push(`${d.id}: invalid dimensions`);
    if (d.heightIn > depth) failures.push(`${d.id}: exceeds ceiling depth`);
    if (Math.max(d.widthIn / d.heightIn, d.heightIn / d.widthIn) > maxAspectRatio) failures.push(`${d.id}: exceeds aspect ratio ${maxAspectRatio}`);
    const polygon = zone.serviceAreaPolygon.length >= 6 ? zone.serviceAreaPolygon : roomPolygon;
    if (!isSegmentInPolygon(d.startPoint, d.endPoint, polygon)) failures.push(`${d.id}: duct leaves service area`);
  }
  return {
    pointIndex: 9, pointName: 'Preliminary Spatial Coordination',
    status: failures.length ? 'FAIL' : 'PASS',
    metric: `${ducts.length} sections checked against their service areas, ceiling depths and aspect ratio ${maxAspectRatio}`,
    criteria: 'Equipment and duct centerlines inside service area; dimensions within declared limits',
    message: failures.length ? failures.join('; ') : 'Plan containment and declared dimensions pass; 3D clashes, barriers and service clearances are unverified'
  };
}
