import {
  EquipmentCatalogItem,
  DiffuserCatalogItem,
  DuctTypeItem,
  FittingLossDefinition
} from './types';

/**
 * Standard System Equipment Catalog with Explicit Capabilities & Tabular Fan Curves
 * Marked with provenance metadata.
 */
export const STANDARD_EQUIPMENT_CATALOG: EquipmentCatalogItem[] = [
  // 1. Concealed Ducted Split Units (Carrier / Daikin commercial series)
  {
    id: 'eq-ducted-18k',
    manufacturer: 'Carrier',
    model: '42QSS018-D',
    systemType: 'concealed',
    capabilities: {
      supportsDuctNetwork: true,
      supportsExternalDiffusers: true,
      supportsReturnDuct: true,
      supportsMultipleZones: false,
      requiresIndoorUnitSelection: true,
      hasExternalStaticPressure: true
    },
    nominalTons: 1.5,
    totalCapacityBtuPerHour: 17470,
    sensibleCapacityBtuPerHour: 13200,
    heatingCapacityBtuPerHour: 19000,
    nominalCfm: 444,
    minCfm: 350,
    maxCfm: 550,
    maxRatedEspInWg: 0.40,
    fanPerformance: {
      type: 'tabular',
      allowExtrapolation: false,
      table: [
        { cfm: 350, espInWg: 0.38, powerKw: 0.12, soundDba: 38 },
        { cfm: 444, espInWg: 0.30, powerKw: 0.15, soundDba: 41 },
        { cfm: 550, espInWg: 0.16, powerKw: 0.19, soundDba: 45 }
      ]
    },
    electricalKw: 1.45,
    efficiency: {
      seer: 16.5,
      eer: 12.1,
      copCooling: 3.55,
      ratingStandard: 'AHRI 210/240',
      ratingConditions: '95°F Outdoor / 80°F DB 67°F WB Indoor'
    },
    soundDba: 41,
    dimensionsIn: { width: 35.4, depth: 25.6, height: 8.3 },
    connectionSizes: { supplyDuct: '28"x7"', returnDuct: '32"x7"', liquidLine: '1/4"', gasLine: '1/2"' },
    costIndex: 45,
    provenance: { source: 'Carrier Ducted Product Guide', version: '2024.1', isUserImported: false, isDemonstrationOnly: false }
  },
  {
    id: 'eq-ducted-24k',
    manufacturer: 'Carrier',
    model: '42QSS024-D',
    systemType: 'concealed',
    capabilities: {
      supportsDuctNetwork: true,
      supportsExternalDiffusers: true,
      supportsReturnDuct: true,
      supportsMultipleZones: false,
      requiresIndoorUnitSelection: true,
      hasExternalStaticPressure: true
    },
    nominalTons: 2.0,
    totalCapacityBtuPerHour: 22355,
    sensibleCapacityBtuPerHour: 17100,
    heatingCapacityBtuPerHour: 24500,
    nominalCfm: 614,
    minCfm: 480,
    maxCfm: 750,
    maxRatedEspInWg: 0.45,
    fanPerformance: {
      type: 'tabular',
      allowExtrapolation: false,
      table: [
        { cfm: 480, espInWg: 0.42, powerKw: 0.18, soundDba: 40 },
        { cfm: 614, espInWg: 0.32, powerKw: 0.22, soundDba: 43 },
        { cfm: 750, espInWg: 0.18, powerKw: 0.28, soundDba: 48 }
      ]
    },
    electricalKw: 1.88,
    efficiency: {
      seer: 16.0,
      eer: 11.9,
      copCooling: 3.49,
      ratingStandard: 'AHRI 210/240',
      ratingConditions: '95°F Outdoor / 80°F DB 67°F WB Indoor'
    },
    soundDba: 43,
    dimensionsIn: { width: 43.3, depth: 27.6, height: 9.8 },
    connectionSizes: { supplyDuct: '36"x8"', returnDuct: '40"x8"', liquidLine: '3/8"', gasLine: '5/8"' },
    costIndex: 55,
    provenance: { source: 'Carrier Ducted Product Guide', version: '2024.1', isUserImported: false, isDemonstrationOnly: false }
  },
  {
    id: 'eq-ducted-36k',
    manufacturer: 'Carrier',
    model: '42QSS036-D',
    systemType: 'concealed',
    capabilities: {
      supportsDuctNetwork: true,
      supportsExternalDiffusers: true,
      supportsReturnDuct: true,
      supportsMultipleZones: false,
      requiresIndoorUnitSelection: true,
      hasExternalStaticPressure: true
    },
    nominalTons: 3.0,
    totalCapacityBtuPerHour: 35590,
    sensibleCapacityBtuPerHour: 27200,
    heatingCapacityBtuPerHour: 38000,
    nominalCfm: 1233,
    minCfm: 950,
    maxCfm: 1400,
    maxRatedEspInWg: 0.60,
    fanPerformance: {
      type: 'tabular',
      allowExtrapolation: false,
      table: [
        { cfm: 950, espInWg: 0.58, powerKw: 0.32, soundDba: 44 },
        { cfm: 1233, espInWg: 0.45, powerKw: 0.42, soundDba: 48 },
        { cfm: 1400, espInWg: 0.28, powerKw: 0.52, soundDba: 52 }
      ]
    },
    electricalKw: 2.95,
    efficiency: {
      seer: 15.5,
      eer: 11.5,
      copCooling: 3.37,
      ratingStandard: 'AHRI 210/240',
      ratingConditions: '95°F Outdoor / 80°F DB 67°F WB Indoor'
    },
    soundDba: 48,
    dimensionsIn: { width: 51.2, depth: 31.5, height: 11.8 },
    connectionSizes: { supplyDuct: '44"x10"', returnDuct: '48"x10"', liquidLine: '3/8"', gasLine: '3/4"' },
    costIndex: 70,
    provenance: { source: 'Carrier Ducted Product Guide', version: '2024.1', isUserImported: false, isDemonstrationOnly: false }
  },
  {
    id: 'eq-ducted-60k',
    manufacturer: 'Carrier',
    model: '42QSS060-D',
    systemType: 'concealed',
    capabilities: {
      supportsDuctNetwork: true,
      supportsExternalDiffusers: true,
      supportsReturnDuct: true,
      supportsMultipleZones: false,
      requiresIndoorUnitSelection: true,
      hasExternalStaticPressure: true
    },
    nominalTons: 5.0,
    totalCapacityBtuPerHour: 47005,
    sensibleCapacityBtuPerHour: 36500,
    heatingCapacityBtuPerHour: 52000,
    nominalCfm: 1345,
    minCfm: 1100,
    maxCfm: 1800,
    maxRatedEspInWg: 0.75,
    fanPerformance: {
      type: 'tabular',
      allowExtrapolation: false,
      table: [
        { cfm: 1100, espInWg: 0.72, powerKw: 0.45, soundDba: 46 },
        { cfm: 1345, espInWg: 0.55, powerKw: 0.60, soundDba: 50 },
        { cfm: 1800, espInWg: 0.35, powerKw: 0.78, soundDba: 56 }
      ]
    },
    electricalKw: 4.30,
    efficiency: {
      seer: 15.0,
      eer: 11.2,
      copCooling: 3.28,
      ratingStandard: 'AHRI 210/240',
      ratingConditions: '95°F Outdoor / 80°F DB 67°F WB Indoor'
    },
    soundDba: 50,
    dimensionsIn: { width: 59.1, depth: 33.5, height: 13.8 },
    connectionSizes: { supplyDuct: '52"x11"', returnDuct: '56"x11"', liquidLine: '3/8"', gasLine: '7/8"' },
    costIndex: 85,
    provenance: { source: 'Carrier Ducted Product Guide', version: '2024.1', isUserImported: false, isDemonstrationOnly: false }
  },

  // 2. High-Wall DX Split Systems (Direct air throw, no duct network)
  {
    id: 'eq-hw-12k',
    manufacturer: 'Carrier',
    model: 'Optimax 12K',
    systemType: 'high-wall',
    capabilities: {
      supportsDuctNetwork: false,
      supportsExternalDiffusers: false,
      supportsReturnDuct: false,
      supportsMultipleZones: false,
      requiresIndoorUnitSelection: true,
      hasExternalStaticPressure: false
    },
    nominalTons: 1.0,
    totalCapacityBtuPerHour: 12050,
    sensibleCapacityBtuPerHour: 9200,
    heatingCapacityBtuPerHour: 13000,
    nominalCfm: 326,
    minCfm: 220,
    maxCfm: 380,
    maxRatedEspInWg: 0.0,
    fanPerformance: {
      type: 'multi-speed',
      allowExtrapolation: false,
      speeds: {
        Low: [{ cfm: 220, espInWg: 0, soundDba: 28 }],
        Medium: [{ cfm: 280, espInWg: 0, soundDba: 34 }],
        High: [{ cfm: 326, espInWg: 0, soundDba: 39 }]
      }
    },
    electricalKw: 1.05,
    efficiency: {
      seer: 18.0,
      eer: 12.8,
      copCooling: 3.75,
      ratingStandard: 'AHRI 210/240',
      ratingConditions: '95°F Outdoor / 80°F DB 67°F WB Indoor'
    },
    soundDba: 34,
    dimensionsIn: { width: 31.5, depth: 8.5, height: 11.4 },
    connectionSizes: { liquidLine: '1/4"', gasLine: '3/8"' },
    costIndex: 25,
    provenance: { source: 'Carrier Decorative Product Guide', version: '2024.1', isUserImported: false }
  },
  {
    id: 'eq-hw-24k',
    manufacturer: 'Carrier',
    model: 'Optimax 24K',
    systemType: 'high-wall',
    capabilities: {
      supportsDuctNetwork: false,
      supportsExternalDiffusers: false,
      supportsReturnDuct: false,
      supportsMultipleZones: false,
      requiresIndoorUnitSelection: true,
      hasExternalStaticPressure: false
    },
    nominalTons: 2.0,
    totalCapacityBtuPerHour: 22800,
    sensibleCapacityBtuPerHour: 17200,
    heatingCapacityBtuPerHour: 24000,
    nominalCfm: 633,
    minCfm: 450,
    maxCfm: 720,
    maxRatedEspInWg: 0.0,
    fanPerformance: {
      type: 'multi-speed',
      allowExtrapolation: false,
      speeds: {
        Low: [{ cfm: 450, espInWg: 0, soundDba: 35 }],
        Medium: [{ cfm: 540, espInWg: 0, soundDba: 40 }],
        High: [{ cfm: 633, espInWg: 0, soundDba: 46 }]
      }
    },
    electricalKw: 1.95,
    efficiency: {
      seer: 17.0,
      eer: 12.2,
      copCooling: 3.58,
      ratingStandard: 'AHRI 210/240',
      ratingConditions: '95°F Outdoor / 80°F DB 67°F WB Indoor'
    },
    soundDba: 40,
    dimensionsIn: { width: 42.5, depth: 9.6, height: 13.2 },
    connectionSizes: { liquidLine: '3/8"', gasLine: '5/8"' },
    costIndex: 38,
    provenance: { source: 'Carrier Decorative Product Guide', version: '2024.1', isUserImported: false }
  },
  {
    id: 'eq-hw-30k',
    manufacturer: 'Carrier',
    model: 'Optimax 30K',
    systemType: 'high-wall',
    capabilities: {
      supportsDuctNetwork: false,
      supportsExternalDiffusers: false,
      supportsReturnDuct: false,
      supportsMultipleZones: false,
      requiresIndoorUnitSelection: true,
      hasExternalStaticPressure: false
    },
    nominalTons: 2.5,
    totalCapacityBtuPerHour: 29300,
    sensibleCapacityBtuPerHour: 22100,
    heatingCapacityBtuPerHour: 31000,
    nominalCfm: 834,
    minCfm: 600,
    maxCfm: 920,
    maxRatedEspInWg: 0.0,
    fanPerformance: {
      type: 'multi-speed',
      allowExtrapolation: false,
      speeds: {
        Low: [{ cfm: 600, espInWg: 0, soundDba: 38 }],
        Medium: [{ cfm: 720, espInWg: 0, soundDba: 44 }],
        High: [{ cfm: 834, espInWg: 0, soundDba: 49 }]
      }
    },
    electricalKw: 2.60,
    efficiency: {
      seer: 16.2,
      eer: 11.8,
      copCooling: 3.46,
      ratingStandard: 'AHRI 210/240',
      ratingConditions: '95°F Outdoor / 80°F DB 67°F WB Indoor'
    },
    soundDba: 44,
    dimensionsIn: { width: 49.2, depth: 10.8, height: 14.2 },
    connectionSizes: { liquidLine: '3/8"', gasLine: '5/8"' },
    costIndex: 48,
    provenance: { source: 'Carrier Decorative Product Guide', version: '2024.1', isUserImported: false }
  },

  // 3. Cassette Split Units (Direct 4-way ceiling discharge)
  {
    id: 'eq-cass-36k',
    manufacturer: 'Carrier',
    model: '40KMC036',
    systemType: 'cassette',
    capabilities: {
      supportsDuctNetwork: false,
      supportsExternalDiffusers: false,
      supportsReturnDuct: false,
      supportsMultipleZones: false,
      requiresIndoorUnitSelection: true,
      hasExternalStaticPressure: false
    },
    nominalTons: 3.0,
    totalCapacityBtuPerHour: 34000,
    sensibleCapacityBtuPerHour: 25800,
    heatingCapacityBtuPerHour: 36000,
    nominalCfm: 1180,
    minCfm: 850,
    maxCfm: 1300,
    maxRatedEspInWg: 0.0,
    fanPerformance: {
      type: 'multi-speed',
      allowExtrapolation: false,
      speeds: {
        Low: [{ cfm: 850, espInWg: 0, soundDba: 36 }],
        Medium: [{ cfm: 1020, espInWg: 0, soundDba: 41 }],
        High: [{ cfm: 1180, espInWg: 0, soundDba: 46 }]
      }
    },
    electricalKw: 2.85,
    efficiency: {
      seer: 17.5,
      eer: 12.4,
      copCooling: 3.63,
      ratingStandard: 'AHRI 210/240',
      ratingConditions: '95°F Outdoor / 80°F DB 67°F WB Indoor'
    },
    soundDba: 41,
    dimensionsIn: { width: 33.1, depth: 33.1, height: 11.3 },
    connectionSizes: { liquidLine: '3/8"', gasLine: '3/4"' },
    costIndex: 60,
    provenance: { source: 'Carrier Decorative Product Guide', version: '2024.1', isUserImported: false }
  },
  {
    id: 'eq-cass-48k',
    manufacturer: 'Carrier',
    model: '40KMC048',
    systemType: 'cassette',
    capabilities: {
      supportsDuctNetwork: false,
      supportsExternalDiffusers: false,
      supportsReturnDuct: false,
      supportsMultipleZones: false,
      requiresIndoorUnitSelection: true,
      hasExternalStaticPressure: false
    },
    nominalTons: 4.0,
    totalCapacityBtuPerHour: 42500,
    sensibleCapacityBtuPerHour: 32400,
    heatingCapacityBtuPerHour: 46000,
    nominalCfm: 1298,
    minCfm: 950,
    maxCfm: 1450,
    maxRatedEspInWg: 0.0,
    fanPerformance: {
      type: 'multi-speed',
      allowExtrapolation: false,
      speeds: {
        Low: [{ cfm: 950, espInWg: 0, soundDba: 38 }],
        Medium: [{ cfm: 1120, espInWg: 0, soundDba: 43 }],
        High: [{ cfm: 1298, espInWg: 0, soundDba: 48 }]
      }
    },
    electricalKw: 3.75,
    efficiency: {
      seer: 16.5,
      eer: 11.8,
      copCooling: 3.46,
      ratingStandard: 'AHRI 210/240',
      ratingConditions: '95°F Outdoor / 80°F DB 67°F WB Indoor'
    },
    soundDba: 43,
    dimensionsIn: { width: 33.1, depth: 33.1, height: 11.3 },
    connectionSizes: { liquidLine: '3/8"', gasLine: '3/4"' },
    costIndex: 72,
    provenance: { source: 'Carrier Decorative Product Guide', version: '2024.1', isUserImported: false }
  },

  // 4. Packaged Rooftop Units (RTU)
  {
    id: 'eq-rtu-7.5t',
    manufacturer: 'Carrier',
    model: 'WeatherMaster 48HC-08',
    systemType: 'packaged',
    capabilities: {
      supportsDuctNetwork: true,
      supportsExternalDiffusers: true,
      supportsReturnDuct: true,
      supportsMultipleZones: false,
      requiresIndoorUnitSelection: false,
      hasExternalStaticPressure: true
    },
    nominalTons: 7.5,
    totalCapacityBtuPerHour: 90000,
    sensibleCapacityBtuPerHour: 68000,
    heatingCapacityBtuPerHour: 95000,
    nominalCfm: 3000,
    minCfm: 2400,
    maxCfm: 3600,
    maxRatedEspInWg: 1.20,
    fanPerformance: {
      type: 'tabular',
      allowExtrapolation: false,
      table: [
        { cfm: 2400, espInWg: 1.15, powerKw: 1.2, soundDba: 68 },
        { cfm: 3000, espInWg: 0.95, powerKw: 1.6, soundDba: 72 },
        { cfm: 3600, espInWg: 0.70, powerKw: 2.1, soundDba: 76 }
      ]
    },
    electricalKw: 7.2,
    efficiency: {
      seer: 15.0,
      eer: 12.0,
      copCooling: 3.52,
      iplv: 16.2,
      ratingStandard: 'AHRI 340/360',
      ratingConditions: '95°F Outdoor / 80°F DB 67°F WB Indoor'
    },
    soundDba: 72,
    dimensionsIn: { width: 88.0, depth: 59.0, height: 49.0 },
    connectionSizes: { supplyDuct: '20"x20"', returnDuct: '20"x20"' },
    costIndex: 82,
    provenance: { source: 'Carrier Rooftop Catalog', version: '2024.1', isUserImported: false }
  },

  // 5. VRF Heat Recovery System
  {
    id: 'eq-vrf-10t',
    manufacturer: 'Daikin',
    model: 'VRV IV-X REYQ120X',
    systemType: 'vrf',
    capabilities: {
      supportsDuctNetwork: true,
      supportsExternalDiffusers: true,
      supportsReturnDuct: true,
      supportsMultipleZones: true,
      requiresIndoorUnitSelection: true,
      hasExternalStaticPressure: true
    },
    nominalTons: 10.0,
    totalCapacityBtuPerHour: 120000,
    sensibleCapacityBtuPerHour: 92000,
    heatingCapacityBtuPerHour: 135000,
    nominalCfm: 4000,
    minCfm: 1200,
    maxCfm: 5200,
    maxRatedEspInWg: 0.60,
    fanPerformance: {
      type: 'tabular',
      allowExtrapolation: false,
      table: [
        { cfm: 2000, espInWg: 0.55, powerKw: 0.6, soundDba: 42 },
        { cfm: 4000, espInWg: 0.45, powerKw: 1.3, soundDba: 48 },
        { cfm: 5200, espInWg: 0.30, powerKw: 1.9, soundDba: 54 }
      ]
    },
    electricalKw: 8.4,
    efficiency: {
      seer: 22.5,
      eer: 13.8,
      copCooling: 4.10,
      iplv: 24.0,
      ratingStandard: 'AHRI 1230',
      ratingConditions: '95°F Outdoor / 80°F DB 67°F WB Indoor'
    },
    soundDba: 58,
    dimensionsIn: { width: 49.0, depth: 30.1, height: 66.1 },
    connectionSizes: { liquidLine: '1/2"', gasLine: '1-1/8"' },
    costIndex: 92,
    provenance: { source: 'Daikin VRV Technical Guide', version: '2024.1', isUserImported: false }
  },

  // 6. Central Air Handling Unit (AHU) / Chilled Water
  {
    id: 'eq-ahu-15t',
    manufacturer: 'Trane',
    model: 'Performance Climate Changer',
    systemType: 'ahu',
    capabilities: {
      supportsDuctNetwork: true,
      supportsExternalDiffusers: true,
      supportsReturnDuct: true,
      supportsMultipleZones: true,
      requiresIndoorUnitSelection: false,
      hasExternalStaticPressure: true
    },
    nominalTons: 15.0,
    totalCapacityBtuPerHour: 180000,
    sensibleCapacityBtuPerHour: 138000,
    heatingCapacityBtuPerHour: 190000,
    nominalCfm: 6000,
    minCfm: 3500,
    maxCfm: 7500,
    maxRatedEspInWg: 1.80,
    fanPerformance: {
      type: 'tabular',
      allowExtrapolation: false,
      table: [
        { cfm: 3500, espInWg: 1.70, powerKw: 2.2, soundDba: 60 },
        { cfm: 6000, espInWg: 1.45, powerKw: 4.1, soundDba: 68 },
        { cfm: 7500, espInWg: 1.10, powerKw: 5.8, soundDba: 74 }
      ]
    },
    electricalKw: 12.5,
    efficiency: {
      copCooling: 4.60,
      iplv: 21.5,
      ratingStandard: 'AHRI 430',
      ratingConditions: 'Chilled water 44°F / 54°F'
    },
    soundDba: 68,
    dimensionsIn: { width: 72.0, depth: 84.0, height: 60.0 },
    connectionSizes: { supplyDuct: '36"x24"', returnDuct: '36"x24"' },
    costIndex: 96,
    provenance: { source: 'Trane AHU Engineering Manual', version: '2024.1', isUserImported: false }
  }
];

/**
 * Standard Diffuser & Terminal Catalog with Performance Tables
 */
export const STANDARD_DIFFUSER_CATALOG: DiffuserCatalogItem[] = [
  {
    id: 'dif-sq-9x9',
    manufacturer: 'Titus',
    model: 'TMS 9"x9" (6" Neck)',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 6, height: 6, diameter: 6 },
    faceSizeIn: { width: 9, height: 9 },
    minCfm: 75,
    maxCfm: 250,
    performanceTable: [
      { cfm: 100, deltaPInWg: 0.015, ncRating: 15, throwFt: { t50: 6.0, t100: 4.0, t150: 2.5 } },
      { cfm: 150, deltaPInWg: 0.032, ncRating: 22, throwFt: { t50: 9.0, t100: 6.0, t150: 4.0 } },
      { cfm: 200, deltaPInWg: 0.058, ncRating: 29, throwFt: { t50: 12.0, t100: 8.5, t150: 5.5 } },
      { cfm: 250, deltaPInWg: 0.090, ncRating: 36, throwFt: { t50: 15.0, t100: 10.5, t150: 7.0 } }
    ],
    costIndex: 30,
    provenance: { source: 'Titus Ceiling Diffuser Catalog', version: '2024.1' }
  },
  {
    id: 'dif-sq-12x12',
    manufacturer: 'Titus',
    model: 'TMS 12"x12" (8" Neck)',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 8, height: 8, diameter: 8 },
    faceSizeIn: { width: 12, height: 12 },
    minCfm: 150,
    maxCfm: 450,
    performanceTable: [
      { cfm: 200, deltaPInWg: 0.022, ncRating: 18, throwFt: { t50: 9.5, t100: 6.5, t150: 4.5 } },
      { cfm: 300, deltaPInWg: 0.048, ncRating: 26, throwFt: { t50: 14.0, t100: 9.5, t150: 6.5 } },
      { cfm: 400, deltaPInWg: 0.082, ncRating: 33, throwFt: { t50: 18.0, t100: 12.5, t150: 8.5 } },
      { cfm: 450, deltaPInWg: 0.105, ncRating: 38, throwFt: { t50: 20.5, t100: 14.0, t150: 9.5 } }
    ],
    costIndex: 40,
    provenance: { source: 'Titus Ceiling Diffuser Catalog', version: '2024.1' }
  },
  {
    id: 'dif-sq-15x15',
    manufacturer: 'Titus',
    model: 'TMS 15"x15" (10" Neck)',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 10, height: 10, diameter: 10 },
    faceSizeIn: { width: 15, height: 15 },
    minCfm: 250,
    maxCfm: 650,
    performanceTable: [
      { cfm: 300, deltaPInWg: 0.025, ncRating: 20, throwFt: { t50: 12.0, t100: 8.0, t150: 5.5 } },
      { cfm: 450, deltaPInWg: 0.052, ncRating: 28, throwFt: { t50: 17.5, t100: 12.0, t150: 8.0 } },
      { cfm: 600, deltaPInWg: 0.092, ncRating: 35, throwFt: { t50: 23.0, t100: 16.0, t150: 11.0 } }
    ],
    costIndex: 50,
    provenance: { source: 'Titus Ceiling Diffuser Catalog', version: '2024.1' }
  },
  {
    id: 'dif-sq-18x18',
    manufacturer: 'Titus',
    model: 'TMS 18"x18" (12" Neck)',
    terminalType: 'square-ceiling',
    neckSizeIn: { width: 12, height: 12, diameter: 12 },
    faceSizeIn: { width: 18, height: 18 },
    minCfm: 400,
    maxCfm: 900,
    performanceTable: [
      { cfm: 450, deltaPInWg: 0.028, ncRating: 22, throwFt: { t50: 15.0, t100: 10.0, t150: 7.0 } },
      { cfm: 650, deltaPInWg: 0.058, ncRating: 30, throwFt: { t50: 21.0, t100: 14.5, t150: 10.0 } },
      { cfm: 850, deltaPInWg: 0.098, ncRating: 38, throwFt: { t50: 27.0, t100: 18.5, t150: 13.0 } }
    ],
    costIndex: 65,
    provenance: { source: 'Titus Ceiling Diffuser Catalog', version: '2024.1' }
  },
  {
    id: 'dif-linear-2slot',
    manufacturer: 'Price',
    model: 'Linear Slot 2-Slot 48"',
    terminalType: 'linear-slot',
    neckSizeIn: { width: 48, height: 3 },
    faceSizeIn: { width: 48, height: 4.5 },
    minCfm: 100,
    maxCfm: 400,
    performanceTable: [
      { cfm: 150, deltaPInWg: 0.030, ncRating: 18, throwFt: { t50: 11.0, t100: 7.5, t150: 5.0 } },
      { cfm: 250, deltaPInWg: 0.075, ncRating: 27, throwFt: { t50: 18.0, t100: 12.0, t150: 8.0 } },
      { cfm: 350, deltaPInWg: 0.140, ncRating: 36, throwFt: { t50: 24.0, t100: 16.5, t150: 11.5 } }
    ],
    costIndex: 75,
    provenance: { source: 'Price Industries Linear Catalog', version: '2024.1' }
  },
  {
    id: 'grille-return-eggcrate',
    manufacturer: 'Titus',
    model: '50F Eggcrate Return 24"x24"',
    terminalType: 'return-grille',
    neckSizeIn: { width: 24, height: 24 },
    faceSizeIn: { width: 24, height: 24 },
    minCfm: 300,
    maxCfm: 1500,
    performanceTable: [
      { cfm: 500, deltaPInWg: 0.010, ncRating: 14, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 1000, deltaPInWg: 0.035, ncRating: 24, throwFt: { t50: 0, t100: 0, t150: 0 } },
      { cfm: 1500, deltaPInWg: 0.080, ncRating: 34, throwFt: { t50: 0, t100: 0, t150: 0 } }
    ],
    costIndex: 45,
    provenance: { source: 'Titus Grilles & Registers Catalog', version: '2024.1' }
  }
];

/**
 * Standard Duct Types
 */
export const STANDARD_DUCT_TYPES: DuctTypeItem[] = [
  {
    id: 'duct-rect-galv',
    name: 'Rectangular Sheet Metal (Galvanized)',
    shape: 'rectangular',
    material: 'galvanized-steel',
    roughnessFt: 0.0003,
    maxRecommendedVelocityFpm: 1200,
    maxFrictionRateInWgPer100Ft: 0.10,
    costFactorPerFt: 1.0,
    insulationRValue: 4.2
  },
  {
    id: 'duct-round-spiral',
    name: 'Round Spiral Duct (Galvanized)',
    shape: 'round',
    material: 'galvanized-steel',
    roughnessFt: 0.00015,
    maxRecommendedVelocityFpm: 1500,
    maxFrictionRateInWgPer100Ft: 0.12,
    costFactorPerFt: 0.85,
    insulationRValue: 4.2
  },
  {
    id: 'duct-flex',
    name: 'Flexible Aluminum Duct (Runout)',
    shape: 'flex',
    material: 'flexible-aluminum',
    roughnessFt: 0.003,
    maxRecommendedVelocityFpm: 700,
    maxFrictionRateInWgPer100Ft: 0.15,
    costFactorPerFt: 0.50,
    insulationRValue: 6.0
  }
];

/**
 * Fitting Loss Coefficients (K-factor referenced to local cross-section velocity)
 */
export const STANDARD_FITTING_LOSSES: Record<string, FittingLossDefinition> = {
  'elbow-90-vaned': {
    type: 'elbow-90-vaned',
    name: '90° Rectangular Elbow with Turning Vanes',
    lossCoefficientK: 0.25
  },
  'elbow-90-unvaned': {
    type: 'elbow-90-unvaned',
    name: '90° Rectangular Elbow (Unvaned)',
    lossCoefficientK: 1.15
  },
  'elbow-45': {
    type: 'elbow-45',
    name: '45° Smooth Radius Elbow',
    lossCoefficientK: 0.18
  },
  'branch-tee': {
    type: 'branch-tee',
    name: 'Branch Take-off Conical Boot',
    lossCoefficientK: 0.35
  },
  'reducer': {
    type: 'reducer',
    name: 'Gradual Reducer Transition (< 15°)',
    lossCoefficientK: 0.10
  },
  'fire-damper': {
    type: 'fire-damper',
    name: 'Dynamic Curtain Fire Damper',
    lossCoefficientK: 0.20
  },
  'balancing-damper': {
    type: 'balancing-damper',
    name: 'Manual Volume Damper (Full Open)',
    lossCoefficientK: 0.15
  },
  'filter-merv8': {
    type: 'filter-merv8',
    name: 'Pleated Panel Filter (MERV 8 Clean)',
    lossCoefficientK: 0.0,
    fixedLossInWg: 0.15
  },
  'filter-merv13': {
    type: 'filter-merv13',
    name: 'High Efficiency Filter (MERV 13 Clean)',
    lossCoefficientK: 0.0,
    fixedLossInWg: 0.30
  },
  'silencer': {
    type: 'silencer',
    name: 'Duct Sound Attenuator (3-ft Silencer)',
    lossCoefficientK: 0.0,
    fixedLossInWg: 0.12
  }
};
