/**
 * Unit constants and standard-size grids shared by the duct routing / sizing engine.
 * (Engine duct functions operate in feet / inches / cfm; canvas px are converted by callers.)
 */

export { MM_PER_IN, CFM_PER_LPS, INWG100FT_PER_PA_PER_M } from '../units';
/** 1 m/s = 196.85 fpm */
export const FPM_PER_MPS = 196.85;
export const DEFAULT_PX_PER_FT = 10;

/** Standard imperial rectangular / round duct increment (in) and minimum dimension (in) */
export const IMPERIAL_STEP_IN = 2;
export const IMPERIAL_MIN_DIM_IN = 6;
/** Standard metric increment (mm) and minimum dimension (mm) */
export const METRIC_STEP_MM = 50;
export const METRIC_MIN_DIM_MM = 150;

/** Practical maximum rectangular side (in) */
export const MAX_DUCT_SIDE_IN = 96;
/** Hard upper limit on rectangular aspect ratio (SMACNA/ASHRAE practice: <= 4:1) */
export const HARD_MAX_ASPECT_RATIO = 4;

/** Default equal-friction design rate (in.wg / 100 ft) */
export const DEFAULT_FRICTION_RATE_INWG_100FT = 0.10;
