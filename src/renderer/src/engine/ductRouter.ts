import { sizeDuctAcoustically, verifyDuctSectionAcoustics } from './acousticDuctEngine';
import { DiffuserPos } from './diffuserPlacer';
import { getPolygonCentroid, calculateOptimalIndoorUnitPos, calculateWallMountedUnitPos } from './geometry';
import { findClearanceIssue } from './ducts/clearanceCheck';
import { WALL_DUCT_CLEARANCE_FT, DUCT_TERMINAL_CLEARANCE_FT, scaleRect, terminalFaceRectFt, orthogonalCrossing } from './ducts/clearance';
import { DuctSegment } from '../store/projectStore';
import { DuctLocationCategory, AcousticSensitivity, DuctSectionCategory, DuctAcousticVerification } from './types';
import {
  buildOrthogonalTree,
  chooseReturnCollar,
  pickAxis,
  segmentInsidePolygon,
  Seg2,
  TopoSegment,
  TopoTerminal
} from './ducts/orthogonalTopology';
import { DEFAULT_PX_PER_FT, MM_PER_IN, METRIC_STEP_MM } from './ducts/ductUnits';

export interface RouteDuctAcousticOptions {
  targetNc?: number;
  locationCategory?: DuctLocationCategory;
  acousticSensitivity?: AcousticSensitivity;
  enhancedPerformance?: boolean;
  zoneName?: string;
  ductShape?: 'rectangular' | 'round';
  /** Maximum available duct depth (ceiling plenum), in. Default 24. */
  maxDepthIn?: number;
  /** Equal-friction design rate (in.wg/100ft). Default 0.10 supply, 0.08 return. */
  frictionRateTarget?: number;
}

/** DuctSegment plus the topology link used for static-pressure path walking. */
export type RoutedDuctSegment = DuctSegment & {
  parentDuctId?: string;
  lengthFt?: number;
  /** Unavoidable supply / return plan crossing: this duct needs a vertical offset against `crossoverWith`. */
  crossover?: boolean;
  crossoverWith?: string[];
  /** No clean layout exists in this room: the clearance rule this duct still breaks. */
  clearanceIssue?: string;
};

/** Lateral offset between the supply trunk line and the return collar (ft). */
const RETURN_COLLAR_OFFSET_FT = 3;
const ON_LINE_TOL_FT = 0.5;
const STATION_SNAP_FT = 0.1;
const MIN_PIECE_FT = 1.0;

function polygonBounds(points: number[]): { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number; } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

interface SizedGeometry {
  widthVal: number;
  heightVal: number;
  diameterVal: number;
  areaSqFt: number;
  velocityFpm: number;
  sizeLabel: string;
}

/**
 * Routes ducts as an ORTHOGONAL (Manhattan) tree.
 *
 * - `pxPerFt` converts canvas px to feet (default 10 px/ft) so lengths, friction and verification use feet.
 * - Supply trunk runs along the dominant room axis through the unit; each diffuser is projected onto
 *   it and fed by a straight perpendicular branch. Trunk pieces end at the last takeoff.
 * - Return grilles are connected to the unit return collar with the same orthogonal rules.
 * - Sizes: standard 2" (imperial) / 50 mm (metric) increments, friction <= target AND acoustic velocity
 *   limit, aspect <= 4:1, depth <= maxDepthIn, trunk depth constant and width never increasing downstream.
 */
export function routeDucts(
  points: number[],
  diffusers: DiffuserPos[],
  units: 'imperial' | 'metric',
  zoneId: string,
  customUnitPos?: { x: number; y: number },
  systemType: string = 'concealed',
  outdoorUnitPos?: { x: number; y: number },
  acousticOptions: RouteDuctAcousticOptions = {},
  pxPerFt: number = DEFAULT_PX_PER_FT
): { ducts: DuctSegment[]; unitPos: { x: number; y: number } } {
  // Non-ducted systems (High Wall, standard Cassette) do not use supply duct networks
  if (systemType === 'high-wall' || systemType === 'cassette') {
    if (systemType === 'high-wall' && points.length >= 6) {
      // A wall-mounted unit sits ON a wall (back flush, inside the room): snap a floating position onto the nearest wall.
      const hasCustom = !!customUnitPos && (customUnitPos.x !== 0 || customUnitPos.y !== 0);
      const wall = calculateWallMountedUnitPos(points, pxPerFt > 0 ? pxPerFt : DEFAULT_PX_PER_FT, {
        outdoorUnitPos,
        near: hasCustom ? customUnitPos : undefined
      });
      const keep = hasCustom && Math.hypot(wall.x - customUnitPos!.x, wall.y - customUnitPos!.y) < 0.05 * (pxPerFt > 0 ? pxPerFt : DEFAULT_PX_PER_FT);
      return { ducts: [], unitPos: keep ? customUnitPos! : { x: wall.x, y: wall.y } };
    }
    return { ducts: [], unitPos: customUnitPos || { x: 0, y: 0 } };
  }

  const supplyDiffusers = diffusers.filter((d) => d.type === 'supply' || !d.type);
  const returnDiffusers = diffusers.filter((d) => d.type === 'return');

  if (points.length < 6 || (supplyDiffusers.length === 0 && returnDiffusers.length === 0)) {
    return { ducts: [], unitPos: { x: 0, y: 0 } };
  }

  const ppf = pxPerFt > 0 ? pxPerFt : DEFAULT_PX_PER_FT;
  const {
    targetNc = 32,
    locationCategory = 'above-suspended-ceiling',
    enhancedPerformance = false,
    zoneName = 'Zone',
    ductShape = 'rectangular',
    maxDepthIn = 24,
    frictionRateTarget
  } = acousticOptions;

  // 1. Determine Indoor Unit Position (FCU / AHU / RTU Entry)
  let unitPos = customUnitPos;
  if (!unitPos || (unitPos.x === 0 && unitPos.y === 0)) {
    unitPos = calculateOptimalIndoorUnitPos(points, outdoorUnitPos, ppf);
  }

  const centroid = getPolygonCentroid(points);
  const box = polygonBounds(points);
  const axis = pickAxis(box);
  const horizontal = axis === 'h';

  const fixedHeight = units === 'imperial' ? 10 : 200 / MM_PER_IN;
  const toMm = (inches: number): number => Math.round((inches * MM_PER_IN) / METRIC_STEP_MM) * METRIC_STEP_MM;

  const ducts: RoutedDuctSegment[] = [];

  const sizeFor = (
    ductId: string,
    cfm: number,
    category: DuctSectionCategory,
    verifyType: 'trunk' | 'branch' | 'return',
    lengthFt: number,
    lock?: { heightIn: number; widthIn: number },
    friction?: number
  ): { geom: SizedGeometry; verification: DuctAcousticVerification; } => {
    const sizing = sizeDuctAcoustically(cfm, {
      locationCategory,
      targetNc,
      sectionCategory: category,
      shape: ductShape,
      fixedHeightIn: lock ? lock.heightIn : fixedHeight,
      maxDepthIn: lock ? lock.heightIn : maxDepthIn,
      enhancedPerformance,
      frictionRateTarget: friction ?? frictionRateTarget,
      units
    });

    let widthVal = sizing.widthIn;
    let heightVal = sizing.heightIn;
    let diameterVal = sizing.diameterIn;
    if (lock && ductShape !== 'round' && widthVal > lock.widthIn) {
      widthVal = lock.widthIn; // trunk never grows downstream
      heightVal = lock.heightIn;
    }

    let sizeLabel: string;
    if (ductShape === 'round') {
      if (units === 'metric') {
        const dMm = toMm(diameterVal);
        diameterVal = dMm / MM_PER_IN;
        widthVal = heightVal = diameterVal;
        sizeLabel = `Ø${dMm}`;
      } else {
        sizeLabel = `Ø${diameterVal}"`;
      }
    } else if (units === 'imperial') {
      sizeLabel = `${widthVal}"x${heightVal}"`;
    } else {
      const wMm = toMm(widthVal);
      const hMm = toMm(heightVal);
      sizeLabel = `${wMm}x${hMm}`;
      widthVal = wMm / MM_PER_IN;
      heightVal = hMm / MM_PER_IN;
    }

    const areaSqFt = ductShape === 'round'
      ? (Math.PI * Math.pow(diameterVal / 2, 2)) / 144
      : (widthVal * heightVal) / 144;
    const velocityFpm = Math.round(cfm / Math.max(0.1, areaSqFt));

    const verification = verifyDuctSectionAcoustics(
      {
        id: ductId,
        type: verifyType,
        widthIn: widthVal,
        heightIn: heightVal,
        diameterIn: ductShape === 'round' ? diameterVal : undefined,
        shape: ductShape,
        cfm,
        velocityFpm,
        sectionCategory: category,
        lengthFt
      },
      { zoneName, targetNc, locationCategory, enhancedPerformance }
    );

    const geom: SizedGeometry = { widthVal, heightVal, diameterVal, areaSqFt, velocityFpm, sizeLabel };
    return { geom, verification };
  };

  /** Sized half widths (ft) of everything emitted in the current attempt: the clearance loop feeds them back. */
  let needs: Array<{ trunk: boolean; hwFt: number }> = [];

  const emitTree = (
    segs: TopoSegment[],
    network: 'supply' | 'return',
    rootParentId: string | undefined,
    idOf: (seg: TopoSegment, trunkIdx: number, branchIdx: number) => string
  ): void => {
    const idsByIndex: string[] = [];
    let trunkCount = 0;
    let branchCount = 0;
    segs.forEach((seg) => {
      const trunkLike = seg.kind === 'trunk';
      const id = idOf(seg, trunkCount, branchCount);
      if (trunkLike) trunkCount++;
      else branchCount++;
      idsByIndex.push(id);

      const parentId = seg.parent >= 0 ? idsByIndex[seg.parent] : rootParentId;
      const parentDuct = parentId ? ducts.find((d) => d.id === parentId) : undefined;
      const lengthFt = Math.hypot(seg.end.x - seg.start.x, seg.end.y - seg.start.y) / ppf;

      let category: DuctSectionCategory;
      if (network === 'return') category = 'return';
      else category = trunkLike ? 'trunk' : seg.kind === 'branch' ? 'branch' : 'runout';

      const lock =
        trunkLike && parentDuct && (network === 'return' ? parentDuct.type === 'return' : parentDuct.type === 'trunk')
          ? { heightIn: parentDuct.heightIn, widthIn: parentDuct.widthIn }
          : undefined;

      const { geom, verification } = sizeFor(
        id,
        seg.flow,
        category,
        network === 'return' ? 'return' : trunkLike ? 'trunk' : 'branch',
        lengthFt,
        lock,
        network === 'return' ? (frictionRateTarget ?? 0.08) : undefined
      );

      needs.push({ trunk: trunkLike, hwFt: Math.max(geom.widthVal, ductShape === 'round' ? geom.diameterVal : 0) / 24 });
      ducts.push({
        id,
        type: network === 'return' ? 'return' : trunkLike ? 'trunk' : 'branch',
        points: [seg.start.x, seg.start.y, seg.end.x, seg.end.y],
        widthIn: geom.widthVal,
        heightIn: geom.heightVal,
        diameterIn: ductShape === 'round' ? geom.diameterVal : undefined,
        shape: ductShape,
        areaSqFt: Math.round(geom.areaSqFt * 1000) / 1000,
        cfm: seg.flow,
        velocityFpm: geom.velocityFpm,
        sizeLabel: network === 'return' ? `${geom.sizeLabel} (R)` : geom.sizeLabel,
        sectionCategory: category,
        acousticVerification: verification,
        parentDuctId: parentId,
        lengthFt: Math.round(lengthFt * 100) / 100
      });
    });
  };

  const treeOpts = {
    axis,
    snapTol: STATION_SNAP_FT * ppf,
    onLineTol: ON_LINE_TOL_FT * ppf,
    minLen: MIN_PIECE_FT * ppf,
    polygon: points,
    clearance: 0.2 * ppf
  };

  const isDuctedSystem = systemType === 'concealed' || systemType === 'packaged' || systemType === 'ahu' || systemType === 'vrf' || systemType === 'fcu';
  const unitXY = { x: unitPos.x, y: unitPos.y };

  // Terminal faces (px) the ducts must stay off; the trunk is moved off the diffuser rows, each terminal gets a short
  // perpendicular run-out, and the duct EDGE keeps WALL_DUCT_CLEARANCE_FT from the walls.
  const metric = units === 'metric';
  const obstacles = diffusers.map((d) => ({
    id: d.id,
    rect: scaleRect(terminalFaceRectFt({ x: d.x / ppf, y: d.y / ppf }, d.size, metric), ppf)
  }));

  const buildAll = (hwT: number, hwB: number): void => {
    ducts.length = 0;
    needs = [];
    const clearanceOpts = {
      obstacles,
      hwTrunk: hwT * ppf,
      hwBranch: hwB * ppf,
      wallClear: WALL_DUCT_CLEARANCE_FT * ppf,
      termClear: DUCT_TERMINAL_CLEARANCE_FT * ppf
    };

    // 2. Supply: orthogonal trunk + perpendicular branches
    let supplyAvoid: Seg2[] = [];
    if (supplyDiffusers.length > 0) {
      const terminals: TopoTerminal[] = supplyDiffusers.map((d) => ({ id: d.id, x: d.x, y: d.y, cfm: d.cfm }));
      const segs = buildOrthogonalTree(unitXY, terminals, { ...treeOpts, ...clearanceOpts, avoid: [] });
      supplyAvoid = segs.map((g) => ({ start: g.start, end: g.end }));
      emitTree(segs, 'supply', undefined, (seg, t, b) =>
        seg.kind === 'trunk' ? `duct-trunk-${zoneId}-${t}` : `duct-branch-${zoneId}-${b}`
      );
    }

    // 3. For Ducted Systems (Concealed, Packaged, AHU, VRF), add orthogonal return ductwork
    if (!isDuctedSystem) return;
    const totalFlow = supplyDiffusers.reduce((sum, d) => sum + d.cfm, 0);
    const returnFlow = returnDiffusers.length > 0
      ? returnDiffusers.reduce((sum, d) => sum + d.cfm, 0)
      : Math.round(totalFlow * 0.9);
    if (!(returnFlow > 0)) return;

    if (returnDiffusers.length > 0) {
      // Return trunk on its own line off the unit (>= collar offset from the supply trunk), clear of the supply network
      const terminals: TopoTerminal[] = returnDiffusers.map((d) => ({ id: d.id, x: d.x, y: d.y, cfm: d.cfm }));
      const segs = buildOrthogonalTree(unitXY, terminals, {
        ...treeOpts,
        ...clearanceOpts,
        avoid: supplyAvoid,
        minRootOffset: RETURN_COLLAR_OFFSET_FT * ppf
      });
      let n = 0;
      emitTree(segs, 'return', undefined, () => `duct-return-${zoneId}-${n++}`);
      return;
    }

    // Plenum return: stub to the collar, then a short orthogonal intake run toward the room centre
    const collar = chooseReturnCollar(
      unitXY,
      axis,
      RETURN_COLLAR_OFFSET_FT * ppf,
      points,
      [],
      { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
      ppf
    );
    const stubId = `duct-return-${zoneId}-stub`;
    const stubSeg: TopoSegment = {
      key: -1,
      kind: 'trunk',
      start: unitXY,
      end: collar,
      flow: returnFlow,
      parent: -1,
      direct: [],
      downstream: [],
      orientation: horizontal ? 'v' : 'h',
      isTakeoff: false,
      onTrunk: false
    };
    emitTree([stubSeg], 'return', undefined, () => stubId);
    const centreU = horizontal ? centroid.x : centroid.y;
    const unitU = horizontal ? unitPos.x : unitPos.y;
    const pref = centreU - unitU >= 0 ? 1 : -1;
    const baseLen = Math.max(3 * ppf, Math.min(6 * ppf, Math.abs(centreU - unitU) || 6 * ppf));
    const endFor = (d: number, l: number): { x: number; y: number; } =>
      horizontal ? { x: collar.x + d * l, y: collar.y } : { x: collar.x, y: collar.y + d * l };
    let end = endFor(pref, baseLen);
    outer: for (const l of [baseLen, baseLen * 0.67, baseLen * 0.33]) {
      for (const d of [pref, -pref]) {
        const cand = endFor(d, l);
        if (segmentInsidePolygon(collar, cand, points, 0.2 * ppf, 0.5 * ppf, [collar])) { end = cand; break outer; }
      }
    }
    const runSeg: TopoSegment = { ...stubSeg, start: collar, end, parent: -1, direct: [], orientation: horizontal ? 'h' : 'v' };
    emitTree([runSeg], 'return', stubId, () => `duct-return-${zoneId}`);
  };

  // Route -> size -> verify: the sized half widths feed back into the clearance rules until they agree.
  let hwT = 0.6, hwB = 0.4;
  for (let iter = 0; iter < 4; iter++) {
    buildAll(hwT, hwB);
    const needT = needs.reduce((m, x) => (x.trunk ? Math.max(m, x.hwFt) : m), 0);
    const needB = needs.reduce((m, x) => (x.trunk ? m : Math.max(m, x.hwFt)), 0);
    if (needT <= hwT + 1e-6 && needB <= hwB + 1e-6) break;
    hwT = Math.max(hwT, needT);
    hwB = Math.max(hwB, needB);
  }

  // Ducts that still break a clearance rule (rooms too small for a clean layout) are flagged, never silent
  for (const d of ducts) {
    const issue = findClearanceIssue(
      { seg: { start: { x: d.points[0], y: d.points[1] }, end: { x: d.points[2], y: d.points[3] } }, width: (d.widthIn / 12) * ppf, endsAt: diffusers.map((q) => q.id) },
      points,
      obstacles,
      ppf
    );
    if (issue) { d.clearanceIssue = issue; }
  }

  // Unavoidable supply / return crossings are flagged: the crossing ducts need a vertical offset
  for (const sd of ducts) {
    if (sd.type === 'return') continue;
    for (const rd of ducts) {
      if (rd.type !== 'return') continue;
      const p = orthogonalCrossing(
        { start: { x: sd.points[0], y: sd.points[1] }, end: { x: sd.points[2], y: sd.points[3] } },
        { start: { x: rd.points[0], y: rd.points[1] }, end: { x: rd.points[2], y: rd.points[3] } },
        0.02 * ppf
      );
      if (!p || Math.hypot(p.x - unitXY.x, p.y - unitXY.y) <= 0.1 * ppf) continue;
      sd.crossover = true; rd.crossover = true;
      sd.crossoverWith = [...(sd.crossoverWith ?? []), rd.id];
      rd.crossoverWith = [...(rd.crossoverWith ?? []), sd.id];
    }
  }

  return { ducts, unitPos };
}
