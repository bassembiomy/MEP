import {describe,it,expect} from 'vitest';
import {parseKnownLength,measuredDistance,describeCalibration} from '../cad/measureTool';
import {useProjectStore} from '../../store/projectStore';
describe('measure tool helpers',()=>{
 it('parses lengths with units and defaults',()=>{
  expect(parseKnownLength('3.5 m','ft')).toEqual({ok:true,length:3.5,unit:'m'});
  expect(parseKnownLength('12ft','m')).toEqual({ok:true,length:12,unit:'ft'});
  expect(parseKnownLength('250','mm')).toEqual({ok:true,length:250,unit:'mm'});
  expect(parseKnownLength('6 inches','m')).toMatchObject({ok:true,unit:'in'});
  expect(parseKnownLength('0 m','m').ok).toBe(false);expect(parseKnownLength('abc','m').ok).toBe(false);expect(parseKnownLength('3 parsecs','m').ok).toBe(false);
  expect(parseKnownLength('-3 m','m').ok).toBe(false);
 });
 it('measures and describes',()=>{expect(measuredDistance({x:0,y:0},{x:3,y:4})).toBe(5);expect(describeCalibration(5,1,'m')).toMatch(/stale/);});
 it('calibration through the store scales a metric project per metre',()=>{
  useProjectStore.setState({project:{name:'P',location:'Cairo',units:'metric',scale:1,outdoorDb:35,indoorDb:24},zones:[],undoStack:[],redoStack:[]});
  expect(useProjectStore.getState().calibrateScaleFromPoints({x:0,y:0},{x:3000,y:4000},5,'m')).toEqual({success:true});
  expect(useProjectStore.getState().project.scale).toBeCloseTo(1000);
  expect(useProjectStore.getState().calibrateScaleFromPoints({x:1,y:1},{x:1,y:1},5,'m').success).toBe(false);
 });
});
import {snapLastPoint} from '../cad/measureTool';
import {snapPoint} from '../cad/drawingSnap';
describe('snap reference point per tool (F6)',()=>{
 it('measure mode references its first pick, polyline its last vertex, other modes nothing',()=>{
  expect(snapLastPoint('measure',[],[{x:5,y:6}])).toEqual({x:5,y:6});
  expect(snapLastPoint('measure',[1,2],[])).toBeUndefined(); // stray polyline points are not a measure reference
  expect(snapLastPoint('polyline',[0,0,10,20],[{x:5,y:6}])).toEqual({x:10,y:20});
  expect(snapLastPoint('polyline',[],[])).toBeUndefined();
  expect(snapLastPoint('select',[0,0],[{x:1,y:1}])).toBeUndefined();
 });
 it('the ortho preview and the click resolve to the same point',()=>{
  const measurePoints=[{x:0,y:0}],cursor={x:80,y:6},base={stageScale:1,tolerancePx:5,ortho:true,gridSpacing:10};
  const preview=snapPoint(cursor,{...base,lastPoint:snapLastPoint('measure',[],measurePoints)});
  const click=snapPoint(cursor,{...base,lastPoint:measurePoints[0]});
  expect(preview).toEqual(click);expect(preview.point).toEqual({x:80,y:0});
  expect(snapPoint(cursor,{...base,lastPoint:undefined}).point.y).not.toBe(0); // the old preview (empty tempPoints) drifted
 });
});
