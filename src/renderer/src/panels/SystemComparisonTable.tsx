import React from 'react';
import { useProjectStore } from '../store/projectStore';
import { calculateZoneLoad } from '../engine/loadCalc';
import { generateSystemCandidates } from '../engine/systemDesigner';
import { deliveredCfmFor } from '../engine/systemArchitecture/equipmentSelector';
import { toBtuh, toCfm } from '../engine/units';
import { formatAirflow, formatLoad, formatPressure } from '../format/units';
import { Award, DollarSign, Zap, Database, Upload, CheckCircle2, Sliders } from 'lucide-react';

export const SystemComparisonTable: React.FC = () => {
  const {
    selectedZoneId,
    zones,
    project,
    loadedCatalogs,
    setLoadedCatalogs,
    selectedSystemTypes,
    setSelectedSystemTypes,
    optimizationWeights
  } = useProjectStore();

  const selectedZone = zones.find((z) => z.id === selectedZoneId);

  // Auto-load default catalogs on mount if not already loaded
  React.useEffect(() => {
    if (!loadedCatalogs) {
      window.api.loadDefaultCatalogs()
        .then((result) => {
          if (result && (result.decorative || result.ducted)) {
            setLoadedCatalogs(result);
          }
        })
        .catch((err) => {
          console.error('Failed to load default catalogs on startup:', err);
        });
    }
  }, [loadedCatalogs, setLoadedCatalogs]);

  // Handle custom catalog loading
  const handleLoadCustom = async (type: 'decorative' | 'ducted'): Promise<void> => {
    try {
      const result = await window.api.selectCustomCatalog(type);
      if (result) {
        if (result.error) {
          alert(`Error loading catalog: ${result.error}`);
          return;
        }

        const currentDecorative = loadedCatalogs?.decorative || null;
        const currentDucted = loadedCatalogs?.ducted || null;

        if (type === 'decorative') {
          setLoadedCatalogs({
            decorative: result.data as CatalogDecorativeSet,
            ducted: currentDucted
          });
        } else {
          setLoadedCatalogs({
            decorative: currentDecorative,
            ducted: result.data as CatalogDuctedUnit[]
          });
        }
      }
    } catch (err: unknown) {
      alert(`Failed to load custom catalog: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // If no zone is selected, summarize the main zones load
  const totalArea = zones.reduce((sum, z) => {
    const load = calculateZoneLoad(z, project);
    return sum + load.area;
  }, 0);

  const totalLoad = zones.reduce((sum, z) => {
    const load = calculateZoneLoad(z, project);
    return sum + load.totalLoad;
  }, 0);

  const totalCfm = zones.reduce((sum, z) => {
    const load = calculateZoneLoad(z, project);
    return sum + load.supplyCfm;
  }, 0);

  if (zones.length === 0) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-2xl text-center text-neutral-500 text-xs shadow-xl">
        <Sliders size={24} className="text-neutral-700 mx-auto mb-3 animate-pulse" />
        Draw a zone on the floor plan to compare suitable HVAC systems.
      </div>
    );
  }

  const isImperial = project.units === 'imperial';
  const displayArea = selectedZone ? calculateZoneLoad(selectedZone, project).area : totalArea;
  const displayLoad = selectedZone ? calculateZoneLoad(selectedZone, project).totalLoad : totalLoad;
  const displayCfm = selectedZone ? calculateZoneLoad(selectedZone, project).supplyCfm : totalCfm;
  const spaceTypeId = selectedZone ? selectedZone.spaceTypeId : 'office';

  // Same candidate pipeline, inputs and weights as the Optimizer Studio so both panels agree on model,
  // delivered airflow and installed capacity.
  const selectedLoad = selectedZone ? calculateZoneLoad(selectedZone, project) : null;
  const summary = generateSystemCandidates(
    displayLoad,
    selectedLoad ? selectedLoad.sensibleLoad : displayLoad * 0.75,
    displayCfm,
    spaceTypeId,
    displayArea,
    isImperial,
    optimizationWeights,
    selectedSystemTypes,
    loadedCatalogs,
    selectedZone ? selectedZone.ducts : [],
    selectedZone ? selectedZone.diffusers : []
  );
  const recommendations = summary.candidates.map((cand) => {
    const estCost: 'Low' | 'Medium' | 'Medium-High' | 'High' | 'Very High' =
      cand.equipment.costIndex <= 35 ? 'Low' : cand.equipment.costIndex <= 60 ? 'Medium' : cand.equipment.costIndex <= 75 ? 'Medium-High' : cand.equipment.costIndex <= 90 ? 'High' : 'Very High';
    const estEfficiency: 'Standard' | 'High' | 'Very High' =
      cand.subscores.sEnergy >= 85 ? 'Very High' : cand.subscores.sEnergy >= 65 ? 'High' : 'Standard';
    const airUnit = cand.indoorUnit || cand.equipment;
    const installedBtu = cand.installedCapacityBtu ?? cand.quantity * cand.equipment.totalCapacityBtuPerHour;
    return {
      id: cand.id,
      type: cand.systemType as string,
      name: `${cand.equipment.manufacturer} ${cand.equipment.model} (${cand.systemType.toUpperCase()})`,
      score: cand.subscores.totalScore,
      reason: cand.tradeOffSummary,
      pros: [
        `Installed Capacity: ${formatLoad(installedBtu, project.units)}`,
        airUnit.capabilities.hasExternalStaticPressure
          ? `Rated ESP: ${formatPressure(airUnit.maxRatedEspInWg, project.units)}`
          : 'Direct quiet air distribution without duct resistance'
      ],
      estUnits: cand.quantity,
      unitCapacityBtu: airUnit.totalCapacityBtuPerHour,
      installedBtu,
      estCost,
      estEfficiency,
      reference: cand.equipment.provenance.source,
      modelLabel: cand.indoorUnit ? `${cand.equipment.model} + ${cand.indoorUnit.model}` : cand.equipment.model,
      deliveredCfm: cand.deliveredCfm ?? deliveredCfmFor(airUnit, cand.quantity, toCfm(displayCfm, project.units)),
      esp: airUnit.capabilities.hasExternalStaticPressure ? formatPressure(airUnit.maxRatedEspInWg, project.units) : undefined
    };
  });

  // List of all 6 system types
  const systemTypes = [
    { id: 'concealed', name: 'Concealed Ducted' },
    { id: 'cassette', name: 'Cassette Split' },
    { id: 'high-wall', name: 'High Wall DX' },
    { id: 'vrf', name: 'VRF System' },
    { id: 'packaged', name: 'Packaged Rooftop' },
    { id: 'ahu', name: 'Central AHU' }
  ];

  // Toggle a system type visibility
  const toggleSystemType = (id: string): void => {
    if (selectedSystemTypes.includes(id)) {
      // Keep at least one selected
      if (selectedSystemTypes.length > 1) {
        setSelectedSystemTypes(selectedSystemTypes.filter((t) => t !== id));
      }
    } else {
      setSelectedSystemTypes([...selectedSystemTypes, id]);
    }
  };

  // Filter recommendations based on selected types
  const filteredRecs = recommendations.filter((rec) => selectedSystemTypes.includes(rec.type));

  // Catalog Status description
  const isDefaultActive = loadedCatalogs && !loadedCatalogs.errors?.length;
  const isCustomActive = loadedCatalogs && loadedCatalogs.errors?.length && (loadedCatalogs.decorative || loadedCatalogs.ducted);

  let catalogStatusLabel = 'Demo Catalog Active';
  let catalogStatusColor = 'bg-neutral-800 text-neutral-400 border-neutral-700';

  if (isDefaultActive) {
    catalogStatusLabel = 'Cairo HVAC Catalogs Active';
    catalogStatusColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  } else if (isCustomActive) {
    catalogStatusLabel = 'Custom Catalogs Active';
    catalogStatusColor = 'bg-blue-500/10 text-blue-400 border-blue-500/20';
  }

  return (
    <div className="flex flex-col gap-5 bg-neutral-900 border border-neutral-800 p-5 rounded-2xl backdrop-blur-md shadow-2xl">
      {/* Panel Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <div>
          <h2 className="text-sm font-bold text-neutral-200 uppercase tracking-wider flex items-center gap-1.5">
            <Award size={16} className="text-amber-500" />
            HVAC System Comparison & Recommendations
          </h2>
          <p className="text-[11px] text-neutral-500 mt-1">
            {selectedZone
              ? `Recommendations for ${selectedZone.name} (Load: ${formatLoad(toBtuh(displayLoad, project.units), project.units)}, Airflow: ${formatAirflow(toCfm(displayCfm, project.units), project.units)})`
              : `Aggregate building recommendations (Total Load: ${formatLoad(toBtuh(displayLoad, project.units), project.units)}, Total Airflow: ${formatAirflow(toCfm(displayCfm, project.units), project.units)})`}
          </p>
        </div>

        {/* Catalog Status Bar & Dynamic Loaders */}
        <div className="flex items-center flex-wrap gap-2 text-[10px]">
          <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full border ${catalogStatusColor} font-semibold`}>
            <Database size={10} />
            {catalogStatusLabel}
          </span>
          <button
            onClick={() => handleLoadCustom('decorative')}
            title="Load custom decorative unit catalog Excel file"
            className="flex items-center gap-1 bg-neutral-950 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 hover:border-neutral-700 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
          >
            <Upload size={10} />
            Load Decorative XLSX
          </button>
          <button
            onClick={() => handleLoadCustom('ducted')}
            title="Load custom ducted unit catalog Excel file"
            className="flex items-center gap-1 bg-neutral-950 hover:bg-neutral-800 text-neutral-300 border border-neutral-800 hover:border-neutral-700 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
          >
            <Upload size={10} />
            Load Ducted XLSX
          </button>
        </div>
      </div>

      {/* System Selection Toggles (Multiselect checklist) */}
      <div className="flex flex-col gap-1.5 bg-neutral-950 border border-neutral-850/60 p-3 rounded-xl">
        <span className="text-[9px] font-bold text-neutral-500 uppercase tracking-wider">Select Systems to Compare</span>
        <div className="flex flex-wrap gap-2">
          {systemTypes.map((sys) => {
            const isSelected = selectedSystemTypes.includes(sys.id);
            const activeClass = isSelected
              ? 'bg-blue-600/15 border-blue-500 text-blue-300 font-bold'
              : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-750 hover:text-neutral-300';
            return (
              <button
                key={sys.id}
                onClick={() => toggleSystemType(sys.id)}
                className={`text-[10px] px-3 py-1 rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${activeClass}`}
              >
                {isSelected && <CheckCircle2 size={10} className="text-blue-400" />}
                {sys.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid of Recommendations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredRecs.map((rec) => {
          // Color coding based on recommendation score
          const scoreColor =
            rec.score >= 80
              ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
              : rec.score >= 60
              ? 'text-blue-500 bg-blue-500/10 border-blue-500/20'
              : 'text-neutral-500 bg-neutral-500/10 border-neutral-500/20';

          return (
            <div
              key={rec.id}
              className="flex flex-col justify-between bg-neutral-950 border border-neutral-850 hover:border-neutral-750 p-4 rounded-xl transition-all duration-300 group shadow-md"
            >
              <div>
                {/* Header */}
                <div className="flex justify-between items-start gap-2">
                  <h3 className="text-xs font-bold text-neutral-200">{rec.name}</h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${scoreColor}`}>
                    Score: {rec.score}
                  </span>
                </div>

                {/* Sizing description */}
                <p className="text-[10px] text-neutral-400 mt-1.5 leading-normal">{rec.reason}</p>

                {/* Catalog Selection Reference Panel */}
                {rec.reference && (
                  <div className="mt-3.5 bg-neutral-900/60 p-3 rounded-lg border border-neutral-850/80 text-[10px] text-neutral-400 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between border-b border-neutral-850 pb-1 mb-1 text-[9px] font-bold text-teal-400 tracking-wider">
                      <span>CATALOG REFERENCE MATCH</span>
                      <span className="text-neutral-500 capitalize">{rec.type} unit</span>
                    </div>
                    {rec.modelLabel && (
                      <div className="flex justify-between">
                        <span>Selected Model:</span>
                        <strong className="text-neutral-200 font-mono font-bold">{rec.modelLabel}</strong>
                      </div>
                    )}
                    {rec.esp && (
                      <div className="flex justify-between">
                        <span>External Static Press. (ESP):</span>
                        <strong className="text-neutral-200 font-mono">{rec.esp}</strong>
                      </div>
                    )}
                    {rec.deliveredCfm > 0 && (
                      <div className="flex justify-between">
                        <span>Delivered Airflow:</span>
                        <strong className="text-neutral-200 font-mono">{formatAirflow(rec.deliveredCfm, project.units)}</strong>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-neutral-850 pt-1 mt-1 text-[9px] text-neutral-500">
                      <span>Source:</span>
                      <span className="truncate max-w-[170px] text-neutral-400 font-mono" title={rec.reference}>
                        {rec.reference}
                      </span>
                    </div>
                  </div>
                )}

                {/* Pros list */}
                <div className="mt-3.5">
                  <span className="text-[9px] font-bold text-neutral-500 block uppercase tracking-wider">Key Advantages</span>
                  <ul className="flex flex-col gap-1 mt-1 text-[10px] text-neutral-400 list-disc list-inside">
                    {rec.pros.slice(0, 2).map((pro, i) => (
                      <li key={i} className="leading-snug">{pro}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Cost, Efficiency, and Capacity info */}
              <div className="mt-4 pt-3 border-t border-neutral-900 flex justify-between items-center text-[10px]">
                <div className="flex gap-3 text-neutral-500">
                  <span className="flex items-center gap-0.5">
                    <DollarSign size={10} className="text-emerald-500" />
                    Cost: <strong className="text-neutral-300 font-semibold">{rec.estCost}</strong>
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Zap size={10} className="text-amber-500" />
                    Eff: <strong className="text-neutral-300 font-semibold">{rec.estEfficiency}</strong>
                  </span>
                </div>

                <span className="text-neutral-400 font-semibold font-mono bg-neutral-900 border border-neutral-850 px-2 py-0.5 rounded">
                  {rec.estUnits} Unit{rec.estUnits > 1 ? 's' : ''} × {(rec.unitCapacityBtu / 12000).toFixed(1)} TR
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
