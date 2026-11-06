/**
 * FS-501 — sprinkler riser diagram (schematic, valve trim per system type in use, floor control assemblies,
 * FDC, main drain, inspector's tests), installation details at 1:10 (pendent / upright / dry-pendent, hanger,
 * floor control assembly, inspector's test), accessory schedule and spare sprinkler cabinet.
 */
import { DEFLECTOR_RANGE_MM, hangerSpacingM } from '../sprinkler/nfpa13Sprinkler'
import type { SprinklerSystemType } from '../sprinkler/sprinklerTypes'
import { ballValve, butterflyValve, checkValve, gateValve, pressureGauge } from './symbols'
import { type Ctx, FRAME, PX, PY, autoCols, drawTable, measureTable, wrapText } from './sheetKit'
import { SYSTEM_LABEL, headSymbol, sizeLabel } from './sprinklerSheetKit'

const f = (v: number, d = 1): string => v.toFixed(d)
const ORDER: SprinklerSystemType[] = [
  'wet',
  'dry',
  'preaction-single',
  'preaction-double',
  'deluge'
]

const TRIM: Record<SprinklerSystemType, (valve: string, extra: string) => string[]> = {
  wet: (v) => [
    v,
    'RETARD CHAMBER',
    'PRESSURE SWITCH (ALARM)',
    'WATER MOTOR GONG',
    'GAUGES ABOVE / BELOW VALVE',
    'DRAIN / TEST VALVE'
  ],
  dry: (v, x) => [
    v,
    x,
    'AIR MAINT. DEVICE / COMPRESSOR',
    'LOW-AIR SUPERVISORY SWITCH',
    'GAUGES (WATER / AIR)',
    'PRIMING WATER / DRAIN'
  ],
  'preaction-single': (v) => [
    v,
    'SOLENOID RELEASE VALVE',
    'RELEASING PANEL (NFPA 72)',
    'SMOKE / HEAT DETECTION',
    'SUPERVISORY AIR / LOW-AIR SW.',
    'GAUGES / DRAIN'
  ],
  'preaction-double': (v) => [
    v,
    'SOLENOID RELEASE VALVE',
    'RELEASING PANEL (NFPA 72)',
    'DETECTION + LOW-AIR INTERLOCK',
    'SUPERVISORY AIR / LOW-AIR SW.',
    'GAUGES / DRAIN'
  ],
  deluge: (v) => [
    v,
    'SOLENOID RELEASE VALVE',
    'RELEASING CONTROL PANEL (NFPA 72)',
    'HEAT / FLAME DETECTION',
    'MANUAL RELEASE STATION',
    'STRAINER / GAUGES / DRAIN'
  ]
}

export function drawRiserSheet(c: Ctx): void {
  const { b, sheet, r } = c
  const S = sheet.scale
  const spr = r.sprinklers!
  const sd = r.input.sprinklerDesign!
  const X = (v: number): number => PX(c, v)
  const Y = (v: number): number => PY(c, v)
  type Al = 'left' | 'center' | 'right'
  const T = (
    x: number,
    y: number,
    h: number,
    s: string,
    al: Al = 'left',
    layer = 'FS-ANNO',
    rot = 0
  ): void => b.text(layer, X(x), Y(y), h, s, { align: al, vAlign: 'middle', rotationDeg: rot })
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number): void =>
    b.line(layer, X(x1), Y(y1), X(x2), Y(y2))
  const accSize = (prefix: string, dflt: number): number =>
    spr.accessories.find((a) => a.item.startsWith(prefix))?.sizeIn ?? dflt

  // ───────────────────────── RISER DIAGRAM ─────────────────────────
  T(26, 540, 5, 'SPRINKLER RISER DIAGRAM')
  T(
    26,
    533,
    2.4,
    'NOT TO SCALE - SCHEMATIC. VALVE TRIM SHOWN FOR EVERY SYSTEM TYPE USED IN THE BUILDING.'
  )
  const floors = spr.floors
    .map((fd) => ({ fd, el: sd.floors.find((x) => x.id === fd.floorId)?.elevationM ?? 0 }))
    .sort((a, z) => a.el - z.el)
  const nF = floors.length
  const types = ORDER.filter((t) => floors.some((x) => x.fd.systemType === t))
  const nG = types.length
  const Yh = 62
  const Y0f = 215
  const pitch = nF > 1 ? Math.min(130, (505 - Y0f) / (nF - 1)) : 130
  const yFloor = (i: number): number => Y0f + i * pitch
  const xStart = 130
  const xEnd = 332
  const colX = types.map((_, g) => xStart + ((xEnd - xStart) * (g + 0.5)) / nG)
  const stub = Math.min(62, (xEnd - xStart) / nG - 6)
  const compact = pitch < 30
  const rb = sd.buildingRiserIn
  const trimTh = nG >= 4 ? 1.35 : nG === 3 ? 1.7 : 1.9

  // level lines
  floors.forEach((fl, i) => {
    line('FS-CNTR', 30, yFloor(i), xEnd + 4, yFloor(i))
    b.levelMark(X(70), Y(yFloor(i)), fl.el, fl.fd.floorName.toUpperCase())
  })

  // supply header, OS&Y valve, main drain, FDC
  const xLast = colX[nG - 1]
  line('FS-PIPE-MAIN', 28, Yh, xLast, Yh)
  T(28, Yh + 5, 2.1, 'WATER SUPPLY (FIRE PUMP / CITY MAIN)')
  T(64, Yh - 4.5, 2.1, `BUILDING RISER / FEED ${sizeLabel(rb)}`)
  gateValve(b, X(100), Y(Yh), 0, 4.5 * S)
  T(100, Yh + 9, 1.9, 'OS&Y GATE VALVE', 'center')
  T(100, Yh + 12, 1.9, '(SUPERVISED OPEN)', 'center')
  // main drain
  line('FS-PIPE-MAIN', 124, Yh, 124, Yh - 14)
  ballValve(b, X(124), Y(Yh - 6), 90, 3.5 * S)
  b.circle('FS-VALV', X(124), Y(Yh - 10.5), 1.2 * S)
  line('FS-PIPE-MAIN', 124, Yh - 14, 124, Yh - 20)
  b.solid('FS-PIPE-MAIN', [
    [X(124), Y(Yh - 22)],
    [X(124) - 0.9 * S, Y(Yh - 19)],
    [X(124) + 0.9 * S, Y(Yh - 19)]
  ])
  T(128, Yh - 10, 2.0, `MAIN DRAIN ${sizeLabel(accSize('Main drain', 2))} WITH SIGHT GLASS`)
  T(128, Yh - 14, 2.0, 'DISCHARGE TO DRAIN')
  // fire department connection
  line('FS-PIPE-MAIN', 58, Yh, 58, Yh - 12)
  checkValve(b, X(58), Y(Yh - 6), 90, 3.5 * S)
  line('FS-PIPE-MAIN', 58, Yh - 12, 58, Yh - 24)
  b.circle('FS-EQPM', X(55), Y(Yh - 27), 2.2 * S)
  b.circle('FS-EQPM', X(61), Y(Yh - 27), 2.2 * S)
  line('FS-PIPE-MAIN', 55, Yh - 24, 55, Yh - 25)
  line('FS-PIPE-MAIN', 61, Yh - 24, 61, Yh - 25)
  T(
    30,
    Yh - 33,
    2.0,
    `FIRE DEPARTMENT CONNECTION 2-WAY ${sizeLabel(accSize('Fire department', 2.5))}`
  )
  T(30, Yh - 37, 2.0, 'WITH CHECK VALVE AND BALL DRIP (SA-15)')

  const spareLine = (fd: (typeof floors)[number]['fd']): string => `${fd.floorName.toUpperCase()}`
  types.forEach((t, g) => {
    const xg = colX[g]
    const fl = floors.filter((x) => x.fd.systemType === t)
    const topI = Math.max(...fl.map((x) => floors.indexOf(x)))
    // riser
    line('FS-PIPE-MAIN', xg, Yh, xg, yFloor(topI))
    T(xg - 3, 172, 2.0, `RISER ${sizeLabel(rb)}`, 'center', 'FS-ANNO', 90)
    // valve trim
    const yv = Yh + 12
    const valveSize =
      t === 'wet'
        ? accSize('Alarm check', 6)
        : accSize(t === 'dry' ? 'Dry-pipe' : t === 'deluge' ? 'Deluge' : 'Preaction', 4)
    const valveName =
      t === 'wet'
        ? `ALARM CHECK VALVE ${sizeLabel(valveSize)}`
        : t === 'dry'
          ? `DRY-PIPE VALVE ${sizeLabel(valveSize)}`
          : t === 'deluge'
            ? `DELUGE VALVE ${sizeLabel(valveSize)}`
            : `PREACTION VALVE ${sizeLabel(valveSize)}`
    const dryVol = Math.max(0, ...fl.map((x) => x.fd.volumeGal))
    const accel =
      dryVol > 500
        ? `ACCELERATOR - REQUIRED (${f(dryVol, 0)} GAL)`
        : `ACCELERATOR - NOT REQD (${f(dryVol, 0)} GAL)`
    const rows = TRIM[t](valveName, accel)
    checkValve(b, X(xg), Y(yv), 90, 4.5 * S)
    const tag = t === 'wet' ? 'ACV' : t === 'dry' ? 'DPV' : t === 'deluge' ? 'DV' : 'PAV'
    b.rect('FS-VALV', X(xg) - 7 * S, Y(yv) - 1.4 * S, 4.4 * S, 2.8 * S)
    T(xg - 4.8, yv, 1.3, tag, 'center')
    rows.forEach((txt, k) => {
      const y = yv + k * 7.2
      if (k > 0) {
        line('FS-PIPE-BRANCH', xg, y, xg + 6, y)
        b.circle('FS-VALV', X(xg + 7.2), Y(y), 1.2 * S)
      }
      T(xg + 10, y, trimTh, txt)
    })
    const head = wrapText(`${SYSTEM_LABEL[t]} SYSTEM TRIM`, nG >= 4 ? 22 : 60)
    head.forEach((ln, k) => T(xg + 4, yv + 6 * 7.2 + 5 + k * 3.6, nG >= 4 ? 2.0 : 2.6, ln))
    wrapText(`FLOORS: ${fl.map((x) => spareLine(x.fd)).join(', ')}`, nG >= 4 ? 26 : 40).forEach(
      (ln, k) => T(xg + 4, yv + 6 * 7.2 + 5 + head.length * 3.6 + 3 + k * 3.0, trimTh, ln)
    )
    if (t === 'wet') {
      const yt = yFloor(topI) + 3
      line('FS-PIPE-MAIN', xg, yFloor(topI), xg, yt)
      b.circle('FS-VALV', X(xg), Y(yt + 1.6), 1.6 * S)
      T(xg - 3.5, yt + 1.6, 1.8, 'AUTOMATIC AIR VENT', 'right')
    }
    // floors
    fl.forEach((x) => {
      const i = floors.indexOf(x)
      const y = yFloor(i)
      const xe = xg + stub
      line('FS-PIPE-MAIN', xg, y, xe, y)
      butterflyValve(b, X(xg + 10), Y(y), 0, 4.2 * S)
      b.rect('FS-VALV', X(xg + 9), Y(y) + 3.4 * S, 2 * S, 1.2 * S)
      b.rect('FS-VALV', X(xg + 15.5), Y(y) + 0.6 * S, 3.4 * S, 2.2 * S)
      T(xg + 17.2, y + 1.7, 1.2, 'FS', 'center')
      pressureGauge(b, X(xg + 24), Y(y), 0, 3.4 * S)
      // test & drain
      line('FS-PIPE-MAIN', xg + 30, y, xg + 30, y - 9)
      ballValve(b, X(xg + 30), Y(y - 3.5), 90, 2.8 * S)
      b.circle('FS-VALV', X(xg + 30), Y(y - 6.5), 1 * S)
      b.solid('FS-PIPE-MAIN', [
        [X(xg + 30), Y(y - 11)],
        [X(xg + 30) - 0.8 * S, Y(y - 8.6)],
        [X(xg + 30) + 0.8 * S, Y(y - 8.6)]
      ])
      // break + inspector's test at the end
      line('FS-PIPE-MAIN', xg + 38, y - 1.6, xg + 39.4, y + 1.6)
      line('FS-PIPE-MAIN', xg + 40.4, y - 1.6, xg + 41.8, y + 1.6)
      line('FS-PIPE-BRANCH', xe - 6, y, xe, y)
      line('FS-PIPE-BRANCH', xe, y, xe, y - 9)
      ballValve(b, X(xe), Y(y - 3), 90, 2.4 * S)
      b.circle('FS-VALV', X(xe), Y(y - 6.2), 0.9 * S)
      b.solid('FS-PIPE-BRANCH', [
        [X(xe), Y(y - 11)],
        [X(xe) - 0.8 * S, Y(y - 8.6)],
        [X(xe) + 0.8 * S, Y(y - 8.6)]
      ])
      const nip = x.fd.pipes.find((p) => p.kind === 'riser-nipple')?.sizeIn ?? 2
      const sheetNo = `FS-1${String(spr.floors.indexOf(x.fd) + 1).padStart(2, '0')}`
      if (!compact || i === floors.findIndex((q) => q.fd.systemType === t)) {
        T(xg + 4, y + 8.5, 1.9, `FLOOR CONTROL ASSEMBLY ${sizeLabel(nip)}`)
        T(xg + 4, y + 11.5, 1.9, `${x.fd.floorName.toUpperCase()} - ${sheetNo}`)
        T(xg + 32, y - 9, 1.7, 'TEST & DRAIN')
        T(xg + 38, y - 14, 1.7, "INSPECTOR'S TEST")
      } else T(xg + 4, y + 8, 1.7, `FCA ${sizeLabel(nip)} - ${x.fd.floorName.toUpperCase()}`)
    })
  })

  // ───────────────────────── DETAILS (1:10) ─────────────────────────
  const material = sd.answers.pipeMaterial
  const minK = Math.min(...spr.headTypes.map((h) => h.kFactor), 5.6)
  const cells = [
    { x0: 347, y0: 380, title: '1  PENDENT SPRINKLER INSTALLATION' },
    { x0: 508, y0: 380, title: '2  UPRIGHT SPRINKLER INSTALLATION' },
    { x0: 669, y0: 380, title: '3  DRY-PENDENT SPRINKLER INSTALLATION' },
    { x0: 347, y0: 215, title: '4  PIPE HANGER' },
    { x0: 508, y0: 215, title: '5  FLOOR CONTROL ASSEMBLY (NTS)' },
    { x0: 669, y0: 215, title: "6  INSPECTOR'S TEST CONNECTION (NTS)" }
  ]
  const CW = 158
  const CH = 162
  const lo = DEFLECTOR_RANGE_MM[0]
  const hi = DEFLECTOR_RANGE_MM[1]
  // Returns a bundle of local drawing helpers for one detail cell (its type is inferred and reused via ReturnType).
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const cell = (n: number) => {
    const cl = cells[n]
    b.rect('FS-LEGEND', X(cl.x0), Y(cl.y0), CW * S, CH * S)
    T(cl.x0 + 3, cl.y0 + CH - 4.5, 2.8, cl.title)
    T(cl.x0 + CW - 3, cl.y0 + CH - 4.5, 2.0, n === 4 || n === 5 ? 'NTS' : 'SCALE 1:10', 'right')
    line('FS-LEGEND', cl.x0, cl.y0 + CH - 9, cl.x0 + CW, cl.y0 + CH - 9)
    const ox = X(cl.x0 + 4)
    const oy = Y(cl.y0 + 4)
    const L = (layer: string, x1: number, y1: number, x2: number, y2: number): void =>
      b.line(layer, ox + x1, oy + y1, ox + x2, oy + y2)
    const R = (layer: string, x: number, y: number, w: number, h: number): void =>
      b.rect(layer, ox + x, oy + y, w, h)
    const Cc = (layer: string, x: number, y: number, rr: number): void =>
      b.circle(layer, ox + x, oy + y, rr)
    const Pl = (layer: string, pts: [number, number][], closed = false): void =>
      b.polyline(
        layer,
        pts.map(([x, y]) => [ox + x, oy + y] as [number, number]),
        closed
      )
    const D = (x: number, y: number, h: number, s: string, al: Al = 'left'): void =>
      b.text('FS-ANNO', ox + x, oy + y, h, s, { align: al, vAlign: 'middle' })
    const LD = (x1: number, y1: number, x2: number, y2: number, s: string): void => {
      L('FS-ANNO', x1, y1, x2, y2)
      const len = Math.hypot(x2 - x1, y2 - y1) || 1
      const ux = (x2 - x1) / len
      const uy = (y2 - y1) / len
      b.solid('FS-ANNO', [
        [ox + x1, oy + y1],
        [ox + x1 + ux * 28 - uy * 8, oy + y1 + uy * 28 + ux * 8],
        [ox + x1 + ux * 28 + uy * 8, oy + y1 + uy * 28 - ux * 8]
      ])
      D(x2 + (x2 >= x1 ? 10 : -10), y2, 2.0, s, x2 >= x1 ? 'left' : 'right')
    }
    const pipeH = (layer: string, x1: number, x2: number, y: number, od: number): void => {
      L(layer, x1, y + od / 2, x2, y + od / 2)
      L(layer, x1, y - od / 2, x2, y - od / 2)
    }
    const hatch = (x: number, y: number, w: number, h: number): void => {
      R('FS-WALL', x, y, w, h)
      b.hatchRect(ox + x, oy + y, w, h, 0.9)
    }
    const dimV = (x: number, y1: number, y2: number, off: number, txt: string): void =>
      b.dimLinear(ox + x, oy + y1, ox + x, oy + y2, off, txt)
    return { L, R, Cc, Pl, D, LD, pipeH, hatch, dimV, ox, oy }
  }
  const band = (
    k: ReturnType<typeof cell>,
    yC: number,
    dir: 1 | -1,
    x0: number,
    x1: number
  ): void => {
    // allowed deflector zone 25 - 305 mm from the ceiling / deck
    k.L('FS-HIDN', x0, yC - dir * lo, x1, yC - dir * lo)
    k.L('FS-HIDN', x0, yC - dir * hi, x1, yC - dir * hi)
    k.D(x1 + 12, yC - dir * lo, 1.9, `${lo} MM MIN.`)
    k.D(x1 + 12, yC - dir * hi, 1.9, `${hi} MM MAX.`)
  }

  {
    // 1 pendent
    const k = cell(0)
    const yC = 600
    const xh = 650
    k.hatch(50, 1180, 1300, 40)
    k.L('FS-WALL', 50, yC, xh - 55, yC)
    k.L('FS-WALL', xh + 55, yC, 1350, yC)
    k.L('FS-WALL', 50, yC + 20, xh - 55, yC + 20)
    k.L('FS-WALL', xh + 55, yC + 20, 1350, yC + 20)
    k.pipeH('FS-PIPE-BRANCH', 50, 1350, 900, 33.4)
    k.R('FS-VALV', xh - 28, 870, 56, 60)
    k.L('FS-HANG', 250, 1180, 250, 960)
    k.L('FS-HANG', 262, 1180, 262, 960)
    k.R('FS-HANG', 225, 870, 62, 100)
    k.L('FS-PIPE-BRANCH', xh - 10.7, 870, xh - 10.7, 660)
    k.L('FS-PIPE-BRANCH', xh + 10.7, 870, xh + 10.7, 660)
    k.R('FS-EQPM', xh - 38, yC, 76, 24)
    k.R('FS-HEAD', xh - 14, 560, 28, 100)
    const yD = yC - 100
    k.L('FS-HEAD', xh - 14, 560, xh - 6, yD + 8)
    k.L('FS-HEAD', xh + 14, 560, xh + 6, yD + 8)
    k.L('FS-HEAD', xh - 26, yD, xh + 26, yD)
    k.L('FS-HEAD', xh, yD, xh, yD + 40)
    k.dimV(xh + 110, yC, yD, 6, `${lo}-${hi} MM`)
    band(k, yC, 1, xh + 250, xh + 450)
    k.LD(250, 1050, 450, 1100, 'HANGER (CLEVIS + ROD)')
    k.LD(1150, 900, 1150, 980, 'BRANCH LINE')
    k.LD(xh + 30, 880, 900, 1060, 'TEE / REDUCING FITTING')
    k.LD(xh + 20, 700, xh + 250, 760, 'NIPPLE')
    k.LD(1300, yC + 10, 1150, 700, 'FINISHED CEILING')
    k.LD(xh - 34, yC + 14, xh - 300, 740, 'ESCUTCHEON')
    k.LD(xh - 20, yD - 4, xh - 300, 380, 'DEFLECTOR (PENDENT)')
    k.LD(900, 1200, 1000, 1280, 'STRUCTURE')
  }
  {
    // 2 upright
    const k = cell(1)
    const yC = 1180
    const xh = 650
    k.hatch(50, yC, 1300, 40)
    k.pipeH('FS-PIPE-BRANCH', 50, 1350, 780, 33.4)
    k.R('FS-VALV', xh - 28, 750, 56, 60)
    k.L('FS-HANG', 250, yC, 250, 840)
    k.L('FS-HANG', 262, yC, 262, 840)
    k.R('FS-HANG', 225, 750, 62, 100)
    k.L('FS-PIPE-BRANCH', xh - 10.7, 810, xh - 10.7, 860)
    k.L('FS-PIPE-BRANCH', xh + 10.7, 810, xh + 10.7, 860)
    k.R('FS-HEAD', xh - 14, 860, 28, 40)
    const yD = yC - 100
    k.L('FS-HEAD', xh - 14, 900, xh - 8, yD - 8)
    k.L('FS-HEAD', xh + 14, 900, xh + 8, yD - 8)
    k.L('FS-HEAD', xh - 28, yD, xh + 28, yD)
    k.L('FS-HEAD', xh - 8, yD - 8, xh + 8, yD - 8)
    k.dimV(xh + 110, yC, yD, 6, `${lo}-${hi} MM`)
    band(k, yC, 1, xh + 250, xh + 450)
    k.LD(250, 960, 450, 1000, 'HANGER (CLEVIS + ROD)')
    k.LD(1100, 780, 1150, 640, 'BRANCH LINE')
    k.LD(xh + 30, 770, xh + 200, 560, 'TEE (SPRINKLER ON TOP)')
    k.LD(xh + 28, yD, xh + 300, 1060, 'DEFLECTOR (UPRIGHT)')
    k.LD(1100, yC + 20, 1000, 1280, 'STRUCTURE / ROOF DECK')
    k.D(60, 380, 2.0, 'UPRIGHT SPRINKLERS FOR EXPOSED STRUCTURE;')
    k.D(60, 340, 2.0, 'KEEP BRANCH LINE CLEAR OF THE DEFLECTOR ZONE.')
  }
  {
    // 3 dry-pendent
    const k = cell(2)
    const yC = 600
    const xh = 650
    k.hatch(50, yC, 1300, 70)
    k.L('FS-HIDN', 50, yC + 160, 1350, yC + 160)
    k.D(60, 1220, 2.0, 'HEATED SPACE (ABOVE 4 C) - WET PIPING')
    k.D(60, 420, 2.0, 'FREEZING AREA (BELOW 4 C)')
    k.pipeH('FS-PIPE-BRANCH', 50, 1350, 1000, 33.4)
    k.R('FS-VALV', xh - 28, 970, 56, 60)
    k.L('FS-PIPE-BRANCH', xh - 16, 970, xh - 16, 560)
    k.L('FS-PIPE-BRANCH', xh + 16, 970, xh + 16, 560)
    k.L('FS-HIDN', xh - 50, yC + 160, xh - 50, yC - 20)
    k.L('FS-HIDN', xh + 50, yC + 160, xh + 50, yC - 20)
    k.Cc('FS-VALV', xh, 930, 20)
    k.R('FS-HEAD', xh - 14, 520, 28, 40)
    const yD = yC - 100
    k.L('FS-HEAD', xh - 14, 520, xh - 6, yD + 8)
    k.L('FS-HEAD', xh + 14, 520, xh + 6, yD + 8)
    k.L('FS-HEAD', xh - 26, yD, xh + 26, yD)
    k.dimV(xh + 130, yC, yD, 6, `${lo}-${hi} MM`)
    band(k, yC, 1, xh + 250, xh + 450)
    k.LD(1100, 1000, 1000, 1100, 'WET BRANCH LINE')
    k.LD(xh + 20, 930, xh + 250, 880, 'WATER SEAL AT INLET END')
    k.LD(xh + 16, 760, xh + 250, 780, 'DRY BARREL (INSULATED)')
    k.LD(1100, yC + 30, 1000, 330, 'INSULATED CEILING / ENVELOPE')
    k.LD(xh - 20, yD, xh - 250, 300, 'DEFLECTOR (DRY-PENDENT)')
  }
  {
    // 4 hanger
    const k = cell(3)
    const xp = 450
    k.R('FS-WALL', xp - 75, 1180, 150, 16)
    k.R('FS-WALL', xp - 4, 1010, 8, 170)
    k.R('FS-WALL', xp - 75, 994, 150, 16)
    k.R('FS-HANG', xp - 35, 1196, 70, 30)
    k.L('FS-HANG', xp - 5, 1196, xp - 5, 760)
    k.L('FS-HANG', xp + 5, 1196, xp + 5, 760)
    k.Cc('FS-PIPE-BRANCH', xp, 700, 30)
    k.L('FS-HANG', xp - 42, 760, xp + 42, 760)
    k.L('FS-HANG', xp - 42, 700, xp - 42, 760)
    k.L('FS-HANG', xp + 42, 700, xp + 42, 760)
    b.arc('FS-HANG', k.ox + xp, k.oy + 700, 42, 180, 360)
    k.LD(xp + 76, 1200, xp + 330, 1250, 'BEAM CLAMP')
    k.LD(xp + 76, 1090, xp + 330, 1120, 'STRUCTURAL STEEL')
    k.LD(xp + 5, 900, xp + 330, 960, 'THREADED ROD')
    k.LD(xp + 42, 740, xp + 330, 760, 'CLEVIS HANGER')
    k.LD(xp + 30, 690, xp + 330, 640, 'SPRINKLER PIPE (END VIEW)')
    const s1 = hangerSpacingM(1, material)
    const s2 = hangerSpacingM(2, material)
    k.D(60, 470, 2.1, 'MAXIMUM HANGER SPACING (NFPA 13-2019 TABLE 17.4.2.1(a)):')
    k.D(60, 420, 2.1, `  1" PIPE ${f(s1, 2)} M;  1-1/4" AND LARGER ${f(s2, 2)} M`)
    k.D(60, 360, 2.1, 'LISTED ROD, CLEVIS AND BEAM CLAMP; SIZES PER NFPA 13-2019 CH. 17.')
    k.D(60, 310, 2.1, 'HANGER NOT MORE THAN 0.9 M FROM THE END OF A BRANCH LINE')
    k.D(60, 260, 2.1, 'AND AT EACH CHANGE OF DIRECTION ON MAINS.')
    if (sd.answers.seismic)
      k.D(60, 200, 2.1, 'SEISMIC SWAY BRACING AND RESTRAINT PER NFPA 13-2019 CH. 18.')
  }
  {
    // 5 floor control assembly
    const k = cell(4)
    const yh = 700
    const xr = 230
    const nip = spr.floors[0]?.pipes.find((p) => p.kind === 'riser-nipple')?.sizeIn ?? 3
    k.pipeH('FS-PIPE-RISER', xr, 1400, yh, 89)
    k.L('FS-PIPE-RISER', xr - 44, 60, xr - 44, yh + 44)
    k.L('FS-PIPE-RISER', xr + 44, 60, xr + 44, yh - 44)
    k.L('FS-PIPE-RISER', xr - 44, yh + 44, xr, yh + 44)
    k.D(xr, 30, 2.0, 'FROM SYSTEM RISER', 'center')
    butterflyValve(b, k.ox + 520, k.oy + yh, 0, 220)
    k.R('FS-VALV', 485, yh + 200, 70, 50)
    k.D(520, yh + 275, 1.9, 'TS', 'center')
    k.R('FS-VALV', 740, yh + 44, 60, 60)
    k.D(770, yh + 74, 1.6, 'FS', 'center')
    pressureGauge(b, k.ox + 980, k.oy + yh + 44, 0, 130)
    k.L('FS-PIPE-RISER', 1160, yh - 44, 1160, 300)
    k.L('FS-PIPE-RISER', 1250, yh - 44, 1250, 300)
    ballValve(b, k.ox + 1205, k.oy + 580, 90, 130)
    k.Cc('FS-VALV', 1205, 440, 40)
    b.solid('FS-PIPE-RISER', [
      [k.ox + 1205, k.oy + 240],
      [k.ox + 1170, k.oy + 320],
      [k.ox + 1240, k.oy + 320]
    ])
    k.LD(520, yh + 140, 600, 1120, `SUPERVISED BUTTERFLY / OS&Y VALVE ${sizeLabel(nip)}`)
    k.D(610, 1070, 1.9, 'WITH TAMPER SWITCH (TS)')
    k.LD(770, yh + 110, 900, 960, 'WATERFLOW SWITCH (FS)')
    k.LD(1000, 860, 1150, 880, 'PRESSURE GAUGE')
    k.LD(1170, 440, 1090, 480, 'SIGHT GLASS')
    k.LD(1170, 580, 1090, 600, 'TEST & DRAIN VALVE')
    k.LD(1205, 250, 1100, 200, 'TO DRAIN')
    k.D(330, 300, 2.0, 'NFPA 13-2019 SEC. 16.9.1, 16.9.3, 16.13')
    k.D(330, 120, 2.0, 'FLOW')
    k.L('FS-ANNO', 420, 120, 620, 120)
    b.solid('FS-ANNO', [
      [k.ox + 640, k.oy + 120],
      [k.ox + 600, k.oy + 135],
      [k.ox + 600, k.oy + 105]
    ])
  }
  {
    // 6 inspector's test
    const k = cell(5)
    const xv = 700
    k.pipeH('FS-PIPE-BRANCH', 60, xv, 1050, 33.4)
    k.L('FS-PIPE-BRANCH', xv - 16.7, 1033, xv - 16.7, 300)
    k.L('FS-PIPE-BRANCH', xv + 16.7, 1033, xv + 16.7, 300)
    k.D(60, 1100, 2.0, 'END OF BRANCH LINE (HYDRAULICALLY MOST REMOTE)')
    ballValve(b, k.ox + xv, k.oy + 850, 90, 110)
    k.Cc('FS-VALV', xv, 700, 32)
    k.R('FS-VALV', xv - 40, 480, 80, 60)
    k.L('FS-VALV', xv - 40, 510, xv + 40, 510)
    k.L('FS-PIPE-BRANCH', xv - 16.7, 300, 1250, 300)
    k.L('FS-PIPE-BRANCH', xv + 16.7, 330, 1250, 330)
    k.hatch(1000, 150, 80, 330)
    b.solid('FS-PIPE-BRANCH', [
      [k.ox + 1330, k.oy + 315],
      [k.ox + 1250, k.oy + 345],
      [k.ox + 1250, k.oy + 285]
    ])
    k.LD(xv, 880, 960, 960, 'TEST VALVE 1" (QUARTER-TURN)')
    k.LD(xv + 32, 700, 960, 760, 'SIGHT GLASS')
    k.LD(xv + 40, 510, 900, 640, `ORIFICE K${minK} (= SMALLEST K)`)
    k.LD(1040, 420, 1110, 420, 'EXTERIOR WALL')
    k.LD(1330, 285, 1200, 100, 'DISCHARGE TO SAFE VISIBLE LOCATION')
    k.D(60, 200, 2.0, 'NFPA 13-2019 SEC. 16.14.2 - 1" MIN. TEST')
    k.D(60, 160, 2.0, 'CONNECTION; ORIFICE GIVES THE FLOW OF ONE HEAD.')
  }

  // ───────────────────────── accessory schedule ─────────────────────────
  const acc: string[][] = [['TAG', 'ITEM', 'QTY', 'SIZE', 'LOCATION', 'REFERENCE']]
  for (const a of spr.accessories)
    acc.push([
      a.tag,
      wrapText(a.item, 64).join('\n'),
      String(a.qty),
      a.sizeIn ? sizeLabel(a.sizeIn) : '-',
      wrapText(a.location, 30).join('\n'),
      wrapText(a.reference, 28).join('\n')
    ])
  let ath = 2.1
  const accH = (t: number, cols: number[]): number =>
    measureTable(cols, acc, { th: t, title: 'x' }).h
  let acols = autoCols(acc, ath)
  while (
    ath > 1.2 &&
    (accH(ath, acols) > 208 - 16 || measureTable(acols, acc, { th: ath }).w > 650 - 347)
  ) {
    ath -= 0.1
    acols = autoCols(acc, ath)
  }
  drawTable(c, 347, 208, acols, acc, {
    th: ath,
    title: 'ACCESSORY SCHEDULE',
    alignRight: [false, false, true, false, false, false]
  })

  // ───────────────────────── spare sprinkler cabinet ─────────────────────────
  {
    const x0 = 656
    const yT = 208
    const w = FRAME.x1 - 2 - x0
    const h = yT - 76
    b.rect('FS-LEGEND', X(x0), Y(yT - h), w * S, h * S)
    T(x0 + 3, yT - 4.5, 2.8, 'SPARE SPRINKLER CABINET (SA-16)')
    line('FS-LEGEND', x0, yT - 9, x0 + w, yT - 9)
    // cabinet elevation 1:10 (real 360 x 500 mm)
    const cx = X(x0 + 6)
    const cy = Y(yT - 12 - 52)
    b.rect('FS-EQPM', cx, cy, 360, 500)
    b.rect('FS-EQPM', cx + 20, cy + 20, 320, 460)
    for (const yy of [170, 330]) b.line('FS-EQPM', cx + 20, cy + yy, cx + 340, cy + yy)
    spr.headTypes.slice(0, 6).forEach((t, i) => {
      const row = Math.floor(i / 2)
      headSymbol(b, cx + 100 + (i % 2) * 150, cy + 60 + row * 160, 28, t)
    })
    b.text('FS-ANNO', cx + 180, cy + 520, 2.0, 'SPARE HEADS + WRENCH', {
      align: 'center',
      vAlign: 'bottom'
    })
    const total = spr.spareHeads.reduce((a, v) => a + v.qty, 0)
    const rows: string[][] = [['SPARE HEAD TYPE', 'QTY']]
    for (const sp of spr.spareHeads) rows.push([sp.headTypeId, String(sp.qty)])
    rows.push(['SPRINKLER WRENCH (EACH TYPE)', '1'])
    rows.push(['TOTAL SPARE HEADS', String(total)])
    const tcols = autoCols(rows, 2.0)
    drawTable(c, x0 + 46, yT - 12, tcols, rows, { th: 2.0, alignRight: [false, true] })
    const notes = wrapText(
      'CABINET IN THE SPRINKLER VALVE ROOM, TEMPERATURE NOT ABOVE 38 C (100 F), WITH A SPRINKLER WRENCH FOR EACH TYPE; REPLACE SPARES USED (NFPA 13-2019 SEC. 16.2.7).',
      56
    )
    notes.forEach((ln, k) => T(x0 + 46, yT - 12 - (rows.length * 6 + 8) - k * 3.4, 1.9, ln))
  }
}
