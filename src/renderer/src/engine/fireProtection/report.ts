/**
 * Fixed-width (Elite-Fire style) hydraulic calculation report for the fire pump / tank design.
 */
import { ExtinguisherAgent, FireDesignResult, HydraulicNodeRow } from './fpTypes';
import {
  FE_DEEP_B_PER_FT2,
  FE_DEEP_MAX_SURFACE_FT2,
  FE_HAZARD,
  FE_HEAVY_LB,
  FE_HEAVY_MOUNT_TOP_MAX_MM,
  FE_LIGHT_MOUNT_TOP_MAX_MM,
  FE_MAX_AREA_PER_UNIT_FT2,
  FE_MIN_BOTTOM_CLEARANCE_MM,
  FE_TRAVEL_A_FT,
  FE_TRAVEL_D_FT,
  FE_TRAVEL_K_FT
} from './standards/nfpa10';
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

const AGENT_LABEL: Record<ExtinguisherAgent, string> = {
  'dry-chemical-abc': 'dry chemical ABC',
  co2: 'carbon dioxide',
  water: 'water',
  afff: 'AFFF foam',
  'clean-agent': 'clean agent',
  'wet-chemical': 'wet chemical',
  'dry-powder-d': 'dry powder Class D'
};

function extinguisherZoneLines(result: FireDesignResult): string[] {
  const fe = result.extinguishers!;
  const L: string[] = [];
  const zin = new Map((result.input.extinguishers?.zones ?? []).map((z) => [z.id, z]));
  for (const z of fe.zones) {
    const zi = zin.get(z.zoneId);
    const cls = zi
      ? [zi.classA ? 'A' : '', zi.classB !== 'none' ? `B (${zi.classB})` : '', zi.classC ? `C${zi.sensitiveElectronics ? ' (sensitive electronics)' : ''}` : '', zi.classD ? `D (${zi.dMetal || 'metal'})` : '', zi.fryers > 0 ? `K (${zi.fryers} fryers, max ${zi.maxFryerOilLb} lb)` : ''].filter(Boolean).join(', ')
      : '-';
    L.push(
      '',
      `Zone ${z.zoneId} - ${z.zoneName} (floor ${z.floorId}, ${FE_HAZARD[z.hazard].label})`,
      `   Size / area            : ${num(z.lengthFt, 1)} x ${num(z.widthFt, 1)} ft = ${Math.round(z.areaFt2)} ft2; classes ${cls || '-'}`
    );
    if (z.minARating !== null) {
      L.push(`   Class A requirement    : min ${z.minARating}-A single rating, ${z.areaPerAFt2} ft2 per A, max ${z.maxAreaPerUnitFt2 === null ? '-' : Math.round(z.maxAreaPerUnitFt2)} ft2 per unit (cap ${FE_MAX_AREA_PER_UNIT_FT2} ft2)`);
    }
    if (z.bRequirement) L.push(`   Class B requirement    : ${z.bRequirement}`);
    if (z.selectedUnitId) {
      L.push(
        `   Candidates (units)     : ${z.candidates.map((c) => `${c.unitId} x${c.count}`).join(', ')}`,
        `   Selected               : ${z.count} x ${z.selectedUnitId}, grid ${z.grid.nx} x ${z.grid.ny}, allowed travel ${z.maxTravelFt} ft, actual travel ${num(z.maxTravelActualFt, 1)} ft`
      );
    } else if (z.candidates.length === 0 && zi && (zi.classA || zi.classB !== 'none' || zi.classC)) {
      L.push('   Selected               : none - no catalog unit satisfies the requirements');
    }
    if (z.kUnits > 0) L.push(`   Class K                : ${z.kUnits} x WETCHEM-6L within ${FE_TRAVEL_K_FT} ft of the cooking appliances`);
    if (z.dUnits > 0) L.push(`   Class D                : ${z.dUnits} x CLASSD-30 within ${FE_TRAVEL_D_FT} ft; size agent per manufacturer for the metal`);
    for (const n of z.notes) L.push(`   Note: ${n}`);
  }
  return L;
}

function extinguisherSection(result: FireDesignResult): string[] {
  const fe = result.extinguishers!;
  const L: string[] = [...section('PORTABLE FIRE EXTINGUISHERS (NFPA 10)')];
  L.push(
    `Design basis            : NFPA 10-2022, IFC §906; ${fe.zones.length} zones on ${fe.floorsCovered.length} floors`,
    `Total extinguishers     : ${fe.totalCount} (${fe.totals.map((t) => `${t.qty} x ${t.unitId} ${t.ratingText}`).join(', ')})`
  );
  L.push(...extinguisherZoneLines(result));
  L.push('', 'Extinguisher schedule:', pad('Tag', 12) + pad('Zone', 8) + pad('Unit', 18) + pad('Purpose', 10) + pad('Mounting', 10) + lpad('Top mm', 8) + lpad('Bottom mm', 11));
  for (const z of fe.zones) {
    for (const e of z.extinguishers) {
      L.push(pad(e.tag, 12) + pad(e.zoneId, 8) + pad(e.unitId, 18) + pad(e.purpose, 10) + pad(e.mounting, 10) + lpad(String(e.mountingTopMm), 8) + lpad(String(e.bottomClearanceMm), 11));
    }
  }
  return L;
}

/** Standalone portable fire extinguisher design report (NFPA 10-2022). */
export function buildExtinguisherReport(result: FireDesignResult): string {
  const { input } = result;
  const fe = result.extinguishers;
  const L: string[] = [];
  L.push(LINE, 'PORTABLE FIRE EXTINGUISHERS (NFPA 10-2022) - DESIGN REPORT', LINE);
  L.push(`Project   : ${input.projectName}`, `Number    : ${input.projectNumber}`, `Designer  : ${input.designer}`);
  if (!fe) {
    L.push('', 'No portable fire extinguisher data in the project input.', '', CODE_NOTE, '');
    return L.join('\n');
  }

  L.push(...section('Standards and design basis'));
  L.push(
    'NFPA 10-2022 Standard for Portable Fire Extinguishers (selection Ch. 5, distribution Ch. 6, inspection and maintenance Ch. 7-8)',
    'IFC §906 Portable Fire Extinguishers',
    `Zones: ${fe.zones.length}; floors covered: ${fe.floorsCovered.join(', ')}; total extinguishers: ${fe.totalCount}`,
    'Travel model: direct distance from any point of the zone to the nearest unit (half the diagonal of a uniform grid cell).',
    'Verify actual walking travel distance on the architectural plan.'
  );

  L.push(...section('Hazard rules'));
  L.push(pad('Hazard', 30) + lpad('Min A', 7) + lpad('ft2 per A', 11) + lpad('B @ 30 ft', 11) + lpad('B @ 50 ft', 11) + lpad('Max ft2/unit', 14) + lpad('Travel A ft', 13));
  for (const h of ['light', 'ordinary', 'extra'] as const) {
    const r = FE_HAZARD[h];
    L.push(pad(r.label, 30) + lpad(`${r.minA}-A`, 7) + lpad(String(r.areaPerAFt2), 11) + lpad(`${r.bShort}-B`, 11) + lpad(`${r.bLong}-B`, 11) + lpad(String(FE_MAX_AREA_PER_UNIT_FT2), 14) + lpad(String(FE_TRAVEL_A_FT), 13));
  }
  L.push(
    `Max floor area per extinguisher ${FE_MAX_AREA_PER_UNIT_FT2} ft2 (Table 6.2.1.1). Class B appreciable depth (§6.3.2): ${FE_DEEP_B_PER_FT2}-B per ft2 of surface, travel 50 ft, fixed system when surface > ${FE_DEEP_MAX_SURFACE_FT2} ft2.`,
    `Class K (§6.6): travel ${FE_TRAVEL_K_FT} ft, 1 unit per 4 fryers. Class D (§6.5): travel ${FE_TRAVEL_D_FT} ft. Class C (§6.4): non-conductive agent.`
  );

  L.push(...section('Extinguisher types used (catalog)'));
  L.push(pad('Id', 18) + pad('Rating', 14) + pad('Agent', 20) + pad('Capacity', 18) + lpad('Gross lb', 9) + lpad('Hydro yr', 10) + lpad('Internal yr', 12));
  for (const t of fe.totals) {
    const u = fe.catalog.find((c) => c.id === t.unitId)!;
    L.push(pad(u.id, 18) + pad(u.ratingText, 14) + pad(AGENT_LABEL[u.agent], 20) + pad(u.capacity, 18) + lpad(String(u.grossWeightLb), 9) + lpad(String(u.hydroTestYears), 10) + lpad(u.internalExamYears === null ? '-' : String(u.internalExamYears), 12));
  }
  L.push('Ratings are typical listed values (UL 711) - verify with the selected manufacturer.');

  L.push(...section('Zone calculations'));
  L.push(...extinguisherZoneLines(result));

  L.push(...section('Extinguisher schedule'));
  L.push(pad('Tag', 12) + pad('Floor', 7) + pad('Zone', 24) + pad('Unit', 18) + pad('Rating', 14) + pad('Mounting', 10) + lpad('Top mm', 8) + lpad('Bottom mm', 11) + lpad('x m', 8) + lpad('y m', 8));
  for (const z of fe.zones) {
    for (const e of z.extinguishers) {
      const u = fe.catalog.find((c) => c.id === e.unitId)!;
      L.push(pad(e.tag, 12) + pad(e.floorId, 7) + pad(z.zoneName.slice(0, 22), 24) + pad(e.unitId, 18) + pad(u.ratingText, 14) + pad(e.mounting === 'cabinet' ? 'cabinet' : e.mounting, 10) + lpad(String(e.mountingTopMm), 8) + lpad(String(e.bottomClearanceMm), 11) + lpad(num(e.xM, 1), 8) + lpad(num(e.yM, 1), 8));
    }
  }

  L.push(...section('Totals'));
  for (const t of fe.totals) L.push(`${lpad(String(t.qty), 4)} x ${pad(t.unitId, 18)} ${t.label} (${t.ratingText})`);
  L.push(`Total: ${fe.totalCount} extinguishers`);

  L.push(...section('Inspection, maintenance and hydrostatic test schedule'));
  L.push(
    'Monthly inspection (NFPA 10 §7.2): location, access, pressure gauge, seals, condition.',
    'Annual maintenance (NFPA 10 §7.3): thorough examination by a certified person, tag/record.',
    'Stored-pressure dry chemical: internal examination every 6 years (§7.3.3).',
    'Hydrostatic test (Table 8.3.1):'
  );
  for (const t of fe.totals) {
    const u = fe.catalog.find((c) => c.id === t.unitId)!;
    L.push(`   ${pad(u.id, 18)} every ${u.hydroTestYears} years${u.internalExamYears ? `; internal exam every ${u.internalExamYears} years` : ''}`);
  }

  L.push(...section('Installation specification'));
  [
    'Extinguishers shall be listed and labelled (UL 711) and sized per NFPA 10-2022 Tables 6.2.1.1 and 6.3.1.1.',
    'Locate units conspicuously along normal paths of travel, including exits, unobstructed (§6.1.3).',
    `Mount units with gross weight up to ${FE_HEAVY_LB} lb with the top at most ${FE_LIGHT_MOUNT_TOP_MAX_MM} mm above the floor (design 1200 mm).`,
    `Mount units over ${FE_HEAVY_LB} lb with the top at most ${FE_HEAVY_MOUNT_TOP_MAX_MM} mm above the floor (design 1000 mm).`,
    `Keep at least ${FE_MIN_BOTTOM_CLEARANCE_MM} mm clearance between the bottom of the extinguisher and the floor; wheeled units stand on the floor.`,
    'Provide signage where extinguishers are not visible (§6.1.3.3); cabinets shall not be locked.',
    'Class K units are installed within 30 ft of cooking appliances; Class D units within 75 ft of the metal hazard.',
    'Use CO2 or clean agent (not dry chemical) for delicate electronics (§5.5.4).',
    'Install at least one extinguisher on every occupied floor (IFC §906.1).',
    'Verify actual walking travel distance on the architectural plan and adjust positions to the nearest wall or column.',
    'Tag each unit with its identification (FE-floor-nn) and record inspections.',
    'Wall brackets shall be rated for the gross weight of the extinguisher and fixed to structure.'
  ].forEach((t, i) => L.push(`${lpad(String(i + 1), 3)}. ${t}`));

  L.push(...section('Design checks'));
  const checks = [...fe.zones.flatMap((z) => z.checks), ...fe.checks];
  for (const c of checks) {
    L.push(`[${c.status.toUpperCase()}] ${pad(c.id, 22)} ${c.title}`, `        ${c.reference}`, `        ${c.detail}`);
  }
  L.push('', CODE_NOTE, '');
  return L.join('\n');
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
  const s = pumps.setpoints;
  for (const j of pumps.jockeys) {
    L.push(`${j.tag}: ${j.ratedFlowGpm} gpm @ ${j.ratedNetPressurePsi} psi, ${j.motorHp} HP, ${j.pipeSizeIn}" pipe, controller ${j.controller.tag} (${j.controller.listing})`);
  }
  L.push(
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

  L.push(...section('Tank access - NFPA 22'));
  L.push(`${tank.access.kind === 'top' ? 'Roof manholes with internal ladder' : 'Bolted side manways (no ladder)'}: ${tank.access.note}`);
  for (const o of tank.access.openings) L.push(`   Compartment ${o.compartment}: ${o.label}  [x ${o.x} mm, y ${o.y} mm, D${o.sizeMm}]`);

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

  L.push(...section('Wall penetrations - puddle flanges and sleeves'));
  L.push(pad('Tag', 8) + pad('Service', 11) + lpad('Size', 7) + pad('  Wall', 8) + lpad('x mm', 8) + lpad('y mm', 8) + lpad('El. m', 7) + '  Detail');
  for (const q of room.penetrations) {
    L.push(pad(q.tag, 8) + pad(q.service, 11) + lpad(`${q.sizeIn}"`, 7) + pad(`  ${q.wall}`, 8) + lpad(num(q.x, 0), 8) + lpad(num(q.y, 0), 8) + lpad(num(q.elevationM, 2), 7) + `  ${q.note}`);
  }

  L.push(...section('Pressure sensing lines - NFPA 20 / drains'));
  for (const sl of room.sensingLines) {
    L.push(
      `${pad(sl.pumpTag, 6)} -> ${pad(sl.controllerTag, 7)} ${sl.sizeIn}" ${sl.material}, length ${num(sl.lengthMm, 0)} mm, check valves (3/32" orifice) at ` +
        `${sl.checkValves.map((c) => `(${c.x}, ${c.y})`).join(' and ')}, ${sl.checkValveSpacingMm} mm apart`
    );
  }
  L.push(`Pump drains: ${room.pipes.filter((p) => p.service === 'drain' && p.id !== 'DRN-1').map((p) => p.id.replace('DRN-', '')).join(', ')} - casing drain, packing-gland drip and circulation relief to the floor trench (NFPA 20 4.12, IPC 802)`);

  L.push(...section('Drainage sump - IPC 712'));
  const ds = room.drainageSump;
  L.push(
    `${ds.tag}: pit ${ds.rect.w} x ${ds.rect.h} x ${ds.pitDepthMm} mm deep at (${num(ds.rect.x, 0)}, ${num(ds.rect.y, 0)}); ${ds.required ? 'PUMPED (floor below grade)' : 'GRAVITY drain (floor at grade)'}; inflow ${num(ds.inflowGpm, 0)} gpm`
  );
  for (const p of ds.pumps) L.push(`   ${p.tag}: ${p.type}, ${p.flowGpm} gpm @ ${p.headFt} ft, ${p.motorHp} HP`);
  L.push(
    `Discharge ${ds.dischargeSizeIn}" to ${ds.dischargeTo}`,
    `Float levels above pit floor: off ${ds.levels.offMm}, lead ${ds.levels.leadOnMm}, lag ${ds.levels.lagOnMm}, alarm ${ds.levels.alarmMm} mm; working volume ${num(ds.workingVolumeGal, 1)} gal, cycle ${num(ds.cycleMinutes, 2)} min`
  );
  for (const c of ds.controls) L.push(`   - ${c}`);

  if (result.standpipe) L.push(...standpipeSection(result));
  if (result.extinguishers) L.push(...extinguisherSection(result));

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
