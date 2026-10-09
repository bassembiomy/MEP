import type { DxfEntity, ProjectMetadata } from '../../store/projectStore'
import { METERS_PER_FOOT } from '../engineeringInputs'
import {
  approvedOpenings,
  userConfirmedWallLayers,
  type CadLayerRoleState,
  type StoredCadOpening
} from './cadSemanticState'
import { suggestCeilingHeight } from './levelAnnotations'
import type { CadRoomRecognitionOptions } from './semanticTypes'

export const drawingUnitsPerFoot = (project: Pick<ProjectMetadata, 'units' | 'scale'>): number =>
  project.units === 'metric' ? project.scale * METERS_PER_FOOT : project.scale

export interface RoomRecognitionBasis {
  options: CadRoomRecognitionOptions
  /** Wall layers the user confirmed; empty means "closed native polylines only". */
  wallLayers: string[]
  approvedOpeningIds: string[]
  /** Identifies the review decisions the recognition depended on, so approval can detect that they changed. */
  context: string
}

/**
 * Inputs for room recognition from the CAD review state. Only wall layers the USER confirmed are used
 * (a suggested wall role never selects boundary lines); otherwise recognition falls back to closed polylines.
 * Only approved openings on the selected level close wall gaps.
 */
export function buildRoomRecognitionBasis(input: {
  project: Pick<ProjectMetadata, 'units' | 'scale'>
  cadLayerRoles: CadLayerRoleState
  cadOpenings: StoredCadOpening[]
  cadLevel: number
  /** Layer table: layers the source froze / switched off and the user has not shown are excluded from recognition. */
  dxfLayers?: Record<string, { name: string; visible: boolean; sourceHidden?: boolean }>
}): RoomRecognitionBasis {
  const wallLayers = userConfirmedWallLayers(input.cadLayerRoles)
  const openings = approvedOpenings(input.cadOpenings, input.cadLevel)
  const approvedOpeningIds = openings.map((o) => o.id).sort()
  // Layers recognition does not read. Part of the context so showing / hiding one makes earlier candidates stale.
  const excludedLayers = Object.values(input.dxfLayers ?? {}).filter(l => l.sourceHidden && !l.visible).map(l => l.name).sort()
  return {
    options: {
      drawingUnitsPerFoot: drawingUnitsPerFoot(input.project),
      level: input.cadLevel,
      approvedOpenings: openings,
      ...(wallLayers.length ? { layers: wallLayers } : {})
    },
    wallLayers,
    approvedOpeningIds,
    context: JSON.stringify({ level: input.cadLevel, wallLayers, openings: approvedOpeningIds, excludedLayers })
  }
}

/** A ceiling height derived from drawing annotations: a SUGGESTION in the project's display unit. */
export interface CeilingHeightSuggestionView {
  /** In project units (feet, or metres for metric projects), ready to pre-fill an editable field. */
  value: number
  valueFt: number
  unit: 'ft' | 'm'
  confidence: number
  evidence: string[]
}

/**
 * Unit system of the drawing's own coordinates, taken from the CONFIRMED CAD unit (mm/cm/m metric, in/ft imperial).
 * `project.units` is a display preference and says nothing about the drawing, so it is never used. A custom or
 * unset unit, or units the user has not confirmed, give no answer (the annotation reader then decides conservatively).
 */
export function drawingUnitSystem(project: Pick<ProjectMetadata, 'cadUnit' | 'cadUnitsConfirmed'>): 'metric' | 'imperial' | undefined {
  if (project.cadUnitsConfirmed !== true) return undefined
  switch (project.cadUnit) {
    case 'mm': case 'cm': case 'm': return 'metric'
    case 'in': case 'ft': return 'imperial'
    default: return undefined
  }
}

export function ceilingHeightSuggestionFor(
  entities: DxfEntity[],
  polygon: number[],
  project: Pick<ProjectMetadata, 'units' | 'scale' | 'cadUnit' | 'cadUnitsConfirmed'>,
  level: number
): { suggestion?: CeilingHeightSuggestionView; unresolved: boolean; reasons: string[] } {
  try {
    const result = suggestCeilingHeight(entities, { polygon }, {
      unitsPerFoot: drawingUnitsPerFoot(project),
      unitsConfirmed: project.cadUnitsConfirmed === true,
      ...(drawingUnitSystem(project) ? { unitSystem: drawingUnitSystem(project) } : {}),
      level
    })
    const s = result.ceilingHeightSuggestion
    if (!s) return { unresolved: result.unresolved, reasons: result.unresolvedReasons }
    const metric = project.units === 'metric'
    return {
      suggestion: {
        value: metric ? s.valueFt * METERS_PER_FOOT : s.valueFt,
        valueFt: s.valueFt,
        unit: metric ? 'm' : 'ft',
        confidence: s.confidence,
        evidence: s.evidence
      },
      unresolved: result.unresolved,
      reasons: result.unresolvedReasons
    }
  } catch (error) {
    return { unresolved: true, reasons: [error instanceof Error ? error.message : 'Ceiling height suggestion failed.'] }
  }
}
