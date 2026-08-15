import React from 'react';
import { useProjectStore, Zone, DuctSegment } from '../store/projectStore';
import { ASHRAE_SPACE_TYPES } from '../engine/knowledgeBase';
import { calculateZoneLoad } from '../engine/loadCalc';
import { placeDiffusers } from '../engine/diffuserPlacer';
import { routeDucts } from '../engine/ductRouter';
import { calculateOptimalOutdoorUnitPos, calculateOptimalIndoorUnitPos } from '../engine/geometry';
import { getCatalogSizingForZone } from '../engine/systemDesigner';
import { STANDARD_DUCT_TYPES } from '../engine/hvacCatalogs';
import { Settings, BarChart4, Thermometer, Lock, Unlock, Shield } from 'lucide-react';

export const ZonePropertiesPanel: React.FC = () => {
  const { selectedZoneId, zones, updateZone, project, dxfEntities, loadedCatalogs } = useProjectStore();

  const selectedZone = zones.find((z) => z.id === selectedZoneId);

  if (!selectedZone) {
    return (
      <div className="flex flex-col items-center justify-center bg-neutral-900 border border-neutral-800 p-8 rounded-2xl w-80 text-center backdrop-blur-md">
        <Settings size={28} className="text-neutral-600 animate-pulse" />
        <p className="text-sm font-medium text-neutral-400 mt-3">No Zone Selected</p>
        <p className="text-xs text-neutral-600 mt-1 max-w-[200px]">
          Select or draw a zone to edit mechanical parameters, component locks, and view live calculations.
        </p>
      </div>
    );
  }

  const isImperial = project.units === 'imperial';
  const loadResult = calculateZoneLoad(selectedZone, project);

  const isDucted = selectedZone.systemType === 'concealed' || selectedZone.systemType === 'packaged' || selectedZone.systemType === 'ahu' || selectedZone.systemType === 'vrf';

  const handleOptimizePlacement = () => {
    const optOdu = calculateOptimalOutdoorUnitPos(selectedZone.points, zones, dxfEntities);
    
    const sizing = getCatalogSizingForZone(
      selectedZone.systemType,
      loadResult.totalLoad,
      loadResult.supplyCfm,
      loadedCatalogs
    );

    const optIu = selectedZone.systemType === 'cassette'
      ? undefined
      : calculateOptimalIndoorUnitPos(selectedZone.points, optOdu);
    const spacing = isImperial ? 10 : 3;

    let diffusers: any[] = [];
    if (selectedZone.systemType === 'high-wall') {
      diffusers = [];
    } else if (selectedZone.systemType === 'cassette') {
      diffusers = !selectedZone.isDiffusersLocked
        ? placeDiffusers(
            selectedZone.points,
            loadResult.supplyCfm,
            isImperial,
            spacing,
            project.scale,
            dxfEntities,
            'cassette',
            loadResult.totalLoad,
            sizing.qty,
            sizing.model,
            selectedZone.maxSpaceNcLimit || 32
          )
        : selectedZone.diffusers;
    } else if (isDucted && !selectedZone.isDiffusersLocked) {
      diffusers = placeDiffusers(
        selectedZone.points,
        loadResult.supplyCfm,
        isImperial,
        spacing,
        project.scale,
        dxfEntities,
        selectedZone.systemType || 'concealed',
        loadResult.totalLoad,
        sizing.qty,
        sizing.model,
        selectedZone.maxSpaceNcLimit || 32
      );
    } else {
      diffusers = selectedZone.diffusers;
    }

    let finalDucts: DuctSegment[] = [];
    if (isDucted && optIu && !selectedZone.isDuctLocked) {
      const routed = routeDucts(
        selectedZone.points,
        diffusers,
        project.units,
        selectedZone.id,
        optIu,
        selectedZone.systemType || 'concealed',
        optOdu
      );
      finalDucts = routed.ducts;
    } else {
      finalDucts = isDucted ? selectedZone.ducts : [];
    }

    updateZone(selectedZone.id, {
      unitPos: optIu,
      outdoorUnitPos: optOdu,
      diffusers,
      ducts: finalDucts,
      catalogQty: sizing.qty,
      catalogModel: sizing.model,
      catalogEsp: sizing.esp
    });
  };

  const handleUpdate = (field: keyof Zone, value: any) => {
    const updatedZone: Zone = {
      ...selectedZone,
      [field]: value
    };

    const newLoads = calculateZoneLoad(updatedZone, project);
    const sizing = getCatalogSizingForZone(
      updatedZone.systemType,
      newLoads.totalLoad,
      newLoads.supplyCfm,
      loadedCatalogs
    );

    const isSystemDucted = updatedZone.systemType === 'concealed' || updatedZone.systemType === 'packaged' || updatedZone.systemType === 'ahu' || updatedZone.systemType === 'vrf';

    let finalOutdoorUnitPos = updatedZone.outdoorUnitPos;
    if (!finalOutdoorUnitPos) {
      finalOutdoorUnitPos = calculateOptimalOutdoorUnitPos(selectedZone.points, zones, dxfEntities);
    }

    const spacing = isImperial ? 10 : 3;
    let diffusers: any[] = [];
    if (updatedZone.systemType === 'high-wall') {
      diffusers = [];
    } else if (updatedZone.systemType === 'cassette') {
      diffusers = !updatedZone.isDiffusersLocked
        ? placeDiffusers(
            selectedZone.points,
            newLoads.supplyCfm,
            isImperial,
            spacing,
            project.scale,
            dxfEntities,
            'cassette',
            newLoads.totalLoad,
            sizing.qty,
            sizing.model,
            updatedZone.maxSpaceNcLimit || 32
          )
        : updatedZone.diffusers;
    } else if (isSystemDucted && !updatedZone.isDiffusersLocked) {
      diffusers = placeDiffusers(
        selectedZone.points,
        newLoads.supplyCfm,
        isImperial,
        spacing,
        project.scale,
        dxfEntities,
        updatedZone.systemType || 'concealed',
        newLoads.totalLoad,
        sizing.qty,
        sizing.model,
        updatedZone.maxSpaceNcLimit || 32
      );
    } else {
      diffusers = updatedZone.diffusers;
    }

    let finalDucts: DuctSegment[] = [];
    let finalUnitPos = updatedZone.unitPos;

    if (isSystemDucted) {
      if (!finalUnitPos) {
        finalUnitPos = calculateOptimalIndoorUnitPos(selectedZone.points, finalOutdoorUnitPos);
      }
      if (!updatedZone.isDuctLocked) {
        const routed = routeDucts(
          selectedZone.points,
          diffusers,
          project.units,
          selectedZone.id,
          finalUnitPos,
          updatedZone.systemType || 'concealed',
          finalOutdoorUnitPos
        );
        finalDucts = routed.ducts;
        finalUnitPos = routed.unitPos;
      } else {
        finalDucts = updatedZone.ducts;
      }
    } else if (updatedZone.systemType === 'high-wall') {
      finalDucts = [];
      finalUnitPos = calculateOptimalIndoorUnitPos(selectedZone.points, finalOutdoorUnitPos);
    } else {
      finalDucts = [];
      finalUnitPos = undefined;
    }

    updateZone(selectedZone.id, {
      ...updatedZone,
      diffusers,
      ducts: finalDucts,
      unitPos: finalUnitPos,
      outdoorUnitPos: finalOutdoorUnitPos,
      catalogQty: sizing.qty,
      catalogModel: sizing.model,
      catalogEsp: sizing.esp
    });
  };

  return (
    <div className="flex flex-col gap-5 bg-neutral-900 border border-neutral-800 p-5 rounded-2xl w-80 max-h-[85vh] overflow-y-auto backdrop-blur-md shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-neutral-800 pb-3">
        <div className="flex items-center gap-2">
          <Settings size={18} className="text-blue-500" />
          <h2 className="text-sm font-bold text-neutral-200 uppercase tracking-wider">Zone Parameters</h2>
        </div>
        <button
          onClick={handleOptimizePlacement}
          title="Optimize placement of ODU, indoor units, and ducts"
          className="bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/20 px-2 py-1 rounded-lg text-[9px] font-bold uppercase transition-all cursor-pointer"
        >
          Auto-Layout
        </button>
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

      {/* Field: HVAC System Type */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">HVAC Architecture</label>
        <select
          value={selectedZone.systemType || 'concealed'}
          onChange={(e) => handleUpdate('systemType', e.target.value)}
          className="bg-neutral-950 border border-neutral-800 text-blue-400 font-semibold text-xs px-3 py-2 rounded-xl focus:border-blue-600 focus:outline-none transition-colors"
        >
          <option value="concealed">Concealed Ducted Split (Ducted)</option>
          <option value="high-wall">High Wall DX Split (Unducted Direct)</option>
          <option value="cassette">Cassette 4-Way Split (Unducted Direct)</option>
          <option value="packaged">Packaged Rooftop Unit (Ducted RTU)</option>
          <option value="vrf">VRF System (Multi-Zone)</option>
          <option value="ahu">Central AHU / Chilled Water</option>
        </select>

        {/* System Capability Tag */}
        <div className="text-[9px] px-2.5 py-1 rounded bg-neutral-950/60 border border-neutral-850 text-neutral-400 flex items-center gap-1 mt-0.5">
          <Shield size={10} className="text-blue-500" />
          <span>{isDucted ? 'Ductwork & External ESP Supported' : 'Direct Air Distribution (No Ducts)'}</span>
        </div>
      </div>

      {/* Duct Material Selector (for ducted systems) */}
      {isDucted && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Duct Material & Shape</label>
          <select
            value={selectedZone.ductTypeId || 'duct-rect-galv'}
            onChange={(e) => handleUpdate('ductTypeId', e.target.value)}
            className="bg-neutral-950 border border-neutral-800 text-neutral-300 text-xs px-3 py-1.5 rounded-xl focus:border-blue-600 focus:outline-none"
          >
            {STANDARD_DUCT_TYPES.map((dt) => (
              <option key={dt.id} value={dt.id}>
                {dt.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Component Lock Controls */}
      <div className="bg-neutral-950 border border-neutral-850 p-3 rounded-xl flex flex-col gap-2">
        <span className="text-[9px] font-bold uppercase tracking-wider text-neutral-500">Design Locks (Hard Constraints)</span>
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          <button
            onClick={() => handleUpdate('isEquipmentLocked', !selectedZone.isEquipmentLocked)}
            className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border transition-all ${
              selectedZone.isEquipmentLocked
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-300 font-bold'
                : 'bg-neutral-900 border-neutral-800 text-neutral-500'
            }`}
          >
            {selectedZone.isEquipmentLocked ? <Lock size={10} /> : <Unlock size={10} />}
            Equip
          </button>
          <button
            onClick={() => handleUpdate('isDuctLocked', !selectedZone.isDuctLocked)}
            className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border transition-all ${
              selectedZone.isDuctLocked
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-300 font-bold'
                : 'bg-neutral-900 border-neutral-800 text-neutral-500'
            }`}
          >
            {selectedZone.isDuctLocked ? <Lock size={10} /> : <Unlock size={10} />}
            Ducts
          </button>
          <button
            onClick={() => handleUpdate('isDiffusersLocked', !selectedZone.isDiffusersLocked)}
            className={`flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border transition-all ${
              selectedZone.isDiffusersLocked
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-300 font-bold'
                : 'bg-neutral-900 border-neutral-800 text-neutral-500'
            }`}
          >
            {selectedZone.isDiffusersLocked ? <Lock size={10} /> : <Unlock size={10} />}
            Diffusers
          </button>
        </div>
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
      <div className="flex flex-col gap-2.5 bg-neutral-950 border border-neutral-850 p-3 rounded-xl">
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
        <div className="flex items-center justify-between text-neutral-400 text-[10px] font-bold uppercase tracking-wider">
          <span className="flex items-center gap-1.5">
            <BarChart4 size={14} className="text-blue-500" />
            Live Space Sizing
          </span>
          <span className="text-amber-400 font-mono font-bold">{loadResult.totalTons} TR</span>
        </div>

        <div className="bg-neutral-950 p-3 rounded-xl border border-neutral-850 flex flex-col gap-2 text-xs">
          <div className="flex justify-between">
            <span className="text-neutral-500">Sensible Heat Ratio (SHR):</span>
            <span className="font-semibold text-neutral-300 font-mono">{loadResult.sensibleHeatRatio}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Thermal Supply Flow:</span>
            <span className="font-semibold text-neutral-300 font-mono">{loadResult.thermalCfm} CFM</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">ASHRAE 62.1 Fresh Air:</span>
            <span className="font-semibold text-teal-400 font-mono">{loadResult.vozCfm} CFM</span>
          </div>
          <div className="flex justify-between border-t border-neutral-800 pt-1.5 font-bold">
            <span className="text-neutral-400">Total Design Flow:</span>
            <span className="text-emerald-400 font-mono">{loadResult.supplyCfm} CFM</span>
          </div>
        </div>
      </div>
    </div>
  );
};
