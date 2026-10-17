import { formatVelocity } from '../../format/units';
import { diffuserCatalogFor } from '../hvacCatalogs';
import { MAX_NECK_VELOCITY_FPM, neckAreaSqFt } from './diffuserSelector';
import { MM_PER_IN } from '../units';

export type TargetUnits = 'imperial' | 'metric';

/** Modular face sizes (in) of the target system: metric 600x600 / 600x300 / 300x300 mm; imperial 24x24 / 24x12 / 12x12 ... */
const MODULAR_FACES_IN: Record<TargetUnits, Array<{ w: number; h: number }>> = {
  metric: [{ w: 600, h: 600 }, { w: 600, h: 300 }, { w: 300, h: 300 }].map((f) => ({ w: f.w / MM_PER_IN, h: f.h / MM_PER_IN })),
  imperial: [{ w: 24, h: 24 }, { w: 24, h: 12 }, { w: 18, h: 18 }, { w: 12, h: 12 }, { w: 9, h: 9 }]
};

export interface RemappedTerminalSize {
  /** Face label in the target system (`600x600` or `24"x24"`). */
  size: string;
  faceWidthIn: number;
  faceHeightIn: number;
  neckVelocityFpm: number;
  /** Neck velocity above the limit at the unchanged CFM; a warning text, undefined when fine. */
  warning?: string;
}

const sortedFaces = (a: { w: number; h: number }): { w: number; h: number } => ({ w: Math.max(a.w, a.h), h: Math.min(a.w, a.h) });

/**
 * Maps a terminal face (in) to the nearest modular size of the target unit system (CFM unchanged) and rechecks the neck
 * velocity on the target catalogue: the smallest neck of that face that carries the CFM within the limit is used; if none
 * does, the largest neck is reported with a warning.
 */
export function remapTerminalSize(faceWIn: number, faceHIn: number, cfm: number, target: TargetUnits): RemappedTerminalSize {
  const src = sortedFaces({ w: faceWIn, h: faceHIn });
  let best = MODULAR_FACES_IN[target][0];
  let bestCost = Infinity;
  for (const f of MODULAR_FACES_IN[target]) {
    const c = sortedFaces(f);
    const cost = Math.abs(Math.log((c.w * c.h) / (src.w * src.h))) + 2 * Math.abs(Math.log(c.w / c.h) - Math.log(src.w / src.h));
    if (cost < bestCost - 1e-12) { bestCost = cost; best = f; }
  }
  const catalog = diffuserCatalogFor(target).filter((d) => d.terminalType === 'square-ceiling' || d.terminalType === 'round-ceiling');
  const sameFace = catalog
    .filter((d) => Math.abs(d.faceSizeIn.width - best.w) < 0.5 && Math.abs(d.faceSizeIn.height - best.h) < 0.5)
    .sort((a, b) => neckAreaSqFt(a) - neckAreaSqFt(b));
  const pool = sameFace.length ? sameFace : catalog.slice().sort((a, b) => neckAreaSqFt(a) - neckAreaSqFt(b));
  const fit = pool.find((d) => neckAreaSqFt(d) > 0 && cfm / neckAreaSqFt(d) <= MAX_NECK_VELOCITY_FPM && cfm <= d.maxCfm);
  const item = fit ?? pool[pool.length - 1];
  const area = item ? neckAreaSqFt(item) : 0;
  const vel = area > 0 ? Math.round(cfm / area) : 0;
  const size = target === 'metric'
    ? `${Math.round(best.w * MM_PER_IN)}x${Math.round(best.h * MM_PER_IN)}`
    : `${parseFloat(best.w.toFixed(2))}"x${parseFloat(best.h.toFixed(2))}"`;
  return {
    size,
    faceWidthIn: best.w,
    faceHeightIn: best.h,
    neckVelocityFpm: vel,
    warning: fit ? undefined : `Neck velocity ${formatVelocity(vel, 'imperial')} exceeds ${formatVelocity(MAX_NECK_VELOCITY_FPM, 'imperial')} at this airflow - add a terminal or enlarge the neck`
  };
}
