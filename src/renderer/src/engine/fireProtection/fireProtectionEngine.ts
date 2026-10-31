/**
 * Fire protection engine orchestrator: demand -> pump set -> tank & sump -> pump room -> checks.
 */
import { DEFAULT_FIRE_INPUT } from './defaults';
import { FireDesignInput, FireDesignResult } from './fpTypes';
import { calculateSystemDemand } from './hydraulics';
import { designPumpRoom } from './pumpRoomDesigner';
import { selectPumpSet } from './pumpSelector';
import { STANDARDS_REFERENCES } from './standards/codeReferences';
import { designTank } from './tankDesigner';

export { DEFAULT_FIRE_INPUT };

/** Run the complete fire-protection design (NFPA 13/14/20/22) for an input. */
export function designFireProtectionSystem(input: FireDesignInput): FireDesignResult {
  const demand = calculateSystemDemand(input);
  const pumps = selectPumpSet(input, demand);
  const tank = designTank(input, demand, pumps);
  const room = designPumpRoom(input, pumps, tank);
  return {
    input,
    demand,
    pumps,
    tank,
    room,
    checks: [...pumps.checks, ...tank.checks, ...room.checks],
    standardsReferences: STANDARDS_REFERENCES.map((r) => ({ ...r }))
  };
}
