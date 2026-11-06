/**
 * Sprinkler head selection and per-room head layout (NFPA 13-2019 Chapters 9, 10).
 *
 * - Head type: K-factor by hazard (§9.3), orientation by ceiling / system type (§7.2, §9.3.2), response (§9.3.3 —
 *   quick response required for light hazard) and temperature rating (§9.4.2, Table 7.2.4.1).
 * - Layout: uniform grid of S × L protection areas not exceeding the maximum spacing (§10.2.4.2) and area per
 *   sprinkler (Table 10.2.4.2.1(a)–(d)), walls at ≥ 102 mm (§10.2.5.2.3) and ≥ 1829 mm between heads (§10.2.5.3).
 */
import type { DesignCheck, HazardClass } from '../fpTypes';
import type { SprinklerAnswers, SprinklerHeadType, SprinklerOrientation, SprinklerRoomInput, SprinklerSystemType } from './sprinklerTypes';
import { MIN_SPRINKLER_SPACING_MM, MIN_WALL_DISTANCE_MM } from './nfpa13Sprinkler';
import { distanceToPolygonEdges, pointInPolygon, polygonArea } from './roomDetection';

const MM_PER_FT = 304.8;
const FT2_PER_M2 = 10.7639;

type Pt = [number, number];

// ─────────────────────────── Head selection ───────────────────────────

function kFactorOf(h: HazardClass): number {
  if (h === 'extra-1') return 8.0;
  if (h === 'extra-2') return 11.2;
  return 5.6;
}

/** Select the sprinkler head type for a room and system type (answers reserved for future project overrides). */
export function selectHeadType(room: SprinklerRoomInput, systemType: SprinklerSystemType, _answers: SprinklerAnswers): SprinklerHeadType {
  const k = kFactorOf(room.hazard);
  const deluge = systemType === 'deluge';
  let orientation: SprinklerOrientation;
  let code: 'PEN' | 'UPR' | 'DPEN' | 'OPEN';
  if (deluge) {
    orientation = room.ceilingType === 'exposed-structure' ? 'upright' : 'pendent';
    code = 'OPEN';
  } else if (room.ceilingType === 'exposed-structure') {
    orientation = 'upright';
    code = 'UPR';
  } else if (systemType === 'wet' && !room.freezing) {
    orientation = 'pendent';
    code = 'PEN';
  } else {
    orientation = 'dry-pendent'; // dry / preaction, or wet system serving a freezing room (§7.2.2, §8.2)
    code = 'DPEN';
  }
  const quick = !deluge && (room.hazard === 'light' || room.hazard === 'ordinary-1' || room.hazard === 'ordinary-2');
  const intermediate = room.heatSource;
  const tempRatingF = intermediate ? 200 : 155;
  const tempC = intermediate ? 93 : 68;
  const tempClass = intermediate ? 'intermediate' : 'ordinary';
  const response = quick ? 'quick' : 'standard';
  const orientText = code === 'OPEN' ? `open (deluge) ${orientation}` : orientation;
  return {
    id: `${quick ? 'QR' : 'SR'}-${code}-K${k}-${tempRatingF}`,
    description: `${quick ? 'Quick' : 'Standard'}-response ${orientText} spray sprinkler K${k}, ${tempRatingF}°F (${tempC}°C) ${tempClass}`,
    kFactor: k,
    orientation,
    response,
    tempRatingF,
    tempClass,
    bulbColor: intermediate ? 'green' : 'red',
    open: deluge
  };
}

// ─────────────────────────── Layout ───────────────────────────

export interface SpacingRule {
  maxAreaFt2: number;
  maxSpacingFt: number;
}

export interface RoomHeadLayout {
  points: Pt[];
  /** Spacing along the branch line direction, mm. */
  S: number;
  /** Spacing between branch lines, mm. */
  L: number;
}

function bboxOf(p: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of p) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Integer counts (nx, ny) with the fewest heads satisfying spacing and area limits. */
function chooseCounts(W: number, H: number, Smax: number, Amax: number): [number, number] {
  const eps = 1e-6;
  let best: { nx: number; ny: number; prod: number; diff: number } | null = null;
  const nxMax = Math.min(5000, Math.ceil(W / Smax) + Math.ceil((W * H) / Amax) + 2);
  for (let nx = 1; nx <= nxMax; nx++) {
    if (W / nx > Smax + eps) continue;
    let ny = Math.max(1, Math.ceil(H / Smax - eps), Math.ceil((W * H) / (nx * Amax) - eps));
    while (H / ny > Smax + eps || (W / nx) * (H / ny) > Amax * (1 + eps)) ny++;
    const cand = { nx, ny, prod: nx * ny, diff: Math.abs(W / nx - H / ny) };
    if (
      !best ||
      cand.prod < best.prod ||
      (cand.prod === best.prod && (cand.diff < best.diff - 1e-9 || (Math.abs(cand.diff - best.diff) <= 1e-9 && cand.nx < best.nx)))
    ) {
      best = cand;
    }
  }
  if (!best) return [Math.max(1, Math.ceil(W / Smax)), Math.max(1, Math.ceil(H / Smax))];
  return [best.nx, best.ny];
}

function layoutAlongX(poly: Pt[], rules: SpacingRule): RoomHeadLayout {
  const { minX, minY, maxX, maxY } = bboxOf(poly);
  const W = maxX - minX, H = maxY - minY;
  const Smax = rules.maxSpacingFt * MM_PER_FT;
  const Amax = (rules.maxAreaFt2 / FT2_PER_M2) * 1e6;
  let [nx, ny] = chooseCounts(W, H, Smax, Amax);
  const rectangular = Math.abs(polygonArea(poly) - W * H) <= 1e-6 * W * H + 1;

  const build = (): RoomHeadLayout => {
    const S = W / nx, L = H / ny;
    const pts: Pt[] = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const gx = minX + (i + 0.5) * S;
        const gy = minY + (j + 0.5) * L;
        if (rectangular) {
          pts.push([gx, gy]);
          continue;
        }
        if (pointInPolygon(gx, gy, poly) && distanceToPolygonEdges(gx, gy, poly) >= MIN_WALL_DISTANCE_MM) {
          pts.push([gx, gy]);
          continue;
        }
        // cell with no usable grid point: sample it on a 10 × 10 grid
        const x0 = minX + i * S, y0 = minY + j * L;
        const inside: Pt[] = [];
        for (let a = 0; a < 10; a++)
          for (let b = 0; b < 10; b++) {
            const sx = x0 + ((a + 0.5) / 10) * S;
            const sy = y0 + ((b + 0.5) / 10) * L;
            if (pointInPolygon(sx, sy, poly)) inside.push([sx, sy]);
          }
        if (inside.length < 5) continue; // < 5 % of the cell is inside the room
        const ax = inside.reduce((s, p) => s + p[0], 0) / inside.length;
        const ay = inside.reduce((s, p) => s + p[1], 0) / inside.length;
        if (pointInPolygon(ax, ay, poly) && distanceToPolygonEdges(ax, ay, poly) >= MIN_WALL_DISTANCE_MM) {
          pts.push([ax, ay]);
          continue;
        }
        let bestP: Pt | null = null;
        let bestD = Infinity;
        for (const p of inside) {
          if (distanceToPolygonEdges(p[0], p[1], poly) < MIN_WALL_DISTANCE_MM) continue;
          const d = Math.hypot(p[0] - ax, p[1] - ay);
          if (d < bestD) {
            bestD = d;
            bestP = p;
          }
        }
        if (bestP) pts.push(bestP);
      }
    }
    return { points: pts, S, L };
  };

  let res = build();
  if (rectangular) return res;
  for (let round = 0; round < 10; round++) {
    if (coverageGaps(poly, res.points, res.S, res.L, 'x') === 0) break;
    if (res.S >= res.L) nx++;
    else ny++;
    res = build();
  }
  return res;
}

/** Number of points of a 250 mm grid inside the room not covered by any head's S × L protection rectangle. */
function coverageGaps(poly: Pt[], pts: Pt[], S: number, L: number, direction: 'x' | 'y'): number {
  const { minX, minY, maxX, maxY } = bboxOf(poly);
  const hx = (direction === 'x' ? S : L) / 2 + 1;
  const hy = (direction === 'x' ? L : S) / 2 + 1;
  let gaps = 0;
  for (let x = minX + 125; x < maxX; x += 250)
    for (let y = minY + 125; y < maxY; y += 250) {
      if (!pointInPolygon(x, y, poly)) continue;
      if (!pts.some((p) => Math.abs(p[0] - x) <= hx && Math.abs(p[1] - y) <= hy)) gaps++;
    }
  return gaps;
}

/**
 * Lay out heads for a room. S is the spacing along the branch lines (the direction axis), L between branch lines.
 * Rectangular rooms get exactly nx · ny heads; other shapes are filled and validated for coverage.
 */
export function layoutRoomHeads(room: SprinklerRoomInput, direction: 'x' | 'y', rules: SpacingRule): RoomHeadLayout {
  if (direction === 'x') return layoutAlongX(room.polygon, rules);
  const swapped = room.polygon.map(([x, y]) => [y, x] as Pt);
  const r = layoutAlongX(swapped, rules);
  return { points: r.points.map(([x, y]) => [y, x] as Pt), S: r.S, L: r.L };
}

// ─────────────────────────── Room checks ───────────────────────────

/** Distance from (x, y) to the nearest polygon edge along the direction (dx, dy); Infinity when none. */
function rayDistance(x: number, y: number, dx: number, dy: number, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j];
    const [x2, y2] = poly[i];
    const ex = x2 - x1, ey = y2 - y1;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((x1 - x) * ey - (y1 - y) * ex) / den;
    const u = ((x1 - x) * dy - (y1 - y) * dx) / den;
    if (t >= 0 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}

/** NFPA 13-2019 room checks for a laid-out room; ids are `spr-…:${room.id}`. */
export function roomLayoutChecks(room: SprinklerRoomInput, layout: RoomHeadLayout, rules: SpacingRule, direction: 'x' | 'y'): DesignCheck[] {
  const { S, L, points } = layout;
  const Smax = rules.maxSpacingFt * MM_PER_FT;
  const area = (S * L) / 1e6 * FT2_PER_M2;
  const out: DesignCheck[] = [];
  const st = (ok: boolean): 'pass' | 'fail' => (ok ? 'pass' : 'fail');

  out.push({
    id: `spr-spacing:${room.id}`,
    title: `Sprinkler spacing — ${room.name}`,
    reference: 'NFPA 13-2019 §10.2.4.2 / Table 10.2.4.2.1(a)–(d)',
    status: st(S <= Smax + 0.5 && L <= Smax + 0.5),
    detail: `S ${(S / MM_PER_FT).toFixed(2)} ft × L ${(L / MM_PER_FT).toFixed(2)} ft (max ${rules.maxSpacingFt} ft)`
  });
  out.push({
    id: `spr-area:${room.id}`,
    title: `Area per sprinkler — ${room.name}`,
    reference: 'NFPA 13-2019 §10.2.4.2.1 / Table 10.2.4.2.1(a)–(d)',
    status: st(area <= rules.maxAreaFt2 * (1 + 1e-6)),
    detail: `${area.toFixed(1)} ft² per sprinkler (max ${rules.maxAreaFt2} ft²)`
  });

  let minWall = Infinity, maxAlong = 0, maxAcross = 0;
  for (const [x, y] of points) {
    minWall = Math.min(minWall, distanceToPolygonEdges(x, y, room.polygon));
    const ax = direction === 'x' ? [1, 0] : [0, 1];
    const cx = direction === 'x' ? [0, 1] : [1, 0];
    const along = Math.min(rayDistance(x, y, ax[0], ax[1], room.polygon), rayDistance(x, y, -ax[0], -ax[1], room.polygon));
    const across = Math.min(rayDistance(x, y, cx[0], cx[1], room.polygon), rayDistance(x, y, -cx[0], -cx[1], room.polygon));
    if (Number.isFinite(along)) maxAlong = Math.max(maxAlong, along);
    if (Number.isFinite(across)) maxAcross = Math.max(maxAcross, across);
  }
  if (points.length === 0) minWall = 0;
  const wallOk = minWall >= MIN_WALL_DISTANCE_MM - 0.5 && maxAlong <= S / 2 + 1 && maxAcross <= L / 2 + 1;
  out.push({
    id: `spr-wall-distance:${room.id}`,
    title: `Distance to walls — ${room.name}`,
    reference: 'NFPA 13-2019 §10.2.5.2.1 and §10.2.5.2.3',
    status: st(wallOk),
    detail: `min ${minWall.toFixed(0)} mm (≥ ${MIN_WALL_DISTANCE_MM}); max ${maxAlong.toFixed(0)} mm along branch (≤ ${(S / 2).toFixed(0)}), ${maxAcross.toFixed(0)} mm across (≤ ${(L / 2).toFixed(0)})`
  });

  let minSp = Infinity;
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) minSp = Math.min(minSp, Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]));
  out.push({
    id: `spr-min-spacing:${room.id}`,
    title: `Minimum sprinkler spacing — ${room.name}`,
    reference: 'NFPA 13-2019 §10.2.5.3',
    status: st(minSp >= MIN_SPRINKLER_SPACING_MM - 0.5),
    detail: Number.isFinite(minSp) ? `closest heads ${minSp.toFixed(0)} mm apart (≥ ${MIN_SPRINKLER_SPACING_MM} mm)` : 'single sprinkler'
  });

  const gaps = coverageGaps(room.polygon, points, S, L, direction);
  out.push({
    id: `spr-coverage:${room.id}`,
    title: `Coverage — ${room.name}`,
    reference: 'NFPA 13-2019 §10.2.4 (protection area per sprinkler)',
    status: st(gaps === 0),
    detail: gaps === 0 ? 'every point of the room lies within a sprinkler protection area' : `${gaps} sample points (250 mm grid) outside any protection area`
  });
  return out;
}
