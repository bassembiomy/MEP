import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestCadUnitsFromSpan,
  cadUnitsFromInsUnits
} from '../dxfParser';

describe('CAD Unit Detection Helpers (shared by DXF & DWG import paths)', () => {
  it('maps AutoCAD $INSUNITS codes to drawing units and scales', () => {
    assert.deepEqual(cadUnitsFromInsUnits(4), {
      cadUnit: 'mm',
      suggestedScaleImperial: 304.8,
      suggestedScaleMetric: 1000
    });
    assert.deepEqual(cadUnitsFromInsUnits(1), {
      cadUnit: 'in',
      suggestedScaleImperial: 12,
      suggestedScaleMetric: 1 / 0.0254
    });
    assert.deepEqual(cadUnitsFromInsUnits(6), {
      cadUnit: 'm',
      suggestedScaleImperial: 0.3048,
      suggestedScaleMetric: 1
    });
    assert.equal(cadUnitsFromInsUnits(undefined), null);
    assert.equal(cadUnitsFromInsUnits(0), null);
  });

  it('deduces millimeters from a typical building span (e.g. 5000 units)', () => {
    const r = suggestCadUnitsFromSpan(5000);
    assert.equal(r.cadUnit, 'mm');
    assert.equal(r.suggestedScaleImperial, 304.8);
  });

  it('deduces millimeters from a single-room mm plan (span 1500 < 2000)', () => {
    // Regression: whole-plan assumption broke small mm drawings -> inches misfire
    const r = suggestCadUnitsFromSpan(1500);
    assert.equal(r.cadUnit, 'mm');
    assert.equal(r.suggestedScaleImperial, 304.8);
  });

  it('keeps legacy detections: inches for 250-999 span, feet for small spans', () => {
    assert.equal(suggestCadUnitsFromSpan(600).cadUnit, 'in');
    assert.equal(suggestCadUnitsFromSpan(50).cadUnit, 'ft');
  });
});
