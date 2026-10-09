import { beforeEach, describe, expect, it } from 'vitest'
import { parseDxfText } from '../dxfParser'
import { useProjectStore } from '../../store/projectStore'
import { exportProjectDxf } from '../export/exportDxf'
import { circle, dxf, header, layer, line, lwpolyline, block, insert, arc } from './fixtures/dxfBuilder'

const W = 'A-WALL'
function drawing() {
  const walls = [line(W, 0, 0, 8, 0), line(W, 11, 0, 20, 0), line(W, 20, 0, 20, 15), line(W, 20, 15, 0, 15), line(W, 0, 15, 0, 0)]
  const door = block('DOOR-3', line('0', 0, 0, 0, 3) + '\n' + arc('0', 0, 0, 3, 0, 90))
  return parseDxfText(dxf({
    header: header({ insunits: 2 }), layers: [W, 'A-DOOR', 'S-COLS', '0'].map(layer), blocks: [door],
    entities: [...walls, insert('A-DOOR', 'DOOR-3', 8, 0), lwpolyline('S-COLS', [[10, 5], [11.5, 5], [11.5, 6.5], [10, 6.5]], true), circle('S-COLS', 15, 10, 0.8)]
  }))
}
const s = () => useProjectStore.getState()
beforeEach(() => {
  useProjectStore.getState().clearDxfData()
  useProjectStore.setState({ project: { name: 'P', location: 'L', units: 'imperial', scale: 1, outdoorDb: 95, indoorDb: 75 }, zones: [], undoStack: [], redoStack: [] })
  const p = drawing()
  s().setDxfData(p.entities, p.bbox, p.suggestedScaleImperial, p.cadUnit,
    { sourceName: 't.dxf', unitsConfidence: p.unitsConfidence ?? 'unknown', diagnostics: p.diagnostics ?? [] }, p.blockReferences)
  s().setCadLayerRole('S-COLS', 'column')
  useProjectStore.setState({ undoStack: [], redoStack: [] })
  s().setProject({ cadUnitsConfirmed: true })
})

describe('decided CAD items survive a scale change (R1)', () => {
  it('does not duplicate an approved or rejected obstacle after setProject({scale})', () => {
    const [a, b] = s().cadObstacles
    expect(s().approveCadObstacle(a.id, 1).success).toBe(true)
    expect(s().rejectCadObstacle(b.id).success).toBe(true)
    s().setProject({ scale: 2 })
    expect(s().cadObstacles).toHaveLength(2)
    expect(s().cadObstacles.map(o => o.status).sort()).toEqual(['approved', 'rejected'])
    expect(s().cadObstacles.find(o => o.status === 'approved')?.id).toBe(a.id)
  })
  it('does not duplicate after calibration either', () => {
    const [a, b] = s().cadObstacles
    s().approveCadObstacle(a.id, 1); s().rejectCadObstacle(b.id)
    expect(s().calibrateScaleFromPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 50, 'ft').success).toBe(true)
    expect(s().cadObstacles).toHaveLength(2)
    expect(s().cadObstacles.map(o => o.status).sort()).toEqual(['approved', 'rejected'])
  })
  it('rescales the ft fields of decided items and keeps the decision', () => {
    const door = s().cadOpenings.find(o => o.kind === 'door')!
    const col = s().cadObstacles[0]
    expect(s().approveCadOpening(door.id).success).toBe(true)
    s().approveCadObstacle(col.id, 1)
    const w0 = door.widthFt
    s().setProject({ scale: 2 })
    const door2 = s().cadOpenings.find(o => o.id === door.id)!
    expect(door2.status).toBe('approved')
    expect(door2.widthFt).toBeCloseTo(w0 / 2, 9)
    const col2 = s().cadObstacles.find(o => o.id === col.id)!
    expect(col2.widthFt).toBeCloseTo(col.widthFt / 2, 9)
    expect(col2.depthFt).toBeCloseTo(col.depthFt / 2, 9)
    expect(col2.clearanceFt).toBe(1)
  })
  it('the export tag of an approved door shows the width at the new scale, not 0.0 ft', () => {
    const door = s().cadOpenings.find(o => o.kind === 'door')!
    s().approveCadOpening(door.id)
    s().setProject({ scale: 1000 })
    const d2 = s().cadOpenings.find(o => o.id === door.id)!
    expect(d2.widthFt).toBeCloseTo(door.widthFt / 1000, 9)
    s().setProject({ scale: 0.5 })
    const out = exportProjectDxf({ project: s().project, zones: [], dxfEntities: s().dxfEntities, cadOpenings: s().cadOpenings, cadObstacles: s().cadObstacles })
    expect(out.text).toContain(`approved door, ${(door.widthFt * 2).toFixed(1)} ft`)
  })
})

describe('undo/redo keep suggestions consistent with the restored scale (R5)', () => {
  it('undoing an earlier non-CAD action after a scale edit restores suggestions at the restored scale', () => {
    expect(s().addZone([100, 100, 200, 100, 200, 200, 100, 200, 100, 150]).success).toBe(true)
    expect(s().deleteZoneVertex(s().zones[0].id, 4).success).toBe(true) // a zone edit pushes a snapshot without the cad part
    expect(s().undoStack.length).toBeGreaterThan(0)
    expect(s().undoStack[s().undoStack.length - 1].cad).toBeUndefined()
    const before = s().cadOpenings.map(o => [o.id, o.widthFt])
    const unsuggestedBefore = s().cadObstacles.map(o => o.widthFt)
    s().setProject({ scale: 2 })
    expect(s().cadObstacles.map(o => o.widthFt)).not.toEqual(unsuggestedBefore)
    s().undo()
    expect(s().project.scale).toBe(1)
    expect(s().cadObstacles.map(o => o.widthFt)).toEqual(unsuggestedBefore)
    expect(s().cadOpenings.map(o => [o.id, o.widthFt])).toEqual(before)
    s().redo()
    expect(s().project.scale).toBe(2)
    expect(s().cadObstacles.map(o => o.widthFt)).not.toEqual(unsuggestedBefore)
    expect(s().cadObstacles[0].widthFt).toBeCloseTo(unsuggestedBefore[0] / 2, 9)
  })
})
