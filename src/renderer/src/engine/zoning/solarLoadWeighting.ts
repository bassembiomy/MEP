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
    }
  }

  // Normalize so sum equals 1.0
  const sum = rawWeights.reduce((a, b) => a + b, 0);
  return rawWeights.map((w) => w / sum);
}
