import React, { useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { calculateZoneLoad } from '../engine/loadCalc';
import { executeAirDistributionDesign, convertDesignResultToZonePayload } from '../engine/airDistributionEngine';
import { generateMasterSchedules } from '../engine/export/exportSchedules';
import { exportFullEngineeringDesignReport } from '../engine/export/exportDesignReport';
import { FileSpreadsheet, Download, Layers, Check } from 'lucide-react';

export const AirDistributionSchedulePanel: React.FC = () => {
  const { project, zones, selectedZoneId, updateZone } = useProjectStore();
  const [activeSubTab, setActiveSubTab] = useState<'air-distribution' | 'ducts' | 'diffusers' | 'equipment' | 'outdoor-air' | 'validation' | 'decision-log'>('air-distribution');
  const [appliedToCad, setAppliedToCad] = useState<boolean>(false);

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

  // Execute full air distribution engine on the selected zone
  const roomPolygon = currentZone.points && currentZone.points.length >= 6
    ? currentZone.points
    : [0, 0, 50, 0, 50, 30, 0, 30];

  const design = executeAirDistributionDesign({
    roomName: currentZone.name || 'Conditioned Space',
    roomPolygon,
    roomAreaSqFt: loadResult.area || 1500,
    sensibleLoadBtu: loadResult.sensibleLoad || 120000,
    totalLoadBtu: loadResult.totalLoad || 141000,
    requiredCfm: loadResult.supplyCfm || 4000,
    occupancyCount: currentZone.occupants || 50,
    systemType: currentZone.systemType || 'concealed',
    mountingWallSide: 'east',
    maxAvailableCeilingDepthIn: 14
  });

  const schedules = generateMasterSchedules(design);

  const handleApplyToCad = () => {
    const payload = convertDesignResultToZonePayload(design);
    updateZone(currentZone.id, payload);
    setAppliedToCad(true);
    setTimeout(() => setAppliedToCad(false), 3000);
  };

  const handleExportTextReport = () => {
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
              Room: <strong>{design.roomName}</strong> | Selected System: <strong>{design.selectedOption.unitCount} × {design.selectedOption.unitModel}</strong> ({design.selectedOption.totalDeliveredCfm} CFM Total)
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

      {/* Sub-tab Navigation */}
      <div className="flex flex-wrap gap-2 border-b border-neutral-800 pb-3">
        {[
          { id: 'air-distribution', label: 'Air Distribution' },
          { id: 'ducts', label: 'Duct Schedule' },
          { id: 'diffusers', label: 'Diffuser Schedule' },
          { id: 'equipment', label: 'Equipment Schedule' },
          { id: 'outdoor-air', label: 'Outdoor Air Schedule' },
          { id: 'validation', label: '9-Point Validation' },
          { id: 'decision-log', label: 'Design Decision Log' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id as any)}
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
                <th className="py-2.5 px-3">Required CFM</th>
                <th className="py-2.5 px-3">Delivered CFM</th>
                <th className="py-2.5 px-3">Diffusers</th>
                <th className="py-2.5 px-3">CFM / Diffuser</th>
                <th className="py-2.5 px-3">Return CFM</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-850">
              {schedules.airDistributionSchedule.map((row, idx) => (
                <tr key={idx} className="hover:bg-neutral-850/40">
                  <td className="py-2.5 px-3 font-semibold text-neutral-200">{row.roomName}</td>
                  <td className="py-2.5 px-3 text-neutral-300">{row.designLoadBtu.toLocaleString()} Btu/h</td>
                  <td className="py-2.5 px-3 text-neutral-300">{row.requiredCfm} CFM</td>
                  <td className="py-2.5 px-3 text-blue-400 font-bold">{row.deliveredCfm} CFM</td>
                  <td className="py-2.5 px-3 text-neutral-300">{row.diffuserCount}</td>
                  <td className="py-2.5 px-3 text-emerald-400 font-semibold">{row.cfmPerDiffuser} CFM</td>
                  <td className="py-2.5 px-3 text-purple-400 font-semibold">{row.returnCfm} CFM</td>
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
              {schedules.ductSchedule.map((d, idx) => (
                <tr key={idx} className="hover:bg-neutral-850/40 font-mono text-[11px]">
                  <td className="py-2 px-3 font-semibold text-neutral-200">{d.ductId}</td>
                  <td className="py-2 px-3">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      d.systemType === 'SUPPLY' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-purple-500/10 text-purple-400'
                    }`}>
                      {d.systemType}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-neutral-400 capitalize">{d.role}</td>
                  <td className="py-2 px-3 text-blue-400 font-bold">{d.airflowCfm} CFM</td>
                  <td className="py-2 px-3 text-neutral-200 font-bold">{d.sizeDimension}</td>
                  <td className="py-2 px-3 text-neutral-300">{d.velocityFpm} FPM</td>
                  <td className="py-2 px-3 text-neutral-300">{d.pressureLossInWg.toFixed(3)} in. wg</td>
                  <td className="py-2 px-3 text-neutral-300">NC {d.ncRating}</td>
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
                <th className="py-2.5 px-3">CFM</th>
                <th className="py-2.5 px-3">Throw (T50)</th>
                <th className="py-2.5 px-3">NC</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-850">
              {schedules.diffuserSchedule.map((t, idx) => (
                <tr key={idx} className="hover:bg-neutral-850/40 text-[11px]">
                  <td className="py-2 px-3 font-semibold text-neutral-200 font-mono">{t.terminalId}</td>
                  <td className="py-2 px-3">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      t.type === 'SUPPLY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-purple-500/10 text-purple-400'
                    }`}>
                      {t.type}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-neutral-300">{t.model}</td>
                  <td className="py-2 px-3 text-neutral-400 font-mono">{t.neckSize}</td>
                  <td className="py-2 px-3 text-neutral-400 font-mono">{t.faceSize}</td>
                  <td className="py-2 px-3 text-blue-400 font-bold font-mono">{t.cfm} CFM</td>
                  <td className="py-2 px-3 text-neutral-300 font-mono">{t.throwT50Ft > 0 ? `${t.throwT50Ft} ft` : 'N/A'}</td>
                  <td className="py-2 px-3 text-neutral-300 font-mono">NC {t.ncRating}</td>
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
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-neutral-950/60 text-neutral-400 border-b border-neutral-800">
                <th className="py-2.5 px-3">Unit Tag</th>
                <th className="py-2.5 px-3">Equipment Model</th>
                <th className="py-2.5 px-3">System Type</th>
                <th className="py-2.5 px-3">Capacity</th>
                <th className="py-2.5 px-3">Supply CFM</th>
                <th className="py-2.5 px-3">Return CFM</th>
                <th className="py-2.5 px-3">ESP</th>
                <th className="py-2.5 px-3">Ownership</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-850">
              {schedules.equipmentSchedule.map((eq, idx) => (
                <tr key={idx} className="hover:bg-neutral-850/40 text-[11px]">
                  <td className="py-2.5 px-3 font-semibold text-neutral-100 font-mono">{eq.unitTag}</td>
                  <td className="py-2.5 px-3 text-neutral-200 font-semibold">{eq.model}</td>
                  <td className="py-2.5 px-3 text-neutral-400">{eq.systemType}</td>
                  <td className="py-2.5 px-3 text-blue-400 font-bold">{eq.capacityBtu.toLocaleString()} Btu/h</td>
                  <td className="py-2.5 px-3 text-emerald-400 font-bold">{eq.supplyCfm} CFM</td>
                  <td className="py-2.5 px-3 text-purple-400 font-bold">{eq.returnCfm} CFM</td>
                  <td className="py-2.5 px-3 text-neutral-300 font-mono">{eq.espInWg.toFixed(2)} in. wg</td>
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
                  <td className="py-2.5 px-3 text-neutral-300">{oa.requiredOaCfm} CFM</td>
                  <td className="py-2.5 px-3 text-amber-400 font-bold">{oa.deliveredOaCfm} CFM</td>
                  <td className="py-2.5 px-3 text-neutral-200">{oa.louverModel}</td>
                  <td className="py-2.5 px-3 text-neutral-300 font-mono">{oa.freeAreaSqFt} sq.ft</td>
                  <td className="py-2.5 px-3 text-neutral-300 font-mono">{oa.faceVelocityFpm} FPM</td>
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
