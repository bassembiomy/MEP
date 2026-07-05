import { SMACNA_GAUGE_TABLE } from './knowledgeBase';

export interface DuctSize {
  widthIn: number;
  heightIn: number;
  equivalentRoundIn: number;
  velocityFpm: number;
  thicknessMm: number;
  gauge: number;
}

// Sizes a rectangular duct section based on CFM and friction rate (in. wg / 100 ft)
// Uses the ASHRAE equivalent round diameter formula and Huebscher equivalent rectangular formula
export function sizeDuct(cfm: number, frictionRate: number = 0.1, fixedHeight: number = 10): DuctSize {
  if (cfm <= 0) {
    return { widthIn: 0, heightIn: 0, equivalentRoundIn: 0, velocityFpm: 0, thicknessMm: 0, gauge: 26 };
  }

  // 1. Calculate equivalent round diameter (De) in inches
  // De = 0.63 * (CFM^1.85 / FrictionRate)^0.20
  const De = 0.63 * Math.pow(Math.pow(cfm, 1.85) / frictionRate, 0.20);
  
  // 2. Iterate to find suitable width (W) in 2-inch increments for a given Height (H)
  // Huebscher equation: De = 1.30 * (W * H)^0.625 / (W + H)^0.25
  let width = 6;
  const H = fixedHeight;
  
  while (width < 200) {
    const testDe = 1.30 * Math.pow(width * H, 0.625) / Math.pow(width + H, 0.25);
    if (testDe >= De) {
      break;
    }
    width += 2; // Increments of 2 inches (standard duct fabrication sizing)
  }

  // 3. Calculate velocity (FPM) = CFM / Area (sqft)
  const areaSqFt = (width * H) / 144;
  const velocityFpm = Math.round(cfm / areaSqFt);

  // 4. Look up SMACNA gauge and thickness based on maximum dimension
  const maxDim = Math.max(width, H);
  const gaugeInfo = SMACNA_GAUGE_TABLE.find(g => maxDim <= g.maxDimension) || SMACNA_GAUGE_TABLE[SMACNA_GAUGE_TABLE.length - 1];

  return {
    widthIn: width,
    heightIn: H,
    equivalentRoundIn: Math.round(De * 10) / 10,
    velocityFpm,
    thicknessMm: gaugeInfo.thicknessMm,
    gauge: gaugeInfo.gauge
  };
}

// Sizing metric duct (flow in L/s, target pressure drop in Pa/m)
export function sizeDuctMetric(flowLps: number, targetFrictionPaM: number = 1.0, fixedHeightMm: number = 250): {
  widthMm: number;
  heightMm: number;
  velocityMs: number;
  thicknessMm: number;
} {
  // Convert flow to CFM to use the imperial equations internally
  const cfm = flowLps * 2.119;
  const frictionRate = targetFrictionPaM / 2.262; // 1 Pa/m = ~0.44 in.wg/100ft
  const fixedHeightIn = fixedHeightMm / 25.4;

  const size = sizeDuct(cfm, frictionRate, fixedHeightIn);

  return {
    widthMm: Math.round(size.widthIn * 25.4),
    heightMm: Math.round(size.heightIn * 25.4),
    velocityMs: Math.round((size.velocityFpm * 0.00508) * 10) / 10, // 1 FPM = 0.00508 m/s
    thicknessMm: size.thicknessMm
  };
}
