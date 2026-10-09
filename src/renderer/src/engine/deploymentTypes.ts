import { SystemDesignCandidate, CriticalPathResult, EquipmentCatalogItem } from './types';
import type { CadSemanticSnapshot } from './cad/cadSemanticState';
import { Diffuser, DuctSegment, Zone, ProjectMetadata } from '../store/projectStore';

export type ComponentRole =
  | 'indoor-unit'
  | 'outdoor-unit'
  | 'supply-diffuser'
  | 'return-grille'
  | 'cassette-terminal'
  | 'wall-indoor-unit'
  | 'supply-trunk'
  | 'supply-branch'
  | 'return-duct'
  | 'refrigerant-line'
  | 'condensate-drain'
  | 'power-control-line';

export type PortRole =
  | 'supply-air-outlet'
  | 'supply-air-inlet'
  | 'return-air-inlet'
  | 'return-air-outlet'
  | 'refrigerant-suction'
  | 'refrigerant-liquid'
  | 'condensate-drain-out'
  | 'power-control';

export interface ConnectionPort {
  id: string;
  componentId: string;
  role: PortRole;
  position: { x: number; y: number; z?: number };
  direction: { x: number; y: number }; // Unit direction vector of port airflow / pipe exit
  size: { width: number; height: number } | number; // Dimensions in inches or diameter
  systemType: string;
  isConnected: boolean;
  connectedToPortId?: string;
}

export interface SpatialFootprint {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  widthWorld: number;
  heightWorld: number;
  polygonPoints?: number[]; // [x1, y1, x2, y2, ...]
}

export interface MechanicalComponent {
  id: string;
  systemId: string;
  floorId: string;
  zoneId: string;
  role: ComponentRole;
  model: string;
  manufacturer?: string;
  systemType: string;
  position: { x: number; y: number; z?: number };
  rotationDeg: number;
  elevationFt: number;
  footprint: SpatialFootprint;
  ports: ConnectionPort[];
  isLocked: boolean;
  metadata?: Record<string, any>;
}

export interface DeploymentManifest {
  sourceZoneRevision?: string;
  sourceProjectRevision?: string;
  /** Canonical engineering evidence; legacy manifests without this are blocked. */
  engineeringEvidence?: {
    equipmentRecord: EquipmentCatalogItem;
    quantity: number;
    requiredSupplyCfm: number;
    requiredReturnCfm: number;
    requiredTotalBtuPerHour: number;
    requiredSensibleBtuPerHour: number;
    requiredLatentBtuPerHour: number;
    drawingUnitsPerFoot: number;
    requiresOutdoorUnit: boolean;
  };
  manifestId: string;
  candidateId: string;
  systemId: string;
  zoneId: string;
  systemType: string;
  designRevision: string;
  createdAt: number;
  equipment: {
    indoorUnit?: MechanicalComponent;
    outdoorUnit?: MechanicalComponent;
    cassetteUnits?: MechanicalComponent[];
  };
  terminals: Diffuser[];
  ducts: DuctSegment[];
  piping: {
    refrigerantLines: { id: string; points: number[]; sizeLabel: string }[];
    condensateDrains: { id: string; points: number[]; slopePercent: number }[];
  };
  /** Per-unit service sub-polygons (drawing units) when several ducted units split a zone. */
  unitServicePolygons?: number[][];
  /** Region each unit's terminals actually cover (drawing units): the service sub-polygon, or its inscribed rectangle after the concave fallback. */
  unitServedPolygons?: number[][];
  componentsToAdd: MechanicalComponent[];
  componentsToUpdate: MechanicalComponent[];
  componentsToRemove: string[];
  componentsToRetain: string[];
  criticalPath: CriticalPathResult;
  diagnostics: DeploymentDiagnostic[];
  isEligibleToApply: boolean;
}

export interface DeploymentDiagnostic {
  code:
    | 'ERR_NO_VALID_EQUIPMENT_LOCATION'
    | 'ERR_COMPONENT_OUTSIDE_ZONE'
    | 'ERR_COMPONENT_COLLISION'
    | 'ERR_NO_VALID_DUCT_ROUTE'
    | 'ERR_PORT_INCOMPATIBLE'
    | 'ERR_TERMINAL_UNCONNECTED'
    | 'ERR_SUPPLY_RETURN_MIXED'
    | 'ERR_AIRFLOW_IMBALANCE'
    | 'ERR_DEPLOYMENT_INCOMPLETE'
    | 'ERR_DEPLOYMENT_REVISION_STALE'
    | 'ERR_APPLY_TRANSACTION_FAILED'
    | 'ERR_POST_COMMIT_MISMATCH'
    | 'ERR_ZONE_PARTITION_UNSUPPORTED'
    | 'ERR_OBSTACLE_CONFLICT'
    | 'WARN_OBSTACLE_DETOUR'
    | 'WARN_ZONE_PARTITION_INSCRIBED'
    | 'WARN_CASSETTE_PLACEHOLDER_ACOUSTICS'
    | 'WARN_THROW_OVERLAP'
    | 'WARN_PREVIEW_PRESSURE_PROVISIONAL'
    | 'WARN_CEILING_DEPTH_UNVERIFIED'
    | 'WARN_MAINTENANCE_CLEARANCE';
  severity: 'error' | 'warning' | 'info';
  componentId?: string;
  message: string;
  remediation?: string;
  details?: Record<string, any>;
}

export interface DeploymentPreview {
  previewId: string;
  candidate: SystemDesignCandidate;
  zoneId: string;
  manifest: DeploymentManifest;
  status: 'valid' | 'warning' | 'invalid' | 'locked';
  blockingErrors: DeploymentDiagnostic[];
  warnings: DeploymentDiagnostic[];
  coverageRings: { x: number; y: number; radiusFt: number; cfm: number }[];
  isApplyDisabled: boolean;
}

export interface WorkspaceSnapshot {
  snapshotId: string;
  timestamp: number;
  zones: Zone[];
  selectedZoneId: string | null;
  project: ProjectMetadata;
  description: string;
  /** Present only when the action also changed CAD review decisions; undo/redo then restores them too. */
  cad?: CadSemanticSnapshot;
}

export interface TransactionResult {
  success: boolean;
  transactionId: string;
  manifestId: string;
  affectedZoneId: string;
  errorDiagnostic?: DeploymentDiagnostic;
  createdComponentCount: number;
  updatedComponentCount: number;
  removedComponentCount: number;
}
