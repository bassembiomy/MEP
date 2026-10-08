import { STANDARD_DAMPER_CATALOG, STANDARD_FITTING_LOSSES } from '../hvacCatalogs';
import { DamperSpecification, FittingLossDefinition } from '../types';

export interface SelectedDamperResult {
  damper: DamperSpecification;
  fittingLoss: FittingLossDefinition;
  tag: string;
  calculatedDeltaPInWg: number;
  locationDescription: string;
}

/**
 * Selects an appropriate damper from the catalog based on function, duct dimension, and airflow.
 */
export function selectDamperForDuctSection(params: {
  functionType: 'fire-damper' | 'smoke-damper' | 'combination-fire-smoke-damper' | 'volume-control-damper' | 'backdraft-damper' | 'ceiling-radiation-damper';
  widthIn: number;
  heightIn: number;
  cfm: number;
  wallRatingHours?: number;
}): SelectedDamperResult | null {
  const { functionType, widthIn, heightIn, cfm, wallRatingHours = 1.5 } = params;

  // Filter dampers by function type
  let candidates = STANDARD_DAMPER_CATALOG.filter((d) => d.type === functionType);
  if (candidates.length === 0) {
    candidates = STANDARD_DAMPER_CATALOG.filter((d) => d.type.includes('damper'));
  }

  let selected: DamperSpecification | null = null;
  if (functionType === 'fire-damper') {
    if (wallRatingHours >= 3.0) {
      selected = candidates.find((d) => (d.fireRatingHours || 1.5) >= 3.0) || candidates[0];
    } else {
      selected = candidates.find((d) => (d.fireRatingHours || 1.5) >= 1.5) || candidates[0];
    }
  } else {
    selected = candidates[0];
  }

  if (!selected) return null;

  // Calculate duct cross-sectional area and velocity
  const areaSqFt = Math.max(0.1, (widthIn * heightIn) / 144);
  const velocityFpm = cfm / areaSqFt;
  const vpInWg = Math.pow(velocityFpm / 4005, 2);
  const deltaP = selected.lossCoefficientK * vpInWg;

  const fittingLoss = STANDARD_FITTING_LOSSES[selected.type] || {
    type: selected.type as any,
    name: selected.model,
    lossCoefficientK: selected.lossCoefficientK
  };

  let tag = 'VCD';
  if (selected.type === 'fire-damper') tag = `FD-${selected.fireRatingHours || 1.5}HR`;
  if (selected.type === 'combination-fire-smoke-damper') tag = 'FSD';
  if (selected.type === 'smoke-damper') tag = 'SMD';
  if (selected.type === 'ceiling-radiation-damper') tag = 'CRD';
  if (selected.type === 'backdraft-damper') tag = 'BDD';

  return {
    damper: selected,
    fittingLoss,
    tag,
    calculatedDeltaPInWg: Number(deltaP.toFixed(4)),
    locationDescription: `${tag} on ${widthIn}"x${heightIn}" Duct (${cfm} CFM)`
  };
}
