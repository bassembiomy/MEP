import React, { useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { calculateZoneLoad } from '../engine/loadCalc';
import {
  solveDirectedNetworkStaticPressure,
  evaluateFanOperatingPoint,
  calculateBranchBalancingSchedule
} from '../engine/staticPressureCalc';
import {
  STANDARD_EQUIPMENT_CATALOG,
  STANDARD_DIFFUSER_CATALOG,
  STANDARD_DUCT_TYPES
} from '../engine/hvacCatalogs';
import {
  verifyDuctSectionAcoustics
} from '../engine/acousticDuctEngine';
import {
  Gauge,
  Activity,
  ShieldCheck,
  AlertTriangle,
  Volume2,
  CheckCircle2,
  FileSpreadsheet
} from 'lucide-react';
import { DuctAcousticVerification } from '../engine/types';

export const StaticPressurePanel: React.FC = () => {
  const { selectedZoneId, zones, project } = useProjectStore();
  const [activeSubTab, setActiveSubTab] = useState<'acoustic' | 'pressure'>('acoustic');

  const selectedZone = zones.find((z) => z.id === selectedZoneId) || zones[0];

  if (!selectedZone) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-2xl text-center text-neutral-500 text-xs shadow-xl">
        <Gauge size={24} className="text-neutral-700 mx-auto mb-3 animate-pulse" />
        Select or draw a zone to inspect acoustic noise & static-pressure network calculations.
      </div>
    );
  }

  const isImperial = project.units === 'imperial';
  const loadResult = calculateZoneLoad(selectedZone, project);
  const isDucted =
    selectedZone.systemType === 'concealed' ||
    selectedZone.systemType === 'packaged' ||
    selectedZone.systemType === 'ahu';

  // Solve critical path
  const defaultDuctType = STANDARD_DUCT_TYPES[0];
  const criticalPath = solveDirectedNetworkStaticPressure(
    selectedZone.ducts,
    selectedZone.diffusers,
    STANDARD_DIFFUSER_CATALOG,
    defaultDuctType,
    project.scale
  );

  // Match equipment record
  const matchingEquip =
    STANDARD_EQUIPMENT_CATALOG.find(
      (e) => e.systemType === selectedZone.systemType && e.nominalCfm >= loadResult.supplyCfm * 0.7
    ) || STANDARD_EQUIPMENT_CATALOG[0];

  const fanResult = evaluateFanOperatingPoint(
    matchingEquip,
    loadResult.supplyCfm,
    criticalPath.espRequiredInWg
  );

  const balancingSchedule = calculateBranchBalancingSchedule(criticalPath, selectedZone.diffusers);

  const targetNc = selectedZone.targetNc || 32;
  const locationCategory = selectedZone.ductLocationCategory || 'above-suspended-ceiling';
  const isEnhanced = selectedZone.enhancedAcousticPerformance || false;

  // Run acoustic verifications across all zone duct segments
  const acousticVerifications: DuctAcousticVerification[] = selectedZone.ducts.map((duct) => {
    if (duct.acousticVerification) return duct.acousticVerification;
    return verifyDuctSectionAcoustics(duct, {
      zoneName: selectedZone.name,
      targetNc,
      locationCategory,
      enhancedPerformance: isEnhanced,
      availableStaticPressureInWg: matchingEquip.maxRatedEspInWg
    });
  });

  const passCount = acousticVerifications.filter((v) => v.complianceStatus === 'PASS').length;
  const failCount = acousticVerifications.length - passCount;
  const allPass = failCount === 0;

  return (
    <div className="flex flex-col gap-6 bg-neutral-900 border border-neutral-800 p-5 rounded-2xl backdrop-blur-md shadow-2xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 border-b border-neutral-800 pb-4">
        <div>
          <h2 className="text-sm font-bold text-neutral-200 uppercase tracking-wider flex items-center gap-1.5">
            <Volume2 size={16} className="text-purple-400" />
            HVAC Duct Sizing, Acoustic Noise & Pressure Solver
          </h2>
          <p className="text-[11px] text-neutral-500 mt-1">
            Analyzing {selectedZone.name} ({isDucted ? 'Ducted System' : 'Unducted System'}) — Total Supply Flow: {loadResult.supplyCfm} {isImperial ? 'CFM' : 'L/s'} — Target NC {targetNc}
          </p>
        </div>

        {/* Top Summary Badges */}
        <div className="flex items-center gap-2.5">
          <div className="bg-neutral-950 border border-neutral-800 px-3.5 py-2 rounded-xl text-right">
            <span className="text-[9px] font-bold text-neutral-500 block uppercase">Acoustic Status</span>
            <span className={`text-xs font-bold font-mono ${allPass ? 'text-emerald-400' : 'text-red-400'}`}>
              {allPass ? `PASS (${passCount}/${acousticVerifications.length})` : `REDESIGN (${failCount} Fail)`}
            </span>
          </div>
          <div className="bg-neutral-950 border border-neutral-800 px-3.5 py-2 rounded-xl text-right">
            <span className="text-[9px] font-bold text-neutral-500 block uppercase">Total Required ESP</span>
            <span className="text-xs font-bold font-mono text-blue-400">
              {criticalPath.espRequiredInWg.toFixed(3)} in.wg
            </span>
          </div>
          <div className="bg-neutral-950 border border-neutral-800 px-3.5 py-2 rounded-xl text-right">
            <span className="text-[9px] font-bold text-neutral-500 block uppercase">Fan Rating</span>
            <span className={`text-xs font-bold font-mono ${fanResult.isValid ? 'text-emerald-400' : 'text-red-400'}`}>
              {matchingEquip.maxRatedEspInWg.toFixed(2)} in.wg
            </span>
          </div>
        </div>
      </div>

      {/* Sub-tab Navigation */}
      <div className="flex items-center gap-2 border-b border-neutral-800 pb-2">
        <button
          onClick={() => setActiveSubTab('acoustic')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            activeSubTab === 'acoustic'
              ? 'bg-purple-600/20 border border-purple-500/40 text-purple-300'
              : 'bg-neutral-950 text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <FileSpreadsheet size={13} />
          Duct Acoustic & Sizing Schedule (Section 8)
        </button>
        <button
          onClick={() => setActiveSubTab('pressure')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            activeSubTab === 'pressure'
              ? 'bg-blue-600/20 border border-blue-500/40 text-blue-300'
              : 'bg-neutral-950 text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Activity size={13} />
          Critical Path & Aerodynamic Balancing
        </button>
      </div>

      {!isDucted ? (
        <div className="bg-neutral-950/60 border border-neutral-850 p-6 rounded-xl text-center text-neutral-400 text-xs">
          <ShieldCheck size={28} className="text-teal-500 mx-auto mb-2" />
          <p className="font-bold text-neutral-200">Unducted System Active ({selectedZone.systemType?.toUpperCase()})</p>
          <p className="text-[11px] text-neutral-500 mt-1 max-w-md mx-auto">
            This system utilizes integral direct-discharge terminals. External ductwork and external static pressure resistance are not applicable (External ESP = 0.00 in.wg).
          </p>
        </div>
      ) : activeSubTab === 'acoustic' ? (
        /* Acoustic Noise & Duct Sizing Schedule Table */
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                <Volume2 size={12} className="text-purple-400" />
                Duct Section Acoustic Noise & Velocity Schedule
              </span>
              <p className="text-[10px] text-neutral-500 mt-0.5">
                Evaluated against ASHRAE noise guidance for location "{locationCategory.replace(/-/g, ' ')}" @ NC {targetNc}
              </p>
            </div>
            <div className="text-[10px] font-mono text-neutral-400 bg-neutral-950 px-2.5 py-1 rounded border border-neutral-850">
              Sections: {acousticVerifications.length} | Pass: <span className="text-emerald-400 font-bold">{passCount}</span> | Fail: <span className="text-red-400 font-bold">{failCount}</span>
            </div>
          </div>

          <div className="overflow-x-auto bg-neutral-950 border border-neutral-850 rounded-xl">
            <table className="w-full text-[11px] text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="border-b border-neutral-800 text-neutral-500 font-bold uppercase tracking-wider text-[9px] bg-neutral-950/80">
                  <th className="py-2.5 px-3">Duct ID</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Upstream → Downstream</th>
                  <th className="py-2.5 px-3 text-right">Flow (CFM)</th>
                  <th className="py-2.5 px-3">Dimensions</th>
                  <th className="py-2.5 px-3 text-right">Area (sq.ft)</th>
                  <th className="py-2.5 px-3 text-right">Actual Vel (FPM)</th>
                  <th className="py-2.5 px-3 text-right">Acoustic Limit</th>
                  <th className="py-2.5 px-3 text-right">ΔP (in.wg)</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3">Acoustic Diagnostics & Remediation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-850/60 text-neutral-300 font-mono">
                {acousticVerifications.map((item) => {
                  const isFail = item.complianceStatus === 'REQUIRES REDESIGN';
                  return (
                    <tr
                      key={item.ductId}
                      className={`hover:bg-neutral-900/50 transition-colors ${
                        isFail ? 'bg-red-950/15' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 font-sans font-bold text-neutral-200">{item.ductId}</td>
                      <td className="py-2.5 px-3 font-sans text-neutral-400 capitalize">{item.sectionCategory}</td>
                      <td className="py-2.5 px-3 font-sans text-[10px] text-neutral-400">
                        {item.upstreamNode} → {item.downstreamNode}
                      </td>
                      <td className="py-2.5 px-3 text-right text-emerald-400 font-bold">{item.cfm}</td>
                      <td className="py-2.5 px-3 text-neutral-200 font-bold">{item.dimensionsLabel}</td>
                      <td className="py-2.5 px-3 text-right text-neutral-400">{item.crossSectionalAreaSqFt.toFixed(3)}</td>
                      <td
                        className={`py-2.5 px-3 text-right font-bold ${
                          item.actualVelocityFpm > item.allowableAcousticVelocityFpm
                            ? 'text-red-400'
                            : item.actualVelocityFpm > item.allowableAcousticVelocityFpm * 0.9
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {item.actualVelocityFpm}
                      </td>
                      <td className="py-2.5 px-3 text-right text-purple-300">{item.allowableAcousticVelocityFpm}</td>
                      <td className="py-2.5 px-3 text-right text-amber-400">{item.pressureLossInWg.toFixed(3)}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 text-[9px] font-sans font-bold uppercase px-2 py-0.5 rounded ${
                            !isFail
                              ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50'
                              : 'bg-red-950/80 text-red-300 border border-red-800/60'
                          }`}
                        >
                          {!isFail ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}
                          {item.complianceStatus}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-sans text-[10px] text-neutral-400 max-w-[280px]">
                        {item.warnings.length > 0 && (
                          <div className="text-amber-300/90 mb-1">{item.warnings.join('; ')}</div>
                        )}
                        {item.proposedRemediation && (
                          <div className="text-blue-300 font-medium">{item.proposedRemediation}</div>
                        )}
                        {item.warnings.length === 0 && !item.proposedRemediation && (
                          <span className="text-neutral-600">Acoustically Compliant (Smooth Flow)</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Critical Path & Balancing Sub-tab */
        <div className="flex flex-col gap-6">
          {/* Fan Operating Status Alert */}
          <div
            className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${
              fanResult.isValid
                ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
                : 'bg-red-950/30 border-red-800/60 text-red-300'
            }`}
          >
            <div className="flex items-center gap-3">
              {fanResult.isValid ? (
                <ShieldCheck size={20} className="text-emerald-400" />
              ) : (
                <AlertTriangle size={20} className="text-red-400" />
              )}
              <div>
                <p className="text-xs font-bold">
                  {fanResult.isValid
                    ? 'Fan Static Pressure Capability Verified'
                    : 'Fan External Static Pressure Deficit'}
                </p>
                <p className="text-[11px] opacity-80 mt-0.5">
                  Operating Point: {fanResult.operatingCfm} CFM @ {fanResult.operatingEspInWg} in.wg (Operating Margin: +{fanResult.fanMarginInWg} in.wg)
                </p>
              </div>
            </div>
            <span className="text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded bg-neutral-950/80 border border-neutral-800">
              {matchingEquip.model}
            </span>
          </div>

          {/* Critical Path Pressure Breakdown Table */}
          <div>
            <div className="flex justify-between items-center mb-2.5">
              <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                <Activity size={12} className="text-blue-500" />
                Critical Path Loss Breakdown (Highest Resistance Path)
              </span>
              <span className="text-[10px] text-neutral-500 font-mono">
                Raw Loss: {criticalPath.totalLossInWg} in.wg + 15% Safety Margin ({criticalPath.marginInWg} in.wg)
              </span>
            </div>

            <div className="overflow-x-auto bg-neutral-950 border border-neutral-850 rounded-xl">
              <table className="w-full text-[11px] text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-800 text-neutral-500 font-bold uppercase tracking-wider text-[9px]">
                    <th className="py-2.5 px-3">Segment / Component</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3 text-right">Flow (CFM)</th>
                    <th className="py-2.5 px-3 text-right">Velocity (FPM)</th>
                    <th className="py-2.5 px-3 text-right">Pv (in.wg)</th>
                    <th className="py-2.5 px-3 text-right">ΔP (in.wg)</th>
                    <th className="py-2.5 px-3 text-right">Cumulative (in.wg)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-850/60 text-neutral-300 font-mono">
                  {criticalPath.supplySegments.map((seg) => (
                    <tr key={seg.id} className="hover:bg-neutral-900/40">
                      <td className="py-2 px-3 font-sans font-medium text-neutral-200">{seg.name}</td>
                      <td className="py-2 px-3 font-sans text-neutral-400 capitalize">{seg.type.replace('-', ' ')}</td>
                      <td className="py-2 px-3 text-right text-emerald-400">{seg.cfm}</td>
                      <td className="py-2 px-3 text-right">{seg.velocityFpm}</td>
                      <td className="py-2 px-3 text-right text-neutral-400">{seg.velocityPressureInWg.toFixed(3)}</td>
                      <td className="py-2 px-3 text-right text-amber-400 font-bold">{seg.deltaPInWg.toFixed(3)}</td>
                      <td className="py-2 px-3 text-right text-blue-400 font-bold">{seg.cumulativePInWg.toFixed(3)}</td>
                    </tr>
                  ))}
                  {criticalPath.returnSegments.map((seg) => (
                    <tr key={seg.id} className="hover:bg-neutral-900/40 bg-neutral-950/40">
                      <td className="py-2 px-3 font-sans font-medium text-neutral-300">{seg.name}</td>
                      <td className="py-2 px-3 font-sans text-neutral-400 capitalize">{seg.type.replace('-', ' ')}</td>
                      <td className="py-2 px-3 text-right text-emerald-400">{seg.cfm}</td>
                      <td className="py-2 px-3 text-right">{seg.velocityFpm}</td>
                      <td className="py-2 px-3 text-right text-neutral-400">{seg.velocityPressureInWg.toFixed(3)}</td>
                      <td className="py-2 px-3 text-right text-amber-400 font-bold">{seg.deltaPInWg.toFixed(3)}</td>
                      <td className="py-2 px-3 text-right text-blue-400 font-bold">{seg.cumulativePInWg.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Branch Balancing Schedule */}
          {balancingSchedule.length > 1 && (
            <div>
              <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-2.5">
                Branch Aerodynamic Balancing Schedule (Parallel Runouts)
              </span>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {balancingSchedule.map((b) => (
                  <div key={b.branchId} className="bg-neutral-950 border border-neutral-850 p-3 rounded-xl flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-neutral-200">Terminal {b.terminalId.slice(-4)}</span>
                      <span className="text-[10px] font-mono text-emerald-400">{b.branchFlowCfm} CFM</span>
                    </div>
                    <div className="flex justify-between text-[10px] text-neutral-400">
                      <span>Path Resistance:</span>
                      <span className="font-mono">{b.branchResistanceInWg.toFixed(3)} in.wg</span>
                    </div>
                    <div className="flex justify-between text-[10px] text-neutral-400 border-t border-neutral-850 pt-1">
                      <span>Damper Action:</span>
                      <strong className={`font-mono ${b.pressureDeficitInWg > 0.01 ? 'text-amber-400' : 'text-blue-400'}`}>
                        {b.recommendedDamperSetting}
                      </strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
