import type { DeploymentManifest, MechanicalComponent } from './deploymentTypes'
import type { Zone, ProjectMetadata, Diffuser, DuctSegment } from '../store/projectStore'
import type { EquipmentCatalogItem } from './types'
import {
  measureSimplePolygon,
  requireNonnegative,
  requirePositive,
  requireFinite,
  METERS_PER_FOOT
} from './engineeringInputs'
import { ASHRAE_PROFILE } from './standards/designStandards'
import { isPointInOrOnPolygon, isSegmentInPolygon } from './validation/spatialValidator'
import { calculateFittingLoss } from './staticPressureCalc'
import { approvedZoneObstacles, ductObstacleMessage, footprintObstacleMessage, ObstacleConflictError } from './obstacleDeployment'
import { requiredExternalStaticPressure, availableFanPressureAtFlow } from './pressureBudget'

// Sorted serialization avoids object insertion-order differences and hash collisions.
function snapshot(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(snapshot).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${snapshot(v)}`)
      .join(',')}}`
  if (typeof value === 'number' && !Number.isFinite(value)) return JSON.stringify(String(value))
  return JSON.stringify(value) ?? 'undefined'
}
export function getZoneDeploymentRevision(zone: Zone): string {
  // Error/status fields added by the application are deliberately excluded.
  const fields: (keyof Zone)[] = [
    'id',
    'name',
    'points',
    'spaceTypeId',
    'ceilingHeight',
    'occupants',
    'lightingOverride',
    'equipmentOverride',
    'manualCfmOverride',
    'manualCoolingOverride',
    'systemType',
    'ductTypeId',
    'diffuserTypeId',
    'maxVelocityLimitFpm',
    'maxAvailableCeilingDepthIn',
    'maxDuctAspectRatio',
    'maxSpaceNcLimit',
    'ductLocationCategory',
    'targetNc',
    'acousticSensitivity',
    'enhancedAcousticPerformance',
    'isEquipmentLocked',
    'isDuctLocked',
    'isDiffusersLocked',
    'diffusers',
    'ducts',
    'unitPos',
    'unitPositions',
    'outdoorUnitPos',
    'outdoorUnitPositions',
    'catalogQty',
    'catalogModel',
    'catalogEsp',
    'distributionPattern',
    'coverageTargetPercent',
    'throwRadiusMode',
    'customThrowFt',
    'obstacles'
  ]
  return snapshot(Object.fromEntries(fields.map((k) => [k, zone[k]])))
}
export function getProjectDeploymentRevision(project: ProjectMetadata): string {
  const fields: (keyof ProjectMetadata)[] = [
    'scale',
    'units',
    'cadUnit',
    'cadUnitsConfirmed',
    'standardsSelection',
    'outdoorDb',
    'indoorDb',
    'humidityRatioDelta',
    'supplyDeltaTF',
    'exposedWallFraction',
    'roofExposureFraction'
  ]
  return snapshot(Object.fromEntries(fields.map((k) => [k, project[k]])))
}
type Point = { x: number; y: number }
/** Catalog dimensions converted to the drawing's axis-aligned rotated footprint. */
export function getEquipmentFootprintWorld(
  equipment: EquipmentCatalogItem,
  drawingUnitsPerFoot: number,
  rotationDeg: number
) {
  const dimensions = equipment.dimensionsIn
  if (!dimensions) throw new Error('Missing catalog dimensions for physical footprint validation')
  for (const value of [dimensions.width, dimensions.depth, dimensions.height])
    requirePositive('Catalog physical dimension', value)
  requirePositive('Drawing units per foot', drawingUnitsPerFoot)
  requireFinite('Equipment rotation', rotationDeg)
  const angle = (rotationDeg * Math.PI) / 180,
    cos = Math.abs(Math.cos(angle)),
    sin = Math.abs(Math.sin(angle))
  return {
    widthWorld: ((dimensions.width * cos + dimensions.depth * sin) / 12) * drawingUnitsPerFoot,
    heightWorld: ((dimensions.width * sin + dimensions.depth * cos) / 12) * drawingUnitsPerFoot
  }
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const near = (a: Point, b: Point) => distance(a, b) < 1e-5
function fractionOn(p: Point, a: Point, b: Point): number | undefined {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    len2 = dx * dx + dy * dy
  if (!len2) return undefined
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  return t >= -1e-8 && t <= 1 + 1e-8 && distance(p, { x: a.x + t * dx, y: a.y + t * dy }) < 1e-5
    ? Math.max(0, Math.min(1, t))
    : undefined
}
/** A conservative directed tree inferred from actual geometric attachments. */
export function validateNetwork(
  ducts: DuctSegment[],
  terminals: Diffuser[],
  units: Point[],
  scale: number
): { flows: number[]; losses: number[] } {
  if (!ducts.length || !terminals.length)
    throw new Error('Missing supply or return network evidence')
  type Edge = {
    a: Point
    b: Point
    flow: number
    duct: DuctSegment
    friction: number
    owner?: number
    loss?: number
  }
  const edges: Edge[] = []
  for (const d of ducts) {
    if (d.points.length < 4 || d.points.length % 2 || !d.points.every(Number.isFinite))
      throw new Error(`Invalid duct geometry ${d.id}`)
    for (let i = 0; i < d.points.length - 2; i += 2) {
      const a = { x: d.points[i], y: d.points[i + 1] },
        b = { x: d.points[i + 2], y: d.points[i + 3] }
      if (near(a, b)) throw new Error(`Zero length duct ${d.id}`)
      // Inverse of the equal-friction / Huebscher relation used by ductSizer.
      // The preliminary 0.10 target is a conservative floor; locked dimensions
      // must be checked for higher actual resistance at the delivered flow.
      const equivalentDiameter =
        (1.3 * Math.pow(d.widthIn * d.heightIn, 0.625)) / Math.pow(d.widthIn + d.heightIn, 0.25)
      const friction = Math.max(0.1, Math.pow(0.63 / equivalentDiameter, 5) * Math.pow(d.cfm, 1.85))
      requireFinite('Actual duct friction', friction)
      edges.push({ a, b, flow: d.cfm, duct: d, friction })
    }
  }
  const parents = new Map<Edge, { edge: Edge; t: number }>()
  for (const e of edges) {
    const roots = units.map((u, i) => (near(u, e.a) ? i : -1)).filter((i) => i >= 0)
    const matches = edges
      .filter((p) => p !== e)
      .map((p) => ({ edge: p, t: fractionOn(e.a, p.a, p.b) }))
      .filter((p): p is { edge: Edge; t: number } => p.t !== undefined && p.t > 1e-8)
    if (roots.length === 1 && matches.length === 0) e.owner = roots[0]
    else if (roots.length === 0 && matches.length === 1) parents.set(e, matches[0])
    else throw new Error(`Disconnected or ambiguous duct attachment ${e.duct.id}`)
  }
  const visiting = new Set<Edge>()
  const solve = (e: Edge): void => {
    if (e.loss !== undefined) return
    if (visiting.has(e)) throw new Error('Cyclic duct network')
    visiting.add(e)
    const parent = parents.get(e)
    let startLoss = 0
    if (parent) {
      solve(parent.edge)
      e.owner = parent.edge.owner
      const parentLength = distance(parent.edge.a, parent.edge.b) / scale
      startLoss = parent.edge.loss! - ((1 - parent.t) * parentLength * parent.edge.friction) / 100
      const parentDx = parent.edge.b.x - parent.edge.a.x,
        parentDy = parent.edge.b.y - parent.edge.a.y
      const dx = e.b.x - e.a.x,
        dy = e.b.y - e.a.y
      if (Math.abs(parentDx * dy - parentDy * dx) > 1e-8)
        startLoss += calculateFittingLoss(
          'elbow-90-unvaned',
          e.flow / ((e.duct.widthIn * e.duct.heightIn) / 144)
        ).deltaPInWg
      if (edges.filter((c) => parents.get(c)?.edge === parent.edge).length > 1)
        startLoss += calculateFittingLoss(
          'branch-tee',
          e.flow / ((e.duct.widthIn * e.duct.heightIn) / 144)
        ).deltaPInWg
    }
    e.loss = startLoss + ((distance(e.a, e.b) / scale) * e.friction) / 100
    requireFinite('Actual duct pressure', e.loss)
    visiting.delete(e)
  }
  edges.forEach(solve)
  const attached = new Map<Diffuser, Edge>()
  for (const t of terminals) {
    const matches = edges.filter((e) => near(e.b, { x: t.x, y: t.y }))
    if (matches.length !== 1) throw new Error(`Unconnected terminal ${t.id}`)
    attached.set(t, matches[0])
  }
  const below = (leaf: Edge, ancestor: Edge): boolean =>
    leaf === ancestor || (parents.has(leaf) && below(parents.get(leaf)!.edge, ancestor))
  for (const e of edges) {
    const downstream = terminals
      .filter((t) => below(attached.get(t)!, e))
      .reduce((sum, t) => sum + t.cfm, 0)
    if (Math.abs(e.flow - downstream) > 1) throw new Error(`Airflow imbalance in duct ${e.duct.id}`)
  }
  const flows = units.map((_, i) =>
    terminals.filter((t) => attached.get(t)!.owner === i).reduce((sum, t) => sum + t.cfm, 0)
  )
  const losses = units.map((_, i) =>
    Math.max(
      0,
      ...terminals
        .filter((t) => attached.get(t)!.owner === i)
        .map((t) => attached.get(t)!.loss! + t.deltaPInWg!)
    )
  )
  if (flows.some((f) => f <= 0)) throw new Error('A unit has no connected delivery network')
  return { flows, losses }
}

export function validateAppliedDeployment(
  manifest: DeploymentManifest,
  zone: Zone,
  indoorUnits: MechanicalComponent[],
  project?: ProjectMetadata
): number {
  const evidence = manifest.engineeringEvidence
  if (!evidence) throw new Error('Missing equipment, load and pressure validation evidence')
  const e = evidence.equipmentRecord,
    qty = evidence.quantity
  if (!Number.isInteger(qty) || qty <= 0) throw new Error('Invalid equipment quantity')
  for (const name of [
    'requiredSupplyCfm',
    'requiredReturnCfm',
    'requiredTotalBtuPerHour',
    'requiredSensibleBtuPerHour',
    'requiredLatentBtuPerHour'
  ] as const)
    requireNonnegative(name, evidence[name])
  if (
    typeof evidence.requiresOutdoorUnit !== 'boolean' ||
    (evidence.requiresOutdoorUnit === false && !['fcu', 'ahu'].includes(manifest.systemType))
  )
    throw new Error('Missing or incompatible outdoor topology evidence')
  requirePositive('Drawing units per foot', evidence.drawingUnitsPerFoot)
  for (const v of [
    e.totalCapacityBtuPerHour,
    e.sensibleCapacityBtuPerHour,
    e.nominalCfm,
    e.minCfm,
    e.maxCfm,
    e.maxRatedEspInWg
  ])
    requireNonnegative('Equipment rating', v)
  if (
    e.sensibleCapacityBtuPerHour > e.totalCapacityBtuPerHour ||
    e.minCfm > e.maxCfm ||
    e.systemType !== manifest.systemType
  )
    throw new Error('Incompatible equipment record')
  if (
    e.totalCapacityBtuPerHour * qty < evidence.requiredTotalBtuPerHour ||
    e.sensibleCapacityBtuPerHour * qty < evidence.requiredSensibleBtuPerHour ||
    (e.totalCapacityBtuPerHour - e.sensibleCapacityBtuPerHour) * qty <
      evidence.requiredLatentBtuPerHour
  )
    throw new Error('Equipment total, sensible or latent capacity is insufficient')
  const units = zone.unitPositions?.length ? zone.unitPositions : zone.unitPos ? [zone.unitPos] : []
  if (
    units.length !== qty ||
    indoorUnits.length !== qty ||
    indoorUnits.some((u) => u.model !== e.model)
  )
    throw new Error('Equipment quantity or model does not match engineering evidence')
  measureSimplePolygon(zone.points)
  units.forEach((p, i) => {
    const f = indoorUnits[i].footprint,
      w = f.widthWorld,
      h = f.heightWorld
    requirePositive('Equipment width', w)
    requirePositive('Equipment depth', h)
    const physical = getEquipmentFootprintWorld(
      e,
      evidence.drawingUnitsPerFoot,
      indoorUnits[i].rotationDeg
    )
    if (Math.abs(w - physical.widthWorld) > 1e-6 || Math.abs(h - physical.heightWorld) > 1e-6)
      throw new Error('Equipment footprint does not match catalog physical dimensions and rotation')
    const corners = [
      { x: p.x - w / 2, y: p.y - h / 2 },
      { x: p.x + w / 2, y: p.y - h / 2 },
      { x: p.x + w / 2, y: p.y + h / 2 },
      { x: p.x - w / 2, y: p.y + h / 2 }
    ]
    if (
      !isPointInOrOnPolygon(p.x, p.y, zone.points) ||
      corners.some((a, k) => !isSegmentInPolygon(a, corners[(k + 1) % 4], zone.points))
    )
      throw new Error('Equipment footprint is outside zone')
    const blocked = footprintObstacleMessage(
      `Equipment ${e.model} footprint`,
      { x: p.x - w / 2, y: p.y - h / 2, width: w, depth: h },
      approvedZoneObstacles(zone),
      evidence.drawingUnitsPerFoot
    )
    if (blocked) throw new ObstacleConflictError(blocked)
  })
  if (
    evidence.requiresOutdoorUnit &&
    (!zone.outdoorUnitPos ||
      !Number.isFinite(zone.outdoorUnitPos.x) ||
      !Number.isFinite(zone.outdoorUnitPos.y))
  )
    throw new Error('Missing outdoor equipment')
  const ids = new Set<string>()
  for (const t of zone.diffusers) {
    if (ids.has(t.id)) throw new Error('Duplicate terminal ID')
    ids.add(t.id)
    requirePositive('Terminal flow', t.cfm)
    requireNonnegative('Terminal pressure', t.deltaPInWg!)
    if (!isPointInOrOnPolygon(t.x, t.y, zone.points)) throw new Error('Terminal outside zone')
  }
  for (const d of zone.ducts) {
    if (ids.has(d.id)) throw new Error('Duplicate component ID')
    ids.add(d.id)
    requirePositive('Duct flow', d.cfm)
    requirePositive('Duct width', d.widthIn)
    requirePositive('Duct height', d.heightIn)
    const maxAspect = zone.maxDuctAspectRatio ?? ASHRAE_PROFILE.ductSizing.maxAspectRatio
    const availableDepth =
      zone.maxAvailableCeilingDepthIn ?? ASHRAE_PROFILE.ductSizing.preferredMaxHeightIn
    const maxVelocity =
      zone.maxVelocityLimitFpm ??
      (d.type === 'return'
        ? ASHRAE_PROFILE.velocityLimits.returnDuct
        : d.type === 'branch'
          ? ASHRAE_PROFILE.velocityLimits.branchNc30
          : ASHRAE_PROFILE.velocityLimits.mainTrunkNc30)
    requirePositive('Maximum duct aspect ratio', maxAspect)
    requirePositive('Available ceiling depth', availableDepth)
    requirePositive('Maximum duct velocity', maxVelocity)
    if (Math.max(d.widthIn / d.heightIn, d.heightIn / d.widthIn) > maxAspect + 1e-8)
      throw new Error('Duct aspect ratio exceeds configured envelope')
    const roomHeightIn =
      (zone.ceilingHeight / (project?.units === 'metric' ? METERS_PER_FOOT : 1)) * 12
    requirePositive('Actual room height', roomHeightIn)
    if (d.heightIn > Math.min(availableDepth, roomHeightIn) + 1e-8)
      throw new Error('Duct height exceeds ceiling depth or actual room height')
    const actualVelocity = d.cfm / ((d.widthIn * d.heightIn) / 144)
    if (actualVelocity > maxVelocity + 1e-8)
      throw new Error('Actual duct velocity exceeds configured envelope')
    if (d.points.length < 4 || d.points.length % 2) throw new Error('Invalid duct coordinates')
    for (let i = 0; i < d.points.length - 2; i += 2)
      if (
        !isSegmentInPolygon(
          { x: d.points[i], y: d.points[i + 1] },
          { x: d.points[i + 2], y: d.points[i + 3] },
          zone.points
        )
      )
        throw new Error('Duct segment leaves zone')
    const obstructed = ductObstacleMessage(d, approvedZoneObstacles(zone), evidence.drawingUnitsPerFoot)
    if (obstructed) throw new ObstacleConflictError(obstructed)
  }
  if (!e.capabilities.supportsDuctNetwork) {
    if (zone.ducts.length || zone.diffusers.some((t) => t.type !== 'cassette'))
      throw new Error('Locked components incompatible with ductless topology')
    if (e.nominalCfm * qty + 1 < evidence.requiredSupplyCfm)
      throw new Error('Intrinsic equipment airflow is insufficient')
    if (
      manifest.systemType === 'cassette' &&
      (zone.diffusers.length !== qty ||
        Math.abs(zone.diffusers.reduce((s, t) => s + t.cfm, 0) - evidence.requiredSupplyCfm) > 1)
    )
      throw new Error('Cassette airflow does not match demand')
    if (
      manifest.systemType === 'cassette' &&
      !units.every(
        (u) =>
          zone.diffusers.filter(
            (t) => t.type === 'cassette' && Math.hypot(t.x - u.x, t.y - u.y) < 1e-5
          ).length === 1
      )
    )
      throw new Error('Each cassette terminal must sit at its cassette unit')
    return 0
  }
  const supply = zone.diffusers.filter((t) => !t.type || t.type === 'supply'),
    returns = zone.diffusers.filter((t) => t.type === 'return')
  if (supply.length + returns.length !== zone.diffusers.length)
    throw new Error('Terminal role is incompatible with ducted topology')
  const actualSupply = supply.reduce((s, t) => s + t.cfm, 0),
    actualReturn = returns.reduce((s, t) => s + t.cfm, 0)
  if (
    Math.abs(actualSupply - evidence.requiredSupplyCfm) > 1 ||
    actualReturn + 1 < evidence.requiredReturnCfm ||
    actualReturn > actualSupply + 1
  )
    throw new Error('Actual supply or return airflow does not match demand')
  const supplyNetwork = validateNetwork(
    zone.ducts.filter((d) => d.type !== 'return'),
    supply,
    units,
    evidence.drawingUnitsPerFoot
  )
  const returnNetwork = validateNetwork(
    zone.ducts.filter((d) => d.type === 'return'),
    returns,
    units,
    evidence.drawingUnitsPerFoot
  )
  const pressures = units.map((_, i) => {
    const required = requiredExternalStaticPressure({
      supplyPathInWg: supplyNetwork.losses[i],
      returnPathInWg: returnNetwork.losses[i]
    })
    if (required > availableFanPressureAtFlow(e, supplyNetwork.flows[i]) + 1e-8)
      throw new Error('Actual per-unit fan pressure is insufficient')
    if (
      (supplyNetwork.flows[i] / actualSupply) * evidence.requiredTotalBtuPerHour >
        e.totalCapacityBtuPerHour ||
      (supplyNetwork.flows[i] / actualSupply) * evidence.requiredSensibleBtuPerHour >
        e.sensibleCapacityBtuPerHour ||
      (supplyNetwork.flows[i] / actualSupply) * evidence.requiredLatentBtuPerHour >
        e.totalCapacityBtuPerHour - e.sensibleCapacityBtuPerHour
    )
      throw new Error('Per-unit cooling capacity is insufficient for actual airflow allocation')
    return required
  })
  return Math.max(...pressures)
}
