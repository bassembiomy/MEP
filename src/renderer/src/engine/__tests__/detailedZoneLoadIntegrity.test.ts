import { describe, expect, it } from 'vitest'
import { calculateDetailedZoneLoad, type DetailedZoneLoadInput } from '../calculations/detailedZoneLoad'

const source = {
  title: 'Independent design-hour worked example',
  url: 'https://example.com/engineering-fixture',
  applicability: 'Synthetic hand-calculation fixture; not a project design criterion'
}

function emptyInput(): DetailedZoneLoadInput {
  return {
    zoneId: 'office', designHour: '2026-07-21T15:00:00+02:00', areaM2: 100,
    weather: { outdoorC: 34, indoorC: 24, supplyC: 14, outdoorHumidityRatioKgKg: 0.018, indoorHumidityRatioKgKg: 0.010, source: { ...source } },
    envelope: [], glazing: [], lighting: [], equipment: [],
    people: { count: 0, sensibleWPerPerson: 75, latentWPerPerson: 55, source: { ...source } },
    ventilation: { rpLpsPerPerson: 0, raLpsPerM2: 0, ez: 1, source: { ...source } },
    infiltration: { flowLps: 0, source: { ...source } },
    exhaust: { flowLps: 0, source: { ...source } },
    air: { densityKgM3: 1.2, specificHeatJkgK: 1000, latentHeatJkg: 2500000, massBasis: 'dry-air', source: { ...source } }
  }
}

function workedInput(): DetailedZoneLoadInput {
  const input = emptyInput()
  input.envelope = [
    { id: 'wall', kind: 'wall', areaM2: 20, uWm2K: 0.5, effectiveOutdoorC: 34, source: { ...source } },
    { id: 'roof', kind: 'roof', areaM2: 100, uWm2K: 0.2, effectiveOutdoorC: 44, source: { ...source } },
    { id: 'floor', kind: 'floor', areaM2: 100, uWm2K: 0.3, effectiveOutdoorC: 20, source: { ...source } }
  ]
  input.glazing = [{ id: 'west', areaM2: 10, uWm2K: 2, shgc: 0.4, orientationDeg: 270, irradianceWm2: 500, shadingFraction: 0.5, solarToSpaceLoadFraction: 0.8, source: { ...source }, solarSource: { ...source } }]
  input.people.count = 10
  input.lighting = [{ id: 'lights', installedW: 1000, scheduleFraction: 0.5, sensibleFraction: 0.8, latentFraction: 0, source: { ...source } }]
  input.equipment = [{ id: 'process', installedW: 500, scheduleFraction: 0.6, sensibleFraction: 0.5, latentFraction: 0.1, source: { ...source } }]
  input.ventilation = { rpLpsPerPerson: 2.5, raLpsPerM2: 0.3, ez: 0.8, source: { ...source } }
  input.infiltration.flowLps = 10
  input.exhaust.flowLps = 40
  return input
}

describe('explicit detailed design-hour cooling inputs', () => {
  it('computes signed wall, roof and floor conduction without removing cooling credits', () => {
    const result = calculateDetailedZoneLoad(workedInput())
    expect(result.components.filter(c => c.kind === 'envelope').map(c => c.sensibleW)).toEqual([100, 400, -120])
  })

  it('separates window UA delta-T from SHGC solar at the supplied orientation and hour', () => {
    const result = calculateDetailedZoneLoad(workedInput())
    expect(result.components.find(c => c.kind === 'glazing-conduction')?.sensibleW).toBe(200)
    expect(result.components.find(c => c.kind === 'glazing-solar')?.sensibleW).toBe(800)
  })

  it('uses actual people gains and scheduled lighting/equipment fractions', () => {
    const result = calculateDetailedZoneLoad(workedInput())
    expect(result.components.find(c => c.kind === 'people')).toMatchObject({ sensibleW: 750, latentW: 550 })
    expect(result.components.find(c => c.kind === 'lighting')).toMatchObject({ sensibleW: 400, latentW: 0 })
    expect(result.components.find(c => c.kind === 'equipment')).toMatchObject({ sensibleW: 150, latentW: 30 })
  })

  it('uses dry-air density, L/s conversion, cp and humidity ratio for infiltration', () => {
    const result = calculateDetailedZoneLoad(workedInput())
    const infiltration = result.components.find(c => c.kind === 'infiltration')!
    expect(infiltration).toMatchObject({ sensibleW: 120, scope: 'zone' })
    expect(infiltration.latentW).toBeCloseTo(240, 10)
  })

  it('sums zone loads separately from outdoor-air coil loads without double counting', () => {
    const result = calculateDetailedZoneLoad(workedInput())
    expect(result.zoneSensibleW).toBe(2800)
    expect(result.zoneLatentW).toBeCloseTo(820, 10)
    expect(result.outdoorAirSensibleW).toBe(825)
    expect(result.outdoorAirLatentW).toBeCloseTo(1650, 10)
    expect(result.sensibleW).toBe(3625)
    expect(result.latentW).toBeCloseTo(2470, 10)
    expect(result.totalW).toBeCloseTo(6095, 10)
  })

  it('sizes sensible supply from the room load rather than the upstream intake coil load', () => {
    const result = calculateDetailedZoneLoad(workedInput())
    expect(result.thermalSupplyLps).toBeCloseTo(233.3333333333333, 10)
    expect(result.supplyLps).toBeCloseTo(233.3333333333333, 10)
  })

  it('balances intake, exhaust, infiltration, room return, recirculation and relief', () => {
    const result = calculateDetailedZoneLoad(workedInput())
    expect(result.breathingZoneOutdoorLps).toBe(55)
    expect(result.ventilationOutdoorLps).toBe(68.75)
    expect(result.outdoorIntakeLps).toBe(68.75)
    expect(result.exhaustLps).toBe(40)
    expect(result.roomReturnLps).toBeCloseTo(203.3333333333333, 10)
    expect(result.recirculatedLps).toBeCloseTo(164.5833333333333, 10)
    expect(result.reliefLps).toBe(38.75)
  })

  it('adds mechanical exhaust makeup even when sensible cooling alone needs no supply', () => {
    const input = emptyInput()
    input.weather.outdoorC = 24
    input.weather.outdoorHumidityRatioKgKg = 0.010
    input.infiltration.flowLps = 10
    input.exhaust.flowLps = 80
    input.ventilation.raLpsPerM2 = 0.2
    const result = calculateDetailedZoneLoad(input)
    expect(result.thermalSupplyLps).toBe(0)
    expect(result.ventilationOutdoorLps).toBe(20)
    expect(result.outdoorIntakeLps).toBe(70)
    expect(result.supplyLps).toBe(70)
    expect(result.roomReturnLps).toBe(0)
    expect(result.reliefLps).toBe(0)
  })

  it('does not credit infiltration against the ventilation minimum', () => {
    const input = emptyInput()
    input.ventilation.raLpsPerM2 = 0.3
    input.infiltration.flowLps = 50
    const result = calculateDetailedZoneLoad(input)
    expect(result.outdoorIntakeLps).toBe(30)
    expect(result.reliefLps).toBe(80)
    expect(result.roomReturnLps).toBeCloseTo(100, 10)
  })

  it('preserves cooler/drier outdoor credits and clamps only the aggregate cooling demand', () => {
    const input = emptyInput()
    input.weather.outdoorC = 14
    input.weather.outdoorHumidityRatioKgKg = 0.002
    input.infiltration.flowLps = 10
    input.ventilation.raLpsPerM2 = 0.1
    const result = calculateDetailedZoneLoad(input)
    expect(result.zoneSensibleW).toBe(-120)
    expect(result.zoneLatentW).toBe(-240)
    expect(result.netSensibleW).toBe(-240)
    expect(result.netLatentW).toBe(-480)
    expect(result.sensibleW).toBe(0)
    expect(result.latentW).toBe(0)
    expect(result.totalW).toBe(0)
    expect(result.thermalSupplyLps).toBe(0)
  })

  it('accepts explicitly zero loads and flows without substituting assumptions', () => {
    const result = calculateDetailedZoneLoad(emptyInput())
    expect(result.totalW).toBe(0)
    expect(result.supplyLps).toBe(0)
    expect(result.outdoorIntakeLps).toBe(0)
  })

  it('retains component inputs and input evidence without mutating or aliasing them', () => {
    const input = workedInput()
    const snapshot = JSON.stringify(input)
    const result = calculateDetailedZoneLoad(input)
    const solar = result.components.find(c => c.kind === 'glazing-solar')!
    expect(solar.inputs).toMatchObject({ orientationDeg: 270, irradianceWm2: 500, shgc: 0.4, shadingFraction: 0.5, solarToSpaceLoadFraction: 0.8 })
    expect(solar.sources).toContainEqual(source)
    expect(solar.equationSourceIds.length).toBeGreaterThan(0)
    solar.sources[0].title = 'Changed output'
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it.each(['envelope', 'glazing', 'lighting', 'equipment', 'weather', 'people', 'ventilation', 'infiltration', 'exhaust', 'air'] as const)(
    'rejects absent required %s rather than supplying defaults', key => {
      const input = workedInput()
      delete (input as unknown as Record<string, unknown>)[key]
      expect(() => calculateDetailedZoneLoad(input)).toThrow(new RegExp(key, 'i'))
    }
  )

  it.each([
    ['areaM2', (i: DetailedZoneLoadInput) => { i.areaM2 = 0 }],
    ['outdoorC', (i: DetailedZoneLoadInput) => { i.weather.outdoorC = NaN }],
    ['indoorC', (i: DetailedZoneLoadInput) => { i.weather.indoorC = -273.15 }],
    ['supplyC', (i: DetailedZoneLoadInput) => { i.weather.supplyC = 24 }],
    ['humidity', (i: DetailedZoneLoadInput) => { i.weather.outdoorHumidityRatioKgKg = -0.001 }],
    ['people.count', (i: DetailedZoneLoadInput) => { i.people.count = -1 }],
    ['people.count', (i: DetailedZoneLoadInput) => { i.people.count = 1.5 }],
    ['ez', (i: DetailedZoneLoadInput) => { i.ventilation.ez = 0 }],
    ['rp', (i: DetailedZoneLoadInput) => { i.ventilation.rpLpsPerPerson = -1 }],
    ['ra', (i: DetailedZoneLoadInput) => { i.ventilation.raLpsPerM2 = Infinity }],
    ['density', (i: DetailedZoneLoadInput) => { i.air.densityKgM3 = 0 }],
    ['specificHeat', (i: DetailedZoneLoadInput) => { i.air.specificHeatJkgK = -1 }],
    ['latentHeat', (i: DetailedZoneLoadInput) => { i.air.latentHeatJkg = Infinity }],
    ['infiltration', (i: DetailedZoneLoadInput) => { i.infiltration.flowLps = -1 }],
    ['exhaust', (i: DetailedZoneLoadInput) => { i.exhaust.flowLps = Infinity }],
    ['uWm2K', (i: DetailedZoneLoadInput) => { i.envelope[0].uWm2K = -1 }],
    ['kind', (i: DetailedZoneLoadInput) => { i.envelope[0].kind = 'unknown' as 'wall' }],
    ['shgc', (i: DetailedZoneLoadInput) => { i.glazing[0].shgc = 1.1 }],
    ['shadingFraction', (i: DetailedZoneLoadInput) => { i.glazing[0].shadingFraction = -0.1 }],
    ['solarToSpaceLoadFraction', (i: DetailedZoneLoadInput) => { i.glazing[0].solarToSpaceLoadFraction = 1.1 }],
    ['orientation', (i: DetailedZoneLoadInput) => { i.glazing[0].orientationDeg = 360 }],
    ['irradiance', (i: DetailedZoneLoadInput) => { i.glazing[0].irradianceWm2 = -1 }],
    ['schedule', (i: DetailedZoneLoadInput) => { i.lighting[0].scheduleFraction = 1.1 }],
    ['fraction', (i: DetailedZoneLoadInput) => { i.equipment[0].sensibleFraction = 0.9; i.equipment[0].latentFraction = 0.2 }],
    ['installedW', (i: DetailedZoneLoadInput) => { i.lighting[0].installedW = -1 }]
  ] as const)('rejects physically invalid %s', (field, change) => {
    const input = workedInput()
    change(input)
    expect(() => calculateDetailedZoneLoad(input)).toThrow(new RegExp(field, 'i'))
  })

  it.each(['weather', 'ventilation', 'people', 'air', 'infiltration', 'exhaust'] as const)('requires applicable source evidence for %s', key => {
    const input = workedInput()
    input[key].source.applicability = ' '
    expect(() => calculateDetailedZoneLoad(input)).toThrow(/source.*applicability/i)
  })

  it('requires envelope, glazing and design-hour solar source evidence', () => {
    for (const change of [
      (i: DetailedZoneLoadInput) => { i.envelope[0].source.url = '' },
      (i: DetailedZoneLoadInput) => { i.glazing[0].source.title = '' },
      (i: DetailedZoneLoadInput) => { i.glazing[0].solarSource.applicability = '' }
    ]) {
      const input = workedInput()
      change(input)
      expect(() => calculateDetailedZoneLoad(input)).toThrow(/source/i)
    }
  })

  it('rejects duplicate source-surface ids that would make the component report ambiguous', () => {
    const input = workedInput()
    input.envelope[1].id = input.envelope[0].id
    expect(() => calculateDetailedZoneLoad(input)).toThrow(/duplicate/i)
  })

  it('rejects a mismatched humidity/air mass basis', () => {
    const input = workedInput()
    input.air.massBasis = 'moist-air' as 'dry-air'
    expect(() => calculateDetailedZoneLoad(input)).toThrow(/massBasis/i)
  })

  it('rejects overflowing intermediate loads even when the supplied numbers are finite', () => {
    const input = workedInput()
    input.envelope[0].areaM2 = Number.MAX_VALUE
    input.envelope[0].uWm2K = Number.MAX_VALUE
    expect(() => calculateDetailedZoneLoad(input)).toThrow(/finite|overflow/i)
  })

  it('rejects overflow in the sensible-airflow denominator rather than reporting zero demand', () => {
    const input = emptyInput()
    input.air.densityKgM3 = Number.MAX_VALUE
    input.air.specificHeatJkgK = Number.MAX_VALUE
    expect(() => calculateDetailedZoneLoad(input)).toThrow(/finite|overflow/i)
  })
})
