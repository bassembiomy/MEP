/**
 * FP-105 — Schedules and hydraulic calculations: design basis, node-to-node hydraulic table, pump / jockey /
 * setpoint schedules, valve schedule, tank & sump schedule, pump room data, compliance checks, standards
 * references and general notes. Tables are packed in shelves so that none leaves the drawing area.
 */
import { formatPipeSize } from '../standards/pipeData';
import { CODE_NOTE, PLUMBING_REQUIREMENTS } from '../standards/codeReferences';
import { HAZARD_DESIGN } from '../standards/nfpa13';
import { type Ctx, autoCols, drawNotes, drawTable, measureTable, notesHeight, tableMinX, wrapText } from './sheetKit';
import { valveKindName } from './sheetPlan';

const f = (v: number, d = 1): string => v.toFixed(d);

/** General notes (NFPA 20 / 22 / 13 / 14 / 24 / 25, NFPA 70 Art. 695, IBC 913, IPC 608 / 802, UPC 603 / 801). */
export function generalNotes(c: Ctx): string[] {
  const { r } = c;
  const diesel = r.pumps.mainPumps.some((p) => p.driver === 'diesel');
  return [
    'All equipment, piping and installation to comply with NFPA 20 (stationary fire pumps), NFPA 22 (private fire water tanks), NFPA 13 (sprinkler systems), NFPA 14 (standpipes), NFPA 24 (private fire service mains) and NFPA 25 (inspection, testing and maintenance), as adopted by the Authority Having Jurisdiction (AHJ).',
    'Fire pumps, drivers, controllers and jockey pump to be UL-listed / FM-approved for fire service and supplied as a factory-tested unit with certified performance curve (NFPA 20 Ch. 4 and 14). Field acceptance test at 0 %, 100 % and 150 % of rated flow through the test header and flow meter.',
    'Suction: OS&Y gate valve supervised in the open position, eccentric reducer installed flat side up, straight pipe of at least 10 pipe diameters upstream of the pump, velocity not above 15 ft/s at 150 % flow. No butterfly valve on the suction (NFPA 20 4.14).',
    'Suction pipe turns down in the sump pit over an anti-vortex plate; pit, plate, inlet clearance and low water level as shown on FP-102 and FP-103 (NFPA 22 / NFPA 20 4.14.3). Wall sleeve with puddle flange at the tank / pump room common wall.',
    'Discharge: check valve and supervised isolation valve per pump, header, pressure relief valve where required (diesel overspeed), flow meter on the test line, test header with 2-1/2 in hose valves to the exterior (NFPA 20 4.18, 4.20, 4.21; NFPA 25 for annual flow test).',
    'Pressure sensing line for each controller: two check valves in series with a 3/32 in orifice between them, separate from the other controllers (NFPA 20 10.5.2.1). Jockey pump starts above the fire pump setpoints; fire pumps stop manually (NFPA 20 10.5).',
    'Electrical: fire pump power supply, transfer means and controller wiring in accordance with NFPA 70 Art. 695 and NFPA 20 Ch. 9 and 10; working space of not less than 1000 mm in front of all controllers (NFPA 70 110.26). Supply: ' + `${r.input.electricalSupply.voltage} V, 3 phase, ${r.input.electricalSupply.hz} Hz.`,
    diesel ? 'Diesel engine: fuel tank sized for 1 gal/hp (5 L/kW) + 5 % (NFPA 20 11.4), bund of 110 % capacity, exhaust piped to atmosphere with silencer, combustion/ventilation air via louvres (NFPA 20 11.3); engine room heated to 21 C minimum.' : 'Pump room heated to not less than 4.4 C; ventilation and lighting per NFPA 20 4.12.',
    `Pump room: fire barriers of ${r.room.fireRatingHours} h (IBC 913.2.1), direct access from the exterior, floor sloped to the trench, grating and drain pit; heating, lighting and emergency lighting per NFPA 20 4.12.`,
    'Valves controlling water supply to the pumps and system to be supervised in the open position by tamper switches connected to the fire alarm system (IBC 913.4, NFPA 72).',
    'Tank fill connection with float valve and air gap of at least 2 x the opening diameter above the overflow rim (IPC 608.15 / UPC 603.3); overflow, drain and relief / drip drains discharge through an indirect waste with air gap (IPC 802 / UPC 801).',
    'Underground piping: coated, restrained and flushed before connection (NFPA 24); all piping hydrostatically tested at 200 psi (or 50 psi above the maximum working pressure) for 2 hours, no leakage; pipe supports per NFPA 13 Ch. 9.',
    'Dimensions in mm unless stated; levels in metres relative to pump room finished floor level (FFL = +/-0.000). Contractor to verify all dimensions on site and coordinate sleeves, penetrations and structural openings before fabrication.',
    CODE_NOTE
  ];
}

export function drawScheduleSheet(c: Ctx): void {
  const { r } = c;
  const d = r.demand;
  const hz = HAZARD_DESIGN[r.input.hazard];
  const th = 2.8;
  type Tbl = { title: string; cols: number[]; rows: string[][]; th: number; align?: boolean[] };
  const mk = (title: string, rows: string[][], t = th, min: number[] = [], align?: boolean[]): Tbl => ({ title, rows, th: t, cols: autoCols(rows, t, min), align });

  // ───────── hydraulic node table ─────────
  const hyd: string[][] = [['FROM', 'TO', 'DESCRIPTION', 'K', 'q gpm', 'Q gpm', 'SIZE', 'ID in', 'C', 'L ft', 'FITTINGS', 'Feq ft', 'Ltot ft', 'Pf/ft', 'Pf psi', 'Pe psi', 'Pt start', 'Pt end', 'v fps']];
  for (const row of d.sprinkler.rows) {
    hyd.push([row.fromNode, row.toNode, row.description, row.kFactor ? f(row.kFactor) : '-', f(row.flowAddedGpm), f(row.totalFlowGpm), formatPipeSize(row.nominalIn), f(row.idIn, 3), String(row.c), f(row.lengthFt), row.fittingsDesc || '-', f(row.fittingsEqFt, 0), f(row.totalLengthFt), f(row.pfPerFt, 4), f(row.pfPsi, 2), f(row.pePsi, 2), f(row.ptStartPsi, 2), f(row.ptEndPsi, 2), f(row.velocityFps)]);
  }
  const tHyd = mk('HYDRAULIC CALCULATION - NODE TO NODE (NFPA 13, HAZEN-WILLIAMS)', hyd, 2.4, [], hyd[0].map((_, i) => i >= 3 && i !== 6 && i !== 10));

  // ───────── design basis ─────────
  const basis: string[][] = [['PARAMETER', 'VALUE']];
  basis.push(['Hazard classification', hz.label.toUpperCase()]);
  basis.push(['Density / design area', `${f(d.sprinkler.densityGpmFt2, 2)} gpm/ft2 / ${f(d.sprinkler.designAreaFt2, 0)} ft2`]);
  basis.push(['Sprinkler K / coverage', `K ${f(r.input.sprinklerK)} / ${f(d.sprinkler.coverageFt2, 0)} ft2 per head`]);
  basis.push(['Remote head pressure', `${f(d.sprinkler.remoteHeadPressurePsi)} psi (min 7 psi)`]);
  basis.push(['Sprinkler flow', `${f(d.sprinkler.sprinklerFlowGpm, 0)} gpm @ ${f(d.sprinkler.pressureAtPumpDischargePsi)} psi`]);
  basis.push(['Hose allowance (inside / total)', `${f(d.hoseAllowanceInsideGpm, 0)} / ${f(d.hoseAllowanceTotalGpm, 0)} gpm`]);
  basis.push(['Standpipe (NFPA 14)', d.standpipe.applicable ? `CLASS ${r.input.standpipeClass}: ${f(d.standpipe.flowGpm, 0)} gpm @ ${f(d.standpipe.pressureAtPumpDischargePsi)} psi` : 'NOT APPLICABLE']);
  basis.push(['Governing demand', `${d.governingCase.toUpperCase()}: ${f(d.pumpDemandFlowGpm, 0)} gpm @ ${f(d.pumpDemandPressurePsi)} psi`]);
  basis.push(['Duration', `${f(d.durationMin, 0)} min`]);
  basis.push(['Required storage', `${f(d.requiredStorageGal, 0)} gal = ${f(r.tank.requiredEffectiveM3)} m3`]);
  const tBasis = mk('DESIGN BASIS', basis, th, [50, 70]);

  // ───────── pump schedule ─────────
  const ps: string[][] = [['TAG', 'DRIVER', 'ROLE', 'TYPE', 'RATED', 'NET PSI', 'CHURN', '150 %', 'HP / kW', 'RPM', 'CONTROLLER', 'SUCT / DISCH']];
  for (const p of r.pumps.mainPumps) {
    ps.push([p.tag, p.driver === 'diesel' ? 'DIESEL' : 'ELECTRIC', p.role.toUpperCase(), p.pumpType.replace(/-/g, ' ').toUpperCase(), `${p.ratedFlowGpm} GPM`, String(p.ratedNetPressurePsi), `${f(p.churnPressurePsi, 0)} PSI`, `${f(p.pressureAt150Psi, 0)} PSI`, `${p.driverHp} / ${f(p.driverKw, 0)}`, String(p.speedRpm), p.controller.tag, `${formatPipeSize(p.sizes.suctionIn)} / ${formatPipeSize(p.sizes.dischargeIn)}`]);
  }
  const j = r.pumps.jockey;
  ps.push([j.tag, 'ELECTRIC', 'JOCKEY', 'MULTISTAGE', `${j.ratedFlowGpm} GPM`, String(j.ratedNetPressurePsi), '-', '-', `${j.motorHp} HP`, '-', j.controller.tag, formatPipeSize(j.pipeSizeIn)]);
  const tPump = mk('PUMP SCHEDULE (NFPA 20)', ps, th);

  // ───────── setpoints ─────────
  const sp = r.pumps.setpoints;
  const spRows: string[][] = [['DEVICE', 'FUNCTION', 'SETPOINT'], [j.controller.tag, 'JOCKEY STOP', `${sp.jockeyStopPsi} PSI`], [j.controller.tag, 'JOCKEY START', `${sp.jockeyStartPsi} PSI`]];
  r.pumps.mainPumps.forEach((p, i) => spRows.push([p.controller.tag, i === 0 ? 'DUTY START' : 'STANDBY START', `${i === 0 ? sp.dutyStartPsi : sp.standbyStartPsi} PSI`]));
  spRows.push(['TIMER', 'MIN RUN ELECTRIC', `${sp.minRunTimerElectricMin} MIN`], ['TIMER', 'MIN RUN DIESEL', `${sp.minRunTimerDieselMin} MIN`], ['SYSTEM', 'MAX PRESSURE', `${f(r.pumps.maxSystemPressurePsi, 0)} PSI`]);
  const tSet = mk('JOCKEY & PRESSURE SETPOINTS', spRows, th);

  // ───────── valve schedule ─────────
  const vrows = r.room.valves.map((v) => [v.tag, valveKindName(v.kind), formatPipeSize(v.sizeIn), v.service.toUpperCase()]);
  const half = Math.ceil(vrows.length / 2);
  const vh: string[] = ['TAG', 'DESCRIPTION', 'SIZE', 'SERVICE'];
  const tV1 = mk('VALVE SCHEDULE (1)', [vh, ...vrows.slice(0, half)], th);
  const tV2 = vrows.length > half ? mk('VALVE SCHEDULE (2)', [vh, ...vrows.slice(half)], th) : null;

  // ───────── tank & sump + room ─────────
  const tk = r.tank;
  const sump = tk.sump;
  const tankRows: string[][] = [['ITEM', 'VALUE']];
  tankRows.push(['Material / placement', `${tk.material.replace(/-/g, ' ').toUpperCase()} / ${tk.placement.toUpperCase()}`]);
  tankRows.push(['Internal size L x W', `${tk.internalLengthM.toFixed(2)} x ${tk.internalWidthM.toFixed(2)} m, ${tk.compartments} COMPARTMENT(S)`]);
  tankRows.push(['Effective depth / freeboard', `${tk.effectiveDepthM.toFixed(2)} m / ${(tk.freeboardM * 1000).toFixed(0)} mm`]);
  tankRows.push(['Effective volume', `${tk.providedEffectiveM3.toFixed(1)} m3 (REQ. ${tk.requiredEffectiveM3.toFixed(1)} m3)`]);
  tankRows.push(['Wall / floor / roof', `${tk.wallThicknessMm} / ${tk.floorThicknessMm} / ${tk.roofThicknessMm} mm`]);
  tankRows.push(['Levels (m above tank floor)', `LWL ${f(tk.levels.lowWaterM, 2)}, NWL ${f(tk.levels.effectiveTopM, 2)}, OFL ${f(tk.levels.overflowM, 2)}, TWL ${f(tk.levels.topWaterM, 2)}`]);
  tankRows.push(['Sump pit L x W x D', `${sump.pitLengthMm} x ${sump.pitWidthMm} x ${sump.pitDepthMm} mm`]);
  tankRows.push(['Anti-vortex plate', `${sump.vortexPlateMm} mm SQ, INLET ${sump.inletAboveSumpFloorMm} mm ABOVE FLOOR`]);
  tankRows.push(['Suction pipe', `${formatPipeSize(sump.suctionPipeIn)}, CL ${sump.suctionCLBelowTankFloorMm} mm BELOW TANK FLOOR`]);
  tankRows.push(['Refill time', `${tk.refillHours.toFixed(1)} h @ ${r.input.refillFlowGpm} gpm (MAX 8 h)`]);
  const tTank = mk('TANK & SUMP SCHEDULE (NFPA 22)', tankRows, th, [46, 70]);
  const rm = r.room;
  const roomRows: string[][] = [['ITEM', 'VALUE']];
  roomRows.push(['Room (internal) L x W x H', `${rm.lengthMm} x ${rm.widthMm} x ${rm.clearHeightMm} mm`]);
  roomRows.push(['Fire separation', `${rm.fireRatingHours} h (IBC 913.2.1)`]);
  roomRows.push(['Elevations (m, FFL)', `PAD ${f(rm.elevations.padTopM, 3)}, PUMP CL ${f(rm.elevations.pumpCLM, 3)}, TANK FLOOR ${f(rm.elevations.tankFloorM, 3)}`]);
  roomRows.push(['Trench', `${rm.trench.widthMm} WIDE, ${rm.trench.slopePercent} % SLOPE, ${f(rm.trench.capacityGpm, 0)} gpm CAPACITY`]);
  roomRows.push(['Design drain inflow', `${f(rm.trench.designInflowGpm, 0)} gpm TO ${rm.trench.outlet.drainIn} in DRAIN`]);
  roomRows.push(['Header / system outlet', `${formatPipeSize(rm.systemOutlet.sizeIn)} AT x = ${rm.headerX} mm`]);
  const tRoom = mk('PUMP ROOM DATA', roomRows, th, [46, 70]);

  // ───────── checks ─────────
  const chkAll = r.checks.map((k) => [k.status.toUpperCase(), k.title, wrapText(k.reference, 46).join('\n'), wrapText(k.detail, 52).join('\n')]);
  const ch = ['STATUS', 'CHECK', 'REFERENCE', 'DETAIL'];
  const hc = Math.ceil(chkAll.length / 2);
  const tC1 = mk('COMPLIANCE CHECKS (1)', [ch, ...chkAll.slice(0, hc).map((row) => [row[0], wrapText(row[1], 34).join('\n'), row[2], row[3]])], 2.5);
  const tC2 = chkAll.length > hc ? mk('COMPLIANCE CHECKS (2)', [ch, ...chkAll.slice(hc).map((row) => [row[0], wrapText(row[1], 34).join('\n'), row[2], row[3]])], 2.5) : null;

  // ───────── standards references ─────────
  const refRows: string[][] = [['CODE', 'ED.', 'SCOPE USED IN THIS DESIGN']];
  for (const q of r.standardsReferences) refRows.push([q.code, q.edition, wrapText(q.scope, 80).join('\n')]);
  const tRef = mk('STANDARDS & CODE REFERENCES', refRows, 2.5);
  const plRows: string[][] = [['CODE', 'CLAUSE', 'REQUIREMENT']];
  for (const q of PLUMBING_REQUIREMENTS) plRows.push([q.code, q.clause, wrapText(q.requirement, 80).join('\n')]);
  const tPl = mk('PLUMBING / BUILDING CODE REQUIREMENTS', plRows, 2.5);

  // ───────── shelf packing (tables keep their symmetric text boxes inside the frame) ─────────
  const X0 = 28;
  const X1 = 829;
  const gap = 6;
  const all: Tbl[] = [tHyd, tPump, tSet, tBasis, tV1, ...(tV2 ? [tV2] : []), tTank, tRoom, tC1, ...(tC2 ? [tC2] : []), tRef, tPl];
  const info = all.map((t) => ({ t, m: measureTable(t.cols, t.rows, { title: t.title, th: t.th }), xMin: Math.max(X0, tableMinX(t.cols, t.rows, t.th)) }));
  let y = 574;
  const placed: { t: Tbl; x: number; y: number }[] = [];
  let remaining = info.slice();
  let lastBottom = y;
  while (remaining.length) {
    let x = X0;
    let shelfH = 0;
    let progress = false;
    for (;;) {
      const idx = remaining.findIndex((q) => Math.max(x, q.xMin) + q.m.w <= X1);
      if (idx < 0) break;
      const q = remaining[idx];
      const px = Math.max(x, q.xMin);
      placed.push({ t: q.t, x: px, y });
      x = px + q.m.w + gap;
      shelfH = Math.max(shelfH, q.m.h);
      remaining = remaining.filter((_, i) => i !== idx);
      progress = true;
    }
    if (!progress) {
      // table too wide for any position: place at the left edge anyway
      const q = remaining.shift();
      if (q) {
        placed.push({ t: q.t, x: X0, y });
        shelfH = q.m.h;
      }
    }
    lastBottom = y - shelfH;
    y = lastBottom - gap;
  }
  for (const p of placed) drawTable(c, p.x, p.y, p.t.cols, p.t.rows, { title: p.t.title, th: p.t.th, alignRight: p.t.align });

  // general notes: three columns below the tables
  const notes = generalNotes(c);
  const nth = 2.6;
  const cuts: number[] = [];
  {
    const heights = notes.map((n) => notesHeight(130, 190, [n], nth));
    const total = heights.reduce((a, v) => a + v, 0);
    let acc = 0;
    let colEnd = total / 3;
    heights.forEach((h, i) => {
      acc += h;
      if (acc >= colEnd && cuts.length < 2) {
        cuts.push(i + 1);
        colEnd += total / 3;
      }
    });
  }
  const groups = [notes.slice(0, cuts[0] ?? notes.length), notes.slice(cuts[0] ?? notes.length, cuts[1] ?? notes.length), notes.slice(cuts[1] ?? notes.length)];
  const colX = [128, 350, 572];
  let num = 0;
  groups.forEach((g, gi) => {
    if (!g.length) return;
    drawNotes(c, colX[gi], lastBottom - gap, 205, gi === 0 ? 'GENERAL NOTES' : 'GENERAL NOTES (CONT.)', g, nth, num);
    num += g.length;
  });
}
