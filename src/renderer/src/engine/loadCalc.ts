import { Zone, ProjectMetadata } from '../store/projectStore';
import { ASHRAE_SPACE_TYPES, DEFAULT_U_VALUES, DEFAULT_GLASS } from './knowledgeBase';
import { isImperial as isImp, pxPerFt, SQFT_PER_SQM, M_PER_FT, LPS_PER_CFM, CFM_PER_LPS, BTUH_PER_W, BTUH_PER_TON } from './units';
import { DEFAULT_EZ_COOLING_CEILING } from './outdoorAir/outdoorAirCalculator';
import { FT_PER_M } from './units';
import { calculatePolygonArea, calculatePolygonPerimeter } from './geometry';

export interface LoadResult {
  area: number; // sqft or sqm
  perimeter: number; // ft or m
  occupants: number;
  // NOTE: legacy fields sensibleLoad/latentLoad/totalLoad/supplyCfm (and the other CFM/area fields)
  // stay in PROJECT units (Btu/h + CFM imperial, W + L/s metric). Use the explicit *Btuh / *W
  // fields below when a fixed unit is needed.
  sensibleLoad: number; // project units: Btu/h or W
  latentLoad: number; // project units: Btu/h or W
  totalLoad: number; // project units: Btu/h or W
  sensibleHeatRatio: number; // SHR = Qs / Qt
  totalTons: number; // Tonnage (1 TR = 12000 Btu/h or 3.517 kW)
  supplyCfm: number; // project units: Supply Airflow CFM or L/s
  thermalCfm: number; // Sensible thermal CFM or L/s
  vbzCfm: number; // Breathing zone ventilation CFM or L/s
  vozCfm: number; // Zone outdoor air intake CFM or L/s (Vbz / Ez)
  oaFraction: number; // Voz / Supply CFM
  oaCfm: number; // Outdoor air CFM or L/s
  exhaustCfm: number; // Exhaust CFM or L/s
  returnCfm: number; // Return CFM or L/s
  // --- Room vs. coil load split (ASHRAE: OA is a coil/system load, not a room load) ---
  // *Btuh fields are ALWAYS Btu/h; *W twins are ALWAYS watts, regardless of project units.
  roomSensibleBtuh?: number; // envelope + internal, NO outdoor air (Btu/h)
  roomLatentBtuh?: number; // Btu/h
  oaSensibleBtuh?: number; // outdoor-air sensible (coil load), Btu/h
  oaLatentBtuh?: number; // outdoor-air latent (coil load), Btu/h
  coilTotalBtuh?: number; // room + OA total, Btu/h (equals totalLoad when project is imperial)
  roomSensibleW?: number; // W
  roomLatentW?: number;
  oaSensibleW?: number;
  oaLatentW?: number;
  coilTotalW?: number;
  /** Data-quality / fallback notes (unknown space type, bad scale, ...). */
  warnings?: string[];
}

/**
 * Optional zone fields understood by the load calc but not part of the stored Zone interface.
 * All are read via optional chaining so existing zones keep working.
 */
interface ZoneLoadExtras {
  glassAreaSqFt?: number; // window area on exterior walls (ft²)
  glassShgc?: number;
  glassSolarFactorBtuhFt2?: number;
  exteriorWallLengthFt?: number; // length of exterior wall (ft); default = 50% of perimeter
  hasRoof?: boolean; // false => interior floor, no roof load. Default true (conservative top-floor).
  isTopFloor?: boolean; // alias of hasRoof
  fixtureCount?: number; // toilet fixtures for exhaust sizing
}

/**
 * Calculates cooling loads and authoritative airflow per ASHRAE Fundamentals and ASHRAE 62.1-2019.
 *
 * Internals are IMPERIAL (ft, ft², CFM, Btu/h) and converted to project units at the end.
 * Outdoor air is a COIL load: supply CFM is sized from the ROOM sensible load only.
 */
export function calculateZoneLoad(zone: Zone, project: ProjectMetadata): LoadResult {
  const warnings: string[] = [];
  const imperial = isImp(project.units);
  const extras = zone as unknown as ZoneLoadExtras;

  let spaceType = ASHRAE_SPACE_TYPES.find(t => t.id === zone.spaceTypeId);
  if (!spaceType) {
    spaceType = ASHRAE_SPACE_TYPES[0];
    warnings.push(`Unknown space type "${zone.spaceTypeId}": fell back to "${spaceType.id}" ventilation and internal-gain defaults.`);
  }

  // 1. Area & perimeter in ft (units.pxPerFt defends against scale 0 / NaN)
  if (!(Number.isFinite(project.scale) && project.scale > 0)) {
    warnings.push(`Invalid drawing scale (${project.scale}); assumed 10 px per unit.`);
  }
  const ppf = pxPerFt(project.scale, project.units);
  const areaFt2 = calculatePolygonArea(zone.points) / (ppf * ppf);
  const perimeterFt = calculatePolygonPerimeter(zone.points) / ppf;

  // 2. Occupants: explicit user value only if > 0, else ASHRAE density x area
  const calculatedOccupants = spaceType.density > 0
    ? Math.max(1, Math.ceil((areaFt2 * spaceType.density) / 1000))
    : 0;
  const occupants = zone.occupants != null && zone.occupants > 0 ? zone.occupants : calculatedOccupants;

  // Design temperature difference in deg F (metric inputs are deg C)
  const dtRaw = Math.max(0, project.outdoorDb - project.indoorDb);
  const deltaT = imperial ? dtRaw : dtRaw * 1.8;

  // 3. Envelope conduction
  const hasRoof = extras.hasRoof ?? extras.isTopFloor ?? true; // legacy behaviour: roof load always applied
  const glassArea = Math.max(0, extras.glassAreaSqFt ?? 0);
  const wallLen = extras.exteriorWallLengthFt ?? perimeterFt * 0.5; // legacy: 50% of perimeter exposed
  // zone.ceilingHeight is in project length units (m for metric)
  const ceilingFt = imperial ? zone.ceilingHeight : zone.ceilingHeight * FT_PER_M;
  const grossWall = wallLen * ceilingFt;
  const netWall = Math.max(0, grossWall - glassArea);
  const wallSensible = DEFAULT_U_VALUES.wall * netWall * deltaT;
  const roofSensible = hasRoof ? DEFAULT_U_VALUES.roof * areaFt2 * deltaT : 0;
  const glassConduction = DEFAULT_U_VALUES.glass * glassArea * deltaT;
  const glassSolar = (extras.glassShgc ?? DEFAULT_GLASS.shgc) * glassArea
    * (extras.glassSolarFactorBtuhFt2 ?? DEFAULT_GLASS.solarFactorBtuhFt2);

  // 4. Internal loads (Btu/h)
  const peopleSensible = occupants * spaceType.sensibleGain;
  const peopleLatent = occupants * spaceType.latentGain;
  // Overrides are expressed in W/ft² (imperial) or W/m² (metric)
  const wPerFt2 = (override: number | undefined, def: number): number =>
    override !== undefined ? (imperial ? override : override / SQFT_PER_SQM) : def;
  const lightingSensible = BTUH_PER_W * areaFt2 * wPerFt2(zone.lightingOverride, spaceType.lightingDensity);
  const equipmentSensible = BTUH_PER_W * areaFt2 * wPerFt2(zone.equipmentOverride, spaceType.equipmentDensity);

  // 5. ASHRAE 62.1-2019: Vbz = Rp*Pz + Ra*Az, computed in CFM then converted to project units
  const vbzCfm = spaceType.rp * occupants + spaceType.ra * areaFt2;
  const ez = DEFAULT_EZ_COOLING_CEILING; // ASHRAE 62.1 Table 6-4, ceiling supply of cool air
  const vozCfm = vbzCfm / ez;

  const oaSensible = 1.08 * vozCfm * deltaT;
  const oaLatent = 4840 * vozCfm * 0.005; // 0.005 lb/lb humidity-ratio delta

  // 6. Room vs coil loads
  let roomSensible = wallSensible + roofSensible + glassConduction + glassSolar + peopleSensible + lightingSensible + equipmentSensible;
  let roomLatent = peopleLatent;
  let coilSensible = roomSensible + oaSensible;
  let coilLatent = roomLatent + oaLatent;

  if (zone.manualCoolingOverride !== undefined) {
    // Manual override is the total coil load (legacy semantics), split 75/25 sensible/latent.
    const ovr = imperial ? zone.manualCoolingOverride : zone.manualCoolingOverride * BTUH_PER_W;
    coilSensible = ovr * 0.75;
    coilLatent = ovr * 0.25;
    roomSensible = Math.max(0, coilSensible - oaSensible);
    roomLatent = Math.max(0, coilLatent - oaLatent);
  }

  const coilTotal = coilSensible + coilLatent;
  const shr = coilTotal > 0 ? coilSensible / coilTotal : 1.0;
  const totalTons = coilTotal / BTUH_PER_TON;

  // 7. Supply airflow from ROOM sensible only: Q = Qs_room / (1.08 * dT_supply), dT_supply = 20 F
  const supplyDeltaT = 20.0;
  const thermalCfm = roomSensible > 0 ? roomSensible / (1.08 * supplyDeltaT) : 0;

  // RULING: DX/refrigerant coils need >= ~350 CFM/ton across the coil (coil tons include OA load),
  // so design airflow = max(thermal, Voz, 350 x coil tons). Chilled-water systems size on thermal/OA only.
  const sysType = String(zone.systemType ?? '').toLowerCase();
  const isDx = !['chilled-water', 'cwu', 'ahu', 'fcu'].includes(sysType);
  const coilMinCfm = isDx ? 350 * totalTons : 0;
  let calculatedSupply = Math.max(thermalCfm, vozCfm, coilMinCfm);
  if (coilTotal > 0 && calculatedSupply < 100) calculatedSupply = 100;

  const finalSupplyCfm = zone.manualCfmOverride !== undefined
    ? (imperial ? zone.manualCfmOverride : zone.manualCfmOverride * CFM_PER_LPS)
    : calculatedSupply;
  const oaFraction = finalSupplyCfm > 0 ? Math.min(1.0, vozCfm / finalSupplyCfm) : 0;

  // 8. Exhaust (62.1 Table 6-4 style: per fixture, else per ft² with a minimum)
  let exhaustCfm = 0;
  if (spaceType.exhaustCfmPerFixture !== undefined || spaceType.exhaustCfmPerSqFt !== undefined) {
    const byFixture = extras.fixtureCount && spaceType.exhaustCfmPerFixture
      ? extras.fixtureCount * spaceType.exhaustCfmPerFixture : 0;
    const byArea = (spaceType.exhaustCfmPerSqFt ?? 0) * areaFt2;
    exhaustCfm = Math.max(byFixture, byArea, spaceType.exhaustMinCfm ?? 0);
  }
  const returnCfm = Math.max(0, finalSupplyCfm - exhaustCfm);

  // 9. Convert to project units
  const L = imperial ? 1 : 1 / BTUH_PER_W; // Btu/h -> project load
  const A = imperial ? 1 : LPS_PER_CFM; // CFM -> project airflow
  const r1 = (v: number): number => Math.round(v * 10) / 10;
  const out = (v: number): number => Math.round(v * L);
  const flow = (v: number): number => (imperial ? Math.round(v) : Math.round(v * A * 10) / 10); // L/s keeps 0.1 resolution

  return {
    area: r1(imperial ? areaFt2 : areaFt2 / SQFT_PER_SQM),
    perimeter: r1(imperial ? perimeterFt : perimeterFt * M_PER_FT),
    occupants,
    sensibleLoad: out(coilSensible),
    latentLoad: out(coilLatent),
    totalLoad: out(coilTotal),
    sensibleHeatRatio: Math.round(shr * 100) / 100,
    totalTons: r1(totalTons),
    supplyCfm: flow(finalSupplyCfm),
    thermalCfm: flow(thermalCfm),
    vbzCfm: flow(vbzCfm),
    vozCfm: flow(vozCfm),
    oaFraction: Math.round(oaFraction * 1000) / 1000,
    oaCfm: flow(vozCfm),
    exhaustCfm: flow(exhaustCfm),
    returnCfm: flow(returnCfm),
    roomSensibleBtuh: Math.round(roomSensible),
    roomLatentBtuh: Math.round(roomLatent),
    oaSensibleBtuh: Math.round(oaSensible),
    oaLatentBtuh: Math.round(oaLatent),
    coilTotalBtuh: Math.round(coilTotal),
    roomSensibleW: Math.round(roomSensible / BTUH_PER_W),
    roomLatentW: Math.round(roomLatent / BTUH_PER_W),
    oaSensibleW: Math.round(oaSensible / BTUH_PER_W),
    oaLatentW: Math.round(oaLatent / BTUH_PER_W),
    coilTotalW: Math.round(coilTotal / BTUH_PER_W),
    warnings: warnings.length ? warnings : undefined
  };
}
