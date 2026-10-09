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
      expect.arrayContaining([expect.objectContaining({ code: 'estimated-units' })])
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
it('diagnoses a nonzero block base Z instead of silently projecting the block',()=>{
 const result=parse(database([insert('Elevated')],[{name:'Elevated',basePoint:point(0,0,10),entities:[line()]}]));
 expect(result.entities).toHaveLength(0);expect(result.diagnostics?.some(d=>/plane|base|elevation/i.test(d.message))).toBe(true);
});
