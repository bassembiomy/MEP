import { placeDiffusersWithCircularOptimization, DiffuserPos } from '../diffuserPlacer';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { placeReturnGrillesForZone } from '../terminals/returnPlacer';
import { EquipmentServiceZone } from '../zoning/zonePartitioner';

export function adaptPlaceTerminals(
  points: number[],
  totalCfm: number,
  spaceNcLimit: number = 30,
  coverageTargetPercent: number = 95,
  systemType: 'concealed' | 'cassette' | 'high-wall' | 'packaged' | 'vrf' | 'ahu' | 'fcu' = 'concealed',
  unitId: string = 'unit-1'
): CoordinatedAirTerminal[] {
  if (!points || points.length < 6 || totalCfm <= 0) return [];

  const rawPositions: DiffuserPos[] = placeDiffusersWithCircularOptimization(
    points,
    totalCfm,
    true,
    10,
    1.0, // Scale is 1 unit = 1 ft
    [],
    systemType,
    totalCfm * 30,
    {
      spaceNcLimit,
      coverageTargetPercent,
      throwRadiusMode: 'catalog-t50'
    }
  );

  const supplyPositions = rawPositions.filter(p => p.type !== 'return' && p.type !== 'exhaust');
  const count = supplyPositions.length;
  if (count === 0) return [];

  const baseCfm = Math.floor(totalCfm / count);
  const remainder = totalCfm - baseCfm * count;

  return supplyPositions.map((p, index) => {
    const allocatedCfm = baseCfm + Math.max(0, Math.min(1, remainder - index));

    return {
      id: p.id ? `${unitId}-${p.id}` : `${unitId}-T-${index + 1}`,
      unitId,
      designControlMode: 'ai' as const,
      type: 'supply' as const,
      subtype: '4-way-ceiling' as const,
      position: { x: p.x, y: p.y },
      cfm: allocatedCfm,
      catalogModel: p.size || '12"x12"',
      neckDimension: '8" Round',
      faceDimension: '24"x24"',
      throwT50Ft: p.throwT50Ft ?? 0,
      throwRatio: 1.0,
      adjacentOverlapRatio: 0.1,
      occupiedZoneVelocityFpm: 40,
      ncRating: p.actualNc ?? spaceNcLimit,
      deltaPInWg: p.deltaPInWg ?? 0,
      status: 'pass' as const
    };
  });
}

export function adaptPlaceReturnGrilles(
  zone: EquipmentServiceZone,
  supplyTerminals: CoordinatedAirTerminal[]
): CoordinatedAirTerminal[] {
  return placeReturnGrillesForZone(zone, supplyTerminals);
}
