/**
 * N^1.85 hydraulic graph of one sprinkler zone: the model shared by the FS-60x sheets and the HTML report.
 * The x axis is proportional to Q^1.85 (Hazen-Williams friction is a straight line on it), gridlines are labelled in gpm;
 * the y axis is pressure in psi. Curves are returned as [gpm, psi] points; render with x = (Q / qMax)^1.85.
 */
import type { FireDesignResult } from '../fpTypes'
import type { RemoteAreaResult, SprinklerZoneResult } from '../sprinkler/sprinklerTypes'

export const HW_EXP = 1.85

export interface GraphTick {
  value: number
  /** Normalised position 0..1 on the axis. */
  pos: number
  label: string
  /** false when the label would touch the previous one (the gridline is still drawn). */
  showLabel: boolean
}

export interface HydraulicGraphModel {
  qMax: number
  pMax: number
  xTicks: GraphTick[]
  yTicks: GraphTick[]
  supplyLabel: string
  /** Supply curve [gpm, psi], clipped to qMax. */
  supply: [number, number][]
  /** Sprinkler demand at the source (without hose). */
  demand: [number, number]
  /** Demand with the hose allowance (same pressure, flow incl. hose). */
  demandHose: [number, number]
  /** Supply pressure at the flow incl. hose. */
  supplyAtDemand: [number, number]
  marginPsi: number
  adequate: boolean
}

const niceStep = (m: number, n: number): number => {
  const raw = Math.max(m, 1e-9) / n
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  return ([1, 2, 2.5, 5, 10].find((k) => k * p >= raw) ?? 10) * p
}

/** x position (0..1) of flow q on a graph whose axis ends at qMax. */
export const graphX = (q: number, qMax: number): number => Math.pow(Math.max(q, 0) / qMax, HW_EXP)

/** Supply curve for the graph: sprinkler design curve, else the selected fire pump, else a flat line. */
function supplyPoints(
  r: FireDesignResult,
  g: RemoteAreaResult
): { label: string; pts: [number, number][] } {
  const cur = r.sprinklers?.supplyCurve
  if (cur && cur.points.length >= 2) return { label: cur.label, pts: cur.points }
  const pump = r.pumps?.mainPumps?.[0]
  if (pump && pump.ratedFlowGpm > 0) {
    const pts: [number, number][] = []
    for (const k of [0, 0.5, 1, 1.25, 1.5]) {
      const x = k
      pts.push([
        k * pump.ratedFlowGpm,
        pump.ratedNetPressurePsi * (1.2 + 0.066667 * x - 0.266667 * x * x) +
          (r.pumps.suctionPressureMinPsi ?? 0)
      ])
    }
    return {
      label: `Fire pump ${pump.tag}: net pressure curve plus minimum suction pressure`,
      pts
    }
  }
  const qEnd = Math.max(g.totalDemandGpm * 1.6, 1)
  return {
    label: 'Available supply pressure',
    pts: [
      [0, g.availablePsi],
      [qEnd, g.availablePsi]
    ]
  }
}

/** Clip an ascending-flow curve at qMax; interpolation is linear in Q^1.85 (the axis of the graph). */
function clipCurve(pts: [number, number][], qMax: number): [number, number][] {
  const out: [number, number][] = []
  const xm = Math.pow(qMax, HW_EXP)
  for (let i = 0; i < pts.length; i++) {
    const [q, p] = pts[i]
    if (q <= qMax + 1e-9) {
      out.push([q, p])
      continue
    }
    if (i > 0 && pts[i - 1][0] < qMax) {
      const x1 = Math.pow(pts[i - 1][0], HW_EXP)
      const x2 = Math.pow(q, HW_EXP)
      const t = (xm - x1) / (x2 - x1)
      out.push([qMax, pts[i - 1][1] + t * (p - pts[i - 1][1])])
    }
    break
  }
  return out
}

export function buildHydraulicGraph(
  r: FireDesignResult,
  zone: Pick<SprinklerZoneResult, 'governing'>
): HydraulicGraphModel | null {
  const g = zone.governing
  if (!g) return null
  const sup = supplyPoints(r, g)
  const totalQ = Math.max(g.totalDemandGpm, g.flowAtSourceGpm, 1)
  const qStep = niceStep(totalQ * 1.7, 8)
  const qMax = Math.ceil((totalQ * 1.7) / qStep) * qStep
  const supply = clipCurve(
    sup.pts.slice().sort((a, b) => a[0] - b[0]),
    qMax
  )
  const pTop =
    Math.max(...supply.map((p) => p[1]), g.pressureAtSourcePsi, g.availablePsi) * 1.1 || 10
  const pStep = niceStep(pTop, 7)
  const pMax = Math.ceil(pTop / pStep) * pStep
  const xTicks: GraphTick[] = []
  let lastShown = -1
  for (let q = 0; q <= qMax + 1e-6; q += qStep) {
    const pos = graphX(q, qMax)
    const show = lastShown < 0 || pos - lastShown >= 0.06
    if (show) lastShown = pos
    xTicks.push({ value: q, pos, label: String(Math.round(q)), showLabel: show })
  }
  const yTicks: GraphTick[] = []
  for (let p = 0; p <= pMax + 1e-6; p += pStep)
    yTicks.push({ value: p, pos: p / pMax, label: String(Math.round(p)), showLabel: true })
  return {
    qMax,
    pMax,
    xTicks,
    yTicks,
    supplyLabel: sup.label,
    supply,
    demand: [g.flowAtSourceGpm, g.pressureAtSourcePsi],
    demandHose: [g.flowAtSourceGpm + g.hoseAllowanceGpm, g.pressureAtSourcePsi],
    supplyAtDemand: [g.flowAtSourceGpm + g.hoseAllowanceGpm, g.availablePsi],
    marginPsi: g.marginPsi,
    adequate: g.marginPsi >= 0
  }
}

/** Largest velocity (ft/s) of a zone's governing remote area. */
export const maxVelocityFps = (g: RemoteAreaResult | null): number =>
  g && g.rows.length > 0 ? Math.max(...g.rows.map((row) => row.velocityFps)) : 0
