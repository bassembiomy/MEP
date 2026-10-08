import {useState} from 'react';
import {useProjectStore} from '../store/projectStore';
import {recognizeCadRooms} from '../engine/cad/roomRecognition';
import type {CadRoomRecognitionResult,CadRoomCandidate} from '../engine/cad/semanticTypes';
import {ASHRAE_SPACE_TYPES} from '../engine/knowledgeBase';

export function CadUnderstandingPanel():React.JSX.Element|null {
 const {dxfEntities,dxfLayers,project,approveCadRoom,selectZone}=useProjectStore();
 const [layers,setLayers]=useState<string[]>([]);
 const [result,setResult]=useState<CadRoomRecognitionResult|null>(null);
 const [sourceRevision,setSourceRevision]=useState('');
 const [recognitionScale,setRecognitionScale]=useState(0);
 const [selected,setSelected]=useState<CadRoomCandidate|null>(null);
 const [name,setName]=useState('');const [use,setUse]=useState('office');
 const [height,setHeight]=useState(project.units==='metric'?'3.048':'10');
 const [occupants,setOccupants]=useState('1');const [message,setMessage]=useState('');
 if(!dxfEntities.length) return null;
 const recognize=()=>{
  const scale=project.units==='metric'?project.scale*0.3048:project.scale;
  try {
   setResult(recognizeCadRooms(dxfEntities,{drawingUnitsPerFoot:scale,...(layers.length?{layers}: {})}));
   setSourceRevision(JSON.stringify(dxfEntities));setRecognitionScale(scale);setSelected(null);setMessage('');
  } catch(error) {setMessage(error instanceof Error?error.message:'Room recognition failed.');}
 };
 const approve=()=>{
  if(!selected)return;
  const outcome=approveCadRoom(selected,{name,spaceTypeId:use,ceilingHeight:Number(height),occupants:Number(occupants),sourceCadRevision:sourceRevision,drawingUnitsPerFoot:recognitionScale});
  setMessage(outcome.success?'Room approved. Review its inputs, then select a feasible system in the optimizer.':outcome.error??'Approval failed.');
  if(outcome.success) {selectZone(useProjectStore.getState().zones.at(-1)!.id);setSelected(null);}
 };
 return <section className="p-4 border-t border-neutral-800 space-y-3 text-xs">
  <h2 className="font-semibold text-neutral-200">Understand CAD rooms</h2>
  <p className="text-neutral-400">Closed boundaries become review candidates. Select wall layers to inspect joined lines. Door gaps, obstacles and fire ratings require review.</p>
  <fieldset className="max-h-28 overflow-auto space-y-1"><legend className="text-neutral-300 mb-1">Boundary layers</legend>
   {Object.keys(dxfLayers).map(layer=><label key={layer} className="flex gap-2"><input type="checkbox" checked={layers.includes(layer)} onChange={e=>setLayers(e.target.checked?[...layers,layer]:layers.filter(l=>l!==layer))}/>{layer}</label>)}
  </fieldset>
  <button className="w-full bg-blue-700 rounded p-2 disabled:opacity-40" disabled={project.cadUnitsConfirmed===false} onClick={recognize}>Find room candidates</button>
  {project.cadUnitsConfirmed===false&&<p className="text-amber-300">Confirm drawing units above first.</p>}
  {result&&<><p>{result.candidates.length} candidates · boundary evidence requires approval</p>
   <div className="max-h-40 overflow-auto space-y-1">{result.candidates.map((c,i)=><button key={c.id} className={`text-left w-full rounded p-2 ${selected?.id===c.id?'bg-blue-900':'bg-neutral-800'}`} onClick={()=>{setSelected(c);setName(c.name);setMessage('');}}>{c.name||`Room ${i+1}`} · {c.areaSqFt.toFixed(1)} ft²</button>)}</div>
   {result.diagnostics.length>0&&<details><summary>Recognition diagnostics ({result.diagnostics.length})</summary><ul className="space-y-2 mt-2 text-amber-200">{result.diagnostics.map((d,i)=><li key={i}>{d.message}</li>)}</ul></details>}
  </>}
  {selected&&<div className="space-y-2 border border-neutral-700 rounded p-2">
   <svg role="img" aria-label={`Boundary preview for ${selected.name}`} className="w-full h-32 bg-neutral-950 rounded" viewBox={`${Math.min(...selected.polygon.filter((_,i)=>i%2===0))} ${Math.min(...selected.polygon.filter((_,i)=>i%2===1))} ${Math.max(...selected.polygon.filter((_,i)=>i%2===0))-Math.min(...selected.polygon.filter((_,i)=>i%2===0))} ${Math.max(...selected.polygon.filter((_,i)=>i%2===1))-Math.min(...selected.polygon.filter((_,i)=>i%2===1))}`}>
    <polygon points={selected.polygon.reduce((s,v,i)=>s+(i%2?`${v} `:`${v},`),'')} fill="#0f766e66" stroke="#2dd4bf" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
   </svg>
   <p className="text-neutral-400">Sources: {selected.sourceLayers.join(', ')} · boundary confidence {(selected.confidence*100).toFixed(0)}%</p>
   <label className="block">Room name<input className="block bg-neutral-800 p-2 rounded w-full" value={name} onChange={e=>setName(e.target.value)}/></label>
   <label className="block">Room use<select className="block bg-neutral-800 p-2 rounded w-full" value={use} onChange={e=>setUse(e.target.value)}>{ASHRAE_SPACE_TYPES.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
   <label className="block">Ceiling height ({project.units==='metric'?'m':'ft'})<input type="number" min="0" className="block bg-neutral-800 p-2 rounded w-full" value={height} onChange={e=>setHeight(e.target.value)}/></label>
   <label className="block">Design occupants<input type="number" min="0" className="block bg-neutral-800 p-2 rounded w-full" value={occupants} onChange={e=>setOccupants(e.target.value)}/></label>
   <ul className="text-amber-200 space-y-1">{selected.unresolvedConditions.map((v,i)=><li key={i}>{v}</li>)}</ul>
   <button className="w-full bg-teal-700 rounded p-2" onClick={approve}>Approve boundary and room inputs</button>
  </div>}
  {message&&<p role="status" className="text-amber-200">{message}</p>}
 </section>;
}
