/**
 * Design verification across disciplines: every fire-protection check, HVAC airflow / return balance / velocity /
 * NC checks per zone, BIM model integrity, clashes and placement warnings — one itemised list plus a printable
 * HTML report ready for submission.
 */
import type { FireDesignResult } from '../fireProtection/fpTypes'
import type { BimElement, BimModel, Vec3 } from '../bim/bimTypes'
import { detectClashes } from '../bim/bimModel'
import type { Diffuser, ProjectMetadata, Zone } from '../../store/projectStore'

export type VerificationStatus = 'pass' | 'warn' | 'fail'

export interface VerificationItem {
  discipline: 'Fire Protection' | 'HVAC' | 'BIM'
  system: string
  id: string
  title: string
  status: VerificationStatus
  detail: string
  reference: string
}

export interface VerificationSummary {
  total: number
  pass: number
  warn: number
  fail: number
}

export interface VerificationReport {
  items: VerificationItem[]
  summary: VerificationSummary
  html: string
}

export interface VerifyDesignsInput {
  fire?: FireDesignResult
  hvac?: { zones: Zone[]; project: ProjectMetadata }
  bim?: BimModel
}

const DEFAULT_MAX_VELOCITY_FPM = 900
const DEFAULT_MAX_NC = 35
const AIRFLOW_TOL = 0.01
const RETURN_TOL = 0.1
const CLASH_TOL_MM = 25

const num = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 10) / 10) : '0')
const isReturn = (d: Diffuser): boolean => d.type === 'return'
const isSupply = (d: Diffuser): boolean => d.type !== 'return' && d.type !== 'exhaust'

function verifyHvacZone(zone: Zone): VerificationItem[] {
  const out: VerificationItem[] = []
  const system = zone.name || zone.id
  const supply = zone.diffusers.filter(isSupply)
  const returns = zone.diffusers.filter(isReturn)
  const supplyCfm = supply.reduce((s, d) => s + (Number.isFinite(d.cfm) ? d.cfm : 0), 0)
  const returnCfm = returns.reduce((s, d) => s + (Number.isFinite(d.cfm) ? d.cfm : 0), 0)

  // Airflow conservation: supply terminals vs the root (first) supply trunk segment.
  const trunk = zone.ducts.find((d) => d.type === 'trunk')
  let status: VerificationStatus = 'pass'
  let detail: string
  if (!trunk) {
    status = 'warn'
    detail = `No supply trunk segment to compare with the ${num(supplyCfm)} CFM of ${supply.length} supply terminal(s).`
  } else {
    const diff = Math.abs(supplyCfm - trunk.cfm)
    const base = Math.max(trunk.cfm, 1)
    if (diff / base > AIRFLOW_TOL) status = 'fail'
    detail = `Supply terminals ${num(supplyCfm)} CFM vs root trunk ${trunk.id} ${num(trunk.cfm)} CFM (difference ${num(diff)} CFM, ${num((diff / base) * 100)} %, limit ±${AIRFLOW_TOL * 100} %).`
  }
  out.push({
    discipline: 'HVAC',
    system,
    id: `hvac-airflow:${zone.id}`,
    title: `Airflow conservation - ${system}`,
    status,
    detail,
    reference: 'ASHRAE 62.1 / SMACNA - supply airflow continuity'
  })

  // Return balance
  if (returns.length === 0) {
    out.push({
      discipline: 'HVAC',
      system,
      id: `hvac-return-balance:${zone.id}`,
      title: `Return / supply balance - ${system}`,
      status: 'warn',
      detail: `No return terminals; supply is ${num(supplyCfm)} CFM.`,
      reference: 'ASHRAE 62.1 - return air path'
    })
  } else {
    const diff = Math.abs(returnCfm - supplyCfm)
    const ok = supplyCfm > 0 ? diff / supplyCfm <= RETURN_TOL : returnCfm === 0
    out.push({
      discipline: 'HVAC',
      system,
      id: `hvac-return-balance:${zone.id}`,
      title: `Return / supply balance - ${system}`,
      status: ok ? 'pass' : 'fail',
      detail: `Return ${num(returnCfm)} CFM vs supply ${num(supplyCfm)} CFM (difference ${num(diff)} CFM, limit ±${RETURN_TOL * 100} %).`,
      reference: 'ASHRAE 62.1 - return air path'
    })
  }

  // Velocity
  const limit = zone.maxVelocityLimitFpm ?? DEFAULT_MAX_VELOCITY_FPM
  const over: string[] = []
  let maxV = 0
  for (const d of zone.ducts) {
    const area = (d.widthIn * d.heightIn) / 144
    const v = d.velocityFpm ?? (area > 0 ? d.cfm / area : 0)
    if (!Number.isFinite(v)) continue
    maxV = Math.max(maxV, v)
    if (v > limit) over.push(`${d.id} ${num(v)}`)
  }
  out.push({
    discipline: 'HVAC',
    system,
    id: `hvac-velocity:${zone.id}`,
    title: `Duct velocity - ${system}`,
    status: over.length ? 'fail' : 'pass',
    detail: over.length
      ? `Over ${limit} FPM: ${over.join(', ')}.`
      : `${zone.ducts.length} segment(s), maximum ${num(maxV)} FPM within ${limit} FPM.`,
    reference: 'SMACNA HVAC Duct Construction - velocity limits'
  })

  // NC
  const ncLimit = zone.maxSpaceNcLimit ?? DEFAULT_MAX_NC
  const rated = zone.diffusers.filter(
    (d) => typeof d.actualNc === 'number' && Number.isFinite(d.actualNc)
  )
  const bad = rated.filter((d) => (d.actualNc as number) > ncLimit)
  out.push({
    discipline: 'HVAC',
    system,
    id: `hvac-nc:${zone.id}`,
    title: `Terminal noise (NC) - ${system}`,
    status: bad.length ? 'fail' : 'pass',
    detail: bad.length
      ? `Above NC-${ncLimit}: ${bad.map((d) => `${d.id} NC-${d.actualNc}`).join(', ')}.`
      : `${rated.length} rated terminal(s) at or below NC-${ncLimit}.`,
    reference: 'ASHRAE Handbook - Applications, Sound and Vibration (NC criteria)'
  })
  return out
}

function geometryPoints(el: BimElement): Vec3[] {
  const g = el.geometry
  return g.kind === 'segment' ? [g.start, g.end] : g.kind === 'box' ? [g.origin] : [g.base]
}

function geometrySizes(el: BimElement): number[] {
  const g = el.geometry
  if (g.kind === 'segment')
    return g.profile.shape === 'circle'
      ? [g.profile.diameterMm]
      : [g.profile.widthMm, g.profile.heightMm]
  if (g.kind === 'box') return [...g.sizeMm]
  return [g.diameterMm, g.heightMm]
}

function verifyBim(model: BimModel): VerificationItem[] {
  const system = model.discipline || 'MEP'
  const storeys = new Set(model.storeys.map((s) => s.id))
  const systems = new Set(model.systems.map((s) => s.id))
  const problems: string[] = []
  for (const el of model.elements) {
    if (!storeys.has(el.storeyId)) problems.push(`${el.tag}: unknown storey ${el.storeyId}`)
    if (!systems.has(el.systemId)) problems.push(`${el.tag}: unknown system ${el.systemId}`)
    if (!geometryPoints(el).every((p) => p.every(Number.isFinite)))
      problems.push(`${el.tag}: non-finite coordinates`)
    if (!geometrySizes(el).every((s) => Number.isFinite(s) && s > 0))
      problems.push(`${el.tag}: zero or invalid size`)
  }
  const items: VerificationItem[] = [
    {
      discipline: 'BIM',
      system,
      id: 'bim-integrity',
      title: 'Model integrity',
      status: problems.length ? 'fail' : 'pass',
      detail: problems.length
        ? `${problems.length} problem(s): ${problems.slice(0, 10).join('; ')}${problems.length > 10 ? '; ...' : ''}.`
        : `${model.elements.length} element(s) reference valid storeys and systems with finite geometry.`,
      reference: 'ISO 16739-1:2018 (IFC4) - spatial containment and distribution systems'
    }
  ]
  const clashes = problems.some((p) => p.includes('non-finite'))
    ? []
    : detectClashes(model, { toleranceMm: CLASH_TOL_MM })
  items.push({
    discipline: 'BIM',
    system,
    id: 'bim-clashes',
    title: 'Clash detection',
    status: clashes.length ? 'fail' : 'pass',
    detail: clashes.length
      ? `${clashes.length} clash(es) at ${CLASH_TOL_MM} mm tolerance: ${clashes
          .slice(0, 10)
          .map((c) => `${c.a} / ${c.b} (${num(c.clearanceMm)} mm)`)
          .join('; ')}${clashes.length > 10 ? '; ...' : ''}.`
      : `No clashes at ${CLASH_TOL_MM} mm tolerance.`,
    reference: 'BIM coordination - hard clash, tolerance 25 mm'
  })
  items.push({
    discipline: 'BIM',
    system,
    id: 'bim-placement',
    title: 'Placement assumptions',
    status: model.warnings.length ? 'warn' : 'pass',
    detail: model.warnings.length ? model.warnings.join('; ') : 'No placement warnings.',
    reference: 'Model placement inputs'
  })
  return items
}

const esc = (s: string): string =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
const LABEL: Record<VerificationStatus, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }

function renderHtml(items: VerificationItem[], summary: VerificationSummary, date: string): string {
  const chip = (s: VerificationStatus): string => `<span class="chip ${s}">${LABEL[s]}</span>`
  const groups = new Map<string, VerificationItem[]>()
  for (const i of items) {
    const k = `${i.discipline}\u0000${i.system}`
    groups.set(k, [...(groups.get(k) ?? []), i])
  }
  const summaryRows = [...groups.values()]
    .map((g) => {
      const c = (s: VerificationStatus): number => g.filter((i) => i.status === s).length
      return `<tr><td>${esc(g[0].discipline)}</td><td>${esc(g[0].system)}</td><td class="n">${g.length}</td><td class="n">${c('pass')}</td><td class="n">${c('warn')}</td><td class="n">${c('fail')}</td></tr>`
    })
    .join('')
  const itemRows = items
    .map(
      (i) =>
        `<tr><td>${esc(i.discipline)}</td><td>${esc(i.system)}</td><td><b>${esc(i.title)}</b><br><span class="id">${esc(i.id)}</span></td><td>${chip(i.status)}</td><td>${esc(i.detail)}</td><td>${esc(i.reference)}</td></tr>`
    )
    .join('')
  const overall: VerificationStatus = summary.fail ? 'fail' : summary.warn ? 'warn' : 'pass'
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Design Verification Report</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;margin:24px;font-size:12px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:22px 0 6px}
.meta{color:#555;margin-bottom:14px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:5px 7px;text-align:left;vertical-align:top}
th{background:#eee}td.n{text-align:right;width:60px}.id{color:#777;font-size:10px}
.chip{display:inline-block;padding:1px 7px;border-radius:9px;font-weight:bold;font-size:10px;color:#fff}
.chip.pass{background:#2e7d32}.chip.warn{background:#ef8f00}.chip.fail{background:#c62828}
tr{page-break-inside:avoid}@media print{body{margin:10mm}}
</style></head><body>
<h1>Design Verification Report</h1>
<div class="meta">Generated ${esc(date)} &middot; Overall ${chip(overall)} &middot; ${summary.total} checks: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail</div>
<h2>Summary by discipline and system</h2>
<table><tr><th>Discipline</th><th>System</th><th>Checks</th><th>Pass</th><th>Warn</th><th>Fail</th></tr>${summaryRows || '<tr><td colspan="6">No checks run.</td></tr>'}</table>
<h2>All checks</h2>
<table><tr><th>Discipline</th><th>System</th><th>Check</th><th>Status</th><th>Detail</th><th>Reference</th></tr>${itemRows || '<tr><td colspan="6">No checks run.</td></tr>'}</table>
</body></html>`
}

export function verifyDesigns(input: VerifyDesignsInput): VerificationReport {
  const items: VerificationItem[] = []
  if (input.fire) {
    for (const c of input.fire.checks) {
      items.push({
        discipline: 'Fire Protection',
        system: 'Fire Protection',
        id: c.id,
        title: c.title,
        status: c.status,
        detail: c.detail,
        reference: c.reference
      })
    }
  }
  if (input.hvac) {
    for (const z of input.hvac.zones) {
      if (z.ducts.length > 0) items.push(...verifyHvacZone(z))
    }
  }
  if (input.bim) items.push(...verifyBim(input.bim))
  const summary: VerificationSummary = {
    total: items.length,
    pass: items.filter((i) => i.status === 'pass').length,
    warn: items.filter((i) => i.status === 'warn').length,
    fail: items.filter((i) => i.status === 'fail').length
  }
  const date = new Date().toISOString().slice(0, 10)
  return { items, summary, html: renderHtml(items, summary, date) }
}
