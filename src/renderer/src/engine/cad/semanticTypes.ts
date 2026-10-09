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
