export type StandardsProfileType = 'ashrae' | 'smacna' | 'project-custom' | 'custom';

export interface StandardsProfile {
  id: string;
  type: StandardsProfileType;
  name: string;
  description: string;
  governingStandards: string[];
  
  // Acoustic & Velocity Limits (FPM)
  velocityLimits: {
    mainTrunkNc30: number;
    mainTrunkNc35: number;
    mainTrunkNc40: number;
    branchNc30: number;
    branchNc35: number;
    branchNc40: number;
    runoutNc30: number;
    runoutNc35: number;
    runoutNc40: number;
    returnDuct: number;
    returnPlenum: number;
    outdoorAirLouverFreeArea: number;
  };

  // Duct Sizing Limits
  ductSizing: {
    maxFrictionLossPer100Ft: number; // in. w.g. / 100 ft (typically 0.08 - 0.10)
    maxAspectRatio: number;          // typically 3.0 or 4.0
    preferredMaxHeightIn: number;    // e.g. 12" to 14" for standard ceilings
  };

  // Throw Criteria
  diffuserThrow: {
    minThrowRatio: number;           // T50 / Characteristic Room Length L (typically 0.75)
    maxThrowRatio: number;           // typically 1.25
    minReturnSupplyOffsetRatio: number; // 0.60
  };

  // Tolerances
  tolerances: {
    airflowBalancePercent: number;   // e.g. 5.0%
    roomCfmDeltaMax: number;         // e.g. 50 CFM or 5%
    staticPressureSafetyMarginPercent: number; // e.g. 15%
  };
}

export const ASHRAE_PROFILE: StandardsProfile = {
  id: 'profile-ashrae',
  type: 'ashrae',
  name: 'ASHRAE Standard Profile',
  description: 'Compliant with ASHRAE Fundamentals 2021, ASHRAE 62.1-2019, ASHRAE 90.1-2019, and ASHRAE 55-2020.',
  governingStandards: ['ASHRAE Fundamentals', 'ASHRAE 62.1', 'ASHRAE 90.1', 'ASHRAE 55'],
  velocityLimits: {
    mainTrunkNc30: 1200,
    mainTrunkNc35: 1400,
    mainTrunkNc40: 1600,
    branchNc30: 900,
    branchNc35: 1000,
    branchNc40: 1200,
    runoutNc30: 700,
    runoutNc35: 800,
    runoutNc40: 900,
    returnDuct: 900,
    returnPlenum: 400,
    outdoorAirLouverFreeArea: 500
  },
  ductSizing: {
    maxFrictionLossPer100Ft: 0.10,
    maxAspectRatio: 3.0,
    preferredMaxHeightIn: 14
  },
  diffuserThrow: {
    minThrowRatio: 0.75,
    maxThrowRatio: 1.25,
    minReturnSupplyOffsetRatio: 0.60
  },
  tolerances: {
    airflowBalancePercent: 5.0,
    roomCfmDeltaMax: 50,
    staticPressureSafetyMarginPercent: 15.0
  }
};

export const SMACNA_PROFILE: StandardsProfile = {
  id: 'profile-smacna',
  type: 'smacna',
  name: 'SMACNA Standard Profile',
  description: 'Compliant with SMACNA HVAC Duct Construction Standards - Metal and Flexible (4th Edition).',
  governingStandards: ['SMACNA HVAC Duct Construction Standards', 'SMACNA HVAC Systems Duct Design'],
  velocityLimits: {
    mainTrunkNc30: 1100,
    mainTrunkNc35: 1300,
    mainTrunkNc40: 1500,
    branchNc30: 800,
    branchNc35: 950,
    branchNc40: 1100,
    runoutNc30: 600,
    runoutNc35: 750,
    runoutNc40: 850,
    returnDuct: 800,
    returnPlenum: 350,
    outdoorAirLouverFreeArea: 450
  },
  ductSizing: {
    maxFrictionLossPer100Ft: 0.08,
    maxAspectRatio: 3.0,
    preferredMaxHeightIn: 12
  },
  diffuserThrow: {
    minThrowRatio: 0.70,
    maxThrowRatio: 1.20,
    minReturnSupplyOffsetRatio: 0.65
  },
  tolerances: {
    airflowBalancePercent: 5.0,
    roomCfmDeltaMax: 40,
    staticPressureSafetyMarginPercent: 15.0
  }
};

export function getStandardsProfile(type: StandardsProfileType = 'ashrae'): StandardsProfile {
  switch (type) {
    case 'smacna':
      return SMACNA_PROFILE;
    case 'ashrae':
    default:
      return ASHRAE_PROFILE;
  }
}
