/**
 * Shared helpers of the standpipe zoning drawings (FP-106 riser diagram zone bands / stations and the FP-111 study):
 * zone colours, labels, hatch strips and the zone-pump / break-tank symbols.
 */
import type { DrawingBuilder } from './drawingBuilder';
import type { FloorLevel, StandpipeSolution, StandpipeSystemDesign, StandpipeZone } from '../fpTypes';

/** Zone colour layers (cycled): blue, green, magenta, orange. */
export const zoneLayer = (i: number): string => `FP-ZONE-${(i % 4) + 1}`;

/** The solution used for the design and drawings. */
export const selectedSolution = (sp: StandpipeSystemDesign): StandpipeSolution => (sp.zoning.selected === 'without-prv' ? sp.zoning.withoutPrv : sp.zoning.withPrv);

export const withCommas = (v: number): string => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "L2 - L6" (or the single floor id) of a zone. */
export function floorsText(z: StandpipeZone): string {
  if (z.floorIds.length === 0) return '-';
  const a = z.floorIds[0];
  const b = z.floorIds[z.floorIds.length - 1];
  return a === b ? a : `${a} - ${b}`;
}

/** Where a zone is pumped from, in capitals. */
export function stationText(z: StandpipeZone, floors?: FloorLevel[]): string {
  const st = z.station;
  if (st.kind === 'pump-room') return 'PUMP ROOM - MAIN FIRE PUMPS';
  if (st.kind === 'express') return `PUMP ROOM - EXPRESS RISER ${z.id}`;
  const f = floors?.find((q) => q.id === st.floorId);
  return `SERVICE FLOOR ${st.floorId ?? ''}${f ? ` (${f.name.toUpperCase()})` : ''}`.trim();
}

/** 45 degree hatch (global grid) clipped to a rectangle on the given layer; spacing in model mm. */
export function hatchOnLayer(b: DrawingBuilder, layer: string, x: number, y: number, w: number, h: number, spacing: number): void {
  const step = spacing * Math.SQRT2;
  if (!(step > 0) || !(w > 0) || !(h > 0)) return;
  const k0 = Math.ceil((y - (x + w)) / step);
  const k1 = Math.floor((y + h - x) / step);
  for (let k = k0; k <= k1; k++) {
    const c = k * step;
    const xa = Math.max(x, y - c);
    const xb = Math.min(x + w, y + h - c);
    if (xb - xa > 1e-6) b.line(layer, xa, xa + c, xb, xb + c);
  }
}

/** Zone / booster pump: circle with a flow triangle (model mm, radius r). */
export function zonePumpSymbol(b: DrawingBuilder, x: number, y: number, r: number, dir: 'up' | 'right'): void {
  b.circle('FP-EQPM', x, y, r);
  const t: [number, number][] =
    dir === 'right'
      ? [[x - 0.5 * r, y - 0.56 * r], [x - 0.5 * r, y + 0.56 * r], [x + 0.62 * r, y]]
      : [[x - 0.56 * r, y - 0.5 * r], [x + 0.56 * r, y - 0.5 * r], [x, y + 0.62 * r]];
  b.polyline('FP-EQPM', t, true);
}

/** Break tank elevation symbol: walls, dashed water level and a roof line. Returns the water-level y. */
export function breakTankSymbol(b: DrawingBuilder, x0: number, y0: number, w: number, h: number): number {
  b.rect('FP-EQPM', x0, y0, w, h);
  const yw = y0 + h * 0.78;
  b.line('FP-WATR', x0 + w * 0.03, yw, x0 + w * 0.97, yw);
  b.line('FP-EQPM', x0 - w * 0.04, y0 + h, x0 + w * 1.04, y0 + h);
  return yw;
}
