import { AirDistributionDesignResult } from '../airDistributionEngine';
import { STANDARD_DIFFUSER_CATALOG } from '../hvacCatalogs';

export interface AirDistributionScheduleRow {
  roomName: string;
  designLoadBtu: number;
  requiredCfm: number;
  deliveredCfm: number;
  diffuserCount: number;
  cfmPerDiffuser: number;
  returnCfm: number;
  status: string;
}

export interface DuctScheduleRow {
  ductId: string;
  systemType: string;
  role: string;
  airflowCfm: number;
  sizeDimension: string;
  velocityFpm: number;
  pressureLossInWg: number;
  ncRating: number;
  status: string;
}

export interface DiffuserScheduleRow {
  terminalId: string;
  type: string;
  model: string;
  neckSize: string;
  faceSize: string;
  cfm: number;
  throwT50Ft: number;
  ncRating: number;
  status: string;
}

export interface EquipmentScheduleRow {
  unitTag: string;
  model: string;
  systemType: string;
  capacityBtu: number;
  supplyCfm: number;
  returnCfm: number;
  espInWg: number;
  controlMode: string;
  status: string;
}

export interface OutdoorAirScheduleRow {
  oaSystemId: string;
  unitTag: string;
  requiredOaCfm: number;
  deliveredOaCfm: number;
  louverModel: string;
  freeAreaSqFt: number;
  faceVelocityFpm: number;
  status: string;
}

export interface MasterSchedulesOutput {
  airDistributionSchedule: AirDistributionScheduleRow[];
  ductSchedule: DuctScheduleRow[];
  diffuserSchedule: DiffuserScheduleRow[];
  equipmentSchedule: EquipmentScheduleRow[];
  outdoorAirSchedule: OutdoorAirScheduleRow[];
}

export function generateMasterSchedules(design: AirDistributionDesignResult): MasterSchedulesOutput {
  const supplyTerminals = design.supplyTerminals;
  const returnTerminals = design.returnTerminals;
  const allTerminals = [...supplyTerminals, ...returnTerminals];

  const totalDeliveredCfm = supplyTerminals.reduce((sum, t) => sum + t.cfm, 0);
  const totalReturnCfm = returnTerminals.reduce((sum, t) => sum + t.cfm, 0);
  const totalLoad = design.serviceZones.reduce((sum, z) => sum + z.totalLoadBtu, 0);
  const avgCfmPerDiffuser = supplyTerminals.length > 0 ? Math.round(totalDeliveredCfm / supplyTerminals.length) : 0;

  // Per-diffuser airflow must sit inside the catalog operating envelope. A value
  // below the smallest diffuser's practical minimum (80% of its minCfm) means the
  // layout split the air too thin — flag it regardless of other validation points.
  const supplyCatalogItems = STANDARD_DIFFUSER_CATALOG.filter(
    (d) => d.terminalType === 'square-ceiling' || d.terminalType === 'round-ceiling' || d.terminalType === 'linear-slot'
  );
  const dbMinCfm = supplyCatalogItems.length > 0 ? Math.min(...supplyCatalogItems.map((d) => d.minCfm)) : 0;
  const perDiffuserFeasible =
    avgCfmPerDiffuser === 0 || avgCfmPerDiffuser >= dbMinCfm * 0.8;

  // 1. Air Distribution Schedule
  const airDistributionSchedule: AirDistributionScheduleRow[] = [
    {
      roomName: design.roomName,
      designLoadBtu: totalLoad,
      requiredCfm: design.selectedOption.totalDeliveredCfm,
      deliveredCfm: totalDeliveredCfm,
      diffuserCount: supplyTerminals.length,
      cfmPerDiffuser: avgCfmPerDiffuser,
      returnCfm: totalReturnCfm,
      status: perDiffuserFeasible ? design.validationReport.points[0].status : 'WARNING'
    }
  ];

  // 2. Duct Schedule
  const allDucts = [...design.supplyDucts, ...design.returnDucts];
  const ductSchedule: DuctScheduleRow[] = allDucts.map((d) => ({
    ductId: d.id,
    systemType: d.systemType.toUpperCase(),
    role: d.role,
    airflowCfm: d.airflowCfm,
    sizeDimension: `${d.widthIn}"x${d.heightIn}"`,
    velocityFpm: d.velocityFpm,
    pressureLossInWg: d.totalSectionLossInWg,
    ncRating: d.ncRating,
    status: d.velocityFpm <= d.allowableVelocityFpm ? 'PASS' : 'WARNING'
  }));

  // 3. Diffuser Schedule
  const diffuserSchedule: DiffuserScheduleRow[] = allTerminals.map((t) => ({
    terminalId: t.id,
    type: t.type.toUpperCase(),
    model: t.catalogModel,
    neckSize: t.neckDimension,
    faceSize: t.faceDimension,
    cfm: t.cfm,
    throwT50Ft: t.throwT50Ft,
    ncRating: t.ncRating,
    status: t.status.toUpperCase()
  }));

  // 4. Equipment Schedule
  const equipmentSchedule: EquipmentScheduleRow[] = design.serviceZones.map((z) => ({
    unitTag: z.unitTag,
    model: z.equipmentModel,
    systemType: z.equipmentType.toUpperCase(),
    capacityBtu: z.actualCapacityBtu,
    supplyCfm: z.supplyCfm,
    returnCfm: z.returnCfm,
    espInWg: z.espInWg,
    controlMode: z.designControlMode,
    status: 'PASS'
  }));

  // 5. Outdoor Air Schedule
  const oa = design.outdoorAirSystem;
  const outdoorAirSchedule: OutdoorAirScheduleRow[] = design.serviceZones.map((z) => ({
    oaSystemId: oa.id,
    unitTag: z.unitTag,
    requiredOaCfm: z.outdoorAirCfm,
    deliveredOaCfm: z.outdoorAirCfm,
    louverModel: oa.louver.model,
    freeAreaSqFt: oa.louver.freeAreaSqFt,
    faceVelocityFpm: oa.louver.freeAreaVelocityFpm,
    status: oa.louver.freeAreaVelocityFpm <= oa.louver.maxAllowableFreeAreaVelocityFpm ? 'PASS' : 'WARNING'
  }));

  return {
    airDistributionSchedule,
    ductSchedule,
    diffuserSchedule,
    equipmentSchedule,
    outdoorAirSchedule
  };
}
