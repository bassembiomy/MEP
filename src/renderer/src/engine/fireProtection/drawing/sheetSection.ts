/**
 * FP-102 — Section A-A through the FP-1 suction centre-line: tank, sump pit with anti-vortex plate,
 * common wall sleeve, suction train, pump on pad, discharge train, header, trench and controller.
 */
import { formatPipeSize, gateValveLengthMm } from '../standards/pipeData';
import { butterflyValve, checkValve, concentricReducer, eccentricReducer, flexibleCoupling, gateValve, pressureGauge } from './symbols';
import { type Box, type Ctx, FRAME, Placer, PX, PY, TBLK, arrowLine, autoCols, dimBoxes, drawNotes, drawTable, sheetTitle, wrapText } from './sheetKit';
import { odOf, westWallMm } from './sheetGeom';

/** Smallest of 1:20 / 1:25 / 1:50 at which the section fits its zone. */
export function pickSectionScale(c: Pick<Ctx, 'r'>): number {
  const wW = westWallMm(c.r);
  const widthMm = 3000 + wW + c.r.room.lengthMm + 250;
  for (const s of [20, 25, 50]) if (widthMm / s + 140 <= 645) return s;
  return 50;
}

export function drawSectionSheet(c: Ctx): void {
  const { b, sheet, r } = c;
  const s = sheet.scale;
  const room = r.room;
  const tank = r.tank;
  const sp = tank.sump;
  const L = room.lengthMm;
  const wW = westWallMm(r);
  const wT = 250;
  const el = room.elevations;
  const z = (m: number): number => Math.round(m * 1000);
  const zPumpCL = z(el.pumpCLM);
  const zPad = z(el.padTopM);
  const zTF = z(el.tankFloorM);
  const zRoof = z(el.roofSoffitM);
  const zTWL = zTF + z(tank.levels.topWaterM);
  const zOFL = zTF + z(tank.levels.overflowM);
  const zNWL = zTF + z(tank.levels.effectiveTopM);
  const zLWL = zTF + z(tank.levels.lowWaterM);
  const zTR = zTF + z(tank.levels.roofSoffitM);
  const zPit = zTF - sp.pitDepthMm;
  const zHL = z(el.highLevelPipeM);
  const tFloor = Math.max(tank.floorThicknessMm, 150);
  const tRoof = Math.max(tank.roofThicknessMm, 150);
  const slab = 250;

  const xL = -wW - 3000;
  const OX = PX(c, 85) - xL;
  const OY = PY(c, 175);
  const X = (x: number): number => OX + x;
  const Z = (zz: number): number => OY + zz;
  const frameBounds: Box = { x0: PX(c, FRAME.x0 + 1), y0: PY(c, FRAME.y0 + 1), x1: PX(c, FRAME.x1 - 1), y1: PY(c, FRAME.y1 - 1) };
  const P = new Placer(c, frameBounds);
  P.addRect(PX(c, TBLK.x0), PY(c, TBLK.y0), (TBLK.x1 - TBLK.x0) * s, (TBLK.y1 - TBLK.y0) * s);

  const conc = (x0: number, z0: number, x1: number, z1: number, layer = 'FP-WALL'): void => {
    b.rect(layer, X(x0), Z(z0), x1 - x0, z1 - z0);
    b.hatchRect(X(x0), Z(z0), x1 - x0, z1 - z0, 1.8);
    P.addRect(X(x0), Z(z0), x1 - x0, z1 - z0);
  };
  const ln = (layer: string, x1: number, z1: number, x2: number, z2: number): void => b.line(layer, X(x1), Z(z1), X(x2), Z(z2));

  // ───────────────────────── structure ─────────────────────────
  const xPitW = -wW - sp.pitLengthMm; // pit west face
  const pitWall = 300;
  const xRoomEnd = L + wT;
  // plinth below the raft (by others)
  conc(xL, -slab, xPitW - pitWall, zTF - tFloor);
  // raft / tank floor slab
  conc(xL, zTF - tFloor, xPitW - pitWall, zTF, 'FP-TANK');
  // pit walls and slab
  conc(xPitW - pitWall, zPit - tFloor, xPitW, zTF, 'FP-TANK');
  conc(xPitW, zPit - tFloor, -wW, zPit, 'FP-TANK');
  // fill between pit slab and plinth level (pit sits in a recess of the plinth)
  // common wall (tank / pump room) full height
  conc(-wW, -slab, 0, zTR + tRoof, 'FP-TANK');
  // tank roof slab
  conc(xL, zTR, -wW, zTR + tRoof, 'FP-TANK');
  // room slab, east wall, roof
  conc(0, -slab, xRoomEnd, 0);
  conc(L, 0, xRoomEnd, zRoof + slab);
  conc(0, zRoof, L, zRoof + slab);
  // break line at the cut edge of the tank
  {
    const pts: [number, number][] = [];
    let k = 0;
    for (let zz = -slab; zz <= zTR + tRoof; zz += 450) pts.push([X(xL + (k++ % 2 ? 120 : -120)), Z(zz)]);
    b.polyline('FP-TANK', pts, false);
  }
  // water levels (dashed) across the tank
  const levels: [number, string][] = [[zTWL, 'TWL'], [zOFL, 'OFL'], [zNWL, 'NWL']];
  for (const [zz] of levels) ln('FP-WATR', xL + 150, zz, -wW, zz);
  // water body hints: wave ticks under TWL
  for (let xx = xL + 600; xx < -wW - 300; xx += 700) {
    ln('FP-WATR', xx, zTWL - 120, xx + 280, zTWL - 120);
    ln('FP-WATR', xx + 140, zTWL - 240, xx + 420, zTWL - 240);
  }
  ln('FP-WATR', xL + 150, zLWL, xPitW, zLWL);

  // ───────────────────────── suction train ─────────────────────────
  const pump = room.equipment.find((e) => e.tag === 'FP-1');
  const noz = pump?.suctionNozzle;
  const dis = pump?.dischargeNozzle;
  const sizeS = noz?.sizeIn ?? sp.suctionPipeIn;
  const odS = odOf(sizeS);
  const xPlate = -wW - sp.plateCentreFromWallMm;
  const zOpen = zPit + sp.inletAboveSumpFloorMm;
  const xNoz = noz?.x ?? 2570;
  // pipe (mitred elbow down at the plate)
  b.pipe('FP-PIPE-SUCT', [[X(xNoz), Z(zPumpCL)], [X(xPlate), Z(zPumpCL)], [X(xPlate), Z(zOpen)]], odS, true);
  // anti-vortex plate on legs
  const pl = sp.vortexPlateMm;
  b.rect('FP-TANK', X(xPlate - pl / 2), Z(zPit + 40), pl, 12);
  for (const dx of [-pl / 2 + 40, pl / 2 - 40]) b.line('FP-TANK', X(xPlate + dx), Z(zPit), X(xPlate + dx), Z(zPit + 40));
  // wall sleeve + puddle flange
  // cast-in puddle flange PF-01 (no wall sleeve in the water-retaining wall): plate OD = pipe OD + 200, 10 thick, centred
  const pf1 = room.penetrations.find((q) => q.kind === 'puddle-flange') ?? room.penetrations[0];
  const pfOd = pf1?.puddleFlangeOdMm || odS + 200;
  b.rect('FP-WALL', X(-wW / 2 - 5), Z(zPumpCL - pfOd / 2), 10, pfOd);
  b.solid('FP-WALL', [[X(-wW / 2 - 5), Z(zPumpCL - pfOd / 2)], [X(-wW / 2 + 5), Z(zPumpCL - pfOd / 2)], [X(-wW / 2 + 5), Z(zPumpCL + pfOd / 2)], [X(-wW / 2 - 5), Z(zPumpCL + pfOd / 2)]]);
  // valves (positions from the layout)
  const vl = room.valves.filter((v) => Math.abs(v.y - room.suctionLineY[0]) < 2);
  const vOf = (k: string) => vl.find((v) => v.kind === k);
  const gate = vOf('os&y-gate');
  const flex = vOf('flexible-coupling');
  const gauge = vl.filter((v) => v.kind === 'pressure-gauge');
  const ecc = vOf('eccentric-reducer');
  const inc = vOf('concentric-increaser');
  const chk = vOf('check');
  const bfl = vOf('butterfly');
  if (flex) flexibleCoupling(b, X(flex.x), Z(zPumpCL), 0, odS);
  if (gate) gateValve(b, X(gate.x), Z(zPumpCL), 0, odS);
  if (ecc) eccentricReducer(b, X(ecc.x), Z(zPumpCL), 0, odS, odS * 0.84);
  for (const g of gauge) pressureGauge(b, X(g.x), Z(zPumpCL), 0, Math.max(odOf(g.sizeIn), 150));
  // discharge train
  const xDis = dis?.x ?? 3370;
  const odD = odOf(dis?.sizeIn ?? room.systemOutlet.sizeIn);
  const odH = odOf(room.pipes.find((p) => p.id === 'HDR-1')?.sizeIn ?? 6);
  b.pipe('FP-PIPE-DISC', [[X(xDis), Z(zPumpCL)], [X(room.headerX - odH / 2), Z(zPumpCL)]], odD, true);
  if (inc) concentricReducer(b, X(inc.x), Z(zPumpCL), 0, odD * 0.8, odD);
  if (chk) checkValve(b, X(chk.x), Z(zPumpCL), 0, odD);
  if (bfl) butterflyValve(b, X(bfl.x), Z(zPumpCL), 0, odD);
  // header (cut) – outer pipe wall, bore and centre mark
  b.circle('FP-PIPE-DISC', X(room.headerX), Z(zPumpCL), odH / 2);
  b.circle('FP-PIPE-DISC', X(room.headerX), Z(zPumpCL), odH / 2 - 7);
  b.line('FP-CNTR', X(room.headerX - odH / 2 - 120), Z(zPumpCL), X(room.headerX + odH / 2 + 120), Z(zPumpCL));
  b.line('FP-CNTR', X(room.headerX), Z(zPumpCL - odH / 2 - 120), X(room.headerX), Z(zPumpCL + odH / 2 + 120));
  // high-level test return (in front of the cut plane – hidden)
  const tst = room.pipes.find((p) => p.id === 'TST-1');
  const odT = odOf(tst?.sizeIn ?? 5);
  b.line('FP-HIDN', X(-wW), Z(zHL + odT / 2), X(room.headerX), Z(zHL + odT / 2));
  b.line('FP-HIDN', X(-wW), Z(zHL - odT / 2), X(room.headerX), Z(zHL - odT / 2));
  b.line('FP-HIDN', X(room.headerX), Z(zHL - odT / 2), X(room.headerX), Z(zPumpCL + odH / 2));
  b.line('FP-HIDN', X(room.headerX + odT / 2), Z(zHL - odT / 2), X(room.headerX + odT / 2), Z(zHL + odT / 2));
  b.line('FP-HIDN', X(room.headerX + odT / 2), Z(zHL + odT / 2), X(room.headerX), Z(zHL + odT / 2));

  // ───────────────────────── pump on pad ─────────────────────────
  if (pump) {
    const pad = pump.pad ?? pump.rect;
    b.rect('FP-PADS', X(pad.x), Z(0), pad.w, zPad);
    b.hatchRect(X(pad.x), Z(0), pad.w, zPad, 1.8);
    const k = pump.rect;
    b.rect('FP-EQPM', X(k.x), Z(zPad), k.w, 90); // base plate
    const cx = k.x + k.w / 2;
    const rc = Math.min(0.36 * k.w, 330);
    b.circle('FP-EQPM', X(cx), Z(zPumpCL), rc);
    b.circle('FP-EQPM', X(cx), Z(zPumpCL), rc * 0.35);
    b.line('FP-EQPM', X(cx - rc), Z(zPumpCL), X(cx + rc), Z(zPumpCL));
    b.rect('FP-EQPM', X(cx - rc * 0.6), Z(zPad + 90), rc * 1.2, zPumpCL - rc - zPad - 90 + rc * 0.1); // pedestal
    b.rect('FP-EQPM', X(xNoz - 20), Z(zPumpCL - odS / 2 - 40), cx - rc - xNoz + 20, odS + 80); // suction nozzle
    b.rect('FP-EQPM', X(cx + rc), Z(zPumpCL - odD / 2 - 40), k.x + k.w + 20 - cx - rc, odD + 80); // discharge nozzle
    b.rect('FP-EQPM', X(cx - rc * 0.5), Z(zPumpCL + rc), rc, 80); // top casing flange (horizontal split)
    P.addRect(X(pad.x), Z(0), pad.w, zPumpCL + rc);
  }

  // ───────────────────────── trench (cut) ─────────────────────────
  const tr = room.trench;
  {
    const tx = tr.path[0][0];
    const ySec = room.suctionLineY[0];
    const depth = tr.depthStartMm + ((tr.path[0][1] - ySec) * tr.slopePercent) / 100;
    ln('FP-TRCH', tx - tr.widthMm / 2, 0, tx - tr.widthMm / 2, -depth);
    ln('FP-TRCH', tx + tr.widthMm / 2, 0, tx + tr.widthMm / 2, -depth);
    ln('FP-TRCH', tx - tr.widthMm / 2, -depth, tx + tr.widthMm / 2, -depth);
    ln('FP-TRCH', tx - tr.widthMm / 2, -40, tx + tr.widthMm / 2, -40);
    for (let xx = tx - tr.widthMm / 2 + 30; xx < tx + tr.widthMm / 2; xx += 60) ln('FP-TRCH', xx, 0, xx, -40);
    P.addRect(X(tx - tr.widthMm / 2), Z(-depth), tr.widthMm, depth);
  }

  // ───────────────────────── controller elevation ─────────────────────────
  const ctl = room.equipment.find((e) => e.tag === 'FPC-1');
  if (ctl) {
    const hC = r.pumps.mainPumps[0].controller.heightMm;
    b.rect('FP-ELEC', X(ctl.rect.x), Z(150), ctl.rect.w, hC - 150);
    b.line('FP-ELEC', X(ctl.rect.x), Z(150), X(ctl.rect.x + ctl.rect.w), Z(hC));
    for (const dx of [60, ctl.rect.w - 60]) ln('FP-ELEC', ctl.rect.x + dx, 0, ctl.rect.x + dx, 150);
    ln('FP-ELEC', ctl.rect.x, 150, ctl.rect.x + ctl.rect.w, 150);
    P.addRect(X(ctl.rect.x), Z(0), ctl.rect.w, hC);
    // sensing line stub from the header
    b.polyline('FP-PIPE-SENS', [[X(room.headerX + odH / 2), Z(zPumpCL)], [X(ctl.rect.x - 200), Z(zPumpCL)], [X(ctl.rect.x - 200), Z(1500)], [X(ctl.rect.x), Z(1500)]], false);
  }

  // ───────────────────────── level marks ─────────────────────────
  const lmL = xL - 40 * s; // left column (tank levels)
  const leftMarks: [number, string][] = [[zTR, 'ROOF'], [zTWL, 'TWL'], [zOFL, 'OFL'], [zNWL, 'NWL'], [zLWL, 'LWL'], [zPit, 'SUMP']];
  for (const [zz, label] of leftMarks) {
    b.levelMark(X(lmL), Z(zz), zz / 1000, label);
    ln('FP-LEVL', lmL + 14 * s, zz, xL, zz);
  }
  // room levels on the right
  const xr = xRoomEnd + 40 * s;
  const rightMarks: [number, string][] = [[0, 'FFL'], [zPad, 'PAD'], [zPumpCL, 'PUMP CL'], [zHL, 'HL TEST'], [zRoof, 'SOFFIT']];
  for (const [zz, label] of rightMarks) b.levelMark(X(xr), Z(zz), zz / 1000, label);

  // ───────────────────────── dimensions ─────────────────────────
  const dimReg: Box[] = [];
  const dv = (x: number, z1: number, z2: number, off: number, t?: string): void => {
    b.dimLinear(X(x), Z(z1), X(x), Z(z2), off, t);
    dimReg.push(...dimBoxes(s, X(x), Z(z1), X(x), Z(z2), off, t ?? String(Math.round(Math.abs(z2 - z1)))));
  };
  const dh = (x1: number, x2: number, zz: number, off: number, t?: string): void => {
    b.dimLinear(X(x1), Z(zz), X(x2), Z(zz), off, t);
    dimReg.push(...dimBoxes(s, X(x1), Z(zz), X(x2), Z(zz), off, t ?? String(Math.round(Math.abs(x2 - x1)))));
  };
  // east: vertical chain of the room levels
  const chain = [0, zPad, zPumpCL, zHL, zRoof].filter((v, i, a) => a.indexOf(v) === i).sort((p, q) => p - q);
  for (let i = 0; i + 1 < chain.length; i++) dv(xRoomEnd, chain[i], chain[i + 1], -9);
  dv(xRoomEnd, 0, zRoof, -17);
  // sump pit dimensions (west of the pit)
  dv(xPitW - pitWall, zPit, zTF, 10, String(sp.pitDepthMm));
  dv(xPlate - pl / 2 - 150, zPit, zOpen, 6, String(sp.inletAboveSumpFloorMm));
  dh(xPlate - pl / 2, xPlate + pl / 2, zPit - tFloor, -6, String(sp.vortexPlateMm));
  dh(xPitW, -wW, zPit - tFloor, -12, String(sp.pitLengthMm));
  // tank internal height + effective depth
  dv(xL + 400, zTF, zTR, -9);
  dv(xL + 1100, zLWL, zNWL, -9, String(Math.round(tank.effectiveDepthM * 1000)));
  // bottom chain: wall, suction run, pad, header, room length
  dh(-wW, 0, -slab, -8);
  dh(0, L, -slab, -17, String(room.lengthMm));
  if (gate && ecc) {
    const x1 = gate.x + gateValveLengthMm(gate.sizeIn) / 2;
    const x2 = ecc.x - odS / 2;
    dh(x1, x2, zPumpCL - odS / 2 - 30, -8);
  }
  dh(0, room.headerX, zRoof + slab, 8);

  // ───────────────────────── tags & callouts ─────────────────────────
  for (const bx of dimReg) P.addHard(bx);
  P.addRect(X(xRoomEnd), Z(-slab), 22 * s, zRoof + 2 * slab);
  P.addRect(X(xL) - 52 * s, Z(-slab), 52 * s, zTR + tRoof + slab);
  // pipe train band (valve stems, gauges) and pump top are off-limits for callout text
  P.addRect(X(0), Z(zPumpCL - odS / 2 - 40), room.headerX + odH / 2, odS + 300);
  P.addRect(X(room.headerX - odH), Z(zPumpCL - odH), 2 * odH, 2 * odH);
  if (pump) P.addRect(X(pump.rect.x), Z(zPumpCL), pump.rect.w, 520);
  const co = (anchor: [number, number], lines: string[], hP = 2.5, prefer?: number[]): void => {
    if (!P.callout(anchor, lines, hP, prefer) && process.env.FIRE_DEBUG) console.warn('FP-102 callout failed:', lines[0]);
  };
  // stack of room items: tag + descriptive callout
  const room1 = room.valves.filter((v) => Math.abs(v.y - room.suctionLineY[0]) < 2 && v.kind !== 'tamper-switch');
  const text: Record<string, string> = {
    'os&y-gate': 'OS&Y GATE VALVE + TAMPER SWITCH',
    'flexible-coupling': 'FLEXIBLE COUPLING',
    'pressure-gauge': 'PRESSURE GAUGE',
    'eccentric-reducer': 'ECCENTRIC REDUCER (FLAT TOP)',
    'concentric-increaser': 'CONCENTRIC INCREASER',
    check: 'CHECK VALVE',
    butterfly: 'BUTTERFLY VALVE',
    'circulation-relief': 'CIRCULATION RELIEF'
  };
  const bndRoom: Box = { x0: X(0) + 2 * s, y0: Z(200), x1: X(xRoomEnd) - 2 * s, y1: Z(zRoof) - 2 * s };
  // train items: vertical text columns (tag + description) above each symbol, thin leader from the symbol
  const colTh = 2.2;
  const lineW = colTh * 1.5 * s;
  const z0 = zPumpCL + odS / 2 + 320;
  for (const v of room1) {
    const t = text[v.kind];
    if (!t || v.kind === 'circulation-relief') continue;
    const words = wrapText(t, 17);
    const colsTxt = [v.tag, ...words];
    ln('FP-ANNO', v.x, zPumpCL + odS * (v.kind === 'os&y-gate' ? 0.62 : 0.5) + (v.kind === 'os&y-gate' ? 150 : 0), v.x, z0 - 20);
    const x0 = v.x - ((colsTxt.length - 1) * lineW) / 2;
    colsTxt.forEach((tx, i) => {
      P.text('FP-ANNO', X(x0 + i * lineW), Z(z0), colTh, tx, { rotationDeg: 90, align: 'left', vAlign: 'middle' });
    });
  }
  const pumpName = r.pumps.mainPumps[0];
  if (pump && pumpName) {
    const cxp = pump.rect.x + pump.rect.w / 2;
    ln('FP-ANNO', cxp, zPumpCL + 420, cxp, 1650);
    const lines = [`${pump.tag} ${pumpName.driver === 'diesel' ? 'DIESEL' : 'ELECTRIC'} FIRE PUMP`, `${pumpName.ratedFlowGpm} GPM @ ${pumpName.ratedNetPressurePsi} PSI, ${pumpName.driverHp} HP`];
    lines.forEach((t, i) => P.text('FP-ANNO', X(cxp), Z(1650 + 80 + (lines.length - 1 - i) * 3.4 * s), 2.4, t, { align: 'center', vAlign: 'bottom' }));
  }
  P.setBounds(bndRoom);
  co([X(room.headerX), Z(zPumpCL) + odH / 2], ['DISCHARGE HEADER (CUT)', `${formatPipeSize(room.pipes.find((p) => p.id === 'HDR-1')?.sizeIn ?? 6)} - EL +${(zPumpCL / 1000).toFixed(3)}`], 2.2, [90, 60, 120]);
  co([X(room.headerX), Z(zHL)], ['HIGH-LEVEL TEST RETURN', '(IN FRONT OF CUT PLANE) TO TANK'], 2.2, [90, 135, 45, 180]);
  const tx = tr.path[0][0];
  {
    // trench label below the slab, with a leader up to the trench invert
    const depthT = tr.depthStartMm + ((tr.path[0][1] - room.suctionLineY[0]) * tr.slopePercent) / 100;
    const yT = Z(-slab - 1500);
    arrowLine(b, [X(tx), Z(-depthT)], [X(tx), yT + 3.2 * s], s);
    P.text('FP-ANNO', X(tx), yT, 2.2, `TRENCH ${tr.widthMm} WIDE, ${tr.slopePercent}% SLOPE c/w GALVANISED GRATING`, { align: 'center', vAlign: 'middle' });
  }
  if (ctl) co([X(ctl.rect.x + ctl.rect.w / 2), Z(2000)], [`${ctl.tag} CONTROLLER`, 'SENSING LINE FROM HEADER'], 2.2, [90, 135, 45]);

  P.setBounds(frameBounds);
  // tank-side callouts
  P.setBounds({ x0: X(xL) + 2 * s, y0: Z(zLWL) + 2 * s, x1: X(-wW) - 2 * s, y1: Z(zTWL) - 2 * s });


  {
    // tank-side labels: a stack in the free water zone, each with a leader to its detail
    const xT = xL + 1500;
    const items: { zz: number; ax: number; az: number; t: string[] }[] = [
      { zz: zLWL + 2500, ax: -wW / 2, az: zPumpCL + pfOd / 2, t: [`PUDDLE FLANGE ${pf1?.tag ?? 'PF-01'}`, `OD ${pfOd} x 10 THK, CAST IN (NO SLEEVE)`] },
      { zz: zLWL + 1900, ax: xPitW, az: zPit + 400, t: [`SUMP PIT ${sp.pitLengthMm} x ${sp.pitWidthMm} x ${sp.pitDepthMm} DEEP`, 'BELOW TANK FLOOR'] },
      { zz: zLWL + 1300, ax: xPlate, az: zOpen, t: ['SUCTION ELBOW TURNED DOWN', `INLET ${sp.inletAboveSumpFloorMm} ABOVE SUMP FLOOR`] },
      { zz: zLWL + 700, ax: xPlate, az: zPit + 52, t: ['ANTI-VORTEX PLATE', `${sp.vortexPlateMm} x ${sp.vortexPlateMm} x 10 (GRP / SS 316)`] }
    ];
    for (const it of items) {
      const wTxt = Math.max(...it.t.map((q) => 0.6 * 2.2 * s * q.length));
      it.t.forEach((q, k) => P.text('FP-ANNO', X(xT), Z(it.zz) - k * 3.4 * s, 2.2, q, { align: 'left', vAlign: 'middle' }));
      arrowLine(b, [X(it.ax), Z(it.az)], [X(xT) + wTxt + 1.5 * s, Z(it.zz) - 1.7 * s], s);
    }
  }
  P.block(['FIRE WATER - EFFECTIVE STORAGE', `${(tank.effectiveDepthM * 1000).toFixed(0)} mm EFFECTIVE DEPTH (NFPA 22)`], 2.4, [[X(xL + 3300), Z(zNWL - 1500)], [X(xL + 3300), Z(zNWL - 2500)]]);
  P.setBounds(frameBounds);

  // ───────────────────────── titles & section note ─────────────────────────
  sheetTitle(c, 30, 136, 'SECTION A-A', `SCALE 1:${s}  (THROUGH FP-1 SUCTION CENTRE-LINE, LOOKING NORTH)`);

  // ───────────────────────── right column: level schedule + notes ─────────────────────────
  const x0 = 652;
  const rows: string[][] = [['LEVEL', 'EL (m)', 'DESCRIPTION']];
  const add = (n: string, m: number, d: string): void => {
    rows.push([n, (m >= 0 ? '+' : '-') + Math.abs(m / 1000).toFixed(3), d]);
  };
  add('TANK ROOF', zTR, 'UNDERSIDE OF TANK ROOF SLAB');
  add('TWL', zTWL, 'TOP WATER LEVEL');
  add('OFL', zOFL, 'OVERFLOW INVERT');
  add('NWL', zNWL, 'EFFECTIVE TOP (FULL)');
  add('LWL', zLWL, 'LOW WATER = TANK FLOOR');
  add('SUMP', zPit, 'SUMP PIT FLOOR');
  add('ROOM SOFFIT', zRoof, 'PUMP ROOM CEILING');
  add('HIGH-LEVEL', zHL, 'TEST RETURN PIPE CL');
  add('PUMP CL', zPumpCL, 'SUCTION / DISCHARGE CL');
  add('PAD TOP', zPad, 'HOUSEKEEPING PAD');
  add('FFL', 0, 'PUMP ROOM FINISHED FLOOR');
  const t = drawTable(c, x0, 574, autoCols(rows, 2.4, [26, 18, 60]), rows, { title: 'LEVEL SCHEDULE (m, FFL = +/-0.000)', th: 2.4 });
  const notes = [
    `Suction CL is ${sp.suctionCLBelowTankFloorMm} mm below the tank floor so the pump is flooded at LWL (NFPA 20 4.14.1, NFPA 22).`,
    `Suction pipe turns down inside the ${sp.pitLengthMm} x ${sp.pitWidthMm} x ${sp.pitDepthMm} sump pit; inlet ${sp.inletAboveSumpFloorMm} mm above the pit floor, anti-vortex plate ${sp.vortexPlateMm} mm square (NFPA 22).`,
    'Eccentric reducer installed flat-side up to avoid air pockets; OS&Y gate valve with tamper switch; no butterfly valve on the suction (NFPA 20 4.14.5).',
    'Suction straight run of not less than 10 pipe diameters upstream of the pump flange (NFPA 20 4.14.6).',
    `Puddle flange ${pf1?.tag ?? 'PF-01'} (OD ${pfOd} mm, 10 mm thick, centred in the wall, welded to the pipe) cast into the common wall; no wall sleeve in the water-retaining wall (see FP-110).`
  ];
  drawNotes(c, x0, 574 - t.h - 8, 831 - x0 - 4, 'SECTION NOTES', notes);
}
