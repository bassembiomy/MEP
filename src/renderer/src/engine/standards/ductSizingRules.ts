import { StandardsProfile, ASHRAE_PROFILE } from './designStandards';

export interface StandardDuctSize {
  widthIn: number;
  heightIn: number;
  areaSqFt: number;
  equivalentDiameterIn: number;
  aspectRatio: number;
}

export interface DuctSizingConstraints {
  role: 'main-trunk' | 'branch' | 'runout' | 'return';
  maxFrictionLossPer100Ft: number;
  maxAspectRatio: number;
  preferredMaxHeightIn: number;
}

// SMACNA Standard Rectangular Dimensions (in.)
const STANDARD_WIDTHS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 44, 48];
const STANDARD_HEIGHTS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

export function getStandardRectangularSizes(): StandardDuctSize[] {
  const sizes: StandardDuctSize[] = [];
  for (const w of STANDARD_WIDTHS) {
    for (const h of STANDARD_HEIGHTS) {
      if (w >= h) {
        const areaSqFt = (w * h) / 144.0;
        // Huebscher formula for equivalent round diameter De = 1.30 * (a * b)^0.625 / (a + b)^0.25
        const de = (1.30 * Math.pow(w * h, 0.625)) / Math.pow(w + h, 0.25);
        sizes.push({
          widthIn: w,
          heightIn: h,
          areaSqFt,
          equivalentDiameterIn: parseFloat(de.toFixed(1)),
          aspectRatio: parseFloat((w / h).toFixed(2))
        });
      }
    }
  }
  return sizes.sort((a, b) => a.areaSqFt - b.areaSqFt);
}

export function getDuctSizingConstraints(
  role: 'main-trunk' | 'branch' | 'runout' | 'return' = 'main-trunk',
  profile: StandardsProfile = ASHRAE_PROFILE
): DuctSizingConstraints {
  return {
    role,
    maxFrictionLossPer100Ft: profile.ductSizing.maxFrictionLossPer100Ft,
    maxAspectRatio: profile.ductSizing.maxAspectRatio,
    preferredMaxHeightIn: profile.ductSizing.preferredMaxHeightIn
  };
}
