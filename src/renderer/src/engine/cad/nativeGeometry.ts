import type { BoundingBox, DxfEntity } from '../../store/projectStore';

export interface CadAffineMatrix { a: number; b: number; c: number; d: number; tx: number; ty: number }
const TAU = 2 * Math.PI;
const RAD = Math.PI / 180;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const mod = (n: number) => ((n % TAU) + TAU) % TAU;
const sweep = (start: number, end: number) => Math.abs(end - start) >= TAU - 1e-12 ? TAU : mod(end - start);
interface Conic { x: number; y: number; u: { x: number; y: number }; v: { x: number; y: number }; start: number; sweep: number }

export function validateCadEntity(ent: DxfEntity): string | null {
  if (ent.points && (ent.points.length % 2 !== 0 || !ent.points.every(finite))) return 'Invalid vertex coordinates';
  if (ent.bulges && !ent.bulges.every(finite)) return 'Invalid polyline bulge';
  for (const key of ['textHeight', 'rotationDeg', 'startParam', 'endParam', 'startAngleDeg', 'endAngleDeg'] as const) {
    if (ent[key] !== undefined && !finite(ent[key])) return `Invalid ${key}`;
  }
  if (ent.textHeight !== undefined && ent.textHeight <= 0) return 'Text height must be positive';
  if (ent.type === 'POLYLINE' || ent.type === 'LWPOLYLINE') return (ent.points?.length ?? 0) >= 4 ? null : 'Polyline requires two vertices';
  if (!finite(ent.x) || !finite(ent.y)) return 'Invalid or missing insertion coordinates';
  if (ent.type === 'LINE') return ent.points?.length === 2 ? null : 'Line requires an endpoint';
  if (ent.type === 'CIRCLE' || ent.type === 'ARC') {
    if (!finite(ent.radius) || ent.radius <= 0) return 'Radius must be finite and positive';
    if (ent.type === 'ARC' && (!finite(ent.startAngleDeg) || !finite(ent.endAngleDeg))) return 'Arc requires start and end angles';
    return null;
  }
  if (ent.type === 'ELLIPSE') {
    const u = ent.majorAxis, v = ent.minorAxis;
    if (!u || !v || ![u.x, u.y, v.x, v.y].every(finite)) return 'Ellipse requires independent finite axes';
    const lu = Math.hypot(u.x, u.y), lv = Math.hypot(v.x, v.y);
    if (lu === 0 || lv === 0 || (u.x / lu) * (v.y / lv) - (u.y / lu) * (v.x / lv) === 0) return 'Ellipse requires independent finite axes';
    return null;
  }
  if (ent.type === 'TEXT' || ent.type === 'MTEXT') return ent.text ? null : 'Empty text';
  return 'Unsupported entity';
}

function conic(ent: DxfEntity): Conic {
  const start = ent.type === 'ARC' ? ent.startAngleDeg! * RAD : ent.type === 'ELLIPSE' ? ent.startParam ?? 0 : 0;
  const end = ent.type === 'ARC' ? ent.endAngleDeg! * RAD : ent.type === 'ELLIPSE' ? ent.endParam ?? TAU : TAU;
  return { x: ent.x!, y: ent.y!, u: ent.majorAxis ?? { x: ent.radius!, y: 0 }, v: ent.minorAxis ?? { x: 0, y: -ent.radius! }, start, sweep: sweep(start, end) };
}
function at(c: Conic, t: number): [number, number] {
  return [c.x + c.u.x * Math.cos(t) + c.v.x * Math.sin(t), c.y + c.u.y * Math.cos(t) + c.v.y * Math.sin(t)];
}
function bulgeConic(x: number, y: number, ex: number, ey: number, bulge: number): Conic | null {
  const dx = ex - x, dy = ey - y, length = Math.hypot(dx, dy), b = -bulge;
  if (Math.abs(b) < 1e-15 || length === 0) return null;
  const offset = (1 - b * b) / (4 * b);
  const cx = (x + ex) / 2 - dy * offset, cy = (y + ey) / 2 + dx * offset;
  const r = length * (1 + b * b) / (4 * Math.abs(b));
  const direction = Math.sign(b);
  return { x: cx, y: cy, u: { x: r, y: 0 }, v: { x: 0, y: direction * r }, start: direction * Math.atan2(y - cy, x - cx), sweep: Math.abs(4 * Math.atan(b)) };
}
function sample(c: Conic, options: { maxSagitta?: number; maxSegments?: number }): number[] {
  const radius = Math.hypot(c.u.x, c.u.y) + Math.hypot(c.v.x, c.v.y);
  const tol = finite(options.maxSagitta) && options.maxSagitta > 0 ? options.maxSagitta : Math.max(radius * 0.001, 1e-6);
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / radius)));
  const limit = finite(options.maxSegments) ? Math.max(1, Math.min(65536, Math.floor(options.maxSegments))) : 4096;
  const count = Math.max(1, Math.min(limit, Math.ceil(c.sweep / Math.max(step, 1e-8))));
  const points: number[] = [];
  for (let i = 0; i <= count; i++) points.push(...at(c, c.start + c.sweep * i / count));
  return points;
}

/** Canvas coordinates only. Sampling is for display; native parameters remain authoritative. */
export function getCadEntityPath(ent: DxfEntity, options: { maxSagitta?: number; maxSegments?: number } = {}): number[] {
  if (validateCadEntity(ent)) return [];
  if (ent.type === 'LINE') return [ent.x!, ent.y!, ...ent.points!];
  if (ent.type === 'CIRCLE' || ent.type === 'ARC' || ent.type === 'ELLIPSE') return sample(conic(ent), options);
  if (ent.type === 'TEXT' || ent.type === 'MTEXT') return [ent.x!, ent.y!];
  const vertices = ent.points!, n = vertices.length / 2, points = vertices.slice(0, 2);
  for (let i = 0; i < n - (ent.closed ? 0 : 1); i++) {
    const j = (i + 1) % n;
    const c = bulgeConic(vertices[2 * i], vertices[2 * i + 1], vertices[2 * j], vertices[2 * j + 1], ent.bulges?.[i] ?? 0);
    const segment = c ? sample(c, options).slice(2) : vertices.slice(2 * j, 2 * j + 2);
    for (const coordinate of segment) points.push(coordinate);
  }
  return points;
}
function conicExtrema(c: Conic): number[] {
  const angles = [c.start, c.start + c.sweep];
  for (const t of [Math.atan2(c.v.x, c.u.x), Math.atan2(c.v.y, c.u.y)]) {
    for (const candidate of [t, t + Math.PI]) if (mod(candidate - c.start) <= c.sweep + 1e-12) angles.push(candidate);
  }
  return angles.flatMap(t => at(c, t));
}
export function getCadEntityBounds(ent: DxfEntity): BoundingBox {
  if (validateCadEntity(ent)) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let points: number[];
  if (ent.type === 'CIRCLE' || ent.type === 'ARC' || ent.type === 'ELLIPSE') points = conicExtrema(conic(ent));
  else if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
    points = ent.points!.slice(); const n = points.length / 2;
    for (let i = 0; i < n - (ent.closed ? 0 : 1); i++) {
      const j = (i + 1) % n, vertices = ent.points!;
      const c = bulgeConic(vertices[2 * i], vertices[2 * i + 1], vertices[2 * j], vertices[2 * j + 1], ent.bulges?.[i] ?? 0);
      if (c) points.push(...conicExtrema(c));
    }
  } else points = getCadEntityPath(ent);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) { minX = Math.min(minX, points[i]); maxX = Math.max(maxX, points[i]); minY = Math.min(minY, points[i + 1]); maxY = Math.max(maxY, points[i + 1]); }
  return { minX, maxX, minY, maxY };
}

export function transformCadEntity(ent: DxfEntity, m: CadAffineMatrix): DxfEntity {
  const result = { ...ent };
  const vec = (x: number, y: number) => ({ x: m.a * x + m.c * y, y: m.b * x + m.d * y });
  const point = (x: number, y: number) => { const p = vec(x, y); return { x: p.x + m.tx, y: p.y + m.ty }; };
  if (ent.x !== undefined && ent.y !== undefined) Object.assign(result, point(ent.x, ent.y));
  const sx = Math.hypot(m.a, m.b), sy = Math.hypot(m.c, m.d), det = m.a * m.d - m.b * m.c;
  const uniform = Math.abs(sx - sy) <= Math.max(sx, sy) * 1e-10 && Math.abs(m.a * m.c + m.b * m.d) <= sx * sy * 1e-10;
  if (ent.type === 'ELLIPSE' || ((ent.type === 'CIRCLE' || ent.type === 'ARC') && !uniform)) {
    const c = conic(ent);
    result.type = 'ELLIPSE'; result.majorAxis = vec(c.u.x, c.u.y); result.minorAxis = vec(c.v.x, c.v.y);
    result.startParam = c.start; result.endParam = c.start + c.sweep;
    delete result.radius; delete result.startAngleDeg; delete result.endAngleDeg;
  } else if (ent.type === 'CIRCLE' || ent.type === 'ARC') {
    result.radius = ent.radius! * sx;
    if (ent.type === 'ARC') {
      const angle = (deg: number) => { const p = vec(Math.cos(deg * RAD), -Math.sin(deg * RAD)); return mod(Math.atan2(-p.y, p.x)) / RAD; };
      result.startAngleDeg = angle(det < 0 ? ent.endAngleDeg! : ent.startAngleDeg!);
      result.endAngleDeg = angle(det < 0 ? ent.startAngleDeg! : ent.endAngleDeg!);
      if (Math.abs(ent.endAngleDeg! - ent.startAngleDeg!) >= 360) result.endAngleDeg = result.startAngleDeg + 360;
    }
  }
  if (ent.points) {
    let vertices = ent.points;
    if (!uniform && ent.bulges?.some(b => b !== 0)) {
      vertices = getCadEntityPath(ent); result.bulges = undefined;
      result.geometryApproximation = 'Affine-transformed bulged polyline sampled for display';
    } else if (ent.bulges) result.bulges = ent.bulges.map(b => det < 0 ? -b : b);
    result.points = [];
    for (let i = 0; i < vertices.length; i += 2) { const p = point(vertices[i], vertices[i + 1]); result.points.push(p.x, p.y); }
  }
  if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
    const rotation = (ent.rotationDeg ?? 0) * RAD, p = vec(Math.cos(rotation), -Math.sin(rotation));
    result.rotationDeg = Math.atan2(-p.y, p.x) / RAD;
    const heightVector = vec(Math.sin(rotation), Math.cos(rotation));
    if (ent.textHeight !== undefined) result.textHeight = ent.textHeight * Math.hypot(heightVector.x, heightVector.y);
    if (!uniform || det < 0) result.geometryApproximation = 'Text affine shape requires source font/layout; anchor and baseline retained';
  }
  return result;
}
