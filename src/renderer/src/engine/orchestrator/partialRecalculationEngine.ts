import { HVACDesignContext, HVACDesignArtifacts, HVACDesignResult, HVACDesignPhase, DesignDecisionLog } from './orchestratorTypes';
import { HVACZoneInput, executeDesignWorkflow, validateWorkflowArtifacts } from './hvacDesignWorkflow';
import { DesignStateMachine } from './designStateMachine';
import { adaptRouteAndSizeDucts } from '../adapters/ductAdapter';
import { selectEquipmentForLoad } from '../systemArchitecture/equipmentSelector';
import { STANDARD_EQUIPMENT_CATALOG } from '../hvacCatalogs';
import { sizeDuctNetwork } from '../ducts/aerodynamicDuctSizer';

export interface UserModification {
  type: 'MOVE_DIFFUSER' | 'REPLACE_EQUIPMENT' | 'MODIFY_ZONE_BOUNDARY' | 'OVERRIDE_CFM';
  targetId: string;
  zoneId: string;
  newPosition?: { x: number; y: number }; // Canonical feet, matching returned design artifacts.
  newModel?: string;
  newPolygon?: number[]; // Project drawing units, matching input zones.
  newCfm?: number; // Canonical CFM.
}

export async function recalculatePartialDesign(
  zonesInput: HVACZoneInput[], currentArtifacts: HVACDesignArtifacts,
  modification: UserModification, context: HVACDesignContext
): Promise<HVACDesignResult> {
  const startTime=Date.now();
  const inputs=structuredClone(zonesInput);
  const input=inputs.find(z=>z.id===modification.zoneId);
  if(!input) throw new RangeError('Modification target zone does not exist');
  const stateMachine=new DesignStateMachine();
  stateMachine.start();
  const decisionLog:DesignDecisionLog[]=[];
  const executedPhases:HVACDesignPhase[]=[];
  let artifacts=structuredClone(currentArtifacts);
  const initialStatus=currentArtifacts.validationReport?.overallStatus??'FAIL';
  const reroute=(zoneId:string):void=>{
    const zone=artifacts.zones.find(z=>z.id===zoneId);
    if(!zone) return;
    const ducts=zone.isDucted===false?[]:sizeDuctNetwork(adaptRouteAndSizeDucts(zone,artifacts.terminals.filter(t=>t.unitId===zoneId)),context.profile,zone.maxAvailableCeilingDepthIn??14);
    artifacts.ductNetwork=[...artifacts.ductNetwork.filter(d=>d.unitId!==zoneId),...ducts];
  };
  switch(modification.type) {
    case 'MOVE_DIFFUSER': {
      const term=artifacts.terminals.find(t=>t.id===modification.targetId&&t.unitId===modification.zoneId);
      if(!term||!modification.newPosition) throw new RangeError('Diffuser modification target or position is missing');
      if(![modification.newPosition.x,modification.newPosition.y].every(Number.isFinite)) throw new RangeError('Diffuser position must be finite');
      term.position={...modification.newPosition};term.designControlMode='user-modified';
      reroute(modification.zoneId);
      executedPhases.push(HVACDesignPhase.TERMINAL_PLACEMENT,HVACDesignPhase.DUCT_ROUTING,HVACDesignPhase.DUCT_SIZING);
      break;
    }
    case 'REPLACE_EQUIPMENT': {
      if(!modification.newModel) throw new RangeError('Replacement equipment model is missing');
      const load=artifacts.loads[modification.zoneId],air=artifacts.airflows[modification.zoneId];
      if(!load||!air) throw new RangeError('Replacement target load or airflow is missing');
      const catalog=(context.equipmentCatalog??STANDARD_EQUIPMENT_CATALOG).filter(item=>item.model===modification.newModel);
      const system=input.systemType??context.systemType??'concealed';
      const selected=selectEquipmentForLoad(air.supplyCfm,load.totalBtu,system,catalog,
        {requiredSensibleBtu:load.sensibleBtu,requiredLatentBtu:load.latentBtu});
      if(!selected) {
        delete artifacts.selectedEquipment[modification.zoneId];
        artifacts.zones=artifacts.zones.filter(z=>z.id!==modification.zoneId);
        artifacts.ductNetwork=artifacts.ductNetwork.filter(d=>d.unitId!==modification.zoneId);
        artifacts.returnDuctNetwork=artifacts.returnDuctNetwork?.filter(d=>d.unitId!==modification.zoneId);
      } else {
        const zone=artifacts.zones.find(z=>z.id===modification.zoneId);
        if(!zone) throw new RangeError('Replacement equipment has no existing service zone');
        artifacts.selectedEquipment[modification.zoneId]=selected;
        zone.equipmentModel=selected.model;zone.nominalTonnage=selected.nominalTons;
        zone.actualCapacityBtu=selected.totalCapacityBtu;zone.sensibleCapacityBtu=selected.sensibleCapacityBtu;
        zone.latentCapacityBtu=selected.totalCapacityBtu-selected.sensibleCapacityBtu;
        zone.espInWg=selected.availableEspInWg;zone.pressureBudgetInWg.totalAvailable=selected.availableEspInWg;
        zone.isUserOverridden=true;reroute(modification.zoneId);
      }
      decisionLog.push({id:`replacement-${modification.zoneId}`,phase:HVACDesignPhase.EQUIPMENT_SELECTION,decisionType:'EQUIPMENT_SELECTION',
        inputs:{requestedModel:modification.newModel},constraintsApplied:['Capacity, sensible/latent load and airflow'],engineeringRulesApplied:[],
        selectedCandidate:selected?.model??'No feasible equipment',deterministicEngine:'equipmentSelector.ts',reasonForSelection:selected?'Rated constraints satisfied; final pressure validation required':'Requested model absent or infeasible',validationResult:selected?'WARNING':'FAIL',timestamp:Date.now()});
      executedPhases.push(HVACDesignPhase.EQUIPMENT_SELECTION,HVACDesignPhase.DUCT_SIZING);
      break;
    }
    case 'MODIFY_ZONE_BOUNDARY':
    case 'OVERRIDE_CFM': {
      if(modification.type==='MODIFY_ZONE_BOUNDARY') {
        if(!modification.newPolygon) throw new RangeError('Modified zone polygon is missing');
        input.polygon=[...modification.newPolygon];
      } else {
        if(modification.newCfm===undefined) throw new RangeError('Override airflow is missing');
        input.manualCfm=modification.newCfm;
      }
      stateMachine.subscribe(state=>{
        if(executedPhases[executedPhases.length-1]!==state.currentPhase) executedPhases.push(state.currentPhase);
      });
      const updated=await executeDesignWorkflow([input],context,stateMachine,decisionLog);
      const target=modification.zoneId;
      artifacts.zones=[...artifacts.zones.filter(z=>z.id!==target),...updated.zones];
      artifacts.loads[target]=updated.loads[target];
      artifacts.airflows[target]=updated.airflows[target];
      delete artifacts.selectedEquipment[target];
      if(updated.selectedEquipment[target]) artifacts.selectedEquipment[target]=updated.selectedEquipment[target];
      artifacts.terminals=[...artifacts.terminals.filter(t=>t.unitId!==target),...updated.terminals];
      artifacts.returnGrilles=[...artifacts.returnGrilles.filter(t=>t.unitId!==target),...updated.returnGrilles];
      artifacts.ductNetwork=[...artifacts.ductNetwork.filter(d=>d.unitId!==target),...updated.ductNetwork];
      artifacts.returnDuctNetwork=[...(artifacts.returnDuctNetwork??[]).filter(d=>d.unitId!==target),...(updated.returnDuctNetwork??[])];
      break;
    }
    default:
      throw new RangeError('Unsupported modification type');
  }
  executedPhases.push(HVACDesignPhase.FINAL_VALIDATION);
  artifacts.validationReport=validateWorkflowArtifacts(inputs,context,artifacts);
  const status=artifacts.validationReport.overallStatus;
  if(status==='FAIL') stateMachine.fail('Modified design fails required engineering checks');
  else stateMachine.complete();
  return {status,artifacts,validationReport:artifacts.validationReport,optimizationHistory:[],decisionLog,
    executionSummary:{totalDurationMs:Date.now()-startTime,iterationsRun:1,phasesExecuted:executedPhases,
      initialPassStatus:initialStatus,finalPassStatus:status}};
}
