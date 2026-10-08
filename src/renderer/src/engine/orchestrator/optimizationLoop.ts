import {
  HVACDesignPhase,
  OptimizationAction,
  HVACDesignArtifacts
} from './orchestratorTypes';
import { MasterValidationReport } from '../validation/hvacValidator';

const PHASE_PRIORITY: HVACDesignPhase[] = [
  HVACDesignPhase.INPUT_ANALYSIS,
  HVACDesignPhase.ZONE_VALIDATION,
  HVACDesignPhase.LOAD_ANALYSIS,
  HVACDesignPhase.AIRFLOW_CALCULATION,
  HVACDesignPhase.SYSTEM_SELECTION,
  HVACDesignPhase.EQUIPMENT_SELECTION,
  HVACDesignPhase.AIR_DISTRIBUTION,
  HVACDesignPhase.TERMINAL_SELECTION,
  HVACDesignPhase.TERMINAL_PLACEMENT,
  HVACDesignPhase.DUCT_TOPOLOGY,
  HVACDesignPhase.DUCT_ROUTING,
  HVACDesignPhase.DUCT_SIZING,
  HVACDesignPhase.PRESSURE_ANALYSIS,
  HVACDesignPhase.ACOUSTIC_VALIDATION,
  HVACDesignPhase.COMFORT_VALIDATION,
  HVACDesignPhase.FINAL_VALIDATION
];

export function findEarliestRestartPhase(actions: OptimizationAction[]): HVACDesignPhase {
  if (actions.length === 0) return HVACDesignPhase.FINAL_VALIDATION;

  let minIndex = Infinity;
  for (const act of actions) {
    const idx = PHASE_PRIORITY.indexOf(act.restartPhase);
    if (idx !== -1 && idx < minIndex) {
      minIndex = idx;
    }
  }

  return minIndex !== Infinity ? PHASE_PRIORITY[minIndex] : HVACDesignPhase.FINAL_VALIDATION;
}

export function analyzeFailuresAndDetermineActions(
  report: MasterValidationReport,
  _artifacts: HVACDesignArtifacts,
  iteration: number
): OptimizationAction[] {
  const actions: OptimizationAction[] = [];

  for (const point of report.points) {
    if (point.status === 'PASS') continue;

    switch (point.pointIndex) {
      case 8: {
        // Equipment Capacity Match
        actions.push({
          id: `opt-act-cap-${iteration}-${Date.now()}`,
          iteration,
          failureCategory: 'CAPACITY',
          affectedZones: ['all'],
          affectedComponents: ['equipment'],
          restartPhase: HVACDesignPhase.EQUIPMENT_SELECTION,
          actionType: 'UPSIZE_EQUIPMENT_MODEL',
          beforeValues: { metric: point.metric },
          afterValues: { action: 'Select next larger nominal tonnage catalog item' },
          expectedImprovement: 'Provide >= 100% of calculated sensible and latent load'
        });
        break;
      }

      case 1:
      case 2: {
        // Supply Airflow / Room Airflow Balance
        actions.push({
          id: `opt-act-air-${iteration}-${Date.now()}`,
          iteration,
          failureCategory: 'AIRFLOW',
          affectedZones: ['all'],
          affectedComponents: ['terminals'],
          restartPhase: HVACDesignPhase.AIR_DISTRIBUTION,
          actionType: 'REBALANCE_TERMINAL_CFM',
          beforeValues: { metric: point.metric },
          afterValues: { action: 'Rebalance diffuser CFM sum to match room required CFM' },
          expectedImprovement: 'Eliminate airflow mismatch'
        });
        break;
      }

      case 5: {
        // Acoustic Compliance Check
        actions.push({
          id: `opt-act-nc-${iteration}-${Date.now()}`,
          iteration,
          failureCategory: 'NOISE',
          affectedZones: ['all'],
          affectedComponents: ['terminals', 'ducts'],
          restartPhase: HVACDesignPhase.TERMINAL_SELECTION,
          actionType: 'INCREASE_DIFFUSER_COUNT_OR_SIZE',
          beforeValues: { metric: point.metric },
          afterValues: { action: 'Increment diffuser count or select larger face neck size' },
          expectedImprovement: 'Reduce terminal air velocity and NC below space threshold'
        });
        break;
      }

      case 6: {
        // Throw and Thermal Comfort Check
        actions.push({
          id: `opt-act-throw-${iteration}-${Date.now()}`,
          iteration,
          failureCategory: 'THROW',
          affectedZones: ['all'],
          affectedComponents: ['terminals'],
          restartPhase: HVACDesignPhase.TERMINAL_PLACEMENT,
          actionType: 'ADJUST_TERMINAL_PLACEMENT_OR_DEFLECTION',
          beforeValues: { metric: point.metric },
          afterValues: { action: 'Reposition diffusers with relaxed perimeter inset' },
          expectedImprovement: 'Achieve >=95% room coverage without draft in occupied zone'
        });
        break;
      }

      case 4: {
        // Duct Velocity Compliance Check
        actions.push({
          id: `opt-act-vel-${iteration}-${Date.now()}`,
          iteration,
          failureCategory: 'VELOCITY',
          affectedZones: ['all'],
          affectedComponents: ['ducts'],
          restartPhase: HVACDesignPhase.DUCT_SIZING,
          actionType: 'INCREASE_DUCT_DIMENSIONS',
          beforeValues: { metric: point.metric },
          afterValues: { action: 'Upsize duct cross-section to lower velocity' },
          expectedImprovement: 'Keep velocity below allowable profile limit (1200 FPM main, 800 FPM branch)'
        });
        break;
      }

      case 7: {
        // Static Pressure / ESP Check
        actions.push({
          id: `opt-act-esp-${iteration}-${Date.now()}`,
          iteration,
          failureCategory: 'PRESSURE',
          affectedZones: ['all'],
          affectedComponents: ['ducts', 'equipment'],
          restartPhase: HVACDesignPhase.DUCT_SIZING,
          actionType: 'REDUCE_FRICTION_RATE_OR_HIGH_ESP_UNIT',
          beforeValues: { metric: point.metric },
          afterValues: { action: 'Drop friction rate from 0.10 to 0.08 in.wg/100ft' },
          expectedImprovement: 'Reduce critical path total pressure drop within fan rating'
        });
        break;
      }

      default: {
        actions.push({
          id: `opt-act-gen-${iteration}-${Date.now()}`,
          iteration,
          failureCategory: 'GEOMETRY',
          affectedZones: ['all'],
          affectedComponents: ['all'],
          restartPhase: HVACDesignPhase.ZONE_VALIDATION,
          actionType: 'GENERAL_REVALIDATION',
          beforeValues: { metric: point.metric },
          afterValues: { action: 'Verify coordination rules' },
          expectedImprovement: 'Resolve spatial or balance violation'
        });
        break;
      }
    }
  }

  return actions;
}
