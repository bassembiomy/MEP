import * as XLSX from 'xlsx';
import { parseCatalogFile, exportCatalogTemplate } from '../catalogImport';
import { STANDARD_EQUIPMENT_CATALOG, setEquipmentCatalogProvider, getEquipmentCatalog, isGenericModel } from '../hvacCatalogs';
import { generateSystemCandidates } from '../systemDesigner';
import { computeActiveCatalog } from '../../store/catalogStore';

function assert(c: boolean, m: string): void { if (!c) throw new Error(`Assertion Failed: ${m}`); }
function near(a: number, b: number, tol: number, m: string): void { assert(Math.abs(a - b) <= tol, `${m}: got ${a}, expected ${b}`); }

console.log('=== Catalog import tests ===');

function book(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Catalog');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return out;
}

// 1. Generic flags
{
  const generic = STANDARD_EQUIPMENT_CATALOG.filter((e) => e.isGeneric);
  assert(generic.length === 17, `17 generic entries, got ${generic.length}`);
  assert(generic.every((e) => e.source === 'generic' && e.model.includes('-G')), 'generic flagged');
  assert(STANDARD_EQUIPMENT_CATALOG.filter((e) => !e.isGeneric).every((e) => e.source === 'built-in'), 'others built-in');
  assert(isGenericModel('40KMC012-G'), 'isGenericModel');
  console.log('1 ok');
}

// 2. Imperial headers
const impHeaders = ['Model', 'Manufacturer', 'Family', 'Total Capacity (Btu/h)', 'Sensible Capacity (Btu/h)', 'Nominal Airflow (CFM)', 'ESP (in.wg)', 'Length (in)', 'Width (in)', 'Height (in)', 'Weight (lb)', 'Power (kW)', 'SEER', 'Noise (dB(A))'];
{
  const res = parseCatalogFile(book([
    impHeaders,
    ['REAL-24', 'Acme', 'ducted', 24000, 18000, 800, 0.5, 40, 24, 10, 85, 2.0, 16, 42]
  ]), 'imp.xlsx');
  assert(res.errors.length === 0, `no errors: ${JSON.stringify(res.errors)}`);
  const e = res.entries[0];
  assert(e.systemType === 'concealed' && e.source === 'imported' && !e.isGeneric, 'type/source');
  near(e.nominalTons, 2, 0.01, 'tons');
  near(e.totalCapacityBtuPerHour, 24000, 1, 'btuh');
  near(e.dimensionsIn.depth, 40, 0.01, 'length->depth');
  near(e.soundDba, 42, 0.01, 'noise');
  console.log('2 ok');
}

// 3. Metric headers convert
{
  const res = parseCatalogFile(book([
    ['Model', 'Manufacturer', 'System Type', 'Capacity (kW)', 'Sensible Capacity (kW)', 'Airflow (L/s)', 'ESP (Pa)', 'Length (mm)', 'Width (mm)', 'Height (mm)', 'Weight (kg)', 'Power (kW)'],
    ['MET-7', 'Acme', 'ducted', 7.034, 5.3, 377.6, 124.5, 1016, 610, 254, 38.5, 2.0]
  ]), 'met.xlsx');
  assert(res.errors.length === 0, `no errors: ${JSON.stringify(res.errors)}`);
  const e = res.entries[0];
  near(e.totalCapacityBtuPerHour, 24000, 20, 'kW->Btu/h');
  near(e.nominalCfm, 800, 2, 'L/s->CFM');
  near(e.maxRatedEspInWg, 0.5, 0.01, 'Pa->in.wg');
  near(e.dimensionsIn.depth, 40, 0.05, 'mm->in');
  near(e.weightLb!, 84.9, 0.2, 'kg->lb');
  console.log('3 ok');
}

// 4. Invalid rows reported with row/field, valid rows kept
{
  const res = parseCatalogFile(book([
    impHeaders,
    ['OK-24', 'Acme', 'ducted', 24000, 18000, 800, 0.5, 40, 24, 10, 85, 2.0, 16, 42],
    ['BAD-SENS', 'Acme', 'ducted', 24000, 25000, 800, 0.5, 40, 24, 10, 85, 2.0, 16, 42],
    ['BAD-CFM', 'Acme', 'ducted', 24000, 18000, 1200, 0.5, 40, 24, 10, 85, 2.0, 16, 42],
    ['BAD-DIM', 'Acme', 'ducted', 24000, 18000, 800, 0.5, 0, 24, 10, 85, 2.0, 16, 42],
    ['BAD-TYPE', 'Acme', 'spaceship', 24000, 18000, 800, 0.5, 40, 24, 10, 85, 2.0, 16, 42],
    ['OK-24', 'Acme', 'ducted', 24000, 18000, 800, 0.5, 40, 24, 10, 85, 2.0, 16, 42]
  ]), 'bad.xlsx');
  assert(res.entries.length === 1 && res.entries[0].model === 'OK-24', 'only valid row kept');
  const f = (row: number, field: string): boolean => res.errors.some((x) => x.row === row && x.field === field);
  assert(f(3, 'Sensible Capacity'), 'sensible>total reported on row 3');
  assert(f(4, 'Nominal Airflow'), 'cfm/ton reported on row 4');
  assert(f(5, 'Length'), 'dim reported on row 5');
  assert(f(6, 'System Type'), 'type reported on row 6');
  assert(f(7, 'Model'), 'duplicate reported on row 7');
  // capacity vs nominal tons +/-10%
  const cap = parseCatalogFile(book([
    ['Model', 'Manufacturer', 'Family', 'Nominal Tons', 'Total Capacity (Btu/h)', 'Nominal Airflow (CFM)', 'ESP (in.wg)', 'Length (in)', 'Width (in)', 'Height (in)'],
    ['CAP', 'Acme', 'ducted', 2, 30000, 800, 0.5, 40, 24, 10]
  ]));
  assert(cap.errors.some((x) => x.field === 'Total Capacity'), 'capacity vs nominal reported');
  const missing = parseCatalogFile(book([['Model', 'Manufacturer']]));
  assert(missing.errors.length > 0 && missing.entries.length === 0, 'missing columns reported');
  console.log('4 ok');
}

// 5. CSV + template round trip
{
  const csv = 'Model,Manufacturer,Type,Capacity (kW),Airflow (L/s),Length (mm),Width (mm),Height (mm)\nWALL-3,Acme,wall,3.516,141.6,900,300,220\n';
  const res = parseCatalogFile(csv, 'x.csv');
  assert(res.errors.length === 0 && res.entries.length === 1 && res.entries[0].systemType === 'high-wall', `csv ok ${JSON.stringify(res.errors)}`);
  const tpl = exportCatalogTemplate();
  assert(tpl.byteLength > 0, 'template bytes');
  const back = parseCatalogFile(tpl, 'tpl.xlsx');
  assert(back.errors.length === 0 && back.entries.length === 0, 'template example row is ignored, no errors');
  const wb = XLSX.read(new Uint8Array(tpl), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Catalog'], { header: 1 });
  assert(rows.length === 2, 'template has header + example');
  // example row itself is valid if its model is renamed
  rows[1][0] = 'REAL-EXAMPLE';
  const v = parseCatalogFile(book(rows as unknown[][]), 'ex.xlsx');
  assert(v.errors.length === 0 && v.entries.length === 1, `example row is valid ${JSON.stringify(v.errors)}`);
  console.log('5 ok');
}

// 6. Active catalog composition + provider override drives generateSystemCandidates
{
  const imp = parseCatalogFile(book([
    impHeaders,
    ['REAL-36', 'Acme', 'ducted', 36000, 27000, 1200, 0.6, 50, 26, 12, 110, 3.0, 16, 44],
    ['Optimax 9K-G', 'Acme', 'high-wall', 9000, 7000, 300, 0, 30, 8, 11, 20, 0.8, 20, 36]
  ]), 'o.xlsx').entries;
  assert(imp.length === 2, 'two imported');
  const cats = [{ id: 'c1', name: 'c1', importedAt: 0, enabled: true, entries: imp }];
  const noGeneric = computeActiveCatalog(cats, false);
  assert(!noGeneric.some((e) => e.isGeneric && e.model !== 'Optimax 9K-G'), 'generic removed');
  const ov = noGeneric.find((e) => e.model === 'Optimax 9K-G');
  assert(ov?.source === 'imported', 'imported overrides built-in/generic on same model');
  assert(computeActiveCatalog([{ ...cats[0], enabled: false }], true).length === STANDARD_EQUIPMENT_CATALOG.length, 'disabled catalog ignored');

  setEquipmentCatalogProvider(null); // importing catalogStore installs the store provider
  assert(getEquipmentCatalog() === STANDARD_EQUIPMENT_CATALOG, 'default provider is the static catalog');
  const base = generateSystemCandidates(34000, 25000, 1100, 'office', 800, true, {}, ['concealed']).candidates;
  setEquipmentCatalogProvider(() => imp);
  try {
    const over = generateSystemCandidates(34000, 25000, 1100, 'office', 800, true, {}, ['concealed']).candidates;
    const models = new Set(over.map((c) => c.equipment.model));
    assert(over.length > 0 && [...models].every((m) => m === 'REAL-36' || m === 'Optimax 9K-G'), `candidates come from provider: ${[...models].join(',')}`);
    assert(over.some((c) => c.equipment.model === 'REAL-36'), 'REAL-36 selected');
  } finally {
    setEquipmentCatalogProvider(null);
  }
  assert(base.every((c) => !c.equipment.model.startsWith('REAL-')), 'static catalog restored');
  console.log('6 ok');
}

console.log('=== Catalog import tests passed ===');
