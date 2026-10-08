import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';
import { selectEquipmentForLoad, SelectedEquipmentResult } from './equipmentSelector';
import {calculateSolarLoadWeights,type ExteriorWallInfo} from '../zoning/solarLoadWeighting';

export interface MultiUnitCandidate {
  optionId: string;
  unitCount: number;
  unitModel: string;
  nominalTonsPerUnit: number;
  cfmPerUnit: number;
  capacityBtuPerUnit: number;
  totalDeliveredCfm: number;
  totalDeliveredCapacityBtu: number;
  availableEspInWg: number;
  equipmentHeightIn: number;
  meetsCapacity: boolean;
  meetsCfm: boolean;
  totalScore: number;
  scoreBreakdown: {
    capacityMatch: number;
    distributionQuality: number;
    acousticPerformance: number;
    espMargin: number;
    ductEfficiency: number;
    ceilingDepthMatch: number;
    redundancy: number;
    unitPenalty: number;
  };
  selectionRationale: string;
  equipmentDetails: SelectedEquipmentResult;
}

export interface OptimizationInput {
  exteriorWalls?:ExteriorWallInfo[];
  roomName: string;
  sensibleLoadBtu: number;
  totalLoadBtu: number;
  requiredCfm: number;
  roomAreaSqFt: number;
  maxAvailableCeilingDepthIn?: number;
  systemType?: string;
  profile?: StandardsProfile;
}

export interface OptimizationResult {
  roomName: string;
  requiredCfm: number;
  totalLoadBtu: number;
  candidates: MultiUnitCandidate[];
  recommendedOption: MultiUnitCandidate;
}

export function optimizeMultiUnitCandidates(input: OptimizationInput): OptimizationResult {
  const {
    roomName,
    sensibleLoadBtu,
    totalLoadBtu,
    requiredCfm,
    roomAreaSqFt,
    maxAvailableCeilingDepthIn = 14,
    systemType = 'concealed',
    profile: _profile = ASHRAE_PROFILE
  } = input;

  const candidates: MultiUnitCandidate[] = [];
  const testUnitCounts = [1, 2, 3, 4];

  for (const n of testUnitCounts) {
    const peakShare=Math.max(...calculateSolarLoadWeights({unitCount:n,exteriorWalls:input.exteriorWalls}));
    let selection = selectEquipmentForLoad(requiredCfm / n, totalLoadBtu * peakShare, systemType, undefined, {requiredSensibleBtu:sensibleLoadBtu*peakShare,requiredLatentBtu:(totalLoadBtu-sensibleLoadBtu)*peakShare});
    if (!selection) continue;

    let deliveredCfm = selection.supplyCfm * n;
    let deliveredBtu = selection.totalCapacityBtu * n;

    // Greedy single-slot selection can return a combination that is short of the
    // combined load. Step the per-unit requirement up until the aggregate is
    // sufficient (capacity & airflow) or the largest available unit is reached.
    let step = 1.0;
    const meetsLoad = (): boolean =>
      deliveredBtu >= totalLoadBtu && deliveredCfm >= requiredCfm;
    while (!meetsLoad() && step < 5) {
      step += 0.5;
      const next = selectEquipmentForLoad(
        (requiredCfm / n) * step,
        (totalLoadBtu / n) * step,
        systemType, undefined, {requiredSensibleBtu:sensibleLoadBtu/n,requiredLatentBtu:(totalLoadBtu-sensibleLoadBtu)/n}
      );
      if (!next || next.model === selection.model) break;
      selection = next;
      deliveredCfm = selection.supplyCfm * n;
      deliveredBtu = selection.totalCapacityBtu * n;
    }

    // 1. Capacity & airflow match score (0-20 pts)
    const capRatio = deliveredBtu / totalLoadBtu;
    const cfmRatio = deliveredCfm / requiredCfm;
    let capScore = 20 - Math.abs(capRatio - 1.05) * 40 - Math.abs(cfmRatio - 1.05) * 20;
    capScore = Math.max(5, Math.min(20, capScore));

    // 2. Air distribution quality (0-20 pts) - larger areas benefit from multiple injection points
    let distScore = 10;
    if (roomAreaSqFt > 1000) {
      distScore = n >= 2 ? (n === 3 ? 20 : 17) : 8;
    } else if (roomAreaSqFt > 500) {
      distScore = n === 2 ? 20 : (n === 1 ? 14 : 16);
    } else {
      distScore = n === 1 ? 20 : 12;
    }

    // 3. Acoustic performance (0-15 pts) - smaller units generate less localized noise
    let acousticScore = 15;
    if (selection.supplyCfm > 2500) acousticScore = 8;
    else if (selection.supplyCfm > 1500) acousticScore = 11;
    else acousticScore = 15;

    // 4. ESP margin (0-15 pts)
    const espScore = selection.availableEspInWg >= 0.35 ? 15 : (selection.availableEspInWg >= 0.25 ? 12 : 8);

    // 5. Duct efficiency (0-15 pts) - shorter duct runs with multi-unit layout
    let ductScore = 12;
    if (n >= 3) ductScore = 15;
    else if (n === 2) ductScore = 13;
    else ductScore = 9;

    // 6. Ceiling depth compatibility (0-10 pts)
    const eqHeight = selection.dimensionsIn.height || 10;
    const ceilingScore = eqHeight <= maxAvailableCeilingDepthIn ? 10 : 2;

    // 7. Redundancy (0-10 pts)
    const redundancyScore = n >= 3 ? 10 : (n === 2 ? 8 : 2);

    // 8. Unit count penalty (0 to -15 pts for complexity/cost)
    const unitPenalty = (n - 1) * 3.5;

    const totalScore = parseFloat(
      (capScore + distScore + acousticScore + espScore + ductScore + ceilingScore + redundancyScore - unitPenalty).toFixed(1)
    );

    const meetsCapacity = deliveredBtu >= totalLoadBtu;
    const meetsCfm = deliveredCfm >= requiredCfm;

    const rationale = `${n} × ${selection.model} (${selection.nominalTons} TR, ${selection.supplyCfm} CFM each) -> Total ${deliveredCfm} CFM, Score: ${totalScore}`;

    candidates.push({
      optionId: `option-${n}-unit`,
      unitCount: n,
      unitModel: selection.model,
      nominalTonsPerUnit: selection.nominalTons,
      cfmPerUnit: selection.supplyCfm,
      capacityBtuPerUnit: selection.totalCapacityBtu,
      totalDeliveredCfm: deliveredCfm,
      totalDeliveredCapacityBtu: deliveredBtu,
      availableEspInWg: selection.availableEspInWg,
      equipmentHeightIn: eqHeight,
      meetsCapacity,
      meetsCfm,
      totalScore,
      scoreBreakdown: {
        capacityMatch: parseFloat(capScore.toFixed(1)),
        distributionQuality: parseFloat(distScore.toFixed(1)),
        acousticPerformance: parseFloat(acousticScore.toFixed(1)),
        espMargin: parseFloat(espScore.toFixed(1)),
        ductEfficiency: parseFloat(ductScore.toFixed(1)),
        ceilingDepthMatch: parseFloat(ceilingScore.toFixed(1)),
        redundancy: parseFloat(redundancyScore.toFixed(1)),
        unitPenalty: parseFloat(unitPenalty.toFixed(1))
      },
      selectionRationale: rationale,
      equipmentDetails: selection
    });
  }

  // Sort candidates by total score descending
  candidates.sort((a, b) => b.totalScore - a.totalScore);

  // Recommend the highest-scoring feasible option (must satisfy load & airflow).
  const feasible = candidates.filter((c) => c.meetsCapacity && c.meetsCfm);
  if (!feasible.length) throw new Error('No feasible multi-unit equipment satisfies total, sensible, latent capacity and airflow.');
  const recommended = feasible[0];

  return {
    roomName,
    requiredCfm,
    totalLoadBtu,
    candidates,
    recommendedOption: recommended
  };
}
