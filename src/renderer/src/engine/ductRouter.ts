import { sizeDuctAcoustically, verifyDuctSectionAcoustics } from './acousticDuctEngine';
import { DiffuserPos } from './diffuserPlacer';
import { getPolygonCentroid, calculateOptimalIndoorUnitPos } from './geometry';
import { DuctSegment } from '../store/projectStore';
import { DuctLocationCategory, AcousticSensitivity, DuctSectionCategory } from './types';

export interface RouteDuctAcousticOptions {
  targetNc?: number;
  locationCategory?: DuctLocationCategory;
  acousticSensitivity?: AcousticSensitivity;
  enhancedPerformance?: boolean;
  zoneName?: string;
  ductShape?: 'rectangular' | 'round';
}

export function routeDucts(
  points: number[],
  diffusers: DiffuserPos[],
  units: 'imperial' | 'metric',
  zoneId: string,
  customUnitPos?: { x: number; y: number },
  systemType: string = 'concealed',
  outdoorUnitPos?: { x: number; y: number },
  acousticOptions: RouteDuctAcousticOptions = {}
): { ducts: DuctSegment[]; unitPos: { x: number; y: number } } {
  // Non-ducted systems (High Wall, standard Cassette) do not use supply duct networks
  if (systemType === 'high-wall' || systemType === 'cassette') {
    return { ducts: [], unitPos: customUnitPos || { x: 0, y: 0 } };
  }

  const supplyDiffusers = diffusers.filter((d) => d.type === 'supply' || !d.type);
  const returnDiffusers = diffusers.filter((d) => d.type === 'return');

  if (points.length < 6 || (supplyDiffusers.length === 0 && returnDiffusers.length === 0)) {
    return { ducts: [], unitPos: { x: 0, y: 0 } };
  }

  const {
    targetNc = 32,
    locationCategory = 'above-suspended-ceiling',
    enhancedPerformance = false,
    zoneName = 'Zone',
    ductShape = 'rectangular'
  } = acousticOptions;

  // 1. Determine Indoor Unit Position (FCU / AHU / RTU Entry)
  let unitPos = customUnitPos;
  if (!unitPos || (unitPos.x === 0 && unitPos.y === 0)) {
    unitPos = calculateOptimalIndoorUnitPos(points, outdoorUnitPos);
  }

  const centroid = getPolygonCentroid(points);

  // 2. Find the furthest supply diffuser from the Indoor Unit to orient the main trunk
  let maxDist = -1;
  let furthestDif = supplyDiffusers[0] || diffusers[0];
  for (const dif of supplyDiffusers) {
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

  // 3. Project each supply diffuser orthogonally onto the trunk line AB
  const projectedDiffusers = supplyDiffusers.map((dif) => {
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

    const acousticSizing = sizeDuctAcoustically(downstreamFlow, {
      locationCategory,
      targetNc,
      sectionCategory: 'trunk',
      shape: ductShape,
      fixedHeightIn: fixedHeight,
      enhancedPerformance
    });

    let sizeLabel = '';
    let widthVal = acousticSizing.widthIn;
    let heightVal = acousticSizing.heightIn;
    const diameterVal = acousticSizing.diameterIn;

    if (ductShape === 'round') {
      sizeLabel = `Ø${diameterVal}"`;
    } else if (units === 'imperial') {
      sizeLabel = `${widthVal}"x${heightVal}"`;
    } else {
      const wMm = Math.round((widthVal * 25.4) / 25) * 25;
      const hMm = Math.round((heightVal * 25.4) / 25) * 25;
      sizeLabel = `${wMm}x${hMm}`;
      widthVal = wMm / 25.4;
      heightVal = hMm / 25.4;
    }

    const areaSqFt = ductShape === 'round'
      ? (Math.PI * Math.pow(diameterVal / 2, 2)) / 144
      : (widthVal * heightVal) / 144;
    const velocityFpm = Math.round(downstreamFlow / Math.max(0.1, areaSqFt));

    const ductId = `duct-trunk-${zoneId}-${i}`;
    const verification = verifyDuctSectionAcoustics(
      {
        id: ductId,
        type: 'trunk',
        widthIn: widthVal,
        heightIn: heightVal,
        diameterIn: ductShape === 'round' ? diameterVal : undefined,
        shape: ductShape,
        cfm: downstreamFlow,
        velocityFpm,
        sectionCategory: 'trunk'
      },
      {
        zoneName,
        targetNc,
        locationCategory,
        enhancedPerformance
      }
    );

    ducts.push({
      id: ductId,
      type: 'trunk',
      points: [currentStart.x, currentStart.y, segmentEnd.x, segmentEnd.y],
      widthIn: widthVal,
      heightIn: heightVal,
      diameterIn: ductShape === 'round' ? diameterVal : undefined,
      shape: ductShape,
      areaSqFt: Math.round(areaSqFt * 1000) / 1000,
      cfm: downstreamFlow,
      velocityFpm,
      sizeLabel,
      sectionCategory: 'trunk',
      acousticVerification: verification
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
      const sectionCat: DuctSectionCategory = 'runout';
      const acousticSizing = sizeDuctAcoustically(dif.cfm, {
        locationCategory,
        targetNc,
        sectionCategory: sectionCat,
        shape: ductShape,
        fixedHeightIn: fixedHeight,
        enhancedPerformance
      });

      let sizeLabel = '';
      let widthVal = acousticSizing.widthIn;
      let heightVal = acousticSizing.heightIn;
      const diameterVal = acousticSizing.diameterIn;

      if (ductShape === 'round') {
        sizeLabel = `Ø${diameterVal}"`;
      } else if (units === 'imperial') {
        sizeLabel = `${widthVal}"x${heightVal}"`;
      } else {
        const wMm = Math.round((widthVal * 25.4) / 25) * 25;
        const hMm = Math.round((heightVal * 25.4) / 25) * 25;
        sizeLabel = `${wMm}x${hMm}`;
        widthVal = wMm / 25.4;
        heightVal = hMm / 25.4;
      }

      const areaSqFt = ductShape === 'round'
        ? (Math.PI * Math.pow(diameterVal / 2, 2)) / 144
        : (widthVal * heightVal) / 144;
      const velocityFpm = Math.round(dif.cfm / Math.max(0.1, areaSqFt));

      const ductId = `duct-branch-${zoneId}-${idx}`;
      const verification = verifyDuctSectionAcoustics(
        {
          id: ductId,
          type: 'branch',
          widthIn: widthVal,
          heightIn: heightVal,
          diameterIn: ductShape === 'round' ? diameterVal : undefined,
          shape: ductShape,
          cfm: dif.cfm,
          velocityFpm,
          sectionCategory: sectionCat
        },
        {
          zoneName,
          targetNc,
          locationCategory,
          enhancedPerformance
        }
      );

      ducts.push({
        id: ductId,
        type: 'branch',
        points: [branchStart.x, branchStart.y, branchEnd.x, branchEnd.y],
        widthIn: widthVal,
        heightIn: heightVal,
        diameterIn: ductShape === 'round' ? diameterVal : undefined,
        shape: ductShape,
        areaSqFt: Math.round(areaSqFt * 1000) / 1000,
        cfm: dif.cfm,
        velocityFpm,
        sizeLabel,
        sectionCategory: sectionCat,
        acousticVerification: verification
      });
    }
  });

  // 6. For Ducted Systems (Concealed, Packaged, AHU, VRF), add dedicated Return Air ductwork
  const isDuctedSystem = systemType === 'concealed' || systemType === 'packaged' || systemType === 'ahu' || systemType === 'vrf';
  if (isDuctedSystem) {
    if (returnDiffusers.length > 0) {
      returnDiffusers.forEach((rd, rIdx) => {
        const returnSizing = sizeDuctAcoustically(rd.cfm, {
          locationCategory,
          targetNc,
          sectionCategory: 'return',
          shape: ductShape,
          fixedHeightIn: fixedHeight,
          enhancedPerformance,
          frictionRateTarget: 0.08
        });

        const retLabel = ductShape === 'round'
          ? `Ø${returnSizing.diameterIn}" (R)`
          : units === 'imperial'
          ? `${returnSizing.widthIn}"x${returnSizing.heightIn}" (R)`
          : `${Math.round(returnSizing.widthIn * 25.4)}x${Math.round(returnSizing.heightIn * 25.4)} (R)`;

        const ductId = `duct-return-${zoneId}-${rIdx}`;
        const retAreaSqFt = (returnSizing.widthIn * returnSizing.heightIn) / 144;
        const retVelocity = Math.round(rd.cfm / Math.max(0.1, retAreaSqFt));

        const retVerification = verifyDuctSectionAcoustics(
          {
            id: ductId,
            type: 'return',
            widthIn: returnSizing.widthIn,
            heightIn: returnSizing.heightIn,
            diameterIn: ductShape === 'round' ? returnSizing.diameterIn : undefined,
            shape: ductShape,
            cfm: rd.cfm,
            velocityFpm: retVelocity,
            sectionCategory: 'return'
          },
          {
            zoneName,
            targetNc,
            locationCategory,
            enhancedPerformance
          }
        );

        ducts.push({
          id: ductId,
          type: 'return',
          points: [unitPos.x, unitPos.y, rd.x, rd.y],
          widthIn: returnSizing.widthIn,
          heightIn: returnSizing.heightIn,
          diameterIn: ductShape === 'round' ? returnSizing.diameterIn : undefined,
          shape: ductShape,
          areaSqFt: Math.round(retAreaSqFt * 1000) / 1000,
          cfm: rd.cfm,
          velocityFpm: retVelocity,
          sizeLabel: retLabel,
          sectionCategory: 'return',
          acousticVerification: retVerification
        });
      });
    } else {
      const totalFlow = supplyDiffusers.reduce((sum, d) => sum + d.cfm, 0);
      const returnFlow = Math.round(totalFlow * 0.9);

      const returnSizing = sizeDuctAcoustically(returnFlow, {
        locationCategory,
        targetNc,
        sectionCategory: 'return',
        shape: ductShape,
        fixedHeightIn: fixedHeight,
        enhancedPerformance,
        frictionRateTarget: 0.08
      });

      const retLabel = ductShape === 'round'
        ? `Ø${returnSizing.diameterIn}" (R)`
        : units === 'imperial'
        ? `${returnSizing.widthIn}"x${returnSizing.heightIn}" (R)`
        : `${Math.round(returnSizing.widthIn * 25.4)}x${Math.round(returnSizing.heightIn * 25.4)} (R)`;

      // Place return intake near the unit entry point inside the room
      const retEndX = Math.round(unitPos.x + (centroid.x - unitPos.x) * 0.35);
      const retEndY = Math.round(unitPos.y + (centroid.y - unitPos.y) * 0.35);

      const ductId = `duct-return-${zoneId}`;
      const retAreaSqFt = (returnSizing.widthIn * returnSizing.heightIn) / 144;
      const retVelocity = Math.round(returnFlow / Math.max(0.1, retAreaSqFt));

      const retVerification = verifyDuctSectionAcoustics(
        {
          id: ductId,
          type: 'return',
          widthIn: returnSizing.widthIn,
          heightIn: returnSizing.heightIn,
          diameterIn: ductShape === 'round' ? returnSizing.diameterIn : undefined,
          shape: ductShape,
          cfm: returnFlow,
          velocityFpm: retVelocity,
          sectionCategory: 'return'
        },
        {
          zoneName,
          targetNc,
          locationCategory,
          enhancedPerformance
        }
      );

      ducts.push({
        id: ductId,
        type: 'return',
        points: [unitPos.x, unitPos.y + 15, retEndX, retEndY],
        widthIn: returnSizing.widthIn,
        heightIn: returnSizing.heightIn,
        diameterIn: ductShape === 'round' ? returnSizing.diameterIn : undefined,
        shape: ductShape,
        areaSqFt: Math.round(retAreaSqFt * 1000) / 1000,
        cfm: returnFlow,
        velocityFpm: retVelocity,
        sizeLabel: retLabel,
        sectionCategory: 'return',
        acousticVerification: retVerification
      });
    }
  }

  return { ducts, unitPos };
}
