import { SteppedDuctSection } from './steppedDuctRouter';

export interface FittingLossDetail {
  fittingType: 'elbow' | 'transition' | 'takeoff-branch' | 'terminal-boot' | 'collar';
  lossCoefficientC: number;
  velocityPressureInWg: number;
  lossInWg: number;
}

/** Loss coefficients C (dimensionless, x velocity pressure) - ASHRAE Duct Fitting Database class values */
export const FITTING_COEFFICIENTS = {
  /** 90 deg rectangular elbow with turning vanes */
  elbow90: 0.25,
  /** 90 deg rectangular tee / takeoff, branch leg (rectangular main, conical/straight takeoff) */
  teeBranch: 0.35,
  /** Straight-through leg of a tee / gradual reducer (< 15 deg) */
  teeThrough: 0.10
} as const;

export interface SectionFittingCounts {
  elbows: number;
  teeBranches: number;
  transitions: number;
}

export function velocityPressureInWg(velocityFpm: number): number {
  return velocityFpm > 0 ? Math.pow(velocityFpm / 4005, 2) : 0;
}

/**
 * Fitting at the START of a section (its junction with the parent):
 *  - perpendicular takeoff off a trunk  -> tee branch
 *  - straight continuation after a takeoff/step -> reducer / tee straight-through
 *  - first piece at the unit -> none (equipment collar loss is inside the unit ESP)
 */
export function junctionFitting(
  section: SteppedDuctSection,
  parent: SteppedDuctSection | undefined
): { kind: 'none' | 'tee-branch' | 'elbow' | 'transition'; c: number; counts: SectionFittingCounts } {
  if (!parent) return { kind: 'none', c: 0, counts: { elbows: 0, teeBranches: 0, transitions: 0 } };
  const sOrient = Math.abs(section.endPoint.x - section.startPoint.x) >= Math.abs(section.endPoint.y - section.startPoint.y) ? 'h' : 'v';
  const pOrient = Math.abs(parent.endPoint.x - parent.startPoint.x) >= Math.abs(parent.endPoint.y - parent.startPoint.y) ? 'h' : 'v';
  if (sOrient !== pOrient) {
    // A turn with nothing else leaving the node (e.g. unit collar stub -> trunk) is a plain 90 deg elbow
    if (parent.childDuctIds.length <= 1 && (parent.directDiffusers?.length ?? 0) === 0) {
      return { kind: 'elbow', c: FITTING_COEFFICIENTS.elbow90, counts: { elbows: 1, teeBranches: 0, transitions: 0 } };
    }
    return { kind: 'tee-branch', c: FITTING_COEFFICIENTS.teeBranch, counts: { elbows: 0, teeBranches: 1, transitions: 0 } };
  }
  const sizeChanged = parent.widthIn !== section.widthIn || parent.heightIn !== section.heightIn;
  // Branch chains (series runouts) turn nowhere; trunk continuation across a takeoff gets the straight-through loss
  if (sizeChanged || parent.childDuctIds.length > 1 || (parent.directDiffusers?.length ?? 0) > 0) {
    return { kind: 'transition', c: FITTING_COEFFICIENTS.teeThrough, counts: { elbows: 0, teeBranches: 0, transitions: 1 } };
  }
  return { kind: 'none', c: 0, counts: { elbows: 0, teeBranches: 0, transitions: 0 } };
}

/**
 * Loss of the final connection of a terminal: the elbow/boot into the diffuser, plus a takeoff
 * collar when the terminal sits directly on the trunk line.
 */
export function terminalConnectionLoss(
  section: SteppedDuctSection
): { lossInWg: number; elbows: number; teeBranches: number } {
  const vp = velocityPressureInWg(section.velocityFpm);
  const onTrunk = section.role === 'main-trunk';
  const c = FITTING_COEFFICIENTS.elbow90 + (onTrunk ? FITTING_COEFFICIENTS.teeBranch : 0);
  return {
    lossInWg: parseFloat((c * vp).toFixed(4)),
    elbows: 1,
    teeBranches: onTrunk ? 1 : 0
  };
}

/** Sets junction fitting loss / kind on every section of a (sized) tree. Returns new sections. */
export function applyJunctionFittings(sections: SteppedDuctSection[]): SteppedDuctSection[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  return sections.map((s) => {
    const parent = s.parentDuctId ? byId.get(s.parentDuctId) : undefined;
    const j = junctionFitting(s, parent);
    const fittingLoss = parseFloat((j.c * velocityPressureInWg(s.velocityFpm)).toFixed(4));
    return {
      ...s,
      junctionKind: j.kind,
      fittingLossInWg: fittingLoss,
      totalSectionLossInWg: parseFloat(
        ((s.frictionLossPer100Ft * Math.hypot(s.endPoint.x - s.startPoint.x, s.endPoint.y - s.startPoint.y)) / 100 + fittingLoss).toFixed(4)
      )
    };
  });
}

/** Total fitting loss (in. wg) of a network: every junction plus every terminal connection, counted once. */
export function calculateFittingLosses(sections: SteppedDuctSection[]): number {
  let totalLoss = 0;
  const byId = new Map(sections.map((s) => [s.id, s]));

  for (const s of sections) {
    const parent = s.parentDuctId ? byId.get(s.parentDuctId) : undefined;
    const j = junctionFitting(s, parent);
    totalLoss += j.c * velocityPressureInWg(s.velocityFpm);
    const direct = s.directDiffusers ?? (s.childDuctIds.length === 0 ? s.connectedDiffusers : []);
    if (direct.length > 0) {
      totalLoss += terminalConnectionLoss(s).lossInWg * direct.length;
    }
  }

  return parseFloat(totalLoss.toFixed(4));
}
