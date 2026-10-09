import type { BoundingBox, DxfEntity } from '../../store/projectStore'
import {
  aciToHexColor,
  cadUnitsFromInsUnits,
  suggestCadUnitsFromSpan,
  type CadImportDiagnostic,
  type ParsedDxf
} from '../dxfParser'
import { getCadEntityBounds, transformCadEntity, validateCadEntity } from './nativeGeometry'
import { describeInsertTransform } from './blockReferences'
import type { CadBlockReference } from './semanticTypes'

type Point = { x: number; y: number; z?: number }
type Matrix = { a: number; b: number; c: number; d: number; tx: number; ty: number }
interface RawEntity {
  type?: string
  handle?: string
  layer?: string
  colorIndex?: number
  color?: number
  name?: string
  entities?: unknown[]
  basePoint?: Point
  insertionPoint?: Point
  startPoint?: Point
  endPoint?: Point
  center?: Point
  majorAxisEndPoint?: Point
  direction?: Point
  extrusionDirection?: Point
  vertices?: (Point & { bulge?: number })[]
  corner1?: Point
  corner2?: Point
  corner3?: Point
  corner4?: Point
  flag?: number
  radius?: number
  axisRatio?: number
  startAngle?: number
  endAngle?: number
  xScale?: number
  yScale?: number
  rotation?: number
  columnCount?: number
  rowCount?: number
  text?: string
  textHeight?: number
  smoothType?: number
  thickness?: number
  elevation?: number
}

const identity: Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const rawObject = (value: unknown): RawEntity =>
  value && typeof value === 'object' ? (value as RawEntity) : {}
const finitePoint = (p: Point | undefined): p is Point =>
  !!p && finite(p.x) && finite(p.y) && (p.z === undefined || finite(p.z))
const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y

function compose(parent: Matrix, local: Matrix): Matrix {
  return {
    a: parent.a * local.a + parent.c * local.b,
    b: parent.b * local.a + parent.d * local.b,
    c: parent.a * local.c + parent.c * local.d,
    d: parent.b * local.c + parent.d * local.d,
    tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
    ty: parent.b * local.tx + parent.d * local.ty + parent.ty
  }
}

/**
 * Pure adapter for LibreDWG's converted database (no WASM imports).
 * libredwg-web's entityConverter exposes ARC angles and INSERT rotation in
 * radians; its svgConverter passes ARC angles to trig and converts INSERT
 * rotation by 180/PI. Ellipse startAngle/endAngle are radian parameters.
 * Reflect raw CAD coordinates once, then compose all transforms in canvas space.
 */
export function parseDwgDatabase(input: unknown): ParsedDxf {
  const db =
    input && typeof input === 'object'
      ? (input as {
          entities?: unknown[]
          tables?: { BLOCK_RECORD?: { entries?: unknown[] }; HEADER_VARS?: { INSUNITS?: unknown } }
          header?: { INSUNITS?: unknown; vars?: { INSUNITS?: unknown } }
          insUnits?: unknown
        })
      : {}
  const diagnostics: CadImportDiagnostic[] = []
  const entities: DxfEntity[] = []
  const blockReferences: CadBlockReference[] = []
  const bbox: BoundingBox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  const blocks = new Map<string, RawEntity>()
  const ambiguousBlocks = new Set<string>()
  for (const block of db.tables?.BLOCK_RECORD?.entries ?? []) {
    const raw = rawObject(block)
    if (typeof raw.name !== 'string') continue
    if (blocks.has(raw.name) || ambiguousBlocks.has(raw.name)) {
      blocks.delete(raw.name)
      ambiguousBlocks.add(raw.name)
      diagnose(
        raw,
        'ambiguous-block',
        `Duplicate block definition ${raw.name} cannot be expanded reliably.`,
        'error'
      )
    } else blocks.set(raw.name, raw)
  }
  function diagnose(
    raw: RawEntity,
    code: string,
    message: string,
    severity: 'warning' | 'error' = 'warning'
  ): void {
    diagnostics.push({ code, severity, message, entityType: raw.type, handle: raw.handle })
  }
  function planar(raw: RawEntity, points: (Point | undefined)[]): boolean {
    if (!points.every(finitePoint)) {
      diagnose(raw, 'invalid-geometry', 'Entity coordinates must be present and finite.', 'error')
      return false
    }
    if (raw.extrusionDirection !== undefined && !finitePoint(raw.extrusionDirection)) {
      diagnose(raw, 'invalid-geometry', 'Extrusion direction must be finite.', 'error')
      return false
    }
    // LibreDWG emits an all-zero vector when LWP flag1 (stored extrusion) is absent.
    const normal = raw.type==='LWPOLYLINE' && !((raw.flag??0)&1) &&
      raw.extrusionDirection?.x===0 && raw.extrusionDirection.y===0 && raw.extrusionDirection.z===0
      ? undefined : raw.extrusionDirection
    if (
      (normal &&
        (Math.abs(normal.x) > 1e-10 ||
          Math.abs(normal.y) > 1e-10 ||
          Math.abs((normal.z ?? 0) - 1) > 1e-10)) ||
      points.some((p) => Math.abs(p!.z ?? 0) > 1e-10) ||
      (raw.elevation !== undefined && (!finite(raw.elevation) || Math.abs(raw.elevation)>1e-10))
    ) {
      diagnose(
        raw,
        'nonplanar-entity',
        'Entity is outside the supported drawing XY plane; geometry was skipped.'
      )
      return false
    }
    return true
  }
  function convert(raw: RawEntity): DxfEntity | null {
    if (raw.thickness !== undefined && (!finite(raw.thickness) || raw.thickness !== 0)) {
      diagnose(
        raw,
        'unsupported-thickness',
        'Volumetric thickness cannot be represented in a 2D drawing; entity was skipped.'
      )
      return null
    }
    const common: Partial<DxfEntity> = {
      layer: raw.layer || '0',
      handle: raw.handle,
      sourceHandle: raw.handle
    }
    if (
      finite(raw.color) &&
      Number.isInteger(raw.color) &&
      raw.color >= 0 &&
      raw.color <= 0xffffff
    ) {
      common.color = `#${raw.color.toString(16).padStart(6, '0')}`
    } else if (
      finite(raw.colorIndex) &&
      Math.abs(raw.colorIndex) > 0 &&
      Math.abs(raw.colorIndex) < 256
    ) {
      common.color = aciToHexColor(Math.abs(raw.colorIndex))
    }
    switch (raw.type) {
      case 'LINE':
        if (!planar(raw, [raw.startPoint, raw.endPoint])) return null
        return {
          ...common,
          type: 'LINE',
          x: raw.startPoint!.x,
          y: -raw.startPoint!.y,
          points: [raw.endPoint!.x, -raw.endPoint!.y]
        }
      case 'LWPOLYLINE':
      case 'POLYLINE':
      case 'POLYLINE2D':
      case 'POLYLINE3D': {
        if (!Array.isArray(raw.vertices) || raw.vertices.length < 2) {
          diagnose(raw, 'invalid-geometry', 'Polyline needs at least two finite vertices.', 'error')
          return null
        }
        if (!planar(raw, raw.vertices)) return null
        if (
          (raw.flag !== undefined && !Number.isInteger(raw.flag)) ||
          raw.vertices.some((v) => v.bulge !== undefined && !finite(v.bulge))
        ) {
          diagnose(raw, 'invalid-geometry', 'Polyline flags and bulges must be finite.', 'error')
          return null
        }
        if (
          (raw.type !== 'LWPOLYLINE' && ((raw.flag ?? 0) & (2 | 4 | 8 | 16 | 64))) ||
          (raw.smoothType !== undefined && raw.smoothType !== 0)
        ) {
          diagnose(
            raw,
            'unsupported-entity',
            'Fitted or mesh polyline cannot be represented as an exact native boundary.'
          )
          return null
        }
        return {
          ...common,
          type: raw.type === 'LWPOLYLINE' ? 'LWPOLYLINE' : 'POLYLINE',
          points: raw.vertices.flatMap((v) => [v.x, -v.y]),
          closed: Boolean((raw.flag ?? 0) & (raw.type === 'LWPOLYLINE' ? 512 : 1)),
          bulges: raw.vertices.map((v) => v.bulge ?? 0)
        }
      }
      case 'CIRCLE':
      case 'ARC':
        if (!planar(raw, [raw.center])) return null
        if (raw.type === 'ARC' && (!finite(raw.startAngle) || !finite(raw.endAngle))) {
          diagnose(
            raw,
            'invalid-geometry',
            'Arc requires finite native start and end angles.',
            'error'
          )
          return null
        }
        return {
          ...common,
          type: raw.type,
          x: raw.center!.x,
          y: -raw.center!.y,
          radius: raw.radius,
          ...(raw.type === 'ARC'
            ? {
                startAngleDeg:
                  raw.startAngle === undefined ? undefined : (raw.startAngle * 180) / Math.PI,
                endAngleDeg: raw.endAngle === undefined ? undefined : (raw.endAngle * 180) / Math.PI
              }
            : {})
        }
      case 'ELLIPSE': {
        if (!planar(raw, [raw.center])) return null
        if (
          !finitePoint(raw.majorAxisEndPoint) ||
          !finite(raw.axisRatio) ||
          raw.axisRatio <= 0 ||
          raw.axisRatio > 1 ||
          !finite(raw.startAngle) ||
          !finite(raw.endAngle)
        ) {
          diagnose(
            raw,
            'invalid-geometry',
            'Ellipse major axis, axis ratio and native parameters must be valid and finite.',
            'error'
          )
          return null
        }
        if (Math.abs(raw.majorAxisEndPoint.z ?? 0) > 1e-10) {
          diagnose(raw, 'nonplanar-entity', 'Ellipse major axis is outside the drawing XY plane.')
          return null
        }
        const { x, y } = raw.majorAxisEndPoint
        return {
          ...common,
          type: 'ELLIPSE',
          x: raw.center!.x,
          y: -raw.center!.y,
          majorAxis: { x, y: -y },
          minorAxis: { x: -y * raw.axisRatio, y: -x * raw.axisRatio },
          startParam: raw.startAngle,
          endParam: raw.endAngle
        }
      }
      case 'SOLID':
      case '3DFACE': {
        const corners = [
          raw.corner1,
          raw.corner2,
          raw.corner3,
          ...(raw.corner4 ? [raw.corner4] : [])
        ]
        if (!planar(raw, corners)) return null
        // SOLID stores its last two corners in reverse boundary order.
        const ordered =
          raw.type === 'SOLID' && raw.corner4
            ? [raw.corner1!, raw.corner2!, raw.corner4, raw.corner3!]
            : (corners as Point[])
        const unique = ordered.filter(
          (p, index) => index === 0 || !samePoint(p, ordered[index - 1])
        )
        return {
          ...common,
          type: 'LWPOLYLINE',
          closed: true,
          points: unique.flatMap((p) => [p.x, -p.y])
        }
      }
      case 'TEXT':
      case 'MTEXT': {
        const p = raw.type === 'TEXT' ? raw.startPoint : raw.insertionPoint
        if (!planar(raw, [p])) return null
        let rotation = raw.rotation ?? 0
        // 0.7.7 convertMText explicitly writes rotation: 0; direction carries
        // the real baseline in WCS, so use it when supplied.
        if (raw.type === 'MTEXT' && raw.direction !== undefined) {
          if (!finitePoint(raw.direction) || Math.hypot(raw.direction.x, raw.direction.y) === 0) {
            diagnose(
              raw,
              'invalid-geometry',
              'Text direction must be a finite nonzero vector.',
              'error'
            )
            return null
          }
          if (Math.abs(raw.direction.z ?? 0) > 1e-10) {
            diagnose(raw, 'nonplanar-entity', 'Text baseline is outside the drawing XY plane.')
            return null
          }
          rotation = Math.atan2(raw.direction.y, raw.direction.x)
        }
        return {
          ...common,
          type: raw.type,
          x: p!.x,
          y: -p!.y,
          text: raw.text,
          textHeight: raw.textHeight,
          rotationDeg: (rotation * 180) / Math.PI
        }
      }
      default:
        diagnose(
          raw,
          'unsupported-entity',
          `Unsupported native DWG entity ${raw.type ?? '(unknown)'} was skipped.`
        )
        return null
    }
  }
  let visitedRecords = 0
  let expansionStopped = false
  function extract(
    rawEntities: unknown[],
    transform: Matrix,
    ancestors: Set<string>,
    sourceBlock?: string,
    inheritedLayer?: string
  ): void {
    for (const value of rawEntities) {
      if (expansionStopped) return
      const raw = rawObject(value)
      if (++visitedRecords > 100000) {
        expansionStopped = true
        diagnose(
          raw,
          'import-limit',
          'Drawing expansion exceeded the supported record limit; import is incomplete.',
          'error'
        )
        return
      }
      if (raw.type === 'INSERT') {
        const block = typeof raw.name === 'string' ? blocks.get(raw.name) : undefined
        if (!block || !Array.isArray(block.entities)) {
          diagnose(
            raw,
            'missing-block',
            `Block ${raw.name ?? '(unnamed)'} is missing its definition.`
          )
          continue
        }
        if (ancestors.has(raw.name!)) {
          diagnose(raw, 'cyclic-block', `Circular block reference ${raw.name} was skipped.`)
          continue
        }
        if (ancestors.size >= 64) {
          diagnose(
            raw,
            'import-limit',
            'Block nesting exceeded the supported depth; import is incomplete.',
            'error'
          )
          continue
        }
        const base = block.basePoint === undefined ? { x: 0, y: 0 } : block.basePoint
        if (!planar(raw, [raw.insertionPoint,base]) || !finitePoint(base)) {
          if (!finitePoint(base))
            diagnose(raw, 'invalid-geometry', 'Block base point must be finite.', 'error')
          continue
        }
        const sx = raw.xScale === undefined ? 1 : raw.xScale
        const sy = raw.yScale === undefined ? 1 : raw.yScale
        const angle = raw.rotation === undefined ? 0 : raw.rotation
        if (![sx, sy, angle].every(finite) || sx === 0 || sy === 0) {
          diagnose(
            raw,
            'invalid-geometry',
            'Block scale and rotation must be finite; scale must be nonzero.',
            'error'
          )
          continue
        }
        if ((raw.rowCount ?? 1) > 1 || (raw.columnCount ?? 1) > 1) {
          diagnose(
            raw,
            'unsupported-entity',
            'Array INSERT requires array expansion and was skipped.'
          )
          continue
        }
        const cos = Math.cos(angle),
          sin = Math.sin(angle)
        // F R S F, F = diag(1,-1); base is also reflected before subtraction.
        const local: Matrix = {
          a: cos * sx,
          b: -sin * sx,
          c: sin * sy,
          d: cos * sy,
          tx: raw.insertionPoint!.x - cos * sx * base.x + sin * sy * base.y,
          ty: -raw.insertionPoint!.y + sin * sx * base.x + cos * sy * base.y
        }
        const composed = compose(transform, local)
        if (!Object.values(composed).every(finite)) {
          diagnose(raw, 'invalid-geometry', 'Composed block transform is nonfinite.', 'error')
          continue
        }
        const childStart = entities.length
        extract(
          block.entities,
          composed,
          new Set([...ancestors, raw.name!]),
          raw.name,
          raw.layer && raw.layer !== '0' ? raw.layer : inheritedLayer
        )
        const placement = describeInsertTransform(composed, { x: base.x, y: -base.y })
        const childBounds: BoundingBox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
        for (let k = childStart; k < entities.length; k++) {
          const b = getCadEntityBounds(entities[k])
          childBounds.minX = Math.min(childBounds.minX, b.minX)
          childBounds.maxX = Math.max(childBounds.maxX, b.maxX)
          childBounds.minY = Math.min(childBounds.minY, b.minY)
          childBounds.maxY = Math.max(childBounds.maxY, b.maxY)
        }
        if (entities.length === childStart)
          Object.assign(childBounds, {
            minX: placement.insertion.x, maxX: placement.insertion.x,
            minY: placement.insertion.y, maxY: placement.insertion.y
          })
        blockReferences.push({
          handle: raw.handle ?? `INSERT:${raw.name}:${blockReferences.length}`,
          name: raw.name!,
          layer: raw.layer && raw.layer !== '0' ? raw.layer : (inheritedLayer ?? '0'),
          ...placement,
          bounds: childBounds,
          entityRange: [childStart, entities.length],
          nestingDepth: ancestors.size
        })
        continue
      }
      const converted = convert(raw)
      if (!converted) continue
      const invalid = validateCadEntity(converted)
      if (invalid) {
        diagnose(raw, 'invalid-geometry', invalid, 'error')
        continue
      }
      const transformed = transformCadEntity(converted, transform)
      const transformedInvalid = validateCadEntity(transformed)
      if (transformedInvalid) {
        diagnose(raw, 'invalid-geometry', transformedInvalid, 'error')
        continue
      }
      const bounds = getCadEntityBounds(transformed)
      if (!Object.values(bounds).every(finite)) {
        diagnose(
          raw,
          'geometry-overflow',
          'Native geometry exceeds finite drawing bounds; entity was skipped.',
          'error'
        )
        continue
      }
      transformed.sourceBlock = sourceBlock
      if (transformed.layer === '0' && inheritedLayer) transformed.layer = inheritedLayer
      if (transformed.geometryApproximation)
        diagnose(raw, 'approximated-geometry', transformed.geometryApproximation)
      entities.push(transformed)
      bbox.minX = Math.min(bbox.minX, bounds.minX)
      bbox.maxX = Math.max(bbox.maxX, bounds.maxX)
      bbox.minY = Math.min(bbox.minY, bounds.minY)
      bbox.maxY = Math.max(bbox.maxY, bounds.maxY)
    }
  }
  extract(Array.isArray(db.entities) ? db.entities : [], identity, new Set())

  const finalBbox = entities.length ? bbox : { minX: 0, maxX: 500, minY: 0, maxY: 500 }
  const rawUnits =
    db.header?.INSUNITS ??
    db.header?.vars?.INSUNITS ??
    db.insUnits ??
    db.tables?.HEADER_VARS?.INSUNITS
  const numericUnits =
    typeof rawUnits === 'number'
      ? rawUnits
      : typeof rawUnits === 'string' && rawUnits.trim()
        ? Number(rawUnits)
        : undefined
  const insUnits = finite(numericUnits) && Number.isInteger(numericUnits) ? numericUnits : undefined
  const declared = cadUnitsFromInsUnits(insUnits)
  const suggestion =
    declared ??
    suggestCadUnitsFromSpan(
      Math.max(finalBbox.maxX - finalBbox.minX, finalBbox.maxY - finalBbox.minY)
    )
  if (!declared)
    diagnostics.push({
      code: 'estimated-units',
      severity: 'warning',
      message: 'Drawing units are absent or unsupported; estimated units require confirmation.'
    })
  return {
    entities,
    bbox: finalBbox,
    diagnostics,
    blockReferences,
    insUnits,
    unitsConfidence: declared ? 'declared' : 'estimated',
    ...suggestion
  }
}
