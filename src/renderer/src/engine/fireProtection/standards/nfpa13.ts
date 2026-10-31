/**
 * NFPA 13-2019 data: hazard design points, C-factors, equivalent pipe lengths.
 */
import { FittingType, HazardClass, PipeSchedule } from '../fpTypes';
import { NOMINAL_SIZES_IN, internalDiameterIn } from './pipeData';

export interface HazardDesignData {
  label: string;
  densityGpmFt2: number;
  areaFt2: number;
  maxCoverageFt2: number;
  maxSpacingFt: number;
  hoseInsideGpm: number;
  hoseTotalGpm: number;
  durationMin: [number, number];
  reference: string;
}

const REF = 'NFPA 13-2019 Fig. 19.3.3.1.1 & Table 19.3.3.1.2';

/** Density/area design point, coverage, hose allowance and duration per hazard (NFPA 13-2019 Fig. 19.3.3.1.1, Table 19.3.3.1.2). */
export const HAZARD_DESIGN: Record<HazardClass, HazardDesignData> = {
  light: { label: 'Light Hazard', densityGpmFt2: 0.1, areaFt2: 1500, maxCoverageFt2: 225, maxSpacingFt: 15, hoseInsideGpm: 100, hoseTotalGpm: 100, durationMin: [30, 30], reference: REF },
  'ordinary-1': { label: 'Ordinary Hazard Group 1', densityGpmFt2: 0.15, areaFt2: 1500, maxCoverageFt2: 130, maxSpacingFt: 15, hoseInsideGpm: 100, hoseTotalGpm: 250, durationMin: [60, 90], reference: REF },
  'ordinary-2': { label: 'Ordinary Hazard Group 2', densityGpmFt2: 0.2, areaFt2: 1500, maxCoverageFt2: 130, maxSpacingFt: 15, hoseInsideGpm: 100, hoseTotalGpm: 250, durationMin: [60, 90], reference: REF },
  'extra-1': { label: 'Extra Hazard Group 1', densityGpmFt2: 0.3, areaFt2: 2500, maxCoverageFt2: 100, maxSpacingFt: 12, hoseInsideGpm: 100, hoseTotalGpm: 500, durationMin: [90, 120], reference: REF },
  'extra-2': { label: 'Extra Hazard Group 2', densityGpmFt2: 0.4, areaFt2: 2500, maxCoverageFt2: 100, maxSpacingFt: 12, hoseInsideGpm: 100, hoseTotalGpm: 500, durationMin: [90, 120], reference: REF }
};

/** Minimum operating pressure at any sprinkler, psi (NFPA 13-2019 §28.2.4.8.1 minimum operating pressure 7 psi). */
export const MIN_END_HEAD_PRESSURE_PSI = 7;

/** Hazen-Williams C-factors by pipe material (NFPA 13-2019 Table 28.2.4.8.1). */
export const C_FACTOR = {
  blackSteelWet: 120,
  blackSteelDry: 100,
  galvanizedDry: 100,
  cpvc: 150,
  copper: 150,
  stainless: 150,
  cementLinedDuctile: 140
} as const;

type EqRow = Record<'elbow-45' | 'elbow-90' | 'long-turn-elbow-90' | 'tee-branch' | 'butterfly-valve' | 'gate-valve' | 'swing-check', number | null>;

// [elbow-45, elbow-90, long-turn-90, tee-branch, butterfly, gate, swing-check]
const N: null = null;
const EQ_RAW: Record<number, (number | null)[]> = {
  0.75: [1, 2, 1, 4, N, N, 4],
  1: [1, 2, 2, 5, N, N, 5],
  1.25: [1, 3, 2, 6, N, N, 7],
  1.5: [2, 4, 2, 8, N, N, 9],
  2: [2, 5, 3, 10, 6, 1, 11],
  2.5: [3, 6, 4, 12, 7, 1, 14],
  3: [3, 7, 5, 15, 10, 1, 16],
  3.5: [3, 8, 5, 17, N, 1, 19],
  4: [4, 10, 6, 20, 12, 2, 22],
  5: [5, 12, 8, 25, 9, 2, 27],
  6: [7, 14, 9, 30, 10, 3, 32],
  8: [9, 18, 13, 35, 12, 4, 45],
  10: [11, 22, 16, 50, 19, 5, 55],
  12: [13, 27, 18, 60, 21, 6, 65],
  14: [17, 35, 23, 71, 23, 7, 76],
  16: [19, 40, 26, 81, 26, 8, 87]
};

const KEYS: (keyof EqRow)[] = ['elbow-45', 'elbow-90', 'long-turn-elbow-90', 'tee-branch', 'butterfly-valve', 'gate-valve', 'swing-check'];

/** Equivalent length table (ft), Sch 40 steel, C = 120 (NFPA 13-2019 Table 28.2.3.1.1). */
export const EQUIVALENT_LENGTH_FT: Record<number, EqRow> = (() => {
  const out: Record<number, EqRow> = {};
  for (const size of NOMINAL_SIZES_IN) {
    const r = {} as EqRow;
    KEYS.forEach((k, i) => {
      let v = EQ_RAW[size][i];
      if (v === null) {
        // "—" → value of nearest larger size that has one
        for (const s of NOMINAL_SIZES_IN) {
          if (s > size && EQ_RAW[s][i] !== null) {
            v = EQ_RAW[s][i];
            break;
          }
        }
      }
      r[k] = v;
    });
    out[size] = r;
  }
  return out;
})();

const C_MULT: [number, number][] = [
  [100, 0.713],
  [120, 1.0],
  [130, 1.16],
  [140, 1.33],
  [150, 1.51]
];

/** Hazen-Williams C multiplier for equivalent lengths (NFPA 13-2019 Table 28.2.3.1.1 note); linear interpolation between tabulated C. */
export function cMultiplier(c: number): number {
  if (c <= C_MULT[0][0]) return C_MULT[0][1];
  const last = C_MULT[C_MULT.length - 1];
  if (c >= last[0]) return last[1];
  for (let i = 0; i < C_MULT.length - 1; i++) {
    const [c0, m0] = C_MULT[i];
    const [c1, m1] = C_MULT[i + 1];
    if (c >= c0 && c <= c1) return m0 + ((m1 - m0) * (c - c0)) / (c1 - c0);
  }
  return 1;
}

/**
 * Equivalent length of a fitting, ft (NFPA 13-2019 Table 28.2.3.1.1): Sch 40 value x C multiplier
 * x (ID actual / ID Sch 40)^4.87 for other schedules. `alarm-check` uses the swing-check value.
 */
export function equivalentLengthFt(type: FittingType, nominalIn: number, c: number, schedule: PipeSchedule): number {
  const row = EQUIVALENT_LENGTH_FT[nominalIn];
  if (!row) throw new Error(`Unsupported nominal pipe size: ${nominalIn}"`);
  if (type === 'angle-hose-valve') {
    // 2½" angle hose valve: L/D = 150 (Crane TP-410), not in the NFPA 13 table
    const id40 = internalDiameterIn(nominalIn, 'sch40');
    const ratio = internalDiameterIn(nominalIn, schedule) / id40;
    return ((150 * id40) / 12) * cMultiplier(c) * Math.pow(ratio, 4.87);
  }
  const key: keyof EqRow = type === 'alarm-check' ? 'swing-check' : type;
  const base = row[key];
  if (base === null) throw new Error(`No equivalent length for ${type} at ${nominalIn}"`);
  const idRatio = internalDiameterIn(nominalIn, schedule) / internalDiameterIn(nominalIn, 'sch40');
  return base * cMultiplier(c) * Math.pow(idRatio, 4.87);
}
