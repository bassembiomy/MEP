/**
 * NFPA 20-2019 fire pump data: rated capacities, size table, motor/engine sizes, limits.
 */
import { PumpSizeTableRow } from '../fpTypes';

/** Standard rated capacities, gpm (NFPA 20-2019 Table 4.1(a)). */
export const RATED_CAPACITIES_GPM = [25, 50, 100, 150, 200, 250, 300, 400, 450, 500, 750, 1000, 1250, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000];

// [gpm, suction, discharge, relief, relief disch, meter, hose valves, header supply]
const RAW: number[][] = [
  [25, 1, 1, 0.75, 1, 1.25, 1, 1],
  [50, 1.5, 1.25, 1.25, 1.5, 2, 1, 1.5],
  [100, 2, 2, 1.5, 2, 2.5, 1, 2.5],
  [150, 2.5, 2.5, 2, 2.5, 3, 1, 2.5],
  [200, 3, 3, 2, 2.5, 3, 1, 2.5],
  [250, 3.5, 3, 2, 2.5, 3.5, 1, 3],
  [300, 4, 4, 2.5, 3.5, 3.5, 1, 3],
  [400, 4, 4, 3, 5, 4, 2, 4],
  [450, 5, 5, 3, 5, 4, 2, 4],
  [500, 5, 5, 3, 5, 5, 2, 4],
  [750, 6, 6, 4, 6, 5, 3, 6],
  [1000, 8, 6, 4, 8, 6, 4, 6],
  [1250, 8, 8, 6, 8, 6, 6, 8],
  [1500, 8, 8, 6, 8, 8, 6, 8],
  [2000, 10, 10, 6, 10, 8, 6, 8],
  [2500, 10, 10, 6, 10, 8, 8, 10],
  [3000, 12, 12, 8, 12, 8, 12, 10],
  [3500, 12, 12, 8, 12, 10, 12, 12],
  [4000, 14, 12, 8, 14, 10, 16, 12],
  [4500, 16, 14, 8, 14, 10, 16, 12],
  [5000, 16, 14, 8, 14, 10, 20, 12]
];

/** Summary of Centrifugal Fire Pump Data (NFPA 20-2019 Table 4.28(a)/(b)). */
export const PUMP_DATA_TABLE: PumpSizeTableRow[] = RAW.map(([ratedGpm, suctionIn, dischargeIn, reliefValveIn, reliefDischargeIn, meterDeviceIn, hoseValves, hoseHeaderSupplyIn]) => ({
  ratedGpm,
  suctionIn,
  dischargeIn,
  reliefValveIn,
  reliefDischargeIn,
  meterDeviceIn,
  hoseValves,
  hoseHeaderSupplyIn
}));

/** Standard NEMA motor ratings, HP (NFPA 20-2019 Ch. 9 / NEMA MG-1). */
export const NEMA_MOTOR_HP = [0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800];

/** Listed diesel engine ratings, HP (NFPA 20-2019 Ch. 11). */
export const DIESEL_ENGINE_HP = [30, 40, 50, 63, 75, 89, 100, 115, 125, 140, 165, 180, 200, 230, 260, 300, 340, 375, 420, 460, 525, 600, 700, 800];

/** Jockey pump rated flows, gpm (NFPA 20-2019 Annex A.4.26). */
export const JOCKEY_FLOWS_GPM = [1, 2, 3, 5, 7, 10, 15, 20, 25, 30, 40, 50];

/** Max suction pipe velocity at 150 % flow, ft/s (NFPA 20-2019 §4.14.3.1). */
export const MAX_SUCTION_VELOCITY_FPS = 15;
/** Min suction gauge pressure at 150 % flow from a tank, psi (NFPA 20-2019 §4.14.2). */
export const MIN_SUCTION_PRESSURE_TANK_PSI = -3;
/** Max shutoff (churn) head as a ratio of rated head (NFPA 20-2019 §4.26.2). */
export const SHUTOFF_MAX_RATIO = 1.4;
/** Min net pressure at 150 % flow as a ratio of rated pressure (NFPA 20-2019 §4.26.3). */
export const MIN_RATIO_AT_150 = 0.65;

/** Typical rated pump efficiency by capacity (engineering assumption for BHP estimate; NFPA 20-2019 Ch. 9 motor sizing). */
export function ratedEfficiency(gpm: number): number {
  if (gpm <= 250) return 0.6;
  if (gpm <= 500) return 0.7;
  if (gpm <= 1500) return 0.78;
  return 0.82;
}

/** Synchronous-class pump speed, rpm: 2-pole for <= 500 gpm, 4-pole above (NFPA 20-2019 Ch. 9). */
export function pumpSpeedRpm(gpm: number, hz: 50 | 60): number {
  if (gpm <= 500) return hz === 50 ? 2950 : 3550;
  return hz === 50 ? 1480 : 1770;
}

/** Circulation relief valve size, in (NFPA 20-2019 §4.19.1, 3/4" up to 2500 gpm, 1" above). */
export function circulationReliefSizeIn(gpm: number): number {
  return gpm <= 2500 ? 0.75 : 1;
}

/** Pump data row for an exact rated capacity (NFPA 20-2019 Table 4.28); throws if not a standard rating. */
export function pumpDataFor(ratedGpm: number): PumpSizeTableRow {
  const r = PUMP_DATA_TABLE.find((x) => x.ratedGpm === ratedGpm);
  if (!r) throw new Error(`No NFPA 20 pump data for rated capacity ${ratedGpm} gpm`);
  return r;
}

/** Smallest standard rated capacity >= demand (NFPA 20-2019 Table 4.1(a)); throws above 5000 gpm. */
export function selectRatedCapacity(demandGpm: number): number {
  const r = RATED_CAPACITIES_GPM.find((c) => c >= demandGpm);
  if (r === undefined) throw new Error(`Demand ${demandGpm} gpm exceeds the largest standard fire pump (5000 gpm)`);
  return r;
}
