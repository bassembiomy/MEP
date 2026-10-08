import assert from 'node:assert/strict';
import {it} from 'node:test';
import {useProjectStore} from '../../store/projectStore';
it('adds an L-shaped draft immediately and rejects an unverified fan route atomically',async()=>{
 useProjectStore.setState({zones:[],selectedZoneId:null,project:{name:'L test',location:'Cairo',units:'imperial',scale:10,outdoorDb:95,indoorDb:75}});
 const points=[100,100,400,100,400,250,250,250,250,400,100,400];
 assert.doesNotThrow(()=>useProjectStore.getState().addZone(points));
 assert.equal(useProjectStore.getState().zones.length,1);
 await new Promise(resolve=>setTimeout(resolve,50));
 const room=useProjectStore.getState().zones[0];
 assert.deepEqual(room.points,points);
 assert.equal(room.engineeringStatus,'blocked','This fixture has no fan-feasible default deployment; it must remain blocked');
 assert.match(room.engineeringError??'',/pressure|fan/i,'The real engineering cause must be actionable');
 assert.deepEqual(room.diffusers,[]);assert.deepEqual(room.ducts,[]);
 assert.equal(room.unitPos,undefined,'A failed transaction must not apply partial equipment');
});
