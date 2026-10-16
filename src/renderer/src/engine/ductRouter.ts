import { sizeDuctAcoustically, verifyDuctSectionAcoustics } from './acousticDuctEngine';
import { DiffuserPos } from './diffuserPlacer';
import { getPolygonCentroid, calculateOptimalIndoorUnitPos } from './geometry';
import { DuctSegment } from '../store/projectStore';
import { DuctLocationCategory, AcousticSensitivity, DuctSectionCategory } from './types';
import { buildOrthogonalTree, pickAxis, TopoSegment, TopoTerminal } from './ducts/orthogonalTopology';
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
export type RoutedDuctSegment = DuctSegment & { parentDuctId?: string; lengthFt?: number };

/** Lateral offset between the supply trunk line and the return collar (ft). */
const RETURN_COLLAR_OFFSET_FT = 3;
const ON_LINE_TOL_FT = 0.5;
const STATION_SNAP_FT = 0.1;
const MIN_PIECE_FT = 1.0;

function polygonBounds(points: number[]) {
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
    unitPos = calculateOptimalIndoorUnitPos(points, outdoorUnitPos);
  }

  const centroid = getPolygonCentroid(points);
  const box = polygonBounds(points);
  const axis = pickAxis(box);
  const horizontal = axis === 'h';

  const fixedHeight = units === 'imperial' ? 10 : 200 / MM_PER_IN;
  const toMm = (inches: number) => Math.round((inches * MM_PER_IN) / METRIC_STEP_MM) * METRIC_STEP_MM;

  const ducts: RoutedDuctSegment[] = [];

  const sizeFor = (
    ductId: string,
    cfm: number,
    category: DuctSectionCategory,
    verifyType: 'trunk' | 'branch' | 'return',
    lengthFt: number,
    lock?: { heightIn: number; widthIn: number },
    friction?: number
  ) => {
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

  const emitTree = (
    segs: TopoSegment[],
    network: 'supply' | 'return',
    rootParentId: string | undefined,
    idOf: (seg: TopoSegment, trunkIdx: number, branchIdx: number) => string
  ) => {
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
    minLen: MIN_PIECE_FT * ppf
  };

  // 2. Supply: orthogonal trunk + perpendicular branches
  if (supplyDiffusers.length > 0) {
    const terminals: TopoTerminal[] = supplyDiffusers.map((d) => ({ id: d.id, x: d.x, y: d.y, cfm: d.cfm }));
    const segs = buildOrthogonalTree({ x: unitPos.x, y: unitPos.y }, terminals, treeOpts);
    emitTree(segs, 'supply', undefined, (seg, t, b) =>
      seg.kind === 'trunk' ? `duct-trunk-${zoneId}-${t}` : `duct-branch-${zoneId}-${b}`
    );
  }

  // 3. For Ducted Systems (Concealed, Packaged, AHU, VRF), add orthogonal return ductwork
  const isDuctedSystem = systemType === 'concealed' || systemType === 'packaged' || systemType === 'ahu' || systemType === 'vrf';
  if (isDuctedSystem) {
    const centreV = horizontal ? (box.minY + box.maxY) / 2 : (box.minX + box.maxX) / 2;
    const unitV = horizontal ? unitPos.y : unitPos.x;
    const sign = centreV - unitV >= 0 ? 1 : -1;
    const off = RETURN_COLLAR_OFFSET_FT * ppf;
    const collar = horizontal
      ? { x: unitPos.x, y: unitPos.y + sign * off }
      : { x: unitPos.x + sign * off, y: unitPos.y };

    const totalFlow = supplyDiffusers.reduce((sum, d) => sum + d.cfm, 0);
    const returnFlow = returnDiffusers.length > 0
      ? returnDiffusers.reduce((s, d) => s + d.cfm, 0)
      : Math.round(totalFlow * 0.9);

    if (returnFlow > 0) {
      const stubId = `duct-return-${zoneId}-stub`;
      const stubSeg: TopoSegment = {
        key: -1,
        kind: 'trunk',
        start: { x: unitPos.x, y: unitPos.y },
        end: collar,
        flow: returnFlow,
        parent: -1,
        direct: [],
        downstream: returnDiffusers.map((d) => d.id),
        orientation: horizontal ? 'v' : 'h',
        isTakeoff: false,
        onTrunk: false
      };
      emitTree([stubSeg], 'return', undefined, () => stubId);

      if (returnDiffusers.length > 0) {
        const terminals: TopoTerminal[] = returnDiffusers.map((d) => ({ id: d.id, x: d.x, y: d.y, cfm: d.cfm }));
        const segs = buildOrthogonalTree(collar, terminals, treeOpts);
        let n = 0;
        emitTree(segs, 'return', stubId, () => `duct-return-${zoneId}-${n++}`);
      } else {
        // Plenum return: short orthogonal intake run from the collar toward the room centre
        const centreU = horizontal ? centroid.x : centroid.y;
        const unitU = horizontal ? unitPos.x : unitPos.y;
        const dir = centreU - unitU >= 0 ? 1 : -1;
        const len = Math.max(3 * ppf, Math.min(6 * ppf, Math.abs(centreU - unitU) || 6 * ppf));
        const end = horizontal
          ? { x: collar.x + dir * len, y: collar.y }
          : { x: collar.x, y: collar.y + dir * len };
        const runSeg: TopoSegment = {
          ...stubSeg,
          start: collar,
          end,
          parent: -1,
          orientation: horizontal ? 'h' : 'v'
        };
        emitTree([runSeg], 'return', stubId, () => `duct-return-${zoneId}`);
      }
    }
  }

  return { ducts, unitPos };
}
