import React from 'react';
import { useProjectStore } from '../store/projectStore';
import { calculateZoneLoad } from '../engine/loadCalc';
import { recommendSystemsForZone } from '../engine/systemDesigner';
import { Award, DollarSign, Zap } from 'lucide-react';

export const SystemComparisonTable: React.FC = () => {
  const { selectedZoneId, zones, project } = useProjectStore();

  const selectedZone = zones.find((z) => z.id === selectedZoneId);

  // If no zone is selected, we can summarize the main zones load
  const totalArea = zones.reduce((sum, z) => {
    const load = calculateZoneLoad(z, project);
    return sum + load.area;
  }, 0);

  const totalLoad = zones.reduce((sum, z) => {
    const load = calculateZoneLoad(z, project);
    return sum + load.totalLoad;
  }, 0);

  if (zones.length === 0) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl text-center text-neutral-500 text-xs">
        Draw a zone on the floor plan to compare suitable HVAC systems.
      </div>
    );
  }

  const isImperial = project.units === 'imperial';
  const displayArea = selectedZone ? calculateZoneLoad(selectedZone, project).area : totalArea;
  const displayLoad = selectedZone ? calculateZoneLoad(selectedZone, project).totalLoad : totalLoad;
  const spaceTypeId = selectedZone ? selectedZone.spaceTypeId : 'office';

  const recommendations = recommendSystemsForZone(displayArea, displayLoad, spaceTypeId, isImperial);

  return (
    <div className="flex flex-col gap-4 bg-neutral-900 border border-neutral-800 p-5 rounded-2xl backdrop-blur-md shadow-2xl">
      <div>
        <h2 className="text-sm font-bold text-neutral-200 uppercase tracking-wider flex items-center gap-1.5">
          <Award size={16} className="text-amber-500" />
          HVAC System Comparison & Recommendations
        </h2>
        <p className="text-[11px] text-neutral-500 mt-1">
          {selectedZone
            ? `Recommendations for ${selectedZone.name} (Load: ${displayLoad.toLocaleString()} ${isImperial ? 'Btu/h' : 'W'})`
            : `Aggregate building recommendations (Total Load: ${displayLoad.toLocaleString()} ${isImperial ? 'Btu/h' : 'W'})`}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {recommendations.slice(0, 4).map((rec) => {
          // Color coding based on recommendation score
          const scoreColor =
            rec.score >= 80
              ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
              : rec.score >= 60
              ? 'text-blue-500 bg-blue-500/10 border-blue-500/20'
              : 'text-neutral-500 bg-neutral-500/10 border-neutral-500/20';

          return (
            <div
              key={rec.type}
              className="flex flex-col justify-between bg-neutral-950 border border-neutral-850 hover:border-neutral-700 p-4 rounded-xl transition-all duration-300 group"
            >
              <div>
                <div className="flex justify-between items-start gap-2">
                  <h3 className="text-xs font-bold text-neutral-200">{rec.name}</h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${scoreColor}`}>
                    Score: {rec.score}
                  </span>
                </div>

                <p className="text-[10px] text-neutral-500 mt-1.5 leading-normal">{rec.reason}</p>

                {/* Pros list */}
                <div className="mt-3">
                  <span className="text-[9px] font-bold text-neutral-400 block uppercase">Key Advantages</span>
                  <ul className="flex flex-col gap-1 mt-1 text-[10px] text-neutral-500 list-disc list-inside">
                    {rec.pros.slice(0, 2).map((pro, i) => (
                      <li key={i}>{pro}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-neutral-900 flex justify-between items-center text-[10px]">
                <div className="flex gap-3 text-neutral-500">
                  <span className="flex items-center gap-0.5">
                    <DollarSign size={10} className="text-emerald-500" />
                    Cost: <strong className="text-neutral-300 font-medium">{rec.estCost}</strong>
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Zap size={10} className="text-amber-500" />
                    Eff: <strong className="text-neutral-300 font-medium">{rec.estEfficiency}</strong>
                  </span>
                </div>

                <span className="text-neutral-400 font-medium font-mono">
                  {rec.estUnits} Unit{rec.estUnits > 1 ? 's' : ''} × {(rec.unitCapacity / (isImperial ? 12000 : 3517)).toFixed(1)} Tons
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
