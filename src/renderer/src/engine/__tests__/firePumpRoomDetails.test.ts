/**
 * Acceptance tests — configurable pump set, wall penetrations (puddle flanges / sleeves), NFPA 20 sensing lines,
 * pump drains, IPC 712 drainage sump with duplex pumps, tank access. Oracle values per
 * docs/superpowers/plans/2026-11-01-pump-room-details-and-dimensions.md.
 */
import { designFireProtectionSystem } from '../fireProtection/fireProtectionEngine';
import { DEFAULT_FIRE_INPUT, SIMPLE_FIRE_INPUT } from '../fireProtection/defaults';
import { formatPipeSize, outsideDiameterMm } from '../fireProtection/standards/pipeData';
import { DesignCheck, FireDesignInput, FireDesignResult, Rect } from '../fireProtection/fpTypes';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`Assertion Failed: ${m}`);
}
function near(a: number, e: number, tol: number, m: string): void {
  assert(Math.abs(a - e) <= tol, `${m}: expected ${e} ±${tol}, got ${a}`);
}
const chk = (checks: DesignCheck[], id: string): DesignCheck => {
  const c = checks.find((k) => k.id === id);
  assert(!!c, `check ${id} present`);
  return c!;
};
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const ceil10 = (v: number): number => Math.ceil(v / 10 - 1e-9) * 10;

function layoutInvariants(r: FireDesignResult, label: string): void {
  const room = r.room;
  const eq = room.equipment;
  for (const e of eq) {
    const q = e.pad ?? e.rect;
    assert(q.x >= -1e-6 && q.y >= -1e-6 && q.x + q.w <= room.lengthMm + 1e-6 && q.y + q.h <= room.widthMm + 1e-6, `${label}: ${e.tag} inside room`);
  }
  for (let i = 0; i < eq.length; i++)
    for (let j = i + 1; j < eq.length; j++)
      assert(!overlaps(eq[i].pad ?? eq[i].rect, eq[j].pad ?? eq[j].rect), `${label}: no overlap ${eq[i].tag}/${eq[j].tag}`);
  // one controller per pump and jockey, on the east wall
  for (const p of r.pumps.mainPumps) assert(eq.some((e) => e.tag === p.controller.tag), `${label}: controller ${p.controller.tag}`);
  for (const j of r.pumps.jockeys) assert(eq.some((e) => e.tag === j.tag) && eq.some((e) => e.tag === j.controller.tag), `${label}: ${j.tag} + ${j.controller.tag}`);
  // sensing lines
  const ctrls = r.pumps.mainPumps.length + r.pumps.jockeys.length;
  assert(room.sensingLines.length === ctrls, `${label}: ${ctrls} sensing lines, got ${room.sensingLines.length}`);
  for (const s of room.sensingLines) {
    assert(s.sizeIn === 0.5 && s.checkValves.length === 2 && s.checkValveSpacingMm >= 1500, `${label}: ${s.pumpTag} sensing line ½" with 2 checks ≥ 1.5 m`);
    const c = eq.find((e) => e.tag === s.controllerTag)!;
    const end = s.points[s.points.length - 1];
    near(end[0], c.rect.x, 1, `${label}: ${s.pumpTag} sensing line ends at controller face`);
    let len = 0;
    for (let i = 1; i < s.points.length; i++) len += Math.hypot(s.points[i][0] - s.points[i - 1][0], s.points[i][1] - s.points[i - 1][1]);
    near(s.lengthMm, len, 1, `${label}: sensing length`);
  }
  assert(room.valves.filter((v) => v.kind === 'sensing-check').length === 2 * ctrls, `${label}: sensing check valves`);
  // penetrations
  const pf = room.penetrations.filter((p) => p.wall === 'west');
  assert(pf.every((p) => p.kind === 'puddle-flange' && p.tag.startsWith('PF-')), `${label}: tank wall → puddle flanges`);
  assert(pf.filter((p) => p.service === 'suction').length === r.pumps.mainPumps.length, `${label}: one puddle flange per suction`);
  assert(pf.some((p) => p.service === 'test'), `${label}: test return puddle flange`);
  for (const p of pf) assert(p.puddleFlangeOdMm === ceil10(outsideDiameterMm(p.sizeIn) + 200) && p.sleeveIdMm === 0, `${label}: ${p.tag} flange OD`);
  const ws = room.penetrations.filter((p) => p.wall !== 'west');
  assert(ws.every((p) => p.kind === 'sleeve-seal' && p.tag.startsWith('WS-') && p.sleeveIdMm === ceil10(outsideDiameterMm(p.sizeIn) + 50)), `${label}: sleeves`);
  assert(ws.some((p) => p.service === 'discharge') && ws.some((p) => p.service === 'test'), `${label}: system outlet + test header sleeves`);
  const diesels = r.pumps.mainPumps.filter((p) => p.driver === 'diesel').length;
  assert(ws.filter((p) => p.service === 'exhaust').length === diesels, `${label}: exhaust sleeve per diesel`);
  assert(eq.filter((e) => e.kind === 'fuel-tank').length === diesels, `${label}: fuel tank per diesel`);
  // pump drains
  assert(room.pipes.filter((p) => p.service === 'drain').length >= ctrls, `${label}: drain line per pump`);
  for (const id of ['penetrations', 'sensing-lines', 'pump-drains']) assert(chk(room.checks, id).status === 'pass', `${label}: check ${id}`);
}

console.log('=== Pump room details ===');

// 1. pipe data
{
  assert(formatPipeSize(0.5) === 'DN15 (½")', `½" format, got ${formatPipeSize(0.5)}`);
  near(outsideDiameterMm(0.5), 21.336, 0.01, '½" OD');
  console.log('✓ ½" pipe data');
}

// 2. Default design
const def = designFireProtectionSystem(DEFAULT_FIRE_INPUT);
{
  layoutInvariants(def, 'default');
  assert(def.pumps.jockeys.length === 1 && def.pumps.jockey === def.pumps.jockeys[0], 'default jockeys');
  const pf = def.room.penetrations.filter((p) => p.wall === 'west');
  assert(pf.length === 3 && pf.map((p) => p.tag).join() === 'PF-01,PF-02,PF-03', `PF-01..03, got ${pf.map((p) => p.tag)}`);
  assert(pf[0].puddleFlangeOdMm === 370 && pf[0].sizeIn === 6, '6" puddle flange OD 370');
  near(pf[0].y, def.room.suctionLineY[0], 0.5, 'PF-01 on FP-1 suction');
  const sys = def.room.penetrations.find((p) => p.service === 'discharge')!;
  assert(sys.wall === 'north' && sys.sleeveIdMm === 220, 'system outlet sleeve 220');
  // drainage sump (FFL −4.5 m)
  const ds = def.room.drainageSump;
  assert(ds.required && ds.tag === 'DS-1' && ds.inflowGpm === 35, 'pumped sump, inflow 35 gpm');
  assert(ds.rect.w === 1200 && ds.rect.h === 1000 && ds.pitDepthMm === 1200, 'pit 1200 x 1000 x 1200');
  assert(ds.pumps.length === 2 && ds.pumps.map((p) => p.tag).join() === 'SP-1,SP-2', 'duplex SP-1/SP-2');
  assert(ds.pumps[0].flowGpm === 55 && ds.pumps[0].headFt === 30 && ds.pumps[0].motorHp === 1, `55 gpm @ 30 ft, 1 HP — got ${JSON.stringify(ds.pumps[0])}`);
  assert(ds.dischargeSizeIn === 2, 'discharge 2"');
  assert(ds.levels.offMm === 300 && ds.levels.leadOnMm === 700 && ds.levels.lagOnMm === 850 && ds.levels.alarmMm === 1000, 'float levels');
  near(ds.workingVolumeGal, 126.8, 0.05, 'working volume');
  near(ds.cycleMinutes, 2.31, 0.01, 'cycle minutes');
  const pit = def.room.equipment.find((e) => e.tag === 'DS-1');
  assert(!!pit && pit.kind === 'drain-pit' && pit.rect.w === 1200, 'DS-1 placed as the drain pit');
  const end = def.room.trench.path[def.room.trench.path.length - 1];
  near(end[0], ds.rect.x + ds.rect.w / 2, 1, 'trench ends at sump centre x');
  assert(def.room.penetrations.some((p) => p.wall !== 'west' && p.service === 'drain'), 'sump discharge sleeve');
  for (const id of ['sump-pit-size', 'sump-capacity', 'sump-discharge-valves', 'sump-duplex']) assert(chk(ds.checks, id).status === 'pass', `sump check ${id}`);
  // tank access
  const a = def.tank.access;
  assert(a.kind === 'top' && a.openings.length === 2 && a.openings[0].sizeMm === 800 && a.ladder === 'internal', 'top manholes');
  near(a.openings[0].x, 6100 - 700, 1, 'manhole 1 x');
  assert(chk(def.tank.checks, 'tank-access').status === 'pass', 'tank-access check');
  assert(!def.checks.some((c) => c.status === 'fail'), `no failing checks: ${def.checks.filter((c) => c.status === 'fail').map((c) => c.id)}`);
  console.log('✓ default: penetrations, sensing lines, drains, sump, tank access');
}

// 3. Custom pump sets
{
  const v: [FireDesignInput['pumpCounts'], number, number, string][] = [
    [{ electric: 2, diesel: 1, jockey: 2 }, 3, 2, 'E,E,D'],
    [{ electric: 0, diesel: 2, jockey: 1 }, 2, 1, 'D,D'],
    [{ electric: 3, diesel: 1, jockey: 2 }, 4, 2, 'E,E,E,D']
  ];
  for (const [counts, nMain, nJ, drivers] of v) {
    const r = designFireProtectionSystem({ ...DEFAULT_FIRE_INPUT, pumpCounts: counts });
    const lbl = JSON.stringify(counts);
    assert(r.pumps.mainPumps.length === nMain && r.pumps.jockeys.length === nJ, `${lbl}: counts`);
    assert(r.pumps.mainPumps.map((p) => (p.driver === 'electric' ? 'E' : 'D')).join() === drivers, `${lbl}: driver order`);
    assert(r.pumps.mainPumps[0].role === 'duty' && r.pumps.mainPumps.slice(1).every((p) => p.role === 'standby'), `${lbl}: roles`);
    assert(r.pumps.mainPumps.map((p) => p.tag).join() === Array.from({ length: nMain }, (_, i) => `FP-${i + 1}`).join(), `${lbl}: tags`);
    assert(r.pumps.jockeys.map((j) => j.tag).join() === Array.from({ length: nJ }, (_, i) => `JP-${i + 1}`).join(), `${lbl}: jockey tags`);
    layoutInvariants(r, lbl);
    assert(chk(r.pumps.checks, 'pump-count').status === 'pass', `${lbl}: pump-count pass`);
  }
  const clamped = designFireProtectionSystem({ ...DEFAULT_FIRE_INPUT, pumpCounts: { electric: 0, diesel: 0, jockey: 5 } });
  assert(clamped.pumps.mainPumps.length === 1 && clamped.pumps.mainPumps[0].driver === 'electric' && clamped.pumps.jockeys.length === 2, 'clamped counts');
  assert(chk(clamped.pumps.checks, 'pump-count').status === 'warn', 'clamped → warn');
  console.log('✓ custom pump sets (electric / diesel / jockey)');
}

// 4. Simple input, gravity drain, side access
{
  const s = designFireProtectionSystem(SIMPLE_FIRE_INPUT);
  layoutInvariants(s, 'simple');
  assert(s.room.drainageSump.required && s.room.drainageSump.pumps[0].headFt === 30, 'underground tank → pumped sump (−4.0 m)');
  const g = designFireProtectionSystem({ ...SIMPLE_FIRE_INPUT, tankPlacement: 'ground' });
  assert(!g.room.drainageSump.required && g.room.drainageSump.pumps.length === 0, 'at grade → gravity drain');
  assert(!g.room.penetrations.some((p) => p.wall !== 'west' && p.service === 'drain' && p.sizeIn === 2), 'no pumped discharge sleeve when gravity');
  const side = designFireProtectionSystem({ ...DEFAULT_FIRE_INPUT, tankMaterial: 'grp-sectional', tankAccess: 'side' });
  const a = side.tank.access;
  assert(a.kind === 'side' && a.openings.every((o) => o.sizeMm === 600 && o.y === Math.round(side.tank.internalWidthM * 1000)) && a.ladder === 'none', 'side manways on north wall');
  assert(chk(side.tank.checks, 'tank-access').status === 'pass', 'GRP side access ok');
  const rcSide = designFireProtectionSystem({ ...DEFAULT_FIRE_INPUT, tankAccess: 'side' });
  assert(chk(rcSide.tank.checks, 'tank-access').status === 'warn', 'RC tank with side manway warns');
  console.log('✓ simple / gravity / side access');
}

console.log('\nAll pump room detail tests passed.');
