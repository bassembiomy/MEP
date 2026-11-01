/**
 * Default design input for the fire pump room & tank module (plan §3.4).
 */
import { BuildingInput, ExtinguisherDesignInput, ExtinguisherZoneInput, FireDesignInput, FloorLevel, StandpipeDesignInput } from './fpTypes';

/** Simple project input (no building data): OH2 sprinklers, Class I standpipes, electric + diesel pumps, underground RC tank. */
export const SIMPLE_FIRE_INPUT: FireDesignInput = {
  projectName: 'Fire Pump Room & Tank',
  projectNumber: 'FP-2026-001',
  designer: 'MEP Designer',

  hazard: 'ordinary-2',
  sprinklerK: 5.6,
  branchLinePipe: { nominalIn: 2, schedule: 'sch40', c: 120 },
  crossMainPipe: { nominalIn: 4, schedule: 'sch40', c: 120 },
  riser: {
    pipe: { nominalIn: 6, schedule: 'sch40', c: 120 },
    lengthFt: 40,
    elevationRiseFt: 40,
    fittings: { 'tee-branch': 1, 'alarm-check': 1, 'gate-valve': 1 }
  },
  feedMain: {
    pipe: { nominalIn: 6, schedule: 'sch40', c: 120 },
    lengthFt: 150,
    elevationRiseFt: 0,
    fittings: { 'elbow-90': 4, 'tee-branch': 1, 'gate-valve': 1 }
  },
  insideHoseGpm: 100,

  standpipeClass: 'I',
  standpipeCount: 2,
  buildingSprinklered: true,
  standpipeTopOutletHeightFt: 45,
  standpipeFrictionPsi: 10,

  arrangement: 'electric+diesel',
  pumpTypePreference: 'auto',
  systemComponentRatingPsi: 175,
  siteElevationFt: 300,
  ambientTempF: 75,
  electricalSupply: { voltage: 400, phases: 3, hz: 50 },

  tankMaterial: 'reinforced-concrete',
  tankPlacement: 'underground',
  tankEffectiveDepthM: 3.0,
  twoCompartments: true,
  tankFloorToPumpCLm: 0.5,
  refillFlowGpm: 250
};

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

function defaultFloors(): FloorLevel[] {
  const floors: FloorLevel[] = [
    { id: 'B1', name: 'Basement 1', elevationM: -4.0, floorToFloorM: 4.0, usage: 'Parking / Plant', areaM2: 1200, sprinklered: true, hoseConnection: true, isRoof: false },
    { id: 'GF', name: 'Ground Floor', elevationM: 0.0, floorToFloorM: 4.5, usage: 'Lobby / Retail', areaM2: 1200, sprinklered: true, hoseConnection: true, isRoof: false }
  ];
  for (let n = 1; n <= 8; n++) {
    floors.push({ id: `L${n}`, name: `Level ${n}`, elevationM: r3(4.5 + 3.6 * (n - 1)), floorToFloorM: 3.6, usage: 'Office', areaM2: 1200, sprinklered: true, hoseConnection: true, isRoof: false });
  }
  floors.push({ id: 'RF', name: 'Roof', elevationM: 33.3, floorToFloorM: 0, usage: 'Roof', areaM2: 1200, sprinklered: false, hoseConnection: false, isRoof: true });
  return floors;
}

const DEFAULT_BUILDING: BuildingInput = {
  floors: defaultFloors(),
  pumpRoomFloorElevationM: -4.5,
  roofSlopeLessThan4in12: true,
  fireDeptAccessElevationM: 0
};

const DEFAULT_STANDPIPE_DESIGN: StandpipeDesignInput = {
  systemType: 'automatic-wet',
  combinedWithSprinklers: true,
  locations: [
    { tag: 'ST-1', location: 'Stair 1', horizontalRunToPumpM: 25, servesRoof: true },
    { tag: 'ST-2', location: 'Stair 2', horizontalRunToPumpM: 40, servesRoof: false }
  ],
  riserSizeIn: undefined,
  pipe: { schedule: 'sch40', c: 120 },
  hoseValveHeightMm: 1200,
  fdcDistanceToHydrantM: 20,
  fdcInlets: undefined
};

const efZone = (p: Partial<ExtinguisherZoneInput> & Pick<ExtinguisherZoneInput, 'id' | 'name' | 'floorId' | 'hazard' | 'lengthM' | 'widthM'>): ExtinguisherZoneInput => ({
  classA: true, classB: 'none', deepLayerSurfaceM2: 0, classC: false, sensitiveElectronics: false,
  classD: false, dMetal: '', fryers: 0, maxFryerOilLb: 0, mounting: 'bracket', ...p
});

/** Default portable extinguisher zones (NFPA 10-2022). */
const DEFAULT_EXTINGUISHERS: ExtinguisherDesignInput = {
  zones: [
    efZone({ id: 'Z1', name: 'Parking', floorId: 'B1', hazard: 'ordinary', lengthM: 40, widthM: 30, classB: 'spill' }),
    efZone({ id: 'Z2', name: 'Electrical Room', floorId: 'B1', hazard: 'ordinary', lengthM: 6, widthM: 5, classC: true, sensitiveElectronics: true, mounting: 'cabinet' }),
    efZone({ id: 'Z3', name: 'Fire Pump Room', floorId: 'B1', hazard: 'ordinary', lengthM: 13.8, widthM: 6.5, classB: 'spill', classC: true }),
    efZone({ id: 'Z4', name: 'Lobby', floorId: 'GF', hazard: 'light', lengthM: 40, widthM: 27.5 }),
    efZone({ id: 'Z5', name: 'Kitchen', floorId: 'GF', hazard: 'ordinary', lengthM: 10, widthM: 10, fryers: 3, maxFryerOilLb: 50 }),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
      efZone({ id: `Z${n + 5}`, name: `Offices Level ${n}`, floorId: `L${n}`, hazard: 'light', lengthM: 40, widthM: 30 })
    )
  ]
};

/** Default project input: 11-level building with two Class I combined standpipes, 300 psi components. */
export const DEFAULT_FIRE_INPUT: FireDesignInput = {
  ...SIMPLE_FIRE_INPUT,
  systemComponentRatingPsi: 300,
  building: DEFAULT_BUILDING,
  standpipeDesign: DEFAULT_STANDPIPE_DESIGN,
  extinguishers: DEFAULT_EXTINGUISHERS
};
