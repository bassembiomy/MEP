import { DiffuserCatalogItem } from '../types';
import { STANDARD_DIFFUSER_CATALOG } from '../hvacCatalogs';

export interface SelectedDiffuserResult {
  catalogItem: DiffuserCatalogItem;
  model: string;
  faceDimension: string;
  neckDimension: string;
  nominalCfm: number;
  actualNc: number;
  throwT50Ft: number;
  deltaPInWg: number;
}

export function selectBestDiffuserFromCatalog(
  cfmPerTerminal: number,
  spaceNcLimit: number = 30,
  terminalType: string = 'square-ceiling',
  catalog: DiffuserCatalogItem[] = STANDARD_DIFFUSER_CATALOG
): SelectedDiffuserResult {
  const candidates = catalog.filter(
    (d) => d.terminalType === terminalType || d.terminalType === 'square-ceiling' || d.terminalType === 'round-ceiling'
  );

  let bestMatch = candidates[0] || catalog[0];
  let minDiff = Infinity;
  let bestNc = 22;
  let bestThrow = 10;
  let bestDeltaP = 0.035;

  for (const item of candidates) {
    if (item.performanceTable && item.performanceTable.length > 0) {
      if (cfmPerTerminal >= item.minCfm * 0.75 && cfmPerTerminal <= item.maxCfm * 1.25) {
        const sorted = [...item.performanceTable].sort(
          (a, b) => Math.abs(a.cfm - cfmPerTerminal) - Math.abs(b.cfm - cfmPerTerminal)
        );
        const point = sorted[0];

        if (point.ncRating <= spaceNcLimit + 2) {
          const diff = Math.abs(point.cfm - cfmPerTerminal);
          if (diff < minDiff) {
            minDiff = diff;
            bestMatch = item;
            bestNc = point.ncRating;
            bestThrow = point.throwFt.t50;
            bestDeltaP = point.deltaPInWg;
          }
        }
      }
    }
  }

  const faceDim = bestMatch.faceSizeIn ? `${bestMatch.faceSizeIn.width}"x${bestMatch.faceSizeIn.height}"` : '24"x24"';
  const neckDim = bestMatch.neckSizeIn
    ? (bestMatch.neckSizeIn.diameter ? `${bestMatch.neckSizeIn.diameter}" dia` : `${bestMatch.neckSizeIn.width}"x${bestMatch.neckSizeIn.height}"`)
    : '10"x10"';

  return {
    catalogItem: bestMatch,
    model: `${bestMatch.manufacturer} ${bestMatch.model}`,
    faceDimension: faceDim,
    neckDimension: neckDim,
    nominalCfm: cfmPerTerminal,
    actualNc: bestNc,
    throwT50Ft: bestThrow,
    deltaPInWg: bestDeltaP
  };
}
