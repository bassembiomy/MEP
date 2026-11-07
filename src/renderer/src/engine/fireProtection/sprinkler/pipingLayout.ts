/**
 * Floor piping layout for a sprinkler floor: branch lines (arms) fed from a cross main through junctions, floor control
 * node FC and riser nipple to the building riser connection R, with pipe-schedule sizing (NFPA 13-2019 §28.5,
 * Tables 28.5.2.2.1 / 28.5.3.4).
 *
 * Direction 'x': branch lines run along x, the cross main runs along x = riser.x; direction 'y' is the same with the
 * axes swapped. Rows are numbered by ascending cross-main coordinate: junction `J{r}`, arms `A{r}E` / `A{r}W`.
 */
import type { HazardClass, PipeSchedule } from '../fpTypes'
import type { PlacedSprinkler, SprinklerPipe } from './sprinklerTypes'
import { pipeScheduleSize, spacingClass } from './nfpa13Sprinkler'

/** Unsprinklered run length above which a branch segment is sized as a feed main: 2 × 15 ft maximum spacing. */
export const FEED_RUN_THRESHOLD_MM = 2 * 15 * 304.8
import type { SpacingClass } from './nfpa13Sprinkler'

export interface PipingContext {
  hazardOf: (tag: string) => HazardClass
  schedule: PipeSchedule
  /** Minimum cross-main / riser-nipple size, in. */
  minMainIn: number
  /** System zone served by this piping (default 'Z1'). */
  zoneId?: string
  /** Not the floor's first zone: node and pipe ids carry the zone id (FC-Z2, R-Z2, Z2-J1 …). */
  secondaryZone?: boolean
}

export interface PipingNode {
  id: string
  x: number
  y: number
  kind: 'head' | 'junction' | 'floor-control' | 'riser'
}

export interface PipingArm {
  id: string
  /** 1-based row number (ascending cross-main coordinate). */
  row: number
  side: 'E' | 'W'
  /** Junction node id (`J{r}` or `FC` when the junction coincides with the riser point). */
  junction: string
  /** Sprinkler tags ordered outward from the junction. */
  heads: string[]
}

export interface FloorPiping {
  pipes: SprinklerPipe[]
  armIds: string[]
  arms: PipingArm[]
  nodes: PipingNode[]
  /** Zone control node ('FC' / 'FC-<zone>'), riser connection node ('R' / 'R-<zone>') and riser nipple pipe id. */
  fcNode: string
  rNode: string
  rnId: string
}

const HAZARD_ORDER: HazardClass[] = ['light', 'ordinary-1', 'ordinary-2', 'extra-1', 'extra-2']

function highestClass(tags: string[], ctx: PipingContext): SpacingClass {
  let worst = 0
  for (const t of tags) worst = Math.max(worst, HAZARD_ORDER.indexOf(ctx.hazardOf(t)))
  return spacingClass(HAZARD_ORDER[worst])
}

interface Row {
  v: number
  heads: { tag: string; u: number; v: number }[]
}

export function layoutFloorPiping(
  floorId: string,
  heads: PlacedSprinkler[],
  riser: { x: number; y: number },
  direction: 'x' | 'y',
  ctx: PipingContext
): FloorPiping {
  void floorId
  const zoneId = ctx.zoneId ?? 'Z1'
  const sec = !!ctx.secondaryZone
  const pre = sec ? `${zoneId}-` : ''
  const FC = sec ? `FC-${zoneId}` : 'FC'
  const RN_NODE = sec ? `R-${zoneId}` : 'R'
  const RN_ID = sec ? `RN-${zoneId}` : 'RN'
  const swap = direction === 'y'
  const toXY = (u: number, v: number): [number, number] => (swap ? [v, u] : [u, v])
  const ru = swap ? riser.y : riser.x
  const rv = swap ? riser.x : riser.y

  // rows: heads grouped by cross-main coordinate (rounded to 10 mm), rows within 150 mm merged
  const hs = heads
    .map((h) => ({ tag: h.tag, u: swap ? h.y : h.x, v: swap ? h.x : h.y }))
    .sort((a, b) => Math.round(a.v / 10) - Math.round(b.v / 10) || a.u - b.u)
  const rows: Row[] = []
  for (const h of hs) {
    const last = rows[rows.length - 1]
    if (last) {
      const mean = last.heads.reduce((s, q) => s + q.v, 0) / last.heads.length
      if (Math.abs(h.v - mean) <= 150) {
        last.heads.push(h)
        continue
      }
    }
    rows.push({ v: 0, heads: [h] })
  }
  for (const r of rows) r.v = r.heads.reduce((s, q) => s + q.v, 0) / r.heads.length

  const nodes: PipingNode[] = []
  const pushNode = (id: string, u: number, v: number, kind: PipingNode['kind']): void => {
    const [x, y] = toXY(u, v)
    nodes.push({ id, x, y, kind })
  }
  const pipes: SprinklerPipe[] = []
  const arms: PipingArm[] = []
  const schedule = ctx.schedule
  const mkPipe = (
    id: string,
    kind: SprinklerPipe['kind'],
    size: number,
    pts: [number, number][],
    from: string,
    to: string,
    count: number
  ): void => {
    let len = 0
    for (let i = 1; i < pts.length; i++)
      len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    pipes.push({
      id,
      kind,
      sizeIn: size,
      schedule,
      points: pts,
      lengthM: len / 1000,
      fromNode: from,
      toNode: to,
      sprinklersDownstream: count,
      zoneId
    })
  }

  // junctions and arms
  const junctionIds: string[] = []
  const armsOfRow: PipingArm[][] = []
  rows.forEach((row, idx) => {
    const r = idx + 1
    const coincident = Math.abs(row.v - rv) <= 1
    const jid = coincident ? FC : `${pre}J${r}`
    junctionIds.push(jid)
    if (!coincident) pushNode(jid, ru, row.v, 'junction')
    const east = row.heads.filter((h) => h.u >= ru).sort((a, b) => a.u - b.u)
    const west = row.heads.filter((h) => h.u < ru).sort((a, b) => b.u - a.u)
    const rowArms: PipingArm[] = []
    for (const [side, list] of [
      ['E', east],
      ['W', west]
    ] as ['E' | 'W', typeof east][]) {
      if (!list.length) continue
      const arm: PipingArm = {
        id: `${pre}A${r}${side}`,
        row: r,
        side,
        junction: jid,
        heads: list.map((h) => h.tag)
      }
      rowArms.push(arm)
      arms.push(arm)
      let prevId = jid
      let prevU = ru
      list.forEach((h, n) => {
        const downstream = list.length - n
        const scheduleSize = pipeScheduleSize(
          downstream,
          highestClass(
            list.slice(n).map((q) => q.tag),
            ctx
          )
        )
        // A run with no sprinkler along it longer than two maximum spacings (2 × 15 ft) is a feed main, not a branch
        // line carrying sprinklers: it is sized as a main (≥ minMainIn) so the remote room is not starved through a
        // long small-bore pipe (NFPA 13-2019 §28.5 pipe schedules apply to branch lines with sprinklers).
        const feedRun = Math.abs(h.u - prevU) > FEED_RUN_THRESHOLD_MM
        const size = feedRun ? Math.max(scheduleSize, ctx.minMainIn) : scheduleSize
        mkPipe(
          `B-${arm.id}-${n + 1}`,
          'branch',
          size,
          [toXY(prevU, row.v), toXY(h.u, row.v)],
          prevId,
          h.tag,
          downstream
        )
        pushNode(h.tag, h.u, h.v, 'head')
        prevId = h.tag
        prevU = h.u
      })
    }
    armsOfRow.push(rowArms)
  })

  // cross main: junctions + FC sorted by cross-main coordinate
  type CmNode = { id: string; v: number; row: number }
  const cm: CmNode[] = rows.map((r, i) => ({ id: junctionIds[i], v: r.v, row: i }))
  if (!cm.some((n) => n.id === FC)) cm.push({ id: FC, v: rv, row: -1 })
  cm.sort((a, b) => a.v - b.v)
  pushNode(FC, ru, rv, 'floor-control')
  const fcIdx = cm.findIndex((n) => n.id === FC)
  const headsOfRow = (row: number): string[] => (row >= 0 ? rows[row].heads.map((h) => h.tag) : [])
  let n = 0
  for (let k = 0; k < cm.length - 1; k++) {
    // flow runs from the FC side outward: segment supplies every row beyond the FC-side node
    const far = k >= fcIdx ? k + 1 : k
    const near = k >= fcIdx ? k : k + 1
    const supplied: string[] = []
    if (k >= fcIdx) for (let q = k + 1; q < cm.length; q++) supplied.push(...headsOfRow(cm[q].row))
    else for (let q = 0; q <= k; q++) supplied.push(...headsOfRow(cm[q].row))
    const size = Math.max(
      ctx.minMainIn,
      pipeScheduleSize(supplied.length, highestClass(supplied, ctx))
    )
    n++
    mkPipe(
      `${pre}CM-${n}`,
      'cross-main',
      size,
      [toXY(ru, cm[near].v), toXY(ru, cm[far].v)],
      cm[near].id,
      cm[far].id,
      supplied.length
    )
  }

  // riser nipple FC → R (same point), 1.0 m
  pushNode(RN_NODE, ru, rv, 'riser')
  const all = heads.map((h) => h.tag)
  const rnSize = Math.max(
    ctx.minMainIn,
    pipeScheduleSize(all.length, all.length ? highestClass(all, ctx) : 'light')
  )
  const p = toXY(ru, rv)
  pipes.push({
    id: RN_ID,
    kind: 'riser-nipple',
    sizeIn: rnSize,
    schedule,
    points: [p, [p[0], p[1]]],
    lengthM: 1.0,
    fromNode: FC,
    toNode: RN_NODE,
    sprinklersDownstream: all.length,
    zoneId
  })

  return {
    pipes,
    armIds: arms.map((a) => a.id),
    arms,
    nodes,
    fcNode: FC,
    rNode: RN_NODE,
    rnId: RN_ID
  }
}
