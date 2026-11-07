/**
 * M-601 — HVAC schedules: equipment, diffuser & grille, duct and zone summary. Tables are split into row chunks
 * (header repeated) and flowed into columns; when a sheet is full the remaining tables continue on M-602, …
 */
import {
  type Ctx,
  PX,
  PY,
  autoCols,
  drawTable,
  measureTable,
  sheetTitle,
  wrapText
} from '../fireProtection/drawing/sheetKit'
import { type HvacModel, buildModel, fmtTerminalKind } from './hvacModel'
import type { HvacInput } from './hvacTypes'

interface TableDef {
  title: string
  header: string[]
  rows: string[][]
  align: boolean[]
}

const REGION = { x0: 24, x1: 827, yTop: 546, yBot: 76 }
const GAP_X = 9
const GAP_Y = 8
const TH = 2.4

const dash = (s: string | number | undefined): string =>
  s === undefined || s === '' ? '-' : String(s)
const tagRange = (tags: string[]): string =>
  tags.length <= 2 ? tags.join('\n') : `${tags[0]} TO ${tags[tags.length - 1]}`

export function scheduleTables(m: HvacModel): TableDef[] {
  const u = m.u
  const comma = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  // ── zone summary ──
  const zHead = [
    'ZONE',
    'SPACE TYPE',
    `AREA (${u.areaUnit})`,
    'OCC.',
    'CLG HT',
    `SUPPLY (${u.flowUnit})`,
    `RETURN (${u.flowUnit})`,
    `EXHAUST (${u.flowUnit})`,
    'SYSTEM',
    'TERMINALS'
  ]
  const zRows: string[][] = [zHead]
  let ts = 0
  let tr = 0
  let te = 0
  let tn = 0
  let ta = 0
  for (const z of m.zones) {
    const area = u.floorArea(z.areaDu2)
    ta += area
    ts += z.supplyCfm
    tr += z.returnCfm
    te += z.exhaustCfm
    tn += z.nTerm
    zRows.push([
      z.name,
      dash(z.zone.spaceTypeId).toUpperCase(),
      comma(area),
      String(z.zone.occupants),
      `${z.zone.ceilingHeight} ${u.metric ? 'M' : 'FT'}`,
      comma(z.supplyCfm),
      comma(z.returnCfm),
      comma(z.exhaustCfm),
      z.sysLabel,
      String(z.nTerm)
    ])
  }
  zRows.push(['TOTAL', '', comma(ta), '', '', comma(ts), comma(tr), comma(te), '', String(tn)])
  const zone: TableDef = {
    title: 'ZONE SUMMARY',
    header: zHead,
    rows: zRows.slice(1),
    align: zHead.map((_, i) => i === 2 || i === 3 || (i >= 5 && i <= 7) || i === 9)
  }

  // ── equipment ──
  const eHead = [
    'TAG',
    'ZONE',
    'SERVICE',
    'SYSTEM TYPE',
    'MODEL',
    'QTY',
    'ESP',
    `AIRFLOW (${u.flowUnit})`
  ]
  const eRows: string[][] = []
  for (const z of m.zones) {
    if (z.indoorTags.length > 0 || z.zone.catalogModel) {
      const sys = z.zone.systemType ?? 'concealed'
      eRows.push([
        z.indoorTags.length ? tagRange(z.indoorTags) : '-',
        z.name,
        'INDOOR UNIT',
        z.sysLabel,
        dash(z.zone.catalogModel),
        String(z.qty || z.indoorTags.length || 1),
        dash(z.zone.catalogEsp),
        z.supplyCfm <= 0
          ? '-'
          : z.indoorTags.length > 0
            ? comma(z.supplyCfm / Math.max(1, z.qty)) + (z.qty > 1 ? ' EA' : '')
            : comma(z.supplyCfm)
      ])
      void sys
    }
    if (z.outdoorTags.length > 0)
      eRows.push([
        tagRange(z.outdoorTags),
        z.name,
        'OUTDOOR UNIT',
        z.sysLabel,
        'MATCHED TO INDOOR UNIT',
        String(z.outdoorTags.length),
        '-',
        '-'
      ])
  }
  if (eRows.length === 0) eRows.push(['-', '-', '-', '-', '-', '-', '-', '-'])
  const equipment: TableDef = {
    title: 'EQUIPMENT SCHEDULE',
    header: eHead,
    rows: eRows,
    align: eHead.map((_, i) => i === 5 || i === 7)
  }

  // ── diffusers & grilles ──
  const dHead = [
    'TAG',
    'ZONE',
    'TYPE',
    u.metric ? 'NECK (MM)' : 'NECK (IN)',
    u.flowUnit,
    'NC',
    u.metric ? 'THROW (M)' : 'THROW (FT)',
    u.metric ? 'DP (PA)' : 'DP (IN.WG)'
  ]
  const dRows: string[][] = m.terminals.map((t) => [
    t.id,
    t.zoneName,
    fmtTerminalKind(t.kind),
    t.sizeLabel,
    u.flow(t.cfm),
    t.nc !== undefined ? String(t.nc) : '-',
    t.throwFt !== undefined
      ? u.metric
        ? (t.throwFt * 0.3048).toFixed(1)
        : String(t.throwFt)
      : '-',
    t.dpInWg !== undefined
      ? u.metric
        ? String(Math.round(t.dpInWg * 249.09))
        : t.dpInWg.toFixed(3)
      : '-'
  ])
  if (dRows.length === 0) dRows.push(['-', '-', '-', '-', '-', '-', '-', '-'])
  const diffusers: TableDef = {
    title: 'DIFFUSER & GRILLE SCHEDULE',
    header: dHead,
    rows: dRows,
    align: dHead.map((_, i) => i >= 4)
  }

  // ── ducts ──
  const kHead = [
    'ID',
    'ZONE',
    'TYPE',
    'SHAPE',
    u.metric ? 'SIZE (MM)' : 'SIZE (IN)',
    u.flowUnit,
    `AREA (${u.areaUnit})`,
    `VELOCITY (${u.velUnit})`,
    `LENGTH (${u.lenUnit})`
  ]
  const kRows: string[][] = m.ducts.map((d) => [
    d.id,
    d.zoneName,
    d.type === 'return' ? 'RETURN' : d.type === 'trunk' ? 'SUPPLY TRUNK' : 'SUPPLY BRANCH',
    d.round
      ? d.shape === 'flex'
        ? 'FLEXIBLE'
        : 'ROUND'
      : d.shape === 'oval'
        ? 'OVAL'
        : 'RECTANGULAR',
    d.sizeLabel,
    u.flow(d.cfm),
    u.area(d.areaFt2),
    u.vel(d.velFpm),
    u.len(d.lengthMm)
  ])
  if (kRows.length === 0) kRows.push(['-', '-', '-', '-', '-', '-', '-', '-', '-'])
  const ducts: TableDef = {
    title: 'DUCT SCHEDULE',
    header: kHead,
    rows: kRows,
    align: kHead.map((_, i) => i >= 5)
  }

  return [zone, equipment, diffusers, ducts]
}

export function scheduleNotes(m: HvacModel): string[] {
  const u = m.u
  return [
    `Airflows in ${u.flowUnit}; duct velocity = airflow / free area (${u.velUnit}). Duct sizes are clear inside dimensions${u.metric ? ' in mm' : ' in inches'}, width x height.`,
    'NC = terminal noise criterion at the design airflow (ASHRAE Handbook - HVAC Applications, sound and vibration control); throw is the 50 fpm (0.25 m/s) terminal velocity distance.',
    'Ductwork construction, sealing and insulation per SMACNA HVAC Duct Construction Standards; ventilation and thermal comfort per ASHRAE 62.1 and ASHRAE 55.',
    'Terminals and equipment tags correspond to the layout on M-101. Final selections to be confirmed against the manufacturer data before ordering.'
  ]
}

type Chunk = {
  def: TableDef
  rows: string[][]
  title: string
  cols: number[]
  x: number
  y: number
  w: number
  h: number
}
export interface SchedulePage {
  chunks: Chunk[]
  notes: { x: number; y: number; w: number } | null
}

/** Flow all tables into columns and pages. Positions are paper mm. */
const NOTE_CH = (w: number): number => Math.floor((w - 8) / (0.78 * TH))
function notesHeightLocal(notes: string[], w: number): number {
  let h = TH * 3.2
  for (const n of notes) h += wrapText(n, NOTE_CH(w)).length * TH * 1.45 + 0.6 * TH
  return h
}
/** Left-aligned wrapped notes (no symmetric-box margin rule, so they can sit at the frame edge). */
function drawNotesLocal(c: Ctx, xP: number, yTopP: number, w: number, notes: string[]): void {
  const { b } = c
  b.text('M-ANNO', PX(c, xP), PY(c, yTopP - TH), TH * 1.35, 'SCHEDULE NOTES', { vAlign: 'middle' })
  b.line('M-ANNO', PX(c, xP), PY(c, yTopP - TH * 2), PX(c, xP + 45), PY(c, yTopP - TH * 2))
  let y = yTopP - TH * 3.2
  notes.forEach((n, i) => {
    const lines = wrapText(n, NOTE_CH(w))
    b.text('M-ANNO', PX(c, xP), PY(c, y), TH, `${i + 1}.`, { vAlign: 'middle' })
    lines.forEach((ln, li) =>
      b.text('M-ANNO', PX(c, xP + 7), PY(c, y - li * TH * 1.45), TH, ln, { vAlign: 'middle' })
    )
    y -= lines.length * TH * 1.45 + 0.6 * TH
  })
}

export function layoutSchedules(m: HvacModel): SchedulePage[] {
  const defs = scheduleTables(m)
  const notes = scheduleNotes(m)
  const pages: SchedulePage[] = [{ chunks: [], notes: null }]
  let x = REGION.x0
  let y = REGION.yTop
  let colW = 0
  const newColumn = (): void => {
    if (y === REGION.yTop && colW === 0) return
    x += colW + GAP_X
    y = REGION.yTop
    colW = 0
  }
  const cur = (): SchedulePage => pages[pages.length - 1]
  for (const def of defs) {
    const cols = autoCols([def.header, ...def.rows], TH, []).map((v) => v * 1.07)
    const w = cols.reduce((a, v) => a + v, 0)
    let idx = 0
    let first = true
    while (idx < def.rows.length) {
      if (x + w > REGION.x1 + 0.01 && x > REGION.x0) {
        pages.push({ chunks: [], notes: null })
        x = REGION.x0
        y = REGION.yTop
        colW = 0
      }
      const title = first ? def.title : `${def.title} (CONT.)`
      const avail = y - REGION.yBot
      // largest k that fits
      let k = 0
      while (idx + k < def.rows.length) {
        const mt = measureTable(cols, [def.header, ...def.rows.slice(idx, idx + k + 1)], {
          title,
          th: TH
        })
        if (mt.h > avail) break
        k++
      }
      const minK = Math.min(3, def.rows.length - idx)
      if (k < minK) {
        if (y === REGION.yTop && colW === 0) k = Math.max(1, k)
        else {
          newColumn()
          continue
        }
      }
      if (k === 0) k = 1
      const rows = def.rows.slice(idx, idx + k)
      const mt = measureTable(cols, [def.header, ...rows], { title, th: TH })
      cur().chunks.push({ def, rows, title, cols, x, y, w: mt.w, h: mt.h })
      colW = Math.max(colW, mt.w)
      y -= mt.h + GAP_Y
      idx += k
      first = false
    }
  }
  // notes: below the last table of the current column when it fits, else a new column (or page)
  const nw = 150
  const nh = notesHeightLocal(notes, nw)
  if (y - nh >= REGION.yBot && colW > 0) {
    cur().notes = { x, y, w: nw }
  } else {
    newColumn()
    if (x + nw > REGION.x1) {
      pages.push({ chunks: [], notes: null })
      x = REGION.x0
      y = REGION.yTop
    }
    cur().notes = { x, y, w: nw }
  }
  return pages
}

export function drawSchedulePage(
  c: Ctx,
  input: HvacInput,
  pageIndex: number,
  pageCount: number
): void {
  const m = buildModel(input.zones, input.project)
  const page = layoutSchedules(m)[pageIndex]
  sheetTitle(
    c,
    REGION.x0 + 2,
    566,
    'HVAC SCHEDULES',
    `${m.zones.length} ZONES - ${m.terminals.length} TERMINALS - ${m.ducts.length} DUCT SEGMENTS${pageCount > 1 ? ` - SHEET ${pageIndex + 1} OF ${pageCount}` : ''}`
  )
  if (!page) return
  for (const ch of page.chunks) {
    drawTable(c, ch.x, ch.y, ch.cols, [ch.def.header, ...ch.rows], {
      title: ch.title,
      th: TH,
      alignRight: ch.def.align
    })
  }
  if (page.notes) drawNotesLocal(c, page.notes.x, page.notes.y, page.notes.w, scheduleNotes(m))
}

export function schedulePageCount(input: HvacInput): number {
  return layoutSchedules(buildModel(input.zones, input.project)).length
}
