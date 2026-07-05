import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Line, Circle, Text, Group, Shape, Rect } from 'react-konva';
import { useProjectStore } from '../store/projectStore';
import { snapToGrid, getPolygonCentroid } from '../engine/geometry';
import { calculateZoneLoad } from '../engine/loadCalc';
import Konva from 'konva';

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
    dxfEntities,
    dxfBoundingBox
  } = useProjectStore();

  const stageRef = useRef<Konva.Stage>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [stageScale, setStageScale] = useState<number>(1);
  const [stagePos, setStagePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Auto-scale and center the viewport to fit the DXF drawing
  useEffect(() => {
    if (dxfBoundingBox) {
      const stageWidth = 900;
      const stageHeight = 500;
      const dxfWidth = dxfBoundingBox.maxX - dxfBoundingBox.minX;
      const dxfHeight = dxfBoundingBox.maxY - dxfBoundingBox.minY;

      if (dxfWidth > 0 && dxfHeight > 0) {
        const scaleX = stageWidth / dxfWidth;
        const scaleY = stageHeight / dxfHeight;
        // Fit with a 15% margin
        const newScale = Math.min(scaleX, scaleY) * 0.85;

        const centerX = dxfBoundingBox.minX + dxfWidth / 2;
        const centerY = dxfBoundingBox.minY + dxfHeight / 2;

        const newX = stageWidth / 2 - centerX * newScale;
        // Invert Y or standard translation depending on AutoCAD Y coords (usually Y is positive up, we align it visually)
        const newY = stageHeight / 2 - centerY * newScale;

        setStageScale(newScale);
        setStagePos({ x: newX, y: newY });
      }
    }
  }, [dxfBoundingBox]);

  // Grid sizing based on unit system
  const gridSpacing = project.units === 'imperial' ? 10 : 10; // snaps every 10px (1ft in imperial, ~30cm in metric)

  // Handle stage mouse move (draw cursor update)
  const handleMouseMove = () => {
    const stage = stageRef.current;
    if (!stage) return;

    const transform = stage.getAbsoluteTransform().copy().invert();
    const pos = stage.getPointerPosition();
    if (!pos) return;

    const localPos = transform.point(pos);
    setMousePos({
      x: snapToGrid(localPos.x, gridSpacing),
      y: snapToGrid(localPos.y, gridSpacing),
    });
  };

  // Handle stage click (draw vertex)
  const handleContentClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // Left click only
    if (e.evt.button !== 0) return;

    if (drawMode === 'polyline') {
      const sx = mousePos.x;
      const sy = mousePos.y;
      addTempPoint(sx, sy);
    }
  };

  // Finish drawing zone (double click)
  const handleDoubleClick = () => {
    if (drawMode === 'polyline' && tempPoints.length >= 6) {
      // Add the final zone
      addZone(tempPoints);
      clearTempPoints();
    }
  };

  // Rescale zoom on mouse wheel
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const scaleBy = 1.1;
    const oldScale = stageScale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };

    let newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    newScale = Math.min(Math.max(newScale, 0.0001), 100); // limit scale to allow high-range CAD zooming

    setStageScale(newScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  // Drag vertex handler
  const handleVertexDrag = (zoneId: string, pointIdx: number, newX: number, newY: number) => {
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;

    const updatedPoints = [...zone.points];
    updatedPoints[pointIdx * 2] = snapToGrid(newX, gridSpacing);
    updatedPoints[pointIdx * 2 + 1] = snapToGrid(newY, gridSpacing);
    
    updateZone(zoneId, { points: updatedPoints });
  };

  // Draw grid lines
  const drawGridLines = () => {
    const lines: React.ReactNode[] = [];
    const size = 2000;
    for (let i = -size; i < size; i += gridSpacing * 5) {
      // Thicker lines every 5 subdivisions
      const isMajor = i % (gridSpacing * 25) === 0;
      const strokeColor = isMajor ? '#333333' : '#1f1f1f';
      const strokeWidth = isMajor ? 1 : 0.5;

      lines.push(
        <Line key={`h-${i}`} points={[-size, i, size, i]} stroke={strokeColor} strokeWidth={strokeWidth} />,
        <Line key={`v-${i}`} points={[i, -size, i, size]} stroke={strokeColor} strokeWidth={strokeWidth} />
      );
    }
    return lines;
  };

  return (
    <div className="relative w-full h-[65vh] bg-[#0c0c0c] border border-neutral-800 rounded-3xl overflow-hidden shadow-inner">
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
        onClick={handleContentClick}
        onDblClick={handleDoubleClick}
        style={{ cursor: drawMode === 'pan' ? 'grab' : 'crosshair' }}
      >
        <Layer>
          {/* Grid lines background */}
          {drawGridLines()}

          {/* DXF CAD Underlay - Geometry (single GPU draw call) */}
          {dxfEntities.length > 0 && (
            <Shape
              stroke="#525252"
              strokeWidth={1.2 / stageScale}
              sceneFunc={(context, shape) => {
                context.save();
                context.beginPath();

                for (const ent of dxfEntities) {
                  if (ent.type === 'LINE') {
                    context.moveTo(ent.x || 0, ent.y || 0);
                    context.lineTo(ent.points?.[0] || 0, ent.points?.[1] || 0);
                  } 
                  else if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && ent.points) {
                    const pts = ent.points;
                    if (pts.length >= 4) {
                      context.moveTo(pts[0], pts[1]);
                      for (let i = 2; i < pts.length; i += 2) {
                        context.lineTo(pts[i], pts[i + 1]);
                      }
                    }
                  }
                  else if ((ent.type === 'CIRCLE' || ent.type === 'ARC') && typeof ent.radius === 'number') {
                    context.moveTo((ent.x || 0) + ent.radius, ent.y || 0);
                    context.arc(ent.x || 0, ent.y || 0, ent.radius, 0, Math.PI * 2);
                  }
                }
                context.fillStrokeShape(shape);
                context.restore();
              }}
              hitFunc={() => {}} // 10x performance boost (disables Konva hit testing)
              opacity={0.45}
            />
          )}

          {/* DXF CAD Underlay - Text elements (drawn natively in canvas) */}
          {dxfEntities.length > 0 && (
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

          {/* Zones */}
          {zones.map((zone) => {
            const isSelected = zone.id === selectedZoneId;
            const centroid = getPolygonCentroid(zone.points);
            const load = calculateZoneLoad(zone, project);

            // Draw zone shapes
            return (
              <Group key={zone.id}>
                {/* Zone Area polygon */}
                <Line
                  points={zone.points}
                  closed
                  fill={isSelected ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.03)'}
                  stroke={isSelected ? '#3b82f6' : '#525252'}
                  strokeWidth={(isSelected ? 2.5 : 1.2) / stageScale}
                  onClick={() => selectZone(zone.id)}
                  onTap={() => selectZone(zone.id)}
                />

                {/* Diffusers placement */}
                {zone.diffusers.map((dif) => (
                  <Group key={dif.id}>
                    {/* Diffuser face border */}
                    <Circle x={dif.x} y={dif.y} radius={8 / stageScale} fill="#0d9488" stroke="#ffffff" strokeWidth={1.2 / stageScale} />
                    {/* Crossed arrows inside diffuser */}
                    <Line points={[dif.x - 6 / stageScale, dif.y, dif.x + 6 / stageScale, dif.y]} stroke="#ffffff" strokeWidth={1.2 / stageScale} />
                    <Line points={[dif.x, dif.y - 6 / stageScale, dif.x, dif.y + 6 / stageScale]} stroke="#ffffff" strokeWidth={1.2 / stageScale} />
                    <Text
                      x={dif.x + 10 / stageScale}
                      y={dif.y - 8 / stageScale}
                      text={`S.C.D ${dif.size || '9"x9"'}\n${dif.cfm} ${project.units === 'imperial' ? 'CFM' : 'L/s'}`}
                      fontSize={8 / stageScale}
                      fill="#0d9488"
                      fontStyle="bold"
                    />
                  </Group>
                ))}

                {/* Duct segments routing */}
                {zone.ducts.map((d) => {
                  const isTrunk = d.type === 'trunk';
                  const strokeW = isTrunk
                    ? Math.max(2.2 / stageScale, (d.widthIn / 12) * project.scale)
                    : Math.max(1.2 / stageScale, (d.widthIn / 12) * project.scale);
                  
                  return (
                    <Group key={d.id}>
                      {/* Render the Indoor Unit (FCU) at the beginning of the trunk */}
                      {isTrunk && d.id.endsWith('-0') && (
                        <Group 
                          x={d.points[0]} 
                          y={d.points[1]} 
                          rotation={Math.atan2(d.points[3] - d.points[1], d.points[2] - d.points[0]) * 180 / Math.PI}
                        >
                          <Rect
                            x={-35 / stageScale}
                            y={-10 / stageScale}
                            width={35 / stageScale}
                            height={20 / stageScale}
                            fill="rgba(16, 185, 129, 0.25)"
                            stroke="#10b981"
                            strokeWidth={1.5 / stageScale}
                            cornerRadius={2 / stageScale}
                          />
                          <Text
                            x={-28 / stageScale}
                            y={-5 / stageScale}
                            text="FCU"
                            fontSize={8 / stageScale}
                            fill="#10b981"
                            fontStyle="bold"
                          />
                        </Group>
                      )}

                      {/* Duct line */}
                      <Line
                        points={d.points}
                        stroke={isTrunk ? '#2563eb' : '#3b82f6'}
                        strokeWidth={strokeW}
                        opacity={0.8}
                        lineCap="round"
                        lineJoin="round"
                      />
                      
                      {/* Duct dimension label */}
                      <Text
                        x={(d.points[0] + d.points[2]) / 2}
                        y={(d.points[1] + d.points[3]) / 2 - 12 / stageScale}
                        text={d.sizeLabel}
                        fontSize={8 / stageScale}
                        fill="#93c5fd"
                        fontStyle="bold"
                        align="center"
                      />
                    </Group>
                  );
                })}

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
                  text={`${load.supplyCfm} ${project.units === 'imperial' ? 'CFM' : 'L/s'}`}
                  fontSize={9 / stageScale}
                  fontStyle="bold"
                  fill="#10b981"
                  align="center"
                  width={100 / stageScale}
                />

                {/* Interactive Editable Vertices (show only on selection) */}
                {isSelected &&
                  Array.from({ length: zone.points.length / 2 }).map((_, idx) => (
                    <Circle
                      key={`v-${zone.id}-${idx}`}
                      x={zone.points[idx * 2]}
                      y={zone.points[idx * 2 + 1]}
                      radius={5 / stageScale}
                      fill="#3b82f6"
                      stroke="#ffffff"
                      strokeWidth={1 / stageScale}
                      draggable
                      onDragMove={(e) => {
                        handleVertexDrag(zone.id, idx, e.target.x(), e.target.y());
                      }}
                    />
                  ))}
              </Group>
            );
          })}

          {/* Draw mode: temp polyline in progress */}
          {tempPoints.length > 0 && (
            <Group>
              <Line
                points={[...tempPoints, mousePos.x, mousePos.y]}
                stroke="#60a5fa"
                strokeWidth={1.5 / stageScale}
                dash={[4 / stageScale, 4 / stageScale]}
              />
              <Line points={tempPoints} stroke="#3b82f6" strokeWidth={2 / stageScale} />
              {Array.from({ length: tempPoints.length / 2 }).map((_, idx) => (
                <Circle
                  key={`t-v-${idx}`}
                  x={tempPoints[idx * 2]}
                  y={tempPoints[idx * 2 + 1]}
                  radius={4 / stageScale}
                  fill="#3b82f6"
                />
              ))}
            </Group>
          )}
        </Layer>
      </Stage>
      
      {/* HUD Info panel Overlay */}
      <div className="absolute top-4 left-4 bg-neutral-900/80 border border-neutral-800 px-3.5 py-2 rounded-xl text-[10px] text-neutral-400 font-medium backdrop-blur shadow">
        Grid Size: {gridSpacing}px | Mode: <strong className="text-blue-500 capitalize">{drawMode}</strong>
      </div>
    </div>
  );
};
