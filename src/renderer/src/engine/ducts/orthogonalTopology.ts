/**
 * Orthogonal (Manhattan) duct-tree topology builder, unit-agnostic (feet or px).
 *
 * Layout rules (professional practice):
 *  - ONE trunk line runs along the dominant room axis through the unit (per side of the unit).
 *  - Every terminal is projected onto the trunk; the branch is a straight perpendicular run.
 *  - Trunk pieces end at the last takeoff only; collinear / zero-length pieces are never emitted.
 *  - Terminals sharing a takeoff station on the same side of the trunk are chained in series
 *    (nearest first) so no two segments overlap.
 *
 * Every emitted segment is horizontal or vertical, has a parent (or none for roots at the unit) and
 * carries the flow of everything downstream of it, so airflow is conserved at every node.
 */

export interface TopoTerminal {
  id: string;
  x: number;
  y: number;
  cfm: number;
}

export type TopoKind = 'trunk' | 'branch' | 'runout';

export interface TopoSegment {
  key: number;
  kind: TopoKind;
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Total flow carried (sum of all downstream terminals) */
  flow: number;
  parent: number; // index into the output array, -1 = fed directly from the unit
  /** Terminals served at this section's END node */
  direct: string[];
  /** All terminals downstream (including direct) */
  downstream: string[];
  orientation: 'h' | 'v';
  /** true for the first leg leaving a trunk node perpendicular to it */
  isTakeoff: boolean;
  /** terminal connected on-line at the trunk node (needs a takeoff collar) */
  onTrunk: boolean;
}

export interface TopologyOptions {
  /** Trunk axis; 'auto' picks horizontal when the room bbox is wider than tall */
  axis: 'h' | 'v';
  /** Stations closer than this are merged (coordinate units) */
  snapTol: number;
  /** Terminals closer than this to the trunk line are treated as on-line (no branch) */
  onLineTol: number;
  /** Minimum length of a piece when a station is displaced off the unit */
  minLen: number;
}

export function pickAxis(bbox: { width: number; height: number }): 'h' | 'v' {
  return bbox.width >= bbox.height ? 'h' : 'v';
}

interface Station {
  u: number; // offset along trunk from unit (signed)
  terminals: { t: TopoTerminal; dv: number }[];
}

/**
 * Builds the orthogonal tree rooted at `root`. Segments are ordered so every parent precedes its
 * children (breadth along each side of the trunk).
 */
export function buildOrthogonalTree(
  root: { x: number; y: number },
  terminals: TopoTerminal[],
  opts: TopologyOptions
): TopoSegment[] {
  const horizontal = opts.axis === 'h';
  // Work in (u, v): u along trunk axis, v perpendicular
  const toUV = (p: { x: number; y: number }) => (horizontal ? { u: p.x, v: p.y } : { u: p.y, v: p.x });
  const toXY = (u: number, v: number) => (horizontal ? { x: u, y: v } : { x: v, y: u });
  const r = toUV(root);

  // 1. Group terminals into stations by their projection on the trunk
  const stations: Station[] = [];
  const sorted = terminals
    .filter((t) => t.cfm > 0)
    .map((t) => {
      const p = toUV(t);
      let off = p.u - r.u;
      const dv = p.v - r.v;
      if (Math.abs(off) < opts.snapTol) {
        // Terminals that would force a zero-length trunk piece next to the unit are displaced minimally;
        // off-line ones simply branch from the unit node itself.
        off = Math.abs(dv) <= opts.onLineTol ? opts.minLen : 0;
      }
      return { t, u: off, dv };
    })
    .sort((a, b) => a.u - b.u);

  for (const item of sorted) {
    const last = stations.length ? stations[stations.length - 1] : undefined;
    const sameSide = last ? last.u >= 0 === item.u >= 0 : false;
    const unitNodeBlocksOnLine = !!last && last.u === 0 && Math.abs(item.dv) <= opts.onLineTol;
    if (last && sameSide && !unitNodeBlocksOnLine && Math.abs(last.u - item.u) <= opts.snapTol) {
      last.terminals.push({ t: item.t, dv: item.dv });
    } else {
      stations.push({ u: item.u, terminals: [{ t: item.t, dv: item.dv }] });
    }
  }

  const out: TopoSegment[] = [];
  let keyCounter = 0;
  const push = (seg: Omit<TopoSegment, 'key'>): number => {
    out.push({ ...seg, key: keyCounter++ });
    return out.length - 1;
  };

  const sides: Station[][] = [
    stations.filter((s) => s.u >= 0).sort((a, b) => a.u - b.u),
    stations.filter((s) => s.u < 0).sort((a, b) => b.u - a.u)
  ];

  const stationFlow = (s: Station) => s.terminals.reduce((acc, x) => acc + x.t.cfm, 0);

  for (const side of sides) {
    if (side.length === 0) continue;
    const sideTotals = side.map(stationFlow);
    // suffix sums of flow
    const suffix: number[] = new Array(side.length).fill(0);
    let acc = 0;
    for (let i = side.length - 1; i >= 0; i--) {
      acc += sideTotals[i];
      suffix[i] = acc;
    }
    const suffixIds: string[][] = new Array(side.length);
    let idsAcc: string[] = [];
    for (let i = side.length - 1; i >= 0; i--) {
      idsAcc = [...side[i].terminals.map((x) => x.t.id), ...idsAcc];
      suffixIds[i] = idsAcc;
    }

    // Trunk nodes along the side: node 0 = unit; node k at station k-1 (unit node reused when station.u ~ 0)
    let prevNode = -1; // index of trunk segment ending at current node, -1 = unit
    let prevU = 0;
    for (let i = 0; i < side.length; i++) {
      const st = side[i];
      const atUnit = Math.abs(st.u) < opts.snapTol;
      let trunkIdx = prevNode;

      if (!atUnit) {
        const startUV = { u: r.u + prevU, v: r.v };
        const endUV = { u: r.u + st.u, v: r.v };
        const onTrunkTerms = st.terminals.filter((x) => Math.abs(x.dv) <= opts.onLineTol);
        trunkIdx = push({
          kind: 'trunk',
          start: toXY(startUV.u, startUV.v),
          end: toXY(endUV.u, endUV.v),
          flow: suffix[i],
          parent: prevNode,
          direct: onTrunkTerms.map((x) => x.t.id),
          downstream: suffixIds[i],
          orientation: horizontal ? 'h' : 'v',
          isTakeoff: false,
          onTrunk: onTrunkTerms.length > 0
        });
        prevNode = trunkIdx;
        prevU = st.u;
      }

      // Perpendicular branches at this node, per side of the trunk
      const nodeUV = { u: r.u + (atUnit ? 0 : st.u), v: r.v };
      for (const dir of [1, -1]) {
        const group = st.terminals
          .filter((x) => Math.abs(x.dv) > opts.onLineTol && Math.sign(x.dv) === dir)
          .sort((a, b) => Math.abs(a.dv) - Math.abs(b.dv));
        if (group.length === 0) continue;
        let parent = trunkIdx;
        let from = { u: nodeUV.u, v: nodeUV.v };
        for (let g = 0; g < group.length; g++) {
          const rem = group.slice(g);
          const flow = rem.reduce((a, x) => a + x.t.cfm, 0);
          const to = { u: nodeUV.u, v: r.v + group[g].dv };
          const segIdx = push({
            kind: g === 0 && group.length > 1 ? 'branch' : 'runout',
            start: toXY(from.u, from.v),
            end: toXY(to.u, to.v),
            flow,
            parent,
            direct: [group[g].t.id],
            downstream: rem.map((x) => x.t.id),
            orientation: horizontal ? 'v' : 'h',
            isTakeoff: g === 0,
            onTrunk: false
          });
          parent = segIdx;
          from = to;
        }
      }
    }
  }

  return out;
}

/** Remove duplicate/zero-length/collinear-overlap hazards: asserts used by tests & callers. */
export function isOrthogonal(a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) < eps || Math.abs(a.y - b.y) < eps;
}
