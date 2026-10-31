/**
 * Fixed-width (Elite-Fire style) hydraulic calculation report for the fire pump / tank design.
 */
import { FireDesignResult, HydraulicNodeRow } from './fpTypes';
import { CODE_NOTE } from './standards/codeReferences';
import { formatPipeSize } from './standards/pipeData';
import { gpmToLpm, psiToBar } from './hydraulics';

const LINE = '='.repeat(132);
const SUB = '-'.repeat(132);

const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const lpad = (s: string, n: number): string => (s.length >= n ? s : ' '.repeat(n - s.length) + s);
const num = (v: number | undefined, d = 1): string => (v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(d));

function section(title: string): string[] {
  return ['', LINE, title.toUpperCase(), LINE];
}

function nodeTable(rows: HydraulicNodeRow[]): string[] {
  const head =
    pad('From', 8) + pad('To', 8) + lpad('K', 6) + lpad('q', 8) + lpad('Q', 9) + lpad('Size', 6) + lpad('ID', 7) + lpad('C', 5) +
    lpad('L', 8) + pad(' Ftg', 10) + lpad('Fteq', 7) + lpad('Ltot', 8) + lpad('Pf/ft', 8) + lpad('Pf', 8) + lpad('Pe', 8) + lpad('Pt', 9);
  const out = [head, SUB];
  for (const r of rows) {
    out.push(
      pad(r.fromNode, 8) + pad(r.toNode, 8) + lpad(num(r.kFactor, 1), 6) + lpad(num(r.flowAddedGpm, 1), 8) + lpad(num(r.totalFlowGpm, 1), 9) +
        lpad(num(r.nominalIn, 2), 6) + lpad(num(r.idIn, 3), 7) + lpad(num(r.c, 0), 5) + lpad(num(r.lengthFt, 1), 8) + pad(' ' + (r.fittingsDesc || '-'), 10) +
        lpad(num(r.fittingsEqFt, 1), 7) + lpad(num(r.totalLengthFt, 1), 8) + lpad(num(r.pfPerFt, 4), 8) + lpad(num(r.pfPsi, 2), 8) +
        lpad(num(r.pePsi, 2), 8) + lpad(num(r.ptStartPsi, 2), 9)
    );
    out.push(pad('', 8) + pad('', 8) + `    ${r.description}  (end Pt ${num(r.ptEndPsi, 2)} psi, v = ${num(r.velocityFps, 1)} fps)`);
  }
  return out;
}

function standpipeSection(result: FireDesignResult): string[] {
  const sp = result.standpipe!;
  const L: string[] = [...section('STANDPIPE SYSTEM (NFPA 14)')];
  L.push(
    `Design basis            : Class ${sp.standpipeClass}, ${sp.systemType}, ${sp.combined ? 'combined with sprinklers' : 'standpipe only'}, ${sp.risers.length} standpipe(s)`,
    `Demand                  : ${num(sp.demandFlowGpm, 0)} gpm, ${num(sp.topOutletResidualPsi, 0)} psi at the topmost outlet of the governing standpipe ${sp.governingRiserTag}`,
    `Pressure at pump        : ${num(sp.pressureAtPumpDischargePsi, 1)} psi (pump centre-line at ${num(sp.pumpCLElevationM, 2)} m)`,
    `Riser / supply main     : ${formatPipeSize(sp.riserSizeIn)} (minimum ${formatPipeSize(sp.minRiserSizeIn)}) / ${formatPipeSize(sp.supplyMainSizeIn)}`,
    `Hose valve height       : ${sp.hoseValveHeightMm} mm above floor`,
    `Building height         : ${num(sp.buildingHeightFt, 1)} ft above fire department access - ${sp.highRise ? 'HIGH-RISE (> 75 ft)' : 'not high-rise'}`,
    '',
    'Standpipe riser table:',
    pad('Tag', 8) + pad('Location', 24) + lpad('Size', 6) + lpad('Outlets', 9) + lpad('Run m', 8) + lpad('Top el m', 10) + lpad('Req. psi', 10) + '  Roof  FCV floors'
  );
  for (const r of sp.risers) {
    L.push(
      pad(r.tag, 8) + pad(r.location, 24) + lpad(`${r.sizeIn}"`, 6) + lpad(String(r.outlets.length), 9) + lpad(num(r.horizontalRunToPumpM, 1), 8) +
        lpad(num(r.topElevationM, 2), 10) + lpad(num(r.requiredPressureAtPumpPsi, 1), 10) + `  ${r.hasRoofOutlet ? 'yes ' : 'no  '}  ${r.floorControlValveFloors.length}`
    );
  }
  L.push('', `Governing node calculation - ${sp.governingRiserTag}`);
  L.push(...nodeTable(sp.rows));
  L.push('', 'Floor-by-floor outlet table (top to bottom):');
  L.push(pad('Standpipe', 11) + pad('Floor', 16) + lpad('Elev m', 9) + lpad('Size', 7) + lpad('Flow gpm', 10) + lpad('Static', 9) + lpad('Resid.', 9) + '  PRV');
  for (const r of sp.risers) {
    for (const o of [...r.outlets].reverse()) {
      L.push(
        pad(o.standpipeTag, 11) + pad(o.floorName, 16) + lpad(num(o.elevationM, 2), 9) + lpad(`${o.sizeIn}"`, 7) + lpad(num(o.flowGpm, 0), 10) +
          lpad(num(o.staticPsi, 1), 9) + lpad(num(o.residualPsi, 1), 9) + `  ${o.prvRequired ? `PRV set ${o.prvSetPsi} psi` : '-'}`
      );
    }
  }
  L.push(
    '',
    `Fire department connection: ${sp.fdc.inlets} x ${sp.fdc.inletSizeIn}" inlets, ${sp.fdc.pipeSizeIn}" pipe, ${sp.fdc.heightAboveGradeMm} mm above grade, ${num(sp.fdc.distanceToHydrantM, 1)} m to hydrant`,
    `Drains: ${sp.drainRiserIn ? `${sp.drainRiserIn}" drain riser at each standpipe with PRVs` : 'no drain riser (no PRVs)'}; ${sp.mainDrainIn}" main drain at the base of each riser`,
    'Standpipe checks:'
  );
  for (const c of sp.checks) L.push(`   [${c.status.toUpperCase()}] ${pad(c.id, 22)} ${c.title} - ${c.detail}`);
  return L;
}

/** Build the full text calculation report (project header, standards, hydraulics, pumps, tank, room, checks). */
export function buildFireCalcReport(result: FireDesignResult): string {
  const { input, demand, pumps, tank, room } = result;
  const L: string[] = [];
  L.push(LINE, 'FIRE PUMP ROOM & WATER TANK - HYDRAULIC CALCULATION REPORT', LINE);
  L.push(`Project   : ${input.projectName}`, `Number    : ${input.projectNumber}`, `Designer  : ${input.designer}`);

  L.push(...section('Standards'));
  for (const r of result.standardsReferences) L.push(`${pad(`${r.code} (${r.edition})`, 18)} ${r.scope}`);

  L.push(...section('Design basis'));
  const hz = demand.sprinkler;
  L.push(
    `Hazard class            : ${input.hazard}`,
    `Density / design area   : ${num(hz.densityGpmFt2, 3)} gpm/ft2 over ${num(hz.designAreaFt2, 0)} ft2`,
    `Sprinkler K / coverage  : K ${input.sprinklerK} / ${num(hz.coverageFt2, 0)} ft2 per head, spacing ${num(hz.spacingFt, 1)} ft`,
    `Sprinklers in area      : ${hz.sprinklersInArea} (${hz.branchLines} branch lines x ${hz.headsPerBranch} heads)`,
    `Standpipe               : Class ${input.standpipeClass} x ${input.standpipeCount}, ${input.buildingSprinklered ? 'sprinklered' : 'unsprinklered'} building`,
    `Pump arrangement        : ${input.arrangement}, ${input.pumpTypePreference} type preference`,
    `Tank                    : ${input.tankMaterial}, ${input.tankPlacement}, ${input.twoCompartments ? '2 compartments' : '1 compartment'}`,
    `Site                    : elevation ${input.siteElevationFt} ft, ambient ${input.ambientTempF} F, ${input.electricalSupply.voltage} V ${input.electricalSupply.phases} ph ${input.electricalSupply.hz} Hz`
  );

  L.push(...section('Hydraulic node calculation - sprinkler'));
  L.push(`Remote head pressure ${num(hz.remoteHeadPressurePsi, 2)} psi, minimum head flow ${num(hz.minHeadFlowGpm, 1)} gpm`);
  L.push(...nodeTable(hz.rows));

  L.push(...section('Standpipe demand'));
  const sp = demand.standpipe;
  if (sp.applicable) {
    L.push(
      `Flow ${num(sp.flowGpm, 0)} gpm, residual ${num(sp.residualPressurePsi, 0)} psi at the hydraulically remote outlet, duration ${sp.durationMin} min`,
      `Pressure required at pump discharge: ${num(sp.pressureAtPumpDischargePsi, 1)} psi (top outlet ${input.standpipeTopOutletHeightFt} ft, friction ${input.standpipeFrictionPsi} psi)`
    );
  } else {
    L.push('Standpipe not applicable.');
  }

  L.push(...section('System demand'));
  L.push(
    `Sprinkler flow          : ${num(hz.sprinklerFlowGpm, 1)} gpm at ${num(hz.pressureAtPumpDischargePsi, 1)} psi (pump discharge)`,
    `Hose allowance          : inside ${demand.hoseAllowanceInsideGpm} gpm, total ${demand.hoseAllowanceTotalGpm} gpm, duration ${demand.durationMin} min`,
    `Governing case          : ${demand.governingCase}`,
    `Pump discharge demand PD: ${num(demand.pumpDemandFlowGpm, 0)} gpm (${num(gpmToLpm(demand.pumpDemandFlowGpm), 0)} L/min) @ ${num(demand.pumpDemandPressurePsi, 1)} psi (${num(psiToBar(demand.pumpDemandPressurePsi), 2)} bar)`,
    `Required storage        : ${num(demand.requiredStorageGal, 0)} gal (${num(tank.requiredEffectiveM3, 1)} m3)`
  );

  L.push(...section('Pump schedule - NFPA 20'));
  for (const p of pumps.mainPumps) {
    L.push(
      `${p.tag} ${p.role.toUpperCase()} ${p.driver} ${p.pumpType}: ${p.ratedFlowGpm} gpm @ ${p.ratedNetPressurePsi} psi (${num(p.ratedHeadFt, 1)} ft), ${p.speedRpm} rpm`,
      `   churn ${num(p.churnPressurePsi, 1)} psi, 150 % point ${num(p.pressureAt150Psi, 1)} psi, max BHP ${num(p.maxBhp, 1)}, driver ${p.driverHp} HP (${num(p.driverKw, 1)} kW)` +
        (p.dieselDeratePercent !== undefined ? `, derate ${num(p.dieselDeratePercent, 1)} %, fuel ${p.fuelTankGal} gal (${p.fuelTankLiters} L)` : ''),
      `   suction ${formatPipeSize(p.sizes.suctionIn)}, discharge ${formatPipeSize(p.sizes.dischargeIn)}, circulation relief ${p.circulationReliefIn === null ? 'n/a' : `${p.circulationReliefIn}"`}`,
      `   controller ${p.controller.tag}: ${p.controller.description}; ${p.controller.startingMethod ?? ''}; ${p.controller.listing}`
    );
    L.push(pad('   %Q', 10) + p.curve.map((c) => lpad(`${c.percentFlow}%`, 9)).join(''));
    L.push(pad('   Q gpm', 10) + p.curve.map((c) => lpad(num(c.flowGpm, 0), 9)).join(''));
    L.push(pad('   P psi', 10) + p.curve.map((c) => lpad(num(c.netPressurePsi, 1), 9)).join(''));
    L.push(pad('   BHP', 10) + p.curve.map((c) => lpad(num(c.bhp, 1), 9)).join(''));
  }
  const rv = pumps.mainReliefValve;
  L.push(
    `Suction: v @150 % = ${num(pumps.suctionVelocityAt150Fps, 2)} fps, pressure @150 % LWL = ${num(pumps.suctionPressureMinPsi, 2)} psi, max static ${num(pumps.maxStaticSuctionPsi, 2)} psi`,
    `Maximum system pressure ${num(pumps.maxSystemPressurePsi, 1)} psi (rating ${input.systemComponentRatingPsi} psi)`,
    `Main relief valve: ${rv.required ? `REQUIRED ${rv.sizeIn}" / ${rv.dischargeIn}" set ${rv.setPressurePsi} psi` : 'not required'} - ${rv.reason}`,
    `Test header ${pumps.testHeaderIn}" with ${pumps.testHeaderHoseValves} x 2.5" hose valves, flow meter ${pumps.flowMeterIn}"`
  );

  L.push(...section('Jockey pump & pressure setpoints'));
  const j = pumps.jockey;
  const s = pumps.setpoints;
  L.push(
    `JP-1: ${j.ratedFlowGpm} gpm @ ${j.ratedNetPressurePsi} psi, ${j.motorHp} HP, ${j.pipeSizeIn}" pipe, controller ${j.controller.tag} (${j.controller.listing})`,
    `Jockey stop ${s.jockeyStopPsi} psi | jockey start ${s.jockeyStartPsi} psi | duty pump start ${s.dutyStartPsi} psi | standby pump start ${s.standbyStartPsi} psi`,
    `Minimum run timers: electric ${s.minRunTimerElectricMin} min, diesel ${s.minRunTimerDieselMin} min`
  );

  L.push(...section('Fire water tank - NFPA 22'));
  L.push(
    `Material ${tank.material}, ${tank.placement}, ${tank.compartments} compartment(s)`,
    `Required ${tank.requiredEffectiveGal} gal (${num(tank.requiredEffectiveM3, 2)} m3), provided ${num(tank.providedEffectiveM3, 2)} m3`,
    `Internal ${num(tank.internalLengthM, 2)} L x ${num(tank.internalWidthM, 2)} W x ${num(tank.totalInternalHeightM, 2)} H m; effective depth ${num(tank.effectiveDepthM, 2)} m, freeboard ${num(tank.freeboardM, 2)} m`,
    `Levels (m above floor): low ${num(tank.levels.lowWaterM, 2)}, effective ${num(tank.levels.effectiveTopM, 2)}, overflow ${num(tank.levels.overflowM, 2)}, top water ${num(tank.levels.topWaterM, 2)}, roof soffit ${num(tank.levels.roofSoffitM, 2)}`,
    `Thickness (mm): wall ${tank.wallThicknessMm}, floor ${tank.floorThicknessMm}, roof ${tank.roofThicknessMm}; refill ${num(tank.refillHours, 2)} h`,
    'Connections:'
  );
  for (const c of tank.connections) L.push(`   ${pad(c.name, 28)} ${c.sizeIn > 0 ? lpad(`${c.sizeIn}"`, 6) : lpad('-', 6)}  ${c.note}`);
  L.push('Material specification:');
  for (const m of tank.materialSpec) L.push(`   - ${m}`);

  L.push(...section('Suction sump pit'));
  const sm = tank.sump;
  L.push(
    `Suction pipe ${sm.suctionPipeIn}" (OD ${num(sm.suctionPipeOdMm, 1)} mm), anti-vortex plate ${sm.vortexPlateMm} x ${sm.vortexPlateMm} mm`,
    `Pit ${sm.pitLengthMm} x ${sm.pitWidthMm} x ${sm.pitDepthMm} mm deep; plate centre ${sm.plateCentreFromWallMm} mm from wall; inlet ${sm.inletAboveSumpFloorMm} mm above pit floor`,
    `Suction CL ${sm.suctionCLBelowTankFloorMm} mm below tank floor; elbow drop ${sm.elbowDropMm} mm`
  );

  L.push(...section('Pump room'));
  const e = room.elevations;
  L.push(
    `Internal size ${room.lengthMm} x ${room.widthMm} mm, clear height ${room.clearHeightMm} mm, fire rating ${room.fireRatingHours} h`,
    `Elevations (m): pad top ${e.padTopM}, pump CL ${e.pumpCLM}, tank floor ${num(e.tankFloorM, 2)}, high-level pipe ${e.highLevelPipeM}, roof soffit ${e.roofSoffitM}`,
    `Discharge header at x = ${room.headerX} mm; system outlet ${room.systemOutlet.sizeIn}" at (${room.systemOutlet.x}, ${room.systemOutlet.y})`,
    `Trench ${room.trench.widthMm} mm @ ${room.trench.slopePercent} %, ${num(room.trench.lengthMm / 1000, 1)} m, depth ${num(room.trench.depthStartMm, 0)}-${num(room.trench.depthEndMm, 0)} mm, capacity ${num(room.trench.capacityGpm, 0)} gpm vs inflow ${num(room.trench.designInflowGpm, 0)} gpm`,
    'Equipment:'
  );
  for (const q of room.equipment) L.push(`   ${pad(q.tag, 8)} ${q.label}  [x ${num(q.rect.x, 0)}, y ${num(q.rect.y, 0)}, ${num(q.rect.w, 0)} x ${num(q.rect.h, 0)}]`);

  if (result.standpipe) L.push(...standpipeSection(result));

  L.push(...section('Design checks'));
  for (const c of result.checks) {
    L.push(`[${c.status === 'pass' ? 'PASS' : c.status === 'warn' ? 'WARN' : 'FAIL'}] ${pad(c.id, 22)} ${c.title}`);
    L.push(`        ${c.reference}`);
    L.push(`        ${c.detail}`);
  }
  const fails = result.checks.filter((c) => c.status === 'fail').length;
  const warns = result.checks.filter((c) => c.status === 'warn').length;
  L.push(SUB, `Summary: ${result.checks.length} checks, ${fails} fail, ${warns} warn`);

  L.push('', CODE_NOTE, '');
  return L.join('\n');
}
