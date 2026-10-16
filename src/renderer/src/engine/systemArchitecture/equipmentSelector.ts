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
/** Maximum identical units considered when splitting a zone load. */
export const MAX_UNIT_COUNT = 12;

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

/** Fan operating range of one unit (CFM); falls back to 0.8-1.2x nominal when the catalog omits it. */
export function fanRange(equip: EquipmentCatalogItem): { min: number; max: number } {
  const min = equip.minCfm > 0 ? equip.minCfm : equip.nominalCfm * 0.8;
  const max = equip.maxCfm > 0 ? equip.maxCfm : equip.nominalCfm * 1.2;
  return { min, max };
}

/**
 * Airflow delivered by `qty` units for a design airflow: the fan is set to the design CFM when it lies in
 * the combined fan range, otherwise it saturates at the range limit. No requirement => qty x nominal.
 */
export function deliveredCfmFor(equip: EquipmentCatalogItem, qty: number, designCfm: number): number {
  if (!(designCfm > 0)) return qty * equip.nominalCfm;
  const { min, max } = fanRange(equip);
  return Math.min(qty * max, Math.max(qty * min, designCfm));
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
  /** delivered CFM (fan set to design within qty x [minCfm, maxCfm]) / required CFM (Infinity when no requirement). */
  airflowRatio: number;
  /** Airflow actually delivered by the installed units. */
  deliveredCfm: number;
  derate: number;
  maxCapacityRatio: number;
  valid: boolean;
  /** Short machine-readable failure codes. */
  failures: Array<'DEFICIT' | 'OVERSIZE' | 'SENSIBLE' | 'AIRFLOW_LOW' | 'AIRFLOW_HIGH'>;
  /** Non-blocking Manual S notes on a valid result (see NEXT_NOMINAL_SIZE / MIN_AVAILABLE_SIZE). */
  warnings: SizingWarning[];
}

export type SizingWarning = 'NEXT_NOMINAL_SIZE' | 'MIN_AVAILABLE_SIZE';

/**
 * ACCA Manual S "next nominal size" relaxation (planner ruling 2). Hard ceiling on capacity ratio when
 * no model x quantity in the family fits the 1.15 (fixed) / 1.20 (inverter) window.
 */
export const CAPACITY_RATIO_MAX_NEXT_NOMINAL = 1.35;

/** Plain rule check for a model x quantity (no family-level relaxation). */
function baseSizingCheck(
  equip: EquipmentCatalogItem,
  qty: number,
  loadBtu: number,
  sensibleBtu: number,
  requiredCfm: number,
  designAmbientF: number
): SizingCheck {
  return evaluateSizingStrict(equip, qty, loadBtu, sensibleBtu, requiredCfm, designAmbientF);
}

export function evaluateSizing(
  equip: EquipmentCatalogItem,
  qty: number,
  loadBtu: number,
  sensibleBtu: number,
  requiredCfm: number,
  designAmbientF: number = RATING_AMBIENT_F
): SizingCheck {
  const strict = baseSizingCheck(equip, qty, loadBtu, sensibleBtu, requiredCfm, designAmbientF);
  if (strict.valid || !(loadBtu > 0)) return strict;
  const f: string[] = strict.failures;
  // Only an oversize (optionally with fan-turndown AIRFLOW_HIGH) is eligible for the Manual S relaxations.
  const onlyOversize = f.length > 0 && f.every((x) => x === 'OVERSIZE' || x === 'AIRFLOW_HIGH') && f.includes('OVERSIZE');
  if (!onlyOversize) return strict;

  const family = catalogCandidatesForType(equip.systemType);
  const derate = strict.derate;

  // (a) MIN_AVAILABLE_SIZE: load below the smallest unit of the family -> the smallest unit is accepted
  // (its fan cannot turn down further, so AIRFLOW_HIGH is tolerated as well).
  const smallest = family.reduce((m, e) => (e.totalCapacityBtuPerHour < m.totalCapacityBtuPerHour ? e : m), family[0]);
  if (
    qty === 1 &&
    equip.totalCapacityBtuPerHour <= smallest.totalCapacityBtuPerHour + EPS &&
    loadBtu <= smallest.totalCapacityBtuPerHour * derate
  ) {
    return { ...strict, valid: true, failures: [], warnings: ['MIN_AVAILABLE_SIZE'] };
  }

  // (b) NEXT_NOMINAL_SIZE: no model x qty in the family satisfies the strict window -> the smallest adequate
  // option (ratio >= 1, sensible ok, airflow ok) is accepted when its ratio is <= 1.35.
  if (f.includes('AIRFLOW_HIGH') || strict.capacityRatio > CAPACITY_RATIO_MAX_NEXT_NOMINAL + EPS) return strict;
  let smallestAdequate = Infinity;
  for (const m of family) {
    for (let q = 1; q <= MAX_UNIT_COUNT; q++) {
      const c = baseSizingCheck(m, q, loadBtu, sensibleBtu, requiredCfm, designAmbientF);
      if (c.valid) return strict; // a strictly valid option exists in this family
      const adequate = c.failures.every((x) => x === 'OVERSIZE');
      if (adequate && c.capacityRatio < smallestAdequate) smallestAdequate = c.capacityRatio;
    }
  }
  if (strict.capacityRatio <= smallestAdequate + 1e-6) {
    return { ...strict, valid: true, failures: [], warnings: ['NEXT_NOMINAL_SIZE'] };
  }
  return strict;
}

function evaluateSizingStrict(
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
  const deliveredCfm = deliveredCfmFor(equip, qty, requiredCfm);
  const airflowRatio = requiredCfm > 0 ? deliveredCfm / requiredCfm : Infinity;
  const maxCapacityRatio = maxCapacityRatioFor(equip);

  const failures: SizingCheck['failures'] = [];
  if (deratedRatio < CAPACITY_RATIO_MIN - EPS) failures.push('DEFICIT');
  if (capacityRatio > maxCapacityRatio + EPS) failures.push('OVERSIZE');
  if (sensibleRatio < 1 - EPS) failures.push('SENSIBLE');
  if (requiredCfm > 0) {
    // Fan is set to the design CFM inside qty x [minCfm, maxCfm] (ratio exactly 1); outside the range it
    // saturates, and the delivered/required window 0.95-1.25 bounds how far outside is tolerated.
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
    deliveredCfm,
    derate,
    maxCapacityRatio,
    valid: failures.length === 0,
    failures,
    warnings: []
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
    requiredCfm > 0 ? Math.ceil(requiredCfm / (fanRange(equip).max / AIRFLOW_RATIO_MIN) - EPS) : 1
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

/** Catalog items eligible for a system type (same fallback chain as selectEquipmentForLoad). */
export function catalogCandidatesForType(
  systemType: string = 'concealed',
  catalog: EquipmentCatalogItem[] = STANDARD_EQUIPMENT_CATALOG
): EquipmentCatalogItem[] {
  const normalizedType = normalizeSystemType(systemType);
  let candidates = catalog.filter((item) => item.systemType === normalizedType);
  if (candidates.length === 0 && normalizedType === 'fcu') candidates = catalog.filter((item) => item.systemType === 'concealed');
  if (candidates.length === 0) candidates = catalog.filter((item) => item.capabilities?.supportsDuctNetwork);
  if (candidates.length === 0) candidates = catalog;
  return candidates;
}

/** Export for callers that build a result from an explicit catalog item. */
export function toSelectedEquipmentResult(item: EquipmentCatalogItem, extra: Partial<SelectedEquipmentResult> = {}): SelectedEquipmentResult {
  return toResult(item, extra);
}

/**
 * Select ONE catalog unit for a (per-unit) requirement.
 * Hard filters: derated total capacity >= reqBtu, derated sensible >= reqSensibleBtu (when given),
 * reqCfm within the unit fan range [minCfm, maxCfm] (fan set to design CFM).
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
      const { min, max } = fanRange(item);
      const r = deliveredCfmFor(item, 1, reqCfm) / reqCfm;
      if (r < AIRFLOW_RATIO_MIN - EPS) {
        score += AIRFLOW_RATIO_MIN - r;
        notes.push(`airflow ${Math.round(reqCfm)} CFM > unit maximum ${Math.round(max)} CFM`);
      } else if (r > AIRFLOW_RATIO_MAX + EPS) {
        score += r - AIRFLOW_RATIO_MAX;
        notes.push(`airflow ${Math.round(reqCfm)} CFM < unit minimum ${Math.round(min)} CFM`);
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
