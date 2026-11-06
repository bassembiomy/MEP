/**
 * NFPA 13-2019 automatic sprinkler data: occupancy classification, spacing rules, pipe schedule, dry / preaction
 * limits, hanger spacing, spare heads, Hazen-Williams C-factors, design questionnaire and system-type recommendation.
 * Pure data + small helpers (no I/O).
 */
import type { HazardClass } from '../fpTypes';
import type { BuildingType, SprinklerAnswers, SprinklerSystemType } from './sprinklerTypes';

// ─────────────────────────── Occupancy classification (NFPA 13 Annex A.4.3) ───────────────────────────

export interface SprinklerOccupancy {
  label: string;
  hazard: HazardClass;
  keywords: string[];
}

/** Occupancy → hazard classification (NFPA 13-2019 §4.3, Annex A.4.3). Table order is the keyword search order. */
export const SPRINKLER_OCCUPANCIES: Record<string, SprinklerOccupancy> = {
  office: { label: 'Office', hazard: 'light', keywords: ['office', 'meeting', 'conference', 'admin', 'reception'] },
  corridor: { label: 'Corridor / lobby', hazard: 'light', keywords: ['corridor', 'lobby', 'hall', 'foyer', 'passage', 'entrance'] },
  toilet: { label: 'Toilet / washroom', hazard: 'light', keywords: ['toilet', 'wc', 'bath', 'washroom', 'restroom', 'shower'] },
  residential: { label: 'Dwelling unit / hotel room', hazard: 'light', keywords: ['bedroom', 'living', 'apartment', 'flat', 'suite', 'guest'] },
  healthcare: { label: 'Patient / clinical', hazard: 'light', keywords: ['patient', 'ward', 'clinic', 'exam', 'nurse'] },
  education: { label: 'Classroom', hazard: 'light', keywords: ['class', 'lecture', 'lab', 'school'] },
  assembly: { label: 'Assembly / dining', hazard: 'light', keywords: ['dining', 'restaurant', 'cafe', 'hall', 'auditorium', 'church', 'theater', 'theatre'] },
  data: { label: 'Computer / data room', hazard: 'ordinary-1', keywords: ['server', 'data', 'it room', 'comms', 'telecom'] },
  kitchen: { label: 'Commercial kitchen', hazard: 'ordinary-1', keywords: ['kitchen', 'pantry', 'cook'] },
  parking: { label: 'Parking garage', hazard: 'ordinary-1', keywords: ['parking', 'garage', 'car park'] },
  mechanical: { label: 'Mechanical / electrical', hazard: 'ordinary-1', keywords: ['mech', 'plant', 'electrical', 'elec', 'boiler', 'pump', 'generator', 'hvac'] },
  laundry: { label: 'Laundry', hazard: 'ordinary-1', keywords: ['laundry'] },
  mercantile: { label: 'Retail / mercantile', hazard: 'ordinary-2', keywords: ['retail', 'shop', 'store front', 'showroom', 'mall'] },
  storage: { label: 'Storage (≤ 12 ft)', hazard: 'ordinary-2', keywords: ['storage', 'store', 'stock', 'archive', 'warehouse', 'depot'] },
  'library-stack': { label: 'Library stack', hazard: 'ordinary-2', keywords: ['stack', 'library'] },
  workshop: { label: 'Workshop / light industrial', hazard: 'ordinary-2', keywords: ['workshop', 'repair', 'printing', 'factory', 'production'] },
  'extra-1': { label: 'Extra hazard group 1', hazard: 'extra-1', keywords: ['hangar', 'sawmill', 'foam', 'die casting'] },
  'extra-2': { label: 'Extra hazard group 2', hazard: 'extra-2', keywords: ['spray booth', 'flammable', 'solvent', 'varnish', 'plastics'] }
};

const BUILDING_DEFAULT_OCCUPANCY: Record<BuildingType, string> = {
  office: 'office',
  residential: 'residential',
  hotel: 'residential',
  healthcare: 'healthcare',
  education: 'education',
  mercantile: 'mercantile',
  assembly: 'assembly',
  restaurant: 'assembly',
  parking: 'parking',
  'storage-low-piled': 'storage',
  industrial: 'workshop',
  'data-center': 'data',
  mixed: 'office'
};

/** Occupancy key for a room name (first table entry whose keyword occurs, case-insensitive), else the building default. */
export function occupancyFromName(name: string, buildingType: BuildingType): string {
  const n = name.toLowerCase();
  for (const key of Object.keys(SPRINKLER_OCCUPANCIES)) {
    if (SPRINKLER_OCCUPANCIES[key].keywords.some((k) => n.includes(k))) return key;
  }
  return BUILDING_DEFAULT_OCCUPANCY[buildingType] ?? 'office';
}

// ─────────────────────────── Spacing (Table 10.2.4.2.1(a)–(d)) ───────────────────────────

export type SpacingClass = 'light' | 'ordinary' | 'extra';

/** Standard pendent / upright spray sprinklers, hydraulically calculated, unobstructed construction. */
export const SPACING_RULES: Record<SpacingClass, { maxAreaFt2: number; maxSpacingFt: number }> = {
  light: { maxAreaFt2: 225, maxSpacingFt: 15 },
  ordinary: { maxAreaFt2: 130, maxSpacingFt: 15 },
  extra: { maxAreaFt2: 100, maxSpacingFt: 12 }
};

export function spacingClass(h: HazardClass): SpacingClass {
  if (h === 'light') return 'light';
  if (h === 'ordinary-1' || h === 'ordinary-2') return 'ordinary';
  return 'extra';
}

/** Minimum distance between sprinklers, 6 ft (NFPA 13-2019 §10.2.5.3). */
export const MIN_SPRINKLER_SPACING_MM = 1829;
/** Minimum distance from a wall, 4 in (NFPA 13-2019 §10.2.5.2.3). */
export const MIN_WALL_DISTANCE_MM = 102;
/** Deflector distance below the ceiling, 1 in – 12 in (NFPA 13-2019 §10.2.6.1.1). */
export const DEFLECTOR_RANGE_MM: [number, number] = [25, 305];

// ─────────────────────────── Pipe schedule (NFPA 13-2019 §28.5) ───────────────────────────

/** Maximum number of sprinklers per steel pipe size (initial sizing; verified hydraulically). */
export const PIPE_SCHEDULE_LIMITS: Record<SpacingClass, Record<number, number>> = {
  light: { 1: 2, 1.25: 3, 1.5: 5, 2: 10, 2.5: 30, 3: 60, 3.5: 100, 4: Infinity },
  ordinary: { 1: 2, 1.25: 3, 1.5: 5, 2: 10, 2.5: 20, 3: 40, 3.5: 65, 4: 100, 5: 160, 6: 275, 8: Infinity },
  extra: { 1: 1, 1.25: 2, 1.5: 5, 2: 8, 2.5: 15, 3: 27, 3.5: 40, 4: 55, 5: 90, 6: 150, 8: Infinity }
};

/** Smallest pipe-schedule size whose sprinkler limit is at least `count`. */
export function pipeScheduleSize(count: number, cls: SpacingClass): number {
  const table = PIPE_SCHEDULE_LIMITS[cls];
  const sizes = Object.keys(table).map(Number).sort((a, b) => a - b);
  for (const s of sizes) if (table[s] >= count) return s;
  return sizes[sizes.length - 1];
}

// ─────────────────────────── Dry / preaction ───────────────────────────

/** Maximum water delivery time to the test connection, s (NFPA 13-2019 Table 8.2.3.6.1). */
export const DRY_DELIVERY_TIME_S: Record<SpacingClass, number> = { light: 60, ordinary: 50, extra: 45 };
/** Dry system capacity without a quick-opening device, gal (§8.2.3.2). */
export const DRY_CAPACITY_NO_QOD_GAL = 500;
/** Dry system capacity with a quick-opening device, gal (§8.2.3.3). */
export const DRY_CAPACITY_WITH_QOD_GAL = 750;
/** Maximum closed sprinklers controlled by one preaction valve (§8.3.2.6). */
export const PREACTION_MAX_CLOSED_SPRINKLERS = 1000;
/** Design area increase for dry-pipe and double-interlock preaction systems (§19.3.3.2.5). */
export const DRY_AREA_INCREASE = 1.3;
/** Pitch of dry-system pipe, mm per m: branch lines ½ in / 10 ft, mains ¼ in / 10 ft (§16.10.3.2). */
export const DRY_SLOPE_BRANCH_MM_PER_M = 4;
export const DRY_SLOPE_MAIN_MM_PER_M = 2;

// ─────────────────────────── Hangers, spares, friction ───────────────────────────

/** Maximum hanger spacing, m (NFPA 13-2019 Table 17.4.2.1(a); CPVC per listing). */
export function hangerSpacingM(sizeIn: number, material: SprinklerAnswers['pipeMaterial']): number {
  if (material === 'cpvc') {
    if (sizeIn <= 1) return 1.68;
    if (sizeIn <= 1.25) return 1.83;
    if (sizeIn <= 1.5) return 2.13;
    return 2.44;
  }
  return sizeIn <= 1 ? 3.66 : 4.57;
}

/** Spare sprinklers kept in the cabinet (NFPA 13-2019 §16.2.7.3). */
export function spareHeadCount(total: number): number {
  if (total <= 300) return 6;
  if (total <= 1000) return 12;
  return 24;
}

/** Hazen-Williams C (NFPA 13-2019 Table 28.2.4.8.1). */
export function hazenC(material: SprinklerAnswers['pipeMaterial'], systemType: SprinklerSystemType): number {
  if (material === 'cpvc' || material === 'copper-type-l') return 150;
  return systemType === 'wet' ? 120 : 100;
}

// ─────────────────────────── Questionnaire ───────────────────────────

export interface QuestionnaireEntry {
  id: keyof SprinklerAnswers;
  question: string;
  help: string;
  options?: { value: string; label: string }[];
}

export const QUESTIONNAIRE: QuestionnaireEntry[] = [
  {
    id: 'buildingType',
    question: 'What is the primary building type / occupancy?',
    help: 'Sets the default room occupancy and hazard classification (NFPA 13-2019 §4.3 and Annex A.4.3); every room can be changed afterwards.',
    options: ([
      ['office', 'Office'], ['residential', 'Residential'], ['hotel', 'Hotel'], ['healthcare', 'Healthcare'],
      ['education', 'Education'], ['mercantile', 'Mercantile / retail'], ['assembly', 'Assembly'], ['parking', 'Parking garage'],
      ['storage-low-piled', 'Storage (≤ 12 ft)'], ['industrial', 'Industrial'], ['data-center', 'Data center'],
      ['restaurant', 'Restaurant'], ['mixed', 'Mixed use']
    ] as [string, string][]).map(([value, label]) => ({ value, label }))
  },
  {
    id: 'freezingAreas',
    question: 'Are any areas exposed to temperatures below 4 °C (40 °F)?',
    help: 'Unheated areas need a dry-pipe system or dry-pendent sprinklers in a wet system (NFPA 13-2019 §8.2 and §7.2.2; heated enclosures §8.2.5).'
  },
  {
    id: 'waterSensitiveAreas',
    question: 'Are there water-damage-sensitive areas (IT, archives, museums)?',
    help: 'Preaction systems keep the piping dry until detection operates (NFPA 13-2019 §8.3); double-interlock requires both detection and sprinkler operation.'
  },
  {
    id: 'delugeHazard',
    question: 'Is there a special hazard needing simultaneous discharge over the whole area?',
    help: 'Deluge systems use open sprinklers with detection (NFPA 13-2019 §8.3 and §7.2.3) for rapidly spreading fire hazards such as flammable liquids.'
  },
  {
    id: 'highPiledStorage',
    question: 'Is storage higher than 12 ft (3.7 m) present?',
    help: 'High-piled storage requires a separate design under NFPA 13-2019 Chapters 20–25 (ESFR / CMSA / CMDA) and is outside this tool.'
  },
  {
    id: 'ceilingType',
    question: 'What is the default ceiling construction?',
    help: 'Finished flat ceilings use pendent sprinklers; exposed structure uses upright sprinklers (NFPA 13-2019 §7.2 and §10.2 / §10.3 obstruction rules).',
    options: [{ value: 'finished-flat', label: 'Suspended / finished flat ceiling (pendent)' }, { value: 'exposed-structure', label: 'Exposed structure (upright)' }]
  },
  {
    id: 'defaultCeilingHeightM',
    question: 'What is the typical ceiling height (m)?',
    help: 'Pipe elevation is taken 0.30 m below the ceiling; deflector distance below the ceiling is 25–305 mm (NFPA 13-2019 §10.2.6.1.1).'
  },
  {
    id: 'pipeMaterial',
    question: 'Which pipe material will be used?',
    help: 'Steel Sch 40 / Sch 10, galvanized (dry systems), copper or CPVC; CPVC is limited to wet light-hazard systems per its listing (NFPA 13-2019 Ch. 6, Table 28.2.4.8.1 C-factors).',
    options: [
      { value: 'black-steel-sch40', label: 'Black steel Sch 40' }, { value: 'black-steel-sch10', label: 'Black steel Sch 10' },
      { value: 'galvanized-steel-sch40', label: 'Galvanized steel Sch 40' }, { value: 'cpvc', label: 'CPVC (wet, light hazard only)' },
      { value: 'copper-type-l', label: 'Copper type L' }
    ]
  },
  {
    id: 'seismic',
    question: 'Is the building in Seismic Design Category C to F?',
    help: 'Seismic zones need sway bracing, flexible couplings and clearances per NFPA 13-2019 Chapter 18.'
  },
  {
    id: 'supply',
    question: 'What water supply feeds the sprinkler system?',
    help: 'A fire pump sized in this design, or a municipal supply defined by a flow test (static, residual, residual flow) checked per NFPA 13-2019 §5.2 / §28.',
    options: [{ value: 'fire-pump', label: 'Fire pump (sized in this design)' }, { value: 'city', label: 'City main (flow test data)' }]
  }
];

export function defaultSprinklerAnswers(): SprinklerAnswers {
  return {
    buildingType: 'office',
    freezingAreas: false,
    waterSensitiveAreas: false,
    delugeHazard: false,
    highPiledStorage: false,
    ceilingType: 'finished-flat',
    defaultCeilingHeightM: 3.0,
    pipeMaterial: 'black-steel-sch40',
    seismic: false,
    supply: { kind: 'fire-pump' }
  };
}

/** Recommended system type for a room given the questionnaire (NFPA 13-2019 §8.2 dry, §8.3 preaction / deluge). */
export function recommendedSystemType(
  answers: SprinklerAnswers,
  room: { hazard: HazardClass; occupancy: string; freezing: boolean }
): SprinklerSystemType {
  if (answers.delugeHazard && room.hazard.startsWith('extra')) return 'deluge';
  if (room.freezing && answers.waterSensitiveAreas) return 'preaction-double';
  if (room.freezing) return 'dry';
  if (answers.waterSensitiveAreas && room.occupancy === 'data') return 'preaction-single';
  return 'wet';
}
