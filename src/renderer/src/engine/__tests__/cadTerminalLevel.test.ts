import { describe, expect, it } from 'vitest'
import { findCadTerminalPositions } from '../diffuserPlacer'

const zone = [0, 0, 400, 0, 400, 400, 0, 400]
const circle = (x: number, y: number, elevation?: number) => ({
  type: 'CIRCLE', layer: 'M-HVAC-DIFF', x, y, radius: 8, ...(elevation === undefined ? {} : { elevation })
})

describe('findCadTerminalPositions level filtering', () => {
  it('ignores terminal symbols on another level by default', () => {
    const entities = [circle(100, 100), circle(300, 300, 3000)]
    expect(findCadTerminalPositions(zone, entities, 'concealed')).toEqual([{ x: 100, y: 100, label: 'Diffuser' }])
  })
  it('reads the selected level when one is given', () => {
    const entities = [circle(100, 100), circle(300, 300, 3000)]
    expect(findCadTerminalPositions(zone, entities, 'concealed', 8, 0, 3000)).toEqual([{ x: 300, y: 300, label: 'Diffuser' }])
  })
  it('returns nothing when every symbol is on another level', () => {
    expect(findCadTerminalPositions(zone, [circle(100, 100, 3000)], 'concealed')).toEqual([])
  })
})
