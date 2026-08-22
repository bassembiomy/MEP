import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Line, Circle, Text, Group, Shape, Rect } from 'react-konva';
import { useProjectStore } from '../store/projectStore';
import { snapToGrid, getPolygonCentroid } from '../engine/geometry';
import { calculateZoneLoad } from '../engine/loadCalc';
import { routeDucts } from '../engine/ductRouter';
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
    annotationVisibility,
    activePreview
  } = useProjectStore();

  const stageRef = useRef<Konva.Stage>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [stageScale, setStageScale] = useState<number>(1);
  const [stagePos, setStagePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const [isLayerManagerOpen, setIsLayerManagerOpen] = useState<boolean>(false);
  const lastPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

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
    const stageWidth = 900;
    const stageHeight = 500;

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
  }, [dxfBoundingBox, zones]);

  // Fit view to selected zone
  const handleFitSelection = useCallback(() => {
    const selectedZone = zones.find(z => z.id === selectedZoneId);
    if (!selectedZone || selectedZone.points.length < 6) {
      handleFitDesign();
      return;
    }

    const stageWidth = 900;
    const stageHeight = 500;

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

  const gridSpacing = project.units === 'imperial' ? 10 : 10;

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;

    const transform = stage.getAbsoluteTransform().copy().invert();
    const pos = stage.getPointerPosition();
    if (pos) {
      const localPos = transform.point(pos);
      setMousePos({
        x: snapToGrid(localPos.x, gridSpacing),
        y: snapToGrid(localPos.y, gridSpacing),
      });
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

    if (drawMode === 'polyline') {
      const sx = mousePos.x;
      const sy = mousePos.y;
      addTempPoint(sx, sy);
    }
  };

  const handleDoubleClick = () => {
    if (drawMode === 'polyline' && tempPoints.length >= 6) {
      addZone(tempPoints);
      clearTempPoints();
    }
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

  const handleVertexDrag = (zoneId: string, pointIdx: number, newX: number, newY: number) => {
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;

    const updatedPoints = [...zone.points];
    updatedPoints[pointIdx * 2] = snapToGrid(newX, gridSpacing);
    updatedPoints[pointIdx * 2 + 1] = snapToGrid(newY, gridSpacing);
    
    updateZone(zoneId, { points: updatedPoints });
  };

  const handleDiffuserDrag = (zoneId: string, diffuserId: string, newX: number, newY: number) => {
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;

    const snapX = snapToGrid(newX, gridSpacing);
    const snapY = snapToGrid(newY, gridSpacing);

    const updatedDiffusers = zone.diffusers.map((dif) =>
      dif.id === diffuserId ? { ...dif, x: snapX, y: snapY } : dif
    );

    const isDucted = zone.systemType === 'concealed' || zone.systemType === 'packaged' || zone.systemType === 'ahu';

    if (isDucted) {
      const { ducts, unitPos } = routeDucts(
        zone.points,
        updatedDiffusers,
        project.units,
        zone.id,
        zone.unitPos,
        zone.systemType
      );
      updateZone(zoneId, {
        diffusers: updatedDiffusers,
        ducts,
        unitPos
      });
    } else {
      updateZone(zoneId, {
        diffusers: updatedDiffusers,
        ducts: []
      });
    }
  };

  const handleIndoorUnitDrag = (zoneId: string, newX: number, newY: number) => {
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;

    const snapX = snapToGrid(newX, gridSpacing);
    const snapY = snapToGrid(newY, gridSpacing);

    const isDucted = zone.systemType === 'concealed' || zone.systemType === 'packaged' || zone.systemType === 'ahu';

    if (isDucted) {
      const { ducts, unitPos } = routeDucts(
        zone.points,
        zone.diffusers,
        project.units,
        zone.id,
        { x: snapX, y: snapY },
        zone.systemType
      );
      updateZone(zoneId, {
        ducts,
        unitPos
      });
    } else {
      updateZone(zoneId, {
        unitPos: { x: snapX, y: snapY }
      });
    }
  };

  const handleOutdoorUnitDrag = (zoneId: string, newX: number, newY: number) => {
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;

    const snapX = snapToGrid(newX, gridSpacing);
    const snapY = snapToGrid(newY, gridSpacing);

    updateZone(zoneId, {
      outdoorUnitPos: { x: snapX, y: snapY }
    });
  };

  // Draw background grid lines with scale adjustment
  const drawGridLines = () => {
    if (!annotationVisibility.grid || lodTier === 1) return null; // Declutter grid at far zoom or if hidden
    const lines: React.ReactNode[] = [];
    const size = 3000;
    const step = gridSpacing * 5;
    for (let i = -size; i < size; i += step) {
      const isMajor = i % (gridSpacing * 25) === 0;
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
    <div className="relative w-full h-[65vh] bg-[#0c0c0c] border border-neutral-800 rounded-3xl overflow-hidden shadow-inner flex flex-col">
      <Stage
        ref={stageRef}
        width={900}
        height={500}
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
        style={{ cursor: isPanActive ? (isPanning ? 'grabbing' : 'grab') : drawMode === 'polyline' ? 'crosshair' : 'default' }}
      >
        <Layer>
          {drawGridLines()}

          {/* DXF CAD Underlay Geometry (Layer-by-Layer with Visibility & Native CAD Colors) */}
          {Object.entries(dxfLayers).length > 0 ? (
            Object.entries(dxfLayers).map(([layerName, layerInfo]) => {
              if (!layerInfo.visible) return null;
              const layerEntities = dxfEntities.filter((e) => (e.layer || '0') === layerName);
              if (layerEntities.length === 0) return null;

              return (
                <Shape
                  key={`dxf-layer-${layerName}`}
                  stroke={layerInfo.color || '#94a3b8'}
                  strokeWidth={getStrokeWidth(0.8, 1.0)}
                  sceneFunc={(context, shape) => {
                    context.save();
                    context.beginPath();

                    for (const ent of layerEntities) {
                      if (ent.type === 'LINE') {
                        context.moveTo(ent.x || 0, ent.y || 0);
                        context.lineTo(ent.points?.[0] || 0, ent.points?.[1] || 0);
                      } else if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && ent.points) {
                        const pts = ent.points;
                        if (pts.length >= 4) {
                          context.moveTo(pts[0], pts[1]);
                          for (let i = 2; i < pts.length; i += 2) {
                            context.lineTo(pts[i], pts[i + 1]);
                          }
                        }
                      } else if ((ent.type === 'CIRCLE' || ent.type === 'ARC') && typeof ent.radius === 'number') {
                        context.moveTo((ent.x || 0) + ent.radius, ent.y || 0);
                        context.arc(ent.x || 0, ent.y || 0, ent.radius, 0, Math.PI * 2);
                      }
                    }
                    context.fillStrokeShape(shape);
                    context.restore();
                  }}
                  hitFunc={() => {}}
                  opacity={0.65}
                />
              );
            })
          ) : dxfEntities.length > 0 ? (
            <Shape
              stroke="#525252"
              strokeWidth={getStrokeWidth(0.8, 1.0)}
              sceneFunc={(context, shape) => {
                context.save();
                context.beginPath();

                for (const ent of dxfEntities) {
                  if (ent.type === 'LINE') {
                    context.moveTo(ent.x || 0, ent.y || 0);
                    context.lineTo(ent.points?.[0] || 0, ent.points?.[1] || 0);
                  } else if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && ent.points) {
                    const pts = ent.points;
                    if (pts.length >= 4) {
                      context.moveTo(pts[0], pts[1]);
                      for (let i = 2; i < pts.length; i += 2) {
                        context.lineTo(pts[i], pts[i + 1]);
                      }
                    }
                  } else if ((ent.type === 'CIRCLE' || ent.type === 'ARC') && typeof ent.radius === 'number') {
                    context.moveTo((ent.x || 0) + ent.radius, ent.y || 0);
                    context.arc(ent.x || 0, ent.y || 0, ent.radius, 0, Math.PI * 2);
                  }
                }
                context.fillStrokeShape(shape);
                context.restore();
              }}
              hitFunc={() => {}}
              opacity={0.45}
            />
          ) : null}

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
                    context.fillText(ent.text, ent.x || 0, ent.y || 0);
                  }
                }
                context.restore();
              }}
              hitFunc={() => {}}
              opacity={0.65}
            />
          )}

          {/* Zones Rendering */}
          {zones.map((zone) => {
            const isSelected = zone.id === selectedZoneId;
            const centroid = getPolygonCentroid(zone.points);
            const load = calculateZoneLoad(zone, project);

            // Calculate zone span to dynamically adapt component sizes to room geometry
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (let i = 0; i < zone.points.length; i += 2) {
              if (zone.points[i] < minX) minX = zone.points[i];
              if (zone.points[i] > maxX) maxX = zone.points[i];
              if (zone.points[i + 1] < minY) minY = zone.points[i + 1];
              if (zone.points[i + 1] > maxY) maxY = zone.points[i + 1];
            }
            const zoneW = maxX > minX ? maxX - minX : 300;
            const zoneH = maxY > minY ? maxY - minY : 300;
            const zoneSpan = Math.min(zoneW, zoneH);

            const eqScale = project.equipmentScale || 2.0;
            const baseUnitSize = Math.max(45, Math.min(160, zoneSpan * 0.16));
            const symScale = (baseUnitSize / 30) * eqScale;

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

                  if (unitList.length === 0 && outdoorList.length === 0) return null;

                  const totalBtu = load.totalLoad;
                  const qty = zone.catalogQty || unitList.length || 1;
                  const btuPerUnit = Math.round(totalBtu / Math.max(1, qty));
                  const supplyDiffusers = zone.diffusers.filter((d) => d.type !== 'return');
                  const returnDiffusers = zone.diffusers.filter((d) => d.type === 'return');
                  const cfmPerUnit = Math.round((zone.diffusers.length > 0 ? supplyDiffusers.reduce((s, d) => s + d.cfm, 0) : load.supplyCfm) / Math.max(1, qty));
                  const supplyDiffuserCfmEach = supplyDiffusers.length > 0 ? supplyDiffusers[0].cfm : Math.round(load.supplyCfm / 12);
                  const freshAirCfm = Math.round(load.supplyCfm * 0.15);

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
                      {annotationVisibility.refrigerantPiping && unitList.map((uPos, uIdx) => {
                        const oPos = outdoorList[uIdx] || outdoorList[0] || { x: uPos.x + 35, y: uPos.y + 35 };
                        const piping = routeOrthogonalRefrigerantPiping(oPos, [uPos]);

                        return (
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
                        );
                      })}

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

                  // Half width in world coordinates
                  const hw = Math.max(4 * symScale, (d.widthIn / 24) * project.scale * (symScale * 0.5));
                  const isReturn = d.type === 'return';
                  const isTrunk = d.type === 'trunk';

                  const casingColor = isReturn ? '#64748b' : isTrunk ? '#06b6d4' : '#38bdf8';
                  const fillColor = isReturn ? 'rgba(100, 116, 139, 0.18)' : 'rgba(6, 182, 212, 0.18)';
                  const centerColor = isReturn ? '#94a3b8' : '#22d3ee';

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
                    <Group key={d.id}>
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
                            strokeWidth={getStrokeWidth(1.6, 1.6)}
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
                          strokeWidth={getStrokeWidth(1.0, 1.0)}
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

                      {/* Bright Yellow CFM Callout directly along duct branch (Matching CAD Reference Drawing) */}
                      {annotationVisibility.ductCfm && (
                        <Text
                          x={mx - 25 * symScale}
                          y={my - (hw + 12 * symScale)}
                          text={`${d.cfm} CFM`}
                          fontSize={Math.max(8.5 * symScale, 9 / stageScale)}
                          fill="#facc15"
                          fontStyle="bold"
                        />
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
                {zone.diffusers.map((dif) => (
                  <Group
                    key={dif.id}
                    x={dif.x}
                    y={dif.y}
                    draggable={lodTier >= 2}
                    onDragMove={(e) => handleDiffuserDrag(zone.id, dif.id, e.target.x(), e.target.y())}
                  >
                    {dif.type === 'return' ? (
                      <Group>
                        {/* Return Air Grille (RG-1) Engineering Symbol */}
                        {annotationVisibility.diffusers && (
                          <>
                            <Rect
                              x={-14 * symScale}
                              y={-14 * symScale}
                              width={28 * symScale}
                              height={28 * symScale}
                              fill="rgba(88, 28, 135, 0.35)"
                              stroke="#c084fc"
                              strokeWidth={getStrokeWidth(1.8, 1.8)}
                              cornerRadius={2}
                            />
                            {/* Inner Return Intake Box */}
                            <Rect
                              x={-10 * symScale}
                              y={-10 * symScale}
                              width={20 * symScale}
                              height={20 * symScale}
                              stroke="#c084fc"
                              strokeWidth={getStrokeWidth(1.0, 1.0)}
                              fill="rgba(192, 132, 252, 0.1)"
                            />
                            {/* Single Diagonal Slash across Return Grille (standard MEP symbol) */}
                            <Line
                              points={[-14 * symScale, -14 * symScale, 14 * symScale, 14 * symScale]}
                              stroke="#c084fc"
                              strokeWidth={getStrokeWidth(1.6, 1.6)}
                            />
                            {/* Return Air Inward Chevrons */}
                            <Line points={[-6 * symScale, -3 * symScale, 0, 0, -6 * symScale, 3 * symScale]} stroke="#e879f9" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                            <Line points={[6 * symScale, -3 * symScale, 0, 0, 6 * symScale, 3 * symScale]} stroke="#e879f9" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                          </>
                        )}

                        {/* Yellow CFM Tag (Always visible per CAD Reference) */}
                        {annotationVisibility.diffuserCfm && (
                          <Text
                            x={-15 * symScale}
                            y={16 * symScale}
                            text={`${dif.cfm} CFM`}
                            fontSize={Math.max(8.5 * symScale, 9 / stageScale)}
                            fill="#facc15"
                            fontStyle="bold"
                          />
                        )}

                        {/* Standard MEP Return Grille Tag (LOD Tier 2+) */}
                        {annotationVisibility.diffuserTags && lodTier >= 2 && (
                          <Group x={16 * symScale} y={-10 * symScale}>
                            <Text
                              x={0}
                              y={0}
                              text={`RG-1 (${dif.size || '24"x12"'})`}
                              fontSize={Math.max(9 * symScale, 9.5 / stageScale)}
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
                        {/* Square Ceiling Diffuser (CD-1) Engineering Symbol */}
                        {annotationVisibility.diffusers && (
                          <>
                            <Rect
                              x={-12 * symScale}
                              y={-12 * symScale}
                              width={24 * symScale}
                              height={24 * symScale}
                              fill="rgba(5, 150, 105, 0.35)"
                              stroke="#10b981"
                              strokeWidth={getStrokeWidth(1.8, 1.8)}
                              cornerRadius={2}
                            />
                            {/* Inner Concentric Core Square */}
                            <Rect
                              x={-7 * symScale}
                              y={-7 * symScale}
                              width={14 * symScale}
                              height={14 * symScale}
                              stroke="#10b981"
                              strokeWidth={getStrokeWidth(1.2, 1.2)}
                              fill="rgba(16, 185, 129, 0.15)"
                            />
                            {/* 4-Way Radial Airflow Discharge Arrows */}
                            <Line points={[0, -7 * symScale, 0, -12 * symScale, -3 * symScale, -9 * symScale, 0, -12 * symScale, 3 * symScale, -9 * symScale]} stroke="#34d399" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                            <Line points={[0, 7 * symScale, 0, 12 * symScale, -3 * symScale, 9 * symScale, 0, 12 * symScale, 3 * symScale, 9 * symScale]} stroke="#34d399" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                            <Line points={[-7 * symScale, 0, -12 * symScale, 0, -9 * symScale, -3 * symScale, -12 * symScale, 0, -9 * symScale, 3 * symScale]} stroke="#34d399" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                            <Line points={[7 * symScale, 0, 12 * symScale, 0, 9 * symScale, -3 * symScale, 12 * symScale, 0, 9 * symScale, 3 * symScale]} stroke="#34d399" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                          </>
                        )}

                        {/* Yellow CFM Tag (Always visible per CAD Reference) */}
                        {annotationVisibility.diffuserCfm && (
                          <Text
                            x={-15 * symScale}
                            y={16 * symScale}
                            text={`${dif.cfm} CFM`}
                            fontSize={Math.max(8.5 * symScale, 9 / stageScale)}
                            fill="#facc15"
                            fontStyle="bold"
                          />
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
                ))}

                {/* Multiple Indoor Units (FCU / Concealed Split / AHU / RTU) */}
                {annotationVisibility.indoorUnits && (() => {
                  const unitList = zone.unitPositions && zone.unitPositions.length > 0
                    ? zone.unitPositions
                    : zone.unitPos
                    ? [zone.unitPos]
                    : [];

                  return unitList.map((pos, uIdx) => (
                    <Group
                      key={`unit-${zone.id}-${uIdx}`}
                      x={pos.x}
                      y={pos.y}
                      draggable={lodTier >= 2}
                      onDragMove={(e) => {
                        if (uIdx === 0) handleIndoorUnitDrag(zone.id, e.target.x(), e.target.y());
                      }}
                    >
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

                  return outdoorList.map((oPos, oIdx) => (
                    <Group
                      key={`odu-${zone.id}-${oIdx}`}
                      x={oPos.x}
                      y={oPos.y}
                      draggable={lodTier >= 2}
                      onDragMove={(e) => {
                        if (oIdx === 0) handleOutdoorUnitDrag(zone.id, e.target.x(), e.target.y());
                      }}
                    >
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
                {annotationVisibility.zoneLabels && (
                  <>
                    <Text
                      x={centroid.x - 70 / stageScale}
                      y={centroid.y - 14 / stageScale}
                      text={zone.name}
                      fontSize={Math.max(13, 13 / stageScale)}
                      fontStyle="bold"
                      fill={isSelected ? '#3b82f6' : '#d4d4d4'}
                      align="center"
                      width={140 / stageScale}
                    />
                    <Text
                      x={centroid.x - 70 / stageScale}
                      y={centroid.y + 3 / stageScale}
                      text={`${zone.diffusers.length > 0 ? zone.diffusers.reduce((s, d) => s + d.cfm, 0) : load.supplyCfm} ${project.units === 'imperial' ? 'CFM' : 'L/s'} (${zone.systemType || 'concealed'})`}
                      fontSize={Math.max(11, 11 / stageScale)}
                      fontStyle="bold"
                      fill="#10b981"
                      align="center"
                      width={140 / stageScale}
                    />
                  </>
                )}

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
                      onDragMove={(e) => {
                        handleVertexDrag(zone.id, idx, e.target.x(), e.target.y());
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

              {/* Ghost Indoor Unit */}
              {activePreview.manifest.equipment.indoorUnit && (() => {
                const eqScale = project.equipmentScale || 2.0;
                const symScale = eqScale * 1.5;

                return (
                  <Group
                    x={activePreview.manifest.equipment.indoorUnit.position.x}
                    y={activePreview.manifest.equipment.indoorUnit.position.y}
                  >
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
                      text={`PREVIEW: ${activePreview.manifest.equipment.indoorUnit.model}`}
                      fontSize={Math.min(11, Math.max(6, (7 * symScale) / stageScale))}
                      fill="#34d399"
                      fontStyle="bold"
                    />
                  </Group>
                );
              })()}

              {/* Ghost Outdoor Unit */}
              {activePreview.manifest.equipment.outdoorUnit && (() => {
                const eqScale = project.equipmentScale || 2.0;
                const symScale = eqScale * 1.5;

                return (
                  <Group
                    x={activePreview.manifest.equipment.outdoorUnit.position.x}
                    y={activePreview.manifest.equipment.outdoorUnit.position.y}
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
                      text={`PREVIEW ODU`}
                      fontSize={Math.min(11, Math.max(6, (7 * symScale) / stageScale))}
                      fill="#f43f5e"
                      fontStyle="bold"
                    />
                  </Group>
                );
              })()}
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
