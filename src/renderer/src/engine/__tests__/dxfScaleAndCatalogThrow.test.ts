import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDxfText } from '../dxfParser';
import { placeDiffusersWithCircularOptimization, calculateZoneDiffuserCoverage } from '../diffuserPlacer';

describe('DXF Scale Auto-Detection & Aerodynamic Catalog Throw Coverage Tests', () => {
  it('correctly detects millimeters ($INSUNITS 4) and sets 304.8 units/ft scale', () => {
    const dxfMm = `
  0
SECTION
  2
HEADER
  9
$INSUNITS
 70
     4
  0
ENDSEC
  0
SECTION
  2
ENTITIES
  0
LINE
  8
WALLS
 10
0.0
 20
0.0
 11
6000.0
 21
4000.0
  0
ENDSEC
  0
EOF
`;
    const parsed = parseDxfText(dxfMm);
    assert.equal(parsed.cadUnit, 'mm');
    assert.equal(parsed.suggestedScaleImperial, 304.8);
    assert.equal(parsed.suggestedScaleMetric, 1000);
  });

  it('correctly detects inches ($INSUNITS 1) and sets 12 units/ft scale', () => {
    const dxfInches = `
  0
SECTION
  2
HEADER
  9
$INSUNITS
 70
     1
  0
ENDSEC
  0
SECTION
  2
ENTITIES
  0
LINE
  8
WALLS
 10
0.0
 20
0.0
 11
240.0
 21
180.0
  0
ENDSEC
  0
EOF
`;
    const parsed = parseDxfText(dxfInches);
    assert.equal(parsed.cadUnit, 'in');
    assert.equal(parsed.suggestedScaleImperial, 12);
  });

  it('correctly deduces millimeter units from drawing span when INSUNITS is omitted', () => {
    const dxfLargeSpan = `
  0
SECTION
  2
ENTITIES
  0
LINE
  8
WALLS
 10
0.0
 20
0.0
 11
12000.0
 21
8000.0
  0
ENDSEC
  0
EOF
`;
    const parsed = parseDxfText(dxfLargeSpan);
    assert.equal(parsed.cadUnit, 'mm');
    assert.equal(parsed.suggestedScaleImperial, 304.8);
  });

  it('generates diffuser throw circles scaled to DXF millimeters that achieve full space coverage', () => {
    // 6000mm x 4000mm room (~19.7ft x 13.1ft = 258 sq ft)
    const roomPointsMm = [
      0, 0,
      6000, 0,
      6000, 4000,
      0, 4000
    ];
    const scaleMm = 304.8; // 304.8 mm per foot
    const totalCfm = 400; // ~400 CFM for 258 sq ft

    const diffusers = placeDiffusersWithCircularOptimization(
      roomPointsMm,
      totalCfm,
      true,
      10,
      scaleMm,
      [],
      'concealed',
      12000,
      {
        coverageTargetPercent: 95,
        pattern: 'hexagonal',
        throwRadiusMode: 'catalog-t50'
      }
    );

    const supplyDiffusers = diffusers.filter(d => d.type !== 'return');
    // Airflow-first sizing: 400 CFM -> 1 terminal inside the healthy 200-400 CFM
    // band is the correct design (a single 18" swirl at NC30/T23 covers 258 sq ft).
    assert.ok(supplyDiffusers.length >= 1, 'Should place at least 1 supply diffuser');

    // Each supply diffuser should have positive catalog throw T50
    supplyDiffusers.forEach(d => {
      assert.ok(d.throwT50Ft && d.throwT50Ft >= 6, `Diffuser ${d.id} should have valid aerodynamic catalog throw, got ${d.throwT50Ft}`);
    });

    // Coverage evaluation in DXF millimeter coordinate space
    const coverage = calculateZoneDiffuserCoverage(roomPointsMm, diffusers, scaleMm, true);
    console.log(`DXF Millimeter space coverage: ${coverage.coveragePercent}% with ${diffusers.length} diffusers`);
    assert.ok(coverage.coveragePercent >= 95.0, `Coverage in DXF mm space must be >= 95%, got ${coverage.coveragePercent}%`);
  });
});
