import React from 'react';
import { useProjectStore, Zone } from '../store/projectStore';
import { ASHRAE_SPACE_TYPES } from '../engine/knowledgeBase';
import { calculateZoneLoad } from '../engine/loadCalc';
import { placeDiffusers } from '../engine/diffuserPlacer';
import { routeDucts } from '../engine/ductRouter';
import { Settings, BarChart4, Wind, Thermometer } from 'lucide-react';

export const ZonePropertiesPanel: React.FC = () => {
  const { selectedZoneId, zones, updateZone, project } = useProjectStore();

  const selectedZone = zones.find((z) => z.id === selectedZoneId);

  if (!selectedZone) {
    return (
      <div className="flex flex-col items-center justify-center bg-neutral-900 border border-neutral-800 p-8 rounded-2xl w-80 text-center backdrop-blur-md">
        <Settings size={28} className="text-neutral-600 animate-pulse" />
        <p className="text-sm font-medium text-neutral-400 mt-3">No Zone Selected</p>
        <p className="text-xs text-neutral-600 mt-1 max-w-[200px]">
          Select or draw a zone to edit mechanical parameters and view live calculations.
        </p>
      </div>
    );
  }

  // Calculate live data
  const loadResult = calculateZoneLoad(selectedZone, project);

  const handleUpdate = (field: keyof Zone, value: any) => {
    // 1. First build the updated zone draft
    const updatedZone: Zone = {
      ...selectedZone,
      [field]: value
    };

    // 2. Recalculate loads
    const newLoads = calculateZoneLoad(updatedZone, project);

    // 3. Auto-place diffusers based on calculated supply CFM
    const spacing = project.units === 'imperial' ? 10 : 3;
    const diffusers = placeDiffusers(
      selectedZone.points,
      newLoads.supplyCfm,
      project.units === 'imperial',
      spacing,
      project.scale
    );

    // 4. Auto-route real stepping trunk-and-branch layout
    const { ducts } = routeDucts(
      selectedZone.points,
      diffusers,
      project.units,
      selectedZone.id
    );

    // 5. Commit all updates to store
    updateZone(selectedZone.id, {
      ...updatedZone,
      diffusers,
      ducts
    });
  };

  const isImperial = project.units === 'imperial';

  return (
    <div className="flex flex-col gap-6 bg-neutral-900 border border-neutral-800 p-5 rounded-2xl w-80 max-h-[85vh] overflow-y-auto backdrop-blur-md shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Settings size={18} className="text-blue-500" />
        <h2 className="text-sm font-bold text-neutral-200 uppercase tracking-wider">Zone Parameters</h2>
      </div>

      {/* Field: Zone Name */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Zone Name</label>
        <input
          type="text"
          value={selectedZone.name}
          onChange={(e) => handleUpdate('name', e.target.value)}
          className="bg-neutral-950 border border-neutral-800 text-neutral-200 text-xs px-3 py-2 rounded-xl focus:border-blue-600 focus:outline-none transition-colors"
        />
      </div>

      {/* Field: Space Type */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Space Type (ASHRAE 62.1)</label>
        <select
          value={selectedZone.spaceTypeId}
          onChange={(e) => handleUpdate('spaceTypeId', e.target.value)}
          className="bg-neutral-950 border border-neutral-800 text-neutral-200 text-xs px-3 py-2 rounded-xl focus:border-blue-600 focus:outline-none transition-colors"
        >
          {ASHRAE_SPACE_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Dimensions & Height */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            Height ({isImperial ? 'ft' : 'm'})
          </label>
          <input
            type="number"
            step="0.5"
            value={selectedZone.ceilingHeight}
            onChange={(e) => handleUpdate('ceilingHeight', parseFloat(e.target.value) || 0)}
            className="bg-neutral-950 border border-neutral-800 text-neutral-200 text-xs px-3 py-2 rounded-xl focus:border-blue-600 focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Occupants</label>
          <input
            type="number"
            value={selectedZone.occupants || ''}
            placeholder={`${loadResult.occupants} (Auto)`}
            onChange={(e) => handleUpdate('occupants', parseInt(e.target.value) || 0)}
            className="bg-neutral-950 border border-neutral-800 text-neutral-200 text-xs px-3 py-2 rounded-xl focus:border-blue-600 focus:outline-none"
          />
        </div>
      </div>

      {/* Manual Overrides */}
      <div className="flex flex-col gap-3 bg-neutral-950 border border-neutral-850 p-3.5 rounded-xl">
        <div className="flex items-center gap-1.5 text-neutral-400 text-[10px] font-bold uppercase tracking-wider">
          <Thermometer size={12} className="text-amber-500" />
          Load & Flow Overrides
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[9px] text-neutral-500">Manual CFM ({isImperial ? 'CFM' : 'L/s'})</label>
          <input
            type="number"
            value={selectedZone.manualCfmOverride || ''}
            placeholder={`${loadResult.supplyCfm} (Calculated)`}
            onChange={(e) => handleUpdate('manualCfmOverride', parseFloat(e.target.value) || undefined)}
            className="bg-neutral-900 border border-neutral-800 text-neutral-200 text-xs px-2.5 py-1.5 rounded-lg"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[9px] text-neutral-500">Manual Load ({isImperial ? 'Btu/h' : 'Watts'})</label>
          <input
            type="number"
            value={selectedZone.manualCoolingOverride || ''}
            placeholder={`${loadResult.totalLoad} (Calculated)`}
            onChange={(e) => handleUpdate('manualCoolingOverride', parseFloat(e.target.value) || undefined)}
            className="bg-neutral-900 border border-neutral-800 text-neutral-200 text-xs px-2.5 py-1.5 rounded-lg"
          />
        </div>
      </div>

      <hr className="border-neutral-800" />

      {/* Live Calculations Summary */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1.5 text-neutral-400 text-[10px] font-bold uppercase tracking-wider">
          <BarChart4 size={14} className="text-blue-500" />
          Live Space Calculations
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-neutral-950/60 p-2.5 rounded-xl border border-neutral-850">
            <span className="text-[10px] text-neutral-500 block">Area</span>
            <span className="text-neutral-200 font-bold font-mono">
              {loadResult.area} {isImperial ? 'ft²' : 'm²'}
            </span>
          </div>

          <div className="bg-neutral-950/60 p-2.5 rounded-xl border border-neutral-850">
            <span className="text-[10px] text-neutral-500 block">Perimeter</span>
            <span className="text-neutral-200 font-bold font-mono">
              {loadResult.perimeter} {isImperial ? 'ft' : 'm'}
            </span>
          </div>
        </div>

        <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-850 flex flex-col gap-2.5 text-xs">
          <div className="flex justify-between">
            <span className="text-neutral-500">Sensible Load:</span>
            <span className="font-semibold text-neutral-300 font-mono">
              {loadResult.sensibleLoad.toLocaleString()} {isImperial ? 'Btu/h' : 'W'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Latent Load:</span>
            <span className="font-semibold text-neutral-300 font-mono">
              {loadResult.latentLoad.toLocaleString()} {isImperial ? 'Btu/h' : 'W'}
            </span>
          </div>
          <div className="flex justify-between border-t border-neutral-800 pt-2 font-semibold">
            <span className="text-neutral-400">Total Load:</span>
            <span className="text-blue-500 font-mono">
              {loadResult.totalLoad.toLocaleString()} {isImperial ? 'Btu/h' : 'W'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Required Capacity:</span>
            <span className="text-amber-500 font-bold font-mono">{loadResult.totalTons} TR (Tons)</span>
          </div>
        </div>

        {/* Airflow Section */}
        <div className="flex items-center gap-1.5 text-neutral-400 text-[10px] font-bold uppercase tracking-wider mt-2">
          <Wind size={14} className="text-teal-500" />
          Flow Rates ({isImperial ? 'CFM' : 'L/s'})
        </div>

        <div className="bg-neutral-950/50 border border-neutral-850 p-3 rounded-xl flex flex-col gap-2 text-xs">
          <div className="flex justify-between">
            <span className="text-neutral-500">Supply Airflow:</span>
            <span className="text-neutral-200 font-bold font-mono">{loadResult.supplyCfm}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Outdoor Air (Fresh):</span>
            <span className="text-neutral-400 font-mono">{loadResult.oaCfm}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Exhaust (Extract):</span>
            <span className="text-neutral-400 font-mono">{loadResult.exhaustCfm}</span>
          </div>
          <div className="flex justify-between border-t border-neutral-850 pt-1.5">
            <span className="text-neutral-500">Return Recirculating:</span>
            <span className="text-teal-500 font-bold font-mono">{loadResult.returnCfm}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
