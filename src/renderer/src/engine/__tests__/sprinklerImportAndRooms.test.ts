/** K1 — NFPA 13 sprinkler data, robust DXF floor-plan import (units, layers, closed polylines, texts), room detection. */
import { importFloorPlanDxf } from '../fireProtection/sprinkler/floorPlanImport';
import { detectRooms, polygonArea, pointInPolygon, distanceToPolygonEdges } from '../fireProtection/sprinkler/roomDetection';
import {
  SPRINKLER_OCCUPANCIES, SPACING_RULES, spacingClass, PIPE_SCHEDULE_LIMITS, pipeScheduleSize, occupancyFromName,
  spareHeadCount, hazenC, hangerSpacingM, QUESTIONNAIRE, defaultSprinklerAnswers, recommendedSystemType,
  MIN_SPRINKLER_SPACING_MM, MIN_WALL_DISTANCE_MM, DRY_DELIVERY_TIME_S, DRY_AREA_INCREASE
} from '../fireProtection/sprinkler/nfpa13Sprinkler';
import { buildSamplePlanDxf } from './sprinklerSamplePlan';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(`Assertion Failed: ${m}`);
}
const near = (a: number, e: number, tol: number, m: string): void => assert(Math.abs(a - e) <= tol, `${m}: expected ${e}±${tol}, got ${a}`);

console.log('=== Sprinkler K1: standards, import, rooms ===');
{
  assert(SPACING_RULES.light.maxAreaFt2 === 225 && SPACING_RULES.ordinary.maxAreaFt2 === 130 && SPACING_RULES.extra.maxSpacingFt === 12, 'spacing rules');
  assert(spacingClass('ordinary-2') === 'ordinary' && spacingClass('extra-1') === 'extra', 'spacing class');
  assert(PIPE_SCHEDULE_LIMITS.light[2.5] === 30 && PIPE_SCHEDULE_LIMITS.ordinary[3] === 40 && PIPE_SCHEDULE_LIMITS.extra[2] === 8, 'pipe schedule');
  assert(pipeScheduleSize(5, 'light') === 1.5 && pipeScheduleSize(15, 'light') === 2.5 && pipeScheduleSize(11, 'ordinary') === 2.5 && pipeScheduleSize(1, 'extra') === 1, 'schedule sizing');
  assert(MIN_SPRINKLER_SPACING_MM === 1829 && MIN_WALL_DISTANCE_MM === 102 && DRY_AREA_INCREASE === 1.3, 'constants');
  assert(DRY_DELIVERY_TIME_S.light === 60 && DRY_DELIVERY_TIME_S.extra === 45, 'dry delivery');
  assert(spareHeadCount(300) === 6 && spareHeadCount(301) === 12 && spareHeadCount(1001) === 24, 'spares');
  assert(hazenC('black-steel-sch40', 'wet') === 120 && hazenC('black-steel-sch40', 'dry') === 100 && hazenC('cpvc', 'wet') === 150, 'C factors');
  assert(hangerSpacingM(1, 'black-steel-sch40') === 3.66 && hangerSpacingM(2, 'black-steel-sch40') === 4.57, 'hangers');
  assert(occupancyFromName('STORAGE ROOM', 'office') === 'storage' && occupancyFromName('Server Room', 'office') === 'data', 'occupancy keywords');
  assert(occupancyFromName('Room 7', 'parking') === 'parking' && occupancyFromName('Kitchen', 'hotel') === 'kitchen', 'occupancy defaults');
  assert(SPRINKLER_OCCUPANCIES.storage.hazard === 'ordinary-2' && SPRINKLER_OCCUPANCIES.office.hazard === 'light', 'occupancy hazards');
  const a = defaultSprinklerAnswers();
  assert(QUESTIONNAIRE.length >= 10 && QUESTIONNAIRE.every((q) => q.question.length > 10 && q.help.length > 10), 'questionnaire');
  assert(QUESTIONNAIRE.some((q) => /NFPA 13/.test(q.help)), 'questionnaire cites NFPA 13');
  const room = { hazard: 'light' as const, occupancy: 'office', freezing: false };
  assert(recommendedSystemType(a, room) === 'wet', 'wet by default');
  assert(recommendedSystemType(a, { ...room, freezing: true }) === 'dry', 'freezing → dry');
  assert(recommendedSystemType({ ...a, waterSensitiveAreas: true }, { ...room, occupancy: 'data' }) === 'preaction-single', 'data → preaction');
  assert(recommendedSystemType({ ...a, delugeHazard: true }, { ...room, hazard: 'extra-2' }) === 'deluge', 'deluge');
  console.log('✓ NFPA 13 sprinkler data & questionnaire');
}
{
  const plan = importFloorPlanDxf(buildSamplePlanDxf({ insunits: 4 }));
  assert(plan.declaredUnits === 'mm' && plan.units === 'mm' && plan.scaleToMm === 1, 'mm units');
  const rooms = plan.layers.find((l) => l.name === 'A-ROOM')!;
  assert(rooms.closedPolylines === 5, `A-ROOM closed polylines 5 (incl. dup, POLYLINE, coincident end, closet), got ${rooms.closedPolylines}`);
  assert(plan.warnings.some((w) => /INSERT/.test(w)), 'INSERT warning');
  assert(plan.entities.some((e) => e.kind === 'text' && e.text === 'STORAGE ROOM'), 'MTEXT cleaned');
  const corridor = plan.entities.find((e) => e.kind === 'polyline' && e.layer === 'A-ROOM' && e.points.length === 4 && e.points[0][1] === 12500)!;
  assert(!!corridor && corridor.closed, 'coincident-end polyline closed, duplicate vertex removed');
  near(plan.bbox.maxX, 31000, 1, 'bbox');

  const det = detectRooms(plan, ['A-ROOM', 'A-WALL'], { buildingType: 'office', ceilingHeightM: 3, ceilingType: 'finished-flat' });
  assert(det.length === 3, `3 rooms (outline, duplicate, closet removed), got ${det.length}: ${det.map((r) => r.name)}`);
  assert(det.map((r) => r.id).join() === 'R1,R2,R3', 'ids');
  assert(det[0].name === 'Room 1' && det[1].name === 'OPEN OFFICE' && det[2].name === 'STORAGE ROOM', `names ${det.map((r) => r.name)}`);
  assert(det[1].occupancy === 'office' && det[1].hazard === 'light' && det[2].hazard === 'ordinary-2' && det[0].hazard === 'light', 'hazards');
  near(polygonArea(det[1].polygon) / 1e6, 240, 0.01, 'office area');
  assert(det.every((r) => r.ceilingHeightM === 3 && r.ceilingType === 'finished-flat' && !r.omit), 'defaults');
  assert(pointInPolygon(10000, 6000, det[1].polygon) && !pointInPolygon(25000, 6000, det[1].polygon), 'point in polygon');
  near(distanceToPolygonEdges(2000, 2000, det[1].polygon), 2000, 0.01, 'edge distance');

  const m = importFloorPlanDxf(buildSamplePlanDxf({ insunits: 6, factor: 0.001 }));
  assert(m.units === 'm' && m.scaleToMm === 1000, 'metre plan');
  const dm = detectRooms(m, ['A-ROOM'], { buildingType: 'office', ceilingHeightM: 3, ceilingType: 'finished-flat' });
  near(polygonArea(dm.find((r) => r.name === 'OPEN OFFICE')!.polygon) / 1e6, 240, 0.01, 'metre plan scaled to mm');
  const u = importFloorPlanDxf(buildSamplePlanDxf({ factor: 0.001 }));
  assert(u.declaredUnits === 'unknown' && u.units === 'm' && u.warnings.some((w) => /unit/i.test(w)), 'unknown units inferred');
  const forced = importFloorPlanDxf(buildSamplePlanDxf({ factor: 0.001 }), 'm');
  assert(forced.units === 'm' && !forced.warnings.some((w) => /unit/i.test(w)), 'override units');
  console.log('✓ DXF import & room detection');
}
console.log('\nAll sprinkler K1 tests passed.');
