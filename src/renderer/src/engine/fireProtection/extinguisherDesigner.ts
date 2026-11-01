/**
 * Portable fire extinguisher design — NFPA 10-2022 (selection §5, distribution §6, mounting §6.1.3.8)
 * with IFC §906. Units are placed on a uniform grid of cell centres so that the worst direct distance
 * to the nearest unit (half the cell diagonal) stays within the allowed travel distance.
 */
import {
  BuildingInput,
  DesignCheck,
  ExtinguisherCandidate,
  ExtinguisherSystemDesign,
  ExtinguisherUnitType,
  ExtinguisherZoneDesign,
  ExtinguisherZoneInput,
  FireDesignInput,
  PlacedExtinguisher
} from './fpTypes';
import {
  FE_CATALOG,
  FE_DEEP_B_PER_FT2,
  FE_DEEP_MAX_SURFACE_FT2,
  FE_HAZARD,
  FE_HEAVY_LB,
  FE_HEAVY_MOUNT_TOP_MAX_MM,
  FE_K_FRYERS_PER_UNIT,
  FE_K_MAX_FRYER_LB,
  FE_LIGHT_MOUNT_TOP_MAX_MM,
  FE_MAX_AREA_PER_UNIT_FT2,
  FE_MIN_BOTTOM_CLEARANCE_MM,
  FE_TRAVEL_A_FT,
  FE_TRAVEL_B_LONG_FT,
  FE_TRAVEL_B_SHORT_FT,
  FE_TRAVEL_D_FT,
  FE_TRAVEL_K_FT
} from './standards/nfpa10';

const M_TO_FT = 3.28084;
const M2_TO_FT2 = 10.7639;
const EPS = 1e-9;
const REF_A = 'NFPA 10-2022 Table 6.2.1.1';
const REF_B = 'NFPA 10-2022 Table 6.3.1.1';

const halfDiag = (l: number, w: number): number => 0.5 * Math.sqrt(l * l + w * w);

/**
 * Smallest uniform grid nx × ny (1…50 each) whose cell centres give a worst direct distance
 * (½·√((L/nx)² + (W/ny)²)) ≤ maxTravelFt and a cell area ≤ maxAreaFt2, with at least minCount cells.
 * Minimises (count, |cell length − cell width|, nx).
 */
export function coverageGrid(
  lengthFt: number,
  widthFt: number,
  maxTravelFt: number,
  maxAreaFt2: number,
  minCount = 1
): { nx: number; ny: number; maxTravelActualFt: number } {
  let best: { nx: number; ny: number; key: [number, number, number] } | null = null;
  for (let nx = 1; nx <= 50; nx++) {
    for (let ny = 1; ny <= 50; ny++) {
      if (nx * ny < minCount) continue;
      const cl = lengthFt / nx;
      const cw = widthFt / ny;
      if (halfDiag(cl, cw) > maxTravelFt + EPS || cl * cw > maxAreaFt2 + EPS) continue;
      const key: [number, number, number] = [nx * ny, Math.abs(cl - cw), nx];
      if (
        !best ||
        key[0] < best.key[0] ||
        (key[0] === best.key[0] && (key[1] < best.key[1] - 1e-12 || (Math.abs(key[1] - best.key[1]) <= 1e-12 && key[2] < best.key[2])))
      ) {
        best = { nx, ny, key };
      }
    }
  }
  const nx = best ? best.nx : 50;
  const ny = best ? best.ny : 50;
  return { nx, ny, maxTravelActualFt: halfDiag(lengthFt / nx, widthFt / ny) };
}

const unitById = (id: string): ExtinguisherUnitType => FE_CATALOG.find((u) => u.id === id)!;
const catalogIndex = (id: string): number => FE_CATALOG.findIndex((u) => u.id === id);

function mountTop(unit: ExtinguisherUnitType): number {
  return unit.wheeled ? unit.heightMm : unit.grossWeightLb <= FE_HEAVY_LB ? 1200 : 1000;
}

function place(
  zone: ExtinguisherZoneInput,
  unit: ExtinguisherUnitType,
  purpose: PlacedExtinguisher['purpose'],
  nx: number,
  ny: number,
  radiusFt: number
): PlacedExtinguisher[] {
  const out: PlacedExtinguisher[] = [];
  const top = mountTop(unit);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      out.push({
        tag: '',
        zoneId: zone.id,
        floorId: zone.floorId,
        unitId: unit.id,
        purpose,
        xM: ((ix + 0.5) * zone.lengthM) / nx,
        yM: ((iy + 0.5) * zone.widthM) / ny,
        coverageRadiusFt: radiusFt,
        mounting: unit.wheeled ? 'wheeled' : zone.mounting,
        mountingTopMm: top,
        bottomClearanceMm: top - unit.heightMm
      });
    }
  }
  return out;
}

/** Design the extinguishers of one zone (tags are assigned later by designExtinguishers). */
export function designExtinguisherZone(zone: ExtinguisherZoneInput): ExtinguisherZoneDesign {
  const hz = FE_HAZARD[zone.hazard];
  const lengthFt = zone.lengthM * M_TO_FT;
  const widthFt = zone.widthM * M_TO_FT;
  const areaFt2 = lengthFt * widthFt;
  const notes: string[] = [];
  const checks: DesignCheck[] = [];
  const spill = zone.classB === 'spill';
  const deep = zone.classB === 'deep';
  const needsGeneral = zone.classA || zone.classB !== 'none' || zone.classC;

  const surfaceFt2 = deep ? zone.deepLayerSurfaceM2 * M2_TO_FT2 : 0;
  const deepReq = deep ? Math.ceil(FE_DEEP_B_PER_FT2 * surfaceFt2 - 1e-9) : 0;
  const deepOk = deep ? surfaceFt2 <= FE_DEEP_MAX_SURFACE_FT2 : true;

  let candidates: ExtinguisherCandidate[] = [];
  let selected: ExtinguisherUnitType | null = null;
  let selectedGrid = { nx: 0, ny: 0, maxTravelActualFt: 0 };
  let selectedTravel = 0;
  let selectedMaxArea: number | null = null;

  if (needsGeneral) {
    const feasible: { unit: ExtinguisherUnitType; cand: ExtinguisherCandidate; travel: number; maxArea: number; actual: number }[] = [];
    for (const u of FE_CATALOG) {
      if (u.wheeled || u.kRated || u.dRated) continue;
      if (zone.classA && u.aRating < hz.minA) continue;
      if (spill && u.bRating < hz.bShort) continue;
      if (deep && (!deepOk || u.bRating < deepReq)) continue;
      if (zone.classC && !u.cRated) continue;
      if (zone.sensitiveElectronics && u.agent !== 'co2' && u.agent !== 'clean-agent') continue;
      let travel = Infinity;
      if (zone.classA) travel = Math.min(travel, FE_TRAVEL_A_FT);
      if (spill) travel = Math.min(travel, u.bRating >= hz.bLong ? FE_TRAVEL_B_LONG_FT : FE_TRAVEL_B_SHORT_FT);
      if (deep) travel = Math.min(travel, 50);
      if (!Number.isFinite(travel)) travel = 75;
      const maxArea = zone.classA ? Math.min(u.aRating * hz.areaPerAFt2, FE_MAX_AREA_PER_UNIT_FT2) : Infinity;
      const g = coverageGrid(lengthFt, widthFt, travel, maxArea);
      feasible.push({
        unit: u,
        travel,
        maxArea,
        actual: g.maxTravelActualFt,
        cand: { unitId: u.id, count: g.nx * g.ny, nx: g.nx, ny: g.ny, maxTravelFt: travel }
      });
    }
    feasible.sort(
      (p, q) =>
        p.cand.count - q.cand.count ||
        p.unit.grossWeightLb - q.unit.grossWeightLb ||
        catalogIndex(p.unit.id) - catalogIndex(q.unit.id)
    );
    candidates = feasible.map((f) => f.cand);
    if (feasible.length) {
      const f = feasible[0];
      selected = f.unit;
      selectedGrid = { nx: f.cand.nx, ny: f.cand.ny, maxTravelActualFt: f.actual };
      selectedTravel = f.travel;
      selectedMaxArea = Number.isFinite(f.maxArea) ? f.maxArea : null;
    }
  }

  const placed: PlacedExtinguisher[] = [];
  if (selected) placed.push(...place(zone, selected, 'general', selectedGrid.nx, selectedGrid.ny, selectedTravel));

  // Class K (§6.6)
  let kUnits = 0;
  let kActual = 0;
  if (zone.fryers > 0) {
    const need = Math.ceil(zone.fryers / FE_K_FRYERS_PER_UNIT);
    const g = coverageGrid(lengthFt, widthFt, FE_TRAVEL_K_FT, Infinity, need);
    kUnits = g.nx * g.ny;
    kActual = g.maxTravelActualFt;
    placed.push(...place(zone, unitById('WETCHEM-6L'), 'class-k', g.nx, g.ny, FE_TRAVEL_K_FT));
  }
  // Class D (§6.5)
  let dUnits = 0;
  let dActual = 0;
  if (zone.classD) {
    const g = coverageGrid(lengthFt, widthFt, FE_TRAVEL_D_FT, Infinity);
    dUnits = Math.max(1, g.nx * g.ny);
    dActual = g.maxTravelActualFt;
    placed.push(...place(zone, unitById('CLASSD-30'), 'class-d', g.nx, g.ny, FE_TRAVEL_D_FT));
  }

  // Requirement texts
  let bRequirement: string | null = null;
  let minBRating: number | null = null;
  if (spill) {
    bRequirement = `${hz.bLong}-B @ 50 ft or ${hz.bShort}-B @ 30 ft (spill)`;
    minBRating = hz.bShort;
  } else if (deep) {
    minBRating = deepReq;
    bRequirement = `${deepReq}-B @ 50 ft (appreciable depth, ${surfaceFt2.toFixed(1)} ft²)`;
  }

  const base = zone.id;
  const count = selected ? selectedGrid.nx * selectedGrid.ny : 0;
  const mk = (id: string, title: string, reference: string, status: DesignCheck['status'], detail: string): void => {
    checks.push({ id: `${id}:${base}`, title: `${title} — ${zone.name}`, reference, status, detail });
  };
  const noUnit = 'no listed catalog unit satisfies all requirements of this zone';

  if (zone.classA) {
    mk('fe-a-rating', 'Class A extinguisher rating', REF_A, selected && selected.aRating >= hz.minA ? 'pass' : 'fail',
      selected
        ? `${selected.id} is ${selected.aRating}-A; minimum single rating for ${hz.label} is ${hz.minA}-A`
        : `minimum ${hz.minA}-A required — ${noUnit}`);
    mk('fe-a-area', 'Class A floor area per extinguisher', REF_A,
      selected && selectedMaxArea !== null && selectedMaxArea * count + EPS >= areaFt2 ? 'pass' : 'fail',
      selected
        ? `${count} × ${Math.round(selectedMaxArea ?? 0)} ft² (min(${selected.aRating}-A × ${hz.areaPerAFt2} ft² per A, ${FE_MAX_AREA_PER_UNIT_FT2} ft²)) = ${Math.round(count * (selectedMaxArea ?? 0))} ft² ≥ zone area ${Math.round(areaFt2)} ft²`
        : `zone area ${Math.round(areaFt2)} ft² — ${noUnit}`);
  }
  if (spill || deep) {
    mk('fe-b-rating', 'Class B extinguisher rating', deep ? 'NFPA 10-2022 §6.3.2' : REF_B,
      selected && selected.bRating >= (minBRating ?? 0) ? 'pass' : 'fail',
      selected
        ? `${selected.id} is ${selected.bRating}-B; required ${bRequirement}`
        : `required ${bRequirement} — ${noUnit}`);
  }
  if (deep) {
    mk('fe-deep-b', 'Flammable liquid of appreciable depth', 'NFPA 10-2022 §6.3.2',
      deepOk ? 'pass' : 'fail',
      deepOk
        ? `liquid surface ${surfaceFt2.toFixed(1)} ft² ≤ ${FE_DEEP_MAX_SURFACE_FT2} ft²; ${FE_DEEP_B_PER_FT2}-B per ft² gives ${deepReq}-B`
        : `liquid surface ${surfaceFt2.toFixed(1)} ft² exceeds ${FE_DEEP_MAX_SURFACE_FT2} ft² — fixed system required, NFPA 10 §6.3.2`);
  }
  if (zone.classC) {
    const ok = !!selected && selected.cRated && !(zone.sensitiveElectronics && selected.agent === 'dry-chemical-abc');
    mk('fe-c-agent', 'Class C agent (non-conductive)', 'NFPA 10-2022 §6.4, §5.5.4',
      ok ? 'pass' : 'fail',
      selected
        ? `${selected.id} (${selected.ratingText}) is C-rated${zone.sensitiveElectronics ? '; delicate electronics — dry chemical not used, CO2 or clean agent selected' : ''}`
        : `C-rated unit required — ${noUnit}`);
  }
  if (zone.fryers > 0) {
    const heavy = zone.maxFryerOilLb > FE_K_MAX_FRYER_LB;
    mk('fe-k', 'Class K extinguishers for cooking appliances', 'NFPA 10-2022 §6.6',
      heavy ? 'warn' : 'pass',
      heavy
        ? `${zone.fryers} fryer(s), largest ${zone.maxFryerOilLb} lb > ${FE_K_MAX_FRYER_LB} lb — Class K size per manufacturer; ${kUnits} × WETCHEM-6L provided within ${FE_TRAVEL_K_FT} ft`
        : `${zone.fryers} fryer(s) ≤ ${FE_K_MAX_FRYER_LB} lb each: ${kUnits} × WETCHEM-6L (1 per ${FE_K_FRYERS_PER_UNIT} fryers) within ${FE_TRAVEL_K_FT} ft, worst distance ${kActual.toFixed(1)} ft`);
  }
  if (zone.classD) {
    mk('fe-d', 'Class D extinguisher for combustible metal', 'NFPA 10-2022 §6.5',
      'pass',
      `${dUnits} × CLASSD-30 for ${zone.dMetal || 'combustible metal'} within ${FE_TRAVEL_D_FT} ft, worst distance ${dActual.toFixed(1)} ft — size agent per manufacturer for the metal`);
  }
  if (placed.length) {
    const parts: string[] = [];
    let ok = true;
    if (selected) {
      parts.push(`general ${selectedGrid.maxTravelActualFt.toFixed(1)} ft ≤ ${selectedTravel} ft`);
      ok = ok && selectedGrid.maxTravelActualFt <= selectedTravel + 1e-6;
    }
    if (kUnits) {
      parts.push(`Class K ${kActual.toFixed(1)} ft ≤ ${FE_TRAVEL_K_FT} ft`);
      ok = ok && kActual <= FE_TRAVEL_K_FT + 1e-6;
    }
    if (dUnits) {
      parts.push(`Class D ${dActual.toFixed(1)} ft ≤ ${FE_TRAVEL_D_FT} ft`);
      ok = ok && dActual <= FE_TRAVEL_D_FT + 1e-6;
    }
    mk('fe-travel', 'Travel distance to nearest extinguisher', 'NFPA 10-2022 §6.2.1.1, §6.3.1.1, §6.5, §6.6 (direct distance — verify walking travel)',
      ok ? 'pass' : 'fail', `worst direct distance (half cell diagonal): ${parts.join('; ')}`);
    let mountOk = true;
    for (const e of placed) {
      const u = unitById(e.unitId);
      const lim = u.wheeled ? Infinity : u.grossWeightLb <= FE_HEAVY_LB ? FE_LIGHT_MOUNT_TOP_MAX_MM : FE_HEAVY_MOUNT_TOP_MAX_MM;
      if (e.mountingTopMm > lim || (!u.wheeled && e.bottomClearanceMm < FE_MIN_BOTTOM_CLEARANCE_MM)) mountOk = false;
    }
    const tops = [...new Set(placed.map((e) => e.mountingTopMm))].sort((a, b) => a - b);
    const bots = placed.map((e) => e.bottomClearanceMm);
    mk('fe-mounting', 'Mounting height and bottom clearance', 'NFPA 10-2022 §6.1.3.8',
      mountOk ? 'pass' : 'fail',
      `top of unit at ${tops.join(' / ')} mm (limits ${FE_LIGHT_MOUNT_TOP_MAX_MM} mm for ≤ ${FE_HEAVY_LB} lb, ${FE_HEAVY_MOUNT_TOP_MAX_MM} mm above); bottom clearance ≥ ${Math.min(...bots)} mm (min ${FE_MIN_BOTTOM_CLEARANCE_MM} mm)`);
  }

  if (needsGeneral && selected) {
    notes.push(`Selected ${selected.id} (${selected.ratingText}): ${count} unit(s) on a ${selectedGrid.nx} × ${selectedGrid.ny} grid.`);
  }
  if (deep && !deepOk) notes.push('Portable extinguishers may not be the sole protection — provide a fixed system (NFPA 10 §6.3.2).');
  notes.push('Travel distance is direct; verify actual walking travel on the architectural plan.');

  return {
    zoneId: zone.id,
    zoneName: zone.name,
    floorId: zone.floorId,
    hazard: zone.hazard,
    lengthFt,
    widthFt,
    areaFt2,
    minARating: zone.classA ? hz.minA : null,
    areaPerAFt2: zone.classA ? hz.areaPerAFt2 : null,
    maxAreaPerUnitFt2: zone.classA && selected ? selectedMaxArea : null,
    bRequirement,
    minBRating,
    maxTravelFt: selectedTravel,
    selectedUnitId: selected ? selected.id : null,
    count,
    grid: { nx: selectedGrid.nx, ny: selectedGrid.ny },
    maxTravelActualFt: selectedGrid.maxTravelActualFt,
    kUnits,
    dUnits,
    candidates,
    extinguishers: placed,
    notes,
    checks
  };
}

/** Design all zones, assign tags, totals and system checks. Null when the input has no extinguisher data. */
export function designExtinguishers(input: FireDesignInput): ExtinguisherSystemDesign | null {
  if (!input.extinguishers) return null;
  const zones = input.extinguishers.zones.map(designExtinguisherZone);

  const seq = new Map<string, number>();
  for (const z of zones) {
    const order = (p: string): PlacedExtinguisher[] => z.extinguishers.filter((e) => e.purpose === p);
    const tagged = [...order('general'), ...order('class-k'), ...order('class-d')].map((e) => {
      const n = (seq.get(e.floorId) ?? 0) + 1;
      seq.set(e.floorId, n);
      return { ...e, tag: `FE-${e.floorId}-${String(n).padStart(2, '0')}` };
    });
    z.extinguishers = tagged;
  }

  const qty = new Map<string, number>();
  for (const z of zones) for (const e of z.extinguishers) qty.set(e.unitId, (qty.get(e.unitId) ?? 0) + 1);
  const totals = FE_CATALOG.filter((u) => (qty.get(u.id) ?? 0) > 0).map((u) => ({
    unitId: u.id,
    label: u.label,
    ratingText: u.ratingText,
    qty: qty.get(u.id)!
  }));
  const totalCount = totals.reduce((s, t) => s + t.qty, 0);

  const floorsCovered: string[] = [];
  for (const z of zones) if (!floorsCovered.includes(z.floorId)) floorsCovered.push(z.floorId);

  const withUnits = new Set(zones.filter((z) => z.extinguishers.length > 0).map((z) => z.floorId));
  const floorsMissing = (input.building?.floors ?? []).filter((f) => !f.isRoof && !withUnits.has(f.id)).map((f) => f.id);

  const checks: DesignCheck[] = [];
  checks.push({
    id: 'fe-every-floor',
    title: 'Extinguisher on every occupied floor',
    reference: 'IFC §906.1; NFPA 10-2022 §6.1',
    status: floorsMissing.length ? 'fail' : 'pass',
    detail: input.building
      ? floorsMissing.length
        ? `no extinguisher on floor(s): ${floorsMissing.join(', ')}`
        : `all ${input.building.floors.filter((f) => !f.isRoof).length} occupied floors have at least one extinguisher`
      : 'no building defined — floors taken from the zone list'
  });
  checks.push({
    id: 'fe-total',
    title: 'Extinguisher quantities',
    reference: 'NFPA 10-2022 Ch. 6',
    status: 'pass',
    detail: `${totalCount} extinguishers in ${zones.length} zones: ${totals.map((t) => `${t.qty} × ${t.unitId}`).join(', ') || 'none'}`
  });
  checks.push({
    id: 'fe-inspection',
    title: 'Inspection and maintenance schedule',
    reference: 'NFPA 10-2022 Ch. 7, Ch. 8, Table 8.3.1',
    status: 'pass',
    detail:
      'monthly inspection (§7.2), annual maintenance (§7.3), 6-year internal examination of stored-pressure dry chemical (§7.3.3), hydrostatic test every 5 years (water, AFFF, wet chemical, CO2) or 12 years (dry chemical, clean agent, dry powder)'
  });

  return { catalog: FE_CATALOG.map((u) => ({ ...u })), zones, totals, totalCount, floorsCovered, floorsMissing, checks };
}

/** One extinguisher zone per non-roof floor from the building usage (4:3 plan, Class A, spill for parking/garage). */
export function generateExtinguisherZonesFromFloors(building: BuildingInput): ExtinguisherZoneInput[] {
  return building.floors
    .filter((f) => !f.isRoof)
    .map((f) => {
      const u = f.usage.toLowerCase();
      const ordinary = ['park', 'plant', 'garage', 'storage', 'retail'].some((k) => u.includes(k));
      const w = Math.sqrt((f.areaM2 * 3) / 4);
      const l = f.areaM2 / w;
      const r1 = (v: number): number => Math.round(v * 10) / 10;
      return {
        id: `Z-${f.id}`,
        name: f.usage,
        floorId: f.id,
        hazard: ordinary ? 'ordinary' : 'light',
        lengthM: r1(l),
        widthM: r1(w),
        classA: true,
        classB: u.includes('park') || u.includes('garage') ? 'spill' : 'none',
        deepLayerSurfaceM2: 0,
        classC: false,
        sensitiveElectronics: false,
        classD: false,
        dMetal: '',
        fryers: 0,
        maxFryerOilLb: 0,
        mounting: 'bracket'
      } as ExtinguisherZoneInput;
    });
}
