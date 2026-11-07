# Sprinkler Obstructions (NFPA 13-2019 §10.2.7), Pipe Sizing & Hydraulic Calculation Deliverables — Plan

User: "Make sure you cover the pipe sizing and hydraulic calculations and the obstruction respecting."

Contract: `sprinkler/sprinklerTypes.ts` — `SprinklerAnswers.deflectorBelowCeilingMm`, `ObstructionKind`,
`SprinklerObstruction`, `ObstructionLayerMapping`, `ObstructionResult`, `SprinklerFloorInput.obstructions`,
`PlacedSprinkler.belowObstruction | relocatedMm`, `SprinklerFloorDesign.obstructions`,
`SprinklerSystemDesign.supplyCurve`. Tests (must pass unchanged): `__tests__/sprinklerObstructions.test.ts` (K8
engine), `__tests__/sprinklerObstructionDrawings.test.ts` (K9 drawings/report). Existing tests keep passing; the only
permitted existing-test edit: `sprinklerDrawingsAndReport.test.ts` combined sheet list becomes
'FS-101,FS-102,FS-501,FS-601,FS-602' (one hydraulic sheet per floor zone).

## K8 Engine
Tables (`nfpa13Sprinkler.ts`, standard pendent / upright spray, NFPA 13-2019 Table 10.2.7.1.2 — verify against the
adopted edition): `beamRuleMaxBIn(aFt)`: A < 1 ft → 0; [1, 1.5) 2.5; [1.5, 2) 3.5; [2, 2.5) 5.5; [2.5, 3) 7.5;
[3, 3.5) 9.5; [3.5, 4) 12; [4, 4.5) 14; [4.5, 5) 16.5; [5, 5.5) 18; [5.5, 6) 20; [6, 6.5) 24; [6.5, 7) 30; [7, 7.5) 35;
≥ 7.5 ft → 35 (table end, treated conservatively). `beamRuleMinAFt(bIn)`: smallest bracket lower bound whose value
≥ b (b ≤ 0 → 0; b > 35 → Infinity). `threeTimesClearanceMm(maxDimMm) = min(3·D, 610)`. Sidewall: apply the same
beam table (conservative; note "verify the sidewall table").
`sprinkler/obstructions.ts`: `detectObstructions(plan, mappings)` — closed polylines on mapped layers → obstructions
`OB1…` in drawing order, kind/depth from the mapping, source 'detected'.

Per obstruction (footprint bbox, widthMm = smaller side, lengthMm = larger side; B = bottomBelowCeilingMm −
deflector (answers.deflectorBelowCeilingMm ?? 100), in inches):
- width > 1219 mm → rule 'wide': sprinklers below it along the long centre line, n = ceil(length / Smax), positions
  (i + ½)·length/n, tags appended after the room's heads, `belowObstruction = id`, same head type as the room, piped
  like any head in the room/zone; ceiling sprinklers clear it with requiredClearance = beamRuleMinAFt(B)·304.8 (if
  Infinity → treat its sides as walls).
- else continuous kinds (beam, duct, cable-tray, pipe): B > 35 in → rule 'wall' (bays; requiredClearance 102 mm,
  heads on each side laid out as if the face were a wall: ≤ Smax/2 and ≥ 102 mm from it); else rule 'beam',
  requiredClearance = beamRuleMinAFt(B)·304.8.
- discrete kinds (column, light, other): rule 'three-times', requiredClearance = threeTimesClearanceMm(width-or-length max).
Ceiling sprinkler is obstructed if its plan distance to the footprint < requiredClearance (− 0.5 mm tolerance).

Relocation (1-D re-spacing; branch direction u, row coordinate v):
- Continuous obstruction crossing rows (its long axis ⟂ branch lines): for every affected row re-space positions along
  u; parallel to the branch lines: re-space the row coordinates v of the room (all rows move together).
- Discrete obstruction: re-space only the rows whose v is within requiredClearance + half its v-extent.
- Solver on a 50 mm grid: positions in the row's interior interval [a, b] (polygon ∩ row line): first/last ≤ Smax/2 and
  ≥ 102 mm from the wall (and from 'wall' obstruction faces), gaps in [1829, Smax] (Smax_eff = min(maxSpacing,
  maxArea / L)), none inside a forbidden interval (obstruction ± requiredClearance projected on the row); minimise the
  count (start at the current count, up to +3), then the sum of squared deviations from the original positions.
  Heads that move get relocatedMm = |shift|; obstruction.relocatedHeads lists them; any head still obstructed →
  violations (check fails with "add / relocate sprinkler").
- Per-head protection area (NFPA 13 §10.2.4.1.1): S = max(distance to the previous/next sprinkler on the branch line,
  2 × distance to the wall for end heads), L = same across rows; areaFt2 = S·L. The remote-area minimum flow uses the
  largest area among its flowing heads.
Checks: `spr-obstruction:<floor>` pass (none or all cleared; detail lists obstructions with rule, clearance, heads
moved / added) or fail (violations). Supply curve: city → points at 0, 25 %, 50 %, 75 %, 100 %, 125 %, 150 % of the
residual test flow by Ps − (Ps − Pr)(Q/Qr)^1.85 (the residual point exactly); fire pump → null standalone, filled
by `applyFirePumpSupply` from the selected pump (net curve + min suction at 0, 50, 100, 125, 150 %).
Hydraulic sizing / pipe schedule as implemented in K6 (velocity ≤ 20 ft/s good practice, margin) — unchanged.

## K9 Drawings & report
- FS-1xx: obstructions on layer FS-OBST (hatched footprint, tag id + kind + "BOTTOM nnn MM BELOW CLG"), clearance
  zone outline (dashed) for beam / three-times rules, relocated sprinklers marked (small arrow + "RELOCATED nnn"),
  below-obstruction sprinklers with their symbol + "BELOW <id>", an OBSTRUCTION SCHEDULE table (id, kind, size,
  bottom below ceiling, rule: BEAM RULE / THREE-TIMES / WIDE - SPRINKLERS BELOW / WALL (BAYS), required clearance,
  heads moved, heads below, status), note citing NFPA 13-2019 §10.2.7 (Table 10.2.7.1.2).
- Hydraulics: one sheet per floor zone FS-601, FS-602 … (floor order, then zone): title "HYDRAULIC CALCULATION -
  <floor> ZONE Zk"; node-to-node worksheet with columns K, Q (add/total), SIZE, ID, C, L, FITTINGS, EQ, LTOT, PF/FT,
  PF, PE, PT start/end, V; summary (density/area, heads flowing, remote head, at ZCV, at source, hose, total, supply,
  margin); N^1.85 hydraulic graph (x axis scaled Q^1.85, gridlines labelled in gpm) with the supply curve, the demand
  point(s) without and with hose, and the margin; "GOVERNING" marker on the building/floor governing zone; BOM stays on
  the first sheet.
- Report: obstruction section (table + rules), per-zone hydraulic worksheets, N^1.85 graph (SVG) per zone, pipe sizing
  method explanation (hydraulic vs pipe schedule §28.5, velocity criterion, margin).
- UI: obstruction layers mapping (layer → kind + depth) from the uploaded DXF, draw obstruction rectangle tool
  (kind, depth), obstruction list editing, show clearance zones, relocated & below-obstruction heads in the result plan.
