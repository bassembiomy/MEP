/**
 * Fire protection engine orchestrator: demand -> pump set -> tank & sump -> pump room -> checks.
 */
import { DEFAULT_FIRE_INPUT, SIMPLE_FIRE_INPUT } from './defaults';
import { FireDesignInput, FireDesignResult, SprinklerDemandResult, StandpipeSystemDesign } from './fpTypes';
import { calculateSprinklerDemand, calculateSystemDemand } from './hydraulics';
import { designExtinguishers } from './extinguisherDesigner';
import { designPumpRoom } from './pumpRoomDesigner';
import { analyzeStandpipeOutlets, derivedSprinklerRiser, designStandpipeHydraulics, pumpCenterlineAbsM, standpipeApplicable } from './standpipeDesigner';
import { selectRatedCapacity } from './standards/nfpa20';
import { STANDPIPE_DURATION_MIN, standpipeFlowGpm } from './standards/nfpa14';
import { selectPumpSet } from './pumpSelector';
import { STANDARDS_REFERENCES } from './standards/codeReferences';
import { designTank } from './tankDesigner';
import { applyFirePumpSupply, designSprinklerSystem } from './sprinkler/sprinklerEngine';
import type { SprinklerSystemDesign } from './sprinkler/sprinklerTypes';
import { designCo2System } from './co2/co2Engine';

export { DEFAULT_FIRE_INPUT, SIMPLE_FIRE_INPUT };

/** Run the complete fire-protection design (NFPA 13/14/20/22) for an input. */
export function designFireProtectionSystem(inputIn: FireDesignInput): FireDesignResult {
  let input = inputIn;
  let spHyd: StandpipeSystemDesign | null = null;
  let demand;
  let sprDesign: SprinklerSystemDesign | null = null;
  let sprOverride: SprinklerDemandResult | undefined;
  const sd = inputIn.sprinklerDesign;
  if (sd) {
    // flow does not depend on the riser elevation: size the pump centre-line from a standalone calculation first
    const flow0 = designSprinklerSystem(sd).governing?.flowAtSourceGpm ?? 0;
    const q = standpipeApplicable(inputIn)
      ? standpipeFlowGpm(inputIn.standpipeClass, inputIn.standpipeDesign!.locations.length, inputIn.buildingSprinklered)
      : 0;
    const rated0 = selectRatedCapacity(Math.max(flow0 + inputIn.insideHoseGpm, q, 1));
    const pumpCLAbs = pumpCenterlineAbsM(inputIn, rated0);
    sprDesign = designSprinklerSystem(sd, { pumpCLAbsM: pumpCLAbs, feedMain: inputIn.feedMain, insideHoseGpm: inputIn.insideHoseGpm });
    const g = sprDesign.governing;
    if (g) {
      const gf = sprDesign.floors.find((f) => f.floorId === g.floorId)!;
      const remote = gf.heads.find((h) => h.tag === g.rows[0].fromNode);
      const spacingFt = remote ? remote.spacingSmm / 304.8 : 0;
      sprOverride = {
        densityGpmFt2: g.densityGpmFt2,
        designAreaFt2: g.designAreaFt2,
        coverageFt2: remote ? remote.areaFt2 : 0,
        spacingFt,
        sprinklersInArea: g.headsFlowing.length,
        headsPerBranch: g.headsPerBranch,
        branchLines: Math.ceil(g.headsFlowing.length / Math.max(1, g.headsPerBranch)),
        minHeadFlowGpm: g.minHeadFlowGpm,
        remoteHeadPressurePsi: g.remoteHeadPressurePsi,
        sprinklerFlowGpm: g.flowAtSourceGpm,
        pressureAtPumpDischargePsi: g.pressureAtSourcePsi,
        rows: g.rows
      };
    }
  }
  if (standpipeApplicable(inputIn)) {
    const locations = inputIn.standpipeDesign!.locations;
    const q = standpipeFlowGpm(inputIn.standpipeClass, locations.length, inputIn.buildingSprinklered);
    const sprFlow = sprOverride ? sprOverride.sprinklerFlowGpm : calculateSprinklerDemand(inputIn).sprinklerFlowGpm;
    const rated0 = selectRatedCapacity(Math.max(sprFlow + inputIn.insideHoseGpm, q));
    const pumpCLStd = pumpCenterlineAbsM(inputIn, rated0);
    input = { ...inputIn, riser: derivedSprinklerRiser(inputIn, pumpCLStd), standpipeCount: locations.length };
    spHyd = designStandpipeHydraulics(input, pumpCLStd);
    demand = calculateSystemDemand(input, {
      sprinkler: sprOverride,
      standpipe: {
        applicable: true,
        flowGpm: spHyd.demandFlowGpm,
        residualPressurePsi: spHyd.topOutletResidualPsi,
        pressureAtPumpDischargePsi: spHyd.pressureAtPumpDischargePsi,
        durationMin: STANDPIPE_DURATION_MIN
      }
    });
  } else {
    demand = calculateSystemDemand(input, sprOverride ? { sprinkler: sprOverride } : undefined);
  }
  const pumps = selectPumpSet(input, demand);
  const tank = designTank(input, demand, pumps);
  const room = designPumpRoom(input, pumps, tank);
  if (sprDesign && sd) {
    const main = pumps.mainPumps[0];
    applyFirePumpSupply(sprDesign, sd.answers, (flow) => {
      const x = flow / main.ratedFlowGpm;
      return main.ratedNetPressurePsi * (1.2 + 0.066667 * x - 0.266667 * x * x) + pumps.suctionPressureMinPsi;
    });
  }
  const standpipe = spHyd ? analyzeStandpipeOutlets(spHyd, input, pumps) : null;
  const extinguishers = designExtinguishers(input);
  const co2 = inputIn.co2Design ? designCo2System(inputIn.co2Design) : null;
  return {
    input,
    demand,
    pumps,
    tank,
    room,
    standpipe,
    sprinklers: sprDesign,
    co2,
    extinguishers,
    checks: [
      ...pumps.checks,
      ...tank.checks,
      ...room.checks,
      ...room.drainageSump.checks,
      ...(standpipe ? standpipe.checks : []),
      ...(sprDesign ? sprDesign.checks : []),
      ...(co2 ? co2.checks : []),
      ...(extinguishers ? [...extinguishers.zones.flatMap((z) => z.checks), ...extinguishers.checks] : [])
    ],
    standardsReferences: STANDARDS_REFERENCES.map((r) => ({ ...r }))
  };
}
