import { describe, expect, it } from 'vitest'
import type { ProjectMetadata, Zone } from '../../store/projectStore'
import { calculateCanonicalZoneLoad, calculateZoneLoad } from '../loadCalc'
import { adaptCalculateLoadAndAirflow } from '../adapters/loadAirflowAdapter'
import { calculatePreliminaryZoneLoad } from '../preliminaryLoad'
import { LITERS_PER_SECOND_PER_CFM } from '../engineeringInputs'

const project: ProjectMetadata = {
  name: 'fixture',
  location: '',
  units: 'imperial',
  scale: 1,
  outdoorDb: 95,
  indoorDb: 75
}
const zone: Zone = {
  id: 'fixture',
  name: 'office',
  points: [0, 0, 10, 0, 10, 10, 0, 10],
  ceilingHeight: 10,
  spaceTypeId: 'office',
  occupants: 2,
  diffusers: [],
  ducts: []
}

describe('shared preliminary loads and dimensional conversion', () => {
  it('uses identical loads and airflows for equivalent application and adapter inputs', () => {
    const app = calculateCanonicalZoneLoad({ ...zone, lightingOverride: 1, equipmentOverride: 0.5 }, project)
    const adapter = adaptCalculateLoadAndAirflow(100, 10, 2, 1, 0.5, undefined, undefined, {
      perimeterFt: 40,
      spaceTypeId: 'office',
      outdoorDbF: 95,
      indoorDbF: 75
    })
    expect(adapter.sensibleBtu).toBe(app.sensibleLoad)
    expect(adapter.latentBtu).toBe(app.latentLoad)
    expect(adapter.totalBtu).toBe(app.totalLoad)
    expect(adapter.supplyCfm).toBe(app.supplyCfm)
    expect(adapter.outdoorAirCfm).toBe(app.oaCfm)
    expect(adapter.returnCfm).toBe(app.returnCfm)
  })

  it('preserves zero occupants and zero lighting/equipment overrides', () => {
    const result = calculateZoneLoad(
      { ...zone, occupants: 0, lightingOverride: 0, equipmentOverride: 0 },
      { ...project, outdoorDb: 75, humidityRatioDelta: 0 }
    )
    expect(result.occupants).toBe(0)
    expect(result.sensibleLoad).toBe(0)
    expect(result.latentLoad).toBe(0)
    expect(result.vbzCfm).toBe(6)
  })

  it('preserves zero manual cooling load in both entry points', () => {
    const app = calculateZoneLoad({ ...zone, manualCoolingOverride: 0 }, project)
    const adapter = adaptCalculateLoadAndAirflow(100, 10, 2, 1, 0.5, 0)
    expect(app.totalLoad).toBe(0)
    expect(adapter.totalBtu).toBe(0)
  })

  it('retains a sub-square-foot application room area', () => {
    expect(
      calculateZoneLoad({ ...zone, points: [0, 0, 0.1, 0, 0.1, 0.1, 0, 0.1] }, project).area
    ).toBeCloseTo(0.01, 12)
    expect(adaptCalculateLoadAndAirflow(0.01).areaSqFt).toBe(0.01)
  })

  it('converts office ventilation from CFM to metric L/s after the imperial calculation', () => {
    const result = calculateZoneLoad(
      { ...zone, occupants: 10, ceilingHeight: 3.048 },
      { ...project, units: 'metric', outdoorDb: 35, indoorDb: 23.888888888889 }
    )
    // 100 m² = 1076.39104167097 ft²; Vbz = 50 + 0.06 * 1076.39104167097
    // = 114.583462500258 CFM = 54.07737216 L/s, rounded to 54 for display.
    expect(result.area).toBeCloseTo(100, 10)
    expect(result.vbzCfm).toBe(54)
    expect(result.oaCfm).toBe(54)
  })

  it('retains the independently derived ventilation fixture before display rounding', () => {
    const result = calculatePreliminaryZoneLoad({
      areaSqFt: 1076.3910416709723,
      perimeterFt: 131.23359580052494,
      ceilingHeightFt: 10,
      spaceTypeId: 'office',
      occupants: 10,
      outdoorDbF: 95,
      indoorDbF: 75
    })
    expect(result.vbzCfm).toBeCloseTo(114.58346250025832, 10)
    expect(result.vbzCfm * LITERS_PER_SECOND_PER_CFM).toBeCloseTo(54.07737216, 10)
  })

  it('converts a complete equivalent metric calculation at the output boundary', () => {
    const imperial = calculateZoneLoad(
      {
        ...zone,
        points: [0, 0, 32.808398950131, 0, 32.808398950131, 32.808398950131, 0, 32.808398950131],
        occupants: 10
      },
      project
    )
    const metric = calculateZoneLoad(
      { ...zone, occupants: 10, ceilingHeight: 3.048 },
      { ...project, units: 'metric', outdoorDb: 35, indoorDb: 23.888888888889 }
    )
    expect(metric.totalLoad).toBeCloseTo(imperial.totalLoad * 0.2930710701722222, 0)
    expect(metric.supplyCfm).toBeCloseTo(imperial.supplyCfm * 0.4719474432, 0)
    expect(metric.totalTons).toBe(imperial.totalTons)
  })

  it('uses explicit exposure and humidity settings instead of fixed assumptions', () => {
    const result = calculateZoneLoad(
      { ...zone, occupants: 0, lightingOverride: 0, equipmentOverride: 0 },
      { ...project, humidityRatioDelta: 0, exposedWallFraction: 0, roofExposureFraction: 0 }
    )
    expect(result.sensibleLoad).toBe(130) // 1.08 * 6 CFM * 20°F = 129.6
    expect(result.latentLoad).toBe(0)
  })

  it('uses the configured Fahrenheit supply temperature difference', () => {
    const result = calculateZoneLoad(
      { ...zone, manualCoolingOverride: 12000 },
      { ...project, supplyDeltaTF: 10 }
    )
    expect(result.thermalCfm).toBe(833) // 9000 / (1.08 * 10)
  })

  it('discloses square-equivalent perimeter when area is the only geometry supplied', () => {
    expect(adaptCalculateLoadAndAirflow(100).assumptions).toContain(
      'Perimeter estimated from a square of equal area.'
    )
  })

  it.each([0, -1, NaN, Infinity])('rejects invalid project scale %s', (scale) => {
    expect(() => calculateZoneLoad(zone, { ...project, scale })).toThrow(/scale/i)
  })

  it.each([
    'occupants',
    'lightingOverride',
    'equipmentOverride',
    'manualCoolingOverride',
    'manualCfmOverride'
  ] as const)('rejects negative zone %s', (key) => {
    expect(() => calculateZoneLoad({ ...zone, [key]: -1 }, project)).toThrow()
  })

  it.each([NaN, Infinity])('rejects nonfinite application temperatures %s', (outdoorDb) => {
    expect(() => calculateZoneLoad(zone, { ...project, outdoorDb })).toThrow()
  })

  it.each([
    { humidityRatioDelta: -0.01 },
    { humidityRatioDelta: NaN },
    { supplyDeltaTF: 0 },
    { exposedWallFraction: -0.1 },
    { exposedWallFraction: 1.1 },
    { roofExposureFraction: Infinity }
  ])('rejects invalid preliminary settings %j', (settings) => {
    expect(() => calculateZoneLoad(zone, { ...project, ...settings })).toThrow()
  })

  it.each([
    [0, 10, 2, 1, 0.5],
    [-10, 10, 2, 1, 0.5],
    [100, 0, 2, 1, 0.5],
    [100, 10, -1, 1, 0.5],
    [100, 10, 2, -1, 0.5],
    [100, 10, 2, 1, -1],
    [NaN, 10, 2, 1, 0.5],
    [100, 10, Infinity, 1, 0.5]
  ])('rejects invalid adapter inputs %j', (area, height, people, lighting, equipment) => {
    expect(() => adaptCalculateLoadAndAirflow(area, height, people, lighting, equipment)).toThrow()
  })

  it('rejects a nonfinite or self-crossing application polygon', () => {
    expect(() => calculateZoneLoad({ ...zone, points: [0, 0, NaN, 0, 10, 10] }, project)).toThrow()
    expect(() =>
      calculateZoneLoad({ ...zone, points: [0, 0, 10, 10, 0, 10, 8, 0] }, project)
    ).toThrow()
  })

  it('rejects manual airflow below outdoor-air demand even when cooling is zero', () => {
    expect(() =>
      calculateZoneLoad({ ...zone, manualCoolingOverride: 0, manualCfmOverride: 1 }, project)
    ).toThrow(/outdoor|demand/i)
    expect(() => adaptCalculateLoadAndAirflow(100, 10, 2, 1, 0.5, 0, 1)).toThrow(/outdoor|demand/i)
  })

  it('rejects manual airflow below sensible thermal demand', () => {
    expect(() =>
      calculateZoneLoad({ ...zone, manualCoolingOverride: 12000, manualCfmOverride: 100 }, project)
    ).toThrow(/thermal|demand/i)
    expect(() => adaptCalculateLoadAndAirflow(100, 10, 2, 1, 0.5, 12000, 100)).toThrow(
      /thermal|demand/i
    )
  })

  it('accepts sufficient manual airflow in either units', () => {
    expect(
      calculateZoneLoad({ ...zone, manualCoolingOverride: 12000, manualCfmOverride: 500 }, project)
        .supplyCfm
    ).toBe(500)
    expect(
      calculateZoneLoad(
        {
          ...zone,
          ceilingHeight: 3.048,
          manualCoolingOverride: 3516.852842067,
          manualCfmOverride: 235.9737216
        },
        { ...project, units: 'metric', outdoorDb: 35, indoorDb: 24 }
      ).supplyCfm
    ).toBe(236)
  })
})
