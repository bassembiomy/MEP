/**
 * FP-104 — Fire pump schematic (NOT TO SCALE). Single-line flow diagram, left to right:
 * tank compartments -> suction trains -> pumps -> discharge trains -> header -> system riser,
 * with the test line, flow meter, relief valve, test header, jockey pump, sensing lines and controllers.
 */
import type { PlacedValve, ValveKind } from '../fpTypes';
import { formatPipeSize } from '../standards/pipeData';
import { ballValve, butterflyValve, checkValve, eccentricReducer, flexibleCoupling, flowMeter, gateValve, hoseValve, pressureGauge, reliefValve, concentricReducer } from './symbols';
import { type Ctx, PX, PY, arrowLine, autoCols, drawNotes, drawSymbolLegend, drawTable, drawTag, sheetTitle, textWidth, wrapText } from './sheetKit';

const D = 7; // symbol size (paper mm)

export function drawSchematicSheet(c: Ctx): void {
  const { b, r } = c;
  const room = r.room;
  const tank = r.tank;
  const pumps = r.pumps;
  const S = c.sheet.scale;
  const KX = 1.32; // horizontal stretch of the diagram layout
  const P = (x: number): number => PX(c, 20 + (x - 20) * KX);
  const Q = (y: number): number => PY(c, y);
  const ci = (layer: string, x: number, y: number, rad: number): void => b.circle(layer, P(x), Q(y), rad * S);
  const rc = (layer: string, x: number, y: number, w: number, h: number): void => b.rect(layer, P(x), Q(y), w * S * KX, h * S);
  const ln = (layer: string, x1: number, y1: number, x2: number, y2: number): void => b.line(layer, P(x1), Q(y1), P(x2), Q(y2));
  const line = (layer: string, pts: [number, number][]): void => b.polyline(layer, pts.map(([x, y]) => [P(x), Q(y)] as [number, number]), false);
  const txt = (x: number, y: number, h: number, t: string, o: { align?: 'left' | 'center' | 'right'; vAlign?: 'baseline' | 'bottom' | 'middle' | 'top'; rot?: number; layer?: string } = {}): void => {
    b.text(o.layer ?? 'FP-ANNO', P(x), Q(y), h, t, { align: o.align ?? 'left', vAlign: o.vAlign ?? 'middle', rotationDeg: o.rot });
  };
  const tag = (x: number, y: number, t: string): void => drawTag(b, P(x), Q(y), t, S);
  const size = (n: number): string => formatPipeSize(n);

  const nMain = pumps.mainPumps.length;
  const rowY = nMain <= 1 ? [235] : nMain === 2 ? [235, 370] : Array.from({ length: nMain }, (_, k) => 225 + (k * 190) / (nMain - 1));
  const yJ = 480;
  const yT = 120;
  const xHdr = 440;
  const xPump = 230;
  const sideOf = Array.from({ length: Math.max(nMain, 2) }, (_, k) => (k % 2 ? 1 : -1)); // tags / labels below (-1) for FP-1, above (+1) for FP-2
  const valveSym = (kind: ValveKind, x: number, y: number, ang: number, dp = D): void => {
    const X = P(x);
    const Y = Q(y);
    const d = dp * S;
    switch (kind) {
      case 'os&y-gate':
        gateValve(b, X, Y, ang, d);
        break;
      case 'butterfly':
        butterflyValve(b, X, Y, ang, d);
        break;
      case 'check':
        checkValve(b, X, Y, ang, d);
        break;
      case 'relief':
      case 'circulation-relief':
        reliefValve(b, X, Y, ang, d);
        break;
      case 'flow-meter':
        flowMeter(b, X, Y, ang, d * 1.2);
        break;
      case 'pressure-gauge':
        pressureGauge(b, X, Y, ang, d);
        break;
      case 'eccentric-reducer':
        eccentricReducer(b, X, Y, ang, d, d * 0.75);
        break;
      case 'concentric-increaser':
        concentricReducer(b, X, Y, ang, d * 0.75, d);
        break;
      case 'hose-valve':
        hoseValve(b, X, Y, ang, d);
        break;
      case 'ball-valve':
        ballValve(b, X, Y, ang, d);
        break;
      case 'flexible-coupling':
        flexibleCoupling(b, X, Y, ang, d);
        break;
      case 'tamper-switch':
        break;
    }
  };
  const NAME: Partial<Record<ValveKind, string>> = {
    'os&y-gate': 'OS&Y GATE VALVE + TAMPER SW.',
    butterfly: 'BUTTERFLY VALVE (SUPERVISED)',
    check: 'CHECK VALVE',
    relief: 'RELIEF VALVE',
    'circulation-relief': 'CIRCULATION RELIEF',
    'flow-meter': 'FLOW METER',
    'pressure-gauge': 'PRESSURE GAUGE',
    'eccentric-reducer': 'ECCENTRIC REDUCER (FLAT TOP)',
    'concentric-increaser': 'CONCENTRIC INCREASER',
    'hose-valve': 'HOSE VALVE 2-1/2"',
    'ball-valve': 'BALL VALVE',
    'flexible-coupling': 'FLEXIBLE COUPLING'
  };
  /** Symbol + tag + rotated description on the chosen side of a horizontal pipe. */
  const item = (v: PlacedValve, tagText: string, x: number, y: number, side: number, ang = 0, lab?: string): void => {
    valveSym(v.kind, x, y, ang);
    tag(x, y + side * 13, tagText);
    const t = lab ?? NAME[v.kind] ?? v.kind;
    txt(x, y + side * 18.5, 2.2, t, { rot: 90, align: side > 0 ? 'left' : 'right' });
  };

  // ─────────────────────────── tank ───────────────────────────
  const nComp = tank.compartments;
  const tankY: [number, number][] = nComp >= 2 ? [[203, 267], [338, 402]] : [[203, 402]];
  const twl = (r.room.elevations.tankFloorM + tank.levels.topWaterM).toFixed(3);
  const lwl = (r.room.elevations.tankFloorM + tank.levels.lowWaterM).toFixed(3);
  tankY.forEach(([y0, y1], i) => {
    rc('FP-TANK', 35, y0, 65, y1 - y0);
    ln('FP-WATR', 35, y1 - 12, 100, y1 - 12);
    for (let xx = 40; xx < 96; xx += 14) ln('FP-WATR', xx, y1 - 15, xx + 8, y1 - 15);
    txt(37, y1 - 6, 2.2, `COMPARTMENT ${i + 1}`, { vAlign: 'middle' });
    txt(37, y1 - 22, 2.2, `TWL +${twl}`);
    txt(37, y1 - 27, 2.2, `LWL +${lwl}`);
    txt(37, y0 + 6, 2.2, 'FIRE WATER (NFPA 22)');
  });
  txt(67.5, 421 + 8, 3, 'FIRE WATER TANK', { align: 'center', vAlign: 'middle' });
  txt(67.5, 421 + 3.5, 2.2, `${tank.providedEffectiveM3.toFixed(0)} m3 EFFECTIVE, ${nComp} COMPARTMENT${nComp > 1 ? 'S' : ''}`, { align: 'center' });

  // ─────────────────────────── main pump trains ───────────────────────────
  const hdrTop = 520;
  const pumpRows: number[] = [];
  pumps.mainPumps.forEach((mp, k) => {
    const y = rowY[k];
    pumpRows.push(y);
    const side = sideOf[k];
    const opp = -side;
    const pl = room.pipes.find((p) => p.id === `SUC-${mp.tag}`);
    const dl = room.pipes.find((p) => p.id === `DIS-${mp.tag}`);
    const sx = room.suctionLineY[k];
    const vs = room.valves.filter((v) => Math.abs(v.y - sx) < 450 && v.x < room.headerX - 100).sort((p, q) => p.x - q.x);
    const nozX = room.equipment.find((e) => e.tag === mp.tag)?.suctionNozzle?.x ?? 0;
    const sVs = vs.filter((v) => v.x < nozX && v.kind !== 'tamper-switch');
    const dVs = vs.filter((v) => v.x >= nozX);
    // suction pipe (from the tank sump through the wall) and discharge pipe
    const tankBox = tankY[Math.min(k, tankY.length - 1)];
    void tankBox;
    line('FP-PIPE-SUCT', [[100, y], [xPump - 14, y]]);
    line('FP-PIPE-DISC', [[xPump + 14, y], [xHdr, y]]);
    // sump pit + anti-vortex plate inside the compartment (hidden / below floor)
    const bx = tankY[Math.min(k, tankY.length - 1)];
    rc('FP-HIDN', 80, y - 14, 20, 14 + (bx[1] > y + 20 ? 0 : 0));
    ln('FP-TANK', 83, y - 10, 97, y - 10);
    line('FP-PIPE-SUCT', [[100, y], [90, y], [90, y - 7]]);
    txt(67.5, y - 19, 2, 'SUMP + ANTI-VORTEX PLATE', { align: 'center' });
    // wall sleeve marker
    ln('FP-WALL', 100, y - 6, 100, y + 6);
    // suction valves, right-aligned to the pump
    const nS = sVs.length;
    sVs.forEach((v, i) => {
      const x = 205 - (nS - 1 - i) * 27;
      const tg = v.kind === 'os&y-gate' ? `${v.tag}/${(vs.find((q) => q.kind === 'tamper-switch' && Math.abs(q.x - v.x) < 5)?.tag ?? '').replace('V-', '')}` : v.tag;
      if (v.kind === 'pressure-gauge') {
        valveSym(v.kind, x, y, 0);
        tag(x, y + side * 13, v.tag);
        txt(x, y + side * 18.5, 2.2, NAME[v.kind] ?? '', { rot: 90, align: side > 0 ? 'left' : 'right' });
      } else item(v, tg.endsWith('/') ? v.tag : tg, x, y, side, 0);
    });
    // discharge valves
    const dRow = dVs.filter((v) => v.kind !== 'circulation-relief');
    const circ = dVs.find((v) => v.kind === 'circulation-relief');
    dRow.forEach((v, i) => {
      const x = 262 + i * 22;
      if (v.kind === 'pressure-gauge') {
        valveSym(v.kind, x, y, 0);
        tag(x, y + side * 13, v.tag);
        txt(x, y + side * 18.5, 2.2, NAME[v.kind] ?? '', { rot: 90, align: side > 0 ? 'left' : 'right' });
      } else item(v, v.tag, x, y, side, 0);
    });
    if (circ) {
      // circulation relief on the pump casing, drains to the floor trench
      const xr = 262 + dRow.length * 22 - 4;
      void xr;
    }
    // pump symbol: circle with the tag, discharge pointing up, driver on the opposite side
    ci('FP-EQPM', xPump, y, 14);
    ln('FP-EQPM', xPump - 14, y - 3, xPump + 2, y + 13.6);
    ln('FP-EQPM', xPump - 14, y + 3, xPump + 2, y - 13.6);
    txt(xPump, y, 3, mp.tag, { align: 'center', vAlign: 'middle', layer: 'FP-ANNO' });
    // driver
    const dyc = y + opp * 28;
    if (mp.driver === 'electric') {
      ci('FP-EQPM', xPump, dyc, 9);
      txt(xPump, dyc, 3.5, 'M', { align: 'center' });
    } else {
      rc('FP-EQPM', xPump - 12, dyc - 9, 24, 18);
      txt(xPump, dyc, 2.4, 'DIESEL', { align: 'center' });
    }
    line('FP-EQPM', [[xPump, y + opp * 14], [xPump, y + opp * 19]]);
    // description under / over the driver
    const desc = [`${mp.tag} ${mp.driver === 'diesel' ? 'DIESEL' : 'ELECTRIC'} ${mp.role === 'duty' ? 'DUTY' : 'STANDBY'} FIRE PUMP`, `${mp.ratedFlowGpm} GPM @ ${mp.ratedNetPressurePsi} PSI, ${mp.driverHp} HP, ${mp.speedRpm} RPM`, mp.pumpType === 'horizontal-split-case' ? 'HORIZONTAL SPLIT-CASE (NFPA 20)' : mp.pumpType.toUpperCase().replace(/-/g, ' ')];
    desc.forEach((t, i) => txt(xPump, dyc + opp * (16 + i * 3.6), 2.2, t, { align: 'center' }));
    // sizes on the pipes
    txt(112, y + 3.5 * -side + (side > 0 ? 0 : 0), 2, `${size(pl?.sizeIn ?? mp.sizes.suctionIn)} SUCTION`, { align: 'left', vAlign: 'middle' });
    txt(xHdr - 6, y - side * 3.5, 2, `${size(dl?.sizeIn ?? mp.sizes.dischargeIn)} DISCHARGE`, { align: 'right', vAlign: 'middle' });

    // controller on the driver side, sensing line from the discharge pipe (two check valves, 3/32" orifice)
    const ctl = mp.controller;
    const cx0 = 330;
    const cw = 70;
    const cyc = y + opp * 42;
    rc('FP-ELEC', cx0, cyc - 11, cw, 22);
    txt(cx0 + cw / 2, cyc + 3, 3, ctl.tag, { align: 'center' });
    txt(cx0 + cw / 2, cyc - 5, 2, mp.driver === 'diesel' ? 'DIESEL CONTROLLER' : 'ELECTRIC CONTROLLER', { align: 'center' });
    const xs = 309;
    line('FP-PIPE-SENS', [[xs, y], [xs, cyc], [cx0, cyc]]);
    ci('FP-ANNO', xs, y, 0.8);
    for (const dy of [9, 16]) {
      const yy = y + opp * dy;
      checkValve(b, P(xs), Q(yy), opp > 0 ? 90 : -90, 4.5 * S);
    }
    txt(xs + 4, y + opp * 22.5, 2, '2 x CHECK + 3/32" ORIFICE', { align: 'left' });
    // power
    const pwr = mp.driver === 'electric' ? [`NORMAL POWER: UTILITY SERVICE ${r.input.electricalSupply.voltage} V / 3 PH / ${r.input.electricalSupply.hz} HZ`, 'DEDICATED SERVICE, UL 1008 ATS IF STANDBY GENERATOR (NFPA 70 ART. 695)'] : ['DUAL 12/24 V DC BATTERIES + CHARGER (NFPA 20 CH. 11)', 'FUEL: DIESEL TANK FT-1 (NFPA 20 11.4)'];
    line('FP-ELEC', [[cx0 + cw, cyc], [cx0 + cw + 10, cyc]]);
    pwr.forEach((t, i) => txt(cx0, cyc + opp * (15 + i * 3.4) * 1 + (opp > 0 ? 0 : 0), 2, t, { align: 'left' }));
    line('FP-ELEC', [[cx0, cyc - opp * 6], [xPump + 9, cyc - opp * 6 + opp * 0], [xPump + 9, dyc]]);
    // motor / engine power cable (dashed look through short segments)
    if (mp.driver === 'diesel') {
      // fuel tank + exhaust
      const fx = 140;
      rc('FP-EQPM', fx, dyc - 8, 36, 16);
      txt(fx + 18, dyc, 2.2, room.equipment.filter((e) => e.kind === 'fuel-tank')[pumps.mainPumps.filter((q, qi) => q.driver === 'diesel' && qi <= k).length - 1]?.tag ?? 'FT-1', { align: 'center' });
      txt(fx + 18, dyc + opp * 11, 2, `FUEL ${mp.fuelTankLiters ? Math.round(mp.fuelTankLiters) + ' L' : 'TANK'}`, { align: 'center' });
      line('FP-FUEL', [[fx + 36, dyc], [xPump - 12, dyc]]);
      line('FP-FUEL', [[xPump + 12, dyc + opp * 5], [xPump + 36, dyc + opp * 5], [xPump + 36, dyc + opp * 26]]);
      txt(xPump + 38, dyc + opp * 26, 2, 'EXHAUST TO ATMOSPHERE (SILENCER)', { align: 'left' });
    }
    // header connection arrow
    ci('FP-PIPE-DISC', xHdr, y, 0.9);
  });

  // jockey pump
  {
    const jx = 230;
    const jv = room.valves.filter((v) => v.service === 'jockey').sort((p, q) => p.x - q.x);
    const tapX = 164;
    const ySuc = rowY[Math.min(nMain, 2) - 1];
    line('FP-PIPE-JCKY', [[tapX, ySuc], [tapX, yJ], [jx - 9, yJ]]);
    line('FP-PIPE-JCKY', [[jx + 9, yJ], [xHdr, yJ]]);
    ci('FP-PIPE-JCKY', tapX, ySuc, 0.9);
    ci('FP-EQPM', jx, yJ, 9);
    txt(jx, yJ, 3, pumps.jockey.tag, { align: 'center' });
    // motor above
    ci('FP-EQPM', jx, yJ - 22, 6);
    txt(jx, yJ - 22, 3, 'M', { align: 'center' });
    line('FP-EQPM', [[jx, yJ - 9], [jx, yJ - 16]]);
    if (pumps.jockeys.length > 1) txt(jx, yJ - 36.5, 2, `${pumps.jockeys.slice(1).map((q) => q.tag).join(', ')}: IDENTICAL STANDBY JOCKEY, PIPED IN PARALLEL (SEE FP-101)`, { align: 'center' });
    txt(jx, yJ - 32, 2.2, `${pumps.jockey.tag} JOCKEY PUMP ${pumps.jockey.ratedFlowGpm} GPM @ ${pumps.jockey.ratedNetPressurePsi} PSI, ${pumps.jockey.motorHp} HP`, { align: 'center' });
    const xs = [185, 275, 305];
    jv.forEach((v, i) => item(v, v.tag, xs[i] ?? 185 + i * 30, yJ, 1, 0));
    txt(tapX + 3, 461, 2.2, `${size(pumps.jockey.pipeSizeIn)} JOCKEY SUCTION TAP`, { align: 'left' });
    // jockey controller
    const cy = yJ - 42;
    rc('FP-ELEC', 335, cy - 9, 62, 18);
    txt(366, cy + 2.5, 3, pumps.jockey.controller.tag, { align: 'center' });
    txt(366, cy - 4.5, 2, 'JOCKEY CONTROLLER', { align: 'center' });
    line('FP-PIPE-SENS', [[xHdr - 22, yJ], [xHdr - 22, cy], [397, cy]]);
    ci('FP-ANNO', xHdr - 22, yJ, 0.8);
    txt(xHdr - 19, cy + 9, 2, 'SENSING LINE', { align: 'left' });
    line('FP-ELEC', [[335, cy], [jx + 6, cy], [jx + 6, yJ - 22]]);
  }

  // ─────────────────────────── header, outlet, relief, test line ───────────────────────────
  line('FP-PIPE-DISC', [[xHdr, yT], [xHdr, hdrTop], [xHdr, 560]]);
  arrowLine(b, [P(xHdr), Q(566)], [P(xHdr), Q(552)], S);
  const out = room.valves.find((v) => v.kind === 'butterfly' && v.service === 'discharge' && v.y > room.suctionLineY[nMain - 1]);
  if (out) {
    valveSym('butterfly', xHdr, 520, 90);
    tag(xHdr - 13, 520, out.tag);
    txt(xHdr - 17, 520, 2.2, 'BUTTERFLY VALVE (SUPERVISED)', { align: 'right' });
  }
  txt(xHdr - 4, 556, 2.4, `SYSTEM OUTLET ${size(room.systemOutlet.sizeIn)} TO RISER / FEED MAIN`, { align: 'right' });
  txt(xHdr - 4, 551.5, 2, '(NFPA 13 / NFPA 14 SPRINKLER + STANDPIPE DEMAND)', { align: 'right' });
  txt(xHdr + 3, 218, 2.4, `DISCHARGE HEADER ${size(room.pipes.find((p) => p.id === 'HDR-1')?.sizeIn ?? 6)}`, { rot: 0, align: 'left' });
  // relief valve (diesel overspeed) – branch west of the header, discharging to the test return
  const rel = room.valves.find((v) => v.kind === 'relief');
  const yRel = 190;
  const tstPipe = room.pipes.find((p) => p.id === 'TST-1');
  if (rel) {
    line('FP-PIPE-TEST', [[xHdr, yRel], [427, yRel]]);
    valveSym('relief', 413, yRel, 180);
    line('FP-PIPE-TEST', [[404, yRel], [395, yRel], [395, yT]]);
    ci('FP-PIPE-TEST', xHdr, yRel, 0.9);
    tag(413, yRel - 13, rel.tag);
    txt(xHdr - 5, yRel + 11, 2.2, `RELIEF VALVE ${size(rel.sizeIn)} - SET ${pumps.mainReliefValve.setPressurePsi} PSI`, { align: 'right' });
    txt(392, yRel - 32, 2, `RELIEF DISCHARGE ${size(pumps.mainReliefValve.dischargeIn)} TO TEST RETURN`, { align: 'right' });
  }
  // test return line with isolation valve, flow meter, throttling valve
  const tv = room.valves.filter((v) => v.service === 'test' && Math.abs(v.y - (tstPipe?.points[0][1] ?? 600)) < 5).sort((p, q) => q.x - p.x);
  line('FP-PIPE-TEST', [[xHdr, yT], [28, yT], [28, 258], [46, 258]]);
  arrowLine(b, [P(46), Q(258)], [P(60), Q(258)], S);
  const xt = [418, 365, 255];
  tv.forEach((v, i) => item(v, v.tag, xt[i] ?? 418 - i * 50, yT, -1, 180, v.kind === 'flow-meter' ? 'FLOW METER (TEST LINE)' : i === 0 ? 'BUTTERFLY - TEST ISOLATION' : 'BUTTERFLY - TEST THROTTLE'));
  txt(150, yT + 4, 2.4, `TEST RETURN ${size(tstPipe?.sizeIn ?? pumps.flowMeterIn)} TO TANK (DISCHARGES ABOVE TWL)`, { align: 'left' });
  txt(150, yT + 8, 2, `FLOW METER ${size(pumps.flowMeterIn)} - 150 % RATED FLOW TEST (NFPA 20 14.2)`, { align: 'left' });
  ci('FP-PIPE-TEST', xHdr, yT, 0.9);
  // test header branch + hose valves
  const hv = room.valves.filter((v) => v.kind === 'hose-valve');
  const xb = 320;
  const tb = room.valves.find((v) => v.service === 'test' && v.kind === 'butterfly' && Math.abs(v.angleDeg - 90) < 1);
  line('FP-PIPE-TEST', [[xb, yT], [xb, 50]]);
  ci('FP-PIPE-TEST', xb, yT, 0.9);
  if (tb) {
    valveSym('butterfly', xb, 95, 90);
    tag(xb - 11, 95, tb.tag);
    txt(xb - 17, 95, 2.2, 'BUTTERFLY - NORMALLY CLOSED', { align: 'right' });
  }
  const nHose = Math.max(hv.length, 1);
  const hx0 = xb - ((nHose - 1) * 18) / 2;
  line('FP-PIPE-TEST', [[hx0, 50], [hx0 + (nHose - 1) * 18, 50]]);
  for (let i = 0; i < nHose; i++) {
    const hxx = hx0 + i * 18;
    line('FP-PIPE-TEST', [[hxx, 50], [hxx, 44]]);
    hoseValve(b, P(hxx), Q(44), 180, 5 * S);
    if (hv[i]) tag(hxx, 28, hv[i].tag);
  }
  txt(xb, 17, 2.4, `TEST HEADER - ${nHose} x 2-1/2" HOSE VALVES, EXTERIOR WALL`, { align: 'center' });

  // ─────────────────────────── right-hand zone: setpoints, sequence, legend ───────────────────────────
  const zx = 640;
  const sp = pumps.setpoints;
  const rows: string[][] = [['DEVICE', 'FUNCTION', 'SETPOINT']];
  rows.push([pumps.jockey.controller.tag, 'JOCKEY STOP', `${sp.jockeyStopPsi} PSI`]);
  rows.push([pumps.jockey.controller.tag, 'JOCKEY START', `${sp.jockeyStartPsi} PSI`]);
  pumps.mainPumps.forEach((mp, i) => rows.push([mp.controller.tag, `${i === 0 ? 'DUTY' : 'STANDBY'} PUMP START (${mp.driver === 'diesel' ? 'DIESEL' : 'ELECTRIC'})`, `${i === 0 ? sp.dutyStartPsi : sp.standbyStartPsi} PSI`]));
  rows.push(['TIMER', 'ELECTRIC MIN. RUN', `${sp.minRunTimerElectricMin} MIN`]);
  if (pumps.mainPumps.some((p) => p.driver === 'diesel')) rows.push(['TIMER', 'DIESEL MIN. RUN', `${sp.minRunTimerDieselMin} MIN`]);
  const cols = autoCols(rows, 2.3, [24, 60, 22]);
  const t1 = drawTable(c, zx, 570, cols, rows, { title: 'PRESSURE SETPOINTS (NFPA 20 10.5)', th: 2.3 });
  const seq = [
    'Jockey pump maintains system pressure; it starts and stops on its own pressure switch (NFPA 20 10.5.2).',
    'On a pressure drop the duty fire pump starts automatically; the standby pump starts at its lower setpoint if the duty pump fails or demand exceeds one pump.',
    'Fire pumps stop only manually after the minimum run time; automatic stop is not permitted for the lead pump (NFPA 20 10.5.4).',
    'Each controller senses pressure through its own line fitted with two check valves in series and a 3/32 in orifice between them (NFPA 20 10.5.2.1).',
    'Test header: flow test at 100 %, 150 % rated flow through the flow meter back to the tank, or to the exterior hose valves.',
    `Electric supply ${r.input.electricalSupply.voltage} V, 3 ph, ${r.input.electricalSupply.hz} Hz from a dedicated service (NFPA 70 Art. 695); standby from an independent source or the diesel pump.`
  ];
  drawNotes(c, zx, 570 - t1.h - 8, 829 - zx - 4, 'SEQUENCE OF OPERATION', seq, 2.3);
  drawSymbolLegend(c, 627, 200);
  sheetTitle(c, 30, 563, 'FIRE PUMP SCHEMATIC', 'NOT TO SCALE');
  void textWidth;
  void wrapText;
}
