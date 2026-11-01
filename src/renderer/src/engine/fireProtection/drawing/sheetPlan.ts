/**
 * FP-101 — Fire pump room plan: walls, partial tank, pumps, controllers, double-line piping at true OD,
 * valves with tags, trench, doors/louvres, dimension strings, equipment/valve keys and room notes.
 */
import type { PlacedEquipment, PlacedValve, ValveKind } from '../fpTypes';
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
import { type Box, type Ctx, FRAME, Placer, PX, PY, TBLK, autoCols, drawNotes, drawSymbolLegend, drawTable, drawTag, sheetTitle, splitInterval, textWidth, wrapText } from './sheetKit';
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
  // a pipe that has a penetration record gets its opening from that record
  const penAt = (wall: string, pos: number): boolean => room.penetrations.some((pn) => pn.wall === wall && Math.abs((wall === 'west' ? pn.y : pn.x) - pos) < 5);
  for (const p of room.pipes) {
    if (p.service === 'sensing' || p.service === 'fuel') continue;
    const h = pipeDia(p.sizeIn) / 2;
    for (const q of [p.points[0], p.points[p.points.length - 1]]) {
      if (Math.abs(q[0] + wW) < 2 && !penAt('west', q[1])) holesWest.push([q[1] - h, q[1] + h]);
      if (Math.abs(q[1] + wT) < 2 && !penAt('south', q[0])) holesSouth.push([q[0] - h, q[0] + h]);
      if (Math.abs(q[1] - (W + wT)) < 2 && !penAt('north', q[0])) holesNorth.push([q[0] - h, q[0] + h]);
    }
  }
  // puddle flange: concrete cast tight round the pipe; sleeve: wall opening = sleeve OD (ID + 2 x 10 mm steel)
  const SLV_T = 10;
  for (const pen of room.penetrations) {
    const half = (pen.kind === 'puddle-flange' ? odOf(pen.sizeIn) + 60 : pen.sleeveIdMm + 2 * SLV_T) / 2;
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
    P.addRect(X(-wW - sp.pitLengthMm), Y(sm.y - sp.pitWidthMm / 2), sp.pitLengthMm, sp.pitWidthMm, true);
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
  const sump = room.drainageSump;
  if (pit) {
    const q = pit.rect;
    b.rect('FP-TRCH', X(q.x), Y(q.y), q.w, q.h);
    P.addRect(X(q.x), Y(q.y), q.w, q.h);
    if (!sump.pumps.length) {
      b.line('FP-TRCH', X(q.x), Y(q.y), X(q.x + q.w), Y(q.y + q.h));
      b.line('FP-TRCH', X(q.x), Y(q.y + q.h), X(q.x + q.w), Y(q.y));
    } else {
      // duplex submersible sump pumps SP-n (low in the pit), riser with check + gate valve each, common header, discharge
      const n = sump.pumps.length;
      const pr = Math.min(0.14 * q.h, q.w / (2 * n + 1));
      const od = odOf(sump.dischargeSizeIn);
      const hy = q.y + 0.86 * q.h;
      const cx = q.x + q.w / 2;
      const vs = Math.max(od * 1.6, 130);
      sump.pumps.forEach((sp_, i) => {
        const px = q.x + (q.w * (i + 0.5)) / n;
        const py = q.y + 0.17 * q.h;
        b.circle('FP-EQPM', X(px), Y(py), pr);
        b.text('FP-ANNO', X(px), Y(py), 1.5, sp_.tag, { align: 'center', vAlign: 'middle' });
        b.pipe('FP-PIPE-DRAN', [[X(px), Y(py + pr)], [X(px), Y(hy)]], od, false);
        checkValve(b, X(px), Y(q.y + 0.6 * q.h), 90, vs);
        gateValve(b, X(px), Y(q.y + 0.76 * q.h), 90, vs);
      });
      b.pipe('FP-PIPE-DRAN', [[X(q.x + q.w / (2 * n)), Y(hy)], [X(q.x + q.w - q.w / (2 * n)), Y(hy)]], od, false);
      b.pipe('FP-PIPE-DRAN', [[X(cx), Y(hy)], [X(cx), Y(q.y + q.h / 2)]], od, false);
    }
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

  // ───────────────────────── wall penetrations: puddle flanges (tank wall) and sleeves + seals ─────────────────────────
  for (const pen of room.penetrations) {
    if (pen.kind === 'puddle-flange') {
      const fo = pen.puddleFlangeOdMm;
      // cast-in flange plate across the pipe, centred in the wall (10 mm plate drawn 60 mm for visibility)
      b.solid('FP-WALL', [[X(pen.x - 30), Y(pen.y - fo / 2)], [X(pen.x + 30), Y(pen.y - fo / 2)], [X(pen.x + 30), Y(pen.y + fo / 2)], [X(pen.x - 30), Y(pen.y + fo / 2)]]);
    } else {
      const idh = pen.sleeveIdMm / 2;
      const od = odOf(pen.sizeIn);
      const hz = pen.wall === 'north' || pen.wall === 'south';
      if (hz) {
        b.rect('FP-WALL', X(pen.x - idh - SLV_T), Y(pen.y - wT / 2), 2 * (idh + SLV_T), wT);
        for (const sx of [-idh, idh]) segLine('FP-WALL', pen.x + sx, pen.y - wT / 2, pen.x + sx, pen.y + wT / 2);
        // link seals at both wall faces
        for (const yy of [pen.y - wT / 2 + 40, pen.y + wT / 2 - 40]) {
          segLine('FP-ANNO', pen.x - idh, yy, pen.x - od / 2, yy);
          segLine('FP-ANNO', pen.x + od / 2, yy, pen.x + idh, yy);
        }
      }
    }
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
  // south: chain along x (tank wall, suction run, pad, header, controllers, east wall), internal length, overall
  const uniq = (vals: number[]): number[] => {
    const out: number[] = [];
    for (const v of [...vals].sort((p, q) => p - q)) if (!out.length || v - out[out.length - 1] > 1) out.push(v);
    return out;
  };
  const padOf = (e: PlacedEquipment): { x: number; y: number; w: number; h: number } => e.pad ?? e.rect;
  const mains = room.equipment.filter((e) => e.kind === 'fire-pump');
  const ctrlEq = room.equipment.filter((e) => e.kind === 'controller');
  const padL = mains.length ? Math.min(...mains.map((e) => padOf(e).x)) : 0;
  const padR = mains.length ? Math.max(...mains.map((e) => padOf(e).x + padOf(e).w)) : 0;
  const ctrlX = ctrlEq.length ? Math.min(...ctrlEq.map((e) => e.rect.x)) : room.headerX + 600;
  const xBreaks = uniq([-wW, 0, padL, padR, room.headerX, ctrlX, L, L + wT]);
  for (let i = 0; i + 1 < xBreaks.length; i++) dimPts(xBreaks[i], -wT, xBreaks[i + 1], -wT, -13);
  dimPts(0, -wT, L, -wT, -22);
  dimPts(-wW, -wT, L + wT, -wT, -31);
  // east: chain along y (south wall, every pad / bund row, north wall), pump centre-lines, internal width, overall
  const sy = room.suctionLineY;
  const rows = room.equipment.filter((e) => e.kind === 'fire-pump' || e.kind === 'jockey-pump' || e.kind === 'fuel-tank').map((e) => padOf(e));
  const yBreaks = uniq([0, ...rows.flatMap((q) => [q.y, q.y + q.h]), W]);
  for (let i = 0; i + 1 < yBreaks.length; i++) dimPts(L + wT, yBreaks[i], L + wT, yBreaks[i + 1], -9);
  const eastChain = [0, ...sy, W];
  for (let i = 0; i + 1 < eastChain.length; i++) dimPts(L + wT, eastChain[i], L + wT, eastChain[i + 1], -17);
  dimPts(L + wT, 0, L + wT, W, -25);
  dimPts(L + wT, -wT, L + wT, W + wT, -34);
  // header offset (inside the room, in the corridor above the first pump pad)
  if (mains.length) {
    const top1 = padOf(mains[0]).y + padOf(mains[0]).h;
    const next = yBreaks.find((v) => v > top1 + 1) ?? W;
    const yD = (top1 + next) / 2 + 200;
    dimPts(0, yD, room.headerX, yD, 0);
    P.addRect(X(0), Y(yD) - 1 * s, room.headerX, 6 * s);
  }
  // sump pit (vertical, west of the pit) and trench width (near its far end)
  if (pit) {
    dimPts(pit.rect.x, pit.rect.y, pit.rect.x, pit.rect.y + pit.rect.h, 6);
    P.addRect(X(pit.rect.x) - 9 * s, Y(pit.rect.y), 9 * s, pit.rect.h);
  }
  for (const q of rows) {
    const yy = q.y + q.h + 330;
    dimPts(q.x, yy, q.x + q.w, yy, 0);
    P.addRect(X(q.x), Y(yy) - 1 * s, q.w, 5 * s);
  }
  {
    const ty = tr.path[0][1] - 400;
    dimPts(tr.path[0][0] - tr.widthMm / 2, ty, tr.path[0][0] + tr.widthMm / 2, ty, 5);
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

  // dimension text and the sheet title are off-limits for tags and callouts
  for (const bx of dimBoxes) P.addHard(bx);

  // ───────────────────────── valve tags ─────────────────────────
  // group valves that share a location
  const groups: { tag: string; pos: [number, number] }[] = [];
  for (const va of [...valveAnchors].filter((q) => q.v.kind !== 'sensing-check').sort((p, q) => p.pos[0] - q.pos[0] || p.pos[1] - q.pos[1])) {
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
  // penetration tags: PF-nn (puddle flange, tank wall) / WS-nn (wall sleeve + seal)
  const pfTagY: number[] = [];
  for (const pen of room.penetrations) {
    if (pen.kind === 'puddle-flange') {
      // tag in the tank strip beyond the suction pit; leader from the top end of the flange plate
      let ty = pen.y;
      while (pfTagY.some((v) => Math.abs(v - ty) < 7 * s) || Math.abs(ty - yCut) < 6 * s) ty += 7 * s;
      pfTagY.push(ty);
      const tx = -wW - sp.pitLengthMm - 275;
      const anchor: [number, number] = [X(pen.x), Y(pen.y + pen.puddleFlangeOdMm / 2)];
      const hw = 5.5 * s;
      b.line('FP-ANNO', anchor[0], anchor[1], X(tx) + hw, Y(ty));
      b.circle('FP-ANNO', anchor[0], anchor[1], 0.45 * s);
      drawTag(b, X(tx), Y(ty), pen.tag, s);
      P.addHard({ x0: X(tx) - hw, y0: Y(ty) - 3 * s, x1: X(tx) + hw, y1: Y(ty) + 3 * s });
    } else {
      // sleeve tag: nearest free spot (the leader may cross the congested wall zone)
      const an: [number, number] = [X(pen.x), Y(pen.y)];
      const angs = pen.wall === 'north' ? [90, 45, 135, 0, 180, 270] : [270, 225, 315, 90, 45, 135, 0, 180];
      const hwT = 5.5 * s;
      let done = false;
      for (const rad of [8, 11, 14, 18, 23, 29, 36, 44].map((k) => k * s)) {
        for (const ang of angs) {
          const cx = an[0] + Math.cos((ang * Math.PI) / 180) * rad;
          const cy = an[1] + Math.sin((ang * Math.PI) / 180) * rad;
          const bx: Box = { x0: cx - hwT, y0: cy - 3 * s, x1: cx + hwT, y1: cy + 3 * s };
          if (!P.free(bx, 0.6 * s)) continue;
          const dl = Math.hypot(cx - an[0], cy - an[1]);
          b.line('FP-ANNO', an[0], an[1], cx - ((cx - an[0]) / dl) * 3 * s, cy - ((cy - an[1]) / dl) * 3 * s);
          b.circle('FP-ANNO', an[0], an[1], 0.45 * s);
          drawTag(b, cx, cy, pen.tag, s);
          P.addHard(bx);
          done = true;
          break;
        }
        if (done) break;
      }
      if (!done) P.tag(an, pen.tag, angs);
    }
  }


  // the dimension strings and the sheet title are off-limits for callouts
  P.addRect(X(-wW), Y(-wT - 36 * s), wW + L + wT, 36 * s);
  P.addRect(X(L + wT), Y(-wT - 3 * s), 38 * s, W + 2 * wT + 6 * s);
  P.addRect(PX(c, 28), PY(c, 17), 105 * s, 20 * s);
  // ───────────────────────── labels & callouts ─────────────────────────
  const co = (anchor: [number, number], lines: string[], hP = 2.5, prefer?: number[]): void => {
    if (!P.callout(anchor, lines, hP, prefer) && process.env.FIRE_DEBUG) console.warn('FP-101 callout failed:', lines[0]);
  };
  P.setBounds({ x0: frameBounds.x0, y0: PY(c, 40), x1: frameBounds.x1, y1: frameBounds.y1 });
  // keynote tags (text in the KEYNOTES table, right zone): K1 sensing lines, K2 pump drains, K3 drainage sump
  P.setBounds(outerBounds);
  for (const sl of room.sensingLines) {
    const seg = sl.points.slice(1).map((q, i) => [sl.points[i], q]).sort((a, q) => Math.abs(q[1][0] - q[0][0]) - Math.abs(a[1][0] - a[0][0]))[0];
    P.tag([X((seg[0][0] + seg[1][0]) / 2), Y((seg[0][1] + seg[1][1]) / 2)], 'K1', [90, 270, 45, 135, 315, 225]);
  }
  for (const dr of room.pipes.filter((q) => q.service === 'drain' && q.id.startsWith('DRN-FP')).slice(-1)) {
    const [a, q] = [dr.points[0], dr.points[dr.points.length - 1]];
    P.tag([X((a[0] + q[0]) / 2), Y((a[1] + q[1]) / 2)], 'K2', [90, 270, 45, 135, 315, 225]);
  }
  if (pit) P.tag([X(pit.rect.x + pit.rect.w), Y(pit.rect.y + pit.rect.h)], 'K3', [45, 0, 90, 135, 315]);
  const hoseV = room.valves.filter((v) => v.kind === 'hose-valve');
  if (hoseV.length) P.tag([X(hoseV[0].x), Y(hoseV[0].y) - 1.6 * s], 'K4', [270, 225, 315, 180, 0]);

  // exterior / outside callouts
  P.setBounds(outerBounds);
  const out = room.systemOutlet;
  co([X(out.x), Y(out.y)], [`SYSTEM OUTLET ${formatPipeSize(out.sizeIn)}`, 'TO BUILDING RISER / FEED MAIN'], 2.2, [90, 45, 135, 0]);
  for (const d of doors) {
    if (d.wall === 'south') co([X(d.x + d.widthMm * 0.5), Y(-wT - d.widthMm * 0.5)], [`DOUBLE DOOR ${d.widthMm} - OUTWARD SWING`, 'EXTERIOR ACCESS (IBC 913.2 / NFPA 20)'], 2.2, [270, 225, 315, 180]);
  }
  for (const lv of louvers) {
    const north = lv.wall === 'north';
    co([X(lv.x + lv.widthMm / 2), Y(north ? W + wT : -wT)], [`LOUVRE ${lv.widthMm} WIDE`, lv.purpose.length > 44 ? lv.purpose.slice(0, 44).replace(/\s+\S*$/, '') : lv.purpose], 2.2, north ? [90, 45, 135] : [270, 225, 315]);
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
    const cx = X(-wW - sp.pitLengthMm / 2);
    P.block([`SUCTION PIT ${i + 1}`, `${sp.pitLengthMm} x ${sp.pitWidthMm} x ${sp.pitDepthMm}`], 1.9, [[cx, Y(sm.y + sp.pitWidthMm / 2 + 330)], [cx, Y(sm.y - sp.pitWidthMm / 2 - 330)], [cx, Y(sm.y + sp.pitWidthMm / 2 + 700)], [cx, Y(sm.y - sp.pitWidthMm / 2 - 700)]]);
  });
  {
    const tH = Math.round(tank.totalInternalHeightM * 1000);
    const tLb = Math.round(tank.internalLengthM * 1000);
    const tWb = Math.round(tank.internalWidthM * 1000);
    const cands: [number, number][] = [];
    for (const d of [0, 700, -700, 1400, -1400, 2200, -2200, 3000, -3000, 4000, -4000, 5000, -5000]) cands.push([X(xs + stripW / 2 + 60), Y(tl.yLo + (tl.yHi - tl.yLo) / 2 + d)]);
    P.block(['TANK INTERNAL', `${tLb} x ${tWb} x ${tH}`, '(SEE FP-103)'], 2.0, cands);
  }
  P.block(['SECTION A-A', '(SEE FP-102)'], 2.0, [[X(xs + 1100), Y(yCut - 1100)], [X(xs + 1100), Y(yCut + 1100)], [X(xs + 1100), Y(yCut - 1700)]]);
  P.setBounds(outerBounds);

  if (process.env.FIRE_DEBUG && P.fallbacks.length) console.warn('FP-101 tag fallbacks:', P.fallbacks);
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
    for (const v of room.valves.filter((q) => q.kind !== 'sensing-check')) rows.push([v.tag, KIND_NAME[v.kind], formatPipeSize(v.sizeIn), v.service.toUpperCase()]);
    const sc = room.valves.filter((q) => q.kind === 'sensing-check');
    if (sc.length) rows.push([`${sc[0].tag}-${sc[sc.length - 1].tag.replace('V-', '')}`, KIND_NAME['sensing-check'] + ' (2 PER LINE)', formatPipeSize(0.5), 'SENSING']);
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
    for (const j of r.pumps.jockeys) rows.push([j.tag, 'ELECTRIC', 'JOCKEY', `${j.ratedFlowGpm} GPM`, String(j.ratedNetPressurePsi), '-', '-', String(j.motorHp), '-']);
    const t = drawTable(c, lx, y2, autoCols(rows, 2.2), rows, { title: 'FIRE PUMP SET SUMMARY (SEE FP-105)', th: 2.2 });
    y2 -= t.h + 8;
  }
  // room notes + plan key notes below the keys (centre zone)
  const hRoom = drawNotes(c, lx, y2, 831 - lx - 6, 'ROOM NOTES', roomNotes(c));
  const hPlan = drawNotes(c, lx, y2 - hRoom - 8, 831 - lx - 6, 'PLAN KEY NOTES', planNotes(c), 2.5);
  y2 -= hRoom + hPlan + 16;
  {
    const sl = room.sensingLines;
    const sp0 = sump.pumps[0];
    const kn: string[][] = [['KEY', 'KEYNOTE']];
    kn.push(['K1', ['1/2" SENSING LINE - 2 CHECK VALVES 3/32" ORIFICE 1.5 M APART (NFPA 20)', `ONE PER CONTROLLER (${sl.length} NO.): ${sl.map((q) => q.controllerTag).join(', ')} - SEE FP-110 DETAIL 4`].join('\n')]);
    kn.push(['K2', ['3/4" PUMP DRAIN LINES TO TRENCH: CASING DRAIN, GLAND DRIP AND', 'CIRCULATION RELIEF (NFPA 20 4.12, IPC 802 INDIRECT WASTE)'].join('\n')]);
    kn.push(['K3', sump.pumps.length ? [`${sump.tag} SUMP PIT ${sump.rect.w} x ${sump.rect.h} x ${sump.pitDepthMm} DEEP, DUPLEX SUMP PUMPS ${sump.pumps.map((q) => q.tag).join(' / ')}`, `${sp0.flowGpm} GPM @ ${sp0.headFt} FT, ${sp0.motorHp} HP EACH; DISCHARGE ${sump.dischargeSizeIn}" + CHECK + GATE VALVE EACH`, 'ALTERNATOR + HIGH-LEVEL ALARM (IPC 712) - SEE FP-110 DETAIL 5'].join('\n') : `${sump.tag} SUMP PIT ${sump.rect.w} x ${sump.rect.h} x ${sump.pitDepthMm} DEEP - GRAVITY DRAIN TO BUILDING DRAIN (IPC 802)`]);
    kn.push(['K4', `TEST HEADER - ${room.valves.filter((v) => v.kind === 'hose-valve').length} x 2-1/2" HOSE VALVES ON THE EXTERIOR WALL (NFPA 20 / FLOW TEST)`]);
    const kt = drawTable(c, lx, y2, autoCols(kn, 2.3, [10, 120]), kn, { title: 'KEYNOTES', th: 2.3 });
    y2 -= kt.h + 8;
    const pr: string[][] = [['TAG', 'SERVICE', 'SIZE', 'WALL', 'EL (m)', 'DETAIL']];
    for (const q of room.penetrations) {
      pr.push([q.tag, q.service.toUpperCase(), formatPipeSize(q.sizeIn), q.wall === 'west' ? 'TANK WALL' : q.wall.toUpperCase(), (q.elevationM >= 0 ? '+' : '-') + Math.abs(q.elevationM).toFixed(3), q.kind === 'puddle-flange' ? `PUDDLE FLANGE OD ${q.puddleFlangeOdMm} x 10 THK (FP-110 / 1)` : `SLEEVE ID ${q.sleeveIdMm} + LINK SEAL + FIRESTOP (FP-110 / 2)`]);
    }
    drawTable(c, lx, y2, autoCols(pr, 2.3, [12, 18, 14, 22, 14, 70]), pr, { title: 'WALL PENETRATION SCHEDULE', th: 2.3 });
  }
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
