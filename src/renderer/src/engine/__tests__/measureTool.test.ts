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
