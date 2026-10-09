import type { DxfEntity, BoundingBox } from '../../store/projectStore'
import { getCadEntityBounds } from './nativeGeometry'
import type { CadLayerClassification, CadLayerOverrides, CadLayerRole } from './semanticTypes'

/**
 * Layer role suggestions. Nothing here is authoritative: every result is a suggestion
 * with confidence and evidence, and a user override (applyLayerOverrides) always wins.
 *
 * Confidence rules:
 *  - name match + agreeing geometry statistics: 0.80 - 0.95
 *  - name match, no usable geometry (empty layer / inconclusive): 0.65
 *  - geometry statistics alone: at most 0.50
 *  - name and geometry disagree, or the name matches two different roles: 'unknown'
 */

export const CAD_LAYER_ROLES: readonly CadLayerRole[] = [
  'wall', 'door', 'window', 'column', 'furniture', 'annotation', 'dimension',
  'hatch', 'grid', 'ceiling', 'existing-hvac', 'unknown'
]

/**
 * Extensible name-token table. A layer name is split on any non-alphanumeric character
 * ("A-WALL-FULL", "XREF|S-COLS" -> tokens) and each token is matched case-insensitively.
 * AIA/NCS: A-WALL, A-DOOR, A-GLAZ, S-COLS, A-ANNO-TEXT, A-CLNG. Also English/French variants.
 */
export const LAYER_NAME_TOKENS: Record<Exclude<CadLayerRole, 'unknown'>, readonly string[]> = {
  wall: ['WALL', 'WALLS', 'MUR', 'MURS', 'PARTITION', 'PARTITIONS'],
  door: ['DOOR', 'DOORS', 'PORTE', 'PORTES', 'DR', 'DRS'],
  window: ['WIN', 'WINDOW', 'WINDOWS', 'WDW', 'GLAZ', 'GLAZING', 'FENETRE', 'FENETRES'],
  column: ['COL', 'COLS', 'COLUMN', 'COLUMNS', 'COLONNE', 'COLONNES'],
  furniture: ['FURN', 'FURNITURE', 'MEUBLE', 'MEUBLES', 'FIXT', 'FIXTURES'],
  annotation: ['ANNO', 'ANNOTATION', 'TEXT', 'TXT', 'NOTE', 'NOTES', 'LABEL', 'LABELS', 'TITLE'],
  dimension: ['DIM', 'DIMS', 'DIMENSION', 'DIMENSIONS', 'COTATION', 'COTES'],
  hatch: ['HATCH', 'PATT', 'PATTERN', 'HTCH'],
  grid: ['GRID', 'GRIDS', 'AXIS', 'AXES', 'AXE'],
  ceiling: ['CLNG', 'CLG', 'CEILING', 'CEIL', 'PLAFOND', 'RCP'],
  'existing-hvac': ['HVAC', 'DUCT', 'DUCTS', 'MECH', 'DIFFUSER', 'DIFFUSERS']
}

const FURNITURE_BLOCK = /(DESK|CHAIR|TABLE|SOFA|BED|SEAT|CABINET|SINK|WC|TOILET|FURN)/i

const nameTokens = (name: string): string[] => name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)

/** Roles named by a string (layer or block). 'annotation' is generic and dropped when a more specific role matches. */
export function rolesFromName(name: string): { roles: CadLayerRole[]; tokens: string[] } {
  const tokens = nameTokens(name)
  const matched = new Map<CadLayerRole, string[]>()
  for (const [role, list] of Object.entries(LAYER_NAME_TOKENS) as [CadLayerRole, readonly string[]][]) {
    const hit = tokens.filter((t) => list.includes(t))
    if (hit.length) matched.set(role, hit)
  }
  if (matched.size > 1) matched.delete('annotation')
  return { roles: [...matched.keys()], tokens: [...matched.values()].flat() }
}

interface LayerStats {
  total: number
  textShare: number
  longLineShare: number
  closedPolyShare: number
  smallClosedShare: number
  arcShare: number
  blockNames: string[]
}

function collectStats(entities: DxfEntity[], span: number): LayerStats {
  const count = entities.length
  let text = 0, longLines = 0, closed = 0, smallClosed = 0, arcs = 0
  const blocks = new Set<string>()
  for (const e of entities) {
    if (e.sourceBlock) blocks.add(e.sourceBlock)
    if (e.type === 'TEXT' || e.type === 'MTEXT') { text++; continue }
    if (e.type === 'ARC') { arcs++; continue }
    const b = getCadEntityBounds(e)
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY)
    if (e.type === 'CIRCLE' || ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.closed)) {
      closed++
      if (size <= span * 0.03) smallClosed++
      continue
    }
    if (e.type === 'LINE' || e.type === 'LWPOLYLINE' || e.type === 'POLYLINE')
      if (size >= span * 0.03) longLines++
  }
  const d = Math.max(count, 1)
  return {
    total: count,
    textShare: text / d,
    longLineShare: longLines / d,
    closedPolyShare: closed / d,
    smallClosedShare: smallClosed / d,
    arcShare: arcs / d,
    blockNames: [...blocks]
  }
}

/** Geometry-implied role with a 0-1 strength, or null when inconclusive. */
function statsRole(s: LayerStats): { role: CadLayerRole; strength: number; why: string } | null {
  if (s.total === 0) return null
  const blockRoles = s.blockNames.map((n) => {
    const r = rolesFromName(n).roles.filter((x) => x !== 'unknown')
    return r[0] ?? (FURNITURE_BLOCK.test(n) ? ('furniture' as CadLayerRole) : undefined)
  })
  if (blockRoles.length) {
    const tally = new Map<CadLayerRole, number>()
    blockRoles.forEach((r) => r && tally.set(r, (tally.get(r) ?? 0) + 1))
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
    if (best && best[1] / blockRoles.length >= 0.6)
      return { role: best[0], strength: best[1] / blockRoles.length, why: `block names (${s.blockNames.slice(0, 3).join(', ')}) imply ${best[0]}` }
  }
  if (s.textShare >= 0.6)
    return { role: 'annotation', strength: s.textShare, why: `${Math.round(s.textShare * 100)}% of entities are text` }
  if (s.smallClosedShare >= 0.6)
    return { role: 'column', strength: s.smallClosedShare, why: `${Math.round(s.smallClosedShare * 100)}% small closed shapes/circles` }
  if (s.arcShare >= 0.2 && s.arcShare <= 0.6)
    return { role: 'door', strength: Math.min(1, s.arcShare * 2), why: `${Math.round(s.arcShare * 100)}% arcs (door-swing pattern)` }
  const wallish = s.longLineShare + (s.closedPolyShare - s.smallClosedShare)
  if (wallish >= 0.6 && s.arcShare < 0.15)
    return { role: 'wall', strength: Math.min(1, wallish), why: `${Math.round(wallish * 100)}% long straight lines/large outlines` }
  return null
}

/** Stat roles that do not contradict a given name role. */
const COMPATIBLE: Record<CadLayerRole, readonly CadLayerRole[]> = {
  wall: ['wall'],
  door: ['door'],
  window: ['window', 'wall'],
  column: ['column'],
  furniture: ['furniture', 'column'],
  annotation: ['annotation'],
  dimension: ['annotation', 'wall'],
  hatch: ['wall', 'column', 'furniture'],
  grid: ['wall', 'column'],
  ceiling: ['wall', 'column', 'furniture'],
  'existing-hvac': ['wall', 'column', 'furniture', 'door'],
  unknown: []
}

export interface ClassifiableDrawing {
  entities: DxfEntity[]
  bbox: BoundingBox
}

export function classifyLayers(parsed: ClassifiableDrawing): CadLayerClassification[] {
  const byLayer = new Map<string, DxfEntity[]>()
  for (const e of parsed.entities) {
    const l = e.layer ?? '0'
    if (!byLayer.has(l)) byLayer.set(l, [])
    byLayer.get(l)!.push(e)
  }
  const span = Math.max(parsed.bbox.maxX - parsed.bbox.minX, parsed.bbox.maxY - parsed.bbox.minY, 1e-9)
  const out: CadLayerClassification[] = []
  for (const [layer, entities] of byLayer) {
    const evidence: string[] = []
    const conflicts: string[] = []
    const { roles, tokens } = rolesFromName(layer)
    const stats = statsRole(collectStats(entities, span))
    const finish = (role: CadLayerRole, confidence: number): void => {
      out.push({ layer, role, confidence: Math.round(confidence * 1000) / 1000, evidence, conflicts, source: 'suggested' })
    }
    if (roles.length > 1) {
      conflicts.push(`Layer name matches several roles: ${roles.join(', ')}.`)
      evidence.push(`Name tokens: ${tokens.join(', ')}`)
      finish('unknown', 0.2)
      continue
    }
    if (roles.length === 1) {
      const role = roles[0]
      evidence.push(`Layer name token ${tokens.join('/')} suggests ${role}.`)
      if (!stats) {
        evidence.push('Geometry statistics are inconclusive; name only.')
        finish(role, 0.65)
      } else if (COMPATIBLE[role].includes(stats.role)) {
        evidence.push(`Geometry agrees: ${stats.why}.`)
        finish(role, 0.8 + 0.15 * stats.strength)
      } else {
        conflicts.push(`Name suggests ${role} but geometry suggests ${stats.role}: ${stats.why}.`)
        finish('unknown', 0.2)
      }
      continue
    }
    if (stats) {
      evidence.push(`No recognised name pattern; geometry only: ${stats.why}.`)
      finish(stats.role, Math.min(0.5, 0.25 + 0.25 * stats.strength))
    } else {
      evidence.push('No recognised name pattern and no conclusive geometry.')
      finish('unknown', 0)
    }
  }
  return out.sort((a, b) => a.layer.localeCompare(b.layer))
}

/** A user override always wins over any machine suggestion, whatever its confidence. */
export function applyLayerOverrides(
  suggestions: CadLayerClassification[],
  overrides: CadLayerOverrides
): CadLayerClassification[] {
  const seen = new Set<string>()
  const result = suggestions.map((s) => {
    seen.add(s.layer)
    const role = Object.prototype.hasOwnProperty.call(overrides, s.layer) ? overrides[s.layer] : undefined
    if (!role) return s
    return {
      layer: s.layer,
      role,
      confidence: 1,
      evidence: ['User override.', ...s.evidence],
      conflicts: [],
      source: 'user' as const,
      overriddenSuggestion: { role: s.role, confidence: s.confidence }
    }
  })
  for (const [layer, role] of Object.entries(overrides))
    if (!seen.has(layer))
      result.push({ layer, role, confidence: 1, evidence: ['User override.'], conflicts: [], source: 'user' })
  return result
}

export const serializeLayerOverrides = (overrides: CadLayerOverrides): string =>
  JSON.stringify(Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b))))

/** Validating inverse of serializeLayerOverrides; invalid roles are dropped. */
export function parseLayerOverrides(json: string): CadLayerOverrides {
  const value: unknown = JSON.parse(json)
  const result: CadLayerOverrides = {}
  if (value && typeof value === 'object' && !Array.isArray(value))
    for (const [layer, role] of Object.entries(value))
      if (typeof role === 'string' && (CAD_LAYER_ROLES as readonly string[]).includes(role))
        result[layer] = role as CadLayerRole
  return result
}

export const layerRoleMap = (items: CadLayerClassification[]): Record<string, CadLayerRole> =>
  Object.fromEntries(items.map((i) => [i.layer, i.role]))
