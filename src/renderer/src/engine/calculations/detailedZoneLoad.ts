/**
 * Explicit SI design-hour component calculation, not a dynamic peak-load model.
 * The interfaces below are the authoritative input schema: EVERY field is required.
 * Empty arrays explicitly declare no such surfaces/gains; zero values are retained.
 * Input sources describe the actual project evidence, not a claim that it was verified.
 *
 * Airflows are L/s on one common reference-volume basis. densityKgM3 means kg of
 * DRY AIR per m³ of moist air on that basis; cp is J/(kg dry air K), including the
 * selected moist-air heat capacity. Humidity ratios are kg water/kg dry air.
 * This explicit convention avoids applying a moist-air mass to a dry-air ratio.
 * Saturation/pressure consistency is an upstream psychrometric evidence check.
 *
 * Envelope areas are net opaque areas excluding the separately entered glazing.
 * effectiveOutdoorC is the documented outside equivalent/adjacent temperature;
 * no sol-air, ground, thermal bridge, storage or orientation value is invented.
 * Glazing orientation is clockwise degrees from north in [0,360); irradiance is
 * incident on THAT surface at the supplied design hour, not horizontal irradiance.
 * shadingFraction is the remaining solar fraction (1 = unshaded), NOT a shading
 * coefficient. SHGC must apply at the design conditions/angle. The explicit solar
 * load fraction converts admitted heat gain to the selected hour's space load.
 * Scheduled gain fractions convert installed input W to space sensible/latent
 * loads at this hour; their sum cannot exceed 1, and may be less than 1 for heat
 * rejected elsewhere/storage. People count is the actual simultaneous integer
 * population for both heat gains and the entered ventilation criteria.
 *
 * Sources need nonblank title/url/applicability. Source presence is not automatic
 * engineering readiness. No ASHRAE HB/RTS peak or Egypt code certification is made.
 */
export interface DetailedInputSource {
  title: string
  url: string
  applicability: string
}

export interface DetailedEnvelopeSurface {
  id: string
  kind: 'wall' | 'roof' | 'floor'
  areaM2: number
  uWm2K: number
  effectiveOutdoorC: number
  source: DetailedInputSource
}

export interface DetailedGlazingSurface {
  id: string
  areaM2: number
  uWm2K: number
  shgc: number
  orientationDeg: number
  irradianceWm2: number
  shadingFraction: number
  solarToSpaceLoadFraction: number
  source: DetailedInputSource
  solarSource: DetailedInputSource
}

export interface DetailedScheduledGain {
  id: string
  installedW: number
  scheduleFraction: number
  sensibleFraction: number
  latentFraction: number
  source: DetailedInputSource
}

export interface DetailedZoneLoadInput {
  zoneId: string
  designHour: string
  areaM2: number
  weather: {
    outdoorC: number
    indoorC: number
    supplyC: number
    outdoorHumidityRatioKgKg: number
    indoorHumidityRatioKgKg: number
    source: DetailedInputSource
  }
  envelope: DetailedEnvelopeSurface[]
  glazing: DetailedGlazingSurface[]
  people: {
    count: number
    sensibleWPerPerson: number
    latentWPerPerson: number
    source: DetailedInputSource
  }
  lighting: DetailedScheduledGain[]
  equipment: DetailedScheduledGain[]
  ventilation: {
    rpLpsPerPerson: number
    raLpsPerM2: number
    ez: number
    source: DetailedInputSource
  }
  infiltration: { flowLps: number; source: DetailedInputSource }
  exhaust: { flowLps: number; source: DetailedInputSource }
  air: {
    densityKgM3: number
    specificHeatJkgK: number
    latentHeatJkg: number
    massBasis: 'dry-air'
    source: DetailedInputSource
  }
}

export interface DetailedLoadComponent {
  id: string
  kind: 'envelope' | 'glazing-conduction' | 'glazing-solar' | 'people' | 'lighting' | 'equipment' | 'infiltration' | 'outdoor-air'
  scope: 'zone' | 'outdoor-air-coil'
  sensibleW: number
  latentW: number
  totalW: number
  formula: string
  inputs: Record<string, number | string>
  sources: DetailedInputSource[]
  equationSourceIds: string[]
}

export interface DetailedZoneLoadResult {
  zoneId: string
  designHour: string
  method: {
    id: 'steady-design-hour-components-v1'
    applicability: string
    limitations: string[]
    equationSources: Array<DetailedInputSource & { id: string; checkedOn: string }>
  }
  components: DetailedLoadComponent[]
  zoneSensibleW: number
  zoneLatentW: number
  outdoorAirSensibleW: number
  outdoorAirLatentW: number
  netSensibleW: number
  netLatentW: number
  sensibleW: number
  latentW: number
  totalW: number
  thermalSupplyLps: number
  supplyLps: number
  breathingZoneOutdoorLps: number
  ventilationOutdoorLps: number
  outdoorIntakeLps: number
  infiltrationLps: number
  exhaustLps: number
  roomReturnLps: number
  recirculatedLps: number
  reliefLps: number
}

const EQUATION_SOURCES: DetailedZoneLoadResult['method']['equationSources'] = [
  {
    id: 'steady-ua',
    title: 'US DOE National Best Practices Manual for Building High Performance Schools (2004), Building Shell p.114',
    url: 'https://www1.eere.energy.gov/buildings/publications/pdfs/energysmartschools/nationalbestpracticesmanual31545.pdf',
    applicability: 'U-factor defines steady heat flow per area and temperature difference; dynamic storage requires a separate method.',
    checkedOn: '2026-10-08'
  },
  {
    id: 'shgc',
    title: 'US DOE Energy Performance Ratings for Windows, Doors, and Skylights',
    url: 'https://www.energy.gov/energysaver/energy-performance-ratings-windows-doors-and-skylights',
    applicability: 'SHGC is the fraction of incident solar radiation admitted as heat gain. Project shading and hour-to-space-load factors are explicit inputs, not prescribed defaults.',
    checkedOn: '2026-10-08'
  },
  {
    id: 'single-zone-ventilation',
    title: 'ASHRAE 62.1-2007 addenda g/r/t, equations 6-2 and 6-3 and Vbz nomenclature',
    url: 'https://resourcecenter.ashrae.org/File%20Library/Technical%20Resources/Standards%20and%20Guidelines/Standards%20Addenda/62_1_2007_Addendum_g_r_t_final.pdf',
    applicability: 'Supports Vbz=Rp*Pz+Ra*Az and single-zone Voz=Vbz/Ez. No rates, Ez, governing edition or Egyptian adoption are inferred from this historical public equation reference.',
    checkedOn: '2026-10-08'
  },
  {
    id: 'air-energy-moisture',
    title: 'US DOE EnergyPlus Engineering Reference, Hybrid Model, zone heat/moisture balances',
    url: 'https://energyplus.readthedocs.io/en/stable/guides/engineering-reference/13.4-hybrid-model.html',
    applicability: 'Uses mass-flow cp temperature difference and dry-air humidity-ratio differences. This module applies only their steady component terms, with explicit latent heat; it does not implement EnergyPlus dynamics.',
    checkedOn: '2026-10-08'
  },
  {
    id: 'zone-sensible-airflow',
    title: 'Trane Design Coil Capacity (2025-02-06)',
    url: 'https://shop.trane.com/commercial/s/article/Design-Coil-Capacity',
    applicability: 'Explains room sensible airflow using the entered room/supply temperature and density/cp, then treating outdoor-air conditions when assessing coil capacity.',
    checkedOn: '2026-10-08'
  }
]

function object(value: unknown, path: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an explicit object`)
  }
}

function text(value: unknown, path: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} is required`)
}

function finite(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number (no overflow)`)
  }
}

function nonnegative(value: unknown, path: string): void {
  finite(value, path)
  if (value < 0) throw new Error(`${path} must be nonnegative`)
}

function positive(value: unknown, path: string): void {
  finite(value, path)
  if (value <= 0) throw new Error(`${path} must be greater than zero`)
}

function fraction(value: unknown, path: string): void {
  nonnegative(value, path)
  if ((value as number) > 1) throw new Error(`${path} must be in [0, 1]`)
}

function temperature(value: unknown, path: string): void {
  finite(value, path)
  if (value <= -273.15) throw new Error(`${path} must exceed absolute zero`)
}

function source(value: DetailedInputSource, path: string): void {
  object(value, path)
  text(value.title, `${path}.title`)
  text(value.url, `${path}.url`)
  text(value.applicability, `${path}.applicability`)
}

function validate(input: DetailedZoneLoadInput): void {
  object(input, 'input')
  text(input.zoneId, 'zoneId')
  text(input.designHour, 'designHour')
  positive(input.areaM2, 'areaM2')
  for (const key of ['weather', 'people', 'ventilation', 'infiltration', 'exhaust', 'air'] as const) {
    object(input[key], key)
    source(input[key].source, `${key}.source`)
  }
  const w = input.weather
  temperature(w.outdoorC, 'weather.outdoorC')
  temperature(w.indoorC, 'weather.indoorC')
  temperature(w.supplyC, 'weather.supplyC')
  if (w.supplyC >= w.indoorC) throw new Error('weather.supplyC must be below indoorC for cooling')
  nonnegative(w.outdoorHumidityRatioKgKg, 'weather.outdoorHumidityRatioKgKg')
  nonnegative(w.indoorHumidityRatioKgKg, 'weather.indoorHumidityRatioKgKg')
  nonnegative(input.people.count, 'people.count')
  if (!Number.isSafeInteger(input.people.count)) throw new Error('people.count must be a safe integer')
  nonnegative(input.people.sensibleWPerPerson, 'people.sensibleWPerPerson')
  nonnegative(input.people.latentWPerPerson, 'people.latentWPerPerson')
  nonnegative(input.ventilation.rpLpsPerPerson, 'ventilation.rpLpsPerPerson')
  nonnegative(input.ventilation.raLpsPerM2, 'ventilation.raLpsPerM2')
  positive(input.ventilation.ez, 'ventilation.ez')
  nonnegative(input.infiltration.flowLps, 'infiltration.flowLps')
  nonnegative(input.exhaust.flowLps, 'exhaust.flowLps')
  positive(input.air.densityKgM3, 'air.densityKgM3')
  positive(input.air.specificHeatJkgK, 'air.specificHeatJkgK')
  positive(input.air.latentHeatJkg, 'air.latentHeatJkg')
  if (input.air.massBasis !== 'dry-air') throw new Error('air.massBasis must be dry-air')

  for (const key of ['envelope', 'glazing', 'lighting', 'equipment'] as const) {
    if (!Array.isArray(input[key])) throw new Error(`${key} must be an explicit array (empty permitted)`)
    const ids = new Set<string>()
    for (const [index, value] of input[key].entries()) {
      const path = `${key}[${index}]`
      object(value, path)
      text(value.id, `${path}.id`)
      if (ids.has(value.id)) throw new Error(`${path}.id is duplicate: ${value.id}`)
      ids.add(value.id)
      source(value.source, `${path}.source`)
    }
  }
  for (const [index, surface] of input.envelope.entries()) {
    const path = `envelope[${index}]`
    if (!['wall', 'roof', 'floor'].includes(surface.kind)) throw new Error(`${path}.kind is invalid`)
    positive(surface.areaM2, `${path}.areaM2`)
    positive(surface.uWm2K, `${path}.uWm2K`)
    temperature(surface.effectiveOutdoorC, `${path}.effectiveOutdoorC`)
  }
  for (const [index, surface] of input.glazing.entries()) {
    const path = `glazing[${index}]`
    positive(surface.areaM2, `${path}.areaM2`)
    positive(surface.uWm2K, `${path}.uWm2K`)
    fraction(surface.shgc, `${path}.shgc`)
    fraction(surface.shadingFraction, `${path}.shadingFraction`)
    fraction(surface.solarToSpaceLoadFraction, `${path}.solarToSpaceLoadFraction`)
    nonnegative(surface.irradianceWm2, `${path}.irradianceWm2`)
    nonnegative(surface.orientationDeg, `${path}.orientationDeg`)
    if (surface.orientationDeg >= 360) throw new Error(`${path}.orientationDeg must be below 360`)
    source(surface.solarSource, `${path}.solarSource`)
  }
  for (const key of ['lighting', 'equipment'] as const) {
    for (const [index, gain] of input[key].entries()) {
      const path = `${key}[${index}]`
      nonnegative(gain.installedW, `${path}.installedW`)
      fraction(gain.scheduleFraction, `${path}.scheduleFraction`)
      fraction(gain.sensibleFraction, `${path}.sensibleFraction`)
      fraction(gain.latentFraction, `${path}.latentFraction`)
      if (gain.sensibleFraction + gain.latentFraction > 1) {
        throw new Error(`${path} sensibleFraction + latentFraction must not exceed 1`)
      }
    }
  }
}

/**
 * Net components are signed; only aggregate sensible/latent cooling demands clamp
 * to zero. zoneSensibleW/zoneLatentW exclude mechanically conditioned intake.
 * sensibleW/latentW/totalW include its incremental outdoor-to-room coil burden.
 * Supply is a sensible lower bound, NOT proof of latent capacity or coil selection.
 * Mechanical intake=max(Vbz/Ez, exhaust-infiltration, 0). Infiltration never reduces
 * Vbz/Ez. This single-zone steady balance has no transfer air, pressure target,
 * energy recovery, fan/duct heat or interzone moisture flow.
 */
export function calculateDetailedZoneLoad(input: DetailedZoneLoadInput): DetailedZoneLoadResult {
  validate(input)
  const components: DetailedLoadComponent[] = []
  const add = (component: Omit<DetailedLoadComponent, 'totalW'>): void => {
    finite(component.sensibleW, `${component.id}.sensibleW`)
    finite(component.latentW, `${component.id}.latentW`)
    const totalW = component.sensibleW + component.latentW
    finite(totalW, `${component.id}.totalW`)
    components.push({ ...component, totalW, sources: component.sources.map(s => ({ ...s })) })
  }
  const w = input.weather
  for (const surface of input.envelope) {
    add({
      id: `envelope:${surface.id}`, kind: 'envelope', scope: 'zone',
      sensibleW: surface.areaM2 * surface.uWm2K * (surface.effectiveOutdoorC - w.indoorC), latentW: 0,
      formula: 'sensibleW = areaM2 * uWm2K * (effectiveOutdoorC - indoorC)',
      inputs: { areaM2: surface.areaM2, uWm2K: surface.uWm2K, effectiveOutdoorC: surface.effectiveOutdoorC, indoorC: w.indoorC, surfaceKind: surface.kind },
      sources: [surface.source, w.source], equationSourceIds: ['steady-ua']
    })
  }
  for (const surface of input.glazing) {
    add({
      id: `glazing-conduction:${surface.id}`, kind: 'glazing-conduction', scope: 'zone',
      sensibleW: surface.areaM2 * surface.uWm2K * (w.outdoorC - w.indoorC), latentW: 0,
      formula: 'sensibleW = areaM2 * uWm2K * (outdoorC - indoorC)',
      inputs: { areaM2: surface.areaM2, uWm2K: surface.uWm2K, outdoorC: w.outdoorC, indoorC: w.indoorC },
      sources: [surface.source, w.source], equationSourceIds: ['steady-ua']
    })
    add({
      id: `glazing-solar:${surface.id}`, kind: 'glazing-solar', scope: 'zone',
      sensibleW: surface.areaM2 * surface.shgc * surface.irradianceWm2 * surface.shadingFraction * surface.solarToSpaceLoadFraction, latentW: 0,
      formula: 'sensibleW = areaM2 * shgc * irradianceWm2 * shadingFraction * solarToSpaceLoadFraction',
      inputs: { areaM2: surface.areaM2, shgc: surface.shgc, orientationDeg: surface.orientationDeg, irradianceWm2: surface.irradianceWm2, shadingFraction: surface.shadingFraction, solarToSpaceLoadFraction: surface.solarToSpaceLoadFraction },
      sources: [surface.source, surface.solarSource], equationSourceIds: ['shgc']
    })
  }
  const p = input.people
  add({
    id: 'people', kind: 'people', scope: 'zone',
    sensibleW: p.count * p.sensibleWPerPerson, latentW: p.count * p.latentWPerPerson,
    formula: 'sensibleW = count * sensibleWPerPerson; latentW = count * latentWPerPerson',
    inputs: { count: p.count, sensibleWPerPerson: p.sensibleWPerPerson, latentWPerPerson: p.latentWPerPerson },
    sources: [p.source], equationSourceIds: ['air-energy-moisture']
  })
  for (const key of ['lighting', 'equipment'] as const) {
    for (const gain of input[key]) {
      add({
        id: `${key}:${gain.id}`, kind: key, scope: 'zone',
        sensibleW: gain.installedW * gain.scheduleFraction * gain.sensibleFraction,
        latentW: gain.installedW * gain.scheduleFraction * gain.latentFraction,
        formula: 'sensibleW = installedW * scheduleFraction * sensibleFraction; latentW = installedW * scheduleFraction * latentFraction',
        inputs: { installedW: gain.installedW, scheduleFraction: gain.scheduleFraction, sensibleFraction: gain.sensibleFraction, latentFraction: gain.latentFraction },
        sources: [gain.source], equationSourceIds: ['air-energy-moisture']
      })
    }
  }
  const v = input.ventilation
  const breathingZoneOutdoorLps = v.rpLpsPerPerson * p.count + v.raLpsPerM2 * input.areaM2
  const ventilationOutdoorLps = breathingZoneOutdoorLps / v.ez
  const infiltrationLps = input.infiltration.flowLps
  const exhaustLps = input.exhaust.flowLps
  const outdoorIntakeLps = Math.max(ventilationOutdoorLps, exhaustLps - infiltrationLps, 0)
  const air = input.air
  for (const kind of ['infiltration', 'outdoor-air'] as const) {
    const flowLps = kind === 'infiltration' ? infiltrationLps : outdoorIntakeLps
    const dryAirMassFlowKgS = air.densityKgM3 * (flowLps / 1000)
    const deltaTK = w.outdoorC - w.indoorC
    const deltaHumidityRatioKgKg = w.outdoorHumidityRatioKgKg - w.indoorHumidityRatioKgKg
    add({
      id: kind, kind, scope: kind === 'infiltration' ? 'zone' : 'outdoor-air-coil',
      sensibleW: dryAirMassFlowKgS * air.specificHeatJkgK * deltaTK,
      latentW: dryAirMassFlowKgS * air.latentHeatJkg * deltaHumidityRatioKgKg,
      formula: 'sensibleW = densityKgM3 * (flowLps / 1000) * specificHeatJkgK * deltaTK; latentW = densityKgM3 * (flowLps / 1000) * latentHeatJkg * deltaHumidityRatioKgKg',
      inputs: { flowLps, densityKgM3: air.densityKgM3, specificHeatJkgK: air.specificHeatJkgK, latentHeatJkg: air.latentHeatJkg, massBasis: air.massBasis, outdoorC: w.outdoorC, indoorC: w.indoorC, outdoorHumidityRatioKgKg: w.outdoorHumidityRatioKgKg, indoorHumidityRatioKgKg: w.indoorHumidityRatioKgKg, deltaTK, deltaHumidityRatioKgKg, ...(kind === 'outdoor-air' ? { rpLpsPerPerson: v.rpLpsPerPerson, raLpsPerM2: v.raLpsPerM2, ez: v.ez, areaM2: input.areaM2, count: p.count, breathingZoneOutdoorLps, ventilationOutdoorLps, exhaustLps, infiltrationLps } : {}) },
      sources: kind === 'infiltration' ? [input.infiltration.source, air.source, w.source] : [v.source, input.exhaust.source, input.infiltration.source, air.source, w.source],
      equationSourceIds: kind === 'infiltration' ? ['air-energy-moisture'] : ['air-energy-moisture', 'single-zone-ventilation']
    })
  }
  const zoneComponents = components.filter(c => c.scope === 'zone')
  const zoneSensibleW = zoneComponents.reduce((sum, c) => sum + c.sensibleW, 0)
  const zoneLatentW = zoneComponents.reduce((sum, c) => sum + c.latentW, 0)
  const outdoor = components.find(c => c.kind === 'outdoor-air')!
  const outdoorAirSensibleW = outdoor.sensibleW
  const outdoorAirLatentW = outdoor.latentW
  const netSensibleW = zoneSensibleW + outdoorAirSensibleW
  const netLatentW = zoneLatentW + outdoorAirLatentW
  const sensibleW = Math.max(0, netSensibleW)
  const latentW = Math.max(0, netLatentW)
  const totalW = sensibleW + latentW
  const thermalSupplyLps = (Math.max(0, zoneSensibleW) / (air.densityKgM3 * air.specificHeatJkgK * (w.indoorC - w.supplyC))) * 1000
  const supplyLps = Math.max(thermalSupplyLps, outdoorIntakeLps)
  const roomReturnLps = supplyLps + infiltrationLps - exhaustLps
  const recirculatedLps = supplyLps - outdoorIntakeLps
  const reliefLps = Math.max(0, outdoorIntakeLps + infiltrationLps - exhaustLps)
  const quantities = { zoneSensibleW, zoneLatentW, outdoorAirSensibleW, outdoorAirLatentW, netSensibleW, netLatentW, sensibleW, latentW, totalW, thermalSupplyLps, supplyLps, breathingZoneOutdoorLps, ventilationOutdoorLps, outdoorIntakeLps, infiltrationLps, exhaustLps, roomReturnLps, recirculatedLps, reliefLps }
  for (const [key, value] of Object.entries(quantities)) finite(value, key)
  return {
    zoneId: input.zoneId,
    designHour: input.designHour,
    method: {
      id: 'steady-design-hour-components-v1',
      applicability: 'Explicit steady design-hour single-zone component cooling burden and sensible airflow lower bound on a common reference-volume/dry-air basis.',
      limitations: [
        'Not an ASHRAE heat-balance or radiant time series peak-load calculation; thermal storage and design-day peak search are not modeled.',
        'No Egypt code compliance or engineering issue-readiness certification; input source presence does not establish source accuracy or governing applicability.',
        'Sensible supply airflow does not demonstrate humidity control: supply humidity, latent coil performance and manufacturer selection require separate verification.',
        'No transfer air, pressure target, energy recovery, fan/duct heat or leakage, thermal bridges beyond the entered U-factor, interzone loads or unentered internal/process loads.',
        'Humidity ratios must be established by upstream pressure/saturation checks; air density and cp must use the declared common reference-volume/dry-air basis.',
        'Ventilation/exhaust-dominated supply can require supply-temperature reset or reheat; this function reports demand bounds, not a controls simulation.'
      ],
      equationSources: EQUATION_SOURCES.map(s => ({ ...s }))
    },
    components,
    ...quantities
  }
}
