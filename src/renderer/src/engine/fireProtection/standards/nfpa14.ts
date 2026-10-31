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
