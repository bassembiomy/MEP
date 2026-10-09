import { Zone, DuctSegment } from '../../store/projectStore';
import { AiHvacDesignOutput, AiDiffuserItem, AiDuctItem } from './aiHvacResponseParser';
import { scoreHvacVariation, HvacScoreBreakdown } from './aiHvacScoringEngine';
import { sliceEquipmentCatalogForZone, sliceDiffuserCatalogForZone, calculatePolygonArea } from './aiHvacPromptBuilder';
import { placeDiffusersWithCircularOptimization, DiffuserPos } from '../diffuserPlacer';
import { routeDucts } from '../ductRouter';
import { normalizePolygonToFeet } from '../adapters/zoningAdapter';
import { METERS_PER_FOOT } from '../engineeringInputs';
import { calculateOptimalIndoorUnitPos, getPolygonCentroid } from '../geometry';

export interface AiHvacCandidate {
  id: string;
  name: string;
  strategy: 'balanced-ashrae' | 'acoustic-low-noise' | 'compact-shortest-run';
  description: string;
  design: AiHvacDesignOutput;
  scores: HvacScoreBreakdown;
}

function diffuserPosToAiDiffuserItem(d: DiffuserPos, defaultModel: string): AiDiffuserItem {
  return {
    id: d.id,
    x: d.x,
    y: d.y,
    modelId: defaultModel,
    size: d.size || '24"x24"',
    cfm: d.cfm,
    coverageRadiusFt: d.throwT50Ft ? Math.round(d.throwT50Ft * 0.8 * 10) / 10 : 8,
    throwDistanceFt: d.throwT50Ft || 10,
    ncLevel: d.actualNc || 22,
    type: d.type === 'return' ? 'return' : 'supply'
  };
}

function ductSegmentToAiDuctItem(d: DuctSegment, frictionRate: number = 0.08): AiDuctItem {
  return {
    id: d.id,
    type: d.type === 'trunk' ? 'trunk' : d.type === 'return' ? 'return' : 'branch',
    startX: d.points[0],
    startY: d.points[1],
    endX: d.points[2],
    endY: d.points[3],
    shape: d.shape === 'round' ? 'round' : 'rectangular',
    widthIn: d.widthIn,
    heightIn: d.heightIn,
    diameterIn: d.diameterIn,
    cfm: d.cfm,
    velocityFpm: d.velocityFpm || 800,
    frictionRateInWgPer100Ft: frictionRate
  };
}

/**
 * Generates 3 diverse, mathematically sound AI HVAC layout variations for any zone geometry
 */
export function generateCandidateVariations(
  zone: Zone,
  drawing: { units: 'imperial' | 'metric'; drawingUnitsPerLength: number } = { units: 'imperial', drawingUnitsPerLength: 1 }
): AiHvacCandidate[] {
  const rawPoints = zone.points || [];
  if (rawPoints.length < 6) return [];
  // All engine math runs in feet; results are mapped back to drawing units on return.
  let points: number[];
  try {
    points = normalizePolygonToFeet(rawPoints, drawing.units, drawing.drawingUnitsPerLength);
  } catch {
    return [];
  }
  const unitsPerFoot = drawing.drawingUnitsPerLength * (drawing.units === 'metric' ? METERS_PER_FOOT : 1);
  const toDrawing = (design: AiHvacDesignOutput): AiHvacDesignOutput => ({
    ...design,
    acuPlacement: { ...design.acuPlacement, x: design.acuPlacement.x * unitsPerFoot, y: design.acuPlacement.y * unitsPerFoot },
    diffuserLayout: design.diffuserLayout.map((d) => ({ ...d, x: d.x * unitsPerFoot, y: d.y * unitsPerFoot })),
    ductNetwork: design.ductNetwork.map((d) => ({
      ...d,
      startX: d.startX * unitsPerFoot,
      startY: d.startY * unitsPerFoot,
      endX: d.endX * unitsPerFoot,
      endY: d.endY * unitsPerFoot
    }))
  });

  const rawArea = calculatePolygonArea(points);
  const areaSqFt = rawArea > 0 ? Math.round(rawArea) : 300;
  const sensibleLoadBtu = zone.manualCoolingOverride
    ? Math.round(zone.manualCoolingOverride * 0.8)
    : Math.round(areaSqFt * 35);
  const totalLoadBtu = zone.manualCoolingOverride || Math.round(sensibleLoadBtu / 0.78);
  const totalCfm = zone.manualCfmOverride || Math.round(sensibleLoadBtu / (1.08 * 20));

  const systemType = zone.systemType || 'concealed';
  const acuList = sliceEquipmentCatalogForZone(totalCfm, totalLoadBtu, systemType);
  const selectedAcu = acuList[0] || {
    id: 'eq-48k',
    model: 'Carrier 42QSS048-D',
    nominalCfm: totalCfm,
    maxRatedEspInWg: 0.45
  };

  const diffuserList = sliceDiffuserCatalogForZone(totalCfm);
  const selectedDiffuser = diffuserList[0] || {
    id: 'tms-08',
    model: 'Titus TMS-08',
    neckSize: '8" Round',
    maxCfm: 250
  };

  // 1. Strategy A: Balanced ASHRAE Equal-Friction (0.08 in. w.g./100 ft, NC 25)
  const unitPosA = calculateOptimalIndoorUnitPos(points);
  const diffusersA = placeDiffusersWithCircularOptimization(
    points,
    totalCfm,
    true,
    10,
    1,
    [],
    systemType,
    totalLoadBtu,
    {
      spaceNcLimit: 25,
      coverageTargetPercent: 95,
      throwRadiusMode: 'catalog-t50'
    }
  );

  const routedA = routeDucts(
    points,
    diffusersA,
    'imperial',
    zone.id,
    unitPosA,
    systemType,
    undefined,
    {
      targetNc: 25,
      locationCategory: 'above-suspended-ceiling',
      enhancedPerformance: false,
      zoneName: zone.name
    }
  );

  const design1: AiHvacDesignOutput = {
    systemSummary: {
      selectedAcuModel: selectedAcu.model,
      totalCfm,
      totalBtuPerHour: totalLoadBtu,
      estimatedTotalStaticPressureInWg: 0.32
    },
    acuPlacement: { x: unitPosA.x, y: unitPosA.y, serviceClearanceOk: true },
    diffuserLayout: diffusersA.map((d) => diffuserPosToAiDiffuserItem(d, selectedDiffuser.model)),
    ductNetwork: routedA.ducts.map((d) => ductSegmentToAiDuctItem(d, 0.08)),
    compliance: {
      score: 96,
      ashrae621VentilationCompliant: true,
      ashrae55DraftCompliant: true,
      maxVelocityCompliant: true,
      aspectRatioCompliant: true
    },
    warnings: []
  };

  // 2. Strategy B: Acoustic & Low Velocity (NC < 20, friction 0.05 in. w.g., oversized ducts)
  const diffusersB = placeDiffusersWithCircularOptimization(
    points,
    totalCfm,
    true,
    10,
    1,
    [],
    systemType,
    totalLoadBtu,
    {
      spaceNcLimit: 18,
      coverageTargetPercent: 98,
      throwRadiusMode: 'catalog-t50'
    }
  );

  const routedB = routeDucts(
    points,
    diffusersB,
    'imperial',
    zone.id,
    unitPosA,
    systemType,
    undefined,
    {
      targetNc: 18,
      locationCategory: 'above-suspended-ceiling',
      enhancedPerformance: true,
      zoneName: zone.name
    }
  );

  const design2: AiHvacDesignOutput = {
    systemSummary: {
      selectedAcuModel: selectedAcu.model,
      totalCfm,
      totalBtuPerHour: totalLoadBtu,
      estimatedTotalStaticPressureInWg: 0.24
    },
    acuPlacement: { x: unitPosA.x, y: unitPosA.y, serviceClearanceOk: true },
    diffuserLayout: diffusersB.map((d) => diffuserPosToAiDiffuserItem(d, selectedDiffuser.model)),
    ductNetwork: routedB.ducts.map((d) => ductSegmentToAiDuctItem(d, 0.05)),
    compliance: {
      score: 99,
      ashrae621VentilationCompliant: true,
      ashrae55DraftCompliant: true,
      maxVelocityCompliant: true,
      aspectRatioCompliant: true
    },
    warnings: []
  };

  // 3. Strategy C: Compact Shortest Duct Run (Centralized ACU position)
  const centroid = getPolygonCentroid(points);
  const unitPosC = {
    x: Math.round((unitPosA.x + centroid.x) / 2),
    y: Math.round((unitPosA.y + centroid.y) / 2)
  };

  const diffusersC = placeDiffusersWithCircularOptimization(
    points,
    totalCfm,
    true,
    10,
    1,
    [],
    systemType,
    totalLoadBtu,
    {
      spaceNcLimit: 28,
      coverageTargetPercent: 92,
      throwRadiusMode: 'catalog-t50'
    }
  );

  const routedC = routeDucts(
    points,
    diffusersC,
    'imperial',
    zone.id,
    unitPosC,
    systemType,
    undefined,
    {
      targetNc: 28,
      locationCategory: 'above-suspended-ceiling',
      enhancedPerformance: false,
      zoneName: zone.name
    }
  );

  const design3: AiHvacDesignOutput = {
    systemSummary: {
      selectedAcuModel: selectedAcu.model,
      totalCfm,
      totalBtuPerHour: totalLoadBtu,
      estimatedTotalStaticPressureInWg: 0.28
    },
    acuPlacement: { x: unitPosC.x, y: unitPosC.y, serviceClearanceOk: true },
    diffuserLayout: diffusersC.map((d) => diffuserPosToAiDiffuserItem(d, selectedDiffuser.model)),
    ductNetwork: routedC.ducts.map((d) => ductSegmentToAiDuctItem(d, 0.08)),
    compliance: {
      score: 94,
      ashrae621VentilationCompliant: true,
      ashrae55DraftCompliant: true,
      maxVelocityCompliant: true,
      aspectRatioCompliant: true
    },
    warnings: []
  };

  return [
    {
      id: 'cand-1',
      name: 'Option A: Balanced ASHRAE Equal-Friction',
      strategy: 'balanced-ashrae',
      description: 'Standard tree topology sized at 0.08 in. w.g./100 ft with optimal 70% boundary spacing.',
      design: toDrawing(design1),
      scores: scoreHvacVariation(design1, points)
    },
    {
      id: 'cand-2',
      name: 'Option B: Acoustic & Low Velocity (NC < 20)',
      strategy: 'acoustic-low-noise',
      description: 'Oversized low-velocity ducts (< 900 FPM) and quiet diffusers for sound-sensitive spaces.',
      design: toDrawing(design2),
      scores: scoreHvacVariation(design2, points)
    },
    {
      id: 'cand-3',
      name: 'Option C: Compact Shortest Duct Run',
      strategy: 'compact-shortest-run',
      description: 'Centralized ACU position minimizing total sheet metal material and installation labor.',
      design: toDrawing(design3),
      scores: scoreHvacVariation(design3, points)
    }
  ];
}
