import { fitBounds, FIT_PADDING, unionBounds, pointsBounds } from '../../canvas/drawingGeometry';

function assert(c: boolean, m: string): void {
  if (!c) throw new Error(m);
}
console.log('=== Running Fit Bounds Test ===');

// demo-like: four zones within ~60..1000 world px
const zones = [
  [60, 60, 500, 60, 500, 400, 60, 400],
  [520, 60, 1000, 60, 1000, 400, 520, 400],
  [60, 420, 500, 420, 500, 700, 60, 700],
  [520, 420, 1000, 420, 1000, 700, 520, 700]
];
const b = unionBounds(zones.map((z) => pointsBounds(z)))!;
const pad = { top: FIT_PADDING.top + 60, right: FIT_PADDING.right + 60, bottom: FIT_PADDING.bottom + 60, left: FIT_PADDING.left + 60 };
const W = 1400, H = 800;
const f = fitBounds(b, W, H, 0.92, pad);
assert(f.scale > 0.5 && f.scale < 1.5, `scale sane, got ${f.scale}`);
const cx = (pad.left + (W - pad.left - pad.right) / 2 - f.x) / f.scale;
const cy = (pad.top + (H - pad.top - pad.bottom) / 2 - f.y) / f.scale;
assert(cx >= b.minX && cx <= b.maxX && cy >= b.minY && cy <= b.maxY, 'centre inside zone bbox');
assert(b.minX * f.scale + f.x >= pad.left && b.maxX * f.scale + f.x <= W - pad.right, 'x within padded view');
assert(b.minY * f.scale + f.y >= pad.top && b.maxY * f.scale + f.y <= H - pad.bottom, 'y within padded view');

// Fit is a pure function of world bounds: no label input exists, so labels cannot blow up the extents
const f2 = fitBounds(b, W, H, 0.92, pad);
assert(f2.scale === f.scale && f2.x === f.x && f2.y === f.y, 'deterministic, no label feedback');
console.log('Fit Bounds tests passed');
