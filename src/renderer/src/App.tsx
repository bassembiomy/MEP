import React from 'react';
import { Toolbar } from './components/Toolbar';
import { FloorPlanCanvas } from './canvas/FloorPlanCanvas';
import { ZonePropertiesPanel } from './panels/ZonePropertiesPanel';
import { OptimizerStudioPanel } from './panels/OptimizerStudioPanel';
import { StaticPressurePanel } from './panels/StaticPressurePanel';
import { SystemComparisonTable } from './panels/SystemComparisonTable';
import { LoadSummaryPanel } from './panels/LoadSummaryPanel';
import { AirDistributionSchedulePanel } from './panels/AirDistributionSchedulePanel';
import { useProjectStore } from './store/projectStore';
import Versions from './components/Versions';
import { Wind, LayoutGrid, Info, Sparkles, Gauge, Award, Table, FileSpreadsheet } from 'lucide-react';

function App(): React.JSX.Element {
  const { project, setProject, activeTab, setActiveTab } = useProjectStore();

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
            <p className="text-[10px] text-neutral-500 font-medium">Deterministic System Optimizer & Aerodynamic Static Pressure Solver</p>
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
                  <strong>Tip:</strong> Use the polyline draw tool to define rooms. The engine deterministically sizes thermal supply airflow, verifies fan static pressure, and selects diffusers.
                </span>
              </div>
            </div>
          </div>

          {/* Lower Workspace Tab Selector */}
          <div className="flex items-center gap-2 border-b border-neutral-850 pb-2">
            <button
              onClick={() => setActiveTab('optimizer')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'optimizer'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                  : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-850'
              }`}
            >
              <Sparkles size={14} />
              Optimizer Studio
            </button>
            <button
              onClick={() => setActiveTab('static-pressure')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'static-pressure'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                  : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-850'
              }`}
            >
              <Gauge size={14} />
              Static Pressure & Fan Curve
            </button>
            <button
              onClick={() => setActiveTab('comparison')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'comparison'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                  : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-850'
              }`}
            >
              <Award size={14} />
              System Catalog Comparison
            </button>
            <button
              onClick={() => setActiveTab('schedule')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'schedule'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                  : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-850'
              }`}
            >
              <Table size={14} />
              Building Load Schedule
            </button>
            <button
              onClick={() => setActiveTab('air-distribution')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'air-distribution'
                  ? 'bg-gradient-to-r from-blue-600 to-teal-500 text-white shadow-lg shadow-blue-500/20'
                  : 'bg-neutral-900 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-850'
              }`}
            >
              <FileSpreadsheet size={14} />
              Air Distribution & 9-Point Validation
            </button>
          </div>

          {/* Lower Workspace Content Panels */}
          {activeTab === 'optimizer' && <OptimizerStudioPanel />}
          {activeTab === 'static-pressure' && <StaticPressurePanel />}
          {activeTab === 'comparison' && <SystemComparisonTable />}
          {activeTab === 'schedule' && <LoadSummaryPanel />}
          {activeTab === 'air-distribution' && <AirDistributionSchedulePanel />}
        </div>

        {/* Sidebar Parameters Workspace (Right Column - Spans 1/4) */}
        <div className="flex flex-col gap-6">
          <ZonePropertiesPanel />
          
          {/* Reference Guides */}
          <div className="bg-neutral-900 border border-neutral-850 p-5 rounded-2xl flex flex-col gap-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-300 uppercase tracking-wider">
              <LayoutGrid size={14} className="text-blue-500" />
              Engineering Standards
            </div>
            <div className="text-[11px] text-neutral-500 leading-relaxed flex flex-col gap-2">
              <p>
                <strong>Airflow & Ventilation:</strong> ASHRAE 62.1-2019 breathing zone ventilation ($V_{'{'}bz{'}'}$) combined with thermal sensible sensible heat ratio.
              </p>
              <p>
                <strong>Duct & Static Pressure:</strong> Darcy-Weisbach friction & K-factor dynamic losses along connected critical paths.
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
