/**
 * Standards basis and plumbing / building-code requirements cited by reports and drawings.
 */

export interface StandardReference {
  code: string;
  edition: string;
  scope: string;
}

/** Standards and editions modelled by the engine. */
export const STANDARDS_REFERENCES: StandardReference[] = [
  { code: 'NFPA 13', edition: '2019', scope: 'Hazard classification, density/area design point, max coverage, hose allowance & duration, Hazen-Williams, equivalent pipe lengths, C-factors, 7 psi min end-head pressure, 1.2√A rule' },
  { code: 'NFPA 14', edition: '2019', scope: "Standpipe flow (500 + 250/add'l, cap 1000 sprinklered / 1250 unsprinklered), residual 100 psi (Class I/III) / 65 psi (Class II), 30 min duration" },
  { code: 'NFPA 20', edition: '2019', scope: 'Standard rated capacities, centrifugal pump performance (≤140 % shutoff, ≥65 % at 150 %), pump data table, suction velocity/pressure limits, OS&Y suction valve, eccentric reducer, 10 D straight run, vortex plate, circulation & pressure relief valves, diesel derate & fuel tank, motor sizing, controllers, jockey pump sizing & setpoints, min run timers, pump-room protection/heating' },
  { code: 'NFPA 22', edition: '2018', scope: 'Fire water tank effective capacity, anti-vortex plate, refill within 8 h, overflow / vent / manhole / ladder / drain' },
  { code: 'NFPA 24', edition: '2019', scope: 'Private fire service mains (feed main)' },
  { code: 'NFPA 25', edition: '2020', scope: 'Annual flow test provisions (test header, flow meter)' },
  { code: 'NFPA 70', edition: '2020', scope: 'Art. 695 fire pump power, Art. 110.26 working space in front of controllers (≥ 1.0 m used)' },
  { code: 'IBC', edition: '2021', scope: '§903 sprinklers, §905 standpipes, §913 fire pumps (§913.2.1 room separation: 2 h high-rise / 1 h otherwise), §913.4 valve supervision' },
  { code: 'IPC', edition: '2021', scope: '§608 backflow / air gap on tank fill, §802 indirect waste with air gap for relief & drip drains, floor drains' },
  { code: 'UPC', edition: '2021', scope: '§603 backflow / air gap, §801 indirect waste, floor drains' }
];

/** Note carried by every report. */
export const CODE_NOTE = 'Verify clause numbering against the edition adopted by the Authority Having Jurisdiction.';

export interface PlumbingRequirement {
  code: string;
  clause: string;
  requirement: string;
}

/** Plumbing / building-code requirements applied to the pump room and tank. */
export const PLUMBING_REQUIREMENTS: PlumbingRequirement[] = [
  { code: 'IPC', clause: '§608', requirement: 'Tank fill connection shall provide an air gap of at least 2 x the effective opening diameter above the overflow rim.' },
  { code: 'IPC', clause: '§802', requirement: 'Relief valve, drip and trench drains discharge indirectly through an air gap into a floor drain or receptor.' },
  { code: 'UPC', clause: '§603', requirement: 'Backflow protection of potable refill by air gap.' },
  { code: 'UPC', clause: '§801', requirement: 'Indirect waste connections for relief, drip and trench drains via air gap.' },
  { code: 'IBC', clause: '§913.2.1', requirement: 'Fire pump room separated by fire barriers: 2 h in high-rise buildings, 1 h otherwise.' },
  { code: 'IBC', clause: '§913.4', requirement: 'Valves controlling the fire pump water supply shall be supervised in the open position.' },
  { code: 'NFPA 70', clause: 'Art. 695 / 110.26', requirement: 'Fire pump power supply per Art. 695; clear working space of at least 1.0 m in front of controllers (110.26).' }
];
