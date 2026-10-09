import { describe, expect, it } from 'vitest'
import type { DxfEntity } from '../../store/projectStore'
import { recognizeCadRooms } from '../cad/roomRecognition'
import { isLevelAnnotation } from '../cad/levelAnnotations'

const room = (x0: number, y0: number, x1: number, y1: number, handle: string): DxfEntity =>
  ({ type: 'LWPOLYLINE', points: [x0, y0, x1, y0, x1, y1, x0, y1], closed: true, layer: 'A-AREA', handle })
const text = (x: number, y: number, value: string, h = 1, type: 'TEXT' | 'MTEXT' = 'TEXT'): DxfEntity =>
  ({ type, x, y, text: value, textHeight: h, layer: 'TXT', handle: `${value}@${x},${y}` })
const names = (entities: DxfEntity[]) =>
  recognizeCadRooms(entities, { drawingUnitsPerFoot: 1, layers: ['A-AREA'] }).candidates.map(c => c.name)

describe('room name selection', () => {
  it('normalises MTEXT formatting codes', () => {
    expect(names([room(0, 0, 20, 15, 'R'), text(10, 7, '{\\fArial|b1;OFFICE 1}', 1, 'MTEXT')])).toEqual(['OFFICE 1'])
  })
  it('ignores level notes, pure numbers and door / window tags', () => {
    const labels = ['CH 2700', 'C.H. = 2.70 m', "CLG HT 9'-0\"", 'FFL +0.00', '12', '3.5', 'D01', 'W2', 'D-1'].map((t, i) => text(2 + i, 3, t, 5))
    const r = recognizeCadRooms([room(0, 0, 20, 15, 'R'), ...labels, text(10, 7, 'KITCHEN', 0.5)], { drawingUnitsPerFoot: 1, layers: ['A-AREA'] })
    expect(r.candidates[0].name).toBe('KITCHEN')
    expect(r.candidates[0].unresolvedConditions.join()).not.toMatch(/Multiple interior text labels/)
  })
  it('prefers the largest text, then the most central, then alphabetical', () => {
    const base = room(0, 0, 20, 20, 'R')
    expect(names([base, text(10, 10, 'SMALL', 1), text(2, 2, 'BIG', 3)])).toEqual(['BIG'])
    expect(names([base, text(2, 2, 'EDGE', 2), text(10, 10, 'MIDDLE', 2)])).toEqual(['MIDDLE'])
    expect(names([base, text(9, 10, 'BRAVO', 2), text(11, 10, 'ALPHA', 2)])).toEqual(['ALPHA'])
  })
  it('only labels the room that contains the text', () => {
    expect(names([room(0, 0, 10, 10, 'A'), room(20, 0, 30, 10, 'B'), text(25, 5, 'LAB')]).sort()).toEqual(['LAB', 'Room'])
  })
  it('isLevelAnnotation recognises the level notes but not room names', () => {
    for (const t of ['CH 2700', 'C.H. = 2.70 m', "CLG HT 9'-0\"", 'ارتفاع السقف 2.80', 'SOFFIT 3200']) expect(isLevelAnnotation(t), t).toBe(true)
    for (const t of ['OFFICE 1', 'CHILLER ROOM', 'MEETING']) expect(isLevelAnnotation(t), t).toBe(false)
  })
})

describe('room label work accounting', () => {
  it('recognises 60 rooms among 30,000 texts (cost scales with texts examined, not rooms x entities)', () => {
    const entities: DxfEntity[] = []
    for (let i = 0; i < 60; i++) {
      entities.push(room(i * 30, 0, i * 30 + 20, 15, `R${i}`), text(i * 30 + 10, 7, `ROOM ${i}`, 2))
    }
    for (let i = 0; i < 29_940; i++) entities.push(text(i * 0.37, 100, `X${i}`, 1))
    const r = recognizeCadRooms(entities, { drawingUnitsPerFoot: 1, layers: ['A-AREA'] })
    expect(r.diagnostics.map(d => d.code)).not.toContain('recognition-budget-exceeded')
    expect(r.candidates).toHaveLength(60)
    expect(r.candidates.every(c => /^ROOM \d+$/.test(c.name ?? ''))).toBe(true)
  })
  it('still has a real guard: a huge entity count stops with recognition-budget-exceeded', () => {
    const entities: DxfEntity[] = [room(0, 0, 20, 15, 'R')]
    for (let i = 0; i < 210_000; i++) entities.push(text(i, 100, 'X', 1))
    const r = recognizeCadRooms(entities, { drawingUnitsPerFoot: 1, layers: ['A-AREA'] })
    expect(r.diagnostics.map(d => d.code)).toContain('recognition-budget-exceeded')
    expect(r.candidates).toEqual([])
  })
})

describe('double-line walls (path B)', () => {
  const ln = (x0: number, y0: number, x1: number, y1: number, i: number): DxfEntity =>
    ({ type: 'LINE', x: x0, y: y0, points: [x1, y1], layer: 'WALL', handle: `L${i}` })
  // Two 20 x 15 ft rooms either side of a 0.5 ft double-line partition (faces y=15 and y=15.5) with a 3 ft door gap
  // (x 8..11) closed by jamb caps; the door is approved at the middle of the wall thickness.
  const walls: DxfEntity[] = [
    ln(0, 0, 20, 0, 1), ln(0, 30.5, 20, 30.5, 2), ln(0, 0, 0, 30.5, 3), ln(20, 0, 20, 30.5, 4),
    ln(0, 15, 8, 15, 5), ln(11, 15, 20, 15, 6), ln(0, 15.5, 8, 15.5, 7), ln(11, 15.5, 20, 15.5, 8),
    ln(8, 15, 8, 15.5, 9), ln(11, 15, 11, 15.5, 10)
  ]
  const run = (approve: boolean) => recognizeCadRooms(walls, {
    drawingUnitsPerFoot: 1, layers: ['WALL'],
    approvedOpenings: approve ? [{ id: 'D1', a: { x: 8, y: 15.25 }, b: { x: 11, y: 15.25 } }] : []
  })
  it('an approved opening closes both faces: each room is exactly its clear area, no jamb pocket in either', () => {
    const areas = run(true).candidates.map(c => c.areaSqFt).sort()
    expect(areas).toHaveLength(2)
    for (const a of areas) expect(a).toBeCloseTo(300, 6)
  })
  it('without the approved opening the two rooms stay merged (nothing is bridged on its own)', () => {
    const r = run(false)
    expect(r.candidates).toHaveLength(1)
    expect(r.candidates[0].areaSqFt).toBeGreaterThan(600)
  })
  it('rejects the body of a wall between its two face lines, with a diagnostic', () => {
    const strip = [ln(0, 0, 60, 0, 1), ln(60, 0, 60, 0.5, 2), ln(60, 0.5, 0, 0.5, 3), ln(0, 0.5, 0, 0, 4)]
    const r = recognizeCadRooms(strip, { drawingUnitsPerFoot: 1, layers: ['WALL'] })
    expect(r.candidates).toEqual([])
    expect(r.diagnostics.map(d => d.code)).toContain('wall-body-excluded')
  })
  it('keeps a narrow but real room (3 ft wide corridor)', () => {
    const corridor = [ln(0, 0, 30, 0, 1), ln(30, 0, 30, 3, 2), ln(30, 3, 0, 3, 3), ln(0, 3, 0, 0, 4)]
    expect(recognizeCadRooms(corridor, { drawingUnitsPerFoot: 1, layers: ['WALL'] }).candidates).toHaveLength(1)
  })
})
