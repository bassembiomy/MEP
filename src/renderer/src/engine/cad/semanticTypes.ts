/** Geometry evidence is a suggestion; room use and engineering roles require human approval. */
export interface CadRoomCandidate {
  id: string
  name: string
  /** Source drawing/canvas coordinates, with the imported Y reflection already applied. */
  polygon: number[]
  areaSqFt: number
  sourceHandles: string[]
  sourceLayers: string[]
  /** Confidence in boundary geometry only, never in room use or code compliance. */
  confidence: number
  status: 'review-required'
  evidence: string[]
  unresolvedConditions: string[]
}

export interface CadSemanticDiagnostic {
  code: string
  severity: 'warning' | 'error'
  message: string
}

export interface CadRoomRecognitionOptions {
  drawingUnitsPerFoot: number
  /** Explicitly selected wall/boundary layers. Omit to inspect closed native polylines only. */
  layers?: string[]
  endpointToleranceFt?: number
  minAreaSqFt?: number
  maxSegments?: number
  /** Elevation (drawing units) of the level to recognise; default 0. Entities at other elevations are ignored. */
  level?: number
  /**
   * Openings the user approved. Only an approved opening whose ends both sit on wall endpoints
   * (within 0.75 ft) closes that gap; suggested openings never do.
   */
  approvedOpenings?: CadApprovedOpening[]
}

export interface CadRoomRecognitionResult {
  candidates: CadRoomCandidate[]
  diagnostics: CadSemanticDiagnostic[]
}

/** Semantic role of a CAD layer. Always a suggestion until the user confirms or overrides it. */
export type CadLayerRole =
  | 'wall'
  | 'door'
  | 'window'
  | 'column'
  | 'furniture'
  | 'annotation'
  | 'dimension'
  | 'hatch'
  | 'grid'
  | 'ceiling'
  | 'existing-hvac'
  | 'unknown'

export interface CadLayerClassification {
  layer: string
  role: CadLayerRole
  /** 0-1. Name match with agreeing geometry >= 0.8; geometry alone <= 0.5; user override is 1. */
  confidence: number
  evidence: string[]
  /** Human-readable descriptions of evidence that disagrees (a non-empty list with role 'unknown' means unresolved). */
  conflicts: string[]
  source: 'suggested' | 'user'
  /** Present when a user override replaced a machine suggestion. */
  overriddenSuggestion?: { role: CadLayerRole; confidence: number }
}

/** Persistable user decisions: layer name -> role. Plain JSON. */
export type CadLayerOverrides = Record<string, CadLayerRole>

/** A block INSERT kept as a semantic object. All coordinates are canvas coordinates (Y already reflected). */
export interface CadBlockReference {
  handle: string
  name: string
  layer: string
  /** The block base point after all (nested) transforms. */
  insertion: { x: number; y: number }
  /**
   * Placement decomposed from the composed transform. Convention: scaleX > 0 and scaleY carries the
   * sign, so a mirrored insert reports a negative scaleY (and `mirrored: true`) with the matching rotation.
   */
  rotationDeg: number
  scaleX: number
  scaleY: number
  mirrored: boolean
  /** Union of the exploded children's bounds (nested children included). */
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  /** Half-open index range [start, end) of the exploded child entities in the parsed `entities` array. */
  entityRange: [number, number]
  nestingDepth: number
}

export type CadOpeningKind = 'door' | 'window' | 'opening'

export interface CadOpeningCandidate {
  id: string
  kind: CadOpeningKind
  origin: 'block' | 'arc-in-gap' | 'wall-gap' | 'parallel-lines'
  /** Midpoint of the opening span, canvas coordinates. */
  center: { x: number; y: number }
  /** The line the opening occupies in the wall (hinge to latch for doors), canvas coordinates. */
  span: { a: { x: number; y: number }; b: { x: number; y: number } }
  widthFt: number
  hostWall?: { handle: string; layer: string; a: { x: number; y: number }; b: { x: number; y: number } }
  adjacentRoomIds: string[]
  sourceHandles: string[]
  blockName?: string
  confidence: number
  evidence: string[]
  status: 'review-required'
}

/** An opening the user has explicitly approved. Only these may close a wall gap in room recognition. */
export interface CadApprovedOpening {
  id: string
  a: { x: number; y: number }
  b: { x: number; y: number }
}

export interface CadObstacleCandidate {
  id: string
  shape: 'polygon' | 'circle'
  /** Outline in canvas coordinates (circles are also sampled to a 16-gon for convenience). */
  polygon: number[]
  circle?: { x: number; y: number; radius: number }
  widthFt: number
  depthFt: number
  layer: string
  roomId?: string
  sourceHandles: string[]
  confidence: number
  evidence: string[]
  status: 'review-required'
}

/** An obstacle the user approved, with the clearance (ft) to keep around it. Drawing-unit geometry. */
export interface CadApprovedObstacle {
  id: string
  status: 'approved'
  clearanceFt: number
  polygon?: number[]
  circle?: { x: number; y: number; radius: number }
}

export interface CadLevelAnnotation {
  handle: string
  /** The original text exactly as in the drawing (Arabic and other scripts retained). */
  text: string
  kind: 'ceiling-height' | 'ffl' | 'fcl' | 'soffit'
  /** Value in feet (levels are signed). Absent for a bare marker such as "FCL". */
  valueFt?: number
  interpretation?: string
}

export interface CadCeilingHeightSuggestion {
  valueFt: number
  evidence: string[]
  confidence: number
}

export interface CadLevelAnnotationResult {
  ceilingHeightSuggestion?: CadCeilingHeightSuggestion
  /** True when annotations exist but could not be turned into one trustworthy value. */
  unresolved: boolean
  unresolvedReasons: string[]
  annotations: CadLevelAnnotation[]
}
