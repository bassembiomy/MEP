/**
 * Shared geometry derived from the design result: common-wall thickness, tank compartment layout in
 * pump-room coordinates and pipe-body clipping helpers used by every sheet.
 */
import type { FireDesignResult, PipeSegment2D } from '../fpTypes';
import { outsideDiameterMm } from '../standards/pipeData';
import type { DrawingBuilder } from './drawingBuilder';
import type { Pt } from './sheetKit';

/** Thickness of the wall shared by pump room and tank (derived from where the suction pipes start). */
export function westWallMm(r: FireDesignResult): number {
  const xs = r.room.pipes.filter((p) => p.service === 'suction').flatMap((p) => p.points.map((q) => q[0]));
  const m = xs.length ? -Math.min(...xs) : 0;
  return m > 0 ? m : Math.max(250, r.tank.wallThicknessMm);
}

export interface TankLay {
  wallT: number;
  /** Tank wall / divider thickness. */
  tw: number;
  compLen: number;
  comps: { y0: number; y1: number }[];
  /** Divider centre-lines between compartments (room y). */
  dividers: { y0: number; y1: number }[];
  /** Tank internal south / north faces (room y). */
  yLo: number;
  yHi: number;
  sumps: { y: number; comp: number }[];
}

/** Tank compartments placed so that each main-pump suction line lies in its own compartment. */
export function tankLayout(r: FireDesignResult): TankLay {
  const t = r.tank;
  const n = t.compartments;
  const tw = t.wallThicknessMm;
  const total = Math.round(t.internalLengthM * 1000);
  const compLen = (total - (n - 1) * tw) / n;
  const sy = r.room.suctionLineY;
  let yLo: number;
  if (n >= 2 && sy.length >= 2) yLo = (sy[0] + sy[1]) / 2 - tw / 2 - compLen;
  else if (n >= 2) yLo = sy[0] - compLen / 2;
  else yLo = sy.reduce((a, v) => a + v, 0) / sy.length - total / 2;
  yLo = Math.round(yLo);
  const comps: { y0: number; y1: number }[] = [];
  const dividers: { y0: number; y1: number }[] = [];
  let y = yLo;
  for (let i = 0; i < n; i++) {
    comps.push({ y0: y, y1: y + compLen });
    y += compLen;
    if (i < n - 1) {
      dividers.push({ y0: y, y1: y + tw });
      y += tw;
    }
  }
  const sumps = sy.map((yy, k) => ({ y: yy, comp: Math.min(k, n - 1) }));
  return { wallT: westWallMm(r), tw, compLen, comps, dividers, yLo, yHi: yLo + total, sumps };
}

export const odOf = (sizeIn: number): number => outsideDiameterMm(sizeIn);

export interface PipeDraw {
  layer: string;
  od: number;
  pts: Pt[];
  centre: boolean;
}

interface Rect4 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Extend pipe ends that meet another pipe's end at a right angle so that corners close cleanly. */
function extendCorners(pipes: PipeDraw[]): PipeDraw[] {
  const out = pipes.map((p) => ({ ...p, pts: p.pts.map((q) => [q[0], q[1]] as Pt) }));
  const dirAt = (p: PipeDraw, atStart: boolean): Pt => {
    const a = atStart ? p.pts[0] : p.pts[p.pts.length - 1];
    const b = atStart ? p.pts[1] : p.pts[p.pts.length - 2];
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  for (let i = 0; i < pipes.length; i++) {
    for (const atStart of [true, false]) {
      const pi = pipes[i];
      const e = atStart ? pi.pts[0] : pi.pts[pi.pts.length - 1];
      const di = dirAt(pi, atStart);
      let ext = 0;
      for (let j = 0; j < pipes.length; j++) {
        if (j === i) continue;
        const pj = pipes[j];
        for (const jStart of [true, false]) {
          const f = jStart ? pj.pts[0] : pj.pts[pj.pts.length - 1];
          if (Math.hypot(f[0] - e[0], f[1] - e[1]) > 1) continue;
          const dj = dirAt(pj, jStart);
          if (Math.abs(di[0] * dj[0] + di[1] * dj[1]) < 0.1) ext = Math.max(ext, pj.od / 2);
        }
      }
      if (ext > 0) {
        const q = out[i].pts;
        const idx = atStart ? 0 : q.length - 1;
        q[idx] = [q[idx][0] + di[0] * ext, q[idx][1] + di[1] * ext];
      }
    }
  }
  return out;
}

/** Subtract `holes` (open intervals) from the parameter range [0,1]. */
function clipSegment(x1: number, y1: number, x2: number, y2: number, bodies: Rect4[]): [number, number, number, number][] {
  let ivs: [number, number][] = [[0, 1]];
  const eps = 0.5;
  for (const r of bodies) {
    // parameter interval strictly inside the rectangle
    let t0 = 0;
    let t1 = 1;
    let inside = true;
    for (const [a, d, lo, hi] of [[x1, x2 - x1, r.x0 + eps, r.x1 - eps], [y1, y2 - y1, r.y0 + eps, r.y1 - eps]] as [number, number, number, number][]) {
      if (Math.abs(d) < 1e-9) {
        if (a <= lo || a >= hi) inside = false;
      } else {
        const ta = (lo - a) / d;
        const tb = (hi - a) / d;
        t0 = Math.max(t0, Math.min(ta, tb));
        t1 = Math.min(t1, Math.max(ta, tb));
      }
    }
    if (!inside || t1 <= t0) continue;
    const next: [number, number][] = [];
    for (const [s0, s1] of ivs) {
      if (t1 <= s0 || t0 >= s1) next.push([s0, s1]);
      else {
        if (t0 > s0) next.push([s0, t0]);
        if (t1 < s1) next.push([t1, s1]);
      }
    }
    ivs = next;
  }
  return ivs
    .filter(([s0, s1]) => s1 - s0 > 1e-6)
    .map(([s0, s1]) => [x1 + (x2 - x1) * s0, y1 + (y2 - y1) * s0, x1 + (x2 - x1) * s1, y1 + (y2 - y1) * s1]);
}

/**
 * Draw orthogonal double-line pipes at true OD. Tee branches are clipped to the run's outer edge and
 * L-corners between two pipes are closed, so junctions read as one network.
 */
export function drawPipeNetwork(b: DrawingBuilder, pipesIn: PipeDraw[]): void {
  const pipes = extendCorners(pipesIn);
  const bodies: { pipe: number; rect: Rect4 }[] = [];
  pipes.forEach((p, i) => {
    for (let k = 0; k + 1 < p.pts.length; k++) {
      const [a, c] = [p.pts[k], p.pts[k + 1]];
      const h = p.od / 2;
      bodies.push({ pipe: i, rect: { x0: Math.min(a[0], c[0]) - h, y0: Math.min(a[1], c[1]) - h, x1: Math.max(a[0], c[0]) + h, y1: Math.max(a[1], c[1]) + h } });
    }
  });
  pipes.forEach((p, i) => {
    const half = p.od / 2;
    const pts = p.pts;
    const nSeg = pts.length - 1;
    const dir: Pt[] = [];
    for (let k = 0; k < nSeg; k++) {
      const dx = pts[k + 1][0] - pts[k][0];
      const dy = pts[k + 1][1] - pts[k][1];
      const l = Math.hypot(dx, dy) || 1;
      dir.push([dx / l, dy / l]);
    }
    const nrm = dir.map(([ux, uy]): Pt => [-uy, ux]);
    const others = bodies.filter((bd) => bd.pipe !== i).map((bd) => bd.rect);
    for (const side of [1, -1]) {
      const v: Pt[] = [];
      for (let k = 0; k < pts.length; k++) {
        if (k === 0) v.push([pts[0][0] + nrm[0][0] * half * side, pts[0][1] + nrm[0][1] * half * side]);
        else if (k === pts.length - 1) v.push([pts[k][0] + nrm[nSeg - 1][0] * half * side, pts[k][1] + nrm[nSeg - 1][1] * half * side]);
        else {
          const na = nrm[k - 1];
          const nb = nrm[k];
          const dot = na[0] * nb[0] + na[1] * nb[1];
          const kk = (half * side) / (1 + dot);
          v.push([pts[k][0] + (na[0] + nb[0]) * kk, pts[k][1] + (na[1] + nb[1]) * kk]);
        }
      }
      for (let k = 0; k < nSeg; k++) {
        for (const s of clipSegment(v[k][0], v[k][1], v[k + 1][0], v[k + 1][1], others)) b.line(p.layer, s[0], s[1], s[2], s[3]);
      }
    }
    if (p.centre) for (let k = 0; k < nSeg; k++) b.line('FP-CNTR', pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]);
  });
}

/** Drawing layer for a pump-room pipe service. */
export function layerOfService(s: PipeSegment2D['service']): string {
  switch (s) {
    case 'suction':
      return 'FP-PIPE-SUCT';
    case 'discharge':
      return 'FP-PIPE-DISC';
    case 'test':
    case 'relief':
      return 'FP-PIPE-TEST';
    case 'jockey':
      return 'FP-PIPE-JCKY';
    case 'drain':
      return 'FP-PIPE-DRAN';
    case 'sensing':
      return 'FP-PIPE-SENS';
    case 'fuel':
    case 'exhaust':
      return 'FP-FUEL';
  }
}
