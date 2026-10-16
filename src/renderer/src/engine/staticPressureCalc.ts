import {
  PressureLossSegment,
  CriticalPathResult,
  FanOperatingPointResult,
  BranchBalancingItem,
  EquipmentCatalogItem,
  DiffuserCatalogItem,
  DuctTypeItem
} from './types';
import { STANDARD_FITTING_LOSSES } from './hvacCatalogs';
import { DuctSegment } from '../store/projectStore';
import { DiffuserPos } from './diffuserPlacer';
import { frictionRateExact, rectangularEquivalentDiameter } from './ducts/ductPressureCalculator';

/**
 * Air density in lb/ft³ at standard sea level conditions (70°F, 29.92 in.Hg) = 0.075 lb/ft³
 */
export const STANDARD_AIR_DENSITY = 0.075;

/**
 * Calculates velocity pressure (in. wg) from air velocity (FPM) and relative density
 */
export function calculateVelocityPressure(velocityFpm: number, airDensityRatio: number = 1.0): number {
  if (velocityFpm <= 0) return 0;
  return Math.pow(velocityFpm / 4005, 2) * airDensityRatio;
}

/**
 * Calculates straight duct friction loss (in. wg)
 */
export function calculateStraightDuctLoss(
  cfm: number,
  widthIn: number,
  heightIn: number,
  lengthFt: number,
  frictionRatePer100Ft: number = 0.10
): { deltaPInWg: number; velocityFpm: number; velocityPressureInWg: number } {
  if (cfm <= 0 || widthIn <= 0 || heightIn <= 0 || lengthFt <= 0) {
    return { deltaPInWg: 0, velocityFpm: 0, velocityPressureInWg: 0 };
  }

  const areaSqFt = (widthIn * heightIn) / 144;
  const velocityFpm = cfm / areaSqFt;
  const velocityPressureInWg = calculateVelocityPressure(velocityFpm);
  const deltaPInWg = (frictionRatePer100Ft * lengthFt) / 100;

  return {
    deltaPInWg: Math.round(deltaPInWg * 1000) / 1000,
    velocityFpm: Math.round(velocityFpm),
    velocityPressureInWg: Math.round(velocityPressureInWg * 1000) / 1000
  };
}

/**
 * Calculates fitting dynamic loss (in. wg) using K-factor
 */
export function calculateFittingLoss(
  fittingKey: string,
  velocityFpm: number,
  airDensityRatio: number = 1.0
): { deltaPInWg: number; velocityPressureInWg: number; lossCoefficientK: number } {
  const fittingDef = STANDARD_FITTING_LOSSES[fittingKey];
  const velocityPressure = calculateVelocityPressure(velocityFpm, airDensityRatio);

  if (!fittingDef) {
    return { deltaPInWg: 0, velocityPressureInWg: velocityPressure, lossCoefficientK: 0 };
  }

  let deltaP = 0;
  if (fittingDef.fixedLossInWg !== undefined && fittingDef.fixedLossInWg > 0) {
    deltaP = fittingDef.fixedLossInWg;
  } else {
    deltaP = fittingDef.lossCoefficientK * velocityPressure;
  }

  return {
    deltaPInWg: Math.round(deltaP * 1000) / 1000,
    velocityPressureInWg: Math.round(velocityPressure * 1000) / 1000,
    lossCoefficientK: fittingDef.lossCoefficientK
  };
}

/**
 * External accessories allowance on the supply path (in. wg): volume/balancing damper + fire/smoke damper
 * pressure drop. The filter and coil are INSIDE the unit and are covered by the unit's rated ESP, so they
 * are deliberately not added to the external duct path.
 */
export const DEFAULT_ACCESSORIES_DELTA_P_IN_WG = 0.05;
/** Return grille pressure drop allowance (in. wg) */
export const RETURN_GRILLE_DELTA_P_IN_WG = 0.025;
/** Ceiling-plenum return resistance when no return ductwork is routed (in. wg) */
export const PLENUM_RETURN_DELTA_P_IN_WG = 0.03;

export interface StaticPressureOptions {
  /** External accessories drop on the critical supply path (default DEFAULT_ACCESSORIES_DELTA_P_IN_WG) */
  accessoriesDeltaPInWg?: number;
}

/** CriticalPathResult plus per-terminal supply path losses (used by the balancing schedule). */
export type CriticalPathResultEx = CriticalPathResult & {
  /** terminalId -> total supply-side loss to that terminal (ducts + fittings + terminal + accessories), in. wg */
  terminalPathLossesInWg?: Record<string, number>;
  /** terminalId -> fitting counts along its path, from routed geometry */
  terminalFittingCounts?: Record<string, { elbows: number; teeBranches: number }>;
};

type NetDuct = DuctSegment & { parentDuctId?: string };

interface PathNode {
  duct: NetDuct;
  parent?: PathNode;
  lengthFt: number;
  velocityFpm: number;
  frictionRate: number;
  frictionLoss: number;
  junctionKey?: 'branch-tee' | 'elbow-90-vaned' | 'reducer';
  junctionLoss: number;
  bendCount: number;
  bendLoss: number;
}

function polylineLength(p: number[]): number {
  let len = 0;
  for (let i = 0; i + 3 < p.length; i += 2) len += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
  return len;
}

function distPointToPolyline(x: number, y: number, p: number[]): number {
  let best = Infinity;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
    const vx = bx - ax, vy = by - ay;
    const l2 = vx * vx + vy * vy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
    best = Math.min(best, Math.hypot(x - (ax + t * vx), y - (ay + t * vy)));
  }
  return best;
}

function firstLegOrientation(p: number[]): 'h' | 'v' {
  return Math.abs(p[2] - p[0]) >= Math.abs(p[3] - p[1]) ? 'h' : 'v';
}
function lastLegOrientation(p: number[]): 'h' | 'v' {
  const n = p.length;
  return Math.abs(p[n - 2] - p[n - 4]) >= Math.abs(p[n - 1] - p[n - 3]) ? 'h' : 'v';
}

/** Actual friction rate (in.wg/100ft) of a drawn duct using the ASHRAE equation and its real dimensions. */
function actualFrictionRate(duct: DuctSegment, fallback: number): number {
  const de =
    duct.shape === 'round' && duct.diameterIn
      ? duct.diameterIn
      : duct.widthIn > 0 && duct.heightIn > 0
      ? rectangularEquivalentDiameter(duct.widthIn, duct.heightIn)
      : 0;
  if (de <= 0 || duct.cfm <= 0) return duct.cfm <= 0 ? 0 : fallback;
  return frictionRateExact(duct.cfm, de);
}

/**
 * Builds the duct tree. Uses parentDuctId when the router provided it, otherwise reconstructs the parent
 * from geometry: the upstream duct whose centreline passes through this duct's start point.
 */
function buildPathNodes(ducts: NetDuct[], scale: number, fallbackRate: number): Map<string, PathNode> {
  const tol = 0.5 * scale;
  const nodes = new Map<string, PathNode>();
  const usable = ducts.filter((d) => d.points && d.points.length >= 4);

  for (const d of usable) {
    const area = d.shape === 'round' && d.diameterIn ? (Math.PI * d.diameterIn * d.diameterIn) / 4 / 144 : (d.widthIn * d.heightIn) / 144;
    const velocity = area > 0 ? d.cfm / area : 0;
    const lengthFt = polylineLength(d.points) / scale;
    const rate = actualFrictionRate(d, fallbackRate);
    nodes.set(d.id, {
      duct: d,
      lengthFt,
      velocityFpm: velocity,
      frictionRate: rate,
      frictionLoss: (rate * lengthFt) / 100,
      junctionLoss: 0,
      bendCount: 0,
      bendLoss: 0
    });
  }

  const group = (d: DuctSegment): "supply" | "return" => (d.type === 'return' ? 'return' : 'supply');

  for (const node of nodes.values()) {
    const d = node.duct;
    let parentNode: PathNode | undefined;
    if (d.parentDuctId && nodes.has(d.parentDuctId) && d.parentDuctId !== d.id) {
      parentNode = nodes.get(d.parentDuctId);
    } else if (!d.parentDuctId) {
      const sx = d.points[0], sy = d.points[1];
      let best: { n: PathNode; score: number } | undefined;
      for (const cand of nodes.values()) {
        if (cand === node || group(cand.duct) !== group(d)) continue;
        const cp = cand.duct.points;
        const dist = distPointToPolyline(sx, sy, cp);
        if (dist > tol) continue;
        const startsHere = Math.hypot(cp[0] - sx, cp[1] - sy) <= tol;
        if (startsHere) continue; // sibling / downstream of the same node
        const endsHere = Math.hypot(cp[cp.length - 2] - sx, cp[cp.length - 1] - sy) <= tol;
        const score = (endsHere ? 0 : 1000) + dist - cand.duct.cfm * 1e-6;
        if (!best || score < best.score) best = { n: cand, score };
      }
      parentNode = best?.n;
    }
    node.parent = parentNode;
  }

  // Fittings from the routed geometry
  for (const node of nodes.values()) {
    const d = node.duct;
    const vel = node.velocityFpm;
    const parent = node.parent;
    if (parent) {
      const siblings = [...nodes.values()].filter((n) => n.parent === parent).length;
      const turn = lastLegOrientation(parent.duct.points) !== firstLegOrientation(d.points);
      if (turn) {
        // A turn with other ducts leaving the same node is a tee takeoff; a lone turn is a 90 degree elbow
        node.junctionKey = siblings > 1 ? 'branch-tee' : 'elbow-90-vaned';
      } else if (parent.duct.widthIn !== d.widthIn || parent.duct.heightIn !== d.heightIn) {
        node.junctionKey = 'reducer';
      }
      if (node.junctionKey) node.junctionLoss = calculateFittingLoss(node.junctionKey, vel).deltaPInWg;
    }
    // Direction changes inside a polyline = 90 degree elbows
    const interior = Math.max(0, d.points.length / 2 - 2);
    node.bendCount = interior;
    node.bendLoss = interior * calculateFittingLoss('elbow-90-vaned', vel).deltaPInWg;
  }

  return nodes;
}

function chainOf(node: PathNode): PathNode[] {
  const chain: PathNode[] = [];
  const seen = new Set<PathNode>();
  let cur: PathNode | undefined = node;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = cur.parent;
  }
  return chain.reverse();
}

function nearestEndNode(nodes: Map<string, PathNode>, x: number, y: number, types: DuctSegment['type'][]): { node: PathNode; dist: number } | undefined {
  let best: { node: PathNode; dist: number } | undefined;
  for (const n of nodes.values()) {
    if (!types.includes(n.duct.type)) continue;
    const p = n.duct.points;
    const dist = Math.hypot(p[p.length - 2] - x, p[p.length - 1] - y);
    if (!best || dist < best.dist - 1e-9 || (Math.abs(dist - best.dist) <= 1e-9 && n.duct.cfm < best.node.duct.cfm)) {
      best = { node: n, dist };
    }
  }
  return best;
}

function diffuserPressureDrop(dif: DiffuserPos, diffuserCatalog: DiffuserCatalogItem[]): number {
  const matchedDiffuser = diffuserCatalog.find((dc) => dc.maxCfm >= dif.cfm) || diffuserCatalog[0];
  let diffuserDeltaP = dif.deltaPInWg && dif.deltaPInWg > 0 ? dif.deltaPInWg : 0.035;
  if (matchedDiffuser && matchedDiffuser.performanceTable.length > 0) {
    const sorted = [...matchedDiffuser.performanceTable].sort((a, b) => a.cfm - b.cfm);
    if (dif.cfm <= sorted[0].cfm) {
      diffuserDeltaP = sorted[0].deltaPInWg;
    } else if (dif.cfm >= sorted[sorted.length - 1].cfm) {
      diffuserDeltaP = sorted[sorted.length - 1].deltaPInWg;
    } else {
      for (let i = 0; i < sorted.length - 1; i++) {
        if (dif.cfm >= sorted[i].cfm && dif.cfm <= sorted[i + 1].cfm) {
          const frac = (dif.cfm - sorted[i].cfm) / (sorted[i + 1].cfm - sorted[i].cfm);
          diffuserDeltaP = sorted[i].deltaPInWg + frac * (sorted[i + 1].deltaPInWg - sorted[i].deltaPInWg);
          break;
        }
      }
    }
  }
  return diffuserDeltaP;
}

/** Builds the ordered loss segments for one terminal path (unit -> terminal), with cumulative pressure. */
function buildPathSegments(
  endNode: PathNode,
  prefix: string,
  label: string,
  terminalConnection: { elbow: boolean; tee: boolean },
  startCumulative: number
): { segments: PressureLossSegment[]; total: number; elbows: number; tees: number } {
  const segments: PressureLossSegment[] = [];
  let cum = startCumulative;
  let elbows = 0;
  let tees = 0;
  const chain = chainOf(endNode);

  for (const n of chain) {
    const d = n.duct;
    const round3 = (v: number): number => Math.round(v * 1000) / 1000;
    if (n.junctionKey) {
      cum += n.junctionLoss;
      if (n.junctionKey === 'branch-tee') tees++;
      if (n.junctionKey === 'elbow-90-vaned') elbows++;
      const def = STANDARD_FITTING_LOSSES[n.junctionKey];
      segments.push({
        id: `${prefix}-fit-${d.id}`,
        type: 'fitting',
        name: def?.name || n.junctionKey,
        cfm: d.cfm,
        velocityFpm: Math.round(n.velocityFpm),
        velocityPressureInWg: round3(calculateVelocityPressure(n.velocityFpm)),
        lossCoefficientK: def?.lossCoefficientK,
        deltaPInWg: n.junctionLoss,
        cumulativePInWg: round3(cum)
      });
    }
    cum += n.frictionLoss;
    segments.push({
      id: `${prefix}-duct-${d.id}`,
      type: 'straight-duct',
      name: `${label} ${d.type.toUpperCase()} Duct ${d.widthIn.toFixed(0)}"x${d.heightIn.toFixed(0)}" (${Math.round(n.lengthFt)} ft @ ${n.frictionRate.toFixed(3)}/100ft)`,
      cfm: d.cfm,
      velocityFpm: Math.round(n.velocityFpm),
      velocityPressureInWg: round3(calculateVelocityPressure(n.velocityFpm)),
      lengthFt: Math.round(n.lengthFt * 10) / 10,
      deltaPInWg: round3(n.frictionLoss),
      cumulativePInWg: round3(cum)
    });
    if (n.bendCount > 0) {
      cum += n.bendLoss;
      elbows += n.bendCount;
      segments.push({
        id: `${prefix}-bend-${d.id}`,
        type: 'fitting',
        name: `${n.bendCount} x 90° Elbow (vaned)`,
        cfm: d.cfm,
        velocityFpm: Math.round(n.velocityFpm),
        velocityPressureInWg: round3(calculateVelocityPressure(n.velocityFpm)),
        deltaPInWg: round3(n.bendLoss),
        cumulativePInWg: round3(cum)
      });
    }
  }

  // Terminal connection (boot elbow, takeoff collar for terminals sitting on the trunk)
  const v = endNode.velocityFpm;
  const conn: { key: 'elbow-90-vaned' | 'branch-tee'; label: string }[] = [];
  if (terminalConnection.tee) conn.push({ key: 'branch-tee', label: 'Terminal takeoff collar' });
  if (terminalConnection.elbow) conn.push({ key: 'elbow-90-vaned', label: 'Terminal boot elbow' });
  for (const c of conn) {
    const loss = calculateFittingLoss(c.key, v);
    cum += loss.deltaPInWg;
    if (c.key === 'elbow-90-vaned') elbows++;
    else tees++;
    segments.push({
      id: `${prefix}-conn-${c.key}-${endNode.duct.id}`,
      type: 'fitting',
      name: c.label,
      cfm: endNode.duct.cfm,
      velocityFpm: Math.round(v),
      velocityPressureInWg: loss.velocityPressureInWg,
      lossCoefficientK: loss.lossCoefficientK,
      deltaPInWg: loss.deltaPInWg,
      cumulativePInWg: Math.round(cum * 1000) / 1000
    });
  }

  return { segments, total: cum - startCumulative, elbows, tees };
}

/**
 * Computes the pressure loss along EVERY supply path (unit -> each terminal) by walking up the duct tree
 * from the terminal summing the real section friction (ASHRAE rate for the actual size x length) and the
 * fittings counted from the routed geometry; the critical path is the maximum. The return side is
 * evaluated the same way (worst return grille). Result also carries per-terminal losses for balancing.
 */
export function solveDirectedNetworkStaticPressure(
  ducts: DuctSegment[],
  diffusers: DiffuserPos[],
  diffuserCatalog: DiffuserCatalogItem[],
  ductType: DuctTypeItem,
  scale: number = 10,
  safetyMarginPct: number = 0.15,
  options: StaticPressureOptions = {}
): CriticalPathResultEx {
  const accessories = options.accessoriesDeltaPInWg ?? DEFAULT_ACCESSORIES_DELTA_P_IN_WG;
  const supplyTerminals = diffusers.filter((d) => d.type !== 'return');
  const returnTerminals = diffusers.filter((d) => d.type === 'return');

  const empty: CriticalPathResultEx = {
    pathId: 'empty-path',
    terminalId: '',
    supplySegments: [],
    returnSegments: [],
    totalSupplyDeltaPInWg: 0,
    totalReturnDeltaPInWg: 0,
    diffuserDeltaPInWg: 0,
    accessoriesDeltaPInWg: 0,
    totalLossInWg: 0,
    marginInWg: 0,
    espRequiredInWg: 0
  };
  if (ducts.length === 0 || supplyTerminals.length === 0) return empty;

  const nodes = buildPathNodes(ducts as NetDuct[], scale, ductType.maxFrictionRateInWgPer100Ft);

  interface SupplyPath {
    terminal: DiffuserPos;
    segments: PressureLossSegment[];
    total: number;
    diffuserLoss: number;
    elbows: number;
    tees: number;
  }
  const supplyPaths: SupplyPath[] = [];

  for (const dif of supplyTerminals) {
    const match = nearestEndNode(nodes, dif.x, dif.y, ['trunk', 'branch']);
    if (!match) continue;
    const onTrunk = match.node.duct.type === 'trunk';
    const path = buildPathSegments(match.node, 'sup', 'Supply', { elbow: true, tee: onTrunk }, 0);
    const diffuserLoss = diffuserPressureDrop(dif, diffuserCatalog);
    const segments = path.segments;
    let cum = path.total;
    cum += diffuserLoss;
    segments.push({
      id: `seg-terminal-${dif.id}`,
      type: 'diffuser',
      name: `Supply Diffuser Terminal (${dif.size || '9"x9"'})`,
      cfm: dif.cfm,
      velocityFpm: 650,
      velocityPressureInWg: calculateVelocityPressure(650),
      deltaPInWg: Math.round(diffuserLoss * 1000) / 1000,
      cumulativePInWg: Math.round(cum * 1000) / 1000
    });
    cum += accessories;
    if (accessories > 0) {
      segments.push({
        id: `seg-accessories-${dif.id}`,
        type: 'accessory',
        name: 'Volume / fire damper allowance',
        cfm: dif.cfm,
        velocityFpm: 0,
        velocityPressureInWg: 0,
        deltaPInWg: Math.round(accessories * 1000) / 1000,
        cumulativePInWg: Math.round(cum * 1000) / 1000
      });
    }
    supplyPaths.push({ terminal: dif, segments, total: cum, diffuserLoss, elbows: path.elbows, tees: path.tees });
  }

  if (supplyPaths.length === 0) return empty;

  const terminalPathLossesInWg: Record<string, number> = {};
  const terminalFittingCounts: Record<string, { elbows: number; teeBranches: number }> = {};
  for (const p of supplyPaths) {
    terminalPathLossesInWg[p.terminal.id] = Math.round(p.total * 1000) / 1000;
    terminalFittingCounts[p.terminal.id] = { elbows: p.elbows, teeBranches: p.tees };
  }

  const criticalSupply = supplyPaths.reduce((a, b) => (b.total > a.total ? b : a));
  const criticalSupplyTotal = Math.round(criticalSupply.total * 1000) / 1000;

  // Return side: worst return path
  const returnSegments: PressureLossSegment[] = [];
  let returnTotal = 0;
  const returnNodes = [...nodes.values()].filter((n) => n.duct.type === 'return');

  if (returnNodes.length > 0) {
    interface RetPath { endNode: PathNode; grille?: DiffuserPos }
    const candidates: RetPath[] = [];
    if (returnTerminals.length > 0) {
      for (const g of returnTerminals) {
        const m = nearestEndNode(nodes, g.x, g.y, ['return']);
        if (m) candidates.push({ endNode: m.node, grille: g });
      }
    }
    if (candidates.length === 0) {
      // Plenum-style return: worst leaf of the return tree
      const hasChild = new Set(returnNodes.map((n) => n.parent).filter(Boolean) as PathNode[]);
      for (const leaf of returnNodes.filter((n) => !hasChild.has(n))) candidates.push({ endNode: leaf });
    }
    let worst: { total: number; segs: PressureLossSegment[] } | undefined;
    for (const c of candidates) {
      const path = buildPathSegments(c.endNode, 'ret', 'Return', { elbow: false, tee: false }, 0);
      const grilleLoss = c.grille ? RETURN_GRILLE_DELTA_P_IN_WG : 0;
      let cum = path.total;
      const segs = path.segments;
      if (c.grille) {
        cum += grilleLoss;
        segs.push({
          id: `seg-ret-grille-${c.grille.id}`,
          type: 'grille',
          name: 'Return Air Eggcrate Grille (500 FPM)',
          cfm: c.grille.cfm,
          velocityFpm: 500,
          velocityPressureInWg: calculateVelocityPressure(500),
          deltaPInWg: grilleLoss,
          cumulativePInWg: Math.round(cum * 1000) / 1000
        });
      }
      if (!worst || cum > worst.total) worst = { total: cum, segs };
    }
    if (worst) {
      returnSegments.push(...worst.segs);
      returnTotal = worst.total;
    }
  } else {
    returnTotal = RETURN_GRILLE_DELTA_P_IN_WG + PLENUM_RETURN_DELTA_P_IN_WG;
    returnSegments.push(
      {
        id: 'seg-ret-grille',
        type: 'grille',
        name: 'Return Air Eggcrate Grille (500 FPM)',
        cfm: criticalSupply.terminal.cfm,
        velocityFpm: 500,
        velocityPressureInWg: calculateVelocityPressure(500),
        deltaPInWg: RETURN_GRILLE_DELTA_P_IN_WG,
        cumulativePInWg: RETURN_GRILLE_DELTA_P_IN_WG
      },
      {
        id: 'seg-ret-plenum',
        type: 'straight-duct',
        name: 'Ceiling Plenum Return Resistance',
        cfm: criticalSupply.terminal.cfm,
        velocityFpm: 200,
        velocityPressureInWg: calculateVelocityPressure(200),
        lengthFt: 15,
        deltaPInWg: PLENUM_RETURN_DELTA_P_IN_WG,
        cumulativePInWg: returnTotal
      }
    );
  }

  const totalRawLoss = criticalSupplyTotal + returnTotal;
  const marginInWg = Math.round(totalRawLoss * safetyMarginPct * 1000) / 1000;
  const espRequiredInWg = Math.round((totalRawLoss + marginInWg) * 1000) / 1000;

  return {
    pathId: `critical-path-${criticalSupply.terminal.id}`,
    terminalId: criticalSupply.terminal.id,
    supplySegments: criticalSupply.segments,
    returnSegments,
    totalSupplyDeltaPInWg: criticalSupplyTotal,
    totalReturnDeltaPInWg: Math.round(returnTotal * 1000) / 1000,
    diffuserDeltaPInWg: Math.round(criticalSupply.diffuserLoss * 1000) / 1000,
    accessoriesDeltaPInWg: accessories,
    totalLossInWg: Math.round(totalRawLoss * 1000) / 1000,
    marginInWg,
    espRequiredInWg,
    terminalPathLossesInWg,
    terminalFittingCounts
  };
}

/**
 * Evaluates the equipment fan operating point against required ESP and design CFM
 */
export function evaluateFanOperatingPoint(
  equipment: EquipmentCatalogItem,
  designCfm: number,
  espRequiredInWg: number
): FanOperatingPointResult {
  const warnings: string[] = [];

  // Non-ducted systems (High Wall, standard Cassette) have zero external duct resistance requirement
  if (!equipment.capabilities.supportsDuctNetwork || !equipment.capabilities.hasExternalStaticPressure) {
    return {
      isValid: true,
      operatingCfm: designCfm,
      operatingEspInWg: 0,
      fanMarginInWg: 0,
      percentageOverDesignCfm: 0,
      powerKwEstimate: equipment.electricalKw * 0.15,
      warningMessages: []
    };
  }

  const maxRatedEsp = equipment.maxRatedEspInWg || 0.40;

  // 1. Direct check: Is required ESP within maximum rated ESP?
  if (espRequiredInWg > maxRatedEsp) {
    warnings.push(
      `Required ESP (${espRequiredInWg.toFixed(2)} in.wg) exceeds unit maximum rated static pressure (${maxRatedEsp.toFixed(2)} in.wg).`
    );
  }

  // 2. Tabular fan curve evaluation
  let fanMaxEspAtDesignCfm = maxRatedEsp;
  let powerKw = equipment.electricalKw * 0.20;

  if (equipment.fanPerformance.table && equipment.fanPerformance.table.length > 0) {
    const table = equipment.fanPerformance.table;
    const sorted = [...table].sort((a, b) => a.cfm - b.cfm);

    if (designCfm <= sorted[0].cfm) {
      fanMaxEspAtDesignCfm = sorted[0].espInWg;
      powerKw = sorted[0].powerKw || powerKw;
    } else if (designCfm >= sorted[sorted.length - 1].cfm) {
      fanMaxEspAtDesignCfm = sorted[sorted.length - 1].espInWg;
      powerKw = sorted[sorted.length - 1].powerKw || powerKw;
      if (designCfm > equipment.maxCfm) {
        warnings.push(`Design CFM (${designCfm}) exceeds fan maximum CFM limit (${equipment.maxCfm}).`);
      }
    } else {
      // Linear interpolation between tabular points
      for (let i = 0; i < sorted.length - 1; i++) {
        if (designCfm >= sorted[i].cfm && designCfm <= sorted[i + 1].cfm) {
          const t = (designCfm - sorted[i].cfm) / (sorted[i + 1].cfm - sorted[i].cfm);
          fanMaxEspAtDesignCfm = sorted[i].espInWg + t * (sorted[i + 1].espInWg - sorted[i].espInWg);
          if (sorted[i].powerKw && sorted[i + 1].powerKw) {
            powerKw = sorted[i].powerKw! + t * (sorted[i + 1].powerKw! - sorted[i].powerKw!);
          }
          break;
        }
      }
    }
  }

  const fanMargin = fanMaxEspAtDesignCfm - espRequiredInWg;
  const isValid = fanMargin >= -0.02; // Small tolerance for boundary conditions

  if (fanMargin < 0 && !warnings.some(w => w.includes('exceeds'))) {
    warnings.push(
      `Fan static pressure at ${designCfm} CFM (${fanMaxEspAtDesignCfm.toFixed(2)} in.wg) is insufficient for calculated ESP (${espRequiredInWg.toFixed(2)} in.wg).`
    );
  }

  return {
    isValid,
    operatingCfm: designCfm,
    operatingEspInWg: Math.round(espRequiredInWg * 1000) / 1000,
    fanMarginInWg: Math.round(fanMargin * 1000) / 1000,
    percentageOverDesignCfm: 0,
    powerKwEstimate: Math.round(powerKw * 100) / 100,
    warningMessages: warnings
  };
}

/**
 * Calculates preliminary balancing damper schedule for parallel branches.
 * Uses the REAL per-terminal path losses computed from the routed network (carried on the critical-path
 * result): throttling required = critical path loss - this terminal's path loss.
 */
export function calculateBranchBalancingSchedule(
  criticalPath: CriticalPathResult,
  diffusers: DiffuserPos[]
): BranchBalancingItem[] {
  const supply = diffusers.filter((d) => d.type !== 'return');
  if (supply.length <= 1) return [];

  const losses = (criticalPath as CriticalPathResultEx).terminalPathLossesInWg;
  const maxLoss = criticalPath.totalSupplyDeltaPInWg;

  return supply.map((dif) => {
    const known = losses ? losses[dif.id] : undefined;
    const isCritical = dif.id === criticalPath.terminalId;
    const pathLoss = isCritical ? maxLoss : known ?? maxLoss;
    const deficit = Math.max(0, maxLoss - pathLoss);

    return {
      branchId: `branch-damper-${dif.id}`,
      terminalId: dif.id,
      branchFlowCfm: dif.cfm,
      branchResistanceInWg: Math.round(pathLoss * 1000) / 1000,
      pressureDeficitInWg: Math.round(deficit * 1000) / 1000,
      recommendedDamperSetting: isCritical
        ? 'Full Open (Critical)'
        : known === undefined
        ? 'Verify on site (path loss unavailable)'
        : deficit > 0.01
        ? `Throttle +${deficit.toFixed(2)} in.wg`
        : 'Full Open'
    };
  });
}
