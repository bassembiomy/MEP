import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';
import { calculateBreathingZoneVentilation } from '../standards/ventilationRules';
import { SPACE_TYPE_BY_ID } from '../knowledgeBase';

/** ASHRAE 62.1 Table 6-4: cooling with ceiling supply of cool air => Ez = 1.0. Single shared default (loadCalc uses it too). */
export const DEFAULT_EZ_COOLING_CEILING = 1.0;

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
    ventilationEffectivenessEz = DEFAULT_EZ_COOLING_CEILING,
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

// ---------------------------------------------------------------------------
// ASHRAE 62.1 Ventilation Rate Procedure driven by the canonical space-type table
// ---------------------------------------------------------------------------
export interface Ashrae621Input {
  areaSqFt: number;
  /** Id from knowledgeBase ASHRAE_SPACE_TYPES (default 'office'). */
  spaceTypeId?: string;
  /** People in the zone; default = table density (people / 1000 ft2) x area, never a fixed number. */
  occupancyCount?: number;
  /** Zone air distribution effectiveness Ez (default 1.0, cooling with ceiling supply). */
  ventilationEffectivenessEz?: number;
}

export interface Ashrae621Result {
  spaceTypeId: string;
  spaceTypeName: string;
  occupancyCount: number;
  occupancyDerived: boolean;
  rpCfmPerPerson: number;
  raCfmPerSqFt: number;
  /** Vbz = Rp*Pz + Ra*Az (CFM) */
  vbzCfm: number;
  ez: number;
  /** Voz = Vbz / Ez (CFM) */
  vozCfm: number;
  designBasis: string;
}

export function calculateAshrae621Ventilation(input: Ashrae621Input): Ashrae621Result {
  const area = Math.max(0, input.areaSqFt || 0);
  const st = SPACE_TYPE_BY_ID[input.spaceTypeId ?? 'office'] ?? SPACE_TYPE_BY_ID['office'];
  const ez = input.ventilationEffectivenessEz && input.ventilationEffectivenessEz > 0 ? input.ventilationEffectivenessEz : DEFAULT_EZ_COOLING_CEILING;
  const derived = !(typeof input.occupancyCount === 'number' && input.occupancyCount > 0);
  const pz = derived ? Math.max(1, Math.round((st.density * area) / 1000)) : (input.occupancyCount as number);
  const vbz = st.rp * pz + st.ra * area;
  const voz = vbz / ez;
  return {
    spaceTypeId: st.id,
    spaceTypeName: st.name,
    occupancyCount: pz,
    occupancyDerived: derived,
    rpCfmPerPerson: st.rp,
    raCfmPerSqFt: st.ra,
    vbzCfm: parseFloat(vbz.toFixed(1)),
    ez,
    vozCfm: Math.round(voz),
    designBasis: `ASHRAE 62.1 VRP: Vbz = ${st.rp}x${pz} + ${st.ra}x${Math.round(area)} = ${vbz.toFixed(1)} CFM; Voz = Vbz/Ez (${ez}) = ${Math.round(voz)} CFM`
  };
}
