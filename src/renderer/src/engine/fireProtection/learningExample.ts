/**
 * Learning example — a small, complete teaching project used by the "Learning" tab
 * of the Fire Fighting workspace to walk a new user through the application.
 *
 * Project: 7-storey office building (B1 + Ground + 5 upper floors + roof), light-hazard
 * offices (NFPA 13), Class I combined standpipes in two stairs (NFPA 14), electric duty +
 * diesel standby fire pumps (NFPA 20), reinforced-concrete fire water tank (NFPA 22).
 */
import type { FireDesignInput, FloorLevel } from './fpTypes'
import { SIMPLE_FIRE_INPUT } from './defaults'
import { generateExtinguisherZonesFromFloors } from './extinguisherDesigner'

function floor(
  id: string,
  name: string,
  elevationM: number,
  floorToFloorM: number,
  usage: string,
  isRoof = false
): FloorLevel {
  return {
    id,
    name,
    elevationM,
    floorToFloorM,
    usage,
    areaM2: 900,
    sprinklered: !isRoof,
    hoseConnection: !isRoof,
    isRoof
  }
}

const FLOORS: FloorLevel[] = [
  floor('B1', 'Basement 1', -3.5, 3.5, 'Parking / Plant'),
  floor('GF', 'Ground Floor', 0, 4.0, 'Lobby'),
  ...[1, 2, 3, 4, 5].map((n) =>
    floor(`L${n}`, `Level ${n}`, Math.round((4.0 + 3.5 * (n - 1)) * 1000) / 1000, 3.5, 'Office')
  ),
  floor('RF', 'Roof', 21.5, 0, 'Roof', true)
]

const LEARNING_BUILDING = {
  floors: FLOORS,
  pumpRoomFloorElevationM: -4.0,
  roofSlopeLessThan4in12: true,
  fireDeptAccessElevationM: 0
}

export const LEARNING_EXAMPLE_INPUT: FireDesignInput = {
  ...SIMPLE_FIRE_INPUT,
  projectName: 'Learning Example - Office Tower',
  projectNumber: 'LEARN-001',
  designer: 'Trainee',
  hazard: 'light',
  densityGpmFt2: undefined,
  designAreaFt2: undefined,
  sprinklerCoverageFt2: undefined,
  sprinklerK: 5.6,
  insideHoseGpm: 100,
  totalHoseAllowanceGpm: undefined,
  durationMin: undefined,
  standpipeClass: 'I',
  standpipeCount: 2,
  buildingSprinklered: true,
  arrangement: 'electric+diesel',
  pumpTypePreference: 'auto',
  systemComponentRatingPsi: 300,
  tankMaterial: 'reinforced-concrete',
  tankPlacement: 'underground',
  tankEffectiveDepthM: 2.5,
  twoCompartments: true,
  tankFloorToPumpCLm: 0.5,
  refillFlowGpm: 200,
  building: LEARNING_BUILDING,
  extinguishers: { zones: generateExtinguisherZonesFromFloors(LEARNING_BUILDING) },
  standpipeDesign: {
    systemType: 'automatic-wet',
    combinedWithSprinklers: true,
    locations: [
      { tag: 'ST-1', location: 'Stair 1 (east core)', horizontalRunToPumpM: 20, servesRoof: true },
      { tag: 'ST-2', location: 'Stair 2 (west core)', horizontalRunToPumpM: 30, servesRoof: false }
    ],
    riserSizeIn: undefined,
    pipe: { schedule: 'sch40', c: 120 },
    hoseValveHeightMm: 1200,
    fdcDistanceToHydrantM: 15,
    fdcInlets: undefined
  }
}
