/** Z2 — standpipe zoning on the drawings: FP-106 zone bands / stations / express risers, new FP-111 PRV vs no-PRV study. */
import { designFireProtectionSystem } from '../fireProtection/fireProtectionEngine';
import { DEFAULT_FIRE_INPUT } from '../fireProtection/defaults';
import { generateFireDrawings } from '../fireProtection/drawing/sheets';
import { writeDxf } from '../fireProtection/drawing/dxfWriter';
import { DrawEntity, Drawing, SheetInfo } from '../fireProtection/drawing/drawingTypes';
import { FireDesignInput } from '../fireProtection/fpTypes';
import { mkdirSync, writeFileSync } from 'fs';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`Assertion Failed: ${m}`);
}
type T = Extract<DrawEntity, { kind: 'text' }>;
const frameOf = (s: SheetInfo) => ({ x0: s.originX, y0: s.originY, x1: s.originX + s.paperWidthMm * s.scale, y1: s.originY + s.paperHeightMm * s.scale });
const inSheet = (d: Drawing, num: string): T[] => {
  const f = frameOf(d.sheets.find((s) => s.number === num)!);
  return d.entities.filter((e): e is T => e.kind === 'text' && e.x >= f.x0 && e.x <= f.x1 && e.y >= f.y0 && e.y <= f.y1);
};
const has = (ts: T[], s: string): boolean => ts.some((t) => t.text.toUpperCase().includes(s.toUpperCase()));
const sd = (over: Partial<NonNullable<FireDesignInput['standpipeDesign']>>): FireDesignInput => ({ ...DEFAULT_FIRE_INPUT, standpipeDesign: { ...DEFAULT_FIRE_INPUT.standpipeDesign!, ...over } });

console.log('=== Standpipe zoning drawings ===');
for (const [label, input] of [['no service floors', sd({ serviceFloorIds: [] })], ['service floor L4', sd({ serviceFloorIds: ['L4'] })], ['allow PRVs', sd({ prvStrategy: 'allow', serviceFloorIds: [] })]] as const) {
  const r = designFireProtectionSystem(input);
  const sp = r.standpipe!;
  const zn = sp.zoning;
  const d = generateFireDrawings(r);
  assert(d.sheets.some((s) => s.number === 'FP-111'), `${label}: FP-111 present`);
  const t106 = inSheet(d, 'FP-106');
  const sel = zn.selected === 'without-prv' ? zn.withoutPrv : zn.withPrv;
  for (const z of sel.zones) assert(t106.some((t) => t.text.toUpperCase().includes(`ZONE ${z.id}`) || t.text.toUpperCase().includes(`${z.id} `)), `${label}: FP-106 zone ${z.id} labelled`);
  if (zn.selected === 'without-prv') {
    assert(!t106.some((t) => /PRV SET/i.test(t.text)), `${label}: no PRV tags on FP-106`);
    if (sel.expressRisers > 0) assert(has(t106, 'EXPRESS RISER'), `${label}: express riser on FP-106`);
    for (const f of sel.serviceFloorStations) assert(has(t106, 'BREAK TANK') && has(t106, 'BOOSTER') && has(t106, f), `${label}: service-floor station ${f} on FP-106`);
  } else {
    const n = sp.risers.reduce((k, rr) => k + rr.outlets.filter((o) => o.prvRequired).length, 0);
    assert(t106.filter((t) => /PRV SET 175 PSI/i.test(t.text)).length >= n, `${label}: ${n} PRV tags`);
  }
  const t111 = inSheet(d, 'FP-111');
  for (const s of ['ZONING STUDY', 'WITH PRV', 'WITHOUT PRV', 'SELECTED', 'PUMP SETS', 'PRV', 'MAX STATIC', 'NFPA 14', 'SERVICE FLOOR']) assert(has(t111, s), `${label}: FP-111 "${s}"`);
  for (const z of [...zn.withPrv.zones, ...zn.withoutPrv.zones]) assert(t111.some((t) => t.text.includes(String(z.ratedNetPressurePsi))), `${label}: FP-111 shows zone pump ${z.ratedNetPressurePsi} psi`);
  assert(t111.some((t) => t.text.includes(String(zn.withPrv.prvCount))), `${label}: FP-111 shows the PRV count`);
  assert(writeDxf(d).includes('AC1009'), `${label}: DXF`);
  if (process.env.ZONE_OUT) {
    mkdirSync(process.env.ZONE_OUT, { recursive: true });
    writeFileSync(`${process.env.ZONE_OUT}/${label.replace(/\s+/g, '_')}.dxf`, writeDxf(d));
  }
  console.log(`✓ ${label}`);
}
console.log('\nAll standpipe zoning drawing tests passed.');
