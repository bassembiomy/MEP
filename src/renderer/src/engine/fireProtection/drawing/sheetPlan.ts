/**
 * FP-101 — Fire pump room plan: walls, partial tank, pumps, controllers, double-line piping at true OD,
 * valves with tags, trench, doors/louvres, dimension strings, equipment/valve keys and room notes.
 */
import type { PlacedValve, ValveKind } from '../fpTypes';
import { butterflyValveLengthMm, formatPipeSize, gateValveLengthMm } from '../standards/pipeData';
import {
  ballValve,
  butterflyValve,
  checkValve,
  concentricReducer,
  doorPlan,
  eccentricReducer,
  flexibleCoupling,
  flowMeter,
  gateValve,
  hoseValve,
  louverPlan,
  northArrow,
  pressureGauge,
  pumpPlan,
  reliefValve
} from './symbols';
import { type Box, type Ctx, FRAME, Placer, PX, PY, TBLK, autoCols, drawNotes, drawSymbolLegend, drawTable, sheetTitle, splitInterval, textWidth, wrapText } from './sheetKit';
import { type PipeDraw, drawPipeNetwork, layerOfService, odOf, tankLayout, westWallMm } from './sheetGeom';

/** Extents (room mm) and paper footprint needed by the plan at scale `s`. */
export function planFit(c: Pick<Ctx, 'r'>, s: number): { widthP: number; heightP: number } {
  const { r } = c;
  const wW = westWallMm(r);
  const tl = tankLayout(r);
  const yMin = Math.min(-250, tl.yLo - tl.tw);
  const yMax = Math.max(r.room.widthMm + 250, tl.yHi + tl.tw);
  const widthP = (wW + 2000 + r.room.lengthMm + 250) / s + 52;
  const heightP = (yMax - yMin) / s + 46 + 24;
  return { widthP, heightP };
}

/** Smallest standard scale at which the plan fits the left drawing zone. */
export function pickPlanScale(c: Pick<Ctx, 'r'>): number {
  for (const s of [20, 25, 50, 75, 100]) {
    const f = planFit(c, s);
    if (f.heightP <= 548 && f.widthP <= 330) return s;
  }
  return 100;
}

const KIND_NAME: Record<ValveKind, string> = {
  'os&y-gate': 'OS&Y GATE VALVE (SUPERVISED)',
  butterfly: 'BUTTERFLY VALVE',
  check: 'SWING CHECK VALVE',
  relief: 'PRESSURE RELIEF VALVE',
  'circulation-relief': 'CIRCULATION RELIEF VALVE',
  'flow-meter': 'FLOW METER',
  'pressure-gauge': 'PRESSURE GAUGE',
  'eccentric-reducer': 'ECCENTRIC REDUCER (FLAT TOP)',
  'concentric-increaser': 'CONCENTRIC INCREASER',
  'hose-valve': 'HOSE VALVE 2-1/2" (TEST HEADER)',
  'ball-valve': 'BALL VALVE',
  'flexible-coupling': 'FLEXIBLE COUPLING',
  'tamper-switch': 'TAMPER SWITCH (VALVE SUPERVISION)',
  'sensing-check': 'SENSING-LINE CHECK VALVE, 3/32" ORIFICE'
};
export const valveKindName = (k: ValveKind): string => KIND_NAME[k];

const MIN_SYM = 120;

/** Draw one placed valve symbol; returns its half-extent for collision registration. */
export function drawValveSymbol(c: Ctx, v: PlacedValve, x: number, y: number): number {
  const { b } = c;
  const od = odOf(v.sizeIn);
  const d = Math.max(od, MIN_SYM);
  const a = v.angleDeg;
  switch (v.kind) {
    case 'os&y-gate':
      gateValve(b, x, y, a, d);
      break;
    case 'butterfly':
      butterflyValve(b, x, y, a, d);
      break;
    case 'check':
      checkValve(b, x, y, a, d);
      break;
    case 'relief':
    case 'circulation-relief':
      reliefValve(b, x, y, a, d);
      break;
    case 'flow-meter':
      flowMeter(b, x, y, a, d);
      break;
    case 'pressure-gauge':
      pressureGauge(b, x, y, a - 90, d);
      break;
    case 'eccentric-reducer':
      eccentricReducer(b, x, y, a, od, od * 0.84);
      break;
    case 'concentric-increaser':
      concentricReducer(b, x, y, a, od * 0.8, od);
      break;
    case 'hose-valve':
      hoseValve(b, x, y, 180, d);
      break;
    case 'ball-valve':
      ballValve(b, x, y, a, d);
      break;
    case 'flexible-coupling':
      flexibleCoupling(b, x, y, a, d);
      break;
    case 'sensing-check': {
      // 1/2" line: symbol enlarged to stay readable, with the 3/32" orifice dot on the clapper
      const ds = Math.max(d, 220);
      checkValve(b, x, y, a, ds);
      b.circle('FP-VALV', x, y, 0.07 * ds);
      return 1.25 * ds;
    }
    case 'tamper-switch': {
      // limit switch box on the valve yoke
      const w = 0.32 * d;
      b.rect('FP-VALV', x + 0.2 * d, y + 0.45 * d, w, w);
      b.line('FP-VALV', x + 0.1 * d, y + 0.6 * d, x + 0.2 * d, y + 0.6 * d);
      break;
    }
  }
  return 1.25 * d;
}

interface Win {
  y0: number;
  y1: number;
}

export function drawPlanSheet(c: Ctx): void {
  const { b, sheet, r } = c;
  const s = sheet.scale;
  const room = r.room;
  const tank = r.tank;
  const L = room.lengthMm;
  const W = room.widthMm;
  const wW = westWallMm(r);
  const wT = room.wallThicknessMm;
  const tl = tankLayout(r);
  const yMin = Math.min(-wT, tl.yLo - tl.tw);
  const yMax = Math.max(W + wT, tl.yHi + tl.tw);
  const stripW = 2000;

  // origin: leftmost tank strip edge at paper x = 32, lowest plan extent at paper y = 70
  const OX = PX(c, 32) + wW + stripW;
  const OY = PY(c, 70) - yMin;
  const X = (x: number): number => OX + x;
  const Y = (y: number): number => OY + y;
  const frameBounds: Box = { x0: PX(c, FRAME.x0 + 1), y0: PY(c, FRAME.y0 + 1), x1: PX(c, FRAME.x1 - 1), y1: PY(c, FRAME.y1 - 1) };
  const P = new Placer(c, frameBounds);
  P.addRect(PX(c, TBLK.x0), PY(c, TBLK.y0), (TBLK.x1 - TBLK.x0) * s, (TBLK.y1 - TBLK.y0) * s);

  const segLine = (layer: string, x1: number, y1: number, x2: number, y2: number): void => b.line(layer, X(x1), Y(y1), X(x2), Y(y2));
  const hatched = (x: number, y: number, w: number, h: number, layer = 'FP-WALL'): void => {
    if (w <= 0 || h <= 0) return;
    P.addRect(X(x), Y(y), w, h);
    b.rect(layer, X(x), Y(y), w, h);
    b.hatchRect(X(x), Y(y), w, h, 1.6);
  };

  // ───────────────────────── openings in the walls ─────────────────────────
  const pipeDia = (sizeIn: number): number => odOf(sizeIn) + 140;
  const holesSouth: [number, number][] = [];
  const holesNorth: [number, number][] = [];
  const holesWest: [number, number][] = [];
  for (const p of room.pipes) {
    if (p.service === 'sensing' || p.service === 'fuel') continue;
    const h = pipeDia(p.sizeIn) / 2;
    for (const q of [p.points[0], p.points[p.points.length - 1]]) {
      if (Math.abs(q[0] + wW) < 2) holesWest.push([q[1] - h, q[1] + h]);
      if (Math.abs(q[1] + wT) < 2) holesSouth.push([q[0] - h, q[0] + h]);
      if (Math.abs(q[1] - (W + wT)) < 2) holesNorth.push([q[0] - h, q[0] + h]);
    }
  }
  for (const pen of room.penetrations) {
    const half = (pen.kind === 'puddle-flange' ? pipeDia(pen.sizeIn) : pen.sleeveIdMm + 120) / 2;
    if (pen.wall === 'west') holesWest.push([pen.y - half, pen.y + half]);
    else if (pen.wall === 'south') holesSouth.push([pen.x - half, pen.x + half]);
    else if (pen.wall === 'north') holesNorth.push([pen.x - half, pen.x + half]);
  }
  // door / louvres: shift along the wall to clear pipe openings
  const clear = (x0: number, w: number, holes: [number, number][], lo: number, hi: number): number => {
    const fits = (xx: number): boolean => xx >= lo && xx + w <= hi && holes.every(([a, z]) => xx + w <= a - 100 || xx >= z + 100);
    if (fits(x0)) return x0;
    for (let d = 50; d < 12000; d += 50) {
      if (fits(x0 - d)) return x0 - d;
      if (fits(x0 + d)) return x0 + d;
    }
    return x0;
  };
  const doors = room.doors.map((d) => ({ ...d, x: clear(d.x, d.widthMm, holesSouth, 200, L - 100) }));
  for (const d of doors) if (d.wall === 'south') holesSouth.push([d.x, d.x + d.widthMm]);
  const louvers = room.louvers.map((lv) => {
    const holes = lv.wall === 'north' ? holesNorth : holesSouth;
    const x = clear(lv.x, lv.widthMm, holes, 200, L - 100);
    holes.push([x, x + lv.widthMm]);
    return { ...lv, x };
  });

  // ───────────────────────── walls ─────────────────────────
  const wallH = (y: number, holes: [number, number][]): void => {
    for (const [a, z] of splitInterval(-wW, L + wT, holes)) hatched(a, y, z - a, wT);
  };
  wallH(-wT, holesSouth);
  wallH(W, holesNorth);
  for (const [a, z] of splitInterval(0, W, holesWest)) hatched(-wW, a, wW, z - a);
  hatched(L, 0, wT, W);
  if (yMin < -wT) hatched(-wW, yMin, wW, -wT - yMin);
  if (yMax > W + wT) hatched(-wW, W + wT, wW, yMax - (W + wT));

  // ───────────────────────── tank strip ─────────────────────────
  const xs = -wW - stripW;
  hatched(xs, tl.yLo - tl.tw, stripW, tl.tw, 'FP-TANK');
  hatched(xs, tl.yHi, stripW, tl.tw, 'FP-TANK');
  for (const dv of tl.dividers) hatched(xs, dv.y0, stripW, dv.y1 - dv.y0, 'FP-TANK');
  // break line (zig-zag) at the cut edge of the strip
  {
    const pts: [number, number][] = [];
    let up = true;
    for (let y = tl.yLo - tl.tw; y <= tl.yHi + tl.tw; y += 500) {
      pts.push([X(xs + (up ? 90 : -90)), Y(y)]);
      up = !up;
    }
    b.polyline('FP-TANK', pts, false);
  }
  // water level (dashed) – compartment fill outline
  tl.comps.forEach((cp) => {
    b.rect('FP-WATR', X(xs + 150), Y(cp.y0 + 150), stripW - 150 - 150, cp.y1 - cp.y0 - 300);
  });
  // sump pits + anti-vortex plates + suction elbows (below floor, dashed)
  const sp = tank.sump;
  tl.sumps.forEach((sm) => {
    b.rect('FP-HIDN', X(-wW - sp.pitLengthMm), Y(sm.y - sp.pitWidthMm / 2), sp.pitLengthMm, sp.pitWidthMm);
    const pcx = -wW - sp.plateCentreFromWallMm;
    b.rect('FP-HIDN', X(pcx - sp.vortexPlateMm / 2), Y(sm.y - sp.vortexPlateMm / 2), sp.vortexPlateMm, sp.vortexPlateMm);
    b.line('FP-HIDN', X(pcx - sp.vortexPlateMm / 2), Y(sm.y - sp.vortexPlateMm / 2), X(pcx + sp.vortexPlateMm / 2), Y(sm.y + sp.vortexPlateMm / 2));
    b.line('FP-HIDN', X(pcx - sp.vortexPlateMm / 2), Y(sm.y + sp.vortexPlateMm / 2), X(pcx + sp.vortexPlateMm / 2), Y(sm.y - sp.vortexPlateMm / 2));
    P.addRect(X(-wW - sp.pitLengthMm), Y(sm.y - sp.pitWidthMm / 2), sp.pitLengthMm, sp.pitWidthMm);
  });

  // ───────────────────────── trench ─────────────────────────
  const tr = room.trench;
  const pit = room.equipment.find((e) => e.kind === 'drain-pit');
  const tpts = tr.path.map((q) => [q[0], q[1]] as [number, number]);
  if (pit && tpts.length >= 2) {
    const last = tpts[tpts.length - 1];
    const inside = last[0] >= pit.rect.x && last[0] <= pit.rect.x + pit.rect.w && last[1] >= pit.rect.y && last[1] <= pit.rect.y + pit.rect.h;
    if (inside) {
      const prev = tpts[tpts.length - 2];
      if (Math.abs(prev[0] - last[0]) < 1) last[1] = prev[1] > last[1] ? pit.rect.y + pit.rect.h : pit.rect.y;
      else last[0] = prev[0] > last[0] ? pit.rect.x + pit.rect.w : pit.rect.x;
    }
  }
  // merge collinear points
  const tp: [number, number][] = [tpts[0]];
  for (let i = 1; i < tpts.length - 1; i++) {
    const a = tp[tp.length - 1];
    const q = tpts[i];
    const n = tpts[i + 1];
    const col = (Math.abs(a[0] - q[0]) < 1 && Math.abs(q[0] - n[0]) < 1) || (Math.abs(a[1] - q[1]) < 1 && Math.abs(q[1] - n[1]) < 1);
    if (!col) tp.push(q);
  }
  tp.push(tpts[tpts.length - 1]);
  const trHalf = tr.widthMm / 2;
  const slopeWin: Win = { y0: 0, y1: 0 };
  const labelWin: Win = { y0: 0, y1: 0 };
  // crossing pipes split the trench label windows
  const crossY = room.pipes
    .filter((p) => p.service !== 'sensing' && p.service !== 'fuel')
    .flatMap((p) => p.points.slice(1).map((q, i) => [p.points[i], q]))
    .filter(([a, q]) => Math.abs(a[1] - q[1]) < 1 && Math.min(a[0], q[0]) < tr.path[0][0] && Math.max(a[0], q[0]) > tr.path[0][0])
    .map(([a]) => a[1])
    .sort((p, q) => p - q);
  {
    const ys = [pit ? pit.rect.y + pit.rect.h : 0, ...crossY, tr.path[0][1]];
    let best = -1;
    let second = -1;
    for (let i = 0; i + 1 < ys.length; i++) {
      const len = ys[i + 1] - ys[i];
      if (best < 0 || len > ys[best + 1] - ys[best]) {
        second = best;
        best = i;
      } else if (second < 0 || len > ys[second + 1] - ys[second]) second = i;
    }
    if (best >= 0) {
      labelWin.y0 = ys[best] + 250;
      labelWin.y1 = ys[best + 1] - 250;
    }
    if (second >= 0) {
      slopeWin.y0 = ys[second] + 250;
      slopeWin.y1 = ys[second + 1] - 250;
    }
  }
  for (let i = 0; i + 1 < tp.length; i++) {
    const [a, q] = [tp[i], tp[i + 1]];
    const vertical = Math.abs(a[0] - q[0]) < 1;
    const x0 = vertical ? a[0] - trHalf : Math.min(a[0], q[0]);
    const y0 = vertical ? Math.min(a[1], q[1]) : a[1] - trHalf;
    const w = vertical ? tr.widthMm : Math.abs(a[0] - q[0]);
    const h = vertical ? Math.abs(a[1] - q[1]) : tr.widthMm;
    b.rect('FP-TRCH', X(x0), Y(y0), w, h);
    P.addRect(X(x0), Y(y0), w, h, true);
    // grating bars every 200 mm (skipped where a label sits)
    if (vertical) {
      for (let y = y0 + 100; y < y0 + h; y += 200) {
        if ((y > labelWin.y0 - 80 && y < labelWin.y1 + 80) || (y > slopeWin.y0 - 80 && y < slopeWin.y1 + 80)) continue;
        segLine('FP-TRCH', x0, y, x0 + w, y);
      }
    } else {
      for (let x = x0 + 100; x < x0 + w; x += 200) segLine('FP-TRCH', x, y0, x, y0 + h);
    }
  }
  if (pit) {
    b.rect('FP-TRCH', X(pit.rect.x), Y(pit.rect.y), pit.rect.w, pit.rect.h);
    b.line('FP-TRCH', X(pit.rect.x), Y(pit.rect.y), X(pit.rect.x + pit.rect.w), Y(pit.rect.y + pit.rect.h));
    b.line('FP-TRCH', X(pit.rect.x), Y(pit.rect.y + pit.rect.h), X(pit.rect.x + pit.rect.w), Y(pit.rect.y));
    P.addRect(X(pit.rect.x), Y(pit.rect.y), pit.rect.w, pit.rect.h);
  }
  {
    const tx = tr.path[0][0];
    const wl = labelWin.y1 - labelWin.y0;
    const tt = `TRENCH ${tr.widthMm} WIDE c/w GRATING`;
    const th = 2.5;
    const need = textWidth(th * s, tt);
    if (wl > 0) {
      const t = wl >= need ? tt : 'TRENCH + GRATING';
      b.text('FP-ANNO', X(tx) + 0.9 * s, Y((labelWin.y0 + labelWin.y1) / 2), th, t, { rotationDeg: 90, align: 'center', vAlign: 'middle' });
    }
    // slope arrow (downhill toward the pit) + "1%"
    const wl2 = slopeWin.y1 - slopeWin.y0;
    if (wl2 > 600) {
      const yA = slopeWin.y1 - 100;
      const yB = slopeWin.y0 + 100;
      segLine('FP-TRCH', tx - 60, yA, tx - 60, yB);
      b.solid('FP-TRCH', [[X(tx - 60), Y(yB - 120)], [X(tx - 60 - 70), Y(yB + 160)], [X(tx - 60 + 70), Y(yB + 160)]]);
      b.text('FP-ANNO', X(tx) + 0.9 * s, Y((yA + yB) / 2), 2.5, 'SLOPE 1%', { rotationDeg: 90, align: 'center', vAlign: 'middle' });
    }
  }

  // ───────────────────────── equipment ─────────────────────────
  for (const e of room.equipment) {
    if (e.kind === 'fire-pump') {
      const mp = r.pumps.mainPumps.find((m) => m.tag === e.tag);
      pumpPlan(b, { x: X(e.rect.x), y: Y(e.rect.y), w: e.rect.w, h: e.rect.h }, mp?.pumpType === 'horizontal-split-case' ? 'hsc' : 'end-suction', mp?.driver ?? 'electric', e.tag);
      const pad = e.pad ?? e.rect;
      P.addRect(X(pad.x), Y(pad.y), pad.w, pad.h);
    } else if (e.kind === 'jockey-pump') {
      pumpPlan(b, { x: X(e.rect.x), y: Y(e.rect.y), w: e.rect.w, h: e.rect.h }, 'jockey', 'electric', e.tag);
      const pad = e.pad ?? e.rect;
      P.addRect(X(pad.x), Y(pad.y), pad.w, pad.h);
    } else if (e.kind === 'fuel-tank') {
      const q = e.rect;
      b.rect('FP-EQPM', X(q.x), Y(q.y), q.w, q.h);
      b.circle('FP-EQPM', X(q.x + q.w * 0.8), Y(q.y + q.h / 2), 120);
      b.line('FP-EQPM', X(q.x + q.w * 0.15), Y(q.y), X(q.x + q.w * 0.15), Y(q.y + q.h));
      b.text('FP-ANNO', X(q.x + q.w * 0.42), Y(q.y + q.h / 2), 2.5, e.tag, { align: 'center', vAlign: 'middle' });
      if (e.pad) {
        b.rect('FP-PADS', X(e.pad.x), Y(e.pad.y), e.pad.w, e.pad.h);
        P.addRect(X(e.pad.x), Y(e.pad.y), e.pad.w, e.pad.h);
      }
    } else if (e.kind === 'controller' || e.kind === 'transfer-switch') {
      const q = e.rect;
      const lf = q.h / 2;
      b.rect('FP-ELEC', X(q.x), Y(q.y), q.w, q.h);
      b.line('FP-ELEC', X(q.x), Y(q.y), X(q.x + q.w), Y(q.y + q.h));
      b.line('FP-ELEC', X(q.x), Y(q.y), X(q.x - lf), Y(q.y));
      b.arc('FP-ELEC', X(q.x), Y(q.y), lf, 90, 180);
      b.line('FP-ELEC', X(q.x), Y(q.y + q.h), X(q.x - lf), Y(q.y + q.h));
      b.arc('FP-ELEC', X(q.x), Y(q.y + q.h), lf, 180, 270);
      const th = Math.min(2.5, (q.h * 0.55) / (0.6 * s * e.tag.length));
      b.text('FP-ANNO', X(q.x + q.w / 2), Y(q.y + 0.3 * q.h), Math.max(1.8, th), e.tag, { rotationDeg: 90, align: 'center', vAlign: 'middle' });
      const kind = e.tag.startsWith('FPC') ? (r.pumps.mainPumps[Number(e.tag.slice(4)) - 1]?.driver === 'diesel' ? 'DIESEL' : 'ELECTRIC') : e.tag.startsWith('JPC') ? 'JOCKEY' : '';
      if (kind && textWidth(1.8 * s, kind) < q.h * 0.42) b.text('FP-ANNO', X(q.x + q.w / 2), Y(q.y + 0.74 * q.h), 1.8, kind, { rotationDeg: 90, align: 'center', vAlign: 'middle' });
      // NEC 110.26 working space (dashed) in front of the controller
      b.rect('FP-HIDN', X(q.x - 1000), Y(q.y), 1000, q.h);
      if (q.h >= 700) {
        b.text('FP-ANNO', X(q.x - 1000 + 170), Y(q.y + q.h / 2), 1.8, '1000 CLEAR', { rotationDeg: 90, align: 'center', vAlign: 'middle' });
        b.text('FP-ANNO', X(q.x - 1000 + 350), Y(q.y + q.h / 2), 1.8, 'WORK SPACE', { rotationDeg: 90, align: 'center', vAlign: 'middle' });
      } else {
        b.text('FP-ANNO', X(q.x - 1000 + 250), Y(q.y + q.h / 2), 1.8, '1000', { align: 'center', vAlign: 'middle' });
      }
      P.addRect(X(q.x - 1000), Y(q.y), 1000 + q.w, q.h);
    }
  }

  // ───────────────────────── piping ─────────────────────────
  const net: PipeDraw[] = [];
  for (const p of room.pipes) {
    const pts = p.points.map((q) => [X(q[0]), Y(q[1])] as [number, number]);
    const layer = layerOfService(p.service);
    const od = odOf(p.sizeIn);
    if (p.service === 'sensing' || p.service === 'fuel') {
      b.polyline(layer, pts, false);
    } else {
      net.push({ layer, od, pts, centre: od > 60 });
    }
    // soft obstacle bodies
    for (let i = 0; i + 1 < pts.length; i++) {
      const h = Math.max(od, 40) / 2 + 40;
      P.addSoft({ x0: Math.min(pts[i][0], pts[i + 1][0]) - h, y0: Math.min(pts[i][1], pts[i + 1][1]) - h, x1: Math.max(pts[i][0], pts[i + 1][0]) + h, y1: Math.max(pts[i][1], pts[i + 1][1]) + h });
    }
  }
  drawPipeNetwork(b, net);

  // ───────────────────────── doors & louvres ─────────────────────────
  for (const d of doors) {
    if (d.wall !== 'south') continue;
    doorPlan(b, X(d.x), Y(-wT), d.widthMm, { orientation: 'horizontal', thicknessMm: wT, swing: -1 });
    P.addRect(X(d.x), Y(-wT - d.widthMm / 2), d.widthMm, d.widthMm / 2);
  }
  for (const lv of louvers) {
    const north = lv.wall === 'north';
    louverPlan(b, X(lv.x), Y(north ? W : -wT), lv.widthMm, { orientation: 'horizontal', thicknessMm: wT });
  }

  // ───────────────────────── valves ─────────────────────────
  const valveAnchors: { v: PlacedValve; pos: [number, number] }[] = [];
  for (const v of room.valves) {
    const half = drawValveSymbol(c, v, X(v.x), Y(v.y));
    P.addHard({ x0: X(v.x) - half * 0.6, y0: Y(v.y) - half * 0.6, x1: X(v.x) + half * 0.6, y1: Y(v.y) + half * 0.6 });
    valveAnchors.push({ v, pos: [X(v.x), Y(v.y)] });
  }

  // ───────────────────────── section mark A-A ─────────────────────────
  const yCut = room.suctionLineY[0];
  const secX1 = xs + 350;
  const secX2 = L + wT + 300;
  b.sectionMark(X(secX1), Y(yCut), X(secX2), Y(yCut), 'A');
  P.addRect(X(secX1), Y(yCut), secX2 - secX1, 12 * s + 4 * s);

  // ───────────────────────── dimensions ─────────────────────────
  const dimPts = (x1: number, y1: number, x2: number, y2: number, off: number, txt?: string): void => {
    b.dimLinear(X(x1), Y(y1), X(x2), Y(y2), off, txt);
    const len = Math.round(Math.hypot(x2 - x1, y2 - y1));
    const t = txt ?? String(len);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    const cx = X((x1 + x2) / 2) + nx * off * s;
    const cy = Y((y1 + y2) / 2) + ny * off * s;
    const hw = textWidth(2.5 * s, t) / 2 + 0.5 * s;
    const hh = 2.5 * s + 0.5 * s;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    dimBoxes.push(horizontal ? { x0: cx - hw, y0: cy - 0.5 * s, x1: cx + hw, y1: cy + hh } : { x0: cx - hh, y0: cy - hw, x1: cx + 0.5 * s, y1: cy + hw });
  };
  const dimBoxes: Box[] = [];
  // south: header offset chain, internal length, overall
  dimPts(0, -wT, L, -wT, -33);
  dimPts(-wW, -wT, L + wT, -wT, -42);
  // east: pump CL chain, internal width, overall
  const sy = room.suctionLineY;
  const eastChain = [0, ...sy, W];
  for (let i = 0; i + 1 < eastChain.length; i++) dimPts(L + wT, eastChain[i], L + wT, eastChain[i + 1], -16);
  dimPts(L + wT, 0, L + wT, W, -25);
  dimPts(L + wT, -wT, L + wT, W + wT, -34);
  // header offset (inside the room, in the corridor between the pumps)
  if (sy.length >= 2) {
    const yD = (room.equipment.find((e) => e.tag === 'FP-1')!.pad!.y + room.equipment.find((e) => e.tag === 'FP-1')!.pad!.h + room.equipment.find((e) => e.tag === 'FP-2')!.pad!.y) / 2 + 200;
    dimPts(0, yD, room.headerX, yD, 0);
    P.addRect(X(0), Y(yD) - 1 * s, room.headerX, 6 * s);
  } else {
    dimPts(0, 4300, room.headerX, 4300, 0);
  }
  // suction straight run (after the OS&Y gate valve to the eccentric reducer)
  {
    const gate = room.valves.find((v) => v.kind === 'os&y-gate' && Math.abs(v.y - sy[0]) < 2);
    const ecc = room.valves.find((v) => v.kind === 'eccentric-reducer' && Math.abs(v.y - sy[0]) < 2);
    if (gate && ecc) {
      const x1 = gate.x + gateValveLengthMm(gate.sizeIn) / 2;
      const x2 = ecc.x - odOf(ecc.sizeIn) / 2;
      const yEdge = sy[0] - odOf(gate.sizeIn) / 2;
      dimPts(x1, yEdge, x2, yEdge, -8);
      P.addRect(X(x1), Y(yEdge) - 9 * s, x2 - x1, 9 * s);
    }
  }
  // pump pad and header-to-controller dims are shown through the layout checks on FP-105

  // ───────────────────────── valve tags ─────────────────────────
  // group valves that share a location
  const groups: { tag: string; pos: [number, number] }[] = [];
  for (const va of [...valveAnchors].sort((p, q) => p.pos[0] - q.pos[0] || p.pos[1] - q.pos[1])) {
    const g = groups.find((q) => Math.hypot(q.pos[0] - va.pos[0], q.pos[1] - va.pos[1]) < 80);
    if (g) g.tag = g.tag + '/' + va.v.tag.replace('V-', '');
    else groups.push({ tag: va.v.tag, pos: va.pos });
  }
  const interior: Box = { x0: X(60), y0: Y(60), x1: X(L - 60), y1: Y(W - 60) };
  const outerBounds = frameBounds;
  for (const g of groups) {
    const inside = g.pos[0] > interior.x0 && g.pos[0] < interior.x1 && g.pos[1] > interior.y0 && g.pos[1] < interior.y1;
    const prefer = g.pos[1] < Y(1200) ? [270, 0, 180, 315, 225, 45, 135, 90] : undefined;
    if (inside) P.setBounds(interior);
    else P.setBounds(outerBounds);
    P.tag(g.pos, g.tag, prefer);
  }
  P.setBounds(outerBounds);

  // dimension text and the sheet title are now off-limits for callouts
  for (const bx of dimBoxes) P.addHard(bx);
  P.addRect(X(-wW), Y(-wT - 44 * s), wW + L + wT, 44 * s);
  P.addRect(X(L + wT), Y(-wT - 3 * s), 38 * s, W + 2 * wT + 6 * s);
  P.addRect(PX(c, 28), PY(c, 17), 105 * s, 20 * s);
  const fallbackTags = P.fallbacks.length;
  void fallbackTags;

  // ───────────────────────── labels & callouts ─────────────────────────
  P.setBounds({ x0: frameBounds.x0, y0: PY(c, 40), x1: frameBounds.x1, y1: frameBounds.y1 });
  const inRoom: Box = { x0: X(40), y0: Y(40), x1: X(L - 40), y1: Y(W - 40) };
  // pump callouts
  for (const e of room.equipment) {
    if (e.kind !== 'fire-pump' && e.kind !== 'jockey-pump') continue;
    const mp = r.pumps.mainPumps.find((m) => m.tag === e.tag);
    const lines = mp
      ? [`${e.tag} ${mp.driver === 'diesel' ? 'DIESEL' : 'ELECTRIC'} ${mp.role === 'duty' ? 'DUTY' : 'STANDBY'}`, `${mp.ratedFlowGpm} GPM @ ${mp.ratedNetPressurePsi} PSI`, `${mp.driverHp} HP ${mp.pumpType === 'horizontal-split-case' ? 'HORIZ. SPLIT-CASE' : 'END-SUCTION'}`]
      : [`${e.tag} JOCKEY PUMP`, `${r.pumps.jockey.ratedFlowGpm} GPM @ ${r.pumps.jockey.ratedNetPressurePsi} PSI`, `${r.pumps.jockey.motorHp} HP`];
    P.setBounds(inRoom);
    const rc = e.rect;
    P.callout([X(rc.x + rc.w), Y(rc.y + rc.h * 0.75)], lines, 2.2, [0, 30, 330, 60, 300]);
  }
  P.setBounds(inRoom);
  const ft = room.equipment.find((e) => e.kind === 'fuel-tank');
  if (ft) {
    const fuelL = r.pumps.mainPumps.find((m) => m.fuelTankLiters)?.fuelTankLiters;
    P.callout([X(ft.rect.x + ft.rect.w), Y(ft.rect.y + ft.rect.h * 0.5)], [`${ft.tag} DIESEL FUEL TANK${fuelL ? ' ' + Math.round(fuelL) + ' L' : ''}`, 'WITH BUND (110 % CAPACITY)'], 2.2, [0, 30, 330, 60]);
  }
  if (pit) P.callout([X(pit.rect.x + pit.rect.w / 2), Y(pit.rect.y + pit.rect.h)], [`${pit.tag} DRAIN PIT ${pit.rect.w} x ${pit.rect.h}`, `${tr.outlet.drainIn}" DRAIN TO INDIRECT WASTE`], 2.2, [90, 135, 45, 180, 0]);

  // exterior / outside callouts
  P.setBounds(outerBounds);
  const out = room.systemOutlet;
  P.callout([X(out.x), Y(out.y)], [`SYSTEM OUTLET ${formatPipeSize(out.sizeIn)}`, 'TO BUILDING RISER / FEED MAIN'], 2.2, [90, 45, 135, 0]);
  const hose = room.valves.filter((v) => v.kind === 'hose-valve');
  if (hose.length) {
    const hx = hose.reduce((a, v) => a + v.x, 0) / hose.length;
    P.callout([X(hx), Y(hose[0].y) - 1.6 * s], [`TEST HEADER - ${hose.length} x 2-1/2" HOSE VALVES`, 'ON EXTERIOR WALL (NFPA 20 / FLOW TEST)'], 2.2, [270, 225, 315, 180, 0]);
  }
  for (const d of doors) {
    if (d.wall === 'south') P.callout([X(d.x + d.widthMm * 0.5), Y(-wT - d.widthMm * 0.5)], [`DOUBLE DOOR ${d.widthMm} - OUTWARD SWING`, 'EXTERIOR ACCESS (IBC 913.2 / NFPA 20)'], 2.2, [270, 225, 315, 180]);
  }
  for (const lv of louvers) {
    const north = lv.wall === 'north';
    P.callout([X(lv.x + lv.widthMm / 2), Y(north ? W + wT : -wT)], [`LOUVRE ${lv.widthMm} WIDE`, lv.purpose.length > 44 ? lv.purpose.slice(0, 44).replace(/\s+\S*$/, '') : lv.purpose], 2.2, north ? [90, 45, 135] : [270, 225, 315]);
  }
  // tank callouts (inside the strip)
  P.setBounds({ x0: X(xs) + 2 * s, y0: Y(tl.yLo), x1: X(-wW) - 2 * s, y1: Y(tl.yHi) });
  tl.comps.forEach((cp, i) => {
    const vol = (Math.round(tl.compLen) / 1000) * tank.internalWidthM * tank.effectiveDepthM;
    const lines = [`TANK COMPARTMENT ${i + 1}`, `${(Math.round(tl.compLen) / 1000).toFixed(1)} x ${tank.internalWidthM.toFixed(1)} m`, `${vol.toFixed(0)} m3 EFFECTIVE`, '(PARTIAL - SEE FP-103)'];
    const mid = (cp.y0 + cp.y1) / 2;
    const cx = X(xs + stripW / 2 + 60);
    const cands: [number, number][] = [];
    for (const d of [0, 900, -900, 1500, -1500, 2100, -2100, 2700, -2700]) cands.push([cx, Y(mid + d)]);
    P.block(lines, 2.0, cands);
  });
  tl.sumps.forEach((sm, i) => {
    P.callout([X(-wW - sp.plateCentreFromWallMm), Y(sm.y + sp.pitWidthMm / 2)], [`SUMP PIT ${i + 1} (BELOW FLOOR)`, `ANTI-VORTEX PLATE ${sp.vortexPlateMm} SQ`], 2.0, [90, 135, 45, 180, 270]);
  });
  P.block(['SECTION A-A', '(SEE FP-102)'], 2.0, [[X(xs + 1100), Y(yCut - 1100)], [X(xs + 1100), Y(yCut + 1100)], [X(xs + 1100), Y(yCut - 1700)]]);
  P.setBounds(outerBounds);

  // ───────────────────────── titles, north arrow ─────────────────────────
  sheetTitle(c, 32, 30, 'FIRE PUMP ROOM - PLAN', `SCALE 1:${s}`);
  northArrow(b, X(xs + 1200), Y(yMax) + 12 * s);

  // ───────────────────────── right-hand zone: schedules / keys / notes ─────────────────────────
  const zx = Math.ceil(32 + (wW + stripW + L + wT) / s + 40 + 6);
  const th = 2.5;
  let yTop = 574;
  // equipment key
  {
    const rows: string[][] = [['TAG', 'EQUIPMENT']];
    for (const e of room.equipment) {
      const tagEnd = e.label.indexOf(' ');
      rows.push([e.tag, wrapText(e.label.slice(tagEnd + 1), 36).join('\n')]);
    }
    const cols = autoCols(rows, th, [16, 60]);
    const t = drawTable(c, zx, yTop, cols, rows, { title: 'EQUIPMENT KEY', th });
    yTop -= t.h + 8;
  }
  // valve key
  {
    const rows: string[][] = [['TAG', 'DESCRIPTION', 'SIZE', 'SERVICE']];
    for (const v of room.valves) rows.push([v.tag, KIND_NAME[v.kind], formatPipeSize(v.sizeIn), v.service.toUpperCase()]);
    const cols = autoCols(rows, th, [14, 62, 14, 22]);
    drawTable(c, zx, yTop, cols, rows, { title: 'VALVE KEY', th });
  }
  // legend, pump summary and room notes
  const lx = zx + 172;
  const lg = drawSymbolLegend(c, lx, 574);
  let y2 = 574 - lg.h - 8;
  {
    const rows: string[][] = [['TAG', 'DRIVER', 'PUMP TYPE', 'RATED', 'NET PSI', 'CHURN', '150 %', 'HP', 'RPM']];
    for (const p of r.pumps.mainPumps) {
      rows.push([
        p.tag,
        p.driver === 'diesel' ? 'DIESEL' : 'ELECTRIC',
        p.pumpType === 'horizontal-split-case' ? 'HSC' : p.pumpType === 'end-suction' ? 'END-SUCT.' : p.pumpType === 'vertical-inline' ? 'V-INLINE' : 'V-TURBINE',
        `${p.ratedFlowGpm} GPM`,
        String(Math.round(p.ratedNetPressurePsi)),
        `${Math.round(p.churnPressurePsi)} PSI`,
        `${Math.round(p.pressureAt150Psi)} PSI`,
        String(p.driverHp),
        String(p.speedRpm)
      ]);
    }
    const j = r.pumps.jockey;
    rows.push([j.tag, 'ELECTRIC', 'JOCKEY', `${j.ratedFlowGpm} GPM`, String(j.ratedNetPressurePsi), '-', '-', String(j.motorHp), '-']);
    const t = drawTable(c, lx, y2, autoCols(rows, 2.2), rows, { title: 'FIRE PUMP SET SUMMARY (SEE FP-105)', th: 2.2 });
    y2 -= t.h + 8;
  }
  // room notes + plan key notes below the keys (centre zone)
  drawNotes(c, lx, y2, 831 - lx - 6, 'ROOM NOTES', roomNotes(c));
  drawNotes(c, zx + 4, 262, 360, 'PLAN KEY NOTES', planNotes(c), 2.5);
  void butterflyValveLengthMm;
}

function planNotes(c: Ctx): string[] {
  const { r } = c;
  const room = r.room;
  return [
    `Pipe sizes: suction ${formatPipeSize(room.pipes.find((p) => p.service === 'suction')?.sizeIn ?? 6)}, discharge header ${formatPipeSize(room.pipes.find((p) => p.id === 'HDR-1')?.sizeIn ?? 6)}, test return ${formatPipeSize(room.pipes.find((p) => p.id === 'TST-1')?.sizeIn ?? 5)}; piping is drawn at true outside diameter.`,
    'Valve and equipment tags are keyed in the Equipment Key and Valve Key; the schedules and hydraulic calculations are on FP-105.',
    'Section A-A (FP-102) cuts through the FP-1 suction centre-line; Tank plan, Section B-B and the sump pit detail are on FP-103; the pump schematic is on FP-104.',
    'Dimensions in mm. Pump pads extend 150 mm beyond the skid; clear access of 900 mm minimum around pumps and 1000 mm in front of controllers.',
    'Louvres and the exterior door are shown in their coordinated positions clear of pipe penetrations; door leaves swing outward.'
  ];
}

function roomNotes(c: Ctx): string[] {
  const { r } = c;
  const room = r.room;
  const diesel = r.pumps.mainPumps.some((p) => p.driver === 'diesel');
  return [
    `Pump room fire separation: ${room.fireRatingHours}-hour rated walls, floor and roof, with protected openings (IBC 913.2.1, NFPA 20 4.12.1). Direct access from the exterior.`,
    `Heating to maintain at least 4.4 C at all times${diesel ? ' (21 C minimum in the diesel engine room)' : ''} - NFPA 20 4.12.2.`,
    `Floor drainage: ${room.trench.widthMm} mm grated trench at ${room.trench.slopePercent}% slope to the drain pit, ${room.trench.outlet.drainIn} in. drain to indirect waste.`,
    'Floor to slope toward the trench. Trench discharge through an indirect waste with air gap (IPC 802 / UPC 801).',
    `Clear head-room ${room.clearHeightMm} mm. Working space of 1000 mm minimum in front of every controller (NFPA 70 Art. 695 / 110.26).`
  ];
}
