import { EquipmentServiceZone, DesignControlMode } from '../zoning/zonePartitioner';
import { selectBestDiffuserFromCatalog } from './diffuserSelector';
import { getPolygonScanlineSpan, clampPointInsidePolygon } from '../geometry';

export interface CoordinatedAirTerminal {
  id: string;
  unitId: string;
  designControlMode: DesignControlMode;
  type: 'supply' | 'return' | 'exhaust' | 'outdoor-intake';
  subtype: '4-way-ceiling' | '2-way' | 'linear-slot' | 'swirl' | 'eggcrate' | 'perforated' | 'sidewall';
  position: { x: number; y: number };
  cfm: number;
  catalogModel: string;
  neckDimension: string;
  faceDimension: string;
  throwT50Ft: number;
  throwRatio: number;
  adjacentOverlapRatio: number;
  occupiedZoneVelocityFpm: number;
  ncRating: number;
  deltaPInWg: number;
  status: 'pass' | 'warning' | 'fail';
}

function getPolygonBoundingBox(points: number[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

export function placeSupplyDiffusersForZone(
  zone: EquipmentServiceZone,
  options: { targetCfmPerDiffuser?: number } = {}
): CoordinatedAirTerminal[] {
  const { targetCfmPerDiffuser = 350 } = options;
  const zoneCfm = zone.supplyCfm;
  const numDiffusers = Math.max(1, Math.round(zoneCfm / targetCfmPerDiffuser));
  const cfmPerDiffuser = Math.round(zoneCfm / numDiffusers);

  const selected = selectBestDiffuserFromCatalog(cfmPerDiffuser, zone.targetNc);
  const bbox = getPolygonBoundingBox(zone.serviceAreaPolygon);

  const terminals: CoordinatedAirTerminal[] = [];
  let remainingCfm = zoneCfm;

  if (bbox.width > bbox.height * 1.3 && numDiffusers >= 2) {
    // Symmetrical 2-row alternating grid (Top/Bottom branch distribution)
    const cols = numDiffusers >= 4 ? 4 : numDiffusers;
    const yTop = bbox.minY + bbox.height * 0.25;
    const yBottom = bbox.minY + bbox.height * 0.75;

    // Place supply diffusers in alternating/balanced positions across the 4 columns
    const slotPositions = [
      { col: 1, y: yBottom },
      { col: 2, y: yTop },
      { col: 3, y: yBottom },
      { col: 4, y: yTop }
    ];

    for (let i = 0; i < numDiffusers; i++) {
      const isLast = i === numDiffusers - 1;
      const thisCfm = isLast ? remainingCfm : cfmPerDiffuser;
      remainingCfm -= thisCfm;

      const slot = slotPositions[i % slotPositions.length];
      const span = getPolygonScanlineSpan(slot.y, zone.serviceAreaPolygon) || { minX: bbox.minX, maxX: bbox.maxX };
      const bayW = span.maxX - span.minX;
      const colStep = bayW / (cols + 1);
      const rawX = span.minX + slot.col * colStep;
      const clamped = clampPointInsidePolygon(rawX, slot.y, zone.serviceAreaPolygon, 2.0);

      const characteristicLength = Math.max(10, bayW / cols);
      const throwRatio = parseFloat((selected.throwT50Ft / characteristicLength).toFixed(2));

      terminals.push({
        id: `SAD-${zone.unitTag}-${i + 1}`,
        unitId: zone.id,
        designControlMode: 'ai',
        type: 'supply',
        subtype: '4-way-ceiling',
        position: { x: parseFloat(clamped.x.toFixed(2)), y: parseFloat(clamped.y.toFixed(2)) },
        cfm: thisCfm,
        catalogModel: selected.model,
        neckDimension: selected.neckDimension,
        faceDimension: selected.faceDimension,
        throwT50Ft: selected.throwT50Ft,
        throwRatio,
        adjacentOverlapRatio: 0.85,
        occupiedZoneVelocityFpm: 40,
        ncRating: selected.actualNc,
        deltaPInWg: selected.deltaPInWg,
        status: throwRatio >= 0.70 && throwRatio <= 1.30 ? 'pass' : 'warning'
      });
    }
  } else {
    // Standard orthogonal centroid grid for square or compact bays
    const isWider = bbox.width >= bbox.height;
    const cols = isWider ? numDiffusers : 1;
    const rows = isWider ? 1 : numDiffusers;

    const colStep = bbox.width / (cols + 1);
    const rowStep = bbox.height / (rows + 1);

    let terminalIndex = 1;
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        const isLast = terminalIndex === numDiffusers;
        const thisCfm = isLast ? remainingCfm : cfmPerDiffuser;
        remainingCfm -= thisCfm;

        const posX = bbox.minX + c * colStep;
        const posY = bbox.minY + r * rowStep;

        const moduleWidth = bbox.width / cols;
        const moduleHeight = bbox.height / rows;
        const characteristicLength = Math.max(6, Math.sqrt(moduleWidth * moduleHeight));
        const throwRatio = parseFloat((selected.throwT50Ft / characteristicLength).toFixed(2));

        terminals.push({
          id: `SAD-${zone.unitTag}-${terminalIndex}`,
          unitId: zone.id,
          designControlMode: 'ai',
          type: 'supply',
          subtype: '4-way-ceiling',
          position: { x: parseFloat(posX.toFixed(2)), y: parseFloat(posY.toFixed(2)) },
          cfm: thisCfm,
          catalogModel: selected.model,
          neckDimension: selected.neckDimension,
          faceDimension: selected.faceDimension,
          throwT50Ft: selected.throwT50Ft,
          throwRatio,
          adjacentOverlapRatio: 0.85,
          occupiedZoneVelocityFpm: 40,
          ncRating: selected.actualNc,
          deltaPInWg: selected.deltaPInWg,
          status: throwRatio >= 0.70 && throwRatio <= 1.30 ? 'pass' : 'warning'
        });

        terminalIndex++;
        if (terminalIndex > numDiffusers) break;
      }
    }
  }

  return terminals;
}
