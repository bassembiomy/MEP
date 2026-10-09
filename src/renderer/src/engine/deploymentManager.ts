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
  planDuctedAirDistribution,
  getFootprintPortLayout,
  isRectContainedInPolygon,
  largestInscribedRect
} from './spatialPlanner';
import { partitionPolygonByArea } from './polygonClip';
import { calculatePolygonArea } from './geometry';
import { isPointInOrOnPolygon, isSegmentInPolygon } from './validation/spatialValidator';
import { solveDirectedNetworkStaticPressure } from './staticPressureCalc';
import { STANDARD_DIFFUSER_CATALOG, STANDARD_DUCT_TYPES } from './hvacCatalogs';
import { Zone, ProjectMetadata, Diffuser, DuctSegment } from '../store/projectStore';

import { calculateCanonicalZoneLoad } from './loadCalc';
import { METERS_PER_FOOT } from './engineeringInputs';
import { getZoneDeploymentRevision, getProjectDeploymentRevision, validateAppliedDeployment, getEquipmentFootprintWorld } from './deploymentValidation';
export { getZoneDeploymentRevision, getProjectDeploymentRevision } from './deploymentValidation';

/**
 * Largest share of a unit's equal-area service sub-polygon that may be left without terminals when the
 * inscribed-rectangle fallback is used for a concave piece. Above it the split is blocked
 * (ERR_ZONE_PARTITION_UNSUPPORTED); at or below it a WARN_ZONE_PARTITION_INSCRIBED states the unserved area.
 */
export const MAX_UNSERVED_SERVICE_FRACTION = 0.15;

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
  if (!candidate.isValid || candidate.diagnostics.some(d => d.severity === 'error')) {
    diagnostics.push({ code: 'ERR_DEPLOYMENT_INCOMPLETE', severity: 'error', message: 'Candidate is invalid or has blocking engineering diagnostics.' });
  }
  const systemId = `sys-${zone.id}-${candidate.equipment.id}`;
  const designRevision = `rev-${Date.now()}`;

  const isDucted = candidate.equipment.capabilities.supportsDuctNetwork;
  const isCassette = candidate.systemType === 'cassette';
  const isHighWall = candidate.systemType === 'high-wall';

  const zoneLoad = calculateCanonicalZoneLoad(zone, project);
  const zoneTotalCfm = zoneLoad.supplyCfm;
  const drawingUnitsPerFoot = project.scale * (project.units === 'metric' ? METERS_PER_FOOT : 1);
  // Legacy spatial placement assumes ten drawing units per foot. Run it in
  // that physical planning frame, then convert all proposed coordinates back.
  const planningRatio = 10 / drawingUnitsPerFoot;
  const planningPoints = zone.points.map(n => n * planningRatio);
  const dims = candidate.equipment.dimensionsIn;
  const physicalFootprint = dims ? { width: (dims.width / 12) * 10, depth: (dims.depth / 12) * 10 } : undefined;
  const requiresOutdoorUnit = !['fcu', 'ahu'].includes(candidate.systemType);
  if (isDucted) {
    diagnostics.push({ code: 'WARN_PREVIEW_PRESSURE_PROVISIONAL', severity: 'warning', message: 'Detailed preview pressure trace is provisional. Apply revalidates actual connected per-fan routes independently.' });
    if (zone.maxAvailableCeilingDepthIn === undefined) diagnostics.push({ code: 'WARN_CEILING_DEPTH_UNVERIFIED', severity: 'warning', message: 'Actual available ceiling depth is unverified; a preliminary 14-inch duct-height envelope is used until depth is declared.' });
  }

  // 1. Plan Outdoor Unit
  const oduPlan = planOutdoorUnitPlacement(
    planningPoints,
    allZones.map(z => ({ ...z, points: z.points.map(n => n * planningRatio) })),
    dxfBoundingBox ? { minX: dxfBoundingBox.minX * planningRatio, maxX: dxfBoundingBox.maxX * planningRatio, minY: dxfBoundingBox.minY * planningRatio, maxY: dxfBoundingBox.maxY * planningRatio } : null,
    systemId,
    candidate.equipment.model,
    candidate.equipment.nominalTons
  );
  if (requiresOutdoorUnit) diagnostics.push(...oduPlan.diagnostics);

  let indoorUnitComp: MechanicalComponent | undefined = undefined;
  let cassetteComps: MechanicalComponent[] = [];
  let deployedDiffusers: Diffuser[] = [];
  let deployedDucts: DuctSegment[] = [];
  let unitServicePolygons: number[][] | undefined;
  let unitServedPolygons: number[][] | undefined;

  // 2. Plan Indoor Equipment / Terminals
  if (isCassette) {
    const cassettePlan = planCassetteDistribution(
      planningPoints,
      candidate.quantity,
      zoneTotalCfm,
      systemId,
      zone.id,
      candidate.equipment.model,
      zone.maxSpaceNcLimit || 32,
      physicalFootprint
    );
    cassetteComps = cassettePlan.components;
    deployedDiffusers = cassettePlan.diffusers;
    diagnostics.push(...cassettePlan.diagnostics);
  } else if (isHighWall) {
    const iuPlan = planIndoorUnitPlacement(
      planningPoints,
      oduPlan.component.position,
      systemId,
      zone.id,
      'high-wall',
      candidate.equipment.model,
      zoneTotalCfm,
      physicalFootprint
    );
    if (iuPlan.component) {
      indoorUnitComp = iuPlan.component;
    }
    diagnostics.push(...iuPlan.diagnostics);
    if (candidate.quantity !== 1) diagnostics.push({ code: 'ERR_DEPLOYMENT_INCOMPLETE', severity: 'error', message: 'High-wall equipment quantity cannot be represented by this placement.' });
    deployedDiffusers = [];
    deployedDucts = [];
  } else {
    // Ducted Split, Packaged RTU, VRF ducted, AHU
    const qty = Math.max(1, candidate.quantity || 1);
    const cfmPerUnit = zoneTotalCfm / qty;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const numPoints = planningPoints.length / 2;
    for (let i = 0; i < numPoints; i++) {
      const x = planningPoints[2 * i];
      const y = planningPoints[2 * i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const isHorizontal = maxX - minX >= maxY - minY;

    // Each unit serves a real sub-polygon of the zone (equal-area cuts), not a bounding-box slice.
    let regions: number[][] = [planningPoints];
    if (qty > 1) {
      const partition = partitionPolygonByArea(planningPoints, qty, isHorizontal ? 'y' : 'x');
      if (partition.ok) regions = partition.parts;
      else {
        regions = [];
        diagnostics.push({
          code: 'ERR_ZONE_PARTITION_UNSUPPORTED',
          severity: 'error',
          message: `The zone outline cannot be divided into ${qty} connected equal-area service areas: ${partition.reason}`,
          remediation: 'Use fewer units, split the room into separate zones, or simplify the room outline.'
        });
      }
    }
    unitServicePolygons = regions.length ? regions : undefined;
    // Region each unit's terminals actually cover; narrowed to the inscribed rectangle by the fallback below.
    const servedRegions = regions.map(r => r.slice());
    unitServedPolygons = regions.length ? servedRegions : undefined;

    const planUnit = (k: number, region: number[]) => {
      const subSystemId = `${systemId}-${k + 1}`;
      const iuPlan = planIndoorUnitPlacement(
        region,
        oduPlan.component.position,
        subSystemId,
        `${zone.id}-${k + 1}`,
        candidate.systemType,
        candidate.equipment.model,
        cfmPerUnit,
        physicalFootprint
      );
      if (!iuPlan.component) return { iuPlan, ductPlan: undefined };

      const diffusersPerUnit = candidate.diffusers
        ? Math.max(1, Math.round(candidate.diffusers.quantity / qty))
        : Math.max(1, Math.ceil(cfmPerUnit / 335));

      const ductPlan = planDuctedAirDistribution(
        region,
        iuPlan.component,
        cfmPerUnit,
        subSystemId,
        `${zone.id}-${k + 1}`,
        candidate.systemType,
        zone.maxSpaceNcLimit || 32,
        'imperial',
        10,
        {
          quantity: diffusersPerUnit,
          flowPerDiffuser: cfmPerUnit / diffusersPerUnit,
          diffuserRecord: candidate.diffusers?.diffuserRecord,
          actualNc: candidate.diffusers?.actualNc || 25,
          throwT50Ft: candidate.diffusers?.throwT50Ft || 12,
          deltaPInWg: candidate.diffusers?.deltaPInWg || 0.04
        }
      );
      // The spatial planner's historical 90% return assumption is replaced by
      // the load calculation's actual mass-balance return demand.
      const returnPerUnit = zoneLoad.returnCfm / qty;
      ductPlan.diffusers = ductPlan.diffusers.map(t => t.type === 'return' ? { ...t, cfm: returnPerUnit } : t);
      ductPlan.ducts = ductPlan.ducts.map(d => d.type === 'return' ? { ...d, cfm: returnPerUnit, velocityFpm: returnPerUnit / (d.widthIn * d.heightIn / 144) } : d);
      return { iuPlan, ductPlan };
    };
    /** Everything the unit owns must lie inside its own service area. */
    const unitFitsRegion = (plan: ReturnType<typeof planUnit>, region: number[]): boolean => {
      const comp = plan.iuPlan.component;
      if (!comp || !plan.ductPlan) return false;
      const f = comp.footprint;
      return plan.iuPlan.diagnostics.every(d => d.severity !== 'error') &&
        plan.ductPlan.diagnostics.every(d => d.severity !== 'error') &&
        isRectContainedInPolygon(comp.position.x, comp.position.y, f.widthWorld, f.heightWorld, region) &&
        plan.ductPlan.diffusers.every(t => isPointInOrOnPolygon(t.x, t.y, region)) &&
        plan.ductPlan.ducts.every(d => {
          for (let i = 0; i < d.points.length - 2; i += 2)
            if (!isSegmentInPolygon({ x: d.points[i], y: d.points[i + 1] }, { x: d.points[i + 2], y: d.points[i + 3] }, region)) return false;
          return true;
        });
    };

    for (let k = 0; k < regions.length; k++) {
      let region = regions[k];
      let plan = planUnit(k, region);
      if (qty > 1 && !unitFitsRegion(plan, region)) {
        // The diffuser grid assumes a rectangular area. For a concave sub-polygon retry inside its largest
        // inscribed rectangle, which is contained by construction.
        const inscribed = largestInscribedRect(region);
        const retryRegion = inscribed ? [inscribed.minX, inscribed.minY, inscribed.maxX, inscribed.minY, inscribed.maxX, inscribed.maxY, inscribed.minX, inscribed.maxY] : undefined;
        const retry = retryRegion ? planUnit(k, retryRegion) : undefined;
        if (retry && retryRegion && unitFitsRegion(retry, retryRegion) && unitFitsRegion(retry, region)) {
          // Planning units are 10 per foot, so 100 square planning units are one square foot.
          const shareArea = calculatePolygonArea(region);
          const unservedArea = Math.max(0, shareArea - calculatePolygonArea(retryRegion));
          const unservedFraction = shareArea > 0 ? unservedArea / shareArea : 1;
          const unservedText = `${(unservedArea / 100).toFixed(1)} sq ft (${(unservedFraction * 100).toFixed(1)}% of the unit's ${(shareArea / 100).toFixed(1)} sq ft share)`;
          if (unservedFraction > MAX_UNSERVED_SERVICE_FRACTION) {
            diagnostics.push({
              code: 'ERR_ZONE_PARTITION_UNSUPPORTED',
              severity: 'error',
              message: `Unit ${k + 1} could serve only its largest inscribed rectangle, leaving ${unservedText} unserved, above the ${(MAX_UNSERVED_SERVICE_FRACTION * 100).toFixed(0)}% limit.`,
              remediation: 'Use fewer units, split the room into separate zones, or simplify the room outline.'
            });
            continue;
          }
          plan = retry;
          region = retryRegion;
          servedRegions[k] = retryRegion;
          diagnostics.push({
            code: 'WARN_ZONE_PARTITION_INSCRIBED',
            severity: 'warning',
            message: `Unit ${k + 1} serves only the largest rectangle inside its concave service area; ${unservedText} is not directly served.`
          });
        } else {
          diagnostics.push({
            code: 'ERR_ZONE_PARTITION_UNSUPPORTED',
            severity: 'error',
            message: `Unit ${k + 1} equipment, terminals and ducts cannot all be contained in its service area of the ${qty}-unit split.`,
            remediation: 'Use fewer units, split the room into separate zones, or simplify the room outline.'
          });
          continue;
        }
      }
      const { iuPlan, ductPlan } = plan;
      if (iuPlan.component && ductPlan) {
        if (!indoorUnitComp) indoorUnitComp = iuPlan.component;
        cassetteComps.push(iuPlan.component);
        deployedDiffusers.push(...ductPlan.diffusers);
        deployedDucts.push(...ductPlan.ducts);
        diagnostics.push(...ductPlan.diagnostics);
      }
      diagnostics.push(...iuPlan.diagnostics);
    }
    if (qty > 1 && regions.length > 0 && diagnostics.some(d => d.severity === 'error') && !diagnostics.some(d => d.code === 'ERR_ZONE_PARTITION_UNSUPPORTED')) {
      diagnostics.push({
        code: 'ERR_ZONE_PARTITION_UNSUPPORTED',
        severity: 'error',
        message: `A unit could not be placed inside its service area of the ${qty}-unit split.`,
        remediation: 'Use fewer units, split the room into separate zones, or simplify the room outline.'
      });
    }
  }

  // 3. Plan Piping Networks (Refrigerant & Condensate Drain)
  const refrigerantLines: { id: string; points: number[]; sizeLabel: string }[] = [];
  const condensateDrains: { id: string; points: number[]; slopePercent: number }[] = [];

  const targetUnits = cassetteComps.length > 0 ? cassetteComps : (indoorUnitComp ? [indoorUnitComp] : []);

  targetUnits.forEach((iu, idx) => {
    if (iu.position && oduPlan.component.position) {
      const oduPos = {
        x: oduPlan.component.position.x + (idx - (targetUnits.length - 1) / 2) * 40,
        y: oduPlan.component.position.y
      };

      if (requiresOutdoorUnit) refrigerantLines.push({
        id: `pipe-ref-${systemId}-${idx}`,
        points: [
          oduPos.x,
          oduPos.y,
          oduPos.x,
          iu.position.y,
          iu.position.x,
          iu.position.y
        ],
        sizeLabel: '3/8" Liquid & 5/8" Gas'
      });

      condensateDrains.push({
        id: `pipe-drain-${systemId}-${idx}`,
        points: [
          iu.position.x,
          iu.position.y,
          iu.position.x + 15,
          iu.position.y + 25
        ],
        slopePercent: 1.5
      });
    }
  });

  const fromPlanning = (p: { x: number; y: number; z?: number }) => ({ ...p, x: p.x / planningRatio, y: p.y / planningRatio });
  const mapIndoor = (u: MechanicalComponent): MechanicalComponent => {
    const position = fromPlanning(u.position);
    const physical = getEquipmentFootprintWorld(candidate.equipment, drawingUnitsPerFoot, u.rotationDeg);
    return { ...u, position, footprint: { ...physical, minX: position.x - physical.widthWorld / 2, maxX: position.x + physical.widthWorld / 2, minY: position.y - physical.heightWorld / 2, maxY: position.y + physical.heightWorld / 2 }, ports: u.ports.map(p => ({ ...p, position: fromPlanning(p.position) })) };
  };
  if (indoorUnitComp) indoorUnitComp = mapIndoor(indoorUnitComp);
  cassetteComps = cassetteComps.map(mapIndoor);
  oduPlan.component = { ...oduPlan.component, position: fromPlanning(oduPlan.component.position), footprint: { ...oduPlan.component.footprint, minX: oduPlan.component.footprint.minX / planningRatio, maxX: oduPlan.component.footprint.maxX / planningRatio, minY: oduPlan.component.footprint.minY / planningRatio, maxY: oduPlan.component.footprint.maxY / planningRatio, widthWorld: oduPlan.component.footprint.widthWorld / planningRatio, heightWorld: oduPlan.component.footprint.heightWorld / planningRatio }, ports: oduPlan.component.ports.map(p => ({ ...p, position: fromPlanning(p.position) })) };
  deployedDiffusers = deployedDiffusers.map(t => ({ ...t, x: t.x / planningRatio, y: t.y / planningRatio }));
  deployedDucts = deployedDucts.map(d => ({ ...d, points: d.points.map(n => n / planningRatio) }));
  refrigerantLines.forEach(line => { line.points = line.points.map(n => n / planningRatio); });
  condensateDrains.forEach(line => { line.points = line.points.map(n => n / planningRatio); });

  // Ports follow the real catalog footprint and the ducts that were actually routed: each air port sits where
  // the first segment leaving the unit centre crosses the footprint boundary, in the same direction.
  const attachPorts = (u: MechanicalComponent): MechanicalComponent => {
    const tol = 1e-6 * drawingUnitsPerFoot;
    const firstDir = (isReturn: boolean) => {
      const d = deployedDucts.find(s => (s.type === 'return') === isReturn && Math.hypot(s.points[0] - u.position.x, s.points[1] - u.position.y) < tol);
      return d ? { x: d.points[2] - d.points[0], y: d.points[3] - d.points[1] } : undefined;
    };
    const stored = (role: string) => u.ports.find(p => p.role === role)?.direction;
    const layout = getFootprintPortLayout(
      u.position, u.footprint.widthWorld, u.footprint.heightWorld, u.rotationDeg,
      firstDir(false) ?? stored('supply-air-outlet'), firstDir(true) ?? stored('return-air-inlet')
    );
    const place = (role: string): { position: { x: number; y: number }; direction: { x: number; y: number } } | undefined =>
      role === 'supply-air-outlet' ? layout.supply
        : role === 'return-air-inlet' ? layout.return
        : role === 'refrigerant-suction' ? layout.refrigerant
        : role === 'condensate-drain-out' ? layout.drain
        : undefined;
    return { ...u, ports: u.ports.map(p => { const l = place(p.role); return l ? { ...p, position: { ...p.position, ...l.position }, direction: l.direction } : p; }) };
  };
  if (indoorUnitComp) indoorUnitComp = attachPorts(indoorUnitComp);
  cassetteComps = cassetteComps.map(attachPorts);

  // 4. Provisional legacy pressure trace; acceptance uses actual connected paths.
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
      drawingUnitsPerFoot
    );
  }

  // 5. Build Component Collections
  const componentsToAdd: MechanicalComponent[] = requiresOutdoorUnit ? [oduPlan.component] : [];
  if (indoorUnitComp) componentsToAdd.push(indoorUnitComp);
  componentsToAdd.push(...cassetteComps.filter(c => c.id !== indoorUnitComp?.id));

  const hasBlockingError = diagnostics.some((d) => d.severity === 'error');

  const manifest: DeploymentManifest = {
    sourceZoneRevision: getZoneDeploymentRevision(zone),
    sourceProjectRevision: getProjectDeploymentRevision(project),
    engineeringEvidence: {
      equipmentRecord: structuredClone(candidate.equipment), quantity: candidate.quantity,
      requiredSupplyCfm: zoneTotalCfm, requiredReturnCfm: zoneLoad.returnCfm,
      requiredTotalBtuPerHour: zoneLoad.totalLoad,
      requiredSensibleBtuPerHour: zoneLoad.sensibleLoad,
      requiredLatentBtuPerHour: zoneLoad.latentLoad,
      drawingUnitsPerFoot, requiresOutdoorUnit
    },
    manifestId: `manifest-${systemId}-${Date.now()}`,
    candidateId: candidate.id,
    systemId,
    zoneId: zone.id,
    systemType: candidate.systemType,
    designRevision,
    createdAt: Date.now(),
    equipment: {
      indoorUnit: indoorUnitComp,
      outdoorUnit: requiresOutdoorUnit ? oduPlan.component : undefined,
      cassetteUnits: cassetteComps
    },
    terminals: deployedDiffusers,
    ducts: deployedDucts,
    piping: {
      refrigerantLines,
      condensateDrains
    },
    unitServicePolygons: unitServicePolygons?.map(p => p.map(n => n / planningRatio)),
    unitServedPolygons: unitServedPolygons?.map(p => p.map(n => n / planningRatio)),
    componentsToAdd,
    componentsToUpdate: [],
    componentsToRemove: [],
    componentsToRetain: [],
    criticalPath,
    diagnostics,
    isEligibleToApply: !hasBlockingError
  };
  if (manifest.isEligibleToApply) {
    const validation = executeDeploymentTransaction(manifest, [zone], project);
    if (!validation.success && validation.errorDiagnostic) {
      manifest.diagnostics.push(validation.errorDiagnostic);
      manifest.isEligibleToApply = false;
    }
  }
  return manifest;
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
  currentZones: Zone[],
  currentProject?: ProjectMetadata
): { updatedZones: Zone[]; success: boolean; errorDiagnostic?: DeploymentDiagnostic } {
  const reject = (message: string, code: DeploymentDiagnostic['code'] = 'ERR_APPLY_TRANSACTION_FAILED') => ({ updatedZones: currentZones, success: false, errorDiagnostic: { code, severity: 'error' as const, message } });
  if (!manifest.isEligibleToApply || manifest.diagnostics.some(d => d.severity === 'error')) return reject('Manifest is blocked by engineering diagnostics.', 'ERR_DEPLOYMENT_INCOMPLETE');
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
  if (manifest.sourceZoneRevision !== undefined && manifest.sourceZoneRevision !== getZoneDeploymentRevision(targetZone)) return reject('Zone engineering inputs changed after preview.', 'ERR_DEPLOYMENT_REVISION_STALE');
  if (manifest.sourceProjectRevision !== undefined && (!currentProject || manifest.sourceProjectRevision !== getProjectDeploymentRevision(currentProject))) return reject(currentProject ? 'Project engineering inputs changed after preview.' : 'Current project is required to validate this manifest.', 'ERR_DEPLOYMENT_REVISION_STALE');
  if (!manifest.engineeringEvidence) return reject('Manifest lacks required equipment, load and pressure validation evidence.', 'ERR_DEPLOYMENT_INCOMPLETE');
  const drawingUnitsPerFoot = manifest.engineeringEvidence.drawingUnitsPerFoot;
  if (manifest.sourceProjectRevision !== undefined && currentProject) {
    try {
      const currentLoad = calculateCanonicalZoneLoad(targetZone, currentProject);
      const evidence = manifest.engineeringEvidence;
      const expected = [currentLoad.supplyCfm, currentLoad.returnCfm, currentLoad.totalLoad, currentLoad.sensibleLoad, currentLoad.latentLoad, currentProject.scale * (currentProject.units === 'metric' ? METERS_PER_FOOT : 1)];
      const claimed = [evidence.requiredSupplyCfm, evidence.requiredReturnCfm, evidence.requiredTotalBtuPerHour, evidence.requiredSensibleBtuPerHour, evidence.requiredLatentBtuPerHour, evidence.drawingUnitsPerFoot];
      if (claimed.some((v, i) => !Number.isFinite(v) || Math.abs(v - expected[i]) > 1e-6)) return reject('Manifest load or drawing scale evidence does not match current engineering inputs.');
    } catch (error) {
      return reject(`Current load validation failed: ${(error as Error).message}`);
    }
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

  const allIndoorUnits = manifest.equipment.cassetteUnits && manifest.equipment.cassetteUnits.length > 0
    ? manifest.equipment.cassetteUnits
    : manifest.equipment.indoorUnit
    ? [manifest.equipment.indoorUnit]
    : [];

  let finalUnitPositions: { x: number; y: number }[] = allIndoorUnits.map((u) => ({
    x: u.position.x,
    y: u.position.y
  }));

  let finalOutdoorPositions: { x: number; y: number }[] = finalOutdoorPos
    ? (finalUnitPositions.length > 0
        ? finalUnitPositions.map((_, idx) => ({
            x: finalOutdoorPos!.x + (idx - (finalUnitPositions.length - 1) / 2) * drawingUnitsPerFoot * 4,
            y: finalOutdoorPos!.y
          }))
        : [finalOutdoorPos])
    : [];

  if (targetZone.isDiffusersLocked) {
    finalDiffusers = targetZone.diffusers;
  }
  if (targetZone.isDuctLocked) {
    finalDucts = targetZone.ducts;
  }
  if (targetZone.isEquipmentLocked) {
    if (targetZone.catalogModel !== manifest.engineeringEvidence.equipmentRecord.model || targetZone.catalogQty !== manifest.engineeringEvidence.quantity || targetZone.systemType !== manifest.systemType) return reject('Locked equipment model, quantity or topology is incompatible with the candidate.');
    finalUnitPos = targetZone.unitPos;
    finalOutdoorPos = targetZone.outdoorUnitPos;
    finalUnitPositions = targetZone.unitPositions?.length ? targetZone.unitPositions : targetZone.unitPos ? [targetZone.unitPos] : [];
    finalOutdoorPositions = targetZone.outdoorUnitPositions?.length ? targetZone.outdoorUnitPositions : targetZone.outdoorUnitPos ? [targetZone.outdoorUnitPos] : [];
  }

  // Assemble committed zone
  const updatedZone: Zone = {
    ...targetZone,
    systemType: manifest.systemType as any,
    diffusers: structuredClone(finalDiffusers),
    ducts: structuredClone(finalDucts),
    unitPos: finalUnitPos || (finalUnitPositions.length > 0 ? finalUnitPositions[0] : undefined),
    unitPositions: structuredClone(finalUnitPositions),
    outdoorUnitPos: finalOutdoorPos || (finalOutdoorPositions.length > 0 ? finalOutdoorPositions[0] : undefined),
    outdoorUnitPositions: structuredClone(finalOutdoorPositions),
    catalogQty: allIndoorUnits.length || 1,
    catalogModel: manifest.engineeringEvidence.equipmentRecord.model,
    catalogEsp: manifest.criticalPath.espRequiredInWg > 0
      ? `${manifest.criticalPath.espRequiredInWg.toFixed(2)} in.wg`
      : undefined
  };
  try {
    const pressure = validateAppliedDeployment(manifest, updatedZone, allIndoorUnits, currentProject);
    updatedZone.catalogEsp = pressure > 0 ? `${pressure.toFixed(2)} in.wg` : undefined;
  } catch (error) {
    return reject(`Applied engineering validation failed: ${(error as Error).message}`);
  }

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
