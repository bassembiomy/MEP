import { SteppedDuctSection } from './steppedDuctRouter';
import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';
import { getAcousticVelocityLimit } from '../standards/acousticRules';
import { selectRectangularDuct, selectRoundDuct } from '../ductSizer';
import { frictionRateExact, rectangularEquivalentDiameter, sectionLengthFt } from './ductPressureCalculator';
import { applyJunctionFittings } from './fittingLossCalculator';
import { HARD_MAX_ASPECT_RATIO, METRIC_STEP_MM, METRIC_MIN_DIM_MM, MM_PER_IN } from './ductUnits';
import { UnitSystem } from '../units';

/** Preferred starting depths (in): trunks 10", branches / runouts 8" (raised as needed up to the ceiling depth). */
const TRUNK_START_DEPTH_IN = 10;
const BRANCH_START_DEPTH_IN = 8;

/** Orders sections so that every parent is sized before its children. */
function parentFirst(sections: SteppedDuctSection[]): SteppedDuctSection[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const done = new Set<string>();
  const out: SteppedDuctSection[] = [];
  const visit = (s: SteppedDuctSection, depth = 0) => {
    if (done.has(s.id) || depth > sections.length) return;
    const p = s.parentDuctId ? byId.get(s.parentDuctId) : undefined;
    if (p) visit(p, depth + 1);
    if (!done.has(s.id)) {
      done.add(s.id);
      out.push(s);
    }
  };
  sections.forEach((s) => visit(s));
  return out;
}

/**
 * Sizes a routed duct network with the ASHRAE equal-friction method constrained by acoustic velocity:
 * each section receives the LARGER of the duct needed by (friction <= profile limit) and
 * (velocity <= limit for its role/NC), aspect ratio <= profile limit (hard cap 4:1), depth <= ceiling depth.
 * Trunk depth is held constant along a trunk run and the trunk width never grows downstream (monotonic).
 * If the ceiling depth makes the criteria unattainable, the largest duct fitting the depth is used and
 * the violation is recorded in `designWarnings` / `meetsDesignCriteria`.
 */
export function sizeDuctNetwork(
  sections: SteppedDuctSection[],
  profile: StandardsProfile = ASHRAE_PROFILE,
  maxAvailableCeilingDepthIn: number = 14,
  units: UnitSystem | string = 'imperial'
): SteppedDuctSection[] {
  const metric = units === 'metric';
  const stepIn = metric ? METRIC_STEP_MM / MM_PER_IN : undefined; // 50 mm grid in metric projects
  const minDimIn = metric ? METRIC_MIN_DIM_MM / MM_PER_IN : undefined; // 150 mm minimum
  const ordered = parentFirst(sections);
  const sizedById = new Map<string, SteppedDuctSection>();
  const childMap = new Map<string, string[]>();
  for (const s of ordered) {
    if (s.parentDuctId) {
      const list = childMap.get(s.parentDuctId) || [];
      list.push(s.id);
      childMap.set(s.parentDuctId, list);
    }
  }

  const frictionTarget = profile.ductSizing.maxFrictionLossPer100Ft;
  const profileAspect = Math.min(profile.ductSizing.maxAspectRatio, HARD_MAX_ASPECT_RATIO);

  for (const s of ordered) {
    const cfm = s.airflowCfm;
    const velocityRole =
      s.systemType === 'return' ? 'return' : s.role === 'main-trunk' ? 'main-trunk' : s.role === 'branch' ? 'branch' : 'runout';
    const allowableVelocity = getAcousticVelocityLimit(velocityRole, s.ncRating || 30, profile).maxVelocityFpm;
    const parent = s.parentDuctId ? sizedById.get(s.parentDuctId) : undefined;
    const warnings: string[] = [];

    let widthIn: number;
    let heightIn: number;
    let eqDiameterIn: number;
    let velocityFpm: number;
    let frictionRate: number;
    let meets = true;

    if (cfm <= 0) {
      widthIn = minDimIn ?? 6;
      heightIn = Math.min(minDimIn ?? 6, maxAvailableCeilingDepthIn);
      eqDiameterIn = rectangularEquivalentDiameter(widthIn, heightIn);
      velocityFpm = 0;
      frictionRate = 0;
    } else if (s.shape === 'round') {
      const sel = selectRoundDuct(cfm, frictionTarget, allowableVelocity);
      widthIn = heightIn = sel.diameterIn;
      eqDiameterIn = sel.diameterIn;
      velocityFpm = sel.velocityFpm;
      frictionRate = sel.frictionRateInWgPer100Ft;
      meets = sel.meetsFriction && sel.meetsVelocity;
      if (!sel.meetsVelocity) warnings.push(`Velocity ${velocityFpm} fpm exceeds ${allowableVelocity} fpm`);
      if (!sel.meetsFriction) warnings.push(`Friction ${frictionRate.toFixed(3)} exceeds ${frictionTarget}`);
    } else {
      const isTrunkRun = s.role === 'main-trunk' && parent && parent.role === 'main-trunk' && parent.systemType === s.systemType;
      const startDepth = isTrunkRun
        ? parent!.heightIn
        : Math.min(s.role === 'main-trunk' ? TRUNK_START_DEPTH_IN : BRANCH_START_DEPTH_IN, maxAvailableCeilingDepthIn);
      const maxDepth = isTrunkRun ? parent!.heightIn : maxAvailableCeilingDepthIn;

      const attempt = (aspect: number) =>
        selectRectangularDuct({
          cfm,
          maxFrictionInWgPer100Ft: frictionTarget,
          maxVelocityFpm: allowableVelocity,
          startDepthIn: startDepth,
          maxDepthIn: maxDepth,
          stepIn,
          minDimIn,
          maxAspectRatio: aspect
        });

      let sel = attempt(profileAspect);
      if (!(sel.meetsFriction && sel.meetsVelocity && sel.meetsAspect)) {
        const relaxed = attempt(HARD_MAX_ASPECT_RATIO);
        const score = (r: typeof sel) => Number(r.meetsFriction) + Number(r.meetsVelocity) + Number(r.meetsAspect);
        if (score(relaxed) >= score(sel)) sel = relaxed;
      }

      widthIn = sel.widthIn;
      heightIn = sel.heightIn;
      // Trunk never grows downstream: width capped at the upstream width, depth identical
      if (isTrunkRun && widthIn > parent!.widthIn) {
        widthIn = parent!.widthIn;
        heightIn = parent!.heightIn;
        warnings.push('Held at upstream trunk size');
      }
      eqDiameterIn = rectangularEquivalentDiameter(widthIn, heightIn);
      velocityFpm = Math.round(cfm / ((widthIn * heightIn) / 144));
      frictionRate = frictionRateExact(cfm, eqDiameterIn);
      meets = sel.meetsFriction && sel.meetsVelocity && sel.meetsAspect && sel.meetsDepth;
      warnings.push(...sel.warnings);
    }

    const lengthFt = sectionLengthFt(s);
    const frictionRounded = parseFloat(frictionRate.toFixed(3));
    const frictionLoss = parseFloat(((frictionRounded * lengthFt) / 100).toFixed(4));

    const out: SteppedDuctSection = {
      ...s,
      widthIn,
      heightIn,
      diameterIn: Math.round(eqDiameterIn * 10) / 10,
      velocityFpm,
      allowableVelocityFpm: allowableVelocity,
      frictionLossPer100Ft: frictionRounded,
      fittingLossInWg: 0,
      totalSectionLossInWg: frictionLoss,
      childDuctIds: childMap.get(s.id) || s.childDuctIds || [],
      meetsDesignCriteria: meets,
      designWarnings: warnings.length ? warnings : undefined
    };
    sizedById.set(s.id, out);
  }

  // Preserve the caller's ordering; add junction fittings (tee branch / transition) from routed geometry
  const sized = sections.map((s) => sizedById.get(s.id)!);
  return applyJunctionFittings(sized);
}
