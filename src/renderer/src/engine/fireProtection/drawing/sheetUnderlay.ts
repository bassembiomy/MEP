/**
 * Architectural underlay shared by the sprinkler (FS-1nn) and CO2 (CO-1nn) floor sheets: the client's floor plan
 * (importFloorPlanDxf) re-drawn on `A-*` layers, mapped into the sheet and clipped to a window. Text is not drawn.
 */
import { importFloorPlanDxf } from '../sprinkler/floorPlanImport'
import type { DrawingUnits, FloorPlan } from '../sprinkler/sprinklerTypes'
import type { DrawingBuilder } from './drawingBuilder'
import { archLayerName, clipSegment } from './sprinklerSheetKit'

type Pt = [number, number]

export interface ClipWindow {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Parse a floor plan DXF; null when absent or unreadable (the sheet is then drawn without underlay). */
export function loadFloorPlan(planDxf: string | undefined, units?: DrawingUnits): FloorPlan | null {
  if (!planDxf) return null
  try {
    return importFloorPlanDxf(planDxf, units)
  } catch {
    return null
  }
}

/** Draw the plan entities (A-* layers) through the point mapping `M`, clipped to `win`. */
export function drawArchUnderlay(
  b: DrawingBuilder,
  plan: FloorPlan,
  M: (p: Pt) => Pt,
  win: ClipWindow
): void {
  const inside = (p: Pt): boolean =>
    p[0] >= win.x0 && p[0] <= win.x1 && p[1] >= win.y0 && p[1] <= win.y1
  for (const e of plan.entities) {
    if (e.kind === 'text') continue
    const layer = archLayerName(e.layer)
    if (e.kind === 'line' && e.points.length >= 2) {
      const a = M(e.points[0])
      const z = M(e.points[1])
      const cl = clipSegment(a[0], a[1], z[0], z[1], win)
      if (cl) b.line(layer, cl[0], cl[1], cl[2], cl[3])
    } else if (e.kind === 'polyline') {
      const pts = e.points.map(M)
      if (pts.every(inside)) b.polyline(layer, pts, e.closed)
      else {
        const n = e.closed ? pts.length : pts.length - 1
        for (let i = 0; i < n; i++) {
          const a = pts[i]
          const z = pts[(i + 1) % pts.length]
          const cl = clipSegment(a[0], a[1], z[0], z[1], win)
          if (cl) b.line(layer, cl[0], cl[1], cl[2], cl[3])
        }
      }
    } else if (
      (e.kind === 'circle' || e.kind === 'arc') &&
      e.points.length >= 1 &&
      e.radius &&
      e.radius > 0
    ) {
      const m = M(e.points[0])
      if (
        inside([m[0] - e.radius, m[1] - e.radius]) &&
        inside([m[0] + e.radius, m[1] + e.radius])
      ) {
        if (e.kind === 'circle') b.circle(layer, m[0], m[1], e.radius)
        else b.arc(layer, m[0], m[1], e.radius, e.startDeg ?? 0, e.endDeg ?? 360)
      }
    }
  }
}
