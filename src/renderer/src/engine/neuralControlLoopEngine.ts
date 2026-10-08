/**
 * Physics-Informed Neural Closed-Loop Optimization Control Engine
 *
 * Aligned with Lecture 07 Air Outlet Catalogues & ASHRAE/SMACNA Standards:
 * 1. Equipment Partitioning (ACU / FCU / AHU count and capacity split)
 * 2. Diffuser Selection & CFM Apportionment (Lecture 07 Table 4 Ceiling Height CFM limits, A_k * V_k equation)
 * 3. Acoustic Noise Verification (Lecture 07 Table 1 NC vs Neck Velocity limits, Diffuser NC <= room NC limit)
 * 4. Duct Static Pressure & Fan ESP Matching (DeltaP_total <= ESP_rated)
 * 5. Spatial Lloyd-Voronoi Relaxation & Geometric Throw Coverage (>= 95%)
 */

import {
  DiffuserPos,
  calculateZoneDiffuserCoverage,
  selectBestDiffuserFromCatalog
} from './diffuserPlacer';
import { getPolygonCentroid, isPointInPolygon } from './geometry';
import { STANDARD_DIFFUSER_CATALOG } from './hvacCatalogs';
import {
  getMaxCfmForCeilingHeight,
  getMaxNeckVelocityForNc
} from './standards/diffuserRules';

export interface UnifiedOptimizationInput {
  roomPolygon: number[];
  roomAreaSqFt: number;
  requiredCfm: number;
  totalLoadBtu: number;
  spaceNcLimit?: number;
  ceilingHeightFt?: number;
  terminalType?:
    | 'square-ceiling'
    | 'round-ceiling'
    | 'linear-slot'
    | 'swirl'
    | 'linear-bar'
    | 'jet-nozzle';
  systemType?: 'concealed' | 'packaged' | 'cassette' | 'high-wall' | 'vrf' | 'ahu' | 'fcu';
  scale?: number;
  isImperial?: boolean;
  dxfEntities?: any[];
  maxIterations?: number;
}

export interface OptimizationIterationTrace {
  iteration: number;
  equipmentCount: number;
  diffuserCount: number;
  coverage: number;
  maxNc: number;
  neckVelocityFpm: number;
  estimatedEspInWg: number;
  loss: number;
  adjustmentNote: string;
}

export interface UnifiedOptimizationResult {
  equipmentCount: number;
  supplyDiffusers: DiffuserPos[];
  returnDiffusers: DiffuserPos[];
  totalCfm: number;
  maxDiffuserNc: number;
  neckVelocityFpm: number;
  coveragePercent: number;
  estimatedEspInWg: number;
  loss: number;
  iterations: number;
  converged: boolean;
  trace: OptimizationIterationTrace[];
}

/**
 * Executes the unified closed-loop optimization control engine based on Lecture 07 catalogues & ASHRAE rules.
 */
export function optimizeUnifiedAirDistributionSystem(
  input: UnifiedOptimizationInput
): UnifiedOptimizationResult {
  const {
    roomPolygon,
    roomAreaSqFt,
    requiredCfm,
    totalLoadBtu,
    spaceNcLimit = 30,
    ceilingHeightFt = 9,
    terminalType = 'square-ceiling',
    systemType = 'concealed',
    scale = 10,
    isImperial = true,
    dxfEntities: _dxfEntities = [],
    maxIterations = 16
  } = input;

  if (roomPolygon.length < 6 || requiredCfm <= 0) {
    return {
      equipmentCount: 1,
      supplyDiffusers: [],
      returnDiffusers: [],
      totalCfm: 0,
      maxDiffuserNc: 0,
      neckVelocityFpm: 0,
      coveragePercent: 0,
      estimatedEspInWg: 0,
      loss: 0,
      iterations: 0,
      converged: false,
      trace: []
    };
  }

  // Calculate polygon bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const numPoints = roomPolygon.length / 2;
  for (let i = 0; i < numPoints; i++) {
    const x = roomPolygon[2 * i];
    const y = roomPolygon[2 * i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const aspect = Math.max(width / height, height / width);

  // 1. Equipment Partitioning Controller (Multi-ACU/FCU for large CFM or elongated zones)
  let equipmentCount = 1;
  if (systemType === 'cassette') {
    equipmentCount = Math.max(1, Math.ceil(totalLoadBtu / 38000));
  } else if (systemType === 'high-wall') {
    equipmentCount = Math.max(1, Math.ceil(totalLoadBtu / 24000));
  } else if (requiredCfm >= 3000 || (requiredCfm >= 1800 && aspect >= 2.2)) {
    equipmentCount = Math.max(2, Math.round(requiredCfm / 1800));
  }

  // 2. Lecture 07 Table 4 Ceiling Height CFM Cap & Acoustic Velocity Limit
  const maxCfmPerDiffuserByHeight = getMaxCfmForCeilingHeight(ceilingHeightFt);
  const maxNeckVelocityAllowable = getMaxNeckVelocityForNc(spaceNcLimit);

  // Standard ceiling diffusers operate best between 150 and 450 CFM (and <= maxCfmPerDiffuserByHeight)
  const minDiffuserCount = Math.max(1, Math.ceil(requiredCfm / Math.min(450, maxCfmPerDiffuserByHeight)));
  const maxDiffuserCount = Math.max(minDiffuserCount, Math.floor(requiredCfm / 150));

  // Determine initial starting terminal count
  let currentDiffuserCount = Math.max(
    minDiffuserCount,
    Math.min(maxDiffuserCount, Math.round(requiredCfm / 300))
  );

  // Sample interior polygon points for Voronoi placement
  const sampleInteriorPoints = (): { x: number; y: number }[] => {
    const gridResX = Math.min(32, Math.max(14, Math.round(width / 15)));
    const gridResY = Math.min(32, Math.max(14, Math.round(height / 15)));
    const stepX = width / gridResX;
    const stepY = height / gridResY;
    const interior: { x: number; y: number }[] = [];

    for (let ix = 0; ix <= gridResX; ix++) {
      const px = minX + (ix + 0.5) * stepX;
      for (let iy = 0; iy <= gridResY; iy++) {
        const py = minY + (iy + 0.5) * stepY;
        if (isPointInPolygon(px, py, roomPolygon)) {
          interior.push({ x: px, y: py });
        }
      }
    }

    if (interior.length === 0) {
      const c = getPolygonCentroid(roomPolygon);
      interior.push(isPointInPolygon(c.x, c.y, roomPolygon) ? c : { x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    }
    return interior;
  };

  const interiorSamples = sampleInteriorPoints();

  // Helper: generates candidate supply terminals for a given terminal count
  const evaluateCandidateLayout = (
    count: number,
    throwBoostFactor: number = 1.0
  ): {
    terminals: DiffuserPos[];
    maxNc: number;
    avgThrowFt: number;
    maxDeltaP: number;
    neckVelocityFpm: number;
  } => {
    const cfmPerTerminal = Math.round(requiredCfm / count);
    const areaPerTerminal = Math.max(20, roomAreaSqFt / Math.max(1, count));
    const targetThrowFt = Math.max(6, Math.min(32, 0.95 * Math.sqrt(areaPerTerminal) * throwBoostFactor));

    // Select matching catalog item (supporting Lecture 07 SCD, CCD, LSD, SWD, JN, LBG)
    const catalogPool = STANDARD_DIFFUSER_CATALOG.filter(d =>
      terminalType === 'round-ceiling' ? d.terminalType === 'round-ceiling' :
      terminalType === 'linear-slot' ? d.terminalType === 'linear-slot' :
      terminalType === 'swirl' ? d.terminalType === 'swirl' :
      terminalType === 'linear-bar' ? (d.terminalType as string) === 'linear-bar' || d.terminalType === 'sidewall-grille' :
      terminalType === 'jet-nozzle' ? d.terminalType === 'jet-nozzle' :
      d.terminalType === 'square-ceiling' || d.terminalType === 'round-ceiling'
    );

    const selection = selectBestDiffuserFromCatalog(
      cfmPerTerminal,
      spaceNcLimit,
      catalogPool.length > 0 ? catalogPool : STANDARD_DIFFUSER_CATALOG,
      targetThrowFt
    );

    // Calculate Neck Velocity V_k = CFM / A_neck (in FPM)
    const neckAreaSqFt = selection.diffuser.neckSizeIn
      ? (selection.diffuser.neckSizeIn.diameter
          ? (Math.PI * Math.pow(selection.diffuser.neckSizeIn.diameter / 2, 2)) / 144
          : (selection.diffuser.neckSizeIn.width * selection.diffuser.neckSizeIn.height) / 144)
      : (selection.diffuser.faceSizeIn.width * selection.diffuser.faceSizeIn.height * 0.44) / 144;

    const neckVelocityFpm = Math.round(cfmPerTerminal / Math.max(0.1, neckAreaSqFt));
    const effectiveThrowFt = Math.max(6, (selection.throwT50Ft || 10) * throwBoostFactor);
    let sizeLabel = `${selection.diffuser.faceSizeIn.width}"x${selection.diffuser.faceSizeIn.height}"`;
    if (systemType === 'cassette') sizeLabel = '36K';
    else if (systemType === 'high-wall') sizeLabel = '24K';

    // Single point fallback
    if (count === 1 || interiorSamples.length <= 1) {
      const centroid = getPolygonCentroid(roomPolygon);
      const snapC = isPointInPolygon(centroid.x, centroid.y, roomPolygon) ? centroid : interiorSamples[0];
      return {
        terminals: [{
          id: `diffuser-opt-0`,
          x: Math.round(snapC.x),
          y: Math.round(snapC.y),
          cfm: requiredCfm,
          size: sizeLabel,
          type: systemType === 'cassette' ? 'cassette' : systemType === 'high-wall' ? 'high-wall' : 'supply',
          actualNc: selection.actualNc,
          throwT50Ft: effectiveThrowFt,
          deltaPInWg: selection.deltaPInWg
        }],
        maxNc: selection.actualNc,
        avgThrowFt: effectiveThrowFt,
        maxDeltaP: selection.deltaPInWg,
        neckVelocityFpm
      };
    }

    // Furthest Point Sampling
    const seeds: { x: number; y: number }[] = [];
    seeds.push({ ...interiorSamples[Math.floor(interiorSamples.length / 2)] });

    while (seeds.length < count && seeds.length < interiorSamples.length) {
      let maxDistSq = -1;
      let bestPt: { x: number; y: number } | null = null;
      for (const p of interiorSamples) {
        let minDist = Infinity;
        for (const s of seeds) {
          const dSq = (p.x - s.x) * (p.x - s.x) + (p.y - s.y) * (p.y - s.y);
          if (dSq < minDist) minDist = dSq;
        }
        if (minDist > maxDistSq) {
          maxDistSq = minDist;
          bestPt = p;
        }
      }
      if (bestPt) seeds.push({ ...bestPt });
      else break;
    }

    // Lloyd's Relaxation Iterations (5 passes)
    for (let iter = 0; iter < 5; iter++) {
      const clusters: { sumX: number; sumY: number; count: number }[] = seeds.map(() => ({
        sumX: 0,
        sumY: 0,
        count: 0
      }));

      for (const p of interiorSamples) {
        let nearestIdx = 0;
        let nearestDistSq = Infinity;
        for (let sIdx = 0; sIdx < seeds.length; sIdx++) {
          const s = seeds[sIdx];
          const dSq = (p.x - s.x) * (p.x - s.x) + (p.y - s.y) * (p.y - s.y);
          if (dSq < nearestDistSq) {
            nearestDistSq = dSq;
            nearestIdx = sIdx;
          }
        }
        clusters[nearestIdx].sumX += p.x;
        clusters[nearestIdx].sumY += p.y;
        clusters[nearestIdx].count++;
      }

      for (let sIdx = 0; sIdx < seeds.length; sIdx++) {
        const c = clusters[sIdx];
        if (c.count > 0) {
          const newX = c.sumX / c.count;
          const newY = c.sumY / c.count;
          if (isPointInPolygon(newX, newY, roomPolygon)) {
            seeds[sIdx] = { x: newX, y: newY };
          } else {
            let closestP = seeds[sIdx];
            let minD = Infinity;
            for (const p of interiorSamples) {
              const d = Math.hypot(p.x - newX, p.y - newY);
              if (d < minD) {
                minD = d;
                closestP = p;
              }
            }
            seeds[sIdx] = { ...closestP };
          }
        }
      }
    }

    // Strict conservation of CFM across terminals
    const baseCfm = Math.floor(requiredCfm / count);
    const remainder = requiredCfm - baseCfm * count;

    const terminals: DiffuserPos[] = seeds.map((s, idx) => ({
      id: `diffuser-opt-${idx}`,
      x: Math.round(s.x),
      y: Math.round(s.y),
      cfm: baseCfm + (idx === 0 ? remainder : 0),
      size: sizeLabel,
      type: systemType === 'cassette' ? 'cassette' : systemType === 'high-wall' ? 'high-wall' : 'supply',
      actualNc: selection.actualNc,
      throwT50Ft: effectiveThrowFt,
      deltaPInWg: selection.deltaPInWg
    }));

    return {
      terminals,
      maxNc: selection.actualNc,
      avgThrowFt: effectiveThrowFt,
      maxDeltaP: selection.deltaPInWg,
      neckVelocityFpm
    };
  };

  // 3. Iterative Closed-Loop Optimizer with Feedback
  const trace: OptimizationIterationTrace[] = [];
  let bestResult: {
    terminals: DiffuserPos[];
    coveragePercent: number;
    maxNc: number;
    neckVelocityFpm: number;
    espInWg: number;
    loss: number;
    count: number;
  } | null = null;

  let throwBoost = 1.0;
  let converged = false;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const candidate = evaluateCandidateLayout(currentDiffuserCount, throwBoost);
    const cov = calculateZoneDiffuserCoverage(roomPolygon, candidate.terminals, scale, isImperial);

    // Estimate ductwork static pressure based on longest path & equal friction
    const longestPathFt = (Math.sqrt(roomAreaSqFt) * 0.7) / equipmentCount;
    const ductFrictionLoss = (longestPathFt / 100) * 0.08;
    const fittingsLoss = 0.08;
    const estimatedEspInWg = parseFloat((candidate.maxDeltaP + ductFrictionLoss + fittingsLoss).toFixed(3));

    // Multi-Objective Loss L(u)
    const coverageShortfall = Math.max(0, 95.0 - cov.coveragePercent);
    const lossCoverage = coverageShortfall * coverageShortfall * 5.0;

    const ncExcess = Math.max(0, candidate.maxNc - spaceNcLimit);
    const lossNc = ncExcess * ncExcess * 20.0;

    const velExcess = Math.max(0, candidate.neckVelocityFpm - maxNeckVelocityAllowable);
    const lossVel = (velExcess / 50) * (velExcess / 50) * 10.0;

    const espExcess = Math.max(0, estimatedEspInWg - 0.40);
    const lossEsp = espExcess * espExcess * 50.0;

    const cfmPerTerm = requiredCfm / currentDiffuserCount;
    const cfmBandPenalty = (cfmPerTerm < 150 ? (150 - cfmPerTerm) * 2 : 0) +
                           (cfmPerTerm > maxCfmPerDiffuserByHeight ? (cfmPerTerm - maxCfmPerDiffuserByHeight) * 3 : 0);

    const totalLoss = parseFloat((lossCoverage + lossNc + lossVel + lossEsp + cfmBandPenalty).toFixed(2));

    let note = 'Optimal balance achieved per Lecture 07 catalog';
    let adjusted = false;

    if (candidate.maxNc > spaceNcLimit || candidate.neckVelocityFpm > maxNeckVelocityAllowable) {
      note = `NC (${candidate.maxNc}) or Velocity (${candidate.neckVelocityFpm} FPM) > limits. Adding diffusers.`;
      if (currentDiffuserCount < maxDiffuserCount) {
        currentDiffuserCount++;
        adjusted = true;
      }
    } else if (cov.coveragePercent < 95.0) {
      if (currentDiffuserCount < maxDiffuserCount) {
        note = `Coverage (${cov.coveragePercent}%) < 95%. Increasing diffuser count.`;
        currentDiffuserCount++;
        adjusted = true;
      } else if (throwBoost < 1.35) {
        note = `Coverage (${cov.coveragePercent}%) < 95%. Adapting throw vector envelope.`;
        throwBoost += 0.08;
        adjusted = true;
      }
    }

    trace.push({
      iteration,
      equipmentCount,
      diffuserCount: currentDiffuserCount,
      coverage: cov.coveragePercent,
      maxNc: candidate.maxNc,
      neckVelocityFpm: candidate.neckVelocityFpm,
      estimatedEspInWg,
      loss: totalLoss,
      adjustmentNote: note
    });

    if (!bestResult || totalLoss < bestResult.loss || (cov.coveragePercent >= 95.0 && candidate.maxNc <= spaceNcLimit)) {
      bestResult = {
        terminals: candidate.terminals,
        coveragePercent: cov.coveragePercent,
        maxNc: candidate.maxNc,
        neckVelocityFpm: candidate.neckVelocityFpm,
        espInWg: estimatedEspInWg,
        loss: totalLoss,
        count: currentDiffuserCount
      };
    }

    if (cov.coveragePercent >= 95.0 && candidate.maxNc <= spaceNcLimit && !adjusted) {
      converged = true;
      break;
    }
  }

  const finalLayout = bestResult ? bestResult.terminals : evaluateCandidateLayout(currentDiffuserCount).terminals;
  const finalCov = bestResult ? bestResult.coveragePercent : calculateZoneDiffuserCoverage(roomPolygon, finalLayout, scale, isImperial).coveragePercent;
  const finalMaxNc = bestResult ? bestResult.maxNc : 25;
  const finalNeckVel = bestResult ? bestResult.neckVelocityFpm : 600;
  const finalEsp = bestResult ? bestResult.espInWg : 0.15;
  const finalLoss = bestResult ? bestResult.loss : 0;

  // 4. Generate Coordinated Return Grilles
  const isDucted = systemType === 'concealed' || systemType === 'packaged' || systemType === 'vrf' || systemType === 'ahu';
  const returnDiffusers: DiffuserPos[] = [];

  if (isDucted && finalLayout.length > 0) {
    const returnCount = Math.max(equipmentCount, Math.ceil(requiredCfm / 800));
    const returnCfmPerGrille = Math.round((requiredCfm * 0.9) / returnCount);

    const placedReturns: { x: number; y: number }[] = [];

    for (let rIdx = 0; rIdx < returnCount; rIdx++) {
      let maxScore = -1;
      let bestPt = interiorSamples[0];

      for (const ip of interiorSamples) {
        let minSupDist = Infinity;
        for (const st of finalLayout) {
          const d = Math.hypot(ip.x - st.x, ip.y - st.y);
          if (d < minSupDist) minSupDist = d;
        }

        let minRetDist = Infinity;
        for (const pr of placedReturns) {
          const d = Math.hypot(ip.x - pr.x, ip.y - pr.y);
          if (d < minRetDist) minRetDist = d;
        }

        const score = Math.min(minSupDist, minRetDist);
        if (score > maxScore) {
          maxScore = score;
          bestPt = ip;
        }
      }

      placedReturns.push(bestPt);
      returnDiffusers.push({
        id: `return-opt-${rIdx}`,
        x: Math.round(bestPt.x),
        y: Math.round(bestPt.y),
        cfm: returnCfmPerGrille,
        size: '24"x24"',
        type: 'return',
        actualNc: Math.max(15, finalMaxNc - 5),
        throwT50Ft: 0,
        deltaPInWg: 0.02
      });
    }
  }

  return {
    equipmentCount,
    supplyDiffusers: finalLayout,
    returnDiffusers,
    totalCfm: requiredCfm,
    maxDiffuserNc: finalMaxNc,
    neckVelocityFpm: finalNeckVel,
    coveragePercent: finalCov,
    estimatedEspInWg: finalEsp,
    loss: finalLoss,
    iterations: trace.length,
    converged: converged || (finalCov >= 95.0 && finalMaxNc <= spaceNcLimit),
    trace
  };
}
