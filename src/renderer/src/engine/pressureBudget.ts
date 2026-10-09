import type { EquipmentCatalogItem, FanOperatingPoint } from './types'
import { requirePositive, METERS_PER_FOOT } from './engineeringInputs'
import { calculateFittingLoss } from './staticPressureCalc'
import { sizeDuct } from './ductSizer'

/**
 * Single pressure budget shared by the system generator (candidate screening) and the deployment
 * validator (acceptance). Both must call these helpers so a candidate the generator marks valid
 * cannot be rejected later for fan pressure by an independently derived formula.
 */

/** Clean MERV 8 filter allowance, taken from the fitting catalogue (never a separate constant). */
export const FILTER_ALLOWANCE_IN_WG = calculateFittingLoss('filter-merv8', 800).deltaPInWg
/** Design margin applied to the summed path losses. */
export const PRESSURE_SAFETY_FACTOR = 1.15

/**
 * External static pressure a unit's fan must deliver: the supply path (duct, fittings, diffuser) plus the
 * return path (duct, grille) plus the filter, times the safety factor.
 */
export function requiredExternalStaticPressure(path: { supplyPathInWg: number; returnPathInWg: number }): number {
  return (path.supplyPathInWg + path.returnPathInWg + FILTER_ALLOWANCE_IN_WG) * PRESSURE_SAFETY_FACTOR
}

/**
 * Pressure the equipment fan can deliver at an actual per-unit flow, from its published curve, capped at the
 * rated maximum. Throws when the flow is outside equipment limits or the curve gives no evidence at that flow.
 */
export function availableFanPressureAtFlow(equipment: EquipmentCatalogItem, flow: number): number {
  requirePositive('Fan airflow', flow)
  if (flow < equipment.minCfm - 1 || flow > equipment.maxCfm + 1)
    throw new Error('Per-unit airflow lies outside equipment limits')
  const perf = equipment.fanPerformance
  if (!perf) throw new Error('Missing fan performance evidence')
  const interpolate = (table: FanOperatingPoint[]): number | undefined => {
    const sorted = [...table].sort((a, b) => a.cfm - b.cfm)
    if (
      !sorted.length ||
      sorted.some(
        (p) => !Number.isFinite(p.cfm) || p.cfm <= 0 || !Number.isFinite(p.espInWg) || p.espInWg < 0
      )
    )
      throw new Error('Invalid fan curve')
    if (sorted.some((p, i) => i > 0 && p.cfm === sorted[i - 1].cfm))
      throw new Error('Ambiguous fan curve')
    if (flow < sorted[0].cfm || flow > sorted.at(-1)!.cfm) {
      if (!perf.allowExtrapolation) return undefined
      // Do not invent pressure beyond the provided curve even when extrapolation is allowed.
      return flow < sorted[0].cfm ? sorted[0].espInWg : sorted.at(-1)!.espInWg
    }
    if (sorted.length === 1) return sorted[0].espInWg
    for (let i = 1; i < sorted.length; i++)
      if (flow <= sorted[i].cfm) {
        const a = sorted[i - 1],
          b = sorted[i]
        return a.espInWg + ((b.espInWg - a.espInWg) * (flow - a.cfm)) / (b.cfm - a.cfm)
      }
    return undefined
  }
  let available: number | undefined
  if (perf.table) available = interpolate(perf.table)
  else if (perf.speeds) {
    const values = Object.values(perf.speeds)
      .map(interpolate)
      .filter((v): v is number => v !== undefined)
    if (values.length) available = Math.max(...values)
  } else if (perf.coefficients) {
    const c = perf.coefficients
    if (
      !Object.values(c).every(Number.isFinite) ||
      c.minCfm <= 0 ||
      c.maxCfm < c.minCfm ||
      c.maxEsp < 0
    )
      throw new Error('Invalid fan coefficients')
    if (flow >= c.minCfm && flow <= c.maxCfm)
      available = Math.min(c.maxEsp, c.a + c.b * flow + c.c * flow * flow)
  }
  if (available === undefined || !Number.isFinite(available) || available < 0)
    throw new Error('Missing fan pressure at actual per-unit airflow')
  return Math.min(available, equipment.maxRatedEspInWg)
}

/** Pressure drop deployment assigns to a return grille (see planDuctedAirDistribution). */
export const RETURN_GRILLE_DELTA_P_IN_WG = 0.04
/** Friction rate below which deployment never credits a duct (validateNetwork floors at 0.10 in.wg/100 ft). */
export const FRICTION_FLOOR_IN_WG_PER_100FT = 0.1
/** Longest return run the planner generates (50 planning units = 5 ft) plus slack for the unit-to-grille diagonal. */
const RETURN_RUN_FT = 7

export interface RoutedPathEstimateInput {
  /** Terminals fed by one unit. */
  terminalsPerUnit: number
  /** Pressure drop across one supply terminal at its design flow. */
  diffuserDeltaPInWg: number
  /** Plan extent of the room (bounding box) in feet. */
  widthFt: number
  heightFt: number
  /** Airflow through one unit; sets the velocity at which fittings are charged. */
  perUnitCfm: number
}

export interface RoutedPathEstimate {
  supplyDuctInWg: number
  supplyFittingsInWg: number
  /** Duct + fittings + diffuser. */
  supplyPathInWg: number
  /** Return run + grille. */
  returnPathInWg: number
  diffuserInWg: number
  filterInWg: number
  /** Everything before the safety factor. */
  totalLossInWg: number
  requiredEspInWg: number
}

/**
 * Conservative routed-path estimate used before a layout exists. It assumes the farthest terminal is a
 * Manhattan run of (width + height) from the corner-mounted unit, at the deployment friction floor, with
 * elbows and branch take-offs at the unit trunk velocity, plus the diffuser drop, the return
 * grille and run, and the filter. It is deliberately not below what deployment later computes.
 */
export function estimateRoutedPathPressure(input: RoutedPathEstimateInput): RoutedPathEstimate {
  // Fittings are charged at the velocity of the unit-level trunk (the highest on any path), for the
  // lowest planner duct height, so downstream ducts can only be cheaper than this assumption.
  const velocity = Math.max(
    ...[10].map((h) => {
      const size = sizeDuct(input.perUnitCfm, FRICTION_FLOOR_IN_WG_PER_100FT, h)
      return input.perUnitCfm / Math.max(0.1, (size.widthIn * size.heightIn) / 144)
    })
  )
  // A single terminal sits at the room centre, so the run from the corner-mounted unit is about half the
  // Manhattan extent; multiple terminals spread to the far side and need the full extent.
  const single = input.terminalsPerUnit <= 1
  const supplyLengthFt = (Math.max(0, input.widthFt) + Math.max(0, input.heightFt)) * (single ? 0.6 : 1)
  const supplyDuct = (FRICTION_FLOOR_IN_WG_PER_100FT * supplyLengthFt) / 100
  const elbows = 1
  const tees = single ? 0 : 1
  const supplyFittings =
    elbows * calculateFittingLoss('elbow-90-unvaned', velocity).deltaPInWg +
    tees * calculateFittingLoss('branch-tee', velocity).deltaPInWg
  const supplyPath = supplyDuct + supplyFittings + input.diffuserDeltaPInWg
  const returnPath = (FRICTION_FLOOR_IN_WG_PER_100FT * RETURN_RUN_FT) / 100 + RETURN_GRILLE_DELTA_P_IN_WG
  return {
    supplyDuctInWg: supplyDuct,
    supplyFittingsInWg: supplyFittings,
    supplyPathInWg: supplyPath,
    returnPathInWg: returnPath,
    diffuserInWg: input.diffuserDeltaPInWg,
    filterInWg: FILTER_ALLOWANCE_IN_WG,
    totalLossInWg: supplyPath + returnPath + FILTER_ALLOWANCE_IN_WG,
    requiredEspInWg: requiredExternalStaticPressure({ supplyPathInWg: supplyPath, returnPathInWg: returnPath })
  };
}

/** Bounding-box extent of a drawn zone in feet, for the generator's routed-path estimate. */
export function zoneExtentFt(
  points: number[],
  project: { scale: number; units: 'imperial' | 'metric' }
): { widthFt: number; heightFt: number } {
  const upf = project.scale * (project.units === 'metric' ? METERS_PER_FOOT : 1)
  const xs = points.filter((_, i) => i % 2 === 0)
  const ys = points.filter((_, i) => i % 2 === 1)
  return { widthFt: (Math.max(...xs) - Math.min(...xs)) / upf, heightFt: (Math.max(...ys) - Math.min(...ys)) / upf }
}
