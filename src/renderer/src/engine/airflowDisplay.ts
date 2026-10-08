import { LITERS_PER_SECOND_PER_CFM } from './engineeringInputs';

/** Stored terminal flows and fallback demand are canonical CFM. */
export function getSupplyAirflowForDisplay(
  terminals: { type?: string; cfm: number }[], fallbackCfm: number, units: 'imperial' | 'metric'
): number | null {
  const supply = terminals.filter(t => t.type !== 'return' && t.type !== 'exhaust');
  if (supply.some(t => !Number.isFinite(t.cfm) || t.cfm < 0)) return null;
  const cfm = terminals.length ? supply.reduce((sum, t) => sum + t.cfm, 0) : fallbackCfm;
  if (!Number.isFinite(cfm) || cfm < 0) return null;
  return cfm * (units === 'metric' ? LITERS_PER_SECOND_PER_CFM : 1);
}
