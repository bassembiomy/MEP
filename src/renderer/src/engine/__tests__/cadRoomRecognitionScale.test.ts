import { describe, expect, it } from 'vitest'
import type { DxfEntity } from '../../store/projectStore'
import { recognizeCadRooms } from '../cad/roomRecognition'

const FT_PER_M = 1 / 0.3048
const line = (x: number, y: number, ex: number, ey: number, i: number): DxfEntity =>
  ({ type: 'LINE', x, y, points: [ex, ey], layer: 'WALL', handle: `L${i}` })
/** A rectangle drawn as four loose wall lines (a face of the line graph, like the gap between a wall's two faces). */
const strip = (w: number, h: number, x0 = 0, y0 = 0): DxfEntity[] => [
  line(x0, y0, x0 + w, y0, 0), line(x0 + w, y0, x0 + w, y0 + h, 1), line(x0 + w, y0 + h, x0, y0 + h, 2), line(x0, y0 + h, x0, y0, 3)
]
const options = { drawingUnitsPerFoot: 1, layers: ['WALL'] }

describe('thick walls and slivers are not room candidates', () => {
  it('rejects a 400 mm x 5 m wall body between two openings', () => {
    const r = recognizeCadRooms(strip(0.4 * FT_PER_M, 5 * FT_PER_M), options)
    expect(r.candidates).toHaveLength(0)
    expect(r.diagnostics.map(d => d.code)).toContain('wall-body-excluded')
  })
  it('rejects a 600 mm x 5 m slender wall / duct shaft by elongation, not only by width', () => {
    const r = recognizeCadRooms(strip(0.6 * FT_PER_M, 5 * FT_PER_M), options)
    expect(r.candidates).toHaveLength(0)
    expect(r.diagnostics.map(d => d.code)).toContain('wall-body-excluded')
  })
  it('keeps a 3 ft wide corridor, a 2 ft x 8 ft closet and a 2.5 ft x 10 ft closet', () => {
    expect(recognizeCadRooms(strip(3, 60), options).candidates).toHaveLength(1)
    expect(recognizeCadRooms(strip(2.5, 10), options).candidates).toHaveLength(1)
    expect(recognizeCadRooms(strip(2.5, 8), options).candidates).toHaveLength(1)
  })
})

describe('recognition on large stacked plans', () => {
  // 5 floors drawn one above the other (same x range), 80 rooms per floor, 5000 texts in all.
  const build = () => {
    const entities: DxfEntity[] = []
    let n = 0
    for (let floor = 0; floor < 5; floor++)
      for (let row = 0; row < 8; row++)
        for (let col = 0; col < 10; col++) {
          const x0 = col * 20, y0 = floor * 1000 + row * 20
          entities.push({ type: 'LWPOLYLINE', closed: true, layer: 'WALL', handle: `R${n}`, points: [x0, y0, x0 + 15, y0, x0 + 15, y0 + 15, x0, y0 + 15] })
          entities.push({ type: 'TEXT', layer: 'A-ANNO', handle: `T${n}`, x: x0 + 3, y: y0 + 7, textHeight: 1, text: `ROOM ${n}` })
          n++
        }
    for (let i = 0; i < 4600; i++)
      entities.push({ type: 'TEXT', layer: 'A-ANNO', handle: `N${i}`, x: (i * 37) % 200 + 16, y: Math.floor(i / 200) * 40 + 17, textHeight: 0.5, text: `NOTE ${i}` })
    return entities
  }
  it('returns every room with its label within the work budget', () => {
    const start = Date.now()
    const r = recognizeCadRooms(build(), options)
    expect(r.diagnostics.map(d => d.code)).not.toContain('recognition-budget-exceeded')
    expect(r.candidates).toHaveLength(400)
    expect(r.candidates.filter(c => /^ROOM \d+$/.test(c.name ?? '')).length).toBe(400)
    expect(Date.now() - start).toBeLessThan(5000)
  })
})
