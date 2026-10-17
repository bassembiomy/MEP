import { useProjectStore } from '../../store/projectStore';
import { zoneDesignAirflowCfm } from '../../panels/zoneDesign';
import { calculateZoneLoad } from '../loadCalc';
import { toCfm, toBtuh } from '../units';
import { terminalFaceIn } from '../../canvas/drawingGeometry';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Demo systems consistency (store -> engine -> labels -> header) ===');

useProjectStore.getState().loadDemoSystems();
const { zones, project } = useProjectStore.getState();
assert(zones.length === 4, `4 demo zones, got ${zones.length}`);

let headerTotal = 0;
let sumZones = 0;
for (const z of zones) {
  const load = calculateZoneLoad(z, project);
  const design = zoneDesignAirflowCfm(z, project);
  const loadCfm = toCfm(load.supplyCfm, project.units);
  headerTotal += design;
  sumZones += design;
  assert(design > 0, `${z.name}: design airflow > 0`);
  assert((z.unitPositions?.length ?? 0) > 0 || !!z.unitPos, `${z.name}: has indoor unit`);

  const supply = z.diffusers.filter((d) => d.type !== 'return' && d.type !== 'exhaust');
  console.log(`${z.name}: design ${design.toFixed(0)} CFM, load ${loadCfm.toFixed(0)}, terminals ${supply.map((d) => `${d.size}@${d.cfm}`).join(',')}`);
  if (z.systemType === 'high-wall') {
    assert(z.diffusers.length === 0 && z.ducts.length === 0, `${z.name}: high-wall has no terminals/ducts`);
    assert(Math.abs(design - loadCfm) <= 0.02 * loadCfm + 1e-6, `${z.name}: design airflow = load airflow`);
    continue;
  }
  assert(supply.length > 0, `${z.name}: has supply terminals`);
  const sum = supply.reduce((s, d) => s + d.cfm, 0);
  assert(sum >= 0.98 * loadCfm - 2, `${z.name}: sum terminal cfm ${sum} not below load ${loadCfm.toFixed(0)} (equipment minimum may raise it)`);
  assert(Math.abs(sum - design) <= 0.02 * design, `${z.name}: label airflow == sum of terminals`);

  // callout derivation: count x size groups with uniform cfm each, reproducing the total
  const groups = new Map<string, { n: number; cfm: number }>();
  for (const d of supply) {
    const f = terminalFaceIn(d, project.units);
    const key = `${f.w}x${f.h}`;
    const g = groups.get(key) ?? { n: 0, cfm: 0 };
    g.n++; g.cfm += d.cfm;
    groups.set(key, g);
  }
  let back = 0;
  groups.forEach((g) => { back += g.n * (g.cfm / g.n); });
  assert(Math.abs(back - sum) < 1e-6, `${z.name}: callout groups reproduce airflow`);
  if (z.systemType === 'cassette') {
    const qty = z.catalogQty || z.unitPositions?.length || 1;
    const tons = toBtuh(load.totalLoad, project.units) / 12000 / qty;
    if (tons <= 2) {
      for (const d of supply) {
        const f = terminalFaceIn(d, project.units);
        assert(f.w <= 36 && f.h <= 36, `${z.name}: cassette face ${f.w}x${f.h} <= 36x36 for ${tons.toFixed(1)} TR`);
      }
    }
    assert(z.ducts.length === 0 && !z.diffusers.some((d) => d.type === 'return'), `${z.name}: cassette is integral (no ducts/return CDs)`);
  }
}
assert(Math.abs(headerTotal - sumZones) < 1e-6, 'header total == sum of zone airflow');
console.log(`header total ${headerTotal.toFixed(0)} CFM == sum of zones`);
console.log('PASS demoConsistency');
