import type { Diffuser, DuctSegment, Zone } from '../../store/projectStore'
import { isPointInOrOnPolygon, isSegmentInPolygon } from '../validation/spatialValidator'
import { validateNetwork, validateAppliedDeployment, getZoneDeploymentRevision, getProjectDeploymentRevision } from '../deploymentValidation'
import { solveDirectedNetworkStaticPressure } from '../staticPressureCalc'
import { STANDARD_DIFFUSER_CATALOG, STANDARD_DUCT_TYPES } from '../hvacCatalogs'
import type { DeploymentManifest } from '../deploymentTypes'

/**
 * Pure drag edits for deployed components. Duct endpoints follow the same geometric attachment rules as
 * validateNetwork: a terminal sits on a duct segment's end point, a unit on a root segment's start point, and a
 * branch starts on exactly one parent segment. Edits never claim engineering validity: the zone is returned
 * 'stale' and verifyEditedZone() must be run explicitly.
 */
export interface EditContext {
  /** Drawing units per foot (project.scale, times 0.3048 for metric projects). */
  drawingUnitsPerFoot: number
  /** project.scale, as used by the static-pressure estimate. */
  projectScale: number
}
export type ComponentPatch = Partial<Pick<Zone, 'diffusers' | 'ducts' | 'unitPos' | 'unitPositions' | 'outdoorUnitPos' | 'outdoorUnitPositions' | 'catalogEsp' | 'engineeringStatus'>>
export type ComponentEdit = { ok: true; patch: ComponentPatch; warnings: string[] } | { ok: false; error: string }

type P = { x: number; y: number }
const TOL = 1e-5
const near = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y) < TOL
const fail = (error: string): ComponentEdit => ({ ok: false, error })
const unitsOf = (z: Zone): P[] => z.unitPositions?.length ? z.unitPositions : z.unitPos ? [z.unitPos] : []
const cloneDucts = (ducts: DuctSegment[]) => ducts.map(d => ({ ...d, points: [...d.points] }))

function fractionOn(p: P, a: P, b: P): number | undefined {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy
  if (!l2) return undefined
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2
  return t >= -1e-8 && t <= 1 + 1e-8 && Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) < TOL ? Math.max(0, Math.min(1, t)) : undefined
}

/** null: network validates; string: why it does not; 'skip': nothing to validate. */
function networkProblem(zone: Zone, ctx: EditContext): string | null | 'skip' {
  const units = unitsOf(zone)
  if (!units.length || !zone.ducts.length || !zone.diffusers.length) return 'skip'
  const supply = zone.diffusers.filter(t => !t.type || t.type === 'supply'), returns = zone.diffusers.filter(t => t.type === 'return')
  try {
    const s = zone.ducts.filter(d => d.type !== 'return'), r = zone.ducts.filter(d => d.type === 'return')
    if (s.length && supply.length) validateNetwork(s, supply, units, ctx.drawingUnitsPerFoot)
    if (r.length && returns.length) validateNetwork(r, returns, units, ctx.drawingUnitsPerFoot)
    return null
  } catch (e) { return e instanceof Error ? e.message : String(e) }
}
function finish(before: Zone, after: Zone, patch: ComponentPatch, ctx: EditContext, label: string): ComponentEdit {
  const warnings: string[] = []
  const was = networkProblem(before, ctx), now = networkProblem(after, ctx)
  if (now !== null && now !== 'skip') {
    if (was === null) return fail(`${label} would disconnect or unbalance the duct network: ${now}`)
    warnings.push(`Duct network was already not verifiable before this edit (${was === 'skip' ? 'no network' : was}).`)
  }
  let catalogEsp = after.catalogEsp
  if (after.ducts.length && after.diffusers.length) {
    try {
      const cp = solveDirectedNetworkStaticPressure(after.ducts, after.diffusers, STANDARD_DIFFUSER_CATALOG, STANDARD_DUCT_TYPES[0], ctx.projectScale)
      if (cp.espRequiredInWg > 0) catalogEsp = `${cp.espRequiredInWg.toFixed(2)} in.wg`
    } catch { warnings.push('Static pressure estimate could not be refreshed.') }
  }
  return { ok: true, patch: { ...patch, catalogEsp, engineeringStatus: 'stale' }, warnings }
}
const finite = (...v: number[]) => v.every(Number.isFinite)

export function moveTerminal(zone: Zone, terminalId: string, x: number, y: number, ctx: EditContext): ComponentEdit {
  const old = zone.diffusers.find(t => t.id === terminalId)
  if (!old) return fail('Terminal not found.')
  if (!finite(x, y)) return fail('Terminal position must be finite.')
  if (!isPointInOrOnPolygon(x, y, zone.points)) return fail('Terminal cannot be moved outside its room.')
  const from = { x: old.x, y: old.y }, to = { x, y }
  const ducts = cloneDucts(zone.ducts)
  for (const d of ducts) {
    const n = d.points.length / 2
    for (let i = 0; i < n; i++) {
      if (!near({ x: d.points[2 * i], y: d.points[2 * i + 1] }, from)) continue
      const oldStart = { x: d.points[0], y: d.points[1] }
      d.points[2 * i] = x; d.points[2 * i + 1] = y
      if (n === 2 && i === 1 && d.type === 'branch') {
        const res = slideBranchStart(ducts, d, oldStart, from, to, zone, ctx)
        if (res) return fail(res)
      }
    }
  }
  const diffusers: Diffuser[] = zone.diffusers.map(t => t.id === terminalId ? { ...t, x, y } : t)
  return finish(zone, { ...zone, diffusers, ducts }, { diffusers, ducts }, ctx, 'Moving the terminal')
}

/** Keep a two-point branch's start on its parent segment, extending the parent's free end when the branch slides past it. Returns an error or null. */
function slideBranchStart(ducts: DuctSegment[], branch: DuctSegment, oldStart: P, oldEnd: P, newEnd: P, zone: Zone, ctx: EditContext): string | null {
  void ctx
  let parent: { duct: DuctSegment; i: number } | null = null
  for (const d of ducts) {
    if (d === branch) continue
    for (let i = 0; i < d.points.length - 2; i += 2) {
      if (fractionOn(oldStart, { x: d.points[i], y: d.points[i + 1] }, { x: d.points[i + 2], y: d.points[i + 3] }) !== undefined) { parent = { duct: d, i }; break }
    }
    if (parent) break
  }
  if (!parent) return null // rooted at a unit: start does not move
  const a = { x: parent.duct.points[parent.i], y: parent.duct.points[parent.i + 1] }, b = { x: parent.duct.points[parent.i + 2], y: parent.duct.points[parent.i + 3] }
  const vertical = Math.abs(oldEnd.x - oldStart.x) < Math.abs(oldEnd.y - oldStart.y)
  const want = vertical ? { x: newEnd.x, y: oldStart.y } : { x: oldStart.x, y: newEnd.y }
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy
  const t = ((want.x - a.x) * dx + (want.y - a.y) * dy) / l2
  const start = { x: a.x + t * dx, y: a.y + t * dy }
  if (t < 0 || t > 1) { // parent must be stretched; only a free end may move
    const endIsB = t > 1
    const end = endIsB ? b : a
    const index = endIsB ? parent.i + 2 : parent.i
    const attached = ducts.some(d => d !== parent!.duct && d.points.length >= 2 && (near({ x: d.points[0], y: d.points[1] }, end) || near({ x: d.points[d.points.length - 2], y: d.points[d.points.length - 1] }, end))) ||
      zone.diffusers.some(tt => near({ x: tt.x, y: tt.y }, end)) || unitsOf(zone).some(u => near(u, end)) ||
      (parent.duct.points.length > 4 && index !== 0 && index !== parent.duct.points.length - 2)
    if (attached) return 'The parent duct cannot be stretched because its end is connected to other components.'
    parent.duct.points[index] = start.x; parent.duct.points[index + 1] = start.y
  }
  branch.points[0] = start.x; branch.points[1] = start.y
  for (let i = 0; i < parent.duct.points.length - 2; i += 2) {
    if (!isSegmentInPolygon({ x: parent.duct.points[i], y: parent.duct.points[i + 1] }, { x: parent.duct.points[i + 2], y: parent.duct.points[i + 3] }, zone.points)) return 'Stretched duct would leave the room.'
  }
  return null
}

export function moveIndoorUnit(zone: Zone, unitIndex: number, x: number, y: number, ctx: EditContext): ComponentEdit {
  const units = unitsOf(zone)
  if (unitIndex < 0 || unitIndex >= units.length) return fail('Unit not found.')
  if (!finite(x, y)) return fail('Unit position must be finite.')
  if (!isPointInOrOnPolygon(x, y, zone.points)) return fail('Unit cannot be moved outside its room.')
  const from = units[unitIndex]
  const ducts = cloneDucts(zone.ducts)
  for (const d of ducts) if (d.points.length >= 4 && near({ x: d.points[0], y: d.points[1] }, from)) { d.points[0] = x; d.points[1] = y }
  const nextUnits = units.map((u, i) => i === unitIndex ? { x, y } : u)
  const patch: ComponentPatch = { ducts, unitPos: unitIndex === 0 ? { x, y } : zone.unitPos }
  if (zone.unitPositions?.length) patch.unitPositions = nextUnits
  return finish(zone, { ...zone, ...patch }, patch, ctx, 'Moving the unit')
}

export function moveOutdoorUnit(zone: Zone, index: number, x: number, y: number): ComponentEdit {
  if (!finite(x, y)) return fail('Outdoor unit position must be finite.')
  const list = zone.outdoorUnitPositions
  const patch: ComponentPatch = { outdoorUnitPos: index === 0 ? { x, y } : zone.outdoorUnitPos, engineeringStatus: 'stale' }
  if (list && list.length > index) patch.outdoorUnitPositions = list.map((p, i) => i === index ? { x, y } : p)
  return { ok: true, patch, warnings: [] }
}

/** Translate a duct (a trunk drags same-row trunks and stretches branch takeoffs while terminals stay put). */
export function translateDuct(zone: Zone, ductId: string, dx: number, dy: number, ctx: EditContext): ComponentEdit {
  const target = zone.ducts.find(d => d.id === ductId)
  if (!target) return fail('Duct not found.')
  if (!finite(dx, dy)) return fail('Offset must be finite.')
  if (dx === 0 && dy === 0) return { ok: true, patch: {}, warnings: [] }
  const shift = (d: DuctSegment, endToo: boolean) => {
    const p = [...d.points]
    p[0] += dx; p[1] += dy
    if (endToo) { p[2] += dx; p[3] += dy }
    return { ...d, points: p }
  }
  const ducts = zone.ducts.map(d => {
    if (target.type === 'trunk') {
      if (d.id === ductId || (d.type === 'trunk' && Math.abs(d.points[1] - target.points[1]) < 5)) return shift(d, true)
      if (d.type === 'branch' && Math.abs(d.points[1] - target.points[1]) < 15) return shift(d, false)
      return d
    }
    return d.id === ductId ? shift(d, true) : d
  })
  for (const d of ducts) for (let i = 0; i < d.points.length - 2; i += 2) {
    if (!isSegmentInPolygon({ x: d.points[i], y: d.points[i + 1] }, { x: d.points[i + 2], y: d.points[i + 3] }, zone.points)) return fail('Duct segment would leave the room.')
  }
  return finish(zone, { ...zone, ducts }, { ducts }, ctx, 'Moving the duct')
}

export type VerifyResult = { ok: true; pressureInWg: number } | { ok: false; error: string }
const INPUTS_CHANGED = 'Room or project inputs changed since the last automatic design; inputs changed; re-run automatic design to validate the layout.'
/**
 * Fingerprint of the engineering inputs a deployment was designed for: the deployment revision fields minus everything
 * a component drag may legitimately change (terminals, ducts, unit positions, the derived catalog ESP).
 */
export function zoneInputsFingerprint(zone: Zone): string {
  return getZoneDeploymentRevision({ ...zone, diffusers: undefined, ducts: undefined, unitPos: undefined, unitPositions: undefined,
    outdoorUnitPos: undefined, outdoorUnitPositions: undefined, catalogEsp: undefined } as unknown as Zone)
}
/**
 * Explicit apply step: re-run validateAppliedDeployment against the deployment evidence. Never reports validity on
 * failure, when no evidence is available, or when the room/project inputs differ from those the evidence was built for
 * (required CFM, loads and drawing scale in the manifest are stored values and would otherwise be stale).
 */
export function verifyEditedZone(zone: Zone, manifest: DeploymentManifest | null | undefined, project?: Parameters<typeof validateAppliedDeployment>[3], deployedInputs?: string): VerifyResult {
  if (!manifest || manifest.zoneId !== zone.id) return { ok: false, error: 'No deployment evidence is available for this room; re-run automatic design to validate the edited layout.' }
  if (!project || manifest.sourceProjectRevision === undefined || manifest.sourceProjectRevision !== getProjectDeploymentRevision(project)) return { ok: false, error: INPUTS_CHANGED }
  if (deployedInputs !== undefined && deployedInputs !== zoneInputsFingerprint(zone)) return { ok: false, error: INPUTS_CHANGED }
  const evidenceEquipment = manifest.engineeringEvidence?.equipmentRecord, evidenceQty = manifest.engineeringEvidence?.quantity
  if (zone.catalogModel !== undefined && evidenceEquipment && zone.catalogModel !== evidenceEquipment.model) return { ok: false, error: 'Room equipment model differs from the deployment evidence; inputs changed; re-run automatic design.' }
  if (zone.catalogQty !== undefined && evidenceQty !== undefined && zone.catalogQty !== evidenceQty) return { ok: false, error: 'Room equipment quantity differs from the deployment evidence; inputs changed; re-run automatic design.' }
  if (zone.unitPos && zone.unitPositions?.length && !near(zone.unitPos, zone.unitPositions[0])) return { ok: false, error: 'unitPos and unitPositions[0] disagree; the indoor unit position is ambiguous.' }
  const indoor = manifest.equipment.cassetteUnits?.length ? manifest.equipment.cassetteUnits : manifest.equipment.indoorUnit ? [manifest.equipment.indoorUnit] : []
  const positions = unitsOf(zone)
  const units = indoor.map((u, i) => positions[i] ? { ...u, position: { ...u.position, x: positions[i].x, y: positions[i].y } } : u)
  try {
    return { ok: true, pressureInWg: validateAppliedDeployment(manifest, zone, units, project) }
  } catch (e) {
    return { ok: false, error: `Edited layout failed engineering validation: ${e instanceof Error ? e.message : String(e)}` }
  }
}
