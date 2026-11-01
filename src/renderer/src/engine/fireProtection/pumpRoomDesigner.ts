/**
 * Fire pump room layout (NFPA 20 Ch. 4 / 5, NFPA 70 §110.26, IBC §913):
 * equipment placement, piping, valves, drainage trench, doors, louvers and layout checks.
 * Coordinates are millimetres; origin = inner corner at the tank-side (west) wall / south wall,
 * x east, y north.
 * Also: wall penetrations (puddle flanges / sleeves), NFPA 20 sensing lines, pump drains,
 * IPC 712 drainage sump (plan: pump-room details).
 */
import {
  ControlPanelSpec,
  DesignCheck,
  DrainageSumpDesign,
  FireDesignInput,
  FirePumpSelection,
  PipeSegment2D,
  PlacedEquipment,
  PlacedValve,
  PumpRoomLayout,
  PumpSetSelection,
  Rect,
  SensingLine,
  TankDesign,
  TrenchDesign,
  ValveKind,
  WallPenetration
} from './fpTypes';
import { velocityFps } from './hydraulics';
import { NEMA_MOTOR_HP } from './standards/nfpa20';
import {
  butterflyValveLengthMm,
  checkValveLengthMm,
  gateValveLengthMm,
  internalDiameterIn,
  outsideDiameterMm
} from './standards/pipeData';

const PAD_MARGIN = 150;
/** IPC 2021 Table 712.4.2 minimum sump pump capacity by discharge pipe size, gpm (4 in uses the 3 in value). */
const IPC_712_MIN_GPM: Record<number, number> = { 2: 21, 2.5: 30, 3: 46, 4: 46 };

/** Pump centre-line height above the pump-room floor, m: 150 mm pad + 450 mm (≤ 1500 gpm) / 600 mm centre-line. */
export function pumpCenterlineHeightM(ratedGpm: number): number {
  return Math.round((0.15 + (ratedGpm <= 1500 ? 0.45 : 0.6)) * 1000) / 1000;
}

const ceilN = (v: number, n: number): number => Math.ceil(v / n - 1e-9) * n;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const ceil5 = (v: number): number => Math.ceil(v / 5 - 1e-9) * 5;

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

/** Point at distance `d` along a polyline. */
function pointAlong(pts: [number, number][], d: number): { x: number; y: number; angleDeg: number } {
  let rem = d;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const len = Math.hypot(dx, dy);
    if (rem <= len + 1e-9 || i === pts.length - 1) {
      const t = len === 0 ? 0 : Math.min(1, rem / len);
      return { x: pts[i - 1][0] + dx * t, y: pts[i - 1][1] + dy * t, angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI };
    }
    rem -= len;
  }
  return { x: pts[0][0], y: pts[0][1], angleDeg: 0 };
}

function polyLength(pts: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

/**
 * Sensing-line route (NFPA 20-2019 §4.32): from the tap, vertical first leg (north 400 mm, or directly to the controller
 * level / south when the controller is further away or south of the tap), then east to the controller's west face.
 * The first leg is extended so that the line is at least 2100 mm long (300 + 1500 mm check valve spacing + 300 mm).
 */
function routeSensingLine(tap: [number, number], ctrl: Rect): [number, number][] {
  const cy = ctrl.y + ctrl.h / 2;
  const d = cy - tap[1];
  const build = (v: number): [number, number][] => {
    const raw: [number, number][] = [
      [tap[0], tap[1]],
      [tap[0], tap[1] + v],
      [ctrl.x - 300, tap[1] + v],
      [ctrl.x - 300, cy],
      [ctrl.x, cy]
    ];
    return raw.filter((p, i) => i === 0 || Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]) > 1e-9);
  };
  let v = d >= 400 ? d : d >= 0 ? 400 : d;
  let pts = build(v);
  const len = polyLength(pts);
  if (len < 2100) {
    v += (v >= 0 ? 1 : -1) * (2100 - len);
    pts = build(v);
  }
  return pts;
}

/** Design the pump room (NFPA 20-2019 §4.12 location & §4.14 suction; NFPA 70-2020 §110.26; IBC 2021 §913). */
export function designPumpRoom(input: FireDesignInput, pumps: PumpSetSelection, tank: TankDesign): PumpRoomLayout {
  const main = pumps.mainPumps;
  const jockeys = pumps.jockeys;
  const nJ = jockeys.length;
  const wallN = 250; // north / south / east masonry walls
  const wallW = tank.material === 'reinforced-concrete' ? Math.max(250, tank.wallThicknessMm) : 250; // common wall with the tank
  const rated = main[0].ratedFlowGpm;
  const sizes = main[0].sizes;
  const dischargeIn = sizes.dischargeIn;
  const suctionIn = sizes.suctionIn;
  const odS = outsideDiameterMm(suctionIn);
  const odD = outsideDiameterMm(dischargeIn);
  const dieselIdx = main.map((p, i) => (p.driver === 'diesel' ? i : -1)).filter((i) => i >= 0);
  const nD = dieselIdx.length;
  const hasDiesel = nD > 0;

  // ── X chain ──
  const suctionRun = Math.max(10 * odS, 600);
  const gateLen = gateValveLengthMm(suctionIn);
  const xPadW = ceilN(300 + gateLen + suctionRun + odS, 10);
  const nozzleX = xPadW + PAD_MARGIN;
  const dischargeChain = odD + 200 + checkValveLengthMm(dischargeIn) + 150 + butterflyValveLengthMm(dischargeIn) + 300;

  const skids = main.map(skidSize);
  const dischargeX = skids.map((s) => nozzleX + s.wid);

  // ── Y chain: corridor, [pump pad + 1200]..., jockey row, [1000, fuel row], 1000 ──
  const padRects: Rect[] = [];
  const nozzleY: number[] = [];
  let cursor = 1200;
  main.forEach((_p, i) => {
    const pad: Rect = { x: xPadW, y: cursor, w: skids[i].wid + 2 * PAD_MARGIN, h: skids[i].len + 2 * PAD_MARGIN };
    padRects.push(pad);
    nozzleY.push(pad.y + PAD_MARGIN + 0.25 * skids[i].len);
    cursor += pad.h + 1200;
  });
  // jockey row: pads side by side from x = xPadW, 900 mm apart
  const jockeyPads: Rect[] = jockeys.map((_j, k) => ({ x: xPadW + k * (500 + 2 * PAD_MARGIN + 900), y: cursor, w: 500 + 2 * PAD_MARGIN, h: 500 + 2 * PAD_MARGIN }));
  const jockeyRects: Rect[] = jockeyPads.map((pd) => ({ x: pd.x + PAD_MARGIN, y: pd.y + PAD_MARGIN, w: 500, h: 500 }));
  const jockeyY = cursor + (500 + 2 * PAD_MARGIN) / 2;
  const jockeyRowY = cursor;
  cursor += 500 + 2 * PAD_MARGIN;
  let eastEdge = Math.max(...padRects.map((r) => r.x + r.w), ...jockeyPads.map((r) => r.x + r.w));

  // fuel tank row: one bunded fuel tank per diesel engine, side by side from x = xPadW, 900 mm apart
  const fuelRects: Rect[] = [];
  const bunds: Rect[] = [];
  if (hasDiesel) {
    cursor += 1000;
    let bx = xPadW;
    dieselIdx.forEach((mi) => {
      const fuelLenMm = Math.max(1000, Math.ceil(((main[mi].fuelTankLiters ?? 0) / 1000 / (1.0 * 0.8)) * 10 - 1e-9) * 100);
      const bund: Rect = { x: bx, y: cursor, w: fuelLenMm + 2 * PAD_MARGIN, h: 800 + 2 * PAD_MARGIN };
      bunds.push(bund);
      fuelRects.push({ x: bund.x + PAD_MARGIN, y: bund.y + PAD_MARGIN, w: fuelLenMm, h: 800 });
      bx += bund.w + 900;
    });
    cursor += 800 + 2 * PAD_MARGIN;
    eastEdge = Math.max(eastEdge, ...bunds.map((b) => b.x + b.w));
  }

  // ── Header and room length ──
  let headerX = ceilN(Math.max(...dischargeX) + dischargeChain, 10);
  if (hasDiesel) headerX = Math.max(headerX, ceilN(eastEdge + 200 + 300 * (nD - 1) + 400, 10));
  const maxPanelDepth = Math.max(...main.map((p) => p.controller.depthMm), ...jockeys.map((j) => j.controller.depthMm));
  const L = ceilN(headerX + odD / 2 + 1000 + maxPanelDepth, 100);

  // ── Controllers: flush against the east wall at their pump's nozzle / jockey y, shifted north on conflict ──
  const ctrlDefs: { c: ControlPanelSpec; cy: number; pumpTag: string; isJockey: boolean; idx: number }[] = [
    ...main.map((p, i) => ({ c: p.controller, cy: nozzleY[i], pumpTag: p.tag, isJockey: false, idx: i })),
    ...jockeys.map((j, k) => ({ c: j.controller, cy: jockeyY, pumpTag: j.tag, isJockey: true, idx: k }))
  ];
  const ctrlRects: Rect[] = [];
  let prevEnd = 0;
  ctrlDefs.forEach(({ c, cy }) => {
    const y = Math.max(cy - c.widthMm / 2, prevEnd);
    ctrlRects.push({ x: L - c.depthMm, y, w: c.depthMm, h: c.widthMm });
    prevEnd = y + c.widthMm;
  });
  const W = ceilN(Math.max(cursor + 1000, prevEnd + 300), 100);

  // ── Drainage sump pit (IPC §712) at the south end of the trench ──
  const trenchX = xPadW - 450;
  const pitC = { x: trenchX, y: 700 };
  const pitRect: Rect = { x: pitC.x - 600, y: pitC.y - 500, w: 1200, h: 1000 };
  const pitDepth = 1200;
  const inflow =
    main.filter((p) => p.driver === 'electric').reduce((s, p) => s + 0.02 * p.ratedFlowGpm, 0) + 5 * main.length + jockeys[0].ratedFlowGpm;
  const ffl = input.building ? input.building.pumpRoomFloorElevationM : input.tankPlacement === 'underground' ? -4.0 : 0;
  const sumpRequired = ffl < -0.5;
  const levels = { offMm: 300, leadOnMm: 700, lagOnMm: 850, alarmMm: 1000 };
  const sump = designSump(sumpRequired, ffl, inflow, pitRect, pitDepth, levels);

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
  jockeys.forEach((j, k) => {
    const jr = jockeyRects[k];
    equipment.push({
      tag: j.tag,
      kind: 'jockey-pump',
      rect: jr,
      pad: jockeyPads[k],
      suctionNozzle: { x: jr.x, y: jockeyY, sizeIn: j.pipeSizeIn },
      dischargeNozzle: { x: jr.x + jr.w, y: jockeyY, sizeIn: j.pipeSizeIn },
      label: `${j.tag} Jockey pump ${j.ratedFlowGpm} gpm @ ${j.ratedNetPressurePsi} psi, ${j.motorHp} HP`
    });
  });
  dieselIdx.forEach((mi, k) => {
    equipment.push({
      tag: `FT-${k + 1}`,
      kind: 'fuel-tank',
      rect: fuelRects[k],
      pad: bunds[k],
      label: `FT-${k + 1} Diesel fuel tank ${main[mi].fuelTankLiters ?? 0} L with bund (${main[mi].tag}, NFPA 20 §11.4.1)`
    });
  });
  ctrlDefs.forEach(({ c }, i) => equipment.push({ tag: c.tag, kind: 'controller', rect: ctrlRects[i], label: `${c.tag} ${c.description}` }));
  equipment.push({
    tag: sump.tag,
    kind: 'drain-pit',
    rect: pitRect,
    label: `${sump.tag} Drainage sump pit ${pitRect.w} x ${pitRect.h} x ${pitDepth} deep${sump.required ? ', duplex sump pumps SP-1 / SP-2 (IPC 712)' : ', gravity drain'}`
  });

  // ── Valves ──
  const valves: PlacedValve[] = [];
  let vn = 0;
  const addValve = (kind: ValveKind, sizeIn: number, x: number, y: number, angleDeg: number, service: PlacedValve['service']): void => {
    vn += 1;
    valves.push({ tag: `V-${String(vn).padStart(2, '0')}`, kind, sizeIn, x: Math.round(x), y: Math.round(y), angleDeg, service });
  };
  const checkX: number[] = [];
  const bflyX: number[] = [];
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
    checkX.push(dx + odd + 200 + chk / 2);
    bflyX.push(dx + odd + 200 + chk + 150 + butterflyValveLengthMm(dIn) / 2);
    addValve('check', dIn, checkX[i], y, 0, 'discharge');
    addValve('butterfly', dIn, bflyX[i], y, 0, 'discharge');
  });
  if (pumps.mainReliefValve.required) addValve('relief', pumps.mainReliefValve.sizeIn, headerX - 350, 1400, 180, 'relief');
  addValve('butterfly', dischargeIn, headerX, jockeyY + (nJ > 1 ? 1000 : 600), 90, 'discharge');
  addValve('butterfly', pumps.flowMeterIn, headerX - 350, 600, 180, 'test');
  addValve('flow-meter', pumps.flowMeterIn, headerX - 1100, 600, 180, 'test');
  addValve('butterfly', pumps.flowMeterIn, headerX - 1900, 600, 180, 'test');
  addValve('butterfly', pumps.testHeaderIn, headerX - 1500, 300, 90, 'test');
  for (let k = 0; k < pumps.testHeaderHoseValves; k++) {
    const dx = (k - (pumps.testHeaderHoseValves - 1) / 2) * 300;
    addValve('hose-valve', 2.5, headerX - 1500 + dx, -wallN, 90, 'test');
  }
  // jockey suction y: the first jockey is fed straight along its own y, further ones along the gap south of the jockey row
  const jockeySuctionY = (k: number): number => (k === 0 ? jockeyY : jockeyRowY - 600);
  // jockey discharge y at the header: all but the last run over the top of the jockey pads
  const jockeyHdrY = (k: number): number => (k < nJ - 1 ? jockeyY + 700 : jockeyY);
  jockeys.forEach((j, k) => {
    const jr = jockeyRects[k];
    addValve('ball-valve', j.pipeSizeIn, 1200, jockeySuctionY(k), 0, 'jockey');
    addValve('check', j.pipeSizeIn, jr.x + jr.w + 300, jockeyY, 0, 'jockey');
    addValve('ball-valve', j.pipeSizeIn, jr.x + jr.w + 700, jockeyY, 0, 'jockey');
  });

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
  jockeys.forEach((j, k) => {
    const jr = jockeyRects[k];
    const sy = jockeySuctionY(k);
    const suctionPts: [number, number][] =
      k === 0
        ? [[600, lastY], [600, jockeyY], [jr.x, jockeyY]]
        : [[600, lastY], [600, sy], [jr.x - 500, sy], [jr.x - 500, jockeyY], [jr.x, jockeyY]];
    pipes.push({ id: `JKY-S${k + 1}`, service: 'jockey', sizeIn: j.pipeSizeIn, points: suctionPts });
    const dPts: [number, number][] =
      k < nJ - 1
        ? [[jr.x + jr.w, jockeyY], [jr.x + jr.w + 900, jockeyY], [jr.x + jr.w + 900, jockeyHdrY(k)], [headerX, jockeyHdrY(k)]]
        : [[jr.x + jr.w, jockeyY], [headerX, jockeyY]];
    pipes.push({ id: `JKY-D${k + 1}`, service: 'jockey', sizeIn: j.pipeSizeIn, points: dPts });
  });
  if (pumps.mainReliefValve.required) {
    pipes.push({
      id: 'REL-1',
      service: 'relief',
      sizeIn: pumps.mainReliefValve.dischargeIn,
      points: [[headerX, 1400], [headerX - 700, 1400], [headerX - 700, 600]]
    });
  }

  // Sensing lines (NFPA 20-2019 §4.32 / §10.5.2.1): one per controller, tapped between the discharge check and isolation valve
  const sensingLines: SensingLine[] = [];
  ctrlDefs.forEach(({ c, pumpTag, isJockey, idx }, i) => {
    const tap: [number, number] = isJockey
      ? [headerX - 300, jockeyHdrY(idx)]
      : [(checkX[idx] + bflyX[idx]) / 2, nozzleY[idx]];
    const pts = routeSensingLine(tap, ctrlRects[i]);
    const checkPts = [pointAlong(pts, 300), pointAlong(pts, 1800)];
    sensingLines.push({
      pumpTag,
      controllerTag: c.tag,
      sizeIn: 0.5,
      material: 'Brass / copper (or SS 316), 1/2 in',
      points: pts,
      checkValves: checkPts.map((q) => ({ x: Math.round(q.x), y: Math.round(q.y) })),
      checkValveSpacingMm: 1500,
      lengthMm: polyLength(pts)
    });
  });
  sensingLines.forEach((s) => {
    pipes.push({ id: `SNS-${s.controllerTag}`, service: 'sensing', sizeIn: s.sizeIn, points: s.points });
  });
  sensingLines.forEach((s) => {
    [300, 1800].forEach((d) => {
      const q = pointAlong(s.points, d);
      addValve('sensing-check', s.sizeIn, q.x, q.y, q.angleDeg, 'sensing');
    });
  });

  // Diesel fuel lines (one per engine) and exhaust (one per engine)
  const exhaustXs: number[] = [];
  dieselIdx.forEach((mi, k) => {
    const eq = equipment.find((e) => e.tag === main[mi].tag)!;
    const eng = eq.rect;
    const fr = fuelRects[k];
    const fy = eng.y + 1000;
    const routeY = bunds[k].y + bunds[k].h + 250;
    const lx = xPadW - 120 - 100 * k;
    pipes.push({
      id: `FUEL-${k + 1}`,
      service: 'fuel',
      sizeIn: 0.75,
      points: [[fr.x + fr.w / 2, fr.y + fr.h], [fr.x + fr.w / 2, routeY], [lx, routeY], [lx, fy], [eng.x, fy]]
    });
    const baseX = Math.max(Math.round((headerX - 1000) / 50) * 50, eastEdge + 200);
    const exhaustX = baseX + 300 * k;
    exhaustXs.push(exhaustX);
    const ey = eng.y + eng.h - 400;
    pipes.push({
      id: `EXH-${k + 1}`,
      service: 'exhaust',
      sizeIn: main[mi].driverHp <= 200 ? 4 : 6,
      points: [[eng.x + eng.w / 2, ey], [exhaustX, ey], [exhaustX, W + wallN]]
    });
  });
  // Pump drains (casing drain, packing-gland drip, circulation relief) to the floor trench centre-line (NFPA 20 §4.12; IPC §802)
  main.forEach((p, i) => {
    // Taken from the base-plate drip rim at the south end of the skid (clear of the suction pipe, which runs at the nozzle line).
    const dripY = padRects[i].y + PAD_MARGIN + 100;
    pipes.push({ id: `DRN-${p.tag}`, service: 'drain', sizeIn: 0.75, points: [[nozzleX, dripY], [trenchX, dripY]] });
  });
  jockeys.forEach((j, k) => {
    const jr = jockeyRects[k];
    const cx = jr.x + jr.w / 2;
    const dy = jockeyRowY - 250 - 150 * k;
    pipes.push({ id: `DRN-${j.tag}`, service: 'drain', sizeIn: 0.75, points: [[cx, jr.y], [cx, dy], [trenchX, dy]] });
  });
  pipes.push({ id: 'DRN-1', service: 'drain', sizeIn: sump.dischargeSizeIn, points: [[pitC.x, pitC.y], [pitC.x, -wallN]] });

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
    outlet: { x: pitC.x, y: pitC.y, pitMm: pitRect.w, drainIn: sump.dischargeSizeIn }
  };

  // ── Doors & louvers ──
  const doors: PumpRoomLayout['doors'] = [{ x: L - 1400, y: 0, widthMm: 1800, wall: 'south' }];
  const louvers: PumpRoomLayout['louvers'] = [];
  if (hasDiesel) {
    louvers.push({ x: Math.max(900, xPadW - 900), y: 0, widthMm: 1200, wall: 'south', purpose: 'Diesel engine combustion / cooling air intake (NFPA 20 §11.3)' });
    louvers.push({ x: exhaustXs[0], y: W, widthMm: 1200 + 300 * (nD - 1), wall: 'north', purpose: 'Engine room exhaust / relief air discharge' });
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

  // ── Wall penetrations: puddle flanges in the tank wall, sleeves + link seals elsewhere ──
  const penetrations: WallPenetration[] = [];
  const addFlange = (service: WallPenetration['service'], sizeIn: number, y: number, elevationM: number): void => {
    const od = ceilN(outsideDiameterMm(sizeIn) + 200, 10);
    penetrations.push({
      tag: `PF-${String(penetrations.filter((q) => q.kind === 'puddle-flange').length + 1).padStart(2, '0')}`,
      service,
      sizeIn,
      wall: 'west',
      x: -wallW / 2,
      y,
      elevationM,
      kind: 'puddle-flange',
      puddleFlangeOdMm: od,
      sleeveIdMm: 0,
      note: `Cast-in puddle flange, OD ${od} mm, 10 thk, welded to pipe`
    });
  };
  const addSleeve = (service: WallPenetration['service'], sizeIn: number, wall: 'north' | 'south', x: number, elevationM: number): void => {
    const id = ceilN(outsideDiameterMm(sizeIn) + 50, 10);
    penetrations.push({
      tag: `WS-${String(penetrations.filter((q) => q.kind === 'sleeve-seal').length + 1).padStart(2, '0')}`,
      service,
      sizeIn,
      wall,
      x,
      y: wall === 'north' ? W + wallN / 2 : -wallN / 2,
      elevationM,
      kind: 'sleeve-seal',
      puddleFlangeOdMm: 0,
      sleeveIdMm: id,
      note: `Sleeve ID ${id} mm + link seal + firestop (IBC 714)`
    });
  };
  main.forEach((p, i) => addFlange('suction', p.sizes.suctionIn, nozzleY[i], pumpCL));
  addFlange('test', pumps.flowMeterIn, 600, highLevel);
  // (the relief valve discharges into the test return line - no separate relief return penetration)
  addSleeve('discharge', dischargeIn, 'north', headerX, highLevel);
  addSleeve('test', pumps.testHeaderIn, 'south', headerX - 1500, highLevel);
  if (sump.required) addSleeve('drain', sump.dischargeSizeIn, 'south', pitC.x, highLevel);
  dieselIdx.forEach((mi, k) => addSleeve('exhaust', main[mi].driverHp <= 200 ? 4 : 6, 'north', exhaustXs[k], highLevel));

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
    detail: `Maintain ≥ 4.4 °C (40 °F) in the room${hasDiesel ? ' and ≥ 21 °C (70 °F) at the diesel engine(s) (block heater)' : ''}; clear height ${(roofSoffit * 1000).toFixed(0)} mm`
  });
  checks.push({
    id: 'room-drainage',
    title: 'Floor drainage trench capacity',
    reference: 'NFPA 20-2019 §4.12.4; IPC 2021 §802 (indirect waste)',
    status: capacityGpm >= inflow ? 'pass' : 'fail',
    detail: `Trench 300 mm @ 1 %, Manning n = 0.013: ${capacityGpm.toFixed(0)} gpm vs design inflow ${inflow.toFixed(0)} gpm; ${sump.dischargeSizeIn}" ${sump.required ? 'pumped discharge' : 'drain'} from ${sump.tag} ${pitRect.w} x ${pitRect.h} mm pit via air gap`
  });
  const pads = [...padRects, ...jockeyPads, ...bunds];
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
  const westPen = penetrations.filter((q) => q.wall === 'west');
  const otherPen = penetrations.filter((q) => q.wall !== 'west');
  const flangesOk = westPen.every((q) => q.kind === 'puddle-flange') && westPen.filter((q) => q.service === 'suction').length === main.length;
  const sleevesOk = otherPen.every((q) => q.kind === 'sleeve-seal');
  checks.push({
    id: 'penetrations',
    title: 'Tank-wall penetrations use cast-in puddle flanges',
    reference: 'NFPA 22 (tank connections); ACI 350 / BS EN 1992-3 (water-retaining walls); IBC 2021 §714 (penetrations of fire-resistance-rated walls)',
    status: flangesOk && sleevesOk ? 'pass' : 'fail',
    detail: `${westPen.length} puddle flange(s) in the ${wallW} mm tank wall (${westPen.map((q) => `${q.tag} ${q.sizeIn}" OD ${q.puddleFlangeOdMm} mm`).join(', ')}), no wall sleeve in the water-retaining wall; ${otherPen.length} sleeve(s) with link seal and firestop in other walls (${otherPen.map((q) => `${q.tag} ID ${q.sleeveIdMm} mm`).join(', ')})`
  });
  const sensOk =
    sensingLines.length === ctrlDefs.length &&
    sensingLines.every((s) => s.sizeIn === 0.5 && s.checkValves.length === 2 && s.checkValveSpacingMm >= 1500);
  checks.push({
    id: 'sensing-lines',
    title: 'One 1/2 in sensing line per controller with two check valves',
    reference: 'NFPA 20-2019 §4.32 / §10.5.2.1 (pressure sensing line)',
    status: sensOk ? 'pass' : 'fail',
    detail: `${sensingLines.length} sensing line(s) for ${ctrlDefs.length} controller(s); each 1/2 in brass / copper / SS 316, tapped between the discharge check valve and the discharge isolation valve, two check valves with 3/32 in orifice ${sensingLines[0]?.checkValveSpacingMm ?? 1500} mm apart (≥ 1.5 m / 5 ft), shortest line ${Math.min(...sensingLines.map((s) => s.lengthMm)).toFixed(0)} mm; pressure gauge and test connection at the controller`
  });
  const drainCount = pipes.filter((q) => q.service === 'drain' && q.id !== 'DRN-1').length;
  checks.push({
    id: 'pump-drains',
    title: 'Pump casing / packing drains piped to the floor trench',
    reference: 'NFPA 20-2019 §4.12.4; IPC 2021 §802 (indirect waste)',
    status: drainCount === ctrlDefs.length ? 'pass' : 'fail',
    detail: `${drainCount} 3/4 in drain line(s) (one per pump: ${ctrlDefs.map((d) => d.pumpTag).join(', ')}) carry casing drain, packing-gland drip${main.some((p) => p.driver === 'electric') ? ' and circulation relief discharge' : ''} to the trench centre-line at x = ${trenchX} mm, then to ${sump.tag}`
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
    penetrations,
    sensingLines,
    drainageSump: sump,
    checks
  };
}

/** IPC §712 drainage sump with duplex submersible pumps (pumped when the pump-room floor is below grade). */
function designSump(
  required: boolean,
  ffl: number,
  inflow: number,
  rect: Rect,
  pitDepthMm: number,
  levels: DrainageSumpDesign['levels']
): DrainageSumpDesign {
  const tag = 'DS-1';
  const pitOk = Math.min(rect.w, rect.h) >= 457 && pitDepthMm >= 610;
  const pitCheck: DesignCheck = {
    id: 'sump-pit-size',
    title: 'Sump pit minimum size',
    reference: 'IPC 2021 §712 (pit ≥ 18 in / 457 mm diameter and ≥ 24 in / 610 mm deep, gas-tight cover)',
    status: pitOk ? 'pass' : 'fail',
    detail: `${tag} pit ${rect.w} x ${rect.h} mm x ${pitDepthMm} mm deep vs minimum 457 mm width and 610 mm depth; solid gas-tight cover / grating`
  };
  if (!required) {
    return {
      required: false,
      tag,
      rect,
      pitDepthMm,
      inflowGpm: inflow,
      pumps: [],
      dischargeSizeIn: 4,
      levels,
      workingVolumeGal: 0,
      cycleMinutes: 0,
      dischargeTo: 'Gravity drain to building drain (IPC 802 air gap)',
      controls: ['Gravity drain: trench flows to the pit and on to the building drain through an air gap (IPC 802)'],
      checks: [
        pitCheck,
        {
          id: 'sump-capacity',
          title: 'Sump capacity',
          reference: 'IPC 2021 §712 / Table 712.4.2',
          status: 'pass',
          detail: `Pump-room floor at ${ffl.toFixed(2)} m is not below grade (limit -0.50 m): gravity drain, design inflow ${inflow.toFixed(0)} gpm, no sump pump required`
        },
        {
          id: 'sump-discharge-valves',
          title: 'Sump pump discharge check and full-open valves',
          reference: 'IPC 2021 §712',
          status: 'pass',
          detail: 'Not applicable: gravity drain, no sump pumps'
        },
        {
          id: 'sump-duplex',
          title: 'Duplex sump pumps with alternator and high-level alarm',
          reference: 'IPC 2021 §712 (good practice for fire pump rooms)',
          status: 'pass',
          detail: 'Not applicable: gravity drain, no sump pumps'
        }
      ]
    };
  }
  const flow = ceil5(Math.max(1.5 * inflow, 21));
  const dischargeSizeIn = [2, 2.5, 3, 4].find((s) => velocityFps(flow, internalDiameterIn(s, 'sch40')) <= 8) ?? 4;
  const v = velocityFps(flow, internalDiameterIn(dischargeSizeIn, 'sch40'));
  const headFt = ceil5((-ffl + pitDepthMm / 1000 + 1.0) * 1.3 * 3.28084);
  const req = (flow * headFt) / (3960 * 0.45);
  const motorHp = NEMA_MOTOR_HP.find((h) => h >= req - 1e-9) ?? NEMA_MOTOR_HP[NEMA_MOTOR_HP.length - 1];
  const pumpsList = ['SP-1', 'SP-2'].map((t) => ({ tag: t, flowGpm: flow, headFt, motorHp, type: 'Submersible drainage pump' }));
  const workingVolumeGal = Math.round(((levels.leadOnMm - levels.offMm) / 1000) * (rect.w / 1000) * (rect.h / 1000) * 264.172 * 10) / 10;
  const cycleMinutes = Math.round((workingVolumeGal / flow) * 100) / 100;
  const minGpm = IPC_712_MIN_GPM[dischargeSizeIn];
  return {
    required: true,
    tag,
    rect,
    pitDepthMm,
    inflowGpm: inflow,
    pumps: pumpsList,
    dischargeSizeIn,
    levels,
    workingVolumeGal,
    cycleMinutes,
    dischargeTo: 'Building storm / sanitary drain via air gap (IPC 802) - verify with plumbing engineer',
    controls: [
      'Alternator: SP-1 / SP-2 alternate duty (lead / lag)',
      `Float switches: OFF ${levels.offMm} / LEAD ${levels.leadOnMm} / LAG ${levels.lagOnMm} / HIGH-LEVEL ALARM ${levels.alarmMm} mm above pit floor`,
      'High-level alarm to FACP',
      'Check valve + full-open gate valve on each pump discharge'
    ],
    checks: [
      pitCheck,
      {
        id: 'sump-capacity',
        title: 'Sump pump capacity',
        reference: 'IPC 2021 §712.4 / Table 712.4.2 (2 in: 21 gpm, 2-1/2 in: 30 gpm, 3 in: 46 gpm)',
        status: flow >= 1.5 * inflow && flow >= minGpm ? 'pass' : 'fail',
        detail: `Each pump ${flow} gpm @ ${headFt} ft (${motorHp} HP) vs 1.5 x design inflow ${inflow.toFixed(0)} gpm = ${(1.5 * inflow).toFixed(1)} gpm and Table 712.4.2 minimum ${minGpm} gpm for a ${dischargeSizeIn}" discharge; velocity ${v.toFixed(2)} fps (limit 8 fps); working volume ${workingVolumeGal} gal, cycle ${cycleMinutes} min`
      },
      {
        id: 'sump-discharge-valves',
        title: 'Sump pump discharge check and full-open valves',
        reference: 'IPC 2021 §712 (check valve and full-open valve on each pump discharge)',
        status: 'pass',
        detail: `Each of ${pumpsList.map((q) => q.tag).join(' and ')} has a ${dischargeSizeIn}" check valve and a ${dischargeSizeIn}" full-open gate valve on its discharge, discharging to the building drain through an air gap (IPC 802)`
      },
      {
        id: 'sump-duplex',
        title: 'Duplex sump pumps with alternator and high-level alarm',
        reference: 'IPC 2021 §712 (good practice for fire pump rooms)',
        status: pumpsList.length >= 2 ? 'pass' : 'fail',
        detail: `${pumpsList.length} pumps (SP-1 duty, SP-2 standby) with alternator; float levels off ${levels.offMm} / lead ${levels.leadOnMm} / lag ${levels.lagOnMm} / alarm ${levels.alarmMm} mm; high-level alarm to FACP`
      }
    ]
  };
}
