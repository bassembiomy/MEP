import { describe, expect, it } from 'vitest'
import * as zoning from '../adapters/zoningAdapter'

describe('authoritative engineering geometry inputs', () => {
  it.each([
    ['NaN', [0, 0, NaN, 0, 10, 10]],
    ['Infinity', [0, 0, Infinity, 0, 10, 10]],
    ['odd coordinate count', [0, 0, 10, 0, 10, 10, 0]],
    ['zero area', [0, 0, 5, 5, 10, 10]],
    ['crossed edges with nonzero signed area', [0, 0, 10, 10, 0, 10, 8, 0]],
    ['repeated interior vertex', [0, 0, 10, 0, 10, 10, 0, 0, 0, 10]],
    ['overlapping adjacent edges', [0, 0, 10, 0, 5, 0, 5, 10, 0, 10]]
  ])('rejects %s', (_name, points) => {
    const result = zoning.adaptZoneGeometry('bad', points)
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
    expect(result.areaSqFt).toBe(0)
  })

  it('retains area and perimeter precision for a small room', () => {
    const result = zoning.adaptZoneGeometry('small', [0, 0, 0.1, 0, 0.1, 0.1, 0, 0.1])
    expect(result.valid).toBe(true)
    expect(result.areaSqFt).toBeCloseTo(0.01, 12)
    expect(result.perimeterFt).toBeCloseTo(0.4, 12)
  })

  it('accepts a concave polygon with a repeated closing vertex', () => {
    const result = zoning.adaptZoneGeometry('L', [0, 0, 4, 0, 4, 2, 2, 2, 2, 4, 0, 4, 0, 0])
    expect(result.valid).toBe(true)
    expect(result.areaSqFt).toBe(12)
    expect(result.perimeterFt).toBe(16)
    expect(result.centroid.x).toBeCloseTo(1.666666666667, 10)
  })

  it('exports the physical polygon normalization boundary', () => {
    expect(typeof zoning.normalizePolygonToFeet).toBe('function')
  })

  it('normalizes a ten-meter square without rounding away area', () => {
    const result = zoning.adaptZoneGeometry(
      'metric',
      zoning.normalizePolygonToFeet([0, 0, 10, 0, 10, 10, 0, 10], 'metric')
    )
    expect(result.areaSqFt).toBeCloseTo(1076.39104167097, 8)
    expect(result.perimeterFt).toBeCloseTo(131.233595800525, 8)
  })

  it.each([
    ['imperial', 10, [0, 0, 100, 0, 100, 100, 0, 100]],
    ['metric', 1000, [0, 0, 3048, 0, 3048, 3048, 0, 3048]]
  ] as const)('normalizes scaled %s drawing coordinates', (units, scale, points) => {
    const result = zoning.adaptZoneGeometry(
      'scaled',
      zoning.normalizePolygonToFeet([...points], units, scale)
    )
    expect(result.areaSqFt).toBeCloseTo(100, 10)
    expect(result.perimeterFt).toBeCloseTo(40, 10)
  })

  it.each([0, -1, NaN, Infinity])('rejects nonpositive or nonfinite scale %s', (scale) => {
    expect(() =>
      zoning.normalizePolygonToFeet([0, 0, 10, 0, 10, 10, 0, 10], 'imperial', scale)
    ).toThrow(/scale/i)
  })

  it.each([0, -1, NaN, Infinity])('rejects invalid ceiling height %s', (height) => {
    expect(zoning.adaptZoneGeometry('bad height', [0, 0, 10, 0, 10, 10, 0, 10], height).valid).toBe(
      false
    )
  })
})
