import type { EquipmentServiceZone } from '../zoning/zonePartitioner';
import type { SteppedDuctSection } from '../ducts/steppedDuctRouter';
import type { CoordinatedAirTerminal } from '../terminals/terminalPlacer';
import type { ValidationPointResult } from './airflowValidator';
import { StandardsProfile, ASHRAE_PROFILE } from '../standards/designStandards';

/** Solve each fan separately; parallel branches are alternatives, not series losses. */
export function validateCriticalPathPressure(
  zones: EquipmentServiceZone[],
  ducts: SteppedDuctSection[],
  profile: StandardsProfile = ASHRAE_PROFILE,
  terminals?: CoordinatedAirTerminal[]
): ValidationPointResult {
  const failures: string[] = [];
  const metrics: string[] = [];
  const margin = profile.tolerances.staticPressureSafetyMarginPercent;
  if (!Number.isFinite(margin) || margin < 0) failures.push('Invalid pressure safety margin');
  if (zones.length === 0) failures.push('No equipment pressure evidence');
  const allIds = new Set<string>();
  for (const d of ducts) {
    if (allIds.has(d.id)) failures.push(`Duplicate duct ${d.id}`);
    allIds.add(d.id);
    if (!zones.some(z => z.id === d.unitId)) failures.push(`Duct ${d.id} has no equipment owner`);
  }

  for (const zone of zones) {
    if (zone.isDucted === false) {
      metrics.push(`${zone.id}: nonducted equipment (duct ESP check not applicable)`);
      continue;
    }
    const unitDucts = ducts.filter(d => d.unitId === zone.id && d.systemType !== 'outdoor-air');
    const supply = unitDucts.filter(d => d.systemType === 'supply');
    if (supply.length === 0) {
      failures.push(`${zone.id}: missing supply pressure network`);
      continue;
    }
    const unitById = new Map(unitDucts.map(d => [d.id, d]));
    const visiting = new Set<string>();
    const totals = new Map<string, number>();
    const pathLoss = (d: SteppedDuctSection): number => {
      if (totals.has(d.id)) return totals.get(d.id)!;
      if (visiting.has(d.id)) throw new Error(`cycle at ${d.id}`);
      visiting.add(d.id);
      const values = [d.startPoint.x, d.startPoint.y, d.endPoint.x, d.endPoint.y,
        d.frictionLossPer100Ft, d.fittingLossInWg];
      if (!values.every(Number.isFinite) || d.frictionLossPer100Ft < 0 || d.fittingLossInWg < 0) {
        throw new Error(`invalid pressure data for ${d.id}`);
      }
      let parentLoss = 0;
      if (d.parentDuctId) {
        const parent = unitById.get(d.parentDuctId);
        if (!parent || parent.systemType !== d.systemType) throw new Error(`missing or incompatible parent for ${d.id}`);
        const px = parent.endPoint.x - parent.startPoint.x;
        const py = parent.endPoint.y - parent.startPoint.y;
        const lengthSquared = px * px + py * py;
        const fraction = lengthSquared > 0
          ? ((d.startPoint.x - parent.startPoint.x) * px + (d.startPoint.y - parent.startPoint.y) * py) / lengthSquared : 0;
        const separation = Math.hypot(d.startPoint.x - (parent.startPoint.x + fraction * px),
          d.startPoint.y - (parent.startPoint.y + fraction * py));
        if (separation > 0.05 || fraction < -0.001 || fraction > 1.001) throw new Error(`disconnected parent for ${d.id}`);
        parentLoss = pathLoss(parent);
      } else {
        const origin = d.systemType === 'return' ? d.endPoint : d.startPoint;
        if (Math.hypot(origin.x - zone.equipmentPosition.x, origin.y - zone.equipmentPosition.y) > 0.05) {
          throw new Error(`unconnected root ${d.id}`);
        }
      }
      for (const childId of d.childDuctIds) {
        const child = unitById.get(childId);
        if (!child || child.parentDuctId !== d.id) throw new Error(`inconsistent child ${childId}`);
      }
      const accessoryLoss = (d.accessories ?? []).reduce((sum, item) => {
        if (!Number.isFinite(item.deltaPInWg) || item.deltaPInWg < 0) throw new Error(`invalid accessory pressure on ${d.id}`);
        return sum + item.deltaPInWg;
      }, 0);
      const loss = parentLoss + d.frictionLossPer100Ft * Math.hypot(
        d.endPoint.x - d.startPoint.x, d.endPoint.y - d.startPoint.y) / 100 + d.fittingLossInWg + accessoryLoss;
      visiting.delete(d.id);
      totals.set(d.id, loss);
      return loss;
    };
    try {
      for (const d of unitDucts) pathLoss(d);
      const unitTerminals = terminals?.filter(t => t.unitId === zone.id && t.type === 'supply');
      let supplyLoss = Math.max(...supply.map(d => pathLoss(d)));
      if (unitTerminals) {
        if (unitTerminals.length === 0) throw new Error('missing terminal pressure evidence');
        supplyLoss = Math.max(...unitTerminals.map(t => {
          if (!Number.isFinite(t.deltaPInWg) || t.deltaPInWg < 0) throw new Error(`invalid terminal pressure ${t.id}`);
          const connected = supply.filter(d => d.connectedDiffusers.includes(t.id));
          if (connected.length === 0) throw new Error(`unconnected terminal ${t.id}`);
          if (!connected.some(d=>Math.hypot(d.endPoint.x-t.position.x,d.endPoint.y-t.position.y)<=0.05)) throw new Error(`terminal ${t.id} position is disconnected`);
          return Math.max(...connected.map(d => pathLoss(d))) + t.deltaPInWg;
        }));
      } else {
        supplyLoss += zone.pressureBudgetInWg.terminals;
      }
      const returns = unitDucts.filter(d => d.systemType === 'return');
      if (zone.returnCfm > 0 && !returns.length) throw new Error('missing return pressure network');
      let returnLoss = returns.length ? Math.max(...returns.map(d => pathLoss(d))) : 0;
      if (terminals && zone.returnCfm > 0) {
        const grilles = terminals.filter(t => t.unitId === zone.id && t.type === 'return');
        if (!grilles.length) throw new Error('missing return grille pressure evidence');
        returnLoss = Math.max(...grilles.map(t => {
          if (!Number.isFinite(t.deltaPInWg) || t.deltaPInWg < 0) throw new Error(`invalid return grille pressure ${t.id}`);
          const connected = returns.filter(d => d.connectedDiffusers.includes(t.id));
          if (!connected.length) throw new Error(`unconnected return grille ${t.id}`);
          if (!connected.some(d=>Math.hypot(d.startPoint.x-t.position.x,d.startPoint.y-t.position.y)<=0.05)) throw new Error(`return terminal ${t.id} position is disconnected`);
          return Math.max(...connected.map(d => pathLoss(d))) + t.deltaPInWg;
        }));
      }
      const required = (supplyLoss + returnLoss) * (1 + margin / 100);
      if (!Number.isFinite(required) || !Number.isFinite(zone.espInWg) || zone.espInWg < 0) throw new Error('missing fan or pressure data');
      metrics.push(`${zone.id}: ${required.toFixed(3)} in. wg required vs ${zone.espInWg.toFixed(3)} available`);
      if (required > zone.espInWg) failures.push(`${zone.id}: governing path exceeds available fan ESP`);
    } catch (error) {
      failures.push(`${zone.id}: ${(error as Error).message}`);
    }
  }
  return {
    pointIndex: 7, pointName: 'Static Pressure & ESP Margin',
    status: failures.length ? 'FAIL' : 'PASS',
    metric: metrics.join(' | ') || 'Pressure evidence unavailable',
    criteria: 'Each connected fan path loss + safety margin <= that fan rated ESP',
    message: failures.length ? failures.join('; ') : 'Every evaluated fan has sufficient preliminary pressure margin'
  };
}
