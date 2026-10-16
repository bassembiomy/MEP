import { StandardsProfile, ASHRAE_PROFILE } from './designStandards';
import { SPACE_TYPE_BY_ID } from '../knowledgeBase';

export interface VentilationRate {
  spaceType: string;
  peopleRateCfmPerPerson: number; // Rp
  areaRateCfmPerSqFt: number;      // Ra
  defaultOccupantDensityPer1000SqFt: number;
  exhaustOnly?: boolean;
  exhaustCfmPerFixture?: number;
  exhaustCfmPerSqFt?: number;
}

function fromSpaceType(id: string, label?: string): VentilationRate {
  const t = SPACE_TYPE_BY_ID[id];
  return {
    spaceType: label ?? t.name,
    peopleRateCfmPerPerson: t.rp,
    areaRateCfmPerSqFt: t.ra,
    defaultOccupantDensityPer1000SqFt: t.density,
    exhaustOnly: t.exhaustOnly,
    exhaustCfmPerFixture: t.exhaustCfmPerFixture,
    exhaustCfmPerSqFt: t.exhaustCfmPerSqFt
  };
}

/**
 * Derived from the canonical ASHRAE 62.1-2019 Table 6-1 data in knowledgeBase.ts
 * (ASHRAE_SPACE_TYPES). Do not duplicate numbers here.
 */
export const ASHRAE_62_1_VENTILATION_RATES: Record<string, VentilationRate> = {
  'conference-meeting': fromSpaceType('conference', 'Conference / Meeting'),
  'office-space': fromSpaceType('office', 'Office Space'),
  'classroom': fromSpaceType('classroom', 'Classroom (Ages 9+)'),
  'computer-lab': fromSpaceType('computer-lab'),
  'auditorium': fromSpaceType('auditorium'),
  'lobby': fromSpaceType('lobby'),
  'corridor': fromSpaceType('corridor'),
  'retail': fromSpaceType('retail', 'Retail Sales Floor'),
  'restaurant-dining': fromSpaceType('restaurant-dining', 'Restaurant Dining Room'),
  'breakroom': fromSpaceType('breakroom'),
  'restroom': fromSpaceType('toilet-public', 'Restroom / Toilet (exhaust only)')
};

export function getVentilationRates(
  spaceCategory: string,
  _profile: StandardsProfile = ASHRAE_PROFILE
): VentilationRate {
  const norm = spaceCategory.toLowerCase();
  // Restrooms first so "restroom" is never matched by the "rest(aurant)" rule.
  if (/(restroom|rest room|toilet|lavatory|washroom|bathroom|\bwc\b)/.test(norm)) return ASHRAE_62_1_VENTILATION_RATES['restroom'];
  if (norm.includes('corridor') || norm.includes('hallway')) return ASHRAE_62_1_VENTILATION_RATES['corridor'];
  if (norm.includes('conf') || norm.includes('meet')) return ASHRAE_62_1_VENTILATION_RATES['conference-meeting'];
  if (norm.includes('computer')) return ASHRAE_62_1_VENTILATION_RATES['computer-lab'];
  if (norm.includes('class') || norm.includes('school')) return ASHRAE_62_1_VENTILATION_RATES['classroom'];
  if (norm.includes('audit') || norm.includes('theater')) return ASHRAE_62_1_VENTILATION_RATES['auditorium'];
  if (norm.includes('lobby')) return ASHRAE_62_1_VENTILATION_RATES['lobby'];
  if (norm.includes('retail') || norm.includes('shop')) return ASHRAE_62_1_VENTILATION_RATES['retail'];
  if (norm.includes('dining') || norm.includes('restaurant')) return ASHRAE_62_1_VENTILATION_RATES['restaurant-dining'];
  if (norm.includes('break')) return ASHRAE_62_1_VENTILATION_RATES['breakroom'];
  return ASHRAE_62_1_VENTILATION_RATES['office-space'];
}

export function calculateBreathingZoneVentilation(
  occupancyCount: number,
  areaSqFt: number,
  spaceCategory: string = 'conference-meeting',
  profile: StandardsProfile = ASHRAE_PROFILE
): number {
  const rate = getVentilationRates(spaceCategory, profile);
  const peopleCfm = occupancyCount * rate.peopleRateCfmPerPerson;
  const areaCfm = areaSqFt * rate.areaRateCfmPerSqFt;
  return Math.round(peopleCfm + areaCfm);
}
