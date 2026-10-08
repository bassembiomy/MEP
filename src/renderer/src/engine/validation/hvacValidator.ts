import type { EquipmentServiceZone } from '../zoning/zonePartitioner';
import type { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import type { SteppedDuctSection } from '../ducts/steppedDuctRouter';
import type { OutdoorAirSystem } from '../outdoorAir/freshAirRouter';
import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';
import { ValidationPointResult, validateSupplyAirflowBalance, validateRoomAirflowVerification } from './airflowValidator';
import { validateSystemAirMassBalance } from './massBalanceValidator';
import { validateAcousticCompliance } from './acousticValidator';
import { validateCriticalPathPressure } from './pressureValidator';
import { validateThrowAndThermalComfort } from './comfortValidator';
import { validateSpatialCoordination, isPointInOrOnPolygon } from './spatialValidator';
import { adaptZoneGeometry } from '../adapters/zoningAdapter';

export interface RoomValidationInput {
  zoneId: string;
  polygon: number[];
  requiredCfm: number;
  designLoadBtu: number;
}

export interface MasterValidationInput {
  roomName: string;
  roomPolygon: number[];
  requiredRoomCfm: number;
  designLoadBtu: number;
  zones: EquipmentServiceZone[];
  terminals: CoordinatedAirTerminal[];
  ducts: SteppedDuctSection[];
  rooms?: RoomValidationInput[];
  outdoorAirSystem?: OutdoorAirSystem;
  profile?: StandardsProfile;
  coverageTargetPercent?: number;
}

export interface MasterValidationReport {
  overallStatus: 'PASS' | 'WARNING' | 'FAIL';
  summary: string;
  points: ValidationPointResult[];
  timestamp: string;
  issueReady?: boolean;
  verificationScope?: 'preliminary';
  limitations?: string[];
}

export function executeMasterHvacValidation(input: MasterValidationInput): MasterValidationReport {
  const { zones, terminals, ducts, profile = ASHRAE_PROFILE } = input;
  const points: ValidationPointResult[] = [];
  const failure = (message: string, pointIndex = 0, zoneId?: string): void => {
    points.push({ pointIndex, pointName: 'Required Engineering Evidence', zoneId, status: 'FAIL',
      metric: 'Missing or invalid evidence', criteria: 'Complete finite inputs and associated equipment', message });
  };
  if (!zones.length) failure('No selected equipment or service zones');
  if (![input.requiredRoomCfm, input.designLoadBtu].every(v => Number.isFinite(v) && v >= 0)) failure('Invalid project load or airflow');
  const ids = new Set<string>();
  for (const z of zones) {
    if (ids.has(z.id)) failure(`Duplicate service zone ${z.id}`);
    ids.add(z.id);
    if (!adaptZoneGeometry(z.id, z.serviceAreaPolygon).valid) failure(`Invalid service polygon ${z.id}`, 9, z.id);
    if (![z.supplyCfm, z.returnCfm, z.outdoorAirCfm, z.actualCapacityBtu, z.totalLoadBtu,
        z.sensibleLoadBtu, z.latentLoadBtu, z.espInWg, z.targetNc].every(v => Number.isFinite(v) && v >= 0)) failure(`Invalid engineering values for ${z.id}`);
  }
  const terminalIds = new Set<string>();
  for (const t of terminals) {
    if (terminalIds.has(t.id)) failure(`Duplicate terminal ${t.id}`);
    terminalIds.add(t.id);
    if (!ids.has(t.unitId)) failure(`Terminal ${t.id} has no equipment owner`);
    if (![t.cfm, t.position.x, t.position.y, t.ncRating, t.deltaPInWg].every(Number.isFinite) || t.cfm < 0 || t.deltaPInWg < 0) failure(`Invalid terminal ${t.id}`);
  }
  const ductIds = new Set<string>();
  for (const duct of ducts) {
    if (ductIds.has(duct.id)) failure(`Duplicate duct ${duct.id}`);
    ductIds.add(duct.id);
    if (!ids.has(duct.unitId)) failure(`Duct ${duct.id} has no equipment owner`);
    if (![duct.airflowCfm, duct.widthIn, duct.heightIn, duct.velocityFpm].every(Number.isFinite) ||
        duct.airflowCfm < 0 || duct.widthIn <= 0 || duct.heightIn <= 0) failure(`Invalid duct engineering evidence ${duct.id}`);
  }
  for (const room of input.rooms ?? []) {
    if (!ids.has(room.zoneId)) failure(`No feasible selected equipment for room ${room.zoneId}`, 8, room.zoneId);
    if (!adaptZoneGeometry(room.zoneId, room.polygon).valid) failure(`Invalid room ${room.zoneId}`, 9, room.zoneId);
  }

  for (const z of zones) {
    const zoneTerminals = terminals.filter(t => t.unitId === z.id);
    const zoneDucts = ducts.filter(d => d.unitId === z.id);
    const room = input.rooms?.find(r => r.zoneId === z.id);
    const polygon = room?.polygon ?? z.serviceAreaPolygon;
    const requiredCfm = room?.requiredCfm ?? z.supplyCfm;
    const designLoad = room?.designLoadBtu ?? z.totalLoadBtu;
    const add = (point: ValidationPointResult): void => { points.push({ ...point, zoneId: z.id }); };
    add(validateSupplyAirflowBalance([z], zoneTerminals, profile));
    add(validateRoomAirflowVerification(requiredCfm, zoneTerminals, profile));
    add(validateSystemAirMassBalance([z]));
    if (z.isDucted !== false) {
      const actualReturn=zoneTerminals.filter(t=>t.type==='return').reduce((sum,t)=>sum+t.cfm,0);
      const tolerance=profile.tolerances.airflowBalancePercent;
      if (!Number.isFinite(actualReturn) || Math.abs(actualReturn-z.returnCfm)>Math.max(1,z.returnCfm*tolerance/100))
        failure(`${z.id}: return grille airflow ${actualReturn} CFM does not match required ${z.returnCfm} CFM`,3,z.id);
    }
    const velocityViolation = zoneDucts.some(d => !Number.isFinite(d.velocityFpm) || !Number.isFinite(d.allowableVelocityFpm) ||
      d.velocityFpm < 0 || d.allowableVelocityFpm <= 0 || d.velocityFpm > d.allowableVelocityFpm);
    add({ pointIndex: 4, pointName: 'Velocity Compliance Check', status: velocityViolation ? 'FAIL' : 'PASS',
      metric: `Maximum velocity ${Math.max(0, ...zoneDucts.map(d => d.velocityFpm))} FPM`,
      criteria: 'Calculated section velocity <= section allowable velocity',
      message: velocityViolation ? 'One or more section velocities violate limits or lack evidence' : 'Evaluated section velocities are within limits' });
    add(validateAcousticCompliance([z], zoneTerminals, zoneDucts));
    add(validateThrowAndThermalComfort(zoneTerminals, profile, polygon, input.coverageTargetPercent));
    add(validateCriticalPathPressure([z], zoneDucts, profile, zoneTerminals));
    const componentEvidence = [z.sensibleCapacityBtu,z.latentCapacityBtu].every(v=>v!==undefined && Number.isFinite(v) && v>=0);
    const sufficient = componentEvidence && Number.isFinite(designLoad) && z.actualCapacityBtu >= designLoad &&
      z.sensibleCapacityBtu! <= z.actualCapacityBtu && z.latentCapacityBtu! <= z.actualCapacityBtu &&
      z.sensibleCapacityBtu! >= z.sensibleLoadBtu && z.latentCapacityBtu! >= z.latentLoadBtu;
    add({ pointIndex: 8, pointName: 'Equipment Capacity & Load Match', status: sufficient ? 'PASS' : 'FAIL',
      metric: `${z.actualCapacityBtu} Btu/h capacity vs ${designLoad} Btu/h required`,
      criteria: 'Each unit total, sensible and latent capacities cover its assigned loads',
      message: sufficient ? 'Provided capacity values cover this service zone; operating-condition verification remains required' : `${z.id}: equipment is insufficient for its assigned load` });
    add(validateSpatialCoordination([z], zoneDucts, polygon, profile.ductSizing.maxAspectRatio));
    if (zoneTerminals.some(t => !isPointInOrOnPolygon(t.position.x, t.position.y, polygon))) failure(`${z.id}: terminal outside room`, 9, z.id);
    const longFlex = zoneTerminals.some(t => ((t as CoordinatedAirTerminal & { flexibleDuctLengthFt?: number }).flexibleDuctLengthFt ?? 0) > 14);
    const needsDetector = z.isDucted !== false && z.supplyCfm > 2000;
    const hasDetector = zoneDucts.some(d => d.systemType === 'supply' && d.accessories?.some(a => a.type === 'duct-smoke-detector'));
    const safetyFailure = longFlex || (needsDetector && !hasDetector);
    add({ pointIndex: 10, pointName: 'Preliminary Safety Accessories', status: safetyFailure ? 'FAIL' : 'PASS',
      metric: `Unit airflow ${z.supplyCfm} CFM; smoke-detector association ${needsDetector ? hasDetector ? 'present' : 'missing' : 'not triggered by configured threshold'}`,
      criteria: 'Configured detector/length checks per equipment unit; barrier and damper review required',
      message: safetyFailure ? 'Required configured accessory or flexible-length check failed' : 'Evaluated accessory checks pass; rated barriers and full safety compliance are unverified' });
  }
  // Keep project totals as additional constraints, never as a substitute for room checks.
  if (zones.reduce((s, z) => s + z.actualCapacityBtu, 0) < input.designLoadBtu) failure('Project capacity is below the design load', 8);
  if (zones.reduce((s, z) => s + z.supplyCfm, 0) < input.requiredRoomCfm - 1) failure('Selected project airflow is below required airflow', 2);
  if (input.outdoorAirSystem) {
    const balance = validateSystemAirMassBalance(zones, input.outdoorAirSystem);
    if (balance.status !== 'PASS') points.push(balance);
  }
  const overallStatus = points.some(p => p.status === 'FAIL') ? 'FAIL' : points.some(p => p.status === 'WARNING') ? 'WARNING' : 'PASS';
  return {
    overallStatus, points, timestamp: new Date().toISOString(), issueReady: false, verificationScope: 'preliminary',
    summary: `${overallStatus}: ${points.filter(p => p.status === 'FAIL').length} failed check(s), ${points.filter(p => p.status === 'WARNING').length} warning(s). Preliminary evaluation; engineering issue is not verified.`,
    limitations: [
      'Loads use a preliminary envelope and internal-gain model; glazing, solar and building construction require detailed verification.',
      'Manufacturer capacities and fan performance require verification at project operating conditions.',
      'Spatial checks evaluate plan centerlines and declared dimensions; 3D clashes, rated barriers and maintenance clearances are unverified.',
      'Outdoor-air source connections, relief, exhaust and pressurization require complete system verification.',
      'Estimated throw coverage does not certify thermal comfort, occupied-zone velocity or standards compliance.'
    ]
  };
}
