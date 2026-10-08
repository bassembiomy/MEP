import {useProjectStore} from '../store/projectStore';
import {STANDARDS_REFERENCES,DEFAULT_STANDARDS_SELECTION,resolveStandardsSelection} from '../engine/standards/profileRegistry';
export function StandardsProfilePanel():React.JSX.Element {
 const {project,setProject}=useProjectStore();const selection=project.standardsSelection??DEFAULT_STANDARDS_SELECTION;
 const profile=resolveStandardsSelection(selection);
 const change=(id:string,checked:boolean)=>{
  const selected=STANDARDS_REFERENCES.find(r=>r.id===id)!;
  const family=(s:string)=>s.replace(/-(?:\d{4}|\d(?:-\d{4})?)$/,'');
  const others=selection.referenceIds.filter(existing=>existing!==id&&(!checked||family(existing)!==family(selected.id)));
  setProject({standardsSelection:{jurisdiction:'EG',referenceIds:checked?[...others,id]:others}});
 };
 return <section className="p-4 border-t border-neutral-800 text-xs space-y-2"><h2 className="font-semibold">Egypt · governing references</h2>
  <p className="text-amber-200">Select project reference editions. Egyptian adoption and normative clauses require verified project documents.</p>
  <details><summary>Reference editions ({selection.referenceIds.length})</summary><div className="space-y-3 mt-2">{STANDARDS_REFERENCES.map(r=><label key={r.id} className="block"><span className="flex gap-2"><input type="checkbox" checked={selection.referenceIds.includes(r.id)} onChange={e=>change(r.id,e.target.checked)}/>{r.publisher} · {r.title} · {r.edition}</span><a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-300 ml-5">Publisher source</a></label>)}</div></details>
  <details><summary>Unresolved standards evidence</summary><ul className="space-y-2 mt-2 text-neutral-400">{profile.unresolved.map(v=><li key={v}>{v}</li>)}</ul></details>
 </section>;
}
