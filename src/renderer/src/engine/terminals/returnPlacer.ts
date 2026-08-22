import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from './terminalPlacer';
import { selectBestDiffuserFromCatalog } from './diffuserSelector';
import { getPolygonScanlineSpan, clampPointInsidePolygon } from '../geometry';

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

export function placeReturnGrillesForZone(
  zone: EquipmentServiceZone,
  supplyTerminals: CoordinatedAirTerminal[]
): CoordinatedAirTerminal[] {
  const returnCfm = zone.returnCfm || Math.round(zone.supplyCfm * 0.88);
  const bbox = getPolygonBoundingBox(zone.serviceAreaPolygon);
  const returns: CoordinatedAirTerminal[] = [];

  if (bbox.width > bbox.height * 1.3 && supplyTerminals.length >= 2) {
    const numReturns = Math.max(2, Math.min(4, supplyTerminals.length));
    const cfmPerReturn = Math.round(returnCfm / numReturns);
    const selected = selectBestDiffuserFromCatalog(cfmPerReturn, zone.targetNc);

    const yTop = bbox.minY + bbox.height * 0.25;
    const yBottom = bbox.minY + bbox.height * 0.75;
    const yMid = bbox.minY + bbox.height * 0.5;

    const spanTop = getPolygonScanlineSpan(yTop, zone.serviceAreaPolygon) || { minX: bbox.minX, maxX: bbox.maxX };
    const spanBottom = getPolygonScanlineSpan(yBottom, zone.serviceAreaPolygon) || { minX: bbox.minX, maxX: bbox.maxX };
    const spanMid = getPolygonScanlineSpan(yMid, zone.serviceAreaPolygon) || { minX: bbox.minX, maxX: bbox.maxX };

    // Symmetrical perimeter and inter-bay return slots strictly inside polygon with anti-short-circuit separation
    const returnSlots = numReturns === 2
      ? [
          { x: spanMid.minX + 1.0, y: yMid },
          { x: spanMid.maxX - 1.0, y: yMid }
        ]
      : [
          { x: spanTop.minX + 1.0, y: yTop },
          { x: spanBottom.minX + 1.0, y: yBottom },
          { x: spanTop.maxX - 1.0, y: yTop },
          { x: spanBottom.maxX - 1.0, y: yBottom }
        ];

    for (let i = 0; i < numReturns; i++) {
      const slot = returnSlots[i % returnSlots.length];
      const clamped = clampPointInsidePolygon(slot.x, slot.y, zone.serviceAreaPolygon, 1.0);

      returns.push({
        id: `RAG-${zone.unitTag}-${i + 1}`,
        unitId: zone.id,
        designControlMode: 'ai',
        type: 'return',
        subtype: 'eggcrate',
        position: { x: parseFloat(clamped.x.toFixed(2)), y: parseFloat(clamped.y.toFixed(2)) },
        cfm: cfmPerReturn,
        catalogModel: `${selected.catalogItem.manufacturer} Eggcrate Return ${selected.faceDimension}`,
        neckDimension: selected.neckDimension,
        faceDimension: selected.faceDimension,
        throwT50Ft: 0,
        throwRatio: 1.0,
        adjacentOverlapRatio: 0,
        occupiedZoneVelocityFpm: 35,
        ncRating: Math.max(15, selected.actualNc - 5),
        deltaPInWg: 0.025,
        status: 'pass'
      });
    }
  } else {
    // Perimeter anti-short-circuit placement for compact bays
    const numReturns = Math.max(1, Math.min(2, supplyTerminals.length));
    const cfmPerReturn = Math.round(returnCfm / numReturns);
    const selected = selectBestDiffuserFromCatalog(cfmPerReturn, zone.targetNc);

    for (let i = 1; i <= numReturns; i++) {
      const targetY = i % 2 === 0 ? bbox.minY + bbox.height * 0.20 : bbox.minY + bbox.height * 0.80;
      const span = getPolygonScanlineSpan(targetY, zone.serviceAreaPolygon) || { minX: bbox.minX, maxX: bbox.maxX };
      const rawX = i === 1 ? span.minX + (span.maxX - span.minX) * 0.08 : span.maxX - (span.maxX - span.minX) * 0.08;
      const clamped = clampPointInsidePolygon(rawX, targetY, zone.serviceAreaPolygon, 1.8);

      returns.push({
        id: `RAG-${zone.unitTag}-${i}`,
        unitId: zone.id,
        designControlMode: 'ai',
        type: 'return',
        subtype: 'eggcrate',
        position: { x: parseFloat(clamped.x.toFixed(2)), y: parseFloat(clamped.y.toFixed(2)) },
        cfm: cfmPerReturn,
        catalogModel: `${selected.catalogItem.manufacturer} Eggcrate Return ${selected.faceDimension}`,
        neckDimension: selected.neckDimension,
        faceDimension: selected.faceDimension,
        throwT50Ft: 0,
        throwRatio: 1.0,
        adjacentOverlapRatio: 0,
        occupiedZoneVelocityFpm: 35,
        ncRating: Math.max(15, selected.actualNc - 5),
        deltaPInWg: 0.025,
        status: 'pass'
      });
    }
  }

  return returns;
}
