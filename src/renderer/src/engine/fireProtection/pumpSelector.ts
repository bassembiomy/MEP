/**
 * Fire pump set selection (NFPA 20): rated capacity, suction pipe, performance curve,
 * drivers, controllers, jockey pump, pressure setpoints, relief valve and design checks.
 * Pure TypeScript; US customary units internally (gpm, psi, ft, in).
 */
import {
  ControlPanelSpec,
  DesignCheck,
  FireDesignInput,
  FirePumpSelection,
  FirePumpType,
  JockeyPumpSelection,
  PumpCurvePoint,
  PumpDriver,
  PumpSetSelection,
  PumpSizeTableRow,
  ReliefValveSpec,
  SystemDemand
} from './fpTypes';
import { hazenWilliamsPsiPerFt, velocityFps } from './hydraulics';
import { equivalentLengthFt } from './standards/nfpa13';
import {
  DIESEL_ENGINE_HP,
  JOCKEY_FLOWS_GPM,
  MAX_SUCTION_VELOCITY_FPS,
  MIN_RATIO_AT_150,
  MIN_SUCTION_PRESSURE_TANK_PSI,
  NEMA_MOTOR_HP,
  SHUTOFF_MAX_RATIO,
  circulationReliefSizeIn,
  pumpDataFor,
  pumpSpeedRpm,
  ratedEfficiency,
  selectRatedCapacity
} from './standards/nfpa20';
import { internalDiameterIn, nextLargerSize } from './standards/pipeData';

const PSI_PER_M = 1.42197;
const PSI_TO_FT = 2.31;
const KW_PER_HP = 0.7457;

const f1 = (v: number): string => v.toFixed(1);
const f2 = (v: number): string => v.toFixed(2);
const pcText = (pc: FireDesignInput['pumpCounts']): string => (pc ? `${pc.electric} electric / ${pc.diesel} diesel / ${pc.jockey} jockey` : '-');

function smallestAtLeast(list: number[], v: number, what: string): number {
  const r = list.find((x) => x >= v - 1e-9);
  if (r === undefined) throw new Error(`${what}: required ${f1(v)} exceeds the largest standard rating (${list[list.length - 1]})`);
  return r;
}

/** Driver list per arrangement (NFPA 20-2019 §4.9 / Ch. 9 / Ch. 11): duty first, standby second. */
function driversFor(arrangement: FireDesignInput['arrangement']): PumpDriver[] {
  switch (arrangement) {
    case 'electric+diesel':
      return ['electric', 'diesel'];
    case 'electric+electric':
      return ['electric', 'electric'];
    case 'diesel+diesel':
      return ['diesel', 'diesel'];
    case 'electric-only':
      return ['electric'];
    case 'diesel-only':
      return ['diesel'];
  }
}

/** Clamp a custom pump set: electric / diesel 0-3 each, 1-4 main pumps in total, 1-2 jockey pumps (NFPA 20 Ch. 4, 9, 11). */
function clampPumpCounts(
  pc: FireDesignInput['pumpCounts']
): { electric: number; diesel: number; jockey: number; clamped: boolean } | null {
  if (!pc) return null;
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));
  const electric = clamp(pc.electric, 0, 3);
  let diesel = clamp(pc.diesel, 0, 3);
  let e = electric;
  if (e + diesel > 4) diesel = 4 - e;
  if (e + diesel === 0) e = 1;
  const jockey = clamp(pc.jockey, 1, 2);
  return { electric: e, diesel, jockey, clamped: e !== pc.electric || diesel !== pc.diesel || jockey !== pc.jockey };
}

/**
 * Select the fire pump set for a governing demand (NFPA 20-2019 Ch. 4, 9, 10, 11, 12 and Annex A.4.26).
 * Follows plan §3.1 step by step.
 */
export function selectPumpSet(input: FireDesignInput, demand: SystemDemand): PumpSetSelection {
  // 1. Rated capacity and table row (NFPA 20 Table 4.1(a), Table 4.28)
  const rated = selectRatedCapacity(demand.pumpDemandFlowGpm);
  const baseRow = pumpDataFor(rated);

  // 2. Suction size so that v @150 % <= 15 fps (NFPA 20 §4.14.3.1)
  let suctionIn = baseRow.suctionIn;
  while (velocityFps(1.5 * rated, internalDiameterIn(suctionIn, 'sch40')) > MAX_SUCTION_VELOCITY_FPS) {
    suctionIn = nextLargerSize(suctionIn);
  }
  const suctionId = internalDiameterIn(suctionIn, 'sch40');
  const v150 = velocityFps(1.5 * rated, suctionId);
  const row: PumpSizeTableRow = { ...baseRow, suctionIn };

  // 3. Static suction pressure (1 m water = 1.42197 psi)
  const minStatic = input.tankFloorToPumpCLm * PSI_PER_M;
  const maxStatic = (input.tankFloorToPumpCLm + input.tankEffectiveDepthM + 0.2) * PSI_PER_M;

  // 4. Suction friction: 20 ft + gate valve + 90 deg elbow at suction size, Sch 40, C = 120
  const eqFt =
    20 + equivalentLengthFt('gate-valve', suctionIn, 120, 'sch40') + equivalentLengthFt('elbow-90', suctionIn, 120, 'sch40');
  const pf = (q: number): number => hazenWilliamsPsiPerFt(q, suctionId, 120) * eqFt;
  const suctionAt100 = minStatic - pf(rated);
  const suctionAt150 = minStatic - pf(1.5 * rated);

  // 5. Rated net pressure (rounded up to 5 psi)
  const ratedNet = Math.ceil((demand.pumpDemandPressurePsi - suctionAt100) / 5 - 1e-9) * 5;
  const ratedHead = ratedNet * PSI_TO_FT;

  // 6. Performance curve (NFPA 20 §4.26: churn 120 %, 150 % point 70 %)
  const etaR = ratedEfficiency(rated);
  const pAt = (x: number): number => ratedNet * (1.2 + 0.066667 * x - 0.266667 * x * x);
  const bhpAt = (x: number): number => (x > 0 ? (x * rated * (pAt(x) * PSI_TO_FT)) / (3960 * etaR * x * (2 - x)) : 0);
  const bhp100 = bhpAt(1);
  const curve: PumpCurvePoint[] = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5].map((x) => ({
    percentFlow: Math.round(x * 100),
    flowGpm: x * rated,
    netPressurePsi: pAt(x),
    bhp: x > 0 ? bhpAt(x) : 0.45 * bhp100,
    efficiency: etaR * x * (2 - x)
  }));
  const churn = pAt(0);
  const p150 = pAt(1.5);
  const maxBhp = Math.max(...curve.map((c) => c.bhp));

  // 7. Pump type
  const pumpType: FirePumpType =
    input.pumpTypePreference !== 'auto'
      ? input.pumpTypePreference
      : minStatic <= 0
        ? 'vertical-turbine'
        : rated <= 300
          ? 'end-suction'
          : 'horizontal-split-case';

  // 8-10. Drivers and controllers
  const counts = clampPumpCounts(input.pumpCounts);
  const drivers = counts
    ? [...Array<PumpDriver>(counts.electric).fill('electric'), ...Array<PumpDriver>(counts.diesel).fill('diesel')]
    : driversFor(input.arrangement);
  const mainPumps: FirePumpSelection[] = drivers.map((driver, i) => {
    const tag = `FP-${i + 1}`;
    const ctrlTag = `FPC-${i + 1}`;
    let driverHp: number;
    let controller: ControlPanelSpec;
    let dieselDerate: number | undefined;
    let fuelGal: number | undefined;
    let fuelL: number | undefined;
    let circ: number | null = null;
    if (driver === 'electric') {
      driverHp = smallestAtLeast(NEMA_MOTOR_HP, maxBhp, `${tag} motor`);
      const starting = driverHp <= 30 ? 'Full voltage (across-the-line)' : 'Reduced voltage — closed-transition wye-delta';
      controller = {
        tag: ctrlTag,
        kind: 'electric-fire-pump-controller',
        description: `Electric fire pump controller, ${driverHp} HP, ${input.electricalSupply.voltage} V / 3 ph / ${input.electricalSupply.hz} Hz`,
        startingMethod: starting,
        listing: 'UL 218 / FM 1321 — NFPA 20 Ch. 10',
        widthMm: 900,
        depthMm: 450,
        heightMm: 2000,
        mounting: 'floor'
      };
      circ = circulationReliefSizeIn(rated);
    } else {
      dieselDerate =
        3 * Math.max(0, (input.siteElevationFt - 300) / 1000) + 1 * Math.max(0, (input.ambientTempF - 77) / 10);
      const required = maxBhp / (1 - dieselDerate / 100);
      driverHp = smallestAtLeast(DIESEL_ENGINE_HP, required, `${tag} diesel engine`);
      fuelGal = Math.ceil(driverHp * 1.1 - 1e-9);
      fuelL = Math.round(fuelGal * 3.785);
      controller = {
        tag: ctrlTag,
        kind: 'diesel-fire-pump-controller',
        description: `Diesel fire pump controller, ${driverHp} HP engine, 12/24 V DC`,
        startingMethod: 'Dual battery banks, 2 chargers, 6 crank cycles (15 s on / 15 s off)',
        listing: 'UL 218 / FM 1323 — NFPA 20 Ch. 12',
        widthMm: 800,
        depthMm: 400,
        heightMm: 1800,
        mounting: 'floor'
      };
    }
    return {
      tag,
      driver,
      role: i === 0 ? 'duty' : 'standby',
      pumpType,
      ratedFlowGpm: rated,
      ratedNetPressurePsi: ratedNet,
      ratedHeadFt: ratedHead,
      speedRpm: pumpSpeedRpm(rated, input.electricalSupply.hz),
      churnPressurePsi: churn,
      pressureAt150Psi: p150,
      curve,
      maxBhp,
      driverHp,
      driverKw: driverHp * KW_PER_HP,
      dieselDeratePercent: dieselDerate,
      fuelTankGal: fuelGal,
      fuelTankLiters: fuelL,
      sizes: row,
      circulationReliefIn: circ,
      controller
    };
  });

  // 11. Maximum system pressure and main relief valve (NFPA 20 §4.18: 121 % of churn for variable-speed diesel)
  const maxSystem = churn + maxStatic;
  const hasDiesel = drivers.includes('diesel');
  const reliefRequired = hasDiesel && 1.21 * churn + maxStatic > input.systemComponentRatingPsi;
  const mainReliefValve: ReliefValveSpec = {
    required: reliefRequired,
    sizeIn: row.reliefValveIn,
    dischargeIn: row.reliefDischargeIn,
    setPressurePsi: reliefRequired ? input.systemComponentRatingPsi - 5 : 0,
    reason: reliefRequired
      ? `Diesel driver at 121 % of rated speed (NFPA 20 §4.18): 1.21 × ${f1(churn)} + ${f1(maxStatic)} = ${f1(1.21 * churn + maxStatic)} psi exceeds the ${input.systemComponentRatingPsi} psi component rating`
      : hasDiesel
        ? `Not required: 1.21 × ${f1(churn)} + ${f1(maxStatic)} = ${f1(1.21 * churn + maxStatic)} psi does not exceed the ${input.systemComponentRatingPsi} psi component rating (NFPA 20 121 % rule)`
        : 'Not required: electric constant-speed drivers only, maximum pressure is churn plus static suction'
  };

  // 12. Jockey pump and pressure setpoints (NFPA 20 §4.26 / A.4.26, §10.5.2.1 and §12.x)
  const jockeyFlow = smallestAtLeast(JOCKEY_FLOWS_GPM, Math.max(1, 0.01 * rated), 'jockey pump flow');
  const staticFloor = Math.max(0, minStatic);
  const stop = Math.round(churn + staticFloor);
  const start = stop - 10;
  const dutyStart = start - 5;
  const standbyStart = dutyStart - 10;
  const jockeyNet = Math.ceil((stop - staticFloor + 10) / 5 - 1e-9) * 5;
  const jockeyHp = smallestAtLeast(NEMA_MOTOR_HP, (jockeyFlow * jockeyNet * PSI_TO_FT) / (3960 * 0.4), 'jockey motor');
  const nJockeys = counts ? counts.jockey : 1;
  const jockeys: JockeyPumpSelection[] = Array.from({ length: nJockeys }, (_, i) => ({
    tag: `JP-${i + 1}`,
    ratedFlowGpm: jockeyFlow,
    ratedNetPressurePsi: jockeyNet,
    motorHp: jockeyHp,
    pipeSizeIn: jockeyFlow <= 10 ? 1 : jockeyFlow <= 25 ? 1.5 : 2,
    controller: {
      tag: `JPC-${i + 1}`,
      kind: 'jockey-pump-controller',
      description: `Jockey pump controller, ${jockeyHp} HP, pressure-switch operated`,
      listing: 'UL 508A',
      widthMm: 500,
      depthMm: 250,
      heightMm: 700,
      mounting: 'wall'
    }
  }));
  const jockey = jockeys[0];

  // 14. Checks
  const checks: DesignCheck[] = [];
  const horizontal = pumpType !== 'vertical-turbine';
  checks.push({
    id: 'suction-velocity',
    title: 'Suction pipe velocity at 150 % of rated flow',
    reference: 'NFPA 20-2019 §4.14.3.1',
    status: v150 <= MAX_SUCTION_VELOCITY_FPS ? 'pass' : 'fail',
    detail: `${suctionIn}" Sch 40 suction (ID ${suctionId.toFixed(3)} in) at ${f1(1.5 * rated)} gpm = ${f2(v150)} fps (limit ${MAX_SUCTION_VELOCITY_FPS} fps)`
  });
  checks.push({
    id: 'suction-pressure',
    title: 'Suction pressure at 150 % flow, tank at low water level',
    reference: 'NFPA 20-2019 §4.14.2 / §7.1',
    status: suctionAt150 >= MIN_SUCTION_PRESSURE_TANK_PSI ? 'pass' : 'fail',
    detail: `Min static ${f2(minStatic)} psi − friction ${f2(minStatic - suctionAt150)} psi (${f1(eqFt)} ft equivalent) = ${f2(suctionAt150)} psi (min ${MIN_SUCTION_PRESSURE_TANK_PSI} psi)`
  });
  checks.push({
    id: 'flooded-suction',
    title: 'Flooded suction for horizontal / end-suction pumps',
    reference: 'NFPA 20-2019 §4.14.1 / §7.1 (suction lift only with vertical turbine pumps)',
    status: horizontal && minStatic <= 0 ? 'fail' : 'pass',
    detail: horizontal
      ? `${pumpType} pump, tank floor ${f2(input.tankFloorToPumpCLm)} m relative to pump CL: minimum static ${f2(minStatic)} psi ${minStatic > 0 ? '(positive head, flooded)' : '(suction lift - not permitted)'}`
      : `Vertical turbine pump takes suction from the tank (static ${f2(minStatic)} psi at low water level)`
  });
  checks.push({
    id: 'shutoff-ratio',
    title: 'Shutoff (churn) pressure not above 140 % of rated',
    reference: 'NFPA 20-2019 §4.26.2 (performance curves)',
    status: churn <= SHUTOFF_MAX_RATIO * ratedNet + 1e-9 ? 'pass' : 'fail',
    detail: `Churn ${f1(churn)} psi = ${f1((churn / ratedNet) * 100)} % of rated ${ratedNet} psi (limit ${SHUTOFF_MAX_RATIO * 100} %)`
  });
  checks.push({
    id: 'ratio-150',
    title: 'Net pressure at 150 % flow not below 65 % of rated',
    reference: 'NFPA 20-2019 §4.26.3 (performance curves)',
    status: p150 >= MIN_RATIO_AT_150 * ratedNet - 1e-9 ? 'pass' : 'fail',
    detail: `${f1(p150)} psi at ${f1(1.5 * rated)} gpm = ${f1((p150 / ratedNet) * 100)} % of rated ${ratedNet} psi (min ${MIN_RATIO_AT_150 * 100} %)`
  });
  const netAtDemand = ratedNet + suctionAt100;
  checks.push({
    id: 'rated-vs-demand',
    title: 'Rated flow and pressure cover the system demand',
    reference: 'NFPA 20-2019 §4.1 / Table 4.1(a); NFPA 13-2019 §19.3.3',
    status: rated >= demand.pumpDemandFlowGpm && netAtDemand >= demand.pumpDemandPressurePsi - 1e-9 ? 'pass' : 'fail',
    detail: `Rated ${rated} gpm vs demand ${f1(demand.pumpDemandFlowGpm)} gpm; ${ratedNet} + suction ${f2(suctionAt100)} = ${f2(netAtDemand)} psi vs demand ${f1(demand.pumpDemandPressurePsi)} psi at pump discharge (PD)`
  });
  const sprinklerQ = input.sprinklerK * Math.sqrt(7);
  checks.push({
    id: 'jockey-vs-sprinkler',
    title: 'Jockey pump flow below one open sprinkler',
    reference: 'NFPA 20-2019 Annex A.4.26 / §10.5.2.1',
    status: jockeyFlow < sprinklerQ ? 'pass' : 'warn',
    detail: `Jockey ${jockeyFlow} gpm vs one K ${input.sprinklerK} sprinkler at 7 psi = ${f1(sprinklerQ)} gpm; the jockey pump must not mask a sprinkler operation`
  });
  const overRating = maxSystem > input.systemComponentRatingPsi;
  checks.push({
    id: 'components-rating',
    title: 'System components rated for maximum pump pressure',
    reference: 'NFPA 20-2019 §4.4 (maximum total discharge head); NFPA 13-2019 §6.1',
    status: overRating ? (hasDiesel ? 'warn' : 'fail') : 'pass',
    detail: `Churn ${f1(churn)} + max static suction ${f1(maxStatic)} = ${f1(maxSystem)} psi vs component rating ${input.systemComponentRatingPsi} psi`
  });
  checks.push({
    id: 'relief-valve',
    title: 'Main pressure relief valve for diesel overspeed',
    reference: 'NFPA 20-2019 §4.18 (pressure relief valves)',
    status: 'pass',
    detail: reliefRequired
      ? `Required: ${row.reliefValveIn}" relief valve, ${row.reliefDischargeIn}" discharge, set ${mainReliefValve.setPressurePsi} psi`
      : mainReliefValve.reason
  });

  if (counts) {
    const nE = mainPumps.filter((p) => p.driver === 'electric').length;
    const nD = mainPumps.length - nE;
    checks.push({
      id: 'pump-count',
      title: 'Pump set configuration (duty, standby and jockey pumps)',
      reference: 'NFPA 20-2019 Ch. 6, 9, 11 (electric / diesel pumps); §4.26 / A.4.26 (pressure maintenance pumps)',
      status: counts.clamped ? 'warn' : 'pass',
      detail: `${nE} electric + ${nD} diesel main pump(s) (${mainPumps.map((p) => `${p.tag} ${p.driver} ${p.role}`).join(', ')}) and ${nJockeys} jockey pump(s) (${jockeys.map((j) => j.tag).join(', ')}) each with its own controller; ${nD} diesel fuel tank(s), one per engine (NFPA 20 §11.4.1)${counts.clamped ? `; requested counts ${pcText(input.pumpCounts)} were limited to 0-3 per driver type, 1-4 main pumps and 1-2 jockey pumps` : ''}`
    });
  }

  return {
    mainPumps,
    jockey,
    jockeys,
    setpoints: {
      jockeyStopPsi: stop,
      jockeyStartPsi: start,
      dutyStartPsi: dutyStart,
      standbyStartPsi: standbyStart,
      minRunTimerElectricMin: 10,
      minRunTimerDieselMin: 30
    },
    mainReliefValve,
    suctionPressureMinPsi: suctionAt150,
    maxStaticSuctionPsi: maxStatic,
    suctionVelocityAt150Fps: v150,
    maxSystemPressurePsi: maxSystem,
    testHeaderIn: row.hoseHeaderSupplyIn,
    testHeaderHoseValves: row.hoseValves,
    flowMeterIn: row.meterDeviceIn,
    checks
  };
}
