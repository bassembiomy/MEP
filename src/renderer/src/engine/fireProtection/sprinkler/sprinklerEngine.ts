/**
 * Sprinkler system engine (NFPA 13-2019): head selection and layout per room, piping, remote-area hydraulics per
 * system type, water supply check / upsizing, hangers, accessories, spare heads, BOM and design checks.
 */
import type { DesignCheck, HazardClass } from '../fpTypes'
import { internalDiameterIn } from '../standards/pipeData'
import {
  DRY_CAPACITY_NO_QOD_GAL,
  DRY_CAPACITY_WITH_QOD_GAL,
  DRY_DELIVERY_TIME_S,
  DRY_SLOPE_BRANCH_MM_PER_M,
  DRY_SLOPE_MAIN_MM_PER_M,
  PREACTION_MAX_CLOSED_SPRINKLERS,
  SPACING_RULES,
  hangerSpacingM,
  spacingClass,
  spareHeadCount
} from './nfpa13Sprinkler'
import {
  headSpecCheck,
  layoutRoomHeads,
  layoutSidewallHeads,
  roomLayoutChecks,
  selectHeadType,
  sidewallChecks
} from './headLayout'
import type { RoomHeadLayout, SidewallLayout } from './headLayout'
import { FEED_RUN_THRESHOLD_MM, layoutFloorPiping } from './pipingLayout'
import type { FloorPiping } from './pipingLayout'
import { distanceToPolygonEdges, pointInPolygon } from './roomDetection'
import { buildAccessories, buildBom, spareSprinklers } from './sprinklerAccessories'
import { FT_PER_M, calculateFloorDemand, supplyShort, upsizeOne } from './sprinklerHydraulics'
import type { FloorHydraulicContext, SourceContext } from './sprinklerHydraulics'
import type {
  PlacedSprinkler,
  RemoteAreaResult,
  SprinklerDesignInput,
  SprinklerFloorDesign,
  SprinklerFloorInput,
  SprinklerHeadType,
  SprinklerPipe,
  SprinklerRoomInput,
  SprinklerRoomResult,
  SprinklerSystemDesign,
  SprinklerZoneInput,
  SprinklerZoneResult
} from './sprinklerTypes'

const MM_PER_FT = 304.8
const HAZARD_ORDER: HazardClass[] = ['light', 'ordinary-1', 'ordinary-2', 'extra-1', 'extra-2']
const HIGH_PILED =
  'High-piled storage above 12 ft requires an NFPA 13 Ch. 20–25 storage design (ESFR / CMSA / CMDA)'
const f1 = (v: number): string => v.toFixed(1)

type Pt = [number, number]

const FT2_PER_M2 = 10.7639104
/** NFPA 13-2019 §4.4 maximum protection area per system riser on one floor, ft². */
const ZONE_MAX_AREA_FT2 = 52000
const ZONE_MAX_AREA_EXTRA_FT2 = 40000
const MAX_VELOCITY_FPS = 20
const HYDRAULIC_ITERATIONS = 500

interface FloorLayoutData {
  direction: 'x' | 'y'
  roomLayouts: {
    room: SprinklerRoomInput
    layout: RoomHeadLayout
    sidewall?: SidewallLayout
    headType: SprinklerHeadType
  }[]
}

/** Zones of a floor: the designer's zones, or one zone 'Z1' named after the floor at the floor riser. */
function resolveZones(floor: SprinklerFloorInput): SprinklerZoneInput[] {
  return floor.zones && floor.zones.length > 0
    ? floor.zones
    : [{ id: 'Z1', name: floor.name, riser: floor.riser }]
}

function zoneOfRoom(room: SprinklerRoomInput, zones: SprinklerZoneInput[]): SprinklerZoneInput {
  return zones.find((z) => z.id === room.zoneId) ?? zones[0]
}

function layoutFloor(
  floor: SprinklerFloorInput,
  direction: 'x' | 'y',
  answers: SprinklerDesignInput['answers'],
  zones: SprinklerZoneInput[]
): FloorLayoutData {
  const roomLayouts = floor.rooms
    .filter((r) => !r.omit)
    .map((room) => {
      const headType = selectHeadType(room, floor.systemType, answers)
      if (headType.orientation === 'sidewall') {
        const sidewall = layoutSidewallHeads(room, zoneOfRoom(room, zones).riser)
        return { room, layout: sidewall, sidewall, headType }
      }
      return {
        room,
        layout: layoutRoomHeads(room, direction, SPACING_RULES[spacingClass(room.hazard)]),
        headType
      }
    })
  return { direction, roomLayouts }
}

function supplyCheck(
  floorId: string,
  ra: RemoteAreaResult | null,
  answers: SprinklerDesignInput['answers'],
  standalonePump: boolean
): DesignCheck {
  const base = {
    id: `spr-supply:${floorId}`,
    title: `Water supply adequacy — ${floorId}`,
    reference: 'NFPA 13-2019 §5.2, §19.3.3.1, §28.2'
  }
  if (!ra) return { ...base, status: 'pass', detail: 'No sprinklered area on this floor' }
  if (answers.supply.kind === 'fire-pump' && standalonePump) {
    return {
      ...base,
      status: 'pass',
      detail: `Demand ${f1(ra.pressureAtSourcePsi)} psi at ${f1(ra.flowAtSourceGpm)} gpm (+ ${ra.hoseAllowanceGpm} gpm hose); fire pump supply is verified in the fire pump design`
    }
  }
  const city = answers.supply.kind === 'city'
  return {
    ...base,
    status: supplyShort(ra) ? 'fail' : 'pass',
    detail: `${city ? 'City supply' : 'Fire pump'} ${f1(ra.availablePsi)} psi available at ${f1(ra.totalDemandGpm)} gpm vs ${f1(ra.pressureAtSourcePsi)} psi required (margin ${f1(ra.marginPsi)} psi)`
  }
}

function pathAlong(points: Pt[], dist: number): Pt {
  let rem = dist
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
    if (rem <= seg || i === points.length - 1) {
      const t = seg > 0 ? Math.min(1, rem / seg) : 0
      return [
        points[i - 1][0] + t * (points[i][0] - points[i - 1][0]),
        points[i - 1][1] + t * (points[i][1] - points[i - 1][1])
      ]
    }
    rem -= seg
  }
  return points[0]
}

/** Node-to-pipe lookup for hydraulic sizing: a calculation row maps to the pipe joining its two nodes. */
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Starting sizes of hydraulic sizing: branch 1", cross main & feed 1½", riser nipple 2". */
function hydraulicStartSizes(pipes: SprinklerPipe[]): void {
  for (const p of pipes) {
    if (p.kind === 'riser-nipple') p.sizeIn = 2
    else if (p.kind === 'cross-main' || p.kind === 'feed') p.sizeIn = 1.5
    else p.sizeIn = p.lengthM * 1000 > FEED_RUN_THRESHOLD_MM ? 1.5 : 1
  }
}

/** A pipe is never smaller than any pipe it feeds (sizes do not increase toward the sprinklers). */
function enforceNonIncreasing(pipes: SprinklerPipe[], fcNode: string, rnId: string): void {
  const feeders = new Map<string, SprinklerPipe[]>() // node → pipes delivering water to it
  for (const p of pipes) {
    if (p.id === rnId) continue
    if (!feeders.has(p.toNode)) feeders.set(p.toNode, [])
    feeders.get(p.toNode)!.push(p)
  }
  const rn = pipes.find((p) => p.id === rnId)
  if (rn) feeders.set(fcNode, [...(feeders.get(fcNode) ?? []), rn])
  for (let guard = 0; guard < 1000; guard++) {
    let changed = false
    for (const p of pipes) {
      if (p.id === rnId) continue
      for (const up of feeders.get(p.fromNode) ?? []) {
        if (up !== p && up.sizeIn < p.sizeIn) {
          up.sizeIn = p.sizeIn
          changed = true
        }
      }
    }
    if (!changed) break
  }
}

interface ZoneSolution {
  zone: SprinklerZoneInput
  heads: PlacedSprinkler[]
  piping: FloorPiping
  remoteAreas: RemoteAreaResult[]
  governing: RemoteAreaResult | null
  short: { hazard: HazardClass; have: number; need: number }[]
  /** Hydraulic sizing could not keep the minimum supply margin even at the largest pipe size. */
  marginUnmet: boolean
}

function designFloor(
  floor: SprinklerFloorInput,
  input: SprinklerDesignInput,
  headTypes: SprinklerHeadType[],
  source: SourceContext | undefined
): SprinklerFloorDesign {
  const answers = input.answers
  const active = floor.rooms.filter((r) => !r.omit)
  const zones = resolveZones(floor)

  // direction
  let direction: 'x' | 'y'
  let data: FloorLayoutData
  if (floor.branchDirection === 'auto') {
    const dx = layoutFloor(floor, 'x', answers, zones)
    const dy = layoutFloor(floor, 'y', answers, zones)
    const count = (d: FloorLayoutData): number =>
      d.roomLayouts.reduce((s, r) => s + r.layout.points.length, 0)
    if (count(dy) < count(dx)) {
      direction = 'y'
      data = dy
    } else {
      direction = 'x'
      data = dx
    }
  } else {
    direction = floor.branchDirection
    data = layoutFloor(floor, direction, answers, zones)
  }
  const swap = direction === 'y'

  // heads, tags in room order then along rows (numbered floor-wide)
  const heads: PlacedSprinkler[] = []
  const rooms: SprinklerRoomResult[] = []
  const hazardByTag = new Map<string, HazardClass>()
  const zoneOfHead = new Map<string, string>()
  let n = 0
  for (const { room, layout, sidewall, headType } of data.roomLayouts) {
    if (!headTypes.some((t) => t.id === headType.id)) headTypes.push(headType)
    const zoneId = zoneOfRoom(room, zones).id
    const rules = SPACING_RULES[spacingClass(room.hazard)]
    const pts = [...layout.points].sort((a, b) => {
      const av = swap ? a[0] : a[1]
      const bv = swap ? b[0] : b[1]
      const au = swap ? a[1] : a[0]
      const bu = swap ? b[1] : b[0]
      return Math.round(av / 10) - Math.round(bv / 10) || au - bu
    })
    const areaFt2 = (layout.S / MM_PER_FT) * (layout.L / MM_PER_FT)
    for (const [x, y] of pts) {
      n++
      const tag = `S-${floor.id}-${String(n).padStart(3, '0')}`
      hazardByTag.set(tag, room.hazard)
      zoneOfHead.set(tag, zoneId)
      heads.push({
        tag,
        floorId: floor.id,
        roomId: room.id,
        x,
        y,
        headTypeId: headType.id,
        spacingSmm: layout.S,
        spacingLmm: layout.L,
        areaFt2,
        wallDistanceMm: distanceToPolygonEdges(x, y, room.polygon),
        node: tag,
        zoneId
      })
    }
    let a = 0
    for (let i = 0, j = room.polygon.length - 1; i < room.polygon.length; j = i++)
      a += room.polygon[j][0] * room.polygon[i][1] - room.polygon[i][0] * room.polygon[j][1]
    const layoutChecks = sidewall
      ? sidewallChecks(room, sidewall)
      : roomLayoutChecks(room, layout, rules, direction)
    const specCheck = headSpecCheck(room, headType, floor.systemType)
    rooms.push({
      roomId: room.id,
      name: room.name,
      hazard: room.hazard,
      areaM2: Math.abs(a) / 2 / 1e6,
      headCount: pts.length,
      headTypeId: headType.id,
      spacingSmm: layout.S,
      spacingLmm: layout.L,
      maxSpacingMm: sidewall ? sidewall.maxSpacingMm : rules.maxSpacingFt * MM_PER_FT,
      maxAreaFt2: sidewall ? sidewall.maxAreaFt2 : rules.maxAreaFt2,
      checks: specCheck ? [...layoutChecks, specCheck] : layoutChecks
    })
  }

  // hydraulic context
  const minCeiling = active.length ? Math.min(...active.map((r) => r.ceilingHeightM)) : 3
  const hazardOf = (tag: string): HazardClass => hazardByTag.get(tag) ?? 'light'
  const hydraulic = answers.pipeSizing === 'hydraulic'
  const minMargin = answers.minSupplyMarginPsi ?? 10
  const city = answers.supply.kind === 'city'

  // piping and hydraulics per zone
  const solutions: ZoneSolution[] = zones.map((zone, zi) => {
    const zheads = heads.filter((h) => h.zoneId === zone.id)
    const piping: FloorPiping = layoutFloorPiping(floor.id, zheads, zone.riser, direction, {
      hazardOf,
      schedule: answers.pipeMaterial === 'black-steel-sch10' ? 'sch10' : 'sch40',
      minMainIn: 2,
      zoneId: zone.id,
      secondaryZone: zi > 0
    })
    const hctx: FloorHydraulicContext = {
      direction,
      pipeMaterial: answers.pipeMaterial,
      hazardOf,
      pipeElevationM: floor.elevationM + minCeiling - 0.3,
      buildingRiserIn: input.buildingRiserIn,
      buildingRiserSchedule: input.buildingRiserSchedule,
      supply: answers.supply,
      source,
      zoneId: zone.id
    }
    const hazards = HAZARD_ORDER.filter((h) => zheads.some((x) => hazardOf(x.tag) === h))
    const sol: ZoneSolution = {
      zone,
      heads: zheads,
      piping,
      remoteAreas: [],
      governing: null,
      short: [],
      marginUnmet: false
    }
    // one calculation of every remote area of the zone; returns the pipe ids carried by the governing area
    const compute = (): { carried: string[]; carriedByArea: Map<RemoteAreaResult, string[]> } => {
      sol.remoteAreas = []
      sol.short = []
      sol.governing = null
      let govCarried: string[] = []
      const carriedByArea = new Map<RemoteAreaResult, string[]>()
      for (const hz of hazards) {
        const out = calculateFloorDemand(
          floor,
          piping,
          zheads,
          headTypes,
          floor.systemType,
          hz,
          hctx
        )
        if (!out) continue
        sol.remoteAreas.push(out.result)
        carriedByArea.set(out.result, out.carriedPipeIds)
        if (out.candidateCount < out.requiredHeads && floor.systemType !== 'deluge')
          sol.short.push({ hazard: hz, have: out.candidateCount, need: out.requiredHeads })
        if (!sol.governing || out.result.pressureAtSourcePsi > sol.governing.pressureAtSourcePsi) {
          sol.governing = out.result
          govCarried = out.carriedPipeIds
        }
      }
      return { carried: govCarried, carriedByArea }
    }

    if (!hydraulic) {
      // pipe schedule sizes (§28.5), upsized where the city supply is short
      for (let round = 0; round <= 6; round++) {
        const { carried } = compute()
        if (!sol.governing || !city || !supplyShort(sol.governing) || round === 6) break
        for (const id of carried) {
          const p = piping.pipes.find((q) => q.id === id)
          if (p) p.sizeIn = upsizeOne(p.sizeIn)
        }
      }
      return sol
    }

    // hydraulically calculated sizes (NFPA 13 Ch. 28)
    const byPair = new Map(piping.pipes.map((p) => [pairKey(p.fromNode, p.toNode), p]))
    hydraulicStartSizes(piping.pipes)
    enforceNonIncreasing(piping.pipes, piping.fcNode, piping.rnId)
    let calc = compute()
    for (let it = 0; it < HYDRAULIC_ITERATIONS; it++) {
      // (a) velocity above 20 ft/s (good practice, not an NFPA limit)
      const fast = new Set<SprinklerPipe>()
      for (const ra of sol.remoteAreas)
        for (const row of ra.rows) {
          const p = byPair.get(pairKey(row.fromNode, row.toNode))
          if (p && row.velocityFps > MAX_VELOCITY_FPS + 1e-9 && p.sizeIn < 8) fast.add(p)
        }
      let changed = false
      if (fast.size > 0) {
        for (const p of fast) p.sizeIn = upsizeOne(p.sizeIn)
        changed = true
      } else if (city) {
        // (b) supply margin below the minimum: upsize the segment with the largest friction loss on the path
        const low = sol.remoteAreas
          .filter((ra) => ra.marginPsi < minMargin - 1e-9)
          .sort((a, b) => a.marginPsi - b.marginPsi)
        for (const ra of low) {
          let best: SprinklerPipe | null = null
          let bestLoss = -1
          for (const row of ra.rows) {
            const p = byPair.get(pairKey(row.fromNode, row.toNode))
            if (p && p.sizeIn < 8 && row.pfPsi > bestLoss) {
              best = p
              bestLoss = row.pfPsi
            }
          }
          if (best) {
            best.sizeIn = upsizeOne(best.sizeIn)
            changed = true
            break
          }
        }
      }
      if (!changed) break
      enforceNonIncreasing(piping.pipes, piping.fcNode, piping.rnId)
      calc = compute()
    }
    void calc
    sol.marginUnmet = city && sol.remoteAreas.some((ra) => ra.marginPsi < minMargin - 1e-9)
    return sol
  })

  const remoteAreas: RemoteAreaResult[] = solutions.flatMap((z) => z.remoteAreas)
  let governing: RemoteAreaResult | null = null
  for (const z of solutions)
    if (
      z.governing &&
      (!governing || z.governing.pressureAtSourcePsi > governing.pressureAtSourcePsi)
    )
      governing = z.governing
  const short = solutions.flatMap((z) => z.short)
  const gov = governing as RemoteAreaResult | null
  const allPipes = solutions.flatMap((z) => z.piping.pipes)

  // volume, hangers
  let volumeGal = 0
  const zoneVolume = new Map<string, number>()
  const hangers: SprinklerFloorDesign['hangers'] = []
  for (const p of allPipes) {
    const id = internalDiameterIn(p.sizeIn, p.schedule)
    const vol = (((p.lengthM * FT_PER_M * 12 * Math.PI) / 4) * id * id) / 231
    volumeGal += vol
    zoneVolume.set(p.zoneId, (zoneVolume.get(p.zoneId) ?? 0) + vol)
    if (p.kind === 'riser-nipple') continue // vertical riser nipple: supported by the riser clamp, not hung
    const nh = Math.ceil(p.lengthM / hangerSpacingM(p.sizeIn, answers.pipeMaterial) - 1e-9)
    const lenMm = p.lengthM * 1000
    for (let i = 0; i < nh; i++) {
      const [x, y] = pathAlong(p.points, ((i + 0.5) * lenMm) / nh)
      hangers.push({ x, y, pipeId: p.id })
    }
  }
  const maxZoneVolume = Math.max(0, ...zoneVolume.values())

  let inspector = { x: floor.riser.x, y: floor.riser.y }
  if (gov) {
    const rh = heads.find((h) => h.tag === gov.rows[0].fromNode)
    if (rh) inspector = { x: rh.x, y: rh.y }
  }

  // zone results
  const zoneResults: SprinklerZoneResult[] = solutions.map((sol) => {
    const zrooms = rooms.filter((r) => {
      const input = active.find((a) => a.id === r.roomId)!
      return zoneOfRoom(input, zones).id === sol.zone.id
    })
    const areaM2 = zrooms.reduce((s, r) => s + r.areaM2, 0)
    const areaFt2 = areaM2 * FT2_PER_M2
    const hasExtra = zrooms.some((r) => r.hazard === 'extra-1' || r.hazard === 'extra-2')
    const maxAreaFt2 = hasExtra ? ZONE_MAX_AREA_EXTRA_FT2 : ZONE_MAX_AREA_FT2
    return {
      zoneId: sol.zone.id,
      name: sol.zone.name,
      riser: { ...sol.zone.riser },
      controlValveTag: `ZCV-${floor.id}-${sol.zone.id}`,
      roomIds: zrooms.map((r) => r.roomId),
      headCount: sol.heads.length,
      areaFt2,
      areaM2,
      maxAreaFt2,
      node: sol.piping.fcNode,
      governing: sol.governing,
      checks: [
        {
          id: `spr-zone-area:${floor.id}/${sol.zone.id}`,
          title: `Protected area per system riser — ${floor.id} ${sol.zone.id}`,
          reference: 'NFPA 13-2019 §4.4',
          status: areaFt2 <= maxAreaFt2 + 1e-6 ? 'pass' : 'fail',
          detail: `Zone ${sol.zone.id} (${sol.zone.name}) ${areaFt2.toFixed(0)} ft² (${areaM2.toFixed(1)} m²) vs maximum ${maxAreaFt2.toLocaleString('en-US')} ft² per system riser${hasExtra ? ' (extra hazard)' : ''}`
        }
      ]
    }
  })

  const checks: DesignCheck[] = []
  const fid = floor.id
  const sys = floor.systemType
  const maxZoneHeads = Math.max(0, ...solutions.map((z) => z.heads.length))
  if (gov) {
    checks.push({
      id: `spr-pressure-min:${fid}`,
      title: `Minimum sprinkler operating pressure — ${fid}`,
      reference: 'NFPA 13-2019 §28.2.4.8.1, §19.3.3.1',
      status: gov.remoteHeadPressurePsi >= 7 - 1e-9 ? 'pass' : 'fail',
      detail: `Remote head ${gov.rows[0].fromNode} at ${gov.remoteHeadPressurePsi.toFixed(2)} psi (min 7 psi), ${gov.minHeadFlowGpm.toFixed(1)} gpm = ${gov.densityGpmFt2} gpm/ft² × head coverage`
    })
  }
  for (const s of short) {
    checks.push({
      id: `spr-design-area:${fid}`,
      title: `Design area available — ${fid}`,
      reference: 'NFPA 13-2019 §19.3.3.1',
      status: 'warn',
      detail: `${s.hazard}: only ${s.have} sprinklers on the floor, ${s.need} needed to fill the design area; all flow`
    })
  }
  // supply: the first zone whose governing area is short of water (city supply), else the floor's governing area
  const shortZone = solutions.find((z) => z.governing && supplyShort(z.governing))
  checks.push(supplyCheck(fid, shortZone?.governing ?? gov, answers, !source))
  checks.push(areaOverlapCheck(floor))
  checks.push(
    pipeSizingCheck(
      fid,
      hydraulic,
      minMargin,
      solutions.some((z) => z.marginUnmet)
    )
  )
  if (sys === 'dry') {
    const cls = gov ? spacingClass(gov.hazard) : 'light'
    const t = DRY_DELIVERY_TIME_S[cls]
    const volumeGal = maxZoneVolume // per dry-pipe valve (zone)
    const st =
      volumeGal <= DRY_CAPACITY_NO_QOD_GAL
        ? 'pass'
        : volumeGal <= DRY_CAPACITY_WITH_QOD_GAL
          ? 'pass'
          : 'warn'
    checks.push({
      id: `spr-dry-capacity:${fid}`,
      title: `Dry system capacity — ${fid}`,
      reference: 'NFPA 13-2019 §8.2.3.2, §8.2.3.3, Table 8.2.3.6.1',
      status: st,
      detail:
        volumeGal <= DRY_CAPACITY_NO_QOD_GAL
          ? `${f1(volumeGal)} gal ≤ ${DRY_CAPACITY_NO_QOD_GAL} gal (no quick-opening device required)`
          : volumeGal <= DRY_CAPACITY_WITH_QOD_GAL
            ? `${f1(volumeGal)} gal ≤ ${DRY_CAPACITY_WITH_QOD_GAL} gal: quick-opening device (accelerator) required`
            : `${f1(volumeGal)} gal > ${DRY_CAPACITY_WITH_QOD_GAL} gal: water delivery time calculation / test to ≤ ${t} s required`
    })
  }
  if (sys === 'preaction-single' || sys === 'preaction-double') {
    checks.push({
      id: `spr-preaction-size:${fid}`,
      title: `Preaction system size — ${fid}`,
      reference: 'NFPA 13-2019 §8.3.2.6',
      status: maxZoneHeads <= PREACTION_MAX_CLOSED_SPRINKLERS ? 'pass' : 'fail',
      detail: `${maxZoneHeads} closed sprinklers per preaction valve (max ${PREACTION_MAX_CLOSED_SPRINKLERS})`
    })
  }
  if (sys === 'dry' || sys === 'preaction-single' || sys === 'preaction-double') {
    checks.push({
      id: `spr-slope:${fid}`,
      title: `Pitch of dry piping — ${fid}`,
      reference: 'NFPA 13-2019 §16.10.3',
      status: 'pass',
      detail: `Pitch branch lines ≥ ${DRY_SLOPE_BRANCH_MM_PER_M} mm/m (½ in/10 ft) and mains ≥ ${DRY_SLOPE_MAIN_MM_PER_M} mm/m (¼ in/10 ft) toward drains`
    })
  }
  const lightNotQuick = heads.filter(
    (h) =>
      hazardByTag.get(h.tag) === 'light' &&
      headTypes.find((t) => t.id === h.headTypeId)?.response !== 'quick'
  )
  checks.push({
    id: `spr-quick-response:${fid}`,
    title: `Quick-response sprinklers in light hazard — ${fid}`,
    reference: 'NFPA 13-2019 §9.5.3.2 (light hazard)',
    status: sys === 'deluge' || lightNotQuick.length === 0 ? 'pass' : 'fail',
    detail:
      sys === 'deluge'
        ? 'Open (deluge) sprinklers — response rating not applicable'
        : `${lightNotQuick.length} light-hazard sprinkler(s) without quick response`
  })
  if (active.some((r) => r.freezing)) {
    const frozen = new Set(active.filter((r) => r.freezing).map((r) => r.id))
    const bad = heads.filter(
      (h) =>
        frozen.has(h.roomId) &&
        headTypes.find((t) => t.id === h.headTypeId)?.orientation !== 'dry-pendent' &&
        !headTypes.find((t) => t.id === h.headTypeId)?.open
    )
    const ok = sys !== 'wet' || bad.length === 0
    checks.push({
      id: `spr-freezing:${fid}`,
      title: `Freezing areas — ${fid}`,
      reference: 'NFPA 13-2019 §8.2, §7.2.2, §9.3.2',
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? `Freezing room(s) ${[...frozen].join(', ')} protected by ${sys === 'wet' ? 'dry-pendent sprinklers on a wet system' : `a ${sys} system (piping not water-filled)`}`
        : `${bad.length} sprinkler(s) in freezing rooms are not dry-pendent`
    })
  }
  if (answers.pipeMaterial === 'cpvc') {
    const ok = sys === 'wet' && active.every((r) => r.hazard === 'light')
    checks.push({
      id: `spr-cpvc:${fid}`,
      title: `CPVC pipe limitation — ${fid}`,
      reference: 'NFPA 13-2019 §6.3.1, §6.4 (listed CPVC: wet light hazard)',
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? 'CPVC on a wet light-hazard system'
        : `CPVC not permitted for ${sys} systems or ordinary / extra hazard areas`
    })
  }

  return {
    floorId: floor.id,
    floorName: floor.name,
    systemType: floor.systemType,
    heads,
    pipes: allPipes,
    rooms,
    riser: { ...floor.riser },
    inspectorTest: inspector,
    hangers,
    volumeGal,
    remoteAreas,
    governing: gov,
    zones: zoneResults,
    checks
  }
}

/** Overlap area of two polygons, m²: 250 mm grid sampling inside the bbox intersection (coarser for huge overlaps). */
function overlapAreaM2(a: Pt[], b: Pt[]): number {
  const bb = (p: Pt[]): number[] => [
    Math.min(...p.map((q) => q[0])),
    Math.min(...p.map((q) => q[1])),
    Math.max(...p.map((q) => q[0])),
    Math.max(...p.map((q) => q[1]))
  ]
  const A = bb(a)
  const B = bb(b)
  const x0 = Math.max(A[0], B[0])
  const y0 = Math.max(A[1], B[1])
  const x1 = Math.min(A[2], B[2])
  const y1 = Math.min(A[3], B[3])
  if (x1 <= x0 || y1 <= y0) return 0
  const step = Math.max(250, Math.sqrt(((x1 - x0) * (y1 - y0)) / 40000))
  let n = 0
  for (let x = x0 + step / 2; x < x1; x += step)
    for (let y = y0 + step / 2; y < y1; y += step)
      if (pointInPolygon(x, y, a) && pointInPolygon(x, y, b)) n++
  return (n * step * step) / 1e6
}

function areaOverlapCheck(floor: SprinklerFloorInput): DesignCheck {
  const rs = floor.rooms.filter((r) => !r.omit)
  const pairs: string[] = []
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const m2 = overlapAreaM2(rs[i].polygon, rs[j].polygon)
      if (m2 > 1) pairs.push(`${rs[i].id}/${rs[j].id} ${m2.toFixed(1)} m²`)
    }
  return {
    id: `spr-area-overlap:${floor.id}`,
    title: `Overlapping protected areas — ${floor.id}`,
    reference: 'NFPA 13-2019 Ch. 10 (one protection area per sprinkler)',
    status: pairs.length ? 'warn' : 'pass',
    detail: pairs.length
      ? `Overlapping areas: ${pairs.join(', ')} — sprinklers would be duplicated; omit or delete one of them`
      : 'No overlapping areas'
  }
}

function pipeSizingCheck(
  floorId: string,
  hydraulic: boolean,
  minMarginPsi: number,
  marginUnmet: boolean
): DesignCheck {
  const base = {
    id: `spr-pipe-sizing:${floorId}`,
    title: `Pipe sizing method — ${floorId}`,
    reference: 'NFPA 13-2019 §28.5, Ch. 28'
  }
  if (!hydraulic)
    return {
      ...base,
      status: 'pass',
      detail: 'pipe schedule (§28.5) hydraulically verified'
    }
  return {
    ...base,
    status: marginUnmet ? 'warn' : 'pass',
    detail: marginUnmet
      ? `hydraulic (NFPA 13 Ch. 28): the supply margin of ${minMarginPsi} psi is not reached even at the largest pipe sizes`
      : `hydraulic (NFPA 13 Ch. 28): smallest sizes with velocity ≤ ${MAX_VELOCITY_FPS} ft/s and supply margin ≥ ${minMarginPsi} psi`
  }
}

function buildingChecks(
  floors: SprinklerFloorDesign[],
  outOfScope: string[],
  spares: { headTypeId: string; qty: number }[],
  totalHeads: number
): DesignCheck[] {
  const checks: DesignCheck[] = []
  if (outOfScope.length === 0) {
    checks.push({
      id: 'spr-out-of-scope',
      title: 'Items outside the scope of this design',
      reference: 'NFPA 13-2019 Ch. 20–25',
      status: 'pass',
      detail: 'No out-of-scope hazards declared'
    })
  } else {
    outOfScope.forEach((o, i) => {
      checks.push({
        id: i === 0 ? 'spr-out-of-scope' : `spr-out-of-scope:${i + 1}`,
        title: 'Item outside the scope of this design',
        reference: 'NFPA 13-2019 Ch. 20–25',
        status: 'warn',
        detail: o
      })
    })
  }
  const need = spareHeadCount(totalHeads)
  const have = spares.reduce((s, x) => s + x.qty, 0)
  checks.push({
    id: 'spr-spares',
    title: 'Spare sprinkler cabinet',
    reference: 'NFPA 13-2019 §16.2.7',
    status: floors.length === 0 || have >= need ? 'pass' : 'fail',
    detail: `${have} spare sprinklers (required ${need} for ${totalHeads} installed), at least 2 of each type, plus sprinkler wrench`
  })
  return checks
}

/** Design the automatic sprinkler system for all floors. `ctx` comes from the fire engine (pump, feed main, hose). */
export function designSprinklerSystem(
  input: SprinklerDesignInput,
  ctx?: SourceContext
): SprinklerSystemDesign {
  const headTypes: SprinklerHeadType[] = []
  const floors = input.floors.map((f) => designFloor(f, input, headTypes, ctx))
  let governing: RemoteAreaResult | null = null
  for (const f of floors) {
    if (
      f.governing &&
      (!governing || f.governing.pressureAtSourcePsi > governing.pressureAtSourcePsi)
    )
      governing = f.governing
  }
  const totalHeads = floors.reduce((s, f) => s + f.heads.length, 0)
  const outOfScope: string[] = []
  if (input.answers.highPiledStorage) outOfScope.push(HIGH_PILED)
  const accessories = buildAccessories(floors, headTypes)
  const spareHeads = spareSprinklers(floors)
  const bom = buildBom(floors, headTypes, accessories, input.answers)
  const design: SprinklerSystemDesign = {
    headTypes,
    floors,
    governing,
    accessories,
    spareHeads,
    bom,
    totalHeads,
    outOfScope,
    checks: []
  }
  design.checks = collectChecks(design, buildingChecks(floors, outOfScope, spareHeads, totalHeads))
  return design
}

function collectChecks(design: SprinklerSystemDesign, building: DesignCheck[]): DesignCheck[] {
  return [
    ...design.floors.flatMap((f) => [
      ...f.rooms.flatMap((r) => r.checks),
      ...f.zones.flatMap((z) => z.checks),
      ...f.checks
    ]),
    ...building
  ]
}

/**
 * Fill the fire pump availability once the pump set is selected (net pressure on the FP-1 curve at the sprinkler flow +
 * inside hose allowance, plus the minimum suction pressure) and refresh the `spr-supply` checks.
 */
export function applyFirePumpSupply(
  design: SprinklerSystemDesign,
  answers: SprinklerDesignInput['answers'],
  availableAt: (flowGpm: number) => number
): void {
  if (answers.supply.kind !== 'fire-pump') return
  for (const f of design.floors) {
    for (const ra of f.remoteAreas) {
      ra.availablePsi = availableAt(ra.flowAtSourceGpm + ra.hoseAllowanceGpm)
      ra.marginPsi = ra.availablePsi - ra.pressureAtSourcePsi
    }
    const shortZone = f.zones.find((z) => z.governing && supplyShort(z.governing))
    f.checks = f.checks.map((c) =>
      c.id === `spr-supply:${f.floorId}`
        ? supplyCheck(f.floorId, shortZone?.governing ?? f.governing, answers, false)
        : c
    )
  }
  const building = design.checks.filter(
    (c) => c.id.startsWith('spr-out-of-scope') || c.id === 'spr-spares'
  )
  design.checks = collectChecks(design, building)
}
