import { sizeDuct, sizeDuctMetric, sizeRoundDuct, sizeDuctConstantVelocity } from '../ductSizer';
import { sizeDuctAcoustically } from '../acousticDuctEngine';
import {
  frictionRateExact,
  equivalentDiameterForFriction,
  rectangularEquivalentDiameter,
  calculateTerminalPathLosses,
  sectionLengthFt
} from '../ducts/ductPressureCalculator';
import { terminalConnectionLoss, calculateFittingLosses } from '../ducts/fittingLossCalculator';
import { INWG100FT_PER_PA_PER_M } from '../ducts/ductUnits';
import { routeSteppedSupplyDucts, SteppedDuctSection } from '../ducts/steppedDuctRouter';
import { routeReturnDucts } from '../ducts/returnDuctRouter';
import { sizeDuctNetwork } from '../ducts/aerodynamicDuctSizer';
import { routeDucts } from '../ductRouter';
import {
  solveDirectedNetworkStaticPressure,
  calculateBranchBalancingSchedule,
  DEFAULT_ACCESSORIES_DELTA_P_IN_WG
} from '../staticPressureCalc';
import { validateCriticalPathPressure, criticalPathLossForUnit } from '../validation/pressureValidator';
import { STANDARD_DIFFUSER_CATALOG, STANDARD_DUCT_TYPES } from '../hvacCatalogs';
import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { getStandardsProfile } from '../standards/designStandards';
import { buildDeploymentManifest } from '../deploymentManager';
import { generateSystemCandidates, DEFAULT_OPTIMIZATION_WEIGHTS } from '../systemDesigner';
import { Zone, ProjectMetadata } from '../../store/projectStore';
import { DiffuserPos } from '../diffuserPlacer';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

console.log('=== Running Duct Network (routing / sizing / static pressure) Tests ===');

// ------------------------------------------------------------------------------------------------
// 1. Friction formula = ASHRAE (single source of truth)
// ------------------------------------------------------------------------------------------------
const f1000_12 = frictionRateExact(1000, 12);
assert(near(f1000_12, (0.109136 * Math.pow(1000, 1.9)) / Math.pow(12, 5.02), 1e-12), 'friction uses 0.109136 q^1.9 / De^5.02');
// ASHRAE friction chart: 1000 CFM in a 12" round duct is ~0.2 in.wg/100ft (exact equation = 0.2092)
assert(near(f1000_12, 0.209, 0.005) && f1000_12 > 0.18 && f1000_12 < 0.22, `1000 CFM / 12" friction ${f1000_12}`);
// inverse is consistent
for (const q of [200, 1000, 5000]) {
  const de = equivalentDiameterForFriction(q, 0.1);
  assert(near(frictionRateExact(q, de), 0.1, 1e-9), `inverse friction round-trips at ${q} CFM`);
}
// Huebscher equivalent diameter, 24x12
assert(near(rectangularEquivalentDiameter(24, 12), (1.3 * Math.pow(288, 0.625)) / Math.pow(36, 0.25), 1e-9), 'Huebscher De');
console.log('✔ 1. Friction formula matches ASHRAE (1000 CFM @ 12" = ' + f1000_12.toFixed(4) + ' in.wg/100ft)');

// ------------------------------------------------------------------------------------------------
// 2. Sizing: friction <= 0.10, aspect <= 4, standard 2" increments
// ------------------------------------------------------------------------------------------------
for (const cfm of [1000, 3000, 5000]) {
  const sz = sizeDuct(cfm, 0.1);
  const actual = frictionRateExact(cfm, rectangularEquivalentDiameter(sz.widthIn, sz.heightIn));
  assert(actual <= 0.1 + 1e-9, `${cfm} CFM actual friction ${actual.toFixed(4)} must be <= 0.10`);
  assert(Math.max(sz.widthIn, sz.heightIn) / Math.min(sz.widthIn, sz.heightIn) <= 4, `${cfm} CFM aspect ${sz.aspectRatio} must be <= 4`);
  assert(sz.widthIn % 2 === 0 && sz.heightIn % 2 === 0 && sz.widthIn >= 6 && sz.heightIn >= 6, `${cfm} CFM sizes in 2" increments`);
  assert(sz.heightIn <= 24, 'depth limit');
  const acoustic = sizeDuctAcoustically(cfm, { sectionCategory: 'trunk', fixedHeightIn: 10 });
  assert(acoustic.frictionRateInWgPer100Ft <= 0.1 + 1e-9, `acoustic sizer honours friction target at ${cfm} CFM (${acoustic.frictionRateInWgPer100Ft})`);
  assert(acoustic.actualVelocityFpm <= acoustic.allowableAcousticVelocityFpm, 'acoustic sizer honours velocity');
  assert(acoustic.aspectRatio <= 4, 'acoustic aspect <= 4');
  assert(acoustic.widthIn % 2 === 0 && acoustic.heightIn % 2 === 0, 'acoustic sizes in 2" increments');
}
// Friction target governs when tighter than velocity (acoustic engine used to ignore it)
const tight = sizeDuctAcoustically(2000, { sectionCategory: 'trunk', frictionRateTarget: 0.05 });
const loose = sizeDuctAcoustically(2000, { sectionCategory: 'trunk', frictionRateTarget: 0.2 });
assert(tight.areaSqFt >= loose.areaSqFt && tight.frictionRateInWgPer100Ft <= 0.05 + 1e-9, 'frictionRateTarget is honoured');
// Max depth honoured (used to be raised to 36" silently)
const shallow = sizeDuctAcoustically(5000, { sectionCategory: 'trunk', fixedHeightIn: 8, maxDepthIn: 12 });
assert(shallow.heightIn <= 12, `acoustic sizer respects max depth, got ${shallow.heightIn}"`);
// Round ducts: ASHRAE inverse + velocity, 2" steps
const rd = sizeRoundDuct(1000, 0.1);
assert(rd.diameterIn % 2 === 0 && frictionRateExact(1000, rd.diameterIn) <= 0.1 + 1e-9, 'round duct friction <= 0.10');
const cv = sizeDuctConstantVelocity(5000, 1000, 10);
assert(cv.aspectRatio <= 4, `constant-velocity aspect ${cv.aspectRatio} <= 4`);
console.log('✔ 2. Sizing honours friction + velocity, aspect <= 4:1, depth limit, 2" increments');

// ------------------------------------------------------------------------------------------------
// 3. Fallback when ceiling depth is too small (was 6x6 at 32,000 fpm)
// ------------------------------------------------------------------------------------------------
const shallowZone: EquipmentServiceZone = makeZone({ cfm: 8000, eq: { x: 2, y: 5 }, poly: [0, 0, 60, 0, 60, 10, 0, 10], depth: 10 });
const bigSection: SteppedDuctSection = {
  id: 'S1', unitId: shallowZone.id, designControlMode: 'ai', systemType: 'supply', role: 'main-trunk',
  startPoint: { x: 0, y: 5 }, endPoint: { x: 20, y: 5 }, airflowCfm: 8000, shape: 'rectangular',
  widthIn: 0, heightIn: 0, velocityFpm: 0, allowableVelocityFpm: 0, frictionLossPer100Ft: 0, fittingLossInWg: 0,
  totalSectionLossInWg: 0, ncRating: 30, connectedDiffuserCount: 1, connectedDiffusers: ['T'], childDuctIds: []
};
const [bigSized] = sizeDuctNetwork([bigSection], getStandardsProfile('ashrae'), 10);
assert(bigSized.heightIn <= 10, 'fallback respects depth');
assert(bigSized.widthIn * bigSized.heightIn > 600, `fallback must be the largest duct that fits, not 6x6 (got ${bigSized.widthIn}x${bigSized.heightIn})`);
assert(bigSized.velocityFpm < 3000, `velocity ${bigSized.velocityFpm} must be sane`);
assert(bigSized.meetsDesignCriteria === false && (bigSized.designWarnings?.length || 0) > 0, 'violation is flagged');
console.log(`✔ 3. Depth-limited fallback = ${bigSized.widthIn}x${bigSized.heightIn} at ${bigSized.velocityFpm} fpm, flagged`);

// ------------------------------------------------------------------------------------------------
// 4. Metric sizing: Pa/m -> in.wg/100ft = x0.1224, 50 mm increments
// ------------------------------------------------------------------------------------------------
assert(near(INWG100FT_PER_PA_PER_M, 0.1224, 1e-9), 'conversion constant');
const m = sizeDuctMetric(500, 1.0);
assert(m.widthMm % 50 === 0 && m.heightMm % 50 === 0, `metric sizes in 50 mm steps (${m.widthMm}x${m.heightMm})`);
assert(m.widthMm >= 350 && m.widthMm <= 450 && m.heightMm >= 250, `500 L/s @ 1 Pa/m should be ~350-450 x 250 (got ${m.widthMm}x${m.heightMm})`);
assert(m.frictionPaM <= 1.0 + 1e-6, `metric friction ${m.frictionPaM} Pa/m <= 1.0`);
assert(m.widthMm * m.heightMm > 250 * 250, 'no longer the undersized 250x250');
console.log(`✔ 4. Metric 500 L/s @ 1.0 Pa/m -> ${m.widthMm}x${m.heightMm} mm (${m.frictionPaM} Pa/m)`);

// ------------------------------------------------------------------------------------------------
// Network helpers
// ------------------------------------------------------------------------------------------------
function makeZone(o: { cfm: number; eq: { x: number; y: number }; poly: number[]; depth?: number }): EquipmentServiceZone {
  return {
    id: 'sz-x', unitTag: 'FCU-X', designControlMode: 'ai', equipmentModel: 'x', coolingSource: 'dx', equipmentType: 'concealed-split',
    nominalTonnage: 5, actualCapacityBtu: 60000, supplyCfm: o.cfm, returnCfm: Math.round(o.cfm * 0.9), outdoorAirCfm: 0,
    outdoorAirConnectionApproved: true, espInWg: 0.5,
    equipmentPosition: { x: o.eq.x, y: o.eq.y, rotation: 0, wallSide: 'east' },
    serviceAreaPolygon: o.poly, sensibleLoadBtu: 0, latentLoadBtu: 0, totalLoadBtu: 0, targetNc: 30,
    maxAvailableCeilingDepthIn: o.depth,
    pressureBudgetInWg: { supplyDuct: 0.12, returnDuct: 0.06, terminals: 0.05, fittings: 0.07, totalAvailable: 0.35 },
    isUserOverridden: false
  } as EquipmentServiceZone;
}

function term(id: string, x: number, y: number, cfm: number, type: 'supply' | 'return' = 'supply'): CoordinatedAirTerminal {
  return {
    id, unitId: 'sz-x', designControlMode: 'ai', type, subtype: '4-way-ceiling', position: { x, y }, cfm, catalogModel: 'm',
    neckDimension: '10"', faceDimension: '24"x24"', throwT50Ft: 10, throwRatio: 1, adjacentOverlapRatio: 0.8,
    occupiedZoneVelocityFpm: 40, ncRating: 22, deltaPInWg: 0.035, status: 'pass'
  };
}

interface Seg { id: string; a: { x: number; y: number }; b: { x: number; y: number } }

function assertOrthogonalNoZeroNoOverlap(segs: Seg[], label: string) {
  for (const s of segs) {
    const horiz = near(s.a.y, s.b.y, 1e-6);
    const vert = near(s.a.x, s.b.x, 1e-6);
    assert(horiz || vert, `${label}: ${s.id} must be horizontal or vertical (${s.a.x},${s.a.y})->(${s.b.x},${s.b.y})`);
    assert(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 1e-6, `${label}: ${s.id} has zero length`);
  }
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = segs[i], q = segs[j];
      const pH = near(p.a.y, p.b.y, 1e-6), qH = near(q.a.y, q.b.y, 1e-6);
      if (pH && qH && near(p.a.y, q.a.y, 1e-6)) {
        const o = Math.min(Math.max(p.a.x, p.b.x), Math.max(q.a.x, q.b.x)) - Math.max(Math.min(p.a.x, p.b.x), Math.min(q.a.x, q.b.x));
        assert(o <= 1e-6, `${label}: ${p.id} overlaps ${q.id} by ${o}`);
      }
      if (!pH && !qH && near(p.a.x, q.a.x, 1e-6)) {
        const o = Math.min(Math.max(p.a.y, p.b.y), Math.max(q.a.y, q.b.y)) - Math.max(Math.min(p.a.y, p.b.y), Math.min(q.a.y, q.b.y));
        assert(o <= 1e-6, `${label}: ${p.id} overlaps ${q.id} by ${o}`);
      }
    }
  }
}

function assertStepped(net: SteppedDuctSection[], terminals: CoordinatedAirTerminal[], label: string) {
  assertOrthogonalNoZeroNoOverlap(net.map((s) => ({ id: s.id, a: s.startPoint, b: s.endPoint })), label);
  const cfmOf = new Map(terminals.map((t) => [t.id, t.cfm]));
  const byId = new Map(net.map((s) => [s.id, s]));
  // Flow conservation at every node: section flow = terminals served at its end + sum of child sections
  for (const s of net) {
    const direct = (s.directDiffusers || []).reduce((a, id) => a + (cfmOf.get(id) || 0), 0);
    const kids = net.filter((c) => c.parentDuctId === s.id).reduce((a, c) => a + c.airflowCfm, 0);
    assert(near(s.airflowCfm, direct + kids, 0.5), `${label}: flow not conserved at ${s.id}: ${s.airflowCfm} vs ${direct}+${kids}`);
    const downstream = s.connectedDiffusers.reduce((a, id) => a + (cfmOf.get(id) || 0), 0);
    assert(near(s.airflowCfm, downstream, 0.5), `${label}: ${s.id} flow != sum of downstream terminals`);
    assert(s.childDuctIds.every((c) => byId.get(c)?.parentDuctId === s.id), `${label}: child links consistent`);
  }
  const roots = net.filter((s) => !s.parentDuctId || !byId.has(s.parentDuctId));
  const total = terminals.reduce((a, t) => a + t.cfm, 0);
  const rootFlow = roots.reduce((a, s) => a + s.airflowCfm, 0);
  assert(near(rootFlow, total, 0.5), `${label}: unit discharge ${rootFlow} != total terminal flow ${total}`);
  // every terminal is served exactly once
  const served = net.flatMap((s) => s.directDiffusers || []);
  assert(new Set(served).size === served.length && served.length === terminals.length, `${label}: each terminal served exactly once`);
  // sizes sane
  for (const s of net) {
    assert(s.widthIn % 2 === 0 && s.heightIn % 2 === 0 && s.widthIn >= 6 && s.heightIn >= 6, `${label}: ${s.id} standard 2" size (${s.widthIn}x${s.heightIn})`);
    assert(Math.max(s.widthIn, s.heightIn) / Math.min(s.widthIn, s.heightIn) <= 4 + 1e-9, `${label}: ${s.id} aspect ratio`);
  }
}

// ------------------------------------------------------------------------------------------------
// 5. Stepped routing with the unit MID-WALL (used to zig-zag): horizontal room
// ------------------------------------------------------------------------------------------------
const zoneH = makeZone({ cfm: 2400, eq: { x: 30, y: 2 }, poly: [0, 0, 60, 0, 60, 24, 0, 24] });
const termsH = [
  term('A', 8, 6, 300), term('B', 8, 18, 300), term('C', 18, 10, 400), term('D', 42, 12, 400),
  term('E', 42, 20, 300), term('F', 54, 2, 400), term('G', 24, 2, 300)
];
const netH = routeSteppedSupplyDucts(zoneH, termsH);
assertStepped(netH, termsH, 'stepped-horizontal');
const trunksH = netH.filter((s) => s.role === 'main-trunk');
assert(trunksH.every((s) => near(s.startPoint.y, 2, 1e-6) && near(s.endPoint.y, 2, 1e-6)), 'trunk is along the dominant (horizontal) axis through the unit');
// trunk runs outward from the unit on each side, never doubling back (no zig-zag)
for (const t of trunksH) {
  const sameSide = (t.startPoint.x - 30) * (t.endPoint.x - 30) >= 0;
  assert(sameSide && Math.abs(t.endPoint.x - 30) > Math.abs(t.startPoint.x - 30), `${t.id}: trunk piece moves away from the unit`);
}
// trunk ends only at the last takeoff on each side
const maxLeft = Math.min(...trunksH.map((s) => Math.min(s.startPoint.x, s.endPoint.x)));
const maxRight = Math.max(...trunksH.map((s) => Math.max(s.startPoint.x, s.endPoint.x)));
assert(near(maxLeft, 8, 1e-6) && near(maxRight, 54, 1e-6), `trunk extends only to last takeoff (${maxLeft}..${maxRight})`);
// roles
assert(netH.filter((s) => s.role !== 'main-trunk').every((s) => (s.startPoint.x === s.endPoint.x)), 'branches/runouts are perpendicular to the trunk');
assert(netH.some((s) => s.role === 'branch') && netH.some((s) => s.role === 'runout'), 'branch + runout roles present');
// monotonic trunk: constant depth along a run, width never grows downstream
for (const s of netH) {
  if (!s.parentDuctId) continue;
  const p = netH.find((x) => x.id === s.parentDuctId)!;
  if (s.role === 'main-trunk' && p.role === 'main-trunk') {
    assert(s.heightIn === p.heightIn, `${s.id}: trunk depth constant (${p.heightIn} -> ${s.heightIn})`);
    assert(s.widthIn <= p.widthIn, `${s.id}: trunk width must not grow downstream (${p.widthIn} -> ${s.widthIn})`);
    assert(s.airflowCfm <= p.airflowCfm, 'flow decreases downstream');
  }
}
// velocity limits by role, friction <= 0.10
for (const s of netH) {
  assert(s.frictionLossPer100Ft <= 0.1 + 1e-9, `${s.id}: friction ${s.frictionLossPer100Ft} <= 0.10`);
  assert(s.velocityFpm <= s.allowableVelocityFpm + 1, `${s.id}: velocity ${s.velocityFpm} <= ${s.allowableVelocityFpm}`);
  const lim = s.role === 'main-trunk' ? 1200 : s.role === 'branch' ? 900 : 700;
  assert(s.allowableVelocityFpm === lim, `${s.id}: ${s.role} limit ${s.allowableVelocityFpm} == ${lim}`);
}
console.log(`✔ 5. Mid-wall horizontal network: ${netH.length} orthogonal sections, conserved, monotonic trunk`);

// Vertical room (taller than wide) -> trunk runs vertically
const zoneV = makeZone({ cfm: 1200, eq: { x: 3, y: 20 }, poly: [0, 0, 12, 0, 12, 50, 0, 50] });
const termsV = [term('V1', 3, 8, 300), term('V2', 9, 8, 300), term('V3', 3, 36, 300), term('V4', 9, 44, 300)];
const netV = routeSteppedSupplyDucts(zoneV, termsV);
assertStepped(netV, termsV, 'stepped-vertical');
assert(netV.filter((s) => s.role === 'main-trunk').every((s) => near(s.startPoint.x, 3, 1e-6) && near(s.endPoint.x, 3, 1e-6)), 'vertical trunk through unit');
console.log('✔ 5b. Tall room routes a vertical trunk');

// Terminals directly on the trunk line and directly above the unit (degenerate cases)
const zoneD = makeZone({ cfm: 1000, eq: { x: 20, y: 5 }, poly: [0, 0, 40, 0, 40, 10, 0, 10] });
const termsD = [term('D1', 20, 9, 250), term('D2', 30, 5, 250), term('D3', 30, 9, 250), term('D4', 5, 5, 250)];
const netD = routeSteppedSupplyDucts(zoneD, termsD);
assertStepped(netD, termsD, 'stepped-degenerate');
console.log('✔ 5c. Degenerate layouts (terminal over unit, on-trunk terminals, shared stations) stay orthogonal and conserved');

// ------------------------------------------------------------------------------------------------
// 6. Critical path differs per terminal; fittings from routed geometry
// ------------------------------------------------------------------------------------------------
const paths = calculateTerminalPathLosses(netH, (s) => terminalConnectionLoss(s));
assert(paths.length === termsH.length, 'a path for every terminal');
const totals = paths.map((p) => p.totalInWg);
assert(new Set(totals.map((t) => t.toFixed(4))).size > 1, 'path losses must differ per terminal');
const crit = paths.reduce((a, b) => (b.totalInWg > a.totalInWg ? b : a));
const naiveSum = netH.reduce((a, s) => a + s.totalSectionLossInWg, 0);
assert(crit.totalInWg < naiveSum, `critical path (${crit.totalInWg}) < naive sum of every duct (${naiveSum.toFixed(4)})`);
// far terminals (F at x=54) are worse than near ones (G at x=24)
const pF = paths.find((p) => p.terminalId === 'F')!;
const pG = paths.find((p) => p.terminalId === 'G')!;
assert(pF.totalInWg > pG.totalInWg, 'far terminal has a higher path loss than a near terminal');
assert(pF.sectionIds[0] !== undefined && pF.teeBranches >= 1 && pF.elbows >= 1, 'fitting counts come from routed geometry');
assert(calculateFittingLosses(netH) > 0, 'network fitting loss computed');
// real friction x length on the path
const pathFrictionManual = pF.sectionIds.map((id) => netH.find((s) => s.id === id)!).reduce((a, s) => a + (s.frictionLossPer100Ft * sectionLengthFt(s)) / 100, 0);
assert(near(pF.frictionInWg, pathFrictionManual, 1e-3), 'path friction = sum(rate x length)');
// validator uses the critical path (not the sum of everything)
const unitLoss = criticalPathLossForUnit(netH);
assert(near(unitLoss.supply, crit.totalInWg + 0.04, 1e-3), 'validator supply critical path matches path walk');
const val = validateCriticalPathPressure([zoneH], netH);
assert(val.status === 'PASS' || val.status === 'WARNING', 'validator returns a status');
console.log(`✔ 6. Critical path ${crit.terminalId} = ${crit.totalInWg} in.wg (naive all-ducts sum ${naiveSum.toFixed(3)}); paths differ per terminal`);

// ------------------------------------------------------------------------------------------------
// 7. Return routing (was a hard-coded 24x12 stub)
// ------------------------------------------------------------------------------------------------
const grilles = [term('R1', 6, 20, 800, 'return'), term('R2', 50, 20, 800, 'return'), term('R3', 30, 22, 500, 'return')];
const netR = routeReturnDucts(zoneH, grilles);
assertStepped(netR, grilles, 'return');
assert(netR.every((s) => s.systemType === 'return'), 'return systemType');
assert(new Set(netR.map((s) => `${s.widthIn}x${s.heightIn}`)).size > 1, 'return sections are individually sized (no fixed 24x12 stub)');
assert(netR.every((s) => !(s.widthIn === 24 && s.heightIn === 12 && s.airflowCfm < 300)), 'no hard-coded stub');
assert(netR.every((s) => s.velocityFpm <= 900 + 1), 'return velocity <= 900 fpm');
const stub = routeReturnDucts(zoneH, []);
assert(stub.length >= 1 && stub[0].widthIn * stub[0].heightIn !== 24 * 12 || stub[0].airflowCfm > 1000, 'plenum return stub is sized from flow');
assertOrthogonalNoZeroNoOverlap(stub.map((s) => ({ id: s.id, a: s.startPoint, b: s.endPoint })), 'return-stub');
// supply + return of one unit do not overlap each other
assertOrthogonalNoZeroNoOverlap([...netH, ...netR].map((s) => ({ id: s.id, a: s.startPoint, b: s.endPoint })).filter((s) => s.id.startsWith('RDS') || s.id.startsWith('DS')), 'supply+return');
console.log(`✔ 7. Return network routed from ${grilles.length} grilles (${netR.length} sections), sized by flow`);

// ------------------------------------------------------------------------------------------------
// 8. Canvas router (px): orthogonal, scale-aware, metric steps, conserved
// ------------------------------------------------------------------------------------------------
const roomPx = [60, 60, 540, 60, 540, 300, 60, 300]; // 48 ft x 24 ft at 10 px/ft
const difs: DiffuserPos[] = [
  { id: 'd1', x: 120, y: 110, cfm: 300, size: '12"x12"', type: 'supply' },
  { id: 'd2', x: 120, y: 250, cfm: 300, size: '12"x12"', type: 'supply' },
  { id: 'd3', x: 250, y: 150, cfm: 400, size: '12"x12"', type: 'supply' },
  { id: 'd4', x: 400, y: 100, cfm: 400, size: '12"x12"', type: 'supply' },
  { id: 'd5', x: 400, y: 260, cfm: 300, size: '12"x12"', type: 'supply' },
  { id: 'd6', x: 500, y: 180, cfm: 300, size: '12"x12"', type: 'supply' },
  { id: 'r1', x: 100, y: 280, cfm: 900, size: '24"x24"', type: 'return' },
  { id: 'r2', x: 480, y: 280, cfm: 900, size: '24"x24"', type: 'return' }
];

function checkPx(
  units: 'imperial' | 'metric',
  ppf: number,
  shape: 'rectangular' | 'round' = 'rectangular'
) {
  const res = routeDucts(roomPx, difs, units, 'z1', { x: 300, y: 180 }, 'concealed', undefined, { ductShape: shape }, ppf);
  const ducts = res.ducts as (typeof res.ducts[number] & { parentDuctId?: string; lengthFt?: number })[];
  const label = `px-${units}-${ppf}-${shape}`;
  assertOrthogonalNoZeroNoOverlap(ducts.filter((d) => d.type !== 'return').map((d) => ({ id: d.id, a: { x: d.points[0], y: d.points[1] }, b: { x: d.points[2], y: d.points[3] } })), label + ' supply');
  assertOrthogonalNoZeroNoOverlap(ducts.filter((d) => d.type === 'return').map((d) => ({ id: d.id, a: { x: d.points[0], y: d.points[1] }, b: { x: d.points[2], y: d.points[3] } })), label + ' return');
  // conservation (supply): flow = direct terminals at end + children
  const sup = ducts.filter((d) => d.type !== 'return');
  const tol = 0.5 * ppf;
  const supplyTerms = difs.filter((d) => d.type === 'supply');
  const directOf = new Map<string, number>();
  for (const t of supplyTerms) {
    let best: (typeof sup)[number] | undefined;
    let bd = Infinity;
    for (const d of sup) {
      const dist = Math.hypot(d.points[2] - t.x, d.points[3] - t.y);
      if (dist < bd - 1e-9 || (near(dist, bd, 1e-9) && best && d.cfm < best.cfm)) { bd = dist; best = d; }
    }
    assert(!!best && bd <= tol + 1e-6, `${label}: terminal ${t.id} connects at a duct end (dist ${bd})`);
    directOf.set(best!.id, (directOf.get(best!.id) || 0) + t.cfm);
  }
  for (const d of sup) {
    const kids = sup.filter((c) => c.parentDuctId === d.id).reduce((a, c) => a + c.cfm, 0);
    assert(near(d.cfm, (directOf.get(d.id) || 0) + kids, 0.5), `${label}: flow conserved at ${d.id} (${d.cfm} vs ${(directOf.get(d.id) || 0)}+${kids})`);
  }
  const rootsFlow = sup.filter((d) => !d.parentDuctId).reduce((a, d) => a + d.cfm, 0);
  assert(near(rootsFlow, supplyTerms.reduce((a, t) => a + t.cfm, 0), 0.5), `${label}: total supply flow at unit`);
  const ret = ducts.filter((d) => d.type === 'return');
  assert(ret.length >= 3, `${label}: return grilles are routed (${ret.length})`);
  assert(near(ret.filter((d) => !d.parentDuctId).reduce((a, d) => a + d.cfm, 0), 1800, 0.5), `${label}: return flow at unit`);
  // trunk monotonic
  for (const d of sup.filter((x) => x.type === 'trunk')) {
    const p = sup.find((x) => x.id === d.parentDuctId);
    if (p && p.type === 'trunk') {
      assert((shape === 'round' || d.heightIn === p.heightIn) && d.widthIn <= p.widthIn + 1e-9, `${label}: ${d.id} trunk depth constant / width non-increasing`);
    }
  }
  // standard sizes
  for (const d of ducts) {
    if (shape === 'round') continue;
    if (units === 'imperial') {
      assert(d.widthIn % 2 === 0 && d.heightIn % 2 === 0, `${label}: ${d.id} imperial 2" steps (${d.sizeLabel})`);
    } else {
      const wMm = d.widthIn * 25.4, hMm = d.heightIn * 25.4;
      assert(near(wMm / 50, Math.round(wMm / 50), 1e-6) && near(hMm / 50, Math.round(hMm / 50), 1e-6), `${label}: ${d.id} metric 50 mm steps (${d.sizeLabel})`);
      const [w, h] = d.sizeLabel.replace(' (R)', '').split('x').map(Number);
      assert(w % 50 === 0 && h % 50 === 0, `${label}: label ${d.sizeLabel} rounded to 50 mm`);
    }
    assert(Math.max(d.widthIn, d.heightIn) / Math.min(d.widthIn, d.heightIn) <= 4 + 1e-9, `${label}: ${d.id} aspect`);
    if (d.type === 'return') {
      const area = (d.widthIn * d.heightIn) / 144;
      assert(near(d.areaSqFt || 0, area, 0.002), `${label}: return area w*h`);
    }
  }
  return { ducts, label };
}
const px10 = checkPx('imperial', 10);
checkPx('imperial', 20);
checkPx('metric', 10);
const round = checkPx('imperial', 10, 'round');
const roundMetric = routeDucts(roomPx, difs, 'metric', 'z1', { x: 300, y: 180 }, 'concealed', undefined, { ductShape: 'round' }, 10);
for (const d of roundMetric.ducts) {
  const dMm = (d.diameterIn || 0) * 25.4;
  assert(near(dMm / 50, Math.round(dMm / 50), 1e-6), `round metric diameter ${dMm} mm in 50 mm steps`);
  assert(/^Ø\d+/.test(d.sizeLabel) && !d.sizeLabel.includes('"'), `metric round label in mm (${d.sizeLabel})`);
}
const retRound = round.ducts.find((d) => d.type === 'return')!;
assert(near(retRound.areaSqFt || 0, (Math.PI * (retRound.diameterIn || 0) ** 2) / 4 / 144, 0.002), 'round return area = pi d^2/4');
// scale awareness: same px geometry at 20 px/ft is half the length => lower friction, never larger duct
const a = routeDucts(roomPx, difs, 'imperial', 'z1', { x: 300, y: 180 }, 'concealed', undefined, {}, 10).ducts as any[];
const b = routeDucts(roomPx, difs, 'imperial', 'z1', { x: 300, y: 180 }, 'concealed', undefined, {}, 20).ducts as any[];
assert(near(a[0].lengthFt, 2 * b[0].lengthFt, 0.02), 'pxPerFt scales lengths (ft = px / pxPerFt)');
console.log('✔ 8. Canvas router: orthogonal, conserved, standard imperial/metric sizes, pxPerFt-aware, returns routed');

// ------------------------------------------------------------------------------------------------
// 9. Static pressure on the routed canvas network: per-terminal paths, balancing, accessories
// ------------------------------------------------------------------------------------------------
const sp = solveDirectedNetworkStaticPressure(px10.ducts, difs, STANDARD_DIFFUSER_CATALOG, STANDARD_DUCT_TYPES[0], 10);
const losses = sp.terminalPathLossesInWg!;
const lossVals = Object.values(losses);
assert(lossVals.length === 6, 'a path loss for each supply terminal');
assert(new Set(lossVals.map((v) => v.toFixed(3))).size > 2, 'critical path differs per terminal');
assert(near(sp.totalSupplyDeltaPInWg, Math.max(...lossVals), 1e-3), 'critical supply path is the max path');
assert(losses['d3'] !== losses['d6'] && losses['d4'] > losses['d5'], 'different terminals have different path losses (long, high-flow path is worse)');
assert(sp.accessoriesDeltaPInWg === DEFAULT_ACCESSORIES_DELTA_P_IN_WG && (sp.accessoriesDeltaPInWg as number) !== 0.15, 'accessories is a named constant');
const sp2 = solveDirectedNetworkStaticPressure(px10.ducts, difs, STANDARD_DIFFUSER_CATALOG, STANDARD_DUCT_TYPES[0], 10, 0.15, { accessoriesDeltaPInWg: 0.2 });
assert(near(sp2.totalSupplyDeltaPInWg - sp.totalSupplyDeltaPInWg, 0.15, 1e-3), 'accessories parameter flows into the path');
assert(sp.supplySegments.some((s) => s.type === 'fitting') && sp.espRequiredInWg > 0, 'fittings counted along the critical path');
assert(sp.returnSegments.length > 0 && sp.totalReturnDeltaPInWg > 0.025, 'return path evaluated from routed return ducts');
const bal = calculateBranchBalancingSchedule(sp, difs);
assert(bal.length === 6, 'balancing schedule for supply terminals only');
for (const item of bal) {
  const expected = sp.totalSupplyDeltaPInWg - losses[item.terminalId];
  assert(near(item.pressureDeficitInWg, Math.max(0, expected), 0.002), `balancing = critical - path for ${item.terminalId}`);
}
assert(bal.some((x) => x.pressureDeficitInWg === 0) && bal.some((x) => x.pressureDeficitInWg > 0), 'critical terminal full open, others throttled');
console.log(`✔ 9. Static pressure: critical ${sp.terminalId} ${sp.totalSupplyDeltaPInWg} in.wg, ESP ${sp.espRequiredInWg}; balancing from real paths`);

// ------------------------------------------------------------------------------------------------
// 10. Deployment "Test 8" scenario: airflow conserved trunk <-> supply diffusers
// ------------------------------------------------------------------------------------------------
const project: ProjectMetadata = { name: 'T', location: 'Cairo, Egypt', scale: 10, units: 'imperial', outdoorDb: 95, indoorDb: 75 };
const zone: Zone = {
  id: 'zone-n', name: 'Office', points: [60, 60, 240, 60, 240, 180, 60, 180], spaceTypeId: 'office', ceilingHeight: 10,
  occupants: 2, diffusers: [], ducts: [], maxSpaceNcLimit: 30
};
const cands = generateSystemCandidates(12000, 8400, 400, 'office', 216, true, DEFAULT_OPTIMIZATION_WEIGHTS, ['concealed', 'packaged']);
for (const type of ['concealed', 'packaged']) {
  const cand = cands.candidates.find((c) => c.systemType === type) || cands.candidates[0];
  const man = buildDeploymentManifest(cand, zone, [zone], project);
  const supplyFlow = man.terminals.filter((t) => t.type === 'supply' || !t.type).reduce((s, t) => s + t.cfm, 0);
  const trunk0 = man.ducts.find((d) => d.type === 'trunk');
  assert(!!trunk0 && trunk0.cfm === supplyFlow, `${type}: first trunk ${trunk0?.cfm} == supply diffusers ${supplyFlow}`);
  assertOrthogonalNoZeroNoOverlap(
    man.ducts.filter((d) => d.type !== 'return').map((d) => ({ id: d.id, a: { x: d.points[0], y: d.points[1] }, b: { x: d.points[2], y: d.points[3] } })),
    `deploy-${type}`
  );
  assert(man.ducts.some((d) => d.type === 'return'), `${type}: return duct routed`);
}
console.log('✔ 10. Deployment scenario: trunk flow equals supply diffuser flow (returns are a separate network)');

console.log('\n=== All Duct Network Tests Passed ===');
