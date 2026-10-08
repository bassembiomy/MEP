import { EquipmentCatalogItem } from '../types';
import { STANDARD_EQUIPMENT_CATALOG } from '../hvacCatalogs';

export interface SelectedEquipmentResult {
  catalogItem: EquipmentCatalogItem;
  model: string;
  nominalTons: number;
  totalCapacityBtu: number;
  sensibleCapacityBtu: number;
  supplyCfm: number;
  availableEspInWg: number;
  electricalKw: number;
  dimensionsIn: { width: number; depth: number; height: number };
  connectionSizes: { supplyDuct: string; returnDuct: string };
}

export interface EquipmentSelectionConstraints {
  requiredSensibleBtu?: number;
  requiredLatentBtu?: number;
  requiredEspInWg?: number;
}

export function selectEquipmentForLoad(
  reqCfm: number,
  reqBtu: number,
  systemType: string = 'concealed',
  catalog: EquipmentCatalogItem[] = STANDARD_EQUIPMENT_CATALOG,
  constraints: EquipmentSelectionConstraints = {}
): SelectedEquipmentResult | null {
  const { requiredSensibleBtu, requiredLatentBtu, requiredEspInWg } = constraints;
  if (![reqCfm, reqBtu].every((value) => Number.isFinite(value) && value >= 0)) return null;
  if ([requiredSensibleBtu, requiredLatentBtu, requiredEspInWg].some(
    (value) => value !== undefined && (!Number.isFinite(value) || value < 0)
  )) return null;

  // Normalize system type aliases
  let normalizedType = systemType.toLowerCase();
  if (normalizedType === 'concealed-split' || normalizedType === 'split') normalizedType = 'concealed';
  if (normalizedType === 'rtu' || normalizedType === 'rooftop') normalizedType = 'packaged';

  // Hard requirements must all be satisfied before ranking a candidate.
  const candidates = catalog.filter((item) => {
    const total = item.totalCapacityBtuPerHour;
    const sensible = item.sensibleCapacityBtuPerHour;
    const cfm = item.nominalCfm;
    const esp = item.maxRatedEspInWg;
    if (item.systemType !== normalizedType ||
      ![total, sensible, cfm, esp].every((value) => Number.isFinite(value) && value >= 0) ||
      sensible > total) return false;

    return total >= reqBtu && cfm >= reqCfm &&
      (requiredSensibleBtu === undefined || sensible >= requiredSensibleBtu) &&
      (requiredLatentBtu === undefined || total - sensible >= requiredLatentBtu) &&
      (requiredEspInWg === undefined || esp >= requiredEspInWg);
  });

  let bestCandidate: EquipmentCatalogItem | null = null;
  let minOversize = Infinity;

  for (const item of candidates) {
    const cap = item.totalCapacityBtuPerHour;
    const cfm = item.nominalCfm;

    const capDiff = cap - reqBtu;
    const cfmDiff = cfm - reqCfm;
    const score = Math.abs(capDiff) + Math.abs(cfmDiff) * 15;
    if (!bestCandidate || score < minOversize) {
      minOversize = score;
      bestCandidate = item;
    }
  }

  if (!bestCandidate) return null;

  return {
    catalogItem: bestCandidate,
    model: bestCandidate.model,
    nominalTons: bestCandidate.nominalTons,
    totalCapacityBtu: bestCandidate.totalCapacityBtuPerHour,
    sensibleCapacityBtu: bestCandidate.sensibleCapacityBtuPerHour,
    supplyCfm: bestCandidate.nominalCfm,
    availableEspInWg: bestCandidate.maxRatedEspInWg,
    electricalKw: bestCandidate.electricalKw,
    dimensionsIn: bestCandidate.dimensionsIn,
    connectionSizes: {
      supplyDuct: bestCandidate.connectionSizes.supplyDuct || '28"x7"',
      returnDuct: bestCandidate.connectionSizes.returnDuct || '32"x7"'
    }
  };
}
