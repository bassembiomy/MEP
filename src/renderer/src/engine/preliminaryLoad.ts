import { ASHRAE_SPACE_TYPES, DEFAULT_U_VALUES } from './knowledgeBase'
import { requireFinite, requireNonnegative, requirePositive } from './engineeringInputs'
import type { LoadResult } from './loadCalc'

export interface PreliminaryLoadSettings {
  humidityRatioDelta?: number // lb/lb (dimensionless, also kg/kg)
  supplyDeltaTF?: number // Room-to-supply temperature difference in °F
  exposedWallFraction?: number
  roofExposureFraction?: number
}
export interface PreliminaryLoadInput extends PreliminaryLoadSettings {
  areaSqFt: number
  perimeterFt: number
  ceilingHeightFt: number
  spaceTypeId: string
  occupants?: number
  lightingWattsPerSqFt?: number
  equipmentWattsPerSqFt?: number
  outdoorDbF: number
  indoorDbF: number
  manualLoadBtu?: number
  manualCfm?: number
}
function fraction(name: string, value: number): number {
  requireNonnegative(name, value)
  if (value > 1) throw new RangeError(`${name} must be between zero and one`)
  return value
}

/** Preliminary steady-state model, unrounded in canonical imperial units.
 * Omits solar, infiltration, schedules and detailed envelope/psychrometric analysis.
 * Catalog ventilation rates do not by themselves establish compliance.
 */
export function calculatePreliminaryZoneLoad(input: PreliminaryLoadInput): LoadResult {
  const area = requirePositive('Area', input.areaSqFt)
  const perimeter = requirePositive('Perimeter', input.perimeterFt)
  const height = requirePositive('Ceiling height', input.ceilingHeightFt)
  const spaceType = ASHRAE_SPACE_TYPES.find((type) => type.id === input.spaceTypeId)
  if (!spaceType) throw new RangeError(`Unknown space type: ${input.spaceTypeId}`)
  const occupants = requireNonnegative(
    'Occupants',
    input.occupants ?? Math.ceil((area * spaceType.density) / 1000)
  )
  const lighting = requireNonnegative(
    'Lighting density',
    input.lightingWattsPerSqFt ?? spaceType.lightingDensity
  )
  const equipment = requireNonnegative(
    'Equipment density',
    input.equipmentWattsPerSqFt ?? spaceType.equipmentDensity
  )
  const outdoorDbF = requireFinite('Outdoor dry bulb', input.outdoorDbF)
  const indoorDbF = requireFinite('Indoor dry bulb', input.indoorDbF)
  const humidityDelta = requireNonnegative(
    'Humidity ratio delta',
    input.humidityRatioDelta ?? 0.005
  )
  const supplyDeltaT = requirePositive('Supply temperature difference', input.supplyDeltaTF ?? 20)
  const wallFraction = fraction('Exposed wall fraction', input.exposedWallFraction ?? 0.5)
  const roofFraction = fraction('Roof exposure fraction', input.roofExposureFraction ?? 1)
  if (input.manualLoadBtu !== undefined)
    requireNonnegative('Manual cooling load', input.manualLoadBtu)
  if (input.manualCfm !== undefined) requireNonnegative('Manual airflow', input.manualCfm)
  const deltaT = Math.max(0, outdoorDbF - indoorDbF)
  const vbzCfm = spaceType.rp * occupants + spaceType.ra * area
  const vozCfm = vbzCfm // Ez = 1 for ceiling supply of cool air in this preliminary model.
  let sensibleLoad =
    DEFAULT_U_VALUES.wall * perimeter * height * wallFraction * deltaT +
    DEFAULT_U_VALUES.roof * area * roofFraction * deltaT +
    occupants * spaceType.sensibleGain +
    3.412 * area * (lighting + equipment) +
    1.08 * vozCfm * deltaT
  let latentLoad = occupants * spaceType.latentGain + 4840 * vozCfm * humidityDelta
  if (input.manualLoadBtu !== undefined) {
    sensibleLoad = input.manualLoadBtu * 0.75
    latentLoad = input.manualLoadBtu * 0.25
  }
  const totalLoad = sensibleLoad + latentLoad
  const thermalCfm = sensibleLoad / (1.08 * supplyDeltaT)
  const requiredSupply = Math.max(thermalCfm, vozCfm)
  if (input.manualCfm !== undefined && input.manualCfm < requiredSupply) {
    throw new RangeError(
      `Manual airflow is below thermal or outdoor-air demand (${requiredSupply} CFM)`
    )
  }
  const supplyCfm = input.manualCfm ?? Math.max(requiredSupply, totalLoad > 0 ? 100 : 0)
  const exhaustCfm =
    input.spaceTypeId === 'toilet-public' ? 50 : input.spaceTypeId === 'toilet-private' ? 25 : 0
  const result: LoadResult = {
    area,
    perimeter,
    occupants,
    sensibleLoad,
    latentLoad,
    totalLoad,
    sensibleHeatRatio: totalLoad > 0 ? sensibleLoad / totalLoad : 1,
    totalTons: totalLoad / 12000,
    supplyCfm,
    thermalCfm,
    vbzCfm,
    vozCfm,
    oaFraction: supplyCfm > 0 ? vozCfm / supplyCfm : 0,
    oaCfm: vozCfm,
    exhaustCfm,
    returnCfm: Math.max(0, supplyCfm - exhaustCfm)
  }
  for (const [name, value] of Object.entries(result)) requireFinite(name, value)
  return result
}

/** Existing integer load/airflow display rounding; geometry stays precise. */
export function roundLoadDisplay(result: LoadResult): LoadResult {
  return {
    ...result,
    sensibleLoad: Math.round(result.sensibleLoad),
    latentLoad: Math.round(result.latentLoad),
    totalLoad: Math.round(result.totalLoad),
    sensibleHeatRatio: Math.round(result.sensibleHeatRatio * 100) / 100,
    totalTons: Math.round(result.totalTons * 10) / 10,
    supplyCfm: Math.round(result.supplyCfm),
    thermalCfm: Math.round(result.thermalCfm),
    vbzCfm: Math.round(result.vbzCfm),
    vozCfm: Math.round(result.vozCfm),
    oaFraction: Math.round(result.oaFraction * 1000) / 1000,
    oaCfm: Math.round(result.oaCfm),
    exhaustCfm: Math.round(result.exhaustCfm),
    returnCfm: Math.round(result.returnCfm)
  }
}
