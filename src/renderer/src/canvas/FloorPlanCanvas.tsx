import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Stage, Layer, Line, Circle, Text, Group, Shape, Rect } from 'react-konva';
import { useProjectStore } from '../store/projectStore';
import { snapToGrid, getPolygonCentroid } from '../engine/geometry';
import { snapPoint, physicalGridSpacing } from '../engine/cad/drawingSnap';
import { moveTerminal, moveIndoorUnit, moveOutdoorUnit, translateDuct, type ComponentEdit } from '../engine/cad/componentEdits';
import { METERS_PER_FOOT } from '../engine/engineeringInputs';
import type { Zone } from '../store/projectStore';
import { parseKnownLength, measuredDistance, describeCalibration } from '../engine/cad/measureTool';
import { polylineReducer, initialPolylineState, type PolylineEvent } from '../engine/cad/polylineTool';
import { calculateZoneDiffuserCoverage } from '../engine/diffuserPlacer';
import { calculateCanonicalZoneLoad, calculateZoneLoadSafely } from '../engine/loadCalc';
import { getCadEntityPath } from '../engine/cad/nativeGeometry';
import { groupCadEntitiesForRendering } from '../engine/cad/renderGroups';
import { getSupplyAirflowForDisplay } from '../engine/airflowDisplay';
import { routeOrthogonalRefrigerantPiping } from '../engine/spatialPlanner';
import { CadLayerManagerModal } from '../components/CadLayerManagerModal';
import Konva from 'konva';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, Target, Layers } from 'lucide-react';

export const FloorPlanCanvas: React.FC = () => {
  const {
    zones,
    selectedZoneId,
    drawMode,
    tempPoints,
    addZone,
    setTempPoints,
    moveZoneVertex,
    verifyZoneEdits,
    calibrateScaleFromPoints,
    selectZone,
    applyComponentEdit: applyStoreComponentEdit,
    project,
    setProject,
    dxfEntities,
    dxfBoundingBox,
    dxfLayers,
    annotationVisibility,
    activePreview,
    highlightedDuctId,
    highlightedEntityTag
  } = useProjectStore();

  const stageRef = useRef<Konva.Stage>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [stageScale, setStageScale] = useState<number>(1);
  const [stagePos, setStagePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const [isLayerManagerOpen, setIsLayerManagerOpen] = useState<boolean>(false);
  const lastPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageDimensions, setStageDimensions] = useState<{ width: number; height: number }>({ width: 900, height: 500 });

  const cadRenderGroups=useMemo(()=>groupCadEntitiesForRendering(dxfEntities,dxfLayers),[dxfEntities,dxfLayers]);

  // Memoized zone geometry, loads, piping, and coverage calculations to eliminate frame drops and freezing
  const zoneRenderData = useMemo(() => {
    return zones.map((zone) => {
      const isSelected = zone.id === selectedZoneId;
      const centroid = getPolygonCentroid(zone.points);
      const load = calculateZoneLoadSafely(zone, project).load;
      const coverage = calculateZoneDiffuserCoverage(
        zone.points,
        zone.diffusers,
        project.scale,
        project.units === 'imperial'
      );

      const unitList = zone.unitPositions && zone.unitPositions.length > 0
        ? zone.unitPositions
        : zone.unitPos
        ? [zone.unitPos]
        : [];

      const outdoorList = zone.outdoorUnitPositions && zone.outdoorUnitPositions.length > 0
        ? zone.outdoorUnitPositions
        : zone.outdoorUnitPos
        ? [zone.outdoorUnitPos]
        : [];

      const pipingList = unitList.map((uPos, uIdx) => {
        const oPos = outdoorList[uIdx] || outdoorList[0] || { x: uPos.x + 35, y: uPos.y + 35 };
        return routeOrthogonalRefrigerantPiping(oPos, [uPos]);
      });

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      if (zone.points && zone.points.length >= 2) {
        for (let i = 0; i < zone.points.length; i += 2) {
          if (zone.points[i] < minX) minX = zone.points[i];
          if (zone.points[i] > maxX) maxX = zone.points[i];
          if (zone.points[i + 1] < minY) minY = zone.points[i + 1];
          if (zone.points[i + 1] > maxY) maxY = zone.points[i + 1];
        }
      }
      if (minX === Infinity || maxX === -Infinity) {
        minX = 0; maxX = 100; minY = 0; maxY = 100;
      }

      return {
        zone,
        isSelected,
        centroid,
        load,
        coverage,
        unitList,
        outdoorList,
        pipingList,
        minX,
        maxX,
        minY,
        maxY
      };
    });
  }, [zones, selectedZoneId, project]);

  useEffect(() => {
    if (!containerRef.current) return;
    const updateDimensions = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        if (clientWidth > 50 && clientHeight > 50) {
          setStageDimensions({ width: clientWidth, height: clientHeight });
        }
      }
    };
    updateDimensions();
    const ro = new ResizeObserver(updateDimensions);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Determine Level of Detail (LOD) tier from scale
  const getLodTier = (scale: number): 1 | 2 | 3 | 4 => {
    if (scale < 0.35) return 1; // Far / Overview
    if (scale < 1.25) return 2; // Medium / Layout
    if (scale < 3.50) return 3; // Near / Engineering details
    return 4;                   // Editing / Micro precision
  };

  const lodTier = getLodTier(stageScale);

  // Minimum screen-space stroke width helper
  const getStrokeWidth = useCallback((physicalWidth: number, minPixels: number = 1.2) => {
    return Math.max(physicalWidth, minPixels / stageScale);
  }, [stageScale]);

  // Fit view to entire design
  const handleFitDesign = useCallback(() => {
    const stageWidth = stageDimensions.width;
    const stageHeight = stageDimensions.height;

    if (dxfBoundingBox) {
      const dxfWidth = dxfBoundingBox.maxX - dxfBoundingBox.minX;
      const dxfHeight = dxfBoundingBox.maxY - dxfBoundingBox.minY;

      if (dxfWidth > 0 && dxfHeight > 0) {
        const scaleX = stageWidth / dxfWidth;
        const scaleY = stageHeight / dxfHeight;
        const newScale = Math.min(scaleX, scaleY) * 0.85;

        const centerX = dxfBoundingBox.minX + dxfWidth / 2;
        const centerY = dxfBoundingBox.minY + dxfHeight / 2;

        setStageScale(newScale);
        setStagePos({
          x: stageWidth / 2 - centerX * newScale,
          y: stageHeight / 2 - centerY * newScale
        });
        return;
      }
    }

    if (zones.length > 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      zones.forEach((z) => {
        const numPoints = z.points.length / 2;
        for (let i = 0; i < numPoints; i++) {
          const x = z.points[i * 2];
          const y = z.points[i * 2 + 1];
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if (z.outdoorUnitPos) {
          if (z.outdoorUnitPos.x < minX) minX = z.outdoorUnitPos.x;
          if (z.outdoorUnitPos.x > maxX) maxX = z.outdoorUnitPos.x;
          if (z.outdoorUnitPos.y < minY) minY = z.outdoorUnitPos.y;
          if (z.outdoorUnitPos.y > maxY) maxY = z.outdoorUnitPos.y;
        }
      });

      const zonesWidth = Math.max(100, maxX - minX);
      const zonesHeight = Math.max(100, maxY - minY);

      const scaleX = stageWidth / zonesWidth;
      const scaleY = stageHeight / zonesHeight;
      const newScale = Math.min(scaleX, scaleY) * 0.70;

      const centerX = minX + zonesWidth / 2;
      const centerY = minY + zonesHeight / 2;

      setStageScale(newScale);
      setStagePos({
        x: stageWidth / 2 - centerX * newScale,
        y: stageHeight / 2 - centerY * newScale
      });
    }
  }, [dxfBoundingBox, zones, stageDimensions]);

  // Fit view to selected zone
  const handleFitSelection = useCallback(() => {
    const selectedZone = zones.find(z => z.id === selectedZoneId);
    if (!selectedZone || selectedZone.points.length < 6) {
      handleFitDesign();
      return;
    }

    const stageWidth = stageDimensions.width;
    const stageHeight = stageDimensions.height;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const numPoints = selectedZone.points.length / 2;
    for (let i = 0; i < numPoints; i++) {
      const x = selectedZone.points[i * 2];
      const y = selectedZone.points[i * 2 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const zWidth = Math.max(50, maxX - minX);
    const zHeight = Math.max(50, maxY - minY);

    const scaleX = stageWidth / zWidth;
    const scaleY = stageHeight / zHeight;
    const newScale = Math.min(scaleX, scaleY) * 0.65;

    const centerX = minX + zWidth / 2;
    const centerY = minY + zHeight / 2;

    setStageScale(newScale);
    setStagePos({
      x: stageWidth / 2 - centerX * newScale,
      y: stageHeight / 2 - centerY * newScale
    });
  }, [selectedZoneId, zones, handleFitDesign]);

  const hasAutoFittedRef = useRef<boolean>(false);

  // Auto-fit ONLY on initial mount or when a new CAD drawing/bounding box is loaded
  useEffect(() => {
    if (!hasAutoFittedRef.current && (zones.length > 0 || dxfBoundingBox)) {
      handleFitDesign();
      hasAutoFittedRef.current = true;
    }
  }, [dxfBoundingBox, handleFitDesign, zones.length]);

  // Global keyboard listener for Spacebar panning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Global mouseup listener for middle click & spacebar panning
  useEffect(() => {
    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (e.button === 1 || e.button === 0) {
        if (isPanning) {
          setIsPanning(false);
          const container = stageRef.current?.container();
          if (container) {
            container.style.cursor = drawMode === 'pan' || isSpacePressed ? 'grab' : drawMode === 'polyline' ? 'crosshair' : 'default';
          }
        }
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [drawMode, isPanning, isSpacePressed]);

  // Physical grid: 0.5 ft (imperial) / 100 mm (metric) expressed in drawing units, whatever the CAD unit is.
  const gridSpacing = useMemo(() => { try { return physicalGridSpacing(project); } catch { return 10; } }, [project.units, project.scale]);
  const snapLocal = (local: { x: number; y: number }, shift: boolean) => snapPoint(local, {
    entities: dxfEntities, zones, gridSpacing, tolerancePx: 10, stageScale,
    ortho: shift, lastPoint: tempPoints.length >= 2 ? { x: tempPoints[tempPoints.length - 2], y: tempPoints[tempPoints.length - 1] } : undefined
  }).point;

  // Room-outline tool: all decisions live in the pure polylineReducer; this only feeds it events.
  const [drawMessage, setDrawMessage] = useState<string | null>(null);
  const [typedLength, setTypedLength] = useState<string>('');
  const applyPolyline = (event: PolylineEvent) => {
    const state = { ...initialPolylineState({ units: project.units, scale: project.scale }, 8 / stageScale), points: tempPoints, cursor: mousePos };
    const next = polylineReducer(state, event);
    if (next.committed) {
      const result = addZone(next.committed);
      setDrawMessage(result.success ? null : `Room not created: ${result.error}`);
      return;
    }
    if (next.points !== tempPoints) setTempPoints(next.points);
    setDrawMessage(next.message);
  };
  useEffect(() => { setDrawMessage(null); setTypedLength(''); }, [drawMode, selectedZoneId]);
  // Measure / calibrate tool: two picks, then an explicit confirmation before the store rewrites the scale.
  const [measurePoints, setMeasurePoints] = useState<{ x: number; y: number }[]>([]);
  const [measureInput, setMeasureInput] = useState<string>('');
  useEffect(() => { setMeasurePoints([]); setMeasureInput(''); }, [drawMode]);
  const confirmCalibration = () => {
    if (measurePoints.length !== 2) return;
    const parsed = parseKnownLength(measureInput, project.units === 'metric' ? 'm' : 'ft');
    if (!parsed.ok) { setDrawMessage(parsed.error); return; }
    const result = calibrateScaleFromPoints(measurePoints[0], measurePoints[1], parsed.length, parsed.unit);
    setDrawMessage(result.success ? `Scale calibrated: segment = ${parsed.length} ${parsed.unit}. Rooms are stale; re-run design.` : `Calibration refused: ${result.error}`);
    if (result.success) { setMeasurePoints([]); setMeasureInput(''); }
  };
  const applyPolylineRef = useRef(applyPolyline);
  applyPolylineRef.current = applyPolyline;
  const typedLengthRef = useRef(typedLength);
  typedLengthRef.current = typedLength;
  const drawModeRef = useRef(drawMode);
  drawModeRef.current = drawMode;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (drawModeRef.current !== 'polyline' || ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      const buffer = typedLengthRef.current;
      if (/^[0-9.]$/.test(e.key)) { setTypedLength(buffer + e.key); return; }
      if (e.key === 'Backspace') { e.preventDefault(); if (buffer) setTypedLength(buffer.slice(0, -1)); else applyPolylineRef.current({ type: 'backspace' }); }
      else if (e.key === 'Escape') { setTypedLength(''); applyPolylineRef.current({ type: 'escape' }); }
      else if (e.key === 'Enter') {
        setTypedLength('');
        if (buffer) applyPolylineRef.current({ type: 'typedLength', length: Number(buffer) });
        else applyPolylineRef.current({ type: 'enter' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;

    if (drawMode === 'polyline' || (drawMode === 'measure' && measurePoints.length === 1)) {
      const transform = stage.getAbsoluteTransform().copy().invert();
      const pos = stage.getPointerPosition();
      if (pos) {
        const localPos = transform.point(pos);
        const { x: snappedX, y: snappedY } = snapLocal(localPos, e.evt.shiftKey);
        setMousePos((prev) => {
          if (prev.x === snappedX && prev.y === snappedY) return prev;
          return { x: snappedX, y: snappedY };
        });
      }
    }

    if (isPanning) {
      const dx = e.evt.clientX - lastPosRef.current.x;
      const dy = e.evt.clientY - lastPosRef.current.y;
      setStagePos((prev) => ({
        x: prev.x + dx,
        y: prev.y + dy
      }));
      lastPosRef.current = { x: e.evt.clientX, y: e.evt.clientY };
    }
  };

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // Middle click pan OR Left click when Spacebar is held OR Left click in 'pan' mode
    if (e.evt.button === 1 || (e.evt.button === 0 && (isSpacePressed || drawMode === 'pan'))) {
      e.evt.preventDefault();
      setIsPanning(true);
      lastPosRef.current = { x: e.evt.clientX, y: e.evt.clientY };
      const container = stageRef.current?.container();
      if (container) {
        container.style.cursor = 'grabbing';
      }
    }
  };

  const handleContentClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0 || isSpacePressed || drawMode === 'pan') return;

    if (drawMode === 'measure' && measurePoints.length < 2) {
      const stage = stageRef.current;
      const pos = stage?.getPointerPosition();
      if (!stage || !pos) return;
      const local = stage.getAbsoluteTransform().copy().invert().point(pos);
      const picked = snapPoint(local, { entities: dxfEntities, zones, gridSpacing, tolerancePx: 10, stageScale, ortho: e.evt.shiftKey, lastPoint: measurePoints[0] }).point;
      if (measurePoints.length === 1 && measuredDistance(measurePoints[0], picked) === 0) { setDrawMessage('Pick a second point away from the first.'); return; }
      setMeasurePoints([...measurePoints, picked]);
      setDrawMessage(null);
      return;
    }
    if (drawMode === 'polyline') {
      const stage = stageRef.current;
      if (!stage) return;
      const transform = stage.getAbsoluteTransform().copy().invert();
      const pos = stage.getPointerPosition();
      if (pos) {
        const localPos = transform.point(pos);
        const { x: sx, y: sy } = snapLocal(localPos, e.evt.shiftKey);
        applyPolyline({ type: 'click', x: sx, y: sy });
      }
    }
  };

  const handleDoubleClick = () => {
    if (drawMode === 'polyline' && tempPoints.length >= 6) applyPolyline({ type: 'enter' });
  };

  // Continuous smooth exponential cursor-anchored zooming
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stageScale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };

    // Sub-pixel continuous zoom response for wheels and trackpads
    const delta = e.evt.deltaY;
    const zoomFactor = Math.exp(-delta * 0.0018);
    let newScale = oldScale * zoomFactor;
    newScale = Math.min(Math.max(newScale, 0.01), 50.0);

    setStageScale(newScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  const handleZoomBtn = (factor: number) => {
    const stageWidth = 900;
    const stageHeight = 500;
    const centerPoint = {
      x: (stageWidth / 2 - stagePos.x) / stageScale,
      y: (stageHeight / 2 - stagePos.y) / stageScale
    };

    let newScale = stageScale * factor;
    newScale = Math.min(Math.max(newScale, 0.04), 25.0);

    setStageScale(newScale);
    setStagePos({
      x: stageWidth / 2 - centerPoint.x * newScale,
      y: stageHeight / 2 - centerPoint.y * newScale
    });
  };

  const handleResetZoom = () => {
    setStageScale(1.0);
    setStagePos({ x: 50, y: 50 });
  };

  // Validated outline edit (store action); returns false when refused so the caller can snap the handle back.
  const handleVertexDrag = (zoneId: string, pointIdx: number, newX: number, newY: number): boolean => {
    const result = moveZoneVertex(zoneId, pointIdx, snapToGrid(newX, gridSpacing), snapToGrid(newY, gridSpacing));
    setDrawMessage(result.success ? null : `Edit refused: ${result.error}`);
    return result.success;
  };

  // Component drags: all geometry/attachment rules live in engine/cad/componentEdits (pure, validated).
  const editContext = { drawingUnitsPerFoot: project.scale * (project.units === 'metric' ? METERS_PER_FOOT : 1) };
  const applyComponentEdit = (zoneId: string, build: (zone: Zone) => ComponentEdit): boolean => {
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return false;
    const result = applyStoreComponentEdit(zoneId, build(zone));
    if (!result.success) { setDrawMessage(`Edit refused: ${result.error}`); return false; }
    setDrawMessage(`Layout edited and marked stale; verify before relying on it.${result.warnings?.length ? ' ' + result.warnings.join(' ') : ''}`);
    return true;
  };
  const handleDiffuserDrag = (zoneId: string, diffuserId: string, newX: number, newY: number): boolean =>
    applyComponentEdit(zoneId, zone => moveTerminal(zone, diffuserId, snapToGrid(newX, gridSpacing), snapToGrid(newY, gridSpacing), editContext));
  const handleDuctDrag = (zoneId: string, ductId: string, deltaX: number, deltaY: number): boolean =>
    applyComponentEdit(zoneId, zone => translateDuct(zone, ductId, snapToGrid(deltaX, gridSpacing), snapToGrid(deltaY, gridSpacing), editContext));
  const handleIndoorUnitDrag = (zoneId: string, newX: number, newY: number, uIdx: number = 0): boolean =>
    applyComponentEdit(zoneId, zone => moveIndoorUnit(zone, uIdx, snapToGrid(newX, gridSpacing), snapToGrid(newY, gridSpacing), editContext));
  const handleOutdoorUnitDrag = (zoneId: string, newX: number, newY: number, oIdx: number = 0): boolean =>
    applyComponentEdit(zoneId, zone => moveOutdoorUnit(zone, oIdx, snapToGrid(newX, gridSpacing), snapToGrid(newY, gridSpacing)));

  // Draw background grid lines with scale adjustment
  const drawGridLines = () => {
    if (!annotationVisibility.grid || lodTier === 1) return null; // Declutter grid at far zoom or if hidden
    const lines: React.ReactNode[] = [];
    const step = gridSpacing * 5;
    const size = step * 60;
    for (let k = -60; k < 60; k++) {
      const i = k * step;
      const isMajor = k % 5 === 0;
      const strokeColor = isMajor ? '#2c2c2c' : '#1a1a1a';
      const strokeWidth = getStrokeWidth(isMajor ? 0.8 : 0.4, 0.5);

      lines.push(
        <Line key={`h-${i}`} points={[-size, i, size, i]} stroke={strokeColor} strokeWidth={strokeWidth} />,
        <Line key={`v-${i}`} points={[i, -size, i, size]} stroke={strokeColor} strokeWidth={strokeWidth} />
      );
    }
    return lines;
  };

  const isPanActive = drawMode === 'pan' || isSpacePressed;

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-0 bg-[#0a0a0a] overflow-hidden flex flex-col flex-1 select-none">
      <Stage
        ref={stageRef}
        width={stageDimensions.width}
        height={stageDimensions.height}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        draggable={isPanActive}
        onWheel={handleWheel}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onDragEnd={(e) => {
          if (e.target === e.currentTarget) {
            setStagePos({ x: e.target.x(), y: e.target.y() });
          }
        }}
        onClick={handleContentClick}
        onDblClick={handleDoubleClick}
        style={{ cursor: isPanActive ? (isPanning ? 'grabbing' : 'grab') : drawMode === 'polyline' || drawMode === 'measure' ? 'crosshair' : 'default' }}
      >
        <Layer>
          {drawGridLines()}

          {/* DXF CAD Underlay Geometry (Layer-by-Layer with Visibility & Native CAD Colors) */}
          {cadRenderGroups.map(group=><Shape key={group.key} stroke={group.color} strokeWidth={getStrokeWidth(0.8,1.0)}
            sceneFunc={(context,shape)=>{
              context.save();context.beginPath();
              for(const ent of group.entities) {
                const points=getCadEntityPath(ent,{maxSagitta:0.5/stageScale,maxSegments:512});
                if(points.length<4)continue;
                context.moveTo(points[0],points[1]);
                for(let i=2;i<points.length;i+=2)context.lineTo(points[i],points[i+1]);
              }
              context.fillStrokeShape(shape);context.restore();
            }} hitFunc={()=>{}} opacity={0.65}/>)}

          {/* DXF CAD Text elements (LOD Tier 2+ and visibility controlled) */}
          {annotationVisibility.dxfText && dxfEntities.length > 0 && lodTier >= 2 && (
            <Shape
              sceneFunc={(context) => {
                context.save();
                context.fillStyle = '#94a3b8';
                const fontSize = Math.max(7, 9 / stageScale);
                context.font = `${fontSize}px sans-serif`;

                for (const ent of dxfEntities) {
                  const isLayerVis = !ent.layer || dxfLayers[ent.layer]?.visible !== false;
                  if (isLayerVis && (ent.type === 'TEXT' || ent.type === 'MTEXT') && ent.text) {
                    context.save();
                    context.translate(ent.x ?? 0,ent.y ?? 0);
                    context.rotate(-(ent.rotationDeg ?? 0)*Math.PI/180);
                    context.font=`${ent.textHeight ?? fontSize}px sans-serif`;
                    context.fillStyle=ent.color??dxfLayers[ent.layer??'0']?.color??'#94a3b8';
                    context.fillText(ent.text,0,0);
                    context.restore();
                  }
                }
                context.restore();
              }}
              hitFunc={() => {}}
              opacity={0.65}
            />
          )}

          {/* Zones Rendering */}
          {zoneRenderData.map((item) => {
            const { zone, isSelected, centroid, load, unitList, outdoorList, pipingList, maxX, minY } = item;

            const eqScale = project.equipmentScale || 1.5;
            // Proportion symbol scale to project scale so diffusers match physical CAD dimensions
            const scaleMultiplier = (project.scale && project.scale > 30) ? (project.scale / 10) : 1.0;
            const symScale = Math.max(1.2, scaleMultiplier) * eqScale;

            return (
              <Group key={zone.id}>
                {/* Zone Area Polygon */}
                <Line
                  points={zone.points}
                  closed
                  fill={isSelected ? 'rgba(59, 130, 246, 0.18)' : 'rgba(255, 255, 255, 0.03)'}
                  stroke={isSelected ? '#3b82f6' : '#525252'}
                  strokeWidth={getStrokeWidth(isSelected ? 2.5 : 1.2, isSelected ? 2.5 : 1.5)}
                  onClick={() => selectZone(zone.id)}
                  onTap={() => selectZone(zone.id)}
                />

                {/* Orthogonal Solid Copper Refrigerant Line Sets & Master Yellow MEP Engineering Callout */}
                {(() => {
                  if (!load || (unitList.length === 0 && outdoorList.length === 0)) return null;

                  const canonicalLoad = calculateCanonicalZoneLoad(zone, project);
                  const totalBtu = canonicalLoad.totalLoad;
                  const qty = zone.catalogQty || unitList.length || 1;
                  const btuPerUnit = Math.round(totalBtu / Math.max(1, qty));
                  const supplyDiffusers = zone.diffusers.filter((d) => d.type !== 'return' && d.type !== 'exhaust');
                  const returnDiffusers = zone.diffusers.filter((d) => d.type === 'return');
                  const cfmPerUnit = Math.round((zone.diffusers.length > 0 ? supplyDiffusers.reduce((s, d) => s + d.cfm, 0) : canonicalLoad.supplyCfm) / Math.max(1, qty));
                  const supplyDiffuserCfmEach = supplyDiffusers.length > 0 ? supplyDiffusers[0].cfm : 0;
                  const freshAirCfm = Math.round(canonicalLoad.oaCfm);

                  const sysLabel = zone.systemType === 'cassette'
                    ? 'CASSETTE SPLIT'
                    : zone.systemType === 'high-wall'
                    ? 'HIGH WALL SPLIT'
                    : zone.systemType === 'packaged'
                    ? 'PACKAGE UNIT'
                    : zone.systemType === 'ahu'
                    ? 'CENTRAL AHU'
                    : zone.systemType === 'fcu'
                    ? 'DUCTED FCU'
                    : 'CONCEALED SPLIT';

                  return (
                    <Group>
                      {/* Copper Line Set for each pair of indoor unit and outdoor ACU */}
                      {annotationVisibility.refrigerantPiping && pipingList.map((piping, uIdx) => (
                        <Group key={`piping-set-${zone.id}-${uIdx}`}>
                          {piping.segments.map((seg, sIdx) => (
                            <Line
                              key={`ref-seg-${zone.id}-${uIdx}-${sIdx}`}
                              points={seg}
                              stroke="#f97316"
                              strokeWidth={getStrokeWidth(2.6 * Math.min(1.8, symScale), 2.5)}
                              lineCap="round"
                              lineJoin="round"
                            />
                          ))}

                          {/* Yellow Circular Isolator Tag (R) along pipe */}
                          {piping.isolatorPos && (
                            <Group x={piping.isolatorPos.x} y={piping.isolatorPos.y}>
                              <Circle
                                x={0}
                                y={0}
                                radius={5.5 * Math.min(1.8, symScale)}
                                fill="#facc15"
                                stroke="#000000"
                                strokeWidth={getStrokeWidth(0.8, 0.8)}
                              />
                              <Text
                                x={-3 * Math.min(1.8, symScale)}
                                y={-4 * Math.min(1.8, symScale)}
                                text="R"
                                fontSize={6 * Math.min(1.8, symScale)}
                                fill="#000000"
                                fontStyle="bold"
                              />
                            </Group>
                          )}
                        </Group>
                      ))}

                      {/* Master Yellow Engineering Callout Tag with Leader Line (Matching Reference CAD Drawing) */}
                      {annotationVisibility.leaderCallout && (() => {
                        const calloutOrigin = unitList[0] || { x: maxX, y: minY };
                        const leaderStartX = calloutOrigin.x - 20 * symScale;
                        const leaderStartY = calloutOrigin.y - 10 * symScale;
                        const calloutX = Math.max(maxX - 80, leaderStartX + 30);
                        const calloutY = Math.min(minY - 35, leaderStartY - 40);

                        return (
                          <Group>
                            <Line
                              points={[calloutX - 5, calloutY + 20, leaderStartX, leaderStartY]}
                              stroke="#facc15"
                              strokeWidth={getStrokeWidth(1.2, 1.2)}
                            />
                            <Text
                              x={calloutX}
                              y={calloutY}
                              text={`${qty}-${sysLabel}\n${btuPerUnit.toLocaleString()} BTU/HR-EACH\n${cfmPerUnit} CFM-EACH\n${supplyDiffusers.length || 12}-S.C.D 12"X12"\n${supplyDiffuserCfmEach} CFM-EACH\n${returnDiffusers.length || 12}-R.C.D 12"X12"\nFA ${freshAirCfm} CFM`}
                              fontSize={Math.max(12 * symScale, 11 / stageScale)}
                              fill="#facc15"
                              fontStyle="bold"
                            />
                          </Group>
                        );
                      })()}
                    </Group>
                  );
                })()}

                {/* Duct Network (Double-Line Physical Walls, Flow Arrows & Inline CFM Badges) */}
                {zone.ducts.map((d) => {
                  const x1 = d.points[0];
                  const y1 = d.points[1];
                  const x2 = d.points[2];
                  const y2 = d.points[3];
                  const dx = x2 - x1;
                  const dy = y2 - y1;
                  const len = Math.hypot(dx, dy) || 1;
                  const nx = -dy / len;
                  const ny = dx / len;

                  // Half width in world coordinates - scaled accurately to physical dimensions
                  const realHw = ((d.widthIn || 12) / 24) * (project.scale || 10);
                  const hw = Math.max(1.8 / stageScale, Math.min(realHw, 8.0 / stageScale));
                  const isReturn = d.type === 'return';
                  const isTrunk = d.type === 'trunk';

                  const isDuctHighlighted =
                    highlightedDuctId === d.id ||
                    highlightedEntityTag === d.id ||
                    (highlightedEntityTag && (
                      (highlightedEntityTag.toUpperCase().includes('TRK') && d.type === 'trunk') ||
                      (highlightedEntityTag.toUpperCase().includes('MAIN') && d.type === 'trunk') ||
                      (highlightedEntityTag.toUpperCase().includes('BR') && d.type === 'branch') ||
                      (highlightedEntityTag.toUpperCase().includes('RET') && d.type === 'return')
                    ));

                  const casingColor = isDuctHighlighted
                    ? '#fbbf24'
                    : isReturn
                    ? '#64748b'
                    : isTrunk
                    ? '#06b6d4'
                    : '#38bdf8';

                  const fillColor = isDuctHighlighted
                    ? 'rgba(245, 158, 11, 0.40)'
                    : isReturn
                    ? 'rgba(100, 116, 139, 0.18)'
                    : 'rgba(6, 182, 212, 0.18)';

                  const centerColor = isDuctHighlighted ? '#fbbf24' : isReturn ? '#94a3b8' : '#22d3ee';

                  const mx = (x1 + x2) / 2;
                  const my = (y1 + y2) / 2;

                  // Midpoint for flow arrow (60% along segment)
                  const ax = x1 + dx * 0.6;
                  const ay = y1 + dy * 0.6;
                  const ux = dx / len;
                  const uy = dy / len;
                  const arrowLen = Math.min(12 * symScale, len * 0.25);

                  const vel = d.velocityFpm || Math.round(d.cfm / Math.max(0.1, (d.widthIn * d.heightIn) / 144));

                  return (
                    <Group
                      key={d.id}
                      // Only a supply trunk is a meaningful handle (it moves with its unit); branch and return ends are fixed by their terminals.
                      draggable={d.type === 'trunk' && (drawMode === 'select' || isSelected)}
                      onDragEnd={(e) => {
                        handleDuctDrag(zone.id, d.id, e.target.x(), e.target.y());
                        e.target.position({ x: 0, y: 0 });
                      }}
                    >
                      {/* Highlight Outer Glow Halo */}
                      {isDuctHighlighted && (
                        <Line
                          points={[
                            x1 + nx * (hw + 5 * symScale), y1 + ny * (hw + 5 * symScale),
                            x2 + nx * (hw + 5 * symScale), y2 + ny * (hw + 5 * symScale),
                            x2 - nx * (hw + 5 * symScale), y2 - ny * (hw + 5 * symScale),
                            x1 - nx * (hw + 5 * symScale), y1 - ny * (hw + 5 * symScale)
                          ]}
                          closed
                          fill="rgba(245, 158, 11, 0.25)"
                          stroke="#f59e0b"
                          strokeWidth={getStrokeWidth(2.5, 2.5)}
                          dash={[6, 3]}
                        />
                      )}

                      {/* Filled Duct Body Polygon */}
                      {annotationVisibility.ducts && (
                        <>
                          <Line
                            points={[
                              x1 + nx * hw, y1 + ny * hw,
                              x2 + nx * hw, y2 + ny * hw,
                              x2 - nx * hw, y2 - ny * hw,
                              x1 - nx * hw, y1 - ny * hw
                            ]}
                            closed
                            fill={fillColor}
                            stroke={casingColor}
                            strokeWidth={getStrokeWidth(isDuctHighlighted ? 2.8 : 1.6, isDuctHighlighted ? 2.8 : 1.6)}
                          />
                          {/* Transition Flange Lines at start and end */}
                          <Line
                            points={[x1 + nx * (hw + 1), y1 + ny * (hw + 1), x1 - nx * (hw + 1), y1 - ny * (hw + 1)]}
                            stroke={casingColor}
                            strokeWidth={getStrokeWidth(1.4, 1.4)}
                          />
                          <Line
                            points={[x2 + nx * (hw + 1), y2 + ny * (hw + 1), x2 - nx * (hw + 1), y2 - ny * (hw + 1)]}
                            stroke={casingColor}
                            strokeWidth={getStrokeWidth(1.4, 1.4)}
                          />
                        </>
                      )}

                      {/* Centerline Axis */}
                      {annotationVisibility.ductCenterlines && (
                        <Line
                          points={[x1, y1, x2, y2]}
                          stroke={centerColor}
                          strokeWidth={getStrokeWidth(isDuctHighlighted ? 1.6 : 1.0, isDuctHighlighted ? 1.6 : 1.0)}
                          dash={[6, 4]}
                        />
                      )}

                      {/* Directional Flow Chevron Arrow (along duct centerline) */}
                      {annotationVisibility.ducts && len > 25 && (
                        <Line
                          points={[
                            ax - ux * arrowLen - ny * (arrowLen * 0.45),
                            ay - uy * arrowLen + nx * (arrowLen * 0.45),
                            ax,
                            ay,
                            ax - ux * arrowLen + ny * (arrowLen * 0.45),
                            ay - uy * arrowLen - nx * (arrowLen * 0.45)
                          ]}
                          stroke="#ffffff"
                          strokeWidth={getStrokeWidth(1.4, 1.4)}
                          lineCap="round"
                          lineJoin="round"
                        />
                      )}

                      {/* Bright Yellow CFM Callout directly along duct branch with clean background */}
                      {annotationVisibility.ductCfm && (
                        <Group x={mx - 25 * symScale} y={my - (hw + 14 * symScale)}>
                          <Rect
                            x={-2}
                            y={-1}
                            width={54 * symScale}
                            height={14 * symScale}
                            fill="rgba(15, 23, 42, 0.95)"
                            stroke={isDuctHighlighted ? '#fbbf24' : '#eab308'}
                            strokeWidth={0.6}
                            cornerRadius={2}
                          />
                          <Text
                            x={2}
                            y={1}
                            text={`${d.cfm} CFM`}
                            fontSize={Math.max(8.5 * symScale, 9 / stageScale)}
                            fill={isDuctHighlighted ? '#fbbf24' : '#facc15'}
                            fontStyle="bold"
                          />
                        </Group>
                      )}

                      {/* Floating Interactive Selection Badge */}
                      {isDuctHighlighted && (
                        <Group x={mx} y={my - (hw + 26 * symScale)}>
                          <Rect
                            x={-45 * Math.min(1.5, symScale)}
                            y={-9 * Math.min(1.5, symScale)}
                            width={90 * Math.min(1.5, symScale)}
                            height={18 * Math.min(1.5, symScale)}
                            fill="#f59e0b"
                            cornerRadius={4}
                            shadowColor="#000000"
                            shadowBlur={6}
                          />
                          <Text
                            x={-43 * Math.min(1.5, symScale)}
                            y={-6 * Math.min(1.5, symScale)}
                            width={86 * Math.min(1.5, symScale)}
                            text={`★ ${d.id || d.sizeLabel}`}
                            fontSize={Math.max(8.5 * symScale, 9.5 / stageScale)}
                            fill="#000000"
                            fontStyle="bold"
                            align="center"
                          />
                        </Group>
                      )}

                      {/* Detailed Air Distribution Callout Badge with CFM & Size (LOD Tier 2+) */}
                      {annotationVisibility.ductSizeBadges && lodTier >= 2 && len > 45 && (
                        <Group x={mx} y={my + hw + 10 * symScale}>
                          <Rect
                            x={-35 * Math.min(1.5, symScale)}
                            y={-8 * Math.min(1.5, symScale)}
                            width={70 * Math.min(1.5, symScale)}
                            height={16 * Math.min(1.5, symScale)}
                            fill="rgba(15, 23, 42, 0.92)"
                            stroke={casingColor}
                            strokeWidth={getStrokeWidth(0.8, 0.8)}
                            cornerRadius={3}
                          />
                          <Text
                            x={-33 * Math.min(1.5, symScale)}
                            y={-6 * Math.min(1.5, symScale)}
                            width={66 * Math.min(1.5, symScale)}
                            text={`${d.sizeLabel} • ${vel} FPM`}
                            fontSize={Math.max(7.5 * symScale, 8 / stageScale)}
                            fill="#94a3b8"
                            align="center"
                          />
                        </Group>
                      )}
                    </Group>
                  );
                })}

                {/* Diffusers / Terminals Placement */}
                {zone.diffusers.map((dif) => {
                  const isTerminalHighlighted =
                    highlightedDuctId === dif.id ||
                    highlightedEntityTag === dif.id ||
                    (highlightedEntityTag && (
                      (highlightedEntityTag.toUpperCase().includes('SAD') && dif.type !== 'return') ||
                      (highlightedEntityTag.toUpperCase().includes('DIFF') && dif.type !== 'return') ||
                      (highlightedEntityTag.toUpperCase().includes('RG') && dif.type === 'return') ||
                      (highlightedEntityTag.toUpperCase().includes('RET') && dif.type === 'return') ||
                      (highlightedEntityTag.toUpperCase().includes('CASS') && zone.systemType === 'cassette')
                    ));

                  return (
                    <Group
                      key={dif.id}
                      x={dif.x}
                      y={dif.y}
                      draggable={drawMode === 'select' || isSelected}
                      onDragEnd={(e) => { if (!handleDiffuserDrag(zone.id, dif.id, e.target.x(), e.target.y())) e.target.position({ x: dif.x, y: dif.y }); }}
                    >
                      {/* Interactive Selection Glowing Ring & Callout */}
                      {isTerminalHighlighted && (
                        <Group listening={false}>
                          <Circle
                            x={0}
                            y={0}
                            radius={22 * symScale}
                            fill="rgba(245, 158, 11, 0.25)"
                            stroke="#fbbf24"
                            strokeWidth={getStrokeWidth(2.2, 2.2)}
                            dash={[4, 3]}
                          />
                          <Text
                            x={-30 * symScale}
                            y={-28 * symScale}
                            text={`★ ${dif.id}`}
                            fontSize={Math.max(9 * symScale, 10 / stageScale)}
                            fill="#fbbf24"
                            fontStyle="bold"
                          />
                        </Group>
                      )}

                      {/* Aerodynamic Distribution / Throw Coverage Circle */}
                      {dif.type !== 'return' && annotationVisibility.throwRings && (
                        <Group listening={false}>
                          {/* Outer T50 Throw Coverage Boundary */}
                          <Circle
                            x={0}
                            y={0}
                            radius={((dif.throwT50Ft && dif.throwT50Ft > 0 ? dif.throwT50Ft : 10) * (project.scale || 10))}
                            fill={isTerminalHighlighted ? "rgba(245, 158, 11, 0.12)" : "rgba(16, 185, 129, 0.07)"}
                            stroke={isTerminalHighlighted ? "rgba(245, 158, 11, 0.85)" : "rgba(16, 185, 129, 0.60)"}
                            strokeWidth={getStrokeWidth(isTerminalHighlighted ? 2.0 : 1.2, isTerminalHighlighted ? 2.0 : 1.2)}
                            dash={[6, 4]}
                            listening={false}
                          />
                          {/* Mid-Zone Throw Isovel Ring (50% Radius) */}
                          <Circle
                            x={0}
                            y={0}
                            radius={((dif.throwT50Ft && dif.throwT50Ft > 0 ? dif.throwT50Ft : 10) * (project.scale || 10) * 0.5)}
                            stroke={isTerminalHighlighted ? "rgba(245, 158, 11, 0.4)" : "rgba(16, 185, 129, 0.25)"}
                            strokeWidth={getStrokeWidth(0.8, 0.8)}
                            dash={[3, 3]}
                            listening={false}
                          />
                        </Group>
                      )}

                      {dif.type === 'return' ? (
                      <Group>
                        {/* Return Air Grille (RG-1 / Purple MEP Symbol) */}
                        {annotationVisibility.diffusers && (
                          <>
                            <Rect
                              x={-12 * symScale}
                              y={-12 * symScale}
                              width={24 * symScale}
                              height={24 * symScale}
                              fill="rgba(168, 85, 247, 0.25)"
                              stroke="#c084fc"
                              strokeWidth={getStrokeWidth(1.8, 1.8)}
                              cornerRadius={1}
                            />
                            {/* Inner Return Box */}
                            <Rect
                              x={-7 * symScale}
                              y={-7 * symScale}
                              width={14 * symScale}
                              height={14 * symScale}
                              stroke="#c084fc"
                              strokeWidth={getStrokeWidth(1.0, 1.0)}
                              fill="rgba(192, 132, 252, 0.15)"
                            />
                            {/* Diagonal Slash Across Return Grille */}
                            <Line
                              points={[-12 * symScale, -12 * symScale, 12 * symScale, 12 * symScale]}
                              stroke="#c084fc"
                              strokeWidth={getStrokeWidth(1.4, 1.4)}
                            />
                            {/* Inward Return Air Chevrons */}
                            <Line points={[-5 * symScale, -3 * symScale, 0, 0, -5 * symScale, 3 * symScale]} stroke="#e879f9" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                            <Line points={[5 * symScale, -3 * symScale, 0, 0, 5 * symScale, 3 * symScale]} stroke="#e879f9" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                          </>
                        )}

                        {/* Yellow CFM Tag with clean pill background */}
                        {annotationVisibility.diffuserCfm && (
                          <Group x={14 * symScale} y={-5 * symScale}>
                            <Rect
                              x={-2}
                              y={-1}
                              width={48 * symScale}
                              height={14 * symScale}
                              fill="rgba(15, 23, 42, 0.92)"
                              stroke="#facc15"
                              strokeWidth={0.5}
                              cornerRadius={2}
                            />
                            <Text
                              x={2}
                              y={1}
                              text={`${dif.cfm} CFM`}
                              fontSize={Math.max(8.5 * symScale, 9 / stageScale)}
                              fill="#facc15"
                              fontStyle="bold"
                            />
                          </Group>
                        )}

                        {/* Standard MEP Return Grille Tag (LOD Tier 2+) */}
                        {annotationVisibility.diffuserTags && lodTier >= 2 && (
                          <Group x={14 * symScale} y={8 * symScale}>
                            <Text
                              x={0}
                              y={0}
                              text={`RG-1 (${dif.size || '24"x12"'})`}
                              fontSize={Math.max(8 * symScale, 8.5 / stageScale)}
                              fill="#facc15"
                              fontStyle="bold"
                            />
                          </Group>
                        )}
                      </Group>
                    ) : zone.systemType === 'high-wall' ? (
                      <Group>
                        {/* High Wall Indoor Unit */}
                        {annotationVisibility.diffusers && (
                          <>
                            <Rect
                              x={-18 * symScale}
                              y={-5 * symScale}
                              width={36 * symScale}
                              height={10 * symScale}
                              fill="#6366f1"
                              stroke="#818cf8"
                              strokeWidth={getStrokeWidth(1.6, 1.6)}
                              cornerRadius={2}
                            />
                            <Line points={[-14 * symScale, 2 * symScale, 14 * symScale, 2 * symScale]} stroke="#ffffff" strokeWidth={getStrokeWidth(1.0, 1.0)} />
                            {/* 3 Radial Air Throw Rays */}
                            <Line points={[-10 * symScale, 5 * symScale, -15 * symScale, 15 * symScale]} stroke="#f97316" strokeWidth={getStrokeWidth(1.4, 1.4)} />
                            <Line points={[0, 5 * symScale, 0, 17 * symScale]} stroke="#f97316" strokeWidth={getStrokeWidth(1.4, 1.4)} />
                            <Line points={[10 * symScale, 5 * symScale, 15 * symScale, 15 * symScale]} stroke="#f97316" strokeWidth={getStrokeWidth(1.4, 1.4)} />
                          </>
                        )}
                      </Group>
                    ) : (
                      <Group>
                        {/* Square Ceiling Diffuser (CD-1 / Neon Green MEP Symbol) */}
                        {annotationVisibility.diffusers && (
                          <>
                            <Rect
                              x={-11 * symScale}
                              y={-11 * symScale}
                              width={22 * symScale}
                              height={22 * symScale}
                              fill="rgba(34, 197, 94, 0.25)"
                              stroke="#22c55e"
                              strokeWidth={getStrokeWidth(1.8, 1.8)}
                              cornerRadius={1}
                            />
                            {/* Inner Concentric Core Square */}
                            <Rect
                              x={-6 * symScale}
                              y={-6 * symScale}
                              width={12 * symScale}
                              height={12 * symScale}
                              stroke="#22c55e"
                              strokeWidth={getStrokeWidth(1.2, 1.2)}
                              fill="rgba(34, 197, 94, 0.15)"
                            />
                            {/* 4-Way Radial Airflow Discharge Arrow Rays with Pointer Heads */}
                            {/* North Arrow */}
                            <Line
                              points={[0, -6 * symScale, 0, -18 * symScale, -3.5 * symScale, -14.5 * symScale, 0, -18 * symScale, 3.5 * symScale, -14.5 * symScale]}
                              stroke="#22c55e"
                              strokeWidth={getStrokeWidth(1.4, 1.4)}
                            />
                            {/* South Arrow */}
                            <Line
                              points={[0, 6 * symScale, 0, 18 * symScale, -3.5 * symScale, 14.5 * symScale, 0, 18 * symScale, 3.5 * symScale, 14.5 * symScale]}
                              stroke="#22c55e"
                              strokeWidth={getStrokeWidth(1.4, 1.4)}
                            />
                            {/* West Arrow */}
                            <Line
                              points={[-6 * symScale, 0, -18 * symScale, 0, -14.5 * symScale, -3.5 * symScale, -18 * symScale, 0, -14.5 * symScale, 3.5 * symScale]}
                              stroke="#22c55e"
                              strokeWidth={getStrokeWidth(1.4, 1.4)}
                            />
                            {/* East Arrow */}
                            <Line
                              points={[6 * symScale, 0, 18 * symScale, 0, 14.5 * symScale, -3.5 * symScale, 18 * symScale, 0, 14.5 * symScale, 3.5 * symScale]}
                              stroke="#22c55e"
                              strokeWidth={getStrokeWidth(1.4, 1.4)}
                            />
                          </>
                        )}

                        {/* Yellow CFM Tag with clean pill background */}
                        {annotationVisibility.diffuserCfm && (
                          <Group x={14 * symScale} y={-5 * symScale}>
                            <Rect
                              x={-2}
                              y={-1}
                              width={48 * symScale}
                              height={14 * symScale}
                              fill="rgba(15, 23, 42, 0.92)"
                              stroke="#facc15"
                              strokeWidth={0.5}
                              cornerRadius={2}
                            />
                            <Text
                              x={2}
                              y={1}
                              text={`${dif.cfm} CFM`}
                              fontSize={Math.max(8.5 * symScale, 9 / stageScale)}
                              fill="#facc15"
                              fontStyle="bold"
                            />
                          </Group>
                        )}

                        {/* Standard MEP Diffuser Tag: CD-1 (Size) / line / CFM • NC (LOD Tier 2+) */}
                        {annotationVisibility.diffuserTags && lodTier >= 2 && (
                          <Group x={15 * symScale} y={-10 * symScale}>
                            <Text
                              x={0}
                              y={0}
                              text={`CD-1 (${dif.size || '12"x12"'})`}
                              fontSize={Math.max(9 * symScale, 9.5 / stageScale)}
                              fill="#facc15"
                              fontStyle="bold"
                            />
                            <Line
                              points={[0, 11 * Math.min(1.5, symScale), 48 * Math.min(1.5, symScale), 11 * Math.min(1.5, symScale)]}
                              stroke="#facc15"
                              strokeWidth={getStrokeWidth(0.9, 0.9)}
                            />
                            <Text
                              x={0}
                              y={13 * Math.min(1.5, symScale)}
                              text={`${dif.cfm} CFM${dif.actualNc ? ` • NC ${dif.actualNc}` : ''}`}
                              fontSize={Math.max(8.5 * symScale, 9 / stageScale)}
                              fill="#facc15"
                              fontStyle="bold"
                            />
                          </Group>
                        )}

                        {/* LOD Tier 3+: Throw radius ring */}
                        {annotationVisibility.throwRings && lodTier >= 3 && (
                          <Circle
                            x={0}
                            y={0}
                            radius={(dif.throwT50Ft || 12) * (project.scale / 10) * (symScale * 0.7)}
                            stroke="rgba(16, 185, 129, 0.25)"
                            strokeWidth={getStrokeWidth(0.6, 0.8)}
                            dash={[4, 3]}
                          />
                        )}
                      </Group>
                    )}
                  </Group>
                );
              })}

              {/* Multiple Indoor Units (FCU / Concealed Split / AHU / RTU) */}
                {annotationVisibility.indoorUnits && (() => {
                  const unitList = zone.unitPositions && zone.unitPositions.length > 0
                    ? zone.unitPositions
                    : zone.unitPos
                    ? [zone.unitPos]
                    : [];

                  const isIndoorUnitHighlighted =
                    highlightedEntityTag &&
                    (highlightedEntityTag.toUpperCase().includes('FCU') ||
                     highlightedEntityTag.toUpperCase().includes('AHU') ||
                     highlightedEntityTag.toUpperCase().includes('RTU') ||
                     highlightedEntityTag.toUpperCase().includes('INDOOR') ||
                     highlightedEntityTag.toUpperCase().includes('SPLIT'));

                  return unitList.map((pos, uIdx) => (
                    <Group
                      key={`unit-${zone.id}-${uIdx}`}
                      x={pos.x}
                      y={pos.y}
                      draggable={drawMode === 'select' || isSelected}
                      onDragEnd={(e) => {
                        if (!handleIndoorUnitDrag(zone.id, e.target.x(), e.target.y(), uIdx)) e.target.position({ x: pos.x, y: pos.y });
                      }}
                    >
                      {/* Selection Highlight Halo */}
                      {isIndoorUnitHighlighted && (
                        <Group listening={false}>
                          <Rect
                            x={-30 * symScale}
                            y={-18 * symScale}
                            width={60 * symScale}
                            height={36 * symScale}
                            stroke="#fbbf24"
                            strokeWidth={getStrokeWidth(2.5, 2.5)}
                            fill="rgba(251, 191, 36, 0.25)"
                            dash={[5, 3]}
                            cornerRadius={5}
                          />
                          <Text
                            x={-35 * symScale}
                            y={-28 * symScale}
                            text="★ SELECTED INDOOR UNIT"
                            fontSize={Math.max(8.5 * symScale, 9.5 / stageScale)}
                            fill="#fbbf24"
                            fontStyle="bold"
                          />
                        </Group>
                      )}

                      {zone.systemType === 'packaged' ? (
                        <Group>
                          <Rect
                            x={-32 * symScale}
                            y={-18 * symScale}
                            width={64 * symScale}
                            height={36 * symScale}
                            fill="rgba(245, 158, 11, 0.3)"
                            stroke="#f59e0b"
                            strokeWidth={getStrokeWidth(2.0, 2.0)}
                            cornerRadius={4}
                          />
                          <Line points={[-4 * symScale, -18 * symScale, -4 * symScale, 18 * symScale]} stroke="#f59e0b" strokeWidth={getStrokeWidth(1.2, 1.2)} dash={[4, 3]} />
                          <Circle x={-18 * symScale} y={-5 * symScale} radius={6 * symScale} stroke="#fbbf24" strokeWidth={getStrokeWidth(1.0, 1.0)} />
                          <Circle x={-18 * symScale} y={7 * symScale} radius={6 * symScale} stroke="#fbbf24" strokeWidth={getStrokeWidth(1.0, 1.0)} />
                          <Rect x={8 * symScale} y={-14 * symScale} width={20 * symScale} height={28 * symScale} stroke="#fbbf24" strokeWidth={getStrokeWidth(1.0, 1.0)} fill="rgba(251, 191, 36, 0.1)" />
                          <Circle x={18 * symScale} y={0} radius={8 * symScale} stroke="#fbbf24" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                          <Text x={-30 * symScale} y={-8 * symScale} text={`RTU-${uIdx + 1}`} fontSize={Math.max(9.5 * symScale, 10 / stageScale)} fill="#fbbf24" fontStyle="bold" />
                        </Group>
                      ) : (
                        <Group>
                          {/* Concealed Indoor Split Unit (Red / Green Industrial Theme Matching Reference Drawing) */}
                          <Rect
                            x={-24 * symScale}
                            y={-14 * symScale}
                            width={48 * symScale}
                            height={28 * symScale}
                            fill="rgba(239, 68, 68, 0.25)"
                            stroke="#ef4444"
                            strokeWidth={getStrokeWidth(2.0, 2.0)}
                            cornerRadius={3}
                          />
                          {/* Cooling coil rows */}
                          <Line points={[-14 * symScale, -10 * symScale, -7 * symScale, 10 * symScale]} stroke="#facc15" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                          <Line points={[-7 * symScale, -10 * symScale, 0, 10 * symScale]} stroke="#facc15" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                          <Line points={[0, -10 * symScale, 7 * symScale, 10 * symScale]} stroke="#facc15" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                          {/* Centrifugal Blower Scroll */}
                          <Circle x={14 * symScale} y={0} radius={8 * symScale} stroke="#ef4444" strokeWidth={getStrokeWidth(1.4, 1.4)} />
                          <Text
                            x={-22 * symScale}
                            y={-6 * symScale}
                            text={`FCU-0${uIdx + 1}`}
                            fontSize={Math.max(9.5 * symScale, 10 / stageScale)}
                            fill="#fecaca"
                            fontStyle="bold"
                          />
                        </Group>
                      )}
                    </Group>
                  ));
                })()}

                {/* Multiple Outdoor Units (ACU) along bottom wall */}
                {annotationVisibility.outdoorUnits && (() => {
                  const outdoorList = zone.outdoorUnitPositions && zone.outdoorUnitPositions.length > 0
                    ? zone.outdoorUnitPositions
                    : zone.outdoorUnitPos
                    ? [zone.outdoorUnitPos]
                    : [];

                  const isOutdoorHighlighted =
                    highlightedEntityTag &&
                    (highlightedEntityTag.toUpperCase().includes('ODU') ||
                     highlightedEntityTag.toUpperCase().includes('ACU') ||
                     highlightedEntityTag.toUpperCase().includes('COND') ||
                     highlightedEntityTag.toUpperCase().includes('OUTDOOR'));

                  return outdoorList.map((oPos, oIdx) => (
                    <Group
                      key={`odu-${zone.id}-${oIdx}`}
                      x={oPos.x}
                      y={oPos.y}
                      draggable={drawMode === 'select' || isSelected}
                      onDragEnd={(e) => {
                        if (!handleOutdoorUnitDrag(zone.id, e.target.x(), e.target.y(), oIdx)) e.target.position({ x: oPos.x, y: oPos.y });
                      }}
                    >
                      {/* Selection Highlight Halo */}
                      {isOutdoorHighlighted && (
                        <Group listening={false}>
                          <Rect
                            x={-22 * symScale}
                            y={-14 * symScale}
                            width={44 * symScale}
                            height={28 * symScale}
                            stroke="#fbbf24"
                            strokeWidth={getStrokeWidth(2.5, 2.5)}
                            fill="rgba(251, 191, 36, 0.25)"
                            dash={[5, 3]}
                            cornerRadius={5}
                          />
                          <Text
                            x={-35 * symScale}
                            y={-22 * symScale}
                            text="★ SELECTED OUTDOOR ACU"
                            fontSize={Math.max(8 * symScale, 9 / stageScale)}
                            fill="#fbbf24"
                            fontStyle="bold"
                          />
                        </Group>
                      )}

                      {/* Outdoor Air-Cooled Condenser Unit (ACU) Housing */}
                      <Rect
                        x={-18 * symScale}
                        y={-10 * symScale}
                        width={36 * symScale}
                        height={20 * symScale}
                        fill="rgba(6, 182, 212, 0.35)"
                        stroke="#06b6d4"
                        strokeWidth={getStrokeWidth(1.8, 1.8)}
                        cornerRadius={3}
                      />
                      {/* Dual Condenser Fan Blades */}
                      <Circle x={-8 * symScale} y={0} radius={6 * symScale} stroke="#22d3ee" strokeWidth={getStrokeWidth(1.0, 1.0)} />
                      <Line points={[-12 * symScale, 0, -4 * symScale, 0]} stroke="#22d3ee" strokeWidth={getStrokeWidth(1.0, 1.0)} />
                      <Line points={[-8 * symScale, -4 * symScale, -8 * symScale, 4 * symScale]} stroke="#22d3ee" strokeWidth={getStrokeWidth(1.0, 1.0)} />

                      <Circle x={8 * symScale} y={0} radius={6 * symScale} stroke="#22d3ee" strokeWidth={getStrokeWidth(1.0, 1.0)} />
                      <Line points={[4 * symScale, 0, 12 * symScale, 0]} stroke="#22d3ee" strokeWidth={getStrokeWidth(1.0, 1.0)} />
                      <Line points={[8 * symScale, -4 * symScale, 8 * symScale, 4 * symScale]} stroke="#22d3ee" strokeWidth={getStrokeWidth(1.0, 1.0)} />

                      {/* Yellow Circular Tag (P) on outdoor ACU */}
                      <Group x={20 * symScale} y={-8 * symScale}>
                        <Circle x={0} y={0} radius={5 * Math.min(1.8, symScale)} fill="#facc15" stroke="#000000" strokeWidth={0.8} />
                        <Text x={-3 * Math.min(1.8, symScale)} y={-4 * Math.min(1.8, symScale)} text="P" fontSize={Math.max(6 * symScale, 7 / stageScale)} fill="#000000" fontStyle="bold" />
                      </Group>
                    </Group>
                  ));
                })()}

                {/* Centroid Labels */}
                {annotationVisibility.zoneLabels && (() => {
                  const { coverage } = item;
                  return (
                    <>
                      <Text
                        x={centroid.x - 80 / stageScale}
                        y={centroid.y - 18 / stageScale}
                        text={zone.name}
                        fontSize={Math.max(13, 13 / stageScale)}
                        fontStyle="bold"
                        fill={isSelected ? '#3b82f6' : '#d4d4d4'}
                        align="center"
                        width={160 / stageScale}
                      />
                      <Text
                        x={centroid.x - 80 / stageScale}
                        y={centroid.y - 2 / stageScale}
                        text={load ? `${getSupplyAirflowForDisplay(zone.diffusers, calculateCanonicalZoneLoad(zone,project).supplyCfm, project.units)?.toFixed(1) ?? 'Unknown'} ${project.units === 'imperial' ? 'CFM' : 'L/s'} (${zone.systemType || 'concealed'})` : 'Engineering input error — check zone properties'}
                        fontSize={Math.max(11, 11 / stageScale)}
                        fontStyle="bold"
                        fill="#10b981"
                        align="center"
                        width={160 / stageScale}
                      />
                      {zone.diffusers.length > 0 && zone.systemType !== 'high-wall' && (
                        <Text
                          x={centroid.x - 80 / stageScale}
                          y={centroid.y + 12 / stageScale}
                          text={`Coverage: ${coverage.coveragePercent}% ${coverage.coveragePercent >= 99 ? '★ (100% Full Space Covered)' : coverage.isCovered95 ? '✓ (≥95%)' : '⚠'}`}
                          fontSize={Math.max(9.5, 9.5 / stageScale)}
                          fontStyle="bold"
                          fill={coverage.coveragePercent >= 99 ? '#34d399' : coverage.isCovered95 ? '#2dd4bf' : '#f59e0b'}
                          align="center"
                          width={160 / stageScale}
                        />
                      )}
                    </>
                  );
                })()}

                {/* Interactive Editable Vertices (Selected Zone only) */}
                {isSelected &&
                  Array.from({ length: zone.points.length / 2 }).map((_, idx) => (
                    <Circle
                      key={`v-${zone.id}-${idx}`}
                      x={zone.points[idx * 2]}
                      y={zone.points[idx * 2 + 1]}
                      radius={Math.max(4 / stageScale, 5)}
                      fill="#3b82f6"
                      stroke="#ffffff"
                      strokeWidth={getStrokeWidth(1.0, 1.2)}
                      draggable
                      onDragEnd={(e) => {
                        if (!handleVertexDrag(zone.id, idx, e.target.x(), e.target.y())) {
                          e.target.position({ x: zone.points[idx * 2], y: zone.points[idx * 2 + 1] });
                        }
                      }}
                    />
                  ))}
              </Group>
            );
          })}

          {/* Non-Destructive Deployment Ghost Preview Layer */}
          {activePreview && (
            <Group opacity={0.65}>
              {/* Ghost Ducts */}
              {activePreview.manifest.ducts.map((d) => (
                <Group key={`prev-${d.id}`}>
                  <Line
                    points={d.points}
                    stroke={d.type === 'return' ? '#94a3b8' : '#60a5fa'}
                    strokeWidth={getStrokeWidth((d.widthIn / 12) * project.scale, 2.0)}
                    dash={[6 / stageScale, 4 / stageScale]}
                  />
                  <Text
                    x={(d.points[0] + d.points[2]) / 2}
                    y={(d.points[1] + d.points[3]) / 2 - 10 / stageScale}
                    text={`(Preview) ${d.sizeLabel}`}
                    fontSize={Math.min(9, Math.max(5, 6 / stageScale))}
                    fill="#60a5fa"
                    fontStyle="bold"
                    align="center"
                  />
                </Group>
              ))}

              {/* Ghost Diffusers with Throw Coverage Rings */}
              {activePreview.manifest.terminals.map((dif) => {
                const eqScale = project.equipmentScale || 2.0;
                const symScale = eqScale * 1.5;

                return (
                  <Group key={`prev-${dif.id}`} x={dif.x} y={dif.y}>
                    <Circle
                      x={0}
                      y={0}
                      radius={12 * symScale}
                      fill="rgba(59, 130, 246, 0.4)"
                      stroke="#3b82f6"
                      strokeWidth={getStrokeWidth(1.8, 1.8)}
                      dash={[3 / stageScale, 2 / stageScale]}
                    />
                    <Circle
                      x={0}
                      y={0}
                      radius={(dif.throwT50Ft || 12) * (project.scale / 10) * (symScale * 0.7)}
                      stroke="rgba(59, 130, 246, 0.35)"
                      strokeWidth={getStrokeWidth(1.0, 1.0)}
                      dash={[6 / stageScale, 4 / stageScale]}
                    />
                    <Text
                      x={16 * symScale}
                      y={-8 * symScale}
                      text={`(Preview) ${dif.size || 'Diffuser'}\n${dif.cfm} CFM`}
                      fontSize={Math.min(12, Math.max(6.5, (7 * symScale) / stageScale))}
                      fill="#93c5fd"
                      fontStyle="bold"
                    />
                  </Group>
                );
              })}

              {/* Ghost Indoor Unit(s) */}
              {(() => {
                const eqScale = project.equipmentScale || 2.0;
                const symScale = eqScale * 1.5;
                const unitsToPreview = activePreview.manifest.equipment.cassetteUnits && activePreview.manifest.equipment.cassetteUnits.length > 0
                  ? activePreview.manifest.equipment.cassetteUnits
                  : activePreview.manifest.equipment.indoorUnit
                  ? [activePreview.manifest.equipment.indoorUnit]
                  : [];

                return unitsToPreview.map((iu, uIdx) => (
                  <Group key={`prev-iu-${uIdx}`} x={iu.position.x} y={iu.position.y}>
                    <Rect
                      x={-24 * symScale}
                      y={-12 * symScale}
                      width={48 * symScale}
                      height={24 * symScale}
                      fill="rgba(16, 185, 129, 0.35)"
                      stroke="#10b981"
                      strokeWidth={getStrokeWidth(1.8, 1.8)}
                      dash={[4 / stageScale, 3 / stageScale]}
                      cornerRadius={3}
                    />
                    <Text
                      x={-22 * symScale}
                      y={-6 * symScale}
                      text={`PREVIEW: ${iu.model || 'Indoor Unit'}`}
                      fontSize={Math.min(11, Math.max(6, (7 * symScale) / stageScale))}
                      fill="#34d399"
                      fontStyle="bold"
                    />
                  </Group>
                ));
              })()}

              {/* Ghost Refrigerant Lines */}
              {activePreview.manifest.piping?.refrigerantLines?.map((refLine, rIdx) => (
                <Line
                  key={`prev-ref-${rIdx}`}
                  points={refLine.points}
                  stroke="#f97316"
                  strokeWidth={getStrokeWidth(2.2, 2.2)}
                  dash={[6 / stageScale, 4 / stageScale]}
                />
              ))}

              {/* Ghost Outdoor Unit(s) */}
              {activePreview.manifest.equipment.outdoorUnit && (() => {
                const eqScale = project.equipmentScale || 2.0;
                const symScale = eqScale * 1.5;
                const odu = activePreview.manifest.equipment.outdoorUnit;

                return (
                  <Group
                    x={odu.position.x}
                    y={odu.position.y}
                  >
                    <Rect
                      x={-18 * symScale}
                      y={-10 * symScale}
                      width={36 * symScale}
                      height={20 * symScale}
                      fill="rgba(244, 63, 94, 0.35)"
                      stroke="#f43f5e"
                      strokeWidth={getStrokeWidth(1.8, 1.8)}
                      dash={[4 / stageScale, 3 / stageScale]}
                      cornerRadius={3}
                    />
                    <Text
                      x={-20 * symScale}
                      y={-22 * symScale}
                      text={`PREVIEW ODU (${odu.model || 'ACU'})`}
                      fontSize={Math.min(11, Math.max(6, (7 * symScale) / stageScale))}
                      fill="#f43f5e"
                      fontStyle="bold"
                    />
                  </Group>
                );
              })()}
            </Group>
          )}

          {/* Measure / calibrate segment */}
          {drawMode === 'measure' && measurePoints.length > 0 && (
            <Group listening={false}>
              <Line
                points={[measurePoints[0].x, measurePoints[0].y, ...(measurePoints[1] ? [measurePoints[1].x, measurePoints[1].y] : [mousePos.x, mousePos.y])]}
                stroke="#f59e0b" strokeWidth={getStrokeWidth(1.5, 1.5)} dash={[6 / stageScale, 4 / stageScale]}
              />
              {measurePoints.map((p, i) => <Circle key={`m-${i}`} x={p.x} y={p.y} radius={Math.max(3.5 / stageScale, 4)} fill="#f59e0b" />)}
            </Group>
          )}

          {/* Polyline Draw in Progress */}
          {tempPoints.length > 0 && (
            <Group>
              <Line
                points={[...tempPoints, mousePos.x, mousePos.y]}
                stroke="#60a5fa"
                strokeWidth={getStrokeWidth(1.5, 1.5)}
                dash={[4 / stageScale, 4 / stageScale]}
              />
              <Line points={tempPoints} stroke="#3b82f6" strokeWidth={getStrokeWidth(2.0, 2.0)} />
              {Array.from({ length: tempPoints.length / 2 }).map((_, idx) => (
                <Circle
                  key={`t-v-${idx}`}
                  x={tempPoints[idx * 2]}
                  y={tempPoints[idx * 2 + 1]}
                  radius={Math.max(3.5 / stageScale, 4)}
                  fill="#3b82f6"
                />
              ))}
            </Group>
          )}
        </Layer>
      </Stage>

      {/* Top HUD Info Overlay */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <div className="bg-neutral-900/90 border border-neutral-800 px-3.5 py-1.5 rounded-xl text-[10px] text-neutral-400 font-medium backdrop-blur shadow flex items-center gap-2">
          <span>Zoom: <strong className="text-blue-400 font-mono">{Math.round(stageScale * 100)}%</strong></span>
          <span className="text-neutral-700">|</span>
          <span>LOD: <strong className="text-emerald-400 font-mono">T{lodTier}</strong></span>
          <span className="text-neutral-700">|</span>
          <span>Mode: <strong className="text-blue-500 capitalize">{drawMode}</strong></span>
          <span className="text-neutral-700">|</span>
          <div className="flex items-center gap-1">
            <span className="text-neutral-400">Unit Size:</span>
            {[0.75, 1.0, 1.5, 2.0, 3.0].map((sc) => (
              <button
                key={sc}
                onClick={() => setProject({ equipmentScale: sc })}
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-all cursor-pointer ${
                  (project.equipmentScale || 1.5) === sc
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
                title={`Set Equipment & Symbol Size to ${sc}x`}
              >
                {sc}x
              </button>
            ))}
          </div>
        </div>

        {/* CAD Layers & Annotations Visibility Toggle Button */}
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

      {/* Floating CAD Layer & Annotation Manager Popover Modal */}
      {drawMode === 'measure' && (
        <div className="absolute left-3 top-14 z-10 w-72 rounded-lg border border-amber-700 bg-neutral-900/95 p-3 text-xs text-neutral-200">
          {measurePoints.length < 2 ? (
            <div>Measure / calibrate: click {measurePoints.length === 0 ? 'the first' : 'the second'} point of a segment of known length (snaps to CAD geometry, Shift = ortho).</div>
          ) : (
            <div className="flex flex-col gap-2">
              <div>Segment: {measuredDistance(measurePoints[0], measurePoints[1]).toPrecision(6)} drawing units. What is its real length?</div>
              <input
                autoFocus
                value={measureInput}
                onChange={(e) => setMeasureInput(e.target.value)}
                placeholder={project.units === 'metric' ? 'e.g. 3.5 m' : 'e.g. 12 ft'}
                className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono"
              />
              {(() => { const parsed = parseKnownLength(measureInput, project.units === 'metric' ? 'm' : 'ft');
                return parsed.ok ? <div className="text-amber-300">{describeCalibration(measuredDistance(measurePoints[0], measurePoints[1]), parsed.length, parsed.unit)}</div> : null; })()}
              <div className="flex gap-2">
                <button className="rounded border border-amber-600 px-2 py-1 text-amber-300 hover:bg-neutral-800" onClick={confirmCalibration}>Confirm and apply scale</button>
                <button className="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800" onClick={() => { setMeasurePoints([]); setMeasureInput(''); setDrawMessage(null); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
      {drawMode === 'select' && (() => {
        const sel = zones.find(z => z.id === selectedZoneId);
        if (!sel || sel.engineeringStatus !== 'stale' || (sel.diffusers.length === 0 && sel.ducts.length === 0)) return null;
        return (
          <button
            className="absolute right-3 bottom-3 z-10 rounded-lg border border-teal-700 bg-neutral-900/95 px-3 py-1.5 text-xs text-teal-300 hover:bg-neutral-800"
            onClick={() => {
              const r = verifyZoneEdits(sel.id);
              setDrawMessage(r.success ? `Edited layout verified (fan static ${r.pressureInWg?.toFixed(2)} in.wg).` : `Verification failed: ${r.error}`);
            }}
          >
            Verify edited layout
          </button>
        );
      })()}
      {(drawMessage || (drawMode === 'polyline' && (typedLength || tempPoints.length > 0))) && (
        <div className="absolute left-3 bottom-3 z-10 max-w-md rounded-lg border border-neutral-700 bg-neutral-900/95 px-3 py-2 text-xs text-neutral-200">
          {typedLength && <div className="font-mono text-teal-300">Length: {typedLength} {project.units === 'metric' ? 'm' : 'ft'} (Enter to place)</div>}
          {drawMessage && <div className="text-amber-300">{drawMessage}</div>}
          {!drawMessage && drawMode === 'polyline' && <div className="text-neutral-400">Click to add vertices, click the first point or double-click to close, Backspace undoes, Esc cancels, type a length then Enter.</div>}
        </div>
      )}
      <CadLayerManagerModal
        isOpen={isLayerManagerOpen}
        onClose={() => setIsLayerManagerOpen(false)}
      />

      {/* Viewport Floating Zoom Navigation Controls */}
      <div className="absolute bottom-4 right-4 flex items-center gap-1.5 bg-neutral-900/90 border border-neutral-800 p-1.5 rounded-2xl backdrop-blur-md shadow-2xl">
        <div className="flex items-center gap-1 px-1 text-[10px] text-neutral-400 font-medium border-r border-neutral-800 pr-2 mr-0.5">
          <span>Size:</span>
          <button
            onClick={() => setProject({ equipmentScale: Math.max(0.5, Math.round(((project.equipmentScale || 1.5) - 0.25) * 100) / 100) })}
            title="Decrease Equipment Symbol Size"
            className="w-5 h-5 flex items-center justify-center bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded font-bold text-[11px] cursor-pointer"
          >
            -
          </button>
          <span className="text-cyan-400 font-mono font-bold min-w-[28px] text-center">
            {project.equipmentScale || 1.5}x
          </span>
          <button
            onClick={() => setProject({ equipmentScale: Math.min(5.0, Math.round(((project.equipmentScale || 1.5) + 0.25) * 100) / 100) })}
            title="Increase Equipment Symbol Size"
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
          onClick={() => handleZoomBtn(0.80)}
          title="Zoom Out (-)"
          className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white rounded-lg transition-colors cursor-pointer"
        >
          <ZoomOut size={14} />
        </button>
        <div className="w-[1px] h-4 bg-neutral-700 mx-0.5" />
        <button
          onClick={handleFitDesign}
          title="Fit Complete Design (All Zones)"
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
