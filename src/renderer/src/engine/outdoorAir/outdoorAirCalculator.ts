import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';
import { calculateBreathingZoneVentilation } from '../standards/ventilationRules';

export interface OutdoorAirCalcInput {
  roomName: string;
  occupancyCount: number;
  areaSqFt: number;
  spaceCategory?: string;
  ventilationEffectivenessEz?: number; // typically 0.8 - 1.0
  profile?: StandardsProfile;
}

export interface OutdoorAirCalcResult {
  roomName: string;
  breathingZoneCfm: number;
  requiredOaCfm: number;
  ventilationEffectivenessEz: number;
  designBasis: string;
}

export function calculateRoomOutdoorAir(input: OutdoorAirCalcInput): OutdoorAirCalcResult {
  const {
    roomName,
    occupancyCount,
    areaSqFt,
    spaceCategory = 'conference-meeting',
    ventilationEffectivenessEz = 0.8,
    profile = ASHRAE_PROFILE
  } = input;

  const vbz = calculateBreathingZoneVentilation(occupancyCount, areaSqFt, spaceCategory, profile);
  // Outdoor Air Intake Vo = Vbz / Ez
  const requiredOaCfm = Math.round(vbz / ventilationEffectivenessEz);

  return {
    roomName,
    breathingZoneCfm: vbz,
    requiredOaCfm,
    ventilationEffectivenessEz,
    designBasis: `ASHRAE 62.1-2019 Ventilation Rate Procedure (Ez = ${ventilationEffectivenessEz})`
  };
}
