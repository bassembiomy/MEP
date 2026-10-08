import { AiHvacDesignOutput } from './aiHvacResponseParser';
import { calculatePolygonArea } from './aiHvacPromptBuilder';

export interface HvacScoreBreakdown {
  overallScore: number; // 0 - 100
  materialScore: number; // 0 - 100 (duct length & sheet metal)
  acousticScore: number; // 0 - 100 (noise criteria & duct velocity)
  pressureDropScore: number; // 0 - 100 (static pressure efficiency)
  spatialCoverageScore: number; // 0 - 100 (ADPI & room distribution)
  metrics: {
    totalDuctLengthFt: number;
    maxDuctVelocityFpm: number;
    avgDiffuserNc: number;
    estimatedEspInWg: number;
    diffuserCount: number;
    aspectRatioMax: number;
  };
  recommendations: string[];
}

/**
 * Multi-objective scoring algorithm evaluating an HVAC layout variation
 */
export function scoreHvacVariation(
  layout: AiHvacDesignOutput,
  zonePoints?: number[]
): HvacScoreBreakdown {
  const recommendations: string[] = [];

  // 1. Calculate Duct Network Metrics
  let totalDuctLength = 0;
  let maxDuctVelocity = 0;
  let maxAspectRatio = 1.0;

  if (Array.isArray(layout.ductNetwork)) {
    layout.ductNetwork.forEach((d) => {
      const dx = (d.endX || 0) - (d.startX || 0);
      const dy = (d.endY || 0) - (d.startY || 0);
      const len = Math.sqrt(dx * dx + dy * dy);
      totalDuctLength += len;

      if (d.velocityFpm > maxDuctVelocity) {
        maxDuctVelocity = d.velocityFpm;
      }

      if (d.widthIn && d.heightIn && d.widthIn > 0 && d.heightIn > 0) {
        const aspect = Math.max(d.widthIn, d.heightIn) / Math.min(d.widthIn, d.heightIn);
        if (aspect > maxAspectRatio) {
          maxAspectRatio = aspect;
        }
      }
    });
  }

  // 2. Diffuser Metrics
  let totalNc = 0;
  const diffuserCount = Array.isArray(layout.diffuserLayout) ? layout.diffuserLayout.length : 0;

  if (diffuserCount > 0) {
    layout.diffuserLayout.forEach((d) => {
      totalNc += d.ncLevel || 25;
    });
  }
  const avgDiffuserNc = diffuserCount > 0 ? Math.round(totalNc / diffuserCount) : 25;

  // 3. Pressure Drop
  const estimatedEsp = layout.systemSummary?.estimatedTotalStaticPressureInWg || 0.40;

  // 4. Sub-Scores Calculation

  // Material Score (0 - 100): Penalize excessive duct length and high aspect ratio
  let materialScore = 95;
  if (totalDuctLength > 150) materialScore -= 15;
  if (totalDuctLength > 250) materialScore -= 20;
  if (maxAspectRatio > 3.0) materialScore -= 15;
  if (maxAspectRatio > 4.0) materialScore -= 25;
  materialScore = Math.max(20, Math.min(100, materialScore));

  // Acoustic Score (0 - 100): Penalize velocities > 1200 FPM and NC > 28
  let acousticScore = 95;
  if (maxDuctVelocity > 1400) {
    acousticScore -= 20;
    recommendations.push(`High duct velocity observed (${maxDuctVelocity} FPM). Upsize trunk to reduce sound transmission.`);
  } else if (maxDuctVelocity > 1200) {
    acousticScore -= 10;
  }

  if (avgDiffuserNc > 30) {
    acousticScore -= 25;
    recommendations.push(`Diffuser NC (${avgDiffuserNc}) is elevated. Consider lower CFM neck size.`);
  } else if (avgDiffuserNc > 25) {
    acousticScore -= 10;
  }
  acousticScore = Math.max(20, Math.min(100, acousticScore));

  // Pressure Drop Score (0 - 100): Optimal ESP is 0.25 - 0.45 in. w.g.
  let pressureDropScore = 95;
  if (estimatedEsp > 0.60) {
    pressureDropScore -= 25;
    recommendations.push(`High ESP (${estimatedEsp}" w.g.) will require higher fan power.`);
  } else if (estimatedEsp > 0.45) {
    pressureDropScore -= 10;
  }
  pressureDropScore = Math.max(20, Math.min(100, pressureDropScore));

  // Spatial Coverage Score
  let spatialCoverageScore = 90;
  if (zonePoints && zonePoints.length >= 6) {
    const areaSqFt = calculatePolygonArea(zonePoints);
    if (diffuserCount > 0) {
      const areaPerDiffuser = areaSqFt / diffuserCount;
      if (areaPerDiffuser > 350) {
        spatialCoverageScore -= 15;
        recommendations.push('Area per diffuser exceeds 350 sq ft; consider adding diffusers for draft-free ADPI.');
      }
    }
  }
  spatialCoverageScore = Math.max(20, Math.min(100, spatialCoverageScore));

  const overallScore = Math.round(
    0.25 * materialScore +
    0.25 * acousticScore +
    0.25 * pressureDropScore +
    0.25 * spatialCoverageScore
  );

  return {
    overallScore,
    materialScore,
    acousticScore,
    pressureDropScore,
    spatialCoverageScore,
    metrics: {
      totalDuctLengthFt: Math.round(totalDuctLength * 10) / 10,
      maxDuctVelocityFpm: maxDuctVelocity,
      avgDiffuserNc,
      estimatedEspInWg: estimatedEsp,
      diffuserCount,
      aspectRatioMax: Math.round(maxAspectRatio * 10) / 10
    },
    recommendations
  };
}
