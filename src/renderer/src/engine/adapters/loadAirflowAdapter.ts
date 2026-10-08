import type { ZoneLoadResult, ZoneAirflowResult } from '../orchestrator/orchestratorTypes'
import { calculatePreliminaryZoneLoad } from '../preliminaryLoad'
import type { PreliminaryLoadSettings } from '../preliminaryLoad'

export interface LoadAndAirflowResult extends ZoneLoadResult, ZoneAirflowResult {
  assumptions?: string[]
}

export interface LoadAndAirflowSettings extends PreliminaryLoadSettings {
  perimeterFt?: number
  spaceTypeId?: string
  outdoorDbF?: number
  indoorDbF?: number
}

/** Positional inputs are imperial; lighting and equipment densities are W/ft². */
export function adaptCalculateLoadAndAirflow(
  areaSqFt: number,
  ceilingHeightFt: number = 10,
  occupancy: number = 2,
  lightingWattsPerSqFt: number = 1.0,
  equipmentWattsPerSqFt: number = 0.5,
  manualLoadBtu?: number,
  manualCfm?: number,
  settings: LoadAndAirflowSettings = {}
): LoadAndAirflowResult {
  const load = calculatePreliminaryZoneLoad({
      ...settings,
      areaSqFt,
      perimeterFt: settings.perimeterFt ?? 4 * Math.sqrt(areaSqFt),
      ceilingHeightFt,
      occupants: occupancy,
      lightingWattsPerSqFt,
      equipmentWattsPerSqFt,
      spaceTypeId: settings.spaceTypeId ?? 'office',
      outdoorDbF: settings.outdoorDbF ?? 95,
      indoorDbF: settings.indoorDbF ?? 75,
      manualLoadBtu,
      manualCfm
    })
  return {
    sensibleBtu: load.sensibleLoad,
    latentBtu: load.latentLoad,
    totalBtu: load.totalLoad,
    areaSqFt: load.area,
    supplyCfm: load.supplyCfm,
    returnCfm: load.returnCfm,
    outdoorAirCfm: load.oaCfm,
    assumptions:
      settings.perimeterFt === undefined ? ['Perimeter estimated from a square of equal area.'] : []
  }
}
