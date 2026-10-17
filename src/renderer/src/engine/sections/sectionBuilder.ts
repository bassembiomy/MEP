// Pure duct section / elevation builder. Section coordinates are FEET: x along the cut line, z above FFL.
// Plan px -> ft via units.ts; ceilingHeight is in project units; all vertical inputs below are inches.
import type { Zone, DuctSegment, Diffuser } from '../../store/projectStore';
import { pxPerFt, FT_PER_M, M_PER_FT, isImperial } from '../units';

import { DEFAULT_VOID_IN, NECK_ALLOWANCE_IN, SLAB_CLEARANCE_IN, HANGER_GAP_IN, neckAllowanceFor } from '../ceilingVoid';
export { DEFAULT_VOID_IN, NECK_ALLOWANCE_IN, SLAB_CLEARANCE_IN, HANGER_GAP_IN };
export const SLAB_THICKNESS_IN = 6;
export const DEFAULT_UNIT_HEIGHT_IN = 10;

export type SectionKind = 'longitudinal' | 'transverse';
export type SectionElementType = 'slab' | 'ceiling' | 'structure' | 'unit' | 'trunk' | 'branch' | 'crossing' | 'neck';

export interface SectionElement {
  type: SectionElementType;
  id?: string;
  /** Rectangle in section coords (ft). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  label?: string;
  /** Cut (hatched) section rather than elevation view. */
  cut?: boolean;
}
export interface SectionIssue {
  severity: 'error' | 'warning';
  kind: 'slab' | 'ceiling' | 'neck';
  ductId: string;
  message: string;
}
export interface SectionLevels {
  ffl: number;
  ceiling: number;
  slabUnderside: number;
  slabTop: number;
}
type P = { x: number; y: number };
export interface Section {
  id: string;
  label: string; // "A-A"
  kind: SectionKind;
  title: string;
  unitId?: string;
  length: number; // ft along the cut
  levels: SectionLevels;
  voidIn: number;
  elements: SectionElement[];
  issues: SectionIssue[];
  cut: { a: P; b: P }; // plan px
}
export interface SectionOptions {
  scale: number;
  units: string | undefined;
  voidDepthIn?: number;
  unitHeightIn?: number;
  neckAllowanceIn?: number;
}
export interface SectionCutLine {
  id: string;
  label: string;
  kind: SectionKind;
  unitId?: string;
  a: P;
  b: P;
}
type Duct = DuctSegment & { bodIn?: number };
const SECTION_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export const zoneVoidDepthIn = (zone: Zone, o?: Pick<SectionOptions, 'voidDepthIn'>): number => {
  const z = zone as Zone & { maxAvailableCeilingDepthIn?: number; plenumDepthIn?: number };
  const v = o?.voidDepthIn ?? z.maxAvailableCeilingDepthIn ?? z.plenumDepthIn;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : DEFAULT_VOID_IN;
};
export const zoneCeilingFt = (zone: Zone, units: string | undefined): number =>
  isImperial(units) ? zone.ceilingHeight : zone.ceilingHeight * FT_PER_M;

export function sectionLevels(ceilingFt: number, voidIn: number): SectionLevels {
  const slabUnderside = ceilingFt + voidIn / 12;
  return { ffl: 0, ceiling: ceilingFt, slabUnderside, slabTop: slabUnderside + SLAB_THICKNESS_IN / 12 };
}

/** Level text: metric "+3.00" (m), imperial "+9'-0\"". */
export function levelText(ft: number, units: string | undefined): string {
  if (!isImperial(units)) {
    const m = ft * M_PER_FT;
    return Math.abs(m) < 0.005 ? '±0.00' : `${m > 0 ? '+' : '-'}${Math.abs(m).toFixed(2)}`;
  }
  if (Math.abs(ft) < 1e-4) return '±0\'-0"';
  const totIn = Math.round(Math.abs(ft) * 12);
  return `${ft > 0 ? '+' : '-'}${Math.floor(totIn / 12)}'-${totIn % 12}"`;
}
export const levelLabel = (name: string, ft: number, units: string | undefined): string =>
  `${name} ${levelText(ft, units)}`;
/** Short dimension: metric mm, imperial inches. */
export const dimText = (ft: number, units: string | undefined): string =>
  isImperial(units) ? `${Math.round(ft * 12)}"` : `${Math.round(ft * 304.8)} mm`;

const isRound = (d: Duct): boolean => d.shape === 'round' || d.shape === 'flex';
const ductH = (d: Duct): number => (isRound(d) ? (d.diameterIn ?? d.heightIn) : d.heightIn);
const ductW = (d: Duct): number => (isRound(d) ? (d.diameterIn ?? d.widthIn) : d.widthIn);
const mm50 = (inch: number): number => Math.max(50, Math.round((inch * 25.4) / 50) * 50);
const sizeTag = (d: Duct, units: string | undefined): string => {
  if (isRound(d)) return isImperial(units) ? `Ø${Math.round(ductW(d))}"` : `Ø${mm50(ductW(d))}`;
  return isImperial(units)
    ? `${Math.round(d.widthIn)}"x${Math.round(d.heightIn)}"`
    : `${mm50(d.widthIn)}x${mm50(d.heightIn)}`;
};

/** Bottom of duct (ft AFF): explicit bodIn, else top-hung 2 in below slab; crossovers drop under what they cross. */
function ductBodFt(d: Duct, all: Duct[], lv: SectionLevels): number {
  if (typeof d.bodIn === 'number') return d.bodIn / 12;
  let top = lv.slabUnderside - HANGER_GAP_IN / 12;
  if (d.crossover) {
    const hs = (d.crossoverWith ?? [])
      .map((id) => all.find((o) => o.id === id))
      .filter((o): o is Duct => !!o)
      .map((o) => ductH(o) / 12);
    top -= (hs.length ? Math.max(...hs) : ductH(d) / 12) + 1 / 12;
  }
  return top - ductH(d) / 12;
}

const segs = (d: Duct, k: number): [P, P][] => {
  const out: [P, P][] = [];
  for (let i = 0; i + 3 < d.points.length; i += 2)
    out.push([
      { x: d.points[i] / k, y: d.points[i + 1] / k },
      { x: d.points[i + 2] / k, y: d.points[i + 3] / k }
    ]);
  return out;
};

/** Cut-line plan endpoints (px) and labels for canvas markers: one longitudinal per unit trunk + one transverse. */
export function sectionCutLines(zone: Zone): SectionCutLine[] {
  const out: SectionCutLine[] = [];
  const unitList: { id: string; pos: P }[] = zone.unitServiceZones?.length
    ? zone.unitServiceZones.map((u) => ({ id: u.id, pos: u.unitPos }))
    : (zone.unitPositions?.length ? zone.unitPositions : zone.unitPos ? [zone.unitPos] : []).map((p, i) => ({
        id: `unit-${i + 1}`,
        pos: p
      }));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < zone.points.length; i += 2) {
    xs.push(zone.points[i]);
    ys.push(zone.points[i + 1]);
  }
  const bb = xs.length
    ? { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
    : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let li = 0;
  const nextLabel = (): string => {
    const c = SECTION_LETTERS[li % SECTION_LETTERS.length];
    li++;
    return `${c}-${c}`;
  };
  const trunks = (zone.ducts ?? []).filter((d) => d.type === 'trunk' && d.points.length >= 4);
  const list = unitList.length
    ? unitList
    : [{ id: '', pos: { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 } }];
  for (const u of list) {
    const mine = trunks.filter((t) => (t.unitId ?? t.serviceZoneId) === u.id);
    const use = mine.length ? mine : unitList.length > 1 ? [] : trunks;
    if (use.length) {
      const pts: P[] = [];
      for (const t of use) for (let i = 0; i + 1 < t.points.length; i += 2) pts.push({ x: t.points[i], y: t.points[i + 1] });
      let best: [P, P] = [pts[0], pts[pts.length - 1]];
      let bd = -1;
      for (const a of pts)
        for (const b of pts) {
          const dd = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
          if (dd > bd) {
            bd = dd;
            best = [a, b];
          }
        }
      const [a, b] = best[0].x <= best[1].x ? best : [best[1], best[0]];
      out.push({ id: `L-${u.id || 'zone'}`, label: nextLabel(), kind: 'longitudinal', unitId: u.id || undefined, a, b });
    } else {
      out.push({
        id: `L-${u.id || 'zone'}`,
        label: nextLabel(),
        kind: 'longitudinal',
        unitId: u.id || undefined,
        a: { x: bb.minX, y: u.pos.y },
        b: { x: bb.maxX, y: u.pos.y }
      });
    }
  }
  // Transverse: perpendicular to the first longitudinal cut, through the first unit, clipped to the zone bbox.
  const u0 = list[0];
  const lg = out[0];
  const dx = lg.b.x - lg.a.x;
  const dy = lg.b.y - lg.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  let sMin = -Infinity;
  let sMax = Infinity;
  const lim = (c0: number, n: number, lo: number, hi: number): void => {
    if (Math.abs(n) < 1e-9) return;
    const s1 = (lo - c0) / n;
    const s2 = (hi - c0) / n;
    sMin = Math.max(sMin, Math.min(s1, s2));
    sMax = Math.min(sMax, Math.max(s1, s2));
  };
  lim(u0.pos.x, nx, bb.minX, bb.maxX);
  lim(u0.pos.y, ny, bb.minY, bb.maxY);
  if (!Number.isFinite(sMin) || !Number.isFinite(sMax) || sMin >= sMax) {
    const h = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY, 1) / 2;
    sMin = -h;
    sMax = h;
  }
  out.push({
    id: 'T-unit',
    label: nextLabel(),
    kind: 'transverse',
    unitId: u0.id || undefined,
    a: { x: u0.pos.x + nx * sMin, y: u0.pos.y + ny * sMin },
    b: { x: u0.pos.x + nx * sMax, y: u0.pos.y + ny * sMax }
  });
  return out;
}

/** Geometric section of the zone along one cut line. */
export function buildSectionForCut(zone: Zone, cut: SectionCutLine, opts: SectionOptions): Section {
  const k = pxPerFt(opts.scale, opts.units);
  const voidIn = zoneVoidDepthIn(zone, opts);
  const lv = sectionLevels(zoneCeilingFt(zone, opts.units), voidIn);
  const neckIn = opts.neckAllowanceIn ?? neckAllowanceFor(voidIn);
  const a = { x: cut.a.x / k, y: cut.a.y / k };
  const b = { x: cut.b.x / k, y: cut.b.y / k };
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / L;
  const uy = (b.y - a.y) / L;
  const along = (p: P): number => (p.x - a.x) * ux + (p.y - a.y) * uy;
  const dist = (p: P): number => -(p.x - a.x) * uy + (p.y - a.y) * ux;
  const els: SectionElement[] = [];
  const issues: SectionIssue[] = [];
  els.push({ type: 'slab', x0: 0, x1: L, z0: lv.slabUnderside, z1: lv.slabTop, label: 'SLAB' });
  els.push({ type: 'structure', x0: 0, x1: L, z0: lv.ceiling, z1: lv.slabUnderside, label: 'STRUCTURE / SERVICES ZONE' });
  els.push({ type: 'ceiling', x0: 0, x1: L, z0: lv.ceiling - 0.04, z1: lv.ceiling, label: 'FALSE CEILING' });

  const ducts = (zone.ducts ?? []) as Duct[];
  const unitId = cut.unitId;
  const uh = (opts.unitHeightIn ?? DEFAULT_UNIT_HEIGHT_IN) / 12;
  const uz = zone.unitServiceZones?.find((u) => u.id === unitId);
  const upx = uz?.unitPos ?? zone.unitPos ?? zone.unitPositions?.[0];
  if (upx) {
    const up = { x: upx.x / k, y: upx.y / k };
    const fp = uz?.footprintIn ?? { lengthIn: 48, widthIn: 24 };
    const dirAx = Math.abs(ux) >= Math.abs(uy);
    const half = (dirAx ? fp.lengthIn : fp.widthIn) / 24;
    const cx = along(up);
    if (Math.abs(dist(up)) <= (dirAx ? fp.widthIn : fp.lengthIn) / 24 + 0.5) {
      const top = lv.slabUnderside - HANGER_GAP_IN / 12;
      els.push({
        type: 'unit',
        id: unitId,
        x0: Math.max(0, cx - half),
        x1: Math.min(L, cx + half),
        z0: top - uh,
        z1: top,
        label: uz?.unitTag ?? 'FCU'
      });
    }
  }

  const pushDuct = (d: Duct, x0: number, x1: number, role: SectionElementType, cutSection: boolean): void => {
    const bod = ductBodFt(d, ducts, lv);
    const top = bod + ductH(d) / 12;
    els.push({
      type: role,
      id: d.id,
      x0: Math.max(0, Math.min(x0, x1)),
      x1: Math.min(L, Math.max(x0, x1)),
      z0: bod,
      z1: top,
      label: sizeTag(d, opts.units),
      cut: cutSection
    });
    if (issues.some((i) => i.ductId === d.id && i.kind !== 'neck')) return;
    if (top > lv.slabUnderside - SLAB_CLEARANCE_IN / 12 + 1e-6)
      issues.push({
        severity: 'error',
        kind: 'slab',
        ductId: d.id,
        message: `Duct ${d.id} top is ${dimText(lv.slabUnderside - top, opts.units)} below slab (min ${dimText(SLAB_CLEARANCE_IN / 12, opts.units)})`
      });
    if (bod < lv.ceiling - 1e-6)
      issues.push({
        severity: 'error',
        kind: 'ceiling',
        ductId: d.id,
        message: `Duct ${d.id} projects ${dimText(lv.ceiling - bod, opts.units)} below false ceiling`
      });
  };

  const tol = 0.75;
  for (const d of ducts) {
    if (!d.points || d.points.length < 4) continue;
    const w = ductW(d) / 12;
    for (const [p, q] of segs(d, k)) {
      const dp = dist(p);
      const dq = dist(q);
      const ap = along(p);
      const aq = along(q);
      const band = w / 2 + tol;
      if (Math.abs(dp) <= band && Math.abs(dq) <= band) {
        if (Math.max(ap, aq) < 0 || Math.min(ap, aq) > L) continue;
        pushDuct(d, ap, aq, d.type === 'branch' ? 'branch' : 'trunk', false);
      } else if (dp * dq < 0) {
        const t = dp / (dp - dq);
        const xc = ap + (aq - ap) * t;
        if (xc < 0 || xc > L) continue;
        const sin = Math.max(0.25, Math.abs((q.x - p.x) * uy - (q.y - p.y) * ux) / (Math.hypot(q.x - p.x, q.y - p.y) || 1));
        pushDuct(d, xc - w / 2 / sin, xc + w / 2 / sin, d.type === 'branch' ? 'branch' : 'crossing', true);
      } else if (Math.min(Math.abs(dp), Math.abs(dq)) <= band) {
        const near = Math.abs(dp) < Math.abs(dq) ? ap : aq;
        if (near < 0 || near > L) continue;
        pushDuct(d, near - w / 2, near + w / 2, 'branch', true);
      }
    }
  }

  // Terminals near the cut: neck dropping from the lowest host duct BOD (or a plenum-height stub) to the ceiling.
  const hosts = els.filter((e) => (e.type === 'trunk' || e.type === 'branch') && e.id);
  for (const t of (zone.diffusers ?? []) as Diffuser[]) {
    if (t.plenumReturn) continue;
    const p = { x: t.x / k, y: t.y / k };
    if (Math.abs(dist(p)) > 2) continue;
    const xa = along(p);
    if (xa < 0 || xa > L) continue;
    const fw = (t.faceWidthIn ?? 12) / 12;
    const host = hosts.filter((e) => xa >= e.x0 - 1 && xa <= e.x1 + 1).sort((m, n) => n.z0 - m.z0)[0];
    const topZ = host ? host.z0 : lv.ceiling + neckIn / 12;
    els.push({
      type: 'neck',
      id: t.id,
      x0: Math.max(0, xa - fw / 3),
      x1: Math.min(L, xa + fw / 3),
      z0: lv.ceiling - 0.03,
      z1: Math.max(topZ, lv.ceiling),
      label: t.size
    });
    if (host?.id && topZ - lv.ceiling < neckIn / 12 - 1e-6 && !issues.some((i) => i.ductId === host.id && i.kind === 'neck'))
      issues.push({
        severity: 'warning',
        kind: 'neck',
        ductId: host.id,
        message: `Duct ${host.id} BOD only ${dimText(topZ - lv.ceiling, opts.units)} above ceiling (diffuser plenum needs ${dimText(neckIn / 12, opts.units)})`
      });
  }
  return {
    id: cut.id,
    label: cut.label,
    kind: cut.kind,
    title: `SECTION ${cut.label} (${cut.kind === 'transverse' ? 'TRANSVERSE' : 'LONGITUDINAL'})`,
    unitId,
    length: L,
    levels: lv,
    voidIn,
    elements: els,
    issues,
    cut: { a: cut.a, b: cut.b }
  };
}

export function buildSections(zone: Zone, opts: SectionOptions): Section[] {
  return sectionCutLines(zone).map((c) => buildSectionForCut(zone, c, opts));
}
