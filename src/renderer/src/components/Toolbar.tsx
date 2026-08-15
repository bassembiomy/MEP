import React, { useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { parseDxfText } from '../engine/dxfParser';
import { parseDwgBuffer } from '../engine/dwgParser';
import { MousePointer, PenTool, Hand, RefreshCw, Trash2, ShieldAlert, Upload, X, CheckCircle, LayoutGrid } from 'lucide-react';

export const Toolbar: React.FC = () => {
  const {
    drawMode,
    setDrawMode,
    project,
    setProject,
    tempPoints,
    clearTempPoints,
    selectedZoneId,
    deleteZone,
    dxfEntities,
    setDxfData,
    clearDxfData,
    loadDemoSystems
  } = useProjectStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setIsLoading(true);

    const isDwg = file.name.toLowerCase().endsWith('.dwg');
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        if (isDwg) {
          const buffer = event.target?.result as ArrayBuffer;
          parseDwgBuffer(new Uint8Array(buffer))
            .then((parsed) => {
              setDxfData(parsed.entities, parsed.bbox);
            })
            .catch((err) => {
              alert(`Error parsing DWG: ${err.message}`);
            })
            .finally(() => {
              setIsLoading(false);
            });
        } else {
          const text = event.target?.result as string;
          const parsed = parseDxfText(text);
          setDxfData(parsed.entities, parsed.bbox);
          setIsLoading(false);
        }
      } catch (err: any) {
        alert(`Error parsing file: ${err.message}`);
        setIsLoading(false);
      }
    };

    if (isDwg) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  };

  const handleClearDxf = () => {
    clearDxfData();
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUnitToggle = () => {
    const isImperial = project.units === 'imperial';
    setProject({
      units: isImperial ? 'metric' : 'imperial',
      // Convert design outdoor/indoor dry-bulbs for convenience
      outdoorDb: isImperial ? Math.round((project.outdoorDb - 32) * 5 / 9) : Math.round((project.outdoorDb * 9 / 5) + 32),
      indoorDb: isImperial ? Math.round((project.indoorDb - 32) * 5 / 9) : Math.round((project.indoorDb * 9 / 5) + 32),
      scale: isImperial ? 32.8 : 10, // Adjust scale default (32.8px/m vs 10px/ft)
    });
  };

  return (
    <div className="flex flex-col gap-4 bg-neutral-900/90 border border-neutral-800 p-4 rounded-2xl w-60 backdrop-blur-md shadow-2xl">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400">MEP Draw Tools</h2>
        <p className="text-[11px] text-neutral-500 mt-1">Design and layout HVAC zones</p>
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={() => setDrawMode('select')}
          className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 ${
            drawMode === 'select'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
              : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
          }`}
        >
          <MousePointer size={16} />
          Select / Edit Zone
        </button>

        <button
          onClick={() => setDrawMode('polyline')}
          className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 ${
            drawMode === 'polyline'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
              : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
          }`}
        >
          <PenTool size={16} />
          Draw Zone Polyline
        </button>

        <button
          onClick={() => setDrawMode('pan')}
          className={`flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 ${
            drawMode === 'pan'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
              : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
          }`}
        >
          <Hand size={16} />
          Pan Canvas
        </button>

        <button
          onClick={loadDemoSystems}
          className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-600 to-teal-500 hover:from-blue-500 hover:to-teal-400 text-white shadow-lg shadow-blue-500/10 hover:shadow-blue-500/25 transition-all duration-300 border border-blue-500/20"
        >
          <LayoutGrid size={16} />
          Load 4 Systems Demo
        </button>
      </div>

      <hr className="border-neutral-800" />

      {/* Temp draw status */}
      {drawMode === 'polyline' && (
        <div className="bg-neutral-950 border border-neutral-800 p-3 rounded-xl">
          <p className="text-[11px] font-medium text-neutral-400">Drawing Progress</p>
          <p className="text-[10px] text-neutral-500 mt-1">
            Points clicked: <span className="text-blue-500 font-bold">{tempPoints.length / 2}</span>
          </p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={clearTempPoints}
              disabled={tempPoints.length === 0}
              className="text-[10px] bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-2 py-1 rounded disabled:opacity-50"
            >
              Reset
            </button>
            <p className="text-[9px] text-neutral-500 self-center">Double-click to finish</p>
          </div>
        </div>
      )}

      <hr className="border-neutral-800" />

      {/* DXF/DWG Upload Section */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">AutoCAD Underlay (.dxf, .dwg)</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".dxf,.dwg"
          onChange={handleFileChange}
          className="hidden"
        />
        
        {dxfEntities.length === 0 ? (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-neutral-800 hover:bg-neutral-750 text-neutral-300 rounded-xl text-xs font-semibold border border-neutral-750 transition-colors cursor-pointer"
          >
            <Upload size={14} />
            {isLoading ? 'Loading CAD...' : 'Upload Floor Plan'}
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between bg-neutral-950 p-2.5 rounded-xl border border-neutral-800">
              <div className="flex items-center gap-1.5 min-w-0">
                <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                <span className="text-[10px] text-neutral-400 truncate max-w-[100px]" title={fileName || 'dxf'}>
                  {fileName || 'CAD Plan'}
                </span>
              </div>
              <button
                onClick={handleClearDxf}
                className="text-neutral-500 hover:text-red-400 p-0.5 rounded hover:bg-neutral-900 transition-colors cursor-pointer"
              >
                <X size={12} />
              </button>
            </div>
            <p className="text-[9px] text-neutral-500 text-right -mt-1 mr-1">
              CAD Elements: <strong className="text-neutral-400 font-mono font-medium">{dxfEntities.length}</strong>
            </p>
          </div>
        )}
      </div>

      <hr className="border-neutral-800" />

      {/* Units Toggle */}
      <div className="flex justify-between items-center bg-neutral-950/50 p-3 rounded-xl border border-neutral-800">
        <span className="text-[11px] font-medium text-neutral-400">Unit System</span>
        <button
          onClick={handleUnitToggle}
          className="flex items-center gap-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wider uppercase transition-colors"
        >
          <RefreshCw size={10} />
          {project.units}
        </button>
      </div>

      {selectedZoneId && (
        <button
          onClick={() => deleteZone(selectedZoneId)}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-red-950/30 border border-red-800/50 hover:bg-red-950/60 text-red-400 rounded-xl text-xs font-semibold transition-all duration-200"
        >
          <Trash2 size={14} />
          Delete Selected Zone
        </button>
      )}

      {/* Instructions */}
      <div className="bg-blue-950/20 border border-blue-900/30 p-3 rounded-xl flex gap-2">
        <ShieldAlert size={16} className="text-blue-500 shrink-0 mt-0.5" />
        <p className="text-[10px] text-blue-400 leading-normal">
          Click on the canvas to place points. Double-click near your first point to close the zone boundary.
        </p>
      </div>
    </div>
  );
};
