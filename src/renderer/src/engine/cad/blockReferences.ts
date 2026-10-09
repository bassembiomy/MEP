import type { CadAffineMatrix } from './nativeGeometry'

/**
 * Decomposes a composed canvas transform (Y already reflected) into INSERT placement terms.
 * `base` is the block base point in the block's own (already reflected) coordinates.
 * Convention: scaleX > 0; a negative determinant is reported as scaleY < 0 / mirrored.
 */
export function describeInsertTransform(m: CadAffineMatrix, base: { x: number; y: number } = { x: 0, y: 0 }) {
  // Canvas = F * raw * F with F = diag(1,-1): raw a=a, b=-b, c=-c, d=d.
  const ar = m.a, br = -m.b, cr = -m.c, dr = m.d
  const scaleX = Math.hypot(ar, br)
  const det = ar * dr - br * cr
  const scaleY = scaleX === 0 ? 0 : det / scaleX
  const rotation = (Math.atan2(br, ar) * 180) / Math.PI
  return {
    insertion: { x: m.a * base.x + m.c * base.y + m.tx, y: m.b * base.x + m.d * base.y + m.ty },
    rotationDeg: ((rotation % 360) + 360) % 360,
    scaleX,
    scaleY,
    mirrored: det < 0
  }
}
