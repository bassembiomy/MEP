/**
 * HVAC Duct Sizing and Acoustic Noise Design Engine
 * Implements ASHRAE duct-design and noise-control guidance (ASHRAE Fundamentals & HVAC Applications).
 */

import {
  DuctLocationCategory,
  DuctSectionCategory,
  AcousticSensitivity,
  AcousticComplianceStatus,
  DuctAcousticVerification
} from './types';
import { SMACNA_GAUGE_TABLE } from './knowledgeBase';
import { selectRectangularDuct, selectRoundDuct } from './ductSizer';
import { frictionRateExact, rectangularEquivalentDiameter } from './ducts/ductPressureCalculator';
import {
  IMPERIAL_STEP_IN,
  IMPERIAL_MIN_DIM_IN,
  METRIC_STEP_MM,
  METRIC_MIN_DIM_MM,
  MM_PER_IN,
  HARD_MAX_ASPECT_RATIO,
  DEFAULT_FRICTION_RATE_INWG_100FT
} from './ducts/ductUnits';

/**
 * Standard ASHRAE Acoustic Maximum Air Velocity Limits (FPM) for Main Trunks.
 * Branch ducts target ~80%, Runouts target ~50% or less.
 */
export interface AcousticLimitPoint {
  nc: number;
  rectFpm: number;
  roundFpm: number;
}

export const ASHRAE_ACOUSTIC_VELOCITY_TABLE: Record<DuctLocationCategory, AcousticLimitPoint[]> = {
  'in-shaft-solid-ceiling': [
    { nc: 25, rectFpm: 1600, roundFpm: 2500 },
    { nc: 35, rectFpm: 2500, roundFpm: 3500 },
    { nc: 45, rectFpm: 3500, roundFpm: 5000 }
  ],
  'above-suspended-ceiling': [
    { nc: 25, rectFpm: 1100, roundFpm: 2000 },
    { nc: 35, rectFpm: 1750, roundFpm: 3000 },
    { nc: 45, rectFpm: 2500, roundFpm: 4500 }
  ],
  'within-occupied-space': [
    { nc: 25, rectFpm: 950, roundFpm: 1700 },
    { nc: 35, rectFpm: 1450, roundFpm: 2600 },
    { nc: 45, rectFpm: 2000, roundFpm: 3900 }
  ]
};

/**
 * Default NC design target by ASHRAE space type
 */
export const DEFAULT_SPACE_NC_TARGETS: Record<string, { nc: number; name: string; sensitivity: AcousticSensitivity }> = {
  office: { nc: 32, name: 'Office Space (General)', sensitivity: 'standard' },
  conference: { nc: 28, name: 'Conference Room', sensitivity: 'enhanced' },
  classroom: { nc: 28, name: 'Classroom (Ages 9+)', sensitivity: 'enhanced' },
  'computer-lab': { nc: 40, name: 'Computer Laboratory', sensitivity: 'standard' },
  'restaurant-dining': { nc: 38, name: 'Restaurant Dining Area', sensitivity: 'standard' },
  lobby: { nc: 35, name: 'Hotel Lobby', sensitivity: 'standard' },
  breakroom: { nc: 35, name: 'Break Room / Lounge', sensitivity: 'standard' },
  retail: { nc: 40, name: 'Retail Store', sensitivity: 'standard' },
  auditorium: { nc: 25, name: 'Auditorium / Studio', sensitivity: 'critical' },
  hospital: { nc: 30, name: 'Hospital Patient Room', sensitivity: 'enhanced' }
};

/**
 * Section type velocity multipliers:
 * - Main / Trunk: 1.0 (100%)
 * - Branch: 0.8 (80%)
 * - Runout: 0.5 (50%)
 * - Return: 0.8 (80%)
 */
export function getSectionVelocityMultiplier(sectionCategory: DuctSectionCategory): number {
  switch (sectionCategory) {
    case 'trunk':
      return 1.0;
    case 'branch':
      return 0.8;
    case 'runout':
      return 0.5;
    case 'return':
      return 0.8;
    default:
      return 0.8;
  }
}

/**
 * Calculates the maximum allowable acoustic velocity (FPM) based on:
 * - Location category
 * - Room design NC/RC target
 * - Duct geometry (shape)
 * - Section category (trunk, branch, runout)
 * - Acoustic sensitivity / enhanced performance flag
 */
export function calculateAllowableAcousticVelocity(
  locationCategory: DuctLocationCategory = 'above-suspended-ceiling',
  targetNc: number = 32,
  shape: 'rectangular' | 'round' | 'oval' | 'flex' = 'rectangular',
  sectionCategory: DuctSectionCategory = 'trunk',
  enhancedPerformance: boolean = false
): number {
  // Adjust NC if enhanced performance is requested
  const effectiveNc = enhancedPerformance ? Math.max(20, targetNc - 3) : targetNc;

  const table = ASHRAE_ACOUSTIC_VELOCITY_TABLE[locationCategory] || ASHRAE_ACOUSTIC_VELOCITY_TABLE['above-suspended-ceiling'];
  const isRound = shape === 'round' || shape === 'flex';

  let baseMaxFpm = 1100;

  if (effectiveNc <= table[0].nc) {
    baseMaxFpm = isRound ? table[0].roundFpm : table[0].rectFpm;
  } else if (effectiveNc >= table[table.length - 1].nc) {
    baseMaxFpm = isRound ? table[table.length - 1].roundFpm : table[table.length - 1].rectFpm;
  } else {
    // Piecewise linear interpolation between bracket points
    for (let i = 0; i < table.length - 1; i++) {
      const p1 = table[i];
      const p2 = table[i + 1];
      if (effectiveNc >= p1.nc && effectiveNc <= p2.nc) {
        const factor = (effectiveNc - p1.nc) / (p2.nc - p1.nc);
        const v1 = isRound ? p1.roundFpm : p1.rectFpm;
        const v2 = isRound ? p2.roundFpm : p2.rectFpm;
        baseMaxFpm = v1 + factor * (v2 - v1);
        break;
      }
    }
  }

  // Apply section factor (Main 100%, Branch 80%, Runout 50%)
  const sectionMultiplier = getSectionVelocityMultiplier(sectionCategory);
  const result = Math.round(baseMaxFpm * sectionMultiplier);

  return result;
}

export interface AcousticSizingResult {
  shape: 'rectangular' | 'round';
  widthIn: number;
  heightIn: number;
  diameterIn: number;
  equivalentRoundIn: number;
  areaSqFt: number;
  actualVelocityFpm: number;
  allowableAcousticVelocityFpm: number;
  frictionRateInWgPer100Ft: number;
  aspectRatio: number;
  gauge: number;
  thicknessMm: number;
  isCompliant: boolean;
  warnings: string[];
}

/**
 * Sizes a duct section strictly respecting acoustic velocity limits and aspect ratio.
 */
export function sizeDuctAcoustically(
  cfm: number,
  options: {
    locationCategory?: DuctLocationCategory;
    targetNc?: number;
    sectionCategory?: DuctSectionCategory;
    shape?: 'rectangular' | 'round';
    fixedHeightIn?: number;
    maxAspectRatio?: number;
    enhancedPerformance?: boolean;
    /** Equal-friction ceiling, in.wg/100ft (default 0.10). Sizing satisfies BOTH this and the acoustic velocity limit. */
    frictionRateTarget?: number;
    /** Maximum available duct depth (ceiling space), in. Default 24. */
    maxDepthIn?: number;
    /** 'metric' uses 50 mm size increments; default 'imperial' uses 2 in. */
    units?: 'imperial' | 'metric';
  } = {}
): AcousticSizingResult {
  const {
    locationCategory = 'above-suspended-ceiling',
    targetNc = 32,
    sectionCategory = 'trunk',
    shape = 'rectangular',
    fixedHeightIn = 10,
    maxAspectRatio = HARD_MAX_ASPECT_RATIO,
    enhancedPerformance = false,
    frictionRateTarget = DEFAULT_FRICTION_RATE_INWG_100FT,
    maxDepthIn = 24,
    units = 'imperial'
  } = options;
  const stepIn = units === 'metric' ? METRIC_STEP_MM / MM_PER_IN : IMPERIAL_STEP_IN;
  const minDimIn = units === 'metric' ? METRIC_MIN_DIM_MM / MM_PER_IN : IMPERIAL_MIN_DIM_IN;

  const allowableVelocity = calculateAllowableAcousticVelocity(
    locationCategory,
    targetNc,
    shape,
    sectionCategory,
    enhancedPerformance
  );

  const warnings: string[] = [];

  if (cfm <= 0) {
    return {
      shape,
      widthIn: 6,
      heightIn: fixedHeightIn,
      diameterIn: 6,
      equivalentRoundIn: 6,
      areaSqFt: (6 * fixedHeightIn) / 144,
      actualVelocityFpm: 0,
      allowableAcousticVelocityFpm: allowableVelocity,
      frictionRateInWgPer100Ft: 0,
      aspectRatio: 1.0,
      gauge: 26,
      thicknessMm: 0.55,
      isCompliant: true,
      warnings: []
    };
  }

  if (shape === 'round') {
    // Round duct: smallest standard diameter satisfying BOTH friction target and acoustic velocity limit
    const sel = selectRoundDuct(cfm, frictionRateTarget, allowableVelocity, stepIn, minDimIn);
    const diameterIn = sel.diameterIn;
    const areaSqFt = (Math.PI * Math.pow(diameterIn / 2, 2)) / 144;
    const gaugeInfo = SMACNA_GAUGE_TABLE.find((g) => diameterIn <= g.maxDimension) || SMACNA_GAUGE_TABLE[SMACNA_GAUGE_TABLE.length - 1];
    if (!sel.meetsVelocity) {
      warnings.push(`Velocity (${sel.velocityFpm} FPM) exceeds acoustic limit (${allowableVelocity} FPM)`);
    }
    if (!sel.meetsFriction) {
      warnings.push(`Friction (${sel.frictionRateInWgPer100Ft.toFixed(3)} in.wg/100ft) exceeds target (${frictionRateTarget})`);
    }

    return {
      shape: 'round',
      widthIn: diameterIn,
      heightIn: diameterIn,
      diameterIn,
      equivalentRoundIn: diameterIn,
      areaSqFt: Math.round(areaSqFt * 1000) / 1000,
      actualVelocityFpm: sel.velocityFpm,
      allowableAcousticVelocityFpm: allowableVelocity,
      frictionRateInWgPer100Ft: Math.round(sel.frictionRateInWgPer100Ft * 1000) / 1000,
      aspectRatio: 1.0,
      gauge: gaugeInfo.gauge,
      thicknessMm: gaugeInfo.thicknessMm,
      isCompliant: sel.meetsVelocity,
      warnings
    };
  }

  // Rectangular duct: the LARGER of the friction-driven and velocity-driven sizes, aspect <= limit,
  // depth <= maxDepthIn (aspect relaxed, and flagged, only if the depth cannot accommodate it).
  const sel = selectRectangularDuct({
    cfm,
    maxFrictionInWgPer100Ft: frictionRateTarget,
    maxVelocityFpm: allowableVelocity,
    startDepthIn: fixedHeightIn,
    maxDepthIn: Math.max(maxDepthIn, fixedHeightIn),
    stepIn,
    minDimIn,
    maxAspectRatio
  });
  const W = sel.widthIn;
  const H = sel.heightIn;
  const actualAreaSqFt = (W * H) / 144;
  const actualVelocityFpm = sel.velocityFpm;
  const De = sel.equivalentRoundIn;
  const frictionRate = sel.frictionRateInWgPer100Ft;
  const ar = sel.aspectRatio;

  const maxDim = Math.max(W, H);
  const gaugeInfo = SMACNA_GAUGE_TABLE.find((g) => maxDim <= g.maxDimension) || SMACNA_GAUGE_TABLE[SMACNA_GAUGE_TABLE.length - 1];

  const isCompliant = sel.meetsVelocity;
  if (!sel.meetsVelocity) {
    warnings.push(`Velocity (${actualVelocityFpm} FPM) exceeds acoustic limit (${allowableVelocity} FPM)`);
  }
  if (!sel.meetsFriction) {
    warnings.push(`Friction (${frictionRate.toFixed(3)} in.wg/100ft) exceeds target (${frictionRateTarget}); duct depth is limited to ${maxDepthIn}"`);
  }
  if (!sel.meetsAspect) {
    warnings.push(`Aspect ratio ${ar}:1 exceeds ${maxAspectRatio}:1 (limited by ${maxDepthIn}" available depth)`);
  }
  if (actualVelocityFpm > allowableVelocity * 0.90 && isCompliant) {
    warnings.push(`Velocity is within 10% of allowable acoustic limit; ensure smooth transitions and radius elbows`);
  }

  return {
    shape: 'rectangular',
    widthIn: W,
    heightIn: H,
    diameterIn: Math.round(De),
    equivalentRoundIn: Math.round(De * 10) / 10,
    areaSqFt: Math.round(actualAreaSqFt * 1000) / 1000,
    actualVelocityFpm,
    allowableAcousticVelocityFpm: allowableVelocity,
    frictionRateInWgPer100Ft: Math.round(frictionRate * 1000) / 1000,
    aspectRatio: ar,
    gauge: gaugeInfo.gauge,
    thicknessMm: gaugeInfo.thicknessMm,
    isCompliant,
    warnings
  };
}

/**
 * 10-Step Mandatory Noise and Velocity Verification Routine for a duct section.
 */
export function verifyDuctSectionAcoustics(
  duct: {
    id: string;
    type?: string;
    widthIn: number;
    heightIn: number;
    cfm: number;
    velocityFpm?: number;
    shape?: 'rectangular' | 'round' | 'oval' | 'flex';
    diameterIn?: number;
    sectionCategory?: DuctSectionCategory;
    /** Actual section length (ft). Defaults to a 12 ft estimate. */
    lengthFt?: number;
  },
  zoneContext: {
    zoneName: string;
    targetNc?: number;
    locationCategory?: DuctLocationCategory;
    enhancedPerformance?: boolean;
    availableStaticPressureInWg?: number;
  }
): DuctAcousticVerification {
  const cfm = duct.cfm || 0;
  const targetNc = zoneContext.targetNc || 32;
  const locationCategory = zoneContext.locationCategory || 'above-suspended-ceiling';
  const sectionCategory: DuctSectionCategory =
    duct.sectionCategory ||
    (duct.type === 'trunk' ? 'trunk' : duct.type === 'return' ? 'return' : 'branch');

  const shape = duct.shape || (duct.diameterIn && duct.diameterIn > 0 ? 'round' : 'rectangular');

  // Step 4: Allowable maximum velocity
  const allowableVelocity = calculateAllowableAcousticVelocity(
    locationCategory,
    targetNc,
    shape,
    sectionCategory,
    zoneContext.enhancedPerformance
  );

  // Step 5 & 6 & 7: Area & Velocity calculation
  const widthIn = duct.widthIn || 6;
  const heightIn = duct.heightIn || 10;
  const diameterIn = duct.diameterIn;
  let areaSqFt = 0;
  let dimsLabel = '';

  if (shape === 'round' && diameterIn) {
    areaSqFt = (Math.PI * Math.pow(diameterIn / 2, 2)) / 144;
    dimsLabel = `Ø${diameterIn}"`;
  } else {
    areaSqFt = (widthIn * heightIn) / 144;
    dimsLabel = `${widthIn}"x${heightIn}"`;
  }

  const actualVelocityFpm = areaSqFt > 0 ? Math.round(cfm / areaSqFt) : 0;

  // Step 8: Velocity verification
  const velocityCompliant = actualVelocityFpm <= allowableVelocity;

  // Step 9: Pressure loss calculation
  let de = shape === 'round' && diameterIn ? diameterIn : rectangularEquivalentDiameter(widthIn, heightIn);
  de = Math.max(4, de);
  const frictionRate100Ft = frictionRateExact(cfm, de);
  const sectionLengthFt = duct.lengthFt && duct.lengthFt > 0 ? duct.lengthFt : 12;
  const estimatedDeltaP = (frictionRate100Ft * sectionLengthFt) / 100;

  const warnings: string[] = [];
  let complianceStatus: AcousticComplianceStatus = 'PASS';
  let proposedRemediation: string | undefined = undefined;

  if (!velocityCompliant) {
    complianceStatus = 'REQUIRES REDESIGN';
    warnings.push(`Excessive velocity: ${actualVelocityFpm} FPM exceeds acoustic limit of ${allowableVelocity} FPM`);

    // Propose corrected duct dimensions
    const corrected = sizeDuctAcoustically(cfm, {
      locationCategory,
      targetNc,
      sectionCategory,
      shape: 'rectangular',
      fixedHeightIn: heightIn,
      enhancedPerformance: zoneContext.enhancedPerformance
    });

    const correctedRound = sizeDuctAcoustically(cfm, {
      locationCategory,
      targetNc,
      sectionCategory,
      shape: 'round',
      enhancedPerformance: zoneContext.enhancedPerformance
    });

    proposedRemediation = `Upsize rectangular duct to ${corrected.widthIn}"x${corrected.heightIn}" (${corrected.actualVelocityFpm} FPM) or switch to round duct Ø${correctedRound.diameterIn}" (${correctedRound.actualVelocityFpm} FPM).`;
  } else if (actualVelocityFpm > allowableVelocity * 0.90) {
    warnings.push(`Velocity approaches limit (within 10%). Use long-radius elbows and avoid placing dampers directly upstream of diffusers.`);
  }

  // Extract upstream and downstream node identifiers from ID
  const isTrunk = sectionCategory === 'trunk';
  const upstreamNode = isTrunk ? 'FCU/AHU Supply Plenum' : 'Main Trunk T-Junction';
  const downstreamNode = isTrunk ? 'Branch Takeoff' : `${zoneContext.zoneName} Air Terminal`;

  return {
    ductId: duct.id,
    upstreamNode,
    downstreamNode,
    cfm,
    shape,
    dimensions: {
      widthIn: shape === 'rectangular' ? widthIn : undefined,
      heightIn: shape === 'rectangular' ? heightIn : undefined,
      diameterIn: shape === 'round' ? diameterIn : undefined
    },
    dimensionsLabel: dimsLabel,
    crossSectionalAreaSqFt: Math.round(areaSqFt * 1000) / 1000,
    actualVelocityFpm,
    allowableAcousticVelocityFpm: allowableVelocity,
    targetNc,
    locationCategory,
    sectionCategory,
    pressureLossInWg: Math.round(estimatedDeltaP * 1000) / 1000,
    complianceStatus,
    warnings,
    proposedRemediation
  };
}
