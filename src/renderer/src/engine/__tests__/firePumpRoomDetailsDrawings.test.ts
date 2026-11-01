/**
 * Acceptance tests — customer-ready pump room / tank drawings: dimensions, puddle flanges, sleeves, sensing lines,
 * drains, drainage sump, tank access and the FP-110 pump room details sheet, for default and custom pump sets.
 */
import { designFireProtectionSystem } from '../fireProtection/fireProtectionEngine';
import { DEFAULT_FIRE_INPUT } from '../fireProtection/defaults';
import { generateFireDrawings } from '../fireProtection/drawing/sheets';
import { writeDxf } from '../fireProtection/drawing/dxfWriter';
import { DrawEntity, Drawing, SheetInfo } from '../fireProtection/drawing/drawingTypes';
import { FireDesignInput } from '../fireProtection/fpTypes';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`Assertion Failed: ${m}`);
}
type T = Extract<DrawEntity, { kind: 'text' }>;
const frame = (s: SheetInfo) => ({ x0: s.originX, y0: s.originY, x1: s.originX + s.paperWidthMm * s.scale, y1: s.originY + s.paperHeightMm * s.scale });
/** Texts that sit inside a given sheet. */
function sheetTexts(d: Drawing, num: string): T[] {
  const s = d.sheets.find((x) => x.number === num);
  assert(!!s, `sheet ${num} exists`);
  const f = frame(s!);
  return d.entities.filter((e): e is T => e.kind === 'text' && e.x >= f.x0 && e.x <= f.x1 && e.y >= f.y0 && e.y <= f.y1);
}
const has = (ts: T[], s: string): boolean => ts.some((t) => t.text.toUpperCase().includes(s.toUpperCase()));
const dims = (ts: T[]): string[] => ts.filter((t) => t.layer === 'FP-DIMS').map((t) => t.text);

function check(input: FireDesignInput, label: string): void {
  const r = designFireProtectionSystem(input);
  const d = generateFireDrawings(r);
  const nums = d.sheets.map((s) => s.number);
  assert(nums[nums.length - 1] === 'FP-110', `${label}: FP-110 is the last sheet (${nums})`);
  const room = r.room;
  const wall = room.wallThicknessMm;

  // FP-101 plan
  const p = sheetTexts(d, 'FP-101');
  const pd = dims(p);
  assert(pd.includes(String(room.lengthMm)) && pd.includes(String(room.widthMm)), `${label}: internal L/W dims`);
  assert(pd.some((t) => Number(t) > room.lengthMm) && pd.some((t) => Number(t) > room.widthMm), `${label}: external dims`);
  assert(pd.includes(String(wall)), `${label}: wall thickness dim`);
  for (const e of room.equipment.filter((q) => q.kind === 'fire-pump' && q.pad)) {
    assert(pd.includes(String(e.pad!.h)) || has(p, `${e.pad!.w} X ${e.pad!.h}`), `${label}: pad size of ${e.tag}`);
  }
  assert(pd.length >= 20, `${label}: plan is fully dimensioned (${pd.length} dims)`);
  assert(has(p, `TANK INTERNAL`), `${label}: tank size note on plan`);
  for (const pen of room.penetrations) assert(p.some((t) => t.text === pen.tag || t.text.startsWith(pen.tag + ' ')), `${label}: penetration ${pen.tag} tagged`);
  assert(has(p, 'PUDDLE FLANGE'), `${label}: puddle flange callout`);
  assert(p.filter((t) => /SENSING LINE/i.test(t.text)).length >= 1 && has(p, '3/32'), `${label}: sensing line callout`);
  for (const s of room.sensingLines) assert(has(p, s.controllerTag), `${label}: controller ${s.controllerTag}`);
  assert(d.entities.filter((e) => e.layer === 'FP-PIPE-SENS').length >= room.sensingLines.length * 2, `${label}: sensing lines drawn`);
  const ds = room.drainageSump;
  assert(has(p, ds.tag), `${label}: ${ds.tag} on plan`);
  for (const sp of ds.pumps) assert(has(p, sp.tag), `${label}: sump pump ${sp.tag}`);
  for (const pump of r.pumps.mainPumps) assert(p.some((t) => t.text === pump.tag), `${label}: ${pump.tag} on plan`);
  for (const j of r.pumps.jockeys) assert(p.some((t) => t.text === j.tag), `${label}: ${j.tag} on plan`);

  // FP-102 section
  const sec = sheetTexts(d, 'FP-102');
  assert(has(sec, 'PUDDLE FLANGE PF-01') && has(sec, 'ANTI-VORTEX'), `${label}: section puddle flange & anti-vortex`);

  // FP-103 tank
  const t = sheetTexts(d, 'FP-103');
  assert(t.filter((x) => /SUCTION PIT/i.test(x.text)).length >= r.pumps.mainPumps.length, `${label}: suction pits labelled`);
  for (const o of r.tank.access.openings) assert(has(t, o.label.split(',')[0]), `${label}: tank access "${o.label}"`);
  const td = dims(t);
  const ext = Math.round(r.tank.internalLengthM * 1000 + 2 * r.tank.wallThicknessMm);
  assert(td.includes(String(Math.round(r.tank.internalLengthM * 1000))) && td.includes(String(ext)), `${label}: tank internal & external length`);

  // FP-110 details
  const det = sheetTexts(d, 'FP-110');
  for (const s of ['PUDDLE FLANGE DETAIL', 'WALL SLEEVE', 'ANTI-VORTEX PLATE DETAIL', 'PRESSURE SENSING LINE DETAIL', 'DRAINAGE SUMP PIT DETAIL', 'TRENCH SECTION DETAIL', 'PUMP ROOM DETAIL NOTES', 'NFPA 20', 'IPC', 'IBC', '3/32', 'OFF', 'LEAD', 'LAG', 'ALARM']) {
    assert(has(det, s), `${label}: FP-110 contains "${s}"`);
  }
  const dd = dims(det);
  assert(dd.includes(String(room.penetrations[0].puddleFlangeOdMm)), `${label}: puddle flange OD dimensioned`);
  assert(dd.includes(String(ds.pitDepthMm)) && dd.includes('1500'), `${label}: sump depth & 1500 check-valve spacing dimensioned`);
  assert(dd.includes(String(r.tank.sump.vortexPlateMm)), `${label}: anti-vortex plate dimensioned`);

  // containment + DXF
  const frames = d.sheets.map(frame);
  for (const e of d.entities) {
    const pts: [number, number][] = e.kind === 'line' ? [[e.x1, e.y1], [e.x2, e.y2]] : e.kind === 'circle' || e.kind === 'arc' ? [[e.cx - e.r, e.cy - e.r], [e.cx + e.r, e.cy + e.r]] : e.kind === 'text' ? [[e.x, e.y]] : e.points;
    assert(frames.some((f) => pts.every(([x, y]) => x >= f.x0 - 1 && x <= f.x1 + 1 && y >= f.y0 - 1 && y <= f.y1 + 1)), `${label}: entity inside a frame`);
  }
  assert(writeDxf(d).includes('AC1009'), `${label}: DXF`);
  console.log(`✓ ${label}: ${d.sheets.length} sheets, ${pd.length} plan dims, ${room.penetrations.length} penetrations`);
}

console.log('=== Pump room detail drawings ===');
check(DEFAULT_FIRE_INPUT, 'default 1E+1D+1J');
check({ ...DEFAULT_FIRE_INPUT, pumpCounts: { electric: 2, diesel: 1, jockey: 2 } }, '2E+1D+2J');
check({ ...DEFAULT_FIRE_INPUT, tankMaterial: 'grp-sectional', tankAccess: 'side', pumpCounts: { electric: 1, diesel: 0, jockey: 1 } }, 'GRP side access 1E+1J');
console.log('\nAll pump room detail drawing tests passed.');
