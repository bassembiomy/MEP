import { sizeDuct } from './ductSizer';
import { DiffuserPos } from './diffuserPlacer';
import { getPolygonCentroid, calculateOptimalIndoorUnitPos } from './geometry';
import { DuctSegment } from '../store/projectStore';

export function routeDucts(
  points: number[],
  diffusers: DiffuserPos[],
  units: 'imperial' | 'metric',
  zoneId: string,
  customUnitPos?: { x: number; y: number },
  systemType: string = 'concealed',
  outdoorUnitPos?: { x: number; y: number }
): { ducts: DuctSegment[]; unitPos: { x: number; y: number } } {
  // Non-ducted systems (High Wall, standard Cassette) do not use supply duct networks
  if (systemType === 'high-wall' || systemType === 'cassette') {
    return { ducts: [], unitPos: customUnitPos || { x: 0, y: 0 } };
  }

  if (points.length < 6 || diffusers.length === 0) {
    return { ducts: [], unitPos: { x: 0, y: 0 } };
  }

  // 1. Determine Indoor Unit Position (FCU / RTU Entry)
  let unitPos = customUnitPos;
  if (!unitPos || (unitPos.x === 0 && unitPos.y === 0)) {
    unitPos = calculateOptimalIndoorUnitPos(points, outdoorUnitPos);
  }

  const centroid = getPolygonCentroid(points);

  // 2. Find the furthest diffuser from the Indoor Unit to orient the main trunk
  let maxDist = -1;
  let furthestDif = diffusers[0];
  for (const dif of diffusers) {
    const dist = Math.pow(dif.x - unitPos.x, 2) + Math.pow(dif.y - unitPos.y, 2);
    if (dist > maxDist) {
      maxDist = dist;
      furthestDif = dif;
    }
  }

  // Define trunk line vector from unitPos (A) towards furthest diffuser or zone axis (B)
  const A = { x: unitPos.x, y: unitPos.y };
  const B = { x: furthestDif.x, y: furthestDif.y };

  const vx = B.x - A.x;
  const vy = B.y - A.y;
  const lenSq = vx * vx + vy * vy || 1;

  // 3. Project each diffuser orthogonally onto the trunk line AB
  const projectedDiffusers = diffusers.map((dif) => {
    const ux = dif.x - A.x;
    const uy = dif.y - A.y;
    let t = (ux * vx + uy * vy) / lenSq;
    t = Math.max(0.05, Math.min(1.0, t));
    return {
      diffuser: dif,
      projX: Math.round(A.x + t * vx),
      projY: Math.round(A.y + t * vy),
      t: t
    };
  });

  // Sort projections along the trunk from unit outwards
  projectedDiffusers.sort((a, b) => a.t - b.t);

  const ducts: DuctSegment[] = [];
  const fixedHeight = units === 'imperial' ? 10 : 8;

  // 4. Build Trunk Segments
  let currentStart = { x: unitPos.x, y: unitPos.y };

  for (let i = 0; i < projectedDiffusers.length; i++) {
    const segmentEnd = {
      x: projectedDiffusers[i].projX,
      y: projectedDiffusers[i].projY
    };

    // Flow rate in this trunk segment is the sum of flows of all downstream diffusers
    let downstreamFlow = 0;
    for (let j = i; j < projectedDiffusers.length; j++) {
      downstreamFlow += projectedDiffusers[j].diffuser.cfm;
    }

    const size = sizeDuct(downstreamFlow, 0.10, fixedHeight);
    let sizeLabel = '';
    let widthVal = size.widthIn;
    let heightVal = size.heightIn;

    if (units === 'imperial') {
      sizeLabel = `${widthVal}"x${heightVal}"`;
    } else {
      const wMm = Math.round((widthVal * 25.4) / 25) * 25;
      const hMm = Math.round((heightVal * 25.4) / 25) * 25;
      sizeLabel = `${wMm}x${hMm}`;
      widthVal = wMm / 25.4;
      heightVal = hMm / 25.4;
    }

    const velocityFpm = Math.round(downstreamFlow / Math.max(0.1, (widthVal * heightVal) / 144));

    ducts.push({
      id: `duct-trunk-${zoneId}-${i}`,
      type: 'trunk',
      points: [currentStart.x, currentStart.y, segmentEnd.x, segmentEnd.y],
      widthIn: widthVal,
      heightIn: heightVal,
      cfm: downstreamFlow,
      velocityFpm,
      sizeLabel: sizeLabel
    });

    currentStart = segmentEnd;
  }

  // 5. Build Orthogonal Branch Segments to Diffusers
  projectedDiffusers.forEach((pd, idx) => {
    const dif = pd.diffuser;
    const branchStart = { x: pd.projX, y: pd.projY };
    const branchEnd = { x: dif.x, y: dif.y };

    // If diffuser is directly on the trunk, avoid creating a 0-length line
    const branchDist = Math.hypot(branchEnd.x - branchStart.x, branchEnd.y - branchStart.y);
    if (branchDist > 4) {
      const size = sizeDuct(dif.cfm, 0.10, fixedHeight);
      let sizeLabel = '';
      let widthVal = size.widthIn;
      let heightVal = size.heightIn;

      if (units === 'imperial') {
        sizeLabel = `${widthVal}"x${heightVal}"`;
      } else {
        const wMm = Math.round((widthVal * 25.4) / 25) * 25;
        const hMm = Math.round((heightVal * 25.4) / 25) * 25;
        sizeLabel = `${wMm}x${hMm}`;
        widthVal = wMm / 25.4;
        heightVal = hMm / 25.4;
      }

      const velocityFpm = Math.round(dif.cfm / Math.max(0.1, (widthVal * heightVal) / 144));

      ducts.push({
        id: `duct-branch-${zoneId}-${idx}`,
        type: 'branch',
        points: [branchStart.x, branchStart.y, branchEnd.x, branchEnd.y],
        widthIn: widthVal,
        heightIn: heightVal,
        cfm: dif.cfm,
        velocityFpm,
        sizeLabel: sizeLabel
      });
    }
  });

  // 6. For Packaged RTU or AHU, add dedicated Return Air duct
  if (systemType === 'packaged' || systemType === 'ahu') {
    const totalFlow = diffusers.reduce((sum, d) => sum + d.cfm, 0);
    const returnSize = sizeDuct(totalFlow * 0.9, 0.08, fixedHeight);
    const retLabel = units === 'imperial'
      ? `${returnSize.widthIn}"x${returnSize.heightIn}" (R)`
      : `${Math.round(returnSize.widthIn * 25.4)}x${Math.round(returnSize.heightIn * 25.4)} (R)`;

    // Place return intake near the FCU/unit entry point inside the room
    const retEndX = Math.round(unitPos.x + (centroid.x - unitPos.x) * 0.35);
    const retEndY = Math.round(unitPos.y + (centroid.y - unitPos.y) * 0.35);

    ducts.push({
      id: `duct-return-${zoneId}`,
      type: 'return',
      points: [unitPos.x, unitPos.y + 15, retEndX, retEndY],
      widthIn: returnSize.widthIn,
      heightIn: returnSize.heightIn,
      cfm: Math.round(totalFlow * 0.9),
      sizeLabel: retLabel
    });
  }

  return { ducts, unitPos };
}
