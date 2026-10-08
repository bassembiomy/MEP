import React from 'react';
import { useProjectStore } from '../store/projectStore';
import { calculateZoneLoadSafely } from '../engine/loadCalc';
import { Table } from 'lucide-react';

export const LoadSummaryPanel: React.FC = () => {
  const { zones, project } = useProjectStore();

  const isImperial = project.units === 'imperial';
  const evaluations = zones.map(zone => ({ zone, ...calculateZoneLoadSafely(zone, project) }));
  const invalid = evaluations.filter(result => !result.load);
  if (invalid.length) return <div role="alert" className="p-4 text-xs text-red-300">
    Load schedule is incomplete. Correct these inputs before calculating totals:
    {invalid.map(result => <p key={result.zone.id}>{result.zone.name}: {result.error}</p>)}
  </div>;
  const loads = new Map(evaluations.flatMap(result => result.load ? [[result.zone.id, result.load] as const] : []));

  // Calculate totals
  const totals = zones.reduce(
    (acc, z) => {
      const load = loads.get(z.id)!;
      return {
        area: acc.area + load.area,
        sensible: acc.sensible + load.sensibleLoad,
        totalLoad: acc.totalLoad + load.totalLoad,
        supplyCfm: acc.supplyCfm + load.supplyCfm,
        oaCfm: acc.oaCfm + load.oaCfm,
        exhaustCfm: acc.exhaustCfm + load.exhaustCfm,
        returnCfm: acc.returnCfm + load.returnCfm
      };
    },
    { area: 0, sensible: 0, totalLoad: 0, supplyCfm: 0, oaCfm: 0, exhaustCfm: 0, returnCfm: 0 }
  );

  const totalTons = isImperial ? totals.totalLoad / 12000 : totals.totalLoad / 3517;

  return (
    <div className="bg-neutral-900 border border-neutral-800 p-5 rounded-2xl backdrop-blur-md shadow-2xl overflow-x-auto w-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-sm font-bold text-neutral-200 uppercase tracking-wider flex items-center gap-1.5">
          <Table size={16} className="text-emerald-500" />
          Building Load Schedule & Air Balance
        </h2>
        <span className="text-[10px] text-neutral-500 font-medium">
          Totals: {totals.area.toLocaleString()} {isImperial ? 'ft²' : 'm²'} |{' '}
          {Math.round(totalTons * 10) / 10} TR
        </span>
      </div>

      {zones.length === 0 ? (
        <p className="text-xs text-neutral-500 text-center py-4">No schedules available. Add zones to populate database.</p>
      ) : (
        <table className="w-full text-[11px] text-left border-collapse">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-500 font-bold uppercase tracking-wider text-[9px]">
              <th className="py-2.5">Zone Name</th>
              <th className="py-2.5">Space Type</th>
              <th className="py-2.5 text-right">Area</th>
              <th className="py-2.5 text-right">Occupants</th>
              <th className="py-2.5 text-right">Total Load</th>
              <th className="py-2.5 text-right">Capacity (Tons)</th>
              <th className="py-2.5 text-right">Supply CFM</th>
              <th className="py-2.5 text-right">Fresh OA</th>
              <th className="py-2.5 text-right">Exhaust</th>
              <th className="py-2.5 text-right">Return</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-850 text-neutral-300 font-mono">
            {zones.map((z) => {
              const load = loads.get(z.id)!;
              return (
                <tr key={z.id} className="hover:bg-neutral-950/40 transition-colors">
                  <td className="py-3 font-sans font-medium text-neutral-200">{z.name}</td>
                  <td className="py-3 font-sans text-neutral-400 capitalize">{z.spaceTypeId.replace('-', ' ')}</td>
                  <td className="py-3 text-right">{load.area.toLocaleString()}</td>
                  <td className="py-3 text-right">{load.occupants}</td>
                  <td className="py-3 text-right">
                    {load.totalLoad.toLocaleString()} {isImperial ? 'Btu/h' : 'W'}
                  </td>
                  <td className="py-3 text-right text-amber-500 font-bold">{load.totalTons}</td>
                  <td className="py-3 text-right text-emerald-400">{load.supplyCfm}</td>
                  <td className="py-3 text-right text-neutral-400">{load.oaCfm}</td>
                  <td className="py-3 text-right text-neutral-400">{load.exhaustCfm}</td>
                  <td className="py-3 text-right text-teal-400">{load.returnCfm}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-neutral-800 font-bold bg-neutral-950/60 text-white">
              <td className="py-3 font-sans">Total Schedule</td>
              <td className="py-3 font-sans"></td>
              <td className="py-3 text-right">{totals.area.toLocaleString()}</td>
              <td className="py-3 text-right">{zones.reduce((sum, z) => sum + loads.get(z.id)!.occupants, 0)}</td>
              <td className="py-3 text-right text-neutral-300">
                {totals.totalLoad.toLocaleString()} {isImperial ? 'Btu/h' : 'W'}
              </td>
              <td className="py-3 text-right text-amber-500 font-extrabold">{Math.round(totalTons * 10) / 10}</td>
              <td className="py-3 text-right text-emerald-400">{totals.supplyCfm}</td>
              <td className="py-3 text-right text-neutral-400">{totals.oaCfm}</td>
              <td className="py-3 text-right text-neutral-400">{totals.exhaustCfm}</td>
              <td className="py-3 text-right text-teal-400">{totals.returnCfm}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
};
