/**
 * Steel pipe dimensional data (ASME B36.10 Sch 40 / Sch 10) and flanged valve
 * face-to-face lengths used by the pump-room layout.
 * Pure data + helpers; no React / DOM.
 */
import { PipeSchedule } from '../fpTypes';

/** Standard nominal pipe sizes, inches (NFPA 13-2019 Table 28.2.3.1.1 range). */
export const NOMINAL_SIZES_IN = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 14, 16] as const;

export interface PipeDataRow {
  dn: number;
  odIn: number;
  idSch40: number;
  idSch10: number;
}

/** Pipe dimensions by nominal size (inches). */
export const PIPE_DATA: Record<number, PipeDataRow> = {
  0.5: { dn: 15, odIn: 0.84, idSch40: 0.622, idSch10: 0.674 },
  0.75: { dn: 20, odIn: 1.05, idSch40: 0.824, idSch10: 0.884 },
  1: { dn: 25, odIn: 1.315, idSch40: 1.049, idSch10: 1.097 },
  1.25: { dn: 32, odIn: 1.66, idSch40: 1.38, idSch10: 1.442 },
  1.5: { dn: 40, odIn: 1.9, idSch40: 1.61, idSch10: 1.682 },
  2: { dn: 50, odIn: 2.375, idSch40: 2.067, idSch10: 2.157 },
  2.5: { dn: 65, odIn: 2.875, idSch40: 2.469, idSch10: 2.635 },
  3: { dn: 80, odIn: 3.5, idSch40: 3.068, idSch10: 3.26 },
  3.5: { dn: 90, odIn: 4.0, idSch40: 3.548, idSch10: 3.76 },
  4: { dn: 100, odIn: 4.5, idSch40: 4.026, idSch10: 4.26 },
  5: { dn: 125, odIn: 5.563, idSch40: 5.047, idSch10: 5.295 },
  6: { dn: 150, odIn: 6.625, idSch40: 6.065, idSch10: 6.357 },
  8: { dn: 200, odIn: 8.625, idSch40: 7.981, idSch10: 8.329 },
  10: { dn: 250, odIn: 10.75, idSch40: 10.02, idSch10: 10.42 },
  12: { dn: 300, odIn: 12.75, idSch40: 11.938, idSch10: 12.39 },
  14: { dn: 350, odIn: 14.0, idSch40: 13.124, idSch10: 13.5 },
  16: { dn: 400, odIn: 16.0, idSch40: 15.0, idSch10: 15.67 }
};

function row(nominalIn: number): PipeDataRow {
  const r = PIPE_DATA[nominalIn];
  if (!r) throw new Error(`Unsupported nominal pipe size: ${nominalIn}"`);
  return r;
}

/** Internal diameter (in) for a nominal size and schedule. */
export function internalDiameterIn(nominalIn: number, schedule: PipeSchedule): number {
  const r = row(nominalIn);
  return schedule === 'sch10' ? r.idSch10 : r.idSch40;
}

/** Outside diameter in millimetres (OD in × 25.4). */
export function outsideDiameterMm(nominalIn: number): number {
  return row(nominalIn).odIn * 25.4;
}

/** Metric nominal diameter (DN) for a nominal inch size. */
export function dnOf(nominalIn: number): number {
  return row(nominalIn).dn;
}

/** Next larger standard nominal size; throws when already at 16". */
export function nextLargerSize(nominalIn: number): number {
  const i = NOMINAL_SIZES_IN.findIndex((s) => s === nominalIn);
  if (i < 0) throw new Error(`Unsupported nominal pipe size: ${nominalIn}"`);
  if (i >= NOMINAL_SIZES_IN.length - 1) throw new Error('No pipe size larger than 16"');
  return NOMINAL_SIZES_IN[i + 1];
}

const FRACTIONS: Record<number, string> = { 0.5: '½', 0.75: '¾', 1.25: '1¼', 1.5: '1½', 2.5: '2½', 3.5: '3½' };

/** Display label such as `DN150 (6")` or `DN65 (2½")`. */
export function formatPipeSize(nominalIn: number): string {
  const txt = FRACTIONS[nominalIn] ?? String(nominalIn);
  return `DN${dnOf(nominalIn)} (${txt}")`;
}

const GATE_MM: Record<number, number> = { 2: 178, 2.5: 190, 3: 203, 4: 229, 5: 254, 6: 267, 8: 292, 10: 330, 12: 356, 14: 381, 16: 406 };
const CHECK_MM: Record<number, number> = { 2: 203, 2.5: 216, 3: 241, 4: 292, 5: 330, 6: 356, 8: 495, 10: 622, 12: 698, 14: 787, 16: 864 };
const BFLY_MM: Record<number, number> = { 2: 43, 2.5: 46, 3: 46, 4: 52, 5: 56, 6: 56, 8: 60, 10: 68, 12: 78, 14: 92, 16: 102 };

function lookupMm(table: Record<number, number>, nominalIn: number): number {
  const key = Math.max(2, nominalIn);
  const v = table[key];
  if (v === undefined) throw new Error(`No valve length for ${nominalIn}"`);
  return v;
}

/** OS&Y gate valve face-to-face length, mm (class 125/150 flanged); sizes < 2" use 2". */
export function gateValveLengthMm(nominalIn: number): number {
  return lookupMm(GATE_MM, nominalIn);
}

/** Swing check valve face-to-face length, mm (class 125/150 flanged); sizes < 2" use 2". */
export function checkValveLengthMm(nominalIn: number): number {
  return lookupMm(CHECK_MM, nominalIn);
}

/** Butterfly valve face-to-face length, mm (class 125/150 wafer/lug); sizes < 2" use 2". */
export function butterflyValveLengthMm(nominalIn: number): number {
  return lookupMm(BFLY_MM, nominalIn);
}
