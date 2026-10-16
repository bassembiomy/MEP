// Display formatting helpers (imperial/metric aware). Engine values are IMPERIAL (CFM, Btu/h, ft, in,
// FPM, in.wg); these helpers take imperial values + the project unit system and return clean strings.
// Stable API - also imported by the canvas.
import {
  isImperial,
  LPS_PER_CFM,
  M_PER_FT,
  MM_PER_IN,
  PA_PER_INWG,
  W_PER_BTUH,
  SQFT_PER_SQM,
  type UnitSystem
} from '../engine/units';

type Units = UnitSystem | string | undefined;

const DASH = '—';
const ok = (n: number): boolean => typeof n === 'number' && Number.isFinite(n);
const group = (n: number, digits = 0): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** 123 CFM | 58 L/s */
export function formatAirflow(cfm: number, units: Units): string {
  if (!ok(cfm)) return DASH;
  return isImperial(units) ? `${group(Math.round(cfm))} CFM` : `${group(Math.round(cfm * LPS_PER_CFM))} L/s`;
}

/** 22,186 Btu/h | 6.50 kW */
export function formatLoad(btuh: number, units: Units): string {
  if (!ok(btuh)) return DASH;
  return isImperial(units)
    ? `${group(Math.round(btuh))} Btu/h`
    : `${group((btuh * W_PER_BTUH) / 1000, 2)} kW`;
}

/** 12.5 ft | 3.81 m */
export function formatLength(ft: number, units: Units): string {
  if (!ok(ft)) return DASH;
  return isImperial(units) ? `${group(ft, 1)} ft` : `${group(ft * M_PER_FT, 2)} m`;
}

/** 1,200 ft2 | 111 m2 */
export function formatArea(sqft: number, units: Units): string {
  if (!ok(sqft)) return DASH;
  return isImperial(units) ? `${group(Math.round(sqft))} ft²` : `${group(Math.round(sqft / SQFT_PER_SQM))} m²`;
}

/** 14"x10" | 350x250 mm (rounded to 50 mm) */
export function formatDuctSize(wIn: number, hIn: number, units: Units): string {
  if (!ok(wIn) || !ok(hIn)) return DASH;
  if (isImperial(units)) return `${Math.round(wIn * 10) / 10}"x${Math.round(hIn * 10) / 10}"`;
  const mm = (v: number): number => Math.max(50, Math.round((v * MM_PER_IN) / 50) * 50);
  return `${mm(wIn)}x${mm(hIn)} mm`;
}

/** 1,200 FPM | 6.1 m/s */
export function formatVelocity(fpm: number, units: Units): string {
  if (!ok(fpm)) return DASH;
  return isImperial(units) ? `${group(Math.round(fpm))} FPM` : `${group(fpm * 0.00508, 1)} m/s`;
}

/** 0.123 in.wg | 31 Pa */
export function formatPressure(inWg: number, units: Units): string {
  if (!ok(inWg)) return DASH;
  return isImperial(units) ? `${group(inWg, 3)} in.wg` : `${group(Math.round(inWg * PA_PER_INWG))} Pa`;
}

/** Refrigeration tons from Btu/h (unit-system independent). */
export function formatTons(btuh: number): string {
  return ok(btuh) ? `${group(Math.round((btuh / 12000) * 10) / 10, 1)} TR` : DASH;
}
