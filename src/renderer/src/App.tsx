import React from 'react';
import { Toolbar } from './components/Toolbar';
import { FloorPlanCanvas } from './canvas/FloorPlanCanvas';
import { ZonePropertiesPanel } from './panels/ZonePropertiesPanel';
import { SystemComparisonTable } from './panels/SystemComparisonTable';
import { LoadSummaryPanel } from './panels/LoadSummaryPanel';
import { useProjectStore } from './store/projectStore';
import Versions from './components/Versions';
import { Wind, LayoutGrid, Info } from 'lucide-react';

function App(): React.JSX.Element {
  const { project, setProject } = useProjectStore();

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-blue-600/30 selection:text-blue-200">
      {/* Background Decorative Glows */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-10 left-10 w-96 h-96 bg-teal-500/5 rounded-full blur-[150px] pointer-events-none" />

      {/* Main Header */}
      <header className="relative z-10 bg-neutral-900/60 backdrop-blur-md border-b border-neutral-850 px-8 py-4 flex flex-wrap justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-blue-600 to-teal-500 p-2 rounded-xl shadow-lg shadow-blue-500/10">
            <Wind size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-wider text-neutral-100 uppercase">MEP HVAC Designer</h1>
            <p className="text-[10px] text-neutral-500 font-medium">Automatic load calculation & duct router</p>
          </div>
        </div>

        {/* Global Design Conditions */}
        <div className="flex flex-wrap gap-4 text-xs">
          <div className="flex flex-col">
            <span className="text-[9px] font-bold text-neutral-500 uppercase">Project Name</span>
            <input
              type="text"
              value={project.name}
              onChange={(e) => setProject({ name: e.target.value })}
              className="bg-transparent border-b border-transparent hover:border-neutral-800 focus:border-blue-600 focus:outline-none text-neutral-200 font-semibold py-0.5"
            />
          </div>

          <div className="flex flex-col">
            <span className="text-[9px] font-bold text-neutral-500 uppercase">Design Outdoor DB</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={project.outdoorDb}
                onChange={(e) => setProject({ outdoorDb: parseInt(e.target.value) || 0 })}
                className="bg-transparent border-b border-transparent hover:border-neutral-800 focus:border-blue-600 focus:outline-none text-neutral-200 font-mono font-bold w-12 py-0.5"
              />
              <span className="text-neutral-500">{project.units === 'imperial' ? '°F' : '°C'}</span>
            </div>
          </div>

          <div className="flex flex-col">
            <span className="text-[9px] font-bold text-neutral-500 uppercase">Design Indoor DB</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={project.indoorDb}
                onChange={(e) => setProject({ indoorDb: parseInt(e.target.value) || 0 })}
                className="bg-transparent border-b border-transparent hover:border-neutral-800 focus:border-blue-600 focus:outline-none text-neutral-200 font-mono font-bold w-12 py-0.5"
              />
              <span className="text-neutral-500">{project.units === 'imperial' ? '°F' : '°C'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <main className="relative z-10 flex-1 grid grid-cols-1 xl:grid-cols-4 gap-6 p-6">
        {/* Draw Board Workspace (Left Column - Spans 3/4) */}
        <div className="xl:col-span-3 flex flex-col gap-6">
          <div className="flex gap-4 items-start">
            <Toolbar />
            <div className="flex-1 flex flex-col gap-4">
              <FloorPlanCanvas />
              {/* Short Tip banner */}
              <div className="bg-neutral-900/40 border border-neutral-850 px-4 py-3 rounded-2xl flex items-center gap-2.5 text-xs text-neutral-400">
                <Info size={16} className="text-blue-500 shrink-0" />
                <span>
                  <strong>Tip:</strong> Draw closed zones using the polyline tool. Once created, select a zone to customize internal design parameters and view live load schedules.
                </span>
              </div>
            </div>
          </div>

          {/* Lower Aggregate Panels: Systems Recommendation & Load Schedule */}
          <SystemComparisonTable />
          <LoadSummaryPanel />
        </div>

        {/* Sidebar Parameters Workspace (Right Column - Spans 1/4) */}
        <div className="flex flex-col gap-6">
          <ZonePropertiesPanel />
          
          {/* Quick instructions / Info panel */}
          <div className="bg-neutral-900 border border-neutral-850 p-5 rounded-2xl flex flex-col gap-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-300 uppercase tracking-wider">
              <LayoutGrid size={14} className="text-blue-500" />
              Reference Guides
            </div>
            <div className="text-[11px] text-neutral-500 leading-relaxed flex flex-col gap-2">
              <p>
                <strong>Duct Sizing:</strong> Based on the Huebscher equivalent rectangular diameter formulation, adopting a target equal friction drop of 0.10 in. wg per 100 ft.
              </p>
              <p>
                <strong>Ventilation rates:</strong> Complies with ASHRAE 62.1 requirements.
              </p>
            </div>
          </div>

          {/* Version / Info stamp */}
          <div className="mt-auto pt-4 flex flex-col items-center">
            <span className="text-[9px] text-neutral-600 uppercase tracking-wider font-semibold mb-2">Engine Info</span>
            <Versions />
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;

