/**
 * Fire pump room layout (NFPA 20 Ch. 4 / 5, NFPA 70 §110.26, IBC §913):
 * equipment placement, piping, valves, drainage trench, doors, louvers and layout checks.
 * Coordinates are millimetres; origin = inner corner at the tank-side (west) wall / south wall,
 * x east, y north.
 */
import {
  ControlPanelSpec,
  DesignCheck,
  FireDesignInput,
  FirePumpSelection,
  PipeSegment2D,
  PlacedEquipment,
  PlacedValve,
  PumpRoomLayout,
  PumpSetSelection,
  Rect,
  TankDesign,
  TrenchDesign,
  ValveKind
} from './fpTypes';
import {
  butterflyValveLengthMm,
  checkValveLengthMm,
  gateValveLengthMm,
  outsideDiameterMm
} from './standards/pipeData';

const PAD_MARGIN = 150;

/** Pump centre-line height above the pump-room floor, m: 150 mm pad + 450 mm (≤ 1500 gpm) / 600 mm centre-line. */
export function pumpCenterlineHeightM(ratedGpm: number): number {
  return Math.round((0.15 + (ratedGpm <= 1500 ? 0.45 : 0.6)) * 1000) / 1000;
}

const ceilN = (v: number, n: number): number => Math.ceil(v / n - 1e-9) * n;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Skid footprint {len along shaft (y), wid across (x)}, mm (plan §3.3). */
function skidSize(p: FirePumpSelection): { len: number; wid: number } {
  const hp = p.driverHp;
  const electricHsc = (h: number): [number, number] =>
    h <= 25 ? [1500, 600] : h <= 60 ? [1900, 700] : h <= 125 ? [2300, 800] : h <= 250 ? [2800, 900] : [3300, 1000];
  if (p.driver === 'diesel') {
    const [len, wid] = hp <= 100 ? [2900, 1000] : hp <= 200 ? [3400, 1100] : hp <= 350 ? [3900, 1200] : [4400, 1300];
    return { len, wid };
  }
  const [len, wid] = electricHsc(hp);
  if (p.pumpType === 'end-suction' || p.pumpType === 'vertical-inline') {
    return { len: Math.round((len * 0.9) / 10) * 10, wid: Math.round((wid * 0.9) / 10) * 10 };
  }
  return { len, wid };
}

/** Design the pump room (NFPA 20-2019 §4.12 location & §4.14 suction; NFPA 70-2020 §110.26; IBC 2021 §913). */
export function designPumpRoom(input: FireDesignInput, pumps: PumpSetSelection, tank: TankDesign): PumpRoomLayout {
  const main = pumps.mainPumps;
  const wallN = 250; // north / south / east masonry walls
  const wallW = tank.material === 'reinforced-concrete' ? Math.max(250, tank.wallThicknessMm) : 250; // common wall with the tank
  const rated = main[0].ratedFlowGpm;
  const sizes = main[0].sizes;
  const dischargeIn = sizes.dischargeIn;
  const suctionIn = sizes.suctionIn;
  const odS = outsideDiameterMm(suctionIn);
  const odD = outsideDiameterMm(dischargeIn);
  const hasDiesel = main.some((p) => p.driver === 'diesel');

  // ── X chain ──
  const suctionRun = Math.max(10 * odS, 600);
  const gateLen = gateValveLengthMm(suctionIn);
  const xPadW = ceilN(300 + gateLen + suctionRun + odS, 10);
  const nozzleX = xPadW + PAD_MARGIN;
  const dischargeChain = odD + 200 + checkValveLengthMm(dischargeIn) + 150 + butterflyValveLengthMm(dischargeIn) + 300;

  const skids = main.map(skidSize);
  const dischargeX = skids.map((s) => nozzleX + s.wid);
  const headerX = ceilN(Math.max(...dischargeX) + dischargeChain, 10);
  const maxPanelDepth = Math.max(...main.map((p) => p.controller.depthMm), pumps.jockey.controller.depthMm);
  const L = ceilN(headerX + odD / 2 + 1000 + maxPanelDepth, 100);

  // ── Y chain ──
  const padRects: Rect[] = [];
  const nozzleY: number[] = [];
  let cursor = 1200;
  main.forEach((_p, i) => {
    const pad: Rect = { x: xPadW, y: cursor, w: skids[i].wid + 2 * PAD_MARGIN, h: skids[i].len + 2 * PAD_MARGIN };
    padRects.push(pad);
    nozzleY.push(pad.y + PAD_MARGIN + 0.25 * skids[i].len);
    cursor += pad.h + 1200;
  });
  const jockeyPad: Rect = { x: xPadW, y: cursor, w: 500 + 2 * PAD_MARGIN, h: 500 + 2 * PAD_MARGIN };
  const jockeyRect: Rect = { x: jockeyPad.x + PAD_MARGIN, y: jockeyPad.y + PAD_MARGIN, w: 500, h: 500 };
  const jockeyY = jockeyPad.y + jockeyPad.h / 2;
  cursor += jockeyPad.h;

  const fuelLiters = main.reduce((s, p) => s + (p.fuelTankLiters ?? 0), 0);
  let fuelRect: Rect | null = null;
  let bund: Rect | null = null;
  if (hasDiesel) {
    cursor += 1000;
    const fuelLenMm = Math.max(1000, Math.ceil((fuelLiters / 1000 / (1.0 * 0.8)) * 10 - 1e-9) * 100);
    bund = { x: xPadW, y: cursor, w: fuelLenMm + 2 * PAD_MARGIN, h: 800 + 2 * PAD_MARGIN };
    fuelRect = { x: bund.x + PAD_MARGIN, y: bund.y + PAD_MARGIN, w: fuelLenMm, h: 800 };
    cursor += bund.h;
  }
  const W = ceilN(cursor + 1000, 100);

  // ── Equipment ──
  const equipment: PlacedEquipment[] = [];
  main.forEach((p, i) => {
    const skid: Rect = { x: nozzleX, y: padRects[i].y + PAD_MARGIN, w: skids[i].wid, h: skids[i].len };
    equipment.push({
      tag: p.tag,
      kind: 'fire-pump',
      rect: skid,
      pad: padRects[i],
      suctionNozzle: { x: nozzleX, y: nozzleY[i], sizeIn: p.sizes.suctionIn },
      dischargeNozzle: { x: dischargeX[i], y: nozzleY[i], sizeIn: p.sizes.dischargeIn },
      label: `${p.tag} ${p.driver === 'electric' ? 'Electric' : 'Diesel'} ${p.role} fire pump ${p.ratedFlowGpm} gpm @ ${p.ratedNetPressurePsi} psi, ${p.driverHp} HP`
    });
  });
  equipment.push({
    tag: pumps.jockey.tag,
    kind: 'jockey-pump',
    rect: jockeyRect,
    pad: jockeyPad,
    suctionNozzle: { x: jockeyRect.x, y: jockeyY, sizeIn: pumps.jockey.pipeSizeIn },
    dischargeNozzle: { x: jockeyRect.x + jockeyRect.w, y: jockeyY, sizeIn: pumps.jockey.pipeSizeIn },
    label: `${pumps.jockey.tag} Jockey pump ${pumps.jockey.ratedFlowGpm} gpm @ ${pumps.jockey.ratedNetPressurePsi} psi, ${pumps.jockey.motorHp} HP`
  });
  if (fuelRect && bund) {
    equipment.push({
      tag: 'FT-1',
      kind: 'fuel-tank',
      rect: fuelRect,
      pad: bund,
      label: `FT-1 Diesel fuel tank ${fuelLiters} L with bund`
    });
  }

  // Controllers flush against the east wall, centred on their pump nozzle / jockey y, shifted north on conflict
  const ctrlDefs: { c: ControlPanelSpec; cy: number }[] = [
    ...main.map((p, i) => ({ c: p.controller, cy: nozzleY[i] })),
    { c: pumps.jockey.controller, cy: jockeyY }
  ];
  const ctrlRects: Rect[] = [];
  let prevEnd = 0;
  ctrlDefs.forEach(({ c, cy }) => {
    const y = Math.max(cy - c.widthMm / 2, prevEnd);
    const rect: Rect = { x: L - c.depthMm, y, w: c.depthMm, h: c.widthMm };
    prevEnd = y + c.widthMm;
    ctrlRects.push(rect);
    equipment.push({ tag: c.tag, kind: 'controller', rect, label: `${c.tag} ${c.description}` });
  });
  const ctrlCentreY = (i: number): number => ctrlRects[i].y + ctrlRects[i].h / 2;

  // Drain pit at the south end of the trench
  const trenchX = xPadW - 450;
  const pitC = { x: trenchX, y: 900 };
  equipment.push({
    tag: 'DP-1',
    kind: 'drain-pit',
    rect: { x: pitC.x - 300, y: pitC.y - 300, w: 600, h: 600 },
    label: 'DP-1 Drain pit 600 x 600'
  });

  // ── Valves ──
  const valves: PlacedValve[] = [];
  let vn = 0;
  const addValve = (kind: ValveKind, sizeIn: number, x: number, y: number, angleDeg: number, service: PlacedValve['service']): void => {
    vn += 1;
    valves.push({ tag: `V-${String(vn).padStart(2, '0')}`, kind, sizeIn, x: Math.round(x), y: Math.round(y), angleDeg, service });
  };
  main.forEach((p, i) => {
    const y = nozzleY[i];
    const sIn = p.sizes.suctionIn;
    const dIn = p.sizes.dischargeIn;
    const od = outsideDiameterMm(sIn);
    const odd = outsideDiameterMm(dIn);
    const gv = gateValveLengthMm(sIn);
    const dx = dischargeX[i];
    addValve('flexible-coupling', sIn, 150, y, 0, 'suction');
    addValve('os&y-gate', sIn, 300 + gv / 2, y, 0, 'suction');
    addValve('tamper-switch', sIn, 300 + gv / 2, y, 0, 'suction');
    addValve('pressure-gauge', 0.75, xPadW - od - 250, y, 90, 'suction');
    addValve('eccentric-reducer', sIn, xPadW - od / 2, y, 0, 'suction');
    addValve('concentric-increaser', dIn, dx + odd / 2, y, 0, 'discharge');
    addValve('pressure-gauge', 0.75, dx + odd + 100, y, 90, 'discharge');
    if (p.circulationReliefIn !== null) addValve('circulation-relief', p.circulationReliefIn, dx + odd + 100, y - 300, 90, 'discharge');
    const chk = checkValveLengthMm(dIn);
    addValve('check', dIn, dx + odd + 200 + chk / 2, y, 0, 'discharge');
    addValve('butterfly', dIn, dx + odd + 200 + chk + 150 + butterflyValveLengthMm(dIn) / 2, y, 0, 'discharge');
  });
  if (pumps.mainReliefValve.required) addValve('relief', pumps.mainReliefValve.sizeIn, headerX - 350, 1400, 180, 'relief');
  addValve('butterfly', dischargeIn, headerX, jockeyY + 600, 90, 'discharge');
  addValve('butterfly', pumps.flowMeterIn, headerX - 350, 600, 180, 'test');
  addValve('flow-meter', pumps.flowMeterIn, headerX - 1100, 600, 180, 'test');
  addValve('butterfly', pumps.flowMeterIn, headerX - 1900, 600, 180, 'test');
  addValve('butterfly', pumps.testHeaderIn, headerX - 1500, 300, 90, 'test');
  for (let k = 0; k < pumps.testHeaderHoseValves; k++) {
    const dx = (k - (pumps.testHeaderHoseValves - 1) / 2) * 300;
    addValve('hose-valve', 2.5, headerX - 1500 + dx, -wallN, 90, 'test');
  }
  const jIn = pumps.jockey.pipeSizeIn;
  addValve('ball-valve', jIn, 1200, jockeyY, 0, 'jockey');
  addValve('check', jIn, jockeyRect.x + jockeyRect.w + 300, jockeyY, 0, 'jockey');
  addValve('ball-valve', jIn, jockeyRect.x + jockeyRect.w + 700, jockeyY, 0, 'jockey');

  // ── Pipes ──
  const pipes: PipeSegment2D[] = [];
  main.forEach((p, i) => {
    pipes.push({ id: `SUC-${p.tag}`, service: 'suction', sizeIn: p.sizes.suctionIn, points: [[-wallW, nozzleY[i]], [nozzleX, nozzleY[i]]] });
    pipes.push({ id: `DIS-${p.tag}`, service: 'discharge', sizeIn: p.sizes.dischargeIn, points: [[dischargeX[i], nozzleY[i]], [headerX, nozzleY[i]]] });
  });
  pipes.push({ id: 'HDR-1', service: 'discharge', sizeIn: dischargeIn, points: [[headerX, 600], [headerX, jockeyY]] });
  pipes.push({ id: 'OUT-1', service: 'discharge', sizeIn: dischargeIn, points: [[headerX, jockeyY], [headerX, W + wallN]] });
  pipes.push({ id: 'TST-1', service: 'test', sizeIn: pumps.flowMeterIn, points: [[headerX, 600], [-wallW, 600]] });
  pipes.push({ id: 'TST-2', service: 'test', sizeIn: pumps.testHeaderIn, points: [[headerX - 1500, 600], [headerX - 1500, -wallN]] });
  const lastY = nozzleY[nozzleY.length - 1];
  pipes.push({ id: 'JKY-S', service: 'jockey', sizeIn: jIn, points: [[600, lastY], [600, jockeyY], [jockeyRect.x, jockeyY]] });
  pipes.push({ id: 'JKY-D', service: 'jockey', sizeIn: jIn, points: [[jockeyRect.x + jockeyRect.w, jockeyY], [headerX, jockeyY]] });
  if (pumps.mainReliefValve.required) {
    pipes.push({
      id: 'REL-1',
      service: 'relief',
      sizeIn: pumps.mainReliefValve.dischargeIn,
      points: [[headerX, 1400], [headerX - 700, 1400], [headerX - 700, 600]]
    });
  }
  ctrlDefs.forEach(({ c }, i) => {
    const isJockey = i === ctrlDefs.length - 1;
    const sy = isJockey ? jockeyY : nozzleY[i];
    const cy = ctrlCentreY(i);
    const pts: [number, number][] = sy === cy ? [[headerX, sy], [ctrlRects[i].x, cy]] : [[headerX, sy], [ctrlRects[i].x - 300, sy], [ctrlRects[i].x - 300, cy], [ctrlRects[i].x, cy]];
    pipes.push({ id: `SNS-${c.tag}`, service: 'sensing', sizeIn: 0.75, points: pts });
  });
  const dieselIdx = main.findIndex((p) => p.driver === 'diesel');
  if (hasDiesel && fuelRect) {
    const eng = equipment[dieselIdx].rect;
    const fy = eng.y + 1000;
    pipes.push({
      id: 'FUEL-1',
      service: 'fuel',
      sizeIn: 0.75,
      points: [[fuelRect.x, fuelRect.y + fuelRect.h / 2], [xPadW - 120, fuelRect.y + fuelRect.h / 2], [xPadW - 120, fy], [eng.x, fy]]
    });
    const eastEdge = Math.max(bund ? bund.x + bund.w : 0, ...padRects.map((r) => r.x + r.w));
    const exhaustX = Math.max(Math.round((headerX - 1000) / 50) * 50, eastEdge + 200);
    const ey = eng.y + eng.h - 400;
    pipes.push({
      id: 'EXH-1',
      service: 'exhaust',
      sizeIn: main[dieselIdx].driverHp <= 200 ? 4 : 6,
      points: [[eng.x + eng.w / 2, ey], [exhaustX, ey], [exhaustX, W + wallN]]
    });
  }
  pipes.push({ id: 'DRN-1', service: 'drain', sizeIn: 4, points: [[pitC.x, pitC.y], [pitC.x, -wallN]] });

  // ── Trench ──
  const path: [number, number][] = [[trenchX, W - 1000], [trenchX, 1500], [pitC.x, pitC.y]];
  let trenchLen = 0;
  for (let i = 1; i < path.length; i++) trenchLen += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  const depthStart = 150;
  const depthEnd = depthStart + 0.01 * trenchLen;
  // Manning, n = 0.013, flow depth = 0.75 x starting depth, b = 0.3 m
  const yFlow = 0.75 * (depthStart / 1000);
  const bT = 0.3;
  const aT = bT * yFlow;
  const rH = aT / (bT + 2 * yFlow);
  const qM3s = (1 / 0.013) * aT * Math.pow(rH, 2 / 3) * Math.sqrt(0.01);
  const capacityGpm = qM3s * 15850.32;
  const inflow =
    main.filter((p) => p.driver === 'electric').reduce((s, p) => s + 0.02 * p.ratedFlowGpm, 0) + 5 * main.length + pumps.jockey.ratedFlowGpm;
  const trench: TrenchDesign = {
    widthMm: 300,
    depthStartMm: depthStart,
    depthEndMm: depthEnd,
    slopePercent: 1,
    lengthMm: trenchLen,
    path,
    capacityGpm,
    designInflowGpm: inflow,
    grating: 'Galvanised steel heavy-duty grating 300 mm, 25×5 mm bars @ 30 mm',
    outlet: { x: pitC.x, y: pitC.y, pitMm: 600, drainIn: 4 }
  };

  // ── Doors & louvers ──
  const doors: PumpRoomLayout['doors'] = [{ x: L - 1400, y: 0, widthMm: 1800, wall: 'south' }];
  const louvers: PumpRoomLayout['louvers'] = [];
  if (hasDiesel) {
    louvers.push({ x: Math.max(900, xPadW - 900), y: 0, widthMm: 1200, wall: 'south', purpose: 'Diesel engine combustion / cooling air intake (NFPA 20 §11.3)' });
    const exh = pipes.find((p) => p.id === 'EXH-1');
    louvers.push({ x: exh ? exh.points[1][0] : headerX - 1000, y: W, widthMm: 1200, wall: 'north', purpose: 'Engine room exhaust / relief air discharge' });
  }

  // ── Elevations ──
  const padTop = 0.15;
  const pumpCL = pumpCenterlineHeightM(rated);
  const highLevel = 2.4;
  const roofSoffit = Math.max(3.5, r3(highLevel + 0.9));
  const elevations: PumpRoomLayout['elevations'] = {
    roomFloorM: 0,
    padTopM: padTop,
    pumpCLM: pumpCL,
    tankFloorM: r3(pumpCL + input.tankFloorToPumpCLm),
    highLevelPipeM: highLevel,
    roofSoffitM: roofSoffit
  };
  const habove = input.building
    ? Math.max(...input.building.floors.filter((f) => !f.isRoof).map((f) => f.elevationM)) - input.building.fireDeptAccessElevationM
    : 0;
  const rating: 1 | 2 = input.building ? (habove > 22.86 ? 2 : 1) : input.riser.elevationRiseFt > 75 ? 2 : 1;

  // ── Checks ──
  const checks: DesignCheck[] = [];
  const workSpace = Math.min(...ctrlRects.map((r) => r.x - (headerX + odD / 2)));
  checks.push({
    id: 'room-working-space',
    title: 'Working space in front of controllers',
    reference: 'NFPA 70-2020 §110.26(A) / NFPA 20-2019 §10.3.1 (≥ 1000 mm)',
    status: workSpace >= 1000 ? 'pass' : 'fail',
    detail: `Minimum clear distance from the discharge header to the controller faces = ${workSpace.toFixed(0)} mm (required 1000 mm); controllers flush to the east wall at x = ${L} mm`
  });
  const runs = main.map((p) => {
    const od = outsideDiameterMm(p.sizes.suctionIn);
    return { run: xPadW - od - (300 + gateValveLengthMm(p.sizes.suctionIn)), need: 10 * od };
  });
  const worst = runs.reduce((a, b) => (b.run - b.need < a.run - a.need ? b : a));
  checks.push({
    id: 'suction-straight-run',
    title: 'Straight suction pipe of at least 10 pipe diameters',
    reference: 'NFPA 20-2019 §4.14.6 (straight run upstream of eccentric reducer / pump flange)',
    status: worst.run >= worst.need - 1e-6 ? 'pass' : 'fail',
    detail: `Straight run between suction gate valve and eccentric reducer = ${worst.run.toFixed(0)} mm vs 10 × OD ${odS.toFixed(1)} mm = ${worst.need.toFixed(0)} mm`
  });
  const bflySuction = valves.some((v) => v.kind === 'butterfly' && v.service === 'suction');
  checks.push({
    id: 'no-butterfly-on-suction',
    title: 'OS&Y gate valve (not butterfly) on pump suction',
    reference: 'NFPA 20-2019 §4.14.5 (suction valves); IBC 2021 §913.4',
    status: bflySuction ? 'fail' : 'pass',
    detail: `${valves.filter((v) => v.kind === 'os&y-gate' && v.service === 'suction').length} OS&Y gate valve(s) with tamper switch on suction; no butterfly valve on suction`
  });
  checks.push({
    id: 'room-rating',
    title: 'Pump room fire separation',
    reference: 'IBC 2021 §913.2.1 / NFPA 20-2019 §4.12.1',
    status: 'pass',
    detail: `${input.building ? `Highest occupied floor ${(habove / 0.3048).toFixed(1)} ft above fire department access` : `Riser rise ${input.riser.elevationRiseFt} ft`} ${rating === 2 ? '> 75 ft (high-rise): 2 h' : '≤ 75 ft: 1 h'} fire-resistance rated separation; exterior access door ${doors[0].widthMm} mm`
  });
  checks.push({
    id: 'room-heating',
    title: 'Pump room heating',
    reference: 'NFPA 20-2019 §4.12.2 / §11.6 (≥ 4.4 °C; diesel engine rooms ≥ 21 °C)',
    status: 'pass',
    detail: `Maintain ≥ 4.4 °C (40 °F) in the room${hasDiesel ? ' and ≥ 21 °C (70 °F) at the diesel engine (block heater)' : ''}; clear height ${(roofSoffit * 1000).toFixed(0)} mm`
  });
  checks.push({
    id: 'room-drainage',
    title: 'Floor drainage trench capacity',
    reference: 'NFPA 20-2019 §4.12.4; IPC 2021 §802 (indirect waste)',
    status: capacityGpm >= inflow ? 'pass' : 'fail',
    detail: `Trench 300 mm @ 1 %, Manning n = 0.013: ${capacityGpm.toFixed(0)} gpm vs design inflow ${inflow.toFixed(0)} gpm; ${trench.outlet.drainIn}" drain from 600 mm pit via air gap`
  });
  const pads = [...padRects, jockeyPad, ...(bund ? [bund] : [])];
  let minGap = Infinity;
  for (let i = 0; i < pads.length; i++) {
    for (let j = i + 1; j < pads.length; j++) {
      const a = pads[i];
      const b = pads[j];
      const gx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
      const gy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
      minGap = Math.min(minGap, Math.hypot(gx, gy));
    }
  }
  if (!Number.isFinite(minGap)) minGap = 1200;
  checks.push({
    id: 'equipment-clearance',
    title: 'Clearance between equipment pads',
    reference: 'NFPA 20-2019 §4.12.3 (access around pumps and drivers, ≥ 900 mm used)',
    status: minGap >= 900 ? 'pass' : 'fail',
    detail: `Minimum gap between pump / jockey / fuel-tank pads = ${minGap.toFixed(0)} mm (required 900 mm); room ${L} × ${W} mm`
  });

  return {
    lengthMm: L,
    widthMm: W,
    clearHeightMm: roofSoffit * 1000,
    wallThicknessMm: wallN,
    fireRatingHours: rating,
    equipment,
    pipes,
    valves,
    trench,
    doors,
    louvers,
    elevations,
    suctionLineY: nozzleY,
    headerX,
    systemOutlet: { x: headerX, y: W + wallN, sizeIn: dischargeIn },
    checks
  };
}
