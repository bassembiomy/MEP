import { describe, it, expect } from 'vitest'
import { parseDwgDatabase as parse } from '../cad/dwgGeometry'

// Shapes match @mlightcad/libredwg-web 0.7.7 database declarations and
// entityConverter.js: ARC angles / INSERT rotations are radians (confirmed by
// svgConverter.js), polyline closure is `flag`, TEXT insertion is `startPoint`.
const point = (x: number, y: number, z = 0): { x: number; y: number; z: number } => ({ x, y, z })
const line = (startPoint = point(0, 0), endPoint = point(1, 0)): Record<string, unknown> => ({
  type: 'LINE',
  handle: 'L1',
  layer: 'Walls',
  startPoint,
  endPoint
})
const insert = (
  name: string,
  insertionPoint = point(0, 0),
  extra = {}
): Record<string, unknown> => ({
  type: 'INSERT',
  name,
  insertionPoint,
  xScale: 1,
  yScale: 1,
  rotation: 0,
  ...extra
})
const database = (
  entities: unknown[],
  blocks: unknown[] = [],
  header: unknown = { INSUNITS: 2 }
): Record<string, unknown> => ({ entities, tables: { BLOCK_RECORD: { entries: blocks } }, header })
describe('native DWG geometry integrity without loading WASM', () => {
  it('reflects line Y exactly once and retains source handles/layers', async () => {
    const result = await parse(database([line(point(2, 3), point(7, 11))]))
    expect(result.entities[0]).toMatchObject({
      type: 'LINE',
      x: 2,
      y: -3,
      points: [7, -11],
      handle: 'L1',
      sourceHandle: 'L1',
      layer: 'Walls'
    })
    expect(result.bbox).toEqual({ minX: 2, maxX: 7, minY: -11, maxY: -3 })
  })

  it('retains a quarter ARC in degrees and bounds only its actual sweep', async () => {
    const result = await parse(
      database([
        { type: 'ARC', center: point(0, 0), radius: 5, startAngle: 0, endAngle: Math.PI / 2 }
      ])
    )
    expect(result.entities[0]).toMatchObject({ type: 'ARC', startAngleDeg: 0, endAngleDeg: 90 })
    expect(result.bbox.minX).toBeCloseTo(0)
    expect(result.bbox.maxX).toBeCloseTo(5)
    expect(result.bbox.minY).toBeCloseTo(-5)
    expect(result.bbox.maxY).toBeCloseTo(0)
  })

  it('retains an exact elliptical arc and its reflected basis', async () => {
    const result = await parse(
      database([
        {
          type: 'ELLIPSE',
          center: point(10, 20),
          majorAxisEndPoint: point(4, 0),
          axisRatio: 0.5,
          startAngle: 0,
          endAngle: Math.PI / 2
        }
      ])
    )
    expect(result.entities[0]).toMatchObject({
      type: 'ELLIPSE',
      x: 10,
      y: -20,
      startParam: 0,
      endParam: Math.PI / 2
    })
    expect(result.entities[0].majorAxis!.x).toBeCloseTo(4)
    expect(result.entities[0].majorAxis!.y).toBeCloseTo(0)
    expect(result.entities[0].minorAxis!.x).toBeCloseTo(0)
    expect(result.entities[0].minorAxis!.y).toBeCloseTo(-2)
    expect(result.bbox.minX).toBeCloseTo(10)
    expect(result.bbox.maxX).toBeCloseTo(14)
    expect(result.bbox.minY).toBeCloseTo(-22)
    expect(result.bbox.maxY).toBeCloseTo(-20)
  })

  it.each(['LWPOLYLINE', 'POLYLINE2D'])(
    'retains %s closure and curved segment bulges',
    async (type) => {
      const result = await parse(
        database([
          {
            type,
            flag: type === 'LWPOLYLINE' ? 512 : 1,
            vertices: [
              { x: 0, y: 0, bulge: 1 },
              { x: 10, y: 0, bulge: 0 },
              { x: 10, y: 10, bulge: 0 }
            ]
          }
        ])
      )
      expect(result.entities[0]).toMatchObject({
        closed: true,
        points: [0, 0, 10, 0, 10, -10],
        bulges: [1, 0, 0]
      })
      expect(result.bbox.maxY).toBeCloseTo(5)
    }
  )

  it('composes nested bases, reflected scale and radian rotations exactly', async () => {
    const blocks = [
      { name: 'Inner', basePoint: point(1, 2), entities: [line(point(2, 2), point(2, 3))] },
      {
        name: 'Outer',
        basePoint: point(2, 3),
        entities: [insert('Inner', point(5, 6), { xScale: 2, yScale: 3, rotation: Math.PI / 2 })]
      }
    ]
    const result = await parse(
      database(
        [insert('Outer', point(10, 20), { xScale: -1, yScale: 2, rotation: Math.PI / 2 })],
        blocks
      )
    )
    const entity = result.entities[0]
    expect(entity.x).toBeCloseTo(0)
    expect(entity.y).toBeCloseTo(-17)
    expect(entity.points![0]).toBeCloseTo(0)
    expect(entity.points![1]).toBeCloseTo(-20)
    expect(entity.sourceBlock).toBe('Inner')
  })

  it('preserves a nonuniformly scaled circle as an exact ellipse', async () => {
    const result = await parse(
      database(
        [insert('Round', point(5, 6), { xScale: 2, yScale: 3 })],
        [
          {
            name: 'Round',
            basePoint: point(0, 0),
            entities: [{ type: 'CIRCLE', center: point(0, 0), radius: 2 }]
          }
        ]
      )
    )
    expect(result.entities[0].type).toBe('ELLIPSE')
    expect(result.entities[0].geometryApproximation).toBeUndefined()
    expect(result.bbox).toEqual({ minX: 1, maxX: 9, minY: -12, maxY: 0 })
  })

  it('preserves transformed ARC sweep rather than expanding it to a full ellipse', async () => {
    const result = await parse(
      database(
        [insert('Arc', point(0, 0), { xScale: 2, yScale: 3 })],
        [
          {
            name: 'Arc',
            basePoint: point(0, 0),
            entities: [
              { type: 'ARC', center: point(0, 0), radius: 2, startAngle: 0, endAngle: Math.PI / 2 }
            ]
          }
        ]
      )
    )
    expect(result.entities[0]).toMatchObject({
      type: 'ELLIPSE',
      startParam: 0,
      endParam: Math.PI / 2
    })
    expect(result.bbox.minX).toBeCloseTo(0)
    expect(result.bbox.maxX).toBeCloseTo(4)
    expect(result.bbox.minY).toBeCloseTo(-6)
    expect(result.bbox.maxY).toBeCloseTo(0)
  })

  it('retains TEXT actual insertion field, height and CAD rotation', async () => {
    const result = await parse(
      database([
        {
          type: 'TEXT',
          startPoint: point(4, 9),
          text: 'Office',
          textHeight: 2.5,
          rotation: Math.PI / 6
        }
      ])
    )
    expect(result.entities[0]).toMatchObject({
      type: 'TEXT',
      x: 4,
      y: -9,
      text: 'Office',
      textHeight: 2.5
    })
    expect(result.entities[0].rotationDeg).toBeCloseTo(30)
  })

  it('uses MTEXT direction because the library converter supplies rotation zero', async () => {
    const result = await parse(
      database([
        {
          type: 'MTEXT',
          insertionPoint: point(1, 2),
          direction: point(0, 1),
          rotation: 0,
          text: 'Room',
          textHeight: 2
        }
      ])
    )
    expect(result.entities[0]).toMatchObject({
      type: 'MTEXT',
      x: 1,
      y: -2,
      rotationDeg: 90,
      textHeight: 2
    })
  })

  it.each([
    line(point(Number.NaN, 0)),
    line(point(0, 0), point(Number.POSITIVE_INFINITY, 1)),
    { type: 'LINE', startPoint: { x: 1 }, endPoint: point(1, 2) },
    { type: 'LWPOLYLINE', flag: 512, vertices: [point(0, 0), point(2, Number.NaN), point(3, 4)] },
    { type: 'CIRCLE', center: point(0, 0), radius: Number.POSITIVE_INFINITY },
    { type: 'ARC', center: point(0, 0), radius: 1, startAngle: Number.NaN, endAngle: 2 }
  ])('rejects malformed geometry without manufacturing zero coordinates', async (entity) => {
    const result = await parse(database([entity]))
    expect(result.entities).toHaveLength(0)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-geometry', severity: 'error' })
      ])
    )
    expect(Object.values(result.bbox).every(Number.isFinite)).toBe(true)
  })

  it('reports unsupported SPLINE instead of replacing it with a false polygon', async () => {
    const result = await parse(
      database([
        { type: 'SPLINE', handle: 'S1', controlPoints: [point(0, 0), point(10, 20), point(20, 0)] }
      ])
    )
    expect(result.entities).toHaveLength(0)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unsupported-entity', entityType: 'SPLINE', handle: 'S1' })
      ])
    )
  })

  it('reports missing and cyclic blocks while allowing sibling block instances', async () => {
    const result = await parse(
      database(
        [insert('Missing'), insert('Cycle'), insert('Good'), insert('Good', point(5, 0))],
        [
          { name: 'Cycle', basePoint: point(0, 0), entities: [insert('Cycle')] },
          { name: 'Good', basePoint: point(0, 0), entities: [line()] }
        ]
      )
    )
    expect(result.entities).toHaveLength(2)
    expect(result.entities[1].x).toBe(5)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-block' }),
        expect.objectContaining({ code: 'cyclic-block' })
      ])
    )
  })

  it('reports nonplanar coordinates and nondefault extrusion rather than flattening them', async () => {
    const result = await parse(
      database([
        line(point(0, 0, 0), point(1, 1, 2)),
        { type: 'CIRCLE', center: point(0, 0), radius: 2, extrusionDirection: point(0, 1, 0) }
      ])
    )
    expect(result.entities).toHaveLength(0)
    expect(result.diagnostics!.filter((d) => d.code === 'nonplanar-entity')).toHaveLength(2)
  })

  it('rejects invalid INSERT matrices rather than propagating nonfinite coordinates', async () => {
    const result = await parse(
      database(
        [insert('Good', point(0, 0), { xScale: Number.NaN })],
        [{ name: 'Good', basePoint: point(0, 0), entities: [line()] }]
      )
    )
    expect(result.entities).toHaveLength(0)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-geometry', entityType: 'INSERT' })
      ])
    )
  })

  it('preserves planar SOLID boundary with its actual corner storage order', async () => {
    const result = await parse(
      database([
        {
          type: 'SOLID',
          corner1: point(0, 0),
          corner2: point(10, 0),
          corner3: point(0, 10),
          corner4: point(10, 10)
        }
      ])
    )
    expect(result.entities[0]).toMatchObject({
      closed: true,
      points: [0, 0, 10, 0, 10, -10, 0, -10]
    })
  })

  it('preserves planar 3DFACE and diagnoses tilted faces', async () => {
    const result = await parse(
      database([
        {
          type: '3DFACE',
          corner1: point(0, 0, 0),
          corner2: point(10, 0, 0),
          corner3: point(10, 10, 0),
          corner4: point(0, 10, 0)
        },
        { type: '3DFACE', corner1: point(0, 0), corner2: point(10, 0), corner3: point(10, 10, 3) }
      ])
    )
    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]).toMatchObject({
      closed: true,
      points: [0, 0, 10, 0, 10, -10, 0, -10]
    })
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'nonplanar-entity' })])
    )
  })

  it('distinguishes declared units from estimated units with confirmation diagnostics', async () => {
    const declared = await parse(database([line()], [], { INSUNITS: 4 }))
    expect(declared).toMatchObject({
      insUnits: 4,
      cadUnit: 'mm',
      unitsConfidence: 'declared',
      suggestedScaleImperial: 304.8
    })
    const estimated = await parse(database([line(point(0, 0), point(1500, 0))], [], {}))
    expect(estimated).toMatchObject({ cadUnit: 'mm', unitsConfidence: 'estimated' })
    expect(estimated.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'units-unspecified' })])
    )
  })

  it('retains a rotated uniform ARC as a quarter-circle with transformed CAD angles', async () => {
    const result = await parse(
      database(
        [insert('Quarter', point(10, 20), { rotation: Math.PI / 2 })],
        [
          {
            name: 'Quarter',
            basePoint: point(0, 0),
            entities: [
              { type: 'ARC', center: point(0, 0), radius: 2, startAngle: 0, endAngle: Math.PI / 2 }
            ]
          }
        ]
      )
    )
    expect(result.entities[0].type).toBe('ARC')
    expect(result.entities[0].startAngleDeg).toBeCloseTo(90)
    expect(result.entities[0].endAngleDeg).toBeCloseTo(180)
    expect(result.bbox.minX).toBeCloseTo(8)
    expect(result.bbox.maxX).toBeCloseTo(10)
    expect(result.bbox.minY).toBeCloseTo(-22)
    expect(result.bbox.maxY).toBeCloseTo(-20)
  })

  it('emits a diagnostic when a nonuniform bulged polyline is sampled for display', async () => {
    const result = await parse(
      database(
        [insert('Bulge', point(0, 0), { xScale: 2, yScale: 3 })],
        [
          {
            name: 'Bulge',
            basePoint: point(0, 0),
            entities: [
              {
                type: 'LWPOLYLINE',
                flag: 512,
                handle: 'B1',
                vertices: [
                  { x: 0, y: 0, bulge: 1 },
                  { x: 10, y: 0, bulge: 0 },
                  { x: 10, y: 10, bulge: 0 }
                ]
              }
            ]
          }
        ]
      )
    )
    expect(result.entities[0].geometryApproximation).toBeTypeOf('string')
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'approximated-geometry', handle: 'B1' })
      ])
    )
  })

  it('inherits block insertion layer for layer-zero source geometry', async () => {
    const result = await parse(
      database(
        [insert('Layered', point(0, 0), { layer: 'Partitions' })],
        [{ name: 'Layered', basePoint: point(0, 0), entities: [{ ...line(), layer: '0' }] }]
      )
    )
    expect(result.entities[0].layer).toBe('Partitions')
  })

  it.each([
    {
      type: 'ELLIPSE',
      center: point(0, 0),
      majorAxisEndPoint: point(2, 0),
      axisRatio: 0.5,
      endAngle: Math.PI / 2
    },
    {
      type: 'ELLIPSE',
      center: point(0, 0),
      majorAxisEndPoint: point(2, 0),
      axisRatio: 0.5,
      startAngle: 0,
      endAngle: null
    },
    { type: 'ARC', center: point(0, 0), radius: 2, startAngle: null, endAngle: Math.PI / 2 },
    insert('Good', point(0, 0), { rotation: null }),
    insert('Good', point(0, 0), { xScale: null })
  ])(
    'rejects absent native curve parameters and malformed supplied INSERT fields',
    async (entity) => {
      const result = await parse(
        database([entity], [{ name: 'Good', basePoint: point(0, 0), entities: [line()] }])
      )
      expect(result.entities).toHaveLength(0)
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'invalid-geometry', severity: 'error' })
        ])
      )
    }
  )

  it('rejects finite native inputs whose derived bounds overflow', async () => {
    const result = await parse(
      database([{ type: 'CIRCLE', center: point(1e308, 0), radius: 1e308 }])
    )
    expect(result.entities).toHaveLength(0)
    expect(Object.values(result.bbox).every(Number.isFinite)).toBe(true)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'geometry-overflow', severity: 'error' })
      ])
    )
  })

  it('reports ambiguous duplicate block definitions instead of selecting the last one', async () => {
    const result = await parse(
      database(
        [insert('Duplicate')],
        [
          { name: 'Duplicate', basePoint: point(0, 0), entities: [line()] },
          {
            name: 'Duplicate',
            basePoint: point(0, 0),
            entities: [line(point(10, 10), point(20, 20))]
          }
        ]
      )
    )
    expect(result.entities).toHaveLength(0)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ambiguous-block' })])
    )
  })

  it('rejects volumetric thickness instead of silently flattening it', async () => {
    const result = await parse(database([{ ...line(), thickness: 3 }]))
    expect(result.entities).toHaveLength(0)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unsupported-thickness' })])
    )
  })

  it('limits deeply nested blocks without stack overflow', async () => {
    const blocks = Array.from({ length: 100 }, (_, i) => ({
      name: `B${i}`,
      basePoint: point(0, 0),
      entities: i === 99 ? [line()] : [insert(`B${i + 1}`)]
    }))
    const result = await parse(database([insert('B0')], blocks))
    expect(result.entities).toHaveLength(0)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'import-limit', severity: 'error' })])
    )
  })

  it('bounds exponential block expansion and reports partial import', async () => {
    const blocks = Array.from({ length: 20 }, (_, i) => ({
      name: `B${i}`,
      basePoint: point(0, 0),
      entities: i === 19 ? [line()] : [insert(`B${i + 1}`), insert(`B${i + 1}`)]
    }))
    const result = await parse(database([insert('B0')], blocks))
    expect(result.entities.length).toBeLessThan(100000)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'import-limit', severity: 'error' })])
    )
  })
})

it('uses native LibreDWG lightweight flags separately from legacy flags',()=>{
 const vertices=[point(0,0),point(10,0),point(10,10),point(0,10)];
 expect(parse(database([{type:'LWPOLYLINE',flag:512,vertices}])).entities[0].closed).toBe(true);
 expect(parse(database([{type:'LWPOLYLINE',flag:1,vertices}])).entities[0].closed).toBe(false);
 expect(parse(database([{type:'LWPOLYLINE',flag:528,vertices:[{...vertices[0],bulge:1},...vertices.slice(1)]}])).entities[0]).toMatchObject({closed:true,bulges:[1,0,0,0]});
 expect(parse(database([{type:'LWPOLYLINE',flag:516,vertices}])).entities).toHaveLength(1);
});
// Planner decision (CAD semantics B5): planar geometry at a constant non-zero elevation is kept and projected
// onto the plan with an `elevation` field and an elevated-geometry-projected warning, instead of being dropped.
// Non-planar entities (varying Z, tilted extrusion) are still dropped, see the nonplanar-entity test above.
it('keeps constant-elevation geometry, records its elevation and warns that it was projected',()=>{
 for(const raw of [{type:'LWPOLYLINE',flag:520,elevation:10,vertices:[point(0,0),point(10,0),point(10,10)]},{type:'CIRCLE',center:point(0,0,10),radius:5}]) {
  const result=parse(database([raw]));
  expect(result.entities).toHaveLength(1);
  expect((result.entities[0] as {elevation?:number}).elevation).toBe(10);
  expect(result.diagnostics?.some(d=>d.code==='elevated-geometry-projected')).toBe(true);
 }
});
it('uses default +Z when converter emits an absent-extrusion zero vector',()=>{
 const result=parse(database([{type:'LWPOLYLINE',flag:512,elevation:0,extrusionDirection:point(0,0,0),vertices:[point(0,0),point(10,0),point(10,10)]}]));
 expect(result.entities).toHaveLength(1);expect(result.entities[0].closed).toBe(true);expect(result.diagnostics).toEqual([]);
});
// Changed expectation (Stage B review P1): a nonzero block base Z used to skip the whole block while the DXF parser
// ignored group 30 (inconsistent). Both now subtract the base Z: child elevation = insertZ + zScale * (childZ - baseZ).
it('applies a nonzero block base Z to child elevation and says so, consistently with DXF',()=>{
 const result=parse(database([insert('Elevated')],[{name:'Elevated',basePoint:point(0,0,10),entities:[line()]}]));
 expect(result.entities).toHaveLength(1);
 expect((result.entities[0] as {elevation?:number}).elevation).toBe(-10);
 expect(result.diagnostics?.some(d=>d.code==='elevated-geometry-projected'&&d.entityType==='INSERT'&&/base Z 10/.test(d.message))).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------------
// Defects found by the binary DWG corpus (dwgBinaryCorpus.test.ts). The object shapes below are the ones libredwg-web
// 0.7.7 really emits (recorded in the "real convert() output" test of that file), assembled by hand so the cases that
// the LibreDWG writer cannot produce (INSERT attribs, SPLINE with control points) stay covered.
describe('layout records, layers, paper space, attributes and splines (shapes recorded from libredwg-web)', () => {
  const layerEntry = (name: string, frozen = false, off = false): Record<string, unknown> => ({ name, frozen, off })
  const withLayers = (entities: unknown[], layers: unknown[], blocks: unknown[] = []): Record<string, unknown> => ({
    entities,
    tables: { BLOCK_RECORD: { entries: blocks }, LAYER: { entries: layers } },
    header: { INSUNITS: 4 }
  })
  const lineOn = (layer: string, x = 0): Record<string, unknown> => ({ type: 'LINE', handle: `L${layer}${x}`, layer, startPoint: point(x, 0), endPoint: point(x + 1, 0) })

  it('does not report a duplicate *Model_Space / *Paper_Space layout record as an ambiguous block', async () => {
    const result = await parse(database([line()], [
      { name: '*Model_Space', handle: '17', entities: [] },
      { name: '*Paper_Space', handle: '1B', entities: [] },
      { name: '*Model_Space', handle: '1F', entities: [] },
      { name: '*Paper_Space0', handle: '12C', entities: [] },
      { name: 'Real', handle: 'A0', entities: [line()] }
    ]))
    expect(result.diagnostics?.filter((d) => d.severity === 'error')).toEqual([])
    const dup = await parse(database([insert('Real')], [{ name: 'Real', entities: [line()] }, { name: 'Real', entities: [line()] }]))
    expect(dup.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ambiguous-block', severity: 'error' })]))
  })

  it('returns frozen and switched-off layers as hiddenLayers (sorted) and nothing when all layers are visible', async () => {
    const hidden = await parse(withLayers([lineOn('B'), lineOn('A')], [layerEntry('0'), layerEntry('B', true), layerEntry('A', false, true), layerEntry('C')]))
    expect(hidden.hiddenLayers).toEqual(['A', 'B'])
    expect(hidden.entities).toHaveLength(2)
    const visible = await parse(withLayers([lineOn('B')], [layerEntry('0'), layerEntry('B')]))
    expect(visible.hiddenLayers).toBeUndefined()
    expect((await parse(database([lineOn('B')]))).hiddenLayers).toBeUndefined()
  })

  it('moves the children of a frozen INSERT onto its layer as the DXF path does, keeping hidden child layers', async () => {
    const block = { name: 'Blk', basePoint: point(0, 0), entities: [lineOn('Vis', 0), lineOn('Gone', 2), lineOn('0', 4)] }
    const layers = [layerEntry('0'), layerEntry('Vis'), layerEntry('Gone', false, true), layerEntry('Frz', true)]
    const frozen = await parse(withLayers([insert('Blk', point(0, 0), { layer: 'Frz' })], layers, [block]))
    expect(frozen.entities.map((e) => [e.layer, e.originalLayer])).toEqual([
      ['Frz', 'Vis'],
      ['Gone', undefined],
      ['Frz', undefined]
    ])
    expect(frozen.blockReferences?.[0].layer).toBe('Frz')
    // an INSERT on a layer that is only switched off hides just its layer-0 children, which inherit the INSERT layer
    const off = await parse(withLayers([insert('Blk', point(0, 0), { layer: 'OffL' })], [...layers, layerEntry('OffL', false, true)], [block]))
    expect(off.entities.map((e) => [e.layer, e.originalLayer])).toEqual([
      ['Vis', undefined],
      ['Gone', undefined],
      ['OffL', undefined]
    ])
  })

  it('skips top-level entities owned by a paper-space record with one aggregated warning, never block contents', async () => {
    const models = [{ name: '*Model_Space', handle: '17' }, { name: '*Paper_Space', handle: '1B' }, { name: '*Paper_Space0', handle: '12C' }]
    const inBlock = { name: 'Blk', handle: '91', basePoint: point(0, 0), entities: [{ ...lineOn('A', 7), ownerBlockRecordSoftId: '1B' }] }
    const result = await parse(database([
      { ...lineOn('A', 0), ownerBlockRecordSoftId: '17' },
      { ...lineOn('A', 1), ownerBlockRecordSoftId: '1B' },
      { ...lineOn('A', 2), ownerBlockRecordSoftId: '12C' },
      insert('Blk')
    ], [...models, inBlock]))
    expect(result.entities.map((e) => e.x)).toEqual([0, 7])
    expect(result.diagnostics?.filter((d) => d.code === 'paper-space-skipped')).toEqual([expect.objectContaining({ severity: 'warning' })])
    expect(result.diagnostics?.find((d) => d.code === 'paper-space-skipped')?.message).toMatch(/^2 paper-space/)
  })

  const attrib = (value: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'ATTRIB',
    handle: `T${value}`,
    layer: '0',
    isVisible: true,
    flags: 0,
    text: { text: value, startPoint: { x: 30, y: 40 }, textHeight: 5, rotation: Math.PI / 2 },
    ...extra
  })
  it('draws each visible INSERT attribute as TEXT in WCS and drops invisible, empty and constant-template ones', async () => {
    const block = { name: 'Door', basePoint: point(0, 0), entities: [line()] }
    const result = await parse(database([insert('Door', point(100, 0), { rotation: Math.PI / 2, attribs: [attrib('D01'), attrib('D02', { flags: 1 }), attrib('D03', { isVisible: false }), attrib('   ')] })], [block]))
    const texts = result.entities.filter((e) => e.type === 'TEXT')
    expect(texts).toHaveLength(1)
    // absolute coordinates: not moved by the INSERT's 100 mm / 90 degree placement
    expect(texts[0]).toMatchObject({ text: 'D01', x: 30, y: -40, textHeight: 5, rotationDeg: 90, layer: '0' })
    expect(texts[0].sourceBlock).toBeUndefined()
    expect(result.blockReferences?.[0].entityRange).toEqual([0, 1])
  })

  it('samples a SPLINE from control points and knots (clamped end points exact) and from fit points, with a warning', async () => {
    const knots = [0, 0, 0, 0, 1, 1, 1, 1]
    const control = [point(0, 0), point(10, 20), point(20, 20), point(30, 0)]
    const spline = await parse(database([{ type: 'SPLINE', handle: 'S1', flag: 8, degree: 3, knots, controlPoints: control, fitPoints: [] }]))
    expect(spline.entities).toHaveLength(1)
    const pts = spline.entities[0].points!
    expect(spline.entities[0]).toMatchObject({ type: 'LWPOLYLINE', closed: false })
    expect(pts[0]).toBeCloseTo(0, 9)
    expect(Math.abs(pts[1])).toBeLessThan(1e-9)
    expect(pts[pts.length - 2]).toBeCloseTo(30, 9)
    expect(Math.abs(pts[pts.length - 1])).toBeLessThan(1e-9)
    expect(spline.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'approximated-geometry' })]))
    // libredwg-web reports splineflags: 9 for a fit-point spline (R2000-R2013); bit 0 is the fit-point method, NOT closure
    const fit = await parse(database([{ type: 'SPLINE', flag: 9, degree: 3, knots: [], controlPoints: [], fitPoints: [point(0, 0), point(10, 5), point(20, 0)] }]))
    expect(fit.entities[0].closed).toBe(false)
    expect(fit.entities[0].points!.slice(0, 2).map((v) => v + 0)).toEqual([0, 0])
    expect(fit.entities[0].points!.slice(-2).map((v) => v + 0)).toEqual([20, 0])
    // a SPLINE written without any points (what LibreDWG 0.13.3 dxf2dwg produces) is an unsupported-entity warning, not an error
    const empty = await parse(database([{ type: 'SPLINE', handle: 'S2', flag: 8, degree: 3, knots: [], controlPoints: [], fitPoints: [] }]))
    expect(empty.entities).toHaveLength(0)
    expect(empty.diagnostics).toEqual([expect.objectContaining({ code: 'unsupported-entity', severity: 'warning', entityType: 'SPLINE' })])
  })

  it('derives SPLINE closure from the geometry, never from splineflags (bit 0 is the fit-point method)', async () => {
    const closedOf = async (spline: Record<string, unknown>): Promise<boolean | undefined> =>
      (await parse(database([{ type: 'SPLINE', degree: 3, knots: [], controlPoints: [], fitPoints: [], ...spline }]))).entities[0].closed
    const open = [point(0, 0), point(10, 5), point(20, 0), point(30, 5)]
    // open fit-point and control-point splines with every flag value LibreDWG produces
    for (const flag of [8, 9, 1, 0]) expect(await closedOf({ flag, fitPoints: open }), `fit flag ${flag}`).toBe(false)
    // coincident first / last fit points: closed, and the duplicated end point is not sampled twice
    const loop = [point(0, 0), point(10, 5), point(20, 0), point(0, 0)]
    expect(await closedOf({ flag: 9, fitPoints: loop })).toBe(true)
    // clamped control polygon whose first and last control points coincide
    const knots = [0, 0, 0, 0, 1, 2, 3, 3, 3, 3]
    const ring = [point(0, 0), point(10, 0), point(10, 10), point(0, 10), point(5, 5), point(0, 0)]
    expect(await closedOf({ flag: 8, controlPoints: ring, knots })).toBe(true)
    expect(await closedOf({ flag: 8, controlPoints: ring.slice(0, 5).concat([point(1, 1)]), knots })).toBe(false)
    // periodic: unclamped uniform knots and the first `degree` control points repeated at the end
    const periodic = [point(0, 0), point(10, 0), point(10, 10), point(0, 10), point(0, 0), point(10, 0), point(10, 10)]
    expect(await closedOf({ flag: 8, controlPoints: periodic, knots: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] })).toBe(true)
    // unclamped uniform knots on an open control polygon are not closed
    expect(await closedOf({ flag: 8, controlPoints: periodic.slice(0, 6).concat([point(3, 3)]), knots: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] })).toBe(false)
  })

  it('ignores the loose top-level ATTRIB records libredwg-web adds for each INSERT (drawn via INSERT.attribs, no warning) and keeps the attribute elevation', async () => {
    const block = { name: 'Door', handle: '90', basePoint: point(0, 0), entities: [line()] }
    const att = { type: 'ATTRIB', handle: '192', ownerBlockRecordSoftId: '190', layer: '0', isVisible: true, flags: 0, elevation: 3500, text: { text: 'D01', startPoint: { x: 30, y: 40 }, textHeight: 5, rotation: 0 } }
    const stray = { type: 'ATTRIB', handle: '777', ownerBlockRecordSoftId: 'FFFF', layer: '0', text: { text: 'X' } }
    const result = await parse(database([{ ...insert('Door'), handle: '190', attribs: [att] }, att, stray], [block]))
    const texts = result.entities.filter((e) => e.type === 'TEXT')
    expect(texts).toHaveLength(1)
    expect((texts[0] as { elevation?: number }).elevation).toBe(3500)
    // only the ATTRIB whose owner is no INSERT is still reported
    expect((result.diagnostics ?? []).filter((d) => d.entityType === 'ATTRIB').map((d) => d.handle)).toEqual(['777'])
  })
})
