import React, { useState } from 'react';
import { useProjectStore, AnnotationVisibility } from '../store/projectStore';
import {
  Layers,
  Eye,
  EyeOff,
  CheckSquare,
  Square,
  Sparkles,
  Sliders,
  Type,
  Grid,
  Box,
  Wind,
  Cpu,
  Flame,
  X
} from 'lucide-react';

interface CadLayerManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CadLayerManagerModal: React.FC<CadLayerManagerProps> = ({ isOpen, onClose }) => {
  const {
    dxfLayers,
    setDxfLayerVisibility,
    toggleAllDxfLayers,
    annotationVisibility,
    setAnnotationVisibility,
    toggleAllAnnotations
  } = useProjectStore();

  const [activeTab, setActiveTab] = useState<'layers' | 'annotations'>('layers');

  if (!isOpen) return null;

  const layerList = Object.values(dxfLayers);
  const totalEntities = layerList.reduce((sum, l) => sum + l.count, 0);
  const visibleLayersCount = layerList.filter((l) => l.visible).length;

  const annotationItems: { key: keyof AnnotationVisibility; label: string; description: string; icon: React.ReactNode }[] = [
    { key: 'diffusers', label: 'Air Diffusers & Grilles', description: 'Supply 4-way terminals & return eggcrate grilles', icon: <Wind size={13} className="text-emerald-400" /> },
    { key: 'diffuserCfm', label: 'Diffuser CFM Numbers', description: 'Inline yellow CFM labels (e.g. 335 CFM) under terminals', icon: <Type size={13} className="text-yellow-400" /> },
    { key: 'diffuserTags', label: 'Diffuser Model Tags', description: 'Standard MEP engineering tags (e.g. CD-1, RG-1)', icon: <Sliders size={13} className="text-cyan-400" /> },
    { key: 'throwRings', label: 'Diffuser Throw Radius', description: 'Radial air throw coverage circles (T50)', icon: <Sparkles size={13} className="text-blue-400" /> },
    { key: 'ducts', label: 'Duct Network Geometry', description: 'Double-line physical duct bodies and transitions', icon: <Box size={13} className="text-sky-400" /> },
    { key: 'ductCfm', label: 'Duct Branch CFM Text', description: 'Airflow quantity stamped along each branch segment', icon: <Type size={13} className="text-amber-400" /> },
    { key: 'ductSizeBadges', label: 'Duct Sizing & FPM Badges', description: 'LOD 2+ detailed duct dimension & velocity badges', icon: <Sliders size={13} className="text-indigo-400" /> },
    { key: 'ductCenterlines', label: 'Duct Centerline Axis', description: 'Dotted routing centerline paths', icon: <Sliders size={13} className="text-slate-400" /> },
    { key: 'indoorUnits', label: 'Indoor Units (FCU/AHU/RTU)', description: 'Concealed split FCUs, AHUs, and Packaged RTUs', icon: <Cpu size={13} className="text-red-400" /> },
    { key: 'outdoorUnits', label: 'Outdoor Condensing Units (ACU)', description: 'Air-cooled condensing units along exterior boundary', icon: <Cpu size={13} className="text-cyan-400" /> },
    { key: 'refrigerantPiping', label: 'Copper Refrigerant Piping', description: 'Dual orange line-sets & (P) / (R) isolation valves', icon: <Flame size={13} className="text-orange-400" /> },
    { key: 'leaderCallout', label: 'Master Engineering Leader Tag', description: 'Top-right complete system breakdown callout box', icon: <Type size={13} className="text-yellow-400" /> },
    { key: 'zoneLabels', label: 'Zone Room Names & Total CFM', description: 'Room centroid title labels and design cooling loads', icon: <Type size={13} className="text-emerald-400" /> },
    { key: 'grid', label: 'CAD Background Grid Lines', description: '10ft / Metric coordinate background snaps', icon: <Grid size={13} className="text-neutral-400" /> },
    { key: 'dxfText', label: 'DXF Native Text Entities', description: 'Text imported directly from the underlying CAD file', icon: <Type size={13} className="text-purple-400" /> },
  ];

  return (
    <div className="absolute top-14 right-4 z-40 w-84 max-h-[75vh] bg-neutral-900/95 border border-neutral-750 rounded-2xl shadow-2xl backdrop-blur-xl flex flex-col overflow-hidden text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 bg-neutral-950/80">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30">
            <Layers size={14} />
          </div>
          <div>
            <h3 className="font-bold text-neutral-100 text-xs">CAD Layers & Annotations</h3>
            <p className="text-[10px] text-neutral-400">Manage drawing visibility & annotations</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-800 bg-neutral-900/60 p-1">
        <button
          onClick={() => setActiveTab('layers')}
          className={`flex-1 py-1.5 rounded-lg font-semibold text-[11px] transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === 'layers'
              ? 'bg-blue-600 text-white shadow'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Layers size={12} />
          DXF Layers ({layerList.length})
        </button>
        <button
          onClick={() => setActiveTab('annotations')}
          className={`flex-1 py-1.5 rounded-lg font-semibold text-[11px] transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === 'annotations'
              ? 'bg-blue-600 text-white shadow'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Sliders size={12} />
          Annotations ({Object.values(annotationVisibility).filter(Boolean).length})
        </button>
      </div>

      {/* Content Body */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 max-h-[50vh]">
        {activeTab === 'layers' ? (
          <>
            {/* Quick Actions */}
            {layerList.length > 0 && (
              <div className="flex items-center justify-between pb-2 border-b border-neutral-800 text-[10px] text-neutral-400">
                <span>{visibleLayersCount} of {layerList.length} visible ({totalEntities} entities)</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleAllDxfLayers(true)}
                    className="hover:text-blue-400 cursor-pointer font-semibold"
                  >
                    Show All
                  </button>
                  <span className="text-neutral-700">|</span>
                  <button
                    onClick={() => toggleAllDxfLayers(false)}
                    className="hover:text-red-400 cursor-pointer font-semibold"
                  >
                    Hide All
                  </button>
                </div>
              </div>
            )}

            {layerList.length === 0 ? (
              <div className="py-6 text-center text-neutral-500 text-[11px] flex flex-col items-center gap-2">
                <Layers size={24} className="text-neutral-700" />
                <p>No DXF CAD layers loaded.</p>
                <p className="text-[10px] text-neutral-600">Import a DXF file from the top menu to view layers.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {layerList.map((layer) => (
                  <div
                    key={layer.name}
                    onClick={() => setDxfLayerVisibility(layer.name, !layer.visible)}
                    className={`flex items-center justify-between p-2 rounded-xl border transition-all cursor-pointer select-none ${
                      layer.visible
                        ? 'bg-neutral-850/60 border-neutral-800 hover:border-neutral-700 text-neutral-200'
                        : 'bg-neutral-950/40 border-neutral-900 text-neutral-600 opacity-60 hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <button
                        className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${
                          layer.visible ? 'text-blue-400' : 'text-neutral-600'
                        }`}
                      >
                        {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>
                      <div
                        className="w-2.5 h-2.5 rounded-full shadow-sm"
                        style={{ backgroundColor: layer.color || '#94a3b8' }}
                      />
                      <span className="font-medium text-[11px]">{layer.name}</span>
                    </div>
                    <span className="text-[10px] font-mono text-neutral-500 bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-800">
                      {layer.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Quick Actions */}
            <div className="flex items-center justify-between pb-2 border-b border-neutral-800 text-[10px] text-neutral-400">
              <span>Toggle MEP drawing annotations</span>
              <div className="flex gap-2">
                <button
                  onClick={() => toggleAllAnnotations(true)}
                  className="hover:text-blue-400 cursor-pointer font-semibold"
                >
                  Show All
                </button>
                <span className="text-neutral-700">|</span>
                <button
                  onClick={() => toggleAllAnnotations(false)}
                  className="hover:text-red-400 cursor-pointer font-semibold"
                >
                  Hide All
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              {annotationItems.map((item) => {
                const isVisible = annotationVisibility[item.key];
                return (
                  <div
                    key={item.key}
                    onClick={() => setAnnotationVisibility(item.key, !isVisible)}
                    className={`flex items-start justify-between p-2 rounded-xl border transition-all cursor-pointer select-none ${
                      isVisible
                        ? 'bg-neutral-850/60 border-neutral-800 hover:border-neutral-700 text-neutral-200'
                        : 'bg-neutral-950/40 border-neutral-900 text-neutral-600 opacity-60 hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5">{item.icon}</div>
                      <div>
                        <div className="font-medium text-[11px]">{item.label}</div>
                        <div className="text-[9px] text-neutral-500">{item.description}</div>
                      </div>
                    </div>
                    <div className={`mt-0.5 ${isVisible ? 'text-blue-400' : 'text-neutral-600'}`}>
                      {isVisible ? <CheckSquare size={13} /> : <Square size={13} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-neutral-800 bg-neutral-950/90 flex items-center justify-between text-[10px] text-neutral-500">
        <span>Press <kbd className="px-1 py-0.5 bg-neutral-850 rounded text-neutral-300">Space+Drag</kbd> to Pan</span>
        <button
          onClick={onClose}
          className="text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
        >
          Done
        </button>
      </div>
    </div>
  );
};
