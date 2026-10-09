import { describe, expect, it } from 'vitest'
import { calculatePolygonArea } from '../geometry'
import { isSegmentInPolygon } from '../validation/spatialValidator'
import { clipPolygonToRect, clipComesOutInPieces, partitionPolygonByArea } from '../polygonClip'

const L = [0, 0, 300, 0, 300, 150, 150, 150, 150, 300, 0, 300] // area 67500
const U = [0, 0, 300, 0, 300, 300, 200, 300, 200, 100, 100, 100, 100, 300, 0, 300] // area 60000, opens upward
// Comb: spine along the bottom with three teeth pointing up (area 52500). Horizontal cuts split the top slab into three pieces.
const E = [0, 0, 300, 0, 300, 300, 250, 300, 250, 50, 175, 50, 175, 300, 125, 300, 125, 50, 50, 50, 50, 300, 0, 300]
const rect = (minX: number, maxX: number, minY: number, maxY: number) => ({ minX, maxX, minY, maxY })

describe('Sutherland-Hodgman polygon clip', () => {
  it.each([
    ['vertical slab through both arms', rect(100, 200, 0, 300), 22500],
    ['window cutting the notch corner', rect(0, 200, 100, 300), 32500],
    ['window containing the polygon', rect(-10, 400, -10, 400), 67500],
    ['window lying wholly in the notch', rect(200, 300, 200, 300), 0]
  ])('clips the L-shape to the exact area: %s', (_n, r, area) => {
    expect(calculatePolygonArea(clipPolygonToRect(L, r))).toBeCloseTo(area, 6)
  })

  it('detects a clip that comes out in two pieces and still reports the true area', () => {
    const arms = rect(0, 300, 150, 300)
    expect(clipComesOutInPieces(U, arms)).toBe(true)
    expect(calculatePolygonArea(clipPolygonToRect(U, arms))).toBeCloseTo(2 * 100 * 150, 6)
    expect(clipComesOutInPieces(U, rect(0, 300, 0, 150))).toBe(false)
    expect(clipComesOutInPieces(L, rect(0, 300, 100, 300))).toBe(false)
  })
})

describe('area-bisection partition', () => {
  const total = (p: number[]) => calculatePolygonArea(p)
  const insideRoom = (sub: number[], room: number[]) => {
    for (let i = 0; i < sub.length; i += 2) {
      const j = (i + 2) % sub.length
      if (!isSegmentInPolygon({ x: sub[i], y: sub[i + 1] }, { x: sub[j], y: sub[j + 1] }, room)) return false
    }
    return true
  }
  it.each([[L, 2], [L, 3], [L, 4], [U, 3]])('splits into equal-area contained sub-polygons (%#)', (poly, qty) => {
    const res = partitionPolygonByArea(poly, qty)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.parts.length).toBe(qty)
    const want = total(poly) / qty
    for (const part of res.parts) {
      expect(Math.abs(total(part) - want) / want).toBeLessThan(0.01)
      expect(insideRoom(part, poly)).toBe(true)
    }
    expect(res.parts.reduce((s, p) => s + total(p), 0)).toBeCloseTo(total(poly), 4)
  })
  it('falls back to the other axis when the first axis splits a slab into pieces', () => {
    const res = partitionPolygonByArea(E, 2)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.axis).toBe('x')
      for (const part of res.parts) expect(Math.abs(total(part) - total(E) / 2) / (total(E) / 2)).toBeLessThan(0.01)
    }
  })
  it('keeps the polygon whole for one unit and rejects degenerate input', () => {
    const one = partitionPolygonByArea(L, 1)
    expect(one.ok && one.parts[0]).toEqual(L)
    expect(partitionPolygonByArea([0, 0, 10, 0], 2).ok).toBe(false)
    expect(partitionPolygonByArea(L, 0).ok).toBe(false)
  })
})
