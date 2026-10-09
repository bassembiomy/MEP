import type { DxfEntity } from '../../store/projectStore'

/**
 * Parsers keep planar geometry at a constant non-zero Z, project it onto the plan and record the
 * Z as `elevation` (drawing units). Semantic recognisers work on one level at a time: by default
 * level 0, so elevated entities are ignored unless a `level` option selects them.
 */
export type ElevatedEntity = DxfEntity & { elevation?: number }

export const entityElevation = (e: DxfEntity): number => (e as ElevatedEntity).elevation ?? 0

export const atLevel = (e: DxfEntity, level = 0): boolean => {
  const a = entityElevation(e)
  return Math.abs(a - level) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(level))
}
