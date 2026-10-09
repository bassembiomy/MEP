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
