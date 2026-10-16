import { SMACNA_GAUGE_TABLE } from './knowledgeBase';
import {
  frictionRateExact,
  equivalentDiameterForFriction,
  rectangularEquivalentDiameter
} from './ducts/ductPressureCalculator';
import {
  MM_PER_IN,
  CFM_PER_LPS,
  FPM_PER_MPS,
  INWG100FT_PER_PA_PER_M,
  IMPERIAL_STEP_IN,
  IMPERIAL_MIN_DIM_IN,
  METRIC_STEP_MM,
  METRIC_MIN_DIM_MM,
  MAX_DUCT_SIDE_IN,
  HARD_MAX_ASPECT_RATIO,
  DEFAULT_FRICTION_RATE_INWG_100FT
} from './ducts/ductUnits';

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
  /** Design criteria that could not be satisfied (empty when fully compliant). */
  warnings?: string[];
}

// ---------------------------------------------------------------------------------------------
// Core rectangular selection (shared by ductSizer, acousticDuctEngine, aerodynamicDuctSizer)
// ---------------------------------------------------------------------------------------------

export interface RectSelectionRequest {
  cfm: number;
  /** Friction ceiling, in.wg/100ft */
  maxFrictionInWgPer100Ft: number;
  /** Velocity ceiling, fpm (omit for friction-only sizing) */
  maxVelocityFpm?: number;
  /** Preferred (smallest) depth, in */
  startDepthIn: number;
  /** Maximum depth (ceiling space), in */
  maxDepthIn: number;
  /** Size increment, in (2 in imperial, 50 mm metric) */
  stepIn?: number;
  /** Minimum side, in */
  minDimIn?: number;
  maxAspectRatio?: number;
  maxSideIn?: number;
}

export interface RectSelectionResult {
  widthIn: number;
  heightIn: number;
  equivalentRoundIn: number;
  velocityFpm: number;
  frictionRateInWgPer100Ft: number;
  aspectRatio: number;
  meetsFriction: boolean;
  meetsVelocity: boolean;
  meetsAspect: boolean;
  meetsDepth: boolean;
  warnings: string[];
}

function onGrid(valueIn: number, stepIn: number, minIn: number, mode: 'ceil' | 'floor'): number {
  const eps = 1e-6;
  const n = mode === 'ceil' ? Math.ceil(valueIn / stepIn - eps) : Math.floor(valueIn / stepIn + eps);
  return Math.max(minIn, n * stepIn);
}

/**
 * Selects the smallest standard rectangular duct that satisfies BOTH the friction ceiling and the
 * velocity ceiling, with aspect ratio <= maxAspectRatio, searching depth upward from the preferred
 * depth until the maximum available depth. When the criteria cannot all be met inside the depth,
 * the duct with the largest area that fits the depth is returned and the violations are flagged.
 */
export function selectRectangularDuct(req: RectSelectionRequest): RectSelectionResult {
  const step = req.stepIn ?? IMPERIAL_STEP_IN;
  const minDim = req.minDimIn ?? IMPERIAL_MIN_DIM_IN;
  const maxAspect = req.maxAspectRatio ?? HARD_MAX_ASPECT_RATIO;
  const maxSide = req.maxSideIn ?? MAX_DUCT_SIDE_IN;
  const cfm = req.cfm;
  const fTarget = req.maxFrictionInWgPer100Ft;
  const vMax = req.maxVelocityFpm ?? Infinity;
  const eps = 1e-9;

  const maxDepth = Math.max(minDim, onGrid(req.maxDepthIn, step, minDim, 'floor'));
  const startDepth = Math.min(maxDepth, onGrid(req.startDepthIn, step, minDim, 'ceil'));

  const evaluate = (w: number, h: number): RectSelectionResult => {
    const de = rectangularEquivalentDiameter(w, h);
    const friction = frictionRateExact(cfm, de);
    const velocity = cfm / ((w * h) / 144);
    const aspect = Math.max(w, h) / Math.min(w, h);
    const meetsFriction = friction <= fTarget + eps;
    const meetsVelocity = velocity <= vMax + eps;
    const meetsAspect = aspect <= maxAspect + eps;
    const warnings: string[] = [];
    if (!meetsFriction) warnings.push(`Friction ${friction.toFixed(3)} in.wg/100ft exceeds ${fTarget.toFixed(3)}`);
    if (!meetsVelocity) warnings.push(`Velocity ${Math.round(velocity)} fpm exceeds ${Math.round(vMax)} fpm`);
    if (!meetsAspect) warnings.push(`Aspect ratio ${aspect.toFixed(1)}:1 exceeds ${maxAspect}:1`);
    return {
      widthIn: w,
      heightIn: h,
      equivalentRoundIn: de,
      velocityFpm: Math.round(velocity),
      frictionRateInWgPer100Ft: friction,
      aspectRatio: Math.round(aspect * 10) / 10,
      meetsFriction,
      meetsVelocity,
      meetsAspect,
      meetsDepth: h <= maxDepth + eps,
      warnings
    };
  };

  const minWidthFor = (h: number): number | null => {
    for (let w = minDim; w <= maxSide + eps; w += step) {
      const r = evaluate(w, h);
      if (r.meetsFriction && r.meetsVelocity) return w;
    }
    return null;
  };

  // Pass 1: strict (friction, velocity, aspect) with depth escalation
  for (let h = startDepth; h <= maxDepth + eps; h += step) {
    const w = minWidthFor(h);
    if (w === null) continue;
    const r = evaluate(w, h);
    if (r.meetsAspect) return r;
    // Aspect too high at this depth: a deeper duct will fix it (loop continues)
  }

  // Pass 2: depth exhausted. Use the full depth; widen as needed (aspect/side violations flagged).
  const wFull = minWidthFor(maxDepth);
  if (wFull !== null) return evaluate(wFull, maxDepth);

  // Pass 3: cannot satisfy even at the maximum side -> largest area that fits the depth
  return evaluate(onGrid(maxSide, step, minDim, 'floor'), maxDepth);
}

/** Smallest standard round diameter satisfying friction and velocity ceilings. */
export function selectRoundDuct(
  cfm: number,
  maxFrictionInWgPer100Ft: number,
  maxVelocityFpm: number = Infinity,
  stepIn: number = IMPERIAL_STEP_IN,
  minDimIn: number = IMPERIAL_MIN_DIM_IN,
  maxDiameterIn: number = 72
): { diameterIn: number; velocityFpm: number; frictionRateInWgPer100Ft: number; meetsFriction: boolean; meetsVelocity: boolean } {
  const eps = 1e-9;
  let d = minDimIn;
  let result = { diameterIn: d, velocityFpm: 0, frictionRateInWgPer100Ft: 0, meetsFriction: true, meetsVelocity: true };
  while (d <= maxDiameterIn + eps) {
    const friction = frictionRateExact(cfm, d);
    const velocity = cfm / ((Math.PI * d * d) / 4 / 144);
    result = {
      diameterIn: d,
      velocityFpm: Math.round(velocity),
      frictionRateInWgPer100Ft: friction,
      meetsFriction: friction <= maxFrictionInWgPer100Ft + eps,
      meetsVelocity: velocity <= maxVelocityFpm + eps
    };
    if (result.meetsFriction && result.meetsVelocity) return result;
    d += stepIn;
  }
  return result;
}

function gaugeFor(maxDim: number) {
  return SMACNA_GAUGE_TABLE.find((g) => maxDim <= g.maxDimension) || SMACNA_GAUGE_TABLE[SMACNA_GAUGE_TABLE.length - 1];
}

/**
 * Sizes a rectangular duct using the Equal Friction method.
 * Standard 2-inch increments; the result satisfies the friction target AND the velocity limit
 * (whichever demands the larger duct), aspect ratio <= maxAspectRatio (default 4:1) and
 * depth <= maxDepthIn whenever physically possible.
 */
export function sizeDuct(
  cfm: number,
  frictionRate: number = DEFAULT_FRICTION_RATE_INWG_100FT,
  fixedHeight: number = 10,
  maxVelocityFpm: number = 1300,
  maxDepthIn: number = 24,
  maxAspectRatio: number = HARD_MAX_ASPECT_RATIO,
  stepIn: number = IMPERIAL_STEP_IN,
  minDimIn: number = IMPERIAL_MIN_DIM_IN
): DuctSize {
  if (cfm <= 0) {
    return {
      widthIn: minDimIn,
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

  const sel = selectRectangularDuct({
    cfm,
    maxFrictionInWgPer100Ft: frictionRate,
    maxVelocityFpm,
    startDepthIn: fixedHeight,
    maxDepthIn: Math.max(maxDepthIn, fixedHeight),
    stepIn,
    minDimIn,
    maxAspectRatio
  });

  const gaugeInfo = gaugeFor(Math.max(sel.widthIn, sel.heightIn));

  return {
    widthIn: sel.widthIn,
    heightIn: sel.heightIn,
    equivalentRoundIn: Math.round(sel.equivalentRoundIn * 10) / 10,
    velocityFpm: sel.velocityFpm,
    frictionRateInWgPer100Ft: Math.round(sel.frictionRateInWgPer100Ft * 1000) / 1000,
    aspectRatio: sel.aspectRatio,
    thicknessMm: gaugeInfo.thicknessMm,
    gauge: gaugeInfo.gauge,
    isVelocityAcceptable: sel.meetsVelocity,
    warnings: sel.warnings.length ? sel.warnings : undefined
  };
}

/**
 * Sizes a rectangular duct using the Constant Velocity method.
 */
export function sizeDuctConstantVelocity(
  cfm: number,
  targetVelocityFpm: number = 1000,
  fixedHeight: number = 10,
  maxDepthIn: number = 24,
  maxAspectRatio: number = HARD_MAX_ASPECT_RATIO
): DuctSize {
  if (cfm <= 0) {
    return sizeDuct(0, 0.1, fixedHeight);
  }

  const reqAreaSqIn = (cfm / targetVelocityFpm) * 144;
  const maxDepth = Math.max(maxDepthIn, fixedHeight);

  let H = fixedHeight;
  let width = Math.max(IMPERIAL_MIN_DIM_IN, Math.ceil(reqAreaSqIn / H / IMPERIAL_STEP_IN) * IMPERIAL_STEP_IN);
  // Raise depth until aspect ratio <= limit (or depth is exhausted)
  while (Math.max(width, H) / Math.min(width, H) > maxAspectRatio && H + IMPERIAL_STEP_IN <= maxDepth) {
    H += IMPERIAL_STEP_IN;
    width = Math.max(IMPERIAL_MIN_DIM_IN, Math.ceil(reqAreaSqIn / H / IMPERIAL_STEP_IN) * IMPERIAL_STEP_IN);
  }

  const actualAreaSqFt = (width * H) / 144;
  const actualVelocityFpm = Math.round(cfm / actualAreaSqFt);

  const De = rectangularEquivalentDiameter(width, H);
  const frictionRate = frictionRateExact(cfm, De);

  const gaugeInfo = gaugeFor(Math.max(width, H));

  return {
    widthIn: width,
    heightIn: H,
    equivalentRoundIn: Math.round(De * 10) / 10,
    velocityFpm: actualVelocityFpm,
    frictionRateInWgPer100Ft: Math.round(frictionRate * 1000) / 1000,
    aspectRatio: Math.round((Math.max(width, H) / Math.min(width, H)) * 10) / 10,
    thicknessMm: gaugeInfo.thicknessMm,
    gauge: gaugeInfo.gauge,
    isVelocityAcceptable: actualVelocityFpm <= targetVelocityFpm * 1.15
  };
}

/**
 * Sizes a round duct for a given airflow (friction AND velocity limits, 2-inch increments).
 */
export function sizeRoundDuct(
  cfm: number,
  frictionRate: number = DEFAULT_FRICTION_RATE_INWG_100FT,
  maxVelocityFpm: number = 1500
): { diameterIn: number; velocityFpm: number; isVelocityAcceptable: boolean; frictionRateInWgPer100Ft?: number } {
  if (cfm <= 0) return { diameterIn: IMPERIAL_MIN_DIM_IN, velocityFpm: 0, isVelocityAcceptable: true };

  // ASHRAE: De = (0.109136 q^1.9 / f)^(1/5.02); then velocity check
  const deFriction = equivalentDiameterForFriction(cfm, frictionRate);
  const sel = selectRoundDuct(cfm, frictionRate, maxVelocityFpm, IMPERIAL_STEP_IN, Math.max(IMPERIAL_MIN_DIM_IN, Math.ceil(deFriction / IMPERIAL_STEP_IN - 1e-9) * IMPERIAL_STEP_IN));

  return {
    diameterIn: sel.diameterIn,
    velocityFpm: sel.velocityFpm,
    isVelocityAcceptable: sel.meetsVelocity,
    frictionRateInWgPer100Ft: Math.round(sel.frictionRateInWgPer100Ft * 1000) / 1000
  };
}

/**
 * Metric duct sizing helper. Flow in L/s, friction in Pa/m, sides rounded UP to 50 mm.
 */
export function sizeDuctMetric(
  flowLps: number,
  targetFrictionPaM: number = 1.0,
  fixedHeightMm: number = 250,
  maxVelocityMs: number = 1300 / FPM_PER_MPS,
  maxDepthMm: number = 600
): {
  widthMm: number;
  heightMm: number;
  velocityMs: number;
  thicknessMm: number;
  frictionPaM: number;
  warnings?: string[];
} {
  const cfm = flowLps * CFM_PER_LPS;
  const frictionRate = targetFrictionPaM * INWG100FT_PER_PA_PER_M;
  const stepIn = METRIC_STEP_MM / MM_PER_IN;

  if (cfm <= 0) {
    const w = METRIC_MIN_DIM_MM;
    return { widthMm: w, heightMm: Math.ceil(fixedHeightMm / METRIC_STEP_MM) * METRIC_STEP_MM, velocityMs: 0, thicknessMm: 0.55, frictionPaM: 0 };
  }

  const sel = selectRectangularDuct({
    cfm,
    maxFrictionInWgPer100Ft: frictionRate,
    maxVelocityFpm: maxVelocityMs * FPM_PER_MPS,
    startDepthIn: fixedHeightMm / MM_PER_IN,
    maxDepthIn: Math.max(maxDepthMm, fixedHeightMm) / MM_PER_IN,
    stepIn,
    minDimIn: METRIC_MIN_DIM_MM / MM_PER_IN,
    maxAspectRatio: HARD_MAX_ASPECT_RATIO,
    maxSideIn: 2400 / MM_PER_IN
  });

  const toMm = (inches: number) => Math.round(inches * MM_PER_IN / METRIC_STEP_MM) * METRIC_STEP_MM;
  const gaugeInfo = gaugeFor(Math.max(sel.widthIn, sel.heightIn));

  return {
    widthMm: toMm(sel.widthIn),
    heightMm: toMm(sel.heightIn),
    velocityMs: Math.round((sel.velocityFpm / FPM_PER_MPS) * 10) / 10,
    thicknessMm: gaugeInfo.thicknessMm,
    frictionPaM: Math.round((sel.frictionRateInWgPer100Ft / INWG100FT_PER_PA_PER_M) * 1000) / 1000,
    warnings: sel.warnings.length ? sel.warnings : undefined
  };
}
