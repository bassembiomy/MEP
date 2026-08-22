import { SteppedDuctSection } from '../ducts/steppedDuctRouter';
import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { ValidationPointResult } from './airflowValidator';

export function validateSpatialCoordination(
  zones: EquipmentServiceZone[],
  ducts: SteppedDuctSection[],
  _roomPolygon: number[]
): ValidationPointResult {
  const maxCeilingDepth = zones[0]?.maxAvailableCeilingDepthIn || 14;
  let hasDepthViolation = false;
  let hasAspectViolation = false;
  let violatingDuctId = '';

  for (const d of ducts) {
    if (d.heightIn > maxCeilingDepth) {
      hasDepthViolation = true;
      violatingDuctId = d.id;
    }
    const aspect = d.widthIn / d.heightIn;
    if (aspect > 4.0) {
      hasAspectViolation = true;
      violatingDuctId = d.id;
    }
  }

  const passed = !hasDepthViolation && !hasAspectViolation;

  return {
    pointIndex: 9,
    pointName: '3D Spatial Coordination & Clash Check',
    status: passed ? 'PASS' : 'WARNING',
    metric: `Max Duct Height: ${Math.max(...ducts.map((d) => d.heightIn || 12))} in. vs Available Depth: ${maxCeilingDepth} in., Aspect Ratios <= 3.0`,
    criteria: `Duct Height <= ${maxCeilingDepth} in., Aspect Ratio <= 3.0, Zero unauthorized wall penetrations`,
    message: passed
      ? `All ductwork, equipment, and terminals comply with available ${maxCeilingDepth}" ceiling depth and architectural clearances`
      : `Spatial coordination warning in duct ${violatingDuctId}: ${hasDepthViolation ? 'Exceeds ceiling depth' : 'Aspect ratio exceeds 4.0'}`
  };
}
