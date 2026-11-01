/**
 * FP-110 — PUMP ROOM DETAILS: puddle flange, wall sleeve & link seal, anti-vortex plate, pressure sensing line,
 * drainage sump pit, trench section and the detail notes. Each framed panel is drawn at its own enlargement
 * (1:10 or 1:20) on the 1:20 sheet; every dimension carries the TRUE value (override text).
 */
import { formatPipeSize } from '../standards/pipeData';
import { ballValve, butterflyValve, checkValve, pressureGauge } from './symbols';
import { type Box, type Ctx, FRAME, Placer, PX, PY, TBLK, arrowLine, dimBoxes, drawNotes, textWidth } from './sheetKit';
import { odOf, westWallMm } from './sheetGeom';

type Pt = [number, number];

/** Engineering sketch helper: local real-mm coordinates → model coordinates at enlargement `f`. */
class Sk {
  constructor(
    readonly c: Ctx,
    readonly P: Placer,
    readonly f: number,
    readonly ox: number,
    readonly oy: number
  ) {}
  m(x: number, y: number): Pt {
    return [this.ox + x * this.f, this.oy + y * this.f];
  }
  line(layer: string, x1: number, y1: number, x2: number, y2: number): void {
    const a = this.m(x1, y1);
    const z = this.m(x2, y2);
    this.c.b.line(layer, a[0], a[1], z[0], z[1]);
  }
  poly(layer: string, pts: Pt[], closed = false): void {
    this.c.b.polyline(layer, pts.map(([x, y]) => this.m(x, y)), closed);
  }
  rect(layer: string, x: number, y: number, w: number, h: number): void {
    const a = this.m(x, y);
    this.c.b.rect(layer, a[0], a[1], w * this.f, h * this.f);
  }
  hatch(x: number, y: number, w: number, h: number, sp = 1.6): void {
    const a = this.m(x, y);
    this.c.b.hatchRect(a[0], a[1], w * this.f, h * this.f, sp);
  }
  /** Concrete / masonry block: outline + hatch, registered as an obstacle. */
  conc(x: number, y: number, w: number, h: number, layer = 'FP-WALL'): void {
    this.rect(layer, x, y, w, h);
    this.hatch(x, y, w, h);
    this.reg(x, y, x + w, y + h);
  }
  circle(layer: string, x: number, y: number, r: number): void {
    const a = this.m(x, y);
    this.c.b.circle(layer, a[0], a[1], r * this.f);
  }
  pipe(layer: string, pts: Pt[], od: number, centre = false): void {
    this.c.b.pipe(layer, pts.map(([x, y]) => this.m(x, y)), od * this.f, centre);
  }
  reg(x0: number, y0: number, x1: number, y1: number, soft = false): void {
    const a = this.m(x0, y0);
    const z = this.m(x1, y1);
    this.P.addRect(Math.min(a[0], z[0]), Math.min(a[1], z[1]), Math.abs(z[0] - a[0]), Math.abs(z[1] - a[1]), soft);
  }
  /** Linear dimension with the given true text; registers its text box as an obstacle. */
  dim(x1: number, y1: number, x2: number, y2: number, off: number, txt: string): void {
    const a = this.m(x1, y1);
    const z = this.m(x2, y2);
    this.c.b.dimLinear(a[0], a[1], z[0], z[1], off, txt);
    for (const bx of dimBoxes(this.c.sheet.scale, a[0], a[1], z[0], z[1], off, txt)) this.P.addHard(bx);
  }
  /** Text at a local point (registered). */
  text(x: number, y: number, h: number, t: string, o: { align?: 'left' | 'center' | 'right'; vAlign?: 'baseline' | 'bottom' | 'middle' | 'top'; rot?: number } = {}): Box {
    const a = this.m(x, y);
    return this.P.text('FP-ANNO', a[0], a[1], h, t, { align: o.align ?? 'left', vAlign: o.vAlign ?? 'middle', rotationDeg: o.rot });
  }
  callout(x: number, y: number, lines: string[], prefer?: number[]): void {
    const a = this.m(x, y);
    this.P.callout(a, lines, 2.2, prefer);
  }
  /** Break (zig-zag) line across a pipe at local x. */
  breakV(x: number, y0: number, y1: number, layer: string): void {
    const n = 4;
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) pts.push([x + (i % 2 ? 1 : -1) * 0.12 * Math.abs(y1 - y0), y0 + ((y1 - y0) * i) / n]);
    this.poly(layer, pts, false);
  }
}

/** Panel frame with a numbered title; returns the placer-bounds for its interior (paper → model). */
function panel(c: Ctx, x0: number, y0: number, w: number, h: number, no: number, title: string, scaleText: string): Box {
  const { b, sheet } = c;
  const s = sheet.scale;
  b.rect('FP-ANNO', PX(c, x0), PY(c, y0), w * s, h * s);
  b.line('FP-ANNO', PX(c, x0), PY(c, y0 + h - 10), PX(c, x0 + w), PY(c, y0 + h - 10));
  b.circle('FP-ANNO', PX(c, x0 + 6), PY(c, y0 + h - 5), 3.4 * s);
  b.text('FP-ANNO', PX(c, x0 + 6), PY(c, y0 + h - 5), 2.8, String(no), { align: 'center', vAlign: 'middle' });
  b.text('FP-ANNO', PX(c, x0 + 12), PY(c, y0 + h - 5), 3.6, title, { vAlign: 'middle' });
  b.text('FP-ANNO', PX(c, x0 + w - 2), PY(c, y0 + h - 5), 2.6, scaleText, { align: 'right', vAlign: 'middle' });
  return { x0: PX(c, x0 + 2), y0: PY(c, y0 + 2), x1: PX(c, x0 + w - 2), y1: PY(c, y0 + h - 12) };
}

const roundUp10 = (v: number): number => Math.ceil(v / 10 - 1e-9) * 10;

/** The notes of FP-110 (>= 10, each citing its clause). */
export function pumpRoomDetailNotes(c: Ctx): string[] {
  const { r } = c;
  const room = r.room;
  const pf = room.penetrations.find((p) => p.kind === 'puddle-flange');
  const ds = room.drainageSump;
  const tr = room.trench;
  return [
    `Water-retaining tank wall: every pipe passes through a cast-in puddle flange (water stop) - flange OD = pipe OD + 200 mm (rounded up to 10 mm)${pf ? `, here ${pf.puddleFlangeOdMm} mm` : ''}, 10 mm thick, centred in the wall and welded all round to the pipe. Wall sleeves are not used in the tank wall (ACI 350, BS EN 1992-3, NFPA 22).`,
    'Place the puddle-flange pipe spool before the wall is cast; keep the flange 75 mm minimum clear of reinforcement and fix the pipe against displacement. Hydrostatic test of the tank before backfill and commissioning (NFPA 22).',
    'Other wall and slab penetrations: steel sleeve with ID = pipe OD + 50 mm (rounded up to 10 mm), mechanical link-type seal at both faces, annular space firestopped with a tested system giving the wall rating (IBC 714, UL 1479 / ASTM E814).',
    `Pressure sensing line (NFPA 20-2019 4.32 / 10.5.2.1): one 1/2 in brass, copper or series 300 stainless line per controller, tapped between the pump discharge check valve and the discharge isolation valve, never from the suction side or a shared header.`,
    'Each sensing line has two check valves not less than 5 ft (1.5 m) apart, each with a 3/32 in (2.4 mm) orifice in the clapper, followed by a pressure gauge and a test connection at the controller (NFPA 20-2019 10.5.2.1).',
    `Anti-vortex plate (NFPA 22, ${r.tank.sump.vortexPlateMm} mm square): plate side not less than 2 x the suction pipe diameter D; the open suction inlet turned down at D/2 (150 mm minimum) above the sump floor, on stainless or GRP legs.`,
    `Drain lines: pump casing drains, packing-gland drips and circulation-relief discharge are piped indirectly to the floor trench (NFPA 20 4.12 / 4.26). Trench ${tr.widthMm} mm wide with ${tr.slopePercent} % fall to the sump pit, galvanised grating rated for maintenance loads.`,
    `Drainage sump ${ds.tag} (IPC 712): pit not less than 18 in (457 mm) diameter and 24 in (610 mm) deep, solid gas-tight cover or grating, ${ds.pumps.length > 1 ? 'duplex submersible pumps with alternator' : 'submersible pump'}, high-level alarm to the fire alarm panel; each pump discharge has a check valve and a full-open valve.`,
    'Sump discharge to the building drain or storm drain through an air gap / indirect waste (IPC 802, UPC 801). Verify the receiving drain with the plumbing engineer. Float levels are measured from the pit floor.',
    'Fire-rated walls: openings for pipes, ducts, louvres and doors protected to the rating of the wall (IBC 714, IBC 913.2.1). Pump room 1-hour or 2-hour rated construction as stated on FP-101.',
    'Concrete work to ACI 350 / BS EN 1992-3 for liquid-retaining structures; waterproofing of the tank internal surfaces and joints by the structural contractor; all embedded steel to be galvanised or stainless.',
    'All dimensions are in millimetres. Details are drawn at the stated scale on the 1:20 sheet; symbols of valves and instruments are enlarged for clarity and are not to scale. See FP-101 for the penetration tags PF-nn / WS-nn.'
  ];
}

export function drawPumpRoomDetailsSheet(c: Ctx): void {
  const { b, sheet, r } = c;
  const s = sheet.scale;
  const room = r.room;
  const tank = r.tank;
  const sp = tank.sump;
  const ds = room.drainageSump;
  const tr = room.trench;
  const th = 2.3;
  const full: Box = { x0: PX(c, FRAME.x0 + 1), y0: PY(c, FRAME.y0 + 1), x1: PX(c, FRAME.x1 - 1), y1: PY(c, FRAME.y1 - 1) };
  void full;
  const tblk: Box = { x0: PX(c, TBLK.x0), y0: PY(c, TBLK.y0), x1: PX(c, TBLK.x1), y1: PY(c, TBLK.y1) };
  void tblk;

  // ───────────────────────── geometry shared by the panels ─────────────────────────
  const pfPen = room.penetrations.find((p) => p.kind === 'puddle-flange') ?? room.penetrations[0];
  const slPen = room.penetrations.find((p) => p.kind === 'sleeve-seal');
  const wTank = westWallMm(r);
  const wRoom = room.wallThicknessMm;

  const ROW1 = { y0: 326, h: 254 };
  const ROW2 = { y0: 74, h: 248 };

  // ═════════════════════ 1. PUDDLE FLANGE DETAIL (1:10) ═════════════════════
  {
    const x0 = 24;
    const w = 200;
    const bounds = panel(c, x0, ROW1.y0, w, ROW1.h, 1, 'PUDDLE FLANGE DETAIL', 'SCALE 1:10');
    const P = new Placer(c, bounds);
    const sk = new Sk(c, P, s / 10, PX(c, x0 + 70), PY(c, ROW1.y0 + ROW1.h - 72));
    const pipeIn = pfPen?.sizeIn ?? sp.suctionPipeIn;
    const od = odOf(pipeIn);
    const fod = pfPen?.puddleFlangeOdMm || roundUp10(od + 200);
    const t = wTank;
    const hh = fod / 2 + 220;
    const stub = 380;
    // wall (with hole for the pipe) – section
    sk.conc(0, od / 2, t, hh - od / 2);
    sk.conc(0, -hh, t, hh - od / 2);
    // pipe
    sk.pipe('FP-PIPE-SUCT', [[-stub, 0], [t + stub, 0]], od, true);
    sk.line('FP-WALL', 0, od / 2, t, od / 2);
    sk.line('FP-WALL', 0, -od / 2, t, -od / 2);
    // flange plate (10 mm, centred)
    sk.rect('FP-WALL', t / 2 - 5, -fod / 2, 10, fod - od);
    sk.rect('FP-WALL', t / 2 - 5, od / 2, 10, fod / 2 - od / 2);
    // fillet welds
    for (const sg of [1, -1]) {
      for (const dx of [-1, 1]) {
        const px = t / 2 + dx * 5;
        const py = sg * od / 2;
        sk.poly('FP-ANNO', [[px, py], [px + dx * 22, py], [px, py + sg * 22]], true);
      }
    }
    sk.breakV(-stub, -od / 2 - 40, od / 2 + 40, 'FP-ANNO');
    sk.breakV(t + stub, -od / 2 - 40, od / 2 + 40, 'FP-ANNO');
    sk.text(-stub / 2 - 30, od / 2 + 60 + 40, 2.2, 'TANK (WATER) SIDE', { align: 'center', vAlign: 'bottom' });
    sk.text(t + stub / 2 + 30, od / 2 + 60 + 40, 2.2, 'PUMP ROOM SIDE', { align: 'center', vAlign: 'bottom' });
    sk.reg(-stub - 300, od / 2 + 60, t + stub + 300, od / 2 + 200);
    // dimensions
    sk.dim(t, -fod / 2, t, fod / 2, -15, String(fod)); // flange OD, right of the wall
    sk.dim(0, -hh, t / 2 - 5, -hh, -8, String(Math.round(t / 2 - 5)));
    sk.dim(t / 2 + 5, -hh, t, -hh, -8, String(Math.round(t / 2 - 5)));
    sk.dim(0, -hh, t, -hh, -17, String(t));
    sk.dim(t / 2 - 5, fod / 2, t / 2 + 5, fod / 2, 8, '10');
    sk.dim(-stub + 60, -od / 2, -stub + 60, od / 2, 8, `OD ${Math.round(od)}`);
    // front view: pipe + flange circles
    const fv = new Sk(c, P, s / 10, PX(c, x0 + 52), PY(c, ROW1.y0 + ROW1.h - 160));
    fv.circle('FP-WALL', 0, 0, fod / 2);
    fv.circle('FP-PIPE-SUCT', 0, 0, od / 2);
    fv.circle('FP-PIPE-SUCT', 0, 0, od / 2 - 7);
    fv.line('FP-CNTR', -fod / 2 - 60, 0, fod / 2 + 60, 0);
    fv.line('FP-CNTR', 0, -fod / 2 - 60, 0, fod / 2 + 60);
    fv.reg(-fod / 2 - 60, -fod / 2 - 60, fod / 2 + 60, fod / 2 + 60);
    fv.dim(-fod / 2, -fod / 2, fod / 2, -fod / 2, -9, String(fod));
    sk.text(-stub - 270, -hh - 560, 2.2, 'VIEW ON FLANGE FROM TANK SIDE', { align: 'left' });
    // callouts
    P.setBounds({ x0: PX(c, x0 + 3), y0: PY(c, ROW1.y0 + 3), x1: PX(c, x0 + w - 3), y1: PY(c, ROW1.y0 + ROW1.h - 12) });
    sk.callout(t / 2, fod / 2 - 50, ['CAST-IN PUDDLE FLANGE', `${fod} OD x 10 THK, CENTRED IN WALL`], [90, 45, 135]);
    sk.callout(t / 2 + 5, od / 2 + 15, ['CONTINUOUS FILLET WELD', 'BOTH SIDES TO PIPE'], [90, 60, 120]);
    sk.callout(0, hh - 120, [`TANK WALL ${t} THK (ACI 350)`, 'WATER-RETAINING CONCRETE'], [180, 135, 225]);
    // specification block
    const spec = [`PIPE ${formatPipeSize(pipeIn)} (OD ${Math.round(od)}) - TAG PF-nn`, 'FLANGE OD = PIPE OD + 200 (ROUND UP 10)', 'MATERIAL: STEEL, HOT-DIP GALVANISED (OR SS)', 'NO WALL SLEEVE IN WATER-RETAINING WALL'];
    spec.forEach((ln, i) => P.text('FP-ANNO', PX(c, x0 + 78), PY(c, ROW1.y0 + 60 - i * 4.6), 2.2, ln, { vAlign: 'middle' }));
  }

  // ═════════════════════ 2. WALL SLEEVE & LINK SEAL DETAIL (1:10) ═════════════════════
  {
    const x0 = 227;
    const w = 200;
    const bounds = panel(c, x0, ROW1.y0, w, ROW1.h, 2, 'WALL SLEEVE & LINK SEAL DETAIL', 'SCALE 1:10');
    const P = new Placer(c, bounds);
    const sk = new Sk(c, P, s / 10, PX(c, x0 + 66), PY(c, ROW1.y0 + ROW1.h - 78));
    const pipeIn = slPen?.sizeIn ?? room.systemOutlet.sizeIn;
    const od = odOf(pipeIn);
    const id = slPen?.sleeveIdMm || roundUp10(od + 50);
    const t = wRoom;
    const sleeveT = 6;
    const hh = id / 2 + 230;
    const stub = 330;
    sk.conc(0, id / 2 + sleeveT, t, hh - id / 2 - sleeveT);
    sk.conc(0, -hh, t, hh - id / 2 - sleeveT);
    // sleeve (steel pipe) through the wall
    for (const sg of [1, -1]) {
      sk.rect('FP-WALL', -20, sg > 0 ? id / 2 : -id / 2 - sleeveT, t + 40, sleeveT);
    }
    sk.pipe('FP-PIPE-DISC', [[-stub, 0], [t + stub, 0]], od, true);
    // annulus: link seal blocks at both ends, firestop depth in the middle
    const gap = (id - od) / 2;
    for (const sg of [1, -1]) {
      const y0 = sg > 0 ? od / 2 : -od / 2 - gap;
      // link seal modules (hatched = rubber links) 25 deep at each wall face
      for (const x of [0, t - 25]) {
        sk.rect('FP-ANNO', x, y0, 25, gap);
        sk.hatch(x, y0, 25, gap, 0.9);
      }
      // firestop / mineral wool fill between the seals
      sk.rect('FP-HIDN', 25, y0, t - 50, gap);
    }
    // pressure plates / bolts of the link seals
    for (const x of [12, t - 12]) {
      sk.line('FP-ANNO', x, od / 2 + gap, x, od / 2 + gap + 40);
      sk.line('FP-ANNO', x, -od / 2 - gap, x, -od / 2 - gap - 40);
    }
    sk.breakV(-stub, -od / 2 - 40, od / 2 + 40, 'FP-ANNO');
    sk.breakV(t + stub, -od / 2 - 40, od / 2 + 40, 'FP-ANNO');
    sk.reg(-stub, -od / 2 - 10, t + stub, od / 2 + 10);
    // dimensions
    sk.dim(t, -id / 2, t, id / 2, -18, String(id));
    sk.dim(0, -hh, t, -hh, -8, String(t));
    sk.dim(-stub + 60, -od / 2, -stub + 60, od / 2, 8, `OD ${Math.round(od)}`);
    sk.dim(t / 2, od / 2, t / 2, id / 2, 24, String(Math.round(gap)));
    P.setBounds({ x0: PX(c, x0 + 3), y0: PY(c, ROW1.y0 + 3), x1: PX(c, x0 + w - 3), y1: PY(c, ROW1.y0 + ROW1.h - 12) });
    sk.callout(12, od / 2 + gap / 2, ['MECHANICAL LINK SEAL', 'BOTH FACES'], [90, 45, 135]);
    sk.callout(t / 2, od / 2 + gap / 2, ['FIRESTOP: MINERAL WOOL +', 'INTUMESCENT SEALANT (IBC 714)'], [270, 315, 225]);
    sk.callout(t / 2, id / 2 + sleeveT / 2, ['STEEL SLEEVE ID ' + id, '(PIPE OD + 50, ROUND UP 10)'], [90, 45, 135]);
    sk.callout(0, -hh + 200, ['FIRE-RATED WALL', `${wRoom} THK`], [180, 225, 135]);
    const spec = [`PIPE ${formatPipeSize(pipeIn)} (OD ${Math.round(od)}) - TAG WS-nn`, 'SLEEVE PROJECTS 20 BOTH FACES', 'FIRESTOP TESTED TO UL 1479 / ASTM E814', 'F-RATING NOT LESS THAN THE WALL RATING'];
    spec.forEach((ln, i) => P.text('FP-ANNO', PX(c, x0 + 22), PY(c, ROW1.y0 + 56 - i * 4.6), 2.2, ln, { vAlign: 'middle' }));
  }

  // ═════════════════════ 3. ANTI-VORTEX PLATE DETAIL (1:10) ═════════════════════
  {
    const x0 = 430;
    const w = 258;
    const bounds = panel(c, x0, ROW1.y0, w, ROW1.h, 3, 'ANTI-VORTEX PLATE DETAIL', 'SCALE 1:10');
    const P = new Placer(c, bounds);
    const pl = sp.vortexPlateMm;
    const D = sp.suctionPipeOdMm;
    const inlet = sp.inletAboveSumpFloorMm;
    // plan (left)
    const pk = new Sk(c, P, s / 10, PX(c, x0 + 58), PY(c, ROW1.y0 + ROW1.h - 72));
    pk.text(-pl / 2 - 140, pl / 2 + 520, 2.4, 'PLAN', { align: 'left' });
    pk.rect('FP-TANK', -pl / 2, -pl / 2, pl, pl);
    pk.circle('FP-PIPE-SUCT', 0, 0, D / 2);
    pk.circle('FP-PIPE-SUCT', 0, 0, D / 2 - 7);
    pk.line('FP-CNTR', -pl / 2 - 80, 0, pl / 2 + 80, 0);
    pk.line('FP-CNTR', 0, -pl / 2 - 80, 0, pl / 2 + 80);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) pk.circle('FP-TANK', sx * (pl / 2 - 40), sy * (pl / 2 - 40), 18);
    pk.reg(-pl / 2 - 80, -pl / 2 - 80, pl / 2 + 80, pl / 2 + 80);
    pk.dim(-pl / 2, -pl / 2, pl / 2, -pl / 2, -9, String(pl));
    pk.dim(pl / 2, -pl / 2, pl / 2, pl / 2, -9, String(pl));
    pk.dim(-D / 2, 0, D / 2, 0, 0, `D=${Math.round(D)}`);
    // section (right)
    const q = new Sk(c, P, s / 10, PX(c, x0 + 168), PY(c, ROW1.y0 + 118));
    const fl = 100; // floor slab thickness drawn
    q.conc(-pl / 2 - 420, -fl, pl + 840, fl);
    q.text(-pl / 2 - 420, 2.6 * 190, 2.4, 'SECTION', { align: 'left' });
    // water level
    q.line('FP-WATR', -pl / 2 - 420, inlet + D + 330, pl / 2 + 420, inlet + D + 330);
    q.text(pl / 2 + 400, inlet + D + 330 + 90, 2.2, 'LWL', { align: 'right', vAlign: 'bottom' });
    // plate on legs
    const legH = Math.max(40, Math.min(60, inlet / 3));
    q.rect('FP-TANK', -pl / 2, legH, pl, 12);
    q.hatch(-pl / 2, legH, pl, 12, 0.6);
    for (const sx of [-1, 1]) q.line('FP-TANK', sx * (pl / 2 - 40), 0, sx * (pl / 2 - 40), legH);
    // suction pipe + turned-down elbow
    const zEl = inlet + D / 2 + 90;
    q.pipe('FP-PIPE-SUCT', [[-pl / 2 - 360, zEl + 340], [0, zEl + 340], [0, inlet]], D, true);
    q.reg(-pl / 2 - 420, 0, pl / 2 + 420, zEl + 340 + D / 2);
    // dims
    q.dim(pl / 2 + 20, 0, pl / 2 + 20, inlet, -10, String(inlet));
    q.dim(-pl / 2, legH + 12, pl / 2, legH + 12, 0, String(pl));
    q.dim(-D / 2, inlet - 30, D / 2, inlet - 30, 0, `D=${Math.round(D)}`);
    P.setBounds({ x0: PX(c, x0 + 3), y0: PY(c, ROW1.y0 + 3), x1: PX(c, x0 + w - 3), y1: PY(c, ROW1.y0 + ROW1.h - 12) });
    q.callout(-pl / 2 + 80, legH + 12, ['ANTI-VORTEX PLATE', `${pl} SQ x 10 THK (>= 2D)`], [270, 225, 315]);
    q.callout(0, inlet + 20, ['PIPE INLET D/2 ABOVE FLOOR', `(${inlet} MIN. 150)`], [0, 45, 315]);
    q.callout(-pl / 2 + 40, 20, ['LEGS (SS 316 / GRP)', 'ANCHORED TO PIT FLOOR'], [270, 225, 180]);
    const spec = [`SUCTION PIPE ${formatPipeSize(sp.suctionPipeIn)} TURNED DOWN`, `PLATE SIDE ${pl} = 2D MINIMUM`, `INLET ${inlet} = D/2 ABOVE SUMP FLOOR`, 'NFPA 22 / NFPA 20 4.14 (VORTEX CONTROL)'];
    spec.forEach((ln, i) => P.text('FP-ANNO', PX(c, x0 + 6), PY(c, ROW1.y0 + 52 - i * 4.6), 2.2, ln, { vAlign: 'middle' }));
  }

  // ═════════════════════ 6. TRENCH SECTION DETAIL (1:10) ═════════════════════
  {
    const x0 = 691;
    const w = 137;
    const bounds = panel(c, x0, ROW1.y0, w, ROW1.h, 6, 'TRENCH SECTION DETAIL', 'SCALE 1:10');
    const P = new Placer(c, bounds);
    const tw = tr.widthMm;
    const d0 = tr.depthStartMm;
    const d1 = tr.depthEndMm;
    const sk = new Sk(c, P, s / 10, PX(c, x0 + 68), PY(c, ROW1.y0 + ROW1.h - 42));
    const slab = Math.max(150, d1 + 100);
    const side = 300;
    sk.conc(-tw / 2 - side, -slab, side, slab); // left slab
    sk.conc(tw / 2, -slab, side, slab);
    sk.conc(-tw / 2, -slab, tw, slab - d0); // floor under trench
    // trench floor rendering: hatch below invert
    sk.line('FP-TRCH', -tw / 2, -d0, tw / 2, -d0);
    // grating on ledge angles
    sk.rect('FP-TRCH', -tw / 2 - 20, -30, tw + 40, 30);
    for (let x = -tw / 2 + 25; x < tw / 2; x += 25) sk.line('FP-TRCH', x, -30, x, 0);
    for (const sg of [-1, 1]) sk.line('FP-TRCH', sg * tw / 2, -30, sg * tw / 2, -d0);
    sk.line('FP-CNTR', 0, 120, 0, -slab - 100);
    sk.reg(-tw / 2 - 20, -d0, tw / 2 + 20, 60);
    sk.dim(-tw / 2, 0, tw / 2, 0, 9, String(tw));
    sk.dim(tw / 2, -d0, tw / 2, 0, -18, String(d0));
    sk.dim(-tw / 2 - side, -slab, -tw / 2 - side, 0, 8, String(Math.round(slab)));
    P.setBounds({ x0: PX(c, x0 + 3), y0: PY(c, ROW1.y0 + 3), x1: PX(c, x0 + w - 3), y1: PY(c, ROW1.y0 + ROW1.h - 12) });
    sk.callout(0, -12, [`GALV. GRATING ${tr.grating.length > 30 ? 'ON LEDGE ANGLES' : tr.grating}`], [90, 60, 120]);
    sk.callout(0, -d0 + 8, ['TRENCH INVERT, SCREED TO FALL'], [270, 300, 240]);
    // longitudinal sketch (NTS, vertical exaggerated)
    const L0 = PX(c, x0 + 12);
    const L1 = PX(c, x0 + w - 12);
    const yTopP = ROW1.y0 + 108;
    b.text('FP-ANNO', PX(c, x0 + 6), PY(c, yTopP + 22), 2.6, 'LONGITUDINAL SECTION (NTS)', { vAlign: 'middle' });
    b.line('FP-TRCH', L0, PY(c, yTopP + 8), L1, PY(c, yTopP + 8)); // floor level
    b.line('FP-TRCH', L0, PY(c, yTopP - 4), L1, PY(c, yTopP - 22));
    b.line('FP-TRCH', L0, PY(c, yTopP + 8), L0, PY(c, yTopP - 4));
    b.line('FP-TRCH', L1, PY(c, yTopP + 8), L1, PY(c, yTopP - 22));
    arrowLine(b, [L1 - 4 * s, PY(c, yTopP - 24)], [L0 + 40 * s, PY(c, yTopP - 14)], s);
    b.text('FP-ANNO', (L0 + L1) / 2, PY(c, yTopP - 29), 2.4, `${tr.slopePercent} % FALL (1:${Math.round(100 / Math.max(tr.slopePercent, 0.1))}) TO SUMP ${ds.tag}`, { align: 'center', vAlign: 'middle' });
    b.text('FP-ANNO', L0 + 1 * s, PY(c, yTopP + 3), 2.2, 'START', { vAlign: 'middle' });
    b.text('FP-ANNO', L0 + 1 * s, PY(c, yTopP - 9), 2.2, `INVERT ${d0}`, { vAlign: 'middle' });
    b.text('FP-ANNO', L1 - 1 * s, PY(c, yTopP - 27 + 0), 2.2, `END ${d1}`, { align: 'right', vAlign: 'middle' });
    const spec = [`CHANNEL ${tw} WIDE x ${d0}-${d1} DEEP`, `LENGTH ${tr.lengthMm} (TO ${ds.tag})`, `GRATING: ${tr.grating}`];
    spec.forEach((ln, i) => {
      for (const [k, part] of wrapLines(ln, 30).entries()) P.text('FP-ANNO', PX(c, x0 + 6), PY(c, ROW1.y0 + 36 - i * 8.6 - k * 3.8), 2.1, part, { vAlign: 'middle' });
    });
  }

  // ═════════════════════ 4. PRESSURE SENSING LINE DETAIL (1:20) ═════════════════════
  {
    const x0 = 24;
    const w = 276;
    const bounds = panel(c, x0, ROW2.y0, w, ROW2.h, 4, 'PRESSURE SENSING LINE DETAIL', 'SCALE 1:20 (VALVES ENLARGED)');
    const P = new Placer(c, bounds);
    const sk = new Sk(c, P, s / 20, PX(c, x0 + 40), PY(c, ROW2.y0 + 70));
    const sl = room.sensingLines[0];
    const dIn = 4;
    const dOd = Math.max(odOf(r.pumps.mainPumps[0]?.sizes.dischargeIn ?? dIn), 100);
    const sym = 110; // enlarged symbol size (mm at detail scale)
    // discharge pipe (left → right) with check valve, tap, butterfly valve
    sk.pipe('FP-PIPE-DISC', [[-700, 0], [2100, 0]], dOd, true);
    checkValve(b, sk.m(-250, 0)[0], sk.m(-250, 0)[1], 0, sym * 3.4 * sk.f);
    butterflyValve(b, sk.m(1200, 0)[0], sk.m(1200, 0)[1], 0, sym * 3.4 * sk.f);
    sk.text(-250, -380, 2.2, 'DISCHARGE CHECK VALVE', { align: 'center' });
    sk.text(1200, -380, 2.2, 'DISCHARGE ISOLATION VALVE', { align: 'center' });
    sk.reg(-700, -dOd / 2 - 20, 2100, dOd / 2 + 20);
    sk.text(-700, dOd / 2 + 140, 2.2, 'PUMP', { align: 'left' });
    arrowLine(b, sk.m(-600, dOd / 2 + 140 - 140), sk.m(-480, dOd / 2 + 140 - 140), s);
    // tap
    const tapX = 480;
    sk.reg(tapX - 30, dOd / 2, tapX + 30, 480, true);
    // sensing route: up 400 → east 2100 total length (300 + 1500 + 300)
    const upLeg = 600;
    const cv1 = 300;
    const cv2 = cv1 + (sl?.checkValveSpacingMm ?? 1500);
    const routeEnd = cv2 + 700;
    const pts: Pt[] = [[tapX, dOd / 2], [tapX, upLeg], [tapX + (routeEnd - (upLeg - dOd / 2)), upLeg]];
    sk.poly('FP-PIPE-SENS', pts, false);
    const along = (d: number): Pt => (d <= upLeg - dOd / 2 ? [tapX, dOd / 2 + d] : [tapX + (d - (upLeg - dOd / 2)), upLeg]);
    const mkCheck = (d: number, tag: string): Pt => {
      const p = along(d);
      const ang = d <= upLeg - dOd / 2 ? 90 : 0;
      const m = sk.m(p[0], p[1]);
      checkValve(b, m[0], m[1], ang, 150 * sk.f);
      b.circle('FP-VALV', m[0], m[1], 12 * sk.f); // 3/32" orifice marker (clapper)
      sk.reg(p[0] - 140, p[1] - 140, p[0] + 140, p[1] + 140);
      return [p[0], p[1] + (ang === 90 ? 0 : 0) + tag.length * 0];
    };
    const p1 = mkCheck(cv1, 'CV-1');
    const p2 = mkCheck(cv2, 'CV-2');
    // orifice enlarged inset
    const endX = tapX + (routeEnd - (upLeg - dOd / 2));
    // controller box at the end
    const cb = { x: endX, y: upLeg - 380, w: 520, h: 900 };
    sk.rect('FP-ELEC', cb.x, cb.y, cb.w, cb.h);
    sk.line('FP-ELEC', cb.x, cb.y, cb.x + cb.w, cb.y + cb.h);
    sk.reg(cb.x, cb.y, cb.x + cb.w, cb.y + cb.h);
    sk.text(cb.x + cb.w / 2, cb.y + cb.h + 100, 2.2, 'CONTROLLER', { align: 'center', vAlign: 'bottom' });
    // gauge + test valve on a tee before the controller
    const gx = endX - 330;
    sk.line('FP-PIPE-SENS', gx, upLeg, gx, upLeg + 380);
    const gm = sk.m(gx, upLeg + 470);
    pressureGauge(b, gm[0], gm[1], 0, 200 * sk.f);
    sk.reg(gx - 160, upLeg + 300, gx + 160, upLeg + 700);
    const tx = endX - 130;
    sk.line('FP-PIPE-SENS', tx, upLeg, tx, upLeg - 380);
    const tm = sk.m(tx, upLeg - 190);
    ballValve(b, tm[0], tm[1], 90, 150 * sk.f);
    sk.reg(tx - 130, upLeg - 420, tx + 130, upLeg - 90);
    // dims
    sk.dim(p1[0], p1[1], p2[0], p2[1], 8, String(sl?.checkValveSpacingMm ?? 1500));
    sk.dim(tapX, dOd / 2, tapX, upLeg, 14, String(Math.round(upLeg - dOd / 2)));
    P.setBounds({ x0: PX(c, x0 + 3), y0: PY(c, ROW2.y0 + 3), x1: PX(c, x0 + w - 3), y1: PY(c, ROW2.y0 + ROW2.h - 12) });
    sk.callout(tapX, dOd / 2 + 60, ['TAP BETWEEN DISCHARGE CHECK', 'VALVE AND ISOLATION VALVE'], [315, 0, 270]);
    sk.callout(p1[0], p1[1] + 40, ['CHECK VALVE 1', '3/32" ORIFICE IN CLAPPER'], [180, 135, 225]);
    sk.callout(p2[0], p2[1] + 140, ['CHECK VALVE 2', '3/32" ORIFICE IN CLAPPER'], [90, 45, 135]);
    sk.callout(gx, upLeg + 700, ['PRESSURE GAUGE'], [90, 45, 135]);
    sk.callout(tx, upLeg - 400, ['TEST CONNECTION', '(BALL VALVE)'], [270, 315, 225]);
    sk.callout(endX + 300, cb.y + 20, ['TO CONTROLLER PRESSURE', 'SWITCH / TRANSDUCER'], [270, 315, 225]);
    // enlarged orifice check valve inset
    const ix = x0 + 190;
    const iy = ROW2.y0 + 116;
    b.circle('FP-ANNO', PX(c, ix), PY(c, iy), 22 * s);
    const im = [PX(c, ix), PY(c, iy)];
    checkValve(b, im[0], im[1], 0, 26 * s);
    b.circle('FP-VALV', im[0] + 3.5 * s, im[1] + 2.5 * s, 1.0 * s);
    arrowLine(b, [im[0] + 3.5 * s, im[1] + 2.5 * s + 1 * s], [im[0] + 12 * s, im[1] + 12 * s], s);
    b.text('FP-ANNO', PX(c, ix + 12.5), PY(c, iy + 12.5), 2.2, '3/32" ORIFICE', { vAlign: 'middle' });
    b.text('FP-ANNO', PX(c, ix), PY(c, iy - 25), 2.4, 'ENLARGED CHECK VALVE (NTS)', { align: 'center', vAlign: 'middle' });
    P.addRect(PX(c, ix - 24), PY(c, iy - 28), 70 * s, 56 * s);
    const spec = [
      `SENSING LINE 1/2" ${sl?.material ?? 'BRASS / COPPER / SS 316'}`,
      'ONE LINE PER CONTROLLER (NFPA 20-2019 4.32)',
      'TWO CHECK VALVES >= 5 FT (1.5 M) APART'
    ];
    spec.forEach((ln, i) => P.text('FP-ANNO', PX(c, x0 + 6), PY(c, ROW2.y0 + 22 - i * 4.8), 2.2, ln, { vAlign: 'middle' }));
    void ballValve;
  }

  // ═════════════════════ 5. DRAINAGE SUMP PIT DETAIL (1:10) ═════════════════════
  {
    const x0 = 303;
    const w = 257;
    const bounds = panel(c, x0, ROW2.y0, w, ROW2.h, 5, 'DRAINAGE SUMP PIT DETAIL', 'SCALE 1:10');
    const P = new Placer(c, bounds);
    const pitW = ds.rect.w;
    const dep = ds.pitDepthMm;
    const wall = 150;
    // origin: pit inner floor-left corner; z up (0 = pit floor)
    const sk = new Sk(c, P, s / 10, PX(c, x0 + 48), PY(c, ROW2.y0 + 20));
    // slab: FFL at z = dep
    sk.conc(-wall, -wall, pitW + 2 * wall, wall); // pit floor slab
    sk.conc(-wall - 300, -wall, 300, dep + wall); // left wall + floor slab
    sk.conc(pitW + wall, -wall, 300, dep + wall + 0);
    sk.conc(-wall, 0, wall, dep);
    sk.conc(pitW, 0, wall, dep);
    // cover (grating / gas-tight)
    sk.rect('FP-TRCH', -wall, dep, pitW + 2 * wall, 30);
    sk.hatch(-wall, dep, pitW + 2 * wall, 30, 0.7);
    sk.line('FP-LEVL', -wall - 300, dep, pitW + wall + 300, dep);
    // trench inlet
    const dTr = Math.min(tr.depthEndMm, dep - 100);
    sk.rect('FP-TRCH', -wall - 300, dep - dTr, 300 + wall, dTr);
    sk.line('FP-TRCH', -wall - 300, dep - dTr, 0, dep - dTr);
    // float levels (left wall)
    const lv = ds.levels;
    const levels: [string, number][] = [['ALARM', lv.alarmMm], ['LAG ON', lv.lagOnMm], ['LEAD ON', lv.leadOnMm], ['OFF', lv.offMm]];
    for (const [lab, z] of levels) {
      sk.line('FP-WATR', 0, z, pitW, z);
      sk.circle('FP-ELEC', 110, z, 28);
      sk.line('FP-ELEC', 110, z + 28, 110, dep);
      void lab;
    }
    sk.reg(0, 0, pitW, dep);
    // sump pumps: duplex submersible
    const pumps = ds.pumps.length ? ds.pumps : [];
    const pw = 300;
    const ph = 460;
    const gap = pumps.length > 1 ? (pitW - 2 * pw - 2 * 260) / 1 : 0;
    pumps.forEach((p, i) => {
      const px = pumps.length > 1 ? 260 + i * (pw + gap) : pitW / 2 - pw / 2;
      sk.rect('FP-EQPM', px, 40, pw, ph);
      sk.circle('FP-EQPM', px + pw / 2, 40 + ph * 0.28, pw * 0.3);
      sk.line('FP-EQPM', px, 40 + ph * 0.58, px + pw, 40 + ph * 0.58);
      sk.line('FP-EQPM', px, 40, px + 60, 0);
      sk.line('FP-EQPM', px + pw, 40, px + pw - 60, 0);
      sk.text(px + pw / 2, 40 + ph * 0.8, 2.4, p.tag, { align: 'center' });
      // discharge pipe up through the cover, check + gate valve above FFL
      const dOd = odOf(ds.dischargeSizeIn);
      const dx = px + pw / 2 + (i % 2 ? 80 : -80);
      sk.pipe('FP-PIPE-DRAN', [[dx, 40 + ph], [dx, dep + 520], [pitW / 2 + (i ? 1 : -1) * 0 + 0, dep + 520]], dOd, false);
      const vm = (z: number): Pt => sk.m(dx, z);
      checkValve(b, vm(dep + 170)[0], vm(dep + 170)[1], 90, Math.max(dOd, 70) * 1.4 * sk.f);
      butterflyValve(b, vm(dep + 360)[0], vm(dep + 360)[1], 90, Math.max(dOd, 70) * 1.4 * sk.f);
      sk.reg(dx - 140, dep, dx + 140, dep + 560);
    });
    if (!pumps.length) {
      sk.pipe('FP-PIPE-DRAN', [[pitW - 60, 160], [pitW + wall + 300, 160]], odOf(ds.dischargeSizeIn), false);
      sk.text(pitW / 2, 400, 2.4, 'GRAVITY DRAIN (NO SUMP PUMPS)', { align: 'center' });
    } else {
      const dOd = odOf(ds.dischargeSizeIn);
      const lx = pumps.length > 1 ? pitW / 2 : pitW / 2;
      sk.pipe('FP-PIPE-DRAN', [[lx, dep + 520], [pitW + wall + 300, dep + 520]], dOd, false);
    }
    // dimensions: float levels chain (right), depth, width
    const xr = pitW + wall + 300;
    const marks = [0, lv.offMm, lv.leadOnMm, lv.lagOnMm, lv.alarmMm, dep];
    for (let i = 0; i + 1 < marks.length; i++) {
      if (marks[i + 1] > marks[i]) sk.dim(xr, marks[i], xr, marks[i + 1], -11, String(Math.round(marks[i + 1] - marks[i])));
    }
    sk.dim(xr, 0, xr, dep, -22, String(dep));
    sk.dim(0, 0, pitW, 0, -26, String(pitW));
    sk.dim(-wall - 300, dep - dTr, -wall - 300, dep, 8, String(dTr));
    // level labels
    levels.forEach(([lab, z]) => {
      sk.text(pitW + wall + 1100, z, 2.2, `${lab}  +${z}`, { align: 'left' });
    });
    P.setBounds({ x0: PX(c, x0 + 3), y0: PY(c, ROW2.y0 + 3), x1: PX(c, x0 + w - 3), y1: PY(c, ROW2.y0 + ROW2.h - 12) });
    sk.callout(pitW / 2, dep + 15, ['GAS-TIGHT COVER / GRATING', '(IPC 712)'], [90, 45, 135]);
    sk.callout(-wall - 150, dep - dTr / 2, ['TRENCH INLET'], [180, 135, 225]);
    sk.callout(pitW / 2, 10, [`PIT FLOOR (${pitW} x ${ds.rect.h} PLAN)`], [270, 315, 225]);
    const spec = [
      `${ds.tag}: ${ds.pumps.length ? ds.pumps.length + ' x SUBMERSIBLE PUMPS' : 'GRAVITY'}${ds.pumps[0] ? ` ${ds.pumps[0].flowGpm} GPM @ ${ds.pumps[0].headFt} FT` : ''}`,
      `DISCHARGE ${formatPipeSize(ds.dischargeSizeIn)} + CHECK + FULL-OPEN VALVE EACH`,
      'ALTERNATOR + HIGH-LEVEL ALARM TO FACP'
    ];
    spec.forEach((ln, i) => P.text('FP-ANNO', PX(c, x0 + 6), PY(c, ROW2.y0 + ROW2.h - 18 - i * 4.4), 2.2, ln, { vAlign: 'middle' }));
  }

  // ═════════════════════ 7. PUMP ROOM DETAIL NOTES ═════════════════════
  {
    const x0 = 563;
    const w = 265;
    panel(c, x0, ROW2.y0, w, ROW2.h, 7, 'PUMP ROOM DETAIL NOTES', 'NFPA 20 / 22, IPC, IBC');
    drawNotes(c, x0 + 3, ROW2.y0 + ROW2.h - 12, w - 6, 'GENERAL NOTES', pumpRoomDetailNotes(c), th);
  }
  void textWidth;
}

function wrapLines(sv: string, n: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const wd of sv.split(/\s+/)) {
    if (cur && (cur + ' ' + wd).length > n) {
      out.push(cur);
      cur = wd;
    } else cur = cur ? cur + ' ' + wd : wd;
  }
  if (cur) out.push(cur);
  return out;
}
