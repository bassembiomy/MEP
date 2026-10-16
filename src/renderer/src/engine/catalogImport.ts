/**
 * Manufacturer equipment-catalog import (.xlsx / .csv) and template export.
 *
 * COLUMN SCHEMA (first sheet, or sheet named "Catalog"; row 1 = headers; order and case free).
 * Units are detected from the header, e.g. "Total Capacity (kW)" vs "Total Capacity (Btu/h)".
 * A header without a unit means the imperial default shown first below.
 *
 *  Column (aliases)                          Req  Units accepted (default first)
 *  Model (Model Number)                       yes  text
 *  Manufacturer (Brand)                       yes  text
 *  System Type (Family, Type)                 yes  concealed|ducted, cassette, high-wall|wall|mini-split,
 *                                                  packaged|rtu, vrf, ahu, fcu
 *  Nominal Tons (Tons)                        *    tons
 *  Total Capacity (Capacity, Cooling Cap.)    *    Btu/h, kBtu/h, MBH, W, kW, tons
 *  Sensible Capacity                          no   same as capacity (default 0.75 x total)
 *  Heating Capacity                           no   same as capacity
 *  Nominal Airflow (Nominal CFM, Airflow)     yes  CFM, L/s, m3/h
 *  Min Airflow (Min CFM)                      no   same (default 0.8 x nominal)
 *  Max Airflow (Max CFM)                      no   same (default 1.2 x nominal)
 *  ESP (External Static Pressure)             **   in.wg, Pa   (** required for concealed/packaged/ahu)
 *  Length (Depth), Width, Height              yes  in, mm, cm, m
 *  Weight                                     no   lb, kg
 *  Refrigerant                                no   text
 *  Power (Electrical Power)                   no   kW, W, hp
 *  SEER / EER / COP                           no   number
 *  Noise (Sound Level)                        no   dB(A)
 *  * at least one of Nominal Tons / Total Capacity is required.
 *
 * Row validation mirrors the catalog integrity tests: capacity within +/-10 % of nominal tons x 12000,
 * nominal CFM/ton in 300-500, sensible <= total, min <= nominal <= max, positive dimensions.
 * Rows with any error are rejected and reported as {row, field, message}; row numbers are spreadsheet rows.
 */
import * as XLSX from 'xlsx';
import type { EquipmentCatalogItem } from './types';
import { STANDARD_EQUIPMENT_CATALOG } from './hvacCatalogs';
import { BTUH_PER_W, BTUH_PER_TON, CFM_PER_LPS, PA_PER_INWG, MM_PER_IN } from './units';

export interface CatalogImportError {
  row: number;
  field: string;
  message: string;
}
export interface CatalogImportResult {
  entries: EquipmentCatalogItem[];
  errors: CatalogImportError[];
}

type Kind = 'capacity' | 'airflow' | 'pressure' | 'length' | 'weight' | 'power' | 'number' | 'text' | 'noise';
type FieldKey =
  | 'model' | 'manufacturer' | 'systemType' | 'nominalTons' | 'totalCapacity' | 'sensibleCapacity'
  | 'heatingCapacity' | 'nominalCfm' | 'minCfm' | 'maxCfm' | 'esp' | 'length' | 'width' | 'height'
  | 'weight' | 'refrigerant' | 'power' | 'seer' | 'eer' | 'cop' | 'noise';

interface FieldDef { key: FieldKey; label: string; kind: Kind; aliases: string[] }

/** unit -> factor to imperial base (Btu/h, CFM, in.wg, in, lb, kW). */
const UNITS: Record<Kind, Record<string, number>> = {
  capacity: { 'btu/h': 1, btuh: 1, 'btu/hr': 1, btu: 1, 'kbtu/h': 1000, kbtuh: 1000, mbh: 1000, w: BTUH_PER_W, kw: BTUH_PER_W * 1000, tons: BTUH_PER_TON, ton: BTUH_PER_TON, tr: BTUH_PER_TON },
  airflow: { cfm: 1, 'l/s': CFM_PER_LPS, lps: CFM_PER_LPS, ls: CFM_PER_LPS, 'm3/h': CFM_PER_LPS / 3.6, cmh: CFM_PER_LPS / 3.6, 'm3/s': CFM_PER_LPS * 1000 },
  pressure: { 'in.wg': 1, inwg: 1, iwg: 1, pa: 1 / PA_PER_INWG, kpa: 1000 / PA_PER_INWG },
  length: { in: 1, inch: 1, inches: 1, mm: 1 / MM_PER_IN, cm: 10 / MM_PER_IN, m: 1000 / MM_PER_IN },
  weight: { lb: 1, lbs: 1, kg: 2.20462 },
  power: { kw: 1, w: 0.001, hp: 0.7457 },
  number: { '': 1 },
  text: { '': 1 },
  noise: { dba: 1, db: 1 }
};
const DEFAULT_UNIT: Record<Kind, string> = {
  capacity: 'btu/h', airflow: 'cfm', pressure: 'in.wg', length: 'in', weight: 'lb', power: 'kw', number: '', text: '', noise: 'dba'
};

const FIELDS: FieldDef[] = [
  { key: 'model', label: 'Model', kind: 'text', aliases: ['model', 'modelnumber', 'modelno', 'modelname'] },
  { key: 'manufacturer', label: 'Manufacturer', kind: 'text', aliases: ['manufacturer', 'brand', 'make', 'mfr'] },
  { key: 'systemType', label: 'System Type', kind: 'text', aliases: ['systemtype', 'family', 'type', 'unittype', 'productfamily'] },
  { key: 'nominalTons', label: 'Nominal Tons', kind: 'capacity', aliases: ['nominaltons', 'tons', 'nominalcapacity'] },
  { key: 'totalCapacity', label: 'Total Capacity', kind: 'capacity', aliases: ['totalcapacity', 'capacity', 'coolingcapacity', 'totalcoolingcapacity', 'ratedcapacity'] },
  { key: 'sensibleCapacity', label: 'Sensible Capacity', kind: 'capacity', aliases: ['sensiblecapacity', 'sensiblecooling', 'sensiblecoolingcapacity'] },
  { key: 'heatingCapacity', label: 'Heating Capacity', kind: 'capacity', aliases: ['heatingcapacity', 'heatcapacity'] },
  { key: 'nominalCfm', label: 'Nominal Airflow', kind: 'airflow', aliases: ['nominalcfm', 'nominalairflow', 'airflow', 'ratedairflow', 'cfm'] },
  { key: 'minCfm', label: 'Min Airflow', kind: 'airflow', aliases: ['mincfm', 'minairflow', 'minimumairflow'] },
  { key: 'maxCfm', label: 'Max Airflow', kind: 'airflow', aliases: ['maxcfm', 'maxairflow', 'maximumairflow'] },
  { key: 'esp', label: 'ESP', kind: 'pressure', aliases: ['esp', 'externalstaticpressure', 'ratedesp', 'maxesp', 'staticpressure'] },
  { key: 'length', label: 'Length', kind: 'length', aliases: ['length', 'depth', 'l'] },
  { key: 'width', label: 'Width', kind: 'length', aliases: ['width', 'w'] },
  { key: 'height', label: 'Height', kind: 'length', aliases: ['height', 'h'] },
  { key: 'weight', label: 'Weight', kind: 'weight', aliases: ['weight', 'unitweight', 'operatingweight'] },
  { key: 'refrigerant', label: 'Refrigerant', kind: 'text', aliases: ['refrigerant'] },
  { key: 'power', label: 'Power', kind: 'power', aliases: ['power', 'electricalpower', 'powerinput', 'electricalkw', 'inputpower'] },
  { key: 'seer', label: 'SEER', kind: 'number', aliases: ['seer', 'seer2'] },
  { key: 'eer', label: 'EER', kind: 'number', aliases: ['eer'] },
  { key: 'cop', label: 'COP', kind: 'number', aliases: ['cop', 'copcooling'] },
  { key: 'noise', label: 'Noise', kind: 'noise', aliases: ['noise', 'noisedba', 'sound', 'sounddba', 'soundlevel', 'soundpressure'] }
];

/** Suffixes recognised on un-parenthesised headers, e.g. "totalCapacityBtuh", "Nominal_CFM". */
const SUFFIXES: Array<[string, string]> = [
  ['kbtuh', 'kbtuh'], ['btuh', 'btuh'], ['kw', 'kw'], ['lps', 'lps'], ['cfm', 'cfm'], ['inwg', 'inwg'],
  ['tons', 'tons'], ['mm', 'mm'], ['kg', 'kg'], ['lb', 'lb'], ['dba', 'dba']
];

const normUnit = (u: string): string => {
  const t = u.toLowerCase().replace(/³/g, '3').replace(/\s+/g, '');
  return /^in\.?w\.?[gc]\.?$/.test(t) ? 'in.wg' : t;
};
const normKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

interface ParsedHeader { def: FieldDef; unit: string; factor: number; col: number }

function parseHeader(raw: string): { name: string; unit: string | null } {
  const h = raw.trim().replace(/db\s*\(\s*a\s*\)/gi, 'dba');
  const m = h.match(/^(.*?)\s*[([]\s*([^)\]]+?)\s*[)\]]\s*$/);
  if (m) return { name: m[1], unit: normUnit(m[2]) };
  return { name: h, unit: null };
}

function mapHeaders(headers: unknown[], errors: CatalogImportError[]): Map<FieldKey, ParsedHeader> {
  const out = new Map<FieldKey, ParsedHeader>();
  headers.forEach((hv, col) => {
    const raw = String(hv ?? '').trim();
    if (!raw) return;
    const { name, unit: parenUnit } = parseHeader(raw);
    const key = normKey(name);
    let unit = parenUnit;
    let def = FIELDS.find((f) => f.aliases.includes(key));
    if (!def) {
      for (const [suf, u] of SUFFIXES) {
        if (key.endsWith(suf) && key.length > suf.length) {
          const d = FIELDS.find((f) => f.aliases.includes(key.slice(0, -suf.length)));
          if (d) { def = d; unit = unit ?? u; break; }
        }
      }
    }
    if (!def) return; // unknown columns are ignored
    if (out.has(def.key)) return;
    const table = UNITS[def.kind];
    const resolved = unit ?? (def.key === 'nominalTons' ? 'tons' : DEFAULT_UNIT[def.kind]);
    const factor = table[resolved];
    if (factor === undefined) {
      errors.push({ row: 1, field: raw, message: `Unsupported unit "${resolved}" for ${def.label}. Accepted: ${Object.keys(table).join(', ')}` });
      return;
    }
    out.set(def.key, { def, unit: resolved, factor, col });
  });
  return out;
}

const TYPE_MAP: Array<[RegExp, EquipmentCatalogItem['systemType']]> = [
  [/^(concealed|ducted|concealedducted|ductedsplit|concealedsplit)$/, 'concealed'],
  [/^(cassette|4waycassette|ceilingcassette)$/, 'cassette'],
  [/^(highwall|wall|wallsplit|minisplit|wallmounted|hw)$/, 'high-wall'],
  [/^(packaged|rtu|rooftop|packagedrtu|packagedunit)$/, 'packaged'],
  [/^(vrf|vrv)$/, 'vrf'],
  [/^(ahu|airhandler|airhandlingunit)$/, 'ahu'],
  [/^(fcu|fancoil|fancoilunit)$/, 'fcu']
];

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;
export const TEMPLATE_EXAMPLE_MODEL = 'EXAMPLE-DELETE-ME';

function capsFor(type: EquipmentCatalogItem['systemType']): EquipmentCatalogItem['capabilities'] {
  const ref = STANDARD_EQUIPMENT_CATALOG.find((e) => e.systemType === type);
  if (ref) return { ...ref.capabilities };
  const ducted = type === 'concealed' || type === 'packaged' || type === 'ahu' || type === 'fcu';
  return {
    supportsDuctNetwork: ducted, supportsExternalDiffusers: ducted, supportsReturnDuct: ducted,
    supportsMultipleZones: type === 'vrf' || type === 'ahu', requiresIndoorUnitSelection: type !== 'ahu' && type !== 'packaged',
    hasExternalStaticPressure: ducted
  };
}

/** Parse sheet rows (array of arrays, row 0 = headers) into validated catalog entries. */
export function parseCatalogRows(rows: unknown[][], sourceName = 'import'): CatalogImportResult {
  const errors: CatalogImportError[] = [];
  const entries: EquipmentCatalogItem[] = [];
  if (!rows.length) return { entries, errors: [{ row: 1, field: '(header)', message: 'File is empty.' }] };
  const cols = mapHeaders(rows[0], errors);
  for (const need of ['model', 'manufacturer', 'systemType', 'nominalCfm', 'length', 'width', 'height'] as FieldKey[]) {
    if (!cols.has(need)) errors.push({ row: 1, field: need, message: `Required column missing: ${FIELDS.find((f) => f.key === need)!.label}.` });
  }
  if (!cols.has('totalCapacity') && !cols.has('nominalTons')) {
    errors.push({ row: 1, field: 'totalCapacity', message: 'Required column missing: Total Capacity or Nominal Tons.' });
  }
  if (errors.length) return { entries, errors };

  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (row.every((c) => c === undefined || c === null || String(c).trim() === '')) continue;
    const rowNo = i + 1;
    const errs: CatalogImportError[] = [];
    const bad = (field: string, message: string): void => { errs.push({ row: rowNo, field, message }); };
    const text = (k: FieldKey): string => { const c = cols.get(k); return c ? String(row[c.col] ?? '').trim() : ''; };
    const num = (k: FieldKey): number | undefined => {
      const c = cols.get(k);
      if (!c) return undefined;
      const v = row[c.col];
      if (v === undefined || v === null || String(v).trim() === '') return undefined;
      const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
      if (!Number.isFinite(n)) { bad(c.def.label, `"${String(v)}" is not a number.`); return undefined; }
      return n * c.factor;
    };

    const model = text('model');
    if (model === TEMPLATE_EXAMPLE_MODEL) continue;
    const manufacturer = text('manufacturer');
    if (!model) bad('Model', 'Model is required.');
    if (!manufacturer) bad('Manufacturer', 'Manufacturer is required.');
    const typeNorm = normKey(text('systemType'));
    const systemType = TYPE_MAP.find(([re]) => re.test(typeNorm))?.[1];
    if (!systemType) bad('System Type', `Unknown system type "${text('systemType')}". Use concealed, cassette, high-wall, packaged, vrf, ahu or fcu.`);
    if (model && seen.has(model.toLowerCase())) bad('Model', `Duplicate model "${model}" in file.`);

    const totalIn = num('totalCapacity');
    const tonsBtu = num('nominalTons'); // converted to Btu/h by the unit factor
    let nominalTons = tonsBtu !== undefined ? tonsBtu / BTUH_PER_TON : undefined;
    const total = totalIn ?? tonsBtu;
    if (total === undefined) bad('Total Capacity', 'Total capacity (or nominal tons) is required.');
    else if (!(total > 0)) bad('Total Capacity', 'Total capacity must be > 0.');
    if (nominalTons === undefined && total !== undefined) nominalTons = r2(total / BTUH_PER_TON);
    if (nominalTons !== undefined && total !== undefined && total > 0 && nominalTons > 0) {
      const ratio = total / (nominalTons * BTUH_PER_TON);
      if (ratio < 0.9 || ratio > 1.1) bad('Total Capacity', `Capacity ${Math.round(total)} Btu/h is ${(ratio * 100).toFixed(0)}% of nominal ${nominalTons} tons (must be within 90-110%).`);
    }
    const sensIn = num('sensibleCapacity');
    const sensible = sensIn ?? (total !== undefined ? total * 0.75 : undefined);
    if (sensIn !== undefined && total !== undefined && sensIn > total * 1.0001) bad('Sensible Capacity', 'Sensible capacity must be <= total capacity.');
    if (sensIn !== undefined && !(sensIn > 0)) bad('Sensible Capacity', 'Sensible capacity must be > 0.');
    const heating = num('heatingCapacity');

    const nomCfm = num('nominalCfm');
    if (nomCfm === undefined || !(nomCfm > 0)) bad('Nominal Airflow', 'Nominal airflow is required and must be > 0.');
    const minCfm = num('minCfm') ?? (nomCfm !== undefined ? nomCfm * 0.8 : undefined);
    const maxCfm = num('maxCfm') ?? (nomCfm !== undefined ? nomCfm * 1.2 : undefined);
    if (nomCfm !== undefined && nomCfm > 0 && nominalTons !== undefined && nominalTons > 0) {
      const cpt = nomCfm / nominalTons;
      if (cpt < 300 || cpt > 500) bad('Nominal Airflow', `${Math.round(cpt)} CFM/ton is outside 300-500 CFM/ton.`);
    }
    if (nomCfm !== undefined && minCfm !== undefined && maxCfm !== undefined && !(minCfm <= nomCfm + 1e-6 && nomCfm <= maxCfm + 1e-6)) {
      bad('Min/Max Airflow', 'Require min airflow <= nominal <= max airflow.');
    }

    const needsEsp = systemType === 'concealed' || systemType === 'packaged' || systemType === 'ahu';
    const esp = num('esp');
    if (needsEsp && esp === undefined) bad('ESP', `ESP is required for ${systemType} units.`);
    if (esp !== undefined && esp < 0) bad('ESP', 'ESP must be >= 0.');

    const L = num('length'), W = num('width'), H = num('height');
    if (!(L !== undefined && L > 0)) bad('Length', 'Length must be a positive number.');
    if (!(W !== undefined && W > 0)) bad('Width', 'Width must be a positive number.');
    if (!(H !== undefined && H > 0)) bad('Height', 'Height must be a positive number.');
    const weight = num('weight');
    if (weight !== undefined && !(weight > 0)) bad('Weight', 'Weight must be > 0.');
    const power = num('power');
    if (power !== undefined && power < 0) bad('Power', 'Power must be >= 0.');
    const seer = num('seer'), eer = num('eer'), cop = num('cop'), noise = num('noise');
    if (seer !== undefined && !(seer > 0)) bad('SEER', 'SEER must be > 0.');
    if (eer !== undefined && !(eer > 0)) bad('EER', 'EER must be > 0.');

    if (errs.length) { errors.push(...errs); continue; }
    seen.add(model.toLowerCase());

    const sType = systemType!;
    const nom = nomCfm!;
    const ratedEsp = esp ?? 0;
    const caps = capsFor(sType);
    const ducted = caps.hasExternalStaticPressure;
    entries.push({
      id: `imp-${slug(manufacturer)}-${slug(model)}`,
      manufacturer,
      model,
      systemType: sType,
      isGeneric: false,
      source: 'imported',
      capabilities: caps,
      nominalTons: r2(nominalTons!),
      totalCapacityBtuPerHour: Math.round(total!),
      sensibleCapacityBtuPerHour: Math.round(sensible!),
      ...(heating !== undefined ? { heatingCapacityBtuPerHour: Math.round(heating) } : {}),
      nominalCfm: Math.round(nom),
      minCfm: Math.round(minCfm!),
      maxCfm: Math.round(maxCfm!),
      maxRatedEspInWg: r2(ratedEsp),
      // Only the manufacturer-rated point is known; no fan curve is invented.
      fanPerformance: ducted
        ? { type: 'tabular', allowExtrapolation: false, table: [{ cfm: Math.round(nom), espInWg: r2(ratedEsp), ...(power !== undefined ? { powerKw: r2(power) } : {}), ...(noise !== undefined ? { soundDba: noise } : {}) }] }
        : { type: 'multi-speed', allowExtrapolation: false, speeds: { High: [{ cfm: Math.round(nom), espInWg: 0, ...(noise !== undefined ? { soundDba: noise } : {}) }] } },
      electricalKw: power !== undefined ? r2(power) : 0,
      efficiency: {
        ...(seer !== undefined ? { seer } : {}),
        ...(eer !== undefined ? { eer } : {}),
        ...(cop !== undefined ? { copCooling: cop } : eer !== undefined ? { copCooling: r2(eer / BTUH_PER_W / 1) } : {}),
        ratingStandard: 'Manufacturer data (as imported)',
        ratingConditions: 'As published by manufacturer'
      },
      soundDba: noise ?? 0,
      dimensionsIn: { width: r1(W!), depth: r1(L!), height: r1(H!) },
      connectionSizes: {},
      costIndex: 50,
      refrigerant: text('refrigerant') || undefined,
      weightLb: weight !== undefined ? r1(weight) : undefined,
      provenance: { source: `Imported: ${sourceName}`, version: 'user-import', isUserImported: true, isDemonstrationOnly: false }
    });
  }
  return { entries, errors };
}

/** Parse an .xlsx/.xls/.csv file (ArrayBuffer/Uint8Array) or CSV text. */
export function parseCatalogFile(data: ArrayBuffer | Uint8Array | string, fileName = 'import'): CatalogImportResult {
  try {
    const wb = typeof data === 'string'
      ? XLSX.read(data, { type: 'string' })
      : XLSX.read(data instanceof Uint8Array ? data : new Uint8Array(data), { type: 'array' });
    const sheetName = wb.SheetNames.includes('Catalog') ? 'Catalog' : wb.SheetNames[0];
    if (!sheetName) return { entries: [], errors: [{ row: 1, field: '(file)', message: 'Workbook has no sheets.' }] };
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: '', raw: true });
    return parseCatalogRows(rows, fileName);
  } catch (e) {
    return { entries: [], errors: [{ row: 1, field: '(file)', message: `Could not read file: ${(e as Error).message}` }] };
  }
}

const TEMPLATE_HEADERS = [
  'Model', 'Manufacturer', 'System Type', 'Nominal Tons', 'Total Capacity (Btu/h)', 'Sensible Capacity (Btu/h)',
  'Nominal Airflow (CFM)', 'Min Airflow (CFM)', 'Max Airflow (CFM)', 'ESP (in.wg)',
  'Length (in)', 'Width (in)', 'Height (in)', 'Weight (lb)', 'Refrigerant', 'Power (kW)', 'SEER', 'EER', 'Noise (dB(A))'
];
const TEMPLATE_EXAMPLE = [
  TEMPLATE_EXAMPLE_MODEL, 'Example Manufacturer', 'concealed', 2, 24000, 18000, 800, 640, 960, 0.5, 40, 24, 10, 85, 'R-410A', 2.0, 16, 11.5, 42
];

/** Build an .xlsx template (Catalog sheet with one example row + Instructions sheet). */
export function exportCatalogTemplate(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, TEMPLATE_EXAMPLE]), 'Catalog');
  const help: string[][] = [
    ['Column', 'Required', 'Units accepted (put the unit in the header, e.g. "Total Capacity (kW)")'],
    ['Model / Manufacturer', 'yes', 'text'],
    ['System Type', 'yes', 'concealed, cassette, high-wall, packaged, vrf, ahu, fcu'],
    ['Nominal Tons / Total Capacity', 'one of', 'Tons; Btu/h, kBtu/h, MBH, W, kW'],
    ['Sensible Capacity', 'no', 'same as capacity; default 0.75 x total; must be <= total'],
    ['Nominal / Min / Max Airflow', 'nominal yes', 'CFM, L/s, m3/h; nominal must be 300-500 CFM per ton'],
    ['ESP', 'ducted types', 'in.wg, Pa'],
    ['Length / Width / Height', 'yes', 'in, mm, cm, m (must be > 0)'],
    ['Weight', 'no', 'lb, kg'],
    ['Power', 'no', 'kW, W, hp'],
    ['SEER / EER / COP', 'no', 'number'],
    ['Noise', 'no', 'dB(A)'],
    ['Note', '', `Delete the example row (model ${TEMPLATE_EXAMPLE_MODEL}); it is ignored on import. Capacity must be within +/-10% of nominal tons x 12000 Btu/h.`]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(help), 'Instructions');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array | number[];
  if (out instanceof ArrayBuffer) return out;
  const u8 = Uint8Array.from(out as ArrayLike<number>);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}
