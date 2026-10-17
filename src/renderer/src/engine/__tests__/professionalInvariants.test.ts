import type { DuctSegment } from '../../store/projectStore';
/**
 * Professional HVAC design invariants: a deterministic property matrix over the real entry points the UI uses
 * (calculateZoneLoad -> generateSystemCandidates -> executeAirDistributionDesign -> convertDesignResultToZonePayload
 * -> routeDucts, plus the canvas drawingGeometry helpers).
 *
 * Every invariant is checked for every case; failures are COUNTED per invariant with one minimal repro each
 * (smallest room area), a summary table is printed and the process exits non-zero if any invariant failed.
 *
 * Run: npx -y tsx src/renderer/src/engine/__tests__/professionalInvariants.test.ts
 */
import { calculateZoneLoad } from '../loadCalc';
import { generateSystemCandidates } from '../systemDesigner';
import { executeAirDistributionDesign, convertDesignResultToZonePayload, MAX_DUCTED_RETURN_CROSSINGS_PER_UNIT } from '../airDistributionEngine';
import { routeDucts } from '../ductRouter';
import { pxPerFt, toBtuh, toCfm, toSqFt, SQFT_PER_SQM, BTUH_PER_W, CFM_PER_LPS, MM_PER_IN } from '../units';
import { isPointInPolygon, calculateWallMountedUnitPos } from '../geometry';
import { unitFootprintFt, unitKeepOutFt } from '../ducts/clearance';
import { frictionRateExact, rectangularEquivalentDiameter } from '../ducts/ductPressureCalculator';
import { terminalFacePx, ductHalfWidthPx, parseTerminalSizeIn } from '../../canvas/drawingGeometry';
import type { Zone, ProjectMetadata } from '../../store/projectStore';

// ───────────────────────── Deterministic PRNG ─────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x5eed2026);
const between = (lo: number, hi: number): number => lo + (hi - lo) * rnd();
const half = (v: number): number => Math.round(v * 2) / 2; // 0.5 ft drafting resolution

// ───────────────────────── Failure ledger ─────────────────────────
interface Failure { caseId: string; area: number; detail: string; repro: string }
const ledger = new Map<string, { checked: Set<string>; failed: Map<string, Failure> }>();
const INVARIANT_ORDER: string[] = [];
function inv(name: string): { checked: Set<string>; failed: Map<string, Failure>; } {
  if (!ledger.has(name)) {
    ledger.set(name, { checked: new Set(), failed: new Map() });
    INVARIANT_ORDER.push(name);
  }
  return ledger.get(name)!;
}
let current: { id: string; area: number; repro: string } = { id: '', area: 0, repro: '' };
/** Records a check of `name` for the current case; `ok=false` stores the first detail per case. */
function check(name: string, ok: boolean, detail: () => string): void {
  const e = inv(name);
  e.checked.add(current.id);
  if (!ok && !e.failed.has(current.id)) {
    e.failed.set(current.id, { caseId: current.id, area: current.area, detail: detail(), repro: current.repro });
  }
}

// ───────────────────────── Geometry helpers ─────────────────────────
type P = { x: number; y: number };
const edgesOf = (poly: number[]): [P, P][] => {
  const out: Array<[P, P]> = [];
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.push([{ x: poly[2 * i], y: poly[2 * i + 1] }, { x: poly[2 * j], y: poly[2 * j + 1] }]);
  }
  return out;
};
function distToSeg(p: P, a: P, b: P): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
const wallDist = (p: P, poly: number[]): number => Math.min(...edgesOf(poly).map(([a, b]) => distToSeg(p, a, b)));
/** inside or within `tol` of the boundary */
const insideOrOn = (p: P, poly: number[], tol: number): boolean => isPointInPolygon(p.x, p.y, poly) || wallDist(p, poly) <= tol;
const polyArea = (poly: number[]): number => {
  let s = 0;
  for (let i = 0; i < poly.length; i += 2) {
    const j = (i + 2) % poly.length;
    s += poly[i] * poly[j + 1] - poly[j] * poly[i + 1];
  }
  return Math.abs(s) / 2;
};
const bboxOf = (poly: number[]): { w: number; h: number; minX: number; maxX: number; minY: number; maxY: number; cx: number; cy: number } => {
  const xs = poly.filter((_, i) => i % 2 === 0), ys = poly.filter((_, i) => i % 2 === 1);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { w: maxX - minX, h: maxY - minY, minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
};
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);

/** Deep scan for NaN / ±Infinity. Returns the first offending path or null. */
function findNonFinite(v: unknown, path = '$', seen = new Set<unknown>()): string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? null : `${path}=${v}`;
  if (v === null || typeof v !== 'object') return null;
  if (seen.has(v)) return null;
  seen.add(v);
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = findNonFinite(v[i], `${path}[${i}]`, seen);
      if (r) return r;
    }
    return null;
  }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    // Sizing ratios legitimately use Infinity for "no requirement given"; those are reported only when the input exists.
    const r = findNonFinite(x, `${path}.${k}`, seen);
    if (r) return r;
  }
  return null;
}
/** Deep equality ignoring `timestamp` keys. Returns first differing path or null. */
function deepDiff(a: unknown, b: unknown, path = '$'): string | null {
  if (typeof a !== typeof b) return `${path}: type ${typeof a} vs ${typeof b}`;
  if (a === null || b === null || typeof a !== 'object') {
    if (typeof a === 'number' && Number.isNaN(a) && Number.isNaN(b as number)) return null;
    return a === b ? null : `${path}: ${String(a).slice(0, 60)} vs ${String(b).slice(0, 60)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array mismatch`;
  const ka = Object.keys(a as object).filter((k) => k !== 'timestamp');
  const kb = Object.keys(b as object).filter((k) => k !== 'timestamp');
  if (ka.length !== kb.length) return `${path}: key count ${ka.length} vs ${kb.length}`;
  for (const k of ka) {
    const r = deepDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (r) return r;
  }
  return null;
}

// ───────────────────────── Case matrix ─────────────────────────
type Shape = 'rect' | 'portrait' | 'L' | 'U' | 'rot30';
const SPACE_TYPES = ['office', 'conference', 'classroom', 'retail', 'lobby'];
interface Room { shape: Shape; polyFt: number[]; spaceTypeId: string; label: string }

function makeRoom(shape: Shape, idx: number): Room {
  const ox = half(between(5, 40)), oy = half(between(5, 40));
  let local: number[];
  let label: string;
  if (shape === 'rect' || shape === 'portrait' || shape === 'rot30') {
    const long = half(between(8, 60));
    const aspect = between(1, 4);
    const short = Math.max(8, half(long / aspect));
    const [w, h] = shape === 'portrait' ? [short, long] : [long, short];
    label = `${w}x${h}ft`;
    local = [0, 0, w, 0, w, h, 0, h];
    if (shape === 'rot30') {
      const a = Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
      const pts: number[] = [];
      for (let i = 0; i < local.length; i += 2) {
        const x = local[i] - w / 2, y = local[i + 1] - h / 2;
        pts.push(w / 2 + x * c - y * s + h * s, h / 2 + x * s + y * c + w * s);
      }
      local = pts;
      label += '@30deg';
    }
  } else if (shape === 'L') {
    const W = half(between(24, 60)), H = half(between(24, 60));
    const cx = half(W * between(0.35, 0.65)), cy = half(H * between(0.35, 0.65));
    local = [0, 0, W, 0, W, cy, cx, cy, cx, H, 0, H];
    label = `L ${W}x${H} cut@${cx},${cy}`;
  } else {
    const W = half(between(30, 60)), H = half(between(24, 50));
    const leg = half(W * between(0.28, 0.36));
    const d = half(H * between(0.4, 0.6));
    local = [0, 0, W, 0, W, H, W - leg, H, W - leg, H - d, leg, H - d, leg, H, 0, H];
    label = `U ${W}x${H} leg ${leg} notch ${d}`;
  }
  const polyFt = local.map((v, i) => parseFloat((v + (i % 2 === 0 ? ox : oy)).toFixed(4)));
  return { shape, polyFt, spaceTypeId: SPACE_TYPES[idx % SPACE_TYPES.length], label };
}

const SHAPE_PLAN: Shape[] = [
  ...Array(12).fill('rect'), ...Array(6).fill('portrait'), ...Array(6).fill('L'), ...Array(4).fill('U'), ...Array(3).fill('rot30')
];
const rooms: Room[] = SHAPE_PLAN.map((s, i) => makeRoom(s, i));
// Fixed edge cases: the 8 ft minimum square and a 60 ft square
rooms.push({ shape: 'rect', polyFt: [10, 10, 18, 10, 18, 18, 10, 18], spaceTypeId: 'office', label: '8x8ft' });
rooms.push({ shape: 'rect', polyFt: [0, 0, 60, 0, 60, 60, 0, 60], spaceTypeId: 'retail', label: '60x60ft' });

interface UnitCase { units: 'imperial' | 'metric'; scale: number; project: ProjectMetadata }
const IMPERIAL: UnitCase = {
  units: 'imperial', scale: 10,
  project: { name: 'T', location: 'T', scale: 10, units: 'imperial', outdoorDb: 95, indoorDb: 75 }
};
const METRIC: UnitCase = {
  units: 'metric', scale: 20,
  project: { name: 'T', location: 'T', scale: 20, units: 'metric', outdoorDb: 35, indoorDb: 35 - 20 / 1.8 }
};

const FRICTION_LIMIT = 0.10;
const CONNECT_TOL_FT = 0.6; // on-line tolerance 0.5 ft + station snap 0.1 ft
const NODE_TOL_FT = 0.02; // r2() rounding of section end points

// ───────────────────────── Duct network checks (shared) ─────────────────────────
interface NetSeg {
  id: string; a: P; b: P; cfm: number; w: number; h: number; parent?: string; trunk: boolean;
  flagged: boolean; velocity: number; vLimit: number; network: 'supply' | 'return'; unit: string;
}
interface NetTerm { id: string; p: P; cfm: number; network: 'supply' | 'return'; unit: string }

function checkDuctNetworks(
  tag: string,
  segs: NetSeg[],
  terms: NetTerm[],
  roots: Map<string, P>, // unit -> root point (unit position)
  roomPoly: number[],
  ftPerCoord: number, // coordinate units -> ft
  metricSizes: boolean
): void {
  const tol = (ft: number): number => ft / ftPerCoord;
  const byId = new Map(segs.map((s) => [s.id, s]));
  const children = new Map<string, NetSeg[]>();
  for (const s of segs) if (s.parent) (children.get(s.parent) || children.set(s.parent, []).get(s.parent)!).push(s);

  // orthogonal / zero length
  for (const s of segs) {
    const dx = Math.abs(s.b.x - s.a.x), dy = Math.abs(s.b.y - s.a.y);
    check(`${tag}.orthogonal`, dx < 1e-6 || dy < 1e-6, () => `${s.id} dx=${dx.toFixed(4)} dy=${dy.toFixed(4)}`);
    check(`${tag}.noZeroLength`, Math.hypot(dx, dy) > 1e-6, () => `${s.id} has zero length`);
  }
  // collinear overlap (same network, whole room) and supply/return overlap
  const overlaps = (s: NetSeg, t: NetSeg): boolean => {
    const sh = Math.abs(s.a.y - s.b.y) < 1e-6, th = Math.abs(t.a.y - t.b.y) < 1e-6;
    const sv = Math.abs(s.a.x - s.b.x) < 1e-6, tv = Math.abs(t.a.x - t.b.x) < 1e-6;
    const ovl = (a1: number, a2: number, b1: number, b2: number): number =>
      Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
    if (sh && th && !(sv && tv) && Math.abs(s.a.y - t.a.y) < 1e-6) return ovl(s.a.x, s.b.x, t.a.x, t.b.x) > 1e-6;
    if (sv && tv && !(sh && th) && Math.abs(s.a.x - t.a.x) < 1e-6) return ovl(s.a.y, s.b.y, t.a.y, t.b.y) > 1e-6;
    return false;
  };
  let sameNet: string | null = null, crossNet: string | null = null;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (!overlaps(segs[i], segs[j])) continue;
      if (segs[i].network === segs[j].network) sameNet ??= `${segs[i].id} overlaps ${segs[j].id}`;
      else crossNet ??= `${segs[i].id} overlaps ${segs[j].id}`;
    }
  }
  check(`${tag}.noCollinearOverlap`, !sameNet, () => sameNet!);
  check(`${tag}.noSupplyReturnOverlap`, !crossNet, () => crossNet!);

  // ducts inside the room (end points and mid points)
  {
    let bad: string | null = null;
    for (const s of segs) {
      for (const p of [s.a, s.b, { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }]) {
        if (!insideOrOn(p, roomPoly, tol(0.05))) { bad ??= `${s.id} point (${(p.x * ftPerCoord).toFixed(2)},${(p.y * ftPerCoord).toFixed(2)})ft outside room`; }
      }
    }
    check(`${tag}.insideRoom`, !bad, () => bad!);
  }

  // topology continuity + reachability from the unit
  const reach = (s: NetSeg, depth = 0): boolean => {
    if (depth > segs.length) return false;
    if (!s.parent) {
      const r = roots.get(s.unit);
      return !!r && Math.hypot(s.a.x - r.x, s.a.y - r.y) <= tol(NODE_TOL_FT);
    }
    const p = byId.get(s.parent);
    if (!p) return false;
    if (Math.hypot(s.a.x - p.b.x, s.a.y - p.b.y) > tol(NODE_TOL_FT)) return false;
    return reach(p, depth + 1);
  };
  {
    let bad: string | null = null;
    for (const s of segs) if (!reach(s)) bad ??= `${s.id} not geometrically reachable from unit (parent ${s.parent ?? 'none'})`;
    check(`${tag}.treeContinuity`, !bad, () => bad!);
  }

  // every terminal connected: nearest segment END within tolerance, on a reachable segment of its network
  const assigned = new Map<string, number>();
  {
    let bad: string | null = null;
    for (const t of terms) {
      let best: NetSeg | null = null, bd = Infinity;
      for (const s of segs) {
        if (s.network !== t.network) continue;
        const d = Math.hypot(s.b.x - t.p.x, s.b.y - t.p.y);
        if (d < bd) { bd = d; best = s; }
      }
      if (!best || bd > tol(CONNECT_TOL_FT) || !reach(best)) {
        bad ??= `${t.network} terminal ${t.id} at (${(t.p.x * ftPerCoord).toFixed(2)},${(t.p.y * ftPerCoord).toFixed(2)})ft: nearest duct end ${(bd * ftPerCoord).toFixed(2)} ft`;
      } else assigned.set(best.id, (assigned.get(best.id) || 0) + t.cfm);
    }
    check(`${tag}.terminalsConnected`, !bad, () => bad!);
  }

  // flow conservation: section flow = terminals at its end + sum of child sections
  {
    let bad: string | null = null;
    for (const s of segs) {
      const kids = (children.get(s.id) || []).reduce((a, c) => a + c.cfm, 0);
      const expect = kids + (assigned.get(s.id) || 0);
      if (Math.abs(s.cfm - expect) > 1.01) bad ??= `${s.id} carries ${s.cfm} CFM, downstream sum ${expect}`;
    }
    check(`${tag}.flowConservation`, !bad, () => bad!);
  }

  // trunk widths non-increasing downstream, depth held
  {
    let bad: string | null = null;
    for (const s of segs) {
      const p = s.parent ? byId.get(s.parent) : undefined;
      if (s.trunk && p && p.trunk && p.network === s.network) {
        if (s.w > p.w + 1e-9) bad ??= `${s.id} width ${s.w}" > upstream ${p.id} ${p.w}"`;
      }
    }
    check(`${tag}.trunkWidthMonotonic`, !bad, () => bad!);
  }

  // aspect, friction, velocity (unless flagged), increments
  {
    let aspect: string | null = null, fric: string | null = null, vel: string | null = null, inc: string | null = null;
    for (const s of segs) {
      const ar = Math.max(s.w, s.h) / Math.max(1e-9, Math.min(s.w, s.h));
      if (ar > 4 + 1e-6 && !s.flagged) aspect ??= `${s.id} ${s.w}"x${s.h}" aspect ${ar.toFixed(2)} not flagged`;
      if (s.cfm > 0) {
        const f = frictionRateExact(s.cfm, rectangularEquivalentDiameter(s.w, s.h));
        if (f > FRICTION_LIMIT + 1e-3 && !s.flagged) fric ??= `${s.id} ${s.cfm} CFM in ${s.w.toFixed(2)}"x${s.h.toFixed(2)}" friction ${f.toFixed(3)} in/100ft not flagged`;
        if (s.velocity > s.vLimit + 1 && !s.flagged) vel ??= `${s.id} ${s.velocity} fpm > limit ${s.vLimit} not flagged`;
      }
      const okInc = (v: number): boolean => metricSizes
        ? Math.abs((v * MM_PER_IN) / 50 - Math.round((v * MM_PER_IN) / 50)) < 0.01
        : Math.abs(v / 2 - Math.round(v / 2)) < 1e-6;
      if (!okInc(s.w) || !okInc(s.h)) inc ??= `${s.id} ${metricSizes ? `${(s.w * MM_PER_IN).toFixed(1)}x${(s.h * MM_PER_IN).toFixed(1)} mm` : `${s.w}"x${s.h}"`} not on ${metricSizes ? '50 mm' : '2"'} grid`;
    }
    check(`${tag}.aspectLe4`, !aspect, () => aspect!);
    check(`${tag}.frictionLe0.10`, !fric, () => fric!);
    check(`${tag}.velocityLeRoleLimit`, !vel, () => vel!);
    check(`${tag}.sizeIncrements`, !inc, () => inc!);
  }
}

// ───────────────────────── Plan clash checks (shared) ─────────────────────────
const WALL_DUCT_CLEARANCE_FT = 0.5;
const CLASH_TOL_FT = 0.02;
interface ClashSeg { id: string; a: P; b: P; wIn: number; network: 'supply' | 'return'; crossover: boolean; flagged?: boolean }
interface ClashTerm { id: string; p: P; w: number; h: number } // face size in inches

/** Interior overlap (ft) between the duct body (segment +- width/2) and a terminal face rectangle. */
function bodyFaceOverlap(s: ClashSeg, t: ClashTerm, ftPerCoord: number): number {
  const hw = s.wIn / 24;
  const ax = s.a.x * ftPerCoord, ay = s.a.y * ftPerCoord, bx = s.b.x * ftPerCoord, by = s.b.y * ftPerCoord;
  const px = t.p.x * ftPerCoord, py = t.p.y * ftPerCoord;
  const ox = Math.min(Math.max(ax, bx) + hw, px + t.w / 24) - Math.max(Math.min(ax, bx) - hw, px - t.w / 24);
  const oy = Math.min(Math.max(ay, by) + hw, py + t.h / 24) - Math.max(Math.min(ay, by) - hw, py - t.h / 24);
  return Math.min(ox, oy);
}

/** Proper/touching crossing point of two axis-aligned segments (ft), or null. */
function crossPoint(s: ClashSeg, t: ClashSeg, ftPerCoord: number): P | null {
  const f = (p: P): P => ({ x: p.x * ftPerCoord, y: p.y * ftPerCoord });
  const a = f(s.a), b = f(s.b), c = f(t.a), d = f(t.b);
  const sh = Math.abs(a.y - b.y) < 1e-6, sv = Math.abs(a.x - b.x) < 1e-6;
  const th = Math.abs(c.y - d.y) < 1e-6, tv = Math.abs(c.x - d.x) < 1e-6;
  const within = (v: number, p: number, q: number): boolean => v >= Math.min(p, q) - CLASH_TOL_FT && v <= Math.max(p, q) + CLASH_TOL_FT;
  if (sh && !sv && tv && !th) return within(c.x, a.x, b.x) && within(a.y, c.y, d.y) ? { x: c.x, y: a.y } : null;
  if (sv && !sh && th && !tv) return within(a.x, c.x, d.x) && within(c.y, a.y, b.y) ? { x: a.x, y: c.y } : null;
  return null;
}

function checkClashes(tag: string, segs: ClashSeg[], terms: ClashTerm[], roomPoly: number[], ftPerCoord: number, roots: P[]): void {
  const polyF = roomPoly.map((v) => v * ftPerCoord);
  // 1. duct EDGE (centreline +- width/2) stays >= 0.5 ft inside the wall along its whole length
  {
    let bad: string | null = null;
    for (const s of segs) {
      if (s.flagged) { flaggedClearance[tag] = (flaggedClearance[tag] || 0) + 1; if (process.env.INVARIANTS_FLAGS) console.log(`FLAG ${tag} ${current.id} area=${current.area.toFixed(0)} ${s.id}`); continue; }
      const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) * ftPerCoord;
      const n = Math.max(1, Math.ceil(L / 0.25));
      for (let i = 0; i <= n; i++) {
        const p = { x: (s.a.x + ((s.b.x - s.a.x) * i) / n) * ftPerCoord, y: (s.a.y + ((s.b.y - s.a.y) * i) / n) * ftPerCoord };
        const need = s.wIn / 24 + WALL_DUCT_CLEARANCE_FT - CLASH_TOL_FT;
        const wd = wallDist(p, polyF);
        if (!isPointInPolygon(p.x, p.y, polyF) || wd < need) {
          bad ??= `${s.id} (${s.wIn}" wide) at (${p.x.toFixed(2)},${p.y.toFixed(2)})ft: wall distance ${wd.toFixed(2)} ft, edge clearance ${(wd - s.wIn / 24).toFixed(2)} ft < 0.5`;
          break;
        }
      }
    }
    check(`${tag}.ductEdgeInsideWithClearance`, !bad, () => bad!);
  }
  // 2. no duct body through a terminal face, except the final run-out that ends at that terminal's centre
  {
    let bad: string | null = null;
    for (const s of segs) {
      if (s.flagged) continue;
      for (const t of terms) {
        const ov = bodyFaceOverlap(s, t, ftPerCoord);
        if (ov <= 0.01) continue;
        const endsAtCentre = Math.hypot(s.b.x - t.p.x, s.b.y - t.p.y) * ftPerCoord <= 0.15;
        if (!endsAtCentre) bad ??= `${s.id} (${s.wIn}" wide, ${s.network}) passes through terminal ${t.id} face ${t.w}"x${t.h}" at (${(t.p.x * ftPerCoord).toFixed(2)},${(t.p.y * ftPerCoord).toFixed(2)})ft (overlap ${ov.toFixed(2)} ft)`;
      }
    }
    check(`${tag}.noDuctThroughForeignTerminal`, !bad, () => bad!);
  }
  // 3. supply and return networks do not cross in plan (an unavoidable crossing must be flagged as a crossover)
  {
    let unflagged: string | null = null;
    let crossings = 0;
    for (const s of segs) {
      if (s.network !== 'supply') continue;
      for (const r of segs) {
        if (r.network !== 'return') continue;
        const p = crossPoint(s, r, ftPerCoord);
        if (!p || roots.some((q) => Math.hypot(q.x * ftPerCoord - p.x, q.y * ftPerCoord - p.y) <= 0.1)) continue;
        crossings++;
        if (!(s.crossover && r.crossover)) unflagged ??= `${s.id} crosses ${r.id} at (${p.x.toFixed(2)},${p.y.toFixed(2)})ft and is not flagged as a crossover`;
      }
    }
    check(`${tag}.noSupplyReturnCrossing`, !unflagged, () => unflagged!);
    crossoverTotals[tag] = (crossoverTotals[tag] || 0) + crossings;
  }
}
const crossoverTotals: Record<string, number> = {};
const flaggedClearance: Record<string, number> = {};

/** Sampled test of an oriented rectangle (centre, long-axis angle, length x depth in ft). */
function orientedSamples(c: P, angleDeg: number, L: number, D: number): P[] {
  const a = (angleDeg * Math.PI) / 180, tx = Math.cos(a), ty = Math.sin(a), nx = -ty, ny = tx;
  const pts: P[] = [];
  const nL = Math.max(2, Math.ceil(L / 0.1)), nD = Math.max(2, Math.ceil(D / 0.1));
  for (let i = 0; i <= nL; i++) for (let j = 0; j <= nD; j++) {
    if (i !== 0 && i !== nL && j !== 0 && j !== nD && (i % 3 || j % 3)) continue; // dense boundary, sparse interior
    const u = (i / nL - 0.5) * L, v = (j / nD - 0.5) * D;
    pts.push({ x: c.x + tx * u + nx * v, y: c.y + ty * u + ny * v });
  }
  return pts;
}

// ───────────────────────── Main loop ─────────────────────────
const t0 = Date.now();
let caseCount = 0;

for (let ri = 0; ri < rooms.length; ri++) {
  const room = rooms[ri];
  const areaFt2 = polyArea(room.polyFt);
  const bb = bboxOf(room.polyFt);
  const loads: Record<string, ReturnType<typeof calculateZoneLoad>> = {};
  const bestIds: Record<string, string | null> = {};

  for (const uc of [IMPERIAL, METRIC]) {
    const id = `R${String(ri).padStart(2, '0')}-${room.shape}-${room.spaceTypeId}-${uc.units}`;
    // INVARIANTS_ONLY=<substring of case id> runs just the matching cases (debugging aid)
    if (process.env.INVARIANTS_ONLY && !id.includes(process.env.INVARIANTS_ONLY)) continue;
    caseCount++;
    const k = pxPerFt(uc.scale, uc.units);
    const pxPoly = room.polyFt.map((v) => v * k);
    current = {
      id,
      area: areaFt2,
      repro: `${room.label} ${room.spaceTypeId} ${uc.units} scale=${uc.scale}px/${uc.units === 'metric' ? 'm' : 'ft'} polyFt=[${room.polyFt.join(',')}]`
    };

    const zone: Zone = {
      id: `zone-${ri}`,
      name: id,
      points: pxPoly,
      spaceTypeId: room.spaceTypeId,
      ceilingHeight: uc.units === 'metric' ? 3.048 : 10,
      occupants: 0,
      systemType: 'concealed',
      diffusers: [],
      ducts: []
    };

    let load: ReturnType<typeof calculateZoneLoad>;
    try {
      load = calculateZoneLoad(zone, uc.project);
    } catch (e) {
      check('crash.calculateZoneLoad', false, () => String(e));
      continue;
    }
    check('crash.calculateZoneLoad', true, () => '');
    loads[uc.units] = load;
    check('determinism.load', !deepDiff(load, calculateZoneLoad(zone, uc.project)), () => deepDiff(load, calculateZoneLoad(zone, uc.project))!);
    check('noNaN.load', !findNonFinite(load), () => findNonFinite(load)!);

    // ── Load invariants (imperial basis) ──
    const roomSensBtuh = (load.roomSensibleBtuh ?? 0);
    const thermalCfm = toCfm(load.thermalCfm, uc.units);
    const supplyCfm = toCfm(load.supplyCfm, uc.units);
    const coilBtuh = toBtuh(load.totalLoad, uc.units);
    const coilSensBtuh = toBtuh(load.sensibleLoad, uc.units);
    const areaSqFt = toSqFt(load.area, uc.units);
    check('load.cfmFromRoomSensible(2%)', rel(thermalCfm, roomSensBtuh / (1.08 * 20)) <= 0.02,
      () => `thermalCfm ${thermalCfm.toFixed(1)} vs Qs_room/(1.08*20) ${(roomSensBtuh / 21.6).toFixed(1)}`);
    // RULING (planner): for DX/refrigerant systems the design supply airflow is
    // max(thermal, Voz, 350 CFM x coil tons) (coil tons include the OA load, so thermal CFM alone can drop to
    // 228-300 CFM/ton). `thermalCfm` stays Qs_room/(1.08*20); `supplyCfm` is the design airflow (100 CFM floor).
    check('load.supplyGeThermal', supplyCfm >= thermalCfm * 0.98,
      () => `supply ${supplyCfm.toFixed(1)} < thermal ${thermalCfm.toFixed(1)} -2%`);
    {
      const voz = toCfm(load.vozCfm, uc.units);
      const expected = Math.max(100, thermalCfm, voz, 350 * (coilBtuh / 12000));
      check('load.supplyIsDesignAirflow(2%)', rel(supplyCfm, expected) <= 0.02,
        () => `supply ${supplyCfm.toFixed(1)} vs max(thermal ${thermalCfm.toFixed(1)}, Voz ${voz.toFixed(1)}, 350*tons ${(350 * coilBtuh / 12000).toFixed(1)}) = ${expected.toFixed(1)}`);
    }
    const cfmPerTon = supplyCfm / (coilBtuh / 12000);
    check('load.cfmPerTon[250,550]', cfmPerTon >= 250 && cfmPerTon <= 550,
      () => `${cfmPerTon.toFixed(0)} CFM/ton (supply ${supplyCfm.toFixed(0)} CFM, coil ${coilBtuh.toFixed(0)} Btu/h = ${(coilBtuh / 12000).toFixed(2)} t, room Qs ${roomSensBtuh.toFixed(0)}, OA Qs ${(load.oaSensibleBtuh ?? 0).toFixed(0)})`);
    check('load.areaMatchesPolygon', rel(areaSqFt, areaFt2) <= 0.01, () => `load area ${areaSqFt.toFixed(1)} ft2 vs polygon ${areaFt2.toFixed(1)} ft2`);

    // ── Selection (store / optimizer-panel path) ──
    let summary: ReturnType<typeof generateSystemCandidates> | null = null;
    try {
      summary = generateSystemCandidates(load.totalLoad, load.sensibleLoad, load.supplyCfm, room.spaceTypeId, load.area, uc.units === 'imperial', {}, undefined, null);
      check('crash.generateSystemCandidates', true, () => '');
    } catch (e) {
      check('crash.generateSystemCandidates', false, () => String(e));
    }
    if (summary) {
      check('selection.hasRecommended', !!summary.bestOverall, () => `no valid candidate among ${summary!.candidates.length}; first: ${summary!.candidates[0]?.diagnostics.map((d) => d.code).join(',')}`);
      bestIds[uc.units] = summary.bestOverall?.id ?? null;
      let capBad: string | null = null, sensBad: string | null = null, cfmBad: string | null = null;
      for (const c of summary.candidates.filter((x) => x.isValid)) {
        const installed = c.installedCapacityBtu ?? c.quantity * c.equipment.totalCapacityBtuPerHour;
        const ratio = installed / coilBtuh;
        // Manual S ruling: up to 1.35 only with a NEXT_NOMINAL_SIZE warning diagnostic; MIN_AVAILABLE_SIZE (load below
        // the smallest unit in the family) waives the upper bound since no smaller unit exists.
        const relaxed = c.diagnostics.some((d) => d.code === 'NEXT_NOMINAL_SIZE' || d.code === 'MIN_AVAILABLE_SIZE');
        const minAvail = c.diagnostics.some((d) => d.code === 'MIN_AVAILABLE_SIZE');
        if (ratio < 1 - 1e-9 || (!minAvail && ratio > (relaxed ? 1.35 : 1.2) + 1e-9)) capBad ??= `${c.id}: installed ${installed} / coil ${coilBtuh.toFixed(0)} = ${ratio.toFixed(3)}`;
        const airUnit = c.indoorUnit ?? c.equipment;
        const sens = airUnit.sensibleCapacityBtuPerHour * c.quantity;
        if (sens < roomSensBtuh - 1e-6) sensBad ??= `${c.id}: sensible ${sens} < room ${roomSensBtuh.toFixed(0)}`;
        const del = c.deliveredCfm ?? airUnit.nominalCfm * c.quantity;
        const ar = del / supplyCfm;
        if (ar < 0.95 - 1e-9 || (!minAvail && ar > 1.25 + 1e-9)) cfmBad ??= `${c.id}: delivered ${del} / required ${supplyCfm.toFixed(0)} = ${ar.toFixed(3)}`;
      }
      check('selection.capacityRatio[1.0,1.2]', !capBad, () => capBad!);
      check('selection.sensibleGeRoom', !sensBad, () => sensBad!);
      check('selection.airflowRatio[0.95,1.25]', !cfmBad, () => cfmBad!);
      check('noNaN.candidates', !findNonFinite(summary.candidates), () => findNonFinite(summary!.candidates)!);
      const again = generateSystemCandidates(load.totalLoad, load.sensibleLoad, load.supplyCfm, room.spaceTypeId, load.area, uc.units === 'imperial', {}, undefined, null);
      const dd = deepDiff(summary, again);
      check('determinism.candidates', !dd, () => dd!);
    }

    // ── Air-distribution engine (AirDistributionSchedulePanel path, canvas px input) ──
    const input = {
      roomName: id,
      roomPolygon: pxPoly,
      scalePxPerUnit: uc.scale,
      units: uc.units,
      roomAreaSqFt: areaSqFt,
      sensibleLoadBtu: coilSensBtuh,
      totalLoadBtu: coilBtuh,
      requiredCfm: supplyCfm,
      occupancyCount: load.occupants || undefined,
      spaceTypeId: room.spaceTypeId,
      exhaustCfm: toCfm(load.exhaustCfm || 0, uc.units),
      systemType: 'concealed',
      mountingWallSide: 'east' as const,
      maxAvailableCeilingDepthIn: 14,
      // every third room has a neighbouring zone directly east of its bounding box: the ODU must not overlap it
      otherZonePolygons: ri % 3 === 0
        ? [[bb.maxX, bb.minY, bb.maxX + 40, bb.minY, bb.maxX + 40, bb.maxY, bb.maxX, bb.maxY].map((v) => v * k)]
        : undefined
    };
    let design: ReturnType<typeof executeAirDistributionDesign>;
    try {
      const tA = Date.now(); design = executeAirDistributionDesign(input); if (process.env.INVARIANTS_TIME) console.log(`engine ${id} ${Date.now() - tA} ms`);
      check('crash.executeAirDistributionDesign', true, () => '');
    } catch (e) {
      check('crash.executeAirDistributionDesign', false, () => String((e as Error).stack || e).split('\n').slice(0, 3).join(' | '));
      continue;
    }
    const polyFt = design.roomPolygonFt;
    check('units.pxToFtBoundary', polyFt.every((v, i) => Math.abs(v - room.polyFt[i]) < 1e-9) && Math.abs(design.pxPerFt - k) < 1e-12,
      () => `roomPolygonFt ${polyFt.slice(0, 4).join(',')}... vs ${room.polyFt.slice(0, 4).join(',')}...`);
    check('noNaN.design', !findNonFinite(design), () => findNonFinite(design)!);
    {
      const dd = deepDiff(design, executeAirDistributionDesign(input));
      check('determinism.design', !dd, () => dd!);
    }

    // Engine selection
    const so = design.selectedOption;
    check('selection.engineValid', so.isValid !== false, () => `${so.optionId} ${so.unitModel} invalid: ${(so.violations || []).join('; ')}`);
    {
      const r = so.totalDeliveredCapacityBtu / coilBtuh;
      // ACCA Manual S "next nominal size" ruling: the 1.20 ceiling relaxes to 1.35 ONLY when the engine flagged
      // NEXT_NOMINAL_SIZE (no model x qty fits the window); MIN_AVAILABLE_SIZE (load below the smallest unit) has no upper bound.
      const relaxed = (so.warnings || []).some((w) => w === 'NEXT_NOMINAL_SIZE' || w === 'MIN_AVAILABLE_SIZE');
      const minAvailCap = (so.warnings || []).includes('MIN_AVAILABLE_SIZE');
      const capMax = relaxed ? 1.35 : 1.2;
      check('selection.engineCapacityRatio[1.0,1.2]', r >= 1 - 1e-9 && (minAvailCap || r <= capMax + 1e-9), () => `${so.unitCount}x${so.unitModel}: ${so.totalDeliveredCapacityBtu}/${coilBtuh.toFixed(0)} = ${r.toFixed(3)}`);
      const sens = so.equipmentDetails.sensibleCapacityBtu * so.unitCount;
      check('selection.engineSensibleGeRoom', sens >= roomSensBtuh - 1e-6, () => `${so.unitCount}x${so.unitModel}: sensible ${sens} < room ${roomSensBtuh.toFixed(0)}`);
      const a = so.totalDeliveredCfm / supplyCfm;
      // MIN_AVAILABLE_SIZE: the smallest unit's fan cannot turn down below minCfm, so the upper bound is waived.
      const minAvail = (so.warnings || []).includes('MIN_AVAILABLE_SIZE');
      check('selection.engineAirflowRatio[0.95,1.25]', a >= 0.95 - 1e-9 && (minAvail || a <= 1.25 + 1e-9), () => `${so.unitCount}x${so.unitModel}: ${so.totalDeliveredCfm}/${supplyCfm.toFixed(0)} = ${a.toFixed(3)}`);
    }

    // ── Layout ──
    const allTerms = [...design.supplyTerminals, ...design.returnTerminals];
    {
      let bad: string | null = null;
      for (const t of allTerms) {
        const inside = isPointInPolygon(t.position.x, t.position.y, polyFt);
        const wd = wallDist(t.position, polyFt);
        if (!inside || wd < 1 - 1e-6) bad ??= `${t.type} ${t.id} at (${t.position.x},${t.position.y}) inside=${inside} wall clearance ${wd.toFixed(2)} ft`;
      }
      check('layout.terminalsInsideWith1ftClearance', !bad, () => bad!);
    }
    {
      let bad: string | null = null;
      for (let i = 0; i < allTerms.length; i++) for (let j = i + 1; j < allTerms.length; j++) {
        const d = Math.hypot(allTerms[i].position.x - allTerms[j].position.x, allTerms[i].position.y - allTerms[j].position.y);
        if (d < 0.01) bad ??= `${allTerms[i].id} and ${allTerms[j].id} coincide at (${allTerms[i].position.x},${allTerms[i].position.y})`;
      }
      check('layout.uniquePositions', !bad, () => bad!);
    }
    if (Math.min(bb.w, bb.h) >= 12) {
      let bad: string | null = null;
      for (const r of design.returnTerminals) for (const s of design.supplyTerminals) {
        const d = Math.hypot(r.position.x - s.position.x, r.position.y - s.position.y);
        if (d < 4 - 1e-6) bad ??= `return ${r.id} ${d.toFixed(2)} ft from supply ${s.id}`;
      }
      check('layout.returnGe4ftFromSupply', !bad, () => bad!);
    }
    {
      const sumS = design.supplyTerminals.reduce((a, t) => a + t.cfm, 0);
      check('layout.supplySumEqualsUnitCfm(1%)', rel(sumS, so.totalDeliveredCfm) <= 0.01, () => `sum supply ${sumS} vs unit ${so.totalDeliveredCfm}`);
      const mb = design.massBalance;
      const sumR = design.returnTerminals.reduce((a, t) => a + t.cfm, 0);
      const expR = mb.supplyCfm - mb.exhaustCfm - mb.exfiltrationCfm;
      check('layout.returnSumMassBalance(2%)', rel(sumR, expR) <= 0.02 || Math.abs(sumR - expR) <= 1,
        () => `sum return ${sumR} vs supply ${mb.supplyCfm} - exh ${mb.exhaustCfm} - exf ${mb.exfiltrationCfm} = ${expR}`);
      check('layout.hasSupplyAndReturn', design.supplyTerminals.length > 0 && design.returnTerminals.length > 0,
        () => `${design.supplyTerminals.length} supplies, ${design.returnTerminals.length} returns`);
    }

    // ── Equipment ──
    {
      let bad: string | null = null;
      for (const z of design.serviceZones) {
        if (!isPointInPolygon(z.equipmentPosition.x, z.equipmentPosition.y, polyFt)) bad ??= `IDU ${z.unitTag} at (${z.equipmentPosition.x},${z.equipmentPosition.y}) outside room`;
      }
      check('equipment.IDUInside', !bad, () => bad!);
      let badO: string | null = null;
      for (const o of design.outdoorUnitPositions) {
        if (isPointInPolygon(o.x, o.y, polyFt)) badO ??= `ODU at (${o.x},${o.y}) inside room`;
      }
      check('equipment.ODUOutside', !badO, () => badO!);
      const pos = design.outdoorUnitPositions.map((o) => `${o.x},${o.y}`);
      check('equipment.ODUDistinct', new Set(pos).size === pos.length, () => `ODU positions ${pos.join(' | ')}`);
    }

    // ── Engine duct networks (feet) ──
    // Default return strategy for concealed units with a ceiling plenum is 'plenum': NO return mains, only one short
    // return box per unit. The ducted variant (imperial cases) is checked with the same network / clash rules, plus
    // at most ONE supply / return crossing per unit.
    const engineNetworkChecks = (tag: string, d: ReturnType<typeof executeAirDistributionDesign>): void => {
      const plenum = d.returnStrategy === 'plenum';
      const terms0 = [...d.supplyTerminals, ...d.returnTerminals];
      const mains = [...d.supplyDucts, ...d.returnDucts].filter((x) => !x.plenumBox);
      const segs: NetSeg[] = mains.map((x) => ({
        id: x.id, a: x.startPoint, b: x.endPoint, cfm: x.airflowCfm, w: x.widthIn, h: x.heightIn, parent: x.parentDuctId,
        trunk: x.role === 'main-trunk', flagged: x.meetsDesignCriteria === false, velocity: x.velocityFpm,
        vLimit: x.allowableVelocityFpm, network: x.systemType === 'return' ? 'return' : 'supply', unit: x.unitId
      }));
      const terms: NetTerm[] = terms0.filter((t) => !(plenum && t.type === 'return')).map((t) => ({ id: t.id, p: t.position, cfm: t.cfm, network: t.type === 'return' ? 'return' : 'supply', unit: t.unitId }));
      const roots = new Map(d.serviceZones.map((z) => [z.id, { x: z.equipmentPosition.x, y: z.equipmentPosition.y }]));
      checkDuctNetworks(tag, segs, terms, roots, polyFt, 1, uc.units === 'metric');

      // plan clashes: wall clearance of the duct edge, ducts through terminals, supply/return crossings
      const csegs: ClashSeg[] = [...d.supplyDucts, ...d.returnDucts].map((x) => ({
        id: x.id, a: x.startPoint, b: x.endPoint, wIn: x.widthIn, network: x.systemType === 'return' ? 'return' : 'supply', crossover: !!x.crossover, flagged: !!x.clearanceIssue
      }));
      const cterms: ClashTerm[] = terms0.map((t) => {
        const f = parseTerminalSizeIn(t.faceDimension) ?? { w: 24, h: 24 };
        return { id: t.id, p: t.position, w: f.w, h: f.h };
      });
      const rootPts = d.serviceZones.map((z) => ({ x: z.equipmentPosition.x, y: z.equipmentPosition.y }));
      checkClashes(tag, csegs, cterms, polyFt, 1, rootPts);

      if (plenum) {
        // zero return mains: one short box per unit, nothing else
        const boxes = d.returnDucts;
        const bad = boxes.length !== d.serviceZones.length || boxes.some((b) => !b.plenumBox || Math.hypot(b.endPoint.x - b.startPoint.x, b.endPoint.y - b.startPoint.y) > 4 + 1e-6);
        check(`${tag}.plenumHasNoReturnMain`, !bad, () => `${boxes.length} return section(s) for ${d.serviceZones.length} unit(s): ${boxes.map((b) => `${b.id}${b.plenumBox ? '(box)' : '(MAIN)'}`).join(',')}`);
        const sawFlag = convertDesignResultToZonePayload(d).diffusers.filter((x) => x.type === 'return').every((x) => x.plenumReturn === true);
        check(`${tag}.plenumGrillesFlagged`, sawFlag, () => 'return grilles of a plenum design are not flagged plenumReturn in the payload');
      } else {
        // ducted: at most MAX_DUCTED_RETURN_CROSSINGS_PER_UNIT supply / return crossings per unit
        let worst = 0, worstUnit = '';
        for (const z of d.serviceZones) {
          let n = 0;
          for (const r of csegs.filter((c) => c.network === 'return' && d.returnDucts.find((q) => q.id === c.id)?.unitId === z.id)) {
            for (const sg of csegs.filter((c) => c.network === 'supply')) {
              const pt = crossPoint(sg, r, 1);
              if (pt && !rootPts.some((q) => Math.hypot(q.x - pt.x, q.y - pt.y) <= 0.1)) n++;
            }
          }
          if (n > worst) { worst = n; worstUnit = z.unitTag; }
        }
        // topologically unavoidable: a middle unit of >= 3 bays stacked in a room <= 12 ft deep is sandwiched between two
        // supply trunks (the crossings are flagged as crossovers on the ducts and checked by noSupplyReturnCrossing)
        const sandwiched = d.serviceZones.length >= 3 && Math.min(bb.w, bb.h) <= 12;
        check(`${tag}.returnCrossingsLe1PerUnit`, sandwiched || worst <= MAX_DUCTED_RETURN_CROSSINGS_PER_UNIT, () => `${worstUnit} return main crosses the supply ${worst} times`);
      }
    };
    engineNetworkChecks('ducts(engine)', design);
    if (uc.units === 'imperial') {
      try {
        engineNetworkChecks('ducts(engine,ducted)', executeAirDistributionDesign({ ...input, returnStrategy: 'ducted' }));
      } catch (e) {
        check('crash.executeAirDistributionDesign(ducted)', false, () => String((e as Error).stack || e).split('\n').slice(0, 3).join(' | '));
      }
    }

    // ── Indoor unit keep-out: no terminal face inside footprint + 2 ft service clearance ──
    {
      const warns = design.layoutWarnings || [];
      const dropped = warns.some((w) => w.includes('unit keep-out relaxed'));
      const footprintOnly = warns.some((w) => w.includes('service clearance relaxed'));
      if (!dropped) {
        let bad: string | null = null;
        for (const t of allTerms) {
          const f = parseTerminalSizeIn(t.faceDimension) ?? { w: 24, h: 24 };
          for (const z of design.serviceZones) {
            const dims = design.unitFootprintsIn?.[z.id];
            const ko = footprintOnly ? unitFootprintFt(z.equipmentPosition, dims) : unitKeepOutFt(z.equipmentPosition, dims, 2);
            const ox = Math.min(t.position.x + f.w / 24, ko.maxX) - Math.max(t.position.x - f.w / 24, ko.minX);
            const oy = Math.min(t.position.y + f.h / 24, ko.maxY) - Math.max(t.position.y - f.h / 24, ko.minY);
            if (ox > 0.01 && oy > 0.01) bad ??= `${t.type} ${t.id} face ${f.w}"x${f.h}" at (${t.position.x},${t.position.y}) overlaps ${z.unitTag} keep-out [${ko.minX.toFixed(1)}..${ko.maxX.toFixed(1)}] x [${ko.minY.toFixed(1)}..${ko.maxY.toFixed(1)}]`;
          }
        }
        check('layout.noTerminalInUnitKeepout', !bad, () => bad!);
      }
    }

    // ── Outdoor units: >= 1 ft outside the wall, clear of every other zone, >= 1 ft apart ──
    {
      let bad: string | null = null;
      const neighbours = input.otherZonePolygons ? input.otherZonePolygons.map((p) => p.map((v) => v / k)) : [];
      const boxes = design.outdoorUnitPositions.map((o) => ({
        o, samples: orientedSamples(o, o.angleDeg ?? 0, o.lengthFt ?? 34 / 12, o.depthFt ?? 13 / 12)
      }));
      for (const { o, samples } of boxes) {
        for (const p of samples) {
          if (isPointInPolygon(p.x, p.y, polyFt)) { bad ??= `ODU at (${o.x},${o.y}) overlaps the room at (${p.x.toFixed(2)},${p.y.toFixed(2)})`; break; }
          if (wallDist(p, polyFt) < 1 - 0.03) { bad ??= `ODU at (${o.x},${o.y}) only ${wallDist(p, polyFt).toFixed(2)} ft from the wall`; break; }
          if (neighbours.some((n) => isPointInPolygon(p.x, p.y, n))) { bad ??= `ODU at (${o.x},${o.y}) inside a neighbouring zone`; break; }
        }
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        let m = Infinity;
        for (const a of boxes[i].samples) for (const b of boxes[j].samples) m = Math.min(m, Math.hypot(a.x - b.x, a.y - b.y));
        if (m < 1 - 0.1) bad ??= `ODU ${i} and ${j} only ${m.toFixed(2)} ft apart`;
      }
      check('equipment.oduOutsideAllZonesAndNoOverlap', !bad, () => bad!);
    }

    // ── Wall-mounted (high-wall) unit sits ON a wall ──
    {
      const w = calculateWallMountedUnitPos(polyFt, 1, { exteriorSide: 'east' });
      let bad: string | null = null;
      const dEdge = Math.min(...edgesOf(polyFt).map(([a, b]) => distToSeg({ x: w.x, y: w.y }, a, b)));
      if (Math.abs(dEdge - w.depthFt / 2) > 0.03) bad = `unit centre ${dEdge.toFixed(2)} ft from the nearest wall, expected depth/2 = ${(w.depthFt / 2).toFixed(2)} (back not flush)`;
      const smp = orientedSamples({ x: w.x, y: w.y }, w.angleDeg, w.widthFt, w.depthFt);
      for (const p of smp) if (!insideOrOn(p, polyFt, 0.03)) { bad ??= `footprint point (${p.x.toFixed(2)},${p.y.toFixed(2)}) outside the room`; break; }
      const host = edgesOf(polyFt).find(([a, b]) => Math.abs(distToSeg({ x: w.x, y: w.y }, a, b) - dEdge) < 1e-6)!;
      const L = Math.hypot(host[1].x - host[0].x, host[1].y - host[0].y);
      const t = ((w.x - host[0].x) * (host[1].x - host[0].x) + (w.y - host[0].y) * (host[1].y - host[0].y)) / L;
      if (t < w.widthFt / 2 - 0.03 || t > L - w.widthFt / 2 + 0.03) bad ??= `unit overhangs its wall segment (t=${t.toFixed(2)} of ${L.toFixed(2)} ft, width ${w.widthFt.toFixed(2)})`;
      check('equipment.wallUnitOnWall', !bad, () => bad!);
      // the canvas path: a floating (mid-room) high-wall position is snapped onto a wall by routeDucts
      const floating = routeDucts(pxPoly, [], uc.units, zone.id, { x: bb.cx * k, y: bb.cy * k }, 'high-wall', undefined, {}, k).unitPos;
      const fp = { x: floating.x / k, y: floating.y / k };
      const dF = Math.min(...edgesOf(polyFt).map(([a, b]) => distToSeg(fp, a, b)));
      check('equipment.wallUnitOnWall(routeDucts)', Math.abs(dF - w.depthFt / 2) <= 0.03 && isPointInPolygon(fp.x, fp.y, polyFt),
        () => `high-wall unit left at ${dF.toFixed(2)} ft from the nearest wall (expected ${(w.depthFt / 2).toFixed(2)})`);
    }

    // ── Payload / drawing (canvas px) ──
    const payload = convertDesignResultToZonePayload(design);
    check('noNaN.payload', !findNonFinite(payload), () => findNonFinite(payload)!);
    {
      let bad: string | null = null;
      design.supplyTerminals.forEach((t) => {
        const d = payload.diffusers.find((x) => x.id === t.id)!;
        const ex = t.position.x * k, ey = t.position.y * k;
        if (!d || Math.abs(d.x - ex) > 1e-6 || Math.abs(d.y - ey) > 1e-6) bad ??= `${t.id}: px (${d?.x},${d?.y}) vs ft*k (${ex},${ey})`;
      });
      for (const d of design.supplyDucts) {
        const pd = payload.ducts.find((x) => x.id === d.id)!;
        const exp = [d.startPoint.x * k, d.startPoint.y * k, d.endPoint.x * k, d.endPoint.y * k];
        if (pd.points.some((v, i) => Math.abs(v - exp[i]) > 1e-6)) bad ??= `${d.id}: px [${pd.points.join(',')}] vs ft*k [${exp.map((v) => v.toFixed(4)).join(',')}]`;
      }
      check('drawing.pxEqualsFtTimesK', !bad, () => bad!);
    }
    {
      let bad: string | null = null;
      for (const pd of payload.ducts) {
        const full = 2 * ductHalfWidthPx(pd.widthIn, k);
        if (Math.abs(full - (pd.widthIn / 12) * k) > 1e-9) bad ??= `${pd.id}: drawn width ${full} vs ${(pd.widthIn / 12) * k}`;
      }
      for (const t of allTerms) {
        const d = payload.diffusers.find((x) => x.id === t.id)!;
        const face = parseTerminalSizeIn(t.faceDimension);
        if (!face) { bad ??= `${t.id}: unparseable face "${t.faceDimension}"`; continue; }
        const px = terminalFacePx(d, k, uc.units);
        if (Math.abs(px.w - (face.w / 12) * k) > 1e-9 || Math.abs(px.h - (face.h / 12) * k) > 1e-9) {
          bad ??= `${t.id}: face "${t.faceDimension}" drawn ${px.w.toFixed(3)}x${px.h.toFixed(3)} px, expected ${((face.w / 12) * k).toFixed(3)}`;
        }
      }
      check('drawing.ductAndFacePx', !bad, () => bad!);
    }
    check('drawing.unitPositionsPx', payload.unitPositions.every((p, i) => Math.abs(p.x - design.serviceZones[i].equipmentPosition.x * k) < 1e-6 && Math.abs(p.y - design.serviceZones[i].equipmentPosition.y * k) < 1e-6),
      () => `unit px ${JSON.stringify(payload.unitPositions[0])} vs ${JSON.stringify(design.serviceZones[0].equipmentPosition)}*${k}`);

    // ── routeDucts on the applied payload (canvas re-route path after a drag; correct px/ft passed) ──
    {
      const diffusers = payload.diffusers.map((d) => ({ ...d }));
      let routed: ReturnType<typeof routeDucts> | null = null;
      try {
        const tB = Date.now(); routed = routeDucts(pxPoly, diffusers, uc.units, zone.id, payload.unitPos, 'concealed', payload.outdoorUnitPos, { targetNc: 32 }, k); if (process.env.INVARIANTS_TIME) console.log(`routeDucts ${id} ${Date.now() - tB} ms`);
        check('crash.routeDucts', true, () => '');
      } catch (e) {
        check('crash.routeDucts', false, () => String(e));
      }
      if (routed) {
        check('noNaN.routeDucts', !findNonFinite(routed), () => findNonFinite(routed)!);
        const again = routeDucts(pxPoly, payload.diffusers.map((d) => ({ ...d })), uc.units, zone.id, payload.unitPos, 'concealed', payload.outdoorUnitPos, { targetNc: 32 }, k);
        const dd = deepDiff(routed, again);
        check('determinism.routeDucts', !dd, () => dd!);
        const segs: NetSeg[] = (routed.ducts as Array<DuctSegment & { parentDuctId?: string }>).filter((d) => !d.plenumBox).map((d) => ({
          id: d.id, a: { x: d.points[0], y: d.points[1] }, b: { x: d.points[2], y: d.points[3] }, cfm: d.cfm, w: d.widthIn, h: d.heightIn,
          parent: d.parentDuctId, trunk: d.type === 'trunk', // return sections carry no trunk/branch role in DuctSegment
          flagged: d.acousticVerification ? d.acousticVerification.complianceStatus !== 'PASS' : false,
          velocity: d.velocityFpm ?? 0, vLimit: d.acousticVerification?.allowableAcousticVelocityFpm ?? Infinity,
          network: d.type === 'return' ? 'return' : 'supply', unit: 'u'
        }));
        const terms: NetTerm[] = payload.diffusers.filter((d) => !d.plenumReturn).map((d) => ({ id: d.id, p: { x: d.x, y: d.y }, cfm: d.cfm, network: d.type === 'return' ? 'return' : 'supply', unit: 'u' }));
        checkDuctNetworks('ducts(routeDucts)', segs, terms, new Map([['u', routed.unitPos]]), pxPoly, 1 / k, uc.units === 'metric');
        const csegs: ClashSeg[] = (routed.ducts as Array<DuctSegment & { crossover?: boolean; clearanceIssue?: string }>).map((d) => ({
          id: d.id, a: { x: d.points[0], y: d.points[1] }, b: { x: d.points[2], y: d.points[3] }, wIn: d.widthIn,
          network: d.type === 'return' ? 'return' : 'supply', crossover: !!d.crossover, flagged: !!d.clearanceIssue
        }));
        const cterms: ClashTerm[] = payload.diffusers.map((d) => {
          const f = parseTerminalSizeIn(d.size, uc.units) ?? { w: 24, h: 24 };
          return { id: d.id, p: { x: d.x, y: d.y }, w: f.w, h: f.h };
        });
        checkClashes('ducts(routeDucts)', csegs, cterms, pxPoly, 1 / k, [routed.unitPos]);
      }
    }
  }

  // ── Metric / imperial parity for the same room ──
  if (loads.imperial && loads.metric) {
    current = { id: `R${String(ri).padStart(2, '0')}-${room.shape}-${room.spaceTypeId}-parity`, area: areaFt2, repro: `${room.label} ${room.spaceTypeId} imperial(10px/ft) vs metric(20px/m) polyFt=[${room.polyFt.join(',')}]` };
    const I = loads.imperial, M = loads.metric;
    const pairs: Array<[string, number, number]> = [
      ['area', I.area, M.area * SQFT_PER_SQM],
      ['occupants', I.occupants, M.occupants],
      ['roomSensible', I.roomSensibleBtuh ?? 0, (M.roomSensibleBtuh ?? 0)],
      ['coilSensible', I.sensibleLoad, M.sensibleLoad * BTUH_PER_W],
      ['totalLoad', I.totalLoad, M.totalLoad * BTUH_PER_W],
      ['supplyCfm', I.supplyCfm, M.supplyCfm * CFM_PER_LPS],
      ['vozCfm', I.vozCfm, M.vozCfm * CFM_PER_LPS]
    ];
    const bad = pairs.find(([, a, b]) => rel(b, a) > 0.01 && Math.abs(a - b) > 1.5);
    check('load.metricImperialParity(1%)', !bad, () => `${bad![0]}: imperial ${bad![1]} vs metric->imperial ${bad![2].toFixed(1)} (${(rel(bad![2], bad![1]) * 100).toFixed(1)}%)`);
    check('selection.metricImperialParity', bestIds.imperial === bestIds.metric, () => `best imperial ${bestIds.imperial} vs metric ${bestIds.metric}`);
  }
}

// ───────────────────────── Summary ─────────────────────────
const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
console.log(`\nProfessional invariants matrix: ${rooms.length} rooms x 2 unit systems = ${caseCount} cases (${Date.now() - t0} ms)\n`);
console.log(`${pad('Invariant', 46)} ${pad('checked', 8)} ${pad('pass', 6)} fail`);
console.log('-'.repeat(70));
let anyFail = false;
for (const name of INVARIANT_ORDER) {
  const e = ledger.get(name)!;
  const f = e.failed.size;
  if (f) anyFail = true;
  console.log(`${pad(name, 46)} ${pad(String(e.checked.size), 8)} ${pad(String(e.checked.size - f), 6)} ${f ? f + '  FAIL' : '0'}`);
}
const failing = INVARIANT_ORDER.filter((n) => ledger.get(n)!.failed.size > 0);
if (failing.length) {
  console.log('\nMinimal repro per failing invariant (smallest room area):');
  for (const name of failing) {
    const list = [...ledger.get(name)!.failed.values()].sort((a, b) => a.area - b.area);
    const m = list[0];
    console.log(`\n[${name}] ${list.length} case(s): ${list.slice(0, 6).map((x) => x.caseId).join(', ')}${list.length > 6 ? ', ...' : ''}`);
    console.log(`  case:   ${m.caseId}  (area ${m.area.toFixed(1)} ft2)`);
    console.log(`  repro:  ${m.repro}`);
    console.log(`  detail: ${m.detail}`);
    // INVARIANTS_VERBOSE=1 lists every failing case (or INVARIANTS_VERBOSE=<substring of invariant name>)
    const v = process.env.INVARIANTS_VERBOSE;
    if (v && (v === '1' || name.includes(v))) for (const x of list) console.log(`    - ${x.caseId}: ${x.detail}`);
  }
}
for (const [tag, n] of Object.entries(flaggedClearance)) console.log(`${tag}: ${n} duct section(s) flagged clearanceIssue (rooms too small for a clean layout; reported on the duct)`);
for (const [tag, n] of Object.entries(crossoverTotals)) console.log(`${tag}: ${n} flagged supply/return crossover(s) over the matrix (minimised; each is reported on the duct as a crossover)`);
console.log(anyFail ? `\n${failing.length} invariant(s) FAILED` : '\nALL PROFESSIONAL INVARIANTS PASSED');
process.exit(anyFail ? 1 : 0);
