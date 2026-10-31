/**
 * Fire water storage tank & suction sump design (NFPA 22): plan size from effective volume,
 * water levels, thicknesses, anti-vortex sump pit, connections and checks.
 */
import { DesignCheck, FireDesignInput, PumpSetSelection, SumpPitDesign, SystemDemand, TankDesign, TankMaterial } from './fpTypes';
import { galToM3, velocityFps } from './hydraulics';
import { NOMINAL_SIZES_IN, internalDiameterIn, nextLargerSize, outsideDiameterMm } from './standards/pipeData';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
/** Round v up to a multiple of m (tolerant of floating-point noise). */
const ceilTo = (v: number, m: number): number => r3(Math.ceil(v / m - 1e-9) * m);

const MODULE_M: Record<TankMaterial, number> = { 'reinforced-concrete': 0.1, 'grp-sectional': 1.0, 'steel-bolted': 1.22 };

const MATERIAL_SPEC: Record<TankMaterial, string[]> = {
  'reinforced-concrete': [
    "Reinforced concrete C35/45 (f'c ≥ 35 MPa), ACI 350 / BS EN 1992-3, w/c ≤ 0.45, crack width ≤ 0.2 mm",
    'Internal crystalline waterproofing + PVC waterstops at all joints',
    'Cover ≥ 50 mm water face',
    'Galvanised / GRP access ladders, Ø800 manholes with lockable covers'
  ],
  'grp-sectional': [
    'GRP sectional panels 1 m × 1 m, BS EN 13280, WRAS listed',
    'Internal SS 316 tie rods & stays',
    'Hot-dip galvanised steel skid base on RC plinth 300 mm',
    'Insulated panels where freezing possible'
  ],
  'steel-bolted': [
    'Pressed-steel sectional panels 1.22 m modules, BS 1564 / FM 4020 (bolted)',
    'Hot-dip galvanised + internal epoxy (AWWA D102)',
    'EPDM gaskets, SS bolts',
    'RC plinth / steel beams'
  ]
};

/**
 * Design the fire water tank, suction sump and connections
 * (NFPA 22-2018 Ch. 4 capacity & levels, Ch. 14 refill, Ch. 15 sump / anti-vortex; NFPA 20-2019 §4.14.3).
 */
export function designTank(input: FireDesignInput, demand: SystemDemand, pumps: PumpSetSelection): TankDesign {
  const material = input.tankMaterial;
  const requiredGal = Math.ceil(demand.requiredStorageGal);
  const requiredM3 = galToM3(requiredGal);
  const n = input.twoCompartments ? 2 : 1;
  const H = input.tankEffectiveDepthM;
  const area = requiredM3 / (n * H);
  const mod = MODULE_M[material];
  const W = ceilTo(Math.sqrt(area), mod);
  const Lc = ceilTo(area / W, mod);

  const topWater = r3(H + 0.2);
  const overflow = r3(H + 0.1);
  const roofSoffit = material === 'reinforced-concrete' ? ceilTo(H + 0.2 + 0.3, 0.05) : material === 'grp-sectional' ? ceilTo(H + 0.5, 0.5) : ceilTo(H + 0.5, 1.22);
  const freeboard = r3(roofSoffit - topWater);

  let wall: number;
  let floor: number;
  let roof: number;
  let divider: number;
  if (material === 'reinforced-concrete') {
    wall = roofSoffit <= 3 ? 250 : roofSoffit <= 4.5 ? 300 : roofSoffit <= 6 ? 350 : 400;
    floor = wall + 50;
    roof = 250;
    divider = wall;
  } else if (material === 'grp-sectional') {
    wall = floor = roof = 25;
    divider = 25;
  } else {
    wall = 6;
    floor = 6;
    roof = 5;
    divider = 6;
  }

  const internalLength = r3(n * Lc + ((n - 1) * divider) / 1000);
  const provided = r3(n * Lc * W * H);

  // ── Sump pit (one per main pump, identical) ──
  const D = pumps.mainPumps[0].sizes.suctionIn;
  const OD = outsideDiameterMm(D);
  const plate = ceilTo(Math.max(2 * OD, OD + 300), 50);
  const inletAbove = Math.round(Math.max(OD / 2, 100));
  const clearance = Math.max(OD, 200);
  const plateCentre = clearance + plate / 2;
  const pitLength = ceilTo(2 * clearance + plate, 50);
  const pitWidth = ceilTo(2 * clearance + plate, 50);
  const elbowDrop = Math.round(OD);
  const clBelow = Math.round(input.tankFloorToPumpCLm * 1000);
  const pitDepth = Math.max(300, ceilTo(clBelow + elbowDrop + inletAbove, 50));
  const sump: SumpPitDesign = {
    suctionPipeIn: D,
    suctionPipeOdMm: OD,
    vortexPlateMm: plate,
    inletAboveSumpFloorMm: inletAbove,
    pitLengthMm: pitLength,
    pitWidthMm: pitWidth,
    pitDepthMm: pitDepth,
    elbowDropMm: elbowDrop,
    plateCentreFromWallMm: plateCentre,
    suctionCLBelowTankFloorMm: clBelow
  };

  // ── Connections ──
  const fill =
    NOMINAL_SIZES_IN.filter((s) => s >= 2 && s !== 3.5).find((s) => velocityFps(input.refillFlowGpm, internalDiameterIn(s, 'sch40')) <= 10) ??
    16;
  let overflowSize = nextLargerSize(fill);
  if (overflowSize === 3.5) overflowSize = 4;
  const vent = Math.max(4, overflowSize);
  const connections: TankDesign['connections'] = [
    { name: `Suction (per pump, x${pumps.mainPumps.length})`, sizeIn: D, note: 'Turned-down elbow over anti-vortex plate in sump pit (NFPA 22 / NFPA 20 §4.14.3)' },
    { name: 'Fill (refill)', sizeIn: fill, note: `Sch 40 velocity ≤ 10 fps at ${input.refillFlowGpm} gpm; air gap above top water level (IPC §608 / UPC §603)` },
    { name: 'Overflow', sizeIn: overflowSize, note: 'One size above fill, indirect discharge with air gap' },
    { name: 'Vent', sizeIn: vent, note: 'Not smaller than overflow, insect screen' },
    { name: 'Drain / washout', sizeIn: 4, note: 'From sump pit, per compartment' },
    { name: 'Test return', sizeIn: pumps.flowMeterIn, note: 'Flow-test return, discharges above top water level' }
  ];
  if (pumps.mainReliefValve.required) {
    connections.push({ name: 'Relief return', sizeIn: pumps.mainReliefValve.dischargeIn, note: 'Pressure relief valve discharge return' });
  }
  connections.push({ name: 'Level indicator', sizeIn: 1, note: 'Low / high level alarms and gauge (NFPA 22-2018 Ch. 14)' });
  connections.push({ name: 'Manhole', sizeIn: 0, note: 'Ø 800 mm (≥ 600) each compartment' });
  // Manhole is dimensional, not a pipe: size 0 means "not a pipe".

  const refillHours = requiredGal / input.refillFlowGpm / 60;

  const checks: DesignCheck[] = [
    {
      id: 'tank-capacity',
      title: 'Effective tank capacity covers required storage',
      reference: 'NFPA 22-2018 §4.1 (effective capacity); NFPA 13-2019 §19.3.3.1',
      status: provided >= requiredM3 ? 'pass' : 'fail',
      detail: `Provided ${provided.toFixed(2)} m³ (${n} × ${Lc.toFixed(2)} × ${W.toFixed(2)} × ${H.toFixed(2)} m) vs required ${requiredM3.toFixed(2)} m³ (${requiredGal} gal)`
    },
    {
      id: 'tank-refill',
      title: 'Tank refill within 8 hours',
      reference: 'NFPA 22-2018 §14.1.1 (refill time)',
      status: refillHours <= 8 ? 'pass' : 'fail',
      detail: `${requiredGal} gal at ${input.refillFlowGpm} gpm = ${refillHours.toFixed(2)} h (limit 8 h)`
    },
    {
      id: 'vortex-plate',
      title: 'Anti-vortex plate at least twice the suction pipe diameter',
      reference: 'NFPA 22-2018 Ch. 14 (suction connection) / NFPA 20-2019 §4.14.3 (vortex plate)',
      status: plate >= 2 * OD ? 'pass' : 'fail',
      detail: `Plate ${plate} mm square vs 2 x OD = ${(2 * OD).toFixed(0)} mm (${D}" suction, OD ${OD.toFixed(1)} mm); inlet ${inletAbove} mm above pit floor`
    },
    {
      id: 'tank-air-gap',
      title: 'Air gap on fill connection',
      reference: 'IPC 2021 §608.15 / UPC 2021 §603.3 (air gap)',
      status: 'pass',
      detail: `${fill}" fill terminates above the ${topWater.toFixed(2)} m top water level with an air gap of at least 2 pipe diameters (not less than 25 mm)`
    },
    {
      id: 'overflow-size',
      title: 'Overflow at least as large as fill',
      reference: 'NFPA 22-2018 Ch. 14 (tank connections: overflow, vent)',
      status: overflowSize >= fill ? 'pass' : 'fail',
      detail: `Overflow ${overflowSize}" vs fill ${fill}" at ${input.refillFlowGpm} gpm; overflow invert at ${overflow.toFixed(2)} m above floor`
    }
  ];

  return {
    material,
    placement: input.tankPlacement,
    requiredEffectiveGal: requiredGal,
    requiredEffectiveM3: requiredM3,
    providedEffectiveM3: provided,
    compartments: n,
    internalLengthM: internalLength,
    internalWidthM: W,
    effectiveDepthM: H,
    freeboardM: freeboard,
    overflowAboveEffectiveM: 0.1,
    totalInternalHeightM: roofSoffit,
    wallThicknessMm: wall,
    floorThicknessMm: floor,
    roofThicknessMm: roof,
    levels: { lowWaterM: 0, effectiveTopM: H, overflowM: overflow, topWaterM: topWater, roofSoffitM: roofSoffit },
    sump,
    connections,
    materialSpec: MATERIAL_SPEC[material],
    refillHours,
    checks
  };
}
