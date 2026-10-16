// Canvas display formatting (project-unit aware). Pure, no React.
// Stored engine values are IMPERIAL (CFM, Btu/h, inches, FPM); convert here at the display boundary.
import { LPS_PER_CFM, W_PER_BTUH, MM_PER_IN, isImperial } from '../engine/units';

const MPS_PER_FPM = 0.00508;
const num = (v: number): number => (Number.isFinite(v) ? v : 0);
const group = (v: number): string => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Airflow from CFM: "123 CFM" | "58 L/s". */
export function formatAirflow(cfm: number, units: string | undefined): string {
  return isImperial(units) ? `${group(num(cfm))} CFM` : `${group(num(cfm) * LPS_PER_CFM)} L/s`;
}

/** Load from Btu/h: "22,186 Btu/h" | "6.50 kW". */
export function formatLoad(btuh: number, units: string | undefined): string {
  return isImperial(units) ? `${group(num(btuh))} Btu/h` : `${((num(btuh) * W_PER_BTUH) / 1000).toFixed(2)} kW`;
}

const mm50 = (inch: number): number => Math.max(50, Math.round((inch * MM_PER_IN) / 50) * 50);
const inTxt = (v: number): string => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));

/** Duct size from inches: 14"x10" | 350x250 (mm rounded to 50). Round: Ø12" | Ø300. */
export function formatDuctSize(widthIn: number, heightIn: number, units: string | undefined, round = false): string {
  if (round) return isImperial(units) ? `Ø${inTxt(widthIn)}"` : `Ø${mm50(widthIn)}`;
  return isImperial(units) ? `${inTxt(widthIn)}"x${inTxt(heightIn)}"` : `${mm50(widthIn)}x${mm50(heightIn)}`;
}

/** Terminal face size without unit marks (tag line 2): 18x18 | 600x600. */
export function formatTerminalSize(widthIn: number, heightIn: number, units: string | undefined): string {
  return isImperial(units)
    ? `${inTxt(widthIn)}x${inTxt(heightIn)}`
    : `${Math.round(widthIn * MM_PER_IN)}x${Math.round(heightIn * MM_PER_IN)}`;
}

/** Velocity from FPM: "800 FPM" | "4.1 m/s". */
export function formatVelocity(fpm: number, units: string | undefined): string {
  return isImperial(units) ? `${group(num(fpm))} FPM` : `${(num(fpm) * MPS_PER_FPM).toFixed(1)} m/s`;
}
