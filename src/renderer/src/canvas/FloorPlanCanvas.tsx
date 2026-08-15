import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Line, Circle, Text, Group, Shape, Rect } from 'react-konva';
import { useProjectStore } from '../store/projectStore';
import { snapToGrid, getPolygonCentroid } from '../engine/geometry';
import { calculateZoneLoad } from '../engine/loadCalc';
import { routeDucts } from '../engine/ductRouter';
import { routeOrthogonalRefrigerantPiping } from '../engine/spatialPlanner';
import Konva from 'konva';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, Target } from 'lucide-react';

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
    activePreview
  } = useProjectStore();

  const stageRef = useRef<Konva.Stage>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [stageScale, setStageScale] = useState<number>(1);
  const [stagePos, setStagePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
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

  // Global mouseup listener for middle click panning
  useEffect(() => {
    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (e.button === 1) {
        setIsPanning(false);
        const container = stageRef.current?.container();
        if (container) {
          container.style.cursor = drawMode === 'pan' ? 'grab' : 'crosshair';
        }
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [drawMode]);

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
    if (e.evt.button === 1) {
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
    if (e.evt.button !== 0) return;

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

  // Cursor-anchored wheel zooming
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const scaleBy = 1.12;
    const oldScale = stageScale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };

    let newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    newScale = Math.min(Math.max(newScale, 0.04), 25.0);

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

  const handleUnitDrag = (zoneId: string, newX: number, newY: number) => {
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
    if (lodTier === 1) return null; // Declutter grid at far zoom
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
        draggable={drawMode === 'pan'}
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
        style={{ cursor: drawMode === 'pan' ? 'grab' : 'crosshair' }}
      >
        <Layer>
          {drawGridLines()}

          {/* DXF CAD Underlay Geometry */}
          {dxfEntities.length > 0 && (
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
          )}

          {/* DXF CAD Text elements (LOD Tier 2+) */}
          {dxfEntities.length > 0 && lodTier >= 2 && (
            <Shape
              sceneFunc={(context) => {
                context.save();
                context.fillStyle = '#666666';
                const fontSize = Math.max(6, 9 / stageScale);
                context.font = `${fontSize}px sans-serif`;

                for (const ent of dxfEntities) {
                  if ((ent.type === 'TEXT' || ent.type === 'MTEXT') && ent.text) {
                    context.fillText(ent.text, ent.x || 0, ent.y || 0);
                  }
                }
                context.restore();
              }}
              hitFunc={() => {}}
              opacity={0.45}
            />
          )}

          {/* Zones Rendering */}
          {zones.map((zone) => {
            const isSelected = zone.id === selectedZoneId;
            const centroid = getPolygonCentroid(zone.points);
            const load = calculateZoneLoad(zone, project);
            const isDucted = zone.systemType === 'concealed' || zone.systemType === 'packaged' || zone.systemType === 'ahu';

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

                {/* Orthogonal Solid Copper Refrigerant Line Set & Yellow MEP Callout Tag */}
                {zone.outdoorUnitPos && (zone.unitPos || zone.diffusers.length > 0) && (() => {
                  const targets = zone.systemType === 'cassette'
                    ? zone.diffusers.map((d) => ({ x: d.x, y: d.y }))
                    : zone.unitPos
                    ? [zone.unitPos]
                    : zone.diffusers.length > 0
                    ? [{ x: zone.diffusers[0].x, y: zone.diffusers[0].y }]
                    : [];

                  if (targets.length === 0) return null;

                  const piping = routeOrthogonalRefrigerantPiping(zone.outdoorUnitPos, targets);

                  const totalBtu = load.totalLoad;
                  const qty = zone.catalogQty || (zone.systemType === 'cassette' ? zone.diffusers.length : 1);
                  const btuPerUnit = Math.round(totalBtu / Math.max(1, qty));
                  const cfmPerUnit = Math.round((zone.diffusers.length > 0 ? zone.diffusers.reduce((s, d) => s + d.cfm, 0) : load.supplyCfm) / Math.max(1, qty));
                  const sysLabel = zone.systemType === 'cassette'
                    ? `${qty > 1 ? `${qty}-` : ''}CASSETTE SPLIT`
                    : zone.systemType === 'high-wall'
                    ? `${qty > 1 ? `${qty}-` : ''}HIGH WALL SPLIT`
                    : `${qty > 1 ? `${qty}-` : ''}CONCEALED DUCTED`;

                  return (
                    <Group>
                      {/* Orthogonal Solid Bright Orange Copper Pipe Segments */}
                      {piping.segments.map((seg, sIdx) => (
                        <Line
                          key={`ref-seg-${zone.id}-${sIdx}`}
                          points={seg}
                          stroke="#f97316"
                          strokeWidth={getStrokeWidth(2.5 * Math.min(1.8, symScale), 2.5)}
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

                      {/* Yellow Engineering Callout Tag with Leader Line (Matching Reference CAD Drawing) */}
                      {lodTier >= 2 && (
                        <Group x={zone.outdoorUnitPos.x + 24 * symScale} y={zone.outdoorUnitPos.y - 36 * symScale}>
                          <Line
                            points={[-6 * symScale, 20 * symScale, -18 * symScale, 30 * symScale]}
                            stroke="#facc15"
                            strokeWidth={getStrokeWidth(1.0, 1.0)}
                          />
                          <Text
                            x={0}
                            y={0}
                            text={`${sysLabel}\n${btuPerUnit.toLocaleString()} BTU/HR${qty > 1 ? '-EACH' : ''}\n${cfmPerUnit} CFM${qty > 1 ? '-EACH' : ''}`}
                            fontSize={Math.min(13, Math.max(7, (8 * symScale) / stageScale))}
                            fill="#facc15"
                            fontStyle="bold"
                          />
                        </Group>
                      )}
                    </Group>
                  );
                })()}

                {/* Duct Network (Double-Line Physical Walls, Flow Arrows & Air Distribution Badges) */}
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

                  const casingColor = isReturn ? '#64748b' : isTrunk ? '#2563eb' : '#3b82f6';
                  const fillColor = isReturn ? 'rgba(100, 116, 139, 0.22)' : 'rgba(37, 99, 235, 0.22)';
                  const centerColor = isReturn ? '#94a3b8' : '#60a5fa';

                  const mx = (x1 + x2) / 2;
                  const my = (y1 + y2) / 2;

                  // Midpoint for flow arrow (60% along segment)
                  const ax = x1 + dx * 0.6;
                  const ay = y1 + dy * 0.6;
                  const ux = dx / len;
                  const uy = dy / len;
                  const arrowLen = Math.min(12 * symScale, len * 0.25);

                  const vel = d.velocityFpm || Math.round(d.cfm / Math.max(0.1, (d.widthIn * d.heightIn) / 144));
                  const ductTag = `${d.sizeLabel} | ${d.cfm} CFM | ${vel} FPM`;

                  return (
                    <Group key={d.id}>
                      {/* Filled Duct Body Polygon */}
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
                        strokeWidth={getStrokeWidth(1.4, 1.4)}
                      />

                      {/* Centerline Axis */}
                      <Line
                        points={[x1, y1, x2, y2]}
                        stroke={centerColor}
                        strokeWidth={getStrokeWidth(1.0, 1.0)}
                        dash={[5, 4]}
                        opacity={0.8}
                      />

                      {/* Directional Flow Chevron Arrow */}
                      {len > 20 && (
                        <Line
                          points={[
                            ax - ux * arrowLen + nx * (hw * 0.5),
                            ay - uy * arrowLen + ny * (hw * 0.5),
                            ax,
                            ay,
                            ax - ux * arrowLen - nx * (hw * 0.5),
                            ay - uy * arrowLen - ny * (hw * 0.5)
                          ]}
                          stroke={isReturn ? '#cbd5e1' : '#ffffff'}
                          strokeWidth={getStrokeWidth(1.4, 1.4)}
                          lineCap="round"
                          lineJoin="round"
                        />
                      )}

                      {/* Air Distribution Callout Badge */}
                      {lodTier >= 2 && (
                        <Group x={mx} y={my}>
                          <Rect
                            x={-42 * Math.min(1.5, symScale)}
                            y={-9 * Math.min(1.5, symScale)}
                            width={84 * Math.min(1.5, symScale)}
                            height={18 * Math.min(1.5, symScale)}
                            fill="rgba(15, 23, 42, 0.85)"
                            stroke={casingColor}
                            strokeWidth={getStrokeWidth(0.8, 0.8)}
                            cornerRadius={4}
                          />
                          <Text
                            x={-40 * Math.min(1.5, symScale)}
                            y={-6 * Math.min(1.5, symScale)}
                            width={80 * Math.min(1.5, symScale)}
                            text={ductTag}
                            fontSize={Math.min(10, Math.max(5.5, (6.5 * Math.min(1.5, symScale)) / stageScale))}
                            fill={isReturn ? '#cbd5e1' : '#93c5fd'}
                            fontStyle="bold"
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
                    {zone.systemType === 'cassette' ? (
                      <Group>
                        {/* Cassette Square Box (Prominently Scaled) */}
                        <Rect
                          x={-16 * symScale}
                          y={-16 * symScale}
                          width={32 * symScale}
                          height={32 * symScale}
                          fill="rgba(15, 23, 42, 0.65)"
                          stroke="#38bdf8"
                          strokeWidth={getStrokeWidth(1.8, 1.8)}
                          cornerRadius={3}
                        />
                        {/* 4 Corner Flange Mounting Tabs */}
                        <Line points={[-16 * symScale, -13 * symScale, -16 * symScale, -16 * symScale, -13 * symScale, -16 * symScale]} stroke="#ffffff" strokeWidth={getStrokeWidth(1.4, 1.4)} />
                        <Line points={[16 * symScale, -13 * symScale, 16 * symScale, -16 * symScale, 13 * symScale, -16 * symScale]} stroke="#ffffff" strokeWidth={getStrokeWidth(1.4, 1.4)} />
                        <Line points={[-16 * symScale, 13 * symScale, -16 * symScale, 16 * symScale, -13 * symScale, 16 * symScale]} stroke="#ffffff" strokeWidth={getStrokeWidth(1.4, 1.4)} />
                        <Line points={[16 * symScale, 13 * symScale, 16 * symScale, 16 * symScale, 13 * symScale, 16 * symScale]} stroke="#ffffff" strokeWidth={getStrokeWidth(1.4, 1.4)} />

                        {/* Center Return Grille Square with Mesh */}
                        <Rect
                          x={-8 * symScale}
                          y={-8 * symScale}
                          width={16 * symScale}
                          height={16 * symScale}
                          stroke="#94a3b8"
                          strokeWidth={getStrokeWidth(1.0, 1.0)}
                          fill="rgba(30, 41, 59, 0.5)"
                        />
                        <Line points={[-8 * symScale, 0, 8 * symScale, 0]} stroke="#64748b" strokeWidth={getStrokeWidth(0.8, 0.8)} />
                        <Line points={[0, -8 * symScale, 0, 8 * symScale]} stroke="#64748b" strokeWidth={getStrokeWidth(0.8, 0.8)} />

                        {/* 4-Way Directional Outward Flow Discharge Chevrons */}
                        <Line points={[-3 * symScale, -11 * symScale, 0, -15 * symScale, 3 * symScale, -11 * symScale]} stroke="#38bdf8" strokeWidth={getStrokeWidth(1.4, 1.4)} />
                        <Line points={[-3 * symScale, 11 * symScale, 0, 15 * symScale, 3 * symScale, 11 * symScale]} stroke="#38bdf8" strokeWidth={getStrokeWidth(1.4, 1.4)} />
                        <Line points={[-11 * symScale, -3 * symScale, -15 * symScale, 0, -11 * symScale, 3 * symScale]} stroke="#38bdf8" strokeWidth={getStrokeWidth(1.4, 1.4)} />
                        <Line points={[11 * symScale, -3 * symScale, 15 * symScale, 0, 11 * symScale, 3 * symScale]} stroke="#38bdf8" strokeWidth={getStrokeWidth(1.4, 1.4)} />

                        {/* Yellow Circular Tag (F) */}
                        <Group x={18 * symScale} y={18 * symScale}>
                          <Circle x={0} y={0} radius={5 * Math.min(1.8, symScale)} fill="#facc15" stroke="#000000" strokeWidth={0.8} />
                          <Text x={-3 * Math.min(1.8, symScale)} y={-4 * Math.min(1.8, symScale)} text="F" fontSize={6 * Math.min(1.8, symScale)} fill="#000000" fontStyle="bold" />
                        </Group>
                      </Group>
                    ) : zone.systemType === 'high-wall' ? (
                      <Group>
                        {/* High Wall Indoor Unit */}
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
                      </Group>
                    ) : (
                      <Group>
                        {/* Square Ceiling Diffuser (CD-1) Engineering Symbol (Prominently Scaled) */}
                        <Rect
                          x={-12 * symScale}
                          y={-12 * symScale}
                          width={24 * symScale}
                          height={24 * symScale}
                          fill="rgba(15, 23, 42, 0.7)"
                          stroke="#38bdf8"
                          strokeWidth={getStrokeWidth(1.6, 1.6)}
                        />
                        {/* Inner Round Neck Circle */}
                        <Circle
                          x={0}
                          y={0}
                          radius={7 * symScale}
                          stroke="#38bdf8"
                          strokeWidth={getStrokeWidth(1.2, 1.2)}
                        />
                        {/* 4 Diagonal Corner Cross Lines (from circle to outer square corners) */}
                        <Line points={[-4.8 * symScale, -4.8 * symScale, -12 * symScale, -12 * symScale]} stroke="#38bdf8" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                        <Line points={[4.8 * symScale, -4.8 * symScale, 12 * symScale, -12 * symScale]} stroke="#38bdf8" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                        <Line points={[-4.8 * symScale, 4.8 * symScale, -12 * symScale, 12 * symScale]} stroke="#38bdf8" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                        <Line points={[4.8 * symScale, 4.8 * symScale, 12 * symScale, 12 * symScale]} stroke="#38bdf8" strokeWidth={getStrokeWidth(1.2, 1.2)} />
                        {/* Center Connection Node Dot */}
                        <Circle x={0} y={0} radius={2 * Math.min(1.8, symScale)} fill="#38bdf8" />

                        {/* Standard MEP Diffuser Tag: CD-1 / line / CFM */}
                        {lodTier >= 2 && (
                          <Group x={15 * symScale} y={-10 * symScale}>
                            <Text
                              x={0}
                              y={0}
                              text={`CD-1`}
                              fontSize={Math.min(12, Math.max(6.5, (7.5 * symScale) / stageScale))}
                              fill="#facc15"
                              fontStyle="bold"
                            />
                            <Line
                              points={[0, 11 * Math.min(1.5, symScale), 28 * Math.min(1.5, symScale), 11 * Math.min(1.5, symScale)]}
                              stroke="#facc15"
                              strokeWidth={getStrokeWidth(0.9, 0.9)}
                            />
                            <Text
                              x={0}
                              y={13 * Math.min(1.5, symScale)}
                              text={`${dif.cfm}`}
                              fontSize={Math.min(12, Math.max(6.5, (7.5 * symScale) / stageScale))}
                              fill="#facc15"
                              fontStyle="bold"
                            />
                          </Group>
                        )}

                        {/* LOD Tier 3+: Throw radius ring */}
                        {lodTier >= 3 && (
                          <Circle
                            x={0}
                            y={0}
                            radius={28 * symScale}
                            stroke="rgba(56, 189, 248, 0.2)"
                            strokeWidth={getStrokeWidth(0.6, 0.8)}
                            dash={[4, 3]}
                          />
                        )}
                      </Group>
                    )}
                  </Group>
                ))}

                {/* High-Wall Indoor Unit (Mounted along wall inside room with 3 radial discharge rays) */}
                {zone.unitPos && zone.systemType === 'high-wall' && (
                  <Group
                    x={zone.unitPos.x}
                    y={zone.unitPos.y}
                    draggable={lodTier >= 2}
                    onDragMove={(e) => handleUnitDrag(zone.id, e.target.x(), e.target.y())}
                  >
                    {/* Unit casing body */}
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

                    {/* 3 Radial Air Discharge Throw Rays radiating into room space */}
                    <Line points={[-10 * symScale, 5 * symScale, -15 * symScale, 15 * symScale]} stroke="#f97316" strokeWidth={getStrokeWidth(1.4, 1.4)} />
                    <Line points={[0, 5 * symScale, 0, 17 * symScale]} stroke="#f97316" strokeWidth={getStrokeWidth(1.4, 1.4)} />
                    <Line points={[10 * symScale, 5 * symScale, 15 * symScale, 15 * symScale]} stroke="#f97316" strokeWidth={getStrokeWidth(1.4, 1.4)} />

                    {/* Yellow Circular Tag (P) */}
                    <Group x={20 * symScale} y={-5 * symScale}>
                      <Circle x={0} y={0} radius={5 * Math.min(1.8, symScale)} fill="#facc15" stroke="#000000" strokeWidth={0.8} />
                      <Text x={-3 * Math.min(1.8, symScale)} y={-4 * Math.min(1.8, symScale)} text="P" fontSize={6 * Math.min(1.8, symScale)} fill="#000000" fontStyle="bold" />
                    </Group>
                  </Group>
                )}

                {/* Detailed Indoor Unit FCU / AHU (Ducted Systems) */}
                {zone.unitPos && isDucted && (
                  <Group
                    x={zone.unitPos.x}
                    y={zone.unitPos.y}
                    draggable={lodTier >= 2}
                    onDragMove={(e) => handleUnitDrag(zone.id, e.target.x(), e.target.y())}
                  >
                    {/* FCU Housing Box */}
                    <Rect
                      x={-24 * symScale}
                      y={-12 * symScale}
                      width={48 * symScale}
                      height={24 * symScale}
                      fill="rgba(16, 185, 129, 0.3)"
                      stroke="#10b981"
                      strokeWidth={getStrokeWidth(1.8, 1.8)}
                      cornerRadius={3}
                    />
                    {/* Cooling coil diagonal hatch */}
                    <Line points={[-14 * symScale, -9 * symScale, -7 * symScale, 9 * symScale]} stroke="#34d399" strokeWidth={getStrokeWidth(1.0, 1.0)} />
                    <Line points={[-7 * symScale, -9 * symScale, 0, 9 * symScale]} stroke="#34d399" strokeWidth={getStrokeWidth(1.0, 1.0)} />
                    <Line points={[0, -9 * symScale, 7 * symScale, 9 * symScale]} stroke="#34d399" strokeWidth={getStrokeWidth(1.0, 1.0)} />
                    {/* Fan blower scroll circle */}
                    <Circle x={14 * symScale} y={0} radius={7 * symScale} stroke="#10b981" strokeWidth={getStrokeWidth(1.2, 1.2)} />

                    <Text
                      x={-22 * symScale}
                      y={-6 * symScale}
                      text={`FCU x${zone.catalogQty || 1} (${zone.diffusers.length > 0 ? zone.diffusers.reduce((s, d) => s + d.cfm, 0) : load.supplyCfm} CFM)`}
                      fontSize={Math.min(12, Math.max(6.5, (7.5 * symScale) / stageScale))}
                      fill="#10b981"
                      fontStyle="bold"
                    />
                    {zone.catalogModel && lodTier >= 2 && (
                      <Text
                        x={-22 * symScale}
                        y={16 * symScale}
                        text={`Model: ${zone.catalogModel}`}
                        fontSize={Math.min(11, Math.max(6, (7 * symScale) / stageScale))}
                        fill="#a7f3d0"
                        fontStyle="bold"
                      />
                    )}
                  </Group>
                )}

                {/* Detailed Outdoor Unit ODU Symbol (Matching Reference Drawing) */}
                {zone.outdoorUnitPos && (
                  <Group
                    x={zone.outdoorUnitPos.x}
                    y={zone.outdoorUnitPos.y}
                    draggable={lodTier >= 2}
                    onDragMove={(e) => handleOutdoorUnitDrag(zone.id, e.target.x(), e.target.y())}
                  >
                    {/* ODU Condenser Box */}
                    <Rect
                      x={-18 * symScale}
                      y={-10 * symScale}
                      width={36 * symScale}
                      height={20 * symScale}
                      fill="rgba(6, 182, 212, 0.3)"
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

                    {/* Yellow Circular Tag (P) on outdoor unit */}
                    <Group x={20 * symScale} y={-8 * symScale}>
                      <Circle x={0} y={0} radius={5 * Math.min(1.8, symScale)} fill="#facc15" stroke="#000000" strokeWidth={0.8} />
                      <Text x={-3 * Math.min(1.8, symScale)} y={-4 * Math.min(1.8, symScale)} text="P" fontSize={6 * Math.min(1.8, symScale)} fill="#000000" fontStyle="bold" />
                    </Group>
                  </Group>
                )}

                {/* Centroid Labels */}
                <Text
                  x={centroid.x - 50 / stageScale}
                  y={centroid.y - 12 / stageScale}
                  text={zone.name}
                  fontSize={10 / stageScale}
                  fontStyle="bold"
                  fill={isSelected ? '#3b82f6' : '#d4d4d4'}
                  align="center"
                  width={100 / stageScale}
                />
                <Text
                  x={centroid.x - 50 / stageScale}
                  y={centroid.y + 2 / stageScale}
                  text={`${zone.diffusers.length > 0 ? zone.diffusers.reduce((s, d) => s + d.cfm, 0) : load.supplyCfm} ${project.units === 'imperial' ? 'CFM' : 'L/s'} (${zone.systemType || 'concealed'})`}
                  fontSize={9 / stageScale}
                  fontStyle="bold"
                  fill="#10b981"
                  align="center"
                  width={100 / stageScale}
                />

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
      </div>

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
