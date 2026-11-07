/**
 * FP-111 — STANDPIPE ZONING STUDY, WITH PRV vs WITHOUT PRV.
 * Two schematic building elevations side by side (left: single zone with PRVs on the floors that need them; right:
 * pressure zones with their pump stations, express risers and service-floor break tanks), the comparison table, the
 * per-zone tables of both solutions, the comparison notes and the service-floor answer.
 */
import type { FloorLevel, StandpipeOutlet, StandpipeSolution, StandpipeZone } from '../fpTypes';
import { checkValve, gateValve } from './symbols';
import { type Ctx, FRAME, PX, PY, autoCols, drawNotes, drawTable, sheetTitle, textWidth } from './sheetKit';
import { prvSymbol, psi } from './sheetStandpipe';
import { breakTankSymbol, floorsText, hatchOnLayer, stationText, withCommas, zoneLayer, zonePumpSymbol } from './sheetStandpipeZoneKit';

type P2 = [number, number];

const f1 = (v: number): string => v.toFixed(1);
const yn = (v: boolean): string => (v ? 'YES' : 'NO');

/** Per-floor PRV demand of the single-zone solution: the actual outlets when it is selected, else the static check against the 175 / 100 psi limits. */
function prvFloors(c: Ctx): { floorId: string; elevationM: number; count: number; staticPsi: number }[] {
  const sp = c.r.standpipe!;
  const zn = sp.zoning;
  const z0 = zn.withPrv.zones[0];
  const map = new Map<string, { floorId: string; elevationM: number; count: number; staticPsi: number }>();
  if (!z0) return [];
  const pumpCl = z0.station.pumpCLElevationM;
  for (const q of sp.risers) {
    for (const o of q.outlets as StandpipeOutlet[]) {
      const st = z0.churnDischargePsi - 0.433 * (o.elevationM - pumpCl) * 3.28084;
      const need = zn.selected === 'with-prv' ? o.prvRequired : st > (o.sizeIn <= 1.5 ? 100 : 175) + 1e-9;
      if (!need) continue;
      const cur = map.get(o.floorId) ?? { floorId: o.floorId, elevationM: o.elevationM, count: 0, staticPsi: 0 };
      cur.count += 1;
      cur.staticPsi = Math.max(cur.staticPsi, zn.selected === 'with-prv' ? o.staticPsi : st);
      map.set(o.floorId, cur);
    }
  }
  return [...map.values()].sort((a, b) => a.elevationM - b.elevationM);
}

const topResidual = (s: StandpipeSolution): number => (s.zones.length ? s.zones[s.zones.length - 1].topResidualPsi : 0);

export function drawStandpipeZoningSheet(c: Ctx): void {
  const { b, sheet, r } = c;
  const S = sheet.scale;
  const sp = r.standpipe!;
  const zn = sp.zoning;
  const floors = r.input.building!.floors;
  const roofF = floors.find((f) => f.isRoof) ?? floors[floors.length - 1];
  const lowEl = floors[0].elevationM;
  const X = (v: number): number => PX(c, v);
  const Y = (v: number): number => PY(c, v);
  const ln = (layer: string, a: number, y1: number, x2: number, y2: number): void => b.line(layer, X(a), Y(y1), X(x2), Y(y2));
  const tx = (layer: string, x: number, y: number, h: number, s: string, o: { align?: 'left' | 'center' | 'right'; vAlign?: 'baseline' | 'middle' } = {}): void =>
    b.text(layer, X(x), Y(y), h, s, { align: o.align ?? 'left', vAlign: o.vAlign ?? 'middle' });
  /** Double-line pipe segment (paper coordinates). */
  const pipe = (layer: string, pts: P2[], w = 1.0): void => b.pipe(layer, pts.map(([x, y]) => [X(x), Y(y)] as P2), w * S, false);
  const floorOf = (id: string): FloorLevel | undefined => floors.find((f) => f.id === id);

  const sel = zn.selected;
  const selSol = sel === 'without-prv' ? zn.withoutPrv : zn.withPrv;
  const selLabel = sel === 'without-prv' ? 'WITHOUT PRV (AVOID PRVs: ZONES + PUMP SETS)' : 'WITH PRV (SINGLE ZONE + PRESSURE-REGULATING VALVES)';
  sheetTitle(c, 30, 568, 'STANDPIPE ZONING STUDY - WITH PRV vs WITHOUT PRV', `SELECTED: ${selLabel} - SCHEMATIC ELEVATIONS, NOT TO SCALE`);

  // ───────────────────────── elevations ─────────────────────────
  const Y0 = 112; // paper y of the lowest floor
  const yTopLimit = 520;
  const topEl = roofF.elevationM + 1.2;
  const ppm = Math.min(12, (yTopLimit - Y0) / Math.max(1, topEl - lowEl));
  const yOf = (m: number): number => Y0 + (m - lowEl) * ppm;
  const wA = 190;
  const panels = [{ ox: 28, kind: 'with-prv' as const }, { ox: 226, kind: 'without-prv' as const }];

  const bldg = (ox: number): { bl: number; br: number } => {
    const bl = ox + 20;
    const br = ox + 100;
    ln('FP-WALL', bl, yOf(lowEl) - 0.8, bl, yOf(topEl));
    ln('FP-WALL', br, yOf(lowEl) - 0.8, br, yOf(topEl));
    ln('FP-WALL', bl, yOf(lowEl) - 0.8, br, yOf(lowEl) - 0.8);
    for (const f of floors) {
      const y = yOf(f.elevationM);
      ln('FP-WALL', bl - 1.5, y, br + 1.5, y);
      tx('FP-ANNO', ox + 18, y + (f.isRoof ? 0 : 1.1), 2, f.id, { align: 'right' });
    }
    return { bl, br };
  };

  // panel headers
  const hdr = (ox: number, kind: 'with-prv' | 'without-prv', l1: string, l2: string): void => {
    const yFT = yOf(topEl) + 6;
    tx('FP-ANNO', ox + wA / 2, yFT + 9, 3.2, l1, { align: 'center' });
    tx('FP-ANNO', ox + wA / 2, yFT + 3.8, 2.2, l2, { align: 'center' });
    if (sel === kind) {
      const w = textWidth(2.4, 'SELECTED') + 5;
      b.rect('FP-ANNO', X(ox + wA - w), Y(yFT + 5.5), w * S, 6 * S);
      tx('FP-ANNO', ox + wA - w / 2, yFT + 8.5, 2.4, 'SELECTED', { align: 'center' });
      // heavier frame round the selected elevation
      b.rect('FP-ANNO', X(ox - 2), Y(Y0 - 28), (wA + 4) * S, (yFT - (Y0 - 28)) * S);
      b.rect('FP-ANNO', X(ox - 1.4), Y(Y0 - 27.4), (wA + 2.8) * S, (yFT - 0.6 - (Y0 - 27.4)) * S);
    } else {
      b.rect('FP-TABL', X(ox - 2), Y(Y0 - 28), (wA + 4) * S, (yFT - (Y0 - 28)) * S);
    }
  };

  // ── left: WITH PRV ──
  {
    const { ox } = panels[0];
    const w = zn.withPrv;
    const z0 = w.zones[0];
    const { bl, br } = bldg(ox);
    const xr = bl + 40;
    hdr(ox, 'with-prv', 'WITH PRV - SINGLE ZONE', `${w.pumpSets} PUMP SET, ${w.prvCount} PRV, MAX STATIC ${psi(w.maxStaticPsi)} PSI`);
    // zone strip
    const yLo = yOf(lowEl) - 0.8;
    const yHi = yOf(topEl);
    b.rect(zoneLayer(0), X(bl), Y(yLo), 2.5 * S, (yHi - yLo) * S);
    hatchOnLayer(b, zoneLayer(0), X(bl), Y(yLo), 2.5 * S, (yHi - yLo) * S, 1.6 * S);
    const yPump = yOf(lowEl) - 8;
    pipe('FP-PIPE-DISC', [[xr, yPump + 2.6], [xr, yOf(sp.risers[0]?.topElevationM ?? topEl) + 1.5]], 1.1);
    zonePumpSymbol(b, X(xr), Y(yPump), 2.6 * S, 'up');
    tx('FP-ANNO', xr + 5, yPump + 1.2, 2, 'FIRE PUMP ROOM');
    tx('FP-ANNO', xr + 5, yPump - 1.8, 2, z0 ? `MAIN PUMP ${z0.ratedFlowGpm} GPM @ ${z0.ratedNetPressurePsi} PSI` : '');
    // outlets (ticks) and PRVs
    const levels = new Set<number>();
    for (const q of sp.risers) for (const o of q.outlets) levels.add(Math.round(o.elevationM * 1000) / 1000);
    const prv = prvFloors(c);
    const prvAt = new Map(prv.map((p) => [Math.round(p.elevationM * 1000) / 1000, p]));
    for (const el of levels) {
      const y = yOf(el);
      const p = prvAt.get(el);
      if (p) {
        ln('FP-PIPE-DISC', xr, y, br - 12, y);
        prvSymbol(b, X(xr + 12), Y(y), 4 * S);
        tx('FP-ANNO', br + 3, y, 2, `${p.count} PRV - STATIC ${psi(p.staticPsi)} PSI`);
      } else {
        ln('FP-PIPE-DISC', xr, y, xr + 3, y);
      }
    }
    const sub = prv.length ? `PRV SET 175 PSI AT ${prv.length} FLOOR${prv.length > 1 ? 'S' : ''}` : 'NO PRV REQUIRED';
    tx('FP-ANNO', br + 3, Y0 - 15, 2, sub);
    tx('FP-ANNO', br + 3, Y0 - 18.5, 2, `PUMP CHURN + SUCTION AT THE BASE: ${psi(z0 ? z0.churnDischargePsi : 0)} PSI`);
    tx('FP-ANNO', br + 3, Y0 - 22, 2, 'LIMIT AT HOSE OUTLETS: 175 PSI (NFPA 14 SEC. 7.2.3)');
  }

  // ── right: WITHOUT PRV ──
  {
    const { ox } = panels[1];
    const w = zn.withoutPrv;
    const zs = w.zones;
    const { bl, br } = bldg(ox);
    hdr(ox, 'without-prv', `WITHOUT PRV - ${zs.length} ZONE${zs.length === 1 ? '' : 'S'}`, `${w.pumpSets} PUMP SETS, ${w.expressRisers} EXPRESS RISERS, ${w.serviceFloorStations.length} SERVICE FLOOR STATIONS, ${w.prvCount} PRV`);
    const xr = bl + 66;
    const bandLo = (zi: number): number => (zi === 0 ? yOf(lowEl) - 0.8 : yOf(floorOf(zs[zi].floorIds[0])?.elevationM ?? zs[zi].bottomOutletElevationM));
    const bandHi = (zi: number): number => (zi + 1 < zs.length ? bandLo(zi + 1) : yOf(topEl));
    const bottomStation = (z: StandpipeZone): boolean => z.station.kind === 'service-floor' && z.floorIds[0] === z.station.floorId;
    const slotZ = zs.map((z, zi) => ({ z, zi })).filter(({ z, zi }) => zi > 0 && !bottomStation(z)).sort((a, q) => q.zi - a.zi);
    const pitchS = slotZ.length > 1 ? Math.min(4.5, 18 / (slotZ.length - 1)) : 4.5;
    const slotX = (zi: number): number => bl + 39 + slotZ.findIndex((q) => q.zi === zi) * pitchS;
    const yPumpRoom = yOf(lowEl) - 8;
    const ySupply = yOf(lowEl) - 13;
    const stations = [...new Set(zs.filter((z) => z.station.kind === 'service-floor' && z.station.floorId).map((z) => z.station.floorId as string))];
    const yBase = new Map<number, number>();
    const yPumpOf = new Map<number, number>();
    // pump levels on the service floors
    for (const fid of stations) {
      const fl = floorOf(fid);
      if (!fl) continue;
      zs.filter((z) => z.station.floorId === fid && z.station.kind === 'service-floor').forEach((z, i) => yPumpOf.set(zs.indexOf(z), yOf(fl.elevationM) + 2.6 + i * 5.2));
    }
    zs.forEach((z, zi) => {
      const lay = zoneLayer(zi);
      const lo = bandLo(zi);
      const hi = bandHi(zi);
      b.rect(lay, X(bl), Y(lo), 2.5 * S, (hi - lo) * S);
      hatchOnLayer(b, lay, X(bl), Y(lo), 2.5 * S, (hi - lo) * S, 1.6 * S);
      if (zi > 0) ln(lay, bl, lo + 0.5, br, lo + 0.5);
      // zone annotation
      const yc = (lo + hi) / 2;
      const lines = [`ZONE ${z.id} - ${floorsText(z)}`, `${z.ratedFlowGpm} GPM @ ${z.ratedNetPressurePsi} PSI`, `STATIC ${psi(z.maxStaticPsi)} / TOP ${psi(z.topResidualPsi)} PSI`, ...(z.prvOutlets > 0 ? [`${z.prvOutlets} PRV STILL REQUIRED`] : [])];
      const pitch = 3.2;
      lines.forEach((t, i) => tx(lay, br + 3, yc + ((lines.length - 1) / 2 - i) * pitch, i === 0 ? 2.4 : 2, t));
      // base of the zone riser
      if (zi === 0) {
        yBase.set(zi, yOf(lowEl) - 8);
      } else if (bottomStation(z) && yPumpOf.has(zi)) {
        yBase.set(zi, yPumpOf.get(zi)!);
      } else {
        const prevTop = yOf(zs[zi - 1].topOutletElevationM) + 2;
        let y = yOf(z.bottomOutletElevationM) - 3;
        if (y < prevTop + 1.5) y = (prevTop + yOf(z.bottomOutletElevationM)) / 2;
        yBase.set(zi, y);
      }
    });
    const yEnd = (zi: number): number => {
      const top = yOf(zs[zi].topOutletElevationM) + 2;
      const nb = yBase.get(zi + 1);
      return nb !== undefined ? Math.min(top, nb - 1.5) : top;
    };
    // pump room supply line
    const xs0 = slotZ.length ? slotX(slotZ[slotZ.length - 1].zi) - 4 : xr - 10;
    const hasExpress = zs.some((z) => z.station.kind === 'express');
    if (hasExpress) {
      pipe('FP-PIPE-SUCT', [[Math.min(xs0, ...slotZ.filter((q) => q.z.station.kind === 'express').map((q) => slotX(q.zi))) - 1.5, ySupply], [xr, ySupply], [xr, yPumpRoom - 2.6]], 0.8);
    } else {
      pipe('FP-PIPE-SUCT', [[xr, ySupply], [xr, yPumpRoom - 2.6]], 0.8);
    }
    tx('FP-ANNO', bl + 1, yOf(lowEl) - 17.5, 2, `PUMP ROOM: ${zs.filter((z) => z.station.kind !== 'service-floor').map((z) => z.id).join(', ')}${hasExpress ? ` (EXPRESS RISERS ${zs.filter((z) => z.station.kind === 'express').map((z) => z.id).join(', ')})` : ''}`);
    // Z1 pump and riser
    zonePumpSymbol(b, X(xr), Y(yPumpRoom), 2.4 * S, 'up');

    // stations
    for (const fid of stations) {
      const fl = floorOf(fid);
      if (!fl) continue;
      const zsAt = zs.map((z, zi) => ({ z, zi })).filter(({ z }) => z.station.floorId === fid && z.station.kind === 'service-floor');
      const yF = yOf(fl.elevationM);
      const f2f = Math.max(fl.floorToFloorM, 3) * ppm;
      const tH = Math.min(7, Math.max(3, 0.42 * f2f));
      const tx0 = bl + 7;
      const tw = 18;
      breakTankSymbol(b, X(tx0), Y(yF + 0.4), tw * S, tH * S);
      const ys = zsAt.map((q) => yPumpOf.get(q.zi)!);
      const manX = bl + 27;
      const pumpX = bl + 32;
      pipe('FP-PIPE-SUCT', [[tx0 + tw, Math.min(...ys)], [manX, Math.min(...ys)], [manX, Math.max(...ys)]], 0.8);
      const tank = zsAt[0].z.breakTank;
      const lines = [`BREAK TANK ${fid}`, tank ? `${f1(tank.volumeM3)} M3` : '', `BOOSTER ${zsAt.map((q) => q.z.id).join('/')}`].filter((t) => t);
      const nLines = f2f >= 13 ? lines.length : 2;
      for (let i = 0; i < nLines; i++) tx('FP-ANNO', bl + 4, yF + 0.4 + tH + 2.2 + (nLines - 1 - i) * 2.6, 1.9, lines[i]);
      // fill line from the zone below
      const zi0 = zsAt[0].zi;
      if (zi0 > 0) {
        const yTap = yEnd(zi0 - 1) - 0.8;
        const xf = bl + 4.8;
        pipe('FP-PIPE-DISC', [[xr, yTap], [xf, yTap], [xf, yF + 0.4 + tH - 1.2], [tx0, yF + 0.4 + tH - 1.2]], 0.5);
        tx('FP-ANNO', bl + 6.5, yTap + 2, 1.9, `FILL LINE FROM ${zs[zi0 - 1].id}`);
      }
      for (const q of zsAt) {
        const y = yPumpOf.get(q.zi)!;
        pipe('FP-PIPE-SUCT', [[manX, y], [pumpX - 2.2, y]], 0.8);
        zonePumpSymbol(b, X(pumpX), Y(y), 2.2 * S, 'right');
        if (bottomStation(q.z)) pipe('FP-PIPE-DISC', [[pumpX + 2.2, y], [xr, y]], 1.0);
        else pipe('FP-PIPE-DISC', [[pumpX + 2.2, y], [slotX(q.zi), y], [slotX(q.zi), yBase.get(q.zi)!], [xr, yBase.get(q.zi)!]], 1.0);
      }
    }
    // express zones
    zs.forEach((z, zi) => {
      if (zi === 0 || z.station.kind !== 'express') return;
      const sx = slotX(zi);
      zonePumpSymbol(b, X(sx), Y(yPumpRoom), 2.0 * S, 'up');
      pipe('FP-PIPE-SUCT', [[sx, yPumpRoom - 2], [sx, ySupply]], 0.8);
      pipe('FP-PIPE-DISC', [[sx, yPumpRoom + 2], [sx, yBase.get(zi)!], [xr, yBase.get(zi)!]], 1.0);
    });
    // isolation valves on every zone header and the zone riser segments
    zs.forEach((_z, zi) => {
      const y0 = yBase.get(zi)!;
      const y1 = zi === zs.length - 1 ? yOf(topEl) - 0.5 : yEnd(zi);
      pipe('FP-PIPE-DISC', [[xr, zi === 0 ? yPumpRoom + 2.4 : y0], [xr, Math.max(y1, y0 + 2)]], 1.1);
      ln('FP-PIPE-DISC', xr - 0.9, Math.max(y1, y0 + 2), xr + 0.9, Math.max(y1, y0 + 2));
      if (zi > 0) {
        gateValve(b, X(xr - 5.5), Y(y0), 0, 3 * S);
        checkValve(b, X(xr - 9), Y(y0), 0, 3 * S);
      }
    });
    // outlets
    const levels = new Set<number>();
    for (const q of sp.risers) for (const o of q.outlets) levels.add(Math.round(o.elevationM * 1000) / 1000);
    for (const el of levels) ln('FP-PIPE-DISC', xr, yOf(el), xr + 3, yOf(el));
  }

  // ───────────────────────── legend ─────────────────────────
  {
    let lx = 28;
    const ly = 79;
    const items: { label: string; w: number; draw: (x: number, y: number) => void }[] = [
      { label: 'PRESSURE-REGULATING VALVE (PRV)', w: 58, draw: (x, y) => prvSymbol(b, X(x), Y(y), 4 * S) },
      { label: 'ZONE / BOOSTER PUMP', w: 40, draw: (x, y) => zonePumpSymbol(b, X(x), Y(y), 2.2 * S, 'right') },
      { label: 'BREAK TANK', w: 31, draw: (x, y) => breakTankSymbol(b, X(x - 4), Y(y - 2.2), 8 * S, 4.4 * S) },
      { label: 'CHECK VALVE + OS&Y GATE VALVE', w: 56, draw: (x, y) => { checkValve(b, X(x - 2), Y(y), 0, 3 * S); gateValve(b, X(x + 2), Y(y), 0, 3 * S); } },
      { label: 'EXPRESS RISER (NO OUTLETS)', w: 52, draw: (x, y) => pipe('FP-PIPE-DISC', [[x, y - 2.4], [x, y + 2.4]], 1.0) }
    ];
    tx('FP-ANNO', 28, ly + 6.5, 2.2, 'LEGEND');
    for (const it of items) {
      it.draw(lx + 5, ly);
      tx('FP-ANNO', lx + 11, ly, 2, it.label);
      lx += it.w + 10;
    }
  }

  // ───────────────────────── tables and notes ─────────────────────────
  const xT = 428;
  const wT = FRAME.x1 - xT - 3;
  let y = 578;
  const th = 2.5;

  // service-floor answer
  const answered = zn.serviceFloorsAnswered;
  const ans = !answered
    ? 'SERVICE FLOORS NOT YET SPECIFIED - ANSWER THE QUESTION'
    : zn.serviceFloorIds.length
      ? `SERVICE FLOORS: ${zn.serviceFloorIds.join(', ')} (ANSWERED - BREAK TANK + BOOSTER PUMP SET ON EACH)`
      : 'SERVICE FLOORS: NONE (ANSWERED - NO SERVICE FLOORS AVAILABLE)';
  const ansLines = [ans, answered ? 'A SERVICE FLOOR IS A MECHANICAL FLOOR THAT CAN HOST A BREAK TANK AND A BOOSTER PUMP SET (NFPA 20 SEC. 4.31).' : 'A SERVICE FLOOR IS A MECHANICAL FLOOR THAT CAN HOST A BREAK TANK AND A BOOSTER PUMP SET; THE ANSWER CHANGES THE ZONING OF A TALL BUILDING.'];
  const ansH = 3 + 2 * 3.4 + 1.5;
  b.rect('FP-ANNO', X(xT), Y(y - ansH), wT * S, ansH * S);
  if (!answered) b.rect('FP-ANNO', X(xT + 0.8), Y(y - ansH + 0.8), (wT - 1.6) * S, (ansH - 1.6) * S);
  tx('FP-ANNO', xT + 2, y - 3.6, 3, ansLines[0]);
  tx('FP-ANNO', xT + 2, y - 3.6 - 4.6, 2.1, ansLines[1]);
  y -= ansH + 5;

  // comparison table
  const w = zn.withPrv;
  const wo = zn.withoutPrv;
  const tankVol = (s: StandpipeSolution): string => {
    const t = s.zones.map((z) => z.breakTank).filter((q): q is NonNullable<typeof q> => !!q);
    if (!t.length) return '-';
    const per = t[0];
    return `${s.serviceFloorStations.length} x ${f1(per.volumeM3)} M3 (${withCommas(per.volumeGal)} GAL)`;
  };
  const cmp: string[][] = [
    ['ITEM', 'WITH PRV', 'WITHOUT PRV'],
    ['PRESSURE ZONES', String(w.zones.length), String(wo.zones.length)],
    ['PUMP SETS (MAIN + ZONE / BOOSTER)', String(w.pumpSets), String(wo.pumpSets)],
    ['PRV COUNT (HOSE OUTLETS)', String(w.prvCount), String(wo.prvCount)],
    ['EXPRESS RISERS (NO OUTLETS)', String(w.expressRisers), String(wo.expressRisers)],
    ['SERVICE FLOOR STATIONS', '0', `${wo.serviceFloorStations.length}${wo.serviceFloorStations.length ? ` (${wo.serviceFloorStations.join(', ')})` : ''}`],
    ['MAX STATIC PRESSURE AT OUTLETS (PSI)', psi(w.maxStaticPsi), psi(wo.maxStaticPsi)],
    ['TOP OUTLET RESIDUAL (PSI)', psi(topResidual(w)), psi(topResidual(wo))],
    ['BREAK TANK VOLUME', tankVol(w), tankVol(wo)],
    ['FEASIBLE', yn(w.feasible), yn(wo.feasible)],
    ['SELECTED', sel === 'with-prv' ? 'SELECTED' : '-', sel === 'without-prv' ? 'SELECTED' : '-']
  ];
  const cmpCols = autoCols(cmp, th, [70, 50, 70]);
  const cmpTitle = `COMPARISON - SELECTED: ${sel === 'without-prv' ? 'WITHOUT PRV' : 'WITH PRV'}`;
  const cm = drawTable(c, xT, y, cmpCols, cmp, { title: cmpTitle, th });
  y -= cm.h + 6;

  // per-zone tables
  const zoneRows = (s: StandpipeSolution): string[][] => [
    ['ZONE', 'FLOORS', 'STATION', 'REQUIRED PSI', 'RATED PSI', 'CHURN DISCH. PSI', 'MAX STATIC PSI', 'TOP RESID. PSI'],
    ...s.zones.map((z) => [z.id, floorsText(z), stationText(z, floors), psi(z.requiredPressurePsi), String(z.ratedNetPressurePsi), psi(z.churnDischargePsi), psi(z.maxStaticPsi), psi(z.topResidualPsi)])
  ];
  for (const [name, s] of [['WITH PRV', w], ['WITHOUT PRV', wo]] as const) {
    const rows = zoneRows(s);
    const cols = autoCols(rows, th, [10, 18, 60]);
    const m = drawTable(c, xT, y, cols, rows, { title: `${name} - ZONE TABLE${s === (sel === 'without-prv' ? wo : w) ? ' (SELECTED)' : ''}`, th, alignRight: [false, false, false, true, true, true, true, true] });
    y -= m.h + 6;
  }

  // notes
  const notes: string[] = [];
  w.summary.forEach((t) => notes.push(`WITH PRV - ${t}`));
  wo.summary.forEach((t) => notes.push(`WITHOUT PRV - ${t}`));
  if (wo.suggestion) notes.push(`SUGGESTION - ${wo.suggestion}`);
  notes.push(`SELECTED: ${selLabel}. ${selSol.zones.length} ZONE${selSol.zones.length === 1 ? '' : 'S'}, ${selSol.pumpSets} PUMP SET${selSol.pumpSets === 1 ? '' : 'S'}, ${selSol.prvCount} PRV.`);
  notes.push('REFERENCES: NFPA 14-2019 SEC. 7.2.1 (MAXIMUM PRESSURE 350 PSI), SEC. 7.2.3 (175 PSI AT 2-1/2 IN HOSE OUTLETS, PRV WHERE EXCEEDED), SEC. 7.9 (PRESSURE-REGULATING DEVICES); NFPA 20 SEC. 4.31 (BREAK TANKS AND BOOSTER PUMPS IN SERIES / ZONES).');
  drawNotes(c, xT, y, wT, 'NOTES', notes, 2.3);
}
