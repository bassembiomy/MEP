import { describe, expect, it } from 'vitest'
import { exportProjectDxf } from '../export/exportDxf'
import { parseDxfText } from '../dxfParser'
import type { ProjectMetadata } from '../../store/projectStore'
import type { StoredCadObstacle, StoredCadOpening } from '../cad/cadSemanticState'

const project: ProjectMetadata = { name: 'Cairo', location: 'Egypt', units: 'imperial', scale: 10, cadUnit: 'ft', cadUnitsConfirmed: true, outdoorDb: 95, indoorDb: 75 }
const opening = (id: string, status: StoredCadOpening['status'], x0: number): StoredCadOpening => ({
  id, kind: 'door', origin: 'wall-gap', center: { x: (x0 + x0 + 30) / 2, y: -20 }, span: { a: { x: x0, y: -20 }, b: { x: x0 + 30, y: -20 } }, widthFt: 3,
  adjacentRoomIds: [], sourceHandles: ['H'], confidence: 0.5, evidence: ['gap'], status, level: 0
})
const obstacle = (id: string, status: StoredCadObstacle['status'], clearanceFt?: number): StoredCadObstacle => ({
  id, shape: 'polygon', polygon: [100, -50, 115, -50, 115, -65, 100, -65], widthFt: 1.5, depthFt: 1.5, layer: 'S-COLS', sourceHandles: ['C'], confidence: 0.8,
  evidence: ['col'], status, level: 0, ...(clearanceFt === undefined ? {} : { clearanceFt })
})
const round = obstacle('round', 'approved', 2)
const roundCircle: StoredCadObstacle = { ...round, shape: 'circle', circle: { x: 200, y: -80, radius: 8 }, polygon: [208, -80, 200, -72, 192, -80, 200, -88] }

describe('approved openings and obstacles export on their own layers', () => {
  const out = exportProjectDxf({
    project, zones: [], dxfEntities: [],
    cadOpenings: [opening('door-ok', 'approved', 0), opening('door-maybe', 'review-required', 50), opening('door-no', 'rejected', 100)],
    cadObstacles: [obstacle('col-ok', 'approved', 1.5), obstacle('col-maybe', 'review-required'), obstacle('col-no', 'rejected'), roundCircle]
  })
  const entities = parseDxfText(out.text).entities
  it('writes only approved openings, as lines in native coordinates with a tag', () => {
    const lines = entities.filter(e => e.layer === 'HVAC-CAD-OPENINGS' && e.type === 'LINE')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ x: 0, y: -20, points: [30, -20] })
    const tags = entities.filter(e => e.layer === 'HVAC-CAD-OPENING-TAGS' && e.type === 'TEXT')
    expect(tags.map(t => t.text).join()).toMatch(/door-ok/)
    expect(JSON.stringify(entities)).not.toMatch(/door-maybe|door-no/)
  })
  it('writes only approved obstacles with their clearance in the tag', () => {
    const outlines = entities.filter(e => e.layer === 'HVAC-CAD-OBSTACLES')
    expect(outlines.filter(e => e.type === 'LWPOLYLINE')).toHaveLength(1)
    expect(outlines.filter(e => e.type === 'CIRCLE')).toHaveLength(1)
    expect(outlines.find(e => e.type === 'LWPOLYLINE')?.points).toEqual([100, -50, 115, -50, 115, -65, 100, -65])
    expect(outlines.find(e => e.type === 'CIRCLE')).toMatchObject({ x: 200, y: -80, radius: 8 })
    const tags = entities.filter(e => e.layer === 'HVAC-CAD-OBSTACLE-TAGS').map(e => e.text).join('|')
    expect(tags).toMatch(/col-ok.*1\.5 ft/)
    expect(tags).toMatch(/round.*2(\.0)? ft/)
    expect(tags).not.toMatch(/col-maybe|col-no/)
  })
  it('omits both layers when nothing is approved and still requires confirmed units', () => {
    const none = exportProjectDxf({ project, zones: [], dxfEntities: [], cadOpenings: [opening('x', 'review-required', 0)], cadObstacles: [obstacle('y', 'rejected')] })
    expect(none.text).not.toContain('HVAC-CAD-OPENINGS')
    expect(none.text).not.toContain('HVAC-CAD-OBSTACLES')
    expect(() => exportProjectDxf({ project: { ...project, cadUnitsConfirmed: false }, zones: [], dxfEntities: [], cadOpenings: [opening('x', 'approved', 0)] })).toThrow(/confirm/i)
  })
  it('does not change an export without review state', () => {
    const plain = exportProjectDxf({ project, zones: [], dxfEntities: [] })
    expect(plain.text).not.toContain('HVAC-CAD-')
  })
})
