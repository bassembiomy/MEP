import type {DxfEntity,DxfLayerInfo} from '../../store/projectStore';
/** The single visibility rule for drawn CAD entities (and therefore for snapping): a layer is hidden only when its info says visible:false. */
export function isCadEntityLayerVisible(entity:DxfEntity,layers:Record<string,DxfLayerInfo>):boolean {
 const layer=entity.layer??'0';const info=Object.hasOwn(layers,layer)?layers[layer]:undefined;
 return info?.visible!==false;
}
/** Entities on visible layers, in input order. Snapping uses this so hidden layers never attract the cursor. */
export const snappableCadEntities=(entities:DxfEntity[],layers:Record<string,DxfLayerInfo>):DxfEntity[]=>entities.filter(e=>isCadEntityLayerVisible(e,layers));
export function groupCadEntitiesForRendering(entities:DxfEntity[],layers:Record<string,DxfLayerInfo>):{key:string;color:string;entities:DxfEntity[]}[] {
 const groups=new Map<string,{key:string;color:string;entities:DxfEntity[]}>();
 for(const entity of entities) {
  const layer=entity.layer??'0';const info=Object.hasOwn(layers,layer)?layers[layer]:undefined;
  if(!isCadEntityLayerVisible(entity,layers) || entity.type==='TEXT' || entity.type==='MTEXT')continue;
  const color=entity.color??info?.color??'#94a3b8';const key=JSON.stringify([layer,color]);
  let group=groups.get(key);if(!group){group={key,color,entities:[]};groups.set(key,group);}group.entities.push(entity);
 }
 return [...groups.values()];
}
