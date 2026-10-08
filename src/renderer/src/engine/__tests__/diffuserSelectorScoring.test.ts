import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectBestDiffuserFromCatalog } from '../diffuserPlacer';

describe('Diffuser catalog selection must respect the database performance tables', () => {
  it('selects the healthy operating point at ~300 CFM (12x12, good throw, NC within limit)', () => {
    const s = selectBestDiffuserFromCatalog(300, 32);
    assert.equal(s.diffuser.id, 'dif-sq-12x12');
    assert.equal(s.actualNc, 26, 'Must use the real NC from the DB table at 300 CFM');
    assert.equal(s.throwT50Ft, 14, 'Must use the real T50 throw from the DB table at 300 CFM');
    assert.ok(s.throwT50Ft >= 10, 'Selected terminal must have meaningful throw for distribution');
  });

  it('never fabricates default data when flow is below every catalog minimum', () => {
    const s = selectBestDiffuserFromCatalog(26, 32);
    // Must return a REAL table point from the smallest terminal (9x9 @ 50-75 CFM row),
    // not the legacy fabricated defaults (NC 25 / T50 10).
    assert.notEqual(s.actualNc, 25, 'Fallback NC25 is fabricated data');
    assert.notEqual(s.throwT50Ft, 10, 'Fallback T50=10 is fabricated data');
    assert.ok(s.diffuser.performanceTable.some((p) => p.ncRating === s.actualNc && p.throwFt.t50 === s.throwT50Ft),
      'Returned NC/throw pair must exist in the catalog performance table');
  });

  it('returns real table data for flows above every catalog maximum', () => {
    const s = selectBestDiffuserFromCatalog(4035, 32);
    assert.ok(s.diffuser.performanceTable.some((p) => p.ncRating === s.actualNc && p.throwFt.t50 === s.throwT50Ft),
      'Returned NC/throw pair must exist in the catalog performance table');
    // It must pick the largest available terminal, not a tiny one
    assert.ok(s.diffuser.maxCfm >= 2000, 'Should clamp to the largest catalog terminal for huge flows');
  });

  it('prefers adequate throw among NC-compliant candidates at mid-range flows', () => {
    // 500 CFM: several terminals qualify; the chosen one must come from a real
    // table row with NC <= limit and the best available throw.
    const s = selectBestDiffuserFromCatalog(500, 32);
    assert.ok(s.actualNc <= 32, `NC must be within the space limit, got ${s.actualNc}`);
    assert.ok(s.throwT50Ft >= 10, `Throw must be adequate (>=10ft), got ${s.throwT50Ft}`);
    assert.ok(s.diffuser.performanceTable.some((p) => p.ncRating === s.actualNc && p.throwFt.t50 === s.throwT50Ft));
  });
});
