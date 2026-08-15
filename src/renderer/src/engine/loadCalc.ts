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
  sensibleHeatRatio: number; // SHR = Qs / Qt
  totalTons: number; // Tonnage (1 TR = 12000 Btu/h or 3.517 kW)
  supplyCfm: number; // Supply Airflow CFM or L/s
  thermalCfm: number; // Sensible thermal CFM or L/s
  vbzCfm: number; // Breathing zone ventilation CFM or L/s
  vozCfm: number; // Zone outdoor air intake CFM or L/s (Vbz / Ez)
  oaFraction: number; // Voz / Supply CFM
  oaCfm: number; // Outdoor air CFM or L/s
  exhaustCfm: number; // Exhaust CFM or L/s
  returnCfm: number; // Return CFM or L/s
}

/**
 * Calculates cooling loads and authoritative airflow per ASHRAE Fundamentals and ASHRAE 62.1-2019.
 */
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
  const densityMultiplier = isImperial ? 1000 : 92.9; // 1000 ft² or ~92.9 m²
  const calculatedOccupants = Math.ceil((area * spaceType.density) / densityMultiplier);
  const occupants = zone.occupants || calculatedOccupants || 1;

  // Design temperature difference (Outdoor DB - Indoor DB)
  const deltaT = Math.max(0, project.outdoorDb - project.indoorDb);

  // 3. Conduction Loads (Walls & Roofs)
  const uWall = isImperial ? DEFAULT_U_VALUES.wall : DEFAULT_U_VALUES.wall * 5.678; // W/(m²·K)
  const uRoof = isImperial ? DEFAULT_U_VALUES.roof : DEFAULT_U_VALUES.roof * 5.678;

  // Assume 50% wall exposure for general commercial building space
  const exposedWallArea = perimeter * zone.ceilingHeight * 0.5;
  const wallSensible = uWall * exposedWallArea * deltaT;
  const roofSensible = uRoof * area * deltaT;

  // 4. Internal Loads (People, Lights, Equipment)
  let peopleSensible = 0;
  let peopleLatent = 0;
  let lightingSensible = 0;
  let equipmentSensible = 0;

  if (isImperial) {
    // People: sensibleGain and latentGain in Btu/h per person
    peopleSensible = occupants * spaceType.sensibleGain;
    peopleLatent = occupants * spaceType.latentGain;

    // Lights: spaceType.lightingDensity in W/ft². Q = 3.412 * Watts
    const lightingWatts = area * (zone.lightingOverride !== undefined ? zone.lightingOverride : spaceType.lightingDensity);
    lightingSensible = 3.412 * lightingWatts;

    // Equipment: spaceType.equipmentDensity in W/ft²
    const equipmentWatts = area * (zone.equipmentOverride !== undefined ? zone.equipmentOverride : spaceType.equipmentDensity);
    equipmentSensible = 3.412 * equipmentWatts;
  } else {
    // Metric (Watts)
    peopleSensible = occupants * spaceType.sensibleGain * 0.293;
    peopleLatent = occupants * spaceType.latentGain * 0.293;

    const densityWsqm = (zone.lightingOverride !== undefined ? zone.lightingOverride : spaceType.lightingDensity) * 10.76;
    lightingSensible = area * densityWsqm;

    const equipWsqm = (zone.equipmentOverride !== undefined ? zone.equipmentOverride : spaceType.equipmentDensity) * 10.76;
    equipmentSensible = area * equipWsqm;
  }

  // 5. ASHRAE 62.1-2019 Ventilation Outdoor Air Calculations
  // Vbz = Rp * Pz + Ra * Az
  let vbzFlow = 0;
  if (isImperial) {
    vbzFlow = (spaceType.rp * occupants) + (spaceType.ra * area);
  } else {
    // Metric: spaceType.rp (L/s/person), spaceType.ra (L/s/m²)
    vbzFlow = (spaceType.rp * occupants) + (spaceType.ra * 5.08 * area);
  }

  // Zone air distribution effectiveness Ez (1.0 for ceiling supply of cool air)
  const ez = 1.0;
  const vozFlow = vbzFlow / ez;

  let oaSensible = 0;
  let oaLatent = 0;

  if (isImperial) {
    oaSensible = 1.08 * vozFlow * deltaT;
    oaLatent = 4840 * vozFlow * 0.005; // 0.005 humidity ratio delta (lb/lb)
  } else {
    oaSensible = 1.20 * vozFlow * deltaT;
    oaLatent = 3000 * vozFlow * 0.005; // 0.005 kg/kg delta
  }

  // 6. Summarize Space Loads
  let sensibleLoad = wallSensible + roofSensible + peopleSensible + lightingSensible + equipmentSensible + oaSensible;
  let latentLoad = peopleLatent + oaLatent;

  // Manual Overrides if specified
  if (zone.manualCoolingOverride !== undefined) {
    sensibleLoad = zone.manualCoolingOverride * 0.75;
    latentLoad = zone.manualCoolingOverride * 0.25;
  }

  const totalLoad = sensibleLoad + latentLoad;
  const shr = totalLoad > 0 ? sensibleLoad / totalLoad : 1.0;
  const totalTons = isImperial ? totalLoad / 12000 : totalLoad / 3517;

  // 7. Deterministic Supply Airflow Determination
  // Sensible thermal airflow: Q_thermal = Qs / (1.08 * deltaT_coil), deltaT_coil = 20°F (11.1°C)
  const coilDeltaT = isImperial ? 20.0 : 11.1;
  const thermalCfm = isImperial
    ? (sensibleLoad > 0 ? sensibleLoad / (1.08 * coilDeltaT) : 0)
    : (sensibleLoad > 0 ? sensibleLoad / (1.20 * coilDeltaT) : 0);

  // Supply airflow is the maximum of thermal airflow and outdoor air intake requirement
  let calculatedSupply = Math.max(thermalCfm, vozFlow);

  // Apply reasonable minimum baseline if zone has load
  if (totalLoad > 0 && calculatedSupply < (isImperial ? 100 : 50)) {
    calculatedSupply = isImperial ? 100 : 50;
  }

  // User manual CFM override
  const finalSupplyCfm = zone.manualCfmOverride !== undefined ? zone.manualCfmOverride : calculatedSupply;
  const oaFraction = finalSupplyCfm > 0 ? Math.min(1.0, vozFlow / finalSupplyCfm) : 0;

  // 8. Exhaust Airflow
  let exhaustCfm = 0;
  if (zone.spaceTypeId === 'toilet-public') {
    exhaustCfm = isImperial ? 50 : 25;
  } else if (zone.spaceTypeId === 'toilet-private') {
    exhaustCfm = isImperial ? 25 : 12;
  }

  // Return Airflow = Supply CFM - Exhaust CFM
  const returnCfm = Math.max(0, finalSupplyCfm - exhaustCfm);

  return {
    area: Math.round(area * 10) / 10,
    perimeter: Math.round(perimeter * 10) / 10,
    occupants,
    sensibleLoad: Math.round(sensibleLoad),
    latentLoad: Math.round(latentLoad),
    totalLoad: Math.round(totalLoad),
    sensibleHeatRatio: Math.round(shr * 100) / 100,
    totalTons: Math.round(totalTons * 10) / 10,
    supplyCfm: Math.round(finalSupplyCfm),
    thermalCfm: Math.round(thermalCfm),
    vbzCfm: Math.round(vbzFlow),
    vozCfm: Math.round(vozFlow),
    oaFraction: Math.round(oaFraction * 1000) / 1000,
    oaCfm: Math.round(vozFlow),
    exhaustCfm: Math.round(exhaustCfm),
    returnCfm: Math.round(returnCfm)
  };
}
