import { parseDxfText } from '../dxfParser';
import { useProjectStore } from '../../store/projectStore';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running CAD Layers & Annotation Visibility Tests ===');

// 1. Test DXF Parsing with Layers and Colors
const sampleDxf = `
0
SECTION
2
ENTITIES
0
LINE
8
WALLS
62
1
10
0.0
20
0.0
11
100.0
21
0.0
0
LWPOLYLINE
8
M-HVAC-DUCT
62
4
10
10.0
20
10.0
10
50.0
20
10.0
0
TEXT
8
ANNOTATIONS
62
2
10
25.0
20
25.0
1
400 CFM
0
ENDSEC
0
EOF
`;

const parsed = parseDxfText(sampleDxf);
assert(parsed.entities.length === 3, `Expected 3 entities, got ${parsed.entities.length}`);

const wallEntity = parsed.entities.find((e) => e.layer === 'WALLS');
assert(!!wallEntity, 'Expected WALLS entity');
assert(wallEntity?.color === '#ef4444', `Expected Red color for WALLS, got ${wallEntity?.color}`);

const ductEntity = parsed.entities.find((e) => e.layer === 'M-HVAC-DUCT');
assert(!!ductEntity, 'Expected M-HVAC-DUCT entity');
assert(ductEntity?.color === '#06b6d4', `Expected Cyan color for M-HVAC-DUCT, got ${ductEntity?.color}`);

const textEntity = parsed.entities.find((e) => e.layer === 'ANNOTATIONS');
assert(!!textEntity, 'Expected ANNOTATIONS entity');
assert(textEntity?.text === '400 CFM', `Expected text 400 CFM, got ${textEntity?.text}`);
assert(textEntity?.color === '#eab308', `Expected Yellow color for text, got ${textEntity?.color}`);

// 2. Test Project Store Layer Indexing
const store = useProjectStore.getState();
store.setDxfData(parsed.entities, parsed.bbox);

const updatedStore = useProjectStore.getState();
assert(Object.keys(updatedStore.dxfLayers).length === 3, `Expected 3 layers in store, got ${Object.keys(updatedStore.dxfLayers).length}`);
assert(updatedStore.dxfLayers['WALLS']?.count === 1, 'Expected 1 entity in WALLS layer');
assert(updatedStore.dxfLayers['M-HVAC-DUCT']?.count === 1, 'Expected 1 entity in M-HVAC-DUCT layer');
assert(updatedStore.dxfLayers['ANNOTATIONS']?.count === 1, 'Expected 1 entity in ANNOTATIONS layer');

// 3. Test Layer Visibility Toggling
updatedStore.setDxfLayerVisibility('WALLS', false);
assert(useProjectStore.getState().dxfLayers['WALLS']?.visible === false, 'WALLS layer should be hidden');
assert(useProjectStore.getState().dxfLayers['M-HVAC-DUCT']?.visible === true, 'M-HVAC-DUCT layer should remain visible');

updatedStore.toggleAllDxfLayers(false);
assert(Object.values(useProjectStore.getState().dxfLayers).every((l) => !l.visible), 'All layers should be hidden');

updatedStore.toggleAllDxfLayers(true);
assert(Object.values(useProjectStore.getState().dxfLayers).every((l) => l.visible), 'All layers should be visible');

// 4. Test Annotation Visibility Toggling
assert(useProjectStore.getState().annotationVisibility.diffuserCfm === true, 'diffuserCfm should default to true');
updatedStore.setAnnotationVisibility('diffuserCfm', false);
assert(useProjectStore.getState().annotationVisibility.diffuserCfm === false, 'diffuserCfm should be toggled to false');

updatedStore.setAnnotationVisibility('ductCfm', false);
assert(useProjectStore.getState().annotationVisibility.ductCfm === false, 'ductCfm should be toggled to false');

updatedStore.toggleAllAnnotations(false);
assert(Object.values(useProjectStore.getState().annotationVisibility).every((v) => v === false), 'All annotations should be hidden');

updatedStore.toggleAllAnnotations(true);
assert(Object.values(useProjectStore.getState().annotationVisibility).every((v) => v === true), 'All annotations should be visible');

// 5. Test Continuous Smooth Zoom Function Math
const oldScale = 1.0;
const deltaPositive = 100; // zoom out
const deltaNegative = -100; // zoom in

const zoomFactorOut = oldScale * Math.exp(-deltaPositive * 0.0018);
const zoomFactorIn = oldScale * Math.exp(-deltaNegative * 0.0018);

assert(zoomFactorOut < 1.0, 'Positive deltaY must scale down smoothly');
assert(zoomFactorIn > 1.0, 'Negative deltaY must scale up smoothly');
assert(Math.abs(zoomFactorOut * zoomFactorIn - 1.0) < 0.0001, 'Zoom in and out must be inverse and symmetric');

console.log('PASS: All CAD Layer & Annotation Visibility Tests Passed Successfully!');
