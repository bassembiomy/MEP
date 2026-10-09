import React from 'react';
import { useProjectStore, Zone } from '../store/projectStore';
import { ASHRAE_SPACE_TYPES } from '../engine/knowledgeBase';
import { calculateCanonicalZoneLoad, calculateZoneLoadSafely } from '../engine/loadCalc';
import { calculateZoneDiffuserCoverage } from '../engine/diffuserPlacer';
import { generateSystemCandidates } from '../engine/systemDesigner';
import { zoneExtentFt } from '../engine/pressureBudget';
import { STANDARD_DUCT_TYPES } from '../engine/hvacCatalogs';
import {
  DEFAULT_SPACE_NC_TARGETS,
  calculateAllowableAcousticVelocity,
  verifyDuctSectionAcoustics
} from '../engine/acousticDuctEngine';
import {
  Settings,
  BarChart4,
  Thermometer,
  Lock,
  Unlock,
  Shield,
  Volume2,
  CheckCircle2,
  AlertTriangle,
  Compass,
  CircleDot
} from 'lucide-react';
import { DuctLocationCategory } from '../engine/types';

export const ZonePropertiesPanel: React.FC = () => {
  const { selectedZoneId, zones, updateZone, applyCandidateTransaction, optimizationWeights, project, loadedCatalogs } = useProjectStore();

  const [designFeedback, setDesignFeedback] = React.useState('');
  const selectedZone = zones.find((z) => z.id === selectedZoneId);
  const isImperial = project.units === 'imperial';

  const loadEvaluation = React.useMemo(() => {
    if (!selectedZone) return { load: null };
    return calculateZoneLoadSafely(selectedZone, project);
  }, [selectedZone, project]);
  const loadResult = loadEvaluation.load;

  const zoneCoverage = React.useMemo(() => {
    if (!selectedZone || selectedZone.diffusers.length === 0 || selectedZone.systemType === 'high-wall') {
      return { coverageRatio: 0, coveragePercent: 0, isCovered95: false };
    }
    return calculateZoneDiffuserCoverage(
      selectedZone.points,
      selectedZone.diffusers,
      project.scale,
      isImperial
    );
  }, [selectedZone?.points, selectedZone?.diffusers, project.scale, isImperial, selectedZone?.systemType]);

  if (!selectedZone || !loadResult) {
    return (
      <div className="flex flex-col items-center justify-center bg-neutral-900 border border-neutral-800 p-8 rounded-2xl w-full text-center backdrop-blur-md shadow-lg">
        <Settings size={28} className="text-neutral-600 animate-pulse" />
        <p className="text-sm font-medium text-neutral-400 mt-3">{selectedZone ? 'Engineering inputs require correction' : 'No Zone Selected'}</p>
        <p className="text-xs text-neutral-600 mt-1 max-w-[200px]">
          {loadEvaluation.error ?? 'Select or draw a zone to edit mechanical parameters, component locks, and view live calculations.'}
        </p>
        {selectedZone && <div className="flex flex-col gap-2 mt-3 text-xs">
          <label>Ceiling height ({project.units === 'metric' ? 'm' : 'ft'})
            <input aria-label="Correct ceiling height" type="number" min="0.01" step="0.01" value={selectedZone.ceilingHeight}
              onChange={e => updateZone(selectedZone.id, { ceilingHeight: e.currentTarget.valueAsNumber })} className="ml-2 bg-neutral-800 p-1" />
          </label>
          <label>Occupants
            <input aria-label="Correct occupant count" type="number" min="0" value={selectedZone.occupants}
              onChange={e => updateZone(selectedZone.id, { occupants: e.currentTarget.valueAsNumber })} className="ml-2 bg-neutral-800 p-1" />
          </label>
          <button onClick={() => updateZone(selectedZone.id, { manualCfmOverride: undefined, manualCoolingOverride: undefined,
            lightingOverride: undefined, equipmentOverride: undefined })} className="rounded border border-neutral-600 p-2">Clear load and airflow overrides</button>
        </div>}
      </div>
    );
  }

  const isDucted =
    selectedZone.systemType === 'concealed' ||
    selectedZone.systemType === 'packaged' ||
    selectedZone.systemType === 'ahu' ||
    selectedZone.systemType === 'vrf';

  const defaultSpaceTarget = DEFAULT_SPACE_NC_TARGETS[selectedZone.spaceTypeId] || {
    nc: 32,
    name: 'General Space',
    sensitivity: 'standard'
  };
  const currentTargetNc = selectedZone.targetNc ?? defaultSpaceTarget.nc;
  const currentLocCategory: DuctLocationCategory =
    selectedZone.ductLocationCategory || 'above-suspended-ceiling';
  const isEnhanced = selectedZone.enhancedAcousticPerformance || false;

  // Compute live acoustic verification summary across zone ducts
  const ductVerifications = selectedZone.ducts.map((d) =>
    d.acousticVerification ||
    verifyDuctSectionAcoustics(d, {
      zoneName: selectedZone.name,
      targetNc: currentTargetNc,
      locationCategory: currentLocCategory,
      enhancedPerformance: isEnhanced
    })
  );

  const hasAcousticFailure = ductVerifications.some((v) => v.complianceStatus === 'REQUIRES REDESIGN');
  const maxActualVelocity = ductVerifications.length > 0
    ? Math.max(...ductVerifications.map((v) => v.actualVelocityFpm))
    : 0;
  const mainAllowableVelocity = calculateAllowableAcousticVelocity(
    currentLocCategory,
    currentTargetNc,
    'rectangular',
    'trunk',
    isEnhanced
  );

  const handleOptimizePlacement = () => {
    try {
      const load=calculateCanonicalZoneLoad(selectedZone,project);
      const recommendations=generateSystemCandidates(load.totalLoad,load.sensibleLoad,load.supplyCfm,
        selectedZone.spaceTypeId,load.area,true,optimizationWeights,[selectedZone.systemType??'concealed'],loadedCatalogs,[],[],zoneExtentFt(selectedZone.points,project));
      if(!recommendations.bestOverall) { setDesignFeedback('No feasible catalog candidate. Review the inputs in Optimizer Studio.'); return; }
      const result=applyCandidateTransaction(recommendations.bestOverall);
      setDesignFeedback(result.success ? 'Validated preliminary CAD design applied.' : result.error??'Design is blocked.');
    } catch(error) { setDesignFeedback(error instanceof Error ? error.message : String(error)); }
  };

  const handleUpdate = (field: keyof Zone, value: any) => {
    const changes: Partial<Zone> = { [field]: value };
    if (field === 'spaceTypeId') {
      const defaults=DEFAULT_SPACE_NC_TARGETS[value as string];
      if(defaults) { changes.targetNc=defaults.nc; changes.maxSpaceNcLimit=defaults.nc; }
    }
    updateZone(selectedZone.id,changes);
    setDesignFeedback('Inputs changed. Revalidate and apply a candidate in Optimizer Studio.');
  };

  return (
    <div className="flex flex-col gap-5 bg-neutral-900 border border-neutral-800 p-5 rounded-2xl w-full max-h-[85vh] overflow-y-auto backdrop-blur-md shadow-2xl">
      <p className="text-xs text-amber-300">{designFeedback || 'Preliminary design. Input changes require revalidation before CAD application.'}</p>
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

      {/* Acoustic Criteria & Duct Location Section */}
      <div className="bg-neutral-950 border border-neutral-850 p-3.5 rounded-xl flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
            <Volume2 size={13} className="text-purple-400" />
            Acoustic & Noise Criteria
          </span>
          <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-purple-950/40 border border-purple-800/40 text-purple-300 font-bold">
            Target NC {currentTargetNc}
          </span>
        </div>

        {/* Duct Location Category */}
        <div className="flex flex-col gap-1">
          <label className="text-[9px] text-neutral-500 font-medium">Duct Location Relative to Space</label>
          <select
            value={currentLocCategory}
            onChange={(e) => handleUpdate('ductLocationCategory', e.target.value as DuctLocationCategory)}
            className="bg-neutral-900 border border-neutral-800 text-neutral-300 text-xs px-2.5 py-1.5 rounded-lg focus:border-purple-500 focus:outline-none"
          >
            <option value="above-suspended-ceiling">Above Suspended Acoustic Ceiling</option>
            <option value="in-shaft-solid-ceiling">In Shaft / Above Solid Ceiling</option>
            <option value="within-occupied-space">Within Occupied Space (Exposed)</option>
          </select>
        </div>

        {/* NC Target Input & Presets */}
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between items-center text-[9px] text-neutral-500">
            <span>Design Room NC Target</span>
            <span className="font-mono text-neutral-400">Limit: {mainAllowableVelocity} FPM (Main)</span>
          </div>
          <div className="flex gap-1.5 items-center">
            <input
              type="number"
              min="20"
              max="55"
              step="1"
              value={currentTargetNc}
              onChange={(e) => handleUpdate('targetNc', parseInt(e.target.value) || 32)}
              className="w-16 bg-neutral-900 border border-neutral-800 text-neutral-200 text-xs px-2.5 py-1 rounded-lg font-mono text-center"
            />
            <div className="grid grid-cols-4 gap-1 flex-1 text-[9px]">
              {[25, 28, 32, 35].map((ncVal) => (
                <button
                  key={ncVal}
                  type="button"
                  onClick={() => handleUpdate('targetNc', ncVal)}
                  className={`py-1 rounded border text-center transition-all ${
                    currentTargetNc === ncVal
                      ? 'bg-purple-600/30 border-purple-500/60 text-purple-200 font-bold'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                  }`}
                >
                  NC{ncVal}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Enhanced Acoustic Sensitivity Toggle */}
        <label className="flex items-center justify-between text-[10px] text-neutral-400 cursor-pointer pt-1 border-t border-neutral-850">
          <span>Enhanced Acoustic Performance (-3 NC Margin)</span>
          <input
            type="checkbox"
            checked={isEnhanced}
            onChange={(e) => handleUpdate('enhancedAcousticPerformance', e.target.checked)}
            className="rounded border-neutral-800 bg-neutral-900 text-purple-600 focus:ring-0 cursor-pointer"
          />
        </label>

        {/* Live Acoustic Compliance Status Badge */}
        {isDucted && selectedZone.ducts.length > 0 && (
          <div
            className={`p-2.5 rounded-lg border flex items-center justify-between text-[10px] ${
              !hasAcousticFailure
                ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300'
                : 'bg-red-950/40 border-red-800/60 text-red-300'
            }`}
          >
            <div className="flex items-center gap-1.5">
              {!hasAcousticFailure ? (
                <CheckCircle2 size={13} className="text-emerald-400" />
              ) : (
                <AlertTriangle size={13} className="text-red-400" />
              )}
              <span className="font-bold">
                {!hasAcousticFailure ? 'PASS (Acoustically Compliant)' : 'REQUIRES REDESIGN'}
              </span>
            </div>
            <span className="font-mono text-[9px] opacity-80">
              Max {maxActualVelocity} FPM
            </span>
          </div>
        )}
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

      {/* 4. Circular Coverage & Air Distribution Control */}
      {selectedZone.systemType !== 'high-wall' && (
        <div className="flex flex-col gap-3 bg-neutral-950 border border-neutral-850 p-3.5 rounded-2xl">
          <div className="flex items-center justify-between text-neutral-300 text-xs font-bold">
            <span className="flex items-center gap-1.5 text-teal-400">
              <Compass size={15} />
              Circular Coverage Distribution
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
              zoneCoverage.coveragePercent >= 99
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : zoneCoverage.isCovered95
                ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
            }`}>
              {zoneCoverage.coveragePercent}% {zoneCoverage.coveragePercent >= 99 ? 'estimated coverage' : 'Covered'}
            </span>
          </div>

          {/* Distribution Pattern Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Distribution Pattern</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleUpdate('distributionPattern','hexagonal')}
                className={`py-2 px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  (selectedZone.distributionPattern || 'hexagonal') === 'hexagonal'
                    ? 'bg-teal-500/20 border-teal-400 text-teal-300 shadow-sm font-bold'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                }`}
              >
                <span>⬡</span> Hexagonal Honeycomb
              </button>

              <button
                type="button"
                onClick={() => handleUpdate('distributionPattern','orthogonal')}
                className={`py-2 px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  selectedZone.distributionPattern === 'orthogonal'
                    ? 'bg-teal-500/20 border-teal-400 text-teal-300 shadow-sm font-bold'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-850'
                }`}
              >
                <span>▦</span> Orthogonal Grid
              </button>
            </div>
          </div>

          {/* Target Coverage Goal Slider */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center text-[10px]">
              <span className="font-bold uppercase tracking-wider text-neutral-500">Target Coverage Goal</span>
              <span className="font-mono font-bold text-amber-400">
                {selectedZone.coverageTargetPercent || 100}%
              </span>
            </div>
            <input
              type="range"
              min="85"
              max="100"
              step="1"
              value={selectedZone.coverageTargetPercent || 100}
              onChange={(e) => handleUpdate('coverageTargetPercent', e.currentTarget.valueAsNumber)}
              className="w-full accent-teal-500 bg-neutral-900 h-1.5 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-[9px] text-neutral-500 font-mono">
              <span>85% Basic</span>
              <span>95% target</span>
              <span className="text-teal-400 font-bold">100% Full Blanket</span>
            </div>
          </div>

          {/* Quick Action: Redistribute & Maximize Circular Coverage */}
          <button
            type="button"
            onClick={() => handleUpdate('coverageTargetPercent',100)}
            className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-teal-600/30 to-blue-600/30 hover:from-teal-600/40 hover:to-blue-600/40 border border-teal-500/40 text-teal-200 text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md active:scale-98"
          >
            <CircleDot size={14} className="text-teal-400" />
            Set 100% estimated coverage target
          </button>
        </div>
      )}

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
            <span className="font-semibold text-neutral-300 font-mono">{loadResult.thermalCfm} {isImperial ? 'CFM' : 'L/s'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">ASHRAE 62.1 Fresh Air:</span>
            <span className="font-semibold text-teal-400 font-mono">{loadResult.vozCfm} {isImperial ? 'CFM' : 'L/s'}</span>
          </div>
          <div className="flex justify-between border-t border-neutral-800 pt-1.5 font-bold">
            <span className="text-neutral-400">Total Design Flow:</span>
            <span className="text-emerald-400 font-mono">{loadResult.supplyCfm} {isImperial ? 'CFM' : 'L/s'}</span>
          </div>

          {selectedZone.diffusers.length > 0 && selectedZone.systemType !== 'high-wall' && (
            <div className="flex items-center justify-between border-t border-neutral-800 pt-1.5 text-[11px]">
              <span className="text-neutral-400">Circular Distribution Coverage:</span>
              <span className={`font-mono font-bold ${zoneCoverage.coveragePercent >= 99 ? 'text-emerald-400' : zoneCoverage.isCovered95 ? 'text-teal-400' : 'text-amber-400'}`}>
                {zoneCoverage.coveragePercent}% {zoneCoverage.coveragePercent >= 99 ? '(100% Full Blanket)' : zoneCoverage.isCovered95 ? '(≥95% Pass)' : '(Partial)'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
