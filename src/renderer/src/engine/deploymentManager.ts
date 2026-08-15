import { SystemDesignCandidate, CriticalPathResult } from './types';
import {
  DeploymentManifest,
  DeploymentPreview,
  DeploymentDiagnostic,
  MechanicalComponent
} from './deploymentTypes';
import {
  planOutdoorUnitPlacement,
  planIndoorUnitPlacement,
  planCassetteDistribution,
  planDuctedAirDistribution
} from './spatialPlanner';
import { solveDirectedNetworkStaticPressure } from './staticPressureCalc';
import { STANDARD_DIFFUSER_CATALOG, STANDARD_DUCT_TYPES } from './hvacCatalogs';
import { Zone, ProjectMetadata, Diffuser, DuctSegment } from '../store/projectStore';

/**
 * Builds the complete deployment manifest for a candidate design without mutating workspace
 */
export function buildDeploymentManifest(
  candidate: SystemDesignCandidate,
  zone: Zone,
  allZones: Zone[],
  project: ProjectMetadata,
  _dxfEntities: any[] = [],
  dxfBoundingBox: any = null
): DeploymentManifest {
  const diagnostics: DeploymentDiagnostic[] = [];
  const systemId = `sys-${zone.id}-${candidate.equipment.id}`;
  const designRevision = `rev-${Date.now()}`;

  const isDucted = candidate.equipment.capabilities.supportsDuctNetwork;
  const isCassette = candidate.systemType === 'cassette';
  const isHighWall = candidate.systemType === 'high-wall';

  // 1. Plan Outdoor Unit
  const oduPlan = planOutdoorUnitPlacement(
    zone.points,
    allZones,
    dxfBoundingBox,
    systemId,
    candidate.equipment.model,
    candidate.equipment.nominalTons
  );
  diagnostics.push(...oduPlan.diagnostics);

  let indoorUnitComp: MechanicalComponent | undefined = undefined;
  let cassetteComps: MechanicalComponent[] = [];
  let deployedDiffusers: Diffuser[] = [];
  let deployedDucts: DuctSegment[] = [];

  // 2. Plan Indoor Equipment / Terminals
  if (isCassette) {
    const cassettePlan = planCassetteDistribution(
      zone.points,
      candidate.quantity,
      candidate.quantity * candidate.equipment.nominalCfm,
      systemId,
      zone.id,
      candidate.equipment.model,
      zone.maxSpaceNcLimit || 32
    );
    cassetteComps = cassettePlan.components;
    deployedDiffusers = cassettePlan.diffusers;
    diagnostics.push(...cassettePlan.diagnostics);
  } else if (isHighWall) {
    const iuPlan = planIndoorUnitPlacement(
      zone.points,
      oduPlan.component.position,
      systemId,
      zone.id,
      'high-wall',
      candidate.equipment.model,
      candidate.quantity * candidate.equipment.nominalCfm
    );
    if (iuPlan.component) {
      indoorUnitComp = iuPlan.component;
    }
    diagnostics.push(...iuPlan.diagnostics);
    deployedDiffusers = [];
    deployedDucts = [];
  } else {
    // Ducted Split, Packaged RTU, VRF ducted, AHU
    const iuPlan = planIndoorUnitPlacement(
      zone.points,
      oduPlan.component.position,
      systemId,
      zone.id,
      candidate.systemType,
      candidate.equipment.model,
      candidate.quantity * candidate.equipment.nominalCfm
    );
    if (iuPlan.component) {
      indoorUnitComp = iuPlan.component;
      const ductPlan = planDuctedAirDistribution(
        zone.points,
        indoorUnitComp,
        candidate.quantity * candidate.equipment.nominalCfm,
        systemId,
        zone.id,
        candidate.systemType,
        zone.maxSpaceNcLimit || 32,
        project.units,
        project.scale,
        candidate.diffusers
      );
      deployedDiffusers = ductPlan.diffusers;
      deployedDucts = ductPlan.ducts;
      diagnostics.push(...ductPlan.diagnostics);
    }
    diagnostics.push(...iuPlan.diagnostics);
  }

  // 3. Plan Piping Networks (Refrigerant & Condensate Drain)
  const refrigerantLines: { id: string; points: number[]; sizeLabel: string }[] = [];
  const condensateDrains: { id: string; points: number[]; slopePercent: number }[] = [];

  const targetIndoorPos = isCassette
    ? cassetteComps[0]?.position
    : indoorUnitComp?.position;

  if (targetIndoorPos && oduPlan.component.position) {
    refrigerantLines.push({
      id: `pipe-ref-${systemId}`,
      points: [
        oduPlan.component.position.x,
        oduPlan.component.position.y,
        targetIndoorPos.x,
        targetIndoorPos.y
      ],
      sizeLabel: '3/8" Liquid & 5/8" Gas'
    });

    condensateDrains.push({
      id: `pipe-drain-${systemId}`,
      points: [
        targetIndoorPos.x,
        targetIndoorPos.y,
        targetIndoorPos.x + 15,
        targetIndoorPos.y + 25
      ],
      slopePercent: 1.5
    });
  }

  // 4. Calculate Static Pressure on Deployed Network
  let criticalPath: CriticalPathResult = {
    pathId: 'none',
    terminalId: '',
    supplySegments: [],
    returnSegments: [],
    totalSupplyDeltaPInWg: 0,
    totalReturnDeltaPInWg: 0,
    diffuserDeltaPInWg: 0,
    accessoriesDeltaPInWg: 0,
    totalLossInWg: 0,
    marginInWg: 0,
    espRequiredInWg: 0
  };

  if (isDucted && deployedDucts.length > 0 && deployedDiffusers.length > 0) {
    criticalPath = solveDirectedNetworkStaticPressure(
      deployedDucts,
      deployedDiffusers,
      STANDARD_DIFFUSER_CATALOG,
      STANDARD_DUCT_TYPES[0],
      project.scale
    );
  }

  // 5. Build Component Collections
  const componentsToAdd: MechanicalComponent[] = [oduPlan.component];
  if (indoorUnitComp) componentsToAdd.push(indoorUnitComp);
  componentsToAdd.push(...cassetteComps);

  const hasBlockingError = diagnostics.some((d) => d.severity === 'error');

  return {
    manifestId: `manifest-${systemId}-${Date.now()}`,
    candidateId: candidate.id,
    systemId,
    zoneId: zone.id,
    systemType: candidate.systemType,
    designRevision,
    createdAt: Date.now(),
    equipment: {
      indoorUnit: indoorUnitComp,
      outdoorUnit: oduPlan.component,
      cassetteUnits: cassetteComps
    },
    terminals: deployedDiffusers,
    ducts: deployedDucts,
    piping: {
      refrigerantLines,
      condensateDrains
    },
    componentsToAdd,
    componentsToUpdate: [],
    componentsToRemove: [],
    componentsToRetain: [],
    criticalPath,
    diagnostics,
    isEligibleToApply: !hasBlockingError
  };
}

/**
 * Generates an immutable preview of a candidate design
 */
export function createDeploymentPreview(
  candidate: SystemDesignCandidate,
  zone: Zone,
  allZones: Zone[],
  project: ProjectMetadata,
  dxfEntities: any[] = [],
  dxfBoundingBox: any = null
): DeploymentPreview {
  const manifest = buildDeploymentManifest(
    candidate,
    zone,
    allZones,
    project,
    dxfEntities,
    dxfBoundingBox
  );

  const blockingErrors = manifest.diagnostics.filter((d) => d.severity === 'error');
  const warnings = manifest.diagnostics.filter((d) => d.severity === 'warning');

  const coverageRings = manifest.terminals.map((t) => ({
    x: t.x,
    y: t.y,
    radiusFt: (t.throwT50Ft || 12) * (project.scale / 10),
    cfm: t.cfm
  }));

  const status: 'valid' | 'warning' | 'invalid' =
    blockingErrors.length > 0 ? 'invalid' : warnings.length > 0 ? 'warning' : 'valid';

  return {
    previewId: `prev-${candidate.id}-${Date.now()}`,
    candidate,
    zoneId: zone.id,
    manifest,
    status,
    blockingErrors,
    warnings,
    coverageRings,
    isApplyDisabled: !manifest.isEligibleToApply
  };
}

/**
 * Atomically executes a deployment transaction against the workspace state
 */
export function executeDeploymentTransaction(
  manifest: DeploymentManifest,
  currentZones: Zone[]
): { updatedZones: Zone[]; success: boolean; errorDiagnostic?: DeploymentDiagnostic } {
  const targetZone = currentZones.find((z) => z.id === manifest.zoneId);

  if (!targetZone) {
    return {
      updatedZones: currentZones,
      success: false,
      errorDiagnostic: {
        code: 'ERR_APPLY_TRANSACTION_FAILED',
        severity: 'error',
        message: `Target zone ${manifest.zoneId} not found in workspace.`
      }
    };
  }

  // Preserve user-locked components
  let finalDiffusers = manifest.terminals;
  let finalDucts = manifest.ducts;
  let finalUnitPos = manifest.equipment.indoorUnit
    ? { x: manifest.equipment.indoorUnit.position.x, y: manifest.equipment.indoorUnit.position.y }
    : undefined;
  let finalOutdoorPos = manifest.equipment.outdoorUnit
    ? { x: manifest.equipment.outdoorUnit.position.x, y: manifest.equipment.outdoorUnit.position.y }
    : undefined;

  if (targetZone.isDiffusersLocked) {
    finalDiffusers = targetZone.diffusers;
  }
  if (targetZone.isDuctLocked) {
    finalDucts = targetZone.ducts;
  }
  if (targetZone.isEquipmentLocked) {
    finalUnitPos = targetZone.unitPos;
    finalOutdoorPos = targetZone.outdoorUnitPos;
  }

  // Assemble committed zone
  const updatedZone: Zone = {
    ...targetZone,
    systemType: manifest.systemType as any,
    diffusers: finalDiffusers,
    ducts: finalDucts,
    unitPos: finalUnitPos,
    outdoorUnitPos: finalOutdoorPos,
    catalogQty: manifest.equipment.cassetteUnits?.length || 1,
    catalogModel: manifest.equipment.indoorUnit?.model || manifest.equipment.outdoorUnit?.model || '',
    catalogEsp: manifest.criticalPath.espRequiredInWg > 0
      ? `${manifest.criticalPath.espRequiredInWg.toFixed(2)} in.wg`
      : undefined
  };

  // Post-Commit Verification
  const postCommitCount = updatedZone.diffusers.length + updatedZone.ducts.length + (updatedZone.unitPos ? 1 : 0) + (updatedZone.outdoorUnitPos ? 1 : 0);
  if (postCommitCount === 0 && (manifest.terminals.length > 0 || manifest.ducts.length > 0)) {
    return {
      updatedZones: currentZones,
      success: false,
      errorDiagnostic: {
        code: 'ERR_POST_COMMIT_MISMATCH',
        severity: 'error',
        message: 'Committed component count does not match deployment manifest.'
      }
    };
  }

  const updatedZones = currentZones.map((z) => (z.id === manifest.zoneId ? updatedZone : z));

  return {
    updatedZones,
    success: true
  };
}
