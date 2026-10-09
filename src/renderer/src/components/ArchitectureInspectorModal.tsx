import React, { useState } from 'react';
import { SystemDesignCandidate } from '../engine/types';
import {
  X,
  Layers,
  Wind,
  Cpu,
  Boxes,
  ShieldCheck,
  Copy,
  Check,
  Sliders,
  Sparkles
} from 'lucide-react';

interface ArchitectureInspectorModalProps {
  candidate: SystemDesignCandidate;
  onClose: () => void;
}

export const ArchitectureInspectorModal: React.FC<ArchitectureInspectorModalProps> = ({ candidate, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const arch = candidate.systemArchitecture;

  if (!arch) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl max-w-md w-full text-center">
          <p className="text-neutral-400 text-xs">No architecture breakdown available for this candidate.</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-neutral-800 text-white rounded-lg text-xs">Close</button>
        </div>
      </div>
    );
  }

  const categoryIcons: Record<string, any> = {
    'primary-equipment': Cpu,
    'air-distribution': Wind,
    terminals: Boxes,
    'hydronics-refrigerant': Layers,
    'controls-electrical': Sliders,
    accessories: ShieldCheck
  };

  const filteredComponents = selectedCategory === 'all'
    ? arch.components
    : arch.components.filter((c) => c.category === selectedCategory);

  const handleCopySchedule = () => {
    const text = arch.components
      .map(
        (c) =>
          `[${c.category.toUpperCase()}] ${c.tag} | ${c.name} | Qty: ${c.quantity} | Spec: ${c.specification} | Conn: ${c.connectionSize || 'N/A'}`
      )
      .join('\n');

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-neutral-900 border border-neutral-800 w-full max-w-5xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-neutral-800 flex justify-between items-start bg-neutral-950/80">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400">
                <Layers size={18} />
              </span>
              <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-wider">
                {arch.systemName}
              </h2>
              <span className="text-[10px] font-mono font-bold bg-blue-600/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full">
                {candidate.quantity} × {candidate.equipment.nominalTons} TR ({candidate.systemType.toUpperCase()})
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-1.5 max-w-3xl leading-relaxed">{arch.summary}</p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800 rounded-lg border border-neutral-800 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          {/* Governing Engineering Codes & Standards */}
          <div className="bg-neutral-950 p-3.5 rounded-xl border border-neutral-850 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-teal-400 shrink-0" />
              <div>
                <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Governing MEP Design Standards</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {arch.governingStandards.map((std, i) => (
                    <span
                      key={i}
                      className="text-[9px] font-medium bg-neutral-900 text-teal-300 border border-teal-500/30 px-2 py-0.5 rounded-md"
                    >
                      {std}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={handleCopySchedule}
              className="flex items-center gap-1.5 text-[10px] font-bold bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 px-3 py-1.5 rounded-lg transition-colors cursor-pointer shrink-0"
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              {copied ? 'Copied Schedule' : 'Copy Schedule Table'}
            </button>
          </div>

          {/* Schematic Flow Visualization Card */}
          <div className="bg-neutral-950/80 border border-neutral-850 p-4 rounded-xl flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles size={12} className="text-amber-500" />
                Physical Subsystem Flow Architecture
              </span>
              <span className="text-[9px] text-neutral-500 font-mono">Loop: Primary $\rightarrow$ Distribution $\rightarrow$ Terminals $\rightarrow$ Return</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {/* Box 1: Outdoor / Chiller */}
              <div className="bg-neutral-900/70 border border-neutral-800 p-3 rounded-xl flex flex-col justify-between">
                <div>
                  <span className="text-[9px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1">
                    <Cpu size={12} /> Outdoor Heat Rejection
                  </span>
                  <strong className="text-neutral-200 block text-[11px] mt-1">{candidate.equipment.model}-ODU</strong>
                  <p className="text-[10px] text-neutral-400 mt-1">
                    Inverter heat pump condensing unit rated at {candidate.equipment.totalCapacityBtuPerHour.toLocaleString()} Btu/h with variable-speed compressor.
                  </p>
                </div>
                <div className="mt-2 pt-2 border-t border-neutral-850 text-[9px] font-mono text-neutral-500">
                  Ref Lines: {candidate.equipment.connectionSizes.liquidLine || '3/8"'} / {candidate.equipment.connectionSizes.gasLine || '5/8"'}
                </div>
              </div>

              {/* Box 2: Indoor Unit / AHU */}
              <div className="bg-neutral-900/70 border border-neutral-800 p-3 rounded-xl flex flex-col justify-between">
                <div>
                  <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                    <Wind size={12} /> Thermal Coil & Blower
                  </span>
                  <strong className="text-neutral-200 block text-[11px] mt-1">{candidate.equipment.model}</strong>
                  <p className="text-[10px] text-neutral-400 mt-1">
                    Delivers {candidate.quantity * candidate.equipment.nominalCfm} CFM at {candidate.equipment.maxRatedEspInWg.toFixed(2)} in.wg available static pressure.
                  </p>
                </div>
                <div className="mt-2 pt-2 border-t border-neutral-850 text-[9px] font-mono text-neutral-500">
                  Sound: {candidate.equipment.soundDba} dBA
                </div>
              </div>

              {/* Box 3: Ductwork / Plenums */}
              <div className="bg-neutral-900/70 border border-neutral-800 p-3 rounded-xl flex flex-col justify-between">
                <div>
                  <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                    <Layers size={12} /> Air Distribution Ductwork
                  </span>
                  <strong className="text-neutral-200 block text-[11px] mt-1">
                    {candidate.ductwork ? 'Equal Friction Galvanized Trunk' : 'Direct Coanda Discharge'}
                  </strong>
                  <p className="text-[10px] text-neutral-400 mt-1">
                    {candidate.ductwork
                      ? `Max Velocity: ${candidate.ductwork.maxVelocityFpm} FPM, Critical Loss: ${candidate.ductwork.criticalPath.espRequiredInWg.toFixed(3)} in.wg`
                      : 'Zero external duct friction with 4-way direct air louvers.'}
                  </p>
                </div>
                <div className="mt-2 pt-2 border-t border-neutral-850 text-[9px] font-mono text-neutral-500">
                  Material: {candidate.ductwork?.ductType.name || 'Flush Ceiling Fascia'}
                </div>
              </div>

              {/* Box 4: Terminals & Controls */}
              <div className="bg-neutral-900/70 border border-neutral-800 p-3 rounded-xl flex flex-col justify-between">
                <div>
                  <span className="text-[9px] font-bold text-teal-400 uppercase tracking-wider flex items-center gap-1">
                    <Boxes size={12} /> Terminals & Zone Control
                  </span>
                  <strong className="text-neutral-200 block text-[11px] mt-1">
                    {candidate.diffusers.quantity} × {candidate.diffusers.diffuserRecord.model}
                  </strong>
                  <p className="text-[10px] text-neutral-400 mt-1">
                    Acoustic NC {candidate.diffusers.actualNc} with {candidate.diffusers.throwT50Ft} ft throw reaching perimeter zones.
                  </p>
                </div>
                <div className="mt-2 pt-2 border-t border-neutral-850 text-[9px] font-mono text-neutral-500">
                  Control: 7-Day Digital Thermostat
                </div>
              </div>
            </div>
          </div>

          {/* Subsystem Filter Pills */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mr-1">Filter Components:</span>
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200'
              }`}
            >
              All Components ({arch.components.length})
            </button>
            {['primary-equipment', 'air-distribution', 'terminals', 'hydronics-refrigerant', 'controls-electrical'].map((cat) => {
              const count = arch.components.filter((c) => c.category === cat).length;
              if (count === 0) return null;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 rounded-lg text-[10px] font-bold border capitalize transition-colors cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {cat.replace('-', ' ')} ({count})
                </button>
              );
            })}
          </div>

          {/* Itemized Bill of Components Table */}
          <div className="overflow-x-auto border border-neutral-850 rounded-xl bg-neutral-950">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-neutral-900/80 border-b border-neutral-800 text-[10px] text-neutral-400 uppercase tracking-wider font-semibold">
                  <th className="p-3">Tag</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Component & Model</th>
                  <th className="p-3 text-center">Qty</th>
                  <th className="p-3">Engineering Specification</th>
                  <th className="p-3">Connections</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900 text-[11px]">
                {filteredComponents.map((item) => {
                  const Icon = categoryIcons[item.category] || Layers;

                  return (
                    <tr key={item.id} className="hover:bg-neutral-900/40 transition-colors">
                      <td className="p-3 font-mono font-bold text-teal-400">{item.tag}</td>
                      <td className="p-3 text-neutral-400 capitalize text-[10px]">
                        <span className="flex items-center gap-1.5">
                          <Icon size={12} className="text-neutral-500" />
                          {item.category.replace('-', ' ')}
                        </span>
                      </td>
                      <td className="p-3">
                        <strong className="text-neutral-200 block">{item.name}</strong>
                        <span className="text-[10px] text-neutral-500 font-mono">{item.modelOrType}</span>
                      </td>
                      <td className="p-3 text-center font-mono font-bold text-neutral-200">{item.quantity}</td>
                      <td className="p-3 text-neutral-300">
                        <span>{item.specification}</span>
                        {item.details && (
                          <p className="text-[9px] text-neutral-500 mt-0.5 italic">{item.details}</p>
                        )}
                      </td>
                      <td className="p-3 font-mono text-[10px] text-neutral-400">{item.connectionSize || '—'}</td>
                      <td className="p-3">
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {item.status.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-950 flex justify-between items-center">
          <span className="text-[10px] text-neutral-500">
            Preliminary estimate using simplified methods referenced to ASHRAE Fundamentals and SMACNA; not a compliance check
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-all shadow-md cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
