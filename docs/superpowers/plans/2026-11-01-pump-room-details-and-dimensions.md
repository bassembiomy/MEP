# Pump Room — Configurable Pumps, Penetrations, Sensing & Drain Lines, Drainage Sump, Tank Access, Full Dimensions

> Contract already added in `engine/fireProtection/fpTypes.ts`: `FireDesignInput.pumpCounts`, `FireDesignInput.tankAccess`,
> `WallPenetration`, `SensingLine`, `DrainageSumpDesign`, `TankAccessDesign`, `PumpRoomLayout.penetrations/sensingLines/
> drainageSump`, `TankDesign.access`, `PumpSetSelection.jockeys`, ValveKind `'sensing-check'`. Do NOT change the contract or tests.
> Paths relative to `src/renderer/src/`. Tests `npx tsx <file>`; `npm run typecheck`.

## Standards rules
| Item | Rule |
|---|---|
| Pump set | electric-motor and diesel-engine horizontal centrifugal fire pumps (NFPA 20 Ch. 6, 9, 11); duty + standby; jockey (pressure maintenance) pumps with own controllers (NFPA 20 §4.26 / A.4.26) |
| Diesel fuel | one fuel tank per engine (NFPA 20 §11.4.1) |
| Tank-wall penetrations | water-retaining wall → cast-in puddle flange (wall sleeve not used); flange OD = pipe OD + 200 mm (rounded up 10), 10 mm thick, centred in the wall, welded to the pipe (ACI 350 / BS EN 1992-3 good practice; NFPA 22 tank connections) |
| Other wall penetrations | sleeve ID = pipe OD + 50 mm (rounded up 10) with mechanical link seal; fire-rated walls fire-stopped (IBC §714) |
| Sensing lines | NFPA 20-2019 §4.32 / §10.5.2.1: one per controller; ½" brass, copper or series 300 stainless steel; connected between the pump discharge check valve and the discharge isolation valve; two check valves ≥ 5 ft (1.5 m) apart with 3/32" orifice in the clapper; pressure gauge and test connection at the controller |
| Pump drains | each pump: casing drain, packing-gland drip and (electric pumps) circulation relief discharge piped to the floor trench (NFPA 20 §4.12; IPC §802 indirect waste) |
| Drainage sump | IPC §712: pit ≥ 18 in (457 mm) diameter and ≥ 24 in (610 mm) deep, solid gas-tight cover / grating, discharge with check valve and full-open valve on each pump, capacity per IPC Table 712.4.2 (2" → 21 gpm, 2½" → 30 gpm, 3" → 46 gpm); duplex pumps with alternator and high-level alarm (good practice for fire pump rooms) |
| Tank access | NFPA 22: manholes ≥ 600 mm (24 in); roof manholes with internal ladders, or bolted side manways at low level for sectional (GRP / pressed-steel) tanks; tank must be drained before opening a side manway |

## Task P1 — Engine (Sonnet)
Files: `standards/pipeData.ts` (add ½"), `pumpSelector.ts`, `pumpRoomDesigner.ts`, `tankDesigner.ts`, `fireProtectionEngine.ts`
(checks), `report.ts` (sections), and the UI inputs (`src/renderer/src/fire/FireInputPanel.tsx`: pump counts & tank access).
Test: `engine/__tests__/firePumpRoomDetails.test.ts` (provided); all existing fire tests must keep passing.

1. **pipeData:** add `0.5: { dn: 15, odIn: 0.840, idSch40: 0.622, idSch10: 0.674 }` and 0.5 at the start of NOMINAL_SIZES_IN;
   formatPipeSize(0.5) → `DN15 (½")`.
2. **Pump set (pumpSelector):** when `input.pumpCounts` is given, main drivers = `electric` × 'electric' then `diesel` × 'diesel'
   (clamp: each 0–3, total 1–4; total 0 → one electric); role duty for the first, standby for the rest; tags FP-n / FPC-n.
   Jockeys = clamp(jockey, 1, 2) identical selections JP-1 (JPC-1), JP-2 (JPC-2). `jockeys` array, `jockey = jockeys[0]`.
   Main relief valve rule uses "any diesel". Without pumpCounts behaviour is unchanged (jockeys = [jockey]).
   Add check `pump-count` (pass; warn when clamped) with the counts in the detail.
3. **Pump room (pumpRoomDesigner):** generalise to N main pumps, M jockeys, one fuel tank per diesel:
   - Y chain: 1200 corridor → for each main pump: pad + 1200 gap → jockey row (pads side by side from x = xPadW with 900 between) →
     [diesels: 1000 → fuel-tank row (bunds side by side from x = xPadW, 900 between)] → 1000 → north wall. Every controller on the
     east wall at its pump's nozzle y (jockey controllers at the jockey row), shifted north to avoid overlaps (grow W if needed).
   - **Penetrations:** tank (west) wall — one puddle flange per main-pump suction (y = suctionLineY), one for the test return (y = 600,
     elevation highLevelPipe), one for a separate relief return if one exists (otherwise none); tags PF-01… in that order.
     Other walls — sleeves WS-01…: system outlet (north), test header branch (south), drainage-sump discharge (south, only when
     pumped), and one diesel exhaust per diesel (north). elevationM = pump CL for suctions, highLevelPipe for the rest
     (system outlet: highLevelPipe). Notes: `Cast-in puddle flange, OD x mm, 10 thk, welded to pipe` /
     `Sleeve ID y mm + link seal + firestop (IBC 714)`.
   - **Sensing lines:** one per main pump and per jockey. Tap at the midpoint between the pump's discharge check valve and its
     discharge butterfly valve (jockey: on the jockey discharge pipe 300 mm before the header); route: north 400 mm, then east to the
     controller's west face at its centre y (if the controller is south of the tap go south instead). Check valves at 300 mm and
     300 + 1500 mm along the route; if the route is shorter than 2100 mm, extend the first leg so it is 2100 mm. sizeIn 0.5, material
     `Brass / copper (or SS 316), 1/2 in`. Add a `sensing` PipeSegment2D and two `sensing-check` valves (tags continue V-nn) per line.
     Remove the old single header→controller sensing pipes.
   - **Drain lines:** per main pump a `drain` PipeSegment2D (¾") from the pump base (skid west edge, nozzle y) west to the trench
     centre-line; per jockey one to the trench as well.
   - **Drainage sump:** pumped when the pump-room FFL is below grade: FFL = building.pumpRoomFloorElevationM if a building is given,
     else −4.0 m when tankPlacement is 'underground', else 0. required = FFL < −0.5. Pit 1200 × 1000 (rect at the south end of the
     trench, replacing the 600 mm drain pit DP-1 → tag DS-1, equipment kind 'drain-pit'), depth 1200. inflow = trench.designInflowGpm.
     flow = ceil5(max(1.5·inflow, 21)); discharge = smallest of [2, 2.5, 3, 4] with Sch40 velocity ≤ 8 ft/s; head ft =
     ceil5((−FFL + pitDepth/1000 + 1.0) × 1.3 × 3.28084); motor = smallest NEMA ≥ flow·head/(3960·0.45); pumps SP-1 (duty) & SP-2
     (standby) 'Submersible drainage pump'; levels off 300 / lead 700 / lag 850 / alarm 1000; workingVolumeGal =
     (lead − off)/1000 × L/1000 × W/1000 × 264.172 (1 decimal); cycleMinutes = workingVolumeGal / flow (2 decimals); dischargeTo
     `Building storm / sanitary drain via air gap (IPC 802) - verify with plumbing engineer`; controls: alternator, float switches,
     high-level alarm to FACP, check valve + gate valve per pump. Not required: pumps [], dischargeSizeIn 4 (gravity), `Gravity drain
     to building drain (IPC 802 air gap)`. Checks `sump-pit-size`, `sump-capacity`, `sump-discharge-valves`, `sump-duplex`.
     Trench path ends at the sump pit centre.
   - Room checks: `penetrations` (every tank-wall penetration is a puddle flange), `sensing-lines` (one per controller, ½", two
     checks ≥ 1500 mm apart), `pump-drains` (one per pump).
4. **Tank (tankDesigner):** `access` from `input.tankAccess ?? 'top'`: per compartment one opening — top: x = compartment start
   + Lc − 700, y = W − 700 (mm, tank-internal), sizeMm 800, label `D800 ROOF MANHOLE + INTERNAL LADDER`, ladder 'internal';
   side: on the north wall (y = W) at the compartment centre x, sizeMm 600, label `D600 BOLTED SIDE MANWAY, INVERT 300 ABOVE TANK FLOOR`,
   ladder 'none'. note text. Check `tank-access` (pass; warn when side access is used with a reinforced-concrete tank — "side manways
   suit sectional GRP / steel tanks").
5. **Report:** add penetrations, sensing lines, drainage sump and tank access sections.
6. **UI (FireInputPanel, PUMP SET section):** "Custom pump set" toggle → number inputs Electric pumps (0–3), Diesel pumps (0–3),
   Jockey pumps (1–2) writing `pumpCounts`; when off `pumpCounts` undefined (arrangement select shown). WATER TANK section: access
   select Top manholes / Side manways.

## Task P2 — Drawings (Sonnet)
Files: `drawing/sheetPlan.ts`, `sheetSection.ts`, `sheetTank.ts`, new `drawing/sheetPumpRoomDetails.ts`, register **FP-110** last in
`sheets.ts`. Test: `engine/__tests__/firePumpRoomDetailsDrawings.test.ts` (provided) + existing sheet tests.
- **FP-101 plan:** support N pumps / M jockeys / K fuel tanks; full dimensioning: overall internal L and W and external L and W
  (incl. walls), wall thickness, pad sizes (each pump pad L × W), chain dimensions along the y axis (south wall → each pad → north
  wall) and along x (tank wall → pad → header → controllers → east wall), sump pit size; tank internal size note
  `TANK INTERNAL L x W x H (SEE FP-103)`; puddle-flange symbol (flange plate across the pipe at the wall) + tag `PF-nn` at every
  tank-wall penetration and sleeve tags `WS-nn`; every sensing line drawn on FP-PIPE-SENS with its two check valves and a callout
  `1/2" SENSING LINE - 2 CHECK VALVES 3/32" ORIFICE 1.5 M APART (NFPA 20)`; pump drain lines to the trench (FP-PIPE-DRAN); drainage
  sump DS-1 with two pump symbols SP-1 / SP-2, discharge with check + gate valve and callout `DS-1 SUMP PIT ... DUPLEX SUMP PUMPS ...`.
- **FP-102 section:** keep puddle flange & anti-vortex; label the flange `PUDDLE FLANGE PF-01`.
- **FP-103 tank:** draw access per `tank.access` (top: manhole circles + ladder in plan and section; side: manway on the north wall in
  plan + elevation note), label `SUCTION PIT` at every sump, overall external and internal dimensions on both axes.
- **FP-110 PUMP ROOM DETAILS** (A1, details at 1:10 / 1:20, framed panels): (1) `PUDDLE FLANGE DETAIL` — wall section, pipe, flange,
  dims flange OD / 10 thk / wall thickness / centred; (2) `WALL SLEEVE & LINK SEAL DETAIL` with firestop; (3) `ANTI-VORTEX PLATE
  DETAIL` — plan + section, plate ≥ 2D, inlet D/2 above pit floor, legs; (4) `PRESSURE SENSING LINE DETAIL` — discharge check valve,
  tap, two check valves with 3/32" orifice 1.5 m apart, gauge, test valve, to controller; (5) `DRAINAGE SUMP PIT DETAIL` — section
  with pit dims, both pumps, float levels OFF/LEAD/LAG/ALARM with heights, discharge check + gate valves, grating cover, trench inlet;
  (6) `TRENCH SECTION DETAIL` — 300 wide, depth, grating, 1% fall; (7) `PUMP ROOM DETAIL NOTES` (≥ 10, citing NFPA 20, NFPA 22,
  IPC §712, IPC §802, IBC §714, ACI 350). Title block like the other sheets.
