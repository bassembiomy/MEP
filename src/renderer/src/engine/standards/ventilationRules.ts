import { StandardsProfile, ASHRAE_PROFILE } from './designStandards';

export interface VentilationRate {
  spaceType: string;
  peopleRateCfmPerPerson: number; // Rp
  areaRateCfmPerSqFt: number;      // Ra
  defaultOccupantDensityPer1000SqFt: number;
}

export const ASHRAE_62_1_VENTILATION_RATES: Record<string, VentilationRate> = {
  'conference-meeting': {
    spaceType: 'Conference / Meeting',
    peopleRateCfmPerPerson: 5,
    areaRateCfmPerSqFt: 0.06,
    defaultOccupantDensityPer1000SqFt: 50
  },
  'office-space': {
    spaceType: 'Office Space',
    peopleRateCfmPerPerson: 5,
    areaRateCfmPerSqFt: 0.06,
    defaultOccupantDensityPer1000SqFt: 5
  },
  'classroom': {
    spaceType: 'Classroom (Ages 5-8+)',
    peopleRateCfmPerPerson: 10,
    areaRateCfmPerSqFt: 0.12,
    defaultOccupantDensityPer1000SqFt: 25
  },
  'auditorium': {
    spaceType: 'Auditorium / Assembly',
    peopleRateCfmPerPerson: 5,
    areaRateCfmPerSqFt: 0.06,
    defaultOccupantDensityPer1000SqFt: 150
  },
  'lobby': {
    spaceType: 'Main Entry / Lobby',
    peopleRateCfmPerPerson: 5,
    areaRateCfmPerSqFt: 0.06,
    defaultOccupantDensityPer1000SqFt: 10
  },
  'retail': {
    spaceType: 'Retail Sales Floor',
    peopleRateCfmPerPerson: 7.5,
    areaRateCfmPerSqFt: 0.12,
    defaultOccupantDensityPer1000SqFt: 15
  },
  'restaurant-dining': {
    spaceType: 'Restaurant Dining Room',
    peopleRateCfmPerPerson: 7.5,
    areaRateCfmPerSqFt: 0.18,
    defaultOccupantDensityPer1000SqFt: 70
  }
};

export function getVentilationRates(
  spaceCategory: string,
  _profile: StandardsProfile = ASHRAE_PROFILE
): VentilationRate {
  const norm = spaceCategory.toLowerCase();
  if (norm.includes('conf') || norm.includes('meet')) return ASHRAE_62_1_VENTILATION_RATES['conference-meeting'];
  if (norm.includes('class') || norm.includes('school')) return ASHRAE_62_1_VENTILATION_RATES['classroom'];
  if (norm.includes('audit') || norm.includes('theater')) return ASHRAE_62_1_VENTILATION_RATES['auditorium'];
  if (norm.includes('lobby') || norm.includes('corridor')) return ASHRAE_62_1_VENTILATION_RATES['lobby'];
  if (norm.includes('retail') || norm.includes('shop')) return ASHRAE_62_1_VENTILATION_RATES['retail'];
  if (norm.includes('dining') || norm.includes('rest')) return ASHRAE_62_1_VENTILATION_RATES['restaurant-dining'];
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
