/**
 * FP-103 — Fire water tank: plan, Section B-B (across the width) and the enlarged sump pit detail
 * (drawn at 1:10 inside a framed box on a 1:50 sheet), plus tank / connection schedules and material notes.
 */
import { ballValve, northArrow } from './symbols';
import { formatPipeSize } from '../standards/pipeData';
import { type Box, type Ctx, FRAME, Placer, PX, PY, TBLK, arrowLine, autoCols, dimBoxes, drawNotes, drawTable, drawTag, sheetTitle, tableMinX, wrapText } from './sheetKit';
import { odOf, tankLayout, westWallMm } from './sheetGeom';

/** 1:50, or 1:75 / 1:100 for large tanks, so that plan and Section B-B stay inside their zones. */
export function pickTankScale(c: Pick<Ctx, 'r'>): number {
  const t = c.r.tank;
  const tw = t.wallThicknessMm;
  const len = Math.round(t.internalLengthM * 1000) + 2 * tw;
  const wid = Math.round(t.internalWidthM * 1000) + tw + westWallMm(c.r);
  for (const s of [50, 75, 100]) if (len / s <= 305 && wid / s <= 136) return s;
  return 100;
}

export function drawTankSheet(c: Ctx): void {
  const { b, sheet, r } = c;
  const s = sheet.scale;
  const tank = r.tank;
  const sp = tank.sump;
  const el = r.room.elevations;
  const tl = tankLayout(r);
  const wW = westWallMm(r);
  const tw = tl.tw;
  const Wt = Math.round(tank.internalWidthM * 1000);
  const Lt = Math.round(tank.internalLengthM * 1000);
  const z = (m: number): number => Math.round(m * 1000);
  const zTF = z(el.tankFloorM);
  const zTWL = zTF + z(tank.levels.topWaterM);
  const zOFL = zTF + z(tank.levels.overflowM);
  const zNWL = zTF + z(tank.levels.effectiveTopM);
  const zTR = zTF + z(tank.levels.roofSoffitM);
  const tFloor = Math.max(tank.floorThicknessMm, 150);
  const tRoof = Math.max(tank.roofThicknessMm, 150);
  const slab = 250;
  const fullBounds: Box = { x0: PX(c, FRAME.x0 + 1), y0: PY(c, FRAME.y0 + 1), x1: PX(c, FRAME.x1 - 1), y1: PY(c, FRAME.y1 - 1) };
  const P = new Placer(c, fullBounds);
  P.addRect(PX(c, TBLK.x0), PY(c, TBLK.y0), (TBLK.x1 - TBLK.x0) * s, (TBLK.y1 - TBLK.y0) * s);
  const th = 2.5;
  const SH = 55; // vertical shift of the drawing zone (paper mm)
  const nComp = tank.compartments;
  const conn = (name: string): { sizeIn: number; note: string } | undefined => tank.connections.find((q) => q.name.toLowerCase().startsWith(name));
  const fill = conn('fill');
  const ovf = conn('overflow');
  const vent = conn('vent');
  const drain = conn('drain');
  const tret = conn('test return');

  // ═════════════════════════ TANK PLAN ═════════════════════════
  // local coords: x across the width (0 = inner face of the west wall), y along the length (0 = south inner face)
  const OX = PX(c, 74) + tw;
  const OY = PY(c, 112 + SH) + tw;
  const X = (x: number): number => OX + x;
  const Y = (y: number): number => OY + y;
  const wallRect = (x: number, y: number, w: number, h: number): void => {
    b.rect('FP-TANK', X(x), Y(y), w, h);
    P.addRect(X(x), Y(y), w, h);
    if (Math.min(w, h) > 8 * s) b.hatchRect(X(x), Y(y), w, h, 1.6);
  };
  wallRect(-tw, -tw, Wt + tw + wW, tw); // south end wall
  wallRect(-tw, Lt, Wt + tw + wW, tw); // north end wall
  wallRect(-tw, 0, tw, Lt); // west wall
  wallRect(Wt, 0, wW, Lt); // common wall (east)
  tl.dividers.forEach((dv) => wallRect(0, dv.y0 - tl.yLo, Wt, dv.y1 - dv.y0));
  const lc = tl.compLen;
  // compartments
  tl.comps.forEach((cp, i) => {
    const y0 = cp.y0 - tl.yLo;
    const mid = y0 + lc / 2;
    b.rect('FP-WATR', X(120), Y(y0 + 120), Wt - 240, lc - 240);
    // manholes (2 per compartment) with ladder rails in the first
    const mx = Wt * 0.62;
    [y0 + lc * 0.2, y0 + lc * 0.8].forEach((my, k) => {
      b.circle('FP-TANK', X(mx), Y(my), 400);
      b.circle('FP-TANK', X(mx), Y(my), 470);
      P.addRect(X(mx - 470), Y(my - 470), 940, 940);
      if (k === 0) {
        const h = Math.sqrt(400 * 400 - 200 * 200);
        for (const dx of [-200, 200]) b.line('FP-TANK', X(mx + dx), Y(my - h), X(mx + dx), Y(my + h));
        for (let yy = my - h + 90; yy < my + h - 40; yy += 110) b.line('FP-TANK', X(mx - 200), Y(yy), X(mx + 200), Y(yy));
      }
    });
    // vent (roof, near the west wall) and level indicator
    const vOd = odOf(vent?.sizeIn ?? 4);
    const yv = mid + 900;
    b.circle('FP-PIPE-TEST', X(500), Y(yv), vOd / 2);
    b.circle('FP-PIPE-TEST', X(500), Y(yv), vOd / 2 + 60);
    b.line('FP-PIPE-TEST', X(500) - vOd / 2, Y(yv), X(500) + vOd / 2, Y(yv));
    P.addRect(X(500) - vOd / 2 - 60, Y(yv) - vOd / 2 - 60, vOd + 120, vOd + 120);
    b.circle('FP-EQPM', X(1100), Y(mid + 1700), 130);
    b.text('FP-ANNO', X(1100), Y(mid + 1700), 1.8, 'LI', { align: 'center', vAlign: 'middle' });
    P.addRect(X(1100) - 140, Y(mid + 1700) - 140, 280, 280);
    // overflow through the west wall (to indirect waste with air gap)
    const oOd = odOf(ovf?.sizeIn ?? 5);
    const yo = y0 + lc * 0.35;
    b.pipe('FP-PIPE-DRAN', [[X(700), Y(yo)], [X(-tw - 600), Y(yo)]], oOd, false);
    b.circle('FP-PIPE-DRAN', X(700), Y(yo), oOd / 2);
    // fill with float valve through the west wall (above TWL, air gap)
    const fOd = odOf(fill?.sizeIn ?? 4);
    const yf = y0 + lc * 0.78;
    b.pipe('FP-PIPE-SUCT', [[X(1500), Y(yf)], [X(-tw - 600), Y(yf)]], fOd, false);
    ballValve(b, X(1500), Y(yf), 0, Math.max(fOd, 120));
    P.addRect(X(1380), Y(yf) - 150, 240, 300);
    // drain from the sump pit (washout)
    void i;
  });
  // sumps, suction pipes through the common wall, drains
  tl.sumps.forEach((sm, i) => {
    const sy = sm.y - tl.yLo;
    const dOd = odOf(drain?.sizeIn ?? 4);
    b.rect('FP-HIDN', X(Wt - sp.pitLengthMm), Y(sy - sp.pitWidthMm / 2), sp.pitLengthMm, sp.pitWidthMm);
    const pcx = Wt - sp.plateCentreFromWallMm;
    b.rect('FP-HIDN', X(pcx - sp.vortexPlateMm / 2), Y(sy - sp.vortexPlateMm / 2), sp.vortexPlateMm, sp.vortexPlateMm);
    b.pipe('FP-PIPE-SUCT', [[X(Wt + wW), Y(sy)], [X(pcx), Y(sy)]], odOf(sp.suctionPipeIn), true);
    b.circle('FP-PIPE-SUCT', X(pcx), Y(sy), odOf(sp.suctionPipeIn) / 2 + 30);
    P.addRect(X(Wt - sp.pitLengthMm), Y(sy - sp.pitWidthMm / 2), sp.pitLengthMm + wW, sp.pitWidthMm);
    // washout drain: from the pit toward the nearest end wall, then out through the end wall
    const north = sm.comp >= nComp / 2 && nComp > 1;
    const yEnd = north ? Lt + tw : -tw;
    const xd = Wt - sp.pitLengthMm + 200;
    b.pipe('FP-PIPE-DRAN', [[X(xd), Y(sy + ((north ? 1 : -1) * sp.pitWidthMm) / 2)], [X(xd), Y(yEnd)]], dOd, false);
    P.addRect(X(xd) - 100, Y(Math.min(sy, yEnd)), 200, Math.abs(yEnd - sy));
    void i;
  });
  // test return through the common wall (high level, discharges above TWL)
  {
    const yT = r.room.pipes.find((p) => p.id === 'TST-1')?.points[0][1] ?? 600;
    const ty = yT - tl.yLo;
    if (ty > 0 && ty < Lt) {
      const tOd = odOf(tret?.sizeIn ?? 5);
      b.pipe('FP-PIPE-TEST', [[X(Wt + wW), Y(ty)], [X(Wt - 1200), Y(ty)]], tOd, true);
      P.addRect(X(Wt - 1250), Y(ty) - tOd, 1250 + wW, 2 * tOd);
    }
  }
  // section marks
  const yB = tl.comps[0].y0 - tl.yLo + lc / 2 + lc * 0.0;
  const ySec = r.room.suctionLineY[0] - tl.yLo;
  b.sectionMark(X(-tw - 2300), Y(yB + 0), X(Wt + wW + 1300), Y(yB + 0), 'B');
  b.sectionMark(X(-tw - 2300), Y(ySec), X(Wt + wW + 1300), Y(ySec), 'A');
  P.addRect(X(-tw - 2300), Y(yB), Wt + tw + wW + 3600, 16 * s);
  P.addRect(X(-tw - 2300), Y(ySec), Wt + tw + wW + 3600, 16 * s);

  // plan dimensions
  const dimReg: Box[] = [];
  const dim = (x1: number, y1: number, x2: number, y2: number, off: number, t?: string): void => {
    b.dimLinear(X(x1), Y(y1), X(x2), Y(y2), off, t);
    dimReg.push(...dimBoxes(s, X(x1), Y(y1), X(x2), Y(y2), off, t ?? String(Math.round(Math.hypot(x2 - x1, y2 - y1)))));
  };
  dim(0, -tw, Wt, -tw, -10); // internal width (south)
  dim(-tw, -tw, Wt + wW, -tw, -20); // overall width
  // west: compartment chain, internal, external
  let yy = 0;
  tl.comps.forEach((cp, i) => {
    const y1 = cp.y1 - tl.yLo;
    dim(-tw, yy, -tw, y1, 16);
    yy = y1;
    if (i < tl.comps.length - 1) {
      yy += tl.tw;
    }
  });
  dim(-tw, 0, -tw, Lt, 26);
  dim(-tw, -tw, -tw, Lt + tw, 36);

  // plan callouts
  P.addHard({ x0: X(-tw) - 44 * s, y0: Y(-tw) - 24 * s, x1: X(-tw), y1: Y(Lt + tw) + 3 * s });
  P.addRect(X(-tw), Y(-tw) - 24 * s, Wt + tw + wW, 24 * s);
  for (const bx of dimReg) P.addHard(bx);
  P.setBounds({ x0: X(-tw) - 44 * s, y0: Y(-tw) - 40 * s, x1: PX(c, 305), y1: Y(Lt + tw) + 30 * s });
  const compLabels = tl.comps.map((cp, i) => {
    const y0 = cp.y0 - tl.yLo;
    const vol = (lc / 1000) * tank.internalWidthM * tank.effectiveDepthM;
    return { y: y0 + lc / 2, lines: [`COMPARTMENT ${i + 1}`, `${Math.round(lc)} x ${Wt} x ${Math.round(tank.effectiveDepthM * 1000)} EFF.`, `${vol.toFixed(0)} m3 EFFECTIVE`] };
  });
  for (const cl of compLabels) {
    P.block(cl.lines, 2.5, [[X(Wt * 0.5), Y(cl.y - 500)], [X(Wt * 0.5), Y(cl.y + 300)], [X(Wt * 0.5), Y(cl.y - 1200)], [X(Wt * 0.55), Y(cl.y + 1200)]]);
  }
  // callouts for connections
  P.setBounds({ x0: X(-tw) - 44 * s, y0: Y(-tw) - 44 * s, x1: PX(c, 308), y1: Y(Lt + tw) + 30 * s });
  tl.comps.forEach((cp, i) => {
    const y0 = cp.y0 - tl.yLo;
    const mid = y0 + lc / 2;
    const side = i === 0 ? [180, 225, 135] : [180, 135, 225];
    P.setBounds({ x0: X(0), y0: Y(y0), x1: X(Wt), y1: Y(y0 + lc) });
    P.block([`OVERFLOW ${formatPipeSize(ovf?.sizeIn ?? 5)} - INDIRECT`, 'AIR GAP (IPC 802 / UPC 801)'], 2.2, [[X(500), Y(y0 + lc * 0.35 + 330)], [X(500), Y(y0 + lc * 0.35 - 330)], [X(500), Y(y0 + lc * 0.35 + 800)], [X(500), Y(y0 + lc * 0.35 - 800)]], 'left');
    P.block([`FILL ${formatPipeSize(fill?.sizeIn ?? 4)} + FLOAT VALVE`, 'AIR GAP (IPC 608 / UPC 603)'], 2.2, [[X(1000), Y(y0 + lc * 0.78 + 330)], [X(1000), Y(y0 + lc * 0.78 - 330)], [X(1000), Y(y0 + lc * 0.78 + 800)], [X(1000), Y(y0 + lc * 0.78 - 800)]], 'left');
    P.setBounds({ x0: X(-tw) - 44 * s, y0: Y(-tw) - 44 * s, x1: PX(c, 308), y1: Y(Lt + tw) + 30 * s });
    P.callout([X(500), Y(mid + 900)], [`VENT ${formatPipeSize(vent?.sizeIn ?? 4)} + INSECT SCREEN`], 2.2, [90, 135, 45]);
    P.callout([X(1100), Y(mid + 1700)], ['LEVEL INDICATOR', 'LOW / HIGH ALARM'], 2.2, side.map((a) => a - 90).concat([45]));
    P.callout([X(Wt * 0.62), Y(y0 + lc * 0.2 + 400)], ['MANHOLE O800 (2 PER', 'COMPARTMENT) + LADDER'], 2.2, [135, 45, 90]);
  });
  tl.sumps.forEach((sm, i) => {
    const sy = sm.y - tl.yLo;
    P.callout([X(Wt - sp.pitLengthMm / 2), Y(sy)], [`SUMP PIT ${i + 1} ${sp.pitLengthMm} x ${sp.pitWidthMm} x ${sp.pitDepthMm}`, `SUCTION ${formatPipeSize(sp.suctionPipeIn)} TO ${r.pumps.mainPumps[i]?.tag ?? 'FP'}`], 2.2, [135, 180, 225]);
  });
  P.callout([X(Wt + wW), Y(r.room.pipes.find((p) => p.id === 'TST-1')?.points[0][1] ? (r.room.pipes.find((p) => p.id === 'TST-1')?.points[0][1] ?? 600) - tl.yLo : 600)], [`TEST RETURN ${formatPipeSize(tret?.sizeIn ?? 5)}`, 'DISCHARGES ABOVE TWL'], 2.2, [0, 45, 315]);
  P.setBounds(fullBounds);
  northArrow(b, X(Wt + wW) + 22 * s, Y(Lt + tw) - 4 * s);
  sheetTitle(c, 30, 120, 'FIRE WATER TANK - PLAN', `SCALE 1:${s}`);

  // ═════════════════════════ SECTION B-B ═════════════════════════
  {
    const x0p = 314; // paper x of the west outer face
    const bx = (x: number): number => PX(c, x0p) + tw + x;
    const bz = (zz: number): number => PY(c, 138 + SH) + zz;
    const seg = (layer: string, x1: number, z1: number, x2: number, z2: number): void => b.line(layer, bx(x1), bz(z1), bx(x2), bz(z2));
    const conc = (x1: number, z1: number, x2: number, z2: number, layer = 'FP-TANK'): void => {
      b.rect(layer, bx(x1), bz(z1), x2 - x1, z2 - z1);
      if (Math.min(x2 - x1, z2 - z1) > 8 * s) b.hatchRect(bx(x1), bz(z1), x2 - x1, z2 - z1, 1.6);
    };
    const zFound = -slab;
    conc(-tw, zFound, Wt + wW, zTF - tFloor); // plinth
    conc(-tw, zTF - tFloor, Wt, zTF); // floor slab
    conc(-tw, zTF, 0, zTR + tRoof); // west wall
    conc(Wt, zTF - tFloor, Wt + wW, zTR + tRoof); // common wall
    conc(-tw, zTR, Wt + wW, zTR + tRoof); // roof slab
    // sump pit seen beyond the cut (hidden)
    b.rect('FP-HIDN', bx(Wt - sp.pitLengthMm), bz(zTF - sp.pitDepthMm), sp.pitLengthMm, sp.pitDepthMm);
    // water levels
    for (const zz of [zTWL, zOFL, zNWL]) seg('FP-WATR', 0, zz, Wt, zz);
    for (let xx = 400; xx < Wt - 600; xx += 900) {
      seg('FP-WATR', xx, zTWL - 120, xx + 350, zTWL - 120);
      seg('FP-WATR', xx + 200, zTWL - 240, xx + 550, zTWL - 240);
    }
    // manhole neck + cover, ladder
    const mx = Wt * 0.62;
    b.rect('FP-TANK', bx(mx - 470), bz(zTR + tRoof), 940, 180);
    b.rect('FP-TANK', bx(mx - 520), bz(zTR + tRoof + 180), 1040, 50);
    b.line('FP-TANK', bx(mx - 400), bz(zTR), bx(mx - 400), bz(zTR + tRoof));
    b.line('FP-TANK', bx(mx + 400), bz(zTR), bx(mx + 400), bz(zTR + tRoof));
    for (const dx of [-200, 200]) b.line('FP-TANK', bx(mx + dx), bz(zTF), bx(mx + dx), bz(zTR + tRoof + 500));
    for (let zz = zTF + 150; zz < zTR + tRoof + 400; zz += 300) b.line('FP-TANK', bx(mx - 200), bz(zz), bx(mx + 200), bz(zz));
    // vent through the roof (gooseneck)
    const vOd = odOf(vent?.sizeIn ?? 4);
    b.pipe('FP-PIPE-TEST', [[bx(500), bz(zTR - 150)], [bx(500), bz(zTR + tRoof + 700)], [bx(500) + 220, bz(zTR + tRoof + 700)], [bx(500) + 220, bz(zTR + tRoof + 560)]], vOd, false);
    // overflow through the west wall at the overflow level
    const oOd = odOf(ovf?.sizeIn ?? 5);
    b.pipe('FP-PIPE-DRAN', [[bx(300), bz(zOFL - oOd / 2)], [bx(-tw - 900), bz(zOFL - oOd / 2)]], oOd, false);
    // fill pipe above TWL with air gap (float valve)
    const fOd = odOf(fill?.sizeIn ?? 4);
    const zFill = zTWL + 160;
    b.pipe('FP-PIPE-SUCT', [[bx(-tw - 900), bz(zFill)], [bx(1100), bz(zFill)], [bx(1100), bz(zFill - 260)]], fOd, false);
    ballValve(b, bx(-tw - 450), bz(zFill), 0, Math.max(fOd, 120));
    // test return high above the pit
    // dimensions
    const dh = (x1: number, x2: number, zz: number, off: number, t?: string): void => b.dimLinear(bx(x1), bz(zz), bx(x2), bz(zz), off, t);
    const dv = (xx: number, z1: number, z2: number, off: number, t?: string): void => b.dimLinear(bx(xx), bz(z1), bx(xx), bz(z2), off, t);
    dh(0, Wt, zFound, -9);
    dh(-tw, Wt + wW, zFound, -18);
    dv(Wt + wW, zTF, zTR, -9);
    dv(Wt + wW, zFound, zTR + tRoof, -18);
    dv(0, zTF, zTWL, 14, String(Math.round(tank.levels.topWaterM * 1000)));
    // level marks (left): TWL and LWL as marks, the 100 mm steps in between as a note
    const xm = -tw - 38 * s;
    for (const [zz, lab] of [[zTR, 'ROOF'], [zTWL, 'TWL'], [zTF, 'LWL']] as [number, string][]) {
      b.levelMark(bx(xm), bz(zz), zz / 1000, lab);
      seg('FP-LEVL', xm + 14 * s, zz, 0, zz);
    }
    b.text('FP-ANNO', bx(xm) - 2 * s, bz(zNWL - 450), 2.2, `OFL +${(zOFL / 1000).toFixed(3)}`, { align: 'left', vAlign: 'middle' });
    b.text('FP-ANNO', bx(xm) - 2 * s, bz(zNWL - 450) - 3.4 * s, 2.2, `NWL +${(zNWL / 1000).toFixed(3)}`, { align: 'left', vAlign: 'middle' });
    // callouts
    const pb = new Placer(c, { x0: bx(xm) - 4 * s, y0: bz(zFound) - 28 * s, x1: PX(c, 482), y1: bz(zTR + tRoof) + 28 * s });
    pb.addRect(bx(-tw), bz(zFound), Wt + tw + wW, zTR + tRoof - zFound + 700);
    pb.addRect(bx(xm) - 4 * s, bz(zFound) - 20 * s, 44 * s + 0, zTR + tRoof - zFound + 40 * s);
    pb.addRect(bx(-tw), bz(zFound) - 22 * s, Wt + tw + wW + 24 * s, 22 * s);
    pb.addRect(bx(Wt + wW), bz(zFound), 24 * s, zTR + tRoof - zFound + 100);
    pb.setBounds({ x0: bx(0) + 2 * s, y0: bz(zTF) + 6 * s, x1: bx(Wt) - 2 * s, y1: bz(zNWL) - 6 * s });
    pb.block(['FIRE WATER', `${(tank.effectiveDepthM * 1000).toFixed(0)} EFFECTIVE DEPTH`], 2.2, [[bx(Wt * 0.62), bz(zTF + 1900)], [bx(Wt * 0.62), bz(zTF + 1300)]]);
    sheetTitle(c, x0p, 120, 'SECTION B-B', `SCALE 1:${s}  (ACROSS TANK WIDTH, LOOKING NORTH)`);
    // callout texts around the section drawn via leaders
    const lbl = (x: number, zz: number, lines: string[], ang: number[]): void => {
      pb.setBounds({ x0: PX(c, 330), y0: PY(c, 90 + SH), x1: PX(c, 482), y1: PY(c, 330 + SH) });
      pb.callout([bx(x), bz(zz)], lines, 2.2, ang);
    };
    lbl(500, zTR + tRoof + 700, ['VENT + INSECT', 'SCREEN'], [90, 45, 135]);
    lbl(mx, zTR + tRoof + 400, ['MANHOLE O800 +', 'GALV. LADDER'], [90, 135, 45]);
    lbl(-tw - 600, zOFL - oOd / 2, [`OVERFLOW ${formatPipeSize(ovf?.sizeIn ?? 5)}`], [180, 225, 135]);
    lbl(-tw - 450, zFill, [`FILL ${formatPipeSize(fill?.sizeIn ?? 4)} + FLOAT VALVE`], [90, 135, 45]);
  }

  // ═════════════════════════ SUMP PIT DETAIL (1:10) ═════════════════════════
  {
    const bxL = 486;
    const byB = 78 + SH;
    const bw = 340;
    const bh = 330;
    const f = s / 10; // enlargement factor relative to the sheet scale
    b.rect('FP-ANNO', PX(c, bxL), PY(c, byB), bw * s, bh * s);
    b.text('FP-ANNO', PX(c, bxL + 5), PY(c, byB + bh - 6), 5, 'SUMP PIT DETAIL - SCALE 1:10', { vAlign: 'middle' });
    b.line('FP-ANNO', PX(c, bxL), PY(c, byB + bh - 12), PX(c, bxL + bw), PY(c, byB + bh - 12));
    // section view: x = 0 at the inner face of the common wall, z = 0 at the pit floor
    const ox = PX(c, bxL + 158);
    const oz = PY(c, byB + 190);
    const dx = (x: number): number => ox + x * f;
    const dz = (zz: number): number => oz + zz * f;
    const dd = sp.pitDepthMm;
    const pL = sp.pitLengthMm;
    const wall = 300;
    const slabT = tFloor;
    const drc = (x1: number, z1: number, x2: number, z2: number): void => {
      b.rect('FP-TANK', dx(x1), dz(z1), (x2 - x1) * f, (z2 - z1) * f);
      b.hatchRect(dx(x1), dz(z1), (x2 - x1) * f, (z2 - z1) * f, 1.6);
    };
    b.text('FP-ANNO', PX(c, bxL + 5), PY(c, byB + bh - 20), 3.5, 'SECTION THROUGH SUCTION CENTRE-LINE', { vAlign: 'middle' });
    drc(0, -slabT, wall, dd + 300); // common wall
    drc(-pL, -slabT, 0, 0); // pit slab
    drc(-pL - wall, -slabT, -pL, dd); // pit west wall
    drc(-pL - wall - 250, dd - slabT, -pL - wall, dd); // raft stub
    b.line('FP-TANK', dx(-pL - wall - 250), dz(dd - slabT - 60), dx(-pL - wall - 250), dz(dd + 60));
    b.line('FP-WATR', dx(-pL - wall - 250), dz(dd + 200), dx(0), dz(dd + 200));
    b.text('FP-ANNO', dx(-pL - wall - 200), dz(dd + 200) + 1 * s, 2.2, 'LWL = TANK FLOOR + 0', { vAlign: 'bottom' });
    const zCL = dd - sp.suctionCLBelowTankFloorMm;
    const od = sp.suctionPipeOdMm;
    const xP = -sp.plateCentreFromWallMm;
    b.pipe('FP-PIPE-SUCT', [[dx(wall), dz(zCL)], [dx(xP), dz(zCL)], [dx(xP), dz(sp.inletAboveSumpFloorMm)]], od * f, true);
    b.line('FP-WALL', dx(0), dz(zCL + od / 2 + 35), dx(wall), dz(zCL + od / 2 + 35));
    b.line('FP-WALL', dx(0), dz(zCL - od / 2 - 35), dx(wall), dz(zCL - od / 2 - 35));
    b.rect('FP-WALL', dx(wall / 2 - 8), dz(zCL - od / 2 - 90), 16 * f, (od + 180) * f);
    const pl = sp.vortexPlateMm;
    b.rect('FP-TANK', dx(xP - pl / 2), dz(40), pl * f, 12 * f);
    for (const q of [-pl / 2 + 40, pl / 2 - 40]) b.line('FP-TANK', dx(xP + q), dz(0), dx(xP + q), dz(40));
    // dimensions carry the TRUE values (override text) because the detail is drawn at 1:10
    const dimv = (x: number, z1: number, z2: number, off: number, t: string): void => b.dimLinear(dx(x), dz(z1), dx(x), dz(z2), off, t);
    const dimh = (x1: number, x2: number, zz: number, off: number, t: string): void => b.dimLinear(dx(x1), dz(zz), dx(x2), dz(zz), off, t);
    dimv(-pL - wall, 0, dd, 9, String(sp.pitDepthMm));
    dimv(xP + pl / 2 + 200, 0, sp.inletAboveSumpFloorMm, -9, String(sp.inletAboveSumpFloorMm));
    dimh(xP - pl / 2, xP + pl / 2, -slabT, -9, String(sp.vortexPlateMm));
    dimh(-pL, 0, -slabT, -18, String(sp.pitLengthMm));
    dimh(xP, 0, zCL + od / 2 + 250, 8, String(sp.plateCentreFromWallMm));
    dimv(xP - od / 2 - 40, zCL - od / 2, zCL + od / 2, 8, `D=${Math.round(od)}`);
    dimv(wall + 100, zCL, dd, -8, String(sp.suctionCLBelowTankFloorMm));
    // notes beside the section (right part of the box)
    const nx = bxL + 226;
    const lines: string[] = [];
    lines.push('(1) ANTI-VORTEX PLATE', `    ${pl} x ${pl} x 10 THK, GRP / SS 316 ON LEGS`, '');
    lines.push('(2) SUCTION ELBOW TURNED DOWN', `    OPEN END ${sp.inletAboveSumpFloorMm} ABOVE SUMP FLOOR`, '');
    lines.push('(3) WALL SLEEVE + PUDDLE FLANGE', '    (WATERTIGHT PENETRATION)', '');
    lines.push(`D = ${formatPipeSize(sp.suctionPipeIn)} SUCTION PIPE (OD ${Math.round(od)})`);
    let yy = byB + bh - 30;
    for (const t of lines) {
      if (t) b.text('FP-ANNO', PX(c, nx), PY(c, yy), 2.5, t, { vAlign: 'middle' });
      yy -= 4.2;
    }
    // numbered tags with leaders to the parts
    const callTag = (n: string, tx: number, tz: number, ax: number, az: number): void => {
      arrowLine(b, [dx(ax), dz(az)], [dx(tx), dz(tz)], s);
      drawTag(b, dx(tx), dz(tz), n, s);
    };
    callTag('1', xP - 560, 250, xP - pl / 2 + 40, 52);
    callTag('2', xP - 560, 620, xP - od / 2, 520);
    callTag('3', -230, 930, wall / 2, zCL + od / 2 + 35);
    // plan of the pit (lower part of the box)
    const pox = PX(c, bxL + 170);
    const poy = PY(c, byB + 62);
    const px = (x: number): number => pox + x * f;
    const py = (y: number): number => poy + y * f;
    b.text('FP-ANNO', PX(c, bxL + 5), PY(c, byB + 108), 3.5, 'PLAN OF SUMP PIT', { vAlign: 'middle' });
    b.rect('FP-TANK', px(-pL), py(-sp.pitWidthMm / 2), pL * f, sp.pitWidthMm * f);
    b.rect('FP-TANK', px(0), py(-sp.pitWidthMm / 2), wall * f, sp.pitWidthMm * f);
    b.hatchRect(px(0), py(-sp.pitWidthMm / 2), wall * f, sp.pitWidthMm * f, 1.6);
    b.rect('FP-TANK', px(xP - pl / 2), py(-pl / 2), pl * f, pl * f);
    b.line('FP-TANK', px(xP - pl / 2), py(-pl / 2), px(xP + pl / 2), py(pl / 2));
    b.line('FP-TANK', px(xP - pl / 2), py(pl / 2), px(xP + pl / 2), py(-pl / 2));
    b.pipe('FP-PIPE-SUCT', [[px(wall), py(0)], [px(xP), py(0)]], od * f, true);
    b.circle('FP-PIPE-SUCT', px(xP), py(0), (od / 2) * f);
    b.circle('FP-PIPE-SUCT', px(xP), py(0), (od / 2 - 8) * f);
    const dpv = (x: number, y1: number, y2: number, off: number, t: string): void => b.dimLinear(px(x), py(y1), px(x), py(y2), off, t);
    const dph = (x1: number, x2: number, y: number, off: number, t: string): void => b.dimLinear(px(x1), py(y), px(x2), py(y), off, t);
    dph(-pL, 0, -sp.pitWidthMm / 2, -9, String(sp.pitLengthMm));
    dpv(-pL, -sp.pitWidthMm / 2, sp.pitWidthMm / 2, 9, String(sp.pitWidthMm));
    dph(xP - pl / 2, xP + pl / 2, pl / 2, 6, String(sp.vortexPlateMm));
    dph(xP, wall, -pl / 2 - 120, -4, String(sp.plateCentreFromWallMm + wall));
    const spec = [
      `Pit ${sp.pitLengthMm} x ${sp.pitWidthMm} x ${sp.pitDepthMm} mm deep; pit floor falls to the washout drain.`,
      `Plate ${sp.vortexPlateMm} mm (>= 2 x D); inlet ${sp.inletAboveSumpFloorMm} mm above the pit floor (>= D/2).`,
      'NFPA 22 Ch. 14 / NFPA 20 4.14.3: inlet submerged with anti-vortex plate below.'
    ];
    let y3 = byB + 70;
    for (const t of spec) {
      for (const ln of wrapText(t, 58)) {
        b.text('FP-ANNO', PX(c, bxL + 215), PY(c, y3), 2.5, ln, { vAlign: 'middle' });
        y3 -= 4.2;
      }
      y3 -= 1.5;
    }
  }

  // ═════════════════════════ SCHEDULES (top) ═════════════════════════
  {
    const y0 = 574;
    const tankRows: string[][] = [
      ['ITEM', 'VALUE'],
      ['Material', tank.material.replace(/-/g, ' ').toUpperCase()],
      ['Placement', tank.placement.toUpperCase()],
      ['Compartments', String(nComp)],
      ['Internal size (L x W)', `${tank.internalLengthM.toFixed(2)} x ${tank.internalWidthM.toFixed(2)} m`],
      ['Effective depth', `${tank.effectiveDepthM.toFixed(2)} m`],
      ['Provided effective', `${tank.providedEffectiveM3.toFixed(1)} m3`],
      ['Required (NFPA 13/22)', `${tank.requiredEffectiveM3.toFixed(1)} m3 (${Math.round(tank.requiredEffectiveGal)} gal)`],
      ['Freeboard', `${(tank.freeboardM * 1000).toFixed(0)} mm`],
      ['Wall / floor / roof', `${tank.wallThicknessMm} / ${tank.floorThicknessMm} / ${tank.roofThicknessMm} mm`],
      ['Refill time', `${tank.refillHours.toFixed(1)} h (<= 8 h, NFPA 22)`]
    ];
    const xT = Math.max(30, tableMinX(autoCols(tankRows, th, [46, 46]), tankRows, th));
    const t1 = drawTable(c, xT, y0, autoCols(tankRows, th, [46, 46]), tankRows, { title: 'TANK SCHEDULE', th });
    const x2 = xT + autoCols(tankRows, th, [46, 46]).reduce((a, v) => a + v, 0) + 8;
    const connRows: string[][] = [['CONNECTION', 'SIZE', 'NOTE']];
    for (const q of tank.connections) connRows.push([q.name, q.sizeIn > 0 ? formatPipeSize(q.sizeIn) : '-', wrapText(q.note, 52).join('\n')]);
    const cc = autoCols(connRows, th, [34, 18, 80]);
    const t2 = drawTable(c, x2, y0, cc, connRows, { title: 'CONNECTION SCHEDULE', th });
    const x3 = x2 + cc.reduce((a, v) => a + v, 0) + 8;
    void t1;
    void t2;
    const matNotes = [...tank.materialSpec, 'Interior surfaces suitable for potable / fire water (WRAS / NSF 61 where required). Tank to be tested watertight before commissioning.', 'Tank to be isolated from the pump room by the common wall; suction penetrations with sleeve and puddle flange.'];
    drawNotes(c, x3, y0, 831 - x3 - 6, 'MATERIAL SPECIFICATION & NOTES', matNotes);
  }
}
