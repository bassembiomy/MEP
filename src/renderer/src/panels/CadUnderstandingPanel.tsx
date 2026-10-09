import {useState} from 'react';
import {useProjectStore,selectCeilingHeightSuggestion,type CadRoomRecognitionRun} from '../store/projectStore';
import {CAD_LAYER_ROLES} from '../engine/cad/layerClassification';
import {effectiveLayerClassifications,listCadLevels} from '../engine/cad/cadSemanticState';
import {describeUnitsStatus} from '../engine/cad/unitsDecision';
import type {CadRoomCandidate,CadLayerRole} from '../engine/cad/semanticTypes';
import {ASHRAE_SPACE_TYPES} from '../engine/knowledgeBase';

const pct=(n:number)=>`${(n*100).toFixed(0)}%`;

export function CadUnderstandingPanel():React.JSX.Element|null {
 const s=useProjectStore();
 const {dxfEntities,project,cadImport,cadLayerRoles,cadOpenings,cadObstacles,cadLevel}=s;
 const [run,setRun]=useState<CadRoomRecognitionRun|null>(null);
 const [selected,setSelected]=useState<CadRoomCandidate|null>(null);
 const [name,setName]=useState('');const [use,setUse]=useState('office');
 const [height,setHeight]=useState(project.units==='metric'?'3.048':'10');
 const [suggestionNote,setSuggestionNote]=useState('');
 const [occupants,setOccupants]=useState('1');const [message,setMessage]=useState('');
 const [clearances,setClearances]=useState<Record<string,string>>({});
 const [cal,setCal]=useState({x1:'0',y1:'0',x2:'0',y2:'0',length:'',unit:'m'});
 if(!dxfEntities.length) return null;
 const units=describeUnitsStatus(project,cadImport);
 const roles=effectiveLayerClassifications(cadLayerRoles);
 const lengthUnit=project.units==='metric'?'m':'ft';
 const report=(r:{success:boolean;error?:string},ok:string)=>setMessage(r.success?ok:(r.error??'Action failed.'));
 const recognize=()=>{
  const out=s.recognizeCadRoomCandidates();
  setRun(out.success?out:null);setSelected(null);setMessage(out.success?'':(out.error??'Room recognition failed.'));
 };
 const choose=(c:CadRoomCandidate)=>{
  setSelected(c);setName(c.name);setMessage('');
  const found=selectCeilingHeightSuggestion(useProjectStore.getState(),c);
  if(found.suggestion) {
   setHeight(String(Number(found.suggestion.value.toFixed(3))));
   setSuggestionNote(`Suggested ${found.suggestion.value.toFixed(2)} ${found.suggestion.unit} (${pct(found.suggestion.confidence)} confidence) from drawing text. ${found.suggestion.evidence.join(' ')} Edit it if it is wrong.`);
  } else setSuggestionNote(found.unresolved?`Ceiling annotations are unresolved: ${found.reasons.join(' ')}`:'No ceiling-height annotation found in this room.');
 };
 const approve=()=>{
  if(!selected||!run?.success)return;
  const outcome=s.approveCadRoom(selected,{name,spaceTypeId:use,ceilingHeight:Number(height),occupants:Number(occupants),sourceCadRevision:run.sourceCadRevision!,drawingUnitsPerFoot:run.drawingUnitsPerFoot!,recognitionContext:run.recognitionContext!});
  setMessage(outcome.success?'Room approved. Review its inputs, then select a feasible system in the optimizer.':outcome.error??'Approval failed.');
  if(outcome.success) {s.selectZone(useProjectStore.getState().zones.at(-1)!.id);setSelected(null);}
 };
 const calibrate=()=>{
  const r=s.calibrateScaleFromPoints({x:Number(cal.x1),y:Number(cal.y1)},{x:Number(cal.x2),y:Number(cal.y2)},Number(cal.length),cal.unit as 'mm'|'cm'|'m'|'in'|'ft');
  report(r,'Scale calibrated and units confirmed.');
 };
 const levels=listCadLevels(dxfEntities);
 return <section className="p-4 border-t border-neutral-800 space-y-3 text-xs">
  <h2 className="font-semibold text-neutral-200">Understand CAD drawing</h2>
  <p className="text-neutral-400">Everything below is a suggestion until you approve it. Layer roles, door gaps and obstacles never change a design on their own.</p>

  <div className={`rounded border p-2 space-y-1 ${units.confirmed?'border-neutral-700':'border-amber-700'}`}>
   <p className={units.confirmed?'text-neutral-300':'text-amber-300'}>{units.label}</p>
   {units.reasons.map((r,i)=><p key={i} className="text-amber-200">{r}</p>)}
   {!units.confirmed&&<button className="w-full bg-amber-700 rounded p-2" onClick={()=>s.setProject({cadUnitsConfirmed:true})}>Confirm selected units and scale</button>}
   <details><summary className="cursor-pointer text-neutral-300">Calibrate scale from a known length</summary>
    <div className="grid grid-cols-2 gap-1 mt-2">
     {(['x1','y1','x2','y2'] as const).map(k=><label key={k}>Point {k}<input type="number" className="block bg-neutral-800 p-1 rounded w-full" value={cal[k]} onChange={e=>setCal({...cal,[k]:e.target.value})}/></label>)}
     <label>Known length<input type="number" min="0" className="block bg-neutral-800 p-1 rounded w-full" value={cal.length} onChange={e=>setCal({...cal,length:e.target.value})}/></label>
     <label>Unit<select className="block bg-neutral-800 p-1 rounded w-full" value={cal.unit} onChange={e=>setCal({...cal,unit:e.target.value})}>{['mm','cm','m','in','ft'].map(u=><option key={u}>{u}</option>)}</select></label>
    </div>
    <button className="w-full bg-neutral-700 rounded p-2 mt-2" onClick={calibrate}>Apply calibration</button>
   </details>
  </div>

  {levels.length>1&&<label className="block">Level (elevation)<select className="block bg-neutral-800 p-2 rounded w-full" value={cadLevel} onChange={e=>report(s.setCadLevel(Number(e.target.value)),'')}>
   {levels.map(l=><option key={l} value={l}>{l}</option>)}</select></label>}

  <details open><summary className="cursor-pointer text-neutral-200">Layer roles ({roles.length})</summary>
   <ul className="max-h-48 overflow-auto space-y-2 mt-2">{roles.map(c=><li key={c.layer} className="bg-neutral-900 rounded p-2">
    <div className="flex gap-2 items-center"><span className="flex-1 truncate" title={c.layer}>{c.layer}</span>
     <select aria-label={`Role of ${c.layer}`} className="bg-neutral-800 p-1 rounded" value={c.role} onChange={e=>report(s.setCadLayerRole(c.layer,e.target.value as CadLayerRole),'')}>
      {CAD_LAYER_ROLES.map(r=><option key={r} value={r}>{r}</option>)}</select>
     {c.source==='user'&&<button className="text-neutral-400 underline" onClick={()=>s.setCadLayerRole(c.layer,null)}>reset</button>}</div>
    <p className="text-neutral-400">{c.source==='user'?'Your choice':`Suggested, ${pct(c.confidence)} confidence`}</p>
    {c.evidence.length>0&&<p className="text-neutral-500">{c.evidence.join(' ')}</p>}
    {c.conflicts.length>0&&<p className="text-amber-200">{c.conflicts.join(' ')}</p>}
   </li>)}</ul>
  </details>

  <details><summary className="cursor-pointer text-neutral-200">Openings ({cadOpenings.length})</summary>
   <ul className="max-h-48 overflow-auto space-y-2 mt-2">{cadOpenings.map(o=><li key={o.id} className="bg-neutral-900 rounded p-2">
    <p>{o.kind} · {o.widthFt.toFixed(1)} ft · {pct(o.confidence)} · <strong>{o.status}</strong></p>
    <p className="text-neutral-500">{o.evidence.join(' ')}</p>
    <div className="flex gap-2 mt-1"><button className="bg-teal-800 rounded px-2 py-1" onClick={()=>report(s.approveCadOpening(o.id),'')}>Approve</button>
     <button className="bg-neutral-700 rounded px-2 py-1" onClick={()=>report(s.rejectCadOpening(o.id),'')}>Reject</button></div>
   </li>)}</ul>
  </details>

  <details><summary className="cursor-pointer text-neutral-200">Obstacles ({cadObstacles.length})</summary>
   <ul className="max-h-56 overflow-auto space-y-2 mt-2">{cadObstacles.map(o=><li key={o.id} className="bg-neutral-900 rounded p-2">
    <p>{o.shape} · {o.widthFt.toFixed(1)} × {o.depthFt.toFixed(1)} ft · {pct(o.confidence)} · <strong>{o.status}{o.clearanceFt!==undefined?` · clearance ${o.clearanceFt} ft`:''}</strong></p>
    <p className="text-neutral-500">{o.evidence.join(' ')}</p>
    <div className="flex gap-2 mt-1 items-center">
     <label>Clearance (ft)<input type="number" min="0" step="0.1" className="bg-neutral-800 p-1 rounded w-20 ml-1" value={clearances[o.id]??String(o.clearanceFt??1)} onChange={e=>setClearances({...clearances,[o.id]:e.target.value})}/></label>
     <button className="bg-teal-800 rounded px-2 py-1" onClick={()=>report(s.approveCadObstacle(o.id,Number(clearances[o.id]??o.clearanceFt??1)),'')}>Approve</button>
     <button className="bg-neutral-700 rounded px-2 py-1" onClick={()=>report(s.rejectCadObstacle(o.id),'')}>Reject</button></div>
   </li>)}</ul>
  </details>

  <h3 className="font-semibold text-neutral-200">Room candidates</h3>
  <p className="text-neutral-400">Boundary layers: {run?.wallLayers?.length?run.wallLayers.join(', '):'none confirmed (closed polylines only). Set a layer role to “wall” above to use its lines.'} · approved openings close door gaps.</p>
  <button className="w-full bg-blue-700 rounded p-2 disabled:opacity-40" disabled={project.cadUnitsConfirmed===false} onClick={recognize}>Find room candidates</button>
  {run?.result&&<><p>{run.result.candidates.length} candidates · boundary evidence requires approval</p>
   <div className="max-h-40 overflow-auto space-y-1">{run.result.candidates.map((c,i)=><button key={c.id} className={`text-left w-full rounded p-2 ${selected?.id===c.id?'bg-blue-900':'bg-neutral-800'}`} onClick={()=>choose(c)}>{c.name||`Room ${i+1}`} · {c.areaSqFt.toFixed(1)} ft²</button>)}</div>
   {run.result.diagnostics.length>0&&<details><summary>Recognition diagnostics ({run.result.diagnostics.length})</summary><ul className="space-y-2 mt-2 text-amber-200">{run.result.diagnostics.map((d,i)=><li key={i}>{d.message}</li>)}</ul></details>}
  </>}
  {selected&&<div className="space-y-2 border border-neutral-700 rounded p-2">
   <svg role="img" aria-label={`Boundary preview for ${selected.name}`} className="w-full h-32 bg-neutral-950 rounded" viewBox={`${Math.min(...selected.polygon.filter((_,i)=>i%2===0))} ${Math.min(...selected.polygon.filter((_,i)=>i%2===1))} ${Math.max(...selected.polygon.filter((_,i)=>i%2===0))-Math.min(...selected.polygon.filter((_,i)=>i%2===0))} ${Math.max(...selected.polygon.filter((_,i)=>i%2===1))-Math.min(...selected.polygon.filter((_,i)=>i%2===1))}`}>
    <polygon points={selected.polygon.reduce((acc,v,i)=>acc+(i%2?`${v} `:`${v},`),'')} fill="#0f766e66" stroke="#2dd4bf" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
   </svg>
   <p className="text-neutral-400">Sources: {selected.sourceLayers.join(', ')} · boundary confidence {pct(selected.confidence)}</p>
   <label className="block">Room name<input className="block bg-neutral-800 p-2 rounded w-full" value={name} onChange={e=>setName(e.target.value)}/></label>
   <label className="block">Room use<select className="block bg-neutral-800 p-2 rounded w-full" value={use} onChange={e=>setUse(e.target.value)}>{ASHRAE_SPACE_TYPES.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
   <label className="block">Ceiling height ({lengthUnit})<input type="number" min="0" className="block bg-neutral-800 p-2 rounded w-full" value={height} onChange={e=>setHeight(e.target.value)}/></label>
   {suggestionNote&&<p className="text-neutral-400">{suggestionNote}</p>}
   <label className="block">Design occupants<input type="number" min="0" className="block bg-neutral-800 p-2 rounded w-full" value={occupants} onChange={e=>setOccupants(e.target.value)}/></label>
   <ul className="text-amber-200 space-y-1">{selected.unresolvedConditions.map((v,i)=><li key={i}>{v}</li>)}</ul>
   <button className="w-full bg-teal-700 rounded p-2" onClick={approve}>Approve boundary and room inputs</button>
  </div>}
  {message&&<p role="status" className="text-amber-200">{message}</p>}
 </section>;
}
