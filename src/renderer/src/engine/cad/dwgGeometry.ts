import type { BoundingBox, DxfEntity } from '../../store/projectStore'
import {
  aciToHexColor,
  resolveCadUnits,
  sampleSplineData,
  type CadImportDiagnostic,
  type ParsedDxf
} from '../dxfParser'
import { getCadEntityBounds, transformCadEntity, validateCadEntity } from './nativeGeometry'
import { dxfTextJustification, mtextAttachment, storedJustification, type TextHAlign, type TextVAlign } from './textJustification'
import { describeInsertTransform, insertTransformHasShear } from './blockReferences'
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
  attribs?: unknown[]
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
  zScale?: number
  rotation?: number
  halign?: number
  valign?: number
  /** DWG TEXT / ATTRIB `dataflags` (attached by dwgParser): bit 0x02 set means the alignment point is not stored (default: the insertion point). */
  textDataFlags?: number
  attachmentPoint?: number
  columnCount?: number
  rowCount?: number
  text?: string
  textHeight?: number
  smoothType?: number
  degree?: number
  controlPoints?: Point[]
  fitPoints?: Point[]
  knots?: number[]
  weights?: number[]
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
          tables?: {
            BLOCK_RECORD?: { entries?: unknown[] }
            LAYER?: { entries?: unknown[] }
            HEADER_VARS?: { INSUNITS?: unknown }
          }
          header?: { INSUNITS?: unknown; MEASUREMENT?: unknown; vars?: { INSUNITS?: unknown; MEASUREMENT?: unknown } }
          insUnits?: unknown
        })
      : {}
  const diagnostics: CadImportDiagnostic[] = []
  const entities: DxfEntity[] = []
  // Layer table: frozen layers and layers switched off are imported but hidden by default (same as the DXF path).
  const hiddenLayers = new Set<string>()
  const frozenLayers = new Set<string>()
  for (const layer of db.tables?.LAYER?.entries ?? []) {
    const l = layer as { name?: unknown; frozen?: unknown; off?: unknown }
    if (typeof l.name !== 'string') continue
    if (l.frozen === true) frozenLayers.add(l.name)
    if (l.frozen === true || l.off === true) hiddenLayers.add(l.name)
  }
  let paperSpaceSkipped = 0
  // libredwg-web also appends every top-level INSERT's attributes to db.entities (owner = the INSERT's handle). They are
  // drawn through INSERT.attribs below, so the loose records are duplicates and not "unsupported entities".
  const insertHandles = new Set<string>()
  const collectInserts = (records: unknown[] | undefined): void => {
    for (const record of records ?? []) {
      const r = rawObject(record)
      if (r.type === 'INSERT' && typeof r.handle === 'string') insertHandles.add(r.handle)
    }
  }
  collectInserts(db.entities)
  for (const block of db.tables?.BLOCK_RECORD?.entries ?? []) collectInserts(rawObject(block).entities)
  const blockReferences: CadBlockReference[] = []
  const bbox: BoundingBox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  const blocks = new Map<string, RawEntity>()
  const ambiguousBlocks = new Set<string>()
  // Layout records (*Model_Space, *Paper_Space, *Paper_SpaceN) are not INSERT targets. LibreDWG's own writer emits a
  // second *Model_Space record, which must not be reported as an ambiguous block definition.
  const paperSpaceRecords = new Set<string>()
  const layoutRecord = /^\*(model_space|paper_space\d*)$/i
  for (const block of db.tables?.BLOCK_RECORD?.entries ?? []) {
    const raw = rawObject(block)
    if (typeof raw.name !== 'string') continue
    if (layoutRecord.test(raw.name)) {
      if (/^\*paper_space/i.test(raw.name) && typeof raw.handle === 'string') paperSpaceRecords.add(raw.handle)
      continue
    }
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
  let pendingElevation = 0
  // A -Z extrusion mirrors the OCS X axis (and the sign of Z) for entities stored in OCS; LINE / ELLIPSE / SPLINE are WCS
  // entities and ignore it. Same rule as the DXF path (dxfParser `reflected`).
  let pendingReflected = false
  const ocsMirror: Matrix = { a: -1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
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
      normal &&
      (Math.abs(normal.x) > 1e-10 ||
        Math.abs(normal.y) > 1e-10 ||
        Math.abs(Math.abs(normal.z ?? 0) - 1) > 1e-10)
    ) {
      diagnose(raw, 'nonplanar-entity', 'Entity is outside the supported drawing XY plane; geometry was skipped.')
      return false
    }
    pendingReflected = !!normal && (normal.z ?? 0) < 0 && !['LINE', 'ELLIPSE', 'SPLINE'].includes(raw.type ?? '')
    if (raw.elevation !== undefined && !finite(raw.elevation)) {
      diagnose(raw, 'nonplanar-entity', 'Entity elevation is not finite; geometry was skipped.')
      return false
    }
    // Planner decision: planar geometry at one constant non-zero Z is kept and projected (see pendingElevation).
    // LWPOLYLINE vertices are 2D, so only its elevation counts; other entities need all point Z equal.
    const zs = raw.type === 'LWPOLYLINE' ? [] : points.map((p) => p!.z ?? 0)
    const elevation = raw.elevation ?? 0
    const zBase = zs.length ? zs[0] : elevation
    const uniform = zs.every((z) => Math.abs(z - zBase) <= 1e-10) &&
      (elevation === 0 || zBase === 0 || Math.abs(elevation - zBase) <= 1e-10)
    if (!uniform) {
      diagnose(raw, 'nonplanar-entity', 'Entity is outside the supported drawing XY plane (varying Z); geometry was skipped.')
      return false
    }
    const z = zBase !== 0 ? zBase : elevation
    if (Math.abs(z) > 1e-10) pendingElevation = z
    return true
  }
  let reflectedEntity = false
  // Elevation of a child at block-space Z `cz` is zScale * cz + zOffset (affine, composed per nested INSERT).
  function convert(raw: RawEntity, zScale = 1, zOffset = 0): DxfEntity | null {
    pendingElevation = 0
    pendingReflected = false
    const converted = convertPlanar(raw)
    if (!converted) return converted
    reflectedEntity = pendingReflected
    const stored = zScale * (pendingReflected ? -pendingElevation : pendingElevation) + zOffset
    if (stored !== 0) (converted as DxfEntity & { elevation?: number }).elevation = stored
    if (pendingElevation !== 0)
      diagnose(
        raw,
        'elevated-geometry-projected',
        `${raw.type} at elevation ${stored} is projected onto the plan; its elevation is retained.`
      )
    return converted
  }
  function convertPlanar(raw: RawEntity): DxfEntity | null {
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
      case 'SPLINE': {
        // libredwg-web: controlPoints / fitPoints are {x,y,z}[], knots and weights number[]; flag is the DXF-style 70 value.
        const control = Array.isArray(raw.controlPoints) ? raw.controlPoints : []
        const fit = Array.isArray(raw.fitPoints) ? raw.fitPoints : []
        if (!planar(raw, [...control, ...fit])) return null
        // libredwg-web's `flag` is DWG splineflags (8 control-point method, 9 fit-point method in R2000-R2013): bit 0 selects
        // the fit-point method and does not mean closed, and the DWG closed bit is not exposed. Closure is therefore read
        // from the geometry: coincident end points, or a periodic (unclamped, wrapped) control polygon.
        const degree = raw.degree ?? 3
        const knots = Array.isArray(raw.knots) ? raw.knots : []
        const near = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= 1e-9
        const useControl = control.length >= 2 && knots.length === control.length + degree + 1
        const periodic = useControl && Number.isInteger(degree) && degree >= 1 && degree < control.length &&
          knots[0] !== knots[degree] && control.slice(0, degree).every((p, i) => near(p, control[control.length - degree + i]))
        const coincident = useControl
          ? near(control[0], control[control.length - 1])
          : fit.length >= 3 && near(fit[0], fit[fit.length - 1])
        const closed = periodic || coincident
        const fitPts = !useControl && closed ? fit.slice(0, -1) : fit
        const sampled = sampleSplineData({
          closed,
          degree,
          control: control.map((p): [number, number] => [p.x, p.y]),
          fit: fitPts.map((p): [number, number] => [p.x, p.y]),
          knots,
          weights: Array.isArray(raw.weights) ? raw.weights : []
        })
        if (!sampled) {
          diagnose(raw, 'unsupported-entity', 'SPLINE has no usable control points with knots, or fit points; source geometry omitted.')
          return null
        }
        const points: number[] = []
        for (let k = 0; k < sampled.points.length; k += 2) points.push(sampled.points[k], -sampled.points[k + 1])
        return {
          ...common,
          type: 'LWPOLYLINE',
          closed: sampled.closed,
          points,
          bulges: points.map(() => 0).slice(0, points.length / 2),
          geometryApproximation: `SPLINE sampled as a polyline from its ${sampled.how}; the curve is approximate`
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
        // Justification (see textJustification.ts). `endPoint` is the alignment point, but libredwg reports {0,0} when
        // the DWG stores none, so it is only read when halign / valign say the text is justified.
        let hAlign: TextHAlign = 'left', vAlign: TextVAlign = raw.type === 'MTEXT' ? 'top' : 'baseline'
        let anchor: Point | undefined = p
        if (raw.type === 'MTEXT') {
          if (raw.attachmentPoint !== undefined) {
            const a = mtextAttachment(raw.attachmentPoint)
            if (a) ({ hAlign, vAlign } = a)
            else diagnose(raw, 'text-justification-unsupported', `MTEXT attachment point ${String(raw.attachmentPoint)} is not 1..9; top-left used.`)
          }
        } else {
          const j = dxfTextJustification(raw.halign ?? 0, raw.valign ?? 0)
          if (j.invalid) diagnose(raw, 'text-justification-unsupported', `TEXT justification (halign ${String(raw.halign)}, valign ${String(raw.valign)}) is not supported; left/baseline at the insertion point used.`)
          else if (j.anchor !== 'p10') {
            // DWG data flags bit 0x02: the alignment point is not stored and equals the insertion point (libredwg reports {0,0}
            // for it). Without data flags (a record that could not be matched to its entity) {0,0} is indistinguishable from a
            // real origin point, so it counts as missing there; with them, a stored point is used even when it is {0,0}
            // (block-local coordinates are legitimate).
            const flagged = finite(raw.textDataFlags)
            const omitted = flagged && (raw.textDataFlags! & 0x02) !== 0
            const stored = omitted || (finitePoint(raw.endPoint) && (flagged || !(raw.endPoint.x === 0 && raw.endPoint.y === 0)))
            if (stored && finitePoint(p)) {
              ;({ hAlign, vAlign } = j)
              const alignment = omitted ? p : raw.endPoint!
              anchor = j.anchor === 'p11' ? alignment : { x: (p.x + alignment.x) / 2, y: (p.y + alignment.y) / 2, z: p.z }
            } else diagnose(raw, 'text-alignment-point-missing', 'TEXT is justified but has no usable alignment point; left/baseline at the insertion point used.')
          }
        }
        if (!planar(raw, [p, ...(anchor !== p && finitePoint(anchor) ? [anchor] : [])])) return null
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
          x: anchor!.x,
          y: -anchor!.y,
          text: raw.text,
          textHeight: raw.textHeight,
          rotationDeg: (rotation * 180) / Math.PI,
          ...storedJustification(raw.type, hAlign, vAlign)
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
  function emit(
    raw: RawEntity,
    transform: Matrix,
    sourceBlock: string | undefined,
    inheritedLayer: string | undefined,
    frozenBy: string | undefined,
    zScale: number,
    zOffset: number
  ): void {
    const converted = convert(raw, zScale, zOffset)
    if (!converted) return
    const invalid = validateCadEntity(converted)
    if (invalid) {
      diagnose(raw, 'invalid-geometry', invalid, 'error')
      return
    }
    const transformed = transformCadEntity(converted, reflectedEntity ? compose(transform, ocsMirror) : transform)
    const transformedInvalid = validateCadEntity(transformed)
    if (transformedInvalid) {
      diagnose(raw, 'invalid-geometry', transformedInvalid, 'error')
      return
    }
    const bounds = getCadEntityBounds(transformed)
    if (!Object.values(bounds).every(finite)) {
      diagnose(
        raw,
        'geometry-overflow',
        'Native geometry exceeds finite drawing bounds; entity was skipped.',
        'error'
      )
      return
    }
    transformed.sourceBlock = sourceBlock
    const ownLayer = !transformed.layer || transformed.layer === '0' ? (inheritedLayer ?? '0') : transformed.layer
    transformed.layer = frozenBy && !hiddenLayers.has(ownLayer) ? frozenBy : ownLayer
    if (transformed.layer !== ownLayer) transformed.originalLayer = ownLayer
    if (transformed.geometryApproximation)
      diagnose(raw, 'approximated-geometry', transformed.geometryApproximation)
    entities.push(transformed)
    bbox.minX = Math.min(bbox.minX, bounds.minX)
    bbox.maxX = Math.max(bbox.maxX, bounds.maxX)
    bbox.minY = Math.min(bbox.minY, bounds.minY)
    bbox.maxY = Math.max(bbox.maxY, bounds.maxY)
  }
  let visitedRecords = 0
  let expansionStopped = false
  function extract(
    rawEntities: unknown[],
    transform: Matrix,
    ancestors: Set<string>,
    sourceBlock?: string,
    inheritedLayer?: string,
    zScale = 1,
    zOffset = 0,
    frozenBy?: string
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
      // Top-level entities owned by a paper-space layout are layout content, not model geometry (block definitions are
      // never filtered: their owner is the block record).
      const owner = (raw as RawEntity & { ownerBlockRecordSoftId?: unknown }).ownerBlockRecordSoftId
      if (sourceBlock === undefined && typeof owner === 'string' && paperSpaceRecords.has(owner)) {
        paperSpaceSkipped++
        continue
      }
      if (raw.type === 'ATTRIB' && typeof owner === 'string' && insertHandles.has(owner)) continue
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
        pendingElevation = 0
        pendingReflected = false
        if (!finitePoint(base)) {
          diagnose(raw, 'invalid-geometry', 'Block base point must be finite.', 'error')
          continue
        }
        if (!planar(raw, [raw.insertionPoint])) continue
        // Child Z becomes insertZ + sz * (childZ - baseZ), then the parent's affine Z map (same as the DXF parser).
        const insertZ = pendingElevation
        const nzSign = pendingReflected ? -1 : 1
        const baseZ = base.z ?? 0
        const sz = raw.zScale === undefined ? 1 : raw.zScale
        if (!finite(sz) || sz === 0) {
          diagnose(raw, 'invalid-geometry', 'Block Z scale must be finite and nonzero.', 'error')
          continue
        }
        const insertWorldZ = zScale * nzSign * insertZ + zOffset
        if (insertWorldZ !== 0 || baseZ !== 0)
          diagnose(raw, 'elevated-geometry-projected', `INSERT ${raw.name} at elevation ${insertWorldZ}${baseZ !== 0 ? ` (block base Z ${baseZ})` : ''}; its geometry is projected onto the plan and keeps its elevation.`)
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
        const composed = compose(transform, nzSign < 0 ? compose(ocsMirror, local) : local)
        if (!Object.values(composed).every(finite)) {
          diagnose(raw, 'invalid-geometry', 'Composed block transform is nonfinite.', 'error')
          continue
        }
        if (insertTransformHasShear(composed))
          diagnose(raw, 'sheared-insert', `INSERT ${raw.name} is sheared (non-uniform scale combined with a rotated nested insert); its geometry is transformed exactly but the block reference reports rotation and scale only.`)
        const childStart = entities.length
        // Freezing an INSERT's layer hides the whole reference: children on a visible layer move onto it (see frozenBy).
        const insertOwnLayer = raw.layer && raw.layer !== '0' ? raw.layer : (inheritedLayer ?? '0')
        const insertLayer = frozenBy && !hiddenLayers.has(insertOwnLayer) ? frozenBy : insertOwnLayer
        extract(
          block.entities,
          composed,
          new Set([...ancestors, raw.name!]),
          raw.name,
          insertLayer,
          zScale * nzSign * sz,
          zScale * nzSign * (insertZ - sz * baseZ) + zOffset,
          frozenLayers.has(insertLayer) ? insertLayer : frozenBy
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
          layer: insertLayer,
          ...placement,
          bounds: childBounds,
          entityRange: [childStart, entities.length],
          nestingDepth: ancestors.size
        })
        // Visible attributes are drawn like single-line TEXT in WCS (not through the INSERT's own transform), exactly
        // as the DXF path does. libredwg-web exposes an ATTRIB's text through `text` (the converted text base).
        for (const item of Array.isArray(raw.attribs) ? raw.attribs : []) {
          const attrib = item as RawEntity & {
            isVisible?: boolean
            flags?: number
            textDataFlags?: number
            text?: { text?: unknown; startPoint?: Point; endPoint?: Point; halign?: number; valign?: number; textHeight?: number; rotation?: number; extrusionDirection?: Point }
          }
          const base = attrib.text
          if (!base || typeof base.text !== 'string' || !base.text.trim()) continue
          if (attrib.isVisible === false || (finite(attrib.flags) && (attrib.flags & 1) !== 0)) continue
          emit(
            {
              type: 'TEXT',
              handle: attrib.handle,
              elevation: attrib.elevation,
              layer: attrib.layer,
              color: attrib.color,
              colorIndex: attrib.colorIndex,
              startPoint: base.startPoint,
              endPoint: base.endPoint,
              textDataFlags: attrib.textDataFlags,
              halign: base.halign,
              valign: base.valign,
              text: base.text,
              textHeight: base.textHeight,
              rotation: base.rotation,
              extrusionDirection: base.extrusionDirection
            },
            transform,
            sourceBlock,
            inheritedLayer,
            frozenBy,
            zScale,
            zOffset
          )
        }
        continue
      }
      emit(raw, transform, sourceBlock, inheritedLayer, frozenBy, zScale, zOffset)
    }
  }
  extract(Array.isArray(db.entities) ? db.entities : [], identity, new Set())

  if (paperSpaceSkipped)
    diagnostics.push({
      code: 'paper-space-skipped',
      severity: 'warning',
      message: `${paperSpaceSkipped} paper-space (layout) entit${paperSpaceSkipped === 1 ? 'y was' : 'ies were'} skipped; only model space is imported.`
    })
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
  const rawMeasurement = db.header?.MEASUREMENT ?? db.header?.vars?.MEASUREMENT
  const measurementValue = typeof rawMeasurement === 'string' ? Number(rawMeasurement) : rawMeasurement
  const measurement = measurementValue === 0 || measurementValue === 1 ? measurementValue : undefined
  const units = resolveCadUnits({ insUnits, measurement, entities, bbox: finalBbox })
  diagnostics.push(...units.diagnostics)
  return {
    entities,
    bbox: finalBbox,
    diagnostics,
    blockReferences,
    insUnits,
    measurement,
    unitsConfidence: units.unitsConfidence,
    ...units.suggestion,
    ...(hiddenLayers.size ? { hiddenLayers: [...hiddenLayers].sort() } : {})
  }
}
