import type { Zone, ProjectMetadata } from '../store/projectStore'
import { normalizePolygonToFeet } from './adapters/zoningAdapter'
import {
  METERS_PER_FOOT,
  LITERS_PER_SECOND_PER_CFM,
  WATTS_PER_BTU_PER_HOUR,
  measureSimplePolygon,
  requirePositive
} from './engineeringInputs'
import { calculatePreliminaryZoneLoad, roundLoadDisplay } from './preliminaryLoad'
import type { PreliminaryLoadSettings } from './preliminaryLoad'

/** UI boundary: an invalid input stays editable and never becomes a fabricated load. */
export function calculateZoneLoadSafely(zone: Zone, project: ProjectMetadata): {
  load: LoadResult | null
  error?: string
} {
  try {
    return { load: calculateZoneLoad(zone, project) }
  } catch (error) {
    return { load: null, error: error instanceof Error ? error.message : 'Invalid engineering input' }
  }
}

export interface LoadResult {
  area: number // sqft or sqm
  perimeter: number // ft or m
  occupants: number
  sensibleLoad: number // Btu/h or W
  latentLoad: number // Btu/h or W
  totalLoad: number // Btu/h or W
  sensibleHeatRatio: number // SHR = Qs / Qt
  totalTons: number // Tonnage (1 TR = 12000 Btu/h or 3.517 kW)
  supplyCfm: number // Supply Airflow CFM or L/s
  thermalCfm: number // Sensible thermal CFM or L/s
  vbzCfm: number // Breathing zone ventilation CFM or L/s
  vozCfm: number // Zone outdoor air intake CFM or L/s (Vbz / Ez)
  oaFraction: number // Voz / Supply CFM
  oaCfm: number // Outdoor air CFM or L/s
  exhaustCfm: number // Exhaust CFM or L/s
  returnCfm: number // Return CFM or L/s
}

/** Preliminary load estimate. Project geometry/temperatures/overrides follow project display units.
 * Lighting/equipment overrides remain W/ft² for backward compatibility.
 * Calculations use imperial units, then convert metric display values before rounding.
 */
export function calculateCanonicalZoneLoad(
  zone: Zone,
  project: ProjectMetadata & PreliminaryLoadSettings
): LoadResult {
  if(project.cadUnitsConfirmed===false) throw new RangeError('Confirm CAD drawing units and scale before engineering calculations');
  requirePositive('Drawing scale', project.scale)
  const isMetric = project.units === 'metric'
  const geometry = measureSimplePolygon(
    normalizePolygonToFeet(zone.points, project.units, project.scale)
  )
  const result = calculatePreliminaryZoneLoad({
    areaSqFt: geometry.area,
    perimeterFt: geometry.perimeter,
    ceilingHeightFt: zone.ceilingHeight / (isMetric ? METERS_PER_FOOT : 1),
    spaceTypeId: zone.spaceTypeId,
    occupants: zone.occupants,
    lightingWattsPerSqFt: zone.lightingOverride,
    equipmentWattsPerSqFt: zone.equipmentOverride,
    outdoorDbF: isMetric ? project.outdoorDb * 1.8 + 32 : project.outdoorDb,
    indoorDbF: isMetric ? project.indoorDb * 1.8 + 32 : project.indoorDb,
    manualLoadBtu:
      zone.manualCoolingOverride === undefined
        ? undefined
        : zone.manualCoolingOverride / (isMetric ? WATTS_PER_BTU_PER_HOUR : 1),
    manualCfm:
      zone.manualCfmOverride === undefined
        ? undefined
        : zone.manualCfmOverride / (isMetric ? LITERS_PER_SECOND_PER_CFM : 1),
    humidityRatioDelta: project.humidityRatioDelta,
    supplyDeltaTF: project.supplyDeltaTF,
    exposedWallFraction: project.exposedWallFraction,
    roofExposureFraction: project.roofExposureFraction
  })
  return result
}

export function calculateZoneLoad(zone: Zone, project: ProjectMetadata & PreliminaryLoadSettings): LoadResult {
  const result = calculateCanonicalZoneLoad(zone, project)
  const isMetric = project.units === 'metric'
  if (!isMetric) return roundLoadDisplay(result)
  return roundLoadDisplay({
    ...result,
    area: result.area * METERS_PER_FOOT ** 2,
    perimeter: result.perimeter * METERS_PER_FOOT,
    sensibleLoad: result.sensibleLoad * WATTS_PER_BTU_PER_HOUR,
    latentLoad: result.latentLoad * WATTS_PER_BTU_PER_HOUR,
    totalLoad: result.totalLoad * WATTS_PER_BTU_PER_HOUR,
    supplyCfm: result.supplyCfm * LITERS_PER_SECOND_PER_CFM,
    thermalCfm: result.thermalCfm * LITERS_PER_SECOND_PER_CFM,
    vbzCfm: result.vbzCfm * LITERS_PER_SECOND_PER_CFM,
    vozCfm: result.vozCfm * LITERS_PER_SECOND_PER_CFM,
    oaCfm: result.oaCfm * LITERS_PER_SECOND_PER_CFM,
    exhaustCfm: result.exhaustCfm * LITERS_PER_SECOND_PER_CFM,
    returnCfm: result.returnCfm * LITERS_PER_SECOND_PER_CFM
  })
}
