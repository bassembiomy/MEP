/**
 * FP-106 — Standpipe riser diagram, ELEVATION through every floor.
 * Vertical axis = true scale (floor FFLs, hose valve heights, slab thickness, true pipe OD);
 * horizontal axis = schematic. Per riser: double-line riser at true OD, 2½" angle hose valve at every
 * landing (with PRV where required), outlet static / residual pressures, floor control valve assemblies
 * (combined systems), drain riser, automatic air release, roof outlet, cross connection, supply main
 * to the pump room and the fire department connection.
 */
import type { FloorLevel, StandpipeOutlet, StandpipeRiserDesign } from '../fpTypes';
import { formatPipeSize } from '../standards/pipeData';
import { ballValve, butterflyValve, checkValve, gateValve, hoseValve } from './symbols';
import { type Box, type Ctx, FRAME, Placer, PX, PY, TBLK, arrowLine, dimBoxes, drawNotes, drawTable, sheetTitle, splitInterval, textWidth } from './sheetKit';
import { odOf } from './sheetGeom';

/** Standard drawing scales offered by the sheet set. */
export const SP_SCALES = [50, 75, 100, 150, 200, 250, 500];

/** Building left / right inside faces on the paper (mm). */
const BL = 82;
const BR = 520;
/** Right-hand information panel (system data, legend, notes). */
const PANEL_X = 598;
/** Paper y of the lowest drawn elevation. */
const Y0P = 26;
/** Height reserved above the highest riser for the air release and the riser label (paper mm). */
const TOP_MARGIN_P = 26;

export function elevationRange(r: Ctx['r']): { lowM: number; topM: number } {
  const bld = r.input.building!;
  const sp = r.standpipe!;
  const roof = bld.floors.find((f) => f.isRoof) ?? bld.floors[bld.floors.length - 1];
  const lowM = bld.floors[0].elevationM - 2.4;
  const topM = Math.max(roof.elevationM + 1.1, ...sp.risers.map((q) => q.topElevationM + 0.6));
  return { lowM, topM };
}

/** Smallest standard scale at which the whole building elevation fits the sheet. */
export function pickStandpipeScale(c: Pick<Ctx, 'r'>): number {
  const { lowM, topM } = elevationRange(c.r);
  for (const s of SP_SCALES) if (((topM - lowM) * 1000) / s + TOP_MARGIN_P + Y0P <= 548) return s;
  return 500;
}

const fmtSize = (n: number): string => formatPipeSize(n);
export const psi = (v: number): string => String(Math.round(v));

/** Notes of the riser diagram (shared with the schedule sheet). */
export function riserDiagramNotes(c: Ctx): string[] {
  const sp = c.r.standpipe!;
  const hv = sp.hoseValveHeightMm;
  const maxStatic = Math.max(...sp.risers.flatMap((q) => q.outlets.map((o) => o.staticPsi)));
  const prvFloors = new Set(sp.risers.flatMap((q) => q.outlets.filter((o) => o.prvRequired).map((o) => o.floorName)));
  return [
    `ELEVATIONS ARE TRUE TO THE VERTICAL SCALE 1:${c.sheet.scale} (FFL LEVELS IN METRES, FLOOR-TO-FLOOR HEIGHTS IN MM). THE HORIZONTAL LAYOUT IS SCHEMATIC AND NOT TO SCALE.`,
    `HOSE CONNECTIONS: ${sp.risers[0]?.outlets[0]?.sizeIn === 1.5 ? '1-1/2"' : '2-1/2"'} ANGLE HOSE VALVES WITH CAP AND CHAIN AT EVERY FLOOR LANDING OF THE REQUIRED EXIT STAIRS, CENTRE-LINE ${hv} MM ABOVE FFL (NFPA 14 SEC. 7.3.1.1 AND 7.3.2.1).`,
    `STATIC PRESSURE = PUMP AT CHURN PLUS MAXIMUM STATIC SUCTION; RESIDUAL PRESSURE = AT THE OUTLET WITH THE SYSTEM FLOWING AT DEMAND (${sp.demandFlowGpm} GPM). THE TWO TOPMOST OUTLETS OF THE GOVERNING RISER ${sp.governingRiserTag} ARE THE FLOWING OUTLETS.`,
    prvFloors.size
      ? `PRESSURE-REGULATING VALVES (PRV) ARE PROVIDED WHERE THE STATIC PRESSURE EXCEEDS 175 PSI (NFPA 14 SEC. 7.2.3); PRVs SERVE ${[...prvFloors].join(', ').toUpperCase()}. MAXIMUM STATIC PRESSURE ${psi(maxStatic)} PSI.`
      : `NO PRESSURE-REGULATING VALVES ARE REQUIRED: MAXIMUM STATIC PRESSURE ${psi(maxStatic)} PSI DOES NOT EXCEED 175 PSI (NFPA 14 SEC. 7.2.3).`,
    `DRAIN RISER ${sp.drainRiserIn ? fmtSize(sp.drainRiserIn) : fmtSize(sp.mainDrainIn)} RUNS BESIDE EACH RISER WITH PRVs OR FLOOR CONTROL VALVE ASSEMBLIES AND DISCHARGES TO THE ${fmtSize(sp.mainDrainIn)} MAIN DRAIN AT THE BASE (NFPA 14 SEC. 7.11).`,
    sp.combined
      ? 'FLOOR CONTROL VALVE ASSEMBLY AT EACH SPRINKLERED FLOOR: SUPERVISED BUTTERFLY VALVE, WATERFLOW SWITCH (FS), PRESSURE GAUGE AND TEST & DRAIN WITH SIGHT GLASS (NFPA 13 SEC. 16.9.4). SEE FP-107.'
      : 'STANDPIPES ARE NOT COMBINED WITH THE FLOOR SPRINKLER SYSTEMS; SPRINKLER CONTROL VALVE ASSEMBLIES ARE SHOWN ON THE SPRINKLER DRAWINGS.',
    'AUTOMATIC AIR RELEASE VALVE AT THE HIGH POINT OF EVERY WET RISER. RISERS ARE INTERCONNECTED AT THE BASE WITH OS&Y ISOLATION VALVES (SUPERVISED OPEN).',
    'SEE FP-107 FOR THE TYPICAL FLOOR CONNECTION, THE FIRE DEPARTMENT CONNECTION DETAIL, THE FLOOR SCHEDULE AND THE HYDRAULIC CALCULATION.'
  ];
}

/** Pressure-regulating valve: bow-tie body on the line with a diaphragm actuator on top (flow left to right). */
export function prvSymbol(b: Ctx['b'], x: number, y: number, d: number): void {
  for (const sg of [-1, 1]) b.polyline('FP-VALV', [[x + (sg * d) / 2, y - 0.3 * d], [x + (sg * d) / 2, y + 0.3 * d], [x, y]], true);
  b.line('FP-VALV', x, y, x, y + 0.6 * d);
  b.arc('FP-VALV', x, y + 0.6 * d, 0.34 * d, 0, 180);
  b.line('FP-VALV', x - 0.34 * d, y + 0.6 * d, x + 0.34 * d, y + 0.6 * d);
}

export function drawStandpipeRiserSheet(c: Ctx): void {
  const { b, sheet, r } = c;
  const S = sheet.scale;
  const sp = r.standpipe!;
  const bld = r.input.building!;
  const floors = bld.floors;
  const roofF = floors.find((f) => f.isRoof) ?? floors[floors.length - 1];
  const lowEl = floors[0].elevationM;
  const { lowM } = elevationRange(r);
  const N = sp.risers.length;
  const X = (v: number): number => PX(c, v);
  const Zr = (m: number): number => PY(c, Y0P) + (m - lowM) * 1000;
  const floorOf = (id: string): FloorLevel | undefined => floors.find((f) => f.id === id);
  const wallT = 250;

  const frameBounds: Box = { x0: PX(c, FRAME.x0 + 1), y0: PY(c, FRAME.y0 + 1), x1: PX(c, FRAME.x1 - 1), y1: PY(c, FRAME.y1 - 1) };
  const P = new Placer(c, frameBounds);
  P.addRect(PX(c, TBLK.x0), PY(c, TBLK.y0), (TBLK.x1 - TBLK.x0) * S, (TBLK.y1 - TBLK.y0) * S);
  P.addRect(PX(c, PANEL_X - 3), PY(c, FRAME.y0), (FRAME.x1 - PANEL_X + 3) * S, (FRAME.y1 - FRAME.y0) * S);
  P.addRect(PX(c, FRAME.x0), PY(c, 548), (PANEL_X - FRAME.x0) * S, 40 * S);
  const reg = (x0: number, y0: number, x1: number, y1: number, soft = false): void => P.addRect(x0, y0, x1 - x0, y1 - y0, soft);

  const xRp = sp.risers.map((_, k) => BL + ((BR - BL) * (k + 0.5)) / N);
  const odR = sp.risers.map((q) => odOf(q.sizeIn));
  const odMain = odOf(sp.supplyMainSizeIn);
  const yMainEl = lowEl - 0.8;
  const yMain = Zr(yMainEl);
  const hM = odMain / 2;

  // ───────────────────────── levels, slabs, walls ─────────────────────────
  const drainOf = (k: number): number => X(xRp[k] + 44);
  const drainRisers: { k: number; top: number; bottom: number }[] = [];
  const fcvH = (f: FloorLevel): number => Math.min(2.3, Math.max(1.2, f.floorToFloorM - 1.3));
  sp.risers.forEach((q, k) => {
    const prvTop = Math.max(-Infinity, ...q.outlets.filter((o) => o.prvRequired).map((o) => o.elevationM));
    const fcvFloors = q.floorControlValveFloors.map(floorOf).filter((f): f is FloorLevel => !!f);
    const fcvTop = Math.max(-Infinity, ...fcvFloors.map((f) => f.elevationM + fcvH(f) - 0.64));
    const top = Math.max(prvTop, fcvTop);
    if (Number.isFinite(top) && (sp.drainRiserIn || fcvFloors.length)) drainRisers.push({ k, top, bottom: lowEl + 0.4 });
  });

  const slab = (f: FloorLevel): void => {
    const holes: [number, number][] = sp.risers.map((_q, k) => [X(xRp[k]) - odR[k] / 2 - 200, X(xRp[k]) + odR[k] / 2 + 200]);
    for (const d of drainRisers) holes.push([drainOf(d.k) - 160, drainOf(d.k) + 160]);
    const segs = splitInterval(X(BL), X(BR), holes.filter((h) => h[1] > X(BL) + 10));
    for (const [a, z] of segs) {
      if (z - a < 1) continue;
      b.rect('FP-WALL', a, Zr(f.elevationM) - 200, z - a, 200);
      b.hatchRect(a, Zr(f.elevationM) - 200, z - a, 200, 1.0);
    }
    reg(X(BL), Zr(f.elevationM) - 200, X(BR), Zr(f.elevationM), true);
  };
  floors.forEach(slab);

  // exterior walls (right wall has the FDC penetration, left wall the supply-main penetration)
  const fdcEl = sp.fdc.heightAboveGradeMm / 1000;
  const yWallLo = Zr(lowEl) - 200;
  const yWallHi = Zr(roofF.elevationM + 1.1);
  const wall = (x0: number, holes: [number, number][]): void => {
    for (const [a, z] of splitInterval(yWallLo, yWallHi, holes)) {
      b.rect('FP-WALL', x0, a, wallT, z - a);
      b.hatchRect(x0, a, wallT, z - a, 1.2);
    }
    reg(x0, yWallLo, x0 + wallT, yWallHi);
  };
  wall(X(BL) - wallT, [[yMain - hM - 120, yMain + hM + 120]]);
  wall(X(BR), [[Zr(fdcEl) - 120, Zr(fdcEl) + 120]]);
  // roof parapet cap line and grade line
  b.line('FP-WALL', X(BR), Zr(0), X(BR + 46), Zr(0));
  P.addRect(X(BR), Zr(0) - 20, 46 * S, 40, true);
  b.text('FP-ANNO', X(BR + 4), Zr(0) - 2.4 * S, 1.8, 'FINISHED GRADE', { vAlign: 'middle' });
  P.addHard({ x0: X(BR + 4), y0: Zr(0) - 3.6 * S, x1: X(BR + 4) + textWidth(1.8 * S, 'FINISHED GRADE'), y1: Zr(0) - 1.2 * S });

  // level marks + names on the left, floor-to-floor chain on the right
  const lmX = X(61);
  for (const f of floors) {
    b.levelMark(lmX, Zr(f.elevationM), f.elevationM, f.name);
    reg(X(25), Zr(f.elevationM) - 1 * S, X(78), Zr(f.elevationM) + 4 * S);
  }
  const chainP = 52;
  const dimX = X(BR + 3);
  for (let i = 0; i + 1 < floors.length; i++) {
    const y1 = Zr(floors[i].elevationM);
    const y2 = Zr(floors[i + 1].elevationM);
    b.dimLinear(dimX, y1, dimX, y2, -chainP);
    for (const bx of dimBoxes(S, dimX, y1, dimX, y2, -chainP, String(Math.round(y2 - y1)))) P.addHard(bx);
  }
  {
    const y1 = Zr(floors[0].elevationM);
    const y2 = Zr(roofF.elevationM);
    b.dimLinear(dimX, y1, dimX, y2, -chainP - 9);
    for (const bx of dimBoxes(S, dimX, y1, dimX, y2, -chainP - 9, String(Math.round(y2 - y1)))) P.addHard(bx);
    b.text('FP-DIMS', X(BR + 3 + chainP), Zr(roofF.elevationM) + 4 * S, 2, 'FLOOR-TO-FLOOR (MM)', { align: 'center', vAlign: 'middle' });
    P.addHard({ x0: X(BR + 3 + chainP) - textWidth(2 * S, 'FLOOR-TO-FLOOR (MM)') / 2, y0: Zr(roofF.elevationM) + 2.5 * S, x1: X(BR + 3 + chainP) + textWidth(2 * S, 'FLOOR-TO-FLOOR (MM)') / 2, y1: Zr(roofF.elevationM) + 5.5 * S });
  }
  reg(X(BR + 3 + chainP - 4), Zr(floors[0].elevationM) - 10, X(BR + 3 + chainP + 14), Zr(roofF.elevationM) + 10);

  // ───────────────────────── supply main, cross connection ─────────────────────────
  const hpipe = (xa: number, xb: number, y: number, od: number, layer = 'FP-PIPE-DISC'): void => {
    if (xb - xa < 1) return;
    b.line(layer, xa, y + od / 2, xb, y + od / 2);
    b.line(layer, xa, y - od / 2, xb, y - od / 2);
  };
  const vpipe = (x: number, ya: number, yb: number, od: number, layer = 'FP-PIPE-DISC'): void => {
    if (yb - ya < 1) return;
    b.line(layer, x - od / 2, ya, x - od / 2, yb);
    b.line(layer, x + od / 2, ya, x + od / 2, yb);
  };
  const xStubEnd = X(40);
  {
    const x1 = X(xRp[0]);
    // supply stub + cross connection (bottom line continuous, top line broken at the risers)
    hpipe(xStubEnd, x1 - odR[0] / 2, yMain, odMain);
    b.line('FP-PIPE-DISC', x1 - odR[0] / 2, yMain - hM, X(xRp[N - 1]) + odR[N - 1] / 2, yMain - hM);
    for (let k = 0; k + 1 < N; k++) b.line('FP-PIPE-DISC', X(xRp[k]) + odR[k] / 2, yMain + hM, X(xRp[k + 1]) - odR[k + 1] / 2, yMain + hM);
    P.addRect(xStubEnd, yMain - hM, X(xRp[N - 1]) - xStubEnd, odMain, true);
    // break symbol at the pipe end
    const bk = (dx: number): void => b.line('FP-PIPE-DISC', xStubEnd + dx, yMain - hM - 1.6 * S, xStubEnd + dx + 1.4 * S, yMain + hM + 1.6 * S);
    bk(0);
    bk(1.6 * S);
    // OS&Y valves: on the stub and on both sides of every riser-to-riser connection
    const dG = 4 * S;
    const gv = (xm: number): void => {
      gateValve(b, xm, yMain, 0, dG);
      reg(xm - dG / 2, yMain - 0.4 * dG, xm + dG / 2, yMain + 1.15 * dG);
    };
    gv(X(BL + 14));
    for (let k = 0; k + 1 < N; k++) {
      gv(X(xRp[k] + 26));
      gv(X(xRp[k + 1] - 26));
    }
    // labels
    P.text('FP-ANNO', X(62), yMain - 5.2 * S, 2.2, `SUPPLY MAIN ${fmtSize(sp.supplyMainSizeIn)}`, { align: 'center', vAlign: 'middle' });
    P.text('FP-ANNO', X(62), yMain - 8.4 * S, 2.2, 'TO FIRE PUMP ROOM (SEE FP-101)', { align: 'center', vAlign: 'middle' });
    P.text('FP-ANNO', X(62), yMain - 11.6 * S, 1.8, `PUMP CL ${sp.pumpCLElevationM < 0 ? '-' : '+'}${Math.abs(sp.pumpCLElevationM).toFixed(3)}`, { align: 'center', vAlign: 'middle' });
    if (N >= 2) {
      P.text('FP-ANNO', (X(xRp[0] + 26) + X(xRp[1] - 26)) / 2, yMain - 5.2 * S, 2.2, 'CROSS CONNECTION', { align: 'center', vAlign: 'middle' });
      P.text('FP-ANNO', (X(xRp[0] + 26) + X(xRp[1] - 26)) / 2, yMain - 8.4 * S, 2.2, 'OS&Y ISOLATION VALVES (SUPERVISED OPEN)', { align: 'center', vAlign: 'middle' });
    } else {
      P.text('FP-ANNO', X(xRp[0] + 40), yMain - 5.2 * S, 2.2, 'OS&Y GATE VALVE (SUPERVISED OPEN)', { align: 'left', vAlign: 'middle' });
    }
  }

  // reserve the FDC pipe corridor before the pressure texts are placed
  reg(X(xRp[N - 1]) + odR[N - 1] / 2, Zr(fdcEl) - 1.8 * S, X(BR) + wallT, Zr(fdcEl) + 1.8 * S);

  // ───────────────────────── risers ─────────────────────────
  const tagJobs: (() => void)[] = [];
  sp.risers.forEach((q: StandpipeRiserDesign, k: number) => {
    const xR = X(xRp[k]);
    const rr = odR[k] / 2;
    const yTop = Zr(q.topElevationM + 0.6);
    const last = k === N - 1;
    const isGov = q.tag === sp.governingRiserTag;
    const leftHoles: [number, number][] = [];
    const rightHoles: [number, number][] = [];

    // outlets
    q.outlets.forEach((o: StandpipeOutlet) => {
      const yO = Zr(o.elevationM);
      const odB = odOf(o.sizeIn);
      leftHoles.push([yO - odB / 2, yO + odB / 2]);
      const dH = 5 * S;
      const dP = 4.4 * S;
      const xHV = xR - 21 * S;
      const xPR = xR - 10.5 * S;
      if (o.prvRequired) {
        hpipe(xR - rr, xPR + dP / 2, yO, odB);
        hpipe(xHV + dH / 2, xPR - dP / 2, yO, odB);
        prvSymbol(b, xPR, yO, dP);
        reg(xPR - dP / 2, yO - 0.3 * dP, xPR + dP / 2, yO + 0.95 * dP);
      } else {
        hpipe(xHV + dH / 2, xR - rr, yO, odB);
      }
      hoseValve(b, xHV, yO, 180, dH);
      reg(xHV - 0.3 * dH, yO - 0.95 * dH, xHV + 0.5 * dH, yO + 0.7 * dH);
      P.addRect(xHV, yO - odB / 2, xR - rr - xHV, odB, true);

      // static / residual pressure (right of the riser)
      const th = 2;
      const xT = xR + rr + 2.6 * S;
      const wT = textWidth(th * S, 'RESIDUAL 000 PSI');
      const lines = [`STATIC ${psi(o.staticPsi)} PSI`, `RESIDUAL ${psi(o.residualPsi)} PSI`];
      for (const dy of [0, 3.8, -3.8, 7.6]) {
        const yc = yO + dy * S;
        const box: Box = { x0: xT, x1: xT + wT, y0: yc - 3.4 * S, y1: yc + 3.4 * S };
        if (!P.free(box, 0.2 * S, false)) continue;
        P.text('FP-ANNO', xT, yc + 1.5 * S, th, lines[0], { vAlign: 'middle' });
        P.text('FP-ANNO', xT, yc - 1.5 * S, th, lines[1], { vAlign: 'middle' });
        break;
      }
      if (o.flowing) {
        P.text('FP-ANNO', xHV - 3.8 * S, yO, 2, `${o.flowGpm} GPM @ ${psi(o.residualPsi)} PSI (FLOWING)`, { align: 'right', vAlign: 'middle' });
      }
      tagJobs.push(() => {
        P.tag([xHV, yO], 'HV', [90, 135, 45, 270, 180, 225]);
        if (o.prvRequired) P.callout([xPR, yO + 0.3 * dP], [`PRV SET ${o.prvSetPsi ?? 175} PSI`], 2, [90, 45, 135, 0, 180]);
        if (o.isRoofOutlet) P.callout([xHV - 0.3 * dH, yO - 0.4 * dH], ['ROOF HOSE CONNECTION'], 2, [225, 180, 270, 135]);
      });
    });

    // floor control valve assemblies (combined systems)
    const fcvFloors = q.floorControlValveFloors.map(floorOf).filter((f): f is FloorLevel => !!f);
    const xd = drainOf(k);
    const sizeF = Math.min(4, q.sizeIn);
    const odF = odOf(sizeF);
    fcvFloors.forEach((f, fi) => {
      const yF = Zr(f.elevationM + fcvH(f));
      rightHoles.push([yF - odF / 2, yF + odF / 2]);
      const xb = xR + 8 * S;
      const xf = xR + 16 * S;
      const xt = xR + 24 * S;
      const xe = xR + 34 * S;
      const dB = 4.2 * S;
      hpipe(xR + rr, xb - dB / 2, yF, odF);
      hpipe(xb + dB / 2, xe, yF, odF);
      butterflyValve(b, xb, yF, 0, dB);
      reg(xb - dB / 2, yF - 0.3 * dB, xb + dB / 2, yF + 0.75 * dB);
      // waterflow switch
      b.line('FP-VALV', xf, yF + odF / 2, xf, yF + 1.8 * S);
      b.rect('FP-VALV', xf - 2.3 * S, yF + 1.8 * S, 4.6 * S, 2.8 * S);
      b.text('FP-VALV', xf, yF + 3.2 * S, 1.8, 'FS', { align: 'center', vAlign: 'middle' });
      reg(xf - 2.3 * S, yF + odF / 2, xf + 2.3 * S, yF + 4.6 * S);
      // test & drain with sight glass down to the drain riser
      const yT = yF - 6.4 * S;
      b.polyline('FP-PIPE-DRAN', [[xt, yF - odF / 2], [xt, yT], [xd, yT]], false);
      ballValve(b, xt, yF - 2.9 * S, 270, 2.8 * S);
      b.circle('FP-VALV', xt, yF - 4.9 * S, 0.7 * S);
      b.circle('FP-ANNO', xd, yT, 0.45 * S);
      reg(xt - 1.6 * S, yT - 0.6 * S, xd + 0.5 * S, yF - odF / 2, true);
      // stub to the floor sprinklers
      arrowLine(b, [xe + 5 * S, yF], [xe, yF], S);
      P.text('FP-ANNO', xR + 18 * S, yF + 7.4 * S, 2, 'TO FLOOR SPRINKLERS', { align: 'center', vAlign: 'middle' });
      if (fi === Math.floor(fcvFloors.length / 2)) {
        tagJobs.push(() => {
          P.callout([xb, yF - 0.3 * dB], ['FLOOR CONTROL VALVE ASSEMBLY', 'SUPERVISED BUTTERFLY VALVE, FS,', 'TEST & DRAIN (SEE FP-107)'], 2, [0, 315, 45, 270, 90]);
        });
      }
    });

    // FDC branch off the last riser
    const yFdc = Zr(fdcEl);
    if (last) rightHoles.push([yFdc - odOf(sp.fdc.pipeSizeIn) / 2, yFdc + odOf(sp.fdc.pipeSizeIn) / 2]);

    // riser pipe (left / right lines broken at the branch mouths)
    const yb = yMain + hM;
    for (const [a, z] of splitInterval(yb, yTop, leftHoles)) b.line('FP-PIPE-DISC', xR - rr, a, xR - rr, z);
    for (const [a, z] of splitInterval(last ? yMain - hM : yb, yTop, rightHoles)) b.line('FP-PIPE-DISC', xR + rr, a, xR + rr, z);
    b.line('FP-PIPE-DISC', xR - rr, yTop, xR + rr, yTop);
    P.addRect(xR - rr, yMain, odR[k], yTop - yMain, true);

    // automatic air release valve at the top
    const dA = 3.2 * S;
    const yA = yTop + 4.6 * S;
    vpipe(xR, yTop, yA - dA / 2, 50);
    vpipe(xR, yA + dA / 2, yTop + 9 * S, 50);
    ballValve(b, xR, yA, 90, dA);
    b.solid('FP-PIPE-DISC', [[xR, yTop + 11.6 * S], [xR - 0.7 * S, yTop + 9.4 * S], [xR + 0.7 * S, yTop + 9.4 * S]]);
    reg(xR - 2.5 * S, yTop, xR + 2.5 * S, yTop + 11.8 * S);
    const lbl = [`${q.tag}  ${fmtSize(q.sizeIn)}`, q.location.toUpperCase(), ...(isGov ? ['GOVERNING RISER'] : [])];
    if (yTop + 15 * S > Zr(roofF.elevationM) + 0.5 * S) {
      P.block(lbl, 2.5, [[xR, yTop + 20 * S], [xR, yTop + 23 * S]]);
    } else {
      // riser ends below the roof slab: label above the roof, tied to the riser by a centre-line
      const yL = Zr(roofF.elevationM) + 14 * S;
      P.block(lbl, 2.5, [[xR, yL], [xR, yL + 3 * S]]);
      b.line('FP-CNTR', xR, yTop + 11.8 * S, xR, yL - 7 * S);
    }
    tagJobs.push(() => P.callout([xR + 0.3 * dA, yA], ['AUTOMATIC AIR RELEASE'], 2, [0, 45, 315]));
    // thick "riser tag" along the riser: tag circle at the base
    tagJobs.push(() => {
      P.tag([xR, yMain + 6 * S], q.tag, [0, 180, 45, 135]);
    });
  });

  // drain risers (dashed, beside each riser with PRVs / FCV assemblies)
  for (const d of drainRisers) {
    const xd = drainOf(d.k);
    const odD = odOf(sp.drainRiserIn ?? sp.mainDrainIn);
    const yb = Zr(d.bottom);
    const yt = Zr(d.top);
    b.pipe('FP-PIPE-DRAN', [[xd, yt], [xd, yb], [xd + 12 * S, yb]], odD, false);
    reg(xd - odD, yb - odD, xd + 12 * S, yt, true);
    P.text('FP-ANNO', xd + 14 * S, yb, 2, `${fmtSize(sp.mainDrainIn)} MAIN DRAIN TO SUMP`, { vAlign: 'middle' });
    const midY = Zr(floors[Math.min(floors.length - 2, 3)].elevationM + 2.0);
    tagJobs.push(() =>
      P.callout([xd, Math.min(midY, yt - 2 * S)], [`DRAIN RISER ${fmtSize(sp.drainRiserIn ?? sp.mainDrainIn)}`], 2, [0, 45, 315])
    );
  }

  // ───────────────────────── fire department connection ─────────────────────────
  {
    const xN = X(xRp[N - 1]);
    const rrN = odR[N - 1] / 2;
    const yF = Zr(fdcEl);
    const odP = odOf(sp.fdc.pipeSizeIn);
    const xWallIn = X(BR);
    const dC = 4.4 * S;
    const xCV = (drainOf(N - 1) + xWallIn) / 2 - 6 * S;
    hpipe(xN + rrN, xCV - dC / 2, yF, odP);
    hpipe(xCV + dC / 2, xWallIn + wallT, yF, odP);
    checkValve(b, xCV, yF, 0, dC);
    reg(xCV - dC / 2, yF - 0.3 * dC, xCV + dC / 2, yF + 0.8 * dC);
    // ball drip (automatic drain) at the low point inside the wall
    const xDr = xWallIn - 6 * S;
    b.polyline('FP-PIPE-DRAN', [[xDr, yF - odP / 2], [xDr, yF - 4.2 * S]], false);
    ballValve(b, xDr, yF - 2.6 * S, 270, 2.4 * S);
    b.line('FP-PIPE-DRAN', xDr - 1 * S, yF - 4.2 * S, xDr + 1 * S, yF - 4.2 * S);
    reg(xDr - 1.5 * S, yF - 4.4 * S, xDr + 2.2 * S, yF - odP / 2, true);
    // siamese outside: pipe, body, two inlets at 45° with caps
    const xo = xWallIn + wallT;
    hpipe(xo, xo + 8 * S, yF, odP);
    b.rect('FP-VALV', xo + 8 * S, yF - 3 * S, 3.2 * S, 6 * S);
    const inl = (sgn: number): void => {
      const x0 = xo + 11.2 * S;
      const y0 = yF + sgn * 1.6 * S;
      const x1 = x0 + 5.2 * S;
      const y1 = y0 - 3.2 * S;
      b.line('FP-VALV', x0, y0 + 0.5 * S, x1, y1 + 0.5 * S);
      b.line('FP-VALV', x0, y0 - 0.5 * S, x1, y1 - 0.5 * S);
      b.circle('FP-VALV', x1 + 0.4 * S, y1 - 0.3 * S, 1.1 * S);
    };
    inl(1);
    inl(-1);
    reg(xo, yF - 7 * S, xo + 19 * S, yF + 4.5 * S);
    P.text('FP-ANNO', xo + 2 * S, yF + 6.4 * S, 2, 'FIRE DEPARTMENT CONNECTION', { vAlign: 'middle' });
    P.text('FP-ANNO', xo + 2 * S, yF + 9.2 * S, 2, `${sp.fdc.inlets} x 2-1/2" INLETS`, { vAlign: 'middle' });
    tagJobs.push(() => P.callout([xCV, yF + 0.3 * dC], ['CHECK VALVE'], 2, [90, 135, 45]));
    tagJobs.push(() => P.callout([xDr, yF - 2.6 * S], ['BALL DRIP'], 2, [270, 225, 315]));
  }

  // roof / sky label
  b.text('FP-ANNO', X(BL + 4), Zr(roofF.elevationM + 0.6), 2, 'ROOF', { vAlign: 'middle' });
  P.addHard({ x0: X(BL + 4), y0: Zr(roofF.elevationM + 0.6) - 1 * S, x1: X(BL + 4) + textWidth(2 * S, 'ROOF'), y1: Zr(roofF.elevationM + 0.6) + 1 * S });

  tagJobs.forEach((j) => j());
  if (process.env.FIRE_DEBUG && P.fallbacks.length) console.warn('FP-106 tag fallbacks:', P.fallbacks);

  // ───────────────────────── title, data table, legend, notes ─────────────────────────
  sheetTitle(c, 30, 568, 'STANDPIPE RISER DIAGRAM - ELEVATION', `VERTICAL SCALE 1:${S} (TRUE FLOOR LEVELS) - HORIZONTAL SCHEMATIC`);

  const typeName: Record<string, string> = {
    'automatic-wet': 'AUTOMATIC WET',
    'automatic-dry': 'AUTOMATIC DRY',
    'semiautomatic-dry': 'SEMIAUTOMATIC DRY',
    'manual-wet': 'MANUAL WET',
    'manual-dry': 'MANUAL DRY'
  };
  const data: string[][] = [
    ['ITEM', 'VALUE'],
    ['SYSTEM', `CLASS ${sp.standpipeClass} ${typeName[sp.systemType] ?? sp.systemType.toUpperCase()}${sp.combined ? ' (COMBINED)' : ''}`],
    ['RISERS', `${N} x ${fmtSize(sp.riserSizeIn)}  (MIN. ${fmtSize(sp.minRiserSizeIn)})`],
    ['SUPPLY MAIN', fmtSize(sp.supplyMainSizeIn)],
    ['DEMAND', `${sp.demandFlowGpm} GPM @ ${psi(sp.topOutletResidualPsi)} PSI TOP OUTLET`],
    ['PUMP DISCHARGE', `${psi(sp.pressureAtPumpDischargePsi)} PSI`],
    ['GOVERNING RISER', sp.governingRiserTag],
    ['BUILDING HEIGHT', `${sp.buildingHeightFt.toFixed(0)} FT${sp.highRise ? ' (HIGH-RISE, IBC 202)' : ''}`],
    ['FDC', `${sp.fdc.inlets} x 2-1/2" INLETS, ${fmtSize(sp.fdc.pipeSizeIn)} PIPE`]
  ];
  const dCols = [34, 150];
  drawTable(c, PANEL_X + 4, 576, dCols, data, { title: 'STANDPIPE SYSTEM DATA', th: 2.2 });

  // legend
  const lgTop = 576 - (data.length * (2.2 * 1.3 + 2.8) + 2.2 * 2.6) - 6;
  const lg = drawStandpipeLegend(c, PANEL_X + 4, lgTop);
  const notes = riserDiagramNotes(c);
  drawNotes(c, PANEL_X + 4, lgTop - lg.h - 6, FRAME.x1 - PANEL_X - 8, 'GENERAL NOTES', notes, 2.2);
}

/** Symbol legend of the standpipe sheets (two columns). Returns the paper size. */
export function drawStandpipeLegend(c: Ctx, xP: number, yTopP: number): { w: number; h: number } {
  const { b, sheet } = c;
  const s = sheet.scale;
  const X = (v: number): number => PX(c, v);
  const Y = (v: number): number => PY(c, v);
  const items: { label: string; draw: (x: number, y: number) => void }[] = [
    { label: 'STANDPIPE RISER (TRUE OD)', draw: (x, y) => b.pipe('FP-PIPE-DISC', [[x - 8 * s, y], [x + 8 * s, y]], 1.6 * s, false) },
    { label: 'DRAIN RISER / DRAIN', draw: (x, y) => b.pipe('FP-PIPE-DRAN', [[x - 8 * s, y], [x + 8 * s, y]], 1.0 * s, false) },
    { label: '2-1/2" ANGLE HOSE VALVE, CAP', draw: (x, y) => hoseValve(b, x + 2 * s, y, 180, 5 * s) },
    {
      label: 'PRESSURE-REGULATING VALVE (PRV)',
      draw: (x, y) => prvSymbol(b, x, y, 4.4 * s)
    },
    { label: 'OS&Y GATE VALVE (SUPERVISED)', draw: (x, y) => gateValve(b, x, y, 0, 4 * s) },
    { label: 'SUPERVISED BUTTERFLY VALVE', draw: (x, y) => butterflyValve(b, x, y, 0, 4.2 * s) },
    { label: 'CHECK VALVE', draw: (x, y) => checkValve(b, x, y, 0, 4.4 * s) },
    {
      label: 'WATERFLOW SWITCH (FS)',
      draw: (x, y) => {
        b.line('FP-VALV', x, y - 2 * s, x, y);
        b.rect('FP-VALV', x - 2.3 * s, y, 4.6 * s, 2.8 * s);
        b.text('FP-VALV', x, y + 1.4 * s, 1.8, 'FS', { align: 'center', vAlign: 'middle' });
      }
    },
    { label: 'BALL VALVE / BALL DRIP', draw: (x, y) => ballValve(b, x, y, 0, 3.4 * s) },
    {
      label: 'AUTOMATIC AIR RELEASE',
      draw: (x, y) => {
        ballValve(b, x, y, 90, 3.2 * s);
        b.solid('FP-PIPE-DISC', [[x, y + 4.8 * s], [x - 0.7 * s, y + 2.8 * s], [x + 0.7 * s, y + 2.8 * s]]);
        b.line('FP-PIPE-DISC', x, y + 1.6 * s, x, y + 2.8 * s);
        b.line('FP-PIPE-DISC', x, y - 1.6 * s, x, y - 2.6 * s);
      }
    }
  ];
  const th = 2.2;
  const colW = 98;
  const rowH = 9;
  const colRows = Math.ceil(items.length / 2);
  const w = colW * 2 + 4;
  const h = 9 + colRows * rowH + 2;
  b.rect('FP-TABL', X(xP), Y(yTopP - h), w * s, h * s);
  b.text('FP-ANNO', X(xP + 3), Y(yTopP - 4.5), th * 1.35, 'LEGEND', { vAlign: 'middle' });
  b.line('FP-TABL', X(xP), Y(yTopP - 9), X(xP + w), Y(yTopP - 9));
  items.forEach((it, i) => {
    const col = i < colRows ? 0 : 1;
    const row = i % colRows;
    const x0 = xP + 2 + col * colW;
    const y = yTopP - 9 - rowH * (row + 0.5);
    it.draw(X(x0 + 10), Y(y));
    b.text('FP-ANNO', X(x0 + 20), Y(y), th, it.label, { vAlign: 'middle' });
  });
  return { w, h };
}
