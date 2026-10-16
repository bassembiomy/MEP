import React, { useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { parseDxfText, ParsedDxf } from '../engine/dxfParser';
import { FT_PER_M, M_PER_FT, SQFT_PER_SQM, CFM_PER_LPS, LPS_PER_CFM, BTUH_PER_W, W_PER_BTUH } from '../engine/units';
import { DRAWING_UNITS, DrawingUnit, feetPerDrawingUnit } from '../canvas/drawingGeometry';
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
    zones,
    updateZone,
    dxfEntities,
    setCadData,
    calibrateCad,
    cadCalibration,
    clearDxfData,
    loadDemoSystems
  } = useProjectStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Single import path for DXF + DWG: the store keeps the RAW parse and normalises it to canvas px (scale + Y flip).
  // Unit/scale notes are shown non-blocking (calibration banner on the canvas, warnings in the layer manager).
  const applyParsedCad = (parsed: ParsedDxf): void => {
    setCadData({
      entities: parsed.entities,
      bbox: parsed.bbox,
      insunits: parsed.insunits,
      layerColors: parsed.layerColors,
      warnings: parsed.warnings,
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
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
              applyParsedCad(parsed);
            })
            .catch((err) => {
              alert(`Error parsing DWG: ${err.message}`);
            })
            .finally(() => {
              setIsLoading(false);
            });
        } else {
          const text = event.target?.result as string;
          applyParsedCad(parseDxfText(text));
          setIsLoading(false);
        }
      } catch (err: unknown) {
        alert(`Error parsing file: ${err instanceof Error ? err.message : String(err)}`);
        setIsLoading(false);
      }
    };

    if (isDwg) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  };

  const currentDrawingUnit = ((): DrawingUnit | 'custom' | 'unknown' => {
    if (!cadCalibration) return 'unknown';
    if (cadCalibration.needsCalibration) return 'unknown';
    const hit = DRAWING_UNITS.find((u) => Math.abs(feetPerDrawingUnit(u) / cadCalibration.feetPerUnit - 1) < 1e-3);
    return hit ?? 'custom';
  })();

  const handleClearDxf = (): void => {
    clearDxfData();
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUnitToggle = (): void => {
    const isImperial = project.units === 'imperial';
    // Zone fields stored in PROJECT units must be converted so the physical design stays the same:
    // ceiling height (ft<->m), lighting/equipment overrides (W/ft2<->W/m2), manual airflow (CFM<->L/s)
    // and manual load (Btu/h<->W).
    const round = (v: number, d: number): number => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
    for (const z of zones) {
      const patch: Partial<typeof z> = {
        ceilingHeight: round(isImperial ? z.ceilingHeight * M_PER_FT : z.ceilingHeight * FT_PER_M, 2)
      };
      if (z.lightingOverride !== undefined) {
        patch.lightingOverride = round(isImperial ? z.lightingOverride * SQFT_PER_SQM : z.lightingOverride / SQFT_PER_SQM, 2);
      }
      if (z.equipmentOverride !== undefined) {
        patch.equipmentOverride = round(isImperial ? z.equipmentOverride * SQFT_PER_SQM : z.equipmentOverride / SQFT_PER_SQM, 2);
      }
      if (z.manualCfmOverride !== undefined) {
        patch.manualCfmOverride = round(isImperial ? z.manualCfmOverride * LPS_PER_CFM : z.manualCfmOverride * CFM_PER_LPS, 0);
      }
      if (z.manualCoolingOverride !== undefined) {
        patch.manualCoolingOverride = round(isImperial ? z.manualCoolingOverride * W_PER_BTUH : z.manualCoolingOverride * BTUH_PER_W, 0);
      }
      updateZone(z.id, patch);
    }
    setProject({
      units: isImperial ? 'metric' : 'imperial',
      // Convert design outdoor/indoor dry-bulbs for convenience
      outdoorDb: isImperial ? Math.round((project.outdoorDb - 32) * 5 / 9) : Math.round((project.outdoorDb * 9 / 5) + 32),
      indoorDb: isImperial ? Math.round((project.indoorDb - 32) * 5 / 9) : Math.round((project.indoorDb * 9 / 5) + 32),
      scale: isImperial ? 10 * FT_PER_M : 10, // keep the same px-per-foot: 10 px/ft == 32.8084 px/m
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
            {cadCalibration && (
              <label className="flex items-center justify-between gap-2 text-[10px] text-neutral-400">
                Drawing units
                <select
                  value={currentDrawingUnit}
                  onChange={(e) => {
                    const v = e.target.value as DrawingUnit;
                    if (DRAWING_UNITS.includes(v)) calibrateCad(feetPerDrawingUnit(v));
                  }}
                  className="bg-neutral-800 text-neutral-200 rounded px-1.5 py-1 text-[10px] border border-neutral-700"
                  title="Set what one CAD unit means (re-scales the drawing under the design)"
                >
                  {currentDrawingUnit === 'unknown' && <option value="unknown" disabled>unknown (assumed)</option>}
                  {currentDrawingUnit === 'custom' && <option value="custom" disabled>calibrated</option>}
                  {DRAWING_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </label>
            )}
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
