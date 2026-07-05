import { sizeDuct } from './ductSizer';
import { DiffuserPos } from './diffuserPlacer';
import { getPolygonCentroid } from './geometry';
import { DuctSegment } from '../store/projectStore';

export function routeDucts(
  points: number[],
  diffusers: DiffuserPos[],
  units: 'imperial' | 'metric',
  zoneId: string
): { ducts: DuctSegment[]; unitPos: { x: number; y: number } } {
  if (points.length < 6 || diffusers.length === 0) {
    return { ducts: [], unitPos: { x: 0, y: 0 } };
  }

  // 1. Calculate centroid of the zone
  const centroid = getPolygonCentroid(points);

  // 2. Find bounding box to identify the "left-most" entrance vertex
  let minX = Infinity;
  let entryIdx = 0;
  const numPoints = points.length / 2;
  for (let i = 0; i < numPoints; i++) {
    const px = points[i * 2];
    if (px < minX) {
      minX = px;
      entryIdx = i;
    }
  }

  const entryPoint = {
    x: points[entryIdx * 2],
    y: points[entryIdx * 2 + 1]
  };

  // Place the Indoor Unit just outside the entrance (corridor side)
  // Shift by 35 pixels to the left of the entry vertex
  const unitPos = {
    x: entryPoint.x - 35,
    y: entryPoint.y
  };

  // 3. Define the main trunk backbone direction: from Indoor Unit, through entrance, towards furthest diffuser
  const A = { x: entryPoint.x, y: entryPoint.y };
  let B = { x: centroid.x, y: centroid.y };
  
  if (diffusers.length > 0) {
    let maxDist = -1;
    let furthestDif = diffusers[0];
    for (const dif of diffusers) {
      const dist = Math.pow(dif.x - A.x, 2) + Math.pow(dif.y - A.y, 2);
      if (dist > maxDist) {
        maxDist = dist;
        furthestDif = dif;
      }
    }
    B = { x: furthestDif.x, y: furthestDif.y };
  }

  const vx = B.x - A.x;
  const vy = B.y - A.y;
  const lenSq = vx * vx + vy * vy || 1;

  // 4. Project each diffuser orthogonally onto the trunk line AB
  const projectedDiffusers = diffusers.map((dif) => {
    const ux = dif.x - A.x;
    const uy = dif.y - A.y;
    let t = (ux * vx + uy * vy) / lenSq;
    t = Math.max(0, Math.min(1.0, t)); // clamp to backbone segment
    return {
      diffuser: dif,
      projX: A.x + t * vx,
      projY: A.y + t * vy,
      t: t
    };
  });

  // Sort projections by parameter 't' along the trunk (from closest to furthest)
  projectedDiffusers.sort((a, b) => a.t - b.t);

  const ducts: DuctSegment[] = [];
  const fixedHeight = units === 'imperial' ? 10 : 8; // Inches (e.g. 10" or 8" height)

  // 5. Build Trunk Segments
  let currentStart = { x: unitPos.x, y: unitPos.y };

  for (let i = 0; i < projectedDiffusers.length; i++) {
    const segmentEnd = {
      x: projectedDiffusers[i].projX,
      y: projectedDiffusers[i].projY
    };

    // Flow rate in this segment of the trunk is the sum of flows of ALL downstream diffusers
    let downstreamFlow = 0;
    for (let j = i; j < projectedDiffusers.length; j++) {
      downstreamFlow += projectedDiffusers[j].diffuser.cfm;
    }

    // Size the trunk section using equal friction sizing
    const size = sizeDuct(downstreamFlow, 0.1, fixedHeight);
    let sizeLabel = '';
    let widthVal = size.widthIn;
    let heightVal = size.heightIn;

    if (units === 'imperial') {
      sizeLabel = `${widthVal}x${heightVal}`;
    } else {
      // Metric sizes in mm (rounded to nearest 50 mm)
      const wMm = Math.round((widthVal * 25.4) / 50) * 50;
      const hMm = Math.round((heightVal * 25.4) / 50) * 50;
      sizeLabel = `${wMm}x${hMm}`;
      widthVal = wMm / 25.4;
      heightVal = hMm / 25.4;
    }

    ducts.push({
      id: `duct-trunk-${zoneId}-${i}`,
      type: 'trunk', // Rendered as trunk (thicker and distinctive)
      points: [currentStart.x, currentStart.y, segmentEnd.x, segmentEnd.y],
      widthIn: widthVal,
      heightIn: heightVal,
      cfm: downstreamFlow,
      sizeLabel: sizeLabel
    });

    currentStart = segmentEnd;
  }

  // 6. Build Branch Segments (connecting projected points on trunk to diffusers)
  projectedDiffusers.forEach((pd, idx) => {
    const dif = pd.diffuser;
    const branchStart = { x: pd.projX, y: pd.projY };
    const branchEnd = { x: dif.x, y: dif.y };

    const size = sizeDuct(dif.cfm, 0.1, fixedHeight);
    let sizeLabel = '';
    let widthVal = size.widthIn;
    let heightVal = size.heightIn;

    if (units === 'imperial') {
      sizeLabel = `${widthVal}x${heightVal}`;
    } else {
      const wMm = Math.round((widthVal * 25.4) / 50) * 50;
      const hMm = Math.round((heightVal * 25.4) / 50) * 50;
      sizeLabel = `${wMm}x${hMm}`;
      widthVal = wMm / 25.4;
      heightVal = hMm / 25.4;
    }

    ducts.push({
      id: `duct-branch-${zoneId}-${idx}`,
      type: 'branch',
      points: [branchStart.x, branchStart.y, branchEnd.x, branchEnd.y],
      widthIn: widthVal,
      heightIn: heightVal,
      cfm: dif.cfm,
      sizeLabel: sizeLabel
    });
  });

  return { ducts, unitPos };
}
