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
