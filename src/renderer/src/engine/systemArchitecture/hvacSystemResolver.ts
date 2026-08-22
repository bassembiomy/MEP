export type CoolingSourceType = 'dx' | 'chilled-water' | 'heat-pump' | 'package' | 'hybrid';
export type EquipmentType = 'concealed-split' | 'fcu' | 'ahu' | 'rtu' | 'package' | 'cassette' | 'high-wall' | 'vrf';

export interface ResolvedHvacSystem {
  coolingSource: CoolingSourceType;
  equipmentType: EquipmentType;
  isDucted: boolean;
  supportsOutdoorAirConnection: boolean;
  defaultSupplyAirTempF: number;
  defaultDesignDeltaTF: number;
  typicalEspInWg: number;
}

export function resolveSystemCategory(
  source: CoolingSourceType = 'dx',
  equipmentType: EquipmentType = 'concealed-split'
): ResolvedHvacSystem {
  const isDucted = equipmentType === 'concealed-split' ||
                   equipmentType === 'fcu' ||
                   equipmentType === 'ahu' ||
                   equipmentType === 'rtu' ||
                   equipmentType === 'package';

  const supportsOutdoorAir = equipmentType === 'ahu' ||
                             equipmentType === 'rtu' ||
                             equipmentType === 'package' ||
                             equipmentType === 'fcu' ||
                             equipmentType === 'concealed-split';

  let deltaT = 20; // default 20°F delta T (55°F supply vs 75°F room)
  let supplyTemp = 55;
  let typicalEsp = 0.35;

  if (equipmentType === 'ahu' || equipmentType === 'rtu') {
    typicalEsp = 1.0;
  } else if (equipmentType === 'fcu') {
    typicalEsp = 0.25;
  } else if (equipmentType === 'concealed-split') {
    typicalEsp = 0.35;
  }

  return {
    coolingSource: source,
    equipmentType,
    isDucted,
    supportsOutdoorAirConnection: supportsOutdoorAir,
    defaultSupplyAirTempF: supplyTemp,
    defaultDesignDeltaTF: deltaT,
    typicalEspInWg: typicalEsp
  };
}
