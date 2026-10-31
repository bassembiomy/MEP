/**
 * NFPA 14-2019 standpipe demand rules.
 */
import { StandpipeClass } from '../fpTypes';

export const NFPA14_FLOW_REFERENCE = 'NFPA 14-2019 §7.10.1.1 (flow rates)';
export const NFPA14_PRESSURE_REFERENCE = 'NFPA 14-2019 §7.8 (residual pressure)';

/** Standpipe system duration, minutes (NFPA 14-2019 §7.10.1.2). */
export const STANDPIPE_DURATION_MIN = 30;

/**
 * Standpipe demand flow, gpm (NFPA 14-2019 §7.10.1.1): Class I/III 500 gpm for the first
 * standpipe + 250 gpm each additional, capped at 1000 (sprinklered) / 1250 gpm; Class II 100 gpm.
 */
export function standpipeFlowGpm(cls: StandpipeClass, count: number, sprinklered: boolean): number {
  if (cls === 'none') return 0;
  if (cls === 'II') return 100;
  const n = Math.max(1, count);
  return Math.min(500 + 250 * (n - 1), sprinklered ? 1000 : 1250);
}

/** Minimum residual pressure at the hydraulically most remote outlet, psi (NFPA 14-2019 §7.8.1). */
export function standpipeResidualPsi(cls: StandpipeClass): number {
  if (cls === 'I' || cls === 'III') return 100;
  if (cls === 'II') return 65;
  return 0;
}

/** Maximum working pressure anywhere in a standpipe system, psi (NFPA 14-2019 §7.2.1). */
export const STANDPIPE_MAX_PRESSURE_PSI = 350;
/** Static pressure above which a 2½" outlet needs a pressure-regulating device, psi (NFPA 14-2019 §7.2.3). */
export const HOSE_OUTLET_STATIC_LIMIT_PSI = 175;
/** Pressure limit at 1½" hose stations, psi (NFPA 14-2019 §7.2.3). */
export const HOSE_1_5_LIMIT_PSI = 100;
/** Maximum height of a standpipe zone, ft (NFPA 14-2019 §7.9). */
export const MAX_ZONE_HEIGHT_FT = 275;
/** High-rise threshold above fire department access, ft (IBC §202 / §403). */
export const HIGH_RISE_FT = 75;
/** Hose valve height range above the floor, mm (NFPA 14-2019 §7.3.1.1: 3 ft – 5 ft). */
export const HOSE_VALVE_HEIGHT_RANGE_MM: [number, number] = [900, 1500];

/** Minimum riser size, in (NFPA 14-2019 §7.6): Class II 2", combined with sprinklers 6", otherwise 4". */
export function standpipeMinRiserSizeIn(cls: StandpipeClass, combined: boolean): number {
  if (cls === 'II') return 2;
  return combined ? 6 : 4;
}

/** Hose outlet size, in (NFPA 14-2019 §7.3.1): Class II 1½", Class I/III 2½". */
export function standpipeOutletSizeIn(cls: StandpipeClass): number {
  return cls === 'II' ? 1.5 : 2.5;
}
