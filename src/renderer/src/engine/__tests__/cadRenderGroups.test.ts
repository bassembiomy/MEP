import {it,expect} from 'vitest';
import {groupCadEntitiesForRendering} from '../cad/renderGroups';
it('retains native per-entity colors within visible layers',()=>{
 const entities=[{type:'LINE' as const,x:0,y:0,points:[1,1],layer:'Walls',color:'#ff0000'},{type:'LINE' as const,x:0,y:0,points:[2,2],layer:'Walls',color:'#00ff00'},{type:'LINE' as const,x:0,y:0,points:[3,3],layer:'Walls'}];
 const groups=groupCadEntitiesForRendering(entities,{Walls:{name:'Walls',visible:true,count:3,color:'#abcdef'}});
 expect(groups.map(g=>g.color)).toEqual(['#ff0000','#00ff00','#abcdef']);
 expect(groupCadEntitiesForRendering(entities,{Walls:{name:'Walls',visible:false,count:3}})).toEqual([]);
});
