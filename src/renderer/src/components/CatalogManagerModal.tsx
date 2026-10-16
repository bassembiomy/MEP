import React, { useMemo, useRef, useState } from 'react';
import { Database, Download, Trash2, Upload, X, AlertTriangle } from 'lucide-react';
import { useCatalogStore } from '../store/catalogStore';
import { parseCatalogFile, exportCatalogTemplate, CatalogImportError } from '../engine/catalogImport';
import { GENERIC_MODEL_NOTE } from '../engine/hvacCatalogs';
import type { EquipmentCatalogItem } from '../engine/types';

interface CatalogManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CatalogManagerModal: React.FC<CatalogManagerProps> = ({ isOpen, onClose }) => {
  const { catalogs, useGenericEntries, addCatalog, removeCatalog, setCatalogEnabled, setUseGenericEntries } = useCatalogStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<CatalogImportError[]>([]);
  const [status, setStatus] = useState<string>('');
  const [previewId, setPreviewId] = useState<string | null>(null);

  const preview: EquipmentCatalogItem[] = useMemo(() => {
    const c = catalogs.find((x) => x.id === previewId) ?? catalogs[catalogs.length - 1];
    return c ? c.entries : [];
  }, [catalogs, previewId]);

  if (!isOpen) return null;

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isCsv = /\.csv$/i.test(file.name);
    const data = isCsv ? await file.text() : await file.arrayBuffer();
    const res = parseCatalogFile(data, file.name);
    setErrors(res.errors);
    if (res.entries.length > 0) {
      const id = addCatalog(file.name, res.entries);
      setPreviewId(id);
      setStatus(`Imported ${res.entries.length} entr${res.entries.length === 1 ? 'y' : 'ies'} from ${file.name}` + (res.errors.length ? ` (${res.errors.length} issue${res.errors.length === 1 ? '' : 's'} - affected rows skipped)` : ''));
    } else {
      setStatus(`No valid entries found in ${file.name}.`);
    }
  };

  const downloadTemplate = (): void => {
    const blob = new Blob([exportCatalogTemplate()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'equipment-catalog-template.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl max-h-[85vh] bg-neutral-900/95 border border-neutral-750 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-xs">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 bg-neutral-950/80">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30">
              <Database size={14} />
            </div>
            <div>
              <h3 className="font-bold text-neutral-100 text-xs">Equipment Catalogs</h3>
              <p className="text-[10px] text-neutral-400">Import real manufacturer data (.xlsx / .csv) and control which entries the engine uses</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => void onFile(e)} />
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-500 cursor-pointer">
              <Upload size={13} /> Import catalog file
            </button>
            <button onClick={downloadTemplate} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 text-neutral-200 font-semibold hover:bg-neutral-700 cursor-pointer">
              <Download size={13} /> Download template
            </button>
            <label className="flex items-center gap-1.5 ml-auto text-neutral-300 cursor-pointer">
              <input type="checkbox" checked={useGenericEntries} onChange={(e) => setUseGenericEntries(e.target.checked)} />
              Use generic entries (synthetic, not real models)
            </label>
          </div>

          {status && <div className="text-neutral-300">{status}</div>}

          {errors.length > 0 && (
            <div className="border border-amber-500/30 bg-amber-500/10 rounded-xl p-3 max-h-40 overflow-y-auto">
              <div className="flex items-center gap-1.5 text-amber-400 font-bold mb-1">
                <AlertTriangle size={13} /> {errors.length} import issue{errors.length === 1 ? '' : 's'}
              </div>
              <ul className="text-neutral-300 font-mono text-[10px] space-y-0.5">
                {errors.map((er, i) => (
                  <li key={i}>Row {er.row} - {er.field}: {er.message}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="text-[10px] font-bold text-neutral-500 uppercase mb-1">Imported catalogs</div>
            {catalogs.length === 0 ? (
              <div className="text-neutral-500">None yet. Built-in catalog {useGenericEntries ? 'including' : 'excluding'} generic entries is active.</div>
            ) : (
              <ul className="divide-y divide-neutral-800 border border-neutral-800 rounded-xl">
                {catalogs.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                    <input type="checkbox" checked={c.enabled} onChange={(e) => setCatalogEnabled(c.id, e.target.checked)} title="Enabled" />
                    <button onClick={() => setPreviewId(c.id)} className="flex-1 text-left text-neutral-200 hover:text-white cursor-pointer">
                      {c.name} <span className="text-neutral-500">- {c.entries.length} entries, {new Date(c.importedAt).toLocaleDateString()}</span>
                    </button>
                    <button onClick={() => removeCatalog(c.id)} className="p-1 text-neutral-400 hover:text-red-400 cursor-pointer" title="Delete catalog">
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {preview.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-neutral-500 uppercase mb-1">Preview</div>
              <div className="overflow-x-auto border border-neutral-800 rounded-xl">
                <table className="w-full text-left">
                  <thead className="bg-neutral-950 text-neutral-400">
                    <tr>
                      {['Manufacturer', 'Model', 'Type', 'Tons', 'Total Btu/h', 'Sens. Btu/h', 'CFM', 'ESP in.wg', 'L x W x H (in)', 'dB(A)'].map((h) => (
                        <th key={h} className="px-2 py-1.5 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="text-neutral-300">
                    {preview.map((e) => (
                      <tr key={e.id} className="border-t border-neutral-800">
                        <td className="px-2 py-1">{e.manufacturer}</td>
                        <td className="px-2 py-1">{e.model}{e.isGeneric ? <span className="text-amber-400"> {GENERIC_MODEL_NOTE}</span> : null}</td>
                        <td className="px-2 py-1">{e.systemType}</td>
                        <td className="px-2 py-1">{e.nominalTons}</td>
                        <td className="px-2 py-1">{e.totalCapacityBtuPerHour}</td>
                        <td className="px-2 py-1">{e.sensibleCapacityBtuPerHour}</td>
                        <td className="px-2 py-1">{e.nominalCfm}</td>
                        <td className="px-2 py-1">{e.maxRatedEspInWg}</td>
                        <td className="px-2 py-1">{e.dimensionsIn.depth} x {e.dimensionsIn.width} x {e.dimensionsIn.height}</td>
                        <td className="px-2 py-1">{e.soundDba || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
