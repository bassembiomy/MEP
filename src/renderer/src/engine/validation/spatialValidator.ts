import { SteppedDuctSection } from '../ducts/steppedDuctRouter';
import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { ValidationPointResult } from './airflowValidator';
import { isPointInPolygon, MIN_TERMINAL_SPACING_FT } from '../geometry';
import { formatLength } from '../../format/units';
import { isImperial, MM_PER_IN } from '../units';

/** Duct / ceiling dimension given in inches, shown as in. or mm. */
const fmtIn = (inches: number, units?: string): string => (isImperial(units) ? `${Math.round(inches * 10) / 10} in.` : `${Math.round(inches * MM_PER_IN)} mm`);

/** Maximum duct aspect ratio (W/H) allowed by the spatial check. */
export const MAX_DUCT_ASPECT_RATIO = 4.0;

export interface SpatialTerminal {
  id?: string;
  x?: number;
  y?: number;
  position?: { x: number; y: number };
}

/**
 * Point 9: spatial coordination. `roomPolygon` is in feet. Checks duct depth/aspect,
 * equipment and (optional) terminals being INSIDE the polygon, and terminal-to-terminal spacing.
 */
export function validateSpatialCoordination(
  zones: EquipmentServiceZone[],
  ducts: SteppedDuctSection[],
  roomPolygon: number[],
  terminals: SpatialTerminal[] = [],
  minSpacingFt: number = MIN_TERMINAL_SPACING_FT,
  units?: string
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
    if (aspect > MAX_DUCT_ASPECT_RATIO) {
      hasAspectViolation = true;
      violatingDuctId = d.id;
    }
  }

  const issues: string[] = [];
  const hasPolygon = Array.isArray(roomPolygon) && roomPolygon.length >= 6;
  if (hasPolygon) {
    for (const z of zones) {
      const p = z.equipmentPosition;
      if (p && !isPointInPolygon(p.x, p.y, roomPolygon)) issues.push(`Equipment ${z.unitTag} lies outside the room polygon`);
    }
  }
  const pts: { id: string; x: number; y: number }[] = [];
  terminals.forEach((t, i) => {
    const x = t.position?.x ?? t.x;
    const y = t.position?.y ?? t.y;
    if (typeof x === 'number' && typeof y === 'number') pts.push({ id: t.id ?? `T${i + 1}`, x, y });
  });
  if (hasPolygon) {
    for (const t of pts) if (!isPointInPolygon(t.x, t.y, roomPolygon)) issues.push(`Terminal ${t.id} lies outside the room polygon`);
  }
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < minSpacingFt - 1e-6) issues.push(`Terminals ${pts[i].id} and ${pts[j].id} are ${formatLength(d, units)} apart (minimum ${formatLength(minSpacingFt, units)})`);
    }
  }
  const hasPlacementViolation = issues.length > 0;

  const passed = !hasDepthViolation && !hasAspectViolation && !hasPlacementViolation;
  const maxDuctHeight = ducts.length ? Math.max(...ducts.map((d) => d.heightIn || 12)) : 0;
  const aspectLimit = MAX_DUCT_ASPECT_RATIO.toFixed(1);

  const reasons: string[] = [];
  if (hasDepthViolation || hasAspectViolation) {
    reasons.push(`duct ${violatingDuctId}: ${hasDepthViolation ? 'Exceeds ceiling depth' : `Aspect ratio exceeds ${aspectLimit}`}`);
  }
  if (hasPlacementViolation) reasons.push(issues.slice(0, 3).join('; ') + (issues.length > 3 ? ` (+${issues.length - 3} more)` : ''));

  return {
    pointIndex: 9,
    pointName: '3D Spatial Coordination & Clash Check',
    status: passed ? 'PASS' : 'WARNING',
    metric: `Max Duct Height: ${fmtIn(maxDuctHeight, units)} vs Available Depth: ${fmtIn(maxCeilingDepth, units)}, Aspect Ratios <= ${aspectLimit}, Terminals checked: ${pts.length}`,
    criteria: `Duct Height <= ${fmtIn(maxCeilingDepth, units)}, Aspect Ratio <= ${aspectLimit}, Terminals/equipment inside room, Terminal spacing >= ${formatLength(minSpacingFt, units)}`,
    message: passed
      ? `All ductwork, equipment, and terminals comply with available ${fmtIn(maxCeilingDepth, units)} ceiling depth and architectural clearances`
      : `Spatial coordination warning in ${reasons.join(' | ')}`
  };
}
