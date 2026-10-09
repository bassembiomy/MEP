import React, { useState } from 'react';
import { SelectionAlgorithmTrace } from '../engine/types';
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Calculator, ShieldCheck, FileText } from 'lucide-react';

interface SelectionTraceViewerProps {
  trace?: SelectionAlgorithmTrace;
}

export const SelectionTraceViewer: React.FC<SelectionTraceViewerProps> = ({ trace }) => {
  const [expandedSteps, setExpandedSteps] = useState<number[]>([1, 2, 3, 5]);

  if (!trace || !trace.steps || trace.steps.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-neutral-500 bg-neutral-950/50 rounded-xl border border-neutral-850">
        No selection algorithm trace available for this candidate.
      </div>
    );
  }

  const toggleStep = (stepNum: number) => {
    setExpandedSteps((prev) =>
      prev.includes(stepNum) ? prev.filter((s) => s !== stepNum) : [...prev, stepNum]
    );
  };

  const expandAll = () => setExpandedSteps([1, 2, 3, 4, 5, 6, 7]);
  const collapseAll = () => setExpandedSteps([]);

  return (
    <div className="flex flex-col gap-3 text-xs">
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-neutral-900/80 p-3 rounded-xl border border-neutral-800">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${trace.overallPassed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
            <Calculator size={14} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-neutral-200">Deterministic 7-Step Selection Algorithm Trace</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                trace.overallPassed
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}>
                {trace.overallPassed ? 'ALL CHECKED CRITERIA PASSED (PRELIMINARY)' : 'DEVIATIONS DETECTED'}
              </span>
            </div>
            <p className="text-[10px] text-neutral-400 mt-0.5">{trace.engineeringRemarks}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[10px]">
          <button
            onClick={expandAll}
            className="text-neutral-400 hover:text-white bg-neutral-950 px-2 py-1 rounded border border-neutral-800 cursor-pointer"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="text-neutral-400 hover:text-white bg-neutral-950 px-2 py-1 rounded border border-neutral-800 cursor-pointer"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Steps List */}
      <div className="flex flex-col gap-2">
        {trace.steps.map((step) => {
          const isExpanded = expandedSteps.includes(step.stepNumber);

          return (
            <div
              key={step.stepNumber}
              className={`border rounded-xl transition-all duration-200 overflow-hidden ${
                step.passed
                  ? 'bg-neutral-950/70 border-neutral-850 hover:border-neutral-750'
                  : 'bg-amber-950/20 border-amber-800/40'
              }`}
            >
              {/* Step Header Toggle */}
              <button
                onClick={() => toggleStep(step.stepNumber)}
                className="w-full flex items-center justify-between p-2.5 text-left cursor-pointer hover:bg-neutral-900/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold font-mono ${
                    step.passed ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  }`}>
                    {step.stepNumber}
                  </span>
                  <span className="font-semibold text-neutral-200 text-[11px]">{step.stepName}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold text-neutral-300 bg-neutral-900 px-2 py-0.5 rounded border border-neutral-800">
                    {step.calculatedValue}
                  </span>
                  {step.passed ? (
                    <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                      <CheckCircle2 size={10} /> PASS
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[9px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
                      <AlertTriangle size={10} /> REVIEW
                    </span>
                  )}
                  {isExpanded ? <ChevronUp size={12} className="text-neutral-500" /> : <ChevronDown size={12} className="text-neutral-500" />}
                </div>
              </button>

              {/* Step Details Body */}
              {isExpanded && (
                <div className="p-3 border-t border-neutral-850/60 bg-neutral-900/40 flex flex-col gap-2.5 text-[10px]">
                  {/* Governing Formula */}
                  <div className="bg-neutral-950 p-2 rounded-lg border border-neutral-850 flex items-start gap-2">
                    <FileText size={12} className="text-blue-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-[9px] text-neutral-500 uppercase tracking-wider font-bold block">Engineering Formula & Standard</span>
                      <code className="text-blue-300 font-mono text-[10px] block mt-0.5 break-all">{step.formula}</code>
                    </div>
                  </div>

                  {/* Input Variables Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {step.inputs.map((inp, idx) => (
                      <div key={idx} className="bg-neutral-950/80 p-2 rounded-lg border border-neutral-850">
                        <span className="text-neutral-500 text-[9px] block truncate">{inp.label}</span>
                        <strong className="text-neutral-200 font-mono text-[10px]">
                          {typeof inp.value === 'number' ? inp.value.toLocaleString() : inp.value} {inp.unit || ''}
                        </strong>
                      </div>
                    ))}
                  </div>

                  {/* Criteria & Engineering Notes */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-neutral-950/60 p-2 rounded-lg border border-neutral-850/80">
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck size={12} className="text-emerald-400 shrink-0" />
                      <span className="text-neutral-400">Criterion: <strong className="text-neutral-200 font-mono">{step.criteria}</strong></span>
                    </div>
                    {step.notes && (
                      <span className="text-neutral-400 italic text-[9px] sm:text-right">{step.notes}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
