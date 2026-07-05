export interface SpaceType {
  id: string;
  name: string;
  rp: number; // Outdoor air rate (CFM/person)
  ra: number; // Outdoor air rate (CFM/ft²)
  density: number; // Occupants/1000 ft²
  lightingDensity: number; // W/ft²
  equipmentDensity: number; // W/ft²
  sensibleGain: number; // Btu/h per person
  latentGain: number; // Btu/h per person
}

export interface HealthcareSpace {
  name: string;
  pressure: 'Positive' | 'Negative' | 'Neutral';
  minOutdoorAch: number;
  minTotalAch: number;
  directExhaust: boolean;
}

export interface ExhaustCategory {
  name: string;
  continuousRate: number; // CFM/unit or CFM/ft²
  intermittentRate?: number; // CFM/unit or CFM/ft²
  byArea: boolean; // true if CFM/ft², false if CFM/unit
}

export const ASHRAE_SPACE_TYPES: SpaceType[] = [
  {
    id: 'office',
    name: 'Office Space (General)',
    rp: 5,
    ra: 0.06,
    density: 5,
    lightingDensity: 0.63, // ASHRAE 90.1-2019 space-by-space: ~6.8 W/m² = ~0.63 W/ft²
    equipmentDensity: 0.40, // ~4.3 W/m² = ~0.40 W/ft²
    sensibleGain: 250, // Seated, light office work
    latentGain: 200
  },
  {
    id: 'conference',
    name: 'Conference Room',
    rp: 5,
    ra: 0.06,
    density: 50,
    lightingDensity: 0.90, // ~9.7 W/m²
    equipmentDensity: 0.20,
    sensibleGain: 245, // Seated, talking/meeting
    latentGain: 155
  },
  {
    id: 'classroom',
    name: 'Classroom (Ages 9+)',
    rp: 10,
    ra: 0.12,
    density: 35,
    lightingDensity: 0.71, // ~7.6 W/m²
    equipmentDensity: 0.90, // with computers
    sensibleGain: 250,
    latentGain: 200
  },
  {
    id: 'computer-lab',
    name: 'Computer Laboratory',
    rp: 10,
    ra: 0.12,
    density: 25,
    lightingDensity: 0.94, // ~10.1 W/m²
    equipmentDensity: 20.0, // High equipment density (~215 W/m²)
    sensibleGain: 250,
    latentGain: 200
  },
  {
    id: 'restaurant-dining',
    name: 'Restaurant Dining Area',
    rp: 7.5,
    ra: 0.18,
    density: 70,
    lightingDensity: 0.84, // ~9.0 W/m²
    equipmentDensity: 0.40,
    sensibleGain: 275, // Sedentary work / eating
    latentGain: 275
  },
  {
    id: 'lobby',
    name: 'Hotel Lobby',
    rp: 7.6,
    ra: 0.06,
    density: 30,
    lightingDensity: 0.50, // ~5.4 W/m²
    equipmentDensity: 0.75,
    sensibleGain: 250,
    latentGain: 250
  },
  {
    id: 'breakroom',
    name: 'Break Room / Lounge',
    rp: 2.5,
    ra: 0.06,
    density: 25,
    lightingDensity: 0.58, // ~6.3 W/m²
    equipmentDensity: 2.0, // fridge, microwave, kettle
    sensibleGain: 245,
    latentGain: 155
  },
  {
    id: 'retail',
    name: 'Retail Store',
    rp: 7.5,
    ra: 0.09,
    density: 15,
    lightingDensity: 1.20,
    equipmentDensity: 0.30,
    sensibleGain: 250,
    latentGain: 250
  }
];

export const ASHRAE_EXHAUST_RATES: ExhaustCategory[] = [
  { name: 'Public Toilets', continuousRate: 50, intermittentRate: 70, byArea: false }, // CFM/toilet
  { name: 'Private Toilets', continuousRate: 25, intermittentRate: 50, byArea: false }, // CFM/toilet
  { name: 'Commercial Kitchens', continuousRate: 0.70, byArea: true }, // CFM/ft²
  { name: 'Janitor Closets & Trash Rooms', continuousRate: 1.00, byArea: true }, // CFM/ft²
  { name: 'Parking Garages', continuousRate: 0.75, byArea: true }, // CFM/ft²
  { name: 'Auto Repair Rooms', continuousRate: 1.50, byArea: true } // CFM/ft²
];

export const ASHRAE_HEALTHCARE_TABLE: HealthcareSpace[] = [
  { name: 'Examination Room', pressure: 'Neutral', minOutdoorAch: 2, minTotalAch: 6, directExhaust: false },
  { name: 'Treatment Room', pressure: 'Neutral', minOutdoorAch: 2, minTotalAch: 6, directExhaust: false },
  { name: 'Medication Room', pressure: 'Positive', minOutdoorAch: 2, minTotalAch: 4, directExhaust: false },
  { name: 'Clean Workroom / Holding', pressure: 'Positive', minOutdoorAch: 2, minTotalAch: 4, directExhaust: false },
  { name: 'Sterile Storage', pressure: 'Positive', minOutdoorAch: 2, minTotalAch: 4, directExhaust: false },
  { name: 'Soiled / Decontamination Room', pressure: 'Negative', minOutdoorAch: 2, minTotalAch: 6, directExhaust: true },
  { name: 'Endoscope Cleaning Room', pressure: 'Negative', minOutdoorAch: 2, minTotalAch: 10, directExhaust: true },
  { name: 'Bathroom / Toilet', pressure: 'Negative', minOutdoorAch: 0, minTotalAch: 10, directExhaust: true },
  { name: 'Janitor’s Closet', pressure: 'Negative', minOutdoorAch: 0, minTotalAch: 10, directExhaust: true }
];

export const SMACNA_GAUGE_TABLE = [
  { maxDimension: 12, thicknessMm: 0.55, gauge: 26 },
  { maxDimension: 30, thicknessMm: 0.70, gauge: 24 },
  { maxDimension: 54, thicknessMm: 0.85, gauge: 22 },
  { maxDimension: 84, thicknessMm: 1.00, gauge: 20 },
  { maxDimension: 9999, thicknessMm: 1.20, gauge: 18 }
];

export const DEFAULT_U_VALUES = {
  wall: 0.34, // Btu/(hr·ft²·°F)
  roof: 0.10, // Btu/(hr·ft²·°F)
  glass: 0.55 // Double glazed window U-value
};
