import { modelDisplayName } from '../engine/hvacCatalogs';
import React, { useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { calculateZoneLoad } from '../engine/loadCalc';
import { toBtuh, toCfm } from '../engine/units';
import { formatAirflow, formatLoad, formatDuctSize, formatVelocity, formatPressure, formatArea, formatLength } from '../format/units';
import { designZone, zonePatchFromDesign } from './zoneDesign';
import { generateMasterSchedules } from '../engine/export/exportSchedules';
import { exportFullEngineeringDesignReport } from '../engine/export/exportDesignReport';
import { FileSpreadsheet, Download, Layers, Check } from 'lucide-react';

type SubTabId = 'air-distribution' | 'ducts' | 'diffusers' | 'equipment' | 'outdoor-air' | 'validation' | 'decision-log';

interface AirRow { room: string; loadBtu: number; reqCfm: number; delCfm: number; count: number; perDiff: number; retCfm: number; status: string }
interface DuctRow { id: string; system: string; role: string; cfm: number; size: string; velFpm: number; dpInWg: number | null; nc: number | null; status: string }
interface DiffRow { id: string; type: string; model: string; neck: string; face: string; cfm: number; throwFt: number; nc: number | null; status: string }

/** Re-render an engine size string like 24"x12" in the project unit system (metric -> mm, 50 mm steps). */
const reformatSize = (label: string, units: string): string => {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:"|in)?\s*[x\u00D7]\s*(\d+(?:\.\d+)?)\s*(?:"|in)?\s*$/i.exec(label || '');
  if (!m) return label;
  // Metric terminals are labelled in mm already (no inch mark, values >= 100): keep them as is.
  if (units === 'metric' && !/"|in/i.test(label) && Math.max(parseFloat(m[1]), parseFloat(m[2])) >= 100) return `${m[1]}x${m[2]} mm`;
  return formatDuctSize(parseFloat(m[1]), parseFloat(m[2]), units);
};

const dash = '\u2014';

export const AirDistributionSchedulePanel: React.FC = () => {
  const { project, zones, selectedZoneId, updateZone, dxfBoundingBox } = useProjectStore();
  const [activeSubTab, setActiveSubTab] = useState<SubTabId>('air-distribution');
  const [appliedToCad, setAppliedToCad] = useState<boolean>(false);
  const [sourceOverride, setSourceOverride] = useState<'canvas' | 'proposal' | null>(null);

  const currentZone = zones.find((z) => z.id === selectedZoneId) || zones[0];

  if (!currentZone) {
    return (
      <div className="bg-neutral-900/60 border border-neutral-850 p-8 rounded-2xl flex flex-col items-center justify-center text-center">
        <FileSpreadsheet className="text-neutral-600 mb-3" size={36} />
        <p className="text-sm font-semibold text-neutral-400">No Zone Selected</p>
        <p className="text-xs text-neutral-500 mt-1">Select or draw a room to generate automated air distribution schedules and engineering validation reports.</p>
      </div>
    );
  }

  // Calculate zone thermal load & airflow
  const loadResult = calculateZoneLoad(currentZone, project);

  // The ONE air-distribution pipeline (shared with the zone panel's Auto-Layout): the canvas polygon is in px, the engine
  // converts to ft and all loads / airflows are imperial (Btu/h, CFM). What is shown here as "proposal" is exactly what
  // Apply / Auto-Layout writes to the canvas.
  const units = project.units;
  const { design, payload } = designZone(currentZone, zones, project, dxfBoundingBox);

  const schedules = generateMasterSchedules(design);

  // ---- Single source of truth: what is ON THE CANVAS (zone diffusers/ducts) vs. the engine PROPOSAL ----
  const supplyOnCanvas = currentZone.diffusers.filter((d) => d.type !== 'return' && d.type !== 'exhaust');
  const returnOnCanvas = currentZone.diffusers.filter((d) => d.type === 'return');
  const hasCanvas = currentZone.diffusers.length > 0 || currentZone.ducts.length > 0;
  const source: 'canvas' | 'proposal' = sourceOverride ?? (hasCanvas ? 'canvas' : 'proposal');
  const showCanvas = source === 'canvas' && hasCanvas;

  const proposalAir: AirRow[] = schedules.airDistributionSchedule.map((r) => ({
    room: r.roomName, loadBtu: r.designLoadBtu, reqCfm: r.requiredCfm, delCfm: r.deliveredCfm,
    count: r.diffuserCount, perDiff: r.cfmPerDiffuser, retCfm: r.returnCfm, status: r.status
  }));
  const proposalDucts: DuctRow[] = schedules.ductSchedule.map((d) => ({
    id: d.ductId, system: d.systemType, role: d.role, cfm: d.airflowCfm, size: reformatSize(d.sizeDimension, units),
    velFpm: d.velocityFpm, dpInWg: d.pressureLossInWg, nc: d.ncRating, status: d.status
  }));
  const proposalDiffs: DiffRow[] = schedules.diffuserSchedule.map((t) => ({
    id: t.terminalId, type: t.type, model: t.model, neck: reformatSize(t.neckSize, units), face: reformatSize(t.faceSize, units),
    cfm: t.cfm, throwFt: t.throwT50Ft, nc: t.ncRating, status: t.status
  }));

  const canvasDelivered = supplyOnCanvas.reduce((sum, d) => sum + d.cfm, 0);
  const canvasRequired = toCfm(loadResult.supplyCfm, units);
  const canvasAir: AirRow[] = [{
    room: currentZone.name || 'Zone',
    loadBtu: toBtuh(loadResult.totalLoad, units),
    reqCfm: canvasRequired,
    delCfm: canvasDelivered,
    count: supplyOnCanvas.length,
    perDiff: supplyOnCanvas.length ? canvasDelivered / supplyOnCanvas.length : 0,
    retCfm: returnOnCanvas.reduce((sum, d) => sum + d.cfm, 0),
    status: canvasRequired > 0 && Math.abs(canvasDelivered - canvasRequired) / canvasRequired <= 0.1 ? 'PASS' : 'REVIEW'
  }];
  const canvasDucts: DuctRow[] = currentZone.ducts.map((d) => ({
    id: d.id, system: d.type === 'return' ? 'RETURN' : 'SUPPLY', role: d.type, cfm: d.cfm,
    size: d.shape === 'round' && d.diameterIn ? `\u00D8${formatDuctSize(d.diameterIn, d.diameterIn, units).split('x')[0]}` : formatDuctSize(d.widthIn, d.heightIn, units),
    velFpm: d.velocityFpm ?? 0, dpInWg: d.acousticVerification?.pressureLossInWg ?? null, nc: null,
    status: d.acousticVerification?.complianceStatus === 'REQUIRES REDESIGN' ? 'REVIEW' : 'OK'
  }));
  const canvasDiffs: DiffRow[] = currentZone.diffusers.map((d) => ({
    id: d.id, type: (d.type || 'supply').toUpperCase(), model: d.size, neck: dash, face: reformatSize(d.size, units),
    cfm: d.cfm, throwFt: d.throwT50Ft ?? 0, nc: d.actualNc ?? null, status: 'ON CANVAS'
  }));

  const airRows = showCanvas ? canvasAir : proposalAir;
  const ductRows = showCanvas ? canvasDucts : proposalDucts;
  const diffRows = showCanvas ? canvasDiffs : proposalDiffs;

  const handleApplyToCad = (): void => {
    updateZone(currentZone.id, zonePatchFromDesign(currentZone, payload));
    setAppliedToCad(true);
    setTimeout(() => setAppliedToCad(false), 3000);
  };

  const handleExportTextReport = (): void => {
    const reportText = exportFullEngineeringDesignReport(design);
    const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${design.roomName.replace(/\s+/g, '_')}_HVAC_Air_Distribution_Report.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-neutral-900/80 border border-neutral-850 rounded-2xl p-6 flex flex-col gap-5 shadow-2xl backdrop-blur-xl">
      {/* Header with Title & Action Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-600/10 border border-blue-500/20 text-blue-400 rounded-xl">
            <FileSpreadsheet size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-wide">
                Air Distribution Schedules & 9-Point Validation
              </h2>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                design.validationReport.overallStatus === 'PASS'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}>
                {design.validationReport.overallStatus}
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              Room: <strong>{design.roomName}</strong> | Selected System: <strong>{design.selectedOption.unitCount} × {design.selectedOption.unitModel}</strong> ({formatAirflow(design.selectedOption.totalDeliveredCfm, units)} Total)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleApplyToCad}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-lg transition-all cursor-pointer ${
              appliedToCad
                ? 'bg-emerald-600 text-white shadow-emerald-500/20'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20'
            }`}
            title="Deploy calculated diffusers, grilles, ducts, and equipment footprints directly onto the CAD workspace"
          >
            {appliedToCad ? <Check size={14} /> : <Layers size={14} />}
            {appliedToCad ? 'Applied to CAD Workspace!' : 'Apply AI Air Distribution to CAD'}
          </button>
          <button
            onClick={handleExportTextReport}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all cursor-pointer"
          >
            <Download size={14} />
            Export Engineering Report
          </button>
        </div>
      </div>

      {/* Source toggle: canvas (what is drawn) vs engine proposal */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-neutral-500 font-semibold uppercase tracking-wider text-[9px]">Schedule source</span>
        <button
          onClick={() => setSourceOverride('canvas')}
          disabled={!hasCanvas}
          className={`px-2.5 py-1 rounded-lg border font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
            showCanvas ? 'bg-blue-600/20 border-blue-500/40 text-blue-300' : 'bg-neutral-950 border-neutral-800 text-neutral-400'
          }`}
        >
          On canvas ({currentZone.diffusers.length} terminals, {currentZone.ducts.length} ducts)
        </button>
        <button
          onClick={() => setSourceOverride('proposal')}
          className={`px-2.5 py-1 rounded-lg border font-semibold cursor-pointer ${
            !showCanvas ? 'bg-amber-600/20 border-amber-500/40 text-amber-300' : 'bg-neutral-950 border-neutral-800 text-neutral-400'
          }`}
        >
          Engine proposal ({design.supplyTerminals.length + design.returnTerminals.length} terminals)
        </button>
        <span className="text-neutral-500">
          {showCanvas
            ? 'Showing the terminals and ducts currently drawn for this zone.'
            : hasCanvas
            ? 'Showing the engine proposal - it differs from the canvas until you apply it.'
            : 'Nothing drawn yet - showing the engine proposal. Apply it to place it on the canvas.'}
        </span>
      </div>

      {/* Sub-tab Navigation */}
      <div className="flex flex-wrap gap-2 border-b border-neutral-800 pb-3">
        {([
          { id: 'air-distribution', label: 'Air Distribution' },
          { id: 'ducts', label: 'Duct Schedule' },
          { id: 'diffusers', label: 'Diffuser Schedule' },
          { id: 'equipment', label: 'Equipment Schedule' },
          { id: 'outdoor-air', label: 'Outdoor Air Schedule' },
          { id: 'validation', label: '9-Point Validation' },
          { id: 'decision-log', label: 'Design Decision Log' }
        ] as { id: SubTabId; label: string }[]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              activeSubTab === tab.id
                ? 'bg-neutral-800 text-blue-400 border border-blue-500/30'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-850'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 1. Air Distribution Schedule Table */}
      {activeSubTab === 'air-distribution' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-neutral-950/60 text-neutral-400 border-b border-neutral-800">
                <th className="py-2.5 px-3">Room</th>
                <th className="py-2.5 px-3">Design Load</th>
                <th className="py-2.5 px-3">Required Airflow</th>
                <th className="py-2.5 px-3">Delivered Airflow</th>
                <th className="py-2.5 px-3">Diffusers</th>
                <th className="py-2.5 px-3">Airflow / Diffuser</th>
                <th className="py-2.5 px-3">Return Airflow</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-850">
              {airRows.map((row, idx) => (
                <tr key={idx} className="hover:bg-neutral-850/40">
                  <td className="py-2.5 px-3 font-semibold text-neutral-200">{row.room}</td>
                  <td className="py-2.5 px-3 text-neutral-300">{formatLoad(row.loadBtu, units)}</td>
                  <td className="py-2.5 px-3 text-neutral-300">{formatAirflow(row.reqCfm, units)}</td>
                  <td className="py-2.5 px-3 text-blue-400 font-bold">{formatAirflow(row.delCfm, units)}</td>
                  <td className="py-2.5 px-3 text-neutral-300">{row.count}</td>
                  <td className="py-2.5 px-3 text-emerald-400 font-semibold">{formatAirflow(row.perDiff, units)}</td>
                  <td className="py-2.5 px-3 text-purple-400 font-semibold">{formatAirflow(row.retCfm, units)}</td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeSubTab === 'air-distribution' && showCanvas && (
        <div className="bg-amber-950/10 border border-amber-500/20 rounded-xl p-3 text-[11px] text-neutral-300">
          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400">Engine proposal (not on canvas)</span>
          <div className="mt-1 font-mono">
            {proposalAir[0]?.count ?? 0} supply terminals | {formatAirflow(proposalAir[0]?.delCfm ?? 0, units)} delivered | {formatAirflow(proposalAir[0]?.perDiff ?? 0, units)} per terminal |
            return {formatAirflow(proposalAir[0]?.retCfm ?? 0, units)}
          </div>
          <div className="text-neutral-500 mt-1">Use &quot;Apply AI Air Distribution to CAD&quot; to replace the canvas layout with this proposal.</div>
        </div>
      )}

      {/* 2. Duct Schedule Table */}
      {activeSubTab === 'ducts' && (
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-neutral-950/60 text-neutral-400 border-b border-neutral-800">
                <th className="py-2.5 px-3">Duct ID</th>
                <th className="py-2.5 px-3">System</th>
                <th className="py-2.5 px-3">Role</th>
                <th className="py-2.5 px-3">Airflow</th>
                <th className="py-2.5 px-3">Size (W x H)</th>
                <th className="py-2.5 px-3">Velocity</th>
                <th className="py-2.5 px-3">Pressure Loss</th>
                <th className="py-2.5 px-3">NC</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-850">
              {ductRows.map((d, idx) => (
                <tr key={idx} className="hover:bg-neutral-850/40 font-mono text-[11px]">
                  <td className="py-2 px-3 font-semibold text-neutral-200">{d.id}</td>
                  <td className="py-2 px-3">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      d.system === 'SUPPLY' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-purple-500/10 text-purple-400'
                    }`}>
                      {d.system}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-neutral-400 capitalize">{d.role}</td>
                  <td className="py-2 px-3 text-blue-400 font-bold">{formatAirflow(d.cfm, units)}</td>
                  <td className="py-2 px-3 text-neutral-200 font-bold">{d.size}</td>
                  <td className="py-2 px-3 text-neutral-300">{formatVelocity(d.velFpm, units)}</td>
                  <td className="py-2 px-3 text-neutral-300">{d.dpInWg === null ? dash : formatPressure(d.dpInWg, units)}</td>
                  <td className="py-2 px-3 text-neutral-300">{d.nc === null ? dash : `NC ${d.nc}`}</td>
                  <td className="py-2 px-3">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400">
                      {d.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 3. Diffuser Schedule Table */}
      {activeSubTab === 'diffusers' && (
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-neutral-950/60 text-neutral-400 border-b border-neutral-800">
                <th className="py-2.5 px-3">Terminal ID</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Catalog Model</th>
                <th className="py-2.5 px-3">Neck</th>
                <th className="py-2.5 px-3">Face</th>
                <th className="py-2.5 px-3">Airflow</th>
                <th className="py-2.5 px-3">Throw (T50)</th>
                <th className="py-2.5 px-3">NC</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-850">
              {diffRows.map((t, idx) => (
                <tr key={idx} className="hover:bg-neutral-850/40 text-[11px]">
                  <td className="py-2 px-3 font-semibold text-neutral-200 font-mono">{t.id}</td>
                  <td className="py-2 px-3">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      t.type === 'SUPPLY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-purple-500/10 text-purple-400'
                    }`}>
                      {t.type}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-neutral-300">{t.model}</td>
                  <td className="py-2 px-3 text-neutral-400 font-mono">{t.neck}</td>
                  <td className="py-2 px-3 text-neutral-400 font-mono">{t.face}</td>
                  <td className="py-2 px-3 text-blue-400 font-bold font-mono">{formatAirflow(t.cfm, units)}</td>
                  <td className="py-2 px-3 text-neutral-300 font-mono">{t.throwFt > 0 ? formatLength(t.throwFt, units) : 'N/A'}</td>
                  <td className="py-2 px-3 text-neutral-300 font-mono">{t.nc === null ? dash : `NC ${t.nc}`}</td>
                  <td className="py-2 px-3">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400">
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 4. Equipment Schedule */}
      {activeSubTab === 'equipment' && (
        <div className="overflow-x-auto">
          <p className="text-[10px] text-amber-400/90 mb-2">Engine proposal - equipment is sized by the engine, not read from the canvas.</p>
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-neutral-950/60 text-neutral-400 border-b border-neutral-800">
                <th className="py-2.5 px-3">Unit Tag</th>
                <th className="py-2.5 px-3">Equipment Model</th>
                <th className="py-2.5 px-3">System Type</th>
                <th className="py-2.5 px-3">Capacity</th>
                <th className="py-2.5 px-3">Supply Airflow</th>
                <th className="py-2.5 px-3">Return Airflow</th>
                <th className="py-2.5 px-3">ESP</th>
                <th className="py-2.5 px-3">Ownership</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-850">
              {schedules.equipmentSchedule.map((eq, idx) => (
                <tr key={idx} className="hover:bg-neutral-850/40 text-[11px]">
                  <td className="py-2.5 px-3 font-semibold text-neutral-100 font-mono">{eq.unitTag}</td>
                  <td className="py-2.5 px-3 text-neutral-200 font-semibold">{modelDisplayName(eq.model)}</td>
                  <td className="py-2.5 px-3 text-neutral-400">{eq.systemType}</td>
                  <td className="py-2.5 px-3 text-blue-400 font-bold">{formatLoad(eq.capacityBtu, units)}</td>
                  <td className="py-2.5 px-3 text-emerald-400 font-bold">{formatAirflow(eq.supplyCfm, units)}</td>
                  <td className="py-2.5 px-3 text-purple-400 font-bold">{formatAirflow(eq.returnCfm, units)}</td>
                  <td className="py-2.5 px-3 text-neutral-300 font-mono">{formatPressure(eq.espInWg, units)}</td>
                  <td className="py-2.5 px-3">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      {eq.controlMode.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400">
                      {eq.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 5. Outdoor Air Schedule */}
      {activeSubTab === 'outdoor-air' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-neutral-950/60 text-neutral-400 border-b border-neutral-800">
                <th className="py-2.5 px-3">OA System ID</th>
                <th className="py-2.5 px-3">Connected Unit</th>
                <th className="py-2.5 px-3">Required OA</th>
                <th className="py-2.5 px-3">Delivered OA</th>
                <th className="py-2.5 px-3">Louver Model</th>
                <th className="py-2.5 px-3">Free Area</th>
                <th className="py-2.5 px-3">Face Velocity</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-850">
              {schedules.outdoorAirSchedule.map((oa, idx) => (
                <tr key={idx} className="hover:bg-neutral-850/40 text-[11px]">
                  <td className="py-2.5 px-3 font-semibold text-neutral-100 font-mono">{oa.oaSystemId}</td>
                  <td className="py-2.5 px-3 text-neutral-200 font-mono">{oa.unitTag}</td>
                  <td className="py-2.5 px-3 text-neutral-300">{formatAirflow(oa.requiredOaCfm, units)}</td>
                  <td className="py-2.5 px-3 text-amber-400 font-bold">{formatAirflow(oa.deliveredOaCfm, units)}</td>
                  <td className="py-2.5 px-3 text-neutral-200">{oa.louverModel}</td>
                  <td className="py-2.5 px-3 text-neutral-300 font-mono">{formatArea(oa.freeAreaSqFt, units)}</td>
                  <td className="py-2.5 px-3 text-neutral-300 font-mono">{formatVelocity(oa.faceVelocityFpm, units)}</td>
                  <td className="py-2.5 px-3">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400">
                      {oa.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 6. 9-Point Validation Matrix */}
      {activeSubTab === 'validation' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {design.validationReport.points.map((p) => (
            <div
              key={p.pointIndex}
              className={`p-4 rounded-xl border flex flex-col gap-1.5 ${
                p.status === 'PASS'
                  ? 'bg-emerald-950/10 border-emerald-500/20'
                  : 'bg-amber-950/10 border-amber-500/20'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-neutral-400 uppercase">Point {p.pointIndex}</span>
                  <span className="text-xs font-bold text-neutral-200">{p.pointName}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                  p.status === 'PASS' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                }`}>
                  {p.status}
                </span>
              </div>
              <div className="text-[11px] text-neutral-400 font-mono mt-1">
                {p.metric}
              </div>
              <div className="text-[10px] text-neutral-500">
                Criteria: {p.criteria}
              </div>
              <div className="text-[11px] text-neutral-300 mt-1 font-medium">
                {p.message}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 7. Design Decision Log */}
      {activeSubTab === 'decision-log' && (
        <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 font-mono text-[11px] text-neutral-300 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
          {design.designDecisionLog}
        </div>
      )}
    </div>
  );
};
