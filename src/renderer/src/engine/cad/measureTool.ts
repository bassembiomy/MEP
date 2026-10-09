import type { CadKnownUnit } from '../dxfParser'

const UNITS: CadKnownUnit[] = ['mm', 'cm', 'dm', 'm', 'in', 'ft', 'yd']
const ALIASES: Record<string, CadKnownUnit> = { '"': 'in', inch: 'in', inches: 'in', "'": 'ft', foot: 'ft', feet: 'ft', meter: 'm', meters: 'm', metre: 'm', metres: 'm', millimeter: 'mm', millimeters: 'mm', centimeter: 'cm', centimeters: 'cm' }

/** Parse "3.5 m", "12ft", "250" (with a default unit) into a calibration length. */
export function parseKnownLength(text: string, defaultUnit: CadKnownUnit): { ok: true; length: number; unit: CadKnownUnit } | { ok: false; error: string } {
  const m = /^\s*([0-9]*\.?[0-9]+(?:e[+-]?\d+)?)\s*([a-z"']*)\s*$/i.exec(text)
  if (!m) return { ok: false, error: 'Enter a length such as 3.5 m, 12 ft or 250 mm.' }
  const length = Number(m[1])
  if (!(length > 0) || !Number.isFinite(length)) return { ok: false, error: 'Length must be greater than zero.' }
  const raw = m[2].toLowerCase()
  const unit: CadKnownUnit | undefined = raw === '' ? defaultUnit : ALIASES[raw] ?? ((UNITS as string[]).includes(raw) ? (raw as CadKnownUnit) : undefined)
  if (!unit) return { ok: false, error: `Unknown unit "${m[2]}". Use mm, cm, dm, m, in, ft or yd.` }
  return { ok: true, length, unit }
}

export const measuredDistance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y)

/** Text for the confirmation step so the user sees what will change before the scale is rewritten. */
export function describeCalibration(drawn: number, length: number, unit: CadKnownUnit): string {
  return `The picked segment is ${drawn.toPrecision(6)} drawing units and will be set to ${length} ${unit}. This rewrites the drawing scale, confirms the units and marks every room stale.`
}
