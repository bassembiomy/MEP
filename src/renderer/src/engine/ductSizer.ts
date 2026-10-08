import { SMACNA_GAUGE_TABLE } from './knowledgeBase';

export interface DuctSize {
  widthIn: number;
  heightIn: number;
  equivalentRoundIn: number;
  velocityFpm: number;
  frictionRateInWgPer100Ft: number;
  aspectRatio: number;
  thicknessMm: number;
  gauge: number;
  isVelocityAcceptable: boolean;
}

/**
 * Sizes a rectangular duct using the Equal Friction method.
 * Sizing is in standard 2-inch increments with aspect ratio control.
 */
export function sizeDuct(
  cfm: number,
  frictionRate: number = 0.10,
  fixedHeight: number = 10,
  maxVelocityFpm: number = 1300
): DuctSize {
  if (cfm <= 0) {
    return {
      widthIn: 6,
      heightIn: fixedHeight,
      equivalentRoundIn: 0,
      velocityFpm: 0,
      frictionRateInWgPer100Ft: 0,
      aspectRatio: 1.0,
      thicknessMm: 0.55,
      gauge: 26,
      isVelocityAcceptable: true
    };
  }

  // 1. Calculate equivalent round diameter (De) in inches
  // De = 0.63 * (CFM^1.85 / FrictionRate)^0.20
  const De = 0.63 * Math.pow(Math.pow(cfm, 1.85) / Math.max(0.01, frictionRate), 0.20);
  
  // 2. Iterate to find suitable width (W) in 2-inch increments for given Height (H)
  // Huebscher equation: De = 1.30 * (W * H)^0.625 / (W + H)^0.25
  let width = 6;
  let H = fixedHeight;
  
  while (width < 200) {
    const testDe = 1.30 * Math.pow(width * H, 0.625) / Math.pow(width + H, 0.25);
    if (testDe >= De) {
      break;
    }
    width += 2;
  }

  // Check aspect ratio; if width/height > 3.5, adjust height upward
  if (width / H > 3.5 && H < 24) {
    H += 2;
    width = 6;
    while (width < 200) {
      const testDe = 1.30 * Math.pow(width * H, 0.625) / Math.pow(width + H, 0.25);
      if (testDe >= De) {
        break;
      }
      width += 2;
    }
  }

  // Ensure velocity does not exceed maxVelocityFpm
  if (maxVelocityFpm > 0) {
    while ((cfm / ((width * H) / 144)) > maxVelocityFpm && width < 200) {
      if (width / H > 3.5 && H < 24) {
        H += 2;
      } else {
        width += 2;
      }
    }
  }

  // 3. Calculate velocity (FPM) = CFM / Area (sqft)
  const areaSqFt = (width * H) / 144;
  const velocityFpm = Math.round(cfm / areaSqFt);

  // 4. Look up SMACNA gauge and thickness
  const maxDim = Math.max(width, H);
  const gaugeInfo = SMACNA_GAUGE_TABLE.find(g => maxDim <= g.maxDimension) || SMACNA_GAUGE_TABLE[SMACNA_GAUGE_TABLE.length - 1];

  return {
    widthIn: width,
    heightIn: H,
    equivalentRoundIn: Math.round(De * 10) / 10,
    velocityFpm,
    frictionRateInWgPer100Ft: frictionRate,
    aspectRatio: Math.round((Math.max(width, H) / Math.min(width, H)) * 10) / 10,
    thicknessMm: gaugeInfo.thicknessMm,
    gauge: gaugeInfo.gauge,
    isVelocityAcceptable: velocityFpm <= maxVelocityFpm
  };
}

/**
 * Sizes a rectangular duct using the Constant Velocity method.
 */
export function sizeDuctConstantVelocity(
  cfm: number,
  targetVelocityFpm: number = 1000,
  fixedHeight: number = 10
): DuctSize {
  if (cfm <= 0) {
    return sizeDuct(0, 0.1, fixedHeight);
  }

  // Area required in sqft = CFM / targetVelocity
  const reqAreaSqFt = cfm / targetVelocityFpm;
  const reqAreaSqIn = reqAreaSqFt * 144;

  let H = fixedHeight;
  let width = Math.ceil(reqAreaSqIn / H / 2) * 2; // Nearest 2 inches
  width = Math.max(6, width);

  if (width / H > 3.5 && H < 24) {
    H += 2;
    width = Math.ceil(reqAreaSqIn / H / 2) * 2;
    width = Math.max(6, width);
  }

  const actualAreaSqFt = (width * H) / 144;
  const actualVelocityFpm = Math.round(cfm / actualAreaSqFt);
  
  // Back-calculate equivalent round diameter & friction rate
  const De = 1.30 * Math.pow(width * H, 0.625) / Math.pow(width + H, 0.25);
  // Friction rate = (0.63 / De)^5 * CFM^1.85
  const frictionRate = Math.pow(0.63 / De, 5) * Math.pow(cfm, 1.85);

  const maxDim = Math.max(width, H);
  const gaugeInfo = SMACNA_GAUGE_TABLE.find(g => maxDim <= g.maxDimension) || SMACNA_GAUGE_TABLE[SMACNA_GAUGE_TABLE.length - 1];

  return {
    widthIn: width,
    heightIn: H,
    equivalentRoundIn: Math.round(De * 10) / 10,
    velocityFpm: actualVelocityFpm,
    frictionRateInWgPer100Ft: Math.round(frictionRate * 100) / 100,
    aspectRatio: Math.round((Math.max(width, H) / Math.min(width, H)) * 10) / 10,
    thicknessMm: gaugeInfo.thicknessMm,
    gauge: gaugeInfo.gauge,
    isVelocityAcceptable: actualVelocityFpm <= targetVelocityFpm * 1.15
  };
}

/**
 * Sizes a round duct for a given airflow.
 */
export function sizeRoundDuct(
  cfm: number,
  frictionRate: number = 0.10,
  maxVelocityFpm: number = 1500
): { diameterIn: number; velocityFpm: number; isVelocityAcceptable: boolean } {
  if (cfm <= 0) return { diameterIn: 6, velocityFpm: 0, isVelocityAcceptable: true };

  const De = 0.63 * Math.pow(Math.pow(cfm, 1.85) / Math.max(0.01, frictionRate), 0.20);
  const diameterIn = Math.max(6, Math.ceil(De / 2) * 2); // 2-inch increments (6, 8, 10, 12, 14, 16...)

  const areaSqFt = (Math.PI * Math.pow(diameterIn / 2, 2)) / 144;
  const velocityFpm = Math.round(cfm / areaSqFt);

  return {
    diameterIn,
    velocityFpm,
    isVelocityAcceptable: velocityFpm <= maxVelocityFpm
  };
}

/**
 * Metric duct sizing helper
 */
export function sizeDuctMetric(
  flowLps: number,
  targetFrictionPaM: number = 1.0,
  fixedHeightMm: number = 250
): {
  widthMm: number;
  heightMm: number;
  velocityMs: number;
  thicknessMm: number;
} {
  const cfm = flowLps * 2.119;
  const frictionRate = targetFrictionPaM / 2.262;
  const fixedHeightIn = fixedHeightMm / 25.4;

  const size = sizeDuct(cfm, frictionRate, fixedHeightIn);

  return {
    widthMm: Math.round((size.widthIn * 25.4) / 25) * 25, // Round to nearest 25 mm
    heightMm: Math.round((size.heightIn * 25.4) / 25) * 25,
    velocityMs: Math.round((size.velocityFpm * 0.00508) * 10) / 10,
    thicknessMm: size.thicknessMm
  };
}
