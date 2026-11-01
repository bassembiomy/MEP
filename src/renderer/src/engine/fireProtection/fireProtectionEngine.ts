/**
 * Fire protection engine orchestrator: demand -> pump set -> tank & sump -> pump room -> checks.
 */
import { DEFAULT_FIRE_INPUT, SIMPLE_FIRE_INPUT } from './defaults';
import { FireDesignInput, FireDesignResult, StandpipeSystemDesign } from './fpTypes';
import { calculateSprinklerDemand, calculateSystemDemand } from './hydraulics';
import { designExtinguishers } from './extinguisherDesigner';
import { designPumpRoom } from './pumpRoomDesigner';
import { analyzeStandpipeOutlets, derivedSprinklerRiser, designStandpipeHydraulics, pumpCenterlineAbsM, standpipeApplicable } from './standpipeDesigner';
import { selectRatedCapacity } from './standards/nfpa20';
import { STANDPIPE_DURATION_MIN, standpipeFlowGpm } from './standards/nfpa14';
import { selectPumpSet } from './pumpSelector';
import { STANDARDS_REFERENCES } from './standards/codeReferences';
import { designTank } from './tankDesigner';

export { DEFAULT_FIRE_INPUT, SIMPLE_FIRE_INPUT };

/** Run the complete fire-protection design (NFPA 13/14/20/22) for an input. */
export function designFireProtectionSystem(inputIn: FireDesignInput): FireDesignResult {
  let input = inputIn;
  let spHyd: StandpipeSystemDesign | null = null;
  let demand;
  if (standpipeApplicable(inputIn)) {
    const locations = inputIn.standpipeDesign!.locations;
    const q = standpipeFlowGpm(inputIn.standpipeClass, locations.length, inputIn.buildingSprinklered);
    const sprFlow = calculateSprinklerDemand(inputIn).sprinklerFlowGpm;
    const rated0 = selectRatedCapacity(Math.max(sprFlow + inputIn.insideHoseGpm, q));
    const pumpCLAbs = pumpCenterlineAbsM(inputIn, rated0);
    input = { ...inputIn, riser: derivedSprinklerRiser(inputIn, pumpCLAbs), standpipeCount: locations.length };
    spHyd = designStandpipeHydraulics(input, pumpCLAbs);
    demand = calculateSystemDemand(input, {
      standpipe: {
        applicable: true,
        flowGpm: spHyd.demandFlowGpm,
        residualPressurePsi: spHyd.topOutletResidualPsi,
        pressureAtPumpDischargePsi: spHyd.pressureAtPumpDischargePsi,
        durationMin: STANDPIPE_DURATION_MIN
      }
    });
  } else {
    demand = calculateSystemDemand(input);
  }
  const pumps = selectPumpSet(input, demand);
  const tank = designTank(input, demand, pumps);
  const room = designPumpRoom(input, pumps, tank);
  const standpipe = spHyd ? analyzeStandpipeOutlets(spHyd, input, pumps) : null;
  const extinguishers = designExtinguishers(input);
  return {
    input,
    demand,
    pumps,
    tank,
    room,
    standpipe,
    extinguishers,
    checks: [
      ...pumps.checks,
      ...tank.checks,
      ...room.checks,
      ...room.drainageSump.checks,
      ...(standpipe ? standpipe.checks : []),
      ...(extinguishers ? [...extinguishers.zones.flatMap((z) => z.checks), ...extinguishers.checks] : [])
    ],
    standardsReferences: STANDARDS_REFERENCES.map((r) => ({ ...r }))
  };
}
