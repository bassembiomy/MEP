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
import { layoutRoomHeads, roomLayoutChecks, selectHeadType } from './headLayout'
import type { RoomHeadLayout } from './headLayout'
import { layoutFloorPiping } from './pipingLayout'
import type { FloorPiping } from './pipingLayout'
import { distanceToPolygonEdges } from './roomDetection'
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
  SprinklerRoomInput,
  SprinklerRoomResult,
  SprinklerSystemDesign
} from './sprinklerTypes'

const MM_PER_FT = 304.8
const HAZARD_ORDER: HazardClass[] = ['light', 'ordinary-1', 'ordinary-2', 'extra-1', 'extra-2']
const HIGH_PILED =
  'High-piled storage above 12 ft requires an NFPA 13 Ch. 20–25 storage design (ESFR / CMSA / CMDA)'
const f1 = (v: number): string => v.toFixed(1)

type Pt = [number, number]

interface FloorLayoutData {
  direction: 'x' | 'y'
  roomLayouts: { room: SprinklerRoomInput; layout: RoomHeadLayout; headType: SprinklerHeadType }[]
}

function layoutFloor(
  floor: SprinklerFloorInput,
  direction: 'x' | 'y',
  answers: SprinklerDesignInput['answers']
): FloorLayoutData {
  const roomLayouts = floor.rooms
    .filter((r) => !r.omit)
    .map((room) => ({
      room,
      layout: layoutRoomHeads(room, direction, SPACING_RULES[spacingClass(room.hazard)]),
      headType: selectHeadType(room, floor.systemType, answers)
    }))
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

function designFloor(
  floor: SprinklerFloorInput,
  input: SprinklerDesignInput,
  headTypes: SprinklerHeadType[],
  source: SourceContext | undefined
): SprinklerFloorDesign {
  const answers = input.answers
  const active = floor.rooms.filter((r) => !r.omit)

  // direction
  let direction: 'x' | 'y'
  let data: FloorLayoutData
  if (floor.branchDirection === 'auto') {
    const dx = layoutFloor(floor, 'x', answers)
    const dy = layoutFloor(floor, 'y', answers)
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
    data = layoutFloor(floor, direction, answers)
  }
  const swap = direction === 'y'

  // heads, tags in room order then along rows
  const heads: PlacedSprinkler[] = []
  const rooms: SprinklerRoomResult[] = []
  const hazardByTag = new Map<string, HazardClass>()
  let n = 0
  for (const { room, layout, headType } of data.roomLayouts) {
    if (!headTypes.some((t) => t.id === headType.id)) headTypes.push(headType)
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
        node: tag
      })
    }
    let a = 0
    for (let i = 0, j = room.polygon.length - 1; i < room.polygon.length; j = i++)
      a += room.polygon[j][0] * room.polygon[i][1] - room.polygon[i][0] * room.polygon[j][1]
    rooms.push({
      roomId: room.id,
      name: room.name,
      hazard: room.hazard,
      areaM2: Math.abs(a) / 2 / 1e6,
      headCount: pts.length,
      headTypeId: headType.id,
      spacingSmm: layout.S,
      spacingLmm: layout.L,
      maxSpacingMm: rules.maxSpacingFt * MM_PER_FT,
      maxAreaFt2: rules.maxAreaFt2,
      checks: roomLayoutChecks(room, layout, rules, direction)
    })
  }

  // piping
  const piping: FloorPiping = layoutFloorPiping(floor.id, heads, floor.riser, direction, {
    hazardOf: (tag) => hazardByTag.get(tag) ?? 'light',
    schedule: answers.pipeMaterial === 'black-steel-sch10' ? 'sch10' : 'sch40',
    minMainIn: 2
  })

  // hydraulics
  const minCeiling = active.length ? Math.min(...active.map((r) => r.ceilingHeightM)) : 3
  const hctx: FloorHydraulicContext = {
    direction,
    pipeMaterial: answers.pipeMaterial,
    hazardOf: (tag) => hazardByTag.get(tag) ?? 'light',
    pipeElevationM: floor.elevationM + minCeiling - 0.3,
    buildingRiserIn: input.buildingRiserIn,
    buildingRiserSchedule: input.buildingRiserSchedule,
    supply: answers.supply,
    source
  }
  const hazards = HAZARD_ORDER.filter((h) => heads.some((x) => hazardByTag.get(x.tag) === h))
  let remoteAreas: RemoteAreaResult[] = []
  let governing: RemoteAreaResult | null = null
  let short: { hazard: HazardClass; have: number; need: number }[] = []
  let carried: string[] = []
  for (let round = 0; round <= 6; round++) {
    remoteAreas = []
    short = []
    governing = null
    carried = []
    let govCarried: string[] = []
    for (const hz of hazards) {
      const out = calculateFloorDemand(floor, piping, heads, headTypes, floor.systemType, hz, hctx)
      if (!out) continue
      remoteAreas.push(out.result)
      if (out.candidateCount < out.requiredHeads && floor.systemType !== 'deluge')
        short.push({ hazard: hz, have: out.candidateCount, need: out.requiredHeads })
      if (!governing || out.result.pressureAtSourcePsi > governing.pressureAtSourcePsi) {
        governing = out.result
        govCarried = out.carriedPipeIds
      }
    }
    carried = govCarried
    if (
      !governing ||
      answers.supply.kind !== 'city' ||
      !supplyShort(governing) ||
      round === 6
    )
      break
    for (const id of carried) {
      const p = piping.pipes.find((q) => q.id === id)
      if (p) p.sizeIn = upsizeOne(p.sizeIn)
    }
  }
  const gov = governing as RemoteAreaResult | null

  // volume, hangers
  let volumeGal = 0
  const hangers: SprinklerFloorDesign['hangers'] = []
  for (const p of piping.pipes) {
    const id = internalDiameterIn(p.sizeIn, p.schedule)
    volumeGal += (((p.lengthM * FT_PER_M * 12 * Math.PI) / 4) * id * id) / 231
    if (p.kind === 'riser-nipple') continue // vertical riser nipple: supported by the riser clamp, not hung
    const nh = Math.ceil(p.lengthM / hangerSpacingM(p.sizeIn, answers.pipeMaterial) - 1e-9)
    const lenMm = p.lengthM * 1000
    for (let i = 0; i < nh; i++) {
      const [x, y] = pathAlong(p.points, ((i + 0.5) * lenMm) / nh)
      hangers.push({ x, y, pipeId: p.id })
    }
  }

  let inspector = { x: floor.riser.x, y: floor.riser.y }
  if (gov) {
    const rh = heads.find((h) => h.tag === gov.rows[0].fromNode)
    if (rh) inspector = { x: rh.x, y: rh.y }
  }

  const checks: DesignCheck[] = []
  const fid = floor.id
  const sys = floor.systemType
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
  checks.push(supplyCheck(fid, gov, answers, !source))
  if (sys === 'dry') {
    const cls = gov ? spacingClass(gov.hazard) : 'light'
    const t = DRY_DELIVERY_TIME_S[cls]
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
      status: heads.length <= PREACTION_MAX_CLOSED_SPRINKLERS ? 'pass' : 'fail',
      detail: `${heads.length} closed sprinklers per preaction valve (max ${PREACTION_MAX_CLOSED_SPRINKLERS})`
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
    pipes: piping.pipes,
    rooms,
    riser: { ...floor.riser },
    inspectorTest: inspector,
    hangers,
    volumeGal,
    remoteAreas,
    governing: gov,
    checks
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
    ...design.floors.flatMap((f) => [...f.rooms.flatMap((r) => r.checks), ...f.checks]),
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
    f.checks = f.checks.map((c) =>
      c.id === `spr-supply:${f.floorId}` ? supplyCheck(f.floorId, f.governing, answers, false) : c
    )
  }
  const building = design.checks.filter(
    (c) => c.id.startsWith('spr-out-of-scope') || c.id === 'spr-spares'
  )
  design.checks = collectChecks(design, building)
}
