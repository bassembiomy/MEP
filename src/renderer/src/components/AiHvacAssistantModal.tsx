import React, { useState, useMemo } from 'react';
import { useProjectStore, Zone } from '../store/projectStore';
import { buildAiHvacPrompt } from '../engine/ai/aiHvacPromptBuilder';
import { generateCandidateVariations, AiHvacCandidate } from '../engine/ai/aiHvacGenerator';
import { validateAndParseAiHvacResponse, ParsedAiHvacResult } from '../engine/ai/aiHvacResponseParser';
import {
  X,
  Copy,
  Check,
  Cpu,
  Layers,
  FileCode,
  ShieldCheck,
  AlertTriangle,
  Sliders,
  Volume2,
  Wind,
  Gauge,
  Box
} from 'lucide-react';

interface AiHvacAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AiHvacAssistantModal: React.FC<AiHvacAssistantModalProps> = ({ isOpen, onClose }) => {
  const { zones, selectedZoneId, updateZone, selectZone, project } = useProjectStore();
  const [activeSubTab, setActiveSubTab] = useState<'variations' | 'prompt' | 'import'>('variations');
  const [copied, setCopied] = useState(false);
  const [customJson, setCustomJson] = useState('');
  const [parsedResult, setParsedResult] = useState<ParsedAiHvacResult | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>('cand-1');

  // Resolve target zone
  const targetZone: Zone | undefined = useMemo(() => {
    if (selectedZoneId) {
      return zones.find((z) => z.id === selectedZoneId);
    }
    return zones[0];
  }, [zones, selectedZoneId]);

  // Generate prompt payload for selected zone
  // (gated on isOpen: this modal stays mounted while closed and must not block
  // the main thread during canvas interactions like drawing or dragging zones)
  const promptPayload = useMemo(() => {
    if (!isOpen || !targetZone) return null;
    return buildAiHvacPrompt({
      zone: targetZone,
      units: project.units
    });
  }, [isOpen, targetZone, project.units]);

  // Generate 3 AI variations (expensive multi-strategy layout optimization —
  // only run when the studio is actually open)
  const candidates: AiHvacCandidate[] = useMemo(() => {
    if (!isOpen || !targetZone) return [];
    return generateCandidateVariations(targetZone, { units: project.units, drawingUnitsPerLength: project.scale });
  }, [isOpen, targetZone, project.units, project.scale]);

  const activeCandidate = candidates.find((c) => c.id === selectedCandidateId) || candidates[0];

  if (!isOpen) return null;

  const handleCopyPrompt = () => {
    if (!promptPayload) return;
    const fullText = `=== SYSTEM PROMPT ===\n${promptPayload.systemPrompt}\n\n=== USER PROMPT ===\n${promptPayload.userPrompt}`;
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApplyCandidate = (candidate: AiHvacCandidate) => {
    if (!targetZone) return;
    const { design } = candidate;

    const parsed = validateAndParseAiHvacResponse(design, targetZone);
    if (!parsed.success) {
      alert(`Cannot apply layout: ${parsed.errors.join(', ')}`);
      return;
    }

    updateZone(targetZone.id, {
      diffusers: parsed.diffusers,
      ducts: parsed.ducts,
      unitPos: parsed.unitPos,
      catalogModel: parsed.catalogModel,
      catalogQty: parsed.catalogQty,
      catalogEsp: parsed.catalogEsp
    });

    onClose();
  };

  const handleValidateCustomJson = () => {
    if (!customJson.trim()) return;
    const res = validateAndParseAiHvacResponse(customJson, targetZone);
    setParsedResult(res);
  };

  const handleApplyCustomJson = () => {
    if (!targetZone || !parsedResult || !parsedResult.success) return;
    updateZone(targetZone.id, {
      diffusers: parsedResult.diffusers,
      ducts: parsedResult.ducts,
      unitPos: parsedResult.unitPos,
      catalogModel: parsedResult.catalogModel,
      catalogQty: parsedResult.catalogQty,
      catalogEsp: parsedResult.catalogEsp
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/80">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-blue-600 to-teal-500 p-2.5 rounded-2xl shadow-lg shadow-blue-500/20 text-white">
              <Cpu size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-neutral-100">AI HVAC Design Agent & Sizing Studio</h2>
                <span className="bg-blue-500/20 text-blue-400 border border-blue-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                  Preliminary – not a code compliance check
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                Algorithmic spatial distribution, equal-friction duct sizer & multi-objective layout scoring
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 transition-all cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Target Zone Selector & Navigation Sub-Tabs */}
        <div className="flex flex-wrap items-center justify-between px-6 py-3 border-b border-neutral-850 bg-neutral-950/50 gap-4">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-400 font-medium">Target Zone:</span>
            <select
              value={targetZone?.id || ''}
              onChange={(e) => {
                const z = zones.find((item) => item.id === e.target.value);
                if (z) {
                  selectZone(z.id);
                }
              }}
              className="bg-neutral-800 border border-neutral-700 text-neutral-200 font-semibold px-3 py-1.5 rounded-xl text-xs focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name || `Zone (${z.id})`}
                </option>
              ))}
            </select>
            {targetZone && (
              <span className="text-[11px] text-neutral-500 ml-2">
                (Area: {promptPayload?.zoneMetrics.areaSqFt} sq ft • Load: {promptPayload?.zoneMetrics.totalLoadBtuPerHour.toLocaleString()} BTU/h • {promptPayload?.zoneMetrics.totalAirflowCfm.toLocaleString()} CFM)
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 bg-neutral-900 p-1 rounded-xl border border-neutral-800">
            <button
              onClick={() => setActiveSubTab('variations')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeSubTab === 'variations'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Layers size={14} />
              AI Variations (Scored)
            </button>
            <button
              onClick={() => setActiveSubTab('prompt')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeSubTab === 'prompt'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <FileCode size={14} />
              Prompt & Catalog Slices
            </button>
            <button
              onClick={() => setActiveSubTab('import')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeSubTab === 'import'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Sliders size={14} />
              Import AI JSON
            </button>
          </div>
        </div>

        {/* Main Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!targetZone ? (
            <div className="p-8 text-center text-neutral-400">
              <AlertTriangle className="mx-auto mb-2 text-yellow-500" size={32} />
              <p>No zone polygon created yet. Please draw a room polygon on the canvas first.</p>
            </div>
          ) : (
            <>
              {/* TAB 1: AI Multi-Variations & Neural Scoring */}
              {activeSubTab === 'variations' && (
                <div className="space-y-6">
                  {/* Candidate Selection Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {candidates.map((cand) => {
                      const isSelected = cand.id === selectedCandidateId;
                      return (
                        <div
                          key={cand.id}
                          onClick={() => setSelectedCandidateId(cand.id)}
                          className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                            isSelected
                              ? 'bg-blue-950/40 border-blue-500/80 shadow-lg shadow-blue-500/10'
                              : 'bg-neutral-900/60 border-neutral-800 hover:border-neutral-700'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-neutral-200">{cand.name}</span>
                              <span className="bg-blue-500/20 text-blue-400 border border-blue-500/30 text-[10px] font-bold px-2 py-0.5 rounded-md">
                                Score: {cand.scores.overallScore}/100
                              </span>
                            </div>
                            <p className="text-[11px] text-neutral-400 mb-3 leading-relaxed">
                              {cand.description}
                            </p>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-[10px] bg-neutral-950/60 p-2.5 rounded-xl border border-neutral-850">
                            <div>
                              <span className="text-neutral-500 block">Diffusers</span>
                              <span className="font-mono font-bold text-neutral-200">
                                {cand.scores.metrics.diffuserCount} units ({cand.scores.metrics.avgDiffuserNc} NC)
                              </span>
                            </div>
                            <div>
                              <span className="text-neutral-500 block">Max Duct Velocity</span>
                              <span className="font-mono font-bold text-neutral-200">
                                {cand.scores.metrics.maxDuctVelocityFpm} FPM
                              </span>
                            </div>
                            <div>
                              <span className="text-neutral-500 block">Est. Static Pressure</span>
                              <span className="font-mono font-bold text-neutral-200">
                                {cand.scores.metrics.estimatedEspInWg}" w.g.
                              </span>
                            </div>
                            <div>
                              <span className="text-neutral-500 block">Total Duct Run</span>
                              <span className="font-mono font-bold text-neutral-200">
                                {cand.scores.metrics.totalDuctLengthFt} ft
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Selected Candidate Detailed Evaluation */}
                  {activeCandidate && (
                    <div className="bg-neutral-950/60 border border-neutral-800 rounded-2xl p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-bold text-neutral-200 flex items-center gap-2">
                            <ShieldCheck size={16} className="text-teal-400" />
                            {activeCandidate.name} — Engineering Evaluation
                          </h3>
                          <p className="text-xs text-neutral-400 mt-0.5">
                            ACU: <span className="text-neutral-200 font-semibold">{activeCandidate.design.systemSummary.selectedAcuModel}</span> • Total Airflow: <span className="text-neutral-200 font-semibold">{activeCandidate.design.systemSummary.totalCfm.toLocaleString()} CFM</span>
                          </p>
                        </div>

                        <button
                          onClick={() => handleApplyCandidate(activeCandidate)}
                          className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-teal-500 hover:from-blue-500 hover:to-teal-400 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-lg shadow-blue-500/20 transition-all cursor-pointer"
                        >
                          <Check size={16} />
                          Apply Layout to CAD Canvas
                        </button>
                      </div>

                      {/* Score Radar / Bars */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                        <div className="bg-neutral-900/80 p-3 rounded-xl border border-neutral-800">
                          <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
                            <span className="flex items-center gap-1.5"><Box size={13} className="text-blue-400" /> Material & Run</span>
                            <span className="font-mono font-bold text-neutral-200">{activeCandidate.scores.materialScore}%</span>
                          </div>
                          <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                            <div className="bg-blue-500 h-full" style={{ width: `${activeCandidate.scores.materialScore}%` }} />
                          </div>
                        </div>

                        <div className="bg-neutral-900/80 p-3 rounded-xl border border-neutral-800">
                          <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
                            <span className="flex items-center gap-1.5"><Volume2 size={13} className="text-teal-400" /> Acoustic (NC)</span>
                            <span className="font-mono font-bold text-neutral-200">{activeCandidate.scores.acousticScore}%</span>
                          </div>
                          <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                            <div className="bg-teal-500 h-full" style={{ width: `${activeCandidate.scores.acousticScore}%` }} />
                          </div>
                        </div>

                        <div className="bg-neutral-900/80 p-3 rounded-xl border border-neutral-800">
                          <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
                            <span className="flex items-center gap-1.5"><Gauge size={13} className="text-indigo-400" /> ESP Efficiency</span>
                            <span className="font-mono font-bold text-neutral-200">{activeCandidate.scores.pressureDropScore}%</span>
                          </div>
                          <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                            <div className="bg-indigo-500 h-full" style={{ width: `${activeCandidate.scores.pressureDropScore}%` }} />
                          </div>
                        </div>

                        <div className="bg-neutral-900/80 p-3 rounded-xl border border-neutral-800">
                          <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
                            <span className="flex items-center gap-1.5"><Wind size={13} className="text-emerald-400" /> ADPI Coverage</span>
                            <span className="font-mono font-bold text-neutral-200">{activeCandidate.scores.spatialCoverageScore}%</span>
                          </div>
                          <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                            <div className="bg-emerald-500 h-full" style={{ width: `${activeCandidate.scores.spatialCoverageScore}%` }} />
                          </div>
                        </div>
                      </div>

                      {/* Recommendations & Warnings */}
                      {activeCandidate.scores.recommendations.length > 0 && (
                        <div className="bg-neutral-900/60 p-3 rounded-xl border border-neutral-850 text-xs text-neutral-400 space-y-1">
                          <span className="font-bold text-neutral-300 block text-[11px]">Engineering Insights:</span>
                          {activeCandidate.scores.recommendations.map((rec, i) => (
                            <p key={i} className="text-[11px] flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                              {rec}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: Prompt Inspector & Dynamic Catalog Slices */}
              {activeSubTab === 'prompt' && promptPayload && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-neutral-950/60 p-4 rounded-2xl border border-neutral-800">
                    <div>
                      <h3 className="text-xs font-bold text-neutral-200">Engineering Prompt with Injected Catalog Data</h3>
                      <p className="text-[11px] text-neutral-400 mt-0.5">
                        Feed this exact prompt into ChatGPT, Claude, Gemini, or your custom fine-tuned model.
                      </p>
                    </div>

                    <button
                      onClick={handleCopyPrompt}
                      className="flex items-center gap-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold px-4 py-2 rounded-xl transition-all cursor-pointer border border-neutral-700"
                    >
                      {copied ? <Check size={14} className="text-teal-400" /> : <Copy size={14} />}
                      {copied ? 'Copied to Clipboard!' : 'Copy Complete Prompt'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider">System Prompt (Rules & Sizing Formulas)</span>
                      <textarea
                        readOnly
                        value={promptPayload.systemPrompt}
                        rows={14}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-[11px] font-mono text-neutral-300 focus:outline-none resize-none"
                      />
                    </div>

                    <div className="space-y-2">
                      <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider">User Prompt (Zone Polygon & Catalogs)</span>
                      <textarea
                        readOnly
                        value={promptPayload.userPrompt}
                        rows={14}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-[11px] font-mono text-neutral-300 focus:outline-none resize-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: Import Custom AI JSON */}
              {activeSubTab === 'import' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Paste External AI JSON Response</span>
                    <textarea
                      value={customJson}
                      onChange={(e) => setCustomJson(e.target.value)}
                      placeholder='Paste JSON output here (or markdown block with ```json ... ```)'
                      rows={10}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl p-3 text-xs font-mono text-neutral-300 focus:outline-none focus:border-blue-500 resize-none"
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleValidateCustomJson}
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all cursor-pointer"
                    >
                      <ShieldCheck size={16} />
                      Validate & Sizing Check
                    </button>
                  </div>

                  {parsedResult && (
                    <div className={`p-4 rounded-2xl border text-xs space-y-3 ${
                      parsedResult.success ? 'bg-teal-950/30 border-teal-500/50' : 'bg-red-950/30 border-red-500/50'
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-neutral-200">
                          Validation Status: {parsedResult.success ? '✅ Sizing & Coordinates Valid' : '❌ Validation Failed'}
                        </span>
                        {parsedResult.success && (
                          <span className="bg-teal-500/20 text-teal-400 text-[10px] font-bold px-2 py-0.5 rounded-md">
                            Score: {parsedResult.complianceScore}/100
                          </span>
                        )}
                      </div>

                      {parsedResult.success ? (
                        <div className="space-y-2">
                          <p className="text-neutral-300 text-[11px]">
                            Parsed <strong>{parsedResult.diffusers.length}</strong> diffusers, <strong>{parsedResult.ducts.length}</strong> duct segments, ACU model: <strong>{parsedResult.catalogModel}</strong> (ESP: {parsedResult.catalogEsp}).
                          </p>
                          {parsedResult.warnings.length > 0 && (
                            <div className="text-yellow-400 text-[11px]">
                              Warnings: {parsedResult.warnings.join(' | ')}
                            </div>
                          )}
                          <button
                            onClick={handleApplyCustomJson}
                            className="flex items-center gap-2 bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all cursor-pointer mt-2"
                          >
                            <Check size={14} />
                            Apply Parsed Layout to Zone
                          </button>
                        </div>
                      ) : (
                        <div className="text-red-400 text-[11px]">
                          Errors: {parsedResult.errors.join(' | ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
