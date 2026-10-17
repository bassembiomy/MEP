import { executeAirDistributionDesign, convertDesignResultToZonePayload, WALL_UNITS_MAX_CAPACITY_RATIO } from '../airDistributionEngine';
import { unitFootprintFt } from '../ducts/clearance';
import { distanceToPolygonEdge, isPointInPolygon } from '../geometry';
import { setEquipmentCatalogProvider, STANDARD_EQUIPMENT_CATALOG } from '../hvacCatalogs';
import { buildSections } from '../sections/sectionBuilder';
import { DEFAULT_VOID_IN, NECK_ALLOWANCE_IN, HANGER_GAP_IN, maxDuctDepthForVoid, neckAllowanceFor } from '../ceilingVoid';
import { designZone, zonePatchFromDesign } from '../../panels/zoneDesign';
import { decomposeConvex } from '../terminals/bayLayout';
import type { Zone, ProjectMetadata } from '../../store/projectStore';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}
console.log('=== Layout fixes (M1) ===');

const base = (poly: number[], area: number, sens: number, total: number, cfm: number, extra: object = {}): Parameters<typeof executeAirDistributionDesign>[0] => ({
  roomName: 'T', roomPolygon: poly, roomAreaSqFt: area, sensibleLoadBtu: sens, totalLoadBtu: total,
  requiredCfm: cfm, systemType: 'concealed', spaceTypeId: 'office', ...extra
});
const distToPoly = (x: number, y: number, poly: number[]): number => (isPointInPolygon(x, y, poly) ? 0 : distanceToPolygonEdge(x, y, poly));

// 1. high-wall L room: one unit per leg, sized to the load, ODU behind its own leg
{
  const L = [0, 0, 30, 0, 30, 15, 15, 15, 15, 30, 0, 30]; // 675 ft2
  const d = executeAirDistributionDesign(base(L, 675, 9500, 12400, 450, { systemType: 'high-wall', mountingWallSide: 'east' }));
  const legs = decomposeConvex(L);
  assert(legs.length === 2, 'L has two legs');
  assert(d.serviceZones.length === 2, `12.4k Btu/h L high-wall -> 2 units, got ${d.serviceZones.length}`);
  const ratio = d.selectedOption.totalDeliveredCapacityBtu / 12400;
  assert(ratio >= 1 && ratio <= WALL_UNITS_MAX_CAPACITY_RATIO + 1e-9, `capacity ratio ${ratio.toFixed(2)} within 1.0-1.3`);
  assert(d.outdoorUnitPositions.length === 2, 'one ODU per unit');
  // each indoor unit lies in its own leg and its ODU is behind that leg, not the other one
  d.serviceZones.forEach((z, i) => {
    const own = z.serviceAreaPolygon;
    const other = d.serviceZones[1 - i].serviceAreaPolygon;
    assert(distToPoly(z.equipmentPosition.x, z.equipmentPosition.y, own) <= 0.75, `unit ${i} sits in its own leg`);
    const odu = d.outdoorUnitPositions.find((o) => o.serves?.includes(z.id))!;
    assert(!!odu, `ODU of unit ${i}`);
    const dOwn = distToPoly(odu.x, odu.y, own), dOther = distToPoly(odu.x, odu.y, other);
    assert(dOwn <= 4 && dOwn <= dOther + 1e-6, `ODU ${i} adjacent to its own leg (own ${dOwn.toFixed(1)} ft, other ${dOther.toFixed(1)} ft)`);
    assert(!isPointInPolygon(odu.x, odu.y, L), 'ODU outside the room');
  });
  // loads follow the leg area share
  const sumS = d.serviceZones.reduce((a, z) => a + z.sensibleLoadBtu, 0);
  assert(Math.abs(sumS - 9500) < 1, 'leg sensible shares sum to the room load');
  assert(Array.isArray(d.designWarnings), 'designWarnings array exposed');

  // a load too small for one unit per leg: fewer units + a coverage design warning, never an oversized pair
  const small = executeAirDistributionDesign(base(L, 675, 4300, 6000, 250, { systemType: 'high-wall', mountingWallSide: 'east' }));
  assert(small.serviceZones.length === 1, `6k Btu/h L high-wall falls back to 1 unit, got ${small.serviceZones.length}`);
  assert(small.designWarnings!.some((w) => /High-wall coverage/.test(w)), `coverage warning: ${small.designWarnings?.join(' | ')}`);
  assert(convertDesignResultToZonePayload(small).designWarnings.length > 0, 'warning reaches the payload');

  // the old runaway: never 6 units / 4x capacity for a small load
  assert(d.selectedOption.unitCount <= 3, 'no runaway unit count');
}

// 2. section check agrees with the duct sizer (shared void allowances)
{
  assert(DEFAULT_VOID_IN === 24, 'default void is 24 in (600 mm)');
  assert(maxDuctDepthForVoid(24) === 24 - HANGER_GAP_IN - NECK_ALLOWANCE_IN, 'deep void: void - hanger - 8 in plenum');
  assert(maxDuctDepthForVoid(14) === 14 - HANGER_GAP_IN - neckAllowanceFor(14) && neckAllowanceFor(14) === 4, '14 in void: side-entry 4 in allowance');
  const project: ProjectMetadata = { name: 'T', location: 'T', scale: 10, units: 'imperial', outdoorDb: 95, indoorDb: 75 };
  const polys: Record<string, number[]> = {
    rect: [0, 0, 400, 0, 400, 250, 0, 250],
    L: [0, 0, 400, 0, 400, 160, 160, 160, 160, 400, 0, 400]
  };
  for (const [name, points] of Object.entries(polys)) {
    for (const sys of ['concealed', 'vrf'] as const) {
      for (const voidIn of [undefined, 14]) {
        const zone = { id: 'z1', name, points, spaceTypeId: 'office', ceilingHeight: 10, occupants: 0, systemType: sys, diffusers: [], ducts: [], ...(voidIn ? { maxAvailableCeilingDepthIn: voidIn } : {}) } as unknown as Zone;
        const { design, payload } = designZone(zone, [zone], project);
        const z2 = { ...zone, ...zonePatchFromDesign(zone, payload) } as Zone;
        const secs = buildSections(z2, { scale: 10, units: 'imperial' });
        // an unavoidable supply / return crossover is already flagged on the duct (it needs a vertical offset no void this shallow has)
        const crossing = new Set((z2.ducts ?? []).filter((x) => (x as { crossover?: boolean }).crossover).map((x) => x.id));
        const issues = secs.flatMap((s) => s.issues).filter((i) => !crossing.has(i.ductId));
        assert(issues.length === 0, `${name}/${sys}/void ${voidIn ?? 'default'}: section issues ${JSON.stringify(issues.map((i) => i.message))}`);
        const maxH = Math.max(...design.supplyDucts.concat(design.returnDucts).map((x) => x.heightIn));
        assert(maxH <= maxDuctDepthForVoid(voidIn ?? DEFAULT_VOID_IN) + 1e-9, `${name}: duct depth ${maxH} within the void allowance`);
      }
    }
  }
}

// 3. plenum return grilles keep >= 3 ft (footprint EDGE, not centre) from every indoor unit, in bay / leg layouts too
{
  const Ls = [
    [0, 0, 30, 0, 30, 15, 15, 15, 15, 30, 0, 30],
    [0, 0, 24, 0, 24, 12, 12, 12, 12, 24, 0, 24],
    [0, 0, 40, 0, 40, 16, 16, 16, 16, 40, 0, 40]
  ];
  for (const L of Ls) for (const ton of [3, 5, 8]) {
    const d = executeAirDistributionDesign(base(L, 675, ton * 9000, ton * 12000, ton * 400, { mountingWallSide: 'east' }));
    assert(d.returnStrategy === 'plenum', 'L concealed uses plenum returns');
    for (const r of d.returnTerminals) for (const z of d.serviceZones) {
      const fp = unitFootprintFt(z.equipmentPosition, d.unitFootprintsIn?.[z.id]);
      const dx = Math.max(fp.minX - r.position.x, 0, r.position.x - fp.maxX), dy = Math.max(fp.minY - r.position.y, 0, r.position.y - fp.maxY);
      const edge = Math.hypot(dx, dy);
      assert(edge >= 3 - 0.01, `${r.id} is ${edge.toFixed(2)} ft from ${z.unitTag} footprint edge (L ${L.length / 2} pts, ${ton} ton)`);
    }
  }
}

// 4. VRF: indoor units of the outdoor manufacturer; mixed pairing is warned
{
  const RECT = [0, 0, 40, 0, 40, 25, 0, 25];
  const dflt = executeAirDistributionDesign(base(RECT, 1000, 45000, 60000, 2000, { systemType: 'vrf' }));
  const indoorMaker = dflt.selectedOption.equipmentDetails.catalogItem.manufacturer;
  assert(/REYQ/.test(dflt.outdoorModel ?? ''), 'VRF outdoor module');
  if (!(dflt.outdoorModel ?? '').startsWith(indoorMaker)) {
    assert(dflt.designWarnings!.some((w) => /different manufacturers/.test(w)), `mixed-manufacturer pairing is a design warning: ${dflt.designWarnings?.join(' | ')}`);
  }
  // a Daikin concealed family in the catalog is preferred over the Carrier one
  const daikinIndoor = STANDARD_EQUIPMENT_CATALOG.filter((e) => e.systemType === 'concealed').map((e) => ({
    ...e, id: `dk-${e.id}`, manufacturer: 'Daikin', model: e.model.replace('42QSS', 'FXSQ')
  }));
  setEquipmentCatalogProvider(() => [...STANDARD_EQUIPMENT_CATALOG, ...daikinIndoor]);
  try {
    const dk = executeAirDistributionDesign(base(RECT, 1000, 45000, 60000, 2000, { systemType: 'vrf' }));
    assert(dk.selectedOption.equipmentDetails.catalogItem.manufacturer === 'Daikin', `indoor manufacturer ${dk.selectedOption.equipmentDetails.catalogItem.manufacturer} == outdoor`);
    assert((dk.outdoorModel ?? '').startsWith('Daikin'), 'outdoor Daikin');
    assert(!(dk.designWarnings ?? []).some((w) => /different manufacturers/.test(w)), 'no mixed-manufacturer warning');
  } finally {
    setEquipmentCatalogProvider(null);
  }
}

// 5. unit tags
{
  const d = executeAirDistributionDesign(base([0, 0, 40, 0, 40, 25, 0, 25], 1000, 90000, 120000, 4000));
  const p = convertDesignResultToZonePayload(d);
  assert(p.unitTags.length === d.serviceZones.length && p.unitTags.every((t, i) => t === d.serviceZones[i].unitTag && /^FCU-\d+$/.test(t)), `unitTags ${p.unitTags.join(',')}`);
  const project: ProjectMetadata = { name: 'T', location: 'T', scale: 10, units: 'imperial', outdoorDb: 95, indoorDb: 75 };
  const zone = { id: 'z9', name: 'R', points: [0, 0, 400, 0, 400, 250, 0, 250], spaceTypeId: 'office', ceilingHeight: 10, occupants: 0, systemType: 'concealed', diffusers: [], ducts: [] } as unknown as Zone;
  const dz = designZone(zone, [zone], project);
  const patch = zonePatchFromDesign(zone, dz.payload);
  assert(Array.isArray(patch.unitTags) && patch.unitTags.length === dz.design.serviceZones.length && patch.unitTags[0] === 'FCU-01', 'zone patch stores unitTags');
}

console.log('✔ Layout fixes (M1) passed');
