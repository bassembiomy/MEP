import type { CadImportMetadata } from '../../store/projectStore'

/** Import diagnostics that make even declared units doubtful enough to need the user's explicit confirmation. */
export const UNITS_DOUBT_CODES: readonly string[] = ['declared-implausible', 'units-measurement-conflict']

/**
 * May the drawing units be treated as confirmed without a user action? Only when the file declared them
 * ($INSUNITS) and nothing contradicts that. Estimated or unknown units, or declared units that look implausible
 * or disagree with $MEASUREMENT, always require an explicit confirmation or a calibration.
 */
export function unitsAutoConfirmed(metadata: Pick<CadImportMetadata, 'unitsConfidence' | 'diagnostics'>): boolean {
  return metadata.unitsConfidence === 'declared' && !metadata.diagnostics.some((d) => UNITS_DOUBT_CODES.includes(d.code))
}

export interface UnitsStatusView {
  confirmed: boolean
  /** One line for the UI. */
  label: string
  /** Why explicit confirmation or calibration is needed (empty when none is). */
  reasons: string[]
}

/** Plain-language status of the drawing units for the CAD panel. */
export function describeUnitsStatus(
  project: { cadUnitsConfirmed?: boolean; cadScaleProvenance?: 'user-calibrated' },
  cadImport: Pick<CadImportMetadata, 'unitsConfidence' | 'diagnostics'> | null
): UnitsStatusView {
  // No recorded decision: a declared, undoubted import counts as confirmed (as at import time); anything else does not.
  const confirmed = project.cadUnitsConfirmed ?? (cadImport ? unitsAutoConfirmed(cadImport) : false)
  const reasons: string[] = []
  if (cadImport) {
    if (cadImport.unitsConfidence === 'estimated') reasons.push('The file does not declare its units; they were estimated from the drawing size.')
    if (cadImport.unitsConfidence === 'unknown') reasons.push('The file has no usable unit declaration.')
    for (const d of cadImport.diagnostics) if (UNITS_DOUBT_CODES.includes(d.code)) reasons.push(d.message)
  }
  if (project.cadScaleProvenance === 'user-calibrated') return { confirmed: true, label: 'Scale calibrated from a known length.', reasons: [] }
  if (confirmed) return { confirmed: true, label: cadImport?.unitsConfidence === 'declared' ? 'Units declared in the file and confirmed.' : 'Units confirmed by you.', reasons: [] }
  if (project.cadUnitsConfirmed === undefined && !cadImport) return { confirmed: false, label: 'Units were never confirmed for this project: confirm the scale before relying on CAD-derived suggestions.', reasons }
  return { confirmed: false, label: 'Units not confirmed: confirm them or calibrate the scale before approving anything.', reasons }
}
