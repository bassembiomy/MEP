import { isPointInPolygon, getPolygonCentroid } from './geometry';
import { sizeDuct } from './ductSizer';
import { selectBestDiffuserFromCatalog } from './diffuserPlacer';
import { STANDARD_DIFFUSER_CATALOG } from './hvacCatalogs';
import {
  ConnectionPort,
  MechanicalComponent,
  SpatialFootprint,
  DeploymentDiagnostic
} from './deploymentTypes';
import { Diffuser, DuctSegment } from '../store/projectStore';

/**
 * Validates that an entire rectangular component footprint is strictly inside a polygon
 */
export function validateFootprintInPolygon(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  points: number[]
): boolean {
  if (points.length < 6) return false;

  const hw = width / 2;
  const hh = height / 2;

  // Test 4 corners and center
  const corners = [
    { x: centerX, y: centerY },
    { x: centerX - hw, y: centerY - hh },
    { x: centerX + hw, y: centerY - hh },
    { x: centerX + hw, y: centerY + hh },
    { x: centerX - hw, y: centerY + hh }
  ];

  return corners.every((c) => isPointInPolygon(c.x, c.y, points));
}

/**
 * Calculates the bounding box of a polygon
 */
export function getPolygonBoundingBox(points: number[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const numPts = points.length / 2;
  for (let i = 0; i < numPts; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Scores and selects optimal outdoor unit (ODU) position on closest exterior envelope wall
 */
export function planOutdoorUnitPlacement(
  points: number[],
  allZones: any[],
  dxfBoundingBox: any,
  systemId: string,
  model: string,
  totalTons: number
): { component: MechanicalComponent; diagnostics: DeploymentDiagnostic[] } {
  const diagnostics: DeploymentDiagnostic[] = [];
  const centroid = getPolygonCentroid(points);

  let envMinX = Infinity, envMaxX = -Infinity, envMinY = Infinity, envMaxY = -Infinity;

  if (dxfBoundingBox) {
    envMinX = dxfBoundingBox.minX;
    envMaxX = dxfBoundingBox.maxX;
    envMinY = dxfBoundingBox.minY;
    envMaxY = dxfBoundingBox.maxY;
  } else if (allZones && allZones.length > 0) {
    allZones.forEach((z) => {
      const numPts = z.points.length / 2;
      for (let i = 0; i < numPts; i++) {
        const px = z.points[i * 2];
        const py = z.points[i * 2 + 1];
        if (px < envMinX) envMinX = px;
        if (px > envMaxX) envMaxX = px;
        if (py < envMinY) envMinY = py;
        if (py > envMaxY) envMaxY = py;
      }
    });
  } else {
    const bbox = getPolygonBoundingBox(points);
    envMinX = bbox.minX; envMaxX = bbox.maxX; envMinY = bbox.minY; envMaxY = bbox.maxY;
  }

  if (envMinX === Infinity) {
    envMinX = 0; envMaxX = 600; envMinY = 0; envMaxY = 400;
  }

  const distToLeft = Math.abs(centroid.x - envMinX);
  const distToRight = Math.abs(envMaxX - centroid.x);
  const distToTop = Math.abs(centroid.y - envMinY);
  const distToBottom = Math.abs(envMaxY - centroid.y);

  const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);
  const offset = 40; // 4 ft outside envelope
  const numPoints = points.length / 2;
  let posX = 0;
  let posY = 0;
  let dirX = 0;
  let dirY = 0;

  if (minDist === distToLeft) {
    let minX = Infinity;
    let targetY = centroid.y;
    for (let i = 0; i < numPoints; i++) {
      if (points[i * 2] < minX) {
        minX = points[i * 2];
        targetY = points[i * 2 + 1];
      }
    }
    posX = minX - offset;
    posY = targetY;
    dirX = 1; dirY = 0;
  } else if (minDist === distToRight) {
    let maxX = -Infinity;
    let targetY = centroid.y;
    for (let i = 0; i < numPoints; i++) {
      if (points[i * 2] > maxX) {
        maxX = points[i * 2];
        targetY = points[i * 2 + 1];
      }
    }
    posX = maxX + offset;
    posY = targetY;
    dirX = -1; dirY = 0;
  } else if (minDist === distToTop) {
    let minY = Infinity;
    let targetX = centroid.x;
    for (let i = 0; i < numPoints; i++) {
      if (points[i * 2 + 1] < minY) {
        minY = points[i * 2 + 1];
        targetX = points[i * 2];
      }
    }
    posX = targetX;
    posY = minY - offset;
    dirX = 0; dirY = 1;
  } else {
    let maxY = -Infinity;
    let targetX = centroid.x;
    for (let i = 0; i < numPoints; i++) {
      if (points[i * 2 + 1] > maxY) {
        maxY = points[i * 2 + 1];
        targetX = points[i * 2];
      }
    }
    posX = targetX;
    posY = maxY + offset;
    dirX = 0; dirY = -1;
  }

  const snappedX = Math.round(posX / 10) * 10;
  const snappedY = Math.round(posY / 10) * 10;

  const componentId = `comp-odu-${systemId}`;
  const ports: ConnectionPort[] = [
    {
      id: `port-${componentId}-ref-gas`,
      componentId,
      role: 'refrigerant-suction',
      position: { x: snappedX, y: snappedY },
      direction: { x: dirX, y: dirY },
      size: 0.625, // 5/8" suction line
      systemType: 'dx-refrigerant',
      isConnected: false
    },
    {
      id: `port-${componentId}-ref-liq`,
      componentId,
      role: 'refrigerant-liquid',
      position: { x: snappedX, y: snappedY },
      direction: { x: dirX, y: dirY },
      size: 0.375, // 3/8" liquid line
      systemType: 'dx-refrigerant',
      isConnected: false
    }
  ];

  const footprint: SpatialFootprint = {
    minX: snappedX - 16,
    maxX: snappedX + 16,
    minY: snappedY - 11,
    maxY: snappedY + 11,
    widthWorld: 32,
    heightWorld: 22
  };

  const component: MechanicalComponent = {
    id: componentId,
    systemId,
    floorId: 'floor-1',
    zoneId: '',
    role: 'outdoor-unit',
    model,
    systemType: 'outdoor-condenser',
    position: { x: snappedX, y: snappedY, z: 0 },
    rotationDeg: 0,
    elevationFt: 0,
    footprint,
    ports,
    isLocked: false,
    metadata: { totalTons }
  };

  return { component, diagnostics };
}

/**
 * Scores and places indoor unit (FCU / AHU) inside ceiling corridor zone
 */
export function planIndoorUnitPlacement(
  points: number[],
  optOduPos: { x: number; y: number },
  systemId: string,
  zoneId: string,
  systemType: string,
  model: string,
  supplyCfm: number
): { component: MechanicalComponent | null; diagnostics: DeploymentDiagnostic[] } {
  const diagnostics: DeploymentDiagnostic[] = [];

  if (points.length < 6) {
    diagnostics.push({
      code: 'ERR_NO_VALID_EQUIPMENT_LOCATION',
      severity: 'error',
      message: 'Zone polygon does not have sufficient vertices to place indoor equipment.'
    });
    return { component: null, diagnostics };
  }

  const centroid = getPolygonCentroid(points);
  const numPoints = points.length / 2;

  // Find interior vertex furthest from outdoor unit
  let maxDist = -1;
  let targetX = points[0];
  let targetY = points[1];

  for (let i = 0; i < numPoints; i++) {
    const px = points[i * 2];
    const py = points[i * 2 + 1];
    const dist = Math.pow(px - optOduPos.x, 2) + Math.pow(py - optOduPos.y, 2);
    if (dist > maxDist) {
      maxDist = dist;
      targetX = px;
      targetY = py;
    }
  }

  // Shift inside towards centroid
  const vx = centroid.x - targetX;
  const vy = centroid.y - targetY;
  const len = Math.sqrt(vx * vx + vy * vy) || 1;
  const offset = Math.min(30, len * 0.35);

  let optimalX = targetX + (vx / len) * offset;
  let optimalY = targetY + (vy / len) * offset;

  // Ensure placement footprint is fully contained inside zone
  const unitWidth = 44;
  const unitHeight = 22;

  if (!validateFootprintInPolygon(optimalX, optimalY, unitWidth, unitHeight, points)) {
    optimalX = (targetX + centroid.x * 2) / 3;
    optimalY = (targetY + centroid.y * 2) / 3;

    if (!validateFootprintInPolygon(optimalX, optimalY, unitWidth * 0.8, unitHeight * 0.8, points)) {
      optimalX = centroid.x;
      optimalY = centroid.y;
    }
  }

  const isContained = isPointInPolygon(optimalX, optimalY, points);
  if (!isContained) {
    diagnostics.push({
      code: 'ERR_COMPONENT_OUTSIDE_ZONE',
      severity: 'error',
      message: `Indoor unit (${model}) could not be placed fully inside zone boundaries.`,
      remediation: 'Expand room boundaries or adjust locked unit location.'
    });
    return { component: null, diagnostics };
  }

  const snappedX = Math.round(optimalX / 10) * 10;
  const snappedY = Math.round(optimalY / 10) * 10;
  const componentId = `comp-iu-${zoneId}`;

  // Outlet points towards centroid for direct trunk take-off
  const dirX = (centroid.x - snappedX) / (Math.hypot(centroid.x - snappedX, centroid.y - snappedY) || 1);
  const dirY = (centroid.y - snappedY) / (Math.hypot(centroid.x - snappedX, centroid.y - snappedY) || 1);

  const ports: ConnectionPort[] = [
    {
      id: `port-${componentId}-sup-out`,
      componentId,
      role: 'supply-air-outlet',
      position: { x: snappedX + dirX * 22, y: snappedY + dirY * 22 },
      direction: { x: dirX, y: dirY },
      size: { width: 16, height: 10 },
      systemType: 'air-supply',
      isConnected: false
    },
    {
      id: `port-${componentId}-ret-in`,
      componentId,
      role: 'return-air-inlet',
      position: { x: snappedX - dirX * 22, y: snappedY - dirY * 22 },
      direction: { x: -dirX, y: -dirY },
      size: { width: 18, height: 10 },
      systemType: 'air-return',
      isConnected: false
    },
    {
      id: `port-${componentId}-ref-in`,
      componentId,
      role: 'refrigerant-suction',
      position: { x: snappedX, y: snappedY },
      direction: { x: -dirX, y: -dirY },
      size: 0.625,
      systemType: 'dx-refrigerant',
      isConnected: false
    },
    {
      id: `port-${componentId}-drain`,
      componentId,
      role: 'condensate-drain-out',
      position: { x: snappedX, y: snappedY + 11 },
      direction: { x: 0, y: 1 },
      size: 0.75, // 3/4" PVC drain
      systemType: 'condensate-drain',
      isConnected: false
    }
  ];

  const footprint: SpatialFootprint = {
    minX: snappedX - 22,
    maxX: snappedX + 22,
    minY: snappedY - 11,
    maxY: snappedY + 11,
    widthWorld: unitWidth,
    heightWorld: unitHeight
  };

  const component: MechanicalComponent = {
    id: componentId,
    systemId,
    floorId: 'floor-1',
    zoneId,
    role: systemType === 'high-wall' ? 'wall-indoor-unit' : 'indoor-unit',
    model,
    systemType,
    position: { x: snappedX, y: snappedY, z: 9 },
    rotationDeg: Math.round(Math.atan2(dirY, dirX) * (180 / Math.PI)),
    elevationFt: 9,
    footprint,
    ports,
    isLocked: false,
    metadata: { supplyCfm }
  };

  return { component, diagnostics };
}

/**
 * Distributes cassette units symmetrically across usable room ceiling
 */
export function planCassetteDistribution(
  points: number[],
  quantity: number,
  totalCfm: number,
  systemId: string,
  zoneId: string,
  model: string,
  spaceNcLimit: number = 32
): { components: MechanicalComponent[]; diffusers: Diffuser[]; diagnostics: DeploymentDiagnostic[] } {
  const diagnostics: DeploymentDiagnostic[] = [];
  const bbox = getPolygonBoundingBox(points);
  const flowPerUnit = Math.round(totalCfm / Math.max(1, quantity));

  const components: MechanicalComponent[] = [];
  const diffusers: Diffuser[] = [];

  const ar = bbox.width / (bbox.height || 1);
  let rows = Math.round(Math.sqrt(quantity / ar));
  rows = Math.max(1, rows);
  let cols = Math.ceil(quantity / rows);
  cols = Math.max(1, cols);

  const colWidth = bbox.width / cols;
  const rowHeight = bbox.height / rows;

  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let gx = bbox.minX + (c + 0.5) * colWidth;
      let gy = bbox.minY + (r + 0.5) * rowHeight;

      if (!isPointInPolygon(gx, gy, points)) {
        const centroid = getPolygonCentroid(points);
        gx = (gx + centroid.x) / 2;
        gy = (gy + centroid.y) / 2;
      }

      const snapX = Math.round(gx / 10) * 10;
      const snapY = Math.round(gy / 10) * 10;
      const componentId = `comp-cassette-${zoneId}-${count}`;

      if (!isPointInPolygon(snapX, snapY, points)) {
        diagnostics.push({
          code: 'ERR_COMPONENT_OUTSIDE_ZONE',
          severity: 'error',
          message: `Cassette unit #${count + 1} is outside zone boundary.`,
          remediation: 'Adjust room dimensions or lower cassette quantity.'
        });
      }

      const ports: ConnectionPort[] = [
        {
          id: `port-${componentId}-ref-gas`,
          componentId,
          role: 'refrigerant-suction',
          position: { x: snapX, y: snapY },
          direction: { x: 0, y: -1 },
          size: 0.625,
          systemType: 'dx-refrigerant',
          isConnected: false
        },
        {
          id: `port-${componentId}-drain`,
          componentId,
          role: 'condensate-drain-out',
          position: { x: snapX, y: snapY + 15 },
          direction: { x: 0, y: 1 },
          size: 0.75,
          systemType: 'condensate-drain',
          isConnected: false
        }
      ];

      const comp: MechanicalComponent = {
        id: componentId,
        systemId,
        floorId: 'floor-1',
        zoneId,
        role: 'cassette-terminal',
        model,
        systemType: 'cassette',
        position: { x: snapX, y: snapY, z: 10 },
        rotationDeg: 0,
        elevationFt: 10,
        footprint: {
          minX: snapX - 15,
          maxX: snapX + 15,
          minY: snapY - 15,
          maxY: snapY + 15,
          widthWorld: 30,
          heightWorld: 30
        },
        ports,
        isLocked: false,
        metadata: { cfm: flowPerUnit, nc: spaceNcLimit }
      };

      components.push(comp);

      diffusers.push({
        id: `dif-${componentId}`,
        x: snapX,
        y: snapY,
        cfm: flowPerUnit,
        size: model,
        actualNc: spaceNcLimit,
        throwT50Ft: 14,
        deltaPInWg: 0.04
      });

      count++;
      if (components.length >= quantity) break;
    }
    if (components.length >= quantity) break;
  }

  return { components, diffusers, diagnostics };
}

/**
 * Plans diffusers and routes ducted supply & return networks with port-to-port connections
 */
export function planDuctedAirDistribution(
  points: number[],
  indoorUnitComp: MechanicalComponent,
  totalCfm: number,
  _systemId: string,
  zoneId: string,
  systemType: string,
  spaceNcLimit: number = 32,
  units: 'imperial' | 'metric' = 'imperial',
  _scale: number = 10,
  candidateDiffusers?: {
    quantity: number;
    cfmPerUnit?: number;
    flowPerDiffuser?: number;
    diffuserRecord: any;
    actualNc: number;
    throwT50Ft: number;
    deltaPInWg: number;
  }
): { diffusers: Diffuser[]; ducts: DuctSegment[]; diagnostics: DeploymentDiagnostic[] } {
  const diagnostics: DeploymentDiagnostic[] = [];
  const numDiffusers = candidateDiffusers?.quantity || Math.max(1, Math.ceil(totalCfm / 300));
  const flowPerDiffuser = candidateDiffusers?.cfmPerUnit || candidateDiffusers?.flowPerDiffuser || Math.round(totalCfm / numDiffusers);

  const diffuserSelection = candidateDiffusers
    ? {
        diffuser: candidateDiffusers.diffuserRecord,
        actualNc: candidateDiffusers.actualNc,
        throwT50Ft: candidateDiffusers.throwT50Ft,
        deltaPInWg: candidateDiffusers.deltaPInWg
      }
    : selectBestDiffuserFromCatalog(flowPerDiffuser, spaceNcLimit, STANDARD_DIFFUSER_CATALOG);

  const bbox = getPolygonBoundingBox(points);

  // Distribute diffusers on uniform grid
  const diffusers: Diffuser[] = [];
  const ar = bbox.width / (bbox.height || 1);
  let rows = Math.round(Math.sqrt(numDiffusers / ar));
  rows = Math.max(1, rows);
  let cols = Math.ceil(numDiffusers / rows);
  cols = Math.max(1, cols);

  const colWidth = bbox.width / cols;
  const rowHeight = bbox.height / rows;

  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let gx = bbox.minX + (c + 0.5) * colWidth;
      let gy = bbox.minY + (r + 0.5) * rowHeight;

      if (!isPointInPolygon(gx, gy, points)) {
        const centroid = getPolygonCentroid(points);
        gx = (gx + centroid.x) / 2;
        gy = (gy + centroid.y) / 2;
      }

      const snapX = Math.round(gx / 10) * 10;
      const snapY = Math.round(gy / 10) * 10;

      if (!isPointInPolygon(snapX, snapY, points)) {
        diagnostics.push({
          code: 'ERR_COMPONENT_OUTSIDE_ZONE',
          severity: 'error',
          message: `Diffuser #${count + 1} position (${snapX}, ${snapY}) is outside room boundaries.`
        });
      }

      diffusers.push({
        id: `dif-${zoneId}-${count}`,
        x: snapX,
        y: snapY,
        cfm: flowPerDiffuser,
        size: `${diffuserSelection.diffuser.faceSizeIn.width}"x${diffuserSelection.diffuser.faceSizeIn.height}"`,
        type: 'supply',
        actualNc: diffuserSelection.actualNc,
        throwT50Ft: diffuserSelection.throwT50Ft,
        deltaPInWg: diffuserSelection.deltaPInWg
      });

      count++;
      if (diffusers.length >= numDiffusers) break;
    }
    if (diffusers.length >= numDiffusers) break;
  }

  // Add Return Air Grille(s)
  const numReturns = Math.max(1, Math.ceil(totalCfm / 800));
  const returnCfmPerGrille = Math.round((totalCfm * 0.9) / numReturns);
  for (let rIdx = 0; rIdx < numReturns; rIdx++) {
    const rx = numReturns === 1
      ? Math.round(bbox.minX + bbox.width * 0.15)
      : Math.round(bbox.minX + bbox.width * (0.15 + (rIdx * 0.7) / (numReturns - 1)));
    const ry = Math.round(bbox.minY + bbox.height * 0.85);
    let snapRx = Math.round(rx / 10) * 10;
    let snapRy = Math.round(ry / 10) * 10;
    if (!isPointInPolygon(snapRx, snapRy, points)) {
      const centroid = getPolygonCentroid(points);
      snapRx = Math.round(((snapRx + centroid.x) / 2) / 10) * 10;
      snapRy = Math.round(((snapRy + centroid.y) / 2) / 10) * 10;
    }
    diffusers.push({
      id: `dif-ret-${zoneId}-${rIdx}`,
      x: snapRx,
      y: snapRy,
      cfm: returnCfmPerGrille,
      size: returnCfmPerGrille > 400 ? '24"x24"' : '18"x18"',
      type: 'return',
      actualNc: Math.max(18, diffuserSelection.actualNc - 4),
      throwT50Ft: 0,
      deltaPInWg: 0.025
    });
  }

  const supplyDiffusers = diffusers.filter((d) => d.type === 'supply' || !d.type);

  // Route ducts from unit outlet port to supply diffusers
  const unitPos = indoorUnitComp.position;
  let furthestDif = supplyDiffusers[0] || diffusers[0];
  let maxDist = -1;
  for (const dif of supplyDiffusers) {
    const dist = Math.pow(dif.x - unitPos.x, 2) + Math.pow(dif.y - unitPos.y, 2);
    if (dist > maxDist) {
      maxDist = dist;
      furthestDif = dif;
    }
  }

  const A = { x: unitPos.x, y: unitPos.y };
  const B = { x: furthestDif.x, y: furthestDif.y };
  const vx = B.x - A.x;
  const vy = B.y - A.y;
  const lenSq = vx * vx + vy * vy || 1;

  const projectedDiffusers = supplyDiffusers.map((dif) => {
    const ux = dif.x - A.x;
    const uy = dif.y - A.y;
    let t = (ux * vx + uy * vy) / lenSq;
    t = Math.max(0.05, Math.min(1.0, t));
    return {
      diffuser: dif,
      projX: Math.round(A.x + t * vx),
      projY: Math.round(A.y + t * vy),
      t
    };
  });

  projectedDiffusers.sort((a, b) => a.t - b.t);

  const ducts: DuctSegment[] = [];
  const fixedHeight = units === 'imperial' ? 10 : 8;
  let currentStart = { x: unitPos.x, y: unitPos.y };

  // Trunk segments
  for (let i = 0; i < projectedDiffusers.length; i++) {
    const segmentEnd = {
      x: projectedDiffusers[i].projX,
      y: projectedDiffusers[i].projY
    };

    let downstreamFlow = 0;
    for (let j = i; j < projectedDiffusers.length; j++) {
      downstreamFlow += projectedDiffusers[j].diffuser.cfm;
    }

    const size = sizeDuct(downstreamFlow, 0.10, fixedHeight);
    const velocityFpm = Math.round(downstreamFlow / Math.max(0.1, (size.widthIn * size.heightIn) / 144));
    const sizeLabel = `${size.widthIn}"x${size.heightIn}"`;

    ducts.push({
      id: `duct-trunk-${zoneId}-${i}`,
      type: 'trunk',
      points: [currentStart.x, currentStart.y, segmentEnd.x, segmentEnd.y],
      widthIn: size.widthIn,
      heightIn: size.heightIn,
      cfm: downstreamFlow,
      velocityFpm,
      sizeLabel
    });

    currentStart = segmentEnd;
  }

  // Branch segments
  projectedDiffusers.forEach((pd, idx) => {
    const dif = pd.diffuser;
    const branchStart = { x: pd.projX, y: pd.projY };
    const branchEnd = { x: dif.x, y: dif.y };

    const branchDist = Math.hypot(branchEnd.x - branchStart.x, branchEnd.y - branchStart.y);
    if (branchDist > 4) {
      const size = sizeDuct(dif.cfm, 0.10, fixedHeight);
      const velocityFpm = Math.round(dif.cfm / Math.max(0.1, (size.widthIn * size.heightIn) / 144));

      ducts.push({
        id: `duct-branch-${zoneId}-${idx}`,
        type: 'branch',
        points: [branchStart.x, branchStart.y, branchEnd.x, branchEnd.y],
        widthIn: size.widthIn,
        heightIn: size.heightIn,
        cfm: dif.cfm,
        velocityFpm,
        sizeLabel: `${size.widthIn}"x${size.heightIn}"`
      });
    }
  });

  // Return duct for Packaged RTU or AHU
  if (systemType === 'packaged' || systemType === 'ahu') {
    const totalFlow = diffusers.reduce((sum, d) => sum + d.cfm, 0);
    const returnSize = sizeDuct(totalFlow * 0.9, 0.08, fixedHeight);
    const centroid = getPolygonCentroid(points);
    const retEndX = Math.round(unitPos.x + (centroid.x - unitPos.x) * 0.35);
    const retEndY = Math.round(unitPos.y + (centroid.y - unitPos.y) * 0.35);

    ducts.push({
      id: `duct-return-${zoneId}`,
      type: 'return',
      points: [unitPos.x, unitPos.y + 15, retEndX, retEndY],
      widthIn: returnSize.widthIn,
      heightIn: returnSize.heightIn,
      cfm: Math.round(totalFlow * 0.9),
      velocityFpm: Math.round((totalFlow * 0.9) / Math.max(0.1, (returnSize.widthIn * returnSize.heightIn) / 144)),
      sizeLabel: `${returnSize.widthIn}"x${returnSize.heightIn}" (R)`
    });
  }

  return { diffusers, ducts, diagnostics };
}

/**
 * Routes clean orthogonal (Manhattan / 90° bends) solid copper refrigerant piping
 * from Outdoor Unit (ODU) on building exterior into the room and branches to each indoor unit / cassette.
 */
export function routeOrthogonalRefrigerantPiping(
  oduPos: { x: number; y: number },
  indoorTargets: { x: number; y: number }[]
): { segments: number[][]; isolatorPos: { x: number; y: number } } {
  if (!indoorTargets || indoorTargets.length === 0) {
    return { segments: [], isolatorPos: oduPos };
  }

  const segments: number[][] = [];

  // If single indoor target: 2-segment orthogonal L-route
  if (indoorTargets.length === 1) {
    const target = indoorTargets[0];
    // Route vertically first then horizontally into the room
    const midX = oduPos.x;
    const midY = target.y;

    if (Math.hypot(oduPos.x - midX, oduPos.y - midY) > 2) {
      segments.push([oduPos.x, oduPos.y, midX, midY]);
    }
    if (Math.hypot(midX - target.x, midY - target.y) > 2) {
      segments.push([midX, midY, target.x, target.y]);
    }

    const isolatorPos = { x: (oduPos.x + midX) / 2, y: (oduPos.y + midY) / 2 };
    return { segments, isolatorPos };
  }

  // Multiple indoor targets (e.g. multi-cassette or multi-split)
  const sorted = [...indoorTargets].sort((a, b) => {
    const da = Math.hypot(a.x - oduPos.x, a.y - oduPos.y);
    const db = Math.hypot(b.x - oduPos.x, b.y - oduPos.y);
    return da - db;
  });

  const firstTarget = sorted[0];
  const lastTarget = sorted[sorted.length - 1];

  const penX = oduPos.x;
  const penY = firstTarget.y;

  // Main route from ODU to room entry
  segments.push([oduPos.x, oduPos.y, penX, penY]);

  // Main distribution header connecting the target span
  const headerY = penY;
  segments.push([penX, headerY, lastTarget.x, headerY]);

  // Perpendicular branch runouts to each individual cassette / indoor unit
  sorted.forEach((t) => {
    if (Math.abs(t.y - headerY) > 4) {
      segments.push([t.x, headerY, t.x, t.y]);
    }
  });

  const isolatorPos = { x: (oduPos.x + penX) / 2, y: (oduPos.y + penY) / 2 };
  return { segments, isolatorPos };
}
