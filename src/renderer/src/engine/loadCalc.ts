import { Zone, ProjectMetadata } from '../store/projectStore';
import { ASHRAE_SPACE_TYPES, DEFAULT_U_VALUES } from './knowledgeBase';
import { calculatePolygonArea, calculatePolygonPerimeter } from './geometry';

export interface LoadResult {
  area: number; // sqft or sqm
  perimeter: number; // ft or m
  occupants: number;
  sensibleLoad: number; // Btu/h or W
  latentLoad: number; // Btu/h or W
  totalLoad: number; // Btu/h or W
  totalTons: number; // Tonnage (1 TR = 12000 Btu/h or 3.517 kW)
  supplyCfm: number; // CFM or L/s
  oaCfm: number; // Outdoor air CFM or L/s
  exhaustCfm: number; // Exhaust CFM or L/s
  returnCfm: number; // Return CFM or L/s
}

export function calculateZoneLoad(zone: Zone, project: ProjectMetadata): LoadResult {
  const spaceType = ASHRAE_SPACE_TYPES.find(t => t.id === zone.spaceTypeId) || ASHRAE_SPACE_TYPES[0];
  const isImperial = project.units === 'imperial';

  // 1. Calculate Area & Perimeter
  const areaPx = calculatePolygonArea(zone.points);
  const perimeterPx = calculatePolygonPerimeter(zone.points);
  
  // Area conversion: scale is pixels/foot (imperial) or pixels/meter (metric)
  const area = areaPx / (project.scale * project.scale);
  const perimeter = perimeterPx / project.scale;

  // 2. Occupants calculation (density is per 1000 sqft or 1000 sqm)
  const densityMultiplier = isImperial ? 1000 : 92.9; // 1000 ft² or ~92.9 m² (10.76 ft²/m²)
  const calculatedOccupants = Math.ceil((area * spaceType.density) / densityMultiplier);
  const occupants = zone.occupants || calculatedOccupants || 1;

  // Design temperature difference
  const deltaT = Math.max(0, project.outdoorDb - project.indoorDb);

  // 3. Conduction Loads (Walls & Roofs)
  // Wall U-values and CLTD
  const uWall = isImperial ? DEFAULT_U_VALUES.wall : DEFAULT_U_VALUES.wall * 5.678; // Conversion to W/(m²·K)
  const uRoof = isImperial ? DEFAULT_U_VALUES.roof : DEFAULT_U_VALUES.roof * 5.678;

  // Assume 50% wall exposure (exposed to outdoor, e.g. outer perimeter)
  const exposedWallArea = perimeter * zone.ceilingHeight * 0.5;
  const wallSensible = uWall * exposedWallArea * deltaT;
  const roofSensible = uRoof * area * deltaT;

  // 4. Internal Loads (People, Lights, Equipment)
  let peopleSensible = 0;
  let peopleLatent = 0;
  let lightingSensible = 0;
  let equipmentSensible = 0;

  if (isImperial) {
    // People: spaceType.sensibleGain and latentGain are in Btu/h per person
    peopleSensible = occupants * spaceType.sensibleGain;
    peopleLatent = occupants * spaceType.latentGain;

    // Lights: spaceType.lightingDensity is in W/ft². Q = 3.41 * Watts
    const lightingWatts = area * (zone.lightingOverride !== undefined ? zone.lightingOverride : spaceType.lightingDensity);
    lightingSensible = 3.412 * lightingWatts;

    // Equipment: spaceType.equipmentDensity is in W/ft²
    const equipmentWatts = area * (zone.equipmentOverride !== undefined ? zone.equipmentOverride : spaceType.equipmentDensity);
    equipmentSensible = 3.412 * equipmentWatts;
  } else {
    // Metric (Watts)
    // Conversion: 1 Btu/h = 0.293 W
    peopleSensible = occupants * spaceType.sensibleGain * 0.293;
    peopleLatent = occupants * spaceType.latentGain * 0.293;

    // Lights: lightingDensity is W/ft². Convert to W/m² (multiply by 10.76)
    const densityWsqm = (zone.lightingOverride !== undefined ? zone.lightingOverride : spaceType.lightingDensity) * 10.76;
    lightingSensible = area * densityWsqm;

    const equipWsqm = (zone.equipmentOverride !== undefined ? zone.equipmentOverride : spaceType.equipmentDensity) * 10.76;
    equipmentSensible = area * equipWsqm;
  }

  // 5. Ventilation (OA) Loads
  // rp: CFM/person or L/s/person (approx equal conversion factor)
  // ra: CFM/ft² or L/s/m² (multiply ra by 10.76 for L/s/m²)
  let oaFlow = 0;
  if (isImperial) {
    oaFlow = (spaceType.rp * occupants) + (spaceType.ra * area);
  } else {
    oaFlow = (spaceType.rp * occupants) + (spaceType.ra * 10.76 * area);
  }

  let oaSensible = 0;
  let oaLatent = 0;

  if (isImperial) {
    oaSensible = 1.08 * oaFlow * deltaT;
    oaLatent = 4840 * oaFlow * 0.005; // 0.005 is typical humidity ratio delta (lb/lb)
  } else {
    oaSensible = 1.2 * oaFlow * deltaT;
    oaLatent = 3000 * oaFlow * 0.005; // 0.005 kg/kg delta
  }

  // 6. Summarize Loads
  let sensibleLoad = wallSensible + roofSensible + peopleSensible + lightingSensible + equipmentSensible + oaSensible;
  let latentLoad = peopleLatent + oaLatent;

  // Manual Overrides
  if (zone.manualCoolingOverride !== undefined) {
    sensibleLoad = zone.manualCoolingOverride * 0.75; // Assume 75% sensible
    latentLoad = zone.manualCoolingOverride * 0.25; // Assume 25% latent
  }

  const totalLoad = sensibleLoad + latentLoad;
  const totalTons = isImperial ? totalLoad / 12000 : totalLoad / 3517; // 1 Ton = 12000 Btu/h or 3517 W

  // 7. CFM & Airflow calculations
  let supplyCfm = 0;
  if (zone.manualCfmOverride !== undefined) {
    supplyCfm = zone.manualCfmOverride;
  } else {
    if (isImperial) {
      // CFM = Qs / (1.08 * deltaT_coil). Standard coil deltaT is 20°F
      supplyCfm = sensibleLoad / (1.08 * 20);
    } else {
      // L/s = Qs / (1.2 * deltaT_coil). Standard coil deltaT is 11°C
      supplyCfm = sensibleLoad / (1.2 * 11);
    }
  }

  // Round supply CFM to reasonable minimum if load exists
  if (totalLoad > 0 && supplyCfm < (isImperial ? 100 : 50)) {
    supplyCfm = isImperial ? 100 : 50;
  }

  // Exhaust (Toilets)
  let exhaustCfm = 0;
  if (zone.spaceTypeId === 'toilet-public') {
    exhaustCfm = isImperial ? 50 : 25;
  } else if (zone.spaceTypeId === 'toilet-private') {
    exhaustCfm = isImperial ? 25 : 12;
  }

  // Return CFM = Supply CFM - Exhaust CFM
  const returnCfm = Math.max(0, supplyCfm - exhaustCfm);

  return {
    area: Math.round(area * 10) / 10,
    perimeter: Math.round(perimeter * 10) / 10,
    occupants,
    sensibleLoad: Math.round(sensibleLoad),
    latentLoad: Math.round(latentLoad),
    totalLoad: Math.round(totalLoad),
    totalTons: Math.round(totalTons * 10) / 10,
    supplyCfm: Math.round(supplyCfm),
    oaCfm: Math.round(oaFlow),
    exhaustCfm: Math.round(exhaustCfm),
    returnCfm: Math.round(returnCfm)
  };
}
