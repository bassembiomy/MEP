/**
 * NFPA 12 (2022) total-flooding CO2 tables and helpers: flooding factors (Table 5.3.3(a)), deep-seated basis
 * (Table 5.4.2.1), material minimum design concentrations (Table 5.3.2.2), material conversion factor, and the
 * Y / Z two-phase flow tables (homogeneous-equilibrium expansion of saturated liquid CO2) with the nozzle flux table.
 * Pure data + helpers; no React / DOM.
 */
import type { SprinklerRoomInput } from '../sprinkler/sprinklerTypes'
import type { Co2Answers, Co2DeepSeatedHazard, Co2EnclosureInput, Co2Storage } from './co2Types'
import { PIPE_DATA } from '../standards/pipeData'

export const FT3_PER_M3 = 35.3146667
export const FT2_PER_M2 = 10.7639104
export const LB_PER_KG = 2.20462262
export const KPA_PER_PSF = 0.04788026
export const FT_PER_MM = 1 / 304.8

export const NOZZLE_MAX_SPACING_MM = 6000
export const SMOKE_DETECTOR_SPACING_MM = 9100
export const HEAT_DETECTOR_SPACING_MM = 6100
export const MIN_TIME_DELAY_S = 20

export const CO2_REFERENCE_QUANTITY = 'NFPA 12-2022 Ch. 5'
export const CO2_REFERENCE_DESIGN = 'NFPA 12-2022 Ch. 4'
export const CO2_PRELIMINARY_NOTE =
  'Preliminary NFPA 12 design — the final flow calculation, nozzle drilling and cylinder quantity are by the manufacturer\'s listed calculation method.'

export function defaultCo2Answers(): Co2Answers {
  return { storage: 'high-pressure', cylinderLb: 100, reserve: false, odorizer: true, detection: 'smoke-cross-zoned', timeDelayS: 30 }
}

export function co2EnclosureFromRoom(room: SprinklerRoomInput, id: string): Co2EnclosureInput {
  return {
    id,
    roomId: room.id,
    name: room.name,
    polygon: room.polygon,
    heightM: room.ceilingHeightM,
    fireType: 'surface',
    material: 'gasoline',
    deepSeated: 'dry-electrical',
    deductionM3: 0,
    openingsM2: 0,
    ventilationM3min: 0,
    temperatureC: 21,
    occupancy: 'normally-unoccupied',
    strengthPsf: 25
  }
}

/** Table 5.3.3(a) at 34 % — total flooding surface fires. */
export function surfaceFloodingFactor(vFt3: number): { ft3PerLb: number; minLb: number } {
  if (vFt3 <= 140) return { ft3PerLb: 14, minLb: 0 }
  if (vFt3 <= 500) return { ft3PerLb: 15, minLb: 10 }
  if (vFt3 <= 1600) return { ft3PerLb: 16, minLb: 35 }
  if (vFt3 <= 4500) return { ft3PerLb: 18, minLb: 100 }
  if (vFt3 <= 50000) return { ft3PerLb: 20, minLb: 250 }
  return { ft3PerLb: 22, minLb: 2500 }
}

/** Table 5.4.2.1 — deep-seated fires. */
export function deepSeatedBasis(hazard: Co2DeepSeatedHazard, vFt3: number): { pct: number; ft3PerLb: number; minLb: number } {
  if (hazard === 'dry-electrical') return vFt3 <= 2000 ? { pct: 50, ft3PerLb: 10, minLb: 0 } : { pct: 50, ft3PerLb: 12, minLb: 200 }
  if (hazard === 'records') return { pct: 65, ft3PerLb: 8, minLb: 0 }
  return { pct: 75, ft3PerLb: 6, minLb: 0 }
}

export const DEEP_SEATED_LABELS: Record<Co2DeepSeatedHazard, string> = {
  'dry-electrical': 'Dry electrical hazards',
  records: 'Bulk paper, ducts, covered trenches',
  'fur-vault': 'Fur storage vaults, dust collectors'
}

/** Material conversion factor (free-efflux basis of Fig. 5.3.4); 1 at or below 34 %. */
export function materialConversionFactor(c: number): number {
  return c > 34 ? Math.log(1 - c / 100) / Math.log(0.66) : 1
}

/** Table 5.3.2.2 — minimum design concentrations, %. Surface design concentration = max(34, mdc). */
export const CO2_MATERIALS: Record<string, { label: string; mdcPct: number }> = {
  acetone: { label: 'Acetone', mdcPct: 34 },
  acetylene: { label: 'Acetylene', mdcPct: 66 },
  'aviation-gasoline': { label: 'Aviation gasoline', mdcPct: 36 },
  benzene: { label: 'Benzene', mdcPct: 37 },
  butadiene: { label: 'Butadiene', mdcPct: 41 },
  butane: { label: 'Butane', mdcPct: 34 },
  'carbon-disulfide': { label: 'Carbon disulfide', mdcPct: 72 },
  'carbon-monoxide': { label: 'Carbon monoxide', mdcPct: 64 },
  'natural-gas': { label: 'Natural gas', mdcPct: 37 },
  cyclopropane: { label: 'Cyclopropane', mdcPct: 37 },
  'diethyl-ether': { label: 'Diethyl ether', mdcPct: 46 },
  'dimethyl-ether': { label: 'Dimethyl ether', mdcPct: 40 },
  ethane: { label: 'Ethane', mdcPct: 40 },
  'ethyl-alcohol': { label: 'Ethyl alcohol', mdcPct: 43 },
  ethylene: { label: 'Ethylene', mdcPct: 49 },
  'ethylene-dichloride': { label: 'Ethylene dichloride', mdcPct: 34 },
  'ethylene-oxide': { label: 'Ethylene oxide', mdcPct: 53 },
  gasoline: { label: 'Gasoline', mdcPct: 34 },
  hexane: { label: 'Hexane', mdcPct: 35 },
  hydrogen: { label: 'Hydrogen', mdcPct: 75 },
  'hydrogen-sulfide': { label: 'Hydrogen sulfide', mdcPct: 36 },
  isobutane: { label: 'Isobutane', mdcPct: 36 },
  'jp-4': { label: 'JP-4', mdcPct: 36 },
  kerosene: { label: 'Kerosene', mdcPct: 34 },
  methane: { label: 'Methane', mdcPct: 34 },
  'methyl-alcohol': { label: 'Methyl alcohol', mdcPct: 40 },
  'methyl-ethyl-ketone': { label: 'Methyl ethyl ketone', mdcPct: 40 },
  pentane: { label: 'Pentane', mdcPct: 35 },
  propane: { label: 'Propane', mdcPct: 36 },
  propylene: { label: 'Propylene', mdcPct: 36 },
  'lube-oils': { label: 'Lubricating oils', mdcPct: 34 },
  'transformer-oil': { label: 'Transformer oil', mdcPct: 34 }
}

// ─────────────────────────── Thermodynamic tables ───────────────────────────

type Row3 = [number, number, number]
type Row2 = [number, number]

/** Rows [P psi, Y psi·lb/ft³, Z], descending P; HEM isenthalpic expansion of saturated liquid CO2 from 750 psi. */
export const HP_YZ: Row3[] = [[750, 0, 0.0], [740, 500.8, 0.0323], [730, 985.8, 0.0645], [720, 1455.3, 0.0967], [710, 1910.0, 0.1289], [700, 2350.3, 0.1611], [690, 2776.6, 0.1933], [680, 3189.4, 0.2256], [670, 3589.1, 0.2578], [660, 3976.1, 0.2902], [650, 4350.7, 0.3226], [640, 4713.4, 0.355], [630, 5064.5, 0.3876], [620, 5404.4, 0.4203], [610, 5733.3, 0.453], [600, 6051.5, 0.4859], [590, 6359.5, 0.519], [580, 6657.4, 0.5522], [570, 6945.6, 0.5856], [560, 7224.2, 0.6191], [550, 7493.7, 0.6529], [540, 7754.2, 0.6869], [530, 8005.9, 0.7211], [520, 8249.2, 0.7555], [510, 8484.1, 0.7903], [500, 8711.1, 0.8253], [490, 8930.2, 0.8606], [480, 9141.6, 0.8962], [470, 9345.7, 0.9322], [460, 9542.5, 0.9685], [450, 9732.2, 1.0052], [440, 9915.0, 1.0424], [430, 10091.2, 1.0799], [420, 10260.8, 1.118], [410, 10424.0, 1.1565], [400, 10581.0, 1.1956], [390, 10732.0, 1.2352], [380, 10877.1, 1.2755], [370, 11016.4, 1.3163], [360, 11150.0, 1.3579], [350, 11278.2, 1.4001], [340, 11401.0, 1.4432], [330, 11518.7, 1.487], [320, 11631.2, 1.5317], [310, 11738.7, 1.5774], [300, 11841.4, 1.6241], [290, 11939.4, 1.6719], [280, 12032.7, 1.7208], [270, 12121.5, 1.771], [260, 12206.0, 1.8226], [250, 12286.1, 1.8756], [240, 12362.0, 1.9302], [230, 12433.8, 1.9865], [220, 12501.6, 2.0448], [210, 12565.6, 2.1051], [200, 12625.7, 2.1677], [190, 12682.1, 2.2329], [180, 12734.9, 2.3008], [170, 12784.1, 2.3719], [160, 12829.9, 2.4464], [150, 12872.3, 2.525]]
/** Same for low-pressure storage (from 300 psi). */
export const LP_YZ: Row3[] = [[300, 0, 0.0], [290, 595.6, 0.1422], [280, 1114.3, 0.2766], [270, 1569.2, 0.4047], [260, 1970.4, 0.528], [250, 2325.8, 0.6473], [240, 2641.7, 0.7637], [230, 2923.2, 0.8779], [220, 3174.5, 0.9904], [210, 3399.2, 1.102], [200, 3600.2, 1.2133], [190, 3780.1, 1.3246], [180, 3941.0, 1.4367], [170, 4084.7, 1.55], [160, 4212.9, 1.6651], [150, 4327.0, 1.7828], [140, 4428.3, 1.9037], [130, 4517.9, 2.0287], [120, 4596.8, 2.1588], [110, 4665.9, 2.2951], [100, 4725.9, 2.4393]]
/** Rows [P psi, lb/min per in² of equivalent orifice area], HEM critical flow, Cd = 1. */
export const HP_FLUX: Row2[] = [[750, 2568.9], [700, 2351.5], [650, 2142.9], [600, 1942.2], [550, 1748.8], [500, 1562.2], [450, 1382.0], [400, 1207.7], [350, 1039.0], [300, 875.6], [250, 717.4], [200, 564.2], [150, 415.8]]
export const LP_FLUX: Row2[] = [[300, 1452.7], [275, 1276.5], [250, 1116.9], [225, 970.1], [200, 833.9], [175, 706.6], [150, 587.1], [125, 474.4], [100, 343.1]]

export const START_PRESSURE_PSI: Record<Co2Storage, number> = { 'high-pressure': 750, 'low-pressure': 300 }
/** Minimum nozzle pressure (NFPA 12 Ch. 4). */
export const MIN_NOZZLE_PRESSURE_PSI: Record<Co2Storage, number> = { 'high-pressure': 300, 'low-pressure': 150 }

const yzTable = (s: Co2Storage): Row3[] => (s === 'high-pressure' ? HP_YZ : LP_YZ)
const fluxTable = (s: Co2Storage): Row2[] => (s === 'high-pressure' ? HP_FLUX : LP_FLUX)

/** Y and Z at pressure P (linear interpolation; clamped to the table range). */
export function yzAt(storage: Co2Storage, p: number): { y: number; z: number } {
  const t = yzTable(storage)
  if (p >= t[0][0]) return { y: t[0][1], z: t[0][2] }
  const last = t[t.length - 1]
  if (p <= last[0]) return { y: last[1], z: last[2] }
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i]
    const b = t[i + 1]
    if (p <= a[0] && p >= b[0]) {
      const f = (a[0] - p) / (a[0] - b[0])
      return { y: a[1] + f * (b[1] - a[1]), z: a[2] + f * (b[2] - a[2]) }
    }
  }
  return { y: last[1], z: last[2] }
}

/** Inverse of Y(P): pressure at which Y is reached (beyond the last row → last pressure). */
export function pressureAtY(storage: Co2Storage, y: number): number {
  const t = yzTable(storage)
  if (y <= t[0][1]) return t[0][0]
  const last = t[t.length - 1]
  if (y >= last[1]) return last[0]
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i]
    const b = t[i + 1]
    if (y >= a[1] && y <= b[1]) {
      const f = b[1] === a[1] ? 0 : (y - a[1]) / (b[1] - a[1])
      return a[0] + f * (b[0] - a[0])
    }
  }
  return last[0]
}

/** Nozzle flux, lb/min per in² of equivalent orifice area, at pressure P (linear interpolation, clamped). */
export function nozzleFluxAt(storage: Co2Storage, p: number): number {
  const t = fluxTable(storage)
  if (p >= t[0][0]) return t[0][1]
  const last = t[t.length - 1]
  if (p <= last[0]) return last[1]
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i]
    const b = t[i + 1]
    if (p <= a[0] && p >= b[0]) {
      const f = (a[0] - p) / (a[0] - b[0])
      return a[1] + f * (b[1] - a[1])
    }
  }
  return last[1]
}

// ─────────────────────────── Pipe ───────────────────────────

export const CO2_PIPE_SIZES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]
const ID_SCH80: Record<number, number> = { 0.5: 0.546, 0.75: 0.742, 1: 0.957, 1.25: 1.278, 1.5: 1.5, 2: 1.939, 2.5: 2.323, 3: 2.9, 4: 3.826 }

/** High-pressure: ≤ ¾" Sch 40, ≥ 1" Sch 80 (threaded); low-pressure: Sch 40. */
export function co2Schedule(storage: Co2Storage, sizeIn: number): 'sch40' | 'sch80' {
  return storage === 'high-pressure' && sizeIn >= 1 ? 'sch80' : 'sch40'
}

export function co2PipeId(sizeIn: number, schedule: 'sch40' | 'sch80'): number {
  return schedule === 'sch80' ? ID_SCH80[sizeIn] : PIPE_DATA[sizeIn].idSch40
}
