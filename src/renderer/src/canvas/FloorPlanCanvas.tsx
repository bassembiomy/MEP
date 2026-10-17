import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { Stage, Layer, Line, Circle, Text, Group, Shape, Rect } from 'react-konva';
import { useProjectStore, DuctSegment, DxfEntity, Zone, Diffuser } from '../store/projectStore';
import { getPolygonCentroid, clampPointInsidePolygon, isPointInsideWithClearance } from '../engine/geometry';
import { calculateZoneLoad } from '../engine/loadCalc';
import { routeDucts } from '../engine/ductRouter';
import { routeOrthogonalRefrigerantPiping } from '../engine/spatialPlanner';
import { pxPerFt, toCfm, toBtuh } from '../engine/units';
import { STANDARD_EQUIPMENT_CATALOG } from '../engine/hvacCatalogs';
import { CadLayerManagerModal } from '../components/CadLayerManagerModal';
import Konva from 'konva';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, Target, Layers, Magnet, Ruler, X as XIcon } from 'lucide-react';
import {
  buildDuctOutline,
  DuctRunOutline,
  ductHalfWidthPx,
  throwRadiusPx,
  terminalFacePx,
  terminalSizeLabel,
  unitFootprintPx,
  unitKindForSystem,
  hatchSegments,
  gridStepPx,
  buildSnapIndex,
  resolveSnap,
  SnapResult,
  isNearFirstPoint,
  validateClosablePolygon,
  groupByLayerColor,
  unionBounds,
  pointsBounds,
  fitBounds,
  clampZoom,
  Bounds,
  DRAWING_UNITS,
  DrawingUnit,
  feetPerDrawingUnit,
  feetPerUnitFromCalibration,
  roomDimensionLines,
  dimTick,
  formatLength,
  terminalFaceIn,
  FIT_PADDING,
  doubleClickFinish,
  assignTerminalsToUnits,
  labelSpotInPolygon,
  supplyCfmOf,
  isSelfContainedSystem,
  uprightAngle
} from './drawingGeometry';
import { formatAirflow, formatLoad, formatDuctSize, formatTerminalSize, formatVelocity } from './displayFormat';
import {
  layoutLabels,
  measureLabel,
  compassCandidates,
  ductTagCandidates,
  scaleBucket,
  bucketScale,
  LabelRequest,
  PlacedLabel,
  Rect as LRect
} from './labelLayout';

// Duct outline geometry cache (keyed by the zone's duct array identity, then k).
const ductGeomCache = new WeakMap<DuctSegment[], { k: number; runs: DuctRunOutline[] }>();
function getDuctRuns(ducts: DuctSegment[], k: number): DuctRunOutline[] {
  const hit = ductGeomCache.get(ducts);
  if (hit && hit.k === k) return hit.runs;
  const runs = buildDuctOutline(ducts, k);
  ductGeomCache.set(ducts, { k, runs });
  return runs;
}

type CatDims = { width: number; depth: number; height: number } | null;
const catalogItemFor = (model?: string): (typeof STANDARD_EQUIPMENT_CATALOG)[number] | undefined =>
  model ? STANDARD_EQUIPMENT_CATALOG.find((e) => e.model === model) : undefined;
/** VRF catalog entries are OUTDOOR modules (see hvacCatalogs). */
const isOutdoorModule = (e: { id: string } | undefined): boolean => !!e && e.id.startsWith('eq-vrf');

/** Indoor-unit footprint: never an outdoor module's dimensions. */
const catalogDimsFor = (model?: string): CatDims => {
  const item = catalogItemFor(model);
  return item && !isOutdoorModule(item) ? item.dimensionsIn : null;
};
/** ODU footprint: explicit outdoor model, else the zone's catalog model when that is an outdoor (VRF) module. */
const outdoorDimsFor = (zone: Zone | undefined, explicitModel?: string): CatDims => {
  const explicit = catalogItemFor(explicitModel ?? (zone as (Zone & { outdoorModel?: string }) | undefined)?.outdoorModel);
  if (explicit) return explicit.dimensionsIn;
  const byZone = catalogItemFor(zone?.catalogModel);
  return isOutdoorModule(byZone) ? byZone!.dimensionsIn : null;
};

const ZERO_PTS = [0, 0, 0, 0];
const rad = (d: number): number => (d * Math.PI) / 180;
const rawCtx = (context: Konva.Context): CanvasRenderingContext2D =>
  (context as unknown as { _context: CanvasRenderingContext2D })._context;

interface LabelLine { text: string; color: string; bold?: boolean }
interface LabelItem {
  id: string;
  zoneId: string;
  kind: 'zone' | 'terminal' | 'duct';
  placed: PlacedLabel;
  lines: LabelLine[];
  fontPx: number;
  anchorWorld: { x: number; y: number };
  bg?: string;
  border?: string;
}
interface DuctSection { id: string; text: string; duct: DuctSegment; pieces: number[][]; network: 'supply' | 'return' }

/** Split each duct run into sections of consecutive equal size; one tag per section. */
function buildDuctSections(ducts: DuctSegment[], runs: DuctRunOutline[], units: string): DuctSection[] {
  const byId = new Map<string, DuctSegment>();
  for (const d of ducts) byId.set(d.id, d);
  const out: DuctSection[] = [];
  for (const run of runs) {
    const n = Math.min(run.segIds.length, Math.floor(run.center.length / 2) - 1);
    let cur: DuctSection | null = null;
    let curLen = -1;
    for (let i = 0; i < n; i++) {
      const d = byId.get(run.segIds[i].split(/[#~]/)[0]);
      if (!d) { cur = null; continue; }
      const piece = [run.center[i * 2], run.center[i * 2 + 1], run.center[i * 2 + 2], run.center[i * 2 + 3]];
      const text = d.shape === 'round'
        ? formatDuctSize(d.diameterIn || d.widthIn, d.diameterIn || d.widthIn, units, true)
        : formatDuctSize(d.widthIn, d.heightIn, units);
      const len = Math.hypot(piece[2] - piece[0], piece[3] - piece[1]);
      if (cur && cur.text === text) {
        cur.pieces.push(piece);
        if (len > curLen) { cur.duct = d; curLen = len; }
      } else {
        cur = { id: `${run.id}:${i}`, text, duct: d, pieces: [piece], network: run.network };
        curLen = len;
        out.push(cur);
      }
    }
  }
  return out;
}

const isSupplyTerminal = (d: { type?: string }): boolean => d.type !== 'return' && d.type !== 'exhaust';

const unitPositionsOf = (zone: Zone): { x: number; y: number; }[] =>
  zone.unitPositions && zone.unitPositions.length > 0 ? zone.unitPositions : zone.unitPos ? [zone.unitPos] : [];
const outdoorPositionsOf = (zone: Zone): { x: number; y: number; }[] =>
  zone.outdoorUnitPositions && zone.outdoorUnitPositions.length > 0
    ? zone.outdoorUnitPositions
    : zone.outdoorUnitPos
    ? [zone.outdoorUnitPos]
    : [];

export const FloorPlanCanvas: React.FC = () => {
  const {
    zones,
    selectedZoneId,
    drawMode,
    tempPoints,
    addTempPoint,
    addZone,
    clearTempPoints,
    selectZone,
    updateZone,
    project,
    setProject,
    dxfEntities,
    dxfBoundingBox,
    dxfLayers,
    cadCalibration,
    calibrateCad,
    annotationVisibility,
    activePreview
  } = useProjectStore();

  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 900, h: 500 });
  const [sizeReady, setSizeReady] = useState<boolean>(false);
  const [stageScale, setStageScale] = useState<number>(1);
  const [stagePos, setStagePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const [isLayerManagerOpen, setIsLayerManagerOpen] = useState<boolean>(false);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [drawMessage, setDrawMessage] = useState<string | null>(null);
  // Two-point calibration tool: 'p1' -> 'p2' -> 'enter' (distance prompt)
  const [calib, setCalib] = useState<{ stage: 'p1' | 'p2' | 'enter'; p1?: { x: number; y: number }; p2?: { x: number; y: number } } | null>(null);
  const [calibDist, setCalibDist] = useState<string>('');
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(false);
  // Detailed annotations: CFM / velocity on duct-section tags and NC on terminal tags (off = clean shop drawing).
  const [detailed, setDetailed] = useState<boolean>(false);
  const calibRef = useRef(calib);
  // Stable, mutable registry of zone line nodes (populated from Konva ref callbacks, read in event handlers).
  const [zoneLineNodes] = useState<Map<string, Konva.Line>>(() => new Map());

  const lastPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panningRef = useRef<boolean>(false);
  const stageScaleRef = useRef<number>(1);
  const tempPointsRef = useRef<number[]>(tempPoints);
  const drawModeRef = useRef(drawMode);
  // Wheel zoom runs on the Konva stage directly; React state is synced after the wheel goes idle.
  const wheelViewRef = useRef<{ scale: number; x: number; y: number } | null>(null);
  const wheelRafRef = useRef<number | null>(null);
  const wheelSyncRef = useRef<number | undefined>(undefined);
  // Screen positions of the last two polygon clicks (double-click finish rule) and the last close time.
  const clickLogRef = useRef<Array<{ sx: number; sy: number }>>([]);
  const lastCloseAtRef = useRef<number>(0);

  // Cursor / rubber band live on their own layer and are driven imperatively (no React re-render per mousemove).
  const cursorLayerRef = useRef<Konva.Layer>(null);
  const rubberRef = useRef<Konva.Line>(null);
  const snapMarkerRef = useRef<Konva.Rect>(null);
  const cursorDotRef = useRef<Konva.Circle>(null);
  const lastSnapRef = useRef<SnapResult>({ x: 0, y: 0, kind: 'none' });

  // Physical scale: canvas px per foot.
  const k = pxPerFt(project.scale, project.units);
  const gridStep = gridStepPx(project.scale, project.units);

  // ───────── Stage size via ResizeObserver ─────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = (w: number, h: number): void => {
      if (w > 0 && h > 0) {
        setSize((prev) => (prev.w === Math.round(w) && prev.h === Math.round(h) ? prev : { w: Math.round(w), h: Math.round(h) }));
        setSizeReady(true);
      }
    };
    apply(el.clientWidth, el.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) apply(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Level of Detail tier from scale
  const getLodTier = (scale: number): 1 | 2 | 3 | 4 => {
    if (scale < 0.35) return 1;
    if (scale < 1.25) return 2;
    if (scale < 3.5) return 3;
    return 4;
  };
  const lodTier = getLodTier(stageScale);

  // Minimum screen-space stroke width helper
  const getStrokeWidth = useCallback(
    (physicalWidth: number, minPixels: number = 1.2) => Math.max(physicalWidth, minPixels / stageScale),
    [stageScale]
  );

  // Annotation (text / tag) scale ONLY - never applied to drawing geometry.
  const textScale = Math.max(0.6, ((project.equipmentScale || 1.5) * k) / 12);

  // ───────── DXF derived data (computed once per DXF) ─────────
  const dxfGroups = useMemo(
    () => groupByLayerColor(dxfEntities, (l) => dxfLayers[l]?.color, undefined, (l) => dxfLayers[l]?.colorOverride),
    [dxfEntities, dxfLayers]
  );
  const dxfTexts = useMemo(
    () => dxfEntities.filter((e) => (e.type === 'TEXT' || e.type === 'MTEXT') && e.text),
    [dxfEntities]
  );
  const snapIndex = useMemo(() => {
    if (dxfEntities.length === 0) return null;
    const span = dxfBoundingBox
      ? Math.max(dxfBoundingBox.maxX - dxfBoundingBox.minX, dxfBoundingBox.maxY - dxfBoundingBox.minY)
      : 1000;
    return buildSnapIndex(dxfEntities, Math.max(span / 256, 1e-3));
  }, [dxfEntities, dxfBoundingBox]);

  // Keep the latest values in refs for imperative (event-handler) code; synced after every commit,
  // before any passive effect or user event can read them.
  useLayoutEffect(() => {
    calibRef.current = calib;
    stageScaleRef.current = stageScale;
    tempPointsRef.current = tempPoints;
    drawModeRef.current = drawMode;
  });

  // ───────── Snapping ─────────
  const snapAt = useCallback(
    (x: number, y: number): SnapResult => {
      return resolveSnap(x, y, {
        enabled: snapEnabled,
        gridStep,
        index: snapIndex,
        radius: 10 / stageScale,
        accept: (layer) => dxfLayers[layer || '0']?.visible !== false
      });
    },
    [snapEnabled, gridStep, snapIndex, stageScale, dxfLayers]
  );

  const showMessage = useCallback((msg: string) => {
    setDrawMessage(msg);
    window.setTimeout(() => setDrawMessage((cur) => (cur === msg ? null : cur)), 3500);
  }, []);

  // ───────── Fit / zoom ─────────
  const allContentBounds = useCallback((): Bounds | null => {
    const parts: Array<Bounds | null> = [dxfBoundingBox];
    for (const z of zones) {
      parts.push(pointsBounds(z.points));
      for (const p of [...unitPositionsOf(z), ...(isSelfContainedSystem(z.systemType) ? [] : outdoorPositionsOf(z))]) {
        parts.push({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y });
      }
    }
    return unionBounds(parts);
  }, [dxfBoundingBox, zones]);

  const handleFitDesign = useCallback(() => {
    const b = allContentBounds();
    if (!b) return;
    const minSpan = 10 * k;
    const bb: Bounds = {
      minX: b.minX - Math.max(0, (minSpan - (b.maxX - b.minX)) / 2),
      maxX: b.maxX + Math.max(0, (minSpan - (b.maxX - b.minX)) / 2),
      minY: b.minY - Math.max(0, (minSpan - (b.maxY - b.minY)) / 2),
      maxY: b.maxY + Math.max(0, (minSpan - (b.maxY - b.minY)) / 2)
    };
    const f = fitBounds(bb, size.w, size.h, 0.92, FIT_PADDING);
    setStageScale(f.scale);
    setStagePos({ x: f.x, y: f.y });
  }, [allContentBounds, size.w, size.h, k]);

  const handleFitSelection = useCallback(() => {
    const z = zones.find((zz) => zz.id === selectedZoneId);
    const b = z && z.points.length >= 6 ? pointsBounds(z.points) : null;
    if (!b) {
      handleFitDesign();
      return;
    }
    const f = fitBounds(b, size.w, size.h, 0.7, FIT_PADDING);
    setStageScale(f.scale);
    setStagePos({ x: f.x, y: f.y });
  }, [selectedZoneId, zones, handleFitDesign, size.w, size.h]);

  // Auto-fit when the view is first measured and whenever a new CAD drawing is loaded.
  const fittedForRef = useRef<{ bbox: unknown; done: boolean }>({ bbox: undefined, done: false });
  useEffect(() => {
    if (!sizeReady) return;
    const f = fittedForRef.current;
    const hasContent = zones.length > 0 || !!dxfBoundingBox;
    if (!hasContent) return;
    if (!f.done || (dxfBoundingBox && f.bbox !== dxfBoundingBox)) {
      handleFitDesign();
      fittedForRef.current = { bbox: dxfBoundingBox, done: true };
    }
  }, [sizeReady, dxfBoundingBox, zones.length, handleFitDesign]);

  // ───────── Keyboard: Space pan, F9 / S snap toggle, Esc cancel ─────────
  useEffect(() => {
    const isTyping = (t: EventTarget | null): boolean =>
      ['INPUT', 'TEXTAREA', 'SELECT'].includes((t as HTMLElement | null)?.tagName || '');
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (isTyping(e.target)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
      } else if (e.key === 'F9' || ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        setSnapEnabled((v) => !v);
      } else if (e.key === 'Escape') {
        if (calibRef.current) setCalib(null);
        if (tempPointsRef.current.length > 0) clearTempPoints();
      }
    };
    const handleKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') setIsSpacePressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [clearTempPoints]);

  // Global mouseup ends manual panning and commits the final position to React state.
  useEffect(() => {
    const handleGlobalMouseUp = (e: MouseEvent): void => {
      if ((e.button === 1 || e.button === 0) && panningRef.current) {
        panningRef.current = false;
        setIsPanning(false);
        const stage = stageRef.current;
        if (stage) setStagePos({ x: stage.x(), y: stage.y() });
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  // ───────── Pointer handling ─────────
  const pointerWorld = (stage: Konva.Stage): { x: number; y: number } | null => {
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    return stage.getAbsoluteTransform().copy().invert().point(pos);
  };

  const updateCursorNodes = (snap: SnapResult | null): void => {
    const sc = stageScaleRef.current;
    const marker = snapMarkerRef.current;
    const dot = cursorDotRef.current;
    const rb = rubberRef.current;
    if (marker) {
      if (snap && snap.kind === 'object' && snap.obj) {
        const s = 9 / sc;
        marker.setAttrs({
          visible: true, x: snap.x, y: snap.y, width: s, height: s, offsetX: s / 2, offsetY: s / 2,
          rotation: snap.obj.kind === 'mid' ? 45 : 0, strokeWidth: 1.6 / sc
        });
      } else marker.visible(false);
    }
    if (dot) {
      if (snap && (drawModeRef.current === 'polyline' || (calibRef.current && calibRef.current.stage !== 'enter'))) {
        dot.setAttrs({ visible: true, x: snap.x, y: snap.y, radius: 3 / sc });
      } else dot.visible(false);
    }
    if (rb) {
      const cs = calibRef.current;
      const tp = cs?.stage === 'p2' && cs.p1 ? [cs.p1.x, cs.p1.y] : tempPointsRef.current;
      if (snap && tp.length > 0 && cs?.stage !== 'enter') rb.setAttrs({ visible: true, points: [tp[tp.length - 2], tp[tp.length - 1], snap.x, snap.y], strokeWidth: 1.5 / sc, dash: [4 / sc, 4 / sc] });
      else rb.visible(false);
    }
    cursorLayerRef.current?.batchDraw();
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    const stage = stageRef.current;
    if (!stage) return;

    if (panningRef.current) {
      const dx = e.evt.clientX - lastPosRef.current.x;
      const dy = e.evt.clientY - lastPosRef.current.y;
      stage.position({ x: stage.x() + dx, y: stage.y() + dy });
      stage.batchDraw();
      lastPosRef.current = { x: e.evt.clientX, y: e.evt.clientY };
      return;
    }

    const w = pointerWorld(stage);
    if (!w) return;
    const snap = snapAt(w.x, w.y);
    lastSnapRef.current = snap;
    updateCursorNodes(snap);
  };

  const handleMouseLeave = (): void => updateCursorNodes(null);

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    // Middle click pan OR left click while Space held OR left click in 'pan' mode
    if (e.evt.button === 1 || (e.evt.button === 0 && (isSpacePressed || drawMode === 'pan'))) {
      e.evt.preventDefault();
      panningRef.current = true;
      setIsPanning(true);
      lastPosRef.current = { x: e.evt.clientX, y: e.evt.clientY };
    }
  };

  const closePolygon = useCallback(() => {
    // Always read the live store (never a render-time snapshot) so fast clicks cannot see stale vertices.
    const res = validateClosablePolygon(useProjectStore.getState().tempPoints);
    if (!res.ok) {
      showMessage(res.message || 'Cannot close polygon.');
      return;
    }
    lastCloseAtRef.current = Date.now();
    addZone(res.points);
    clearTempPoints();
  }, [addZone, clearTempPoints, showMessage]);

  const handleContentClick = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    if (e.evt.button !== 0 || isSpacePressed || drawMode === 'pan') return;
    const cs = calibRef.current;
    if (cs && cs.stage !== 'enter') {
      const st = stageRef.current;
      const w = st ? pointerWorld(st) : null;
      if (!w) return;
      const sp = snapAt(w.x, w.y);
      const pt = { x: sp.x, y: sp.y };
      if (cs.stage === 'p1') setCalib({ stage: 'p2', p1: pt });
      else if (cs.p1) {
        if (Math.hypot(pt.x - cs.p1.x, pt.y - cs.p1.y) < 1e-6) return;
        setCalib({ stage: 'enter', p1: cs.p1, p2: pt });
        setCalibDist('');
      }
      return;
    }
    if (drawMode !== 'polyline') return;
    const stage = stageRef.current;
    if (!stage) return;
    const raw = pointerWorld(stage);
    if (!raw) return;
    // Second click of a double-click that just closed the polygon must not start a stray vertex.
    if (Date.now() - lastCloseAtRef.current < 450) return;
    const scr = stage.getPointerPosition();
    if (scr) clickLogRef.current = [...clickLogRef.current, { sx: scr.x, sy: scr.y }].slice(-2);
    const tp = useProjectStore.getState().tempPoints;

    // Close when the click lands within 8 screen px of the first point
    if (tp.length >= 6 && isNearFirstPoint(tp, raw.x, raw.y, 8 / stageScaleRef.current)) {
      closePolygon();
      return;
    }
    const s = snapAt(raw.x, raw.y);
    if (tp.length >= 2 && Math.hypot(tp[tp.length - 2] - s.x, tp[tp.length - 1] - s.y) < 1e-6) return; // duplicate vertex
    addTempPoint(s.x, s.y);
  };

  const startCalibration = (): void => {
    setCalib({ stage: 'p1' });
    setBannerDismissed(true);
    clearTempPoints();
  };

  const applyCalibration = (): void => {
    const c = calibRef.current;
    const dist = parseFloat(calibDist);
    if (!c?.p1 || !c.p2 || !cadCalibration) return;
    const f = feetPerUnitFromCalibration(Math.hypot(c.p2.x - c.p1.x, c.p2.y - c.p1.y), cadCalibration.pxPerUnit, dist, project.units);
    if (f === null) {
      showMessage('Enter a real distance greater than zero.');
      return;
    }
    calibrateCad(f);
    setCalib(null);
  };

  const handleDoubleClick = (): void => {
    if (drawModeRef.current !== 'polyline') return;
    const log = clickLogRef.current;
    if (log.length < 2) return;
    const gap = Math.hypot(log[1].sx - log[0].sx, log[1].sy - log[0].sy);
    const tp = useProjectStore.getState().tempPoints;
    // Finish only when both clicks of the double-click hit the same spot (<= 4 screen px); the duplicate vertex
    // added by the second click is dropped. Two fast clicks on different vertices never close the polygon.
    const res = doubleClickFinish(tp, gap, 4 / stageScaleRef.current);
    if (!res.finish) return;
    const v = validateClosablePolygon(res.points);
    if (!v.ok) {
      showMessage(v.message || 'Cannot close polygon.');
      return;
    }
    lastCloseAtRef.current = Date.now();
    clickLogRef.current = [];
    addZone(v.points);
    clearTempPoints();
  };

  // Cursor-anchored exponential zoom. Applied to the Konva stage inside rAF (no React render per tick);
  // React state follows ~120 ms after the last tick.
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>): void => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const cur = wheelViewRef.current ?? { scale: stage.scaleX() || stageScaleRef.current, x: stage.x(), y: stage.y() };
    const mp = { x: (pointer.x - cur.x) / cur.scale, y: (pointer.y - cur.y) / cur.scale };
    const ns = clampZoom(cur.scale * Math.exp(-e.evt.deltaY * 0.0018));
    wheelViewRef.current = { scale: ns, x: pointer.x - mp.x * ns, y: pointer.y - mp.y * ns };
    stageScaleRef.current = ns;
    if (wheelRafRef.current === null) {
      wheelRafRef.current = requestAnimationFrame(() => {
        wheelRafRef.current = null;
        const v = wheelViewRef.current;
        wheelViewRef.current = null;
        const st = stageRef.current;
        if (!v || !st) return;
        st.scale({ x: v.scale, y: v.scale });
        st.position({ x: v.x, y: v.y });
        st.batchDraw();
      });
    }
    window.clearTimeout(wheelSyncRef.current);
    wheelSyncRef.current = window.setTimeout(() => {
      const st = stageRef.current;
      if (!st) return;
      setStageScale(st.scaleX());
      setStagePos({ x: st.x(), y: st.y() });
    }, 120);
  };

  useEffect(
    () => () => {
      if (wheelRafRef.current !== null) cancelAnimationFrame(wheelRafRef.current);
      window.clearTimeout(wheelSyncRef.current);
    },
    []
  );

  const handleZoomBtn = (factor: number): void => {
    const centerPoint = { x: (size.w / 2 - stagePos.x) / stageScale, y: (size.h / 2 - stagePos.y) / stageScale };
    const newScale = clampZoom(stageScale * factor);
    setStageScale(newScale);
    setStagePos({ x: size.w / 2 - centerPoint.x * newScale, y: size.h / 2 - centerPoint.y * newScale });
  };

  const handleResetZoom = (): void => {
    setStageScale(1.0);
    setStagePos({ x: 50, y: 50 });
  };

  // ───────── Drag commit handlers (heavy routing only at dragEnd) ─────────
  const snapNodeDuringDrag = useCallback(
    (node: Konva.Node): void => {
      const s = snapAt(node.x(), node.y());
      if (s.kind !== 'none') node.position({ x: s.x, y: s.y });
    },
    [snapAt]
  );

  const isDuctedSystem = (zone: Zone): boolean =>
    zone.systemType === 'concealed' ||
    zone.systemType === 'packaged' ||
    zone.systemType === 'ahu' ||
    zone.systemType === 'vrf' ||
    zone.systemType === 'fcu';

  /**
   * Routes every indoor unit of the zone with the correct px-per-foot scale. Diffusers carry no unit association,
   * so each one is served by its nearest unit; each unit gets its own supply + return network.
   */
  const routeZoneNetworks = (
    zone: Zone,
    diffusers: Diffuser[],
    positions: Array<{ x: number; y: number }>
  ): { ducts: DuctSegment[]; unitPos: { x: number; y: number } | undefined; unitPositions?: Array<{ x: number; y: number }> } => {
    const acoustic = {
      targetNc: zone.targetNc,
      locationCategory: zone.ductLocationCategory,
      acousticSensitivity: zone.acousticSensitivity,
      enhancedPerformance: zone.enhancedAcousticPerformance,
      zoneName: zone.name
    };
    if (positions.length <= 1) {
      const r = routeDucts(zone.points, diffusers, project.units, zone.id, positions[0], zone.systemType, zone.outdoorUnitPos, acoustic, k);
      return { ducts: r.ducts, unitPos: positions.length ? positions[0] : r.ducts.length ? r.unitPos : undefined };
    }
    // Capacity-constrained assignment: supply terminals go to the nearest unit that still has airflow capacity
    // (greedy), returns to the nearest unit. Warn when a unit is still pushed >5% past its delivered CFM.
    const groups: Diffuser[][] = positions.map(() => []);
    const supply = diffusers.filter(isSupplyTerminal);
    const asg = assignTerminalsToUnits(supply, positions);
    asg.groups.forEach((g, ui) => g.forEach((ti) => groups[ui].push(supply[ti])));
    for (const d of diffusers) {
      if (isSupplyTerminal(d)) continue;
      let best = 0;
      let bd = Infinity;
      positions.forEach((p, i) => {
        const dd = Math.hypot(d.x - p.x, d.y - p.y);
        if (dd < bd) { bd = dd; best = i; }
      });
      groups[best].push(d);
    }
    if (asg.anyOverloaded) {
      const worst = asg.loads.reduce((bi, l, i, arr) => (l > arr[bi] ? i : bi), 0);
      showMessage(
        `Unit ${worst + 1} would serve ${formatAirflow(asg.loads[worst], project.units)} but delivers ${formatAirflow(asg.capacity, project.units)} - move terminals or add a unit.`
      );
    }
    const ducts: DuctSegment[] = [];
    positions.forEach((p, i) => {
      if (groups[i].length === 0) return;
      const r = routeDucts(zone.points, groups[i], project.units, i === 0 ? zone.id : `${zone.id}-u${i}`, p, zone.systemType, zone.outdoorUnitPos, acoustic, k);
      ducts.push(...r.ducts);
    });
    return { ducts, unitPos: positions[0], unitPositions: positions };
  };

  const commitVertex = (zoneId: string, pointIdx: number, x: number, y: number): void => {
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return;
    const pts = [...zone.points];
    pts[pointIdx * 2] = x;
    pts[pointIdx * 2 + 1] = y;
    if (pts.length < 6 || zone.diffusers.length === 0) {
      updateZone(zoneId, { points: pts });
      return;
    }
    // Terminals / units that the edit pushed outside the room (or against a wall) are pulled back inside
    const margin = Math.min(k, 1.5 * k);
    const fits = (p: { x: number; y: number }): boolean => isPointInsideWithClearance(p.x, p.y, pts, 0.5 * k);
    const pull = <T extends { x: number; y: number }>(p: T): T => {
      if (fits(p)) return p;
      const c = clampPointInsidePolygon(p.x, p.y, pts, margin);
      return { ...p, x: c.x, y: c.y };
    };
    const diffusers = zone.isDiffusersLocked ? zone.diffusers : zone.diffusers.map(pull);
    const positions = unitPositionsOf(zone).map(pull);
    const patch: Partial<Zone> = { points: pts, diffusers };
    if (positions.length) {
      patch.unitPos = positions[0];
      if (zone.unitPositions) patch.unitPositions = positions;
    }
    if (isDuctedSystem(zone) && !zone.isDuctLocked) {
      const routed = routeZoneNetworks({ ...zone, points: pts }, diffusers, positions);
      patch.ducts = routed.ducts;
      if (routed.unitPos) patch.unitPos = routed.unitPos;
    }
    updateZone(zoneId, patch);
  };

  const commitDiffuser = (zoneId: string, diffuserId: string, x: number, y: number): void => {
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return;
    const updated = zone.diffusers.map((d) => (d.id === diffuserId ? { ...d, x, y } : d));
    if (isDuctedSystem(zone)) {
      const routed = routeZoneNetworks(zone, updated, unitPositionsOf(zone));
      updateZone(zoneId, { diffusers: updated, ducts: routed.ducts, ...(routed.unitPos ? { unitPos: routed.unitPos } : {}) });
    } else {
      updateZone(zoneId, { diffusers: updated, ducts: [] });
    }
  };

  const commitIndoorUnit = (zoneId: string, idx: number, x: number, y: number): void => {
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return;
    const positions = unitPositionsOf(zone).slice();
    if (positions.length === 0) positions.push({ x, y });
    else positions[Math.min(idx, positions.length - 1)] = { x, y };
    const patch: Partial<Zone> = {};
    if (idx === 0) patch.unitPos = { x, y };
    if (zone.unitPositions) patch.unitPositions = positions;
    if (isDuctedSystem(zone)) {
      const routed = routeZoneNetworks(zone, zone.diffusers, positions);
      patch.ducts = routed.ducts;
      if (idx === 0 && routed.unitPos) patch.unitPos = routed.unitPos;
    }
    updateZone(zoneId, patch);
  };

  const commitOutdoorUnit = (zoneId: string, idx: number, x: number, y: number): void => {
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return;
    if (idx === 0) updateZone(zoneId, { outdoorUnitPos: { x, y } });
    else if (zone.outdoorUnitPositions) {
      const next = zone.outdoorUnitPositions.slice();
      next[idx] = { x, y };
      updateZone(zoneId, { outdoorUnitPositions: next });
    }
  };

  // ───────── DXF drawing ─────────
  const drawDxfEntities = (ctx: CanvasRenderingContext2D, ents: DxfEntity[]): void => {
    for (const ent of ents) {
      if (ent.type === 'LINE') {
        ctx.moveTo(ent.x || 0, ent.y || 0);
        ctx.lineTo(ent.points?.[0] || 0, ent.points?.[1] || 0);
      } else if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && ent.points) {
        const pts = ent.points;
        if (pts.length >= 4) {
          ctx.moveTo(pts[0], pts[1]);
          for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        }
      } else if (ent.type === 'CIRCLE' && typeof ent.radius === 'number') {
        const cx = ent.x || 0, cy = ent.y || 0;
        ctx.moveTo(cx + ent.radius, cy);
        ctx.arc(cx, cy, ent.radius, 0, Math.PI * 2);
      } else if (ent.type === 'ARC' && typeof ent.radius === 'number') {
        const cx = ent.x || 0, cy = ent.y || 0;
        const a0 = rad(ent.startAngle ?? 0);
        const a1 = rad(ent.endAngle ?? 360);
        ctx.moveTo(cx + ent.radius * Math.cos(a0), cy + ent.radius * Math.sin(a0));
        ctx.arc(cx, cy, ent.radius, a0, a1, false);
      }
    }
  };

  const dxfShapes = useMemo(() => {
    const out: React.ReactNode[] = [];
    dxfGroups.forEach((byColor, layerName) => {
      if (dxfLayers[layerName]?.visible === false) return;
      byColor.forEach((ents, color) => {
        out.push(
          <Shape
            key={`dxf-${layerName}-${color}`}
            listening={false}
            stroke={color}
            strokeWidth={1}
            strokeScaleEnabled={false}
            opacity={0.75}
            sceneFunc={(context, shape) => {
              const ctx = rawCtx(context);
              ctx.beginPath();
              drawDxfEntities(ctx, ents);
              context.strokeShape(shape);
            }}
          />
        );
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dxfGroups, dxfLayers]);

  const renderGrid = (): React.JSX.Element | null => {
    if (!annotationVisibility.grid) return null;
    return (
      <Shape
        listening={false}
        sceneFunc={(context, shape) => {
          const st = shape.getStage();
          if (!st) return;
          const ctx = rawCtx(context);
          const sc = st.scaleX();
          const x0 = -st.x() / sc, y0 = -st.y() / sc;
          const x1 = x0 + st.width() / sc, y1 = y0 + st.height() / sc;
          let step = gridStep;
          for (let g = 0; step * sc < 8 && g < 24; g++) step *= 5; // adaptive decluttering
          const major = step * 5;
          const draw = (isMajor: boolean): void => {
            ctx.beginPath();
            const i0x = Math.floor(x0 / step), i1x = Math.ceil(x1 / step);
            const i0y = Math.floor(y0 / step), i1y = Math.ceil(y1 / step);
            if (i1x - i0x > 4000 || i1y - i0y > 4000) return;
            for (let i = i0x; i <= i1x; i++) {
              const x = i * step;
              if ((Math.abs(x % major) < step * 1e-6 || Math.abs(Math.abs(x % major) - major) < step * 1e-6) !== isMajor) continue;
              ctx.moveTo(x, y0); ctx.lineTo(x, y1);
            }
            for (let i = i0y; i <= i1y; i++) {
              const y = i * step;
              if ((Math.abs(y % major) < step * 1e-6 || Math.abs(Math.abs(y % major) - major) < step * 1e-6) !== isMajor) continue;
              ctx.moveTo(x0, y); ctx.lineTo(x1, y);
            }
            ctx.lineWidth = (isMajor ? 0.9 : 0.5) / sc;
            ctx.strokeStyle = isMajor ? '#2c2c2c' : '#1a1a1a';
            ctx.stroke();
          };
          draw(false);
          draw(true);
        }}
      />
    );
  };

  const renderDxfText = (): React.JSX.Element | null => {
    if (!annotationVisibility.dxfText || dxfTexts.length === 0 || lodTier < 2) return null;
    return (
      <Shape
        listening={false}
        opacity={0.8}
        sceneFunc={(context, shape) => {
          const ctx = rawCtx(context);
          const sc = shape.getStage()?.scaleX() || 1;
          ctx.save();
          ctx.textBaseline = 'alphabetic';
          for (const ent of dxfTexts) {
            if (ent.layer && dxfLayers[ent.layer]?.visible === false) continue;
            const h = ent.height && ent.height > 0 ? ent.height : Math.max(7, 9 / sc);
            if (h * sc < 2.5) continue; // too small to read
            ctx.fillStyle = dxfLayers[ent.layer || '0']?.colorOverride || ent.color || dxfLayers[ent.layer || '0']?.color || '#94a3b8';
            ctx.font = `${h}px sans-serif`;
            ctx.textAlign = ent.align || 'left';
            ctx.save();
            ctx.translate(ent.x || 0, ent.y || 0);
            if (ent.rotation) ctx.rotate(rad(ent.rotation));
            const lines = String(ent.text).split(/\\P|\r?\n/);
            lines.forEach((ln, i) => ctx.fillText(ln, 0, i * h * 1.25));
            ctx.restore();
          }
          ctx.restore();
        }}
      />
    );
  };

  // ───────── Annotation layout (collision-free labels; recomputed per zoom bucket, not per wheel tick) ─────────
  const sBucket = scaleBucket(stageScale);
  const fontFactor = (project.equipmentScale || 1.5) / 1.5;
  const labelItems = useMemo(() => {
    const s = bucketScale(sBucket);
    const tier = getLodTier(s);
    const ff = fontFactor;
    const units = project.units;
    const av = annotationVisibility;
    const obstacles: LRect[] = [];
    const reqs: LabelRequest[] = [];
    const meta = new Map<string, Omit<LabelItem, 'placed'>>();
    const pad = 2;
    const addObstacle = (cx: number, cy: number, w: number, h: number): void => {
      const ww = Math.max(w, 6), hh = Math.max(h, 6);
      obstacles.push({ x: cx * s - ww / 2 - pad, y: cy * s - hh / 2 - pad, w: ww + 2 * pad, h: hh + 2 * pad });
    };
    const colorLine = (text: string, color: string): LabelLine => ({ text, color, bold: true });

    for (const z of zones) {
      const selfContained = isSelfContainedSystem(z.systemType);
      const avoid: Array<{ x: number; y: number; r: number }> = [];
      // symbols are obstacles for every label
      for (const d of z.diffusers) {
        const face = terminalFacePx(d, k, units);
        addObstacle(d.x, d.y, face.w * s, face.h * s);
        avoid.push({ x: d.x, y: d.y, r: Math.max(face.w, face.h) / 2 + 8 / s });
      }
      const kind = unitKindForSystem(z.systemType);
      const fp = unitFootprintPx(kind, k, catalogDimsFor(z.catalogModel));
      for (const u of unitPositionsOf(z)) {
        addObstacle(u.x, u.y, fp.w * s, fp.d * s);
        // equipment tag below the unit (always kept): same size rule as the symbol label
        const fs = Math.max(9.5 * textScale, 10 / s) * s;
        const tw = 7 * 0.6 * fs;
        obstacles.push({ x: u.x * s - tw / 2, y: (u.y + fp.d / 2) * s + 2 * textScale * s, w: tw, h: fs * 1.25 });
        avoid.push({ x: u.x, y: u.y, r: Math.hypot(fp.w, fp.d) / 2 + 8 / s });
      }
      if (!selfContained) {
        const ofp = unitFootprintPx('odu', k, outdoorDimsFor(z));
        for (const o of outdoorPositionsOf(z)) {
          addObstacle(o.x, o.y, ofp.w * s, ofp.d * s);
          avoid.push({ x: o.x, y: o.y, r: Math.hypot(ofp.w, ofp.d) / 2 });
        }
      }

      // Zone label: largest empty area of the polygon, away from terminals / units
      if (av.zoneLabels && z.points.length >= 6) {
        const spot = labelSpotInPolygon(z.points, avoid) ?? { ...getPolygonCentroid(z.points), clearance: 0 };
        const supply = z.diffusers.length > 0
          ? supplyCfmOf(z.diffusers)
          : toCfm(calculateZoneLoad(z, project).supplyCfm, units);
        const lines: LabelLine[] = [
          colorLine(z.name, z.id === selectedZoneId ? '#60a5fa' : '#e5e5e5'),
          colorLine(`${formatAirflow(supply, units)} (${z.systemType || 'concealed'})`, '#10b981')
        ];
        const fontPx = 12 * ff;
        const size = measureLabel(lines.map((l) => l.text), fontPx);
        const anchor = { x: spot.x * s, y: spot.y * s };
        const id = `z:${z.id}`;
        reqs.push({
          id, lines: lines.map((l) => l.text), fontPx, priority: 50, mandatory: true, anchor,
          candidates: [{ x: anchor.x, y: anchor.y }, ...compassCandidates(anchor, { w: 0, h: 0 }, size, 8)]
        });
        meta.set(id, { id, zoneId: z.id, kind: 'zone', lines, fontPx, anchorWorld: { x: spot.x, y: spot.y } });
      }

      // ONE tag per terminal: "CD-1" / "18x18 . 162 CFM"
      if (tier >= 2 && (av.diffuserTags || av.diffuserCfm)) {
        let nS = 0, nR = 0, nE = 0;
        for (const d of z.diffusers) {
          const code = d.type === 'return' ? 'RG' : d.type === 'exhaust' ? 'EG' : z.systemType === 'high-wall' ? 'HW' : 'CD';
          const num = d.type === 'return' ? ++nR : d.type === 'exhaust' ? ++nE : ++nS;
          const f = terminalFaceIn(d, units);
          const lines: LabelLine[] = [];
          const col = d.type === 'return' ? '#d8b4fe' : '#fde047';
          if (av.diffuserTags) lines.push(colorLine(`${code}-${num}`, col));
          const second: string[] = [];
          if (av.diffuserTags) second.push(formatTerminalSize(f.w, f.h, units));
          if (av.diffuserCfm) second.push(formatAirflow(d.cfm, units));
          if (detailed && d.actualNc) second.push(`NC ${d.actualNc}`);
          if (second.length) lines.push({ text: second.join(' · '), color: col, bold: false });
          if (!lines.length) continue;
          const face = terminalFacePx(d, k, units);
          const id = `t:${z.id}:${d.id}`;
          const fontPx = 10 * ff;
          reqs.push({
            id, lines: lines.map((l) => l.text), fontPx, priority: 30,
            anchor: { x: d.x * s, y: d.y * s }, anchorHalf: { w: (face.w * s) / 2, h: (face.h * s) / 2 }
          });
          meta.set(id, {
            id, zoneId: z.id, kind: 'terminal', lines, fontPx, anchorWorld: { x: d.x, y: d.y },
            bg: 'rgba(12,12,12,0.72)'
          });
        }
      }

      // Duct size ONCE per section (size only; CFM / velocity only in Detailed mode)
      const ductTagOn = av.ductSizeBadges || av.dimensions || (detailed && av.ductCfm);
      if (tier >= 2 && ductTagOn && (av.ducts || av.ductCenterlines) && z.ducts.length) {
        const sections = buildDuctSections(z.ducts, getDuctRuns(z.ducts, k), units);
        for (const sec of sections) {
          const lines: LabelLine[] = [];
          const col = sec.network === 'return' ? '#cbd5e1' : '#67e8f9';
          if (av.ductSizeBadges || av.dimensions) lines.push(colorLine(sec.text, col));
          if (detailed) {
            const d = sec.duct;
            const vel = d.velocityFpm || Math.round(d.cfm / Math.max(0.1, (d.widthIn * d.heightIn) / 144));
            const parts: string[] = [];
            if (av.ductCfm) parts.push(formatAirflow(d.cfm, units));
            if (av.ductSizeBadges) parts.push(formatVelocity(vel, units));
            if (parts.length) lines.push({ text: parts.join(' · '), color: '#facc15', bold: false });
          }
          if (!lines.length) continue;
          const fontPx = 9 * ff;
          const size = measureLabel(lines.map((l) => l.text), fontPx);
          const hw = ductHalfWidthPx(sec.duct.widthIn || sec.duct.diameterIn || 0, k) * s;
          const pieces = sec.pieces.map((p) => p.map((v) => v * s));
          const cands = ductTagCandidates(pieces, hw, size);
          if (!cands.length) continue; // no piece long enough at this zoom: hidden
          let li = 0, ll = -1;
          sec.pieces.forEach((p, i) => {
            const l = Math.hypot(p[2] - p[0], p[3] - p[1]);
            if (l > ll) { ll = l; li = i; }
          });
          const lp = sec.pieces[li];
          const aw = { x: (lp[0] + lp[2]) / 2, y: (lp[1] + lp[3]) / 2 };
          const id = `d:${z.id}:${sec.id}`;
          reqs.push({ id, lines: lines.map((l) => l.text), fontPx, priority: 20, anchor: { x: aw.x * s, y: aw.y * s }, candidates: cands });
          meta.set(id, {
            id, zoneId: z.id, kind: 'duct', lines, fontPx, anchorWorld: aw,
            bg: 'rgba(15,23,42,0.88)', border: sec.network === 'return' ? '#64748b' : '#38bdf8'
          });
        }
      }
    }

    const placed = layoutLabels(reqs, obstacles);
    const byZone = new Map<string, LabelItem[]>();
    placed.forEach((pl, id) => {
      const m = meta.get(id);
      if (!m || !pl.visible) return;
      const arr = byZone.get(m.zoneId) ?? [];
      arr.push({ ...m, placed: pl });
      byZone.set(m.zoneId, arr);
    });
    return byZone;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, project.units, project.scale, k, sBucket, annotationVisibility, detailed, fontFactor, textScale, selectedZoneId]);

  /** A placed label: constant screen-size text with a box sized to the measured text. */
  const renderLabelItem = (it: LabelItem): React.JSX.Element => {
    const p = it.placed;
    const sc = stageScale;
    const x = it.anchorWorld.x + p.dx / sc;
    const y = it.anchorWorld.y + p.dy / sc;
    const lh = it.fontPx * 1.25;
    return (
      <Group key={it.id} x={x} y={y} rotation={uprightAngle(p.angleDeg)} scaleX={1 / sc} scaleY={1 / sc} listening={false}>
        {it.bg && (
          <Rect x={-p.w / 2} y={-p.h / 2} width={p.w} height={p.h} fill={it.bg} stroke={it.border} strokeWidth={it.border ? 0.8 : 0} cornerRadius={2} />
        )}
        {it.lines.map((ln, i) => (
          <Text
            key={i}
            x={-p.w / 2}
            y={-p.h / 2 + 1 + i * lh}
            width={p.w}
            height={lh}
            align="center"
            verticalAlign="middle"
            wrap="none"
            text={ln.text}
            fontSize={it.fontPx}
            fontStyle={ln.bold === false ? 'normal' : 'bold'}
            fill={ln.color}
            listening={false}
          />
        ))}
      </Group>
    );
  };

  // ───────── Symbols (true physical size) ─────────
  const renderIndoorUnitSymbol = (zone: Zone, uIdx: number, ts: number): React.JSX.Element => {
    const kind = unitKindForSystem(zone.systemType);
    const fp = unitFootprintPx(kind, k, catalogDimsFor(zone.catalogModel));
    const w = fp.w, d = fp.d;
    const sw = (v: number): number => getStrokeWidth(v, v);
    const label = (txt: string, color: string): React.JSX.Element => (
      <Text
        x={-w / 2 - 20 * ts}
        y={d / 2 + 2 * ts}
        width={w + 40 * ts}
        text={txt}
        align="center"
        fontSize={Math.max(9.5 * ts, 10 / stageScale)}
        fill={color}
        fontStyle="bold"
        listening={false}
      />
    );

    if (kind === 'cassette') {
      // 4-way ceiling cassette (plan): outer square = decorative panel, inner square = intake grille,
      // 4 discharge slots (one per side, in the band between panel edge and grille), centre hub circle.
      const hw = w / 2, hd = d / 2;
      const gw = w * 0.62, gd = d * 0.62; // grille
      const band = (w - gw) / 2; // panel margin
      const slotL = gw * 0.92, slotT = Math.max(band * 0.34, 1);
      const sMid = band / 2; // slot centre distance from the panel edge
      const corner = Math.max(band * 0.45, 1.5);
      const hatch = hatchSegments(gw, gd, Math.max(gw / 7, 2 / stageScale));
      return (
        <Group>
          <Rect x={-hw} y={-hd} width={w} height={d} fill="rgba(239, 68, 68, 0.16)" stroke="#ef4444" strokeWidth={sw(1.6)} />
          <Rect x={-hw + band * 0.18} y={-hd + band * 0.18} width={w - band * 0.36} height={d - band * 0.36} stroke="#f87171" strokeWidth={sw(0.6)} />
          <Rect x={-gw / 2} y={-gd / 2} width={gw} height={gd} fill="rgba(127, 29, 29, 0.35)" stroke="#fca5a5" strokeWidth={sw(1)} />
          <Group clipX={-gw / 2} clipY={-gd / 2} clipWidth={gw} clipHeight={gd} listening={false}>
            {hatch.map((sg, i) => (
              <Line key={i} points={sg} stroke="#fca5a5" strokeWidth={sw(0.4)} opacity={0.55} />
            ))}
          </Group>
          {/* four discharge slots */}
          <Rect x={-slotL / 2} y={-hd + sMid - slotT / 2} width={slotL} height={slotT} fill="#facc15" stroke="#a16207" strokeWidth={sw(0.4)} />
          <Rect x={-slotL / 2} y={hd - sMid - slotT / 2} width={slotL} height={slotT} fill="#facc15" stroke="#a16207" strokeWidth={sw(0.4)} />
          <Rect x={-hw + sMid - slotT / 2} y={-slotL / 2} width={slotT} height={slotL} fill="#facc15" stroke="#a16207" strokeWidth={sw(0.4)} />
          <Rect x={hw - sMid - slotT / 2} y={-slotL / 2} width={slotT} height={slotL} fill="#facc15" stroke="#a16207" strokeWidth={sw(0.4)} />
          {/* panel corner fixings */}
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([cx, cy]) => (
            <Rect key={`${cx}${cy}`} x={cx * (hw - band * 0.5) - corner / 2} y={cy * (hd - band * 0.5) - corner / 2} width={corner} height={corner} stroke="#fca5a5" strokeWidth={sw(0.5)} />
          ))}
          <Circle x={0} y={0} radius={Math.min(gw, gd) * 0.2} fill="rgba(254, 202, 202, 0.15)" stroke="#fecaca" strokeWidth={sw(1)} />
          <Circle x={0} y={0} radius={Math.min(gw, gd) * 0.07} fill="#fecaca" />
          {label(`CU-0${uIdx + 1}`, '#fecaca')}
        </Group>
      );
    }
    if (kind === 'rtu') {
      return (
        <Group>
          <Rect x={-w / 2} y={-d / 2} width={w} height={d} fill="rgba(245, 158, 11, 0.25)" stroke="#f59e0b" strokeWidth={sw(1.8)} />
          <Line points={[-w * 0.1, -d / 2, -w * 0.1, d / 2]} stroke="#f59e0b" strokeWidth={sw(1)} dash={[4 / stageScale, 3 / stageScale]} />
          <Circle x={-w * 0.3} y={-d * 0.22} radius={d * 0.17} stroke="#fbbf24" strokeWidth={sw(1)} />
          <Circle x={-w * 0.3} y={d * 0.22} radius={d * 0.17} stroke="#fbbf24" strokeWidth={sw(1)} />
          <Rect x={w * 0.02} y={-d * 0.3} width={w * 0.28} height={d * 0.6} stroke="#fbbf24" strokeWidth={sw(1)} fill="rgba(251, 191, 36, 0.1)" />
          <Circle x={w * 0.36} y={0} radius={d * 0.2} stroke="#fbbf24" strokeWidth={sw(1.2)} />
          {label(`RTU-${uIdx + 1}`, '#fbbf24')}
        </Group>
      );
    }
    // ducted FCU / concealed split / AHU
    return (
      <Group>
        <Rect x={-w / 2} y={-d / 2} width={w} height={d} fill="rgba(239, 68, 68, 0.22)" stroke="#ef4444" strokeWidth={sw(1.8)} />
        <Line points={[-w * 0.36, -d * 0.36, -w * 0.24, d * 0.36]} stroke="#facc15" strokeWidth={sw(1)} />
        <Line points={[-w * 0.24, -d * 0.36, -w * 0.12, d * 0.36]} stroke="#facc15" strokeWidth={sw(1)} />
        <Line points={[-w * 0.12, -d * 0.36, 0, d * 0.36]} stroke="#facc15" strokeWidth={sw(1)} />
        <Circle x={w * 0.26} y={0} radius={d * 0.32} stroke="#ef4444" strokeWidth={sw(1.2)} />
        {label(`${kind === 'ahu' ? 'AHU' : 'FCU'}-0${uIdx + 1}`, '#fecaca')}
      </Group>
    );
  };

  const renderOutdoorUnitSymbol = (ts: number, catDims?: CatDims): React.JSX.Element => {
    const fp = unitFootprintPx('odu', k, catDims);
    const w = fp.w, d = fp.d;
    const twoFans = w / d > 1.4;
    const r = twoFans ? Math.min(d * 0.38, w * 0.22) : Math.min(d, w) * 0.38;
    const sw = (v: number): number => getStrokeWidth(v, v);
    return (
      <Group>
        <Rect x={-w / 2} y={-d / 2} width={w} height={d} fill="rgba(6, 182, 212, 0.3)" stroke="#06b6d4" strokeWidth={sw(1.6)} />
        {(twoFans ? [-1, 1] : [0]).map((sgn) => (
          <Group key={sgn} x={sgn * w * 0.25} y={0}>
            <Circle radius={r} stroke="#22d3ee" strokeWidth={sw(1)} />
            <Line points={[-r, 0, r, 0]} stroke="#22d3ee" strokeWidth={sw(1)} />
            <Line points={[0, -r, 0, r]} stroke="#22d3ee" strokeWidth={sw(1)} />
          </Group>
        ))}
        <Group x={w / 2 + 6 * ts} y={-d / 2}>
          <Circle radius={5 * Math.min(1.8, ts)} fill="#facc15" stroke="#000000" strokeWidth={0.8} />
          <Text x={-3 * Math.min(1.8, ts)} y={-4 * Math.min(1.8, ts)} text="P" fontSize={Math.max(6 * ts, 7 / stageScale)} fill="#000000" fontStyle="bold" listening={false} />
        </Group>
      </Group>
    );
  };

  /** Upright tag centred on (x,y), rotated by angleDeg. Font size is constant in screen px (1/stageScale). */
  const renderTag = (key: string, x: number, y: number, angleDeg: number, text: string, color: string, screenPx = 10): React.JSX.Element => {
    const fs = screenPx / stageScale;
    const tw = text.length * fs * 0.62 + 2 * fs * 0.3;
    return (
      <Text
        key={key}
        x={x}
        y={y}
        width={tw}
        height={fs * 1.2}
        offsetX={tw / 2}
        offsetY={fs * 0.6}
        rotation={angleDeg}
        align="center"
        verticalAlign="middle"
        text={text}
        fontSize={fs}
        fontStyle="bold"
        fill={color}
        listening={false}
      />
    );
  };

  /** Shop-drawing dimension layer for one zone: dimension lines only (tags come from the shared label layout). */
  const renderDimensions = (zone: Zone): React.JSX.Element | null => {
    if (!annotationVisibility.dimensions) return null;
    const out: React.ReactNode[] = [];
    const px = 1 / stageScale;
    // Duct size and terminal tags live in the shared collision-free label layout (no duplicates here).
    // Room overall dimension lines
    const b = pointsBounds(zone.points);
    if (b) {
      const lines = roomDimensionLines(b, 22 * px, 7 * px, 4 * px);
      lines.forEach((dl, i) => {
        const col = '#a3e635';
        const sw = 1 * px;
        out.push(
          <Group key={`dim-${zone.id}-${i}`} listening={false}>
            <Line points={[dl.x1, dl.y1, dl.x2, dl.y2]} stroke={col} strokeWidth={sw} />
            <Line points={dl.ext[0]} stroke={col} strokeWidth={sw} />
            <Line points={dl.ext[1]} stroke={col} strokeWidth={sw} />
            <Line points={dimTick(dl.x1, dl.y1, 5 * px)} stroke={col} strokeWidth={1.6 * px} />
            <Line points={dimTick(dl.x2, dl.y2, 5 * px)} stroke={col} strokeWidth={1.6 * px} />
            {renderTag(`dimt-${zone.id}-${i}`, dl.textX, dl.textY, dl.angleDeg, formatLength(dl.lengthPx / k, project.units), col, 11)}
          </Group>
        );
      });
    }
    return <Group listening={false}>{out}</Group>;
  };

  /** Zone polygon fill / outline: lives in its own layer BELOW all terminals, units and handles. */
  const renderZoneFill = (zone: Zone): React.JSX.Element => {
    const isSelected = zone.id === selectedZoneId;
    return (
      <Line
        key={`fill-${zone.id}`}
        points={zone.points}
        closed
        fill={isSelected ? 'rgba(59, 130, 246, 0.18)' : 'rgba(255, 255, 255, 0.03)'}
        stroke={isSelected ? '#3b82f6' : '#525252'}
        strokeWidth={getStrokeWidth(isSelected ? 2.5 : 1.2, isSelected ? 2.5 : 1.5)}
        ref={(n) => {
          if (n) zoneLineNodes.set(zone.id, n);
          else zoneLineNodes.delete(zone.id);
        }}
        onClick={() => selectZone(zone.id)}
        onTap={() => selectZone(zone.id)}
      />
    );
  };

  const renderZone = (zone: Zone): React.JSX.Element => {
    const isSelected = zone.id === selectedZoneId;
    const load = calculateZoneLoad(zone, project);
    const ts = textScale;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < zone.points.length; i += 2) {
      minX = Math.min(minX, zone.points[i]); maxX = Math.max(maxX, zone.points[i]);
      minY = Math.min(minY, zone.points[i + 1]); maxY = Math.max(maxY, zone.points[i + 1]);
    }

    const units = unitPositionsOf(zone);
    // Packaged RTUs are self-contained: no condensing unit symbol and no refrigerant lines.
    const outdoors = isSelfContainedSystem(zone.systemType) ? [] : outdoorPositionsOf(zone);
    const labels = labelItems.get(zone.id) ?? [];
    const ductRuns = annotationVisibility.ducts || annotationVisibility.ductCenterlines ? getDuctRuns(zone.ducts, k) : [];
    const unitFp = unitFootprintPx(unitKindForSystem(zone.systemType), k, catalogDimsFor(zone.catalogModel));
    // Per-unit airflow vs delivered CFM (multi-unit ducted zones): the same assignment the router uses.
    let unitOverload: ReturnType<typeof assignTerminalsToUnits> | null = null;
    if (units.length >= 2 && isDuctedSystem(zone)) {
      const sup = zone.diffusers.filter(isSupplyTerminal);
      const a = assignTerminalsToUnits(sup, units);
      if (a.anyOverloaded) unitOverload = a;
    }

    return (
      <Group key={zone.id}>
        {/* Refrigerant line sets & master callout */}
        {(() => {
          if (units.length === 0 && outdoors.length === 0) return null;

          const qty = zone.catalogQty || units.length || 1;
          // load.* is in PROJECT units (W for metric): convert to Btu/h; terminal / duct CFM are always CFM.
          const btuPerUnit = Math.round(toBtuh(load.totalLoad, project.units) / Math.max(1, qty));
          const supplyDiffusers = zone.diffusers.filter(isSupplyTerminal);
          const returnDiffusers = zone.diffusers.filter((d) => d.type === 'return');
          const cfmPerUnit = Math.round(
            (zone.diffusers.length > 0 ? supplyCfmOf(supplyDiffusers) : toCfm(load.supplyCfm, project.units)) / Math.max(1, qty)
          );
          const freshAirCfm = Math.round(toCfm(load.supplyCfm, project.units) * 0.15);
          const sysLabel =
            zone.systemType === 'cassette' ? 'CASSETTE SPLIT'
            : zone.systemType === 'high-wall' ? 'HIGH WALL SPLIT'
            : zone.systemType === 'packaged' ? 'PACKAGE UNIT'
            : zone.systemType === 'ahu' ? 'CENTRAL AHU'
            : zone.systemType === 'fcu' ? 'DUCTED FCU'
            : 'CONCEALED SPLIT';

          // Real terminal counts / sizes grouped by size label
          const termLines = (list: typeof zone.diffusers, tag: string): string[] => {
            const groups = new Map<string, { n: number; cfm: number }>();
            for (const d of list) {
              const lbl = terminalSizeLabel(d, project.units);
              const g = groups.get(lbl) || { n: 0, cfm: 0 };
              g.n++; g.cfm += d.cfm;
              groups.set(lbl, g);
            }
            const out: string[] = [];
            groups.forEach((g, lbl) => {
              out.push(`${g.n}-${tag} ${lbl}`, `${formatAirflow(g.cfm / g.n, project.units)} EACH`);
            });
            return out;
          };
          const lines = [
            `${qty}-${sysLabel}`,
            `${formatLoad(btuPerUnit, project.units)} EACH`,
            `${formatAirflow(cfmPerUnit, project.units)} EACH`,
            ...termLines(supplyDiffusers, 'S.C.D'),
            ...termLines(returnDiffusers, 'R.C.D'),
            `FA ${formatAirflow(freshAirCfm, project.units)}`
          ];

          return (
            <Group listening={false}>
              {annotationVisibility.refrigerantPiping && !isSelfContainedSystem(zone.systemType) && units.map((uPos, uIdx) => {
                const oPos = outdoors[uIdx] || outdoors[0] || { x: uPos.x + 3.5 * k, y: uPos.y + 3.5 * k };
                const piping = routeOrthogonalRefrigerantPiping(oPos, [uPos]);
                return (
                  <Group key={`piping-set-${zone.id}-${uIdx}`}>
                    {piping.segments.map((seg, sIdx) => (
                      <Line
                        key={`ref-seg-${zone.id}-${uIdx}-${sIdx}`}
                        points={seg}
                        stroke="#f97316"
                        strokeWidth={getStrokeWidth(Math.max(0.15 * k, 0.5), 2)}
                        lineCap="round"
                        lineJoin="round"
                      />
                    ))}
                    {piping.isolatorPos && (
                      <Group x={piping.isolatorPos.x} y={piping.isolatorPos.y}>
                        <Circle radius={5.5 * Math.min(1.8, ts)} fill="#facc15" stroke="#000000" strokeWidth={getStrokeWidth(0.8, 0.8)} />
                        <Text x={-3 * Math.min(1.8, ts)} y={-4 * Math.min(1.8, ts)} text="R" fontSize={6 * Math.min(1.8, ts)} fill="#000000" fontStyle="bold" />
                      </Group>
                    )}
                  </Group>
                );
              })}

              {annotationVisibility.leaderCallout && (() => {
                const origin = units[0] || { x: maxX, y: minY };
                const leaderStartX = origin.x - unitFp.w / 2;
                const leaderStartY = origin.y - unitFp.d / 2;
                const calloutX = Math.max(maxX - 8 * k, leaderStartX + 3 * k);
                const calloutY = Math.min(minY - 3.5 * k, leaderStartY - 4 * k);
                return (
                  <Group>
                    <Line points={[calloutX - 0.5 * k, calloutY + 2 * k, leaderStartX, leaderStartY]} stroke="#facc15" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                    <Text
                      x={calloutX}
                      y={calloutY}
                      text={lines.join('\n')}
                      fontSize={Math.max(10 * ts, 11 / stageScale)}
                      fill="#facc15"
                      fontStyle="bold"
                    />
                  </Group>
                );
              })()}
            </Group>
          );
        })()}

        {/* Duct network: double-line runs with mitered elbows, tees and tapered reducers */}
        {ductRuns.map((run) => {
          const isReturn = run.network === 'return';
          const isTrunk = run.type === 'trunk';
          const casingColor = isReturn ? '#64748b' : isTrunk ? '#06b6d4' : '#38bdf8';
          const fillColor = isReturn ? 'rgba(100, 116, 139, 0.18)' : 'rgba(6, 182, 212, 0.18)';
          const centerColor = isReturn ? '#94a3b8' : '#22d3ee';
          return (
            <Group key={`run-${run.id}`} listening={false}>
              {annotationVisibility.ducts && (
                <>
                  <Line points={run.outline} closed fill={fillColor} strokeEnabled={false} />
                  {run.walls.map((w, i) => (
                    <Line key={i} points={w} stroke={casingColor} strokeWidth={getStrokeWidth(1.2, 1.4)} lineJoin="miter" />
                  ))}
                  {run.ticks.map((t, i) => (
                    <Line key={`t${i}`} points={t} stroke={casingColor} strokeWidth={getStrokeWidth(1.2, 1.4)} />
                  ))}
                </>
              )}
              {annotationVisibility.ductCenterlines && (
                <Line
                  points={run.center}
                  stroke={centerColor}
                  strokeWidth={getStrokeWidth(0.6, 1.0)}
                  dash={[6 / stageScale, 4 / stageScale]}
                  opacity={0.7}
                />
              )}
            </Group>
          );
        })}

        {/* Per-segment annotations: flow arrow only (size / CFM tags come from the shared label layout) */}
        {zone.ducts.map((d) => {
          const x1 = d.points[0], y1 = d.points[1], x2 = d.points[2], y2 = d.points[3];
          const dx = x2 - x1, dy = y2 - y1;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len, uy = dy / len;
          const nx = -uy, ny = ux;
          const hw = ductHalfWidthPx(d.widthIn, k);
          const ax = x1 + dx * 0.6, ay = y1 + dy * 0.6;
          const arrowLen = Math.min(Math.max(hw, 0.5 * k), len * 0.25);
          // Crossover: find where this duct crosses its partner(s) in plan (fallback: duct midpoint)
          let xo: { x: number; y: number } | null = null;
          if (d.crossover && annotationVisibility.ducts) {
            xo = { x: x1 + dx * 0.5, y: y1 + dy * 0.5 };
            for (const oid of d.crossoverWith ?? []) {
              const o = zone.ducts.find((q) => q.id === oid);
              if (!o) continue;
              const ex = o.points[2] - o.points[0], ey = o.points[3] - o.points[1];
              const den = dx * ey - dy * ex;
              if (Math.abs(den) < 1e-9) continue;
              const t = ((o.points[0] - x1) * ey - (o.points[1] - y1) * ex) / den;
              const u2 = ((o.points[0] - x1) * dy - (o.points[1] - y1) * dx) / den;
              if (t >= 0 && t <= 1 && u2 >= 0 && u2 <= 1) { xo = { x: x1 + dx * t, y: y1 + dy * t }; break; }
            }
          }
          const xoSpan = Math.min(len * 0.5, Math.max(hw * 2.5, 2 * k));
          return (
            <Group key={`ann-${d.id}`} listening={false}>
              {d.clearanceIssue && annotationVisibility.ducts && (
                <>
                  <Line
                    points={[
                      x1 + nx * hw, y1 + ny * hw, x2 + nx * hw, y2 + ny * hw,
                      x2 - nx * hw, y2 - ny * hw, x1 - nx * hw, y1 - ny * hw
                    ]}
                    closed
                    stroke="#f59e0b"
                    strokeWidth={getStrokeWidth(1.6, 1.8)}
                  />
                  <Text
                    x={x1 + dx * 0.5 + nx * (hw + 1 * k)}
                    y={y1 + dy * 0.5 + ny * (hw + 1 * k)}
                    text={`clearance: ${d.clearanceIssue}`}
                    fontSize={Math.max(8 * textScale, 9 / stageScale)}
                    fill="#f59e0b"
                    fontStyle="bold"
                  />
                </>
              )}
              {xo && (
                <>
                  <Line
                    points={[xo.x - ux * xoSpan / 2, xo.y - uy * xoSpan / 2, xo.x + ux * xoSpan / 2, xo.y + uy * xoSpan / 2]}
                    stroke="#f43f5e"
                    strokeWidth={getStrokeWidth(1.4, 1.6)}
                    dash={[4 / stageScale, 3 / stageScale]}
                  />
                  <Text
                    x={xo.x + nx * (hw + 0.5 * k)}
                    y={xo.y + ny * (hw + 0.5 * k)}
                    text="X-OVER"
                    fontSize={Math.max(8 * textScale, 9 / stageScale)}
                    fill="#f43f5e"
                    fontStyle="bold"
                  />
                </>
              )}
              {annotationVisibility.ducts && len > 2.5 * k && (
                <Line
                  points={[
                    ax - ux * arrowLen - nx * arrowLen * 0.45, ay - uy * arrowLen - ny * arrowLen * 0.45,
                    ax, ay,
                    ax - ux * arrowLen + nx * arrowLen * 0.45, ay - uy * arrowLen + ny * arrowLen * 0.45
                  ]}
                  stroke="#ffffff"
                  strokeWidth={getStrokeWidth(1.2, 1.4)}
                  lineCap="round"
                  lineJoin="round"
                />
              )}
            </Group>
          );
        })}

        {/* Diffusers / terminals at true face size */}
        {zone.diffusers.map((dif) => {
          const face = terminalFacePx(dif, k, project.units);
          const fw = face.w, fh = face.h;
          const isReturn = dif.type === 'return';
          const strokeCol = isReturn ? '#c084fc' : '#10b981';
          const hatchSp = Math.max(Math.min(fw, fh) / 4, 2 / stageScale);
          return (
            <Group
              key={dif.id}
              x={dif.x}
              y={dif.y}
              draggable={lodTier >= 2}
              onDragMove={(e) => snapNodeDuringDrag(e.target)}
              onDragEnd={(e) => commitDiffuser(zone.id, dif.id, e.target.x(), e.target.y())}
            >
              {/* full-face hit target: the terminal is grabbable anywhere on its face, incl. the centre */}
              <Rect x={-fw / 2} y={-fh / 2} width={fw} height={fh} fill="rgba(0,0,0,0.001)" />
              {isReturn ? (
                <Group>
                  {annotationVisibility.diffusers && (
                    <>
                      <Rect x={-fw / 2} y={-fh / 2} width={fw} height={fh} fill="rgba(88, 28, 135, 0.35)" stroke="#c084fc" strokeWidth={getStrokeWidth(1.2, 1.5)} />
                      {hatchSegments(fw, fh, hatchSp).map((s, i) => (
                        <Line key={i} points={s} stroke="#c084fc" strokeWidth={getStrokeWidth(0.5, 0.8)} listening={false} />
                      ))}
                    </>
                  )}
                </Group>
              ) : zone.systemType === 'high-wall' ? (
                <Group>
                  {annotationVisibility.diffusers && (() => {
                    const hf = unitFootprintPx('highwall', k, catalogDimsFor(zone.catalogModel));
                    return (
                      <>
                        <Rect x={-hf.w / 2} y={-hf.d / 2} width={hf.w} height={hf.d} fill="#6366f1" stroke="#818cf8" strokeWidth={getStrokeWidth(1.2, 1.6)} />
                        <Line points={[-hf.w * 0.4, hf.d * 0.15, hf.w * 0.4, hf.d * 0.15]} stroke="#ffffff" strokeWidth={getStrokeWidth(0.6, 1)} />
                        <Line points={[-hf.w * 0.3, hf.d / 2, -hf.w * 0.4, hf.d / 2 + hf.w * 0.3]} stroke="#f97316" strokeWidth={getStrokeWidth(0.8, 1.2)} />
                        <Line points={[0, hf.d / 2, 0, hf.d / 2 + hf.w * 0.38]} stroke="#f97316" strokeWidth={getStrokeWidth(0.8, 1.2)} />
                        <Line points={[hf.w * 0.3, hf.d / 2, hf.w * 0.4, hf.d / 2 + hf.w * 0.3]} stroke="#f97316" strokeWidth={getStrokeWidth(0.8, 1.2)} />
                      </>
                    );
                  })()}
                </Group>
              ) : (
                <Group>
                  {annotationVisibility.diffusers && (
                    <>
                      {/* Professional ceiling diffuser (CD) symbol: face, neck square, corner diagonals */}
                      <Rect x={-fw / 2} y={-fh / 2} width={fw} height={fh} fill="rgba(5, 150, 105, 0.3)" stroke={strokeCol} strokeWidth={getStrokeWidth(1.2, 1.5)} />
                      <Rect x={-fw * 0.3} y={-fh * 0.3} width={fw * 0.6} height={fh * 0.6} stroke={strokeCol} strokeWidth={getStrokeWidth(0.8, 1)} />
                      <Line points={[-fw / 2, -fh / 2, fw / 2, fh / 2]} stroke={strokeCol} strokeWidth={getStrokeWidth(0.6, 0.9)} />
                      <Line points={[-fw / 2, fh / 2, fw / 2, -fh / 2]} stroke={strokeCol} strokeWidth={getStrokeWidth(0.6, 0.9)} />
                    </>
                  )}
                  {annotationVisibility.throwRings && lodTier >= 3 && !!dif.throwT50Ft && dif.throwT50Ft > 0 && (
                    <Circle
                      radius={throwRadiusPx(dif.throwT50Ft, k)}
                      stroke="rgba(16, 185, 129, 0.35)"
                      strokeWidth={getStrokeWidth(0.5, 0.8)}
                      dash={[4 / stageScale, 3 / stageScale]}
                      listening={false}
                    />
                  )}
                </Group>
              )}
            </Group>
          );
        })}

        {/* Indoor units at catalog / realistic footprint */}
        {annotationVisibility.indoorUnits && units.map((pos, uIdx) => (
          <Group
            key={`unit-${zone.id}-${uIdx}`}
            x={pos.x}
            y={pos.y}
            draggable={lodTier >= 2}
            onDragMove={(e) => snapNodeDuringDrag(e.target)}
            onDragEnd={(e) => commitIndoorUnit(zone.id, uIdx, e.target.x(), e.target.y())}
          >
            {renderIndoorUnitSymbol(zone, uIdx, ts)}
            {unitOverload && unitOverload.overloaded[uIdx] && (
              <Group y={-unitFp.d / 2} listening={false}>
                <Group scaleX={1 / stageScale} scaleY={1 / stageScale}>
                  <Rect x={-62} y={-20} width={124} height={16} fill="#b91c1c" stroke="#fecaca" strokeWidth={0.8} cornerRadius={3} />
                  <Text x={-62} y={-20} width={124} height={16} align="center" verticalAlign="middle" wrap="none" fontSize={9} fontStyle="bold" fill="#ffffff"
                    text={`! ${formatAirflow(unitOverload.loads[uIdx], project.units)} > ${formatAirflow(unitOverload.capacity, project.units)}`} />
                </Group>
              </Group>
            )}
          </Group>
        ))}

        {/* Outdoor units */}
        {annotationVisibility.outdoorUnits && outdoors.map((oPos, oIdx) => (
          <Group
            key={`odu-${zone.id}-${oIdx}`}
            x={oPos.x}
            y={oPos.y}
            draggable={lodTier >= 2}
            onDragMove={(e) => snapNodeDuringDrag(e.target)}
            onDragEnd={(e) => commitOutdoorUnit(zone.id, oIdx, e.target.x(), e.target.y())}
          >
            {renderOutdoorUnitSymbol(ts, outdoorDimsFor(zone))}
          </Group>
        ))}

        {/* Collision-free labels: zone, one tag per terminal, one size tag per duct section */}
        {labels.map(renderLabelItem)}

        {renderDimensions(zone)}

        {/* Editable vertices (selected zone) */}
        {isSelected &&
          Array.from({ length: zone.points.length / 2 }).map((_, idx) => (
            <Circle
              key={`v-${zone.id}-${idx}`}
              x={zone.points[idx * 2]}
              y={zone.points[idx * 2 + 1]}
              radius={5 / stageScale}
              fill="#3b82f6"
              stroke="#ffffff"
              strokeWidth={getStrokeWidth(1.0, 1.2)}
              draggable
              onDragMove={(e) => {
                // Local preview only (no store write per move); the commit + relayout happens at dragEnd.
                snapNodeDuringDrag(e.target);
                const line = zoneLineNodes.get(zone.id);
                if (line) {
                  const pts = zone.points.slice();
                  pts[idx * 2] = e.target.x();
                  pts[idx * 2 + 1] = e.target.y();
                  line.points(pts);
                  line.getLayer()?.batchDraw();
                }
              }}
              onDragEnd={(e) => commitVertex(zone.id, idx, e.target.x(), e.target.y())}
            />
          ))}
      </Group>
    );
  };

  const renderPreview = (): React.JSX.Element | null => {
    if (!activePreview) return null;
    const ts = textScale;
    const eq = activePreview.manifest.equipment;
    return (
      <Group opacity={0.65} listening={false}>
        {activePreview.manifest.ducts.map((d) => {
          const fullW = 2 * ductHalfWidthPx(d.widthIn, k);
          return (
            <Group key={`prev-${d.id}`}>
              <Line
                points={d.points}
                stroke={d.type === 'return' ? '#94a3b8' : '#60a5fa'}
                strokeWidth={Math.max(fullW, 1.5 / stageScale)}
                opacity={0.5}
                lineCap="butt"
              />
              <Text
                x={(d.points[0] + d.points[2]) / 2}
                y={(d.points[1] + d.points[3]) / 2 - fullW / 2 - 10 * ts}
                text={`(Preview) ${formatDuctSize(d.widthIn, d.heightIn, project.units, d.shape === 'round')}`}
                fontSize={Math.max(6 * ts, 6 / stageScale)}
                fill="#60a5fa"
                fontStyle="bold"
              />
            </Group>
          );
        })}

        {activePreview.manifest.terminals.map((dif) => {
          const face = terminalFacePx(dif, k, project.units);
          return (
            <Group key={`prev-${dif.id}`} x={dif.x} y={dif.y}>
              <Rect
                x={-face.w / 2} y={-face.h / 2} width={face.w} height={face.h}
                fill="rgba(59, 130, 246, 0.4)" stroke="#3b82f6"
                strokeWidth={getStrokeWidth(1.2, 1.5)} dash={[3 / stageScale, 2 / stageScale]}
              />
              {!!dif.throwT50Ft && dif.throwT50Ft > 0 && (
                <Circle
                  radius={throwRadiusPx(dif.throwT50Ft, k)}
                  stroke="rgba(59, 130, 246, 0.35)"
                  strokeWidth={getStrokeWidth(0.8, 1.0)}
                  dash={[6 / stageScale, 4 / stageScale]}
                />
              )}
              <Text
                x={face.w / 2 + 3 * ts}
                y={-face.h / 2}
                text={`(Preview) ${terminalSizeLabel(dif, project.units)}\n${formatAirflow(dif.cfm, project.units)}`}
                fontSize={Math.max(7 * ts, 6.5 / stageScale)}
                fill="#93c5fd"
                fontStyle="bold"
              />
            </Group>
          );
        })}

        {eq.indoorUnit && (() => {
          const fp = unitFootprintPx(unitKindForSystem(activePreview.manifest.systemType), k, catalogDimsFor(eq.indoorUnit.model));
          return (
            <Group x={eq.indoorUnit.position.x} y={eq.indoorUnit.position.y}>
              <Rect
                x={-fp.w / 2} y={-fp.d / 2} width={fp.w} height={fp.d}
                fill="rgba(16, 185, 129, 0.35)" stroke="#10b981"
                strokeWidth={getStrokeWidth(1.5, 1.8)} dash={[4 / stageScale, 3 / stageScale]}
              />
              <Text
                x={-fp.w / 2} y={fp.d / 2 + 2 * ts}
                text={`PREVIEW: ${eq.indoorUnit.model}`}
                fontSize={Math.max(7 * ts, 6 / stageScale)} fill="#34d399" fontStyle="bold"
              />
            </Group>
          );
        })()}

        {eq.outdoorUnit && (() => {
          const fp = unitFootprintPx('odu', k, outdoorDimsFor(undefined, eq.outdoorUnit.model));
          return (
            <Group x={eq.outdoorUnit.position.x} y={eq.outdoorUnit.position.y}>
              <Rect
                x={-fp.w / 2} y={-fp.d / 2} width={fp.w} height={fp.d}
                fill="rgba(244, 63, 94, 0.35)" stroke="#f43f5e"
                strokeWidth={getStrokeWidth(1.5, 1.8)} dash={[4 / stageScale, 3 / stageScale]}
              />
              <Text
                x={-fp.w / 2} y={-fp.d / 2 - 10 * ts}
                text="PREVIEW ODU"
                fontSize={Math.max(7 * ts, 6 / stageScale)} fill="#f43f5e" fontStyle="bold"
              />
            </Group>
          );
        })()}
      </Group>
    );
  };

  const isPanActive = drawMode === 'pan' || isSpacePressed;
  const cursor = isPanActive ? (isPanning ? 'grabbing' : 'grab') : (drawMode === 'polyline' || (calib && calib.stage !== 'enter')) ? 'crosshair' : 'default';

  return (
    <div className="relative w-full h-[65vh] bg-[#0c0c0c] border border-neutral-800 rounded-3xl overflow-hidden shadow-inner flex flex-col">
      <div ref={containerRef} className="absolute inset-0">
        <Stage
          ref={stageRef}
          width={size.w}
          height={size.h}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePos.x}
          y={stagePos.y}
          onWheel={handleWheel}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onMouseDown={handleMouseDown}
          onClick={handleContentClick}
          onDblClick={handleDoubleClick}
          style={{ cursor }}
        >
          {/* Static underlay: grid + CAD geometry + CAD text (no hit testing) */}
          <Layer listening={false}>
            {renderGrid()}
            {dxfShapes}
            {renderDxfText()}
          </Layer>

          {/* Zone fills: BELOW terminals / units so a terminal is always hit before the zone polygon */}
          <Layer>{zones.map((z) => renderZoneFill(z))}</Layer>

          {/* MEP equipment, ducts, labels (terminals / units listen; the rest is non-interactive) */}
          <Layer>
            {zones.map((z) => renderZone(z))}
            {renderPreview()}
          </Layer>

          {/* Cursor / rubber band / snap marker: updated imperatively, never re-renders the drawing */}
          <Layer ref={cursorLayerRef} listening={false}>
            {tempPoints.length > 0 && (
              <Group>
                <Line points={tempPoints} stroke="#3b82f6" strokeWidth={getStrokeWidth(2.0, 2.0)} />
                {Array.from({ length: tempPoints.length / 2 }).map((_, idx) => (
                  <Circle
                    key={`t-v-${idx}`}
                    x={tempPoints[idx * 2]}
                    y={tempPoints[idx * 2 + 1]}
                    radius={(idx === 0 && tempPoints.length >= 6 ? 6 : 4) / stageScale}
                    fill={idx === 0 ? '#22c55e' : '#3b82f6'}
                  />
                ))}
              </Group>
            )}
            {calib?.p1 && (
              <Group>
                <Circle x={calib.p1.x} y={calib.p1.y} radius={4 / stageScale} fill="#f43f5e" />
                {calib.p2 && (
                  <>
                    <Circle x={calib.p2.x} y={calib.p2.y} radius={4 / stageScale} fill="#f43f5e" />
                    <Line points={[calib.p1.x, calib.p1.y, calib.p2.x, calib.p2.y]} stroke="#f43f5e" strokeWidth={getStrokeWidth(1.5, 1.5)} dash={[6 / stageScale, 4 / stageScale]} />
                  </>
                )}
              </Group>
            )}
            <Line ref={rubberRef} points={ZERO_PTS} stroke="#60a5fa" strokeWidth={1.5} visible={false} />
            <Rect ref={snapMarkerRef} width={9} height={9} stroke="#facc15" visible={false} />
            <Circle ref={cursorDotRef} radius={3} fill="#facc15" visible={false} />
          </Layer>
        </Stage>
      </div>

      {/* Top HUD Info Overlay */}
      <div className="absolute top-4 left-4 flex items-center gap-2 flex-wrap max-w-[calc(100%-2rem)]">
        <div className="bg-neutral-900/90 border border-neutral-800 px-3.5 py-1.5 rounded-xl text-[10px] text-neutral-400 font-medium backdrop-blur shadow flex items-center gap-2">
          <span>Zoom: <strong className="text-blue-400 font-mono">{Math.round(stageScale * 100)}%</strong></span>
          <span className="text-neutral-700">|</span>
          <span>LOD: <strong className="text-emerald-400 font-mono">T{lodTier}</strong></span>
          <span className="text-neutral-700">|</span>
          <span>Mode: <strong className="text-blue-500 capitalize">{drawMode}</strong></span>
          <span className="text-neutral-700">|</span>
          <div className="flex items-center gap-1">
            <span className="text-neutral-400">Text Size:</span>
            {[0.75, 1.0, 1.5, 2.0, 3.0].map((sc) => (
              <button
                key={sc}
                onClick={() => setProject({ equipmentScale: sc })}
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-all cursor-pointer ${
                  (project.equipmentScale || 1.5) === sc
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
                title={`Set annotation text/tag size to ${sc}x (equipment is always drawn at true physical size)`}
              >
                {sc}x
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => setSnapEnabled((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all shadow-lg backdrop-blur cursor-pointer border ${
            snapEnabled
              ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
              : 'bg-neutral-900/90 text-neutral-400 border-neutral-750'
          }`}
          title="Toggle snap (F9 or S): CAD endpoints / midpoints / vertices, then 1 ft (0.25 m) grid"
        >
          <Magnet size={13} />
          <span>Snap {snapEnabled ? 'ON' : 'OFF'}</span>
        </button>

        <button
          onClick={() => setDetailed((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all shadow-lg backdrop-blur cursor-pointer border ${
            detailed
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              : 'bg-neutral-900/90 text-neutral-400 border-neutral-750'
          }`}
          title="Detailed annotations: duct CFM / velocity and terminal NC (off = clean size-only tags)"
        >
          <span>Detailed {detailed ? 'ON' : 'OFF'}</span>
        </button>

        <button
          onClick={() => setIsLayerManagerOpen(!isLayerManagerOpen)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all shadow-lg backdrop-blur cursor-pointer ${
            isLayerManagerOpen
              ? 'bg-blue-600 text-white shadow-blue-500/25 border border-blue-400'
              : 'bg-neutral-900/90 hover:bg-neutral-800 text-neutral-200 hover:text-white border border-neutral-750'
          }`}
          title="Toggle DXF Layers and MEP Drawing Annotations"
        >
          <Layers size={13} className={isLayerManagerOpen ? 'text-white' : 'text-blue-400'} />
          <span>Layers & Annotations</span>
          {Object.values(dxfLayers).length > 0 && (
            <span className="bg-blue-500/20 text-blue-300 text-[9px] px-1.5 py-0.2 rounded-full font-mono border border-blue-400/30">
              {Object.values(dxfLayers).filter((l) => l.visible).length}/{Object.values(dxfLayers).length}
            </span>
          )}
        </button>
      </div>

      {cadCalibration?.needsCalibration && !bannerDismissed && !calib && (
        <div className="absolute top-16 left-4 flex items-center gap-2 bg-amber-950/90 border border-amber-600/60 text-amber-200 text-[11px] font-semibold px-3 py-1.5 rounded-xl shadow backdrop-blur">
          <Ruler size={13} className="text-amber-400" />
          <span>Drawing units unknown</span>
          <span className="text-amber-500">&mdash;</span>
          <button onClick={startCalibration} className="underline underline-offset-2 hover:text-white cursor-pointer">Calibrate</button>
          <select
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value as DrawingUnit;
              if (DRAWING_UNITS.includes(v)) calibrateCad(feetPerDrawingUnit(v));
            }}
            className="bg-amber-900/60 text-amber-100 rounded px-1 py-0.5 text-[10px] border border-amber-700/60"
            title="Or pick the drawing units directly"
          >
            <option value="" disabled>units...</option>
            {DRAWING_UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <button onClick={() => setBannerDismissed(true)} className="text-amber-400 hover:text-white cursor-pointer" title="Dismiss">
            <XIcon size={12} />
          </button>
        </div>
      )}

      {calib && (
        <div className="absolute top-16 left-4 flex items-center gap-2 bg-neutral-900/95 border border-rose-500/60 text-neutral-100 text-[11px] font-semibold px-3 py-1.5 rounded-xl shadow backdrop-blur">
          <Ruler size={13} className="text-rose-400" />
          {calib.stage === 'p1' && <span>Calibrate: click the first point on the drawing</span>}
          {calib.stage === 'p2' && <span>Calibrate: click the second point</span>}
          {calib.stage === 'enter' && (
            <>
              <span>Real distance</span>
              <input
                autoFocus
                type="number"
                min="0"
                step="any"
                value={calibDist}
                onChange={(e) => setCalibDist(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyCalibration(); }}
                className="w-24 bg-neutral-800 border border-neutral-600 rounded px-1.5 py-0.5 text-[11px] text-white"
              />
              <span className="text-neutral-400">{project.units === 'metric' ? 'm' : 'ft'}</span>
              <button onClick={applyCalibration} className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white cursor-pointer">Apply</button>
            </>
          )}
          <button onClick={() => setCalib(null)} className="text-neutral-400 hover:text-white cursor-pointer" title="Cancel (Esc)">
            <XIcon size={12} />
          </button>
        </div>
      )}

      {drawMessage && (
        <div className="absolute bottom-4 left-4 bg-red-900/90 border border-red-700 text-red-100 text-[11px] font-semibold px-3 py-1.5 rounded-xl shadow">
          {drawMessage}
        </div>
      )}

      <CadLayerManagerModal isOpen={isLayerManagerOpen} onClose={() => setIsLayerManagerOpen(false)} />

      {/* Viewport Floating Zoom Navigation Controls */}
      <div className="absolute bottom-4 right-4 flex items-center gap-1.5 bg-neutral-900/90 border border-neutral-800 p-1.5 rounded-2xl backdrop-blur-md shadow-2xl">
        <div className="flex items-center gap-1 px-1 text-[10px] text-neutral-400 font-medium border-r border-neutral-800 pr-2 mr-0.5">
          <span>Text:</span>
          <button
            onClick={() => setProject({ equipmentScale: Math.max(0.5, Math.round(((project.equipmentScale || 1.5) - 0.25) * 100) / 100) })}
            title="Decrease annotation text size"
            className="w-5 h-5 flex items-center justify-center bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded font-bold text-[11px] cursor-pointer"
          >
            -
          </button>
          <span className="text-cyan-400 font-mono font-bold min-w-[28px] text-center">
            {project.equipmentScale || 1.5}x
          </span>
          <button
            onClick={() => setProject({ equipmentScale: Math.min(5.0, Math.round(((project.equipmentScale || 1.5) + 0.25) * 100) / 100) })}
            title="Increase annotation text size"
            className="w-5 h-5 flex items-center justify-center bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded font-bold text-[11px] cursor-pointer"
          >
            +
          </button>
        </div>
        <button
          onClick={() => handleZoomBtn(1.25)}
          title="Zoom In (+)"
          className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg transition-colors cursor-pointer"
        >
          <ZoomIn size={14} />
        </button>
        <button
          onClick={() => handleZoomBtn(0.8)}
          title="Zoom Out (-)"
          className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg transition-colors cursor-pointer"
        >
          <ZoomOut size={14} />
        </button>
        <div className="w-[1px] h-4 bg-neutral-700 mx-0.5" />
        <button
          onClick={handleFitDesign}
          title="Fit Complete Design (CAD + all zones)"
          className="flex items-center gap-1 px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-[10px] font-semibold transition-colors cursor-pointer"
        >
          <Maximize2 size={12} />
          Fit All
        </button>
        <button
          onClick={handleFitSelection}
          title="Fit Selected Zone"
          className="flex items-center gap-1 px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg text-[10px] font-semibold transition-colors cursor-pointer"
        >
          <Target size={12} />
          Fit Zone
        </button>
        <button
          onClick={handleResetZoom}
          title="Reset Zoom to 100%"
          className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg transition-colors cursor-pointer"
        >
          <RotateCcw size={14} />
        </button>
      </div>
    </div>
  );
};
