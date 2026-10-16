export interface ExteriorWallInfo {
  side: 'north' | 'south' | 'east' | 'west';
  glassRatio?: number;       // e.g. 0.5 (50% window-to-wall)
  solarGainFactor?: number;  // e.g. 1.3
}

export interface SolarWeightingInput {
  unitCount: number;
  exteriorWalls?: ExteriorWallInfo[];
}

export function calculateSolarLoadWeights(input: SolarWeightingInput): number[] {
  const { unitCount, exteriorWalls = [] } = input;
  if (unitCount <= 1) return [1.0];

  const rawWeights = new Array(unitCount).fill(1.0);

  // If south or west wall has high solar exposure, bias the first or last bay depending on orientation
  for (const wall of exteriorWalls) {
    const factor = wall.solarGainFactor || (1.0 + (wall.glassRatio || 0.3) * 0.8);
    if (wall.side === 'south' || wall.side === 'east') {
      rawWeights[0] *= factor;
    } else if (wall.side === 'west') {
      rawWeights[unitCount - 1] *= factor;
    } else if (wall.side === 'north') {
      // North glazing sees only diffuse sky radiation: apply 25% of the bonus to the middle bay.
      rawWeights[Math.floor(unitCount / 2)] *= 1 + (factor - 1) * 0.25;
    }
  }

  // Normalize so sum equals exactly 1.0: round bays 0..n-2 to 3 dp, last bay takes the remainder.
  const sum = rawWeights.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < unitCount - 1; i++) {
    const w = Math.round((rawWeights[i] / sum) * 1000) / 1000;
    out.push(w);
    acc += w;
  }
  out.push(Math.max(0, Math.round((1 - acc) * 1e9) / 1e9));
  return out;
}
