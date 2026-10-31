/**
 * Default design input for the fire pump room & tank module (plan §3.4).
 */
import { FireDesignInput } from './fpTypes';

/** Default project input: OH2 sprinklers, Class I standpipes, electric + diesel pumps, underground RC tank. */
export const DEFAULT_FIRE_INPUT: FireDesignInput = {
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
