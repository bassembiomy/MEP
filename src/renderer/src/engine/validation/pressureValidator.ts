import { EquipmentServiceZone } from '../zoning/zonePartitioner';
import { SteppedDuctSection } from '../ducts/steppedDuctRouter';
import { ValidationPointResult } from './airflowValidator';
import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';
import { calculateTerminalPathLosses } from '../ducts/ductPressureCalculator';
import { terminalConnectionLoss } from '../ducts/fittingLossCalculator';
import { formatPressure } from '../../format/units';

/** Default terminal (diffuser) and return grille pressure drops (in. wg) used when path data lacks them */
export const DEFAULT_TERMINAL_DROP_IN_WG = 0.04;
export const DEFAULT_RETURN_GRILLE_DROP_IN_WG = 0.05;

/** Critical-path loss (in. wg, before safety margin) of one unit's routed supply + return network. */
export function criticalPathLossForUnit(
  ducts: SteppedDuctSection[],
  terminalDrop: number = DEFAULT_TERMINAL_DROP_IN_WG,
  returnDrop: number = DEFAULT_RETURN_GRILLE_DROP_IN_WG
): { supply: number; ret: number; total: number; criticalTerminalId: string } {
  const supplyDucts = ducts.filter((d) => d.systemType === 'supply');
  const returnDucts = ducts.filter((d) => d.systemType === 'return');

  const supplyPaths = calculateTerminalPathLosses(supplyDucts, terminalConnectionLoss);
  const critSupply = supplyPaths.reduce<{ total: number; id: string }>(
    (a, p) => (p.totalInWg > a.total ? { total: p.totalInWg, id: p.terminalId } : a),
    { total: 0, id: '' }
  );

  let retLoss = 0;
  const returnPaths = calculateTerminalPathLosses(returnDucts, terminalConnectionLoss);
  if (returnPaths.length > 0) {
    retLoss = Math.max(...returnPaths.map((p) => p.totalInWg));
  } else if (returnDucts.length > 0) {
    // Plenum-style return (no grilles listed): worst leaf of the tree
    const parents = new Set(returnDucts.map((d) => d.parentDuctId).filter(Boolean));
    const byId = new Map(returnDucts.map((d) => [d.id, d]));
    for (const leaf of returnDucts.filter((d) => !parents.has(d.id))) {
      let sum = 0;
      const seen = new Set<string>();
      let cur: SteppedDuctSection | undefined = leaf;
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        sum += cur.totalSectionLossInWg;
        cur = cur.parentDuctId ? byId.get(cur.parentDuctId) : undefined;
      }
      retLoss = Math.max(retLoss, sum);
    }
  }

  const supply = critSupply.total + (supplyPaths.length > 0 ? terminalDrop : 0);
  const ret = retLoss + returnDrop;
  return { supply, ret, total: supply + ret, criticalTerminalId: critSupply.id };
}

export function validateCriticalPathPressure(
  zones: EquipmentServiceZone[],
  ducts: SteppedDuctSection[],
  profile: StandardsProfile = ASHRAE_PROFILE,
  units?: string
): ValidationPointResult {
  const marginPercent = profile.tolerances.staticPressureSafetyMarginPercent || 15.0;

  // Evaluate each unit's own network: critical path = worst terminal, not the sum of every duct
  const unitIds = Array.from(new Set(ducts.map((d) => d.unitId)));
  const groups: { zone?: EquipmentServiceZone; ducts: SteppedDuctSection[] }[] =
    unitIds.length > 0
      ? unitIds.map((id) => ({ zone: zones.find((z) => z.id === id), ducts: ducts.filter((d) => d.unitId === id) }))
      : [{ zone: zones[0], ducts: [] }];

  let worst: { total: number; esp: number; terminal: string } | undefined;
  for (const g of groups) {
    const loss = criticalPathLossForUnit(g.ducts);
    const withMargin = parseFloat((loss.total * (1 + marginPercent / 100)).toFixed(3));
    const esp = g.zone?.espInWg || zones[0]?.espInWg || 0.35;
    if (!worst || withMargin - esp > worst.total - worst.esp) {
      worst = { total: withMargin, esp, terminal: loss.criticalTerminalId };
    }
  }

  const totalWithSafetyMargin = worst?.total ?? 0;
  const availableEsp = worst?.esp ?? (zones[0]?.espInWg || 0.35);
  const passed = totalWithSafetyMargin <= availableEsp;

  return {
    pointIndex: 7,
    pointName: 'Static Pressure & ESP Margin',
    status: passed ? 'PASS' : 'WARNING',
    metric: `Critical Path Total: ${formatPressure(totalWithSafetyMargin, units)} (incl ${marginPercent}% margin) vs Available Fan ESP: ${formatPressure(availableEsp, units)}`,
    criteria: 'Total Critical Path Loss + Safety Margin <= Equipment Rated ESP',
    message: passed
      ? `Equipment fan ESP (${formatPressure(availableEsp, units)}) provides ${formatPressure(availableEsp - totalWithSafetyMargin, units)} excess static pressure margin`
      : `Critical path pressure loss ${formatPressure(totalWithSafetyMargin, units)} exceeds fan ESP ${formatPressure(availableEsp, units)} (upsize ducts or select high-static unit)`
  };
}
