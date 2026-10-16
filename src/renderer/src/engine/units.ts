// Single source of truth for unit conversions used by the HVAC engine and canvas.
// Engine internals work in IMPERIAL (ft, ft², CFM, Btu/h, in, in.wg). Convert at the boundaries.

export type UnitSystem = 'imperial' | 'metric';

export const FT_PER_M = 3.28084;
export const M_PER_FT = 0.3048;
export const SQFT_PER_SQM = 10.7639;
export const CFM_PER_LPS = 2.11888;
export const LPS_PER_CFM = 0.471947;
export const BTUH_PER_W = 3.41214;
export const W_PER_BTUH = 0.293071;
export const BTUH_PER_TON = 12000;
export const MM_PER_IN = 25.4;
/** 1 Pa/m = 0.1224 in.wg/100ft */
export const INWG100FT_PER_PA_PER_M = 0.12240;
export const PA_PER_INWG = 249.089;

export const isImperial = (u: UnitSystem | string | undefined): boolean => u !== 'metric';

/** Canvas pixels per foot. `scale` is px per project length unit (ft for imperial, m for metric). */
export function pxPerFt(scale: number, units: UnitSystem | string | undefined): number {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 10;
  return isImperial(units) ? s : s * M_PER_FT;
}

export const pxToFt = (px: number, scale: number, units: UnitSystem | string | undefined): number =>
  px / pxPerFt(scale, units);
export const ftToPx = (ft: number, scale: number, units: UnitSystem | string | undefined): number =>
  ft * pxPerFt(scale, units);
export const inToPx = (inches: number, scale: number, units: UnitSystem | string | undefined): number =>
  (inches / 12) * pxPerFt(scale, units);

/** Convert a flat [x0,y0,x1,y1,...] polygon from canvas px to ft. */
export const polygonPxToFt = (pts: number[], scale: number, units: UnitSystem | string | undefined): number[] => {
  const k = pxPerFt(scale, units);
  return pts.map((v) => v / k);
};
export const polygonFtToPx = (pts: number[], scale: number, units: UnitSystem | string | undefined): number[] => {
  const k = pxPerFt(scale, units);
  return pts.map((v) => v * k);
};

export const toCfm = (airflow: number, units: UnitSystem | string | undefined): number =>
  isImperial(units) ? airflow : airflow * CFM_PER_LPS;
export const toBtuh = (load: number, units: UnitSystem | string | undefined): number =>
  isImperial(units) ? load : load * BTUH_PER_W;
export const toSqFt = (area: number, units: UnitSystem | string | undefined): number =>
  isImperial(units) ? area : area * SQFT_PER_SQM;

/** DXF $INSUNITS code → feet per drawing unit. Returns null when unitless/unknown. */
export function insunitsToFeet(code: number | undefined): number | null {
  switch (code) {
    case 1: return 1 / 12; // inches
    case 2: return 1; // feet
    case 4: return 1 / 304.8; // millimetres
    case 5: return 1 / 30.48; // centimetres
    case 6: return FT_PER_M; // metres
    case 14: return 1 / 3.048; // decimetres
    default: return null;
  }
}
