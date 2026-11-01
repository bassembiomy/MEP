/**
 * NFPA 10-2022 (Standard for Portable Fire Extinguishers) rules and a typical listed-unit catalog.
 * Ratings are typical UL 711 values — verify with the selected manufacturer's listing.
 */
import { ExtinguisherHazard, ExtinguisherUnitType } from '../fpTypes';

/**
 * Class A (NFPA 10 Table 6.2.1.1) and Class B spill (Table 6.3.1.1) data per hazard class (§5.4).
 * minA: minimum single-extinguisher A rating; areaPerAFt2: floor area per unit of A rating;
 * bShort / bLong: minimum B rating at 30 ft / 50 ft travel.
 */
export const FE_HAZARD: Record<
  ExtinguisherHazard,
  { label: string; minA: number; areaPerAFt2: number; bShort: number; bLong: number }
> = {
  light: { label: 'Light (Low) Hazard', minA: 2, areaPerAFt2: 3000, bShort: 5, bLong: 10 },
  ordinary: { label: 'Ordinary (Moderate) Hazard', minA: 2, areaPerAFt2: 1500, bShort: 10, bLong: 20 },
  extra: { label: 'Extra (High) Hazard', minA: 4, areaPerAFt2: 1000, bShort: 40, bLong: 80 }
};

/** Maximum floor area per extinguisher, ft² (Table 6.2.1.1). */
export const FE_MAX_AREA_PER_UNIT_FT2 = 11250;
/** Class A maximum travel distance, ft (Table 6.2.1.1). */
export const FE_TRAVEL_A_FT = 75;
/** Class B spill travel distance for the lower rating, ft (Table 6.3.1.1). */
export const FE_TRAVEL_B_SHORT_FT = 30;
/** Class B spill travel distance for the higher rating, ft (Table 6.3.1.1). */
export const FE_TRAVEL_B_LONG_FT = 50;
/** Class D maximum travel distance, ft (§6.5). */
export const FE_TRAVEL_D_FT = 75;
/** Class K maximum travel distance, ft (§6.6). */
export const FE_TRAVEL_K_FT = 30;
/** Class B appreciable depth: required B rating per ft² of liquid surface (§6.3.2). */
export const FE_DEEP_B_PER_FT2 = 20;
/** Largest liquid surface for which portable extinguishers may be the sole protection, ft² (§6.3.2). */
export const FE_DEEP_MAX_SURFACE_FT2 = 10;
/** Class K: fryers per extinguisher (§6.6). */
export const FE_K_FRYERS_PER_UNIT = 4;
/** Class K: largest fryer cooking-medium weight covered by the standard rule, lb (§6.6). */
export const FE_K_MAX_FRYER_LB = 80;
/** Max top-of-extinguisher height for gross weight ≤ 40 lb, mm (5 ft, §6.1.3.8). */
export const FE_LIGHT_MOUNT_TOP_MAX_MM = 1530;
/** Max top-of-extinguisher height for gross weight > 40 lb, mm (3.5 ft, §6.1.3.8). */
export const FE_HEAVY_MOUNT_TOP_MAX_MM = 1070;
/** Minimum clearance between extinguisher bottom and floor, mm (4 in, §6.1.3.8). */
export const FE_MIN_BOTTOM_CLEARANCE_MM = 102;
/** Gross weight above which the lower mounting height applies, lb (§6.1.3.8). */
export const FE_HEAVY_LB = 40;

type Spec = {
  id: string;
  label: string;
  agent: ExtinguisherUnitType['agent'];
  a: number;
  b: number;
  c: boolean;
  k?: boolean;
  d?: boolean;
  rating: string;
  capacity: string;
  lb: number;
  h: number;
  wheeled?: boolean;
  hydro: number;
  internal: number | null;
};

const SPECS: Spec[] = [
  { id: 'ABC-2.5', label: 'Multipurpose dry chemical ABC', agent: 'dry-chemical-abc', a: 1, b: 10, c: true, rating: '1-A:10-B:C', capacity: '2.5 lb (1 kg)', lb: 5, h: 330, hydro: 12, internal: 6 },
  { id: 'ABC-5', label: 'Multipurpose dry chemical ABC', agent: 'dry-chemical-abc', a: 2, b: 10, c: true, rating: '2-A:10-B:C', capacity: '5 lb (2.3 kg)', lb: 9, h: 400, hydro: 12, internal: 6 },
  { id: 'ABC-10', label: 'Multipurpose dry chemical ABC', agent: 'dry-chemical-abc', a: 4, b: 60, c: true, rating: '4-A:60-B:C', capacity: '10 lb (4.5 kg)', lb: 17, h: 500, hydro: 12, internal: 6 },
  { id: 'ABC-20', label: 'Multipurpose dry chemical ABC', agent: 'dry-chemical-abc', a: 10, b: 80, c: true, rating: '10-A:80-B:C', capacity: '20 lb (9 kg)', lb: 33, h: 600, hydro: 12, internal: 6 },
  { id: 'CO2-5', label: 'Carbon dioxide', agent: 'co2', a: 0, b: 5, c: true, rating: '5-B:C', capacity: '5 lb (2.3 kg)', lb: 15, h: 550, hydro: 5, internal: null },
  { id: 'CO2-10', label: 'Carbon dioxide', agent: 'co2', a: 0, b: 10, c: true, rating: '10-B:C', capacity: '10 lb (4.5 kg)', lb: 33, h: 700, hydro: 5, internal: null },
  { id: 'CO2-15', label: 'Carbon dioxide', agent: 'co2', a: 0, b: 10, c: true, rating: '10-B:C', capacity: '15 lb (6.8 kg)', lb: 43, h: 750, hydro: 5, internal: null },
  { id: 'CO2-20', label: 'Carbon dioxide', agent: 'co2', a: 0, b: 10, c: true, rating: '10-B:C', capacity: '20 lb (9 kg)', lb: 56, h: 800, hydro: 5, internal: null },
  { id: 'WATER-2.5G', label: 'Stored-pressure water', agent: 'water', a: 2, b: 0, c: false, rating: '2-A', capacity: '2.5 gal (9.5 L)', lb: 28, h: 600, hydro: 5, internal: null },
  { id: 'AFFF-2.5G', label: 'AFFF foam', agent: 'afff', a: 3, b: 20, c: false, rating: '3-A:20-B', capacity: '2.5 gal (9.5 L)', lb: 28, h: 600, hydro: 5, internal: null },
  { id: 'CLEAN-5.5', label: 'Clean agent (HFC-236fa)', agent: 'clean-agent', a: 0, b: 2, c: true, rating: '2-B:C', capacity: '5.5 lb (2.5 kg)', lb: 10, h: 450, hydro: 12, internal: null },
  { id: 'CLEAN-15.5', label: 'Clean agent (HFC-236fa)', agent: 'clean-agent', a: 2, b: 10, c: true, rating: '2-A:10-B:C', capacity: '15.5 lb (7 kg)', lb: 26, h: 550, hydro: 12, internal: null },
  { id: 'WETCHEM-6L', label: 'Wet chemical Class K', agent: 'wet-chemical', a: 2, b: 0, c: false, k: true, rating: '2-A:K', capacity: '1.5 gal (6 L)', lb: 25, h: 550, hydro: 5, internal: null },
  { id: 'CLASSD-30', label: 'Dry powder Class D', agent: 'dry-powder-d', a: 0, b: 0, c: false, d: true, rating: 'D', capacity: '30 lb (13.6 kg)', lb: 45, h: 650, hydro: 12, internal: null },
  { id: 'WHEELED-ABC-125', label: 'Wheeled dry chemical ABC', agent: 'dry-chemical-abc', a: 40, b: 240, c: true, rating: '40-A:240-B:C', capacity: '125 lb (57 kg)', lb: 200, h: 1100, wheeled: true, hydro: 12, internal: 6 }
];

/** Typical listed (UL 711) extinguisher types — verify ratings with the selected manufacturer. */
export const FE_CATALOG: ExtinguisherUnitType[] = SPECS.map((s) => ({
  id: s.id,
  label: `${s.label}, ${s.capacity}`,
  agent: s.agent,
  aRating: s.a,
  bRating: s.b,
  cRated: s.c,
  kRated: !!s.k,
  dRated: !!s.d,
  ratingText: s.rating,
  capacity: s.capacity,
  grossWeightLb: s.lb,
  heightMm: s.h,
  wheeled: !!s.wheeled,
  hydroTestYears: s.hydro,
  internalExamYears: s.internal
}));
