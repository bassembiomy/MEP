import type {DxfEntity,DxfLayerInfo} from '../../store/projectStore';
export function groupCadEntitiesForRendering(entities:DxfEntity[],layers:Record<string,DxfLayerInfo>):{key:string;color:string;entities:DxfEntity[]}[] {
 const groups=new Map<string,{key:string;color:string;entities:DxfEntity[]}>();
 for(const entity of entities) {
  const layer=entity.layer??'0';const info=Object.hasOwn(layers,layer)?layers[layer]:undefined;
  if(info?.visible===false || entity.type==='TEXT' || entity.type==='MTEXT')continue;
  const color=entity.color??info?.color??'#94a3b8';const key=JSON.stringify([layer,color]);
  let group=groups.get(key);if(!group){group={key,color,entities:[]};groups.set(key,group);}group.entities.push(entity);
 }
 return [...groups.values()];
}
