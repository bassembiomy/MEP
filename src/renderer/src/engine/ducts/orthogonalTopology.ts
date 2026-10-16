/**
 * Orthogonal (Manhattan) duct-tree topology builder, unit-agnostic (feet or px).
 *
 * Layout rules (professional practice):
 *  - ONE trunk line runs along the dominant room axis through the unit (per side of the unit).
 *  - Every terminal is projected onto the trunk; the branch is a straight perpendicular run.
 *  - Trunk pieces end at the last takeoff only; collinear / zero-length pieces are never emitted.
 *  - Terminals sharing a takeoff station on the same side of the trunk are chained in series
 *    (nearest first) so no two segments overlap.
 *
 * Every emitted segment is horizontal or vertical, has a parent (or none for roots at the unit) and
 * carries the flow of everything downstream of it, so airflow is conserved at every node.
 */

import { isPointInPolygon, distanceToPolygonEdge } from '../geometry';
import { Rect, inflateRect, rectsOverlap, ductOverlapsRect, orthogonalCrossing, countCrossings } from './clearance';

export interface Pt2 {
  x: number;
  y: number;
}
export interface Seg2 {
  start: Pt2;
  end: Pt2;
}

export interface TopoTerminal {
  id: string;
  x: number;
  y: number;
  cfm: number;
}

export type TopoKind = 'trunk' | 'branch' | 'runout';

export interface TopoSegment {
  key: number;
  kind: TopoKind;
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Total flow carried (sum of all downstream terminals) */
  flow: number;
  parent: number; // index into the output array, -1 = fed directly from the unit
  /** Terminals served at this section's END node */
  direct: string[];
  /** All terminals downstream (including direct) */
  downstream: string[];
  orientation: 'h' | 'v';
  /** true for the first leg leaving a trunk node perpendicular to it */
  isTakeoff: boolean;
  /** terminal connected on-line at the trunk node (needs a takeoff collar) */
  onTrunk: boolean;
}

export interface TopologyOptions {
  /** Trunk axis; 'auto' picks horizontal when the room bbox is wider than tall */
  axis: 'h' | 'v';
  /** Stations closer than this are merged (coordinate units) */
  snapTol: number;
  /** Terminals closer than this to the trunk line are treated as on-line (no branch) */
  onLineTol: number;
  /** Minimum length of a piece when a station is displaced off the unit (1 ft in coordinate units) */
  minLen: number;
  /** Room polygon (same coordinate units, flat [x,y,...]); every duct must stay inside it */
  polygon?: number[];
  /** Used when no valid route exists inside `polygon` (e.g. a service bay made of disconnected pieces) */
  fallbackPolygon?: number[];
  /** Minimum duct-to-wall distance (coordinate units). Default 0.2 * minLen */
  clearance?: number;
  /** Segments of OTHER networks (or the unit return stub) this tree must not run collinear with */
  avoid?: Seg2[];
  /**
   * Terminal faces (same coordinate units). Giving this switches the builder to CLEARANCE mode: the trunk line is
   * moved off the diffuser rows (a perpendicular stub from the unit when needed), no duct body may overlap a terminal face
   * other than its own final run-out, and duct edges keep `wallClear` from the walls.
   */
  obstacles?: TopoObstacle[];
  /** Half widths of trunk-kind and branch-kind ducts (coordinate units) used for the clearance checks */
  hwTrunk?: number;
  hwBranch?: number;
  /** Minimum duct EDGE to wall distance (coordinate units) */
  wallClear?: number;
  /** Minimum gap between a duct edge and a foreign terminal face (coordinate units) */
  termClear?: number;
  /** Minimum perpendicular offset of the trunk line from the root (coordinate units); relaxed in steps when unattainable */
  minRootOffset?: number;
  /** Minimum distance between parallel ducts of other networks (coordinate units); default two trunk widths + 0.25 ft */
  parallelSpacing?: number;
}

export interface TopoObstacle {
  /** terminal id: the segment that ENDS at this terminal's centre may enter the face */
  id: string;
  rect: Rect;
}

export interface TopoResult {
  segs: TopoSegment[];
  /** all clearance rules hold (always true in legacy mode) */
  valid: boolean;
  /** crossings with `avoid` segments (clearance mode) */
  crossings: number;
}

export function pickAxis(bbox: { width: number; height: number }): 'h' | 'v' {
  return bbox.width >= bbox.height ? 'h' : 'v';
}


// ───────────────────────────── geometry helpers ─────────────────────────────
const EPS = 1e-9;

function insideOrOn(p: Pt2, poly: number[]): boolean {
  return isPointInPolygon(p.x, p.y, poly) || distanceToPolygonEdge(p.x, p.y, poly) < 1e-6;
}

/** Point inside the polygon and at least `clr` from every wall. */
export function pointInsideClear(p: Pt2, poly: number[], clr: number): boolean {
  return isPointInPolygon(p.x, p.y, poly) && distanceToPolygonEdge(p.x, p.y, poly) >= clr - EPS;
}

function properCross(a: Pt2, b: Pt2, c: Pt2, d: Pt2): boolean {
  const o = (p: Pt2, q: Pt2, r: Pt2): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

/**
 * True when the straight segment a-b lies inside the polygon: sampled points keep `clr` from the walls
 * (end points listed in `exempt`, e.g. terminals / the unit, only need to be inside-or-on) and the
 * segment never properly crosses a polygon edge.
 */
export function segmentInsidePolygon(a: Pt2, b: Pt2, poly: number[], clr: number, step: number, exempt: Pt2[] = []): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(len / Math.max(step, 1e-6)));
  for (let i = 0; i <= n; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
    const ex = (i === 0 || i === n) && exempt.some((e) => Math.hypot(e.x - p.x, e.y - p.y) < 1e-6);
    if (ex ? !insideOrOn(p, poly) : !pointInsideClear(p, poly, clr)) return false;
  }
  const m = poly.length / 2;
  for (let k = 0, j = m - 1; k < m; j = k++) {
    if (properCross(a, b, { x: poly[2 * j], y: poly[2 * j + 1] }, { x: poly[2 * k], y: poly[2 * k + 1] })) return false;
  }
  return true;
}

/** Overlap length of two parallel axis-aligned segments whose lines are closer than `gap` (0 otherwise). */
export function collinearOverlap(s: Seg2, t: Seg2, gap: number): number {
  const sh = Math.abs(s.start.y - s.end.y) < EPS, sv = Math.abs(s.start.x - s.end.x) < EPS;
  const th = Math.abs(t.start.y - t.end.y) < EPS, tv = Math.abs(t.start.x - t.end.x) < EPS;
  if (sh === sv || th === tv) return 0;
  const ovl = (a1: number, a2: number, b1: number, b2: number): number =>
    Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
  if (sh && th && Math.abs(s.start.y - t.start.y) < gap) return Math.max(0, ovl(s.start.x, s.end.x, t.start.x, t.end.x));
  if (sv && tv && Math.abs(s.start.x - t.start.x) < gap) return Math.max(0, ovl(s.start.y, s.end.y, t.start.y, t.end.y));
  return 0;
}

/**
 * Chooses the unit return collar: `offset` away from the supply trunk line, on the side whose collar is
 * inside the room with >= `clr` wall clearance (shortening the stub down to a third if needed);
 * the side holding more return grilles wins, then the side towards the room centre.
 */
export function chooseReturnCollar(
  root: Pt2,
  axis: 'h' | 'v',
  offset: number,
  polygon: number[] | undefined,
  grilles: Pt2[],
  centre: Pt2 | null,
  clr: number,
  preferPolygon?: number[]
): Pt2 {
  const h = axis === 'h';
  const at = (s: number, off: number): Pt2 => (h ? { x: root.x, y: root.y + s * off } : { x: root.x + s * off, y: root.y });
  const side = (p: Pt2): number => (h ? p.y - root.y : p.x - root.x);
  const count = (s: number): number => grilles.filter((g) => Math.sign(side(g)) === s).length;
  const centreSide = centre ? Math.sign(side(centre)) : 0;
  const clearanceIn = (poly: number[] | undefined, p: Pt2): number =>
    !poly || poly.length < 6
      ? Infinity
      : isPointInPolygon(p.x, p.y, poly) ? distanceToPolygonEdge(p.x, p.y, poly) : -distanceToPolygonEdge(p.x, p.y, poly);
  // `preferPolygon` (the unit's own service bay) is tried first so neighbouring units' stubs never meet;
  // the room outline is the fallback.
  let fallback: { p: Pt2; cl: number } | null = null;
  for (const poly of [preferPolygon, polygon]) {
    if (!poly || poly.length < 6) continue;
    for (const f of [1, 2 / 3, 1 / 3]) {
      const off = offset * f;
      const cands = [1, -1].map((s) => ({ s, p: at(s, off), n: count(s), cl: clearanceIn(poly, at(s, off)) }));
      const ok = cands.filter((c) => c.cl >= clr - EPS);
      if (ok.length) {
        ok.sort((a, b) => b.n - a.n || (b.s === centreSide ? 1 : 0) - (a.s === centreSide ? 1 : 0) || b.s - a.s);
        return ok[0].p;
      }
      if (poly === polygon) for (const c of cands) if (!fallback || c.cl > fallback.cl) fallback = { p: c.p, cl: c.cl };
    }
  }
  if (!fallback && !(polygon && polygon.length >= 6)) {
    // no polygon at all: toward the more populated / centre side
    const cands = [1, -1].map((s) => ({ s, n: count(s) }));
    cands.sort((a, b) => b.n - a.n || (b.s === centreSide ? 1 : 0) - (a.s === centreSide ? 1 : 0) || b.s - a.s);
    return at(cands[0].s, offset);
  }
  return fallback ? fallback.p : at(1, offset);
}

/** Stub segments (both sides) from the unit towards where its return collar may sit. */
export function returnStubCandidates(root: Pt2, axis: 'h' | 'v', offset: number): Seg2[] {
  const h = axis === 'h';
  return [1, -1].map((s) => ({
    start: { x: root.x, y: root.y },
    end: h ? { x: root.x, y: root.y + s * offset } : { x: root.x + s * offset, y: root.y }
  }));
}

/** Terminals practically on the root node (served by the segment that ENDS at the root, e.g. the return collar stub). */
export function splitRootTerminals(
  root: Pt2,
  terminals: TopoTerminal[],
  opts: Pick<TopologyOptions, 'axis' | 'snapTol' | 'onLineTol'>
): { rest: TopoTerminal[]; atRoot: TopoTerminal[] } {
  const h = opts.axis === 'h';
  const rest: TopoTerminal[] = [];
  const atRoot: TopoTerminal[] = [];
  for (const t of terminals) {
    const du = h ? t.x - root.x : t.y - root.y;
    const dv = h ? t.y - root.y : t.x - root.x;
    if (t.cfm > 0 && Math.abs(du) < opts.snapTol && Math.abs(dv) <= opts.onLineTol) atRoot.push(t);
    else rest.push(t);
  }
  return { rest, atRoot };
}

// ───────────────────────────── standard trunk + branch tree ─────────────────────────────
interface StItem {
  t: TopoTerminal;
  /** station offset along the trunk (signed, from root) */
  u: number;
  /** perpendicular offset of the branch end (signed, from root) */
  dv: number;
  /** actual terminal offset along the trunk */
  tu: number;
  branch: boolean;
  /** station was displaced off the root column: needs a short run back to the terminal */
  disp: boolean;
}

interface Station {
  u: number; // offset along trunk from unit (signed)
  terminals: StItem[];
}

function buildStandardTree(
  root: { x: number; y: number },
  terminals: TopoTerminal[],
  opts: TopologyOptions
): TopoSegment[] {
  const horizontal = opts.axis === 'h';
  // Work in (u, v): u along trunk axis, v perpendicular
  const toUV = (p: { x: number; y: number }): { u: number; v: number; } => (horizontal ? { u: p.x, v: p.y } : { u: p.y, v: p.x });
  const toXY = (u: number, v: number): { x: number; y: number; } => (horizontal ? { x: u, y: v } : { x: v, y: u });
  const r = toUV(root);

  const live = terminals.filter((t) => t.cfm > 0).map((t) => ({ t, p: toUV(t) }));
  // Terminals in the root column are displaced along the trunk (never branched at the root node, which would
  // run collinear with a return stub / the unit connection). Displace towards the busier side.
  let pos = 0, neg = 0;
  for (const { p } of live) {
    const off = p.u - r.u;
    if (off >= opts.snapTol) pos++;
    else if (off <= -opts.snapTol) neg++;
  }
  const dispSign = neg > pos ? -1 : 1;

  const sorted: StItem[] = live
    .map(({ t, p }) => {
      let off = p.u - r.u;
      const dv0 = p.v - r.v;
      let disp = false;
      if (Math.abs(off) < opts.snapTol) {
        off = dispSign * opts.minLen;
        disp = true;
      }
      let dv = dv0;
      let branch = Math.abs(dv0) > opts.onLineTol;
      if (disp && !branch) {
        // on-line terminal over the root: dog-leg off the trunk and back so it still ends a segment
        dv = (dv0 >= 0 ? 1 : -1) * Math.max(Math.abs(dv0), 0.3 * opts.minLen);
        branch = true;
      }
      return { t, u: off, dv, tu: p.u - r.u, branch, disp };
    })
    .sort((a, b) => a.u - b.u);

  const stations: Station[] = [];
  for (const item of sorted) {
    const last = stations.length ? stations[stations.length - 1] : undefined;
    const sameSide = last ? last.u >= 0 === item.u >= 0 : false;
    if (last && sameSide && Math.abs(last.u - item.u) <= opts.snapTol) last.terminals.push(item);
    else stations.push({ u: item.u, terminals: [item] });
  }

  const out: TopoSegment[] = [];
  let keyCounter = 0;
  const push = (seg: Omit<TopoSegment, 'key'>): number => {
    out.push({ ...seg, key: keyCounter++ });
    return out.length - 1;
  };

  const sides: Station[][] = [
    stations.filter((s) => s.u >= 0).sort((a, b) => a.u - b.u),
    stations.filter((s) => s.u < 0).sort((a, b) => b.u - a.u)
  ];

  const stationFlow = (s: Station): number => s.terminals.reduce((acc, x) => acc + x.t.cfm, 0);

  for (const side of sides) {
    if (side.length === 0) continue;
    const suffix: number[] = new Array(side.length).fill(0);
    let acc = 0;
    for (let i = side.length - 1; i >= 0; i--) {
      acc += stationFlow(side[i]);
      suffix[i] = acc;
    }
    const suffixIds: string[][] = new Array(side.length);
    let idsAcc: string[] = [];
    for (let i = side.length - 1; i >= 0; i--) {
      idsAcc = [...side[i].terminals.map((x) => x.t.id), ...idsAcc];
      suffixIds[i] = idsAcc;
    }

    let prevNode = -1; // index of trunk segment ending at current node, -1 = unit
    let prevU = 0;
    for (let i = 0; i < side.length; i++) {
      const st = side[i];
      const onTrunkTerms = st.terminals.filter((x) => !x.branch);
      const trunkIdx = push({
        kind: 'trunk',
        start: toXY(r.u + prevU, r.v),
        end: toXY(r.u + st.u, r.v),
        flow: suffix[i],
        parent: prevNode,
        direct: onTrunkTerms.map((x) => x.t.id),
        downstream: suffixIds[i],
        orientation: horizontal ? 'h' : 'v',
        isTakeoff: false,
        onTrunk: onTrunkTerms.length > 0
      });
      prevNode = trunkIdx;
      prevU = st.u;

      // Perpendicular branches at this node, per side of the trunk
      const nodeU = r.u + st.u;
      for (const dir of [1, -1]) {
        const group = st.terminals
          .filter((x) => x.branch && Math.sign(x.dv) === dir)
          .sort((a, b) => Math.abs(a.dv) - Math.abs(b.dv));
        if (group.length === 0) continue;
        let parent = trunkIdx;
        let from = { u: nodeU, v: r.v };
        for (let g = 0; g < group.length; g++) {
          const x = group[g];
          const rem = group.slice(g);
          const flow = rem.reduce((a, y) => a + y.t.cfm, 0);
          const to = { u: nodeU, v: r.v + x.dv };
          const segIdx = push({
            kind: g === 0 && group.length > 1 ? 'branch' : 'runout',
            start: toXY(from.u, from.v),
            end: toXY(to.u, to.v),
            flow,
            parent,
            direct: x.disp ? [] : [x.t.id],
            downstream: rem.map((y) => y.t.id),
            orientation: horizontal ? 'v' : 'h',
            isTakeoff: g === 0,
            onTrunk: false
          });
          if (x.disp) {
            push({
              kind: 'runout',
              start: toXY(to.u, to.v),
              end: toXY(r.u + x.tu, to.v),
              flow: x.t.cfm,
              parent: segIdx,
              direct: [x.t.id],
              downstream: [x.t.id],
              orientation: horizontal ? 'h' : 'v',
              isTakeoff: false,
              onTrunk: false
            });
          }
          parent = segIdx;
          from = to;
        }
      }
    }
  }

  return out;
}

// ───────────────────────────── validation ─────────────────────────────
function treeValid(segs: TopoSegment[], root: Pt2, terminals: TopoTerminal[], opts: TopologyOptions, poly: number[] | undefined): boolean {
  const clr = opts.clearance ?? 0.2 * opts.minLen;
  if (poly && poly.length >= 6) {
    const exempt: Pt2[] = [root, ...terminals.map((t) => ({ x: t.x, y: t.y }))];
    const step = Math.max(0.5 * opts.minLen, clr);
    for (const s of segs) if (!segmentInsidePolygon(s.start, s.end, poly, clr, step, exempt)) return false;
  }
  const tol = 0.012 * opts.minLen;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) if (collinearOverlap(segs[i], segs[j], tol) > 1e-6) return false;
    for (const a of opts.avoid || []) if (collinearOverlap(segs[i], a, tol) > 1e-6) return false;
  }
  return true;
}

// ───────────────────────────── inside-the-room grid router ─────────────────────────────
class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size(): number { return this.k.length; }
  private less(a: number, b: number): boolean {
    return this.k[a] < this.k[b] || (this.k[a] === this.k[b] && this.v[a] < this.v[b]);
  }
  private swap(a: number, b: number): void {
    [this.k[a], this.k[b]] = [this.k[b], this.k[a]];
    [this.v[a], this.v[b]] = [this.v[b], this.v[a]];
  }
  push(key: number, val: number): void {
    let i = this.k.length;
    this.k.push(key);
    this.v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const rk = this.k[0], rv = this.v[0];
    const lk = this.k.pop()!, lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk;
      this.v[0] = lv;
      let i = 0;
      const n = this.k.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < n && this.less(l, m)) m = l;
        if (r < n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(m, i);
        i = m;
      }
    }
    return [rk, rv];
  }
}

/** Cluster coordinates within `tol`; the root value (if present) is the representative of its cluster. */
function clusterLines(vals: number[], tol: number, rootVal: number): number[] {
  const sorted = [...vals].sort((a, b) => a - b);
  const reps: number[] = [];
  let cluster: number[] = [];
  const flush = (): void => {
    if (!cluster.length) return;
    reps.push(cluster.some((c) => Math.abs(c - rootVal) < 1e-9) ? rootVal : cluster[0]);
    cluster = [];
  };
  for (const v of sorted) {
    if (cluster.length && v - cluster[0] > tol) flush();
    cluster.push(v);
  }
  flush();
  return reps;
}

const ductBodyBox = (s: Seg2, hw: number): Rect => ({
  minX: Math.min(s.start.x, s.end.x) - hw,
  maxX: Math.max(s.start.x, s.end.x) + hw,
  minY: Math.min(s.start.y, s.end.y) - hw,
  maxY: Math.max(s.start.y, s.end.y) + hw
});

interface GridCtx {
  obstacles: TopoObstacle[];
  hw: number;
  termClear: number;
  blockCross: boolean;
  crossAvoid: Seg2[];
  rootRadius: number;
}

function gridRoute(
  root: Pt2,
  terminals: TopoTerminal[],
  opts: TopologyOptions,
  poly: number[],
  clr: number,
  avoid: Seg2[],
  avoidGap: number,
  ctx?: GridCtx
): TopoSegment[] | null {
  const live = terminals.filter((t) => t.cfm > 0);
  if (live.length === 0) return [];
  const g = opts.minLen;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < poly.length; i += 2) {
    minX = Math.min(minX, poly[i]); maxX = Math.max(maxX, poly[i]);
    minY = Math.min(minY, poly[i + 1]); maxY = Math.max(maxY, poly[i + 1]);
  }
  const reqX = clusterLines([root.x, ...live.map((t) => t.x)], opts.snapTol, root.x);
  const reqY = clusterLines([root.y, ...live.map((t) => t.y)], opts.snapTol, root.y);
  const build = (req: number[], lo: number, hi: number, step: number): number[] => {
    const lines = [...req];
    for (let v = lo; v <= hi + 1e-9; v += step) {
      if (req.every((q) => Math.abs(q - v) >= 0.4 * step)) lines.push(v);
    }
    return lines.sort((a, b) => a - b);
  };
  let step = g;
  let xs = build(reqX, minX, maxX, step);
  let ys = build(reqY, minY, maxY, step);
  while (xs.length * ys.length > 90000) {
    step *= 1.5;
    xs = build(reqX, minX, maxX, step);
    ys = build(reqY, minY, maxY, step);
  }
  const nx = xs.length, ny = ys.length;
  const N = nx * ny;
  const idx = (ix: number, iy: number): number => ix * ny + iy;
  const nearest = (arr: number[], v: number): number => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const d = Math.abs(arr[i] - v);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const rootNode = idx(nearest(xs, root.x), nearest(ys, root.y));
  const termNodes = live.map((t) => idx(nearest(xs, t.x), nearest(ys, t.y)));
  if (termNodes.some((n) => n === rootNode)) return null;
  const special = new Set<number>([rootNode, ...termNodes]);
  const termNodeSet = new Set<number>(termNodes);
  const ownerNode = new Map<string, number>();
  live.forEach((t, i) => ownerNode.set(t.id, termNodes[i]));
  const termPos = new Map<string, Pt2>(live.map((t) => [t.id, { x: t.x, y: t.y }]));
  const px = (n: number): number => xs[Math.floor(n / ny)];
  const py = (n: number): number => ys[n % ny];
  const P = (n: number): Pt2 => ({ x: px(n), y: py(n) });

  const nodeState = new Int8Array(N); // 0 unknown, 1 ok, 2 bad
  const nodeOk = (n: number): boolean => {
    if (nodeState[n] === 0) {
      const p = P(n);
      nodeState[n] = (special.has(n) ? insideOrOn(p, poly) : pointInsideClear(p, poly, clr)) ? 1 : 2;
    }
    return nodeState[n] === 1;
  };
  const m = poly.length / 2;
  const edgeCache = new Map<number, boolean>();
  const edgeOk = (a: number, b: number): boolean => {
    const key = a < b ? a * N + b : b * N + a;
    const hit = edgeCache.get(key);
    if (hit !== undefined) return hit;
    let ok = nodeOk(a) && nodeOk(b);
    if (ok) {
      const pa = P(a), pb = P(b);
      const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      ok = pointInsideClear(mid, poly, clr * 0.5) || ((special.has(a) || special.has(b)) && insideOrOn(mid, poly));
      for (let k = 0, j = m - 1; ok && k < m; j = k++) {
        if (properCross(pa, pb, { x: poly[2 * j], y: poly[2 * j + 1] }, { x: poly[2 * k], y: poly[2 * k + 1] })) ok = false;
      }
      if (ok && avoid.length) {
        const seg = { start: pa, end: pb };
        for (const s of avoid) {
          if (collinearOverlap(seg, s, avoidGap) > 1e-6) { ok = false; break; }
        }
      }
      if (ok && ctx) {
        const seg = { start: pa, end: pb };
        const body = ductBodyBox(seg, ctx.hw);
        for (const o of ctx.obstacles) {
          const own = ownerNode.get(o.id);
          if (own !== undefined && (own === a || own === b)) continue; // run-out entering its own terminal
          if (!rectsOverlap(body, inflateRect(o.rect, ctx.termClear), 1e-6)) continue;
          const tp = termPos.get(o.id);
          // head-on approach to its own terminal may pass through the clearance margin, never through the bare face
          const headOn = own !== undefined && tp !== undefined &&
            (Math.abs(pa.y - pb.y) < EPS ? Math.abs(pa.y - tp.y) <= ctx.hw + 1e-6 : Math.abs(pa.x - tp.x) <= ctx.hw + 1e-6);
          if (headOn && !rectsOverlap(body, o.rect, 1e-6)) continue;
          ok = false;
          break;
        }
        if (ok && ctx.blockCross) {
          for (const sg of ctx.crossAvoid) {
            const cp = orthogonalCrossing(seg, sg, 0.02 * opts.minLen);
            if (cp && Math.hypot(cp.x - root.x, cp.y - root.y) > ctx.rootRadius) { ok = false; break; }
          }
        }
      }
    }
    edgeCache.set(key, ok);
    return ok;
  };

  // grow the tree one terminal at a time (nearest first)
  const parentNode = new Map<number, number>(); // tree node -> parent node
  parentNode.set(rootNode, -1);
  const remaining = new Set<number>(termNodes);
  const BEND = 1.5 * g;
  const dist = new Float64Array(2 * N);
  const prev = new Int32Array(2 * N);
  while (remaining.size) {
    dist.fill(Infinity);
    prev.fill(-2);
    const heap = new MinHeap();
    for (const n of parentNode.keys()) {
      if (termNodeSet.has(n)) continue; // a terminal is always a leaf: ducts never continue through a diffuser
      for (let d = 0; d < 2; d++) {
        dist[n * 2 + d] = 0;
        prev[n * 2 + d] = -1;
        heap.push(0, n * 2 + d);
      }
    }
    let found = -1;
    while (heap.size) {
      const [c, s] = heap.pop();
      if (c > dist[s]) continue;
      const n = s >> 1, d = s & 1;
      if (remaining.has(n)) { found = s; break; }
      const ix = Math.floor(n / ny), iy = n % ny;
      const nbrs: Array<[number, number]> = [];
      if (ix > 0) nbrs.push([idx(ix - 1, iy), 0]);
      if (ix < nx - 1) nbrs.push([idx(ix + 1, iy), 0]);
      if (iy > 0) nbrs.push([idx(ix, iy - 1), 1]);
      if (iy < ny - 1) nbrs.push([idx(ix, iy + 1), 1]);
      for (const [mn, md] of nbrs) {
        if (parentNode.has(mn) || !edgeOk(n, mn)) continue;
        const len = Math.abs(px(mn) - px(n)) + Math.abs(py(mn) - py(n));
        const nc = c + len + (md !== d && prev[s] !== -1 ? BEND : 0);
        const ns = mn * 2 + md;
        if (nc < dist[ns] - 1e-12) {
          dist[ns] = nc;
          prev[ns] = s;
          heap.push(nc, ns);
        }
      }
    }
    if (found < 0) return null;
    const path: number[] = [];
    for (let s = found; s !== -1; s = prev[s]) path.push(s >> 1);
    path.reverse(); // existing tree node ... terminal
    for (let i = 1; i < path.length; i++) parentNode.set(path[i], path[i - 1]);
    for (const n of path) remaining.delete(n);
  }

  const children = new Map<number, number[]>();
  for (const [n, p] of parentNode) if (p >= 0) (children.get(p) || children.set(p, []).get(p)!).push(n);
  for (const arr of children.values()) arr.sort((a, b) => a - b);
  const termAt = new Map<number, TopoTerminal[]>();
  live.forEach((t, i) => (termAt.get(termNodes[i]) || termAt.set(termNodes[i], []).get(termNodes[i])!).push(t));

  const dirOf = (a: number, b: number): 0 | 1 => (Math.abs(px(a) - px(b)) > Math.abs(py(a) - py(b)) ? 0 : 1);
  const significant = (n: number): boolean => {
    if (n === rootNode || termAt.has(n)) return true;
    const ch = children.get(n) || [];
    if (ch.length !== 1) return true;
    return dirOf(parentNode.get(n)!, n) !== dirOf(n, ch[0]);
  };
  const flowOf = new Map<number, number>();
  const idsOf = new Map<number, string[]>();
  const visit = (n: number): void => {
    let f = 0;
    let ids: string[] = [];
    for (const t of termAt.get(n) || []) { f += t.cfm; ids.push(t.id); }
    for (const c of children.get(n) || []) {
      visit(c);
      f += flowOf.get(c)!;
      ids = ids.concat(idsOf.get(c)!);
    }
    flowOf.set(n, f);
    idsOf.set(n, ids);
  };
  visit(rootNode);

  const out: TopoSegment[] = [];
  const segEndingAt = new Map<number, number>();
  const queue: number[] = [rootNode];
  while (queue.length) {
    const head = queue.shift()!;
    for (const c0 of children.get(head) || []) {
      let n = c0;
      while (!significant(n)) n = children.get(n)![0];
      const a = P(head), b = P(n);
      const down = idsOf.get(n)!;
      const parentSeg = head === rootNode ? -1 : segEndingAt.get(head)!;
      const orientation: 'h' | 'v' = Math.abs(a.y - b.y) < EPS ? 'h' : 'v';
      const parentOrientation = parentSeg >= 0 ? out[parentSeg].orientation : orientation;
      const parentKind = parentSeg >= 0 ? out[parentSeg].kind : 'trunk';
      const trunkLike = down.length >= 2 && parentKind === 'trunk';
      const at = out.length;
      out.push({
        key: at,
        kind: trunkLike ? 'trunk' : down.length >= 2 ? 'branch' : 'runout',
        start: a,
        end: b,
        flow: flowOf.get(n)!,
        parent: parentSeg,
        direct: (termAt.get(n) || []).map((t) => t.id),
        downstream: down,
        orientation,
        isTakeoff: parentSeg >= 0 && parentOrientation !== orientation,
        onTrunk: false
      });
      segEndingAt.set(n, at);
      queue.push(n);
    }
  }
  return out;
}

// ───────────────────────────── clearance mode ─────────────────────────────
/** Standard tree whose trunk line sits at perpendicular coordinate `vStar` (a stub joins it to the root). */
function stubbedTree(root: Pt2, terminals: TopoTerminal[], opts: TopologyOptions, vStar: number): TopoSegment[] {
  const horizontal = opts.axis === 'h';
  const rv = horizontal ? root.y : root.x;
  if (Math.abs(vStar - rv) < 1e-9) return buildStandardTree(root, terminals, opts);
  const root2 = horizontal ? { x: root.x, y: vStar } : { x: vStar, y: root.y };
  const inner = buildStandardTree(root2, terminals, opts);
  const live = terminals.filter((t) => t.cfm > 0);
  const stub: TopoSegment = {
    key: 0,
    kind: 'trunk',
    start: { x: root.x, y: root.y },
    end: root2,
    flow: live.reduce((a, t) => a + t.cfm, 0),
    parent: -1,
    direct: [],
    downstream: live.map((t) => t.id),
    orientation: horizontal ? 'v' : 'h',
    isTakeoff: false,
    onTrunk: false
  };
  return [stub, ...inner.map((g) => ({ ...g, key: g.key + 1, parent: g.parent >= 0 ? g.parent + 1 : 0 }))];
}

/** Clearance-mode validation: inside the room with the duct EDGE off the wall, off every foreign terminal face, no overlaps. */
function checkClearanceLayout(
  segs: TopoSegment[],
  root: Pt2,
  terminals: TopoTerminal[],
  opts: TopologyOptions,
  poly: number[] | undefined
): { ok: boolean; crossings: number } {
  const hwT = opts.hwTrunk ?? 0;
  const hwB = opts.hwBranch ?? hwT;
  const wallClear = opts.wallClear ?? 0;
  const termClear = Math.max((opts.termClear ?? 0) - 1e-6, 0);
  const endTol = Math.max(opts.snapTol, 1e-6);
  const pos = new Map(terminals.map((t) => [t.id, { x: t.x, y: t.y }]));
  const exempt: Pt2[] = [root, ...terminals.map((t) => ({ x: t.x, y: t.y }))];
  const step = Math.max(0.5 * opts.minLen, 1e-6);
  const obstacles = opts.obstacles ?? [];
  for (const sg of segs) {
    const hw = sg.kind === 'trunk' ? hwT : hwB;
    if (poly && poly.length >= 6 && !segmentInsidePolygon(sg.start, sg.end, poly, hw + wallClear, step, exempt)) return { ok: false, crossings: 0 };
    for (const o of obstacles) {
      if (!ductOverlapsRect(sg, hw, inflateRect(o.rect, termClear))) continue;
      const tp = pos.get(o.id);
      const owns = !!tp && sg.direct.includes(o.id) && Math.hypot(sg.end.x - tp.x, sg.end.y - tp.y) <= endTol;
      if (!owns) return { ok: false, crossings: 0 };
    }
  }
  const tol = 0.012 * opts.minLen;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) if (collinearOverlap(segs[i], segs[j], tol) > 1e-6) return { ok: false, crossings: 0 };
    // parallel ducts of another network / zone keep their bodies apart (two trunk half widths + a hand of clearance)
    for (const a of opts.avoid || []) if (collinearOverlap(segs[i], a, opts.parallelSpacing ?? 2 * hwT + 0.25 * opts.minLen) > 1e-6) return { ok: false, crossings: 0 };
  }
  return { ok: true, crossings: countCrossings(segs, opts.avoid || [], [root], Math.max(opts.snapTol, 1e-6), 0.02 * opts.minLen) };
}

/** Candidate perpendicular coordinates for the trunk line, cheapest first. */
function trunkLineCandidates(root: Pt2, terminals: TopoTerminal[], opts: TopologyOptions, minOffset: number): number[] {
  const h = opts.axis === 'h';
  const rv = h ? root.y : root.x;
  const live = terminals.filter((t) => t.cfm > 0);
  if (!live.length) return [rv];
  const uOf = (p: Pt2): number => (h ? p.x : p.y);
  const vOf = (p: Pt2): number => (h ? p.y : p.x);
  const hwT = opts.hwTrunk ?? 0;
  const gap = hwT + (opts.termClear ?? 0);
  const us = live.map(uOf).concat(uOf(root));
  const uMin = Math.min(...us) - gap, uMax = Math.max(...us) + gap;
  const buf = 0.15 * opts.minLen; // comfort margin on top of the hard clearance
  const eps = 0.02 * opts.minLen;
  const raw: Array<[number, number]> = [];
  for (const o of opts.obstacles ?? []) {
    const [u1, u2] = h ? [o.rect.minX, o.rect.maxX] : [o.rect.minY, o.rect.maxY];
    if (u2 < uMin || u1 > uMax) continue;
    const [v1, v2] = h ? [o.rect.minY, o.rect.maxY] : [o.rect.minX, o.rect.maxX];
    raw.push([v1 - gap - buf, v2 + gap + buf]);
  }
  raw.sort((a, b) => a[0] - b[0]);
  const bands: Array<[number, number]> = [];
  for (const b of raw) {
    const last = bands[bands.length - 1];
    if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]);
    else bands.push([b[0], b[1]]);
  }
  const cands: number[] = [rv];
  for (let k = 1; k <= 4; k++) cands.push(rv + k * opts.minLen, rv - k * opts.minLen);
  for (const b of bands) cands.push(b[0] - eps, b[1] + eps);
  for (let i = 0; i + 1 < bands.length; i++) cands.push((bands[i][1] + bands[i + 1][0]) / 2);
  const free = (v: number): boolean => !bands.some((b) => v > b[0] + 1e-9 && v < b[1] - 1e-9);
  const stubOk = (v: number): boolean => {
    const d = Math.abs(v - rv);
    return (d < 1e-9 || d >= 0.99 * opts.minLen) && d >= minOffset - 1e-9;
  };
  const vs = live.map((t) => vOf(t));
  const cost = (v: number): number => vs.reduce((a, x) => a + Math.abs(x - v), 0) + 1.5 * Math.abs(v - rv);
  const uniq: number[] = [];
  for (const v of cands.filter((c) => free(c) && stubOk(c)).sort((a, b) => cost(a) - cost(b) || Math.abs(a - rv) - Math.abs(b - rv))) {
    if (!uniq.some((q) => Math.abs(q - v) < eps)) uniq.push(v);
  }
  return uniq;
}

function clearanceTree(root: Pt2, terminals: TopoTerminal[], opts: TopologyOptions): TopoResult {
  let res = clearanceTree0(root, terminals, opts);
  // congested rooms: accept ducts of different networks running closer in parallel before giving up on clean layouts
  if (!res.valid) {
    const relaxed = clearanceTree0(root, terminals, { ...opts, parallelSpacing: 0.012 * opts.minLen });
    if (relaxed.valid) res = relaxed;
  }
  return res;
}

function clearanceTree0(root: Pt2, terminals: TopoTerminal[], opts: TopologyOptions): TopoResult {
  const polys = [opts.polygon, opts.fallbackPolygon].filter((p): p is number[] => !!p && p.length >= 6);
  const live = terminals.filter((t) => t.cfm > 0);
  const avoid = opts.avoid || [];
  const minOff = opts.minRootOffset ?? 0;
  const offsets = minOff > 0 ? [minOff, (minOff * 2) / 3, minOff / 3, 0] : [0];
  let best = null as { segs: TopoSegment[]; crossings: number } | null;

  // 1. straight trunk + perpendicular takeoffs, trunk line moved off the diffuser rows
  for (const poly of polys.length ? polys : [undefined]) {
    for (const off of offsets) {
      let evaluated = 0;
      for (const v of trunkLineCandidates(root, terminals, opts, off)) {
        if (++evaluated > 48) break;
        const segs = stubbedTree(root, terminals, opts, v);
        const r = checkClearanceLayout(segs, root, terminals, opts, poly);
        if (!r.ok) continue;
        if (r.crossings === 0) return { segs, valid: true, crossings: 0 };
        if (!best || r.crossings < best.crossings) best = { segs, crossings: r.crossings };
      }
    }
    if (best) break;
  }

  // 2. orthogonal grid router around the terminals (L / U / rotated rooms, congested rows): no crossings first
  const hwBr = opts.hwBranch ?? opts.hwTrunk ?? 0;
  const rootRadius = Math.max(opts.snapTol, 1e-6);
  const tryGrid = (blockCross: boolean): { segs: TopoSegment[]; crossings: number } | null => {
    // edges use the (wider) trunk half width first, then the branch half width in congested rows; the crossing-free
    // search is limited to one variant (it is an optimisation, the second pass accepts crossings)
    for (const hw of blockCross ? [hwBr] : hwBr < (opts.hwTrunk ?? 0) ? [opts.hwTrunk ?? 0, hwBr] : [hwBr]) {
      const clr = hw + (opts.wallClear ?? 0);
      for (const poly of polys) {
        const gaps = avoid.length ? (blockCross ? [0.012 * opts.minLen] : [0.5 * opts.minLen, 0.012 * opts.minLen]) : [0];
        for (const gap of gaps) {
          const ctx: GridCtx = { obstacles: opts.obstacles ?? [], hw, termClear: opts.termClear ?? 0, blockCross, crossAvoid: avoid, rootRadius };
          const r = gridRoute(root, terminals, opts, poly, clr, avoid, gap, ctx);
          if (!r) continue;
          const chk = checkClearanceLayout(r, root, terminals, opts, poly);
          if (chk.ok) return { segs: r, crossings: chk.crossings };
        }
      }
    }
    return null;
  };
  if (!best || best.crossings > 0) {
    const g0 = tryGrid(true);
    if (g0) return { segs: g0.segs, valid: true, crossings: g0.crossings };
    if (!best) {
      const g1 = tryGrid(false);
      if (g1) best = g1;
    }
  }
  if (best) return { segs: best.segs, valid: true, crossings: best.crossings };

  // 3. nothing satisfies the clearance rules: legacy layout, reported invalid
  const legacy = buildLegacyTree(root, terminals, { ...opts, obstacles: undefined });
  return { segs: legacy.length || !live.length ? legacy : [], valid: false, crossings: 0 };
}

/**
 * Builds the orthogonal tree rooted at `root`. Segments are ordered so every parent precedes its
 * children. When a room polygon is supplied the straight trunk + branch layout is validated (inside the
 * room with wall clearance, no collinear overlap, clear of `avoid`); if it fails the tree is re-routed on
 * an orthogonal grid that stays inside the room (L / U / rotated rooms).
 * With `opts.obstacles` the clearance-mode rules apply too (see `TopologyOptions.obstacles`).
 */
export function buildOrthogonalTreeChecked(
  root: { x: number; y: number },
  terminals: TopoTerminal[],
  opts: TopologyOptions
): TopoResult {
  if (opts.obstacles) return clearanceTree(root, terminals, opts);
  return { segs: buildLegacyTree(root, terminals, opts), valid: true, crossings: 0 };
}

export function buildOrthogonalTree(
  root: { x: number; y: number },
  terminals: TopoTerminal[],
  opts: TopologyOptions
): TopoSegment[] {
  return buildOrthogonalTreeChecked(root, terminals, opts).segs;
}

function buildLegacyTree(
  root: { x: number; y: number },
  terminals: TopoTerminal[],
  opts: TopologyOptions
): TopoSegment[] {
  const std = buildStandardTree(root, terminals, opts);
  const polys = [opts.polygon, opts.fallbackPolygon].filter((p): p is number[] => !!p && p.length >= 6);
  const avoid = opts.avoid || [];
  if (!polys.length) return std;
  const clr = opts.clearance ?? 0.2 * opts.minLen;
  const gaps = avoid.length ? [0.5 * opts.minLen, 0.012 * opts.minLen] : [0];
  for (const poly of polys) {
    if (treeValid(std, root, terminals, opts, poly)) return std;
    for (const gap of gaps) {
      const r = gridRoute(root, terminals, opts, poly, clr, avoid, gap);
      if (r) return r;
    }
  }
  if (avoid.length) {
    for (const poly of polys) {
      const r = gridRoute(root, terminals, opts, poly, clr, [], 0);
      if (r) return r;
    }
  }
  return std;
}

/** Remove duplicate/zero-length/collinear-overlap hazards: asserts used by tests & callers. */
export function isOrthogonal(a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) < eps || Math.abs(a.y - b.y) < eps;
}
