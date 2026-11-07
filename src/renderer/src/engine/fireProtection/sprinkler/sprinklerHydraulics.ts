/**
 * Sprinkler hydraulics (NFPA 13-2019 Ch. 19 & 28): remote design area selection, node-to-node Hazen-Williams
 * calculation of the arms (branch lines), cross main, floor control nipple, building riser and feed main, and the
 * water supply comparison. US units (gpm, psi, ft); geometry in mm.
 */
import type { FittingType, HazardClass, HydraulicNodeRow, PipeRun, PipeSpec } from '../fpTypes'
import {
  elevationPsi,
  fittingsEquivalentFt,
  hazenWilliamsPsiPerFt,
  velocityFps
} from '../hydraulics'
import { HAZARD_DESIGN } from '../standards/nfpa13'
import { internalDiameterIn, nextLargerSize } from '../standards/pipeData'
import { DRY_AREA_INCREASE, hazenC } from './nfpa13Sprinkler'
import type { FloorPiping, PipingArm } from './pipingLayout'
import type {
  PlacedSprinkler,
  RemoteAreaResult,
  SprinklerAnswers,
  SprinklerFloorInput,
  SprinklerHeadType,
  SprinklerPipe,
  SprinklerSystemType
} from './sprinklerTypes'

export const FT_PER_M = 3.28084
const MM_PER_FT = 304.8
const EPS = 1e-9

/** Fire-engine context: where the sprinkler riser meets the pump (NFPA 13-2019 §28.2.5 elevation pressure). */
export interface SourceContext {
  /** Pump centre-line elevation relative to the ground-floor FFL, m. */
  pumpCLAbsM: number
  feedMain: PipeRun
  insideHoseGpm: number
}

export interface FloorHydraulicContext {
  /** Branch-line direction of the floor (cross main runs perpendicular). */
  direction: 'x' | 'y'
  pipeMaterial: SprinklerAnswers['pipeMaterial']
  hazardOf: (tag: string) => HazardClass
  /** Floor pipe elevation, m (ground-floor FFL = 0). */
  pipeElevationM: number
  buildingRiserIn: number
  buildingRiserSchedule: 'sch40' | 'sch10'
  supply: SprinklerAnswers['supply']
  source?: SourceContext
  /** System zone being calculated (default 'Z1'). */
  zoneId?: string
}

export interface FloorDemandOutput {
  result: RemoteAreaResult
  /** Ids of the floor pipes that carried flow in this remote area (upsizing candidates). */
  carriedPipeIds: string[]
  /** Candidate heads of this hazard and heads needed to fill the design area. */
  candidateCount: number
  requiredHeads: number
  remoteHeadTag: string
}

interface ArmCalc {
  arm: PipingArm
  rows: HydraulicNodeRow[]
  q: number
  p: number
  pipeIds: string[]
  k: number // equivalent K = Q / sqrt(P at junction)
}

interface CmStep {
  pipe: SprinklerPipe
  from: string
  to: string
}

/**
 * One node-to-node Hazen-Williams segment (NFPA 13-2019 §28.2). Fitting equivalent lengths come from Table 28.2.3.1.1
 * adjusted for the pipe's C value (§28.2.3.1.2, e.g. × 0.713 at C = 100) via the shared `fittingsEquivalentFt`.
 */
function calculatePipeSegment(args: {
  fromNode: string
  toNode: string
  description: string
  flowAddedGpm: number
  kFactor?: number
  totalFlowGpm: number
  startPressurePsi: number
  run: PipeRun
}): HydraulicNodeRow {
  const { run } = args
  const idIn = internalDiameterIn(run.pipe.nominalIn, run.pipe.schedule)
  const { eqFt, desc } = fittingsEquivalentFt(run.fittings, run.pipe)
  const totalLengthFt = run.lengthFt + eqFt
  const pfPerFt = hazenWilliamsPsiPerFt(args.totalFlowGpm, idIn, run.pipe.c)
  const pfPsi = pfPerFt * totalLengthFt
  const pePsi = elevationPsi(run.elevationRiseFt)
  return {
    fromNode: args.fromNode,
    toNode: args.toNode,
    description: args.description,
    kFactor: args.kFactor,
    flowAddedGpm: args.flowAddedGpm,
    totalFlowGpm: args.totalFlowGpm,
    nominalIn: run.pipe.nominalIn,
    idIn,
    c: run.pipe.c,
    lengthFt: run.lengthFt,
    fittingsDesc: desc,
    fittingsEqFt: eqFt,
    totalLengthFt,
    pfPerFt,
    pfPsi,
    elevationFt: run.elevationRiseFt,
    pePsi,
    ptStartPsi: args.startPressurePsi,
    ptEndPsi: args.startPressurePsi + pfPsi + pePsi,
    velocityFps: velocityFps(args.totalFlowGpm, idIn)
  }
}

/** True when the supply of a remote area is inadequate: available pressure below the demand (margin < 0, NFPA 13 §28.2). */
export function supplyShort(ra: RemoteAreaResult): boolean {
  return ra.marginPsi < 0
}

/** City supply curve (NFPA 13-2019 §5.2 / Hazen-Williams 1.85 power), psi available at `flowGpm`. */
export function citySupplyAvailablePsi(
  s: { staticPsi: number; residualPsi: number; residualFlowGpm: number },
  flowGpm: number
): number {
  return s.staticPsi - (s.staticPsi - s.residualPsi) * Math.pow(flowGpm / s.residualFlowGpm, 1.85)
}

/** Increase a pipe one nominal size (maximum 8"). */
export function upsizeOne(sizeIn: number): number {
  return sizeIn >= 8 ? sizeIn : Math.min(8, nextLargerSize(sizeIn))
}

export function calculateFloorDemand(
  floor: SprinklerFloorInput,
  layout: FloorPiping,
  heads: PlacedSprinkler[],
  headTypes: SprinklerHeadType[],
  systemType: SprinklerSystemType,
  hazard: HazardClass,
  ctx: FloorHydraulicContext
): FloorDemandOutput | null {
  const swap = ctx.direction === 'y'
  const uOf = (x: number, y: number): number => (swap ? y : x)
  const vOf = (x: number, y: number): number => (swap ? x : y)
  const pipeById = new Map(layout.pipes.map((p) => [p.id, p]))
  const headByTag = new Map(heads.map((h) => [h.tag, h]))
  const typeById = new Map(headTypes.map((t) => [t.id, t]))
  const kOf = (tag: string): number => typeById.get(headByTag.get(tag)!.headTypeId)!.kFactor
  const c = hazenC(ctx.pipeMaterial, systemType)
  const specOf = (p: SprinklerPipe): PipeSpec => ({ nominalIn: p.sizeIn, schedule: p.schedule, c })
  const runOf = (p: SprinklerPipe, fittings: Partial<Record<FittingType, number>>): PipeRun => ({
    pipe: specOf(p),
    lengthFt: p.lengthM * FT_PER_M,
    elevationRiseFt: 0,
    fittings
  })
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]))
  const FC = layout.fcNode
  const fc = nodeById.get(FC)!
  const fcV = vOf(fc.x, fc.y)
  const nodeV = (id: string): number => {
    const n = nodeById.get(id)!
    return vOf(n.x, n.y)
  }

  // cross-main graph
  const adj = new Map<string, { to: string; pipe: SprinklerPipe }[]>()
  for (const p of layout.pipes) {
    if (p.kind !== 'cross-main') continue
    if (!adj.has(p.fromNode)) adj.set(p.fromNode, [])
    if (!adj.has(p.toNode)) adj.set(p.toNode, [])
    adj.get(p.fromNode)!.push({ to: p.toNode, pipe: p })
    adj.get(p.toNode)!.push({ to: p.fromNode, pipe: p })
  }
  const cmPath = (from: string, to: string): CmStep[] => {
    if (from === to) return []
    const prev = new Map<string, { node: string; pipe: SprinklerPipe }>()
    const seen = new Set<string>([from])
    const queue = [from]
    while (queue.length) {
      const n = queue.shift()!
      if (n === to) break
      for (const e of adj.get(n) ?? []) {
        if (seen.has(e.to)) continue
        seen.add(e.to)
        prev.set(e.to, { node: n, pipe: e.pipe })
        queue.push(e.to)
      }
    }
    const steps: CmStep[] = []
    let cur = to
    while (cur !== from) {
      const pr = prev.get(cur)
      if (!pr) return []
      steps.unshift({ pipe: pr.pipe, from: pr.node, to: cur })
      cur = pr.node
    }
    return steps
  }

  const armOfHead = new Map<string, PipingArm>()
  for (const a of layout.arms) for (const t of a.heads) armOfHead.set(t, a)
  const armPipeLen = (arm: PipingArm, tag: string): number => {
    let len = 0
    const idx = arm.heads.indexOf(tag)
    for (let i = 1; i <= idx + 1; i++) len += pipeById.get(`B-${arm.id}-${i}`)!.lengthM * 1000
    return len
  }
  const toFcLen = new Map<string, number>()
  const cmLenFrom = (j: string): number => {
    if (!toFcLen.has(j))
      toFcLen.set(
        j,
        cmPath(j, FC).reduce((s, st) => s + st.pipe.lengthM * 1000, 0)
      )
    return toFcLen.get(j)!
  }
  const pathLen = (tag: string): number => {
    const arm = armOfHead.get(tag)!
    return armPipeLen(arm, tag) + cmLenFrom(arm.junction)
  }

  // ── remote area selection ──
  const hz = HAZARD_DESIGN[hazard]
  const candidates = heads.filter((h) => ctx.hazardOf(h.tag) === hazard)
  if (candidates.length === 0) return null
  const dry = systemType === 'dry' || systemType === 'preaction-double'
  const baseArea = hz.areaFt2
  const designArea = baseArea * (dry ? DRY_AREA_INCREASE : 1)

  let remote = candidates[0]
  for (const h of candidates.slice(1)) {
    const dl = pathLen(h.tag) - pathLen(remote.tag)
    if (Math.abs(dl) > 1e-6) {
      if (dl > 0) remote = h
      continue
    }
    const dv = Math.abs(vOf(h.x, h.y) - fcV) - Math.abs(vOf(remote.x, remote.y) - fcV)
    if (Math.abs(dv) > 1e-6) {
      if (dv > 0) remote = h
      continue
    }
    const du = uOf(h.x, h.y) - uOf(remote.x, remote.y)
    if (Math.abs(du) > 1e-6) {
      if (du > 0) remote = h
      continue
    }
    if (vOf(h.x, h.y) > vOf(remote.x, remote.y)) remote = h
  }

  // a sprinkler below an obstruction protects a small area: the ceiling sprinklers set the design area count
  const ref = remote.belowObstruction
    ? (candidates.filter((h) => !h.belowObstruction).sort((a, b) => b.areaFt2 - a.areaFt2)[0] ?? remote)
    : remote
  const nRequired = Math.ceil(designArea / ref.areaFt2 - EPS)
  const nb = Math.max(
    1,
    Math.ceil((1.2 * Math.sqrt(designArea)) / (ref.spacingSmm / MM_PER_FT) - EPS)
  )
  const flowing = new Set<string>()
  const candSet = new Set(candidates.map((h) => h.tag))
  if (systemType === 'deluge') {
    for (const h of heads) flowing.add(h.tag)
  } else if (candidates.length <= nRequired) {
    for (const h of candidates) flowing.add(h.tag)
  } else {
    const remoteArm = armOfHead.get(remote.tag)!
    const jr = nodeV(remoteArm.junction)
    const armsWith = layout.arms.filter((a) => a.heads.some((t) => candSet.has(t)))
    armsWith.sort((a, b) => {
      if (a === remoteArm) return -1
      if (b === remoteArm) return 1
      const da = Math.abs(nodeV(a.junction) - jr)
      const db = Math.abs(nodeV(b.junction) - jr)
      if (Math.abs(da - db) > 1e-6) return da - db
      const fa = Math.abs(nodeV(a.junction) - fcV)
      const fb = Math.abs(nodeV(b.junction) - fcV)
      if (Math.abs(fa - fb) > 1e-6) return fb - fa
      return (a.side === 'E' ? 0 : 1) - (b.side === 'E' ? 0 : 1)
    })
    let remaining = nRequired
    for (const arm of armsWith) {
      if (remaining <= 0) break
      const cands = arm.heads.filter((t) => candSet.has(t))
      const take = Math.min(nb, remaining, cands.length)
      for (const t of cands.slice(cands.length - take)) flowing.add(t)
      remaining -= take
    }
  }
  const flowingTagsOrdered = heads.filter((h) => flowing.has(h.tag)).map((h) => h.tag)

  // ── arm calculation ──
  // minimum flow: density × the largest protection area among the flowing sprinklers (NFPA 13 §10.2.4.1.1)
  let maxFlowArea = remote.areaFt2
  for (const h of heads) if (flowing.has(h.tag)) maxFlowArea = Math.max(maxFlowArea, h.areaFt2)
  const qMin = hz.densityGpmFt2 * maxFlowArea
  const pStart = Math.max(7, Math.pow(qMin / kOf(remote.tag), 2))
  const calcArm = (arm: PipingArm): ArmCalc | null => {
    let idx = -1
    arm.heads.forEach((t, i) => {
      if (flowing.has(t)) idx = i
    })
    if (idx < 0) return null
    const rows: HydraulicNodeRow[] = []
    const pipeIds: string[] = []
    let p = pStart
    let qCum = 0
    for (let i = idx + 1; i >= 1; i--) {
      const tag = arm.heads[i - 1]
      const k = kOf(tag)
      const isFlow = flowing.has(tag)
      const q = isFlow ? k * Math.sqrt(p) : 0
      qCum += q
      const pipe = pipeById.get(`B-${arm.id}-${i}`)!
      pipeIds.push(pipe.id)
      const row = calculatePipeSegment({
        fromNode: tag,
        toNode: i === 1 ? arm.junction : arm.heads[i - 2],
        description:
          i === 1
            ? `Branch line ${arm.id} to cross main`
            : `Branch line ${arm.id}, head ${i} to ${i - 1}`,
        flowAddedGpm: q,
        kFactor: isFlow ? k : undefined,
        totalFlowGpm: qCum,
        startPressurePsi: p,
        run: runOf(pipe, i === 1 ? { 'tee-branch': 1 } : {})
      })
      rows.push(row)
      p = row.ptEndPsi
    }
    return { arm, rows, q: qCum, p, pipeIds, k: qCum / Math.sqrt(p) }
  }

  const remoteArm = armOfHead.get(remote.tag)!
  // The remote arm starts at its farthest flowing head with the remote head pressure.
  const flowingArms = layout.arms.filter((a) => a.heads.some((t) => flowing.has(t)))
  const calcs = new Map<string, ArmCalc>()
  for (const a of flowingArms) {
    const ac = calcArm(a)
    if (ac) calcs.set(a.id, ac)
  }
  const rc = calcs.get(remoteArm.id)!
  const rows: HydraulicNodeRow[] = [...rc.rows]
  const carried = new Set<string>()
  for (const ac of calcs.values()) for (const id of ac.pipeIds) carried.add(id)

  // ── cross main ──
  const handled = new Set<string>([remoteArm.id])
  const addAt = (nodeId: string, p: number): number => {
    let s = 0
    for (const a of flowingArms) {
      if (handled.has(a.id) || a.junction !== nodeId) continue
      handled.add(a.id)
      s += calcs.get(a.id)!.k * Math.sqrt(p)
    }
    return s
  }
  let node = remoteArm.junction
  let p = rc.p
  let q = rc.q
  let added = node === FC ? 0 : addAt(node, p)
  q += added
  for (const st of cmPath(node, FC)) {
    const row = calculatePipeSegment({
      fromNode: st.from,
      toNode: st.to,
      description: 'Cross main',
      flowAddedGpm: added,
      totalFlowGpm: q,
      startPressurePsi: p,
      run: runOf(st.pipe, {})
    })
    rows.push(row)
    carried.add(st.pipe.id)
    p = row.ptEndPsi
    node = st.to
    added = node === FC ? 0 : addAt(node, p)
    q += added
  }
  // arms at FC and arms off the path join at FC
  const pFc = p
  let joinQ = addAt(FC, pFc)
  for (const a of flowingArms) {
    if (handled.has(a.id)) continue
    handled.add(a.id)
    const ka = calcs.get(a.id)!.k
    const path = cmPath(a.junction, FC)
    const pfAt = (Q: number): number => {
      let s = 0
      for (const st of path) {
        s += calculatePipeSegment({
          fromNode: st.from,
          toNode: st.to,
          description: '',
          flowAddedGpm: 0,
          totalFlowGpm: Q,
          startPressurePsi: 0,
          run: runOf(st.pipe, {})
        }).pfPsi
      }
      return s
    }
    let lo = 0
    let hi = ka * Math.sqrt(pFc)
    for (let it = 0; it < 200; it++) {
      const mid = (lo + hi) / 2
      if (Math.pow(mid / ka, 2) + pfAt(mid) - pFc > 0) hi = mid
      else lo = mid
    }
    joinQ += (lo + hi) / 2
    for (const st of path) carried.add(st.pipe.id)
  }
  q += joinQ
  const flowAtFloor = q
  const nipple = pipeById.get(layout.rnId)!
  carried.add(layout.rnId)
  const nipRow = calculatePipeSegment({
    fromNode: FC,
    toNode: layout.rNode,
    description: 'Floor control assembly (butterfly valve, waterflow switch) and riser nipple',
    flowAddedGpm: joinQ,
    totalFlowGpm: q,
    startPressurePsi: pFc,
    run: runOf(nipple, { 'butterfly-valve': 1, 'elbow-90': 2 })
  })
  rows.push(nipRow)
  p = nipRow.ptEndPsi

  // ── building riser and feed main ──
  if (ctx.source) {
    const rise = (ctx.pipeElevationM - ctx.source.pumpCLAbsM) * FT_PER_M
    const riserRow = calculatePipeSegment({
      fromNode: layout.rNode,
      toNode: 'BR',
      description: 'Building riser',
      flowAddedGpm: 0,
      totalFlowGpm: q,
      startPressurePsi: p,
      run: {
        pipe: { nominalIn: ctx.buildingRiserIn, schedule: ctx.buildingRiserSchedule, c },
        lengthFt: Math.max(rise, 0),
        elevationRiseFt: rise,
        fittings: {
          'tee-branch': 1,
          'gate-valve': 1,
          ...(systemType === 'wet' ? { 'alarm-check': 1 } : { 'swing-check': 1 })
        }
      }
    })
    rows.push(riserRow)
    const feedRow = calculatePipeSegment({
      fromNode: 'BR',
      toNode: 'SRC',
      description: 'Feed main to the source',
      flowAddedGpm: 0,
      totalFlowGpm: q,
      startPressurePsi: riserRow.ptEndPsi,
      run: ctx.source.feedMain
    })
    rows.push(feedRow)
    p = feedRow.ptEndPsi
  }

  // ── supply ──
  const hose =
    ctx.supply.kind === 'city' ? hz.hoseTotalGpm : (ctx.source?.insideHoseGpm ?? hz.hoseInsideGpm)
  const total = q + hose
  let available = 0
  let margin = 0
  if (ctx.supply.kind === 'city') {
    available = citySupplyAvailablePsi(ctx.supply, total)
    margin = available - p
  }
  const result: RemoteAreaResult = {
    floorId: floor.id,
    zoneId: ctx.zoneId ?? 'Z1',
    hazard,
    densityGpmFt2: hz.densityGpmFt2,
    designAreaFt2: designArea,
    baseAreaFt2: baseArea,
    headsFlowing: flowingTagsOrdered,
    headsPerBranch: nb,
    minHeadFlowGpm: qMin,
    remoteHeadPressurePsi: pStart,
    rows,
    flowAtFloorGpm: flowAtFloor,
    pressureAtFloorPsi: pFc,
    flowAtSourceGpm: q,
    pressureAtSourcePsi: p,
    hoseAllowanceGpm: hose,
    totalDemandGpm: total,
    availablePsi: available,
    marginPsi: margin
  }
  return {
    result,
    carriedPipeIds: [...carried],
    candidateCount: candidates.length,
    requiredHeads: nRequired,
    remoteHeadTag: remote.tag
  }
}
