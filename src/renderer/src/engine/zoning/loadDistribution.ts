export interface LoadDistributionInput {
  totalSensibleBtu: number;
  totalLatentBtu: number;
  totalCfm: number;
  totalOutdoorAirCfm: number;
  weights: number[];
  /** Total zone exhaust CFM (return = supply - exhaust - exfiltration). Default 0. */
  totalExhaustCfm?: number;
  /** Total building exfiltration CFM if modeled. Default 0. */
  totalExfiltrationCfm?: number;
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
  const { totalSensibleBtu, totalLatentBtu, totalCfm, totalOutdoorAirCfm } = input;
  const totalExhaust = Math.max(0, input.totalExhaustCfm ?? 0);
  const totalExfil = Math.max(0, input.totalExfiltrationCfm ?? 0);
  const n = input.weights.length;

  // Validate weights: clamp negatives / non-finite, normalise so they sum to exactly 1.
  const clean = input.weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const wSum = clean.reduce((a, b) => a + b, 0);
  const weights = wSum > 0 ? clean.map((w) => w / wSum) : clean.map(() => (n > 0 ? 1 / n : 0));
  const slices: ZoneLoadSlice[] = [];

  let accumulatedSensible = 0;
  let accumulatedLatent = 0;
  let accumulatedCfm = 0;
  let accumulatedOa = 0;

  for (let i = 0; i < n; i++) {
    const w = weights[i];
    const isLast = i === n - 1;

    const sensible = Math.max(0, isLast ? totalSensibleBtu - accumulatedSensible : Math.round(totalSensibleBtu * w));
    const latent = Math.max(0, isLast ? totalLatentBtu - accumulatedLatent : Math.round(totalLatentBtu * w));
    const cfm = Math.max(0, isLast ? totalCfm - accumulatedCfm : Math.round(totalCfm * w));
    const oa = Math.max(0, isLast ? totalOutdoorAirCfm - accumulatedOa : Math.round(totalOutdoorAirCfm * w));

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
      // Return = supply - exhaust - exfiltration (mass balance), never negative.
      returnCfm: Math.max(0, cfm - Math.round((totalExhaust + totalExfil) * w)),
      outdoorAirCfm: oa
    });
  }

  return slices;
}
