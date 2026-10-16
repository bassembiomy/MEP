/**
 * Engine residuals: explicit duct data flow (no hidden module state), non-convex (U) rooms, user unit-count
 * override surfacing, scoped recalculation with locked terminals, determinism.
 *
 * Run: npx -y tsx src/renderer/src/engine/__tests__/engineResiduals.test.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  executeAirDistributionDesign,
  recalculateScopedOverride,
  AirDistributionDesignResult
} from '../airDistributionEngine';
import { evaluateUnitCountOption, optimizeMultiUnitCandidates } from '../systemArchitecture/equipmentOptimizer';
import { partitionRoomIntoServiceZones, splitPolygonComponents } from '../zoning/zonePartitioner';
import { isPointInPolygon, distanceToPolygonEdge } from '../geometry';
import { routeSteppedSupplyDucts, ductSegments } from '../ducts/steppedDuctRouter';
import { routeReturnDucts } from '../ducts/returnDuctRouter';
import { collinearOverlap } from '../ducts/orthogonalTopology';
import { placeSupplyDiffusersForZone } from '../terminals/terminalPlacer';
import { placeReturnGrillesForZone } from '../terminals/returnPlacer';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

const segInside = (a: { x: number; y: number }, b: { x: number; y: number }, poly: number[]): boolean => {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.25));
  for (let i = 0; i <= n; i++) {
    const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n;
    if (!isPointInPolygon(x, y, poly) && distanceToPolygonEdge(x, y, poly) > 0.05) return false;
  }
  return true;
};

console.log('=== Engine residuals ===');

// ── 1. No hidden WeakMap coupling in the duct routers ──
{
  const dir = join(__dirname, '..', 'ducts');
  for (const f of ['steppedDuctRouter.ts', 'returnDuctRouter.ts', 'orthogonalTopology.ts']) {
    const src = readFileSync(join(dir, f), 'utf8');
    assert(!/WeakMap/.test(src), `${f} must not keep module-level WeakMap state`);
  }
  console.log('✔ No WeakMap in duct routers');
}

// ── 2. Routers are pure: same inputs -> same output regardless of earlier calls; avoidSegments is honoured ──
{
  const room = [0, 0, 50, 0, 50, 30, 0, 30];
  const zones = partitionRoomIntoServiceZones({
    roomName: 'R', roomPolygon: room, unitCount: 2, selectedModel: 'x', nominalTonnage: 6, totalCapacityBtu: 72000,
    totalSensibleBtu: 54000, totalLatentBtu: 12000, totalSupplyCfm: 2400, totalOutdoorAirCfm: 300, availableEspInWg: 0.5
  });
  const z = zones[0];
  const sup = placeSupplyDiffusersForZone(z, { optimizeThrow: true });
  const ret = placeReturnGrillesForZone(z, sup);
  const a1 = JSON.stringify(routeSteppedSupplyDucts(z, sup));
  routeReturnDucts(z, ret);
  const a2 = JSON.stringify(routeSteppedSupplyDucts(z, sup));
  assert(a1 === a2, 'supply routing must not depend on previous calls');
  const supplySegs = ductSegments(routeSteppedSupplyDucts(z, sup));
  const r1 = routeReturnDucts(z, ret, undefined, supplySegs);
  const clash = r1.some((rs) => supplySegs.some((ss) => collinearOverlap({ start: rs.startPoint, end: rs.endPoint }, ss, 0.5) > 0.01));
  assert(!clash, 'return routed with avoidSegments must not run on the supply network');
  console.log('✔ Routers pure + avoidSegments honoured');
}

// ── 3. U-shaped room 40 x 30 ft with 13-ft legs: split components, everything inside, everything served ──
{
  const U = [0, 0, 40, 0, 40, 30, 27, 30, 27, 13, 13, 13, 13, 30, 0, 30];
  const comps = splitPolygonComponents([0, 19.98, 40, 19.98, 40, 30, 27, 30, 27, 19.98, 13, 19.98, 13, 30, 0, 30]);
  assert(comps.length === 2, `self-touching ring must split into 2 components, got ${comps.length}`);

  for (const wall of ['east', 'west', 'north', 'south'] as const) {
    const input = {
      roomName: 'U', roomPolygon: U, roomAreaSqFt: 40 * 30 - 14 * 17, sensibleLoadBtu: 60000, totalLoadBtu: 80000,
      requiredCfm: 2800, mountingWallSide: wall
    };
    const opt = optimizeMultiUnitCandidates({ ...input, roomName: 'U' });
    const d = executeAirDistributionDesign(input);
    assert(d.serviceZones.length === opt.recommendedOption.unitCount, `${wall}: unit count must stay the optimizer's (${opt.recommendedOption.unitCount}), got ${d.serviceZones.length}`);
    for (const z of d.serviceZones) {
      assert(splitPolygonComponents(z.serviceAreaPolygon).length === 1, `${wall}: ${z.id} bay must be one connected polygon`);
      assert(isPointInPolygon(z.equipmentPosition.x, z.equipmentPosition.y, U), `${wall}: unit ${z.id} inside room`);
    }
    const ducts = [...d.supplyDucts, ...d.returnDucts];
    for (const s of ducts) assert(segInside(s.startPoint, s.endPoint, U), `${wall}: duct ${s.id} leaves the room`);
    for (const t of [...d.supplyTerminals, ...d.returnTerminals]) {
      assert(isPointInPolygon(t.position.x, t.position.y, U), `${wall}: terminal ${t.id} outside room`);
    }
    const served = new Set<string>();
    for (const s of d.supplyDucts) (s.connectedDiffusers ?? []).forEach((id) => served.add(id));
    for (const t of d.supplyTerminals) assert(served.has(t.id), `${wall}: supply terminal ${t.id} not served by a duct`);
    const servedR = new Set<string>();
    for (const s of d.returnDucts) (s.connectedDiffusers ?? []).forEach((id) => servedR.add(id));
    for (const t of d.returnTerminals) assert(servedR.has(t.id), `${wall}: return terminal ${t.id} not served by a duct`);
    // both legs must be covered by terminals
    const leftLeg = d.supplyTerminals.some((t) => t.position.x < 13 && t.position.y > 13);
    const rightLeg = d.supplyTerminals.some((t) => t.position.x > 27 && t.position.y > 13);
    assert(leftLeg && rightLeg, `${wall}: both U legs must receive supply terminals`);
  }
  console.log('✔ U 40x30 with 13-ft legs: ducts inside, terminals served, unit count preserved');
}

// ── 4. User unit-count override is honoured, evaluated and surfaced ──
{
  const base = {
    roomName: 'Hall', roomPolygon: [0, 0, 50, 0, 50, 30, 0, 30], roomAreaSqFt: 1500,
    sensibleLoadBtu: 108000, totalLoadBtu: 141000, requiredCfm: 4200, systemType: 'concealed'
  };
  const rec = executeAirDistributionDesign(base);
  assert(rec.overrideApplied === false && rec.overrideWarnings.length === 0, 'no override requested -> not applied, no warnings');

  const opt = optimizeMultiUnitCandidates(base);
  const ev = evaluateUnitCountOption(1, base);
  assert(ev !== null && ev.unitCount === 1, 'evaluateUnitCountOption evaluates an arbitrary count');
  assert(ev!.isValid === false, '1 unit cannot carry 141 kBtu/h');

  const bad = executeAirDistributionDesign({ ...base, userOverrideUnitCount: 1 });
  assert(bad.overrideApplied === true, 'failing count is still honoured');
  assert(bad.serviceZones.length === 1 && bad.selectedOption.unitCount === 1, 'chosen count used');
  assert(bad.overrideWarnings.some((w) => /DEFICIT/.test(w) && /capacity ratio \d\.\d\d/.test(w)), `warnings must report ratio + DEFICIT: ${bad.overrideWarnings.join(' | ')}`);

  const same = executeAirDistributionDesign({ ...base, userOverrideUnitCount: opt.recommendedOption.unitCount });
  assert(same.overrideApplied && same.overrideWarnings.length === 0, 'valid override -> applied without warnings');

  for (const n of [0, 13, 2.5, -1]) {
    const imp = executeAirDistributionDesign({ ...base, userOverrideUnitCount: n });
    if (n === 0) {
      // 0 is "no override" in the UI sense only if undefined; an explicit 0 is impossible and must say so
      assert(imp.overrideApplied === false && imp.overrideWarnings.some((w) => /impossible/.test(w)), 'count 0 impossible');
    } else {
      assert(imp.overrideApplied === false && imp.overrideWarnings.some((w) => /impossible/.test(w)), `count ${n} impossible`);
    }
    assert(imp.selectedOption.unitCount === opt.recommendedOption.unitCount, `impossible count ${n} falls back to optimizer`);
  }
  console.log('✔ Override honoured + surfaced; impossible counts fall back with a warning');
}

// ── 5. Scoped recalculation: locked terminals stay put, validation vs required CFM ──
{
  const d: AirDistributionDesignResult = executeAirDistributionDesign({
    roomName: 'Open Office', roomPolygon: [0, 0, 60, 0, 60, 30, 0, 30], roomAreaSqFt: 1800,
    sensibleLoadBtu: 90000, totalLoadBtu: 115000, requiredCfm: 3600, systemType: 'concealed'
  });
  assert(d.serviceZones.length >= 2, 'need a multi-zone design');
  const zid = d.serviceZones[0].id;
  const zoneSupply = d.supplyTerminals.filter((t) => t.unitId === zid);
  assert(zoneSupply.length >= 2, 'zone has several supply terminals');
  const lockedT = zoneSupply[0];
  lockedT.locked = true;
  const lockedPos = { ...lockedT.position };
  const lockedCfm = lockedT.cfm;
  // user moves the unit; locked terminal must not move, others re-laid out around it
  d.serviceZones[0].equipmentPosition.y = Math.min(25, d.serviceZones[0].equipmentPosition.y + 1);
  const r = recalculateScopedOverride(zid, d);
  const lockedAfter = r.supplyTerminals.find((t) => t.id === lockedT.id);
  assert(!!lockedAfter, 'locked terminal survives');
  assert(lockedAfter!.position.x === lockedPos.x && lockedAfter!.position.y === lockedPos.y, 'locked terminal keeps its position');
  assert(lockedAfter!.cfm === lockedCfm, 'locked terminal keeps its airflow');
  const zoneAfter = r.supplyTerminals.filter((t) => t.unitId === zid);
  const sumAfter = zoneAfter.reduce((a, t) => a + t.cfm, 0);
  assert(Math.abs(sumAfter - d.serviceZones[0].supplyCfm) <= 1, `zone airflow preserved (${sumAfter} vs ${d.serviceZones[0].supplyCfm})`);
  for (const t of zoneAfter) {
    if (t.id === lockedT.id) continue;
    assert(Math.hypot(t.position.x - lockedPos.x, t.position.y - lockedPos.y) >= 3.99, 'other terminals laid out around the locked one');
  }
  // other zones untouched
  const other = d.serviceZones[1].id;
  assert(
    JSON.stringify(r.supplyTerminals.filter((t) => t.unitId === other)) === JSON.stringify(d.supplyTerminals.filter((t) => t.unitId === other)),
    'other zones untouched'
  );
  // every zone terminal still served after re-route
  const served = new Set<string>();
  for (const s of r.supplyDucts.filter((x) => x.unitId === zid)) (s.connectedDiffusers ?? []).forEach((id) => served.add(id));
  for (const t of zoneAfter) assert(served.has(t.id), `terminal ${t.id} served after recalculation`);

  // airflow validation uses the room-required CFM, not the delivered one
  assert(r.requiredCfm === 3600, 'requiredCfm carried on the design');
  const pt0 = r.validationReport.points[1];
  assert(/3600|required/i.test(pt0.message) || pt0.status !== undefined, 'airflow point evaluated');
  const starved = { ...d, requiredCfm: 99999 };
  const r2 = recalculateScopedOverride(zid, starved);
  assert(r2.validationReport.points[1].status !== 'PASS', 'validation must compare against required CFM (99999 required -> not PASS)');
  console.log('✔ Scoped recalculation keeps locked terminals, validates vs required CFM');
}

// ── 6. Determinism ──
{
  const input = {
    roomName: 'Det', roomPolygon: [0, 0, 40, 0, 40, 30, 27, 30, 27, 13, 13, 13, 13, 30, 0, 30], roomAreaSqFt: 826,
    sensibleLoadBtu: 60000, totalLoadBtu: 80000, requiredCfm: 2800
  };
  const strip = (d: AirDistributionDesignResult): string => JSON.stringify({ ...d, timestamp: '', validationReport: { ...d.validationReport, timestamp: '' } });
  const a = strip(executeAirDistributionDesign(input));
  executeAirDistributionDesign({ ...input, roomPolygon: [0, 0, 20, 0, 20, 20, 0, 20], roomAreaSqFt: 400 });
  const b = strip(executeAirDistributionDesign(input));
  assert(a === b, 'identical inputs must give identical designs regardless of earlier runs');
  console.log('✔ Deterministic');
}

console.log('\nAll engine residual tests passed.');
