import React, { useState, useEffect, useRef } from 'react';
import { Toolbar } from './components/Toolbar';
import { FloorPlanCanvas } from './canvas/FloorPlanCanvas';
import { ZonePropertiesPanel } from './panels/ZonePropertiesPanel';
import { OptimizerStudioPanel } from './panels/OptimizerStudioPanel';
import { StaticPressurePanel } from './panels/StaticPressurePanel';
import { SystemComparisonTable } from './panels/SystemComparisonTable';
import { LoadSummaryPanel } from './panels/LoadSummaryPanel';
import { AirDistributionSchedulePanel } from './panels/AirDistributionSchedulePanel';
import { AiHvacAssistantModal } from './components/AiHvacAssistantModal';
import { useProjectStore } from './store/projectStore';
import Versions from './components/Versions';
import { CadUnderstandingPanel } from './panels/CadUnderstandingPanel';
import { StandardsProfilePanel } from './panels/StandardsProfilePanel';
import {
  Wind,
  Sparkles,
  Gauge,
  Award,
  Table,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  MousePointer,
  PenTool,
  Hand,
  Sliders,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';

export function App(): React.JSX.Element {
  const {
    project,
    setProject,
    activeTab,
    setActiveTab,
    zones,
    selectedZoneId,
    drawMode,
    setDrawMode
  } = useProjectStore();

  // Docking & Resizing State
  const [leftWidth, setLeftWidth] = useState<number>(260);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState<boolean>(false);

  const [rightWidth, setRightWidth] = useState<number>(330);
  const [isRightCollapsed, setIsRightCollapsed] = useState<boolean>(false);

  const [bottomHeight, setBottomHeight] = useState<number>(290);
  const [isBottomCollapsed, setIsBottomCollapsed] = useState<boolean>(false);
  const [isBottomMaximized, setIsBottomMaximized] = useState<boolean>(false);

  const [isAiModalOpen, setIsAiModalOpen] = useState<boolean>(false);

  // Dragging interaction state
  const draggingRef = useRef<'left' | 'right' | 'bottom' | null>(null);
  const startPosRef = useRef<{ x: number; y: number; startDim: number }>({ x: 0, y: 0, startDim: 0 });

  const handleMouseDownLeft = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = 'left';
    startPosRef.current = { x: e.clientX, y: e.clientY, startDim: leftWidth };
    document.body.style.cursor = 'col-resize';
  };

  const handleMouseDownRight = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = 'right';
    startPosRef.current = { x: e.clientX, y: e.clientY, startDim: rightWidth };
    document.body.style.cursor = 'col-resize';
  };

  const handleMouseDownBottom = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = 'bottom';
    startPosRef.current = { x: e.clientX, y: e.clientY, startDim: bottomHeight };
    document.body.style.cursor = 'row-resize';
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;

      if (draggingRef.current === 'left') {
        const delta = e.clientX - startPosRef.current.x;
        const newWidth = Math.min(Math.max(startPosRef.current.startDim + delta, 180), 450);
        setLeftWidth(newWidth);
        if (isLeftCollapsed && newWidth > 200) setIsLeftCollapsed(false);
      } else if (draggingRef.current === 'right') {
        const delta = startPosRef.current.x - e.clientX;
        const newWidth = Math.min(Math.max(startPosRef.current.startDim + delta, 220), 520);
        setRightWidth(newWidth);
        if (isRightCollapsed && newWidth > 240) setIsRightCollapsed(false);
      } else if (draggingRef.current === 'bottom') {
        const delta = startPosRef.current.y - e.clientY;
        const newHeight = Math.min(Math.max(startPosRef.current.startDim + delta, 80), 650);
        setBottomHeight(newHeight);
        if (isBottomCollapsed && newHeight > 100) setIsBottomCollapsed(false);
      }
    };

    const handleMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = null;
        document.body.style.cursor = 'default';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [leftWidth, rightWidth, bottomHeight, isLeftCollapsed, isRightCollapsed, isBottomCollapsed]);

  const selectedZone = zones.find((z) => z.id === selectedZoneId);

  return (
    <div className="h-screen w-screen bg-[#09090b] text-neutral-100 flex flex-col font-sans overflow-hidden select-none">
      {/* Top Application Header Bar */}
      <header className="h-12 bg-neutral-900/90 border-b border-neutral-800 px-4 flex items-center justify-between shrink-0 z-30 backdrop-blur-md">
        {/* Brand & App Title */}
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-blue-600 to-teal-500 p-1.5 rounded-xl shadow-md shadow-blue-500/20">
            <Wind size={16} className="text-white" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-black tracking-wider text-neutral-100 uppercase">MEP HVAC Studio Pro</span>
            <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[9px] font-bold px-1.5 py-0.2 rounded-md">
              v2.5
            </span>
          </div>
        </div>

        {/* Global Design & Conditions Controls */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5 bg-neutral-950/80 px-2.5 py-1 rounded-lg border border-neutral-800">
            <span className="text-[10px] font-bold text-neutral-500 uppercase">Project:</span>
            <input
              type="text"
              value={project.name}
              onChange={(e) => setProject({ name: e.target.value })}
              className="bg-transparent border-none text-neutral-200 font-semibold focus:outline-none text-xs w-32 truncate"
              title={project.name}
            />
          </div>

          <div className="flex items-center gap-3 bg-neutral-950/80 px-3 py-1 rounded-lg border border-neutral-800">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-neutral-500">Outdoor DB:</span>
              <input
                type="number"
                value={project.outdoorDb}
                onChange={(e) => setProject({ outdoorDb: parseInt(e.target.value) || 0 })}
                className="bg-transparent border-none text-neutral-200 font-mono font-bold w-9 text-xs focus:outline-none text-center"
              />
              <span className="text-[10px] text-neutral-500">{project.units === 'imperial' ? '°F' : '°C'}</span>
            </div>

            <div className="w-[1px] h-3 bg-neutral-800" />

            <div className="flex items-center gap-1">
              <span className="text-[10px] text-neutral-500">Indoor DB:</span>
              <input
                type="number"
                value={project.indoorDb}
                onChange={(e) => setProject({ indoorDb: parseInt(e.target.value) || 0 })}
                className="bg-transparent border-none text-neutral-200 font-mono font-bold w-9 text-xs focus:outline-none text-center"
              />
              <span className="text-[10px] text-neutral-500">{project.units === 'imperial' ? '°F' : '°C'}</span>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAiModalOpen(true)}
            className="flex items-center gap-1.5 bg-gradient-to-r from-blue-600 to-teal-500 hover:from-blue-500 hover:to-teal-400 text-white font-bold text-[11px] px-3 py-1.5 rounded-xl shadow-md shadow-blue-500/20 transition-all cursor-pointer"
          >
            <Sparkles size={13} />
            AI HVAC Agent Studio
          </button>
        </div>
      </header>

      {/* Main Docking Workspace Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* LEFT DOCK: Tool Rail / Toolbar (Resizable & Collapsible) */}
        <div
          style={{ width: isLeftCollapsed ? 48 : leftWidth }}
          className="h-full bg-neutral-900/70 border-r border-neutral-800 flex flex-col shrink-0 relative transition-all duration-100 overflow-hidden"
        >
          {isLeftCollapsed ? (
            /* Collapsed Icon Rail */
            <div className="flex flex-col items-center py-3 gap-3">
              <button
                onClick={() => setIsLeftCollapsed(false)}
                className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors cursor-pointer"
                title="Expand Tools Sidebar"
              >
                <ChevronRight size={16} />
              </button>
              <div className="w-6 h-[1px] bg-neutral-800 my-1" />
              <button
                onClick={() => setDrawMode('select')}
                className={`p-2 rounded-xl cursor-pointer ${
                  drawMode === 'select' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'
                }`}
                title="Select Tool"
              >
                <MousePointer size={16} />
              </button>
              <button
                onClick={() => setDrawMode('polyline')}
                className={`p-2 rounded-xl cursor-pointer ${
                  drawMode === 'polyline' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'
                }`}
                title="Draw Zone Polygon"
              >
                <PenTool size={16} />
              </button>
              <button
                onClick={() => setDrawMode('pan')}
                className={`p-2 rounded-xl cursor-pointer ${
                  drawMode === 'pan' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:bg-neutral-800'
                }`}
                title="Pan Canvas"
              >
                <Hand size={16} />
              </button>
              <button
                onClick={() => setIsAiModalOpen(true)}
                className="p-2 rounded-xl text-teal-400 hover:bg-neutral-800 cursor-pointer"
                title="Open AI HVAC Studio"
              >
                <Sparkles size={16} />
              </button>
            </div>
          ) : (
            /* Expanded Full Toolbar */
            <div className="h-full flex flex-col overflow-hidden">
              <div className="h-9 px-3 border-b border-neutral-800 flex items-center justify-between shrink-0 bg-neutral-900/50">
                <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">Draw Tools & Setup</span>
                <button
                  onClick={() => setIsLeftCollapsed(true)}
                  className="p-1 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-lg cursor-pointer"
                  title="Collapse Tools (Free up canvas space)"
                >
                  <ChevronLeft size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <Toolbar />
                <CadUnderstandingPanel />
                <StandardsProfilePanel />
              </div>
            </div>
          )}
        </div>

        {/* Left Resizer Drag Handle */}
        {!isLeftCollapsed && (
          <div
            onMouseDown={handleMouseDownLeft}
            className="w-1.5 hover:w-2 bg-transparent hover:bg-blue-500/40 cursor-col-resize shrink-0 transition-colors z-20"
            title="Drag to resize Tools Sidebar"
          />
        )}

        {/* CENTER VIEWPORT: Canvas + Resizable Bottom Console */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Top: 2D CAD Canvas Viewport */}
          <div
            className={`flex-1 overflow-hidden relative flex flex-col ${
              isBottomMaximized ? 'hidden' : ''
            }`}
          >
            <FloorPlanCanvas />
          </div>

          {/* Horizontal Splitter Drag Bar */}
          {!isBottomMaximized && (
            <div
              onMouseDown={handleMouseDownBottom}
              onDoubleClick={() => setIsBottomCollapsed(!isBottomCollapsed)}
              className="h-2 bg-neutral-900 border-y border-neutral-800 hover:bg-blue-600/40 cursor-row-resize flex items-center justify-center shrink-0 z-20 group transition-colors"
              title="Drag to resize Engineering Console • Double-click to collapse/expand"
            >
              <div className="w-12 h-1 bg-neutral-700 group-hover:bg-blue-400 rounded-full" />
            </div>
          )}

          {/* Bottom Dock: Engineering Console */}
          <div
            style={{
              height: isBottomMaximized
                ? '100%'
                : isBottomCollapsed
                ? 38
                : bottomHeight
            }}
            className="bg-neutral-900/95 border-t border-neutral-800 flex flex-col shrink-0 overflow-hidden relative transition-all duration-100 z-10"
          >
            {/* Console Tab Header Bar (Double click to pop up / maximize) */}
            <div
              onDoubleClick={() => setIsBottomMaximized((prev) => !prev)}
              className="h-9 px-3 border-b border-neutral-800/80 bg-neutral-950/70 flex items-center justify-between shrink-0 cursor-pointer select-none"
              title="Double-click to pop up / maximize studio window"
            >
              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                <button
                  onClick={() => {
                    setActiveTab('optimizer');
                    if (isBottomCollapsed) setIsBottomCollapsed(false);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setIsBottomMaximized((prev) => !prev);
                    if (isBottomCollapsed) setIsBottomCollapsed(false);
                  }}
                  className={`flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer shrink-0 ${
                    activeTab === 'optimizer' && !isBottomCollapsed
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/80'
                  }`}
                  title="Optimizer Studio (Double-click to pop up / maximize)"
                >
                  <Sparkles size={12} />
                  Optimizer Studio
                </button>

                <button
                  onClick={() => {
                    setActiveTab('air-distribution');
                    if (isBottomCollapsed) setIsBottomCollapsed(false);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setIsBottomMaximized((prev) => !prev);
                    if (isBottomCollapsed) setIsBottomCollapsed(false);
                  }}
                  className={`flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer shrink-0 ${
                    activeTab === 'air-distribution' && !isBottomCollapsed
                      ? 'bg-gradient-to-r from-blue-600 to-teal-500 text-white shadow-md shadow-blue-500/20'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/80'
                  }`}
                  title="Air Distribution & 9-Point Validation (Double-click to pop up / maximize)"
                >
                  <FileSpreadsheet size={12} />
                  Air Distribution & 9-Point Validation
                </button>

                <button
                  onClick={() => {
                    setActiveTab('static-pressure');
                    if (isBottomCollapsed) setIsBottomCollapsed(false);
                  }}
                  className={`flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer shrink-0 ${
                    activeTab === 'static-pressure' && !isBottomCollapsed
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/80'
                  }`}
                >
                  <Gauge size={12} />
                  Static Pressure & Fan Curve
                </button>

                <button
                  onClick={() => {
                    setActiveTab('comparison');
                    if (isBottomCollapsed) setIsBottomCollapsed(false);
                  }}
                  className={`flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer shrink-0 ${
                    activeTab === 'comparison' && !isBottomCollapsed
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/80'
                  }`}
                >
                  <Award size={12} />
                  System Catalog Comparison
                </button>

                <button
                  onClick={() => {
                    setActiveTab('schedule');
                    if (isBottomCollapsed) setIsBottomCollapsed(false);
                  }}
                  className={`flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer shrink-0 ${
                    activeTab === 'schedule' && !isBottomCollapsed
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/80'
                  }`}
                >
                  <Table size={12} />
                  Building Load Schedule
                </button>
              </div>

              {/* Console Window Controls */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsBottomCollapsed(!isBottomCollapsed)}
                  className="p-1 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-md cursor-pointer"
                  title={isBottomCollapsed ? 'Expand Console' : 'Minimize Console'}
                >
                  {isBottomCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                <button
                  onClick={() => {
                    setIsBottomMaximized(!isBottomMaximized);
                    if (isBottomCollapsed) setIsBottomCollapsed(false);
                  }}
                  className="p-1 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-md cursor-pointer"
                  title={isBottomMaximized ? 'Restore Console' : 'Maximize Console'}
                >
                  {isBottomMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </div>
            </div>

            {/* Console Content Body */}
            {!isBottomCollapsed && (
              <div className="flex-1 overflow-y-auto p-4 bg-neutral-950/60">
                {activeTab === 'optimizer' && <OptimizerStudioPanel />}
                {activeTab === 'static-pressure' && <StaticPressurePanel />}
                {activeTab === 'comparison' && <SystemComparisonTable />}
                {activeTab === 'schedule' && <LoadSummaryPanel />}
                {activeTab === 'air-distribution' && <AirDistributionSchedulePanel />}
              </div>
            )}
          </div>
        </div>

        {/* Right Resizer Drag Handle */}
        {!isRightCollapsed && (
          <div
            onMouseDown={handleMouseDownRight}
            className="w-1.5 hover:w-2 bg-transparent hover:bg-blue-500/40 cursor-col-resize shrink-0 transition-colors z-20"
            title="Drag to resize Inspector Sidebar"
          />
        )}

        {/* RIGHT DOCK: Zone Properties & Inspector (Resizable & Collapsible) */}
        <div
          style={{ width: isRightCollapsed ? 48 : rightWidth }}
          className="h-full bg-neutral-900/70 border-l border-neutral-800 flex flex-col shrink-0 relative transition-all duration-100 overflow-hidden"
        >
          {isRightCollapsed ? (
            /* Collapsed Icon Strip */
            <div className="flex flex-col items-center py-3 gap-3">
              <button
                onClick={() => setIsRightCollapsed(false)}
                className="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors cursor-pointer"
                title="Expand Zone Inspector"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="w-6 h-[1px] bg-neutral-800 my-1" />
              <div className="p-2 text-neutral-500" title="Zone Properties">
                <Sliders size={16} />
              </div>
            </div>
          ) : (
            /* Expanded Full Inspector */
            <div className="h-full flex flex-col overflow-hidden">
              <div className="h-9 px-3 border-b border-neutral-800 flex items-center justify-between shrink-0 bg-neutral-900/50">
                <span className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">Zone Inspector & Standards</span>
                <button
                  onClick={() => setIsRightCollapsed(true)}
                  className="p-1 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-lg cursor-pointer"
                  title="Collapse Inspector"
                >
                  <ChevronRight size={14} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-5">
                <ZonePropertiesPanel />

                {/* Reference Standards Card */}
                <div className="bg-neutral-950/70 border border-neutral-800/80 p-4 rounded-2xl flex flex-col gap-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-300 uppercase tracking-wider">
                    <ShieldCheck size={14} className="text-teal-400" />
                    Engineering Code Standards
                  </div>
                  <div className="text-[11px] text-neutral-400 leading-relaxed space-y-1.5">
                    <p>
                      <strong className="text-neutral-300">ASHRAE 62.1-2019:</strong> Breathing zone ventilation combined with sensible heat ratio.
                    </p>
                    <p>
                      <strong className="text-neutral-300">Equal Friction:</strong> 0.08 in. w.g. / 100 ft friction rate, velocity limits, and max 4:1 aspect ratio.
                    </p>
                  </div>
                </div>

                {/* Engine Info Stamp */}
                <div className="pt-2 flex flex-col items-center">
                  <span className="text-[9px] text-neutral-600 uppercase tracking-wider font-semibold mb-1">Engine Info</span>
                  <Versions />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM STATUS BAR */}
      <footer className="h-6 bg-neutral-950 border-t border-neutral-850 px-3 flex items-center justify-between text-[10px] text-neutral-500 shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="font-semibold text-neutral-400">Scale:</span>
            <span className="font-mono text-neutral-300">{project.scale} {project.units === 'imperial' ? 'px/ft' : 'px/m'}</span>
          </div>
          <div className="w-[1px] h-3 bg-neutral-800" />
          <div className="flex items-center gap-1">
            <span className="font-semibold text-neutral-400">Selected Zone:</span>
            <span className="text-neutral-300 font-semibold">{selectedZone ? selectedZone.name : 'None'}</span>
          </div>
          {selectedZone && (
            <>
              <div className="w-[1px] h-3 bg-neutral-800" />
              <div className="flex items-center gap-1">
                <span className="font-semibold text-neutral-400">Diffusers:</span>
                <span className="font-mono text-neutral-300">{selectedZone.diffusers.length}</span>
              </div>
              <div className="w-[1px] h-3 bg-neutral-800" />
              <div className="flex items-center gap-1">
                <span className="font-semibold text-neutral-400">Ducts:</span>
                <span className="font-mono text-neutral-300">{selectedZone.ducts.length}</span>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-teal-400">
            <CheckCircle2 size={11} />
            <span>Solver Engine: Online</span>
          </div>
          <div className="w-[1px] h-3 bg-neutral-800" />
          <span className="text-neutral-600 font-mono">Zones: {zones.length}</span>
        </div>
      </footer>

      {/* Global AI HVAC Design Studio Modal */}
      <AiHvacAssistantModal isOpen={isAiModalOpen} onClose={() => setIsAiModalOpen(false)} />
    </div>
  );
}

export default App;
