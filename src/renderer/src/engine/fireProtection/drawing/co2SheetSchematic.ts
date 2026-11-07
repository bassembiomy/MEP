/**
 * CO-501 — CO2 system schematic (cylinder banks main + reserve, flexible hoses, check valves, manifold & safety relief,
 * odorizer, lockout valve, pressure switch, distribution header with selector valves and time delays to every
 * enclosure), control & detection matrix, installation details and the NFPA 12 warning-sign wording.
 */
import { CO2_SIGNS, co2SafetyPoints } from '../co2/co2Signs'
import { CO2_PRELIMINARY_NOTE } from '../co2/nfpa12'
import type { Co2EnclosureResult } from '../co2/co2Types'
import { deviceSymbol, f0, fitTable, fx, lbKg, nozzleSymbol } from './co2SheetKit'
import { type Ctx, PX, PY, drawNotes, notesHeight, sheetTitle, textWidth, wrapText } from './sheetKit'
import { sizeLabel } from './sprinklerSheetKit'
import { checkValve, flexibleCoupling, reliefValve } from './symbols'

type Al = 'left' | 'center' | 'right'

export function drawCo2SchematicSheet(c: Ctx): void {
  const { b, sheet, r } = c
  const S = sheet.scale
  const co2 = r.co2!
  const cd = r.input.co2Design!
  const a = cd.answers
  const st = co2.storage
  const hp = st.storage === 'high-pressure'
  const X = (v: number): number => PX(c, v)
  const Y = (v: number): number => PY(c, v)
  const T = (x: number, y: number, h: number, s: string, al: Al = 'left', layer = 'FP-ANNO', rot = 0): void =>
    b.text(layer, X(x), Y(y), h, s, { align: al, vAlign: 'middle', rotationDeg: rot })
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number): void =>
    b.line(layer, X(x1), Y(y1), X(x2), Y(y2))
  const rect = (layer: string, x: number, y: number, w: number, h: number): void =>
    b.rect(layer, X(x), Y(y), w * S, h * S)
  const lines = (x: number, y: number, h: number, ls: string[], al: Al = 'left', pitch = 1.45): void =>
    ls.forEach((t, i) => T(x, y - i * h * pitch, h, t, al))
  const dev = (kind: Parameters<typeof deviceSymbol>[1], x: number, y: number, rp = 3): void =>
    deviceSymbol(b, kind, X(x), Y(y), rp * S)

  sheetTitle(
    c,
    26,
    574,
    'CO2 SYSTEM SCHEMATIC & DETAILS',
    'NFPA 12-2022 - NOT TO SCALE - TOTAL FLOODING, ' + (hp ? 'HIGH-PRESSURE CYLINDERS' : 'LOW-PRESSURE TANK') + ' - MAIN' + (st.reserveLb > 0 ? ' + RESERVE' : ' ONLY')
  )

  // ───────────────────────── control & detection (top left) ─────────────────────────
  rect('FP-ANNO', 28, 498, 100, 50)
  rect('FP-ANNO', 30, 500, 96, 46)
  T(78, 538, 2.4, 'CO2 RELEASING', 'center')
  T(78, 533, 2.4, 'CONTROL PANEL', 'center')
  T(78, 527, 1.9, '(NFPA 72)', 'center')
  T(78, 519, 1.8, `TIME DELAY ${a.timeDelayS} S`, 'center')
  T(78, 514, 1.8, 'SUPERVISES LOCKOUT VALVE', 'center')
  T(78, 509, 1.8, '& PRESSURE SWITCH', 'center')
  dev('control-panel', 38, 505, 2.2)
  const ctlItems: [Parameters<typeof deviceSymbol>[1], string][] = [
    [a.detection === 'heat' ? 'heat-detector' : 'smoke-detector', a.detection === 'heat' ? 'HEAT DETECTORS' : 'SMOKE DETECTORS A / B'],
    ['horn-strobe', 'HORN / STROBE INSIDE'],
    ['strobe-outside', 'STROBE OUTSIDE ENTRANCE'],
    ['manual-release', 'MANUAL RELEASE STATION']
  ]
  line('CO2-CTRL', 128, 523, 140, 523)
  line('CO2-CTRL', 140, 551, 140, 506)
  ctlItems.forEach(([k, t], i) => {
    const y = 551 - i * 14
    line('CO2-CTRL', 140, y, 152, y)
    dev(k, 158, y, 2.3)
    T(167, y, 1.9, t)
  })
  T(140, 556, 1.8, 'SIGNAL / CONTROL CIRCUITS (NFPA 72)', 'left')

  // ───────────────────────── storage ─────────────────────────
  const cylinder = (x: number, yHead: number): void => {
    // valve neck, body, flexible hose, check valve and the manifold stub above
    line('CO2-STORAGE', x, yHead, x, yHead - 3)
    rect('CO2-STORAGE', x - 3.5, yHead - 29, 7, 26)
    b.arc('CO2-STORAGE', X(x), Y(yHead - 3), 3.5 * S, 0, 180)
    line('CO2-PIPE', x, yHead, x, yHead + 5)
    flexibleCoupling(b, X(x), Y(yHead + 6.5), 90, 4.6 * S)
    line('CO2-PIPE', x, yHead + 8, x, yHead + 11.5)
    checkValve(b, X(x), Y(yHead + 14), 90, 5 * S)
    line('CO2-PIPE', x, yHead + 16, x, yHead + 20)
  }
  const nShow = 4
  const xs = Array.from({ length: nShow }, (_, i) => 44 + i * 22)
  const bank = (yMan: number, label: string, count: number, lb: number, reserve: boolean): void => {
    const yHead = yMan - 20
    line('CO2-PIPE', 36, yMan, 150, yMan)
    xs.forEach((x) => cylinder(x, yHead))
    // break marks between the 3rd and 4th cylinder show that the bank continues
    const bx = (xs[2] + xs[3]) / 2
    line('FP-ANNO', bx - 1, yMan - 2.5, bx + 1.5, yMan + 2.5)
    line('FP-ANNO', bx + 2.5, yMan - 2.5, bx + 5, yMan + 2.5)
    T(36, yMan + 4, 1.9, reserve ? 'DISCHARGE MANIFOLD - RESERVE' : 'DISCHARGE MANIFOLD - MAIN')
    T(36, yHead - 36, 2.1, label)
    T(36, yHead - 40.5, 1.9, `${count} CYLINDERS x ${f0(st.cylinderLb)} LB = ${lbKg(lb)}`)
    T(36, yHead - 45, 1.7, 'FLEXIBLE DISCHARGE HOSE, CHECK VALVE AT EACH CYLINDER')
  }
  if (hp) {
    bank(470, 'MAIN CYLINDER BANK', st.mainCylinders, st.mainCylinders * st.cylinderLb, false)
    line('CO2-CTRL', 30, 451, 112, 451)
    T(116, 451, 1.7, 'PILOT ACTUATION')
    if (st.reserveCylinders > 0) bank(380, 'RESERVE CYLINDER BANK', st.reserveCylinders, st.reserveCylinders * st.cylinderLb, true)
    else {
      line('CO2-PIPE', 150, 380, 150, 380)
      T(36, 380, 2.1, 'RESERVE SUPPLY: NOT PROVIDED')
    }
  } else {
    // low-pressure refrigerated tank
    rect('CO2-STORAGE', 36, 410, 90, 30)
    b.arc('CO2-STORAGE', X(36), Y(425), 15 * S, 90, 270)
    b.arc('CO2-STORAGE', X(126), Y(425), 15 * S, 270, 90)
    T(81, 428, 2.4, 'LOW-PRESSURE CO2 TANK', 'center')
    T(81, 422, 2.1, `${st.tankTons ?? 0} TON = ${lbKg(st.installedLb)}`, 'center')
    T(81, 416, 1.9, st.reserveLb > 0 ? 'MAIN + RESERVE IN ONE TANK' : 'MAIN SUPPLY', 'center')
    rect('CO2-EQPM', 60, 452, 42, 12)
    T(81, 458, 1.9, 'REFRIGERATION UNIT', 'center')
    line('CO2-PIPE', 81, 440, 81, 452)
    line('CO2-PIPE', 141, 425, 160, 425)
    flexibleCoupling(b, X(145), Y(425), 0, 3.2 * S)
    checkValve(b, X(152), Y(425), 0, 3.6 * S)
    T(139, 433, 1.8, 'FLEXIBLE HOSE')
    T(139, 417, 1.8, 'CHECK VALVE')
    line('CO2-PIPE', 150, 470, 150, 380)
    T(36, 395, 2.1, 'RESERVE: ' + (st.reserveLb > 0 ? `${lbKg(st.reserveLb)} IN THE SAME TANK` : 'NOT PROVIDED'))
    T(36, 389, 1.7, 'LEVEL / PRESSURE GAUGE + LOW-LEVEL SUPERVISION')
  }
  // collector + safety relief + take-off
  if (hp) line('CO2-PIPE', 150, 470, 150, 380)
  reliefValve(b, X(128), Y(470), 90, 5.5 * S)
  T(136, 482, 1.8, 'MANIFOLD SAFETY RELIEF')
  T(154, 442, 1.8, 'MAIN / RESERVE')
  T(154, 438, 1.8, 'TRANSFER SWITCH')
  rect('CO2-EQPM', 147, 421, 6, 8)

  // discharge pipe: lockout valve, odorizer, pressure switch
  for (const [xa, xb] of [[150, 212], [238, 300]]) line('CO2-PIPE', xa, 425, xb, 425)
  if (!a.odorizer) line('CO2-PIPE', 212, 425, 238, 425)
  else line('CO2-PIPE', 238, 425, 238, 425)
  dev('lockout-valve', 188, 425, 3)
  T(188, 412, 1.9, 'LOCKOUT VALVE', 'center')
  T(188, 406, 1.7, '(SUPERVISED)', 'center')
  if (a.odorizer) {
    rect('CO2-EQPM', 212, 421, 26, 8)
    T(225, 425, 1.9, 'ODORIZER', 'center')
  } else {
    T(225, 429, 1.7, 'ODORIZER - NOT SELECTED', 'center')
  }
  line('CO2-PIPE', 266, 425, 266, 434)
  dev('pressure-switch', 266, 439, 2.6)
  T(266, 410, 1.9, 'PRESSURE SWITCH', 'center')
  T(266, 406, 1.7, '(DISCHARGE SIGNAL)', 'center')
  line('CO2-CTRL', 78, 498, 78, 492)
  line('CO2-CTRL', 78, 492, 62, 492)

  // ───────────────────────── distribution to the enclosures ─────────────────────────
  const encs: { fid: string; e: Co2EnclosureResult; main: number; sch: string }[] = []
  for (const f of co2.floors)
    for (const e of f.enclosures) {
      const mp = f.pipes.find((p) => p.enclosureId === e.enclosureId && p.kind === 'main')
      encs.push({ fid: f.floorId, e, main: mp?.sizeIn ?? 1, sch: mp?.schedule === 'sch80' ? '80' : '40' })
    }
  const maxRows = 8
  const shown = encs.length > maxRows ? encs.slice(0, maxRows - 1) : encs
  const nRows = shown.length + (encs.length > maxRows ? 1 : 0)
  const pitch = Math.min(46, 225 / Math.max(1, nRows))
  const y0 = 520
  const yLast = y0 - (nRows - 1) * pitch
  const multi = encs.length > 1
  line('CO2-PIPE', 300, Math.min(yLast, 425), 300, Math.max(y0, 425))
  T(296, (Math.min(yLast, 425) + Math.max(y0, 425)) / 2, 1.9, 'DISTRIBUTION HEADER', 'center', 'FP-ANNO', 90)
  shown.forEach((q, i) => {
    const y = y0 - i * pitch
    line('CO2-PIPE', 300, y, 346, y)
    line('CO2-PIPE', 378, y, 436, y)
    if (multi) {
      dev('selector-valve', 322, y, 2.8)
      T(322, y - 6.5, 1.7, 'SELECTOR VALVE', 'center')
    }
    rect('CO2-EQPM', 346, y - 4, 32, 8)
    T(362, y, 1.8, 'TIME DELAY', 'center')
    T(362, y - 6.5, 1.7, '(PRESSURE-OPERATED)', 'center')
    T(398, y + 3.5, 1.8, `${sizeLabel(q.main)} SCH ${q.sch}`, 'center')
    nozzleSymbol(b, X(444), Y(y), 3.2 * S)
    const codes = [...new Set(q.e.nozzles.map((n) => n.orificeCode))].join(' / ')
    lines(454, y + 4.5, 1.9, [
      `${q.fid} / ${q.e.enclosureId}  ${q.e.name.toUpperCase()}`,
      `${lbKg(q.e.quantity.totalLb)} - ${q.e.nozzles.length} NOZZLES`,
      `ORIFICE ${codes} - ${f0(q.e.rateLbMin)} LB/MIN`
    ])
  })
  if (encs.length > maxRows) {
    const y = y0 - shown.length * pitch
    T(300, y, 2, `... AND ${encs.length - shown.length} MORE ENCLOSURES - SAME ARRANGEMENT (SEE CO-601)`)
  }
  if (!multi) T(310, y0 + 14, 1.8, 'SINGLE ENCLOSURE - SELECTOR VALVE NOT REQUIRED')
  T(300, 556, 2.1, 'NOZZLES: ORIFICE CODE = DIAMETER IN 1/32 IN')
  T(300, 551.5, 1.8, `SUPPLY PRESSURE ${st.storage === 'high-pressure' ? '750 PSI (52 BAR) AT 21 C' : '300 PSI (20.7 BAR) AT -18 C'}`)

  // ───────────────────────── control & detection matrix ─────────────────────────
  const first = a.detection === 'heat' ? 'HEAT DETECTOR' : a.detection === 'smoke-cross-zoned' ? 'FIRST SMOKE DETECTOR (ZONE A)' : 'DETECTION (NONE - MANUAL ONLY)'
  const second = a.detection === 'smoke-cross-zoned' ? 'SECOND DETECTOR (ZONE B)' : a.detection === 'heat' ? 'HEAT DETECTOR ALARM' : 'MANUAL RELEASE'
  const w = (s: string, n = 22): string => wrapText(s, n).join('\n')
  const matrix: string[][] = [
    ['INPUT / EVENT', 'PRE-DISCHARGE ALARM', 'TIME DELAY', 'CYLINDER RELEASE', 'VENTILATION / DAMPERS', 'SIGNAL TO FACP'],
    [w(first), w('HORN / STROBE INSIDE'), '-', '-', '-', 'ALARM'],
    [w(second), w('HORN / STROBE + OUTSIDE STROBE'), `${a.timeDelayS} S`, w('AFTER THE TIME DELAY'), w('SHUT DOWN / CLOSE'), 'ALARM'],
    [w('MANUAL RELEASE STATION'), w('HORN / STROBE + OUTSIDE STROBE'), `${a.timeDelayS} S`, w('AFTER THE TIME DELAY'), w('SHUT DOWN / CLOSE'), 'ALARM'],
    [w('MECHANICAL MANUAL RELEASE (STORAGE)'), '-', '-', 'DIRECT', '-', w('BY PRESSURE SWITCH')],
    [w('LOCKOUT VALVE CLOSED'), '-', '-', w('INHIBITED - PIPE CLOSED'), '-', 'SUPERVISORY'],
    [w('PRESSURE SWITCH (DISCHARGE)'), w('OUTSIDE STROBE STAYS ON'), '-', '-', w('CONFIRMED SHUT DOWN'), 'DISCHARGE']
  ]
  const mh = fitTable(c, 566, 580, matrix, 1.9, 263, 'CONTROL & DETECTION MATRIX', undefined, 1.4)
  let yb = 580 - mh.h - 5
  const points = co2SafetyPoints(a).map((p) => `${p.title.toUpperCase()}: ${p.text.toUpperCase().replace(/—/g, '-')}`)
  points.push(CO2_PRELIMINARY_NOTE.toUpperCase().replace(/—/g, '-'))
  const availB = yb - 305
  let nth = 2.0
  while (nth > 1.4 && notesHeight(566, 263, points, nth) > availB) nth -= 0.1
  yb -= drawNotes(c, 566, yb, 263, 'SAFETY NOTES (NFPA 12-2022 CH. 4)', points, nth)

  // ───────────────────────── details ─────────────────────────
  const dTitle = (x: number, y: number, t: string): void => {
    T(x, y, 3.0, t)
    line('FP-ANNO', x, y - 3, x + Math.min(160, textWidth(3.0, t) + 4), y - 3)
  }
  // D1 cylinder rack / tank detail
  dTitle(26, 288, hp ? '1  CYLINDER RACK DETAIL (NTS)' : '1  STORAGE TANK DETAIL (NTS)')
  if (hp) {
    line('FP-WALL', 30, 100, 178, 100)
    for (let i = 0; i < 3; i++) {
      const x = 52 + i * 34
      rect('CO2-STORAGE', x - 7, 106, 14, 100)
      b.arc('CO2-STORAGE', X(x), Y(206), 7 * S, 0, 180)
      rect('CO2-STORAGE', x - 3, 213, 6, 6)
      line('CO2-STORAGE', x - 5, 112, x + 5, 112)
    }
    line('CO2-STORAGE', 38, 130, 128, 130)
    line('CO2-STORAGE', 38, 170, 128, 170)
    rect('CO2-EQPM', 150, 101, 28, 5)
    line('FP-WALL', 30, 100, 30, 250)
    for (let k = 0; k < 15; k++) line('FP-WALL-HTCH', 30, 100 + k * 10, 24, 106 + k * 10)
    T(134, 256, 1.8, 'CYLINDER VALVE + DISCHARGE HEAD')
    T(134, 250, 1.8, 'FLEXIBLE HOSE TO MANIFOLD')
    T(134, 244, 1.8, 'SAFETY CAP / PILOT HEAD')
    T(134, 172, 1.8, 'UPPER STRAP / FRAME')
    T(134, 132, 1.8, 'LOWER STRAP / FRAME')
    T(150, 108, 1.8, 'WEIGHING DEVICE', 'left')
    T(36, 262, 1.8, 'CYLINDERS SECURED TO RACK; FIXED TO WALL AND SLAB')
    T(36, 92, 1.8, `${f0(st.cylinderLb)} LB NET CYLINDER, FILLED TO NOT MORE THAN 68 %`)
  } else {
    b.arc('CO2-STORAGE', X(60), Y(170), 32 * S, 90, 270)
    b.arc('CO2-STORAGE', X(150), Y(170), 32 * S, 270, 90)
    line('CO2-STORAGE', 60, 202, 150, 202)
    line('CO2-STORAGE', 60, 138, 150, 138)
    T(105, 172, 2, 'LOW-PRESSURE', 'center')
    T(105, 167, 2, 'CO2 TANK', 'center')
    T(105, 160, 1.8, `${st.tankTons ?? 0} TON`, 'center')
    T(36, 262, 1.8, 'REFRIGERATION UNIT, RELIEF VALVES, LEVEL AND PRESSURE GAUGES')
    T(36, 94, 1.8, 'STORAGE AT 300 PSI (20.7 BAR) AND -18 C (0 F)')
  }
  // D2 nozzle detail
  dTitle(196, 288, '2  DISCHARGE NOZZLE DETAIL (NTS)')
  for (let k = 0; k < 14; k++) line('FP-WALL-HTCH', 200, 255 - k * 0, 200, 255)
  rect('FP-WALL', 200, 246, 160, 8)
  for (let k = 0; k < 16; k++) line('FP-WALL-HTCH', 200 + k * 10, 246, 210 + k * 10, 254)
  line('CO2-PIPE', 270, 246, 270, 214)
  rect('CO2-PIPE', 262, 205, 16, 9)
  line('CO2-PIPE', 270, 205, 270, 192)
  b.polyline('CO2-NOZZLE', [[X(266), Y(192)], [X(274), Y(192)], [X(280), Y(180)], [X(260), Y(180)]], true)
  line('CO2-NOZZLE', 266, 186, 274, 186)
  for (const dx of [-26, -13, 0, 13, 26]) line('CO2-CTRL', 270 + dx * 0.25, 180, 270 + dx, 150)
  T(286, 232, 1.8, 'PIPE DROP, SIZE AS CALCULATED')
  T(286, 209, 1.8, 'TEE / HANGER (SUPPORT NEAR NOZZLE)')
  T(286, 188, 1.8, 'LISTED DISCHARGE NOZZLE')
  T(286, 183, 1.8, 'ORIFICE CODE = DIAMETER IN 1/32 IN')
  T(286, 154, 1.8, 'DISCHARGE PATTERN - AREA AND HEIGHT')
  T(286, 149, 1.8, 'PER THE MANUFACTURER\'S LISTING')
  const codes = new Map<number, number>()
  for (const q of encs) for (const n of q.e.nozzles) codes.set(n.orificeCode, (codes.get(n.orificeCode) ?? 0) + 1)
  const orows: string[][] = [['ORIFICE CODE', 'DIA IN', 'DIA MM', 'QTY']]
  for (const [code, q] of [...codes].sort((p, z) => p[0] - z[0])) orows.push([String(code), fx(code / 32, 3), fx((code / 32) * 25.4, 1), String(q)])
  fitTable(c, 204, 140, orows.slice(0, 12), 1.9, 150, 'NOZZLE SCHEDULE', [false, true, true, true])
  // D3 pressure relief vent detail
  dTitle(366, 288, '3  PRESSURE RELIEF VENT DETAIL (NTS)')
  rect('FP-WALL', 380, 180, 14, 100)
  for (let k = 0; k < 10; k++) line('FP-WALL-HTCH', 380, 180 + k * 10, 394, 190 + k * 10)
  b.rect('CO2-DEVICE', X(380), Y(212), 14 * S, 36 * S)
  for (let k = 0; k < 6; k++) line('CO2-DEVICE', 380, 216 + k * 6, 394, 222 + k * 6)
  line('FP-ANNO', 410, 230, 440, 230)
  b.solid('FP-ANNO', [[X(444), Y(230)], [X(437), Y(232)], [X(437), Y(228)]])
  T(398, 262, 1.8, 'PROTECTED SIDE', 'left')
  T(404, 255, 1.8, 'PRESSURE RELIEF VENT / DAMPER', 'left')
  T(404, 250, 1.8, 'OPENS ON OVER-PRESSURE, CLOSES AFTER', 'left')
  T(404, 245, 1.8, 'DISCHARGE; VENT TO A SAFE LOCATION', 'left')
  const vrows: string[][] = [['ENCLOSURE', 'FREE VENT IN2', 'FREE VENT MM2']]
  for (const q of encs.slice(0, 10)) vrows.push([`${q.fid}/${q.e.enclosureId}`, fx(q.e.ventAreaIn2, 1), f0(q.e.ventAreaMm2)])
  fitTable(c, 380, 168, vrows, 1.9, 150, 'FREE VENT AREA (NFPA 12 ANNEX)', [false, true, true])
  // D4 warning signs
  dTitle(534, 288, '4  NFPA 12 WARNING SIGNS (LETTERING TEXT)')
  CO2_SIGNS.forEach((sg, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = 534 + col * 150
    const yT = 276 - row * 85
    T(x, yT, 1.9, sg.title)
    T(x, yT - 4.5, 1.6, sg.location)
    const h = 4 + sg.lines.length * 6.2
    rect('FP-ANNO', x, yT - 8 - h, 144, h)
    rect('FP-ANNO', x + 1.5, yT - 9.5 - h + 3, 141, h - 3)
    sg.lines.forEach((t, k) => T(x + 72, yT - 8 - 4 - k * 6.2 - 1, k === 0 ? 3.6 : 2.4, t, 'center'))
  })
}
