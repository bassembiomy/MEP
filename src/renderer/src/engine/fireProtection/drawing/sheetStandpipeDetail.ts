/**
 * FP-107 — Standpipe floor connection SIDE VIEW (1:20), fire department connection ELEVATION,
 * FLOOR SCHEDULE (every standpipe x floor), governing-riser hydraulic node table and notes.
 * All dimensioned views are drawn at the sheet scale (1:20, model millimetres).
 */
import type { FloorLevel } from '../fpTypes';
import { formatPipeSize } from '../standards/pipeData';
import { ballValve, butterflyValve, checkValve, hoseValve, pressureGauge } from './symbols';
import {
  type Ctx,
  FRAME,
  Placer,
  PX,
  PY,
  arrowLine,
  autoCols,
  dimBoxes,
  drawNotes,
  drawTable,
  measureTable,
  sheetTitle,
  splitInterval,
  tableMinX,
  textWidth,
  wrapText
} from './sheetKit';
import { odOf } from './sheetGeom';
import { drawStandpipeLegend, prvSymbol, psi } from './sheetStandpipe';

type Pt = [number, number];
const fmtSize = (n: number): string => formatPipeSize(n);
const lvl = (m: number): string => (Math.abs(m) < 0.0005 ? '%%p0.000' : `${m > 0 ? '+' : '-'}${Math.abs(m).toFixed(3)}`);

/** Typical floor-to-floor height (most frequent among non-roof floors) and the first floor having it. */
function typicalFloor(floors: FloorLevel[]): FloorLevel {
  const occ = floors.filter((f) => !f.isRoof && f.floorToFloorM > 0);
  const count = new Map<number, number>();
  for (const f of occ) count.set(f.floorToFloorM, (count.get(f.floorToFloorM) ?? 0) + 1);
  let best = occ[0];
  let n = 0;
  for (const f of occ) {
    const k = count.get(f.floorToFloorM) ?? 0;
    if (k > n) {
      n = k;
      best = f;
    }
  }
  return best ?? floors[0];
}

/** Notes of the standpipe sheet (>= 8, each citing its clause). */
export function standpipeNotes(c: Ctx): string[] {
  const sp = c.r.standpipe!;
  const inp = c.r.input;
  const hv = sp.hoseValveHeightMm;
  const maxStatic = Math.max(...sp.risers.flatMap((q) => q.outlets.map((o) => o.staticPsi)));
  const comp = inp.systemComponentRatingPsi;
  return [
    `HOSE CONNECTIONS: 2-1/2" ANGLE HOSE VALVES AT EVERY FLOOR LEVEL LANDING OF EACH REQUIRED EXIT STAIR (NFPA 14 SEC. 7.3.2.1); ROOF CONNECTION WHERE THE ROOF SLOPE IS LESS THAN 4 IN 12, AT THE STAIR WITH ROOF ACCESS (SEC. 7.3.2.2).`,
    `HOSE VALVE CENTRE-LINE ${hv} MM ABOVE THE FLOOR; PERMITTED RANGE 900-1500 MM (3 FT TO 5 FT), NFPA 14 SEC. 7.3.1.1. OUTLET WITH CAP AND CHAIN, HANDWHEEL CLEAR OF WALL AND RISER.`,
    `RISER SIZE ${fmtSize(sp.riserSizeIn)} (MINIMUM ${fmtSize(sp.minRiserSizeIn)}: 4" CLASS I/III, 6" WHEN COMBINED WITH SPRINKLERS, NFPA 14 SEC. 7.6). MAXIMUM PRESSURE ${psi(maxStatic)} PSI AGAINST THE 350 PSI LIMIT (SEC. 7.2.1) AND THE ${comp} PSI COMPONENT RATING.`,
    `DEMAND: 500 GPM AT THE FIRST STANDPIPE (250 GPM AT EACH OF THE TWO TOPMOST OUTLETS) PLUS 250 GPM FOR EACH ADDITIONAL STANDPIPE, TOTAL ${sp.demandFlowGpm} GPM; ${psi(sp.topOutletResidualPsi)} PSI RESIDUAL AT THE TOPMOST OUTLET OF THE HYDRAULICALLY MOST REMOTE STANDPIPE (SEC. 7.10.1.1 AND 7.8.1).`,
    `PRESSURE-REGULATING DEVICES: 2-1/2" OUTLETS WHERE THE STATIC PRESSURE EXCEEDS 175 PSI ARE LIMITED TO 175 PSI; 1-1/2" OUTLETS TO 100 PSI (SEC. 7.2.3). SETTINGS ARE LISTED IN THE FLOOR SCHEDULE.`,
    `DRAINS: ${sp.drainRiserIn ? `${fmtSize(sp.drainRiserIn)} DRAIN RISER ADJACENT TO EACH STANDPIPE WITH PRVs, ` : ''}${fmtSize(sp.mainDrainIn)} MAIN DRAIN AT THE BASE DISCHARGING TO AN APPROVED LOCATION (NFPA 14 SEC. 7.11).`,
    `FIRE DEPARTMENT CONNECTION: ${sp.fdc.inlets} x 2-1/2" INLETS (ONE PER 250 GPM, MINIMUM 2), ${fmtSize(sp.fdc.pipeSizeIn)} PIPE, 18-48 IN ABOVE GRADE, CHECK VALVE AND AUTOMATIC BALL DRIP, SIGN "STANDPIPE" (NFPA 14 SEC. 6.4 AND 7.12). HYDRANT WITHIN 100 FT: ${sp.fdc.distanceToHydrantM.toFixed(1)} M PROVIDED (IFC SEC. 912).`,
    sp.combined
      ? `COMBINED SYSTEM: EACH SPRINKLERED FLOOR HAS A FLOOR CONTROL VALVE ASSEMBLY WITH SUPERVISED VALVE, WATERFLOW SWITCH, PRESSURE GAUGE AND TEST & DRAIN (NFPA 13 SEC. 16.9.4). SPRINKLER DEMAND IS NOT ADDED IN A FULLY SPRINKLERED BUILDING (NFPA 14 SEC. 7.10.1.3).`
      : 'STANDPIPES ARE INDEPENDENT OF THE FLOOR SPRINKLER SYSTEMS (NFPA 14 SEC. 3.3.20).',
    `STANDPIPE REQUIRED BY IBC SEC. 905 (CLASS ${sp.standpipeClass}); BUILDING HEIGHT ${sp.buildingHeightFt.toFixed(0)} FT ABOVE FIRE DEPARTMENT ACCESS${sp.highRise ? ' - HIGH-RISE (IBC SEC. 202), 2-HOUR PUMP ROOM (IBC SEC. 913.2.1)' : ''}.`,
    'HYDRAULICS: HAZEN-WILLIAMS; ANGLE HOSE VALVE EQUIVALENT LENGTH 150 x ID/12 (CRANE TP-410, L/D = 150). STATIC = CHURN PRESSURE PLUS MAXIMUM STATIC SUCTION; RESIDUAL AT DEMAND FLOW.',
    'PIPE PENETRATIONS OF FIRE-RATED SLABS AND WALLS ARE SLEEVED AND FIRESTOPPED (IBC SEC. 714). PIPING SUPPORTED AND BRACED PER NFPA 13 CHAPTER 9; RISERS RESTRAINED AT EVERY FLOOR.'
  ];
}

export function drawStandpipeDetailSheet(c: Ctx): void {
  const { b, sheet, r } = c;
  const S = sheet.scale; // 20: all views at 1:20
  const sp = r.standpipe!;
  const floors = r.input.building!.floors;
  const hv = sp.hoseValveHeightMm;
  const typ = typicalFloor(floors);
  const ftf = Math.round(typ.floorToFloorM * 1000);
  const riser = sp.risers.find((q) => q.tag === sp.governingRiserTag) ?? sp.risers[0];
  const odR = odOf(riser.sizeIn);
  const odB = odOf(2.5);
  const odF = odOf(Math.min(4, riser.sizeIn));
  const odD = odOf(sp.drainRiserIn ?? sp.mainDrainIn);
  const prvO = sp.risers.flatMap((q) => q.outlets).find((o) => o.prvRequired);
  const prvSet = prvO?.prvSetPsi ?? 175;
  const fcvY = Math.min(2300, Math.max(1500, ftf - 1300));


  // ───────────────────────── (a) TYPICAL FLOOR CONNECTION - SIDE VIEW ─────────────────────────
  const OX = PX(c, 215);
  const OY = PY(c, 292);
  const T = (x: number, y: number): Pt => [OX + x, OY + y];
  const SV = new Placer(c, { x0: PX(c, 24), y0: PY(c, 232), x1: PX(c, 494), y1: PY(c, 531) });
  const reg = (x0: number, y0: number, x1: number, y1: number, soft = false): void => {
    const a = T(x0, y0);
    const z = T(x1, y1);
    SV.addRect(a[0], a[1], z[0] - a[0], z[1] - a[1], soft);
  };
  const ln = (layer: string, x1: number, y1: number, x2: number, y2: number): void => {
    const a = T(x1, y1);
    const z = T(x2, y2);
    b.line(layer, a[0], a[1], z[0], z[1]);
  };
  const poly = (layer: string, pts: Pt[], closed = false): void => b.polyline(layer, pts.map(([x, y]) => T(x, y)), closed);
  const slabRect = (x0: number, y0: number, x1: number, y1: number, holes: [number, number][] = []): void => {
    for (const [a, z] of splitInterval(x0, x1, holes)) {
      const p = T(a, y0);
      b.rect('FP-WALL', p[0], p[1], z - a, y1 - y0);
      b.hatchRect(p[0], p[1], z - a, y1 - y0, 1.8);
    }
    reg(x0, y0, x1, y1);
  };
  const xL = -2400;
  const xR = 900;
  const sleeveR = odR / 2 + 75;
  const slabT = 200;
  const xWall0 = 260;
  const xWall1 = 520;
  const xDrain = -2200;

  // slabs (lower slab carries the floor FFL at y = 0)
  slabRect(xL, -slabT, xR, 0, [[-sleeveR, sleeveR], [xDrain - 110, xDrain + 110]]);
  slabRect(xL, ftf, xR, ftf + slabT, [[-sleeveR, sleeveR], [xDrain - 110, xDrain + 110]]);
  // stair enclosure wall between the slabs
  {
    const p = T(xWall0, 0);
    b.rect('FP-WALL', p[0], p[1], xWall1 - xWall0, ftf);
    b.hatchRect(p[0], p[1], xWall1 - xWall0, ftf, 1.8);
    reg(xWall0, 0, xWall1, ftf);
  }
  // sleeves through both slabs (50 mm above the slab, firestopped annulus)
  for (const y0 of [0, ftf]) {
    for (const sg of [-1, 1]) ln('FP-WALL', sg * sleeveR, y0 - slabT, sg * sleeveR, y0 + 50);
    for (const sg of [-1, 1]) ln('FP-WALL', sg * (sleeveR - 25), y0 - slabT, sg * (sleeveR - 25), y0 + 50);
    for (let k = 0; k < 4; k++) {
      ln('FP-WALL-HTCH', -sleeveR + 25, y0 - slabT + 40 + k * 40, -odR / 2, y0 - slabT + 80 + k * 40);
      ln('FP-WALL-HTCH', odR / 2, y0 - slabT + 40 + k * 40, sleeveR - 25, y0 - slabT + 80 + k * 40);
    }
  }
  // FFL line extended to the left, level marks
  {
    const p = T(xL - 560, 0);
    b.levelMark(p[0], p[1], typ.elevationM, 'FFL');
    const q = T(xL - 560, ftf);
    b.levelMark(q[0], q[1], typ.elevationM + typ.floorToFloorM, 'FFL ABOVE');
    reg(xL - 900, -100, xL - 100, 300);
    reg(xL - 900, ftf - 100, xL - 100, ftf + 300);
  }

  // riser pipe with breaks, tees at the hose valve and the floor control branch
  const yLo = -800;
  const yHi = ftf + 800;
  const holesL: [number, number][] = [[hv - odB / 2, hv + odB / 2], [fcvY - odF / 2, fcvY + odF / 2]];
  for (const [a, z] of splitInterval(yLo, yHi, holesL)) ln('FP-PIPE-DISC', -odR / 2, a, -odR / 2, z);
  ln('FP-PIPE-DISC', odR / 2, yLo, odR / 2, yHi);
  const brk = (y: number): void => {
    const w = odR * 0.7;
    poly('FP-ANNO', [[-w, y], [-w * 0.35, y + 70], [w * 0.35, y - 70], [w, y]]);
  };
  brk(yLo);
  brk(yHi);
  reg(-odR / 2 - 20, yLo - 80, odR / 2 + 20, yHi + 80, true);

  // support clamp at the wall
  {
    const yc = Math.round(ftf * 0.86);
    const a = T(odR / 2, yc - 60);
    b.rect('FP-EQPM', a[0], a[1], xWall0 - odR / 2, 120);
    const q = T(-odR / 2 - 45, yc - 110);
    b.rect('FP-EQPM', q[0], q[1], odR + 90, 220);
    reg(-odR / 2 - 45, yc - 110, xWall0, yc + 110, true);
  }

  // hose valve branch: tee - PRV - angle hose valve with cap and chain
  const xPRV = -430;
  const dP = 300;
  const xHV = -900;
  const dH = 280;
  const hp = (xa: number, xb: number, y: number, od: number, layer = 'FP-PIPE-DISC'): void => {
    ln(layer, xa, y + od / 2, xb, y + od / 2);
    ln(layer, xa, y - od / 2, xb, y - od / 2);
  };
  hp(-odR / 2, xPRV + dP / 2, hv, odB);
  hp(xPRV - dP / 2, xHV + dH / 2, hv, odB);
  {
    const p = T(xPRV, hv);
    prvSymbol(b, p[0], p[1], dP);
    const h = T(xHV, hv);
    hoseValve(b, h[0], h[1], 180, dH);
    // chain from the cap to the valve body
    const cap = T(xHV, hv - 0.95 * dH);
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      b.circle('FP-VALV', cap[0] + t * 190, cap[1] - 30 - 70 * Math.sin(Math.PI * t) + t * 70, 16);
    }
    reg(xPRV - dP / 2, hv - 0.3 * dP, xPRV + dP / 2, hv + 0.95 * dP);
    reg(xHV - 0.3 * dH, hv - 1.1 * dH, xHV + 0.5 * dH, hv + 0.75 * dH);
  }
  // branch centre-lines through the riser (reference for the dimensions)
  ln('FP-CNTR', xHV, hv, 700, hv);
  ln('FP-CNTR', -1650, fcvY, 700, fcvY);

  // floor control valve assembly: tee - butterfly valve - waterflow switch - gauge - test & drain tee - to sprinklers
  const xBV = -470;
  const dB = 300;
  const xFS = -820;
  const xPG = -1110;
  const xTD = -1350;
  const xEnd = -1650;
  hp(-odR / 2, xBV + dB / 2, fcvY, odF);
  hp(xBV - dB / 2, xEnd, fcvY, odF);
  {
    const p = T(xBV, fcvY);
    butterflyValve(b, p[0], p[1], 0, dB);
    reg(xBV - dB / 2, fcvY - 0.3 * dB, xBV + dB / 2, fcvY + 0.8 * dB);
    // waterflow switch on a stem
    ln('FP-VALV', xFS, fcvY + odF / 2, xFS, fcvY + 160);
    const f0 = T(xFS - 150, fcvY + 160);
    b.rect('FP-VALV', f0[0], f0[1], 300, 190);
    const ft = T(xFS, fcvY + 255);
    b.text('FP-VALV', ft[0], ft[1], 2.5, 'FS', { align: 'center', vAlign: 'middle' });
    reg(xFS - 150, fcvY, xFS + 150, fcvY + 350);
    // pressure gauge
    ln('FP-VALV', xPG, fcvY + odF / 2, xPG, fcvY + odF / 2 + 20);
    const g = T(xPG, fcvY + odF / 2 - 20);
    pressureGauge(b, g[0], g[1], 0, 260);
    reg(xPG - 110, fcvY, xPG + 110, fcvY + 420);
    // test & drain: ball valve, sight glass, to the drain riser
    const yS = 1450;
    ln('FP-PIPE-DRAN', xTD - 30, fcvY - odF / 2, xTD - 30, yS);
    ln('FP-PIPE-DRAN', xTD + 30, fcvY - odF / 2, xTD + 30, yS - 60);
    const v = T(xTD, fcvY - 350);
    ballValve(b, v[0], v[1], 270, 260);
    const sg = T(xTD, fcvY - 650);
    b.circle('FP-VALV', sg[0], sg[1], 85);
    b.line('FP-VALV', sg[0] - 85, sg[1], sg[0] + 85, sg[1]);
    ln('FP-PIPE-DRAN', xTD - 30, yS, xDrain, yS);
    ln('FP-PIPE-DRAN', xTD + 30, yS - 60, xDrain, yS - 60);
    reg(xTD - 150, yS - 80, xTD + 150, fcvY - odF / 2, true);
    reg(xDrain, yS - 80, xTD, yS, true);
    // stub to the floor sprinklers
    const a0 = T(xEnd - 330, fcvY);
    const a1 = T(xEnd, fcvY);
    arrowLine(b, [a0[0], a0[1]], [a1[0], a1[1]], S);
    SV.text('FP-ANNO', OX + xEnd - 330, OY + fcvY + 190, 2.5, 'TO FLOOR SPRINKLERS', { align: 'left', vAlign: 'middle' });
    // assembly outline + title
    const bx = T(-1700, 1560);
    b.polyline('FP-CNTR', [[bx[0], bx[1]], [bx[0] + 1490, bx[1]], [bx[0] + 1490, bx[1] + fcvY + 520 - 1560], [bx[0], bx[1] + fcvY + 520 - 1560]], true);
    SV.text('FP-ANNO', OX - 950, OY + fcvY + 740, 2.5, 'FLOOR CONTROL VALVE ASSEMBLY', { align: 'center', vAlign: 'middle' });
    SV.text('FP-ANNO', OX - 950, OY + fcvY + 740 + 2.5 * S * 1.5, 2.2, '(COMBINED SYSTEMS - NFPA 13 SEC. 16.9.4)', { align: 'center', vAlign: 'middle' });
  }
  // drain riser (dashed, true OD) with breaks
  {
    const top = 1450 + 60;
    const pts: Pt[] = [[xDrain, top], [xDrain, yLo]];
    const a = pts.map(([x, y]) => T(x, y));
    b.pipe('FP-PIPE-DRAN', a, odD, false);
    const w = odD * 1.0;
    poly('FP-ANNO', [[xDrain - w, yLo], [xDrain - w * 0.3, yLo + 70], [xDrain + w * 0.3, yLo - 70], [xDrain + w, yLo]]);
    reg(xDrain - 150, yLo - 80, xDrain + 150, top, true);
  }

  // dimensions (right-hand chain on the branch centre-lines)
  {
    const dx = 620;
    const p0 = T(dx, 0);
    const pH = T(dx, hv);
    const pF = T(dx, fcvY);
    const pT = T(dx, ftf);
    const chain: [Pt, Pt][] = [[p0, pH], [pH, pF], [pF, pT]];
    for (const [a, z] of chain) {
      b.dimLinear(a[0], a[1], z[0], z[1], -12);
      for (const bx of dimBoxes(S, a[0], a[1], z[0], z[1], -12, String(Math.round(z[1] - a[1])))) SV.addHard(bx);
    }
    b.dimLinear(p0[0], p0[1], pT[0], pT[1], -26);
    for (const bx of dimBoxes(S, p0[0], p0[1], pT[0], pT[1], -26, String(ftf))) SV.addHard(bx);
    const s0 = T(dx, -slabT);
    b.dimLinear(s0[0], s0[1], p0[0], p0[1], -12);
    for (const bx of dimBoxes(S, s0[0], s0[1], p0[0], p0[1], -12, String(slabT))) SV.addHard(bx);
    SV.addRect(OX + dx - 40, OY - slabT - 40, 26 * S + 90, ftf + slabT + 200, true);
  }

  // callouts
  const co = (anchor: Pt, lines: string[], prefer: number[]): void => {
    const a = T(anchor[0], anchor[1]);
    if (!SV.callout([a[0], a[1]], lines, 2.2, prefer) && process.env.FIRE_DEBUG) console.warn('FP-107 callout failed', lines[0]);
  };
  co([0, 1850], [`STANDPIPE RISER ${riser.tag}`, fmtSize(riser.sizeIn)], [90, 0, 45, 135]);
  co([-sleeveR, -150], ['STEEL SLEEVE, FIRESTOPPED', '(IBC SEC. 714)'], [270, 225, 315]);
  co([-1500, -100], ['FLOOR SLAB, 200 MM'], [270, 225, 180]);
  co([390, 2000], ['STAIR ENCLOSURE WALL'], [0, 45, 315, 90, 270]);
  co([xHV + 0.4 * dH, hv + 0.2 * dH], ['2-1/2" ANGLE HOSE VALVE'], [90, 135, 45, 180]);
  co([xHV, hv - 0.9 * dH], ['CAP AND CHAIN'], [225, 180, 270, 315]);
  {
    const a = T(xPRV, hv - 0.32 * dP);
    const z = T(xPRV, hv - 520);
    arrowLine(b, [a[0], a[1]], [z[0], z[1]], S);
    SV.text('FP-ANNO', OX + xPRV, OY + hv - 580, 2.2, 'PRESSURE-REGULATING VALVE', { align: 'center', vAlign: 'middle' });
    SV.text('FP-ANNO', OX + xPRV, OY + hv - 660, 2.2, `(PRV SET ${prvSet} PSI WHERE SCHEDULED)`, { align: 'center', vAlign: 'middle' });
  }
  co([xBV, fcvY + 0.5 * dB], ['SUPERVISED BUTTERFLY VALVE', '(TAMPER SWITCH)'], [90, 45, 135]);
  co([xFS + 100, fcvY + 300], ['WATERFLOW SWITCH'], [90, 45]);
  co([xPG, fcvY + 380], ['PRESSURE GAUGE'], [135, 90, 180, 45, 270, 0]);
  co([xTD, fcvY - 650], ['SIGHT GLASS'], [0, 45, 315]);
  co([xTD, fcvY - 350], ['TEST & DRAIN VALVE'], [0, 315, 45]);
  co([xDrain, fcvY - 1500], [`DRAIN RISER ${fmtSize(sp.drainRiserIn ?? sp.mainDrainIn)}`], [270, 315, 0]);
  co([odR / 2, Math.round(ftf * 0.86)], ['PIPE SUPPORT / CLAMP'], [90, 45, 0, 135, 315, 270]);
  if (process.env.FIRE_DEBUG && SV.fallbacks.length) console.warn('FP-107 side view fallbacks', SV.fallbacks);

  // view title
  const vt = (xc: number, y: number, title: string, sub: string): void => {
    const hT = 4.5;
    const hS = 2.8;
    const cT = Math.max(xc, FRAME.x0 + 2 + 0.6 * hT * title.length);
    const cS = Math.max(xc, FRAME.x0 + 2 + 0.6 * hS * sub.length);
    b.text('FP-ANNO', PX(c, cT), PY(c, y), hT, title, { align: 'center', vAlign: 'middle' });
    b.text('FP-ANNO', PX(c, cS), PY(c, y - 6.5), hS, sub, { align: 'center', vAlign: 'middle' });
    const wT = 0.78 * hT * title.length;
    const wS = 0.78 * hS * sub.length;
    const x0 = Math.min(cT - wT / 2, cS - wS / 2);
    const x1 = Math.max(cT + wT / 2, cS + wS / 2);
    b.line('FP-ANNO', PX(c, x0), PY(c, y - 3.4), PX(c, x1), PY(c, y - 3.4));
  };
  vt(150, 538, 'TYPICAL FLOOR CONNECTION - SIDE VIEW', `SCALE 1:${S}  (STAIR LANDING, ${riser.tag} SHOWN)`);

  // ───────────────────────── (b) FIRE DEPARTMENT CONNECTION - ELEVATION ─────────────────────────
  {
    const GX = PX(c, 640);
    const GY = PY(c, 205);
    const F = (x: number, y: number): Pt => [GX + x, GY + y];
    const FP = new Placer(c, { x0: PX(c, 500), y0: PY(c, 82), x1: PX(c, 829), y1: PY(c, 331) });
    const fr = (x0: number, y0: number, x1: number, y1: number, soft = false): void => {
      const a = F(x0, y0);
      const z = F(x1, y1);
      FP.addRect(a[0], a[1], z[0] - a[0], z[1] - a[1], soft);
    };
    const fl = (layer: string, x1: number, y1: number, x2: number, y2: number): void => {
      const a = F(x1, y1);
      const z = F(x2, y2);
      b.line(layer, a[0], a[1], z[0], z[1]);
    };
    const yP = sp.fdc.heightAboveGradeMm;
    const odP = odOf(sp.fdc.pipeSizeIn);
    const wallH = 2300;
    // exterior wall with the pipe penetration, grade line
    for (const [a, z] of splitInterval(-700, wallH, [[yP - odP / 2 - 40, yP + odP / 2 + 40]])) {
      const p = F(-250, a);
      b.rect('FP-WALL', p[0], p[1], 250, z - a);
      b.hatchRect(p[0], p[1], 250, z - a, 1.8);
    }
    fr(-250, -700, 0, wallH);
    fl('FP-WALL', 0, 0, 1400, 0);
    for (let x = 80; x < 1400; x += 160) fl('FP-WALL-HTCH', x, 0, x - 120, -120);
    fr(0, -130, 1400, 0, true);
    b.text('FP-ANNO', F(560, -230)[0], F(560, -230)[1], 2.2, 'FINISHED GRADE', { align: 'left', vAlign: 'middle' });
    FP.addHard({ x0: F(560, -230)[0], y0: F(560, -230)[1] - 60, x1: F(560, -230)[0] + textWidth(2.2 * S, 'FINISHED GRADE'), y1: F(560, -230)[1] + 60 });
    // inside: pipe, check valve, tee with ball drip
    const xCV = -900;
    const dC = 360;
    const xDr = -1400;
    for (const [a, z] of [[-1750, xCV - dC / 2], [xCV + dC / 2, 150]] as [number, number][]) {
      fl('FP-PIPE-DISC', a, yP + odP / 2, z, yP + odP / 2);
      fl('FP-PIPE-DISC', a, yP - odP / 2, z, yP - odP / 2);
    }
    {
      const p = F(xCV, yP);
      checkValve(b, p[0], p[1], 0, dC);
    }
    fr(xCV - dC / 2, yP - 130, xCV + dC / 2, yP + 320);
    fl('FP-PIPE-DRAN', xDr - 40, yP - odP / 2, xDr - 40, 140);
    fl('FP-PIPE-DRAN', xDr + 40, yP - odP / 2, xDr + 40, 140);
    {
      const p = F(xDr, yP - 330);
      ballValve(b, p[0], p[1], 270, 240);
    }
    fl('FP-PIPE-DRAN', xDr, 140, xDr, 20);
    {
      const p = F(xDr, 20);
      b.solid('FP-PIPE-DRAN', [[p[0], p[1] - 50], [p[0] - 60, p[1] + 40], [p[0] + 60, p[1] + 40]]);
    }
    fr(xDr - 150, 0, xDr + 150, yP - odP / 2, true);
    // arrow to the standpipe
    {
      const a = F(-1750, yP);
      const z = F(-1350, yP);
      void z;
      arrowLine(b, [a[0] - 380, a[1]], [a[0] + 20, a[1]], S);
    }
    // outside: escutcheon, nipple, siamese body with two angled inlets, plugs and chains
    fl('FP-VALV', 0, yP - 260, 0, yP + 260);
    fl('FP-PIPE-DISC', 0, yP + odP / 2, 230, yP + odP / 2);
    fl('FP-PIPE-DISC', 0, yP - odP / 2, 230, yP - odP / 2);
    {
      const p = F(230, yP - 210);
      b.rect('FP-VALV', p[0], p[1], 190, 420);
      const inl = (dy: number): void => {
        const x0 = 420;
        const y0 = yP + dy;
        const x1 = x0 + 340;
        const y1 = y0 - 340;
        const sg = (u: number): [number, number] => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u];
        const nx = 0.7071 * 70;
        const a1 = F(sg(0)[0] + nx, sg(0)[1] + nx);
        const a2 = F(sg(1)[0] + nx, sg(1)[1] + nx);
        const b1 = F(sg(0)[0] - nx, sg(0)[1] - nx);
        const b2 = F(sg(1)[0] - nx, sg(1)[1] - nx);
        b.line('FP-VALV', a1[0], a1[1], a2[0], a2[1]);
        b.line('FP-VALV', b1[0], b1[1], b2[0], b2[1]);
        const cp = F(sg(1)[0] + 40, sg(1)[1] - 40);
        b.circle('FP-VALV', cp[0], cp[1], 95);
        b.circle('FP-VALV', cp[0], cp[1], 45);
        const sw = F(sg(0.55)[0], sg(0.55)[1]);
        b.circle('FP-VALV', sw[0] - 55, sw[1] + 95, 55);
      };
      inl(110);
      inl(-110);
      fl('FP-VALV', 420, yP + 110, 420, yP + 110);
      const j = F(230, yP + 110);
      const j2 = F(420, yP + 110);
      b.line('FP-VALV', j[0] + 190, j[1], j2[0], j2[1]);
      const k = F(230, yP - 110);
      const k2 = F(420, yP - 110);
      b.line('FP-VALV', k[0] + 190, k[1], k2[0], k2[1]);
    }
    fr(0, yP - 720, 900, yP + 480);
    // sign (front view) and wall-mounted sign plate
    {
      const sx = 450;
      const sy = 1500;
      const p = F(sx, sy);
      b.rect('FP-ANNO', p[0], p[1], 760, 300);
      b.text('FP-ANNO', p[0] + 380, p[1] + 150, 4.8, 'STANDPIPE', { align: 'center', vAlign: 'middle' });
      FP.addRect(p[0], p[1], 760, 300);
      fl('FP-ANNO', 0, sy + 150, sx, sy + 150);
      fl('FP-ANNO', 0, sy + 60, 0, sy + 240);
    }
    // height above grade (the FDC inlet centre-line)
    {
      const p0 = F(1250, 0);
      const p1 = F(1250, yP);
      void p0;
      void p1;
      const a = F(1000, 0);
      const z = F(1000, yP);
      b.dimLinear(a[0], a[1], z[0], z[1], -6);
      for (const bx of dimBoxes(S, a[0], a[1], z[0], z[1], -6, String(yP))) FP.addHard(bx);
      fl('FP-CNTR', 0, yP, 1000, yP);
    }
    const fc = (anchor: Pt, lines: string[], prefer: number[]): void => {
      const a = F(anchor[0], anchor[1]);
      if (!FP.callout([a[0], a[1]], lines, 2.2, prefer) && process.env.FIRE_DEBUG) console.warn('FP-107 callout failed', lines[0]);
    };
    fc([xCV, yP + 220], ['CHECK VALVE'], [90, 135]);
    fc([xDr, yP - 330], ['AUTOMATIC BALL DRIP', '(TO DRAIN)'], [225, 270, 180]);
    fc([330, yP + 150], [`${sp.fdc.inlets} x 2-1/2" INLETS`, '(SIAMESE, 45 DEG., PLUGS AND CHAINS)'], [90, 45, 135]);
    fc([-1000, yP - odP / 2 - 60], [`${fmtSize(sp.fdc.pipeSizeIn)} TO STANDPIPE`], [270, 315]);
    fc([650, 1650], ['SIGN: "STANDPIPE"'], [90, 135]);
    if (process.env.FIRE_DEBUG && FP.fallbacks.length) console.warn('FP-107 FDC fallbacks', FP.fallbacks);
    vt(640, 340, 'FIRE DEPARTMENT CONNECTION - ELEVATION', `SCALE 1:${S}  (${sp.fdc.inlets} INLETS, ${sp.fdc.heightAboveGradeMm} MM ABOVE GRADE)`);
  }

  // ───────────────────────── tables and notes ─────────────────────────
  const th = 2.2;
  const byId = new Map(floors.map((f) => [f.id, f]));
  // (c) floor schedule: every standpipe x floor
  const sch: string[][] = [['STANDPIPE', 'FLOOR', 'FFL (M)', 'OUTLET EL. (M)', 'SIZE', 'FLOW (GPM)', 'STATIC (PSI)', 'RESIDUAL (PSI)', 'PRV / SET']];
  for (const q of sp.risers) {
    for (const o of q.outlets.slice().reverse()) {
      const f = byId.get(o.floorId);
      sch.push([
        q.tag,
        o.floorName + (o.isRoofOutlet ? ' (ROOF OUTLET)' : ''),
        f ? lvl(f.elevationM) : '-',
        lvl(o.elevationM),
        `${o.sizeIn === 1.5 ? '1-1/2' : '2-1/2'}"`,
        o.flowing ? `${o.flowGpm} (FLOWING)` : '-',
        psi(o.staticPsi),
        psi(o.residualPsi),
        o.prvRequired ? `PRV ${o.prvSetPsi ?? 175} PSI` : 'NO'
      ]);
    }
  }
  const schCols = autoCols(sch, th, [16, 30, 14, 18, 9, 20, 16, 18, 20]);
  const schAlign = [false, false, true, true, false, false, true, true, false];
  const schX = Math.max(498, tableMinX(schCols, sch, th));
  const schM = measureTable(schCols, sch, { title: 'FLOOR SCHEDULE - STANDPIPE OUTLETS', th });
  drawTable(c, schX, 576, schCols, sch, { title: 'FLOOR SCHEDULE - STANDPIPE OUTLETS', th, alignRight: schAlign });

  // (d) hydraulic calculation of the governing riser
  const hyd: string[][] = [['FROM', 'TO', 'DESCRIPTION', 'Q (GPM)', 'DN (IN)', 'ID (IN)', 'C', 'L (FT)', 'EQ (FT)', 'TOTAL (FT)', 'PF (PSI)', 'PE (PSI)', 'PT START', 'PT END', 'V (FPS)']];
  for (const rw of sp.rows) {
    hyd.push([
      rw.fromNode,
      rw.toNode,
      wrapText(rw.description, 30).join('\n'),
      String(Math.round(rw.totalFlowGpm)),
      String(rw.nominalIn),
      rw.idIn.toFixed(3),
      String(rw.c),
      rw.lengthFt.toFixed(1),
      rw.fittingsEqFt.toFixed(1),
      rw.totalLengthFt.toFixed(1),
      rw.pfPsi.toFixed(2),
      rw.pePsi.toFixed(2),
      rw.ptStartPsi.toFixed(1),
      rw.ptEndPsi.toFixed(1),
      rw.velocityFps.toFixed(1)
    ]);
  }
  const hCols = autoCols(hyd, 2.0);
  const hAlign = hCols.map((_, i) => i >= 3);
  const hTitle = `STANDPIPE HYDRAULIC CALCULATION - GOVERNING RISER ${sp.governingRiserTag}`;
  const hM = measureTable(hCols, hyd, { title: hTitle, th: 2.0 });
  const hX = Math.max(26, tableMinX(hCols, hyd, 2.0));
  const hTop = 244;
  drawTable(c, hX, hTop, hCols, hyd, { title: hTitle, th: 2.0, alignRight: hAlign });

  // legend (bottom left, under the node table) and notes (right column under the schedule)
  const lgTop = hTop - hM.h - 6;
  if (lgTop - 70 > 12) drawStandpipeLegend(c, hX, lgTop);
  const nTop = 576 - schM.h - 8;
  drawNotes(c, schX, nTop, FRAME.x1 - schX - 6, 'STANDPIPE NOTES', standpipeNotes(c), 2.2);

  sheetTitle(c, 30, 568, 'STANDPIPE FLOOR CONNECTION - DETAILS & SCHEDULE', 'SIDE VIEW, FDC ELEVATION, FLOOR SCHEDULE, HYDRAULIC CALCULATION & NOTES');
}
