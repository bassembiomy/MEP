import { EquipmentCatalogItem } from '../types';
import { STANDARD_EQUIPMENT_CATALOG } from '../hvacCatalogs';

// ---------------------------------------------------------------------------
// Professional sizing rules (single source of truth for selector / optimizer /
// system designer / architecture trace).
// ---------------------------------------------------------------------------

/** Installed (qty x rated) total capacity must cover the coil load. */
export const CAPACITY_RATIO_MIN = 1.0;
/** Upper oversize limit for inverter / variable-capacity equipment. */
export const CAPACITY_RATIO_MAX_INVERTER = 1.2;
/** Upper oversize limit for fixed-speed (on/off or staged) equipment. */
export const CAPACITY_RATIO_MAX_FIXED = 1.15;
/** Delivered nominal airflow window relative to required airflow. */
export const AIRFLOW_RATIO_MIN = 0.95;
export const AIRFLOW_RATIO_MAX = 1.25;
/** VRF outdoor-unit combination ratio (sum of indoor rated capacity / outdoor capacity). */
export const VRF_COMBINATION_MIN = 0.5;
export const VRF_COMBINATION_MAX = 1.3;
export const VRF_COMBINATION_TARGET_MIN = 1.0;
export const VRF_COMBINATION_TARGET_MAX = 1.1;
/** VRF piping limits (metres). */
export const VRF_MAX_EQUIVALENT_PIPE_LENGTH_M = 165;
export const VRF_MAX_HEIGHT_DIFFERENCE_M = 50;
/** Catalog ratings are at AHRI 95F outdoor. */
export const RATING_AMBIENT_F = 95;
/** Capacity loss per degF of design ambient above the rating condition. */
const DERATE_PER_DEG_F = 0.005;
const EPS = 1e-9;

/**
 * Inverter / variable-capacity equipment may be oversized by up to 20%;
 * fixed-speed equipment (packaged, AHU, FCU) is limited to 15%.
 */
export function isInverterDriven(equip: EquipmentCatalogItem): boolean {
  return (
    equip.systemType === 'vrf' ||
    equip.systemType === 'high-wall' ||
    equip.systemType === 'cassette' ||
    equip.systemType === 'concealed'
  );
}

export function maxCapacityRatioFor(equip: EquipmentCatalogItem): number {
  return isInverterDriven(equip) ? CAPACITY_RATIO_MAX_INVERTER : CAPACITY_RATIO_MAX_FIXED;
}

/** Capacity derate for design ambient above the 95F rating condition (1.0 at/below 95F, 0.95 at 105F). */
export function ambientDerateFactor(designAmbientF: number = RATING_AMBIENT_F): number {
  const excess = Math.max(0, designAmbientF - RATING_AMBIENT_F);
  return Math.max(0.7, 1 - excess * DERATE_PER_DEG_F);
}

export interface SizingCheck {
  qty: number;
  installedCapacityBtu: number;
  /** qty x rated total capacity / coil load (nominal rating). */
  capacityRatio: number;
  /** capacityRatio after ambient derate. */
  deratedRatio: number;
  /** derated installed sensible capacity / room sensible load (Infinity when no sensible load given). */
  sensibleRatio: number;
  /** qty x nominal CFM / required CFM (Infinity when no airflow requirement). */
  airflowRatio: number;
  derate: number;
  maxCapacityRatio: number;
  valid: boolean;
  /** Short machine-readable failure codes. */
  failures: Array<'DEFICIT' | 'OVERSIZE' | 'SENSIBLE' | 'AIRFLOW_LOW' | 'AIRFLOW_HIGH'>;
}

export function evaluateSizing(
  equip: EquipmentCatalogItem,
  qty: number,
  loadBtu: number,
  sensibleBtu: number,
  requiredCfm: number,
  designAmbientF: number = RATING_AMBIENT_F
): SizingCheck {
  const derate = ambientDerateFactor(designAmbientF);
  const installed = qty * equip.totalCapacityBtuPerHour;
  const capacityRatio = loadBtu > 0 ? installed / loadBtu : Infinity;
  const deratedRatio = capacityRatio * derate;
  const sensibleRatio =
    sensibleBtu > 0 ? (qty * equip.sensibleCapacityBtuPerHour * derate) / sensibleBtu : Infinity;
  const airflowRatio = requiredCfm > 0 ? (qty * equip.nominalCfm) / requiredCfm : Infinity;
  const maxCapacityRatio = maxCapacityRatioFor(equip);

  const failures: SizingCheck['failures'] = [];
  if (deratedRatio < CAPACITY_RATIO_MIN - EPS) failures.push('DEFICIT');
  if (capacityRatio > maxCapacityRatio + EPS) failures.push('OVERSIZE');
  if (sensibleRatio < 1 - EPS) failures.push('SENSIBLE');
  if (requiredCfm > 0) {
    if (airflowRatio < AIRFLOW_RATIO_MIN - EPS) failures.push('AIRFLOW_LOW');
    if (airflowRatio > AIRFLOW_RATIO_MAX + EPS) failures.push('AIRFLOW_HIGH');
  }

  return {
    qty,
    installedCapacityBtu: installed,
    capacityRatio,
    deratedRatio,
    sensibleRatio,
    airflowRatio,
    derate,
    maxCapacityRatio,
    valid: failures.length === 0,
    failures
  };
}

/**
 * Smallest unit count for which `equip` satisfies every sizing rule. When no
 * quantity does, returns the minimum count that at least covers capacity and
 * airflow with `valid === false` (so callers can show why it was rejected).
 */
export function sizeUnitQuantity(
  equip: EquipmentCatalogItem,
  loadBtu: number,
  sensibleBtu: number,
  requiredCfm: number,
  designAmbientF: number = RATING_AMBIENT_F,
  maxQty: number = 40
): SizingCheck {
  const derate = ambientDerateFactor(designAmbientF);
  const qMin = Math.max(
    1,
    Math.ceil(loadBtu / (equip.totalCapacityBtuPerHour * derate) - EPS),
    sensibleBtu > 0 ? Math.ceil(sensibleBtu / (equip.sensibleCapacityBtuPerHour * derate) - EPS) : 1,
    requiredCfm > 0 ? Math.ceil((requiredCfm * AIRFLOW_RATIO_MIN) / equip.nominalCfm - EPS) : 1
  );
  for (let q = qMin; q <= Math.max(qMin, maxQty); q++) {
    const check = evaluateSizing(equip, q, loadBtu, sensibleBtu, requiredCfm, designAmbientF);
    if (check.valid) return check;
    // Once oversize/airflow-high is violated, adding units only makes it worse.
    if (check.failures.includes('OVERSIZE') || check.failures.includes('AIRFLOW_HIGH')) break;
  }
  return evaluateSizing(equip, qMin, loadBtu, sensibleBtu, requiredCfm, designAmbientF);
}

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
  /**
   * True when no catalog unit satisfies the hard filters (capacity, sensible, airflow);
   * the returned unit is only the closest available and MUST NOT be treated as a valid selection.
   */
  undersized?: boolean;
  /** Human-readable list of unmet requirements when `undersized` is set. */
  shortfalls?: string[];
}

function normalizeSystemType(systemType: string): string {
  let normalizedType = systemType.toLowerCase();
  if (normalizedType === 'concealed-split' || normalizedType === 'split') normalizedType = 'concealed';
  if (normalizedType === 'rtu' || normalizedType === 'rooftop') normalizedType = 'packaged';
  if (normalizedType === 'chilled-water' || normalizedType === 'cwu') normalizedType = 'ahu';
  return normalizedType;
}

function toResult(item: EquipmentCatalogItem, extra: Partial<SelectedEquipmentResult> = {}): SelectedEquipmentResult {
  return {
    catalogItem: item,
    model: item.model,
    nominalTons: item.nominalTons,
    totalCapacityBtu: item.totalCapacityBtuPerHour,
    sensibleCapacityBtu: item.sensibleCapacityBtuPerHour,
    supplyCfm: item.nominalCfm,
    availableEspInWg: item.maxRatedEspInWg,
    electricalKw: item.electricalKw,
    dimensionsIn: item.dimensionsIn,
    connectionSizes: {
      supplyDuct: item.connectionSizes.supplyDuct || '28"x7"',
      returnDuct: item.connectionSizes.returnDuct || '32"x7"'
    },
    ...extra
  };
}

/**
 * Select ONE catalog unit for a (per-unit) requirement.
 * Hard filters: derated total capacity >= reqBtu, derated sensible >= reqSensibleBtu (when given),
 * nominal airflow within 0.95-1.25 of reqCfm and reqCfm <= maxCfm.
 * Among passing units the smallest capacity / requirement ratio wins.
 * When nothing passes, the closest unit is returned with `undersized: true`.
 */
export function selectEquipmentForLoad(
  reqCfm: number,
  reqBtu: number,
  systemType: string = 'concealed',
  catalog: EquipmentCatalogItem[] = STANDARD_EQUIPMENT_CATALOG,
  reqSensibleBtu: number = 0,
  designAmbientF: number = RATING_AMBIENT_F
): SelectedEquipmentResult | null {
  const normalizedType = normalizeSystemType(systemType);
  const derate = ambientDerateFactor(designAmbientF);

  let candidates = catalog.filter((item) => item.systemType === normalizedType);
  if (candidates.length === 0 && normalizedType === 'fcu') {
    candidates = catalog.filter((item) => item.systemType === 'concealed');
  }
  if (candidates.length === 0) {
    candidates = catalog.filter((item) => item.capabilities?.supportsDuctNetwork);
  }
  if (candidates.length === 0) candidates = catalog;
  if (candidates.length === 0) return null;

  const shortfallOf = (item: EquipmentCatalogItem): { score: number; notes: string[] } => {
    const notes: string[] = [];
    let score = 0;
    const cap = item.totalCapacityBtuPerHour * derate;
    if (reqBtu > 0 && cap < reqBtu - EPS) {
      score += (reqBtu - cap) / reqBtu;
      notes.push(`capacity ${Math.round(cap)} < ${Math.round(reqBtu)} Btu/h`);
    }
    const sens = item.sensibleCapacityBtuPerHour * derate;
    if (reqSensibleBtu > 0 && sens < reqSensibleBtu - EPS) {
      score += (reqSensibleBtu - sens) / reqSensibleBtu;
      notes.push(`sensible ${Math.round(sens)} < ${Math.round(reqSensibleBtu)} Btu/h`);
    }
    if (reqCfm > 0) {
      const r = item.nominalCfm / reqCfm;
      if (r < AIRFLOW_RATIO_MIN - EPS) {
        score += AIRFLOW_RATIO_MIN - r;
        notes.push(`airflow ${item.nominalCfm} < ${Math.round(reqCfm * AIRFLOW_RATIO_MIN)} CFM`);
      } else if (r > AIRFLOW_RATIO_MAX + EPS || reqCfm > item.maxCfm + EPS) {
        score += Math.max(r - AIRFLOW_RATIO_MAX, 0) + (reqCfm > item.maxCfm ? (reqCfm - item.maxCfm) / reqCfm : 0);
        notes.push(`airflow ${item.nominalCfm} CFM outside ${AIRFLOW_RATIO_MIN}-${AIRFLOW_RATIO_MAX}x of ${Math.round(reqCfm)} CFM`);
      }
    }
    return { score, notes };
  };

  let best: EquipmentCatalogItem | null = null;
  let bestKey = Infinity;
  let closest: EquipmentCatalogItem | null = null;
  let closestShort = { score: Infinity, notes: [] as string[] };

  for (const item of candidates) {
    const sf = shortfallOf(item);
    if (sf.score === 0) {
      const capRatio = reqBtu > 0 ? item.totalCapacityBtuPerHour / reqBtu : 1;
      const cfmDev = reqCfm > 0 ? Math.abs(item.nominalCfm / reqCfm - 1) : 0;
      // Minimise capacity/requirement; airflow deviation only breaks ties.
      const key = capRatio + cfmDev * 0.001;
      if (key < bestKey) {
        bestKey = key;
        best = item;
      }
    } else if (
      sf.score < closestShort.score ||
      (sf.score === closestShort.score && closest && item.totalCapacityBtuPerHour < closest.totalCapacityBtuPerHour)
    ) {
      closest = item;
      closestShort = sf;
    }
  }

  if (best) return toResult(best);
  if (!closest) return null;
  return toResult(closest, { undersized: true, shortfalls: closestShort.notes });
}
