/** NFPA 12 warning-sign wording and safety points shared by the CO2 shop drawings (CO-501) and the HTML report. */
import type { Co2Answers } from './co2Types'

export interface Co2SignText {
  id: string
  title: string
  location: string
  /** Sign text, one entry per line (upper case, as lettered on the sign). */
  lines: string[]
}

/**
 * Warning-sign wording in the form required by NFPA 12-2022 Sec. 4.5.6 (hazard signs inside, at every entrance and at
 * the storage). The wording is a design basis — the authority having jurisdiction may require its own text.
 */
export const CO2_SIGNS: Co2SignText[] = [
  {
    id: 'inside',
    title: 'SIGN 1 - INSIDE THE PROTECTED SPACE',
    location: 'INSIDE EVERY PROTECTED ENCLOSURE, VISIBLE FROM ANY POINT',
    lines: [
      'WARNING',
      'CARBON DIOXIDE GAS',
      'WHEN THE ALARM SOUNDS OR THE',
      'DISCHARGE STARTS, LEAVE AT ONCE.',
      'CARBON DIOXIDE GAS CAN CAUSE',
      'INJURY OR DEATH.'
    ]
  },
  {
    id: 'entrance',
    title: 'SIGN 2 - AT EVERY ENTRANCE',
    location: 'OUTSIDE, AT EACH ENTRANCE TO A PROTECTED ENCLOSURE',
    lines: [
      'WARNING',
      'CARBON DIOXIDE GAS DISCHARGES INTO',
      'THIS SPACE WHEN THE ALARM OPERATES.',
      'DO NOT ENTER UNTIL VENTILATED.',
      'ENTRY CAN CAUSE INJURY OR DEATH.'
    ]
  },
  {
    id: 'storage',
    title: 'SIGN 3 - AT THE CO2 STORAGE',
    location: 'AT THE ENTRANCE TO THE CYLINDER / TANK ROOM',
    lines: [
      'WARNING',
      'CARBON DIOXIDE GAS STORAGE',
      'A LEAK CAN CAUSE ASPHYXIATION.',
      'VENTILATE BEFORE ENTERING.',
      'DO NOT ENTER ALONE.'
    ]
  },
  {
    id: 'manual',
    title: 'SIGN 4 - AT THE MANUAL RELEASE',
    location: 'AT EACH MANUAL RELEASE STATION AND ABORT / LOCKOUT',
    lines: ['CARBON DIOXIDE SYSTEM', 'MANUAL RELEASE', 'OPERATES THE PRE-DISCHARGE ALARM', 'AND TIME DELAY FIRST.']
  }
]

export const CO2_DETECTION_TEXT: Record<Co2Answers['detection'], string> = {
  'smoke-cross-zoned': 'CROSS-ZONED SMOKE DETECTION (ZONES A AND B, NFPA 72); DISCHARGE AFTER TWO ZONES + TIME DELAY',
  heat: 'HEAT DETECTION (NFPA 72); DISCHARGE AFTER ALARM + TIME DELAY',
  'none-manual': 'NO AUTOMATIC DETECTION - MANUAL RELEASE ONLY (AHJ APPROVAL REQUIRED)'
}

/** Safety points of NFPA 12-2022 Ch. 4 — (title, text) used by CO-501 notes and the report Safety section. */
export function co2SafetyPoints(a: Co2Answers): { title: string; text: string }[] {
  return [
    {
      title: 'Pre-discharge alarm and time delay',
      text: `Horn/strobe inside every protected enclosure and an outside strobe at each entrance operate before discharge; the pressure-operated time delay is set to ${a.timeDelayS} s (minimum 20 s where personnel may be present, NFPA 12-2022 Sec. 4.5).`
    },
    {
      title: 'Lockout valve',
      text: 'A supervised lockout valve on the main discharge pipe is closed during maintenance and when personnel work in the protected space; its position is supervised by the releasing panel (NFPA 12-2022 Sec. 4.5).'
    },
    {
      title: 'Warning signs',
      text: 'Hazard signs inside every protected enclosure, at every entrance and at the CO2 storage (wording on CO-501).'
    },
    {
      title: 'Odorizer',
      text: a.odorizer
        ? 'An odorizer adds a wintergreen scent to the discharged CO2 so that personnel notice it (NFPA 12-2022 Sec. 4.5).'
        : 'No odorizer is provided - not permitted where people can enter an enclosure that is normally unoccupied but occupiable (NFPA 12-2022 Sec. 4.5).'
    },
    {
      title: 'Ventilation and venting',
      text: 'Ventilation that cannot be compensated is shut down and its dampers closed before discharge. Pressure relief vents are sized for the enclosure strength; after discharge the space is ventilated before re-entry; exhaust is taken from the lowest level.'
    },
    {
      title: 'Detection and release',
      text: `${CO2_DETECTION_TEXT[a.detection]}. Manual release stations outside every entrance and a mechanical manual release at the storage.`
    },
    {
      title: 'Personnel and training',
      text: 'Only trained personnel may enter after a discharge; self-contained breathing apparatus where the atmosphere is not verified (NFPA 12-2022 Sec. 4.5).'
    }
  ]
}
