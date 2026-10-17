// Single source of truth for the ceiling-void allowances. The duct sizer (airDistributionEngine) and the section
// check (sections/sectionBuilder) both read these, so a layout the sizer produces always passes the section check.

/** Default ceiling void (slab underside to false ceiling) when the user has not set one: 24 in (600 mm). */
export const DEFAULT_VOID_IN = 24;
/** Hanger / clearance gap between the slab underside and the top of a top-hung duct (in). */
export const HANGER_GAP_IN = 2;
/** Minimum clearance of a duct top below the slab underside (in). */
export const SLAB_CLEARANCE_IN = 1;
/** Diffuser plenum / neck allowance (in) between the duct bottom and the false ceiling in a normal void. */
export const NECK_ALLOWANCE_IN = 8;
/** Side-entry / low-profile plenum allowance (in) used for runouts in a shallow void. */
export const LOW_PROFILE_NECK_ALLOWANCE_IN = 4;
/** Voids shallower than this use side-entry low-profile plenums (in). */
export const LOW_PROFILE_VOID_IN = 18;
/** Smallest duct depth the sizer will ever use (in). */
export const MIN_DUCT_DEPTH_IN = 4;

/** Diffuser plenum / neck allowance for a void of `voidIn` inches. */
export function neckAllowanceFor(voidIn: number): number {
  return voidIn >= LOW_PROFILE_VOID_IN ? NECK_ALLOWANCE_IN : LOW_PROFILE_NECK_ALLOWANCE_IN;
}

/** Deepest duct (in) that fits a void with its hanger gap and the diffuser plenum allowance below it. */
export function maxDuctDepthForVoid(voidIn: number): number {
  const v = Number.isFinite(voidIn) && voidIn > 0 ? voidIn : DEFAULT_VOID_IN;
  return Math.max(MIN_DUCT_DEPTH_IN, v - HANGER_GAP_IN - neckAllowanceFor(v));
}
