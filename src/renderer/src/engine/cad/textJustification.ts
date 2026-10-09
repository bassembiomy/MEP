import type { DxfEntity } from '../../store/projectStore';

/**
 * TEXT / MTEXT justification.
 *
 * The anchor stored in DxfEntity.x/y is the point the text is justified about, so an entity with a non-default
 * justification is drawn and recognised where the drawing shows it. Sources:
 *  - TEXT / ATTRIB / ATTDEF: group 11 (the alignment point) when horizontal justification (72) is Center, Right or Middle
 *    or the vertical justification (73 for TEXT, 74 for ATTRIB/ATTDEF) is non-zero; the MIDPOINT of 10 and 11 for Aligned
 *    and Fit (72 = 3, 5); otherwise group 10. Aligned/Fit lose their fitted width and their direction (the rotation is the
 *    stored group 50, not the 10 -> 11 direction); the midpoint is the centre/baseline of the fitted text.
 *  - MTEXT: group 10 is always the anchor; group 71 (attachment 1..9) names the justification about it.
 */
export type TextHAlign = 'left' | 'center' | 'right';
export type TextVAlign = 'baseline' | 'bottom' | 'middle' | 'top';
export type TextAnchorSource = 'p10' | 'p11' | 'mid';

export interface DxfTextJustification { hAlign: TextHAlign; vAlign: TextVAlign; anchor: TextAnchorSource; invalid: boolean }

const H_BY_CODE: TextHAlign[] = ['left', 'center', 'right'];
const V_BY_CODE: TextVAlign[] = ['baseline', 'bottom', 'middle', 'top'];

/** Decode DXF/DWG TEXT group 72 (horizontal) and 73/74 (vertical). Out-of-range or non-integer codes give left/baseline + `invalid`. */
export function dxfTextJustification(h: number, v: number): DxfTextJustification {
  const hOk = Number.isInteger(h) && h >= 0 && h <= 5, vOk = Number.isInteger(v) && v >= 0 && v <= 3;
  if (!hOk || !vOk) return { hAlign: 'left', vAlign: 'baseline', anchor: 'p10', invalid: true };
  // Aligned / Fit: both points are on the baseline; the displayed text is centred between them.
  if (h === 3 || h === 5) return { hAlign: 'center', vAlign: 'baseline', anchor: 'mid', invalid: false };
  // Middle (72 = 4) is centred horizontally and vertically.
  if (h === 4) return { hAlign: 'center', vAlign: 'middle', anchor: 'p11', invalid: false };
  return { hAlign: H_BY_CODE[h], vAlign: V_BY_CODE[v], anchor: h !== 0 || v !== 0 ? 'p11' : 'p10', invalid: false };
}

const MTEXT_H: TextHAlign[] = ['left', 'center', 'right'];
const MTEXT_V: TextVAlign[] = ['top', 'middle', 'bottom'];

/** MTEXT attachment point (group 71, 1..9: TL TC TR ML MC MR BL BC BR); null when out of range. */
export function mtextAttachment(code: number): { hAlign: TextHAlign; vAlign: TextVAlign } | null {
  if (!Number.isInteger(code) || code < 1 || code > 9) return null;
  return { hAlign: MTEXT_H[(code - 1) % 3], vAlign: MTEXT_V[Math.floor((code - 1) / 3)] };
}
/** Inverse of mtextAttachment. MTEXT has no baseline; baseline is written as bottom. */
export function mtextAttachmentCode(hAlign: TextHAlign, vAlign: TextVAlign): number {
  const row = vAlign === 'top' ? 0 : vAlign === 'middle' ? 1 : 2;
  return row * 3 + MTEXT_H.indexOf(hAlign) + 1;
}

/** TEXT group 72 / 73 for a justification. 72 = 4 (Middle) and 73 = 2 with 72 = 1 both decode to centre/middle; export uses the latter. */
export function dxfTextCodes(hAlign: TextHAlign, vAlign: TextVAlign): { 72: number; 73: number } {
  return { 72: H_BY_CODE.indexOf(hAlign), 73: V_BY_CODE.indexOf(vAlign) };
}

export const defaultTextJustification = (type: DxfEntity['type']): { hAlign: TextHAlign; vAlign: TextVAlign } =>
  ({ hAlign: 'left', vAlign: type === 'MTEXT' ? 'top' : 'baseline' });

/** Fields to spread into a DxfEntity: only the values that differ from the type's default. */
export function storedJustification(type: DxfEntity['type'], hAlign: TextHAlign, vAlign: TextVAlign): Pick<DxfEntity, 'textHAlign' | 'textVAlign'> {
  const d = defaultTextJustification(type);
  return { ...(hAlign !== d.hAlign ? { textHAlign: hAlign } : {}), ...(vAlign !== d.vAlign ? { textVAlign: vAlign } : {}) };
}

export function resolvedJustification(ent: Pick<DxfEntity, 'type' | 'textHAlign' | 'textVAlign'>): { hAlign: TextHAlign; vAlign: TextVAlign } {
  const d = defaultTextJustification(ent.type);
  return { hAlign: ent.textHAlign ?? d.hAlign, vAlign: ent.textVAlign ?? d.vAlign };
}

/** Canvas 2D textAlign / textBaseline for an entity's justification. */
export function canvasTextStyle(ent: Pick<DxfEntity, 'type' | 'textHAlign' | 'textVAlign'>): { textAlign: 'left' | 'center' | 'right'; textBaseline: 'alphabetic' | 'bottom' | 'middle' | 'top' } {
  const { hAlign, vAlign } = resolvedJustification(ent);
  return { textAlign: hAlign, textBaseline: vAlign === 'baseline' ? 'alphabetic' : vAlign };
}
