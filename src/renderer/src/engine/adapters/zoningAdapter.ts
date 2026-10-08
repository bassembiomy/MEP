import { METERS_PER_FOOT, measureSimplePolygon, requirePositive } from '../engineeringInputs'

export interface ZoneGeometryResult {
  valid: boolean
  areaSqFt: number
  perimeterFt: number
  centroid: { x: number; y: number }
  boundingBox: {
    minX: number
    maxX: number
    minY: number
    maxY: number
    width: number
    height: number
  }
  error?: string
}

/** Scale is drawing units per meter (metric) or per foot (imperial). */
export function normalizePolygonToFeet(
  polygon: number[],
  units: 'imperial' | 'metric',
  drawingUnitsPerLength: number = 1
): number[] {
  requirePositive('Drawing scale', drawingUnitsPerLength)
  if (units !== 'imperial' && units !== 'metric') throw new RangeError('Unknown drawing units')
  measureSimplePolygon(polygon)
  const divisor = drawingUnitsPerLength * (units === 'metric' ? METERS_PER_FOOT : 1)
  requirePositive('Physical drawing scale', divisor)
  const normalized = polygon.map((coordinate) => coordinate / divisor)
  measureSimplePolygon(normalized)
  return normalized
}

/** Coordinates and ceiling height at this boundary must already be in feet. */
export function adaptZoneGeometry(
  _roomName: string,
  polygon: number[],
  ceilingHeightFt: number = 10
): ZoneGeometryResult {
  try {
    requirePositive('Ceiling height', ceilingHeightFt)
    const geometry = measureSimplePolygon(polygon)
    return {
      valid: true,
      areaSqFt: geometry.area,
      perimeterFt: geometry.perimeter,
      centroid: geometry.centroid,
      boundingBox: geometry.boundingBox
    }
  } catch (error) {
    return {
      valid: false,
      areaSqFt: 0,
      perimeterFt: 0,
      centroid: { x: 0, y: 0 },
      boundingBox: { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 },
      error: error instanceof Error ? error.message : 'Invalid polygon geometry'
    }
  }
}
