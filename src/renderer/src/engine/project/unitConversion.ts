import type { ProjectMetadata, Zone } from '../../store/projectStore';
import { METERS_PER_FOOT, WATTS_PER_BTU_PER_HOUR, LITERS_PER_SECOND_PER_CFM } from '../engineeringInputs';

/** Convert display inputs only. Drawing coordinates and canonical terminal/duct evidence stay fixed. */
export function convertProjectDisplayUnits(project:ProjectMetadata,zones:Zone[],units:'imperial'|'metric'):{project:ProjectMetadata;zones:Zone[]} {
  if(project.units===units) return {project,zones};
  const toMetric=units==='metric';
  const lengthFactor=toMetric?METERS_PER_FOOT:1/METERS_PER_FOOT;
  const loadFactor=toMetric?WATTS_PER_BTU_PER_HOUR:1/WATTS_PER_BTU_PER_HOUR;
  const flowFactor=toMetric?LITERS_PER_SECOND_PER_CFM:1/LITERS_PER_SECOND_PER_CFM;
  const temperature=(value:number):number=>toMetric?(value-32)*5/9:value*9/5+32;
  return {
    project:{...project,units,scale:project.scale/lengthFactor,outdoorDb:temperature(project.outdoorDb),indoorDb:temperature(project.indoorDb)},
    zones:zones.map(zone=>({...zone,ceilingHeight:zone.ceilingHeight*lengthFactor,
      manualCoolingOverride:zone.manualCoolingOverride===undefined?undefined:zone.manualCoolingOverride*loadFactor,
      manualCfmOverride:zone.manualCfmOverride===undefined?undefined:zone.manualCfmOverride*flowFactor}))
  };
}
