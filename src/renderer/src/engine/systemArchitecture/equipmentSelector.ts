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

export function selectEquipmentForLoad(
  reqCfm: number,
  reqBtu: number,
  systemType: string = 'concealed',
  catalog: EquipmentCatalogItem[] = STANDARD_EQUIPMENT_CATALOG
): SelectedEquipmentResult | null {
  // Normalize system type aliases
  let normalizedType = systemType.toLowerCase();
  if (normalizedType === 'concealed-split' || normalizedType === 'split') normalizedType = 'concealed';
  if (normalizedType === 'rtu' || normalizedType === 'rooftop') normalizedType = 'packaged';
  if (normalizedType === 'chilled-water' || normalizedType === 'cwu') normalizedType = 'ahu';

  // Filter catalog by system type
  let candidates = catalog.filter((item) => item.systemType === normalizedType);
  if (candidates.length === 0 && normalizedType === 'fcu') {
    candidates = catalog.filter((item) => item.systemType === 'concealed');
  }
  if (candidates.length === 0) {
    // Fallback to any ducted system
    candidates = catalog.filter((item) => item.capabilities?.supportsDuctNetwork);
  }
  if (candidates.length === 0) candidates = catalog;

  // Find candidate that provides sufficient capacity and CFM with minimum oversizing
  let bestCandidate: EquipmentCatalogItem | null = null;
  let minOversize = Infinity;

  for (const item of candidates) {
    const cap = item.totalCapacityBtuPerHour;
    const cfm = item.nominalCfm;

    // Check capacity match: item must satisfy both capacity and CFM requirements
    if (cap >= reqBtu * 0.85 && cfm >= reqCfm * 0.85) {
      const oversizeScore = (cap - reqBtu) + (cfm - reqCfm) * 10;
      if (oversizeScore >= 0 && oversizeScore < minOversize) {
        minOversize = oversizeScore;
        bestCandidate = item;
      }
    }
  }

  // Fallback to largest/closest candidate if requirements exceed standard sizing
  if (!bestCandidate) {
    const sorted = [...candidates].sort((a, b) => {
      const diffA = Math.abs(a.totalCapacityBtuPerHour - reqBtu);
      const diffB = Math.abs(b.totalCapacityBtuPerHour - reqBtu);
      return diffA - diffB;
    });
    bestCandidate = sorted[0];
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
