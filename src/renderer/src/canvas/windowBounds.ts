// Pure window-bounds helpers (no Electron / DOM imports) so the main process and the tests share one implementation.

export interface WorkArea { x: number; y: number; width: number; height: number }
export interface SavedWindowState { x?: number; y?: number; width: number; height: number; maximized: boolean }
export interface WindowPlan {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximize: boolean;
}

export const DEFAULT_MIN_WIDTH = 1280;
export const DEFAULT_MIN_HEIGHT = 800;
export const WINDOW_MIN_WIDTH = 1100;
export const WINDOW_MIN_HEIGHT = 700;
export const DEFAULT_WORK_AREA_FRACTION = 0.9;

/** Default window size: 90 % of the work area, at least 1280 x 800 (but never larger than the work area itself). */
export function defaultWindowSize(wa: { width: number; height: number }): { width: number; height: number } {
  const w = Math.max(DEFAULT_MIN_WIDTH, Math.round(wa.width * DEFAULT_WORK_AREA_FRACTION));
  const h = Math.max(DEFAULT_MIN_HEIGHT, Math.round(wa.height * DEFAULT_WORK_AREA_FRACTION));
  return { width: Math.min(w, Math.max(WINDOW_MIN_WIDTH, wa.width)), height: Math.min(h, Math.max(WINDOW_MIN_HEIGHT, wa.height)) };
}

/** Parse the persisted JSON; anything malformed gives null. */
export function parseSavedWindowState(raw: string | null | undefined): SavedWindowState | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<SavedWindowState> | null;
    if (!o || typeof o !== 'object') return null;
    const w = Number(o.width), h = Number(o.height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 200 || h < 200) return null;
    const hasPos = typeof o.x === 'number' && typeof o.y === 'number' && Number.isFinite(o.x) && Number.isFinite(o.y);
    return {
      width: Math.round(w), height: Math.round(h), maximized: o.maximized === true,
      ...(hasPos ? { x: Math.round(o.x as number), y: Math.round(o.y as number) } : {})
    };
  } catch {
    return null;
  }
}

/** True when at least `minVisible` px of a window rect is inside one of the work areas (so it is reachable). */
export function isRectVisible(r: { x: number; y: number; width: number; height: number }, areas: WorkArea[], minVisible = 120): boolean {
  return areas.some((a) => {
    const ow = Math.min(r.x + r.width, a.x + a.width) - Math.max(r.x, a.x);
    const oh = Math.min(r.y + r.height, a.y + a.height) - Math.max(r.y, a.y);
    return ow >= minVisible && oh >= minVisible;
  });
}

/**
 * Plan the window: first run (no saved state) = default size, centred, opened maximized; later runs restore the saved
 * size / position / maximized flag, clamped to the minimum size and moved back on screen if its display is gone.
 */
export function computeWindowPlan(primary: WorkArea, saved: SavedWindowState | null, allAreas: WorkArea[] = [primary]): WindowPlan {
  if (!saved) {
    const d = defaultWindowSize(primary);
    return { x: primary.x + Math.round((primary.width - d.width) / 2), y: primary.y + Math.round((primary.height - d.height) / 2), ...d, maximize: true };
  }
  const width = Math.max(WINDOW_MIN_WIDTH, saved.width);
  const height = Math.max(WINDOW_MIN_HEIGHT, saved.height);
  const centred = {
    x: primary.x + Math.round((primary.width - Math.min(width, primary.width)) / 2),
    y: primary.y + Math.round((primary.height - Math.min(height, primary.height)) / 2)
  };
  const hasPos = saved.x !== undefined && saved.y !== undefined;
  const onScreen = hasPos && isRectVisible({ x: saved.x as number, y: saved.y as number, width, height }, allAreas);
  const pos = onScreen ? { x: saved.x as number, y: saved.y as number } : centred;
  return { ...pos, width, height, maximize: saved.maximized };
}
