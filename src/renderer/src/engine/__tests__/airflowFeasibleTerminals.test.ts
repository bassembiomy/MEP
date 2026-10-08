import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { placeDiffusersWithCircularOptimization } from '../diffuserPlacer';

const SCALE = 304.8; // mm CAD drawing
// ~9,000 sqft floor plate drawn in millimeters (user's scenario)
const ZONE = (() => {
  const side = Math.round(Math.sqrt(9000) * SCALE);
  return [0, 0, side, 0, side, -side, 0, -side];
})();
const TOTAL_CFM = 4035;

describe('Terminal count is airflow-driven and lands in the healthy catalog band', () => {
  it('sizes the user zone to ~13-20 terminals at 200-400 CFM each', () => {
    const placed = placeDiffusersWithCircularOptimization(
      ZONE, TOTAL_CFM, true, 10, SCALE, [], 'concealed', 141015,
      { coverageTargetPercent: 100, spaceNcLimit: 32, throwRadiusMode: 'catalog-t50' }
    );
    const supplies = placed.filter((d) => d.type !== 'return');
    const perDiffuser = TOTAL_CFM / supplies.length;

    assert.ok(
      supplies.length >= Math.ceil(TOTAL_CFM / 400) && supplies.length <= Math.floor(TOTAL_CFM / 200),
      `Expected ${Math.ceil(TOTAL_CFM / 400)}-${Math.floor(TOTAL_CFM / 200)} supply terminals for ${TOTAL_CFM} CFM, got ${supplies.length}`
    );
    assert.ok(
      perDiffuser >= 200 && perDiffuser <= 400,
      `Per-diffuser airflow must sit in the healthy catalog band (200-400 CFM), got ${perDiffuser.toFixed(1)}`
    );
  });

  it('assigns every terminal a real catalog operating point (throw >= 8ft, no fabricated data)', () => {
    const placed = placeDiffusersWithCircularOptimization(
      ZONE, TOTAL_CFM, true, 10, SCALE, [], 'concealed', 141015,
      { coverageTargetPercent: 100, spaceNcLimit: 32, throwRadiusMode: 'catalog-t50' }
    );
    const supplies = placed.filter((d) => d.type !== 'return');
    for (const d of supplies) {
      assert.ok(
        (d.throwT50Ft ?? 0) >= 8,
        `Terminal ${d.id} has throw ${d.throwT50Ft}ft — unusable distribution (DB not respected)`
      );
      assert.ok(
        d.actualNc === undefined || d.actualNc <= 32,
        `Terminal ${d.id} NC ${d.actualNc} exceeds the space limit of 32`
      );
    }
  });

  it('ignores CAD detail circles (mm-sized noise) as terminal candidates', () => {
    const dxfEntities: any[] = [];
    for (let i = 0; i < 200; i++) {
      dxfEntities.push({
        type: 'CIRCLE',
        x: (i % 15) * 6000 + 500,
        y: -Math.floor(i / 15) * 5700 - 500,
        radius: 10, // 10 mm detail circle, NOT a diffuser
        layer: 'M-CEIL'
      });
    }
    const placed = placeDiffusersWithCircularOptimization(
      ZONE, TOTAL_CFM, true, 10, SCALE, dxfEntities, 'concealed', 141015,
      { coverageTargetPercent: 100, spaceNcLimit: 32, throwRadiusMode: 'catalog-t50' }
    );
    const supplies = placed.filter((d) => d.type !== 'return');
    assert.ok(
      supplies.length <= Math.floor(TOTAL_CFM / 200),
      `CAD noise must not inflate terminal count, got ${supplies.length}`
    );
  });

  it('still snaps to genuine CAD diffuser symbols (radius plausible for a real terminal)', () => {
    const room = [0, 0, 6000, 0, 6000, 4000, 0, 4000];
    const cadDiffusers = [
      { type: 'CIRCLE', x: 1500, y: 1000, radius: 0.5 * SCALE, layer: 'M-DIFF' },
      { type: 'CIRCLE', x: 4500, y: 3000, radius: 0.5 * SCALE, layer: 'M-DIFF' }
    ];
    const placed = placeDiffusersWithCircularOptimization(
      room, 400, true, 10, SCALE, cadDiffusers, 'concealed', 12000,
      { coverageTargetPercent: 95, spaceNcLimit: 32, throwRadiusMode: 'catalog-t50' }
    );
    const supplies = placed.filter((d) => d.type !== 'return');
    assert.equal(supplies.length, 2, 'Should adopt the 2 genuine CAD diffuser symbols');
    assert.ok(
      supplies.some((d) => Math.abs(d.x - 1500) < 1 && Math.abs(d.y - 1000) < 1),
      'First terminal should sit on the CAD symbol position'
    );
  });
});
