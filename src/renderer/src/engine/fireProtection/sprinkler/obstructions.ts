/**
 * Obstructions to sprinkler discharge (NFPA 13-2019 §10.2.7): detection from DXF layers and classification of each
 * obstruction into the beam rule, the three-times rule, wide obstructions (sprinklers below) or a wall (deep beam).
 * Footprints are handled by their bounding box (rectangles in practice).
 */
import type {
  FloorPlan,
  ObstructionKind,
  ObstructionLayerMapping,
  ObstructionResult,
  SprinklerObstruction
} from './sprinklerTypes'
import {
  MIN_WALL_DISTANCE_MM,
  WIDE_OBSTRUCTION_MM,
  beamRuleMinAFt,
  threeTimesClearanceMm
} from './nfpa13Sprinkler'

const MM_PER_FT = 304.8
const MM_PER_IN = 25.4

/** Default deflector distance below the ceiling, mm (NFPA 13-2019 §10.2.6.1.1). */
export const DEFAULT_DEFLECTOR_MM = 100

/** Kinds treated as continuous (beam rule); the others are discrete (three-times rule). */
export const CONTINUOUS_KINDS: ObstructionKind[] = ['beam', 'duct', 'cable-tray', 'pipe']

/** Closed polylines on the mapped layers become obstructions OB1… in drawing order. */
export function detectObstructions(
  plan: FloorPlan,
  mappings: ObstructionLayerMapping[]
): SprinklerObstruction[] {
  const out: SprinklerObstruction[] = []
  for (const e of plan.entities) {
    if (e.kind !== 'polyline' || !e.closed || e.points.length < 3) continue
    const m = mappings.find((q) => q.layer.toLowerCase() === e.layer.toLowerCase())
    if (!m) continue
    out.push({
      id: `OB${out.length + 1}`,
      kind: m.kind,
      polygon: e.points.map(([x, y]) => [x, y] as [number, number]),
      bottomBelowCeilingMm: m.bottomBelowCeilingMm,
      source: 'detected'
    })
  }
  return out
}

/** An obstruction classified for the layout. */
export interface ObstructionGeom {
  ob: SprinklerObstruction
  xLo: number
  xHi: number
  yLo: number
  yHi: number
  widthMm: number
  lengthMm: number
  /** Axis of the longer side of the footprint ('x' on a tie). */
  longAxis: 'x' | 'y'
  /** Deflector height above the bottom of the obstruction, in (≤ 0: the obstruction is above the deflector). */
  bIn: number
  rule: ObstructionResult['rule']
  /** Minimum plan distance from a ceiling sprinkler to the footprint, mm (wall: the 102 mm wall distance). */
  requiredClearanceMm: number
  /** Acts as a wall: divides the area into bays (deep beam, or a wide obstruction beyond the beam table). */
  wall: boolean
  /** Bottom at or above the deflector: nothing to clear. */
  inactive: boolean
}

const round2 = (v: number): number => Math.round(v * 100) / 100

export function analyseObstruction(
  ob: SprinklerObstruction,
  deflectorBelowCeilingMm: number = DEFAULT_DEFLECTOR_MM
): ObstructionGeom {
  let xLo = Infinity
  let xHi = -Infinity
  let yLo = Infinity
  let yHi = -Infinity
  for (const [x, y] of ob.polygon) {
    xLo = Math.min(xLo, x)
    xHi = Math.max(xHi, x)
    yLo = Math.min(yLo, y)
    yHi = Math.max(yHi, y)
  }
  const dx = xHi - xLo
  const dy = yHi - yLo
  const widthMm = round2(Math.min(dx, dy))
  const lengthMm = round2(Math.max(dx, dy))
  const longAxis: 'x' | 'y' = dx >= dy ? 'x' : 'y'
  const bIn = (ob.bottomBelowCeilingMm - deflectorBelowCeilingMm) / MM_PER_IN
  const continuous = CONTINUOUS_KINDS.includes(ob.kind)
  // A column reaches the floor: sprinklers cannot be installed below it, so it always follows the three-times rule.
  const wide = widthMm > WIDE_OBSTRUCTION_MM && ob.kind !== 'column'
  const base = { ob, xLo, xHi, yLo, yHi, widthMm, lengthMm, longAxis, bIn }
  if (bIn <= 1e-9) {
    return {
      ...base,
      rule: continuous && !wide ? 'beam' : wide ? 'wide' : 'three-times',
      requiredClearanceMm: 0,
      wall: false,
      inactive: true
    }
  }
  const minA = beamRuleMinAFt(bIn)
  if (wide) {
    const beyond = !Number.isFinite(minA)
    return {
      ...base,
      rule: 'wide',
      requiredClearanceMm: beyond ? MIN_WALL_DISTANCE_MM : minA * MM_PER_FT,
      wall: beyond,
      inactive: false
    }
  }
  if (continuous) {
    if (!Number.isFinite(minA))
      return {
        ...base,
        rule: 'wall',
        requiredClearanceMm: MIN_WALL_DISTANCE_MM,
        wall: true,
        inactive: false
      }
    return {
      ...base,
      rule: 'beam',
      requiredClearanceMm: minA * MM_PER_FT,
      wall: false,
      inactive: false
    }
  }
  return {
    ...base,
    rule: 'three-times',
    requiredClearanceMm: threeTimesClearanceMm(Math.max(widthMm, lengthMm)),
    wall: false,
    inactive: false
  }
}

/** Plan distance from a point to the footprint (bounding box), 0 inside. */
export function distanceToObstruction(g: ObstructionGeom, x: number, y: number): number {
  const dx = Math.max(g.xLo - x, 0, x - g.xHi)
  const dy = Math.max(g.yLo - y, 0, y - g.yHi)
  return Math.hypot(dx, dy)
}

/** Result record of an obstruction before heads are attached. */
export function emptyObstructionResult(g: ObstructionGeom): ObstructionResult {
  return {
    id: g.ob.id,
    kind: g.ob.kind,
    widthMm: g.widthMm,
    lengthMm: g.lengthMm,
    bottomBelowCeilingMm: g.ob.bottomBelowCeilingMm,
    rule: g.rule,
    requiredClearanceMm: g.requiredClearanceMm,
    headsBelow: [],
    relocatedHeads: [],
    violations: []
  }
}
