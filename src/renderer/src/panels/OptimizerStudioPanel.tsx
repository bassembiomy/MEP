import React, { useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { calculateZoneLoad } from '../engine/loadCalc';
import { generateSystemCandidates } from '../engine/systemDesigner';
import { createDeploymentPreview } from '../engine/deploymentManager';
import { SelectionTraceViewer } from '../components/SelectionTraceViewer';
import { ArchitectureInspectorModal } from '../components/ArchitectureInspectorModal';
import { SystemDesignCandidate } from '../engine/types';
import {
  Sparkles,
  Award,
  Zap,
  DollarSign,
  Sliders,
  AlertOctagon,
  ArrowRight,
  Eye,
  Undo2,
  Redo2,
  CheckCircle2,
  Layers,
  Calculator,
  Boxes,
  Maximize2
} from 'lucide-react';

export const OptimizerStudioPanel: React.FC = () => {
  const {
    selectedZoneId,
    zones,
    project,
    optimizationWeights,
    setOptimizationWeights,
    selectedSystemTypes,
    loadedCatalogs,
    dxfEntities,
    dxfBoundingBox,
    activePreview,
    setPreview,
    applyCandidateTransaction,
    undo,
    redo,
    undoStack,
    redoStack
  } = useProjectStore();

  const [deploymentFeedback, setDeploymentFeedback] = useState<{
    status: 'idle' | 'success' | 'error';
    message?: string;
  }>({ status: 'idle' });

  const [cardTabs, setCardTabs] = useState<Record<string, 'overview' | 'components' | 'algorithm'>>({});
  const [inspectingCandidate, setInspectingCandidate] = useState<SystemDesignCandidate | null>(null);

  const getCardTab = (candId: string): 'overview' | 'components' | 'algorithm' => {
    return cardTabs[candId] || 'overview';
  };

  const setCardTab = (candId: string, tab: 'overview' | 'components' | 'algorithm') => {
    setCardTabs((prev) => ({ ...prev, [candId]: tab }));
  };

  const selectedZone = zones.find((z) => z.id === selectedZoneId) || zones[0];

  if (!selectedZone) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-2xl text-center text-neutral-500 text-xs shadow-xl">
        <Sparkles size={24} className="text-neutral-700 mx-auto mb-3 animate-pulse" />
        Select or draw a zone to run the multi-objective optimizer.
      </div>
    );
  }

  const isImperial = project.units === 'imperial';
  const loadResult = calculateZoneLoad(selectedZone, project);

  // Generate bounded candidate designs
  const recommendations = generateSystemCandidates(
    loadResult.totalLoad,
    loadResult.sensibleLoad,
    loadResult.supplyCfm,
    selectedZone.spaceTypeId,
    loadResult.area,
    isImperial,
    optimizationWeights,
    selectedSystemTypes,
    loadedCatalogs,
    selectedZone.ducts,
    selectedZone.diffusers
  );

  const handlePreviewCandidate = (candidate: any) => {
    const preview = createDeploymentPreview(
      candidate,
      selectedZone,
      zones,
      project,
      dxfEntities,
      dxfBoundingBox
    );
    setPreview(preview);
  };

  const handleApplyCandidate = (candidate: any) => {
    const result = applyCandidateTransaction(candidate);
    if (result.success) {
      setDeploymentFeedback({
        status: 'success',
        message: `Successfully deployed ${candidate.equipment.model} to ${selectedZone.name}.`
      });
      setTimeout(() => setDeploymentFeedback({ status: 'idle' }), 4000);
    } else {
      setDeploymentFeedback({
        status: 'error',
        message: result.error || 'Deployment failed and was rolled back.'
      });
    }
  };

  // Normalization percentage for sliders
  const totalWeight =
    optimizationWeights.wComfort +
    optimizationWeights.wEnergy +
    optimizationWeights.wCost +
    optimizationWeights.wNoise +
    optimizationWeights.wPressure +
    optimizationWeights.wSpace +
    optimizationWeights.wPreference || 1.0;

  return (
    <div className="flex flex-col gap-6 bg-neutral-900 border border-neutral-800 p-5 rounded-2xl backdrop-blur-md shadow-2xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 border-b border-neutral-800 pb-4">
        <div>
          <h2 className="text-sm font-bold text-neutral-200 uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles size={16} className="text-amber-500" />
            Deterministic Multi-Objective HVAC Optimizer Studio
          </h2>
          <p className="text-[11px] text-neutral-500 mt-1">
            Evaluating feasible equipment, ductwork, diffuser throw, and fan curve performance for {selectedZone.name}
          </p>
        </div>

        {/* Action Controls (Undo / Redo & Workspace Status) */}
        <div className="flex items-center gap-2">
          <button
            onClick={undo}
            disabled={undoStack.length === 0}
            title="Undo last deployment (Ctrl+Z)"
            className="flex items-center gap-1 bg-neutral-950 hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed border border-neutral-800 text-neutral-300 px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition-all cursor-pointer"
          >
            <Undo2 size={12} />
            Undo ({undoStack.length})
          </button>
          <button
            onClick={redo}
            disabled={redoStack.length === 0}
            title="Redo deployment (Ctrl+Y)"
            className="flex items-center gap-1 bg-neutral-950 hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed border border-neutral-800 text-neutral-300 px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition-all cursor-pointer"
          >
            <Redo2 size={12} />
            Redo ({redoStack.length})
          </button>
          <span className="bg-neutral-950 border border-neutral-800 px-3 py-1.5 rounded-xl text-neutral-400 font-mono text-[10px]">
            Airflow: <strong className="text-emerald-400">{loadResult.supplyCfm} {isImperial ? 'CFM' : 'L/s'}</strong>
          </span>
        </div>
      </div>

      {/* Transaction Feedback Notification Banner */}
      {deploymentFeedback.status === 'success' && (
        <div className="bg-emerald-950/40 border border-emerald-800/60 p-3 rounded-xl flex items-center justify-between text-emerald-300 text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            <span>{deploymentFeedback.message}</span>
          </div>
          <button
            onClick={undo}
            className="text-[10px] underline font-bold hover:text-white cursor-pointer"
          >
            Undo Deployment
          </button>
        </div>
      )}

      {deploymentFeedback.status === 'error' && (
        <div className="bg-red-950/40 border border-red-800/60 p-3 rounded-xl flex items-center gap-2 text-red-300 text-xs">
          <AlertOctagon size={16} className="text-red-400 shrink-0" />
          <span>{deploymentFeedback.message}</span>
        </div>
      )}

      {/* Active Preview Banner */}
      {activePreview && (
        <div className="bg-blue-950/30 border border-blue-800/50 p-3 rounded-xl flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-blue-300">
            <Eye size={16} className="text-blue-400 shrink-0" />
            <span>
              Previewing: <strong>{activePreview.candidate.equipment.model}</strong> ({activePreview.manifest.terminals.length} terminals, {activePreview.manifest.ducts.length} duct segments)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPreview(null)}
              className="text-[10px] text-neutral-400 hover:text-white bg-neutral-900 px-2.5 py-1 rounded-lg border border-neutral-800 cursor-pointer"
            >
              Clear Preview
            </button>
            <button
              onClick={() => handleApplyCandidate(activePreview.candidate)}
              disabled={activePreview.isApplyDisabled}
              className="text-[10px] text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 font-bold px-3 py-1 rounded-lg transition-all cursor-pointer"
            >
              Commit Design
            </button>
          </div>
        </div>
      )}

      {/* Optimization Multi-Objective Weight Sliders */}
      <div className="bg-neutral-950/80 border border-neutral-850 p-4 rounded-xl flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
            <Sliders size={12} className="text-blue-500" />
            Configurable Scoring Weights & Objectives
          </span>
          <span className="text-[9px] text-neutral-500 font-mono">Normalized Sum: 100%</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 text-[10px]">
          {/* Comfort Weight */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-neutral-400">
              <span>Comfort</span>
              <span className="font-mono text-blue-400 font-bold">{Math.round((optimizationWeights.wComfort / totalWeight) * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={optimizationWeights.wComfort}
              onChange={(e) => setOptimizationWeights({ wComfort: parseFloat(e.target.value) || 0 })}
              className="accent-blue-500 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
            />
          </div>

          {/* Energy Weight */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-neutral-400">
              <span>Energy</span>
              <span className="font-mono text-emerald-400 font-bold">{Math.round((optimizationWeights.wEnergy / totalWeight) * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={optimizationWeights.wEnergy}
              onChange={(e) => setOptimizationWeights({ wEnergy: parseFloat(e.target.value) || 0 })}
              className="accent-emerald-500 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
            />
          </div>

          {/* Cost Weight */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-neutral-400">
              <span>Low Cost</span>
              <span className="font-mono text-amber-400 font-bold">{Math.round((optimizationWeights.wCost / totalWeight) * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={optimizationWeights.wCost}
              onChange={(e) => setOptimizationWeights({ wCost: parseFloat(e.target.value) || 0 })}
              className="accent-amber-500 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
            />
          </div>

          {/* Noise Weight */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-neutral-400">
              <span>Acoustics</span>
              <span className="font-mono text-purple-400 font-bold">{Math.round((optimizationWeights.wNoise / totalWeight) * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={optimizationWeights.wNoise}
              onChange={(e) => setOptimizationWeights({ wNoise: parseFloat(e.target.value) || 0 })}
              className="accent-purple-500 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
            />
          </div>

          {/* Pressure Weight */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-neutral-400">
              <span>Low ESP</span>
              <span className="font-mono text-teal-400 font-bold">{Math.round((optimizationWeights.wPressure / totalWeight) * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={optimizationWeights.wPressure}
              onChange={(e) => setOptimizationWeights({ wPressure: parseFloat(e.target.value) || 0 })}
              className="accent-teal-500 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
            />
          </div>

          {/* Space Weight */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-neutral-400">
              <span>Plenum</span>
              <span className="font-mono text-neutral-400 font-bold">{Math.round((optimizationWeights.wSpace / totalWeight) * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={optimizationWeights.wSpace}
              onChange={(e) => setOptimizationWeights({ wSpace: parseFloat(e.target.value) || 0 })}
              className="accent-neutral-500 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
            />
          </div>

          {/* Preference Weight */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-neutral-400">
              <span>Preference</span>
              <span className="font-mono text-pink-400 font-bold">{Math.round((optimizationWeights.wPreference / totalWeight) * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={optimizationWeights.wPreference}
              onChange={(e) => setOptimizationWeights({ wPreference: parseFloat(e.target.value) || 0 })}
              className="accent-pink-500 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Top Ranked Candidates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {recommendations.candidates.map((cand) => {
          const scoreColor =
            cand.subscores.totalScore >= 80
              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
              : cand.subscores.totalScore >= 60
              ? 'text-blue-400 bg-blue-500/10 border-blue-500/30'
              : 'text-neutral-500 bg-neutral-500/10 border-neutral-500/30';

          const isPreviewing = activePreview?.candidate.id === cand.id;
          const activeCardTab = getCardTab(cand.id);

          return (
            <div
              key={cand.id}
              className={`flex flex-col justify-between bg-neutral-950 border p-4 rounded-xl transition-all shadow-md ${
                isPreviewing
                  ? 'border-blue-500 ring-1 ring-blue-500/50 shadow-blue-500/10'
                  : cand.isValid
                  ? 'border-neutral-850 hover:border-neutral-750'
                  : 'border-red-900/40 opacity-75'
              }`}
            >
              <div>
                {/* Candidate Header */}
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-bold text-neutral-200">{cand.equipment.model}</h3>
                      {cand.categoryRankings?.isBestOverall && (
                        <span className="flex items-center gap-0.5 text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded">
                          <Award size={10} /> Best Overall
                        </span>
                      )}
                      {cand.categoryRankings?.isBestEnergy && (
                        <span className="flex items-center gap-0.5 text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                          <Zap size={10} /> Highest Efficiency
                        </span>
                      )}
                      {cand.categoryRankings?.isLowestCost && (
                        <span className="flex items-center gap-0.5 text-[9px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 px-1.5 py-0.5 rounded">
                          <DollarSign size={10} /> Lowest Cost
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-neutral-400 capitalize">
                      {cand.quantity} × {cand.systemType} ({cand.equipment.nominalTons} TR)
                    </span>
                  </div>

                  <span className={`text-xs font-bold font-mono px-2.5 py-1 rounded border ${scoreColor}`}>
                    Score: {cand.subscores.totalScore}
                  </span>
                </div>

                {/* Candidate Card Sub-Navigation */}
                <div className="flex items-center gap-1.5 mt-3 border-b border-neutral-850 pb-2 text-[10px]">
                  <button
                    onClick={() => setCardTab(cand.id, 'overview')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 ${
                      activeCardTab === 'overview'
                        ? 'bg-neutral-800 text-white border border-neutral-700 shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
                    }`}
                  >
                    <Sliders size={11} />
                    Overview
                  </button>
                  <button
                    onClick={() => setCardTab(cand.id, 'components')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 ${
                      activeCardTab === 'components'
                        ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40 shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
                    }`}
                  >
                    <Layers size={11} />
                    Components ({cand.systemArchitecture?.components.length || 0})
                  </button>
                  <button
                    onClick={() => setCardTab(cand.id, 'algorithm')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1 ${
                      activeCardTab === 'algorithm'
                        ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
                    }`}
                  >
                    <Calculator size={11} />
                    Algorithm Trace (7 Steps)
                  </button>
                </div>

                {/* TAB 1: Overview & Metrics */}
                {activeCardTab === 'overview' && (
                  <div className="flex flex-col gap-2 mt-2">
                    {/* Trade-off summary */}
                    <p className="text-[10px] text-neutral-400 leading-relaxed">{cand.tradeOffSummary}</p>

                    {/* Subscores Bar Meter */}
                    <div className="grid grid-cols-4 gap-2 mt-1 bg-neutral-900/60 p-2.5 rounded-lg border border-neutral-850 text-[9px]">
                      <div>
                        <span className="text-neutral-500 block">Comfort</span>
                        <strong className="text-blue-400 font-mono">{cand.subscores.sComfort}/100</strong>
                      </div>
                      <div>
                        <span className="text-neutral-500 block">Energy</span>
                        <strong className="text-emerald-400 font-mono">{cand.subscores.sEnergy}/100</strong>
                      </div>
                      <div>
                        <span className="text-neutral-500 block">Cost Index</span>
                        <strong className="text-amber-400 font-mono">{cand.subscores.sCost}/100</strong>
                      </div>
                      <div>
                        <span className="text-neutral-500 block">Noise (NC)</span>
                        <strong className="text-purple-400 font-mono">{cand.subscores.sNoise}/100</strong>
                      </div>
                    </div>

                    {/* Engineering Sizing Specifications */}
                    <div className="mt-1 flex flex-col gap-1 text-[10px] text-neutral-400">
                      <div className="flex justify-between border-b border-neutral-900 pb-1">
                        <span>Installed Capacity / Flow:</span>
                        <strong className="text-neutral-200 font-mono">
                          {(cand.quantity * cand.equipment.totalCapacityBtuPerHour).toLocaleString()} Btu/h | {cand.quantity * cand.equipment.nominalCfm} CFM
                        </strong>
                      </div>
                      {cand.ductwork && (
                        <div className="flex justify-between border-b border-neutral-900 pb-1">
                          <span>Calculated Static Pressure:</span>
                          <strong className="text-blue-400 font-mono font-semibold">
                            {cand.ductwork.criticalPath.espRequiredInWg.toFixed(3)} in.wg (Max Fan ESP: {cand.equipment.maxRatedEspInWg.toFixed(2)})
                          </strong>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>Diffuser Configuration:</span>
                        <strong className="text-teal-400 font-mono">
                          {cand.diffusers.quantity} × {cand.diffusers.diffuserRecord.faceSizeIn.width}"x{cand.diffusers.diffuserRecord.faceSizeIn.height}" (NC {cand.diffusers.actualNc})
                        </strong>
                      </div>
                    </div>

                    {/* Diagnostics / Violations */}
                    {cand.diagnostics.length > 0 && (
                      <div className="mt-2 flex flex-col gap-1">
                        {cand.diagnostics.map((diag, i) => (
                          <div
                            key={i}
                            className={`text-[9px] p-2 rounded flex items-start gap-1.5 ${
                              diag.severity === 'error' ? 'bg-red-950/30 text-red-400 border border-red-800/40' : 'bg-amber-950/20 text-amber-400 border border-amber-800/30'
                            }`}
                          >
                            <AlertOctagon size={12} className="shrink-0 mt-0.5" />
                            <div>
                              <strong>{diag.message}</strong>
                              <p className="opacity-80 mt-0.5 font-sans">{diag.remediation}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: Bill of Components */}
                {activeCardTab === 'components' && (
                  <div className="flex flex-col gap-2 mt-2">
                    <div className="flex justify-between items-center bg-neutral-900/60 p-2 rounded-lg border border-neutral-850">
                      <span className="text-[10px] font-bold text-neutral-300">
                        {cand.systemArchitecture?.systemName}
                      </span>
                      <button
                        onClick={() => setInspectingCandidate(cand)}
                        className="text-[9px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1 cursor-pointer"
                      >
                        <Maximize2 size={10} /> Full Inspector
                      </button>
                    </div>

                    <div className="max-h-60 overflow-y-auto rounded-lg border border-neutral-850 bg-neutral-950/70 text-[10px]">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-neutral-900 border-b border-neutral-800 text-[9px] text-neutral-500 uppercase font-semibold">
                            <th className="p-2">Tag</th>
                            <th className="p-2">Item</th>
                            <th className="p-2 text-center">Qty</th>
                            <th className="p-2">Specification / Size</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-900">
                          {cand.systemArchitecture?.components.map((c) => (
                            <tr key={c.id} className="hover:bg-neutral-900/30">
                              <td className="p-2 font-mono font-bold text-teal-400">{c.tag}</td>
                              <td className="p-2 font-medium text-neutral-200">
                                {c.name}
                                <span className="block text-[9px] text-neutral-500 font-mono">{c.modelOrType}</span>
                              </td>
                              <td className="p-2 text-center font-mono text-neutral-300">{c.quantity}</td>
                              <td className="p-2 text-neutral-300">
                                <span>{c.specification}</span>
                                {c.connectionSize && (
                                  <span className="block text-[9px] text-neutral-500 font-mono">Conn: {c.connectionSize}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* TAB 3: Selection Algorithm Trace */}
                {activeCardTab === 'algorithm' && (
                  <div className="mt-2">
                    <SelectionTraceViewer trace={cand.algorithmTrace} />
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="mt-4 pt-3 border-t border-neutral-900 flex justify-between items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handlePreviewCandidate(cand)}
                    className="flex items-center gap-1 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                  >
                    <Eye size={12} />
                    {isPreviewing ? 'Viewing Preview' : 'Preview Layout'}
                  </button>
                  <button
                    onClick={() => setInspectingCandidate(cand)}
                    className="flex items-center gap-1 bg-neutral-900 hover:bg-neutral-800 text-teal-300 border border-neutral-800 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                    title="Inspect complete system architecture, standards & bill of materials"
                  >
                    <Layers size={12} />
                    Inspect Architecture
                  </button>
                </div>
                <button
                  onClick={() => handleApplyCandidate(cand)}
                  disabled={!cand.isValid}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all shadow-md cursor-pointer"
                >
                  Apply Design <ArrowRight size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Full Architecture Inspector Modal */}
      {inspectingCandidate && (
        <ArchitectureInspectorModal
          candidate={inspectingCandidate}
          onClose={() => setInspectingCandidate(null)}
        />
      )}
    </div>
  );
};
