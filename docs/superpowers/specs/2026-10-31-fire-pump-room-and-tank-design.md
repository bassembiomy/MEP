# Fire Fighting Branch — Fire Pump Room, Fire Water Tank & 2D DXF Drawings

**Status:** Approved by request (user specified scope + execution model) · **Date:** 2026-10-31
**Plan:** `docs/superpowers/plans/2026-10-31-fire-pump-room-and-tank-design.md`

## 1. Goal

Add a second discipline ("Fire Fighting") to the MEP application. From a small set of
inputs the engine performs an Elite-Fire-style node-to-node hydraulic calculation,
selects the fire pump set (electric / diesel main pumps + jockey), designs the fire water
storage tank with suction sump pits and anti-vortex plates, lays out the pump room
(pumps, pads, piping, valves, test lines, control panels, drainage trench, door,
louvers) and emits a professional multi-sheet 2D drawing set as AutoCAD R12 DXF, with an
in-app SVG preview of the same drawing model.

## 2. Standards basis (editions as modelled)

| Code | Edition | Used for |
|---|---|---|
| NFPA 13 | 2019 | Hazard classification, density/area design point, max coverage, hose allowance & duration, Hazen-Williams, equivalent pipe lengths, C-factors, 7 psi min end-head pressure, 1.2√A rule |
| NFPA 14 | 2019 | Standpipe flow (500 + 250/add'l, cap 1000 sprinklered / 1250 unsprinklered), residual 100 psi (Class I/III) / 65 psi (Class II), 30 min duration |
| NFPA 20 | 2019 | Standard rated capacities, centrifugal pump performance (≤140 % shutoff, ≥65 % at 150 %), Summary of Centrifugal Fire Pump Data table (pipe/relief/meter/test header sizes), 15 ft/s suction velocity at 150 %, −3 psi min suction at 150 % (tank), OS&Y suction valve / no butterfly valve within 50 ft, eccentric reducer, 10 D straight run, vortex plate, circulation relief valve, pressure relief valve 121 % rule (diesel), diesel derate & fuel tank, motor sizing, controllers (Ch. 10/12), jockey pump sizing & setpoints (Annex A), min run timers, pump-room protection/heating |
| NFPA 22 | 2018 | Fire water tank effective capacity, anti-vortex plate, refill within 8 h, overflow / vent / manhole / ladder / drain |
| NFPA 24 | 2019 | Private fire service mains (feed main) |
| NFPA 25 | 2020 | Annual flow test provisions (test header, flow meter) |
| NFPA 70 | 2020 | Art. 695 fire pump power, Art. 110.26 working space in front of controllers (≥ 1.0 m used) |
| IBC | 2021 | §903 sprinklers, §905 standpipes, §913 fire pumps (§913.2.1 room separation: 2 h high-rise / 1 h otherwise), §913.4 valve supervision |
| IPC | 2021 | §608 backflow / air gap on tank fill, §802 indirect waste with air gap for relief & drip drains, floor drains |
| UPC | 2021 | §603 backflow / air gap, §801 indirect waste, floor drains |

Section numbers are cited where the edition is known; all reports carry the note
*"Verify clause numbering against the edition adopted by the Authority Having Jurisdiction."*

## 3. Architecture

```
engine/fireProtection/
  fpTypes.ts                 contract (written)
  standards/nfpa13.ts        hazard table, hose/duration, equivalent lengths, C multipliers
  standards/nfpa14.ts        standpipe flows/pressures
  standards/nfpa20.ts        rated capacities, pump data table, motor/diesel lists, speeds
  standards/pipeData.ts      Sch 40 / Sch 10 ID, OD, DN, valve face-to-face lengths
  standards/codeReferences.ts standards list + IBC/IPC/UPC requirements text
  hydraulics.ts              Hazen-Williams, sprinkler, branch line, remote area, standpipe, system demand
  pumpSelector.ts            fire pumps, curve, drivers, jockey, setpoints, relief valves, controllers, test header
  tankDesigner.ts            storage volume, dimensions, material, levels, sump/anti-vortex, connections
  pumpRoomDesigner.ts        room size, equipment placement, pipes, valves, trench, doors, louvers
  fireProtectionEngine.ts    designFireProtectionSystem(input) → FireDesignResult; DEFAULT_FIRE_INPUT
  report.ts                  plain-text calculation report (Elite-style)
  drawing/drawingTypes.ts    drawing model contract (written)
  drawing/drawingBuilder.ts  DrawingBuilder: primitives, dimensions, leaders, level marks, tags, tables
  drawing/symbols.ts         valve / pump / panel / equipment symbols
  drawing/dxfWriter.ts       R12 AC1009 serializer
  drawing/svgRenderer.ts     SVG serializer for preview
  drawing/sheets.ts          generateFireDrawings(result) → Drawing (5 sheets)
store/fireProtectionStore.ts zustand store (input, result, drawing, ui state)
fire/*.tsx                   Fire workspace UI
App.tsx                      discipline switch HVAC | Fire Fighting
```

The drawing model is format-neutral; DXF and SVG are two serializers of the same
model, so the preview is exactly what is exported.

## 4. Key engineering decisions

1. **Hydraulics** — node-to-node remote-area calc: end head at max(7 psi, (ρ·As/K)²);
   heads per branch = ⌈1.2√A / S⌉; branch line equivalent K carried along the cross main;
   riser and feed main with fittings and elevation; inside hose added at pump discharge.
2. **Combined standpipe/sprinkler** — pump design point is the envelope
   (max flow, max pressure) of the sprinkler case and the standpipe case; storage is the
   larger of (Qspr + total hose) × duration and Qstandpipe × 30 min.
3. **Pump rating** — smallest NFPA 20 standard capacity ≥ demand flow; rated net pressure
   = demand pressure − suction pressure at rated flow at low water level, rounded up to 5 psi.
   Modelled curve: shutoff 120 %, 150 % flow at 70 % (inside the NFPA 20 envelope).
4. **Suction must be flooded** for horizontal pumps (tank floor / vortex plate above pump CL);
   otherwise a check fails and vertical turbine is recommended.
5. **Tank** — effective capacity measured between the anti-vortex plate (sump) and the
   normal water level; overflow +100 mm, TWL +200 mm, ≥ 300 mm air space; two equal
   compartments by default, one suction sump per main pump.
6. **Drawings** — R12 DXF (widest compatibility), mm model space, sheets side by side,
   each with ISO A1 frame and title block, auto-scale from {20, 25, 50, 75, 100}.
   Layers prefixed `FP-` with ACI colours and linetypes.

## 5. Out of scope

Grid / looped sprinkler networks (tree remote area only), vertical turbine pump-room drawing
(flagged), structural design of the tank (indicative thicknesses only), manufacturer
selection (equipment footprints are typical; drawings note "verify with certified
manufacturer drawings").
