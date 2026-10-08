import { HVACDesignPhase, HVACDesignContext, HVACDesignArtifacts, DesignDecisionLog, createEmptyDesignArtifacts } from './orchestratorTypes';
import { DesignStateMachine } from './designStateMachine';
import { adaptZoneGeometry, normalizePolygonToFeet } from '../adapters/zoningAdapter';
import { adaptCalculateLoadAndAirflow } from '../adapters/loadAirflowAdapter';
import { adaptSelectEquipment } from '../adapters/equipmentAdapter';
import { adaptPlaceTerminals, adaptPlaceReturnGrilles } from '../adapters/terminalAdapter';
import { adaptRouteAndSizeDucts } from '../adapters/ductAdapter';
import { adaptValidateHvacDesign } from '../adapters/validationAdapter';
import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { ASHRAE_SPACE_TYPES } from '../knowledgeBase';
import { isPointInPolygon, getPolygonScanlineSpan } from '../geometry';
import { routeReturnDucts } from '../ducts/returnDuctRouter';
import { sizeDuctNetwork } from '../ducts/aerodynamicDuctSizer';
import type { MasterValidationReport } from '../validation/hvacValidator';

export interface HVACZoneInput {
  id: string;
  name: string;
  polygon: number[]; // Project drawing units; normalized to feet at the workflow boundary.
  ceilingHeightFt?: number;
  occupancy?: number;
  spaceTypeId?: string;
  lightingWattsPerSqFt?: number;
  equipmentWattsPerSqFt?: number;
  manualLoadBtu?: number;
  manualCfm?: number;
  systemType?: 'high-wall' | 'cassette' | 'concealed' | 'packaged' | 'vrf' | 'ahu' | 'fcu';
}

export const DESIGN_PHASE_ORDER: HVACDesignPhase[] = [
  HVACDesignPhase.INPUT_ANALYSIS, HVACDesignPhase.ZONE_VALIDATION,
  HVACDesignPhase.LOAD_ANALYSIS, HVACDesignPhase.AIRFLOW_CALCULATION,
  HVACDesignPhase.SYSTEM_SELECTION, HVACDesignPhase.EQUIPMENT_SELECTION,
  HVACDesignPhase.AIR_DISTRIBUTION, HVACDesignPhase.TERMINAL_SELECTION, HVACDesignPhase.TERMINAL_PLACEMENT,
  HVACDesignPhase.DUCT_TOPOLOGY, HVACDesignPhase.DUCT_ROUTING, HVACDesignPhase.DUCT_SIZING,
  HVACDesignPhase.PRESSURE_ANALYSIS, HVACDesignPhase.ACOUSTIC_VALIDATION,
  HVACDesignPhase.COMFORT_VALIDATION, HVACDesignPhase.FINAL_VALIDATION
];

export function normalizeWorkflowZones(zones: HVACZoneInput[], context: HVACDesignContext): HVACZoneInput[] {
  if (!zones.length) throw new RangeError('Project must contain at least one zone');
  const seen = new Set<string>();
  return zones.map(zone => {
    if (!zone.id?.trim() || seen.has(zone.id)) throw new RangeError(`Missing or duplicate zone ID: ${zone.id}`);
    seen.add(zone.id);
    let polygon: number[];
    try { polygon = normalizePolygonToFeet(zone.polygon, context.units, context.drawingUnitsPerLength); }
    catch (error) { throw new RangeError(`Zone '${zone.name}' geometry is invalid: ${error instanceof Error ? error.message : String(error)}`); }
    const geom = adaptZoneGeometry(zone.name, polygon, zone.ceilingHeightFt ?? 10);
    if (!geom.valid) throw new RangeError(`Zone '${zone.name}' geometry is invalid: ${geom.error}`);
    return { ...zone, polygon };
  });
}

/** Artifacts are always canonical feet/Btu/h/CFM, including partial recalculation. */
export function validateWorkflowArtifacts(zones: HVACZoneInput[], context: HVACDesignContext, artifacts: HVACDesignArtifacts): MasterValidationReport {
  const normalized = normalizeWorkflowZones(zones, context);
  return adaptValidateHvacDesign({
    roomName: normalized[0].name, roomPolygon: normalized[0].polygon,
    requiredRoomCfm: Object.values(artifacts.airflows).reduce((sum, value) => sum + value.supplyCfm, 0),
    designLoadBtu: Object.values(artifacts.loads).reduce((sum, value) => sum + value.totalBtu, 0),
    rooms: normalized.map(z => ({ zoneId: z.id, polygon: z.polygon,
      requiredCfm: artifacts.airflows[z.id]?.supplyCfm ?? NaN,
      designLoadBtu: artifacts.loads[z.id]?.totalBtu ?? NaN })),
    zones: artifacts.zones, terminals: [...artifacts.terminals, ...artifacts.returnGrilles],
    ducts: [...artifacts.ductNetwork, ...(artifacts.returnDuctNetwork ?? [])],
    profile: context.profile, coverageTargetPercent: context.coverageTargetPercent
  });
}

function equipmentPosition(polygon: number[], centroid: {x:number;y:number}): {x:number;y:number} {
  if (isPointInPolygon(centroid.x, centroid.y, polygon)) return centroid;
  // Centroids of concave rooms can be outside; choose an interior scanline point.
  const ys = polygon.filter((_, index) => index % 2 === 1).sort((a,b)=>a-b);
  for (let i=1;i<ys.length;i++) {
    const y=(ys[i-1]+ys[i])/2;
    const span=getPolygonScanlineSpan(y,polygon);
    if (span) {
      const x=(span.minX+span.maxX)/2;
      if (isPointInPolygon(x,y,polygon)) return {x,y};
    }
  }
  throw new RangeError('No interior equipment position found');
}

export async function executeDesignWorkflow(
  zonesInput: HVACZoneInput[], context: HVACDesignContext, stateMachine: DesignStateMachine,
  decisionLog: DesignDecisionLog[], startPhase: HVACDesignPhase = HVACDesignPhase.INPUT_ANALYSIS,
  existingArtifacts?: HVACDesignArtifacts
): Promise<HVACDesignArtifacts> {
  const normalized = normalizeWorkflowZones(zonesInput, context);
  const artifacts = existingArtifacts ? structuredClone(existingArtifacts) : createEmptyDesignArtifacts();
  const startIndex = DESIGN_PHASE_ORDER.indexOf(startPhase);
  if (startIndex < 0) throw new RangeError(`Unsupported restart phase: ${startPhase}`);
  const completed = new Set<string>();
  const runOnce = (group: string): boolean => {
    if (completed.has(group)) return false;
    completed.add(group);
    return true;
  };
  const log = (phase: HVACDesignPhase, zoneId: string, inputs: Record<string,unknown>, selection: string, result: 'PASS'|'WARNING'|'FAIL', engine: string, reason: string): void => {
    const decisionType = phase === HVACDesignPhase.EQUIPMENT_SELECTION ? 'EQUIPMENT_SELECTION' :
      phase === HVACDesignPhase.TERMINAL_PLACEMENT ? 'DIFFUSER_PLACEMENT' :
      phase === HVACDesignPhase.DUCT_SIZING ? 'DUCT_SIZE' : 'OPTIMIZATION';
    decisionLog.push({id:`${phase}-${zoneId}-${decisionLog.length}`,phase,decisionType,
      inputs, constraintsApplied:[],engineeringRulesApplied:[],selectedCandidate:selection,deterministicEngine:engine,
      reasonForSelection:reason,validationResult:result,timestamp:Date.now()});
  };
  for (let i=startIndex;i<DESIGN_PHASE_ORDER.length;i++) {
    const phase=DESIGN_PHASE_ORDER[i];
    stateMachine.transitionTo(phase,Math.round((i+1)/DESIGN_PHASE_ORDER.length*90));
    switch(phase) {
      case HVACDesignPhase.INPUT_ANALYSIS:
      case HVACDesignPhase.ZONE_VALIDATION:
        break; // Geometry has already been validated before calculations.
      case HVACDesignPhase.LOAD_ANALYSIS:
      case HVACDesignPhase.AIRFLOW_CALCULATION: {
        if (!runOnce('load')) break;
        artifacts.loads={}; artifacts.airflows={};
        for(const z of normalized) {
          const geom=adaptZoneGeometry(z.name,z.polygon,z.ceilingHeightFt??10);
          const type=ASHRAE_SPACE_TYPES.find(t=>t.id===(z.spaceTypeId??'office'));
          if(!type) throw new RangeError(`Unknown space type: ${z.spaceTypeId}`);
          const load=adaptCalculateLoadAndAirflow(geom.areaSqFt,z.ceilingHeightFt??10,z.occupancy??Math.ceil(geom.areaSqFt*type.density/1000),
            z.lightingWattsPerSqFt??type.lightingDensity,z.equipmentWattsPerSqFt??type.equipmentDensity,z.manualLoadBtu,z.manualCfm,
            {...context.loadSettings,perimeterFt:geom.perimeterFt,spaceTypeId:type.id});
          artifacts.loads[z.id]={sensibleBtu:load.sensibleBtu,latentBtu:load.latentBtu,totalBtu:load.totalBtu,areaSqFt:load.areaSqFt};
          artifacts.airflows[z.id]={supplyCfm:load.supplyCfm,returnCfm:load.returnCfm,outdoorAirCfm:load.outdoorAirCfm,
            exhaustCfm:load.supplyCfm-load.returnCfm};
          log(HVACDesignPhase.LOAD_ANALYSIS,z.id,{areaSqFt:geom.areaSqFt,occupancy:z.occupancy,spaceTypeId:type.id},`${load.totalBtu} Btu/h; ${load.supplyCfm} CFM`,'WARNING','preliminaryLoad.ts','Shared preliminary load model; detailed envelope and operating conditions are unverified');
        }
        break;
      }
      case HVACDesignPhase.SYSTEM_SELECTION:
      case HVACDesignPhase.EQUIPMENT_SELECTION: {
        if(!runOnce('equipment')) break;
        artifacts.zones=[]; artifacts.selectedEquipment={};
        for(const z of normalized) {
          const load=artifacts.loads[z.id],airflow=artifacts.airflows[z.id];
          if(!load||!airflow) throw new Error(`Missing load/airflow artifacts for ${z.id}`);
          const system=z.systemType??context.systemType??'concealed';
          const selected=adaptSelectEquipment(airflow.supplyCfm,load.totalBtu,system,context.equipmentCatalog,
            {requiredSensibleBtu:load.sensibleBtu,requiredLatentBtu:load.latentBtu});
          if(!selected) {
            stateMachine.recordError({code:'ERR_NO_FEASIBLE_EQUIPMENT',phase:HVACDesignPhase.EQUIPMENT_SELECTION,
              message:`No feasible ${system} equipment for room '${z.name}'`,fatal:false});
            log(HVACDesignPhase.EQUIPMENT_SELECTION,z.id,{requiredCfm:airflow.supplyCfm,requiredBtu:load.totalBtu,system},'No feasible equipment','FAIL','equipmentSelector.ts','No catalog candidate satisfies capacity, airflow and assigned sensible/latent load');
            continue;
          }
          artifacts.selectedEquipment[z.id]=selected;
          const geom=adaptZoneGeometry(z.name,z.polygon,z.ceilingHeightFt??10);
          const equipmentType=system==='concealed'?'concealed-split':system==='packaged'?'rtu':system;
          const service:EquipmentServiceZone={
            id:z.id,unitTag:`ACU-${z.id}`,designControlMode:'ai',equipmentModel:selected.model,
            coolingSource:system==='fcu'||system==='ahu'?'chilled-water':system==='packaged'?'package':'dx',equipmentType,
            isDucted:selected.catalogItem.capabilities.supportsDuctNetwork,nominalTonnage:selected.nominalTons,
            actualCapacityBtu:selected.totalCapacityBtu,sensibleCapacityBtu:selected.sensibleCapacityBtu,
            latentCapacityBtu:selected.totalCapacityBtu-selected.sensibleCapacityBtu,
            supplyCfm:airflow.supplyCfm,returnCfm:airflow.returnCfm,outdoorAirCfm:airflow.outdoorAirCfm,
            exhaustCfm:airflow.exhaustCfm, outdoorAirConnectionApproved:false,espInWg:selected.availableEspInWg,
            equipmentPosition:{...equipmentPosition(z.polygon,geom.centroid),rotation:0,wallSide:'ceiling'},
            serviceAreaPolygon:z.polygon,sensibleLoadBtu:load.sensibleBtu,latentLoadBtu:load.latentBtu,totalLoadBtu:load.totalBtu,
            targetNc:context.spaceNcLimit,pressureBudgetInWg:{supplyDuct:0.12,returnDuct:0.05,terminals:0.05,fittings:0.08,totalAvailable:selected.availableEspInWg},isUserOverridden:false
          };
          artifacts.zones.push(service);
          log(HVACDesignPhase.EQUIPMENT_SELECTION,z.id,{requiredCfm:airflow.supplyCfm,requiredBtu:load.totalBtu,system},selected.model,'WARNING','equipmentSelector.ts','Rated catalog constraints satisfied; calculated fan path and operating conditions require validation');
        }
        break;
      }
      case HVACDesignPhase.AIR_DISTRIBUTION:
      case HVACDesignPhase.TERMINAL_SELECTION:
      case HVACDesignPhase.TERMINAL_PLACEMENT: {
        if(!runOnce('terminals')) break;
        artifacts.terminals=[];artifacts.returnGrilles=[];
        for(const z of normalized) {
          const service=artifacts.zones.find(v=>v.id===z.id);
          if(!service) continue;
          const placed=adaptPlaceTerminals(z.polygon,service.supplyCfm,context.spaceNcLimit,context.coverageTargetPercent,
            z.systemType??context.systemType??'concealed',z.id);
          artifacts.terminals.push(...placed);
          if(service.isDucted) artifacts.returnGrilles.push(...adaptPlaceReturnGrilles(service,placed));
          log(HVACDesignPhase.TERMINAL_PLACEMENT,z.id,{targetCfm:service.supplyCfm,targetNc:context.spaceNcLimit},`${placed.length} terminals`,'WARNING','terminalAdapter.ts','Layout generated; measured coverage and terminal performance are evaluated by final checks');
        }
        break;
      }
      case HVACDesignPhase.DUCT_TOPOLOGY:
      case HVACDesignPhase.DUCT_ROUTING:
      case HVACDesignPhase.DUCT_SIZING: {
        if(!runOnce('ducts')) break;
        artifacts.ductNetwork=[];artifacts.returnDuctNetwork=[];
        for(const service of artifacts.zones) {
          if(service.isDucted===false) continue;
          const placed=artifacts.terminals.filter(t=>t.unitId===service.id);
          const routed=sizeDuctNetwork(adaptRouteAndSizeDucts(service,placed),context.profile,service.maxAvailableCeilingDepthIn??14);
          artifacts.ductNetwork.push(...routed);
          artifacts.returnDuctNetwork.push(...sizeDuctNetwork(routeReturnDucts(service,artifacts.returnGrilles.filter(t=>t.unitId===service.id)),context.profile,service.maxAvailableCeilingDepthIn??14));
          log(HVACDesignPhase.DUCT_SIZING,service.id,{cfm:service.supplyCfm},`${routed.length} sections`,'WARNING','ductAdapter.ts','Connected candidate routing and calculated sizing require per-fan pressure and containment verification');
        }
        break;
      }
      case HVACDesignPhase.PRESSURE_ANALYSIS:
      case HVACDesignPhase.ACOUSTIC_VALIDATION:
      case HVACDesignPhase.COMFORT_VALIDATION:
      case HVACDesignPhase.FINAL_VALIDATION: {
        if(!runOnce('validation')) break;
        artifacts.validationReport=validateWorkflowArtifacts(zonesInput,context,artifacts);
        log(HVACDesignPhase.FINAL_VALIDATION,'project',{},artifacts.validationReport.overallStatus,artifacts.validationReport.overallStatus,'hvacValidator.ts',artifacts.validationReport.summary);
        break;
      }
    }
  }
  return artifacts;
}
