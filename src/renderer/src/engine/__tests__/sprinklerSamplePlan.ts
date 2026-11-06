/**
 * Test fixture: a synthetic architectural floor plan DXF with realistic quirks (old-style POLYLINE, coincident-end
 * "closed" polyline, duplicate room, building outline, tiny closet, MTEXT with \P, INSERT, empty text value).
 * Coordinates are authored in millimetres; `factor` rescales them (e.g. 0.001 for a plan drawn in metres).
 */
export function buildSamplePlanDxf(opts: { insunits?: number; factor?: number } = {}): string {
  const f = opts.factor ?? 1;
  const n = (v: number): string => String(+(v * f).toFixed(6));
  const out: string[] = [];
  const g = (code: number, value: string | number): void => {
    out.push(String(code).padStart(3, ' '), typeof value === 'number' ? n(value) : value);
  };
  const lw = (layer: string, pts: [number, number][], closed: boolean): void => {
    g(0, 'LWPOLYLINE'); g(8, layer); g(90, String(pts.length)); g(70, closed ? '1' : '0');
    for (const [x, y] of pts) { g(10, x); g(20, y); }
  };
  g(0, 'SECTION'); g(2, 'HEADER');
  if (opts.insunits !== undefined) { g(9, '$INSUNITS'); g(70, String(opts.insunits)); }
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  // building outline (contains every room → must be dropped as an outer outline)
  lw('A-WALL', [[-300, -300], [31000, -300], [31000, 15000], [-300, 15000]], true);
  // office, drawn twice (duplicate must be removed)
  lw('A-ROOM', [[0, 0], [20000, 0], [20000, 12000], [0, 12000]], true);
  lw('A-ROOM', [[0, 0], [20000, 0], [20000, 12000], [0, 12000]], true);
  g(0, 'TEXT'); g(8, 'A-TEXT'); g(10, 10000); g(20, 6000); g(40, 300); g(1, 'OPEN OFFICE');
  g(0, 'TEXT'); g(8, 'A-TEXT'); g(10, 10500); g(20, 5500); g(40, 150); g(1, 'R-101');
  // storage — old-style POLYLINE closed by flag
  g(0, 'POLYLINE'); g(8, 'A-ROOM'); g(66, '1'); g(70, '1');
  for (const [x, y] of [[22000, 0], [30000, 0], [30000, 6000], [22000, 6000]] as [number, number][]) {
    g(0, 'VERTEX'); g(8, 'A-ROOM'); g(10, x); g(20, y);
  }
  g(0, 'SEQEND'); g(8, 'A-ROOM');
  g(0, 'MTEXT'); g(8, 'A-TEXT'); g(10, 26000); g(20, 3000); g(40, 250); g(1, '{\\fArial|b0;STORAGE\\PROOM}');
  // corridor — open polyline whose last vertex repeats the first (→ closed)
  lw('A-ROOM', [[0, 12500], [30000, 12500], [30000, 14500], [0, 14500], [0, 12500]], false);
  // closet below the 2 m² minimum
  lw('A-ROOM', [[22000, 8000], [23000, 8000], [23000, 9000], [22000, 9000]], true);
  // wall line, door block reference, empty text value (pairing robustness)
  g(0, 'LINE'); g(8, 'A-WALL'); g(10, 20000); g(20, 0); g(11, 20000); g(21, 12000);
  g(0, 'INSERT'); g(8, 'A-DOOR'); g(2, 'DOOR90'); g(10, 20000); g(20, 6000);
  g(0, 'TEXT'); g(8, 'A-TEXT'); g(10, 5000); g(20, 13500); g(40, 100); g(1, '');
  g(0, 'ENDSEC'); g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

/** The reference office used by the hydraulic oracle: 20 × 12 m light-hazard room, riser at (−500, 6000). */
export const OFFICE_POLYGON: [number, number][] = [[0, 0], [20000, 0], [20000, 12000], [0, 12000]];
