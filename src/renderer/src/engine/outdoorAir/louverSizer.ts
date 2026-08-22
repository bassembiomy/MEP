import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';

export interface IntakeLouverItem {
  id: string;
  manufacturer: string;
  model: string;
  grossWidthIn: number;
  grossHeightIn: number;
  grossAreaSqFt: number;
  freeAreaPercent: number;
  freeAreaSqFt: number;
  designCfm: number;
  freeAreaVelocityFpm: number;
  maxAllowableFreeAreaVelocityFpm: number;
  pressureDropInWg: number;
  waterPenetrationRatingMph: number;
}

export function sizeOutdoorAirLouver(
  designCfm: number,
  profile: StandardsProfile = ASHRAE_PROFILE,
  customMaxFreeAreaVelocityFpm?: number
): IntakeLouverItem {
  const maxVelocity = customMaxFreeAreaVelocityFpm || profile.velocityLimits.outdoorAirLouverFreeArea || 500;
  const freeAreaPercent = 0.50; // 50% free area typical for drainable blade louvers

  // Calculate required free area (sq ft)
  const reqFreeAreaSqFt = designCfm / maxVelocity;
  const reqGrossAreaSqFt = reqFreeAreaSqFt / freeAreaPercent;

  // Sizing to nearest standard rectangular louver dimensions (in.)
  // e.g. if gross area = 2.4 sq ft (345 sq in), a 24" x 16" louver = 2.66 sq ft
  const grossWidthIn = Math.max(18, Math.ceil(Math.sqrt(reqGrossAreaSqFt * 144 * 1.33) / 2) * 2);
  const grossHeightIn = Math.max(12, Math.ceil((reqGrossAreaSqFt * 144 / grossWidthIn) / 2) * 2);

  const actualGrossAreaSqFt = parseFloat(((grossWidthIn * grossHeightIn) / 144).toFixed(2));
  const actualFreeAreaSqFt = parseFloat((actualGrossAreaSqFt * freeAreaPercent).toFixed(2));
  const actualVelocityFpm = Math.round(designCfm / actualFreeAreaSqFt);

  // Louver pressure drop deltaP = (V_free / 4005)^2 * C_louver (typically C = 2.2 for stationary drainable blades)
  const deltaP = parseFloat((Math.pow(actualVelocityFpm / 4005, 2) * 2.2).toFixed(3));

  return {
    id: 'LVR-01',
    manufacturer: 'Ruskin / Greenheck',
    model: `ELF375DX ${grossWidthIn}"x${grossHeightIn}"`,
    grossWidthIn,
    grossHeightIn,
    grossAreaSqFt: actualGrossAreaSqFt,
    freeAreaPercent: 50.0,
    freeAreaSqFt: actualFreeAreaSqFt,
    designCfm,
    freeAreaVelocityFpm: actualVelocityFpm,
    maxAllowableFreeAreaVelocityFpm: maxVelocity,
    pressureDropInWg: Math.max(0.02, deltaP),
    waterPenetrationRatingMph: 35
  };
}
