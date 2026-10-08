export interface LoadDistributionInput {
  totalSensibleBtu: number;
  totalLatentBtu: number;
  totalCfm: number;
  totalOutdoorAirCfm: number;
  weights: number[];
}

export interface ZoneLoadSlice {
  zoneIndex: number;
  sensibleBtu: number;
  latentBtu: number;
  totalBtu: number;
  supplyCfm: number;
  returnCfm: number;
  outdoorAirCfm: number;
}

export function distributeLoadsAcrossZones(input: LoadDistributionInput): ZoneLoadSlice[] {
  const { totalSensibleBtu, totalLatentBtu, totalCfm, totalOutdoorAirCfm, weights } = input;
  const n = weights.length;
  const slices: ZoneLoadSlice[] = [];

  let accumulatedSensible = 0;
  let accumulatedLatent = 0;
  let accumulatedCfm = 0;
  let accumulatedOa = 0;

  for (let i = 0; i < n; i++) {
    const w = weights[i];
    const isLast = i === n - 1;

    const sensible = isLast ? totalSensibleBtu - accumulatedSensible : totalSensibleBtu * w;
    const latent = isLast ? totalLatentBtu - accumulatedLatent : totalLatentBtu * w;
    const cfm = isLast ? totalCfm - accumulatedCfm : totalCfm * w;
    const oa = isLast ? totalOutdoorAirCfm - accumulatedOa : totalOutdoorAirCfm * w;

    accumulatedSensible += sensible;
    accumulatedLatent += latent;
    accumulatedCfm += cfm;
    accumulatedOa += oa;

    slices.push({
      zoneIndex: i,
      sensibleBtu: sensible,
      latentBtu: latent,
      totalBtu: sensible + latent,
      supplyCfm: cfm,
      // Outdoor air is included in supply, not a room exhaust sink.
      returnCfm: cfm,
      outdoorAirCfm: oa
    });
  }

  return slices;
}
