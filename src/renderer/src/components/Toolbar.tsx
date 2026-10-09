import React, { useRef, useState } from 'react';
import { useProjectStore, selectPersistedProject } from '../store/projectStore';
import { serializeProject } from '../engine/project/projectSerialization';
import {exportProjectDxf} from '../engine/export/exportDxf';
import { decodeDxfBytes, parseDxfText } from '../engine/dxfParser';
import { parseDwgBuffer } from '../engine/dwgParser';
import { MousePointer, PenTool, Hand, RefreshCw, Trash2, ShieldAlert, Upload, X, CheckCircle, Sparkles } from 'lucide-react';
import { AiHvacAssistantModal } from './AiHvacAssistantModal';

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
    cadImport,
    restoreProjectDocument
  } = useProjectStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const importRequestRef = useRef(0);
  const [fileError,setFileError] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState<boolean>(false);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file=event.currentTarget.files?.[0];
    if(!file) return;
    const request=++importRequestRef.current;
    setIsLoading(true);setFileError('');
    try {
      const parsed=file.name.toLowerCase().endsWith('.dwg')
        ? await parseDwgBuffer(new Uint8Array(await file.arrayBuffer()))
        : parseDxfText(decodeDxfBytes(new Uint8Array(await file.arrayBuffer())));
      if(request!==importRequestRef.current) return;
      const units=useProjectStore.getState().project.units;
      setDxfData(parsed.entities,parsed.bbox,units==='imperial'?parsed.suggestedScaleImperial:parsed.suggestedScaleMetric,parsed.cadUnit,
        {sourceName:file.name,diagnostics:parsed.diagnostics??[],unitsConfidence:parsed.unitsConfidence??'unknown'},parsed.blockReferences,parsed.hiddenLayers);
      setFileName(file.name);
    } catch(error) {
      if(request===importRequestRef.current) setFileError(error instanceof Error?error.message:String(error));
    } finally { if(request===importRequestRef.current) setIsLoading(false); }
  };

  const handleClearDxf = () => {
    ++importRequestRef.current;setIsLoading(false);clearDxfData();setFileName(null);setFileError('');
    if(fileInputRef.current) fileInputRef.current.value='';
  };

  const handleUnitToggle = () => setProject({units:project.units==='imperial'?'metric':'imperial'});
  const handleExport = (reportOnly=false) => {
    try {
      const output=exportProjectDxf(useProjectStore.getState());
      const url=URL.createObjectURL(new Blob([reportOnly?JSON.stringify(output.report,null,2):output.text],{type:reportOnly?'application/json':'application/dxf'}));
      const link=document.createElement('a');link.href=url;
      link.download=project.name.replace(/[^a-z0-9_-]+/gi,'_')+(reportOnly?'.engineering-report.json':'.preliminary.dxf');link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);setFileError('');
    } catch(error) {setFileError(error instanceof Error?error.message:String(error));}
  };

  const handleSaveProject = () => {
    try {
      const text=serializeProject(selectPersistedProject(useProjectStore.getState()));
      const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;
      link.download=project.name.replace(/[^a-z0-9_-]+/gi,'_')+'.mep.json';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);setFileError('');
    } catch(error) {setFileError(error instanceof Error?error.message:String(error));}
  };

  const handleOpenProject = async (event:React.ChangeEvent<HTMLInputElement>) => {
    const file=event.currentTarget.files?.[0];event.currentTarget.value='';
    if(!file) return;
    if(useProjectStore.getState().zones.length && !window.confirm('Open this project and replace the current workspace? Save your current project first if needed.')) return;
    const request=++importRequestRef.current;setIsLoading(true);setFileError('');
    try {
      const text=await file.text();
      if(request!==importRequestRef.current) return;
      const result=restoreProjectDocument(text);
      if(!result.success) setFileError(result.error??'Cannot open project');
      else setFileName(useProjectStore.getState().cadImport?.sourceName??null);
    } catch(error) { if(request===importRequestRef.current) setFileError(error instanceof Error?error.message:String(error)); }
    finally {if(request===importRequestRef.current) setIsLoading(false);}
  };

  return (
    <div className="flex flex-col gap-4 w-full h-full overflow-y-auto p-3.5 select-none">
      <div className="border-b border-neutral-800/80 pb-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-300">MEP Draw Tools</h2>
        <p className="text-[10px] text-neutral-500 mt-0.5">Design & configure HVAC zones</p>
      </div>
      <div className="flex gap-2 text-xs">
        <button disabled={isLoading} onClick={()=>handleExport()} className="flex-1 rounded-lg border border-neutral-700 p-2 disabled:opacity-50">Export DXF</button>
        <button disabled={isLoading} onClick={()=>handleExport(true)} className="flex-1 rounded-lg border border-neutral-700 p-2 disabled:opacity-50">Engineering report</button>
      </div>

      {fileError && <p role="alert" className="text-xs text-red-300 break-words">{fileError}</p>}
      <input ref={projectInputRef} type="file" accept=".json,.mep.json" className="hidden" onChange={handleOpenProject} />
      <div className="flex gap-2 text-xs">
        <button disabled={isLoading} onClick={handleSaveProject} className="flex-1 rounded-lg border border-neutral-700 p-2 disabled:opacity-50">Save project</button>
        <button disabled={isLoading} onClick={()=>projectInputRef.current?.click()} className="flex-1 rounded-lg border border-neutral-700 p-2 disabled:opacity-50">Open project</button>
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
          Select / Edit
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
          Draw Zone Polygon
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
      </div>

      {tempPoints.length > 0 && (
        <div className="flex flex-col gap-2 bg-neutral-950 p-3 rounded-xl border border-neutral-800 animate-in fade-in">
          <div className="flex justify-between items-center text-xs">
            <span className="text-neutral-400">Drawing in progress</span>
            <span className="text-blue-400 font-mono font-bold">{tempPoints.length / 2} pts</span>
          </div>
          <button
            onClick={clearTempPoints}
            className="flex items-center justify-center gap-1.5 w-full py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-[11px] font-medium transition-colors"
          >
            <Trash2 size={12} />
            Cancel Polygon
          </button>
        </div>
      )}

      <hr className="border-neutral-800" />

      {/* CAD File Import */}
      <div className="flex flex-col gap-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">AutoCAD Drawing</label>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".dxf,.dwg"
          className="hidden"
        />

        {!dxfEntities || dxfEntities.length === 0 ? (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-neutral-800 hover:bg-neutral-750 text-neutral-200 rounded-xl text-xs font-medium border border-neutral-700 transition-all duration-200 cursor-pointer disabled:opacity-50"
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
                  {fileName || cadImport?.sourceName || 'CAD Plan'}
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

      {cadImport && <div className="rounded-xl border border-amber-800/60 p-2 text-[10px] text-amber-300">
        <p>{project.cadUnitsConfirmed===false ? 'Drawing units are not confirmed. Confirm or calibrate the scale before engineering.' : cadImport.unitsConfidence === 'declared' ? 'Drawing units read from CAD header.' : 'Drawing units confirmed by you.'}</p>
        {cadImport.diagnostics.length>0 && <details className="mt-1"><summary>{cadImport.diagnostics.length} import diagnostic(s)</summary>
          <ul className="max-h-40 overflow-auto mt-1">{cadImport.diagnostics.map((d,i)=><li key={i} className="mb-1">{d.severity}: {d.message}</li>)}</ul>
        </details>}
      </div>}

      {/* CAD Scale & Drawing Unit Calibrator */}
      <div className="flex flex-col gap-2 bg-neutral-950/70 p-3 rounded-xl border border-neutral-800/80">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-neutral-400">
          <span>CAD Scale & Units</span>
          <span className="text-teal-400 font-mono">{project.cadUnit || 'mm'}</span>
        </div>

        <div className="flex flex-col gap-1.5 text-xs">
          <label className="text-[9px] text-neutral-500">Drawing Unit Scale</label>
          <select
            value={project.cadUnit || (project.scale > 200 ? 'mm' : project.scale > 10 ? 'in' : 'ft')}
            onChange={(e) => {
              const u = e.target.value as 'mm' | 'cm' | 'in' | 'm' | 'ft' | 'custom';
              const isImp = project.units === 'imperial';
              let newScale = project.scale;
              if (u === 'mm') newScale = isImp ? 304.8 : 1000;
              else if (u === 'cm') newScale = isImp ? 30.48 : 100;
              else if (u === 'in') newScale = isImp ? 12 : (1 / 0.0254);
              else if (u === 'm') newScale = isImp ? 0.3048 : 1;
              else if (u === 'ft') newScale = isImp ? 1 : (1 / 0.3048);
              setProject({ scale: newScale, cadUnit: u, cadUnitsConfirmed:true });
            }}
            className="bg-neutral-900 border border-neutral-800 text-neutral-200 text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-teal-500"
          >
            <option value="mm">Millimeters (1 ft = 304.8 mm)</option>
            <option value="cm">Centimeters (1 m = 100 cm)</option>
            <option value="in">Inches (1 ft = 12 in)</option>
            <option value="m">Meters (1 m = 1 unit)</option>
            <option value="ft">Feet (1 ft = 1 unit)</option>
            <option value="custom">Screen Pixels (10 px/ft)</option>
          </select>
        </div>

        <div className="flex items-center justify-between text-[10px] text-neutral-500 pt-1 border-t border-neutral-900">
          <span>Active Scale:</span>
          <span className="font-mono text-neutral-300 font-semibold">{project.scale.toFixed(1)} {project.units === 'imperial' ? 'units/ft' : 'units/m'}</span>
        </div>
      </div>

      {project.cadUnitsConfirmed===false && <button onClick={()=>setProject({cadUnitsConfirmed:true})} className="rounded-lg border border-amber-700 p-2 text-xs text-amber-300">Confirm selected units and scale</button>}
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

      {/* AI HVAC Design Studio Button */}
      <button
        onClick={() => setIsAiModalOpen(true)}
        className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-gradient-to-r from-blue-600 to-teal-500 hover:from-blue-500 hover:to-teal-400 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-500/20 transition-all duration-200 cursor-pointer"
      >
        <Sparkles size={15} />
        AI HVAC Agent Studio
      </button>

      {/* Instructions */}
      <div className="bg-blue-950/20 border border-blue-900/30 p-3 rounded-xl flex gap-2">
        <ShieldAlert size={16} className="text-blue-500 shrink-0 mt-0.5" />
        <p className="text-[10px] text-blue-400 leading-normal">
          Click on the canvas to place points. Double-click near your first point to close the zone boundary.
        </p>
      </div>

      {/* AI HVAC Assistant Modal */}
      <AiHvacAssistantModal isOpen={isAiModalOpen} onClose={() => setIsAiModalOpen(false)} />
    </div>
  );
};
