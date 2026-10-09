import type { DxfEntity } from '../../store/projectStore'
import { isPointInPolygon } from '../geometry'
import { atLevel } from './elevation'
import type {
  CadLevelAnnotation,
  CadLevelAnnotationResult,
  CadRoomCandidate
} from './semanticTypes'

/**
 * Ceiling-height suggestions from TEXT/MTEXT inside a room candidate. A suggestion only; the user approves it.
 *
 * Keywords: CH / C.H. / CLG HT / CEILING HEIGHT / ارتفاع السقف (direct height), FFL (finished floor level),
 * FCL (finished ceiling level) and SOFFIT (slab underside level).
 *
 * Number interpretation, in order:
 *  1. explicit unit: 2700mm, 2.7m, 270cm, 9ft, 9'-6" (feet-inches), 108" / 108in;
 *  2. unitless with a decimal point and |value| < 10: metres ("CH 2.70" = 2.70 m) ONLY when the drawing is metric
 *     (options.unitSystem 'metric', or confirmed units whose unitsPerFoot is a metric scale). In an imperial drawing
 *     (confirmed, or options.unitSystem 'imperial') it is read as feet ("CH 9.5" = 9.5 ft). Without a metric or
 *     confirmed-imperial indication it is unresolved, never guessed;
 *  3. any other unitless number: drawing units, but only when the drawing units are confirmed
 *     (unitsConfirmed) - otherwise the annotation is reported as unresolved, never guessed.
 * Arabic-Indic digits and the Arabic decimal separator are normalised for parsing; the original text is
 * always kept untouched in annotations[].text and in the evidence.
 *
 * Derivation tiers (the highest tier present wins):
 *  1. direct CH value                      confidence 0.80 (0.75 if from confirmed drawing units)
 *  2. FCL - FFL (FFL assumed 0 if absent)  confidence 0.70 (0.55 if FFL assumed)
 *  3. SOFFIT - FFL, a weak upper bound     confidence 0.35 (the ceiling is normally below the soffit)
 * Agreeing second sources add 0.1 (max 0.9). Two values that differ by more than 0.05 ft within a tier, or
 * 0.1 ft across tiers 1 and 2, are a conflict: no suggestion and unresolved = true.
 * Results outside 6.5 - 40 ft are not suggested (unresolved).
 */
export interface LevelAnnotationOptions {
  unitsPerFoot: number
  /** The user confirmed the drawing units (so unitless integers may use unitsPerFoot). */
  unitsConfirmed?: boolean
  /** Elevation (drawing units) of the level whose text to read; default 0. */
  level?: number
  /**
   * Unit system of the drawing, when known independently of unitsPerFoot (e.g. the store's confirmed cadUnit).
   * If omitted it is derived from unitsPerFoot, but only when unitsConfirmed.
   */
  unitSystem?: 'metric' | 'imperial'
}

const near = (a: number, b: number) => Math.abs(a - b) <= 0.01 * Math.max(a, b)
const METRIC_UNITS_PER_FOOT = [304.8, 30.48, 3.048, 0.3048]
const IMPERIAL_UNITS_PER_FOOT = [1, 12, 1 / 3]
function drawingUnitSystem(opts: LevelAnnotationOptions): 'metric' | 'imperial' | undefined {
  if (opts.unitSystem) return opts.unitSystem
  if (!opts.unitsConfirmed || !Number.isFinite(opts.unitsPerFoot)) return undefined
  if (METRIC_UNITS_PER_FOOT.some((k) => near(k, opts.unitsPerFoot))) return 'metric'
  if (IMPERIAL_UNITS_PER_FOOT.some((k) => near(k, opts.unitsPerFoot))) return 'imperial'
  return undefined
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
export function normalizeAnnotationText(raw: string): string {
  return raw
    .replace(/\\P/gi, ' ')
    .replace(/\\[A-Za-z][^;\\]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/[٠-٩]/g, (c) => String(ARABIC_DIGITS.indexOf(c)))
    .replace(/[۰-۹]/g, (c) => String(PERSIAN_DIGITS.indexOf(c)))
    .replace(/[٫]/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
}

const FT_PER = { mm: 1 / 304.8, cm: 1 / 30.48, m: 1 / 0.3048, ft: 1, feet: 1 } as const
interface Quantity { valueFt?: number; how: string; viaDrawingUnits?: boolean; problem?: string }

function parseQuantity(rest: string, opts: LevelAnnotationOptions): Quantity | null {
  const feetInch = /^([+-]?)\s*(\d+(?:\.\d+)?)\s*'\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|''|in\b)?)?/i.exec(rest)
  if (feetInch) {
    const v = Number(feetInch[2]) + (feetInch[3] ? Number(feetInch[3]) / 12 : 0)
    return { valueFt: feetInch[1] === '-' ? -v : v, how: 'feet-inches notation' }
  }
  const inches = /^([+-]?)\s*(\d+(?:\.\d+)?)\s*(?:"|in\b)/i.exec(rest)
  if (inches) return { valueFt: (inches[1] === '-' ? -1 : 1) * (Number(inches[2]) / 12), how: 'explicit inches' }
  const m = /^([+-]?)\s*(\d+(?:[.,]\d{1,2}(?!\d))?(?:\d*))\s*(mm|cm|m|ft|feet)?(?![A-Za-z])/i.exec(rest)
  if (!m) return null
  const decimal = /[.,]\d{1,2}$/.test(m[2])
  const value = Number(m[2].replace(',', '.').replace(/,/g, ''))
  if (!Number.isFinite(value)) return null
  const sign = m[1] === '-' ? -1 : 1
  if (m[3]) return { valueFt: sign * value * FT_PER[m[3].toLowerCase() as keyof typeof FT_PER], how: `explicit unit ${m[3]}` }
  if (decimal && Math.abs(value) < 10) {
    const system = drawingUnitSystem(opts)
    if (system === 'metric') return { valueFt: (sign * value) / 0.3048, how: 'decimal number under 10 read as metres (metric drawing)' }
    if (system === 'imperial' && opts.unitsConfirmed) return { valueFt: sign * value, how: 'decimal number under 10 read as feet (imperial drawing)' }
    return { how: 'unitless', problem: `"${m[2]}" has no unit and the drawing is not confirmed metric or imperial` }
  }
  if (opts.unitsConfirmed && Number.isFinite(opts.unitsPerFoot) && opts.unitsPerFoot > 0)
    return { valueFt: (sign * value) / opts.unitsPerFoot, how: 'confirmed drawing units', viaDrawingUnits: true }
  return { how: 'unitless', problem: `"${m[2]}" has no unit and the drawing units are not confirmed` }
}

const NUM = String.raw`[+-]?\s*\d`
const PATTERNS: { kind: CadLevelAnnotation['kind']; re: RegExp }[] = [
  { kind: 'ceiling-height', re: new RegExp(String.raw`(?:\bC\.?\s?H\.?|\bCLG\.?\s*(?:HT|HEIGHT)\.?|\bCEIL(?:ING)?\.?\s*(?:HT|HEIGHT)\.?|ارتفاع\s*السقف)\s*[:=]?\s*(?=${NUM}|[+-]?\s*\d)`, 'i') },
  { kind: 'ffl', re: /\bF\.?F\.?L\.?\s*[:=]?\s*(?=[+-]?\s*\d)/i },
  { kind: 'fcl', re: /\bF\.?C\.?L\.?(?=\s*[:=]?\s*[+-]?\s*\d|\s*$|[^A-Za-z0-9])\s*[:=]?\s*/i },
  { kind: 'soffit', re: /\bSOFFIT(?:\s*(?:LEVEL|LVL))?\.?\s*[:=]?\s*(?=[+-]?\s*\d)/i }
]

/** True for TEXT/MTEXT that is a level note (CH / CLG HT / FFL / FCL / SOFFIT): never a room name. */
export function isLevelAnnotation(raw: string): boolean {
  const clean = normalizeAnnotationText(raw)
  return PATTERNS.some(({ re }) => re.test(clean))
}

export function suggestCeilingHeight(
  entities: DxfEntity[],
  room: Pick<CadRoomCandidate, 'polygon'>,
  options: LevelAnnotationOptions
): CadLevelAnnotationResult {
  const result: CadLevelAnnotationResult = { unresolved: false, unresolvedReasons: [], annotations: [] }
  const level = options.level ?? 0
  const reasons = result.unresolvedReasons
  entities.forEach((e, index) => {
    if (e.type !== 'TEXT' && e.type !== 'MTEXT') return
    if (!e.text || !Number.isFinite(e.x) || !Number.isFinite(e.y) || !atLevel(e, level)) return
    if (!isPointInPolygon(e.x!, e.y!, room.polygon)) return
    const handle = e.handle ?? e.sourceHandle ?? `entity-${index}`
    const clean = normalizeAnnotationText(e.text)
    for (const { kind, re } of PATTERNS) {
      const hit = re.exec(clean)
      if (!hit) continue
      const rest = clean.slice(hit.index + hit[0].length)
      const hasNumber = /^[+-]?\s*\d/.test(rest)
      if (!hasNumber) {
        if (kind === 'fcl') result.annotations.push({ handle, text: e.text, kind, interpretation: 'marker without a value' })
        continue
      }
      const q = parseQuantity(rest, options)
      if (!q) continue
      if (q.valueFt === undefined) {
        reasons.push(`${e.text}: ${q.problem}.`)
        result.annotations.push({ handle, text: e.text, kind, interpretation: q.problem })
        continue
      }
      result.annotations.push({ handle, text: e.text, kind, valueFt: q.valueFt, interpretation: q.how })
    }
  })

  const withValue = (kind: CadLevelAnnotation['kind']) => result.annotations.filter((a) => a.kind === kind && a.valueFt !== undefined)
  const distinct = (xs: number[], tol: number) => xs.filter((x, i) => xs.findIndex((y) => Math.abs(x - y) <= tol) === i)
  const quote = (a: CadLevelAnnotation) => `"${a.text}" (${a.valueFt!.toFixed(3)} ft, ${a.interpretation})`

  const ch = withValue('ceiling-height')
  const ffl = withValue('ffl'), fcl = withValue('fcl'), soffit = withValue('soffit')
  if (distinct(ffl.map((a) => a.valueFt!), 0.05).length > 1) reasons.push(`Conflicting FFL annotations: ${ffl.map(quote).join('; ')}.`)
  const fflValue = distinct(ffl.map((a) => a.valueFt!), 0.05).length === 1 ? ffl[0].valueFt! : undefined
  const fflKnown = fflValue !== undefined
  const base = fflValue ?? 0
  const conflicting = reasons.some((r) => r.startsWith('Conflicting FFL'))

  type Source = { valueFt: number; confidence: number; evidence: string }
  const tier1: Source[] = ch.map((a) => ({ valueFt: a.valueFt!, confidence: a.interpretation === 'confirmed drawing units' ? 0.75 : 0.8, evidence: `Direct ceiling-height annotation ${quote(a)}.` }))
  const tier2: Source[] = fcl.map((a) => ({ valueFt: a.valueFt! - base, confidence: fflKnown ? 0.7 : 0.55, evidence: `FCL annotation ${quote(a)} minus FFL ${fflKnown ? `${base.toFixed(3)} ft` : '0 (no FFL found, assumed)'}.` }))
  const tier3: Source[] = soffit.map((a) => ({ valueFt: a.valueFt! - base, confidence: fflKnown ? 0.35 : 0.3, evidence: `Soffit level ${quote(a)} minus FFL ${fflKnown ? `${base.toFixed(3)} ft` : '0 (assumed)'}: the soffit is the slab underside, so the ceiling is likely lower.` }))

  const plausible = (s: Source) => s.valueFt >= 6.5 && s.valueFt <= 40
  for (const s of [...tier1, ...tier2, ...tier3]) if (!plausible(s)) reasons.push(`Implausible ceiling height ${s.valueFt.toFixed(2)} ft (accepted range 6.5 - 40 ft): ${s.evidence}`)
  const t1 = tier1.filter(plausible), t2 = tier2.filter(plausible), t3 = tier3.filter(plausible)
  if (distinct(t1.map((s) => s.valueFt), 0.05).length > 1) reasons.push(`Conflicting ceiling-height annotations: ${t1.map((s) => s.evidence).join(' ')}`)
  if (distinct(t2.map((s) => s.valueFt), 0.05).length > 1) reasons.push(`Conflicting FCL annotations: ${t2.map((s) => s.evidence).join(' ')}`)
  if (t1.length && t2.length && Math.abs(t1[0].valueFt - t2[0].valueFt) > 0.1) reasons.push(`Conflicting sources: ${t1[0].evidence} ${t2[0].evidence}`)
  const conflict = reasons.some((r) => r.startsWith('Conflicting'))
  const chosen = t1.length ? t1 : t2.length ? t2 : t3
  const unresolvedAny = reasons.length > 0
  if (!conflict && chosen.length && !conflicting) {
    const agreeing = [...t1, ...t2].filter((s) => Math.abs(s.valueFt - chosen[0].valueFt) <= 0.1)
    const sources = chosen === t3 ? chosen : agreeing
    result.ceilingHeightSuggestion = {
      valueFt: chosen[0].valueFt,
      confidence: Math.min(0.9, chosen[0].confidence + (sources.length > 1 ? 0.1 : 0)),
      evidence: sources.map((s) => s.evidence)
    }
  }
  // Any unreadable, implausible or conflicting annotation keeps the room flagged for human review,
  // even when another annotation still yields a suggestion.
  result.unresolved = unresolvedAny
  return result
}
