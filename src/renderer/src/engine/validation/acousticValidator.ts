import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import { SteppedDuctSection } from '../ducts/steppedDuctRouter';
import { ValidationPointResult } from './airflowValidator';

export function validateAcousticCompliance(
  zones: EquipmentServiceZone[],
  terminals: CoordinatedAirTerminal[],
  ducts: SteppedDuctSection[]
): ValidationPointResult {
  const targetNc = zones[0]?.targetNc || 30;

  // 1. Check terminals NC
  let maxTerminalNc = 0;
  let violatingTerminal: CoordinatedAirTerminal | null = null;
  for (const t of terminals) {
    if (t.ncRating > maxTerminalNc) maxTerminalNc = t.ncRating;
    if (t.ncRating > targetNc) {
      violatingTerminal = t;
    }
  }

  // 2. Check duct velocity noise
  let maxDuctV = 0;
  let violatingDuct: SteppedDuctSection | null = null;
  for (const d of ducts) {
    if (d.velocityFpm > maxDuctV) maxDuctV = d.velocityFpm;
    if (d.velocityFpm > d.allowableVelocityFpm + 50) {
      violatingDuct = d;
    }
  }

  const passed = !violatingTerminal && !violatingDuct;

  return {
    pointIndex: 5,
    pointName: 'Acoustic Compliance',
    status: passed ? 'PASS' : 'WARNING',
    metric: `Max Terminal NC: ${maxTerminalNc} vs Target NC ${targetNc}, Max Duct Velocity: ${maxDuctV} FPM`,
    criteria: `Terminal NC <= NC ${targetNc} and Duct Velocity within quiet envelope`,
    message: passed
      ? `All air terminals and duct sections satisfy room acoustic target NC ${targetNc}`
      : `Acoustic warning: ${violatingTerminal ? `Terminal ${violatingTerminal.id} NC ${violatingTerminal.ncRating} exceeds target` : `Duct ${violatingDuct?.id} velocity ${violatingDuct?.velocityFpm} FPM exceeds allowable limit`}`
  };
}
