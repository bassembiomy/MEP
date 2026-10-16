import {
  layoutTerminalGrid,
  isPointInPolygon,
  distanceToPolygonEdge,
  calculateOptimalIndoorUnitPos,
  calculateOutdoorUnitPlacement,
  calculateOptimalOutdoorUnitPos,
  clipPolygonToRect,
  calculatePolygonArea,
  WALL_CLEARANCE_FT,
  MIN_TERMINAL_SPACING_FT,
  RETURN_SUPPLY_MIN_SEP_FT
} from '../geometry';
import { placeSupplyDiffusersForZone } from '../terminals/terminalPlacer';
import { placeReturnGrillesForZone, selectReturnPositions, computeReturnCfm } from '../terminals/returnPlacer';
import { selectBestDiffuserFromCatalog, MAX_NECK_VELOCITY_FPM } from '../terminals/diffuserSelector';
import { placeDiffusers } from '../diffuserPlacer';
import { partitionRoomIntoServiceZones } from '../zoning/zonePartitioner';
import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { validateSystemAirMassBalance } from '../validation/massBalanceValidator';
import { validateSpatialCoordination } from '../validation/spatialValidator';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== Running Placement Geometry Tests ===');

type Pt = { x: number; y: number };
const RECT = [0, 0, 40, 0, 40, 20, 0, 20];
const L_SHAPE = [0, 0, 100, 0, 100, 300, 400, 300, 400, 400, 0, 400]; // treated as ft-scale
const U_SHAPE = [0, 0, 30, 0, 30, 30, 20, 30, 20, 10, 10, 10, 10, 30, 0, 30];

function unique(pts: Pt[]): boolean {
  return new Set(pts.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)).size === pts.length;
}
function allInside(pts: Pt[], poly: number[]): boolean {
  return pts.every(p => isPointInPolygon(p.x, p.y, poly));
}
function minPair(pts: Pt[]): number {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.min(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  return m;
}
/** nearest-neighbour distance per point (spacing uniformity metric) */
function nnDistances(pts: Pt[]): number[] {
  return pts.map((p, i) => Math.min(...pts.filter((_, j) => j !== i).map(q => Math.hypot(p.x - q.x, p.y - q.y))));
}

// ---------------------------------------------------------------------------
// 1. Rectangle: 3x3 large room, cell-centred, uniform spacing, wall offset = half spacing
// ---------------------------------------------------------------------------
{
  const big = [0, 0, 60, 0, 60, 60, 0, 60];
  const g = layoutTerminalGrid(big, 9);
  assert(g.points.length === 9, `large room must give 9 points, got ${g.points.length}`);
  assert(g.rows === 3 && g.cols === 3, `large room must be 3x3, got ${g.rows}x${g.cols}`);
  assert(unique(g.points) && allInside(g.points, big), 'large room points unique + inside');
  const nn = nnDistances(g.points);
  assert(Math.max(...nn) / Math.min(...nn) <= 1.1, 'rectangle spacing uniformity <= 1.1');
  const wall = Math.min(...g.points.map(p => distanceToPolygonEdge(p.x, p.y, big)));
  assert(wall >= WALL_CLEARANCE_FT, `wall offset >= ${WALL_CLEARANCE_FT} ft, got ${wall}`);
  assert(Math.abs(wall - 10) < 1.1, `wall offset should be ~half spacing (10 ft), got ${wall}`);
}

// 800x300 zone, 8 diffusers: the old code stacked them on 4 positions
{
  const wide = [0, 0, 800, 0, 800, 300, 0, 300];
  const g = layoutTerminalGrid(wide, 8);
  assert(g.points.length === 8 && unique(g.points), `800x300 zone must give 8 UNIQUE points, got ${g.points.length}`);
  assert(g.rows === 2 && g.cols === 4, `800x300 n=8 => 2x4 grid, got ${g.rows}x${g.cols}`);
  const nn = nnDistances(g.points);
  assert(Math.max(...nn) / Math.min(...nn) <= 1.1, 'wide rectangle uniform spacing');

  const zone = makeZone(wide, 2800);
  const sup = placeSupplyDiffusersForZone(zone, { targetCfmPerDiffuser: 350 });
  assert(sup.length === 8, `2800 CFM => 8 diffusers, got ${sup.length}`);
  assert(unique(sup.map(t => t.position)), 'supply terminal positions unique (no stacking)');
  assert(Math.abs(sup.reduce((s, t) => s + t.cfm, 0) - 2800) < 1, 'CFM conserved');
}

// ---------------------------------------------------------------------------
// 2. Small room: 1 diffuser centred
// ---------------------------------------------------------------------------
{
  const small = [0, 0, 12, 0, 12, 10, 0, 10];
  const g = layoutTerminalGrid(small, 1);
  assert(g.points.length === 1, 'small room: one diffuser');
  assert(Math.abs(g.points[0].x - 6) < 1e-6 && Math.abs(g.points[0].y - 5) < 1e-6, `small room diffuser centred, got ${JSON.stringify(g.points[0])}`);
}

// ---------------------------------------------------------------------------
// 3. L-shape and U-shape: containment, uniqueness, wall clearance, for several n
// ---------------------------------------------------------------------------
for (const [name, poly] of [['L', L_SHAPE], ['U', U_SHAPE]] as [string, number[]][]) {
  for (const n of [1, 2, 3, 4, 6, 8]) {
    const g = layoutTerminalGrid(poly, n);
    assert(g.points.length === n, `${name}-shape n=${n}: expected ${n} points, got ${g.points.length}`);
    assert(allInside(g.points, poly), `${name}-shape n=${n}: 0 terminals may be outside the polygon`);
    assert(unique(g.points), `${name}-shape n=${n}: all unique`);
    const wall = Math.min(...g.points.map(p => distanceToPolygonEdge(p.x, p.y, poly)));
    assert(wall > 0.9, `${name}-shape n=${n}: wall offset > 0.9 ft (got ${wall.toFixed(2)})`);
  }
}
{
  // Through the real supply placer (L zone, ft scale)
  const zone = makeZone(L_SHAPE, 3500);
  const sup = placeSupplyDiffusersForZone(zone, { targetCfmPerDiffuser: 350 });
  assert(sup.length >= 8, `L zone supply count, got ${sup.length}`);
  assert(allInside(sup.map(t => t.position), L_SHAPE), 'L zone: supply terminals all inside');
  assert(unique(sup.map(t => t.position)), 'L zone: supply unique');
  const ret = placeReturnGrillesForZone(zone, sup);
  assert(ret.length >= 1 && allInside(ret.map(t => t.position), L_SHAPE), 'L zone: returns inside');
}

// ---------------------------------------------------------------------------
// 4. Returns: >= 2 ft from walls, >= 6 ft from supplies when room allows, not on top of supplies
// ---------------------------------------------------------------------------
{
  const zone = makeZone(RECT, 1500);
  const sup = placeSupplyDiffusersForZone(zone);
  const ret = placeReturnGrillesForZone(zone, sup);
  assert(ret.length >= 1, 'returns placed');
  for (const r of ret) {
    assert(distanceToPolygonEdge(r.position.x, r.position.y, RECT) >= WALL_CLEARANCE_FT - 1e-6, 'return >= 2 ft from walls');
    const d = Math.min(...sup.map(s => Math.hypot(s.position.x - r.position.x, s.position.y - r.position.y)));
    assert(d >= RETURN_SUPPLY_MIN_SEP_FT - 0.05, `return >= ${RETURN_SUPPLY_MIN_SEP_FT} ft from every supply, got ${d.toFixed(2)}`);
  }
  const direct = selectReturnPositions(RECT, sup.map(s => s.position), 2);
  assert(direct.length === 2 && minPair([...direct]) >= MIN_TERMINAL_SPACING_FT, 'two returns kept apart');
  assert(computeReturnCfm(1000) === 900, 'default return = 0.9 supply');
  assert(computeReturnCfm(1000, { exhaustCfm: 100, exfiltrationCfm: 50 }) === 850, 'return = supply - (exhaust+exfil)');
}

// ---------------------------------------------------------------------------
// 5. Indoor / outdoor units
// ---------------------------------------------------------------------------
for (const [name, poly] of [['rect', RECT], ['L', L_SHAPE], ['U', U_SHAPE]] as [string, number[]][]) {
  const odu = calculateOutdoorUnitPlacement(poly, [], null, 1);
  assert(!isPointInPolygon(odu.x, odu.y, poly), `${name}: ODU must be outside the polygon`);
  assert(['north', 'south', 'east', 'west'].includes(odu.wallSide), `${name}: ODU wall side returned`);
  const legacy = calculateOptimalOutdoorUnitPos(poly, [], null, 1);
  assert(legacy.x === odu.x && legacy.y === odu.y, `${name}: legacy ODU function agrees`);
  const idu = calculateOptimalIndoorUnitPos(poly, { x: odu.x, y: odu.y });
  assert(isPointInPolygon(idu.x, idu.y, poly), `${name}: IDU inside polygon`);
  assert(distanceToPolygonEdge(idu.x, idu.y, poly) >= 2 - 1e-6, `${name}: IDU >= 2 ft service clearance`);
  // IDU sits on the wall nearest the ODU (not the far vertex)
  const dOduIdu = Math.hypot(idu.x - odu.x, idu.y - odu.y);
  assert(dOduIdu < 15, `${name}: IDU near ODU side wall (dist ${dOduIdu.toFixed(1)})`);
}
{
  // pixel caller (10 px per ft) still works
  const px = RECT.map(v => v * 10);
  const odu = calculateOutdoorUnitPlacement(px, [], null, 10);
  assert(!isPointInPolygon(odu.x, odu.y, px), 'px ODU outside');
  const idu = calculateOptimalIndoorUnitPos(px, odu, 10);
  assert(isPointInPolygon(idu.x, idu.y, px) && distanceToPolygonEdge(idu.x, idu.y, px) >= 20 - 1e-6, 'px IDU inside with 2 ft (20 px) clearance');
  const south = calculateOutdoorUnitPlacement(RECT, [], null, 1, { side: 'south' });
  assert(south.wallSide === 'south' && south.y > 20, 'ODU on requested south wall (y grows down)');
  const north = calculateOutdoorUnitPlacement(RECT, [], null, 1, { side: 'north' });
  assert(north.wallSide === 'north' && north.y < 0, 'ODU on requested north wall (minY)');
}

// ---------------------------------------------------------------------------
// 6. Zone partitioner: L-shape bays stay inside the room; north = minY
// ---------------------------------------------------------------------------
{
  const zones = partitionRoomIntoServiceZones(partitionInput(L_SHAPE, 3, 'east'));
  const area = zones.reduce((s, z) => s + calculatePolygonArea(z.serviceAreaPolygon), 0);
  assert(Math.abs(area - calculatePolygonArea(L_SHAPE)) < 1, `L bays tile the room exactly (area ${area} vs ${calculatePolygonArea(L_SHAPE)})`);
  for (const z of zones) {
    const g = layoutTerminalGrid(z.serviceAreaPolygon, 4);
    assert(allInside(g.points, L_SHAPE), 'points of every L bay are inside the room');
    assert(isPointInPolygon(z.equipmentPosition.x, z.equipmentPosition.y, L_SHAPE), 'bay equipment inside room');
  }
  const north = partitionRoomIntoServiceZones(partitionInput(RECT, 2, 'north'));
  const south = partitionRoomIntoServiceZones(partitionInput(RECT, 2, 'south'));
  assert(north[0].equipmentPosition.y < 10, `north unit at minY (top), got y=${north[0].equipmentPosition.y}`);
  assert(south[0].equipmentPosition.y > 10, `south unit at maxY (bottom), got y=${south[0].equipmentPosition.y}`);
  const clipped = clipPolygonToRect(L_SHAPE, { minX: 0, maxX: 400, minY: 0, maxY: 100 });
  assert(Math.abs(calculatePolygonArea(clipped) - 100 * 100) < 1e-6, 'clip of the L to the top slab = 100x100');
}

// ---------------------------------------------------------------------------
// 7. Diffuser counts / selection (placeDiffusers, feet scale = 1)
// ---------------------------------------------------------------------------
{
  const big = [0, 0, 60, 0, 60, 40, 0, 40];
  const ducted = placeDiffusers(big, 2000, true, 10, 1, [], 'concealed', 60000, 1, undefined, 30);
  const supplies = ducted.filter(t => t.type === 'supply');
  assert(supplies.length >= 4, `2000 CFM ducted must not be ONE 9x9 diffuser, got ${supplies.length}`);
  assert(Math.abs(supplies.reduce((s, t) => s + t.cfm, 0) - 2000) <= supplies.length, 'supply CFM conserved');
  assert(supplies.every(t => t.size !== '9"x9"' || t.cfm <= 140), 'no 9x9 overloaded');
  assert(unique(supplies.map(t => ({ x: t.x, y: t.y }))) && allInside(supplies.map(t => ({ x: t.x, y: t.y })), big), 'ducted supplies unique + inside');
  const returns = ducted.filter(t => t.type === 'return');
  for (const r of returns) {
    const d = Math.min(...supplies.map(s => Math.hypot(s.x - r.x, s.y - r.y)));
    assert(d >= RETURN_SUPPLY_MIN_SEP_FT - 0.5, `ducted return separation, got ${d.toFixed(1)}`);
  }
  const cass = placeDiffusers(big, 3000, true, 10, 1, [], 'cassette', 72000, 3, '36K', 30);
  assert(cass.length === 3 && cass.every(t => t.type === 'cassette'), 'cassette count = unit qty');
  assert(cass.every(t => t.size === '36K'), 'cassette label stays 36K');
  const cassAuto = placeDiffusers(big, 3000, true, 10, 1, [], 'cassette', 72000, undefined, undefined, 30);
  assert(cassAuto.length === 2, `72,000 Btu/h / 36K = 2 cassettes, got ${cassAuto.length}`);
  const degenerate = placeDiffusers([0, 0, 10, 0, 10, 0, 0, 0], 500, true, 10, 1, [], 'concealed');
  assert(degenerate.every(t => Number.isFinite(t.x) && Number.isFinite(t.y)), 'degenerate zone gives no NaN');

  const lz = placeDiffusers(L_SHAPE, 6000, true, 10, 1, [], 'concealed', 100000, 1, undefined, 30);
  const lPts = lz.map(t => ({ x: t.x, y: t.y }));
  assert(allInside(lPts, L_SHAPE) && unique(lPts), 'L zone through placeDiffusers: inside + unique');

  const a = placeDiffusers(big, 2000, true, 10, 1, [], 'concealed', 60000, 1, undefined, 30, { idPrefix: 'sz-1' });
  const b = placeDiffusers(big, 2000, true, 10, 1, [], 'concealed', 60000, 1, undefined, 30, { idPrefix: 'sz-1' });
  assert(JSON.stringify(a) === JSON.stringify(b), 'placeDiffusers is deterministic (run twice => equal)');
  assert(a[0].id === 'sz-1-SD-01', `deterministic id format, got ${a[0].id}`);
}

{
  const s = selectBestDiffuserFromCatalog(335, 30);
  assert(s.neckVelocityFpm <= MAX_NECK_VELOCITY_FPM, `335 CFM neck velocity ${s.neckVelocityFpm} <= ${MAX_NECK_VELOCITY_FPM}`);
  assert(s.catalogItem.faceSizeIn.width >= 15, '335 CFM does not fit a 9x9 or 12x12');
  const small = selectBestDiffuserFromCatalog(100, 30);
  assert(small.catalogItem.faceSizeIn.width === 9, `100 CFM => smallest (9x9), got ${small.faceDimension}`);
  const huge = selectBestDiffuserFromCatalog(3000, 30);
  assert(!huge.withinLimits && huge.requiredCount > 1, 'oversized CFM => largest diffuser + increased count');
}

// ---------------------------------------------------------------------------
// 8. Validators
// ---------------------------------------------------------------------------
{
  const z = makeZone(RECT, 1000);
  z.returnCfm = 900;
  assert(validateSystemAirMassBalance([z]).status === 'PASS', 'balanced (90% return) passes');
  z.returnCfm = 500;
  assert(validateSystemAirMassBalance([z]).status === 'WARNING', 'unbalanced return must warn (no longer always passes)');
  assert(validateSystemAirMassBalance([z], undefined, { exhaustCfm: 400, exfiltrationCfm: 100 }).status === 'PASS', 'exhaust + exfil close the balance');

  z.equipmentPosition = { x: 38, y: 10, rotation: 0, wallSide: 'east' };
  const ok = validateSpatialCoordination([z], [], RECT, [{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 20, y: 10 }]);
  assert(ok.status === 'PASS', `inside + spaced => PASS (${ok.message})`);
  const outside = validateSpatialCoordination([z], [], RECT, [{ id: 'a', x: 50, y: 10 }]);
  assert(outside.status === 'WARNING' && outside.message.includes('outside'), 'terminal outside polygon warns');
  const tight = validateSpatialCoordination([z], [], RECT, [{ id: 'a', x: 10, y: 10 }, { id: 'b', x: 12, y: 10 }]);
  assert(tight.status === 'WARNING', 'terminals closer than 4 ft warn');
  assert(!ok.metric.includes('3.0') && ok.criteria.includes('4.0'), 'message limit matches tested 4.0');
}

// ---------------------------------------------------------------------------
// 9. Determinism of the zone-level pipeline
// ---------------------------------------------------------------------------
{
  const z = makeZone(U_SHAPE, 1800);
  const run = (): string => {
    const s = placeSupplyDiffusersForZone(z);
    return JSON.stringify([s, placeReturnGrillesForZone(z, s)]);
  };
  assert(run() === run(), 'zone-level placement deterministic');
}

console.log('✔ All Placement Geometry Tests Passed Successfully!');

// ---------------------------------------------------------------------------
function makeZone(poly: number[], cfm: number): EquipmentServiceZone {
  return {
    id: 'sz-1',
    unitTag: 'FCU-01',
    designControlMode: 'ai',
    equipmentModel: 'Test',
    coolingSource: 'dx',
    equipmentType: 'concealed-split',
    nominalTonnage: 4,
    actualCapacityBtu: 48000,
    supplyCfm: cfm,
    returnCfm: Math.round(cfm * 0.9),
    outdoorAirCfm: 100,
    outdoorAirConnectionApproved: true,
    espInWg: 0.35,
    equipmentPosition: { x: poly[0] + 2, y: poly[1] + 2, rotation: 0, wallSide: 'west' },
    serviceAreaPolygon: poly,
    sensibleLoadBtu: 40000,
    latentLoadBtu: 7000,
    totalLoadBtu: 47000,
    targetNc: 30,
    pressureBudgetInWg: { supplyDuct: 0.12, returnDuct: 0.06, terminals: 0.05, fittings: 0.07, totalAvailable: 0.35 },
    isUserOverridden: false
  };
}

function partitionInput(poly: number[], unitCount: number, side: 'north' | 'south' | 'east' | 'west'): Parameters<typeof partitionRoomIntoServiceZones>[0] {
  return {
    roomName: 'R',
    roomPolygon: poly,
    unitCount,
    selectedModel: 'M',
    nominalTonnage: 4,
    totalCapacityBtu: 48000,
    totalSensibleBtu: 40000,
    totalLatentBtu: 8000,
    totalSupplyCfm: 4000,
    totalOutdoorAirCfm: 500,
    availableEspInWg: 0.35,
    mountingWallSide: side
  };
}
