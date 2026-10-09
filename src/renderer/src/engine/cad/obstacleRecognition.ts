import type { DxfEntity } from '../../store/projectStore'
import { isPointInPolygon } from '../geometry'
import { rolesFromName } from './layerClassification'
import { getCadEntityBounds } from './nativeGeometry'
import type { CadLayerRole, CadObstacleCandidate, CadRoomCandidate } from './semanticTypes'

/**
 * Obstacle suggestions (columns, bulkheads, free-standing shapes). Always 'review-required'.
 *  - closed polyline / circle on a column-role layer: 0.80 (0.50 when larger than 6 ft; shapes under 0.25 ft are ignored)
 *  - other small closed shape (0.5 - 6 ft) whose centre lies inside a room candidate: 0.45
 * Geometry is measured in feet through `unitsPerFoot`, so results are unit independent.
 */
export interface ObstacleRecognitionOptions {
  unitsPerFoot: number
  layerRoles?: Record<string, CadLayerRole>
  rooms?: CadRoomCandidate[]
}

const NOT_OBSTACLE_ROLES: CadLayerRole[] = ['door', 'window', 'annotation', 'dimension', 'hatch', 'grid', 'wall', 'ceiling']

export function recognizeObstacles(
  entities: DxfEntity[],
  options: ObstacleRecognitionOptions
): { candidates: CadObstacleCandidate[] } {
  const k = options.unitsPerFoot
  if (!Number.isFinite(k) || k <= 0) return { candidates: [] }
  const roleOf = (layer: string): CadLayerRole => {
    const given = options.layerRoles?.[layer]
    if (given) return given
    const roles = rolesFromName(layer).roles
    return roles.length === 1 ? roles[0] : 'unknown'
  }
  const roomHandles = new Set((options.rooms ?? []).flatMap((r) => r.sourceHandles))
  const seen = new Map<string, CadObstacleCandidate>()
  entities.forEach((e, index) => {
    const isCircle = e.type === 'CIRCLE'
    const isClosed = (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.closed === true && !e.bulges?.some((b) => b)
    if (!isCircle && !isClosed) return
    const handle = e.handle ?? e.sourceHandle ?? `entity-${index}`
    if (roomHandles.has(handle)) return
    const layer = e.layer ?? '0'
    const role = roleOf(layer)
    const b = getCadEntityBounds(e)
    const widthFt = (b.maxX - b.minX) / k, depthFt = (b.maxY - b.minY) / k
    const size = Math.max(widthFt, depthFt)
    if (!Number.isFinite(size) || size < 0.25) return
    const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
    const polygon = isCircle
      ? Array.from({ length: 16 }, (_, i) => [
          e.x! + e.radius! * Math.cos((2 * Math.PI * i) / 16),
          e.y! + e.radius! * Math.sin((2 * Math.PI * i) / 16)
        ]).flat()
      : e.points!.slice()
    let confidence = 0
    const evidence: string[] = []
    let roomId: string | undefined
    if (role === 'column') {
      confidence = size > 6 ? 0.5 : 0.8
      evidence.push(`Closed ${isCircle ? 'circle' : 'shape'} on column layer ${layer} (${widthFt.toFixed(2)} x ${depthFt.toFixed(2)} ft).`)
      if (size > 6) evidence.push('Larger than 6 ft: unusual for a column, confirm it is an obstacle.')
    } else if (!NOT_OBSTACLE_ROLES.includes(role) && size >= 0.5 && size <= 6) {
      const room = (options.rooms ?? []).find((r) => isPointInPolygon(center.x, center.y, r.polygon))
      if (!room) return
      roomId = room.id
      confidence = 0.45
      evidence.push(`Small closed ${isCircle ? 'circle' : 'shape'} (${widthFt.toFixed(2)} x ${depthFt.toFixed(2)} ft) inside room candidate ${room.id}.`)
      if (e.sourceBlock) evidence.push(`Part of block ${e.sourceBlock}.`)
    } else return
    const key = `${layer}|${b.minX.toFixed(4)},${b.minY.toFixed(4)},${b.maxX.toFixed(4)},${b.maxY.toFixed(4)}`
    const prior = seen.get(key)
    if (prior) {
      prior.sourceHandles.push(handle)
      return
    }
    seen.set(key, {
      id: `cad-obstacle:${center.x.toFixed(3)},${center.y.toFixed(3)}:${size.toFixed(3)}`,
      shape: isCircle ? 'circle' : 'polygon',
      polygon,
      ...(isCircle ? { circle: { x: e.x!, y: e.y!, radius: e.radius! } } : {}),
      widthFt,
      depthFt,
      layer,
      ...(roomId ? { roomId } : {}),
      sourceHandles: [handle],
      confidence,
      evidence,
      status: 'review-required'
    })
  })
  return { candidates: [...seen.values()].sort((a, b) => a.id.localeCompare(b.id)) }
}
