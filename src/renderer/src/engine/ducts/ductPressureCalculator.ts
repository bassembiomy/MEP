import { SteppedDuctSection } from './steppedDuctRouter';

/**
 * ASHRAE Fundamentals duct friction equation (in. wg / 100 ft), un-rounded:
 *   dp/100ft = 0.109136 * q^1.9 / De^5.02      (q in CFM, De in inches)
 */
export function frictionRateExact(cfm: number, equivalentDiameterIn: number): number {
  if (cfm <= 0 || equivalentDiameterIn <= 0) return 0;
  return (0.109136 * Math.pow(cfm, 1.9)) / Math.pow(equivalentDiameterIn, 5.02);
}

/**
 * Inverse of the ASHRAE friction equation: equivalent round diameter (in) that gives
 * the requested friction rate (in. wg / 100 ft) at the given airflow.
 *   De = (0.109136 * q^1.9 / f)^(1/5.02)
 */
export function equivalentDiameterForFriction(cfm: number, frictionRateInWgPer100Ft: number): number {
  if (cfm <= 0) return 0;
  const f = Math.max(1e-4, frictionRateInWgPer100Ft);
  return Math.pow((0.109136 * Math.pow(cfm, 1.9)) / f, 1 / 5.02);
}

/** Huebscher equivalent round diameter of a rectangular duct a x b (in): De = 1.30 (ab)^0.625 / (a+b)^0.25 */
export function rectangularEquivalentDiameter(widthIn: number, heightIn: number): number {
  if (widthIn <= 0 || heightIn <= 0) return 0;
  return (1.30 * Math.pow(widthIn * heightIn, 0.625)) / Math.pow(widthIn + heightIn, 0.25);
}

/**
 * Calculates duct friction loss in in. w.g. / 100 ft using the standard ASHRAE duct friction equation
 * frictionLossPer100Ft = 0.109136 * (CFM^1.9) / (De^5.02)   (rounded to 3 decimals)
 */
export function calculateFrictionRatePer100Ft(cfm: number, equivalentDiameterIn: number): number {
  return parseFloat(frictionRateExact(cfm, equivalentDiameterIn).toFixed(3));
}

/** Geometric length (ft) of a stepped duct section (section coordinates are feet). */
export function sectionLengthFt(section: Pick<SteppedDuctSection, 'startPoint' | 'endPoint'>): number {
  return Math.hypot(section.endPoint.x - section.startPoint.x, section.endPoint.y - section.startPoint.y);
}

/**
 * Calculates total section friction loss given length in feet
 */
export function calculateDuctFrictionLoss(section: SteppedDuctSection): number {
  return parseFloat(((section.frictionLossPer100Ft * sectionLengthFt(section)) / 100).toFixed(4));
}

export interface TerminalPathLoss {
  terminalId: string;
  sectionIds: string[]; // from unit outwards
  frictionInWg: number;
  fittingInWg: number; // junction fittings + terminal connection fittings
  totalInWg: number;
  elbows: number;
  teeBranches: number;
}

/** Fitting contribution of the final connection of a terminal (boot elbow, takeoff tee for on-line terminals). */
export type TerminalConnectionFn = (
  section: SteppedDuctSection,
  terminalId: string
) => { lossInWg: number; elbows: number; teeBranches: number };

/**
 * Walks from every terminal up the duct tree (parentDuctId) to the unit, summing the real
 * section friction (rate x length) and fitting losses. Each terminal gets its OWN path loss,
 * so the critical path (max) differs from terminal to terminal.
 */
export function calculateTerminalPathLosses(
  sections: SteppedDuctSection[],
  terminalConnection: TerminalConnectionFn
): TerminalPathLoss[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const directSection = new Map<string, SteppedDuctSection>();
  for (const s of sections) {
    const direct = s.directDiffusers ?? (s.childDuctIds.length === 0 ? s.connectedDiffusers : []);
    for (const t of direct) directSection.set(t, s);
  }

  const results: TerminalPathLoss[] = [];
  for (const [terminalId, start] of directSection) {
    const chain: SteppedDuctSection[] = [];
    const seen = new Set<string>();
    let cur: SteppedDuctSection | undefined = start;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.push(cur);
      cur = cur.parentDuctId ? byId.get(cur.parentDuctId) : undefined;
    }
    chain.reverse();
    let friction = 0;
    let fitting = 0;
    let tees = 0;
    let elbowCount = 0;
    for (const s of chain) {
      friction += (s.frictionLossPer100Ft * sectionLengthFt(s)) / 100;
      fitting += s.fittingLossInWg;
      if (s.junctionKind === 'tee-branch') tees++;
      if (s.junctionKind === 'elbow') elbowCount++;
    }
    const conn = terminalConnection(start, terminalId);
    fitting += conn.lossInWg;
    results.push({
      terminalId,
      sectionIds: chain.map((s) => s.id),
      frictionInWg: parseFloat(friction.toFixed(4)),
      fittingInWg: parseFloat(fitting.toFixed(4)),
      totalInWg: parseFloat((friction + fitting).toFixed(4)),
      elbows: conn.elbows + elbowCount,
      teeBranches: tees + conn.teeBranches
    });
  }
  return results;
}
